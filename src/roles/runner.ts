import type { Ctx, CommandResult } from '../core/types.ts';
import { byId } from '../modules/index.ts';
import { dateKey, mondayOf } from '../util/date.ts';
import { truncate } from '../util/fmt.ts';
import type { RolePack, WorkflowStep } from './types.ts';
import { resolvePermission } from './types.ts';
import { record, EVENTS } from './audit.ts';
import { logger } from '../core/logger.ts';

/**
 * Rol paketining ish oqimini bajaradi.
 *
 * Bu yerda ruxsatlar **haqiqatan tekshiriladi** — hujjatda yozilgani bilan
 * cheklanmaydi. Har bir amal jurnalga tushadi, tasdiq talab qiladigani esa
 * navbatga qo'yiladi va odam hal qilmaguncha bajarilmaydi.
 */

const log = logger('rol');

export type StepStatus =
  | 'bajarildi'
  | 'tasdiq_kutmoqda'
  | 'bloklandi'
  | 'rad_etildi'
  | 'xato'
  | 'o‘tkazildi';

export type StepOutcome = {
  step: string;
  title: string;
  action: string;
  status: StepStatus;
  summary: string;
  approvalId?: number;
  files?: string[];
};

/** Bir qadamning takrorlanmaslik uyasi: kunlik yoki haftalik. */
export function slotFor(step: WorkflowStep, now: Date, tz: string): string {
  return step.weekly ? `H${dateKey(mondayOf(now, tz), tz)}` : dateKey(now, tz);
}

function findCommand(action: string) {
  const [moduleId, name] = action.split(':');
  const mod = byId(moduleId ?? '');
  const cmd = mod?.commands.find((c) => c.name === name);
  return cmd && mod ? { mod, cmd } : null;
}

/** Paketdagi barcha `modul:buyruq` nomlarini bilish uchun — tekshiruvda ishlatiladi. */
export const commandExists = (action: string): boolean => findCommand(action) !== null;

const summarize = (r: CommandResult): string => {
  const first = r.text.split('\n').find((l) => l.trim()) ?? '';
  const files = r.files?.length ? ` · ${r.files.length} fayl` : '';
  return truncate(first, 160) + files;
};

async function execute(
  ctx: Ctx,
  pack: RolePack,
  step: WorkflowStep,
  action: string,
  args: string[],
  actor: 'agent' | 'odam',
): Promise<{ ok: true; result: CommandResult } | { ok: false; error: string }> {
  const found = findCommand(action);
  if (!found) return { ok: false, error: `buyruq topilmadi: ${action}` };
  try {
    const result = await found.cmd.run(ctx, args);
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor,
      event: EVENTS.actionExecuted,
      subject: action,
      detail: { step: step.id, args, natija: summarize(result), fayllar: result.files ?? [] },
    });
    return { ok: true, result };
  } catch (e) {
    const error = (e as Error).message;
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor,
      event: EVENTS.stepFailed,
      subject: action,
      detail: { step: step.id, xato: error },
    });
    return { ok: false, error };
  }
}

function saveRun(ctx: Ctx, pack: RolePack, step: WorkflowStep, slot: string, status: StepStatus, summary: string): void {
  ctx.db.run(
    `INSERT INTO role_runs(role, step, slot, started_at, finished_at, status, summary)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(role, step, slot) DO UPDATE SET
       finished_at = excluded.finished_at, status = excluded.status, summary = excluded.summary`,
    pack.id,
    step.id,
    slot,
    ctx.now.toISOString(),
    ctx.now.toISOString(),
    status,
    summary,
  );
}

export type RunOptions = {
  /** Uya band bo'lsa ham qayta bajarish. */
  force?: boolean;
  /** Faqat shu qadam. */
  only?: string;
};

/** Bitta qadamni bajaradi — ruxsat, tasdiq va jurnal bilan. */
export async function runStep(ctx: Ctx, pack: RolePack, step: WorkflowStep, opts: RunOptions = {}): Promise<StepOutcome> {
  const slot = slotFor(step, ctx.now, ctx.cfg.tz);
  const action = step.action;
  const args = step.args ?? [];
  const base = { step: step.id, title: step.title, action };

  // Bir uyada bir marta: kun davomida qayta chaqirilsa ish takrorlanmaydi.
  if (!opts.force) {
    const done = ctx.db.get<{ status: string; summary: string }>(
      'SELECT status, summary FROM role_runs WHERE role=? AND step=? AND slot=?',
      pack.id,
      step.id,
      slot,
    );
    if (done && done.status !== 'xato') {
      return { ...base, status: 'o‘tkazildi', summary: `bugun bajarilgan: ${done.summary ?? done.status}` };
    }
  }

  const perm = resolvePermission(pack, action);

  if (perm.mode === 'deny') {
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor: 'tizim',
      event: EVENTS.permissionDenied,
      subject: action,
      detail: { step: step.id, qoida: perm.rule, sabab: perm.why },
    });
    saveRun(ctx, pack, step, slot, 'bloklandi', perm.why);
    log.warn(`${pack.id}/${step.id}: ${action} bloklandi — ${perm.why}`);
    return { ...base, status: 'bloklandi', summary: `ruxsat yo‘q (${perm.rule}): ${perm.why}` };
  }

  record(ctx.db, ctx.now, {
    role: pack.id,
    actor: 'agent',
    event: EVENTS.stepStarted,
    subject: action,
    detail: { step: step.id, rejim: perm.mode },
  });

  if (perm.mode === 'approval') {
    // Takroriy so'ramaslik: shu qadam uchun ochiq so'rov bo'lsa yangisi yaratilmaydi.
    const open = ctx.db.get<{ id: number }>(
      `SELECT id FROM role_approvals WHERE role=? AND step=? AND status='kutilmoqda'`,
      pack.id,
      step.id,
    );
    if (open) {
      saveRun(ctx, pack, step, slot, 'tasdiq_kutmoqda', `#${open.id} tasdiq kutmoqda`);
      return { ...base, status: 'tasdiq_kutmoqda', summary: `#${open.id} allaqachon navbatda`, approvalId: open.id };
    }

    const r = ctx.db.run(
      `INSERT INTO role_approvals(role, step, action, args, reason, preview, created_at)
       VALUES(?,?,?,?,?,?,?)`,
      pack.id,
      step.id,
      action,
      JSON.stringify(args),
      perm.why,
      `${step.title} → ${step.produces}`,
      ctx.now.toISOString(),
    );
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor: 'agent',
      event: EVENTS.approvalRequested,
      subject: action,
      detail: { step: step.id, approvalId: r.lastInsertRowid, args },
    });
    saveRun(ctx, pack, step, slot, 'tasdiq_kutmoqda', `#${r.lastInsertRowid} tasdiq kutmoqda`);
    return {
      ...base,
      status: 'tasdiq_kutmoqda',
      summary: `tasdiq kerak (#${r.lastInsertRowid}): ${perm.why}`,
      approvalId: r.lastInsertRowid,
    };
  }

  const out = await execute(ctx, pack, step, action, args, 'agent');
  if (!out.ok) {
    saveRun(ctx, pack, step, slot, 'xato', out.error);
    return { ...base, status: 'xato', summary: out.error };
  }

  const summary = summarize(out.result);

  // Buyruq xato bermadi — lekin kutilgan ishni qildimi?
  const complaint = step.verify?.(out.result) ?? null;
  if (complaint) {
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor: 'tizim',
      event: EVENTS.stepFailed,
      subject: action,
      detail: { step: step.id, tekshiruv: complaint, javob: summary },
    });
    saveRun(ctx, pack, step, slot, 'xato', complaint);
    return { ...base, status: 'xato', summary: `${complaint} (javob: ${summary})` };
  }

  record(ctx.db, ctx.now, {
    role: pack.id,
    actor: 'agent',
    event: EVENTS.stepDone,
    subject: action,
    detail: { step: step.id, natija: summary },
  });
  saveRun(ctx, pack, step, slot, 'bajarildi', summary);
  return { ...base, status: 'bajarildi', summary, files: out.result.files ?? [] };
}

/** Butun ish oqimi — tartib bilan. */
export async function runWorkflow(ctx: Ctx, pack: RolePack, opts: RunOptions = {}): Promise<StepOutcome[]> {
  const steps = opts.only ? pack.workflow.filter((s) => s.id === opts.only) : pack.workflow;
  const out: StepOutcome[] = [];
  for (const step of steps) {
    out.push(await runStep(ctx, pack, step, opts));
  }
  return out;
}

// ------------------------------------------------------------------ tasdiqlar

export type Approval = {
  id: number;
  role: string;
  step: string;
  action: string;
  args: string;
  reason: string;
  preview: string | null;
  created_at: string;
  status: string;
  decided_at: string | null;
  decided_by: string | null;
  note: string | null;
  result: string | null;
};

export function pendingApprovals(ctx: Ctx, role?: string): Approval[] {
  return role
    ? ctx.db.all<Approval>(
        `SELECT * FROM role_approvals WHERE status='kutilmoqda' AND role=? ORDER BY id`,
        role,
      )
    : ctx.db.all<Approval>(`SELECT * FROM role_approvals WHERE status='kutilmoqda' ORDER BY id`);
}

/**
 * Tasdiqlash — va shu zahoti bajarish.
 *
 * Amal aynan navbatga qo'yilgan ko'rinishda bajariladi: buyruq ham,
 * argumentlar ham o'zgarmaydi. Ya'ni siz ko'rgan narsa bajariladi.
 */
export async function approve(ctx: Ctx, pack: RolePack, id: number, by: string): Promise<StepOutcome> {
  const row = ctx.db.get<Approval>(`SELECT * FROM role_approvals WHERE id=?`, id);
  if (!row) throw new Error(`#${id} topilmadi`);
  if (row.status !== 'kutilmoqda') throw new Error(`#${id} allaqachon hal qilingan: ${row.status}`);
  if (row.role !== pack.id) throw new Error(`#${id} boshqa rolga tegishli: ${row.role}`);

  const step = pack.workflow.find((s) => s.id === row.step) ?? {
    id: row.step,
    title: row.step,
    action: row.action,
    produces: '',
  };

  // Tasdiqdan keyin ham ruxsat qayta tekshiriladi: paket yangilangan bo'lsa,
  // eski navbatdagi so'rov taqiqni aylanib o'tmasin.
  const perm = resolvePermission(pack, row.action);
  if (perm.mode === 'deny') {
    ctx.db.run(
      `UPDATE role_approvals SET status='rad_etildi', decided_at=?, decided_by=?, note=? WHERE id=?`,
      ctx.now.toISOString(),
      'tizim',
      'paket yangilangan — amal endi taqiqlangan',
      id,
    );
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor: 'tizim',
      event: EVENTS.permissionDenied,
      subject: row.action,
      detail: { approvalId: id, sabab: 'paket yangilandi' },
    });
    return { step: row.step, title: step.title, action: row.action, status: 'bloklandi', summary: 'amal endi taqiqlangan' };
  }

  const args = JSON.parse(row.args) as string[];
  record(ctx.db, ctx.now, {
    role: pack.id,
    actor: 'odam',
    event: EVENTS.approvalGranted,
    subject: row.action,
    detail: { approvalId: id, kim: by, args },
  });

  const out = await execute(ctx, pack, step, row.action, args, 'odam');
  const slot = slotFor(step, ctx.now, ctx.cfg.tz);

  if (!out.ok) {
    ctx.db.run(
      `UPDATE role_approvals SET status='xato', decided_at=?, decided_by=?, result=? WHERE id=?`,
      ctx.now.toISOString(),
      by,
      out.error,
      id,
    );
    saveRun(ctx, pack, step, slot, 'xato', out.error);
    return { step: row.step, title: step.title, action: row.action, status: 'xato', summary: out.error };
  }

  const summary = summarize(out.result);

  const complaint = step.verify?.(out.result) ?? null;
  if (complaint) {
    ctx.db.run(
      `UPDATE role_approvals SET status='xato', decided_at=?, decided_by=?, result=? WHERE id=?`,
      ctx.now.toISOString(),
      by,
      complaint,
      id,
    );
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor: 'tizim',
      event: EVENTS.stepFailed,
      subject: row.action,
      detail: { approvalId: id, tekshiruv: complaint, javob: summary },
    });
    saveRun(ctx, pack, step, slot, 'xato', complaint);
    return { step: row.step, title: step.title, action: row.action, status: 'xato', summary: complaint };
  }

  ctx.db.run(
    `UPDATE role_approvals SET status='tasdiqlandi', decided_at=?, decided_by=?, result=? WHERE id=?`,
    ctx.now.toISOString(),
    by,
    summary,
    id,
  );
  saveRun(ctx, pack, step, slot, 'bajarildi', summary);
  return {
    step: row.step,
    title: step.title,
    action: row.action,
    status: 'bajarildi',
    summary,
    files: out.result.files ?? [],
  };
}

export function reject(ctx: Ctx, pack: RolePack, id: number, by: string, note: string): Approval {
  const row = ctx.db.get<Approval>(`SELECT * FROM role_approvals WHERE id=?`, id);
  if (!row) throw new Error(`#${id} topilmadi`);
  if (row.status !== 'kutilmoqda') throw new Error(`#${id} allaqachon hal qilingan: ${row.status}`);

  ctx.db.run(
    `UPDATE role_approvals SET status='rad_etildi', decided_at=?, decided_by=?, note=? WHERE id=?`,
    ctx.now.toISOString(),
    by,
    note,
    id,
  );
  record(ctx.db, ctx.now, {
    role: pack.id,
    actor: 'odam',
    event: EVENTS.approvalRejected,
    subject: row.action,
    detail: { approvalId: id, kim: by, izoh: note },
  });

  const step = pack.workflow.find((s) => s.id === row.step);
  if (step) saveRun(ctx, pack, step, slotFor(step, ctx.now, ctx.cfg.tz), 'rad_etildi', note || 'rad etildi');
  return { ...row, status: 'rad_etildi', decided_by: by, note };
}

import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { stamp, monthKey, prevMonth } from '../util/date.ts';
import { table, truncate } from '../util/fmt.ts';
import { openReports } from './accounting.ts';
import { unpaid } from './recurring.ts';

/**
 * (7) Yuridik yordamchi.
 *
 * MUHIM: bu modul qonun matnlarini o'zi to'qimaydi. Bilimlar bazasi —
 * foydalanuvchi yoki yurist kiritgan yozuvlar. Tekshiruvlar esa tizimdagi
 * haqiqiy ma'lumotga tayanadi (muddati o'tgan hisobot, to'lanmagan shartnoma va h.k.).
 */

export type LegalNote = {
  id: number;
  topic: string;
  jurisdiction: string;
  summary: string;
  source: string | null;
  tags: string | null;
  updated_at: string;
};

/** Umumiy biznes-intizom ro'yxati — huquqiy risklarni kamaytiradigan odatlar. */
export const CHECKLIST: { key: string; title: string; hint: string }[] = [
  { key: 'shartnoma', title: 'Shartnomalar yozma va imzolangan', hint: 'Har bir mijoz/yetkazib beruvchi bilan yozma shartnoma bo‘lsin.' },
  { key: 'hisobot', title: 'Soliq va buxgalteriya hisobotlari muddatida', hint: 'Muddatlarni buxgalter bilan tasdiqlang, kechikish jarimaga olib keladi.' },
  { key: 'xodim', title: 'Xodimlar rasman rasmiylashtirilgan', hint: 'Mehnat shartnomasi, buyruq va tabel yuritilsin.' },
  { key: 'litsenziya', title: 'Faoliyat uchun ruxsat/litsenziya amalda', hint: 'Amal qilish muddatini kalendarga qo‘ying.' },
  { key: 'kassa', title: 'Kassa va to‘lov hujjatlari saqlanadi', hint: 'Chek, hisob-faktura va bank ko‘chirmalari arxivi.' },
  { key: 'shaxsiy', title: 'Mijoz ma’lumotlari himoyalangan', hint: 'Shaxsiy ma’lumotlarni yig‘ish uchun rozilik va saqlash tartibi.' },
  { key: 'reklama', title: 'Reklama da’volari asoslangan', hint: '“Eng yaxshi”, “100% natija” kabi da’volar isbotlanishi kerak.' },
];

export const legalModule: Module = {
  id: 'yurist',
  title: 'Yuridik yordamchi',
  about: 'Bilimlar bazasi, biznes-intizom tekshiruvi, hujjat muddatlari.',

  commands: [
    {
      name: 'add',
      usage: 'yurist add "<mavzu>" "<qisqacha>" [--source=havola] [--tags=soliq,shartnoma]',
      about: 'Bilimlar bazasiga yozuv qo‘shish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const topic = a.at(0);
        const summary = a.at(1) || a.rest(1);
        if (!topic || !summary) return { text: 'Masalan: yurist add "Ijara shartnomasi" "Muddat 1 yil, 30 kun oldin ogohlantirish"' };
        const r = ctx.db.run(
          `INSERT INTO legal_notes(topic, jurisdiction, summary, source, tags, updated_at) VALUES(?,?,?,?,?,?)`,
          topic,
          a.str('uz', 'UZ'),
          summary,
          a.str('source') || null,
          a.str('tags') || null,
          ctx.now.toISOString(),
        );
        return { text: `⚖️ #${r.lastInsertRowid} "${topic}" saqlandi.` };
      },
    },
    {
      name: 'search',
      usage: 'yurist search <so‘z>',
      about: 'Bilimlar bazasidan qidirish.',
      run: (ctx, argv) => {
        const q = parseArgs(argv).rest(0).trim();
        if (!q) return { text: 'Qidiruv so‘zi kerak.' };
        const items = ctx.db.all<LegalNote>(
          `SELECT * FROM legal_notes WHERE topic LIKE ? OR summary LIKE ? OR COALESCE(tags,'') LIKE ? ORDER BY updated_at DESC`,
          `%${q}%`,
          `%${q}%`,
          `%${q}%`,
        );
        if (!items.length) return { text: `"${q}" bo‘yicha yozuv yo‘q. Qo‘shish: yurist add "..." "..."` };
        return {
          text: items.map((n) => `#${n.id} ${n.topic}\n   ${n.summary}${n.source ? `\n   manba: ${n.source}` : ''}`).join('\n\n'),
          data: items,
        };
      },
    },
    {
      name: 'list',
      usage: 'yurist list',
      about: 'Barcha yozuvlar.',
      run: (ctx) => {
        const items = ctx.db.all<LegalNote>(`SELECT * FROM legal_notes ORDER BY updated_at DESC LIMIT 50`);
        if (!items.length) return { text: 'Bilimlar bazasi bo‘sh.' };
        return {
          text: table(
            ['#', 'Mavzu', 'Qisqacha', 'Yangilangan'],
            items.map((n) => [n.id, n.topic, truncate(n.summary, 50), stamp(new Date(n.updated_at), ctx.cfg.tz).slice(0, 10)]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'check',
      usage: 'yurist check',
      about: 'Tizimdagi ma’lumot asosida huquqiy risklarni tekshirish.',
      run: (ctx) => {
        const risks: string[] = [];
        const late = openReports(ctx).filter((r) => r.due_at && new Date(r.due_at) < ctx.now);
        for (const r of late) risks.push(`⚠️ Hisobot muddati o‘tgan: ${r.kind} (${r.period}) — jarima xavfi.`);

        const debts = unpaid(ctx);
        if (debts.length) risks.push(`⚠️ To‘lanmagan majburiy to‘lovlar: ${debts.map((d) => d.title).join(', ')}.`);

        const prev = prevMonth(monthKey(ctx.now, ctx.cfg.tz));
        const hasPrevReport = ctx.db.get(`SELECT id FROM acct_reports WHERE period=?`, prev);
        if (!hasPrevReport) risks.push(`⚠️ ${prev} davri uchun hisobot yozuvi umuman yo‘q.`);

        const lines = [
          risks.length ? 'Aniqlangan risklar:' : '✅ Tizimda ochiq huquqiy risk topilmadi.',
          ...risks.map((r) => `  ${r}`),
          '',
          'Doimiy tekshiruv ro‘yxati:',
          ...CHECKLIST.map((c) => `  ☐ ${c.title} — ${c.hint}`),
          '',
          'Eslatma: bu yuridik maslahat emas. Muhim qarorlarni yurist bilan tasdiqlang.',
        ];
        return { text: lines.join('\n'), data: { risks, checklist: CHECKLIST } };
      },
    },
    {
      name: 'ask',
      usage: 'yurist ask "<savol>"',
      about: 'Savol bo‘yicha bazadagi yozuvlar asosida javob.',
      run: async (ctx, argv) => {
        const q = parseArgs(argv).rest(0).trim();
        if (!q) return { text: 'Savol kerak: yurist ask "Ijara shartnomasini qanday bekor qilaman?"' };
        const notes = ctx.db.all<LegalNote>(`SELECT * FROM legal_notes ORDER BY updated_at DESC LIMIT 20`);
        const facts = notes.map((n) => `${n.topic}: ${n.summary}`);
        const res = await ctx.llm.run({
          kind: 'advise',
          topic: `Yuridik savol: ${q}`,
          facts: facts.length ? facts : ['Bilimlar bazasi bo‘sh — umumiy tamoyillardan boshqa asos yo‘q.'],
          question: `${q}\nFaqat berilgan yozuvlarga tayan. Qonun moddasini o‘ylab topma.`,
        });
        return { text: `${res.text}\n\n⚖️ Bu yuridik maslahat emas — yakuniy qarorni yurist bilan tasdiqlang.` };
      },
    },
  ],

  jobs: [
    {
      name: 'yurist.haftalik',
      cron: '0 10 * * 1',
      run: (ctx) => {
        const late = openReports(ctx).filter((r) => r.due_at && new Date(r.due_at) < ctx.now);
        return late.length ? `${late.length} ta muddati o‘tgan hisobot` : 'risk yo‘q';
      },
    },
  ],
};

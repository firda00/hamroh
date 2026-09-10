/**
 * NEMO Marketing Employee v1 — mijozga ko'rsatish uchun demo.
 *
 *   node scripts/demo-rol.ts
 *
 * Alohida bazada ishlaydi (out/demo-rol.db) — haqiqiy ma'lumotingizga tegmaydi.
 * Har safar toza boshlanadi, shuning uchun ko'rsatuvni istalgancha takrorlash mumkin.
 *
 * Ssenariy 7 sahnadan iborat va har biri bitta savolga javob beradi:
 *   1. Bu kim?                     — rol tavsifi
 *   2. Nimaga ruxsati bor?         — ruxsatlar jadvali
 *   3. Ishga tushiramiz            — rolni yoqish
 *   4. Bir kunlik ish              — ish oqimi
 *   5. Ruxsatsiz nima bo'ladi?     — taqiq amalda
 *   6. Tasdiq qanday ishlaydi?     — navbat, ko'rish, tasdiq/rad
 *   7. Natija qanday o'lchanadi?   — KPI va o'zgarmas jurnal
 */

import { rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve('./out');
const DB = resolve('./out/demo-rol.db');
mkdirSync(OUT, { recursive: true });
rmSync(DB, { force: true });
rmSync(`${DB}-wal`, { force: true });
rmSync(`${DB}-shm`, { force: true });

process.env['HAMROH_DB'] = DB;
process.env['HAMROH_TZ'] ??= 'Asia/Tashkent';
// Ko'rsatuv paytida texnik log satrlari chalg'itmasin
process.env['HAMROH_LOG'] ??= 'error';

const { createCtx } = await import('../src/core/context.ts');
const { marketingEmployee } = await import('../src/roles/packs/marketing-employee.ts');
const { runWorkflow, runStep, approve, reject, pendingApprovals } = await import('../src/roles/runner.ts');
const { evaluateAll, scoreOf, ICON, formatKpi } = await import('../src/roles/kpi.ts');
const { verifyChain, recent } = await import('../src/roles/audit.ts');
const { rolesModule } = await import('../src/modules/roles.ts');
const { dateKey, addDays } = await import('../src/util/date.ts');
const { table } = await import('../src/util/fmt.ts');
const { closeHttp } = await import('../src/util/http.ts');

const ctx = await createCtx();
const pack = marketingEmployee;
const tz = ctx.cfg.tz;

const cmd = (name: string) => {
  const c = rolesModule.commands.find((x) => x.name === name);
  if (!c) throw new Error(`buyruq yo‘q: ${name}`);
  return c;
};

const line = (ch = '─'): void => console.log(ch.repeat(74));
function scene(n: number, title: string, question: string): void {
  console.log('');
  line('━');
  console.log(`  ${n}. ${title.toUpperCase()}`);
  console.log(`     ${question}`);
  line('━');
  console.log('');
}

// ------------------------------------------------------ demo ma'lumot

/**
 * Ikki haftalik ishonarli raqamlar. Ataylab «ideal emas»: ikkinchi haftada
 * xarajat o'sib, lid kamayadi — shunda rolning tahlili ko'rinadi.
 */
function seed(): void {
  const put = (daysAgo: number, platform: string, metric: string, value: number): void => {
    ctx.db.run(
      `INSERT INTO marketing_metrics(date, platform, metric, value, account) VALUES(?,?,?,?,'main')
       ON CONFLICT(date, platform, metric, account) DO UPDATE SET value = excluded.value`,
      dateKey(addDays(ctx.now, -daysAgo), tz),
      platform,
      metric,
      value,
    );
  };

  for (let d = 13; d >= 0; d--) {
    const secondWeek = d < 7;
    const wobble = 1 + ((d * 37) % 17) / 100; // takrorlanadigan, lekin bir xil emas

    // Instagram — qamrov barqaror
    put(d, 'instagram', 'reach', Math.round((secondWeek ? 5400 : 5900) * wobble));
    put(d, 'instagram', 'views', Math.round(1800 * wobble));

    // Google Ads — ikkinchi haftada qimmatlashdi
    put(d, 'google_ads', 'cost', Math.round((secondWeek ? 190_000 : 140_000) * wobble));
    put(d, 'google_ads', 'clicks', Math.round((secondWeek ? 52 : 61) * wobble));
    put(d, 'google_ads', 'views', Math.round(4200 * wobble));
    put(d, 'google_ads', 'leads', secondWeek ? 3 : 5);

    // YouTube
    put(d, 'youtube', 'views', Math.round(760 * wobble));
    put(d, 'youtube', 'watch_time', Math.round(2100 * wobble));

    // Google Business
    put(d, 'gbp', 'calls', secondWeek ? 4 : 6);
    put(d, 'gbp', 'routes', Math.round(11 * wobble));
  }

  const names = ['Aziz', 'Dilnoza', 'Sardor', 'Malika', 'Jasur', 'Nigora', 'Bekzod', 'Kamola'];
  const sources = ['instagram', 'google_ads', 'gbp', 'youtube'];
  for (let i = 0; i < 24; i++) {
    ctx.db.run(
      `INSERT INTO leads(created_at, name, phone, source, status) VALUES(?,?,?,?,?)`,
      addDays(ctx.now, -(i % 13)).toISOString(),
      `${names[i % names.length]} ${i + 1}`,
      `+9989${String(10_000_000 + i * 7919).slice(0, 8)}`,
      sources[i % sources.length],
      i % 4 === 0 ? 'sotildi' : i % 3 === 0 ? 'aloqada' : 'yangi',
    );
  }
}

// ---------------------------------------------------------------- ssenariy

console.log('');
console.log('   ╔════════════════════════════════════════════════════════════════════╗');
console.log('   ║   NEMO Marketing Employee v1  —  demo                              ║');
console.log('   ║   Sun’iy intellekt xodimi: har kuni ishlaydi, natijani ko‘rsatadi  ║');
console.log('   ╚════════════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`   Baza: ${DB}  (demo uchun alohida — haqiqiy ma’lumotga tegmaydi)`);

seed();
console.log(`   Ikki haftalik marketing raqamlari va 24 ta lid yuklandi.`);

// ---- 1
scene(1, 'Bu kim', 'Rolning vazifasi va chegarasi');
console.log(`${pack.name} ${pack.version}`);
console.log(pack.mission);
console.log('');
console.log('QILADI:');
for (const d of pack.does) console.log(`   ✅ ${d}`);
console.log('');
console.log('QILMAYDI:');
for (const d of pack.doesNot) console.log(`   🚫 ${d}`);

// ---- 2
scene(2, 'Nimaga ruxsati bor', 'Ruxsat berilmagan hamma narsa taqiqlangan');
const auto = pack.permissions.filter((p) => p.mode === 'auto');
const appr = pack.permissions.filter((p) => p.mode === 'approval');
const deny = pack.permissions.filter((p) => p.mode === 'deny');
console.log(
  table(
    ['Amal', 'Rejim', 'Nega'],
    [
      ...auto.slice(0, 5).map((p) => [p.action, 'o‘zi bajaradi', p.why]),
      ['…', `yana ${auto.length - 5} ta o‘qish amali`, ''],
      ...appr.map((p) => [p.action, '⏸ tasdiq so‘raydi', p.why]),
      ...deny.map((p) => [p.action, '🚫 taqiq', p.why]),
    ],
  ),
);

// ---- 3
scene(3, 'Ishga tushiramiz', 'Rol o‘z-o‘zidan ishlamaydi — uni siz yoqasiz');
console.log((await cmd('yoq').run(ctx, [pack.id])).text);

// ---- 4
scene(4, 'Bir kunlik ish', 'Ish oqimi: nimani o‘zi qiladi, qayerda to‘xtaydi');
const outcomes = await runWorkflow(ctx, pack, { force: true });
const ICONS: Record<string, string> = {
  bajarildi: '✅',
  tasdiq_kutmoqda: '⏸',
  bloklandi: '🚫',
  xato: '❌',
  rad_etildi: '✖',
  'o‘tkazildi': '·',
};
console.log(
  table(
    ['Qadam', 'Nima qildi', 'Natija'],
    outcomes.map((o) => [`${ICONS[o.status] ?? '·'} ${o.title}`, o.action, o.summary.slice(0, 52)]),
  ),
);
const files = outcomes.flatMap((o) => o.files ?? []);
if (files.length) {
  console.log('');
  console.log('Tayyor fayllar:');
  for (const f of files) console.log(`   📄 ${f}`);
}

// ---- 5
scene(5, 'Ruxsatsiz nima bo‘ladi', 'Taqiq — ogohlantirish emas, to‘xtatish');
console.log('Rolga SMS yuborishni buyuramiz (ruxsat ro‘yxatida — taqiq):');
console.log('');
const blocked = await runStep(ctx, pack, {
  id: 'demo-sms',
  title: 'Mijozlarga SMS',
  action: 'aloqa:sms',
  args: ['+998901234567', 'Chegirma!'],
  produces: 'SMS',
});
console.log(`   ${ICONS[blocked.status]} ${blocked.status.toUpperCase()} — ${blocked.summary}`);
console.log('');
const smsSent = ctx.db.all(`SELECT * FROM messages WHERE direction='out'`).length;
console.log(`   SMS navbatiga tushgan xabarlar: ${smsSent} ta  ← ya’ni hech narsa yuborilmadi`);

// ---- 6
scene(6, 'Tasdiq qanday ishlaydi', 'Tashqariga chiqadigan har bir amal — sizning qaroringiz');
const queue = pendingApprovals(ctx, pack.id);
console.log(
  table(
    ['#', 'Amal', 'Nima bo‘ladi', 'Nega to‘xtadi'],
    queue.map((q) => [String(q.id), q.action, q.preview ?? '—', q.reason]),
  ),
);

const meeting = queue.find((q) => q.action === 'kalendar:add');
const message = queue.find((q) => q.action === 'telegram:send');

if (meeting) {
  console.log('');
  console.log(`Uchrashuvni TASDIQLAYMIZ (#${meeting.id}):`);
  const done = await approve(ctx, pack, meeting.id, 'Firdavs');
  console.log(`   ${ICONS[done.status]} ${done.summary}`);
}
if (message) {
  console.log('');
  console.log(`Xabar yuborishni RAD ETAMIZ (#${message.id}) — hisobotni avval o‘zim ko‘raman:`);
  const no = reject(ctx, pack, message.id, 'Firdavs', 'avval o‘zim ko‘rib chiqaman');
  console.log(`   ✖ rad etildi: ${no.note}`);
}

// ---- 7
scene(7, 'Natija qanday o‘lchanadi', 'KPI va o‘chirib bo‘lmaydigan jurnal');
const to = dateKey(ctx.now, tz);
const from = dateKey(addDays(ctx.now, -6), tz);
const kpis = evaluateAll(ctx, pack, from, to, true);
const score = scoreOf(kpis);

console.log(`Davr: ${from} … ${to}`);
console.log('');
console.log(
  table(
    ['Ko‘rsatkich', 'Haqiqiy', 'Maqsad', 'Bajarildi', 'Nega muhim'],
    kpis.map((k) => [
      `${ICON[k.verdict]} ${k.title}`,
      formatKpi(k.value, k.unit),
      formatKpi(k.target, k.unit),
      k.attainment === null ? '—' : `${k.attainment}%`,
      k.why.slice(0, 44),
    ]),
  ),
);
console.log('');
console.log(
  score.percent === null
    ? 'Baho: ma’lumot yetarli emas.'
    : `Umumiy baho: ${score.good}/${score.measured} ko‘rsatkich maqsadda (${score.percent}%).`,
);

console.log('');
console.log('Rol nima qilganining to‘liq tarixi:');
console.log('');
const log = recent(ctx.db, 12, pack.id).reverse();
console.log(
  table(
    ['Kim', 'Hodisa', 'Nima ustida'],
    log.map((e) => [e.actor, e.event, e.subject ?? '—']),
  ),
);

const chain = verifyChain(ctx.db);
console.log('');
console.log(`   ${chain.ok ? '✅' : '❌'} Jurnal zanjiri: ${chain.checked} ta yozuv tekshirildi.`);

// Soxtalashtirishga urinib ko'ramiz — mijoz shuni ko'rishi kerak
console.log('');
console.log('   Endi jurnalni «tuzatib» ko‘ramiz — go‘yo tasdiqni odam emas, agent bergan:');
ctx.db.run(`UPDATE audit_events SET actor='agent' WHERE event='tasdiq.berildi'`);
const broken = verifyChain(ctx.db);
console.log(
  broken.ok
    ? '   ⚠️ o‘zgarish sezilmadi'
    : `   ❌ ZANJIR UZILDI — yozuv #${broken.brokenAt?.id}: ${broken.brokenAt?.reason}`,
);
console.log('');
console.log('   Ya’ni jurnalni bildirmay tahrirlab bo‘lmaydi. Auditor uchun asosiy narsa shu.');

line('━');
console.log('');
console.log('  Xulosa:');
console.log('   • Kundalik ish o‘zi bajariladi — hisobot ertalab tayyor turadi');
console.log('   • Tashqariga chiqadigan har bir amal sizning tasdig‘ingizni kutadi');
console.log('   • Ruxsat ro‘yxatidan tashqari hech narsa bajarilmaydi');
console.log('   • Har bir harakat o‘zgartirib bo‘lmaydigan jurnalda qoladi');
console.log('   • Natija KPI bilan o‘lchanadi, ma’lumot yo‘q bo‘lsa — shunday deb yoziladi');
console.log('');
console.log(`  Batafsil: docs/ROLES.md   ·   Demo bazasi: ${DB}`);
console.log('');

ctx.db.close();
await closeHttp();

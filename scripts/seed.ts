import { createCtx } from '../src/core/context.ts';
import { addDays, dateKey, monthKey, startOfDay } from '../src/util/date.ts';

/**
 * Namunaviy ma'lumot — tizimni darhol "tirik" ko'rish uchun.
 * Ishga tushirish:  npm run seed
 */

const ctx = await createCtx();
const { db, cfg, now } = ctx;
const iso = (d: Date): string => d.toISOString();
const day = (n: number): string => dateKey(addDays(now, n), cfg.tz);

db.tx(() => {
  db.exec(
    `DELETE FROM tasks; DELETE FROM events; DELETE FROM ledger; DELETE FROM leads;
     DELETE FROM recurring; DELETE FROM sales; DELETE FROM products;
     DELETE FROM marketing_metrics; DELETE FROM health_metrics; DELETE FROM calls;
     DELETE FROM legal_notes; DELETE FROM acct_reports;`,
  );

  // (3) Vazifalar
  const at = (h: number, m = 0, d = 0): string =>
    iso(new Date(startOfDay(addDays(now, d), cfg.tz).getTime() + (h * 60 + m) * 60_000));
  const tasks: [string, string, number, string][] = [
    ['Bank hujjatlarini topshirish', at(10), 1, 'ish'],
    ['Yangi kurs uchun kontent yozish', at(14, 30), 2, 'marketing'],
    ['Xodimlar bilan yig‘ilish', at(16), 2, 'ish'],
    ['Ijara shartnomasini yangilash', at(11, 0, 2), 3, 'yuridik'],
    ['Sport zal', at(19), 4, 'shaxsiy'],
  ];
  for (const [title, due, pr, cat] of tasks) {
    db.run(`INSERT INTO tasks(title, due_at, priority, category, created_at) VALUES(?,?,?,?,?)`, title, due, pr, cat, iso(now));
  }
  db.run(
    `INSERT INTO tasks(title, due_at, priority, category, created_at, status, completed_at) VALUES(?,?,?,?,?,?,?)`,
    'Soliq inspeksiyasiga xat',
    at(9, 0, -1),
    1,
    'ish',
    iso(addDays(now, -1)),
    'done',
    iso(addDays(now, -1)),
  );

  // (4) Uchrashuvlar
  db.run(`INSERT INTO events(title, start_at, end_at, location, attendees) VALUES(?,?,?,?,?)`,
    'Investor bilan uchrashuv', at(15), at(16), 'Ofis, 3-qavat', 'Sardor aka');
  db.run(`INSERT INTO events(title, start_at, end_at, location) VALUES(?,?,?,?)`,
    'Yetkazib beruvchi bilan', at(11, 0, 1), at(12, 0, 1), 'Zoom');

  // (5) Kirim-chiqim
  const entries: [number, 'income' | 'expense', number, string, string, string][] = [
    [-6, 'income', 12_000_000, 'savdo', 'Kurs to‘lovi', 'kerak'],
    [-5, 'expense', 3_200_000, 'reklama', 'Instagram reklama', 'kerak'],
    [-4, 'income', 8_500_000, 'savdo', 'Kurs to‘lovi', 'kerak'],
    [-3, 'expense', 1_100_000, 'ovqat', 'Restoran', 'kerakmas'],
    [-2, 'income', 15_000_000, 'savdo', 'Korporativ shartnoma', 'kerak'],
    [-1, 'expense', 5_000_000, 'arenda', 'Ofis ijarasi', 'kerak'],
    [0, 'income', 4_200_000, 'savdo', 'Kurs to‘lovi', 'kerak'],
    [0, 'expense', 850_000, 'transport', 'Yoqilg‘i', 'kerak'],
    [0, 'expense', 420_000, 'ovqat', 'Yetkazib berish', 'kerakmas'],
  ];
  for (const [d, kind, amount, cat, note, need] of entries) {
    db.run(
      `INSERT INTO ledger(ts, kind, amount, currency, category, note, source, necessity) VALUES(?,?,?,?,?,?,?,?)`,
      iso(addDays(now, d)), kind, amount, cfg.currency, cat, note, 'manual', need,
    );
  }
  db.run(`INSERT INTO budgets(category, month, limit_amount, currency) VALUES(?,?,?,?)`,
    'ovqat', monthKey(now, cfg.tz), 2_000_000, cfg.currency);

  // (12) Oylik to‘lovlar
  const recurring: [string, number, number, string][] = [
    ['Ofis arendasi', 5_000_000, 5, 'arenda'],
    ['Internet va aloqa', 450_000, 10, 'kommunal'],
    ['Buxgalter xizmati', 1_500_000, 15, 'xizmat'],
    ['CRM obunasi', 390_000, 20, 'obuna'],
  ];
  for (const [title, amount, dayOf, cat] of recurring) {
    db.run(`INSERT INTO recurring(title, amount, currency, day_of_month, category) VALUES(?,?,?,?,?)`,
      title, amount, cfg.currency, dayOf, cat);
  }

  // (6) Buxgalteriya
  db.run(`INSERT INTO acct_reports(period, kind, status, due_at) VALUES(?,?,?,?)`,
    monthKey(addDays(now, -32), cfg.tz), 'soliq', 'kutilmoqda', at(18, 0, 3));

  // (8) Lidlar
  const leads: [number, string, string, string, string][] = [
    [-2, 'Aziz aka', '+998901112233', 'instagram', 'sotildi'],
    [-1, 'Dilnoza', '+998935556677', 'google', 'aloqada'],
    [-1, 'Bekzod', '+998977778899', '2gis', 'yangi'],
    [0, 'Nodira opa', '+998901234567', 'instagram', 'yangi'],
    [0, 'Sardor', '+998939998877', 'telegram', 'aloqada'],
  ];
  for (const [d, name, phone, source, status] of leads) {
    db.run(`INSERT INTO leads(created_at, name, phone, source, status, amount) VALUES(?,?,?,?,?,?)`,
      iso(addDays(now, d)), name, phone, source, status, status === 'sotildi' ? 4_500_000 : null);
  }

  // (14) Mahsulotlar va sotuvlar
  const products: [string, string, number, number][] = [
    ['Boshlang‘ich kurs', 'kurs', 800_000, 2_500_000],
    ['Pro kurs', 'kurs', 1_500_000, 6_000_000],
    ['Individual mentorlik', 'xizmat', 2_000_000, 9_000_000],
  ];
  for (const [name, cat, cost, price] of products) {
    db.run(`INSERT INTO products(name, category, cost_price, sell_price) VALUES(?,?,?,?)`, name, cat, cost, price);
  }
  const sales: [number, number, number][] = [[1, 4, -5], [2, 2, -3], [1, 3, -1], [3, 1, 0], [2, 1, 0]];
  for (const [pid, qty, d] of sales) {
    const p = db.get<{ sell_price: number }>(`SELECT sell_price FROM products WHERE id=?`, pid);
    db.run(`INSERT INTO sales(ts, product_id, qty, unit_price, channel) VALUES(?,?,?,?,?)`,
      iso(addDays(now, d)), pid, qty, p?.sell_price ?? 0, 'ofis');
  }

  // (13) Marketing
  const plat: Record<string, Record<string, number>> = {
    instagram: { reach: 14_000, clicks: 620, leads: 12, followers: 40 },
    google_ads: { clicks: 480, cost: 2_400_000, leads: 9 },
    '2gis': { views: 3_100, routes: 88, calls: 21 },
    gbp: { views: 2_400, calls: 15, routes: 40 },
    youtube: { views: 8_900, watch_time: 320, followers: 25 },
  };
  for (let d = -13; d <= 0; d++) {
    const wobble = 0.75 + ((d + 14) % 5) * 0.12;
    for (const [platform, metrics] of Object.entries(plat)) {
      for (const [metric, base] of Object.entries(metrics)) {
        db.run(
          `INSERT INTO marketing_metrics(date, platform, metric, value) VALUES(?,?,?,?)
           ON CONFLICT(date, platform, metric, account) DO UPDATE SET value=excluded.value`,
          day(d), platform, metric, Math.round((base / 14) * wobble),
        );
      }
    }
  }

  // (15) Sog‘liq
  for (let d = -6; d <= 0; d++) {
    db.run(`INSERT INTO health_metrics(ts, kind, value, unit, source) VALUES(?,?,?,?,?)`,
      iso(addDays(now, d)), 'steps', 6000 + ((d + 7) % 4) * 1200, 'qadam', 'watch');
    db.run(`INSERT INTO health_metrics(ts, kind, value, unit, source) VALUES(?,?,?,?,?)`,
      iso(addDays(now, d)), 'sleep', 6 + ((d + 7) % 3) * 0.5, 'soat', 'watch');
  }

  // (11) Qo‘ng‘iroqlar
  db.run(`INSERT INTO calls(ts, direction, phone, name, callback_needed) VALUES(?,?,?,?,1)`,
    iso(addDays(now, 0)), 'missed', '+998901234567', 'Nodira opa');
  db.run(`INSERT INTO calls(ts, direction, phone, duration_sec) VALUES(?,?,?,?)`,
    iso(addDays(now, 0)), 'in', '+998935556677', 240);

  // (7) Yuridik yozuvlar
  db.run(`INSERT INTO legal_notes(topic, summary, tags, updated_at) VALUES(?,?,?,?)`,
    'Ofis ijara shartnomasi', 'Muddat 12 oy, bekor qilish uchun 30 kun oldin yozma ogohlantirish.', 'ijara,shartnoma', iso(now));
});

console.log('✅ Namunaviy ma’lumot yuklandi.');
console.log('   Sinab ko‘ring:  npm run hamroh -- tong');
ctx.db.close();

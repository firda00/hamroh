/**
 * Butun ma'lumotlar bazasi sxemasi.
 * Har bir jadval yonida u qaysi talab raqamiga tegishli ekani ko'rsatilgan (docs/MODULES.md).
 * Hamma narsa IF NOT EXISTS — qayta ishga tushirish xavfsiz.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- (3) Kunlik vazifalar va eslatmalar
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  notes        TEXT,
  due_at       TEXT,
  priority     INTEGER NOT NULL DEFAULT 3,
  status       TEXT NOT NULL DEFAULT 'open',
  category     TEXT NOT NULL DEFAULT 'ish',
  est_minutes  INTEGER,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at);

-- (12) Har oylik doimiy to'lovlar: arenda, kommunal, obunalar
CREATE TABLE IF NOT EXISTS recurring (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT NOT NULL,
  amount           REAL NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'UZS',
  day_of_month     INTEGER NOT NULL,
  category         TEXT NOT NULL DEFAULT 'majburiy',
  active           INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  last_paid_period TEXT
);

-- (5) Kirim-chiqim daftari
CREATE TABLE IF NOT EXISTS ledger (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  kind         TEXT NOT NULL,
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'UZS',
  category     TEXT NOT NULL DEFAULT 'boshqa',
  counterparty TEXT,
  note         TEXT,
  source       TEXT NOT NULL DEFAULT 'manual',
  necessity    TEXT NOT NULL DEFAULT 'kerak'
);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger(ts);

CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category     TEXT NOT NULL,
  month        TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'UZS',
  UNIQUE(category, month)
);

-- (6) Buxgalteriya hisobotlari
CREATE TABLE IF NOT EXISTS acct_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'kutilmoqda',
  due_at      TEXT,
  received_at TEXT,
  file_path   TEXT,
  amount      REAL,
  notes       TEXT
);

-- (4) Uchrashuvlar va kalendar
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  start_at    TEXT NOT NULL,
  end_at      TEXT,
  location    TEXT,
  attendees   TEXT,
  notes       TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  status      TEXT NOT NULL DEFAULT 'rejada'
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);

-- (8) Yangi lidlar
CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name       TEXT NOT NULL,
  phone      TEXT,
  source     TEXT NOT NULL DEFAULT 'boshqa',
  status     TEXT NOT NULL DEFAULT 'yangi',
  note       TEXT,
  owner      TEXT,
  amount     REAL
);

-- (11) Qo'ng'iroqlar va SMS
CREATE TABLE IF NOT EXISTS calls (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  direction       TEXT NOT NULL,
  phone           TEXT NOT NULL,
  name            TEXT,
  duration_sec    INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  callback_needed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,
  channel     TEXT NOT NULL,
  direction   TEXT NOT NULL,
  peer        TEXT NOT NULL,
  body        TEXT NOT NULL,
  handled     INTEGER NOT NULL DEFAULT 0,
  external_id TEXT
);

-- (15) Sog'liq ko'rsatkichlari
CREATE TABLE IF NOT EXISTS health_metrics (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL,
  kind   TEXT NOT NULL,
  value  REAL NOT NULL,
  unit   TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE INDEX IF NOT EXISTS idx_health_ts ON health_metrics(ts);

-- (13) Marketing ko'rsatkichlari
CREATE TABLE IF NOT EXISTS marketing_metrics (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  date     TEXT NOT NULL,
  platform TEXT NOT NULL,
  metric   TEXT NOT NULL,
  value    REAL NOT NULL,
  account  TEXT NOT NULL DEFAULT 'main',
  UNIQUE(date, platform, metric, account)
);

-- (14) Mahsulotlar va sotuvlar
CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sku        TEXT UNIQUE,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'umumiy',
  cost_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  discount   REAL NOT NULL DEFAULT 0,
  channel    TEXT NOT NULL DEFAULT 'ofis'
);
CREATE INDEX IF NOT EXISTS idx_sales_ts ON sales(ts);

-- (1) Yangiliklar keshi
CREATE TABLE IF NOT EXISTS news_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fetched_at   TEXT NOT NULL,
  published_at TEXT,
  source       TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'umumiy',
  title        TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  summary      TEXT,
  lang         TEXT NOT NULL DEFAULT 'uz'
);

-- (2) Kurs va ob-havo suratlari
CREATE TABLE IF NOT EXISTS market_snapshot (
  date    TEXT PRIMARY KEY,
  usd_uzs REAL,
  eur_uzs REAL,
  rub_uzs REAL,
  brent   REAL,
  gold    REAL,
  note    TEXT
);

CREATE TABLE IF NOT EXISTS weather_snapshot (
  date      TEXT NOT NULL,
  city      TEXT NOT NULL,
  temp_min  REAL,
  temp_max  REAL,
  condition TEXT,
  wind      REAL,
  humidity  REAL,
  PRIMARY KEY (date, city)
);

-- (7) Yuridik bilimlar bazasi
CREATE TABLE IF NOT EXISTS legal_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  topic        TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'UZ',
  summary      TEXT NOT NULL,
  source       TEXT,
  tags         TEXT,
  updated_at   TEXT NOT NULL
);

-- Eslatmalar navbati: barcha modullar shu yerga yozadi
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  deliver_at TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT 'console',
  module     TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'kutilmoqda',
  dedupe_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_notif_deliver ON notifications(status, deliver_at);

-- Tasdiq kutayotgan amallar (Telegram tugmalari uchun)
CREATE TABLE IF NOT EXISTS pending_actions (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'kutilmoqda'
);

-- Kunlik hisobot suratlari: o'sish darajasini hisoblash uchun
CREATE TABLE IF NOT EXISTS daily_reports (
  date       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, kind)
);

-- Job tarixi: scheduler ikki marta ishlab ketmasligi uchun
CREATE TABLE IF NOT EXISTS job_runs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job     TEXT NOT NULL,
  slot    TEXT NOT NULL,
  ran_at  TEXT NOT NULL,
  ok      INTEGER NOT NULL DEFAULT 1,
  message TEXT,
  UNIQUE(job, slot)
);
`;

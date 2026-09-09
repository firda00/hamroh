import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema.ts';

export type Row = Record<string, unknown>;

export type Db = {
  raw: DatabaseSync;
  all: <T = Row>(sql: string, ...params: unknown[]) => T[];
  get: <T = Row>(sql: string, ...params: unknown[]) => T | undefined;
  run: (sql: string, ...params: unknown[]) => { changes: number; lastInsertRowid: number };
  exec: (sql: string) => void;
  tx: <T>(fn: () => T) => T;
  close: () => void;
};

type Param = string | number | bigint | null | Uint8Array;

const norm = (params: unknown[]): Param[] =>
  params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'object') return JSON.stringify(p);
    return p as Param;
  });

/**
 * Ustun qo'shish migratsiyasi.
 * CREATE TABLE IF NOT EXISTS mavjud jadvalga yangi ustun qo'shmaydi — shuning uchun
 * sxema o'sganda eski bazalar shu yerda yangilanadi.
 */
function addColumns(raw: DatabaseSync, table: string, columns: Record<string, string>): void {
  const existing = new Set(
    (raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec(SCHEMA);

  // Ovozli xabarlar uchun (v0.2)
  addColumns(raw, 'messages', {
    media_kind: 'TEXT',
    media_id: 'TEXT',
    duration_sec: 'INTEGER',
    transcribed_at: 'TEXT',
    status: "TEXT NOT NULL DEFAULT 'navbatda'",
    sent_at: 'TEXT',
    error: 'TEXT',
  });

  return {
    raw,
    all: <T = Row>(sql: string, ...params: unknown[]) => raw.prepare(sql).all(...norm(params)) as T[],
    get: <T = Row>(sql: string, ...params: unknown[]) => raw.prepare(sql).get(...norm(params)) as T | undefined,
    run: (sql: string, ...params: unknown[]) => {
      const r = raw.prepare(sql).run(...norm(params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec: (sql: string) => raw.exec(sql),
    tx: <T>(fn: () => T): T => {
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => raw.close(),
  };
}

/** settings jadvalidagi kalit-qiymat juftligi. */
export const setting = {
  get: (db: Db, key: string, def = ''): string => {
    const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return row?.value ?? def;
  },
  set: (db: Db, key: string, value: string): void => {
    db.run(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  },
};

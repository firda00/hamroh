import type { Ctx } from './types.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { openDb } from './db.ts';
import { makeLlm } from '../llm/index.ts';

/** Bitta joyda: .env → config → baza → LLM. */
export async function createCtx(now = new Date()): Promise<Ctx> {
  await loadDotEnv('.env');
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  return { cfg, db, llm: makeLlm(cfg), now };
}

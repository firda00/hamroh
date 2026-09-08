import type { Ctx } from './types.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { openDb } from './db.ts';
import { makeLlm } from '../llm/index.ts';
import { makeStt } from '../stt/index.ts';
import { makeTts } from '../tts/index.ts';
import { makeTel } from '../tel/index.ts';

/** Bitta joyda: .env → config → baza → LLM. */
export async function createCtx(now = new Date()): Promise<Ctx> {
  await loadDotEnv('.env');
  const cfg = loadConfig();
  const db = openDb(cfg.dbPath);
  return { cfg, db, llm: makeLlm(cfg), stt: makeStt(cfg), tts: makeTts(cfg), tel: makeTel(cfg), now };
}

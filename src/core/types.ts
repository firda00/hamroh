import type { Config } from './config.ts';
import type { Db } from './db.ts';
import type { LlmProvider } from '../llm/provider.ts';

export type Ctx = {
  cfg: Config;
  db: Db;
  llm: LlmProvider;
  now: Date;
};

export type CommandResult = {
  /** Terminalda ko'rsatiladigan matn. */
  text: string;
  /** Mashina o'qiy oladigan natija (API/JSON uchun). */
  data?: unknown;
  /** Yaratilgan fayllar. */
  files?: string[];
};

export type Command = {
  name: string;
  usage: string;
  about: string;
  run: (ctx: Ctx, args: string[]) => Promise<CommandResult> | CommandResult;
};

export type BriefSection = {
  /** Kichikroq raqam = yuqoriroq turadi. */
  order: number;
  title: string;
  lines: string[];
  /** Diqqat talab qiladigan holat. */
  alert?: boolean;
};

export type Job = {
  name: string;
  /** cron: "min soat kun oy hafta" (5 maydon). */
  cron: string;
  run: (ctx: Ctx) => Promise<string> | string;
};

export type Module = {
  id: string;
  title: string;
  about: string;
  commands: Command[];
  jobs?: Job[];
  /** Kunlik brifingga qo'shiladigan bo'lim. */
  morning?: (ctx: Ctx) => Promise<BriefSection | null> | BriefSection | null;
  evening?: (ctx: Ctx) => Promise<BriefSection | null> | BriefSection | null;
};

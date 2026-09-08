export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env['HAMROH_LOG'] as Level) ?? 'info'] ?? 20;
const ESC = String.fromCharCode(27);

const paint = (l: Level, s: string): string => {
  if (!process.stdout.isTTY) return s;
  const c: Record<Level, string> = { debug: '90', info: '36', warn: '33', error: '31' };
  return `${ESC}[${c[l]}m${s}${ESC}[0m`;
};

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < min) return;
  const time = new Date().toISOString().slice(11, 19);
  const head = paint(level, `${time} ${level.toUpperCase().padEnd(5)} [${scope}]`);
  if (extra === undefined) console.error(`${head} ${msg}`);
  else console.error(`${head} ${msg}`, extra);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => emit('debug', scope, m, e),
    info: (m: string, e?: unknown) => emit('info', scope, m, e),
    warn: (m: string, e?: unknown) => emit('warn', scope, m, e),
    error: (m: string, e?: unknown) => emit('error', scope, m, e),
  };
}

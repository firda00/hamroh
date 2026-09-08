/** CLI argumentlarini ajratish: pozitsion qiymatlar + --flag=qiymat. */

export type Args = {
  positional: string[];
  flags: Record<string, string>;
  has: (name: string) => boolean;
  str: (name: string, def?: string) => string;
  num: (name: string, def?: number) => number;
  at: (i: number, def?: string) => string;
  /** Barcha qolgan pozitsion qiymatlarni bitta matn qilib qo'shadi. */
  rest: (from: number) => string;
};

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[body] = next;
          i++;
        } else {
          flags[body] = 'true';
        }
      }
    } else {
      positional.push(a);
    }
  }

  return {
    positional,
    flags,
    has: (n) => flags[n] !== undefined,
    str: (n, def = '') => flags[n] ?? def,
    num: (n, def = 0) => {
      const v = flags[n];
      if (v === undefined) return def;
      const cleaned = Number(v.replace(/[\s_]/g, '').replace(',', '.'));
      return Number.isFinite(cleaned) ? cleaned : def;
    },
    at: (i, def = '') => positional[i] ?? def,
    rest: (from) => positional.slice(from).join(' '),
  };
}

/** "1 200 000", "1.2mln", "350k" kabi summalarni raqamga o'giradi. */
export function parseAmount(input: string): number {
  const s = input.toLowerCase().replace(/\s|_/g, '').replace(',', '.');
  const m = s.match(/^(-?[\d.]+)\s*(k|ming|mln|m|mlrd)?$/);
  if (!m) return Number(s) || 0;
  const n = Number(m[1]) || 0;
  const mult = { k: 1e3, ming: 1e3, mln: 1e6, m: 1e6, mlrd: 1e9 }[m[2] ?? ''] ?? 1;
  return n * mult;
}

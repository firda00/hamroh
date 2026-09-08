/** Matn formatlash yordamchilari: pul, foiz, jadval, mini-diagramma. */

export function money(amount: number, currency = 'UZS'): string {
  const rounded = Math.round(amount * 100) / 100;
  const grouped = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rounded);
  return `${grouped} ${currency}`;
}

export function compact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${(amount / 1e9).toFixed(1)} mlrd`;
  if (abs >= 1e6) return `${(amount / 1e6).toFixed(1)} mln`;
  if (abs >= 1e3) return `${(amount / 1e3).toFixed(1)} ming`;
  return String(Math.round(amount));
}

/** O'sish darajasi: oldingi -> hozirgi. */
export function growth(prev: number, cur: number): { pct: number | null; text: string; up: boolean } {
  if (prev === 0) {
    if (cur === 0) return { pct: 0, text: 'o‘zgarishsiz', up: false };
    return { pct: null, text: 'yangi (avval 0 edi)', up: cur > 0 };
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '=';
  return { pct, text: `${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, up: pct >= 0 };
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** Terminal uchun oddiy jadval. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const all = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
  const line = (cells: (string | number)[]): string =>
    cells.map((c, i) => String(c ?? '').padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

/** Matnli ustun diagramma. */
export function bar(value: number, max: number, width = 24): string {
  if (max <= 0) return ''.padEnd(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function heading(title: string): string {
  return `\n${title}\n${'─'.repeat(Math.min(60, title.length + 4))}`;
}

export function bullet(lines: string[], mark = '•'): string[] {
  return lines.map((l) => `  ${mark} ${l}`);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

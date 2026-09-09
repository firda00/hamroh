/**
 * .env faylini ehtiyotkorlik bilan tahrirlash.
 *
 * Muhim: mavjud izohlar, tartib va tegilmagan kalitlar saqlanadi.
 * Sozlash ustasi faylni qaytadan yozmaydi — faqat kerakli qatorlarni almashtiradi.
 */

/** Qiymatda bo'shliq yoki maxsus belgi bo'lsa tirnoqqa oladi. */
export function quoteIfNeeded(value: string): string {
  if (value === '') return '';
  return /[\s#"'$]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * Mavjud .env matniga o'zgarishlarni qo'llaydi.
 *
 * - Kalit bor bo'lsa (izohga olingan bo'lsa ham) — qiymati almashtiriladi
 * - Yo'q bo'lsa — oxiriga qo'shiladi
 * - `undefined` qiymatli kalitlarga tegilmaydi
 */
export function applyEnv(existing: string, updates: Record<string, string | undefined>): string {
  const lines = existing.split(/\r?\n/);
  const pending = new Map(Object.entries(updates).filter(([, v]) => v !== undefined) as [string, string][]);

  const out = lines.map((line) => {
    // "# KALIT=..." ko'rinishidagi izohlangan qatorlarni ham tanaymiz
    const m = line.match(/^(\s*)(#\s*)?([A-Z_][A-Z0-9_]*)\s*=/);
    const key = m?.[3];
    if (!key || !pending.has(key)) return line;

    const value = pending.get(key) as string;
    pending.delete(key);
    return `${m?.[1] ?? ''}${key}=${quoteIfNeeded(value)}`;
  });

  if (pending.size) {
    if (out.length && out[out.length - 1]?.trim() !== '') out.push('');
    out.push('# --- sozlash ustasi qo‘shgan ---');
    for (const [key, value] of pending) out.push(`${key}=${quoteIfNeeded(value)}`);
  }

  return `${out.join('\n').replace(/\n{3,}$/, '\n\n').trimEnd()}\n`;
}

/** .env matnidan bitta kalit qiymatini o'qiydi (izohlanganini emas). */
export function readEnvValue(text: string, key: string): string {
  const m = text.match(new RegExp(`^\\s*${key}\\s*=(.*)$`, 'm'));
  if (!m?.[1]) return '';
  let v = m[1].trim();
  const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  if (quoted) v = v.slice(1, -1);
  return v.replace(/\s+#.*$/, '').trim();
}

import { logger } from '../core/logger.ts';

const log = logger('http');

export class OfflineError extends Error {
  constructor(url: string) {
    super(`Oflayn rejim: ${url} so'ralmadi`);
    this.name = 'OfflineError';
  }
}

export type FetchOpts = {
  offline?: boolean;
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
};

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  if (opts.offline) throw new OfflineError(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': 'hamroh/0.1 (+personal assistant)', ...opts.headers },
      body: opts.body,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const text = await fetchText(url, { ...opts, headers: { accept: 'application/json', ...opts.headers } });
  return JSON.parse(text) as T;
}

/** Xatoni yutib, null qaytaradi — brifing bitta manba tufayli buzilmasligi uchun. */
export async function trySoft<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    log.warn(`${label}: ${(e as Error).message}`);
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#8217': '’',
  '#8211': '–',
  '#8212': '—',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, name: string) => {
    if (ENTITIES[name]) return ENTITIES[name] as string;
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return m;
  });
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Bitta XML tegi ichidagi matnni oladi (birinchi mos keluvchi). */
export function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m?.[1]) return '';
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return decodeEntities((cdata?.[1] ?? raw).trim());
}

export type FeedItem = { title: string; url: string; summary: string; published: string };

/** RSS 2.0 va Atom feedlarini oddiy tahlil qilish. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const linkTag = tag(b, 'link');
    const href = linkTag || (b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? '');
    const title = stripTags(tag(b, 'title'));
    if (!title || !href) continue;
    out.push({
      title,
      url: decodeEntities(href),
      summary: stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 400),
      published: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'),
    });
  }
  return out;
}

/**
 * Global fetch (undici) ulanish hovuzini yopadi.
 * Bo'lmasa CLI buyrug'i keep-alive soketlar tufayli darhol chiqmaydi.
 */
export async function closeHttp(): Promise<void> {
  const key = Symbol.for('undici.globalDispatcher.1');
  const dispatcher = (globalThis as unknown as Record<symbol, { close?: () => Promise<void> } | undefined>)[key];
  try {
    await dispatcher?.close?.();
  } catch {
    // ulanish hovuzi allaqachon yopilgan bo'lsa — muammo emas
  }
}

import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { fetchText, parseFeed, trySoft } from '../util/http.ts';
import { truncate } from '../util/fmt.ts';
import { stamp } from '../util/date.ts';

/** (1) Yangiliklar: Google News RSS orqali (kalit talab qilmaydi). */

export type Feed = { url: string; source: string; category: string; lang: string };

export const DEFAULT_FEEDS: Feed[] = [
  {
    url: 'https://news.google.com/rss?hl=uz&gl=UZ&ceid=UZ:uz',
    source: 'Google News UZ',
    category: 'mahalliy',
    lang: 'uz',
  },
  {
    url: 'https://news.google.com/rss/search?q=O%27zbekiston+iqtisodiyot&hl=uz&gl=UZ&ceid=UZ:uz',
    source: 'Google News — iqtisodiyot',
    category: 'iqtisodiyot',
    lang: 'uz',
  },
  {
    url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en',
    source: 'Google News — world business',
    category: 'jahon',
    lang: 'en',
  },
  {
    url: 'https://news.google.com/rss/search?q=world+economy+markets&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News — world economy',
    category: 'jahon',
    lang: 'en',
  },
];

export type NewsItem = {
  id: number;
  fetched_at: string;
  published_at: string | null;
  source: string;
  category: string;
  title: string;
  url: string;
  summary: string | null;
  lang: string;
};

export function feeds(ctx: Ctx): Feed[] {
  const extra = ctx.cfg.extraFeeds.map((url) => ({ url, source: new URL(url).hostname, category: 'qo‘shimcha', lang: ctx.cfg.lang }));
  return [...DEFAULT_FEEDS, ...extra];
}

export async function fetchNews(ctx: Ctx, limitPerFeed = 10): Promise<number> {
  let added = 0;
  for (const f of feeds(ctx)) {
    const xml = await trySoft(f.source, () => fetchText(f.url, { offline: ctx.cfg.offline }));
    if (!xml) continue;
    for (const item of parseFeed(xml).slice(0, limitPerFeed)) {
      const r = ctx.db.run(
        `INSERT OR IGNORE INTO news_items(fetched_at, published_at, source, category, title, url, summary, lang)
         VALUES(?,?,?,?,?,?,?,?)`,
        ctx.now.toISOString(),
        item.published || null,
        f.source,
        f.category,
        item.title,
        item.url,
        item.summary || null,
        f.lang,
      );
      added += r.changes;
    }
  }
  return added;
}

export function latest(ctx: Ctx, category = '', limit = 10): NewsItem[] {
  return category
    ? ctx.db.all<NewsItem>(`SELECT * FROM news_items WHERE category=? ORDER BY id DESC LIMIT ?`, category, limit)
    : ctx.db.all<NewsItem>(`SELECT * FROM news_items ORDER BY id DESC LIMIT ?`, limit);
}

export const newsModule: Module = {
  id: 'yangilik',
  title: 'Yangiliklar',
  about: 'Google News RSS: mahalliy, iqtisodiyot va jahon yangiliklari.',

  commands: [
    {
      name: 'fetch',
      usage: 'yangilik fetch [--limit=10]',
      about: 'Manbalardan yangi materiallarni yig‘ish.',
      run: async (ctx, argv) => {
        const n = await fetchNews(ctx, parseArgs(argv).num('limit', 10));
        return { text: n ? `📰 ${n} ta yangi xabar qo‘shildi.` : 'Yangi xabar yo‘q (yoki internet mavjud emas).' };
      },
    },
    {
      name: 'list',
      usage: 'yangilik list [--cat=iqtisodiyot|mahalliy|jahon] [--limit=10]',
      about: 'Oxirgi yangiliklar.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const items = latest(ctx, a.str('cat'), a.num('limit', 10));
        if (!items.length) return { text: 'Kesh bo‘sh. Avval:  hamroh yangilik fetch' };
        return {
          text: items
            .map((n, i) => `${i + 1}. [${n.category}] ${truncate(n.title, 90)}\n   ${n.url}`)
            .join('\n'),
          data: items,
        };
      },
    },
    {
      name: 'top',
      usage: 'yangilik top [--cat=jahon] [--limit=8]',
      about: 'Muhim yangiliklarning qisqacha mazmuni.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        await fetchNews(ctx, 10);
        const items = latest(ctx, a.str('cat'), a.num('limit', 8));
        if (!items.length) return { text: 'Yangilik topilmadi.' };
        const blob = items.map((n) => `${n.title}. ${n.summary ?? ''}`).join('\n');
        const res = await ctx.llm.run({ kind: 'summarize', text: blob, maxSentences: 5, hint: 'iqtisodiyot va biznesga ta’siri' });
        return {
          text: [`Qisqacha (${items.length} xabar asosida):`, res.text, '', 'Manbalar:', ...items.map((n, i) => `  ${i + 1}. ${truncate(n.title, 80)}`)].join('\n'),
          data: items,
        };
      },
    },
    {
      name: 'sources',
      usage: 'yangilik sources',
      about: 'Ulangan manbalar ro‘yxati.',
      run: (ctx) => ({
        text: [
          ...feeds(ctx).map((f) => `  • ${f.source} [${f.category}] — ${f.url}`),
          '',
          'Qo‘shimcha manba:  .env da HAMROH_NEWS_FEEDS=https://...,https://...',
          'Twitter/X: rasmiy API pullik — RSS ko‘prigi (nitter va h.k.) havolasini shu ro‘yxatga qo‘shing.',
        ].join('\n'),
      }),
    },
  ],

  jobs: [
    {
      name: 'yangilik.fetch',
      cron: '30 7,13,19 * * *',
      run: async (ctx) => `${await fetchNews(ctx, 10)} ta yangi xabar`,
    },
  ],

  morning: async (ctx) => {
    await fetchNews(ctx, 8);
    const local = latest(ctx, 'mahalliy', 3);
    const econ = latest(ctx, 'iqtisodiyot', 2);
    const world = latest(ctx, 'jahon', 3);
    const lines = [...local, ...econ, ...world].map((n) => `[${n.category}] ${truncate(n.title, 88)}`);
    return {
      order: 20,
      title: 'Yangiliklar',
      lines: lines.length ? lines : [`Yangilik olinmadi (${stamp(ctx.now, ctx.cfg.tz)}).`],
    };
  },
};

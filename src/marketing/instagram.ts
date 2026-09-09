import type { MarketingSource, MetricPoint, PullResult } from './provider.ts';
import { disabledSource, getJson } from './provider.ts';
import { logger } from '../core/logger.ts';

/**
 * Instagram — rasmiy Graph API.
 *
 * Kerak: Instagram **Business** yoki **Creator** hisobi, Facebook sahifasiga
 * ulangan. Shaxsiy hisobda Insights API ishlamaydi — bu Meta cheklovi.
 *
 * Sozlash: docs/MARKETING.md
 *   INSTAGRAM_ACCESS_TOKEN  — uzoq muddatli token (60 kun, yangilanadi)
 *   INSTAGRAM_USER_ID       — Instagram Business hisobining ID si
 */

const log = logger('marketing');
const API = 'https://graph.facebook.com/v21.0';

/** Meta metrikalarini bizning kalitlarga solishtirish. */
const MAP: Record<string, string> = {
  reach: 'reach',
  views: 'views',
  impressions: 'views',
  profile_views: 'views',
  accounts_engaged: 'clicks',
  website_clicks: 'clicks',
  follower_count: 'followers',
};

export type InsightsResponse = {
  data?: { name: string; period: string; values: { value: number; end_time: string }[] }[];
};

type ProfileResponse = { followers_count?: number; username?: string };

const unix = (iso: string): number => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);

/**
 * `period=day` uchun Meta `end_time` beradi — bu oyna **tugagan** payt.
 * Ya'ni 2-sentabr 07:00 dagi qiymat 1-sentabr kuniga tegishli.
 */
export function dayOf(endTime: string): string {
  const d = new Date(endTime);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Meta bir so'rovda 30 kundan ko'p bermaydi. */
export function windows(from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  let cur = new Date(`${from}T00:00:00Z`);
  while (cur <= end) {
    const stop = new Date(cur);
    stop.setUTCDate(stop.getUTCDate() + 29);
    out.push({
      from: cur.toISOString().slice(0, 10),
      to: (stop < end ? stop : end).toISOString().slice(0, 10),
    });
    cur = new Date(stop);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Graph API javobini bizning nuqtalarga aylantiradi. Sof funksiya — sinaladi. */
export function parseInsights(res: InsightsResponse, from: string, to: string): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const row of res.data ?? []) {
    const key = MAP[row.name] ?? row.name;
    for (const v of row.values ?? []) {
      const date = dayOf(v.end_time);
      if (date < from || date > to) continue;
      points.push({ date, metric: key, value: Number(v.value) || 0 });
    }
  }
  return points;
}

export function instagramSource(token: string, userId: string, metrics: string): MarketingSource {
  if (!token || !userId) {
    return disabledSource(
      'instagram',
      'INSTAGRAM_ACCESS_TOKEN va INSTAGRAM_USER_ID kerak — docs/MARKETING.md',
    );
  }

  const wanted = (metrics || 'reach').split(',').map((m) => m.trim()).filter(Boolean);

  return {
    id: 'instagram',
    ready: true,
    status: `Business hisob ${userId}, metrikalar: ${wanted.join(', ')}`,

    pull: async (from: string, to: string): Promise<PullResult> => {
      const points: MetricPoint[] = [];

      for (const w of windows(from, to)) {
        const url =
          `${API}/${userId}/insights?metric=${wanted.join(',')}&period=day` +
          `&since=${unix(w.from)}&until=${unix(w.to) + 86_400}&access_token=${encodeURIComponent(token)}`;
        const res = await getJson<InsightsResponse>(
          'instagram',
          url,
          {},
          'hisob Business/Creator ekanini va tokenda instagram_basic + instagram_manage_insights borligini tekshiring',
        );
        points.push(...parseInsights(res, from, to));
      }

      // Obunachilar soni — bu «bugungi holat», tarix emas. Shuning uchun
      // faqat oxirgi kunga yoziladi.
      try {
        const prof = await getJson<ProfileResponse>(
          'instagram',
          `${API}/${userId}?fields=followers_count,username&access_token=${encodeURIComponent(token)}`,
        );
        if (typeof prof.followers_count === 'number') {
          points.push({ date: to, metric: 'followers', value: prof.followers_count });
        }
      } catch (e) {
        log.warn(`instagram: obunachilar soni olinmadi — ${(e as Error).message.split('\n')[0]}`);
      }

      return { points, note: `Instagram ${userId}: ${points.length} ta qiymat` };
    },
  };
}

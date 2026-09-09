import type { GoogleAuth } from '../google/auth.ts';
import type { MarketingSource, MetricPoint, PullResult } from './provider.ts';
import { disabledSource, apiError } from './provider.ts';

/**
 * Google Ads — rasmiy API (REST, SDK'siz).
 *
 * Kerak:
 *   GOOGLE_ADS_DEVELOPER_TOKEN  — Google Ads API Center dan
 *   GOOGLE_ADS_CUSTOMER_ID      — hisob raqami, chiziqchasiz (1234567890)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID — MCC orqali kirsangiz (ixtiyoriy)
 *   Google OAuth da `adwords` ruxsati (docs/MARKETING.md)
 *
 * Ma'lumot GAQL so'rovi bilan olinadi — kunlar kesimida, kampaniyalar yig'indisi.
 */

const VERSION = 'v18';
const API = `https://googleads.googleapis.com/${VERSION}`;

type AdsRow = {
  segments?: { date?: string };
  metrics?: {
    costMicros?: string | number;
    clicks?: string | number;
    impressions?: string | number;
    conversions?: number;
  };
};

export type StreamChunk = { results?: AdsRow[]; error?: { message?: string } };

const num = (v: string | number | undefined): number => (v === undefined ? 0 : Number(v) || 0);

const digits = (s: string): string => s.replace(/[^0-9]/g, '');

/**
 * searchStream javobini nuqtalarga aylantiradi. Sof funksiya — sinaladi.
 * Bir kunda bir nechta kampaniya bo‘ladi, shuning uchun avval kun bo‘yicha yig‘iladi.
 */
export function parseAds(chunks: StreamChunk[]): MetricPoint[] {
  const byDay = new Map<string, { cost: number; clicks: number; views: number; leads: number }>();
  for (const chunk of chunks) {
    if (chunk.error?.message) throw new Error(`google_ads: ${chunk.error.message}`);
    for (const row of chunk.results ?? []) {
      const date = row.segments?.date;
      if (!date) continue;
      const acc = byDay.get(date) ?? { cost: 0, clicks: 0, views: 0, leads: 0 };
      acc.cost += num(row.metrics?.costMicros) / 1_000_000;
      acc.clicks += num(row.metrics?.clicks);
      acc.views += num(row.metrics?.impressions);
      acc.leads += num(row.metrics?.conversions);
      byDay.set(date, acc);
    }
  }

  const points: MetricPoint[] = [];
  for (const [date, m] of byDay) {
    points.push({ date, metric: 'cost', value: Math.round(m.cost) });
    points.push({ date, metric: 'clicks', value: m.clicks });
    points.push({ date, metric: 'views', value: m.views });
    if (m.leads) points.push({ date, metric: 'leads', value: Math.round(m.leads) });
  }
  return points;
}

export function googleAdsSource(
  auth: GoogleAuth | null,
  developerToken: string,
  customerId: string,
  loginCustomerId: string,
): MarketingSource {
  if (!auth || !developerToken || !customerId) {
    return disabledSource(
      'google_ads',
      'GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID va Google OAuth (adwords ruxsati) kerak — docs/MARKETING.md',
    );
  }

  const cid = digits(customerId);
  const mcc = digits(loginCustomerId);

  return {
    id: 'google_ads',
    ready: true,
    status: `hisob ${cid}${mcc ? ` (MCC ${mcc})` : ''}`,

    pull: async (from: string, to: string): Promise<PullResult> => {
      const query =
        'SELECT segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions ' +
        `FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`;

      const res = await fetch(`${API}/customers/${cid}/googleAds:searchStream`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await auth.accessToken()}`,
          'developer-token': developerToken,
          ...(mcc ? { 'login-customer-id': mcc } : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60_000),
      });

      const text = await res.text();
      if (!res.ok) {
        throw apiError(
          'google_ads',
          res.status,
          text,
          'developer token tasdiqlanganini va OAuth da adwords ruxsati borligini tekshiring',
        );
      }

      // searchStream JSON massiv qaytaradi: [{results:[...]}, {results:[...]}]
      let chunks: StreamChunk[];
      try {
        const parsed: unknown = JSON.parse(text);
        chunks = Array.isArray(parsed) ? (parsed as StreamChunk[]) : [parsed as StreamChunk];
      } catch {
        throw new Error(`google_ads: javob JSON emas\n${text.slice(0, 200)}`);
      }

      const points = parseAds(chunks);
      const days = new Set(points.map((p) => p.date)).size;
      return { points, note: `Google Ads ${cid}: ${days} kun` };
    },
  };
}

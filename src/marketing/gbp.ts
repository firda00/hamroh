import type { GoogleAuth } from '../google/auth.ts';
import type { MarketingSource, MetricPoint, PullResult } from './provider.ts';
import { disabledSource, getJson, dateParts } from './provider.ts';

/**
 * Google Business Profile — rasmiy Performance API.
 *
 * Kerak: Google OAuth da `business.manage` ruxsati va shu hisob joyning
 * egasi/menejeri bo'lishi.
 *
 * GBP_LOCATION_ID — joy raqami. Business Profile Manager havolasida ko'rinadi;
 * `locations/12345` yoki shunchaki `12345` yozsangiz ham bo'ladi.
 */

const API = 'https://businessprofileperformance.googleapis.com/v1';

/** GBP metrikasi → bizning kalit. */
const MAP: Record<string, string> = {
  CALL_CLICKS: 'calls',
  BUSINESS_DIRECTION_REQUESTS: 'routes',
  WEBSITE_CLICKS: 'clicks',
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'views',
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'views',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'views',
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'views',
};

const WANTED = Object.keys(MAP);

export type TimeSeriesResponse = {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: {
        datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string | number }[];
      };
    }[];
  }[];
};

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Performance javobini nuqtalarga aylantiradi. Sof funksiya — sinaladi.
 * Bir necha metrika bitta kalitga tushadi (barcha impressions → views),
 * shuning uchun avval kun+kalit bo‘yicha yig‘iladi.
 */
export function parseTimeSeries(res: TimeSeriesResponse): MetricPoint[] {
  const sums = new Map<string, number>();
  for (const group of res.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const key = MAP[series.dailyMetric ?? ''];
      if (!key) continue;
      for (const dv of series.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d?.year || !d.month || !d.day) continue;
        const date = `${d.year}-${pad(d.month)}-${pad(d.day)}`;
        const id = `${date}|${key}`;
        sums.set(id, (sums.get(id) ?? 0) + (Number(dv.value) || 0));
      }
    }
  }

  return [...sums].map(([id, value]) => {
    const [date, metric] = id.split('|');
    return { date: date ?? '', metric: metric ?? '', value };
  });
}

export function gbpSource(auth: GoogleAuth | null, locationId: string): MarketingSource {
  if (!auth || !locationId) {
    return disabledSource(
      'gbp',
      'GBP_LOCATION_ID va Google OAuth (business.manage ruxsati) kerak — docs/MARKETING.md',
    );
  }

  const loc = locationId.startsWith('locations/') ? locationId : `locations/${locationId}`;

  return {
    id: 'gbp',
    ready: true,
    status: loc,

    pull: async (from: string, to: string): Promise<PullResult> => {
      const a = dateParts(from);
      const b = dateParts(to);
      const params = new URLSearchParams();
      for (const m of WANTED) params.append('dailyMetrics', m);
      params.set('dailyRange.start_date.year', String(a.year));
      params.set('dailyRange.start_date.month', String(a.month));
      params.set('dailyRange.start_date.day', String(a.day));
      params.set('dailyRange.end_date.year', String(b.year));
      params.set('dailyRange.end_date.month', String(b.month));
      params.set('dailyRange.end_date.day', String(b.day));

      const res = await getJson<TimeSeriesResponse>(
        'gbp',
        `${API}/${loc}:fetchMultiDailyMetricsTimeSeries?${params}`,
        { headers: { authorization: `Bearer ${await auth.accessToken()}` } },
        'joy shu hisobga biriktirilganini va OAuth da business.manage borligini tekshiring',
      );

      const points = parseTimeSeries(res);
      return { points, note: `Google Business ${loc}: ${points.length} ta qiymat` };
    },
  };
}

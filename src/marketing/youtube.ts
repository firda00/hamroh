import type { GoogleAuth } from '../google/auth.ts';
import type { MarketingSource, MetricPoint, PullResult } from './provider.ts';
import { disabledSource, getJson } from './provider.ts';

/**
 * YouTube — rasmiy Analytics API.
 *
 * Kerak: Google OAuth da `yt-analytics.readonly` ruxsati va kanal egasi
 * bo'lgan hisob. Boshqa odamning kanali statistikasi olinmaydi — bu ataylab.
 *
 * YOUTUBE_CHANNEL_ID bo'sh bo'lsa `MINE` ishlatiladi — ya'ni token egasining kanali.
 */

const API = 'https://youtubeanalytics.googleapis.com/v2/reports';

/** YouTube metrikasi → bizning kalit. */
const MAP: Record<string, string> = {
  views: 'views',
  estimatedMinutesWatched: 'watch_time',
  subscribersGained: 'followers',
  likes: 'clicks',
};

const METRICS = 'views,estimatedMinutesWatched,subscribersGained';

export type ReportResponse = {
  columnHeaders?: { name: string }[];
  rows?: (string | number)[][];
};

/** Analytics javobini nuqtalarga aylantiradi. Sof funksiya — sinaladi. */
export function parseReport(res: ReportResponse): MetricPoint[] {
  const cols = (res.columnHeaders ?? []).map((c) => c.name);
  const iDay = cols.indexOf('day');
  if (iDay < 0) return [];

  const points: MetricPoint[] = [];
  for (const row of res.rows ?? []) {
    const date = String(row[iDay] ?? '');
    if (!date) continue;
    cols.forEach((name, i) => {
      if (i === iDay) return;
      const key = MAP[name];
      if (!key) return;
      points.push({ date, metric: key, value: Number(row[i]) || 0 });
    });
  }
  return points;
}

export function youtubeSource(auth: GoogleAuth | null, channelId: string): MarketingSource {
  if (!auth) {
    return disabledSource(
      'youtube',
      'Google OAuth (yt-analytics.readonly ruxsati) kerak — docs/MARKETING.md',
    );
  }

  const ids = channelId ? `channel==${channelId}` : 'channel==MINE';

  return {
    id: 'youtube',
    ready: true,
    status: channelId ? `kanal ${channelId}` : 'token egasining kanali',

    pull: async (from: string, to: string): Promise<PullResult> => {
      const params = new URLSearchParams({
        ids,
        startDate: from,
        endDate: to,
        metrics: METRICS,
        dimensions: 'day',
        sort: 'day',
      });

      const res = await getJson<ReportResponse>(
        'youtube',
        `${API}?${params}`,
        { headers: { authorization: `Bearer ${await auth.accessToken()}` } },
        'kanal shu hisobga tegishli ekanini va OAuth da yt-analytics.readonly borligini tekshiring',
      );

      const points = parseReport(res);
      return { points, note: `YouTube: ${res.rows?.length ?? 0} kun` };
    },
  };
}

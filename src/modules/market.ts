import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { dateKey, addDays } from '../util/date.ts';
import { fetchJson, trySoft } from '../util/http.ts';
import { table, growth } from '../util/fmt.ts';
import { setting } from '../core/db.ts';

/** (2) Kun ma'lumoti: valyuta kursi va ob-havo. Ikkalasi ham kalitsiz ochiq API. */

type CbuRate = { Ccy: string; Rate: string; Date: string; Diff: string };
type GeoResp = { results?: { latitude: number; longitude: number; name: string }[] };
type WeatherResp = {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    wind_speed_10m_max: number[];
  };
};

const WMO: Record<number, string> = {
  0: 'ochiq', 1: 'asosan ochiq', 2: 'bulutli', 3: 'to‘liq bulutli',
  45: 'tuman', 48: 'qirovli tuman', 51: 'mayda yomg‘ir', 53: 'yomg‘ir', 55: 'kuchli yomg‘ir',
  61: 'yomg‘ir', 63: 'o‘rtacha yomg‘ir', 65: 'kuchli yomg‘ir', 71: 'qor', 73: 'qor', 75: 'kuchli qor',
  80: 'jala', 81: 'jala', 82: 'kuchli jala', 95: 'momaqaldiroq', 96: 'momaqaldiroq va do‘l',
};

export type Snapshot = { date: string; usd_uzs: number | null; eur_uzs: number | null; rub_uzs: number | null };

/** CBU dan kurs olib, bugungi suratni saqlaydi. */
export async function refreshRates(ctx: Ctx): Promise<Snapshot | null> {
  const today = dateKey(ctx.now, ctx.cfg.tz);
  const list = await trySoft('cbu.uz', () =>
    fetchJson<CbuRate[]>('https://cbu.uz/uz/arkhiv-kursov-valyut/json/', { offline: ctx.cfg.offline }),
  );
  if (!list) return ctx.db.get<Snapshot>(`SELECT * FROM market_snapshot WHERE date=?`, today) ?? null;

  const pick = (code: string): number | null => {
    const v = list.find((r) => r.Ccy === code)?.Rate;
    return v ? Number(v) : null;
  };
  const snap: Snapshot = { date: today, usd_uzs: pick('USD'), eur_uzs: pick('EUR'), rub_uzs: pick('RUB') };
  ctx.db.run(
    `INSERT INTO market_snapshot(date, usd_uzs, eur_uzs, rub_uzs) VALUES(?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET usd_uzs=excluded.usd_uzs, eur_uzs=excluded.eur_uzs, rub_uzs=excluded.rub_uzs`,
    snap.date,
    snap.usd_uzs,
    snap.eur_uzs,
    snap.rub_uzs,
  );
  return snap;
}

async function coords(ctx: Ctx, city: string): Promise<{ lat: number; lon: number } | null> {
  const cached = setting.get(ctx.db, `geo:${city}`);
  if (cached) {
    const [lat, lon] = cached.split(',').map(Number);
    if (lat !== undefined && lon !== undefined) return { lat, lon };
  }
  const geo = await trySoft('geocoding', () =>
    fetchJson<GeoResp>(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`, {
      offline: ctx.cfg.offline,
    }),
  );
  const hit = geo?.results?.[0];
  if (!hit) return null;
  setting.set(ctx.db, `geo:${city}`, `${hit.latitude},${hit.longitude}`);
  return { lat: hit.latitude, lon: hit.longitude };
}

export type Weather = { date: string; city: string; temp_min: number; temp_max: number; condition: string; wind: number };

export async function refreshWeather(ctx: Ctx): Promise<Weather | null> {
  const city = ctx.cfg.city;
  const today = dateKey(ctx.now, ctx.cfg.tz);
  const c = await coords(ctx, city);
  if (!c) return ctx.db.get<Weather>(`SELECT * FROM weather_snapshot WHERE date=? AND city=?`, today, city) ?? null;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,wind_speed_10m_max` +
    `&timezone=${encodeURIComponent(ctx.cfg.tz)}&forecast_days=1`;
  const w = await trySoft('open-meteo', () => fetchJson<WeatherResp>(url, { offline: ctx.cfg.offline }));
  if (!w?.daily?.time?.length) return null;

  const out: Weather = {
    date: w.daily.time[0] ?? today,
    city,
    temp_min: w.daily.temperature_2m_min[0] ?? 0,
    temp_max: w.daily.temperature_2m_max[0] ?? 0,
    condition: WMO[w.daily.weather_code[0] ?? 0] ?? 'noma’lum',
    wind: w.daily.wind_speed_10m_max[0] ?? 0,
  };
  ctx.db.run(
    `INSERT INTO weather_snapshot(date, city, temp_min, temp_max, condition, wind) VALUES(?,?,?,?,?,?)
     ON CONFLICT(date, city) DO UPDATE SET temp_min=excluded.temp_min, temp_max=excluded.temp_max,
       condition=excluded.condition, wind=excluded.wind`,
    out.date,
    out.city,
    out.temp_min,
    out.temp_max,
    out.condition,
    out.wind,
  );
  return out;
}

export const marketModule: Module = {
  id: 'bozor',
  title: 'Kurs va ob-havo',
  about: 'Valyuta kursi (CBU), ob-havo (Open-Meteo) va ularning o‘zgarishi.',

  commands: [
    {
      name: 'kurs',
      usage: 'bozor kurs [--history=7]',
      about: 'Valyuta kursi va kechagi kunga nisbatan o‘zgarish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const snap = await refreshRates(ctx);
        if (!snap) return { text: 'Kurs olinmadi (internet yo‘q va kesh bo‘sh).' };
        const y = ctx.db.get<Snapshot>(`SELECT * FROM market_snapshot WHERE date=?`, dateKey(addDays(ctx.now, -1), ctx.cfg.tz));
        const line = (name: string, cur: number | null, prev: number | null | undefined): (string | number)[] => [
          name,
          cur ? cur.toLocaleString('ru-RU') : '—',
          prev ? prev.toLocaleString('ru-RU') : '—',
          cur && prev ? growth(prev, cur).text : '—',
        ];
        const rows = [
          line('USD', snap.usd_uzs, y?.usd_uzs),
          line('EUR', snap.eur_uzs, y?.eur_uzs),
          line('RUB', snap.rub_uzs, y?.rub_uzs),
        ];
        const history = a.num('history', 0);
        const extra = history
          ? ['', ...ctx.db.all<Snapshot>(`SELECT * FROM market_snapshot ORDER BY date DESC LIMIT ?`, history)
              .map((s) => `${s.date}: USD ${s.usd_uzs?.toLocaleString('ru-RU') ?? '—'}`)]
          : [];
        return { text: [table(['Valyuta', 'Bugun', 'Kecha', 'O‘zgarish'], rows), ...extra].join('\n'), data: snap };
      },
    },
    {
      name: 'obhavo',
      usage: 'bozor obhavo',
      about: 'Bugungi ob-havo.',
      run: async (ctx) => {
        const w = await refreshWeather(ctx);
        if (!w) return { text: 'Ob-havo olinmadi (internet yo‘q).' };
        return {
          text: `${w.city}: ${Math.round(w.temp_min)}…${Math.round(w.temp_max)}°C, ${w.condition}, shamol ${Math.round(w.wind)} km/soat`,
          data: w,
        };
      },
    },
  ],

  jobs: [
    {
      name: 'bozor.snapshot',
      cron: '5 8 * * *',
      run: async (ctx) => {
        await refreshRates(ctx);
        await refreshWeather(ctx);
        return 'kurs va ob-havo yangilandi';
      },
    },
  ],

  morning: async (ctx) => {
    const [snap, w] = await Promise.all([refreshRates(ctx), refreshWeather(ctx)]);
    const y = ctx.db.get<Snapshot>(`SELECT * FROM market_snapshot WHERE date=?`, dateKey(addDays(ctx.now, -1), ctx.cfg.tz));
    const lines: string[] = [];
    if (snap?.usd_uzs) {
      const chg = y?.usd_uzs ? ` (${growth(y.usd_uzs, snap.usd_uzs).text})` : '';
      lines.push(`USD ${snap.usd_uzs.toLocaleString('ru-RU')} so‘m${chg}` + (snap.eur_uzs ? ` · EUR ${snap.eur_uzs.toLocaleString('ru-RU')}` : ''));
    }
    if (w) lines.push(`${w.city}: ${Math.round(w.temp_min)}…${Math.round(w.temp_max)}°C, ${w.condition}`);
    if (!lines.length) lines.push('Kurs/ob-havo olinmadi (internet yo‘q).');
    return { order: 10, title: 'Kun ma’lumoti', lines };
  },
};

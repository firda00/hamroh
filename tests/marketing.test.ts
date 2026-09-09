import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db.ts';
import { loadConfig } from '../src/core/config.ts';
import type { Ctx } from '../src/core/types.ts';
import { rulesProvider } from '../src/llm/rules.ts';
import { disabledStt } from '../src/stt/provider.ts';
import { disabledTts } from '../src/tts/provider.ts';
import { disabledTel } from '../src/tel/provider.ts';
import { disabledSms } from '../src/sms/provider.ts';
import { disabledGcal } from '../src/gcal/client.ts';
import { parseInsights, dayOf, windows } from '../src/marketing/instagram.ts';
import { parseAds } from '../src/marketing/googleads.ts';
import { parseReport } from '../src/marketing/youtube.ts';
import { parseTimeSeries } from '../src/marketing/gbp.ts';
import { makeSources } from '../src/marketing/index.ts';
import { daysBetween, dateParts, apiError } from '../src/marketing/provider.ts';
import { marketingModule } from '../src/modules/marketing.ts';

function ctxFor(extra: Partial<ReturnType<typeof loadConfig>> = {}): Ctx {
  process.env['HAMROH_DB'] = ':memory:';
  const cfg = { ...loadConfig(), dbPath: ':memory:', offline: true, ...extra };
  return {
    cfg,
    db: openDb(':memory:'),
    llm: rulesProvider(),
    stt: disabledStt(),
    tts: disabledTts(),
    tel: disabledTel(),
    sms: disabledSms(),
    gcal: disabledGcal(),
    now: new Date('2026-09-09T06:00:00.000Z'),
  };
}

const cmd = (name: string) => {
  const c = marketingModule.commands.find((x) => x.name === name);
  if (!c) throw new Error(`buyruq yo‘q: ${name}`);
  return c;
};

// ---------------------------------------------------------------- Instagram

test('marketing: Instagram end_time bir kun oldinga tegishli', () => {
  // Meta period=day uchun oyna TUGAGAN paytni beradi.
  assert.equal(dayOf('2026-09-02T07:00:00+0000'), '2026-09-01');
  assert.equal(dayOf('2026-09-01T07:00:00+0000'), '2026-08-31');
});

test('marketing: Instagram javobi to‘g‘ri o‘qiladi', () => {
  const points = parseInsights(
    {
      data: [
        {
          name: 'reach',
          period: 'day',
          values: [
            { value: 1500, end_time: '2026-09-02T07:00:00+0000' }, // → 09-01
            { value: 1800, end_time: '2026-09-03T07:00:00+0000' }, // → 09-02
            { value: 999, end_time: '2026-09-20T07:00:00+0000' }, // davrdan tashqarida
          ],
        },
        { name: 'profile_views', period: 'day', values: [{ value: 42, end_time: '2026-09-02T07:00:00+0000' }] },
      ],
    },
    '2026-09-01',
    '2026-09-02',
  );

  assert.deepEqual(points, [
    { date: '2026-09-01', metric: 'reach', value: 1500 },
    { date: '2026-09-02', metric: 'reach', value: 1800 },
    { date: '2026-09-01', metric: 'views', value: 42 }, // profile_views → views
  ]);
});

test('marketing: Instagram 30 kunlik oynalarga bo‘linadi', () => {
  // Meta bir so‘rovda 30 kundan ko‘p bermaydi.
  const w = windows('2026-01-01', '2026-03-01');
  assert.equal(w.length, 2, JSON.stringify(w));
  assert.deepEqual(w[0], { from: '2026-01-01', to: '2026-01-30' });
  // Oynalar uzluksiz: keyingisi oldingisidan bir kun keyin boshlanadi
  assert.deepEqual(w[1], { from: '2026-01-31', to: '2026-03-01' });

  // Uzunroq davr — uchta oyna
  assert.equal(windows('2026-01-01', '2026-04-01').length, 4);

  assert.deepEqual(windows('2026-05-05', '2026-05-05'), [{ from: '2026-05-05', to: '2026-05-05' }]);
});

// --------------------------------------------------------------- Google Ads

test('marketing: Google Ads bir kundagi kampaniyalarni qo‘shadi', () => {
  const points = parseAds([
    {
      results: [
        {
          segments: { date: '2026-09-01' },
          metrics: { costMicros: '12500000', clicks: '40', impressions: '1000', conversions: 2 },
        },
        {
          segments: { date: '2026-09-01' },
          metrics: { costMicros: '7500000', clicks: '10', impressions: '500', conversions: 1 },
        },
      ],
    },
    { results: [{ segments: { date: '2026-09-02' }, metrics: { costMicros: '1000000', clicks: '5' } }] },
  ]);

  const day1 = points.filter((p) => p.date === '2026-09-01');
  // 12.5 + 7.5 million mikro = 20 birlik
  assert.equal(day1.find((p) => p.metric === 'cost')?.value, 20);
  assert.equal(day1.find((p) => p.metric === 'clicks')?.value, 50);
  assert.equal(day1.find((p) => p.metric === 'views')?.value, 1500);
  assert.equal(day1.find((p) => p.metric === 'leads')?.value, 3);

  // Konversiya bo‘lmasa lid yozilmaydi — nol qator baza to‘ldirmasin
  const day2 = points.filter((p) => p.date === '2026-09-02');
  assert.equal(day2.some((p) => p.metric === 'leads'), false);
});

test('marketing: Google Ads xatosi yashirilmaydi', () => {
  assert.throws(
    () => parseAds([{ error: { message: 'developer token not approved' } }]),
    /developer token not approved/,
  );
});

// ----------------------------------------------------------------- YouTube

test('marketing: YouTube hisoboti ustun nomlari bo‘yicha o‘qiladi', () => {
  const points = parseReport({
    columnHeaders: [
      { name: 'day' },
      { name: 'views' },
      { name: 'estimatedMinutesWatched' },
      { name: 'subscribersGained' },
    ],
    rows: [
      ['2026-09-01', 320, 850, 4],
      ['2026-09-02', 410, 990, 6],
    ],
  });

  assert.equal(points.length, 6);
  assert.deepEqual(points[0], { date: '2026-09-01', metric: 'views', value: 320 });
  assert.equal(points.find((p) => p.metric === 'watch_time')?.value, 850);
  assert.equal(points.find((p) => p.metric === 'followers')?.value, 4);
});

test('marketing: YouTube kunlar ustuni bo‘lmasa bo‘sh qaytadi', () => {
  assert.deepEqual(parseReport({ columnHeaders: [{ name: 'views' }], rows: [[10]] }), []);
  assert.deepEqual(parseReport({}), []);
});

// ------------------------------------------------------- Google Business Profile

test('marketing: GBP bir kalitga tushgan metrikalarni qo‘shadi', () => {
  const points = parseTimeSeries({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: 'CALL_CLICKS',
            timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: '7' }] },
          },
          {
            // To‘rtta impressions turi bitta "views" ga tushadi — qo‘shilishi kerak
            dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
            timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: '100' }] },
          },
          {
            dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
            timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: '250' }] },
          },
          {
            dailyMetric: 'NOMA_LUM_METRIKA',
            timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: '9' }] },
          },
        ],
      },
    ],
  });

  assert.equal(points.find((p) => p.metric === 'calls')?.value, 7);
  assert.equal(points.find((p) => p.metric === 'views')?.value, 350, '100 + 250');
  assert.equal(points.some((p) => p.metric === 'NOMA_LUM_METRIKA'), false, 'notanish metrika tashlanadi');
  // Oy va kun ikki raqamga to‘ldirilishi kerak
  assert.equal(points[0]?.date, '2026-09-01');
});

// -------------------------------------------------------------- yordamchilar

test('marketing: sana yordamchilari', () => {
  assert.deepEqual(dateParts('2026-09-08'), { year: 2026, month: 9, day: 8 });
  assert.deepEqual(daysBetween('2026-09-01', '2026-09-03'), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.deepEqual(daysBetween('2026-09-01', '2026-09-01'), ['2026-09-01']);
});

test('marketing: API xatosi odam tushunadigan bo‘ladi', () => {
  assert.match(apiError('instagram', 403, '{"error":"..."}').message, /ruxsat yetarli emas/);
  assert.match(apiError('youtube', 401, '').message, /token eskirgan/);
  assert.match(apiError('gbp', 429, '').message, /chegarasi/);
  // Uzun javob qisqartiriladi — log to‘lib ketmasin
  assert.ok(apiError('x', 500, 'a'.repeat(2000)).message.length < 600);
});

// ------------------------------------------------------------------ manbalar

test('marketing: sozlanmagan manba yiqilmaydi, ko‘rsatma beradi', async () => {
  const ctx = ctxFor({
    instagramToken: '',
    instagramUserId: '',
    googleClientId: '',
    googleRefreshToken: '',
    adsDeveloperToken: '',
    gbpLocationId: '',
  });
  try {
    const sources = makeSources(ctx.cfg, ctx.db);
    assert.equal(sources.length, 5, 'beshta platforma');
    assert.equal(sources.every((s) => !s.ready), true, 'kalitlarsiz hech biri tayyor emas');

    for (const s of sources) {
      assert.ok(s.status.length > 10, `${s.id}: ko‘rsatma bo‘lishi kerak`);
      await assert.rejects(() => s.pull('2026-09-01', '2026-09-02'), new RegExp(s.id));
    }

    // 2GIS ataylab API'siz — skrejping o'rniga CSV
    const gis = sources.find((s) => s.id === '2gis');
    assert.match(String(gis?.status), /CSV|import/i);
  } finally {
    ctx.db.close();
  }
});

test('marketing: kalitlar bo‘lsa manba tayyor bo‘ladi', () => {
  const ctx = ctxFor({
    instagramToken: 'IGQ-token',
    instagramUserId: '17841400000000000',
    googleClientId: 'id',
    googleClientSecret: 'secret',
    googleRefreshToken: 'refresh',
    adsDeveloperToken: 'dev',
    adsCustomerId: '123-456-7890',
    youtubeChannelId: 'UC123',
    gbpLocationId: '9876',
  });
  try {
    const sources = makeSources(ctx.cfg, ctx.db);
    const ready = sources.filter((s) => s.ready).map((s) => s.id);
    assert.deepEqual(ready, ['instagram', 'google_ads', 'youtube', 'gbp']);
    // Chiziqchalar olib tashlanishi kerak — Ads API ularni qabul qilmaydi
    assert.match(String(sources.find((s) => s.id === 'google_ads')?.status), /1234567890/);
  } finally {
    ctx.db.close();
  }
});

test('marketing: manbalar buyrug‘i holatni ko‘rsatadi', async () => {
  const ctx = ctxFor({ instagramToken: 'x', instagramUserId: 'y' });
  try {
    const out = await cmd('manbalar').run(ctx, []);
    assert.match(out.text, /instagram/);
    assert.match(out.text, /2gis/);
    assert.match(out.text, /ulash/);
  } finally {
    ctx.db.close();
  }
});

test('marketing: sync ulanmagan manbalarda ham yiqilmaydi', async () => {
  const ctx = ctxFor({
    instagramToken: '',
    instagramUserId: '',
    googleClientId: '',
    googleRefreshToken: '',
    adsDeveloperToken: '',
    gbpLocationId: '',
  });
  try {
    const out = await cmd('sync').run(ctx, ['--days=3']);
    const rows = out.data as { platform: string; saved: number; error?: string }[];
    assert.equal(rows.length, 5);
    assert.equal(rows.every((r) => r.error === 'ulanmagan'), true, JSON.stringify(rows));
    // Har bir qatorda nima qilish kerakligi yozilgan bo‘lsin
    assert.ok(out.text.includes('docs/MARKETING.md'), out.text);
    assert.match(out.text, /Yangi ma’lumot yo‘q/);
  } finally {
    ctx.db.close();
  }
});

test('marketing: ulash havolasi barcha ruxsatlarni so‘raydi', async () => {
  const ctx = ctxFor({ googleClientId: 'mijoz-id', googleClientSecret: 'sir', webBase: 'https://hamroh.uz' });
  try {
    const out = await cmd('ulash').run(ctx, []);
    const url = String((out.data as { url: string }).url);
    for (const scope of ['calendar', 'adwords', 'yt-analytics.readonly', 'business.manage']) {
      assert.ok(url.includes(encodeURIComponent(scope)) || url.includes(scope), `${scope} yo‘q`);
    }
    assert.match(url, /access_type=offline/);
    assert.match(String((out.data as { redirect: string }).redirect), /^https:\/\/hamroh\.uz\/oauth\/google\/callback$/);
  } finally {
    ctx.db.close();
  }
});

test('marketing: kalitsiz ulash buyrug‘i nima qilishni aytadi', async () => {
  const ctx = ctxFor({ googleClientId: '', googleClientSecret: '' });
  try {
    const out = await cmd('ulash').run(ctx, []);
    assert.match(out.text, /GOOGLE_CLIENT_ID/);
  } finally {
    ctx.db.close();
  }
});

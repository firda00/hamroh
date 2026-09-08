import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseAmount } from '../src/core/args.ts';
import { cronMatches, fieldMatches } from '../src/core/scheduler.ts';
import { parseWhen, dateKey, monthKey, prevMonth, daysInMonth, timeKey } from '../src/util/date.ts';
import { growth, money, table } from '../src/util/fmt.ts';
import { parseFeed, stripTags, tag } from '../src/util/http.ts';
import { parseIcs } from '../src/modules/calendar.ts';
import { readCsv } from '../src/util/office.ts';
import { rulesProvider } from '../src/llm/rules.ts';

const TZ = 'Asia/Tashkent';

test('parseArgs: pozitsion va bayroqlar', () => {
  const a = parseArgs(['Bankka borish', '--due=ertaga 10:00', '--priority', '1', '--flag']);
  assert.equal(a.at(0), 'Bankka borish');
  assert.equal(a.str('due'), 'ertaga 10:00');
  assert.equal(a.num('priority'), 1);
  assert.equal(a.str('flag'), 'true');
  assert.equal(a.has('yoq'), false);
});

test('parseAmount: qisqartmalar', () => {
  assert.equal(parseAmount('250000'), 250000);
  assert.equal(parseAmount('1 200 000'), 1200000);
  assert.equal(parseAmount('5mln'), 5_000_000);
  assert.equal(parseAmount('350k'), 350_000);
  assert.equal(parseAmount('2.5mln'), 2_500_000);
});

test('parseWhen: "ertaga 10:00" ertangi kunni beradi', () => {
  const now = new Date('2026-09-08T06:00:00.000Z'); // Toshkentda 11:00
  const d = parseWhen('ertaga 10:00', TZ, now);
  assert.ok(d);
  assert.equal(dateKey(d, TZ), '2026-09-09');
  assert.equal(timeKey(d, TZ), '10:00');
});

test('parseWhen: o‘tgan soat ertangi kunga suriladi', () => {
  const now = new Date('2026-09-08T06:00:00.000Z'); // 11:00 Toshkent
  const d = parseWhen('09:00', TZ, now);
  assert.ok(d);
  assert.equal(dateKey(d, TZ), '2026-09-09');
});

test('parseWhen: ISO sana va nisbiy vaqt', () => {
  const now = new Date('2026-09-08T06:00:00.000Z');
  assert.equal(dateKey(parseWhen('2026-12-31 18:00', TZ, now) as Date, TZ), '2026-12-31');
  const plus = parseWhen('+2h', TZ, now) as Date;
  assert.equal(plus.getTime() - now.getTime(), 2 * 3600_000);
  assert.equal(parseWhen('shunchaki matn', TZ, now), null);
});

test('sana yordamchilari', () => {
  assert.equal(monthKey(new Date('2026-09-08T06:00:00Z'), TZ), '2026-09');
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
});

test('cron: maydon va to‘liq ifoda', () => {
  assert.ok(fieldMatches('*', 7));
  assert.ok(fieldMatches('*/15', 30));
  assert.ok(!fieldMatches('*/15', 31));
  assert.ok(fieldMatches('28-31', 30));
  assert.ok(fieldMatches('7,13,19', 13));

  const at10 = new Date('2026-09-10T05:00:00.000Z'); // Toshkentda 10:00, 10-kun
  assert.ok(cronMatches('0 10 10 * *', at10, TZ));
  assert.ok(!cronMatches('0 11 10 * *', at10, TZ));
  assert.ok(!cronMatches('notogri', at10, TZ));
});

test('growth: nolga bo‘linish xavfsiz', () => {
  assert.equal(growth(0, 0).text, 'o‘zgarishsiz');
  assert.equal(growth(0, 5).pct, null);
  assert.equal(Math.round(growth(100, 150).pct ?? 0), 50);
  assert.ok(growth(100, 50).text.includes('-50'));
});

test('money va table formatlash', () => {
  assert.ok(money(1234567, 'UZS').includes('UZS'));
  const t = table(['A', 'B'], [[1, 'x']]);
  assert.ok(t.includes('A'));
  assert.equal(t.split('\n').length, 3);
});

test('RSS feed tahlili', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Birinchi & ikkinchi]]></title><link>https://a.uz/1</link>
      <description>&lt;p&gt;Matn&lt;/p&gt;</description><pubDate>Mon, 08 Sep 2026 06:00:00 GMT</pubDate></item>
    <item><title>Ikkinchi</title><link>https://a.uz/2</link></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, 'Birinchi & ikkinchi');
  assert.equal(items[0]?.url, 'https://a.uz/1');
  assert.equal(items[0]?.summary, 'Matn');
  assert.equal(stripTags('<b>salom</b> &amp; xayr'), 'salom & xayr');
  assert.equal(tag('<a>qiymat</a>', 'a'), 'qiymat');
});

test('ICS import', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:abc-1
SUMMARY:Investor bilan
DTSTART:20260910T100000Z
DTEND:20260910T110000Z
LOCATION:Ofis
END:VEVENT
END:VCALENDAR`;
  const events = parseIcs(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.title, 'Investor bilan');
  assert.equal(events[0]?.start, '2026-09-10T10:00:00.000Z');
});

test('CSV o‘qish: ; va tirnoqlar', () => {
  const { headers, rows } = readCsv('sana;summa;izoh\r\n2026-09-01;150000;"Ovqat; tushlik"\r\n');
  assert.deepEqual(headers, ['sana', 'summa', 'izoh']);
  assert.deepEqual(rows[0], ['2026-09-01', '150000', 'Ovqat; tushlik']);
});

test('qoidaviy LLM: qisqartma va toifalash', async () => {
  const llm = rulesProvider();
  assert.equal(llm.smart, false);

  const sum = await llm.run({
    kind: 'summarize',
    text: 'Kompaniya yangi kurs chiqardi va sotuvlar oshdi. Reklama byudjeti kengaytirildi. Yangi ofis ochildi va xodimlar soni oshdi.',
    maxSentences: 2,
  });
  assert.ok(sum.text.length > 0);

  const cls = await llm.run({ kind: 'classify', text: 'Ofis arendasi uchun to‘lov', labels: ['arenda', 'ovqat', 'transport'] });
  assert.equal(cls.label, 'arenda');
});

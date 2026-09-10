import type { Ctx } from '../../core/types.ts';
import type { RolePack } from '../types.ts';
import { sumBy } from '../../modules/marketing.ts';

/**
 * NEMO Marketing Employee v1 — birinchi production rol paketi.
 *
 * Mavjud vositalarni bitta lavozimga yig'adi: Instagram, Google Ads, YouTube,
 * Google Business Profile (raqamlar), hujjatlar (hisobot fayllari) va
 * kalendar (sharh uchrashuvi). Yangi integratsiya qo'shilmagan.
 *
 * Loyihaning asosiy g'oyasi shu paketda ko'rinadi: agent o'z ishini o'zi
 * qiladi, lekin **tashqariga chiqadigan yoki qaytarib bo'lmaydigan** har bir
 * qadamda to'xtaydi va odamdan so'raydi.
 */

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

const metric = (ctx: Ctx, key: string, from: string, to: string): number =>
  sumBy(ctx, from, to, 'metric').find((r) => r.key === key)?.total ?? 0;

const leadsIn = (ctx: Ctx, from: string, to: string): number =>
  num(
    ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM leads WHERE date(created_at) BETWEEN ? AND ?`,
      from,
      to,
    )?.n,
  );

export const marketingEmployee: RolePack = {
  id: 'marketing-employee',
  name: 'NEMO Marketing Employee',
  version: 'v1',
  mission:
    'Har kuni marketing raqamlarini yig‘ib, tahlil qilib, tayyor hisobot beradi — ' +
    'va o‘sish uchun nima qilish kerakligini aytadi.',

  does: [
    'Instagram, Google Ads, YouTube va Google Business raqamlarini har kuni yig‘adi',
    'Lid voronkasini kuzatadi: qaysi kanal qancha lid berdi',
    'Haftalik diagrammali hisobot tayyorlaydi (HTML va Excel)',
    'Bir lid narxi (CPL), CTR va konversiyani hisoblab, o‘zgarishning sababini ko‘rsatadi',
    'Haftalik sharh uchrashuvini kalendarga qo‘yishni taklif qiladi',
    'Hisobotni Telegramga yuborishni taklif qiladi',
  ],

  doesNot: [
    'Reklama kampaniyalarini o‘zgartirmaydi va byudjetga tegmaydi',
    'Pul harakati bilan ishlamaydi — moliya moduliga umuman kirmaydi',
    'SMS yubormaydi va qo‘ng‘iroq qilmaydi',
    'Mijozlarga o‘zi yozmaydi — faqat siz tasdiqlagan xabarni yuboradi',
    'Hisoblarga ulanish ruxsatini o‘zi so‘ramaydi (OAuth — faqat siz)',
    'Ma’lumot o‘ylab topmaydi: raqam yo‘q bo‘lsa «ma’lumot yo‘q» deb yozadi',
  ],

  // ---------------------------------------------------------------- ruxsatlar
  //
  // Ro'yxatda yo'q hamma narsa taqiqlangan. Quyidagi `deny` yozuvlari
  // ortiqcha ko'rinishi mumkin — lekin ular hujjat vazifasini bajaradi:
  // mijoz «bu rol pulimga tega oladimi?» deb so'raganda javob shu jadvalda.
  permissions: [
    // O'zi bajaradi — hammasi o'qish yoki lokal fayl yasash
    { action: 'marketing:sync', mode: 'auto', why: 'faqat o‘qiydi: rasmiy API dan raqam oladi' },
    { action: 'marketing:report', mode: 'auto', why: 'lokal hisobot fayli yasaydi' },
    { action: 'marketing:manbalar', mode: 'auto', why: 'ulanish holatini ko‘rsatadi' },
    { action: 'marketing:advise', mode: 'auto', why: 'mavjud raqamlar ustida tahlil' },
    { action: 'lid:list', mode: 'auto', why: 'lidlarni o‘qiydi' },
    { action: 'lid:funnel', mode: 'auto', why: 'voronka statistikasi — o‘qish' },
    { action: 'lid:export', mode: 'auto', why: 'lokal Excel fayl' },
    { action: 'hujjat:excel', mode: 'auto', why: 'lokal fayl yasaydi, hech qayerga yubormaydi' },
    { action: 'hujjat:word', mode: 'auto', why: 'lokal fayl' },
    { action: 'hujjat:slides', mode: 'auto', why: 'lokal fayl' },
    { action: 'hujjat:pdf', mode: 'auto', why: 'lokal fayl' },
    { action: 'hujjat:content', mode: 'auto', why: 'matn tayyorlaydi, e’lon qilmaydi' },
    { action: 'kalendar:list', mode: 'auto', why: 'kalendarni o‘qiydi' },
    { action: 'kalendar:free', mode: 'auto', why: 'bo‘sh vaqtni qidiradi — o‘qish' },
    { action: 'hisobot:hafta', mode: 'auto', why: 'ichki hisobot' },

    // To'xtaydi va so'raydi — natijasi tashqarida ko'rinadi
    { action: 'kalendar:add', mode: 'approval', why: 'kalendaringizga yozadi — vaqtingizni band qiladi' },
    { action: 'telegram:send', mode: 'approval', why: 'xabar tashqariga chiqadi va qaytarib bo‘lmaydi' },
    { action: 'telegram:file', mode: 'approval', why: 'fayl tashqariga chiqadi' },
    { action: 'marketing:set', mode: 'approval', why: 'raqamni qo‘lda o‘zgartiradi — hisobot buziladi' },
    { action: 'marketing:import', mode: 'approval', why: 'tashqi fayldan ma’lumot yozadi' },

    // Aniq taqiq — chegara shu yerda
    { action: 'moliya:*', mode: 'deny', why: 'marketing roli pul harakatiga umuman tegmaydi' },
    { action: 'aloqa:*', mode: 'deny', why: 'SMS va qo‘ng‘iroq bu rolning ishi emas' },
    { action: 'qongiroq:*', mode: 'deny', why: 'telefon qilish bu rolning ishi emas' },
    { action: 'navlar:*', mode: 'deny', why: 'yangi navyk yoqish — faqat odam qo‘li bilan' },
    { action: 'sozlash:*', mode: 'deny', why: 'tizim sozlamalarini o‘zgartirmaydi' },
    { action: 'buxgalter:*', mode: 'deny', why: 'buxgalteriya alohida rol' },
    { action: 'marketing:ulash', mode: 'deny', why: 'hisobga ulanish ruxsatini faqat siz berasiz' },
    { action: 'kalendar:rm', mode: 'deny', why: 'uchrashuv o‘chirish — bu rolga kerak emas' },
    { action: 'lid:import', mode: 'deny', why: 'lid bazasiga yozish sotuv rolining ishi' },
  ],

  // ------------------------------------------------------------------ ish oqimi
  workflow: [
    {
      id: 'raqamlar',
      title: 'Raqamlarni yig‘ish',
      action: 'marketing:sync',
      args: ['--days=3'],
      produces: 'Instagram, Ads, YouTube, GBP ko‘rsatkichlari',
      cron: '0 9 * * *',
      verify: (r) => (Array.isArray(r.data) ? null : 'sync manbalar ro‘yxatini qaytarmadi'),
    },
    {
      id: 'voronka',
      title: 'Lid voronkasi',
      action: 'lid:funnel',
      produces: 'bosqichlar bo‘yicha lidlar',
      cron: '10 9 * * *',
      optional: true,
    },
    {
      id: 'hisobot',
      title: 'Haftalik hisobot',
      action: 'marketing:report',
      args: ['--days=7', '--html'],
      produces: 'diagrammali HTML hisobot',
      cron: '20 9 * * *',
    },
    {
      id: 'tahlil',
      title: 'Tahlil va tavsiyalar',
      action: 'marketing:advise',
      args: ['--days=7'],
      produces: 'o‘sish uchun qadamlar ro‘yxati',
      cron: '25 9 * * *',
      optional: true,
    },
    {
      id: 'jadval',
      title: 'Lidlar jadvali (Excel)',
      action: 'lid:export',
      produces: '.xlsx fayl',
      cron: '0 10 * * 1',
      weekly: true,
      optional: true,
      verify: (r) => (r.files?.length ? null : 'fayl yaratilmadi'),
    },
    {
      id: 'uchrashuv',
      title: 'Haftalik sharh uchrashuvi',
      action: 'kalendar:add',
      // Argumentlar buyruqning o'z shakli bo'yicha: nom + --at bayrog'i.
      args: ['Marketing sharhi', '--at=dushanba 11:00', '--dur=45'],
      produces: 'kalendarda uchrashuv',
      cron: '15 10 * * 1',
      weekly: true,
      // Buyruq argument yetishmasa ko'rsatma qaytaradi va xato bermaydi.
      // Uchrashuv haqiqatan yaratilganini shu yerda tekshiramiz.
      verify: (r) => (r.data ? null : 'uchrashuv yaratilmadi — buyruq ko‘rsatma qaytardi'),
    },
    {
      id: 'yuborish',
      title: 'Hisobotni yuborish',
      action: 'telegram:send',
      args: ['Haftalik marketing hisoboti tayyor.'],
      produces: 'Telegramdagi xabar',
      cron: '30 10 * * 1',
      weekly: true,
    },
  ],

  // ---------------------------------------------------------------------- KPI
  kpis: [
    {
      id: 'cpl',
      title: 'Bitta lid narxi',
      unit: 'so‘m',
      target: 50_000,
      direction: 'down',
      why: 'Reklama samarasi shu raqamda ko‘rinadi: lid qimmatlashsa, kanal charchagan.',
      measure: (ctx, from, to) => {
        const cost = metric(ctx, 'cost', from, to);
        const leads = metric(ctx, 'leads', from, to) || leadsIn(ctx, from, to);
        // Xarajat yoki lid yo'q bo'lsa — bo'lish ma'nosiz.
        return cost > 0 && leads > 0 ? Math.round(cost / leads) : null;
      },
    },
    {
      id: 'lidlar',
      title: 'Davrdagi lidlar',
      unit: 'ta',
      target: 40,
      direction: 'up',
      why: 'Marketingning yakuniy mahsuloti — sotuvga tayyor murojaat.',
      measure: (ctx, from, to) => {
        const fromLeads = leadsIn(ctx, from, to);
        const fromApi = metric(ctx, 'leads', from, to);
        const total = fromLeads + fromApi;
        return total > 0 ? total : null;
      },
    },
    {
      id: 'qamrov',
      title: 'Qamrov',
      unit: 'ta',
      target: 60_000,
      direction: 'up',
      why: 'Auditoriya o‘smasa, lid ham o‘smaydi — bu yuqori bosqich.',
      measure: (ctx, from, to) => {
        const reach = metric(ctx, 'reach', from, to) + metric(ctx, 'views', from, to);
        return reach > 0 ? reach : null;
      },
    },
    {
      id: 'ctr',
      title: 'Bosish ulushi (CTR)',
      unit: '%',
      target: 1.5,
      direction: 'up',
      why: 'Kreativ va matn ishlayaptimi — shu raqam aytadi.',
      measure: (ctx, from, to) => {
        const clicks = metric(ctx, 'clicks', from, to);
        const shown = metric(ctx, 'views', from, to) + metric(ctx, 'reach', from, to);
        return shown > 0 && clicks > 0 ? Number(((clicks / shown) * 100).toFixed(2)) : null;
      },
    },
    {
      id: 'yangilik',
      title: 'Ma’lumot yangiligi',
      unit: 'soat',
      target: 26,
      direction: 'down',
      why: 'Eski raqam ustida qaror qabul qilish — eng qimmat xato.',
      measure: (ctx) => {
        const last = ctx.db.get<{ ts: string }>(
          `SELECT ts FROM audit_events WHERE role='marketing-employee' AND event='amal.bajarildi'
             AND subject='marketing:sync' ORDER BY id DESC LIMIT 1`,
        );
        if (!last) return null;
        const hours = (ctx.now.getTime() - new Date(last.ts).getTime()) / 3_600_000;
        return Math.max(0, Math.round(hours * 10) / 10);
      },
    },
    {
      id: 'intizom',
      title: 'Ish oqimi bajarilishi',
      unit: '%',
      target: 90,
      direction: 'up',
      why: 'Rol o‘z jadvalida ishlayaptimi: kechikkan qadam — kechikkan qaror.',
      measure: (ctx, from, to) => {
        const row = ctx.db.get<{ total: number; done: number }>(
          `SELECT COUNT(*) total, SUM(CASE WHEN status='bajarildi' THEN 1 ELSE 0 END) done
             FROM role_runs WHERE role='marketing-employee' AND substr(started_at,1,10) BETWEEN ? AND ?`,
          from,
          to,
        );
        const total = num(row?.total);
        return total > 0 ? Math.round((num(row?.done) / total) * 100) : null;
      },
    },
  ],
};

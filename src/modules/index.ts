import type { Module } from '../core/types.ts';
import { marketModule } from './market.ts';
import { newsModule } from './news.ts';
import { tasksModule } from './tasks.ts';
import { calendarModule } from './calendar.ts';
import { reportModule } from './report.ts';
import { financeModule } from './finance.ts';
import { accountingModule } from './accounting.ts';
import { legalModule } from './legal.ts';
import { leadsModule } from './leads.ts';
import { docsModule } from './docs.ts';
import { telegramModule } from './telegram.ts';
import { voiceModule } from './voice.ts';
import { commsModule } from './comms.ts';
import { recurringModule } from './recurring.ts';
import { marketingModule } from './marketing.ts';
import { productsModule } from './products.ts';
import { healthModule } from './health.ts';
import { notifyModule } from './notify.ts';

/** Barcha modullar ro'yxati. Yangi modul shu yerga qo'shiladi — boshqa joyga tegmaydi. */
export const modules: Module[] = [
  marketModule, // (2)  kurs, ob-havo
  newsModule, // (1)  yangiliklar
  tasksModule, // (3)  vazifalar
  calendarModule, // (4)  kalendar
  reportModule, // (5)  hisobotlar
  financeModule, // (5)  shaxsiy moliya
  accountingModule, // (6)  buxgalteriya
  legalModule, // (7)  yuridik
  leadsModule, // (8)  lidlar, Excel
  docsModule, // (9)  hujjatlar, kontent
  telegramModule, // (10) telegram
  voiceModule, //    (10) ovoz -> matn (Whisper)
  commsModule, // (11) qo'ng'iroq, SMS
  recurringModule, // (12) oylik to'lovlar
  marketingModule, // (13) marketing analitikasi
  productsModule, // (14) mahsulot va foyda
  healthModule, // (15) sog'liq
  notifyModule, //      eslatmalar navbati
];

export const byId = (id: string): Module | undefined => modules.find((m) => m.id === id);

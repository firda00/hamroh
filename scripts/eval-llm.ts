import { loadConfig, loadDotEnv } from '../src/core/config.ts';
import { makeLlm } from '../src/llm/index.ts';
import type { LlmTask } from '../src/llm/provider.ts';
import { table } from '../src/util/fmt.ts';

/**
 * Modellarni o'zbek tilida solishtirish.
 *
 * Nima uchun: ochiq modellarning ko'pchiligi o'zbekchani yaxshi bilmaydi.
 * Qaysi model sizning ishingizga yaraydi — buni faqat tekshirib bilish mumkin.
 *
 * Ishlatish:
 *   HAMROH_LLM=local HAMROH_LLM_MODEL=qwen3:14b   node scripts/eval-llm.ts
 *   HAMROH_LLM=local HAMROH_LLM_MODEL=gemma3:27b  node scripts/eval-llm.ts
 *   HAMROH_LLM=anthropic                          node scripts/eval-llm.ts
 */

type Case = {
  name: string;
  task: LlmTask;
  /** To'g'ri javob (classify uchun). */
  expect?: string;
  /** Javobda bo'lmasligi kerak bo'lgan narsalar (o'ylab topilgan raqamlar). */
  forbid?: RegExp[];
};

const CASES: Case[] = [
  // --- Toifalash: aniq javobi bor, ballash oson ---
  { name: 'toifa: arenda', expect: 'arenda', task: { kind: 'classify', text: 'Ofis ijarasi uchun oylik to‘lov, 5 mln so‘m', labels: ['arenda', 'ovqat', 'transport', 'reklama', 'xizmat'] } },
  { name: 'toifa: ovqat', expect: 'ovqat', task: { kind: 'classify', text: 'Xodimlarga tushlik buyurtma qilindi', labels: ['arenda', 'ovqat', 'transport', 'reklama', 'xizmat'] } },
  { name: 'toifa: transport', expect: 'transport', task: { kind: 'classify', text: 'Mashinaga benzin quydirdim', labels: ['arenda', 'ovqat', 'transport', 'reklama', 'xizmat'] } },
  { name: 'toifa: reklama', expect: 'reklama', task: { kind: 'classify', text: 'Instagramda targ‘ibot uchun byudjet sarflandi', labels: ['arenda', 'ovqat', 'transport', 'reklama', 'xizmat'] } },
  { name: 'toifa: xizmat', expect: 'xizmat', task: { kind: 'classify', text: 'Buxgalterga oylik xizmat haqi to‘landi', labels: ['arenda', 'ovqat', 'transport', 'reklama', 'xizmat'] } },
  { name: 'lid manbasi', expect: 'instagram', task: { kind: 'classify', text: 'Mijoz "sizni Instagram sahifangizdan topdim" dedi', labels: ['instagram', 'google', '2gis', 'telegram', 'tavsiya'] } },

  // --- Qisqartma: o'zbekcha va qisqa bo'lishi kerak ---
  {
    name: 'qisqartma: yangilik',
    task: {
      kind: 'summarize',
      maxSentences: 2,
      hint: 'biznesga ta’siri',
      text:
        'Markaziy bank asosiy stavkani o‘zgarishsiz qoldirdi. Inflyatsiya yillik hisobda sekinlashdi, ' +
        'lekin oziq-ovqat narxlari o‘sishda davom etmoqda. Tadbirkorlar kredit stavkalari yuqoraligidan ' +
        'shikoyat qilmoqda. Bank keyingi yig‘ilishda stavkani pasaytirish mumkinligini aytdi. ' +
        'Valyuta bozorida so‘m barqaror, dollar kursi oyiga 0,4 foizga o‘sdi.',
    },
  },
  {
    name: 'qisqartma: hisobot',
    task: {
      kind: 'summarize',
      maxSentences: 2,
      text:
        'Sentyabr oyida kompaniya 39,7 mln so‘m tushum oldi. Xarajatlar 10,5 mln so‘mni tashkil qildi. ' +
        'Eng katta xarajat — ofis arendasi. Reklama byudjeti oshirildi, natijada lidlar soni 26 taga yetdi. ' +
        'Bitta lid narxi 93 ming so‘m bo‘ldi. Sotuvdan tushgan foyda 32,4 mln so‘m.',
    },
  },

  // --- Maslahat: faqat berilgan faktlarga tayanishi kerak ---
  {
    name: 'maslahat: moliya',
    forbid: [/\b\d{1,3}\s?(mln|million)\b/i],
    task: {
      kind: 'advise',
      topic: 'Shaxsiy moliya, sentyabr',
      facts: [
        '"kerakmas" xarajatlar: 1 520 000 UZS (14%)',
        '"arenda" toifasi barcha chiqimning 47% ini yeyapti',
        'Jamg‘arma darajasi 8% — maqsad kamida 10-20%',
      ],
      question: 'Qanday tejash mumkin? 3 ta aniq qadam ayt.',
    },
  },
];

/**
 * O'zbekcha lotin matnimi? Model ruschaga yoki inglizchaga o'tib ketmadimi?
 * Aniq til aniqlash emas — qo'pol, lekin modelni ajratishga yetadi.
 */
function looksUzbek(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;
  if (/[а-яё]/.test(t)) return false; // kirill alifbo => o'zbek lotin emas

  const english = [' the ', ' and ', ' of ', ' to ', ' is ', ' for ', ' with ', ' this '];
  if (english.filter((w) => t.includes(w)).length >= 3) return false;

  // o‘ / g‘ harflari lotin yozuvlari orasida deyarli faqat o'zbekchada uchraydi.
  let score = /[og][‘'’`]/.test(t) ? 2 : 0;

  const markers = [
    'ning', 'lar', 'uchun', 'kerak', 'qil', 'yoki', 'bilan', 'emas', 'ida', 'dagi',
    'ni ', 'ga ', 'dan ', 'da ', 'xarajat', 'foiz', 'kam', 'osh', 'ish', 'gan ',
  ];
  score += Math.min(3, markers.filter((m) => t.includes(m)).length);

  return score >= 2;
}

async function main(): Promise<void> {
  await loadDotEnv('.env');
  const cfg = loadConfig();
  const llm = makeLlm(cfg);

  console.log(`Model: ${llm.id}`);
  if (cfg.llm === 'local') console.log(`Server: ${cfg.llmUrl}`);
  console.log(`Testlar: ${CASES.length} ta\n`);

  const rows: (string | number)[][] = [];
  let classifyOk = 0;
  let classifyTotal = 0;
  let langOk = 0;
  let langTotal = 0;
  let forbidHits = 0;
  let totalMs = 0;

  for (const c of CASES) {
    const started = Date.now();
    let text = '';
    let note = '';
    let verdict = '✓';

    try {
      const res = await llm.run(c.task);
      text = res.text;

      if (c.expect) {
        classifyTotal++;
        const hit = res.label === c.expect;
        if (hit) classifyOk++;
        else verdict = '✗';
        note = hit ? c.expect : `kutilgan "${c.expect}", olingan "${res.label ?? '—'}"`;
      } else {
        langTotal++;
        const uz = looksUzbek(text);
        if (uz) langOk++;
        else verdict = '✗';
        note = uz ? `${text.split(/\s+/).length} so‘z` : 'o‘zbekcha emas';

        for (const re of c.forbid ?? []) {
          if (re.test(text)) {
            forbidHits++;
            verdict = '✗';
            note += ' · o‘ylab topilgan raqam';
          }
        }
      }
    } catch (e) {
      verdict = '✗';
      note = (e as Error).message.slice(0, 60);
    }

    const ms = Date.now() - started;
    totalMs += ms;
    rows.push([verdict, c.name, `${(ms / 1000).toFixed(1)}s`, note]);
    if (process.env['HAMROH_EVAL_VERBOSE'] === '1' && text) console.log(`\n--- ${c.name} ---\n${text}\n`);
  }

  console.log(table(['', 'Test', 'Vaqt', 'Natija'], rows));
  console.log(
    [
      '',
      `Toifalash aniqligi: ${classifyOk}/${classifyTotal}`,
      `O‘zbek tili:        ${langOk}/${langTotal}`,
      `O‘ylab topilgan raqam: ${forbidHits} ta`,
      `O‘rtacha javob vaqti:  ${(totalMs / CASES.length / 1000).toFixed(1)}s`,
      '',
      'To‘liq javoblarni ko‘rish:  HAMROH_EVAL_VERBOSE=1 node scripts/eval-llm.ts',
    ].join('\n'),
  );
}

void main();

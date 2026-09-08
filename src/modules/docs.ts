import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { dateKey } from '../util/date.ts';
import { writeDocx, writeXlsx, readCsv } from '../util/office.ts';
import type { DocBlock } from '../util/office.ts';
import { writeReport } from '../report/html.ts';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** (9) Hujjatlar: Word, Excel, PDF uchun tayyor HTML, taqdimot va kontent reja. */

/** Oddiy markdown → docx bloklari. */
function mdToBlocks(md: string): DocBlock[] {
  const out: DocBlock[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('### ')) out.push({ style: 'h2', text: line.slice(4) });
    else if (line.startsWith('## ')) out.push({ style: 'h1', text: line.slice(3) });
    else if (line.startsWith('# ')) out.push({ style: 'title', text: line.slice(2) });
    else if (/^\s*[-*•]\s+/.test(line)) out.push({ style: 'li', text: line.replace(/^\s*[-*•]\s+/, '') });
    else out.push({ style: 'p', text: line });
  }
  return out;
}

const SLIDES_CSS = `
body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#0f1220;color:#eef1f8}
.slide{min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:8vh 10vw;
  border-bottom:1px solid #222842;page-break-after:always}
h1{font-size:44px;margin:0 0 12px;letter-spacing:-.02em}
h2{font-size:30px;margin:0 0 18px;color:#9fb0ff}
ul{font-size:20px;line-height:1.8;padding-left:24px}
.num{position:absolute;right:6vw;font-size:13px;color:#6a7392}
@media print{body{background:#fff;color:#111}.slide{min-height:auto;height:100vh}h2{color:#33489c}}
`;

function slidesHtml(title: string, slides: { heading: string; bullets: string[] }[]): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = slides
    .map(
      (s, i) => `<section class="slide"><span class="num">${i + 1}/${slides.length}</span>
      ${i === 0 ? `<h1>${esc(s.heading)}</h1>` : `<h2>${esc(s.heading)}</h2>`}
      <ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>${SLIDES_CSS}</style></head><body>${body}</body></html>`;
}

export const docsModule: Module = {
  id: 'hujjat',
  title: 'Hujjatlar va kontent',
  about: 'Word (.docx), Excel (.xlsx), PDF uchun HTML, taqdimot va kontent reja.',

  commands: [
    {
      name: 'word',
      usage: 'hujjat word "<sarlavha>" [--from=matn.md] [--text="..."]',
      about: 'Word hujjat (.docx) yaratish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.at(0) || 'Hujjat';
        const src = a.str('from');
        const body = src && existsSync(src) ? readFileSync(src, 'utf8') : a.str('text', '');
        if (!body) return { text: 'Matn kerak: --from=fayl.md yoki --text="..."' };
        const blocks: DocBlock[] = [{ style: 'title', text: title }, ...mdToBlocks(body)];
        const file = writeDocx(join(ctx.cfg.outDir, `${title.replace(/[^\wЀ-ӿ-]+/g, '_')}.docx`), blocks);
        return { text: `📄 Word tayyor: ${file}\n   Word yoki WPS Writer da ochiladi.`, files: [file] };
      },
    },
    {
      name: 'excel',
      usage: 'hujjat excel "<nom>" --from=<fayl.csv>',
      about: 'CSV dan Excel (.xlsx) yasash.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const name = a.at(0) || 'jadval';
        const src = a.str('from');
        if (!src || !existsSync(src)) return { text: 'CSV fayl kerak: --from=./data.csv' };
        const { headers, rows } = readCsv(readFileSync(src, 'utf8'));
        const file = writeXlsx(join(ctx.cfg.outDir, `${name}.xlsx`), [
          { name: name.slice(0, 28), headers, rows: rows.map((r) => r.map((c) => (Number(c) && c !== '' ? Number(c) : c))) },
        ]);
        return { text: `📊 Excel tayyor: ${file}`, files: [file] };
      },
    },
    {
      name: 'pdf',
      usage: 'hujjat pdf "<sarlavha>" [--from=matn.md]',
      about: 'PDF uchun chop etishga tayyor HTML (brauzerda Ctrl+P → Save as PDF).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.at(0) || 'Hujjat';
        const src = a.str('from');
        const body = src && existsSync(src) ? readFileSync(src, 'utf8') : a.str('text', '');
        const lines = body.split(/\r?\n/).filter((l) => l.trim());
        const file = writeReport(join(ctx.cfg.outDir, `${title.replace(/[^\wЀ-ӿ-]+/g, '_')}.html`), {
          title,
          subtitle: dateKey(ctx.now, ctx.cfg.tz),
          blocks: [{ type: 'text', body: lines.length ? lines : ['(matn kiritilmagan)'] }],
        });
        return {
          text: `📄 ${file}\n   Brauzerda oching → Ctrl+P → "Save as PDF".\n   (To‘g‘ridan-to‘g‘ri PDF uchun bosqich 3 da headless brauzer qo‘shiladi.)`,
          files: [file],
        };
      },
    },
    {
      name: 'slides',
      usage: 'hujjat slides "<mavzu>" [--points="a|b|c"] [--slides=6]',
      about: 'Taqdimot (HTML slaydlar, PDF ga chop etiladi).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const topic = a.at(0);
        if (!topic) return { text: 'Mavzu kerak: hujjat slides "2026 marketing strategiyasi"' };
        const manual = a.str('points').split('|').map((s) => s.trim()).filter(Boolean);

        let slides: { heading: string; bullets: string[] }[];
        if (manual.length) {
          slides = [{ heading: topic, bullets: ['Hamroh tayyorladi', dateKey(ctx.now, ctx.cfg.tz)] },
            ...manual.map((m) => ({ heading: m, bullets: ['—'] }))];
        } else {
          const res = await ctx.llm.run({
            kind: 'advise',
            topic: `Taqdimot rejasi: ${topic}`,
            facts: [`Slaydlar soni: ${a.num('slides', 6)}`],
            question: 'Har bir slayd uchun sarlavha va 3 ta punkt yoz.',
          });
          slides = [
            { heading: topic, bullets: [dateKey(ctx.now, ctx.cfg.tz)] },
            ...res.text
              .split(/\n{2,}/)
              .filter((b) => b.trim())
              .slice(0, a.num('slides', 6))
              .map((b) => {
                const [head = topic, ...rest] = b.split('\n');
                return { heading: head.replace(/^[-*\d.\s]+/, ''), bullets: rest.map((r) => r.replace(/^[-*\s]+/, '')).filter(Boolean) };
              }),
          ];
        }

        const file = join(ctx.cfg.outDir, `taqdimot-${dateKey(ctx.now, ctx.cfg.tz)}.html`);
        mkdirSync(ctx.cfg.outDir, { recursive: true });
        writeFileSync(file, slidesHtml(topic, slides), 'utf8');
        return { text: `🎞 Taqdimot: ${file}\n   ${slides.length} ta slayd. Ctrl+P → PDF.`, files: [file] };
      },
    },
    {
      name: 'content',
      usage: 'hujjat content "<mavzu>" [--count=7] [--platform=instagram]',
      about: 'Kontent reja tuzish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const topic = a.at(0);
        if (!topic) return { text: 'Mavzu kerak: hujjat content "kurslar" --count=7' };
        const count = a.num('count', 7);
        const platform = a.str('platform', 'instagram');

        const res = await ctx.llm.run({
          kind: 'advise',
          topic: `${platform} uchun kontent reja: ${topic}`,
          facts: [`Postlar soni: ${count}`, `Platforma: ${platform}`],
          question: 'Har bir post uchun: sarlavha, formati (reels/karusel/post) va qisqa ssenariy.',
        });

        if (!ctx.llm.smart) {
          // LLM'siz — ishlaydigan skelet reja beramiz.
          const formats = ['reels', 'karusel', 'post', 'story', 'reels', 'karusel', 'post'];
          const angles = ['muammo → yechim', 'mijoz natijasi', 'ichki jarayon', 'savol-javob', 'taqqoslash', 'xato va tuzatish', 'taklif'];
          const lines = Array.from({ length: count }, (_, i) => {
            const day = i + 1;
            return `${day}-kun · ${formats[i % formats.length]} · ${topic}: ${angles[i % angles.length]}`;
          });
          return { text: [`${platform} — ${count} kunlik reja:`, ...lines.map((l) => `  ${l}`), '', '(LLM ulansa — to‘liq ssenariy yoziladi.)'].join('\n') };
        }
        return { text: res.text };
      },
    },
  ],
};

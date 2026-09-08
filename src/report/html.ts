import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Chiroyli HTML hisobot — bog'liqliksiz, ichki SVG diagrammalar bilan.
 * Brauzerda ochiladi, Ctrl+P orqali PDF ga saqlanadi.
 */

export type Kpi = { label: string; value: string; delta?: string; up?: boolean };
export type Series = { label: string; value: number };

export type Block =
  | { type: 'kpis'; items: Kpi[] }
  | { type: 'text'; title?: string; body: string[] }
  | { type: 'table'; title?: string; headers: string[]; rows: (string | number)[][] }
  | { type: 'bars'; title?: string; unit?: string; items: Series[] }
  | { type: 'line'; title?: string; unit?: string; points: Series[] };

export type Report = { title: string; subtitle?: string; blocks: Block[] };

const esc = (s: string | number): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const PALETTE = ['#4f7cff', '#22c197', '#f2b544', '#ef6461', '#9b6dff', '#3fb6d8', '#e07be0'];

function barsSvg(items: Series[], unit: string): string {
  if (!items.length) return '<p class="muted">Ma’lumot yo‘q.</p>';
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  const rowH = 34;
  const h = items.length * rowH + 10;
  const labelW = 150;
  const chartW = 620;
  const rows = items
    .map((it, i) => {
      const w = Math.max(2, (Math.abs(it.value) / max) * (chartW - labelW - 110));
      const y = i * rowH + 6;
      const color = PALETTE[i % PALETTE.length];
      return `
    <g>
      <text x="0" y="${y + 16}" class="lbl">${esc(it.label)}</text>
      <rect x="${labelW}" y="${y + 4}" width="${w}" height="18" rx="4" fill="${color}"/>
      <text x="${labelW + w + 8}" y="${y + 18}" class="val">${esc(fmtNum(it.value))}${unit ? ` ${esc(unit)}` : ''}</text>
    </g>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${chartW} ${h}" width="100%" height="${h}" role="img">${rows}</svg>`;
}

function lineSvg(points: Series[], unit: string): string {
  if (points.length < 2) return '<p class="muted">Diagramma uchun kamida 2 nuqta kerak.</p>';
  const w = 620;
  const h = 220;
  const pad = { l: 46, r: 12, t: 14, b: 28 };
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const x = (i: number): number => pad.l + (i * (w - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number): number => h - pad.b - ((v - min) / (max - min || 1)) * (h - pad.t - pad.b);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${h - pad.b} L${x(0).toFixed(1)},${h - pad.b} Z`;
  const grid = [0, 0.5, 1]
    .map((f) => {
      const gy = pad.t + f * (h - pad.t - pad.b);
      const gv = max - f * (max - min);
      return `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" class="grid"/>
              <text x="4" y="${gy + 4}" class="axis">${esc(fmtNum(gv))}</text>`;
    })
    .join('');
  const ticks = points
    .map((p, i) => (i % Math.ceil(points.length / 6) === 0 ? `<text x="${x(i)}" y="${h - 8}" class="axis mid">${esc(p.label)}</text>` : ''))
    .join('');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="#4f7cff"/>`).join('');

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">
    ${grid}
    <path d="${area}" fill="rgba(79,124,255,.12)"/>
    <path d="${path}" fill="none" stroke="#4f7cff" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}${ticks}
    <title>${esc(unit)}</title>
  </svg>`;
}

function fmtNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} mlrd`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} mln`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)} ming`;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
}

function block(b: Block): string {
  switch (b.type) {
    case 'kpis':
      return `<section class="kpis">${b.items
        .map(
          (k) => `<div class="kpi">
            <div class="kpi-label">${esc(k.label)}</div>
            <div class="kpi-value">${esc(k.value)}</div>
            ${k.delta ? `<div class="kpi-delta ${k.up ? 'up' : 'down'}">${esc(k.delta)}</div>` : ''}
          </div>`,
        )
        .join('')}</section>`;
    case 'text':
      return `<section class="card">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}
        <ul>${b.body.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`;
    case 'table':
      return `<section class="card">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}
        <div class="scroll"><table>
          <thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div></section>`;
    case 'bars':
      return `<section class="card">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${barsSvg(b.items, b.unit ?? '')}</section>`;
    case 'line':
      return `<section class="card">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${lineSvg(b.points, b.unit ?? '')}</section>`;
  }
}

const CSS = `
:root { color-scheme: light; --bg:#f6f7fb; --card:#fff; --ink:#141a2a; --muted:#6b7488; --line:#e6e9f2; }
* { box-sizing: border-box; }
body { margin:0; padding:28px; background:var(--bg); color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
.wrap { max-width: 900px; margin: 0 auto; }
header { margin-bottom: 20px; }
h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
.sub { color: var(--muted); font-size: 14px; }
.card { background: var(--card); border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin-bottom:16px; }
h2 { font-size:15px; margin:0 0 14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
.kpi-label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.kpi-value { font-size:22px; font-weight:600; margin-top:4px; }
.kpi-delta { font-size:13px; margin-top:2px; }
.kpi-delta.up { color:#12a06a; } .kpi-delta.down { color:#d64545; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
tr:last-child td { border-bottom:none; }
.scroll { overflow-x:auto; }
ul { margin:0; padding-left:18px; } li { margin:4px 0; }
.muted { color:var(--muted); }
.lbl { font-size:13px; fill:var(--ink); } .val { font-size:13px; fill:var(--muted); }
.axis { font-size:11px; fill:var(--muted); } .mid { text-anchor:middle; }
.grid { stroke:var(--line); stroke-width:1; }
footer { color:var(--muted); font-size:12px; text-align:center; margin-top:22px; }
@media print { body { background:#fff; padding:0; } .card,.kpi { break-inside:avoid; } }
`;

export function renderHtml(r: Report): string {
  return `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(r.title)}</title><style>${CSS}</style></head>
<body><div class="wrap">
<header><h1>${esc(r.title)}</h1>${r.subtitle ? `<div class="sub">${esc(r.subtitle)}</div>` : ''}</header>
${r.blocks.map(block).join('\n')}
<footer>Hamroh · avtomatik hisobot</footer>
</div></body></html>`;
}

export function writeReport(path: string, r: Report): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderHtml(r), 'utf8');
  return path;
}

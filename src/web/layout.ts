/**
 * Veb-panel qobig'i: HTML, uslub va takrorlanuvchi bo'laklar.
 *
 * Qurilish qadami yo'q — sahifalar serverda yig'iladi. Shu sabab panel
 * loyihaning qolgan qismi kabi hech qanday npm paketiga bog'liq emas.
 */

export const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export type NavItem = { href: string; label: string };

export const NAV: NavItem[] = [
  { href: '/', label: 'Bosh sahifa' },
  { href: '/vazifa', label: 'Vazifalar' },
  { href: '/kalendar', label: 'Kalendar' },
  { href: '/moliya', label: 'Moliya' },
  { href: '/lid', label: 'Lidlar' },
  { href: '/sozlama', label: 'Sozlamalar' },
];

const CSS = `
:root { color-scheme: light dark; --bg:#f5f6fa; --card:#fff; --ink:#141a2a; --muted:#6b7488;
  --line:#e5e8f0; --accent:#4f7cff; --ok:#12a06a; --warn:#d98324; --bad:#d64545; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f1220; --card:#171b2c; --ink:#e8ebf5; --muted:#98a0b8; --line:#242a41; }
}
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
a { color:var(--accent); text-decoration:none; }
header { background:var(--card); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:10; }
.bar { max-width:960px; margin:0 auto; padding:12px 16px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.brand { font-weight:700; letter-spacing:-.02em; font-size:17px; color:var(--ink); }
nav { display:flex; gap:14px; flex-wrap:wrap; }
nav a { color:var(--muted); font-size:14px; padding:4px 0; border-bottom:2px solid transparent; }
nav a.on { color:var(--ink); border-color:var(--accent); }
main { max-width:960px; margin:0 auto; padding:20px 16px 60px; }
h1 { font-size:22px; margin:0 0 4px; letter-spacing:-.02em; }
.sub { color:var(--muted); font-size:14px; margin-bottom:18px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin-bottom:14px; }
.card h2 { font-size:12px; margin:0 0 12px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:14px; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
.kpi b { display:block; font-size:20px; font-weight:600; margin-top:2px; }
.kpi span { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.kpi i { font-style:normal; font-size:13px; }
.up { color:var(--ok); } .down { color:var(--bad); } .warn { color:var(--warn); }
table { width:100%; border-collapse:collapse; font-size:14px; }
th,td { text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:600; }
tr:last-child td { border-bottom:none; }
.scroll { overflow-x:auto; }
form.row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
input,select,textarea { font:inherit; color:var(--ink); background:var(--bg);
  border:1px solid var(--line); border-radius:9px; padding:8px 10px; min-width:0; }
input:focus,select:focus,textarea:focus { outline:2px solid var(--accent); outline-offset:-1px; }
input[type=text],input[type=number] { flex:1 1 160px; }
button { font:inherit; font-weight:600; cursor:pointer; border:0; border-radius:9px;
  padding:9px 14px; background:var(--accent); color:#fff; }
button.ghost { background:transparent; color:var(--muted); border:1px solid var(--line); font-weight:500; padding:5px 10px; }
button:hover { filter:brightness(1.06); }
.muted { color:var(--muted); }
.empty { color:var(--muted); padding:6px 0; }
.pill { display:inline-block; font-size:12px; padding:2px 9px; border-radius:99px; border:1px solid var(--line); color:var(--muted); }
.pill.ok { color:var(--ok); border-color:currentColor; }
.pill.bad { color:var(--bad); border-color:currentColor; }
.note { background:var(--bg); border:1px dashed var(--line); border-radius:10px; padding:10px 12px; font-size:13px; color:var(--muted); }
.flash { border-radius:10px; padding:10px 14px; margin-bottom:14px; font-size:14px; }
.flash.ok { background:rgba(18,160,106,.12); color:var(--ok); }
.flash.bad { background:rgba(214,69,69,.12); color:var(--bad); }
ul.plain { margin:0; padding-left:18px; } ul.plain li { margin:3px 0; }
.bars { display:flex; flex-direction:column; gap:7px; }
.bars div { display:grid; grid-template-columns:120px 1fr auto; gap:10px; align-items:center; font-size:14px; }
.bars .track { background:var(--bg); border-radius:99px; height:9px; overflow:hidden; }
.bars .fill { background:var(--accent); height:100%; }
footer { text-align:center; color:var(--muted); font-size:12px; padding:20px 0 40px; }
`;

export type PageOptions = {
  title: string;
  subtitle?: string;
  path: string;
  flash?: { kind: 'ok' | 'bad'; text: string };
};

export function page(opts: PageOptions, body: string): string {
  const nav = NAV.map(
    (n) => `<a href="${n.href}" class="${n.href === opts.path ? 'on' : ''}">${esc(n.label)}</a>`,
  ).join('');

  const flash = opts.flash
    ? `<div class="flash ${opts.flash.kind}">${esc(opts.flash.text)}</div>`
    : '';

  return `<!doctype html>
<html lang="uz"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(opts.title)} — Hamroh</title>
<style>${CSS}</style>
</head><body>
<header><div class="bar"><span class="brand">Hamroh</span><nav>${nav}</nav></div></header>
<main>
  <h1>${esc(opts.title)}</h1>
  ${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ''}
  ${flash}
  ${body}
</main>
<footer>Hamroh · shaxsiy yordamchi</footer>
</body></html>`;
}

/** Ko'rsatkich kartochkasi. */
export function kpi(label: string, value: string, delta?: string, up?: boolean): string {
  return `<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b>${
    delta ? `<i class="${up ? 'up' : 'down'}">${esc(delta)}</i>` : ''
  }</div>`;
}

export function card(title: string, inner: string): string {
  return `<section class="card"><h2>${esc(title)}</h2>${inner}</section>`;
}

export function table(headers: string[], rows: string[][], empty = 'Ma’lumot yo‘q.'): string {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="scroll"><table><thead><tr>${headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

/** Gorizontal ustunlar — toifalar taqsimoti uchun. */
export function bars(items: { label: string; value: number; text: string }[]): string {
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="bars">${items
    .map(
      (i) =>
        `<div><span>${esc(i.label)}</span><span class="track"><span class="fill" style="width:${
          Math.round((i.value / max) * 100)
        }%"></span></span><span class="muted">${esc(i.text)}</span></div>`,
    )
    .join('')}</div>`;
}

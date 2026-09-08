import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { zip } from './zip.ts';

/**
 * Bog'liqliksiz Office eksporti: .xlsx (Excel/WPS) va .docx (Word/WPS Writer).
 * Formulasiz, oddiy jadval va matn — kunlik hisobotlar uchun yetarli.
 */

export type Sheet = { name: string; headers: string[]; rows: (string | number | null)[][] };

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i: number): string => {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

function sheetXml(sheet: Sheet): string {
  const rows: string[] = [];
  const push = (values: (string | number | null)[], rowIdx: number, styleHeader: boolean): void => {
    const cells = values.map((v, i) => {
      const ref = `${colName(i)}${rowIdx}`;
      if (v === null || v === undefined || v === '') return `<c r="${ref}"${styleHeader ? ' s="1"' : ''}/>`;
      if (typeof v === 'number' && Number.isFinite(v)) {
        return `<c r="${ref}"${styleHeader ? ' s="1"' : ''}><v>${v}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${styleHeader ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    });
    rows.push(`<row r="${rowIdx}">${cells.join('')}</row>`);
  };
  push(sheet.headers, 1, true);
  sheet.rows.forEach((r, i) => push(r, i + 2, false));
  const cols = sheet.headers
    .map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(48, Math.max(12, h.length + 6))}" customWidth="1"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

export function writeXlsx(path: string, sheets: Sheet[]): string {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', headers: ['bo‘sh'], rows: [] }];
  const entries = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list
        .map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, zip(entries));
  return path;
}

export type DocBlock = { style: 'title' | 'h1' | 'h2' | 'p' | 'li'; text: string };

export function writeDocx(path: string, blocks: DocBlock[]): string {
  const sizes: Record<DocBlock['style'], { size: number; bold: boolean }> = {
    title: { size: 40, bold: true },
    h1: { size: 30, bold: true },
    h2: { size: 26, bold: true },
    p: { size: 22, bold: false },
    li: { size: 22, bold: false },
  };
  const body = blocks
    .map((b) => {
      const f = sizes[b.style];
      const ind = b.style === 'li' ? '<w:ind w:left="360"/>' : '';
      const text = b.style === 'li' ? `• ${b.text}` : b.text;
      return `<w:p><w:pPr>${ind}<w:spacing w:after="120"/></w:pPr><w:r><w:rPr>${f.bold ? '<w:b/>' : ''}<w:sz w:val="${f.size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    })
    .join('');

  const entries = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`,
    },
  ];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, zip(entries));
  return path;
}

export function writeCsv(path: string, headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [headers.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\r\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `﻿${text}`, 'utf8');
  return path;
}

export function readCsv(text: string, sep = ''): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  const delimiter = sep || (clean.split('\n')[0]?.includes(';') ? ';' : ',');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delimiter) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const headers = parseLine(lines[0] ?? '');
  return { headers, rows: lines.slice(1).map(parseLine) };
}

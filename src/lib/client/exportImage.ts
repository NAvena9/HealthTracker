'use client';
// Client-side PNG export of the Weekly Hub summary, drawn straight on a canvas (no libraries).
// All strings arrive pre-formatted from the Weekly Hub (formulas stay in @/lib/domain).

export interface ExportKpi {
  label: string;
  value: string;
  sub: string;
}
export interface WeekExportData {
  filename: string;
  title: string; // "Week 5"
  range: string; // "Nov 9 – Nov 15"
  status: string; // "Closed Nov 16"
  kpis: ExportKpi[];
  ledgerHeader: string[];
  ledgerRows: string[][];
  ledgerFooter: string[][];
  energyLines: string[];
  sessionLines: string[];
  measurements: { label: string; value: string }[];
  reflections: { label: string; text: string }[];
  folderUrl: string | null;
}

const W = 1200;
const PAD = 48;
const SCALE = 2;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, "Segoe UI", Roboto, Arial, sans-serif';
const C = { bg: '#f2f2f7', card: '#ffffff', text: '#1c1c1e', text2: '#636366', line: '#e5e5ea', elevated: '#f7f7fa', blue: '#0a5fd0' };

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}
function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}
function card(ctx: Ctx, y: number, h: number, draw: boolean) {
  if (!draw) return;
  ctx.fillStyle = C.card;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(PAD, y, W - PAD * 2, h, 20);
  ctx.fill();
  ctx.stroke();
}
function text(ctx: Ctx, s: string, x: number, y: number, o: { size: number; weight?: number; color?: string; align?: CanvasTextAlign }) {
  font(ctx, o.size, o.weight);
  ctx.fillStyle = o.color ?? C.text;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** Lays out (and, when `draw`, paints) the whole sheet. Returns the total height. */
function layout(ctx: Ctx, d: WeekExportData, draw: boolean): number {
  let y = PAD;
  text(ctx, 'PROOF OF WORK', PAD, y + 12, { size: 13, weight: 700, color: C.text2 });
  y += 44;
  if (draw) text(ctx, d.title, PAD, y + 10, { size: 44, weight: 700 });
  if (draw) text(ctx, d.status, W - PAD, y + 10, { size: 18, weight: 600, color: C.text2, align: 'right' });
  y += 36;
  if (draw) text(ctx, d.range, PAD, y + 8, { size: 20, color: C.text2 });
  y += 40;

  // KPIs
  const gap = 16;
  const kw = (W - PAD * 2 - gap * 3) / 4;
  d.kpis.forEach((k, i) => {
    const x = PAD + i * (kw + gap);
    if (draw) {
      ctx.fillStyle = C.card;
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.roundRect(x, y, kw, 132, 20);
      ctx.fill();
      ctx.stroke();
      text(ctx, k.label.toUpperCase(), x + 18, y + 30, { size: 12, weight: 700, color: C.text2 });
      text(ctx, k.value, x + 18, y + 76, { size: 36, weight: 700 });
      text(ctx, k.sub, x + 18, y + 108, { size: 14, color: C.text2 });
    }
  });
  y += 132 + 20;

  // Ledger
  const cols = d.ledgerHeader.length;
  const first = 150;
  const second = 80;
  const rest = (W - PAD * 2 - 32 - first - second) / Math.max(1, cols - 2);
  const colX = (i: number) => (i === 0 ? 0 : i === 1 ? first : first + second + (i - 2) * rest);
  const colW = (i: number) => (i === 0 ? first : i === 1 ? second : rest);
  const rows = d.ledgerRows.length + d.ledgerFooter.length;
  const lh = 34;
  const ledgerH = 28 + 40 + 8 + rows * lh + 24;
  card(ctx, y, ledgerH, draw);
  if (draw) {
    text(ctx, 'Daily ledger', PAD + 16, y + 36, { size: 20, weight: 700 });
    let ry = y + 28 + 40;
    const x0 = PAD + 16;
    const cell = (s: string, i: number, yy: number, bold: boolean, color: string) => {
      const left = i < 2;
      text(ctx, s, left ? x0 + colX(i) : x0 + colX(i) + colW(i) - 6, yy, { size: 14, weight: bold ? 700 : 400, color, align: left ? 'left' : 'right' });
    };
    d.ledgerHeader.forEach((h, i) => cell(h.toUpperCase(), i, ry, true, C.text2));
    ry += 10;
    ctx.fillStyle = C.line;
    ctx.fillRect(x0, ry - 2, W - PAD * 2 - 32, 1);
    d.ledgerRows.forEach((r) => {
      ry += lh;
      r.forEach((s, i) => cell(s, i, ry - 10, i === 0, C.text));
    });
    ry += 6;
    ctx.fillStyle = C.elevated;
    ctx.fillRect(x0 - 8, ry, W - PAD * 2 - 16, d.ledgerFooter.length * lh + 4);
    d.ledgerFooter.forEach((r) => {
      ry += lh;
      r.forEach((s, i) => cell(s, i, ry - 10, true, C.text));
    });
  }
  y += ledgerH + 20;

  // Energy + sessions
  const half = (W - PAD * 2 - gap) / 2;
  const blockLines = Math.max(d.energyLines.length, d.sessionLines.length);
  const bh = 64 + blockLines * 28 + 12;
  [
    { t: 'Energy balance', lines: d.energyLines, x: PAD },
    { t: 'Sessions', lines: d.sessionLines, x: PAD + half + gap },
  ].forEach((b) => {
    if (draw) {
      ctx.fillStyle = C.card;
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.roundRect(b.x, y, half, bh, 20);
      ctx.fill();
      ctx.stroke();
      text(ctx, b.t, b.x + 18, y + 36, { size: 20, weight: 700 });
      b.lines.forEach((l, i) => text(ctx, l, b.x + 18, y + 72 + i * 28, { size: 16, color: i === 0 ? C.text : C.text2, weight: i === 0 ? 600 : 400 }));
    }
  });
  y += bh + 20;

  // Measurements
  const mh = 64 + 56 + 12;
  card(ctx, y, mh, draw);
  if (draw) {
    text(ctx, 'Measurements (cm)', PAD + 16, y + 36, { size: 20, weight: 700 });
    const mw = (W - PAD * 2 - 32) / Math.max(1, d.measurements.length);
    d.measurements.forEach((m, i) => {
      text(ctx, m.label.toUpperCase(), PAD + 16 + i * mw, y + 74, { size: 12, weight: 700, color: C.text2 });
      text(ctx, m.value, PAD + 16 + i * mw, y + 102, { size: 26, weight: 700 });
    });
  }
  y += mh + 20;

  // Reflection
  const tw = W - PAD * 2 - 32;
  font(ctx, 16, 400);
  const blocks = d.reflections.map((r) => ({ label: r.label, lines: r.text.trim() ? wrap(ctx, r.text, tw) : ['—'] }));
  let rh = 64;
  blocks.forEach((b) => (rh += 26 + b.lines.length * 24 + 14));
  if (d.folderUrl) rh += 30;
  card(ctx, y, rh, draw);
  if (draw) {
    text(ctx, 'Weekly reflection', PAD + 16, y + 36, { size: 20, weight: 700 });
    let ry = y + 64;
    blocks.forEach((b) => {
      text(ctx, b.label, PAD + 16, ry + 16, { size: 14, weight: 700, color: C.text2 });
      ry += 26;
      b.lines.forEach((l) => {
        text(ctx, l, PAD + 16, ry + 16, { size: 16 });
        ry += 24;
      });
      ry += 14;
    });
    if (d.folderUrl) text(ctx, `Backup folder: ${d.folderUrl}`, PAD + 16, ry + 18, { size: 14, color: C.blue });
  }
  y += rh + 20;

  if (draw) text(ctx, 'Exported from Proof of Work', W / 2, y + 12, { size: 13, color: C.text2, align: 'center' });
  y += 24 + PAD;
  return y;
}

/** Draws the summary on a canvas (2x for crisp text). */
export function renderWeekCanvas(d: WeekExportData): HTMLCanvasElement {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('Canvas is not available');
  const H = Math.ceil(layout(probe, d, false));
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  layout(ctx, d, true);
  return canvas;
}

/** Renders the PNG and triggers a download. */
export async function exportWeekPng(d: WeekExportData): Promise<void> {
  const canvas = renderWeekCanvas(d);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not create the image');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = d.filename.endsWith('.png') ? d.filename : `${d.filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

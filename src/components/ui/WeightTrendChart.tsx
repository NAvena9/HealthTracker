export interface TrendPoint {
  /** Axis label, e.g. "W5". */
  label: string;
  /** Spoken label, e.g. "Week 5". */
  name: string;
  value: number | null;
}

const W = 640;
const H = 240;
const PAD = { l: 44, r: 16, t: 24, b: 30 };
const f1 = (n: number) => n.toFixed(1);

/** Hand-written SVG line chart of weekly average weights + dashed target line. Marks A and B. */
export function WeightTrendChart({ points, target, markA, markB }: { points: TrendPoint[]; target: number | null; markA: number | null; markB: number | null }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const all = target !== null ? [...vals, target] : vals;
  if (!all.length) return <p className="sub small">No weights logged yet.</p>;
  const lo0 = Math.min(...all);
  const hi0 = Math.max(...all);
  const step = hi0 - lo0 > 12 ? 5 : hi0 - lo0 > 5 ? 2 : 1;
  const lo = Math.floor((lo0 - 0.5) / step) * step;
  const hi = Math.max(Math.ceil((hi0 + 0.5) / step) * step, lo + step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);
  const n = points.length;
  const X = (i: number) => PAD.l + 14 + (W - PAD.l - PAD.r - 28) * (n <= 1 ? 0.5 : i / (n - 1));
  const Y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo));
  // break the line at weeks without a weight
  let path = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    path += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)} `;
    pen = true;
  });
  const every = Math.ceil(n / 10);
  const summary = points.filter((p) => p.value !== null).map((p) => `${p.name} ${f1(p.value as number)} kg`).join(', ');
  const mark = (i: number, tag: string, col: 'blue' | 'indigo') => {
    const p = points[i];
    if (!p || p.value === null) return null;
    const x = X(i);
    const y = Y(p.value);
    return (
      <g key={tag}>
        <circle cx={x} cy={y} r={9} style={{ fill: 'var(--card)', stroke: `var(--${col})`, strokeWidth: 3 }} />
        <text x={x} y={y + 4} textAnchor="middle" style={{ fill: `var(--${col}-text)`, font: '700 11px system-ui' }}>
          {tag}
        </text>
        <text x={x} y={y - 15} textAnchor="middle" style={{ fill: 'var(--text)', font: '600 12px system-ui' }}>
          {f1(p.value)}
        </text>
      </g>
    );
  };
  return (
    <div className="chartbox">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="wtc-t wtc-d">
        <title id="wtc-t">Weight trend</title>
        <desc id="wtc-d">{`Weekly average weight in kilograms: ${summary || 'no data'}.${target !== null ? ` Target ${f1(target)} kg.` : ''}`}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} style={{ stroke: 'var(--hairline)' }} />
            <text x={PAD.l - 8} y={Y(t) + 4} textAnchor="end" style={{ fill: 'var(--text2)', font: '500 11px system-ui' }}>
              {t}
            </text>
          </g>
        ))}
        {target !== null ? (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(target)} y2={Y(target)} strokeDasharray="6 5" strokeWidth={2} style={{ stroke: 'var(--green)' }} />
            <text x={W - PAD.r} y={Y(target) - 6} textAnchor="end" style={{ fill: 'var(--green-text)', font: '600 11px system-ui' }}>
              {`Target ${f1(target)} kg`}
            </text>
          </g>
        ) : null}
        {points.map((p, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={i} x={X(i)} y={H - 8} textAnchor="middle" style={{ fill: 'var(--text2)', font: '600 11px system-ui' }}>
              {p.label}
            </text>
          ) : null,
        )}
        <path d={path} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--blue)' }} />
        {points.map((p, i) => (p.value === null ? null : <circle key={i} cx={X(i)} cy={Y(p.value)} r={4} style={{ fill: 'var(--blue)' }} />))}
        {markA !== null ? mark(markA, 'A', 'blue') : null}
        {markB !== null ? mark(markB, 'B', 'indigo') : null}
      </svg>
    </div>
  );
}

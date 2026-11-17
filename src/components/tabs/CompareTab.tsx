'use client';
import { useMemo, useState } from 'react';
import { addDays, compareWeeks, weekNumber, weekStartOf, weeklySummary, type DailyLog, type MetricDelta, type PoseKey, type WeekSummary, type WeeklyCheckin } from '@/lib/domain';
import { api, type PhotoUrls } from '@/lib/client/api';
import { useAsync, useSettings, useToday } from '@/lib/client/hooks';
import { mdOf } from '@/components/ui/WeekStrip';
import { num, signed } from '@/lib/client/format';
import { Card, CardHeader, Icon, InlineError, Pill, SegmentedControl, SkeletonCard, type IconName, type IconTone } from '@/components/ui';
import { PhotoCompareSlider } from '@/components/ui/PhotoCompareSlider';
import { WeightTrendChart } from '@/components/ui/WeightTrendChart';

interface WeekData {
  ws: string;
  no: number | null;
  checkin: WeeklyCheckin;
  summary: WeekSummary;
}

const POSES: { value: PoseKey; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
];
const hasPhoto = (c: WeeklyCheckin) => !!(c.photo_front_path || c.photo_side_path || c.photo_back_path);

type Good = 'down' | 'up';
function DeltaBadge({ m, good, unit, d, pct }: { m: MetricDelta; good: Good; unit: string; d: number; pct?: boolean }) {
  if (m.delta === null) return <Pill tone="none" icon="dash">No data</Pill>;
  const dd = Number(m.delta.toFixed(d));
  if (dd === 0) return <Pill tone="off" icon="minus">No change</Pill>;
  const ok = good === 'down' ? dd < 0 : dd > 0;
  const u = unit ? ` ${unit}` : '';
  return (
    <Pill tone={ok ? 'on' : 'off'} icon={dd < 0 ? 'down' : 'up'} aria-label={`${dd < 0 ? 'Decreased' : 'Increased'} by ${num(Math.abs(dd), d)}${u}, ${ok ? 'in the direction of the goal' : 'not toward the goal'}`}>
      {signed(m.delta, d)}
      {u}
      {pct && m.delta_pct !== null ? ` (${signed(m.delta_pct, 1)}%)` : ''}
    </Pill>
  );
}

const RESULTS: { key: keyof ReturnType<typeof compareWeeks>['results']; name: string; unit: string; good: Good }[] = [
  { key: 'weight_kg', name: 'Weekly avg weight', unit: 'kg', good: 'down' },
  { key: 'waist_cm', name: 'Waist', unit: 'cm', good: 'down' },
  { key: 'hip_cm', name: 'Hip', unit: 'cm', good: 'down' },
  { key: 'chest_cm', name: 'Chest', unit: 'cm', good: 'up' },
  { key: 'arm_cm', name: 'Arm', unit: 'cm', good: 'up' },
  { key: 'leg_cm', name: 'Leg', unit: 'cm', good: 'up' },
];

function usePhotos(w: WeekData | null) {
  const ws = w && hasPhoto(w.checkin) ? w.ws : null;
  const q = useAsync<{ ws: string; urls: PhotoUrls }>(ws ? async () => ({ ws, urls: await api.getPhotoUrls(ws) }) : null, [ws]);
  const ready = ws !== null && q.data?.ws === ws;
  return { urls: ready ? q.data!.urls : null, loading: ws !== null && !ready && !q.error };
}

export function CompareTab() {
  const settings = useSettings();
  const today = useToday();
  const programStart = settings.data?.program_start_date ?? null;
  const cur = today ? weekStartOf(today) : null;
  const q = useAsync(cur ? () => api.listWeeks(addDays(cur, -25 * 7), cur) : null, [cur]);

  const weeks: WeekData[] = useMemo(() => {
    if (!q.data) return [];
    return q.data.weeks
      .map((w) => {
        const ws = w.checkin.week_start_date;
        const logs = w.days.filter((l): l is DailyLog => l !== null);
        return { ws, no: programStart ? weekNumber(ws, programStart) : null, checkin: w.checkin, summary: weeklySummary({ weekStart: ws, logs, workouts: w.workouts, goals: w.checkin.goals_snapshot }) };
      })
      .sort((x, y) => (x.ws < y.ws ? -1 : 1));
  }, [q.data, programStart]);

  const [selA, setSelA] = useState<string | null>(null);
  const [selB, setSelB] = useState<string | null>(null);
  const [pose, setPose] = useState<PoseKey>('front');
  const [sbs, setSbs] = useState(false);
  const [pos, setPos] = useState(50);

  const byWs = (ws: string | null) => weeks.find((w) => w.ws === ws) ?? null;
  const defB = weeks[weeks.length - 1] ?? null;
  const defA = weeks[weeks.length - 2] ?? null;
  const A = byWs(selA) ?? defA;
  const B = byWs(selB) ?? defB;
  const photosA = usePhotos(A);
  const photosB = usePhotos(B);

  if (!cur || (q.loading && !q.data)) {
    return (
      <>
        <h1 className="title">Compare</h1>
        <div className="stack">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={4} />
        </div>
      </>
    );
  }
  if (q.error && !q.data) {
    return (
      <>
        <h1 className="title">Compare</h1>
        <Card>
          <InlineError message={`Could not load weeks: ${q.error}`} onRetry={() => void q.refetch()} />
        </Card>
      </>
    );
  }
  if (weeks.length < 2 || !A || !B) {
    return (
      <>
        <h1 className="title">Compare</h1>
        <Card>
          <CardHeader icon="compare" tone="indigo" title="Not enough weeks yet" />
          <p className="sub">Log at least two weeks to compare them. Weeks appear here once they have been opened in the Weekly Hub.</p>
        </Card>
      </>
    );
  }

  const wkName = (w: WeekData) => (w.no !== null && w.no > 0 ? `Week ${w.no}` : `Week of ${mdOf(w.ws)}`);
  const wkShort = (w: WeekData) => (w.no !== null && w.no > 0 ? `W${w.no}` : mdOf(w.ws));
  const kg = (w: WeekData) => num(w.summary.weight.avg_kg, 1);
  const label = (w: WeekData) => `${wkName(w)} · ${mdOf(w.ws)} · ${kg(w)} kg`;
  const cmp = compareWeeks(A, B);
  const target = B.checkin.goals_snapshot.target_weight_kg ?? A.checkin.goals_snapshot.target_weight_kg ?? null;
  const points = weeks.map((w) => ({ label: wkShort(w), name: wkName(w), value: w.summary.weight.avg_kg }));
  const opt = (w: WeekData) => (
    <option key={w.ws} value={w.ws}>
      {wkName(w)} ({mdOf(w.ws)}) · {kg(w)} kg{w.checkin.closed_at ? '' : ' · open'}
    </option>
  );

  const sum = (m: MetricDelta, m2: MetricDelta): MetricDelta => {
    const a = m.a !== null && m2.a !== null ? m.a + m2.a : null;
    const b = m.b !== null && m2.b !== null ? m.b + m2.b : null;
    return { a, b, delta: a !== null && b !== null ? b - a : null, delta_pct: null };
  };
  const weighA = A.summary.weight.count;
  const weighB = B.summary.weight.count;
  const e = cmp.effort;
  const effort: { name: string; icon: IconName; tone: IconTone; m: MetricDelta; unit: string; d: number; fa?: string; fb?: string }[] = [
    { name: 'Steps per day', icon: 'steps', tone: 'green', m: e.steps_avg_per_day, unit: 'steps', d: 0 },
    { name: 'Active burn per day', icon: 'flame', tone: 'amber', m: e.active_burn_per_day, unit: 'kcal', d: 0 },
    { name: 'Macro adherence (kcal)', icon: 'fork', tone: 'red', m: e.calorie_adherence_pct, unit: '%', d: 1 },
    { name: 'Strength volume', icon: 'dumbbell', tone: 'indigo', m: e.strength_volume_kg, unit: 'kg', d: 0 },
    {
      name: 'Sessions (cardio + strength)',
      icon: 'dumbbell',
      tone: 'blue',
      m: sum(e.cardio_sessions, e.strength_sessions),
      unit: '',
      d: 0,
      fa: `${A.summary.training.cardio_sessions} + ${A.summary.training.strength_sessions}`,
      fb: `${B.summary.training.cardio_sessions} + ${B.summary.training.strength_sessions}`,
    },
    { name: 'Weigh-ins', icon: 'scale', tone: 'blue', m: { a: weighA, b: weighB, delta: weighB - weighA, delta_pct: null }, unit: '', d: 0 },
  ];

  const sideOf = (w: WeekData, tag: 'A' | 'B', p: { urls: PhotoUrls | null }) => ({ tag: `${tag} · ${wkShort(w)}`, name: wkName(w), url: p.urls?.[pose]?.url ?? null });
  const anyLoading = photosA.loading || photosB.loading;

  return (
    <>
      <h1 className="title">Compare</h1>
      <p className="sub" style={{ marginBottom: 12 }}>
        {wkName(A)} (baseline) vs. {wkName(B)}
      </p>
      <div className="cmp-head">
        <label className="selwrap">
          <span className="ab t-blue" aria-hidden="true">
            A
          </span>
          <select className="plain" aria-label="Week A, baseline" value={A.ws} onChange={(ev) => setSelA(ev.target.value)}>
            {weeks.map(opt)}
          </select>
        </label>
        <label className="selwrap">
          <span className="ab t-indigo" aria-hidden="true">
            B
          </span>
          <select className="plain" aria-label="Week B" value={B.ws} onChange={(ev) => setSelB(ev.target.value)}>
            {weeks.map(opt)}
          </select>
        </label>
      </div>

      <Card style={{ marginTop: 12 }}>
        <CardHeader icon="phase" tone="indigo" title="Weight trend" subtitle={target !== null ? `Weekly averages. Dashed line is the ${num(target, 1)} kg target.` : 'Weekly averages.'} />
        <WeightTrendChart points={points} target={target} markA={weeks.findIndex((w) => w.ws === A.ws)} markB={weeks.findIndex((w) => w.ws === B.ws)} />
      </Card>

      <div className="cmpgrid">
        <div>
          <h2 className="sec">Visual proof</h2>
          <Card>
            <div className="posebar">
              <SegmentedControl<PoseKey> ariaLabel="Pose" value={pose} options={POSES} onChange={setPose} />
              <button type="button" className="btn sm" aria-pressed={sbs} onClick={() => setSbs((v) => !v)} style={sbs ? { background: 'var(--blue-tint)', color: 'var(--blue-text)' } : undefined}>
                <Icon name="compare" sm />
                Side-by-side
              </button>
            </div>
            <PhotoCompareSlider a={sideOf(A, 'A', photosA)} b={sideOf(B, 'B', photosB)} pose={pose} pos={pos} onPos={setPos} sideBySide={sbs} />
            {anyLoading ? (
              <p className="small muted" role="status" style={{ margin: '8px 0 0', textAlign: 'center' }}>
                Loading photos…
              </p>
            ) : null}
            <p className="small muted" style={{ margin: '10px 0 0', textAlign: 'center' }}>
              <b style={{ color: 'var(--text)' }}>A</b> {label(A)} ↔ <b style={{ color: 'var(--text)' }}>B</b> {label(B)}
            </p>
          </Card>
        </div>
        <div>
          <h2 className="sec">Results</h2>
          <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            {RESULTS.map((r) => {
              const m = cmp.results[r.key];
              return (
                <Card key={r.key} className="delta">
                  <div className="nm">{r.name}</div>
                  <div>
                    <DeltaBadge m={m} good={r.good} unit={r.unit} d={1} pct={r.key === 'weight_kg'} />
                  </div>
                  <div className="vals">
                    {num(m.a, 1)} <small>{r.unit}</small> → {num(m.b, 1)} <small>{r.unit}</small>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>

      <h2 className="sec">Work put in</h2>
      <div className="g g3">
        {effort.map((x) => (
          <Card key={x.name} className="eff">
            <div className="row" style={{ gap: 8 }}>
              <span className={`ico ${x.tone}`} style={{ width: 28, height: 28, borderRadius: 8 }}>
                <Icon name={x.icon} sm />
              </span>
              <b style={{ fontSize: 15 }}>{x.name}</b>
            </div>
            <div style={{ margin: '10px 0 2px' }}>
              <DeltaBadge m={x.m} good="up" unit={x.unit} d={x.d} />
            </div>
            <div className="wk">
              <div>
                {wkName(A)}
                <b>
                  {x.fa ?? num(x.m.a, x.d)}
                  {x.unit && !x.fa ? <small className="muted" style={{ fontSize: 13, fontWeight: 500 }}> {x.unit}</small> : null}
                </b>
              </div>
              <div style={{ textAlign: 'right' }}>
                {wkName(B)}
                <b>
                  {x.fb ?? num(x.m.b, x.d)}
                  {x.unit && !x.fb ? <small className="muted" style={{ fontSize: 13, fontWeight: 500 }}> {x.unit}</small> : null}
                </b>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

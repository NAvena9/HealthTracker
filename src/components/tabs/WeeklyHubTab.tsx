'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { addDays, statusForPercent, weekDates, weekStartOf, weeklySummary, type DailyLog, type PoseKey, type Status, type Workout } from '@/lib/domain';
import { api, type PhotoUrls, type WeekPatch, type WeekResponse } from '@/lib/client/api';
import { errorMessage, useAsync, useOptimisticSave, useSettings, useToday } from '@/lib/client/hooks';
import { MINUS, num, signed } from '@/lib/client/format';
import { exportWeekPng, type WeekExportData } from '@/lib/client/exportImage';
import { compressImage } from '@/lib/client/imageCompress';
import { getBrowserClient } from '@/lib/supabase/browser';
import { Button, Card, CardHeader, ConfirmDialog, Icon, InlineError, LockBanner, NumberField, Pill, SkeletonCard, StatusBadge, dowOf, mdOf, useToast } from '@/components/ui';
import { CloseWeekModal } from '@/components/modals/CloseWeekModal';
import { ReopenConfirmModal } from '@/components/modals/ReopenConfirmModal';

/* ---------- print stylesheet (PDF via window.print) ---------- */
const PRINT_CSS = `
.print-only{display:none}
@media print{
  .hdr,.tabs,.toast,.no-print{display:none !important}
  body{background:#fff !important}
  .wrap{padding:0 !important;max-width:none !important}
  .card{box-shadow:none !important;break-inside:avoid}
  .ledger{display:table !important}
  .dcards{display:none !important}
  .print-only{display:block}
  .screen-only{display:none !important}
  .panel{animation:none !important}
}`;

const MEAS = [
  { key: 'waist_cm', label: 'Waist' },
  { key: 'hip_cm', label: 'Hip' },
  { key: 'chest_cm', label: 'Chest' },
  { key: 'arm_cm', label: 'Arm' },
  { key: 'leg_cm', label: 'Leg' },
] as const;
const REFLECT = [
  { key: 'reflection_highlights', label: 'Highlights and wins' },
  { key: 'reflection_hard', label: 'What was hard' },
  { key: 'reflection_next_goals', label: 'Goals for next week (2 to 4)' },
] as const;
const POSES: { pose: PoseKey; label: string; field: 'photo_front_path' | 'photo_side_path' | 'photo_back_path' }[] = [
  { pose: 'front', label: 'Front', field: 'photo_front_path' },
  { pose: 'side', label: 'Side', field: 'photo_side_path' },
  { pose: 'back', label: 'Back', field: 'photo_back_path' },
];
const MACROS = [
  { key: 'protein_g', label: 'Protein' },
  { key: 'carbs_g', label: 'Carbs' },
  { key: 'fat_g', label: 'Fat' },
  { key: 'calories_kcal', label: 'Calories' },
] as const;

const catKcal = (ws: Workout[], date: string, cat: Workout['category']): number | null => {
  const l = ws.filter((w) => w.log_date === date && w.category === cat);
  return l.length ? l.reduce((s, w) => s + (w.active_kcal ?? 0), 0) : null;
};
const pctText = (p: number | null) => (p === null ? 'No data' : `${num(p, 1)}%`);

/* ---------- text field that saves on blur ---------- */
function SaveText({ label, value, disabled, multiline, maxLength, placeholder, url, onSave }: { label: string; value: string | null; disabled: boolean; multiline?: boolean; maxLength?: number; placeholder?: string; url?: boolean; onSave: (v: string | null) => Promise<boolean> }) {
  const [text, setText] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ?? '');
  }, [value]);
  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function blur() {
    focused.current = false;
    const next = text.trim() === '' ? null : url ? text.trim() : text;
    if (next === (value ?? null)) return;
    setState('saving');
    const ok = await onSave(next);
    setState(ok ? 'saved' : 'error');
  }
  const common = {
    className: 'plain',
    value: text,
    disabled,
    placeholder: disabled ? '' : placeholder,
    maxLength,
    onFocus: () => {
      focused.current = true;
    },
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement & HTMLInputElement>) => setText(e.target.value),
    onBlur: () => void blur(),
  };
  return (
    <label className="field">
      <span className="fl">
        <span>{label}</span>
        <span className="small" role="status" style={{ fontWeight: 500, color: state === 'error' ? 'var(--red-text)' : 'var(--text2)' }}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : ''}
        </span>
      </span>
      {multiline ? <textarea {...common} /> : <input {...common} type={url ? 'url' : 'text'} inputMode={url ? 'url' : undefined} />}
    </label>
  );
}

/* ---------- photo slot ---------- */
function PhotoSlot({ label, url, hasPath, loadingUrl, closed, busy, onPick, onRemove }: { label: string; url: string | null; hasPath: boolean; loadingUrl: boolean; closed: boolean; busy: boolean; onPick: (f: File) => void; onRemove: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const filled = !!url;
  return (
    <div>
      {filled ? (
        <div className="slot filled">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`${label} progress photo`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <span className="cap">{label}</span>
        </div>
      ) : hasPath ? (
        <div className="slot">
          <span>{label}</span>
          <span className="small" style={{ fontWeight: 500 }}>
            {loadingUrl ? 'Loading…' : 'Photo unavailable'}
          </span>
        </div>
      ) : closed ? (
        <div className="slot">
          <span>{label}</span>
          <span className="small" style={{ fontWeight: 500 }}>
            No photo
          </span>
        </div>
      ) : (
        <button type="button" className="slot" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name={busy ? 'spinner' : 'photo'} className={busy ? 'spin' : ''} />
          {busy ? 'Uploading…' : `Add ${label}`}
        </button>
      )}
      {!closed && (filled || hasPath) ? (
        <div className="row no-print" style={{ justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
          <button type="button" className="linkbtn" disabled={busy} onClick={() => input.current?.click()} aria-label={`Replace ${label} photo`}>
            {busy ? 'Uploading…' : 'Replace'}
          </button>
          <button type="button" className="linkbtn" disabled={busy} onClick={onRemove} aria-label={`Remove ${label} photo`}>
            Remove
          </button>
        </div>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        disabled={closed}
        aria-label={`Choose ${label} photo`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

function Kpi({ icon, tone, label, hero, sub }: { icon: 'scale' | 'steps' | 'flame' | 'dumbbell'; tone: 'blue' | 'green' | 'amber' | 'indigo'; label: string; hero: React.ReactNode; sub: React.ReactNode }) {
  return (
    <Card className="kpi">
      <div className="eyebrow">
        <span className={`ico ${tone}`} style={{ width: 28, height: 28, borderRadius: 8 }}>
          <Icon name={icon} sm />
        </span>
        {label}
      </div>
      <div className="hero">{hero}</div>
      <div className="small muted">{sub}</div>
    </Card>
  );
}

export function WeeklyHubTab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const save = useOptimisticSave();
  const settings = useSettings();
  const today = useToday();
  const uid = useId();
  const programStart = settings.data?.program_start_date ?? null;

  const curWs = today ? weekStartOf(today) : null;
  const qWeek = params.get('week');
  const ws = useMemo(() => {
    if (!curWs) return null;
    if (!qWeek || !/^\d{4}-\d{2}-\d{2}$/.test(qWeek)) return curWs;
    const w = weekStartOf(qWeek);
    return w > curWs ? curWs : w;
  }, [qWeek, curWs]);

  const weekQ = useAsync(ws ? () => api.getWeek(ws) : null, [ws]);
  const { setData: setWeek } = weekQ;
  const week: WeekResponse | null = weekQ.data && weekQ.data.checkin.week_start_date === ws ? weekQ.data : null;
  const ck = week?.checkin ?? null;
  const paths = ck ? `${ck.photo_front_path ?? ''}|${ck.photo_side_path ?? ''}|${ck.photo_back_path ?? ''}` : '';
  const anyPath = paths !== '||';
  const [photoVer, setPhotoVer] = useState(0);
  const photosQ = useAsync<{ ws: string; urls: PhotoUrls }>(ws && ck && anyPath ? async () => ({ ws, urls: await api.getPhotoUrls(ws) }) : null, [ws, paths, photoVer, !!ck]);
  const urls = photosQ.data && photosQ.data.ws === ws && anyPath ? photosQ.data.urls : null;

  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [busyPose, setBusyPose] = useState<PoseKey | null>(null);
  const [removing, setRemoving] = useState<PoseKey | null>(null);
  const [exporting, setExporting] = useState(false);

  const goals = ck?.goals_snapshot ?? null;
  const summary = useMemo(() => {
    if (!week || !goals || !ws) return null;
    return weeklySummary({ weekStart: ws, logs: week.days.filter((l): l is DailyLog => l !== null), workouts: week.workouts, goals });
  }, [week, goals, ws]);

  function go(w: string) {
    router.replace(w === curWs ? pathname : `${pathname}?week=${w}`, { scroll: false });
  }
  async function savePatch(patch: WeekPatch): Promise<boolean> {
    if (!ws) return false;
    const r = await save({ request: () => api.putWeek(ws, patch), onSuccess: (x) => setWeek(x), errorMessage: 'Could not save' });
    return r !== undefined;
  }

  async function pickPhoto(pose: PoseKey, field: (typeof POSES)[number]['field'], file: File) {
    if (!ws) return;
    setBusyPose(pose);
    try {
      const blob = await compressImage(file);
      const up = await api.createPhotoUploadUrl(ws, pose);
      const { error } = await getBrowserClient().storage.from('progress-photos').uploadToSignedUrl(up.path, up.token, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      const r = await api.putWeek(ws, { [field]: up.path } as WeekPatch);
      setWeek(r);
      setPhotoVer((v) => v + 1);
      toast(`${pose[0]!.toUpperCase()}${pose.slice(1)} photo saved`);
    } catch (e) {
      toast(`Photo not saved: ${errorMessage(e)}`);
    } finally {
      setBusyPose(null);
    }
  }
  async function removePhoto(pose: PoseKey) {
    if (!ws) return;
    setRemoving(null);
    setBusyPose(pose);
    try {
      await api.deletePhoto(ws, pose);
      await weekQ.refetch();
      setPhotoVer((v) => v + 1);
      toast('Photo removed');
    } catch (e) {
      toast(`Could not remove: ${errorMessage(e)}`);
    } finally {
      setBusyPose(null);
    }
  }

  if (!ws || !curWs) return <SkeletonCard lines={3} />;
  if (weekQ.error && !week) {
    return (
      <>
        <h1 className="title">Weekly Hub</h1>
        <Card>
          <InlineError message={`Could not load this week: ${weekQ.error}`} onRetry={() => void weekQ.refetch()} />
        </Card>
      </>
    );
  }
  if (!week || !ck || !goals || !summary) {
    return (
      <>
        <h1 className="title">Weekly Hub</h1>
        <div className="stack">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={4} />
        </div>
      </>
    );
  }

  const closed = ck.closed_at !== null;
  const ended = today !== null && today > addDays(ws, 6);
  const t = summary.training;
  const goalsMet =
    summary.weight.goal_met &&
    (summary.steps.pct_of_weekly_goal ?? 0) >= 100 &&
    (t.cardio_target === null || t.cardio_sessions >= t.cardio_target) &&
    (t.strength_target === null || t.strength_sessions >= t.strength_target);
  const status: 'open' | 'ready' | 'closed' = closed ? 'closed' : ended || goalsMet ? 'ready' : 'open';
  const live = !closed && !ended; // percentages stay neutral ("so far") until the week has ended or is closed
  const LV = (s: Status): Status => (live ? 'none' : s);
  const so = live ? ' so far' : '';

  const wn = week.week_number !== null && week.week_number > 0 ? week.week_number : null;
  const wLabel = wn !== null ? `Week ${wn}` : 'Week —';
  const range = `${mdOf(ws)} – ${mdOf(addDays(ws, 6))}`;
  const prevDisabled = wn !== null && wn <= 1 && programStart !== null;
  const nextDisabled = ws >= curWs;
  const dates = weekDates(ws);
  const days = dates.map((d, i) => ({ d, l: week.days[i] ?? null, c: catKcal(week.workouts, d, 'CARDIO'), s: catKcal(week.workouts, d, 'STRENGTH') }));

  const g = goals;
  const stepsPct = summary.steps.avg_per_day === null ? null : Math.round((summary.steps.avg_per_day / g.daily_step_goal) * 1000) / 10;
  const stepsSt = statusForPercent('volume', stepsPct);
  const N = summary.nutrition;

  // energy (doc 01 section 9 fallback when resting energy is missing all week)
  const en = summary.energy;
  let energy: { net: number; days: number; avg: number | null; eaten: number; burned: number; fallback: boolean } | null = null;
  if (en.days_counted > 0) energy = { net: en.net_kcal, days: en.days_counted, avg: en.avg_net_per_day, eaten: en.eaten_kcal, burned: en.burned_kcal, fallback: false };
  else {
    const logs = days.filter((x) => x.l && x.l.calories_kcal !== null);
    if (logs.length) {
      const eaten = logs.reduce((s, x) => s + (x.l!.calories_kcal as number), 0);
      const burned = logs.reduce((s, x) => s + week.workouts.filter((w) => w.log_date === x.d).reduce((a, w) => a + (w.active_kcal ?? 0), 0), 0);
      energy = { net: eaten - burned, days: logs.length, avg: (eaten - burned) / logs.length, eaten, burned, fallback: true };
    }
  }

  const typePill = (l: DailyLog | null) => (l ? <Pill tone={l.day_type === 'ACTIVE' ? 'blue' : 'indigo'}>{l.day_type === 'ACTIVE' ? 'Active' : 'Rest'}</Pill> : <span className="muted">—</span>);
  const pctCell = (p: number | null) => <StatusBadge status={p === null ? 'none' : LV(statusForPercent('macro', p))} text={pctText(p) + (p !== null && live ? so : '')} />;

  async function doExport() {
    setExporting(true);
    try {
      const fmt1 = (v: number | null) => num(v, 1);
      const data: WeekExportData = {
        filename: `proof-of-work-week-${wn ?? ws}-${ws}`,
        title: wLabel,
        range,
        status: status === 'closed' ? 'Closed' : status === 'ready' ? 'Ready to close' : 'Open',
        kpis: [
          { label: 'Avg weight', value: summary!.weight.avg_kg === null ? '—' : `${fmt1(summary!.weight.avg_kg)} kg`, sub: `${summary!.weight.count}/${g.weekly_weighin_goal} weigh-ins` },
          { label: 'Total steps', value: num(summary!.steps.total), sub: `${num(summary!.steps.pct_of_weekly_goal, 1)}% of ${num(g.weekly_step_goal)}` },
          { label: 'Active burn', value: `${num(t.total_kcal)} kcal`, sub: `Cardio ${num(t.cardio_kcal)} · Strength ${num(t.strength_kcal)}` },
          { label: 'Volume lifted', value: `${num(t.volume_kg)} kg`, sub: `${t.strength_sessions} strength session${t.strength_sessions === 1 ? '' : 's'}` },
        ],
        ledgerHeader: ['Date', 'Day', 'Weight', 'Protein', 'Carbs', 'Fat', 'Calories', 'Steps', 'Cardio', 'Strength'],
        ledgerRows: days.map((x) => [`${dowOf(x.d)} ${mdOf(x.d)}`, x.l ? (x.l.day_type === 'ACTIVE' ? 'Active' : 'Rest') : '—', fmt1(x.l?.weight_kg ?? null), num(x.l?.protein_g), num(x.l?.carbs_g), num(x.l?.fat_g), num(x.l?.calories_kcal), num(x.l?.steps), num(x.c), num(x.s)]),
        ledgerFooter: [
          ['Weekly Average', '', fmt1(summary!.weight.avg_kg), num(N.protein_g.actual_avg), num(N.carbs_g.actual_avg), num(N.fat_g.actual_avg), num(N.calories_kcal.actual_avg), num(summary!.steps.avg_per_day), `${num(t.cardio_kcal)} total`, `${num(t.strength_kcal)} total`],
          ['Dynamic Target', '', fmt1(g.target_weight_kg), num(N.protein_g.target_avg), num(N.carbs_g.target_avg), num(N.fat_g.target_avg), num(N.calories_kcal.target_avg), num(g.daily_step_goal), '—', '—'],
          ['% Achieved', '', '—', ...MACROS.map((m) => (N[m.key].achieved_pct === null ? '—' : `${num(N[m.key].achieved_pct, 1)}%`)), stepsPct === null ? '—' : `${num(stepsPct, 1)}%`, '—', '—'],
        ],
        energyLines: energy
          ? [`${signed(energy.net)} kcal net`, `${energy.days} of 7 days counted`, `Eaten ${num(energy.eaten)} kcal`, `${energy.fallback ? 'Workout' : 'Resting + active'} ${num(energy.burned)} kcal`, ...(energy.fallback ? ['Excludes resting energy'] : [])]
          : ['No energy data'],
        sessionLines: [`Cardio ${t.cardio_sessions}${t.cardio_target ? ` / ${t.cardio_target}` : ''}`, `Strength ${t.strength_sessions}${t.strength_target ? ` / ${t.strength_target}` : ''}`],
        measurements: MEAS.map((m) => ({ label: m.label, value: ck![m.key] === null ? '—' : `${num(ck![m.key], 1)}` })),
        reflections: REFLECT.map((r) => ({ label: r.label, text: ck![r.key] ?? '' })),
        folderUrl: ck!.external_folder_url,
      };
      await exportWeekPng(data);
      toast('Image saved');
    } catch (e) {
      toast(`Export failed: ${errorMessage(e)}`);
    } finally {
      setExporting(false);
    }
  }

  const bannerEl =
    status === 'closed' ? (
      <LockBanner closedAt={ck.closed_at} weekLabel={wLabel} />
    ) : status === 'ready' ? (
      <div className="banner t-amber" role="status">
        <b>Ready to close</b>
        <Icon name="near" sm />
        <span style={{ fontWeight: 500 }}>{ended ? 'The week has ended; review it, then close it to lock the record.' : 'Weigh-in and data goals are met. Close it now or keep logging.'}</span>
      </div>
    ) : (
      <div className="banner t-blue" role="status">
        <b>Open</b>
        <Icon name="bolt" sm />
        <span style={{ fontWeight: 500 }}>{wLabel} is open. Edits and syncs apply.</span>
      </div>
    );

  const sess = [
    { n: 'Cardio', a: t.cardio_sessions, tg: t.cardio_target, col: 'var(--orange)' },
    { n: 'Strength', a: t.strength_sessions, tg: t.strength_target, col: 'var(--indigo)' },
  ];

  return (
    <>
      <style>{PRINT_CSS}</style>
      <h1 className="title">Weekly Hub</h1>
      <div className="switcher no-print">
        <Button iconOnly aria-label="Previous week" disabled={prevDisabled} onClick={() => go(addDays(ws, -7))}>
          <Icon name="left" />
        </Button>
        <div className="lbl">
          <b>{wLabel}</b>
          <span className="sub small">{range}</span>
        </div>
        <Button iconOnly aria-label="Next week" disabled={nextDisabled} onClick={() => go(addDays(ws, 7))}>
          <Icon name="right" />
        </Button>
      </div>
      <p className="print-only sub" style={{ marginBottom: 8 }}>
        {wLabel} · {range}
      </p>
      {bannerEl}

      <div className="g g4" style={{ marginBottom: 12 }}>
        <Kpi
          icon="scale"
          tone="blue"
          label="Avg weight"
          hero={summary.weight.avg_kg === null ? '—' : <>{num(summary.weight.avg_kg, 1)}<small>kg</small></>}
          sub={
            <>
              {summary.weight.count}/{summary.weight.goal} weigh-ins <StatusBadge status={summary.weight.goal_met ? 'on_target' : 'near'} text={summary.weight.goal_met ? 'Goal met' : 'Below min'} />
            </>
          }
        />
        <Kpi
          icon="steps"
          tone="green"
          label="Total steps"
          hero={num(summary.steps.total)}
          sub={
            <>
              {num(summary.steps.pct_of_weekly_goal, 1)}% of {num(summary.steps.weekly_goal)}{' '}
              {summary.steps.pct_of_weekly_goal !== null ? <StatusBadge status={LV(statusForPercent('volume', summary.steps.pct_of_weekly_goal))} text={live ? 'So far' : undefined} /> : null}
            </>
          }
        />
        <Kpi icon="flame" tone="amber" label="Active burn" hero={<>{num(t.total_kcal)}<small>kcal</small></>} sub={`Cardio ${num(t.cardio_kcal)} · Strength ${num(t.strength_kcal)}`} />
        <Kpi icon="dumbbell" tone="indigo" label="Volume lifted" hero={<>{num(t.volume_kg)}<small>kg</small></>} sub={`${t.strength_sessions} strength session${t.strength_sessions === 1 ? '' : 's'}`} />
      </div>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="hub" title="Daily ledger" subtitle="Averages use logged days only, so a partial week is not skewed." />
        <table className="ledger">
          <caption className="sr">Daily ledger for {wLabel}</caption>
          <thead>
            <tr>
              {['Date', 'Day', 'Weight', 'Protein', 'Carbs', 'Fat', 'Calories', 'Steps', 'Cardio kcal', 'Strength kcal'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((x) => (
              <tr key={x.d}>
                <td>
                  <b>{dowOf(x.d)}</b> {mdOf(x.d)}
                </td>
                <td>{typePill(x.l)}</td>
                <td>{num(x.l?.weight_kg, 1)}</td>
                <td>{num(x.l?.protein_g)}</td>
                <td>{num(x.l?.carbs_g)}</td>
                <td>{num(x.l?.fat_g)}</td>
                <td>{num(x.l?.calories_kcal)}</td>
                <td>{num(x.l?.steps)}</td>
                <td>{num(x.c)}</td>
                <td>{num(x.s)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Weekly Average</td>
              <td>{num(summary.weight.avg_kg, 1)}</td>
              <td>{num(N.protein_g.actual_avg)}</td>
              <td>{num(N.carbs_g.actual_avg)}</td>
              <td>{num(N.fat_g.actual_avg)}</td>
              <td>{num(N.calories_kcal.actual_avg)}</td>
              <td>{num(summary.steps.avg_per_day)}</td>
              <td>{num(t.cardio_kcal)} <small className="muted">total</small></td>
              <td>{num(t.strength_kcal)} <small className="muted">total</small></td>
            </tr>
            <tr>
              <td colSpan={2}>Dynamic Target</td>
              <td>{num(g.target_weight_kg, 1)}</td>
              <td>{num(N.protein_g.target_avg)}</td>
              <td>{num(N.carbs_g.target_avg)}</td>
              <td>{num(N.fat_g.target_avg)}</td>
              <td>{num(N.calories_kcal.target_avg)}</td>
              <td>{num(g.daily_step_goal)}</td>
              <td>—</td>
              <td>—</td>
            </tr>
            <tr>
              <td colSpan={2}>% Achieved</td>
              <td>—</td>
              {MACROS.map((m) => (
                <td key={m.key}>{pctCell(N[m.key].achieved_pct)}</td>
              ))}
              <td>
                <StatusBadge status={stepsPct === null ? 'none' : LV(stepsSt)} text={pctText(stepsPct)} />
              </td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tfoot>
        </table>
        <div className="dcards">
          {days.map((x) => (
            <div key={x.d} className="dcard">
              <div className="row between">
                <b>
                  {dowOf(x.d)}, {mdOf(x.d)}
                </b>
                {typePill(x.l)}
              </div>
              <div className="row between" style={{ marginTop: 8 }}>
                <span className="muted small">Weight</span>
                <b>{x.l?.weight_kg != null ? `${num(x.l.weight_kg, 1)} kg` : '—'}</b>
                <span className="muted small">Steps</span>
                <b>{num(x.l?.steps)}</b>
              </div>
              <div className="mini">
                <div>
                  <b>{num(x.l?.protein_g)}</b>
                  <span>Protein</span>
                </div>
                <div>
                  <b>{num(x.l?.carbs_g)}</b>
                  <span>Carbs</span>
                </div>
                <div>
                  <b>{num(x.l?.fat_g)}</b>
                  <span>Fat</span>
                </div>
                <div>
                  <b>{num(x.l?.calories_kcal)}</b>
                  <span>kcal</span>
                </div>
              </div>
              <div className="foot">
                <span>Cardio {x.c === null ? '—' : `${num(x.c)} kcal`}</span>
                <span>Strength {x.s === null ? '—' : `${num(x.s)} kcal`}</span>
              </div>
            </div>
          ))}
          <div className="dcard" style={{ background: 'var(--card)' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Weekly average, target and % achieved
            </div>
            {MACROS.map((m) => (
              <div key={m.key} className="row between" style={{ padding: '6px 0', borderTop: '1px solid var(--hairline)' }}>
                <span style={{ flex: 1 }}>
                  <b>{m.label}</b>
                </span>
                <span className="small muted" style={{ flex: 2 }}>
                  avg {num(N[m.key].actual_avg)} / target {num(N[m.key].target_avg)}
                </span>
                {pctCell(N[m.key].achieved_pct)}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="g g2" style={{ marginBottom: 12 }}>
        <Card>
          <CardHeader icon="flame" tone="green" title="Energy balance" />
          <div className="hero">
            {energy ? signed(energy.net) : '—'}
            <small>kcal net</small>
          </div>
          <p className="sub small" style={{ margin: '6px 0 10px' }}>
            <b style={{ color: 'var(--text)' }}>{energy ? energy.days : 0} of 7 days</b> counted{energy?.avg != null ? ` · avg ${signed(energy.avg)} kcal/day` : ''}
          </p>
          {energy ? (
            <>
              <div className="kv">
                <span className="muted">Eaten</span>
                <b>{num(energy.eaten)} kcal</b>
              </div>
              <div className="kv">
                <span className="muted">{energy.fallback ? 'Workout kcal' : 'Resting + active'}</span>
                <b>{num(energy.burned)} kcal</b>
              </div>
              {energy.fallback ? (
                <p className="small muted" style={{ margin: '8px 0 0' }}>
                  <Icon name="info" sm /> Fallback: eaten {MINUS} workout kcal (excludes resting energy), because resting energy is missing this week.
                </p>
              ) : null}
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Net balance needs calories eaten; resting and active energy arrive with the sync.
            </p>
          )}
        </Card>
        <Card>
          <CardHeader icon="dumbbell" tone="indigo" title="Sessions" />
          {sess.map((s) => {
            const pct = s.tg ? (s.a / s.tg) * 100 : 0;
            return (
              <div key={s.n} style={{ marginBottom: 12 }}>
                <div className="row between">
                  <b>{s.n}</b>
                  <span className="row">
                    <b>
                      {s.a}
                      {s.tg ? ` / ${s.tg}` : ''}
                    </b>
                    {s.tg ? <StatusBadge status={LV(statusForPercent('volume', pct))} text={live ? 'So far' : undefined} /> : null}
                  </span>
                </div>
                <div className="bar" role="progressbar" aria-label={`${s.n} sessions`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, pct))} style={{ marginTop: 8, ['--c' as string]: s.col, ['--w' as string]: `${Math.min(100, pct)}%` }}>
                  <i />
                </div>
              </div>
            );
          })}
          <p className="small muted" style={{ margin: 0 }}>
            Targets are optional and come from this week&apos;s goals snapshot.
          </p>
        </Card>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="ruler" tone="neutral" title="Measurements" subtitle="Centimetres, once a week" />
        <div className="g" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
          {MEAS.map((m) => (
            <NumberField key={m.key} label={m.label} showLabel size="sm" unit="cm" min={10} max={300} disabled={closed} value={ck[m.key]} onCommit={(v) => void savePatch({ [m.key]: v } as WeekPatch)} />
          ))}
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="photo" tone="neutral" title="Progress photos" subtitle="Front, side, back. Stored privately, compressed on your device." />
        <div className="slots">
          {POSES.map((p) => (
            <PhotoSlot
              key={p.pose}
              label={p.label}
              url={urls?.[p.pose]?.url ?? null}
              hasPath={ck[p.field] !== null}
              loadingUrl={photosQ.loading}
              closed={closed}
              busy={busyPose === p.pose}
              onPick={(f) => void pickPhoto(p.pose, p.field, f)}
              onRemove={() => setRemoving(p.pose)}
            />
          ))}
        </div>
        {photosQ.error ? (
          <div style={{ marginTop: 8 }}>
            <InlineError message={`Could not load photos: ${photosQ.error}`} onRetry={() => setPhotoVer((v) => v + 1)} />
          </div>
        ) : null}
        <div style={{ marginTop: 12 }}>
          <SaveText label="Backup folder link (optional)" url value={ck.external_folder_url} disabled={closed} placeholder="https://drive.google.com/..." onSave={(v) => savePatch({ external_folder_url: v })} />
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="note" tone="neutral" title="Weekly reflection" />
        <div className="stack screen-only">
          {REFLECT.map((r) => (
            <SaveText key={r.key} multiline maxLength={4000} label={r.label} value={ck[r.key]} disabled={closed} placeholder="Write a few lines" onSave={(v) => savePatch({ [r.key]: v } as WeekPatch)} />
          ))}
        </div>
        <div className="print-only">
          {REFLECT.map((r) => (
            <div key={r.key} style={{ marginBottom: 8 }}>
              <div className="eyebrow">{r.label}</div>
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{ck[r.key] || '—'}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="row wrapflex no-print" style={{ marginBottom: 8 }}>
        {closed ? (
          <Button icon="unlock" onClick={() => setReopenOpen(true)}>
            Reopen week
          </Button>
        ) : (
          <Button variant="primary" icon="lock" onClick={() => setCloseOpen(true)}>
            Close week
          </Button>
        )}
        <Button icon="download" loading={exporting} onClick={() => void doExport()}>
          Export image
        </Button>
        <Button icon="doc" onClick={() => window.print()}>
          Export PDF
        </Button>
      </div>
      <span id={`${uid}-n`} className="sr">
        Export PDF opens the print dialog; choose Save as PDF.
      </span>

      <CloseWeekModal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        weekStart={ws}
        weekNumber={wn}
        early={!ended}
        onClosed={(w) => {
          setWeek(w);
          setCloseOpen(false);
          toast(`${wLabel} closed`);
        }}
      />
      <ReopenConfirmModal
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        weekStart={ws}
        weekNumber={wn}
        onReopened={(w) => {
          setWeek(w);
          setReopenOpen(false);
          toast(`${wLabel} reopened`);
        }}
      />
      <ConfirmDialog open={removing !== null} title="Remove photo?" message="The stored photo will be deleted from this week." confirmLabel="Remove" onClose={() => setRemoving(null)} onConfirm={() => removing && void removePhoto(removing)} />
    </>
  );
}

'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { addDays, dailyAdherence, kcalFromMacros, statusForPercent, weekNumber, weekStartOf, weeklySummary, type DailyLog, type DayType, type MacroKey, type Workout } from '@/lib/domain';
import { api, type DayPatch, type DayResponse, type WeekResponse } from '@/lib/client/api';
import { errorMessage, useAsync, useOptimisticSave, useSettings, useToday } from '@/lib/client/hooks';
import { longDate, MINUS, num, shortDateIn, signed, timeIn } from '@/lib/client/format';
import { todayInTz } from '@/lib/domain';
import { Button, Card, CardHeader, ConfirmDialog, Icon, InlineError, LockBanner, MacroBar, NumberField, Pill, SegmentedControl, SkeletonCard, StatusBadge, WeekStrip, dowOf, mdOf, useToast, type MacroColor } from '@/components/ui';
import { MACRO_TEXT } from '@/components/ui/MacroBar';
import { SessionModal } from '@/components/modals/SessionModal';
import { StrongImportModal } from '@/components/modals/StrongImportModal';

const FIELDS = ['weight_kg', 'steps', 'protein_g', 'carbs_g', 'fat_g', 'calories_kcal', 'resting_kcal', 'active_kcal_total'] as const;
type Field = (typeof FIELDS)[number];
const hasData = (l: DailyLog | null | undefined) => !!l && (['weight_kg', 'steps', 'protein_g', 'carbs_g', 'fat_g', 'calories_kcal'] as const).some((k) => l[k] !== null);

const MACROS: { key: MacroKey; label: string; unit: string; color: MacroColor; max: number }[] = [
  { key: 'protein_g', label: 'Protein', unit: 'g', color: 'protein', max: 2000 },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', color: 'carbs', max: 2000 },
  { key: 'fat_g', label: 'Fat', unit: 'g', color: 'fat', max: 2000 },
  { key: 'calories_kcal', label: 'Calories', unit: 'kcal', color: 'calories', max: 10000 },
];

function mergeDay(week: WeekResponse | null, r: DayResponse): WeekResponse | null {
  if (!week || week.checkin.week_start_date !== r.day.week_start_date) return week;
  const idx = (Date.parse(r.day.log_date) - Date.parse(week.checkin.week_start_date)) / 86_400_000;
  const days = week.days.slice();
  const { persisted: _p, ...row } = r.day;
  days[idx] = row;
  return { ...week, days, workouts: [...week.workouts.filter((w) => w.log_date !== r.day.log_date), ...r.workouts] };
}

export function TodayTab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const save = useOptimisticSave();
  const settings = useSettings();
  const today = useToday();
  const tz = settings.data?.timezone ?? 'America/Hermosillo';

  const qDate = params.get('date');
  const date = qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : today;
  const ws = date ? weekStartOf(date) : null;

  const weekQ = useAsync(ws ? () => api.getWeek(ws) : null, [ws]);
  const dayQ = useAsync(date ? () => api.getDay(date) : null, [date]);
  const syncQ = useAsync(() => api.getSyncStatus(), []);
  const { setData: setWeek } = weekQ;
  const { setData: setDay } = dayQ;

  const [draft, setDraft] = useState<Partial<Record<Field, number | null>> & { day_type?: DayType }>({});
  const [sessionOpen, setSessionOpen] = useState(false);
  const [editing, setEditing] = useState<Workout | null>(null);
  const [deleting, setDeleting] = useState<Workout | null>(null);
  const [strongOpen, setStrongOpen] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => setDraft({}), [date]);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const dayData = dayQ.data;
  const goals = dayData?.week.goals_snapshot ?? weekQ.data?.checkin.goals_snapshot ?? null;
  const closed = dayData?.week.closed ?? weekQ.data?.checkin.closed_at != null;
  const eff: DailyLog | null = useMemo(() => {
    if (!dayData) return null;
    const { persisted: _p, ...row } = dayData.day;
    return { ...row, ...draft } as DailyLog;
  }, [dayData, draft]);
  const workouts = dayData?.workouts ?? [];

  const summary = useMemo(() => {
    if (!ws || !goals || !eff) return null;
    const logs = (weekQ.data?.days ?? []).filter((l): l is DailyLog => l !== null && l.log_date !== eff.log_date);
    logs.push(eff);
    const wk = (weekQ.data?.workouts ?? []).filter((w) => w.log_date !== eff.log_date).concat(workouts);
    return weeklySummary({ weekStart: ws, logs, workouts: wk, goals });
  }, [ws, goals, eff, weekQ.data, workouts]);

  function go(d: string) {
    router.replace(d === today ? pathname : `${pathname}?date=${d}`, { scroll: false });
  }

  async function saveFields(patch: DayPatch) {
    if (!date) return;
    const keys = Object.keys(patch) as (keyof DayPatch)[];
    const clear = () =>
      setDraft((d) => {
        const n = { ...d };
        keys.forEach((k) => delete n[k as keyof typeof n]);
        return n;
      });
    await save({
      apply: () => setDraft((d) => ({ ...d, ...patch })),
      request: () => api.putDay(date, patch),
      onSuccess: (r) => {
        setDay(r);
        setWeek((w) => mergeDay(w, r));
        clear();
      },
      rollback: clear,
    });
  }

  function reloadAll() {
    void dayQ.refetch();
    void weekQ.refetch();
  }

  if (!date || !ws) return <SkeletonCard lines={4} />;
  const loadError = dayQ.error ?? weekQ.error;
  if (loadError && !dayData) {
    return (
      <>
        <h1 className="title">Today</h1>
        <Card>
          <InlineError message={`Could not load this day: ${loadError}`} onRetry={reloadAll} />
        </Card>
      </>
    );
  }
  if (!dayData || !eff || !goals || !summary) {
    return (
      <>
        <h1 className="title">Today</h1>
        <div className="stack">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </div>
      </>
    );
  }

  const live = today !== null && date >= today;
  const targets = eff.day_type === 'ACTIVE' ? goals.active : goals.rest;
  const adh = dailyAdherence(eff, goals);
  const wn = settings.data?.program_start_date ? weekNumber(ws, settings.data.program_start_date) : null;
  const edited = (k: Field) => {
    const dv = draft[k];
    if (dv === null) return false;
    if (dv !== undefined) return true;
    return eff.edited_fields.includes(k);
  };

  // sync pill
  const last = syncQ.data?.last_sync_at ?? null;
  let pill: { cls: string; text: string };
  if (syncQ.error) pill = { cls: 'idle', text: 'Sync status unavailable' };
  else if (!syncQ.data) pill = { cls: 'idle', text: 'Checking sync…' };
  else if (!last) pill = { cls: 'warn', text: 'Never synced. Tap Sync Apple Health' };
  else if (todayInTz(tz, new Date(last)) === today) pill = { cls: '', text: `Last sync today ${timeIn(last, tz)}` };
  else pill = { cls: 'warn', text: `Last sync ${shortDateIn(last, tz)} ${timeIn(last, tz)}. Tap Sync Apple Health` };

  const stepsPct = eff.steps === null ? null : (eff.steps / goals.daily_step_goal) * 100;
  const stepsStatus = live ? 'none' : statusForPercent('volume', stepsPct);
  const w = summary.weight;
  const calPct = adh.calories_kcal.pct;
  const calStatus = statusForPercent('macro', calPct);

  // energy
  const dayNet = eff.calories_kcal !== null && eff.resting_kcal !== null && eff.active_kcal_total !== null ? eff.calories_kcal - (eff.resting_kcal + eff.active_kcal_total) : null;
  const e = summary.energy;
  let weekEnergy: { net: number; days: number; avg: number | null; fallback: boolean } | null = null;
  if (e.days_counted > 0) weekEnergy = { net: e.net_kcal, days: e.days_counted, avg: e.avg_net_per_day, fallback: false };
  else {
    // doc 01 section 9: no resting energy -> eaten minus workout kcal over days with calories
    const logs = [...(weekQ.data?.days ?? []).filter((l): l is DailyLog => !!l && l.log_date !== eff.log_date), eff].filter((l) => l.calories_kcal !== null);
    if (logs.length) {
      const allW = (weekQ.data?.workouts ?? []).filter((x) => x.log_date !== eff.log_date).concat(workouts);
      const net = logs.reduce((s, l) => s + (l.calories_kcal as number) - allW.filter((x) => x.log_date === l.log_date).reduce((a, x) => a + (x.active_kcal ?? 0), 0), 0);
      weekEnergy = { net, days: logs.length, avg: net / logs.length, fallback: true };
    }
  }
  const volumeToday = workouts.filter((x) => x.category === 'STRENGTH').reduce((s, x) => s + (x.volume_kg ?? 0), 0);

  return (
    <>
      <div className="titlebar">
        <div>
          <h1 className="title">Today</h1>
          <p className="sub">
            {longDate(date)} · Week {wn ?? '—'}
            {closed ? ' · Closed' : ''}
          </p>
          <span className={`syncpill ${pill.cls}`}>
            <Icon name="sync" sm />
            {pill.text}
          </span>
        </div>
        <a className="btn primary ios-only" href="shortcuts://run-shortcut?name=Sync%20Proof%20of%20Work">
          <Icon name="sync" />
          Sync Apple Health
        </a>
      </div>

      {offline ? (
        <div className="banner st-near" role="status">
          <Icon name="alert" />
          You are offline. Changes are not saved.
        </div>
      ) : null}
      {closed ? <LockBanner closedAt={weekQ.data?.checkin.closed_at} weekLabel={wn ? `Week ${wn}` : undefined} /> : null}

      <Card className="strip" style={{ marginBottom: 12 }}>
        <div className="row between" style={{ padding: '0 4px 6px' }}>
          <Button variant="ghost" iconOnly aria-label="Previous week" onClick={() => go(addDays(date, -7))}>
            <Icon name="left" />
          </Button>
          <span className="small muted" style={{ fontWeight: 600 }}>
            {mdOf(ws)} – {mdOf(addDays(ws, 6))}
          </span>
          <Button variant="ghost" iconOnly aria-label="Next week" onClick={() => go(addDays(date, 7))}>
            <Icon name="right" />
          </Button>
        </div>
        <WeekStrip
          weekStart={ws}
          selected={date}
          onSelect={go}
          ariaLabel={`Days of Week ${wn ?? ''}`.trim()}
          hasData={(d) => hasData(d === date ? eff : weekQ.data?.days.find((l) => l?.log_date === d))}
        />
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div className="row between wrapflex" style={{ marginBottom: 10 }}>
          <span className="eyebrow">Day type sets {date === today ? "today's" : "this day's"} targets</span>
          <Pill tone="on" icon="check">
            Target: {num(targets.calories_kcal)} kcal
          </Pill>
        </div>
        <SegmentedControl
          ariaLabel="Day type"
          value={eff.day_type}
          disabled={closed}
          onChange={(v) => void saveFields({ day_type: v })}
          options={[
            { value: 'ACTIVE', label: 'Active Day', sub: `${num(goals.active.calories_kcal)} kcal` },
            { value: 'REST', label: 'Rest Day', sub: `${num(goals.rest.calories_kcal)} kcal` },
          ]}
        />
      </Card>

      <div className="g g2" style={{ marginBottom: 12 }}>
        <Card>
          <CardHeader
            icon="scale"
            tone="blue"
            title="Morning weigh-in"
            subtitle={`Goal: ${goals.weekly_weighin_goal} weigh-ins per week`}
            right={
              <Pill tone={w.goal_met ? 'on' : 'near'} icon={w.goal_met ? 'check' : 'near'}>
                {w.count}/{goals.weekly_weighin_goal} min
              </Pill>
            }
          />
          <NumberField label="Weight in kilograms" unit="kg" value={eff.weight_kg} min={30} max={300} disabled={closed} edited={edited('weight_kg')} onChange={(v) => setDraft((d) => ({ ...d, weight_kg: v }))} onCommit={(v) => void saveFields({ weight_kg: v })} />
          <div className="kv" style={{ marginTop: 12 }}>
            <span className="muted">Current week average</span>
            <b style={{ color: 'var(--blue-text)' }}>{w.avg_kg === null ? '—' : `${num(w.avg_kg, 1)} kg`}</b>
          </div>
        </Card>
        <Card>
          <CardHeader
            icon="steps"
            tone="green"
            title="Steps"
            subtitle={`Target: ${num(goals.daily_step_goal)} per day`}
            right={
              stepsPct === null ? (
                <StatusBadge status="none" />
              ) : (
                <StatusBadge status={stepsStatus} text={`${num(stepsPct, 0)}%${live ? ' so far' : ''}`} />
              )
            }
          />
          <NumberField label="Steps today" unit="steps" value={eff.steps} min={0} max={100000} integer disabled={closed} edited={edited('steps')} onChange={(v) => setDraft((d) => ({ ...d, steps: v }))} onCommit={(v) => void saveFields({ steps: v })} />
          <MacroBar className="mt-3" pct={stepsPct} color="steps" label="Steps progress" />
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="muted">Weekly cumulative</span>
            <b>
              {num(summary.steps.total)} / {num(goals.weekly_step_goal)} ({num(summary.steps.pct_of_weekly_goal, 1)}%)
            </b>
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader
          icon="fork"
          tone="red"
          title="Nutrition"
          subtitle={`Comparing against ${eff.day_type === 'ACTIVE' ? 'Active Day' : 'Rest Day'} targets`}
          right={
            calPct === null ? (
              <Pill tone="none">No calories yet</Pill>
            ) : live ? (
              <StatusBadge status="none" text={`${num(calPct, 1)}% of calorie goal so far`} />
            ) : (
              <StatusBadge status={calStatus} text={`${num(calPct, 0)}% of calorie goal`} long />
            )
          }
        />
        <div className="g g4">
          {MACROS.map((m) => {
            const a = adh[m.key];
            return (
              <div className="mac" key={m.key}>
                <div className="top">
                  <span style={{ color: MACRO_TEXT[m.color] }}>{m.label}</span>
                  <span className="tg">
                    / {num(a.target)} {m.unit}
                  </span>
                </div>
                <NumberField label={`${m.label} consumed, ${m.unit}`} unit={m.unit} size="sm" value={eff[m.key]} min={0} max={m.max} disabled={closed} edited={edited(m.key)} onChange={(v) => setDraft((d) => ({ ...d, [m.key]: v }))} onCommit={(v) => void saveFields({ [m.key]: v })} />
                <MacroBar className="mt-3" pct={a.pct} color={m.color} label={`${m.label} progress`} />
                <div className="pc">{a.pct === null ? <span className="muted">No data</span> : <StatusBadge status={live ? 'none' : statusForPercent('macro', a.pct)} text={`${num(a.pct, 1)}%${live ? ' so far' : ''}`} />}</div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="linkbtn"
          style={{ marginTop: 6 }}
          disabled={closed}
          onClick={() => {
            if (eff.protein_g === null && eff.carbs_g === null && eff.fat_g === null) {
              toast('Enter protein, carbs or fat first');
              return;
            }
            const k = kcalFromMacros(eff.protein_g ?? 0, eff.carbs_g ?? 0, eff.fat_g ?? 0);
            void saveFields({ calories_kcal: k }).then(() => toast(`Calories set to ${num(k)} kcal`));
          }}
        >
          <Icon name="bolt" sm />
          Calculate kcal from macros (4P + 4C + 9F)
        </button>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="dumbbell" tone="indigo" title="Training & energy" subtitle="Garmin Forerunner 965 calories plus Strong volume" />
        <ul className="sessions" aria-label="Sessions for this day">
          {workouts.length === 0 ? (
            <li className="sess">
              <span className="muted">No sessions logged for this day.</span>
            </li>
          ) : (
            workouts.map((x) => (
              <li className="sess" key={x.id}>
                <span className={`chipcat ${x.category.toLowerCase()}`}>{x.category}</span>
                <b className="ttl">{x.type_label}</b>
                <span>
                  <b>{num(x.active_kcal)}</b> <span className="muted small">kcal</span>
                </span>
                <Button variant="ghost" small iconOnly aria-label={`Edit ${x.type_label}`} disabled={closed} onClick={() => { setEditing(x); setSessionOpen(true); }}>
                  <Icon name="pencil" sm />
                </Button>
                <Button variant="ghost" small iconOnly aria-label={`Delete ${x.type_label}`} disabled={closed} onClick={() => setDeleting(x)}>
                  <Icon name="trash" sm />
                </Button>
                <span className="meta">
                  {x.duration_min ? `${num(x.duration_min)} min` : ''}
                  {x.volume_kg ? ` · ${num(x.volume_kg)} kg` : ''}
                  {x.source === 'apple_health' ? ' · Garmin' : x.source === 'strong' ? ' · Strong' : ' · manual'}
                </span>
                {x.strong_raw_txt ? (
                  <details className="rcpt">
                    <summary>
                      <Icon name="doc" sm />
                      Routine receipt: {x.strong_title ?? ''}
                    </summary>
                    <pre>{x.strong_raw_txt}</pre>
                  </details>
                ) : null}
              </li>
            ))
          )}
        </ul>
        <div className="row wrapflex" style={{ margin: '8px 0' }}>
          <Button small icon="plus" disabled={closed} onClick={() => { setEditing(null); setSessionOpen(true); }}>
            Add session
          </Button>
          <Button small variant="tint" icon="doc" disabled={closed} onClick={() => setStrongOpen(true)}>
            Import from Strong{volumeToday ? ` · ${num(volumeToday)} kg today` : ''}
          </Button>
        </div>
        <div className="g g2" style={{ margin: '12px 0' }}>
          <NumberField showLabel label="Resting energy (kcal)" unit="kcal" size="sm" placeholder="Not synced yet" value={eff.resting_kcal} min={0} max={10000} disabled={closed} edited={edited('resting_kcal')} onChange={(v) => setDraft((d) => ({ ...d, resting_kcal: v }))} onCommit={(v) => void saveFields({ resting_kcal: v })} />
          <NumberField showLabel label="Active energy, whole day (kcal)" unit="kcal" size="sm" placeholder="Not synced yet" value={eff.active_kcal_total} min={0} max={10000} disabled={closed} edited={edited('active_kcal_total')} onChange={(v) => setDraft((d) => ({ ...d, active_kcal_total: v }))} onCommit={(v) => void saveFields({ active_kcal_total: v })} />
        </div>
        <div className="energy" aria-live="polite">
          {dayNet !== null ? (
            <>
              <span>
                Eaten <b>{num(eff.calories_kcal)}</b> {MINUS} (Resting <b>{num(eff.resting_kcal)}</b> + Active <b>{num(eff.active_kcal_total)}</b>) =
              </span>
              <b style={{ fontSize: 20 }}>{signed(dayNet)} kcal</b>
              <StatusBadge status={dayNet < 0 ? 'on_target' : 'near'} text={dayNet < 0 ? 'Deficit' : 'Surplus'} />
            </>
          ) : (
            <span className="muted">
              <Icon name="info" sm /> Net balance needs eaten, resting and active energy for the day. Resting and active energy usually arrive with the 10:30 PM sync.
            </span>
          )}
        </div>
        <div className="energy" style={{ marginTop: 8 }} aria-live="polite">
          {weekEnergy ? (
            <span>
              Week net{weekEnergy.fallback ? ` (eaten ${MINUS} workout kcal, excludes resting energy)` : ''}: <b>{signed(weekEnergy.net)} kcal</b> · <b>{weekEnergy.days} of 7 days</b> counted
              {weekEnergy.avg !== null ? ` · avg ${signed(weekEnergy.avg)}/day` : ''}
            </span>
          ) : (
            <span className="muted">Week net: 0 of 7 days counted</span>
          )}
        </div>
      </Card>

      <SessionModal open={sessionOpen} onClose={() => setSessionOpen(false)} date={date} workout={editing} onSaved={reloadAll} />
      <StrongImportModal open={strongOpen} onClose={() => setStrongOpen(false)} defaultDate={date} workouts={workouts} defaultUnit={settings.data?.strong_default_unit ?? 'lb'} onApplied={reloadAll} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete session?"
        message={deleting ? `${deleting.type_label} (${num(deleting.active_kcal)} kcal) will be removed. A synced session may reappear on the next sync.` : ''}
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const d = deleting;
          setDeleting(null);
          if (!d) return;
          try {
            await api.deleteWorkout(d.id);
            toast('Session deleted');
            reloadAll();
          } catch (err) {
            toast(`Could not delete: ${errorMessage(err)}`);
          }
        }}
      />
    </>
  );
}

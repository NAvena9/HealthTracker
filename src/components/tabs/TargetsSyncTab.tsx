'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { kcalFromMacros, weekStartOf, weeklySummary, type DailyLog, type DayType } from '@/lib/domain';
import { api, unwrap, type Phase, type PhaseInput, type UserSettings } from '@/lib/client/api';
import { errorMessage, useAsync, useSettings, useToday } from '@/lib/client/hooks';
import { applyAppearance } from '@/lib/client/theme';
import { longDate, num, shortDateIn, signed, timeIn } from '@/lib/client/format';
import { getBrowserClient } from '@/lib/supabase/browser';
import { Button, Card, CardHeader, ConfirmDialog, Icon, InlineError, NumberField, SegmentedControl, SkeletonCard, StatusBadge, useToast } from '@/components/ui';
import { PhaseModal } from '@/components/modals/PhaseModal';

type MacroField = 'protein_g' | 'carbs_g' | 'fat_g' | 'kcal';
const R = 54;
const C = 2 * Math.PI * R;

export function TargetsSyncTab() {
  const router = useRouter();
  const toast = useToast();
  const settings = useSettings();
  const today = useToday();
  const tz = settings.data?.timezone ?? 'America/Hermosillo';

  const phasesQ = useAsync(() => api.listPhases(), []);
  const ws = today ? weekStartOf(today) : null;
  const weekQ = useAsync(ws ? () => api.getWeek(ws) : null, [ws]);
  const dayQ = useAsync(today ? () => api.getDay(today) : null, [today]);
  const credQ = useAsync(() => api.getCredentials(), []);
  const syncQ = useAsync(() => api.getSyncStatus(), []);

  const [goalType, setGoalType] = useState<DayType>('ACTIVE');
  const [goalErr, setGoalErr] = useState<string | null>(null);
  const [phaseModal, setPhaseModal] = useState<'edit' | 'new' | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState<{ base: string | null } | null>(null);
  const [startErr, setStartErr] = useState<string | null>(null);
  const testRef = useRef(testing);
  testRef.current = testing;

  // secret is shown once: drop it when leaving the tab
  useEffect(() => () => setSecret(null), []);

  // "Test connection": poll sync status until last_sync_at changes (max 90 s)
  useEffect(() => {
    if (!testing) return;
    let n = 0;
    const id = setInterval(async () => {
      n += 1;
      try {
        const s = await api.getSyncStatus();
        if (s.last_sync_at !== testRef.current?.base) {
          setTesting(null);
          void syncQ.refetch();
          toast(`Connection OK. Sync received ${s.last_sync_at ? timeIn(s.last_sync_at, tz) : ''}`);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (n >= 30) {
        setTesting(null);
        toast('No sync received yet. Check the Shortcut and secret.');
      }
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing === null]);

  const phases = phasesQ.data?.phases ?? [];
  const open: Phase | null = phases.find((p) => p.end_date === null) ?? null;
  const week = weekQ.data;
  const avgNow = week && ws ? weeklySummary({ weekStart: ws, logs: week.days.filter((l): l is DailyLog => !!l), workouts: week.workouts, goals: week.checkin.goals_snapshot }).weight.avg_kg : null;

  async function patchPhase(body: PhaseInput) {
    if (!open) return;
    setGoalErr(null);
    try {
      const r = unwrap<Phase>(await api.patchPhase(open.id, body), 'phase');
      phasesQ.setData((d) => (d ? { phases: d.phases.map((p) => (p.id === r.id ? r : p)) } : d));
      toast('Saved. Open weeks updated');
    } catch (e) {
      setGoalErr(errorMessage(e));
      toast(`Could not save: ${errorMessage(e)}`);
    }
  }
  const macroKey = (k: MacroField) => `${goalType === 'ACTIVE' ? 'active' : 'rest'}_${k}` as keyof Phase;
  const gv = (k: keyof Phase) => (open ? (open[k] as number | null) : null);

  async function saveSetting(patch: Partial<UserSettings>) {
    try {
      await settings.save(patch);
    } catch (e) {
      toast(`Could not save: ${errorMessage(e)}`);
      throw e;
    }
  }

  const stepsToday = dayQ.data?.day.steps ?? null;
  const stepsPct = open && stepsToday !== null ? Math.min(100, (stepsToday / open.daily_step_goal) * 100) : 0;
  const kcalSum = open ? kcalFromMacros(gv(macroKey('protein_g')) ?? 0, gv(macroKey('carbs_g')) ?? 0, gv(macroKey('fat_g')) ?? 0) : 0;

  const cred = credQ.data;
  const last = syncQ.data?.last_sync_at ?? null;
  const lastText = last ? `${shortDateIn(last, tz)} ${timeIn(last, tz)}` : 'never';
  const lastDates = syncQ.data?.last_synced_dates ?? [];

  async function regen() {
    setRegenBusy(true);
    try {
      const r = await api.rotateCredentials();
      setSecret(r.secret);
      setConfirmRegen(false);
      void credQ.refetch();
      toast('New secret created. Copy it now');
    } catch (e) {
      toast(`Could not regenerate: ${errorMessage(e)}`);
      setConfirmRegen(false);
    } finally {
      setRegenBusy(false);
    }
  }
  async function copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
      return true;
    } catch {
      toast('Copy blocked by the browser');
      return false;
    }
  }

  const sinceStart = open && avgNow !== null && open.start_weight_kg !== null ? avgNow - open.start_weight_kg : null;
  const toTarget = open && avgNow !== null && open.target_weight_kg !== null ? avgNow - open.target_weight_kg : null;

  return (
    <>
      <h1 className="title">Targets &amp; Sync</h1>
      <p className="sub" style={{ marginBottom: 12 }}>Goals, Apple Health bridge, data and appearance</p>

      {/* ---------- phase ---------- */}
      {phasesQ.loading && !phasesQ.data ? (
        <SkeletonCard lines={2} />
      ) : phasesQ.error ? (
        <Card style={{ marginBottom: 12 }}>
          <InlineError message={`Could not load phases: ${phasesQ.error}`} onRetry={phasesQ.refetch} />
        </Card>
      ) : (
        <Card style={{ marginBottom: 12 }}>
          <CardHeader
            icon="phase"
            tone="green"
            title={open ? `Phase: ${open.name}` : 'No active phase'}
            subtitle="Goals live in phases. Past weeks keep their own goals snapshot."
            right={
              <div className="row wrapflex">
                {open ? (
                  <Button small onClick={() => setPhaseModal('edit')}>
                    Edit
                  </Button>
                ) : null}
                <Button small variant={open ? 'default' : 'primary'} onClick={() => (open ? setConfirmNew(true) : setPhaseModal('new'))}>
                  {open ? 'Start new phase' : 'Start a phase'}
                </Button>
              </div>
            }
          />
          {open ? (
            <>
              <div className="g g4">
                <div><div className="eyebrow">Started</div><b>{longDate(open.start_date)}</b></div>
                <div><div className="eyebrow">Start weight</div><b>{num(open.start_weight_kg, 1)} kg</b></div>
                <div><div className="eyebrow">Target weight</div><b>{num(open.target_weight_kg, 1)} kg</b></div>
                <div><div className="eyebrow">Now (avg)</div><b>{num(avgNow, 1)} kg</b></div>
              </div>
              {sinceStart !== null || toTarget !== null ? (
                <div className="row wrapflex" style={{ marginTop: 12 }}>
                  {sinceStart !== null ? <StatusBadge status={sinceStart < 0 ? 'on_target' : 'off'} text={`${signed(sinceStart, 1)} kg since start`} /> : null}
                  {toTarget !== null ? <StatusBadge status="near" text={`${num(Math.abs(toTarget), 1)} kg ${toTarget > 0 ? 'to target' : 'past target'}`} /> : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="sub">Start a phase to set macro, step and weigh-in goals.</p>
          )}
          {phases.length > 1 ? (
            <details className="rcpt" style={{ marginTop: 8 }}>
              <summary>
                <Icon name="chev" sm />
                Phase history ({phases.length})
              </summary>
              <ul className="sessions">
                {phases.map((p) => (
                  <li className="sess" key={p.id}>
                    <b className="ttl">{p.name}</b>
                    <span className="small muted">
                      {longDate(p.start_date)} → {p.end_date ? longDate(p.end_date) : 'ongoing'} · {num(p.start_weight_kg, 1)} → {num(p.target_weight_kg, 1)} kg
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      )}

      {/* ---------- goals ---------- */}
      <div className="g g2" style={{ marginBottom: 12 }}>
        <Card>
          <CardHeader icon="fork" tone="red" title="Macro goals" />
          <SegmentedControl ariaLabel="Goal day type" value={goalType} onChange={setGoalType} options={[{ value: 'ACTIVE', label: 'Active Day' }, { value: 'REST', label: 'Rest Day' }]} />
          <div className="g" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 12 }}>
            {(
              [
                ['protein_g', 'Protein', 'g', 2000],
                ['carbs_g', 'Carbs', 'g', 2000],
                ['fat_g', 'Fat', 'g', 2000],
                ['kcal', 'Calories', 'kcal', 10000],
              ] as const
            ).map(([k, label, unit, max]) => (
              <NumberField key={`${goalType}-${k}`} showLabel label={label} unit={unit} size="sm" integer required min={0} max={max} disabled={!open} value={gv(macroKey(k))} onCommit={(v) => void patchPhase({ [macroKey(k)]: v } as PhaseInput)} />
            ))}
          </div>
          {open ? (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Macros add up to {num(kcalSum)} kcal (4P + 4C + 9F). Goal: {num(gv(macroKey('kcal')))} kcal.
            </p>
          ) : null}
          {goalErr ? <InlineError message={goalErr} /> : null}
          <p className="small muted" style={{ margin: '8px 0 0' }}>Changes apply to open weeks of this phase. Closed weeks keep their snapshot.</p>
        </Card>

        <Card>
          <CardHeader icon="steps" tone="green" title="Activity goals" />
          <div className="row" style={{ gap: 16 }}>
            <div className="donut">
              <svg viewBox="0 0 132 132" aria-hidden="true">
                <circle className="tr" cx="66" cy="66" r={R} />
                <circle className="fg" cx="66" cy="66" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - stepsPct / 100)} />
              </svg>
              <div className="c">
                <b style={{ fontSize: 22 }}>{num(open?.daily_step_goal)}</b>
                <span className="small muted">steps / day</span>
              </div>
            </div>
            <div className="fill stack">
              <NumberField showLabel label="Daily steps" unit="steps" size="sm" integer required min={0} max={100000} disabled={!open} value={gv('daily_step_goal')} onCommit={(v) => void patchPhase({ daily_step_goal: v ?? undefined })} />
              <NumberField showLabel label="Weekly steps" unit="steps" size="sm" integer required min={0} max={700000} disabled={!open} value={gv('weekly_step_goal')} onCommit={(v) => void patchPhase({ weekly_step_goal: v ?? undefined })} />
            </div>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Ring shows today's steps against the daily goal ({num(stepsPct, 0)}%).</p>
          <div className="g" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 12 }}>
            <NumberField showLabel label="Weigh-ins" unit="min" size="sm" integer required min={0} max={7} disabled={!open} value={gv('weekly_weighin_goal')} onCommit={(v) => void patchPhase({ weekly_weighin_goal: v ?? undefined })} />
            <NumberField showLabel label="Cardio" unit="x" size="sm" integer min={0} max={21} placeholder="off" disabled={!open} value={gv('weekly_cardio_sessions')} onCommit={(v) => void patchPhase({ weekly_cardio_sessions: v })} />
            <NumberField showLabel label="Strength" unit="x" size="sm" integer min={0} max={21} placeholder="off" disabled={!open} value={gv('weekly_strength_sessions')} onCommit={(v) => void patchPhase({ weekly_strength_sessions: v })} />
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Session targets are optional. Leave empty to turn them off.</p>
        </Card>
      </div>

      {/* ---------- program / units ---------- */}
      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="today" tone="blue" title="Program" subtitle="Week 1 is the week starting on the program start date (a Monday)." />
        <div className="g g2">
          <div>
            <label className="field">
              <span className="fl">Program start date</span>
              <input
                className="plain"
                type="date"
                key={settings.data?.program_start_date ?? 'none'}
                defaultValue={settings.data?.program_start_date ?? ''}
                aria-invalid={startErr ? true : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (weekStartOf(v) !== v) return setStartErr('Program start must be a Monday');
                  setStartErr(null);
                  void saveSetting({ program_start_date: v }).then(() => toast('Program start saved'), () => undefined);
                }}
              />
            </label>
            {startErr ? <InlineError message={startErr} /> : null}
            {open ? (
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  setStartErr(null);
                  void saveSetting({ program_start_date: weekStartOf(open.start_date) }).then(() => toast('Program start saved'), () => undefined);
                }}
              >
                Use Monday of the phase start ({weekStartOf(open.start_date)})
              </button>
            ) : null}
          </div>
          <div>
            <div className="fl" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>Strong export unit</div>
            <SegmentedControl ariaLabel="Strong default unit" value={settings.data?.strong_default_unit ?? 'lb'} onChange={(v) => void saveSetting({ strong_default_unit: v }).catch(() => undefined)} options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]} />
          </div>
        </div>
      </Card>

      {/* ---------- bridge ---------- */}
      <Card style={{ marginBottom: 12 }}>
        <CardHeader icon="heart" tone="red" title="Apple Health sync bridge" subtitle="A web app cannot read HealthKit. An iOS Shortcut posts your data here every night." />
        {credQ.error ? <InlineError message={credQ.error} onRetry={credQ.refetch} /> : null}
        <div className="g g2">
          <div className="stack">
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Webhook URL</div>
              <div className="copyrow">
                <code>{cred?.webhook_url ?? '…'}</code>
                <Button disabled={!cred} icon="copy" onClick={() => cred && void copy(cred.webhook_url, 'Webhook URL copied')}>
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>API secret</div>
              <div className="copyrow">
                <code>{secret ?? (cred?.has_secret ? `pow_••••••••••••••••${cred.last4 ?? ''}` : 'No secret yet')}</code>
                <Button
                  disabled={!secret}
                  icon="copy"
                  onClick={async () => {
                    if (secret && (await copy(secret, 'Secret copied. It is now hidden for good'))) setSecret(null);
                  }}
                >
                  Copy
                </Button>
              </div>
              <div className="row wrapflex" style={{ marginTop: 8 }}>
                <Button small icon="sync" onClick={() => setConfirmRegen(true)}>
                  {cred?.has_secret ? 'Regenerate' : 'Create secret'}
                </Button>
              </div>
              <div className="warnbox" style={{ marginTop: 8 }}>
                <Icon name="alert" sm />
                <span>{secret ? 'Copy this secret now. It is shown once and cannot be viewed again.' : 'The secret is shown once, when created. If you lost it, regenerate it. The old one stops working.'}</span>
              </div>
            </div>
            <div className="kv"><span className="muted">Last sync</span><b>{lastText}</b></div>
            <div className="kv"><span className="muted">Last days received</span><span>{lastDates.length ? lastDates.join(', ') : '—'}</span></div>
            {testing ? (
              <div className="stack">
                <div className="warnbox" style={{ background: 'var(--blue-tint)', color: 'var(--blue-text)' }} role="status">
                  <Icon name="info" sm />
                  <span>Run the Shortcut now (tap Sync Apple Health on Today), then come back. Waiting for a sync…</span>
                </div>
                <Button onClick={() => setTesting(null)}>Cancel test</Button>
              </div>
            ) : (
              <Button icon="bolt" disabled={!cred?.has_secret} onClick={() => setTesting({ base: last })}>
                Test connection
              </Button>
            )}
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>iOS Shortcut setup</div>
            <ol className="steps">
              <li><span>Create a Shortcut named <b>Sync Proof of Work</b>.</span></li>
              <li><span>Add <b>Find Health Samples</b> for steps, weight, dietary protein, carbs, fat and energy, resting and active energy, and workouts (last 3 days).</span></li>
              <li><span>Add <b>Get Contents of URL</b>: method POST, header <code style={{ fontSize: 12 }}>Authorization: Bearer &lt;secret&gt;</code>, JSON body.</span></li>
              <li><span>In Automation, create a <b>Personal Automation</b> at <b>10:30 PM</b> daily and choose <b>Run Immediately</b>.</span></li>
            </ol>
          </div>
        </div>
      </Card>

      {/* ---------- data + appearance ---------- */}
      <div className="g g2" style={{ marginBottom: 12 }}>
        <Card>
          <CardHeader icon="download" tone="neutral" title="Your data" />
          <p className="sub small" style={{ margin: '0 0 10px' }}>Everything you logged, yours to keep. JSON is the full backup.</p>
          <div className="row wrapflex">
            <a className="btn" href={api.exportUrl('json')} download>Export JSON</a>
            <a className="btn" href={api.exportUrl('csv', 'daily_logs')} download>Days CSV</a>
            <a className="btn" href={api.exportUrl('csv', 'workouts')} download>Workouts CSV</a>
            <a className="btn" href={api.exportUrl('csv', 'weekly_checkins')} download>Weeks CSV</a>
          </div>
        </Card>
        <Card>
          <CardHeader icon="sun" tone="neutral" title="Appearance" />
          <SegmentedControl
            ariaLabel="Appearance"
            value={settings.data?.appearance ?? 'system'}
            onChange={(v) => {
              applyAppearance(v);
              void saveSetting({ appearance: v }).catch(() => undefined);
            }}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
          />
        </Card>
      </div>

      <Button
        icon="out"
        onClick={async () => {
          await getBrowserClient().auth.signOut();
          router.replace('/login');
          router.refresh();
        }}
      >
        Sign out
      </Button>

      {/* ---------- dialogs ---------- */}
      <ConfirmDialog
        open={confirmNew}
        title="Start a new phase?"
        message={`This ends the "${open?.name ?? ''}" phase the day before the new start date and starts a new one. Past weeks keep their goals snapshot and stay unchanged.`}
        confirmLabel="Continue"
        onClose={() => setConfirmNew(false)}
        onConfirm={() => {
          setConfirmNew(false);
          setPhaseModal('new');
        }}
      />
      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate API secret?"
        message="The current secret stops working immediately. Your Shortcut will fail until you paste the new secret into it. The new secret is shown once."
        confirmLabel={cred?.has_secret ? 'Regenerate' : 'Create'}
        busy={regenBusy}
        onClose={() => setConfirmRegen(false)}
        onConfirm={regen}
      />
      {today ? <PhaseModal open={phaseModal !== null} onClose={() => setPhaseModal(null)} mode={phaseModal ?? 'new'} phase={open} currentWeightKg={avgNow} today={today} onSaved={() => { void phasesQ.refetch(); void weekQ.refetch(); }} /> : null}
    </>
  );
}

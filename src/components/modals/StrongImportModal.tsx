'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { parseStrongExport, type Workout } from '@/lib/domain';
import { api } from '@/lib/client/api';
import { errorMessage } from '@/lib/client/hooks';
import { longDate, num } from '@/lib/client/format';
import { Button, Icon, InlineError, Modal, useToast } from '@/components/ui';

export interface StrongImportModalProps {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  workouts: Workout[];
  defaultUnit: 'kg' | 'lb';
  onApplied: () => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function clock12(performedAt: string): string {
  const [h, m] = performedAt.slice(11, 16).split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Paste / upload a Strong export, preview it live, attach it to a day (POST /strong/apply). */
export function StrongImportModal({ open, onClose, defaultDate, workouts, defaultUnit, onApplied }: StrongImportModalProps) {
  const toast = useToast();
  const uid = useId();
  const [text, setText] = useState('');
  const [day, setDay] = useState(defaultDate);
  const [dayTouched, setDayTouched] = useState(false);
  const [attach, setAttach] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiWarnings, setApiWarnings] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setText('');
      setDay(defaultDate);
      setDayTouched(false);
      setAttach('');
      setBusy(false);
      setError(null);
      setApiWarnings([]);
    }
  }, [open, defaultDate]);

  const parsed = useMemo(() => (text.trim() ? parseStrongExport(text, { defaultUnit }) : null), [text, defaultUnit]);
  const performedDay = parsed?.performedAt ? parsed.performedAt.slice(0, 10) : null;

  // follow the performed date until the user picks a day by hand
  useEffect(() => {
    if (!dayTouched) setDay(performedDay && ISO_DATE.test(performedDay) ? performedDay : defaultDate);
  }, [performedDay, dayTouched, defaultDate]);

  const strongToday = useMemo(() => workouts.filter((w) => w.log_date === day && w.category === 'STRENGTH'), [workouts, day]);
  useEffect(() => {
    if (!strongToday.some((w) => w.id === attach)) setAttach('');
  }, [strongToday, attach]);

  const hasContent = parsed !== null && !(parsed.totalSets === 0 && parsed.totalVolumeKg === 0);
  const dayValid = ISO_DATE.test(day);
  const canApply = hasContent && dayValid && !busy;

  async function readFile(f: File | undefined) {
    if (!f) return;
    try {
      setText(await f.text());
      setError(null);
    } catch {
      setError('Could not read that file.');
    }
  }

  async function apply() {
    if (!parsed || !canApply) return;
    setBusy(true);
    setError(null);
    setApiWarnings([]);
    try {
      const r = await api.applyStrong({ log_date: day, raw_text: text, attach_to: attach || null });
      toast(`${num(r.parsed.totalVolumeKg)} kg saved on ${longDate(day)}`);
      onApplied();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      const w = (e as { warnings?: unknown }).warnings;
      if (Array.isArray(w)) setApiWarnings(w.filter((x): x is string => typeof x === 'string'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Strong routine"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!canApply} loading={busy}>
            Apply to Day
          </Button>
        </>
      }
    >
      <label className="field">
        <span className="fl">Paste the exported text</span>
        <textarea className="plain" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Title, date, exercises and sets (kg or lb)" spellCheck={false} />
      </label>
      <div className="row wrapflex" style={{ margin: '10px 0' }}>
        <label className="btn sm filebtn">
          <Icon name="download" sm />
          Upload .txt
          <input
            type="file"
            accept=".txt,text/plain"
            aria-label="Upload Strong .txt file"
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div aria-live="polite">
        {!parsed ? (
          <div className="card" style={{ boxShadow: 'none', background: 'var(--elevated)' }}>
            <span className="muted">Nothing to preview yet. Paste a routine or upload the .txt export.</span>
          </div>
        ) : (
          <div className="card" style={{ boxShadow: 'none' }}>
            <div className="eyebrow">Preview</div>
            <h3 className="ct" style={{ marginTop: 2 }}>
              {parsed.workoutTitle || 'Untitled'}
            </h3>
            <p className="sub small">{parsed.performedAt ? `Performed ${longDate(parsed.performedAt.slice(0, 10))} · ${clock12(parsed.performedAt)}` : 'No date found'}</p>
            <div className="stat3">
              <div>
                <b>{parsed.exercises.length}</b>
                <span>exercises</span>
              </div>
              <div>
                <b>{parsed.totalSets}</b>
                <span>sets</span>
              </div>
              <div>
                <b>{num(parsed.totalVolumeKg)}</b>
                <span>kg volume</span>
              </div>
            </div>
            {parsed.exercises.length ? (
              <ul className="exlist" tabIndex={0} role="region" aria-label="Parsed exercises">
                {parsed.exercises.map((ex, i) => (
                  <li key={`${ex.name}-${i}`}>
                    <b>{ex.name}</b> <span className="muted">· {num(ex.exerciseVolumeKg)} kg</span>
                    <div className="sets">{ex.sets.map((s) => (s.weightKg > 0 ? `${num(s.weightKg, 1)} kg × ${s.reps}` : `${s.reps} reps`)).join(' · ')}</div>
                  </li>
                ))}
              </ul>
            ) : null}
            {!hasContent ? (
              <div className="warnbox" style={{ marginTop: 10 }} role="status">
                <Icon name="alert" sm />
                <div>No sets found. Check the pasted text.</div>
              </div>
            ) : null}
            {parsed.warnings.length ? (
              <div className="warnbox" style={{ marginTop: 10 }}>
                <Icon name="alert" sm />
                <div>
                  {parsed.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <label className="field" style={{ marginTop: 12 }}>
        <span className="fl">Attach to day</span>
        <input
          className="plain"
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setDayTouched(true);
          }}
          aria-describedby={`${uid}-note`}
        />
      </label>
      <p className="small muted" id={`${uid}-note`} style={{ margin: '6px 0 0' }}>
        {performedDay && day !== performedDay ? `The export says it was performed ${longDate(performedDay)}. ` : ''}
        Closed weeks are read-only; pick a day in an open week.
      </p>

      {strongToday.length > 0 ? (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="fl">Attach to session</span>
          <select className="plain" value={attach} onChange={(e) => setAttach(e.target.value)}>
            <option value="">{strongToday.length === 1 ? 'Automatic (the existing strength session)' : 'Automatic (synced session if only one, else new)'}</option>
            {strongToday.map((w) => (
              <option key={w.id} value={w.id}>
                {w.type_label}
                {w.active_kcal !== null ? ` · ${num(w.active_kcal)} kcal` : ''}
                {w.volume_kg ? ` · ${num(w.volume_kg)} kg already` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {error ? (
        <div style={{ marginTop: 10 }}>
          <InlineError message={error} />
          {apiWarnings.map((w, i) => (
            <p key={i} className="small muted" style={{ margin: '4px 0 0' }}>
              {w}
            </p>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

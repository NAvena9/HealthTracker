'use client';
import { useEffect, useState } from 'react';
import { addDays, weekStartOf } from '@/lib/domain';
import { api, unwrap, type Phase, type PhaseCreate } from '@/lib/client/api';
import { errorMessage } from '@/lib/client/hooks';
import { Button, InlineError, Modal, NumberField, useToast } from '@/components/ui';

export interface PhaseModalProps {
  open: boolean;
  onClose: () => void;
  /** 'edit' patches `phase`; 'new' starts a new phase (ends the open one) or creates the first. */
  mode: 'edit' | 'new';
  /** Open phase (edit target, and goals template for 'new'). */
  phase: Phase | null;
  /** Prefill for start weight in 'new' mode. */
  currentWeightKg: number | null;
  /** Today in the user's timezone. */
  today: string;
  onSaved: () => void;
}

/** Phase form: name, (start date: new only, must be a Monday), start and target weight. */
export function PhaseModal({ open, onClose, mode, phase, currentWeightKg, today, onSaved }: PhaseModalProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [start, setStart] = useState('');
  const [startW, setStartW] = useState<number | null>(null);
  const [targetW, setTargetW] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thisMonday = weekStartOf(today);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && phase) {
      setName(phase.name);
      setStart(phase.start_date);
      setStartW(phase.start_weight_kg);
      setTargetW(phase.target_weight_kg);
    } else {
      setName('');
      setStart(thisMonday);
      setStartW(currentWeightKg);
      setTargetW(phase?.target_weight_kg ?? null);
    }
  }, [open, mode, phase, currentWeightKg, thisMonday]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a phase name');
    if (mode === 'new') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return setError('Pick a start date');
      if (weekStartOf(start) !== start) return setError(`Start date must be a Monday (use ${thisMonday} or ${addDays(thisMonday, 7)})`);
      if (phase && start <= phase.start_date) return setError('Start date must be after the current phase start');
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'edit' && phase) {
        await api.patchPhase(phase.id, { name: name.trim(), start_weight_kg: startW, target_weight_kg: targetW });
        toast('Phase updated');
      } else {
        const goals = phase
          ? {
              active_protein_g: phase.active_protein_g, active_carbs_g: phase.active_carbs_g, active_fat_g: phase.active_fat_g, active_kcal: phase.active_kcal,
              rest_protein_g: phase.rest_protein_g, rest_carbs_g: phase.rest_carbs_g, rest_fat_g: phase.rest_fat_g, rest_kcal: phase.rest_kcal,
              daily_step_goal: phase.daily_step_goal, weekly_step_goal: phase.weekly_step_goal, weekly_weighin_goal: phase.weekly_weighin_goal,
              weekly_cardio_sessions: phase.weekly_cardio_sessions, weekly_strength_sessions: phase.weekly_strength_sessions,
            }
          : {};
        const body: PhaseCreate = { ...goals, name: name.trim(), start_date: start, start_weight_kg: startW, target_weight_kg: targetW };
        if (phase) await api.startNewPhase(body);
        else unwrap<Phase>(await api.createPhase(body), 'phase');
        toast('Phase started');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={mode === 'edit' ? 'Edit phase' : 'New phase'} narrow>
      <form onSubmit={submit} className="stack" autoComplete="off">
        <label className="field">
          <span className="fl">Name</span>
          <input className="plain" value={name} maxLength={60} placeholder="Cut" onChange={(e) => setName(e.target.value)} />
        </label>
        {mode === 'new' ? (
          <div>
            <label className="field">
              <span className="fl">Start date (a Monday)</span>
              <input className="plain" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <button type="button" className="linkbtn" onClick={() => setStart(thisMonday)}>
              Use Monday of this week ({thisMonday})
            </button>
          </div>
        ) : null}
        <div className="g g2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <NumberField showLabel label="Start weight" unit="kg" size="sm" value={startW} min={30} max={300} onChange={setStartW} />
          <NumberField showLabel label="Target weight" unit="kg" size="sm" value={targetW} min={30} max={300} onChange={setTargetW} />
        </div>
        {mode === 'new' ? <p className="small muted" style={{ margin: 0 }}>Goals are copied from the current phase; edit them afterwards on this tab.</p> : null}
        {error ? <InlineError message={error} /> : null}
        <div className="mf">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {mode === 'edit' ? 'Save' : 'Start phase'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

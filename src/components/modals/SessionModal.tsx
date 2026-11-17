'use client';
import { useEffect, useState } from 'react';
import type { Workout, WorkoutCategory } from '@/lib/domain';
import { api } from '@/lib/client/api';
import { errorMessage } from '@/lib/client/hooks';
import { Button, InlineError, Modal, NumberField, useToast } from '@/components/ui';

export interface SessionModalProps {
  open: boolean;
  onClose: () => void;
  /** Day the session belongs to (YYYY-MM-DD). */
  date: string;
  /** null = add; a Workout = edit. */
  workout: Workout | null;
  /** Called after a successful save. */
  onSaved: () => void;
}

/** Add / edit a workout session (category, type, kcal 0-5000, minutes). */
export function SessionModal({ open, onClose, date, workout, onSaved }: SessionModalProps) {
  const toast = useToast();
  const [category, setCategory] = useState<WorkoutCategory>('CARDIO');
  const [label, setLabel] = useState('Running');
  const [kcal, setKcal] = useState<number | null>(300);
  const [minutes, setMinutes] = useState<number | null>(40);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCategory(workout?.category ?? 'CARDIO');
    setLabel(workout?.type_label ?? 'Running');
    setKcal(workout ? workout.active_kcal : 300);
    setMinutes(workout ? workout.duration_min : 40);
  }, [open, workout]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setError('Enter a session type');
      return;
    }
    if (kcal !== null && (kcal < 0 || kcal > 5000)) {
      setError('Workout kcal must be 0 to 5,000');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (workout) await api.patchWorkout(workout.id, { category, type_label: label.trim(), active_kcal: kcal, duration_min: minutes });
      else await api.createWorkout({ log_date: date, category, type_label: label.trim(), active_kcal: kcal, duration_min: minutes });
      toast(workout ? 'Session updated' : 'Session added');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={workout ? 'Edit session' : 'Add session'} narrow>
      <form onSubmit={submit} className="stack" autoComplete="off">
        <label className="field">
          <span className="fl">Category</span>
          <select className="plain" value={category} onChange={(e) => setCategory(e.target.value as WorkoutCategory)}>
            <option value="CARDIO">Cardio</option>
            <option value="STRENGTH">Strength</option>
          </select>
        </label>
        <label className="field">
          <span className="fl">Type</span>
          <input className="plain" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <div className="g g2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <NumberField showLabel label="kcal" value={kcal} unit="kcal" min={0} max={5000} size="sm" onChange={setKcal} />
          <NumberField showLabel label="Minutes" value={minutes} unit="min" min={0} max={1440} size="sm" onChange={setMinutes} />
        </div>
        {error ? <InlineError message={error} /> : null}
        <div className="mf">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>
            {workout ? 'Save' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

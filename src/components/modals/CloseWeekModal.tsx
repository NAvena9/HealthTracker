'use client';
import { useEffect, useState } from 'react';
import { api, type WeekResponse } from '@/lib/client/api';
import { errorMessage } from '@/lib/client/hooks';
import { Button, InlineError, Modal } from '@/components/ui';

export interface CloseWeekModalProps {
  open: boolean;
  onClose: () => void;
  weekStart: string;
  /** Week number from program start, or null. */
  weekNumber: number | null;
  /** True when the week is still in progress (adds the "not over yet" note). */
  early: boolean;
  onClosed: (week: WeekResponse) => void;
}

/** Confirm dialog -> POST /weeks/{weekStart}/close. */
export function CloseWeekModal({ open, onClose, weekStart, weekNumber, early, onClosed }: CloseWeekModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);
  const label = weekNumber !== null && weekNumber > 0 ? `Week ${weekNumber}` : 'this week';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const w = await api.closeWeek(weekStart);
      onClosed(w);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Close ${label}?`}
      narrow
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={confirm}>
            Close week
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 15, margin: 0 }}>
        Closing locks {label} as your record. Edits stop and incoming syncs are ignored
        {early ? '. This week is not over yet, so later days will stay empty' : ''}. You can reopen it later.
      </p>
      {error ? (
        <div style={{ marginTop: 10 }}>
          <InlineError message={error} />
        </div>
      ) : null}
    </Modal>
  );
}

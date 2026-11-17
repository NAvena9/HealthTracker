'use client';
import { useEffect, useId, useState } from 'react';
import { api, type WeekResponse } from '@/lib/client/api';
import { errorMessage } from '@/lib/client/hooks';
import { Button, InlineError, Modal } from '@/components/ui';

export interface ReopenConfirmModalProps {
  open: boolean;
  onClose: () => void;
  weekStart: string;
  weekNumber: number | null;
  onReopened: (week: WeekResponse) => void;
}

/** Confirm dialog -> POST /weeks/{weekStart}/reopen { confirm: true, refresh_goals? }. */
export function ReopenConfirmModal({ open, onClose, weekStart, weekNumber, onReopened }: ReopenConfirmModalProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setBusy(false);
      setRefresh(false);
      setError(null);
    }
  }, [open]);
  const label = weekNumber !== null && weekNumber > 0 ? `Week ${weekNumber}` : 'this week';

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const w = await api.reopenWeek(weekStart, refresh ? { confirm: true, refresh_goals: true } : { confirm: true });
      onReopened(w);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reopen ${label}?`}
      narrow
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={confirm}>
            Reopen week
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 15, margin: 0 }}>Reopening makes this week editable again and lets syncs update it. Its goals snapshot stays the same unless you choose to refresh it.</p>
      <label htmlFor={id} className="row" style={{ marginTop: 12, minHeight: 44, alignItems: 'center', gap: 10, fontSize: 15 }}>
        <input id={id} type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} style={{ width: 22, height: 22 }} />
        <span>Refresh goals from the phase</span>
      </label>
      {error ? (
        <div style={{ marginTop: 10 }}>
          <InlineError message={error} />
        </div>
      ) : null}
    </Modal>
  );
}

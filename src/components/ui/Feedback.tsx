'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';

/* ---------- Toast ---------- */
type ToastFn = (message: string) => void;
const ToastCtx = createContext<ToastFn | null>(null);

/** Mount once (AppShell does). One toast at a time, 2.6s, role=status. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback<ToastFn>((m) => {
    setMsg(m);
    setShow(true);
    clearTimeout(t.current);
    t.current = setTimeout(() => setShow(false), 2600);
  }, []);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={`toast ${show ? 'show' : ''}`} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}
/** `const toast = useToast(); toast('Saved')`. */
export function useToast(): ToastFn {
  const c = useContext(ToastCtx);
  return c ?? (() => undefined);
}

/* ---------- inline error ---------- */
/** Inline validation / failure message (role=alert). Optional retry button. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="err" role="alert" style={{ flexWrap: 'wrap' }}>
      <Icon name="alert" sm />
      <span>{message}</span>
      {onRetry ? (
        <Button small variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/* ---------- loading ---------- */
/** Rotating spinner (inline). */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} style={{ display: 'inline-flex' }}>
      <Icon name="spinner" className="spin" />
    </span>
  );
}
/** Grey block placeholder. */
export function Skeleton({ height = 16, width = '100%', className = '' }: { height?: number | string; width?: number | string; className?: string }) {
  return <div className={`skel ${className}`} style={{ height, width }} aria-hidden="true" />;
}
/** Card-shaped skeleton used while a tab loads. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Loading">
      <Skeleton height={20} width="40%" />
      <div style={{ height: 12 }} />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} style={{ marginTop: i ? 10 : 0 }}>
          <Skeleton height={44} />
        </div>
      ))}
    </div>
  );
}

/* ---------- lock banner ---------- */
/** Shown on closed weeks. `closedAt` ISO string. */
export function LockBanner({ closedAt, weekLabel }: { closedAt?: string | null; weekLabel?: string }) {
  const when = closedAt ? new Date(closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return (
    <div className="banner lockbanner" role="status">
      <Icon name="lock" />
      <span>
        {weekLabel ? `${weekLabel} is closed` : 'This week is closed'}
        {when ? ` (${when})` : ''}. Read-only; incoming syncs are ignored.
      </span>
    </div>
  );
}

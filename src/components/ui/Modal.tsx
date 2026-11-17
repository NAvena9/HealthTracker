'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Button } from './Button';

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,a[href],[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 440px confirm-style dialog instead of 620px. */
  narrow?: boolean;
  /** Footer buttons (right-aligned: secondary left, primary right). */
  footer?: ReactNode;
}

/**
 * Accessible dialog: bottom sheet < 768px, centered >= 768px. role=dialog, aria-modal, labelled by title,
 * focus trap, Esc + backdrop close, focus returns to opener, rest of page set `inert`.
 */
export function Modal({ open, onClose, title, children, narrow, footer }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current?.closest('[data-modal-root]') as HTMLElement | null;
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children) as HTMLElement[]) {
      if (el !== root && !el.hasAttribute('inert')) {
        el.setAttribute('inert', '');
        inerted.push(el);
      }
    }
    const dlg = ref.current;
    const focusables = () => (dlg ? (Array.from(dlg.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter((e) => e.offsetParent !== null) : []);
    const f = focusables();
    (f.find((e) => e.dataset.close === undefined) ?? f[0] ?? dlg)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab') {
        const l = focusables();
        if (!l.length) return;
        const first = l[0]!;
        const last = l[l.length - 1]!;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dlg)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      inerted.forEach((el) => el.removeAttribute('inert'));
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div data-modal-root>
      <div
        className="scrim"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div ref={ref} className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <div className="grab" aria-hidden="true" />
          <div className="mh">
            <h2 id={titleId}>{title}</h2>
            <Button variant="ghost" iconOnly aria-label="Close dialog" data-close onClick={onClose}>
              <Icon name="close" />
            </Button>
          </div>
          <div>{children}</div>
          {footer ? <div className="mf">{footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Narrow confirm dialog: Cancel left, primary right. Esc/Cancel never run `onConfirm`. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Cancel', busy, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel: string; cancelLabel?: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      narrow
      footer={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 15 }}>{message}</div>
    </Modal>
  );
}

'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

function fmt(v: number | null): string {
  return v === null || v === undefined ? '' : String(v);
}

export interface NumberFieldProps {
  /** Accessible name (visible only when `showLabel`). */
  label: string;
  showLabel?: boolean;
  /** Committed value. null = empty (never 0). */
  value: number | null;
  unit?: string;
  /** Called on every keystroke with the parsed VALID value (null when empty). Use for live derived numbers. */
  onChange?: (v: number | null) => void;
  /** Called on blur / Enter when the text is valid and differs from `value`. Save here. */
  onCommit?: (v: number | null) => void;
  min?: number;
  max?: number;
  /** Reject decimals. */
  integer?: boolean;
  /** Empty not allowed (shows an error on blur). */
  required?: boolean;
  /** Show the pencil "edited by hand" marker. */
  edited?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  placeholder?: string;
  /** Extra error (e.g. server message). */
  error?: string | null;
  /** Message for invalid range; default "Enter {min} to {max} {unit}". */
  rangeMessage?: string;
  className?: string;
}

/** Parse text. Returns {v} or {err}. Comma accepted as decimal separator. */
export function parseNumber(text: string, o: { min?: number; max?: number; integer?: boolean; required?: boolean; unit?: string; rangeMessage?: string }): { v: number | null; err?: string } {
  const t = text.trim().replace(',', '.');
  if (t === '') return o.required ? { v: null, err: 'Enter a number' } : { v: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { v: null, err: 'Enter a number' };
  if (o.integer && !Number.isInteger(n)) return { v: null, err: 'Enter a whole number' };
  if ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max)) {
    const msg = o.rangeMessage ?? `Enter ${o.min !== undefined ? o.min.toLocaleString('en-US') : ''} to ${o.max !== undefined ? o.max.toLocaleString('en-US') : ''}${o.unit ? ' ' + o.unit : ''}`;
    return { v: null, err: msg };
  }
  return { v: n };
}

/**
 * Controlled numeric input. Empty string -> null, never 0. inputMode decimal (numeric when `integer`).
 * Text is kept locally while typing; external `value` changes are adopted when not focused.
 */
export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(fmt(p.value));
  const [err, setErr] = useState<string | null>(null);
  const focused = useRef(false);
  // Value when editing started. `p.value` may already include the live draft pushed through onChange,
  // so "changed" must be judged against what the field held on focus.
  const startValue = useRef<number | null>(p.value);
  useEffect(() => {
    if (!focused.current) {
      setText(fmt(p.value));
      setErr(null);
    }
  }, [p.value]);

  const opts = { min: p.min, max: p.max, integer: p.integer, required: p.required, unit: p.unit, rangeMessage: p.rangeMessage };
  const shownErr = err ?? p.error ?? null;

  function commit() {
    const r = parseNumber(text, opts);
    if (r.err) {
      setErr(r.err);
      return;
    }
    setErr(null);
    const before = focused.current ? startValue.current : p.value;
    if (r.v !== before) {
      startValue.current = r.v;
      p.onCommit?.(r.v);
    }
  }

  return (
    <label className={`field ${p.className ?? ''}`}>
      <span className={p.showLabel ? 'fl' : 'sr'}>{p.label}</span>
      <span className={`inp ${p.size === 'sm' ? 'sm' : ''}`} aria-invalid={shownErr ? true : undefined}>
        <input
          id={id}
          value={text}
          inputMode={p.integer ? 'numeric' : 'decimal'}
          autoComplete="off"
          disabled={p.disabled}
          placeholder={p.placeholder}
          aria-invalid={shownErr ? true : undefined}
          aria-describedby={shownErr ? `${id}-err` : undefined}
          onFocus={() => {
            focused.current = true;
            startValue.current = p.value;
          }}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const r = parseNumber(t, opts);
            setErr(r.err ?? null);
            if (!r.err) p.onChange?.(r.v);
          }}
          onBlur={() => {
            commit();
            focused.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {p.unit ? <em>{p.unit}</em> : null}
        {p.edited ? (
          <span className="edited">
            <Icon name="pencil" />
            <span className="sr">Edited by hand. Sync will not overwrite this field.</span>
          </span>
        ) : null}
      </span>
      {shownErr ? (
        <span className="err" id={`${id}-err`} role="alert">
          <Icon name="alert" sm />
          {shownErr}
        </span>
      ) : null}
    </label>
  );
}

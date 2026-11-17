'use client';
import type { ReactNode } from 'react';

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Second line (e.g. "2,350 kcal"). */
  sub?: ReactNode;
}

/** 2-3 option segmented control with sliding pill. Group of `aria-pressed` buttons. */
export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel, disabled, className = '' }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; ariaLabel: string; disabled?: boolean; className?: string }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`seg ${className}`} role="group" aria-label={ariaLabel} style={{ ['--n' as string]: options.length, ['--i' as string]: i }}>
      <span className="seg-pill" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={disabled} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
          {o.sub ? <small>{o.sub}</small> : null}
        </button>
      ))}
    </div>
  );
}

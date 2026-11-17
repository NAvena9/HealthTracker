import type { ReactNode } from 'react';
import type { Status } from '@/lib/domain';
import { Icon, type IconName } from './Icon';

export type PillTone = 'on' | 'near' | 'off' | 'none' | 'blue' | 'indigo' | 'amber';
const TONE: Record<PillTone, string> = { on: 'st-on', near: 'st-near', off: 'st-off', none: 'st-none', blue: 't-blue', indigo: 't-indigo', amber: 't-amber' };

/** Small rounded label. `tone` picks the tint/text pair; optional leading icon. */
export function Pill({ tone = 'none', icon, children, className = '', ...rest }: { tone?: PillTone; icon?: IconName; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`pill ${TONE[tone]} ${className}`} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

const STATUS: Record<Status, { tone: PillTone; icon: IconName; label: string }> = {
  on_target: { tone: 'on', icon: 'check', label: 'On target' },
  near: { tone: 'near', icon: 'near', label: 'Near' },
  off: { tone: 'off', icon: 'minus', label: 'Off target' },
  none: { tone: 'none', icon: 'dash', label: 'No data' },
};

/**
 * Domain `Status` -> pill (green / amber / neutral / grey, never red). Always icon + word.
 * `text` replaces the default label ("97% so far"); `long` appends " · <label>" to `text`.
 * For live (in-progress) days pass `status="none"` with `text="26% so far"`.
 */
export function StatusBadge({ status, text, long }: { status: Status; text?: string; long?: boolean }) {
  const s = STATUS[status];
  const label = text === undefined ? s.label : long ? `${text} · ${s.label}` : text;
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {label}
    </Pill>
  );
}

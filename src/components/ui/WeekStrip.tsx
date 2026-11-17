'use client';
import { weekDates } from '@/lib/domain';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon" for a YYYY-MM-DD (UTC math, no timezone drift). */
export function dowOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DOW[(new Date(Date.UTC(y!, m! - 1, d)).getUTCDay() + 6) % 7]!;
}
/** "Nov 16" */
export function mdOf(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${MON[m! - 1]} ${d}`;
}

/** Mon-Sun day picker. Dot is green when `hasData(date)`. Selected = filled. */
export function WeekStrip({ weekStart, selected, onSelect, hasData, ariaLabel }: { weekStart: string; selected: string; onSelect: (date: string) => void; hasData: (date: string) => boolean; ariaLabel?: string }) {
  return (
    <div className="week" role="group" aria-label={ariaLabel ?? 'Days of the week'}>
      {weekDates(weekStart).map((d) => (
        <button key={d} type="button" className="day" aria-pressed={d === selected} aria-label={`${dowOf(d)} ${mdOf(d)}`} onClick={() => onSelect(d)}>
          <span className="dn">{dowOf(d)}</span>
          <b>{Number(d.slice(8))}</b>
          <span className={`dot ${hasData(d) ? 'on' : ''}`} />
        </button>
      ))}
    </div>
  );
}

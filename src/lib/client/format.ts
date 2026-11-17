export const MINUS = '−';

/** 12,345.6 style, "—" for null/NaN, true minus sign for negatives. */
export function num(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Math.abs(n).toFixed(d);
  const [i, f] = v.split('.');
  const body = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  return Number(n.toFixed(d)) < 0 ? MINUS + body : body;
}

/** +1,200 / −450 / 0 */
export function signed(n: number | null | undefined, d = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return (Number(n.toFixed(d)) > 0 ? '+' : '') + num(n, d);
}

/** "Mon, Nov 16" */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "8:02 AM" in tz */
export function timeIn(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
}
/** "Nov 15" in tz */
export function shortDateIn(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
}

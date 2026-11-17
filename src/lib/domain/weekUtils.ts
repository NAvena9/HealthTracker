// Week and date helpers. All math is done on 'YYYY-MM-DD' strings via Date.UTC,
// so results never depend on the machine timezone.

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** Add (or subtract) whole days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** Monday of the week containing `date` (Sunday belongs to the previous Monday's week). */
export function weekStartOf(date: string): string {
  const dow = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // Monday -> 0, Sunday -> 6
  return addDays(date, -back);
}

/** The 7 dates Monday..Sunday of the week starting at `weekStart`. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Whole weeks since the program start week, plus 1. Can be <= 0 before the program starts. */
export function weekNumber(weekStart: string, programStart: string): number {
  const diffMs = toUtcMs(weekStartOf(weekStart)) - toUtcMs(weekStartOf(programStart));
  return Math.round(diffMs / (7 * DAY_MS)) + 1;
}

/** Today's date ('YYYY-MM-DD') in the given IANA timezone. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`;
}

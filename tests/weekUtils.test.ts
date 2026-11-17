import { describe, expect, it } from 'vitest';
import { addDays, todayInTz, weekDates, weekNumber, weekStartOf } from '../src/lib/domain';

describe('weekUtils', () => {
  it('vector 7: Monday is its own week start', () => {
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16');
  });
  it('vector 7: Sunday belongs to the previous Monday week', () => {
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09');
  });
  it('midweek and month/year boundaries', () => {
    expect(weekStartOf('2026-11-12')).toBe('2026-11-09');
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29'); // Thursday
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-16', -16)).toBe('2026-10-31');
  });
  it('vector 7: weekDates returns 7 dates Mon..Sun', () => {
    const d = weekDates('2026-11-09');
    expect(d).toHaveLength(7);
    expect(d[0]).toBe('2026-11-09');
    expect(d[6]).toBe('2026-11-15');
  });
  it('week number counts from the program start week, starting at 1', () => {
    expect(weekNumber('2026-11-09', '2026-11-09')).toBe(1);
    expect(weekNumber('2026-11-16', '2026-11-09')).toBe(2);
    expect(weekNumber('2026-11-23', '2026-11-12')).toBe(3); // program start midweek (Thu)
    expect(weekNumber('2026-12-28', '2026-11-09')).toBe(8);
  });
  it('todayInTz uses the given timezone (Hermosillo UTC-7)', () => {
    const now = new Date('2026-11-17T05:30:00Z');
    expect(todayInTz('America/Hermosillo', now)).toBe('2026-11-16');
    expect(todayInTz('UTC', now)).toBe('2026-11-17');
    expect(todayInTz('Asia/Tokyo', now)).toBe('2026-11-17');
    expect(todayInTz('America/Hermosillo', new Date('2026-11-17T07:00:00Z'))).toBe('2026-11-17');
  });
});

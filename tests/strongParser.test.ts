import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStrongExport } from '../src/lib/domain';

const sample = readFileSync(new URL('../../samples/strong-export-sample.txt', import.meta.url), 'utf8');
const LB = 0.45359237;

describe('vector 6: real Strong export (lb)', () => {
  const r = parseStrongExport(sample);
  it('title, date, url', () => {
    expect(r.workoutTitle).toBe('S- PULL B (Back + Biceps + Core) Copy');
    expect(r.performedAt).toBe('2026-11-14T15:26');
    expect(r.shareUrl).toBe('https://link.strong.app/xtaxqgxz');
  });
  it('8 exercises, 25 sets, 8981 kg', () => {
    expect(r.exercises).toHaveLength(8);
    expect(r.totalSets).toBe(25);
    expect(r.totalVolumeKg).toBe(8981);
    expect(r.warnings).toEqual([]);
    expect(r.rawText).toBe(sample);
  });
  it('exercise details', () => {
    expect(r.exercises[0].name).toBe('Bicep Curl (Cable)');
    expect(r.exercises[0].sets).toHaveLength(2);
    expect(r.exercises[0].sets[0]).toEqual({ setNumber: 1, weightKg: 13.6, reps: 25, volumeKg: 340.2 });
    expect(r.exercises[7].name).toBe('Bicep Curl (Barbell)');
    expect(r.exercises.reduce((a, e) => a + e.sets.length, 0)).toBe(25);
  });
  it('same result with kg default would differ (unit defaults only when omitted)', () => {
    expect(parseStrongExport(sample, { defaultUnit: 'kg' }).totalVolumeKg).toBe(8981);
  });
});

describe('units', () => {
  it('kg and lb mixed in one export', () => {
    const r = parseStrongExport('Mixed\nBench\nSet 1: 100 kg × 5\nSet 2: 225 lb × 5\nSet 3: 225 lbs x 5');
    expect(r.totalSets).toBe(3);
    expect(r.exercises[0].sets[0].weightKg).toBe(100);
    expect(r.exercises[0].sets[1].weightKg).toBe(102.1);
    expect(r.totalVolumeKg).toBe(Math.round(500 + 2 * 225 * 5 * LB));
  });
  it('unit omitted uses defaultUnit (lb by default)', () => {
    const lb = parseStrongExport('T\nSquat\nSet 1: 100 × 5');
    expect(lb.exercises[0].sets[0].weightKg).toBe(45.4);
    expect(lb.totalVolumeKg).toBe(227);
    const kg = parseStrongExport('T\nSquat\nSet 1: 100 × 5', { defaultUnit: 'kg' });
    expect(kg.exercises[0].sets[0].weightKg).toBe(100);
    expect(kg.totalVolumeKg).toBe(500);
  });
  it('explicit unit wins over defaultUnit', () => {
    expect(parseStrongExport('T\nSquat\nSet 1: 100 kg × 5', { defaultUnit: 'lb' }).totalVolumeKg).toBe(500);
  });
});

describe('set line syntax', () => {
  it('decimals, comma decimals, x/X/* and W/D/F prefixes', () => {
    const r = parseStrongExport('T\nPress\nSet 1: 62.5 kg × 8\nSet 2: 62,5 kg x 8\nW: 20 kg X 10\nD 40kg * 6\nF: 10 kg × 3\n50 kg x 4');
    expect(r.totalSets).toBe(6);
    expect(r.exercises[0].sets.map((s) => s.weightKg)).toEqual([62.5, 62.5, 20, 40, 10, 50]);
    expect(r.exercises[0].sets.map((s) => s.setNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.totalVolumeKg).toBe(Math.round(62.5 * 8 * 2 + 200 + 240 + 30 + 200));
  });
  it('anchored: exercise names like "3x5 Squat" are headers, not sets', () => {
    const r = parseStrongExport('T\n3x5 Squat\nSet 1: 100 kg × 5\n5x5 Stronglifts\nSet 1: 60 kg × 5');
    expect(r.exercises.map((e) => e.name)).toEqual(['3x5 Squat', '5x5 Stronglifts']);
    expect(r.totalSets).toBe(2);
  });
  it('line with trailing text is not a set', () => {
    const r = parseStrongExport('T\nSquat\nSet 1: 100 kg × 5 @ RPE 8');
    expect(r.totalSets).toBe(0);
    expect(r.warnings).toHaveLength(1);
  });
  it('reps-only set counts with weight 0 and volume 0', () => {
    const r = parseStrongExport('T\nPush Up\nSet 1: 12 reps\nSet 2: 10 reps');
    expect(r.totalSets).toBe(2);
    expect(r.exercises[0].sets[0]).toEqual({ setNumber: 1, weightKg: 0, reps: 12, volumeKg: 0 });
    expect(r.totalVolumeKg).toBe(0);
  });
  it('time and distance sets are skipped with a warning', () => {
    const r = parseStrongExport('T\nPlank\nSet 1: 30 s\nSet 2: 1:00\nTreadmill\nSet 1: 1.2 mi\nSquat\nSet 1: 100 kg × 5');
    expect(r.totalSets).toBe(1);
    expect(r.exercises.map((e) => e.name)).toEqual(['Squat']); // zero-set exercises dropped
    expect(r.warnings).toHaveLength(3);
    expect(r.warnings[0]).toContain('30 s');
  });
  it('time sets inside an exercise with real sets do not create sets', () => {
    const r = parseStrongExport('T\nMixed\nSet 1: 100 kg × 5\nSet 2: 30 s');
    expect(r.exercises[0].sets).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });
  it('Notes lines are ignored, blank lines and CRLF tolerated', () => {
    const r = parseStrongExport('T\r\n\r\nSquat\r\nNotes: felt heavy\r\nSet 1: 100 kg × 5\r\n');
    expect(r.exercises[0].name).toBe('Squat');
    expect(r.totalSets).toBe(1);
  });
  it('sets before any header go to a generic exercise', () => {
    const r = parseStrongExport('T\nSet 1: 100 kg × 5');
    expect(r.exercises).toHaveLength(1);
    expect(r.exercises[0].name).toBe('Exercise');
  });
  it('exercise volume rounds per exercise, total from unrounded values', () => {
    const r = parseStrongExport('T\nA\nSet 1: 10 lb × 1\nB\nSet 1: 10 lb × 1');
    // each 4.5359 -> 4.5; total 9.07 -> 9
    expect(r.exercises[0].exerciseVolumeKg).toBe(4.5);
    expect(r.totalVolumeKg).toBe(9);
    const r2 = parseStrongExport('T\nA\n' + 'Set 1: 1 lb × 1\n'.repeat(1)); // 0.45 -> 0
    expect(r2.totalVolumeKg).toBe(0);
    const r3 = parseStrongExport('T\nA\n' + Array.from({ length: 10 }, () => 'Set 1: 1 lb × 1').join('\n'));
    expect(r3.totalVolumeKg).toBe(5); // 4.5359 rounds to 5, though each set shows 0.5
  });
});

describe('date line', () => {
  const at = (line: string) => parseStrongExport(`T\n${line}\nSquat\nSet 1: 1 kg × 1`).performedAt;
  it('PM and AM', () => {
    expect(at('Saturday, November 14, 2026 at 3:26 PM')).toBe('2026-11-14T15:26');
    expect(at('Saturday, November 14, 2026 at 3:26 AM')).toBe('2026-11-14T03:26');
  });
  it('12:05 AM -> 00:05 and 12:05 PM -> 12:05', () => {
    expect(at('Sunday, January 4, 2026 at 12:05 AM')).toBe('2026-01-04T00:05');
    expect(at('Sunday, January 4, 2026 at 12:05 PM')).toBe('2026-01-04T12:05');
  });
  it('regular and narrow no-break space before PM', () => {
    expect(at('Monday, December 7, 2026 at 11:59 PM')).toBe('2026-12-07T23:59');
    expect(at('Monday, December 7, 2026 at 11:59 PM')).toBe('2026-12-07T23:59');
  });
  it('date line is not treated as an exercise', () => {
    const r = parseStrongExport('T\nSaturday, November 14, 2026 at 3:26 PM\nSquat\nSet 1: 1 kg × 1');
    expect(r.exercises.map((e) => e.name)).toEqual(['Squat']);
  });
  it('no date line -> null', () => {
    expect(parseStrongExport('T\nSquat\nSet 1: 1 kg × 1').performedAt).toBeNull();
  });
});

describe('fallbacks and empty input', () => {
  it('empty string', () => {
    const r = parseStrongExport('');
    expect(r).toEqual({ workoutTitle: 'Strength Session', performedAt: null, shareUrl: null, totalVolumeKg: 0, totalSets: 0, exercises: [], rawText: '', warnings: [] });
    expect(parseStrongExport('  \n \n').totalVolumeKg).toBe(0);
  });
  it('number-only input is total volume in kg', () => {
    const r = parseStrongExport('12450');
    expect(r.totalVolumeKg).toBe(12450);
    expect(r.workoutTitle).toBe('Strength Session');
    expect(r.exercises).toEqual([]);
    expect(r.rawText).toBe('12450');
    expect(parseStrongExport(' 12,450 \n').totalVolumeKg).toBe(12450);
  });
  it('Total Volume line used when no sets parsed (kg)', () => {
    const r = parseStrongExport('Leg Day\nTotal Volume: 12,450 kg');
    expect(r.totalVolumeKg).toBe(12450);
    expect(r.workoutTitle).toBe('Leg Day');
    expect(r.totalSets).toBe(0);
  });
  it('Total Volume line in lb is converted', () => {
    expect(parseStrongExport('Leg Day\nTotal Volume: 19,800 lb').totalVolumeKg).toBe(8981);
  });
  it('Total Volume alone: default title', () => {
    expect(parseStrongExport('Total Volume: 12,450 kg').workoutTitle).toBe('Strength Session');
  });
  it('Total Volume ignored when sets exist', () => {
    const r = parseStrongExport('T\nSquat\nSet 1: 100 kg × 5\nTotal Volume: 99,999 kg');
    expect(r.totalVolumeKg).toBe(500);
  });
  it('title only', () => {
    const r = parseStrongExport('Just a title');
    expect(r.workoutTitle).toBe('Just a title');
    expect(r.totalVolumeKg).toBe(0);
  });
  it('share url only read from http(s) lines; first wins', () => {
    const r = parseStrongExport('T\nSquat\nSet 1: 1 kg × 1\nhttps://link.strong.app/abc\nhttp://other.example/x');
    expect(r.shareUrl).toBe('https://link.strong.app/abc');
    expect(r.exercises.map((e) => e.name)).toEqual(['Squat']);
  });
});

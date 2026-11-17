import type { ParsedExercise, ParsedSet, StrongParseResult } from './types';

const LB_TO_KG = 0.45359237;
const DEFAULT_TITLE = 'Strength Session';

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// 'Saturday, November 14, 2026 at 3:26 PM' (Strong uses a narrow no-break space before PM; \s covers it)
const DATE_LINE_RE =
  /^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?$/;
const URL_RE = /^https?:\/\/\S+$/i;
const NOTES_RE = /^notes?\s*:/i;
const PREFIX = String.raw`(?:(?:Set\s*\d+|W|D|F)\s*:?\s*)`;
// weight [unit] x reps, and nothing else on the line
const SET_RE = new RegExp(
  String.raw`^${PREFIX}?(\d+(?:[.,]\d+)?)\s*(kg|lbs|lb)?\s*[×xX*]\s*(\d+)$`,
  'i',
);
// 'Set 1: 12 reps' (prefix required so a header like '12 reps' is not a set)
const REPS_ONLY_RE = new RegExp(String.raw`^${PREFIX}(\d+)\s*reps?$`, 'i');
// anything else that looks like a set line (time, distance, ...) -> skipped with a warning
const OTHER_SET_RE = /^(?:Set\s*\d+|W|D|F)\s*:/i;
const TOTAL_VOLUME_RE = /total\s*volume\s*:?\s*([\d,]+(?:\.\d+)?)\s*(kg|lbs|lb)?/i;
const NUMBER_ONLY_RE = /^\d[\d,]*(?:\.\d+)?$/;

const round1 = (x: number) => Math.round(x * 10) / 10;

function parseDateLine(line: string): string | null {
  const m = DATE_LINE_RE.exec(line);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  if (!month || day < 1 || day > 31 || minute > 59) return null;
  const ampm = m[6]?.toLowerCase();
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === 'a') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}`;
}

function empty(rawText: string, title = DEFAULT_TITLE): StrongParseResult {
  return {
    workoutTitle: title,
    performedAt: null,
    shareUrl: null,
    totalVolumeKg: 0,
    totalSets: 0,
    exercises: [],
    rawText,
    warnings: [],
  };
}

export function parseStrongExport(raw: string, opts: { defaultUnit?: 'kg' | 'lb' } = {}): StrongParseResult {
  const defaultUnit = opts.defaultUnit ?? 'lb';
  const rawText = raw ?? '';
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (lines.length === 0) return empty(rawText);

  // Whole input is just a number: total volume in kg.
  if (lines.length === 1 && NUMBER_ONLY_RE.test(lines[0])) {
    const res = empty(rawText);
    res.totalVolumeKg = Math.round(parseFloat(lines[0].replace(/,/g, '')));
    return res;
  }

  const warnings: string[] = [];
  const title = TOTAL_VOLUME_RE.test(lines[0]) ? DEFAULT_TITLE : lines[0];
  let performedAt: string | null = null;
  let shareUrl: string | null = null;

  const exercises: { name: string; sets: ParsedSet[]; volume: number }[] = [];
  let current: (typeof exercises)[number] | null = null;
  let totalVolume = 0;

  const addSet = (weightKg: number, reps: number) => {
    if (!current) {
      current = { name: 'Exercise', sets: [], volume: 0 };
      exercises.push(current);
    }
    const volume = weightKg * reps;
    current.sets.push({
      setNumber: current.sets.length + 1,
      weightKg: round1(weightKg),
      reps,
      volumeKg: round1(volume),
    });
    current.volume += volume;
    totalVolume += volume;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (URL_RE.test(line)) {
      if (!shareUrl) shareUrl = line;
      continue;
    }
    const dt = parseDateLine(line);
    if (dt) {
      if (!performedAt) performedAt = dt;
      continue;
    }
    if (NOTES_RE.test(line)) continue;

    const sm = SET_RE.exec(line);
    if (sm) {
      const weight = parseFloat(sm[1].replace(',', '.'));
      const unit = (sm[2]?.toLowerCase() ?? defaultUnit).startsWith('lb') ? 'lb' : 'kg';
      addSet(unit === 'lb' ? weight * LB_TO_KG : weight, parseInt(sm[3], 10));
      continue;
    }
    const rm = REPS_ONLY_RE.exec(line);
    if (rm) {
      addSet(0, parseInt(rm[1], 10));
      continue;
    }
    if (OTHER_SET_RE.test(line)) {
      warnings.push(`Skipped non-volume set line (time/distance/unrecognized): "${line}"`);
      continue;
    }
    // Exercise header
    current = { name: line, sets: [], volume: 0 };
    exercises.push(current);
  }

  const kept = exercises.filter((e) => e.sets.length > 0);
  const out: ParsedExercise[] = kept.map((e) => ({
    name: e.name,
    sets: e.sets,
    exerciseVolumeKg: round1(e.volume),
  }));
  const totalSets = out.reduce((a, e) => a + e.sets.length, 0);

  let totalVolumeKg = Math.round(totalVolume);
  if (totalSets === 0) {
    const m = TOTAL_VOLUME_RE.exec(rawText);
    if (m) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      const unit = m[2]?.toLowerCase().startsWith('lb') ? 'lb' : 'kg';
      totalVolumeKg = Math.round(unit === 'lb' ? num * LB_TO_KG : num);
      warnings.push('No sets found; used the "Total Volume" line from the text.');
    }
  }

  return {
    workoutTitle: title,
    performedAt,
    shareUrl,
    totalVolumeKg,
    totalSets,
    exercises: out,
    rawText,
    warnings,
  };
}

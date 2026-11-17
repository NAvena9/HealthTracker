import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, conflict, notFound, throwDbError, validationError } from '@/lib/api/errors';
import type { PhaseCreateBody, PhasePatchBody, PhaseStartNewBody } from '@/lib/api/schemas';
import { addDays, type GoalsSnapshot } from '@/lib/domain';
import { toPhase, type Phase, type PhaseRow } from './mappers';

export const DEFAULT_GOALS_SNAPSHOT: GoalsSnapshot = {
  active: { protein_g: 190, carbs_g: 240, fat_g: 70, calories_kcal: 2350 },
  rest: { protein_g: 190, carbs_g: 200, fat_g: 60, calories_kcal: 2100 },
  daily_step_goal: 10000,
  weekly_step_goal: 70000,
  weekly_weighin_goal: 3,
  weekly_cardio_sessions: null,
  weekly_strength_sessions: null,
  target_weight_kg: null,
};

/** Fresh copy of the built-in defaults. */
export const defaultGoalsSnapshot = (): GoalsSnapshot => structuredClone(DEFAULT_GOALS_SNAPSHOT);

export function phaseToSnapshot(phase: Phase): GoalsSnapshot {
  return {
    active: {
      protein_g: phase.active_protein_g,
      carbs_g: phase.active_carbs_g,
      fat_g: phase.active_fat_g,
      calories_kcal: phase.active_kcal,
    },
    rest: {
      protein_g: phase.rest_protein_g,
      carbs_g: phase.rest_carbs_g,
      fat_g: phase.rest_fat_g,
      calories_kcal: phase.rest_kcal,
    },
    daily_step_goal: phase.daily_step_goal,
    weekly_step_goal: phase.weekly_step_goal,
    weekly_weighin_goal: phase.weekly_weighin_goal,
    weekly_cardio_sessions: phase.weekly_cardio_sessions,
    weekly_strength_sessions: phase.weekly_strength_sessions,
    target_weight_kg: phase.target_weight_kg,
  };
}

const definedOnly = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function listPhases(supabase: SupabaseClient, userId: string): Promise<Phase[]> {
  const { data, error } = await supabase
    .from('phases')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });
  throwDbError(error, 'phases.list');
  return ((data ?? []) as PhaseRow[]).map(toPhase);
}

export async function getPhase(supabase: SupabaseClient, userId: string, id: string): Promise<Phase> {
  const { data, error } = await supabase.from('phases').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
  throwDbError(error, 'phases.get');
  if (!data) throw notFound('Phase not found');
  return toPhase(data as PhaseRow);
}

async function findOpenPhase(supabase: SupabaseClient, userId: string): Promise<Phase | null> {
  const { data, error } = await supabase.from('phases').select('*').eq('user_id', userId).is('end_date', null).maybeSingle();
  throwDbError(error, 'phases.open');
  return data ? toPhase(data as PhaseRow) : null;
}

/**
 * Phase for a week: the phase covering it (start_date <= weekStart + 6 and
 * (end_date null or >= weekStart)), else the open phase, else null.
 */
export async function findPhaseForWeek(supabase: SupabaseClient, userId: string, weekStart: string): Promise<Phase | null> {
  const phases = await listPhases(supabase, userId); // newest start first
  const weekEnd = addDays(weekStart, 6);
  const covering = phases.find((p) => p.start_date <= weekEnd && (p.end_date === null || p.end_date >= weekStart));
  if (covering) return covering;
  return phases.find((p) => p.end_date === null) ?? null;
}

export async function createPhase(supabase: SupabaseClient, userId: string, body: PhaseCreateBody): Promise<Phase> {
  const endDate = body.end_date ?? null;
  if (endDate !== null && endDate < body.start_date) {
    throw validationError('Invalid request', [{ path: ['end_date'], message: 'Must be on or after start_date' }]);
  }
  if (endDate === null && (await findOpenPhase(supabase, userId))) {
    throw conflict('An open phase already exists. Start a new phase instead.');
  }
  const { data, error } = await supabase
    .from('phases')
    .insert({ ...definedOnly(body), end_date: endDate, user_id: userId })
    .select('*')
    .single();
  throwDbError(error, 'phases.create');
  return toPhase(data as PhaseRow);
}

/** Rewrite goals_snapshot of every OPEN week that points at the phase. */
async function refreshOpenWeeksOfPhase(supabase: SupabaseClient, userId: string, phase: Phase): Promise<void> {
  const { error } = await supabase
    .from('weekly_checkins')
    .update({ goals_snapshot: phaseToSnapshot(phase) })
    .eq('user_id', userId)
    .eq('phase_id', phase.id)
    .is('closed_at', null);
  throwDbError(error, 'phases.refreshWeeks');
}

export async function updatePhase(supabase: SupabaseClient, userId: string, id: string, body: PhasePatchBody): Promise<Phase> {
  const existing = await getPhase(supabase, userId, id);
  const patch = definedOnly(body);
  if (Object.keys(patch).length === 0) return existing;
  const endDate = body.end_date === undefined ? existing.end_date : body.end_date;
  if (endDate !== null && endDate < existing.start_date) {
    throw validationError('Invalid request', [{ path: ['end_date'], message: 'Must be on or after the phase start_date' }]);
  }
  const { data, error } = await supabase
    .from('phases')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  throwDbError(error, 'phases.update');
  if (!data) throw notFound('Phase not found');
  const phase = toPhase(data as PhaseRow);
  await refreshOpenWeeksOfPhase(supabase, userId, phase);
  return phase;
}

/**
 * End the open phase (end_date = start - 1), insert the new one, repoint and
 * refresh open weeks from start_date on. No transaction in supabase-js: if the
 * insert fails the old end_date is restored (compensation).
 */
export async function startNewPhase(
  supabase: SupabaseClient,
  userId: string,
  body: PhaseStartNewBody,
): Promise<{ phase: Phase; previous: Phase | null }> {
  const open = await findOpenPhase(supabase, userId);
  let previous: Phase | null = null;

  if (open) {
    const newEnd = addDays(body.start_date, -1);
    if (newEnd < open.start_date) {
      throw validationError('Invalid request', [
        { path: ['start_date'], message: 'Must be after the current phase start_date' },
      ]);
    }
    const { data, error } = await supabase
      .from('phases')
      .update({ end_date: newEnd })
      .eq('user_id', userId)
      .eq('id', open.id)
      .select('*')
      .single();
    throwDbError(error, 'phases.endPrevious');
    previous = toPhase(data as PhaseRow);
  }

  const ins = await supabase
    .from('phases')
    .insert({ ...definedOnly(body), end_date: null, user_id: userId })
    .select('*')
    .single();
  if (ins.error || !ins.data) {
    if (open) {
      const rb = await supabase.from('phases').update({ end_date: open.end_date }).eq('user_id', userId).eq('id', open.id);
      if (rb.error) console.error('[phases.startNew] compensation failed', rb.error.message);
    }
    throwDbError(ins.error, 'phases.startNew');
    throw new ApiError('internal_error', 'Unexpected error');
  }
  const phase = toPhase(ins.data as PhaseRow);

  const rp = await supabase
    .from('weekly_checkins')
    .update({ phase_id: phase.id, goals_snapshot: phaseToSnapshot(phase) })
    .eq('user_id', userId)
    .is('closed_at', null)
    .gte('week_start_date', phase.start_date);
  throwDbError(rp.error, 'phases.repointWeeks');

  return { phase, previous };
}

export async function deletePhase(supabase: SupabaseClient, userId: string, id: string, confirm: boolean): Promise<void> {
  await getPhase(supabase, userId, id);
  const refs = await supabase.from('weekly_checkins').select('week_start_date').eq('user_id', userId).eq('phase_id', id);
  throwDbError(refs.error, 'phases.refs');
  const count = (refs.data ?? []).length;
  if (count > 0 && !confirm) {
    throw new ApiError(
      'confirmation_required',
      `${count} week(s) use this phase. Repeat with ?confirm=true to delete it; those weeks keep their goals snapshot.`,
      undefined,
      undefined,
      { weeks: count },
    );
  }
  const { error } = await supabase.from('phases').delete().eq('user_id', userId).eq('id', id);
  throwDbError(error, 'phases.delete');
}

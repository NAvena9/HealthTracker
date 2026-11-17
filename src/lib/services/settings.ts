import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, throwDbError } from '@/lib/api/errors';
import type { SettingsPutBody } from '@/lib/api/schemas';
import { toUserSettings, type UserSettings, type UserSettingsRow } from './mappers';

/** Read settings; creates the row with defaults on first use (insert ... on conflict do nothing). */
export async function getSettings(supabase: SupabaseClient, userId: string): Promise<UserSettings> {
  const ins = await supabase.from('user_settings').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  throwDbError(ins.error, 'settings.insert');
  const { data, error } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle();
  throwDbError(error, 'settings.get');
  if (!data) throw new ApiError('internal_error', 'Unexpected error');
  return toUserSettings(data as UserSettingsRow);
}

export async function updateSettings(supabase: SupabaseClient, userId: string, body: SettingsPutBody): Promise<UserSettings> {
  await getSettings(supabase, userId); // make sure the row exists
  const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length === 0) return getSettings(supabase, userId);
  const { data, error } = await supabase.from('user_settings').update(patch).eq('user_id', userId).select('*').single();
  throwDbError(error, 'settings.update');
  return toUserSettings(data as UserSettingsRow);
}

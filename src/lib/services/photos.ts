import type { SupabaseClient } from '@supabase/supabase-js';
import { notFound, throwDbError, validationError } from '@/lib/api/errors';
import { weekStartOf, type PoseKey } from '@/lib/domain';
import { assertWeekOpen, ensureWeek } from './weeks';

export const PHOTO_BUCKET = 'progress-photos';
export const POSES: readonly PoseKey[] = ['front', 'side', 'back'];
export const SIGNED_URL_TTL = 3600;

export interface PhotoInfo {
  path: string;
  url: string;
  expires_in: number;
}
export type PhotoUrls = Record<PoseKey, PhotoInfo | null>;

export function parsePose(pose: string): PoseKey {
  if (!(POSES as readonly string[]).includes(pose)) {
    throw validationError('Invalid pose', [{ path: ['pose'], message: 'Must be front, side or back' }]);
  }
  return pose as PoseKey;
}

export function parseWeekStart(weekStart: string): string {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(weekStart) && !Number.isNaN(Date.parse(`${weekStart}T00:00:00Z`)) && weekStartOf(weekStart) === weekStart;
  if (!ok) throw validationError('Invalid week', [{ path: ['weekStart'], message: 'Must be a Monday in YYYY-MM-DD format' }]);
  return weekStart;
}

export const photoPath = (userId: string, weekStart: string, pose: PoseKey) => `${userId}/${weekStart}/${pose}.jpg`;

export async function createUploadUrl(
  supabase: SupabaseClient,
  userId: string,
  weekStartRaw: string,
  poseRaw: string,
): Promise<{ path: string; token: string; signed_url: string }> {
  const weekStart = parseWeekStart(weekStartRaw);
  const pose = parsePose(poseRaw);
  assertWeekOpen(await ensureWeek(supabase, userId, weekStart)); // Storage policies cannot see closed_at
  const path = photoPath(userId, weekStart, pose);
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    console.error('[photos.upload-url] storage error', error?.message);
    throw new Error('Could not create upload URL');
  }
  return { path, token: data.token, signed_url: data.signedUrl };
}

export async function getPhotoUrls(supabase: SupabaseClient, userId: string, weekStartRaw: string): Promise<PhotoUrls> {
  const weekStart = parseWeekStart(weekStartRaw);
  const { data, error } = await supabase
    .from('weekly_checkins')
    .select('photo_front_path, photo_side_path, photo_back_path')
    .eq('user_id', userId)
    .eq('week_start_date', weekStart)
    .maybeSingle();
  throwDbError(error, 'photos.list');
  const out: PhotoUrls = { front: null, side: null, back: null };
  for (const pose of POSES) {
    const path = (data as Record<string, string | null> | null)?.[`photo_${pose}_path`];
    if (!path) continue;
    const signed = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
    if (signed.error || !signed.data) continue;
    out[pose] = { path, url: signed.data.signedUrl, expires_in: SIGNED_URL_TTL };
  }
  return out;
}

export async function deletePhoto(supabase: SupabaseClient, userId: string, weekStartRaw: string, poseRaw: string): Promise<{ deleted: true }> {
  const weekStart = parseWeekStart(weekStartRaw);
  const pose = parsePose(poseRaw);
  const week = await ensureWeek(supabase, userId, weekStart);
  assertWeekOpen(week);
  const column = `photo_${pose}_path` as const;
  const stored = (week as unknown as Record<string, string | null>)[column];
  if (!stored) throw notFound('No photo for this pose');

  const removed = await supabase.storage.from(PHOTO_BUCKET).remove([stored]);
  if (removed.error) {
    console.error('[photos.delete] storage error', removed.error.message);
    throw new Error('Could not delete photo');
  }
  const { error } = await supabase
    .from('weekly_checkins')
    .update({ [column]: null })
    .eq('user_id', userId)
    .eq('week_start_date', weekStart);
  throwDbError(error, 'photos.delete');
  return { deleted: true };
}

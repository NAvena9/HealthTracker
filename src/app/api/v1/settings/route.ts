import { NextResponse } from 'next/server';
import { handle, readJson } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { parseWith, settingsPutSchema } from '@/lib/api/schemas';
import { getSettings, updateSettings } from '@/lib/services/settings';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  return NextResponse.json(await getSettings(supabase, userId));
});

export const PUT = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const body = parseWith(settingsPutSchema, await readJson(req));
  return NextResponse.json(await updateSettings(supabase, userId, body));
});

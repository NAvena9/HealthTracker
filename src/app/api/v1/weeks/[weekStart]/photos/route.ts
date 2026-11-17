import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { getPhotoUrls } from '@/lib/services/photos';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request, ctx: { params: Promise<{ weekStart: string }> }) => {
  const { supabase, userId } = await requireUser(req);
  const { weekStart } = await ctx.params;
  return NextResponse.json(await getPhotoUrls(supabase, userId, weekStart));
});

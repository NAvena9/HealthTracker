import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { deletePhoto } from '@/lib/services/photos';

export const dynamic = 'force-dynamic';

export const DELETE = handle(async (req: Request, ctx: { params: Promise<{ weekStart: string; pose: string }> }) => {
  const { supabase, userId } = await requireUser(req);
  const { weekStart, pose } = await ctx.params;
  return NextResponse.json(await deletePhoto(supabase, userId, weekStart, pose));
});

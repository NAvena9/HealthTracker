import { NextResponse } from 'next/server';
import { handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { createUploadUrl } from '@/lib/services/photos';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ weekStart: string; pose: string }> }) => {
  const { supabase, userId } = await requireUser(req);
  const { weekStart, pose } = await ctx.params;
  return NextResponse.json(await createUploadUrl(supabase, userId, weekStart, pose));
});

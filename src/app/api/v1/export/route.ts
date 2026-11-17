import { NextResponse } from 'next/server';
import { validationError, handle } from '@/lib/api/errors';
import { requireUser } from '@/lib/api/auth';
import { exportCsv, exportDate, exportJson, parseCsvTable } from '@/lib/services/export';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser(req);
  const sp = new URL(req.url).searchParams;
  const format = sp.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    throw validationError('Invalid format', [{ path: ['format'], message: 'Must be json or csv' }]);
  }
  const date = await exportDate(supabase, userId);
  if (format === 'json') {
    const body = JSON.stringify(await exportJson(supabase, userId), null, 2);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="proof-of-work-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  const table = parseCsvTable(sp.get('table'));
  return new NextResponse(await exportCsv(supabase, userId, table), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="proof-of-work-${table}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

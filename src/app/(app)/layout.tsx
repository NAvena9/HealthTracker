import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { createCookieClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createCookieClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return <AppShell>{children}</AppShell>;
}

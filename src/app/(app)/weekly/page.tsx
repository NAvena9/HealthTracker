import { Suspense } from 'react';
import { WeeklyHubTab } from '@/components/tabs/WeeklyHubTab';

export default function WeeklyPage() {
  return (
    <Suspense fallback={null}>
      <WeeklyHubTab />
    </Suspense>
  );
}

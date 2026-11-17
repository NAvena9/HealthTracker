import { Suspense } from 'react';
import { TodayTab } from '@/components/tabs/TodayTab';

export default function TodayPage() {
  return (
    <Suspense fallback={null}>
      <TodayTab />
    </Suspense>
  );
}

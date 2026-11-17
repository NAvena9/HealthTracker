import { Suspense } from 'react';
import { CompareTab } from '@/components/tabs/CompareTab';

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareTab />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DashboardApp, DashboardLoading } from '@/components/dashboard/dashboard-app';

// The tabs are links that set ?view=, so switching views updates the title. A bare /dashboard can
// open on Setup while setup is unfinished; the client corrects the title once it knows.
export function generateMetadata({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }): Metadata {
  const setup = searchParams.view === 'setup' || (!searchParams.view && searchParams.open === 'permissions');
  return { title: setup ? 'Setup' : 'Meetings' };
}

// Everything here is the signed-in person's, so it loads in the browser after auth.
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardApp />
    </Suspense>
  );
}

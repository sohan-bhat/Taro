import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DemoApp, DemoFromAddress } from '@/components/demo/demo-app';

export const metadata: Metadata = { title: 'Demo' };

// Prerendered once, without an address, so the static page is the default view: Meetings with the
// featured meeting open. In the browser, ?view= and ?m= pick the view and the meeting.
export default function DemoPage() {
  return (
    <Suspense fallback={<DemoApp />}>
      <DemoFromAddress />
    </Suspense>
  );
}

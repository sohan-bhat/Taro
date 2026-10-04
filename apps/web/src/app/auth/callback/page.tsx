import type { Metadata } from 'next';
import { CallbackView } from '@/components/auth/callback-view';

export const metadata: Metadata = { title: 'Signing in', robots: { index: false, follow: false } };

export default function AuthCallbackPage() {
  return <CallbackView />;
}

import type { Metadata } from 'next';
import { ExtensionConnectView } from '@/components/auth/extension-connect-view';

export const metadata: Metadata = { title: 'Connect your browser', robots: { index: false, follow: false } };

export default function ExtensionConnectPage() {
  return <ExtensionConnectView />;
}

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Taro - Meeting Assistant',
  description: 'Voice-activated meeting assistant that executes tasks via Slack',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}

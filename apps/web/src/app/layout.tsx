import './globals.css';
import type { Metadata } from 'next';
import { Sora, Gabarito, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/toaster';

const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-sora',
});

// Gabarito's regular weight has naturally thick strokes, so body text reads
// sturdy without ever being set bold
const gabarito = Gabarito({
  subsets: ['latin'],
  variable: '--font-gabarito',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: 'Taro, the meeting assistant that listens',
  description:
    'Taro joins your meetings, listens for "Hey Taro", and does the work in Slack and GitHub while you keep talking.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sora.variable} ${gabarito.variable} ${jetbrains.variable}`}>
      <body className="bg-fog-50 text-fog-900 font-sans min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}

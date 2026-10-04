import './globals.css';
import type { Metadata, Viewport } from 'next';
import { codeFace, recordFace, saidFace } from './fonts';
import { Toaster } from '@/components/ui/toaster';

// Runs before first paint so signed-in visitors never see "Get started" flash into "Open your dashboard".
const SESSION_SCRIPT = `try{if(localStorage.getItem('taro.session'))document.documentElement.dataset.session='in'}catch(e){}`;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: { default: 'Taro, a voice assistant for your meetings', template: '%s · Taro' },
  description:
    'Meeting follow-ups get lost. Taro joins your call and does them in Slack and GitHub the moment someone says “Hey Taro.”',
  openGraph: {
    title: 'Taro, a voice assistant for your meetings',
    description: 'Meeting follow-ups get lost. Taro joins your call and does them in Slack and GitHub the moment someone says “Hey Taro.”',
    type: 'website',
    siteName: 'Taro',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = { themeColor: '#F4F0F6', viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning covers only the data-session attribute the head script adds
    <html lang="en" suppressHydrationWarning className={`${saidFace.variable} ${recordFace.variable} ${codeFace.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SESSION_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-poi font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-control focus:bg-paper focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-taro focus:shadow-menu"
        >
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}

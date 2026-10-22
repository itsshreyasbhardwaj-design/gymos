import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeScript } from '@/components/theme';
import { ServiceWorkerRegistration } from '@/components/service-worker';

export const metadata: Metadata = {
  title: {
    default: 'GymOS — Fitness that fits real life',
    template: '%s · GymOS',
  },
  description:
    'Personalised workouts for the equipment you actually have, flexible meal planning, and a plan that changes when your life does.',
  applicationName: 'GymOS',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'GymOS', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'GymOS — Fitness that fits real life',
    description:
      'One app. Your equipment. Your workouts. Your meals. Your progress.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0f1a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to main content
        </a>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

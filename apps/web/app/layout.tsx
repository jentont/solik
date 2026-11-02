import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import { AuthProvider } from '@/lib/auth';
import { Shell } from '@/components/Shell';
import './globals.css';

// Same type system as Mirrows: Onest for text, heavy Unbounded for headings, Caveat for handwritten accents.
// Self-hosted (Latin + Cyrillic subsets, variable weight) so builds never depend on Google Fonts.
const sans = localFont({ src: './fonts/Onest.woff', variable: '--font-sans', weight: '100 900', display: 'swap' });
const display = localFont({ src: './fonts/Unbounded.woff', variable: '--font-display', weight: '200 900', display: 'swap' });
const hand = localFont({ src: './fonts/Caveat.woff', variable: '--font-hand', weight: '400 700', display: 'swap' });

export const metadata: Metadata = {
  title: 'SOLIK — конкурсы и подарки в Telegram',
  description: 'Платформа для Telegram-конкурсов, розыгрышей подарков, Stars и NFT',
  icons: { icon: '/brand/logo.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#121214' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // telegram-web-app.js sets CSS variables on <html> before hydration
    <html lang="ru" className={`dark ${sans.variable} ${display.variable} ${hand.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}

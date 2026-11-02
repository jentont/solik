import type { Metadata, Viewport } from 'next';
import { Caveat, Onest, Unbounded } from 'next/font/google';
import Script from 'next/script';
import { AuthProvider } from '@/lib/auth';
import { Shell } from '@/components/Shell';
import './globals.css';

// Same type system as Mirrows: Onest for text, heavy Unbounded for headings, Caveat for handwritten accents
const sans = Onest({ subsets: ['latin', 'cyrillic'], variable: '--font-sans', weight: ['400', '500', '600', '700', '800'] });
const display = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-display', weight: ['600', '700', '800', '900'] });
const hand = Caveat({ subsets: ['latin', 'cyrillic'], variable: '--font-hand', weight: ['500', '700'] });

export const metadata: Metadata = {
  title: 'SOLIK — конкурсы, подарки и Stars в Telegram',
  description: 'Платформа для Telegram-конкурсов, розыгрышей подарков, Stars и NFT',
  icons: { icon: '/brand/logo.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#F5F5F7' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // telegram-web-app.js sets CSS variables on <html> before hydration
    <html lang="ru" className={`${sans.variable} ${display.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        {/* theme before paint: Telegram colour scheme, else the OS preference */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=(window.Telegram&&Telegram.WebApp&&Telegram.WebApp.colorScheme)||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');if(s==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="font-sans">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}

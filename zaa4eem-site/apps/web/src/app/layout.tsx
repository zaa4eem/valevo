import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import '../styles/tokens.css';
import { AuthProvider } from '@/lib/auth-context';
import { AppChrome } from '@/components/AppChrome';
import { premiumFontClassNames } from '@/lib/premium-fonts';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';

const SITE_DESCRIPTION = 'ZAA4EEM — идеи и мини-игры.';

export const metadata: Metadata = {
  // Resolves the relative OG/Twitter image URLs below to absolute ones —
  // without it, Next.js falls back to http://localhost:3000 even in the
  // production build, which shared-link previews can't reach. `||`, not
  // `??`: docker-compose substitutes an unset build ARG with an empty
  // string (not undefined), and `new URL('')` throws and fails the build.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://zaa4eem.ru'),
  title: 'ZAA4EEM',
  description: SITE_DESCRIPTION,
  icons: {
    icon: '/favicon.png',
    shortcut: '/favicon.png',
    apple: '/favicon.png',
  },
  openGraph: {
    title: 'ZAA4EEM',
    description: SITE_DESCRIPTION,
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'ZAA4EEM' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZAA4EEM',
    description: SITE_DESCRIPTION,
    images: ['/og-image.png'],
  },
};

// Pinned scale + safe-area coverage — the Telegram Mini App WebView otherwise
// allows pinch-zoom, which breaks the app-like feel of the fixed navbar/layout.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={premiumFontClassNames}>
      <body>
        {/* Applies the saved theme before first paint — without this, the page
            would always flash the dark default for a frame before React
            hydrates and ThemeToggle corrects it. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('zaa4eem_theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}`}
        </Script>
        {/* afterInteractive, not beforeInteractive: this SDK is only ever
            needed inside a Telegram Mini App, and blocking hydration on a
            third-party script cost every ordinary browser visitor a chunk
            of the first load. auth-context detects a Telegram launch from
            the URL fragment (which is there before any script runs) and
            waits for this file only in that case. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
        <AuthProvider>
          <AppChrome>{children}</AppChrome>
        </AuthProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

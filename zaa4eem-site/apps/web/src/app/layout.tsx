import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import '../styles/tokens.css';
import { AuthProvider } from '@/lib/auth-context';
import { AppChrome } from '@/components/AppChrome';

export const metadata: Metadata = {
  title: 'ZAA4EEM',
  description: 'ZAA4EEM — идеи и мини-игры.',
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
    <html lang="ru">
      <body>
        {/* Applies the saved theme before first paint — without this, the page
            would always flash the dark default for a frame before React
            hydrates and ThemeToggle corrects it. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('zaa4eem_theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}`}
        </Script>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <AuthProvider>
          <AppChrome>{children}</AppChrome>
        </AuthProvider>
      </body>
    </html>
  );
}

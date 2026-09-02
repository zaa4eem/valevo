import type { Metadata } from 'next';
import Script from 'next/script';
import '../styles/tokens.css';
import { AuthProvider } from '@/lib/auth-context';
import { AppChrome } from '@/components/AppChrome';

export const metadata: Metadata = {
  title: 'ZAA4EEM',
  description: 'ZAA4EEM — комьюнити, идеи и мини-игры. No signal · still here.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <AuthProvider>
          <AppChrome>{children}</AppChrome>
        </AuthProvider>
      </body>
    </html>
  );
}

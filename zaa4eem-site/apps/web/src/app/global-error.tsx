'use client';

import { useEffect } from 'react';

/**
 * Last line of defence: an error thrown by the root layout itself, where
 * even the normal error boundary is gone. It has to render its own <html>
 * and <body>, and can't rely on the app's stylesheet having loaded — hence
 * the inline colours instead of theme tokens.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0b0e0d',
          color: '#f4f7f5',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          padding: 24,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 46, marginBottom: 12 }}>⚡</div>
          <h1 style={{ fontSize: 24, margin: '0 0 10px' }}>Сайт не смог загрузиться</h1>
          <p style={{ color: '#8fa39a', fontSize: 14, lineHeight: 1.6, margin: '0 0 22px' }}>
            Похоже, случился сбой на нашей стороне. Попробуй перезагрузить страницу.
          </p>
          <button
            onClick={reset}
            style={{
              background: '#4ade80',
              color: '#04150a',
              border: 'none',
              borderRadius: 8,
              padding: '11px 20px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Перезагрузить
          </button>
        </div>
      </body>
    </html>
  );
}

'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Catches anything a page throws during render. Without this the App Router
 * unmounts the whole tree and leaves a blank white page with no explanation
 * and no way back — which is what every unhandled error looked like before.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Route error:', error);
  }, [error]);

  return (
    <div style={{ maxWidth: 480, margin: '48px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 46, marginBottom: 12 }}>🛠️</div>
      <h1 style={{ fontSize: 'var(--z-fs-xl)', margin: '0 0 10px' }}>Что-то сломалось</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', lineHeight: 1.6, margin: '0 0 22px' }}>
        Страница не смогла открыться. Обычно помогает просто попробовать ещё раз —
        если нет, напиши владельцу, мы починим.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={reset} className="z-btn-accent z-pop-on-active">
          Попробовать снова
        </button>
        <Link href="/" className="z-btn-ghost z-pop-on-active">
          На главную
        </Link>
      </div>
      {error.digest && (
        <p style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-xs)', marginTop: 20 }}>
          Код ошибки: {error.digest}
        </p>
      )}
    </div>
  );
}

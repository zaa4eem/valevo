'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import { Card } from '@/components/Card';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('failed');
      setError('В ссылке нет кода подтверждения');
      return;
    }
    let cancelled = false;
    api
      .post('/auth/verify-email', { token })
      .then(() => {
        if (!cancelled) setState('done');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Не удалось подтвердить почту');
        setState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Card className="z-animate-in" style={{ maxWidth: 440, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>
        {state === 'working' ? '⏳' : state === 'done' ? '✅' : '⚠️'}
      </div>
      <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>
        {state === 'working' ? 'Подтверждаем почту…' : state === 'done' ? 'Почта подтверждена' : 'Не получилось'}
      </h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
        {state === 'done'
          ? 'Теперь адрес закреплён за вашим аккаунтом — никто другой не сможет им воспользоваться.'
          : state === 'failed'
            ? (error ?? 'Ссылка недействительна или устарела.')
            : 'Секунду.'}
      </p>
      {state !== 'working' && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <Link href="/" className="z-btn-accent z-pop-on-active">
            На главную
          </Link>
          {state === 'failed' && (
            <Link href="/settings" className="z-btn-ghost z-pop-on-active">
              Отправить ссылку заново
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<span className="z-skeleton" style={{ display: 'block', height: 200, borderRadius: 'var(--z-radius-md)' }} />}>
      <VerifyEmailInner />
    </Suspense>
  );
}

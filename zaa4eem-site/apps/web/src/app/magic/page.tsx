'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AuthResponse } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth, type PendingTwoFactor } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { TwoFactorPrompt } from '@/components/TwoFactorPrompt';

function MagicInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { adoptSession } = useAuth();
  const token = params.get('token');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTwoFactor | null>(null);
  // A magic link is single-use, so React's development double-effect would
  // otherwise burn it before the second call could succeed.
  const consumed = useRef(false);

  useEffect(() => {
    if (!token || consumed.current) {
      if (!token) setError('В ссылке нет кода входа');
      return;
    }
    consumed.current = true;

    api
      .post<AuthResponse | PendingTwoFactor>('/auth/magic-link/consume', { token })
      .then((res) => {
        if ('twoFactorRequired' in res) {
          setPending(res);
          return;
        }
        adoptSession(res);
        router.replace('/');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Ссылка не сработала');
      });
  }, [token, adoptSession, router]);

  if (pending) {
    return (
      <Card className="z-animate-in" style={{ maxWidth: 400, margin: '40px auto' }}>
        <TwoFactorPrompt ticket={pending.ticket} onDone={() => router.replace('/')} />
      </Card>
    );
  }

  return (
    <Card className="z-animate-in" style={{ maxWidth: 420, margin: '40px auto', textAlign: 'center' }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>{error ? '⚠️' : '✨'}</div>
      <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>{error ? 'Не получилось' : 'Входим…'}</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
        {error ?? 'Секунду.'}
      </p>
      {error && (
        <Link href="/login" className="z-btn-accent z-pop-on-active" style={{ display: 'inline-block', marginTop: 8 }}>
          К входу
        </Link>
      )}
    </Card>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense fallback={<span className="z-skeleton" style={{ display: 'block', height: 200, borderRadius: 'var(--z-radius-md)' }} />}>
      <MagicInner />
    </Suspense>
  );
}

'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api } from '@/lib/api-client';
import { Card } from '@/components/Card';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сбросить пароль');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <p style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>
        Ссылка неполная — в ней нет токена сброса пароля. Запросите новую ссылку на странице{' '}
        <Link href="/forgot-password">восстановления пароля</Link>.
      </p>
    );
  }

  if (done) {
    return (
      <p style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>
        Пароль обновлён — сейчас перенаправим вас на страницу входа.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        className="z-input"
        type="password"
        placeholder="Новый пароль"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <input
        className="z-input"
        type="password"
        placeholder="Повторите пароль"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
      <button type="submit" className="z-btn-accent" disabled={submitting || !password || !confirm}>
        {submitting ? 'Сохранение…' : 'Сохранить новый пароль'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      <Card>
        <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-xl)' }}>Новый пароль</h1>
        <Suspense fallback={<p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>}>
          <ResetPasswordForm />
        </Suspense>
        <Link
          href="/login"
          style={{ display: 'block', marginTop: 16, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center' }}
        >
          Вернуться ко входу
        </Link>
      </Card>
    </div>
  );
}

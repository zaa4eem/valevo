'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, setAccessToken } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { TelegramLoginWidget } from '@/components/TelegramLoginWidget';

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '';

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onTelegramAuth = useCallback(
    async (data: Record<string, string | number>) => {
      try {
        const res = await api.post<{ accessToken: string; user: unknown }>(
          '/auth/telegram/widget',
          data,
        );
        setAccessToken(res.accessToken);
        router.push('/');
        router.refresh();
      } catch {
        setError('Не удалось войти через Telegram');
      }
    },
    [router],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({ email, password, displayName });
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-xl)' }}>Вход в ZAA4EEM</h1>

        {TELEGRAM_BOT_USERNAME && (
          <div style={{ marginBottom: 20 }}>
            <TelegramLoginWidget botUsername={TELEGRAM_BOT_USERNAME} onAuth={onTelegramAuth} />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: 'var(--z-text-faint)',
            fontSize: 'var(--z-fs-xs)',
            margin: '16px 0',
          }}
        >
          <div style={{ flex: 1, height: 1, background: 'var(--z-border)' }} />
          или email
          <div style={{ flex: 1, height: 1, background: 'var(--z-border)' }} />
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'register' && (
            <input
              className="z-input"
              placeholder="Имя"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
          <input
            className="z-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="z-input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
          <button type="submit" className="z-btn-accent" disabled={submitting}>
            {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        <button
          className="z-btn-ghost"
          style={{ marginTop: 12, width: '100%' }}
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </Card>
    </div>
  );
}

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api, setAccessToken } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { TelegramLoginWidget } from '@/components/TelegramLoginWidget';
import { GoogleLoginButton } from '@/components/GoogleLoginButton';

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '';
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
// Must be the exact domain registered with @BotFather (/setdomain) — never
// window.location.origin, which could be the non-canonical www/apex variant
// a visitor happened to land on. Falls back to same-origin for local dev,
// where NEXT_PUBLIC_SITE_URL is typically unset.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : ''))
  .replace(/\/$/, '');

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const handledRedirect = useRef(false);

  // Set by /r/[code] before redirecting here — a referral link should land
  // straight on the register form, not login.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('zaa4eem_referral_code')) setMode('register');
    } catch {
      // Private-browsing / storage-denied — the code just won't pre-fill the mode.
    }
  }, []);

  const onTelegramAuth = useCallback(
    async (data: Record<string, string | number>) => {
      setError(null);
      setOauthBusy(true);
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
      } finally {
        setOauthBusy(false);
      }
    },
    [router],
  );

  const onGoogleCredential = useCallback(
    async (credential: string) => {
      setError(null);
      setOauthBusy(true);
      try {
        const res = await api.post<{ accessToken: string; user: unknown }>('/auth/google', { credential });
        setAccessToken(res.accessToken);
        router.push('/');
        router.refresh();
      } catch {
        setError('Не удалось войти через Google');
      } finally {
        setOauthBusy(false);
      }
    },
    [router],
  );

  // Telegram's redirect (data-auth-url) integration sends the browser back
  // here with the signed user data as query params instead of calling a JS
  // callback — pick it up once on load, then strip it from the URL.
  useEffect(() => {
    if (handledRedirect.current) return;
    const hash = searchParams.get('hash');
    const id = searchParams.get('id');
    if (!hash || !id) return;
    handledRedirect.current = true;

    const data: Record<string, string> = { hash, id };
    for (const key of ['first_name', 'last_name', 'username', 'photo_url', 'auth_date']) {
      const value = searchParams.get(key);
      if (value !== null) data[key] = value;
    }
    router.replace('/login');
    void onTelegramAuth(data);
  }, [searchParams, router, onTelegramAuth]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
      } else {
        let referralCode: string | undefined;
        try {
          referralCode = sessionStorage.getItem('zaa4eem_referral_code') ?? undefined;
        } catch {
          // ignore — registration still works without it
        }
        await register({ email, password, displayName, referralCode });
        try {
          sessionStorage.removeItem('zaa4eem_referral_code');
        } catch {
          // nothing to clean up if storage was never accessible
        }
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти');
    } finally {
      setSubmitting(false);
    }
  }

  const hasOauth = Boolean(TELEGRAM_BOT_USERNAME) || Boolean(GOOGLE_CLIENT_ID);

  return (
    <Card>
      <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-xl)' }}>Вход в ZAA4EEM</h1>

      {oauthBusy && (
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Входим…</p>
      )}

      {!oauthBusy && hasOauth && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          {TELEGRAM_BOT_USERNAME && (
            <TelegramLoginWidget botUsername={TELEGRAM_BOT_USERNAME} authUrl={`${SITE_URL}/login`} />
          )}
          {GOOGLE_CLIENT_ID && (
            <GoogleLoginButton clientId={GOOGLE_CLIENT_ID} onCredential={onGoogleCredential} />
          )}
        </div>
      )}

      {hasOauth && (
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
      )}

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
        {mode === 'login' && (
          <Link
            href="/forgot-password"
            style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center' }}
          >
            Забыли пароль?
          </Link>
        )}
      </form>

      <button
        className="z-btn-ghost"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
      </button>

      <p style={{ marginTop: 16, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center' }}>
        Регистрируясь, вы соглашаетесь с{' '}
        <a href="/legal/terms" style={{ color: 'var(--z-text-muted)' }}>
          Пользовательским соглашением
        </a>{' '}
        и{' '}
        <a href="/legal/privacy" style={{ color: 'var(--z-text-muted)' }}>
          Политикой обработки персональных данных
        </a>
        .
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Suspense fallback={<Card><p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p></Card>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

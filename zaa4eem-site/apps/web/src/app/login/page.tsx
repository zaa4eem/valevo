'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AuthResponse } from '@zaa4eem/shared';
import { ApiError, api, setAccessToken } from '@/lib/api-client';
import { useAuth, type PendingTwoFactor } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { TelegramLoginWidget } from '@/components/TelegramLoginWidget';
import { GoogleLoginButton } from '@/components/GoogleLoginButton';
import { PasswordStrength } from '@/components/PasswordStrength';
import { TwoFactorPrompt } from '@/components/TwoFactorPrompt';
import { isCancellation, isPasskeySupported, loginWithPasskey } from '@/lib/webauthn';

/**
 * Registration is three steps rather than one long form.
 *
 * Not decoration: each screen asks for one thing and can answer immediately
 * — the address gets checked for shape, the password gets a live strength
 * meter and a breach lookup, the name is just a name. A single form with
 * three fields and one "готово" button hides every one of those answers
 * until after the mistake.
 */
type RegisterStep = 'email' | 'password' | 'name';

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
  const { login, register, adoptSession } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<RegisterStep>('email');
  const [pending2fa, setPending2fa] = useState<PendingTwoFactor | null>(null);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
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

  useEffect(() => {
    setPasskeySupported(isPasskeySupported());
  }, []);

  const onPasskeyLogin = useCallback(async () => {
    setError(null);
    setOauthBusy(true);
    try {
      adoptSession((await loginWithPasskey()) as AuthResponse);
      router.push('/');
      router.refresh();
    } catch (err) {
      // Cancelling the system prompt is a decision, not a failure.
      if (!isCancellation(err)) {
        setError(err instanceof ApiError ? err.message : 'Не удалось войти по ключу');
      }
    } finally {
      setOauthBusy(false);
    }
  }, [adoptSession, router]);

  const onMagicLink = useCallback(async () => {
    if (!email) {
      setError('Введите почту — на неё придёт ссылка');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/magic-link', { email });
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить ссылку');
    } finally {
      setSubmitting(false);
    }
  }, [email]);

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
        const pending = await login({ email, password });
        if (pending) {
          // The password was right, but the account wants a second factor —
          // nothing is signed in until that is answered.
          setPending2fa(pending);
          return;
        }
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

  if (pending2fa) {
    return (
      <Card>
        <TwoFactorPrompt
          ticket={pending2fa.ticket}
          onDone={() => {
            router.push('/');
            router.refresh();
          }}
        />
      </Card>
    );
  }

  const canAdvance =
    step === 'email'
      ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
      : step === 'password'
        ? password.length >= 8
        : displayName.trim().length >= 2;

  return (
    <Card>
      <h1 style={{ marginTop: 0, fontSize: 'var(--z-fs-xl)' }}>
        {mode === 'login' ? 'Вход в ZAA4EEM' : 'Регистрация'}
      </h1>

      {mode === 'register' && (
        <div className="z-step-dots" aria-label={`Шаг ${['email', 'password', 'name'].indexOf(step) + 1} из 3`}>
          {(['email', 'password', 'name'] as RegisterStep[]).map((s2, i) => (
            <span
              key={s2}
              className={`z-step-dot${step === s2 ? ' z-step-dot-active' : ''}${
                ['email', 'password', 'name'].indexOf(step) > i ? ' z-step-dot-done' : ''
              }`}
            />
          ))}
        </div>
      )}

      {oauthBusy && (
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>Входим…</p>
      )}

      {!oauthBusy && mode === 'login' && passkeySupported && (
        <button
          type="button"
          onClick={onPasskeyLogin}
          className="z-btn-accent z-pop-on-active"
          style={{ width: '100%', marginBottom: 12 }}
        >
          🔑 Войти по ключу
        </button>
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

      <form
        onSubmit={(e) => {
          // In register mode the button only submits on the final step;
          // earlier ones just advance, so Enter does the expected thing.
          if (mode === 'register' && step !== 'name') {
            e.preventDefault();
            if (canAdvance) setStep(step === 'email' ? 'password' : 'name');
            return;
          }
          onSubmit(e);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {(mode === 'login' || step === 'email') && (
          <input
            className="z-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus={mode === 'register'}
          />
        )}

        {(mode === 'login' || step === 'password') && (
          <div>
            <input
              className="z-input"
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              autoFocus={mode === 'register'}
              style={{ width: '100%' }}
            />
            {mode === 'register' && <PasswordStrength password={password} />}
          </div>
        )}

        {mode === 'register' && step === 'name' && (
          <input
            className="z-input"
            placeholder="Как вас называть"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="nickname"
            maxLength={40}
            autoFocus
          />
        )}

        {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}

        {magicSent && (
          <div style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>
            Если такая почта зарегистрирована, ссылка для входа уже отправлена.
          </div>
        )}

        <button
          type="submit"
          className="z-btn-accent"
          disabled={submitting || (mode === 'register' && !canAdvance)}
        >
          {mode === 'login' ? 'Войти' : step === 'name' ? 'Создать аккаунт' : 'Дальше'}
        </button>

        {mode === 'register' && step !== 'email' && (
          <button
            type="button"
            onClick={() => setStep(step === 'name' ? 'password' : 'email')}
            className="z-btn-ghost z-pop-on-active"
          >
            Назад
          </button>
        )}

        {mode === 'login' && (
          <button
            type="button"
            onClick={onMagicLink}
            disabled={submitting}
            className="z-btn-ghost z-pop-on-active"
          >
            ✉️ Прислать ссылку для входа
          </button>
        )}
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
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          // Switching modes restarts the wizard; leaving it on step 3 would
          // show "Как вас называть" to someone who just asked to sign in.
          setStep('email');
          setError(null);
          setMagicSent(false);
        }}
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

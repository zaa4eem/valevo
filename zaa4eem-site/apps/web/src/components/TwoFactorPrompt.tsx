'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

/** The second step of a 2FA login: six digits from the app, or one backup code. */
export function TwoFactorPrompt({ ticket, onDone }: { ticket: string; onDone: () => void }) {
  const { submitTwoFactor } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useBackup, setUseBackup] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitTwoFactor(ticket, code.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Код не подошёл');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 30, marginBottom: 6 }} aria-hidden>
          🔐
        </div>
        <h2 style={{ margin: 0, fontSize: 'var(--z-fs-lg)' }}>Подтвердите вход</h2>
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: '6px 0 0' }}>
          {useBackup
            ? 'Введите один из резервных кодов, которые вы сохранили.'
            : 'Введите 6 цифр из приложения-аутентификатора.'}
        </p>
      </div>

      <input
        className="z-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={useBackup ? 'XXXX-XXXX' : '123456'}
        inputMode={useBackup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        style={{ letterSpacing: useBackup ? 'normal' : '0.3em', textAlign: 'center', fontSize: 'var(--z-fs-lg)' }}
      />

      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}

      <button type="submit" disabled={busy || code.trim().length < 6} className="z-btn-accent z-pop-on-active">
        {busy ? 'Проверяем…' : 'Войти'}
      </button>

      <button
        type="button"
        onClick={() => {
          setUseBackup((v) => !v);
          setCode('');
          setError(null);
        }}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--z-text-faint)',
          fontSize: 'var(--z-fs-xs)',
          cursor: 'pointer',
        }}
      >
        {useBackup ? 'Ввести код из приложения' : 'Потерян доступ к приложению? Резервный код'}
      </button>
    </form>
  );
}

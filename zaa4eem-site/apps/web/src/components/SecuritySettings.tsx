'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SecurityOverview, SessionInfo, PasskeyInfo } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { Card } from './Card';
import { PasswordStrength } from './PasswordStrength';
import { hasPlatformAuthenticator, isCancellation, isPasskeySupported, registerPasskey } from '@/lib/webauthn';
import { changePasswordSchema } from '@zaa4eem/shared';

/**
 * Settings → Безопасность. One screen that answers "how do I get in, and
 * who else is in right now" — password, passkeys, 2FA, email proof, and the
 * list of live sessions with a way to end them.
 */
export function SecuritySettings() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOverview(await api.get<SecurityOverview>('/security'));
    } catch {
      setError('Не удалось загрузить настройки безопасности');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error && !overview) {
    return (
      <Card style={{ marginTop: 20, borderColor: 'var(--z-danger)', color: 'var(--z-danger)' }}>{error}</Card>
    );
  }

  if (!overview) {
    return (
      <Card style={{ marginTop: 20 }}>
        <span className="z-skeleton" style={{ display: 'block', height: 180, borderRadius: 'var(--z-radius-md)' }} />
      </Card>
    );
  }

  return (
    <>
      <EmailVerification overview={overview} onChanged={reload} />
      <PasskeySettings overview={overview} onChanged={reload} />
      <TotpSettings overview={overview} onChanged={reload} />
      <PasswordSettings hasPassword={overview.hasPassword} />
      <SessionsSettings sessions={overview.sessions} onChanged={reload} />
    </>
  );
}

function EmailVerification({
  overview,
  onChanged,
}: {
  overview: SecurityOverview;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to verify without an address, and nothing to offer without a
  // mail server — a "resend" button that silently does nothing is worse
  // than no button.
  if (!overview.email || overview.emailVerified || !overview.emailAvailable) return null;

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/verify-email/resend');
      setSent(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить письмо');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="z-animate-in" style={{ marginTop: 20, borderColor: 'var(--z-warning)' }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>✉️ Подтвердите почту</h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -4 }}>
        Пока адрес <b>{overview.email}</b> не подтверждён, он не закреплён за вами — и восстановить
        доступ по нему не получится.
      </p>
      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
      {sent ? (
        <div style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>
          Письмо отправлено — проверьте почту.
        </div>
      ) : (
        <button onClick={resend} disabled={busy} className="z-btn-accent z-pop-on-active">
          {busy ? 'Отправляем…' : 'Отправить письмо'}
        </button>
      )}
    </Card>
  );
}

function PasskeySettings({ overview, onChanged }: { overview: SecurityOverview; onChanged: () => void }) {
  const [supported, setSupported] = useState(false);
  const [platform, setPlatform] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isPasskeySupported());
    hasPlatformAuthenticator().then(setPlatform);
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      onChanged();
    } catch (err) {
      // Cancelling the system prompt is a decision, not a failure.
      if (!isCancellation(err)) {
        setError(err instanceof ApiError ? err.message : 'Не удалось добавить ключ');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(passkey: PasskeyInfo) {
    if (!confirm(`Удалить «${passkey.label}»?`)) return;
    try {
      await api.delete(`/security/passkeys/${passkey.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось удалить ключ');
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>🔑 Вход по ключу (passkey)</h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -4, marginBottom: 14 }}>
        Отпечаток, Face ID или PIN устройства вместо пароля. Такой ключ невозможно подсмотреть,
        подобрать или выманить на поддельном сайте — он работает только на этом домене и никогда не
        покидает устройство.
      </p>

      {overview.passkeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {overview.passkeys.map((passkey) => (
            <div key={passkey.id} className="z-session-row">
              <span className="z-session-icon" aria-hidden>
                🔑
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{passkey.label}</div>
                <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)' }}>
                  Добавлен {formatDate(passkey.createdAt)}
                  {passkey.lastUsedAt ? ` · последний вход ${formatDate(passkey.lastUsedAt)}` : ''}
                </div>
              </div>
              <button onClick={() => remove(passkey)} className="z-session-revoke">
                Удалить
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginBottom: 10 }}>{error}</div>
      )}

      {supported ? (
        <button onClick={add} disabled={busy} className="z-btn-accent z-pop-on-active">
          {busy ? 'Ждём устройство…' : platform ? 'Добавить ключ этого устройства' : 'Добавить ключ'}
        </button>
      ) : (
        <div style={{ color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-sm)' }}>
          Этот браузер не поддерживает ключи входа.
        </div>
      )}
    </Card>
  );
}

function TotpSettings({ overview, onChanged }: { overview: SecurityOverview; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The QR library is only needed by someone actually enrolling, so it is
  // pulled in at that moment rather than in everyone's Settings bundle.
  useEffect(() => {
    if (!setup) {
      setQr(null);
      return;
    }
    let cancelled = false;
    import('qrcode').then(({ default: QRCode }) =>
      QRCode.toDataURL(setup.uri, { width: 220, margin: 1 }).then((url) => {
        if (!cancelled) setQr(url);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [setup]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post<{ secret: string; uri: string }>('/security/totp/begin'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось начать настройку');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ codes: string[] }>('/security/totp/confirm', { code: code.trim() });
      setCodes(res.codes);
      setSetup(null);
      setCode('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Код не подошёл');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/security/totp/disable', { password: password || undefined });
      setPassword('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось выключить');
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const res = await api.post<{ codes: string[] }>('/security/backup-codes/regenerate');
      setCodes(res.codes);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>
        🛡️ Двухфакторная защита {overview.totpEnabled && <span className="z-on-pill">включена</span>}
      </h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -4, marginBottom: 14 }}>
        Код из приложения (Google Authenticator, Яндекс.Ключ, 1Password) в дополнение к паролю.
        Даже если пароль утечёт, войти без вашего телефона не получится.
      </p>

      {error && (
        <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginBottom: 10 }}>{error}</div>
      )}

      {codes && (
        <div className="z-backup-codes">
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Сохраните резервные коды</div>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-xs)', marginTop: 0 }}>
            Показываются один раз — дальше в базе только их отпечатки. Каждый работает единожды и
            заменяет код из приложения, если телефон потерян.
          </p>
          <div className="z-backup-code-grid">
            {codes.map((backup) => (
              <code key={backup}>{backup}</code>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}
              className="z-btn-ghost z-pop-on-active"
            >
              Скопировать
            </button>
            <button onClick={() => setCodes(null)} className="z-btn-accent z-pop-on-active">
              Я сохранил
            </button>
          </div>
        </div>
      )}

      {setup && !codes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR-код для приложения-аутентификатора" width={220} height={220} style={{ alignSelf: 'center', borderRadius: 'var(--z-radius-sm)', background: '#fff', padding: 8 }} />
          ) : (
            <span className="z-skeleton" style={{ width: 220, height: 220, alignSelf: 'center', borderRadius: 'var(--z-radius-sm)' }} />
          )}
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)', textAlign: 'center' }}>
            Не получается отсканировать? Введите ключ вручную:
            <br />
            <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{setup.secret}</code>
          </div>
          <input
            className="z-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Код из приложения"
            inputMode="numeric"
            style={{ letterSpacing: '0.3em', textAlign: 'center' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={confirm} disabled={busy || code.trim().length < 6} className="z-btn-accent z-pop-on-active">
              {busy ? 'Проверяем…' : 'Включить'}
            </button>
            <button onClick={() => setSetup(null)} className="z-btn-ghost z-pop-on-active">
              Отмена
            </button>
          </div>
        </div>
      )}

      {!setup && !overview.totpEnabled && !codes && (
        <button onClick={begin} disabled={busy} className="z-btn-accent z-pop-on-active">
          {busy ? '…' : 'Включить'}
        </button>
      )}

      {overview.totpEnabled && !codes && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
            Резервных кодов осталось: <b>{overview.backupCodesLeft}</b>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={regenerate} disabled={busy} className="z-btn-ghost z-pop-on-active">
              Новые резервные коды
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {overview.hasPassword && (
              <input
                className="z-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль, чтобы выключить"
                style={{ maxWidth: 240 }}
              />
            )}
            <button
              onClick={disable}
              disabled={busy || (overview.hasPassword && !password)}
              className="z-btn-ghost z-pop-on-active"
              style={{ color: 'var(--z-danger)' }}
            >
              Выключить
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PasswordSettings({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const parsed = changePasswordSchema.safeParse({
      currentPassword: hasPassword ? currentPassword : undefined,
      newPassword,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы');
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/change-password', parsed.data);
      setCurrentPassword('');
      setNewPassword('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>🔒 Пароль</h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -8, marginBottom: 16 }}>
        {hasPassword
          ? 'Смена пароля завершает сеансы на всех остальных устройствах.'
          : 'Пароль ещё не задан — можно установить его для входа по почте.'}
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {hasPassword && (
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
              Текущий пароль
            </div>
            <input
              className="z-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
        )}
        <label>
          <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
            Новый пароль
          </div>
          <input
            className="z-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <PasswordStrength password={newPassword} />
        </label>
        {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
        {saved && <div style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>Пароль обновлён!</div>}
        <button
          type="submit"
          disabled={saving || !newPassword}
          className="z-btn-accent z-pop-on-active"
          style={{ alignSelf: 'flex-start', opacity: saving || !newPassword ? 0.6 : 1 }}
        >
          {saving ? 'Сохранение…' : hasPassword ? 'Сменить пароль' : 'Задать пароль'}
        </button>
      </form>
    </Card>
  );
}

function SessionsSettings({ sessions, onChanged }: { sessions: SessionInfo[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke(session: SessionInfo) {
    setError(null);
    try {
      await api.delete(`/security/sessions/${session.id}`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось завершить сеанс');
    }
  }

  async function revokeOthers() {
    if (!confirm('Завершить все сеансы, кроме текущего?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/security/sessions/revoke-others');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось завершить сеансы');
    } finally {
      setBusy(false);
    }
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)' }}>💻 Сеансы</h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -4, marginBottom: 14 }}>
        Устройства, на которых сейчас выполнен вход. Не узнаёте какое-то — завершите его и смените пароль.
      </p>

      {error && (
        <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginBottom: 10 }}>{error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map((session) => (
          <div key={session.id} className={`z-session-row${session.current ? ' z-session-current' : ''}`}>
            <span className="z-session-icon" aria-hidden>
              {session.current ? '📍' : '💻'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {session.label}
                {session.current && <span className="z-on-pill">этот вход</span>}
              </div>
              <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)' }}>
                {session.network ? `${session.network} · ` : ''}
                {session.lastUsedAt ? `активен ${formatDate(session.lastUsedAt)}` : `вход ${formatDate(session.createdAt)}`}
              </div>
            </div>
            {!session.current && (
              <button onClick={() => revoke(session)} className="z-session-revoke">
                Завершить
              </button>
            )}
          </div>
        ))}
      </div>

      {others > 0 && (
        <button
          onClick={revokeOthers}
          disabled={busy}
          className="z-btn-ghost z-pop-on-active"
          style={{ marginTop: 14, color: 'var(--z-danger)' }}
        >
          {busy ? 'Завершаем…' : `Выйти на всех остальных устройствах (${others})`}
        </button>
      )}
    </Card>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

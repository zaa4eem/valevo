'use client';

import { useEffect, useRef, useState } from 'react';
import {
  updateProfileSchema,
  formatMemberNumber,
  type PublicProfile,
  type TelegramLinkCodeResponse,
} from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { PremiumStyleFields, type PremiumStyleValue } from '@/components/PremiumStyleFields';
import { AvatarCropper } from '@/components/AvatarCropper';

function TelegramLinkSettings({ profile, onLinked }: { profile: PublicProfile; onLinked: (p: PublicProfile) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a code is showing, poll /users/me so linking (done from the bot,
  // not this tab) reflects here without the user having to refresh — stops
  // itself once linked or once the code's own 10-minute window has passed.
  useEffect(() => {
    if (!code || !expiresAt) return;
    const interval = setInterval(async () => {
      if (Date.now() > expiresAt) {
        clearInterval(interval);
        return;
      }
      try {
        const fresh = await api.get<PublicProfile>('/users/me');
        if (fresh.hasTelegram) {
          clearInterval(interval);
          onLinked(fresh);
        }
      } catch {
        // A transient failure here just means we try again next tick.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [code, expiresAt, onLinked]);

  async function generateCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<TelegramLinkCodeResponse>('/auth/link/telegram/code');
      setCode(res.code);
      setExpiresAt(Date.now() + res.expiresInMinutes * 60_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось создать код');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        ✈️ Telegram
      </h2>
      {profile.hasTelegram ? (
        <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>
          Привязан{profile.telegramUsername ? <> — <strong>@{profile.telegramUsername}</strong></> : ''}. Один и
          тот же аккаунт открывается и на сайте, и в мини-приложении.
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -8, marginBottom: 16 }}>
            Привяжи Telegram, чтобы заходить в один и тот же аккаунт и с сайта, и из мини-приложения.
          </p>
          {code ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  fontSize: 'var(--z-fs-2xl)',
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  color: 'var(--z-accent)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {code}
              </div>
              <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: 0 }}>
                Отправь боту{' '}
                <a href="https://t.me/zaa4eem_bot" target="_blank" rel="noreferrer">
                  @zaa4eem_bot
                </a>{' '}
                команду <code style={{ color: 'var(--z-text)' }}>/link {code}</code> в течение 10 минут.
              </p>
            </div>
          ) : (
            <button className="z-btn-accent z-pop-on-active" disabled={busy} onClick={generateCode}>
              {busy ? 'Создание кода…' : 'Привязать Telegram'}
            </button>
          )}
          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginTop: 10 }}>{error}</div>}
        </>
      )}
    </Card>
  );
}

function PremiumSettings({ profile, onSaved }: { profile: PublicProfile; onSaved: (p: PublicProfile) => void }) {
  const [style, setStyle] = useState<PremiumStyleValue>({
    nameStyle: profile.nameStyle ?? 'NONE',
    nameColor: profile.nameColor ?? '#22c55e',
    ringStyle: profile.ringStyle ?? 'NONE',
    badgeEmoji: profile.badgeEmoji,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.patch<PublicProfile>('/users/me/premium', {
        nameStyle: style.nameStyle === 'NONE' ? null : style.nameStyle,
        nameColor: style.nameStyle === 'GLOW' ? style.nameColor : null,
        ringStyle: style.ringStyle === 'NONE' ? null : style.ringStyle,
        badgeEmoji: style.badgeEmoji,
      });
      onSaved(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        👑 Premium
      </h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -8, marginBottom: 16 }}>
        {profile.premiumUntil
          ? `Активен до ${new Date(profile.premiumUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })} — выбери, как это будет выглядеть.`
          : 'Активен навсегда — выбери, как это будет выглядеть.'}
      </p>
      <PremiumStyleFields displayName={profile.displayName} avatarUrl={profile.avatarUrl} value={style} onChange={setStyle} />
      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginTop: 12 }}>{error}</div>}
      {saved && <div style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)', marginTop: 12 }}>Сохранено!</div>}
      <button
        className="z-btn-accent z-pop-on-active"
        disabled={saving}
        onClick={save}
        style={{ marginTop: 14, alignSelf: 'flex-start' }}
      >
        {saving ? 'Сохранение…' : 'Сохранить'}
      </button>
    </Card>
  );
}

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    api.get<PublicProfile>('/users/me').then(
      (p) => {
        setProfile(p);
        setDisplayName(p.displayName);
        setBio(p.bio ?? '');
        setStatusText(p.statusText ?? '');
      },
      () => setLoadError(true),
    );
  }, [user]);

  if (loading) return null;
  if (!user) return <p style={{ color: 'var(--z-text-muted)' }}>Нужно войти.</p>;
  if (loadError) return <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить профиль.</p>;
  if (!profile) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const parsed = updateProfileSchema.safeParse({
      displayName,
      bio: bio || null,
      statusText: statusText || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте поля формы');
      return;
    }

    try {
      await api.patch('/users/me', parsed.data);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
    }
  }

  function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarError(null);
      setAvatarFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onCropCancel() {
    setAvatarFile(null);
  }

  async function onCropped(blob: Blob) {
    setAvatarFile(null);
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append('avatar', blob, 'avatar.jpg');
      const updated = await api.upload<PublicProfile>('/users/me/avatar', form);
      setProfile(updated);
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : 'Не удалось загрузить аватар');
    } finally {
      setAvatarUploading(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Настройки профиля</h1>
      <Card hover className="z-animate-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'var(--z-accent-soft)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 'var(--z-fs-xl)',
              color: 'var(--z-accent)',
              flexShrink: 0,
              overflow: 'hidden',
              boxShadow: '0 0 0 3px var(--z-bg), 0 0 0 5px var(--z-accent-soft)',
            }}
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatarUrl}
                alt={profile.displayName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              profile.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginBottom: 6 }}>
              {formatMemberNumber(profile.memberNumber)}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onAvatarChange}
              disabled={avatarUploading}
              style={{ display: 'none' }}
              id="avatar-input"
            />
            <label htmlFor="avatar-input" className="z-btn-ghost z-pop-on-active" style={{ cursor: 'pointer' }}>
              {avatarUploading ? 'Загрузка…' : 'Сменить аватар'}
            </label>
            {avatarError && (
              <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginTop: 6 }}>
                {avatarError}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>Имя</div>
            <input className="z-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
              Статус (рядом с ником)
            </div>
            <input
              className="z-input"
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              placeholder="например: играю в снейк 🐍"
              maxLength={80}
            />
          </label>
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>О себе</div>
            <textarea className="z-textarea" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
          {saved && <div style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>Сохранено!</div>}
          <button type="submit" className="z-btn-accent z-pop-on-active" style={{ alignSelf: 'flex-start' }}>
            Сохранить
          </button>
        </form>
      </Card>

      <TelegramLinkSettings profile={profile} onLinked={setProfile} />

      {profile.isPremium && <PremiumSettings profile={profile} onSaved={setProfile} />}

      {avatarFile && <AvatarCropper file={avatarFile} onCancel={onCropCancel} onCropped={onCropped} />}
    </div>
  );
}

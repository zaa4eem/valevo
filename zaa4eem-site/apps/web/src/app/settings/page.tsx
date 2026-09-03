'use client';

import { useEffect, useRef, useState } from 'react';
import { updateProfileSchema, formatMemberNumber, type PublicProfile } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';

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

  async function onAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const form = new FormData();
      form.append('avatar', file);
      const updated = await api.upload<PublicProfile>('/users/me/avatar', form);
      setProfile(updated);
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : 'Не удалось загрузить аватар');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    </div>
  );
}

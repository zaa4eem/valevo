'use client';

import { useEffect, useState } from 'react';
import { updateProfileSchema, type PublicProfile } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get<PublicProfile>('/users/me').then((p) => {
      setProfile(p);
      setDisplayName(p.displayName);
      setBio(p.bio ?? '');
      setAvatarUrl(p.avatarUrl ?? '');
    });
  }, [user]);

  if (loading) return null;
  if (!user) return <p style={{ color: 'var(--z-text-muted)' }}>Нужно войти.</p>;
  if (!profile) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const parsed = updateProfileSchema.safeParse({
      displayName,
      bio: bio || null,
      avatarUrl: avatarUrl || null,
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

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Настройки профиля</h1>
      <Card>
        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>Имя</div>
            <input className="z-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>О себе</div>
            <textarea className="z-textarea" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} />
          </label>
          <label>
            <div style={{ marginBottom: 6, fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>Ссылка на аватар</div>
            <input className="z-input" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </label>
          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
          {saved && <div style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)' }}>Сохранено!</div>}
          <button type="submit" className="z-btn-accent" style={{ alignSelf: 'flex-start' }}>
            Сохранить
          </button>
        </form>
      </Card>
    </div>
  );
}

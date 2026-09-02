'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { PublicProfile } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';
import { StatTile } from '@/components/StatTile';

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const { user: viewer } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [modActionMessage, setModActionMessage] = useState<string | null>(null);

  async function moderateUser(action: 'mute' | 'ban') {
    const reason = window.prompt(`Причина (${action === 'mute' ? 'мут' : 'бан'}):`);
    if (!reason) return;
    await api.post(`/admin/users/${params.id}/${action}`, { reason });
    setModActionMessage(action === 'mute' ? 'Пользователь замьючен.' : 'Пользователь забанен.');
  }

  useEffect(() => {
    api
      .get<PublicProfile>(`/users/${params.id}`)
      .then(setProfile)
      .catch(() => setNotFound(true));
  }, [params.id]);

  if (notFound) return <p style={{ color: 'var(--z-text-muted)' }}>Пользователь не найден.</p>;
  if (!profile) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <Card>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--z-accent-soft)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: 'var(--z-fs-xl)',
              color: 'var(--z-accent)',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt={profile.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              profile.displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <h1 style={{ margin: 0 }}>
              {profile.displayName}
              {profile.role === 'OWNER' && (
                <span className="z-badge" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                  Owner
                </span>
              )}
            </h1>
            {profile.statusText && (
              <p style={{ color: 'var(--z-accent)', fontSize: 'var(--z-fs-sm)', margin: '4px 0 0', fontStyle: 'italic' }}>
                {profile.statusText}
              </p>
            )}
            {profile.bio && <p style={{ color: 'var(--z-text-muted)', margin: '4px 0 0' }}>{profile.bio}</p>}
          </div>
        </div>

        {viewer?.role === 'OWNER' && viewer.id !== profile.id && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, borderTop: '1px solid var(--z-border)', paddingTop: 16 }}>
            <button className="z-btn-ghost" onClick={() => moderateUser('mute')}>
              Замьютить
            </button>
            <button className="z-btn-danger" onClick={() => moderateUser('ban')}>
              Забанить
            </button>
            {modActionMessage && (
              <span style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-accent)', alignSelf: 'center' }}>
                {modActionMessage}
              </span>
            )}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <StatTile label="Идей предложено" value={profile.stats.ideasSubmittedCount} />
        <StatTile label="Идей принято" value={profile.stats.ideasAcceptedCount} />
        <StatTile label="Игр сыграно" value={profile.stats.gamesPlayedCount} />
      </div>

      {profile.stats.bestScoresByGame.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card>
            <h3 style={{ marginTop: 0 }}>Лучшие результаты</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {profile.stats.bestScoresByGame.map((s) => (
                <div key={s.gameSlug} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--z-text-muted)' }}>{s.gameTitle}</span>
                  <span style={{ fontWeight: 700 }}>{s.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

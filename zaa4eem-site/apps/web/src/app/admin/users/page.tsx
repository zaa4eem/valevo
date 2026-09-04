'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminUserListItem } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { PremiumStyleFields, type PremiumStyleValue } from '@/components/PremiumStyleFields';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';

const STATUS_LABEL: Record<AdminUserListItem['status'], string> = {
  ACTIVE: 'Активен',
  MUTED: 'В муте',
  BANNED: 'Забанен',
};

function PremiumEditor({
  user,
  onSaved,
  onCancel,
}: {
  user: AdminUserListItem;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [style, setStyle] = useState<PremiumStyleValue>({
    nameStyle: user.nameStyle ?? 'NONE',
    nameColor: user.nameColor ?? '#22c55e',
    ringStyle: user.ringStyle ?? 'NONE',
    badgeEmoji: user.badgeEmoji,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/users/${user.id}/premium`, {
        isPremium: true,
        nameStyle: style.nameStyle === 'NONE' ? null : style.nameStyle,
        nameColor: style.nameStyle === 'GLOW' ? style.nameColor : null,
        ringStyle: style.ringStyle === 'NONE' ? null : style.ringStyle,
        badgeEmoji: style.badgeEmoji,
      });
      onSaved();
    } catch {
      setError('Не удалось сохранить.');
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    try {
      await api.patch(`/admin/users/${user.id}/premium`, { isPremium: false });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        padding: 14,
        background: 'var(--z-bg-elevated)',
        borderRadius: 'var(--z-radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <PremiumStyleFields displayName={user.displayName} avatarUrl={user.avatarUrl} value={style} onChange={setStyle} />

      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="z-btn-accent z-pop-on-active" disabled={saving} onClick={save}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        {user.isPremium && (
          <button className="z-btn-danger z-pop-on-active" disabled={saving} onClick={revoke}>
            Убрать Premium
          </button>
        )}
        <button className="z-btn-ghost z-pop-on-active" disabled={saving} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingPremiumId, setEditingPremiumId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      setUsers(await api.get<AdminUserListItem[]>('/admin/users'));
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function moderate(id: string, action: 'mute' | 'ban' | 'activate') {
    setBusyId(id);
    try {
      if (action === 'activate') {
        await api.post(`/admin/users/${id}/activate`);
      } else {
        const reason = window.prompt(`Причина (${action === 'mute' ? 'мут' : 'бан'}):`);
        if (!reason) return;
        await api.post(`/admin/users/${id}/${action}`, { reason });
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить список пользователей.</p>;
  if (!users) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Пользователи ({users.length})</h1>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--z-fs-sm)' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--z-text-faint)', fontSize: 'var(--z-fs-xs)' }}>
              <th style={{ padding: '8px 10px' }}>Пользователь</th>
              <th style={{ padding: '8px 10px' }}>Роль</th>
              <th style={{ padding: '8px 10px' }}>Статус</th>
              <th style={{ padding: '8px 10px' }}>Контакт</th>
              <th style={{ padding: '8px 10px' }}>Подписчики</th>
              <th style={{ padding: '8px 10px' }}>С нами с</th>
              <th style={{ padding: '8px 10px' }}>Premium</th>
              <th style={{ padding: '8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr style={{ borderTop: '1px solid var(--z-border)' }}>
                <td style={{ padding: '10px' }}>
                  <Link href={`/u/${u.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PremiumAvatar name={u.displayName} avatarUrl={u.avatarUrl} size={32} premium={u} />
                    <div>
                      <PremiumName name={u.displayName} premium={u} style={{ fontWeight: 700 }} />
                      <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
                        {formatMemberNumber(u.memberNumber)}
                      </div>
                    </div>
                  </Link>
                </td>
                <td style={{ padding: '10px' }}>
                  {u.role === 'OWNER' ? <span className="z-badge">Owner</span> : 'Подписчик'}
                </td>
                <td style={{ padding: '10px' }}>
                  <span
                    style={{
                      color:
                        u.status === 'ACTIVE'
                          ? 'var(--z-accent)'
                          : u.status === 'MUTED'
                            ? 'var(--z-warning)'
                            : 'var(--z-danger)',
                      fontWeight: 600,
                    }}
                  >
                    {STATUS_LABEL[u.status]}
                  </span>
                </td>
                <td style={{ padding: '10px', color: 'var(--z-text-muted)' }}>
                  {u.email ?? (u.telegramUsername ? `@${u.telegramUsername}` : '—')}
                </td>
                <td style={{ padding: '10px' }}>{u.followerCount}</td>
                <td style={{ padding: '10px', color: 'var(--z-text-muted)' }}>
                  {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                </td>
                <td style={{ padding: '10px' }}>
                  {u.isPremium ? (
                    <span className="z-badge" style={{ background: 'var(--z-accent-soft)', color: 'var(--z-accent)' }}>
                      ✨ Premium
                    </span>
                  ) : (
                    <span style={{ color: 'var(--z-text-faint)' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '10px' }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="z-btn-ghost z-pop-on-active"
                      onClick={() => setEditingPremiumId(editingPremiumId === u.id ? null : u.id)}
                    >
                      {u.isPremium ? 'Настроить Premium' : '+ Premium'}
                    </button>
                    {u.role !== 'OWNER' && (
                      <>
                        {u.status === 'ACTIVE' ? (
                          <>
                            <button
                              className="z-btn-ghost z-pop-on-active"
                              disabled={busyId === u.id}
                              onClick={() => moderate(u.id, 'mute')}
                            >
                              Мут
                            </button>
                            <button
                              className="z-btn-danger z-pop-on-active"
                              disabled={busyId === u.id}
                              onClick={() => moderate(u.id, 'ban')}
                            >
                              Бан
                            </button>
                          </>
                        ) : (
                          <button
                            className="z-btn-accent z-pop-on-active"
                            disabled={busyId === u.id}
                            onClick={() => moderate(u.id, 'activate')}
                          >
                            Восстановить
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {editingPremiumId === u.id && (
                <tr>
                  <td colSpan={7} style={{ padding: '10px' }}>
                    <PremiumEditor
                      user={u}
                      onCancel={() => setEditingPremiumId(null)}
                      onSaved={() => {
                        setEditingPremiumId(null);
                        load();
                      }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

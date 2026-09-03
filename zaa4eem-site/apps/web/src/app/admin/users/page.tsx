'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminUserListItem } from '@zaa4eem/shared';
import { formatMemberNumber } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Avatar } from '@/components/Avatar';

const STATUS_LABEL: Record<AdminUserListItem['status'], string> = {
  ACTIVE: 'Активен',
  MUTED: 'В муте',
  BANNED: 'Забанен',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
              <th style={{ padding: '8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderTop: '1px solid var(--z-border)' }}>
                <td style={{ padding: '10px' }}>
                  <Link href={`/u/${u.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={u.displayName} avatarUrl={u.avatarUrl} size={32} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{u.displayName}</div>
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
                  {u.role !== 'OWNER' && (
                    <div style={{ display: 'flex', gap: 6 }}>
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
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

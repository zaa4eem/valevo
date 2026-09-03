'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminUserListItem } from '@zaa4eem/shared';
import { formatMemberNumber, premiumBadgeEmojiValues } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { PremiumName } from '@/components/PremiumName';
import { PremiumAvatar } from '@/components/PremiumAvatar';

const STATUS_LABEL: Record<AdminUserListItem['status'], string> = {
  ACTIVE: 'Активен',
  MUTED: 'В муте',
  BANNED: 'Забанен',
};

const NAME_STYLE_LABEL: Record<string, string> = {
  NONE: 'Без эффекта',
  FLOW: 'Переливающийся',
  HOLO: 'Голографический',
  GLOW: 'Свечение',
};

const RING_STYLE_LABEL: Record<string, string> = {
  NONE: 'Нет',
  SPIN: 'Вращение',
  PULSE: 'Пульсация',
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
  const [nameStyle, setNameStyle] = useState<string>(user.nameStyle ?? 'NONE');
  const [nameColor, setNameColor] = useState(user.nameColor ?? '#22c55e');
  const [ringStyle, setRingStyle] = useState<string>(user.ringStyle ?? 'NONE');
  const [badgeEmoji, setBadgeEmoji] = useState<string | null>(user.badgeEmoji);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUser = {
    isPremium: true,
    nameStyle: nameStyle === 'NONE' ? null : (nameStyle as 'FLOW' | 'HOLO' | 'GLOW'),
    nameColor: nameStyle === 'GLOW' ? nameColor : null,
    ringStyle: ringStyle === 'NONE' ? null : (ringStyle as 'SPIN' | 'PULSE'),
    badgeEmoji,
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/admin/users/${user.id}/premium`, {
        isPremium: true,
        nameStyle: nameStyle === 'NONE' ? null : nameStyle,
        nameColor: nameStyle === 'GLOW' ? nameColor : null,
        ringStyle: ringStyle === 'NONE' ? null : ringStyle,
        badgeEmoji,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PremiumAvatar name={user.displayName} avatarUrl={user.avatarUrl} size={36} premium={previewUser} />
        <PremiumName name={user.displayName} premium={previewUser} style={{ fontSize: 'var(--z-fs-md)' }} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
          Эффект ника
          <select className="z-input" value={nameStyle} onChange={(e) => setNameStyle(e.target.value)}>
            {Object.entries(NAME_STYLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {nameStyle === 'GLOW' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
            Цвет свечения
            <input
              type="color"
              value={nameColor}
              onChange={(e) => setNameColor(e.target.value)}
              style={{ width: 60, height: 36, padding: 2, border: '1px solid var(--z-border)', borderRadius: 'var(--z-radius-sm)' }}
            />
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
          Рамка аватара
          <select className="z-input" value={ringStyle} onChange={(e) => setRingStyle(e.target.value)}>
            {Object.entries(RING_STYLE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
          Эмодзи-значок
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="z-pop-on-active"
              onClick={() => setBadgeEmoji(null)}
              title="Без значка"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--z-radius-sm)',
                border: `1px solid ${badgeEmoji === null ? 'var(--z-accent)' : 'var(--z-border)'}`,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 'var(--z-fs-xs)',
                color: 'var(--z-text-faint)',
              }}
            >
              ✕
            </button>
            {premiumBadgeEmojiValues.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="z-pop-on-active"
                onClick={() => setBadgeEmoji(emoji)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--z-radius-sm)',
                  border: `1px solid ${badgeEmoji === emoji ? 'var(--z-accent)' : 'var(--z-border)'}`,
                  background: badgeEmoji === emoji ? 'var(--z-accent-soft)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 16,
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>

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

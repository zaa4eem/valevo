'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminUserListItem, PaginatedAdminUsers } from '@zaa4eem/shared';
import { formatMemberNumber, premiumDurationMonthsValues } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { PremiumStyleFields, type PremiumStyleValue } from '@/components/PremiumStyleFields';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';
import { useToast } from '@/lib/toast-context';

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
    nameFont: user.nameFont ?? 'NONE',
    badgeEmoji: user.badgeEmoji,
  });
  const [duration, setDuration] = useState<number | null>(3);
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
        nameFont: style.nameFont === 'NONE' ? null : style.nameFont,
        badgeEmoji: style.badgeEmoji,
        durationMonths: duration,
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

      <div>
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)', marginBottom: 6 }}>Срок Premium</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {premiumDurationMonthsValues.map((months) => (
            <button
              key={months}
              type="button"
              className="z-pop-on-active"
              onClick={() => setDuration(months)}
              style={{
                fontSize: 'var(--z-fs-xs)',
                fontWeight: 700,
                padding: '6px 10px',
                borderRadius: 'var(--z-radius-sm)',
                border: `1px solid ${duration === months ? 'var(--z-accent)' : 'var(--z-border)'}`,
                background: duration === months ? 'var(--z-accent)' : 'transparent',
                color: duration === months ? 'var(--z-accent-text-on)' : 'var(--z-text-muted)',
                cursor: 'pointer',
              }}
            >
              {months} мес
            </button>
          ))}
          <button
            type="button"
            className="z-pop-on-active"
            onClick={() => setDuration(null)}
            style={{
              fontSize: 'var(--z-fs-xs)',
              fontWeight: 700,
              padding: '6px 10px',
              borderRadius: 'var(--z-radius-sm)',
              border: `1px solid ${duration === null ? 'var(--z-accent)' : 'var(--z-border)'}`,
              background: duration === null ? 'var(--z-accent)' : 'transparent',
              color: duration === null ? 'var(--z-accent-text-on)' : 'var(--z-text-muted)',
              cursor: 'pointer',
            }}
          >
            Навсегда
          </button>
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

/** Status colour is the one thing both layouts need to agree on exactly. */
const STATUS_COLOR: Record<AdminUserListItem['status'], string> = {
  ACTIVE: 'var(--z-accent)',
  MUTED: 'var(--z-warning)',
  BANNED: 'var(--z-danger)',
};

function StatusPill({ status }: { status: AdminUserListItem['status'] }) {
  return (
    <span style={{ color: STATUS_COLOR[status], fontWeight: 600 }}>{STATUS_LABEL[status]}</span>
  );
}

function PremiumCell({ user }: { user: AdminUserListItem }) {
  if (!user.isPremium) return <span style={{ color: 'var(--z-text-faint)' }}>—</span>;
  return (
    <div>
      <span className="z-badge" style={{ background: 'var(--z-accent-soft)', color: 'var(--z-accent)' }}>
        ✨ Premium
      </span>
      <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginTop: 4 }}>
        {user.premiumUntil
          ? `до ${new Date(user.premiumUntil).toLocaleDateString('ru-RU')}`
          : 'навсегда'}
      </div>
    </div>
  );
}

function Identity({ user, size = 32 }: { user: AdminUserListItem; size?: number }) {
  return (
    <Link href={`/u/${user.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <PremiumAvatar name={user.displayName} avatarUrl={user.avatarUrl} size={size} premium={user} />
      <div style={{ minWidth: 0 }}>
        <PremiumName name={user.displayName} premium={user} style={{ fontWeight: 700 }} />
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
          {formatMemberNumber(user.memberNumber)}
        </div>
      </div>
    </Link>
  );
}

/** The same buttons on both layouts, so an action never exists on only one of them. */
function Actions({
  user,
  busy,
  onPremium,
  onModerate,
}: {
  user: AdminUserListItem;
  busy: boolean;
  onPremium: () => void;
  onModerate: (action: 'mute' | 'ban' | 'activate') => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button className="z-btn-ghost z-pop-on-active" onClick={onPremium}>
        {user.isPremium ? 'Настроить Premium' : '+ Premium'}
      </button>
      {user.role !== 'OWNER' &&
        (user.status === 'ACTIVE' ? (
          <>
            <button className="z-btn-ghost z-pop-on-active" disabled={busy} onClick={() => onModerate('mute')}>
              Мут
            </button>
            <button className="z-btn-danger z-pop-on-active" disabled={busy} onClick={() => onModerate('ban')}>
              Бан
            </button>
          </>
        ) : (
          <button className="z-btn-accent z-pop-on-active" disabled={busy} onClick={() => onModerate('activate')}>
            Восстановить
          </button>
        ))}
    </div>
  );
}

export default function AdminUsersPage() {
  const { prompt, toast } = useToast();
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editingPremiumId, setEditingPremiumId] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setError(false);
    try {
      const page = await api.get<PaginatedAdminUsers>(
        `/admin/users?limit=30${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      );
      setUsers(page.items);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch {
      setError(true);
    }
  }, []);

  // Debounced so typing a name doesn't fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<PaginatedAdminUsers>(
        `/admin/users?limit=30&cursor=${nextCursor}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`,
      );
      setUsers((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      toast('Не удалось загрузить ещё', 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  async function moderate(id: string, action: 'mute' | 'ban' | 'activate') {
    if (action !== 'activate') {
      const reason = await prompt(`Причина (${action === 'mute' ? 'мут' : 'бан'}):`, {
        placeholder: 'Коротко, для журнала модерации',
      });
      if (!reason) return;
      setBusyId(id);
      try {
        await api.post(`/admin/users/${id}/${action}`, { reason });
        toast(action === 'mute' ? 'Пользователь в муте' : 'Пользователь забанен', 'success');
        await load(search.trim());
      } catch {
        toast('Не удалось выполнить действие', 'error');
      } finally {
        setBusyId(null);
      }
      return;
    }

    setBusyId(id);
    try {
      await api.post(`/admin/users/${id}/activate`);
      toast('Пользователь восстановлен', 'success');
      await load(search.trim());
    } catch {
      toast('Не удалось выполнить действие', 'error');
    } finally {
      setBusyId(null);
    }
  }

  function premiumEditor(user: AdminUserListItem) {
    return (
      <PremiumEditor
        user={user}
        onCancel={() => setEditingPremiumId(null)}
        onSaved={() => {
          setEditingPremiumId(null);
          load(search.trim());
        }}
      />
    );
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>
        Пользователи <span style={{ color: 'var(--z-text-faint)', fontWeight: 400 }}>({total})</span>
      </h1>

      <input
        className="z-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Поиск по имени, почте или Telegram"
        style={{ width: '100%', marginBottom: 16 }}
      />

      {error && <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить список пользователей.</p>}

      {!error && users === null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="z-skeleton" style={{ height: 72, borderRadius: 'var(--z-radius-md)' }} />
          ))}
        </div>
      )}

      {users !== null && users.length === 0 && (
        <p style={{ color: 'var(--z-text-faint)' }}>Никого не нашлось.</p>
      )}

      {/* Two layouts of the same rows, swapped in CSS at the breakpoint: a
          table where there is room for eight columns, and a stack of cards
          where there is not. A table squeezed into 390px is a horizontal
          scrollbar, which is the thing that made this page unusable. */}
      {users !== null && users.length > 0 && (
        <>
          <div className="z-admin-table-wrap">
            <table className="z-admin-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Контакт</th>
                  <th>Подписчики</th>
                  <th>С нами с</th>
                  <th>Premium</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Fragment key={u.id}>
                    <tr>
                      <td>
                        <Identity user={u} />
                      </td>
                      <td>
                        {u.role === 'OWNER' ? (
                          <span className="z-badge-owner">Владелец проекта</span>
                        ) : (
                          'Подписчик'
                        )}
                      </td>
                      <td>
                        <StatusPill status={u.status} />
                      </td>
                      <td style={{ color: 'var(--z-text-muted)' }}>
                        {u.email ?? (u.telegramUsername ? `@${u.telegramUsername}` : '—')}
                      </td>
                      <td>{u.followerCount}</td>
                      <td style={{ color: 'var(--z-text-muted)' }}>
                        {new Date(u.createdAt).toLocaleDateString('ru-RU')}
                      </td>
                      <td>
                        <PremiumCell user={u} />
                      </td>
                      <td>
                        <Actions
                          user={u}
                          busy={busyId === u.id}
                          onPremium={() => setEditingPremiumId(editingPremiumId === u.id ? null : u.id)}
                          onModerate={(action) => moderate(u.id, action)}
                        />
                      </td>
                    </tr>
                    {editingPremiumId === u.id && (
                      <tr>
                        {/* Eight columns, not seven — the old value left the
                            editor short of the actions column. */}
                        <td colSpan={8}>{premiumEditor(u)}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="z-admin-cards">
            {users.map((u) => (
              <div key={u.id} className="z-admin-card">
                <div className="z-admin-card-head">
                  <Identity user={u} size={40} />
                  <StatusPill status={u.status} />
                </div>

                <dl className="z-admin-card-facts">
                  <div>
                    <dt>Роль</dt>
                    <dd>{u.role === 'OWNER' ? 'Владелец' : 'Подписчик'}</dd>
                  </div>
                  <div>
                    <dt>Подписчики</dt>
                    <dd>{u.followerCount}</dd>
                  </div>
                  <div>
                    <dt>С нами с</dt>
                    <dd>{new Date(u.createdAt).toLocaleDateString('ru-RU')}</dd>
                  </div>
                  <div className="z-admin-card-fact-wide">
                    <dt>Контакт</dt>
                    <dd>{u.email ?? (u.telegramUsername ? `@${u.telegramUsername}` : '—')}</dd>
                  </div>
                  <div className="z-admin-card-fact-wide">
                    <dt>Premium</dt>
                    <dd>
                      <PremiumCell user={u} />
                    </dd>
                  </div>
                </dl>

                <Actions
                  user={u}
                  busy={busyId === u.id}
                  onPremium={() => setEditingPremiumId(editingPremiumId === u.id ? null : u.id)}
                  onModerate={(action) => moderate(u.id, action)}
                />

                {editingPremiumId === u.id && (
                  <div style={{ marginTop: 12 }}>{premiumEditor(u)}</div>
                )}
              </div>
            ))}
          </div>

          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="z-btn-ghost z-pop-on-active"
              style={{ marginTop: 16, width: '100%' }}
            >
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

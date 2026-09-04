'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IdeaCredit, SearchResults } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { Card } from '@/components/Card';
import { PremiumAvatar } from '@/components/PremiumAvatar';
import { PremiumName } from '@/components/PremiumName';

type UserOption = SearchResults['users'][number];

export default function AdminIdeaCreditsPage() {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<UserOption[]>([]);
  const [selected, setSelected] = useState<UserOption | null>(null);
  const [description, setDescription] = useState('');
  const [credits, setCredits] = useState<IdeaCredit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCredits = useCallback(async () => {
    setCredits(await api.get<IdeaCredit[]>('/idea-credits'));
  }, []);

  useEffect(() => {
    loadCredits();
  }, [loadCredits]);

  function onQueryChange(value: string) {
    setQuery(value);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setOptions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await api.get<SearchResults>(`/search?q=${encodeURIComponent(value)}&type=users`);
      setOptions(res.users);
    }, 300);
  }

  function pick(user: UserOption) {
    setSelected(user);
    setQuery(user.displayName);
    setOptions([]);
  }

  async function submit() {
    if (!selected || !description.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/idea-credits', { userId: selected.id, description: description.trim() });
      setSelected(null);
      setQuery('');
      setDescription('');
      await loadCredits();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Удалить эту запись?')) return;
    await api.delete(`/idea-credits/${id}`);
    await loadCredits();
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>Авторы идей</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -8 }}>
        Отметь, кто предложил идею вне сайта, которая стала фичей — на его профиле появится плашка, а здесь — в общем списке.
      </p>

      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)', position: 'relative' }}>
            Кто предложил
            <input
              className="z-input"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Начните вводить имя…"
            />
            {options.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 5,
                  background: 'var(--z-surface)',
                  border: '1px solid var(--z-border)',
                  borderRadius: 'var(--z-radius-sm)',
                  marginTop: 4,
                  overflow: 'hidden',
                }}
              >
                {options.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pick(u)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--z-text)',
                      cursor: 'pointer',
                      fontSize: 'var(--z-fs-sm)',
                    }}
                  >
                    {u.displayName}
                  </button>
                ))}
              </div>
            )}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
            Что предложили
            <textarea
              className="z-textarea"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              placeholder="Уведомление о новом рекорде в Змейке"
            />
          </label>

          {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}

          <button
            className="z-btn-accent z-pop-on-active"
            disabled={!selected || !description.trim() || saving}
            onClick={submit}
            style={{ alignSelf: 'flex-start' }}
          >
            {saving ? 'Публикация…' : 'Опубликовать'}
          </button>
        </div>
      </Card>

      <h2 style={{ fontSize: 'var(--z-fs-lg)' }}>Опубликованные записи</h2>
      {!credits ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : credits.length === 0 ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Пока никого не отметили.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {credits.map((credit) => (
            <Card key={credit.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <PremiumAvatar
                  name={credit.user.displayName}
                  avatarUrl={credit.user.avatarUrl}
                  size={28}
                  premium={credit.user}
                />
                <div style={{ minWidth: 0 }}>
                  <b>
                    <PremiumName name={credit.user.displayName} premium={credit.user} />
                  </b>
                  <span style={{ color: 'var(--z-text-muted)' }}> — {credit.description}</span>
                </div>
              </div>
              <button className="z-btn-ghost z-pop-on-active" onClick={() => remove(credit.id)}>
                Удалить
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

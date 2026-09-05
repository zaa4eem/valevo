'use client';

import { useEffect, useState } from 'react';
import type { NotificationPrefs } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';
import { Card } from '@/components/Card';
import { PushToggle } from '@/components/PushToggle';

/** Order matters: the event switches first, then the two delivery channels. */
const EVENT_SWITCHES: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'notifyLikes', label: 'Лайки', hint: 'Кто-то оценил ваш пост' },
  { key: 'notifyComments', label: 'Ответы', hint: 'Новый комментарий под вашим постом' },
  { key: 'notifyFollows', label: 'Подписки', hint: 'На вас подписался новый человек' },
  { key: 'notifyIdeas', label: 'Идеи', hint: 'Изменился статус вашей идеи' },
  { key: 'notifyRecords', label: 'Рекорды', hint: 'Ваш рекорд в игре побит' },
];

const CHANNEL_SWITCHES: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'notifyPush', label: 'Push в браузере', hint: 'Всплывающие уведомления на устройстве' },
  { key: 'notifyTelegram', label: 'Telegram', hint: 'Сообщения от бота в привязанный аккаунт' },
];

function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label className="z-switch-row">
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, display: 'block' }}>{label}</span>
        <span style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-xs)' }}>{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="z-switch"
      />
    </label>
  );
}

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<NotificationPrefs>('/notifications/prefs')
      .then((value) => {
        if (!cancelled) setPrefs(value);
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить настройки уведомлений');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    // Optimistic: a switch that waits for a round trip before moving feels broken.
    setPrefs({ ...prefs, [key]: value });
    setError(null);
    try {
      await api.patch('/notifications/prefs', { [key]: value });
    } catch {
      setPrefs(previous);
      setError('Не удалось сохранить — попробуйте ещё раз');
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--z-fs-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
        🔔 Уведомления
      </h2>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: -8, marginBottom: 16 }}>
        Колокольчик на сайте показывает всё всегда — эти переключатели решают, о чём вас ещё и потревожат.
      </p>

      <PushToggle compact />

      {error && (
        <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginTop: 12 }}>{error}</div>
      )}

      {!prefs ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="z-skeleton" style={{ height: 44, borderRadius: 'var(--z-radius-sm)' }} />
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="z-switch-group-title">О чём сообщать</div>
          {EVENT_SWITCHES.map((row) => (
            <Switch
              key={row.key}
              label={row.label}
              hint={row.hint}
              checked={prefs[row.key]}
              onChange={(next) => update(row.key, next)}
            />
          ))}

          <div className="z-switch-group-title" style={{ marginTop: 18 }}>
            Куда сообщать
          </div>
          {CHANNEL_SWITCHES.map((row) => (
            <Switch
              key={row.key}
              label={row.label}
              hint={row.hint}
              checked={prefs[row.key]}
              onChange={(next) => update(row.key, next)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

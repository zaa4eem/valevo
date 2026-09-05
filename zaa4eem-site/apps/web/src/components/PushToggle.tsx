'use client';

import { useEffect, useState } from 'react';
import { disablePush, enablePush, fetchPushPublicKey, getExistingSubscription, isPushSupported } from '@/lib/push';
import { useAuth } from '@/lib/auth-context';

type State = 'checking' | 'hidden' | 'off' | 'on' | 'blocked';

/**
 * The opt-in prompt for browser push. Deliberately not shown as a modal on
 * arrival — a permission dialog someone didn't ask for is the fastest way to
 * get "заблокировать" pressed forever. It sits at the top of the
 * notifications screen instead, where the intent is already established.
 */
export function PushToggle({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const [state, setState] = useState<State>('checking');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!user || !isPushSupported()) {
        if (!cancelled) setState('hidden');
        return;
      }
      const key = await fetchPushPublicKey();
      if (cancelled) return;
      if (!key) {
        // No VAPID keys on this deployment: offering the switch would be a lie.
        setState('hidden');
        return;
      }
      setPublicKey(key);
      if (Notification.permission === 'denied') {
        setState('blocked');
        return;
      }
      const subscription = await getExistingSubscription();
      if (!cancelled) setState(subscription ? 'on' : 'off');
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (state === 'checking' || state === 'hidden') return null;

  async function toggle() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      if (state === 'on') {
        await disablePush();
        setState('off');
      } else {
        await enablePush(publicKey);
        setState('on');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось включить уведомления');
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setState('blocked');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'blocked') {
    return (
      <div className="z-push-banner" style={{ borderColor: 'var(--z-border)' }}>
        <span style={{ fontSize: 20 }} aria-hidden>
          🔕
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)' }}>Push заблокирован браузером</div>
          <div style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-xs)' }}>
            Разрешите уведомления для сайта в настройках браузера, чтобы включить их снова.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`z-push-banner${state === 'on' ? ' z-push-banner-on' : ''}`}>
      <span style={{ fontSize: 20 }} aria-hidden>
        {state === 'on' ? '🔔' : '📲'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 'var(--z-fs-sm)' }}>
          {state === 'on' ? 'Push включены на этом устройстве' : 'Включить push на этом устройстве'}
        </div>
        <div style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-xs)' }}>
          {state === 'on'
            ? 'Приходят, даже когда вкладка закрыта. Можно выключить в любой момент.'
            : compact
              ? 'Узнавайте о лайках и рекордах, не открывая сайт.'
              : 'Узнавайте о лайках, ответах и побитых рекордах, не открывая сайт.'}
        </div>
        {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-xs)', marginTop: 4 }}>{error}</div>}
      </div>
      <button
        onClick={toggle}
        disabled={busy}
        className={state === 'on' ? 'z-btn-ghost z-pop-on-active' : 'z-btn-accent z-pop-on-active'}
        style={{ flexShrink: 0, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? '…' : state === 'on' ? 'Выключить' : 'Включить'}
      </button>
    </div>
  );
}

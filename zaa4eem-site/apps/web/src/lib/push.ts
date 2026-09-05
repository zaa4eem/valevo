import type { PushPublicKey } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';

/** VAPID keys arrive base64url-encoded; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** null when the deployment has no VAPID keys — the toggle then hides itself rather than failing on tap. */
export async function fetchPushPublicKey(): Promise<string | null> {
  try {
    const res = await api.get<PushPublicKey>('/notifications/push/public-key');
    return res.publicKey;
  } catch {
    return null;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Asks for permission and registers with the server. Throws a Russian message
 * on the two failures worth telling the user about — a hard "denied" (which
 * only browser settings can undo) and everything else.
 */
export async function enablePush(publicKey: string): Promise<void> {
  if (!isPushSupported()) throw new Error('Браузер не поддерживает push-уведомления');

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    throw new Error('Уведомления заблокированы в настройках браузера');
  }
  if (permission !== 'granted') {
    throw new Error('Разрешение не выдано');
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  // A key rotation invalidates old subscriptions; dropping and re-subscribing
  // is the only way back, and is harmless when the key hasn't changed.
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  if (!json.endpoint || !json.keys) throw new Error('Не удалось оформить подписку');

  await api.post('/notifications/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush(): Promise<void> {
  const subscription = await getExistingSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  // Best effort: a row the browser has already dropped is harmless, and the
  // server prunes it anyway the first time the push service answers 404/410.
  await api.delete('/notifications/push/subscribe', { endpoint }).catch(() => undefined);
}

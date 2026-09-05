// Minimal typed wrapper around the Telegram Mini App JS SDK
// (https://core.telegram.org/bots/webapps#initializing-mini-apps).
// Loaded via <script src="https://telegram.org/js/telegram-web-app.js">
// in the root layout (see app/layout.tsx).

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: Record<string, unknown>;
  /** 'ios' | 'android' | 'tdesktop' | … inside a real Mini App; literally 'unknown' in a plain browser tab. */
  platform?: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * Synchronous "are we actually inside Telegram?" check — the whole point is
 * that it never waits.
 *
 * The SDK script defines window.Telegram.WebApp on *any* page, so its mere
 * existence proves nothing: a plain browser tab gets the same object with an
 * empty initData and platform 'unknown'. The old code coped by polling for
 * initData 5 × 200 ms before giving up, which cost every non-Telegram
 * visitor up to a full second of blank screen on first load.
 *
 * Telegram always appends its launch parameters to the URL fragment
 * (#tgWebAppData=…&tgWebAppPlatform=…) — that's exactly where the SDK itself
 * reads them from, and it's there before any script runs. Checking the
 * fragment plus the SDK's own already-populated fields answers the question
 * immediately, with the polling kept only for the case where we know we're
 * in Telegram and are just waiting for the SDK file to arrive.
 */
export function isTelegramLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  const app = window.Telegram?.WebApp;
  if (app?.initData) return true;
  if (app?.platform && app.platform !== 'unknown') return true;
  return window.location.hash.includes('tgWebApp');
}

/** Resolves as soon as Telegram's initData is available, or null once the budget runs out. Only ever called when isTelegramLaunch() already said yes. */
export async function waitForTelegramInitData(timeoutMs = 3000, stepMs = 100): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const initData = getTelegramWebApp()?.initData;
    if (initData) return initData;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

/** No-op outside Telegram (getTelegramWebApp() returns null there) — safe to call unconditionally on any tap/like/vote/follow action. */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotify(type: 'success' | 'error' | 'warning') {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred(type);
}

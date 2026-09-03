// Minimal typed wrapper around the Telegram Mini App JS SDK
// (https://core.telegram.org/bots/webapps#initializing-mini-apps).
// Loaded via <script src="https://telegram.org/js/telegram-web-app.js">
// in the root layout (see app/layout.tsx).

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: Record<string, unknown>;
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

/** No-op outside Telegram (getTelegramWebApp() returns null there) — safe to call unconditionally on any tap/like/vote/follow action. */
export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotify(type: 'success' | 'error' | 'warning') {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred(type);
}

'use client';

import { useEffect, useRef } from 'react';

interface Props {
  botUsername: string;
  onAuth: (data: Record<string, string | number>) => void;
}

declare global {
  interface Window {
    __zaa4eemTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}

/**
 * Classic Telegram Login Widget for the plain-browser login page.
 * (Inside the Mini App itself, auth is automatic via initData — see
 * lib/auth-context.tsx — this widget is only rendered outside Telegram.)
 */
export function TelegramLoginWidget({ botUsername, onAuth }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.__zaa4eemTelegramAuth = onAuth;

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-onauth', '__zaa4eemTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');

    containerRef.current?.appendChild(script);

    return () => {
      delete window.__zaa4eemTelegramAuth;
    };
  }, [botUsername, onAuth]);

  return <div ref={containerRef} />;
}

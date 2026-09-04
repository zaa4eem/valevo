'use client';

import { useEffect, useRef } from 'react';

interface Props {
  botUsername: string;
  authUrl: string;
}

/**
 * Classic Telegram Login Widget for the plain-browser login page, using the
 * redirect (`data-auth-url`) integration rather than the JS-callback one —
 * the callback mode round-trips through `window.opener` postMessage, which
 * some mobile browsers and in-app webviews block or mishandle, leaving the
 * confirmation popup stranded on an unrelated Telegram page with no way
 * back to the site. The redirect mode instead sends the browser straight to
 * `authUrl` with the signed user data as query params, which login/page.tsx
 * reads back on load.
 * (Inside the Mini App itself, auth is automatic via initData — see
 * lib/auth-context.tsx — this widget is only rendered outside Telegram.)
 */
export function TelegramLoginWidget({ botUsername, authUrl }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Clear first — otherwise React 19 dev-mode's double-invoked effects (or
    // any later re-run) would inject the widget's loader script twice.
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-auth-url', authUrl);
    script.setAttribute('data-request-access', 'write');

    containerRef.current.appendChild(script);
  }, [botUsername, authUrl]);

  return <div ref={containerRef} />;
}

'use client';

import { useEffect, useRef } from 'react';

interface Props {
  clientId: string;
  onCredential: (credential: string) => void;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, string>) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const SCRIPT_ID = 'zaa4eem-google-gsi';

/**
 * "Sign in with Google" button via Google Identity Services. It hands back
 * a signed ID token (`credential`, a JWT) — never trusted as-is; the server
 * verifies it against Google's own keys before issuing a session (see
 * AuthService.loginWithGoogle / GoogleAuthService).
 */
export function GoogleLoginButton({ clientId, onCredential }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !window.google || !containerRef.current) return;
      // Clear before (re-)rendering — otherwise React 19 dev-mode's
      // double-invoked effects (or any later re-run) would keep appending
      // another button into the same container.
      containerRef.current.innerHTML = '';
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        width: '320',
        locale: 'ru',
      });
    }

    if (window.google) {
      render();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);

    return () => {
      cancelled = true;
      script.removeEventListener('load', render);
    };
  }, [clientId, onCredential]);

  return <div ref={containerRef} />;
}

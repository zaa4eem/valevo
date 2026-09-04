'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Personal referral link landing page (zaa4eem.ru/r/CODE). Stashes the code
 * for the login page to pick up and pass along at registration — see
 * UsersService.attributeReferral for how it's actually redeemed server-side.
 */
export default function ReferralLandingPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    try {
      sessionStorage.setItem('zaa4eem_referral_code', params.code);
    } catch {
      // Private-browsing / storage-denied — registration still works, just without the referral credit.
    }
    router.replace('/login');
  }, [params.code, router]);

  return <p style={{ color: 'var(--z-text-muted)' }}>Переходим…</p>;
}

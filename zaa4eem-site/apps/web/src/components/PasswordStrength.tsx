'use client';

import { useEffect, useState } from 'react';
import { assessPassword, type PasswordCheckResult } from '@zaa4eem/shared';
import { api } from '@/lib/api-client';

const BAR_COLORS = ['var(--z-danger)', 'var(--z-danger)', 'var(--z-warning)', 'var(--z-accent)', 'var(--z-accent)'];

/**
 * Live strength meter plus a breach check.
 *
 * The score is computed locally on every keystroke so the meter never lags
 * the typing; the breach lookup is debounced and goes to the server, which
 * asks the breach corpus by hash prefix — the password itself never leaves
 * the browser except to our own API, and never leaves our API at all.
 */
export function PasswordStrength({ password }: { password: string }) {
  const [breach, setBreach] = useState<PasswordCheckResult['breachCount'] | 'pending'>(null);
  const local = assessPassword(password);

  useEffect(() => {
    if (password.length < 8) {
      setBreach(null);
      return;
    }
    let cancelled = false;
    setBreach('pending');
    const timer = setTimeout(async () => {
      try {
        const res = await api.post<PasswordCheckResult>('/security/password/check', { password });
        if (!cancelled) setBreach(res.breachCount);
      } catch {
        // Fail open: "не проверено" is honest, a green tick would not be.
        if (!cancelled) setBreach(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password]);

  if (!password) return null;

  const breached = typeof breach === 'number' && breach > 0;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="z-strength-bars" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="z-strength-bar"
            style={{ background: i < local.score ? BAR_COLORS[local.score] : 'var(--z-surface-hover)' }}
          />
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          fontSize: 'var(--z-fs-xs)',
          marginTop: 5,
        }}
      >
        <span style={{ color: BAR_COLORS[local.score], fontWeight: 700 }}>{local.label}</span>
        {local.advice && <span style={{ color: 'var(--z-text-muted)' }}>{local.advice}</span>}
      </div>

      {breached && (
        <div className="z-breach-warning">
          ⚠️ Этот пароль встречается в утечках ({breach!.toLocaleString('ru-RU')}{' '}
          {plural(breach as number, 'раз', 'раза', 'раз')}). Его уже перебирают — выберите другой.
        </div>
      )}
      {breach === 0 && (
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-accent)', marginTop: 6 }}>
          ✓ В известных утечках не найден
        </div>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

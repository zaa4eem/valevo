'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api-client';
import { useProgress } from '@/lib/progress-context';
import { Card } from './Card';

/**
 * The five-step newcomer checklist, shown at the top of the feed until the
 * reward is taken. It's the first thing a brand-new account sees, and every
 * step is a real action rather than a tour — the fastest way to turn a
 * visitor into someone with a reason to come back.
 */
export function OnboardingCard() {
  const { state, refresh } = useProgress();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state?.onboarding.active) return null;

  const { steps, completed } = state.onboarding;
  const doneCount = steps.filter((s) => s.done).length;

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/progress/onboarding/claim');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось получить награду');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="z-animate-in" style={{ marginBottom: 16, borderColor: 'var(--z-accent)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 'var(--z-fs-lg)' }}>
            {completed ? '🎁 Всё готово!' : '👋 Пять шагов для начала'}
          </div>
          <div style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)' }}>
            {completed
              ? 'Заберите 24 часа Premium — эффекты ника и рамки аватара.'
              : 'Пройдите их — и получите 24 часа Premium.'}
          </div>
        </div>
        <span
          className="z-notif-count-pill"
          style={{ marginLeft: 0, fontVariantNumeric: 'tabular-nums' }}
        >
          {doneCount} / {steps.length}
        </span>
      </div>

      <div className="z-onboarding-steps">
        {steps.map((step) =>
          step.done ? (
            <div key={step.code} className="z-onboarding-step z-onboarding-step-done">
              <span className="z-onboarding-check" aria-hidden>
                ✓
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{step.title}</span>
              </span>
            </div>
          ) : (
            <Link key={step.code} href={step.href} className="z-onboarding-step z-pop-on-active">
              <span className="z-onboarding-icon" aria-hidden>
                {step.icon}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{step.title}</span>
                <span style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-xs)' }}>
                  {step.hint}
                </span>
              </span>
              <span aria-hidden style={{ color: 'var(--z-text-faint)' }}>
                →
              </span>
            </Link>
          ),
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginTop: 10 }}>{error}</div>
      )}

      {completed && (
        <button
          onClick={claim}
          disabled={busy}
          className="z-btn-accent z-pop-on-active"
          style={{ marginTop: 12, width: '100%', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Получаем…' : '🎁 Забрать 24 часа Premium'}
        </button>
      )}
    </Card>
  );
}

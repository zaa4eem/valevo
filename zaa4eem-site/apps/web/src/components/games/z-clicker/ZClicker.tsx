'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClickerState } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';

const FLUSH_INTERVAL_MS = 500;
const MAX_CLICKS_PER_FLUSH = 50;

/**
 * Click-to-earn Z-Coins. No offline/idle production by design — clickPower
 * (raised by repeatable upgrades) only affects how much a manual tap is
 * worth. Taps are batched client-side and flushed to the server on a fixed
 * interval rather than one request per tap, so rapid tapping stays smooth;
 * the server is still the one authoritative source for the balance and the
 * daily cap (ClickerService), this is purely a responsiveness optimization.
 */
export function ZClicker() {
  const [state, setState] = useState<ClickerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [pop, setPop] = useState(false);
  const pendingRef = useRef(0);
  const flushingRef = useRef(false);

  useEffect(() => {
    api.get<ClickerState>('/clicker/state').then(setState, () => setError('Не удалось загрузить состояние.'));
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current || pendingRef.current <= 0) return;
    const count = Math.min(pendingRef.current, MAX_CLICKS_PER_FLUSH);
    pendingRef.current -= count;
    flushingRef.current = true;
    try {
      const res = await api.post<ClickerState & { awarded: number; capped: boolean }>('/clicker/click', { count });
      setState(res);
    } catch {
      // Keep the taps queued — they'll ride along with the next flush instead
      // of being silently lost to one failed request.
      pendingRef.current += count;
    } finally {
      flushingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    // Best-effort: send whatever's still queued if the player navigates away.
    return () => {
      clearInterval(interval);
      if (pendingRef.current > 0) flush();
    };
  }, [flush]);

  function onTap() {
    pendingRef.current += 1;
    setPop(true);
    setTimeout(() => setPop(false), 120);
    // Optimistic bump so the counter feels instant; the next flush corrects
    // it (including clamping to the daily cap) a moment later.
    setState((s) => (s ? { ...s, zCoins: s.zCoins + s.clickPower } : s));
  }

  async function onUpgrade() {
    if (!state || upgrading) return;
    setUpgrading(true);
    setError(null);
    try {
      const res = await api.post<ClickerState>('/clicker/upgrade');
      setState(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось купить улучшение');
    } finally {
      setUpgrading(false);
    }
  }

  if (error && !state) return <p style={{ color: 'var(--z-danger)' }}>{error}</p>;
  if (!state) return <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>;

  const capReached = state.coinsEarnedToday >= state.dailyCap;
  const canAffordUpgrade = state.zCoins >= state.nextUpgradeCost;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Z-Коины
        </div>
        <div style={{ fontSize: 'var(--z-fs-3xl)', fontWeight: 900, color: 'var(--z-accent)', fontVariantNumeric: 'tabular-nums' }}>
          {state.zCoins.toLocaleString('ru-RU')}
        </div>
      </div>

      <button
        onClick={onTap}
        disabled={capReached}
        className="z-pop-on-active"
        style={{
          width: 180,
          height: 180,
          borderRadius: '50%',
          border: 'none',
          background: capReached ? 'var(--z-border)' : 'var(--z-accent)',
          color: capReached ? 'var(--z-text-faint)' : 'var(--z-accent-text-on, #04150a)',
          fontSize: 56,
          fontWeight: 900,
          cursor: capReached ? 'not-allowed' : 'pointer',
          transform: pop ? 'scale(0.94)' : 'scale(1)',
          transition: 'transform 0.1s ease',
          boxShadow: capReached ? 'none' : '0 12px 32px rgba(74, 222, 128, 0.35)',
        }}
      >
        {capReached ? '✋' : '🟢'}
      </button>

      <div style={{ width: '100%', maxWidth: 320 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)', marginBottom: 6 }}>
          <span>Сегодня</span>
          <span>
            {state.coinsEarnedToday.toLocaleString('ru-RU')} / {state.dailyCap.toLocaleString('ru-RU')}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--z-border)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, (state.coinsEarnedToday / state.dailyCap) * 100)}%`,
              background: 'var(--z-accent)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        {capReached && (
          <p style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', textAlign: 'center', marginTop: 8 }}>
            Дневной лимит набран — заходи завтра.
          </p>
        )}
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 320,
          background: 'var(--z-bg-elevated)',
          border: '1px solid var(--z-border)',
          borderRadius: 'var(--z-radius-md)',
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>Сила клика: {state.clickPower}</div>
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>
            +1 за апгрейд · следующий: {state.nextUpgradeCost.toLocaleString('ru-RU')} Z
          </div>
        </div>
        <button
          onClick={onUpgrade}
          disabled={upgrading || !canAffordUpgrade}
          className="z-btn-accent z-pop-on-active"
          style={{ flexShrink: 0, opacity: canAffordUpgrade ? 1 : 0.5 }}
        >
          {upgrading ? '…' : 'Улучшить'}
        </button>
      </div>

      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)' }}>{error}</div>}
    </div>
  );
}

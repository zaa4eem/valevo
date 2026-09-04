'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ClickerState } from '@zaa4eem/shared';
import { PREMIUM_SHOP_PRICE } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ReferralCard({ state }: { state: ClickerState }) {
  const [copied, setCopied] = useState<'tg' | 'web' | null>(null);
  const telegramLink = TELEGRAM_BOT_USERNAME
    ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=ref_${state.referralCode}`
    : null;
  const webLink = `${SITE_URL}/r/${state.referralCode}`;

  async function copy(kind: 'tg' | 'web', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access denied — the link is still visible to copy by hand.
    }
  }

  return (
    <Card hover className="z-animate-in" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--z-radius-md)',
            background: 'var(--z-accent-soft)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 30,
            flexShrink: 0,
          }}
        >
          🤝
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--z-fs-lg)' }}>Пригласи друга</h2>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: '4px 0 0' }}>
            За первое приглашение — 24 часа Premium бесплатно.
          </p>
        </div>
      </div>

      {telegramLink && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            background: 'var(--z-bg-elevated)',
            border: '1px dashed var(--z-border)',
            borderRadius: 'var(--z-radius-sm)',
            padding: '8px 10px',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 'var(--z-fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {telegramLink.replace('https://', '')}
          </span>
          <button onClick={() => copy('tg', telegramLink)} className="z-btn-ghost z-pop-on-active" style={{ flexShrink: 0, padding: '4px 10px' }}>
            {copied === 'tg' ? '✓' : '📋'}
          </button>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          background: 'var(--z-bg-elevated)',
          border: '1px dashed var(--z-border)',
          borderRadius: 'var(--z-radius-sm)',
          padding: '8px 10px',
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 'var(--z-fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {webLink.replace(/^https?:\/\//, '')}
        </span>
        <button onClick={() => copy('web', webLink)} className="z-btn-ghost z-pop-on-active" style={{ flexShrink: 0, padding: '4px 10px' }}>
          {copied === 'web' ? '✓' : '📋'}
        </button>
      </div>

      <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
        Приглашено: <b style={{ color: 'var(--z-text)' }}>{state.referralCount}</b>
      </div>
    </Card>
  );
}

function PremiumShopItem({ state, onPurchased }: { state: ClickerState; onPurchased: (s: ClickerState) => void }) {
  const [buying, setBuying] = useState(false);
  const [tryingFree, setTryingFree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = Math.max(0, PREMIUM_SHOP_PRICE - state.zCoins);
  const canAfford = missing === 0;
  const isPermanent = state.isPremium && !state.premiumUntil;

  async function buy() {
    setBuying(true);
    setError(null);
    try {
      await api.post('/shop/premium');
      const state2 = await api.get<ClickerState>('/clicker/state');
      onPurchased(state2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось купить Premium');
    } finally {
      setBuying(false);
    }
  }

  async function tryFree() {
    setTryingFree(true);
    setError(null);
    try {
      const res = await api.post<{ granted: boolean }>('/shop/trial');
      if (res.granted) {
        const state2 = await api.get<ClickerState>('/clicker/state');
        onPurchased(state2);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось включить пробный период');
    } finally {
      setTryingFree(false);
    }
  }

  return (
    <Card hover className="z-animate-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--z-radius-md)',
            background: 'var(--z-accent-soft)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 30,
            flexShrink: 0,
          }}
        >
          👑
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--z-fs-lg)' }}>Premium</h2>
          <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', margin: '4px 0 0' }}>
            Цветное имя, кольцо вокруг аватара и эмодзи-бейдж рядом с ником — настраивается в Настройках.
          </p>
        </div>
      </div>

      {state.isPremium && (
        <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-accent)', marginTop: 12 }}>
          {isPermanent ? 'Активен навсегда' : `Активен до ${formatDate(state.premiumUntil!)}`}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 'var(--z-fs-xl)', color: 'var(--z-accent)', fontVariantNumeric: 'tabular-nums' }}>
            {PREMIUM_SHOP_PRICE.toLocaleString('ru-RU')} Z
          </div>
          <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)' }}>за 1 месяц</div>
        </div>

        {isPermanent ? (
          <Link href="/settings" className="z-btn-accent z-pop-on-active">
            Настроить вид
          </Link>
        ) : canAfford ? (
          <button onClick={buy} disabled={buying} className="z-btn-accent z-pop-on-active">
            {buying ? '…' : state.isPremium ? 'Продлить на месяц' : 'Купить'}
          </button>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <button disabled className="z-btn-accent" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
              {state.isPremium ? 'Продлить на месяц' : 'Купить'}
            </button>
            <div style={{ fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-faint)', marginTop: 4 }}>
              Не хватает {missing.toLocaleString('ru-RU')} Z ·{' '}
              <Link href="/games/z-clicker" style={{ color: 'var(--z-accent)' }}>
                копить в Z-Кликере
              </Link>
            </div>
          </div>
        )}
      </div>

      {!state.isPremium && !state.usedTrialPremium && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--z-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>
            Не уверен? Попробуй бесплатно 24 часа.
          </div>
          <button onClick={tryFree} disabled={tryingFree} className="z-btn-ghost z-pop-on-active">
            {tryingFree ? '…' : 'Попробовать бесплатно'}
          </button>
        </div>
      )}

      {error && <div style={{ color: 'var(--z-danger)', fontSize: 'var(--z-fs-sm)', marginTop: 12 }}>{error}</div>}
    </Card>
  );
}

export default function ShopPage() {
  const { user } = useAuth();
  const [state, setState] = useState<ClickerState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get<ClickerState>('/clicker/state').then(setState, () => setError(true));
  }, [user]);

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 'var(--z-fs-2xl)', fontWeight: 900, marginBottom: 4 }}>🛒 Магазин</h1>
      <p style={{ color: 'var(--z-text-muted)', fontSize: 'var(--z-fs-sm)', marginTop: 0, marginBottom: 20 }}>
        Трать Z-коины, заработанные в{' '}
        <Link href="/games/z-clicker" style={{ color: 'var(--z-accent)' }}>
          Z-Кликере
        </Link>
        .
      </p>

      {!user ? (
        <Card className="z-animate-in">
          <p style={{ color: 'var(--z-text-muted)', margin: 0, textAlign: 'center', padding: '12px 0' }}>
            Войдите, чтобы делать покупки.
          </p>
        </Card>
      ) : error ? (
        <p style={{ color: 'var(--z-danger)' }}>Не удалось загрузить магазин.</p>
      ) : !state ? (
        <p style={{ color: 'var(--z-text-muted)' }}>Загрузка…</p>
      ) : (
        <>
          <ReferralCard state={state} />
          <PremiumShopItem state={state} onPurchased={setState} />
        </>
      )}
    </div>
  );
}

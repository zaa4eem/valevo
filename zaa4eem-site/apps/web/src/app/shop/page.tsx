'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ClickerState } from '@zaa4eem/shared';
import { PREMIUM_SHOP_PRICE } from '@zaa4eem/shared';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/Card';

function PremiumShopItem({ state, onPurchased }: { state: ClickerState; onPurchased: (s: ClickerState) => void }) {
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = Math.max(0, PREMIUM_SHOP_PRICE - state.zCoins);
  const canAfford = missing === 0;

  async function buy() {
    setBuying(true);
    setError(null);
    try {
      await api.post('/shop/premium');
      onPurchased({ ...state, zCoins: state.zCoins - PREMIUM_SHOP_PRICE, isPremium: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось купить Premium');
    } finally {
      setBuying(false);
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
        <div style={{ fontWeight: 900, fontSize: 'var(--z-fs-xl)', color: 'var(--z-accent)', fontVariantNumeric: 'tabular-nums' }}>
          {PREMIUM_SHOP_PRICE.toLocaleString('ru-RU')} Z
        </div>

        {state.isPremium ? (
          <Link href="/settings" className="z-btn-accent z-pop-on-active">
            Уже куплено — настроить вид
          </Link>
        ) : canAfford ? (
          <button onClick={buy} disabled={buying} className="z-btn-accent z-pop-on-active">
            {buying ? '…' : 'Купить'}
          </button>
        ) : (
          <div style={{ textAlign: 'right' }}>
            <button disabled className="z-btn-accent" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
              Купить
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
        <PremiumShopItem state={state} onPurchased={setState} />
      )}
    </div>
  );
}

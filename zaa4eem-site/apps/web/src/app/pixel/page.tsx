'use client';

import { PIXEL_COOLDOWN_MS, PIXEL_COOLDOWN_PREMIUM_MS } from '@zaa4eem/shared';
import { Card } from '@/components/Card';
import { PixelBattle } from '@/components/pixel/PixelBattle';

const COOLDOWN_MIN = Math.round(PIXEL_COOLDOWN_MS / 60_000);
const PREMIUM_COOLDOWN_MIN = Math.round(PIXEL_COOLDOWN_PREMIUM_MS / 60_000);

export default function PixelBattlePage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Card
        className="z-animate-in"
        style={{
          marginBottom: 16,
          background: 'linear-gradient(135deg, var(--z-surface) 0%, var(--z-accent-soft) 140%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 'var(--z-fs-xs)',
            color: 'var(--z-accent)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 6,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--z-accent)',
              boxShadow: '0 0 0 4px var(--z-accent-soft)',
            }}
          />
          Общий холст
        </div>
        <h1 style={{ fontSize: 'var(--z-fs-3xl)', margin: 0, fontWeight: 900, lineHeight: 1.05 }}>
          Pixel <span className="z-accent-text">Battle</span>
        </h1>
        <p style={{ color: 'var(--z-text-muted)', margin: '8px 0 0', fontSize: 'var(--z-fs-sm)' }}>
          Один пиксель раз в {COOLDOWN_MIN} минут, один холст на всех. В одиночку тут не
          нарисуешь ничего — а вдвоём уже можно. С Premium ждать {PREMIUM_COOLDOWN_MIN} минут.
        </p>
      </Card>

      <Card className="z-animate-in" style={{ animationDelay: '60ms' }}>
        <PixelBattle />
      </Card>
    </div>
  );
}

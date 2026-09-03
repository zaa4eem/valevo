'use client';

import { useState } from 'react';

export interface StatusBarDatum {
  key: string;
  label: string;
  value: number;
  /** Any valid CSS color value — usually a `var(--z-*)` token or a `color-mix()` step of one. */
  color: string;
}

/**
 * Horizontal bar chart for a small set of named categories (ideas by status).
 * Every bar carries a persistent text label and a persistent numeric value,
 * so identity is never color-alone and no separate legend/table is needed.
 */
export function StatusBarChart({ data }: { data: StatusBarDatum[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        const width = d.value > 0 ? Math.max(pct, 2.5) : 0;
        return (
          <div
            key={d.key}
            onPointerEnter={() => setHoverKey(d.key)}
            onPointerLeave={() => setHoverKey((k) => (k === d.key ? null : k))}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(96px, 150px) 1fr 34px',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)' }}>{d.label}</span>
            <div
              title={`${d.label}: ${d.value}`}
              style={{
                position: 'relative',
                height: 18,
                borderRadius: 4,
                background: 'var(--z-bg-elevated)',
                border: '1px solid var(--z-border)',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${width}%`,
                  background: d.color,
                  borderRadius: '0 4px 4px 0',
                  opacity: hoverKey && hoverKey !== d.key ? 0.6 : 1,
                  transition: 'width 0.3s ease, opacity 0.15s ease',
                }}
              />
            </div>
            <span
              style={{
                fontSize: 'var(--z-fs-sm)',
                fontWeight: 700,
                color: 'var(--z-text)',
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {d.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

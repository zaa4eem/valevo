'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';
import { useMemo, useState } from 'react';

export interface TrendSeries {
  key: string;
  label: string;
  /** Any valid CSS color value — usually a `var(--z-*)` design token. */
  color: string;
}

interface TrendChartProps {
  /** Ascending ISO `yyyy-mm-dd` dates, one per data point. */
  dates: string[];
  series: TrendSeries[];
  /** series.key -> values aligned 1:1 with `dates`. */
  values: Record<string, number[]>;
  height?: number;
  /** Area wash under the line — only sensible for a single series. */
  areaFill?: boolean;
  /** Renders a plain HTML table with the same data behind a toggle, so every
   *  value stays reachable without pointing at the chart. */
  showTable?: boolean;
}

const WIDTH = 720;

function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const frac = rough / base;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * base;
}

function computeTicks(maxValue: number, tickCount = 4) {
  const safeMax = Math.max(maxValue, 1);
  const step = niceStep(safeMax / tickCount);
  return { max: step * tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i * step) };
}

function formatDayLabel(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

/** A small line/area trend chart with a hover crosshair, drawn in inline SVG
 * against the site's `--z-*` design tokens so it renders correctly in both
 * themes with no chart library. */
export function TrendChart({ dates, series, values, height = 220, areaFill = false, showTable = true }: TrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const n = dates.length;

  const maxRaw = useMemo(() => {
    let m = 0;
    for (const s of series) {
      for (const v of values[s.key] ?? []) m = Math.max(m, v);
    }
    return m;
  }, [series, values]);

  const { max, ticks } = computeTicks(maxRaw);

  const padding = { top: 12, right: 14, bottom: 26, left: 34 };
  const plotW = WIDTH - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xAt = (i: number) => padding.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => padding.top + plotH - (max === 0 ? 0 : (v / max) * plotH);

  function linePath(key: string) {
    const vals = values[key] ?? [];
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' ');
  }

  function areaPath(key: string) {
    const vals = values[key] ?? [];
    if (vals.length === 0) return '';
    const top = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' ');
    const base = yAt(0);
    return `${top} L ${xAt(vals.length - 1).toFixed(2)} ${base.toFixed(2)} L ${xAt(0).toFixed(2)} ${base.toFixed(2)} Z`;
  }

  function handlePointerMove(e: ReactPointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
    setHoverIndex(idx);
  }

  const xLabelIdxs = n > 1 ? Array.from(new Set([0, Math.floor((n - 1) / 2), n - 1])) : [0];
  const tooltipLeftPct = hoverIndex !== null ? (xAt(hoverIndex) / WIDTH) * 100 : 0;

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={series.map((s) => s.label).join(', ')}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padding.left}
                x2={WIDTH - padding.right}
                y1={yAt(t)}
                y2={yAt(t)}
                style={{ stroke: 'var(--z-border)' }}
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={yAt(t)}
                textAnchor="end"
                dominantBaseline="middle"
                style={{ fill: 'var(--z-text-faint)', fontSize: 11 }}
              >
                {t.toLocaleString('ru-RU')}
              </text>
            </g>
          ))}

          <line
            x1={padding.left}
            x2={WIDTH - padding.right}
            y1={yAt(0)}
            y2={yAt(0)}
            style={{ stroke: 'var(--z-text-faint)' }}
            strokeWidth={1}
          />

          {xLabelIdxs.map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              style={{ fill: 'var(--z-text-faint)', fontSize: 11 }}
            >
              {formatDayLabel(dates[i])}
            </text>
          ))}

          {areaFill &&
            series.map((s) => (
              <path key={`area-${s.key}`} d={areaPath(s.key)} style={{ fill: s.color, opacity: 0.1 }} stroke="none" />
            ))}

          {series.map((s) => (
            <path
              key={`line-${s.key}`}
              d={linePath(s.key)}
              fill="none"
              style={{ stroke: s.color }}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {series.map((s) => {
            const vals = values[s.key] ?? [];
            if (vals.length === 0) return null;
            const lastI = vals.length - 1;
            const lastV = vals[lastI];
            return (
              <g key={`end-${s.key}`}>
                <circle
                  cx={xAt(lastI)}
                  cy={yAt(lastV)}
                  r={5}
                  style={{ fill: s.color, stroke: 'var(--z-surface)' }}
                  strokeWidth={2}
                />
                {series.length === 1 && (
                  <text
                    x={xAt(lastI)}
                    y={yAt(lastV) - 10}
                    textAnchor="end"
                    style={{ fill: 'var(--z-text)', fontSize: 12, fontWeight: 700 }}
                  >
                    {lastV.toLocaleString('ru-RU')}
                  </text>
                )}
              </g>
            );
          })}

          {hoverIndex !== null && (
            <g pointerEvents="none">
              <line
                x1={xAt(hoverIndex)}
                x2={xAt(hoverIndex)}
                y1={padding.top}
                y2={height - padding.bottom}
                style={{ stroke: 'var(--z-text-faint)' }}
                strokeWidth={1}
              />
              {series.map((s) => {
                const v = (values[s.key] ?? [])[hoverIndex];
                if (v === undefined) return null;
                return (
                  <circle
                    key={`hover-${s.key}`}
                    cx={xAt(hoverIndex)}
                    cy={yAt(v)}
                    r={5}
                    style={{ fill: s.color, stroke: 'var(--z-surface)' }}
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          )}

          <rect
            x={padding.left}
            y={padding.top}
            width={Math.max(plotW, 1)}
            height={Math.max(plotH, 1)}
            fill="transparent"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
            style={{ cursor: 'crosshair' }}
          />
        </svg>

        {hoverIndex !== null && (
          <div
            role="status"
            style={{
              position: 'absolute',
              left: `${tooltipLeftPct}%`,
              top: 4,
              transform: `translateX(${tooltipLeftPct > 55 ? '-104%' : '4%'})`,
              background: 'var(--z-bg-elevated)',
              border: '1px solid var(--z-border)',
              borderRadius: 'var(--z-radius-sm)',
              padding: '8px 10px',
              fontSize: 'var(--z-fs-xs)',
              pointerEvents: 'none',
              boxShadow: 'var(--z-shadow-card)',
              minWidth: 130,
              zIndex: 5,
            }}
          >
            <div style={{ color: 'var(--z-text-muted)', marginBottom: 4 }}>{formatDayLabel(dates[hoverIndex])}</div>
            {series.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span style={{ display: 'inline-block', width: 12, height: 2, background: s.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: 'var(--z-text)' }}>
                  {((values[s.key] ?? [])[hoverIndex] ?? 0).toLocaleString('ru-RU')}
                </span>
                <span style={{ color: 'var(--z-text-muted)' }}>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
          {series.map((s) => (
            <div
              key={s.key}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)' }}
            >
              <span style={{ display: 'inline-block', width: 12, height: 2, background: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      )}

      {showTable && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--z-fs-xs)', color: 'var(--z-text-muted)' }}>
            Показать таблицей
          </summary>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--z-fs-xs)' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--z-text-muted)', borderBottom: '1px solid var(--z-border)' }}>
                    Дата
                  </th>
                  {series.map((s) => (
                    <th
                      key={s.key}
                      style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--z-text-muted)', borderBottom: '1px solid var(--z-border)' }}
                    >
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dates.map((d, i) => (
                  <tr key={d}>
                    <td style={{ padding: '4px 8px', color: 'var(--z-text-muted)' }}>{formatDayLabel(d)}</td>
                    {series.map((s) => (
                      <td key={s.key} style={{ textAlign: 'right', padding: '4px 8px', fontVariantNumeric: 'tabular-nums', color: 'var(--z-text)' }}>
                        {(values[s.key] ?? [])[i] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

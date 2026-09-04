import type { CSSProperties } from 'react';
import type { PremiumFields } from '@zaa4eem/shared';
import '@/styles/premium.css';

type PremiumNameProps = Pick<PremiumFields, 'isPremium' | 'nameStyle' | 'nameColor' | 'nameFont' | 'badgeEmoji'>;

const FONT_CLASS: Record<string, string> = {
  SPACE: 'pfont-space',
  SERIF: 'pfont-serif',
  PIXEL: 'pfont-pixel',
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Renders a display name with the owner-granted Premium nickname effect (if any) plus its badge emoji. */
export function PremiumName({
  name,
  premium,
  style,
}: {
  name: string;
  premium?: PremiumNameProps | null;
  style?: CSSProperties;
}) {
  const badge = premium?.isPremium && premium.badgeEmoji && (
    <span className="pemoji" style={{ marginLeft: 4 }} aria-hidden>
      {premium.badgeEmoji}
    </span>
  );

  // Font choice is independent of the animated/colored nameStyle — a
  // Premium user can pick a font with no color effect at all, or vice versa.
  const fontClass = premium?.isPremium && premium.nameFont ? FONT_CLASS[premium.nameFont] : '';

  if (!premium?.isPremium || !premium.nameStyle) {
    return (
      <span style={style}>
        <span className={fontClass}>{name}</span>
        {badge}
      </span>
    );
  }

  const styleClassName =
    premium.nameStyle === 'FLOW' ? 'pname-flow' : premium.nameStyle === 'HOLO' ? 'pname-holo' : 'pname-glow';

  const glowVars: CSSProperties | undefined =
    premium.nameStyle === 'GLOW' && premium.nameColor
      ? ({
          '--glow-color': premium.nameColor,
          '--glow-shadow': hexToRgba(premium.nameColor, 0.6),
        } as CSSProperties)
      : undefined;

  return (
    <span style={{ ...style, ...glowVars }}>
      <span className={`${styleClassName} ${fontClass}`.trim()}>{name}</span>
      {badge}
    </span>
  );
}

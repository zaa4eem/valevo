import { premiumBadgeEmojiValues } from '@zaa4eem/shared';
import { PremiumName } from './PremiumName';
import { PremiumAvatar } from './PremiumAvatar';

const NAME_STYLE_LABEL: Record<string, string> = {
  NONE: 'Без эффекта',
  FLOW: 'Переливающийся',
  HOLO: 'Голографический',
  GLOW: 'Свечение',
};

const RING_STYLE_LABEL: Record<string, string> = {
  NONE: 'Нет',
  SPIN: 'Вращение',
  PULSE: 'Пульсация',
};

export type PremiumStyleValue = {
  nameStyle: string; // 'NONE' | 'FLOW' | 'HOLO' | 'GLOW'
  nameColor: string;
  ringStyle: string; // 'NONE' | 'SPIN' | 'PULSE'
  badgeEmoji: string | null;
};

/**
 * Controlled picker for the four Premium cosmetic fields (name effect, glow
 * color, avatar ring, badge emoji), with a live preview — shared by the
 * owner's admin grant UI and a Premium user's own self-service picker in
 * Settings. Save/revoke/persistence stays with each caller.
 */
export function PremiumStyleFields({
  displayName,
  avatarUrl,
  value,
  onChange,
}: {
  displayName: string;
  avatarUrl?: string | null;
  value: PremiumStyleValue;
  onChange: (next: PremiumStyleValue) => void;
}) {
  const { nameStyle, nameColor, ringStyle, badgeEmoji } = value;

  const previewUser = {
    isPremium: true,
    nameStyle: nameStyle === 'NONE' ? null : (nameStyle as 'FLOW' | 'HOLO' | 'GLOW'),
    nameColor: nameStyle === 'GLOW' ? nameColor : null,
    ringStyle: ringStyle === 'NONE' ? null : (ringStyle as 'SPIN' | 'PULSE'),
    badgeEmoji,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PremiumAvatar name={displayName} avatarUrl={avatarUrl} size={36} premium={previewUser} />
        <PremiumName name={displayName} premium={previewUser} style={{ fontSize: 'var(--z-fs-md)' }} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
          Эффект ника
          <select
            className="z-input"
            value={nameStyle}
            onChange={(e) => onChange({ ...value, nameStyle: e.target.value })}
          >
            {Object.entries(NAME_STYLE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {nameStyle === 'GLOW' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
            Цвет свечения
            <input
              type="color"
              value={nameColor}
              onChange={(e) => onChange({ ...value, nameColor: e.target.value })}
              style={{ width: 60, height: 36, padding: 2, border: '1px solid var(--z-border)', borderRadius: 'var(--z-radius-sm)' }}
            />
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
          Рамка аватара
          <select
            className="z-input"
            value={ringStyle}
            onChange={(e) => onChange({ ...value, ringStyle: e.target.value })}
          >
            {Object.entries(RING_STYLE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--z-fs-xs)' }}>
          Эмодзи-значок
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="z-pop-on-active"
              onClick={() => onChange({ ...value, badgeEmoji: null })}
              title="Без значка"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--z-radius-sm)',
                border: `1px solid ${badgeEmoji === null ? 'var(--z-accent)' : 'var(--z-border)'}`,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 'var(--z-fs-xs)',
                color: 'var(--z-text-faint)',
              }}
            >
              ✕
            </button>
            {premiumBadgeEmojiValues.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="z-pop-on-active"
                onClick={() => onChange({ ...value, badgeEmoji: emoji })}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--z-radius-sm)',
                  border: `1px solid ${badgeEmoji === emoji ? 'var(--z-accent)' : 'var(--z-border)'}`,
                  background: badgeEmoji === emoji ? 'var(--z-accent-soft)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 16,
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

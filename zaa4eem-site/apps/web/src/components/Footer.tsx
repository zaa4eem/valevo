import Link from 'next/link';

const YEAR = new Date().getFullYear();

export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--z-border)', marginTop: 40 }}>
      <div
        className="z-container"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '20px 20px',
          fontSize: 'var(--z-fs-xs)',
          color: 'var(--z-text-faint)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <span>© {YEAR} ZAA4EEM</span>
          <Link href="/legal/privacy" style={{ color: 'var(--z-text-muted)' }}>
            Политика обработки персональных данных
          </Link>
          <Link href="/legal/terms" style={{ color: 'var(--z-text-muted)' }}>
            Пользовательское соглашение
          </Link>
          <span className="z-badge" title="Возрастное ограничение">
            12+
          </span>
        </div>
        <div>
          Оператор ПДн: Кнышов А. Е. ·{' '}
          <a href="mailto:Artemkn212@gmail.com" style={{ color: 'var(--z-text-muted)' }}>
            Artemkn212@gmail.com
          </a>
        </div>
      </div>
    </footer>
  );
}

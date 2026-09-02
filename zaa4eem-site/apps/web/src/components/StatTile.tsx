export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        background: 'var(--z-surface)',
        border: '1px solid var(--z-border)',
        borderRadius: 'var(--z-radius-md)',
        padding: '16px 18px',
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 'var(--z-fs-2xl)', fontWeight: 800, color: 'var(--z-accent)' }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--z-fs-sm)', color: 'var(--z-text-muted)', marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

export function Avatar({
  name,
  avatarUrl,
  size = 40,
  ring = false,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  ring?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--z-accent-soft)',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        color: 'var(--z-accent)',
        flexShrink: 0,
        overflow: 'hidden',
        boxShadow: ring ? '0 0 0 2px var(--z-bg), 0 0 0 4px var(--z-accent-soft)' : undefined,
        fontSize: size * 0.4,
      }}
    >
      {avatarUrl ? (
        // Intrinsic width/height (not just the CSS ones) so the browser
        // reserves the space before the file arrives — an avatar popping in
        // and shoving the name sideways is the most common source of layout
        // shift in the feed. loading="lazy" keeps avatars far down a long
        // list off the critical path.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
}

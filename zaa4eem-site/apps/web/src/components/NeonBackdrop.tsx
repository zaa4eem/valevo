'use client';

/**
 * A slow neon glow behind the whole page.
 *
 * Two blurred radial blobs drifting on a ~30-second cycle — long enough
 * that it never draws the eye, short enough that the page feels alive
 * rather than printed. Pure CSS on a fixed, pointer-events-none layer, so
 * it costs one compositor layer and nothing else: no canvas, no rAF, no
 * work at all when the tab is in the background.
 */
export function NeonBackdrop() {
  return (
    <div className="z-backdrop" aria-hidden>
      <span className="z-backdrop-blob z-backdrop-blob-a" />
      <span className="z-backdrop-blob z-backdrop-blob-b" />
    </div>
  );
}

import type { PaginatedPosts } from '@zaa4eem/shared';
import HomeFeedClient from './feed-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * How long one fetch of the public feed is reused for. The feed is identical
 * for every logged-out view, so a single API call serves everyone arriving in
 * the same few seconds and the HTML comes back with posts already in it
 * instead of an empty shell that then has to go ask the API.
 */
const FEED_TTL_SECONDS = 15;

/**
 * Rendered per request rather than baked at build time. As a fully static
 * page this got prerendered in CI — where the API generally isn't reachable
 * — so the very first visitor after a deploy was served an empty feed until
 * the first background revalidation caught up. The fetch below is still
 * cached, so "per request" costs a cache lookup, not an API round-trip.
 */
export const dynamic = 'force-dynamic';

async function fetchInitialFeed(): Promise<PaginatedPosts | null> {
  try {
    const res = await fetch(`${API_URL}/posts?sort=date`, {
      next: { revalidate: FEED_TTL_SECONDS },
      // No credentials on purpose: this render is shared between everyone,
      // so it must contain only what a logged-out visitor may see. The
      // client fills in the viewer's own likes/follows right after mount.
    });
    if (!res.ok) return null;
    return (await res.json()) as PaginatedPosts;
  } catch {
    // API asleep, wrong URL, network blip — fall through to the client-side
    // load rather than failing the whole page.
    return null;
  }
}

export default async function HomeFeedPage() {
  const initialPage = await fetchInitialFeed();
  return <HomeFeedClient initialPage={initialPage} />;
}

/*
 * state.js — tiny in-memory app state + a light memoizing cache for
 * rarely-changing reference data (booking config/places, disciplines...).
 * No persistence, no store framework: the whole app lives in one tab and
 * this is just plumbing to avoid re-fetching on every screen re-render.
 */

/** Bootstrap result from GET /api/me, shared across screens. */
export const appState = {
    me: null, // { registered, is_admin, profile } | null while loading
};

export function setMe(me) {
    appState.me = me;
}

export function updateProfile(patch) {
    if (!appState.me || !appState.me.profile) return;
    Object.assign(appState.me.profile, patch);
}

export function isAdmin() {
    return !!(appState.me && appState.me.is_admin);
}

/* ------------------------------------------------------------------ */
/* Memoizing cache for reference/config data                            */
/* ------------------------------------------------------------------ */

const store = new Map();

/**
 * cached('key', () => api.get('/api/...'), { ttlMs }) — runs `fetcher` once
 * and reuses the result while it's fresh. Only successful {ok:true} results
 * are cached, so a failed fetch is always retried on the next call.
 */
export async function cached(key, fetcher, { ttlMs = 0, force = false } = {}) {
    const hit = store.get(key);
    const fresh = hit && (!ttlMs || Date.now() - hit.at < ttlMs);
    if (!force && fresh) return hit.result;

    const result = await fetcher();
    if (result && result.ok) store.set(key, { result, at: Date.now() });
    return result;
}

export function invalidateCache(key) {
    if (key) store.delete(key);
    else store.clear();
}

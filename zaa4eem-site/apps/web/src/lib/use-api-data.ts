import { useEffect, useState } from 'react';
import { api } from './api-client';

/**
 * Fetch-on-mount with an explicit error state — plain `.then(setX)` with no
 * `.catch()` leaves the UI stuck on "Загрузка…" forever if the request
 * fails (wrong API URL, CORS, network blip, API down), with no way for the
 * user to tell a slow load from a broken one.
 */
export function useApiData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setError(false);
    api.get<T>(path).then(
      (result) => {
        if (!cancelled) setData(result);
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error };
}

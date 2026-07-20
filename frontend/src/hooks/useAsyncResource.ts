import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncResource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Small one-shot GET wrapper: {data, error, loading, reload}. Deliberately not a
 * React Query-style cache — the WS is already the primary source of truth for
 * devices/mission/anomalies, this only covers static/one-shot fetches.
 *
 * `loading` is derived (resolvedId !== the latest dispatched request id) rather than
 * set via a synchronous `setLoading(true)` at the top of the effect, so this never
 * trips `react-hooks/set-state-in-effect`.
 */
export function useAsyncResource<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [resolvedId, setResolvedId] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const requestIdRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    const id = ++requestIdRef.current;

    fetcherRef.current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setResolvedId(id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setResolvedId(id);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { data, error, loading: resolvedId !== requestIdRef.current, reload };
}

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { COINS, type CoinKey } from '../config';

/** ?coin=demo (default) or ?coin=main. */
export function useCoinKey(): CoinKey {
  const [params] = useSearchParams();
  return params.get('coin') === 'main' ? 'main' : 'demo';
}

export function useCoin() {
  return COINS[useCoinKey()];
}

/** A path that keeps the current ?coin= choice. */
export function useCoinLink() {
  const key = useCoinKey();
  return useCallback((path: string) => (key === 'main' ? `${path}?coin=main` : path), [key]);
}

/** Calls `load` now and every `ms`, paused while the tab is hidden. `refresh()` reloads at once. */
export function usePoll<T>(load: () => Promise<T>, ms: number | null, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const loadRef = useRef(load);
  loadRef.current = load;
  const gen = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++gen.current;
    try {
      const value = await loadRef.current();
      if (mine === gen.current) {
        setData(value);
        setError(undefined);
      }
      return value;
    } catch (e) {
      if (mine === gen.current) setError(e);
      return undefined;
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    void refresh();
    if (ms === null) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, ms);
    return () => {
      clearInterval(id);
      gen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh };
}

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const motionQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      motionQuery?.addEventListener('change', cb);
      return () => motionQuery?.removeEventListener('change', cb);
    },
    () => motionQuery?.matches ?? false,
    () => false,
  );
}

/** Wait helper that resolves at once when motion is reduced. */
export const pause = (ms: number, reduced: boolean) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

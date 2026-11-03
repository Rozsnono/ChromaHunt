import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ApiError } from './api-core';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  /** True while the first load (or a keyed reload) is in flight. */
  loading: boolean;
  /** True during pull-to-refresh style reloads. */
  refreshing: boolean;
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data: T | null;
  error: ApiError | null;
}

/**
 * Loads `path` (null skips) and reloads whenever the screen regains focus, so lists are fresh
 * after returning from a detail screen. Stale responses are ignored.
 */
export function useApi<T>(path: string | null): Resource<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [tick, setTick] = useState(0);
  const firstFocus = useRef(true);
  const key = path === null ? null : `${path}#${tick}`;

  useEffect(() => {
    if (path === null || key === null) return;
    let cancelled = false;
    api
      .request<T>(path)
      .then((data) => !cancelled && setSettled({ key, data, error: null }))
      .catch((e: unknown) => {
        if (!cancelled) setSettled((prev) => ({ key, data: prev?.data ?? null, error: e instanceof ApiError ? e : new ApiError('UNKNOWN', 0) }));
      });
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setTick((n) => n + 1);
    }, []),
  );

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const pending = key !== null && settled?.key !== key;
  return {
    data: settled?.data ?? null,
    error: settled?.key === key ? settled.error : null,
    loading: pending && settled === null,
    refreshing: pending && settled !== null,
    reload,
  };
}

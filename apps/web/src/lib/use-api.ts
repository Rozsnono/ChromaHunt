'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

interface Settled<T> {
  /** `path#tick` the result belongs to; a different current key means a request is in flight. */
  key: string;
  data: T | null;
  error: ApiError | null;
}

/** Loads `path` whenever it changes (pass null to skip). Stale responses are ignored. */
export function useApi<T>(path: string | null): Resource<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const key = path === null ? null : `${path}#${tick}`;

  useEffect(() => {
    if (path === null || key === null) return;
    const id = ++latest.current;
    api<T>(path)
      .then((data) => {
        if (id === latest.current) setSettled({ key, data, error: null });
      })
      .catch((e: unknown) => {
        if (id === latest.current) setSettled((prev) => ({ key, data: prev?.data ?? null, error: e instanceof ApiError ? e : new ApiError('INTERNAL_ERROR', 500) }));
      });
  }, [path, key]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return {
    data: settled?.data ?? null,
    error: settled?.key === key ? settled.error : null,
    loading: key !== null && settled?.key !== key,
    reload,
  };
}

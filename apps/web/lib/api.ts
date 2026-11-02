'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Session token for the Telegram Mini App lives only in memory (never localStorage).
// In the standalone web version the httpOnly cookie set by the API is used instead.
let memoryToken: string | null = null;
export function setToken(t: string | null) {
  memoryToken = t;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-solik-csrf': '1' };
  if (memoryToken) headers.authorization = `Bearer ${memoryToken}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    credentials: 'same-origin',
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = json.details as { path: string; message: string }[] | undefined;
    const msg = details?.length ? `${json.message}: ${details.map((d) => `${d.path} — ${d.message}`).join('; ')}` : json.message;
    throw new ApiError(res.status, msg || `Ошибка ${res.status}`, details);
  }
  return json as T;
}

/** Minimal data hook with loading / error / reload. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Polls while `active` (e.g. live auction, running broadcast). */
export function usePolling(fn: () => void, ms: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms, active]);
}

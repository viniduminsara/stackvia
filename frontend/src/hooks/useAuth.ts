import { useCallback, useEffect, useState } from 'react';

export type AuthStatus =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'login' }
  | { phase: 'authenticated'; username: string };

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    const err = new Error(body?.error ?? `Request failed with status ${response.status}`);
    (err as any).status = response.status;
    throw err;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>({ phase: 'loading' });

  const check = useCallback(async () => {
    setStatus({ phase: 'loading' });
    try {
      // First: does an admin account exist?
      const { setupRequired } = await fetchJson<{ setupRequired: boolean }>('/api/auth/status');
      if (setupRequired) {
        setStatus({ phase: 'setup' });
        return;
      }
      // Second: is the current browser session valid?
      const { username } = await fetchJson<{ username: string }>('/api/auth/me');
      setStatus({ phase: 'authenticated', username });
    } catch (err: any) {
      if (err?.status === 401) {
        setStatus({ phase: 'login' });
      } else {
        // Any other error (network down, server error) — show login and let
        // individual API calls surface the real error message.
        setStatus({ phase: 'login' });
      }
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const setup = useCallback(async (username: string, password: string) => {
    await fetchJson('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setStatus({ phase: 'authenticated', username });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await fetchJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setStatus({ phase: 'authenticated', username });
  }, []);

  const logout = useCallback(async () => {
    await fetchJson('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setStatus({ phase: 'login' });
  }, []);

  return { status, setup, login, logout, recheck: check };
}

/** Call this to globally redirect to login whenever an API call returns 401. */
export function handleUnauthorized(onLogout: () => void) {
  return (err: unknown) => {
    if (err instanceof Error && (err as any).status === 401) {
      onLogout();
    }
    throw err;
  };
}

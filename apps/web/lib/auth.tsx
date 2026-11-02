'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError, setToken } from './api';

export interface Me {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  role: 'USER' | 'ADMIN' | 'OWNER';
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready(): void;
        expand(): void;
        openInvoice?(url: string, cb?: (status: string) => void): void;
        openTelegramLink?(url: string): void;
        HapticFeedback?: { notificationOccurred(t: 'success' | 'error' | 'warning'): void };
        setHeaderColor?(c: string): void;
        setBackgroundColor?(c: string): void;
      };
    };
  }
}

interface AuthState {
  user: Me | null;
  platformBot: { username: string } | null;
  status: 'loading' | 'authed' | 'anon';
  inTelegram: boolean;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  loginWithWidget(data: Record<string, string | number>): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [platformBot, setPlatformBot] = useState<{ username: string } | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [inTelegram, setInTelegram] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: Me; platformBot: { username: string } | null }>('/api/me');
      setUser(me.user);
      setPlatformBot(me.platformBot);
      setStatus('authed');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setStatus('anon');
      else setStatus('anon');
    }
  }, []);

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (wa?.initData) {
      setInTelegram(true);
      wa.ready();
      wa.expand();
      const dark = (wa as { colorScheme?: string }).colorScheme === 'dark';
      document.documentElement.classList.toggle('dark', dark);
      wa.setHeaderColor?.(dark ? '#000000' : '#F5F5F7');
      wa.setBackgroundColor?.(dark ? '#000000' : '#F5F5F7');
      api<{ token: string; user: Me }>('/api/auth/telegram-webapp', { body: { initData: wa.initData } })
        .then((r) => {
          setToken(r.token);
          return refresh();
        })
        .catch(() => setStatus('anon'));
    } else {
      void refresh();
    }
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { body: {} }).catch(() => undefined);
    setToken(null);
    setUser(null);
    setStatus('anon');
  }, []);

  const loginWithWidget = useCallback(
    async (data: Record<string, string | number>) => {
      await api('/api/auth/telegram-login', { body: data });
      await refresh();
    },
    [refresh],
  );

  return <Ctx.Provider value={{ user, platformBot, status, inTelegram, logout, refresh, loginWithWidget }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Opens a Telegram Stars invoice: natively inside the Mini App, otherwise in a new tab. */
export function openInvoice(link: string, onPaid?: () => void) {
  const wa = window.Telegram?.WebApp;
  if (wa?.openInvoice) {
    wa.openInvoice(link, (status) => {
      if (status === 'paid') {
        wa.HapticFeedback?.notificationOccurred('success');
        onPaid?.();
      }
    });
  } else {
    window.open(link, '_blank', 'noopener');
  }
}

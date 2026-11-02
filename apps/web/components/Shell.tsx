'use client';

import { BarChart3, Bot, Gift, Hash, LayoutDashboard, LogOut, MessageSquareText, Settings, Shield, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/format';
import { Brand } from './Brand';
import { TabIcon } from './TabIcon';
import { Spinner } from './ui';

interface NavItem {
  href: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  lottie?: string; // Mirrows icon set in public/icons
}

const NAV: NavItem[] = [
  { href: '/', label: 'Главная', icon: LayoutDashboard, lottie: 'create' },
  { href: '/contests', label: 'Конкурсы', icon: Trophy, lottie: 'giveaway' },
  { href: '/sms', label: 'SMS Counter', short: 'SMS', icon: Hash },
  { href: '/gifts', label: 'Подарки', icon: Gift, lottie: 'gifts' },
  { href: '/bots', label: 'Мои боты', short: 'Боты', icon: Bot, lottie: 'profile' },
  { href: '/templates', label: 'Шаблоны', icon: MessageSquareText },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3 },
  { href: '/settings', label: 'Настройки', icon: Settings },
];
const MOBILE = ['/', '/contests', '/sms', '/gifts', '/bots'];

export function Shell({ children }: { children: React.ReactNode }) {
  const { status, user, logout, inTelegram } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const isLogin = path === '/login';

  useEffect(() => {
    if (status === 'anon' && !isLogin) router.replace('/login');
    if (status === 'authed' && isLogin) router.replace('/');
  }, [status, isLogin, router]);

  if (isLogin) return <>{children}<Toaster position="top-center" /></>;
  if (status !== 'authed') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  return (
    <div className="flex min-h-dvh">
      <aside className="glass sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line/[0.06] p-4 lg:flex">
        <div className="mb-8 px-2 pt-1">
          <Brand />
        </div>
        <nav className="flex-1 space-y-0.5">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn('flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] transition-colors', active(n.href) ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:bg-line/[0.04] hover:text-fg')}
            >
              <n.icon className="h-[18px] w-[18px]" />
              {n.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin" className={cn('mt-4 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] transition-colors', active('/admin') ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:text-fg')}>
              <Shield className="h-[18px] w-[18px]" />
              Админ-панель
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 rounded-2xl border border-line/[0.06] bg-surface p-2.5">
          {user?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoUrl} alt="" className="h-9 w-9 rounded-full" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">{(user?.firstName ?? 'U')[0]}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{user?.firstName}</div>
            <div className="truncate text-xs text-muted">{user?.username ? `@${user.username}` : user?.telegramId}</div>
          </div>
          {!inTelegram && (
            <button onClick={logout} title="Выйти" className="rounded-lg p-1.5 text-muted hover:bg-line/5 hover:text-fg">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 lg:hidden">
          <Brand compact />
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <Link href="/admin" aria-label="Админ-панель" className="flex h-9 w-9 items-center justify-center rounded-full border border-line/[0.06] bg-surface text-muted">
                <Shield className="h-[18px] w-[18px]" />
              </Link>
            )}
            <Link href="/settings" aria-label="Настройки" className="flex h-9 items-center gap-2 rounded-full border border-line/[0.06] bg-surface pl-1 pr-3 text-[13px] font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-white">{(user?.firstName ?? 'U')[0]}</span>
              {user?.firstName}
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-4 md:px-8 lg:pb-12 lg:pt-10">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line/[0.08] bg-bg/[0.88] pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur-[14px] backdrop-saturate-150 lg:hidden">
        {NAV.filter((n) => MOBILE.includes(n.href)).map((n) => {
          const on = active(n.href);
          return (
            <Link key={n.href} href={n.href} className={cn('flex flex-col items-center gap-0.5 pb-1.5 pt-2 transition-[color,transform] active:scale-95', on ? 'tab-on text-accent' : 'text-muted')}>
              <span className={cn('rounded-[10px] transition-all', on ? 'bg-accent/10 shadow-[0_0_0_6px_rgb(var(--accent)/0.1)]' : 'opacity-70')}>
                <TabIcon name={n.lottie} active={on} fallback={n.icon} />
              </span>
              <span className="mt-1 text-[10px] font-semibold tracking-[-0.1px]">{n.short ?? n.label}</span>
            </Link>
          );
        })}
      </nav>
      <Toaster position="top-center" richColors />
    </div>
  );
}

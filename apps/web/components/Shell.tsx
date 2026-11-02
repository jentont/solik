'use client';

import { BarChart3, Bot, Gift, House, LogOut, MessageSquareMore, MessageSquareText, Settings, Shield, Trophy, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/format';
import { Brand } from './Brand';
import { Onboarding, ONBOARDED_KEY } from './Onboarding';
import { Branch, Snow } from './Winter';
import { Spinner } from './ui';

interface NavItem {
  href: string;
  label: string;
  short?: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Главная', icon: House },
  { href: '/contests', label: 'Конкурсы', icon: Trophy },
  { href: '/sms', label: 'SMS Counter', short: 'SMS', icon: MessageSquareMore },
  { href: '/gifts', label: 'Подарки', icon: Gift },
  { href: '/bots', label: 'Мои боты', short: 'Боты', icon: Bot },
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
  const [tour, setTour] = useState(false);

  // first launch: show the «how it works» tour once; any page can reopen it with the solik:tour event
  useEffect(() => {
    if (status !== 'authed') return;
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) setTour(true);
    } catch {
      /* storage blocked: skip the tour */
    }
    const open = () => setTour(true);
    window.addEventListener('solik:tour', open);
    return () => window.removeEventListener('solik:tour', open);
  }, [status]);

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
    <div className="no-select relative flex min-h-dvh">
      <Snow />
      <Branch side="tr" className="absolute right-[-10px] top-[58px] z-0 w-[118px] opacity-90 lg:top-0 lg:w-[220px]" />
      <aside className="glass sticky top-0 z-20 hidden h-dvh w-64 shrink-0 flex-col border-r border-line/[0.08] p-4 lg:flex">
        <div className="mb-8 px-2 pt-1">
          <Brand />
        </div>
        <nav className="flex-1 space-y-0.5">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn('flex items-center gap-3 rounded-2xl px-3 py-3 text-[16px] transition-colors', active(n.href) ? 'bg-white text-[#141416] font-semibold' : 'text-muted hover:bg-white/[0.06] hover:text-fg')}
            >
              <n.icon className="h-5 w-5" />
              {n.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin" className={cn('mt-4 flex items-center gap-3 rounded-2xl px-3 py-3 text-[16px] transition-colors', active('/admin') ? 'bg-white text-[#141416] font-semibold' : 'text-muted hover:text-fg')}>
              <Shield className="h-[18px] w-[18px]" />
              Админ-панель
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 rounded-2xl border border-line/[0.13] bg-white/[0.06] p-2.5">
          {user?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoUrl} alt="" className="h-9 w-9 rounded-full" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-[15px] font-bold text-accent">{(user?.firstName ?? 'U')[0]}</div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{user?.firstName}</div>
            <div className="truncate text-[13px] text-muted">{user?.username ? `@${user.username}` : user?.telegramId}</div>
          </div>
          {!inTelegram && (
            <button onClick={logout} title="Выйти" className="rounded-lg p-1.5 text-muted hover:bg-line/5 hover:text-fg">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.08)] lg:hidden">
          <Brand compact />
          <div className="flex items-center gap-1.5">
            {isAdmin && (
              <Link href="/admin" aria-label="Админ-панель" className="flex h-11 w-11 items-center justify-center rounded-full border border-line/[0.13] bg-white/[0.07] text-muted">
                <Shield className="h-5 w-5" />
              </Link>
            )}
            <Link href="/settings" aria-label="Настройки" className="flex h-11 items-center gap-2 rounded-full border border-line/[0.13] bg-white/[0.07] pl-1.5 pr-4 text-[15px] font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[14px] font-bold text-white">{(user?.firstName ?? 'U')[0]}</span>
              {user?.firstName}
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32 pt-5 md:px-8 lg:pb-12 lg:pt-10">{children}</main>
      </div>

      <TabBar items={NAV.filter((n) => MOBILE.includes(n.href))} active={active} />
      {tour && <Onboarding onClose={() => setTour(false)} />}
      <Toaster position="top-center" theme="dark" richColors />
    </div>
  );
}

/**
 * Endless tab carousel: the current section sits in the middle as a white pill with its name,
 * the others are icons on both sides. Swipe it left/right (it wraps around forever) or tap an icon:
 * whichever lands in the middle opens.
 */
const PILL = 132;
const ICON = 58;
const GAP = 4;
const STEP = ICON + GAP;
const SIDE = 3; // icons rendered on each side, enough to fill a phone width

function slotX(d: number) {
  if (d === 0) return 0;
  const off = PILL / 2 + GAP + (Math.abs(d) - 1) * STEP + ICON / 2;
  return d > 0 ? off : -off;
}

function TabBar({ items, active }: { items: NavItem[]; active: (href: string) => boolean }) {
  const router = useRouter();
  const n = items.length;
  const mod = (i: number) => ((i % n) + n) % n;
  const activeIdx = Math.max(0, items.findIndex((x) => active(x.href)));
  const [pos, setPos] = useState(activeIdx);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; moved: boolean } | null>(null);
  const swiped = useRef(false);

  // route changed elsewhere: rotate the shortest way so that section is centred
  useEffect(() => {
    setPos((p) => {
      if (mod(p) === activeIdx) return p;
      let delta = activeIdx - mod(p);
      if (delta > n / 2) delta -= n;
      if (delta < -n / 2) delta += n;
      return p + delta;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  const go = (p: number) => {
    setPos(p);
    const target = items[mod(p)]!;
    if (!active(target.href)) router.push(target.href);
  };

  const slots = [];
  for (let d = -SIDE; d <= SIDE; d++) slots.push(pos + d);

  return (
    <nav
      aria-label="Разделы"
      className="no-select fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),10px)] z-40 mx-auto max-w-[520px] touch-pan-y overflow-hidden rounded-[28px] border border-white/[0.13] bg-[rgba(26,26,30,0.84)] shadow-[0_18px_40px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-[18px] lg:hidden"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, moved: false };
        swiped.current = false;
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        if (Math.abs(dx) > 6) start.current.moved = true;
        if (start.current.moved) setDrag(dx);
      }}
      onPointerUp={() => {
        const s = start.current;
        start.current = null;
        if (!s?.moved) return;
        swiped.current = true;
        const steps = Math.round(-drag / STEP);
        setDrag(0);
        if (steps) go(pos + steps);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDrag(0);
      }}
    >
      <div
        className="relative h-[68px] [mask-image:linear-gradient(90deg,transparent,#000_18%,#000_82%,transparent)]"
        onClickCapture={(e) => {
          // a swipe must not also count as a tap on the icon under the finger
          if (swiped.current) e.stopPropagation();
        }}
      >
        {slots.map((abs) => {
          const d = abs - pos;
          const item = items[mod(abs)]!;
          const centre = d === 0;
          const x = slotX(d) + drag;
          const w = centre ? PILL : ICON;
          return (
            <button
              key={abs}
              type="button"
              aria-label={item.short ?? item.label}
              aria-current={centre && active(item.href) ? 'page' : undefined}
              onClick={() => go(abs)}
              className={cn(
                'absolute left-1/2 top-[6px] flex h-[56px] items-center justify-center gap-2 overflow-hidden rounded-[22px] active:scale-95',
                drag ? 'transition-none' : 'transition-[transform,width,background-color,color] duration-300 ease-[cubic-bezier(.34,1.3,.5,1)]',
                centre ? 'tab-on bg-white text-[#141416] shadow-[0_6px_18px_rgba(255,255,255,0.18)]' : 'text-muted hover:text-fg',
              )}
              style={{ width: w, transform: `translateX(${x - w / 2}px)` }}
            >
              <item.icon className="h-[23px] w-[23px] shrink-0" strokeWidth={centre ? 2.4 : 2} />
              {centre && <span className="whitespace-nowrap font-display text-[14px] font-extrabold">{item.short ?? item.label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

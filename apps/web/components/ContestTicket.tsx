'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CONTEST_TYPES, cn, fmtDate, fmtNum, timeLeft } from '@/lib/format';
import { GiftSticker, type GiftLike } from './GiftSticker';
import { TypeIcon } from './TypeIcon';
import { Stars } from './StarIcon';
import { StatusBadge } from './ui';

export interface TicketContest {
  id: string;
  type: string;
  status: string;
  title: string;
  chat?: { title: string } | null;
  channel?: { title: string } | null;
  bot: { username: string };
  prizes: { id: string; title: string; gift?: GiftLike | null }[];
  _count: { participants: number; winners: number };
  smsCounter?: { count: number; target: number } | null;
  endsAt?: string | null;
  createdAt: string;
  currentBid?: number | null;
  leaderName?: string | null;
}

function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

/** A contest drawn as a raffle ticket: stub with what it is, perforation, then the live numbers. */
export function ContestTicket({ c }: { c: TicketContest }) {
  const t = CONTEST_TYPES[c.type];
  const live = c.status === 'ACTIVE';
  const auction = c.type === 'STARS_AUCTION';
  useTick(live && !!c.endsAt);
  const urgent = live && c.endsAt && new Date(c.endsAt).getTime() - Date.now() < 60_000;
  const prize = c.prizes.map((p) => p.title).join(', ');
  // the stub shows the real prize when there is one, the mechanic otherwise
  const prizeGift = c.prizes.find((p) => p.gift)?.gift ?? (c.prizes[0] && /#\s*\d+$|-\d+$/.test(c.prizes[0].title) ? { name: c.prizes[0].title } : null);

  return (
    <Link href={`/contests/${c.id}`} className="ticket press block transition hover:brightness-110">
      {/* stub */}
      <div className="flex h-[76px] items-center gap-3 px-4">
        {prizeGift ? (
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-elevated">
            <GiftSticker gift={prizeGift} size={42} />
            <TypeIcon type={c.type} size={20} className="absolute -bottom-1 -right-1 rounded-[7px] ring-2 ring-surface" />
          </span>
        ) : (
          <TypeIcon type={c.type} size={48} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold leading-tight">{c.title}</div>
          <div className="mt-0.5 truncate text-[14px] text-muted">{c.chat?.title ?? c.channel?.title ?? `@${c.bot.username}`}</div>
        </div>
        {live ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-ribbon/40 bg-ribbon/15 px-2.5 py-1 font-display text-[12px] font-extrabold tracking-wide text-[#ff6b77]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4d5e] shadow-[0_0_8px_#ff4d5e]" />
            LIVE
          </span>
        ) : (
          <StatusBadge status={c.status} />
        )}
      </div>
      <div className="ticket-perf" />

      {/* body */}
      <div className="px-4 pb-4 pt-4">
        {auction && live ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className={cn('num font-display text-[40px] font-black leading-none tracking-[-0.03em]', urgent ? 'text-ribbon' : 'text-fg')}>{timeLeft(c.endsAt)}</div>
              <div className="mt-1.5 text-[14px] text-muted">{c.leaderName ? `лидирует ${c.leaderName}` : 'ставок пока нет'}</div>
            </div>
            <div className="text-right">
              <Stars value={c.currentBid ?? 0} size={20} className="font-display text-[22px] font-semibold" />
              <div className="mt-1 max-w-[140px] truncate text-[14px] text-muted">{prize}</div>
            </div>
          </div>
        ) : c.smsCounter ? (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="num font-display text-[22px] font-semibold">
                {c.smsCounter.count}
                <span className="text-[15px] text-muted"> / {c.smsCounter.target}</span>
              </span>
              <span className="truncate pl-3 text-[14px] text-muted">{prize}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#4ade80,#a9dcff)] transition-[width] duration-700" style={{ width: `${Math.min(100, (c.smsCounter.count / c.smsCounter.target) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Figure label="участников" value={fmtNum(c._count.participants)} />
            <Figure label="победителей" value={fmtNum(c._count.winners)} />
            <div className="min-w-0 text-right">
              <div className="truncate text-[15px] font-semibold text-accent">{prize || '—'}</div>
              <div className="mt-0.5 text-[13px] text-muted">{live && c.endsAt ? `ещё ${timeLeft(c.endsAt)}` : c.endsAt ? fmtDate(c.endsAt) : t?.label}</div>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="num font-display text-[20px] font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-[13px] text-muted">{label}</div>
    </div>
  );
}

'use client';

import { ArrowRight, CircleHelp, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum } from '@/lib/format';
import { ContestTicket, type TicketContest } from '@/components/ContestTicket';
import { TypeIcon } from '@/components/TypeIcon';
import { Button, Empty, ErrorState, Loading } from '@/components/ui';
import { Stars } from '@/components/StarIcon';
import { Hand, Solik } from '@/components/Winter';

interface Dashboard {
  bots: number;
  chats: number;
  activeContests: number;
  participants: number;
  winners: number;
  giftsDelivered: number;
  stars: number;
  recent: { id: string; type: string; createdAt: string; contest: { id: string; title: string } }[];
}

const EVENT_LABEL: Record<string, string> = {
  'contest.created': 'Создан конкурс',
  'contest.started': 'Конкурс запущен',
  'contest.scheduled': 'Конкурс запланирован',
  'contest.cancelled': 'Конкурс остановлен',
  'winners.drawn': 'Определены победители',
  'winners.rerolled': 'Победители перевыбраны',
  'winner.instant': 'Кто-то выиграл приз',
  'sms.started': 'Запущен SMS-конкурс',
  'sms.filled': 'Набор участников завершён',
  'sms.stopped': 'SMS-конкурс остановлен',
  'sms.reset': 'SMS-счётчик сброшен',
  'bid.applied': 'Новая ставка',
  'bid.paid_message': 'Перебили платным сообщением',
};

// one line on how each mode plays, plus where it starts
const MODES = [
  { type: 'STARS_AUCTION', name: 'Перебивка', line: 'Каждая ставка Stars сбрасывает таймер. Последний — победил.', href: '/contests/new?type=STARS_AUCTION' },
  { type: 'SMS_COUNTER', name: 'SMS Counter', line: 'Пишешь в чат .sms 100 — бот считает первых сто.', href: '/sms' },
  { type: 'FIRST_COMMENT', name: 'Первый комментарий', line: 'Кто первым ответил под постом, тот и забрал.', href: '/contests/new?type=FIRST_COMMENT' },
  { type: 'DICE_777', name: 'Конкурс 777', line: 'Участники крутят слот в чате. Три семёрки — приз.', href: '/contests/new?type=DICE_777' },
  { type: 'MESSAGE_GIVEAWAY', name: 'За активность', line: 'Любое сообщение может выиграть подарок.', href: '/contests/new?type=MESSAGE_GIVEAWAY' },
  { type: 'RANDOM', name: 'Розыгрыш', line: 'Кнопка «Участвовать» и честный рандом.', href: '/contests/new?type=RANDOM' },
];

const openTour = () => window.dispatchEvent(new Event('solik:tour'));

export default function DashboardPage() {
  const { user } = useAuth();
  const dash = useApi<Dashboard>('/api/dashboard');
  const live = useApi<{ items: TicketContest[] }>('/api/contests?status=ACTIVE&pageSize=6');
  const d = dash.data;
  const liveCount = live.data?.items.length ?? d?.activeContests ?? 0;

  return (
    <div className="space-y-8">
      <header className="relative pr-20 pt-1 md:pr-0">
        <Hand>с наступающим, {user?.firstName ?? 'друг'})</Hand>
        <h1 className="glow-text mt-3 max-w-[15ch] font-display text-[34px] font-black leading-[1.02] tracking-[-0.035em] md:text-[44px]">Дари подарки в своём чате</h1>
      </header>

      {(dash.error || live.error) && <ErrorState error={(dash.error || live.error)!} retry={() => (dash.reload(), live.reload())} />}

      {/* the big number, then the small ones */}
      <section className="card relative overflow-hidden px-5 pb-5 pt-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-gold/20 blur-3xl" />
        <div className="num glow-text font-display text-[56px] font-black leading-none tracking-[-0.04em]">{fmtNum(d?.giftsDelivered)}</div>
        <Hand className="mt-2 text-[24px]">{plural(d?.giftsDelivered ?? 0, 'подарок уже на руках', 'подарка уже на руках', 'подарков уже на руках')}</Hand>
        <div className="mt-5 grid grid-cols-3 border-t border-white/10 pt-4">
          <Mini value={fmtNum(liveCount)} label="идут сейчас" dot />
          <Mini value={fmtNum(d?.participants)} label="участников" />
          <Mini value={<Stars value={fmtNum(d?.stars)} size={18} />} label="Stars" />
        </div>
      </section>

      {/* main action: solik peeks over it */}
      <section className="relative pt-[78px]">
        <Solik className="absolute left-1 top-0 w-[150px]" />
        <Link href="/contests/new" className="card-hot press relative flex min-h-[132px] items-center gap-3 overflow-hidden px-5 py-5">
          <div className="relative z-10 min-w-0 flex-1">
            <div className="font-display text-[26px] font-black leading-[1.02] tracking-[-0.03em]">Создать конкурс</div>
            <div className="mt-2 text-[16px] leading-snug text-white/85">6 режимов, приз — настоящий подарок Telegram</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gifts/5956217000635139069.webp" alt="" className="float-y h-[92px] w-[92px] shrink-0 drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)]" />
          <span className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#e63946] shadow-lg">
            <ArrowRight className="h-5 w-5" strokeWidth={2.6} />
          </span>
        </Link>
      </section>

      <button onClick={openTour} className="card press flex min-h-[72px] w-full items-center gap-4 px-4 text-left">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pink/15 text-pink">
          <CircleHelp className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[17px] font-extrabold">Как это работает</span>
          <span className="block text-[15px] text-muted">4 шага, полминуты</span>
        </span>
        <ArrowRight className="h-5 w-5 text-muted" />
      </button>

      <section>
        <SectionTitle hand="в твоих чатах" title="Идут сейчас" href="/contests" />
        {live.loading && !live.data ? (
          <Loading />
        ) : !live.data?.items.length ? (
          <Empty
            icon={<Trophy className="h-7 w-7" />}
            title="Пока тихо"
            text="Добавь бота админом в чат или канал — и запусти перебивку, SMS Counter или розыгрыш."
            action={
              <Link href="/contests/new">
                <Button>Запустить первый</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {live.data.items.map((c) => (
              <ContestTicket key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle hand="выбирай" title="Режимы" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {MODES.map((m) => (
            <Link key={m.type} href={m.href} className="card press flex flex-col p-4">
              <TypeIcon type={m.type} size={48} />
              <span className="mt-3 font-display text-[16px] font-extrabold leading-tight">{m.name}</span>
              <span className="mt-1.5 text-[14px] leading-snug text-muted">{m.line}</span>
            </Link>
          ))}
        </div>
      </section>

      {d && d.recent.length > 0 && (
        <section>
          <SectionTitle hand="что было" title="Журнал" />
          <ol className="card divide-y divide-white/[0.07] px-4">
            {d.recent.map((e, i) => (
              <li key={e.id}>
                <Link href={`/contests/${e.contest.id}`} className="flex min-h-[64px] items-center gap-3 py-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? 'bg-accent shadow-[0_0_10px_rgb(var(--accent))]' : 'bg-white/25'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px]">{EVENT_LABEL[e.type] ?? e.type}</span>
                    <span className="block truncate text-[14px] text-muted">
                      {e.contest.title}, {fmtDate(e.createdAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {d && (
            <p className="mt-3 text-[15px] text-muted">
              {d.chats} {plural(d.chats, 'чат подключён', 'чата подключено', 'чатов подключено')}, своих ботов: {d.bots}.{' '}
              <Link href="/bots" className="font-semibold text-sky">
                Управлять
              </Link>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function SectionTitle({ hand, title, href }: { hand: string; title: string; href?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <Hand className="text-[19px]">{hand}</Hand>
        <h2 className="mt-1.5 font-display text-[24px] font-black tracking-[-0.03em]">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="press flex min-h-[44px] items-center rounded-full border border-white/[0.13] bg-white/[0.07] px-4 text-[15px] font-semibold">
          Все
        </Link>
      )}
    </div>
  );
}

function Mini({ value, label, dot }: { value: React.ReactNode; label: string; dot?: boolean }) {
  return (
    <div className="min-w-0 px-1 first:pl-0">
      <div className="num flex items-center gap-1.5 font-display text-[21px] font-extrabold leading-none tracking-[-0.03em]">
        {value}
        {dot && <span className="h-2 w-2 animate-pulse rounded-full bg-ok" />}
      </div>
      <div className="mt-1.5 truncate text-[14px] text-muted">{label}</div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

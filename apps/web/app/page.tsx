'use client';

import { Gift, Hash, MessageSquareText, Plus, Sparkles, Star, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtNum } from '@/lib/format';
import { ContestTicket, type TicketContest } from '@/components/ContestTicket';
import { Button, Empty, ErrorState, Loading } from '@/components/ui';
import { Stars } from '@/components/StarIcon';

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

const QUICK = [
  { href: '/contests/new', label: 'Розыгрыш', icon: Trophy },
  { href: '/sms', label: 'SMS Counter', icon: Hash },
  { href: '/contests/new?type=STARS_AUCTION', label: 'Перебивка', icon: Star },
  { href: '/contests/new?type=DICE_777', label: '777', icon: Sparkles },
  { href: '/gifts', label: 'Подарки', icon: Gift },
  { href: '/templates', label: 'Шаблоны', icon: MessageSquareText },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const dash = useApi<Dashboard>('/api/dashboard');
  const live = useApi<{ items: TicketContest[] }>('/api/contests?status=ACTIVE&pageSize=6');
  const d = dash.data;

  return (
    <div className="space-y-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="-rotate-2 font-hand text-[22px] font-bold leading-none text-accent">Привет, {user?.firstName ?? 'друг'}</p>
          <h1 className="mt-1.5 font-display text-[30px] font-black leading-[1.02] tracking-[-0.045em] md:text-[38px]">
            {live.data ? (live.data.items.length ? `Идёт ${live.data.items.length} ${plural(live.data.items.length, 'конкурс', 'конкурса', 'конкурсов')}` : 'Сейчас тихо') : ' '}
          </h1>
        </div>
        <Link href="/contests/new" className="w-full sm:w-auto">
          <Button className="w-full" icon={<Plus className="h-4 w-4" />}>
            Создать конкурс
          </Button>
        </Link>
      </header>

      {(dash.error || live.error) && <ErrorState error={(dash.error || live.error)!} retry={() => (dash.reload(), live.reload())} />}

      <section>
        {live.loading && !live.data ? (
          <Loading />
        ) : !live.data?.items.length ? (
          <Empty
            icon={<Trophy className="h-6 w-6" />}
            title="Активных конкурсов нет"
            text="Добавьте бота администратором в чат или канал и запустите розыгрыш, перебивку или SMS Counter."
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

      <nav aria-label="Быстрые действия" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {QUICK.map((q) => (
          <Link key={q.href} href={q.href} className="flex shrink-0 items-center gap-2 rounded-full border border-line/[0.06] bg-surface px-4 py-2.5 text-[14px] font-semibold shadow-[var(--card-shadow)] transition-transform active:scale-95">
            <q.icon className="h-4 w-4 text-accent" />
            {q.label}
          </Link>
        ))}
      </nav>

      {d && (
        <section>
          <h2 className="mb-3 text-[17px] font-semibold">За всё время</h2>
          <div className="card grid grid-cols-2 divide-line/[0.06] md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-line/[0.06] md:[&>*:nth-child(-n+2)]:border-b-0">
            <Total value={fmtNum(d.participants)} label="участников" />
            <Total value={fmtNum(d.winners)} label="победителей" className="border-l border-line/[0.06] md:border-l-0" />
            <Total value={fmtNum(d.giftsDelivered)} label="подарков выдано" />
            <Total value={<Stars value={fmtNum(d.stars)} size={20} />} label="Stars в перебивках" className="border-l border-line/[0.06] md:border-l-0" />
          </div>
          <p className="mt-3 text-[13px] text-muted">
            {d.chats} {plural(d.chats, 'чат подключён', 'чата подключено', 'чатов подключено')}, своих ботов: {d.bots}.{' '}
            <Link href="/bots" className="text-sky">
              Управлять
            </Link>
          </p>
        </section>
      )}

      {d && d.recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-[17px] font-semibold">Журнал</h2>
          <ol className="relative ml-1.5 border-l border-line/[0.08]">
            {d.recent.map((e, i) => (
              <li key={e.id} className="relative pb-4 pl-5 last:pb-0">
                <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-accent' : 'bg-line/20 ring-2 ring-bg'}`} />
                <Link href={`/contests/${e.contest.id}`} className="block">
                  <div className="text-[15px]">{EVENT_LABEL[e.type] ?? e.type}</div>
                  <div className="text-[13px] text-muted">
                    {e.contest.title}, {fmtDate(e.createdAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Total({ value, label, gold, className = '' }: { value: React.ReactNode; label: string; gold?: boolean; className?: string }) {
  return (
    <div className={`px-4 py-4 ${className}`}>
      <div className={`num font-display text-[22px] font-extrabold leading-none tracking-[-0.03em] ${gold ? 'text-gold' : ''}`}>{value}</div>
      <div className="mt-2 text-[13px] text-muted">{label}</div>
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

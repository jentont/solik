'use client';

import { Archive, ArrowLeft, Dices, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi, usePolling } from '@/lib/api';
import { CONTEST_TYPES, fmtDate, fmtNum, timeLeft, userName } from '@/lib/format';
import { TypeIcon } from '@/components/TypeIcon';
import { Stars } from '@/components/StarIcon';
import { GiftSticker } from '@/components/GiftSticker';
import { Badge, Button, Card, CardTitle, ErrorState, Loading, PageHeader, Pager, Stat, StatusBadge, Table, Tabs, useConfirm } from '@/components/ui';

type Tab = 'participants' | 'winners' | 'bids' | 'leaderboard' | 'deliveries' | 'events';

export default function ContestPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: c, error, loading, reload } = useApi<any>(`/api/contests/${id}`);
  const [tab, setTab] = useState<Tab>('participants');
  const [busy, setBusy] = useState('');
  const { confirm, node } = useConfirm();
  const [, tick] = useState(0);

  const live = c?.status === 'ACTIVE';
  const silentReload = useCallback(() => void reload(), [reload]);
  usePolling(silentReload, c?.type === 'STARS_AUCTION' ? 3000 : 10000, !!live);
  useEffect(() => {
    if (!live || !c?.endsAt) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [live, c?.endsAt]);

  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !c) return <Loading />;
  if (!c) return null;
  const t = CONTEST_TYPES[c.type];

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const participantsCount = c.smsCounter ? c.smsCounter.count : c._count.participants;
  const activeWinners = c.winners.filter((w: any) => w.status === 'ACTIVE');

  return (
    <>
      <Link href="/contests" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Конкурсы
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <TypeIcon type={c.type} size={40} /> {c.title} <StatusBadge status={c.status} />
          </span>
        }
        sub={`${t?.label}, ${c.chat?.title ?? c.channel?.title ?? ''}, через @${c.bot.username}`}
        action={
          <>
            {['DRAFT', 'SCHEDULED'].includes(c.status) && (
              <Button loading={busy === 'start'} icon={<Play className="h-4 w-4" />} onClick={() => run('start', () => api(`/api/contests/${id}/start`, { body: { now: true } }), 'Конкурс запущен')}>
                Запустить сейчас
              </Button>
            )}
            {c.status === 'ACTIVE' && c.type !== 'STARS_AUCTION' && (
              <Button
                loading={busy === 'draw'}
                icon={<Dices className="h-4 w-4" />}
                onClick={async () =>
                  (await confirm('Определить победителей?', 'Конкурс будет завершён, победители объявлены в чате, а призы поставлены в очередь на выдачу.')) &&
                  run('draw', () => api(`/api/contests/${id}/winner`, { body: {} }), 'Победители определены')
                }
              >
                Определить победителей
              </Button>
            )}
            {c.status === 'FINISHED' && (
              <Button
                variant="secondary"
                loading={busy === 'reroll'}
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={async () =>
                  (await confirm('Повторный розыгрыш?', 'Текущие победители будут помечены как перевыбранные и исключены. Новые победители будут объявлены в чате.')) &&
                  run('reroll', () => api(`/api/contests/${id}/winner`, { body: { reroll: true } }), 'Повторный розыгрыш выполнен')
                }
              >
                Перевыбрать
              </Button>
            )}
            {['ACTIVE', 'SCHEDULED'].includes(c.status) && (
              <Button
                variant="danger"
                icon={<Square className="h-4 w-4" />}
                onClick={async () => (await confirm('Остановить конкурс?', 'Конкурс будет отменён без определения победителей.', { danger: true, confirmText: 'Остановить' })) && run('stop', () => api(`/api/contests/${id}/stop`, { body: {} }), 'Конкурс остановлен')}
              >
                Остановить
              </Button>
            )}
            {['FINISHED', 'CANCELLED'].includes(c.status) && (
              <Button variant="ghost" icon={<Archive className="h-4 w-4" />} onClick={() => run('archive', () => api(`/api/contests/${id}/archive`, { body: {} }), 'В архиве')}>
                В архив
              </Button>
            )}
            {c.status === 'DRAFT' && (
              <Button
                variant="ghost"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={async () => {
                  if (!(await confirm('Удалить черновик?', 'Действие нельзя отменить.', { danger: true, confirmText: 'Удалить' }))) return;
                  await api(`/api/contests/${id}`, { method: 'DELETE' });
                  router.push('/contests');
                }}
              />
            )}
          </>
        }
      />

      {c.type === 'STARS_AUCTION' && c.status === 'ACTIVE' && (
        <Card className="mb-6 overflow-hidden bg-gradient-to-br from-gold/10 to-transparent">
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted">Текущая ставка</div>
              <Stars value={c.currentBid ?? '—'} size={26} className="font-display text-3xl font-bold" />
            </div>
            <div>
              <div className="text-xs text-muted">Лидер</div>
              <div className="font-display text-xl font-semibold">{c.leaderName ?? 'нет ставок'}</div>
            </div>
            <div>
              <div className="text-xs text-muted">До конца</div>
              <div className="font-display text-3xl font-bold tabular-nums">{timeLeft(c.endsAt)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Ставок</div>
              <div className="font-display text-3xl font-bold">{c.bidsCount}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Участники" value={c.smsCounter ? `${c.smsCounter.count}/${c.smsCounter.target}` : fmtNum(participantsCount)} />
        <Stat label="Победители" value={activeWinners.length} />
        <Stat
          label="Приз"
          value={
            <span className="flex items-center gap-2 text-base">
              {c.prizes[0] && <GiftSticker gift={c.prizes[0].gift ?? { name: c.prizes[0].title }} size={36} />}
              <span className="truncate">{c.prizes.map((p: any) => p.title).join(', ') || '—'}</span>
            </span>
          }
        />
        <Stat label={c.status === 'ACTIVE' && c.endsAt ? 'Осталось' : 'Итоги'} value={<span className="text-base">{c.status === 'ACTIVE' && c.endsAt ? timeLeft(c.endsAt) : fmtDate(c.finishedAt ?? c.endsAt)}</span>} />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'participants', label: 'Участники', count: participantsCount },
          { id: 'winners', label: 'Победители', count: c.winners.length },
          ...(c.type === 'STARS_AUCTION' ? [{ id: 'bids' as Tab, label: 'Ставки', count: c.bids.length }] : []),
          ...(['ACTIVITY', 'MESSAGE_GIVEAWAY', 'DICE_777'].includes(c.type) ? [{ id: 'leaderboard' as Tab, label: 'Лидеры' }] : []),
          { id: 'deliveries', label: 'Выдача призов', count: c.deliveries.length },
          { id: 'events', label: 'Журнал' },
        ]}
      />

      {tab === 'participants' && <Participants id={id} sms={!!c.smsCounter} />}
      {tab === 'winners' && (
        <Table head={['Место', 'Победитель', 'Приз', 'Розыгрыш', 'Статус', 'Дата']} empty={!c.winners.length}>
          {c.winners.map((w: any) => (
            <tr key={w.id} className={w.status === 'REROLLED' ? 'opacity-50' : ''}>
              <td className="px-3 py-2.5 font-display font-bold">#{w.place}</td>
              <td className="px-3">
                {userName(w)} <span className="font-mono text-xs text-muted">{w.tgUserId}</span>
              </td>
              <td className="px-3">{w.prize?.title ?? '—'}</td>
              <td className="px-3 text-xs text-muted">№{w.drawNumber}</td>
              <td className="px-3">{w.status === 'ACTIVE' ? <Badge tone="ok">Победитель</Badge> : <Badge>Перевыбран</Badge>}</td>
              <td className="px-3 text-xs text-muted">{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'bids' && (
        <Table head={['Участник', 'Сумма', 'Статус', 'Тип', 'Время']} empty={!c.bids.length}>
          {c.bids.map((b: any) => (
            <tr key={b.id}>
              <td className="px-3 py-2.5">{b.username ? `@${b.username}` : b.tgUserId}</td>
              <td className="px-3"><Stars value={b.amount} size={14} /></td>
              <td className="px-3">
                <StatusBadge status={b.status} />
              </td>
              <td className="px-3 text-xs text-muted">{b.kind === 'PAID_MESSAGE' ? 'Платное сообщение' : 'Инвойс'}</td>
              <td className="px-3 text-xs text-muted">{fmtDate(b.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'leaderboard' && <Leaderboard id={id} />}
      {tab === 'deliveries' && (
        <Table head={['Получатель', 'Способ', 'Статус', 'Комментарий', '']} empty={!c.deliveries.length}>
          {c.deliveries.map((d: any) => (
            <tr key={d.id}>
              <td className="px-3 py-2.5">{d.recipientName ?? d.recipientTgId}</td>
              <td className="px-3 text-xs">{d.method}</td>
              <td className="px-3">
                <StatusBadge status={d.status} />
              </td>
              <td className="max-w-xs truncate px-3 text-xs text-muted">{d.error ?? d.note ?? ''}</td>
              <td className="whitespace-nowrap px-3 text-right">
                {['FAILED', 'PENDING'].includes(d.status) && (
                  <Button size="sm" variant="ghost" onClick={() => run('r' + d.id, () => api(`/api/gifts/deliveries/${d.id}/retry`, { body: {} }), 'Повтор запущен')}>
                    Повторить
                  </Button>
                )}
                {d.status !== 'DELIVERED' && (
                  <Button size="sm" variant="ghost" onClick={() => run('c' + d.id, () => api(`/api/gifts/deliveries/${d.id}/confirm`, { body: {} }), 'Отмечено как выдано')}>
                    Выдано вручную
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {tab === 'events' && (
        <Card>
          <ul className="space-y-2 text-sm">
            {c.events.map((e: any) => (
              <li key={e.id} className="flex gap-3 border-b border-line/[0.05] pb-2">
                <span className="w-32 shrink-0 text-xs text-muted">{fmtDate(e.createdAt)}</span>
                <span className="font-mono text-xs">{e.type}</span>
                <span className="truncate text-xs text-muted">{JSON.stringify(e.data)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {node}
    </>
  );
}

function Participants({ id, sms }: { id: string; sms: boolean }) {
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<{ items: any[]; total: number }>(`/api/contests/${id}/participants?page=${page}`, [page]);
  if (loading && !data) return <Loading />;
  return (
    <>
      <Table head={['#', 'Участник', 'Telegram ID', sms ? 'Сообщение' : 'Активность', 'Время']} empty={!data?.items.length}>
        {data?.items.map((p) => (
          <tr key={p.id}>
            <td className="px-3 py-2.5 font-display font-semibold tabular-nums">{p.position ?? '—'}</td>
            <td className="px-3">{userName(p)}</td>
            <td className="px-3 font-mono text-xs text-muted">{p.tgUserId}</td>
            <td className="px-3 tabular-nums">{sms ? `#${p.messageId}` : p.score}</td>
            <td className="px-3 text-xs text-muted">{fmtDate(p.joinedAt ?? p.createdAt)}</td>
          </tr>
        ))}
      </Table>
      <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
    </>
  );
}

function Leaderboard({ id }: { id: string }) {
  const { data } = useApi<{ rank: number; name: string; score: number }[]>(`/api/contests/${id}/leaderboard`);
  const max = Math.max(1, ...(data ?? []).map((r) => r.score));
  return (
    <Card>
      <CardTitle>Таблица лидеров</CardTitle>
      <ul className="space-y-2">
        {data?.map((r) => (
          <li key={r.rank} className="flex items-center gap-3">
            <span className="w-6 text-right font-display font-bold text-muted">{r.rank}</span>
            <span className="w-40 truncate text-sm">{r.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-gold" style={{ width: `${(r.score / max) * 100}%` }} />
            </div>
            <span className="w-12 text-right text-sm tabular-nums">{r.score}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

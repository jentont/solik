'use client';

import { Plus, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/api';
import { fmtDate, userName } from '@/lib/format';
import { ContestTicket } from '@/components/ContestTicket';
import { Badge, Button, Empty, ErrorState, Loading, PageHeader, Pager, StatusBadge, Table, Tabs } from '@/components/ui';

type Tab = 'active' | 'scheduled' | 'drafts' | 'finished' | 'archive' | 'winners';
const STATUS_OF: Record<Exclude<Tab, 'winners'>, string> = {
  active: 'ACTIVE',
  scheduled: 'SCHEDULED',
  drafts: 'DRAFT',
  finished: 'FINISHED,CANCELLED',
  archive: 'ARCHIVED',
};

export default function ContestsPage() {
  const [tab, setTab] = useState<Tab>('active');
  const [page, setPage] = useState(1);
  return (
    <>
      <PageHeader
        title="Конкурсы"
        sub="Все розыгрыши во всех ваших чатах и каналах"
        action={
          <Link href="/contests/new">
            <Button icon={<Plus className="h-4 w-4" />}>Создать</Button>
          </Link>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => (setTab(t), setPage(1))}
        tabs={[
          { id: 'active', label: 'Активные' },
          { id: 'scheduled', label: 'Запланированные' },
          { id: 'drafts', label: 'Черновики' },
          { id: 'finished', label: 'Завершённые' },
          { id: 'archive', label: 'Архив' },
          { id: 'winners', label: 'История победителей' },
        ]}
      />
      {tab === 'winners' ? <Winners page={page} setPage={setPage} /> : <List status={STATUS_OF[tab]} page={page} setPage={setPage} />}
    </>
  );
}

function List({ status, page, setPage }: { status: string; page: number; setPage(p: number): void }) {
  const { data, error, loading, reload } = useApi<{ items: any[]; total: number; pageSize: number }>(`/api/contests?status=${status}&page=${page}`, [status, page]);
  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data?.items.length)
    return (
      <Empty
        icon={<Trophy className="h-6 w-6" />}
        title="Здесь пока пусто"
        action={
          <Link href="/contests/new">
            <Button>Создать конкурс</Button>
          </Link>
        }
      />
    );
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {data.items.map((c) => (
          <ContestTicket key={c.id} c={c} />
        ))}
      </div>
      <Pager page={page} total={data.total} pageSize={data.pageSize} onPage={setPage} />
    </>
  );
}

function Winners({ page, setPage }: { page: number; setPage(p: number): void }) {
  const { data, error, loading } = useApi<{ items: any[]; total: number }>(`/api/winners?page=${page}`, [page]);
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <Loading />;
  return (
    <>
      <Table head={['Победитель', 'Конкурс', 'Приз', 'Место', 'Выдача', 'Дата']} empty={!data?.items.length}>
        {data?.items.map((w) => (
          <tr key={w.id} className={w.status === 'REROLLED' ? 'opacity-50' : ''}>
            <td className="px-3 py-2.5">
              {userName(w)} <span className="font-mono text-[13px] text-muted">{w.tgUserId}</span>
            </td>
            <td className="px-3">
              <Link href={`/contests/${w.contest.id}`} className="text-accent">
                {w.contest.title}
              </Link>
            </td>
            <td className="px-3">{w.prize?.title ?? '—'}</td>
            <td className="px-3">
              #{w.place} {w.status === 'REROLLED' && <Badge tone="muted">перевыбран</Badge>}
            </td>
            <td className="px-3">{w.deliveries[0] ? <StatusBadge status={w.deliveries[0].status} /> : '—'}</td>
            <td className="px-3 text-[13px] text-muted">{fmtDate(w.createdAt)}</td>
          </tr>
        ))}
      </Table>
      <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
    </>
  );
}

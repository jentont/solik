'use client';

import { Pause, Play, Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { CONTEST_TYPES, fmtDate, fmtDay, fmtNum } from '@/lib/format';
import { Badge, Button, Card, CardTitle, ErrorState, Loading, Modal, Pager, Stat, StatusBadge, Table, Tabs, useConfirm } from '@/components/ui';
import { StarIcon } from '../StarIcon';

export function AdminOverview() {
  const { data, error, loading } = useApi<any>('/api/admin/stats');
  if (error) return <ErrorState error={error} />;
  if (loading || !data) return <Loading />;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Пользователи" value={fmtNum(data.users)} />
      <Stat label="White-Label боты" value={fmtNum(data.wlBots)} />
      <Stat label="Активные подписки" value={fmtNum(data.activeSubs)} />
      <Stat label="Доход за 30 дней" value={<span className="inline-flex items-center gap-1.5 text-gold"><StarIcon size={20} />{fmtNum(data.revenue30Stars)}</span>} hint={`Всего ${fmtNum(data.revenueStars)} Stars`} />
      <Stat label="Группы и чаты" value={fmtNum(data.chats)} />
      <Stat label="Каналы" value={fmtNum(data.channels)} />
      <Stat label="Конкурсы" value={fmtNum(data.contests)} />
      <Stat label="Активные конкурсы" value={fmtNum(data.activeContests)} />
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  return (
    <div className="relative max-w-sm flex-1">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input className="input pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const BOT_FILTERS = [
  ['all', 'Все'],
  ['active', 'Активные'],
  ['inactive', 'Неактивные'],
  ['expired', 'Истекшие подписки'],
  ['new', 'Новые'],
  ['with_contests', 'С активными конкурсами'],
  ['suspended', 'Приостановленные'],
] as const;

export function AdminBots() {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, reload } = useApi<{ items: any[]; total: number }>(`/api/admin/bots?filter=${filter}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [filter, page, q]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Username, Telegram ID, владелец, название" />
        <select className="input w-56" value={filter} onChange={(e) => (setFilter(e.target.value), setPage(1))}>
          {BOT_FILTERS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <Table head={['Бот', 'Владелец', 'Статус', 'Подписка', 'Чаты', 'Каналы', 'Активн. конкурсы', 'Участники', 'Создан', 'Активность']} empty={!data?.items.length}>
          {data?.items.map((b) => (
            <tr key={b.id} className="cursor-pointer hover:bg-line/[0.02]" onClick={() => setOpen(b.id)}>
              <td className="px-3 py-2.5">
                <div className="font-medium">
                  {b.name} {b.isPlatform && <Badge tone="accent">главный</Badge>}
                </div>
                <div className="text-[13px] text-muted">
                  @{b.username} · <span className="font-mono">{b.telegramId}</span>
                </div>
              </td>
              <td className="px-3 text-[13px]">
                {b.owner ? (
                  <>
                    {b.owner.username ? `@${b.owner.username}` : '—'}
                    <div className="font-mono text-muted">{b.owner.telegramId}</div>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3">
                <StatusBadge status={b.status} />
              </td>
              <td className="px-3">{b.subscription ? <StatusBadge status={b.subscription.status} /> : <span className="text-[13px] text-muted">—</span>}</td>
              <td className="px-3 tabular-nums">{b._count.chats}</td>
              <td className="px-3 tabular-nums">{b._count.channels}</td>
              <td className="px-3 tabular-nums">{b._count.contests}</td>
              <td className="px-3 tabular-nums">{fmtNum(b.participantsCount)}</td>
              <td className="px-3 text-[13px] text-muted">{fmtDay(b.createdAt)}</td>
              <td className="px-3 text-[13px] text-muted">{fmtDate(b.lastActivityAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
      <BotCard id={open} onClose={() => (setOpen(null), reload())} />
    </>
  );
}

function BotCard({ id, onClose }: { id: string | null; onClose(): void }) {
  const { data, reload } = useApi<any>(id ? `/api/admin/bots/${id}` : null, [id]);
  const [tab, setTab] = useState<'info' | 'chats' | 'contests' | 'logs'>('info');
  const { confirm, node } = useConfirm();
  const b = data?.bot;
  const suspend = async () => {
    const reason = prompt('Причина приостановки (видна владельцу)') ?? '';
    if (!(await confirm('Приостановить бота?', 'Бот перестанет обрабатывать конкурсы. Данные сохранятся.', { danger: true }))) return;
    await api(`/api/admin/bots/${id}/suspend`, { body: { reason } });
    toast.success('Бот приостановлен');
    reload();
  };
  const resume = async () => {
    await api(`/api/admin/bots/${id}/resume`, { body: {} });
    toast.success('Бот возобновлён');
    reload();
  };
  return (
    <Modal open={!!id} onClose={onClose} title={b ? `${b.name} · @${b.username}` : 'Бот'} wide>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            {b.subscription && <StatusBadge status={b.subscription.status} />}
            {!b.isPlatform &&
              (b.status === 'SUSPENDED' ? (
                <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={resume}>
                  Возобновить
                </Button>
              ) : (
                <Button size="sm" variant="danger" icon={<Pause className="h-3.5 w-3.5" />} onClick={suspend}>
                  Приостановить
                </Button>
              ))}
          </div>
          <div className="mb-4 grid grid-cols-4 gap-2">
            <Stat label="Апдейтов за 24ч" value={fmtNum(data.stats.updates24h)} />
            <Stat label="Пользователей бота" value={fmtNum(data.stats.users)} />
            <Stat label="Участников" value={fmtNum(data.stats.participants)} />
            <Stat label="Победителей" value={fmtNum(data.stats.winners)} />
          </div>
          <Tabs<'info' | 'chats' | 'contests' | 'logs'> value={tab} onChange={setTab} tabs={[{ id: 'info', label: 'Информация' }, { id: 'chats', label: 'Чаты', count: b.chats.length + b.channels.length }, { id: 'contests', label: 'Конкурсы', count: data.contests.length }, { id: 'logs', label: 'Логи' }]} />
          {tab === 'info' && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[15px]">
              {[
                ['Telegram ID', b.telegramId],
                ['Владелец', b.owner ? `${b.owner.username ? '@' + b.owner.username : ''} (${b.owner.telegramId})` : 'Платформа'],
                ['Создан', fmtDate(b.createdAt)],
                ['Последняя активность', fmtDate(b.lastActivityAt)],
                ['Подписка до', fmtDay(b.subscription?.periodEnd)],
                ['Платежей', b.subscription?.payments?.length ?? 0],
                ['Последняя ошибка', b.lastError ?? '—'],
                ['Причина приостановки', b.suspendedReason ?? '—'],
              ].map(([k, v]) => (
                <div key={k as string} className="border-b border-line/[0.05] pb-1.5">
                  <dt className="text-[13px] text-muted">{k}</dt>
                  <dd className="truncate">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {tab === 'chats' && (
            <Table head={['Чат', 'Тип', 'Статус', 'Участники']}>
              {[...b.chats.map((c: any) => ({ ...c, t: c.linkedChannelChatId ? 'Обсуждение' : c.kind })), ...b.channels.map((c: any) => ({ ...c, t: 'Канал' }))].map((c: any) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    {c.title}
                    <div className="font-mono text-[13px] text-muted">{c.chatId}</div>
                  </td>
                  <td className="px-3 text-[13px]">{c.t}</td>
                  <td className="px-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3">{c.memberCount ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
          {tab === 'contests' && (
            <Table head={['Конкурс', 'Тип', 'Статус', 'Участники', 'Дата']} empty={!data.contests.length}>
              {data.contests.map((c: any) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.title}</td>
                  <td className="px-3 text-[13px]">{CONTEST_TYPES[c.type]?.label}</td>
                  <td className="px-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3">{c._count.participants}</td>
                  <td className="px-3 text-[13px] text-muted">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </Table>
          )}
          {tab === 'logs' && <LogList logs={data.logs} webhookErrors={data.webhookErrors} />}
        </>
      )}
      {node}
    </Modal>
  );
}

export function LogList({ logs, webhookErrors = [] }: { logs: any[]; webhookErrors?: any[] }) {
  return (
    <div className="scroll-thin max-h-[50dvh] space-y-1 overflow-y-auto font-mono text-[13px]">
      {webhookErrors.map((e) => (
        <div key={e.id} className="rounded-lg bg-bad/10 px-2 py-1.5 text-bad">
          {fmtDate(e.receivedAt)} webhook {e.type}: {e.error}
        </div>
      ))}
      {logs.map((l) => (
        <div key={l.id} className={l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-muted'}>
          {fmtDate(l.createdAt)} {l.action} {l.actor?.username ? `@${l.actor.username}` : ''} {JSON.stringify(l.meta)}
        </div>
      ))}
      {!logs.length && !webhookErrors.length && <div className="text-muted">Записей нет</div>}
    </div>
  );
}

const CHAT_KINDS = [
  ['all', 'Все группы'],
  ['GROUP', 'Группы'],
  ['SUPERGROUP', 'Супергруппы'],
  ['DISCUSSION', 'Группы обсуждений'],
  ['CHANNEL', 'Каналы'],
] as const;
const CHAT_STATUSES = ['ACTIVE', 'INACTIVE', 'BOT_REMOVED', 'BOT_RESTRICTED', 'PERMISSION_MISSING', 'DISCONNECTED', 'SUSPENDED'];

export function AdminChats() {
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading } = useApi<{ items: any[]; total: number }>(`/api/admin/chats?kind=${kind}&page=${page}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [kind, status, page, q]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Название, @username, Chat ID" />
        <select className="input w-48" value={kind} onChange={(e) => (setKind(e.target.value), setPage(1))}>
          {CHAT_KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select className="input w-48" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="">Любой статус</option>
          {CHAT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <Table head={['Чат', 'Тип', 'Бот', 'Владелец', 'Статус', 'Админ', 'Участники', 'Конкурсы', 'Обработано', 'Подключен', 'Активность']} empty={!data?.items.length}>
          {data?.items.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-line/[0.02]" onClick={() => setOpen(c.id)}>
              <td className="px-3 py-2.5">
                <div className="font-medium">{c.title}</div>
                <div className="text-[13px] text-muted">
                  {c.username ? `@${c.username} · ` : ''}
                  <span className="font-mono">{c.chatId}</span>
                </div>
              </td>
              <td className="px-3 text-[13px]">{{ GROUP: 'Группа', SUPERGROUP: 'Супергруппа', DISCUSSION: 'Обсуждение', CHANNEL: 'Канал' }[c.type as string]}</td>
              <td className="px-3 text-[13px]">
                @{c.bot.username} {c.bot.isPlatform && <Badge tone="accent">главный</Badge>}
              </td>
              <td className="px-3 text-[13px]">{c.bot.owner?.username ? `@${c.bot.owner.username}` : c.bot.owner?.telegramId ?? '—'}</td>
              <td className="px-3">
                <StatusBadge status={c.status} />
              </td>
              <td className="px-3">{c.isAdmin ? 'да' : '—'}</td>
              <td className="px-3 tabular-nums">{c.memberCount ?? '—'}</td>
              <td className="px-3 tabular-nums">{c._count.contests}</td>
              <td className="px-3 tabular-nums">{fmtNum(c.messagesProcessed ?? c.postsProcessed)}</td>
              <td className="px-3 text-[13px] text-muted">{fmtDay(c.connectedAt)}</td>
              <td className="px-3 text-[13px] text-muted">{fmtDate(c.lastActivityAt)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
      <ChatCard id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ChatCard({ id, onClose }: { id: string | null; onClose(): void }) {
  const { data } = useApi<any>(id ? `/api/admin/chats/${id}` : null, [id]);
  const c = data?.chat;
  const active = data?.contests.filter((x: any) => x.status === 'ACTIVE') ?? [];
  return (
    <Modal open={!!id} onClose={onClose} title={c?.title ?? 'Чат'} wide>
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[15px] md:grid-cols-3">
            {[
              ['Chat ID', c.chatId],
              ['Username', c.username ? `@${c.username}` : '—'],
              ['Статус', <StatusBadge key="s" status={c.status} />],
              ['Бот', `@${c.bot.username}`],
              ['Владелец бота', c.bot.owner ? `@${c.bot.owner.username ?? c.bot.owner.telegramId}` : 'Платформа'],
              ['Подключил', c.owner ? `@${c.owner.username ?? c.owner.telegramId}` : '—'],
              ['Участники', c.memberCount ?? '—'],
              ['Подключен', fmtDate(c.connectedAt)],
              ['Активность', fmtDate(c.lastActivityAt)],
            ].map(([k, v]) => (
              <div key={k as string} className="border-b border-line/[0.05] pb-1.5">
                <dt className="text-[13px] text-muted">{k}</dt>
                <dd className="truncate">{v}</dd>
              </div>
            ))}
          </dl>
          <Card className="p-4">
            <CardTitle>Права бота</CardTitle>
            <div className="flex flex-wrap gap-2">
              {Object.entries(c.permissions ?? {}).map(([k, v]) => (
                <Badge key={k} tone={v === true ? 'ok' : v === false ? 'bad' : 'muted'}>
                  {k}: {String(v)}
                </Badge>
              ))}
            </div>
          </Card>
          <div>
            <div className="label">Конкурсы (активных: {active.length})</div>
            <Table head={['Конкурс', 'Тип', 'Статус', 'Участники', 'Победители', 'Дата']} empty={!data.contests.length}>
              {data.contests.map((x: any) => (
                <tr key={x.id}>
                  <td className="px-3 py-2">{x.title}</td>
                  <td className="px-3 text-[13px]">{CONTEST_TYPES[x.type]?.label}</td>
                  <td className="px-3">
                    <StatusBadge status={x.status} />
                  </td>
                  <td className="px-3">{x._count.participants}</td>
                  <td className="px-3">{x._count.winners}</td>
                  <td className="px-3 text-[13px] text-muted">{fmtDate(x.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </div>
          <div>
            <div className="label">История активности и ошибки</div>
            <LogList logs={data.logs} />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function AdminUsers({ isOwner }: { isOwner: boolean }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useApi<{ items: any[]; total: number }>(`/api/admin/users?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [page, q]);
  const { confirm, node } = useConfirm();
  const setRole = async (id: string, role: string) => {
    if (!(await confirm('Изменить роль?', `Новая роль: ${role}`))) return;
    try {
      await api(`/api/admin/users/${id}/role`, { body: { role } });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const block = async (id: string, blocked: boolean) => {
    if (!(await confirm(blocked ? 'Заблокировать пользователя?' : 'Разблокировать?', blocked ? 'Пользователь потеряет доступ к панели.' : '', { danger: blocked }))) return;
    await api(`/api/admin/users/${id}/block`, { body: { blocked } }).catch((e) => toast.error(e.message));
    reload();
  };
  return (
    <>
      <div className="mb-4">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Username, имя, Telegram ID" />
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <Table head={['Пользователь', 'Роль', 'Боты', 'Конкурсы', 'Подписки', 'Регистрация', 'Вход', '']} empty={!data?.items.length}>
          {data?.items.map((u) => (
            <tr key={u.id} className={u.isBlocked ? 'opacity-50' : ''}>
              <td className="px-3 py-2.5">
                {u.firstName} {u.username && <span className="text-muted">@{u.username}</span>}
                <div className="font-mono text-[13px] text-muted">{u.telegramId}</div>
              </td>
              <td className="px-3">
                {isOwner ? (
                  <select className="input h-8 w-28 py-0 text-[13px]" value={u.role} onChange={(e) => setRole(u.id, e.target.value)}>
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                    <option value="OWNER">OWNER</option>
                  </select>
                ) : (
                  <Badge>{u.role}</Badge>
                )}
              </td>
              <td className="px-3">{u._count.bots}</td>
              <td className="px-3">{u._count.contests}</td>
              <td className="px-3">{u._count.botSubscriptions}</td>
              <td className="px-3 text-[13px] text-muted">{fmtDay(u.createdAt)}</td>
              <td className="px-3 text-[13px] text-muted">{fmtDate(u.lastLoginAt)}</td>
              <td className="px-3 text-right">
                <Button size="sm" variant="ghost" onClick={() => block(u.id, !u.isBlocked)}>
                  {u.isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
      {node}
    </>
  );
}

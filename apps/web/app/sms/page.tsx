'use client';

import { Hash, Play, Plus, Square, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';
import { Button, Card, CardTitle, Empty, Input, Loading, Modal, PageHeader, Select, Stat, StatusBadge, Table, useConfirm } from '@/components/ui';

const MODES = {
  FIRST_N_USERS: 'Первые N уникальных участников',
  FIRST_N_MESSAGES: 'Первые N сообщений',
  EVERY_NTH: 'Каждый N-й комментарий',
  FIRST_COMMENT: 'Первый комментарий',
};

export default function SmsPage() {
  const { data, loading, reload } = useApi<{ counters: any[]; totals: { counters: number; active: number; participants: number } }>('/api/sms-counter/stats');
  const [open, setOpen] = useState(false);
  const { confirm, node } = useConfirm();
  const active = data?.counters.filter((c) => ['ACTIVE', 'FILLED'].includes(c.status)) ?? [];
  const history = data?.counters.filter((c) => !['ACTIVE', 'FILLED'].includes(c.status)) ?? [];

  const stop = async (contestId: string) => {
    if (!(await confirm('Остановить SMS-конкурс?', 'Набор участников прекратится, победитель не будет определён.', { danger: true }))) return;
    await api('/api/sms-counter/stop', { body: { contestId } });
    toast.success('Остановлено');
    reload();
  };
  const winner = async (contestId: string) => {
    if (!(await confirm('Определить победителя?', 'Победитель будет объявлен в чате ответом на его комментарий.'))) return;
    try {
      await api(`/api/contests/${contestId}/winner`, { body: {} });
      toast.success('Победитель определён');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="SMS Counter"
        sub={
          <>
            Первые N комментариев. Можно запускать прямо в чате: <code className="rounded bg-elevated px-1">.sms 100</code>
          </>
        }
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Запустить
          </Button>
        }
      />
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <Stat label="Активные" value={data?.totals.active ?? 0} />
            <Stat label="Всего SMS-конкурсов" value={data?.totals.counters ?? 0} />
            <Stat label="Участников" value={fmtNum(data?.totals.participants)} />
          </div>
          <h2 className="mb-3 font-display text-lg font-semibold">Активные</h2>
          {!active.length ? (
            <Empty icon={<Hash className="h-6 w-6" />} title="Нет активных SMS-конкурсов" text="Запустите из панели или напишите в чате .sms 100 (вы должны быть администратором)." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {active.map((c) => (
                <Card key={c.id}>
                  <div className="flex items-start justify-between">
                    <div>
                      <Link href={`/contests/${c.contest.id}`} className="font-medium hover:text-accent">
                        {c.contest.title}
                      </Link>
                      <div className="text-[13px] text-muted">
                        {c.contest.chat?.title} {c.threadMessageId ? '· комментарии поста' : ''}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-[15px]">
                      <span>
                        {c.count} / {c.target}
                      </span>
                      <span className="text-muted">осталось {c.target - c.count}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-elevated">
                      <div className="h-full rounded-full bg-gradient-to-r from-accent to-gold transition-all" style={{ width: `${(c.count / c.target) * 100}%` }} />
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" onClick={() => winner(c.contest.id)} disabled={!c.count}>
                      Определить победителя
                    </Button>
                    <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={() => stop(c.contest.id)}>
                      Стоп
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <h2 className="mb-3 mt-8 font-display text-lg font-semibold">История</h2>
          <Table head={['Конкурс', 'Чат', 'Режим', 'Участники', 'Статус', 'Дата']} empty={!history.length}>
            {history.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2.5">
                  <Link href={`/contests/${c.contest.id}`} className="text-accent">
                    {c.contest.title}
                  </Link>
                </td>
                <td className="px-3">{c.contest.chat?.title}</td>
                <td className="px-3 text-[13px]">{MODES[c.mode as keyof typeof MODES]}</td>
                <td className="px-3 tabular-nums">
                  {c.count}/{c.target}
                </td>
                <td className="px-3">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 text-[13px] text-muted">{fmtDate(c.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Card className="mt-8">
            <CardTitle>Команды в чате</CardTitle>
            <div className="grid gap-2 font-mono text-[15px] sm:grid-cols-2">
              {[
                ['.sms 100', 'первые 100 уникальных участников'],
                ['.sms msg 100', 'первые 100 сообщений'],
                ['.sms every 5 20', 'каждый 5-й комментарий, 20 мест'],
                ['.sms first', 'первый комментарий'],
                ['.sms stats', 'статистика'],
                ['.sms winner', 'определить победителя'],
                ['.sms stop', 'остановить'],
                ['.sms reset', 'сброс (с подтверждением)'],
              ].map(([c, d]) => (
                <div key={c} className="flex gap-3 rounded-lg bg-elevated/50 px-3 py-2">
                  <span className="text-accent">{c}</span>
                  <span className="font-sans text-[13px] text-muted">{d}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-muted">Команда в ветке комментариев считает только комментарии этого поста. В основном чате считаются сообщения группы.</p>
          </Card>
        </>
      )}
      <StartModal open={open} onClose={() => setOpen(false)} onStarted={reload} />
      {node}
    </>
  );
}

function StartModal({ open, onClose, onStarted }: { open: boolean; onClose(): void; onStarted(): void }) {
  const bots = useApi<any[]>(open ? '/api/bots' : null, [open]);
  const gifts = useApi<any[]>(open ? '/api/gifts/catalog?type=REGULAR,LIMITED' : null, [open]);
  const [botId, setBotId] = useState('');
  const [chatId, setChatId] = useState('');
  const [postId, setPostId] = useState('');
  const [mode, setMode] = useState<keyof typeof MODES>('FIRST_N_USERS');
  const [target, setTarget] = useState(100);
  const [everyN, setEveryN] = useState(5);
  const [announceEvery, setAnnounceEvery] = useState(1);
  const [prizes, setPrizes] = useState<{ title: string; giftId?: string; position?: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const bot = bots.data?.find((b) => b.id === (botId || bots.data?.[0]?.id));
  const chat = bot?.chats.find((c: any) => c.id === chatId);
  const allChats = useApi<{ channels: any[] }>(open ? '/api/chats' : null, [open]);
  const channel = allChats.data?.channels.find((c) => c.discussionChat?.id === chatId);
  const posts = useApi<any[]>(open && channel ? `/api/channels/${channel.id}/posts` : null, [channel?.id]);

  const start = async () => {
    setBusy(true);
    try {
      await api('/api/sms-counter/start', {
        body: {
          botId: bot.id,
          chatId,
          channelPostId: postId ? Number(postId) : undefined,
          mode,
          target: mode === 'FIRST_COMMENT' ? 1 : target,
          everyN: mode === 'EVERY_NTH' ? everyN : undefined,
          announceEvery,
          prizes: prizes.filter((p) => p.title).map((p) => ({ kind: p.giftId ? 'GIFT' : 'CUSTOM', title: p.title, giftId: p.giftId, position: p.position, quantity: 1 })),
        },
      });
      toast.success('SMS-конкурс запущен');
      onStarted();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Запуск SMS Counter" wide>
      {bots.loading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Select label="Бот" value={bot?.id ?? ''} onChange={(e) => (setBotId(e.target.value), setChatId(''))}>
              {bots.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  @{b.username}
                </option>
              ))}
            </Select>
            <Select label="Чат" value={chatId} onChange={(e) => (setChatId(e.target.value), setPostId(''))}>
              <option value="">Выберите чат</option>
              {bot?.chats.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            {chat && posts.data && (
              <Select label="Комментарии к посту (необязательно)" value={postId} onChange={(e) => setPostId(e.target.value)} hint="Пусто — считаются сообщения всей группы">
                <option value="">Вся группа</option>
                {posts.data.map((p) => (
                  <option key={p.id} value={p.messageId}>
                    #{p.messageId} — {(p.text || 'медиа').slice(0, 50)}
                  </option>
                ))}
              </Select>
            )}
            <Select label="Режим" value={mode} onChange={(e) => setMode(e.target.value as keyof typeof MODES)}>
              {Object.entries(MODES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            {mode !== 'FIRST_COMMENT' && <Input label={mode === 'EVERY_NTH' ? 'Количество мест' : 'N участников'} type="number" min={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />}
            {mode === 'EVERY_NTH' && <Input label="Каждый N-й" type="number" min={2} value={everyN} onChange={(e) => setEveryN(Number(e.target.value))} />}
            <Input label="Сообщать о регистрации каждые" type="number" min={1} value={announceEvery} onChange={(e) => setAnnounceEvery(Number(e.target.value))} hint="1 — о каждом участнике; 10 — о каждом десятом (меньше флуда)" />
          </div>
          <div>
            <div className="label">Призы</div>
            <p className="mb-2 text-[13px] text-muted">Без позиции — общий приз для победителя. С позицией — очередь призов: например, 1-й — Teddy Bear, 100-й — NFT.</p>
            <div className="space-y-2">
              {prizes.map((p, i) => (
                <div key={i} className="flex gap-2">
                  <input type="number" placeholder="Поз." className="input w-20" value={p.position ?? ''} onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, position: e.target.value ? Number(e.target.value) : undefined } : x)))} />
                  <select
                    className="input"
                    value={p.giftId ?? ''}
                    onChange={(e) => {
                      const g = gifts.data?.find((x) => x.id === e.target.value);
                      setPrizes(prizes.map((x, j) => (j === i ? { ...x, giftId: e.target.value || undefined, title: g?.name ?? x.title } : x)));
                    }}
                  >
                    <option value="">Свой приз</option>
                    {gifts.data?.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <input className="input" placeholder="Название" value={p.title} onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <button onClick={() => setPrizes(prizes.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-bad">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setPrizes([...prizes, { title: '' }])}>
                Приз
              </Button>
            </div>
          </div>
          <Button className="md:col-span-2" loading={busy} disabled={!chatId} icon={<Play className="h-4 w-4" />} onClick={start}>
            Запустить
          </Button>
        </div>
      )}
    </Modal>
  );
}

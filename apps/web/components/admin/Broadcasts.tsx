'use client';

import { Megaphone, Plus, Send, Square } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi, usePolling } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';
import { MessageEditor, type MessageValue } from '@/components/MessageEditor';
import { TelegramPreview } from '@/components/TelegramPreview';
import { Badge, Button, Card, CardTitle, Empty, Input, Loading, Modal, Select, StatusBadge, Table, Toggle } from '@/components/ui';

const MODES: Record<string, { label: string; hint: string }> = {
  ALL_CHATS: { label: 'Все подключенные чаты SOLIK', hint: 'Группы и супергруппы главного и White-Label ботов. Один чат получит сообщение один раз.' },
  WHITE_LABEL_CHATS: { label: 'Чаты White-Label ботов', hint: 'Только чаты, где подключены собственные боты пользователей' },
  MAIN_BOT_CHATS: { label: 'Чаты главного бота', hint: 'Только чаты, где подключен главный бот SOLIK' },
  MAIN_BOT_USERS: { label: 'Пользователи главного бота', hint: 'Только те, кто сам запустил бота и не заблокировал его' },
};
const SEGMENTS: Record<string, string> = {
  all: 'Все пользователи',
  active: 'Активные (30 дней)',
  new: 'Новые (7 дней)',
  with_subscription: 'С подпиской',
  without_subscription: 'Без подписки',
  wl_owners: 'Владельцы White-Label ботов',
  contest_creators: 'Создавали конкурсы',
  inactive: 'Не заходили N дней',
};

export function AdminBroadcasts() {
  const list = useApi<any[]>('/api/admin/broadcasts');
  const [editing, setEditing] = useState<any | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const anyRunning = !!list.data?.some((b) => b.status === 'RUNNING');
  const poll = useCallback(() => void list.reload(), [list]);
  usePolling(poll, 3000, anyRunning);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="max-w-xl text-[15px] text-muted">Рассылки идут только по подключенным чатам и пользователям, которые сами начали диалог с ботом. Отправка идёт через очередь с ограничением скорости и обработкой 429 Retry-After.</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ mode: 'ALL_CHATS', filters: { onlyActiveBots: true }, viaBotId: null, text: '', buttons: [] })}>
          Новая рассылка
        </Button>
      </div>
      {list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty icon={<Megaphone className="h-6 w-6" />} title="Рассылок пока не было" />
      ) : (
        <Table head={['Дата', 'Режим', 'Статус', 'Прогресс', 'Ошибки', 'Автор', '']}>
          {list.data.map((b) => {
            const done = b.sent + b.failed + b.blocked + b.permissionLost;
            return (
              <tr key={b.id}>
                <td className="px-3 py-2.5 text-[13px]">{fmtDate(b.createdAt)}</td>
                <td className="px-3 text-[13px]">{MODES[b.mode]?.label}</td>
                <td className="px-3">
                  <StatusBadge status={b.status} />
                </td>
                <td className="w-48 px-3">
                  <div className="text-[13px] tabular-nums">
                    {fmtNum(b.sent)} / {fmtNum(b.total)}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
                    <div className="h-full bg-ok transition-all" style={{ width: `${b.total ? (done / b.total) * 100 : 0}%` }} />
                  </div>
                </td>
                <td className="px-3 text-[13px] text-muted">
                  ошибок {b.failed} · заблокировали {b.blocked} · нет прав {b.permissionLost}
                </td>
                <td className="px-3 text-[13px]">@{b.createdBy?.username ?? '—'}</td>
                <td className="whitespace-nowrap px-3 text-right">
                  {b.status === 'DRAFT' ? (
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ ...b, buttons: b.buttons ?? [] })}>
                      Открыть
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setViewing(b.id)}>
                      Статистика
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {editing && <BroadcastEditor initial={editing} onClose={() => (setEditing(null), list.reload())} />}
      <BroadcastStats id={viewing} onClose={() => (setViewing(null), list.reload())} />
    </>
  );
}

function BroadcastEditor({ initial, onClose }: { initial: any; onClose(): void }) {
  const targets = useApi<{ bots: any[] }>('/api/admin/broadcast-targets');
  const [id, setId] = useState<string | null>(initial.id ?? null);
  const [mode, setMode] = useState(initial.mode);
  const [filters, setFilters] = useState<any>(initial.filters ?? {});
  const [viaBotId, setVia] = useState<string>(initial.viaBotId ?? '');
  const [msg, setMsg] = useState<MessageValue>({ text: initial.text ?? '', mediaId: initial.mediaId ?? null, media: null, buttons: initial.buttons ?? [] });
  const [testChat, setTestChat] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState('');

  const persist = async () => {
    const body = { mode, filters, viaBotId: viaBotId || null, text: msg.text, mediaId: msg.mediaId ?? null, buttons: msg.buttons.filter((b) => b.text && b.url) };
    const b = id ? await api(`/api/admin/broadcasts/${id}`, { method: 'PUT', body }) : await api('/api/admin/broadcasts', { body });
    setId(b.id);
    return b.id as string;
  };
  const step = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const wlBots = targets.data?.bots.filter((b) => !b.isPlatform) ?? [];
  const owners = [...new Map(wlBots.filter((b) => b.owner).map((b) => [b.owner.id, b.owner])).values()];
  const chatMode = mode !== 'MAIN_BOT_USERS';

  return (
    <Modal open onClose={onClose} title="Рассылка" wide>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Select label="Кому" value={mode} onChange={(e) => setMode(e.target.value)} hint={MODES[mode]?.hint}>
            {Object.entries(MODES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          {chatMode ? (
            <Card className="space-y-2 p-3">
              <Toggle checked={filters.onlyActiveBots ?? true} onChange={(v) => setFilters({ ...filters, onlyActiveBots: v })} label="Только активные боты" />
              {mode !== 'MAIN_BOT_CHATS' && <Toggle checked={!!filters.onlyValidSubscription} onChange={(v) => setFilters({ ...filters, onlyValidSubscription: v })} label="Только боты с действующей подпиской" />}
              <div className="flex flex-wrap gap-2 text-[13px]">
                {(['GROUP', 'SUPERGROUP', 'DISCUSSION'] as const).map((k) => {
                  const on = (filters.chatKinds ?? ['GROUP', 'SUPERGROUP', 'DISCUSSION']).includes(k);
                  return (
                    <button
                      key={k}
                      onClick={() => {
                        const cur: string[] = filters.chatKinds ?? ['GROUP', 'SUPERGROUP', 'DISCUSSION'];
                        setFilters({ ...filters, chatKinds: on ? cur.filter((x) => x !== k) : [...cur, k] });
                      }}
                    >
                      <Badge tone={on ? 'accent' : 'muted'}>{{ GROUP: 'Группы', SUPERGROUP: 'Супергруппы', DISCUSSION: 'Обсуждения' }[k]}</Badge>
                    </button>
                  );
                })}
              </div>
              {mode !== 'MAIN_BOT_CHATS' && (
                <>
                  <Select label="Выбранные боты (Ctrl — несколько)" multiple className="h-24" value={filters.botIds ?? []} onChange={(e) => setFilters({ ...filters, botIds: [...e.target.selectedOptions].map((o) => o.value) })}>
                    {(mode === 'ALL_CHATS' ? targets.data?.bots ?? [] : wlBots).map((b) => (
                      <option key={b.id} value={b.id}>
                        @{b.username}
                      </option>
                    ))}
                  </Select>
                  <Select label="Выбранные владельцы" multiple className="h-20" value={filters.ownerIds ?? []} onChange={(e) => setFilters({ ...filters, ownerIds: [...e.target.selectedOptions].map((o) => o.value) })}>
                    {owners.map((o: any) => (
                      <option key={o.id} value={o.id}>
                        @{o.username ?? o.id}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <Select label="Отправлять через бота" value={viaBotId} onChange={(e) => setVia(e.target.value)} hint="Пусто — для каждого чата выбирается один бот (сначала главный)">
                <option value="">Автоматически (без дублей)</option>
                {targets.data?.bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.username}
                  </option>
                ))}
              </Select>
            </Card>
          ) : (
            <Card className="space-y-2 p-3">
              <Select label="Сегмент" value={filters.segment ?? 'all'} onChange={(e) => setFilters({ ...filters, segment: e.target.value })}>
                {Object.entries(SEGMENTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              {filters.segment === 'inactive' && <Input label="Дней без активности" type="number" value={filters.inactiveDays ?? 30} onChange={(e) => setFilters({ ...filters, inactiveDays: Number(e.target.value) })} />}
            </Card>
          )}
          <MessageEditor value={msg} onChange={setMsg} />
        </div>
        <div className="space-y-4">
          <div>
            <div className="label">Предпросмотр</div>
            <TelegramPreview text={msg.text} media={msg.media} buttons={msg.buttons.map((b) => [b])} botName="SOLIK" />
          </div>
          <Card className="space-y-3 p-4">
            <div className="font-medium">1. Тестовая отправка</div>
            <Input placeholder="Chat ID (пусто — вам в личку)" value={testChat} onChange={(e) => setTestChat(e.target.value)} />
            <Button
              variant="secondary"
              loading={busy === 'test'}
              disabled={!msg.text}
              icon={<Send className="h-4 w-4" />}
              onClick={() =>
                step('test', async () => {
                  const bid = await persist();
                  await api(`/api/admin/broadcasts/${bid}/test`, { body: testChat ? { chatId: testChat } : {} });
                  toast.success('Тестовое сообщение отправлено');
                })
              }
            >
              Отправить тест
            </Button>
          </Card>
          <Card className="space-y-3 p-4">
            <div className="font-medium">2. Проверка получателей</div>
            <Button
              variant="secondary"
              loading={busy === 'preview'}
              disabled={!msg.text}
              onClick={() =>
                step('preview', async () => {
                  const bid = await persist();
                  setPreview(await api(`/api/admin/broadcasts/${bid}/preview`, { body: {} }));
                })
              }
            >
              Посчитать
            </Button>
            {preview && (
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['Получателей', preview.recipients],
                  [mode === 'MAIN_BOT_USERS' ? 'Пользователей' : 'Чатов', mode === 'MAIN_BOT_USERS' ? preview.users : preview.chats],
                  ['Ботов', preview.bots],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-elevated/60 py-2">
                    <div className="font-display text-xl font-bold">{fmtNum(v)}</div>
                    <div className="text-[13px] text-muted">{k}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <ConfirmLaunch preview={preview} id={id} mode={mode} text={msg.text} onDone={onClose} />
        </div>
      </div>
    </Modal>
  );
}

function ConfirmLaunch({ preview, id, mode, text, onDone }: { preview: any; id: string | null; mode: string; text: string; onDone(): void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button className="w-full" variant="gold" disabled={!preview?.recipients || !id} onClick={() => setOpen(true)}>
        3. Запустить рассылку
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Подтверждение рассылки">
        <dl className="mb-4 space-y-2 text-[15px]">
          <div className="flex justify-between">
            <dt className="text-muted">Тип</dt>
            <dd>{MODES[mode]?.label}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Получателей</dt>
            <dd>{fmtNum(preview?.recipients)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Чатов / пользователей</dt>
            <dd>{fmtNum(preview?.chats || preview?.users)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Ботов</dt>
            <dd>{preview?.bots}</dd>
          </div>
        </dl>
        <div className="tg-msg mb-4 max-h-40 overflow-y-auto rounded-xl bg-elevated/60 p-3 text-[15px]" dangerouslySetInnerHTML={{ __html: (preview?.html ?? text).replace(/\n/g, '<br/>') }} />
        <p className="mb-4 text-[13px] text-warn">Отменить уже отправленные сообщения нельзя. Рассылку можно остановить в процессе.</p>
        <Button
          className="w-full"
          variant="gold"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/admin/broadcasts/${id}/start`, { body: { confirm: true } });
              toast.success('Рассылка запущена');
              setOpen(false);
              onDone();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Подтверждаю — запустить
        </Button>
      </Modal>
    </>
  );
}

function BroadcastStats({ id, onClose }: { id: string | null; onClose(): void }) {
  const { data, reload } = useApi<any>(id ? `/api/admin/broadcasts/${id}` : null, [id]);
  const poll = useCallback(() => void reload(), [reload]);
  usePolling(poll, 2500, data?.status === 'RUNNING');
  return (
    <Modal open={!!id} onClose={onClose} title="Статистика рассылки" wide>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <StatusBadge status={data.status} />
            {data.status === 'RUNNING' && (
              <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={() => api(`/api/admin/broadcasts/${id}/stop`, { body: {} }).then(reload)}>
                Остановить
              </Button>
            )}
            <span className="text-[13px] text-muted">
              Старт {fmtDate(data.startedAt)} · Завершение {fmtDate(data.finishedAt)}
            </span>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2 md:grid-cols-6">
            {[
              ['Всего', data.total],
              ['Отправлено', data.sent],
              ['Ошибки', data.failed],
              ['Заблокировали', data.blocked],
              ['Нет прав', data.permissionLost],
              ['Прогресс', `${data.total ? Math.round(((data.sent + data.failed + data.blocked + data.permissionLost) / data.total) * 100) : 0}%`],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-elevated/60 p-2 text-center">
                <div className="font-display text-lg font-bold">{typeof v === 'number' ? fmtNum(v) : v}</div>
                <div className="text-[13px] text-muted">{k}</div>
              </div>
            ))}
          </div>
          <CardTitle>Проблемные получатели</CardTitle>
          <Table head={['Chat ID', 'Бот', 'Статус', 'Ошибка']} empty={!data.failures.length}>
            {data.failures.map((f: any) => (
              <tr key={f.id}>
                <td className="px-3 py-2 font-mono text-[13px]">{f.chatTgId}</td>
                <td className="px-3 text-[13px]">@{f.bot.username}</td>
                <td className="px-3">
                  <StatusBadge status={f.status} />
                </td>
                <td className="px-3 text-[13px] text-muted">{f.error}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Modal>
  );
}

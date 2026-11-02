'use client';

import { ArrowLeft, Plus, Power, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { openInvoice } from '@/lib/auth';
import { fmtDate, fmtDay, fmtNum } from '@/lib/format';
import { MediaPicker, MessageEditor, type MessageValue } from '@/components/MessageEditor';
import { TelegramPreview } from '@/components/TelegramPreview';
import { GiftSticker } from '@/components/GiftSticker';
import { Badge, Button, Card, CardTitle, Empty, ErrorState, Input, Loading, PageHeader, Select, StatusBadge, Table, Tabs, Toggle, useConfirm } from '@/components/ui';

type Tab = 'overview' | 'profile' | 'chats' | 'sms' | 'subscription' | 'business';

export default function BotPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<any>(`/api/bots/${id}`);
  const [tab, setTab] = useState<Tab>('overview');
  const { confirm, node } = useConfirm();

  if (error) return <ErrorState error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const bot = data.bot;
  const wl = !bot.isPlatform;

  const action = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Link href="/bots" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Мои боты
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {bot.name} <StatusBadge status={bot.status} />
          </span>
        }
        sub={
          <>
            @{bot.username} · ID {bot.telegramId}
          </>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Обзор' },
          ...(wl ? [{ id: 'profile' as Tab, label: 'Внешний вид' }] : []),
          { id: 'chats', label: 'Чаты и каналы', count: data.chats.length + data.channels.length },
          ...(wl ? [{ id: 'sms' as Tab, label: 'SMS-призы' }] : []),
          ...(wl ? [{ id: 'subscription' as Tab, label: 'Подписка' }] : []),
          { id: 'business', label: 'Telegram Business' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardTitle sub="Токен, webhook и права">Состояние</CardTitle>
            <dl className="space-y-2 text-sm">
              <Row k="Статус">
                <StatusBadge status={bot.status} />
              </Row>
              <Row k="Читает все сообщения групп">{bot.canReadAll ? 'Да' : 'Нет — сделайте бота администратором'}</Row>
              <Row k="Последняя активность">{fmtDate(bot.lastActivityAt)}</Row>
              <Row k="Подключен">{fmtDay(bot.createdAt)}</Row>
              {bot.lastError && <Row k="Последняя ошибка">{<span className="text-warn">{bot.lastError}</span>}</Row>}
              {bot.suspendedReason && <Row k="Причина приостановки">{bot.suspendedReason}</Row>}
            </dl>
            {wl && (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => action(() => api(`/api/bots/${id}/check`, { body: {} }), 'Проверка выполнена')}>
                  Проверить
                </Button>
                {bot.status === 'DISABLED' ? (
                  <Button size="sm" variant="secondary" icon={<Power className="h-3.5 w-3.5" />} onClick={() => action(() => api(`/api/bots/${id}/enable`, { body: {} }), 'Бот включен')}>
                    Включить
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Power className="h-3.5 w-3.5" />}
                    onClick={async () => (await confirm('Отключить бота?', 'Бот перестанет получать обновления. Данные сохранятся.')) && action(() => api(`/api/bots/${id}/disable`, { body: {} }), 'Бот отключен')}
                  >
                    Отключить
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={async () => {
                    if (!(await confirm('Удалить бота?', 'Будут удалены бот, его конкурсы, участники и история. Подписка останется и её можно привязать к новому боту.', { danger: true, confirmText: 'Удалить' }))) return;
                    await action(() => api(`/api/bots/${id}`, { method: 'DELETE' }), 'Бот удалён');
                    router.push('/bots');
                  }}
                >
                  Удалить
                </Button>
              </div>
            )}
          </Card>
          {wl && <StarsBalance botId={id} />}
        </div>
      )}

      {tab === 'profile' && wl && <ProfileEditor bot={bot} onSaved={reload} />}
      {tab === 'chats' && <ChatsTab chats={data.chats} channels={data.channels} reload={reload} confirm={confirm} />}
      {tab === 'sms' && wl && <SmsPrizes bot={bot} onSaved={reload} />}
      {tab === 'subscription' && wl && <SubscriptionTab sub={data.subscription} reload={reload} confirm={confirm} />}
      {tab === 'business' && <BusinessTab connections={data.business} botUsername={bot.username} reload={reload} />}
      {node}
    </>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/[0.05] pb-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function StarsBalance({ botId }: { botId: string }) {
  const { data, error } = useApi<{ amount: number }>(`/api/bots/${botId}/stars-balance`);
  return (
    <Card>
      <CardTitle sub="Из этого баланса бот покупает подарки победителям (sendGift)">Баланс Stars бота</CardTitle>
      <div className="font-display text-4xl font-bold text-gold">⭐ {data ? fmtNum(data.amount) : error ? '—' : '…'}</div>
      <p className="mt-3 text-xs text-muted">Пополнить баланс бота можно через @BotFather → Payments или переводом Stars боту. Если Stars не хватит, выдача перейдёт в «ручную» с уведомлением.</p>
    </Card>
  );
}

function ProfileEditor({ bot, onSaved }: { bot: any; onSaved(): void }) {
  const [name, setName] = useState(bot.name ?? '');
  const [description, setDescription] = useState(bot.description ?? '');
  const [shortDescription, setShort] = useState(bot.shortDescription ?? '');
  const [welcome, setWelcome] = useState<MessageValue>({ text: bot.welcomeText ?? 'Привет, {first_name}! 👋', mediaId: bot.welcomeMediaId, media: null, buttons: [] });
  const [menu, setMenu] = useState<{ text: string; url: string }[]>(bot.menuButtons ?? []);
  const [commands, setCommands] = useState<{ command: string; description: string }[]>(bot.commands?.length ? bot.commands : [{ command: 'start', description: 'Начать' }]);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatar, setAvatar] = useState<{ id: string; url: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setWelcome((w) => ({ ...w, buttons: menu })), [menu]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<{ warnings: string[] }>(`/api/bots/${bot.id}/profile`, {
        method: 'PATCH',
        body: {
          name,
          description,
          shortDescription,
          welcomeText: welcome.text,
          welcomeMediaId: welcome.mediaId ?? null,
          menuButtons: menu.filter((m) => m.text && m.url),
          commands: commands.filter((c) => c.command && c.description),
          ...(avatar ? { avatarMediaId: avatar.id } : {}),
        },
      });
      r.warnings.length ? r.warnings.forEach((w) => toast.warning(w)) : toast.success('Профиль бота обновлён в Telegram');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardTitle sub="Username меняется только в @BotFather">Профиль в Telegram</CardTitle>
          <div className="space-y-3">
            <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
            <Input label="Краткое описание (в профиле)" value={shortDescription} onChange={(e) => setShort(e.target.value)} maxLength={120} />
            <label className="block">
              <span className="label">Описание (экран «Что умеет бот»)</span>
              <textarea className="input min-h-[80px]" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={512} />
            </label>
            <div className="flex items-center gap-3">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar.url} alt="" className="h-14 w-14 rounded-full object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated text-xl">{name[0] ?? '🤖'}</div>
              )}
              <Button size="sm" variant="secondary" onClick={() => setAvatarOpen(true)}>
                Аватар
              </Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardTitle sub="Показываются в меню команд бота">Команды</CardTitle>
          <div className="space-y-2">
            {commands.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input className="input w-36 font-mono" value={c.command} onChange={(e) => setCommands(commands.map((x, j) => (j === i ? { ...x, command: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } : x)))} placeholder="command" />
                <input className="input" value={c.description} onChange={(e) => setCommands(commands.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="Описание" />
                <button onClick={() => setCommands(commands.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-bad">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCommands([...commands, { command: '', description: '' }])}>
              Команда
            </Button>
          </div>
        </Card>
        <Card>
          <CardTitle sub="Сообщение и кнопки меню на /start">Приветствие и меню</CardTitle>
          <MessageEditor value={welcome} onChange={(v) => (setWelcome(v), setMenu(v.buttons))} />
        </Card>
        <Button className="w-full" loading={saving} onClick={save}>
          Сохранить и применить в Telegram
        </Button>
      </div>
      <div className="lg:sticky lg:top-8 lg:self-start">
        <div className="label">Так увидит пользователь</div>
        <TelegramPreview text={welcome.text} media={welcome.media} buttons={menu.map((b) => [b])} botName={name} vars={{ first_name: 'Иван' }} />
      </div>
      <MediaPicker open={avatarOpen} onClose={() => setAvatarOpen(false)} only="PHOTO" onPick={(m) => setAvatar({ id: m.id, url: m.url })} />
    </div>
  );
}

function ChatsTab({ chats, channels, reload, confirm }: { chats: any[]; channels: any[]; reload(): void; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  const refresh = async (id: string) => {
    try {
      await api(`/api/chats/${id}/refresh`, { body: {} });
      toast.success('Права проверены');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const disconnect = async (id: string) => {
    if (!(await confirm('Отключить чат?', 'Новые конкурсы в нём будут недоступны. Историю мы сохраним.'))) return;
    await api(`/api/chats/${id}`, { method: 'DELETE' });
    reload();
  };
  if (!chats.length && !channels.length)
    return <Empty title="Нет подключенных чатов" text="Добавьте бота администратором в группу или канал — он появится здесь автоматически." />;
  return (
    <div className="space-y-6">
      <Table head={['Чат', 'Тип', 'Статус', 'Участники', 'Сообщений', 'Активность', '']}>
        {chats.map((c) => (
          <tr key={c.id}>
            <td className="px-3 py-2.5">
              <div className="font-medium">{c.title}</div>
              <div className="font-mono text-xs text-muted">{c.chatId}</div>
            </td>
            <td className="px-3">{c.linkedChannelChatId ? <Badge tone="accent">Обсуждение</Badge> : <Badge>{c.kind === 'GROUP' ? 'Группа' : 'Супергруппа'}</Badge>}</td>
            <td className="px-3">
              <StatusBadge status={c.status} />
            </td>
            <td className="px-3 tabular-nums">{c.memberCount ?? '—'}</td>
            <td className="px-3 tabular-nums">{fmtNum(c.messagesProcessed)}</td>
            <td className="px-3 text-xs text-muted">{fmtDate(c.lastActivityAt)}</td>
            <td className="whitespace-nowrap px-3 text-right">
              <Button size="sm" variant="ghost" onClick={() => refresh(c.id)}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => disconnect(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </td>
          </tr>
        ))}
        {channels.map((c) => (
          <tr key={c.id}>
            <td className="px-3 py-2.5">
              <div className="font-medium">{c.title}</div>
              <div className="text-xs text-muted">{c.username ? `@${c.username}` : c.chatId}</div>
            </td>
            <td className="px-3">
              <Badge tone="warn">Канал</Badge>
              {c.discussionChat && <div className="mt-1 text-[11px] text-muted">💬 {c.discussionChat.title}</div>}
            </td>
            <td className="px-3">
              <StatusBadge status={c.status} />
            </td>
            <td className="px-3 tabular-nums">{c.memberCount ?? '—'}</td>
            <td className="px-3 tabular-nums">{fmtNum(c.postsProcessed)}</td>
            <td className="px-3 text-xs text-muted">{fmtDate(c.lastActivityAt)}</td>
            <td className="whitespace-nowrap px-3 text-right">
              <Button size="sm" variant="ghost" onClick={() => refresh(c.id)}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => disconnect(c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      <p className="text-xs text-muted">Для «Первого комментария» и SMS по комментариям добавьте бота администратором и в канал, и в его группу обсуждения.</p>
    </div>
  );
}

function SmsPrizes({ bot, onSaved }: { bot: any; onSaved(): void }) {
  const gifts = useApi<any[]>('/api/gifts/catalog');
  const [defaultPrizeId, setDefault] = useState<string>(bot.defaultPrizeId ?? '');
  const [queue, setQueue] = useState<{ position: number; title: string; giftId?: string }[]>(bot.settings?.smsPrizeQueue ?? []);
  const save = async () => {
    try {
      await api(`/api/bots/${bot.id}/settings`, { method: 'PATCH', body: { defaultPrizeId: defaultPrizeId || null, smsPrizeQueue: queue.filter((q) => q.position && q.title) } });
      toast.success('Сохранено');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card className="max-w-2xl">
      <CardTitle sub="Используются командой .sms в чатах этого бота">Призы для SMS Counter</CardTitle>
      <Select label="Приз по умолчанию" value={defaultPrizeId} onChange={(e) => setDefault(e.target.value)}>
        <option value="">— не выбран —</option>
        {gifts.data?.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <div className="label mt-5">Очередь призов по позициям</div>
      <p className="mb-2 text-xs text-muted">Например: 1-й — Teddy Bear, 5-й — Premium, 10-й — Stars, 100-й — NFT.</p>
      <div className="space-y-2">
        {queue.map((q, i) => (
          <div key={i} className="flex gap-2">
            <input type="number" min={1} className="input w-24" value={q.position} onChange={(e) => setQueue(queue.map((x, j) => (j === i ? { ...x, position: Number(e.target.value) } : x)))} />
            <select className="input" value={q.giftId ?? ''} onChange={(e) => {
              const g = gifts.data?.find((x) => x.id === e.target.value);
              setQueue(queue.map((x, j) => (j === i ? { ...x, giftId: e.target.value || undefined, title: g?.name ?? x.title } : x)));
            }}>
              <option value="">Свой приз (ручная выдача)</option>
              {gifts.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input className="input" placeholder="Название приза" value={q.title} onChange={(e) => setQueue(queue.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <button onClick={() => setQueue(queue.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-bad">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setQueue([...queue, { position: (queue.at(-1)?.position ?? 0) + 1, title: '' }])}>
          Позиция
        </Button>
      </div>
      <Button className="mt-5" onClick={save}>
        Сохранить
      </Button>
    </Card>
  );
}

function SubscriptionTab({ sub, reload, confirm }: { sub: any; reload(): void; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  if (!sub) return <Empty title="Подписка не найдена" text="Бот подключен администратором платформы без подписки." />;
  const toggle = async (enabled: boolean) => {
    if (!enabled && !(await confirm('Отменить автопродление?', `Бот проработает до ${fmtDay(sub.periodEnd)}. Продлить можно в любой момент.`))) return;
    try {
      await api(`/api/billing/${sub.id}/auto-renew`, { body: { enabled } });
      toast.success(enabled ? 'Автопродление включено' : 'Автопродление отменено');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const renew = async () => {
    try {
      const r = await api<{ link: string }>(`/api/billing/${sub.id}/renew`, { body: {} });
      openInvoice(r.link, () => setTimeout(reload, 1500));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardTitle>
          {sub.plan.name} · {sub.priceStars} ⭐ / {sub.plan.periodDays} дн.
        </CardTitle>
        <dl className="space-y-2 text-sm">
          <Row k="Статус">
            <StatusBadge status={sub.status} />
          </Row>
          <Row k="Начало">{fmtDay(sub.periodStart)}</Row>
          <Row k="Окончание">{fmtDay(sub.periodEnd)}</Row>
          {sub.graceUntil && <Row k="Льготный период до">{fmtDay(sub.graceUntil)}</Row>}
        </dl>
        <div className="mt-4">
          {sub.subscriptionChargeId ? (
            <Toggle checked={sub.autoRenew && sub.status !== 'CANCELLED'} onChange={toggle} label="Автопродление Telegram Stars" hint="Списание раз в 30 дней, отмена в один клик" />
          ) : (
            <p className="text-xs text-muted">Автопродление не подключено — продлевайте вручную.</p>
          )}
        </div>
        <Button variant="gold" className="mt-4 w-full" onClick={renew}>
          {['EXPIRED', 'GRACE'].includes(sub.status) ? 'Восстановить подписку' : 'Продлить заранее'}
        </Button>
      </Card>
      <Card>
        <CardTitle>История платежей</CardTitle>
        {!sub.payments.length ? (
          <p className="text-sm text-muted">Платежей пока нет</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {sub.payments.map((p: any) => (
              <li key={p.id} className="flex justify-between border-b border-line/[0.05] pb-2">
                <span>
                  {fmtDay(p.paidAt)} {p.isRecurring && <Badge>авто</Badge>} {p.refunded && <Badge tone="bad">возврат</Badge>}
                </span>
                <span className="text-gold">⭐ {p.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BusinessTab({ connections, botUsername, reload }: { connections: any[]; botUsername: string; reload(): void }) {
  const sync = async (id: string) => {
    try {
      await api(`/api/business/${id}/sync-gifts`, { body: {} });
      toast.success('Подарки синхронизированы');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle sub="Для выдачи коллекционных (NFT) подарков из вашего аккаунта">Как подключить</CardTitle>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Нужен Telegram Premium.</li>
          <li>Настройки Telegram → Telegram для бизнеса → Чат-боты.</li>
          <li>
            Укажите <b className="text-fg">@{botUsername}</b> и включите права «Просмотр подарков и звёзд» и «Передача подарков».
          </li>
          <li>Подключение появится здесь автоматически. Сессии и пароли не используются — только официальные права Bot API.</li>
        </ol>
      </Card>
      {!connections.length ? (
        <Empty title="Нет Business-подключений" />
      ) : (
        connections.map((c) => (
          <Card key={c.id}>
            <CardTitle
              sub={`Обновлено ${fmtDate(c.lastCheckedAt)}`}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => api(`/api/business/${c.id}/refresh`, { body: {} }).then(reload)}>
                    Проверить права
                  </Button>
                  <Button size="sm" onClick={() => sync(c.id)} disabled={!c.canViewGifts}>
                    Синхронизировать подарки
                  </Button>
                </div>
              }
            >
              Аккаунт ID {c.tgUserId} {c.isEnabled ? <Badge tone="ok">активно</Badge> : <Badge tone="bad">отключено</Badge>}
            </CardTitle>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <Badge tone={c.canViewGifts ? 'ok' : 'bad'}>Просмотр подарков</Badge>
              <Badge tone={c.canTransferGifts ? 'ok' : 'bad'}>Передача подарков</Badge>
              <Badge tone={c.canTransferStars ? 'ok' : 'muted'}>Перевод Stars</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {c.ownedGifts.map((g: any) => (
                <div key={g.id} className="rounded-xl bg-elevated/50 p-3 text-sm">
                  <GiftSticker gift={{ name: g.name }} size={56} />
                  <div className="mt-2 truncate font-medium">{g.name}</div>
                  <div className="mt-1 text-xs text-muted">{g.isUnique ? (g.canBeTransferred ? `Можно передать${g.transferStarCount ? ` · ${g.transferStarCount}⭐` : ''}` : 'Передача недоступна') : 'Обычный'}</div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

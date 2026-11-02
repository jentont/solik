'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { CONTEST_TYPES, cn, fmtDate } from '@/lib/format';
import { GiftCard, type Gift } from '@/components/GiftCard';
import { GiftSticker } from '@/components/GiftSticker';
import { TypeIcon } from '@/components/TypeIcon';
import { MessageEditor, type MessageValue } from '@/components/MessageEditor';
import { TelegramPreview } from '@/components/TelegramPreview';
import { Badge, Button, Card, CardTitle, Empty, Input, Loading, Modal, PageHeader, Select, Toggle } from '@/components/ui';

const STEPS = ['Бот', 'Чат / канал', 'Тип', 'Приз', 'Условия', 'Время', 'Публикация', 'Предпросмотр', 'Запуск'];

interface Prize {
  kind: 'GIFT' | 'STARS' | 'NFT' | 'PREMIUM' | 'CUSTOM';
  title: string;
  giftId?: string;
  nftAssetId?: string;
  businessOwnedGiftId?: string;
  starsAmount?: number;
  premiumMonths?: number;
  quantity: number;
}

function Wizard() {
  const router = useRouter();
  const params = useSearchParams();
  const bots = useApi<any[]>('/api/bots');
  const [step, setStep] = useState(0);
  const [botId, setBotId] = useState('');
  const [target, setTarget] = useState<{ chatId?: string; channelId?: string }>({});
  const [postId, setPostId] = useState<number | undefined>();
  const [type, setType] = useState<string>(params.get('type') ?? 'RANDOM');
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [winnersCount, setWinners] = useState(1);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [post, setPost] = useState<MessageValue>({ text: '', buttons: [], mediaId: null, media: null });
  const [saving, setSaving] = useState(false);

  const bot = bots.data?.find((b) => b.id === botId);
  useEffect(() => {
    if (bots.data?.length && !botId) setBotId(bots.data[0].id);
  }, [bots.data, botId]);

  const t = CONTEST_TYPES[type]!;
  const needsChannel = type === 'FIRST_COMMENT';
  const needsGroup = ['MESSAGE_GIVEAWAY', 'ACTIVITY', 'DICE_777'].includes(type);
  const prizeName = prizes.map((p) => p.title).join(', ');

  const canNext = [
    !!botId,
    needsChannel ? !!target.channelId : needsGroup ? !!target.chatId : !!(target.chatId || target.channelId),
    !!type,
    prizes.length > 0 && prizes.every((p) => p.title),
    true,
    !endsAt || !startsAt || new Date(endsAt) > new Date(startsAt),
    !!title,
    true,
    true,
  ][step];

  const submit = async (start: boolean) => {
    setSaving(true);
    try {
      const contest = await api<{ id: string }>('/api/contests', {
        body: {
          botId,
          ...target,
          channelPostId: postId,
          type,
          title,
          config,
          winnersCount,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          postText: post.text || null,
          postMediaId: post.mediaId ?? null,
          postButtons: post.buttons.filter((b) => b.text && b.url),
          prizes: prizes.map((p, i) => ({ ...p, place: i + 1 })),
        },
      });
      if (start) {
        await api(`/api/contests/${contest.id}/start`, { body: {} });
        toast.success(startsAt && new Date(startsAt) > new Date() ? 'Конкурс запланирован' : 'Конкурс опубликован 🎉');
      } else toast.success('Черновик сохранён');
      router.push(`/contests/${contest.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (bots.loading && !bots.data) return <Loading />;

  return (
    <>
      <PageHeader title="Новый конкурс" sub={t.label} />
      <div className="scroll-thin mb-6 flex gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => i < step && setStep(i)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition',
              i === step ? 'border-accent bg-accent/15 text-fg' : i < step ? 'border-line/10 text-fg' : 'border-line/[0.06] text-muted',
            )}
          >
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', i < step ? 'bg-ok text-black' : 'bg-line/10')}>{i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
          {step === 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              {bots.data?.map((b) => (
                <button key={b.id} onClick={() => setBotId(b.id)} className={cn('card p-4 text-left transition', botId === b.id ? 'border-accent shadow-glow' : 'hover:border-line/20')}>
                  <div className="flex items-center gap-2 font-medium">
                    @{b.username} {b.isPlatform ? <Badge tone="accent">SOLIK</Badge> : <Badge tone="warn">Свой бот</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {b.chats.length} чатов · {b.channels.length} каналов
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 1 && bot && <TargetStep bot={bot} type={type} target={target} setTarget={setTarget} postId={postId} setPostId={setPostId} />}

          {step === 2 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(CONTEST_TYPES)
                .filter(([k]) => k !== 'SMS_COUNTER')
                .map(([k, v]) => (
                  <button key={k} onClick={() => setType(k)} className={cn('card p-4 text-left transition', type === k ? 'border-accent shadow-glow' : 'hover:border-line/20')}>
                    <TypeIcon type={k} size={40} />
                    <div className="mt-2 font-medium">{v.label}</div>
                    <div className="mt-1 text-xs text-muted">{v.hint}</div>
                  </button>
                ))}
              <button onClick={() => router.push('/sms')} className="card p-4 text-left hover:border-line/20">
                <TypeIcon type="SMS_COUNTER" size={40} />
                <div className="mt-2 font-medium">SMS Counter</div>
                <div className="mt-1 text-xs text-muted">Запускается в разделе SMS Counter или командой .sms в чате</div>
              </button>
            </div>
          )}

          {step === 3 && <PrizeStep prizes={prizes} setPrizes={setPrizes} winnersCount={winnersCount} setWinners={setWinners} type={type} />}
          {step === 4 && <ConditionsStep type={type} config={config} setConfig={setConfig} />}

          {step === 5 && (
            <Card className="max-w-xl space-y-4">
              <Input label="Начало (пусто — сразу)" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              <Input
                label={type === 'STARS_AUCTION' ? 'Окончание (до первой ставки; потом таймер продлевается)' : 'Подведение итогов'}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                hint={['FIRST_COMMENT', 'DICE_777', 'MESSAGE_GIVEAWAY'].includes(type) ? 'Необязательно: конкурс завершится, когда будут разыграны все призы' : 'Таймер хранится на сервере и переживает перезапуск'}
              />
            </Card>
          )}

          {step === 6 && <PostStep title={title} setTitle={setTitle} post={post} setPost={setPost} prizeName={prizeName} giftId={prizes.find((p) => p.giftId)?.giftId ?? null} winnersCount={winnersCount} endsAt={endsAt} channelName={bot?.channels.find((c: any) => c.id === target.channelId)?.title} autoAi={params.get('ai') === '1'} />}

          {step === 7 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle>Сводка</CardTitle>
                <dl className="space-y-2 text-sm">
                  {[
                    ['Бот', `@${bot?.username}`],
                    ['Тип', t.label],
                    ['Приз', prizeName],
                    ['Победителей', winnersCount],
                    ['Старт', startsAt ? fmtDate(startsAt) : 'Сразу'],
                    ['Итоги', endsAt ? fmtDate(endsAt) : '—'],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between border-b border-line/[0.05] pb-2">
                      <dt className="text-muted">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <div>
                <div className="label">Так пост будет выглядеть в Telegram</div>
                <TelegramPreview
                  text={post.text || `🎁 <b>${title}</b>\n\nПриз: <b>${prizeName}</b>\nУчаствуйте!`}
                  media={post.media}
                  buttons={[...(['RANDOM', 'GIFTS', 'NFT'].includes(type) ? [[{ text: config.joinButtonText || '🎁 Участвовать' }]] : []), ...(type === 'STARS_AUCTION' && config.bidMode !== 'paid_messages' ? [[{ text: '⭐ Перебить ставку' }]] : []), ...post.buttons.map((b) => [b])]}
                  botName={bot?.name}
                  vars={{ contest_name: title, prize_name: prizeName }}
                />
              </div>
            </div>
          )}

          {step === 8 && (
            <Card className="max-w-xl text-center">
              <TypeIcon type={type} size={56} className="mx-auto mb-4" />
              <h3 className="font-display text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted">Бот опубликует пост и начнёт отслеживать участников. Убедитесь, что он администратор с правом публикации.</p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button variant="secondary" loading={saving} onClick={() => submit(false)}>
                  Сохранить черновик
                </Button>
                <Button loading={saving} onClick={() => submit(true)} icon={<Sparkles className="h-4 w-4" />}>
                  {startsAt && new Date(startsAt) > new Date() ? 'Запланировать' : 'Опубликовать'}
                </Button>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>

      {step < 8 && (
        <div className="mt-8 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)} icon={<ArrowLeft className="h-4 w-4" />}>
            Назад
          </Button>
          <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
            Далее <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  );
}

function TargetStep({ bot, type, target, setTarget, postId, setPostId }: any) {
  const needsChannel = type === 'FIRST_COMMENT';
  const posts = useApi<any[]>(target.channelId && needsChannel ? `/api/channels/${target.channelId}/posts` : null, [target.channelId]);
  if (!bot.chats.length && !bot.channels.length)
    return <Empty title="Нет подключенных чатов" text={`Добавьте @${bot.username} администратором в группу или канал. Чат появится автоматически.`} />;
  return (
    <div className="space-y-6">
      {!needsChannel && bot.chats.length > 0 && (
        <div>
          <div className="label">Группы</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {bot.chats.map((c: any) => (
              <button key={c.id} onClick={() => setTarget({ chatId: c.id })} className={cn('card p-3 text-left text-sm', target.chatId === c.id ? 'border-accent shadow-glow' : '')}>
                💬 {c.title} <span className="text-xs text-muted">{c.status !== 'ACTIVE' && `· ${c.status}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!['MESSAGE_GIVEAWAY', 'ACTIVITY', 'DICE_777'].includes(type) && bot.channels.length > 0 && (
        <div>
          <div className="label">Каналы</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {bot.channels.map((c: any) => (
              <button key={c.id} onClick={() => (setTarget({ channelId: c.id }), setPostId(undefined))} className={cn('card p-3 text-left text-sm', target.channelId === c.id ? 'border-accent shadow-glow' : '')}>
                📢 {c.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {needsChannel && target.channelId && (
        <Card>
          <CardTitle sub="Бот видит посты, вышедшие после его добавления в канал">Публикация</CardTitle>
          <button onClick={() => setPostId(undefined)} className={cn('mb-2 w-full rounded-xl border p-3 text-left text-sm', !postId ? 'border-accent bg-accent/10' : 'border-line/10')}>
            ✨ Новый пост — бот опубликует конкурс сам
          </button>
          {posts.data?.map((p) => (
            <button key={p.id} onClick={() => setPostId(p.messageId)} className={cn('mb-2 w-full rounded-xl border p-3 text-left text-sm', postId === p.messageId ? 'border-accent bg-accent/10' : 'border-line/10')}>
              <div className="flex justify-between text-xs text-muted">
                <span>#{p.messageId}</span>
                <span>{fmtDate(p.postedAt)}</span>
              </div>
              <div className="mt-1 line-clamp-2">{p.text || 'Медиа без подписи'}</div>
              {!p.discussionMessageId && <div className="mt-1 text-xs text-warn">Ветка комментариев не найдена — добавьте бота в группу обсуждения</div>}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

function PrizeStep({ prizes, setPrizes, winnersCount, setWinners, type }: any) {
  const gifts = useApi<Gift[]>('/api/gifts/catalog');
  const nft = useApi<any>('/api/nft');
  const biz = useApi<any[]>('/api/business');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [custom, setCustom] = useState<Prize>({ kind: 'STARS', title: '', quantity: 1 });
  const list = (gifts.data ?? []).filter((g) => (!q || g.name.toLowerCase().includes(q.toLowerCase())) && (!filter || g.type === filter));
  const toggleGift = (g: Gift) =>
    setPrizes(prizes.some((p: Prize) => p.giftId === g.id) ? prizes.filter((p: Prize) => p.giftId !== g.id) : [...prizes, { kind: 'GIFT', title: g.name, giftId: g.id, quantity: 1 }]);
  const ownedGifts = (biz.data ?? []).flatMap((c) => c.ownedGifts.filter((g: any) => g.isUnique && g.canBeTransferred));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex gap-2">
          <input className="input" placeholder="Поиск подарка" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-44" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Все типы</option>
            <option value="REGULAR">Обычные</option>
            <option value="LIMITED">Лимитированные</option>
            <option value="COLLECTIBLE">Коллекционные</option>
            <option value="NFT">NFT</option>
            <option value="REMOVED">Удалённые</option>
          </select>
        </div>
        {gifts.loading ? (
          <Loading />
        ) : !list.length ? (
          <Empty title="Каталог пуст" text="Администратор платформы ещё не импортировал подарки. Вы можете добавить Stars, Premium или свой приз справа." />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {list.map((g) => (
              <GiftCard key={g.id} gift={g} selected={prizes.some((p: Prize) => p.giftId === g.id)} onClick={() => toggleGift(g)} />
            ))}
          </div>
        )}
        {ownedGifts.length > 0 && (
          <>
            <div className="label mt-6">Из вашего аккаунта (Telegram Business)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ownedGifts.map((g: any) => (
                <button
                  key={g.id}
                  onClick={() => setPrizes([...prizes, { kind: 'GIFT', title: g.name, businessOwnedGiftId: g.id, quantity: 1 }])}
                  className="card p-3 text-left text-sm hover:border-accent"
                >
                  <GiftSticker gift={{ name: g.name }} size={56} />
                  <div className="mt-2 truncate font-medium">{g.name}</div>
                  <div className="text-xs text-ok">Передаётся из вашего аккаунта</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="space-y-4">
        <Card>
          <CardTitle>Призы</CardTitle>
          {!prizes.length && <p className="text-sm text-muted">Выберите подарок или добавьте приз</p>}
          <ul className="space-y-2">
            {prizes.map((p: Prize, i: number) => (
              <li key={i} className="flex items-center gap-2 rounded-xl bg-elevated/50 p-2 text-sm">
                <span className="w-5 text-center text-xs text-muted">{i + 1}</span>
                <input className="input h-8 flex-1 py-1" value={p.title} onChange={(e) => setPrizes(prizes.map((x: Prize, j: number) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <input type="number" min={1} title="Количество" className="input h-8 w-16 py-1" value={p.quantity} onChange={(e) => setPrizes(prizes.map((x: Prize, j: number) => (j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x)))} />
                <button onClick={() => setPrizes(prizes.filter((_: Prize, j: number) => j !== i))} className="text-muted hover:text-bad">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {type !== 'STARS_AUCTION' && (
            <Input className="mt-4" label="Количество победителей" type="number" min={1} value={winnersCount} onChange={(e) => setWinners(Math.max(1, Number(e.target.value)))} />
          )}
        </Card>
        <Card>
          <CardTitle>Другой приз</CardTitle>
          <div className="space-y-2">
            <Select value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value as Prize['kind'] })}>
              <option value="STARS">Telegram Stars</option>
              <option value="PREMIUM">Telegram Premium</option>
              <option value="NFT">NFT</option>
              <option value="CUSTOM">Свой приз</option>
            </Select>
            {custom.kind === 'STARS' && <Input type="number" placeholder="Количество Stars" value={custom.starsAmount ?? ''} onChange={(e) => setCustom({ ...custom, starsAmount: Number(e.target.value), title: `${e.target.value} Stars` })} />}
            {custom.kind === 'PREMIUM' && (
              <Select value={custom.premiumMonths ?? ''} onChange={(e) => setCustom({ ...custom, premiumMonths: Number(e.target.value), title: `Telegram Premium ${e.target.value} мес.` })}>
                <option value="">Срок</option>
                <option value="3">3 месяца</option>
                <option value="6">6 месяцев</option>
                <option value="12">12 месяцев</option>
              </Select>
            )}
            {custom.kind === 'NFT' && (
              <Select value={custom.nftAssetId ?? ''} onChange={(e) => setCustom({ ...custom, nftAssetId: e.target.value, title: nft.data?.assets.find((a: any) => a.id === e.target.value)?.name ?? '' })}>
                <option value="">Выберите NFT</option>
                {nft.data?.assets.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
            {custom.kind === 'CUSTOM' && <Input placeholder="Название приза" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />}
            <Button size="sm" variant="secondary" className="w-full" icon={<Plus className="h-3.5 w-3.5" />} disabled={!custom.title} onClick={() => (setPrizes([...prizes, custom]), setCustom({ kind: 'STARS', title: '', quantity: 1 }))}>
              Добавить
            </Button>
            {custom.kind === 'STARS' && <p className="text-xs text-muted">Bot API не умеет переводить Stars пользователям — выдача будет ручной, с напоминанием.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ConditionsStep({ type, config, setConfig }: { type: string; config: Record<string, any>; setConfig(c: Record<string, any>): void }) {
  const set = (k: string, v: unknown) => setConfig({ ...config, [k]: v });
  const num = (k: string, label: string, def: number, hint?: string, step = 1) => (
    <Input label={label} type="number" step={step} value={config[k] ?? def} onChange={(e) => set(k, Number(e.target.value))} hint={hint} />
  );
  return (
    <Card className="max-w-2xl space-y-4">
      {['RANDOM', 'GIFTS', 'NFT'].includes(type) && (
        <>
          <Input label="Текст кнопки участия" value={config.joinButtonText ?? '🎁 Участвовать'} onChange={(e) => set('joinButtonText', e.target.value)} />
          <Input
            label="Обязательные подписки (через запятую)"
            placeholder="@channel1, @channel2"
            value={(config.requiredChats ?? []).join(', ')}
            onChange={(e) => set('requiredChats', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            hint="Бот должен быть администратором этих каналов, чтобы проверять подписку"
          />
          <Toggle checked={config.ignoreOwner ?? true} onChange={(v) => set('ignoreOwner', v)} label="Не допускать организатора" />
        </>
      )}
      {type === 'STARS_AUCTION' && (
        <>
          <Select label="Как делаются ставки" value={config.bidMode ?? 'invoice'} onChange={(e) => set('bidMode', e.target.value)}>
            <option value="invoice">Оплата Stars боту (кнопка «Перебить»)</option>
            <option value="paid_messages">Платные сообщения в чате («Сообщение за N ⭐»)</option>
          </Select>
          {config.bidMode === 'paid_messages' ? (
            <>
              <p className="rounded-xl bg-elevated/60 p-3 text-xs text-muted">
                Включите в настройках группы «Платные сообщения». Каждое оплаченное сообщение делает автора лидером и сбрасывает таймер. Stars получает владелец чата по правилам Telegram, обычные сообщения не засчитываются.
              </p>
              {num('minPaidStars', 'Минимальная оплата сообщения, ⭐', 1)}
            </>
          ) : (
            <>
              {num('startBid', 'Начальная ставка, ⭐', 10)}
              {num('minStep', 'Минимальная перебивка, ⭐', 1)}
              <Toggle checked={config.refundOutbid ?? false} onChange={(v) => set('refundOutbid', v)} label="Возвращать Stars перебитым участникам" hint="Классический аукцион: платит только победитель" />
            </>
          )}
          {num('extendSeconds', 'Таймер после каждой ставки, сек', 180)}
          <Select label="Обратный отсчёт" value={config.countdownStyle ?? 'messages'} onChange={(e) => set('countdownStyle', e.target.value)}>
            <option value="messages">Отдельные сообщения 10…1</option>
            <option value="edit">Одно сообщение, обновляется</option>
          </Select>
          <p className="text-xs text-muted">Предупреждения отправляются за 60 и 30 секунд. Все платежи проверяются и пишутся в БД, повторные webhook-запросы игнорируются.</p>
        </>
      )}
      {type === 'FIRST_COMMENT' && (
        <>
          <Toggle checked={config.countAdmins ?? false} onChange={(v) => set('countAdmins', v)} label="Учитывать администраторов" />
          <Toggle checked={config.ignoreOwner ?? true} onChange={(v) => set('ignoreOwner', v)} label="Игнорировать владельца" />
          <p className="text-xs text-muted">Боты игнорируются всегда. Учитываются только комментарии к выбранному посту, а победитель получает ответ прямо на свой комментарий.</p>
        </>
      )}
      {type === 'MESSAGE_GIVEAWAY' && (
        <>
          <Select label="Режим" value={config.trigger ?? 'every_n_random'} onChange={(e) => set('trigger', e.target.value)}>
            <option value="every_n_random">Каждые N сообщений — случайному активному</option>
            <option value="every_n_author">Каждое N-е сообщение — его автору</option>
            <option value="chance">Шанс на каждое сообщение (NFT за активность)</option>
            <option value="threshold">Достижение порога сообщений</option>
            <option value="first_message">Первое сообщение</option>
          </Select>
          {(config.trigger ?? 'every_n_random').startsWith('every_n') && num('everyMessages', 'N сообщений', 100)}
          {config.trigger === 'every_n_random' && num('windowMinutes', 'Окно активности, мин', 60)}
          {config.trigger === 'chance' && (
            <>
              {num('chancePercent', 'Шанс выигрыша, %', 0.9, 'Например, 0.9 — как в «Шанс был: 0,9%»', 0.1)}
              {num('dailyLimit', 'Подарков в день', 56)}
            </>
          )}
          {config.trigger === 'threshold' && num('threshold', 'Порог сообщений', 50)}
          <AntiSpam config={config} set={set} />
        </>
      )}
      {type === 'ACTIVITY' && (
        <>
          <Select label="Кто побеждает" value={config.activityMode ?? 'most_active'} onChange={(e) => set('activityMode', e.target.value)}>
            <option value="most_active">Самый активный</option>
            <option value="random">Случайный активный участник</option>
            <option value="weighted">Случайный с весом по активности</option>
            <option value="threshold">Розыгрыш среди достигших порога</option>
          </Select>
          {num('minMessages', 'Минимум сообщений для участия', 5)}
          <AntiSpam config={config} set={set} />
        </>
      )}
      {type === 'DICE_777' && (
        <>
          <p className="rounded-xl bg-elevated/60 p-3 text-sm">
            🎰 Участники отправляют слот-машину. Три семёрки — победа. Результат генерирует Telegram, а пересланные кубики не засчитываются.
          </p>
          {num('cooldownSec', 'Пауза между попытками, сек', 0)}
          {num('maxSpinsPerUser', 'Максимум попыток на участника (0 — без лимита)', 0)}
        </>
      )}
    </Card>
  );
}

function AntiSpam({ config, set }: { config: Record<string, any>; set(k: string, v: unknown): void }) {
  return (
    <div className="rounded-xl border border-line/[0.07] p-3">
      <div className="label">Защита от спама</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Мин. длина" type="number" value={config.minLength ?? 3} onChange={(e) => set('minLength', Number(e.target.value))} />
        <Input label="Интервал, сек" type="number" value={config.minIntervalSec ?? 3} onChange={(e) => set('minIntervalSec', Number(e.target.value))} />
      </div>
      <Toggle checked={config.ignoreDuplicates ?? true} onChange={(v) => set('ignoreDuplicates', v)} label="Игнорировать повторы" />
      <Toggle checked={config.countAdmins ?? false} onChange={(v) => set('countAdmins', v)} label="Учитывать администраторов" />
    </div>
  );
}

function PostStep({ title, setTitle, post, setPost, prizeName, giftId, winnersCount, endsAt, channelName, autoAi }: any) {
  const [aiOpen, setAiOpen] = useState(autoAi);
  const [imgOpen, setImgOpen] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Input label="Название конкурса" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => setAiOpen(true)} disabled={!title}>
            AI-текст
          </Button>
          <Button variant="secondary" size="sm" icon={<ImagePlus className="h-3.5 w-3.5" />} onClick={() => setImgOpen(true)} disabled={!title}>
            AI-картинка
          </Button>
        </div>
        <MessageEditor value={post} onChange={setPost} rows={10} />
        <p className="text-xs text-muted">Пусто — будет использован шаблон «Старт конкурса».</p>
      </div>
      <div className="lg:sticky lg:top-8 lg:self-start">
        <div className="label">Предпросмотр</div>
        <TelegramPreview text={post.text || `🎁 <b>${title || 'Конкурс'}</b>\n\nПриз: <b>${prizeName}</b>`} media={post.media} buttons={post.buttons.map((b: any) => [b])} vars={{ contest_name: title, prize_name: prizeName }} />
      </div>
      <AiTextModal open={aiOpen} onClose={() => setAiOpen(false)} defaults={{ title, prize: prizeName, winners: winnersCount, date: endsAt ? fmtDate(endsAt) : '', channel: channelName }} onApply={(text: string) => setPost({ ...post, text })} />
      <AiImageModal open={imgOpen} onClose={() => setImgOpen(false)} defaults={{ title, prize: prizeName, giftId, date: endsAt ? fmtDate(endsAt) : '' }} onApply={(m: any) => setPost({ ...post, mediaId: m.mediaId, media: { url: m.url, kind: 'PHOTO' } })} />
    </div>
  );
}

async function pollJob(id: string) {
  for (let i = 0; i < 90; i++) {
    const j = await api<any>(`/api/ai/jobs/${id}`);
    if (j.status === 'DONE') return j.output;
    if (j.status === 'FAILED') throw new Error(j.error || 'Генерация не удалась');
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Превышено время ожидания');
}

function AiTextModal({ open, onClose, defaults, onApply }: any) {
  const [form, setForm] = useState({ conditions: '', extra: '', tone: 'hype' });
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try {
      const job = await api('/api/ai/generate', { body: { ...defaults, winners: defaults.winners || undefined, date: defaults.date || undefined, channel: defaults.channel || undefined, ...form } });
      setOut(await pollJob(job.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const variants = out ? [['Полный пост', out.post], ['Основной текст', `<b>${out.headline}</b>\n\n${out.text}\n\n${out.cta}`], ['Кратко', out.short]] : [];
  return (
    <Modal open={open} onClose={onClose} title="AI-генерация публикации" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Условия" value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} placeholder="Подписка на канал, комментарий…" />
        <Select label="Тон" value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}>
          <option value="hype">Хайповый</option>
          <option value="friendly">Дружелюбный</option>
          <option value="formal">Деловой</option>
          <option value="minimal">Минимализм</option>
        </Select>
      </div>
      <Input className="mt-3" label="Дополнительно" value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} />
      <Button className="mt-4" loading={busy} onClick={gen} icon={<Sparkles className="h-4 w-4" />}>
        {out ? 'Перегенерировать' : 'Сгенерировать'}
      </Button>
      {out && (
        <div className="mt-5 space-y-3">
          {variants.map(([label, text]) => (
            <div key={label} className="rounded-xl border border-line/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label mb-0">{label}</span>
                <Button size="sm" onClick={() => (onApply(text), onClose())}>
                  Использовать
                </Button>
              </div>
              <div className="tg-msg whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: String(text).replace(/</g, '&lt;').replace(/&lt;(\/?(b|i|u|s|tg-spoiler|blockquote))>/g, '<$1>') }} />
            </div>
          ))}
          <p className="text-xs text-muted">Описание для анонса: {out.description}</p>
        </div>
      )}
    </Modal>
  );
}

function AiImageModal({ open, onClose, defaults, onApply }: any) {
  const tpls = useApi<{ id: string; label: string }[]>(open ? '/api/ai/templates' : null, [open]);
  const [form, setForm] = useState({ template: 'cartoon', theme: '', useAi: true, usePlatformLogo: false });
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try {
      const job = await api('/api/ai/image', { body: { ...form, title: defaults.title.slice(0, 80), prize: (defaults.prize || 'Приз').slice(0, 60), date: defaults.date || undefined, giftId: defaults.giftId ?? null } });
      setOut(await pollJob(job.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Изображение конкурса" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Стиль" value={form.template} onChange={(e) => setForm({ ...form, template: e.target.value })}>
          {tpls.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </Select>
        <Input label="Тема / сюжет" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} placeholder="Кот с горой корма, сундук с золотом…" />
      </div>
      <Toggle checked={form.useAi} onChange={(v) => setForm({ ...form, useAi: v })} label="AI-иллюстрация (Gemini)" hint="Чистая картинка без текста — текст идёт в подпись поста. Выключено — фирменная карточка с настоящим подарком-призом" />
      <Toggle checked={form.usePlatformLogo} onChange={(v) => setForm({ ...form, usePlatformLogo: v })} label="Добавить логотип SOLIK" hint="Для White-Label обычно выключено" />
      <Button className="mt-3" loading={busy} onClick={gen} icon={<Sparkles className="h-4 w-4" />}>
        {out ? 'Перегенерировать' : 'Создать'}
      </Button>
      {out && (
        <div className="mt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={out.url} alt="" className="w-full rounded-xl" />
          {out.note && <p className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">{out.note}</p>}
          <Button className="mt-3 w-full" onClick={() => (onApply(out), onClose())}>
            Использовать
          </Button>
        </div>
      )}
    </Modal>
  );
}

export default function NewContestPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Wizard />
    </Suspense>
  );
}

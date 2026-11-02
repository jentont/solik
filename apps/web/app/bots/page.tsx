'use client';

import { Bot, Crown, ExternalLink, KeyRound, MessageSquare, Plus, Radio, Star } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { openInvoice, useAuth } from '@/lib/auth';
import { fmtDay, fmtNum } from '@/lib/format';
import { Badge, Button, Card, Empty, ErrorState, Input, Loading, Modal, PageHeader, StatusBadge } from '@/components/ui';

interface BotRow {
  id: string;
  username: string;
  name: string;
  telegramId: string;
  isPlatform: boolean;
  status: string;
  lastError: string | null;
  chats: { id: string; title: string; status: string }[];
  channels: { id: string; title: string; status: string }[];
  contestsCount: number;
  participantsCount: number;
  subscription: { id: string; status: string; periodEnd: string | null; autoRenew: boolean } | null;
}

export default function BotsPage() {
  const { platformBot } = useAuth();
  const { data, error, loading, reload } = useApi<BotRow[]>('/api/bots');
  const billing = useApi<{ plans: { id: string; name: string; priceStars: number; periodDays: number; isDefault: boolean }[]; subscriptions: { id: string; bot: unknown; usable: boolean }[] }>('/api/billing');
  const [connectOpen, setConnectOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const freeSlots = billing.data?.subscriptions.filter((s) => !s.bot && s.usable).length ?? 0;
  const plan = billing.data?.plans.find((p) => p.isDefault) ?? billing.data?.plans[0];

  const buy = async () => {
    setBusy(true);
    try {
      const r = await api<{ link: string }>('/api/billing/subscribe', { body: { planId: plan?.id, autoRenew: true } });
      openInvoice(r.link, () => {
        toast.success('Оплата прошла! Теперь подключите бота.');
        setTimeout(() => (billing.reload(), setConnectOpen(true)), 1500);
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      await api('/api/bots', { body: { token } });
      toast.success('Бот подключен');
      setToken('');
      setConnectOpen(false);
      await Promise.all([reload(), billing.reload()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const platform = data?.find((b) => b.isPlatform);
  const own = data?.filter((b) => !b.isPlatform) ?? [];

  return (
    <>
      <PageHeader
        title="Мои боты"
        sub="Бесплатно — через бота SOLIK в ваших чатах. Или собственный White-Label бот под вашим брендом."
        action={
          freeSlots > 0 ? (
            <Button icon={<KeyRound className="h-4 w-4" />} onClick={() => setConnectOpen(true)}>
              Подключить бота
            </Button>
          ) : (
            <Button variant="gold" loading={busy} icon={<Crown className="h-4 w-4" />} onClick={buy} disabled={!plan}>
              Свой бот · {plan?.priceStars ?? 100} Stars в месяц
            </Button>
          )
        }
      />
      {error && <ErrorState error={error} retry={reload} />}
      {loading && !data && <Loading />}

      {platform && (
        <Card className="mb-6 overflow-hidden">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky/12 text-sky">
              <Bot className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-semibold">@{platform.username}</h3>
                <Badge tone="accent">Бесплатно</Badge>
              </div>
              <p className="mt-1 text-[15px] text-muted">Добавьте бота администратором в свой чат или канал — он автоматически появится здесь, и в нём можно запускать любые конкурсы.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {platform.chats.map((c) => (
                  <Badge key={c.id}>
                    <MessageSquare className="h-3 w-3" /> {c.title}
                  </Badge>
                ))}
                {platform.channels.map((c) => (
                  <Badge key={c.id}>
                    <Radio className="h-3 w-3" /> {c.title}
                  </Badge>
                ))}
                {!platform.chats.length && !platform.channels.length && <span className="text-[13px] text-muted">Пока нет подключенных чатов</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-col">
              <a href={`https://t.me/${platformBot?.username ?? platform.username}?startgroup=solik&admin=post_messages+delete_messages+pin_messages+manage_chat`} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />}>
                  Добавить в группу
                </Button>
              </a>
              <a href={`https://t.me/${platformBot?.username ?? platform.username}?startchannel=solik&admin=post_messages+edit_messages+delete_messages`} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm" icon={<Radio className="h-3.5 w-3.5" />}>
                  Добавить в канал
                </Button>
              </a>
            </div>
          </div>
        </Card>
      )}

      <h2 className="mb-3 font-display text-lg font-semibold">Собственные боты</h2>
      {data && !own.length && (
        <Empty
          icon={<Star className="h-6 w-6 text-gold" />}
          title="Бот с вашим названием, аватаром и стилем"
          text={`Без упоминаний SOLIK: своё приветствие, меню, команды, шаблоны, Premium Emoji и GIF. ${plan?.priceStars ?? 100} Stars за ${plan?.periodDays ?? 30} дней, отмена в любой момент.`}
          action={
            freeSlots > 0 ? (
              <Button onClick={() => setConnectOpen(true)}>Подключить бота</Button>
            ) : (
              <Button variant="gold" loading={busy} onClick={buy} disabled={!plan}>
                Оформить за {plan?.priceStars ?? 100} Stars
              </Button>
            )
          }
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {own.map((b) => (
          <Card key={b.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-display font-semibold">{b.name}</h3>
                  <StatusBadge status={b.status} />
                </div>
                <a href={`https://t.me/${b.username}`} target="_blank" rel="noreferrer" className="text-[15px] text-accent">
                  @{b.username} <ExternalLink className="inline h-3 w-3" />
                </a>
                <div className="mt-0.5 font-mono text-[13px] text-muted">ID {b.telegramId}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              {[
                ['Чаты', b.chats.length],
                ['Каналы', b.channels.length],
                ['Конкурсы', b.contestsCount],
                ['Участники', b.participantsCount],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-elevated/50 py-2">
                  <div className="font-display text-lg font-bold">{fmtNum(v as number)}</div>
                  <div className="text-[13px] text-muted">{l}</div>
                </div>
              ))}
            </div>
            {b.subscription && (
              <div className="mt-3 flex items-center justify-between text-[13px] text-muted">
                <span>
                  Подписка: <StatusBadge status={b.subscription.status} />
                </span>
                <span>до {fmtDay(b.subscription.periodEnd)}</span>
              </div>
            )}
            {b.lastError && <p className="mt-2 truncate text-[13px] text-warn">Ошибка: {b.lastError}</p>}
            <Link href={`/bots/${b.id}`} className="mt-4 block">
              <Button variant="secondary" className="w-full">
                Управление
              </Button>
            </Link>
          </Card>
        ))}
      </div>

      <Modal open={connectOpen} onClose={() => setConnectOpen(false)} title="Подключение собственного бота">
        <ol className="mb-5 list-decimal space-y-1.5 pl-5 text-[15px] text-muted">
          <li>
            Откройте{' '}
            <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent">
              @BotFather
            </a>{' '}
            → /newbot
          </li>
          <li>Задайте название и username</li>
          <li>Скопируйте токен и вставьте ниже</li>
        </ol>
        <Input label="Токен BotFather" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
        <p className="mt-2 text-[13px] text-muted">Токен шифруется (AES-256-GCM) и больше нигде не показывается.</p>
        <Button className="mt-5 w-full" loading={busy} disabled={token.length < 30} onClick={connect}>
          Подключить
        </Button>
      </Modal>
    </>
  );
}

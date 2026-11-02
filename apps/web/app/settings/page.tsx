'use client';

import { Crown } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { openInvoice, useAuth } from '@/lib/auth';
import { fmtDay } from '@/lib/format';
import { Badge, Button, Card, CardTitle, Empty, PageHeader, StatusBadge, Table } from '@/components/ui';

export default function SettingsPage() {
  const { user, logout, inTelegram } = useAuth();
  const { data, reload } = useApi<any>('/api/billing');

  const buy = async (planId: string) => {
    try {
      const r = await api<{ link: string }>('/api/billing/subscribe', { body: { planId, autoRenew: true } });
      openInvoice(r.link, () => setTimeout(reload, 1500));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Настройки" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardTitle>Аккаунт</CardTitle>
          <div className="space-y-1 text-sm">
            <div>{user?.firstName}</div>
            <div className="text-muted">{user?.username ? `@${user.username}` : ''}</div>
            <div className="font-mono text-xs text-muted">Telegram ID {user?.telegramId}</div>
            <div className="pt-2">
              <Badge tone={user?.role === 'USER' ? 'muted' : 'warn'}>{user?.role === 'OWNER' ? 'Владелец платформы' : user?.role === 'ADMIN' ? 'Администратор' : 'Пользователь'}</Badge>
            </div>
          </div>
          {!inTelegram && (
            <Button variant="secondary" className="mt-5" onClick={logout}>
              Выйти
            </Button>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle sub="Основные функции платформы бесплатны. Платно только собственный White-Label бот.">Тарифы</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line/10 p-4">
              <div className="font-display font-semibold">Free</div>
              <div className="mt-1 text-sm text-muted">Бот SOLIK в ваших чатах: все типы конкурсов, SMS Counter, подарки, AI, аналитика.</div>
              <Badge tone="ok" className="mt-3">
                Активен
              </Badge>
            </div>
            {data?.plans.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-gold/30 bg-gold/5 p-4">
                <div className="flex items-center gap-2 font-display font-semibold">
                  <Crown className="h-4 w-4 text-gold" /> {p.name}
                </div>
                <div className="mt-1 text-sm text-muted">Собственный бот под вашим брендом. За одного бота.</div>
                <div className="mt-3 font-display text-2xl font-bold text-gold">
                  {p.priceStars} ⭐ <span className="text-sm font-normal text-muted">/ {p.periodDays} дн.</span>
                </div>
                <Button variant="gold" size="sm" className="mt-3" onClick={() => buy(p.id)}>
                  Оформить
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <h2 className="mb-3 mt-8 font-display text-lg font-semibold">Мои подписки</h2>
      {!data?.subscriptions.length ? (
        <Empty title="Подписок нет" />
      ) : (
        <Table head={['Бот', 'Тариф', 'Статус', 'Период', 'Автопродление', 'Платежей']}>
          {data.subscriptions.map((s: any) => (
            <tr key={s.id}>
              <td className="px-3 py-2.5">
                {s.bot ? (
                  <Link href={`/bots/${s.bot.id}`} className="text-accent">
                    @{s.bot.username}
                  </Link>
                ) : (
                  <Link href="/bots" className="text-warn">
                    Подключить бота →
                  </Link>
                )}
              </td>
              <td className="px-3">
                {s.plan.name} · {s.priceStars} ⭐
              </td>
              <td className="px-3">
                <StatusBadge status={s.status} />
              </td>
              <td className="px-3 text-xs text-muted">
                {fmtDay(s.periodStart)} — {fmtDay(s.periodEnd)}
              </td>
              <td className="px-3 text-xs">{s.subscriptionChargeId ? (s.autoRenew && s.status !== 'CANCELLED' ? 'Включено' : 'Отменено') : 'Вручную'}</td>
              <td className="px-3">{s.payments.length}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

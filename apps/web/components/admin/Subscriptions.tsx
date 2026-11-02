'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { fmtDate, fmtDay, fmtNum } from '@/lib/format';
import { Badge, Button, Card, CardTitle, Input, Loading, Modal, Pager, StatusBadge, Table, Toggle, useConfirm } from '@/components/ui';

export function AdminSubscriptions({ isOwner }: { isOwner: boolean }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useApi<any>(`/api/admin/subscriptions?page=${page}${status ? `&status=${status}` : ''}`, [status, page]);
  const revenue = (data?.payments ?? []).filter((p: any) => !p.refunded).reduce((s: number, p: any) => s + p.amount, 0);
  return (
    <div className="space-y-6">
      <Plans isOwner={isOwner} />
      <Card>
        <CardTitle sub={`Последние 50 платежей: ${fmtNum(revenue)} Stars`}>Подписки</CardTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          {['', 'ACTIVE', 'GRACE', 'CANCELLED', 'EXPIRED'].map((s) => (
            <Button key={s} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => (setStatus(s), setPage(1))}>
              {s ? <StatusBadge status={s} /> : 'Все'}
              {s && data?.byStatus && <span className="text-[13px]">{data.byStatus.find((b: any) => b.status === s)?._count ?? 0}</span>}
            </Button>
          ))}
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <Table head={['Владелец', 'Бот', 'Тариф', 'Статус', 'Окончание', 'Авто', 'Платежей']} empty={!data?.items.length}>
            {data?.items.map((s: any) => (
              <tr key={s.id}>
                <td className="px-3 py-2.5">
                  {s.owner.username ? `@${s.owner.username}` : ''}
                  <div className="font-mono text-[13px] text-muted">{s.owner.telegramId}</div>
                </td>
                <td className="px-3">{s.bot ? `@${s.bot.username}` : <span className="text-[13px] text-muted">не подключен</span>}</td>
                <td className="px-3 text-[13px]">
                  {s.plan.name} · {s.priceStars} Stars
                </td>
                <td className="px-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-3 text-[13px]">{fmtDay(s.periodEnd)}</td>
                <td className="px-3 text-[13px]">{s.subscriptionChargeId ? (s.autoRenew ? 'да' : 'отменено') : 'нет'}</td>
                <td className="px-3">{s._count.payments}</td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
      </Card>
      <Card>
        <CardTitle>Платежи</CardTitle>
        <Table head={['Дата', 'Пользователь', 'Бот', 'Сумма', 'Тип', 'Charge ID']} empty={!data?.payments?.length}>
          {data?.payments?.map((p: any) => (
            <tr key={p.id} className={p.refunded ? 'opacity-50' : ''}>
              <td className="px-3 py-2 text-[13px]">{fmtDate(p.paidAt)}</td>
              <td className="px-3 text-[13px]">@{p.subscription.owner.username ?? '—'}</td>
              <td className="px-3 text-[13px]">{p.subscription.bot ? `@${p.subscription.bot.username}` : '—'}</td>
              <td className="px-3 text-gold">{p.amount} Stars</td>
              <td className="px-3 text-[13px]">
                {p.isRecurring ? 'автопродление' : 'оплата'} {p.refunded && <Badge tone="bad">возврат</Badge>}
              </td>
              <td className="max-w-[160px] truncate px-3 font-mono text-[13px] text-muted">{p.telegramPaymentChargeId}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function Plans({ isOwner }: { isOwner: boolean }) {
  const { data, reload } = useApi<any[]>('/api/admin/plans');
  const [edit, setEdit] = useState<any | null>(null);
  const { confirm, node } = useConfirm();
  const save = async () => {
    if (edit.id && !(await confirm('Сохранить тариф?', 'Новая цена применится к новым покупкам и продлениям. Уже оплаченные периоды не меняются.'))) return;
    const body = { code: edit.code, name: edit.name, priceStars: Number(edit.priceStars), periodDays: Number(edit.periodDays), graceDays: Number(edit.graceDays), isActive: edit.isActive, isDefault: edit.isDefault };
    try {
      if (edit.id) await api(`/api/admin/plans/${edit.id}`, { method: 'PATCH', body });
      else await api('/api/admin/plans', { body });
      toast.success('Тариф сохранён');
      setEdit(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card>
      <CardTitle
        sub="Цены меняются здесь, без изменения кода. Автопродление Telegram Stars доступно для периода 30 дней."
        action={
          isOwner && (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEdit({ code: '', name: '', priceStars: 100, periodDays: 30, graceDays: 3, isActive: true, isDefault: false })}>
              Тариф
            </Button>
          )
        }
      >
        Тарифы White-Label
      </CardTitle>
      <div className="grid gap-3 md:grid-cols-3">
        {data?.map((p) => (
          <div key={p.id} className="rounded-xl border border-line/10 p-4">
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold">{p.name}</span>
              <span className="flex gap-1">
                {p.isDefault && <Badge tone="accent">по умолчанию</Badge>}
                {!p.isActive && <Badge tone="bad">выкл</Badge>}
              </span>
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-gold">{p.priceStars} Stars</div>
            <div className="text-[13px] text-muted">
              {p.periodDays} дн. · льготный период {p.graceDays} дн. · подписок: {p._count.subscriptions}
            </div>
            {isOwner && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEdit(p)}>
                Изменить
              </Button>
            )}
          </div>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Изменить тариф' : 'Новый тариф'}>
        {edit && (
          <div className="space-y-3">
            <Input label="Код" value={edit.code} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="white-label-pro" />
            <Input label="Название" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Цена, Stars" type="number" value={edit.priceStars} onChange={(e) => setEdit({ ...edit, priceStars: e.target.value })} />
              <Input label="Период, дн." type="number" value={edit.periodDays} onChange={(e) => setEdit({ ...edit, periodDays: e.target.value })} />
              <Input label="Льгота, дн." type="number" value={edit.graceDays} onChange={(e) => setEdit({ ...edit, graceDays: e.target.value })} />
            </div>
            <Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Доступен для покупки" />
            <Toggle checked={edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })} label="Тариф по умолчанию" />
            <Button className="w-full" onClick={save}>
              Сохранить
            </Button>
          </div>
        )}
      </Modal>
      {node}
    </Card>
  );
}

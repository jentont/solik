'use client';

import { Gift as GiftIcon, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { GiftCard, GiftImage, type Gift } from '@/components/GiftCard';
import { Badge, Button, Card, CardTitle, Empty, ErrorState, Input, Loading, Modal, PageHeader, Pager, Select, StatusBadge, Table, Tabs } from '@/components/ui';

type Tab = 'catalog' | 'collectible' | 'deliveries' | 'nft';

export default function GiftsPage() {
  const [tab, setTab] = useState<Tab>('catalog');
  return (
    <>
      <PageHeader title="Telegram Gifts" sub="Каталог подарков, выдача победителям и NFT" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'catalog', label: 'Каталог' },
          { id: 'collectible', label: 'Коллекционные' },
          { id: 'deliveries', label: 'История выдачи' },
          { id: 'nft', label: 'NFT' },
        ]}
      />
      {tab === 'catalog' && <Catalog types="REGULAR,LIMITED,REMOVED" />}
      {tab === 'collectible' && <Catalog types="COLLECTIBLE,NFT" />}
      {tab === 'deliveries' && <Deliveries />}
      {tab === 'nft' && <Nft />}
    </>
  );
}

function Catalog({ types }: { types: string }) {
  const [q, setQ] = useState('');
  const [onlyAuto, setOnlyAuto] = useState(false);
  const { data, error, loading, reload } = useApi<Gift[]>(`/api/gifts/catalog?type=${types}${q ? `&q=${encodeURIComponent(q)}` : ''}${onlyAuto ? '&onlyAvailable=true' : ''}`, [types, q, onlyAuto]);
  const [manual, setManual] = useState<Gift | null>(null);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Поиск по названию или ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant={onlyAuto ? 'primary' : 'secondary'} onClick={() => setOnlyAuto(!onlyAuto)}>
          Только отправляемые ботом
        </Button>
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && !data.length && <Empty icon={<GiftIcon className="h-6 w-6" />} title="Подарков нет" text="Каталог наполняет администратор платформы (импорт ID подарков и проверка через Telegram API)." />}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {data?.map((g) => (
          <GiftCard key={g.id} gift={g} onClick={() => setManual(g)} />
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">
        «Сам» — бот сам отправит подарок победителю со своего баланса Stars (Telegram подтвердил, что он доступен). «Вручную» — коллекционные и снятые подарки: передаются из вашего аккаунта через Telegram Business или вами лично, бот напомнит.
      </p>
      <ManualDelivery gift={manual} onClose={() => setManual(null)} />
    </>
  );
}

function ManualDelivery({ gift, onClose }: { gift: Gift | null; onClose(): void }) {
  const bots = useApi<any[]>(gift ? '/api/bots' : null, [!!gift]);
  const [botId, setBotId] = useState('');
  const [tgId, setTgId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const own = bots.data?.filter((b) => !b.isPlatform) ?? [];
  const send = async () => {
    setBusy(true);
    try {
      const d = await api<any>('/api/gifts/deliver', { body: { botId: botId || own[0]?.id || bots.data?.[0]?.id, giftId: gift!.id, recipientTgId: tgId, recipientName: name || undefined } });
      toast.success(d.status === 'MANUAL_REQUIRED' ? 'Создана задача ручной выдачи' : 'Подарок поставлен в очередь на отправку');
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!gift} onClose={onClose} title="Выдать подарок">
      {gift && (
        <div className="mb-4 flex items-center gap-4">
          <GiftImage gift={gift} size={72} />
          <div>
            <div className="font-medium">{gift.name}</div>
            <div className="font-mono text-xs text-muted">ID {gift.telegramGiftId}</div>
            {gift.delivery?.note && <div className="mt-1 text-xs text-warn">{gift.delivery.note}</div>}
          </div>
        </div>
      )}
      <div className="space-y-3">
        <Select label="Через бота" value={botId} onChange={(e) => setBotId(e.target.value)}>
          {(own.length ? own : bots.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              @{b.username}
            </option>
          ))}
        </Select>
        <Input label="Telegram ID получателя" value={tgId} onChange={(e) => setTgId(e.target.value.replace(/\D/g, ''))} />
        <Input label="Имя / username (для истории)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button className="w-full" loading={busy} disabled={!tgId} icon={<Send className="h-4 w-4" />} onClick={send}>
          Выдать
        </Button>
      </div>
    </Modal>
  );
}

function Deliveries() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, loading, reload } = useApi<{ items: any[]; total: number }>(`/api/gifts/deliveries?page=${page}${status ? `&status=${status}` : ''}`, [page, status]);
  const act = async (url: string, ok: string) => {
    try {
      await api(url, { body: {} });
      toast.success(ok);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <div className="mb-3 flex gap-2">
        {['', 'MANUAL_REQUIRED', 'FAILED', 'PENDING', 'DELIVERED'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => (setStatus(s), setPage(1))}>
            {s ? <StatusBadge status={s} /> : 'Все'}
          </Button>
        ))}
      </div>
      {loading && !data ? (
        <Loading />
      ) : (
        <Table head={['Получатель', 'Приз', 'Конкурс', 'Способ', 'Статус', 'Попыток', 'Дата', '']} empty={!data?.items.length}>
          {data?.items.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2.5">
                {d.recipientName ?? '—'}
                <div className="font-mono text-xs text-muted">{d.recipientTgId}</div>
              </td>
              <td className="px-3">{d.prize?.title ?? d.gift?.name ?? '—'}</td>
              <td className="px-3 text-xs">{d.contest?.title ?? 'Ручная'}</td>
              <td className="px-3 text-xs text-muted">{d.method}</td>
              <td className="px-3">
                <StatusBadge status={d.status} />
                {(d.error || d.note) && <div className="mt-1 max-w-[220px] truncate text-[11px] text-muted" title={d.error ?? d.note}>{d.error ?? d.note}</div>}
              </td>
              <td className="px-3 tabular-nums">{d.attempts}</td>
              <td className="px-3 text-xs text-muted">{fmtDate(d.createdAt)}</td>
              <td className="whitespace-nowrap px-3 text-right">
                {['FAILED', 'PENDING'].includes(d.status) && (
                  <Button size="sm" variant="ghost" onClick={() => act(`/api/gifts/deliveries/${d.id}/retry`, 'Повтор запущен')}>
                    Повторить
                  </Button>
                )}
                {d.status !== 'DELIVERED' && (
                  <Button size="sm" variant="ghost" onClick={() => act(`/api/gifts/deliveries/${d.id}/confirm`, 'Отмечено')}>
                    Выдано
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={page} total={data?.total ?? 0} pageSize={25} onPage={setPage} />
    </>
  );
}

function Nft() {
  const { data, reload } = useApi<{ assets: any[]; providers: { id: string; name: string; canTransfer: boolean }[] }>('/api/nft');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ provider: 'manual', name: '', network: '', contractAddress: '', tokenId: '', imageUrl: '', externalUrl: '' });
  const add = async () => {
    try {
      await api('/api/nft', { body: Object.fromEntries(Object.entries(form).filter(([, v]) => v)) });
      setOpen(false);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <Card className="mb-4">
        <CardTitle action={<Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>Добавить NFT</Button>} sub="NFT передаются только через подтверждённую интеграцию провайдера; фиктивных транзакций нет">
          NFT-призы
        </CardTitle>
        <div className="flex flex-wrap gap-2 text-xs">
          {data?.providers.map((p) => (
            <Badge key={p.id} tone={p.canTransfer ? 'ok' : 'muted'}>
              {p.name}: {p.canTransfer ? 'автопередача' : 'ручная передача'}
            </Badge>
          ))}
        </div>
      </Card>
      {!data?.assets.length ? (
        <Empty title="Нет NFT" text="Добавьте NFT, чтобы разыгрывать его в конкурсах. Коллекционные Telegram-подарки из аккаунта подключаются через Telegram Business в карточке бота." />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {data.assets.map((a) => (
            <Card key={a.id} className="p-3">
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.imageUrl} alt="" className="mb-2 aspect-square w-full rounded-xl object-cover" />
              ) : (
                <div className="mb-2 flex aspect-square items-center justify-center rounded-xl bg-elevated text-4xl">💎</div>
              )}
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className="mt-1 flex items-center justify-between">
                <StatusBadge status={a.status === 'AVAILABLE' ? 'ACTIVE' : a.status === 'TRANSFERRED' ? 'DELIVERED' : 'PENDING'} />
                <button onClick={() => api(`/api/nft/${a.id}`, { method: 'DELETE' }).then(reload).catch((e) => toast.error(e.message))} className="text-muted hover:text-bad">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Новый NFT">
        <div className="space-y-3">
          <Select label="Провайдер" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            {data?.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input label="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Сеть" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} placeholder="TON" />
            <Input label="Token ID" value={form.tokenId} onChange={(e) => setForm({ ...form, tokenId: e.target.value })} />
          </div>
          <Input label="Адрес контракта / коллекции" value={form.contractAddress} onChange={(e) => setForm({ ...form, contractAddress: e.target.value })} />
          <Input label="Изображение (URL)" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
          <Input label="Ссылка (маркетплейс)" value={form.externalUrl} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} />
          <Button className="w-full" disabled={!form.name} onClick={add}>
            Добавить
          </Button>
        </div>
      </Modal>
    </>
  );
}

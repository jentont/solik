'use client';

import { CheckCircle2, RefreshCw, Upload, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { GiftCard, type Gift } from '@/components/GiftCard';
import { Button, Card, CardTitle, Loading, Pager, Textarea } from '@/components/ui';
import { LogList } from './Monitoring';

const GIFT_EXAMPLE = `[
  { "telegramGiftId": "5170233102089322756", "name": "Teddy Bear", "type": "REGULAR", "emoji": "🧸", "imageUrl": "/gifts/teddy.png" }
]`;
const EMOJI_EXAMPLE = `[
  { "customEmojiId": "5368324170671202286", "name": "Подарок", "category": "gifts", "fallback": "🎁" }
]`;

export function AdminCatalog() {
  const gifts = useApi<Gift[]>('/api/gifts/catalog');
  const emoji = useApi<any[]>('/api/emoji');
  const [giftJson, setGiftJson] = useState('');
  const [emojiJson, setEmojiJson] = useState('');
  const [busy, setBusy] = useState('');

  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(`Готово: ${JSON.stringify(r)}`);
      gifts.reload();
      emoji.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const parse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      throw new Error('Неверный JSON');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle sub="ID подарков, обычных, коллекционных, удалённых и NFT. После импорта каждый ID сверяется с getAvailableGifts.">Импорт подарков</CardTitle>
          <Textarea value={giftJson} onChange={(e) => setGiftJson(e.target.value)} placeholder={GIFT_EXAMPLE} rows={8} />
          <div className="mt-3 flex gap-2">
            <Button loading={busy === 'gifts'} icon={<Upload className="h-4 w-4" />} disabled={!giftJson} onClick={() => run('gifts', () => api('/api/admin/gifts/import', { body: parse(giftJson) }))}>
              Импортировать
            </Button>
            <Button variant="secondary" loading={busy === 'verify'} icon={<RefreshCw className="h-4 w-4" />} onClick={() => run('verify', () => api('/api/admin/gifts/verify', { body: {} }))}>
              Проверить через Telegram
            </Button>
          </div>
        </Card>
        <Card>
          <CardTitle sub="Превью загружаются через getCustomEmojiStickers. Неподтверждённые ID помечаются неактивными.">Импорт Premium Emoji</CardTitle>
          <Textarea value={emojiJson} onChange={(e) => setEmojiJson(e.target.value)} placeholder={EMOJI_EXAMPLE} rows={8} />
          <Button className="mt-3" loading={busy === 'emoji'} icon={<Upload className="h-4 w-4" />} disabled={!emojiJson} onClick={() => run('emoji', () => api('/api/admin/emoji/import', { body: parse(emojiJson) }))}>
            Импортировать
          </Button>
        </Card>
      </div>
      <Card>
        <CardTitle sub={`${gifts.data?.length ?? 0} подарков`}>Каталог</CardTitle>
        {gifts.loading ? (
          <Loading />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {gifts.data?.map((g) => (
              <GiftCard key={g.id} gift={g} />
            ))}
          </div>
        )}
      </Card>
      <Card>
        <CardTitle sub={`${emoji.data?.length ?? 0} активных`}>Premium Emoji</CardTitle>
        <div className="flex flex-wrap gap-2">
          {emoji.data?.map((e) => (
            <div key={e.id} title={`${e.name} · ${e.customEmojiId}`} className="flex h-12 w-12 items-center justify-center rounded-xl bg-elevated/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/emoji/${e.customEmojiId}/preview`} alt={e.fallback} className="h-8 w-8" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function AdminLogs() {
  const [level, setLevel] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const logs = useApi<{ items: any[]; total: number }>(`/api/admin/logs?page=${page}&pageSize=50${level ? `&level=${level}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`, [page, level, action]);
  const integrations = useApi<any>('/api/admin/integrations');
  const errors = useApi<any>('/api/admin/errors');
  const I = integrations.data;
  const ok = (v: boolean) => (v ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <XCircle className="h-4 w-4 text-bad" />);

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle action={<Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={integrations.reload} />}>Интеграции</CardTitle>
        {!I ? (
          <Loading />
        ) : (
          <div className="grid gap-3 text-[15px] sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center gap-2">{ok(I.database)} PostgreSQL</div>
            <div className="flex items-center gap-2">{ok(I.redis)} Redis / BullMQ</div>
            <div className="flex items-center gap-2">
              {ok(!I.mainBotWebhook?.error && !I.mainBotWebhook?.last_error_message)} Webhook главного бота
              <span className="text-[13px] text-muted">({I.mainBotWebhook?.pending_update_count ?? '?'} в очереди)</span>
            </div>
            <div className="flex items-center gap-2">
              {ok(I.ai.configured)} AI: {I.ai.provider} <span className="text-[13px] text-muted">{I.ai.textModel}</span>
            </div>
            {I.mainBotStars && <div className="text-gold">Баланс главного бота в Stars: {I.mainBotStars.amount}</div>}
            {I.mainBotWebhook?.last_error_message && <div className="col-span-full text-[13px] text-warn">Webhook: {I.mainBotWebhook.last_error_message}</div>}
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Ошибки</CardTitle>
        {errors.data && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <div className="label">Webhook ({errors.data.webhook.length})</div>
              <div className="scroll-thin max-h-60 space-y-1 overflow-y-auto font-mono text-[13px]">
                {errors.data.webhook.map((e: any) => (
                  <div key={e.id} className="text-bad">
                    {fmtDate(e.receivedAt)} @{e.bot?.username}: {e.error}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="label">Выдача призов ({errors.data.deliveries.length})</div>
              <div className="scroll-thin max-h-60 space-y-1 overflow-y-auto font-mono text-[13px]">
                {errors.data.deliveries.map((d: any) => (
                  <div key={d.id} className="text-warn">
                    {fmtDate(d.updatedAt)} {d.recipientTgId}: {d.error}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="label">AI ({errors.data.aiJobs.length})</div>
              <div className="scroll-thin max-h-60 space-y-1 overflow-y-auto font-mono text-[13px]">
                {errors.data.aiJobs.map((j: any) => (
                  <div key={j.id} className="text-warn">
                    {fmtDate(j.updatedAt)} {j.kind}: {j.error}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Журнал действий</CardTitle>
        <div className="mb-3 flex gap-2">
          <select className="input w-40" value={level} onChange={(e) => (setLevel(e.target.value), setPage(1))}>
            <option value="">Все уровни</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
          <input className="input max-w-xs" placeholder="Действие: admin., contest., broadcast…" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />
        </div>
        {logs.data ? <LogList logs={logs.data.items} /> : <Loading />}
        <Pager page={page} total={logs.data?.total ?? 0} pageSize={50} onPage={setPage} />
      </Card>
    </div>
  );
}

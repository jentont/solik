'use client';

import { Minus, Plus, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { cn } from '@/lib/format';
import type { Gift } from '@/components/GiftCard';
import { StarIcon } from '@/components/StarIcon';
import { Button, Empty, Loading, PageHeader, Select } from '@/components/ui';
import { Hand } from '@/components/Winter';

const DURATIONS = [
  { m: 5, label: '5 мин' },
  { m: 10, label: '10 мин' },
  { m: 30, label: '30 мин' },
  { m: 60, label: '1 час' },
  { m: 1440, label: '1 день' },
];

/** One screen, like a randomizer bot: chat, prize, timer, winners — go. */
export default function QuickContestPage() {
  const router = useRouter();
  const chats = useApi<{ chats: { id: string; title: string; status: string; bot: { username: string; isPlatform: boolean } }[] }>('/api/chats');
  const gifts = useApi<Gift[]>('/api/gifts/catalog?type=REGULAR,LIMITED');
  const [chatId, setChatId] = useState('');
  const [gift, setGift] = useState<Gift | null>(null);
  const [custom, setCustom] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [winners, setWinners] = useState(1);
  const [busy, setBusy] = useState(false);

  const list = (chats.data?.chats ?? []).filter((c) => c.status === 'ACTIVE');
  useEffect(() => {
    if (!chatId && list[0]) setChatId(list[0].id);
  }, [list, chatId]);

  const prize = gift?.name ?? custom.trim();
  const go = async () => {
    setBusy(true);
    try {
      const c = await api<{ id: string }>('/api/contests/quick', { body: { chatId, prize, giftId: gift?.id, winners, minutes } });
      toast.success('Розыгрыш опубликован');
      router.push(`/contests/${c.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (chats.loading && !chats.data) return <Loading />;
  if (!list.length)
    return (
      <Empty
        icon={<Zap className="h-7 w-7" />}
        title="Нет подключённых чатов"
        text="Добавьте бота администратором в группу — и быстрый розыгрыш можно будет запустить в один клик. Или напишите в чате: .розыгрыш 10м Мишка"
      />
    );

  return (
    <div className="space-y-6">
      <div>
        <Hand>как рандомайзер, только с подарками</Hand>
        <div className="mt-2">
          <PageHeader title="Быстрый розыгрыш" sub="Бот опубликует пост с кнопкой «Участвовать» и сам выберет победителей по таймеру." />
        </div>
      </div>

      <Select label="Где" value={chatId} onChange={(e) => setChatId(e.target.value)}>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title} · @{c.bot.username}
          </option>
        ))}
      </Select>

      <section>
        <span className="label">Приз</span>
        <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
          {(gifts.data ?? []).map((g) => (
            <button
              key={g.id}
              onClick={() => (setGift(gift?.id === g.id ? null : g), setCustom(''))}
              className={cn('press flex w-[92px] shrink-0 flex-col items-center rounded-[20px] border p-2', gift?.id === g.id ? 'border-gold bg-gold/[0.12]' : 'border-white/12 bg-white/[0.05]')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.imageUrl ?? ''} alt="" className="h-14 w-14 object-contain" />
              <span className="mt-1 line-clamp-1 text-[12px] font-semibold">{g.name}</span>
              {g.starCost != null && (
                <span className="num flex items-center gap-0.5 text-[13px] font-bold text-gold">
                  <StarIcon size={12} />
                  {g.starCost}
                </span>
              )}
            </button>
          ))}
        </div>
        <input
          className="input mt-3"
          placeholder="…или свой приз текстом: «100 Stars», «Роль VIP»"
          value={custom}
          onChange={(e) => (setCustom(e.target.value), setGift(null))}
          maxLength={120}
        />
      </section>

      <section>
        <span className="label">Итоги через</span>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.m}
              onClick={() => setMinutes(d.m)}
              className={cn('press min-h-[44px] rounded-full border px-4 text-[15px] font-semibold', minutes === d.m ? 'border-transparent bg-white text-[#141416]' : 'border-white/[0.13] bg-white/[0.06] text-muted')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-between gap-4 rounded-3xl border border-white/[0.12] bg-white/[0.05] p-4">
        <span className="text-[16px] font-semibold">Победителей</span>
        <div className="flex items-center gap-3">
          <button aria-label="Меньше" onClick={() => setWinners(Math.max(1, winners - 1))} className="press flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08]">
            <Minus className="h-5 w-5" />
          </button>
          <span className="num w-8 text-center font-display text-[24px]">{winners}</span>
          <button aria-label="Больше" onClick={() => setWinners(Math.min(100, winners + 1))} className="press flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08]">
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </section>

      <Button className="w-full" loading={busy} disabled={!chatId || !prize} icon={<Zap className="h-5 w-5" />} onClick={go}>
        Запустить розыгрыш
      </Button>
      <p className="text-center text-[14px] text-muted">
        В чате то же самое: <code className="rounded bg-white/10 px-1.5 py-0.5">.розыгрыш 10м 2 Новогодний мишка</code>
      </p>
    </div>
  );
}

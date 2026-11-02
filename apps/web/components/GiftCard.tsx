'use client';

import { Check, Hand, Zap } from 'lucide-react';
import { cn } from '@/lib/format';
import { fragmentImage, GiftSticker, uniqueGiftSlug } from './GiftSticker';
import { Stars } from './StarIcon';

export interface Gift {
  id: string;
  telegramGiftId: string;
  name: string;
  type: 'REGULAR' | 'LIMITED' | 'COLLECTIBLE' | 'REMOVED' | 'NFT';
  imageUrl: string | null;
  emoji: string | null;
  collection: string | null;
  rarity: string | null;
  starCost: number | null;
  transferable: boolean;
  availability: string;
  remainingCount: number | null;
  totalCount: number | null;
  stickerFileId: string | null;
  delivery?: { method: string; note?: string };
}

// Only types that change what the owner can do get a label; regular gifts stay unlabelled.
const TYPE_TAG: Partial<Record<Gift['type'], { label: string; cls: string }>> = {
  LIMITED: { label: 'Лимитированный', cls: 'bg-gold/15 text-gold' },
  COLLECTIBLE: { label: 'Коллекционный', cls: 'bg-sky/15 text-sky' },
  NFT: { label: 'NFT', cls: 'bg-sky/15 text-sky' },
  REMOVED: { label: 'Снят с продажи', cls: 'bg-line/10 text-muted' },
};

export function GiftImage({ gift, size = 64, className }: { gift: Pick<Gift, 'id' | 'imageUrl' | 'emoji' | 'name' | 'stickerFileId' | 'type'>; size?: number; className?: string }) {
  return <GiftSticker gift={gift} size={size} className={className} />;
}

export function GiftCard({ gift, selected, onClick }: { gift: Gift; selected?: boolean; onClick?(): void }) {
  const auto = gift.delivery?.method === 'BOT_SEND_GIFT';
  const tag = TYPE_TAG[gift.type];
  const unique = uniqueGiftSlug(gift.name);
  const left = gift.remainingCount != null && gift.totalCount ? gift.remainingCount / gift.totalCount : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'group relative flex flex-col rounded-3xl border border-line/[0.06] bg-surface p-3 text-left shadow-[var(--card-shadow)] transition-transform active:scale-[0.98]',
        selected && 'shadow-glow',
      )}
    >
      {selected && (
        <span className="absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )}
      <div
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl"
        style={{ background: 'radial-gradient(60% 60% at 50% 55%, rgb(var(--elevated)) 0%, transparent 100%)' }}
      >
        {unique ? (
          // collectible: Fragment art with its own backdrop, full-bleed
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fragmentImage(unique)} alt={gift.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <GiftImage gift={gift} size={118} className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:scale-105" />
        )}
        {tag && <span className={cn('absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium backdrop-blur', tag.cls, unique && 'bg-black/45 text-white')}>{tag.label}</span>}
      </div>
      <div className="mt-2 truncate text-[15px] font-semibold">{gift.name}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[13px]">
        {gift.starCost != null ? <Stars value={gift.starCost} size={14} className="font-medium" /> : <span className="truncate text-muted">{gift.rarity ?? ''}</span>}
        <span className={cn('flex items-center gap-1', auto ? 'text-ok' : 'text-muted')} title={gift.delivery?.note}>
          {auto ? <Zap className="h-3.5 w-3.5" /> : <Hand className="h-3.5 w-3.5" />}
          {auto ? 'сам' : 'вручную'}
        </span>
      </div>
      {left != null && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded-full bg-bg">
            <div className="h-full rounded-full bg-gold/70" style={{ width: `${left * 100}%` }} />
          </div>
          <div className="num mt-1 text-[11px] text-muted">осталось {gift.remainingCount!.toLocaleString('ru-RU')}</div>
        </div>
      )}
    </button>
  );
}

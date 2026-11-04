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
  LIMITED: { label: 'Лимитированный', cls: 'bg-gold text-[#2a1a00]' },
  COLLECTIBLE: { label: 'Коллекционный', cls: 'bg-sky/15 text-sky' },
  NFT: { label: 'NFT', cls: 'bg-sky/15 text-sky' },
  REMOVED: { label: 'Нельзя подарить', cls: 'bg-[#e63946] text-white shadow-[0_4px_12px_rgba(230,57,70,0.45)]' },
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
        'card group relative flex flex-col p-3 text-left transition-transform active:scale-[0.97]',
        selected && 'border-gold shadow-[0_0_0_3px_rgba(255,194,61,0.35)]',
      )}
    >
      {selected && (
        <span className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-gold text-[#141416]">
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      )}
      <div
        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl"
        style={{ background: 'radial-gradient(60% 60% at 50% 55%, rgba(255,255,255,0.1) 0%, transparent 100%)' }}
      >
        {unique ? (
          // collectible: Fragment art with its own backdrop, full-bleed
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fragmentImage(unique)} alt={gift.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <GiftImage gift={gift} size={118} className="drop-shadow-[0_8px_16px_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:scale-105" />
        )}
        {tag && <span className={cn('absolute left-1.5 top-1.5 rounded-lg px-2 py-1 text-[12px] font-bold leading-none', tag.cls, unique && 'bg-black/55 text-white backdrop-blur')}>{tag.label}</span>}
      </div>
      <div className="mt-2 line-clamp-2 min-h-[2.5em] font-display text-[15px] font-extrabold leading-tight">{gift.name}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[14px]">
        {gift.starCost != null ? <Stars value={gift.starCost} size={18} className="font-display text-[19px] font-black" /> : <span className="truncate text-muted">{gift.rarity ?? ''}</span>}
        <span className={cn('flex items-center gap-1', auto ? 'text-ok' : 'text-muted')} title={gift.delivery?.note}>
          {auto ? <Zap className="h-3.5 w-3.5" /> : <Hand className="h-3.5 w-3.5" />}
          {auto ? 'сам' : 'вручную'}
        </span>
      </div>
      {left != null && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold/70" style={{ width: `${left * 100}%` }} />
          </div>
          <div className="num mt-1 text-[13px] text-muted">осталось {gift.remainingCount!.toLocaleString('ru-RU')}</div>
        </div>
      )}
    </button>
  );
}

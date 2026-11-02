'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/format';

export interface GiftLike {
  id?: string;
  name: string;
  type?: string;
  imageUrl?: string | null;
  stickerFileId?: string | null;
  emoji?: string | null;
}

export const fragmentImage = (slug: string) => `https://nft.fragment.com/gift/${slug}.webp`;

/** "Vice Cream #421234" / "MirageLamp-105411" → Fragment slug of a unique (collectible) gift. */
export function uniqueGiftSlug(name: string): string | null {
  const m = name.trim().match(/^(.+?)\s*(?:#|-)\s*(\d+)$/);
  if (!m) return null;
  const base = m[1]!.toLowerCase().replace(/[^a-z0-9]/g, '');
  return base ? `${base}-${m[2]}` : null;
}

type Source = { kind: 'img'; src: string } | { kind: 'lottie'; load(): Promise<object>; poster?: string } | { kind: 'video'; src: string } | { kind: 'emoji' };

async function gunzipJson(res: Response) {
  const stream = res.body!.pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/**
 * Shows the real Telegram gift:
 *  - owner-provided image (data/gifts.json imageUrl);
 *  - collectible gifts: animated model from Fragment (nft.fragment.com), webp poster as fallback;
 *  - regular gifts: the animated .tgs sticker from Telegram via the API proxy (bot token stays on the server);
 *  - emoji only if nothing else is available.
 */
export function GiftSticker({ gift, size = 64, className, animate = true }: { gift: GiftLike; size?: number; className?: string; animate?: boolean }) {
  const [source, setSource] = useState<Source | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFailed(false);
    const slug = uniqueGiftSlug(gift.name);
    if (gift.imageUrl) return setSource({ kind: 'img', src: gift.imageUrl });
    // Fragment serves the exact collectible (model + backdrop); its lottie isn't CORS-enabled, so the image is used
    if (slug) return setSource({ kind: 'img', src: fragmentImage(slug) });
    if (gift.id && gift.stickerFileId) {
      const url = `/api/gifts/${gift.id}/sticker`;
      let cancelled = false;
      fetch(url)
        .then(async (r) => {
          if (!r.ok) throw new Error();
          const type = r.headers.get('content-type') ?? '';
          if (cancelled) return;
          if (type.includes('tgsticker')) {
            const json = await gunzipJson(r);
            setSource({ kind: 'lottie', load: async () => json });
          } else if (type.includes('webm')) setSource({ kind: 'video', src: url });
          else setSource({ kind: 'img', src: url });
        })
        .catch(() => !cancelled && setSource({ kind: 'emoji' }));
      return () => {
        cancelled = true;
      };
    }
    setSource({ kind: 'emoji' });
  }, [gift.id, gift.name, gift.imageUrl, gift.stickerFileId, animate]);

  // Lottie: plays only while visible; static first frame when reduced motion is requested
  useEffect(() => {
    if (source?.kind !== 'lottie' || !box.current) return;
    let anim: { destroy(): void; play(): void; pause(): void; goToAndStop(f: number, isFrame: boolean): void } | null = null;
    let io: IntersectionObserver | null = null;
    let dead = false;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (async () => {
      try {
        const [{ default: lottie }, data] = await Promise.all([import('lottie-web/build/player/lottie_light'), source.load()]);
        if (dead || !box.current) return;
        box.current.innerHTML = '';
        anim = lottie.loadAnimation({ container: box.current, renderer: 'svg', loop: true, autoplay: false, animationData: data });
        if (reduce) return anim.goToAndStop(0, true);
        io = new IntersectionObserver(([e]) => (e?.isIntersecting ? anim?.play() : anim?.pause()));
        io.observe(box.current);
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      io?.disconnect();
      anim?.destroy();
    };
  }, [source]);

  const style = { width: size, height: size };
  if (!source) return <div style={style} className={cn('animate-pulse rounded-full bg-elevated/60', className)} />;
  if (failed && source.kind === 'lottie' && source.poster) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={source.poster} alt={gift.name} style={style} className={cn('object-contain', className)} />;
  }
  if (source.kind === 'lottie') return <div ref={box} style={style} className={className} role="img" aria-label={gift.name} />;
  if (source.kind === 'video') return <video src={source.src} style={style} className={cn('object-contain', className)} autoPlay loop muted playsInline aria-label={gift.name} />;
  if (source.kind === 'img')
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={source.src} alt={gift.name} style={style} className={cn(uniqueGiftSlug(gift.name) ? 'rounded-[22%] object-cover' : 'object-contain', className)} onError={() => setSource({ kind: 'emoji' })} />;
  return (
    <div style={{ ...style, fontSize: size * 0.72 }} className={cn('flex items-center justify-center leading-none', className)} aria-label={gift.name}>
      {gift.emoji ?? ''}
    </div>
  );
}

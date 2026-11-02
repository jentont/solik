'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/format';

/** Gentle falling snow on a fixed canvas. Off for reduced motion; pauses while the tab is hidden. */
export function Snow({ count = 46 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const flakes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.8 + Math.random() * 2.2,
      vy: 0.25 + Math.random() * 0.6,
      ph: Math.random() * Math.PI * 2,
      a: 0.25 + Math.random() * 0.5,
    }));
    let raf = 0;
    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.vy;
        f.x += Math.sin(t / 1600 + f.ph) * 0.3;
        if (f.y > h + 4) {
          f.y = -4;
          f.x = Math.random() * w;
        }
        ctx.globalAlpha = f.a;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const vis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [count]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />;
}

/** Fir branch with lights and an ornament, cut from the mascot's winter avatar. */
export function Branch({ side = 'tr', className }: { side?: 'tl' | 'tr' | 'bl' | 'br'; className?: string }) {
  // the art has one top branch (hanging from the left); mirror it for the right corner
  const src = side === 'tl' || side === 'tr' ? '/winter/branch-tl.webp' : side === 'bl' ? '/winter/branch-bl.webp' : '/winter/branch-br.webp';
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn('pointer-events-none select-none', side === 'tr' && '-scale-x-100', side.startsWith('t') && 'decor-branch', className)}
    />
  );
}

/** The mascot «солик)» in a Santa hat, peeking over whatever sits below it. */
export function Solik({ className, still }: { className?: string; still?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/winter/solik-santa.webp" alt="солик" draggable={false} className={cn('pointer-events-none select-none', !still && 'peek', className)} />
  );
}

/** Pink handwritten accent with a hand-drawn underline. */
export function Hand({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('hand-line inline-block -rotate-2 font-hand text-[22px] font-bold leading-none text-pink', className)}>{children}</span>;
}

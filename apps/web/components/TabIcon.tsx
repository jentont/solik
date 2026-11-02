'use client';

import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

type Anim = { goToAndStop(v: number, f: boolean): void; goToAndPlay(v: number, f: boolean): void; totalFrames: number; destroy(): void };

/**
 * Mirrows Lottie tab icon (public/icons/*.json). Shown on its last frame; replays once when the tab
 * becomes active. Falls back to the lucide icon if the file is missing.
 */
export function TabIcon({ name, active, fallback: Fallback }: { name?: string; active: boolean; fallback: LucideIcon }) {
  const box = useRef<HTMLSpanElement>(null);
  const anim = useRef<Anim | null>(null);

  useEffect(() => {
    if (!name || !box.current) return;
    let dead = false;
    (async () => {
      try {
        const [{ default: lottie }, data] = await Promise.all([
          import('lottie-web/build/player/lottie_light'),
          fetch(`/icons/${name}.json`).then((r) => {
            if (!r.ok) throw new Error();
            return r.json();
          }),
        ]);
        if (dead || !box.current) return;
        box.current.innerHTML = '';
        const a = lottie.loadAnimation({ container: box.current, renderer: 'svg', loop: false, autoplay: false, animationData: data }) as unknown as Anim;
        a.goToAndStop(a.totalFrames, true);
        anim.current = a;
      } catch {
        /* keep the fallback icon */
      }
    })();
    return () => {
      dead = true;
      anim.current?.destroy();
      anim.current = null;
    };
  }, [name]);

  useEffect(() => {
    if (active && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) anim.current?.goToAndPlay(0, true);
  }, [active]);

  return (
    <span ref={box} className="tab-icon flex h-[22px] w-[22px] items-center justify-center">
      <Fallback className="h-[20px] w-[20px]" />
    </span>
  );
}

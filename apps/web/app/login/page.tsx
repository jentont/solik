'use client';

import { motion } from 'framer-motion';
import { Gift, Sparkles, Star, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Brand } from '@/components/Brand';
import { useAuth } from '@/lib/auth';

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, string | number>) => void;
  }
}


export default function LoginPage() {
  const { loginWithWidget, status } = useAuth();
  const box = useRef<HTMLDivElement>(null);
  // bot username comes from the API at runtime (falls back to the build-time variable)
  const [BOT, setBot] = useState(process.env.NEXT_PUBLIC_MAIN_BOT_USERNAME ?? '');
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c: { botUsername?: string | null }) => c.botUsername && setBot(c.botUsername))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!box.current || !BOT || status === 'loading') return;
    window.onTelegramAuth = (user) => {
      loginWithWidget(user).catch((e) => toast.error(e.message));
    };
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', BOT);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '12');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    s.setAttribute('data-request-access', 'write');
    box.current.innerHTML = '';
    box.current.appendChild(s);
  }, [loginWithWidget, status, BOT]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card w-full max-w-md p-8 text-center">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <h1 className="font-display text-2xl font-bold">Конкурсы в Telegram — в одном месте</h1>
        <p className="mt-2 text-[15px] text-muted">Розыгрыши подарков, Stars и NFT, SMS Counter, перебивка, AI-посты и аналитика.</p>
        <div className="my-7 grid grid-cols-4 gap-2 text-muted">
          {[Gift, Star, Trophy, Sparkles].map((I, i) => (
            <div key={i} className="flex h-12 items-center justify-center rounded-xl bg-elevated/60">
              <I className="h-5 w-5" />
            </div>
          ))}
        </div>
        {BOT ? (
          <div ref={box} className="flex min-h-[48px] justify-center" />
        ) : (
          <p className="text-[15px] text-warn">Не удалось получить бота платформы. Проверьте MAIN_BOT_TOKEN на сервере.</p>
        )}
        {BOT && (
          <p className="mt-6 text-[13px] text-muted">
            Или откройте панель прямо в Telegram:{' '}
            <a className="text-accent" href={`https://t.me/${BOT}`}>
              @{BOT}
            </a>
          </p>
        )}
      </motion.div>
    </div>
  );
}

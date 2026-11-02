'use client';

import { Check, Dices, Gavel, MessageSquareMore, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/format';
import { StarIcon } from './StarIcon';
import { Branch, Hand, Solik } from './Winter';

export const ONBOARDED_KEY = 'solik:onboarded';

const GIFTS = [
  { id: '5956217000635139069', name: 'Новогодний мишка', stars: 50 },
  { id: '5922558454332916696', name: 'Новогодняя ёлка', stars: 50 },
  { id: '5800655655995968830', name: 'Мишка с сердцем', stars: 50 },
  { id: '5168103777563050263', name: 'Роза', stars: 25 },
  { id: '5170690322832818290', name: 'Кольцо', stars: 100 },
  { id: '5170521118301225164', name: 'Алмаз', stars: 100 },
];
const giftSrc = (id: string) => `/gifts/${id}.webp`;

const STEPS = [
  {
    hand: 'шаг первый',
    title: 'Добавь бота в свой чат',
    text: 'Открой чат или канал, добавь @solikgiftbot и сделай его админом. Без этого бот не видит сообщения.',
    say: 'Привет! Я солик)',
  },
  {
    hand: 'самое приятное',
    title: 'Выбери приз',
    text: 'Настоящие подарки Telegram: мишки, ёлки, даже снятые с продажи. Нажми на любой.',
    say: 'Мне бы мишку…',
  },
  {
    hand: 'как играем',
    title: 'Запусти конкурс',
    text: 'Шесть режимов: от аукциона на Stars до слота 777. Бот сам следит за правилами и таймером.',
    say: 'Какой запустим?',
  },
  {
    hand: 'и всё!',
    title: 'Бот поздравит победителя',
    text: 'Он ответит на сообщение победителя прямо в чате, и подарок сразу появится у него в профиле.',
    say: 'Ура, подарок!',
  },
];

export function Onboarding({ onClose }: { onClose(): void }) {
  const [step, setStep] = useState(0);
  const [gift, setGift] = useState(0);
  const [burst, setBurst] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const last = step === STEPS.length - 1;
  const s = STEPS[step]!;

  const finish = (celebrate: boolean) => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* storage blocked */
    }
    if (!celebrate) return onClose();
    setBurst(true);
    toast.success('Ура! Теперь создай первый конкурс');
    setTimeout(onClose, 900);
  };
  const go = (d: number) => setStep((v) => Math.min(STEPS.length - 1, Math.max(0, v + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Как работает SOLIK"
      className="no-select fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[linear-gradient(180deg,#1c1c20_0%,#121214_70%)]"
      onPointerDown={(e) => (drag.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - d.y)) go(dx < 0 ? 1 : -1);
      }}
    >
      <Branch side="tl" className="absolute left-[-10px] top-[-6px] w-[170px] opacity-95" />
      <Branch side="br" className="absolute bottom-0 right-[-10px] w-[190px] opacity-80" />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[480px] flex-col px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-[max(env(safe-area-inset-top),14px)]">
        <div className="flex items-center justify-end gap-2">
          <span className="num rounded-full border border-white/15 bg-black/30 px-4 py-2.5 font-display text-[15px] font-extrabold backdrop-blur">
            {step + 1}/{STEPS.length}
          </span>
          <button onClick={() => finish(false)} className="press min-h-[44px] rounded-full border border-white/15 bg-black/30 px-5 text-[16px] font-semibold text-muted backdrop-blur">
            Пропустить
          </button>
        </div>

        <div key={step} className="flex min-h-0 flex-1 items-center justify-center py-3 [animation:peek_.45s_cubic-bezier(.34,1.3,.5,1)_both]">
          {step === 0 && <AdminMock />}
          {step === 1 && <GiftPick value={gift} onChange={setGift} />}
          {step === 2 && <ModesMock />}
          {step === 3 && <WinnerMock gift={GIFTS[gift]!} />}
        </div>

        <div className="relative mt-16">
          <div className="absolute -top-[92px] left-2 flex items-end gap-1">
            <Solik key={step} className="w-[150px]" />
            <span key={`say${step}`} className="mb-12 rounded-[18px] rounded-bl-[4px] bg-white px-3.5 py-2 font-hand text-[21px] font-bold leading-none text-[#141416] shadow-lg [animation:peek_.5s_.25s_both]">
              {s.say}
            </span>
          </div>
          <div className="card relative px-5 pb-5 pt-6">
            <Hand>{s.hand}</Hand>
            <h2 className="glow-text mt-2 font-display text-[28px] font-black leading-[1.05] tracking-[-0.03em]">{s.title}</h2>
            <p className="mt-2.5 text-[17px] leading-[1.45] text-muted">{s.text}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="flex gap-2" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className={cn('h-2.5 rounded-full transition-all duration-300', i === step ? 'w-8 bg-white' : 'w-2.5 bg-white/25')} />
            ))}
          </div>
          <button
            onClick={() => (last ? finish(true) : go(1))}
            className="press min-h-[56px] flex-1 rounded-[20px] bg-[linear-gradient(160deg,#ff5a68,#e63946_55%,#c21f33)] font-display text-[18px] font-extrabold text-white shadow-[0_14px_30px_rgba(230,57,70,0.4),inset_0_1px_0_rgba(255,255,255,0.35)]"
          >
            {last ? 'Поехали!' : 'Далее'}
          </button>
        </div>
      </div>
      {burst && <Confetti />}
    </div>
  );
}

function AdminMock() {
  const [on, setOn] = useState(0);
  useEffect(() => {
    const t = [500, 950, 1400].map((ms, i) => setTimeout(() => setOn(i + 1), ms));
    return () => t.forEach(clearTimeout);
  }, []);
  const rights = ['Удалять сообщения', 'Закреплять сообщения', 'Приглашать по ссылке'];
  return (
    <div className="card w-full max-w-[360px] p-4">
      <div className="flex items-center gap-3 border-b border-white/10 pb-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/winter/solik-avatar.webp" alt="" className="h-12 w-12 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[17px] font-extrabold">SOLIK</div>
          <div className="text-[15px] text-muted">@solikgiftbot · бот</div>
        </div>
        <span className={cn('rounded-full px-3 py-1.5 text-[14px] font-bold transition', on === 3 ? 'bg-ok/15 text-ok' : 'bg-white/10 text-muted')}>{on === 3 ? 'Админ' : 'Участник'}</span>
      </div>
      {rights.map((r, i) => (
        <div key={r} className="flex min-h-[52px] items-center justify-between text-[16px]">
          {r}
          <span className={cn('relative h-8 w-[52px] rounded-full transition-colors duration-300', on > i ? 'bg-ok' : 'bg-white/15')}>
            <span className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform duration-300', on > i ? 'translate-x-[24px]' : 'translate-x-1')} />
          </span>
        </div>
      ))}
    </div>
  );
}

function GiftPick({ value, onChange }: { value: number; onChange(i: number): void }) {
  return (
    <div className="grid w-full max-w-[380px] grid-cols-3 gap-2.5">
      {GIFTS.map((g, i) => (
        <button
          key={g.id}
          onClick={() => onChange(i)}
          className={cn(
            'press relative flex flex-col items-center rounded-[22px] border px-1 pb-2.5 pt-2 transition',
            i === value ? 'border-gold bg-gold/[0.12] shadow-[0_0_0_3px_rgba(255,194,61,0.25)]' : 'border-white/12 bg-white/[0.06]',
          )}
        >
          {i === value && (
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-[#141416]">
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={giftSrc(g.id)} alt="" className={cn('h-[72px] w-[72px] object-contain transition-transform', i === value && 'float-y scale-110')} />
          <span className="mt-1 line-clamp-1 text-[13px] font-semibold">{g.name}</span>
          <span className="num mt-0.5 flex items-center gap-1 font-display text-[15px] font-extrabold text-gold">
            <StarIcon size={14} />
            {g.stars}
          </span>
        </button>
      ))}
    </div>
  );
}

const MODES = [
  { icon: Gavel, name: 'Перебивка', line: 'Ставка Stars сбрасывает таймер', tone: 'from-[#ffb020]/30' },
  { icon: MessageSquareMore, name: 'SMS Counter', line: '.sms 100 — первые сто в чате', tone: 'from-[#4ade80]/25' },
  { icon: Dices, name: 'Конкурс 777', line: 'Крути слот, выбей три семёрки', tone: 'from-[#ef4452]/30' },
  { icon: Trophy, name: 'Розыгрыш', line: 'Кнопка «Участвовать» и рандом', tone: 'from-[#a9dcff]/25' },
];

function ModesMock() {
  const [pick, setPick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPick((v) => (v + 1) % MODES.length), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid w-full max-w-[380px] grid-cols-2 gap-2.5">
      {MODES.map((m, i) => (
        <button
          key={m.name}
          onClick={() => setPick(i)}
          className={cn(
            'press rounded-[22px] border bg-gradient-to-b to-white/[0.04] p-3.5 text-left transition duration-300',
            m.tone,
            i === pick ? 'scale-[1.03] border-white/50 shadow-[0_10px_26px_rgba(0,0,0,0.45)]' : 'border-white/10 opacity-80',
          )}
        >
          <m.icon className="h-8 w-8" strokeWidth={2} />
          <div className="mt-3 font-display text-[16px] font-extrabold leading-tight">{m.name}</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">{m.line}</div>
        </button>
      ))}
    </div>
  );
}

function WinnerMock({ gift }: { gift: (typeof GIFTS)[number] }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setPhase(1), 600), setTimeout(() => setPhase(2), 1700)];
    return () => t.forEach(clearTimeout);
  }, []);
  return (
    <div className="flex w-full max-w-[370px] flex-col gap-2.5 rounded-[26px] border border-white/10 bg-[#0e1621]/90 p-3.5">
      <Bubble name="Мира" color="#7cc4ff" letter="М">
        Первая! Хочу мишку
      </Bubble>
      <div className={cn('transition-all duration-500', phase >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')}>
        <Bubble name="SOLIK" bot quote="Мира: Первая! Хочу мишку">
          <b>Поздравляю, Мира!</b> Ты выиграла «{gift.name}» от @winter_chat.
          <span className="mt-1 flex items-center gap-1.5 text-ok">
            <Check className="h-4 w-4" strokeWidth={3} /> Подарок отправлен
          </span>
        </Bubble>
      </div>
      <div className={cn('flex items-center gap-3 rounded-[18px] border border-gold/40 bg-gold/[0.1] p-3 transition-all duration-500', phase >= 2 ? 'scale-100 opacity-100' : 'scale-95 opacity-0')}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={giftSrc(gift.id)} alt="" className="float-y h-14 w-14 object-contain" />
        <div>
          <div className="font-display text-[15px] font-extrabold">Теперь в профиле у Миры</div>
          <div className="text-[14px] text-muted">{gift.name} · подарок Telegram</div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ name, color, letter, bot, quote, children }: { name: string; color?: string; letter?: string; bot?: boolean; quote?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      {bot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/winter/solik-avatar.webp" alt="" className="h-9 w-9 shrink-0 rounded-full" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ background: color }}>
          {letter}
        </span>
      )}
      <div className="min-w-0 rounded-[16px] rounded-bl-[4px] bg-[#182533] px-3 py-2 text-[15px] leading-snug">
        <div className="mb-0.5 text-[14px] font-bold" style={{ color: bot ? '#ffc23d' : color }}>
          {name}
        </div>
        {quote && <div className="mb-1 border-l-2 border-[#7cc4ff] pl-2 text-[13px] text-[#9fb4c8]">{quote}</div>}
        {children}
      </div>
    </div>
  );
}

function Confetti() {
  const bits = Array.from({ length: 36 }, (_, i) => i);
  const colors = ['#ffc23d', '#ef4452', '#ffffff', '#f49ab2', '#a9dcff'];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      <style>{`@keyframes conf{from{transform:translate(0,0) rotate(0)}to{transform:translate(var(--dx),110vh) rotate(var(--r));opacity:.2}}`}</style>
      {bits.map((i) => (
        <span
          key={i}
          className="absolute top-[38%] block h-3 w-2 rounded-[2px]"
          style={
            {
              left: `${10 + ((i * 37) % 80)}%`,
              background: colors[i % colors.length],
              animation: `conf ${1.1 + (i % 5) * 0.18}s cubic-bezier(.2,.6,.4,1) forwards`,
              '--dx': `${((i % 7) - 3) * 40}px`,
              '--r': `${(i % 2 ? 1 : -1) * (360 + i * 20)}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

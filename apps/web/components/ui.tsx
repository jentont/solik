'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn, STATUS } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white font-semibold hover:brightness-110 shadow-[0_6px_18px_-6px_rgb(var(--accent)/0.55)]',
  secondary: 'bg-surface text-fg border border-line/[0.08] hover:bg-elevated',
  ghost: 'text-muted hover:text-fg hover:bg-line/5',
  danger: 'bg-ribbon/12 text-ribbon hover:bg-ribbon/20',
  gold: 'bg-gold text-[#2a1a00] font-semibold hover:brightness-105',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-2xl font-medium transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
          size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-12 px-5 text-[15px]',
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-[17px] font-semibold">{children}</h3>
        {sub && <p className="mt-0.5 text-[13px] leading-snug text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.04em] md:text-[32px]">{title}</h1>
        {sub && <p className="mt-1.5 max-w-xl text-[15px] leading-snug text-muted">{sub}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }>(function Input({ label, hint, className, ...rest }, ref) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <input ref={ref} className={cn('input', className)} {...rest} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }>(function Textarea({ label, hint, className, ...rest }, ref) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <textarea ref={ref} className={cn('input min-h-[120px] resize-y font-mono text-[13px] leading-relaxed', className)} {...rest} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
});

export function Select({ label, hint, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <select className={cn('input appearance-none', className)} {...rest}>
        {children}
      </select>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange(v: boolean): void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-xl p-2 text-left hover:bg-line/[0.03]">
      <span className={cn('mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition', checked ? 'bg-sky' : 'bg-line/15')}>
        <span className={cn('h-4 w-4 rounded-full bg-white transition', checked && 'translate-x-4')} />
      </span>
      <span>
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </button>
  );
}

const tones = {
  ok: 'bg-ok/12 text-ok border-ok/25',
  warn: 'bg-warn/12 text-warn border-warn/25',
  bad: 'bg-bad/12 text-bad border-bad/25',
  muted: 'bg-line/5 text-muted border-line/10',
  accent: 'bg-sky/12 text-sky border-sky/25',
  gold: 'bg-gold/12 text-gold border-gold/25',
  live: 'bg-ribbon/12 text-ribbon border-ribbon/25',
};
export function Badge({ tone = 'muted', children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: 'muted' as const };
  return (
    <Badge tone={s.tone}>
      {s.tone === 'ok' && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
      {s.label}
    </Badge>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange(v: T): void }) {
  return (
    <div className="no-scrollbar -mx-4 mb-5 flex gap-5 overflow-x-auto border-b border-line/[0.06] px-4 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn('relative whitespace-nowrap pb-3 pt-1 text-[15px] transition', value === t.id ? 'font-medium text-fg' : 'text-muted hover:text-fg')}
        >
          {value === t.id && <motion.span layoutId="tab-bg" className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-accent" transition={{ type: 'spring', bounce: 0.15, duration: 0.3 }} />}
          <span className="relative">
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose(): void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
            className={cn('card scroll-thin max-h-[92dvh] w-full overflow-y-auto rounded-b-none p-6 sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{title}</h3>
              <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-line/5 hover:text-fg">
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Confirmation modal for destructive / irreversible actions. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; text: ReactNode; danger?: boolean; confirmText?: string; resolve(v: boolean): void } | null>(null);
  const confirm = (title: string, text: ReactNode, opts: { danger?: boolean; confirmText?: string } = {}) =>
    new Promise<boolean>((resolve) => setState({ title, text, ...opts, resolve }));
  const node = (
    <Modal open={!!state} onClose={() => (state?.resolve(false), setState(null))} title={state?.title}>
      <div className="mb-6 text-sm text-muted">{state?.text}</div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => (state?.resolve(false), setState(null))}>
          Отмена
        </Button>
        <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => (state?.resolve(true), setState(null))}>
          {state?.confirmText ?? 'Подтвердить'}
        </Button>
      </div>
    </Modal>
  );
  return { confirm, node };
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-muted', className)} />;
}

export function Loading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line/10 px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-elevated text-muted">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <p className="text-[16px] font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-[14px] leading-snug text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-bad/25 bg-bad/10 p-4 text-sm">
      <AlertTriangle className="h-5 w-5 shrink-0 text-bad" />
      <span className="flex-1">{error.message}</span>
      {retry && (
        <Button size="sm" variant="secondary" onClick={retry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export function Stat({ label, value, icon, hint }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>{label}</span>
        {icon && <span className="text-muted/70">{icon}</span>}
      </div>
      <div className="num mt-1.5 font-display text-[22px] font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-xl border border-line/[0.07]">
      <table className="w-full text-sm">
        <thead className="bg-elevated/40 text-left text-[13px] text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/[0.05]">{children}</tbody>
      </table>
      {empty && <div className="p-8 text-center text-sm text-muted">Нет данных</div>}
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ←
      </Button>
      {page} / {pages}
      <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        →
      </Button>
    </div>
  );
}

import { cn } from '@/lib/ui/cn';
import type { ComponentProps, ReactNode } from 'react';

/* --------------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:pointer-events-none select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)]',
  secondary:
    'bg-[var(--surface-raised)] border border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]',
  ghost: 'hover:bg-[var(--surface-sunken)]',
  danger: 'text-white bg-bad-500 hover:brightness-110',
  quiet: 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
  // xl exists for in-workout controls: easy to hit with sweaty hands.
  xl: 'h-16 px-6 text-lg font-semibold',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

export function LinkButton({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'a'> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <a
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

/* ----------------------------------------------------------------- Containers */

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'bg-[var(--surface-raised)] border border-[var(--border)] rounded-[var(--radius-card)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 p-5 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="font-semibold text-base leading-tight">{title}</h2>
        {subtitle ? (
          <p className="text-sm text-[var(--text-muted)] mt-1 leading-snug">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="text-sm text-[var(--text-muted)] mt-1 max-w-2xl">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="flex items-start justify-between gap-6 flex-wrap mb-6">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent-2)] mb-2">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-[var(--text-muted)] mt-2 max-w-2xl leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/* --------------------------------------------------------------------- Badges */

type Tone = 'neutral' | 'brand' | 'teal' | 'ok' | 'warn' | 'bad';

const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]',
  brand: 'bg-[var(--accent-soft)] text-[var(--accent)] border-transparent',
  teal: 'bg-teal-100 text-teal-600 border-transparent dark:bg-teal-600/15 dark:text-teal-300',
  ok: 'bg-ok-100 text-ok-500 border-transparent dark:bg-ok-500/15 dark:text-ok-500',
  warn: 'bg-warn-100 text-warn-500 border-transparent dark:bg-warn-500/15 dark:text-warn-500',
  bad: 'bg-bad-100 text-bad-500 border-transparent dark:bg-bad-500/15 dark:text-bad-500',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------------- Notice */

export function Notice({
  tone = 'neutral',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    neutral: 'border-[var(--border)] bg-[var(--surface-sunken)]',
    brand: 'border-brand-200 bg-[var(--accent-soft)] dark:border-brand-700/40',
    teal: 'border-teal-300 bg-teal-100/60 dark:border-teal-600/40 dark:bg-teal-600/10',
    ok: 'border-ok-500/30 bg-ok-100/60 dark:bg-ok-500/10',
    warn: 'border-warn-500/35 bg-warn-100/70 dark:bg-warn-500/10',
    bad: 'border-bad-500/35 bg-bad-100/70 dark:bg-bad-500/10',
  };
  return (
    <div className={cn('rounded-xl border p-4 text-sm leading-relaxed', border[tone], className)}>
      {title ? <p className="font-semibold mb-1">{title}</p> : null}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Empty state */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="surface text-center px-6 py-12">
      {icon ? (
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] grid place-items-center">
          {icon}
        </div>
      ) : null}
      <h3 className="font-semibold">{title}</h3>
      {description ? (
        <p className="text-sm text-[var(--text-muted)] mt-2 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <Card className="p-5 space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </Card>
  );
}

/* ----------------------------------------------------------------- Form parts */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  required,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
        {required ? <span className="text-bad-500 ml-0.5">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-bad-500" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 h-11 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25 transition';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'pr-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'h-auto min-h-24 py-2.5', className)} {...props} />;
}

export function Checkbox({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'h-5 w-5 rounded-md border-[var(--border-strong)] text-[var(--accent)] accent-[var(--accent)]',
        className,
      )}
      {...props}
    />
  );
}

/* ----------------------------------------------------------------- Data bits */

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const accent: Record<Tone, string> = {
    neutral: '',
    brand: 'text-[var(--accent)]',
    teal: 'text-[var(--accent-2)]',
    ok: 'text-ok-500',
    warn: 'text-warn-500',
    bad: 'text-bad-500',
  };
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={cn('text-2xl font-semibold mt-1.5 tabular-nums', accent[tone])}>{value}</p>
      {hint ? <p className="text-xs text-[var(--text-muted)] mt-1">{hint}</p> : null}
    </Card>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-[var(--border)]">
      {items.map((item) => (
        <div key={item.label} className="flex items-start justify-between gap-6 py-2.5">
          <dt className="text-sm text-[var(--text-muted)]">{item.label}</dt>
          <dd className="text-sm text-right font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BulletList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn('space-y-2 text-sm leading-relaxed', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            aria-hidden="true"
            className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-2)]"
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-2 w-full rounded-full bg-[var(--surface-sunken)] overflow-hidden"
    >
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function ReviewStatusBadge({ status }: { status: string }) {
  if (status === 'published') return <Badge tone="ok">Published</Badge>;
  if (status === 'reviewed') return <Badge tone="teal">Professionally reviewed</Badge>;
  if (status === 'imported') return <Badge tone="warn">Imported, unreviewed</Badge>;
  return <Badge tone="warn">Draft — awaiting review</Badge>;
}

'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Send, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Input, Notice } from '@/components/ui';

interface FitBrainSource {
  kind: string;
  label: string;
  href?: string;
}

interface FitBrainAction {
  kind: string;
  label: string;
  href?: string;
}

interface Answer {
  intent: string;
  text: string;
  bullets: string[];
  sources: FitBrainSource[];
  actions: FitBrainAction[];
  disclaimer?: string;
  grounded: boolean;
}

interface Exchange {
  question: string;
  answer: Answer | null;
  error?: string;
}

export function FitBrainChat({
  suggestions,
  limit,
  used,
}: {
  suggestions: string[];
  limit: number | null;
  used: number;
}) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function send(text: string) {
    const question = text.trim();
    if (!question) return;
    setQuery('');
    startTransition(async () => {
      try {
        const res = await fetch('/api/fitbrain', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: question }),
        });
        const json = await res.json();
        if (!res.ok) {
          setHistory((h) => [...h, { question, answer: null, error: json.error ?? 'Request failed.' }]);
          return;
        }
        setHistory((h) => [...h, { question, answer: json as Answer }]);
      } catch {
        setHistory((h) => [
          ...h,
          { question, answer: null, error: 'Could not reach FitBrain. Your data is unaffected.' },
        ]);
      }
    });
  }

  return (
    <Card className="p-5 space-y-4">
      {history.length === 0 ? (
        <div>
          <p className="text-sm text-[var(--text-muted)] mb-3">Try one of these:</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:border-[var(--accent)] transition-colors text-left"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {history.map((item, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <p className="rounded-2xl rounded-br-sm bg-[var(--accent)] text-white px-4 py-2.5 text-sm max-w-[85%]">
                {item.question}
              </p>
            </div>
            {item.error ? (
              <Notice tone="bad">{item.error}</Notice>
            ) : item.answer ? (
              <div className="rounded-2xl rounded-bl-sm bg-[var(--surface-sunken)] px-4 py-3 space-y-2.5 max-w-[95%]">
                <p className="text-sm font-medium">{item.answer.text}</p>
                {item.answer.bullets.length > 0 ? (
                  <ul className="space-y-1.5 text-sm leading-relaxed">
                    {item.answer.bullets.map((b, bi) => (
                      <li key={bi} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-2)]"
                        />
                        <span className="min-w-0">{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.answer.disclaimer ? (
                  <Notice tone="warn">{item.answer.disclaimer}</Notice>
                ) : null}
                {item.answer.actions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.answer.actions
                      .filter((a) => a.href)
                      .map((a) => (
                        <Link key={a.label} href={a.href as string}>
                          <Button size="sm" variant="secondary">
                            {a.label}
                          </Button>
                        </Link>
                      ))}
                  </div>
                ) : null}
                {item.answer.sources.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-xs text-[var(--text-muted)] mr-1">From:</span>
                    {item.answer.sources.slice(0, 6).map((s, si) =>
                      s.href ? (
                        <Link key={si} href={s.href}>
                          <Badge tone="neutral">{s.label}</Badge>
                        </Link>
                      ) : (
                        <Badge key={si} tone="neutral">
                          {s.label}
                        </Badge>
                      ),
                    )}
                  </div>
                ) : null}
                <p className="text-[11px] text-[var(--text-muted)] pt-1 inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Computed from your records — not generated text.
                </p>
              </div>
            ) : null}
          </div>
        ))}
        {pending ? <p className="text-sm text-[var(--text-muted)]">Looking it up…</p> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(query);
          inputRef.current?.focus();
        }}
        className="flex gap-2"
      >
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about your plan, an exercise, or a meal…"
          maxLength={500}
          aria-label="Ask FitBrain"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || query.trim().length === 0}>
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Send</span>
        </Button>
      </form>

      {limit != null ? (
        <p className="text-xs text-[var(--text-muted)]">
          {used} of {limit} assistant actions used today on the free plan.
        </p>
      ) : null}
    </Card>
  );
}

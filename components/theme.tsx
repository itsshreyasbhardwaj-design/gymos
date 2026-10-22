'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/ui/cn';

const KEY = 'gymos-theme';
type Mode = 'light' | 'dark' | 'system';

/**
 * Applies the stored theme before first paint so there is no flash.
 * Inlined deliberately: this has to run before the body renders.
 */
export function ThemeScript() {
  const code = `(function(){try{var m=localStorage.getItem('${KEY}')||'system';var r=document.documentElement;if(m==='system'){r.removeAttribute('data-theme');}else{r.setAttribute('data-theme',m);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

/** localStorage as an external store, so no state is synchronised inside an effect. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('gymos-theme-change', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('gymos-theme-change', onChange);
  };
}

function getSnapshot(): Mode {
  try {
    return ((localStorage.getItem(KEY) as Mode | null) ?? 'system') satisfies Mode;
  } catch {
    return 'system';
  }
}

const getServerSnapshot = (): Mode => 'system';

export function ThemeToggle({ className }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const apply = useCallback((next: Mode) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private browsing or blocked storage: the theme still applies for this page.
    }
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
    window.dispatchEvent(new Event('gymos-theme-change'));
  }, []);

  const options: { id: Mode; label: string; icon: typeof Sun }[] = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div
      className={cn(
        'inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-0.5',
        className,
      )}
      role="group"
      aria-label="Colour theme"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => apply(opt.id)}
            aria-pressed={active}
            title={opt.label}
            className={cn(
              'h-8 w-9 grid place-items-center rounded-[10px] transition-colors',
              active
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

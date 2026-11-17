'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon, ToastProvider, type IconName } from '@/components/ui';
import { SettingsProvider } from '@/lib/client/hooks';
import { watchSystemTheme } from '@/lib/client/theme';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Today', icon: 'today' },
  { href: '/weekly', label: 'Weekly Hub', icon: 'hub' },
  { href: '/compare', label: 'Compare', icon: 'compare' },
  { href: '/targets', label: 'Targets & Sync', icon: 'targets' },
];

function activeIndex(path: string): number {
  const i = TABS.findIndex((t, k) => (k === 0 ? path === '/' : path.startsWith(t.href)));
  return i < 0 ? 0 : i;
}

/** Header (brand + nav) + content wrapper. Nav: bottom bar < 768px, centered pill in header >= 768px. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const idx = activeIndex(path);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => watchSystemTheme(), []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  function onKey(e: React.KeyboardEvent) {
    let n: number | null = null;
    if (e.key === 'ArrowRight') n = (idx + 1) % 4;
    else if (e.key === 'ArrowLeft') n = (idx + 3) % 4;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = 3;
    if (n === null) return;
    e.preventDefault();
    router.push(TABS[n]!.href);
    (nav.current?.querySelectorAll('a')[n] as HTMLElement | undefined)?.focus();
  }

  return (
    <SettingsProvider>
      <ToastProvider>
        <header className="hdr">
          <div className="brand">
            <span className="logo">
              <Icon name="pulse" style={{ strokeWidth: 2.4 }} />
            </span>
            Proof of Work
          </div>
          <nav ref={nav} className="tabs" role="tablist" aria-label="Main sections" style={{ ['--i' as string]: idx }} onKeyDown={onKey}>
            <span className="tab-pill" aria-hidden="true" />
            {TABS.map((t, i) => (
              <Link key={t.href} href={t.href} role="tab" aria-selected={i === idx} tabIndex={i === idx ? 0 : -1} className="tab" prefetch>
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </Link>
            ))}
          </nav>
          <div className="right" />
        </header>
        <main className="wrap panel" key={path}>
          {children}
        </main>
      </ToastProvider>
    </SettingsProvider>
  );
}

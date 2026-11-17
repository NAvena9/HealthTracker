'use client';
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { todayInTz } from '@/lib/domain';
import { api, ApiClientError, type UserSettings } from './api';
import { applyAppearance } from './theme';
import { useToast } from '@/components/ui/Feedback';

export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) return e.issues?.[0] ? `${e.issues[0].message}` : e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-run the fetcher (keeps old data visible while loading). */
  refetch: () => Promise<void>;
  /** Replace data locally (after a save that returns fresh data). */
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/** Fetch on mount and whenever `deps` change. Stale responses are ignored. `fn` may be null to skip. */
export function useAsync<T>(fn: (() => Promise<T>) | null, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(fn !== null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const f = fnRef.current;
    if (!f) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await f();
      if (my === seq.current) {
        setData(r);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetch: run, setData };
}

/* ---------------- settings (shared through SettingsProvider in AppShell) ---------------- */
interface SettingsCtx extends AsyncState<UserSettings> {
  /** PUT /settings; updates local state; applies appearance immediately. */
  save: (patch: Partial<UserSettings>) => Promise<UserSettings>;
}
const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const st = useAsync(() => api.getSettings(), []);
  const { data, setData } = st;
  useEffect(() => {
    if (data) applyAppearance(data.appearance);
  }, [data]);
  const save = useCallback(
    async (patch: Partial<UserSettings>) => {
      const next = await api.putSettings(patch);
      setData(next);
      return next;
    },
    [setData],
  );
  return createElement(Ctx.Provider, { value: { ...st, save } }, children);
}

/** User settings { timezone, program_start_date, strong_default_unit, appearance } + `save(patch)`. */
export function useSettings(): SettingsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSettings must be used inside <SettingsProvider> (AppShell provides it)');
  return c;
}

/** Today's date (YYYY-MM-DD) in the user's timezone; re-evaluates every minute. Null until settings load. */
export function useToday(): string | null {
  const { data } = useSettings();
  const tz = data?.timezone ?? null;
  const [today, setToday] = useState<string | null>(tz ? todayInTz(tz) : null);
  useEffect(() => {
    if (!tz) return;
    const tick = () => setToday(todayInTz(tz));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [tz]);
  return today;
}

/**
 * Optimistic save: `run({ apply, request, rollback, onSuccess, errorMessage })`.
 * Applies the optimistic change, awaits the request, on failure rolls back and shows an error toast.
 * Returns the response, or undefined on failure.
 */
export function useOptimisticSave() {
  const toast = useToast();
  return useCallback(
    async function run<R>(o: { apply?: () => void; request: () => Promise<R>; rollback?: () => void; onSuccess?: (r: R) => void; errorMessage?: string }): Promise<R | undefined> {
      o.apply?.();
      try {
        const r = await o.request();
        o.onSuccess?.(r);
        return r;
      } catch (e) {
        o.rollback?.();
        toast(`${o.errorMessage ?? 'Could not save'}: ${errorMessage(e)}`);
        return undefined;
      }
    },
    [toast],
  );
}

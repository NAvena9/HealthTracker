'use client';
// Appearance = light | dark | system. The resolved theme is written to <html data-theme>,
// the preference to <html data-theme-pref>. Storage key must match the inline script in app/layout.tsx.

export type Appearance = 'system' | 'light' | 'dark';
const KEY = 'pow-appearance';

function resolve(pref: Appearance): 'light' | 'dark' {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

/** Apply immediately and remember on this device (so the next load has no flash). */
export function applyAppearance(pref: Appearance): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: ignore */
  }
  const el = document.documentElement;
  el.setAttribute('data-theme', resolve(pref));
  el.setAttribute('data-theme-pref', pref);
}

/** Current preference as stored on <html> (falls back to 'system'). */
export function currentAppearance(): Appearance {
  const v = document.documentElement.getAttribute('data-theme-pref');
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** Re-resolve when the OS theme changes while the preference is 'system'. Returns an unsubscribe. */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const on = () => {
    if (currentAppearance() === 'system') document.documentElement.setAttribute('data-theme', resolve('system'));
  };
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}

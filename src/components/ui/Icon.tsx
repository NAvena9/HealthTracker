import type { SVGProps } from 'react';

const P = {
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/>',
  hub: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M9 9.5V20M15 9.5V20"/>',
  compare: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
  targets: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9a4 4 0 018 0M12 9l1.8-1.6"/>',
  steps: '<path d="M8 3c2 0 3 1.8 3 4.5S9.6 12 8 12 5 10 5 7s1-4 3-4zM8 15v1.5M16 11c2 0 3 1.8 3 4.5S17.6 20 16 20s-3-2-3-5 1-4 3-4z"/>',
  fork: '<path d="M7 3v8a2 2 0 002 2v8M5 3v5M9 3v5M17 21V3c-2 1.5-3 4-3 7v3h3"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  flame: '<path d="M12 3c1 3.5 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .3 1.2 1 2 2 2-1-3-.5-5 1-8z"/>',
  sync: '<path d="M20 11a8 8 0 00-14.5-4M4 4v4h4M4 13a8 8 0 0014.5 4M20 20v-4h-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  minus: '<path d="M6 12h12"/>',
  near: '<circle cx="12" cy="12" r="7"/><path d="M12 8v4.5"/>',
  dash: '<path d="M8 12h8"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  doc: '<path d="M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v4h4M9 13h6M9 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="M12 4l9 16H3zM12 10v4M12 17h.01"/>',
  ruler: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 8v3M11 8v4M15 8v3"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/>',
  note: '<path d="M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h4"/>',
  phase: '<path d="M4 17l5-5 4 3 7-8M15 7h5v5"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  spinner: '<path d="M12 3a9 9 0 019 9"/>',
} as const;

export type IconName = keyof typeof P;

/** Stroke icon ported from the prototype. `sm` = 16px. Decorative (aria-hidden). */
export function Icon({ name, sm, className = '', ...rest }: { name: IconName; sm?: boolean; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      className={`i ${sm ? 'sm' : ''} ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: P[name] }}
      {...rest}
    />
  );
}

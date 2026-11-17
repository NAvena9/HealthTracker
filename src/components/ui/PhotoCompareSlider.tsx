'use client';
import { useRef, useState } from 'react';

export interface CompareSide {
  /** Short tag on the image, e.g. "A · W1". */
  tag: string;
  /** Spoken name, e.g. "Week 1". */
  name: string;
  url: string | null;
}

const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%' } as const;

function Photo({ side, pose }: { side: CompareSide; pose: string }) {
  if (!side.url) {
    return (
      <div style={{ ...fill, display: 'grid', placeItems: 'center', background: 'var(--elevated)', color: 'var(--text2)', font: '600 14px var(--font)', textAlign: 'center', padding: 12 }}>
        No photo this week
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={side.url} alt={`${side.name}, ${pose}`} draggable={false} style={{ ...fill, objectFit: 'cover' }} />;
}

/**
 * Draggable before/after slider (pointer events, touch friendly) or two stages side by side.
 * A shows left of the divider, B right. Handle: role=slider, arrows +-2, Shift +-10, Home/End.
 */
export function PhotoCompareSlider({ a, b, pose, pos, onPos, sideBySide }: { a: CompareSide; b: CompareSide; pose: string; pos: number; onPos: (p: number) => void; sideBySide: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const [drag, setDrag] = useState(false);
  const clamp = (p: number) => Math.max(0, Math.min(100, p));

  if (sideBySide) {
    return (
      <div className="sbs">
        {[a, b].map((s) => (
          <div key={s.tag} className="stage" role="img" aria-label={`${s.name} ${pose}${s.url ? '' : ', no photo'}`}>
            <Photo side={s} pose={pose} />
            <span className="tag l">{s.tag}</span>
          </div>
        ))}
      </div>
    );
  }

  function fromEvent(e: React.PointerEvent) {
    const el = stage.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0) onPos(clamp(((e.clientX - r.left) / r.width) * 100));
  }
  const now = Math.round(pos);
  return (
    <div
      ref={stage}
      className="stage"
      style={{ ['--pos' as string]: `${pos}%` }}
      onPointerDown={(e) => {
        setDrag(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        fromEvent(e);
        handle.current?.focus({ preventScroll: true });
      }}
      onPointerMove={(e) => {
        if (drag) fromEvent(e);
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
    >
      <div style={fill}>
        <Photo side={b} pose={pose} />
      </div>
      <div className="la">
        <Photo side={a} pose={pose} />
      </div>
      <span className="tag l">{a.tag}</span>
      <span className="tag r">{b.tag}</span>
      <div className="ln">
        <button
          ref={handle}
          type="button"
          className="handle"
          role="slider"
          aria-label={`Comparison divider. Left shows ${a.name}, right shows ${b.name}`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={now}
          aria-valuetext={`${now} percent of ${a.name} shown`}
          onKeyDown={(e) => {
            const st = e.shiftKey ? 10 : 2;
            let p: number | null = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') p = pos + st;
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') p = pos - st;
            else if (e.key === 'Home') p = 0;
            else if (e.key === 'End') p = 100;
            if (p !== null) {
              e.preventDefault();
              onPos(clamp(p));
            }
          }}
        >
          <svg className="i sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6v12M15 6v12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

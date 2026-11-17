export type MacroColor = 'protein' | 'carbs' | 'fat' | 'calories' | 'steps';
export const MACRO_FILL: Record<MacroColor, string> = { protein: 'var(--red)', carbs: 'var(--orange)', fat: 'var(--indigo)', calories: 'var(--blue)', steps: 'var(--green)' };
export const MACRO_TEXT: Record<MacroColor, string> = { protein: 'var(--red-text)', carbs: 'var(--amber-text)', fat: 'var(--indigo-text)', calories: 'var(--blue-text)', steps: 'var(--green-text)' };

/** 8px progress bar. `pct` null = empty. Width capped at 100%; overflow is said in the adjacent badge. */
export function MacroBar({ pct, color = 'calories', label, className = '' }: { pct: number | null; color?: MacroColor; label: string; className?: string }) {
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`bar ${className}`}
      style={{ ['--c' as string]: MACRO_FILL[color], ['--w' as string]: `${w}%` }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? 0 : Math.round(w)}
    >
      <i />
    </div>
  );
}

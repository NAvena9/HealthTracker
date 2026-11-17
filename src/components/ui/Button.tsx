import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'default' | 'primary' | 'tint' | 'ghost';

/** 44px-min button. `loading` disables it and shows a spinner. `icon` = leading icon. `iconOnly` needs aria-label. */
export function Button({ variant = 'default', small, iconOnly, icon, loading, className = '', children, disabled, type = 'button', ...rest }: { variant?: ButtonVariant; small?: boolean; iconOnly?: boolean; icon?: IconName; loading?: boolean; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = variant === 'default' ? '' : variant;
  return (
    <button type={type} className={`btn ${v} ${small ? 'sm' : ''} ${iconOnly ? 'icon' : ''} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Icon name="spinner" sm className="spin" /> : icon ? <Icon name={icon} sm={small || !iconOnly} /> : null}
      {children}
    </button>
  );
}

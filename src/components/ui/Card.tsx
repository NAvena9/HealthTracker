import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** White rounded card (`.card`). */
export function Card({ children, className = '', as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export type IconTone = 'blue' | 'green' | 'amber' | 'indigo' | 'red' | 'neutral';

/** Card header: icon chip + title (+ subtitle) + optional right slot (pill / button). */
export function CardHeader({ icon, tone = 'blue', title, subtitle, right }: { icon?: IconName; tone?: IconTone; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="ch">
      {icon ? (
        <span className={`ico ${tone}`}>
          <Icon name={icon} />
        </span>
      ) : null}
      <div className="fill">
        <h3 className="ct">{title}</h3>
        {subtitle ? <p className="sub small">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

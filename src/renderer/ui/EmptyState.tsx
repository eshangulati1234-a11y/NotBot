import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import './EmptyState.css';

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="nb-empty-state">
      {Icon ? (
        <span className="nb-empty-state__icon">
          <Icon size={20} aria-hidden="true" />
        </span>
      ) : null}
      <h3 className="nb-empty-state__title">{title}</h3>
      {body ? <div className="nb-empty-state__body">{body}</div> : null}
      {action ? <div className="nb-empty-state__action">{action}</div> : null}
    </div>
  );
}

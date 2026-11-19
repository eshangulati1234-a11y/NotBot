import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Kbd } from './Kbd';
import './Button.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  tone?: 'default' | 'danger';
  icon?: LucideIcon;
  shortcut?: string[];
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  tone = 'default',
  icon: Icon,
  shortcut,
  loading = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['nb-button', className].filter(Boolean).join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      data-variant={variant}
      data-tone={tone}
      data-loading={loading || undefined}
      data-bare={!Icon || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Loader2 className="nb-button__spinner" size={16} aria-hidden="true" />
      ) : Icon ? (
        <Icon size={16} aria-hidden="true" />
      ) : null}
      {children ? <span className="nb-button__label">{children}</span> : null}
      {shortcut && shortcut.length > 0 ? <Kbd keys={shortcut} /> : null}
    </button>
  );
}

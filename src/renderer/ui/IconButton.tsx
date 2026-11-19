import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import './IconButton.css';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: LucideIcon;
  tone?: 'default' | 'danger';
};

export function IconButton({
  label,
  icon: Icon,
  tone = 'default',
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  const classes = ['nb-icon-button', className].filter(Boolean).join(' ');
  return (
    <button
      title={label}
      {...rest}
      type={type}
      className={classes}
      data-tone={tone}
      aria-label={label}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

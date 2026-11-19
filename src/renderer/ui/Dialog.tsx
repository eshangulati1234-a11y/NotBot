import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import './Dialog.css';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  children: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  footer,
  children,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="nb-dialog__overlay" />
        <RadixDialog.Content
          className="nb-dialog"
          data-size={size}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <header className="nb-dialog__header">
            <div className="nb-dialog__heading">
              <RadixDialog.Title className="nb-dialog__title">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="nb-dialog__description">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" icon={X} />
            </RadixDialog.Close>
          </header>
          <div className="nb-dialog__body">{children}</div>
          {footer ? <footer className="nb-dialog__footer">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

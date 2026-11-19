import { X } from 'lucide-react';
import { IconButton } from '../ui';
import './Notice.css';

export function Notice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="nb-notice" role="alert">
      <span className="nb-notice__text">{message}</span>
      <IconButton label="Dismiss" icon={X} onClick={onDismiss} />
    </div>
  );
}

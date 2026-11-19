import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Pencil, RotateCcw } from 'lucide-react';
import { copyText } from '../lib/clipboard';
import { IconButton } from '../ui';
import './MessageActions.css';

interface Props {
  /** What the copy button puts on the clipboard. */
  text: string;
  what: 'message' | 'reply';
  onResend?: () => void;
  onEdit?: () => void;
  /** Why resend and edit are unavailable right now, shown as their tooltip. */
  blocked?: string;
}

export function MessageActions({ text, what, onResend, onEdit, blocked }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="nb-msg-actions" role="group" aria-label={`Actions for this ${what}`}>
      <IconButton
        label={copied ? 'Copied' : `Copy ${what}`}
        icon={copied ? Check : Copy}
        onClick={() => void copy()}
      />
      {onResend ? (
        <IconButton
          label={blocked ?? 'Send again'}
          icon={RotateCcw}
          disabled={!!blocked}
          onClick={onResend}
        />
      ) : null}
      {onEdit ? (
        <IconButton
          label={blocked ?? 'Edit and send'}
          icon={Pencil}
          disabled={!!blocked}
          onClick={onEdit}
        />
      ) : null}
      <span className="nb-msg-actions__live" role="status" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  );
}

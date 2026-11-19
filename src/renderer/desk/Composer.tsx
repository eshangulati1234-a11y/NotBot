import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button, Kbd, useAutoGrow } from '../ui';
import './Composer.css';

interface Props {
  helperName: string;
  disabled: boolean;
  disabledReason?: string;
  onSend: (task: string, key: string) => Promise<boolean>;
}

export function Composer({ helperName, disabled, disabledReason, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // One key per draft: a retry of the same draft reuses it so a task is never started twice.
  const key = useRef<string>(crypto.randomUUID());
  const reasonId = 'nb-composer-reason';

  const task = draft.trim();
  const locked = disabled || sending;
  const input = useAutoGrow(draft);

  async function send() {
    if (!task || locked) return;
    setSending(true);
    const ok = await onSend(task, key.current).catch(() => false);
    setSending(false);
    if (ok) {
      setDraft('');
      key.current = crypto.randomUUID();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <form
      className="nb-composer"
      data-disabled={disabled || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="nb-composer__box">
        <textarea
          className="nb-composer__input"
          aria-label="Task"
          aria-describedby={disabled && disabledReason ? reasonId : undefined}
          placeholder={`Describe a task for ${helperName}`}
          ref={input}
          rows={1}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" variant="primary" icon={ArrowUp} disabled={locked || !task} loading={sending}>
          Send
        </Button>
      </div>
      <div className="nb-composer__foot">
        {disabled && disabledReason ? (
          <p id={reasonId} className="nb-composer__reason">
            {disabledReason}
          </p>
        ) : (
          <p className="nb-composer__hint">
            <Kbd keys={['Enter']} /> to send <Kbd keys={['Shift', 'Enter']} /> for a new line
          </p>
        )}
      </div>
    </form>
  );
}

import { Check, X } from 'lucide-react';
import './StatusDot.css';

export type DotState = 'working' | 'waiting' | 'done' | 'failed' | 'paused' | 'idle';

export function StatusDot({
  state,
  label,
  size = 'md',
  decorative = false,
}: {
  state: DotState;
  label: string;
  size?: 'sm' | 'md';
  /** Hide from assistive tech when the same words are shown next to the dot. */
  decorative?: boolean;
}) {
  return (
    <span className="nb-status-dot" data-state={state} data-size={size} role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {state === 'done' ? <Check className="nb-status-dot__glyph" strokeWidth={3} aria-hidden="true" /> : null}
      {state === 'failed' ? <X className="nb-status-dot__glyph" strokeWidth={3} aria-hidden="true" /> : null}
      {state === 'paused' ? (
        <>
          <span className="nb-status-dot__bar" />
          <span className="nb-status-dot__bar" />
        </>
      ) : null}
    </span>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import type { Run } from '../api';
import { finished } from '../api';
import { dotState, runStatusLabel } from '../lib/status';
import { Button, StatusDot } from '../ui';
import './StatusLine.css';

interface Props {
  run: Run | null;
  text: string;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export function StatusLine({ run, text, onStop, onPause, onResume }: Props) {
  const active = run !== null && !finished.includes(run.status);
  const status = run?.status;
  const canPause = status === 'queued' || status === 'running';
  const canResume = status === 'paused';
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLDivElement>(null);
  const runId = run?.id;

  // A confirmation belongs to one task in one state; drop it when either changes.
  useEffect(() => {
    setConfirming(false);
  }, [runId, status, active]);

  useEffect(() => {
    if (confirming) keepRef.current?.querySelector<HTMLButtonElement>('[data-keep]')?.focus();
  }, [confirming]);

  const label = active && run ? text || runStatusLabel(run.status) : 'Ready for a task';

  return (
    <div className="nb-status-line" data-active={active || undefined}>
      <div className="nb-status-line__live" aria-live="polite" aria-atomic="true">
        <StatusDot
          state={active && run ? dotState(run.status) : 'idle'}
          label={active && run ? runStatusLabel(run.status) : 'Idle'}
          size="sm"
        />
        <span className="nb-status-line__text">{label}</span>
      </div>
      {active ? (
        <div className="nb-status-line__actions">
          {canPause ? (
            <Button variant="secondary" icon={Pause} onClick={onPause}>
              Pause
            </Button>
          ) : null}
          {canResume ? (
            <Button variant="secondary" icon={Play} onClick={onResume}>
              Resume
            </Button>
          ) : null}
          {confirming ? (
            <div
              ref={keepRef}
              className="nb-status-line__confirm"
              role="group"
              aria-label="Stop this task?"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setConfirming(false);
                }
              }}
            >
              <span className="nb-status-line__ask">Stop this task?</span>
              <Button variant="secondary" tone="danger" onClick={onStop}>
                Stop
              </Button>
              <Button data-keep variant="secondary" onClick={() => setConfirming(false)}>
                Keep going
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              tone="danger"
              icon={Square}
              onClick={status === 'needs_review' ? onStop : () => setConfirming(true)}
            >
              {status === 'needs_review' ? 'Cancel' : 'Stop'}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

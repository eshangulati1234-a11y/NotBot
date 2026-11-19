import { ChevronRight, House, Search, Settings } from 'lucide-react';
import { Button, IconButton, StatusDot } from '../ui';
import { isMac, modKey } from '../lib/keys';
import type { Notbot } from '../useNotbot';

type ModelState = Notbot['model'];
import './TitleBar.css';

interface TitleBarProps {
  phase: 'starting' | 'failed' | 'ready';
  model: ModelState;
  reviewCount: number;
  crumb?: string;
  onHome: () => void;
  onNextReview: () => void;
  onOpenCommand: () => void;
  onOpenSettings: () => void;
}

function statusOf(phase: TitleBarProps['phase'], model: ModelState) {
  if (phase === 'starting') return { text: 'Starting Notbot…', dot: 'working' as const };
  if (phase === 'failed') return { text: 'Notbot didn’t start', dot: 'failed' as const };
  if (model.status === 'checking') return { text: 'Starting Notbot…', dot: 'working' as const };
  if (model.status === 'ready') return { text: 'Notbot is ready', dot: 'done' as const };
  return { text: 'Model unavailable', dot: 'failed' as const };
}

export function TitleBar(props: TitleBarProps) {
  const { phase, model, reviewCount, crumb, onHome, onNextReview, onOpenCommand, onOpenSettings } =
    props;
  const status = statusOf(phase, model);
  return (
    <header className="nb-title-bar" data-platform={isMac ? 'mac' : 'other'}>
      <div className="nb-title-bar__start">
        <IconButton label="All helpers" icon={House} onClick={onHome} />
        <span className="nb-title-bar__brand">Notbot</span>
        {crumb ? (
          <>
            <ChevronRight className="nb-title-bar__sep" aria-hidden="true" />
            <span className="nb-title-bar__crumb">{crumb}</span>
          </>
        ) : null}
      </div>
      <div className="nb-title-bar__status" role="status">
        <StatusDot state={status.dot} label={status.text} size="sm" decorative />
        <span>{status.text}</span>
      </div>
      <div className="nb-title-bar__end">
        {reviewCount > 0 ? (
          <Button
            variant="secondary"
            onClick={onNextReview}
            aria-label={`${reviewCount} waiting for your review. Go to the next one`}
          >
            <span className="nb-title-bar__review">
              <span>Review</span>
              <span className="nb-title-bar__count">{reviewCount}</span>
            </span>
          </Button>
        ) : null}
        <Button
          variant="secondary"
          icon={Search}
          shortcut={[modKey, 'K']}
          onClick={onOpenCommand}
        >
          Search or ask
        </Button>
        <IconButton label="Settings" icon={Settings} onClick={onOpenSettings} />
      </div>
    </header>
  );
}

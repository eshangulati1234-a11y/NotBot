import { TriangleAlert } from 'lucide-react';
import { deviceName } from '../lib/keys';
import { Button, EmptyState, StatusDot } from '../ui';
import './StartupScreen.css';

interface StartupScreenProps {
  phase: 'starting' | 'failed' | 'ready';
  error: string;
  onRetry: () => void;
}

export function StartupScreen({ phase, error, onRetry }: StartupScreenProps) {
  if (phase === 'failed') {
    return (
      <div className="nb-startup-screen">
        <EmptyState
          icon={TriangleAlert}
          title="Notbot couldn’t start"
          body={
            <span className="nb-startup-screen__body">
              <span>{error || 'The part of Notbot that does the work did not answer.'}</span>
              <span>Nothing was changed in your folders. Try starting it again.</span>
            </span>
          }
          action={
            <Button variant="primary" onClick={onRetry}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="nb-startup-screen" aria-busy="true">
      <div className="nb-startup-screen__loading">
        <StatusDot state="working" label="Starting" size="md" />
        <h1 className="nb-startup-screen__title">Starting Notbot…</h1>
        <p className="nb-startup-screen__text">
          Getting your helpers ready on {deviceName}. This takes a few seconds.
        </p>
      </div>
    </div>
  );
}

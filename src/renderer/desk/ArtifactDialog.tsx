import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { Artifact } from '../api';
import { friendlyError } from '../api';
import { Button, Dialog } from '../ui';
import './ArtifactDialog.css';

interface Props {
  artifact: Artifact | null;
  onOpenChange: (open: boolean) => void;
  read: (id: string) => Promise<string>;
  onExport: (id: string) => void;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; text: string };

export function ArtifactDialog({ artifact, onOpenChange, read, onExport }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const id = artifact?.id;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    read(id).then(
      (text) => !cancelled && setLoad({ status: 'ready', text }),
      (error) => !cancelled && setLoad({ status: 'error', message: friendlyError(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [id, read]);

  return (
    <Dialog
      open={artifact !== null}
      onOpenChange={onOpenChange}
      size="lg"
      title={artifact?.name ?? 'Saved result'}
      description="A result the helper kept from its work."
      footer={
        artifact ? (
          <Button variant="secondary" icon={Download} onClick={() => onExport(artifact.id)}>
            Save a copy...
          </Button>
        ) : undefined
      }
    >
      {load.status === 'loading' ? (
        <p className="nb-artifact-dialog__state" role="status">
          Opening...
        </p>
      ) : load.status === 'error' ? (
        <div className="nb-artifact-dialog__state nb-artifact-dialog__state--error" role="alert">
          <strong className="nb-artifact-dialog__title">Couldn't open this</strong>
          <span>{load.message || 'Try again in a moment.'}</span>
        </div>
      ) : load.text.trim() === '' ? (
        <p className="nb-artifact-dialog__state">This result is empty.</p>
      ) : (
        <pre className="nb-artifact-dialog__text" tabIndex={0}>
          {load.text}
        </pre>
      )}
    </Dialog>
  );
}

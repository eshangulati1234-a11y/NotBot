import { useEffect, useState } from 'react';
import { Check, FolderOpen } from 'lucide-react';
import { Button } from '../ui';
import { folderName } from '../api';
import { DEFAULT_PURPOSE } from '../bots';
import { deviceName } from '../lib/keys';
import type { Notbot } from '../useNotbot';
import { ModelSetup } from './ModelSetup';
import './CreateHelper.css';

interface CreateHelperProps {
  nb: Notbot;
  variant: 'first-run' | 'dialog';
  /** A task typed elsewhere (the command bar). It is sent as the first message once the helper exists. */
  initialPurpose?: string;
  onCreated: (botId: string) => void;
  onCancel?: () => void;
  /** Reports when creation starts and ends, so the parent can keep this form on screen meanwhile. */
  onCreatingChange?: (creating: boolean) => void;
}

export function CreateHelper({ nb, variant, initialPurpose = '', onCreated, onCancel, onCreatingChange }: CreateHelperProps) {
  const workspaces = nb.snapshot.workspaces;
  const [workspaceId, setWorkspaceId] = useState('');
  const [creating, setCreating] = useState(false);
  const model = nb.model;

  // Pre-select the only folder, or the one that was just added.
  useEffect(() => {
    if (!workspaceId && workspaces.length === 1) setWorkspaceId(workspaces[0].id);
  }, [workspaceId, workspaces]);

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const modelReady = model.status === 'ready';
  const canCreate = Boolean(workspace) && modelReady && !creating;

  const choose = async () => {
    const picked = await nb.pickFolder();
    if (picked) setWorkspaceId(picked.id);
  };

  const create = async () => {
    if (!workspace || !canCreate) return;
    setCreating(true);
    onCreatingChange?.(true);
    try {
      const bot = await nb.createHelper(DEFAULT_PURPOSE, workspace.id);
      if (!bot) return;
      const first = initialPurpose.trim();
      if (first) await nb.startTask(bot.id, first, crypto.randomUUID());
      onCreated(bot.id);
    } finally {
      setCreating(false);
      onCreatingChange?.(false);
    }
  };

  return (
    <div className="nb-create-helper" data-variant={variant}>
      <header className="nb-create-helper__head">
        <h1 className="nb-create-helper__title">
          {variant === 'first-run' ? 'Set up your first helper' : 'New helper'}
        </h1>
        <p className="nb-create-helper__intro">
          A helper works in one folder on {deviceName}. It reads freely and asks before changing
          anything. Once it is created, you can start chatting with it.
        </p>
      </header>

      <ol className="nb-create-helper__steps">
        <li className="nb-create-helper__step" data-done={Boolean(workspace)}>
          <span className="nb-create-helper__num" aria-hidden="true">
            {workspace ? <Check /> : '1'}
          </span>
          <div className="nb-create-helper__body">
            <h2 className="nb-create-helper__label">Choose a folder</h2>
            {workspace ? (
              <p className="nb-create-helper__path">
                <span className="nb-create-helper__folder">{folderName(workspace.path)}</span>
                <span className="nb-create-helper__full" title={workspace.path}>
                  {workspace.path}
                </span>
              </p>
            ) : (
              <p className="nb-create-helper__hint">The helper can see this folder and nothing else.</p>
            )}
            <div className="nb-create-helper__row">
              {workspaces.length > 1 ? (
                <select
                  className="nb-select"
                  aria-label="Folders you have already added"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                >
                  <option value="" disabled>
                    Pick a folder you added
                  </option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {folderName(w.path)}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button variant={workspace ? 'secondary' : 'primary'} icon={FolderOpen} onClick={choose}>
                {workspace ? 'Choose another folder' : 'Choose folder'}
              </Button>
            </div>
          </div>
        </li>

        <li className="nb-create-helper__step" data-done={modelReady}>
          <span className="nb-create-helper__num" aria-hidden="true">
            {modelReady ? <Check /> : '2'}
          </span>
          <div className="nb-create-helper__body">
            <h2 className="nb-create-helper__label">Model on {deviceName}</h2>
            {model.status === 'checking' ? (
              <p className="nb-create-helper__hint">Looking for a model on {deviceName}…</p>
            ) : modelReady ? (
              <p className="nb-create-helper__hint">Ready. Using {model.model}, which runs on {deviceName}.</p>
            ) : (
              <ModelSetup
                model={model}
                onDiscover={nb.discoverModels}
                onSave={nb.saveModel}
                onRetry={() => void nb.checkModel()}
              />
            )}
          </div>
        </li>
      </ol>

      <footer className="nb-create-helper__foot">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button variant="primary" onClick={create} disabled={!canCreate} loading={creating}>
          Create helper
        </Button>
      </footer>
    </div>
  );
}

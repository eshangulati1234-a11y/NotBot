import { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button, Dialog, EmptyState, Segmented } from '../ui';
import { folderName } from '../api';
import { deviceName } from '../lib/keys';
import { useThemeChoice, type ThemeChoice } from '../theme';
import type { Notbot } from '../useNotbot';
import { ModelSetup } from '../onboarding/ModelSetup';
import './SettingsDialog.css';

type Section = 'appearance' | 'model' | 'folders';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nb: Notbot;
  section?: Section;
}

const themes: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function modelSummary(nb: Notbot): string {
  const { model } = nb;
  if (model.status === 'ready') return `Using ${model.model}, running on ${deviceName}.`;
  if (model.status === 'checking') return `Looking for a model on ${deviceName}…`;
  return 'No model is available right now. Helpers can’t work until one is.';
}

export function SettingsDialog({ open, onOpenChange, nb, section }: SettingsDialogProps) {
  const [theme, setTheme] = useThemeChoice();
  const workspaces = nb.snapshot.workspaces;
  const [changing, setChanging] = useState(false);
  const showSetup = changing || nb.model.status !== 'ready';

  // Closing the dialog puts the model section back to its summary.
  useEffect(() => {
    if (!open) setChanging(false);
  }, [open]);

  useEffect(() => {
    if (!open || !section) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`nb-settings-${section}`)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, section]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description={`Everything here stays on ${deviceName}.`}
      size="md"
    >
      <div className="nb-settings-dialog">
        <section id="nb-settings-appearance" className="nb-settings-dialog__section" aria-labelledby="nb-settings-appearance-h">
          <h3 id="nb-settings-appearance-h" className="nb-settings-dialog__heading">
            Appearance
          </h3>
          <Segmented<ThemeChoice> label="Theme" value={theme} options={themes} onChange={setTheme} />
        </section>

        <section id="nb-settings-model" className="nb-settings-dialog__section" aria-labelledby="nb-settings-model-h">
          <h3 id="nb-settings-model-h" className="nb-settings-dialog__heading">
            Model
          </h3>
          <p className="nb-settings-dialog__text">{modelSummary(nb)}</p>
          {showSetup ? (
            <ModelSetup
              model={nb.model}
              onDiscover={nb.discoverModels}
              onSave={nb.saveModel}
              onRetry={() => void nb.checkModel()}
            />
          ) : (
            <div>
              <Button variant="secondary" onClick={() => setChanging(true)}>
                Change model
              </Button>
            </div>
          )}
        </section>

        <section id="nb-settings-folders" className="nb-settings-dialog__section" aria-labelledby="nb-settings-folders-h">
          <h3 id="nb-settings-folders-h" className="nb-settings-dialog__heading">
            Folders
          </h3>
          {workspaces.length === 0 ? (
            <EmptyState
              title="No folders yet"
              body="Add a folder and a helper can work in it. It asks before changing anything."
            />
          ) : (
            <ul className="nb-settings-dialog__folders">
              {workspaces.map((w) => (
                <li key={w.id} className="nb-settings-dialog__folder">
                  <span className="nb-settings-dialog__folder-name">{folderName(w.path)}</span>
                  <span className="nb-settings-dialog__folder-path" title={w.path}>
                    {w.path}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button variant="secondary" icon={FolderPlus} onClick={() => void nb.pickFolder()}>
              Add folder
            </Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}

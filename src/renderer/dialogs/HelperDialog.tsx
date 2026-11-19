import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button, Dialog, Field, Segmented, useAutoGrow } from '../ui';
import { folderName, type Bot, type Workspace } from '../api';
import type { HelperView } from '../lib/helpers';
import './HelperDialog.css';

interface HelperDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  helper: HelperView;
  workspaces: Workspace[];
  existingNames: string[];
  onSave: (bot: Bot) => Promise<boolean>;
  onChangeFolder: (workspaceId: string) => void;
  onAddFolder: () => Promise<Workspace | undefined>;
}

type Availability = 'on' | 'paused';

function HelperForm({
  helper,
  workspaces,
  existingNames,
  onSave,
  onChangeFolder,
  onAddFolder,
  onClose,
}: Omit<HelperDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const { bot } = helper;
  const [name, setName] = useState(bot.name);
  const [purpose, setPurpose] = useState(bot.purpose);
  const purposeInput = useAutoGrow(purpose);
  const [folderId, setFolderId] = useState(helper.workspace?.id ?? '');
  const [availability, setAvailability] = useState<Availability>(bot.enabled ? 'on' : 'paused');
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const taken = existingNames.some(
    (other) => other.trim().toLowerCase() === trimmed.toLowerCase() && other !== bot.name,
  );
  const nameError = !trimmed ? 'Give the helper a name.' : taken ? 'Another helper already has this name.' : undefined;
  const valid = !nameError && purpose.trim().length > 0;

  const addFolder = async () => {
    const added = await onAddFolder();
    if (added) setFolderId(added.id);
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const ok = await onSave({ ...bot, name: trimmed, purpose: purpose.trim(), enabled: availability === 'on' });
      if (!ok) return;
      if (folderId && folderId !== helper.workspace?.id) onChangeFolder(folderId);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="nb-helper-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field label="Name" error={nameError}>
        {(id, describedBy) => (
          <input
            id={id}
            aria-describedby={describedBy}
            aria-invalid={Boolean(nameError)}
            className="nb-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label="Job" hint="What this helper is for.">
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            className="nb-textarea"
            ref={purposeInput}
            rows={3}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        )}
      </Field>
      <Field label="Folder" hint="New tasks start in this folder. Earlier tasks stay where they ran.">
        {(id, describedBy) => (
          <div className="nb-helper-dialog__row">
            <select
              id={id}
              aria-describedby={describedBy}
              className="nb-select"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              {!folderId ? <option value="">No folder yet</option> : null}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {folderName(w.path)}
                </option>
              ))}
            </select>
            <Button variant="secondary" icon={FolderPlus} onClick={addFolder}>
              Add folder
            </Button>
          </div>
        )}
      </Field>
      <Segmented<Availability>
        label="Availability"
        value={availability}
        options={[
          { value: 'on', label: 'Available', detail: 'Ready for tasks' },
          { value: 'paused', label: 'Paused', detail: 'Won’t take new tasks' },
        ]}
        onChange={setAvailability}
      />
      <div className="nb-helper-dialog__foot">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!valid} loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function HelperDialog({ open, onOpenChange, ...rest }: HelperDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit helper" size="md">
      {open ? <HelperForm {...rest} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

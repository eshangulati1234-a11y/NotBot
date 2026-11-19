import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { Safety, Workspace } from '../api';
import { folderName } from '../api';
import { PERMISSIONS } from '../lib/status';
import { deviceName } from '../lib/keys';
import { Dialog, Segmented } from '../ui';
import './BoundaryBadge.css';

type Choice = 'ask' | 'balanced';

interface Props {
  workspace: Workspace | null;
  safety: Safety;
  onChangeSafety: (s: Safety) => void;
}

/** The hands-off mode behaves like balanced, so it is shown as balanced. */
const toChoice = (s: Safety): Choice => (s === 'ask' ? 'ask' : 'balanced');

export function BoundaryBadge({ workspace, safety, onChangeSafety }: Props) {
  const [open, setOpen] = useState(false);
  const choice = toChoice(safety);
  const rule = choice === 'ask' ? 'asks before every step' : 'reads freely · asks before changing';
  const folder = workspace ? `${folderName(workspace.path)}/` : 'No folder';

  return (
    <>
      <button
        type="button"
        className="nb-boundary-badge"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="See and change what this helper may do"
      >
        <ShieldCheck className="nb-boundary-badge__icon" aria-hidden="true" />
        <span className="nb-boundary-badge__folder">{folder}</span>
        <span className="nb-boundary-badge__rule">
          {' · '}
          {rule}
          {` · on ${deviceName}`}
        </span>
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="What this helper may do"
        description="It only works inside its folder, and everything stays on this computer. Every change shows you the exact edit first."
      >
        <div className="nb-boundary-badge__body">
          {workspace ? (
            <p className="nb-boundary-badge__path" title={workspace.path}>
              {workspace.path}
            </p>
          ) : null}
          <Segmented<Choice>
            label="Permissions"
            value={choice}
            options={PERMISSIONS.map((p) => ({ value: p.value, label: p.title, detail: p.detail }))}
            onChange={(next) => onChangeSafety(next)}
          />
        </div>
      </Dialog>
    </>
  );
}

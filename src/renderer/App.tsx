import { useEffect, useState } from 'react';
import { Dialog } from './ui';
import { CharacterStage } from './ui/3d/CharacterStage';
import { canDraw3d } from './ui/3d/webgl';
import { isMod, useShortcut } from './lib/keys';
import { useNotbot } from './useNotbot';
import { TitleBar } from './shell/TitleBar';
import { StartupScreen } from './shell/StartupScreen';
import { Notice } from './shell/Notice';
import { ShelfView } from './shelf/ShelfView';
import { CreateHelper } from './onboarding/CreateHelper';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { HelperDialog } from './dialogs/HelperDialog';
import { CommandBar } from './dialogs/CommandBar';
import { Desk } from './desk/Desk';
import './App.css';

type View = { kind: 'shelf' } | { kind: 'desk'; botId: string };
type DialogName = 'settings' | 'helper' | 'command' | 'new' | null;
type SettingsSection = 'appearance' | 'model' | 'folders';

export function App() {
  const nb = useNotbot();
  const [view, setView] = useState<View>({ kind: 'shelf' });
  const [dialog, setDialog] = useState<DialogName>(null);
  const [focusApprovalId, setFocusApprovalId] = useState<string | null>(null);
  const [newPurpose, setNewPurpose] = useState('');
  // While the first helper is being created the form stays up, so the shelf never flashes in between.
  const [creatingFirst, setCreatingFirst] = useState(false);
  const [section, setSection] = useState<SettingsSection | undefined>();

  // A dropped file or folder must do nothing: the window never navigates to it.
  useEffect(() => {
    const stop = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  useShortcut(
    (event) => isMod(event) && event.key.toLowerCase() === 'k',
    (event) => {
      event.preventDefault();
      setDialog((current) => (current === 'command' ? null : 'command'));
    },
    nb.phase === 'ready',
  );

  const helpers = nb.helpers;
  const deskHelper = view.kind === 'desk' ? helpers.find((h) => h.bot.id === view.botId) : undefined;

  const goHome = () => {
    setView({ kind: 'shelf' });
    setFocusApprovalId(null);
  };
  const openDesk = (botId: string) => {
    setView({ kind: 'desk', botId });
    setFocusApprovalId(null);
  };
  const openSettings = (next?: SettingsSection) => {
    setSection(next);
    setDialog('settings');
  };
  const openNew = (purpose = '') => {
    setNewPurpose(purpose);
    setDialog('new');
  };

  const nextReview = () => {
    const queue = nb.reviewQueue;
    if (!queue.length) return;
    const at = queue.findIndex((item) => item.approval.id === focusApprovalId);
    const next = queue[(at + 1) % queue.length];
    setView({ kind: 'desk', botId: next.bot.id });
    setFocusApprovalId(next.approval.id);
  };

  const ask = (botId: string, text: string) => {
    if (nb.model.status !== 'ready') return;
    openDesk(botId);
    void nb.startTask(botId, text, crypto.randomUUID());
  };

  const ready = nb.phase === 'ready';
  let content;
  if (!ready) {
    content = <StartupScreen phase={nb.phase} error={nb.startupError} onRetry={() => void nb.retryStartup()} />;
  } else if (helpers.length === 0 || (creatingFirst && !deskHelper)) {
    content = (
      <CreateHelper nb={nb} variant="first-run" onCreated={openDesk} onCreatingChange={setCreatingFirst} />
    );
  } else if (deskHelper) {
    content = (
      <Desk
        key={deskHelper.bot.id}
        nb={nb}
        helper={deskHelper}
        focusApprovalId={focusApprovalId}
        onFocusApproval={setFocusApprovalId}
        onEditHelper={() => setDialog('helper')}
      />
    );
  } else {
    content = <ShelfView helpers={helpers} onOpen={openDesk} onNewHelper={() => openNew()} />;
  }

  return (
    <div className="nb-app">
      {canDraw3d() ? <CharacterStage /> : null}
      <TitleBar
        phase={nb.phase}
        model={nb.model}
        reviewCount={nb.reviewQueue.length}
        crumb={deskHelper?.bot.name}
        onHome={goHome}
        onNextReview={nextReview}
        onOpenCommand={() => setDialog('command')}
        onOpenSettings={() => openSettings()}
      />
      <main className="nb-app__main">{content}</main>

      {nb.notice ? <Notice message={nb.notice} onDismiss={nb.clearNotice} /> : null}

      {ready ? (
        <>
          <CommandBar
            open={dialog === 'command'}
            onOpenChange={(open) => setDialog(open ? 'command' : null)}
            helpers={helpers}
            modelReady={nb.model.status === 'ready'}
            onAsk={ask}
            onNewHelper={openNew}
            onOpenHelper={openDesk}
            onAddFolder={() => void nb.pickFolder()}
            onChangeModel={() => openSettings('model')}
            onOpenSettings={() => openSettings()}
          />
          <Dialog
            open={dialog === 'new'}
            onOpenChange={(open) => setDialog(open ? 'new' : null)}
            title="New helper"
            size="md"
          >
            {dialog === 'new' ? (
              <CreateHelper
                nb={nb}
                variant="dialog"
                initialPurpose={newPurpose}
                onCreated={(botId) => {
                  setDialog(null);
                  openDesk(botId);
                }}
                onCancel={() => setDialog(null)}
              />
            ) : null}
          </Dialog>
          {deskHelper ? (
            <HelperDialog
              open={dialog === 'helper'}
              onOpenChange={(open) => setDialog(open ? 'helper' : null)}
              helper={deskHelper}
              workspaces={nb.snapshot.workspaces}
              existingNames={helpers.map((h) => h.bot.name)}
              onSave={nb.updateHelper}
              onChangeFolder={(workspaceId) => nb.setHelperFolder(deskHelper.bot.id, workspaceId)}
              onAddFolder={nb.pickFolder}
            />
          ) : null}
        </>
      ) : null}
      <SettingsDialog
        open={dialog === 'settings'}
        onOpenChange={(open) => setDialog(open ? 'settings' : null)}
        nb={nb}
        section={section}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Artifact, Safety } from '../api';
import { finished, folderName } from '../api';
import type { HelperView, ReviewItem } from '../lib/helpers';
import { deriveTasks, liveLine } from '../lib/trail';
import { deriveTree, type TreeNode } from '../lib/tree';
import type { Notbot } from '../useNotbot';
import { Button, HelperMark } from '../ui';
import { ArtifactDialog } from './ArtifactDialog';
import { BoundaryBadge } from './BoundaryBadge';
import { Composer } from './Composer';
import { FolderTree } from './FolderTree';
import { ReviewPane, type ReviewOutcome } from './ReviewPane';
import { StatusLine } from './StatusLine';
import { Trail } from './Trail';
import './Desk.css';

interface Props {
  nb: Notbot;
  helper: HelperView;
  focusApprovalId: string | null;
  onFocusApproval: (id: string | null) => void;
  onEditHelper: () => void;
}

interface Settled {
  item: ReviewItem;
  decision: 'approve' | 'reject';
}

function collectPaths(node: TreeNode, into: string[] = []): string[] {
  for (const child of node.children) {
    if (child.dir) collectPaths(child, into);
    else into.push(child.path);
  }
  return into;
}

export function Desk({ nb, helper, focusApprovalId, onFocusApproval, onEditHelper }: Props) {
  const { snapshot } = nb;
  const runIds = useMemo(() => new Set(helper.runs.map((r) => r.id)), [helper.runs]);
  const approvals = useMemo(() => snapshot.approvals.filter((a) => runIds.has(a.run_id)), [snapshot.approvals, runIds]);
  const artifacts = useMemo(
    () => snapshot.artifacts.filter((a) => a.run_id !== null && runIds.has(a.run_id)),
    [snapshot.artifacts, runIds],
  );

  const tasks = useMemo(
    () => deriveTasks(helper.conversations, helper.runs, approvals, artifacts, nb.streams),
    [helper.conversations, helper.runs, approvals, artifacts, nb.streams],
  );
  const tree = useMemo(() => deriveTree(helper.conversations, approvals), [helper.conversations, approvals]);
  const knownPaths = useMemo(() => {
    const set = new Set(collectPaths(tree));
    for (const t of tasks) {
      t.changed.forEach((p) => set.add(p));
      t.steps.forEach((s) => {
        if (s.kind === 'tool') s.paths.forEach((p) => set.add(p));
      });
    }
    return [...set];
  }, [tree, tasks]);

  const run = helper.activeRun;
  const active = run !== null && !finished.includes(run.status);

  // Review items for this helper only.
  const queue = useMemo(() => nb.reviewQueue.filter((i) => i.bot.id === helper.bot.id), [nb.reviewQueue, helper.bot.id]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [preview, setPreview] = useState<Artifact | null>(null);

  const items = queue.filter((i) => !dismissed.has(i.approval.id) || i.approval.id === focusApprovalId);
  const current =
    items.find((i) => i.approval.id === focusApprovalId) ?? items.find((i) => i.approval.id === pickedId) ?? items[0];
  const currentIndex = current ? items.indexOf(current) : 0;
  
  useEffect(() => {
    if (focusApprovalId) {
      setDismissed((prev) => {
        if (!prev.has(focusApprovalId)) return prev;
        const next = new Set(prev);
        next.delete(focusApprovalId);
        return next;
      });
    }
  }, [focusApprovalId]);

  // Asking to look at a specific request replaces any confirmation still showing.
  useEffect(() => {
    if (focusApprovalId) setSettled(null);
  }, [focusApprovalId]);

  const decide = useCallback(
    async (d: 'approve' | 'reject') => {
      if (!current) return false;
      setDeciding(true);
      const ok = await nb.decide(current.approval.id, d);
      setDeciding(false);
      if (ok) setSettled({ item: current, decision: d });
      return ok;
    },
    [current, nb],
  );

  const outcome: ReviewOutcome | null = useMemo(() => {
    if (!settled) return null;
    const id = settled.item.approval.id;
    const live = snapshot.approvals.find((a) => a.id === id);
    const path = settled.item.approval.data.arguments.path;
    if (settled.decision === 'reject') return { kind: 'rejected', pending: false, changed: [], backupArtifactId: null };
    const done = live?.status === 'consumed';
    const runNow = snapshot.runs.find((r) => r.id === settled.item.run.id);
    const stillGoing = !!runNow && !finished.includes(runNow.status) && runNow.status !== 'needs_review';
    if (!done && !stillGoing) return { kind: 'failed', pending: false, changed: [], backupArtifactId: null };
    const task = tasks.find((t) => t.run?.id === settled.item.run.id);
    const changed = task && task.changed.length > 0 ? task.changed : path ? [path] : [];
    const backupId = `${id.replace(/:approval$/, '')}:backup`;
    const backup = snapshot.artifacts.some((a) => a.id === backupId) ? backupId : null;
    return { kind: 'applied', pending: !done, changed, backupArtifactId: backup };
  }, [settled, snapshot.approvals, snapshot.runs, snapshot.artifacts, tasks]);

  // A confirmation takes the pane first, even when another request is already queued behind it.
  const showReview = current !== undefined || settled !== null;
  const paneItem = settled?.item ?? current;

  const next = () => {
    if (items.length < 2) return;
    setPickedId(items[(currentIndex + 1) % items.length].approval.id);
    onFocusApproval(null);
  };
  const close = () => {
    if (settled) {
      setSettled(null);
      return;
    }
    if (current) setDismissed((prev) => new Set([...prev, ...items.map((i) => i.approval.id)]));
    setSettled(null);
    onFocusApproval(null);
  };

  const model = nb.model;
  let disabledReason: string | undefined;
  if (!helper.bot.enabled) disabledReason = 'This helper is turned off. Turn it on from Edit helper to give it tasks.';
  else if (model.status !== 'ready')
    disabledReason = model.status === 'checking' ? 'Checking for a model...' : model.message || 'No model is available yet.';
  else if (active && run) {
    disabledReason =
      run.status === 'needs_review'
        ? 'Cancel the task that needs a fresh start before sending a new one.'
        : run.status === 'waiting'
          ? 'Waiting for your review before it can continue.'
          : run.status === 'paused'
            ? 'Paused. Resume or stop it to send a new task.'
            : `${helper.bot.name} is working. You can send the next task when it finishes.`;
  }

  const openPreview = (id: string) => setPreview(snapshot.artifacts.find((a) => a.id === id) ?? null);
  const workspace = helper.workspace;
  const folder = workspace ? folderName(workspace.path) : 'No folder';

  return (
    <div className="nb-desk" data-review={showReview || undefined}>
      <header className="nb-desk__head">
        <div className="nb-desk__who">
          <HelperMark name={helper.bot.name} size={28} />
          <div className="nb-desk__titles">
            <h1 className="nb-desk__title">{helper.bot.name}</h1>
            <p className="nb-desk__purpose" title={helper.bot.purpose}>
              {helper.bot.purpose}
            </p>
          </div>
        </div>
        <div className="nb-desk__tools">
          <BoundaryBadge
            workspace={workspace}
            safety={helper.bot.safety}
            onChangeSafety={(s: Safety) => void nb.updateHelper({ ...helper.bot, safety: s })}
          />
          <Button variant="secondary" icon={Pencil} onClick={onEditHelper}>
            Edit helper
          </Button>
        </div>
      </header>

      <div className="nb-desk__tree">
        <FolderTree tree={tree} folderName={folder} folderPath={workspace?.path ?? ''} />
      </div>

      <section className="nb-desk__centre" aria-label="Tasks">
        <Trail
          tasks={tasks}
          liveText={run ? liveLine(nb.live[run.id], run, helper.conversations) : ''}
          activeRun={run}
          knownPaths={knownPaths}
          focusApprovalId={focusApprovalId}
          onReview={(id) => {
            setPickedId(id);
            onFocusApproval(id);
          }}
          onExport={(id) => void nb.exportArtifact(id)}
          onPreview={openPreview}
        />
        <div className="nb-desk__dock">
          <div className="nb-desk__dock-inner">
            <StatusLine
              run={run}
              text={run ? liveLine(nb.live[run.id], run, helper.conversations) : ''}
              onStop={() => run && void nb.runAction(run.id, 'cancel')}
              onPause={() => run && void nb.runAction(run.id, 'pause')}
              onResume={() => run && void nb.runAction(run.id, 'resume')}
            />
            <Composer
              helperName={helper.bot.name}
              disabled={disabledReason !== undefined}
              disabledReason={disabledReason}
              onSend={async (task, key) => !!(await nb.startTask(helper.bot.id, task, key))}
            />
          </div>
        </div>
      </section>

      {showReview && paneItem ? (
        <aside className="nb-desk__review">
          <ReviewPane
            item={paneItem}
            index={currentIndex}
            total={Math.max(items.length, 1)}
            busy={deciding}
            onDecide={decide}
            onNext={next}
            onClose={close}
            outcome={settled ? outcome : null}
            onExport={(id) => void nb.exportArtifact(id)}
          />
        </aside>
      ) : null}

      <ArtifactDialog
        artifact={preview}
        onOpenChange={(open) => !open && setPreview(null)}
        read={nb.readArtifact}
        onExport={(id) => void nb.exportArtifact(id)}
      />
    </div>
  );
}

import {
  finished,
  folderName,
  type Approval,
  type Bot,
  type Conversation,
  type Run,
  type Snapshot,
  type Workspace,
} from '../api';

export type HelperState = 'idle' | 'working' | 'waiting' | 'paused' | 'done' | 'failed' | 'off';

export interface HelperView {
  bot: Bot;
  workspace: Workspace | null;
  /** This helper's conversations, oldest first. */
  conversations: Conversation[];
  /** The helper's most recent conversation in its current folder, if any. */
  current: Conversation | null;
  /** This helper's runs, oldest first. */
  runs: Run[];
  activeRun: Run | null;
  /** Reviews waiting on the user, oldest first. */
  pending: Approval[];
  state: HelperState;
  outcome: string;
  /** Last activity in milliseconds since the epoch (0 when nothing has happened). */
  updated: number;
}

export interface ReviewItem {
  approval: Approval;
  run: Run;
  bot: Bot;
  workspace: Workspace | null;
}

const isActive = (run: Run) => !finished.includes(run.status);

/** Pending, not expired, and the run is waiting on exactly this kind of decision. */
const awaitingReview = (approval: Approval, run: Run | undefined, now: number): run is Run =>
  approval.status === 'pending' && run?.status === 'waiting' && approval.expires * 1000 > now;

/** Approvals are stored newest first; this returns them oldest first. */
const oldestFirst = (approvals: Approval[]) => [...approvals].reverse();

export function deriveReviewQueue(s: Snapshot, now: number = Date.now()): ReviewItem[] {
  const runs = new Map(s.runs.map((run) => [run.id, run]));
  const bots = new Map(s.bots.map((bot) => [bot.id, bot]));
  const workspaces = new Map(s.workspaces.map((w) => [w.id, w]));
  const items: ReviewItem[] = [];
  for (const approval of oldestFirst(s.approvals)) {
    const run = runs.get(approval.run_id);
    if (!awaitingReview(approval, run, now)) continue;
    const bot = bots.get(run.bot_id);
    if (!bot) continue;
    items.push({ approval, run, bot, workspace: workspaces.get(run.workspace_id) ?? null });
  }
  return items;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function changedFiles(run: Run | undefined, approvals: Approval[]): number {
  if (!run) return 0;
  const paths = new Set<string>();
  for (const a of approvals) {
    if (a.run_id === run.id && a.status === 'consumed' && a.data.tool === 'write_file') {
      paths.add(String(a.data.arguments?.path ?? a.id));
    }
  }
  return paths.size;
}

/** What the waiting reviews want to change, in a few words. */
function wantsText(pending: Approval[]): string {
  const paths = new Set<string>();
  for (const a of pending) paths.add(String(a.data.arguments?.path ?? a.id));
  if (paths.size === 1) {
    const [only] = paths;
    return pending[0]?.data.tool === 'write_file' ? `Wants to change ${only}` : 'Wants to make a change';
  }
  return paths.size ? `Wants to change ${plural(paths.size, 'file', 'files')}` : 'Wants to make a change';
}

/**
 * One line under the state label. It never repeats the state itself: it says what was changed,
 * or what the helper is asking to change.
 */
function outcomeText(
  state: HelperState,
  run: Run | undefined,
  changed: number,
  pending: Approval[],
): string {
  const updated = changed ? `Updated ${plural(changed, 'file', 'files')}` : '';
  const join = (...parts: string[]) => parts.filter(Boolean).join(' \u00B7 ');
  switch (state) {
    case 'off':
      return 'Not taking tasks';
    case 'idle':
      return run?.status === 'cancelled' ? join('Stopped', updated) : 'No tasks yet';
    case 'working':
    case 'paused':
      return updated || 'No changes yet';
    case 'waiting':
      return join(updated, wantsText(pending));
    case 'done':
      return updated || 'No changes made';
    case 'failed':
      return run?.status === 'needs_review'
        ? 'Start a new task to continue'
        : updated || 'No changes made';
  }
}

function stateOf(bot: Bot, active: Run | null, latest: Run | undefined, pending: number): HelperState {
  if (!bot.enabled) return 'off';
  if (active) {
    if (active.status === 'waiting') return 'waiting';
    if (active.status === 'paused') return 'paused';
    if (active.status === 'needs_review') return 'failed';
    return pending ? 'waiting' : 'working';
  }
  if (!latest) return 'idle';
  if (latest.status === 'completed') return 'done';
  if (latest.status === 'failed') return 'failed';
  return 'idle';
}

const rank = (state: HelperState) => (state === 'waiting' ? 0 : state === 'working' ? 1 : 2);

export function deriveHelpers(
  s: Snapshot,
  folderPrefs: Record<string, string>,
  now: number = Date.now(),
): HelperView[] {
  const workspaces = new Map(s.workspaces.map((w) => [w.id, w]));
  const views = s.bots.map((bot): HelperView => {
    const conversations = s.conversations
      .map((conversation, index) => ({ conversation, index }))
      .filter(({ conversation }) => conversation.bot_id === bot.id)
      .sort((a, b) => (a.conversation.created ?? 0) - (b.conversation.created ?? 0) || a.index - b.index)
      .map(({ conversation }) => conversation);
    const latestConversation = conversations.at(-1);
    const preferred = workspaces.get(folderPrefs[bot.id] ?? '');
    const workspace = preferred ?? workspaces.get(latestConversation?.workspace_id ?? '') ?? null;
    const current =
      [...conversations].reverse().find((c) => c.workspace_id === workspace?.id) ?? null;
    const runs = s.runs.filter((run) => run.bot_id === bot.id).sort((a, b) => a.created - b.created);
    const active = runs.filter(isActive);
    const activeRun =
      active.find((run) => run.conversation_id === current?.id) ?? active.at(-1) ?? null;
    const runIds = new Map(runs.map((run) => [run.id, run]));
    const pending = oldestFirst(s.approvals).filter((a) => awaitingReview(a, runIds.get(a.run_id), now));
    const latest = runs.at(-1);
    const state = stateOf(bot, activeRun, latest, pending.length);
    const shown = activeRun ?? latest;
    const updated = Math.max(
      0,
      ...runs.map((run) => run.created * 1000),
      ...conversations.map((c) => (c.created ?? 0) * 1000),
    );
    return {
      bot,
      workspace,
      conversations,
      current,
      runs,
      activeRun,
      pending,
      state,
      outcome: outcomeText(state, shown, changedFiles(shown, s.approvals), pending),
      updated,
    };
  });
  return views
    .map((view, index) => ({ view, index }))
    .sort((a, b) => rank(a.view.state) - rank(b.view.state) || b.view.updated - a.view.updated || a.index - b.index)
    .map(({ view }) => view);
}

export interface FolderGroup {
  key: string;
  name: string;
  path: string;
  helpers: HelperView[];
}

/** Groups keep the incoming order: a folder appears where its first (most urgent) helper is. */
export function groupByFolder(helpers: HelperView[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  for (const helper of helpers) {
    const key = helper.workspace?.id ?? '';
    let group = groups.get(key);
    if (!group) {
      const workspace = helper.workspace;
      group = {
        key,
        name: workspace ? folderName(workspace.path) || workspace.name : 'No folder yet',
        path: workspace?.path ?? '',
        helpers: [],
      };
      groups.set(key, group);
    }
    group.helpers.push(helper);
  }
  return [...groups.values()];
}

import {
  finished,
  messageText,
  type Approval,
  type Artifact,
  type Conversation,
  type Message,
  type Run,
  type ToolCall,
} from '../api';
import type { RuntimeEvent } from '../../shared/runtime';
import { explainError, runStatusLabel, toolPhrase } from './status';

export type TrailStep =
  | {
      kind: 'tool';
      id: string;
      tool: string;
      label: string;
      paths: string[];
      state: 'running' | 'done' | 'error';
    }
  | {
      kind: 'review';
      id: string;
      approvalId: string;
      tool: string;
      path: string | null;
      state: 'pending' | 'applying' | 'applied' | 'rejected' | 'expired';
      backupArtifactId: string | null;
    }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'end'; id: string; tone: 'done' | 'stopped' | 'failed'; text: string };

export interface TaskView {
  id: string;
  run: Run | null;
  task: string;
  steps: TrailStep[];
  answer: string;
  streaming: boolean;
  /** Paths of files this task changed. */
  changed: string[];
  /** When the task started, in milliseconds since the epoch (0 when unknown). */
  started: number;
  answerArtifactId: string | null;
}

export interface LiveStatus {
  runId: string;
  phase: 'thinking' | 'tool' | 'answering';
  tool?: string;
  attemptId?: string;
  /** Milliseconds since the epoch, taken from the event. */
  updated: number;
}
export type LiveMap = Record<string, LiveStatus>;

const approvalSuffix = ':approval';
const attemptOf = (approvalId: string) =>
  approvalId.endsWith(approvalSuffix) ? approvalId.slice(0, -approvalSuffix.length) : approvalId;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function failedLabel(call: ToolCall): string {
  const path = str(call.args?.path);
  switch (call.name) {
    case 'list_directory':
      return path && path !== '.' ? `Couldn't look in ${path}` : "Couldn't look around the folder";
    case 'read_file':
      return path ? `Couldn't read ${path}` : "Couldn't read a file";
    case 'search_text':
      return "Couldn't search the folder";
    case 'write_file':
      return path ? `Couldn't change ${path}` : "Couldn't change a file";
    default:
      return "A step didn't work";
  }
}

function toolPaths(call: ToolCall, result: Record<string, unknown> | null): string[] {
  const path = str(call.args?.path);
  if (call.name === 'search_text' && result && Array.isArray(result.matches)) {
    const seen: string[] = [];
    for (const match of result.matches as { path?: unknown }[]) {
      const p = str(match?.path);
      if (p && !seen.includes(p)) seen.push(p);
      if (seen.length === 8) break;
    }
    return seen;
  }
  if (!path || path === '.' || call.name === 'write_memory') return [];
  return [path];
}

function reviewState(
  approval: Approval,
  run: Run | null,
  result: Record<string, unknown> | null,
  now: number,
): Extract<TrailStep, { kind: 'review' }>['state'] {
  if (approval.status === 'consumed' || result?.written === true) return 'applied';
  if (approval.status === 'reject') return 'rejected';
  if (approval.status === 'approve') return 'applying';
  if (result && typeof result.error === 'string' && /rejected/i.test(result.error)) return 'rejected';
  if (run?.status === 'needs_review' || approval.expires * 1000 < now) return 'expired';
  if (run && finished.includes(run.status)) return 'expired';
  return 'pending';
}

interface Build {
  steps: TrailStep[];
  answer: string;
  changed: string[];
}

/** Turns an ordered list of messages (and the approvals for their tool calls) into steps. */
function buildSteps(
  messages: Message[],
  run: Run | null,
  approvals: Map<string, Approval>,
  artifacts: Set<string>,
  now: number,
): Build {
  const results = new Map<string, Message>();
  for (const m of messages) {
    if (m.type === 'tool' && m.data.tool_call_id) results.set(m.data.tool_call_id, m);
  }
  const resultById = new Map<string, Message>();
  for (const m of messages) if (m.type === 'tool' && m.data.id) resultById.set(m.data.id, m);

  const steps: TrailStep[] = [];
  const changed: string[] = [];
  let answer = '';
  for (const m of messages) {
    if (m.type !== 'ai') continue;
    const text = messageText(m).trim();
    const calls = m.data.tool_calls ?? [];
    if (!calls.length) {
      if (text) answer = text;
      continue;
    }
    if (text) steps.push({ kind: 'note', id: `${m.data.id ?? 'note'}:note`, text });
    const turn = /:model:(\d+)$/.exec(m.data.id ?? '');
    calls.forEach((rawCall, index) => {
      const call: ToolCall = { ...rawCall, args: (rawCall.args ?? {}) as Record<string, unknown> };
      const attemptId =
        run && turn ? `${run.id}:tool:${turn[1]}:${index}` : (resultById.get(call.id)?.data.id ?? call.id);
      const message = results.get(call.id) ?? resultById.get(attemptId);
      const result = message ? parseJson(messageText(message)) : null;
      const approval = approvals.get(`${attemptId}${approvalSuffix}`);
      if (approval) {
        const state = reviewState(approval, run, result, now);
        const path = str(approval.data.arguments?.path) || str(call.args?.path) || null;
        const backupId = `${attemptId}:backup`;
        if (state === 'applied' && call.name === 'write_file' && path) {
          if (!changed.includes(path)) changed.push(path);
        }
        steps.push({
          kind: 'review',
          id: attemptId,
          approvalId: approval.id,
          tool: approval.data.tool || call.name,
          path,
          state,
          backupArtifactId:
            state === 'applied' && approval.data.before_hash != null && artifacts.has(backupId)
              ? backupId
              : null,
        });
        return;
      }
      const failed = !!result && typeof result.error === 'string';
      steps.push({
        kind: 'tool',
        id: attemptId,
        tool: call.name,
        label: !message
          ? toolPhrase(call.name, call.args, 'live')
          : failed
            ? failedLabel(call)
            : toolPhrase(call.name, call.args, 'past'),
        paths: toolPaths(call, result),
        state: !message ? 'running' : failed ? 'error' : 'done',
      });
    });
  }
  return { steps, answer, changed };
}

function endStep(run: Run): TrailStep | null {
  if (run.status === 'completed') return { kind: 'end', id: `${run.id}:end`, tone: 'done', text: runStatusLabel('completed') };
  if (run.status === 'cancelled') return { kind: 'end', id: `${run.id}:end`, tone: 'stopped', text: runStatusLabel('cancelled') };
  if (run.status === 'failed')
    return { kind: 'end', id: `${run.id}:end`, tone: 'failed', text: explainError(run.error).title };
  if (run.status === 'needs_review')
    return { kind: 'end', id: `${run.id}:end`, tone: 'failed', text: runStatusLabel('needs_review') };
  return null;
}

/** Tasks in the order they happened, oldest first. */
export function deriveTasks(
  conversations: Conversation[],
  runs: Run[],
  approvals: Approval[],
  artifacts: Artifact[],
  streams: Record<string, { run: string; text: string }>,
  now: number = Date.now(),
): TaskView[] {
  const approvalMap = new Map(approvals.map((a) => [a.id, a]));
  const artifactIds = new Set(artifacts.map((a) => a.id));
  const runIds = new Set(runs.map((r) => r.id));
  const owner = (id: string | undefined) => {
    if (!id) return null;
    const hit = /^(.+?):(?:user|model|tool)(?::|$)/.exec(id);
    return hit && runIds.has(hit[1]) ? hit[1] : null;
  };
  const ordered = conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((a, b) => (a.conversation.created ?? 0) - (b.conversation.created ?? 0) || a.index - b.index);

  const tasks: TaskView[] = [];
  const claimed = new Set<string>();
  for (const { conversation } of ordered) {
    // Imported history has no run: group it by the human messages that start each exchange.
    let group: Message[] | null = null;
    const flush = () => {
      if (!group?.length) return;
      const first = group[0];
      const built = buildSteps(group.slice(first.type === 'human' ? 1 : 0), null, approvalMap, artifactIds, now);
      tasks.push({
        id: first.data.id ?? `${conversation.id}:import:${tasks.length}`,
        run: null,
        task: first.type === 'human' ? messageText(first) : '',
        steps: built.steps,
        answer: built.answer,
        streaming: false,
        changed: built.changed,
        started: (conversation.created ?? 0) * 1000,
        answerArtifactId: null,
      });
      group = null;
    };
    for (const message of conversation.messages) {
      if (owner(message.data.id)) continue;
      if (message.type === 'human' || !group) {
        flush();
        group = [];
      }
      group.push(message);
    }
    flush();

    const mine = runs
      .filter((run) => run.conversation_id === conversation.id)
      .sort((a, b) => a.created - b.created);
    for (const run of mine) {
      claimed.add(run.id);
      const messages = conversation.messages.filter((m) => owner(m.data.id) === run.id);
      const human = messages.find((m) => m.type === 'human');
      const built = buildSteps(
        messages.filter((m) => m.type !== 'human'),
        run,
        approvalMap,
        artifactIds,
        now,
      );
      const persisted = new Set(messages.map((m) => m.data.id));
      const live = Object.entries(streams)
        .filter(([id, stream]) => stream.run === run.id && !persisted.has(id))
        .map(([, stream]) => stream.text)
        .join('');
      const streaming = !finished.includes(run.status) && live.length > 0;
      const end = endStep(run);
      const answer = streaming ? live : built.answer || (run.status === 'completed' ? (run.answer ?? '') : '');
      tasks.push({
        id: run.id,
        run,
        task: human ? messageText(human) : run.task,
        steps: end ? [...built.steps, end] : built.steps,
        answer,
        streaming,
        changed: built.changed,
        started: run.created * 1000,
        answerArtifactId: artifactIds.has(`${run.id}:answer`) ? `${run.id}:answer` : null,
      });
    }
  }
  // Runs whose conversation is not in the list (should not happen) still get a task.
  for (const run of runs.filter((r) => !claimed.has(r.id) && !conversations.some((c) => c.id === r.conversation_id))) {
    tasks.push({
      id: run.id,
      run,
      task: run.task,
      steps: [],
      answer: run.status === 'completed' ? (run.answer ?? '') : '',
      streaming: false,
      changed: [],
      started: run.created * 1000,
      answerArtifactId: artifactIds.has(`${run.id}:answer`) ? `${run.id}:answer` : null,
    });
  }
  return tasks;
}

const start = (runId: string, status: string) =>
  status === 'queued' || status === 'running' || status === 'waiting'
    ? ({ runId, phase: 'thinking', updated: 0 } satisfies LiveStatus)
    : null;

/**
 * Folds one runtime event into the live map. Only `run.queued` and `run.status` create entries, and
 * a finished status removes them, so replaying history from seq 0 ends with only genuinely active runs.
 */
export function reduceLive(map: LiveMap, e: RuntimeEvent): LiveMap {
  const runId = e.run_id;
  if (!runId) return map;
  const updated = e.created * 1000;
  const existing = map[runId];
  const set = (value: LiveStatus): LiveMap => ({ ...map, [runId]: { ...value, runId, updated } });
  const remove = (): LiveMap => {
    if (!existing) return map;
    const { [runId]: _gone, ...rest } = map;
    return rest;
  };
  switch (e.kind) {
    case 'run.queued':
      return set(existing ?? { runId, phase: 'thinking', updated });
    case 'run.status': {
      const status = String(e.data.status ?? '');
      const begin = start(runId, status);
      if (!begin) return remove();
      return set(existing ?? begin);
    }
    default:
      break;
  }
  if (!existing) return map;
  switch (e.kind) {
    case 'message.delta':
      return set({ runId, phase: 'answering', updated });
    case 'model.completed':
    case 'tool.completed':
    case 'tool.denied':
    case 'approval.decided':
      return set({ runId, phase: 'thinking', updated });
    case 'tool.started':
      return set({
        runId,
        phase: 'tool',
        tool: String(e.data.name ?? ''),
        attemptId: e.data.attempt_id ? String(e.data.attempt_id) : undefined,
        updated,
      });
    case 'approval.requested':
      return set({
        runId,
        phase: 'tool',
        tool: String(e.data.tool ?? ''),
        attemptId: e.data.approval_id ? attemptOf(String(e.data.approval_id)) : undefined,
        updated,
      });
    default:
      return map;
  }
}

/** Finds the model's tool call behind an attempt id (`run:tool:turn:index`). */
export function toolCallForAttempt(
  conversations: Conversation[],
  attemptId: string,
): ToolCall | undefined {
  const hit = /^(.+):tool:(\d+):(\d+)$/.exec(attemptId);
  if (!hit) return undefined;
  const [, run, turn, index] = hit;
  const messageId = `${run}:model:${turn}`;
  for (const conversation of conversations) {
    const message = conversation.messages.find((m) => m.data.id === messageId);
    const call = message?.data.tool_calls?.[Number(index)];
    if (call) return { id: call.id, name: call.name, args: (call.args ?? {}) as Record<string, unknown> };
  }
  return undefined;
}

/** The one-line status shown while a task is active. */
export function liveLine(
  live: LiveStatus | undefined,
  run: Run,
  conversations: Conversation[],
): string {
  if (run.status === 'queued') return 'Waiting its turn...';
  if (run.status !== 'running' && run.status !== 'waiting') return runStatusLabel(run.status);
  const call = live?.attemptId ? toolCallForAttempt(conversations, live.attemptId) : undefined;
  const name = call?.name ?? live?.tool ?? '';
  if (run.status === 'waiting') {
    const path = str(call?.args?.path);
    return path ? `Waiting for you to review ${path}` : 'Waiting for you to review a step';
  }
  if (!live || live.phase === 'thinking') return 'Thinking...';
  if (live.phase === 'answering') return 'Writing the answer...';
  return toolPhrase(name, call?.args, 'live');
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits text so that mentions of known paths can be rendered as chips. */
export function linkPaths(
  text: string,
  known: string[],
): ({ kind: 'text'; text: string } | { kind: 'path'; path: string })[] {
  const paths = [...new Set(known.filter((p) => p && p !== '.'))].sort((a, b) => b.length - a.length);
  if (!paths.length || !text) return text ? [{ kind: 'text', text }] : [];
  const pattern = new RegExp(`(?<![\\w./-])(${paths.map(escape).join('|')})(?![\\w/-]|\\.\\w)`, 'g');
  const out: ({ kind: 'text'; text: string } | { kind: 'path'; path: string })[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > cursor) out.push({ kind: 'text', text: text.slice(cursor, at) });
    out.push({ kind: 'path', path: match[1] });
    cursor = at + match[1].length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

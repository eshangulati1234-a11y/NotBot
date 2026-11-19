import type { Approval, Artifact, Bot, Conversation, Message, Run, Snapshot, Workspace } from '../api';

/** Small builders shared by the pure-module tests. */
export const bot = (over: Partial<Bot> = {}): Bot => ({
  id: 'b1',
  name: 'Mochi',
  purpose: 'Tidy notes',
  enabled: true,
  model: null,
  safety: 'balanced',
  ...over,
});
export const workspace = (over: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  name: 'docs',
  path: '/Users/me/docs',
  ...over,
});
export const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  conversation_id: 'c1',
  workspace_id: 'w1',
  bot_id: 'b1',
  task: 'Do it',
  status: 'completed',
  created: 1000,
  turns: 1,
  model: 'm',
  answer: null,
  error: null,
  ...over,
});
export const human = (id: string, content: string): Message => ({ type: 'human', data: { id, content } });
export const ai = (
  id: string,
  content: string,
  calls?: { id: string; name: string; args: Record<string, unknown> }[],
): Message => ({ type: 'ai', data: { id, content, tool_calls: calls } });
export const tool = (id: string, callId: string, result: unknown): Message => ({
  type: 'tool',
  data: { id, tool_call_id: callId, content: typeof result === 'string' ? result : JSON.stringify(result) },
});
export const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  bot_id: 'b1',
  workspace_id: 'w1',
  messages: [],
  created: 900,
  ...over,
});
export const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'r1:tool:1:0:approval',
  run_id: 'r1',
  status: 'pending',
  expires: 4_000_000_000,
  data: { tool: 'write_file', arguments: { path: 'a.md', content: 'x' }, before_hash: 'h' },
  ...over,
});
export const artifact = (id: string, over: Partial<Artifact> = {}): Artifact => ({
  id,
  name: id,
  run_id: 'r1',
  size: 1,
  created: 1,
  ...over,
});
export const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  bots: [],
  conversations: [],
  workspaces: [],
  runs: [],
  approvals: [],
  artifacts: [],
  model: 'm',
  model_url: 'http://x/v1',
  ...over,
});

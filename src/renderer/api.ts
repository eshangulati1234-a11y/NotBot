export type Safety = 'ask' | 'balanced' | 'handsoff';

export interface Bot {
  id: string;
  name: string;
  purpose: string;
  enabled: boolean;
  model: string | null;
  safety: Safety;
  /** Whether the helper suggests things to remember after a task. Absent means on. */
  learn?: boolean;
  /** Whether the helper may look at and use apps on this Mac. Absent means off. */
  computer?: boolean;
}

export interface MemoryProposal {
  id: string;
  bot_id: string;
  run_id: string;
  target: 'memory' | 'user';
  text: string;
}
export interface BotMemory {
  memory: string;
  user: string;
  caps: { memory: number; user: number };
  proposals: MemoryProposal[];
}
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs_review';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface ModelInfo {
  id: string;
}
export interface Message {
  type: string;
  data: {
    id?: string;
    content: string | { type: string; text?: string }[];
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
  };
}
export interface Conversation {
  id: string;
  bot_id: string;
  workspace_id: string;
  messages: Message[];
  created?: number;
  historical?: boolean;
}
export interface Run {
  id: string;
  conversation_id: string;
  workspace_id: string;
  bot_id: string;
  task: string;
  status: RunStatus;
  created: number;
  turns: number;
  model: string;
  answer?: string | null;
  error?: string | null;
}
export interface Approval {
  id: string;
  run_id: string;
  status: 'pending' | 'approve' | 'reject' | 'consumed';
  expires: number;
  data: {
    tool: string;
    provider?: string;
    endpoint?: string;
    arguments: { path?: string; content?: string; query?: string; [key: string]: unknown };
    diff?: string;
    diff_truncated?: boolean;
    before_hash?: string | null;
    after_hash?: string | null;
    size?: number;
    /** For Mac actions: what the action will touch, read from the screen. */
    target?: { action: string; app?: string; role?: string; label?: string; risk?: string | null; text?: string; key?: string };
  };
}
export interface Workspace {
  id: string;
  name: string;
  path: string;
}
export interface Artifact {
  id: string;
  name: string;
  run_id: string | null;
  size: number;
  created: number;
}
export interface Snapshot {
  bots: Bot[];
  conversations: Conversation[];
  workspaces: Workspace[];
  runs: Run[];
  approvals: Approval[];
  artifacts: Artifact[];
  model: string;
  model_url: string;
}

export const emptySnapshot: Snapshot = {
  bots: [],
  conversations: [],
  workspaces: [],
  runs: [],
  approvals: [],
  artifacts: [],
  model: '',
  model_url: '',
};

export const finished: string[] = ['completed', 'failed', 'cancelled'];

export const OLLAMA_URL = 'http://127.0.0.1:11434/v1';
export const LMSTUDIO_URL = 'http://127.0.0.1:1234/v1';

/** The plain text of a message, whether its content is a string or a list of parts. */
export function messageText(message: Message): string {
  const content = message.data.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  if (!window.notbotRuntime) throw new Error('Open the Notbot desktop app to continue.');
  return (await window.notbotRuntime.request(method, path, body, key)) as T;
}

/** The last path segment, which works for both / and \ separators. */
export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * Turns the raw error text into something a person can act on: strips Electron IPC
 * prefixes and any "... in Settings" instruction clauses (the screens say what to do).
 */
export function friendlyError(reason: unknown): string {
  let text = String(reason instanceof Error ? reason.message : reason)
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^(?:Error:\s*)+/i, '')
    .trim();
  text = text.replace(/\s*[-\u2013\u2014:]\s*retry startup in settings\.?/gi, '');
  const kept = text
    .split(/(?<=[.;])\s+/)
    .filter((part) => !/\bin settings\b/i.test(part));
  text = kept.join(' ').trim().replace(/[;,]$/, '');
  return text || 'Something went wrong.';
}

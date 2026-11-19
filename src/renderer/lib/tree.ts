import { messageText, type Approval, type Conversation, type ToolCall } from '../api';

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  read: boolean;
  proposed: boolean;
  changed: boolean;
  children: TreeNode[];
}

const node = (name: string, path: string, dir: boolean): TreeNode => ({
  name,
  path,
  dir,
  read: false,
  proposed: false,
  changed: false,
  children: [],
});

/** Normalises a path from the model: forward slashes, no leading "./" or "/", "." for the root. */
export function normalizePath(path: string): string {
  const clean = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
  return clean || '.';
}

function parseResult(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Entries of a list_directory result. Long results are replaced by a preview, so read those loosely. */
function entriesOf(result: Record<string, unknown>): { name: string; directory: boolean }[] {
  if (Array.isArray(result.entries)) {
    return (result.entries as { name?: unknown; directory?: unknown }[])
      .filter((entry) => typeof entry?.name === 'string')
      .map((entry) => ({ name: String(entry.name), directory: entry.directory === true }));
  }
  if (typeof result.preview === 'string') {
    const found: { name: string; directory: boolean }[] = [];
    for (const match of result.preview.matchAll(/"name":\s*"((?:[^"\\]|\\.)*)",\s*"directory":\s*(true|false)/g)) {
      found.push({ name: match[1].replace(/\\(.)/g, '$1'), directory: match[2] === 'true' });
    }
    return found;
  }
  return [];
}

const sortNode = (parent: TreeNode) => {
  parent.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  parent.children.forEach(sortNode);
};

/** What the helper has seen so far, rebuilt from its tool calls, their results and its proposals. */
export function deriveTree(conversations: Conversation[], approvals: Approval[]): TreeNode {
  const root = node('.', '.', true);
  const index = new Map<string, TreeNode>([['.', root]]);

  const ensure = (rawPath: string, dir: boolean): TreeNode => {
    const path = normalizePath(rawPath);
    const existing = index.get(path);
    if (existing) {
      if (dir) existing.dir = true;
      return existing;
    }
    const parts = path.split('/');
    const name = parts.pop() ?? path;
    const parent = ensure(parts.length ? parts.join('/') : '.', true);
    const created = node(name, path, dir);
    parent.children.push(created);
    index.set(path, created);
    return created;
  };

  for (const conversation of conversations) {
    const results = new Map<string, string>();
    for (const message of conversation.messages) {
      if (message.type === 'tool' && message.data.tool_call_id) {
        results.set(message.data.tool_call_id, messageText(message));
      }
    }
    for (const message of conversation.messages) {
      if (message.type !== 'ai') continue;
      for (const call of (message.data.tool_calls ?? []) as ToolCall[]) {
        const content = results.get(call.id);
        if (content === undefined) continue;
        const result = parseResult(content);
        if (!result || typeof result.error === 'string') continue;
        const path = typeof call.args?.path === 'string' ? call.args.path : '.';
        if (call.name === 'list_directory') {
          const base = normalizePath(path);
          ensure(base, true);
          for (const entry of entriesOf(result)) {
            ensure(base === '.' ? entry.name : `${base}/${entry.name}`, entry.directory);
          }
        } else if (call.name === 'read_file') {
          ensure(path, false).read = true;
        } else if (call.name === 'search_text' && Array.isArray(result.matches)) {
          for (const match of result.matches as { path?: unknown }[]) {
            if (typeof match?.path === 'string') ensure(match.path, false);
          }
        }
      }
    }
  }

  for (const approval of approvals) {
    if (approval.data.tool !== 'write_file') continue;
    const path = approval.data.arguments?.path;
    if (typeof path !== 'string' || normalizePath(path) === '.') continue;
    if (approval.status === 'consumed') ensure(path, false).changed = true;
    else if (approval.status === 'pending' || approval.status === 'approve') ensure(path, false).proposed = true;
  }

  sortNode(root);
  return root;
}

/** How many files and folders the helper has seen (the root itself is not counted). */
export function seenCount(tree: TreeNode): number {
  return tree.children.reduce((total, child) => total + 1 + seenCount(child), 0);
}

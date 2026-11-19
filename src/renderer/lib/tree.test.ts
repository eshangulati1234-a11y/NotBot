import { describe, expect, it } from 'vitest';
import { ai, approval, conversation, human, tool } from './fixtures';
import { deriveTree, normalizePath, seenCount, type TreeNode } from './tree';

const find = (t: TreeNode, path: string): TreeNode | undefined =>
  t.path === path ? t : t.children.map((c) => find(c, path)).find(Boolean);

describe('deriveTree', () => {
  const conv = conversation({
    messages: [
      human('r1:user', 'x'),
      ai('r1:model:1', '', [
        { id: 'a', name: 'list_directory', args: { path: '.' } },
        { id: 'b', name: 'list_directory', args: { path: 'docs' } },
      ]),
      tool('r1:tool:1:0', 'a', {
        entries: [
          { name: 'README.md', directory: false },
          { name: 'docs', directory: true },
          { name: 'src', directory: true },
        ],
      }),
      tool('r1:tool:1:1', 'b', { entries: [{ name: 'guide.md', directory: false }] }),
      ai('r1:model:2', '', [
        { id: 'c', name: 'read_file', args: { path: './docs/guide.md' } },
        { id: 'd', name: 'search_text', args: { query: 'todo' } },
        { id: 'e', name: 'read_file', args: { path: 'missing.md' } },
      ]),
      tool('r1:tool:2:0', 'c', { path: 'docs/guide.md', text: '', next_offset: null }),
      tool('r1:tool:2:1', 'd', { matches: [{ path: 'src/app.ts', line: 3, text: 'todo' }] }),
      tool('r1:tool:2:2', 'e', { error: 'nope' }),
    ],
  });

  it('joins list_directory args to results and marks reads, directories first', () => {
    const tree = deriveTree([conv], []);
    expect(tree.path).toBe('.');
    expect(tree.children.map((c) => c.name)).toEqual(['docs', 'src', 'README.md']);
    const guide = find(tree, 'docs/guide.md');
    expect(guide).toMatchObject({ dir: false, read: true });
    expect(find(tree, 'src/app.ts')).toMatchObject({ read: false, dir: false });
    expect(find(tree, 'missing.md')).toBeUndefined();
    expect(seenCount(tree)).toBe(5);
  });

  it('marks proposed and changed files from approvals', () => {
    const tree = deriveTree(
      [conv],
      [
        approval({ id: 'p', status: 'pending', data: { tool: 'write_file', arguments: { path: 'new/plan.md' } } }),
        approval({ id: 'q', status: 'consumed', data: { tool: 'write_file', arguments: { path: 'README.md' } } }),
        approval({ id: 'r', status: 'reject', data: { tool: 'write_file', arguments: { path: 'rejected.md' } } }),
        approval({ id: 's', status: 'pending', data: { tool: 'read_file', arguments: { path: 'only-read.md' } } }),
      ],
    );
    expect(find(tree, 'new/plan.md')).toMatchObject({ proposed: true, changed: false });
    expect(find(tree, 'new')).toMatchObject({ dir: true });
    expect(find(tree, 'README.md')).toMatchObject({ changed: true });
    expect(find(tree, 'rejected.md')).toBeUndefined();
    expect(find(tree, 'only-read.md')).toBeUndefined();
  });

  it('is an empty root for no activity, and reads a truncated preview loosely', () => {
    expect(deriveTree([], []).children).toEqual([]);
    const c = conversation({
      messages: [
        ai('r1:model:1', '', [{ id: 'a', name: 'list_directory', args: { path: '.' } }]),
        tool('r1:tool:1:0', 'a', {
          preview: '{"entries": [{"name": "a.txt", "directory": false}, {"name": "sub", "directory": true}, {"nam',
          truncated: true,
        }),
      ],
    });
    expect(deriveTree([c], []).children.map((n) => n.name)).toEqual(['sub', 'a.txt']);
  });

  it('normalises paths', () => {
    expect(normalizePath('./a//b/')).toBe('a/b');
    expect(normalizePath('.')).toBe('.');
    expect(normalizePath('a\\b')).toBe('a/b');
  });
});

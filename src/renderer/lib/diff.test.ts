import { describe, expect, it } from 'vitest';
import { diffLooksWrong, newFileDiff, parseDiff } from './diff';

describe('parseDiff', () => {
  it('parses a new file', () => {
    const d = parseDiff('--- notes.md\n+++ notes.md\n@@ -0,0 +1,2 @@\n+# Notes\n+hello\n');
    expect(d.path).toBe('notes.md');
    expect(d.isNew).toBe(true);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
    expect(d.hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['add', null, 1],
      ['add', null, 2],
    ]);
    expect(diffLooksWrong(d)).toBe(false);
  });

  it('parses a modification with context and line numbers', () => {
    const d = parseDiff(
      '--- a.txt\n+++ a.txt\n@@ -1,4 +1,4 @@\n one\n-two\n+TWO\n three\n four\n',
    );
    expect(d.isNew).toBe(false);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    const lines = d.hunks[0].lines;
    expect(lines).toHaveLength(5);
    expect(lines[1]).toEqual({ kind: 'del', text: 'two', oldNo: 2, newNo: null });
    expect(lines[2]).toEqual({ kind: 'add', text: 'TWO', oldNo: null, newNo: 2 });
    expect(lines[3]).toEqual({ kind: 'ctx', text: 'three', oldNo: 3, newNo: 3 });
  });

  it('keeps blank context lines and several hunks', () => {
    const d = parseDiff('--- a\n+++ a\n@@ -1,3 +1,3 @@\n a\n \n-b\n+c\n@@ -20 +20 @@\n-x\n+y\n');
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0].lines[1]).toMatchObject({ kind: 'ctx', text: '' });
    expect(d.hunks[1].lines[0].oldNo).toBe(20);
  });

  it('splits lines merged because the file had no trailing newline', () => {
    const d = parseDiff('--- a.txt\n+++ a.txt\n@@ -1,2 +1,2 @@\n first\n-old line+new line\n');
    const lines = d.hunks[0].lines;
    expect(lines.map((l) => l.kind)).toEqual(['ctx', 'del', 'add']);
    expect(lines[1].text).toBe('old line');
    expect(lines[2].text).toBe('new line');
    expect(lines[2].newNo).toBe(2);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
  });

  it('marks a truncated diff and tolerates a cut-off last line', () => {
    const d = parseDiff('--- a\n+++ a\n@@ -1,50 +1,50 @@\n-aaa\n+bbb\n+cc', { truncated: true });
    expect(d.truncated).toBe(true);
    expect(d.hunks[0].lines.at(-1)?.text).toBe('cc');
    expect(d.added).toBe(2);
  });

  it('handles an empty diff', () => {
    const d = parseDiff('');
    expect(d.hunks).toEqual([]);
    expect(d.added + d.removed).toBe(0);
  });
});

describe('newFileDiff', () => {
  it('shows all lines as additions', () => {
    const d = newFileDiff('x.md', 'a\nb\n');
    expect(d.isNew).toBe(true);
    expect(d.added).toBe(2);
    expect(d.hunks[0].header).toBe('@@ -0,0 +1,2 @@');
    expect(d.hunks[0].lines[1]).toEqual({ kind: 'add', text: 'b', oldNo: null, newNo: 2 });
  });
  it('keeps a last line without a newline', () => {
    expect(newFileDiff('x', 'a\nb').added).toBe(2);
    expect(newFileDiff('x', '').hunks).toEqual([]);
  });
});

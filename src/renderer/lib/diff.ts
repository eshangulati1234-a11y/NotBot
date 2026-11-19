export interface DiffLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}
export interface ParsedDiff {
  path: string;
  hunks: DiffHunk[];
  added: number;
  removed: number;
  isNew: boolean;
  truncated: boolean;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface RawLine {
  kind: DiffLine['kind'];
  text: string;
}
interface RawHunk {
  header: string;
  oldStart: number;
  newStart: number;
  oldCount: number | null;
  newCount: number | null;
  lines: RawLine[];
}

/**
 * difflib drops the line break after a last line that has none, so "-old" and "+new" can arrive
 * glued together as "-old+new". The hunk header counts tell us when that happened; the split is
 * a best guess (the "+" nearest the middle of the line).
 */
function repairMergedLines(hunk: RawHunk) {
  if (hunk.oldCount === null || hunk.newCount === null) return;
  const count = (kind: DiffLine['kind']) => hunk.lines.filter((line) => line.kind === kind).length;
  const ctx = count('ctx');
  const missing = hunk.newCount - (ctx + count('add'));
  if (missing !== 1 || hunk.oldCount !== ctx + count('del')) return;
  let at = -1;
  for (let i = hunk.lines.length - 1; i >= 0; i--) {
    if (hunk.lines[i].kind === 'del') {
      at = i;
      break;
    }
  }
  if (at < 0) return;
  const text = hunk.lines[at].text;
  const middle = text.length / 2;
  let split = -1;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '+' && (split < 0 || Math.abs(i - middle) < Math.abs(split - middle))) split = i;
  }
  if (split < 0) return;
  hunk.lines.splice(
    at,
    1,
    { kind: 'del', text: text.slice(0, split) },
    { kind: 'add', text: text.slice(split + 1) },
  );
}

export function parseDiff(
  diff: string,
  opts: { isNew?: boolean; truncated?: boolean } = {},
): ParsedDiff {
  const truncated = opts.truncated ?? false;
  let path = '';
  let sawOldEmpty = false;
  const raw: RawHunk[] = [];
  let current: RawHunk | null = null;

  for (const line of diff.replace(/\r\n/g, '\n').split('\n')) {
    const header = HUNK.exec(line);
    if (header) {
      current = {
        header: line,
        oldStart: Number(header[1]),
        newStart: Number(header[3]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      if (Number(header[1]) === 0 && current.oldCount === 0) sawOldEmpty = true;
      raw.push(current);
      continue;
    }
    if (!current) {
      if (line.startsWith('+++ ')) path = line.slice(4).replace(/\t.*$/, '').trim();
      else if (line.startsWith('--- ') && !path) path = line.slice(4).replace(/\t.*$/, '').trim();
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) current.lines.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith(' ')) current.lines.push({ kind: 'ctx', text: line.slice(1) });
    // Empty lines are never real diff lines (blank context is " "), so they are skipped.
  }

  let added = 0;
  let removed = 0;
  const hunks: DiffHunk[] = raw.map((hunk) => {
    if (!truncated) repairMergedLines(hunk);
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    const lines: DiffLine[] = hunk.lines.map((line) => {
      if (line.kind === 'add') {
        added++;
        return { kind: 'add', text: line.text, oldNo: null, newNo: newNo++ };
      }
      if (line.kind === 'del') {
        removed++;
        return { kind: 'del', text: line.text, oldNo: oldNo++, newNo: null };
      }
      return { kind: 'ctx', text: line.text, oldNo: oldNo++, newNo: newNo++ };
    });
    return { header: hunk.header, lines };
  });

  return { path, hunks, added, removed, isNew: opts.isNew ?? sawOldEmpty, truncated };
}

/** A diff that shows a brand-new file as all additions. */
export function newFileDiff(path: string, content: string): ParsedDiff {
  const parts = content.split('\n');
  if (parts.at(-1) === '') parts.pop();
  const lines: DiffLine[] = parts.map((text, index) => ({
    kind: 'add',
    text,
    oldNo: null,
    newNo: index + 1,
  }));
  return {
    path,
    hunks: lines.length ? [{ header: `@@ -0,0 +1,${lines.length} @@`, lines }] : [],
    added: lines.length,
    removed: 0,
    isNew: true,
    truncated: false,
  };
}

/** True when a diff for a new file does not look like pure additions, so the caller should rebuild it. */
export function diffLooksWrong(diff: ParsedDiff): boolean {
  if (!diff.isNew) return false;
  return diff.removed > 0 || diff.added === 0;
}

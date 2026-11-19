import { Fragment, type ReactNode } from 'react';
import { linkPaths } from '../lib/trail';
import { PathChip } from '../ui';

/** A run of text inside a paragraph or list item. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'citation'; id: string };

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; items: Inline[][]; ordered?: boolean; start?: number }
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }
  | { kind: 'code'; text: string; lang: string };

const INLINE =
  /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\[(web-\d+-\d+)\]|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const BULLET = /^\s*(?:[-*+]|(\d{1,9})[.)])\s+(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||(?<!\\)\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** Splits one piece of text into plain, bold and code runs. Nothing here produces HTML. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > cursor) out.push({ kind: 'text', text: text.slice(cursor, at) });
    if (m[1] !== undefined) {
      const url = safeLink(m[2]);
      out.push(url ? { kind: 'link', text: m[1], url } : { kind: 'text', text: m[1] });
    } else if (m[3]) out.push({ kind: 'citation', id: m[3] });
    else if (m[4] !== undefined) out.push({ kind: 'bold', text: m[4] });
    else out.push({ kind: 'code', text: m[5] });
    cursor = at + m[0].length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

/** Parses the Markdown blocks supported in Notbot replies. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { kind: 'list' }> | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ kind: 'paragraph', inline: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ kind: 'code', text: body.join('\n'), lang: fence[1] });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading || RULE.test(line)) {
      flushPara();
      flushList();
      blocks.push(
        heading
          ? { kind: 'heading', level: heading[1].length, inline: parseInline(heading[2]) }
          : { kind: 'rule' },
      );
      continue;
    }
    const next = lines[i + 1];
    if (next && line.includes('|') && next.includes('|')) {
      const header = tableCells(line);
      const divider = tableCells(next);
      if (header.length === divider.length && divider.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        flushPara();
        flushList();
        const rows: Inline[][][] = [];
        i += 1;
        while (lines[i + 1]?.includes('|') && !HEADING.test(lines[i + 1])) {
          const cells = tableCells(lines[++i]);
          rows.push(header.map((_, index) => parseInline(cells[index] ?? '')));
        }
        blocks.push({ kind: 'table', header: header.map(parseInline), rows });
        continue;
      }
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      const ordered = !!bullet[1];
      if (list && !!list.ordered !== ordered) flushList();
      list ??= {
        kind: 'list',
        items: [],
        ...(ordered ? { ordered, start: Number(bullet[1]) } : {}),
      };
      list.items.push(parseInline(bullet[2]));
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

function withPaths(text: string, known: string[]): ReactNode {
  return linkPaths(text, known).map((seg, i) =>
    seg.kind === 'path' ? (
      <PathChip key={i} path={seg.path} state="seen" />
    ) : (
      <Fragment key={i}>{seg.text}</Fragment>
    ),
  );
}

function renderInline(
  inline: Inline[],
  known: string[],
  sources: ReadonlyMap<string, string>,
): ReactNode {
  return inline.map((part, i) => {
    if (part.kind === 'link' || part.kind === 'citation') {
      const label = part.kind === 'link' ? part.text : `[${part.id}]`;
      const url = part.kind === 'link' ? part.url : safeLink(sources.get(part.id) ?? '');
      if (!url) return <span key={i}>{label}</span>;
      return (
        <a
          key={i}
          className={part.kind === 'citation' ? 'nb-md__citation' : undefined}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {label}
        </a>
      );
    }
    if (part.kind === 'bold') return <strong key={i}>{withPaths(part.text, known)}</strong>;
    if (part.kind === 'code') {
      const linked = linkPaths(part.text, known);
      if (linked.length === 1 && linked[0].kind === 'path')
        return <PathChip key={i} path={linked[0].path} state="seen" />;
      return (
        <code key={i} className="nb-md__code">
          {part.text}
        </code>
      );
    }
    return <Fragment key={i}>{withPaths(part.text, known)}</Fragment>;
  });
}

/** Renders answer text as React elements (never raw HTML). */
export function Markdown({
  text,
  known,
  sources = [],
}: {
  text: string;
  known: string[];
  sources?: { id: string; url: string }[];
}) {
  const sourceLinks = new Map(sources.map(({ id, url }) => [id, url]));
  const blocks = parseMarkdown(text);
  return (
    <div className="nb-md">
      {blocks.map((block, i) => {
        if (block.kind === 'code') {
          return (
            <pre className="nb-md__pre" key={i} tabIndex={0}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === 'heading') {
          const Heading = block.level <= 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4';
          return (
            <Heading className="nb-md__heading" key={i}>
              {renderInline(block.inline, known, sourceLinks)}
            </Heading>
          );
        }
        if (block.kind === 'rule') return <hr className="nb-md__rule" key={i} />;
        if (block.kind === 'table') {
          return (
            <div
              className="nb-md__table-scroll"
              role="region"
              aria-label="Reply table"
              tabIndex={0}
              key={i}
            >
              <table className="nb-md__table">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th key={j} scope="col">
                        {renderInline(cell, known, sourceLinks)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k}>{renderInline(cell, known, sourceLinks)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List className="nb-md__list" key={i} start={block.start}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, known, sourceLinks)}</li>
              ))}
            </List>
          );
        }
        return (
          <p className="nb-md__para" key={i}>
            {renderInline(block.inline, known, sourceLinks)}
          </p>
        );
      })}
    </div>
  );
}

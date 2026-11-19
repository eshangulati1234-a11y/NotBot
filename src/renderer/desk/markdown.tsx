import { Fragment, type ReactNode } from 'react';
import { linkPaths } from '../lib/trail';
import { PathChip } from '../ui';

/** A run of text inside a paragraph or list item. */
export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'code'; text: string };

export type Block =
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'code'; text: string; lang: string };

const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;

/** Splits one piece of text into plain, bold and code runs. Nothing here produces HTML. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let cursor = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > cursor) out.push({ kind: 'text', text: text.slice(cursor, at) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else out.push({ kind: 'code', text: m[2] });
    cursor = at + m[0].length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

/** Parses the small markdown subset answers use: paragraphs, bullets, bold, code and fenced code. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ kind: 'paragraph', inline: parseInline(para.join('\n')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', items: list });
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
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      list = list ?? [];
      list.push(parseInline(bullet[1]));
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
    seg.kind === 'path' ? <PathChip key={i} path={seg.path} state="seen" /> : <Fragment key={i}>{seg.text}</Fragment>,
  );
}

function renderInline(inline: Inline[], known: string[]): ReactNode {
  return inline.map((part, i) => {
    if (part.kind === 'bold') return <strong key={i}>{withPaths(part.text, known)}</strong>;
    if (part.kind === 'code') {
      const linked = linkPaths(part.text, known);
      if (linked.length === 1 && linked[0].kind === 'path') return <PathChip key={i} path={linked[0].path} state="seen" />;
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
export function Markdown({ text, known }: { text: string; known: string[] }) {
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
        if (block.kind === 'list') {
          return (
            <ul className="nb-md__list" key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, known)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p className="nb-md__para" key={i}>
            {renderInline(block.inline, known)}
          </p>
        );
      })}
    </div>
  );
}

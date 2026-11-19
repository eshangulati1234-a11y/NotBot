import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('finds bold and code runs', () => {
    expect(parseInline('a **b** and `c`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c' },
    ]);
  });

  it('leaves markup characters alone when unmatched', () => {
    expect(parseInline('2 * 3 and `open')).toEqual([{ kind: 'text', text: '2 * 3 and `open' }]);
  });

  it('keeps html as plain text', () => {
    expect(parseInline('<b>x</b>')).toEqual([{ kind: 'text', text: '<b>x</b>' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: 'paragraph', inline: [{ kind: 'text', text: 'one\ntwo' }] });
  });

  it('groups bullets into one list', () => {
    const blocks = parseMarkdown('- a\n- **b**\n* c');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'list' });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it('reads fenced code verbatim, including blank lines and markup', () => {
    const blocks = parseMarkdown('Before\n```ts\nconst a = **1**;\n\n- not a list\n```\nAfter');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'code', 'paragraph']);
    expect(blocks[1]).toEqual({ kind: 'code', lang: 'ts', text: 'const a = **1**;\n\n- not a list' });
  });

  it('treats an unclosed fence as code to the end', () => {
    expect(parseMarkdown('```\nabc')).toEqual([{ kind: 'code', lang: '', text: 'abc' }]);
  });

  it('returns nothing for empty text', () => {
    expect(parseMarkdown('  \n')).toEqual([]);
  });
});

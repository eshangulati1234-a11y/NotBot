import { describe, expect, it } from 'vitest';
import { helperMark } from './mark';

describe('helperMark', () => {
  it('is deterministic', () => {
    expect(helperMark('Docs Tidier')).toEqual(helperMark('Docs Tidier'));
  });

  it('is a 5x5 grid mirrored left to right', () => {
    const { cells } = helperMark('Notes Reader');
    expect(cells).toHaveLength(25);
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        expect(cells[row * 5 + col]).toBe(cells[row * 5 + (4 - col)]);
      }
    }
  });

  it('picks a tone from 1 to 6 and never draws an empty mark', () => {
    for (const name of ['', 'a', 'Readme Fixer', 'Budget Checker', '日本語']) {
      const mark = helperMark(name);
      expect(mark.tone).toBeGreaterThanOrEqual(1);
      expect(mark.tone).toBeLessThanOrEqual(6);
      expect(mark.cells.some(Boolean)).toBe(true);
    }
  });

  it('differs between names', () => {
    const a = helperMark('Alpha');
    const b = helperMark('Bravo');
    expect(a.cells.join() === b.cells.join() && a.tone === b.tone).toBe(false);
  });
});

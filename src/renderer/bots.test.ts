import { describe, expect, it } from 'vitest';
import { generateBotName } from './bots';

describe('bot names', () => {
  it('generates unique names without case-sensitive collisions', () => {
    const names: string[] = ['MOCHI'];
    for (let i = 0; i < 180; i++) {
      const name = generateBotName(names, () => 0);
      expect(names.map((n) => n.toLowerCase())).not.toContain(name.toLowerCase());
      names.push(name);
    }
    expect(names.some((name) => /\d/.test(name))).toBe(true);
  });
});

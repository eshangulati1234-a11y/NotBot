import { describe, expect, it } from 'vitest';
import { defaultLook, LOOKS, sanitizeLook, TINTS } from './looks';

describe('helper looks', () => {
  it('gives the same name the same look every time, ignoring case and spacing', () => {
    expect(defaultLook('Biscuit')).toEqual(defaultLook('  biscuit '));
  });

  it('spreads different names across several looks and tints', () => {
    const names = ['Mochi', 'Pip', 'Pebble', 'Nori', 'Bubbles', 'Sprout', 'Bean', 'Miso', 'Poppy', 'Biscuit'];
    const looks = new Set(names.map((n) => defaultLook(n).look));
    const tints = new Set(names.map((n) => defaultLook(n).tint));
    expect(looks.size).toBeGreaterThan(3);
    expect(tints.size).toBeGreaterThan(2);
  });

  it('always returns a look and tint that exist', () => {
    for (const name of ['', 'a', 'Little Waffles 12', '日本語']) {
      const { look, tint } = defaultLook(name);
      expect(LOOKS.some((l) => l.id === look)).toBe(true);
      expect(TINTS.some((t) => t.id === tint)).toBe(true);
    }
  });

  it('repairs stored values that are missing or unknown', () => {
    const fallback = defaultLook('Mochi');
    expect(sanitizeLook(undefined, fallback)).toEqual(fallback);
    expect(sanitizeLook({ look: 'nope', tint: 'sky' }, fallback)).toEqual({ look: fallback.look, tint: 'sky' });
    expect(sanitizeLook({ look: 'cowboy', tint: 'mint' }, fallback)).toEqual({ look: 'cowboy', tint: 'mint' });
  });
});

export const LOOKS = [
  { id: 'plain', label: 'Classic' },
  { id: 'cowboy', label: 'Cowboy' },
  { id: 'trooper', label: 'Trooper' },
  { id: 'wizard', label: 'Wizard' },
  { id: 'astronaut', label: 'Astronaut' },
  { id: 'chef', label: 'Chef' },
  { id: 'crown', label: 'Royal' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'beanie', label: 'Beanie' },
  { id: 'bunny', label: 'Bunny' },
] as const;
export type LookId = (typeof LOOKS)[number]['id'];

export const TINTS = [
  { id: 'cream', label: 'Cream', fur: '#EDE0CB', face: '#FAF1E5', shade: '#CDB895' },
  { id: 'peach', label: 'Peach', fur: '#F2D6C2', face: '#FCEBDD', shade: '#D4A98B' },
  { id: 'mint', label: 'Mint', fur: '#D3E7D8', face: '#EEF8F0', shade: '#9FC3AB' },
  { id: 'lavender', label: 'Lavender', fur: '#DCD3EE', face: '#F3EFFA', shade: '#B0A3D2' },
  { id: 'sky', label: 'Sky', fur: '#D0E3F0', face: '#EBF4FA', shade: '#9BBBD2' },
  { id: 'butter', label: 'Butter', fur: '#F2E6B4', face: '#FBF5D9', shade: '#D2C071' },
] as const;
export type TintId = (typeof TINTS)[number]['id'];

export interface Look {
  look: LookId;
  tint: TintId;
}

/** FNV-1a, 32 bit. */
export function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Every helper starts with a look chosen from its name, so the same name always looks the same. */
export function defaultLook(name: string): Look {
  const key = name.trim().toLowerCase();
  return {
    look: LOOKS[fnv(key) % LOOKS.length].id,
    tint: TINTS[fnv(`${key}#tint`) % TINTS.length].id,
  };
}

const isLook = (value: unknown): value is LookId => LOOKS.some((item) => item.id === value);
const isTint = (value: unknown): value is TintId => TINTS.some((item) => item.id === value);

/** Anything stored that is not a known look falls back to the default, so old data never breaks. */
export function sanitizeLook(value: unknown, fallback: Look): Look {
  const v = (value ?? {}) as Partial<Look>;
  return {
    look: isLook(v.look) ? v.look : fallback.look,
    tint: isTint(v.tint) ? v.tint : fallback.tint,
  };
}

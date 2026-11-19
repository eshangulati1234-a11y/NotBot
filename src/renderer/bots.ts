const names = [
  'Mochi',
  'Pip',
  'Pebble',
  'Nori',
  'Bubbles',
  'Sprout',
  'Bean',
  'Miso',
  'Poppy',
  'Biscuit',
  'Toto',
  'Clover',
  'Waffles',
  'Doodle',
  'Fig',
  'Tumble',
];
const adjectives = ['Little', 'Sunny', 'Cozy', 'Curious', 'Happy', 'Tiny', 'Sleepy', 'Bouncy'];

/** Local naming needs no inference call and never reuses an existing name. */
export function generateBotName(existing: string[], random = Math.random): string {
  const used = new Set(existing.map((name) => name.trim().toLocaleLowerCase()));
  const choose = (pool: string[]) =>
    pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  const available = names.filter((name) => !used.has(name.toLowerCase()));
  if (available.length) return choose(available);
  const combinations = adjectives.flatMap((adjective) =>
    names.map((name) => `${adjective} ${name}`),
  );
  const remaining = combinations.filter((name) => !used.has(name.toLowerCase()));
  if (remaining.length) return choose(remaining);
  let suffix = 2;
  while (used.has(`mochi ${suffix}`)) suffix++;
  return `Mochi ${suffix}`;
}

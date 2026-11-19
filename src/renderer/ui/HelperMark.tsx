import { useCallback, useSyncExternalStore } from 'react';
import { View } from '@react-three/drei';
import { Critter } from './Critter';
import { PlushScene } from './3d/Plush';
import { canDraw3d } from './3d/webgl';
import type { CharState } from '../lib/charState';
import { defaultLook, fnv, sanitizeLook, type Look } from './looks';
import './HelperMark.css';

const storageKey = 'notbot-helper-looks';
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: Record<string, unknown> } | null = null;

function readAll(): Record<string, unknown> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    // Storage can be unavailable; looks then fall back to the defaults.
  }
  if (cache && cache.raw === raw) return cache.value;
  let value: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>;
  } catch {
    value = {};
  }
  cache = { raw, value };
  return value;
}

function writeLook(botId: string, look: Look) {
  const next = { ...readAll(), [botId]: look };
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // The choice then lasts for this session only.
  }
  cache = { raw: JSON.stringify(next), value: next };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The helper's look: the one the user picked, or one chosen from its name. */
export function useHelperLook(botId: string, name: string): [Look, (look: Look) => void] {
  const all = useSyncExternalStore(subscribe, readAll, readAll);
  const fallback = defaultLook(name);
  const stored = all[botId];
  const look = stored ? sanitizeLook(stored, fallback) : fallback;
  const set = useCallback((next: Look) => writeLook(botId, next), [botId]);
  return [look, set];
}

const reducedQuery = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(reducedQuery);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

export function HelperMark({
  botId,
  name,
  size = 40,
  look,
  state = 'idle',
}: {
  botId?: string;
  name: string;
  size?: number;
  /** Shows this look instead of the helper's own, for the picker. */
  look?: Look;
  /** What the character is doing; it acts this out. */
  state?: CharState;
}) {
  const [own] = useHelperLook(botId ?? name, name);
  const reduced = useReducedMotion();
  const shown = look ?? own;
  if (!canDraw3d()) {
    return (
      <span className="nb-helper-mark" aria-hidden="true" style={{ width: size, height: size }}>
        <Critter look={shown} name={name} size={size} />
      </span>
    );
  }
  return (
    <View className="nb-helper-mark" aria-hidden="true" style={{ width: size, height: size }}>
      <PlushScene look={shown} state={state} size={size} seed={(fnv(name) % 1000) / 1000} still={reduced} />
    </View>
  );
}

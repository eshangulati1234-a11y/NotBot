import { useEffect, useRef } from 'react';

const platform = (): string => {
  if (typeof navigator === 'undefined') return '';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
};

export const isMac: boolean = /mac|iphone|ipad/i.test(platform());
/** How copy refers to the device everything runs on. */
export const deviceName: 'this Mac' | 'this computer' = isMac ? 'this Mac' : 'this computer';
export const modKey: '⌘' | 'Ctrl' = isMac ? '⌘' : 'Ctrl';

/** True when the platform's main shortcut key (Command on a Mac, Control elsewhere) is held. */
export const isMod = (e: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  isMac ? e.metaKey : e.ctrlKey;

/** True for fields where typing (and Backspace) belongs to the field. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null;
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable === true) return true;
  const attribute = el.getAttribute?.('contenteditable');
  return attribute === '' || attribute === 'true' || attribute === 'plaintext-only';
}

/** Runs `handler` for keydown events that satisfy `match`, while `enabled`. */
export function useShortcut(
  match: (e: KeyboardEvent) => boolean,
  handler: (e: KeyboardEvent) => void,
  enabled = true,
): void {
  const latest = useRef({ match, handler });
  latest.current = { match, handler };
  useEffect(() => {
    if (!enabled) return;
    const listen = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (latest.current.match(e)) latest.current.handler(e);
    };
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, [enabled]);
}

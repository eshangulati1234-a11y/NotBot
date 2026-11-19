import { useLayoutEffect, useRef } from 'react';

/**
 * Makes a textarea grow with its content instead of scrolling. It stops growing at `maxShare`
 * of the window height and scrolls from there.
 */
export function useAutoGrow(value: string, maxShare = 0.4) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = window.innerHeight * maxShare;
    // scrollHeight leaves out the border, which border-box sizing counts in the height.
    const border = el.offsetHeight - el.clientHeight;
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? 'auto' : 'hidden';
  }, [value, maxShare]);
  return ref;
}

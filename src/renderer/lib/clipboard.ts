interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** Copy text to the clipboard. Falls back to a hidden textarea where the async API is unavailable. */
export async function copyText(
  text: string,
  clipboard: ClipboardLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea route.
    }
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

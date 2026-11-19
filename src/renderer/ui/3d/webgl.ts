let cached: boolean | null = null;

/** True when this window can draw 3D. Checked once; the flat character is used when it cannot. */
export function canDraw3d(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement('canvas');
    cached = Boolean(canvas.getContext('webgl2'));
  } catch {
    cached = false;
  }
  return cached;
}

import { BrowserWindow, screen } from 'electron';
import type { ManagedHarness } from './harness';
import type { RuntimeEvent } from '../shared/runtime';

/** Ends any desktop step and cancels the running task. Safe to call when nothing is running. */
export function stopDesktop(harness: ManagedHarness): void {
  try {
    const { baseUrl, token } = harness.connection();
    void fetch(`${baseUrl}/api/v1/desktop/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    }).catch(() => {});
  } catch {
    /* The harness is not running, so there is nothing to stop. */
  }
}

const page = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font:13px -apple-system,system-ui,sans-serif;-webkit-user-select:none}
.bar{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:12px;padding:0 8px 0 16px;border-radius:999px;background:#0b1220;color:#fff;border:1px solid #2f5fe0;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.dot{width:8px;height:8px;border-radius:50%;background:#4f86ff}
.txt{flex:1;white-space:nowrap}.hint{opacity:.6;margin-left:6px}
a{color:#fff;background:#d92d20;text-decoration:none;padding:6px 14px;border-radius:999px;font-weight:600}
</style><div class="bar"><span class="dot"></span><span class="txt">Notbot is using your Mac<span class="hint">⌃⌥Esc</span></span><a href="notbot://stop">Stop</a></div>`;

/** A small always-on-top bar, visible whatever app is in front, while a helper uses the Mac. */
export function createDesktopOverlay(harness: ManagedHarness) {
  let win: BrowserWindow | null = null;
  const ensure = () => {
    if (win && !win.isDestroyed()) return win;
    const { workArea } = screen.getPrimaryDisplay();
    const width = 300;
    win = new BrowserWindow({
      width,
      height: 40,
      x: Math.round(workArea.x + workArea.width / 2 - width / 2),
      y: workArea.y + 8,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (url === 'notbot://stop') stopDesktop(harness);
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    return win;
  };
  return {
    /** Follow the event stream: show on the first desktop step, hide when the run stops running. */
    observe(event: RuntimeEvent) {
      const name = String(event.data.name ?? '');
      if (event.kind === 'tool.started' && name.startsWith('computer_')) ensure().showInactive();
      else if (event.kind === 'run.status' && event.data.status !== 'running') win?.hide();
    },
    destroy() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}

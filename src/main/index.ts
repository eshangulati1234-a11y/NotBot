import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { registerRuntime } from './runtime';
import { ManagedHarness } from './harness';
const harness = new ManagedHarness();
let quitting = false;
let stopRuntimeEvents: () => void = () => {};
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stopRuntimeEvents();
  void harness.stop().finally(() => app.quit());
});
if (!app.requestSingleInstanceLock()) app.quit();
app.whenReady().then(() => {
  const backgroundFor = () => (nativeTheme.shouldUseDarkColors ? '#000000' : '#F4EFE6');
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1240,
    minHeight: 760,
    title: 'Notbot',
    backgroundColor: backgroundFor(),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  const syncBackground = () => {
    if (!win.isDestroyed()) win.setBackgroundColor(backgroundFor());
  };
  nativeTheme.on('updated', syncBackground);
  win.on('closed', () => nativeTheme.off('updated', syncBackground));
  stopRuntimeEvents = registerRuntime(win, harness);
  void harness.start().catch(() => {
    /* Renderer shows startup recovery. */
  });
  // Keep untrusted documents away from the privileged preload bridge.
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
});
app.on('window-all-closed', () => app.quit());

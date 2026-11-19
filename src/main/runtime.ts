import { BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { ManagedHarness } from './harness';
import type { RuntimeConnection, RuntimeEvent } from '../shared/runtime';

const routes: [string, RegExp][] = [
  [
    'GET',
    /^\/(health|capabilities|snapshot|models|workspaces|bots|conversations|runs|approvals|artifacts|memory|events)(\?after=\d+)?$/,
  ],
  ['GET', /^\/(runs|artifacts)\/[\w:.-]+$/],
  ['GET', /^\/conversations\/[\w:.-]+\/messages$/],
  ['POST', /^\/(workspaces|bots|conversations|runs|import|models\/discover)$/],
  ['POST', /^\/runs\/[\w:.-]+\/(pause|resume|cancel)$/],
  ['POST', /^\/approvals\/[\w:.-]+$/],
  ['PUT', /^\/(models\/config|bots\/[\w:.-]+)$/],
];
export function registerRuntime(window: BrowserWindow, harness: ManagedHarness) {
  let events: AbortController | null = null;
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Untrusted IPC sender');
  };
  async function fetchResponse(method: string, path: string, body?: unknown, key?: string) {
    const connection = harness.connection();
    if (!routes.some(([allowed, expression]) => allowed === method && expression.test(path)))
      throw new Error('Unsupported runtime operation');
    const text = body === undefined ? undefined : JSON.stringify(body);
    if (text && Buffer.byteLength(text) > 2_097_152) throw new Error('Request exceeds 2 MiB');
    const response = await fetch(`${connection.baseUrl}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key ?? crypto.randomUUID(),
      },
      body: text,
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > 8_388_608) {
            await reader.cancel();
            throw new Error('Response exceeds supported size');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const result = Buffer.concat(chunks).toString('utf8');
    if (!response.ok) {
      let detail = `Runtime request failed (${response.status})`;
      try {
        detail = JSON.parse(result).detail ?? detail;
      } catch {
        /* Keep the status-only error. */
      }
      throw new Error(typeof detail === 'string' ? detail : 'Invalid request');
    }
    return response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(result)
      : result;
  }
  ipcMain.handle('runtime:connection', async (event) => {
    trusted(event);
    await harness.start();
    return { configured: true, managed: true } satisfies RuntimeConnection;
  });
  ipcMain.handle(
    'runtime:request',
    async (event, method: string, path: string, body: unknown, key?: string) => {
      trusted(event);
      return fetchResponse(method, path, body, key);
    },
  );
  ipcMain.handle('runtime:workspace', async (event) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose Workspace',
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('runtime:save-artifact', async (event, id: string) => {
    trusted(event);
    if (!/^[\w:.-]+$/.test(id)) throw new Error('Invalid artifact identifier');
    const content = await fetchResponse('GET', '/artifacts/' + id);
    const result = await dialog.showSaveDialog(window, { defaultPath: 'notbot-artifact.txt' });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, String(content), 'utf8');
    return true;
  });
  ipcMain.handle('runtime:events:stop', (event) => {
    trusted(event);
    events?.abort();
    events = null;
  });
  ipcMain.handle('runtime:events:start', async (event, after: number) => {
    trusted(event);
    events?.abort();
    const controller = new AbortController();
    events = controller;
    let cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    void (async () => {
      while (!controller.signal.aborted && !window.isDestroyed()) {
        try {
          const connection = harness.connection();
          const response = await fetch(
            `${connection.baseUrl}/api/v1/events/stream?after=${cursor}`,
            {
              headers: { Authorization: `Bearer ${connection.token}` },
              signal: controller.signal,
              redirect: 'error',
            },
          );
          if (!response.ok || !response.body) throw new Error('Event stream unavailable');
          const decoder = new TextDecoder();
          let buffer = '';
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            buffer += decoder.decode(chunk, { stream: true });
            if (buffer.length > 131072) throw new Error('Oversized event frame');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const line = frame.split('\n').find((item) => item.startsWith('data: '));
              if (!line) continue;
              const record = JSON.parse(line.slice(6)) as RuntimeEvent;
              if (!Number.isSafeInteger(record.seq) || record.seq <= cursor) continue;
              cursor = record.seq;
              if (!window.isDestroyed()) window.webContents.send('runtime:event', record);
            }
          }
        } catch {
          if (!controller.signal.aborted && !window.isDestroyed())
            window.webContents.send(
              'runtime:event-error',
              'Connection interrupted. Reconnecting to the harness…',
            );
        }
        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
  });
  window.on('closed', () => events?.abort());
  return () => events?.abort();
}

import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface PrivateConnection {
  baseUrl: string;
  token: string;
}

/** One child per Electron instance; credentials never cross the preload boundary. */
export class ManagedHarness {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Promise<PrivateConnection> | null = null;
  private value: PrivateConnection | null = null;
  private closing = false;

  start(): Promise<PrivateConnection> {
    if (this.value) return Promise.resolve(this.value);
    if (this.pending) return this.pending;
    this.closing = false;
    this.pending = this.launch().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  connection(): PrivateConnection {
    if (!this.value) throw new Error('Notbot is not running. Retry startup in Settings.');
    return this.value;
  }

  private async launch(): Promise<PrivateConnection> {
    const packaged = app.isPackaged;
    const command = packaged
      ? join(
          process.resourcesPath,
          'harness',
          process.platform === 'win32' ? 'notbot-harness.exe' : 'notbot-harness',
        )
      : 'uv';
    const args = packaged
      ? []
      : [
          'run',
          '--locked',
          '--directory',
          join(app.getAppPath(), 'harness'),
          'python',
          '-m',
          'notbot_harness.desktop',
        ];
    const child = spawn(command, args, {
      cwd: packaged ? process.resourcesPath : app.getAppPath(),
      env: {
        ...process.env,
        NOTBOT_DATA_DIR: app.getPath('userData'),
        PYTHONUNBUFFERED: '1',
        ...(process.platform === 'darwin'
          ? {
              NOTBOT_DESKHAND_PATH: packaged
                ? join(process.resourcesPath, 'deskhand', 'deskhand')
                : join(app.getAppPath(), 'dist', 'deskhand', 'deskhand'),
            }
          : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    // Drain diagnostics to avoid backpressure; raw provider payloads stay private.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => {});
    child.once('exit', () => {
      if (this.child === child) {
        this.value = null;
        this.child = null;
      }
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let buffer = '';
        const finish = (error?: Error, port?: number) => {
          clearTimeout(timer);
          child.stdout.off('data', receive);
          child.off('error', failed);
          child.off('exit', failed);
          if (error) reject(error);
          else resolve(port!);
        };
        const timer = setTimeout(
          () => finish(new Error('Notbot startup timed out. Retry startup.')),
          60000,
        );
        const failed = () =>
          finish(
            new Error(
              packaged
                ? 'The bundled Notbot runtime could not start. Retry startup or reinstall Notbot.'
                : 'Notbot could not start. Install uv and run uv sync --directory harness, then retry.',
            ),
          );
        const receive = (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.length > 65536) {
            failed();
            return;
          }
          for (;;) {
            const boundary = buffer.indexOf('\n');
            if (boundary < 0) break;
            const line = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 1);
            try {
              const record = JSON.parse(line);
              if (
                record.type === 'notbot.ready' &&
                Number.isInteger(record.port) &&
                record.port > 0 &&
                record.port < 65536
              ) {
                finish(undefined, record.port);
                child.stdout.resume();
                return;
              }
            } catch {
              /* Ignore non-protocol startup output. */
            }
          }
        };
        child.stdout.on('data', receive);
        child.once('error', failed);
        child.once('exit', failed);
      });
      const token = (await readFile(join(app.getPath('userData'), 'access.token'), 'utf8')).trim();
      if (token.length < 32) throw new Error('Notbot runtime credential is invalid.');
      const connection = { baseUrl: `http://127.0.0.1:${port}`, token };
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && child.exitCode === null && !this.closing) {
        try {
          const response = await fetch(connection.baseUrl + '/api/v1/health', {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(1500),
          });
          if (response.ok) {
            this.value = connection;
            return connection;
          }
        } catch {
          /* Uvicorn is still completing database startup. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Notbot could not finish starting. Retry startup in Settings.');
    } catch (error) {
      child.stdin.end();
      child.kill();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.value = null;
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 7000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}

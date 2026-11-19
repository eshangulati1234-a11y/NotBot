import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function modelServerAnswers(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:11434/v1/models', {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

test('packaged Notbot runs its bundled harness without Python or uv on PATH', async () => {
  test.skip(
    process.platform !== 'darwin',
    'This packaged launch check targets the local macOS artifact.',
  );
  test.skip(!(await modelServerAnswers()), 'No local model server answers on 127.0.0.1:11434.');
  test.setTimeout(150000);
  const root = await mkdtemp(join(tmpdir(), 'notbot-embedded-'));
  const workspace = join(root, 'project');
  const emptyPath = join(root, 'empty-bin');
  await mkdir(workspace);
  await mkdir(emptyPath);
  await writeFile(join(workspace, 'ACORN-926.md'), 'Embedded runtime verification.');
  const app = await electron.launch({
    executablePath: resolve('dist/mac-arm64/notbot.app/Contents/MacOS/notbot'),
    args: [`--user-data-dir=${join(root, 'profile')}`],
    env: { ...process.env, PATH: emptyPath, NOTBOT_MODEL: 'llama3.2:3b' },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('status').filter({ hasText: 'Notbot is ready' })).toBeVisible({
      timeout: 60000,
    });
    await page.screenshot({ path: 'verification/redesign/embedded-first-run.png' });

    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) as never;
    }, workspace);
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose another folder' })).toBeVisible();
    const purpose = 'Inspect workspace files with tools.';
    await page.getByRole('textbox', { name: 'What should this helper do?' }).fill(purpose);
    await page.getByRole('button', { name: 'Create helper', exact: true }).click();
    const taskBox = page.getByRole('textbox', { name: 'Task', exact: true });
    await expect(taskBox).toBeVisible({ timeout: 30000 });

    const runs = () =>
      page.evaluate(() => window.notbotRuntime!.request('GET', '/runs')) as Promise<
        { id: string; task: string; status: string; error?: string | null }[]
      >;
    const waitFor = async (task: string) => {
      let id = '';
      await expect
        .poll(
          async () => {
            const run = (await runs()).find((item) => item.task === task);
            if (run?.status === 'failed') throw new Error(run.error ?? 'run failed');
            id = run?.id ?? '';
            return run?.status;
          },
          { timeout: 60000 },
        )
        .toBe('completed');
      return id;
    };
    await waitFor(purpose);
    await expect(taskBox).toBeEnabled({ timeout: 15000 });

    const task =
      'Use list_directory with path a single dot (the current directory) and report the exact file names returned by the tool.';
    await taskBox.fill(task);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const runId = await waitFor(task);
    const done = (await page.evaluate(
      (id) => window.notbotRuntime!.request('GET', '/runs/' + id),
      runId,
    )) as { answer?: string | null };
    expect(done.answer ?? '').toContain('ACORN-926');
    await page.screenshot({ path: 'verification/redesign/embedded-desk.png' });

    const events = (await page.evaluate(() => window.notbotRuntime!.request('GET', '/events'))) as {
      run_id: string;
      kind: string;
      data: { name?: string };
    }[];
    expect(
      events.some(
        (event) =>
          event.run_id === runId &&
          event.kind === 'tool.completed' &&
          event.data.name === 'list_directory',
      ),
    ).toBe(true);

    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Notbot is ready' })).toBeVisible({
      timeout: 30000,
    });
    // After a reload nothing is running, so a "Working" label would be a ghost live state.
    await expect(page.getByText('Working', { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

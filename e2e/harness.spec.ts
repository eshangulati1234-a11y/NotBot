import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface RunInfo {
  task: string;
  status: string;
  error?: string | null;
  answer?: string | null;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

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

const listRuns = (page: Page) =>
  page.evaluate(() => window.notbotRuntime!.request('GET', '/runs')) as Promise<RunInfo[]>;

/** Polls /runs until the run for `task` completes; a failed run throws its error. */
async function expectRunCompleted(page: Page, task: string): Promise<RunInfo> {
  let found: RunInfo | undefined;
  await expect
    .poll(
      async () => {
        found = (await listRuns(page)).find((item) => item.task === task);
        if (found?.status === 'failed') throw new Error(found.error ?? 'run failed');
        return found?.status;
      },
      { timeout: 60000 },
    )
    .toBe('completed');
  return found as RunInfo;
}

async function sendTask(page: Page, task: string) {
  await page.getByRole('textbox', { name: 'Task', exact: true }).fill(task);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('built-in harness starts automatically and runs real read and approval tasks', async () => {
  test.skip(!(await modelServerAnswers()), 'No local model server answers on 127.0.0.1:11434.');
  test.setTimeout(240000);
  const root = await mkdtemp(join(tmpdir(), 'notbot-connected-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  await writeFile(
    join(workspace, 'README.md'),
    'This is a miniature Electron application. Verification code: CEDAR-842.',
  );
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${join(root, 'electron')}`],
      env: { ...process.env, NOTBOT_MODEL: 'llama3.2:3b' },
    });
    const page = await app.firstWindow();
    await expect(page.getByRole('status').filter({ hasText: 'Notbot is ready' })).toBeVisible({
      timeout: 60000,
    });
    expect(await page.evaluate(() => window.notbotRuntime!.connection())).toEqual({
      configured: true,
      managed: true,
    });
    await page.screenshot({ path: 'verification/redesign/e2e-first-run.png' });

    // First run: choose a folder (picker stubbed), describe the job, create the helper.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) as never;
    }, workspace);
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Choose another folder' })).toBeVisible();
    const purpose = 'Inspect project files using tools.';
    await page.getByRole('button', { name: 'Create helper', exact: true }).click();

    // Creating a helper opens its chat with nothing running yet; send the first task.
    const taskBox = page.getByRole('textbox', { name: 'Task', exact: true });
    await expect(taskBox).toBeVisible({ timeout: 30000 });
    await taskBox.fill(purpose);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expectRunCompleted(page, purpose);
    await expect(page.getByRole('textbox', { name: 'Task', exact: true })).toBeEnabled({
      timeout: 15000,
    });

    const readTask =
      'Use read_file on README.md, then explain the app and quote its verification code.';
    await sendTask(page, readTask);
    const read = await expectRunCompleted(page, readTask);
    expect(read.answer ?? '').toContain('CEDAR-842');
    await page.screenshot({ path: 'verification/redesign/e2e-desk.png' });

    // 'shortcut' approves with the keyboard (Cmd/Ctrl+Enter) instead of the Apply button.
    for (const decision of ['approve', 'reject', 'shortcut'] as const) {
      const filename = `${decision}-note.md`;
      const task = `Use write_file to create ${filename} with exactly the content "Reviewed note". Request that tool now. Do not just describe writing it. After the tool result, stop and report whether it was approved or rejected.`;
      await expect(page.getByRole('textbox', { name: 'Task', exact: true })).toBeEnabled({
        timeout: 15000,
      });
      await sendTask(page, task);
      const review = page.getByRole('region', { name: 'Review', exact: true });
      const apply = review.getByRole('button', { name: /^Apply change/ });
      await expect(apply).toBeVisible({ timeout: 60000 });
      expect(await exists(join(workspace, filename))).toBe(false);
      await page.screenshot({ path: `verification/redesign/e2e-review-${decision}.png` });
      if (decision === 'approve') await apply.click();
      else if (decision === 'shortcut') {
        // The shortcut ignores typing in a field, so leave the composer first.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`);
      } else await review.getByRole('button', { name: /^Reject change/ }).click();
      await expectRunCompleted(page, task);
      if (decision !== 'reject')
        expect(await readFile(join(workspace, filename), 'utf8')).toBe('Reviewed note');
      else expect(await exists(join(workspace, filename))).toBe(false);
    }
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

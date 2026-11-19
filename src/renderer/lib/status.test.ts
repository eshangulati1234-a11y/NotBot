import { describe, expect, it } from 'vitest';
import type { RunStatus } from '../api';
import {
  PERMISSIONS,
  dotState,
  explainError,
  helperStateLabel,
  permissionSummary,
  runStatusLabel,
  toolPhrase,
} from './status';

describe('runStatusLabel', () => {
  it('covers all eight run statuses in plain words', () => {
    const expected: Record<RunStatus, string> = {
      queued: 'Waiting its turn',
      running: 'Working',
      waiting: 'Waiting for you',
      paused: 'Paused',
      completed: 'Done',
      failed: "Didn't finish",
      cancelled: 'Stopped',
      needs_review: 'Needs a fresh start',
    };
    for (const [status, label] of Object.entries(expected)) {
      expect(runStatusLabel(status as RunStatus)).toBe(label);
    }
  });
});

describe('dots and labels', () => {
  it('maps helper and run states to dot states', () => {
    expect(dotState('working')).toBe('working');
    expect(dotState('running')).toBe('working');
    expect(dotState('waiting')).toBe('waiting');
    expect(dotState('completed')).toBe('done');
    expect(dotState('failed')).toBe('failed');
    expect(dotState('needs_review')).toBe('failed');
    expect(dotState('off')).toBe('idle');
    expect(dotState('paused')).toBe('paused');
  });
  it('labels helper states', () => {
    expect(helperStateLabel('waiting')).toBe('Waiting for you');
    expect(helperStateLabel('idle')).toBe('Ready');
  });
});

describe('toolPhrase', () => {
  it('speaks in three tenses', () => {
    expect(toolPhrase('read_file', { path: 'README.md' }, 'live')).toBe('Reading README.md...');
    expect(toolPhrase('read_file', { path: 'README.md' }, 'past')).toBe('Read README.md');
    expect(toolPhrase('read_file', { path: 'README.md' }, 'request')).toBe('Wants to read README.md');
  });
  it('describes the folder root, searches, changes and notes', () => {
    expect(toolPhrase('list_directory', { path: '.' }, 'past')).toBe('Looked around the folder');
    expect(toolPhrase('list_directory', { path: 'docs' }, 'past')).toBe('Looked in docs');
    expect(toolPhrase('search_text', { query: 'todo' }, 'past')).toBe('Searched workspace for "todo"');
    expect(toolPhrase('write_file', { path: 'a.md' }, 'request')).toBe('Wants to change a.md');
    expect(toolPhrase('write_file', { path: 'a.md' }, 'past')).toBe('Changed a.md');
    expect(toolPhrase('search_memory', {}, 'past')).toBe('Checked its notes');
    expect(toolPhrase('search_history', {}, 'past')).toBe('Looked back at earlier tasks');
    expect(toolPhrase('write_memory', {}, 'request')).toBe('Wants to save a note');
    expect(toolPhrase('fetch_page', { url: 'https://www.docs.example.com/a' }, 'past')).toBe('Read a page from docs.example.com');
    expect(toolPhrase('computer_look', {}, 'past')).toBe('Looked at the screen');
    expect(toolPhrase('computer_act', { action: 'type' }, 'request')).toBe('Wants to type');
    expect(toolPhrase('computer_act', {}, 'live')).toBe('Using the Mac…');
    expect(toolPhrase('mystery', {}, 'past')).toBe('Used a tool');
  });
});

describe('explainError', () => {
  const title = (m: string) => explainError(m).title;
  it('recognises harness messages', () => {
    expect(title('Model server unavailable. Start Ollama or LM Studio')).toMatch(/model/i);
    expect(title('Model turn budget reached')).toMatch(/steps/);
    expect(title('Active execution time budget reached')).toMatch(/longer/);
    expect(title('Approval expired. Cancel this run and submit a fresh task.')).toMatch(/timed out/);
    expect(title('File changed after the proposal; request a fresh edit')).toMatch(/file changed/i);
    expect(title('Task queue is full')).toMatch(/waiting/);
    expect(title('This conversation already has an active run')).toMatch(/already working/);
    expect(title('Bot is disabled')).toMatch(/turned off/);
    expect(title('Something odd')).toBe('Something went wrong');
  });
  it('never uses forbidden words', () => {
    for (const m of ['x', 'Bot is disabled', 'Model server unavailable']) {
      const e = explainError(m);
      expect(`${e.title} ${e.next}`).not.toMatch(/undo|delete|automation|shell/i);
    }
  });
});

describe('permissions', () => {
  it('offers two choices and shows handsoff as balanced', () => {
    expect(PERMISSIONS.map((p) => p.value)).toEqual(['ask', 'balanced']);
    expect(permissionSummary('handsoff')).toBe(permissionSummary('balanced'));
    expect(permissionSummary('balanced')).toBe('reads freely · asks before changing');
    expect(permissionSummary('ask')).toBe('asks before every step');
  });
});

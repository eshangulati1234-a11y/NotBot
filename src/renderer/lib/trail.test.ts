import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../shared/runtime';
import { ai, approval, artifact, conversation, human, run, tool } from './fixtures';
import {
  deriveTasks,
  failureReason,
  linkPaths,
  liveLine,
  reduceLive,
  toolCallForAttempt,
  type LiveMap,
  type TrailStep,
} from './trail';

const ev = (seq: number, run_id: string | null, kind: string, data: Record<string, unknown> = {}): RuntimeEvent => ({
  seq,
  run_id,
  kind,
  data,
  created: 100 + seq,
});

const messages = [
  human('r1:user', 'Fix the intro'),
  ai('r1:model:1', 'Let me look.', [
    { id: 'call_a', name: 'list_directory', args: { path: '.' } },
    { id: 'call_b', name: 'read_file', args: { path: 'README.md' } },
  ]),
  tool('r1:tool:1:0', 'call_a', { entries: [{ name: 'README.md', directory: false }] }),
  tool('r1:tool:1:1', 'call_b', { path: 'README.md', text: 'hi', next_offset: null }),
  ai('r1:model:2', '', [{ id: 'call_c', name: 'write_file', args: { path: 'README.md', content: 'new' } }]),
  tool('r1:tool:2:0', 'call_c', { path: 'README.md', written: true, artifact_id: 'r1:tool:2:0:result' }),
  ai('r1:model:3', 'All done.'),
];

describe('deriveTasks', () => {
  const conv = conversation({ messages });

  it('groups steps by message-id prefix and treats consumed as applied', () => {
    const [task] = deriveTasks(
      [conv],
      [run({ status: 'completed', answer: 'All done.' })],
      [approval({ id: 'r1:tool:2:0:approval', status: 'consumed', data: { tool: 'write_file', arguments: { path: 'README.md' }, before_hash: 'h' } })],
      [artifact('r1:tool:2:0:backup'), artifact('r1:answer')],
      {},
    );
    expect(task.task).toBe('Fix the intro');
    expect(task.answer).toBe('All done.');
    expect(task.answerArtifactId).toBe('r1:answer');
    expect(task.changed).toEqual(['README.md']);
    const kinds = task.steps.map((s) => s.kind);
    expect(kinds).toEqual(['note', 'tool', 'tool', 'review', 'end']);
    const labels = task.steps.filter((s): s is Extract<TrailStep, { kind: 'tool' }> => s.kind === 'tool');
    expect(labels.map((s) => s.label)).toEqual(['Looked around the folder', 'Read README.md']);
    expect(labels[1].paths).toEqual(['README.md']);
    const review = task.steps[3];
    expect(review).toMatchObject({
      kind: 'review',
      state: 'applied',
      path: 'README.md',
      backupArtifactId: 'r1:tool:2:0:backup',
    });
    expect(task.steps.at(-1)).toMatchObject({ kind: 'end', tone: 'done' });
  });

  it('keeps web sources tied to actual tool results and separates search scopes', () => {
    const result = tool('r1:tool:1:1', 'web', {
      checked_at: '2026-11-19T00:00:00Z',
      results: [
        { source_id: 'web-1-1', title: 'Junior developer', url: 'https://example.com/job' },
        { source_id: 'web-1-2', title: 'Bad URL', url: 'javascript:alert(1)' },
      ],
    });
    result.data.name = 'web_search';
    const [task] = deriveTasks(
      [conversation({ messages: [
        human('r1:user', 'Find Melbourne job listings'),
        ai('r1:model:1', '', [
          { id: 'local', name: 'search_text', args: { query: 'jobs' } },
          { id: 'web', name: 'web_search', args: { query: 'Melbourne' } },
          { id: 'failed', name: 'web_search', args: { query: 'AI developer' } },
        ]),
        tool('r1:tool:1:0', 'local', { matches: [] }),
        result,
        tool('r1:tool:1:2', 'failed', { error: 'Brave Search timed out.' }),
        ai('r1:model:2', 'A lead [web-1-1]. https://invented.example'),
      ] })],
      [run({status: 'completed'})], [], [], {},
    );
    expect(task.sources).toEqual([
      { id: 'web-1-1', title: 'Junior developer', url: 'https://example.com/job', checkedAt: '2026-11-19T00:00:00Z' },
    ]);
    expect(task.steps[0]).toMatchObject({ label: 'Searched workspace for "jobs"', state: 'done' });
    expect(task.steps[1]).toMatchObject({ label: 'Searched the web for "Melbourne"', state: 'done' });
    expect(task.steps[2]).toMatchObject({ label: 'Couldn’t search the web: Brave Search timed out', state: 'error' });
  });

  it('has no backup id for a new file or a missing artifact', () => {
    const base = { id: 'r1:tool:2:0:approval', status: 'consumed' as const };
    const fresh = approval({ ...base, data: { tool: 'write_file', arguments: { path: 'README.md' }, before_hash: null } });
    const [a] = deriveTasks([conv], [run()], [fresh], [artifact('r1:tool:2:0:backup')], {});
    expect(a.steps.find((s) => s.kind === 'review')).toMatchObject({ backupArtifactId: null });
    const [b] = deriveTasks([conv], [run()], [approval(base)], [], {});
    expect(b.steps.find((s) => s.kind === 'review')).toMatchObject({ backupArtifactId: null });
  });

  it('shows a rejection and a denied follow-up', () => {
    const rejected = conversation({
      messages: [
        human('r1:user', 'Change it'),
        ai('r1:model:1', '', [{ id: 'x', name: 'write_file', args: { path: 'a.md' } }]),
        tool('r1:tool:1:0', 'x', { error: 'Human rejected this action.' }),
        ai('r1:model:2', '', [{ id: 'y', name: 'write_file', args: { path: 'b.md' } }]),
        tool('r1:tool:2:0', 'y', { error: 'A human rejected an action in this run.', executed: false }),
      ],
    });
    const [task] = deriveTasks(
      [rejected],
      [run({ status: 'cancelled' })],
      [approval({ status: 'reject', data: { tool: 'write_file', arguments: { path: 'a.md' } } })],
      [],
      {},
    );
    const review = task.steps.find((s) => s.kind === 'review');
    expect(review).toMatchObject({ state: 'rejected', backupArtifactId: null });
    expect(task.steps.find((s) => s.kind === 'tool')).toMatchObject({ state: 'error', label: "Couldn't change b.md: A human rejected an action in this run" });
    expect(task.changed).toEqual([]);
    expect(task.steps.at(-1)).toMatchObject({ kind: 'end', tone: 'stopped', text: 'Stopped' });
  });

  it('marks pending, expired and applying reviews', () => {
    const waiting = conversation({
      messages: [human('r1:user', 't'), ai('r1:model:1', '', [{ id: 'x', name: 'write_file', args: { path: 'a.md' } }])],
    });
    const state = (status: Parameters<typeof approval>[0] extends infer T ? T : never, r = run({ status: 'waiting' })) =>
      deriveTasks([waiting], [r], [approval({ id: 'r1:tool:1:0:approval', ...status })], [], {}, 1_000_000)[0].steps.find(
        (s) => s.kind === 'review',
      );
    expect(state({})).toMatchObject({ state: 'pending' });
    expect(state({ expires: 10 })).toMatchObject({ state: 'expired' });
    expect(state({}, run({ status: 'needs_review' }))).toMatchObject({ state: 'expired' });
    expect(state({ status: 'approve' }, run({ status: 'queued' }))).toMatchObject({ state: 'applying' });
  });

  it('streams the answer of an active run and ignores streams that are already saved', () => {
    const c = conversation({ messages: [human('r1:user', 'Q')] });
    const [t] = deriveTasks([c], [run({ status: 'running' })], [], [], { 'r1:model:1': { run: 'r1', text: 'Partial' } });
    expect(t.streaming).toBe(true);
    expect(t.answer).toBe('Partial');
    const saved = conversation({ messages: [human('r1:user', 'Q'), ai('r1:model:1', 'Full answer')] });
    const [u] = deriveTasks([saved], [run({ status: 'running' })], [], [], { 'r1:model:1': { run: 'r1', text: 'Partial' } });
    expect(u.streaming).toBe(false);
    expect(u.answer).toBe('Full answer');
  });

  it('orders tasks oldest first and groups imported history without a run', () => {
    const c = conversation({
      messages: [
        human('import:1:0', 'Old question'),
        ai('import:1:1', 'Old answer'),
        human('r2:user', 'New'),
        human('r1:user', 'Earlier'),
      ],
    });
    const tasks = deriveTasks([c], [run({ id: 'r2', created: 2000 }), run({ id: 'r1', created: 1000 })], [], [], {});
    expect(tasks.map((t) => t.task)).toEqual(['Old question', 'Earlier', 'New']);
    expect(tasks[0].run).toBeNull();
    expect(tasks[0].answer).toBe('Old answer');
    expect(tasks[1].started).toBe(1_000_000);
  });

  it('shows a friendly end for failures', () => {
    const [t] = deriveTasks([conversation({ messages: [human('r1:user', 'x')] })], [run({ status: 'failed', error: 'Model turn budget reached' })], [], [], {});
    expect(t.steps.at(-1)).toMatchObject({ tone: 'failed', text: 'That took more steps than allowed' });
  });
});

describe('reduceLive', () => {
  it('follows a run through its phases', () => {
    let m: LiveMap = {};
    m = reduceLive(m, ev(1, 'r1', 'run.queued', { status: 'queued' }));
    m = reduceLive(m, ev(2, 'r1', 'run.status', { status: 'running' }));
    expect(m.r1.phase).toBe('thinking');
    m = reduceLive(m, ev(3, 'r1', 'tool.started', { name: 'read_file', attempt_id: 'r1:tool:1:0' }));
    expect(m.r1).toMatchObject({ phase: 'tool', tool: 'read_file', attemptId: 'r1:tool:1:0' });
    m = reduceLive(m, ev(4, 'r1', 'tool.completed', { name: 'read_file', attempt_id: 'r1:tool:1:0' }));
    expect(m.r1.phase).toBe('thinking');
    m = reduceLive(m, ev(5, 'r1', 'message.delta', { message_id: 'r1:model:2', text: 'x' }));
    expect(m.r1.phase).toBe('answering');
    m = reduceLive(m, ev(6, 'r1', 'approval.requested', { approval_id: 'r1:tool:2:0:approval', tool: 'write_file' }));
    expect(m.r1).toMatchObject({ phase: 'tool', attemptId: 'r1:tool:2:0' });
    expect(m.r1.updated).toBe(106_000);
  });

  it('ignores finished runs when history is replayed from seq 0', () => {
    const history = [
      ev(1, 'old', 'run.queued', { status: 'queued' }),
      ev(2, 'old', 'run.status', { status: 'running' }),
      ev(3, 'old', 'tool.started', { name: 'read_file', attempt_id: 'old:tool:1:0' }),
      ev(4, 'old', 'run.status', { status: 'completed' }),
      ev(5, 'gone', 'run.queued', { status: 'queued' }),
      ev(6, 'gone', 'run.status', { status: 'cancelled' }),
      ev(7, 'old', 'message.delta', { message_id: 'old:model:2', text: 'late' }),
      ev(8, 'now', 'run.queued', { status: 'queued' }),
      ev(9, 'now', 'tool.started', { name: 'list_directory', attempt_id: 'now:tool:1:0' }),
    ];
    const m = history.reduce(reduceLive, {} as LiveMap);
    expect(Object.keys(m)).toEqual(['now']);
    expect(m.now.phase).toBe('tool');
  });

  it('drops a run that pauses or needs review, and ignores unrelated events', () => {
    let m = reduceLive({}, ev(1, 'r1', 'run.queued'));
    expect(reduceLive(m, ev(2, 'r1', 'context.prepared'))).toBe(m);
    expect(reduceLive(m, ev(3, null, 'run.queued'))).toBe(m);
    m = reduceLive(m, ev(4, 'r1', 'run.status', { status: 'paused' }));
    expect(m).toEqual({});
  });
});

describe('toolCallForAttempt and liveLine', () => {
  const conv = conversation({ messages });
  it('joins an attempt id to the model message', () => {
    expect(toolCallForAttempt([conv], 'r1:tool:1:1')).toEqual({ id: 'call_b', name: 'read_file', args: { path: 'README.md' } });
    expect(toolCallForAttempt([conv], 'r1:tool:9:0')).toBeUndefined();
    expect(toolCallForAttempt([conv], 'nonsense')).toBeUndefined();
  });
  it('writes the status line', () => {
    const base = { runId: 'r1', updated: 0 } as const;
    const running = run({ status: 'running' });
    expect(liveLine(undefined, running, [conv])).toBe('Thinking...');
    expect(liveLine({ ...base, phase: 'tool', tool: 'read_file', attemptId: 'r1:tool:1:1' }, running, [conv])).toBe('Reading README.md...');
    expect(liveLine({ ...base, phase: 'answering' }, running, [conv])).toBe('Writing the answer...');
    expect(liveLine({ ...base, phase: 'tool', tool: 'write_file', attemptId: 'r1:tool:2:0' }, run({ status: 'waiting' }), [conv])).toBe(
      'Waiting for you to review README.md',
    );
    expect(liveLine(undefined, run({ status: 'paused' }), [conv])).toBe('Paused');
    expect(liveLine(undefined, run({ status: 'queued' }), [conv])).toBe('Waiting its turn...');
  });
});

describe('linkPaths', () => {
  it('turns known paths into chips and keeps the rest as text', () => {
    expect(linkPaths('See docs/a.md, and README.md.', ['README.md', 'docs/a.md'])).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'path', path: 'docs/a.md' },
      { kind: 'text', text: ', and ' },
      { kind: 'path', path: 'README.md' },
      { kind: 'text', text: '.' },
    ]);
  });
  it('does not match inside longer names and handles no paths', () => {
    expect(linkPaths('my-README.md and README.md.bak', ['README.md'])).toEqual([
      { kind: 'text', text: 'my-README.md and README.md.bak' },
    ]);
    expect(linkPaths('plain', [])).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(linkPaths('', ['a'])).toEqual([]);
  });
});

describe('failureReason', () => {
  it('keeps the first sentence and shortens long ones', () => {
    expect(failureReason('Web search budget reached or this request was interrupted. More text.')).toBe(
      'Web search budget reached or this request was interrupted',
    );
    expect(failureReason('x'.repeat(200)).length).toBe(88);
    expect(failureReason('')).toBe('');
  });
});

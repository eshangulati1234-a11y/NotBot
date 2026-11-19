import { describe, expect, it } from 'vitest';
import { approval, bot, conversation, human, run, snapshot, workspace } from './fixtures';
import { deriveHelpers, deriveReviewQueue, groupByFolder } from './helpers';
import { helperStateLabel } from './status';

const NOW = 1_700_000_000_000;

describe('deriveHelpers', () => {
  const s = snapshot({
    bots: [bot({ id: 'idle', name: 'Idle' }), bot({ id: 'wait', name: 'Wait' }), bot({ id: 'work', name: 'Work' }), bot({ id: 'done', name: 'Done' })],
    workspaces: [workspace(), workspace({ id: 'w2', name: 'other', path: '/o' })],
    conversations: [
      conversation({ id: 'ci', bot_id: 'idle', created: 5000 }),
      conversation({ id: 'cw', bot_id: 'wait', created: 10 }),
      conversation({ id: 'ck', bot_id: 'work', created: 20 }),
      conversation({ id: 'cd', bot_id: 'done', created: 30, messages: [human('rd:user', 'x')] }),
    ],
    runs: [
      run({ id: 'rd', bot_id: 'done', conversation_id: 'cd', status: 'completed', created: 3000 }),
      run({ id: 'rk', bot_id: 'work', conversation_id: 'ck', status: 'running', created: 2000 }),
      run({ id: 'rw', bot_id: 'wait', conversation_id: 'cw', status: 'waiting', created: 1000 }),
    ],
    approvals: [
      approval({ id: 'rw:tool:1:0:approval', run_id: 'rw' }),
      approval({ id: 'rd:tool:1:0:approval', run_id: 'rd', status: 'consumed', data: { tool: 'write_file', arguments: { path: 'a.md' } } }),
      approval({ id: 'rd:tool:2:0:approval', run_id: 'rd', status: 'consumed', data: { tool: 'write_file', arguments: { path: 'b.md' } } }),
    ],
  });

  it('orders waiting, then working, then most recent', () => {
    const order = deriveHelpers(s, {}, NOW).map((h) => h.bot.id);
    expect(order).toEqual(['wait', 'work', 'idle', 'done']);
  });

  it('derives state and outcome text', () => {
    const byId = Object.fromEntries(deriveHelpers(s, {}, NOW).map((h) => [h.bot.id, h]));
    expect(byId.wait.state).toBe('waiting');
    expect(byId.wait.outcome).toBe('Wants to change a.md');
    expect(byId.work.state).toBe('working');
    expect(byId.work.outcome).toBe('No changes yet');
    expect(byId.done.state).toBe('done');
    expect(byId.done.outcome).toBe('Updated 2 files');
    expect(byId.idle.state).toBe('idle');
    expect(byId.idle.outcome).toBe('No tasks yet');
    expect(byId.wait.activeRun?.id).toBe('rw');
    expect(byId.wait.pending).toHaveLength(1);
  });

  it('combines changes and waiting reviews', () => {
    const s2 = snapshot({
      bots: [bot()],
      workspaces: [workspace()],
      conversations: [conversation()],
      runs: [run({ status: 'waiting' })],
      approvals: [
        approval({ id: 'r1:tool:1:0:approval', status: 'consumed', data: { tool: 'write_file', arguments: { path: 'a.md' } } }),
        approval({ id: 'r1:tool:2:0:approval', status: 'consumed', data: { tool: 'write_file', arguments: { path: 'b.md' } } }),
        approval({ id: 'r1:tool:3:0:approval' }),
      ],
    });
    expect(deriveHelpers(s2, {}, NOW)[0].outcome).toBe('Updated 2 files \u00B7 Wants to change a.md');
  });

  it('flags disabled helpers and failures', () => {
    const s3 = snapshot({
      bots: [bot({ enabled: false }), bot({ id: 'b2', name: 'Two' })],
      workspaces: [workspace()],
      conversations: [conversation(), conversation({ id: 'c2', bot_id: 'b2' })],
      runs: [run({ id: 'x', bot_id: 'b2', conversation_id: 'c2', status: 'failed' })],
    });
    const views = deriveHelpers(s3, {}, NOW);
    expect(views.find((v) => v.bot.id === 'b1')).toMatchObject({ state: 'off', outcome: 'Not taking tasks' });
    expect(views.find((v) => v.bot.id === 'b2')).toMatchObject({ state: 'failed', outcome: 'No changes made' });
  });

  it('uses the preferred folder, with no current conversation when it differs', () => {
    const view = deriveHelpers(s, { idle: 'w2' }, NOW).find((h) => h.bot.id === 'idle')!;
    expect(view.workspace?.id).toBe('w2');
    expect(view.current).toBeNull();
    const same = deriveHelpers(s, {}, NOW).find((h) => h.bot.id === 'idle')!;
    expect(same.workspace?.id).toBe('w1');
    expect(same.current?.id).toBe('ci');
    const unknown = deriveHelpers(s, { idle: 'nope' }, NOW).find((h) => h.bot.id === 'idle')!;
    expect(unknown.workspace?.id).toBe('w1');
  });
});

describe('deriveReviewQueue', () => {
  it('keeps pending, waiting, unexpired approvals oldest first', () => {
    const s = snapshot({
      bots: [bot()],
      workspaces: [workspace()],
      runs: [run({ id: 'r1', status: 'waiting' }), run({ id: 'r2', status: 'needs_review' }), run({ id: 'r3', status: 'waiting' })],
      // Stored newest first.
      approvals: [
        approval({ id: 'r3:tool:1:0:approval', run_id: 'r3' }),
        approval({ id: 'r2:tool:1:0:approval', run_id: 'r2' }),
        approval({ id: 'r1:tool:1:0:approval', run_id: 'r1', expires: NOW / 1000 - 5 }),
        approval({ id: 'r1:tool:2:0:approval', run_id: 'r1' }),
        approval({ id: 'r1:tool:0:0:approval', run_id: 'r1', status: 'consumed' }),
      ],
    });
    const queue = deriveReviewQueue(s, NOW);
    expect(queue.map((q) => q.approval.id)).toEqual(['r1:tool:2:0:approval', 'r3:tool:1:0:approval']);
    expect(queue[0].bot.id).toBe('b1');
    expect(queue[0].workspace?.id).toBe('w1');
  });
});

describe('outcome wording and folder groups', () => {
  it('never repeats the state label in the outcome', () => {
    const s = snapshot({
      bots: [bot({ id: 'a', name: 'A' }), bot({ id: 'b', name: 'B', enabled: false }), bot({ id: 'c', name: 'C' })],
      workspaces: [workspace()],
      conversations: [conversation({ id: 'ca', bot_id: 'a' }), conversation({ id: 'cc', bot_id: 'c' })],
      runs: [
        run({ id: 'ra', bot_id: 'a', conversation_id: 'ca', status: 'waiting' }),
        run({ id: 'rc', bot_id: 'c', conversation_id: 'cc', status: 'paused' }),
      ],
      approvals: [approval({ id: 'ra:tool:1:0:approval', run_id: 'ra' })],
    });
    for (const view of deriveHelpers(s, {}, NOW)) {
      expect(view.outcome.toLowerCase()).not.toContain(helperStateLabel(view.state).toLowerCase());
    }
  });

  it('groups helpers under their folder in the incoming order', () => {
    const w1 = workspace({ id: 'w1', name: 'one', path: '/a/one' });
    const w2 = workspace({ id: 'w2', name: 'two', path: '/a/two' });
    const view = (id: string, w: typeof w1 | null) => ({ bot: bot({ id }), workspace: w }) as never;
    const groups = groupByFolder([view('x', w2), view('y', w1), view('z', w2), view('n', null)]);
    expect(groups.map((g) => [g.name, g.helpers.length])).toEqual([['two', 2], ['one', 1], ['No folder yet', 1]]);
    expect(groups[0].path).toBe('/a/two');
  });
});

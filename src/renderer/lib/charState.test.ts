import { describe, expect, it } from 'vitest';
import { activityForTool, charStateFor, poses, type CharState } from './charState';

describe('charStateFor', () => {
  it('maps each helper state to a character state', () => {
    expect(charStateFor('idle')).toBe('idle');
    expect(charStateFor('waiting')).toBe('waiting');
    expect(charStateFor('done')).toBe('done');
    expect(charStateFor('failed')).toBe('error');
    expect(charStateFor('paused')).toBe('asleep');
    expect(charStateFor('off')).toBe('asleep');
  });

  it('shows what a working helper is busy with', () => {
    expect(charStateFor('working')).toBe('thinking');
    expect(charStateFor('working', 'reading')).toBe('reading');
    expect(charStateFor('working', 'writing')).toBe('writing');
  });
});

describe('activityForTool', () => {
  it('tells looking from changing', () => {
    expect(activityForTool('read_file')).toBe('reading');
    expect(activityForTool('list_directory')).toBe('reading');
    expect(activityForTool('write_file')).toBe('writing');
    expect(activityForTool(null)).toBe('thinking');
    expect(activityForTool('something_new')).toBe('thinking');
  });
});

describe('poses', () => {
  it('defines a full pose for every state with values in range', () => {
    const states: CharState[] = ['idle', 'thinking', 'reading', 'writing', 'waiting', 'done', 'error', 'asleep'];
    for (const state of states) {
      const pose = poses[state];
      expect(pose).toBeDefined();
      for (const value of [pose.eyes, pose.bounce, pose.lean]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      for (const value of [pose.smile, pose.brow, pose.lookX, pose.lookY]) {
        expect(Math.abs(value)).toBeLessThanOrEqual(1);
      }
    }
  });
});

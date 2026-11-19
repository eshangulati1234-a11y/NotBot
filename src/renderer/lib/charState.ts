import type { HelperState } from './helpers';

/** What the character is doing right now. The same words drive the animation and the tests. */
export type CharState = 'idle' | 'thinking' | 'reading' | 'writing' | 'waiting' | 'done' | 'error' | 'asleep';

/** What a working helper is busy with, taken from its latest tool call. */
export type Activity = 'reading' | 'writing' | 'thinking';

/** Tools that only look at things, versus tools that prepare a change. */
const reads = new Set(['list_directory', 'read_file', 'search_text', 'read_artifact', 'search_memory', 'search_history', 'fetch_page', 'web_search', 'computer_look']);
const writes = new Set(['write_file', 'computer_act']);

export function activityForTool(tool: string | null | undefined): Activity {
  if (!tool) return 'thinking';
  if (writes.has(tool)) return 'writing';
  if (reads.has(tool)) return 'reading';
  return 'thinking';
}

export function charStateFor(state: HelperState, activity: Activity = 'thinking'): CharState {
  switch (state) {
    case 'working':
      return activity;
    case 'waiting':
      return 'waiting';
    case 'done':
      return 'done';
    case 'failed':
      return 'error';
    case 'paused':
    case 'off':
      return 'asleep';
    default:
      return 'idle';
  }
}

/** Looks the character should have in each state; the animation blends towards these. */
export interface Pose {
  /** Head tilt in radians (positive leans right). */
  tilt: number;
  /** Lean toward the viewer, 0 to 1. */
  lean: number;
  /** Eye openness, 0 closed to 1 open. */
  eyes: number;
  /** Where the eyes look, from -1 to 1. */
  lookX: number;
  lookY: number;
  /** Mouth curve, -1 frown to 1 big smile. */
  smile: number;
  /** Brow angle, -1 worried to 1 puzzled. */
  brow: number;
  /** How high each arm is raised, 0 to 1. */
  armL: number;
  armR: number;
  /** Energy of the bounce, 0 calm to 1 lively. */
  bounce: number;
}

export const poses: Record<CharState, Pose> = {
  idle: { tilt: 0, lean: 0, eyes: 1, lookX: 0, lookY: 0, smile: 0.55, brow: 0, armL: 0.05, armR: 0.05, bounce: 0.1 },
  thinking: { tilt: 0.16, lean: 0, eyes: 0.9, lookX: 0.5, lookY: 0.7, smile: 0.1, brow: 0.7, armL: 0.05, armR: 0.55, bounce: 0.15 },
  reading: { tilt: -0.05, lean: 0.25, eyes: 0.85, lookX: 0, lookY: -0.5, smile: 0.25, brow: 0.2, armL: 0.5, armR: 0.5, bounce: 0.12 },
  writing: { tilt: 0.05, lean: 0.3, eyes: 0.8, lookX: -0.3, lookY: -0.5, smile: 0.2, brow: 0.3, armL: 0.35, armR: 0.8, bounce: 0.3 },
  waiting: { tilt: -0.12, lean: 0.35, eyes: 1, lookX: 0, lookY: 0.1, smile: 0.35, brow: 0.9, armL: 0.7, armR: 0.7, bounce: 0.2 },
  done: { tilt: 0, lean: 0, eyes: 0.55, lookX: 0, lookY: 0.2, smile: 1, brow: -0.3, armL: 1, armR: 1, bounce: 1 },
  error: { tilt: 0.1, lean: 0, eyes: 0.9, lookX: 0, lookY: -0.3, smile: -0.8, brow: -0.9, armL: -0.1, armR: -0.1, bounce: 0 },
  asleep: { tilt: 0.22, lean: 0, eyes: 0.05, lookX: 0, lookY: -0.2, smile: 0.2, brow: 0, armL: 0, armR: 0, bounce: 0.05 },
};

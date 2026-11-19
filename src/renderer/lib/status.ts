import type { RunStatus, Safety } from '../api';
import type { DotState } from '../ui/StatusDot';
import type { HelperState } from './helpers';

const runLabels: Record<RunStatus, string> = {
  queued: 'Waiting its turn',
  running: 'Working',
  waiting: 'Waiting for you',
  paused: 'Paused',
  completed: 'Done',
  failed: "Didn't finish",
  cancelled: 'Stopped',
  needs_review: 'Needs a fresh start',
};

export const runStatusLabel = (status: RunStatus): string => runLabels[status] ?? 'Working';

const helperLabels: Record<HelperState, string> = {
  idle: 'Ready',
  working: 'Working',
  waiting: 'Waiting for you',
  paused: 'Paused',
  done: 'Done',
  failed: "Didn't finish",
  off: 'Turned off',
};

export const helperStateLabel = (state: HelperState): string => helperLabels[state] ?? 'Ready';

const dots: Record<HelperState | RunStatus, DotState> = {
  idle: 'idle',
  working: 'working',
  waiting: 'waiting',
  paused: 'paused',
  done: 'done',
  failed: 'failed',
  off: 'idle',
  queued: 'working',
  running: 'working',
  completed: 'done',
  cancelled: 'idle',
  needs_review: 'failed',
};

export const dotState = (state: HelperState | RunStatus): DotState => dots[state] ?? 'idle';

type Args = Record<string, unknown> | null | undefined;
type Tense = 'live' | 'past' | 'request';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isRoot = (path: string) => path === '' || path === '.' || path === './' || path === '/';

/** One plain-language line for a tool call, in the tense that suits where it is shown. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function toolPhrase(name: string, args: Args, tense: Tense): string {
  const path = text(args?.path);
  const pick = (live: string, past: string, request: string) =>
    tense === 'live' ? live : tense === 'past' ? past : request;
  switch (name) {
    case 'list_directory':
      return isRoot(path)
        ? pick('Looking around the folder...', 'Looked around the folder', 'Wants to look around the folder')
        : pick(`Looking in ${path}...`, `Looked in ${path}`, `Wants to look in ${path}`);
    case 'read_file':
      return path
        ? pick(`Reading ${path}...`, `Read ${path}`, `Wants to read ${path}`)
        : pick('Reading a file...', 'Read a file', 'Wants to read a file');
    case 'web_search': {
      const query = text(args?.query);
      const suffix = query ? ` for "${query}"` : '';
      return pick(`Searching the web${suffix}…`, `Searched the web${suffix}`, `Wants to search the web${suffix}`);
    }
    case 'computer_look':
      return pick('Looking at the screen…', 'Looked at the screen', 'Wants to look at the screen');
    case 'computer_act': {
      const action = text(args?.action);
      const what: Record<string, [string, string, string]> = {
        click: ['Clicking…', 'Clicked', 'Wants to click'],
        type: ['Typing…', 'Typed', 'Wants to type'],
        key: ['Pressing a key…', 'Pressed a key', 'Wants to press a key'],
        scroll: ['Scrolling…', 'Scrolled', 'Wants to scroll'],
        open_app: ['Opening an app…', 'Opened an app', 'Wants to open an app'],
        focus_app: ['Switching apps…', 'Switched apps', 'Wants to switch apps'],
      };
      const [now, past, ask] = what[action] ?? ['Using the Mac…', 'Used the Mac', 'Wants to use the Mac'];
      return pick(now, past, ask);
    }
    case 'fetch_page': {
      const site = hostOf(text(args?.url));
      const where = site ? ` from ${site}` : '';
      return pick(`Opening a page${where}…`, `Read a page${where}`, `Wants to open a page${where}`);
    }
    case 'search_text': {
      const query = text(args?.query);
      return query
        ? pick(`Searching workspace for "${query}"...`, `Searched workspace for "${query}"`, `Wants to search workspace for "${query}"`)
        : pick('Searching the folder...', 'Searched the folder', 'Wants to search the folder');
    }
    case 'write_file':
      return path
        ? pick(`Preparing a change to ${path}...`, `Changed ${path}`, `Wants to change ${path}`)
        : pick('Preparing a change...', 'Changed a file', 'Wants to change a file');
    case 'read_artifact':
      return pick('Reading earlier output...', 'Read earlier output', 'Wants to read earlier output');
    case 'search_memory':
      return pick('Checking its notes...', 'Checked its notes', 'Wants to check its notes');
    case 'search_history':
      return pick('Looking back at earlier tasks...', 'Looked back at earlier tasks', 'Wants to look back at earlier tasks');
    case 'write_memory':
      return pick('Saving a note...', 'Saved a note', 'Wants to save a note');
    default:
      return pick('Using a tool...', 'Used a tool', 'Wants to use a tool');
  }
}

const catalogue: { test: RegExp; title: string; next: string }[] = [
  {
    test: /changing model configuration|active run before/i,
    title: 'Notbot is busy',
    next: 'Pause or stop the running task, then try again.',
  },
  {
    test: /already has an active run|active run/i,
    title: 'This helper is already working',
    next: 'Wait for it to finish, or stop it first.',
  },
  {
    test: /queue is full/i,
    title: 'Too many tasks are waiting',
    next: 'Wait for one to finish, or stop one, then send this again.',
  },
  {
    test: /disabled/i,
    title: 'This helper is turned off',
    next: 'Turn it back on in its settings.',
  },
  {
    test: /approval expired|already decided or expired|expired or already consumed/i,
    title: 'The review timed out',
    next: 'Stop this task and ask again to get a fresh proposal.',
  },
  {
    test: /changed after the proposal|target changed|ambiguous outcome|request a fresh edit/i,
    title: 'The file changed after the proposal',
    next: 'Stop this task and ask again so the helper reads the latest version.',
  },
  {
    test: /turn budget/i,
    title: 'That took more steps than allowed',
    next: 'Ask for a smaller piece of the job, or start a new task.',
  },
  {
    test: /execution time budget|time budget/i,
    title: 'That took longer than allowed',
    next: 'Ask for a smaller piece of the job, or start a new task.',
  },
  {
    test: /token budget|context budget|context limit|context window/i,
    title: 'The model ran out of room',
    next: 'Try a smaller task, or increase Notbot’s context budget within the model server’s limit.',
  },
  {
    test: /tool request as plain text|structured tool calling/i,
    title: "This model can't take part in the work",
    next: 'Choose a different model in Settings.',
  },
  {
    test: /model server|model endpoint|unavailable|connection|connect|ollama|lm studio|endpoint/i,
    title: "The model isn't answering",
    next: 'Make sure Ollama or LM Studio is running, then try again.',
  },
];

/** Matches a known harness message. Returns null when the message is not recognised. */
export function explainKnown(message: string): { title: string; next: string } | null {
  const found = catalogue.find((entry) => entry.test.test(message));
  return found ? { title: found.title, next: found.next } : null;
}

/** Turns a harness error into a short title and one concrete next step. */
export function explainError(message: string | null | undefined): { title: string; next: string } {
  return (
    explainKnown(message ?? '') ?? {
      title: 'Something went wrong',
      next: 'Try again. If it keeps happening, check the model in Settings.',
    }
  );
}

export const PERMISSIONS: { value: 'ask' | 'balanced'; title: string; detail: string }[] = [
  { value: 'ask', title: 'Ask first', detail: 'Asks before every step' },
  { value: 'balanced', title: 'Read freely', detail: 'Reads freely, asks before changing' },
];

/** Lower-case summary for the boundary badge. `handsoff` is shown as balanced. */
export function permissionSummary(safety: Safety): string {
  return safety === 'ask' ? 'asks before every step' : 'reads freely · asks before changing';
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LMSTUDIO_URL,
  OLLAMA_URL,
  emptySnapshot,
  finished,
  folderName,
  friendlyError,
  request,
  type Bot,
  type Conversation,
  type ModelInfo,
  type Run,
  type Snapshot,
  type Workspace,
} from './api';
import { generateBotName } from './bots';
import { deriveHelpers, deriveReviewQueue } from './lib/helpers';
import { explainKnown } from './lib/status';
import { reduceLive, type LiveMap } from './lib/trail';

export type ModelState = {
  status: 'checking' | 'ready' | 'no-server' | 'no-models' | 'missing-model';
  baseUrl: string;
  model: string;
  models: string[];
  message: string;
};

const folderKey = 'notbot-helper-folder';

function readFolders(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(folderKey) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function writeFolders(value: Record<string, string>) {
  try {
    localStorage.setItem(folderKey, JSON.stringify(value));
  } catch {
    // The choice then lasts for this session only.
  }
}

const serverName = (url: string) =>
  url.includes(':11434') ? 'Ollama' : url.includes(':1234') ? 'LM Studio' : 'The model server';

const checking: ModelState = { status: 'checking', baseUrl: '', model: '', models: [], message: '' };

/** A message for the notice bar: known harness errors get a title and a next step. */
function noticeFor(reason: unknown): string {
  const text = friendlyError(reason);
  const known = explainKnown(text);
  return known ? `${known.title}. ${known.next}` : text;
}

/** All runtime state and actions in one place, so the components stay presentational. */
export function useNotbot() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(true);
  const [startupError, setStartupError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rawStreams, setStreams] = useState<Record<string, { run: string; text: string }>>({});
  const [rawLive, setLive] = useState<LiveMap>({});
  const [folders, setFolders] = useState<Record<string, string>>(readFolders);
  const [model, setModel] = useState<ModelState>(checking);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refreshing = useRef(false);
  const again = useRef(false);
  const conversationForKey = useRef(new Map<string, string>());
  const checked = useRef(false);
  /** Runs that have sent events since the last snapshot request began. */
  const eventRuns = useRef(new Set<string>());
  /** The connection notice currently shown, so the next good event can clear exactly that. */
  const connectionNotice = useRef('');

  const refresh = useCallback(async () => {
    const seen = new Set(eventRuns.current);
    const value = await request<Snapshot>('GET', '/snapshot');
    // Runs that spoke before this snapshot was requested but are not in it are gone: forget their live state.
    const known = new Set(value.runs.map((run) => run.id));
    const gone = [...seen].filter((id) => !known.has(id));
    for (const id of seen) eventRuns.current.delete(id);
    if (gone.length) {
      const dropped = new Set(gone);
      setLive((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !dropped.has(id))));
      setStreams((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([, v]) => !dropped.has(v.run))),
      );
    }
    snapshotRef.current = value;
    setSnapshot(value);
    setReady(true);
    return value;
  }, []);

  const retryStartup = useCallback(async () => {
    setStarting(true);
    setStartupError('');
    try {
      await window.notbotRuntime?.connection();
      await refresh();
    } catch (reason) {
      setStartupError(friendlyError(reason));
      setReady(false);
    } finally {
      setStarting(false);
    }
  }, [refresh]);

  useEffect(() => {
    void retryStartup();
  }, [retryStartup]);

  // Refreshes are coalesced: a replay of history from seq 0 can send hundreds of events at once.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (refreshing.current) {
        again.current = true;
        return;
      }
      refreshing.current = true;
      const loop = (): Promise<void> =>
        refresh()
          .then(() => undefined)
          .catch((reason) => setNotice(friendlyError(reason)))
          .then(() => {
            if (again.current) {
              again.current = false;
              return loop();
            }
          });
      void loop().finally(() => {
        refreshing.current = false;
      });
    }, 120);
  }, [refresh]);

  useEffect(() => {
    if (!ready || !window.notbotRuntime) return;
    const stop = window.notbotRuntime.subscribe(
      0,
      (event) => {
        if (connectionNotice.current) {
          const shown = connectionNotice.current;
          connectionNotice.current = '';
          setNotice((current) => (current === shown ? '' : current));
        }
        if (event.run_id) eventRuns.current.add(event.run_id);
        setLive((previous) => reduceLive(previous, event));
        if (event.kind === 'message.delta') {
          const id = String(event.data.message_id);
          setStreams((previous) => ({
            ...previous,
            [id]: {
              run: event.run_id ?? '',
              text: (previous[id]?.text ?? '') + String(event.data.text),
            },
          }));
          return;
        }
        if (event.kind === 'model.completed' || event.kind === 'run.status') {
          setStreams((previous) =>
            Object.fromEntries(Object.entries(previous).filter(([, v]) => v.run !== event.run_id)),
          );
        }
        scheduleRefresh();
      },
      (message) => {
        const text = friendlyError(message);
        connectionNotice.current = text;
        setNotice(text);
      },
    );
    return () => {
      stop();
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [ready, scheduleRefresh]);

  // Replayed history must never look live: only show state for runs that are still active.
  const activeRuns = useMemo(
    () => new Set(snapshot.runs.filter((run) => !finished.includes(run.status)).map((run) => run.id)),
    [snapshot.runs],
  );
  const knownRuns = useMemo(() => new Set(snapshot.runs.map((run) => run.id)), [snapshot.runs]);
  const keepRun = useCallback(
    (id: string) => activeRuns.has(id) || !knownRuns.has(id),
    [activeRuns, knownRuns],
  );
  const live = useMemo<LiveMap>(
    () => Object.fromEntries(Object.entries(rawLive).filter(([id]) => keepRun(id))),
    [rawLive, keepRun],
  );
  const streams = useMemo(
    () => Object.fromEntries(Object.entries(rawStreams).filter(([, value]) => keepRun(value.run))),
    [rawStreams, keepRun],
  );

  const helpers = useMemo(() => deriveHelpers(snapshot, folders), [snapshot, folders]);
  const reviewQueue = useMemo(() => deriveReviewQueue(snapshot), [snapshot]);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  /** Runs an action, refreshes, and reports a failure as a notice instead of throwing. */
  const act = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setNotice('');
      try {
        const result = await operation();
        await refresh().catch(() => undefined);
        return result;
      } catch (reason) {
        setNotice(noticeFor(reason));
        // A half-finished action (for example a helper created without its conversation) may have changed state.
        await refresh().catch(() => undefined);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const discoverModels = useCallback(async (baseUrl: string): Promise<string[]> => {
    try {
      const result = await request<{ models: ModelInfo[] }>('POST', '/models/discover', {
        base_url: baseUrl.trim(),
        model: snapshotRef.current.model || 'model',
      });
      return (result.models ?? []).map((item) => item.id).filter(Boolean);
    } catch (reason) {
      throw new Error(friendlyError(reason));
    }
  }, []);

  const hasActiveRun = () => snapshotRef.current.runs.some((run) => !finished.includes(run.status));

  const checkModel = useCallback(async (): Promise<ModelState> => {
    setModel((previous) => ({ ...previous, status: 'checking', message: '' }));
    const saved = snapshotRef.current;
    const urls = [...new Set([saved.model_url, OLLAMA_URL, LMSTUDIO_URL].filter(Boolean))];
    let emptyServer = '';
    let result: ModelState | undefined;
    for (const url of urls) {
      let models: string[];
      try {
        models = await discoverModels(url);
      } catch {
        continue;
      }
      if (!models.length) {
        emptyServer ||= url;
        continue;
      }
      const sameConfig = url === saved.model_url && models.includes(saved.model);
      const chosen = sameConfig ? saved.model : models[0];
      if (!sameConfig) {
        if (hasActiveRun()) {
          result = {
            status: 'missing-model',
            baseUrl: saved.model_url,
            model: saved.model,
            models,
            message: `${serverName(url)} is running, but Notbot can only switch models once the current task is finished.`,
          };
          break;
        }
        try {
          await request('PUT', '/models/config', { base_url: url, model: chosen });
          await refresh();
        } catch (reason) {
          result = {
            status: 'missing-model',
            baseUrl: url,
            model: chosen,
            models,
            message: noticeFor(reason),
          };
          break;
        }
      }
      result = {
        status: 'ready',
        baseUrl: url,
        model: chosen,
        models,
        message: `Using ${chosen} on ${serverName(url)}.`,
      };
      break;
    }
    if (!result && emptyServer) {
      const lm = emptyServer.includes(':1234');
      result = {
        status: 'no-models',
        baseUrl: emptyServer,
        model: saved.model,
        models: [],
        message: lm
          ? 'LM Studio is running but has no model loaded. Load one in LM Studio, then try again.'
          : `${serverName(emptyServer)} is running but has no models yet. Run "ollama pull llama3.2:3b", then try again.`,
      };
    }
    result ??= {
      status: 'no-server',
      baseUrl: saved.model_url,
      model: saved.model,
      models: [],
      message: "Notbot can't find a model server. Start Ollama or LM Studio, then try again.",
    };
    setModel(result);
    return result;
  }, [discoverModels, refresh]);

  useEffect(() => {
    if (!ready || checked.current) return;
    checked.current = true;
    void checkModel();
  }, [ready, checkModel]);

  const saveModel = useCallback(
    async (baseUrl: string, name: string): Promise<boolean> => {
      if (hasActiveRun()) {
        setNotice('Notbot is busy. Pause or stop the running task, then try again.');
        return false;
      }
      const ok = await act(async () => {
        await request('PUT', '/models/config', { base_url: baseUrl.trim(), model: name });
        return true;
      });
      if (ok) await checkModel();
      return ok === true;
    },
    [act, checkModel],
  );

  const pickFolder = useCallback(async (): Promise<Workspace | undefined> => {
    try {
      const path = await window.notbotRuntime?.chooseWorkspace();
      if (!path) return undefined;
      return await act(() =>
        request<Workspace>('POST', '/workspaces', { path, name: folderName(path) || 'Folder' }),
      );
    } catch (reason) {
      setNotice(noticeFor(reason));
      return undefined;
    }
  }, [act]);

  const setHelperFolder = useCallback((botId: string, workspaceId: string) => {
    // Update the ref synchronously so a task started right after creation sees the folder.
    const next = { ...foldersRef.current, [botId]: workspaceId };
    foldersRef.current = next;
    writeFolders(next);
    setFolders(next);
  }, []);

  const createHelper = useCallback(
    async (purpose: string, workspaceId: string, name?: string): Promise<Bot | undefined> => {
      const existing = snapshotRef.current.bots.map((bot) => bot.name);
      const botName = name?.trim() || generateBotName(existing);
      const bot = await act(async () => {
        const created = await request<Bot>('POST', '/bots', {
          name: botName,
          purpose: purpose.trim(),
          enabled: true,
          model: null,
          safety: 'balanced',
        });
        // Bots have no folder of their own: the conversation is what stores the binding.
        await request<Conversation>('POST', '/conversations', {
          bot_id: created.id,
          workspace_id: workspaceId,
        });
        return created;
      });
      if (bot) setHelperFolder(bot.id, workspaceId);
      return bot;
    },
    [act, setHelperFolder],
  );

  const updateHelper = useCallback(
    async (bot: Bot): Promise<boolean> =>
      (await act(async () => {
        await request('PUT', '/bots/' + bot.id, {
          name: bot.name,
          purpose: bot.purpose,
          enabled: bot.enabled,
          model: bot.model,
          safety: bot.safety,
          learn: bot.learn ?? true,
          computer: bot.computer ?? false,
        });
        return true;
      })) === true,
    [act],
  );

  const startTask = useCallback(
    async (
      botId: string,
      task: string,
      key: string,
      opts?: { fresh?: boolean },
    ): Promise<Run | undefined> => {
      // Derive from the latest data, not from render state, which lags right after creation.
      const helper = deriveHelpers(snapshotRef.current, foldersRef.current).find(
        (item) => item.bot.id === botId,
      );
      if (!helper) {
        setNotice('That helper is no longer here.');
        return undefined;
      }
      if (!helper.workspace) {
        setNotice('Choose a folder for this helper first.');
        return undefined;
      }
      const workspaceId = helper.workspace.id;
      return act(async () => {
        // `current` is already the latest conversation in the chosen folder, so a changed folder
        // has none and gets a new conversation. A retry with the same key reuses the one it made.
        let conversationId = conversationForKey.current.get(key);
        if (!conversationId && !opts?.fresh && helper.current) conversationId = helper.current.id;
        if (!conversationId) {
          const created = await request<Conversation>('POST', '/conversations', {
            bot_id: botId,
            workspace_id: workspaceId,
          });
          conversationId = created.id;
        }
        conversationForKey.current.set(key, conversationId);
        return request<Run>('POST', '/runs', { conversation_id: conversationId, task }, key);
      });
    },
    [act],
  );

  /** Send an edited version of an earlier task on a branch that forgets that task and what followed. */
  const editTask = useCallback(
    async (runId: string, task: string, key: string): Promise<Run | undefined> => {
      const source = snapshotRef.current.runs.find((item) => item.id === runId);
      if (!source) {
        setNotice('That task is no longer here.');
        return undefined;
      }
      return act(async () => {
        let conversationId = conversationForKey.current.get(key);
        if (!conversationId) {
          const branch = await request<Conversation>(
            'POST',
            `/conversations/${source.conversation_id}/fork`,
            { run_id: runId },
          );
          conversationId = branch.id;
          conversationForKey.current.set(key, conversationId);
        }
        return request<Run>('POST', '/runs', { conversation_id: conversationId, task }, key);
      });
    },
    [act],
  );

  const runAction = useCallback(
    async (runId: string, action: 'pause' | 'resume' | 'cancel'): Promise<boolean> =>
      (await act(async () => {
        await request('POST', `/runs/${runId}/${action}`, {});
        return true;
      })) === true,
    [act],
  );

  const decide = useCallback(
    async (approvalId: string, decision: 'approve' | 'reject'): Promise<boolean> =>
      (await act(async () => {
        await request('POST', '/approvals/' + approvalId, { decision });
        return true;
      })) === true,
    [act],
  );

  const readArtifact = useCallback(
    async (id: string): Promise<string> => {
      try {
        return await request<string>('GET', '/artifacts/' + id);
      } catch (reason) {
        throw new Error(friendlyError(reason));
      }
    },
    [],
  );

  const exportArtifact = useCallback(async (id: string): Promise<boolean> => {
    try {
      return (await window.notbotRuntime?.saveArtifact(id)) === true;
    } catch (reason) {
      setNotice(noticeFor(reason));
      return false;
    }
  }, []);

  const phase: 'starting' | 'failed' | 'ready' = ready ? 'ready' : starting ? 'starting' : 'failed';

  return {
    snapshot,
    phase,
    startupError,
    notice,
    clearNotice: () => setNotice(''),
    busy,
    streams,
    live,
    helpers,
    reviewQueue,
    model,
    retryStartup,
    checkModel,
    discoverModels,
    saveModel,
    pickFolder,
    createHelper,
    updateHelper,
    setHelperFolder,
    startTask,
    editTask,
    runAction,
    decide,
    readArtifact,
    exportArtifact,
  };
}
export type Notbot = ReturnType<typeof useNotbot>;

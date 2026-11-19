# Notbot renderer rebuild: build plan (from the Opus advisor)

Read `docs/REDESIGN_SPEC.md` first. This plan gives the exact contracts. Every path is under `src/renderer/` unless stated. Several agents work in parallel on non-overlapping files, so code to these signatures exactly, even for files that do not exist yet.

## 1. Harness facts that constrain the design

**Runs.** A run has `id, conversation_id, workspace_id, bot_id, bot_snapshot, workspace_snapshot, model, task, status, active_seconds, turns, created, error, answer`. Statuses: `queued | running | waiting | paused | completed | failed | cancelled | needs_review`. Pause works only on queued/running; resume only on paused; cancel on anything not finished. `needs_review` (approval expired, or file changed after the proposal) cannot be resumed; the only way out is Cancel plus a fresh task. One active run per conversation (`needs_review` counts as active), else POST returns 409. `PUT /models/config` returns 409 while any run is active.

**Messages** are LangChain dicts: `{type:'human'|'ai'|'tool', data:{id, content, tool_calls?:[{id,name,args}], tool_call_id?, name?}}`. IDs are deterministic: `${run}:user` is the task, `${run}:model:${turn}` a model reply, `${run}:tool:${turn}:${index}` a tool result. Tool results are JSON strings: `list_directory` -> `{entries:[{name,directory}]}` (the path is NOT in the result; it is in the matching AI `tool_calls[i].args.path`); `read_file` -> `{path,text,next_offset}`; `search_text` -> `{matches:[{path,line,text}]}`; write -> `{path,written:true,artifact_id}`; failure -> `{error,...}`; user rejection -> `{error:"Human rejected..."}`. Imported history uses `import:` IDs and has no run.

**Events** are `{seq, run_id, kind, data, created}`:
`run.queued {status}`, `run.status {status,error}`, `context.prepared|context.reduced` (metrics), `message.delta {message_id,text}`, `model.completed {turn,usage,tool_calls:[{name,id}],duration_ms}`, `tool.started {name,attempt_id}`, `tool.completed {name,attempt_id,duration_ms}`, `tool.denied {name,error_type}`, `approval.requested {approval_id,tool}`, `approval.decided {approval_id,decision}`. Events carry no tool arguments: resolve `attempt_id = run:tool:turn:i` to message `run:model:turn`, `tool_calls[i].args`. `subscribe(0)` replays the whole history on every connect, so the live-state reducer must ignore finished runs.

**Approvals.** ID `${run}:tool:${turn}:${i}:approval`. Statuses `pending | approve | reject | consumed` (`consumed` = file written). For writes `data` has `tool`, `arguments.path`, `arguments.content` (full new file), `diff` (difflib unified diff with `--- path`/`+++ path`, capped 64 KB), `diff_truncated`, `before_hash` (null = new file), `after_hash`, `size`. The snapshot strips `backup`, so the old file content is not available, only the diff context. In `ask` mode reads also need approval: `data = {tool, arguments}` with no diff, so the review pane needs a "wants to read" variant. After one rejection every later approval-requiring action in that run fails with `tool.denied`.

**Things the spec asks for that the API cannot do, and the honest fallback**
1. **Undo: not available.** No endpoint. The harness stores the old file as artifact `${key}:backup` (key = approval id minus `:approval`; also `${key}:result`). UI shows "Changed `README.md`" plus **"Save earlier version..."** via `exportArtifact`. NEVER say "Undo".
2. **Folder listing: not available.** The tree shows **what the helper has seen**, derived from tool calls and results (listed entries, files read, search hits, proposed and changed files). The empty state says so. Starter jobs are generic.
3. **Drag and drop a folder: not possible** (no `File.path`, preload can't change). Ship **Choose folder** only. `preventDefault` on dragover/drop so a dropped file does nothing.
4. **`handsoff` behaves like `balanced`.** Offer two permission choices: `ask` ("Asks before every step") and `balanced` ("Reads freely, asks before changing"). Display `handsoff` as `balanced`.
5. **A helper isn't stored with a folder.** Bots have no `workspace_id`, only conversations do. A helper's folder = workspace of its most recent conversation. `createHelper` creates a conversation immediately so the binding is saved. Switching folders is a localStorage preference (`notbot-helper-folder`, a JSON `Record<botId, workspaceId>`); the next task opens a new conversation there.
6. **Not supported at all:** deleting helpers/conversations/folders; a "model configured" flag (snapshot always reports a model and URL, defaulting to `llama3.2:3b` on Ollama, so detection = call discover and check the model is in the list); side-by-side before/after (show a unified diff plus a full "after" view from `arguments.content`).
7. **Diff quirk.** difflib output loses the line break when a file has no trailing newline, so `-` and `+` lines can merge. The parser must tolerate this; for a new file whose diff looks wrong fall back to `newFileDiff(path, content)`.
8. Main-process errors say "Retry startup in Settings". `friendlyError` must strip that clause.
9. `tsconfig.json` doesn't include `e2e/`: add `"e2e","playwright.config.ts"` to `include` (WP5).
10. No jsdom: unit tests cover pure modules only (vitest, no DOM).

## 2. Contracts

### Edits to existing files (WP2 owns api.ts, useNotbot.ts; WP1 owns theme.ts, main.tsx, index.html, src/main/index.ts)

**api.ts**: add `RunStatus`, `ToolCall {id;name;args:Record<string,unknown>}`, `ModelInfo {id}`. `Message.data.content: string | {type:string;text?:string}[]`, plus `name?`. `Run` gains `workspace_id, bot_id, created, turns, model, answer?:string|null, error?:string|null`. `Approval.status: 'pending'|'approve'|'reject'|'consumed'`; `data` gains `diff_truncated?`, `before_hash?:string|null`, `arguments:{path?;content?;query?;[k:string]:unknown}`. `Artifact` gains `run_id:string|null` and `created`. `Conversation` gains `created?` and `historical?`. Exports `OLLAMA_URL='http://127.0.0.1:11434/v1'`, `LMSTUDIO_URL='http://127.0.0.1:1234/v1'`, `messageText(m:Message):string`. `friendlyError` also strips " in Settings" clauses. Delete `chatTitle`.

**useNotbot.ts** returns exactly (`Notbot = ReturnType<typeof useNotbot>`):
```ts
{ snapshot: Snapshot; phase: 'starting'|'failed'|'ready'; startupError: string;
  notice: string; clearNotice(): void; busy: boolean;
  streams: Record<string,{run:string;text:string}>; live: LiveMap;
  helpers: HelperView[]; reviewQueue: ReviewItem[]; model: ModelState;
  retryStartup(): Promise<void>;
  checkModel(): Promise<ModelState>;            // try saved URL, then Ollama, then LM Studio; auto-PUT config if no run active
  discoverModels(baseUrl: string): Promise<string[]>; // throws Error(friendly)
  saveModel(baseUrl: string, model: string): Promise<boolean>;
  pickFolder(): Promise<Workspace|undefined>;
  createHelper(purpose: string, workspaceId: string, name?: string): Promise<Bot|undefined>; // POST bot (generateBotName) + POST conversation
  updateHelper(bot: Bot): Promise<boolean>;
  setHelperFolder(botId: string, workspaceId: string): void;
  startTask(botId: string, task: string, key: string, opts?: {fresh?: boolean}): Promise<Run|undefined>;
  runAction(runId: string, action: 'pause'|'resume'|'cancel'): Promise<boolean>;
  decide(approvalId: string, decision: 'approve'|'reject'): Promise<boolean>;
  readArtifact(id: string): Promise<string>; exportArtifact(id: string): Promise<boolean>; }
type ModelState = { status:'checking'|'ready'|'no-server'|'no-models'|'missing-model';
  baseUrl:string; model:string; models:string[]; message:string };
```
Remove global `workspaceId`/`chooseWorkspace`. Events feed `reduceLive` plus the existing deltas/refresh logic. `checkModel` runs once when phase becomes `ready`. `checkModel` must not PUT while a run is active. `startTask` reuses the helper's current conversation unless `opts.fresh` or the folder changed; passes the idempotency key through.

**theme.ts**: add `useThemeChoice(): [ThemeChoice,(c:ThemeChoice)=>void]`.
**main.tsx**: import `./styles/tokens.css` and `./styles/base.css` (not `styles.css`); the no-runtime fallback uses `.nb-fallback`.
**index.html**: title "Notbot"; add CSP meta `default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'`.
**src/main/index.ts**: `backgroundColor = nativeTheme.shouldUseDarkColors ? '#121519' : '#F4EFE6'`, updated on `nativeTheme.on('updated')`; `minWidth 1240`, `minHeight 760`, size 1440x920; `titleBarStyle:'hiddenInset'` on darwin only.

### Pure modules (`lib/`, each with `*.test.ts`, vitest, no DOM) - WP2
- **lib/status.ts**: `runStatusLabel(s:RunStatus):string` = queued "Waiting its turn", running "Working", waiting "Waiting for you", paused "Paused", completed "Done", failed "Didn't finish", cancelled "Stopped", needs_review "Needs a fresh start". `helperStateLabel(s:HelperState)`, `dotState(s:HelperState|RunStatus):DotState`, `toolPhrase(name,args,tense:'live'|'past'|'request')` e.g. "Reading README.md..." / "Read README.md" / "Wants to read README.md"; for `.`: "Looked around the folder"; "Searched for "x""; "Wants to change X" / "Changed X"; "Checked its notes"; "Wants to save a note"; unknown -> "Used a tool". `explainError(msg):{title;next}` covering model server down, turn budget, time budget, approval expired, file changed, queue full, active run exists, bot disabled, else generic. `PERMISSIONS: {value:'ask'|'balanced';title;detail}[]`, `permissionSummary(s:Safety):string`.
- **lib/diff.ts**: `interface DiffLine{kind:'add'|'del'|'ctx';text;oldNo:number|null;newNo:number|null}`, `DiffHunk{header;lines}`, `ParsedDiff{path;hunks;added;removed;isNew;truncated}`, `parseDiff(diff,opts?:{isNew?;truncated?}):ParsedDiff`, `newFileDiff(path,content):ParsedDiff`.
- **lib/trail.ts**:
```ts
type TrailStep =
 |{kind:'tool';id:string;tool:string;label:string;paths:string[];state:'running'|'done'|'error'}
 |{kind:'review';id:string;approvalId:string;tool:string;path:string|null;state:'pending'|'applying'|'applied'|'rejected'|'expired';backupArtifactId:string|null}
 |{kind:'note';id:string;text:string}
 |{kind:'end';id:string;tone:'done'|'stopped'|'failed';text:string};
interface TaskView{id:string;run:Run|null;task:string;steps:TrailStep[];answer:string;streaming:boolean;changed:string[];started:number;answerArtifactId:string|null}
deriveTasks(conversations,runs,approvals,artifacts,streams):TaskView[] // oldest first
interface LiveStatus{runId:string;phase:'thinking'|'tool'|'answering';tool?:string;attemptId?:string;updated:number}
type LiveMap=Record<string,LiveStatus>;
reduceLive(map:LiveMap,e:RuntimeEvent):LiveMap
liveLine(live:LiveStatus|undefined,run:Run,conversations):string // "Thinking...", "Reading x...", "Writing the answer...", "Waiting for you to review x"
toolCallForAttempt(conversations,attemptId):ToolCall|undefined
linkPaths(text,known:string[]):({kind:'text';text}|{kind:'path';path})[]
```
- **lib/tree.ts**: `interface TreeNode{name;path;dir:boolean;read:boolean;proposed:boolean;changed:boolean;children:TreeNode[]}`; `deriveTree(conversations,approvals):TreeNode` (root path `'.'`, directories first); `seenCount(t):number`.
- **lib/helpers.ts**: `type HelperState='idle'|'working'|'waiting'|'paused'|'done'|'failed'|'off'`; `interface HelperView{bot;workspace:Workspace|null;conversations;current:Conversation|null;runs;activeRun:Run|null;pending:Approval[];state:HelperState;outcome:string;updated:number}`; `interface ReviewItem{approval;run;bot;workspace:Workspace|null}`; `deriveHelpers(s:Snapshot,folderPrefs:Record<string,string>):HelperView[]` (order: waiting, working, then updated desc); `deriveReviewQueue(s):ReviewItem[]` (pending + run waiting + not expired, oldest first). Outcome e.g. "Updated 2 files · 1 waiting for you".
- **lib/keys.ts**: `isMac:boolean`; `modKey:'⌘'|'Ctrl'`; `isMod(e:{metaKey;ctrlKey}):boolean`; `isEditable(t:EventTarget|null):boolean`; `useShortcut(match:(e:KeyboardEvent)=>boolean,handler:(e:KeyboardEvent)=>void,enabled?:boolean):void`.

### UI kit (`ui/`, each component has its own `.css`; `ui/index.ts` re-exports all) - WP1
- `Button(props: ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary';tone?:'default'|'danger';icon?:LucideIcon;shortcut?:string[];loading?:boolean})`, defaults `type="button"`; `shortcut` renders `<Kbd>`.
- `IconButton(props: ButtonHTMLAttributes&{label:string;icon:LucideIcon;tone?:'default'|'danger'})` sets `aria-label` and `title`.
- `Dialog({open,onOpenChange,title,description?,size?:'sm'|'md'|'lg',footer?:ReactNode,children})` wraps Radix Root/Portal/Overlay/Content/Title/Description with a close IconButton.
- `StatusDot({state:DotState,label:string,size?:'sm'|'md'})`, `export type DotState='working'|'waiting'|'done'|'failed'|'paused'|'idle'`. `role="img"` with `aria-label`. working = pulsing ring (ink-2), waiting = solid accent dot, done = check, failed = x, paused = two bars, idle = hollow.
- `PathChip({path:string,state?:'seen'|'read'|'proposed'|'changed',onClick?:()=>void})` monospace, middle-truncated, full path in `title`.
- `HelperMark({name:string,size?:20|28|40})` + `ui/mark.ts`: `helperMark(name):{cells:boolean[];tone:1|2|3|4|5|6}`; FNV hash, 5x5 grid mirrored left-right (3 columns generated). `mark.test.ts`.
- `EmptyState({icon?:LucideIcon,title:string,body?:ReactNode,action?:ReactNode})`; `Kbd({keys:string[]})`.
- `Segmented<T extends string>({label,value,options:{value:T;label:string;detail?:string}[],onChange})` with `role="radiogroup"`.
- `Field({label,hint?,error?,children:(id:string,describedBy:string|undefined)=>ReactNode})`; also defines `.nb-input`, `.nb-textarea`, `.nb-select`.

### Shell, shelf, onboarding, dialogs - WP3
- `App.tsx`: holds `view:{kind:'shelf'}|{kind:'desk';botId:string}`, `dialog:'settings'|'helper'|'command'|'new'|null`, `focusApprovalId:string|null`. Phase not ready -> `StartupScreen`. No helpers -> `CreateHelper variant="first-run"`. Global Cmd/Ctrl+K opens the command bar. `export function App()` (default props none); `main.tsx` renders it.
- `shell/TitleBar({phase,model:ModelState,reviewCount:number,crumb?:string,onHome,onNextReview,onOpenCommand,onOpenSettings})`: status region (`role="status"`) with text exactly "Notbot is ready", "Starting Notbot..." or "Model unavailable"; `app-region: drag`, interactive children `no-drag`; pad for macOS traffic lights.
- `shell/StartupScreen({phase,error,onRetry})`; `shell/Notice({message,onDismiss})` with `role="alert"`.
- `shelf/ShelfView({helpers,onOpen(botId),onNewHelper()})`, `shelf/HelperCard({helper,onOpen})` (job, folder, state dot, outcome; waiting cards first).
- `onboarding/CreateHelper({nb:Notbot,variant:'first-run'|'dialog',initialPurpose?:string,onCreated(botId:string):void,onCancel?():void})`: one screen, three stacked steps: 1 Folder (**Choose folder**), 2 Model status (ModelSetup inline only on failure), 3 job textarea labelled **"What should this helper do?"** with generic starter chips, button **Create helper**. After create, `onCreated` -> desk opens and the first task starts (CreateHelper calls `nb.startTask(bot.id, purpose, crypto.randomUUID())`).
- `onboarding/ModelSetup({model:ModelState,onDiscover(url):Promise<string[]>,onSave(url,model):Promise<boolean>,onRetry():void})` (Ollama / LM Studio / Custom, model select, plain next steps: `ollama pull llama3.2:3b` / "Open LM Studio and start its server", **Try again**).
- `dialogs/SettingsDialog({open,onOpenChange,nb:Notbot,section?:'appearance'|'model'|'folders'})`: ONE scrolling dialog with stacked sections (Appearance: System/Light/Dark; Model; Folders), no tabs.
- `dialogs/HelperDialog({open,onOpenChange,helper:HelperView,workspaces:Workspace[],existingNames:string[],onSave(bot:Bot):Promise<boolean>,onChangeFolder(workspaceId:string):void,onAddFolder():Promise<Workspace|undefined>})` (name, job, folder, pause/enable; no delete).
- `dialogs/CommandBar({open,onOpenChange,helpers,onAsk(botId,text),onNewHelper(text),onOpenHelper(botId),onAddFolder(),onChangeModel(),onOpenSettings()})`: combobox + listbox, arrow keys.

### Desk - WP4
- `desk/Desk({nb:Notbot,helper:HelperView,focusApprovalId:string|null,onFocusApproval(id:string|null):void,onEditHelper():void})`: grid tree | trail | review. Review column only when a review item for this helper exists.
- `desk/BoundaryBadge({workspace,safety,onChangeSafety(s:Safety):void})`: text like "`docs/` · reads freely · asks before changing · on this Mac"; click opens a small Dialog with `Segmented` of `PERMISSIONS`.
- `desk/FolderTree({tree:TreeNode,folderName:string,folderPath:string})` with `role="tree"`; empty state explains it shows what the helper has seen.
- `desk/Trail({tasks,liveText,activeRun,knownPaths,focusApprovalId,onReview(id),onRunAction(runId,action),onExport(artifactId),onPreview(artifactId)})`: newest at the bottom, older tasks collapse into history, auto-scroll unless the user scrolled up.
- `desk/StatusLine({run,text,onStop,onPause,onResume})` with `aria-live="polite"`; Pause/Resume/Stop only where the status allows.
- `desk/Composer({helperName,disabled,disabledReason?,onSend(task,key):Promise<boolean>})`: Enter sends, Shift+Enter newline, idempotency key created per draft and reused on retry; textbox name **"Task"**, button **"Send"**.
- `desk/ReviewPane({item:ReviewItem,index:number,total:number,busy:boolean,onDecide(d:'approve'|'reject'):Promise<boolean>,onNext():void,onClose():void})`: buttons **"Apply change"** (⌘↵) and **"Reject change"** (⌘⌫, not when focus is in an editable field); read-type approvals use "Allow" / "Don't allow". After apply: "Applying...", then "Changed N files" with "Save earlier version...".
- `desk/DiffView({diff:ParsedDiff})` (old/new line numbers, add/del colours); `desk/ArtifactDialog({artifact:Artifact|null,onOpenChange,read(id):Promise<string>,onExport(id)})`.

## 3. Styling conventions and tokens (WP1 writes `styles/tokens.css`, `styles/base.css`; everyone follows)

**Class naming.** BEM with `nb-` prefix: `.nb-{block}`, `.nb-{block}__{element}`, `.nb-{block}--{modifier}`; block = kebab-cased component name. State via attributes (`[data-state="working"]`, `[aria-pressed="true"]`, `[data-open]`). Each `.css` file contains only its own block. Element selectors only in `base.css` reset or scoped under one block. Sibling spacing from `gap` only, never margins. Numbers in CSS come from `var(--nb-*)` tokens only (no hex or px literals outside tokens.css, except 0/1px borders handled by `--nb-border`).

**Theming.** Every colour defined once in `:root` with `light-dark()`. `:root{color-scheme:light dark}`, `[data-theme=light]{color-scheme:light}`, `[data-theme=dark]{color-scheme:dark}`. Shadows reference `--nb-shadow-color`.

**Colours "paper and verdigris" (light / dark)**
`--nb-paper #F4EFE6/#121519`; `--nb-surface #FBF8F3/#181C21`; `--nb-raised #FFFFFF/#1F242A`; `--nb-sunken #ECE6DA/#0E1114`; `--nb-line #DDD5C7/#2A3038`; `--nb-line-strong #C9BFAE/#3A424C`; `--nb-ink #1E1A15/#ECE7DD`; `--nb-ink-2 #4D463C/#B9B2A6`; `--nb-ink-3 #6B6256/#8E877C`; `--nb-accent #0E6B5E/#4CC2A8`; `--nb-accent-hover #0A5A4F/#66D0B8`; `--nb-accent-active #084A41/#3AAE95`; `--nb-accent-ink #FFFFFF/#0B1F1B`; `--nb-accent-soft #DCEDE8/#16332E`; `--nb-accent-text #0B5C51/#6FD3BC`; `--nb-danger #A8321C/#F08A70`; `--nb-danger-soft #F6E0D9/#3A1F19`; `--nb-add-bg #E2F0E3/#173126`; `--nb-add-ink #1D5A2C/#9FE0B0`; `--nb-del-bg #F7E1DC/#3A1E1C`; `--nb-del-ink #8A2A17/#F3A99A`; `--nb-gutter #EEE8DD/#171B20`; `--nb-hover rgba(30,26,21,.05)/rgba(236,231,221,.06)`; `--nb-pressed rgba(30,26,21,.09)/rgba(236,231,221,.10)`; `--nb-focus` = accent; `--nb-shadow-color rgba(30,26,21,.10)/rgba(0,0,0,.45)`.
Helper mark tones `--nb-mark-1..6` (light/dark): clay `#B5694A/#D58A6B`, ochre `#A9812A/#D4AE55`, sage `#6E8B5B/#97B585`, slate `#50708A/#86A5BF`, plum `#7E5A7E/#B08AB0`, teal `#3E7D78/#72B0AA`.
Accent is reserved for primary actions, Apply, "waiting for you" dots and the review count. Working dots use ink-2.

**Scales.** Spacing `--nb-space-1..` 4, 8, 12, 16, 20, 24, then `-8` 32, `-10` 40, `-12` 48, `-16` 64 (names: `--nb-space-1`=4px, `-2`=8, `-3`=12, `-4`=16, `-5`=20, `-6`=24, `-8`=32, `-10`=40, `-12`=48, `-16`=64). Type: `--nb-font` Inter with `font-feature-settings:'cv11','ss03'`; `--nb-mono: ui-monospace,"SF Mono",Menlo,Consolas,monospace`; sizes/leading `--nb-text-xs` 11/16, `-sm` 12.5/18, `-base` 14/20, `-md` 15/22, `-lg` 18/26, `-xl` 22/30, `-2xl` 30/38 (weight 600, tracking -0.02em, desk and shelf headings), each with `--nb-leading-*`; weights `--nb-weight-regular` 400, `-medium` 500, `-strong` 600. Radii `--nb-radius-sm` 6px, `-md` 8, `-lg` 12, `-xl` 16, `-pill` 999px. Shadows `--nb-shadow-1: 0 1px 2px var(--nb-shadow-color)`, `-2: 0 1px 2px var(--nb-shadow-color), 0 6px 16px var(--nb-shadow-color)`, `-3: 0 2px 6px var(--nb-shadow-color), 0 24px 56px var(--nb-shadow-color)`, `--nb-ring: 0 0 0 2px var(--nb-paper), 0 0 0 4px var(--nb-focus)`. Motion `--nb-dur-fast` 120ms, `--nb-dur` 180ms, `--nb-dur-slow` 280ms, `--nb-ease cubic-bezier(.2,.7,.2,1)`; all durations 0ms and no pulse under `prefers-reduced-motion`. Z-index `--nb-z-raised` 10, `-pane` 20, `-titlebar` 30, `-overlay` 100, `-dialog` 110, `-notice` 120. Layout `--nb-control-h` 32px (every button; icon buttons 32x32), `--nb-titlebar-h` 44px, `--nb-tree-w` 248px, `--nb-review-w` 480px, `--nb-trail-max` 760px, `--nb-border: 1px solid var(--nb-line)`.

**Buttons.** primary: accent bg, hover/active use accent-hover/active. secondary: raised bg, `--nb-border`, `--nb-hover` on hover. danger tone: danger text and border. All: focus-visible uses `--nb-ring`; disabled 45% opacity + `cursor:not-allowed`; never a 2px outline.

## 4. Work packages (no two agents edit the same file)
- **WP1 Foundations**: `styles/tokens.css`, `styles/base.css`, all `ui/*` (+ `mark.ts`, `mark.test.ts`), `main.tsx`, `index.html`, `theme.ts`, `src/main/index.ts`, `docs/DESIGN.md` (tokens, buttons, shortcuts; WP5 adds the screen map).
- **WP2 Logic**: `api.ts`, `useNotbot.ts`, `lib/*.ts` with tests. Leave `bots.ts` alone. Imports only the `DotState` type from `ui/StatusDot`.
- **WP3 Shell**: `App.tsx`/`App.css`, `shell/*`, `shelf/*`, `onboarding/*`, `dialogs/*`. Imports `desk/Desk`.
- **WP4 Desk**: `desk/*`.
- **WP5 Integration (sequential)**: fix contract mismatches; delete leftover `styles.css`; `npm uninstall three @react-three/fiber @types/three @fontsource/pixelify-sans recharts @xyflow/react react-router-dom @tanstack/react-query tailwindcss @tailwindcss/vite zustand @antithesishq/bombadil motion`; add `e2e` to tsconfig include; rewrite both e2e specs (wait for "Notbot is ready"; stub the folder picker with `app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]})}, ws)`; fill "What should this helper do?", click "Create helper", fill "Task", click "Send"; "Apply change"/"Reject change"; skip when no model reachable); Playwright Electron screenshots in `verification/redesign/`; finish `docs/DESIGN.md`; run typecheck, lint, test, build.

## 5. Review checkpoints
Contract drift (typecheck first); event replay from seq 0 must not show ghost "working"; composer disabled during an active run and no model-config PUT during a run; grep UI for "Undo"/"undo", "delete", "automation", "shell" (must not be claimed); `handsoff` never offered, displayed as balanced; AA contrast in both themes, visible focus, Cmd+Backspace never fires in text fields; no hex/px literals or sibling margins or bare element selectors in component CSS; macOS `hiddenInset` padding and `no-drag` buttons; diff parser handles a file with no trailing newline.

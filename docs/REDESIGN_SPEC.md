# Notbot redesign spec

## 1. Scope
Redesign the renderer of **Notbot** (Electron + React) from scratch.

**Change:** everything in `src/renderer`, `src/renderer/index.html`, window settings in `src/main/index.ts` (background follows system theme), `package.json` dependencies, `e2e/*.spec.ts`.
**Do not change:** `harness/`, `src/preload/index.ts`, `src/main/runtime.ts` IPC handlers, `src/shared/runtime.ts`, the harness API. Use existing endpoints only: `/snapshot`, `/models/discover`, `/models/config`, `/workspaces`, `/bots`, `/conversations`, `/runs`, `/runs/{id}/{pause|resume|cancel}`, `/approvals/{id}`, `/artifacts`, `/artifacts/{id}`, and the event stream (`window.notbotRuntime.subscribe`). If the design needs something the API lacks, say so; do not fake it.

The demo mode, mock data, setup wizard, game, machines UI and old styles are already deleted. The renderer is Electron-only. A backup of the old code is in the scratchpad (`notbot-before-redesign.tgz`); do not restore from it.

Already written and reusable: `src/renderer/api.ts` (types, `request`, `chatTitle`, `folderName`, `friendlyError`), `theme.ts`, `bots.ts` (`generateBotName`), `useNotbot.ts` (runtime state hook), `main.tsx`. They may be edited.

## 2. What Notbot is
A local, privacy-first AI agent app. The user creates small single-purpose helpers ("bots"). Each helper works inside one folder the user chooses, using a local model served by Ollama or LM Studio. Nothing leaves the machine. The Python harness starts and stops with the app; there is no server, URL or token for the user to handle.

## 3. Tasks it accomplishes
1. Reads and understands a folder: list directories, read text files, search text, all bounded. Cites file paths.
2. Proposes edits that the user approves. Never writes by itself. Every write is a diff with Apply or Reject. The harness backs files up.
3. Runs tasks and conversations. Each message starts a run, which can be paused, resumed or cancelled. Answers stream in.
4. Keeps results: artifacts can be previewed and exported. Run history is durable.

Not supported; the UI must never imply otherwise: shell commands, computer control, scheduled automations, remote workers, deleting conversations.

## 4. What the user must be able to do
- Go from first launch to a working helper with a task running in about a minute; no wizard, no jargon.
- Create a helper by describing its job in one sentence. The name is generated and can be changed.
- Watch what a helper is doing live, stop it, and see which files it looked at.
- Review a proposed change where it appears, with a readable diff and two clear choices.
- Change the model, add or switch folders, and rename, pause or edit a helper.
- Always know whether Notbot is ready, starting or broken, and how to fix it.

## 5. Why the old design failed (fix all of it)
Two apps in one (real UI plus mock demo); setup hidden in Settings with an unhelpful error; ten settings tabs full of developer views (raw JSON, SHA-256, tool-call IDs); approvals buried in Settings; four inconsistent button styles with invisible dark-mode hover and heavy 2px black outlines in light mode; bare element selectors leaking across the UI, duplicate rules, hand-set margins; no design tokens; weak chat (no distinction between speakers, no thinking state, no auto-scroll, no empty/loading states); developer language (`queued`, `waiting`, "model turns"); and a generic chat-list layout that could be any AI app.

## 6. Design direction
### The idea
Most AI apps are organised around a conversation with a model. Notbot is organised around **trust and a folder**: each helper is bound to one folder and one job, it is local, it can see everything but changes nothing without approval. Build the UI around **the work and the boundary**, not a chat thread: "a small colleague working at a desk you can see".

### Principles
1. **Show the boundary.** Always show what the helper can see (folder), what it can do (reads freely, changes only with approval) and that it runs on this machine.
2. **Show the work, not just the words.** A live activity trail: "Looked in docs/", "Read README.md", "Wants to change README.md". Files are chips. The written answer ends the trail.
3. **The diff is the hero.** Review is like a good code-review screen: before/after, changed lines clearly marked, keyboard shortcuts, and "Changed N files" after Apply.
4. **Start from intent, not configuration.** No wizard, no settings dive.
5. **Calm and quiet.** No mascot animation, hype or gradients. Motion only shows something happening or changing and honours reduced motion.

### Model: helpers live in folders
- **Home is a shelf of helpers** as cards: job, folder, state (idle, working, waiting for you, done), latest outcome ("Updated 2 files · 1 waiting for you"). Anything needing the user rises to the top.
- **A helper's desk** has three zones: left **folder tree** (files read are marked, files to be changed highlighted), centre **trail and conversation** with a composer anchored at the bottom, right **review pane** that slides in only when a change is proposed.
- **Tasks, not endless chat.** A run is a task with a start and finish. Past tasks appear as simple history under the helper. Follow-ups are still possible.

### First run: zero setup screens
1. Drop a folder onto the window, or click **Choose folder** (native picker; already allows New Folder).
2. Detect Ollama (127.0.0.1:11434) or LM Studio (127.0.0.1:1234) automatically via `/models/discover` and pick a model. Show model settings only on failure, with a plain explanation, the exact next step, and **Try again**.
3. Offer starter jobs based on the folder contents (read it through the harness only if an API exists; otherwise offer generic starters) or let the user type their own sentence.
4. Create the helper (auto-named), open its desk, start the first task.

### Signature interactions
- **Cmd/Ctrl+K command bar**: type an intent; pick or create a helper; switch helper; add folder; change model.
- **Boundary badge** at the top of every desk, e.g. `docs/ · reads freely · asks before changing · on this Mac`; clicking opens the permission choice in plain words (maps to `ask`, `balanced`, `handsoff`).
- **Review queue**: quiet count in the title bar that jumps to the next item needing review.
- **Live status line** ("Reading package.json…") with Stop, instead of spinners.
- **Keyboard first**: Cmd/Ctrl+Enter applies, Cmd/Ctrl+Backspace rejects, Enter sends, Shift+Enter newline. Show hints in the UI.
- Undo after Apply only if the harness API supports it; otherwise show "Applied" with the file list and do not claim undo.

### Visual language
- Warm, paper-like neutrals in light; deep ink (not pure black) in dark. **One** confident accent colour used only for "act on this" (Apply, primary action, waiting for you). No blue-to-purple gradients, no sparkles.
- A refined sans (Inter) for the interface; **monospace for paths, filenames and diffs**.
- Soft layered shadows, hairline borders, generous spacing; no 2px outlines.
- Status through shape and colour together: animated dot working, solid accent dot waiting, check done, clear icon failed.
- A small generated mark per helper (from its name) instead of a mascot. No three.js.
- Dark and light are both first-class; follow the system by default with an override in Settings. Define every state in both.

### Anti-goals
- A left list of chats beside a big text box. Chat bubbles, purple gradients, sparkles, "How can I help you today?". Settings as a list of tabs. Raw statuses, IDs, hashes or JSON in the main experience.

### Test for every screen
If you removed the Notbot name and the screen could belong to any other AI app, redesign it. Each screen must make the folder, the boundary or the review moment visible.

## 7. Engineering requirements
- **Tokens first.** One tokens file: colour (light and dark), 4px spacing scale, type scale, radii, shadows, motion durations, z-index. No hard-coded colours or sizes in components.
- **Exactly three button variants**: primary, secondary, icon-only. Each defines default, hover, active, focus-visible, disabled; same height, padding, radius rules. Destructive = secondary with danger accent and confirmation.
- **Layout with CSS grid and flex `gap`.** No hand-set margins between sibling buttons.
- **Scoped styles only.** No bare element selectors (other than the reset), no duplicate rules.
- **Accessibility**: WCAG AA contrast in both themes, visible focus rings, full keyboard operation, correct roles and labels, `prefers-reduced-motion` honoured.
- **States**: designed empty, loading and error states for every list and screen. Errors say what happened and what to do next. Handle runtime starting, startup failure with Retry, model server unavailable.
- **Components**: Radix Dialog for dialogs, Lucide icons, Inter via @fontsource plus a system monospace stack. Small component set.
- **Logic** stays in `useNotbot`; components are presentational. Preserve idempotency keys on run submit, stream message deltas, refresh on runtime events.
- **Dependencies**: remove what is unused (`three`, `@react-three/fiber`, `@types/three`, `@fontsource/pixelify-sans`, `recharts`, `@xyflow/react`, `react-router-dom`, `@tanstack/react-query`, `tailwindcss`, `@tailwindcss/vite`, `zustand`, `@antithesishq/bombadil`, and `motion` unless genuinely used). Keep `package-lock.json` in sync via `npm uninstall`.
- **Window**: background colour follows the system theme (`nativeTheme`), minimum size suits the three-zone layout.

## 8. Deliverables and checks
1. A short design note in `docs/DESIGN.md`: screen map, tokens, button states, shortcuts.
2. The rebuilt renderer, split into small components.
3. Tests: unit tests for bot-name generator and for pure helpers (status to plain language, diff parsing); updated `e2e/harness.spec.ts` and `e2e/embedded.spec.ts` following the new UI (they need a real local model, so they may be skipped when unavailable, but must typecheck).
4. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.
5. Screenshots (via Playwright Electron) of: first run, shelf, desk, approval review, settings, startup failure; light and dark. Use them to find and fix spacing, alignment and hover issues.

Do not invent behaviour the harness does not have. Report any API limit that constrains the design.

# Harness verification — 18 November 2026

Status: implemented single-host production candidate; not yet approved for production deployment.

## Automatic model setup revision

Selecting Ollama or LM Studio now sets its default local base URL and automatically discovers available models; opening Models also discovers the saved endpoint. A dropdown replaces manual model ID entry. Discovery is debounced for edited addresses, ignores stale responses, preserves a still-available selected model on refresh, deduplicates IDs and disables saving for empty/offline results. The custom address option remains available. Changes are persisted only after Save.

Executed Electron coverage verifies provider defaults, automatic HTTP discovery, a delayed response from a previous address, empty and offline responses, refresh, and saved selection restoration. A controlled HTTP fixture tests these states; it is not a real LM Studio inference test. The repackaged macOS app passed automatic discovery against the running Ollama server, selected its real model and completed the existing tool-call smoke test. Screenshot: ../verification/automatic-model-setup.png. TypeScript, ESLint and the application build passed.

## Built-in desktop runtime revision

Electron now launches and authenticates its own local harness automatically. There is no desktop demo switch, service URL or token entry. Settings offers local model presets, discovery against the currently entered address and inline connection errors. The legacy renderer remains available only as a browser development preview. Existing standalone CLI commands remain developer tools.

The packaged macOS arm64 app includes a roughly 55 MiB PyInstaller directory bundle containing Python and dependencies. It starts with an empty executable search path, discovers Ollama models, saves the chosen model, executes a real structured directory-listing tool call and restores its data after reload. Development launches use uv; packaged launches use the embedded executable directly. Each app profile owns one process and private state directory. Startup waits for authenticated health; graceful shutdown closes event streams and the child stdin pipe, with a bounded forced-stop fallback. Parent EOF is also tested independently against source and frozen runtimes.

The revised native tests cover automatic startup, no manual credential prompt, workspace and bot setup, Settings, real read/approve/reject workflows, model preset/error/discovery behavior, packaged inference and persistence. The old UI test results below are historical checks of the preserved browser preview.

A small model occasionally generated invalid numeric arguments in the packaged read fixture. Those calls were rejected by strict validation. The packaged smoke test uses a directory listing with a string path and verifies the actual tool-completion event. Source-mode read/approve/reject acceptance also passed. Successful smoke tests do not establish general model reliability.

Packaging and process lifecycle have been executed on macOS arm64 only. CI now builds the frozen bundle before running lifecycle tests on each configured OS, but that is not evidence those remote CI jobs have passed. Signing/notarization, Windows validation, soak profiling and the dependency findings below remain release gates.

## Implemented scope

LangGraph model/tool execution with SQLite checkpoints, queued runs, request idempotency, per-conversation exclusion, cancellation, pause/resume, turn/time budgets, structured tool validation, approved text edits, recoverable write intent, Markdown memory retrieval, full artifacts, bounded context and authenticated REST/SSE. Electron uses a narrow preload bridge and main-process networking; its internal credential stays in the private state directory and never crosses preload. Browser preview workflows remain separate.

The runtime calls an existing OpenAI-compatible model server. It does not download models, host inference, execute arbitrary generated text, or silently switch models.

## Executed checks

| Check                            | Observed result                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Python deterministic suite       | 23 passed; 6 opt-in inference tests skipped                                                                               |
| Ruff lint and format             | Passed                                                                                                                    |
| Python dependency audit          | No known vulnerabilities after updating filelock                                                                          |
| Frontend unit tests              | 85 passed across 8 files with Vitest 5.1.0                                                                                |
| TypeScript and ESLint            | Passed                                                                                                                    |
| Electron production build        | Passed                                                                                                                    |
| Existing browser UI regressions  | 20 passed, including setup, settings, bots, machines, sidebar, transitions and reduced motion                             |
| Existing Electron workspace test | Passed on Electron 45.3.4                                                                                                 |
| Managed Electron test            | Passed: real file read, streamed response, activity events, reviewed approval, rejected edit, persisted data after reload |
| Unsigned macOS arm64 package     | Built and launched; isolated profile and embedded runtime and preload bridge verified                                     |
| Bombadil exploration             | 30 seconds, 415 trace records, zero reported default property violations                                                  |

The Python tests cover model/tool loops, idempotency, approval expiry/rejection, stale targets, interrupted write reconciliation, cancellation, shutdown/restart, context bounds and tool pairing, path restrictions, special files, provider cancellation cleanup, API authentication/import limits, and offline SQLite backup integrity with token exclusion. Recovery tests exercise selected interruption boundaries, not arbitrary power-loss guarantees.

Browser regressions exercise the preserved demo UI. Bombadil explored the renderer at one URL; it does not prove every product action works. Connected native behavior is covered by the explicit Electron test.

Reproduce using the commands in README.md. Browser tests additionally require a renderer server at port 5181 and the Chrome executable configured in those existing specs.

## Real model acceptance

Ollama was already running with installed models. Tests used temporary workspaces only.

| Model                                       | Read and cite fixture | Approve exact write | Reject write      |
| ------------------------------------------- | --------------------- | ------------------- | ----------------- |
| llama3.2:3b                                 | Passed                | Passed              | Passed            |
| qwen2.5-coder:7b, installed server/template | Failed acceptance     | Failed acceptance   | Failed acceptance |

The latest isolated llama3.2 run took 8.30 seconds for reading, 1.41 seconds for approval, and 1.21 seconds for rejection, with two model turns each. These are individual observations with mixed warm/cache conditions, not comparable performance benchmarks.

The installed Qwen setup emitted a JSON tool description in ordinary assistant text instead of a structured tool call. The adapter rejects that response and never executes it. This is a compatibility failure of this tested setup; no claim is made about all Qwen deployments. Reconfigure its server/template and rerun acceptance before selecting it for tool tasks. The full opt-in model suite intentionally exposes these failures.

## Resource observation

The unsigned packaged application, fresh profile, first-run setup idle after five seconds, reported working sets of 181600 KiB (browser), 95408 KiB (GPU process), 48592 KiB (utility), and 139312 KiB (renderer). See ../verification/packaged-runtime-metrics.json. RSS can include shared pages; do not interpret their sum as unique physical memory. This excludes inference-server memory and is a single sample, not proof of sustained CPU, FPS or memory behavior.

Model concurrency is one. Per-frame avatar animation remains outside React state. Long-duration idle/active profiling, GPU timing, database growth and constrained Windows GPU behavior still need measurement.

## Dependency findings

Electron was upgraded from 35 to 45.3.4, Vitest to 5.1.0, Vite to 6.4.6, electron-builder to 26.18.0 and typescript-eslint to 8.73.0. All application checks above ran with the upgraded direct dependencies. Python filelock was upgraded to 4.2.12.

The recorded npm audit still reports 19 affected dependency entries (14 high, 5 moderate, zero critical), propagated from picomatch and minimatch. Picomatch 4.0.7 is the latest version returned by the registry in this session and is still flagged. Some builder dependencies use affected older minimatch majors. Do not force unrelated major overrides or downgrade tools merely to make audit output clean. Resolve or formally assess these findings before distribution. The detailed snapshot is ../verification/npm-runtime-audit.json.

The compatible automatic npm audit fix failed inside npm's dependency resolver with an edgesOut error. No forced audit fix was applied. There is no claim that the JavaScript dependency tree is vulnerability-free.

## Remaining release gates

- Execute the configured Linux/macOS/Windows CI matrix and test the Windows deployment on the intended Razer host. CI configuration alone is not a passing CI run.
- Run sustained workloads and controlled process-kill/restart tests, including during file replacement, model streaming and pending approvals.
- Test HTTPS reverse-proxy deployment, Windows ACLs, backup restoration and token rotation under the deployment account.
- Resolve/assess npm audit findings, provide application icon/release metadata, and sign/notarize distributable builds. This session verified an unsigned local package only.
- Validate each model/server combination for structured tool calls, context size, cancellation and malformed output before enabling it.
- Add pagination/retention before large history deployments: the initial snapshot returns retained records and the Electron client limits response size to 8 MiB.
- Treat workspace path checks as application controls, not an operating-system sandbox. Local hostile filesystem races and stalled network filesystems need stronger isolation.

Remote worker scheduling, shell/browser/computer execution, messaging integrations, multi-agent delegation, autonomous skill promotion and Laya are not implemented in this release. Connected capabilities report those limits; corresponding demo screens remain simulations.

## Source map

- notbot_harness/config.py: validated environment and private state paths.
- domain.py and messages.py: validated inputs and LangChain message types.
- provider.py: streamed compatible model adapter and transport lifecycle.
- context.py: policy, history grouping, context accounting and historical digest.
- storage.py: application database, events, attempts, approvals and artifacts.
- tools.py: workspace operations, memory and reviewed atomic text replacement.
- engine.py: LangGraph execution, queue, checkpoints and lifecycle controls.
- api.py: authenticated versioned API and event stream.
- **main**.py: service, terminal client and offline backup.
- ../src/main/runtime.ts and ../src/preload/index.ts: Electron transport boundary.
- ../src/renderer/RuntimeRoot.tsx: connected interface and explicit demo switch.

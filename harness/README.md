# Notbot harness

A single-host LangGraph execution service, with LangChain model integration, durable SQLite runs, approved workspace edits, a Markdown memory vault and an authenticated Electron client.

This is a first production candidate. Windows deployment, long-duration soak testing and additional model templates must be validated before calling a deployment production-ready. See `RELEASE_CHECKS.md` for measured results and limits.

## Built into the desktop app

Launch Notbot normally. Electron starts a private local harness, waits for it to become ready, and authenticates automatically. No token, manual service command or demo switch appears in the desktop app. Closing Electron closes the parent pipe and shuts down Uvicorn and the execution engine. A failed startup shows recovery controls without substituting simulated responses.

A packaged application includes a PyInstaller directory bundle with Python and dependencies. Users do not need Python or uv. Source development requires uv: run `uv sync --directory harness --locked` once and then `npm run dev`. Packaging runs `npm run build:harness` automatically and includes its output using Electron extraResources. Build on each target OS/architecture.

Settings → Models provides Ollama (`http://127.0.0.1:11434/v1`) and LM Studio (`http://127.0.0.1:1234/v1`) presets. Start the provider's local server and choose its provider in Settings. Notbot fills the usual local URL and discovers models automatically, including when the page opens. Select a detected model from the dropdown and save. Custom addresses remain available, and Refresh models checks for changes without discarding a still-available selection. Discovery checks the address currently entered, without changing saved configuration. Notbot does not download or silently switch models. Models must support structured tool calls.

The model-server address is resolved on this device. Model inference is separate from the integrated agent runtime. A model-server key, if needed, uses `NOTBOT_MODEL_KEY`; the internal desktop credential is unrelated and never exposed through preload.

Desktop state is stored in Electron's user-data directory, with internal authentication retained on disk under private directory permissions. The default macOS path matches the previous standalone harness location. Custom standalone state directories are separate; do not run a standalone process against the same directory while Electron owns it. The desktop uses an ephemeral loopback port, not fixed port 8787, and does not read the old manually saved connection file.

## Standalone developer service

The independent terminal service remains available for debugging and future host deployment. It is not required for the desktop app:

```bash
uv run --directory harness python -m notbot_harness serve
```

Standalone mode defaults to port 8787 and uses its own bearer token, available with `uv run --directory harness python -m notbot_harness token`. The CLI below targets this standalone service; it does not auto-discover the private desktop port. Keep credentials out of source control and URLs.

## Terminal client

All commands below run through `uv run --directory harness python -m notbot_harness`:

```text
config                          Show nonsecret settings
health                          Check the authenticated service
models                          Discover actual model IDs
workspace /path --name Project  Register an execution workspace
bot Pip "Inspect project files" Create a bot
conversation BOT_ID WORKSPACE_ID
run CONVERSATION_ID "Read README.md and explain this project"
runs                            Show run status
approvals                       Show pending and historical approvals
decide APPROVAL_ID approve       Approve the exact proposal (or reject)
control RUN_ID cancel            Also supports pause and resume
backup /new/private/backup       Stop the service first
```

A run may be queued, running, waiting, paused, completed, failed, cancelled or needs_review. Approval waiting does not consume the active execution budget. If a file changes after approval was requested, the runtime does not overwrite it. Cancel that run and request a fresh edit.

## Configuration

Environment settings use the `NOTBOT_` prefix:

| Variable                       | Default                                             |
| ------------------------------ | --------------------------------------------------- |
| DATA_DIR                       | OS application-data directory for `notbot`          |
| HOST / PORT                    | `127.0.0.1` / `8787`                                |
| MODEL_URL                      | `http://127.0.0.1:11434/v1`                         |
| MODEL                          | `llama3.2:3b`                                       |
| MODEL_KEY                      | `ollama` (placeholder for local compatible servers) |
| CONTEXT_TOKENS / OUTPUT_TOKENS | 8192 / 1024                                         |
| MAX_TURNS / MAX_ACTIVE_SECONDS | 8 / 300                                             |
| REQUEST_TIMEOUT / QUEUE_LIMIT  | 60 seconds / 100                                    |
| REMOTE_TLS                     | false                                               |

A model endpoint chosen through the API is saved in the application database. Credentials remain in environment configuration; never send model API keys to the renderer. Restart after changing environment values. The service does not load models itself or assume advertised model context sizes fit a GPU. Configure the model server's KV-cache/context allocation separately.

## Windows / Razer Blade deployment

Install Python 3.12+, uv and a model server. Copy/clone this repository onto the Windows host and run the same sync and serve commands in PowerShell. For an interactive development session:

```powershell
$env:NOTBOT_DATA_DIR = "$env:LOCALAPPDATA\notbot"
$env:NOTBOT_MODEL_URL = 'http://127.0.0.1:11434/v1'
uv run --directory harness python -m notbot_harness serve
```

Use Task Scheduler or a process supervisor under a dedicated standard user for persistent operation. Configure recovery/restart and a fixed working directory. Restrict the state directory, environment credentials and workspaces to that user with Windows ACLs. POSIX chmod is not a replacement for Windows ACL configuration.

For a remote Mac client, put the Windows service behind an HTTPS reverse proxy with a trusted certificate. Only that proxy may reach the service listener. Enabling `NOTBOT_REMOTE_TLS=true` permits non-loopback binding but **does not itself provide TLS**. Retain bearer authentication and firewall restrictions. The Electron client refuses remote plain HTTP. Multi-machine pairing, mTLS workers and automatic scheduling are not implemented.

## Tools and recovery

Available tools: list_directory, read_file, search_text, write_file, read_artifact, search_memory and write_memory. There is no shell, desktop automation, deletion, external messaging or scheduled automation.

Reads and literal searches are bounded. Paths are restricted to a user-selected root; traversal, known private paths, symlinks and junctions are rejected. These checks are not a kernel sandbox and do not protect against another local process deliberately racing ancestor-directory replacement. Do not share an agent workspace with an untrusted local account.

All writes require a proposal containing exact contents, a diff and the target's previous SHA-256. Approval is single-use and expires after 24 hours. The hash is rechecked before atomic replacement. Backups/results are stored as artifacts. Interrupted writes are reconciled against their before/after hashes; ambiguous outcomes require review. We do not claim general exactly-once effects across SQLite and filesystem transactions.

The service has a process lock and a single dispatcher. Per-conversation active runs are unique; writes are sequential. API submission idempotency keys are bound to request content. Logs show operational states, not hidden reasoning or credentials. Event payloads and checkpoints contain user content: protect the state directory and backups accordingly.

## Context and memory

Original messages and full tool results remain in SQLite. Model context contains policy, bot purpose, the current task and complete tool exchanges. Older exchanges may be replaced by a deterministic historical digest. Estimates use UTF-8 size plus framing; they are not exact model token counts. Actual usage is recorded when the provider returns it. Oversized current tasks fail clearly instead of silently dropping policy or unmatched tool results.

The vault lives at `DATA_DIR/vault`. Notes are plain Markdown compatible with Obsidian; SQLite FTS5 retrieves excerpts and source names without an embedding model. Agent note creation/edits require approval. Retrieved notes are reference content, never permission to execute actions. Automatic skill promotion and self-modifying runtime code are not included.

## Backup and upgrade

Stop the service and run the backup command into a new private directory. It takes SQLite-consistent copies of both databases and the Markdown vault. Access tokens are deliberately excluded. Restore only while the service is stopped; replace both databases and vault together. Preserve directory permissions. Use `uv sync --locked` on upgrades; the runtime checks the application schema version and refuses unknown versions rather than attempting destructive migrations. Version 1 is the initial schema; no previous Python runtime database exists to migrate.

## Testing

```bash
uv run --directory harness ruff check notbot_harness tests
uv run --directory harness pytest -q
NOTBOT_REAL_TESTS=1 uv run --directory harness pytest tests/test_real_models.py -q -s
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test e2e/harness.spec.ts
```

Real-model tests require the named models already installed in Ollama. They create and edit only temporary fixture workspaces. On PowerShell, set `$env:NOTBOT_REAL_TESTS='1'` first. CI runs deterministic tests on Linux, macOS and Windows; real inference is intentionally opt-in.

# notbot

A monochrome Electron application with a built-in local LangGraph agent harness.

## Develop

Install Node 22.12+, npm and uv. From this folder:

```bash
npm install
uv sync --directory harness --locked
npm run dev
```

Electron starts the harness automatically and connects privately. There is no token or service URL to enter and no separate service command. Closing the app shuts down its runtime. The runtime state lives in Electron's user-data directory; the existing macOS default harness state is retained there. Browser-only development renders the legacy UI preview, which uses mock services.

Open **Settings → Models**, choose **Ollama** or **LM Studio**, start that provider's local server, discover its installed models and save your selection. Model inference stays in the selected server; Notbot manages execution, tools, context, approvals and history. Choose a workspace to create bots and start tasks. Reads are bounded and every text edit requires approval.

## Build and test

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` validate the frontend. `uv run --directory harness pytest -q` checks the harness. Native tests require a built app; real model tests additionally require the configured Ollama fixture model.

`npm run build:harness` freezes Python and its dependencies into a platform-specific runtime. `npm run package` includes that bundle in an unpacked Electron app. Users of a packaged build do not need Python or uv. Build on each target OS/architecture; PyInstaller is not a cross-compiler. On macOS, `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package` makes an unsigned local test build. Distribution requires platform signing/notarization.

See [harness/README.md](harness/README.md) for developer CLI commands, model configuration and recovery, and [harness/RELEASE_CHECKS.md](harness/RELEASE_CHECKS.md) for measured results and release gates. Shell/computer automation, remote workers and scheduling are not enabled in the built-in runtime.

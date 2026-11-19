"""Authenticated versioned API. A single lifespan owns the dispatcher and databases."""

from __future__ import annotations

import asyncio
import hmac
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from .config import Settings
from .domain import BotInput, ConnectionInput, ConversationInput, Decision, RunInput, WorkspaceInput
from .engine import Engine
from .provider import LocalProvider, Provider
from .storage import Conflict, uid


def create_app(settings: Settings | None = None, provider: Provider | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        engine = Engine(settings, provider)
        await engine.start()
        app.state.engine = engine
        try:
            yield
        finally:
            await engine.close()

    app = FastAPI(
        title="Notbot harness", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None
    )

    @app.middleware("http")
    async def boundaries(request: Request, call_next):
        # Request bodies are small structured records, never uploaded binary artifacts.
        if request.method in {"POST", "PUT", "PATCH"}:
            total = 0
            chunks = []
            async for chunk in request.stream():
                total += len(chunk)
                if total > 2_097_152:
                    return JSONResponse({"detail": "Request body exceeds 2 MiB"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse({"detail": str(error)}, status_code=404)

    @app.exception_handler(Conflict)
    async def conflict(request, error):
        return JSONResponse({"detail": str(error)}, status_code=409)

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({"detail": str(error)}, status_code=400)

    def engine(request: Request, authorization: str = Header(default="")) -> Engine:
        runtime = request.app.state.engine
        if not hmac.compare_digest(authorization, "Bearer " + runtime.token):
            raise HTTPException(401, "Valid bearer token required")
        return runtime

    auth = Depends(engine)

    @app.get("/api/v1/health")
    def health(runtime: Engine = auth):
        return {
            "status": "ok",
            "version": "0.1.0",
            "mode": "connected",
            "execution_host": "single",
            "model": runtime.settings.model,
        }

    @app.get("/api/v1/capabilities")
    def capabilities(runtime: Engine = auth):
        return {
            "tools": [
                "list_directory",
                "read_file",
                "search_text",
                "write_file",
                "read_artifact",
                "search_memory",
                "write_memory",
            ],
            "writes_require_approval": True,
            "remote_workers": False,
            "desktop_control": False,
            "shell": False,
            "automations": False,
            "model_concurrency": 1,
        }

    @app.get("/api/v1/snapshot")
    def snapshot(runtime: Engine = auth):
        store = runtime.store
        conversations = [
            {**conversation, "messages": store.messages(conversation["id"])}
            for conversation in store.entities("conversation")
        ]
        return {
            "bots": store.entities("bot"),
            "workspaces": store.entities("workspace"),
            "conversations": conversations,
            "runs": store.runs(),
            "approvals": [
                {**a, "data": {k: v for k, v in a["data"].items() if k != "backup"}}
                for a in store.approvals()
            ],
            "artifacts": store.artifacts(),
            "model": runtime.settings.model,
            "model_url": runtime.settings.model_url,
        }

    @app.get("/api/v1/models")
    async def models(runtime: Engine = auth):
        if not hasattr(runtime.provider, "models"):
            return {"models": [], "status": "test-provider"}
        try:
            return {"models": await runtime.provider.models(), "status": "online"}
        except Exception:
            raise HTTPException(
                502, "Model endpoint unavailable; check its URL and credentials"
            ) from None

    @app.post("/api/v1/models/discover")
    async def discover_models(body: ConnectionInput, runtime: Engine = auth):
        settings = Settings(model_url=body.base_url, model_key=runtime.settings.model_key)
        try:
            return {"models": await LocalProvider(settings).models(), "status": "online"}
        except Exception:
            raise HTTPException(
                502, "Model server unavailable. Start Ollama or LM Studio and check its address."
            ) from None

    @app.put("/api/v1/models/config")
    def configure_model(body: ConnectionInput, runtime: Engine = auth):
        if runtime.active_id:
            raise Conflict("Pause or finish the active run before changing model configuration")
        validated = Settings(model_url=body.base_url)
        runtime.settings.model_url = validated.model_url
        runtime.settings.model = body.model
        runtime.store.put_entity(
            "configuration", {"id": "model", "base_url": validated.model_url, "model": body.model}
        )
        return {"base_url": validated.model_url, "model": body.model}

    @app.get("/api/v1/workspaces")
    def workspaces(runtime: Engine = auth):
        return runtime.store.entities("workspace")

    @app.post("/api/v1/workspaces", status_code=201)
    def add_workspace(body: WorkspaceInput, runtime: Engine = auth):
        root = Path(body.path).expanduser().resolve(strict=True)
        if not root.is_dir() or root.is_relative_to(runtime.settings.data_dir):
            raise ValueError("Choose a real directory outside private Notbot state")
        for workspace in runtime.store.entities("workspace"):
            if workspace["path"] == str(root):
                return workspace
        record = {"id": uid(), "name": body.name, "path": str(root)}
        runtime.store.put_entity("workspace", record)
        return record

    @app.get("/api/v1/bots")
    def bots(runtime: Engine = auth):
        return runtime.store.entities("bot")

    @app.post("/api/v1/bots", status_code=201)
    def add_bot(body: BotInput, runtime: Engine = auth):
        with runtime.store.lock:
            if any(
                bot["name"].casefold() == body.name.casefold()
                for bot in runtime.store.entities("bot")
            ):
                raise Conflict("Bot name already exists")
            record = {"id": uid(), **body.model_dump()}
            runtime.store.put_entity("bot", record)
            return record

    @app.put("/api/v1/bots/{identifier}")
    def update_bot(identifier: str, body: BotInput, runtime: Engine = auth):
        with runtime.store.lock:
            runtime.store.entity("bot", identifier)
            if any(
                bot["id"] != identifier and bot["name"].casefold() == body.name.casefold()
                for bot in runtime.store.entities("bot")
            ):
                raise Conflict("Bot name already exists")
            record = {"id": identifier, **body.model_dump()}
            runtime.store.put_entity("bot", record)
            return record

    @app.post("/api/v1/conversations", status_code=201)
    def add_conversation(body: ConversationInput, runtime: Engine = auth):
        bot = runtime.store.entity("bot", body.bot_id)
        runtime.store.entity("workspace", body.workspace_id)
        if not bot["enabled"]:
            raise Conflict("Bot is disabled")
        record = {"id": uid(), **body.model_dump(), "created": time.time()}
        runtime.store.put_entity("conversation", record)
        return record

    @app.get("/api/v1/conversations")
    def conversations(runtime: Engine = auth):
        return [
            {**item, "messages": runtime.store.messages(item["id"])}
            for item in runtime.store.entities("conversation")
        ]

    @app.get("/api/v1/conversations/{identifier}/messages")
    def messages(identifier: str, runtime: Engine = auth):
        runtime.store.entity("conversation", identifier)
        return runtime.store.messages(identifier)

    @app.post("/api/v1/runs", status_code=201)
    async def submit(
        body: RunInput,
        idempotency_key: str = Header(min_length=8, max_length=200),
        runtime: Engine = auth,
    ):
        return runtime.submit(body, idempotency_key)

    @app.get("/api/v1/runs")
    def runs(runtime: Engine = auth):
        return runtime.store.runs()

    @app.get("/api/v1/runs/{identifier}")
    def run(identifier: str, runtime: Engine = auth):
        return runtime.store.run(identifier)

    @app.post("/api/v1/runs/{identifier}/{action}")
    async def control(identifier: str, action: str, runtime: Engine = auth):
        return runtime.control(identifier, action)

    @app.get("/api/v1/approvals")
    def approvals(runtime: Engine = auth):
        return [
            {**a, "data": {k: v for k, v in a["data"].items() if k != "backup"}}
            for a in runtime.store.approvals()
        ]

    @app.post("/api/v1/approvals/{identifier}")
    async def decide(identifier: str, body: Decision, runtime: Engine = auth):
        return runtime.decide(identifier, body.decision)

    @app.get("/api/v1/events")
    def events(after: int = 0, runtime: Engine = auth):
        if after < 0:
            raise ValueError("Invalid event cursor")
        return runtime.store.events(after)

    @app.get("/api/v1/events/stream")
    async def stream(
        request: Request,
        after: int = 0,
        last_event_id: str | None = Header(default=None),
        runtime: Engine = auth,
    ):
        try:
            cursor = max(0, int(last_event_id or after))
        except ValueError:
            raise HTTPException(400, "Invalid event cursor") from None

        async def generate():
            nonlocal cursor
            while not await request.is_disconnected():
                records = runtime.store.events(cursor)
                for event in records:
                    cursor = event["seq"]
                    yield f"id: {cursor}\nevent: update\ndata: {json.dumps(event)}\n\n"
                if not records:
                    yield ": heartbeat\n\n"
                    await asyncio.sleep(0.5)

        return StreamingResponse(
            generate(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
        )

    @app.get("/api/v1/artifacts")
    def artifacts(runtime: Engine = auth):
        return runtime.store.artifacts()

    @app.get("/api/v1/artifacts/{identifier}")
    def artifact(identifier: str, runtime: Engine = auth):
        return PlainTextResponse(
            runtime.store.artifact_content(identifier),
            headers={"Content-Disposition": 'attachment; filename="notbot-artifact.txt"'},
        )

    @app.get("/api/v1/memory")
    def memory(runtime: Engine = auth):
        vault = runtime.settings.data_dir / "vault"
        return (
            {
                "notes": [
                    {"name": path.name, "size": path.stat().st_size}
                    for path in vault.glob("*.md")
                    if path.is_file() and not path.is_symlink()
                ],
                "editable_through_approved_tools": True,
            }
            if vault.exists()
            else {"notes": [], "editable_through_approved_tools": True}
        )

    @app.post("/api/v1/import")
    async def import_history(request: Request, runtime: Engine = auth):
        payload = await request.json()
        if not isinstance(payload, dict) or set(payload) - {
            "bots",
            "conversations",
            "workspace_id",
        }:
            raise ValueError("Expected bots, conversations and workspace_id")
        workspace = runtime.store.entity("workspace", payload.get("workspace_id", ""))
        imported = []
        bots_payload = payload.get("bots", [])
        chats = payload.get("conversations", [])
        if (
            not isinstance(bots_payload, list)
            or not isinstance(chats, list)
            or len(bots_payload) > 100
            or len(chats) > 500
        ):
            raise ValueError("Import exceeds supported limits")
        # Validate all input before any persistent mutation.
        validated = [
            (
                str(bot["id"]),
                BotInput(
                    name=bot["name"],
                    purpose=bot.get("description") or bot.get("purpose") or "General helper",
                    enabled=bot.get("enabled", True),
                ),
            )
            for bot in bots_payload
        ]
        for chat in chats:
            if not isinstance(chat, dict) or not isinstance(chat.get("messages", []), list):
                raise ValueError("Invalid historical conversation")
            for message in chat.get("messages", []):
                if message.get("role") not in {"user", "assistant"} or not isinstance(
                    message.get("text"), str
                ):
                    raise ValueError("Only plain historical user/assistant text can be imported")
        with runtime.store.transaction() as db:
            for old_id, body in validated:
                identifier = "import:" + old_id
                if (
                    db.execute("SELECT 1 FROM entities WHERE id=?", (identifier,)).fetchone()
                    is None
                ):
                    db.execute(
                        "INSERT INTO entities VALUES(?,?,?)",
                        (identifier, "bot", json.dumps({"id": identifier, **body.model_dump()})),
                    )
                imported.append(identifier)
            for chat in chats:
                bot_id = "import:" + str(chat.get("agentId", ""))
                if bot_id not in imported:
                    raise ValueError("Conversation references a bot absent from the import")
                identifier = "import:" + str(chat["id"])
                record = {
                    "id": identifier,
                    "bot_id": bot_id,
                    "workspace_id": workspace["id"],
                    "historical": True,
                    "created": time.time(),
                }
                db.execute(
                    "INSERT OR IGNORE INTO entities VALUES(?,?,?)",
                    (identifier, "conversation", json.dumps(record)),
                )
                for index, message in enumerate(chat.get("messages", [])):
                    message_id = identifier + f":{index}"
                    data = {
                        "type": "human" if message["role"] == "user" else "ai",
                        "data": {
                            "content": message["text"],
                            "id": message_id,
                            "additional_kwargs": {},
                            "response_metadata": {"historical_simulation": True},
                        },
                    }
                    db.execute(
                        "INSERT OR IGNORE INTO messages VALUES(?,?,?,?)",
                        (message_id, identifier, json.dumps(data), time.time()),
                    )
        return {
            "imported_bots": len(imported),
            "historical_conversations": len(chats),
            "tasks_executed": 0,
        }

    return app

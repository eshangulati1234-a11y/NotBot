import asyncio

import httpx
import pytest
from langchain.messages import AIMessage

from notbot_harness.api import create_app
from notbot_harness.config import Settings
from notbot_harness.context import ContextLimit, prepare
from notbot_harness.engine import Engine
from notbot_harness.storage import Conflict
from notbot_harness.tools import ToolDenied, safe_path


class ScriptedProvider:
    def __init__(self, responses=None, delay=0):
        self.responses = list(
            responses or [AIMessage(content="Finished using the supplied evidence.")]
        )
        self.calls = 0
        self.delay = delay

    async def generate(self, messages, tools, model, on_text):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        result = self.responses[min(self.calls - 1, len(self.responses) - 1)]
        await on_text(str(result.content))
        return result.model_copy(deep=True)


def call(name="read_file", **args):
    return AIMessage(
        content="", tool_calls=[{"id": "call_1", "name": name, "args": args, "type": "tool_call"}]
    )


async def wait_status(
    engine,
    run_id,
    statuses=frozenset({"completed", "failed", "waiting", "needs_review", "cancelled"}),
):
    async with asyncio.timeout(8):
        while True:
            record = engine.store.run(run_id)
            if record["status"] in statuses:
                return record
            await asyncio.sleep(0.02)


async def environment(tmp_path, provider):
    work = tmp_path / "workspace"
    work.mkdir(exist_ok=True)
    (work / "README.md").write_text("A tiny test project.\n")
    settings = Settings(data_dir=tmp_path / "private", request_timeout=3)
    app = create_app(settings, provider)
    return app, work


async def seed(client, work, safety="balanced"):
    workspace = (await client.post("/api/v1/workspaces", json={"path": str(work)})).json()
    bot = (
        await client.post(
            "/api/v1/bots",
            json={"name": "Pip", "purpose": "Inspect this workspace.", "safety": safety},
        )
    ).json()
    chat = (
        await client.post(
            "/api/v1/conversations", json={"bot_id": bot["id"], "workspace_id": workspace["id"]}
        )
    ).json()
    return chat, workspace, bot


@pytest.mark.asyncio
async def test_read_loop_and_idempotency(tmp_path):
    provider = ScriptedProvider(
        [call(path="README.md"), AIMessage(content="README.md describes a tiny project.")]
    )
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            body = {"conversation_id": chat["id"], "task": "Inspect README.md"}
            run = (
                await client.post(
                    "/api/v1/runs", json=body, headers={"Idempotency-Key": "test-request-1"}
                )
            ).json()
            again = (
                await client.post(
                    "/api/v1/runs", json=body, headers={"Idempotency-Key": "test-request-1"}
                )
            ).json()
            assert run["id"] == again["id"]
            result = await wait_status(engine, run["id"])
            assert result["status"] == "completed", result
            assert provider.calls == 2
            assert len(engine.store.messages(chat["id"])) == 4
            events = (await client.get("/api/v1/events")).json()
            assert any(event["kind"] == "tool.completed" for event in events)
            cursor = events[2]["seq"]
            assert all(
                event["seq"] > cursor
                for event in (await client.get("/api/v1/events", params={"after": cursor})).json()
            )
            assert (
                await client.post(
                    "/api/v1/runs",
                    json={**body, "task": "Different"},
                    headers={"Idempotency-Key": "test-request-1"},
                )
            ).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["approve", "reject"])
async def test_write_approval_and_restart(tmp_path, decision):
    provider = ScriptedProvider(
        [call("write_file", path="note.md", content="Approved text\n"), AIMessage(content="Done.")]
    )
    app, work = await environment(tmp_path, provider)
    settings = Settings(data_dir=tmp_path / "private", request_timeout=3)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            run = (
                await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": chat["id"], "task": "Write note.md"},
                    headers={"Idempotency-Key": "write-approval-test"},
                )
            ).json()
            result = await wait_status(engine, run["id"])
            assert result["status"] == "waiting", result
            approval = engine.store.approvals()[0]
            assert not (work / "note.md").exists()
    # New process-equivalent instance resumes the checkpoint, not a new model request.
    restarted = Engine(settings, ScriptedProvider([AIMessage(content="Finished after review.")]))
    await restarted.start()
    try:
        restarted.decide(approval["id"], decision)
        with pytest.raises(Conflict):
            restarted.decide(approval["id"], decision)
        result = await wait_status(restarted, run["id"], {"completed", "failed", "needs_review"})
        assert result["status"] == "completed", result
        assert (work / "note.md").exists() == (decision == "approve")
        if decision == "approve":
            assert (work / "note.md").read_text() == "Approved text\n"
    finally:
        await restarted.close()


@pytest.mark.asyncio
async def test_stale_file_edit_needs_review(tmp_path):
    app, work = await environment(
        tmp_path, ScriptedProvider([call("write_file", path="README.md", content="new")])
    )
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            run = (
                await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": chat["id"], "task": "Edit readme"},
                    headers={"Idempotency-Key": "stale-edit-test"},
                )
            ).json()
            assert (await wait_status(engine, run["id"]))["status"] == "waiting"
            (work / "README.md").write_text("Changed by human")
            engine.decide(engine.store.approvals()[0]["id"], "approve")
            assert (await wait_status(engine, run["id"], {"needs_review", "failed", "completed"}))[
                "status"
            ] == "needs_review"
            assert (work / "README.md").read_text() == "Changed by human"


@pytest.mark.asyncio
async def test_cancel_and_conversation_conflict(tmp_path):
    app, work = await environment(tmp_path, ScriptedProvider(delay=2))
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            body = {"conversation_id": chat["id"], "task": "Wait"}
            run = (
                await client.post(
                    "/api/v1/runs", json=body, headers={"Idempotency-Key": "cancel-test-1"}
                )
            ).json()
            assert (
                await client.post(
                    "/api/v1/runs", json=body, headers={"Idempotency-Key": "cancel-test-2"}
                )
            ).status_code == 409
            engine.control(run["id"], "cancel")
            await asyncio.sleep(0.05)
            assert engine.store.run(run["id"])["status"] == "cancelled"


@pytest.mark.asyncio
async def test_turn_budget_and_no_unknown_tool_execution(tmp_path):
    app, work = await environment(tmp_path, ScriptedProvider([call("shell", command="rm -rf /")]))
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        engine.settings.max_turns = 2
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            run = (
                await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": chat["id"], "task": "Do work"},
                    headers={"Idempotency-Key": "budget-test-1"},
                )
            ).json()
            result = await wait_status(engine, run["id"])
            assert result["status"] == "failed"
            assert "turn budget" in result["error"]
            assert any(event["kind"] == "tool.denied" for event in engine.store.events())


@pytest.mark.asyncio
async def test_auth_import_and_body_limits(tmp_path):
    app, work = await environment(tmp_path, ScriptedProvider())
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (await client.get("/api/v1/health")).status_code == 401
            client.headers["Authorization"] = "Bearer " + engine.token
            workspace = (await client.post("/api/v1/workspaces", json={"path": str(work)})).json()
            payload = {
                "workspace_id": workspace["id"],
                "bots": [{"id": "old", "name": "Imported", "description": "Purpose"}],
                "conversations": [
                    {
                        "id": "chat",
                        "agentId": "old",
                        "messages": [{"role": "user", "text": "Historic"}],
                    }
                ],
            }
            for _ in range(2):
                assert (await client.post("/api/v1/import", json=payload)).status_code == 200
            snapshot = (await client.get("/api/v1/snapshot")).json()
            assert len(snapshot["bots"]) == len(snapshot["conversations"]) == 1
            assert len(snapshot["conversations"][0]["messages"]) == 1
            assert snapshot["runs"] == []
            assert (await client.post("/api/v1/bots", content="x" * 2_097_153)).status_code == 413


def test_paths_and_text_limits(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "link").symlink_to(outside, target_is_directory=True)
    for path in ["../outside", "/tmp", "link/file", ".env", "folder\\file", "C:drive"]:
        with pytest.raises(ToolDenied):
            safe_path(root, path)
    assert safe_path(root, ".") == root


def test_context_preserves_current_tool_pairing():
    from langchain.messages import HumanMessage, ToolMessage

    messages = [
        HumanMessage(content="old" * 1000),
        AIMessage(content="prior"),
        HumanMessage(content="Current task"),
        call(path="a"),
        ToolMessage(content="file output", tool_call_id="call_1"),
    ]
    selected, metrics = prepare(messages, "purpose", [], 3000, 500)
    assert metrics["removed_messages"] > 0
    assert any(isinstance(message, ToolMessage) for message in selected)
    assert any(isinstance(message, AIMessage) and message.tool_calls for message in selected)
    with pytest.raises(ContextLimit):
        prepare([HumanMessage(content="x" * 10000)], "purpose", [], 2048, 1024)

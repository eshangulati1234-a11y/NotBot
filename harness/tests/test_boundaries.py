import asyncio

import httpx
import pytest
from langchain.messages import AIMessage, HumanMessage, ToolMessage
from test_runtime import ScriptedProvider, call, environment, seed, wait_status

from notbot_harness.config import Settings
from notbot_harness.context import ContextLimit, prepare
from notbot_harness.domain import RunInput
from notbot_harness.engine import Engine
from notbot_harness.storage import Conflict, Store
from notbot_harness.tools import NeedsReview, ToolDenied, Tools, read_text


def prepared_tools(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    private = tmp_path / "private"
    private.mkdir()
    store = Store(private / "app.db")
    store.create_run(
        {"id": "run", "conversation_id": "chat", "task": "write", "status": "queued"},
        "key-00001",
        100,
    )
    store.update_run("run", status="waiting")
    return store, Tools(store, root, private, "run"), root


def test_write_reconciles_after_replace_before_journal_commit(tmp_path):
    store, tools, root = prepared_tools(tmp_path)
    try:
        args = {"path": "note.md", "content": "new text"}
        proposal = tools.proposal("write_file", args)
        store.request_approval("approval", "run", proposal, 60)
        store.decide("approval", "approve")
        store.consume_approval("approval")
        store.save_attempt("attempt", "run", "prepared", {"proposal": proposal})
        (root / "note.md").write_text("new text")
        output = tools.execute("write_file", args, "attempt", "approval")
        assert "written" in output
        assert tools.execute("write_file", args, "attempt", "approval") == output
        assert len(store.artifacts()) == 1
    finally:
        store.close()


def test_interrupted_write_rejects_ambiguous_target(tmp_path):
    store, tools, root = prepared_tools(tmp_path)
    try:
        args = {"path": "note.md", "content": "new text"}
        proposal = tools.proposal("write_file", args)
        store.save_attempt("attempt", "run", "prepared", {"proposal": proposal})
        (root / "note.md").write_text("different")
        with pytest.raises(NeedsReview):
            tools.execute("write_file", args, "attempt")
        assert (root / "note.md").read_text() == "different"
    finally:
        store.close()


def test_expired_approval_and_duplicate_decisions(tmp_path):
    store, tools, root = prepared_tools(tmp_path)
    try:
        store.request_approval(
            "expired", "run", tools.proposal("write_file", {"path": "note", "content": "a"}), -1
        )
        with pytest.raises(Conflict):
            store.decide("expired", "approve")
        assert not (root / "note").exists()
    finally:
        store.close()


def test_binary_oversize_and_private_files(tmp_path):
    store, tools, root = prepared_tools(tmp_path)
    try:
        (root / "binary").write_bytes(b"\0abc")
        (root / "large").write_bytes(b"a" * 1_048_577)
        for path in ["binary", "large"]:
            with pytest.raises(ToolDenied):
                read_text(root / path)
        for args in [{"path": "a", "content": "\0"}, {"path": "../a", "content": "text"}]:
            with pytest.raises(ValueError):
                validated = tools.validate("write_file", args)
                tools.proposal("write_file", validated)
        with pytest.raises(ToolDenied):
            tools.path(str(tools.private_dir))
    finally:
        store.close()


@pytest.mark.asyncio
async def test_pause_resume_and_shutdown_recovery(tmp_path):
    settings = Settings(data_dir=tmp_path / "private", request_timeout=3)
    engine = Engine(settings, ScriptedProvider(delay=0.3))
    await engine.start()
    root = tmp_path / "workspace"
    root.mkdir()
    engine.store.put_entity("workspace", {"id": "work", "path": str(root)})
    engine.store.put_entity(
        "bot",
        {"id": "bot", "name": "Bot", "purpose": "Help", "enabled": True, "safety": "balanced"},
    )
    engine.store.put_entity("conversation", {"id": "chat", "bot_id": "bot", "workspace_id": "work"})
    run = engine.submit(RunInput(conversation_id="chat", task="Hello"), "shutdown-test")
    await asyncio.sleep(0.05)
    engine.control(run["id"], "pause")
    await asyncio.sleep(0.05)
    assert engine.store.run(run["id"])["status"] == "paused"
    engine.control(run["id"], "resume")
    await asyncio.sleep(0.05)
    await engine.close()
    restarted = Engine(settings, ScriptedProvider())
    await restarted.start()
    try:
        assert (await wait_status(restarted, run["id"]))["status"] == "completed"
    finally:
        await restarted.close()


@pytest.mark.asyncio
async def test_timeout_and_ask_before_read(tmp_path):
    settings = Settings(data_dir=tmp_path / "private", request_timeout=0.05, max_active_seconds=1)
    engine = Engine(settings, ScriptedProvider(delay=1))
    await engine.start()
    root = tmp_path / "workspace"
    root.mkdir()
    engine.store.put_entity("workspace", {"id": "work", "path": str(root)})
    engine.store.put_entity(
        "bot", {"id": "bot", "name": "Bot", "purpose": "Help", "enabled": True, "safety": "ask"}
    )
    engine.store.put_entity("conversation", {"id": "chat", "bot_id": "bot", "workspace_id": "work"})
    try:
        run = engine.submit(RunInput(conversation_id="chat", task="Hello"), "timeout-test")
        assert (await wait_status(engine, run["id"]))["status"] == "failed"
        settings.request_timeout = 3
        engine.provider = ScriptedProvider(
            [call("list_directory", path="."), AIMessage(content="Done")]
        )
        run = engine.submit(RunInput(conversation_id="chat", task="List files"), "ask-read-test")
        assert (await wait_status(engine, run["id"]))["status"] == "waiting"
        assert not any(
            event["kind"] == "tool.completed" and event["run_id"] == run["id"]
            for event in engine.store.events()
        )
        engine.decide(engine.store.approvals()[0]["id"], "approve")
        assert (await wait_status(engine, run["id"], {"failed", "completed"}))[
            "status"
        ] == "completed"
    finally:
        await engine.close()


def test_incomplete_history_is_removed_only_before_current_task():
    old_call = call(path="README.md")
    current = HumanMessage(content="New task")
    messages, _ = prepare(
        [HumanMessage(content="Old task"), old_call, current], "Help", [], 8192, 1024
    )
    assert old_call not in messages
    assert current in messages
    with pytest.raises(ContextLimit, match="incomplete"):
        prepare([current, old_call], "Help", [], 8192, 1024)
    with pytest.raises(ContextLimit, match="unmatched"):
        prepare(
            [current, ToolMessage(content="orphan", tool_call_id="missing")], "Help", [], 8192, 1024
        )


@pytest.mark.asyncio
async def test_rejected_action_cannot_be_reproposed(tmp_path):
    provider = ScriptedProvider(
        [
            call("write_file", path="note.md", content="first"),
            call("write_file", path="other.md", content="second"),
            AIMessage(content="The user rejected the edit. No files were changed."),
        ]
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
            run = engine.submit(
                RunInput(conversation_id=chat["id"], task="Write a note"), "reject-retry-test"
            )
            assert (await wait_status(engine, run["id"]))["status"] == "waiting"
            engine.decide(engine.store.approvals()[0]["id"], "reject")
            assert (await wait_status(engine, run["id"], {"failed", "completed"}))[
                "status"
            ] == "completed"
            assert len(engine.store.approvals()) == 1
            assert not (work / "note.md").exists()
            assert not (work / "other.md").exists()


def test_special_files_and_case_variant_secrets_are_denied(tmp_path):
    import os

    store, tools, root = prepared_tools(tmp_path)
    try:
        for name in [".ENV", ".SSH/key", "CON.txt", "COM1", "file.", "file "]:
            with pytest.raises(ToolDenied):
                tools.path(name)
        if hasattr(os, "mkfifo"):
            os.mkfifo(root / "pipe")
            with pytest.raises(ToolDenied):
                read_text(root / "pipe")
    finally:
        store.close()

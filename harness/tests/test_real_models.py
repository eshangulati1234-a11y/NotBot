"""Explicit opt-in acceptance against installed Ollama models; never downloads models."""

import asyncio
import os
import time

import httpx
import pytest

from notbot_harness.api import create_app
from notbot_harness.config import Settings

pytestmark = pytest.mark.skipif(
    os.getenv("NOTBOT_REAL_TESTS") != "1",
    reason="Set NOTBOT_REAL_TESTS=1 to use an installed local model",
)


async def finished(engine, identifier):
    async with asyncio.timeout(180):
        while True:
            run = engine.store.run(identifier)
            if run["status"] in {"completed", "failed", "waiting", "needs_review"}:
                return run
            await asyncio.sleep(0.2)


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["llama3.2:3b", "qwen2.5-coder:7b"])
@pytest.mark.parametrize("decision", [None, "approve", "reject"])
async def test_real_tool_workflow(tmp_path, model, decision):
    work = tmp_path / "project"
    work.mkdir()
    (work / "README.md").write_text(
        "This is a miniature Electron app. The verification code is MAPLE-731.\n"
    )
    settings = Settings(
        data_dir=tmp_path / "private", model=model, request_timeout=120, max_active_seconds=240
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            workspace = (await client.post("/api/v1/workspaces", json={"path": str(work)})).json()
            bot = (
                await client.post(
                    "/api/v1/bots",
                    json={
                        "name": "Acceptance",
                        "purpose": "Use structured workspace tools to complete the user task. Never invent file contents.",
                        "model": model,
                    },
                )
            ).json()
            chat = (
                await client.post(
                    "/api/v1/conversations",
                    json={"bot_id": bot["id"], "workspace_id": workspace["id"]},
                )
            ).json()
            task = (
                "Use read_file on README.md, then explain this project and quote its verification code."
                if decision is None
                else 'Use write_file to create note.md with exactly the content "Reviewed note". Request that tool now. Do not just describe writing it. After the tool result, stop and report whether it was approved or rejected.'
            )
            started = time.monotonic()
            response = await client.post(
                "/api/v1/runs",
                json={"conversation_id": chat["id"], "task": task},
                headers={"Idempotency-Key": f"real-{model}-{decision}"},
            )
            response.raise_for_status()
            run = response.json()
            result = await finished(engine, run["id"])
            if decision:
                assert result["status"] == "waiting", result
                assert not (work / "note.md").exists()
                engine.decide(engine.store.approvals()[0]["id"], decision)
                result = await finished(engine, run["id"])
                assert result["status"] == "completed", result
                assert (work / "note.md").exists() == (decision == "approve")
                if decision == "approve":
                    assert (work / "note.md").read_text() == "Reviewed note"
            else:
                assert result["status"] == "completed", result
                assert "MAPLE-731" in result["answer"]
                assert any(event["kind"] == "tool.completed" for event in engine.store.events())
            print(
                {
                    "model": model,
                    "decision": decision,
                    "seconds": round(time.monotonic() - started, 2),
                    "turns": result["turns"],
                    "status": result["status"],
                }
            )

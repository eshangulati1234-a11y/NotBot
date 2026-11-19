import json

import httpx
import pytest
from langchain.messages import AIMessage

from notbot_harness.context import prepare
from notbot_harness.memory import CAPS, MemoryStore, parse_facts
from tests.test_runtime import ScriptedProvider, call, environment, seed, wait_status


def test_store_caps_round_trip_and_prompt_block(tmp_path):
    store = MemoryStore(tmp_path)
    assert store.block("bot") == ""
    store.write("bot", "user", "Prefers short answers.")
    store.append("bot", "memory", "Uses pnpm")
    assert store.read("bot") == {"memory": "- Uses pnpm\n", "user": "Prefers short answers.\n"}
    block = store.block("bot")
    assert "About the person" in block and "About the work" in block
    with pytest.raises(ValueError):
        store.write("bot", "memory", "x" * (CAPS["memory"] + 1))
    # Odd ids stay inside the memory folder.
    store.write("../../evil:id", "user", "ok")
    assert not (tmp_path.parent / "evil").exists()


def test_parse_facts_filters_secrets_duplicates_and_junk():
    existing = {"memory": "- Uses pnpm", "user": ""}
    reply = json.dumps(
        {
            "facts": [
                {"target": "user", "text": "Prefers British spelling."},
                {"target": "memory", "text": "Uses pnpm"},
                {"target": "memory", "text": "api_key = sk-abcdefghijk"},
                {"target": "bogus", "text": "nope"},
                {"target": "user", "text": "x" * 500},
            ]
        }
    )
    assert parse_facts("Sure! " + reply, existing) == [
        {"target": "user", "text": "Prefers British spelling."}
    ]
    assert parse_facts("not json", existing) == []
    assert parse_facts('{"facts": "no"}', existing) == []


def test_prepare_puts_memory_in_the_system_prompt_only_when_present():
    with_memory, _ = prepare([], "Help.", [], 8192, 1024, memory="About the work:\n- Uses pnpm")
    assert "Uses pnpm" in with_memory[0].content
    without, _ = prepare([], "Help.", [], 8192, 1024)
    assert "remember" not in without[0].content


@pytest.mark.asyncio
async def test_run_indexes_history_and_proposes_then_user_accepts(tmp_path):
    facts = json.dumps({"facts": [{"target": "user", "text": "Likes concise summaries."}]})
    provider = ScriptedProvider(
        [
            AIMessage(
                content="The project is a tiny test project described in README.md, nothing more."
            ),
            AIMessage(content=facts),
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
            chat, _, bot = await seed(client, work)
            response = await client.post(
                "/api/v1/runs",
                json={"conversation_id": chat["id"], "task": "Summarise the README for me"},
                headers={"Idempotency-Key": "memory-key-1"},
            )
            run = response.json()
            await wait_status(engine, run["id"])
            async with __import__("asyncio").timeout(5):
                while not engine.store.entities("memory_proposal"):
                    await __import__("asyncio").sleep(0.05)

            shown = (await client.get(f"/api/v1/bots/{bot['id']}/memory")).json()
            assert [p["text"] for p in shown["proposals"]] == ["Likes concise summaries."]
            assert shown["user"] == "" and shown["memory"] == ""  # nothing written yet

            found = engine.store.search_history(bot["id"], ["readme"], exclude="other")
            assert found and found[0]["run_id"] == run["id"]
            assert engine.store.search_history(bot["id"], ["readme"], exclude=run["id"]) == []

            proposal = shown["proposals"][0]
            accepted = (
                await client.post(
                    f"/api/v1/memory/proposals/{proposal['id']}", json={"decision": "accept"}
                )
            ).json()
            assert "Likes concise summaries." in accepted["user"]
            assert accepted["proposals"] == []
            again = await client.post(
                f"/api/v1/memory/proposals/{proposal['id']}", json={"decision": "accept"}
            )
            assert again.status_code == 409

            saved = await client.put(
                f"/api/v1/bots/{bot['id']}/memory", json={"memory": "- Uses pnpm", "user": ""}
            )
            assert saved.json()["memory"].strip() == "- Uses pnpm"
            too_long = await client.put(
                f"/api/v1/bots/{bot['id']}/memory", json={"memory": "x" * 3000, "user": ""}
            )
            assert too_long.status_code == 400


@pytest.mark.asyncio
async def test_learning_off_proposes_nothing_and_tool_finds_past_work(tmp_path):
    provider = ScriptedProvider(
        [
            AIMessage(content="The README describes a tiny project used for tests, as asked here."),
            call("search_history", query="README project"),
            AIMessage(content="Earlier you asked about the README; it described a tiny project."),
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
            chat, workspace, bot = await seed(client, work)
            await client.put(
                f"/api/v1/bots/{bot['id']}",
                json={"name": "Pip", "purpose": "Inspect.", "learn": False},
            )
            first = (
                await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": chat["id"], "task": "Summarise the README for me"},
                    headers={"Idempotency-Key": "memory-key-2"},
                )
            ).json()
            await wait_status(engine, first["id"])
            assert engine.store.entities("memory_proposal") == []
            second_chat = (
                await client.post(
                    "/api/v1/conversations",
                    json={"bot_id": bot["id"], "workspace_id": workspace["id"]},
                )
            ).json()
            second = (
                await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": second_chat["id"], "task": "What did we do before?"},
                    headers={"Idempotency-Key": "memory-key-3"},
                )
            ).json()
            result = await wait_status(engine, second["id"])
            assert result["status"] == "completed", result
            events = (await client.get("/api/v1/events")).json()
            done = [
                e for e in events if e["kind"] == "tool.completed" and e["run_id"] == second["id"]
            ]
            assert done


class RecordingProvider(ScriptedProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.seen = []

    async def generate(self, messages, tools, model, on_text):
        self.seen.append(messages[0].content)
        return await super().generate(messages, tools, model, on_text)


@pytest.mark.asyncio
async def test_saved_memory_reaches_the_model_for_that_helper_only(tmp_path):
    provider = RecordingProvider([AIMessage(content="Noted, keeping it short and British here.")])
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, bot = await seed(client, work)
            await client.put(
                f"/api/v1/bots/{bot['id']}",
                json={"name": "Pip", "purpose": "Inspect.", "learn": False},
            )
            await client.put(
                f"/api/v1/bots/{bot['id']}/memory",
                json={"memory": "- Uses pnpm", "user": "Wants British spelling"},
            )
            run = (
                await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": chat["id"], "task": "Hello there"},
                    headers={"Idempotency-Key": "memory-key-4"},
                )
            ).json()
            await wait_status(engine, run["id"])
            assert "Uses pnpm" in provider.seen[0] and "British spelling" in provider.seen[0]
            assert engine.memory.block("some-other-helper") == ""

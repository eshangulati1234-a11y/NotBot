import httpx
import pytest
from langchain.messages import AIMessage

from tests.test_runtime import ScriptedProvider, environment, seed, wait_status


@pytest.mark.asyncio
async def test_fork_shares_history_before_a_run_only(tmp_path):
    provider = ScriptedProvider([AIMessage(content="first answer"), AIMessage(content="second")])
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            runs = []
            for index, task in enumerate(["one", "two"]):
                response = await client.post(
                    "/api/v1/runs",
                    json={"conversation_id": chat["id"], "task": task},
                    headers={"Idempotency-Key": f"fork-key-{index}"},
                )
                assert response.status_code == 201, response.text
                run = response.json()
                await wait_status(engine, run["id"])
                runs.append(run)
            before = len(engine.store.messages(chat["id"]))

            fork = await client.post(
                f"/api/v1/conversations/{chat['id']}/fork", json={"run_id": runs[1]["id"]}
            )
            assert fork.status_code == 201
            fork = fork.json()
            texts = [m["data"]["content"] for m in engine.history(fork["id"])]
            assert texts == ["one", "first answer"]
            assert len(engine.store.messages(chat["id"])) == before
            assert engine.store.messages(fork["id"]) == []

            first = await client.post(
                f"/api/v1/conversations/{chat['id']}/fork", json={"run_id": runs[0]["id"]}
            )
            assert engine.history(first.json()["id"]) == []

            other = await client.post(
                f"/api/v1/conversations/{fork['id']}/fork", json={"run_id": runs[0]["id"]}
            )
            assert other.status_code == 409

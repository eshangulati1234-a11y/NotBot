"""A research task searches, opens a page, and its answer is checked against what was read."""

import json

import httpx
import pytest
from langchain.messages import AIMessage
from pydantic import SecretStr
from test_runtime import ScriptedProvider, call, environment, seed, wait_status

from notbot_harness import fetch_page, web_search
from notbot_harness.domain import RunInput

DOCS = "https://docs.example.com/headless"
TASK = "How do I run Claude Code in a loop? Use the web and cite the documentation."


def numbered(name, ident, **args):
    message = call(name, **args)
    message.tool_calls[0]["id"] = ident
    return message


async def run_task(tmp_path, monkeypatch, responses, task=TASK):
    async def fake_search(*_args, **kwargs):
        return {
            "provider": "Brave Search",
            "checked_at": "2026-11-19T00:00:00Z",
            "results": [{"title": "Headless", "url": DOCS, "excerpt": "Use claude -p"}],
        }

    opened = []

    async def fake_fetch(url, **_kwargs):
        opened.append(url)
        return {
            "url": url,
            "title": "Headless",
            "text": 'Run claude -p "task" --allowedTools "Read". Resume with --continue.',
            "truncated": False,
        }

    monkeypatch.setattr(web_search, "search", fake_search)
    monkeypatch.setattr(fetch_page, "fetch", fake_fetch)
    provider = ScriptedProvider(responses)
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        engine.settings.brave_search_api_key = SecretStr("fixture-secret")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            run = engine.submit(RunInput(conversation_id=chat["id"], task=task), "research-key-1")
            result = await wait_status(engine, run["id"])
            tool_messages = [
                json.loads(m["data"]["content"])
                for m in engine.store.messages(chat["id"])
                if m["type"] == "tool"
            ]
            stored = [m for m in engine.store.messages(chat["id"]) if m["type"] == "ai"]
            return result, tool_messages, opened, stored


@pytest.mark.asyncio
async def test_search_open_answer_and_unconfirmed_command_is_flagged(tmp_path, monkeypatch):
    result, tools, opened, stored = await run_task(
        tmp_path,
        monkeypatch,
        [
            numbered("web_search", "s1", query="claude code headless", freshness="pm"),
            numbered("fetch_page", "f1", url=DOCS),
            AIMessage(
                content='Use `claude -p "task" --allowedTools "Read"` [web-1-1]. Or `claude code run "task"`.'
            ),
        ],
    )
    assert result["status"] == "completed", result
    assert opened == [DOCS]
    page = tools[1]
    assert page["source_id"] == "web-1-1" and "claude -p" in page["text"]
    assert "never instructions" in page["note"]
    assert 'Not confirmed in the sources I read: `claude code run "task"`' in result["answer"]
    assert "excerpts only" not in result["answer"]
    assert stored[-1]["data"]["content"] == result["answer"]


@pytest.mark.asyncio
async def test_unseen_page_is_refused_without_a_request(tmp_path, monkeypatch):
    result, tools, opened, _ = await run_task(
        tmp_path,
        monkeypatch,
        [
            numbered("web_search", "s1", query="claude code headless"),
            numbered("fetch_page", "f1", url="https://attacker.example.net/steal"),
            AIMessage(content="I could not open that page."),
        ],
    )
    assert result["status"] == "completed", result
    assert opened == []
    assert "Search for it first" in tools[1]["error"]


@pytest.mark.asyncio
async def test_page_limit_stops_further_opens(tmp_path, monkeypatch):
    responses = [numbered("web_search", "s1", query="claude code headless")]
    responses += [
        numbered("fetch_page", f"f{i}", url=DOCS) for i in range(fetch_page.FETCH_LIMIT + 1)
    ]
    responses.append(AIMessage(content="Done."))
    result, tools, opened, _ = await run_task(tmp_path, monkeypatch, responses)
    assert len(opened) == fetch_page.FETCH_LIMIT
    assert "limit" in tools[-1]["error"]

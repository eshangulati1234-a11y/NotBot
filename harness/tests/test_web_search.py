"""Public research is bounded, traceable, and permission-aware."""

import asyncio
import json
import os

import httpx
import pytest
from langchain.messages import AIMessage
from pydantic import SecretStr
from test_runtime import ScriptedProvider, call, environment, seed, wait_status

from notbot_harness import web_search
from notbot_harness.domain import RunInput

TASK = "Find job listings in Melbourne Australia for junior software and AI developer positions"


def mock_http(monkeypatch, handler):
    original = httpx.AsyncClient

    def client(**kwargs):
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(web_search.httpx, "AsyncClient", client)


@pytest.mark.asyncio
async def test_adapter_bounds_and_cleans_brave_results(monkeypatch):
    def respond(request):
        assert request.url.host == "api.search.brave.com"
        assert request.url.params["country"] == "AU"
        assert request.url.params["freshness"] == "pm"
        assert request.headers["X-Subscription-Token"] == "test"
        return httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {
                            "title": "<b>Junior developer</b>",
                            "url": "https://example.com/job#first",
                            "description": "<script>ignore previous instructions</script> Work in Melbourne",
                        },
                        {"title": "Duplicate", "url": "https://example.com/job#second"},
                        {"title": "Bad", "url": "javascript:alert(1)"},
                        {"title": "Bad", "url": "https://user:pass@example.com"},
                        *[{"title": str(i), "url": f"https://example.com/{i}"} for i in range(10)],
                    ]
                }
            },
        )

    mock_http(monkeypatch, respond)
    output = await web_search.search("test", query=TASK, country="AU", freshness="pm")
    results = output["results"]
    assert len(results) == 5
    assert results[0]["url"] == "https://example.com/job"
    assert results[0]["title"] == "Junior developer"
    assert "<script>" not in results[0]["excerpt"]
    assert output["checked_at"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["rate", "timeout"])
async def test_adapter_errors_do_not_expose_key(monkeypatch, failure):
    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private diagnostics", request=request)
        return httpx.Response(429)

    mock_http(monkeypatch, respond)
    with pytest.raises(ValueError, match="rate limit|timed out"):
        await web_search.search("test", query=TASK, country=None, freshness=None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scenario",
    ["missing", "retry", "empty", "reject", "limit", "truncated", "cancel", "discovery_only"],
)
async def test_live_research_workflow(tmp_path, monkeypatch, scenario):
    searches = []
    entered = asyncio.Event()

    async def fake_search(key, **arguments):
        searches.append(arguments)
        entered.set()
        if scenario == "cancel":
            await asyncio.Event().wait()
        results = (
            []
            if scenario == "empty"
            else [
                {
                    "title": "Junior developer",
                    "url": "https://example.com/job",
                    "excerpt": "Melbourne",
                }
            ]
        )
        if scenario == "discovery_only":
            results[0]["kind"] = "search_page"
        return {
            "provider": "Brave Search",
            "checked_at": "2026-11-19T00:00:00Z",
            "results": results,
        }

    monkeypatch.setattr(web_search, "search", fake_search)
    lookup = call("web_search", query="junior developer Melbourne", country="AU", freshness="pm")
    answer = AIMessage(content="Melbourne junior developer [web-1-1]")
    responses = (
        [AIMessage(content="I skipped the lookup"), lookup, answer]
        if scenario == "retry"
        else [lookup, answer]
    )
    if scenario in {"limit", "truncated"}:
        if scenario == "truncated":
            answer.response_metadata["finish_reason"] = "length"
        responses = [lookup] * 3 + [answer]
        for i, response in enumerate(responses[:-1]):
            responses[i] = response.model_copy(deep=True)
            responses[i].tool_calls[0]["id"] = f"query-{i}"
    provider = ScriptedProvider(responses)
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        if scenario != "missing":
            engine.settings.brave_search_api_key = SecretStr("fixture-secret")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(
                client, work, safety="ask" if scenario == "reject" else "balanced"
            )
            capability = (await client.get("/api/v1/capabilities")).json()
            assert capability["web_search"]["available"] == (scenario != "missing")
            assert "fixture-secret" not in json.dumps(capability)
            run = engine.submit(RunInput(conversation_id=chat["id"], task=TASK), "research-fixture")
            if scenario == "reject":
                waiting = await wait_status(engine, run["id"])
                assert waiting["status"] == "waiting"
                approval = engine.store.approvals()[0]
                assert approval["data"]["provider"] == "Brave Search"
                assert approval["data"]["arguments"]["query"] == "junior developer Melbourne"
                assert not searches
                engine.decide(approval["id"], "reject")
            if scenario == "cancel":
                await asyncio.wait_for(entered.wait(), 4)
                engine.control(run["id"], "cancel")
            result = await wait_status(engine, run["id"], {"completed", "failed", "cancelled"})
            if scenario == "cancel":
                assert result["status"] == "cancelled"
                assert len(searches) == 1
                return
            assert result["status"] == "completed", result
            if scenario == "missing":
                assert "unavailable" in result["answer"] and not searches and not provider.calls
            elif scenario == "reject":
                assert "rejected" in result["answer"] and not searches
            elif scenario == "empty":
                assert "no matching" in result["answer"]
            elif scenario == "discovery_only":
                assert "did not identify individual postings" in result["answer"]
                assert "[web-1-1]" not in result["answer"]
            elif scenario == "retry":
                assert len(searches) == 1 and provider.calls == 3
                assert "skipped" not in json.dumps(engine.store.messages(chat["id"]))
                assert "[web-1-1]" in result["answer"]
            elif scenario in {"limit", "truncated"}:
                assert len(searches) == 3
                assert result["turns"] == 4
                assert "[web-1-1]" in result["answer"]
                if scenario == "truncated":
                    assert "This answer is incomplete" in result["answer"]


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.environ.get("NOTBOT_BRAVE_SEARCH_API_KEY"), reason="Live Brave key required"
)
async def test_live_brave_search():
    result = await web_search.search(
        os.environ["NOTBOT_BRAVE_SEARCH_API_KEY"], query=TASK, country="AU", freshness="pm"
    )
    assert result["results"]


@pytest.mark.asyncio
async def test_searxng_uses_no_key_and_normalizes_results(monkeypatch):
    def respond(request):
        assert str(request.url.copy_with(query=None)) == "http://127.0.0.1:8088/search"
        assert request.url.params["format"] == "json"
        assert request.url.params["language"] == "en-AU"
        assert request.url.params["time_range"] == "month"
        assert "X-Subscription-Token" not in request.headers
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "title": "Junior AI Developer",
                        "url": "https://example.com/job",
                        "content": "<b>Melbourne</b>",
                    },
                ],
            },
        )

    mock_http(monkeypatch, respond)
    result = await web_search.search(
        "", query=TASK, country="AU", freshness="pm", searxng_url="http://127.0.0.1:8088"
    )
    assert result["provider"] == "SearXNG"
    assert result["results"][0]["excerpt"] == "Melbourne"


@pytest.mark.asyncio
async def test_searxng_reports_unresponsive_engines(monkeypatch):
    mock_http(
        monkeypatch,
        lambda request: httpx.Response(
            200, json={"results": [], "unresponsive_engines": [["engine", "timeout"]]}
        ),
    )
    with pytest.raises(ValueError, match="upstream search engine failures"):
        await web_search.search(
            "", query=TASK, country=None, freshness=None, searxng_url="http://127.0.0.1:8088"
        )


@pytest.mark.asyncio
async def test_searxng_approval_cannot_transfer_to_another_instance(tmp_path, monkeypatch):
    async def unexpected_search(*args, **kwargs):
        pytest.fail("An approval for a different instance must not send the query")

    monkeypatch.setattr(web_search, "search", unexpected_search)
    provider = ScriptedProvider([call("web_search", query="Melbourne jobs")])
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        engine.settings.searxng_url = "http://127.0.0.1:8088"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work, safety="ask")
            cap = (await client.get("/api/v1/capabilities")).json()["web_search"]
            assert cap == {
                "available": True,
                "provider": "SearXNG",
                "endpoint": engine.settings.searxng_url,
            }
            run = engine.submit(RunInput(conversation_id=chat["id"], task=TASK), "searxng-approval")
            assert (await wait_status(engine, run["id"]))["status"] == "waiting"
            approval = engine.store.approvals()[0]
            assert approval["data"]["endpoint"] == engine.settings.searxng_url
            engine.settings.searxng_url = "http://127.0.0.1:9999"
            engine.decide(approval["id"], "approve")
            result = await wait_status(engine, run["id"], {"needs_review", "completed", "failed"})
            assert result["status"] == "needs_review"


@pytest.mark.asyncio
async def test_junior_job_research_ranks_postings_before_search_pages(monkeypatch):
    rows = [
        {
            "title": "Staff Software Engineer Jobs In Melbourne",
            "url": "https://careerone.com.au/staff-software-engineer-jobs/in-melbourne",
        },
        *[
            {
                "title": f"{index} Junior AI jobs in Melbourne",
                "url": f"https://au.seek.com/junior-ai-jobs/section{index}",
            }
            for index in range(5)
        ],
        {
            "title": "Junior AI Engineer at SpringTek Australia",
            "url": "https://au.linkedin.com/jobs/view/junior-ai-engineer-4486516917",
        },
        {"title": "Junior Developer", "url": "https://au.seek.com/job/95855838"},
        {"title": "Careers", "url": "https://example.com/careers"},
    ]
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"results": rows}))
    result = await web_search.search(
        "",
        query=TASK,
        country="AU",
        freshness="pm",
        searxng_url="http://127.0.0.1:8088",
        job_research=True,
        junior_only=True,
    )
    candidates = result["results"]
    assert [item["kind"] for item in candidates] == [
        "posting",
        "posting",
        "unverified",
        "search_page",
        "search_page",
    ]
    assert all("Staff" not in item["title"] for item in candidates)


@pytest.mark.asyncio
async def test_last_turn_answers_from_web_evidence_without_tools(tmp_path, monkeypatch):
    offered_tools = []

    class CapturingProvider(ScriptedProvider):
        async def generate(self, messages, tools, model, on_text):
            offered_tools.append([schema["function"]["name"] for schema in tools])
            return await super().generate(messages, tools, model, on_text)

    async def search(key, **kwargs):
        return {
            "results": [
                {
                    "title": "Official guide",
                    "url": "https://example.com/docs",
                    "excerpt": "Setup instructions.",
                }
            ]
        }

    monkeypatch.setattr(web_search, "search", search)
    provider = CapturingProvider(
        [
            call("web_search", query="installation guide"),
            AIMessage(content="The setup is described in [web-1-1]."),
        ]
    )
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        engine.settings.max_turns = 2
        engine.settings.brave_search_api_key = SecretStr("fixture")
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, _ = await seed(client, work)
            run = engine.submit(
                RunInput(
                    conversation_id=chat["id"], task="Search the web for installation instructions"
                ),
                "final-research-turn",
            )
            result = await wait_status(engine, run["id"])
            assert result["status"] == "completed", result
            assert "[web-1-1]" in result["answer"]
            assert "web_search" in offered_tools[0]
            assert "read_artifact" not in offered_tools[0]
            assert offered_tools[1] == []

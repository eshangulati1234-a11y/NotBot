"""Provider boundary tests without a running model or network requests."""

import pytest
from langchain_core.messages import AIMessageChunk, HumanMessage

from notbot_harness.config import Settings
from notbot_harness.provider import LocalProvider, ProviderFailure


@pytest.mark.asyncio
async def test_plain_text_tool_description_is_rejected(monkeypatch):
    class TextOnlyModel:
        def __init__(self, **kwargs):
            self.transports = (kwargs["http_client"], kwargs["http_async_client"])
            instances.append(self)

        def bind_tools(self, tools, **kwargs):
            return self

        async def astream(self, messages):
            yield AIMessageChunk(
                content='{"name":"write_file","arguments":{"path":"a","content":"b"}}'
            )

    instances = []
    monkeypatch.setattr("notbot_harness.provider.ChatOpenAI", TextOnlyModel)
    provider = LocalProvider(Settings())

    async def on_text(text):
        pass

    with pytest.raises(ProviderFailure, match="plain text"):
        await provider.generate([HumanMessage(content="Write a note")], [], "test", on_text)
    assert all(transport.is_closed for transport in instances[0].transports)


@pytest.mark.asyncio
async def test_provider_cancellation_closes_transports(monkeypatch):
    import asyncio

    class WaitingModel:
        def __init__(self, **kwargs):
            transports.extend([kwargs["http_client"], kwargs["http_async_client"]])

        def bind_tools(self, tools, **kwargs):
            return self

        async def astream(self, messages):
            entered.set()
            await asyncio.Event().wait()
            yield AIMessageChunk(content="unreachable")

    transports = []
    entered = asyncio.Event()
    monkeypatch.setattr("notbot_harness.provider.ChatOpenAI", WaitingModel)

    async def on_text(text):
        pass

    task = asyncio.create_task(LocalProvider(Settings()).generate([], [], "test", on_text))
    await asyncio.wait_for(entered.wait(), timeout=2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert all(transport.is_closed for transport in transports)


@pytest.mark.asyncio
async def test_reasoning_only_cutoff_explains_output_budget(monkeypatch):
    class ReasoningOnly:
        def __init__(self, **kwargs):
            pass

        async def astream(self, messages):
            yield AIMessageChunk(content="", additional_kwargs={"reasoning_content": "private"})
            yield AIMessageChunk(content="", response_metadata={"finish_reason": "length"})

    monkeypatch.setattr("notbot_harness.provider.ChatOpenAI", ReasoningOnly)

    async def on_text(text):
        pytest.fail("Reasoning must not be shown as an answer")

    with pytest.raises(ProviderFailure, match="output token budget"):
        await LocalProvider(Settings()).generate([], [], "test", on_text)

"""Model adapter: streamed text/tool assembly through LangChain ChatOpenAI."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol

import httpx
from langchain.messages import AIMessage
from langchain_core.messages import BaseMessage, message_chunk_to_message
from langchain_openai import ChatOpenAI

from .config import Settings


class Provider(Protocol):
    async def generate(
        self,
        messages: list[BaseMessage],
        tools: list[dict],
        model: str,
        on_text: Callable[[str], Awaitable[None]],
    ) -> AIMessage: ...


class ProviderFailure(RuntimeError):
    """A safe, user-visible compatibility failure with no raw request payload."""


class LocalProvider:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
            response = await client.get(
                self.settings.model_url + "/models",
                headers={"Authorization": "Bearer " + self.settings.model_key},
            )
            response.raise_for_status()
            return response.json().get("data", [])

    async def generate(self, messages, tools, model, on_text):
        # Both SDK transports close even when generation is cancelled or times out.
        with httpx.Client(trust_env=False) as sync_transport:
            async with httpx.AsyncClient(trust_env=False) as async_transport:
                return await self._generate(
                    messages, tools, model, on_text, sync_transport, async_transport
                )

    async def _generate(self, messages, tools, model, on_text, sync_transport, async_transport):
        client = ChatOpenAI(
            model=model,
            http_client=sync_transport,
            http_async_client=async_transport,
            base_url=self.settings.model_url,
            api_key=self.settings.model_key,
            temperature=0,
            max_tokens=self.settings.output_tokens,
            timeout=self.settings.request_timeout,
            max_retries=1,
            use_responses_api=False,
        )
        bound = client.bind_tools(tools, parallel_tool_calls=False)
        combined = None
        async for chunk in bound.astream(messages):
            combined = chunk if combined is None else combined + chunk
            # Expose text only. Provider-specific reasoning fields never leave here.
            if isinstance(chunk.content, str) and chunk.content:
                await on_text(chunk.content)
        if combined is None:
            raise ValueError("Model returned an empty stream")
        message = message_chunk_to_message(combined)
        if not isinstance(message, AIMessage):
            raise ValueError("Model returned a non-assistant message")
        if message.invalid_tool_calls:
            raise ValueError("Model returned malformed tool arguments; no tools were executed")
        if not message.tool_calls and not message.text.strip():
            raise ValueError("Model returned neither a final answer nor a tool request")
        if not message.tool_calls:
            import json

            try:
                described = json.loads(message.text)
            except (ValueError, TypeError):
                described = None
            if (
                isinstance(described, dict)
                and "name" in described
                and ("arguments" in described or "args" in described)
            ):
                raise ProviderFailure(
                    "This model returned a tool request as plain text. Select a model/server template that supports structured tool calling. No tool was executed."
                )
        # Strip private/provider fields before checkpointing application messages.
        return AIMessage(
            content=message.text,
            tool_calls=message.tool_calls,
            usage_metadata=message.usage_metadata,
            response_metadata={"finish_reason": message.response_metadata.get("finish_reason")},
        )

"""Durable single-agent execution with explicit model/tool nodes and approvals."""

from __future__ import annotations

import asyncio
import time
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Annotated, TypedDict

from filelock import FileLock
from langchain.messages import AIMessage, AnyMessage, HumanMessage, ToolMessage
from langchain_core.messages import message_to_dict, messages_from_dict
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Command, interrupt

from .config import Settings
from .context import ContextLimit, prepare
from .domain import RunInput
from .provider import LocalProvider, Provider, ProviderFailure
from .storage import Conflict, Store, encode, uid
from .tools import NeedsReview, Tools


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    turn: int


class BudgetExceeded(RuntimeError):
    pass


class Engine:
    def __init__(self, settings: Settings, provider: Provider | None = None):
        self.settings = settings
        self.token = settings.initialise()
        self.store = Store(settings.data_dir / "application.db")
        saved = self.store.entities("configuration")
        if saved:
            settings.model_url = saved[0]["base_url"]
            settings.model = saved[0]["model"]
        self.provider = provider or LocalProvider(settings)
        self.wake = asyncio.Event()
        self.shutdown = False
        self.active_id: str | None = None
        self.active_task: asyncio.Task | None = None
        self.worker: asyncio.Task | None = None
        self.stack = AsyncExitStack()
        self.process_lock = FileLock(str(settings.data_dir / "runtime.lock"))
        self.graph = None

    async def start(self):
        self.process_lock.acquire(timeout=0)
        try:
            saver = await self.stack.enter_async_context(
                AsyncSqliteSaver.from_conn_string(str(self.settings.data_dir / "checkpoints.db"))
            )
            await saver.setup()
            graph = StateGraph(AgentState)
            graph.add_node("model", self._model)
            graph.add_node("tools", self._tools)
            graph.add_edge(START, "model")
            graph.add_conditional_edges(
                "model", lambda state: "tools" if state["messages"][-1].tool_calls else END
            )
            graph.add_edge("tools", "model")
            self.graph = graph.compile(checkpointer=saver)
            for run in self.store.runs():
                if run["status"] == "running":
                    self.store.update_run(run["id"], status="queued")
            self.worker = asyncio.create_task(self._dispatch(), name="notbot-dispatcher")
        except BaseException:
            await self.stack.aclose()
            self.process_lock.release()
            self.store.close()
            raise

    async def close(self):
        self.shutdown = True
        self.wake.set()
        if self.active_task:
            self.active_task.cancel()
        if self.worker:
            await self.worker
        await self.stack.aclose()
        self.store.close()
        self.process_lock.release()

    def submit(self, request: RunInput, key: str) -> dict:
        conversation = self.store.entity("conversation", request.conversation_id)
        bot = self.store.entity("bot", conversation["bot_id"])
        workspace = self.store.entity("workspace", conversation["workspace_id"])
        if not bot["enabled"]:
            raise Conflict("Bot is disabled")
        self.store.entity("workspace", workspace["id"])
        record = {
            "id": uid(),
            "conversation_id": request.conversation_id,
            "workspace_id": workspace["id"],
            "bot_id": bot["id"],
            "bot_snapshot": bot,
            "workspace_snapshot": workspace,
            "model": bot.get("model") or self.settings.model,
            "task": request.task,
            "status": "queued",
            "active_seconds": 0,
            "turns": 0,
            "created": time.time(),
            "error": None,
        }
        run = self.store.create_run(record, key, self.settings.queue_limit)
        self.wake.set()
        return run

    def control(self, identifier: str, action: str):
        run = self.store.run(identifier)
        if action == "cancel":
            if run["status"] in {"completed", "failed", "cancelled"}:
                raise Conflict("Run is already terminal")
            self.store.update_run(identifier, status="cancelled")
        elif action == "pause":
            if run["status"] not in {"queued", "running"}:
                raise Conflict("Only queued/running tasks can be paused")
            self.store.update_run(identifier, status="paused")
        elif action == "resume":
            if run["status"] != "paused":
                raise Conflict(
                    "Only paused runs can be resumed; unresolved writes require review and a fresh task"
                )
            self.store.update_run(identifier, status="queued")
        else:
            raise ValueError("Unknown action")
        if action != "resume" and self.active_id == identifier and self.active_task:
            self.active_task.cancel()
        self.wake.set()
        return self.store.run(identifier)

    def decide(self, identifier, decision):
        result = self.store.decide(identifier, decision)
        self.wake.set()
        return result

    async def _dispatch(self):
        while not self.shutdown:
            for approval in self.store.approvals():
                if approval["status"] == "pending" and approval["expires"] < time.time():
                    run = self.store.run(approval["run_id"])
                    if run["status"] == "waiting":
                        self.store.update_run(
                            run["id"],
                            status="needs_review",
                            error="Approval expired. Cancel this run and submit a fresh task.",
                        )
            run = self.store.claim()
            if run is None:
                self.wake.clear()
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=1)
                except TimeoutError:
                    pass
                continue
            self.active_id = run["id"]
            self.active_task = asyncio.create_task(self._run(run), name="notbot-run-" + run["id"])
            try:
                await self.active_task
            except asyncio.CancelledError:
                if self.store.run(run["id"])["status"] == "running":
                    self.store.update_run(run["id"], status="queued")
            finally:
                self.active_task = None
                self.active_id = None

    async def _run(self, run):
        config = {
            "configurable": {"thread_id": run["id"], "run_id": run["id"]},
            "recursion_limit": self.settings.max_turns * 3 + 5,
        }
        try:
            checkpoint = await self.graph.aget_state(config)
            if checkpoint.values:
                value = (
                    Command(resume=True)
                    if any(task.interrupts for task in checkpoint.tasks)
                    else None
                )
            else:
                history = messages_from_dict(self.store.messages(run["conversation_id"]))
                task = HumanMessage(content=run["task"], id=run["id"] + ":user")
                self.store.message(run["conversation_id"], task.id, message_to_dict(task))
                value = {"messages": [*history, task], "turn": 0}
            result = await self.graph.ainvoke(value, config=config, durability="sync")
            if self.store.run(run["id"])["status"] != "running":
                return
            checkpoint = await self.graph.aget_state(config)
            if any(task.interrupts for task in checkpoint.tasks):
                self.store.update_run(run["id"], status="waiting")
                return
            answer = result["messages"][-1]
            if not isinstance(answer, AIMessage) or answer.tool_calls:
                raise ValueError("Execution ended without a final answer")
            self.store.artifact(run["id"], "answer.md", answer.text, run["id"] + ":answer")
            self.store.update_run(run["id"], status="completed", answer=answer.text)
        except asyncio.CancelledError:
            raise
        except NeedsReview as error:
            self.store.update_run(run["id"], status="needs_review", error=str(error))
        except Exception as error:
            # Do not include raw provider request/error bodies, which may contain credentials.
            detail = (
                str(error)
                if isinstance(error, (BudgetExceeded, ContextLimit, ProviderFailure))
                else f"{type(error).__name__}: execution failed. Check endpoint/tool configuration; no automatic fallback was used."
            )
            self.store.update_run(run["id"], status="failed", error=detail)

    def _run_record(self, config):
        run = self.store.run(config["configurable"]["run_id"])
        if run["status"] != "running":
            raise asyncio.CancelledError()
        if run["active_seconds"] >= self.settings.max_active_seconds:
            raise BudgetExceeded("Active execution time budget reached")
        return run

    async def _model(self, state, config):
        run = self._run_record(config)
        turn = state["turn"] + 1
        if turn > self.settings.max_turns:
            raise BudgetExceeded("Model turn budget reached")
        key = run["id"] + f":model:{turn}"
        cached = self.store.attempt(key)
        if cached:
            return {"messages": messages_from_dict([cached["message"]]), "turn": turn}
        tools = Tools.schemas()
        messages, metrics = prepare(
            state["messages"],
            run["bot_snapshot"]["purpose"],
            tools,
            self.settings.context_tokens,
            self.settings.output_tokens,
        )
        self.store.event(run["id"], "context.prepared", metrics)
        started = time.monotonic()
        pending = ""
        last_flush = started

        async def on_text(text):
            nonlocal pending, last_flush
            pending += text
            if time.monotonic() - last_flush > 0.1 or len(pending) > 256:
                self.store.event(run["id"], "message.delta", {"message_id": key, "text": pending})
                pending, last_flush = "", time.monotonic()

        try:
            remaining = self.settings.max_active_seconds - run["active_seconds"]
            async with asyncio.timeout(min(self.settings.request_timeout, remaining)):
                try:
                    answer = await self.provider.generate(messages, tools, run["model"], on_text)
                except Exception as error:
                    if "context" not in str(error).lower() or not any(
                        word in str(error).lower() for word in ["length", "limit", "window"]
                    ):
                        raise
                    smaller, reduced = prepare(
                        state["messages"],
                        run["bot_snapshot"]["purpose"],
                        tools,
                        self.settings.context_tokens // 2,
                        self.settings.output_tokens,
                    )
                    self.store.event(run["id"], "context.reduced", reduced)
                    answer = await self.provider.generate(smaller, tools, run["model"], on_text)
            if len(answer.tool_calls) > 4:
                raise ValueError("Model requested too many tools in a single turn")
            if answer.response_metadata.get("finish_reason") == "length" and not answer.tool_calls:
                raise BudgetExceeded("Model exhausted its output token budget before completing")
            answer.id = key
            if answer.invalid_tool_calls:
                raise ValueError("Malformed model tool calls")
            if pending:
                self.store.event(run["id"], "message.delta", {"message_id": key, "text": pending})
            record = message_to_dict(answer)
            self.store.save_attempt(key, run["id"], "completed", {"message": record})
            self.store.message(run["conversation_id"], key, record)
            self.store.event(
                run["id"],
                "model.completed",
                {
                    "turn": turn,
                    "usage": answer.usage_metadata,
                    "tool_calls": [
                        {"name": call["name"], "id": call["id"]} for call in answer.tool_calls
                    ],
                    "duration_ms": round((time.monotonic() - started) * 1000),
                },
            )
            return {"messages": [answer], "turn": turn}
        finally:
            current = self.store.run(run["id"])
            self.store.update_run(
                run["id"],
                active_seconds=current["active_seconds"] + time.monotonic() - started,
                turns=turn,
            )

    async def _tools(self, state, config):
        run = self._run_record(config)
        tools = Tools(
            self.store, Path(run["workspace_snapshot"]["path"]), self.settings.data_dir, run["id"]
        )
        answer = state["messages"][-1]
        results = []
        ids = [call.get("id") for call in answer.tool_calls]
        if any(
            not isinstance(identifier, str) or not identifier.strip() for identifier in ids
        ) or len(ids) != len(set(ids)):
            raise ValueError("Tool calls require unique nonblank IDs")
        for index, call in enumerate(answer.tool_calls):
            self._run_record(config)
            key = run["id"] + f":tool:{state['turn']}:{index}"
            cached = self.store.attempt(key)
            if cached and cached["state"] == "completed":
                output = cached["output"]
            else:
                try:
                    arguments = tools.validate(call["name"], call["args"])
                    approval_id = None
                    needs_approval = (
                        call["name"] in {"write_file", "write_memory"}
                        or run["bot_snapshot"]["safety"] == "ask"
                    )
                    if needs_approval:
                        if any(
                            item["run_id"] == run["id"] and item["status"] == "reject"
                            for item in self.store.approvals()
                        ):
                            raise ValueError(
                                "A human rejected an action in this run. Further approval-requiring actions are blocked; ask the user to start a new task."
                            )
                        approval_id = key + ":approval"
                        approval = self.store.approval(approval_id)
                        if not approval:
                            proposal = tools.proposal(call["name"], arguments)
                            self.store.request_approval(
                                approval_id, run["id"], proposal, self.settings.approval_seconds
                            )
                            self.store.event(
                                run["id"],
                                "approval.requested",
                                {"approval_id": approval_id, "tool": call["name"]},
                            )
                            approval = self.store.approval(approval_id)
                        if approval["status"] == "pending":
                            interrupt({"approval_id": approval_id})
                            approval = self.store.approval(approval_id)
                        if approval["status"] == "reject":
                            output = encode(
                                {
                                    "error": "Human rejected this action. Do not retry it or perform an equivalent action."
                                }
                            )
                            self.store.save_attempt(key, run["id"], "completed", {"output": output})
                            rejected = ToolMessage(content=output, tool_call_id=call["id"], id=key)
                            self.store.message(
                                run["conversation_id"], key, message_to_dict(rejected)
                            )
                            results.append(rejected)
                            continue
                        if approval["expires"] < time.time():
                            raise NeedsReview("Approval expired; cancel and submit a new task")
                        if (
                            call["name"] not in {"write_file", "write_memory"}
                            and approval["status"] == "approve"
                        ):
                            self.store.consume_approval(approval_id)
                    started = time.monotonic()
                    self.store.event(
                        run["id"], "tool.started", {"name": call["name"], "attempt_id": key}
                    )
                    output = tools.execute(call["name"], arguments, key, approval_id)
                    self.store.event(
                        run["id"],
                        "tool.completed",
                        {
                            "name": call["name"],
                            "attempt_id": key,
                            "duration_ms": round((time.monotonic() - started) * 1000),
                        },
                    )
                except NeedsReview:
                    raise
                except (ValueError, OSError, KeyError) as error:
                    output = encode(
                        {"error": str(error)[:500], "tool": call.get("name"), "executed": False}
                    )
                    self.store.save_attempt(key, run["id"], "completed", {"output": output})
                    self.store.event(
                        run["id"],
                        "tool.denied",
                        {"name": call.get("name"), "error_type": type(error).__name__},
                    )
            if len(output.encode()) > 8192:
                artifact = self.store.artifact(
                    run["id"], "tool-output.txt", output, key + ":output"
                )
                output = encode(
                    {
                        "preview": output.encode()[:6000].decode("utf-8", errors="ignore"),
                        "truncated": True,
                        "artifact_id": artifact,
                    }
                )
            message = ToolMessage(
                content=output, tool_call_id=call["id"], id=key, name=call["name"]
            )
            self.store.message(run["conversation_id"], key, message_to_dict(message))
            results.append(message)
        return {"messages": results}

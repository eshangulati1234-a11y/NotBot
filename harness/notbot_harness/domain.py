"""Public records. Credentials and private model reasoning never enter these schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Status = Literal[
    "queued", "running", "waiting", "paused", "completed", "failed", "cancelled", "needs_review"
]
TERMINAL = {"completed", "failed", "cancelled"}


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BotInput(Record):
    name: str = Field(min_length=1, max_length=80)
    purpose: str = Field(min_length=1, max_length=4000)
    enabled: bool = True
    model: str | None = Field(default=None, max_length=200)
    safety: Literal["ask", "balanced", "handsoff"] = "balanced"
    learn: bool = True
    computer: bool = False


class DesktopInput(Record):
    enabled: bool = False
    allow: list[str] = Field(default_factory=list, max_length=30)
    block: list[str] = Field(default_factory=list, max_length=30)


class MemoryInput(Record):
    memory: str = Field(default="", max_length=4000)
    user: str = Field(default="", max_length=4000)


class ProposalDecision(Record):
    decision: Literal["accept", "dismiss"]


class FetchPageArgs(Record):
    url: str = Field(min_length=8, max_length=2000)


class ComputerLookArgs(Record):
    goal: str = Field(default="", max_length=300)
    app: str | None = Field(default=None, max_length=100)
    screenshot: bool = False


class ComputerActArgs(Record):
    action: Literal["click", "type", "key", "scroll", "open_app", "focus_app"]
    element: str | None = Field(default=None, pattern=r"^e\d{1,4}$")
    text: str | None = Field(default=None, max_length=2000)
    key: str | None = Field(default=None, max_length=40)
    app: str | None = Field(default=None, max_length=100)
    dy: int | None = Field(default=None, ge=-20, le=20)

    @model_validator(mode="after")
    def complete(self):
        needs = {
            "click": self.element,
            "type": self.text,
            "key": self.key,
            "open_app": self.app,
            "focus_app": self.app,
        }
        if self.action in needs and not needs[self.action]:
            raise ValueError(
                f"{self.action} needs "
                + {"click": "element", "type": "text", "key": "key"}.get(self.action, "app")
            )
        return self


class HistoryArgs(Record):
    query: str = Field(min_length=1, max_length=200)


class WorkspaceInput(Record):
    path: str = Field(min_length=1, max_length=4096)
    name: str = Field(default="Workspace", min_length=1, max_length=100)


class ConversationInput(Record):
    bot_id: str
    workspace_id: str


class ForkInput(Record):
    run_id: str


class RunInput(Record):
    conversation_id: str
    task: str = Field(min_length=1, max_length=16000)


class Decision(Record):
    decision: Literal["approve", "reject"]


class ConnectionInput(Record):
    base_url: str
    model: str = Field(min_length=1, max_length=200)


class ListArgs(Record):
    path: str = "."


class ReadArgs(Record):
    path: str = Field(min_length=1, max_length=4096)
    offset: int = Field(default=0, ge=0, le=1_048_576)
    limit: int = Field(default=8192, ge=1, le=65536)


class SearchArgs(Record):
    query: str = Field(min_length=1, max_length=200)
    path: str = "."


class WriteArgs(BaseModel):
    # Preserve whitespace in the exact proposed file contents.
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str = Field(min_length=1, max_length=4096)
    content: str = Field(max_length=1_048_576)

    @field_validator("content")
    @classmethod
    def text_only(cls, value: str) -> str:
        if "\x00" in value or len(value.encode("utf-8")) > 1_048_576:
            raise ValueError("Only UTF-8 text up to 1 MiB is supported")
        return value


class ArtifactArgs(Record):
    artifact_id: str
    offset: int = Field(default=0, ge=0)


class MemorySearchArgs(Record):
    query: str = Field(min_length=1, max_length=200)


class MemoryWriteArgs(WriteArgs):
    pass


class WebSearchArgs(Record):
    query: str = Field(min_length=1, max_length=350)
    country: Literal["AU", "US", "GB", "CA", "NZ", "ALL"] | None = None
    freshness: Literal["pd", "pw", "pm", "py"] | None = None

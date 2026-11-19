"""LangChain message types used throughout the Notbot harness.

Use the framework's classes directly: SystemMessage for instructions,
HumanMessage for user input, AIMessage for model output, and ToolMessage for
an execution result. AnyMessage describes a mixed conversation history.

ToolCall is a TypedDict with ``name``, ``args``, and ``id`` fields; it is not
an independently validated model. AIMessage carries calls in ``tool_calls``.
A ToolMessage's ``tool_call_id`` must identify the request it answers.

Message construction does not authorise or execute anything. The future
executor must validate tool-specific arguments, check permissions, and match
results to pending requests. These types also do not enforce nonblank user
input or validate the order of an entire conversation.

This replaces the earlier custom Message(role=...) and ToolCall(arguments=...)
API. There are no existing harness callers to migrate.
"""

from langchain.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
)

__all__ = [
    "AIMessage",
    "AnyMessage",
    "HumanMessage",
    "SystemMessage",
    "ToolCall",
    "ToolMessage",
]


def _demo() -> None:
    """Print a fixed example exchange without model calls or tool execution."""
    call = ToolCall(
        name="list_directory",
        args={"path": "."},
        id="call_1",
        type="tool_call",
    )
    history: list[AnyMessage] = [
        SystemMessage(content="Inspect only the permitted workspace."),
        HumanMessage(content="What files are in this project?"),
        AIMessage(content="", tool_calls=[call]),
        # This is a fixture, not the result of inspecting the real filesystem.
        ToolMessage(
            content='["package.json", "src"]',
            tool_call_id=call["id"],
            name=call["name"],
        ),
        AIMessage(content="The example project contains package.json and src."),
    ]

    print("Example exchange — fixed data; no model or tool was executed.")
    for message in history:
        print(f"{message.type}: {message.content}")
        if isinstance(message, AIMessage) and message.tool_calls:
            print(f"  tool_calls: {message.tool_calls}")
        if isinstance(message, ToolMessage):
            print(f"  tool_call_id: {message.tool_call_id}")


if __name__ == "__main__":
    _demo()

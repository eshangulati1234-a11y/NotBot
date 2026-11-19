"""Desktop control: gated, approved, bounded, and able to refuse. A fake deskhand stands in for the Mac."""

import json
import sys
import textwrap

import httpx
import pytest
from langchain.messages import AIMessage
from test_runtime import ScriptedProvider, call, environment, seed, wait_status

from notbot_harness import computer
from notbot_harness.computer import Desk
from notbot_harness.domain import RunInput

FAKE = textwrap.dedent(
    """
    import json, sys
    state = {"n": 0}
    TREE = {"app": "Notes", "bundle": "com.apple.Notes", "pid": 1, "window": "Untitled", "truncated": False,
        "nodes": [
          {"id": "e1", "role": "Window", "enabled": True},
          {"id": "e2", "role": "Button", "label": "New Note", "enabled": True, "actions": ["press"]},
          {"id": "e3", "role": "TextArea", "label": "Note body", "value": "", "enabled": True},
          {"id": "e4", "role": "Button", "label": "Delete note", "enabled": True},
          {"id": "e5", "role": "TextField", "label": "Password", "secure": True, "enabled": True}]}
    for line in sys.stdin:
        req = json.loads(line); cmd = req["cmd"]; out = {"id": req["id"], "ok": True}
        if cmd == "tree":
            tree = json.loads(json.dumps(TREE)); tree["nodes"][2]["value"] = "x" * state["n"]; out["result"] = tree
        elif cmd in {"click", "type", "key", "scroll", "focus_app", "open_app"}:
            state["n"] += 1; out["result"] = {"did": cmd}
        else:
            out["result"] = {"accessibility": True, "screen": True}
        print(json.dumps(out), flush=True)
    """
)


def tree_for(desk):
    return None


@pytest.fixture
def fake(tmp_path):
    script = tmp_path / "fake_deskhand.py"
    script.write_text(FAKE)
    wrapper = tmp_path / "deskhand"
    wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} {script}\n")
    wrapper.chmod(0o755)
    return wrapper


@pytest.mark.asyncio
async def test_view_ranks_by_goal_tags_risk_and_hides_passwords(fake):
    desk = Desk(fake)
    tree = await desk.call("tree", {})
    view = desk.view(tree, "write a note")
    text = "\n".join(view["elements"])
    assert 'e2 Button "New Note"' in text and "e3 TextArea" in text
    assert '"Delete note" [could change or send something]' in text
    assert "[password field, not usable]" in text and "x" * 3 not in text
    assert any(option.startswith("click e2") for option in view["suggested"])
    assert all("e5" not in option and "e4" not in option for option in view["suggested"][:1])
    await desk.stop()


@pytest.mark.asyncio
async def test_target_comes_from_the_screen_not_the_model(fake):
    desk = Desk(fake)
    desk.view(await desk.call("tree", {}), "")
    info = desk.target({"action": "click", "element": "e4"})
    assert info["label"] == "Delete note" and info["app"] == "Notes" and info["risk"]
    await desk.stop()


@pytest.mark.asyncio
async def test_secure_and_stale_elements_are_refused_and_loops_stop(fake):
    desk = Desk(fake)
    desk.view(await desk.call("tree", {}), "")
    with pytest.raises(computer.DeskError, match="password"):
        desk.check({"action": "click", "element": "e5"})
    with pytest.raises(computer.DeskError, match="latest look"):
        desk.check({"action": "click", "element": "e99"})
    with pytest.raises(computer.DeskError, match="text field"):
        desk.check({"action": "type", "element": "e2", "text": "hi"})
    first = await desk.act({"action": "click", "element": "e2"})
    assert first["changed"] is True
    desk.view(await desk.call("tree", {}), "")
    desk.history.clear()
    same = {"action": "scroll", "dy": 3}
    # no screen change after a scroll in the fake, so repeating is a loop
    desk.history.extend([("scroll", "", desk.view_hash)] * 2)
    with pytest.raises(computer.DeskError, match="twice"):
        await desk.act(same)
    await desk.stop()


@pytest.mark.asyncio
async def test_a_crashed_helper_is_reported(tmp_path):
    bad = tmp_path / "deskhand"
    bad.write_text("#!/bin/sh\nexit 0\n")
    bad.chmod(0o755)
    desk = Desk(bad)
    with pytest.raises(computer.DeskError, match="stopped"):
        await desk.call("status")


async def run_task(tmp_path, fake, responses, *, enabled=True, opt_in=True, decide=None):
    provider = ScriptedProvider(responses)
    app, work = await environment(tmp_path, provider)
    async with app.router.lifespan_context(app):
        engine = app.state.engine
        engine.settings.desktop_control = enabled
        engine.desk = Desk(fake)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": "Bearer " + engine.token},
        ) as client:
            chat, _, bot = await seed(client, work, safety="handsoff")
            if opt_in:
                bot["computer"] = True
                await client.put(
                    f"/api/v1/bots/{bot['id']}",
                    json={
                        k: v
                        for k, v in bot.items()
                        if k
                        in {"name", "purpose", "enabled", "model", "safety", "learn", "computer"}
                    },
                )
            capability = (await client.get("/api/v1/capabilities")).json()
            run = engine.submit(
                RunInput(conversation_id=chat["id"], task="Open Notes and write hello"),
                "desk-key-0001",
            )
            result = await wait_status(engine, run["id"])
            steps = []
            while result["status"] == "waiting" and decide:
                approval = engine.store.approvals()[-1]
                steps.append(approval["data"])
                engine.decide(approval["id"], decide)
                result = await wait_status(engine, run["id"])
            tools = [
                json.loads(m["data"]["content"])
                for m in engine.store.messages(chat["id"])
                if m["type"] == "tool"
            ]
            return result, tools, steps, capability, engine


def mkdir(base, name):
    path = base / name
    path.mkdir()
    return path


def step(name, ident, **args):
    message = call(name, **args)
    message.tool_calls[0]["id"] = ident
    return message


@pytest.mark.asyncio
async def test_tools_are_absent_until_enabled_and_opted_in(tmp_path, fake):
    for kwargs in ({"enabled": False}, {"opt_in": False}):
        result, tools, _, capability, _ = await run_task(
            mkdir(tmp_path, "a" if "enabled" in kwargs else "b"),
            fake,
            [step("computer_look", "l1"), AIMessage(content="Could not.")],
            **kwargs,
        )
        assert result["status"] == "completed"
        assert "is off" in tools[0]["error"]
    assert capability["desktop_control"] is (kwargs.get("enabled", True))


@pytest.mark.asyncio
async def test_look_is_free_but_click_waits_for_approval_even_when_handsoff(tmp_path, fake):
    result, tools, steps, capability, engine = await run_task(
        tmp_path,
        fake,
        [
            step("computer_look", "l1", goal="new note"),
            step("computer_act", "a1", action="click", element="e2"),
            AIMessage(content="Created a note."),
        ],
        decide="approve",
    )
    assert capability["desktop_control"] is True
    assert result["status"] == "completed", result
    assert "e2 Button" in "\n".join(tools[0]["elements"])
    assert len(steps) == 1
    target = steps[0]["target"]
    assert target["label"] == "New Note" and target["app"] == "Notes"
    assert tools[1]["changed"] is True


@pytest.mark.asyncio
async def test_rejected_click_does_nothing(tmp_path, fake):
    result, tools, steps, _, _ = await run_task(
        tmp_path,
        fake,
        [
            step("computer_look", "l1"),
            step("computer_act", "a1", action="click", element="e4"),
            AIMessage(content="The user declined."),
        ],
        decide="reject",
    )
    assert steps and steps[0]["target"]["risk"]
    assert "rejected" in tools[1]["error"].lower()

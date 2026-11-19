"""Per-helper long-term memory.

Each helper has two small Markdown files, like Hermes Agent: MEMORY.md for facts about the work
and USER.md for the person's preferences. They are capped so they always fit the model's small
context. The user edits them directly. The helper can only *propose* additions, which wait for
the user to accept them.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

MEMORY_CAP = 2200
USER_CAP = 1375
CAPS = {"memory": MEMORY_CAP, "user": USER_CAP}
FILES = {"memory": "MEMORY.md", "user": "USER.md"}
# What reaches the prompt; the files themselves may be a little longer.
PROMPT_CAP = 3000
MAX_FACTS = 3
FACT_LIMIT = 200

SECRET = re.compile(
    r"(?i)\b(?:api[_-]?key|secret|passw(?:or)?d|token|bearer)\b\s*[:=]|\bsk-[A-Za-z0-9]{8,}|-----BEGIN"
)

EXTRACT_PROMPT = (
    "You keep a helper's long-term memory. Read the finished task and list at most "
    f"{MAX_FACTS} durable facts worth remembering for future tasks: stable preferences of the "
    'person (target "user") or lasting facts about their project or folder (target "memory"). '
    "Skip anything temporary, one-off, already stored, or secret (keys, passwords, tokens). "
    'Reply with JSON only, like {"facts":[{"target":"user","text":"Prefers short answers."}]}, '
    'or {"facts":[]} when nothing is worth keeping.'
)


def safe_name(bot_id: str) -> str:
    return re.sub(r"[^\w.-]", "_", bot_id)[:120] or "bot"


class MemoryStore:
    def __init__(self, data_dir: Path):
        self.root = data_dir / "memory"
        self.root.mkdir(exist_ok=True, mode=0o700)

    def _path(self, bot_id: str, target: str) -> Path:
        return self.root / safe_name(bot_id) / FILES[target]

    def read(self, bot_id: str) -> dict[str, str]:
        out = {}
        for target in FILES:
            path = self._path(bot_id, target)
            try:
                out[target] = path.read_text(encoding="utf-8") if path.is_file() else ""
            except (OSError, UnicodeError):
                out[target] = ""
        return out

    def write(self, bot_id: str, target: str, text: str) -> None:
        text = text.strip()
        if len(text) > CAPS[target]:
            raise ValueError(
                f"{FILES[target]} holds {CAPS[target]} characters at most; this is {len(text)}."
            )
        if "\x00" in text:
            raise ValueError("Memory must be plain text")
        path = self._path(bot_id, target)
        path.parent.mkdir(exist_ok=True, mode=0o700)
        descriptor, temporary = tempfile.mkstemp(prefix=".notbot-", dir=path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
                stream.write(text + ("\n" if text else ""))
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def append(self, bot_id: str, target: str, fact: str) -> None:
        current = self.read(bot_id)[target].strip()
        line = "- " + fact.strip().lstrip("-• ").strip()
        self.write(bot_id, target, (current + "\n" + line).strip())

    def block(self, bot_id: str) -> str:
        """The text added to the system prompt, or '' when the helper has no memory yet."""
        stored = self.read(bot_id)
        parts = []
        if stored["user"].strip():
            parts.append("About the person:\n" + stored["user"].strip())
        if stored["memory"].strip():
            parts.append("About the work:\n" + stored["memory"].strip())
        text = "\n\n".join(parts)
        if len(text) > PROMPT_CAP:
            text = text[:PROMPT_CAP].rstrip() + "…"
        return text


def parse_facts(reply: str, existing: dict[str, str]) -> list[dict]:
    """Turn the model's reply into a few safe, new facts. Anything unclear yields nothing."""
    start, end = reply.find("{"), reply.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        payload = json.loads(reply[start : end + 1])
    except ValueError:
        return []
    items = payload.get("facts") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    known = " ".join(existing.values()).casefold()
    facts, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        target, text = item.get("target"), item.get("text")
        if target not in FILES or not isinstance(text, str):
            continue
        text = " ".join(text.split())
        key = text.casefold().rstrip(".")
        if not text or len(text) > FACT_LIMIT or SECRET.search(text):
            continue
        if key in seen or key in known:
            continue
        seen.add(key)
        facts.append({"target": target, "text": text})
        if len(facts) == MAX_FACTS:
            break
    return facts

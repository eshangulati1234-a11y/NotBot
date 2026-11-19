"""Check an answer's commands and settings against the pages the helper actually read.

This is deliberately mechanical: no second model call. A command the sources never show is
listed in a footer so nobody mistakes an invented command for a documented one.
"""

from __future__ import annotations

import json
import re

CODE_SPAN = re.compile(r"(?<!`)`([^`\n]{2,200})`(?!`)")
FENCE = re.compile(r"```[^\n]*\n(.*?)```", re.S)
VERIFIED = re.compile(r"\bverified\s+", re.I)
LIMIT = 6


def collect_text(value: object, into: list[str] | None = None) -> list[str]:
    """Every string inside a decoded tool result, so JSON escaping never hides a quote."""
    into = [] if into is None else into
    if isinstance(value, str):
        into.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            collect_text(item, into)
    elif isinstance(value, list):
        for item in value:
            collect_text(item, into)
    return into


def corpus(tool_outputs: list[str]) -> str:
    texts: list[str] = []
    for raw in tool_outputs:
        try:
            collect_text(json.loads(raw), texts)
        except ValueError:
            texts.append(raw)
    return " ".join(" ".join(texts).split())


def claims(answer: str) -> list[str]:
    found: list[str] = []
    for block in FENCE.findall(answer):
        found.extend(line.strip() for line in block.splitlines() if line.strip())
    found.extend(match.strip() for match in CODE_SPAN.findall(FENCE.sub(" ", answer)))
    seen: set[str] = set()
    result = []
    for item in found:
        item = re.sub(r"^[$>]\s*", "", item)
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def shape(token: str) -> str:
    """The kind of argument a token is, so a claim can be compared with how the docs write it."""
    if token[:1] in "<[{":
        return "placeholder"
    if token[:1] in "\"'`":
        return "quoted"
    if re.fullmatch(r"\d+[smhd]", token):
        return "duration"
    if re.fullmatch(r"\d+", token):
        return "number"
    if token.startswith("-"):
        return "flag"
    return "word"


def shapes_after(command: str, text: str) -> set[str]:
    found = {shape(m.group(1)) for m in re.finditer(re.escape(command) + r"\s+(\S+)", text)}
    return found | {"placeholder"}


def confirmed(claim: str, text: str) -> bool | None:
    """True if the sources show it, False if they do not, None when it is not checkable."""
    tokens = claim.split()
    if not tokens:
        return None
    if len(tokens) == 1:
        token = tokens[0]
        if not token.startswith(("/", "-")) or len(token) < 3:
            return None  # a file name, a word, a placeholder: not a command claim
        return token in text
    if not re.search(r"[A-Za-z]", tokens[0]) and not tokens[0].startswith(("/", "-")):
        return None
    # A second word that names a subcommand or a flag must match; numbers, quoted text and other
    # arguments are placeholders the answer may have filled in differently.
    second = tokens[1]
    subcommand = bool(re.fullmatch(r"[A-Za-z][\w-]*|--?[A-Za-z][\w-]*", second))
    head = " ".join(tokens[:2]) if subcommand else tokens[0]
    if head not in text:
        return False
    # For example `/loop "prompt" 60` when the docs only show `/loop 5m prompt`.
    if not subcommand and shape(second) not in shapes_after(tokens[0], text):
        return False
    for flag in (t for t in tokens[2:] if re.fullmatch(r"--?[A-Za-z][\w-]*", t)):
        if flag not in text:
            return False
    return True


def ground(answer: str, tool_outputs: list[str], *, opened_page: bool) -> str:
    """Return the answer with a plain note about anything the sources do not show."""
    text = corpus(tool_outputs)
    if not text:
        return answer
    unconfirmed = [c for c in claims(answer) if confirmed(c, text) is False]
    claimed_verified = bool(VERIFIED.search(answer))
    notes = []
    if claimed_verified and not opened_page:
        answer = VERIFIED.sub("", answer)
    if unconfirmed:
        listed = ", ".join(f"`{item}`" for item in unconfirmed[:LIMIT])
        notes.append(
            f"Not confirmed in the sources I read: {listed}. Check the official documentation before relying on them."
        )
    if not opened_page and (unconfirmed or claimed_verified):
        notes.append("This is based on search excerpts only; I did not open the full pages.")
    if not notes:
        return answer
    return answer.rstrip() + "\n\n_" + " ".join(notes) + "_"

"""Transactional application records, audit events, artifacts, and tool journal.

The application DB is distinct from LangGraph's checkpoint DB. SQLite commits
cannot be atomic with filesystem writes; the tool journal reconciles that gap.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from uuid import uuid4


def uid() -> str:
    return str(uuid4())


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


class Conflict(ValueError):
    pass


class Store:
    def __init__(self, path: Path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA foreign_keys=ON;
            PRAGMA journal_mode=WAL;
            PRAGMA busy_timeout=10000;
            CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
            INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
            CREATE TABLE IF NOT EXISTS entities(id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind);
            CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, idem TEXT UNIQUE, created REAL NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_conversation ON runs(conversation_id) WHERE status IN ('queued','running','waiting','paused','needs_review');
            CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), state TEXT NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), status TEXT NOT NULL, expires REAL NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, run_id TEXT, name TEXT NOT NULL, content BLOB NOT NULL, sha256 TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE VIRTUAL TABLE IF NOT EXISTS notes USING fts5(path UNINDEXED, content);
            CREATE VIRTUAL TABLE IF NOT EXISTS history USING fts5(run_id UNINDEXED, bot_id UNINDEXED, content);
        """)
        version = self.db.execute("SELECT version FROM schema_version").fetchone()[0]
        if version != 1:
            raise RuntimeError(
                f"Unsupported database schema {version}; restore a compatible backup"
            )

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def close(self):
        self.db.close()

    def entity(self, kind: str, identifier: str) -> dict:
        with self.lock:
            row = self.db.execute(
                "SELECT data FROM entities WHERE id=? AND kind=?", (identifier, kind)
            ).fetchone()
        if row is None:
            raise KeyError(f"Unknown {kind}: {identifier}")
        return json.loads(row[0])

    def entities(self, kind: str) -> list[dict]:
        with self.lock:
            return [
                json.loads(row[0])
                for row in self.db.execute(
                    "SELECT data FROM entities WHERE kind=? ORDER BY rowid", (kind,)
                )
            ]

    def put_entity(self, kind: str, data: dict):
        with self.transaction() as db:
            db.execute(
                "INSERT INTO entities VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE entities.kind=excluded.kind",
                (data["id"], kind, encode(data)),
            )

    def run(self, identifier: str) -> dict:
        with self.lock:
            row = self.db.execute(
                "SELECT data,status FROM runs WHERE id=?", (identifier,)
            ).fetchone()
        if row is None:
            raise KeyError("Unknown run")
        return {**json.loads(row[0]), "status": row[1]}

    def runs(self) -> list[dict]:
        with self.lock:
            return [
                {**json.loads(row["data"]), "status": row["status"]}
                for row in self.db.execute(
                    "SELECT data,status FROM runs ORDER BY created DESC LIMIT 500"
                )
            ]

    def create_run(self, record: dict, key: str, limit: int) -> dict:
        with self.transaction() as db:
            old = db.execute("SELECT data FROM runs WHERE idem=?", (key,)).fetchone()
            if old:
                existing = json.loads(old[0])
                if (
                    existing["task"] != record["task"]
                    or existing["conversation_id"] != record["conversation_id"]
                ):
                    raise Conflict("Idempotency key was used for a different request")
                return self.run(existing["id"])
            if db.execute("SELECT count(*) FROM runs WHERE status='queued'").fetchone()[0] >= limit:
                raise Conflict("Task queue is full")
            try:
                db.execute(
                    "INSERT INTO runs VALUES(?,?,?,?,?,?)",
                    (
                        record["id"],
                        record["conversation_id"],
                        "queued",
                        encode(record),
                        key,
                        time.time(),
                    ),
                )
            except sqlite3.IntegrityError as exc:
                raise Conflict("This conversation already has an active run") from exc
            self._event(db, record["id"], "run.queued", {"status": "queued"})
        return self.run(record["id"])

    def update_run(self, identifier: str, **patch):
        with self.transaction() as db:
            record = self.run(identifier)
            old_status = record["status"]
            record.update(patch)
            db.execute(
                "UPDATE runs SET status=?,data=? WHERE id=?",
                (record["status"], encode(record), identifier),
            )
            if old_status != record["status"]:
                self._event(
                    db,
                    identifier,
                    "run.status",
                    {"status": record["status"], "error": record.get("error")},
                )

    def claim(self) -> dict | None:
        with self.transaction() as db:
            row = db.execute(
                "SELECT id FROM runs WHERE status='queued' ORDER BY created LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            record = self.run(row[0])
            record["status"] = "running"
            db.execute(
                "UPDATE runs SET status='running',data=? WHERE id=?", (encode(record), row[0])
            )
            self._event(db, row[0], "run.status", {"status": "running"})
            return record

    def _event(self, db, run_id, kind, data):
        db.execute(
            "INSERT INTO events(run_id,kind,data,created) VALUES(?,?,?,?)",
            (run_id, kind, encode(data), time.time()),
        )

    def event(self, run_id: str | None, kind: str, data: dict):
        with self.transaction() as db:
            self._event(db, run_id, kind, data)

    def started_tools(self, run_id: str, name: str) -> set[str]:
        with self.lock:
            rows = self.db.execute(
                "SELECT data FROM events WHERE run_id=? AND kind='tool.started'", (run_id,)
            ).fetchall()
        return {
            data["attempt_id"] for row in rows if (data := json.loads(row["data"]))["name"] == name
        }

    def events(self, after: int = 0) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 200", (after,)
            ).fetchall()
        return [{**dict(row), "data": json.loads(row["data"])} for row in rows]

    def index_history(self, run_id: str, bot_id: str, content: str):
        with self.transaction() as db:
            db.execute("DELETE FROM history WHERE run_id=?", (run_id,))
            db.execute(
                "INSERT INTO history(run_id,bot_id,content) VALUES(?,?,?)",
                (run_id, bot_id, content),
            )

    def search_history(
        self, bot_id: str, words: list[str], exclude: str, limit: int = 5
    ) -> list[dict]:
        if not words:
            return []
        query = " OR ".join('"' + word.replace('"', '""') + '"' for word in words)
        with self.lock:
            rows = self.db.execute(
                "SELECT run_id,snippet(history,2,'[',']','…',24) AS excerpt FROM history "
                "WHERE history MATCH ? AND bot_id=? AND run_id<>? ORDER BY rank LIMIT ?",
                (query, bot_id, exclude, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def message(self, conversation_id: str, identifier: str, data: dict):
        with self.transaction() as db:
            db.execute(
                "INSERT INTO messages VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                (identifier, conversation_id, encode(data), time.time()),
            )

    def messages(self, conversation_id: str) -> list[dict]:
        with self.lock:
            return [
                json.loads(row[0])
                for row in self.db.execute(
                    "SELECT data FROM messages WHERE conversation_id=? ORDER BY created,rowid",
                    (conversation_id,),
                )
            ]

    def attempt(self, identifier: str) -> dict | None:
        with self.lock:
            row = self.db.execute(
                "SELECT state,data FROM attempts WHERE id=?", (identifier,)
            ).fetchone()
        return {**json.loads(row["data"]), "state": row["state"]} if row else None

    def save_attempt(self, identifier: str, run_id: str, state: str, data: dict):
        with self.transaction() as db:
            db.execute(
                "INSERT INTO attempts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data",
                (identifier, run_id, state, encode(data)),
            )

    def approval(self, identifier: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM approvals WHERE id=?", (identifier,)).fetchone()
        return {**dict(row), "data": json.loads(row["data"])} if row else None

    def approvals(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM approvals ORDER BY rowid DESC LIMIT 500"
            ).fetchall()
        return [{**dict(row), "data": json.loads(row["data"])} for row in rows]

    def request_approval(self, identifier: str, run_id: str, data: dict, seconds: int):
        with self.transaction() as db:
            db.execute(
                "INSERT OR IGNORE INTO approvals VALUES(?,?,'pending',?,?)",
                (identifier, run_id, time.time() + seconds, encode(data)),
            )

    def decide(self, identifier: str, decision: str) -> dict:
        with self.transaction() as db:
            approval = self.approval(identifier)
            if not approval:
                raise KeyError("Unknown approval")
            if approval["status"] != "pending" or approval["expires"] < time.time():
                raise Conflict("Approval already decided or expired")
            run = self.run(approval["run_id"])
            if run["status"] != "waiting":
                raise Conflict("Run is not waiting for this approval")
            db.execute("UPDATE approvals SET status=? WHERE id=?", (decision, identifier))
            run["status"] = "queued"
            db.execute(
                "UPDATE runs SET status='queued',data=? WHERE id=?", (encode(run), run["id"])
            )
            self._event(
                db, run["id"], "approval.decided", {"approval_id": identifier, "decision": decision}
            )
        return self.run(run["id"])

    def consume_approval(self, identifier: str):
        with self.transaction() as db:
            changed = db.execute(
                "UPDATE approvals SET status='consumed' WHERE id=? AND status='approve' AND expires>?",
                (identifier, time.time()),
            ).rowcount
            if changed != 1:
                raise Conflict("Approval cannot be consumed")

    def artifact(
        self, run_id: str | None, name: str, content: str, identifier: str | None = None
    ) -> str:
        identifier = identifier or uid()
        raw = content.encode("utf-8")
        with self.transaction() as db:
            db.execute(
                "INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?,?,?)",
                (identifier, run_id, name, raw, hashlib.sha256(raw).hexdigest(), time.time()),
            )
        return identifier

    def artifacts(self) -> list[dict]:
        with self.lock:
            return [
                dict(row)
                for row in self.db.execute(
                    "SELECT id,run_id,name,sha256,created,length(content) AS size FROM artifacts ORDER BY created DESC LIMIT 500"
                )
            ]

    def artifact_content(self, identifier: str) -> str:
        with self.lock:
            row = self.db.execute(
                "SELECT content FROM artifacts WHERE id=?", (identifier,)
            ).fetchone()
        if row is None:
            raise KeyError("Unknown artifact")
        return bytes(row[0]).decode("utf-8")

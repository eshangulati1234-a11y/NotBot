"""Offline backup copies both databases and excludes runtime credentials."""

import sqlite3

from notbot_harness.__main__ import main


def test_offline_backup_integrity(tmp_path, monkeypatch):
    state = tmp_path / "state"
    state.mkdir()
    for name in ("application.db", "checkpoints.db"):
        with sqlite3.connect(state / name) as database:
            database.execute("CREATE TABLE fixture(value TEXT)")
            database.execute("INSERT INTO fixture VALUES ('durable')")
    (state / "vault").mkdir()
    (state / "vault" / "note.md").write_text("Approved memory", encoding="utf-8")
    backup = tmp_path / "backup"
    monkeypatch.setenv("NOTBOT_DATA_DIR", str(state))
    monkeypatch.setattr("sys.argv", ["notbot_harness", "backup", str(backup)])
    main()
    for name in ("application.db", "checkpoints.db"):
        with sqlite3.connect(backup / name) as database:
            assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            assert database.execute("SELECT value FROM fixture").fetchone()[0] == "durable"
    assert (backup / "vault" / "note.md").read_text(encoding="utf-8") == "Approved memory"
    assert (state / "access.token").exists()
    assert not (backup / "access.token").exists()

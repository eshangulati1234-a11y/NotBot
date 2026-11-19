"""Terminal service/client commands. Run with: uv run --directory harness python -m notbot_harness."""

from __future__ import annotations

import argparse
import asyncio
import json

import httpx
import uvicorn

from .api import create_app
from .config import Settings


def main():
    parser = argparse.ArgumentParser(description="Notbot local agent runtime")
    parser.add_argument("--url", default="http://127.0.0.1:8787")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ["serve", "config", "token", "health", "models", "runs", "approvals"]:
        sub.add_parser(command)
    backup = sub.add_parser("backup")
    backup.add_argument("destination")
    workspace = sub.add_parser("workspace")
    workspace.add_argument("path")
    workspace.add_argument("--name", default="Workspace")
    bot = sub.add_parser("bot")
    bot.add_argument("name")
    bot.add_argument("purpose")
    chat = sub.add_parser("conversation")
    chat.add_argument("bot_id")
    chat.add_argument("workspace_id")
    run = sub.add_parser("run")
    run.add_argument("conversation_id")
    run.add_argument("task")
    decision = sub.add_parser("decide")
    decision.add_argument("approval_id")
    decision.add_argument("decision", choices=["approve", "reject"])
    control = sub.add_parser("control")
    control.add_argument("run_id")
    control.add_argument("action", choices=["pause", "resume", "cancel"])
    args = parser.parse_args()
    settings = Settings.from_env()
    token = settings.initialise()
    if args.command == "serve":
        uvicorn.run(create_app(settings), host=settings.host, port=settings.port, access_log=False)
        return
    if args.command == "token":
        print(token)
        return
    if args.command == "backup":
        import shutil
        import sqlite3
        from pathlib import Path

        from filelock import FileLock

        destination = Path(args.destination).expanduser().resolve()
        if destination.exists() or destination.is_relative_to(settings.data_dir):
            parser.error("Choose a new backup directory outside the runtime state directory")
        with FileLock(str(settings.data_dir / "runtime.lock"), timeout=0):
            destination.mkdir(parents=True, mode=0o700)
            for name in ("application.db", "checkpoints.db"):
                source = settings.data_dir / name
                if source.exists():
                    with (
                        sqlite3.connect(source) as original,
                        sqlite3.connect(destination / name) as target,
                    ):
                        original.backup(target)
            if (settings.data_dir / "vault").exists():
                shutil.copytree(settings.data_dir / "vault", destination / "vault", symlinks=True)
        print("Backup completed. Access token intentionally excluded; keep this backup private.")
        return
    if args.command == "config":
        print(json.dumps(settings.model_dump(mode="json", exclude={"model_key"}), indent=2))
        return

    async def request():
        from .storage import uid

        method, path, body = "GET", "/" + args.command, None
        if args.command == "workspace":
            method, path, body = "POST", "/workspaces", {"path": args.path, "name": args.name}
        elif args.command == "bot":
            method, path, body = "POST", "/bots", {"name": args.name, "purpose": args.purpose}
        elif args.command == "conversation":
            method, path, body = (
                "POST",
                "/conversations",
                {"bot_id": args.bot_id, "workspace_id": args.workspace_id},
            )
        elif args.command == "run":
            method, path, body = (
                "POST",
                "/runs",
                {"conversation_id": args.conversation_id, "task": args.task},
            )
        elif args.command == "decide":
            method, path, body = (
                "POST",
                "/approvals/" + args.approval_id,
                {"decision": args.decision},
            )
        elif args.command == "control":
            method, path, body = "POST", f"/runs/{args.run_id}/{args.action}", {}
        async with httpx.AsyncClient(
            base_url=args.url + "/api/v1", timeout=30, trust_env=False
        ) as client:
            response = await client.request(
                method,
                path,
                json=body,
                headers={"Authorization": "Bearer " + token, "Idempotency-Key": uid()},
            )
            print(json.dumps(response.json(), indent=2))
            response.raise_for_status()

    try:
        asyncio.run(request())
    except (httpx.HTTPError, ValueError) as error:
        parser.exit(
            1,
            f"{type(error).__name__}: command failed; check service connectivity and credentials.\n",
        )


if __name__ == "__main__":
    main()

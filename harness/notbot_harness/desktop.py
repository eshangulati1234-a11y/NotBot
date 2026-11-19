"""Private desktop sidecar: ephemeral loopback port and parent-owned lifetime."""

import json
import socket
import sys
import threading

import uvicorn

from .api import create_app
from .config import Settings


def main() -> None:
    settings = Settings.from_env()
    settings.host = "127.0.0.1"
    settings.remote_tls = False
    settings.initialise()
    # Keep the socket bound until Uvicorn owns it; no free-port selection race.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        server = uvicorn.Server(
            uvicorn.Config(create_app(settings), log_level="warning", access_log=False)
        )

        def watch_parent() -> None:
            # Electron closes this pipe on quit. EOF also covers a parent crash.
            sys.stdin.buffer.read()
            server.should_exit = True

        threading.Thread(target=watch_parent, daemon=True, name="notbot-parent").start()
        print(json.dumps({"type": "notbot.ready", "port": listener.getsockname()[1]}), flush=True)
        server.run(sockets=[listener])


if __name__ == "__main__":
    main()

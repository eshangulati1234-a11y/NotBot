"""The desktop runtime binds locally, authenticates and exits on parent EOF."""

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.asyncio
@pytest.mark.parametrize("bundled", [False, True])
async def test_parent_owned_desktop_lifetime(tmp_path, bundled):
    executable = (
        PROJECT_ROOT
        / "dist"
        / "harness"
        / "notbot-harness"
        / ("notbot-harness.exe" if sys.platform == "win32" else "notbot-harness")
    )
    if bundled and not executable.is_file():
        pytest.skip("Build the desktop runtime with npm run build:harness first")
    command = [str(executable)] if bundled else [sys.executable, "-m", "notbot_harness.desktop"]
    process = await asyncio.create_subprocess_exec(
        *command,
        env={**os.environ, "NOTBOT_DATA_DIR": str(tmp_path)},
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        record = json.loads(await asyncio.wait_for(process.stdout.readline(), 30))
        assert set(record) == {"type", "port"}
        assert record["type"] == "notbot.ready"
        token = (tmp_path / "access.token").read_text().strip()
        url = f"http://127.0.0.1:{record['port']}/api/v1/health"
        async with httpx.AsyncClient(trust_env=False) as client:
            async with asyncio.timeout(15):
                while True:
                    try:
                        response = await client.get(
                            url, headers={"Authorization": "Bearer " + token}
                        )
                        if response.status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.1)
            assert (await client.get(url)).status_code == 401
        process.stdin.close()
        assert await asyncio.wait_for(process.wait(), 15) == 0
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()

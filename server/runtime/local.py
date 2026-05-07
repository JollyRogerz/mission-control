"""RUN-02: Local subprocess RuntimeAdapter.

Wire protocol (locked, Phase 4):
  stdin  (one line):  {"agent_id":str,"message":str,"turn_id":str}\\n
  stdout (N lines):   each line is a JSON dict; stream ends on {"event":"done"} or EOF.
  stderr:             captured; surfaced as {"event":"error","detail":...} only on non-zero exit.

Each stdout line is parsed and yielded verbatim by dispatch().
"""
from __future__ import annotations
import asyncio
import json
import os
import shlex
import shutil
import uuid
from typing import AsyncIterator

TURN_TIMEOUT_S = 120.0
STDERR_CAP_BYTES = 1024


def _command() -> list[str] | None:
    raw = os.environ.get("LOCAL_RUNTIME_CMD", "").strip()
    if not raw:
        return None
    try:
        parts = shlex.split(raw, posix=True)
    except ValueError:
        return None
    return parts or None


class LocalRuntime:
    name = "local"

    async def dispatch(self, agent_id: str, message: str, **kwargs) -> AsyncIterator[dict]:
        cmd = _command()
        if not cmd:
            raise RuntimeError("LOCAL_RUNTIME_CMD not set")
        turn_id = kwargs.get("turn_id") or uuid.uuid4().hex

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        request = json.dumps(
            {"agent_id": agent_id, "message": message, "turn_id": turn_id}
        ).encode() + b"\n"

        async def _drive() -> AsyncIterator[dict]:
            try:
                proc.stdin.write(request)
                await proc.stdin.drain()
                proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError):
                # Subprocess died before reading stdin. Fall through; we'll surface stderr below.
                pass

            saw_done = False
            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                try:
                    evt = json.loads(line.decode().rstrip("\n"))
                except json.JSONDecodeError:
                    yield {"event": "error", "detail": f"non-JSON stdout line: {line[:200]!r}"}
                    continue
                yield evt
                if evt.get("event") == "done":
                    saw_done = True
                    break

            # If we exited without seeing done, check exit code and surface stderr.
            try:
                rc = await asyncio.wait_for(proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                proc.kill()
                rc = await proc.wait()

            if not saw_done and rc != 0:
                stderr_bytes = b""
                if proc.stderr is not None:
                    try:
                        stderr_bytes = await asyncio.wait_for(
                            proc.stderr.read(STDERR_CAP_BYTES), timeout=1.0
                        )
                    except asyncio.TimeoutError:
                        pass
                yield {
                    "event": "error",
                    "detail": stderr_bytes.decode(errors="replace") or f"exit {rc}",
                }

        try:
            async for evt in _wrap_with_timeout(_drive(), TURN_TIMEOUT_S, proc):
                yield evt
        finally:
            if proc.returncode is None:
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                await proc.wait()

    async def health_check(self) -> bool:
        cmd = _command()
        if not cmd:
            return False
        # Cheap, side-effect-free probe: confirm the executable exists on PATH.
        return shutil.which(cmd[0]) is not None


async def _wrap_with_timeout(
    gen: AsyncIterator[dict], timeout_s: float, proc: asyncio.subprocess.Process
) -> AsyncIterator[dict]:
    """Yield from gen, killing proc and emitting an error event if total elapsed > timeout_s."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            if proc.returncode is None:
                proc.kill()
            yield {"event": "error", "detail": f"local runtime timed out after {timeout_s}s"}
            return
        try:
            evt = await asyncio.wait_for(gen.__anext__(), timeout=remaining)
        except StopAsyncIteration:
            return
        except asyncio.TimeoutError:
            if proc.returncode is None:
                proc.kill()
            yield {"event": "error", "detail": f"local runtime timed out after {timeout_s}s"}
            return
        yield evt


RUNTIME = LocalRuntime()

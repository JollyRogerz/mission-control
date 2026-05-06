"""RUN-01: OpenClaw RuntimeAdapter — WebSocket gateway client.

Wire protocol (locked, Phase 4):
  → outbound (one frame): {"type":"turn","agent_id":str,"message":str,"turn_id":str}
  ← inbound  (N frames):  {"event":<str>, "data":<dict|null>, ...optional fields}
  ← terminal:             {"event":"done"} OR close frame.

Each inbound JSON dict is yielded verbatim by dispatch().
"""
from __future__ import annotations
import asyncio
import json
import os
import uuid
from typing import AsyncIterator
from urllib.parse import urlencode

import websockets

DEFAULT_URL = "ws://127.0.0.1:18789"


def _gateway_url() -> str:
    return (
        os.environ.get("OPENCLAW_GATEWAY_URL")
        or os.environ.get("MISSION_CONTROL_GATEWAY_URL")
        or DEFAULT_URL
    )


def _gateway_token() -> str:
    return os.environ.get("BRIDGE_AUTH_TOKEN") or os.environ.get("OPENCLAW_GATEWAY_TOKEN", "")


def _build_url(path: str = "/ws/turn") -> str:
    base = f"{_gateway_url().rstrip('/')}{path}"
    token = _gateway_token()
    if token:
        return f"{base}?{urlencode({'token': token})}"
    return base


class OpenClawRuntime:
    name = "openclaw"

    async def dispatch(self, agent_id: str, message: str, **kwargs) -> AsyncIterator[dict]:
        turn_id = kwargs.get("turn_id") or uuid.uuid4().hex
        url = _build_url("/ws/turn")
        async with websockets.connect(url, open_timeout=5.0) as ws:
            await ws.send(json.dumps({
                "type": "turn",
                "agent_id": agent_id,
                "message": message,
                "turn_id": turn_id,
            }))
            try:
                async for frame in ws:
                    try:
                        evt = json.loads(frame)
                    except json.JSONDecodeError:
                        yield {"event": "error", "detail": "non-JSON frame from gateway"}
                        return
                    yield evt
                    if evt.get("event") == "done":
                        return
            except websockets.ConnectionClosed:
                return  # gateway closed = end of stream

    async def health_check(self) -> bool:
        try:
            async with websockets.connect(_build_url("/ws/turn"), open_timeout=3.0) as ws:
                await ws.send(json.dumps({"type": "ping"}))
                # Either we get a pong or the close frame; both prove the gateway is up.
                try:
                    await asyncio.wait_for(ws.recv(), timeout=3.0)
                except asyncio.TimeoutError:
                    pass
                return True
        except Exception:
            return False


RUNTIME = OpenClawRuntime()

"""
Avatar Mapper — Agent Edition
Translates OpenClaw AI agent telemetry into Live2D avatar expressions.

Expression names map to indices in bridge_server.py EXPRESSION_INDEX.
The default model (mao_pro) supports these emotion indices:
  0 = neutral/focused
  1 = sadness/sleepy/bored/fear
  2 = anger/panicked/disgust
  3 = joy/happy/victory/surprise/excited
"""

from telemetry_schema import TelemetryPayload, AgentState, ToolType
from typing import Optional
from dataclasses import dataclass
import time


@dataclass
class AvatarCommand:
    """Command to send to the Live2D avatar via Open-LLM-VTuber."""
    expression: str = "neutral"
    motion: Optional[str] = None
    text_overlay: Optional[str] = None
    speak: Optional[str] = None

    def to_dict(self) -> dict:
        result = {"expression": self.expression}
        if self.motion:
            result["motion"] = self.motion
        if self.text_overlay:
            result["text_overlay"] = self.text_overlay
        if self.speak:
            result["speak"] = self.speak
        return result


class AvatarMapper:
    """
    Stateful mapper: converts agent telemetry into avatar commands.
    Tracks previous state to only emit on meaningful changes.
    """

    def __init__(self):
        self.prev_state: Optional[AgentState] = None
        self.prev_tool_type: Optional[ToolType] = None
        self.last_activity_time: float = time.time()
        self.consecutive_errors: int = 0
        self.last_tool_success: Optional[bool] = None

    def map(self, telemetry: TelemetryPayload) -> AvatarCommand:
        now = time.time()

        # --- Error takes priority ---
        if telemetry.state == AgentState.ERROR:
            self.consecutive_errors += 1
            if self.consecutive_errors >= 3:
                return AvatarCommand(expression="panicked", motion="flail")
            cmd = AvatarCommand(expression="surprised", motion="flail")
            self.prev_state = telemetry.state
            return cmd

        # Clear error streak
        self.consecutive_errors = 0

        # --- State-based mapping ---
        state_map = {
            AgentState.IDLE: self._map_idle,
            AgentState.THINKING: self._map_thinking,
            AgentState.TOOL_RUNNING: self._map_tool_running,
            AgentState.SPEAKING: self._map_speaking,
            AgentState.STARTING: self._map_starting,
            AgentState.STOPPING: self._map_stopping,
        }

        mapper_fn = state_map.get(telemetry.state, self._map_idle)
        cmd = mapper_fn(telemetry, now)

        # --- Tool success/failure reactions ---
        if (telemetry.tool_success is not None
                and telemetry.tool_success != self.last_tool_success):
            if telemetry.tool_success:
                cmd.expression = "victory"
                cmd.motion = "nod"
            else:
                cmd.expression = "surprised"
            self.last_tool_success = telemetry.tool_success

        # --- Track state ---
        if telemetry.state != AgentState.IDLE:
            self.last_activity_time = now
        self.prev_state = telemetry.state
        self.prev_tool_type = telemetry.tool_type

        return cmd

    def _map_idle(self, telemetry: TelemetryPayload, now: float) -> AvatarCommand:
        idle_duration = now - self.last_activity_time

        # Just finished a successful tool -> brief victory
        if (self.prev_state == AgentState.TOOL_RUNNING
                and self.last_tool_success is True):
            return AvatarCommand(expression="victory", motion="nod")

        if idle_duration > 30.0:
            return AvatarCommand(expression="bored", motion="idle_long")
        elif idle_duration > 10.0:
            return AvatarCommand(expression="sleepy", motion="idle")

        return AvatarCommand(expression="neutral")

    def _map_thinking(self, telemetry: TelemetryPayload, now: float) -> AvatarCommand:
        # Cycle through expressions so the avatar looks alive while thinking.
        cycle_secs = int(now) % 12
        if telemetry.activity_level > 70:
            return AvatarCommand(expression="focused", motion="nod")
        elif cycle_secs < 5:
            return AvatarCommand(expression="focused", motion="idle")
        elif cycle_secs < 8:
            return AvatarCommand(expression="smirk", motion="nod")
        else:
            return AvatarCommand(expression="surprised", motion="idle")

    def _map_tool_running(self, telemetry: TelemetryPayload, now: float) -> AvatarCommand:
        if telemetry.tool_type == ToolType.BASH:
            return AvatarCommand(expression="excited", motion="bounce")
        elif telemetry.tool_type == ToolType.BROWSER:
            return AvatarCommand(expression="happy", motion="nod")
        elif telemetry.tool_type in (ToolType.CODE, ToolType.FILE):
            return AvatarCommand(expression="focused", motion="idle")

        return AvatarCommand(expression="focused", motion="nod")

    def _map_speaking(self, telemetry: TelemetryPayload, now: float) -> AvatarCommand:
        return AvatarCommand(expression="happy", motion="nod")

    def _map_starting(self, telemetry: TelemetryPayload, now: float) -> AvatarCommand:
        if self.prev_state != AgentState.STARTING:
            return AvatarCommand(
                expression="happy", motion="wave",
                speak="Hey Ruben! I'm online.",
            )
        return AvatarCommand(expression="neutral", motion="idle")

    def _map_stopping(self, telemetry: TelemetryPayload, now: float) -> AvatarCommand:
        if self.prev_state != AgentState.STOPPING:
            return AvatarCommand(
                expression="sleepy", motion="wave",
                speak="Going offline, see you later Ruben!",
            )
        return AvatarCommand(expression="sleepy", motion="idle")

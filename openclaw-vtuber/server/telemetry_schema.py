"""
OpenClaw Agent Telemetry Schema
Pydantic models defining the AI agent telemetry data structure.

OpenClaw is an autonomous AI agent (not a physical robot). These models
map agent lifecycle events to a format the bridge server can translate
into Live2D avatar expressions.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime


class AgentState(str, Enum):
    """High-level agent states mapped from OpenClaw gateway events."""
    IDLE = "idle"                # Waiting for input, no active task
    THINKING = "thinking"        # LLM is generating a response
    TOOL_RUNNING = "tool_running"  # Executing a tool (bash, browser, etc.)
    SPEAKING = "speaking"        # Sending a response to the user
    ERROR = "error"              # Tool or LLM call failed
    STARTING = "starting"       # Agent session initializing
    STOPPING = "stopping"       # Agent session shutting down


class ToolType(str, Enum):
    """Categories of tools the agent might be running."""
    NONE = "none"
    BASH = "bash"
    BROWSER = "browser"
    FILE = "file"
    CODE = "code"
    SEARCH = "search"
    API = "api"
    OTHER = "other"


class TelemetryPayload(BaseModel):
    """
    Agent telemetry packet sent from the OpenClaw vtuber-bridge extension.
    Sent as JSON over the WebSocket connection to the bridge server.
    """
    # --- Identity ---
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    agent_id: str = Field("openclaw-01", description="Unique agent identifier")
    session_key: Optional[str] = Field(None, description="Channel:user session key")

    # --- Agent state ---
    state: AgentState = AgentState.IDLE

    # --- Tool execution context ---
    tool_type: ToolType = ToolType.NONE
    tool_name: Optional[str] = Field(None, description="Specific tool being run (e.g. 'bash', 'puppeteer')")
    tool_duration_ms: Optional[int] = Field(None, description="How long the current/last tool ran")
    tool_success: Optional[bool] = Field(None, description="Did the last tool call succeed?")

    # --- LLM usage ---
    llm_model: Optional[str] = Field(None, description="Model used (e.g. 'claude-sonnet-4-20250514')")
    input_tokens: Optional[int] = Field(None, ge=0)
    output_tokens: Optional[int] = Field(None, ge=0)

    # --- Activity intensity (0-100 scale) ---
    activity_level: float = Field(0.0, ge=0.0, le=100.0,
        description="How busy the agent is: 0=idle, 100=maxed out")

    # --- Error context ---
    error_code: Optional[int] = None
    error_message: Optional[str] = None

    # --- Arbitrary extras ---
    custom: Optional[dict] = Field(None, description="Arbitrary extra fields")

    class Config:
        json_schema_extra = {
            "example": {
                "timestamp": "2026-02-06T12:00:00Z",
                "agent_id": "example-agent",
                "session_key": "telegram:000000000",
                "state": "tool_running",
                "tool_type": "bash",
                "tool_name": "bash",
                "activity_level": 75.0,
                "llm_model": "claude-sonnet-4-20250514",
                "input_tokens": 1200,
                "output_tokens": 350,
            }
        }


# --- Backwards-compatible aliases for bridge_server imports ---
# The bridge server imports these names; keep them working.
RobotState = AgentState
GripperStatus = ToolType

"""Adapter contract Protocols + AgentDefinition + directory-scan loader.

Concrete implementations live in server/providers/, server/integrations/,
server/runtime/ — discovered at bridge startup by _scan().
"""

from .model_provider import ModelProvider
from .integration import Integration
from .runtime import RuntimeAdapter
from .agent_definition import AgentDefinition
from .loader import _scan

__all__ = ["ModelProvider", "Integration", "RuntimeAdapter", "AgentDefinition", "_scan"]

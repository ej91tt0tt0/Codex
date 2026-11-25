"""Safe, explicit action planning for ASTER's future voice agent.

This module does not execute device actions. The iPhone client must handle
supported intents and obtain user confirmation where required.
"""
from dataclasses import dataclass
from typing import Literal

ActionKind = Literal["open_maps", "read_calendar", "open_app"]

ALLOWED_APPS = frozenset({"maps", "calendar", "settings"})

@dataclass(frozen=True)
class AgentAction:
    kind: ActionKind
    target: str = ""
    requires_confirmation: bool = False


def plan_action(kind: str, target: str = "") -> AgentAction:
    """Validate a proposed tool action; reject unsupported capabilities."""
    if not isinstance(kind, str) or not isinstance(target, str):
        raise ValueError("Action and target must be text")
    target = target.strip()
    if len(target) > 200 or any(ord(c) < 32 for c in target):
        raise ValueError("Invalid action target")
    if kind == "open_maps":
        return AgentAction("open_maps", target)
    if kind == "read_calendar":
        if target:
            raise ValueError("Calendar reads do not take a target")
        return AgentAction("read_calendar")
    if kind == "open_app" and target in ALLOWED_APPS:
        return AgentAction("open_app", target)
    raise ValueError("Unsupported or unauthorized action")

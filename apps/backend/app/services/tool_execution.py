from dataclasses import dataclass
from enum import Enum

class ToolExecutionStatus(Enum):
    COMPLETED = "completed"
    PENDING_CONFIRMATION = "pending_confirmation"
    FAILED = "failed"

@dataclass
class ToolExecutionResult:
    status: ToolExecutionStatus
    tool: str
    data: dict | None = None
    error: str | None = None
    pending_token: str | None = None
    summary: str | None = None

DEFAULT_TOOL_CONFIRMATION_MODE = "write_only"
_confirmation_mode: str = DEFAULT_TOOL_CONFIRMATION_MODE

def set_tool_confirmation_mode(mode: str) -> None:
    """Set: 'all', 'write_only', or 'none'."""
    global _confirmation_mode
    _confirmation_mode = mode

def get_tool_confirmation_mode() -> str:
    return _confirmation_mode

def needs_confirmation(tool_name: str, is_write: bool) -> bool:
    if _confirmation_mode == "none":
        return False
    if _confirmation_mode == "all":
        return True
    return is_write  # write_only

async def execute_tool_with_policy(tool_name: str, args: dict) -> ToolExecutionResult:
    """Execute a tool respecting the current confirmation policy."""
    from app.services.chat_tools import TOOL_CATALOG, validate_tool_args, _execute_read_tool, _execute_write_tool
    
    spec = TOOL_CATALOG.get(tool_name)
    if not spec:
        return ToolExecutionResult(status=ToolExecutionStatus.FAILED, tool=tool_name, error=f"Unknown tool: {tool_name}")
        
    try:
        validated = validate_tool_args(tool_name, args)
    except Exception as e:
        return ToolExecutionResult(status=ToolExecutionStatus.FAILED, tool=tool_name, error=str(e))
        
    if needs_confirmation(tool_name, spec.write or spec.needs_confirmation):
        summary = spec.summary_template.format(**validated) if spec.summary_template else f"Execute {tool_name}"
        return ToolExecutionResult(
            status=ToolExecutionStatus.PENDING_CONFIRMATION,
            tool=tool_name,
            summary=summary,
            data=validated
        )
        
    try:
        if spec.write:
            data = await _execute_write_tool(tool_name, validated)
        else:
            data = await _execute_read_tool(tool_name, validated)
        return ToolExecutionResult(status=ToolExecutionStatus.COMPLETED, tool=tool_name, data=data)
    except Exception as e:
        return ToolExecutionResult(status=ToolExecutionStatus.FAILED, tool=tool_name, error=str(e))


"""MCP Client Bridge for JARVIS Agent Integration (v2.0).

Provides a decoupled tool registry bridge that connects LangGraph / LangChain agents 
to local Model Context Protocol (MCP) tool servers. Allows zero-latency, dynamic tool 
discovery and execution without polluting agent.py with tool implementation code.
"""
from typing import List
from langchain_core.tools import tool
import room

@tool
def mcp_control_room(device: str, action: str, value: int = 100) -> str:
    """Controls physical room hardware devices: device ('light', 'fan', 'all'), action ('on', 'off', 'set', 'dim', 'brighten'), value (0-100, default 100)."""
    if value is None:
        value = 100
    reply = room.apply(device, action, value)
    return f"MCP Hardware Execution: {reply}"

@tool
def mcp_set_environment(preset: str) -> str:
    """Sets holistic environmental preset macro-state: preset ('deep_focus', 'relaxation', 'sleep')."""
    reply = room.apply("environment", "set", preset)
    return f"MCP Environment Macro Applied: {reply}"

def get_mcp_tools() -> List:
    """Returns decoupled MCP tools ready for LLM binding in agent.py."""
    return [mcp_control_room, mcp_set_environment]

if __name__ == "__main__":
    print("Testing MCP Client Bridge...")
    t_list = get_mcp_tools()
    print(f"Discovered {len(t_list)} MCP tools:")
    for t in t_list:
        print(f" - {t.name}: {t.description[:60]}...")

"""JARVIS's tools: one registry, permission tiers, receipts, and the honesty guard.

    registry.py  Tool, Receipt, Tier, Registry (capability list for the persona)
    builtin.py   the tools themselves and default_registry()
    when.py      times and reminders, parsed without the model
    honesty.py   a reply may only claim what a receipt shows
"""
from .registry import CANNOT, Receipt, Registry, Tier, Tool  # noqa: F401

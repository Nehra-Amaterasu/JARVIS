"""Long answers when he asks for one, and never a sentence cut in half.

10-14: asked for a long story with a moral, the reply stopped in the middle of its last
sentence because every reply is capped at 400 tokens (agent.py: num_predict=400,
the guard against a 4B model looping until the 8192-token context is full). A story or
a full explanation gets a bigger budget for that one turn; and whenever ANY reply hits
its cap, honesty.Guard.finish(capped=True) drops the unfinished tail, so the voice ends
on the last complete sentence.

Budget: 1200 tokens ~ 900 English words ~ 6 minutes of speech at 150 words a minute,
three times the normal cap and still far inside the context. The loop guard stays: the
cap is raised, not removed.
"""
from __future__ import annotations

import re

LONG_FORM_TOKENS = 1200
LONG_FORM_WORDS = 600            # asked of the model; the token cap is the hard stop

_LONG = re.compile(
    r"\b(?:(?:tell|write|narrate|make up|give)\s+(?:me\s+|us\s+)?(?:a|an|another|one|the)\s+(?:\w+\s+){0,3}?"
    r"(?:story|stories|tale|fable|poem|essay|letter|speech)|kahani|kahaani|kissa|"
    r"in (?:full |great |more )?detail|detailed|in depth|elaborate|long (?:answer|story|explanation|version)|"
    r"step by step|explain (?:everything|it all|fully|the whole)|full explanation|tell me everything|"
    r"(?:big|long|whole) story)\b", re.I)

INSTRUCTION = (f"[He asked for a long answer (a story or a full explanation). For this reply only, ignore the "
               f"length rule: up to about {LONG_FORM_WORDS} words of plain spoken sentences, no headings or lists, "
               f"and finish on a complete sentence.]")


def wants_long(text: str) -> bool:
    return bool(_LONG.search(text or ""))


def with_budget(model, tokens: int = LONG_FORM_TOKENS):
    """The same model with a bigger num_predict for one turn. Works on a ChatOllama and
    on one wrapped by bind_tools (a RunnableBinding); anything else (a test's fake) is
    returned as it is."""
    try:
        bound = getattr(model, "bound", None)
        if bound is not None and hasattr(bound, "num_predict"):
            return model.model_copy(update={"bound": bound.model_copy(update={"num_predict": tokens})})
        if hasattr(model, "num_predict") and hasattr(model, "model_copy"):
            return model.model_copy(update={"num_predict": tokens})
    except Exception as e:
        print(f"\n[Long-form budget not applied: {e}]")
    return model


def capped(chunk) -> bool:
    """Did this streamed chunk end the reply because the token cap was hit? Ollama says
    so in the last chunk: done_reason == "length"."""
    meta = getattr(chunk, "response_metadata", None) or {}
    return meta.get("done_reason") == "length"

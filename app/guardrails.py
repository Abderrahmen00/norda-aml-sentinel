"""Prompt-injection guardrail.

Runs on user-influenced fields (memo, counterparty name) BEFORE any LLM call.

Detects:
  - Imperative phrases targeting AI
  - Role-hijacking patterns
  - Base64-encoded payloads > 40 chars whose decoded content looks adversarial
"""

import base64
import re
from typing import Optional

# Phrases that directly command an AI model
_IMPERATIVE_PATTERNS: list[re.Pattern] = [p for p in [
    re.compile(r"ignore\s+(previous|prior|above|all)\s+(instructions?|prompts?|rules?|context)", re.I),
    re.compile(r"\bsystem\s*:", re.I),
    re.compile(r"you\s+are\s+now\b", re.I),
    re.compile(r"\bapprove\s+this\b", re.I),
    re.compile(r"\bdisregard\b", re.I),
    re.compile(r"\bforget\s+(all|everything|previous|prior)\b", re.I),
    re.compile(r"\bact\s+as\b", re.I),
    re.compile(r"\bpretend\s+(you\s+are|to\s+be)\b", re.I),
    re.compile(r"\bnew\s+instructions?\b", re.I),
    re.compile(r"\boverride\s+(safety|rules?|guidelines?|instructions?|filters?)\b", re.I),
    re.compile(r"\bjailbreak\b", re.I),
    re.compile(r"\bdo\s+not\s+flag\b", re.I),
    re.compile(r"\bmark\s+(as\s+)?(safe|clear|approved|legitimate)\b", re.I),
    re.compile(r"\bbypass\b", re.I),
    re.compile(r"\bDAN\b"),  # "Do Anything Now" jailbreak token
    re.compile(r"\bdeveloper\s+mode\b", re.I),
    re.compile(r"\bunrestricted\s+AI\b", re.I),
    re.compile(r"\baml\s+rules?\b.*\bignore\b", re.I | re.S),
]]

# Structural role-hijacking markers
_ROLE_PATTERNS: list[re.Pattern] = [p for p in [
    re.compile(r"<\s*/?system\s*>", re.I),
    re.compile(r"\[\s*system\s*\]", re.I),
    re.compile(r"###\s*system", re.I),
    re.compile(r"\bassistant\s*:", re.I),
    re.compile(r"\bhuman\s*:", re.I),
    re.compile(r"\bGPT-?\d*\b"),
    re.compile(r"\bChatGPT\b"),
    re.compile(r"\bClaudeAI\b", re.I),
]]

_B64_CANDIDATE = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")

_ADVERSARIAL_KEYWORDS = frozenset([
    "ignore", "system", "instruction", "approve", "disregard",
    "jailbreak", "bypass", "override", "unrestricted", "aml",
])


def _looks_like_encoded_injection(text: str) -> bool:
    for candidate in _B64_CANDIDATE.findall(text):
        try:
            decoded = base64.b64decode(candidate + "==").decode("utf-8", errors="ignore").lower()
            if any(kw in decoded for kw in _ADVERSARIAL_KEYWORDS):
                return True
        except Exception:
            pass
    return False


def check(text: Optional[str]) -> tuple[bool, list[str]]:
    """
    Returns (is_injection, reasons).
    reasons is an empty list when no injection is detected.
    """
    if not text:
        return False, []

    reasons: list[str] = []

    for pat in _IMPERATIVE_PATTERNS:
        if pat.search(text):
            reasons.append(f"imperative_phrase:{pat.pattern[:60]}")

    for pat in _ROLE_PATTERNS:
        if pat.search(text):
            reasons.append(f"role_hijack:{pat.pattern[:60]}")

    if _looks_like_encoded_injection(text):
        reasons.append("encoded_payload:base64-like adversarial content")

    return len(reasons) > 0, reasons


def sanitize(text: Optional[str], field: str) -> str:
    """Return safe text for LLM consumption. Redacts injections."""
    if text is None:
        return ""
    injected, _ = check(text)
    if injected:
        return f"[REDACTED:INJECTION_ATTEMPT in {field}]"
    return text

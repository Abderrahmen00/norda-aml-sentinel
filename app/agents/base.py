"""Shared agent infrastructure: governance HTTP client + structured LLM calls."""

import hashlib
import hmac as _hmac
import json
import os
from typing import Any, TypeVar

import httpx
import ollama
from pydantic import BaseModel, ValidationError

import app.audit as audit

T = TypeVar("T", bound=BaseModel)

AGENT_VERSION = "1.0.0"


def _governance_url() -> str:
    host = os.environ.get("APP_HOST", "127.0.0.1")
    port = os.environ.get("APP_PORT", "8000")
    return f"http://{host}:{port}/internal/governance/action"


def _sign(body: bytes, agent_id: str) -> str:
    key = f"{agent_id.upper()}_AGENT_SECRET"
    secret = os.environ[key]
    return _hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def call_governance(agent_id: str, action_type: str, payload: dict[str, Any]) -> Any:
    """
    Authenticated HTTP call to the governance layer.
    Raises PermissionError on 401/403, RuntimeError on other failures.
    """
    body = json.dumps(
        {"agent_id": agent_id, "action_type": action_type, "payload": payload},
        separators=(",", ":"),
    ).encode()

    sig = _sign(body, agent_id)

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            _governance_url(),
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Agent-Id": agent_id,
                "X-Signature": sig,
            },
        )

    if resp.status_code in (401, 403):
        raise PermissionError(resp.json().get("detail", "access denied"))
    resp.raise_for_status()

    result = resp.json()
    if not result.get("success"):
        raise RuntimeError(result.get("error", "governance action failed"))
    return result["data"]


_DEMO_RESPONSES = {
    "TriageLLMOutput": {
        "risk_score": 78,
        "red_flags": ["structuring", "amount_below_threshold"],
        "recommendation": "investigate",
        "reasoning": (
            "Amount 9,450 EUR is 5.5% below the 10,000 EUR mandatory reporting threshold — "
            "a textbook structuring indicator. Memo 'cash deposit' provides no business context."
        ),
    },
    "InvestigatorLLMOutput": {
        "recommendation": "file_sar",
        "reasoning": (
            "Confirmed structuring pattern: the transfer amount sits just below the reporting "
            "threshold with no verifiable business purpose. A Suspicious Activity Report is warranted."
        ),
        "evidence": [
            "Amount 9,450 EUR is 5.5% below the 10,000 EUR reporting threshold",
            "Memo 'cash deposit' lacks any business or payroll reference",
            "Pattern consistent with single-transaction structuring typology",
        ],
    },
}


def call_llm(
    system_prompt: str,
    user_prompt: str,
    output_model: type[T],
    agent_id: str,
) -> T:
    """
    Call a local Ollama model with structured JSON output and parse into a Pydantic model.
    Validation failure → audit log entry + ValueError (no DB write).
    Set DEMO_MODE=true in .env to skip the LLM call and return canned responses.
    Set OLLAMA_MODEL in .env to choose the model (default: qwen2.5:3b).
    """
    if os.environ.get("DEMO_MODE", "").lower() == "true":
        demo = _DEMO_RESPONSES.get(output_model.__name__)
        if demo:
            return output_model.model_validate(demo)

    model = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")

    try:
        resp = ollama.chat(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
            format=output_model.model_json_schema(),
            options={"temperature": 0.1, "num_predict": 1024},
        )
    except Exception as exc:
        raise ValueError(f"Ollama error: {exc}") from exc

    raw = resp.message.content or ""

    try:
        return output_model.model_validate_json(raw)
    except (ValidationError, ValueError) as exc:
        audit.append("llm_validation_failure", {
            "agent_id": agent_id,
            "model": output_model.__name__,
            "error": str(exc),
            "raw_truncated": raw[:500],
        })
        raise ValueError(f"LLM output failed Pydantic validation: {exc}") from exc


def kill_switch_active(agent_id: str) -> bool:
    data = call_governance(agent_id, "check_kill_switch", {})
    return bool(data.get("active", False))

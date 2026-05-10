"""Governance layer — the only code that writes to the database.

All agent actions must pass through POST /internal/governance/action.

Authentication: HMAC-SHA256 over raw request body.
  Header X-Agent-Id:   "triage" | "investigator"
  Header X-Signature:  hex(HMAC-SHA256(body_bytes, AGENT_SECRET))

Allowlist (server-side):
  triage:       check_kill_switch, read_transaction, create_triage_case
  investigator: check_kill_switch, read_transaction, read_case,
                create_investigator_decision
"""

import hashlib
import hmac as _hmac
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import app.audit as audit
from app.db import get_db
from app.models import GovernanceRequest, GovernanceResponse

router = APIRouter(prefix="/internal/governance", tags=["governance"])

# ── Allowlist ─────────────────────────────────────────────────────────────────

_ALLOWLIST: dict[str, frozenset[str]] = {
    "triage": frozenset({
        "check_kill_switch",
        "read_transaction",
        "create_triage_case",
    }),
    "investigator": frozenset({
        "check_kill_switch",
        "read_transaction",
        "read_case",
        "create_investigator_decision",
    }),
}


# ── HMAC helpers ──────────────────────────────────────────────────────────────

def _agent_secret(agent_id: str) -> str:
    key = f"{agent_id.upper()}_AGENT_SECRET"
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(f"Missing env var {key}")
    return val


def sign_body(body: bytes, agent_id: str) -> str:
    return _hmac.new(
        _agent_secret(agent_id).encode(),
        body,
        hashlib.sha256,
    ).hexdigest()


def _verify(agent_id: str, body: bytes, sig: str) -> bool:
    expected = sign_body(body, agent_id)
    return _hmac.compare_digest(expected, sig)


# ── Enforcement middleware ────────────────────────────────────────────────────

async def _parse_and_authenticate(request: Request) -> GovernanceRequest:
    body = await request.body()
    agent_id = request.headers.get("X-Agent-Id", "")
    signature = request.headers.get("X-Signature", "")

    if not agent_id or not signature:
        raise HTTPException(401, "Missing X-Agent-Id or X-Signature header")

    if agent_id not in _ALLOWLIST:
        audit.append("auth_failure", {"agent_id": agent_id, "reason": "unknown_agent"})
        raise HTTPException(403, f"Unknown agent: {agent_id}")

    if not _verify(agent_id, body, signature):
        audit.append("auth_failure", {"agent_id": agent_id, "reason": "invalid_hmac"})
        raise HTTPException(401, "HMAC verification failed")

    try:
        req = GovernanceRequest.model_validate_json(body)
    except Exception as exc:
        raise HTTPException(422, f"Invalid request body: {exc}")

    if req.action_type not in _ALLOWLIST[agent_id]:
        audit.append("access_denied", {
            "agent_id": agent_id,
            "action_type": req.action_type,
            "reason": "not_in_allowlist",
        })
        raise HTTPException(
            403,
            f"Agent '{agent_id}' is not permitted to perform '{req.action_type}'",
        )

    return req


# ── Action handlers ───────────────────────────────────────────────────────────

def _check_kill_switch(_payload: dict) -> dict:
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM system_config WHERE key = 'kill_switch'"
        ).fetchone()
    state = json.loads(row["value"]) if row else {"active": False}
    return state


def _read_transaction(payload: dict) -> dict:
    tx_id = payload.get("transaction_id")
    if not tx_id:
        raise HTTPException(422, "transaction_id required")
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (tx_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Transaction not found")
    d = dict(row)
    d["flagged_injection"] = bool(d["flagged_injection"])
    return d


def _create_triage_case(payload: dict) -> dict:
    """Triage agent writes its decision and creates the Case in one atomic block."""
    required = [
        "transaction_id", "risk_score", "red_flags",
        "recommendation", "reasoning", "input_hash",
        "flagged_injection",
    ]
    for f in required:
        if f not in payload:
            raise HTTPException(422, f"Missing field: {f}")

    now = datetime.now(timezone.utc).isoformat()
    case_id = str(uuid.uuid4())
    decision_id = str(uuid.uuid4())
    version = os.environ.get("AGENT_VERSION", "1.0.0")

    risk_score = int(payload["risk_score"])
    red_flags: list[str] = payload["red_flags"]
    recommendation: str = payload["recommendation"]
    flagged_injection: bool = bool(payload["flagged_injection"])

    # Derive initial case status from recommendation
    status = "open" if recommendation in ("investigate", "escalate") else "closed"

    llm_output = {
        "risk_score": risk_score,
        "red_flags": red_flags,
        "recommendation": recommendation,
    }

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO cases
              (id, transaction_id, status, risk_score, red_flags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (case_id, payload["transaction_id"], status,
             risk_score, json.dumps(red_flags), now, now),
        )
        conn.execute(
            """
            INSERT INTO agent_decisions
              (id, case_id, agent_id, agent_version, input_hash,
               output, reasoning, recommendation, requires_approval, created_at)
            VALUES (?, ?, 'triage', ?, ?, ?, ?, ?, 0, ?)
            """,
            (decision_id, case_id, version, payload["input_hash"],
             json.dumps(llm_output), payload["reasoning"],
             recommendation, now),
        )
        # Mark injection flag on transaction
        conn.execute(
            "UPDATE transactions SET flagged_injection = ? WHERE id = ?",
            (1 if flagged_injection else 0, payload["transaction_id"]),
        )

    audit.append("triage_decision", {
        "case_id": case_id,
        "transaction_id": payload["transaction_id"],
        "decision_id": decision_id,
        "risk_score": risk_score,
        "recommendation": recommendation,
        "flagged_injection": flagged_injection,
    })

    return {
        "case_id": case_id,
        "decision_id": decision_id,
        "status": status,
        "risk_score": risk_score,
    }


def _read_case(payload: dict) -> dict:
    case_id = payload.get("case_id")
    if not case_id:
        raise HTTPException(422, "case_id required")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Case not found")
    d = dict(row)
    d["red_flags"] = json.loads(d["red_flags"])
    return d


def _create_investigator_decision(payload: dict) -> dict:
    """Investigator writes its decision; approval row created for non-close actions."""
    required = ["case_id", "recommendation", "reasoning", "evidence", "input_hash"]
    for f in required:
        if f not in payload:
            raise HTTPException(422, f"Missing field: {f}")

    now = datetime.now(timezone.utc).isoformat()
    decision_id = str(uuid.uuid4())
    version = os.environ.get("AGENT_VERSION", "1.0.0")

    recommendation: str = payload["recommendation"]
    requires_approval = recommendation != "close_no_action"
    evidence: list[str] = payload["evidence"]

    llm_output = {
        "recommendation": recommendation,
        "evidence": evidence,
    }

    approval_id: str | None = None
    new_status = "pending_approval" if requires_approval else "closed"

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO agent_decisions
              (id, case_id, agent_id, agent_version, input_hash,
               output, reasoning, recommendation, requires_approval, created_at)
            VALUES (?, ?, 'investigator', ?, ?, ?, ?, ?, ?, ?)
            """,
            (decision_id, payload["case_id"], version, payload["input_hash"],
             json.dumps(llm_output), payload["reasoning"],
             recommendation, 1 if requires_approval else 0, now),
        )

        if requires_approval:
            approval_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO approvals
                  (id, case_id, action, recommended_by, status)
                VALUES (?, ?, ?, 'investigator', 'pending')
                """,
                (approval_id, payload["case_id"], recommendation),
            )

        conn.execute(
            "UPDATE cases SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now, payload["case_id"]),
        )

    audit.append("investigator_decision", {
        "case_id": payload["case_id"],
        "decision_id": decision_id,
        "recommendation": recommendation,
        "requires_approval": requires_approval,
        "approval_id": approval_id,
    })

    return {
        "decision_id": decision_id,
        "requires_approval": requires_approval,
        "approval_id": approval_id,
        "new_case_status": new_status,
    }


_HANDLERS = {
    "check_kill_switch": _check_kill_switch,
    "read_transaction": _read_transaction,
    "create_triage_case": _create_triage_case,
    "read_case": _read_case,
    "create_investigator_decision": _create_investigator_decision,
}


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/action", response_model=GovernanceResponse)
async def governance_action(request: Request) -> GovernanceResponse:
    req = await _parse_and_authenticate(request)

    handler = _HANDLERS.get(req.action_type)
    if handler is None:
        raise HTTPException(400, f"No handler for action: {req.action_type}")

    try:
        data = handler(req.payload)
        return GovernanceResponse(success=True, data=data)
    except HTTPException:
        raise
    except Exception as exc:
        return GovernanceResponse(success=False, error=str(exc))

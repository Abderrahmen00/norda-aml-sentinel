"""NORDA AML Sentinel — FastAPI application."""

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

import app.audit as audit
from app.db import get_db, init_db
from app.governance import router as gov_router
from app.models import (
    AgentDecision,
    AgentResult,
    Approval,
    ApprovalDecision,
    AuditEntry,
    AuditVerifyResponse,
    Case,
    CaseDetail,
    IngestRequest,
    IngestResponse,
    InjectTestRequest,
    InjectTestResponse,
    InvestigateRequest,
    KillSwitchRequest,
    KillSwitchState,
    Transaction,
)

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="NORDA AML Sentinel",
    description="AI-powered AML transaction monitoring with governance layer",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(gov_router)


# ── Transactions ──────────────────────────────────────────────────────────────

@app.post("/transactions/ingest", response_model=IngestResponse, status_code=202)
async def ingest_transactions(body: IngestRequest) -> IngestResponse:
    """Ingest one or more transactions and immediately queue async triage for each."""
    now = datetime.now(timezone.utc).isoformat()
    # Collect (id, tx) pairs so audit writes happen after the DB transaction closes.
    pairs: list[tuple[str, object]] = []

    with get_db() as conn:
        for tx in body.transactions:
            tx_id = tx.id or str(uuid.uuid4())
            pairs.append((tx_id, tx))
            conn.execute(
                """
                INSERT OR IGNORE INTO transactions
                  (id, timestamp, amount_eur, currency,
                   sender_account, receiver_account, receiver_country,
                   memo, channel, flagged_injection, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    tx_id,
                    tx.timestamp.isoformat(),
                    tx.amount_eur,
                    tx.currency,
                    tx.sender_account,
                    tx.receiver_account,
                    tx.receiver_country,
                    tx.memo,
                    tx.channel,
                    now,
                ),
            )

    # Audit writes are outside the DB write transaction to avoid "database is locked".
    ids: list[str] = []
    for tx_id, tx in pairs:
        ids.append(tx_id)
        audit.append("transaction_ingested", {
            "transaction_id": tx_id,
            "amount_eur": tx.amount_eur,
            "currency": tx.currency,
            "sender_account": tx.sender_account,
            "receiver_country": tx.receiver_country,
        })

    # Fire-and-forget triage for each transaction (runs in thread pool to avoid
    # blocking the event loop while the agent makes sync HTTP calls back to governance).
    async def _triage_one(tx_id: str) -> None:
        from app.agents.triage import run as triage_run
        try:
            result = await asyncio.to_thread(triage_run, tx_id)
            if result.status == "error":
                audit.append("triage_error", {
                    "transaction_id": tx_id,
                    "error": result.message,
                })
        except Exception as exc:
            audit.append("triage_error", {
                "transaction_id": tx_id,
                "error": str(exc),
            })

    async def _triage_all() -> None:
        await asyncio.gather(*[_triage_one(tx_id) for tx_id in ids])

    asyncio.create_task(_triage_all())

    return IngestResponse(ingested=len(ids), transaction_ids=ids)


# ── Cases ─────────────────────────────────────────────────────────────────────

@app.get("/cases", response_model=list[Case])
async def list_cases(
    status: Optional[str] = Query(None, description="open | pending_approval | closed"),
    limit: int = Query(50, ge=1, le=500),
) -> list[Case]:
    with get_db() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM cases WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM cases ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [_row_to_case(r) for r in rows]


@app.get("/cases/{case_id}", response_model=CaseDetail)
async def get_case(case_id: str) -> CaseDetail:
    case = _fetch_case_or_404(case_id)

    with get_db() as conn:
        d_rows = conn.execute(
            "SELECT * FROM agent_decisions WHERE case_id = ? ORDER BY created_at ASC",
            (case_id,),
        ).fetchall()
        a_rows = conn.execute(
            "SELECT seq, hash FROM audit_log WHERE payload LIKE ? ORDER BY seq ASC",
            (f'%"{case_id}"%',),
        ).fetchall()

    decisions = [_row_to_decision(r) for r in d_rows]
    chain_proof = [r["hash"] for r in a_rows]

    return CaseDetail(case=case, decisions=decisions, chain_proof=chain_proof)


@app.post("/cases/{case_id}/investigate", response_model=AgentResult)
async def investigate_case(case_id: str, body: InvestigateRequest) -> AgentResult:
    _fetch_case_or_404(case_id)
    from app.agents.investigator import run as inv_run
    return await asyncio.to_thread(inv_run, case_id, body.triggered_by)


# ── Approvals ─────────────────────────────────────────────────────────────────

@app.post("/approvals/{approval_id}/decide", response_model=Approval)
async def decide_approval(approval_id: str, body: ApprovalDecision) -> Approval:
    approval = _fetch_approval_or_404(approval_id)
    if approval.status != "pending":
        raise HTTPException(409, f"Approval already {approval.status}")

    now = datetime.now(timezone.utc).isoformat()
    final_status = "approved" if body.decision == "approve" else "rejected"
    case_status = "closed" if body.decision == "approve" else "open"

    with get_db() as conn:
        conn.execute(
            "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
            (final_status, body.operator_id, now, approval_id),
        )
        conn.execute(
            "UPDATE cases SET status = ?, updated_at = ? WHERE id = ?",
            (case_status, now, approval.case_id),
        )

    audit.append("approval_decision", {
        "approval_id": approval_id,
        "case_id": approval.case_id,
        "action": approval.action,
        "decision": final_status,
        "operator_id": body.operator_id,
        "note": body.note,
    })

    return _fetch_approval_or_404(approval_id)


# ── Kill switch ───────────────────────────────────────────────────────────────

@app.post("/system/kill-switch", response_model=KillSwitchState)
async def trip_kill_switch(body: KillSwitchRequest) -> KillSwitchState:
    now = datetime.now(timezone.utc).isoformat()
    state = {"active": True, "reason": body.reason, "tripped_at": now}

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO system_config (key, value, updated_at)
            VALUES ('kill_switch', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (json.dumps(state), now),
        )

    audit.append("kill_switch_tripped", {"reason": body.reason, "tripped_at": now})
    return KillSwitchState(**state)


@app.delete("/system/kill-switch", response_model=KillSwitchState)
async def reset_kill_switch() -> KillSwitchState:
    now = datetime.now(timezone.utc).isoformat()
    state = {"active": False, "reason": None, "tripped_at": None}

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO system_config (key, value, updated_at)
            VALUES ('kill_switch', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (json.dumps(state), now),
        )

    audit.append("kill_switch_reset", {"reset_at": now})
    return KillSwitchState(**state)


@app.get("/system/kill-switch", response_model=KillSwitchState)
async def get_kill_switch() -> KillSwitchState:
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM system_config WHERE key = 'kill_switch'"
        ).fetchone()
    if not row:
        return KillSwitchState(active=False)
    return KillSwitchState(**json.loads(row["value"]))


# ── Audit ─────────────────────────────────────────────────────────────────────

@app.get("/audit/verify", response_model=AuditVerifyResponse)
async def verify_chain() -> AuditVerifyResponse:
    return AuditVerifyResponse(**audit.verify())


@app.get("/audit/chain", response_model=list[AuditEntry])
async def get_audit_chain(
    from_seq: int = Query(0, alias="from", ge=0),
    to_seq: Optional[int] = Query(None, alias="to"),
) -> list[AuditEntry]:
    with get_db() as conn:
        if to_seq is not None:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE seq >= ? AND seq <= ? ORDER BY seq ASC",
                (from_seq, to_seq),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE seq >= ? ORDER BY seq ASC LIMIT 500",
                (from_seq,),
            ).fetchall()

    return [
        AuditEntry(
            seq=r["seq"],
            timestamp=r["timestamp"],
            event_type=r["event_type"],
            payload=json.loads(r["payload"]),
            prev_hash=r["prev_hash"],
            hash=r["hash"],
            hmac=r["hmac"],
        )
        for r in rows
    ]


# ── Security: inject-test ─────────────────────────────────────────────────────

@app.post("/security/inject-test", response_model=InjectTestResponse)
async def inject_test(body: InjectTestRequest) -> InjectTestResponse:
    """
    Demo endpoint: runs the payload through the guardrail and returns the full
    detection trace. NEVER calls the LLM if the guardrail trips.
    """
    from app.guardrails import check as guardrail_check, sanitize

    detected, reasons = guardrail_check(body.payload)
    sanitized = sanitize(body.payload, body.target_field)

    logged = False
    if detected:
        audit.append("security_event", {
            "event": "inject_test_triggered",
            "target_field": body.target_field,
            "reasons": reasons,
            "payload_truncated": body.payload[:200],
        })
        logged = True

    llm_would_receive = sanitized if detected else body.payload

    return InjectTestResponse(
        injection_detected=detected,
        reasons=reasons,
        sanitized_value=sanitized,
        llm_would_receive=llm_would_receive,
        audit_logged=logged,
    )


# ── Frontend API (enriched shape for the UI) ─────────────────────────────────

_FLAG_MAP = {
    "structuring": "STRUCTURING",
    "amount_below_threshold": "STRUCTURING",
    "high_risk_corridor": "HIGH_RISK_GEO",
    "large_amount": "ROUND_AMOUNT",
    "round_amount": "ROUND_AMOUNT",
    "rapid_passthrough": "RAPID_PASSTHROUGH",
    "shell_indicators": "SHELL_INDICATORS",
    "pep_match": "PEP_MATCH",
    "sanctions_proximity": "SANCTIONS_PROXIMITY",
    "velocity_spike": "VELOCITY_SPIKE",
    "memo_anomaly": "MEMO_ANOMALY",
    "prompt_injection_detected": "MEMO_ANOMALY",
}


def _map_flags(raw: list[str]) -> list[str]:
    seen, out = set(), []
    for f in raw:
        mapped = _FLAG_MAP.get(f.lower(), f.upper())
        if mapped not in seen:
            seen.add(mapped)
            out.append(mapped)
    return out


def _enrich_case(case_row, tx_row) -> dict:
    flags = _map_flags(json.loads(case_row["red_flags"]))
    status = case_row["status"]
    return {
        "id": case_row["id"],
        "transaction_id": case_row["transaction_id"],
        "created_at": case_row["created_at"],
        "amount": tx_row["amount_eur"] if tx_row else 0,
        "currency": tx_row["currency"] if tx_row else "EUR",
        "direction": "OUTBOUND",
        "originator": {
            "name": "Norda Bank — Corporate Account",
            "iban": tx_row["sender_account"] if tx_row else "",
        },
        "counterparty": {
            "name": tx_row["receiver_account"] if tx_row else "",
            "country": tx_row["receiver_country"] if tx_row else "",
            "iban": tx_row["receiver_account"] if tx_row else "",
        },
        "memo": (tx_row["memo"] or "") if tx_row else "",
        "channel": (tx_row["channel"] or "sepa") if tx_row else "sepa",
        "risk_score": case_row["risk_score"],
        "status": status,
        "flags": flags,
        "requires_approval": status == "pending_approval",
        "summary": f"Risk score {case_row['risk_score']}/100 · flags: {', '.join(flags) or 'none'}",
        "assigned_to": "OP-A.JENDOUBI" if status == "pending_approval" else None,
    }


@app.get("/api/cases")
async def api_list_cases(limit: int = Query(100, ge=1, le=500)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.*, t.amount_eur, t.currency, t.sender_account,
                   t.receiver_account, t.receiver_country, t.memo, t.channel
            FROM cases c
            LEFT JOIN transactions t ON t.id = c.transaction_id
            ORDER BY c.created_at DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [_enrich_case(r, r) for r in rows]


@app.get("/api/cases/{case_id}")
async def api_get_case(case_id: str):
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT c.*, t.amount_eur, t.currency, t.sender_account,
                   t.receiver_account, t.receiver_country, t.memo, t.channel
            FROM cases c
            LEFT JOIN transactions t ON t.id = c.transaction_id
            WHERE c.id = ?
            """,
            (case_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Case not found")
        d_rows = conn.execute(
            "SELECT * FROM agent_decisions WHERE case_id = ? ORDER BY created_at ASC",
            (case_id,),
        ).fetchall()
        a_rows = conn.execute(
            "SELECT * FROM approvals WHERE case_id = ? LIMIT 1",
            (case_id,),
        ).fetchone()

    base = _enrich_case(row, row)
    base["decisions"] = [
        {
            "id": d["id"],
            "agent_id": d["agent_id"],
            "agent_version": d["agent_version"],
            "created_at": d["created_at"],
            "output": json.loads(d["output"]),
            "requires_approval": bool(d["requires_approval"]),
        }
        for d in d_rows
    ]
    base["approval"] = dict(a_rows) if a_rows else None
    return base


# ── Static frontend ────────────────────────────────────────────────────────────
import os as _os
_static_dir = _os.path.join(_os.path.dirname(__file__), "..", "static")
if _os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")


# ── Row helpers ───────────────────────────────────────────────────────────────

def _row_to_case(row) -> Case:
    d = dict(row)
    d["red_flags"] = json.loads(d["red_flags"])
    return Case(**d)


def _row_to_decision(row) -> AgentDecision:
    d = dict(row)
    d["output"] = json.loads(d["output"])
    d["requires_approval"] = bool(d["requires_approval"])
    return AgentDecision(**d)


def _fetch_case_or_404(case_id: str) -> Case:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Case not found")
    return _row_to_case(row)


def _fetch_approval_or_404(approval_id: str) -> Approval:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM approvals WHERE id = ?", (approval_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Approval not found")
    return Approval(**dict(row))



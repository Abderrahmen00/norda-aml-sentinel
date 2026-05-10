from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ── Domain models ─────────────────────────────────────────────────────────────

class Transaction(BaseModel):
    id: str
    timestamp: datetime
    amount_eur: float
    currency: str
    sender_account: str
    receiver_account: str
    receiver_country: str
    memo: Optional[str] = None
    channel: str
    flagged_injection: bool = False
    created_at: datetime


class TransactionIngest(BaseModel):
    """Single transaction in a bulk-ingest request."""
    id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    amount_eur: float = Field(gt=0)
    currency: str = Field(min_length=3, max_length=3)
    sender_account: str = Field(min_length=1)
    receiver_account: str = Field(min_length=1)
    receiver_country: str = Field(min_length=2, max_length=2)
    memo: Optional[str] = None
    channel: str = Field(min_length=1)


class IngestRequest(BaseModel):
    transactions: list[TransactionIngest] = Field(min_length=1, max_length=500)


class IngestResponse(BaseModel):
    ingested: int
    transaction_ids: list[str]


class Case(BaseModel):
    id: str
    transaction_id: str
    status: Literal["open", "pending_approval", "closed"]
    risk_score: int = Field(ge=0, le=100)
    red_flags: list[str]
    created_at: datetime
    updated_at: datetime


class AgentDecision(BaseModel):
    id: str
    case_id: str
    agent_id: Literal["triage", "investigator"]
    agent_version: str
    input_hash: str
    output: dict[str, Any]
    reasoning: str
    recommendation: Optional[str] = None
    requires_approval: bool
    created_at: datetime


class Approval(BaseModel):
    id: str
    case_id: str
    action: str
    recommended_by: str
    status: Literal["pending", "approved", "rejected"]
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None


class AuditEntry(BaseModel):
    seq: int
    timestamp: datetime
    event_type: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str
    hmac: str


# ── Request / response models ─────────────────────────────────────────────────

class InvestigateRequest(BaseModel):
    triggered_by: Literal["auto", "operator"] = "operator"


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]
    operator_id: str = Field(min_length=1)
    note: Optional[str] = None


class KillSwitchRequest(BaseModel):
    reason: str = Field(min_length=1)


class KillSwitchState(BaseModel):
    active: bool
    reason: Optional[str] = None
    tripped_at: Optional[datetime] = None


class AuditVerifyResponse(BaseModel):
    valid: bool
    broken_at: Optional[int] = None
    total_entries: int


class CaseDetail(BaseModel):
    case: Case
    decisions: list[AgentDecision]
    chain_proof: list[str]


class InjectTestRequest(BaseModel):
    payload: str
    target_field: Literal["memo", "counterparty"]


class InjectTestResponse(BaseModel):
    injection_detected: bool
    reasons: list[str]
    sanitized_value: str
    llm_would_receive: str
    audit_logged: bool


# ── LLM structured-output models ─────────────────────────────────────────────

class TriageLLMOutput(BaseModel):
    risk_score: int = Field(
        ge=0, le=100,
        description="Integer risk score 0 (no risk) to 100 (critical)",
    )
    red_flags: list[str] = Field(
        description="Specific AML red flags observed; empty list if none",
    )
    recommendation: Literal["clear", "investigate", "escalate"] = Field(
        description="clear=low risk, investigate=medium, escalate=immediate action",
    )
    reasoning: str = Field(
        min_length=20,
        description="Concise explanation of the risk assessment",
    )


class InvestigatorLLMOutput(BaseModel):
    recommendation: Literal[
        "freeze_account", "file_sar", "close_no_action", "escalate_to_l2"
    ] = Field(description="Recommended enforcement action")
    reasoning: str = Field(
        min_length=20,
        description="Full investigative reasoning supporting the recommendation",
    )
    evidence: list[str] = Field(
        min_length=1,
        description="Specific factual evidence items from the transaction data",
    )


# ── Governance internal models ────────────────────────────────────────────────

class GovernanceRequest(BaseModel):
    agent_id: Literal["triage", "investigator"]
    action_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class GovernanceResponse(BaseModel):
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None


class AgentResult(BaseModel):
    status: Literal["success", "error", "system_suspended", "skipped"]
    message: str
    data: Optional[Any] = None

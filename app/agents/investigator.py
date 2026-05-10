"""Investigator agent.

Allowlisted governance actions: check_kill_switch, read_transaction,
read_case, create_investigator_decision.

Flow:
  1. Kill-switch check
  2. Read case + linked transaction via governance
  3. Injection scan on all user-influenced fields
  4. Call LLM for full investigation
  5. Write AgentDecision (+ Approval if recommendation != close_no_action) via governance
"""

import hashlib
import json

import app.audit as audit
from app.agents.base import call_governance, call_llm, kill_switch_active
from app.guardrails import check as guardrail_check, sanitize
from app.models import AgentResult, InvestigatorLLMOutput

AGENT_ID = "investigator"

_SYSTEM = """You are a senior AML investigator with deep expertise in financial crime.
Perform a comprehensive investigation and recommend an enforcement action.

RECOMMENDATION RULES — follow strictly:
  • file_sar:        Triage risk ≥ 75, OR confirmed structuring, OR sanctions/PEP proximity.
                     This is the DEFAULT for high-risk cases. When in doubt, file_sar.
  • freeze_account:  Active fraud in progress, layering detected, or >€500k to sanctioned corridor.
  • escalate_to_l2:  Complex multi-flag or cross-border case with triage risk 55–74.
  • close_no_action: ONLY when every red flag has a clear, documented business explanation.
                     DO NOT use this when triage risk ≥ 56. DO NOT downgrade without proof.

CRITICAL RULES:
  • Never close_no_action when triage flagged structuring, sanctions_proximity, or high_risk_corridor.
  • Never close_no_action when amount > €100,000 unless the business purpose is documented in the memo.
  • A vague memo ("invoice", "services", "payment") is NOT sufficient justification to close.
  • Transfers to AZ, AE, CY, IR, KP, RU, BY, SY require file_sar or freeze_account minimum.
  • If triage recommendation was "escalate", you MUST use file_sar or freeze_account.

Your evidence list must cite specific, observable facts from the transaction data — not opinions.
"""


def _input_hash(*objs: object) -> str:
    combined = json.dumps(objs, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(combined.encode()).hexdigest()


def run(case_id: str, triggered_by: str = "operator") -> AgentResult:
    # 1. Kill switch
    if kill_switch_active(AGENT_ID):
        return AgentResult(
            status="system_suspended",
            message="Kill switch is active — agent suspended.",
        )

    # 2. Read case
    try:
        case = call_governance(AGENT_ID, "read_case", {"case_id": case_id})
    except Exception as exc:
        return AgentResult(status="error", message=str(exc))

    if case.get("status") == "closed":
        return AgentResult(
            status="skipped",
            message="Case is already closed.",
            data={"status": "closed"},
        )

    # 3. Read linked transaction
    try:
        tx = call_governance(
            AGENT_ID, "read_transaction",
            {"transaction_id": case["transaction_id"]},
        )
    except Exception as exc:
        return AgentResult(status="error", message=f"Could not read transaction: {exc}")

    # 4. Injection scan
    injection_detected = False
    for field in ("memo", "receiver_country"):
        val = tx.get(field)
        flagged, reasons = guardrail_check(val)
        if flagged:
            injection_detected = True
            audit.append("security_event", {
                "event": "prompt_injection_detected",
                "case_id": case_id,
                "transaction_id": tx["id"],
                "field": field,
                "reasons": reasons,
            })

    memo_llm = sanitize(tx.get("memo"), "memo")
    country_llm = sanitize(tx.get("receiver_country"), "receiver_country")

    # 5. LLM full investigation
    triage_flags = case.get("red_flags", [])

    user_prompt = f"""Investigate this AML case:

Case ID:          {case['id']}
Case Status:      {case['status']}
Triage Risk:      {case['risk_score']}/100
Triage Red Flags: {', '.join(triage_flags) if triage_flags else 'none'}
Triggered by:     {triggered_by}

Transaction details:
  ID:               {tx['id']}
  Amount:           {tx['amount_eur']} {tx['currency']}
  Timestamp:        {tx['timestamp']}
  Sender account:   {tx['sender_account']}
  Receiver account: {tx['receiver_account']}
  Receiver country: {country_llm}
  Channel:          {tx['channel']}
  Memo:             {memo_llm or '(none)'}
  Injection flag:   {tx.get('flagged_injection', False)}

Injection guard: {"INJECTION DETECTED — some fields were redacted" if injection_detected else "clean"}

Provide your JSON enforcement recommendation."""

    try:
        llm_out = call_llm(_SYSTEM, user_prompt, InvestigatorLLMOutput, AGENT_ID)
    except Exception as exc:
        return AgentResult(status="error", message=str(exc))

    # Force escalate when injection detected
    if injection_detected:
        llm_out = InvestigatorLLMOutput(
            recommendation="escalate_to_l2",
            reasoning=(
                llm_out.reasoning
                + " [Auto-escalated: prompt injection attempts detected in transaction fields.]"
            ),
            evidence=llm_out.evidence + [
                "SECURITY: Prompt injection attempt detected — human review mandatory."
            ],
        )

    # 6. Write via governance
    try:
        result = call_governance(AGENT_ID, "create_investigator_decision", {
            "case_id": case_id,
            "recommendation": llm_out.recommendation,
            "reasoning": llm_out.reasoning,
            "evidence": llm_out.evidence,
            "input_hash": _input_hash(case, tx),
        })
    except Exception as exc:
        return AgentResult(status="error", message=f"Governance write failed: {exc}")

    return AgentResult(
        status="success",
        message=f"Investigation complete: {llm_out.recommendation}",
        data={
            "decision_id": result["decision_id"],
            "recommendation": llm_out.recommendation,
            "requires_approval": result["requires_approval"],
            "approval_id": result.get("approval_id"),
            "new_case_status": result["new_case_status"],
        },
    )

"""
Full demo flow: ingest → triage → investigate → approve → verify audit chain.
Run with: uv run python demo.py
"""

import time
import httpx

BASE = "http://127.0.0.1:8000"


def step(label: str):
    print(f"\n{'─'*60}")
    print(f"  {label}")
    print('─'*60)


def main():
    client = httpx.Client(base_url=BASE, timeout=30)

    # ── 1. Health check ────────────────────────────────────────────
    step("1. Health check")
    r = client.get("/audit/verify")
    r.raise_for_status()
    print(f"Server up. Audit entries: {r.json()['total_entries']}")

    # ── 2. Ingest a suspicious transaction ────────────────────────
    step("2. Ingest suspicious transaction (structuring pattern)")
    r = client.post("/transactions/ingest", json={"transactions": [{
        "amount_eur": 9450.0,
        "currency": "EUR",
        "sender_account": "ACCT-DEMO-SND",
        "receiver_account": "ACCT-DEMO-RCV",
        "receiver_country": "DE",
        "memo": "cash deposit",
        "channel": "sepa",
    }]})
    r.raise_for_status()
    tx_id = r.json()["transaction_ids"][0]
    print(f"Transaction ID : {tx_id}")

    # ── 3. Wait for triage agent ──────────────────────────────────
    step("3. Waiting for triage agent...")
    case = None
    for _ in range(20):
        time.sleep(1)
        cases = client.get("/cases").json()
        for c in cases:
            if c["transaction_id"] == tx_id:
                case = c
                break
        if case:
            break

    if not case:
        print("ERROR: triage did not create a case within 20 s")
        return

    print(f"Case ID        : {case['id']}")
    print(f"Risk score     : {case['risk_score']}/100")
    print(f"Red flags      : {case['red_flags']}")
    print(f"Status         : {case['status']}")

    # ── 4. Investigate ────────────────────────────────────────────
    step("4. Triggering investigation")
    r = client.post(f"/cases/{case['id']}/investigate", json={"triggered_by": "operator"})
    r.raise_for_status()
    result = r.json()
    print(f"Recommendation : {result['data']['recommendation']}")
    print(f"Requires HITL  : {result['data']['requires_approval']}")

    approval_id = result["data"].get("approval_id")
    if not approval_id:
        print("No approval needed — case closed automatically.")
        return

    print(f"Approval ID    : {approval_id}")

    # ── 5. Operator approves ──────────────────────────────────────
    step("5. Operator approves the SAR filing")
    r = client.post(f"/approvals/{approval_id}/decide", json={
        "decision": "approve",
        "operator_id": "analyst_jane",
        "note": "Structuring pattern confirmed — filing SAR.",
    })
    r.raise_for_status()
    approval = r.json()
    print(f"Decision       : {approval['status']}")
    print(f"Decided by     : {approval['decided_by']}")
    print(f"Decided at     : {approval['decided_at']}")

    # ── 6. Audit chain ────────────────────────────────────────────
    step("6. Audit chain")
    chain = client.get("/audit/chain?from=0").json()
    for entry in chain:
        print(f"  seq={entry['seq']:>3}  {entry['event_type']}")

    verify = client.get("/audit/verify").json()
    status = "✓ VALID" if verify["valid"] else "✗ BROKEN"
    print(f"\nChain integrity: {status}  ({verify['total_entries']} entries)")


if __name__ == "__main__":
    main()

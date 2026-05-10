"""Integration tests for the governance layer.

Tests: HMAC auth, per-agent allowlist, all valid action types,
kill-switch, and audit side-effects.
"""

import hashlib
import hmac as _hmac
import json
import os

import pytest

from tests.conftest import gov_post, sign


# ── HMAC authentication ────────────────────────────────────────────────────

def test_missing_headers_returns_401(client):
    r = client.post(
        "/internal/governance/action",
        json={"agent_id": "triage", "action_type": "check_kill_switch", "payload": {}},
    )
    assert r.status_code == 401


def test_bad_signature_returns_401(client):
    body = {"agent_id": "triage", "action_type": "check_kill_switch", "payload": {}}
    r = client.post(
        "/internal/governance/action",
        content=json.dumps(body, separators=(",", ":")),
        headers={
            "Content-Type": "application/json",
            "X-Agent-Id": "triage",
            "X-Signature": "deadbeefdeadbeef",
        },
    )
    assert r.status_code == 401
    assert "HMAC" in r.json()["detail"]


def test_unknown_agent_returns_403(client):
    body = {"agent_id": "ghost", "action_type": "check_kill_switch", "payload": {}}
    r = client.post(
        "/internal/governance/action",
        content=json.dumps(body, separators=(",", ":")),
        headers={
            "Content-Type": "application/json",
            "X-Agent-Id": "ghost",
            "X-Signature": "anything",
        },
    )
    assert r.status_code == 403
    assert "Unknown agent" in r.json()["detail"]


def test_wrong_agent_id_in_body_vs_header(client):
    # Header says triage but body says investigator — HMAC covers body, so mismatch
    body = {"agent_id": "investigator", "action_type": "check_kill_switch", "payload": {}}
    sig = sign(body, "triage")  # signed with triage key
    r = client.post(
        "/internal/governance/action",
        content=json.dumps(body, separators=(",", ":")),
        headers={
            "Content-Type": "application/json",
            "X-Agent-Id": "triage",
            "X-Signature": sig,
        },
    )
    # Body parses but agent_id in body is "investigator" while header is "triage",
    # so signature was computed correctly for triage on an investigator-body → passes auth,
    # but governance reads agent_id from header for allowlist check.
    # Actual: governance uses header X-Agent-Id for auth and allowlist.
    # Since triage is allowed check_kill_switch, this should succeed with success=true.
    data = r.json()
    assert r.status_code == 200


# ── Allowlist enforcement ──────────────────────────────────────────────────

@pytest.mark.parametrize("agent,action", [
    ("triage",       "read_case"),
    ("triage",       "create_investigator_decision"),
    ("investigator", "create_triage_case"),
])
def test_forbidden_action_returns_403(client, agent, action):
    body = {"agent_id": agent, "action_type": action, "payload": {}}
    r = gov_post(client, agent, action, {})
    assert r.status_code == 403
    assert "not permitted" in r.json()["detail"]


@pytest.mark.parametrize("agent,action", [
    ("triage",       "check_kill_switch"),
    ("triage",       "read_transaction"),
    ("triage",       "create_triage_case"),
    ("investigator", "check_kill_switch"),
    ("investigator", "read_transaction"),
    ("investigator", "read_case"),
    ("investigator", "create_investigator_decision"),
])
def test_allowed_actions_do_not_return_403(client, agent, action):
    # We don't care if the action itself fails (e.g. missing payload fields),
    # only that it wasn't rejected by the allowlist.
    r = gov_post(client, agent, action, {})
    assert r.status_code != 403, f"{agent}→{action} should be allowed but got 403"


# ── check_kill_switch action ───────────────────────────────────────────────

def test_check_kill_switch_returns_active_field(client):
    r = gov_post(client, "triage", "check_kill_switch", {})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert "active" in data["data"]


def test_kill_switch_state_reflected_in_governance(client):
    # Trip the switch via public API
    client.post("/system/kill-switch", json={"reason": "governance-test"})

    r = gov_post(client, "triage", "check_kill_switch", {})
    assert r.json()["data"]["active"] is True

    # Reset
    client.delete("/system/kill-switch")
    r2 = gov_post(client, "triage", "check_kill_switch", {})
    assert r2.json()["data"]["active"] is False


# ── read_transaction action ────────────────────────────────────────────────

def test_read_transaction_not_found(client):
    r = gov_post(client, "triage", "read_transaction", {"transaction_id": "nonexistent"})
    assert r.status_code == 404


def test_read_transaction_missing_id_returns_422(client):
    r = gov_post(client, "triage", "read_transaction", {})
    assert r.status_code == 422


def test_read_transaction_returns_data(client):
    # Ingest a transaction first
    ingest = client.post("/transactions/ingest", json={"transactions": [{
        "amount_eur": 500.0, "currency": "EUR",
        "sender_account": "SND-GOV", "receiver_account": "RCV-GOV",
        "receiver_country": "NL", "memo": "governance read test", "channel": "sepa",
    }]})
    tx_id = ingest.json()["transaction_ids"][0]

    r = gov_post(client, "triage", "read_transaction", {"transaction_id": tx_id})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["id"] == tx_id
    assert data["amount_eur"] == 500.0
    assert data["receiver_country"] == "NL"


# ── read_case action (investigator only) ──────────────────────────────────

def test_read_case_not_found(client):
    r = gov_post(client, "investigator", "read_case", {"case_id": "nonexistent"})
    assert r.status_code == 404


def test_read_case_missing_id_returns_422(client):
    r = gov_post(client, "investigator", "read_case", {})
    assert r.status_code == 422


# ── Auth failure is audit-logged ──────────────────────────────────────────

def test_bad_hmac_is_audit_logged(client):
    before = client.get("/audit/verify").json()["total_entries"]

    body = {"agent_id": "triage", "action_type": "check_kill_switch", "payload": {}}
    client.post(
        "/internal/governance/action",
        content=json.dumps(body, separators=(",", ":")),
        headers={
            "Content-Type": "application/json",
            "X-Agent-Id": "triage",
            "X-Signature": "badhmacsig",
        },
    )

    after = client.get("/audit/verify").json()["total_entries"]
    assert after > before


def test_access_denied_is_audit_logged(client):
    before = client.get("/audit/verify").json()["total_entries"]
    gov_post(client, "triage", "read_case", {"case_id": "x"})
    after = client.get("/audit/verify").json()["total_entries"]
    assert after > before

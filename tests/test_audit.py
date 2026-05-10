"""Unit + integration tests for the hash-chained audit log."""

import hashlib
import json
import os
import sqlite3

import pytest

import app.audit as audit
from app.audit import GENESIS_HASH, _canonical, _sha256, _hmac_sign


# ── Pure hash-math unit tests (no DB) ─────────────────────────────────────

def test_canonical_is_deterministic():
    a = _canonical({"z": 1, "a": 2, "m": 3})
    b = _canonical({"m": 3, "z": 1, "a": 2})
    assert a == b


def test_canonical_no_whitespace():
    out = _canonical({"key": "value"})
    assert " " not in out


def test_sha256_chaining():
    h1 = _sha256(GENESIS_HASH, '{"event_type":"test"}')
    h2 = _sha256(GENESIS_HASH, '{"event_type":"test"}')
    assert h1 == h2  # deterministic

    h3 = _sha256(h1, '{"event_type":"test2"}')
    assert h3 != h1  # different input → different hash


def test_hmac_sign_uses_secret():
    import os
    secret = os.environ["AUDIT_SECRET"]
    h = "a" * 64
    sig1 = _hmac_sign(h, secret)
    sig2 = _hmac_sign(h, "wrong_secret")
    assert sig1 != sig2


def test_genesis_hash_is_64_zeros():
    assert GENESIS_HASH == "0" * 64


# ── append() tests (via HTTP / server) ────────────────────────────────────

def test_append_and_verify(client):
    r = client.get("/audit/verify")
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is True
    assert data["broken_at"] is None
    before = data["total_entries"]

    # Ingest something to add an audit entry, then re-verify
    client.post("/transactions/ingest", json={"transactions": [{
        "amount_eur": 100.0, "currency": "EUR",
        "sender_account": "A", "receiver_account": "B",
        "receiver_country": "DE", "memo": "test", "channel": "sepa",
    }]})

    r2 = client.get("/audit/verify")
    data2 = r2.json()
    assert data2["valid"] is True
    assert data2["total_entries"] > before


def test_audit_chain_endpoint_returns_entries(client):
    r = client.get("/audit/chain?from=0")
    assert r.status_code == 200
    entries = r.json()
    assert isinstance(entries, list)
    assert len(entries) > 0

    first = entries[0]
    assert "seq" in first
    assert "hash" in first
    assert "hmac" in first
    assert "prev_hash" in first
    assert "event_type" in first
    assert "payload" in first


def test_audit_chain_range_query(client):
    r = client.get("/audit/chain?from=1&to=3")
    assert r.status_code == 200
    entries = r.json()
    seqs = [e["seq"] for e in entries]
    assert all(1 <= s <= 3 for s in seqs)


def test_audit_chain_prev_hash_linkage(client):
    # Add two synchronous audit entries so we always have a chain to walk.
    client.post("/system/kill-switch", json={"reason": "linkage-test"})
    client.delete("/system/kill-switch")

    r = client.get("/audit/chain?from=0")
    entries = r.json()
    assert len(entries) >= 2

    prev = GENESIS_HASH
    for entry in entries:
        assert entry["prev_hash"] == prev, (
            f"seq {entry['seq']}: prev_hash mismatch"
        )
        prev = entry["hash"]


def test_audit_entry_has_event_type_field(client):
    # Query from seq=1 upward; all real entries embed event_type in their payload.
    r = client.get("/audit/chain?from=0")
    entries = r.json()
    assert len(entries) >= 1
    for entry in entries:
        assert "event_type" in entry["payload"], (
            f"seq {entry['seq']} payload missing event_type: {entry['payload']}"
        )


def test_audit_verify_detects_tamper(client):
    """Tamper a row directly in SQLite and confirm /audit/verify catches it."""
    db_path = os.environ["NORDA_DB_PATH"]

    # Add a fresh entry so there is a known good chain before tampering.
    client.post("/transactions/ingest", json={"transactions": [{
        "amount_eur": 200.0, "currency": "EUR",
        "sender_account": "X", "receiver_account": "Y",
        "receiver_country": "FR", "memo": "tamper-test", "channel": "sepa",
    }]})
    before = client.get("/audit/verify").json()["total_entries"]

    # Find the first clean seq to tamper.
    chain_before = client.get("/audit/chain?from=0").json()
    target_seq = chain_before[0]["seq"]

    conn = sqlite3.connect(db_path)
    conn.execute(
        f"UPDATE audit_log SET payload = '{{\"tampered\":true}}' WHERE seq = {target_seq}"
    )
    conn.commit()
    conn.close()

    r = client.get("/audit/verify")
    data = r.json()
    assert data["valid"] is False
    assert data["broken_at"] == target_seq

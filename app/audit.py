"""Hash-chained signed audit log.

Each entry:
  hash = SHA-256( prev_hash || canonical_json(payload) )
  hmac = HMAC-SHA256( hash, AUDIT_SECRET )

Genesis prev_hash is 64 zeros.
"""

import hashlib
import hmac as _hmac
import json
import os
import threading
from datetime import datetime, timezone
from typing import Any

from app.db import get_db

GENESIS_HASH = "0" * 64

# Serialises all audit writes so sequence numbers are gap-free under concurrency.
_audit_lock = threading.Lock()


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _sha256(prev_hash: str, canonical: str) -> str:
    data = (prev_hash + canonical).encode()
    return hashlib.sha256(data).hexdigest()


def _hmac_sign(hash_val: str, secret: str) -> str:
    return _hmac.new(secret.encode(), hash_val.encode(), hashlib.sha256).hexdigest()


def append(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Append one entry to the audit chain and return it."""
    secret = os.environ["AUDIT_SECRET"]
    now = datetime.now(timezone.utc).isoformat()

    full_payload = {"event_type": event_type, "timestamp": now, **payload}
    canonical = _canonical(full_payload)

    with _audit_lock:
        with get_db() as conn:
            row = conn.execute(
                "SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1"
            ).fetchone()
            prev_seq = row["seq"] if row else 0
            prev_hash = row["hash"] if row else GENESIS_HASH

            seq = prev_seq + 1
            hash_val = _sha256(prev_hash, canonical)
            hmac_val = _hmac_sign(hash_val, secret)

            conn.execute(
                """
                INSERT INTO audit_log (timestamp, event_type, payload, prev_hash, hash, hmac)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (now, event_type, canonical, prev_hash, hash_val, hmac_val),
            )

    return {
        "seq": seq,
        "timestamp": now,
        "event_type": event_type,
        "payload": full_payload,
        "prev_hash": prev_hash,
        "hash": hash_val,
        "hmac": hmac_val,
    }


def verify() -> dict[str, Any]:
    """Walk the entire chain and verify hash linkage + HMAC integrity."""
    secret = os.environ["AUDIT_SECRET"]

    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY seq ASC"
        ).fetchall()

    total = len(rows)
    if total == 0:
        return {"valid": True, "broken_at": None, "total_entries": 0}

    prev_hash = GENESIS_HASH
    for row in rows:
        seq = row["seq"]

        if row["prev_hash"] != prev_hash:
            return {"valid": False, "broken_at": seq, "total_entries": total}

        recomputed_hash = _sha256(row["prev_hash"], row["payload"])
        if recomputed_hash != row["hash"]:
            return {"valid": False, "broken_at": seq, "total_entries": total}

        recomputed_hmac = _hmac_sign(row["hash"], secret)
        if recomputed_hmac != row["hmac"]:
            return {"valid": False, "broken_at": seq, "total_entries": total}

        prev_hash = row["hash"]

    return {"valid": True, "broken_at": None, "total_entries": total}

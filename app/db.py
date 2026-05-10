import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

# Override with NORDA_DB_PATH env var so tests can point at a temp file.
DB_PATH = Path(os.environ.get("NORDA_DB_PATH", "norda_aml.db"))

_SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS transactions (
    id               TEXT PRIMARY KEY,
    timestamp        TEXT NOT NULL,
    amount_eur       REAL NOT NULL,
    currency         TEXT NOT NULL,
    sender_account   TEXT NOT NULL,
    receiver_account TEXT NOT NULL,
    receiver_country TEXT NOT NULL,
    memo             TEXT,
    channel          TEXT NOT NULL,
    flagged_injection INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
    id              TEXT PRIMARY KEY,
    transaction_id  TEXT NOT NULL REFERENCES transactions(id),
    status          TEXT NOT NULL DEFAULT 'open',
    risk_score      INTEGER NOT NULL DEFAULT 0,
    red_flags       TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_decisions (
    id              TEXT PRIMARY KEY,
    case_id         TEXT NOT NULL REFERENCES cases(id),
    agent_id        TEXT NOT NULL,
    agent_version   TEXT NOT NULL,
    input_hash      TEXT NOT NULL,
    output          TEXT NOT NULL,
    reasoning       TEXT NOT NULL,
    recommendation  TEXT,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
    id              TEXT PRIMARY KEY,
    case_id         TEXT NOT NULL REFERENCES cases(id),
    action          TEXT NOT NULL,
    recommended_by  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    decided_by      TEXT,
    decided_at      TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp  TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload    TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL,
    hmac       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    # timeout=15: retry for 15 s if another connection holds a write lock
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(_SCHEMA)
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)",
            ("kill_switch", '{"active":false,"reason":null,"tripped_at":null}', now),
        )

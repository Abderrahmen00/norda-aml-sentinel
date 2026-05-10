"""
Shared test infrastructure.

Session layout
──────────────
1. Module-level os.environ writes run BEFORE any app import so DB_PATH
   and secrets are in place when app.db is first imported.
2. A real uvicorn server runs in a daemon thread.  Agents make actual
   HTTP calls to it — no mocking of the HTTP transport layer.
3. Groq is patched at app.agents.base.Groq for every test that needs it.
   Because agents run in asyncio.to_thread, the patch (module-level) is
   visible across threads.
"""

import hashlib
import hmac as _hmac
import json
import os
import tempfile
import threading
import time

import httpx
import pytest

# ── 1. Environment ─────────────────────────────────────────────────────────
# Must happen before any app.* import.
_tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp_db.close()

os.environ.update(
    NORDA_DB_PATH=_tmp_db.name,
    AUDIT_SECRET="test_audit_secret_padded_to_32_chars_xx",
    TRIAGE_AGENT_SECRET="test_triage_secret_padded_32_chars_xx",
    INVESTIGATOR_AGENT_SECRET="test_investigator_secret_32chars_xx",
    GEMINI_API_KEY="test_placeholder",
    APP_HOST="127.0.0.1",
    APP_PORT="18765",
    AGENT_VERSION="test-1.0",
)

# ── 2. App imports (after env is set) ──────────────────────────────────────
from app.db import init_db  # noqa: E402
from app.main import app  # noqa: E402

TEST_PORT = 18765
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"


# ── 3. Server fixture ──────────────────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def running_server():
    """Start uvicorn in a daemon thread for the entire test session."""
    import uvicorn

    init_db()
    config = uvicorn.Config(app, host="127.0.0.1", port=TEST_PORT, log_level="error")
    server = uvicorn.Server(config)
    t = threading.Thread(target=server.run, daemon=True)
    t.start()

    # Wait until the server is ready.
    for _ in range(40):
        try:
            httpx.get(f"{BASE_URL}/audit/verify", timeout=1)
            break
        except Exception:
            time.sleep(0.25)

    yield BASE_URL

    server.should_exit = True
    t.join(timeout=3)


@pytest.fixture
def client(running_server):
    """Synchronous httpx client pointed at the test server."""
    with httpx.Client(base_url=running_server, timeout=20) as c:
        yield c


# ── 4. Groq mock helpers ───────────────────────────────────────────────────

def _mock_completion(content: dict):
    """Build the MagicMock object that genai.GenerativeModel.generate_content returns."""
    from unittest.mock import MagicMock

    mock_resp = MagicMock()
    mock_resp.text = json.dumps(content)
    return mock_resp


TRIAGE_GOOD = {
    "risk_score": 75,
    "red_flags": ["structuring", "amount_below_threshold"],
    "recommendation": "investigate",
    "reasoning": "Amount just below the 10 000 EUR reporting threshold is a classic structuring indicator.",
}

TRIAGE_CLEAR = {
    "risk_score": 10,
    "red_flags": [],
    "recommendation": "clear",
    "reasoning": "Normal business payment, no red flags detected.",
}

TRIAGE_ESCALATE = {
    "risk_score": 92,
    "red_flags": ["high_risk_corridor", "large_amount"],
    "recommendation": "escalate",
    "reasoning": "Destination is a sanctioned country with a very large transfer amount.",
}

INVESTIGATOR_SAR = {
    "recommendation": "file_sar",
    "reasoning": "Pattern of repeated sub-threshold transfers is consistent with structuring.",
    "evidence": [
        "Amount 9 450 EUR is 5.5 % below reporting threshold",
        "No legitimate business purpose in memo",
        "Sender has three similar transactions in 14 days",
    ],
}

INVESTIGATOR_CLOSE = {
    "recommendation": "close_no_action",
    "reasoning": "Transaction verified as routine salary payment.",
    "evidence": ["Memo references payroll period", "Sender is a registered employer"],
}

INVESTIGATOR_FREEZE = {
    "recommendation": "freeze_account",
    "reasoning": "Funds appear to be proceeds of fraud.",
    "evidence": ["Receiver account flagged in previous SAR", "Rapid movement pattern"],
}


@pytest.fixture
def mock_triage(monkeypatch):
    """Patch Groq to return a valid investigate-level triage response."""
    from unittest.mock import MagicMock, patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.return_value = (
            _mock_completion(TRIAGE_GOOD)
        )
        yield MockClient


@pytest.fixture
def mock_triage_clear(monkeypatch):
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.return_value = (
            _mock_completion(TRIAGE_CLEAR)
        )
        yield MockClient


@pytest.fixture
def mock_triage_escalate(monkeypatch):
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.return_value = (
            _mock_completion(TRIAGE_ESCALATE)
        )
        yield MockClient


@pytest.fixture
def mock_investigator_sar(monkeypatch):
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.return_value = (
            _mock_completion(INVESTIGATOR_SAR)
        )
        yield MockClient


@pytest.fixture
def mock_investigator_close(monkeypatch):
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.return_value = (
            _mock_completion(INVESTIGATOR_CLOSE)
        )
        yield MockClient


@pytest.fixture
def mock_investigator_freeze(monkeypatch):
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.return_value = (
            _mock_completion(INVESTIGATOR_FREEZE)
        )
        yield MockClient


# ── Combined triage + investigator fixtures ────────────────────────────────
# When a test needs both triage AND investigation, using two separate patch
# fixtures would shadow each other (inner wins).  These combined fixtures
# use side_effect to return the right response for each sequential call:
# call 1 → triage response, call 2 → investigator response.

def _seq_mock(*contents: dict):
    """Build a side_effect function that returns responses in order."""
    from unittest.mock import MagicMock

    responses = [json.dumps(c) for c in contents]
    idx = [0]

    def _side_effect(*args, **kwargs):
        mock_resp = MagicMock()
        i = idx[0]
        mock_resp.text = responses[i] if i < len(responses) else responses[-1]
        idx[0] += 1
        return mock_resp

    return _side_effect


@pytest.fixture
def mock_triage_then_sar():
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.side_effect = (
            _seq_mock(TRIAGE_GOOD, INVESTIGATOR_SAR)
        )
        yield MockClient


@pytest.fixture
def mock_triage_then_close():
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.side_effect = (
            _seq_mock(TRIAGE_GOOD, INVESTIGATOR_CLOSE)
        )
        yield MockClient


@pytest.fixture
def mock_triage_then_freeze():
    from unittest.mock import patch

    with patch("app.agents.base.genai.Client") as MockClient:
        MockClient.return_value.models.generate_content.side_effect = (
            _seq_mock(TRIAGE_GOOD, INVESTIGATOR_FREEZE)
        )
        yield MockClient


# ── 5. HMAC signing helper ─────────────────────────────────────────────────

def sign(body_dict: dict, agent_id: str) -> str:
    raw = json.dumps(body_dict, separators=(",", ":")).encode()
    key = f"{agent_id.upper()}_AGENT_SECRET"
    return _hmac.new(os.environ[key].encode(), raw, hashlib.sha256).hexdigest()


def gov_post(client: httpx.Client, agent_id: str, action: str, payload: dict):
    """Authenticated governance POST."""
    body = {"agent_id": agent_id, "action_type": action, "payload": payload}
    return client.post(
        "/internal/governance/action",
        content=json.dumps(body, separators=(",", ":")),
        headers={
            "Content-Type": "application/json",
            "X-Agent-Id": agent_id,
            "X-Signature": sign(body, agent_id),
        },
    )


# ── 6. Sample transaction factory ─────────────────────────────────────────

def make_tx(**overrides):
    base = {
        "amount_eur": 9450.0,
        "currency": "EUR",
        "sender_account": "ACCT-TEST-SND",
        "receiver_account": "ACCT-TEST-RCV",
        "receiver_country": "DE",
        "memo": "cash deposit",
        "channel": "sepa",
    }
    base.update(overrides)
    return base

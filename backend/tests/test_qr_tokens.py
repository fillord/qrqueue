import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.services.qr_tokens import QRTokenError, issue_batch, verify


def test_batch_windows_overlap_by_15_seconds():
    queue_id = uuid.uuid4()
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

    batch = issue_batch(queue_id, now)
    assert batch["server_time"] == now

    ttl = timedelta(seconds=settings.qr_token_ttl_seconds)
    tokens = batch["tokens"]
    assert len(tokens) >= 2

    first, second = tokens[0], tokens[1]
    assert first["nbf"] == now
    assert first["exp"] == now + ttl + timedelta(seconds=15)
    assert second["nbf"] == now + ttl

    # 15s overlap: the next token is already valid before the previous one expires
    assert second["nbf"] < first["exp"]
    assert first["exp"] - second["nbf"] == timedelta(seconds=15)


def test_verify_before_nbf_is_not_yet_valid():
    queue_id = uuid.uuid4()
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    batch = issue_batch(queue_id, now)
    token = batch["tokens"][1]["token"]  # nbf = now + ttl

    with pytest.raises(QRTokenError) as exc_info:
        verify(token, now)
    assert exc_info.value.reason == "token_not_yet_valid"


def test_verify_within_window_returns_queue_id():
    queue_id = uuid.uuid4()
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    batch = issue_batch(queue_id, now)
    token = batch["tokens"][0]["token"]

    assert verify(token, now) == queue_id
    # still valid near the far edge of its window, within the overlap
    assert verify(token, batch["tokens"][0]["exp"] - timedelta(seconds=1)) == queue_id


def test_verify_after_exp_is_expired():
    queue_id = uuid.uuid4()
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    batch = issue_batch(queue_id, now)
    token = batch["tokens"][0]["token"]
    exp = batch["tokens"][0]["exp"]

    with pytest.raises(QRTokenError) as exc_info:
        verify(token, exp)
    assert exc_info.value.reason == "token_expired"


def test_verify_garbage_token_is_invalid():
    with pytest.raises(QRTokenError) as exc_info:
        verify("not-a-real-token")
    assert exc_info.value.reason == "token_invalid"

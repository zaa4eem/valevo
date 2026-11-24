from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import aiosqlite

from config import (
    BOOKING_COMMISSION_PERCENT,
    BOOKING_MOTION_RUB_PER_HOUR,
    BOOKING_STATIC_RUB_PER_HOUR,
)
from database.db import get_db


@dataclass(frozen=True)
class BookingQuote:
    place_type: str
    rub_per_hour: float
    places_count: int
    duration_minutes: int
    total_rub: float


class FinanceError(ValueError):
    pass


_DEFAULT_TARIFFS = {
    "static": float(BOOKING_STATIC_RUB_PER_HOUR),
    "motion": float(BOOKING_MOTION_RUB_PER_HOUR),
}
_ALLOWED_METHODS = {"card", "cash", "transfer", "bonus", "other"}
_MAX_OPERATION_RUB = 10_000_000.0


def _money(value: float | int | None) -> float:
    return round(float(value or 0) + 1e-9, 2)


async def _append_audit(
    db: aiosqlite.Connection,
    *,
    actor_id: int,
    action: str,
    entity_type: str,
    entity_id: str | int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    await db.execute(
        """
        INSERT INTO admin_audit_log(actor_id, action, entity_type, entity_id, details_json)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            int(actor_id),
            str(action)[:80],
            str(entity_type)[:80],
            None if entity_id is None else str(entity_id)[:120],
            json.dumps(details or {}, ensure_ascii=False, separators=(",", ":"))[:4000],
        ),
    )

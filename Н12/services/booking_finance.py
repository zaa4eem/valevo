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


async def ensure_booking_finance_schema() -> None:
    """Idempotent booking/finance migration.

    Old bookings are never recalculated using today's tariff. Their quote fields
    stay NULL until an operator explicitly records finance for that booking.
    """
    db = await get_db()
    try:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS booking_tariffs (
                place_type TEXT PRIMARY KEY,
                rub_per_hour REAL NOT NULL CHECK(rub_per_hour >= 0),
                updated_by INTEGER,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS booking_finance_settings (
                key TEXT PRIMARY KEY,
                value REAL NOT NULL,
                updated_by INTEGER,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS booking_finance_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                booking_id INTEGER NOT NULL,
                entry_type TEXT NOT NULL CHECK(entry_type IN ('payment', 'refund')),
                amount_rub REAL NOT NULL CHECK(amount_rub > 0),
                payment_method TEXT NOT NULL DEFAULT 'other',
                commission_percent REAL NOT NULL DEFAULT 0,
                commission_rub REAL NOT NULL DEFAULT 0,
                note TEXT,
                operation_key TEXT NOT NULL UNIQUE,
                created_by INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(booking_id) REFERENCES booking_requests_v2(id) ON DELETE RESTRICT
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                details_json TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_booking_finance_booking ON booking_finance_entries(booking_id, id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_booking_finance_created ON booking_finance_entries(created_at, id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at, id)"
        )

        # The ledger is append-only. Corrections are compensating entries,
        # never UPDATE/DELETE. This gives the admin panel an auditable history.
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_booking_finance_no_update
            BEFORE UPDATE ON booking_finance_entries
            BEGIN
                SELECT RAISE(ABORT, 'booking_finance_entries is append-only');
            END
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS trg_booking_finance_no_delete
            BEFORE DELETE ON booking_finance_entries
            BEGIN
                SELECT RAISE(ABORT, 'booking_finance_entries is append-only');
            END
            """
        )

        for place_type, rate in _DEFAULT_TARIFFS.items():
            await db.execute(
                """
                INSERT OR IGNORE INTO booking_tariffs(place_type, rub_per_hour)
                VALUES (?, ?)
                """,
                (place_type, max(0.0, rate)),
            )
        await db.execute(
            """
            INSERT OR IGNORE INTO booking_finance_settings(key, value)
            VALUES ('commission_percent', ?)
            """,
            (max(0.0, min(100.0, float(BOOKING_COMMISSION_PERCENT))),),
        )

        cursor = await db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='booking_requests_v2'"
        )
        if await cursor.fetchone():
            cursor = await db.execute("PRAGMA table_info(booking_requests_v2)")
            columns = {row[1] for row in await cursor.fetchall()}
            if "tariff_rub_per_hour" not in columns:
                await db.execute(
                    "ALTER TABLE booking_requests_v2 ADD COLUMN tariff_rub_per_hour REAL"
                )
            if "quoted_total_rub" not in columns:
                await db.execute(
                    "ALTER TABLE booking_requests_v2 ADD COLUMN quoted_total_rub REAL"
                )
            if "request_token" not in columns:
                await db.execute(
                    "ALTER TABLE booking_requests_v2 ADD COLUMN request_token TEXT"
                )
            await db.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_request_token
                ON booking_requests_v2(request_token)
                WHERE request_token IS NOT NULL
                """
            )
        await db.commit()
    finally:
        await db.close()


async def log_admin_action(
    *,
    actor_id: int,
    action: str,
    entity_type: str,
    entity_id: str | int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    await ensure_booking_finance_schema()
    db = await get_db()
    try:
        await _append_audit(
            db,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details,
        )
        await db.commit()
    finally:
        await db.close()

from __future__ import annotations

import json
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
_ALLOWED_METHODS = {"card", "cash", "transfer", "other"}
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


async def get_tariffs() -> dict[str, float]:
    await ensure_booking_finance_schema()
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT place_type, rub_per_hour FROM booking_tariffs ORDER BY place_type"
        )
        return {str(row[0]): _money(row[1]) for row in await cur.fetchall()}
    finally:
        await db.close()


async def set_tariff(place_type: str, rub_per_hour: float, admin_id: int) -> float:
    place_type = (place_type or "").strip().lower()
    if place_type not in _DEFAULT_TARIFFS:
        raise FinanceError("Неизвестный тип тарифа")
    rate = _money(rub_per_hour)
    if rate <= 0 or rate > 1_000_000:
        raise FinanceError("Тариф должен быть больше 0 и не превышать 1 000 000 ₽/ч")
    await ensure_booking_finance_schema()
    db = await get_db()
    try:
        await db.execute("BEGIN IMMEDIATE")
        cur = await db.execute(
            "SELECT rub_per_hour FROM booking_tariffs WHERE place_type=?", (place_type,)
        )
        previous = await cur.fetchone()
        await db.execute(
            """
            INSERT INTO booking_tariffs(place_type, rub_per_hour, updated_by, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(place_type) DO UPDATE SET
                rub_per_hour=excluded.rub_per_hour,
                updated_by=excluded.updated_by,
                updated_at=CURRENT_TIMESTAMP
            """,
            (place_type, rate, admin_id),
        )
        await _append_audit(
            db,
            actor_id=admin_id,
            action="tariff_changed",
            entity_type="booking_tariff",
            entity_id=place_type,
            details={"from": _money(previous[0]) if previous else None, "to": rate},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()
    return rate


async def get_commission_percent() -> float:
    await ensure_booking_finance_schema()
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT value FROM booking_finance_settings WHERE key='commission_percent'"
        )
        row = await cur.fetchone()
        return _money(row[0] if row else 0.0)
    finally:
        await db.close()


async def set_commission_percent(percent: float, admin_id: int) -> float:
    value = _money(percent)
    if value < 0 or value > 100:
        raise FinanceError("Комиссия должна быть от 0 до 100%")
    await ensure_booking_finance_schema()
    db = await get_db()
    try:
        await db.execute("BEGIN IMMEDIATE")
        cur = await db.execute(
            "SELECT value FROM booking_finance_settings WHERE key='commission_percent'"
        )
        previous = await cur.fetchone()
        await db.execute(
            """
            INSERT INTO booking_finance_settings(key, value, updated_by, updated_at)
            VALUES ('commission_percent', ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value=excluded.value,
                updated_by=excluded.updated_by,
                updated_at=CURRENT_TIMESTAMP
            """,
            (value, admin_id),
        )
        await _append_audit(
            db,
            actor_id=admin_id,
            action="commission_changed",
            entity_type="finance_setting",
            entity_id="commission_percent",
            details={"from": _money(previous[0]) if previous else None, "to": value},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()
    return value


async def quote_booking(
    place_type: str,
    duration_minutes: int,
    places_count: int,
) -> BookingQuote:
    place_type = (place_type or "").strip().lower()
    if place_type not in _DEFAULT_TARIFFS:
        raise FinanceError("Неизвестный тип места")
    if duration_minutes <= 0 or duration_minutes > 24 * 60:
        raise FinanceError("Некорректная длительность")
    if places_count <= 0 or places_count > 20:
        raise FinanceError("Некорректное количество мест")
    tariffs = await get_tariffs()
    rate = float(tariffs.get(place_type, 0.0))
    if rate <= 0:
        raise FinanceError("Тариф для выбранного типа места не настроен")
    total = _money(rate * (duration_minutes / 60.0) * places_count)
    return BookingQuote(place_type, rate, places_count, duration_minutes, total)


async def get_booking_finance(booking_id: int) -> dict[str, Any]:
    await ensure_booking_finance_schema()
    db = await get_db()
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute(
            """
            SELECT id, status, quoted_total_rub, tariff_rub_per_hour
            FROM booking_requests_v2 WHERE id=?
            """,
            (booking_id,),
        )
        booking = await cur.fetchone()
        if not booking:
            raise FinanceError("Бронь не найдена")
        cur = await db.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount_rub ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN entry_type='refund' THEN amount_rub ELSE 0 END), 0),
                COALESCE(SUM(commission_rub), 0)
            FROM booking_finance_entries WHERE booking_id=?
            """,
            (booking_id,),
        )
        paid, refunded, commission = await cur.fetchone()
        quoted = float(booking["quoted_total_rub"] or 0.0)
        net = _money(float(paid) - float(refunded))
        if net <= 0:
            payment_state = "unpaid"
        elif quoted > 0 and net + 0.01 >= quoted:
            payment_state = "paid"
        else:
            payment_state = "partial"
        return {
            "booking_id": booking_id,
            "booking_status": booking["status"],
            "quoted_total_rub": _money(quoted),
            "tariff_rub_per_hour": _money(float(booking["tariff_rub_per_hour"] or 0.0)),
            "paid_rub": _money(paid),
            "refunded_rub": _money(refunded),
            "net_rub": net,
            "balance_due_rub": _money(max(0.0, quoted - net)),
            "commission_rub": _money(commission),
            "payment_state": payment_state,
        }
    finally:
        await db.close()


async def register_finance_entry(
    *,
    booking_id: int,
    entry_type: str,
    amount_rub: float,
    admin_id: int,
    payment_method: str = "other",
    note: str | None = None,
    operation_key: str | None = None,
) -> dict[str, Any]:
    """Append one idempotent payment/refund row.

    The commission percentage is snapshotted on the row. Refund commission is
    negative, so SUM(commission_rub) follows net registered cash flow.
    """
    entry_type = (entry_type or "").strip().lower()
    if entry_type not in {"payment", "refund"}:
        raise FinanceError("Тип операции должен быть payment или refund")
    amount = _money(amount_rub)
    if amount <= 0 or amount > _MAX_OPERATION_RUB:
        raise FinanceError("Сумма должна быть больше 0 и не превышать 10 000 000 ₽")
    method = (payment_method or "other").strip().lower()
    if method not in _ALLOWED_METHODS:
        raise FinanceError("Неизвестный способ оплаты")
    note = (note or "").strip()[:500] or None
    op_key = (operation_key or uuid4().hex).strip()[:120]
    if not op_key:
        raise FinanceError("operation_key обязателен")

    await ensure_booking_finance_schema()
    commission_percent = await get_commission_percent()

    db = await get_db()
    db.row_factory = aiosqlite.Row
    try:
        await db.execute("BEGIN IMMEDIATE")

        cur = await db.execute(
            "SELECT * FROM booking_finance_entries WHERE operation_key=?",
            (op_key,),
        )
        existing = await cur.fetchone()
        if existing:
            await db.rollback()
            return dict(existing)

        cur = await db.execute(
            "SELECT id, status, quoted_total_rub FROM booking_requests_v2 WHERE id=?",
            (booking_id,),
        )
        booking = await cur.fetchone()
        if not booking:
            await db.rollback()
            raise FinanceError("Бронь не найдена")

        status = str(booking["status"] or "")
        if entry_type == "payment" and status in {
            "rejected", "cancelled", "cancelling", "cancellation_failed", "rollback_failed"
        }:
            await db.rollback()
            raise FinanceError("Нельзя зарегистрировать оплату для отменённой или проблемной брони")

        cur = await db.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount_rub ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN entry_type='refund' THEN amount_rub ELSE 0 END), 0)
            FROM booking_finance_entries WHERE booking_id=?
            """,
            (booking_id,),
        )
        paid, refunded = await cur.fetchone()
        paid = float(paid)
        refunded = float(refunded)

        if entry_type == "refund" and amount > _money(paid - refunded) + 0.001:
            await db.rollback()
            raise FinanceError("Возврат превышает зарегистрированную оплату")

        quoted = float(booking["quoted_total_rub"] or 0.0)
        if entry_type == "payment" and quoted > 0 and paid + amount > quoted + 0.01:
            await db.rollback()
            raise FinanceError("Оплата превышает сохранённую стоимость брони")

        sign = 1.0 if entry_type == "payment" else -1.0
        commission_rub = _money(sign * amount * commission_percent / 100.0)
        cur = await db.execute(
            """
            INSERT INTO booking_finance_entries(
                booking_id, entry_type, amount_rub, payment_method,
                commission_percent, commission_rub, note,
                operation_key, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                booking_id,
                entry_type,
                amount,
                method,
                commission_percent,
                commission_rub,
                note,
                op_key,
                admin_id,
            ),
        )
        entry_id = int(cur.lastrowid)
        await _append_audit(
            db,
            actor_id=admin_id,
            action="payment_registered" if entry_type == "payment" else "refund_registered",
            entity_type="booking",
            entity_id=booking_id,
            details={
                "amount_rub": amount,
                "payment_method": method,
                "commission_percent": commission_percent,
                "commission_rub": commission_rub,
                "operation_key": op_key,
            },
        )
        await db.commit()

        cur = await db.execute(
            "SELECT * FROM booking_finance_entries WHERE id=?", (entry_id,)
        )
        return dict(await cur.fetchone())
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        raise
    finally:
        await db.close()


async def list_finance_entries(limit: int = 100) -> list[dict[str, Any]]:
    await ensure_booking_finance_schema()
    safe_limit = max(1, min(int(limit or 100), 500))
    db = await get_db()
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute(
            """
            SELECT e.*, b.display_name, b.phone, b.start_at, b.quoted_total_rub, b.status AS booking_status
            FROM booking_finance_entries e
            JOIN booking_requests_v2 b ON b.id=e.booking_id
            ORDER BY e.id DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
        return [dict(row) for row in await cur.fetchall()]
    finally:
        await db.close()


async def get_finance_summary() -> dict[str, float]:
    await ensure_booking_finance_schema()
    db = await get_db()
    try:
        cur = await db.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN entry_type='payment' THEN amount_rub ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN entry_type='refund' THEN amount_rub ELSE 0 END), 0),
                COALESCE(SUM(commission_rub), 0)
            FROM booking_finance_entries
            """
        )
        paid, refunded, commission = await cur.fetchone()
        paid = _money(paid)
        refunded = _money(refunded)
        return {
            "payments_rub": paid,
            "refunds_rub": refunded,
            "net_rub": _money(paid - refunded),
            "commission_rub": _money(commission),
        }
    finally:
        await db.close()


async def list_admin_audit(limit: int = 100) -> list[dict[str, Any]]:
    await ensure_booking_finance_schema()
    safe_limit = max(1, min(int(limit or 100), 500))
    db = await get_db()
    db.row_factory = aiosqlite.Row
    try:
        cur = await db.execute(
            """
            SELECT id, actor_id, action, entity_type, entity_id, details_json, created_at
            FROM admin_audit_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (safe_limit,),
        )
        rows = []
        for row in await cur.fetchall():
            item = dict(row)
            try:
                item["details"] = json.loads(item.pop("details_json") or "{}")
            except Exception:
                item["details"] = {}
                item.pop("details_json", None)
            rows.append(item)
        return rows
    finally:
        await db.close()

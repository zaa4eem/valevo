"""Local integration test for the VALEVO booking-finance subsystem.

Run from Н12 after `pip install -r requirements.txt`:
    python scripts/test_booking_finance.py

No Telegram/YCLIENTS network calls are made.
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
import tempfile
from pathlib import Path

import aiosqlite

import database.db as database_db
from services import booking_finance


async def main() -> None:
    fd, db_path = tempfile.mkstemp(prefix="valevo-finance-", suffix=".db")
    os.close(fd)
    try:
        database_db.DB_NAME = db_path

        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                """
                CREATE TABLE booking_requests_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id INTEGER NOT NULL,
                    username TEXT,
                    phone TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    yclients_client_id INTEGER,
                    place_type TEXT NOT NULL,
                    start_at TEXT NOT NULL,
                    end_at TEXT NOT NULL,
                    duration_minutes INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending_admin',
                    admin_id INTEGER,
                    reminder_sent INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            await db.execute(
                """
                INSERT INTO booking_requests_v2(
                    telegram_id, phone, display_name, place_type,
                    start_at, end_at, duration_minutes, status
                ) VALUES (1, '+70000000000', 'Test', 'static',
                          '2026-09-20T18:00:00+03:00',
                          '2026-09-20T19:00:00+03:00', 60, 'confirmed')
                """
            )
            await db.commit()

        await booking_finance.ensure_booking_finance_schema()
        await booking_finance.set_tariff("static", 700, 999)
        await booking_finance.set_commission_percent(10, 999)
        quote = await booking_finance.quote_booking("static", 60, 1)
        assert quote.total_rub == 700.0

        async with aiosqlite.connect(db_path) as db:
            await db.execute(
                "UPDATE booking_requests_v2 SET tariff_rub_per_hour=?, quoted_total_rub=? WHERE id=1",
                (quote.rub_per_hour, quote.total_rub),
            )
            await db.commit()

        first = await booking_finance.register_finance_entry(
            booking_id=1,
            entry_type="payment",
            amount_rub=700,
            admin_id=999,
            payment_method="card",
            operation_key="payment-1",
        )
        duplicate = await booking_finance.register_finance_entry(
            booking_id=1,
            entry_type="payment",
            amount_rub=700,
            admin_id=999,
            payment_method="card",
            operation_key="payment-1",
        )
        assert first["id"] == duplicate["id"], "finance idempotency failed"

        try:
            await booking_finance.register_finance_entry(
                booking_id=1,
                entry_type="payment",
                amount_rub=1,
                admin_id=999,
                operation_key="overpay",
            )
        except booking_finance.FinanceError:
            pass
        else:
            raise AssertionError("overpayment was accepted")

        refund = await booking_finance.register_finance_entry(
            booking_id=1,
            entry_type="refund",
            amount_rub=350,
            admin_id=999,
            payment_method="card",
            operation_key="refund-1",
        )
        assert round(float(refund["commission_rub"]), 2) == -35.0

        state = await booking_finance.get_booking_finance(1)
        assert state["paid_rub"] == 700.0
        assert state["refunded_rub"] == 350.0
        assert state["net_rub"] == 350.0
        assert state["commission_rub"] == 35.0
        assert state["payment_state"] == "partial"

        summary = await booking_finance.get_finance_summary()
        assert summary == {
            "payments_rub": 700.0,
            "refunds_rub": 350.0,
            "net_rub": 350.0,
            "commission_rub": 35.0,
        }

        try:
            await booking_finance.register_finance_entry(
                booking_id=1,
                entry_type="refund",
                amount_rub=351,
                admin_id=999,
                operation_key="refund-too-much",
            )
        except booking_finance.FinanceError:
            pass
        else:
            raise AssertionError("over-refund was accepted")

        # Tariff edits never rewrite an old quote.
        await booking_finance.set_tariff("static", 900, 999)
        newer_quote = await booking_finance.quote_booking("static", 60, 1)
        assert newer_quote.total_rub == 900.0
        old = await booking_finance.get_booking_finance(1)
        assert old["quoted_total_rub"] == 700.0

        # Ledger is append-only at DB level.
        raw = sqlite3.connect(db_path)
        try:
            try:
                raw.execute("UPDATE booking_finance_entries SET amount_rub=1 WHERE id=?", (first["id"],))
                raw.commit()
            except sqlite3.DatabaseError:
                raw.rollback()
            else:
                raise AssertionError("append-only UPDATE trigger failed")
            try:
                raw.execute("DELETE FROM booking_finance_entries WHERE id=?", (first["id"],))
                raw.commit()
            except sqlite3.DatabaseError:
                raw.rollback()
            else:
                raise AssertionError("append-only DELETE trigger failed")
        finally:
            raw.close()

        audit = await booking_finance.list_admin_audit(50)
        actions = {row["action"] for row in audit}
        assert {"tariff_changed", "commission_changed", "payment_registered", "refund_registered"} <= actions

        # Payments are prohibited after cancellation.
        async with aiosqlite.connect(db_path) as db:
            await db.execute("UPDATE booking_requests_v2 SET status='cancelled' WHERE id=1")
            await db.commit()
        try:
            await booking_finance.register_finance_entry(
                booking_id=1,
                entry_type="payment",
                amount_rub=1,
                admin_id=999,
                operation_key="pay-cancelled",
            )
        except booking_finance.FinanceError:
            pass
        else:
            raise AssertionError("payment for cancelled booking was accepted")

        print("OK: finance journal, audit, immutable ledger, idempotency, tariff snapshot and guards")
    finally:
        Path(db_path).unlink(missing_ok=True)


if __name__ == "__main__":
    asyncio.run(main())

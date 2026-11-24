"""Своя бонусная карта. Прежний баланс переносится один раз и больше не копится в двух местах."""
from __future__ import annotations

import logging
from datetime import datetime

from database.db import get_db
from handlers.booking import TZ
from services.phone_normalizer import normalize_phone_for_bot

logger = logging.getLogger(__name__)


async def _schema(db) -> None:
    await db.execute(
        """CREATE TABLE IF NOT EXISTS club_bonus_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT NOT NULL,
            delta_rub REAL NOT NULL,
            booking_id INTEGER,
            note TEXT,
            created_at TEXT NOT NULL
        )"""
    )
    await db.execute(
        """CREATE TABLE IF NOT EXISTS club_bonus_import (
            client_id INTEGER PRIMARY KEY,
            phone TEXT NOT NULL,
            amount_rub REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    await db.execute(
        """CREATE UNIQUE INDEX IF NOT EXISTS idx_bonus_transfer_once
           ON club_bonus_ledger(note)
           WHERE note LIKE 'перенос с прежней карты #%'"""
    )
    try:
        await db.execute("ALTER TABLE club_bonus_import ADD COLUMN updated_at TEXT")
    except Exception:
        pass


async def local_balance(phone: str) -> float:
    db = await get_db()
    try:
        await _schema(db)
        cur = await db.execute("SELECT COALESCE(SUM(delta_rub), 0) FROM club_bonus_ledger WHERE phone=?", (phone,))
        row = await cur.fetchone()
        return round(float(row[0] or 0), 2)
    finally:
        await db.close()


async def apply_delta(phone: str, delta: float, note: str, booking_id: int | None = None) -> tuple[bool, float, str]:
    """Одно сохранение: минус не уводит счёт ниже нуля и не пишется дважды параллельно."""
    phone = normalize_phone_for_bot(phone) or ""
    if not phone:
        return False, 0.0, "no_phone"
    amount = round(float(delta), 2)
    if amount == 0:
        return False, 0.0, "zero"
    db = await get_db()
    try:
        await _schema(db)
        await db.execute("BEGIN IMMEDIATE")
        cur = await db.execute("SELECT COALESCE(SUM(delta_rub), 0) FROM club_bonus_ledger WHERE phone=?", (phone,))
        balance = round(float((await cur.fetchone())[0] or 0), 2)
        if amount < 0 and balance + amount < -0.001:
            await db.rollback()
            return False, balance, "insufficient"
        await db.execute(
            "INSERT INTO club_bonus_ledger (phone, delta_rub, booking_id, note, created_at) VALUES (?,?,?,?,?)",
            (phone, amount, booking_id, (note or "бонусная карта")[:200], datetime.now(TZ).isoformat()),
        )
        await db.commit()
        return True, round(balance + amount, 2), "ok"
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.exception("bonus ledger write failed")
        return False, 0.0, "error"
    finally:
        await db.close()


async def add_local(phone: str, delta: float, note: str) -> float:
    ok, balance, _status = await apply_delta(phone, delta, note)
    return balance if ok or _status == "insufficient" else await local_balance(normalize_phone_for_bot(phone) or phone)


async def _phone_by_client(client_id: int) -> str | None:
    if not client_id:
        return None
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT phone FROM pilots WHERE yclients_client_id=? AND phone IS NOT NULL AND trim(phone)!='' LIMIT 1",
            (int(client_id),),
        )
        row = await cur.fetchone()
    finally:
        await db.close()
    return normalize_phone_for_bot(row[0]) if row else None


async def _set_import(db, client_id: int, phone: str, amount: float, status: str) -> None:
    now = datetime.now(TZ).isoformat()
    await db.execute(
        """INSERT INTO club_bonus_import (client_id, phone, amount_rub, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(client_id) DO UPDATE SET
             phone=excluded.phone, amount_rub=excluded.amount_rub, status=excluded.status, updated_at=excluded.updated_at""",
        (int(client_id), phone, round(float(amount), 2), status, now, now),
    )


async def _credit_in_tx(db, client_id: int, phone: str, amount: float) -> None:
    amount = round(float(amount), 2)
    if amount <= 0:
        await _set_import(db, client_id, phone, 0, "done")
        return
    note = f"перенос с прежней карты #{int(client_id)}"
    await db.execute(
        """INSERT OR IGNORE INTO club_bonus_ledger (phone, delta_rub, booking_id, note, created_at)
           VALUES (?,?,?,?,?)""",
        (phone, amount, None, note, datetime.now(TZ).isoformat()),
    )
    await _set_import(db, client_id, phone, amount, "done")


def _fresh(stamp: str | None) -> bool:
    if not stamp:
        return False
    try:
        return (datetime.now(TZ) - datetime.fromisoformat(stamp)).total_seconds() < 90
    except ValueError:
        return False


async def ensure_imported(client_id: int, phone: str) -> None:
    phone = normalize_phone_for_bot(phone) or ""
    client_id = int(client_id or 0)
    if not phone or not client_id:
        return
    from services.yclients_service import remote_bonus_state, remote_change_bonus, yclients_enabled

    db = await get_db()
    row = None
    try:
        await _schema(db)
        await db.execute("BEGIN IMMEDIATE")
        cur = await db.execute(
            "SELECT status, amount_rub, phone, updated_at FROM club_bonus_import WHERE client_id=?",
            (client_id,),
        )
        row = await cur.fetchone()
        if row and row[0] in {"done", "zero"}:
            await db.commit()
            return
        if row and row[0] == "debited":
            await _credit_in_tx(db, client_id, row[2] or phone, float(row[1] or 0))
            await db.commit()
            return
        if not yclients_enabled():
            await db.commit()
            return
        if row and row[0] == "moving" and _fresh(row[3]):
            await db.commit()
            return
        await _set_import(db, client_id, phone, float(row[1] or 0) if row else 0, "moving")
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.exception("bonus import lock failed for client %s", client_id)
        return
    finally:
        await db.close()

    if not yclients_enabled():
        return
    known, remote = await remote_bonus_state(client_id)
    if not known:
        return
    remote = round(float(remote), 2)
    stored = round(float(row[1] or 0), 2) if row and row[0] == "moving" else 0.0
    target = stored if stored > 0 else remote
    if remote > 0.01:
        moved = await remote_change_bonus(client_id, -remote, title="Перенос на карту клуба", phone=phone)
        if not moved.get("ok"):
            return
        known_after, left = await remote_bonus_state(client_id)
        if not known_after or left > 0.01:
            hold = await get_db()
            try:
                await _schema(hold)
                await _set_import(hold, client_id, phone, target or remote, "moving")
                await hold.commit()
            finally:
                await hold.close()
            return
        if target <= 0:
            target = remote
    if target <= 0:
        done = await get_db()
        try:
            await _schema(done)
            await _set_import(done, client_id, phone, 0, "zero")
            await done.commit()
        finally:
            await done.close()
        return
    credit = await get_db()
    try:
        await _schema(credit)
        await credit.execute("BEGIN IMMEDIATE")
        await _set_import(credit, client_id, phone, target, "debited")
        await _credit_in_tx(credit, client_id, phone, target)
        await credit.commit()
    except Exception:
        try:
            await credit.rollback()
        except Exception:
            pass
        logger.exception("bonus import credit failed for client %s", client_id)
    finally:
        await credit.close()


async def balance_for_phone(phone: str | None, client_id: int | None = None) -> float:
    normalized = normalize_phone_for_bot(phone or "")
    if not normalized:
        return 0.0
    await ensure_imported(int(client_id or 0), normalized)
    return await local_balance(normalized)


async def balance_for_pilot(pilot: dict | None) -> float:
    if not pilot:
        return 0.0
    return await balance_for_phone(pilot.get("phone"), pilot.get("yclients_client_id"))


async def balance_by_client(client_id: int) -> float:
    phone = await _phone_by_client(client_id)
    if not phone:
        return 0.0
    return await balance_for_phone(phone, client_id)


async def change_by_client(client_id: int, delta_rub: float, title: str, phone: str | None, name: str | None = None) -> dict:
    del name
    normalized = normalize_phone_for_bot(phone or "") or await _phone_by_client(int(client_id or 0))
    if not normalized:
        return {"ok": False, "status": "no_phone", "message": "Нет телефона для бонусной карты"}
    await ensure_imported(int(client_id or 0), normalized)
    ok, balance, status = await apply_delta(normalized, delta_rub, title or "бонусная карта")
    if not ok:
        message = "Не хватает бонусов" if status == "insufficient" else "Не удалось провести бонус"
        return {"ok": False, "status": status, "message": message, "balance": balance}
    return {
        "ok": True,
        "status": "issued" if float(delta_rub) > 0 else "withdrawn",
        "client_id": client_id,
        "amount": round(float(delta_rub), 2),
        "balance": balance,
    }


async def import_all_pilots() -> None:
    db = await get_db()
    try:
        cur = await db.execute(
            "SELECT phone, yclients_client_id FROM pilots WHERE phone IS NOT NULL AND trim(phone) != ''"
        )
        rows = await cur.fetchall()
    except Exception:
        logger.exception("bonus import skipped, pilots table is not ready")
        return
    finally:
        await db.close()
    for phone, client_id in rows:
        try:
            await ensure_imported(int(client_id or 0), phone)
        except Exception:
            logger.exception("bonus import failed for %s", phone)

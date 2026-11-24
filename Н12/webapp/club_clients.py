"""Карточки клиентов клуба и сетка дня."""
from __future__ import annotations

import re
from datetime import datetime

from fastapi import HTTPException

from database.db import get_db
from handlers import booking as b
from services.miniapp_booking import ensure_kids_schema
from services.phone_normalizer import normalize_phone_for_bot


async def ensure_clients(db) -> None:
    await db.execute(
        """CREATE TABLE IF NOT EXISTS club_clients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL UNIQUE,
            note TEXT NOT NULL DEFAULT '',
            telegram_id INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
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


async def backfill_clients(db) -> None:
    await ensure_clients(db)
    now = datetime.now(b.TZ).isoformat()
    cur = await db.execute(
        """SELECT phone, MAX(display_name), MAX(telegram_id), MIN(created_at)
           FROM booking_requests_v2
           WHERE phone IS NOT NULL AND phone != ''
           GROUP BY phone"""
    )
    for phone, name, telegram_id, created in await cur.fetchall():
        await db.execute(
            """INSERT INTO club_clients (name, phone, note, telegram_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(phone) DO NOTHING""",
            ((name or "Гость").strip()[:40] or "Гость", phone, "", int(telegram_id or 0), created or now, now),
        )
    cur = await db.execute(
        "SELECT phone, display_name, username, telegram_id, created_at FROM pilots WHERE phone IS NOT NULL AND trim(phone) != ''"
    )
    for phone, display_name, username, telegram_id, created in await cur.fetchall():
        normalized = normalize_phone_for_bot(phone)
        if not normalized:
            continue
        label = (display_name or username or "Пилот").strip()[:40] or "Пилот"
        await db.execute(
            """INSERT INTO club_clients (name, phone, note, telegram_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(phone) DO UPDATE SET
                 telegram_id = CASE WHEN club_clients.telegram_id <= 0 THEN excluded.telegram_id ELSE club_clients.telegram_id END""",
            (label, normalized, "", int(telegram_id or 0), created or now, now),
        )
    await db.commit()


async def touch_client(name: str, phone: str, telegram_id: int, *, rename: bool) -> None:
    db = await get_db()
    try:
        await ensure_clients(db)
        now = datetime.now(b.TZ).isoformat()
        cur = await db.execute("SELECT id, name FROM club_clients WHERE phone=?", (phone,))
        row = await cur.fetchone()
        if row:
            await db.execute(
                """UPDATE club_clients
                   SET name=?, telegram_id=CASE WHEN telegram_id<=0 AND ?>0 THEN ? ELSE telegram_id END, updated_at=?
                   WHERE id=?""",
                (name if rename else row[1], int(telegram_id or 0), int(telegram_id or 0), now, row[0]),
            )
        else:
            await db.execute(
                """INSERT INTO club_clients (name, phone, note, telegram_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?)""",
                (name, phone, "", int(telegram_id or 0), now, now),
            )
        await db.commit()
    finally:
        await db.close()


def client_payload(row) -> dict:
    return {
        "id": row[0],
        "name": row[1],
        "phone": row[2],
        "note": row[3] or "",
        "telegram_id": row[4],
        "visits": row[5] or 0,
        "last_at": row[6],
        "bonus_rub": round(float(row[7] or 0), 2),
    }


async def client_rows(q: str, limit: int) -> list[dict]:
    db = await get_db()
    try:
        await backfill_clients(db)
        sql = """
            SELECT c.id, c.name, c.phone, c.note, c.telegram_id,
              (SELECT COUNT(*) FROM booking_requests_v2 b
                 WHERE b.phone=c.phone AND b.status NOT IN ('cancelled','rejected')),
              (SELECT MAX(b.start_at) FROM booking_requests_v2 b WHERE b.phone=c.phone),
              (SELECT COALESCE(SUM(l.delta_rub), 0) FROM club_bonus_ledger l WHERE l.phone=c.phone)
            FROM club_clients c
        """
        params: list = []
        text = (q or "").strip()
        if text:
            digits = re.sub(r"\D", "", text)
            sql += " WHERE c.name LIKE ? OR c.phone LIKE ? OR c.note LIKE ?"
            params.extend([f"%{text}%", f"%{digits or text}%", f"%{text}%"])
        sql += " ORDER BY c.updated_at DESC LIMIT ?"
        params.append(limit)
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
    finally:
        await db.close()
    return [client_payload(row) for row in rows]


async def client_detail(client_id: int) -> dict | None:
    found = next((row for row in await client_rows("", 500) if row["id"] == client_id), None)
    if not found:
        db = await get_db()
        try:
            await ensure_clients(db)
            cur = await db.execute("SELECT phone FROM club_clients WHERE id=?", (client_id,))
            phone_row = await cur.fetchone()
        finally:
            await db.close()
        if not phone_row:
            return None
        found = next((row for row in await client_rows(phone_row[0], 5) if row["id"] == client_id), None)
    if not found:
        return None
    db = await get_db()
    try:
        cur = await db.execute(
            """SELECT r.id, r.start_at, r.duration_minutes, r.status,
                      COALESCE(GROUP_CONCAT(i.place_title, ', '), '')
               FROM booking_requests_v2 r
               LEFT JOIN booking_items_v2 i ON i.booking_id=r.id
               WHERE r.phone=?
               GROUP BY r.id
               ORDER BY r.start_at DESC LIMIT 12""",
            (found["phone"],),
        )
        visits = await cur.fetchall()
    finally:
        await db.close()
    found["history"] = [
        {"id": row[0], "start_at": row[1], "duration_minutes": row[2], "status": row[3], "places": row[4]}
        for row in visits
    ]
    return found


async def day_board(date: str, *, named: bool) -> dict:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or ""):
        raise HTTPException(422, "Укажите дату")
    db = await get_db()
    try:
        marks = ",".join("?" * len(b.BLOCKING_STATUSES))
        cur = await db.execute(
            f"""SELECT i.place_key, r.start_at, r.duration_minutes, r.display_name, r.id, r.status, r.phone
                FROM booking_items_v2 i
                JOIN booking_requests_v2 r ON r.id = i.booking_id
                WHERE substr(r.start_at, 1, 10)=? AND r.status IN ({marks})""",
            (date, *b.BLOCKING_STATUSES),
        )
        rows = await cur.fetchall()
        kids_rows = []
        if named:
            await ensure_kids_schema(db)
            cur = await db.execute(
                """SELECT id, display_name, phone, start_at, duration_minutes
                   FROM kids_sim_requests
                   WHERE substr(start_at, 1, 10)=? AND COALESCE(status, 'active')='active'""",
                (date,),
            )
            kids_rows = await cur.fetchall()
    finally:
        await db.close()
    blocks = []
    for place_key, start_at, minutes, name, booking_id, status, phone in rows:
        item = {"place_key": place_key, "start": start_at[11:16], "minutes": int(minutes)}
        if named:
            item.update({"id": booking_id, "name": name, "status": status, "phone": phone})
        blocks.append(item)
    kids = []
    for kid_id, name, phone, start_at, minutes in kids_rows:
        item = {"id": kid_id, "start": start_at[11:16], "minutes": int(minutes)}
        if named:
            item.update({"name": name, "phone": phone})
        kids.append(item)
    return {"date": date, "blocks": blocks, "kids": kids}


async def create_client(name: str, phone: str, note: str) -> dict:
    db = await get_db()
    try:
        await backfill_clients(db)
        cur = await db.execute("SELECT id FROM club_clients WHERE phone=?", (phone,))
        if await cur.fetchone():
            raise HTTPException(409, "Такой телефон уже есть")
        now = datetime.now(b.TZ).isoformat()
        cur = await db.execute(
            """INSERT INTO club_clients (name, phone, note, telegram_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?)""",
            (name, phone, note, 0, now, now),
        )
        await db.commit()
        client_id = cur.lastrowid
    finally:
        await db.close()
    return await client_detail(client_id)


async def update_client(client_id: int, name: str, phone: str, note: str) -> dict:
    db = await get_db()
    try:
        await backfill_clients(db)
        cur = await db.execute("SELECT name, phone FROM club_clients WHERE id=?", (client_id,))
        current = await cur.fetchone()
        if not current:
            raise HTTPException(404, "Клиент не найден")
        cur = await db.execute("SELECT id FROM club_clients WHERE phone=? AND id!=?", (phone, client_id))
        if await cur.fetchone():
            raise HTTPException(409, "Такой телефон уже есть")
        old_name, old = current
        now = datetime.now(b.TZ).isoformat()
        await db.execute("BEGIN IMMEDIATE")
        if old != phone:
            cur = await db.execute("SELECT telegram_id FROM pilots WHERE phone=?", (phone,))
            taken = await cur.fetchone()
            if taken:
                await db.rollback()
                raise HTTPException(409, "Этот телефон уже у другого пилота")
            await db.execute("UPDATE booking_requests_v2 SET phone=? WHERE phone=?", (phone, old))
            await db.execute("UPDATE club_bonus_ledger SET phone=? WHERE phone=?", (phone, old))
            await db.execute("UPDATE pilots SET phone=? WHERE phone=?", (phone, old))
            await ensure_kids_schema(db)
            await db.execute("UPDATE kids_sim_requests SET phone=? WHERE phone=?", (phone, old))
        await db.execute(
            "UPDATE club_clients SET name=?, phone=?, note=?, updated_at=? WHERE id=?",
            (name, phone, note, now, client_id),
        )
        await db.execute(
            "UPDATE booking_requests_v2 SET display_name=? WHERE phone=? AND display_name=?",
            (name, phone, old_name),
        )
        await db.commit()
    finally:
        await db.close()
    return await client_detail(client_id)


async def delete_client(client_id: int) -> None:
    db = await get_db()
    try:
        await ensure_clients(db)
        cur = await db.execute("DELETE FROM club_clients WHERE id=?", (client_id,))
        await db.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "Клиент не найден")
    finally:
        await db.close()

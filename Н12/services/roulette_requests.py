"""Durable duplicate suppression shared by the bot and Mini App.

Unknown external outcomes deliberately require reconciliation, never a timed
unlock: retrying a debit after a crash can charge the customer twice.
"""
import json
from database.db import get_db


class RequestPending(Exception):
    pass


class RequestRejected(Exception):
    """Only safe BEFORE any external debit has been attempted."""


async def _finish(user_id, key, status, result):
    db = await get_db()
    try:
        await db.execute('UPDATE roulette_requests SET status=?,result=COALESCE(?,result) WHERE user_id=? AND request_key=?',
                         (status, json.dumps(result, ensure_ascii=False) if result is not None else None, user_id, key))
        await db.commit()
    finally:
        await db.close()


async def run_spin(user_id, key, operation):
    db = await get_db()
    try:
        await db.execute('''CREATE TABLE IF NOT EXISTS roulette_requests (
            user_id INTEGER NOT NULL, request_key TEXT NOT NULL,
            status TEXT NOT NULL, result TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(user_id,request_key))''')
        await db.execute('''CREATE UNIQUE INDEX IF NOT EXISTS roulette_one_active
            ON roulette_requests(user_id) WHERE status IN ('running','review')''')
        await db.commit()
        await db.execute('BEGIN IMMEDIATE')
        cursor = await db.execute('SELECT status,result FROM roulette_requests WHERE user_id=? AND request_key=?', (user_id,key))
        old = await cursor.fetchone()
        if old and old[0] == 'done':
            return json.loads(old[1])
        if old and old[0] == 'rejected':
            raise RequestRejected(json.loads(old[1])['error'])
        cursor = await db.execute("SELECT request_key FROM roulette_requests WHERE user_id=? AND status IN ('running','review')", (user_id,))
        if old or await cursor.fetchone():
            raise RequestPending('Предыдущий спин ещё обрабатывается или требует проверки администратором. Повторное списание заблокировано.')
        await db.execute("INSERT INTO roulette_requests(user_id,request_key,status) VALUES(?,?,'running')", (user_id,key))
        await db.commit()
    finally:
        await db.close()
    try:
        result = await operation()
    except RequestRejected as exc:
        await _finish(user_id,key,'rejected',{'error':str(exc)})
        raise
    except Exception:
        await _finish(user_id,key,'review',None)
        raise
    await _finish(user_id,key,'done',result)
    return result


async def record_selection(user_id, key, result):
    """Preserve the selected prize before attempting the external debit."""
    await _finish(user_id, key, 'running', result)

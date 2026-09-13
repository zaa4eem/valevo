"""Atomic lap insertion and request deduplication for Mini App retries."""
import hashlib
import json

from database.db import get_db


class LapConflict(ValueError):
    pass


async def save_lap(actor_id, key, payload):
    fingerprint = hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    db = await get_db()
    try:
        await db.execute('''CREATE TABLE IF NOT EXISTS miniapp_lap_requests (
            actor_id INTEGER NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
            lap_id INTEGER NOT NULL, response TEXT, PRIMARY KEY(actor_id,request_key))''')
        await db.commit()
        await db.execute('BEGIN IMMEDIATE')
        cursor = await db.execute('SELECT fingerprint,lap_id,response FROM miniapp_lap_requests WHERE actor_id=? AND request_key=?',(actor_id,key))
        old = await cursor.fetchone()
        await cursor.close()
        if old:
            if old[0] != fingerprint:
                raise LapConflict('Ключ запроса уже использован с другими данными')
            await db.commit()
            return old[1], False, json.loads(old[2]) if old[2] else None
        await db.execute('INSERT OR IGNORE INTO disciplines(name) VALUES(?)',(payload['discipline'],))
        cursor = await db.execute('SELECT id FROM disciplines WHERE name=?',(payload['discipline'],))
        discipline_id = (await cursor.fetchone())[0]
        await cursor.close()
        cursor = await db.execute('''INSERT INTO laps
            (discipline_id,username,telegram_id,track,lap_time_text,lap_time_ms) VALUES(?,?,?,?,?,?)''',
            (discipline_id,payload['username'],payload['telegram_id'],payload['track'],payload['lap_time_text'],payload['lap_time_ms']))
        lap_id = cursor.lastrowid
        await cursor.close()
        await db.execute('INSERT INTO miniapp_lap_requests(actor_id,request_key,fingerprint,lap_id) VALUES(?,?,?,?)',
                         (actor_id,key,fingerprint,lap_id))
        await db.commit()
        return lap_id, True, None
    finally:
        await db.close()


async def finish_lap(actor_id, key, response):
    db = await get_db()
    try:
        await db.execute('UPDATE miniapp_lap_requests SET response=? WHERE actor_id=? AND request_key=?',
                         (json.dumps(response,ensure_ascii=False),actor_id,key))
        await db.commit()
    finally:
        await db.close()

"""Durable, at-least-once Telegram booking delivery with expiring worker leases.

A crash after Telegram accepts a message but before the delivery commit can
repeat that message: Telegram's send API has no idempotency key.
"""
import asyncio
import logging
import time
import uuid

from aiogram.exceptions import TelegramForbiddenError, TelegramRetryAfter

from database.db import get_db

logger = logging.getLogger(__name__)
LEASE_SECONDS = 120
BATCH_SIZE = 20


async def ensure_schema(db):
    # Do not use executescript: it commits a caller's open transaction.
    await db.execute('''CREATE TABLE IF NOT EXISTS booking_notification_outbox (
        id INTEGER PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        event TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at REAL NOT NULL DEFAULT 0,
        lease_until REAL NOT NULL DEFAULT 0,
        lease_token TEXT,
        last_error TEXT,
        created_at REAL NOT NULL,
        delivered_at REAL,
        UNIQUE(booking_id, recipient_id, event)
    )''')


async def enqueue(db, booking_id, recipient_id, event):
    """Queue in caller's transaction; caller remains responsible for commit."""
    await ensure_schema(db)
    await db.execute('''INSERT OR IGNORE INTO booking_notification_outbox
        (booking_id,recipient_id,event,created_at) VALUES (?,?,?,?)''',
        (booking_id, recipient_id, event, time.time()))


async def _claim():
    db = await get_db()
    try:
        await ensure_schema(db)
        await db.commit()
        await db.execute('BEGIN IMMEDIATE')
        now = time.time()
        cursor = await db.execute('''SELECT id,booking_id,recipient_id,event,attempts
            FROM booking_notification_outbox
            WHERE (status='pending' AND next_attempt_at<=?)
               OR (status='sending' AND lease_until<=?)
            ORDER BY id LIMIT 1''', (now, now))
        row = await cursor.fetchone()
        await cursor.close()
        if row is None:
            await db.commit()
            return None
        token = uuid.uuid4().hex
        await db.execute('''UPDATE booking_notification_outbox
            SET status='sending',lease_until=?,lease_token=?,attempts=attempts+1
            WHERE id=?''', (now + LEASE_SECONDS, token, row[0]))
        await db.commit()
        return dict(zip(('id','booking_id','recipient_id','event','attempts'), row), token=token)
    finally:
        await db.close()


async def _finish(item, status, error=None, delay=0):
    db = await get_db()
    try:
        await db.execute('''UPDATE booking_notification_outbox
            SET status=?,last_error=?,next_attempt_at=?,lease_until=0,lease_token=NULL,delivered_at=?
            WHERE id=? AND lease_token=? AND status='sending' ''',
            (status, error, time.time() + delay, time.time() if status == 'delivered' else None,
             item['id'], item['token']))
        await db.commit()
    finally:
        await db.close()


async def _payload(item):
    from handlers.booking import _fetch_booking, _format_booking, _admin_keyboard, _user_cancel_keyboard

    booking = await _fetch_booking(item['booking_id'])
    if booking is None:
        return None
    event = item['event']
    labels = {
        'pending_admin': '🆕 Новая заявка из Mini App. Требуется решение администратора.',
        'confirmed': '✅ Бронирование подтверждено.',
        'user_confirmed': '✅ Вы подтвердили посещение.',
        'rejected': '❌ Заявка на бронирование отклонена.',
        'cancelled': 'Бронирование отменено.',
        'cancelled_by_user': 'Бронирование отменено пользователем.',
        'cancellation_failed': '⚠️ Не удалось отменить бронирование. Обратитесь к администратору.',
        'reconciliation_required': '⚠️ Бронирование требует сверки с YCLIENTS. Обратитесь к администратору.',
    }
    keyboard = None
    # Old queued events must not offer actions invalid for the current status.
    if event == 'pending_admin' and booking['status'] == 'pending_admin':
        keyboard = _admin_keyboard(booking['id'])
    elif event in ('confirmed', 'user_confirmed') and booking['status'] in ('confirmed', 'user_confirmed'):
        keyboard = _user_cancel_keyboard(booking['id'])
    return labels.get(event, 'Статус бронирования обновлён.') + '\n\n' + _format_booking(booking), keyboard


async def process_notifications(bot):
    """Deliver up to twenty due events; failed sends stay queued with backoff."""
    for _ in range(BATCH_SIZE):
        item = await _claim()
        if item is None:
            break
        try:
            payload = await _payload(item)
            if payload is None:
                logger.error('Booking notification %s references missing booking', item['id'])
                await _finish(item, 'failed', 'Booking not found')
                continue
            text, keyboard = payload
            await asyncio.wait_for(bot.send_message(chat_id=item['recipient_id'], text=text,
                                                     reply_markup=keyboard, parse_mode='HTML'), timeout=30)
        except TelegramForbiddenError as exc:
            logger.warning('Booking notification %s permanently forbidden', item['id'])
            await _finish(item, 'failed', str(exc)[:500])
        except Exception as exc:
            delay = min(3600, 30 * 2 ** min(item['attempts'], 7))
            if isinstance(exc, TelegramRetryAfter):
                delay = max(delay, exc.retry_after)
            logger.warning('Booking notification %s postponed: %s', item['id'], type(exc).__name__)
            await _finish(item, 'pending', str(exc)[:500], delay)
        else:
            await _finish(item, 'delivered')

import asyncio
from unittest.mock import AsyncMock

import aiosqlite
from aiogram.exceptions import TelegramForbiddenError
from aiogram.methods import SendMessage


def test_outbox_delivery_retry_dedupe_and_concurrency(tmp_path, monkeypatch):
    from services import booking_notifications as outbox
    from handlers import booking

    async def run():
        async def connect():
            return await aiosqlite.connect(str(tmp_path / 'outbox.sqlite'))
        monkeypatch.setattr(outbox, 'get_db', connect)
        monkeypatch.setattr(booking, '_fetch_booking', AsyncMock(return_value={'id':1,'status':'pending_admin'}))
        monkeypatch.setattr(booking, '_format_booking', lambda row: '<b>Бронь</b>')
        db = await connect()
        await outbox.ensure_schema(db)
        await outbox.enqueue(db, 1, 7, 'pending_admin')
        await outbox.enqueue(db, 1, 7, 'pending_admin')
        await db.commit()
        assert (await (await db.execute('SELECT COUNT(*) FROM booking_notification_outbox')).fetchone())[0] == 1
        bot = AsyncMock()
        bot.send_message.side_effect = RuntimeError('offline')
        await outbox.process_notifications(bot)
        row = await (await db.execute('SELECT status,attempts FROM booking_notification_outbox')).fetchone()
        assert row == ('pending', 1)
        bot.send_message.side_effect = None
        await db.execute('UPDATE booking_notification_outbox SET next_attempt_at=0')
        await db.commit()
        bot.send_message.reset_mock()
        await asyncio.gather(outbox.process_notifications(bot), outbox.process_notifications(bot))
        bot.send_message.assert_awaited_once()
        assert bot.send_message.await_args.kwargs['parse_mode'] == 'HTML'
        assert (await (await db.execute('SELECT status FROM booking_notification_outbox')).fetchone())[0] == 'delivered'
        await db.close()
    asyncio.run(run())


def test_cancellation_failure_text(monkeypatch):
    from services import booking_notifications as outbox
    from handlers import booking
    monkeypatch.setattr(booking, '_fetch_booking', AsyncMock(return_value={'id':3,'status':'cancellation_failed'}))
    monkeypatch.setattr(booking, '_format_booking', lambda row: 'Бронь')
    text, keyboard = asyncio.run(outbox._payload({'booking_id':3,'event':'cancellation_failed'}))
    assert 'Не удалось отменить' in text
    assert keyboard is None


def test_outbox_rollback_lease_recovery_and_forbidden(tmp_path, monkeypatch):
    from services import booking_notifications as outbox
    from handlers import booking

    async def run():
        async def connect():
            return await aiosqlite.connect(str(tmp_path / 'outbox.sqlite'))
        monkeypatch.setattr(outbox, 'get_db', connect)
        monkeypatch.setattr(booking, '_fetch_booking', AsyncMock(return_value={'id':2,'status':'reconciliation_required'}))
        monkeypatch.setattr(booking, '_format_booking', lambda row: 'Бронь')
        db = await connect()
        await outbox.ensure_schema(db)
        await db.commit()
        await outbox.enqueue(db, 1, 7, 'confirmed')
        await db.rollback()
        assert (await (await db.execute('SELECT COUNT(*) FROM booking_notification_outbox')).fetchone())[0] == 0
        await outbox.enqueue(db, 2, 7, 'reconciliation_required')
        await db.execute("UPDATE booking_notification_outbox SET status='sending', lease_until=0")
        await db.commit()
        bot = AsyncMock()
        bot.send_message.side_effect = TelegramForbiddenError(method=SendMessage(chat_id=7,text='x'),message='blocked')
        await outbox.process_notifications(bot)
        assert (await (await db.execute('SELECT status FROM booking_notification_outbox')).fetchone())[0] == 'failed'
        await outbox.process_notifications(bot)
        bot.send_message.assert_awaited_once()
        await db.close()
    asyncio.run(run())

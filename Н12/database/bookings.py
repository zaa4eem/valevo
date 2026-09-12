import aiosqlite

from config import DB_NAME


async def init_bookings_db():

    async with aiosqlite.connect(DB_NAME) as db:

        await db.execute(
            '''
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                pilot_telegram_id INTEGER,

                phone TEXT,

                yclients_record_id TEXT UNIQUE,

                service_name TEXT,
                staff_name TEXT,

                booking_time TEXT,

                duration_minutes INTEGER,

                notified INTEGER DEFAULT 0,
                completed INTEGER DEFAULT 0,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )

        await db.commit()


async def create_booking(
    pilot_telegram_id,
    phone,
    yclients_record_id,
    service_name,
    staff_name,
    booking_time,
    duration_minutes
):

    async with aiosqlite.connect(DB_NAME) as db:

        await db.execute(
            '''
            INSERT OR IGNORE INTO bookings(
                pilot_telegram_id,
                phone,
                yclients_record_id,
                service_name,
                staff_name,
                booking_time,
                duration_minutes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                pilot_telegram_id,
                phone,
                yclients_record_id,
                service_name,
                staff_name,
                booking_time,
                duration_minutes
            )
        )

        await db.commit()

from datetime import datetime
from zoneinfo import ZoneInfo

import aiosqlite

from config import DB_NAME, MOSCOW_TZ

TZ = ZoneInfo(MOSCOW_TZ)

# Активные брони, которые ещё имеет смысл показывать администратору.
_ACTIVE_STATUSES = ("pending_admin", "creating", "confirmed", "user_confirmed")


async def get_future_bookings():
    """Возвращает будущие брони из реальной таблицы бронирований (booking_requests_v2).

    Поля переименованы под старый формат (booking_time/service_name/staff_name/
    pilot_telegram_id), который уже понимает handlers/bookings_admin.py.
    """
    now_iso = datetime.now(TZ).isoformat()
    status_placeholders = ",".join("?" for _ in _ACTIVE_STATUSES)

    async with aiosqlite.connect(DB_NAME) as db:

        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            f'''
            SELECT
                br.id AS id,
                br.telegram_id AS pilot_telegram_id,
                br.phone AS phone,
                br.start_at AS booking_time,
                br.duration_minutes AS duration_minutes,
                CASE WHEN br.place_type = 'static' THEN 'Статика' ELSE 'Подвижка' END AS service_name,
                GROUP_CONCAT(bi.place_title, ', ') AS staff_name
            FROM booking_requests_v2 br
            JOIN booking_items_v2 bi ON bi.booking_id = br.id
            WHERE br.start_at > ?
              AND br.status IN ({status_placeholders})
            GROUP BY br.id
            ORDER BY br.start_at ASC
            ''',
            (now_iso, *_ACTIVE_STATUSES),
        )

        rows = await cursor.fetchall()

        return [
            dict(row)
            for row in rows
        ]
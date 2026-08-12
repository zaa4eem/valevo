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

import aiosqlite

from config import DB_NAME


async def get_future_bookings():

    async with aiosqlite.connect(DB_NAME) as db:

        db.row_factory = aiosqlite.Row

        cursor = await db.execute(
            '''
            SELECT *
            FROM bookings
            WHERE booking_time > ?
            ORDER BY booking_time ASC
            ''',
            (
                datetime.now().isoformat(),
            )
        )

        rows = await cursor.fetchall()

        return [
            dict(row)
            for row in rows
        ]
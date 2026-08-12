import asyncio

from datetime import (
    datetime,
    timedelta
)

import aiosqlite

from config import DB_NAME


async def booking_notifications_loop(bot):

    while True:

        try:

            now = datetime.now()

            async with aiosqlite.connect(DB_NAME) as db:

                cursor = await db.execute(
                    '''
                    SELECT *
                    FROM bookings
                    WHERE notified = 0
                    '''
                )

                rows = await cursor.fetchall()

                for row in rows:

                    booking_time = datetime.fromisoformat(
                        row[6]
                    )

                    delta = booking_time - now

                    if timedelta(minutes=55) <= delta <= timedelta(minutes=65):

                        try:

                            await bot.send_message(
                                row[1],
                                (
                                    "🏁 Напоминание о заезде!\n\n"

                                    f"📅 {booking_time.strftime('%d.%m.%Y')}\n"
                                    f"🕒 {booking_time.strftime('%H:%M')}\n\n"

                                    f"🏎 {row[4]}\n"
                                    f"👨‍🔧 {row[5]}\n\n"

                                    "Ждём вас в VALEVO!"
                                )
                            )

                            await db.execute(
                                '''
                                UPDATE bookings
                                SET notified = 1
                                WHERE id = ?
                                ''',
                                (row[0],)
                            )

                            await db.commit()

                        except:
                            pass

        except:
            pass

        await asyncio.sleep(300)
import asyncio
import logging
from datetime import datetime

import aiosqlite

from database.experience import add_experience
from database.db import update_pilot_rating
from config import DB_NAME

logger = logging.getLogger(__name__)

RATING_PER_PLAYED_HOUR = 5


def _played_hour_rating(minutes: int | None) -> tuple[int, int]:
    """Возвращает (полных_часов, рейтинг) за завершённую сессию.

    Начисление идёт только за полные отыгранные часы: 60 мин = +5,
    90 мин = +5, 120 мин = +10. Это защищает от дробных начислений.
    """
    if not minutes or minutes <= 0:
        return 0, 0
    full_hours = int(minutes) // 60
    return full_hours, full_hours * RATING_PER_PLAYED_HOUR


async def process_completed_bookings(bot):
    while True:
        try:
            now = datetime.now()

            async with aiosqlite.connect(DB_NAME) as db:
                cursor = await db.execute(
                    '''
                    SELECT *
                    FROM bookings
                    WHERE completed = 0
                    '''
                )
                rows = await cursor.fetchall()

                for row in rows:
                    booking_time = datetime.fromisoformat(row[6])

                    if now > booking_time:
                        telegram_id = row[1]
                        duration_minutes = row[7] or 0

                        await add_experience(telegram_id, duration_minutes)

                        full_hours, rating_delta = _played_hour_rating(duration_minutes)
                        if rating_delta > 0:
                            await update_pilot_rating(telegram_id, rating_delta)
                            logger.info(
                                "Пилот %s получил +%s рейтинга за %s полных отыгранных часов",
                                telegram_id, rating_delta, full_hours
                            )

                        await db.execute(
                            '''
                            UPDATE bookings
                            SET completed = 1
                            WHERE id = ?
                            ''',
                            (row[0],)
                        )
                        await db.commit()

                        try:
                            rating_text = (
                                f"\n📈 Рейтинг: +{rating_delta} за {full_hours} ч"
                                if rating_delta > 0 else ""
                            )
                            await bot.send_message(
                                telegram_id,
                                (
                                    "🔥 Сессия завершена!\n\n"
                                    f"➕ Опыт: +{duration_minutes} мин\n"
                                    f"🏎 Сессия: {row[4]}"
                                    f"{rating_text}"
                                )
                            )
                        except Exception as e:
                            logger.warning("Не удалось отправить уведомление о завершении сессии %s: %s", row[0], e)

        except Exception:
            logger.exception("Ошибка обработки завершённых бронирований")

        await asyncio.sleep(300)

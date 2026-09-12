import asyncio
import logging
from datetime import datetime

from handlers.booking import (
    TZ,
    claim_booking_experience,
    ensure_booking_schema,
    get_bookings_pending_experience,
)

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
    """Раз в 5 минут находит подтверждённые брони (booking_requests_v2), чьё
    время уже прошло, и начисляет пилоту опыт/рейтинг за отыгранную сессию."""
    await ensure_booking_schema()

    while True:
        try:
            now = datetime.now(TZ)
            rows = await get_bookings_pending_experience(now.isoformat())

            for row in rows:
                booking_id = row["id"]
                telegram_id = row["telegram_id"]
                duration_minutes = row["duration_minutes"] or 0

                full_hours, rating_delta = _played_hour_rating(duration_minutes)

                claimed = await claim_booking_experience(
                    booking_id, telegram_id, duration_minutes, rating_delta
                )
                if not claimed:
                    # Уже обработано другим проходом — не начисляем повторно.
                    continue

                if rating_delta > 0:
                    logger.info(
                        "Пилот %s получил +%s рейтинга за %s полных отыгранных часов (booking #%s)",
                        telegram_id, rating_delta, full_hours, booking_id,
                    )

                try:
                    rating_text = (
                        f"\n📈 Рейтинг: +{rating_delta} за {full_hours} ч"
                        if rating_delta > 0 else ""
                    )
                    await bot.send_message(
                        telegram_id,
                        (
                            "🔥 Сессия завершена!\n\n"
                            f"➕ Опыт: +{duration_minutes} мин"
                            f"{rating_text}"
                        ),
                    )
                except Exception as e:
                    logger.warning(
                        "Не удалось отправить уведомление о завершении сессии %s: %s",
                        booking_id, e,
                    )

        except Exception:
            logger.exception("Ошибка обработки завершённых бронирований")

        await asyncio.sleep(300)

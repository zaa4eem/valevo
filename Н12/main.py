import asyncio
import html
import logging
import os
import sys
from datetime import datetime

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import ErrorEvent
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from pytz import timezone
from handlers import booking, time_requests

from config import ADMIN_IDS, BOT_TOKEN, MOSCOW_TZ, validate_required_settings, YCLIENTS_SYNC_INTERVAL_MINUTES, YCLIENTS_CARD_RETRY_INTERVAL_MINUTES
from database.db import init_db
from handlers import admin, bookings_admin, common, profile_experience
from services.monthly_reset import perform_monthly_reset
from services.experience_rewards import process_completed_bookings
from services.yclients_auto import auto_sync_all_pilots, process_pending_yclients_operations
from services.bonus_expiration import expire_season_bonuses
from utils.log_config import LoggingMiddleware, setup_logging
from utils.menu_updater_middleware import MenuUpdaterMiddleware


setup_logging()
logger = logging.getLogger(__name__)


def _register_middlewares(dp: Dispatcher) -> None:
    dp.update.outer_middleware(LoggingMiddleware())
    updater = MenuUpdaterMiddleware()

    for router in (
        booking.router,
        time_requests.router,
        admin.router,
        bookings_admin.router,
        profile_experience.router,
        common.router,
    ):
        router.message.outer_middleware(updater)
        router.callback_query.outer_middleware(updater)


def _register_routers(dp: Dispatcher) -> None:
    dp.include_router(booking.router)
    dp.include_router(time_requests.router)
    dp.include_router(admin.router)
    dp.include_router(bookings_admin.router)
    dp.include_router(profile_experience.router)
    dp.include_router(common.router)


def _register_error_handler(dp: Dispatcher, bot: Bot) -> None:
    """Ловит необработанные исключения хендлеров, чтобы они не терялись молча
    и админы узнавали о проблеме сразу, а не из жалоб пользователей."""

    @dp.errors()
    async def _on_error(event: ErrorEvent) -> bool:
        update_id = event.update.update_id if event.update else "?"
        logger.error(
            "Необработанная ошибка при обработке update_id=%s", update_id,
            exc_info=event.exception,
        )
        for admin_id in ADMIN_IDS:
            try:
                await bot.send_message(
                    admin_id,
                    f"⚠️ Необработанная ошибка в боте (update_id={update_id}):\n"
                    f"<code>{html.escape(type(event.exception).__name__)}: "
                    f"{html.escape(str(event.exception))}</code>",
                )
            except Exception:
                logger.warning("Не удалось уведомить админа %s об ошибке", admin_id)
        return True


async def _run_startup_jobs(bot: Bot, scheduler: AsyncIOScheduler) -> list[asyncio.Task]:
    moscow_tz = timezone(MOSCOW_TZ)
    now = datetime.now(moscow_tz)

    # Защита от повторного добавления после рестарта polling внутри процесса.
    if not scheduler.get_job("monthly_reset"):
        scheduler.add_job(
            perform_monthly_reset,
            CronTrigger(day=16, hour=18, minute=30, timezone=moscow_tz),
            args=[bot],
            id="monthly_reset",
            replace_existing=True,
            misfire_grace_time=3600,
            coalesce=True,
        )

    if not scheduler.get_job("yclients_auto_sync"):
        scheduler.add_job(
            auto_sync_all_pilots,
            "interval",
            minutes=max(30, int(YCLIENTS_SYNC_INTERVAL_MINUTES or 360)),
            args=[bot, False],
            id="yclients_auto_sync",
            replace_existing=True,
            misfire_grace_time=1800,
            coalesce=True,
        )

    if not scheduler.get_job("yclients_pending_retry"):
        scheduler.add_job(
            process_pending_yclients_operations,
            "interval",
            minutes=max(15, int(YCLIENTS_CARD_RETRY_INTERVAL_MINUTES or 360)),
            args=[bot],
            id="yclients_pending_retry",
            replace_existing=True,
            misfire_grace_time=1800,
            coalesce=True,
        )

    if not scheduler.get_job("season_bonus_expiration"):
        scheduler.add_job(
            expire_season_bonuses,
            CronTrigger(hour=5, minute=10, timezone=moscow_tz),
            args=[bot],
            id="season_bonus_expiration",
            replace_existing=True,
            misfire_grace_time=3600,
            coalesce=True,
        )

    if not scheduler.get_job("booking_reminders"):
        scheduler.add_job(
            booking.process_booking_reminders,
            "interval",
            minutes=5,
            args=[bot],
            id="booking_reminders",
            replace_existing=True,
            misfire_grace_time=900,
            coalesce=True,
        )

    if not scheduler.running:
        scheduler.start()

    # Автосинхронизация не должна блокировать запуск бота.
    background_tasks = [
        asyncio.create_task(auto_sync_all_pilots(bot, notify_admin=True)),
        asyncio.create_task(process_pending_yclients_operations(bot)),
        asyncio.create_task(expire_season_bonuses(bot)),
        asyncio.create_task(booking.process_booking_reminders(bot)),
    ]

    if now.day == 15 and now.hour >= 14:
        logger.info("15-е число после 14:00 — проверяю ежемесячные начисления при старте.")
        await perform_monthly_reset(bot)

    return background_tasks


async def main() -> None:
    validate_required_settings()

    await init_db()
    await booking.ensure_booking_schema()

    bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    scheduler = AsyncIOScheduler(timezone=timezone(MOSCOW_TZ))

    _register_middlewares(dp)
    _register_routers(dp)
    _register_error_handler(dp, bot)
    background_tasks = await _run_startup_jobs(bot, scheduler)
    background_tasks.append(asyncio.create_task(process_completed_bookings(bot)))

    exe_path = sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)
    try:
        build_time = datetime.fromtimestamp(os.path.getmtime(exe_path)).strftime("%Y-%m-%d %H:%M:%S")
    except OSError:
        build_time = "неизвестно"
    logger.info("Бот запущен (сборка от %s)", build_time)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        for task in background_tasks:
            task.cancel()
        await asyncio.gather(*background_tasks, return_exceptions=True)
        if scheduler.running:
            scheduler.shutdown(wait=False)
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Бот остановлен")
    except Exception:
        logger.exception("Критическая ошибка запуска/работы бота")
        raise

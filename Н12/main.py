import asyncio
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

from config import (
    ADMIN_IDS,
    BOT_TOKEN,
    MOSCOW_TZ,
    SEASON_CLOSE_DAY,
    SEASON_CLOSE_HOUR,
    SEASON_CLOSE_MINUTE,
    validate_required_settings,
    YCLIENTS_SYNC_INTERVAL_MINUTES,
    YCLIENTS_CARD_RETRY_INTERVAL_MINUTES,
)
from database.db import carry_benchmarks_to_current_season, init_db
from database.maintenance import run_scheduled_backup
from handlers import admin, bookings_admin, common, profile_experience
from services.db_watchdog import check_database_writable
from services.monthly_reset import perform_monthly_reset
from services.standings_watch import flush_standings_notifications
from services.experience_rewards import process_completed_bookings
from services.yclients_auto import auto_sync_all_pilots, process_pending_yclients_operations
from services.bonus_expiration import expire_season_bonuses
from utils.error_reporter import report_admin_error
from utils.log_config import LoggingMiddleware, setup_logging
from utils.menu_updater_middleware import MenuUpdaterMiddleware
from utils.chat_hygiene import ChatHygieneMiddleware


setup_logging()
logger = logging.getLogger(__name__)


def _register_middlewares(dp: Dispatcher) -> None:
    dp.update.outer_middleware(LoggingMiddleware())
    updater = MenuUpdaterMiddleware()
    hygiene = ChatHygieneMiddleware()

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
        router.message.outer_middleware(hygiene)


def _register_routers(dp: Dispatcher) -> None:
    dp.include_router(booking.router)
    dp.include_router(time_requests.router)
    dp.include_router(admin.router)
    dp.include_router(bookings_admin.router)
    dp.include_router(profile_experience.router)
    dp.include_router(common.router)


def _register_error_handler(dp: Dispatcher, bot: Bot) -> None:
    """Ловит необработанные исключения хендлеров, чтобы они не терялись молча
    и админы узнавали о проблеме сразу, а не из жалоб пользователей.

    Текст ошибки проходит через error_reporter: вместо сырого
    "TypeError: 'NoneType' object is not subscriptable" админ получает
    описание на русском и конкретные шаги. Одинаковые ошибки, идущие пачкой,
    схлопываются дедупликацией внутри error_reporter.
    """

    @dp.errors()
    async def _on_error(event: ErrorEvent) -> bool:
        update_id = event.update.update_id if event.update else "?"
        logger.error(
            "Необработанная ошибка при обработке update_id=%s", update_id,
            exc_info=event.exception,
        )

        user_hint = "—"
        try:
            source = event.update.message or event.update.callback_query if event.update else None
            if source is not None and source.from_user:
                user_hint = f"@{source.from_user.username or source.from_user.id}"
        except Exception:
            pass

        await report_admin_error(
            bot,
            context="Обработка действия пользователя в боте",
            error=event.exception,
            details={"Пользователь": user_hint, "update_id": update_id},
        )
        return True


async def _run_startup_jobs(bot: Bot, scheduler: AsyncIOScheduler) -> list[asyncio.Task]:
    moscow_tz = timezone(MOSCOW_TZ)
    now = datetime.now(moscow_tz)

    # Защита от повторного добавления после рестарта polling внутри процесса.
    if not scheduler.get_job("monthly_reset"):
        scheduler.add_job(
            perform_monthly_reset,
            CronTrigger(
                day=SEASON_CLOSE_DAY,
                hour=SEASON_CLOSE_HOUR,
                minute=SEASON_CLOSE_MINUTE,
                timezone=moscow_tz,
            ),
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

    # Отправка накопленных уведомлений о движении в общем зачёте. Дешёвая
    # операция: читает готовую очередь, полного пересчёта зачёта здесь нет —
    # он делается только по событию (засчитанный круг). Интервал 5 минут при
    # дебаунсе 20 минут даёт задержку доставки максимум 25 минут.
    if not scheduler.get_job("standings_notifications"):
        scheduler.add_job(
            flush_standings_notifications,
            "interval",
            minutes=5,
            args=[bot],
            id="standings_notifications",
            replace_existing=True,
            misfire_grace_time=600,
            coalesce=True,
        )

    # Проактивная проверка записи в базу — раньше о сбое узнавали только из
    # потока ошибок от реальных пользовательских действий (см. инцидент
    # 1 сентября 2026 с readonly-базой). Интервал 15 минут — быстрая реакция,
    # не нагружает лишним.
    if not scheduler.get_job("db_watchdog"):
        scheduler.add_job(
            check_database_writable,
            "interval",
            minutes=15,
            args=[bot],
            id="db_watchdog",
            replace_existing=True,
            misfire_grace_time=300,
            coalesce=True,
        )

    # Ежедневный бэкап базы + чистка старых копий. create_sqlite_backup()
    # существовала в проекте и раньше, но её никто не вызывал по расписанию —
    # без бэкапа единственная защита от потери данных была "не потерять
    # флешку". 04:20 МСК — гарантированно тихое время, не пересекается ни с
    # одной другой плановой задачей.
    if not scheduler.get_job("db_backup"):
        scheduler.add_job(
            run_scheduled_backup,
            CronTrigger(hour=4, minute=20, timezone=moscow_tz),
            args=[bot],
            id="db_backup",
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
        # Проверить запись в базу сразу при старте, не дожидаясь первого
        # плана через 15 минут — если бот запустился на уже сломанной базе,
        # админ должен узнать об этом в первую же минуту, а не спустя четверть часа.
        asyncio.create_task(check_database_writable(bot)),
    ]

    # Догоняем пропущенное закрытие, если бот был выключен в этот момент.
    # Повторный запуск безопасен: награды защищены таблицей season_awards
    # (плюс проверка по префиксу месяца для закрытий по прежней схеме), а
    # релегация — флагом relegation_done:<сезон> в bot_settings. Раньше флага
    # не было, и каждый перезапуск бота в день закрытия понижал ещё одну
    # порцию пилотов поверх уже понижённых.
    close_moment_passed = (
        now.day > SEASON_CLOSE_DAY
        or (
            now.day == SEASON_CLOSE_DAY
            and (now.hour, now.minute) >= (SEASON_CLOSE_HOUR, SEASON_CLOSE_MINUTE)
        )
    )
    if close_moment_passed:
        logger.info(
            "Момент закрытия сезона (%s-е %02d:%02d МСК) уже прошёл — проверяю начисления при старте.",
            SEASON_CLOSE_DAY, SEASON_CLOSE_HOUR, SEASON_CLOSE_MINUTE,
        )
        await perform_monthly_reset(bot)

    return background_tasks


async def main() -> None:
    validate_required_settings()

    await init_db()
    await booking.ensure_booking_schema()

    # Разовый перенос эталонов в ключ текущего сезона. Сезон теперь считается
    # от закрытия до закрытия, и после 20-го числа его ключ указывает на
    # следующий месяц — без переноса эталоны, заданные по прежней схеме,
    # оказались бы "не заданы" и обнулили бы баллы всех пилотов.
    try:
        carried = await carry_benchmarks_to_current_season()
        if carried:
            logger.info("Перенесено эталонов в текущий сезон: %s", carried)
    except Exception:
        logger.exception("Не удалось перенести эталоны в ключ текущего сезона")

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

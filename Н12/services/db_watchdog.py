"""Проактивный контроль доступности базы на запись.

Инцидент 1 сентября 2026: файл valevo.db на клубном ПК потерял право записи
на уровне Windows (см. запись 'attempt to write a readonly database' в
utils/error_reporter.py). Проблема обнаружилась только когда пилоты и админ
начали получать ошибки на живых действиях — узнали о простое из потока
одинаковых сообщений, а не сразу и не централизованно.

Этот модуль переворачивает порядок: лёгкая проверка запись+чтение по
расписанию, и при первом сбое — одно чёткое сообщение админу с готовой
инструкцией, раньше, чем это заметит хоть один пилот. При восстановлении —
отдельное сообщение "снова работает", чтобы не пришлось гадать, кончилась
авария или нет.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone as _tz

from config import SUPPORT_CHAT_ID
from database.db import get_setting, set_setting
from utils.error_reporter import report_admin_error

logger = logging.getLogger(__name__)

_HEARTBEAT_KEY = "db_watchdog_heartbeat"

# Последний известный статус проверки. Хранится в памяти процесса, а не в
# самой базе (если её же не удалось прочитать — негде и не на чём вести
# журнал состояния). Сбрасывается на None при перезапуске бота — это
# осознанно: если после перезапуска проблема ещё не устранена, админ должен
# узнать об этом заново, а не тихо "по памяти прошлого процесса".
_last_ok: bool | None = None


async def check_database_writable(bot=None) -> bool:
    """Пробует реальную запись и чтение в bot_settings.

    Уведомляет админа только на ПЕРЕХОДЕ состояния (было хорошо → стало плохо,
    и обратно) — не на каждом проходе. Иначе часовая авария при интервале
    проверки 15 минут дала бы 4 одинаковых сообщения вместо одного.
    """
    global _last_ok

    stamp = datetime.now(_tz.utc).isoformat()
    try:
        await set_setting(_HEARTBEAT_KEY, stamp)
        readback = await get_setting(_HEARTBEAT_KEY)
        if readback != stamp:
            raise RuntimeError(f"запись прошла, но при чтении вернулось другое значение: {readback!r}")
    except Exception as exc:
        if _last_ok is not False:
            logger.error("Проверка записи в базу провалилась: %r", exc)
            await report_admin_error(
                bot,
                context="Плановая проверка доступности базы на запись",
                error=exc,
                extra_advice=(
                    "Это автопроверка, а не ошибка от конкретного действия пилота — "
                    "значит запись в базу не работает СЕЙЧАС ВООБЩЕ: не пройдут новые "
                    "заявки на время, не начислится рейтинг, не сохранятся бронирования."
                ),
                dedup_key="db_watchdog",
            )
        _last_ok = False
        return False

    if _last_ok is False and bot is not None and SUPPORT_CHAT_ID:
        try:
            await bot.send_message(
                SUPPORT_CHAT_ID,
                "✅ <b>База данных снова доступна на запись</b>\n\n"
                "Автопроверка прошла успешно — можно продолжать работу как обычно.",
            )
        except Exception:
            logger.warning("Не удалось отправить сообщение о восстановлении записи в базу")

    _last_ok = True
    return True

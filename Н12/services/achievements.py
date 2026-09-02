"""Каталог достижений (~25 шт.) и движок их разблокировки.

На уровне модуля зависит только от database.db и data.tournament, не от
services.tournament — тот сам импортирует этот модуль при старте, чтобы вызывать
проверку ачивок после переходов, и импорт на уровне модуля в обе стороны
зациклился бы. Там, где для расчёта балла реально нужен services.tournament
(единая функция live_class_score — чтобы бонус новичка и все правки считались
одинаково везде), импорт делается лениво внутри функции.
"""

from __future__ import annotations

import logging

from config import MOSCOW_TZ, SEASON_CLOSE_DAY, SEASON_CLOSE_HOUR, SEASON_CLOSE_MINUTE
from data.tournament import (
    CLASS_LADDER,
    MAIN_SEQUENCE,
    SIDE_DISCIPLINES,
    min_starts_for_class,
    month_bounds,
    sql_timestamp,
)
from database.db import (
    count_lifetime_laps,
    count_month_improvements,
    get_pilot_month_best,
    get_setting,
    has_prior_laps_on_track,
    is_track_record,
    lifetime_disciplines_raced,
    set_setting,
    unlock_achievement,
    update_pilot_rating,
)
from keyboards.menu import webapp_deep_link_keyboard

logger = logging.getLogger(__name__)


def _season_bounds(now=None) -> tuple[str, str, str]:
    """Границы сезона с моментом закрытия из конфига.

    Этот модуль зовёт data.tournament напрямую (импортировать
    services.tournament на уровне модуля нельзя — он сам импортирует этот),
    поэтому настройки закрытия приходится прокидывать здесь вручную. Без них
    ачивки считались бы по другим границам, чем зачёт и закрытие сезона.
    """
    return month_bounds(
        now=now,
        moscow_tz_name=MOSCOW_TZ,
        close_day=SEASON_CLOSE_DAY,
        close_hour=SEASON_CLOSE_HOUR,
        close_minute=SEASON_CLOSE_MINUTE,
    )


LAP_MILESTONES = [1, 5, 10, 25, 50, 100, 200]

# code -> (эмодзи, название, описание, награда рейтингом)
CATALOG: dict[str, tuple[str, str, str, int]] = {
    "first_lap": ("🏁", "Первый круг", "Отправили первый результат в истории аккаунта", 5),
    "laps_5": ("🔟", "5 заездов", "Проехали 5 засчитанных кругов", 5),
    "laps_10": ("🔟", "10 заездов", "Проехали 10 засчитанных кругов", 5),
    "laps_25": ("🔟", "25 заездов", "Проехали 25 засчитанных кругов", 5),
    "laps_50": ("🔟", "50 заездов", "Проехали 50 засчитанных кругов", 10),
    "laps_100": ("💯", "100 заездов", "Проехали 100 засчитанных кругов", 10),
    "laps_200": ("💯", "200 заездов", "Проехали 200 засчитанных кругов", 15),
    "pioneer_empty_table": ("🆕", "Первопроходец", "Первая запись в пустой таблице дисциплины/трассы", 5),
    "track_record": ("👑", "Хозяин трассы", "Стали №1 в личном зачёте на трассе", 10),
    "unlocked_btcc": ("🏎", "Добро пожаловать в BTCC", "Открыли класс BTCC", 10),
    "unlocked_gt500": ("🏎", "Добро пожаловать в GT500", "Открыли класс GT500", 10),
    "unlocked_gt3": ("💎", "Элита", "Открыли класс GT3", 15),
    "top5_month": ("🏆", "Топ-5 месяца", "Попали в топ-5 общего зачёта месяца", 10),
    "won_month": ("🥇", "Чемпион месяца", "Заняли 1-е место в общем зачёте месяца", 20),
    "multi_class_month": ("🎯", "Многостаночник", "Откатали 3 разных класса за один месяц", 10),
    "streak_3": ("🔥", "3 месяца подряд", "3 месяца подряд выполнен минимум стартов", 10),
    "streak_6": ("🔥", "6 месяцев подряд", "6 месяцев подряд выполнен минимум стартов", 15),
    "streak_12": ("🔥", "Годовщина", "12 месяцев подряд выполнен минимум стартов", 25),
    "beat_benchmark": ("⚡", "Быстрее эталона", "Набрали 100+ баллов хотя бы в одном классе", 5),
    "max_score": ("🌟", "Максимум", "Набрали 130 баллов — предел шкалы", 15),
    "improved_5_times": ("📈", "Прогресс", "Улучшили личное время 5 раз за месяц в одной дисциплине", 5),
    "all_main_classes": ("🗺", "Полный круг", "Проехали во всех основных классах (MX-5/BTCC/GT500/GT3)", 15),
    "both_side_disciplines": ("🎲", "Разносторонний", "Проехали в обеих доп.дисциплинах (DTM и Touge)", 10),
    "referral": ("🤝", "Привёл друга", "Пригласили нового пилота в клуб", 10),
    "founding_member": ("🚀", "Основатель", "Участвовали в первом месяце новой турнирной системы", 10),
}

assert len(CATALOG) == 25, f"Ожидалось 25 достижений, сейчас {len(CATALOG)}"


async def _award(telegram_id: int, code: str, bag: list | None = None) -> None:
    """Разблокирует ачивку и начисляет рейтинг. Раньше сразу же отправляла
    отдельное сообщение — если один круг открывал сразу 3-5 ачивок (частый
    случай: первый круг месяца ⇒ founding_member + pioneer + milestone +
    beat_benchmark одновременно), пилоту прилетало 3-5 сообщений подряд.
    Теперь просто складывает новые ачивки в bag — вызывающий код отправляет
    их одним сообщением через _flush_achievements после всех проверок."""
    if code not in CATALOG:
        return
    newly_unlocked = await unlock_achievement(telegram_id, code)
    if not newly_unlocked:
        return

    emoji, title, description, reward = CATALOG[code]
    try:
        await update_pilot_rating(telegram_id, reward)
    except Exception:
        logger.exception("Не удалось начислить рейтинг за ачивку %s пилоту %s", code, telegram_id)

    if bag is not None:
        bag.append((emoji, title, description, reward))


async def _flush_achievements(telegram_id: int, bot, bag: list) -> None:
    """Отправляет одно сообщение со всеми ачивками, накопленными в bag за
    текущую проверку (одну, если она единственная — без лишнего "список из 1")."""
    if not bag or bot is None:
        return

    if len(bag) == 1:
        emoji, title, description, reward = bag[0]
        text = (
            f"{emoji} <b>НОВОЕ ДОСТИЖЕНИЕ</b>\n\n"
            f"<b>{title}</b>\n{description}\n\n📈 Рейтинг: +{reward}"
        )
    else:
        total_reward = sum(reward for _, _, _, reward in bag)
        lines = [f"🎉 <b>НОВЫЕ ДОСТИЖЕНИЯ ({len(bag)})</b>", ""]
        for emoji, title, description, reward in bag:
            lines.append(f"{emoji} <b>{title}</b> — {description} (+{reward})")
        lines.append("")
        lines.append(f"📈 Рейтинг суммарно: +{total_reward}")
        text = "\n".join(lines)

    try:
        await bot.send_message(telegram_id, text, reply_markup=webapp_deep_link_keyboard("profile", "🏅 Открыть ачивки"))
    except Exception:
        logger.warning("Не удалось уведомить пилота %s о достижениях (%s шт.)", telegram_id, len(bag))


async def check_achievements_after_lap(
    telegram_id: int,
    discipline_name: str,
    bot=None,
    *,
    track: str | None = None,
    lap_time_ms: int | None = None,
    promoted_to: str | None = None,
) -> None:
    """Проверки, привязанные к моменту засчитанного круга. Все ачивки,
    открытые за этот вызов, собираются в один bag и уходят одним сообщением
    в конце — вместо того чтобы прилетать пилоту по отдельности."""
    bag: list = []

    if promoted_to == "BTCC":
        await _award(telegram_id, "unlocked_btcc", bag)
    elif promoted_to == "GT500":
        await _award(telegram_id, "unlocked_gt500", bag)
    elif promoted_to == "GT3":
        await _award(telegram_id, "unlocked_gt3", bag)

    total_laps = await count_lifetime_laps(telegram_id)
    for milestone in LAP_MILESTONES:
        if total_laps >= milestone:
            code = "first_lap" if milestone == 1 else f"laps_{milestone}"
            await _award(telegram_id, code, bag)

    if track and lap_time_ms is not None:
        # created_at "перед этим кругом" — берём с небольшим запасом, круг только что вставлен.
        #
        # Граница обязана быть в формате SQLite ("YYYY-MM-DD HH:MM:SS"), а не
        # isoformat(): с разделителем 'T' строковое сравнение created_at < граница
        # срабатывало для ЛЮБОЙ записи того же дня (пробел 0x20 < 'T' 0x54),
        # включая только что вставленный круг — was_empty всегда получался False,
        # и ачивка "Первопроходец" не открывалась вообще никогда.
        from datetime import datetime, timedelta, timezone as _dt_timezone
        before = sql_timestamp(datetime.now(_dt_timezone.utc) - timedelta(seconds=1))
        was_empty = not await has_prior_laps_on_track(discipline_name, track, before)
        if was_empty:
            await _award(telegram_id, "pioneer_empty_table", bag)

        if await is_track_record(telegram_id, discipline_name, track, lap_time_ms):
            await _award(telegram_id, "track_record", bag)

    if discipline_name in CLASS_LADDER:
        # Отложенный импорт — избегаем цикла на уровне модуля (services.tournament
        # сам импортирует этот модуль). Важно звать именно live_class_score, а не
        # пересчитывать баллы здесь заново — иначе бонус новичка (+15 в MX-5)
        # учтётся в одном месте и не в другом, и это два разных "истинных" балла.
        from services.tournament import live_class_score

        month_key, start_iso, end_iso = _season_bounds()
        result = await live_class_score(telegram_id, discipline_name, month_key, start_iso, end_iso)
        if result["qualifies"] and result["score"] is not None:
            if result["score"] >= 100:
                await _award(telegram_id, "beat_benchmark", bag)
            if result["score"] >= 130:
                await _award(telegram_id, "max_score", bag)

        if result["benchmark"]:
            improvements = await count_month_improvements(telegram_id, discipline_name, start_iso, end_iso)
            if improvements >= 5:
                await _award(telegram_id, "improved_5_times", bag)

        await _check_founding_member(telegram_id, month_key, start_iso, end_iso, bag)

    raced = await lifetime_disciplines_raced(telegram_id)
    if set(MAIN_SEQUENCE).issubset(raced):
        await _award(telegram_id, "all_main_classes", bag)

    all_side = {name for names in SIDE_DISCIPLINES.values() for name in names}
    if all_side and all_side.issubset(raced):
        await _award(telegram_id, "both_side_disciplines", bag)

    await _flush_achievements(telegram_id, bot, bag)


async def _check_founding_member(telegram_id: int, month_key: str, start_iso: str, end_iso: str, bag: list | None = None) -> None:
    launch_month = await get_setting("tournament_launch_month")
    if launch_month is None:
        launch_month = month_key
        await set_setting("tournament_launch_month", launch_month)

    if month_key != launch_month:
        return

    for class_name in CLASS_LADDER:
        _, starts = await get_pilot_month_best(telegram_id, class_name, start_iso, end_iso)
        if starts >= min_starts_for_class(class_name):
            await _award(telegram_id, "founding_member", bag)
            return


async def grant_manual_achievement(telegram_id: int, code: str, bot=None) -> bool:
    """Для достижений без автоматической проверки (сейчас — только 'referral'),
    выдаётся вручную администратором."""
    if code not in CATALOG:
        return False
    bag: list = []
    await _award(telegram_id, code, bag)
    await _flush_achievements(telegram_id, bot, bag)
    return True


async def check_achievements_month_end(bot=None, bounds: tuple[str, str, str] | None = None) -> None:
    """Проверки, зависящие от итогов месяца — вызывается из ежемесячной джобы
    закрытия сезона (после релегации). Ранжирование месяца и стрик могут оба
    открыть ачивку одному и тому же пилоту за один прогон — копим в общий bag
    на пилота между обеими проверками и шлём одно сообщение в конце, а не два."""
    from services.tournament import month_participant_ids, rank_month_overall  # локальный импорт: избегаем цикла на уровне модуля

    # bounds приходит из закрытия месяца — там это ПРЕДЫДУЩИЙ календарный месяц
    # (закрытие идёт 20-го в 18:00). Без явной передачи month_bounds() вернул бы
    # только что начавшийся месяц, и ачивки за итоги месяца ("Чемпион месяца",
    # "Топ-5 месяца") считались бы по пустой таблице.
    month_key, start_iso, end_iso = bounds or _season_bounds()
    bags: dict[int, list] = {}

    def bag_for(telegram_id: int) -> list:
        return bags.setdefault(telegram_id, [])

    ranking = await rank_month_overall(month_key, start_iso, end_iso)
    for rank, row in enumerate(ranking, start=1):
        telegram_id = row["telegram_id"]
        bag = bag_for(telegram_id)
        if len(row["breakdown"]) >= 3:
            await _award(telegram_id, "multi_class_month", bag)
        if rank == 1:
            await _award(telegram_id, "won_month", bag)
        if rank <= 5:
            await _award(telegram_id, "top5_month", bag)

    # Стрик отсчитываем от закрываемого месяца, а не от "сейчас": закрытие идёт
    # 1-го числа нового месяца, и без этого цикл начинался бы с пустого месяца,
    # обрывался на первом же шаге и стрик-ачивки не выдавались бы никогда.
    for telegram_id in await month_participant_ids(start_iso, end_iso):
        await _check_streak(telegram_id, bag_for(telegram_id), month_key=month_key)

    for telegram_id, bag in bags.items():
        await _flush_achievements(telegram_id, bot, bag)


async def _check_streak(telegram_id: int, bag: list | None = None, month_key: str | None = None) -> None:
    """Считает подряд идущие месяцы (включая закрываемый) с выполненным
    минимумом стартов хотя бы в одной дисциплине.

    month_key ("YYYY-MM") задаёт месяц, с которого начинать отсчёт назад.
    Передаётся из закрытия сезона, где это ПРЕДЫДУЩИЙ месяц относительно
    календарного "сейчас" — иначе отсчёт стартовал бы с ещё пустого месяца
    и обрывался на первом шаге.
    """
    from datetime import datetime, timezone as _dt_timezone

    moscow_now = None
    try:
        from pytz import timezone as _tz
        moscow_now = datetime.now(_tz(MOSCOW_TZ))
    except Exception:
        moscow_now = datetime.now(_dt_timezone.utc)

    streak = 0
    year, month = moscow_now.year, moscow_now.month
    if month_key:
        try:
            year_text, month_text = month_key.split("-", 1)
            year, month = int(year_text), int(month_text)
        except (ValueError, AttributeError):
            logger.warning("Некорректный month_key для стрика: %r", month_key)
    for _ in range(12):
        probe = moscow_now.replace(year=year, month=month, day=1)
        _key, start_iso, end_iso = _season_bounds(now=probe)

        met = False
        for class_name in CLASS_LADDER:
            _best, starts = await get_pilot_month_best(telegram_id, class_name, start_iso, end_iso)
            if starts >= min_starts_for_class(class_name):
                met = True
                break
        if not met:
            break
        streak += 1

        month -= 1
        if month == 0:
            month = 12
            year -= 1

    if streak >= 3:
        await _award(telegram_id, "streak_3", bag)
    if streak >= 6:
        await _award(telegram_id, "streak_6", bag)
    if streak >= 12:
        await _award(telegram_id, "streak_12", bag)

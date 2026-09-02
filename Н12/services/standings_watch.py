"""Уведомления о движении пилота в общем зачёте месяца.

Задача, которую решает модуль: пилот должен узнавать, что его сместили или
выбили из топ-5 — то есть из призовой зоны (BONUS_HOURS покрывает ровно места
1–5). При этом бот не должен превращаться в источник бесконечного потока
сообщений: зачёт живой, он пересчитывается после каждого засчитанного круга, и
наивная реализация «пересчитал → разослал» при разборе десяти заявок подряд
прислала бы каждому пилоту десяток сообщений за вечер.

Как устроена защита от спама (шесть независимых уровней):

1. Сравнение с ПОСЛЕДНИМ ОПОВЕЩЁННЫМ местом, а не с предыдущим расчётом.
   Цепочка 2 → 3 → 2 внутри вечера не даёт ни одного сообщения: по данным,
   которые есть у пилота, он никуда не двигался.
2. Дебаунс: изменение не уходит сразу, а ждёт DEBOUNCE_MINUTES. За это время
   поток заявок успевает закончиться, и отправляется одно итоговое состояние.
3. Тихие часы (STANDINGS_QUIET_* из конфига, по умолчанию 01:00–12:00 МСК) —
   то же окно, в котором уже закрыт приём заявок. Накопленное ждёт утра;
   если к утру состояние откатилось, сообщение не уходит вообще.
4. Пауза между сообщениями одному пилоту — MIN_INTERVAL_HOURS.
5. Жёсткий суточный предел на пилота — MAX_PER_DAY.
6. Персональный выключатель (pilots.notify_standings) — человек может
   отключить именно этот тип сообщений, не выключая бота целиком.

Триггеры — только события, а не опрос: засчитанный круг и смена эталона
месяца. Отдельной джобы, которая крутит расчёт зачёта в холостую, здесь нет —
это самый дорогой расчёт в проекте, и держать его на таймере было бы расточительно.
"""

from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta

from pytz import timezone

from config import MOSCOW_TZ, STANDINGS_QUIET_FROM_HOUR, STANDINGS_QUIET_TO_HOUR
from data.tournament import CLASS_LADDER
from database.db import (
    clear_standings_pending,
    get_all_pilot_display_names,
    get_due_standings_changes,
    get_standings_notify_enabled,
    get_standings_notify_state,
    mark_standings_notified,
    queue_standings_change,
    reset_standings_state_for_new_month,
    set_standings_baseline,
)
from services.tournament import month_bounds, rank_month_overall
from utils.message_style import DIVIDER

logger = logging.getLogger(__name__)

# Призовая зона: BONUS_HOURS в monthly_reset покрывает места 1–5, поэтому
# граница уведомления совпадает с границей, за которой начинаются деньги.
PRIZE_ZONE = 5

# Насколько глубоко смотрим за пределы призовой зоны. Нужно, чтобы сказать
# "теперь вы 7-й", а не просто "вы вне топ-5", и чтобы заметить возвращение.
TRACK_DEPTH = 15

DEBOUNCE_MINUTES = 20
MIN_INTERVAL_HOURS = 6
MAX_PER_DAY = 3


def _moscow_now() -> datetime:
    return datetime.now(timezone(MOSCOW_TZ))


def _parse_db_time(value: str | None) -> datetime | None:
    """Разбирает CURRENT_TIMESTAMP из SQLite (naive UTC) в aware-datetime."""
    if not value:
        return None
    text = str(value).strip().replace("T", " ").split(".")[0]
    try:
        naive = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        logger.warning("Не удалось разобрать время из БД: %r", value)
        return None
    return timezone("UTC").localize(naive)


def is_quiet_hours(now: datetime | None = None) -> bool:
    """Тихое окно МСК. Поддерживает интервал через полночь (например 23→8)."""
    now = now or _moscow_now()
    start, end = STANDINGS_QUIET_FROM_HOUR, STANDINGS_QUIET_TO_HOUR
    if start == end:
        return False
    if start < end:
        return start <= now.hour < end
    return now.hour >= start or now.hour < end


async def _load_names() -> dict[int, str]:
    """Справочник имён одним запросом — диффер подписывает соседей по таблице
    для каждого изменившегося пилота, и построчные запросы здесь дали бы
    десятки обращений к БД на каждый засчитанный круг."""
    try:
        return await get_all_pilot_display_names()
    except Exception:
        logger.exception("Не удалось загрузить справочник имён для уведомлений о зачёте")
        return {}


def _places_from_ranking(ranking: list[dict]) -> dict[int, tuple[int, float]]:
    """{telegram_id: (место, итог)} в пределах TRACK_DEPTH."""
    return {
        row["telegram_id"]: (place, float(row["total"]))
        for place, row in enumerate(ranking[:TRACK_DEPTH], start=1)
    }


async def record_standings_change(bot, month_key: str, ranking: list[dict]) -> None:
    """Сравнивает свежий зачёт с тем, что пилотам уже сообщали, и ставит
    отличия в очередь на отправку. Ничего не отправляет сама — отправкой
    занимается flush_standings_notifications после дебаунса.
    """
    await reset_standings_state_for_new_month(month_key)

    places = _places_from_ranking(ranking)
    state = await get_standings_notify_state(month_key)

    if not state:
        # Первый расчёт в этом месяце (или первый после обновления бота):
        # фиксируем как базовую линию молча, иначе весь топ разом получил бы
        # «вы вошли в топ-5» на ровном месте.
        await set_standings_baseline(month_key, places)
        logger.info("Базовая линия зачёта за %s зафиксирована (%s пилотов)", month_key, len(places))
        return

    names = await _load_names()

    # Проверяем и тех, кто сейчас в таблице, и тех, о ком когда-то сообщали —
    # иначе пилот, вылетевший за TRACK_DEPTH, просто пропал бы без уведомления.
    watched = set(places) | set(state)

    for telegram_id in watched:
        current = places.get(telegram_id)
        current_place = current[0] if current else None
        current_total = current[1] if current else 0.0

        row = state.get(telegram_id) or {}
        notified_place = row.get("notified_place")

        if notified_place is None and current_place is None:
            continue
        if notified_place == current_place:
            # Место не изменилось с последнего сообщения — если что-то висело
            # в очереди, снимаем: пилот вернулся туда, где он и думал, что он.
            if row.get("pending_since"):
                await clear_standings_pending(telegram_id)
            continue

        was_in_zone = notified_place is not None and notified_place <= PRIZE_ZONE
        now_in_zone = current_place is not None and current_place <= PRIZE_ZONE

        # Движение целиком вне призовой зоны (14 → 15) никого не волнует и
        # является основным источником шума — молча обновляем и не пишем.
        if not was_in_zone and not now_in_zone:
            continue

        # Кто стоит непосредственно выше — самая полезная деталь в сообщении:
        # пилот сразу понимает, кого именно надо обойти обратно.
        rival = None
        if current_place and current_place > 1 and len(ranking) >= current_place - 1:
            rival_id = ranking[current_place - 2]["telegram_id"]
            rival = names.get(rival_id) or str(rival_id)

        await queue_standings_change(
            telegram_id=telegram_id,
            month_key=month_key,
            place=current_place,
            total=current_total,
            rival=rival,
        )


def _build_message(
    notified_place: int | None,
    new_place: int | None,
    new_total: float,
    rival: str | None,
    gap_to_target: float | None,
    target_place: int | None,
) -> str:
    """Текст уведомления. Всегда содержит зацепку к действию — «сколько
    баллов до места», иначе сообщение только расстраивает и ничего не даёт."""
    was_in_zone = notified_place is not None and notified_place <= PRIZE_ZONE
    now_in_zone = new_place is not None and new_place <= PRIZE_ZONE

    if now_in_zone and not was_in_zone:
        head = "🔺 <b>ВЫ В ПРИЗОВОЙ ЗОНЕ</b>"
        body = f"Вы вошли в топ-{PRIZE_ZONE} общего зачёта — <b>{new_place} место</b>."
    elif not now_in_zone and was_in_zone:
        head = "🔻 <b>ВАС ВЫБИЛИ ИЗ ТОП-5</b>"
        place_text = f"{new_place} место" if new_place else f"вне топ-{TRACK_DEPTH}"
        body = (
            f"Вы вышли из призовой зоны общего зачёта.\n"
            f"Было: <b>{notified_place} место</b> → стало: <b>{place_text}</b>."
        )
    elif new_place and notified_place and new_place > notified_place:
        head = "⬇️ <b>ВАС СМЕСТИЛИ В ОБЩЕМ ЗАЧЁТЕ</b>"
        body = f"Было: <b>{notified_place} место</b> → стало: <b>{new_place} место</b>."
    else:
        head = "⬆️ <b>ВЫ ПОДНЯЛИСЬ В ОБЩЕМ ЗАЧЁТЕ</b>"
        was_text = f"{notified_place} место" if notified_place else f"вне топ-{PRIZE_ZONE}"
        body = f"Было: <b>{was_text}</b> → стало: <b>{new_place} место</b>."

    lines = [head, DIVIDER, "", body, "", f"Ваш итог: <b>{new_total:g}</b> баллов."]

    if rival:
        lines.append(f"Выше вас сейчас: <b>{html.escape(rival)}</b>.")

    if gap_to_target is not None and target_place:
        lines.append(f"До <b>{target_place} места</b>: <b>{gap_to_target:g}</b> баллов.")

    heaviest = max(CLASS_LADDER.items(), key=lambda pair: pair[1]["weight"])
    lines.append("")
    lines.append(
        f"Быстрее всего отыграть баллы — в старших классах: вес класса растёт "
        f"с ×{min(cfg['weight'] for cfg in CLASS_LADDER.values()):g} "
        f"до ×{heaviest[1]['weight']:g} ({heaviest[0]})."
    )
    lines.append("")
    lines.append("<i>Отключить эти уведомления можно в профиле.</i>")

    return "\n".join(lines)


async def flush_standings_notifications(bot) -> dict:
    """Отправляет накопленные уведомления, у которых истёк дебаунс и соблюдены
    все ограничения. Вызывается планировщиком каждые несколько минут — это
    дешёвая операция, полного пересчёта зачёта здесь нет.
    """
    if bot is None:
        return {"ok": False, "status": "no_bot"}

    now = _moscow_now()
    if is_quiet_hours(now):
        # Ничего не теряем: строки остаются в очереди и уйдут после тихих часов
        # (а если состояние к тому моменту откатится — не уйдут вовсе).
        return {"ok": True, "status": "quiet_hours", "sent": 0}

    month_key, start_iso, end_iso = month_bounds()

    try:
        due = await get_due_standings_changes(month_key)
    except Exception:
        logger.exception("Не удалось прочитать очередь уведомлений о зачёте")
        return {"ok": False, "status": "read_failed"}

    if not due:
        return {"ok": True, "status": "empty", "sent": 0}

    # Свежий зачёт нужен один раз на весь проход — для подсказки "сколько
    # баллов до места выше". Пересчитывать его на каждого пилота нельзя:
    # это самый тяжёлый расчёт в проекте.
    try:
        ranking = await rank_month_overall(month_key, start_iso, end_iso)
    except Exception:
        logger.exception("Не удалось пересчитать зачёт для уведомлений")
        ranking = []

    day_key = now.strftime("%Y-%m-%d")
    sent = skipped = 0

    for row in due:
        telegram_id = row["telegram_id"]

        pending_since = _parse_db_time(row.get("pending_since"))
        if pending_since is None:
            await clear_standings_pending(telegram_id)
            continue

        # 2. Дебаунс: даём потоку заявок закончиться.
        if (datetime.now(timezone("UTC")) - pending_since) < timedelta(minutes=DEBOUNCE_MINUTES):
            skipped += 1
            continue

        pending_place = row.get("pending_place")
        notified_place = row.get("notified_place")

        # 1. Состояние откатилось к уже известному пилоту — сообщать нечего.
        if pending_place == notified_place:
            await clear_standings_pending(telegram_id)
            skipped += 1
            continue

        # 6. Персональный выключатель. Место всё равно фиксируем как
        # оповещённое, иначе после включения прилетит устаревшая новость.
        try:
            if not await get_standings_notify_enabled(telegram_id):
                await mark_standings_notified(
                    telegram_id, pending_place, float(row.get("pending_total") or 0), day_key,
                )
                skipped += 1
                continue
        except Exception:
            logger.exception("Не удалось проверить настройку уведомлений пилота %s", telegram_id)

        # 4. Пауза между сообщениями одному пилоту.
        notified_at = _parse_db_time(row.get("notified_at"))
        if notified_at and (datetime.now(timezone("UTC")) - notified_at) < timedelta(hours=MIN_INTERVAL_HOURS):
            skipped += 1
            continue

        # 5. Суточный предел.
        if row.get("sent_day") == day_key and int(row.get("sent_today") or 0) >= MAX_PER_DAY:
            skipped += 1
            continue

        new_total = float(row.get("pending_total") or 0)

        gap_to_target = None
        target_place = None
        if pending_place and pending_place > 1 and len(ranking) >= pending_place - 1:
            target_place = pending_place - 1
            gap_to_target = round(float(ranking[target_place - 1]["total"]) - new_total, 1)
            if gap_to_target < 0:
                gap_to_target = None
                target_place = None

        text = _build_message(
            notified_place=notified_place,
            new_place=pending_place,
            new_total=new_total,
            rival=row.get("pending_rival"),
            gap_to_target=gap_to_target,
            target_place=target_place,
        )

        try:
            await bot.send_message(telegram_id, text)
        except Exception as exc:
            # Заблокировал бота, удалил аккаунт и подобное — не повод держать
            # строку в очереди вечно и разбирать её на каждом проходе.
            logger.info("Не удалось отправить уведомление о зачёте пилоту %s: %s", telegram_id, exc)
            await mark_standings_notified(telegram_id, pending_place, new_total, day_key)
            skipped += 1
            continue

        await mark_standings_notified(telegram_id, pending_place, new_total, day_key)
        sent += 1

    return {"ok": True, "status": "done", "sent": sent, "skipped": skipped}


async def rebaseline_standings(month_key: str, ranking: list[dict]) -> None:
    """Переписывает базовую линию без единого уведомления.

    Нужно после административных действий, которые двигают весь зачёт разом —
    прежде всего смены эталона месяца. Такое смещение вызвано не гонкой, а
    решением клуба, и рассылать по нему «вас обошли» половине пилотов
    бессмысленно и обидно: обходить их никто не обходил.
    """
    await reset_standings_state_for_new_month(month_key)
    await set_standings_baseline(month_key, _places_from_ranking(ranking))


async def refresh_standings_after_lap(bot) -> None:
    """Хук после засчитанного круга: пересчитать зачёт и поставить изменения
    в очередь. Ошибки здесь никогда не должны ломать приём круга — результат
    пилота важнее уведомления о нём.
    """
    try:
        month_key, start_iso, end_iso = month_bounds()
        ranking = await rank_month_overall(month_key, start_iso, end_iso)
        await record_standings_change(bot, month_key, ranking)
    except Exception:
        logger.exception("Не удалось обновить состояние уведомлений о зачёте")

"""Уведомления о движении в общем зачёте и топ-5 каждой дисциплины.

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
import asyncio
from functools import wraps
import logging
from datetime import datetime, timedelta

from pytz import timezone
from aiogram.exceptions import TelegramForbiddenError

from config import MOSCOW_TZ, STANDINGS_QUIET_FROM_HOUR, STANDINGS_QUIET_TO_HOUR
from data.tournament import CLASS_LADDER, canonical_class_name
from database.db import (
    clear_standings_pending,
    get_all_pilot_display_names,
    get_all_disciplines,
    get_setting,
    get_due_standings_changes,
    get_standings_notify_enabled,
    get_standings_notify_state,
    mark_standings_notified,
    queue_standings_change,
    reset_standings_state_for_new_month,
    set_standings_baseline,
)
from services.tournament import month_bounds, rank_month_overall, load_month_snapshot
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


_standings_lock = asyncio.Lock()


def _serialized(function):
    @wraps(function)
    async def wrapped(*args, **kwargs):
        async with _standings_lock:
            return await function(*args, **kwargs)
    return wrapped


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


async def record_standings_change(bot, month_key: str, ranking: list[dict], scope: str = "overall") -> None:
    """Сравнивает свежий зачёт с тем, что пилотам уже сообщали, и ставит
    отличия в очередь на отправку. Ничего не отправляет сама — отправкой
    занимается flush_standings_notifications после дебаунса.
    """
    await reset_standings_state_for_new_month(month_key)

    places = _places_from_ranking(ranking)
    state = await get_standings_notify_state(month_key, scope)

    if not state and not await get_setting(f"standings_v3_baseline:{month_key}:{scope}"):
        # Имеющиеся результаты молча фиксирует initialize_standings_baselines
        # при запуске/миграции. Здесь уже событие принятого круга: первый вход
        # в новом сезоне или новой дисциплине тоже должен попасть в очередь.
        await set_standings_baseline(month_key, {}, scope)

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
                await clear_standings_pending(telegram_id, scope)
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
            scope=scope,
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

    lines.append("")
    lines.append("Улучшайте место в дисциплине: коэффициенты топ-7 — от ×2 до ×1,4.")
    lines.append("")
    lines.append("<i>Отключить эти уведомления можно в профиле.</i>")

    return "\n".join(lines)


def _build_discipline_message(scope: str, old_place: int | None, new_place: int | None) -> str:
    discipline = html.escape(scope.removeprefix("class:"))
    old_top = old_place is not None and old_place <= PRIZE_ZONE
    new_top = new_place is not None and new_place <= PRIZE_ZONE
    if new_top and not old_top:
        text = f"⬆️ Вы вошли в топ-5 <b>{discipline}</b> — <b>{new_place} место</b>."
    elif old_top and not new_top:
        text = f"⬇️ Вы вышли из топ-5 <b>{discipline}</b>."
    else:
        arrow = "⬆️" if new_place < old_place else "⬇️"
        text = f"{arrow} Ваше место в <b>{discipline}</b> изменилось: <b>{old_place} → {new_place}</b>."
    return text + "\n\n<i>Отключить уведомления можно в профиле.</i>"


def _snapshot_rankings(snapshot) -> dict[str, list[dict]]:
    return {"overall": snapshot.overall_ranking(), **{
        f"class:{name}": rows for name, rows in snapshot.discipline_rankings().items()
    }}


@_serialized
async def flush_standings_notifications(bot) -> dict:
    """Существующая очередь и интервалы отправки, отдельно для каждого зачёта."""
    if bot is None:
        return {"ok": False, "status": "no_bot"}
    now = _moscow_now()
    if is_quiet_hours(now):
        return {"ok": True, "status": "quiet_hours", "sent": 0}
    month_key, start_iso, end_iso = month_bounds()
    due = await get_due_standings_changes(month_key)
    if not due:
        return {"ok": True, "status": "empty", "sent": 0}
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    rankings = _snapshot_rankings(snapshot)
    day_key = now.strftime("%Y-%m-%d")
    sent = skipped = 0
    for row in due:
        telegram_id = row["telegram_id"]
        scope = row["scope"]
        pending_since = _parse_db_time(row.get("pending_since"))
        if pending_since is None:
            await clear_standings_pending(telegram_id, scope)
            continue
        if datetime.now(timezone("UTC")) - pending_since < timedelta(minutes=DEBOUNCE_MINUTES):
            skipped += 1
            continue
        pending_place = row.get("pending_place")
        notified_place = row.get("notified_place")
        ranking = rankings.get(scope, [])
        places = _places_from_ranking(ranking)
        current_place, new_total = places.get(telegram_id, (None, 0.0))
        # Не отправляем устаревшую очередь после административной правки.
        # Новые события удаления/отмены здесь не создаются.
        if current_place != pending_place or pending_place == notified_place:
            await clear_standings_pending(telegram_id, scope)
            skipped += 1
            continue
        try:
            enabled = await get_standings_notify_enabled(telegram_id)
        except Exception:
            logger.exception("Не удалось проверить настройку уведомлений")
            skipped += 1
            continue
        if not enabled:
            await mark_standings_notified(telegram_id, pending_place, new_total, day_key, scope, delivered=False)
            skipped += 1
            continue
        notified_at = _parse_db_time(row.get("notified_at"))
        if notified_at and datetime.now(timezone("UTC")) - notified_at < timedelta(hours=MIN_INTERVAL_HOURS):
            skipped += 1
            continue
        if row.get("sent_day") == day_key and int(row.get("sent_today") or 0) >= MAX_PER_DAY:
            skipped += 1
            continue
        if scope == "overall":
            target = pending_place - 1 if pending_place and pending_place > 1 else None
            gap = round(float(ranking[target - 1]["total"]) - new_total, 1) if target and len(ranking) >= target else None
            text = _build_message(notified_place, pending_place, new_total, row.get("pending_rival"), gap, target)
        else:
            text = _build_discipline_message(scope, notified_place, pending_place)
        try:
            await bot.send_message(telegram_id, text)
        except TelegramForbiddenError:
            await mark_standings_notified(telegram_id, pending_place, new_total, day_key, scope, delivered=False)
            skipped += 1
            continue
        except Exception as exc:
            logger.info("Не удалось отправить уведомление о зачёте: %s", exc)
            skipped += 1
            # Временная ошибка не означает доставку: следующая джоба
            # повторит попытку и заново проверит актуальность места.
            continue
        else:
            sent += 1
        await mark_standings_notified(telegram_id, pending_place, new_total, day_key, scope)
    return {"ok": True, "status": "done", "sent": sent, "skipped": skipped}


@_serialized
async def initialize_standings_baselines(snapshot=None, force: bool = False) -> None:
    snapshot = snapshot or await load_month_snapshot(*month_bounds())
    month_key = snapshot.month_key
    await reset_standings_state_for_new_month(month_key)
    rankings = _snapshot_rankings(snapshot)
    for name in set(await get_all_disciplines()) | set(CLASS_LADDER):
        rankings.setdefault(f"class:{canonical_class_name(name)}", [])
    for scope, ranking in rankings.items():
        if force or not await get_setting(f"standings_v3_baseline:{month_key}:{scope}"):
            await set_standings_baseline(month_key, _places_from_ranking(ranking), scope)


async def rebaseline_standings(month_key: str, ranking: list[dict]) -> None:
    """Существующая смена эталона обновляет все зачёты без рассылки."""
    await initialize_standings_baselines(force=True)


@_serialized
async def refresh_standings_after_lap(bot) -> None:
    try:
        snapshot = await load_month_snapshot(*month_bounds())
        for scope, ranking in _snapshot_rankings(snapshot).items():
            await record_standings_change(bot, snapshot.month_key, ranking, scope)
    except Exception:
        logger.exception("Не удалось обновить состояние уведомлений о зачёте")

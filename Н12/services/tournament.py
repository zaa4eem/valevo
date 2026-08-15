"""Турнирная система v2: живой рейтинг личного лучшего круга относительно
эталона класса, мгновенные переходы, релегация, общий призовой зачёт.

Ключевое отличие от "очков за место": балл класса пересчитывается на лету из
таблицы laps (никакая отдельная сущность "заезд/результат" не хранится) —
он всегда равен текущему личному лучшему кругу пилота за календарный месяц.
"""

from __future__ import annotations

import logging

from config import MOSCOW_TZ
from data.tournament import (
    CLASS_LADDER,
    MAIN_SEQUENCE,
    NEWCOMER_BONUS_POINTS,
    RELEGATION_BOTTOM_SHARE,
    class_score,
    classes_gating_promotion,
    min_starts_for_class,
    month_bounds as _month_bounds,
    next_main_class,
)
from database.db import (
    get_class_benchmark,
    get_pilot_class,
    set_pilot_class,
    get_pilot_month_best,
    get_month_participants,
    get_all_pilot_classes,
    is_first_active_month,
    update_pilot_rating,
)
from services.achievements import check_achievements_after_lap, check_achievements_month_end

logger = logging.getLogger(__name__)

PROMOTION_RATING_BONUS = 10


def month_bounds() -> tuple[str, str, str]:
    """(ключ_месяца, начало_ISO, начало_следующего_месяца_ISO) по московскому времени."""
    return _month_bounds(moscow_tz_name=MOSCOW_TZ)


async def live_class_score(telegram_id: int, class_name: str, month_key: str, start_iso: str, end_iso: str) -> dict:
    """Текущий живой результат пилота в классе за месяц."""
    benchmark = await get_class_benchmark(class_name, month_key)
    best_ms, starts = await get_pilot_month_best(telegram_id, class_name, start_iso, end_iso)
    min_starts = min_starts_for_class(class_name)

    qualifies = starts >= min_starts and best_ms is not None and benchmark is not None
    score = class_score(best_ms, benchmark["benchmark_ms"]) if (qualifies and benchmark) else None

    if qualifies and score is not None and class_name == "MX-5":
        if await is_first_active_month(telegram_id, start_iso):
            score = min(130, score + NEWCOMER_BONUS_POINTS)

    return {
        "class_name": class_name,
        "best_ms": best_ms,
        "starts": starts,
        "qualifies": qualifies,
        "score": score,
        "benchmark": benchmark,
        "min_starts": min_starts,
    }


async def overall_monthly_total(telegram_id: int, month_key: str, start_iso: str, end_iso: str) -> tuple[float, list[dict]]:
    """Общий взвешенный зачёт месяца — сумма (баллы × вес) по всем классам,
    где выполнен минимум стартов. Возвращает (итог, детали по классам)."""
    total = 0.0
    breakdown = []
    for class_name, cfg in CLASS_LADDER.items():
        result = await live_class_score(telegram_id, class_name, month_key, start_iso, end_iso)
        if result["qualifies"] and result["score"] is not None:
            weighted = result["score"] * cfg["weight"]
            total += weighted
            breakdown.append({**result, "weight": cfg["weight"], "weighted": weighted})
    return round(total, 1), breakdown


async def month_participant_ids(start_iso: str, end_iso: str) -> set[int]:
    """Все, у кого есть хоть один круг в любом классе за месяц, плюс все, у
    кого сейчас закреплён класс (чтобы релегация видела и совсем неактивных)."""
    participant_ids: set[int] = set((await get_all_pilot_classes()).keys())
    for class_name in CLASS_LADDER:
        for row in await get_month_participants(class_name, start_iso, end_iso):
            participant_ids.add(row["telegram_id"])
    return participant_ids


async def rank_month_overall(month_key: str, start_iso: str, end_iso: str) -> list[dict]:
    """Общий зачёт месяца по всем участникам, отсортированный от 1-го места.

    Каждый элемент: {telegram_id, total, breakdown}. Используется и для выплаты
    призов, и для витрины в лидерборде/ТВ-табло, и для проверки ачивок.
    """
    totals = []
    for telegram_id in await month_participant_ids(start_iso, end_iso):
        total, breakdown = await overall_monthly_total(telegram_id, month_key, start_iso, end_iso)
        if total > 0:
            totals.append({"telegram_id": telegram_id, "total": total, "breakdown": breakdown})
    totals.sort(key=lambda row: row["total"], reverse=True)
    return totals


async def month_qualified_participant_ids(start_iso: str, end_iso: str) -> set[int]:
    """Кто выполнил минимум стартов хотя бы в одном классе за месяц (приз за участие)."""
    qualified: set[int] = set()
    for class_name in CLASS_LADDER:
        min_starts = min_starts_for_class(class_name)
        for row in await get_month_participants(class_name, start_iso, end_iso):
            if row["starts"] >= min_starts:
                qualified.add(row["telegram_id"])
    return qualified


async def check_and_process_promotion(telegram_id: int, discipline_name: str, bot=None) -> str | None:
    """Вызывается после каждого засчитанного круга. Если это повлияло на переход —
    выполняет его и уведомляет пилота. Возвращает название нового класса или None."""
    if discipline_name not in CLASS_LADDER:
        return None

    current_class = await get_pilot_class(telegram_id)
    gating = classes_gating_promotion(current_class)
    if discipline_name not in gating:
        return None

    target = next_main_class(current_class)
    if target is None:
        return None

    month_key, start_iso, end_iso = month_bounds()

    for candidate_class in gating:
        cfg = CLASS_LADDER[candidate_class]
        threshold = cfg["threshold"]
        if threshold is None:
            continue
        result = await live_class_score(telegram_id, candidate_class, month_key, start_iso, end_iso)
        if result["qualifies"] and result["score"] is not None and result["score"] >= threshold:
            await set_pilot_class(telegram_id, target, month_key)
            try:
                await update_pilot_rating(telegram_id, PROMOTION_RATING_BONUS)
            except Exception:
                logger.exception("Не удалось начислить рейтинг за переход пилоту %s", telegram_id)

            if bot is not None:
                try:
                    await bot.send_message(
                        telegram_id,
                        f"🏁 <b>НОВЫЙ КЛАСС ОТКРЫТ!</b>\n\n"
                        f"Вы прошли <b>{candidate_class}</b> ({result['score']} баллов, "
                        f"{result['starts']} стартов) и переходите в <b>{target}</b>!\n\n"
                        f"📈 Рейтинг: +{PROMOTION_RATING_BONUS}",
                    )
                except Exception:
                    logger.warning("Не удалось уведомить пилота %s о переходе", telegram_id)

            try:
                await check_achievements_after_lap(
                    telegram_id, discipline_name, bot, promoted_to=target,
                )
            except Exception:
                logger.exception("Ошибка проверки ачивок после перехода пилота %s", telegram_id)

            return target

    return None


async def run_monthly_relegation(bot=None) -> None:
    """Понижает нижние RELEGATION_BOTTOM_SHARE каждого класса (кроме входного),
    исключая тех, кто перешёл в этот класс в текущем месяце. Вызывается из
    общей ежемесячной джобы закрытия сезона."""
    month_key, start_iso, end_iso = month_bounds()
    all_classes = await get_all_pilot_classes()

    for index, class_name in enumerate(MAIN_SEQUENCE):
        if index == 0:
            continue  # входной класс не релегируется

        previous_class = MAIN_SEQUENCE[index - 1]
        cohort = [tid for tid, cls in all_classes.items() if cls == class_name]
        if len(cohort) < 3:
            continue  # слишком маленькая выборка — релегация не имеет смысла

        scored: list[tuple[int, float]] = []
        for telegram_id in cohort:
            result = await live_class_score(telegram_id, class_name, month_key, start_iso, end_iso)
            score = result["score"] if (result["qualifies"] and result["score"] is not None) else -1
            scored.append((telegram_id, score))

        scored.sort(key=lambda pair: pair[1])
        bottom_count = max(1, round(len(scored) * RELEGATION_BOTTOM_SHARE))

        demoted = 0
        for telegram_id, _score in scored:
            if demoted >= bottom_count:
                break
            db_row_month = None
            try:
                from database.db import get_db
                db = await get_db()
                cursor = await db.execute(
                    "SELECT promoted_month_key FROM pilot_class_status WHERE telegram_id = ?",
                    (telegram_id,),
                )
                row = await cursor.fetchone()
                await cursor.close()
                await db.close()
                db_row_month = row[0] if row else None
            except Exception:
                logger.exception("Не удалось проверить месяц перехода пилота %s", telegram_id)

            if db_row_month == month_key:
                continue  # перешёл сюда в этом же месяце — защищён от релегации

            await set_pilot_class(telegram_id, previous_class, None)
            demoted += 1
            if bot is not None:
                try:
                    await bot.send_message(
                        telegram_id,
                        f"⚠️ <b>ПОНИЖЕНИЕ КЛАССА</b>\n\n"
                        f"По итогам месяца результат в <b>{class_name}</b> оказался в нижней части "
                        f"таблицы — переводим обратно в <b>{previous_class}</b>. "
                        f"Новый месяц — новый шанс подняться!",
                    )
                except Exception:
                    logger.warning("Не удалось уведомить пилота %s о понижении", telegram_id)

    try:
        await check_achievements_month_end(bot)
    except Exception:
        logger.exception("Ошибка проверки ачивок по итогам месяца")

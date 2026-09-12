"""Живые очки турнира: эталон, место и один вклад каждой парной группы."""

from __future__ import annotations

import logging

from config import MOSCOW_TZ, SEASON_CLOSE_DAY, SEASON_CLOSE_HOUR, SEASON_CLOSE_MINUTE
from data.tournament import (
    CLASS_LADDER,
    MAIN_SEQUENCE,
    PAIR_BONUSES,
    canonical_class_name,
    position_multiplier,
    RELEGATION_BOTTOM_SHARE,
    class_score,
    classes_gating_promotion,
    min_starts_for_class,
    month_bounds as _month_bounds,
    previous_month_bounds as _previous_month_bounds,
    next_main_class,
)
from database.db import (
    get_all_class_benchmarks,
    get_month_tournament_bests,
    get_all_promoted_months,
    get_pilot_class,
    get_setting,
    set_pilot_class,
    set_setting,
    get_month_participants,
    get_all_pilot_classes,
    claim_pilot_promotion,
    update_pilot_rating,
)
from services.achievements import check_achievements_month_end

logger = logging.getLogger(__name__)

PROMOTION_RATING_BONUS = 10


def month_bounds() -> tuple[str, str, str]:
    """(ключ_сезона, начало_ISO, конец_ISO) для идущего сейчас сезона.

    Сезон — интервал между двумя закрытиями (по регламенту 20-е 18:00 МСК),
    а не календарный месяц. Момент закрытия берётся из конфига, чтобы дата
    закрытия и границы зачёта не могли разойтись.
    """
    return _month_bounds(
        moscow_tz_name=MOSCOW_TZ,
        close_day=SEASON_CLOSE_DAY,
        close_hour=SEASON_CLOSE_HOUR,
        close_minute=SEASON_CLOSE_MINUTE,
    )


def closing_season_bounds() -> tuple[str, str, str]:
    """(ключ, начало, конец) сезона, который закрывается прямо сейчас."""
    return _previous_month_bounds(
        moscow_tz_name=MOSCOW_TZ,
        close_day=SEASON_CLOSE_DAY,
        close_hour=SEASON_CLOSE_HOUR,
        close_minute=SEASON_CLOSE_MINUTE,
    )


def class_rank_key(score: int, best_ms: int | None, telegram_id: int) -> tuple:
    """Места определяет время круга; при равенстве сохраняем стабильный порядок."""
    return (best_ms if best_ms is not None else float("inf"), telegram_id)


class MonthSnapshot:
    """Один снимок результатов сезона для бота, профиля, ТВ и уведомлений."""

    def __init__(self, month_key, start_iso, end_iso, benchmarks, bests, participants, tracks):
        self.month_key = month_key
        self.start_iso = start_iso
        self.end_iso = end_iso
        self.benchmarks = benchmarks
        self.bests = bests
        self.participants = participants
        self.tracks = tracks
        self._positions = {}
        for class_name in {name for _tid, name in bests}:
            times = [(tid, best) for (tid, name), (best, _starts) in bests.items()
                     if name == class_name and best is not None and best > 0]
            times.sort(key=lambda row: class_rank_key(0, row[1], row[0]))
            self._positions[class_name] = {tid: place for place, (tid, _best) in enumerate(times, 1)}

    def class_score_for(self, telegram_id: int, class_name: str) -> dict:
        class_name = canonical_class_name(class_name)
        benchmark = self.benchmarks.get(class_name)
        best_ms, starts = self.bests.get((telegram_id, class_name), (None, 0))
        minimum = min_starts_for_class(class_name)
        benchmark_ms = (benchmark or {}).get("benchmark_ms")
        qualifies = bool(class_name in CLASS_LADDER and starts >= minimum
                         and best_ms and benchmark_ms and 0 < best_ms <= benchmark_ms)
        place = self._positions.get(class_name, {}).get(telegram_id)
        coefficient = position_multiplier(place) if qualifies else 1.0
        score = class_score(best_ms, benchmark_ms, class_name, place) if benchmark else None
        return {
            "class_name": class_name, "best_ms": best_ms, "starts": starts,
            "qualifies": qualifies, "score": score, "benchmark": benchmark,
            "min_starts": minimum, "place": place, "coefficient": coefficient,
            "base_score": CLASS_LADDER.get(class_name, {}).get("base", 0),
            "track": self.tracks.get(class_name, ""),
        }

    def overall_for(self, telegram_id: int) -> tuple[int, list[dict]]:
        total = 0
        breakdown = []
        for main in MAIN_SEQUENCE:
            members = classes_gating_promotion(main)
            passed = [self.class_score_for(telegram_id, name) for name in members]
            passed = [result for result in passed if result["qualifies"]]
            if not passed:
                continue
            # max сохраняет порядок группы при равных коэффициентах.
            best = max(passed, key=lambda result: result["coefficient"])
            base = CLASS_LADDER[main]["base"]
            pair_bonus = PAIR_BONUSES.get(main, 0) if len(passed) == len(members) else 0
            points = round(base * best["coefficient"]) + pair_bonus
            total += points
            breakdown.append({
                "group": main, "class_name": " / ".join(r["class_name"] for r in passed),
                "source_class": best["class_name"], "score": base,
                "coefficient": best["coefficient"], "pair_bonus": pair_bonus,
                "weighted": points, "points": points, "members": passed,
            })
        return total, breakdown

    def overall_ranking(self) -> list[dict]:
        rows = []
        for tid in self.participants:
            total, breakdown = self.overall_for(tid)
            if total > 0:
                rows.append({"telegram_id": tid, "total": total, "breakdown": breakdown})
        rows.sort(key=lambda row: (-row["total"], row["telegram_id"]))
        return rows

    def discipline_rankings(self) -> dict[str, list[dict]]:
        rankings = {}
        for class_name, positions in self._positions.items():
            rankings[class_name] = [
                {"telegram_id": tid, "total": result["score"] or 0, **result}
                for tid in positions
                for result in [self.class_score_for(tid, class_name)]
            ]
        return rankings


async def load_month_snapshot(month_key: str, start_iso: str, end_iso: str) -> MonthSnapshot:
    benchmarks = await get_all_class_benchmarks(month_key)
    bests, tracks = await get_month_tournament_bests(start_iso, end_iso, benchmarks)
    participants = set((await get_all_pilot_classes()).keys()) | {tid for tid, _name in bests}
    return MonthSnapshot(month_key, start_iso, end_iso, benchmarks, bests, participants, tracks)


async def live_class_score(telegram_id: int, class_name: str, month_key: str, start_iso: str, end_iso: str) -> dict:
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    return snapshot.class_score_for(telegram_id, class_name)


async def overall_monthly_total(telegram_id: int, month_key: str, start_iso: str, end_iso: str) -> tuple[int, list[dict]]:
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    return snapshot.overall_for(telegram_id)


async def month_participant_ids(start_iso: str, end_iso: str) -> set[int]:
    participant_ids = set((await get_all_pilot_classes()).keys())
    for name in CLASS_LADDER:
        for row in await get_month_participants(name, start_iso, end_iso):
            if row["telegram_id"] is not None:
                participant_ids.add(row["telegram_id"])
    return participant_ids


async def rank_month_overall(month_key: str, start_iso: str, end_iso: str) -> list[dict]:
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    return snapshot.overall_ranking()


async def month_qualified_participant_ids(start_iso: str, end_iso: str) -> set[int]:
    # Приз за участие сохраняет прежнее условие: хотя бы один принятый круг.
    qualified = set()
    for name in CLASS_LADDER:
        for row in await get_month_participants(name, start_iso, end_iso):
            if row["telegram_id"] is not None and row["starts"] >= min_starts_for_class(name):
                qualified.add(row["telegram_id"])
    return qualified


async def check_and_process_promotion(telegram_id: int, discipline_name: str, bot=None) -> str | None:
    discipline_name = canonical_class_name(discipline_name)
    if discipline_name not in CLASS_LADDER:
        return None
    current_class = await get_pilot_class(telegram_id)
    gating = classes_gating_promotion(current_class)
    if discipline_name not in gating:
        return None
    target = next_main_class(current_class)
    if target is None:
        return None
    snapshot = await load_month_snapshot(*month_bounds())
    for name in gating:
        result = snapshot.class_score_for(telegram_id, name)
        if not result["qualifies"]:
            continue
        if not await claim_pilot_promotion(
            telegram_id, current_class, target, snapshot.month_key, PROMOTION_RATING_BONUS,
        ):
            return None
        if bot is not None:
            try:
                await bot.send_message(
                    telegram_id,
                    f"🏁 <b>НОВЫЙ КЛАСС ОТКРЫТ!</b>\n\n"
                    f"Вы прошли эталон <b>{name}</b> и переходите в <b>{target}</b>!\n\n"
                    f"📈 Рейтинг: +{PROMOTION_RATING_BONUS}",
                )
            except Exception:
                logger.warning("Не удалось уведомить пилота %s о переходе", telegram_id)
        return target
    return None


async def run_monthly_relegation(bot=None, bounds: tuple[str, str, str] | None = None) -> None:
    """Понижает нижние RELEGATION_BOTTOM_SHARE каждого класса (кроме входного),
    исключая тех, кто перешёл в этот класс в закрываемом месяце. Вызывается из
    общей ежемесячной джобы закрытия сезона.

    Операция защищена от повторного выполнения флагом в bot_settings. Это
    критично: награды защищены таблицей season_awards, а релегация раньше не
    была защищена ничем — и при каждом перезапуске бота в день закрытия
    (main.py догоняет пропущенное закрытие при старте) понижалась ещё одна
    порция пилотов. Три перезапуска подряд = три волны понижений.
    """
    month_key, start_iso, end_iso = bounds or month_bounds()

    guard_key = f"relegation_done:{month_key}"
    if await get_setting(guard_key):
        logger.info("Релегация за %s уже выполнялась — пропускаю", month_key)
        return
    # Флаг ставим ДО работы: если процесс упадёт в середине, повторный запуск
    # не станет понижать вторую волну поверх первой. Разобрать частичную
    # релегацию руками безопаснее, чем понизить лишних людей автоматически.
    await set_setting(guard_key, "1")

    all_classes = await get_all_pilot_classes()
    promoted_months = await get_all_promoted_months()
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)

    for index, class_name in enumerate(MAIN_SEQUENCE):
        if index == 0:
            continue  # входной класс не релегируется

        previous_class = MAIN_SEQUENCE[index - 1]
        cohort = [tid for tid, cls in all_classes.items() if cls == class_name]
        if len(cohort) < 3:
            continue  # слишком маленькая выборка — релегация не имеет смысла

        scored: list[tuple[int, float, int | None]] = []
        for telegram_id in cohort:
            result = snapshot.class_score_for(telegram_id, class_name)
            score = result["score"] if (result["qualifies"] and result["score"] is not None) else -1
            scored.append((telegram_id, score, result["best_ms"]))

        # Снизу вверх: сначала худший балл, при равенстве — тот, у кого круг
        # медленнее (-best_ms по возрастанию ставит больший круг первым).
        # Без тай-брейка по кругу выбор "кого понизить" при равных баллах был
        # случайным (порядок из set), а цена ошибки здесь выше, чем у бонуса
        # за место: пилота реально понижают в классе.
        scored.sort(key=lambda row: (row[1], -(row[2] if row[2] is not None else 0), row[0]))
        bottom_count = max(1, round(len(scored) * RELEGATION_BOTTOM_SHARE))

        demoted = 0
        for telegram_id, _score, _best_ms in scored:
            if demoted >= bottom_count:
                break
            db_row_month = promoted_months.get(telegram_id)

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
        await check_achievements_month_end(bot, bounds=(month_key, start_iso, end_iso))
    except Exception:
        logger.exception("Ошибка проверки ачивок по итогам месяца")

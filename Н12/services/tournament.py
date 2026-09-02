"""Турнирная система v2: живой рейтинг личного лучшего круга относительно
эталона класса, мгновенные переходы, релегация, общий призовой зачёт.

Ключевое отличие от "очков за место": балл класса пересчитывается на лету из
таблицы laps (никакая отдельная сущность "заезд/результат" не хранится) —
он всегда равен текущему личному лучшему кругу пилота за календарный месяц.
"""

from __future__ import annotations

import logging

from config import MOSCOW_TZ, SEASON_CLOSE_DAY, SEASON_CLOSE_HOUR, SEASON_CLOSE_MINUTE
from data.tournament import (
    CLASS_LADDER,
    MAIN_SEQUENCE,
    NEWCOMER_BONUS_POINTS,
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
    get_all_month_bests,
    get_all_promoted_months,
    get_class_benchmark,
    get_pilot_class,
    get_pilots_active_before,
    get_setting,
    set_pilot_class,
    set_setting,
    get_pilot_month_best,
    get_month_participants,
    get_all_pilot_classes,
    is_first_active_month,
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


# Бонус за место в личном зачёте класса среди тех, кто выполнил зачёт в этом
# классе в этом месяце — 1-е место, 2-е, 3-е. Дальше без бонуса. Считается
# заново при каждом обращении к рангу класса (никаких сохранённых событий
# "обогнал/обогнали") — обогнали кого-то и заняли его место, бонус в общем
# зачёте сразу перешёл к вам, а не остался висеть у прежнего лидера. Это то,
# что делает общий зачёт "плавающим" не только от своего личного времени, но
# и от того, где вы сейчас относительно других — не влияет на порог перехода
# класса (это отдельная, "чистая" метрика скорости против эталона).
POSITION_BONUS_BY_RANK = {1: 10, 2: 6, 3: 3}


def class_rank_key(score: int, best_ms: int | None, telegram_id: int) -> tuple:
    """Ключ сортировки личного зачёта класса — единый для бонусов за место,
    таблицы лидеров и ТВ-табло, чтобы медали и бонусы не расходились.

    Порядок: балл по убыванию → фактический круг по возрастанию → telegram_id.

    Тай-брейк по кругу обязателен из-за потолка шкалы: class_score обрезан
    сверху 130 баллами, поэтому при мягком эталоне весь класс легко упирается
    в одно и то же число (в реальной таблице клуба так и вышло: четыре пилота
    по 130 в MX-5). Раньше сортировка шла только по баллу, а исходный список
    приходил из set() — при равенстве баллов порядок определялся хешами
    telegram_id, и бонусы +10/+6/+3 доставались фактически случайным людям,
    а не тем, кто быстрее. Теперь при равных баллах выше тот, у кого реально
    быстрее круг; telegram_id в конце — только чтобы результат был
    воспроизводимым при полностью идентичных временах.
    """
    return (-score, best_ms if best_ms is not None else float("inf"), telegram_id)


async def class_position_bonuses(class_name: str, month_key: str, start_iso: str, end_iso: str) -> dict[int, int]:
    """{telegram_id: бонус} для всех, кто сейчас в зачёте этого класса, по
    текущему ранжированию среди них же (не среди всех пилотов клуба)."""
    participants = await month_participant_ids(start_iso, end_iso)
    scored: list[tuple[int, int, int | None]] = []
    for telegram_id in participants:
        result = await live_class_score(telegram_id, class_name, month_key, start_iso, end_iso)
        if result["qualifies"] and result["score"] is not None:
            scored.append((telegram_id, result["score"], result["best_ms"]))
    scored.sort(key=lambda row: class_rank_key(row[1], row[2], row[0]))
    return {
        telegram_id: POSITION_BONUS_BY_RANK.get(rank, 0)
        for rank, (telegram_id, _score, _best_ms) in enumerate(scored, start=1)
    }


async def overall_monthly_total(
    telegram_id: int,
    month_key: str,
    start_iso: str,
    end_iso: str,
    position_bonuses: dict[str, dict[int, int]] | None = None,
) -> tuple[float, list[dict]]:
    """Общий взвешенный зачёт месяца — сумма ((баллы класса + бонус за место в
    классе) × вес) по всем классам, где выполнен минимум стартов.

    position_bonuses — необязательный предпосчитанный {класс: {telegram_id: бонус}}.
    rank_month_overall считает его один раз на класс и передаёт сюда, чтобы не
    пересчитывать ранжирование класса для каждого участника отдельно (было бы
    O(участники²) на весь общий зачёт). При одиночном вызове (например, для
    одного пилота из профиля) считается на лету для каждого класса.
    """
    total = 0.0
    breakdown = []
    for class_name, cfg in CLASS_LADDER.items():
        result = await live_class_score(telegram_id, class_name, month_key, start_iso, end_iso)
        if result["qualifies"] and result["score"] is not None:
            if position_bonuses is not None:
                bonus = position_bonuses.get(class_name, {}).get(telegram_id, 0)
            else:
                class_bonuses = await class_position_bonuses(class_name, month_key, start_iso, end_iso)
                bonus = class_bonuses.get(telegram_id, 0)
            effective_score = result["score"] + bonus
            weighted = effective_score * cfg["weight"]
            total += weighted
            breakdown.append({
                **result,
                "position_bonus": bonus,
                "weight": cfg["weight"],
                "weighted": weighted,
            })
    return round(total, 1), breakdown


class MonthSnapshot:
    """Все данные месяца, прочитанные из БД за фиксированное число запросов.

    Существует ради общего зачёта. Раньше rank_month_overall считал каждую
    (пилот, класс) пару ДВАЖДЫ — один раз внутри class_position_bonuses ради
    бонуса за место и ещё раз внутри overall_monthly_total ради итога — и
    каждый такой расчёт открывал 2-3 отдельных соединения к SQLite (в этом
    проекте каждая функция БД открывает своё). Итого порядка 36×N соединений
    на один полный зачёт, и ТВ-табло запрашивало его каждые 30 секунд.

    Здесь те же данные читаются четырьмя запросами независимо от числа
    пилотов, а вся арифметика идёт в памяти. Логика расчёта не меняется:
    class_score_for повторяет live_class_score один в один, включая бонус
    новичка и порядок тай-брейка.
    """

    def __init__(
        self,
        month_key: str,
        start_iso: str,
        end_iso: str,
        benchmarks: dict[str, dict],
        bests: dict[tuple[int, str], tuple[int | None, int]],
        veterans: set[int],
        participants: set[int],
    ) -> None:
        self.month_key = month_key
        self.start_iso = start_iso
        self.end_iso = end_iso
        self.benchmarks = benchmarks
        self.bests = bests
        self.veterans = veterans
        self.participants = participants

    def class_score_for(self, telegram_id: int, class_name: str) -> dict:
        """Точный аналог live_class_score, но без единого запроса к БД."""
        benchmark = self.benchmarks.get(class_name)
        best_ms, starts = self.bests.get((telegram_id, class_name), (None, 0))
        min_starts = min_starts_for_class(class_name)

        qualifies = starts >= min_starts and best_ms is not None and benchmark is not None
        score = class_score(best_ms, benchmark["benchmark_ms"]) if (qualifies and benchmark) else None

        if qualifies and score is not None and class_name == "MX-5":
            if telegram_id not in self.veterans:
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

    def position_bonuses(self, class_name: str) -> dict[int, int]:
        """Бонусы за место в личном зачёте класса — тот же ключ сортировки,
        что и в class_position_bonuses/таблице лидеров."""
        scored: list[tuple[int, int, int | None]] = []
        for telegram_id in self.participants:
            result = self.class_score_for(telegram_id, class_name)
            if result["qualifies"] and result["score"] is not None:
                scored.append((telegram_id, result["score"], result["best_ms"]))
        scored.sort(key=lambda row: class_rank_key(row[1], row[2], row[0]))
        return {
            telegram_id: POSITION_BONUS_BY_RANK.get(rank, 0)
            for rank, (telegram_id, _score, _best_ms) in enumerate(scored, start=1)
        }


async def load_month_snapshot(month_key: str, start_iso: str, end_iso: str) -> MonthSnapshot:
    """Читает месяц из БД за четыре запроса вместо десятков на пилота."""
    benchmarks = await get_all_class_benchmarks(month_key)
    bests = await get_all_month_bests(start_iso, end_iso)
    veterans = await get_pilots_active_before(start_iso)

    # Участники: у кого есть круг в турнирном классе за месяц + все, у кого
    # закреплён класс (чтобы релегация видела и совсем неактивных).
    participants: set[int] = set((await get_all_pilot_classes()).keys())
    for (telegram_id, discipline) in bests:
        if discipline in CLASS_LADDER:
            participants.add(telegram_id)

    return MonthSnapshot(
        month_key=month_key,
        start_iso=start_iso,
        end_iso=end_iso,
        benchmarks=benchmarks,
        bests=bests,
        veterans=veterans,
        participants=participants,
    )


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

    Считается по снимку месяца (четыре запроса к БД), а не построчными
    запросами на каждую пару (пилот, класс) — арифметика и результат при этом
    ровно те же, что и у live_class_score/class_position_bonuses.
    """
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    position_bonuses = {
        class_name: snapshot.position_bonuses(class_name)
        for class_name in CLASS_LADDER
    }

    totals = []
    for telegram_id in snapshot.participants:
        total = 0.0
        breakdown = []
        for class_name, cfg in CLASS_LADDER.items():
            result = snapshot.class_score_for(telegram_id, class_name)
            if not (result["qualifies"] and result["score"] is not None):
                continue
            bonus = position_bonuses.get(class_name, {}).get(telegram_id, 0)
            weighted = (result["score"] + bonus) * cfg["weight"]
            total += weighted
            breakdown.append({
                **result,
                "position_bonus": bonus,
                "weight": cfg["weight"],
                "weighted": weighted,
            })
        total = round(total, 1)
        if total > 0:
            totals.append({"telegram_id": telegram_id, "total": total, "breakdown": breakdown})
    # telegram_id вторым ключом — исключительно ради воспроизводимости: без него
    # порядок пилотов с одинаковым итогом менялся от вызова к вызову (список
    # строится из set()), и общий зачёт мог "прыгать" местами сам по себе,
    # порождая ложные уведомления о смещении в топ-5.
    totals.sort(key=lambda row: (-row["total"], row["telegram_id"]))
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
    выполняет его и уведомляет пилота. Возвращает название нового класса или None.

    Ачивки здесь не проверяет — это отдельная забота вызывающего хендлера,
    который зовёт check_achievements_after_lap ровно один раз на круг и
    передаёт туда наш результат через promoted_to (см. handlers/admin.py,
    handlers/time_requests.py)."""
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

            # Ачивки здесь НЕ проверяем: вызывающий хендлер всё равно зовёт
            # check_achievements_after_lap сразу после нас и передаёт туда
            # возвращённый target через promoted_to. Раньше проверка шла и
            # здесь, и там — весь набор проверок (около 30 запросов к БД)
            # выполнялся дважды на каждый круг, открывающий класс, а второй
            # проход гарантированно не находил ничего нового.
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

"""Правила турнирных очков VALEVO: базы, парные группы и множители топ-7."""

from __future__ import annotations

from datetime import datetime

from pytz import timezone

# Формат, в котором SQLite хранит created_at (DEFAULT CURRENT_TIMESTAMP): naive
# UTC "YYYY-MM-DD HH:MM:SS", разделитель — пробел, без микросекунд и без
# оффсета. Любая граница, которую мы подставляем в SQL для сравнения с
# created_at, обязана быть строкой ровно этого вида: сравнение идёт строковое,
# и первый же несовпадающий символ решает всё. Использование datetime.isoformat()
# ("...T10:00:00") давало разделитель 'T' (0x54) против пробела (0x20) в базе —
# из-за этого ЛЮБАЯ запись того же дня оказывалась "раньше" границы,
# независимо от часа (см. историю бага с ачивкой "Первопроходец").
SQL_TS_FMT = "%Y-%m-%d %H:%M:%S"


def sql_timestamp(moment: datetime) -> str:
    """Приводит datetime к строке в том же виде, в котором created_at лежит в
    SQLite. Aware-время переводится в UTC, naive считается уже UTC."""
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone("UTC"))
    return moment.strftime(SQL_TS_FMT)

# Согласованная система: одна база на группу, лучший множитель за место,
# затем фиксированный бонус за прохождение обеих дисциплин.
SCORING_VERSION = "v3_2026_09_top7"
RELEGATION_BOTTOM_SHARE = 0.15
POSITION_MULTIPLIERS = {1: 2.0, 2: 1.9, 3: 1.8, 4: 1.7, 5: 1.6, 6: 1.5, 7: 1.4}
CLASS_LADDER: dict[str, dict] = {
    "MX-5": {"base": 100, "side_of": None, "min_starts": 1},
    "GT500": {"base": 110, "side_of": None, "min_starts": 1},
    "F4/ALL": {"base": 110, "side_of": "GT500", "min_starts": 1},
    "DTM": {"base": 120, "side_of": None, "min_starts": 1},
    "Touge": {"base": 120, "side_of": "DTM", "min_starts": 1},
    "GT3": {"base": 130, "side_of": None, "min_starts": 1},
}
MAIN_SEQUENCE = ["MX-5", "GT500", "DTM", "GT3"]
SIDE_DISCIPLINES = {"GT500": ["F4/ALL"], "DTM": ["Touge"]}
PAIR_BONUSES = {"GT500": 20, "DTM": 30}
DEFAULT_MIN_STARTS = 1


def canonical_class_name(name: str) -> str:
    value = str(name or "").strip()
    aliases = {
        "MX5": "MX-5", "MX-5": "MX-5", "MIATA": "MX-5",
        "GT500": "GT500", "GT-500": "GT500", "GT3": "GT3", "GT-3": "GT3",
        "DTM": "DTM", "TOGE": "Touge", "TOUGE": "Touge", "TOGUE": "Touge",
        "F4/ALL": "F4/ALL", "F4": "F4/ALL", "ALL": "F4/ALL",
        "F1": "F4/ALL", "FORMULA": "F4/ALL", "FORMULA 1": "F4/ALL",
        "ОТКРЫТЫЕ КОЛЕСА": "F4/ALL", "ОТКРЫТЫЕ КОЛЁСА": "F4/ALL",
        "WEEK CUP": "Week CUP", "WEEKCUP": "Week CUP", "WEEK_CUP": "Week CUP", "WEEK": "Week CUP",
    }
    return aliases.get(value.upper(), value)


def min_starts_for_class(class_name: str) -> int:
    return CLASS_LADDER.get(canonical_class_name(class_name), {}).get("min_starts", DEFAULT_MIN_STARTS)


def position_multiplier(place: int | None) -> float:
    return POSITION_MULTIPLIERS.get(place, 1.0)


def next_main_class(current_class: str) -> str | None:
    current_class = canonical_class_name(current_class)
    main = CLASS_LADDER.get(current_class, {}).get("side_of") or current_class
    if main not in MAIN_SEQUENCE or main == MAIN_SEQUENCE[-1]:
        return None
    return MAIN_SEQUENCE[MAIN_SEQUENCE.index(main) + 1]


def classes_gating_promotion(current_class: str) -> list[str]:
    current_class = canonical_class_name(current_class)
    main = CLASS_LADDER.get(current_class, {}).get("side_of") or current_class
    return [main] + SIDE_DISCIPLINES.get(main, [])


def class_ladder_index(class_name: str) -> int | None:
    class_name = canonical_class_name(class_name)
    main = CLASS_LADDER.get(class_name, {}).get("side_of") or class_name
    return MAIN_SEQUENCE.index(main) if main in MAIN_SEQUENCE else None


def is_class_unlocked(current_class: str, discipline: str) -> bool:
    # Допуск определяется пройденной ступенью; множитель за место не позволяет
    # перескочить через непроходившийся класс.
    target = class_ladder_index(discipline)
    current = class_ladder_index(current_class)
    return target is None or target <= (current if current is not None else 0)


# Момент закрытия сезона по московскому времени. Сезон — это ровно интервал
# между двумя закрытиями, а не календарный месяц: закрытие 20-го в 18:00
# закрывает всё, что произошло с прошлого закрытия (20-го предыдущего месяца
# в 18:00). Так ни один день гонок не выпадает.
#
# Раньше закрытие стояло на 20-е, а зачёт считался по календарному месяцу
# (1-е → 1-е). Из-за расхождения круги с 21-го по конец месяца не попадали ни
# в одно закрытие: их календарный месяц был награждён 20-го, а следующее
# закрытие смотрело уже на следующий месяц. Десять-одиннадцать дней гонок
# каждый месяц не влияли ни на призы, ни на релегацию.
DEFAULT_CLOSE_DAY = 20
DEFAULT_CLOSE_HOUR = 18
DEFAULT_CLOSE_MINUTE = 0


def closing_moment(
    year: int,
    month: int,
    moscow_tz_name: str = "Europe/Moscow",
    close_day: int = DEFAULT_CLOSE_DAY,
    close_hour: int = DEFAULT_CLOSE_HOUR,
    close_minute: int = DEFAULT_CLOSE_MINUTE,
) -> datetime:
    """Момент закрытия сезона в указанном месяце (aware, МСК)."""
    moscow_tz = timezone(moscow_tz_name)
    naive = datetime(year, month, close_day, close_hour, close_minute)
    return moscow_tz.localize(naive)


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = (year * 12 + (month - 1)) + delta
    return index // 12, index % 12 + 1


def month_bounds(
    now: datetime | None = None,
    moscow_tz_name: str = "Europe/Moscow",
    close_day: int = DEFAULT_CLOSE_DAY,
    close_hour: int = DEFAULT_CLOSE_HOUR,
    close_minute: int = DEFAULT_CLOSE_MINUTE,
) -> tuple[str, str, str]:
    """(ключ_сезона, начало_ISO, конец_ISO) для СЕЙЧАС идущего сезона.

    Сезон длится от одного закрытия до следующего. Ключ сезона — месяц, в
    котором сезон закрывается ("2026-09" для сезона 20 августа → 20 сентября):
    так ключ совпадает с тем месяцем, в котором клуб выдаёт призы, и остаётся
    в прежнем формате "%Y-%m", поэтому эталоны, награды и ачивки продолжают
    работать без изменения схемы.

    Границы отдаются как naive UTC "YYYY-MM-DD HH:MM:SS" — ровно в том виде,
    в котором SQLite хранит laps.created_at (DEFAULT CURRENT_TIMESTAMP, тоже
    naive UTC). Раньше здесь отдавался ISO с московским оффсетом
    ("...T00:00:00+03:00") — все вызывающие сравнивают его строкой прямо в SQL
    (created_at >= ? AND created_at < ?), а строковое сравнение "2026-08-01
    05:00:00" (created_at) и "2026-08-01T00:00:00+03:00" (граница) расходится
    на первом же несовпадающем символе — разделителе ' ' против 'T' — раньше,
    чем на значащих цифрах времени. Из-за этого круги в первые/последние часы
    суток на границе сезона тихо попадали не в тот сезон.
    """
    moscow_tz = timezone(moscow_tz_name)
    now = now or datetime.now(moscow_tz)
    if now.tzinfo is None:
        now = moscow_tz.localize(now)
    now = now.astimezone(moscow_tz)

    this_close = closing_moment(
        now.year, now.month, moscow_tz_name, close_day, close_hour, close_minute,
    )

    if now < this_close:
        # Закрытие этого месяца ещё впереди — сезон закрывается им.
        end = this_close
        prev_year, prev_month = _shift_month(now.year, now.month, -1)
        start = closing_moment(
            prev_year, prev_month, moscow_tz_name, close_day, close_hour, close_minute,
        )
    else:
        # Закрытие уже прошло — идёт сезон, который закроется в следующем месяце.
        start = this_close
        next_year, next_month = _shift_month(now.year, now.month, 1)
        end = closing_moment(
            next_year, next_month, moscow_tz_name, close_day, close_hour, close_minute,
        )

    return end.strftime("%Y-%m"), sql_timestamp(start), sql_timestamp(end)


def previous_month_bounds(
    now: datetime | None = None,
    moscow_tz_name: str = "Europe/Moscow",
    close_day: int = DEFAULT_CLOSE_DAY,
    close_hour: int = DEFAULT_CLOSE_HOUR,
    close_minute: int = DEFAULT_CLOSE_MINUTE,
) -> tuple[str, str, str]:
    """Границы ЗАКРЫВАЕМОГО сезона — того, который заканчивается прямо сейчас.

    Вызывается из джобы закрытия. В момент закрытия (20-е, 18:00) month_bounds()
    уже отдаёт НОВЫЙ сезон, поэтому награждать надо предыдущий: интервал от
    закрытия прошлого месяца до этого закрытия.

    Джоба может сработать с задержкой (misfire_grace_time, догон при старте
    бота), поэтому "закрываемый сезон" определяется не как "сейчас минус
    секунда", а как последний сезон, чьё закрытие уже наступило.
    """
    moscow_tz = timezone(moscow_tz_name)
    now = now or datetime.now(moscow_tz)
    if now.tzinfo is None:
        now = moscow_tz.localize(now)
    now = now.astimezone(moscow_tz)

    this_close = closing_moment(
        now.year, now.month, moscow_tz_name, close_day, close_hour, close_minute,
    )

    if now >= this_close:
        end = this_close
    else:
        prev_year, prev_month = _shift_month(now.year, now.month, -1)
        end = closing_moment(
            prev_year, prev_month, moscow_tz_name, close_day, close_hour, close_minute,
        )

    before_year, before_month = _shift_month(end.year, end.month, -1)
    start = closing_moment(
        before_year, before_month, moscow_tz_name, close_day, close_hour, close_minute,
    )

    return end.strftime("%Y-%m"), sql_timestamp(start), sql_timestamp(end)


def class_score(personal_best_ms: int, benchmark_ms: int, class_name: str = "MX-5", place: int | None = None) -> int:
    """Очки за пройденный эталон; ниже топ-7 сохраняется базовое значение."""
    if not personal_best_ms or not benchmark_ms or personal_best_ms <= 0 or benchmark_ms <= 0:
        return 0
    if personal_best_ms > benchmark_ms:
        return 0
    base = CLASS_LADDER.get(canonical_class_name(class_name), {}).get("base", 0)
    return round(base * position_multiplier(place))

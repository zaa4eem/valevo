"""Статическая конфигурация турнирной системы v2 (живой рейтинг по эталону).

Числа (веса/пороги) — рабочие ориентиры под ~20 активных пилотов, взяты из
концепт-документа клуба. Не сакральные — можно поправить после первого
проведённого месяца без изменения самой механики.
"""

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

# Доля нижних мест в классе, понижаемых по итогам месяца (кроме входного класса
# и кроме тех, кто перешёл в этот класс в этом же месяце).
RELEGATION_BOTTOM_SHARE = 0.15

# Бонус за первый календарный месяц участия в MX-5.
NEWCOMER_BONUS_POINTS = 15

# (класс, вес в общем зачёте, порог перехода выше; None — финальный класс без порога,
#  side_of — если это доп.дисциплина, к какому основному классу она привязана,
#  min_starts — минимум стартов в этом классе за месяц, чтобы он засчитывался
#  в общий зачёт.
#
#  Раньше min_starts рос по ступеням (1/2/3/4) — идея была "чуть тяжелее с
#  каждым этапом". На практике это читалось как баг: пилот ставит первый круг
#  в новом классе (уже после эталона), а баллы в общий зачёт не идут, потому
#  что в BTCC/GT500/Touge/GT3 нужно 2-4 старта, а не 1 — очки выглядели
#  "неплавающими". "Чуть тяжелее с каждым этапом" и так обеспечено весом
#  класса (1.0 → 2.4) и растущим порогом перехода (80 → 100 → 110 → 120) —
#  дублировать это ещё и требованием нескольких стартов не нужно. Единый
#  минимум 1 старт на все классы — засчитывается в общий зачёт с первой же
#  гонки в любом классе, как и было изначально задумано для всей лестницы,
#  не только для входного MX-5.
CLASS_LADDER: dict[str, dict] = {
    "MX-5":  {"weight": 1.0, "threshold": 80,  "side_of": None,   "min_starts": 1},
    "BTCC":  {"weight": 1.4, "threshold": 100, "side_of": None,   "min_starts": 1},
    "DTM":   {"weight": 1.7, "threshold": 110, "side_of": "BTCC", "min_starts": 1},
    "GT500": {"weight": 2.0, "threshold": 120, "side_of": None,   "min_starts": 1},
    "Touge": {"weight": 1.2, "threshold": 90,  "side_of": "GT500", "min_starts": 1},
    "GT3":   {"weight": 2.4, "threshold": None, "side_of": None,  "min_starts": 1},
}

# Дефолт для классов, отсутствующих в CLASS_LADDER (на практике не бывает,
# но лучше явный минимум, чем деление по KeyError).
DEFAULT_MIN_STARTS = 1


def min_starts_for_class(class_name: str) -> int:
    """Минимум стартов в классе за месяц для попадания в общий зачёт."""
    return CLASS_LADDER.get(class_name, {}).get("min_starts", DEFAULT_MIN_STARTS)

# Порядок основных (не доп.) ступеней лестницы — по нему определяется, что
# открывается следующим при переходе.
MAIN_SEQUENCE = ["MX-5", "BTCC", "GT500", "GT3"]

# Доп.дисциплины, сгруппированные по тому основному классу, который они помогают пройти.
SIDE_DISCIPLINES: dict[str, list[str]] = {}
for _name, _cfg in CLASS_LADDER.items():
    if _cfg["side_of"]:
        SIDE_DISCIPLINES.setdefault(_cfg["side_of"], []).append(_name)


def next_main_class(current_class: str) -> str | None:
    """Следующая основная ступень после current_class (или доп., привязанной к ней)."""
    main = CLASS_LADDER.get(current_class, {}).get("side_of") or current_class
    if main not in MAIN_SEQUENCE:
        return None
    index = MAIN_SEQUENCE.index(main)
    if index + 1 >= len(MAIN_SEQUENCE):
        return None
    return MAIN_SEQUENCE[index + 1]


def classes_gating_promotion(current_class: str) -> list[str]:
    """Все дисциплины (основная + доп.), любая из которых может открыть следующую ступень."""
    return [current_class] + SIDE_DISCIPLINES.get(current_class, [])


def class_ladder_index(class_name: str) -> int | None:
    """Номер ступени лестницы для дисциплины (доп.дисциплина = ступень её основного
    класса). None — дисциплина вне турнирной лестницы, например Week CUP."""
    main = CLASS_LADDER.get(class_name, {}).get("side_of") or class_name
    if main not in MAIN_SEQUENCE:
        return None
    return MAIN_SEQUENCE.index(main)


def is_class_unlocked(current_class: str, discipline: str) -> bool:
    """Открыта ли пилоту эта дисциплина по его текущей ступени лестницы.

    Ступень ниже или равная своей — открыта (вернуться в MX-5 и катать его
    никто не запрещает). Ступень выше своей — закрыта: именно там сидел
    обход лестницы, потому что вес класса в общем зачёте растёт с 1.0 до 2.4,
    а выбор дисциплины в заявке ничем не ограничен — новичок мог заявить
    время в GT3 и получить ×2.4, минуя всю лестницу.

    Дисциплины вне лестницы (Week CUP) считаются открытыми всегда.
    """
    target_index = class_ladder_index(discipline)
    if target_index is None:
        return True
    current_index = class_ladder_index(current_class)
    if current_index is None:
        current_index = 0
    return target_index <= current_index


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


def class_score(personal_best_ms: int, benchmark_ms: int) -> int:
    """Баллы класса по личному лучшему кругу месяца относительно эталона.

    Точное попадание в эталон = 100. Каждый процент быстрее = +5, медленнее = -5.
    Диапазон 0–130.
    """
    if not benchmark_ms:
        return 0
    gap_percent = (personal_best_ms - benchmark_ms) / benchmark_ms * 100
    score = 100 - 5 * gap_percent
    return max(0, min(130, round(score)))

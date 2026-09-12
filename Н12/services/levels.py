"""Ранги и уровни пилота.

Ранг (Новичок → Легенда VALEVO) — крупная "лига", уровень (1–80) — мелкий шаг
внутри неё, чтобы прогресс в профиле ощущался часто, а не раз в несколько
месяцев. Уровень — это просто более подробное представление того же
рейтинга (rating), а не отдельная база данных: пересчитывается на лету, синк
не нужен.
"""

from __future__ import annotations

# (порог рейтинга, эмодзи, название ранга)
PILOT_RANKS: list[tuple[int, str, str]] = [
    (0, "🔰", "Новичок"),
    (20, "🏎", "Гонщик"),
    (50, "🥉", "Профи"),
    (100, "🥈", "Ас трассы"),
    (200, "🥇", "Чемпион"),
    (400, "💎", "Легенда VALEVO"),
]

# Сколько уровней приходится на каждый ранг (в том же порядке, что PILOT_RANKS).
# Сумма = 80. Верхний ранг открытый по рейтингу — для сетки уровней у него
# есть искусственный потолок (LEGEND_LEVEL_CAP_RATING), выше которого пилот
# просто остаётся на 80-м уровне ("макс.").
LEVELS_PER_RANK = [10, 10, 15, 15, 20, 10]
LEGEND_LEVEL_CAP_RATING = 500

TOTAL_LEVELS = sum(LEVELS_PER_RANK)


def _level_boundaries() -> list[int]:
    """Рейтинг, начиная с которого открывается каждый из 80 уровней (по возрастанию)."""
    boundaries: list[int] = []
    for rank_index, (start_rating, _, _) in enumerate(PILOT_RANKS):
        end_rating = (
            PILOT_RANKS[rank_index + 1][0]
            if rank_index + 1 < len(PILOT_RANKS)
            else LEGEND_LEVEL_CAP_RATING
        )
        levels_here = LEVELS_PER_RANK[rank_index]
        span = end_rating - start_rating
        for step in range(levels_here):
            boundaries.append(start_rating + round(span * step / levels_here))
    return boundaries


LEVEL_BOUNDARIES = _level_boundaries()


def pilot_rank_info(rating: int | float | None) -> tuple[tuple[int, str, str], tuple[int, str, str] | None]:
    """Возвращает (текущий_ранг, следующий_ранг) по рейтингу пилота."""
    rating_value = max(0, int(rating or 0))
    current = PILOT_RANKS[0]
    next_rank: tuple[int, str, str] | None = None
    for index, rank in enumerate(PILOT_RANKS):
        if rating_value >= rank[0]:
            current = rank
            next_rank = PILOT_RANKS[index + 1] if index + 1 < len(PILOT_RANKS) else None
        else:
            break
    return current, next_rank


def pilot_rank_progress_bar(rating: int | float | None, width: int = 10) -> str:
    """Прогресс-бар до следующего ранга: ▰▰▰▰▰▱▱▱▱▱."""
    rating_value = max(0, int(rating or 0))
    current, next_rank = pilot_rank_info(rating_value)

    if next_rank is None:
        return "▰" * width + " (макс. ранг)"

    span = next_rank[0] - current[0]
    done = rating_value - current[0]
    fraction = max(0.0, min(1.0, done / span)) if span > 0 else 1.0
    filled = round(fraction * width)

    bar = "▰" * filled + "▱" * (width - filled)
    points_left = next_rank[0] - rating_value
    return f"{bar}  ещё {points_left} до «{next_rank[1]} {next_rank[2]}»"


def pilot_level(rating: int | float | None) -> int:
    """Уровень 1–80 по рейтингу."""
    rating_value = max(0, int(rating or 0))
    level = 1
    for index, boundary in enumerate(LEVEL_BOUNDARIES):
        if rating_value >= boundary:
            level = index + 1
        else:
            break
    return min(level, TOTAL_LEVELS)


def pilot_level_progress_bar(rating: int | float | None, width: int = 10) -> str:
    """Прогресс-бар до следующего уровня (мелкий шаг, в отличие от ранга)."""
    rating_value = max(0, int(rating or 0))
    level = pilot_level(rating_value)
    if level >= TOTAL_LEVELS:
        return "▰" * width + " (макс. уровень)"

    current_boundary = LEVEL_BOUNDARIES[level - 1]
    next_boundary = LEVEL_BOUNDARIES[level] if level < len(LEVEL_BOUNDARIES) else LEGEND_LEVEL_CAP_RATING
    span = next_boundary - current_boundary
    done = rating_value - current_boundary
    fraction = max(0.0, min(1.0, done / span)) if span > 0 else 1.0
    filled = round(fraction * width)

    bar = "▰" * filled + "▱" * (width - filled)
    points_left = max(0, next_boundary - rating_value)
    return f"{bar}  ещё {points_left} до {level + 1} ур."

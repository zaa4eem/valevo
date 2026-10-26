"""Баллы дрифта для Week CUP (0.0–100.0, 100.0 — лучший результат).

Как это встроено в систему
--------------------------
Во всём боте «лучше» = «меньше lap_time_ms» (топ-3, закрытие Week CUP, ТВ-табло,
места в профиле). Чтобы не трогать SQL и схему БД, баллы хранятся в той же
колонке в «перевёрнутом» виде:

    lap_time_ms = SCORE_MS_BASE - round(score * 1000)

100.0 → 900000, 98.6 → 901400, 0.0 → 1000000. Чем больше баллов, тем меньше
число, значит сортировка ASC по-прежнему ставит лучший результат первым.
Текст (lap_time_text) хранится как "98.6" и показывается везде, где раньше
показывалось время.
"""
from __future__ import annotations

import re
from decimal import Decimal

from utils.time_parser import time_to_ms

# Те же имена, что в database.db.WEEK_CUP_NAMES.
SCORE_DISCIPLINES = frozenset({"WEEK CUP", "WEEKCUP", "WEEK_CUP", "WEEK"})

SCORE_MS_BASE = 1_000_000
SCORE_MIN = Decimal("0")
SCORE_MAX = Decimal("100")

# До двух знаков после точки/запятой: 100, 100.0, 98,6, 56.95
_SCORE_RE = re.compile(r"^[0-9]{1,3}(?:[.,][0-9]{1,2})?$")

SCORE_EXAMPLE = "98.6"
SCORE_HINT = "Баллы от 0 до 100, где 100.0 — лучший результат. Пример: 98.6"


def is_score_discipline(name) -> bool:
    return str(name or "").strip().upper() in SCORE_DISCIPLINES


def score_to_ms(score: Decimal) -> int:
    return SCORE_MS_BASE - int((score * 1000).to_integral_value())


def score_from_ms(ms: int) -> float:
    return (SCORE_MS_BASE - int(ms)) / 1000


def parse_score(value) -> tuple[str, int]:
    """'98,6' → ('98.6', 901400). Бросает ValueError при неверном вводе."""
    if not isinstance(value, str):
        raise ValueError("SCORE_MUST_BE_STRING")

    text = value.strip()
    if not _SCORE_RE.fullmatch(text):
        raise ValueError("INVALID_SCORE_FORMAT")

    score = Decimal(text.replace(",", ".")).quantize(Decimal("0.01"))
    if score < SCORE_MIN or score > SCORE_MAX:
        raise ValueError("SCORE_OUT_OF_RANGE")

    normalized = format(score, "f").rstrip("0")
    if normalized.endswith("."):
        normalized += "0"
    return normalized, score_to_ms(score)


def parse_result(discipline, value) -> tuple[str, int]:
    """Единая точка разбора результата: баллы для Week CUP, время круга для остальных.

    Для обычных дисциплин поведение прежнее: текст сохраняется как введён
    (после strip), миллисекунды считает time_to_ms.
    """
    if is_score_discipline(discipline):
        return parse_score(value)
    text = str(value).strip() if isinstance(value, str) else value
    return text, time_to_ms(text)


def result_label(discipline) -> str:
    return "Баллы" if is_score_discipline(discipline) else "Время"


def result_line(discipline, text) -> str:
    """Строка результата для сообщений: '🎯 98.6 б.' или '⏱ 01:18.565'."""
    if is_score_discipline(discipline):
        return f"🎯 {text} б."
    return f"⏱ {text}"


def format_result_text(text) -> str:
    """Для отчёта закрытия Week CUP: баллы подписываем, время (с ':') не трогаем."""
    text = str(text or "—")
    if text == "—" or ":" in text:
        return text
    return f"{text} б."

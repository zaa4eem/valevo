"""
Единая точка сборки данных профиля пилота.

Используется и ботом (handlers/common.py, для текстовой карточки в чате),
и мини-приложением (webapp/api.py, для JSON), чтобы бизнес-логика (ранги,
статистика, обращение к YCLIENTS) не дублировалась в двух местах и не
расходилась со временем.
"""
from __future__ import annotations

import logging
from typing import Any

from database.db import get_pilot_by_telegram_id, get_pilot_history_stats, get_pilot_class, get_pilot_achievements
from services.achievements import CATALOG
from services.levels import pilot_level, pilot_level_progress
from services.yclients_service import get_client, get_client_total_hours, get_valevo_bonus_balance

logger = logging.getLogger(__name__)


# (порог рейтинга, эмодзи, название ранга)
PILOT_RANKS: list[tuple[int, str, str]] = [
    (0, "🔰", "Новичок"),
    (20, "🏎", "Гонщик"),
    (50, "🥉", "Профи"),
    (100, "🥈", "Ас трассы"),
    (200, "🥇", "Чемпион"),
    (400, "💎", "Легенда VALEVO"),
]


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


def pilot_rank_progress(rating: int | float | None) -> dict[str, Any]:
    """Числовые данные для прогресс-бара до следующего ранга (без форматирования)."""
    rating_value = max(0, int(rating or 0))
    current, next_rank = pilot_rank_info(rating_value)

    if next_rank is None:
        return {
            "current_emoji": current[1],
            "current_title": current[2],
            "next_emoji": None,
            "next_title": None,
            "fraction": 1.0,
            "points_left": 0,
        }

    span = next_rank[0] - current[0]
    done = rating_value - current[0]
    fraction = max(0.0, min(1.0, done / span)) if span > 0 else 1.0

    return {
        "current_emoji": current[1],
        "current_title": current[2],
        "next_emoji": next_rank[1],
        "next_title": next_rank[2],
        "fraction": fraction,
        "points_left": next_rank[0] - rating_value,
    }


def format_phone_display(phone: str | None) -> str:
    """Красиво форматирует номер телефона: 89991234567 -> +7 999 123-45-67."""
    import re
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) == 11 and digits[0] in "78":
        return f"+7 {digits[1:4]} {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"
    return str(phone) if phone else "—"


async def _achievements_payload(telegram_id: int) -> dict[str, Any]:
    """Полный каталог достижений с флагом unlocked — фронт рисует и
    открытые, и запертые бейджи (стандартный геймификационный UX)."""
    unlocked_codes = await get_pilot_achievements(telegram_id)
    items = [
        {
            "code": code,
            "emoji": emoji,
            "title": title,
            "description": description,
            "reward": reward,
            "unlocked": code in unlocked_codes,
        }
        for code, (emoji, title, description, reward) in CATALOG.items()
    ]
    # Открытые сначала, внутри групп — порядок каталога.
    items.sort(key=lambda item: not item["unlocked"])
    return {"unlocked_count": len(unlocked_codes), "total_count": len(CATALOG), "items": items}


async def get_profile_data(telegram_id: int, fallback_username: str | None = None) -> dict[str, Any] | None:
    """Возвращает структурированные данные профиля пилота (без HTML-разметки).

    None, если пилот не зарегистрирован.
    """
    pilot = await get_pilot_by_telegram_id(telegram_id)
    if not pilot:
        return None

    username = pilot.get("username") or fallback_username or None
    display_name = pilot.get("display_name") or (f"@{username}" if username else "Пилот")
    rating = pilot.get("rating") or 0

    history = await get_pilot_history_stats(telegram_id=telegram_id, username=username or "")
    tournament_class = await get_pilot_class(telegram_id)
    achievements = await _achievements_payload(telegram_id)

    club: dict[str, Any] = {"linked": bool(pilot.get("yclients_client_id"))}
    if pilot.get("yclients_client_id"):
        try:
            yclients_data = await get_client(pilot["yclients_client_id"])
            total_hours = await get_client_total_hours(pilot["yclients_client_id"])
            bonus_balance = await get_valevo_bonus_balance(pilot["yclients_client_id"])
            club.update({
                "available": True,
                "visits": (yclients_data or {}).get("visits", 0) if isinstance(yclients_data, dict) else 0,
                "total_hours": float(total_hours or 0),
                "bonus_balance": round(float(bonus_balance or 0), 2),
            })
        except Exception as exc:
            logger.warning("YCLIENTS profile data unavailable for %s: %s", telegram_id, exc)
            club.update({"available": False})
    else:
        club.update({"available": False})

    return {
        "telegram_id": telegram_id,
        "username": username,
        "display_name": display_name,
        "pilot_number": pilot.get("pilot_number"),
        "phone": pilot.get("phone"),
        "phone_display": format_phone_display(pilot.get("phone")),
        "rating": rating,
        "rank": pilot_rank_progress(rating),
        "level": pilot_level(rating),
        "level_progress": pilot_level_progress(rating),
        "tournament_class": tournament_class,
        "achievements": achievements,
        "club": club,
        "history": history,
    }

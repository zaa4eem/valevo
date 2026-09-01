"""Рулетка призов за бонусные деньги Valevo Bonus (реальный баланс в YCLIENTS).

Экономика: спин стоит SPIN_COST_RUB, средняя выдача по каталогу ниже
стоимости спина (~70%) — клуб в среднем в плюсе, но с ощутимыми частыми
выигрышами и редким крупным джекпотом. Пересчитано и проверено при
изменении PRIZES — см. _catalog_expected_value() в тестах/консоли.

Списание всегда идёт напрямую через change_valevo_bonus (не через
issue_or_queue_valevo_bonus) — если YCLIENTS недоступен, спин просто не
происходит (fail-closed), а не откладывается в очередь: очередь подходит
для начислений (хуже не станет, если придут чуть позже), но не для
списаний (нельзя гарантировать, что параллельные спины не спишут больше,
чем есть на балансе, пока очередь не обработана). Выдача приза, наоборот,
идёт через очередь — если приз не удалось зачислить сразу, пилот всё
равно должен его получить, а не потерять после списания стоимости спина.
"""

from __future__ import annotations

import asyncio
import logging
import random

from database.db import (
    get_pilot_by_telegram_id,
    record_roulette_spin,
    update_pilot_rating,
)
from services.yclients_auto import issue_or_queue_valevo_bonus
from services.yclients_service import change_valevo_bonus, get_valevo_bonus_balance

logger = logging.getLogger(__name__)

SPIN_COST_RUB = 1000

# code -> (эмодзи, название, kind, value, weight)
# kind: "bonus" (₽ на Valevo Bonus) | "rating" (очки рейтинга, для клуба бесплатно)
PRIZES: list[tuple[str, str, str, str, float, int]] = [
    ("bonus_300",   "💶", "300 ₽ на счёт",        "bonus",  300,    60),
    ("bonus_500",   "💶", "500 ₽ на счёт",        "bonus",  500,    90),
    ("bonus_700",   "💶", "700 ₽ на счёт",        "bonus",  700,   130),
    ("bonus_800",   "💰", "800 ₽ на счёт",        "bonus",  800,   150),
    ("bonus_900",   "💰", "900 ₽ на счёт",        "bonus",  900,   120),
    ("bonus_1000",  "🔄", "Возврат спина — 1000 ₽", "bonus", 1000,  100),
    ("bonus_1200",  "💎", "1200 ₽ на счёт",       "bonus", 1200,    70),
    ("bonus_1500",  "💎", "1500 ₽ на счёт",       "bonus", 1500,    40),
    ("bonus_1800",  "🔥", "1800 ₽ на счёт",       "bonus", 1800,    20),
    ("bonus_2200",  "🔥", "2200 ₽ на счёт",       "bonus", 2200,    10),
    ("bonus_2700",  "🌟", "2700 ₽ на счёт",       "bonus", 2700,     5),
    ("bonus_3500",  "🌟", "3500 ₽ на счёт",       "bonus", 3500,     3),
    ("bonus_5000",  "👑", "5000 ₽ на счёт",       "bonus", 5000,     2),
    ("bonus_8000",  "🎉", "ДЖЕКПОТ — 8000 ₽",     "bonus", 8000,     1),
    ("rating_10",   "🔰", "+10 рейтинга",         "rating",  10,    70),
    ("rating_20",   "🏎", "+20 рейтинга",         "rating",  20,    50),
    ("rating_35",   "🥉", "+35 рейтинга",         "rating",  35,    35),
    ("rating_50",   "🥈", "+50 рейтинга",         "rating",  50,    25),
    ("rating_75",   "🥇", "+75 рейтинга",         "rating",  75,    15),
    ("rating_120",  "💠", "+120 рейтинга",        "rating", 120,     5),
]

assert len(PRIZES) == 20, f"Ожидалось 20 призов, сейчас {len(PRIZES)}"

_CODES = [p[0] for p in PRIZES]
_WEIGHTS = [p[5] for p in PRIZES]
_BY_CODE = {p[0]: p for p in PRIZES}


def prize_catalog() -> list[dict]:
    """Каталог для фронтенда — без весов (вероятности не показываем пилоту)."""
    return [
        {"code": code, "emoji": emoji, "title": title, "kind": kind, "value": value}
        for code, emoji, title, kind, value, _weight in PRIZES
    ]


def _pick_prize() -> tuple[str, str, str, str, float, int]:
    return random.choices(PRIZES, weights=_WEIGHTS, k=1)[0]


# Лок на пилота — защита от гонки при двойном/параллельном нажатии "Крутить"
# (два запроса могли бы оба пройти проверку баланса до того, как первый успеет
# списать деньги). В рамках одного процесса этого достаточно — деплой рассчитан
# на один webapp-контейнер (см. deploy/WEBAPP_DEPLOY.md о SQLite/WAL).
_spin_locks: dict[int, asyncio.Lock] = {}


def _lock_for(telegram_id: int) -> asyncio.Lock:
    lock = _spin_locks.get(telegram_id)
    if lock is None:
        lock = asyncio.Lock()
        _spin_locks[telegram_id] = lock
    return lock


class SpinError(Exception):
    """Спин не состоялся (нет привязки к YCLIENTS, не хватает денег, сервис недоступен)."""


async def spin(telegram_id: int) -> dict:
    """Списывает SPIN_COST_RUB, выбирает приз и начисляет его. Бросает
    SpinError с человекочитаемым сообщением, если спин не может состояться —
    в этом случае деньги гарантированно не списаны."""
    async with _lock_for(telegram_id):
        pilot = await get_pilot_by_telegram_id(telegram_id)
        if not pilot:
            raise SpinError("Пилот не найден")

        client_id = pilot.get("yclients_client_id")
        if not client_id:
            raise SpinError("Профиль ещё не синхронизирован с клубной системой — рулетка пока недоступна")

        balance = await get_valevo_bonus_balance(client_id)
        if balance < SPIN_COST_RUB:
            raise SpinError(f"Недостаточно средств на счёте Valevo Bonus (нужно {SPIN_COST_RUB} ₽, на счету {balance:g} ₽)")

        charge = await change_valevo_bonus(client_id, -SPIN_COST_RUB, title="Рулетка: списание за спин")
        if not charge.get("ok"):
            raise SpinError("Сервис YCLIENTS временно недоступен, попробуйте чуть позже")

        code, emoji, title, kind, value, _weight = _pick_prize()
        prize_status = "ok"

        if kind == "rating":
            try:
                await update_pilot_rating(telegram_id, value)
            except Exception:
                logger.exception("Не удалось начислить рейтинг за приз рулетки %s пилоту %s", code, telegram_id)
                prize_status = "failed"
        else:
            payout = await issue_or_queue_valevo_bonus(
                telegram_id=telegram_id,
                client_id=client_id,
                amount=value,
                title=f"Рулетка: приз «{title}»",
                source="roulette_prize",
            )
            prize_status = "ok" if payout.get("ok") else "queued"

        await record_roulette_spin(telegram_id, SPIN_COST_RUB, code, kind, value, prize_status)

        new_balance = await get_valevo_bonus_balance(client_id)
        return {
            "code": code,
            "emoji": emoji,
            "title": title,
            "kind": kind,
            "value": value,
            "prize_status": prize_status,
            "balance": new_balance,
        }

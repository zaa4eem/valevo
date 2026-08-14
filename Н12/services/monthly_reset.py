import logging
from datetime import datetime, timedelta

from pytz import timezone

from config import MOSCOW_TZ, SUPPORT_CHAT_ID, YCLIENTS_BONUS_RUB_PER_HOUR, SEASON_BONUS_EXPIRE_DAYS
from database.db import (
    get_top3,
    get_pilot_by_username,
    get_season_participant_ids,
    get_season_award,
    claim_season_award,
    update_season_award_yclients,
    clear_all_laps,
    create_pending_yclients_operation,
)
from services.yclients_service import issue_season_cashback
from utils.message_style import DIVIDER

logger = logging.getLogger(__name__)

# Согласованная логика сезона
BONUS_HOURS = {1: 20, 2: 10, 3: 5}
RATING_POINTS = {1: 30, 2: 15, 3: 10}
SEASON_PARTICIPATION_RATING = 5


def season_bonus_rub(bonus_hours: int) -> float:
    return round(float(bonus_hours) * float(YCLIENTS_BONUS_RUB_PER_HOUR), 2)


def current_season_key(now: datetime | None = None) -> str:
    """Ключ сезона по фактическому моменту закрытия.

    Закрытие происходит 20 числа в 18:01 МСК. Ключ фиксируется по месяцу закрытия,
    чтобы повторный запуск в этот же день не начислил награды повторно.
    """
    moscow_tz = timezone(MOSCOW_TZ)
    now = now or datetime.now(moscow_tz)
    if now.tzinfo is None:
        now = moscow_tz.localize(now)
    return now.astimezone(moscow_tz).strftime("%Y-%m-20-18")


async def _notify_admin(bot, text: str) -> None:
    if not SUPPORT_CHAT_ID:
        return
    try:
        await bot.send_message(SUPPORT_CHAT_ID, text)
    except Exception as exc:
        logger.warning("Не удалось отправить уведомление админу: %s", exc)


async def _issue_yclients_bonus_for_pilot(pilot: dict, bonus_hours: int, season_key: str, place: int) -> dict:
    if not bonus_hours:
        return {"ok": False, "status": "not_required"}
    client_id = pilot.get("yclients_client_id")
    result = await issue_season_cashback(
        client_id=client_id,
        bonus_hours=bonus_hours,
        reason=f"season:{season_key}:place:{place}",
    )
    return result


async def perform_monthly_reset(bot):
    """Закрывает сезон и начисляет награды.

    Production-safe правила:
    - не удаляет pilots;
    - не меняет старые поля БД;
    - защищается от повторного начисления через season_awards;
    - если YCLIENTS недоступен или карта Valevo Bonus не выдана, сезон всё равно закрывается,
      рейтинг и локальные бонусы начисляются, а ошибка пишется в БД/логи/админу.
    """
    season_key = current_season_key()
    logger.info("===== НАЧАЛО ЗАКРЫТИЯ СЕЗОНА %s =====", season_key)

    all_top3 = await get_top3()
    awarded_pilots: set[int] = set()

    for discipline, rows in all_top3.items():
        if str(discipline).strip().upper() in ("WEEK CUP", "WEEKCUP", "WEEK_CUP"):
            logger.info("Week CUP пропущен при месячном закрытии сезона")
            continue
        for index, row in enumerate(rows, start=1):
            if index > 3:
                continue

            username = row.get("username")
            pilot = await get_pilot_by_username(username)
            if not pilot:
                logger.warning("Пилот username=%s из таблицы кругов не найден в pilots", username)
                continue

            # get_pilot_by_username возвращает sqlite-row/tuple: id, telegram_id, username, phone, ..., yclients_client_id, ...
            tid = pilot[1]
            yclients_client_id = pilot[9] if len(pilot) > 9 else None
            pilot_data = {"telegram_id": tid, "yclients_client_id": yclients_client_id}
            if tid in awarded_pilots:
                continue

            bonus_hours = BONUS_HOURS[index]
            rating_delta = RATING_POINTS[index]
            bonus_rub = season_bonus_rub(bonus_hours)

            # Локальные бонусные часы больше не начисляем: фактическая награда — Valevo Bonus в рублях.
            existing_award = await get_season_award(season_key, tid, "podium")
            if existing_award is not None:
                awarded_pilots.add(tid)
                if existing_award.get("yclients_status") != "pending":
                    logger.info("Пилот %s уже получал podium-награду за сезон %s", tid, season_key)
                    continue
                # Рейтинг и бонусный кошелёк уже были применены атомарно ранее (claim прошёл),
                # но процесс, судя по всему, упал до попытки списания через YCLIENTS — повторяем только её.
                bonus_hours = int(existing_award.get("bonus_hours") or bonus_hours)
                bonus_rub = float(existing_award.get("yclients_bonus_rub") or bonus_rub)
            else:
                expires_at = (datetime.now(timezone(MOSCOW_TZ)) + timedelta(days=SEASON_BONUS_EXPIRE_DAYS)).isoformat()
                claimed = await claim_season_award(
                    season_key,
                    tid,
                    index,
                    bonus_hours,
                    rating_delta,
                    "podium",
                    yclients_bonus_rub=bonus_rub,
                    wallet_entry={
                        "yclients_client_id": yclients_client_id,
                        "amount": bonus_rub,
                        "expires_at": expires_at,
                        "reason": f"{season_key}:place:{index}",
                    },
                )
                awarded_pilots.add(tid)
                if not claimed:
                    # Кто-то другой (параллельный запуск) уже застолбил эту награду.
                    continue

            try:
                yclients_result = await _issue_yclients_bonus_for_pilot(pilot_data, bonus_hours, season_key, index)
            except Exception:
                # Локальная награда (рейтинг/кошелёк) уже зафиксирована атомарно выше — эта
                # ошибка не должна прерывать обработку остальных пилотов. Статус останется
                # 'pending' и будет обработан повторно при следующем запуске.
                logger.exception("Не удалось выдать Valevo Bonus через YCLIENTS для %s", tid)
                continue
            y_status = yclients_result.get("status", "unknown")
            y_error = None if yclients_result.get("ok") else yclients_result.get("message")
            y_card_id = yclients_result.get("card_id")
            y_amount = yclients_result.get("amount", bonus_rub if yclients_result.get("ok") else 0)
            await update_season_award_yclients(
                season_key,
                tid,
                "podium",
                y_status,
                bonus_rub=y_amount,
                error=y_error,
                card_id=y_card_id,
            )

            if not yclients_result.get("ok"):
                await create_pending_yclients_operation(
                    telegram_id=tid,
                    yclients_client_id=yclients_client_id,
                    operation_type="bonus",
                    amount=bonus_rub,
                    title=f"Valevo сезонная награда: {bonus_rub:g} 💎",
                    source="season_award",
                    last_error=y_error or y_status,
                )

            if not yclients_result.get("ok"):
                logger.warning("YCLIENTS bonus not issued for %s: %s", tid, yclients_result)
                await _notify_admin(
                    bot,
                    "⚠️ <b>Valevo Bonus не начислен автоматически</b>\n\n"
                    f"Пилот: @{username}\n"
                    f"Место: {index}\n"
                    f"Награда: {bonus_hours} ч / {bonus_rub:g} 💎\n"
                    f"Причина: {y_error or y_status}\n\n"
                    "Проверь, выдана ли клиенту карта Valevo Bonus в YCLIENTS.",
                )

            try:
                yclients_line = (
                    f"\n💳 Valevo Bonus: <b>+{float(y_amount):g} 💎</b>"
                    if yclients_result.get("ok") else
                    "\n💳 Valevo Bonus: начисление передано администратору."
                )
                await bot.send_message(
                    tid,
                    f"🏁 <b>СЕЗОН ПОДОШЁЛ К КОНЦУ</b>\n{DIVIDER}\n\n"
                    f"Вы заняли <b>{index} место</b> в дисциплине «{discipline}».\n\n"
                    f"📈 Рейтинг/репутация: <b>+{rating_delta}</b>"
                    f"{yclients_line}\n"
                    f"⏳ Сезонный бонус действует {SEASON_BONUS_EXPIRE_DAYS} дней.\n\n"
                    f"Новый сезон уже начался — ждём вас на трассе 🏁",
                )
            except Exception as exc:
                logger.warning("Не удалось уведомить пилота %s: %s", tid, exc)

    participant_ids = await get_season_participant_ids()
    for tid in participant_ids:
        if tid in awarded_pilots:
            continue

        claimed = await claim_season_award(
            season_key,
            tid,
            None,
            0,
            SEASON_PARTICIPATION_RATING,
            "participation",
            yclients_bonus_rub=0,
            yclients_status="not_required",
        )
        if not claimed:
            logger.info("Пилот %s уже получал participation-награду за сезон %s", tid, season_key)
            continue
        try:
            await bot.send_message(
                tid,
                f"🏁 <b>СЕЗОН ЗАВЕРШЁН</b>\n{DIVIDER}\n\n"
                f"Вы получаете <b>+{SEASON_PARTICIPATION_RATING}</b> рейтинга/репутации за участие.\n\n"
                "Продолжайте улучшать результаты! 💪",
            )
        except Exception as exc:
            logger.warning("Не удалось уведомить участника %s: %s", tid, exc)

    await clear_all_laps()
    logger.info("===== ЗАКРЫТИЕ СЕЗОНА %s ЗАВЕРШЕНО =====", season_key)

import logging
from datetime import datetime, timedelta

from pytz import timezone

from config import MOSCOW_TZ, SUPPORT_CHAT_ID, YCLIENTS_BONUS_RUB_PER_HOUR, SEASON_BONUS_EXPIRE_DAYS
from database.db import (
    get_pilot_by_telegram_id,
    get_season_award,
    claim_season_award,
    update_season_award_yclients,
    create_pending_yclients_operation,
)
from services.tournament import (
    month_bounds,
    month_qualified_participant_ids,
    rank_month_overall,
    run_monthly_relegation,
)
from services.yclients_service import issue_season_cashback
from utils.message_style import DIVIDER

logger = logging.getLogger(__name__)

# Согласованная логика турнира v2: приз по общему взвешенному зачёту месяца
# (топ-5), а не по лучшему времени в отдельной дисциплине — см. концепт-документ.
BONUS_HOURS = {1: 20, 2: 10, 3: 5, 4: 3, 5: 2}
RATING_POINTS = {1: 30, 2: 15, 3: 10, 4: 7, 5: 5}
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
    """Закрывает месяц турнира v2 и начисляет награды.

    Топ-5 определяется по общему взвешенному зачёту (баллы класса × вес,
    просуммированные по всем классам, где выполнен минимум стартов) — не по
    лучшему кругу в отдельной дисциплине, как раньше. История кругов больше
    не стирается: живой месячный балл считается на лету фильтром по дате, а
    не отдельным сбросом таблицы — стирание сломало бы и это, и стрики/ачивки.

    Production-safe правила сохранены как были:
    - не удаляет pilots;
    - защищается от повторного начисления через season_awards;
    - если YCLIENTS недоступен или карта Valevo Bonus не выдана, месяц всё равно закрывается,
      рейтинг и локальные бонусы начисляются, а ошибка пишется в БД/логи/админу.
    """
    season_key = current_season_key()
    logger.info("===== НАЧАЛО ЗАКРЫТИЯ МЕСЯЦА %s =====", season_key)

    month_key, start_iso, end_iso = month_bounds()
    ranking = await rank_month_overall(month_key, start_iso, end_iso)
    awarded_pilots: set[int] = set()

    for index, row in enumerate(ranking[:5], start=1):
        tid = row["telegram_id"]
        pilot = await get_pilot_by_telegram_id(tid)
        if not pilot:
            logger.warning("Пилот telegram_id=%s из общего зачёта не найден в pilots", tid)
            continue

        yclients_client_id = pilot.get("yclients_client_id")
        awarded_pilots.add(tid)

        bonus_hours = BONUS_HOURS[index]
        rating_delta = RATING_POINTS[index]
        bonus_rub = season_bonus_rub(bonus_hours)

        existing_award = await get_season_award(season_key, tid, "podium")
        if existing_award is not None:
            if existing_award.get("yclients_status") != "pending":
                logger.info("Пилот %s уже получал podium-награду за месяц %s", tid, season_key)
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
            if not claimed:
                # Кто-то другой (параллельный запуск) уже застолбил эту награду.
                continue

        try:
            yclients_result = await _issue_yclients_bonus_for_pilot(
                {"telegram_id": tid, "yclients_client_id": yclients_client_id}, bonus_hours, season_key, index,
            )
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
            logger.warning("YCLIENTS bonus not issued for %s: %s", tid, yclients_result)
            await _notify_admin(
                bot,
                "⚠️ <b>Valevo Bonus не начислен автоматически</b>\n\n"
                f"Пилот: {tid}\n"
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
                f"🏁 <b>МЕСЯЦ ЗАВЕРШЁН</b>\n{DIVIDER}\n\n"
                f"Вы заняли <b>{index} место</b> в общем зачёте месяца "
                f"(<b>{row['total']:g}</b> баллов).\n\n"
                f"📈 Рейтинг/репутация: <b>+{rating_delta}</b>"
                f"{yclients_line}\n"
                f"⏳ Бонус действует {SEASON_BONUS_EXPIRE_DAYS} дней.\n\n"
                f"Новый месяц уже начался — ждём вас на трассе 🏁",
            )
        except Exception as exc:
            logger.warning("Не удалось уведомить пилота %s: %s", tid, exc)

    qualified_ids = await month_qualified_participant_ids(start_iso, end_iso)
    for tid in qualified_ids:
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
            logger.info("Пилот %s уже получал participation-награду за месяц %s", tid, season_key)
            continue
        try:
            await bot.send_message(
                tid,
                f"🏁 <b>МЕСЯЦ ЗАВЕРШЁН</b>\n{DIVIDER}\n\n"
                f"Вы выполнили минимум стартов за месяц — получаете "
                f"<b>+{SEASON_PARTICIPATION_RATING}</b> рейтинга/репутации.\n\n"
                "Продолжайте улучшать результаты! 💪",
            )
        except Exception as exc:
            logger.warning("Не удалось уведомить участника %s: %s", tid, exc)

    try:
        await run_monthly_relegation(bot)
    except Exception:
        logger.exception("Ошибка при релегации по итогам месяца %s", season_key)

    logger.info("===== ЗАКРЫТИЕ МЕСЯЦА %s ЗАВЕРШЕНО =====", season_key)

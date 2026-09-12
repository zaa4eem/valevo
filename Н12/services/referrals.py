import logging

from config import REFERRAL_BONUS_RUB
from database.db import (
    add_bonus_wallet_entry,
    create_referral,
    get_pilot_by_telegram_id,
    get_referral,
    mark_referral_rewarded,
)
from services.yclients_auto import issue_or_queue_valevo_bonus

logger = logging.getLogger(__name__)


async def _grant(referral_id: int, side: str, telegram_id: int, amount: float) -> dict:
    referral = await get_referral(referral_id)
    if not referral:
        return {"ok": False, "status": "missing_referral"}
    if referral[f"{side}_rewarded"]:
        return {"ok": True, "status": "already_rewarded"}

    pilot = await get_pilot_by_telegram_id(telegram_id)
    if not pilot:
        return {"ok": False, "status": "missing_pilot"}
    source = f"referral:{referral_id}:{side}"
    title = "Valevo: реферальный бонус"
    result = await issue_or_queue_valevo_bonus(
        telegram_id=telegram_id,
        client_id=pilot.get("yclients_client_id"),
        amount=amount,
        title=title,
        source=source,
        phone=pilot.get("phone"),
        name=pilot.get("display_name") or pilot.get("username"),
    )
    await add_bonus_wallet_entry(
        telegram_id=telegram_id,
        yclients_client_id=pilot.get("yclients_client_id"),
        source=source,
        amount=amount,
        reason="Реферальная программа: по 350 ₽ другу и пригласившему",
        yclients_status="issued" if result.get("ok") else "queued",
        yclients_operation_id=result.get("pending_operation_id"),
    )
    await mark_referral_rewarded(referral_id, side)
    return result


async def process_referral_registration(referred_id: int, referrer_id: int | None, bot=None) -> dict:
    if not referrer_id or int(referrer_id) == int(referred_id):
        return {"ok": False, "status": "not_applicable"}
    if not await get_pilot_by_telegram_id(int(referrer_id)):
        return {"ok": False, "status": "unknown_referrer"}

    referral_id = await create_referral(int(referrer_id), int(referred_id), REFERRAL_BONUS_RUB)
    if referral_id is None:
        return {"ok": False, "status": "already_registered"}

    referrer_result = await _grant(referral_id, "referrer", int(referrer_id), REFERRAL_BONUS_RUB)
    referred_result = await _grant(referral_id, "referred", int(referred_id), REFERRAL_BONUS_RUB)

    if bot:
        text = f"🎁 <b>Реферальный бонус!</b>\n\nНачислено <b>{REFERRAL_BONUS_RUB:g} ₽ Valevo Bonus</b>."
        for tid in (int(referrer_id), int(referred_id)):
            try:
                await bot.send_message(tid, text)
            except Exception:
                logger.exception("Не удалось отправить уведомление о реферальном бонусе: %s", tid)
    return {"ok": True, "referral_id": referral_id, "referrer": referrer_result, "referred": referred_result}

import logging
from datetime import datetime

from pytz import timezone

from config import MOSCOW_TZ, SUPPORT_CHAT_ID
from database.db import get_expired_season_wallet_entries, mark_wallet_entry_expired
from services.yclients_auto import issue_or_queue_valevo_bonus
from services.yclients_service import get_valevo_bonus_balance

logger = logging.getLogger(__name__)


async def expire_season_bonuses(bot=None) -> dict:
    """Списывает только остатки сезонных бонусов. Referral/admin бонусы не трогает."""
    now = datetime.now(timezone(MOSCOW_TZ)).isoformat()
    entries = await get_expired_season_wallet_entries(now)
    expired = queued = skipped = 0
    for e in entries:
        amount = round(float(e.get("remaining") or 0), 2)
        if amount <= 0:
            await mark_wallet_entry_expired(e["id"], 0)
            skipped += 1
            continue
        client_id = e.get("yclients_client_id")
        if client_id:
            try:
                actual_balance = await get_valevo_bonus_balance(client_id)
                # Защита: не списываем больше, чем есть на карте.
                amount_to_withdraw = min(amount, max(0.0, float(actual_balance or 0)))
            except Exception:
                logger.exception("Не удалось прочитать баланс Valevo Bonus перед сгоранием")
                amount_to_withdraw = amount
        else:
            amount_to_withdraw = amount

        if amount_to_withdraw > 0:
            result = await issue_or_queue_valevo_bonus(
                telegram_id=e.get("telegram_id"),
                client_id=client_id,
                amount=-amount_to_withdraw,
                title=f"Сгорание сезонного бонуса Valevo: -{amount_to_withdraw:g} 💎",
                source="season_expiration",
            )
            if result.get("ok"):
                expired += 1
            else:
                queued += 1
        await mark_wallet_entry_expired(e["id"], amount_to_withdraw)

    if bot and SUPPORT_CHAT_ID and (expired or queued):
        try:
            await bot.send_message(
                SUPPORT_CHAT_ID,
                "⏳ <b>Проверка сгорания сезонных бонусов</b>\n\n"
                f"Списано: {expired}\n"
                f"В очереди/требует проверки: {queued}\n"
                f"Пропущено: {skipped}"
            )
        except Exception:
            logger.exception("Не удалось отправить отчёт о сгорании")
    return {"ok": True, "expired": expired, "queued": queued, "skipped": skipped}

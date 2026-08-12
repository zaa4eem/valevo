import asyncio
import json
import logging
from pathlib import Path
from datetime import datetime

from database.db import (
    get_weekcup_top3,
    get_weekcup_all_results,
    clear_weekcup_laps,
    add_bonus_wallet_entry,
    create_pending_yclients_operation,
)

logger = logging.getLogger(__name__)

WEEKCUP_HISTORY_DIR = Path("data/history/weekcup")

# Не даёт закрыть Week CUP дважды подряд (двойное нажатие кнопки, повторная
# доставка callback от Telegram) — иначе призовые начисляются дважды.
_close_lock = asyncio.Lock()


def _safe_name(value):
    value = str(value or "").replace("@", "").strip()
    return value or "Пилот"


async def save_weekcup_log(top3, all_results):
    WEEKCUP_HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    file_path = WEEKCUP_HISTORY_DIR / f"weekcup_{now.strftime('%Y_%m_%d_%H_%M_%S')}.json"

    data = {
        "closed_at": now.isoformat(),
        "top3": top3,
        "all_results": all_results,
    }

    with open(file_path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)

    return str(file_path)


async def close_weekcup(bot):
    """
    Закрывает Week CUP:
    1 место — сообщение про суперприз.
    2 место — 1000 бонусных рублей.
    3 место — 750 бонусных рублей.
    Потом очищает только Week CUP.
    """
    if _close_lock.locked():
        return "⏳ Week CUP уже закрывается, подождите завершения текущей операции."

    async with _close_lock:
        return await _close_weekcup_locked(bot)


async def _close_weekcup_locked(bot):
    top3 = await get_weekcup_top3()

    if not top3:
        return "❌ Week CUP не закрыт: в таблице нет результатов."

    all_results = await get_weekcup_all_results()
    log_path = await save_weekcup_log(top3, all_results)

    report_lines = [
        "🏆 <b>Week CUP закрыт</b>",
        "",
    ]

    for row in top3:
        place = row["place"]
        telegram_id = row.get("telegram_id")
        username = _safe_name(row.get("display_name") or row.get("username"))
        lap_time = row.get("lap_time_text") or "—"
        yclients_client_id = row.get("yclients_client_id")

        if place == 1:
            report_lines.append(f"🥇 {username} — {lap_time} — суперприз администрации")

            if telegram_id:
                try:
                    await bot.send_message(
                        telegram_id,
                        "🏆 <b>Закончился недельный турнир!</b>\n\n"
                        "Ты занял <b>1 место</b> и выиграл суперприз от администрации клуба VALEVO.\n\n"
                        "Для получения приза обратись лично в клуб или напиши администрации в Telegram.\n\n"
                        "Поздравляем с победой! 🔥"
                    )
                except Exception as exc:
                    logger.warning("Не удалось написать победителю Week CUP %s: %s", telegram_id, exc)

        elif place == 2:
            bonus_amount = 1000

            report_lines.append(f"🥈 {username} — {lap_time} — +1000 ₽ Valevo Bonus")

            if telegram_id:
                await add_bonus_wallet_entry(
                    telegram_id=telegram_id,
                    yclients_client_id=yclients_client_id,
                    source="weekcup_award",
                    amount=bonus_amount,
                    reason="Week CUP: 2 место",
                    yclients_status="pending",
                )

                await create_pending_yclients_operation(
                    telegram_id=telegram_id,
                    yclients_client_id=yclients_client_id,
                    operation_type="bonus",
                    amount=bonus_amount,
                    title="Week CUP: награда за 2 место",
                    source="weekcup_award",
                )

                try:
                    await bot.send_message(
                        telegram_id,
                        "🥈 <b>Поздравляем!</b>\n\n"
                        "Ты занял <b>2 место</b> в недельном турнире Week CUP.\n\n"
                        "На твою бонусную карту будет начислено <b>1000 бонусных рублей</b>.\n\n"
                        "Спасибо за участие! 🏁"
                    )
                except Exception as exc:
                    logger.warning("Не удалось написать 2 месту Week CUP %s: %s", telegram_id, exc)

        elif place == 3:
            bonus_amount = 750

            report_lines.append(f"🥉 {username} — {lap_time} — +750 ₽ Valevo Bonus")

            if telegram_id:
                await add_bonus_wallet_entry(
                    telegram_id=telegram_id,
                    yclients_client_id=yclients_client_id,
                    source="weekcup_award",
                    amount=bonus_amount,
                    reason="Week CUP: 3 место",
                    yclients_status="pending",
                )

                await create_pending_yclients_operation(
                    telegram_id=telegram_id,
                    yclients_client_id=yclients_client_id,
                    operation_type="bonus",
                    amount=bonus_amount,
                    title="Week CUP: награда за 3 место",
                    source="weekcup_award",
                )

                try:
                    await bot.send_message(
                        telegram_id,
                        "🥉 <b>Поздравляем!</b>\n\n"
                        "Ты занял <b>3 место</b> в недельном турнире Week CUP.\n\n"
                        "На твою бонусную карту будет начислено <b>750 бонусных рублей</b>.\n\n"
                        "Спасибо за участие! 🏁"
                    )
                except Exception as exc:
                    logger.warning("Не удалось написать 3 месту Week CUP %s: %s", telegram_id, exc)

    deleted_count = await clear_weekcup_laps()

    report_lines.extend([
        "",
        f"🧹 Очищено кругов Week CUP: <b>{deleted_count}</b>",
        f"📝 Лог сохранён: <code>{log_path}</code>",
        "",
        "✅ Новый Week CUP можно запускать."
    ])

    return "\n".join(report_lines)
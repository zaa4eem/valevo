import asyncio
import logging
from datetime import datetime
from typing import Optional

from config import YCLIENTS_AUTO_SYNC, YCLIENTS_SYNC_ON_STARTUP, SUPPORT_CHAT_ID
from database.db import (
    bind_yclients_client,
    claim_pending_yclients_operation,
    create_pending_yclients_operation,
    get_pending_yclients_operations,
    get_unsynced_pilots,
    log_yclients_sync,
    update_pending_yclients_operation,
)
from services.yclients_service import (
    change_valevo_bonus,
    ensure_valevo_bonus_card,
    find_client_by_phone,
    get_client,
)

logger = logging.getLogger(__name__)


async def auto_sync_pilot_with_yclients(telegram_id: int, phone: str, username: str | None = None) -> dict:
    """Автоматически привязывает пилота к YCLIENTS и проверяет карту Valevo Bonus.

    Функция safe: никогда не должна валить регистрацию или запуск бота.
    """
    if not YCLIENTS_AUTO_SYNC:
        return {"ok": False, "status": "disabled"}
    try:
        client = await find_client_by_phone(phone)
        if not client:
            await log_yclients_sync(telegram_id, phone, None, "client_not_found", "Клиент не найден по телефону")
            return {"ok": False, "status": "client_not_found"}

        client_id = client.get("id")
        await bind_yclients_client(telegram_id, client_id)
        await log_yclients_sync(telegram_id, phone, client_id, "client_linked", "Клиент привязан")

        card_result = await ensure_valevo_bonus_card(
            client_id,
            phone=client.get("phone") or phone,
            name=client.get("name") or client.get("display_name") or username or "Клиент",
        )
        if not card_result.get("ok"):
            op_id = await create_pending_yclients_operation(
                telegram_id=telegram_id,
                yclients_client_id=client_id,
                operation_type="ensure_card",
                amount=0,
                title="Автовыдача карты Valevo Bonus",
                source="auto_sync",
                last_error=card_result.get("message"),
            )
            await log_yclients_sync(telegram_id, phone, client_id, "card_pending", f"pending operation #{op_id}: {card_result.get('message')}")
            return {"ok": True, "status": "client_linked_card_pending", "client_id": client_id, "pending_operation_id": op_id}

        card = card_result.get("card") or {}
        await log_yclients_sync(telegram_id, phone, client_id, "ok", f"Карта готова: {card.get('id')}")
        return {"ok": True, "status": "ok", "client_id": client_id, "card_id": card.get("id")}
    except Exception as exc:
        logger.exception("auto_sync_pilot_with_yclients failed for %s", telegram_id)
        try:
            await log_yclients_sync(telegram_id, phone, None, "error", repr(exc))
        except Exception:
            pass
        return {"ok": False, "status": "error", "message": repr(exc)}


async def auto_sync_all_pilots(bot=None, notify_admin: bool = False, limit_delay: float = 0.15) -> dict:
    """Фоновая синхронизация всех пилотов из БД. Используется при старте и по расписанию."""
    if not YCLIENTS_AUTO_SYNC or not YCLIENTS_SYNC_ON_STARTUP:
        return {"ok": False, "status": "disabled"}
    pilots = await get_unsynced_pilots()
    total = len(pilots)
    linked = card_ready = pending = errors = 0
    for p in pilots:
        result = await auto_sync_pilot_with_yclients(p["telegram_id"], p["phone"], p.get("username"))
        if result.get("status") in {"ok", "client_linked_card_pending"}:
            linked += 1
        if result.get("status") == "ok":
            card_ready += 1
        elif "pending" in str(result.get("status")):
            pending += 1
        elif not result.get("ok"):
            errors += 1
        await asyncio.sleep(limit_delay)

    summary = {"ok": True, "total": total, "linked": linked, "card_ready": card_ready, "pending": pending, "errors": errors}
    logger.info("YCLIENTS auto sync finished: %s", summary)
    if notify_admin and bot and SUPPORT_CHAT_ID:
        try:
            await bot.send_message(
                SUPPORT_CHAT_ID,
                "🔄 <b>Автосинхронизация YCLIENTS завершена</b>\n\n"
                f"Пилотов проверено: {total}\n"
                f"Связано/проверено: {linked}\n"
                f"Карта готова: {card_ready}\n"
                f"В очереди: {pending}\n"
                f"Ошибок: {errors}"
            )
        except Exception:
            logger.exception("Не удалось отправить отчёт автосинхронизации")
    return summary


async def issue_or_queue_valevo_bonus(
    telegram_id: int | None,
    client_id: int | None,
    amount: float,
    title: str,
    source: str,
    phone: str | None = None,
    name: str | None = None,
) -> dict:
    """Начисляет бонус. Если карты нет/нет доступа — кладёт операцию в очередь, чтобы деньги не потерялись."""
    if not client_id:
        op_id = await create_pending_yclients_operation(telegram_id, None, "bonus", amount, title, source, last_error="no_client_id")
        return {"ok": False, "status": "queued", "message": "Нет yclients_client_id, операция в очереди", "pending_operation_id": op_id}

    result = await change_valevo_bonus(client_id, amount, title=title, phone=phone, name=name)
    if result.get("ok"):
        return result

    op_id = await create_pending_yclients_operation(
        telegram_id=telegram_id,
        yclients_client_id=client_id,
        operation_type="bonus",
        amount=amount,
        title=title,
        source=source,
        last_error=result.get("message") or result.get("status"),
    )
    result.update({"status": "queued", "pending_operation_id": op_id})
    return result


_pending_ops_lock = asyncio.Lock()


async def process_pending_yclients_operations(bot=None, limit: int = 100) -> dict:
    """Повторяет операции, которые не прошли из-за отсутствия карты/временной ошибки API."""
    if _pending_ops_lock.locked():
        return {"ok": False, "status": "already_running"}
    async with _pending_ops_lock:
        return await _process_pending_yclients_operations_locked(limit=limit)


async def _process_pending_yclients_operations_locked(limit: int = 100) -> dict:
    ops = await get_pending_yclients_operations(limit=limit)
    done = failed = 0
    for op in ops:
        if not await claim_pending_yclients_operation(op["id"]):
            # Кто-то другой уже забрал эту операцию в обработку.
            continue
        try:
            if op["operation_type"] == "ensure_card":
                ensured = await ensure_valevo_bonus_card(op["yclients_client_id"])
                if ensured.get("ok"):
                    card = ensured.get("card") or {}
                    await update_pending_yclients_operation(op["id"], "done", yclients_card_id=str(card.get("id")))
                    done += 1
                else:
                    await update_pending_yclients_operation(op["id"], "retry", last_error=ensured.get("message"))
                    failed += 1
            elif op["operation_type"] == "bonus":
                result = await change_valevo_bonus(op["yclients_client_id"], op["amount"], title=op.get("title") or "Valevo Bonus")
                if result.get("ok"):
                    await update_pending_yclients_operation(op["id"], "done", yclients_card_id=str(result.get("card_id")))
                    done += 1
                else:
                    await update_pending_yclients_operation(op["id"], "retry", last_error=result.get("message") or result.get("status"))
                    failed += 1
        except Exception as exc:
            logger.exception("process pending op failed: %s", op)
            await update_pending_yclients_operation(op["id"], "retry", last_error=repr(exc))
            failed += 1
        await asyncio.sleep(0.15)
    return {"ok": True, "processed": len(ops), "done": done, "failed": failed}

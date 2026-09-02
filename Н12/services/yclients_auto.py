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
    get_pilot_by_telegram_id,
    get_unsynced_pilots,
    log_yclients_sync,
    update_pending_yclients_operation,
)
from utils.error_reporter import report_admin_error
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


# После стольких неудачных попыток операция перестаёт бесконечно крутиться в
# очереди и уходит в статус 'failed' с уведомлением админу. При 6-часовом
# интервале повторов это примерно пять суток попыток — временный сбой API за
# это время точно успеет пройти, а вот структурная проблема (нет клиента в
# YCLIENTS, запрещён выпуск карт) сама не рассосётся и требует человека.
MAX_PENDING_ATTEMPTS = 20


async def process_pending_yclients_operations(bot=None, limit: int = 100) -> dict:
    """Повторяет операции, которые не прошли из-за отсутствия карты/временной ошибки API."""
    if _pending_ops_lock.locked():
        return {"ok": False, "status": "already_running"}
    async with _pending_ops_lock:
        return await _process_pending_yclients_operations_locked(bot=bot, limit=limit)


async def _resolve_client_id(op: dict) -> int | None:
    """Актуальный yclients_client_id для операции.

    Операция могла быть поставлена в очередь, когда пилот ещё не был связан с
    YCLIENTS (client_id = NULL). Сам по себе client_id в строке очереди никогда
    не появится, поэтому раньше такая операция уходила в 'retry' на каждом
    проходе вечно. Теперь перед повтором подтягиваем связь из pilots — её мог
    проставить автосинк или админ вручную уже после постановки в очередь.
    """
    if op.get("yclients_client_id"):
        return op["yclients_client_id"]
    if not op.get("telegram_id"):
        return None
    try:
        pilot = await get_pilot_by_telegram_id(op["telegram_id"])
    except Exception:
        logger.exception("Не удалось перечитать пилота %s для операции #%s", op.get("telegram_id"), op.get("id"))
        return None
    return (pilot or {}).get("yclients_client_id")


async def _give_up_on_operation(bot, op: dict, last_error: str | None) -> None:
    """Снимает операцию с повторов и зовёт админа разобраться руками."""
    await update_pending_yclients_operation(op["id"], "failed", last_error=last_error)
    logger.error(
        "Операция #%s (%s) снята с повторов после %s попыток: %s",
        op["id"], op["operation_type"], op.get("attempts"), last_error,
    )
    if bot is None:
        return
    await report_admin_error(
        bot,
        context=f"Очередь YCLIENTS, операция #{op['id']} ({op['operation_type']})",
        error=last_error,
        details={
            "Пилот": op.get("telegram_id") or "—",
            "Сумма": f"{op.get('amount') or 0:g} 💎",
            "Попыток": op.get("attempts"),
        },
        extra_advice=(
            "Операция снята с автоповторов, чтобы не крутиться в очереди бесконечно. "
            "Деньги не начислены. После устранения причины начислите вручную "
            "или создайте операцию заново."
        ),
    )


async def _process_pending_yclients_operations_locked(bot=None, limit: int = 100) -> dict:
    ops = await get_pending_yclients_operations(limit=limit)
    done = failed = given_up = 0
    for op in ops:
        if not await claim_pending_yclients_operation(op["id"]):
            # Кто-то другой уже забрал эту операцию в обработку.
            continue

        attempts = int(op.get("attempts") or 0)
        client_id = await _resolve_client_id(op)

        if client_id is None:
            reason = "no_client_id"
            if attempts + 1 >= MAX_PENDING_ATTEMPTS:
                await _give_up_on_operation(bot, op, reason)
                given_up += 1
            else:
                await update_pending_yclients_operation(op["id"], "retry", last_error=reason)
                failed += 1
            await asyncio.sleep(0.15)
            continue

        try:
            if op["operation_type"] == "ensure_card":
                ensured = await ensure_valevo_bonus_card(client_id)
                ok = bool(ensured.get("ok"))
                error_text = ensured.get("message")
                card_id = str((ensured.get("card") or {}).get("id")) if ok else None
            elif op["operation_type"] == "bonus":
                result = await change_valevo_bonus(
                    client_id, op["amount"], title=op.get("title") or "Valevo Bonus",
                )
                ok = bool(result.get("ok"))
                error_text = result.get("message") or result.get("status")
                card_id = str(result.get("card_id")) if ok else None
            else:
                await _give_up_on_operation(bot, op, f"unknown_operation_type:{op['operation_type']}")
                given_up += 1
                await asyncio.sleep(0.15)
                continue

            if ok:
                await update_pending_yclients_operation(op["id"], "done", yclients_card_id=card_id)
                done += 1
            elif attempts + 1 >= MAX_PENDING_ATTEMPTS:
                await _give_up_on_operation(bot, op, error_text)
                given_up += 1
            else:
                await update_pending_yclients_operation(op["id"], "retry", last_error=error_text)
                failed += 1
        except Exception as exc:
            logger.exception("process pending op failed: %s", op)
            if attempts + 1 >= MAX_PENDING_ATTEMPTS:
                await _give_up_on_operation(bot, op, repr(exc))
                given_up += 1
            else:
                await update_pending_yclients_operation(op["id"], "retry", last_error=repr(exc))
                failed += 1
        await asyncio.sleep(0.15)
    return {"ok": True, "processed": len(ops), "done": done, "failed": failed, "given_up": given_up}

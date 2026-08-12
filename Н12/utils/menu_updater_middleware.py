import logging
from typing import Any, Awaitable, Callable, Dict

from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, TelegramObject

from config import MENU_VERSION
from database.db import sync_pilot_menu_version
from keyboards.menu import get_menu

logger = logging.getLogger(__name__)


class MenuUpdaterMiddleware(BaseMiddleware):
    """Один раз показывает пилоту обновлённое reply-меню после того, как
    в конфиге поднимается MENU_VERSION (например, добавили новую кнопку)."""

    async def __call__(
        self,
        handler: Callable[
            [TelegramObject, Dict[str, Any]],
            Awaitable[Any]
        ],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        result = await handler(event, data)

        user = data.get("event_from_user")
        if not user:
            return result

        chat_target: Message | None = None
        if isinstance(event, Message):
            chat_target = event
        elif isinstance(event, CallbackQuery) and event.message:
            chat_target = event.message

        if chat_target is None:
            return result

        try:
            updated = await sync_pilot_menu_version(user.id, MENU_VERSION)
            if updated:
                await chat_target.answer("🔄 Меню обновлено.", reply_markup=get_menu(user.id))
        except Exception:
            logger.exception("Не удалось обновить меню пользователю %s", user.id)

        return result

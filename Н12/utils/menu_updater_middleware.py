from typing import Any, Awaitable, Callable, Dict

from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery, TelegramObject

from database.db import get_pilot_by_telegram_id
from keyboards.menu import get_menu


class MenuUpdaterMiddleware(BaseMiddleware):
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

        pilot = await get_pilot_by_telegram_id(user.id)

        if not pilot:
            return result

        try:
            if isinstance(event, Message):
                await event.answer(
                    reply_markup=get_menu(user.id)
                )

            elif isinstance(event, CallbackQuery) and event.message:
                await event.message.answer(
                    reply_markup=get_menu(user.id)
                )

        except Exception:
            pass

        return result
import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict

from aiogram import BaseMiddleware, Bot
from aiogram.enums import ChatType
from aiogram.types import Message, TelegramObject

logger = logging.getLogger(__name__)

DEFAULT_FADE_DELAY = 4.0

# asyncio.create_task() не хранит сильную ссылку на Task — если её нигде не
# держать, сборщик мусора может уничтожить ещё не завершённую задачу
# (см. предупреждение в документации asyncio.create_task). Для мидлвари,
# висящей на КАЖДОМ сообщении бота, это означало бы, что часть отложенных
# удалений просто никогда не выполнится — молча и без ошибки в логах.
_background_tasks: set[asyncio.Task] = set()


async def fade_delete(bot: Bot, chat_id: int, message_id: int, delay: float = DEFAULT_FADE_DELAY) -> None:
    """Удаляет сообщение не мгновенно, а через паузу — чтобы это не выглядело
    как моргание интерфейса. Ошибки (уже удалено, чужое, старше 48 часов)
    молча игнорируются: чистота чата важнее гарантии удаления."""
    if delay > 0:
        await asyncio.sleep(delay)
    try:
        await bot.delete_message(chat_id, message_id)
    except Exception:
        pass


def schedule_fade_delete(bot: Bot, chat_id: int, message_id: int, delay: float = DEFAULT_FADE_DELAY) -> None:
    """Фоновая обёртка над fade_delete — не блокирует текущий хендлер."""
    task = asyncio.create_task(fade_delete(bot, chat_id, message_id, delay))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


class ChatHygieneMiddleware(BaseMiddleware):
    """Убирает из личного чата с ботом собственные сообщения пользователя —
    нажатия reply-кнопок и вручную введённый текст — после того, как хендлер
    их обработал. В истории остаются только ответы бота, а не сырые шаги
    процессов. В группы/каналы не лезет — там своя история и обычно нет прав."""

    def __init__(self, delay: float = DEFAULT_FADE_DELAY) -> None:
        self.delay = delay

    async def __call__(
        self,
        handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: Dict[str, Any],
    ) -> Any:
        result = await handler(event, data)

        if (
            isinstance(event, Message)
            and event.chat.type == ChatType.PRIVATE
            and event.from_user
            and not event.from_user.is_bot
        ):
            bot = data.get("bot")
            if bot is not None:
                schedule_fade_delete(bot, event.chat.id, event.message_id, self.delay)

        return result

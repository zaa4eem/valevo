import logging
from logging.handlers import RotatingFileHandler
import sys
from config import LOG_FILE
from aiogram import BaseMiddleware
from aiogram.types import Update
from datetime import datetime

def setup_logging():
    file_format = logging.Formatter(
        "%(asctime)s|%(levelname)s|%(message)s",
        datefmt="%Y-%m-%d|%H:%M:%S"
    )
    console_format = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S"
    )

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    fh = RotatingFileHandler(LOG_FILE, maxBytes=5*1024*1024, backupCount=3, encoding="utf-8")
    fh.setFormatter(file_format)
    fh.setLevel(logging.INFO)

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(console_format)
    ch.setLevel(logging.INFO)

    root.addHandler(fh)
    root.addHandler(ch)

    logging.getLogger("aiogram").setLevel(logging.WARNING)
    logging.getLogger("aiohttp").setLevel(logging.WARNING)


class LoggingMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        update: Update = data.get("update")
        logger = logging.getLogger("bot.actions")

        if update is None:
            return await handler(event, data)

        # Пытаемся извлечь информацию
        event_type = "unknown"
        user_info = "—"
        content = ""

        try:
            for field_name in [
                "message", "edited_message", "channel_post", "edited_channel_post",
                "callback_query", "inline_query", "chosen_inline_result",
                "shipping_query", "pre_checkout_query", "my_chat_member",
                "chat_member", "chat_join_request", "poll_answer"
            ]:
                obj = getattr(update, field_name, None)
                if obj:
                    event_type = field_name
                    user = getattr(obj, "from_user", None)
                    if user:
                        user_info = f"@{user.username or user.id} (ID:{user.id})"
                    if field_name == "message":
                        content = obj.text or obj.caption or ""
                    elif field_name == "callback_query":
                        content = obj.data or ""
                    elif field_name == "inline_query":
                        content = obj.query or ""
                    elif field_name == "chosen_inline_result":
                        content = obj.result_id or ""
                    elif field_name == "poll_answer":
                        content = f"poll_id:{obj.poll_id}"
                    else:
                        content = str(obj)[:50]
                    break
        except Exception:
            event_type = "parse_error"

        # Не логируем пустые служебные апдейты (например, подтверждения получения сообщений)
        if not user_info or not content:
            return await handler(event, data)

        start_time = datetime.now()
        try:
            result = await handler(event, data)
            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"{event_type}|{user_info}|Успешно|{content}|{elapsed:.2f}s")
            return result
        except Exception as e:
            elapsed = (datetime.now() - start_time).total_seconds()
            logger.error(f"{event_type}|{user_info}|Ошибка|{content}|{e}|{elapsed:.2f}s")
            raise
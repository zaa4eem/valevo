"""Валидация никнейма пилота. Общая для бота и мини-приложения."""
import re

BAD_NICK_PARTS = [
    "http", "https", "www", ".ru", ".com", ".gg", ".net",
    "t.me", "telegram", "discord", "vk.com", "@"
]

VALID_NICK_RE = re.compile(r"^[a-zA-Zа-яА-ЯёЁ0-9_ \-]+$")

MAX_NICK_LENGTH = 16


def sanitize_pilot_name(name: str | None) -> str | None:
    if not name:
        return None

    name = str(name).strip()
    lower = name.lower()

    for bad in BAD_NICK_PARTS:
        if bad in lower:
            return None

    # запрет emoji / спецсимволов
    if not VALID_NICK_RE.fullmatch(name):
        return None

    name = re.sub(r"\s+", " ", name).strip()
    name = name[:MAX_NICK_LENGTH]

    if len(name) < 2:
        return None

    return name

"""
Проверка initData, которую Telegram передаёт Mini App при открытии.

Алгоритм полностью соответствует официальной документации:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Это единственный источник авторизации в API мини-приложения — по initData
мы надёжно (криптографически) знаем telegram_id пользователя, без паролей
и без отдельной системы логина.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl

from config import ADMIN_IDS, BOT_TOKEN

# initData старше этого считается протухшей (защита от повторного использования
# перехваченной/сохранённой ссылки на мини-апп).
MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60


class InitDataError(Exception):
    """initData отсутствует, повреждена, устарела или не прошла проверку подписи."""


@dataclass(frozen=True)
class TelegramWebAppUser:
    id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    is_admin: bool


def _secret_key() -> bytes:
    return hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()


def validate_init_data(init_data: str) -> dict[str, str]:
    """Проверяет подпись initData и возвращает распарсенные поля.

    Бросает InitDataError, если подпись неверна, данные устарели
    или BOT_TOKEN не настроен на сервере.
    """
    if not BOT_TOKEN:
        raise InitDataError("BOT_TOKEN не настроен на сервере")
    if not init_data:
        raise InitDataError("initData отсутствует")

    pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=False)
    data = dict(pairs)

    received_hash = data.pop("hash", None)
    if not received_hash:
        raise InitDataError("В initData отсутствует hash")

    check_string = "\n".join(f"{key}={value}" for key, value in sorted(data.items()))
    computed_hash = hmac.new(_secret_key(), check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise InitDataError("Неверная подпись initData")

    auth_date = data.get("auth_date")
    if auth_date:
        try:
            age = time.time() - int(auth_date)
        except ValueError:
            age = None
        if age is not None and (age > MAX_INIT_DATA_AGE_SECONDS or age < -60):
            raise InitDataError("initData устарела — переоткройте приложение")

    return data


def parse_user(init_data_fields: dict[str, str]) -> TelegramWebAppUser:
    raw_user = init_data_fields.get("user")
    if not raw_user:
        raise InitDataError("В initData нет данных пользователя")
    try:
        payload = json.loads(raw_user)
    except (TypeError, ValueError) as exc:
        raise InitDataError("Не удалось разобрать данные пользователя") from exc

    try:
        user_id = int(payload["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InitDataError("В данных пользователя нет id") from exc

    return TelegramWebAppUser(
        id=user_id,
        username=payload.get("username"),
        first_name=payload.get("first_name"),
        last_name=payload.get("last_name"),
        is_admin=user_id in ADMIN_IDS,
    )


def authenticate(init_data: str) -> TelegramWebAppUser:
    """Полная проверка: подпись + разбор пользователя. Бросает InitDataError."""
    fields = validate_init_data(init_data)
    return parse_user(fields)

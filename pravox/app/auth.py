import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl
from .errors import AppError


def validate_init_data(raw, bot_token, ttl=3600, now=None):
    def deny():
        raise AppError("unauthorized", "Откройте приложение заново через меню Telegram-бота.", 401)
    if not bot_token or not raw or len(raw) > 16000:
        deny()
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True, max_num_fields=30)
        data = dict(pairs)
        if len(pairs) != len(data):
            deny()
        received = data.pop("hash", "")
        check = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
        secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(received, expected):
            deny()
        age = (time.time() if now is None else now) - int(data["auth_date"])
        if age < -30 or age > ttl:
            deny()
        user = json.loads(data["user"])
        if type(user.get("id")) is not int or not 0 < user["id"] < 2**53 or user.get("is_bot"):
            deny()
        return {"id": user["id"], "first_name": str(user.get("first_name", ""))[:128],
                "username": str(user.get("username", ""))[:64]}
    except (ValueError, KeyError, TypeError, UnicodeError):
        deny()

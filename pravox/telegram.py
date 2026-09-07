import json
import urllib.request
import urllib.error
import uuid
from .errors import UpstreamError
from .message_style import render_message


class Telegram:
    def __init__(self, config):
        self.config = config

    def call(self, method, payload=None, timeout=15):
        if not self.config.bot_token:
            raise UpstreamError("telegram_not_configured")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{self.config.bot_token}/{method}",
            data=json.dumps(payload or {}).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                data = json.load(response)
            if not data.get("ok"):
                raise UpstreamError("telegram_unavailable", data.get("error_code"))
            return data["result"]
        except urllib.error.HTTPError as error:
            raise UpstreamError("telegram_unavailable", error.code) from None
        except (OSError, ValueError):
            raise UpstreamError("telegram_unavailable") from None

    def membership(self, user_id):
        data = self.call("getChatMember", {"chat_id": self.config.channel, "user_id": user_id})
        status = data.get("status", "unknown")
        subscribed = status in {"creator", "administrator", "member"} or (status == "restricted" and data.get("is_member") is True)
        return subscribed, status

    def send(self, user_id, text, keyboard=None):
        payload = {"chat_id": user_id, "text": render_message(text), "parse_mode": "HTML", "link_preview_options": {"is_disabled": True}}
        if keyboard:
            payload["reply_markup"] = {"inline_keyboard": keyboard}
        return self.call("sendMessage", payload)

    def send_document(self, user_id, filename, content):
        boundary="pravox"+uuid.uuid4().hex
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{user_id}\r\n'
              f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{filename}"\r\n'
              'Content-Type: text/csv\r\n\r\n').encode()+content+f'\r\n--{boundary}--\r\n'.encode()
        req=urllib.request.Request(f"https://api.telegram.org/bot{self.config.bot_token}/sendDocument",data=body,
            headers={"Content-Type":"multipart/form-data; boundary="+boundary})
        try:
            with urllib.request.urlopen(req,timeout=30) as response:
                data=json.load(response)
            if not data.get("ok"):raise UpstreamError("telegram_document_failed")
            return data["result"]
        except urllib.error.HTTPError as error:
            raise UpstreamError("telegram_document_failed",error.code) from None
        except (OSError,ValueError):
            raise UpstreamError("telegram_document_failed") from None

    def gate_keyboard(self):
        return [[{"text": "Подписаться на правоХ", "url": self.config.channel_url}],
                [{"text": "Проверить подписку", "callback_data": "check_membership"}]]

    def menu_keyboard(self, admin=False):
        rows = [[{"text": "Для жизни", "callback_data": "mode:citizen"}, {"text": "Для учёбы", "callback_data": "mode:student"}]]
        if self.config.public_url.startswith("https://"):
            rows.insert(0,[{"text": "Открыть приложение", "web_app": {"url": self.config.public_url.rstrip("/") + "/"}}])
            if admin:
                rows.append([{"text": "Статистика", "web_app": {"url": self.config.public_url.rstrip("/") + "/#admin"}}])
        return rows


def split_message(text, limit=3500):
    """Split before rendering HTML; prefer paragraphs and preserve every character."""
    if limit < 2:
        raise ValueError("limit must allow at least one UTF-16 surrogate pair")
    chunks = []
    while text:
        length, end = 0, 0
        for char in text:
            size = 2 if ord(char) > 0xFFFF else 1
            if length + size > limit:
                break
            length += size
            end += 1
        if end < len(text):
            for separator in ("\n\n", "\n", " "):
                boundary = text.rfind(separator, end // 2, end)
                if boundary >= 0:
                    end = boundary + len(separator)
                    break
        chunks.append(text[:end])
        text = text[end:]
    return chunks

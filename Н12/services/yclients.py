"""
services/yclients.py

Синхронный клиент для реальной проверки и тестовой выдачи бонусных часов через YCLIENTS.

Используется скриптом:
    python scripts/test_issue_bonus_hours.py --phone 89896179338 --hours 1 --apply

ВАЖНО:
- Без --apply скрипт ничего не меняет.
- С --apply этот файл делает реальные HTTP-запросы в YCLIENTS.
- Для выдачи через карту/абонемент нужно заполнить YCLIENTS_CHAIN_ID и один из вариантов:
    1) YCLIENTS_LOYALTY_CARD_ID — пополнить уже существующую карту/абонемент клиента
    2) YCLIENTS_LOYALTY_CARD_TYPE_ID — попробовать выдать новую карту/абонемент клиенту
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BASE_URL = "https://api.yclients.com/api/v1"
ACCEPT = "application/vnd.yclients.v2+json"


def _load_env() -> None:
    """Мини-загрузчик .env без python-dotenv."""
    root = Path(__file__).resolve().parents[1]
    env_path = root / ".env"
    if not env_path.exists():
        return

    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env()


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_int(name: str, default: int = 0) -> int:
    try:
        return int(_env(name, str(default)))
    except (TypeError, ValueError):
        return default


YCLIENTS_COMPANY_ID = _env("YCLIENTS_COMPANY_ID")
YCLIENTS_PARTNER_TOKEN = _env("YCLIENTS_PARTNER_TOKEN")
YCLIENTS_USER_TOKEN = _env("YCLIENTS_USER_TOKEN")

# Для карт/абонементов лояльности
YCLIENTS_CHAIN_ID = _env("YCLIENTS_CHAIN_ID")
YCLIENTS_LOYALTY_CARD_ID = _env("YCLIENTS_LOYALTY_CARD_ID")
YCLIENTS_LOYALTY_CARD_TYPE_ID = _env("YCLIENTS_LOYALTY_CARD_TYPE_ID")

TIMEOUT_SECONDS = _env_int("YCLIENTS_TIMEOUT_SECONDS", 25)


class YClientsError(RuntimeError):
    pass


@dataclass
class YClientsResponse:
    ok: bool
    status: int
    data: Any
    url: str
    method: str

    def short(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "status": self.status,
            "method": self.method,
            "url": self.url,
            "data": self.data,
        }


def normalize_phone(phone: str) -> str:
    phone = re.sub(r"\D+", "", str(phone or ""))
    if len(phone) == 11 and phone.startswith("8"):
        phone = "7" + phone[1:]
    if len(phone) == 10:
        phone = "7" + phone
    return phone


def _require_settings() -> None:
    missing = []
    if not YCLIENTS_COMPANY_ID:
        missing.append("YCLIENTS_COMPANY_ID")
    if not YCLIENTS_PARTNER_TOKEN:
        missing.append("YCLIENTS_PARTNER_TOKEN")
    if not YCLIENTS_USER_TOKEN:
        missing.append("YCLIENTS_USER_TOKEN")
    if missing:
        raise YClientsError("Не заполнены переменные .env: " + ", ".join(missing))


def _headers() -> dict[str, str]:
    _require_settings()
    return {
        "Authorization": f"Bearer {YCLIENTS_PARTNER_TOKEN}, User {YCLIENTS_USER_TOKEN}",
        "Accept": ACCEPT,
        "Content-Type": "application/json",
    }


def _request(method: str, path: str, payload: dict[str, Any] | None = None) -> YClientsResponse:
    url = BASE_URL + path
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(
        url=url,
        data=body,
        method=method.upper(),
        headers=_headers(),
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                data = raw

            return YClientsResponse(
                ok=200 <= resp.status < 300,
                status=resp.status,
                data=data,
                url=url,
                method=method.upper(),
            )

    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            data = raw

        return YClientsResponse(
            ok=False,
            status=exc.code,
            data=data,
            url=url,
            method=method.upper(),
        )

    except urllib.error.URLError as exc:
        raise YClientsError(f"Ошибка соединения с YCLIENTS: {exc}") from exc


def _unwrap_data(resp: YClientsResponse) -> Any:
    if not resp.ok:
        raise YClientsError(f"YCLIENTS HTTP {resp.status}: {resp.data}")

    data = resp.data
    if isinstance(data, dict) and data.get("success") is False:
        raise YClientsError(f"YCLIENTS success=false: {data}")

    if isinstance(data, dict) and "data" in data:
        return data["data"]

    return data


def check_yclients_connection() -> dict[str, Any]:
    """
    Реальная проверка авторизации и company_id.
    Ничего не изменяет.
    """
    resp = _request("GET", f"/company/{YCLIENTS_COMPANY_ID}/")
    return resp.short()


def find_client_by_phone(phone: str) -> dict[str, Any] | None:
    """
    Реально ищет клиента в YCLIENTS по телефону.
    """
    phone_norm = normalize_phone(phone)
    if not phone_norm:
        raise YClientsError("Пустой или некорректный телефон")

    payload_variants = [
        {
            "phone": phone_norm,
            "fields": ["id", "name", "display_name", "phone", "balance"],
            "page_size": 200,
        },
        {
            "filters": [{"type": "quick_search", "state": {"value": phone_norm}}],
            "fields": ["id", "name", "display_name", "phone", "balance"],
            "page_size": 200,
        },
    ]

    last_resp: YClientsResponse | None = None

    for payload in payload_variants:
        resp = _request("POST", f"/company/{YCLIENTS_COMPANY_ID}/clients/search", payload)
        last_resp = resp
        if not resp.ok:
            continue

        data = _unwrap_data(resp)
        clients = []

        if isinstance(data, list):
            clients = data
        elif isinstance(data, dict):
            for key in ("clients", "items", "records"):
                if isinstance(data.get(key), list):
                    clients = data[key]
                    break

        for client in clients:
            if not isinstance(client, dict):
                continue
            client_phone = normalize_phone(str(client.get("phone", "")))
            if client_phone and client_phone[-10:] == phone_norm[-10:]:
                return client

    if last_resp and not last_resp.ok:
        raise YClientsError(f"Не удалось найти клиента, последний ответ YCLIENTS: {last_resp.short()}")

    return None


def get_loyalty_cards_by_phone(phone: str) -> dict[str, Any]:
    """
    Реально получает карты/абонементы клиента по телефону.
    Ничего не изменяет.
    Требует YCLIENTS_CHAIN_ID.
    """
    if not YCLIENTS_CHAIN_ID:
        raise YClientsError("Для проверки карт/абонементов заполни YCLIENTS_CHAIN_ID в .env")

    phone_norm = normalize_phone(phone)
    resp = _request(
        "GET",
        f"/loyalty/cards/{phone_norm}/{YCLIENTS_CHAIN_ID}/{YCLIENTS_COMPANY_ID}",
    )
    return resp.short()


def get_loyalty_cards_by_client_id(client_id: int | str) -> dict[str, Any]:
    """
    Реально получает карты/абонементы клиента по client_id.
    Ничего не изменяет.
    """
    resp = _request("GET", f"/loyalty/client_cards/{client_id}")
    return resp.short()


def create_loyalty_card_for_client(client: dict[str, Any], hours: int) -> dict[str, Any]:
    """
    Пытается реально выдать новую карту/абонемент клиенту.

    Точный набор полей может отличаться в конкретном аккаунте YCLIENTS,
    поэтому функция пробует несколько безопасных вариантов payload.
    """
    if not YCLIENTS_LOYALTY_CARD_TYPE_ID:
        raise YClientsError("Для выдачи новой карты/абонемента заполни YCLIENTS_LOYALTY_CARD_TYPE_ID в .env")

    client_id = client.get("id")
    phone = normalize_phone(str(client.get("phone", "")))
    name = client.get("name") or client.get("display_name") or "Клиент"

    payload_variants = [
        {
            "type_id": int(YCLIENTS_LOYALTY_CARD_TYPE_ID),
            "client_id": int(client_id),
            "balance": int(hours),
            "comment": f"Тестовая выдача бонусного абонемента: {hours} ч",
        },
        {
            "card_type_id": int(YCLIENTS_LOYALTY_CARD_TYPE_ID),
            "client_id": int(client_id),
            "balance": int(hours),
            "comment": f"Тестовая выдача бонусного абонемента: {hours} ч",
        },
        {
            "type_id": int(YCLIENTS_LOYALTY_CARD_TYPE_ID),
            "phone": phone,
            "name": name,
            "balance": int(hours),
            "comment": f"Тестовая выдача бонусного абонемента: {hours} ч",
        },
    ]

    errors: list[dict[str, Any]] = []

    for payload in payload_variants:
        resp = _request("POST", f"/loyalty/cards/{YCLIENTS_COMPANY_ID}", payload)
        if resp.ok and not (isinstance(resp.data, dict) and resp.data.get("success") is False):
            return {
                "mode": "create_loyalty_card",
                "payload_used": payload,
                "response": resp.short(),
            }
        errors.append({"payload": payload, "response": resp.short()})

    raise YClientsError(f"YCLIENTS не принял payload выдачи карты/абонемента: {errors}")


def add_manual_loyalty_transaction(card_id: int | str, hours: int) -> dict[str, Any]:
    payload = {
        "amount": float(hours),
        "title": f"Тестовое начисление бонусных часов: +{hours} ч",
    }

    resp = _request(
        "POST",
        f"/company/{YCLIENTS_COMPANY_ID}/loyalty/cards/{card_id}/manual_transaction",
        payload,
    )

    if resp.ok and not (isinstance(resp.data, dict) and resp.data.get("success") is False):
        return {
            "mode": "manual_loyalty_transaction",
            "card_id": card_id,
            "payload_used": payload,
            "response": resp.short(),
        }

    raise YClientsError(f"YCLIENTS не принял ручную транзакцию: {resp.short()}")


def issue_bonus_hours(phone: str, hours: int) -> dict[str, Any]:
    """
    Реальная проверка + реальная попытка выдачи.

    Последовательность:
    1. Проверяет доступ к YCLIENTS.
    2. Ищет клиента по телефону.
    3. Проверяет карты/абонементы клиента, если есть YCLIENTS_CHAIN_ID.
    4. Если указан YCLIENTS_LOYALTY_CARD_ID — пополняет эту карту/абонемент.
    5. Иначе если указан YCLIENTS_LOYALTY_CARD_TYPE_ID — пробует выдать новую карту/абонемент.
    """
    if hours <= 0:
        raise YClientsError("hours должен быть больше 0")

    connection = check_yclients_connection()

    client = find_client_by_phone(phone)
    if not client:
        raise YClientsError(f"Клиент с телефоном {phone} не найден в YCLIENTS")

    checks: dict[str, Any] = {
        "connection": connection,
        "client": client,
    }

    try:
        checks["cards_by_phone"] = get_loyalty_cards_by_phone(phone)
    except Exception as exc:
        checks["cards_by_phone_error"] = str(exc)

    try:
        if client.get("id"):
            checks["cards_by_client_id"] = get_loyalty_cards_by_client_id(client["id"])
    except Exception as exc:
        checks["cards_by_client_id_error"] = str(exc)

    if YCLIENTS_LOYALTY_CARD_ID:
        issue_result = add_manual_loyalty_transaction(YCLIENTS_LOYALTY_CARD_ID, hours)
    elif YCLIENTS_LOYALTY_CARD_TYPE_ID:
        issue_result = create_loyalty_card_for_client(client, hours)
    else:
        raise YClientsError(
            "Реальная проверка YCLIENTS прошла, но выдача не выполнена: "
            "заполни YCLIENTS_LOYALTY_CARD_ID или YCLIENTS_LOYALTY_CARD_TYPE_ID в .env"
        )

    return {
        "success": True,
        "message": "Реальная операция YCLIENTS выполнена. Проверь клиента в интерфейсе YCLIENTS.",
        "checks": checks,
        "issue_result": issue_result,
    }

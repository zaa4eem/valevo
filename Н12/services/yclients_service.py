import asyncio
import logging
import re
from typing import Any, Optional

import aiohttp

from config import (
    YCLIENTS_COMPANY_ID, YCLIENTS_PARTNER_TOKEN, YCLIENTS_USER_TOKEN,
    YCLIENTS_LOYALTY_CARD_TYPE_ID, YCLIENTS_BONUS_RUB_PER_HOUR, YCLIENTS_ISSUE_CASHBACK,
    YCLIENTS_AUTO_CREATE_LOYALTY_CARDS,
)

logger = logging.getLogger(__name__)
BASE_URL = "https://api.yclients.com/api/v1"
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=25, connect=8, sock_read=15)


def yclients_enabled() -> bool:
    return bool(YCLIENTS_COMPANY_ID and YCLIENTS_PARTNER_TOKEN and YCLIENTS_USER_TOKEN)


def get_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {YCLIENTS_PARTNER_TOKEN}, User {YCLIENTS_USER_TOKEN}",
        "Accept": "application/vnd.yclients.v2+json",
        "Content-Type": "application/json",
    }


def normalize_phone(phone: str) -> str:
    phone = re.sub(r"\D+", "", str(phone or ""))
    if len(phone) == 11 and phone.startswith("8"):
        phone = "7" + phone[1:]
    if len(phone) == 10:
        phone = "7" + phone
    return phone


async def _request(method: str, url: str, *, session: aiohttp.ClientSession | None = None, **kwargs) -> Optional[dict[str, Any]]:
    if not yclients_enabled():
        logger.warning("YCLIENTS отключён: заполните YCLIENTS_COMPANY_ID / PARTNER_TOKEN / USER_TOKEN в .env")
        return None

    async def _do(sess: aiohttp.ClientSession):
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                async with sess.request(method, url, headers=get_headers(), timeout=REQUEST_TIMEOUT, **kwargs) as resp:
                    text = await resp.text()
                    if resp.status in (429, 500, 502, 503, 504):
                        await asyncio.sleep(1.5 * (attempt + 1))
                        continue
                    try:
                        data = await resp.json(content_type=None)
                    except Exception:
                        logger.warning("YCLIENTS %s %s: статус %s, не JSON: %s", method, url, resp.status, text[:300])
                        return {"success": False, "meta": {"message": text[:300], "status": resp.status}}
                    if resp.status >= 400:
                        logger.warning("YCLIENTS %s %s: статус %s, ответ: %s", method, url, resp.status, data)
                        return {"success": False, "data": data.get("data") if isinstance(data, dict) else None,
                                "meta": data.get("meta") if isinstance(data, dict) else {"status": resp.status}}
                    return data
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                last_error = e
                await asyncio.sleep(1.5 * (attempt + 1))
        if last_error:
            logger.error("YCLIENTS %s %s exception: %r", method, url, last_error)
        return {"success": False, "meta": {"message": repr(last_error)}}

    if session:
        return await _do(session)
    async with aiohttp.ClientSession() as sess:
        return await _do(sess)


def _extract_records(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        for key in ("records", "clients", "items"):
            value = data.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
        if all(k in data for k in ("id", "phone")):
            return [data]
    return []


def _unwrap_yclients_data(response: dict[str, Any] | None) -> Any:
    if not response or not isinstance(response, dict) or not response.get("success"):
        return None
    return response.get("data")


def _error_message(response: dict[str, Any] | None) -> str:
    if not isinstance(response, dict):
        return "нет ответа YCLIENTS"
    meta = response.get("meta")
    if isinstance(meta, dict):
        return str(meta.get("message") or meta)
    return str(response)[:500]


async def find_client_by_phone(phone: str, session: aiohttp.ClientSession | None = None):
    phone_norm = normalize_phone(phone)
    if not phone_norm:
        return None
    url = f"{BASE_URL}/company/{YCLIENTS_COMPANY_ID}/clients/search"
    payloads = [
        {"phone": phone_norm, "fields": ["id", "name", "display_name", "phone", "balance"], "page_size": 200},
        {"filters": [{"type": "quick_search", "state": {"value": phone_norm}}],
         "fields": ["id", "name", "display_name", "phone", "balance"], "page_size": 200},
    ]
    for payload in payloads:
        data = await _request("POST", url, session=session, json=payload)
        if not data or not data.get("success"):
            continue
        for client in _extract_records(data.get("data")):
            client_phone = normalize_phone(client.get("phone", ""))
            if client_phone and client_phone[-10:] == phone_norm[-10:]:
                return client
    return None


async def get_client(client_id: int, session: aiohttp.ClientSession | None = None):
    if not client_id:
        return None
    url = f"{BASE_URL}/client/{YCLIENTS_COMPANY_ID}/{client_id}"
    data = await _request("GET", url, session=session)
    if data and data.get("success") and isinstance(data.get("data"), dict):
        return data["data"]
    return None


async def get_client_total_hours(client_id: int, session: aiohttp.ClientSession | None = None) -> float:
    if not client_id:
        return 0.0
    url = f"{BASE_URL}/company/{YCLIENTS_COMPANY_ID}/clients/visits/search"
    data = await _request("POST", url, session=session, json={"client_id": client_id})
    if not data or not data.get("success"):
        return 0.0
    records = _extract_records(data.get("data"))
    total_hours = 0.0
    for record in records:
        if record.get("attendance") == -1:
            continue
        for service in record.get("services") or []:
            title = str(service.get("title", ""))
            try:
                amount = float(service.get("amount") or 1)
            except (TypeError, ValueError):
                amount = 1
            minutes = 0.0
            hour_match = re.search(r"(\d+(?:[.,]\d+)?)\s*час", title, re.I)
            minute_match = re.search(r"(\d+)\s*мин", title, re.I)
            if hour_match:
                minutes += float(hour_match.group(1).replace(",", ".")) * 60
            if minute_match:
                minutes += int(minute_match.group(1))
            if minutes:
                total_hours += minutes * amount / 60
    return round(total_hours, 1)


def _client_update_payload(client: dict[str, Any], **updates) -> dict[str, Any]:
    payload = {"name": client.get("name") or client.get("display_name") or "Клиент", "phone": client.get("phone") or ""}
    for optional in ("surname", "patronymic", "email", "comment", "birth_date", "sex_id"):
        if optional in client and client.get(optional) not in (None, ""):
            payload[optional] = client.get(optional)
    payload.update(updates)
    return payload


async def update_bonus_hours(client_id: int, delta_hours: float):
    client = await get_client(client_id)
    if not client:
        return None
    custom_fields = client.get("custom_fields") if isinstance(client.get("custom_fields"), dict) else {}
    try:
        current = float(custom_fields.get("bonus_count", 0) or 0)
    except (ValueError, TypeError):
        current = 0.0
    new_value = max(0.0, round(current + float(delta_hours), 1))
    payload = _client_update_payload(client, custom_fields={**custom_fields, "bonus_count": str(new_value)})
    url = f"{BASE_URL}/client/{YCLIENTS_COMPANY_ID}/{client_id}"
    data = await _request("PUT", url, json=payload)
    return new_value if data and data.get("success") else None


async def get_bonus_hours(client_id: int) -> float:
    client = await get_client(client_id)
    if client and isinstance(client.get("custom_fields"), dict):
        try:
            return float(client["custom_fields"].get("bonus_count", 0) or 0)
        except (ValueError, TypeError):
            return 0.0
    return 0.0


async def update_balance(client_id: int, delta: float):
    client = await get_client(client_id)
    if not client:
        return None
    try:
        current_balance = float(client.get("balance", 0) or 0)
    except (TypeError, ValueError):
        current_balance = 0.0
    new_balance = round(current_balance + float(delta), 2)
    payload = _client_update_payload(client, balance=new_balance)
    url = f"{BASE_URL}/client/{YCLIENTS_COMPANY_ID}/{client_id}"
    data = await _request("PUT", url, json=payload)
    return new_balance if data and data.get("success") else None


# ---------- Valevo Bonus / Loyalty cashback ----------
async def get_client_loyalty_cards(client_id: int, session: aiohttp.ClientSession | None = None) -> list[dict[str, Any]]:
    if not client_id:
        return []
    url = f"{BASE_URL}/loyalty/client_cards/{client_id}"
    data = await _request("GET", url, session=session)
    cards = _unwrap_yclients_data(data)
    return [card for card in cards if isinstance(card, dict)] if isinstance(cards, list) else []


async def find_valevo_bonus_card(client_id: int, session: aiohttp.ClientSession | None = None) -> dict[str, Any] | None:
    cards = await get_client_loyalty_cards(client_id, session=session)
    if not cards:
        return None
    configured_type_id = str(YCLIENTS_LOYALTY_CARD_TYPE_ID or "").strip()
    for card in cards:
        if configured_type_id and str(card.get("type_id")) == configured_type_id:
            return card
    for card in cards:
        card_type = card.get("type") if isinstance(card.get("type"), dict) else {}
        title = str(card_type.get("title") or card.get("title") or "").lower()
        if "valevo" in title and "bonus" in title:
            return card
    return None


async def create_valevo_bonus_card(client_id: int, phone: str | None = None, name: str | None = None,
                                   session: aiohttp.ClientSession | None = None) -> dict[str, Any]:
    """Пробует выдать карту Valevo Bonus. Если конкретный аккаунт YCLIENTS запрещает API-выпуск — вернёт ok=False."""
    if not YCLIENTS_AUTO_CREATE_LOYALTY_CARDS:
        return {"ok": False, "status": "disabled", "message": "YCLIENTS_AUTO_CREATE_LOYALTY_CARDS=0"}
    if not YCLIENTS_LOYALTY_CARD_TYPE_ID:
        return {"ok": False, "status": "no_card_type", "message": "Не заполнен YCLIENTS_LOYALTY_CARD_TYPE_ID"}

    card_type_id = int(str(YCLIENTS_LOYALTY_CARD_TYPE_ID))
    payloads = [
        {"type_id": card_type_id, "client_id": int(client_id), "balance": 0, "comment": "Автовыпуск Valevo Bonus"},
        {"card_type_id": card_type_id, "client_id": int(client_id), "balance": 0, "comment": "Автовыпуск Valevo Bonus"},
    ]
    if phone:
        payloads.append({"type_id": card_type_id, "phone": normalize_phone(phone), "name": name or "Клиент", "balance": 0,
                         "comment": "Автовыпуск Valevo Bonus"})

    errors = []
    for payload in payloads:
        data = await _request("POST", f"{BASE_URL}/loyalty/cards/{YCLIENTS_COMPANY_ID}", session=session, json=payload)
        if data and data.get("success"):
            return {"ok": True, "status": "created", "data": data.get("data"), "payload": payload}
        errors.append(_error_message(data))
    return {"ok": False, "status": "create_failed", "message": "; ".join(errors[-3:]) or "YCLIENTS не выпустил карту"}


async def ensure_valevo_bonus_card(client_id: int, phone: str | None = None, name: str | None = None,
                                   session: aiohttp.ClientSession | None = None) -> dict[str, Any]:
    """Находит или пытается создать карту. Никогда не падает."""
    card = await find_valevo_bonus_card(client_id, session=session)
    if card:
        return {"ok": True, "status": "exists", "card": card}

    create_result = await create_valevo_bonus_card(client_id, phone=phone, name=name, session=session)
    if create_result.get("ok"):
        card = await find_valevo_bonus_card(client_id, session=session)
        if card:
            return {"ok": True, "status": "created", "card": card}
    return {"ok": False, "status": create_result.get("status", "card_not_found"),
            "message": create_result.get("message", "Карта Valevo Bonus не найдена и не создана")}


def _loyalty_card_balance(card: dict[str, Any] | None) -> float:
    if not isinstance(card, dict):
        return 0.0
    values: list[float] = []
    for key in ("points", "balance"):
        try:
            values.append(float(card.get(key) or 0))
        except (TypeError, ValueError):
            values.append(0.0)
    return round(max(values), 2)


async def get_valevo_bonus_balance(client_id: int, session: aiohttp.ClientSession | None = None) -> float:
    card = await find_valevo_bonus_card(client_id, session=session)
    return _loyalty_card_balance(card)


async def add_loyalty_cashback(card_id: int | str, amount_rub: float, title: str,
                               session: aiohttp.ClientSession | None = None) -> dict[str, Any] | None:
    amount = round(float(amount_rub), 2)
    if amount == 0:
        return None
    payload = {"amount": amount, "title": title[:255]}
    url = f"{BASE_URL}/company/{YCLIENTS_COMPANY_ID}/loyalty/cards/{card_id}/manual_transaction"
    data = await _request("POST", url, session=session, json=payload)
    if data and data.get("success"):
        return {"card_id": card_id, "amount": payload["amount"], "response": data}
    return None


async def change_valevo_bonus(client_id: int, delta_rub: float, title: str = "Valevo Bonus",
                              phone: str | None = None, name: str | None = None) -> dict[str, Any]:
    if not yclients_enabled():
        return {"ok": False, "status": "disabled", "message": "YCLIENTS credentials are missing"}
    if not client_id:
        return {"ok": False, "status": "no_client_id", "message": "У пилота нет yclients_client_id"}
    delta = round(float(delta_rub), 2)
    if delta == 0:
        return {"ok": False, "status": "zero_amount", "message": "Сумма не может быть 0"}

    async with aiohttp.ClientSession() as session:
        ensured = await ensure_valevo_bonus_card(client_id, phone=phone, name=name, session=session)
        if not ensured.get("ok"):
            return {"ok": False, "status": "card_not_found", "message": ensured.get("message"),
                    "client_id": client_id, "card_type_id": YCLIENTS_LOYALTY_CARD_TYPE_ID}
        card = ensured["card"]
        result = await add_loyalty_cashback(card_id=card["id"], amount_rub=delta, title=title, session=session)
        if not result:
            return {"ok": False, "status": "yclients_error", "message": "YCLIENTS не подтвердил транзакцию по карте Valevo Bonus",
                    "client_id": client_id, "card_id": card.get("id"), "amount": delta}
        new_balance = await get_valevo_bonus_balance(client_id, session=session)
        return {"ok": True, "status": "issued" if delta > 0 else "withdrawn", "client_id": client_id,
                "card_id": card.get("id"), "amount": delta, "balance": new_balance,
                "card_status": ensured.get("status")}


async def issue_season_cashback(client_id: int, bonus_hours: int, reason: str = "season_award") -> dict[str, Any]:
    if not YCLIENTS_ISSUE_CASHBACK:
        return {"ok": False, "status": "disabled", "message": "YCLIENTS_ISSUE_CASHBACK=0"}
    if not yclients_enabled():
        return {"ok": False, "status": "disabled", "message": "YCLIENTS credentials are missing"}
    if not client_id:
        return {"ok": False, "status": "no_client_id", "message": "У пилота нет yclients_client_id"}
    if not bonus_hours or bonus_hours <= 0:
        return {"ok": False, "status": "no_bonus", "message": "bonus_hours <= 0"}

    amount = round(float(bonus_hours) * float(YCLIENTS_BONUS_RUB_PER_HOUR), 2)
    result = await change_valevo_bonus(
        client_id=client_id,
        delta_rub=amount,
        title=f"Valevo сезонная награда: {amount:g} 💎 ({reason})",
    )
    if not result.get("ok"):
        result.update({"amount": amount, "bonus_hours": bonus_hours})
        return result
    result.update({"amount": amount, "bonus_hours": bonus_hours})
    return result

async def get_records() -> list[dict[str, Any]]:
    """Безопасный helper для старого booking_sync.py. Возвращает записи YCLIENTS, если API доступен."""
    if not yclients_enabled():
        return []
    data = await _request("GET", f"{BASE_URL}/records/{YCLIENTS_COMPANY_ID}")
    records = _unwrap_yclients_data(data)
    if isinstance(records, list):
        return [r for r in records if isinstance(r, dict)]
    return []

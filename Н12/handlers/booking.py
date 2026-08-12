from __future__ import annotations

import asyncio
import html
import logging
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import aiohttp
import aiosqlite
from aiogram import Bot, F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    FSInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from config import ADMIN_IDS, BASE_DIR, MOSCOW_TZ, YCLIENTS_COMPANY_ID
from database.db import get_db, get_pilot_by_telegram_id
from keyboards.menu import get_menu
from services.yclients_service import BASE_URL, REQUEST_TIMEOUT, _request, get_headers, normalize_phone

router = Router(name="booking")
logger = logging.getLogger(__name__)
TZ = ZoneInfo(MOSCOW_TZ)

# ============================================================================
# НАСТРОЙКА
# ============================================================================
# service_id из YCLIENTS.
STATIC_SERVICE_ID = 30002577
MOTION_SERVICE_ID = 30002577

# Укажи staff_id сотрудников-мест из YCLIENTS.
BOOKING_PLACES: dict[str, dict[str, Any]] = {
    "static_1": {"title": "Статика №3", "type": "static", "staff_id": 5056131},
    "static_2": {"title": "Статика №4", "type": "static", "staff_id": 5049963},
    "static_3": {"title": "Статика №5", "type": "static", "staff_id": 5045559},
    "static_4": {"title": "Статика №6", "type": "static", "staff_id": 5508072},
    "motion_1": {"title": "Подвижка №1", "type": "motion", "staff_id": 5045868},
    "motion_2": {"title": "Подвижка №2", "type": "motion", "staff_id": 5056140},
}

CLUB_MAP_PATH = Path(BASE_DIR) / "static" / "club_map.png"

MAX_PLACES_PER_BOOKING = 3
BOOKING_DAYS_AHEAD = 14
DURATION_OPTIONS = (30, 60, 90, 120, 180)
OPEN_TIME = time(12, 0)
CLOSE_TIME = time(0, 0)  # 00:00 следующего дня
BLOCKING_STATUSES = ("pending_admin", "creating", "confirmed", "user_confirmed")
USER_CANCELLABLE_STATUSES = ("pending_admin", "confirmed", "user_confirmed")


class BookingFlow(StatesGroup):
    selecting_places = State()
    choosing_date = State()
    entering_time = State()
    choosing_duration = State()
    confirming = State()


# ============================================================================
# БАЗА ДАННЫХ
# ============================================================================
async def ensure_booking_schema() -> None:
    db = await get_db()
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS booking_requests_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER NOT NULL,
            username TEXT,
            phone TEXT NOT NULL,
            display_name TEXT NOT NULL,
            yclients_client_id INTEGER,
            place_type TEXT NOT NULL,
            start_at TEXT NOT NULL,
            end_at TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending_admin',
            admin_id INTEGER,
            reminder_sent INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS booking_items_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER NOT NULL,
            place_key TEXT NOT NULL,
            place_title TEXT NOT NULL,
            staff_id INTEGER NOT NULL,
            service_id INTEGER NOT NULL,
            yclients_record_id TEXT,
            yclients_status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(booking_id, place_key),
            FOREIGN KEY(booking_id) REFERENCES booking_requests_v2(id) ON DELETE CASCADE
        )
        """
    )
    await db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_booking_v2_time_status
        ON booking_requests_v2(start_at, end_at, status)
        """
    )
    await db.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_booking_items_v2_staff
        ON booking_items_v2(staff_id, booking_id)
        """
    )
    await db.commit()
    await db.close()


async def _fetch_booking(booking_id: int) -> dict[str, Any] | None:
    db = await get_db()
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
        "SELECT * FROM booking_requests_v2 WHERE id = ?",
        (booking_id,),
    )
    row = await cur.fetchone()
    await cur.close()
    if not row:
        await db.close()
        return None

    cur = await db.execute(
        "SELECT * FROM booking_items_v2 WHERE booking_id = ? ORDER BY id",
        (booking_id,),
    )
    items = [dict(x) for x in await cur.fetchall()]
    await cur.close()
    await db.close()

    result = dict(row)
    result["items"] = items
    return result


async def _set_booking_status(
    booking_id: int,
    status: str,
    *,
    admin_id: int | None = None,
    error: str | None = None,
) -> None:
    db = await get_db()
    await db.execute(
        """
        UPDATE booking_requests_v2
        SET status = ?, admin_id = COALESCE(?, admin_id), last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (status, admin_id, error, booking_id),
    )
    await db.commit()
    await db.close()


async def _claim_for_admin(booking_id: int, admin_id: int) -> bool:
    db = await get_db()
    cur = await db.execute(
        """
        UPDATE booking_requests_v2
        SET status = 'creating', admin_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending_admin'
        """,
        (admin_id, booking_id),
    )
    changed = cur.rowcount == 1
    await db.commit()
    await db.close()
    return changed


async def _local_conflicts(
    staff_ids: list[int],
    start_at: datetime,
    end_at: datetime,
    *,
    exclude_booking_id: int | None = None,
) -> list[dict[str, Any]]:
    if not staff_ids:
        return []

    placeholders = ",".join("?" for _ in staff_ids)
    status_placeholders = ",".join("?" for _ in BLOCKING_STATUSES)
    params: list[Any] = [*staff_ids, *BLOCKING_STATUSES, end_at.isoformat(), start_at.isoformat()]
    exclude_sql = ""
    if exclude_booking_id is not None:
        exclude_sql = " AND br.id != ?"
        params.append(exclude_booking_id)

    db = await get_db()
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
        f"""
        SELECT br.id AS booking_id, br.start_at, br.end_at,
               bi.staff_id, bi.place_title
        FROM booking_requests_v2 br
        JOIN booking_items_v2 bi ON bi.booking_id = br.id
        WHERE bi.staff_id IN ({placeholders})
          AND br.status IN ({status_placeholders})
          AND br.start_at < ?
          AND br.end_at > ?
          {exclude_sql}
        ORDER BY br.start_at
        """,
        params,
    )
    rows = [dict(x) for x in await cur.fetchall()]
    await cur.close()
    await db.close()
    return rows


async def _create_pending_booking(
    *,
    pilot: dict[str, Any],
    username: str | None,
    place_type: str,
    place_keys: list[str],
    start_at: datetime,
    end_at: datetime,
    duration_minutes: int,
) -> tuple[bool, int | None, str | None]:
    staff_ids = [int(BOOKING_PLACES[key]["staff_id"]) for key in place_keys]
    db = await get_db()
    try:
        await db.execute("BEGIN IMMEDIATE")

        placeholders = ",".join("?" for _ in staff_ids)
        status_placeholders = ",".join("?" for _ in BLOCKING_STATUSES)
        cur = await db.execute(
            f"""
            SELECT bi.place_title, br.start_at, br.end_at
            FROM booking_requests_v2 br
            JOIN booking_items_v2 bi ON bi.booking_id = br.id
            WHERE bi.staff_id IN ({placeholders})
              AND br.status IN ({status_placeholders})
              AND br.start_at < ?
              AND br.end_at > ?
            LIMIT 1
            """,
            (*staff_ids, *BLOCKING_STATUSES, end_at.isoformat(), start_at.isoformat()),
        )
        conflict = await cur.fetchone()
        await cur.close()
        if conflict:
            await db.rollback()
            conflict_start = _parse_yclients_datetime(conflict[1])
            conflict_end = _parse_yclients_datetime(conflict[2])
            period = (
                f" {conflict_start.strftime('%H:%M')}–{conflict_end.strftime('%H:%M')}"
                if conflict_start and conflict_end else ""
            )
            return (
                False,
                None,
                f"{conflict[0]} уже занято{period} или ожидает подтверждения администратора.",
            )

        cur = await db.execute(
            """
            INSERT INTO booking_requests_v2 (
                telegram_id, username, phone, display_name, yclients_client_id,
                place_type, start_at, end_at, duration_minutes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_admin')
            """,
            (
                int(pilot["telegram_id"]),
                username or "",
                pilot.get("phone") or "",
                pilot.get("display_name") or pilot.get("username") or username or "Клиент",
                pilot.get("yclients_client_id"),
                place_type,
                start_at.isoformat(),
                end_at.isoformat(),
                duration_minutes,
            ),
        )
        booking_id = int(cur.lastrowid)

        service_id = _service_id_for_type(place_type)
        for key in place_keys:
            place = BOOKING_PLACES[key]
            await db.execute(
                """
                INSERT INTO booking_items_v2 (
                    booking_id, place_key, place_title, staff_id, service_id
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    booking_id,
                    key,
                    str(place["title"]),
                    int(place["staff_id"]),
                    service_id,
                ),
            )

        await db.commit()
        return True, booking_id, None
    except Exception as exc:
        await db.rollback()
        logger.exception("Не удалось создать заявку бронирования")
        return False, None, str(exc)
    finally:
        await db.close()


async def _save_yclients_record(booking_id: int, item_id: int, record_id: int | str) -> None:
    db = await get_db()
    await db.execute(
        """
        UPDATE booking_items_v2
        SET yclients_record_id = ?, yclients_status = 'created'
        WHERE id = ? AND booking_id = ?
        """,
        (str(record_id), item_id, booking_id),
    )
    await db.commit()
    await db.close()


# ============================================================================
# YCLIENTS
# ============================================================================
def _service_id_for_type(place_type: str) -> int:
    return int(STATIC_SERVICE_ID if place_type == "static" else MOTION_SERVICE_ID)


def _config_error(place_type: str, place_keys: list[str]) -> str | None:
    service_id = _service_id_for_type(place_type)
    if service_id <= 0:
        return "Не заполнен service_id для выбранного типа места в handlers/booking.py."
    for key in place_keys:
        staff_id = int(BOOKING_PLACES.get(key, {}).get("staff_id") or 0)
        if staff_id <= 0:
            return f"Не заполнен staff_id для «{BOOKING_PLACES.get(key, {}).get('title', key)}»."
    if not YCLIENTS_COMPANY_ID:
        return "Не заполнен YCLIENTS_COMPANY_ID в .env."
    return None


def _parse_yclients_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if re.search(r"[+-]\d{4}$", raw):
            raw = raw[:-5] + raw[-5:-2] + ":" + raw[-2:]
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=TZ)
        return parsed.astimezone(TZ)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                return datetime.strptime(raw, fmt).replace(tzinfo=TZ)
            except ValueError:
                continue
    return None


def _yclients_error_text(response: Any) -> str:
    if not isinstance(response, dict):
        return "YCLIENTS не вернул ответ"
    meta = response.get("meta")
    if isinstance(meta, dict):
        errors = meta.get("errors")
        if isinstance(errors, list) and errors:
            parts = [str(x.get("message") or x) for x in errors if isinstance(x, dict)]
            if parts:
                return "; ".join(parts)
        return str(meta.get("message") or meta)
    return str(response)[:500]


async def _yclients_records_for_staff(staff_id: int, day: date) -> tuple[list[dict[str, Any]], str | None]:
    response = await _request(
        "GET",
        f"{BASE_URL}/records/{YCLIENTS_COMPANY_ID}",
        params={
            "staff_id": staff_id,
            "start_date": day.isoformat(),
            "end_date": day.isoformat(),
            "count": 100,
        },
    )
    if not response or not response.get("success"):
        return [], _yclients_error_text(response)
    data = response.get("data")
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)], None
    if isinstance(data, dict):
        for key in ("records", "items", "data"):
            value = data.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)], None
    return [], None


async def _remote_conflicts(
    place_keys: list[str],
    start_at: datetime,
    end_at: datetime,
) -> tuple[list[str], str | None]:
    async def check_one(key: str) -> tuple[str | None, str | None]:
        place = BOOKING_PLACES[key]
        records, error = await _yclients_records_for_staff(int(place["staff_id"]), start_at.date())
        if error:
            return None, error
        for record in records:
            if bool(record.get("deleted")):
                continue
            other_start = _parse_yclients_datetime(
                record.get("datetime")
                or record.get("date")
                or record.get("start_at")
                or record.get("start")
            )
            if not other_start:
                continue

            raw_seconds = record.get("seance_length")
            if raw_seconds in (None, ""):
                raw_seconds = record.get("length")
            if raw_seconds in (None, ""):
                raw_seconds = record.get("duration")

            try:
                seconds = int(raw_seconds or 3600)
            except (TypeError, ValueError):
                seconds = 3600

            # В некоторых ответах duration приходит в минутах.
            if record.get("duration") not in (None, "") and record.get("seance_length") in (None, ""):
                seconds *= 60

            other_end = other_start + timedelta(seconds=max(seconds, 60))
            if other_start < end_at and other_end > start_at:
                return (
                    f"{place['title']} — занято "
                    f"{other_start.strftime('%H:%M')}–{other_end.strftime('%H:%M')}"
                ), None
        return None, None

    results = await asyncio.gather(*(check_one(key) for key in place_keys))
    conflicts = [title for title, _ in results if title]
    errors = [error for _, error in results if error]
    return conflicts, (errors[0] if errors else None)


async def _create_yclients_record(booking: dict[str, Any], item: dict[str, Any]) -> tuple[int | None, str | None]:
    start_at = datetime.fromisoformat(booking["start_at"]).astimezone(TZ)
    payload = {
        "staff_id": int(item["staff_id"]),
        "services": [{"id": int(item["service_id"])}],
        "client": {
            "phone": normalize_phone(booking.get("phone") or ""),
            "name": booking.get("display_name") or "Клиент",
            "surname": "",
            "patronymic": "",
            "email": "",
        },
        "save_if_busy": False,
        "datetime": start_at.strftime("%Y-%m-%d %H:%M:%S"),
        "seance_length": int(booking["duration_minutes"]) * 60,
        "send_sms": False,
        "comment": (
            f"VALEVO Telegram booking #{booking['id']} | {item['place_title']} | "
            f"telegram_id={booking['telegram_id']}"
        ),
        "sms_remain_hours": 0,
        "email_remain_hours": 0,
        "attendance": 0,
        "api_id": f"valevo-{booking['id']}-{item['place_key']}",
    }
    response = await _request(
        "POST",
        f"{BASE_URL}/records/{YCLIENTS_COMPANY_ID}",
        json=payload,
    )
    if not response or not response.get("success"):
        return None, _yclients_error_text(response)

    data = response.get("data")
    record: dict[str, Any] | None = None
    if isinstance(data, list) and data and isinstance(data[0], dict):
        record = data[0]
    elif isinstance(data, dict):
        record = data
    record_id = record.get("id") if record else None
    if not record_id:
        return None, "YCLIENTS создал запись, но не вернул её id"
    return int(record_id), None


async def _delete_yclients_record(record_id: int | str) -> tuple[bool, str | None]:
    url = f"{BASE_URL}/record/{YCLIENTS_COMPANY_ID}/{record_id}"
    try:
        async with aiohttp.ClientSession(timeout=REQUEST_TIMEOUT) as session:
            async with session.delete(url, headers=get_headers()) as response:
                if response.status in (200, 202, 204):
                    return True, None
                text = await response.text()
                return False, f"YCLIENTS DELETE {record_id}: HTTP {response.status}: {text[:300]}"
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        return False, repr(exc)


# ============================================================================
# КЛАВИАТУРЫ И ФОРМАТИРОВАНИЕ
# ============================================================================
def _type_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🖥 Статичные — 4 места", callback_data="bk:type:static")],
            [InlineKeyboardButton(text="🏎 Подвижные — 2 места", callback_data="bk:type:motion")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="bk:cancel")],
        ]
    )


def _places_keyboard(place_type: str, selected: list[str]) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    places = [(key, value) for key, value in BOOKING_PLACES.items() if value["type"] == place_type]
    for index in range(0, len(places), 2):
        row = []
        for key, place in places[index:index + 2]:
            checked = "✅ " if key in selected else ""
            row.append(InlineKeyboardButton(text=checked + str(place["title"]), callback_data=f"bk:place:{key}"))
        rows.append(row)
    rows.append([InlineKeyboardButton(text=f"Продолжить ({len(selected)}) ➡️", callback_data="bk:places_done")])
    rows.append([InlineKeyboardButton(text="❌ Отмена", callback_data="bk:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _date_keyboard() -> InlineKeyboardMarkup:
    today = datetime.now(TZ).date()
    weekdays = ("пн", "вт", "ср", "чт", "пт", "сб", "вс")
    buttons = []
    for offset in range(BOOKING_DAYS_AHEAD):
        day = today + timedelta(days=offset)
        prefix = "Сегодня" if offset == 0 else "Завтра" if offset == 1 else weekdays[day.weekday()]
        buttons.append(
            InlineKeyboardButton(
                text=f"{prefix}, {day.strftime('%d.%m')}",
                callback_data=f"bk:date:{day.isoformat()}",
            )
        )
    rows = [[buttons[0]]]
    if len(buttons) > 1:
        rows.extend([buttons[i:i + 2] for i in range(1, len(buttons), 2)])
    rows.append([InlineKeyboardButton(text="❌ Отмена", callback_data="bk:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _time_keyboard(selected_date: date) -> InlineKeyboardMarkup:
    now = datetime.now(TZ)
    buttons: list[InlineKeyboardButton] = []

    current = datetime.combine(selected_date, OPEN_TIME, tzinfo=TZ)
    finish = datetime.combine(selected_date + timedelta(days=1), CLOSE_TIME, tzinfo=TZ)

    while current < finish:
        # Для сегодняшней даты скрываем уже начавшиеся и прошедшие слоты.
        if current > now:
            value = current.strftime("%H:%M")
            buttons.append(
                InlineKeyboardButton(
                    text=value,
                    callback_data=f"bk:time:{value}",
                )
            )
        current += timedelta(minutes=30)

    rows = [buttons[i:i + 4] for i in range(0, len(buttons), 4)]
    if not buttons:
        rows.append(
            [
                InlineKeyboardButton(
                    text="На сегодня время закончилось",
                    callback_data="bk:no_time",
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="❌ Отмена", callback_data="bk:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _duration_keyboard() -> InlineKeyboardMarkup:
    labels = {30: "30 мин", 60: "1 час", 90: "1,5 часа", 120: "2 часа", 180: "3 часа"}
    buttons = [InlineKeyboardButton(text=labels[x], callback_data=f"bk:duration:{x}") for x in DURATION_OPTIONS]
    return InlineKeyboardMarkup(
        inline_keyboard=[buttons[:3], buttons[3:], [InlineKeyboardButton(text="❌ Отмена", callback_data="bk:cancel")]]
    )


def _confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ Отправить заявку", callback_data="bk:submit")],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="bk:cancel")],
        ]
    )


def _admin_keyboard(booking_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"bkadm:approve:{booking_id}"),
                InlineKeyboardButton(text="❌ Отклонить", callback_data=f"bkadm:reject:{booking_id}"),
            ]
        ]
    )


def _user_cancel_keyboard(booking_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отменить бронь", callback_data=f"bkuser:cancel:{booking_id}")]
        ]
    )


def _reminder_keyboard(booking_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Приду", callback_data=f"bkrem:confirm:{booking_id}"),
                InlineKeyboardButton(text="❌ Отменить", callback_data=f"bkrem:cancel:{booking_id}"),
            ]
        ]
    )


def _h(value: Any) -> str:
    return html.escape(str(value or ""), quote=False)


def _message_html(message: Message) -> str:
    # aiogram обычно предоставляет html_text; fallback нужен для совместимости.
    try:
        value = message.html_text
        if value:
            return value
    except Exception:
        pass
    return _h(message.text or "")


def _format_booking(booking: dict[str, Any]) -> str:
    start_at = datetime.fromisoformat(booking["start_at"]).astimezone(TZ)
    end_at = datetime.fromisoformat(booking["end_at"]).astimezone(TZ)
    places = ", ".join(_h(item["place_title"]) for item in booking.get("items", []))
    username = _h(booking.get("username"))
    return (
        f"🎟 <b>Бронирование #{int(booking['id'])}</b>\n\n"
        f"👤 {_h(booking.get('display_name'))}"
        + (f" (@{username})" if username else "")
        + f"\n📱 {_h(booking.get('phone'))}\n"
        f"🖥 Места: <b>{places}</b>\n"
        f"📅 Дата: <b>{start_at.strftime('%d.%m.%Y')}</b>\n"
        f"⏰ Время: <b>{start_at.strftime('%H:%M')}–{end_at.strftime('%H:%M')}</b>\n"
        f"⌛ Длительность: <b>{int(booking['duration_minutes'])} мин</b>"
    )


def _selection_summary(data: dict[str, Any]) -> str:
    start_at = datetime.fromisoformat(data["start_at"]).astimezone(TZ)
    end_at = datetime.fromisoformat(data["end_at"]).astimezone(TZ)
    places = ", ".join(BOOKING_PLACES[key]["title"] for key in data["selected_places"])
    return (
        "Проверьте заявку:\n\n"
        f"🖥 Места: <b>{places}</b>\n"
        f"📅 Дата: <b>{start_at.strftime('%d.%m.%Y')}</b>\n"
        f"⏰ Время: <b>{start_at.strftime('%H:%M')}–{end_at.strftime('%H:%M')}</b>\n"
        f"⌛ Длительность: <b>{data['duration_minutes']} мин</b>\n\n"
        "После отправки администратор подтвердит или отклонит заявку."
    )


async def _send_places_screen(message: Message, state: FSMContext, place_type: str, selected: list[str]) -> None:
    text = (
        "Выберите конкретные места.\n"
        f"Можно выбрать от 1 до {MAX_PLACES_PER_BOOKING}.\n\n"
        "На карте клуба номера должны совпадать с кнопками ниже."
    )
    keyboard = _places_keyboard(place_type, selected)
    if CLUB_MAP_PATH.exists():
        await message.answer_photo(FSInputFile(CLUB_MAP_PATH), caption=text, reply_markup=keyboard)
    else:
        await message.answer(text + "\n\n⚠️ Карта пока не загружена: static/club_map.png", reply_markup=keyboard)


# ============================================================================
# ПОЛЬЗОВАТЕЛЬСКИЙ СЦЕНАРИЙ
# ============================================================================
@router.message(Command("book"))
@router.message(F.text == "🎟 Забронировать")
async def booking_start(message: Message, state: FSMContext) -> None:
    pilot = await get_pilot_by_telegram_id(message.from_user.id)
    if not pilot:
        await message.answer("Сначала зарегистрируйтесь в боте через /start.", reply_markup=get_menu(message.from_user.id))
        return
    await state.clear()
    await message.answer("Что хотите забронировать?", reply_markup=_type_keyboard())


@router.callback_query(F.data.startswith("bk:type:"))
async def booking_choose_type(callback: CallbackQuery, state: FSMContext) -> None:
    place_type = callback.data.rsplit(":", 1)[1]
    if place_type not in {"static", "motion"}:
        await callback.answer("Неизвестный тип", show_alert=True)
        return
    await state.clear()
    await state.update_data(place_type=place_type, selected_places=[])
    await state.set_state(BookingFlow.selecting_places)
    await callback.answer()
    await _send_places_screen(callback.message, state, place_type, [])


@router.callback_query(BookingFlow.selecting_places, F.data.startswith("bk:place:"))
async def booking_toggle_place(callback: CallbackQuery, state: FSMContext) -> None:
    key = callback.data.rsplit(":", 1)[1]
    data = await state.get_data()
    place_type = data.get("place_type")
    if key not in BOOKING_PLACES or BOOKING_PLACES[key]["type"] != place_type:
        await callback.answer("Это место не относится к выбранному типу", show_alert=True)
        return

    selected = list(data.get("selected_places") or [])
    if key in selected:
        selected.remove(key)
    else:
        if len(selected) >= MAX_PLACES_PER_BOOKING:
            await callback.answer(f"Можно выбрать максимум {MAX_PLACES_PER_BOOKING} места", show_alert=True)
            return
        selected.append(key)
    await state.update_data(selected_places=selected)
    await callback.answer()
    try:
        await callback.message.edit_reply_markup(reply_markup=_places_keyboard(place_type, selected))
    except Exception:
        pass


@router.callback_query(BookingFlow.selecting_places, F.data == "bk:places_done")
async def booking_places_done(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    selected = list(data.get("selected_places") or [])
    if not selected:
        await callback.answer("Выберите хотя бы одно место", show_alert=True)
        return
    config_error = _config_error(str(data.get("place_type")), selected)
    if config_error:
        await callback.answer(config_error, show_alert=True)
        return
    await state.set_state(BookingFlow.choosing_date)
    await callback.answer()
    await callback.message.answer("Выберите дату:", reply_markup=_date_keyboard())


@router.callback_query(BookingFlow.choosing_date, F.data.startswith("bk:date:"))
async def booking_choose_date(callback: CallbackQuery, state: FSMContext) -> None:
    raw = callback.data.rsplit(":", 1)[1]
    try:
        selected_date = date.fromisoformat(raw)
    except ValueError:
        await callback.answer("Некорректная дата", show_alert=True)
        return
    today = datetime.now(TZ).date()
    if selected_date < today or selected_date >= today + timedelta(days=BOOKING_DAYS_AHEAD):
        await callback.answer("Эта дата недоступна", show_alert=True)
        return
    await state.update_data(selected_date=selected_date.isoformat())
    await state.set_state(BookingFlow.entering_time)
    await callback.answer()
    await callback.message.answer(
        "Выберите время или напишите его вручную в формате <b>18:35</b>.\n"
        "Клуб работает с 12:00 до 00:00.",
        reply_markup=_time_keyboard(selected_date),
    )


def _format_local_conflicts(conflicts: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    seen: set[tuple[Any, Any, Any]] = set()

    for conflict in conflicts:
        key = (
            conflict.get("staff_id"),
            conflict.get("start_at"),
            conflict.get("end_at"),
        )
        if key in seen:
            continue
        seen.add(key)

        title = str(conflict.get("place_title") or "Выбранное место")
        start = _parse_yclients_datetime(conflict.get("start_at"))
        end = _parse_yclients_datetime(conflict.get("end_at"))
        if start and end:
            parts.append(f"{title} — занято {start.strftime('%H:%M')}–{end.strftime('%H:%M')}")
        else:
            parts.append(f"{title} — занято")

    return "\n".join(parts)


@router.callback_query(BookingFlow.entering_time, F.data == "bk:no_time")
async def booking_no_time(callback: CallbackQuery) -> None:
    await callback.answer(
        "На сегодня будущих слотов не осталось. Выберите другую дату.",
        show_alert=True,
    )


async def _accept_time(raw: str, message: Message, state: FSMContext) -> None:
    try:
        selected_time = datetime.strptime(raw.strip(), "%H:%M").time()
    except ValueError:
        await message.answer("Введите время в формате <b>18:35</b>.")
        return

    if selected_time < OPEN_TIME:
        await message.answer("Клуб открывается в 12:00. Выберите более позднее время.")
        return

    data = await state.get_data()
    selected_date = date.fromisoformat(data["selected_date"])
    start_at = datetime.combine(selected_date, selected_time, tzinfo=TZ)
    now = datetime.now(TZ)

    if start_at <= now:
        await message.answer("Это время уже прошло. Выберите будущий слот.")
        return

    closing = datetime.combine(selected_date + timedelta(days=1), CLOSE_TIME, tzinfo=TZ)
    minimum_end = start_at + timedelta(minutes=min(DURATION_OPTIONS))
    if minimum_end > closing:
        await message.answer("До закрытия клуба осталось меньше 30 минут.")
        return

    selected = list(data.get("selected_places") or [])
    staff_ids = [int(BOOKING_PLACES[key]["staff_id"]) for key in selected]

    # Предварительная проверка хотя бы на минимальные 30 минут.
    # После выбора длительности проверка выполняется повторно на весь интервал.
    local = await _local_conflicts(staff_ids, start_at, minimum_end)
    if local:
        await message.answer(
            "❌ На выбранное время место уже занято:\n"
            + _format_local_conflicts(local)
            + "\n\nВыберите другое время."
        )
        return

    remote, remote_error = await _remote_conflicts(selected, start_at, minimum_end)
    if remote_error:
        await message.answer(
            "Не удалось проверить занятость в Сервисе. "
            "Попробуйте выбрать время ещё раз чуть позже."
        )
        return
    if remote:
        await message.answer(
            "❌ На выбранное время место уже занято:\n"
            + "\n".join(remote)
            + "\n\nВыберите другое время."
        )
        return

    await state.update_data(start_at=start_at.isoformat())
    await state.set_state(BookingFlow.choosing_duration)
    await message.answer("Выберите длительность:", reply_markup=_duration_keyboard())


@router.callback_query(BookingFlow.entering_time, F.data.startswith("bk:time:"))
async def booking_choose_time_callback(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    selected_time = callback.data.removeprefix("bk:time:")
    await _accept_time(selected_time, callback.message, state)


@router.message(BookingFlow.entering_time)
async def booking_choose_time_text(message: Message, state: FSMContext) -> None:
    await _accept_time(message.text or "", message, state)


@router.callback_query(BookingFlow.choosing_duration, F.data.startswith("bk:duration:"))
async def booking_choose_duration(callback: CallbackQuery, state: FSMContext) -> None:
    try:
        duration = int(callback.data.rsplit(":", 1)[1])
    except ValueError:
        await callback.answer("Некорректная длительность", show_alert=True)
        return
    if duration not in DURATION_OPTIONS:
        await callback.answer("Эта длительность недоступна", show_alert=True)
        return

    data = await state.get_data()
    start_at = datetime.fromisoformat(data["start_at"]).astimezone(TZ)
    if start_at <= datetime.now(TZ):
        await callback.answer("Выбранное время уже прошло. Начните бронирование заново.", show_alert=True)
        await state.clear()
        return
    end_at = start_at + timedelta(minutes=duration)
    closing = datetime.combine(start_at.date() + timedelta(days=1), CLOSE_TIME, tzinfo=TZ)
    if end_at > closing:
        await callback.answer("Бронь закончится после закрытия клуба", show_alert=True)
        return

    selected = list(data["selected_places"])
    staff_ids = [int(BOOKING_PLACES[key]["staff_id"]) for key in selected]
    local = await _local_conflicts(staff_ids, start_at, end_at)
    if local:
        await callback.answer(
            "Нельзя забронировать:\n" + _format_local_conflicts(local),
            show_alert=True,
        )
        return

    remote, remote_error = await _remote_conflicts(selected, start_at, end_at)
    if remote_error:
        await callback.answer("Сервис временно не отвечает. Попробуйте ещё раз чуть позже.", show_alert=True)
        return
    if remote:
        await callback.answer(
            "Нельзя забронировать:\n" + "\n".join(remote),
            show_alert=True,
        )
        return

    await state.update_data(
        duration_minutes=duration,
        end_at=end_at.isoformat(),
    )
    await state.set_state(BookingFlow.confirming)
    await callback.answer()
    final_data = await state.get_data()
    await callback.message.answer(_selection_summary(final_data), reply_markup=_confirm_keyboard())


@router.callback_query(BookingFlow.confirming, F.data == "bk:submit")
async def booking_submit(callback: CallbackQuery, state: FSMContext) -> None:
    pilot = await get_pilot_by_telegram_id(callback.from_user.id)
    if not pilot:
        await callback.answer("Профиль не найден", show_alert=True)
        return
    data = await state.get_data()
    selected = list(data["selected_places"])
    start_at = datetime.fromisoformat(data["start_at"]).astimezone(TZ)
    end_at = datetime.fromisoformat(data["end_at"]).astimezone(TZ)

    if start_at <= datetime.now(TZ):
        await callback.answer("Выбранное время уже прошло. Создайте новую заявку.", show_alert=True)
        await state.clear()
        return

    # Повторная проверка перед фиксацией заявки.
    remote, remote_error = await _remote_conflicts(selected, start_at, end_at)
    if remote_error:
        await callback.answer("Не удалось проверить Сервсис. Попробуйте позднее.", show_alert=True)
        return
    if remote:
        await callback.answer("Место уже заняли: " + ", ".join(remote), show_alert=True)
        return

    ok, booking_id, error = await _create_pending_booking(
        pilot=pilot,
        username=callback.from_user.username,
        place_type=data["place_type"],
        place_keys=selected,
        start_at=start_at,
        end_at=end_at,
        duration_minutes=int(data["duration_minutes"]),
    )
    if not ok or not booking_id:
        await callback.answer(error or "Не удалось создать заявку", show_alert=True)
        return

    booking = await _fetch_booking(booking_id)
    await state.clear()
    await callback.answer("Заявка отправлена")
    await callback.message.answer(
        "✅ Заявка отправлена администратору.",
        reply_markup=_user_cancel_keyboard(booking_id),
    )

    if booking:
        text = "📥 <b>Новая заявка на бронь</b>\n\n" + _format_booking(booking)
        for admin_id in ADMIN_IDS:
            try:
                await callback.bot.send_message(admin_id, text, reply_markup=_admin_keyboard(booking_id))
            except Exception as exc:
                logger.warning("Не удалось отправить бронь админу %s: %s", admin_id, exc)


@router.callback_query(F.data == "bk:cancel")
async def booking_cancel_flow(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer("Отменено")
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass
    await callback.message.answer("Бронирование отменено.", reply_markup=get_menu(callback.from_user.id))


# ============================================================================
# АДМИН: ПОДТВЕРЖДЕНИЕ / ОТКЛОНЕНИЕ
# ============================================================================
@router.callback_query(F.data.startswith("bkadm:reject:"))
async def admin_reject_booking(callback: CallbackQuery) -> None:
    if callback.from_user.id not in ADMIN_IDS:
        await callback.answer("Нет доступа", show_alert=True)
        return
    booking_id = int(callback.data.rsplit(":", 1)[1])
    booking = await _fetch_booking(booking_id)
    if not booking or booking["status"] != "pending_admin":
        await callback.answer("Заявка уже обработана", show_alert=True)
        return
    await _set_booking_status(booking_id, "rejected", admin_id=callback.from_user.id)
    await callback.answer("Отклонено")
    await callback.message.edit_text(_message_html(callback.message) + "\n\n❌ <b>Отклонено</b>")
    try:
        await callback.bot.send_message(
            booking["telegram_id"],
            "❌ Администратор отклонил заявку на бронирование. Выберите другое время или места.",
        )
    except Exception:
        pass


@router.callback_query(F.data.startswith("bkadm:approve:"))
async def admin_approve_booking(callback: CallbackQuery) -> None:
    if callback.from_user.id not in ADMIN_IDS:
        await callback.answer("Нет доступа", show_alert=True)
        return
    booking_id = int(callback.data.rsplit(":", 1)[1])
    if not await _claim_for_admin(booking_id, callback.from_user.id):
        await callback.answer("Заявка уже обрабатывается или обработана", show_alert=True)
        return

    booking = await _fetch_booking(booking_id)
    if not booking:
        await callback.answer("Заявка не найдена", show_alert=True)
        return

    start_at = datetime.fromisoformat(booking["start_at"]).astimezone(TZ)
    end_at = datetime.fromisoformat(booking["end_at"]).astimezone(TZ)
    place_keys = [item["place_key"] for item in booking["items"]]
    staff_ids = [int(item["staff_id"]) for item in booking["items"]]

    local = await _local_conflicts(staff_ids, start_at, end_at, exclude_booking_id=booking_id)
    if local:
        await _set_booking_status(booking_id, "pending_admin", error="Локальное пересечение")
        await callback.answer(f"Уже занято: {local[0]['place_title']}", show_alert=True)
        return

    remote, remote_error = await _remote_conflicts(place_keys, start_at, end_at)
    if remote_error:
        await _set_booking_status(booking_id, "pending_admin", error=remote_error)
        await callback.answer("Сервис не отвечает. Заявка оставлена на повторное подтверждение.", show_alert=True)
        return
    if remote:
        await _set_booking_status(booking_id, "pending_admin", error="Занято")
        await callback.answer("Занято: " + ", ".join(remote), show_alert=True)
        return

    created: list[tuple[int, int]] = []
    failure: str | None = None
    for item in booking["items"]:
        record_id, error = await _create_yclients_record(booking, item)
        if error or record_id is None:
            failure = error or "Неизвестная ошибка Сервиса"
            break
        created.append((int(item["id"]), record_id))
        await _save_yclients_record(booking_id, int(item["id"]), record_id)

    if failure:
        rollback_errors = []
        for _, record_id in created:
            ok, delete_error = await _delete_yclients_record(record_id)
            if not ok:
                rollback_errors.append(delete_error or str(record_id))
        full_error = failure
        if rollback_errors:
            full_error += " | Ошибка отката: " + "; ".join(rollback_errors)
        await _set_booking_status(booking_id, "pending_admin", error=full_error)
        await callback.answer("Сервис не создал записи. Можно попробовать подтвердить ещё раз.", show_alert=True)
        return

    await _set_booking_status(booking_id, "confirmed", admin_id=callback.from_user.id)
    booking = await _fetch_booking(booking_id)
    await callback.answer("Подтверждено")
    await callback.message.edit_text(_message_html(callback.message) + "\n\n✅ <b>Подтверждено и создано в Сервисе</b>")
    if booking:
        try:
            await callback.bot.send_message(
                booking["telegram_id"],
                "✅ <b>Бронь подтверждена!</b>\n\n" + _format_booking(booking)
                + "\n\nЗа час до визита бот попросит подтвердить, что вы придёте.",
                reply_markup=_user_cancel_keyboard(booking_id),
            )
        except Exception as exc:
            logger.warning("Не удалось уведомить клиента о подтверждении: %s", exc)


# ============================================================================
# ОТМЕНА И НАПОМИНАНИЕ ЗА ЧАС
# ============================================================================
async def _cancel_booking(booking: dict[str, Any], *, cancelled_status: str = "cancelled") -> tuple[bool, str | None]:
    errors = []
    for item in booking.get("items", []):
        record_id = item.get("yclients_record_id")
        if not record_id:
            continue
        ok, error = await _delete_yclients_record(record_id)
        if not ok:
            errors.append(error or str(record_id))
    if errors:
        await _set_booking_status(booking["id"], "cancellation_failed", error="; ".join(errors))
        return False, "; ".join(errors)
    await _set_booking_status(booking["id"], cancelled_status)
    return True, None


@router.callback_query(F.data.startswith("bkuser:cancel:"))
async def user_cancel_booking(callback: CallbackQuery) -> None:
    booking_id = int(callback.data.rsplit(":", 1)[1])
    booking = await _fetch_booking(booking_id)
    if not booking or int(booking["telegram_id"]) != callback.from_user.id:
        await callback.answer("Бронь не найдена", show_alert=True)
        return
    if booking["status"] not in USER_CANCELLABLE_STATUSES:
        await callback.answer("Эту бронь уже нельзя отменить этой кнопкой", show_alert=True)
        return
    start_at = datetime.fromisoformat(booking["start_at"]).astimezone(TZ)
    if start_at <= datetime.now(TZ):
        await callback.answer("Бронь уже началась", show_alert=True)
        return
    ok, error = await _cancel_booking(booking)
    if not ok:
        await callback.answer("Не удалось удалить запись из Сервиса. Администратор уведомлён.", show_alert=True)
        for admin_id in ADMIN_IDS:
            try:
                await callback.bot.send_message(admin_id, f"⚠️ Ошибка отмены брони #{booking_id}: {error}")
            except Exception:
                pass
        return
    await callback.answer("Бронь отменена")
    await callback.message.edit_text("❌ Бронь отменена. Записи удалены из Сервиса.")


@router.callback_query(F.data.startswith("bkrem:confirm:"))
async def reminder_confirm(callback: CallbackQuery) -> None:
    booking_id = int(callback.data.rsplit(":", 1)[1])
    booking = await _fetch_booking(booking_id)
    if not booking or int(booking["telegram_id"]) != callback.from_user.id:
        await callback.answer("Бронь не найдена", show_alert=True)
        return
    if booking["status"] not in {"confirmed", "user_confirmed"}:
        await callback.answer("Бронь уже изменена", show_alert=True)
        return
    await _set_booking_status(booking_id, "user_confirmed")
    await callback.answer("Подтверждено")
    await callback.message.edit_text("✅ Спасибо! Ждём вас в клубе.")


@router.callback_query(F.data.startswith("bkrem:cancel:"))
async def reminder_cancel(callback: CallbackQuery) -> None:
    booking_id = int(callback.data.rsplit(":", 1)[1])
    booking = await _fetch_booking(booking_id)
    if not booking or int(booking["telegram_id"]) != callback.from_user.id:
        await callback.answer("Бронь не найдена", show_alert=True)
        return
    if booking["status"] not in {"confirmed", "user_confirmed"}:
        await callback.answer("Бронь уже изменена", show_alert=True)
        return
    ok, error = await _cancel_booking(booking)
    if not ok:
        await callback.answer("Ошибка отмены. Администратор уведомлён.", show_alert=True)
        for admin_id in ADMIN_IDS:
            try:
                await callback.bot.send_message(admin_id, f"⚠️ Ошибка отмены брони #{booking_id}: {error}")
            except Exception:
                pass
        return
    await callback.answer("Отменено")
    await callback.message.edit_text("❌ Бронь отменена, записи удалены из Сервиса.")


async def process_booking_reminders(bot: Bot) -> None:
    """Вызывается планировщиком раз в 5 минут."""
    await ensure_booking_schema()
    now = datetime.now(TZ)
    until = now + timedelta(minutes=65)

    db = await get_db()
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
        """
        SELECT id FROM booking_requests_v2
        WHERE status = 'confirmed'
          AND reminder_sent = 0
          AND start_at > ?
          AND start_at <= ?
        ORDER BY start_at
        """,
        (now.isoformat(), until.isoformat()),
    )
    ids = [int(row[0]) for row in await cur.fetchall()]
    await cur.close()
    await db.close()

    for booking_id in ids:
        booking = await _fetch_booking(booking_id)
        if not booking:
            continue
        try:
            await bot.send_message(
                booking["telegram_id"],
                "⏰ <b>Скоро ваша бронь</b>\n\n" + _format_booking(booking)
                + "\n\nПодтвердите, что вы придёте, либо отмените бронь.",
                reply_markup=_reminder_keyboard(booking_id),
            )
        except Exception as exc:
            logger.warning("Не удалось отправить напоминание по брони %s: %s", booking_id, exc)
            continue

        db = await get_db()
        await db.execute(
            "UPDATE booking_requests_v2 SET reminder_sent = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (booking_id,),
        )
        await db.commit()
        await db.close()

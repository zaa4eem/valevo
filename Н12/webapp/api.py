"""
webapp/api.py — backend Telegram Mini App VALEVO.

Отдельный процесс от основного бота (main.py) и от tv_board.py, слушает свой
порт (см. webapp_server.py) и отдаёт наружу и REST API (/api/*), и статику
мини-приложения (webapp/static/**). Работает с той же БД, что и бот —
запускать нужно на той же машине, с доступом к тому же файлу SQLite
(см. deploy/WEBAPP_DEPLOY.md).

Авторизация — исключительно через Telegram initData (см. webapp/auth.py),
без паролей и без отдельной системы логина: подписанные Telegram данные
однозначно и криптографически подтверждают telegram_id пользователя.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
from contextlib import asynccontextmanager
from datetime import date as dt_date, datetime, timedelta
from pathlib import Path
from typing import Any

from aiogram import Bot
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import BASE_DIR, BOT_TOKEN, SUPPORT_CHAT_ID
import handlers.admin as admin_handlers
import handlers.booking as booking
import handlers.time_requests as time_requests
from database.db import (
    add_track,
    create_pilot,
    get_all_disciplines,
    get_all_pilots,
    get_db,
    get_pilot_by_number,
    get_pilot_by_telegram_id,
    get_pending_time_request,
    get_pending_time_requests_for_admin,
    get_time_request,
    get_time_request_cooldown_minutes,
    get_top10_pilots,
    get_tracks_for_discipline,
    expire_old_time_requests,
    remove_track,
    update_display_name,
    update_pilot_number,
    update_pilot_rating,
)
from services.leaderboard import get_tournament_leaderboard_data
from services.nickname import sanitize_pilot_name
from services.phone_normalizer import normalize_phone_for_bot, normalize_phone_for_yclients
from services.profile_service import get_profile_data
from services.weekcup_service import close_weekcup
from services.yclients_auto import auto_sync_pilot_with_yclients, issue_or_queue_valevo_bonus
from services.yclients_service import get_valevo_bonus_balance
from webapp.auth import InitDataError, TelegramWebAppUser, authenticate

logger = logging.getLogger(__name__)

WEBAPP_STATIC_DIR = Path(__file__).resolve().parent / "static"
CLUB_STATIC_DIR = BASE_DIR / "static"

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str | None) -> str:
    return _TAG_RE.sub("", text or "").strip()


_bot: Bot | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _bot
    _bot = Bot(token=BOT_TOKEN)
    logger.info("VALEVO Mini App API запущен")
    try:
        yield
    finally:
        if _bot:
            await _bot.session.close()


app = FastAPI(title="VALEVO Mini App", lifespan=lifespan)


def get_bot() -> Bot:
    if _bot is None:
        raise HTTPException(status_code=503, detail="Сервер ещё не инициализирован")
    return _bot


# ============================================================================
# АВТОРИЗАЦИЯ
# ============================================================================
async def get_current_user(authorization: str | None = Header(default=None)) -> TelegramWebAppUser:
    if not authorization or not authorization.lower().startswith("tma "):
        raise HTTPException(
            status_code=401,
            detail="Отсутствует заголовок Authorization: tma <initData>",
        )
    init_data = authorization[4:].strip()
    try:
        return authenticate(init_data)
    except InitDataError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


async def require_admin(user: TelegramWebAppUser = Depends(get_current_user)) -> TelegramWebAppUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Только для администраторов")
    return user


# ============================================================================
# ЕДИНЫЙ ФОРМАТ ОШИБОК: {"error": "..."} на любой не-2xx ответ
# ============================================================================
@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"error": "Некорректные данные запроса"}, status_code=422)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Необработанная ошибка API: %s %s", request.method, request.url.path)
    return JSONResponse({"error": "Внутренняя ошибка сервера"}, status_code=500)


# ============================================================================
# ПРОФИЛЬ / РЕГИСТРАЦИЯ
# ============================================================================
@app.get("/api/me")
async def api_me(user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    profile = await get_profile_data(user.id, user.username)
    if profile is None:
        return {"registered": False, "is_admin": user.is_admin}
    return {"registered": True, "is_admin": user.is_admin, "profile": profile}


class RegisterBody(BaseModel):
    phone: str


@app.post("/api/register")
async def api_register(
    body: RegisterBody,
    user: TelegramWebAppUser = Depends(get_current_user),
) -> JSONResponse:
    if not user.username:
        return JSONResponse({"ok": False, "reason": "no_username"}, status_code=409)

    phone_bot = normalize_phone_for_bot(body.phone)
    phone_yclients = normalize_phone_for_yclients(body.phone)
    if not phone_bot or not phone_yclients:
        raise HTTPException(status_code=400, detail="Не удалось распознать номер телефона")

    ok, reason = await create_pilot(
        telegram_id=user.id,
        username=user.username,
        phone=phone_bot,
        yclients_client_id=None,
    )
    if not ok:
        return JSONResponse({"ok": False, "reason": reason}, status_code=409)

    async def _sync() -> None:
        try:
            await auto_sync_pilot_with_yclients(user.id, phone_yclients, user.username)
        except Exception:
            logger.exception("YCLIENTS registration sync failed (mini app): telegram_id=%s", user.id)

    asyncio.create_task(_sync())
    return JSONResponse({"ok": True})


class NicknameBody(BaseModel):
    nickname: str


@app.patch("/api/me/nickname")
async def api_set_nickname(
    body: NicknameBody,
    user: TelegramWebAppUser = Depends(get_current_user),
) -> JSONResponse:
    nickname = sanitize_pilot_name(body.nickname)
    if not nickname:
        return JSONResponse({"ok": False, "reason": "invalid"}, status_code=400)
    changed = await update_display_name(user.id, nickname)
    if not changed:
        return JSONResponse({"ok": False, "reason": "taken"}, status_code=409)
    return JSONResponse({"ok": True})


# ============================================================================
# КОНТЕНТ: ЛИДЕРБОРД / ТОП-10 / ИНФО
# ============================================================================
@app.get("/api/leaderboard")
async def api_leaderboard(_user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    return await get_tournament_leaderboard_data()


@app.get("/api/top10")
async def api_top10(_user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"pilots": await get_top10_pilots()}


CLUB_INFO = {
    "phone": "+7 993 950-12-51",
    "telegram": "@ValevoRostov",
    "channel": "@ValevoRND",
    "instagram": "@valovo_simclub",
    "address": "ул. Баумана, 72",
    "description": (
        "Клуб автосимуляторов, где вы можете оказаться за рулём "
        "любого автомобиля и ощутить максимально реалистичные эмоции!"
    ),
}


@app.get("/api/info")
async def api_info(_user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, str]:
    return CLUB_INFO


class SupportBody(BaseModel):
    message: str


@app.post("/api/support")
async def api_support(
    body: SupportBody,
    user: TelegramWebAppUser = Depends(get_current_user),
    bot: Bot = Depends(get_bot),
) -> JSONResponse:
    if not SUPPORT_CHAT_ID:
        raise HTTPException(status_code=503, detail="Поддержка временно недоступна")
    text = (body.message or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустое сообщение")

    user_info = f"Обращение от @{user.username or 'нет юзернейма'} (ID: {user.id}) [мини-апп]"
    try:
        await bot.send_message(SUPPORT_CHAT_ID, f"{user_info}\n\n{html.escape(text)}")
    except Exception:
        logger.exception("Не удалось переслать обращение поддержки из мини-аппа")
        raise HTTPException(status_code=502, detail="Не удалось отправить обращение") from None
    return JSONResponse({"ok": True})


# ============================================================================
# БРОНИРОВАНИЕ
# ============================================================================
def _serialize_booking(b: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": b["id"],
        "status": b["status"],
        "place_type": b["place_type"],
        "start_at": b["start_at"],
        "end_at": b["end_at"],
        "duration_minutes": b["duration_minutes"],
        "telegram_id": b.get("telegram_id"),
        "display_name": b.get("display_name"),
        "phone": b.get("phone"),
        "items": [
            {"place_key": i["place_key"], "place_title": i["place_title"]}
            for i in b.get("items", [])
        ],
        "last_error": b.get("last_error"),
    }


@app.get("/api/booking/config")
async def api_booking_config(_user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "duration_options": list(booking.DURATION_OPTIONS),
        "open_time": booking.OPEN_TIME.strftime("%H:%M"),
        "close_time": booking.CLOSE_TIME.strftime("%H:%M"),
        "days_ahead": booking.BOOKING_DAYS_AHEAD,
        "max_places_per_booking": booking.MAX_PLACES_PER_BOOKING,
    }


@app.get("/api/booking/places")
async def api_booking_places(_user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "places": [
            {"key": key, "title": place["title"], "type": place["type"]}
            for key, place in booking.BOOKING_PLACES.items()
        ]
    }


@app.get("/api/booking/availability")
async def api_booking_availability(
    date: str,
    _user: TelegramWebAppUser = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        day = dt_date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректная дата") from None
    places = await booking.get_booking_day_availability(day)
    return {"places": {key: {"busy": intervals} for key, intervals in places.items()}}


class CreateBookingBody(BaseModel):
    place_type: str
    place_keys: list[str]
    date: str
    time: str
    duration_minutes: int


@app.post("/api/booking")
async def api_create_booking(
    body: CreateBookingBody,
    user: TelegramWebAppUser = Depends(get_current_user),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    pilot = await get_pilot_by_telegram_id(user.id)
    if not pilot:
        raise HTTPException(status_code=404, detail="Профиль не найден")

    if body.place_type not in {"static", "motion"}:
        raise HTTPException(status_code=400, detail="Некорректный тип места")
    if not body.place_keys or len(body.place_keys) > booking.MAX_PLACES_PER_BOOKING:
        raise HTTPException(
            status_code=400,
            detail=f"Выберите от 1 до {booking.MAX_PLACES_PER_BOOKING} мест",
        )
    for key in body.place_keys:
        place = booking.BOOKING_PLACES.get(key)
        if not place or place["type"] != body.place_type:
            raise HTTPException(status_code=400, detail="Некорректное место")

    config_error = booking._config_error(body.place_type, body.place_keys)
    if config_error:
        raise HTTPException(status_code=503, detail=config_error)

    try:
        selected_date = dt_date.fromisoformat(body.date)
        selected_time = datetime.strptime(body.time.strip(), "%H:%M").time()
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректная дата или время") from None

    if selected_time < booking.OPEN_TIME:
        raise HTTPException(status_code=400, detail="Клуб открывается в 12:00")
    if body.duration_minutes not in booking.DURATION_OPTIONS:
        raise HTTPException(status_code=400, detail="Недопустимая длительность")

    start_at = datetime.combine(selected_date, selected_time, tzinfo=booking.TZ)
    end_at = start_at + timedelta(minutes=body.duration_minutes)
    closing = datetime.combine(selected_date + timedelta(days=1), booking.CLOSE_TIME, tzinfo=booking.TZ)
    if end_at > closing:
        raise HTTPException(status_code=400, detail="Бронь закончится после закрытия клуба")

    ok, booking_id, error = await booking.submit_booking(
        bot,
        pilot=pilot,
        username=user.username,
        place_type=body.place_type,
        place_keys=body.place_keys,
        start_at=start_at,
        end_at=end_at,
        duration_minutes=body.duration_minutes,
    )
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True, "booking_id": booking_id}


@app.get("/api/booking/mine")
async def api_booking_mine(user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    bookings = await booking.get_bookings_for_pilot(user.id)
    return {"bookings": [_serialize_booking(b) for b in bookings]}


@app.post("/api/booking/{booking_id}/cancel")
async def api_booking_cancel(
    booking_id: int,
    user: TelegramWebAppUser = Depends(get_current_user),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    ok, error = await booking.cancel_booking_by_user(bot, booking_id, user.id)
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True}


# ============================================================================
# УСТАНОВКА ВРЕМЕНИ (time trial)
# ============================================================================
@app.get("/api/disciplines")
async def api_disciplines(_user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    return {"disciplines": await get_all_disciplines()}


@app.get("/api/tracks")
async def api_tracks(
    discipline: str,
    _user: TelegramWebAppUser = Depends(get_current_user),
) -> dict[str, Any]:
    return {"tracks": await get_tracks_for_discipline(discipline)}


@app.get("/api/time-request/mine")
async def api_time_request_mine(user: TelegramWebAppUser = Depends(get_current_user)) -> dict[str, Any]:
    await expire_old_time_requests()
    pending = await get_pending_time_request(user.id)
    cooldown = await get_time_request_cooldown_minutes(
        user.id, time_requests.TIME_REQUEST_COOLDOWN_MINUTES
    )
    request_data = None
    if pending:
        request_data = {
            "id": pending["id"],
            "discipline": pending["discipline"],
            "track": pending["track"],
            "lap_time_text": pending["lap_time_text"],
            "status": pending["status"],
            "created_at": pending["created_at"],
            "decided_at": pending["decided_at"],
        }
    return {"request": request_data, "cooldown_minutes": cooldown}


@app.post("/api/time-request")
async def api_create_time_request(
    discipline: str = Form(...),
    track: str = Form(...),
    lap_time_text: str = Form(...),
    photo: UploadFile = File(...),
    user: TelegramWebAppUser = Depends(get_current_user),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    pilot = await get_pilot_by_telegram_id(user.id)
    if not pilot:
        raise HTTPException(status_code=404, detail="Профиль не найден")

    allowed, error_text = await time_requests.check_request_allowed(user.id)
    if not allowed:
        return {"ok": False, "error": _strip_html(error_text)}

    photo_bytes = await photo.read()
    if not photo_bytes:
        raise HTTPException(status_code=400, detail="Пустой файл фотографии")

    ok, request_id, error = await time_requests.submit_time_request(
        bot,
        pilot=pilot,
        fallback_username=user.username,
        discipline=discipline,
        track=track,
        lap_time_text=lap_time_text,
        photo_bytes=photo_bytes,
        photo_filename=photo.filename or "result.jpg",
    )
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True, "request_id": request_id}


# ============================================================================
# АДМИН
# ============================================================================
@app.get("/api/admin/stats")
async def api_admin_stats(_user: TelegramWebAppUser = Depends(require_admin)) -> dict[str, Any]:
    pilots = await get_all_pilots()
    db = await get_db()
    try:
        cursor = await db.execute("SELECT COUNT(*) FROM laps")
        total_laps = (await cursor.fetchone())[0]
        cursor = await db.execute("SELECT COUNT(*) FROM disciplines")
        total_disciplines = (await cursor.fetchone())[0]
        cursor = await db.execute(
            "SELECT d.name, COUNT(*) as cnt FROM laps l JOIN disciplines d ON l.discipline_id = d.id "
            "GROUP BY d.name ORDER BY cnt DESC LIMIT 1"
        )
        row = await cursor.fetchone()
    finally:
        await db.close()
    return {
        "total_pilots": len(pilots),
        "total_laps": total_laps,
        "total_disciplines": total_disciplines,
        "popular_discipline": f"{row[0]} ({row[1]} кругов)" if row else "—",
    }


@app.get("/api/admin/pilots")
async def api_admin_pilots(
    query: str = "",
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    query = (query or "").strip().lstrip("@")
    pilots = await get_all_pilots()
    if query:
        if query.isdigit():
            pilots = [p for p in pilots if str(p.get("pilot_number") or "") == query]
        else:
            q_lower = query.lower()
            pilots = [p for p in pilots if q_lower in (p.get("username") or "").lower()]
    return {"pilots": pilots}


@app.get("/api/admin/pilots/{telegram_id}")
async def api_admin_pilot_detail(
    telegram_id: int,
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    pilot = await get_pilot_by_telegram_id(telegram_id)
    if not pilot:
        raise HTTPException(status_code=404, detail="Пилот не найден")

    bonus_balance = 0.0
    if pilot.get("yclients_client_id"):
        try:
            bonus_balance = await get_valevo_bonus_balance(pilot["yclients_client_id"])
        except Exception:
            logger.warning("Не удалось получить баланс пилота %s", telegram_id)

    return {
        "telegram_id": pilot["telegram_id"],
        "username": pilot["username"],
        "display_name": pilot.get("display_name"),
        "pilot_number": pilot.get("pilot_number"),
        "phone": pilot.get("phone"),
        "rating": pilot.get("rating", 0),
        "bonus_balance": round(float(bonus_balance or 0), 2),
    }


class RatingBody(BaseModel):
    delta: int


@app.post("/api/admin/pilots/{telegram_id}/rating")
async def api_admin_pilot_rating(
    telegram_id: int,
    body: RatingBody,
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    pilot = await get_pilot_by_telegram_id(telegram_id)
    if not pilot:
        raise HTTPException(status_code=404, detail="Пилот не найден")
    await update_pilot_rating(telegram_id, body.delta)
    updated = await get_pilot_by_telegram_id(telegram_id)
    return {"ok": True, "rating": (updated or {}).get("rating", 0)}


class BalanceBody(BaseModel):
    delta: float


@app.post("/api/admin/pilots/{telegram_id}/balance")
async def api_admin_pilot_balance(
    telegram_id: int,
    body: BalanceBody,
    admin: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    pilot = await get_pilot_by_telegram_id(telegram_id)
    if not pilot:
        raise HTTPException(status_code=404, detail="Пилот не найден")
    if body.delta == 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть не равна нулю")

    if not pilot.get("yclients_client_id"):
        try:
            await auto_sync_pilot_with_yclients(telegram_id, pilot.get("phone"), pilot.get("username"))
            pilot = await get_pilot_by_telegram_id(telegram_id) or pilot
        except Exception:
            logger.warning("Auto sync before bonus failed for %s", telegram_id)

    pilot_name = pilot.get("display_name") or pilot.get("username") or "Пилот"
    operation = "начисление" if body.delta > 0 else "списание"
    result = await issue_or_queue_valevo_bonus(
        telegram_id=telegram_id,
        client_id=pilot.get("yclients_client_id"),
        amount=body.delta,
        title=f"Valevo Bonus: {operation} администратором {admin.id} (мини-апп)",
        source="admin_manual",
        phone=pilot.get("phone"),
        name=pilot_name,
    )
    if result.get("ok"):
        return {"ok": True, "balance": round(float(result.get("balance") or 0), 2)}
    if result.get("status") == "queued":
        return {"ok": False, "queued": True, "error": result.get("message", "Операция поставлена в очередь")}
    return {"ok": False, "queued": False, "error": result.get("message", "Ошибка YCLIENTS")}


class NumberBody(BaseModel):
    number: int


@app.post("/api/admin/pilots/{telegram_id}/number")
async def api_admin_pilot_number(
    telegram_id: int,
    body: NumberBody,
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    existing = await get_pilot_by_number(body.number)
    if existing and existing["telegram_id"] != telegram_id:
        return {"ok": False, "error": "Этот номер уже занят другим пилотом."}
    try:
        changed = await update_pilot_number(telegram_id, body.number)
    except Exception:
        return {"ok": False, "error": "Этот номер только что заняли."}
    if not changed:
        raise HTTPException(status_code=404, detail="Пилот не найден")
    return {"ok": True}


@app.get("/api/admin/tracks")
async def api_admin_tracks(
    discipline: str,
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    return {"tracks": await get_tracks_for_discipline(discipline)}


class TrackBody(BaseModel):
    discipline: str
    track_name: str


@app.post("/api/admin/tracks")
async def api_admin_add_track(
    body: TrackBody,
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    track_name = body.track_name.strip()
    if not track_name or len(track_name) > admin_handlers.MAX_TRACK_NAME_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Название трассы должно быть от 1 до {admin_handlers.MAX_TRACK_NAME_LENGTH} символов",
        )
    ok, reason = await add_track(body.discipline, track_name)
    if not ok:
        return {"ok": False, "reason": reason}
    return {"ok": True}


@app.delete("/api/admin/tracks")
async def api_admin_remove_track(
    body: TrackBody,
    _user: TelegramWebAppUser = Depends(require_admin),
) -> dict[str, Any]:
    await remove_track(body.discipline, body.track_name)
    return {"ok": True}


@app.get("/api/admin/time-requests")
async def api_admin_time_requests(_user: TelegramWebAppUser = Depends(require_admin)) -> dict[str, Any]:
    rows = await get_pending_time_requests_for_admin()
    result = []
    for row in rows:
        pilot = await get_pilot_by_telegram_id(row["telegram_id"])
        pilot_name = (pilot or {}).get("display_name") or row["username"]
        result.append({
            "id": row["id"],
            "pilot_name": pilot_name,
            "pilot_number": row["pilot_number"],
            "discipline": row["discipline"],
            "track": row["track"],
            "lap_time_text": row["lap_time_text"],
            "photo_url": f"/api/admin/time-requests/{row['id']}/photo",
            "created_at": row["created_at"],
        })
    return {"requests": result}


@app.get("/api/admin/time-requests/{request_id}/photo")
async def api_admin_time_request_photo(
    request_id: int,
    _user: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> StreamingResponse:
    request = await get_time_request(request_id)
    if not request or not request.get("photo_file_id"):
        raise HTTPException(status_code=404, detail="Фото не найдено")
    try:
        buffer = await bot.download(request["photo_file_id"])
    except Exception:
        logger.exception("Не удалось скачать фото заявки %s", request_id)
        raise HTTPException(status_code=502, detail="Не удалось получить фото из Telegram") from None
    if buffer is None:
        raise HTTPException(status_code=502, detail="Не удалось получить фото из Telegram")
    return StreamingResponse(buffer, media_type="image/jpeg")


@app.post("/api/admin/time-requests/{request_id}/approve")
async def api_admin_time_request_approve(
    request_id: int,
    admin: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    ok, error = await time_requests.approve_time_request(bot, request_id, admin.id)
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True}


@app.post("/api/admin/time-requests/{request_id}/reject")
async def api_admin_time_request_reject(
    request_id: int,
    admin: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    ok, error = await time_requests.reject_time_request(bot, request_id, admin.id)
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True}


@app.get("/api/admin/bookings")
async def api_admin_bookings(_user: TelegramWebAppUser = Depends(require_admin)) -> dict[str, Any]:
    bookings = await booking.get_pending_admin_bookings()
    return {"bookings": [_serialize_booking(b) for b in bookings]}


@app.post("/api/admin/bookings/{booking_id}/approve")
async def api_admin_booking_approve(
    booking_id: int,
    admin: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    ok, error = await booking.approve_booking(bot, booking_id, admin.id)
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True}


@app.post("/api/admin/bookings/{booking_id}/reject")
async def api_admin_booking_reject(
    booking_id: int,
    admin: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    ok, error = await booking.reject_booking(bot, booking_id, admin.id)
    if not ok:
        return {"ok": False, "error": error}
    return {"ok": True}


@app.post("/api/admin/weekcup/close")
async def api_admin_weekcup_close(
    _user: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    try:
        report = await close_weekcup(bot)
    except Exception:
        logger.exception("Ошибка при закрытии Week CUP (мини-апп)")
        return {"ok": False, "error": "Не удалось закрыть Week CUP"}
    return {"ok": True, "report": report}


class BroadcastBody(BaseModel):
    text: str


@app.post("/api/admin/broadcast")
async def api_admin_broadcast(
    body: BroadcastBody,
    _user: TelegramWebAppUser = Depends(require_admin),
    bot: Bot = Depends(get_bot),
) -> dict[str, Any]:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Пустой текст рассылки")

    pilots = await get_all_pilots()
    sent = failed = 0
    for pilot in pilots:
        try:
            await bot.send_message(
                pilot["telegram_id"],
                f"🏁 <b>ВАЛЕВО сим рейсинг клуб уведомляет:</b>\n\n"
                f"{text}\n\n"
                f"❤️ С уважением, администрация ВАЛЕВО!",
            )
            sent += 1
            await asyncio.sleep(0.05)
        except Exception:
            failed += 1
    return {"ok": True, "sent": sent, "failed": failed}


# ============================================================================
# СТАТИКА МИНИ-ПРИЛОЖЕНИЯ
# ============================================================================
if CLUB_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(CLUB_STATIC_DIR)), name="club_static")
if (WEBAPP_STATIC_DIR / "css").exists():
    app.mount("/css", StaticFiles(directory=str(WEBAPP_STATIC_DIR / "css")), name="webapp_css")
if (WEBAPP_STATIC_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(WEBAPP_STATIC_DIR / "js")), name="webapp_js")


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(str(WEBAPP_STATIC_DIR / "index.html"))


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    # Неизвестный /api/* путь — это ошибка клиента (опечатка в пути,
    # не реализованный ещё эндпоинт), а не экран мини-приложения.
    # Без этой проверки такой запрос молча получил бы 200 + HTML
    # вместо понятного 404, и .json() на фронтенде падал бы с
    # "Unexpected token '<'" вместо осмысленной ошибки.
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Такого API-метода не существует")
    # Остальное — экраны мини-аппа, ими управляет клиентский роутер.
    return FileResponse(str(WEBAPP_STATIC_DIR / "index.html"))

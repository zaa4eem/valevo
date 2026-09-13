from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date as dt_date, datetime, timedelta
from pathlib import Path
from typing import Any

from aiogram import Bot
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

import handlers.booking as booking
from config import BOT_TOKEN, REFERRAL_BONUS_RUB
from data.tournament import CLASS_LADDER
from database.db import (
    get_all_pilot_display_names,
    get_db,
    get_pilot_by_telegram_id,
    get_referral_stats,
)
from services.booking_finance import (
    FinanceError,
    ensure_booking_finance_schema,
    get_booking_finance,
    get_commission_percent,
    get_finance_summary,
    get_tariffs,
    list_admin_audit,
    list_finance_entries,
    log_admin_action,
    quote_booking,
    register_finance_entry,
    set_commission_percent,
    set_tariff,
)
from services.roulette import SPIN_COST_RUB, SpinError, prize_catalog, spin
from services.tournament import load_month_snapshot, month_bounds
from services.yclients_service import get_valevo_bonus_balance
from webapp.auth import InitDataError, TelegramWebAppUser, authenticate

logger = logging.getLogger(__name__)
STATIC = Path(__file__).resolve().parent / "static"
_bot: Bot | None = None
_bot_username: str | None = None

# One process / one worker is deliberate with SQLite. This lightweight limiter
# prevents accidental button-spam without adding Redis just for the Mini App.
_mutation_windows: dict[int, deque[float]] = defaultdict(deque)
_mutation_lock = asyncio.Lock()
_MUTATION_LIMIT = 45
_MUTATION_WINDOW_SECONDS = 60.0


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _bot, _bot_username
    await booking.ensure_booking_schema()
    await ensure_booking_finance_schema()
    _bot = Bot(BOT_TOKEN)
    try:
        try:
            info = await _bot.get_me()
            _bot_username = info.username
        except Exception:
            logger.warning("Не удалось получить username бота при старте Mini App", exc_info=True)
        yield
    finally:
        if _bot:
            await _bot.session.close()


app = FastAPI(
    title="VALEVO Mini App",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://telegram.org; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; "
        "connect-src 'self'; object-src 'none'; base-uri 'self'; "
        "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
    )
    if request.url.path.startswith("/api/") or request.url.path == "/":
        response.headers.setdefault("Cache-Control", "no-store")
    return response


def get_bot() -> Bot:
    if _bot is None:
        raise HTTPException(status_code=503, detail="Сервер ещё запускается")
    return _bot


def current_user(authorization: str | None = Header(default=None)) -> TelegramWebAppUser:
    if not authorization or not authorization.lower().startswith("tma "):
        raise HTTPException(status_code=401, detail="Откройте приложение из Telegram")
    try:
        return authenticate(authorization[4:].strip())
    except InitDataError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def require_super_admin(user: TelegramWebAppUser = Depends(current_user)) -> TelegramWebAppUser:
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Доступ только для супер-администратора")
    return user


async def mutation_guard(user: TelegramWebAppUser = Depends(current_user)) -> None:
    now = time.monotonic()
    cutoff = now - _MUTATION_WINDOW_SECONDS
    async with _mutation_lock:
        window = _mutation_windows[user.id]
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= _MUTATION_LIMIT:
            raise HTTPException(status_code=429, detail="Слишком много действий. Попробуйте через минуту.")
        window.append(now)
        # Prevent unbounded growth from users who never return.
        if len(_mutation_windows) > 10_000:
            stale = [uid for uid, q in _mutation_windows.items() if not q or q[-1] < cutoff]
            for uid in stale[:2000]:
                _mutation_windows.pop(uid, None)


@app.exception_handler(StarletteHTTPException)
async def http_error(_request: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, _exc: RequestValidationError):
    return JSONResponse({"error": "Некорректные данные запроса"}, status_code=422)


@app.exception_handler(FinanceError)
async def finance_error(_request: Request, exc: FinanceError):
    return JSONResponse({"error": str(exc)}, status_code=409)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    logger.exception("Необработанная ошибка Mini App API: %s %s", request.method, request.url.path)
    return JSONResponse({"error": "Внутренняя ошибка сервера"}, status_code=500)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/ready")
async def ready():
    try:
        db = await get_db()
        try:
            cur = await db.execute("SELECT 1")
            row = await cur.fetchone()
            if not row or row[0] != 1:
                raise RuntimeError("database readiness probe failed")
            cur = await db.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('pilots','booking_requests_v2','booking_finance_entries')"
            )
            count = int((await cur.fetchone())[0])
            if count != 3:
                raise RuntimeError("required tables are not initialized")
        finally:
            await db.close()
    except Exception:
        logger.exception("Mini App readiness probe failed")
        return JSONResponse({"ok": False}, status_code=503)
    return {"ok": True}


@app.get("/api/me")
async def me(user: TelegramWebAppUser = Depends(current_user)):
    pilot = await get_pilot_by_telegram_id(user.id)
    if not pilot:
        return {
            "registered": False,
            "is_admin": user.is_admin,
            "is_super_admin": user.is_super_admin,
        }
    safe = {
        key: pilot.get(key)
        for key in (
            "telegram_id",
            "username",
            "phone",
            "display_name",
            "pilot_number",
            "rating",
            "current_class",
        )
        if key in pilot
    }
    return {
        "registered": True,
        "is_admin": user.is_admin,
        "is_super_admin": user.is_super_admin,
        "profile": safe,
    }


@app.get("/api/leaderboard")
async def leaderboard(_user: TelegramWebAppUser = Depends(current_user)):
    month_key, start, end = month_bounds()
    snap = await load_month_snapshot(month_key, start, end)
    names = await get_all_pilot_display_names()
    overall = []
    for index, row in enumerate(snap.overall_ranking()[:7], 1):
        overall.append(
            {
                "place": index,
                "telegram_id": row["telegram_id"],
                "name": str(names.get(row["telegram_id"]) or row["telegram_id"]),
                "points": int(row["total"]),
            }
        )
    disciplines = []
    for cls in CLASS_LADDER:
        rows = []
        for tid, place in snap._positions.get(cls, {}).items():
            score = snap.class_score_for(tid, cls)
            ms = score.get("best_ms")
            if ms:
                rows.append(
                    {
                        "place": place,
                        "telegram_id": tid,
                        "name": str(names.get(tid) or tid),
                        "best_ms": int(ms),
                    }
                )
        rows.sort(key=lambda x: x["place"])
        disciplines.append({"name": cls, "rows": rows})
    return {"overall": overall, "disciplines": disciplines}


@app.get("/api/referrals")
async def referrals(user: TelegramWebAppUser = Depends(current_user)):
    global _bot_username
    if not _bot_username:
        info = await get_bot().get_me()
        _bot_username = info.username
    stats = await get_referral_stats(user.id)
    return {
        "bonus": REFERRAL_BONUS_RUB,
        "link": f"https://t.me/{_bot_username}?start=ref_{user.id}",
        "stats": stats,
    }


@app.get("/api/roulette")
async def roulette(user: TelegramWebAppUser = Depends(current_user)):
    pilot = await get_pilot_by_telegram_id(user.id)
    balance = 0.0
    if pilot and pilot.get("yclients_client_id"):
        try:
            balance = float(await get_valevo_bonus_balance(pilot["yclients_client_id"]) or 0)
        except Exception:
            logger.warning("Не удалось получить баланс рулетки: telegram_id=%s", user.id)
    return {
        "spin_cost": SPIN_COST_RUB,
        "balance": round(balance, 2),
        "prizes": prize_catalog(),
    }


@app.post("/api/roulette/spin", dependencies=[Depends(mutation_guard)])
async def roulette_spin(user: TelegramWebAppUser = Depends(current_user)):
    try:
        return {"ok": True, **(await spin(user.id))}
    except SpinError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=409)


# ---------------------------------------------------------------------------
# Booking
# ---------------------------------------------------------------------------

def _serialize_booking(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": value["id"],
        "status": value["status"],
        "place_type": value["place_type"],
        "start_at": value["start_at"],
        "end_at": value["end_at"],
        "duration_minutes": value["duration_minutes"],
        "display_name": value.get("display_name"),
        "phone": value.get("phone"),
        "tariff_rub_per_hour": value.get("tariff_rub_per_hour"),
        "quoted_total_rub": value.get("quoted_total_rub"),
        "last_error": value.get("last_error"),
        "items": [
            {"place_key": item["place_key"], "place_title": item["place_title"]}
            for item in value.get("items", [])
        ],
    }


@app.get("/api/booking/config")
async def booking_config(_user: TelegramWebAppUser = Depends(current_user)):
    return {
        "duration_options": list(booking.DURATION_OPTIONS),
        "open_time": booking.OPEN_TIME.strftime("%H:%M"),
        "close_time": booking.CLOSE_TIME.strftime("%H:%M"),
        "days_ahead": booking.BOOKING_DAYS_AHEAD,
        "max_places_per_booking": booking.MAX_PLACES_PER_BOOKING,
        "tariffs": await get_tariffs(),
    }


@app.get("/api/booking/places")
async def booking_places(_user: TelegramWebAppUser = Depends(current_user)):
    return {
        "places": [
            {"key": key, "title": value["title"], "type": value["type"]}
            for key, value in booking.BOOKING_PLACES.items()
        ]
    }


@app.get("/api/booking/availability")
async def booking_availability(
    date: str,
    _user: TelegramWebAppUser = Depends(current_user),
):
    try:
        day = dt_date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректная дата") from None
    today = datetime.now(booking.TZ).date()
    if day < today or day >= today + timedelta(days=booking.BOOKING_DAYS_AHEAD):
        raise HTTPException(status_code=400, detail="Эта дата недоступна")
    return {"places": await booking.get_booking_day_availability(day)}


class QuoteBody(BaseModel):
    place_type: str = Field(min_length=3, max_length=16)
    duration_minutes: int = Field(gt=0, le=1440)
    places_count: int = Field(gt=0, le=20)


@app.post("/api/booking/quote", dependencies=[Depends(mutation_guard)])
async def booking_quote(body: QuoteBody, _user: TelegramWebAppUser = Depends(current_user)):
    quote = await quote_booking(body.place_type, body.duration_minutes, body.places_count)
    return {
        "tariff_rub_per_hour": quote.rub_per_hour,
        "quoted_total_rub": quote.total_rub,
    }


class CreateBookingBody(BaseModel):
    place_type: str = Field(min_length=3, max_length=16)
    place_keys: list[str] = Field(min_length=1, max_length=3)
    date: str = Field(min_length=10, max_length=10)
    time: str = Field(min_length=5, max_length=5)
    duration_minutes: int
    request_token: str = Field(min_length=8, max_length=120)


@app.post("/api/booking", dependencies=[Depends(mutation_guard)])
async def create_booking(
    body: CreateBookingBody,
    user: TelegramWebAppUser = Depends(current_user),
):
    bot = get_bot()
    pilot = await get_pilot_by_telegram_id(user.id)
    if not pilot:
        raise HTTPException(status_code=404, detail="Профиль не найден")
    if body.place_type not in {"static", "motion"}:
        raise HTTPException(status_code=400, detail="Некорректный тип места")
    if not body.place_keys or len(body.place_keys) > booking.MAX_PLACES_PER_BOOKING:
        raise HTTPException(status_code=400, detail="Некорректное количество мест")
    if len(set(body.place_keys)) != len(body.place_keys):
        raise HTTPException(status_code=400, detail="Места не должны повторяться")
    for key in body.place_keys:
        place = booking.BOOKING_PLACES.get(key)
        if not place or place["type"] != body.place_type:
            raise HTTPException(status_code=400, detail="Некорректное место")

    try:
        selected_date = dt_date.fromisoformat(body.date)
        selected_time = datetime.strptime(body.time.strip(), "%H:%M").time()
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректная дата или время") from None

    now = datetime.now(booking.TZ)
    if selected_date < now.date() or selected_date >= now.date() + timedelta(days=booking.BOOKING_DAYS_AHEAD):
        raise HTTPException(status_code=400, detail="Эта дата недоступна")
    if selected_time < booking.OPEN_TIME:
        raise HTTPException(status_code=400, detail="Клуб открывается в 12:00")
    if body.duration_minutes not in booking.DURATION_OPTIONS:
        raise HTTPException(status_code=400, detail="Недопустимая длительность")

    start_at = datetime.combine(selected_date, selected_time, tzinfo=booking.TZ)
    if start_at <= now:
        raise HTTPException(status_code=400, detail="Выбранное время уже прошло")
    end_at = start_at + timedelta(minutes=body.duration_minutes)
    closing = datetime.combine(
        selected_date + timedelta(days=1), booking.CLOSE_TIME, tzinfo=booking.TZ
    )
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
        request_token=body.request_token.strip(),
    )
    if not ok or not booking_id:
        return JSONResponse({"ok": False, "error": error or "Не удалось создать бронь"}, status_code=409)
    created = await booking._fetch_booking(booking_id)
    if not created:
        raise HTTPException(status_code=500, detail="Бронь создана, но не найдена после сохранения")
    return {"ok": True, "booking": _serialize_booking(created)}


@app.get("/api/booking/mine")
async def booking_mine(user: TelegramWebAppUser = Depends(current_user)):
    rows = await booking.get_bookings_for_pilot(user.id)
    result = []
    for row in rows:
        serialized = _serialize_booking(row)
        try:
            serialized["finance"] = await get_booking_finance(int(row["id"]))
        except FinanceError:
            serialized["finance"] = None
        result.append(serialized)
    return {"bookings": result}


@app.post("/api/booking/{booking_id}/cancel", dependencies=[Depends(mutation_guard)])
async def cancel_booking(
    booking_id: int,
    user: TelegramWebAppUser = Depends(current_user),
):
    ok, error = await booking.cancel_booking_by_user(get_bot(), booking_id, user.id)
    if not ok:
        return JSONResponse({"ok": False, "error": error or "Не удалось отменить бронь"}, status_code=409)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Super-admin booking operations + finance journal
# ---------------------------------------------------------------------------
@app.get("/api/admin/bookings")
async def admin_bookings(_admin: TelegramWebAppUser = Depends(require_super_admin)):
    rows = await booking.get_pending_admin_bookings()
    result = []
    for row in rows:
        item = _serialize_booking(row)
        item["finance"] = await get_booking_finance(int(row["id"]))
        result.append(item)
    return {"bookings": result}


@app.get("/api/admin/bookings/problems")
async def admin_problem_bookings(_admin: TelegramWebAppUser = Depends(require_super_admin)):
    db = await get_db()
    try:
        cur = await db.execute(
            """
            SELECT id FROM booking_requests_v2
            WHERE status IN ('cancellation_failed','rollback_failed')
            ORDER BY updated_at DESC, id DESC
            LIMIT 100
            """
        )
        ids = [int(row[0]) for row in await cur.fetchall()]
    finally:
        await db.close()
    result = []
    for booking_id in ids:
        value = await booking._fetch_booking(booking_id)
        if value:
            item = _serialize_booking(value)
            item["finance"] = await get_booking_finance(booking_id)
            result.append(item)
    return {"bookings": result}


@app.post("/api/admin/bookings/{booking_id}/approve", dependencies=[Depends(mutation_guard)])
async def admin_approve_booking(
    booking_id: int,
    admin: TelegramWebAppUser = Depends(require_super_admin),
):
    ok, error = await booking.approve_booking(get_bot(), booking_id, admin.id)
    if not ok:
        return JSONResponse({"ok": False, "error": error or "Не удалось подтвердить"}, status_code=409)
    await log_admin_action(
        actor_id=admin.id,
        action="booking_approved",
        entity_type="booking",
        entity_id=booking_id,
    )
    return {"ok": True}


@app.post("/api/admin/bookings/{booking_id}/reject", dependencies=[Depends(mutation_guard)])
async def admin_reject_booking(
    booking_id: int,
    admin: TelegramWebAppUser = Depends(require_super_admin),
):
    ok, error = await booking.reject_booking(get_bot(), booking_id, admin.id)
    if not ok:
        return JSONResponse({"ok": False, "error": error or "Не удалось отклонить"}, status_code=409)
    await log_admin_action(
        actor_id=admin.id,
        action="booking_rejected",
        entity_type="booking",
        entity_id=booking_id,
    )
    return {"ok": True}


@app.post("/api/admin/bookings/{booking_id}/retry-cleanup", dependencies=[Depends(mutation_guard)])
async def admin_retry_cleanup(
    booking_id: int,
    admin: TelegramWebAppUser = Depends(require_super_admin),
):
    value = await booking._fetch_booking(booking_id)
    if not value or value.get("status") not in {"cancellation_failed", "rollback_failed"}:
        raise HTTPException(status_code=409, detail="Эта бронь не требует аварийной очистки")

    errors: list[str] = []
    for item in value.get("items", []):
        record_id = item.get("yclients_record_id")
        if not record_id:
            continue
        ok, error = await booking._delete_yclients_record(record_id)
        if ok:
            await booking._clear_yclients_record(int(item["id"]))
        else:
            errors.append(error or str(record_id))

    if errors:
        await booking._set_booking_status(booking_id, str(value["status"]), admin_id=admin.id, error="; ".join(errors))
        await log_admin_action(
            actor_id=admin.id,
            action="booking_cleanup_failed",
            entity_type="booking",
            entity_id=booking_id,
            details={"errors": errors[:10]},
        )
        return JSONResponse({"ok": False, "error": "Не все записи удалось удалить; слот остаётся заблокированным"}, status_code=409)

    target_status = "cancelled" if value["status"] == "cancellation_failed" else "pending_admin"
    await booking._set_booking_status(booking_id, target_status, admin_id=admin.id, error=None)
    await log_admin_action(
        actor_id=admin.id,
        action="booking_cleanup_recovered",
        entity_type="booking",
        entity_id=booking_id,
        details={"from": value["status"], "to": target_status},
    )
    return {"ok": True, "status": target_status}


class FinanceEntryBody(BaseModel):
    entry_type: str = Field(min_length=6, max_length=7)
    amount_rub: float = Field(gt=0, le=10_000_000)
    payment_method: str = Field(default="other", min_length=3, max_length=40)
    note: str | None = Field(default=None, max_length=500)
    operation_key: str = Field(min_length=8, max_length=120)


@app.post("/api/admin/bookings/{booking_id}/finance", dependencies=[Depends(mutation_guard)])
async def admin_finance_entry(
    booking_id: int,
    body: FinanceEntryBody,
    admin: TelegramWebAppUser = Depends(require_super_admin),
):
    entry = await register_finance_entry(
        booking_id=booking_id,
        entry_type=body.entry_type,
        amount_rub=body.amount_rub,
        admin_id=admin.id,
        payment_method=body.payment_method,
        note=body.note,
        operation_key=body.operation_key,
    )
    return {
        "ok": True,
        "entry": entry,
        "finance": await get_booking_finance(booking_id),
    }


@app.get("/api/admin/finance")
async def admin_finance(
    limit: int = Query(default=100, ge=1, le=500),
    _admin: TelegramWebAppUser = Depends(require_super_admin),
):
    return {
        "summary": await get_finance_summary(),
        "commission_percent": await get_commission_percent(),
        "tariffs": await get_tariffs(),
        "entries": await list_finance_entries(limit),
    }


@app.get("/api/admin/audit")
async def admin_audit(
    limit: int = Query(default=100, ge=1, le=500),
    _admin: TelegramWebAppUser = Depends(require_super_admin),
):
    return {"entries": await list_admin_audit(limit)}


class TariffBody(BaseModel):
    rub_per_hour: float = Field(gt=0, le=1_000_000)


@app.put("/api/admin/tariffs/{place_type}", dependencies=[Depends(mutation_guard)])
async def admin_set_tariff(
    place_type: str,
    body: TariffBody,
    admin: TelegramWebAppUser = Depends(require_super_admin),
):
    value = await set_tariff(place_type, body.rub_per_hour, admin.id)
    return {"ok": True, "place_type": place_type, "rub_per_hour": value}


class CommissionBody(BaseModel):
    percent: float = Field(ge=0, le=100)


@app.put("/api/admin/finance/commission", dependencies=[Depends(mutation_guard)])
async def admin_set_commission(
    body: CommissionBody,
    admin: TelegramWebAppUser = Depends(require_super_admin),
):
    value = await set_commission_percent(body.percent, admin.id)
    return {"ok": True, "commission_percent": value}


app.mount("/assets", StaticFiles(directory=STATIC), name="assets")


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})

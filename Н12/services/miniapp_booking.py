"""Authenticated HTTP adapter for the bot's booking transaction and integrations."""
from datetime import datetime, timedelta
from typing import Literal

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database.db import get_db, get_pilot_by_telegram_id
from handlers import booking as b


class BookingInput(BaseModel):
    place_keys: list[str] = Field(min_length=1, max_length=3)
    start_at: datetime
    duration_minutes: int
    idempotency_key: str = Field(min_length=8, max_length=128)
    bill_as_static: bool = False


def window(start_at, duration_minutes):
    if start_at.tzinfo is None or duration_minutes not in b.DURATION_OPTIONS:
        raise HTTPException(422, 'Укажите часовой пояс и допустимую длительность')
    start = start_at.astimezone(b.TZ)
    now = datetime.now(b.TZ)
    end = start + timedelta(minutes=duration_minutes)
    if (start <= now or not 0 <= (start.date() - now.date()).days < b.BOOKING_DAYS_AHEAD
        or start.hour < 12 or start.minute % 30 or start.second or start.microsecond
        or end > (start + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)):
        raise HTTPException(422, 'Выберите будущее время в часы работы клуба')
    return start, end


def public_booking(row, admin=False):
    fields = ['id', 'start_at', 'end_at', 'duration_minutes', 'place_type', 'status', 'source', 'quoted_kopecks',
              'hourly_rate_kopecks', 'billed_as_static', 'created_at']
    if admin:
        fields += ['telegram_id', 'display_name', 'phone']
    result = {k: row.get(k) for k in fields}
    result['items'] = [{k: item[k] for k in ('place_key', 'place_title')} for item in row['items']]
    return result


async def list_bookings(user_id=None, limit=100, offset=0):
    db = await get_db()
    try:
        query = 'SELECT id FROM booking_requests_v2'
        params = []
        if user_id is not None:
            query += ' WHERE telegram_id=?'
            params.append(user_id)
        cur = await db.execute(query + ' ORDER BY id DESC LIMIT ? OFFSET ?', (*params, limit, offset))
        ids = [r[0] for r in await cur.fetchall()]
    finally:
        await db.close()
    return [await b._fetch_booking(bid) for bid in ids]


def create_booking_router(current_user):
    router = APIRouter()

    def super_user(user=Depends(current_user)):
        if not user.is_super_admin:
            raise HTTPException(403, 'Доступ только супер-администратору')
        return user

    @router.get('/api/booking/options')
    async def options(user=Depends(current_user)):
        return {'places': [{'key': k, 'title': v['title'], 'type': v['type'],
                             'hourly_rate_kopecks': b.HOURLY_RATES[v['type']],
                             'happy_hour_kopecks': b.HAPPY_HOUR_RATES[v['type']],
                             'billable_as_static': v['type'] == 'motion'} for k, v in b.BOOKING_PLACES.items()],
                'durations': list(b.DURATION_OPTIONS), 'days_ahead': b.BOOKING_DAYS_AHEAD,
                'timezone': str(b.TZ), 'open_hour': 12, 'close_hour': 24, 'today': datetime.now(b.TZ).date().isoformat(),
                'happy_hour': {'weekdays': list(b.HAPPY_HOUR_WEEKDAYS), 'start': b.HAPPY_HOUR_START.strftime('%H:%M'),
                                'end': b.HAPPY_HOUR_END.strftime('%H:%M')}}

    @router.get('/api/booking/availability')
    async def availability(start_at: datetime, duration_minutes: int, user=Depends(current_user)):
        start, end = window(start_at, duration_minutes)
        places = []
        for key, place in b.BOOKING_PLACES.items():
            local = await b._local_conflicts([place['staff_id']], start, end)
            if local:
                available = False
            else:
                remote, error = await b._remote_conflicts([key], start, end)
                if error:
                    raise HTTPException(503, 'Не удалось проверить доступность в YCLIENTS')
                available = not remote
            places.append({'key': key, 'available': available})
        return {'places': places}

    @router.get('/api/bookings')
    async def mine(user=Depends(current_user), limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0)):
        return {'bookings': [public_booking(row) for row in await list_bookings(user.id, limit, offset)]}

    @router.post('/api/bookings')
    async def create(data: BookingInput, user=Depends(current_user)):
        if data.start_at.tzinfo is None or data.duration_minutes not in b.DURATION_OPTIONS:
            raise HTTPException(422, 'Укажите часовой пояс и допустимую длительность')
        start = data.start_at.astimezone(b.TZ)
        end = start + timedelta(minutes=data.duration_minutes)
        pilot = await get_pilot_by_telegram_id(user.id)
        if not pilot or not pilot.get('phone'):
            raise HTTPException(409, 'Сначала завершите регистрацию и укажите телефон в боте')
        if len(set(data.place_keys)) != len(data.place_keys) or any(k not in b.BOOKING_PLACES for k in data.place_keys):
            raise HTTPException(422, 'Некорректные места')
        place_type = b.BOOKING_PLACES[data.place_keys[0]]['type']
        if any(b.BOOKING_PLACES[k]['type'] != place_type for k in data.place_keys):
            raise HTTPException(422, 'Выберите места одного типа')
        # Existing identical retries must work even after remote availability changes.
        db = await get_db()
        try:
            cur = await db.execute('SELECT id FROM booking_requests_v2 WHERE telegram_id=? AND source=? AND idempotency_key=?', (user.id, 'miniapp', data.idempotency_key))
            previous = await cur.fetchone()
        finally:
            await db.close()
        if not previous:
            start, end = window(data.start_at, data.duration_minutes)
            remote, error = await b._remote_conflicts(data.place_keys, start, end)
            if error:
                raise HTTPException(503, 'Не удалось проверить доступность в YCLIENTS')
            if remote:
                raise HTTPException(409, 'Выбранное место уже занято')
        ok, bid, error = await b._create_pending_booking(pilot=pilot, username=user.username,
            place_type=place_type, place_keys=data.place_keys, start_at=start, end_at=end,
            duration_minutes=data.duration_minutes, source='miniapp', idempotency_key=data.idempotency_key,
            bill_as_static=data.bill_as_static and place_type == 'motion')
        if not ok:
            raise HTTPException(409, error)
        return public_booking(await b._fetch_booking(bid))

    @router.post('/api/bookings/{booking_id}/cancel')
    async def cancel(booking_id: int, user=Depends(current_user)):
        row = await b._fetch_booking(booking_id)
        if not row or row['telegram_id'] != user.id:
            raise HTTPException(404, 'Бронь не найдена')
        if row['status'] not in b.USER_CANCELLABLE_STATUSES or datetime.fromisoformat(row['start_at']) <= datetime.now(b.TZ):
            raise HTTPException(409, 'Эту бронь уже нельзя отменить')
        ok, error = await b._cancel_booking(row)
        if not ok:
            raise HTTPException(409, 'Отмена не завершена. Обратитесь к администратору.')
        return public_booking(await b._fetch_booking(booking_id))

    @router.get('/api/admin/bookings')
    async def admin_bookings(user=Depends(super_user), limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0)):
        return {'bookings': [public_booking(row, True) for row in await list_bookings(None, limit, offset)]}

    @router.post('/api/admin/bookings/{booking_id}/{action}')
    async def admin_action(booking_id: int, action: Literal['approve', 'reject'], user=Depends(super_user)):
        if action == 'approve':
            ok, error = await b.approve_booking(booking_id, user.id)
        else:
            ok, error = await b._reject_if_pending(booking_id, user.id), 'Заявка уже обработана'
        if not ok:
            raise HTTPException(409, error)
        return public_booking(await b._fetch_booking(booking_id), True)

    return router

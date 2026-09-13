"""Authenticated Mini App operations backed by the bot's existing services."""
from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import db
from data.tournament import CLASS_LADDER
from handlers.common import sanitize_pilot_name
from services.achievements import check_achievements_after_lap
from services import miniapp_laps
from services.tournament import check_and_process_promotion, month_bounds
from utils.time_parser import time_to_ms

logger = logging.getLogger(__name__)


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=2, max_length=100)


class TrackInput(BaseModel):
    discipline: str = Field(min_length=1, max_length=100)
    track: str = Field(min_length=1, max_length=200)


class LapInput(TrackInput):
    idempotency_key: str = Field(min_length=1, max_length=128, pattern=r'\S')
    pilot_number: int = Field(gt=0)
    lap_time: str = Field(max_length=20)


class BenchmarkInput(BaseModel):
    class_name: str = Field(min_length=1, max_length=100)
    track: str = Field(min_length=1, max_length=200)
    lap_time: str = Field(max_length=20)


def parse_lap(value: str) -> int:
    try:
        result = time_to_ms(value)
        if result <= 0:
            raise ValueError('Non-positive time')
        return result
    except ValueError as exc:
        raise HTTPException(422, 'Введите положительное время круга, например 01:18.565') from exc


def create_operations_router(current_user):
    router = APIRouter(prefix='/api')

    def staff(user=Depends(current_user)):
        if not (user.is_admin or user.is_super_admin):
            raise HTTPException(403, 'Требуются права администратора')
        return user

    def super_admin(user=Depends(current_user)):
        if not user.is_super_admin:
            raise HTTPException(403, 'Требуются права супер-администратора')
        return user

    async def registered(user):
        pilot = await db.get_pilot_by_telegram_id(user.id)
        if not pilot:
            raise HTTPException(409, 'Сначала зарегистрируйтесь в боте')
        return pilot

    async def discipline_exists(name):
        if name not in await db.get_all_disciplines():
            raise HTTPException(422, 'Неизвестная дисциплина')

    @router.patch('/profile')
    async def profile(body: ProfileUpdate, user=Depends(current_user)):
        await registered(user)
        name = sanitize_pilot_name(body.display_name)
        if not name:
            raise HTTPException(422, 'Имя должно содержать от 2 до 16 допустимых символов')
        try:
            changed = await db.update_display_name(user.id, name)
        except sqlite3.IntegrityError:
            changed = False
        if not changed:
            raise HTTPException(409, 'Это имя уже занято')
        return {'ok': True, 'display_name': name}

    @router.get('/results')
    async def results(user=Depends(current_user)):
        pilot = await registered(user)
        return await db.get_pilot_history_stats(user.id, pilot.get('username'))

    @router.get('/disciplines')
    async def disciplines(_user=Depends(current_user)):
        names = await db.get_all_disciplines()
        month_key, _, _ = month_bounds()
        return {'disciplines': [{'name': name, 'tracks': await db.get_tracks_for_discipline(name)} for name in names],
                'month_key': month_key, 'benchmarks': await db.get_all_class_benchmarks(month_key)}

    @router.post('/admin/laps')
    async def lap(body: LapInput, _user=Depends(staff)):
        lap_ms = parse_lap(body.lap_time)
        await discipline_exists(body.discipline)
        if body.track not in await db.get_tracks_for_discipline(body.discipline):
            raise HTTPException(422, 'Неизвестная трасса для дисциплины')
        pilot = await db.get_pilot_by_number(body.pilot_number)
        if not pilot:
            raise HTTPException(404, 'Пилот не найден')
        try:
            lap_id, created, response = await miniapp_laps.save_lap(_user.id, body.idempotency_key,
                dict(discipline=body.discipline, username=pilot.get('username'),
                     telegram_id=pilot['telegram_id'], track=body.track,
                     lap_time_text=body.lap_time.strip(), lap_time_ms=lap_ms))
        except miniapp_laps.LapConflict as exc:
            raise HTTPException(409, str(exc)) from exc
        if not created:
            return response or {'ok': True, 'lap_id': lap_id, 'promoted_to': None,
                'warning': 'Круг уже сохранён. Начисление достижений выполняется или требует проверки администратора'}
        promoted_to = None
        warning = None
        try:
            promoted_to = await check_and_process_promotion(pilot['telegram_id'], body.discipline)
            await check_achievements_after_lap(pilot['telegram_id'], body.discipline,
                                             track=body.track, lap_time_ms=lap_ms)
        except Exception:
            logger.exception('Tournament processing failed for Mini App lap %s', lap_id)
            warning = 'Круг сохранён, но начисление достижений требует проверки администратора'
        response = {'ok': True, 'lap_id': lap_id, 'promoted_to': promoted_to, 'warning': warning}
        await miniapp_laps.finish_lap(_user.id, body.idempotency_key, response)
        return response

    @router.get('/super/pilots')
    async def pilots(pilot_number: int = Query(gt=0), _user=Depends(super_admin)):
        pilot = await db.get_pilot_by_number(pilot_number)
        fields = ('telegram_id', 'username', 'display_name', 'pilot_number', 'phone', 'rating', 'current_class')
        return {'pilots': [{key: pilot.get(key) for key in fields}] if pilot else []}

    @router.post('/super/tracks')
    async def add_track(body: TrackInput, _user=Depends(super_admin)):
        await discipline_exists(body.discipline)
        name = body.track.strip()
        if not name:
            raise HTTPException(422, 'Введите название трассы')
        added, _ = await db.add_track(body.discipline, name)
        if not added:
            raise HTTPException(409, 'Трасса уже существует')
        return {'ok': True}

    @router.delete('/super/tracks')
    async def remove_track(body: TrackInput, _user=Depends(super_admin)):
        await discipline_exists(body.discipline)
        if body.track not in await db.get_tracks_for_discipline(body.discipline):
            raise HTTPException(404, 'Трасса не найдена')
        await db.remove_track(body.discipline, body.track)
        return {'ok': True}

    @router.put('/super/benchmarks')
    async def benchmark(body: BenchmarkInput, user=Depends(super_admin)):
        if body.class_name not in CLASS_LADDER:
            raise HTTPException(422, 'Неизвестный класс')
        if body.track not in await db.get_tracks_for_discipline(body.class_name):
            raise HTTPException(422, 'Неизвестная трасса для класса')
        ms = parse_lap(body.lap_time)
        await db.set_class_benchmark(body.class_name, month_bounds()[0], body.track, ms, user.id)
        return {'ok': True}

    return router

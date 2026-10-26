"""Authenticated Mini App operations backed by the bot's existing services."""
from __future__ import annotations

import logging
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from config import SUPER_ADMIN_IDS
from database import db
from data.tournament import CLASS_LADDER, canonical_class_name
from handlers.common import sanitize_pilot_name
from services.achievements import check_achievements_after_lap
from services import miniapp_laps
from services.phone_normalizer import normalize_phone_for_bot
from services.tournament import check_and_process_promotion, month_bounds, active_track_for_class
from services.yclients_auto import auto_sync_pilot_with_yclients, issue_or_queue_valevo_bonus
from services.yclients_service import get_valevo_bonus_balance
from utils.time_parser import time_to_ms
from utils.score_parser import is_score_discipline, parse_score

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


class PilotUpdate(BaseModel):
    telegram_id: int
    pilot_number: int = Field(gt=0)
    phone: str = Field(min_length=5, max_length=20)


class BalanceOperation(BaseModel):
    telegram_id: int
    amount: float = Field(gt=0)
    action: str = Field(pattern=r'^(credit|debit)$')
    comment: str = Field(min_length=1, max_length=300)


class SupportMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


def parse_lap_result(discipline: str, value: str) -> tuple[str, int]:
    """Week CUP принимает баллы 0–100, остальные дисциплины — время круга."""
    if is_score_discipline(discipline):
        try:
            return parse_score(value)
        except ValueError as exc:
            raise HTTPException(422, 'Введите баллы от 0 до 100, например 98.6') from exc
    return value.strip(), parse_lap(value)


def parse_lap(value: str) -> int:
    try:
        result = time_to_ms(value)
        if result <= 0:
            raise ValueError('Non-positive time')
        return result
    except ValueError as exc:
        raise HTTPException(422, 'Введите положительное время круга, например 01:18.565') from exc


def create_operations_router(current_user, send_message=None):
    router = APIRouter(prefix='/api')

    async def notify(chat_id: int, text: str) -> None:
        if send_message is None:
            raise RuntimeError('notifications unavailable')
        await send_message(chat_id, text)

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
        return {'disciplines': [{'name': name, 'tracks': await db.get_tracks_for_discipline(name),
                                  'is_ladder': canonical_class_name(name) in CLASS_LADDER} for name in names],
                'month_key': month_key, 'benchmarks': await db.get_all_class_benchmarks(month_key)}

    @router.post('/admin/laps')
    async def lap(body: LapInput, _user=Depends(staff)):
        lap_text, lap_ms = parse_lap_result(body.discipline, body.lap_time)
        await discipline_exists(body.discipline)
        is_ladder, active_track = await active_track_for_class(body.discipline)
        if is_ladder and not active_track:
            raise HTTPException(409, 'Эталон на эту дисциплину в этом сезоне ещё не задан — '
                                      'сначала задайте его в «Эталоны месяца»')
        if is_ladder:
            if body.track.strip().casefold() != active_track.casefold():
                raise HTTPException(422, f'Для этой дисциплины в этом сезоне принимается только '
                                          f'трасса эталона «{active_track}»')
        elif body.track not in await db.get_tracks_for_discipline(body.discipline):
            raise HTTPException(422, 'Неизвестная трасса для дисциплины')
        pilot = await db.get_pilot_by_number(body.pilot_number)
        if not pilot:
            raise HTTPException(404, 'Пилот не найден')
        try:
            lap_id, created, response = await miniapp_laps.save_lap(_user.id, body.idempotency_key,
                dict(discipline=body.discipline, username=pilot.get('username'),
                     telegram_id=pilot['telegram_id'], track=body.track,
                     lap_time_text=lap_text, lap_time_ms=lap_ms))
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
        if not pilot:
            return {'pilots': []}
        fields = ('telegram_id', 'username', 'display_name', 'pilot_number', 'phone', 'rating')
        data = {key: pilot.get(key) for key in fields}
        data['current_class'] = await db.get_pilot_class(pilot['telegram_id'])
        balance = 0.0
        if pilot.get('yclients_client_id'):
            try:
                balance = float(await get_valevo_bonus_balance(pilot['yclients_client_id']) or 0)
            except Exception:
                logger.exception('Failed to load bonus balance for pilot %s', pilot['telegram_id'])
        data['bonus_balance'] = round(balance, 2)
        return {'pilots': [data]}

    @router.patch('/super/pilots')
    async def update_pilot(body: PilotUpdate, _user=Depends(super_admin)):
        phone = normalize_phone_for_bot(body.phone)
        if not phone:
            raise HTTPException(422, 'Введите корректный российский номер телефона')
        ok, reason = await db.update_pilot_contact(body.telegram_id, body.pilot_number, phone)
        if not ok:
            detail = {
                'number_taken': (409, 'Этот номер уже занят другим пилотом'),
                'phone_taken': (409, 'Этот телефон уже привязан к другому пилоту'),
                'not_found': (404, 'Пилот не найден'),
            }.get(reason, (409, 'Не удалось сохранить изменения, попробуйте ещё раз'))
            raise HTTPException(*detail)
        return {'ok': True, 'pilot_number': body.pilot_number, 'phone': phone}

    @router.post('/super/balance')
    async def balance_operation(body: BalanceOperation, user=Depends(super_admin)):
        pilot = await db.get_pilot_by_telegram_id(body.telegram_id)
        if not pilot:
            raise HTTPException(404, 'Пилот не найден')
        if not pilot.get('yclients_client_id'):
            try:
                await auto_sync_pilot_with_yclients(body.telegram_id, pilot.get('phone'), pilot.get('username'))
                pilot = await db.get_pilot_by_telegram_id(body.telegram_id)
            except Exception:
                logger.exception('Auto sync before bonus failed for %s', body.telegram_id)

        delta = body.amount if body.action == 'credit' else -body.amount
        operation = 'Начисление' if delta > 0 else 'Списание'
        pilot_name = pilot.get('display_name') or pilot.get('username') or 'Пилот'
        comment = body.comment.strip()

        result = await issue_or_queue_valevo_bonus(
            telegram_id=body.telegram_id,
            client_id=pilot.get('yclients_client_id'),
            amount=delta,
            title=f'Valevo Bonus: {operation.lower()} администратором {user.id} (мини-апп) — {comment}',
            source='admin_manual_miniapp',
            phone=pilot.get('phone'),
            name=pilot_name,
        )

        if result.get('ok'):
            notify_text = (
                f"🏆 На ваш бонусный счёт Valevo начислено +{body.amount:g}💎\n\nКомментарий: {comment}\n\n"
                "Баланс уже доступен и может быть использован для заездов в клубе."
                if delta > 0 else
                f"🎟 С вашего бонусного счёта Valevo списано {body.amount:g}💎\n\nКомментарий: {comment}\n\n"
                f"Текущий баланс: {float(result.get('balance') or 0):.2f}💎"
            )
            try:
                await notify(body.telegram_id, notify_text)
            except Exception:
                logger.exception('Balance notify failed for pilot %s', body.telegram_id)
            return {'ok': True, 'status': 'done', 'balance': round(float(result.get('balance') or 0), 2)}

        if result.get('status') == 'queued':
            return {'ok': True, 'status': 'queued',
                    'message': result.get('message', 'карта/синхронизация пока недоступна')}

        raise HTTPException(502, f"Ошибка YCLIENTS: {result.get('message', 'неизвестная ошибка')}")

    @router.post('/support')
    async def support(body: SupportMessage, user=Depends(current_user)):
        pilot = await db.get_pilot_by_telegram_id(user.id)
        name = (pilot or {}).get('display_name') or (pilot or {}).get('username') or f'ID {user.id}'
        number = (pilot or {}).get('pilot_number')
        who = f'{name} (#{number})' if number else name
        text = f'📨 Обращение в поддержку из мини-аппа\n\nОт: {who}\nTelegram ID: {user.id}\n\n{body.message.strip()}'
        delivered = False
        for admin_id in SUPER_ADMIN_IDS:
            try:
                await notify(admin_id, text)
                delivered = True
            except Exception:
                logger.exception('Support notify failed for admin %s', admin_id)
        if not delivered:
            raise HTTPException(503, 'Не удалось отправить сообщение. Попробуйте позже или напишите в бота напрямую.')
        return {'ok': True}

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

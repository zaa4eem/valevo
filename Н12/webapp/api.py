from __future__ import annotations
import html
import logging
import mimetypes
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from aiogram import Bot
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from config import BOT_TOKEN, REFERRAL_BONUS_RUB
from data.tournament import CLASS_LADDER, next_main_class
from database.db import (
    get_all_pilot_display_names, get_pilot_achievements, get_pilot_by_telegram_id,
    get_pilot_class, get_pilot_history_stats, get_referral_stats,
)
from handlers.common import format_hours, format_phone_display
from services.achievements import CATALOG
from services.levels import LEGEND_LEVEL_CAP_RATING, LEVEL_BOUNDARIES, TOTAL_LEVELS, pilot_level, pilot_rank_info
from services.roulette import SPIN_COST_RUB, SpinError, prize_catalog, spin
from services.tournament import live_class_score, load_month_snapshot, month_bounds
from services.yclients_service import get_client, get_client_total_hours, get_valevo_bonus_balance
from webapp.auth import InitDataError, TelegramWebAppUser, authenticate

STATIC=Path(__file__).resolve().parent/'static'
mimetypes.add_type('text/javascript','.mjs')
_bot: Bot|None=None
@asynccontextmanager
async def lifespan(_app):
    global _bot
    from database.db import init_db
    from handlers.booking import ensure_booking_schema
    await init_db()
    await ensure_booking_schema()
    _bot=Bot(BOT_TOKEN)
    yield
    await _bot.session.close()
app=FastAPI(title='VALEVO Mini App', lifespan=lifespan)


@app.middleware('http')
async def response_safety(request: Request, call_next):
    request_id=uuid.uuid4().hex
    try:
        response=await call_next(request)
    except Exception:
        logging.getLogger(__name__).exception('Mini App request failed: %s %s [%s]',request.method,request.url.path,request_id)
        response=JSONResponse({'error':'Не удалось завершить запрос. Проверьте результат операции перед повтором.','request_id':request_id},status_code=500)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control']='no-store'
    elif request.url.path=='/':
        response.headers['Cache-Control']='no-cache'
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['X-Request-ID']=request_id
    return response


@app.get('/api/ready')
async def readiness():
    from database.db import get_db
    db=None
    try:
        db=await get_db()
        await db.execute('SELECT 1 FROM pilots LIMIT 1')
        await db.execute('SELECT 1 FROM booking_requests_v2 LIMIT 1')
        return {'ok':True}
    except Exception:
        return JSONResponse({'ok':False,'error':'База данных недоступна'},status_code=503)
    finally:
        if db is not None: await db.close()

def current_user(authorization: str|None=Header(default=None)) -> TelegramWebAppUser:
    if not authorization or not authorization.lower().startswith('tma '): raise HTTPException(401,'Откройте приложение из Telegram')
    try: return authenticate(authorization[4:].strip())
    except InitDataError as exc: raise HTTPException(401,str(exc)) from exc

@app.exception_handler(HTTPException)
async def http_error(_r:Request,e:HTTPException): return JSONResponse({'error':e.detail},status_code=e.status_code)

@app.get('/api/health')
async def health(): return {'ok':True}

@app.get('/api/me')
async def me(user:TelegramWebAppUser=Depends(current_user)):
    p=await get_pilot_by_telegram_id(user.id)
    if not p: return {'registered':False,'is_admin':user.is_admin,'is_super_admin':user.is_super_admin}
    safe={k:p.get(k) for k in ('telegram_id','username','phone','display_name','pilot_number','rating','current_class') if k in p}
    return {'registered':True,'is_admin':user.is_admin,'is_super_admin':user.is_super_admin,'profile':safe}

def _rank_progress(rating: int) -> dict|None:
    current, next_rank = pilot_rank_info(rating)
    if not next_rank:
        return None
    span = next_rank[0] - current[0]
    done = max(0, rating - current[0])
    fraction = max(0.0, min(1.0, done / span)) if span > 0 else 1.0
    return {'fraction': round(fraction, 3), 'points_left': next_rank[0] - rating,
            'next_emoji': next_rank[1], 'next_title': next_rank[2]}

def _level_progress(rating: int, level: int) -> dict|None:
    if level >= TOTAL_LEVELS:
        return None
    current_boundary = LEVEL_BOUNDARIES[level - 1]
    next_boundary = LEVEL_BOUNDARIES[level] if level < len(LEVEL_BOUNDARIES) else LEGEND_LEVEL_CAP_RATING
    span = next_boundary - current_boundary
    done = rating - current_boundary
    fraction = max(0.0, min(1.0, done / span)) if span > 0 else 1.0
    return {'fraction': round(fraction, 3), 'points_left': max(0, next_boundary - rating), 'next_level': level + 1}

@app.get('/api/profile')
async def profile_full(user:TelegramWebAppUser=Depends(current_user)):
    pilot=await get_pilot_by_telegram_id(user.id)
    if not pilot: raise HTTPException(404,'Профиль не найден')

    rating=int(pilot.get('rating') or 0)
    current_rank,_=pilot_rank_info(rating)
    level=pilot_level(rating)
    rank={'emoji':current_rank[1],'title':current_rank[2],'rating':rating,'level':level,'total_levels':TOTAL_LEVELS,
          'rank_progress':_rank_progress(rating),'level_progress':_level_progress(rating,level)}

    club=None
    club_error=False
    if pilot.get('yclients_client_id'):
        try:
            yclients_data=await get_client(pilot['yclients_client_id'])
            total_hours=await get_client_total_hours(pilot['yclients_client_id'])
            bonus_balance=await get_valevo_bonus_balance(pilot['yclients_client_id'])
            visits=yclients_data.get('visits',0) if isinstance(yclients_data,dict) else 0
            club={'visits':visits,'hours_text':format_hours(total_hours),'bonus_balance':round(float(bonus_balance or 0),2)}
        except Exception:
            logging.getLogger(__name__).warning('Mini App club stats unavailable for %s',user.id)
            club_error=True

    history=await get_pilot_history_stats(telegram_id=user.id,username=pilot.get('username'))
    achievements={k:history.get(k) for k in (
        'gold','silver','bronze','podiums','total_results','disciplines_count',
        'favorite_discipline','favorite_discipline_count','favorite_track','favorite_track_count','last_result',
    )}

    tournament_class=None
    try:
        current_class=await get_pilot_class(user.id)
        month_key,start_iso,end_iso=month_bounds()

        async def class_block(name: str) -> dict:
            result=await live_class_score(user.id,name,month_key,start_iso,end_iso)
            return {'class_name':result['class_name'],'qualifies':result['qualifies'],'score':result['score'],
                    'starts':result['starts'],'min_starts':result['min_starts'],
                    'threshold':CLASS_LADDER.get(result['class_name'],{}).get('threshold')}

        side_class_name=next((name for name,cfg in CLASS_LADDER.items() if cfg.get('side_of')==current_class),None)
        tournament_class={
            'current':await class_block(current_class),
            'side':await class_block(side_class_name) if side_class_name else None,
            'next_class':next_main_class(current_class),
        }
    except Exception:
        logging.getLogger(__name__).exception('Mini App tournament class unavailable for %s',user.id)

    unlocked=await get_pilot_achievements(user.id)
    badges={'unlocked':len(unlocked),'total':len(CATALOG),
            'items':[{'code':code,'emoji':emoji,'title':title,'unlocked':code in unlocked}
                     for code,(emoji,title,_desc,_reward) in CATALOG.items()]}

    return {'rank':rank,'phone':format_phone_display(pilot.get('phone')),'club':club,'club_error':club_error,
            'achievements':achievements,'tournament_class':tournament_class,'badges':badges}

@app.get('/api/leaderboard')
async def leaderboard(_user:TelegramWebAppUser=Depends(current_user)):
    month_key,start,end=month_bounds(); snap=await load_month_snapshot(month_key,start,end); names=await get_all_pilot_display_names()
    overall=[]
    for i,row in enumerate(snap.overall_ranking()[:7],1): overall.append({'place':i,'telegram_id':row['telegram_id'],'name':str(names.get(row['telegram_id']) or row['telegram_id']),'points':int(row['total'])})
    disciplines=[]
    for cls in CLASS_LADDER:
        rows=[]
        for tid,place in snap._positions.get(cls,{}).items():
            score=snap.class_score_for(tid,cls); ms=score.get('best_ms')
            if ms: rows.append({'place':place,'telegram_id':tid,'name':str(names.get(tid) or tid),'best_ms':int(ms)})
        rows.sort(key=lambda x:x['place']); disciplines.append({'name':cls,'rows':rows})
    return {'overall':overall,'disciplines':disciplines}

@app.get('/api/referrals')
async def referrals(user:TelegramWebAppUser=Depends(current_user)):
    if _bot is None: raise HTTPException(503,'Бот ещё запускается')
    info=await _bot.get_me(); stats=await get_referral_stats(user.id)
    return {'bonus':REFERRAL_BONUS_RUB,'link':f'https://t.me/{info.username}?start=ref_{user.id}','stats':stats}

@app.get('/api/roulette')
async def roulette(user:TelegramWebAppUser=Depends(current_user)):
    p=await get_pilot_by_telegram_id(user.id); balance=0.0
    if p and p.get('yclients_client_id'):
        try: balance=float(await get_valevo_bonus_balance(p['yclients_client_id']) or 0)
        except Exception: raise HTTPException(503,'Не удалось получить бонусный баланс. Попробуйте позже.')
    return {'spin_cost':SPIN_COST_RUB,'balance':round(balance,2),'prizes':prize_catalog()}

class SpinRequest(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r'^[a-zA-Z0-9_-]+$')


@app.post('/api/roulette/spin')
async def roulette_spin(payload: 'SpinRequest', user:TelegramWebAppUser=Depends(current_user)):
    try: return {'ok':True,**(await spin(user.id,payload.idempotency_key))}
    except SpinError as exc: return JSONResponse({'ok':False,'error':str(exc),'retryable':exc.retryable},status_code=409)

from services.miniapp_booking import create_booking_router
from webapp.finance_api import create_finance_router
from webapp.operations_api import create_operations_router
app.include_router(create_booking_router(current_user))
app.include_router(create_finance_router(current_user))
app.include_router(create_operations_router(current_user))

app.mount('/assets',StaticFiles(directory=STATIC),name='assets')
@app.get('/')
async def index(): return FileResponse(STATIC/'index.html')

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
from data.tournament import CLASS_LADDER
from database.db import get_all_pilot_display_names, get_pilot_by_telegram_id, get_referral_stats
from services.roulette import SPIN_COST_RUB, SpinError, prize_catalog, spin
from services.tournament import load_month_snapshot, month_bounds
from services.yclients_service import get_valevo_bonus_balance
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

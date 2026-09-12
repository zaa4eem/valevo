from __future__ import annotations
import asyncio
import logging
import random

from database.db import get_pilot_by_telegram_id, record_roulette_spin, update_pilot_rating
from services.yclients_auto import issue_or_queue_valevo_bonus
from services.yclients_service import change_valevo_bonus, get_valevo_bonus_balance

logger = logging.getLogger(__name__)
SPIN_COST_RUB = 1000
PRIZES = [
    ("bonus_300","💶","300 ₽ на счёт","bonus",300,60),
    ("bonus_500","💶","500 ₽ на счёт","bonus",500,90),
    ("bonus_700","💶","700 ₽ на счёт","bonus",700,130),
    ("bonus_800","💰","800 ₽ на счёт","bonus",800,150),
    ("bonus_900","💰","900 ₽ на счёт","bonus",900,120),
    ("bonus_1000","🔄","Возврат спина — 1000 ₽","bonus",1000,100),
    ("bonus_1200","💎","1200 ₽ на счёт","bonus",1200,70),
    ("bonus_1500","💎","1500 ₽ на счёт","bonus",1500,40),
    ("bonus_1800","🔥","1800 ₽ на счёт","bonus",1800,20),
    ("bonus_2200","🔥","2200 ₽ на счёт","bonus",2200,10),
    ("bonus_2700","🌟","2700 ₽ на счёт","bonus",2700,5),
    ("bonus_3500","🌟","3500 ₽ на счёт","bonus",3500,3),
    ("bonus_5000","👑","5000 ₽ на счёт","bonus",5000,2),
    ("bonus_8000","🎉","ДЖЕКПОТ — 8000 ₽","bonus",8000,1),
    ("rating_10","🔰","+10 рейтинга","rating",10,70),
    ("rating_20","🏎","+20 рейтинга","rating",20,50),
    ("rating_35","🥉","+35 рейтинга","rating",35,35),
    ("rating_50","🥈","+50 рейтинга","rating",50,25),
    ("rating_75","🥇","+75 рейтинга","rating",75,15),
    ("rating_120","💠","+120 рейтинга","rating",120,5),
]
_WEIGHTS=[p[5] for p in PRIZES]
_locks: dict[int, asyncio.Lock] = {}

class SpinError(Exception):
    pass

def prize_catalog():
    return [{"code":c,"emoji":e,"title":t,"kind":k,"value":v} for c,e,t,k,v,_ in PRIZES]

def _lock(tid:int):
    return _locks.setdefault(tid, asyncio.Lock())

async def spin(telegram_id:int)->dict:
    async with _lock(telegram_id):
        pilot=await get_pilot_by_telegram_id(telegram_id)
        if not pilot:
            raise SpinError("Пилот не найден")
        client_id=pilot.get("yclients_client_id")
        if not client_id:
            raise SpinError("Профиль ещё не синхронизирован с клубной системой")
        balance=await get_valevo_bonus_balance(client_id)
        if balance < SPIN_COST_RUB:
            raise SpinError(f"Недостаточно средств: нужно {SPIN_COST_RUB} ₽, на счету {balance:g} ₽")
        charge=await change_valevo_bonus(client_id,-SPIN_COST_RUB,title="Рулетка: списание за спин")
        if not charge.get("ok"):
            raise SpinError("YCLIENTS временно недоступен, попробуйте позже")
        code,emoji,title,kind,value,_=random.choices(PRIZES,weights=_WEIGHTS,k=1)[0]
        status="ok"
        if kind=="rating":
            try:
                await update_pilot_rating(telegram_id,value)
            except Exception:
                logger.exception("roulette rating payout failed")
                status="failed"
        else:
            payout=await issue_or_queue_valevo_bonus(telegram_id,client_id,value,f"Рулетка: приз «{title}»","roulette_prize")
            status="ok" if payout.get("ok") else "queued"
        await record_roulette_spin(telegram_id,SPIN_COST_RUB,code,kind,value,status)
        new_balance=await get_valevo_bonus_balance(client_id)
        return {"code":code,"emoji":emoji,"title":title,"kind":kind,"value":value,"prize_status":status,"balance":new_balance}

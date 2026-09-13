import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from database import db
from handlers import booking as b
from webapp.finance_api import create_finance_router


def test_confirmed_bookings_count_without_payments_and_cancellations_are_excluded(tmp_path, monkeypatch):
    monkeypatch.setattr(db,'DB_NAME',str(tmp_path/'stats.db'))
    async def setup():
        await b.ensure_booking_schema()
        start=(datetime.now(b.TZ)+timedelta(days=1)).replace(hour=18,minute=0,second=0,microsecond=0)
        args=dict(pilot={'telegram_id':1,'phone':'70000000000'}, username=None, place_type='motion',place_keys=['motion_1','motion_2'],start_at=start,end_at=start+timedelta(minutes=90),duration_minutes=90,source='miniapp')
        _, bid, _=await b._create_pending_booking(**args)
        return bid,start
    bid,start=asyncio.run(setup())
    role=SimpleNamespace(id=999,is_super_admin=True)
    app=FastAPI()
    app.include_router(create_finance_router(lambda:role))
    client=TestClient(app)
    assert client.get('/api/admin/finance').json()['turnover_kopecks']==0
    asyncio.run(b._set_booking_status(bid,'confirmed'))
    stats=client.get('/api/admin/finance').json()
    assert (stats['turnover_kopecks'],stats['commission_kopecks'],stats['club_kopecks'],stats['hours'])==(300000,30000,270000,3)
    assert stats['booking_count']==1 and stats['daily'][0]['date']==start.date().isoformat()
    assert 'balance_kopecks' not in stats and 'payouts_kopecks' not in stats
    assert client.get('/api/admin/finance?source=bot').json()['booking_count']==0
    assert client.get('/api/admin/finance?date_to=2000-01-01').json()['booking_count']==0
    assert client.post('/api/admin/finance/events',json={}).status_code==404
    asyncio.run(b._set_booking_status(bid,'cancelled'))
    assert client.get('/api/admin/finance').json()['turnover_kopecks']==0
    role.is_super_admin=False
    assert client.get('/api/admin/finance').status_code==403

import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from database import db
from handlers import booking
from webapp.api import app, current_user
from webapp.auth import TelegramWebAppUser


def test_booking_approval_statistics_and_cancel_journey(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_NAME', str(tmp_path / 'journey.db'))
    monkeypatch.setattr(booking, 'SUPER_ADMIN_IDS', [999])
    async def setup():
        await db.init_db()
        await booking.ensure_booking_schema()
        connection = await db.get_db()
        await connection.execute("INSERT INTO pilots (telegram_id, username, display_name,phone) VALUES (101,'test','Пилот','70000000000')")
        await connection.close()
    asyncio.run(setup())
    monkeypatch.setattr(booking, '_remote_conflicts', AsyncMock(return_value=([],None)))
    monkeypatch.setattr(booking, '_create_yclients_record', AsyncMock(side_effect=[(8001,None),(8002,None)]))
    monkeypatch.setattr(booking, '_delete_yclients_record', AsyncMock(return_value=(True,None)))
    user = TelegramWebAppUser(101, 'test', None, None, False, False)
    admin = TelegramWebAppUser(999, 'owner', None, None, True, True)
    app.dependency_overrides[current_user] = lambda: user
    try:
        client = TestClient(app)
        start = (datetime.now(booking.TZ)+timedelta(days=1)).replace(hour=18,minute=0,second=0,microsecond=0)
        payload = {'place_keys':['motion_1','motion_2'],'start_at':start.isoformat(),'duration_minutes':90,'idempotency_key':'journey-request'}
        response = client.post('/api/bookings',json=payload)
        assert response.status_code == 200, response.text
        result=response.json()
        assert result['quoted_kopecks']==300000 and result['status']=='pending_admin'
        assert client.post('/api/bookings',json=payload).json()['id']==result['id']
        assert len(client.get('/api/bookings').json()['bookings'])==1
        assert client.get('/api/admin/finance').status_code==403
        app.dependency_overrides[current_user]=lambda: admin
        bid=result['id']
        assert client.post(f'/api/admin/bookings/{bid}/approve').json()['status']=='confirmed'
        assert client.post(f'/api/admin/bookings/{bid}/approve').status_code==409
        assert booking._create_yclients_record.await_count==2
        stats=client.get('/api/admin/finance').json()
        assert stats['turnover_kopecks']==300000 and stats['commission_kopecks']==30000 and stats['hours']==3
        app.dependency_overrides[current_user]=lambda: user
        assert client.post(f'/api/bookings/{bid}/cancel').json()['status']=='cancelled'
        assert booking._delete_yclients_record.await_count==2
        app.dependency_overrides[current_user]=lambda: admin
        assert client.get('/api/admin/finance').json()['turnover_kopecks']==0
        async def notifications():
            connection=await db.get_db()
            try:
                cur=await connection.execute('SELECT recipient_id,event FROM booking_notification_outbox ORDER BY id')
                return await cur.fetchall()
            finally:
                await connection.close()
        assert asyncio.run(notifications()) == [(999,'pending_admin'),(101,'confirmed'),(101,'cancelled')]
    finally:
        app.dependency_overrides.clear()

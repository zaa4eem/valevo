from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import asyncio
import aiosqlite


@pytest.fixture
def setup(monkeypatch):
    from webapp import operations_api as ops
    user = SimpleNamespace(id=11, is_admin=False, is_super_admin=False)
    app = FastAPI()
    app.include_router(ops.create_operations_router(lambda: user))
    return ops, user, TestClient(app)


def test_profile_scoped_and_duplicate(setup, monkeypatch):
    ops, user, client = setup
    monkeypatch.setattr(ops.db, 'get_pilot_by_telegram_id', AsyncMock(return_value={'username':'pilot'}))
    save = AsyncMock(return_value=True)
    monkeypatch.setattr(ops.db, 'update_display_name', save)
    assert client.patch('/api/profile', json={'display_name':' Racer '}).json()['display_name'] == 'Racer'
    save.assert_awaited_once_with(11, 'Racer')
    save.return_value = False
    assert client.patch('/api/profile', json={'display_name':'Racer'}).status_code == 409
    assert client.patch('/api/profile', json={'display_name':'<script>'}).status_code == 422


def test_role_guards_and_inheritance(setup, monkeypatch):
    ops, user, client = setup
    body = {'discipline':'GT3','track':'Spa'}
    for role in ('user','admin'):
        user.is_admin = role == 'admin'
        assert client.post('/api/super/tracks', json=body).status_code == 403
        assert client.get('/api/super/pilots?pilot_number=5').status_code == 403
    user.is_super_admin = True
    monkeypatch.setattr(ops.db, 'get_all_disciplines', AsyncMock(return_value=['GT3']))
    monkeypatch.setattr(ops.db, 'add_track', AsyncMock(return_value=(True,None)))
    assert client.post('/api/super/tracks', json=body).status_code == 200


def test_lap_validated_and_scored(setup, monkeypatch):
    ops, user, client = setup
    body = {'discipline':'GT3','track':'Spa','pilot_number':5,'lap_time':'1:18.565','idempotency_key':'lap-key'}
    assert client.post('/api/admin/laps', json=body).status_code == 403
    user.is_super_admin = True
    monkeypatch.setattr(ops.db, 'get_all_disciplines', AsyncMock(return_value=['GT3']))
    monkeypatch.setattr(ops.db, 'get_tracks_for_discipline', AsyncMock(return_value=['Spa']))
    monkeypatch.setattr(ops.db, 'get_all_class_benchmarks', AsyncMock(return_value={'GT3':{'track':'Spa'}}))
    monkeypatch.setattr(ops.db, 'get_pilot_by_number', AsyncMock(return_value={'telegram_id':55,'username':'pilot'}))
    save = AsyncMock(return_value=(9, True, None))
    monkeypatch.setattr(ops.miniapp_laps, 'save_lap', save)
    monkeypatch.setattr(ops.miniapp_laps, 'finish_lap', AsyncMock())
    promote = AsyncMock(return_value=None)
    achieve = AsyncMock()
    monkeypatch.setattr(ops, 'check_and_process_promotion', promote)
    monkeypatch.setattr(ops, 'check_achievements_after_lap', achieve)
    assert client.post('/api/admin/laps', json={**body,'lap_time':'0:00.000'}).status_code == 422
    assert client.post('/api/admin/laps', json={**body,'track':'unknown'}).status_code == 422
    assert client.post('/api/admin/laps', json=body).json()['lap_id'] == 9
    assert save.await_args.args[2]['telegram_id'] == 55
    assert save.await_args.args[2]['lap_time_ms'] == 78565
    promote.assert_awaited_once()
    achieve.assert_awaited_once()
    save.return_value = (9, False, {'ok':True,'lap_id':9,'promoted_to':None,'warning':None})
    assert client.post('/api/admin/laps', json=body).json()['lap_id'] == 9
    promote.assert_awaited_once()
    achieve.assert_awaited_once()


def test_read_operations_scope_and_registration(setup, monkeypatch):
    ops, user, client = setup
    lookup = AsyncMock(return_value={'username':'pilot'})
    history = AsyncMock(return_value={'total_results':3})
    monkeypatch.setattr(ops.db, 'get_pilot_by_telegram_id', lookup)
    monkeypatch.setattr(ops.db, 'get_pilot_history_stats', history)
    assert client.get('/api/results?telegram_id=999').json() == {'total_results':3}
    history.assert_awaited_once_with(11, 'pilot')
    lookup.return_value = None
    assert client.get('/api/results').status_code == 409
    monkeypatch.setattr(ops.db, 'get_all_disciplines', AsyncMock(return_value=['GT3']))
    monkeypatch.setattr(ops.db, 'get_tracks_for_discipline', AsyncMock(return_value=['Spa']))
    monkeypatch.setattr(ops.db, 'get_all_class_benchmarks', AsyncMock(return_value={}))
    assert client.get('/api/disciplines').json()['disciplines'] == [{'name':'GT3','tracks':['Spa'],'is_ladder':True}]


def test_super_benchmark_and_delete_validate_before_write(setup, monkeypatch):
    ops, user, client = setup
    user.is_super_admin = True
    discipline = next(iter(ops.CLASS_LADDER))
    monkeypatch.setattr(ops.db, 'get_all_disciplines', AsyncMock(return_value=[discipline]))
    monkeypatch.setattr(ops.db, 'get_tracks_for_discipline', AsyncMock(return_value=['Spa']))
    benchmark = AsyncMock()
    remove = AsyncMock(return_value=True)
    monkeypatch.setattr(ops.db, 'set_class_benchmark', benchmark)
    monkeypatch.setattr(ops.db, 'remove_track', remove)
    body = {'class_name':discipline,'track':'Spa','lap_time':'1:18.565','idempotency_key':'lap-key'}
    assert client.put('/api/super/benchmarks', json={**body,'class_name':'nope'}).status_code == 422
    assert client.put('/api/super/benchmarks', json=body).status_code == 200
    assert benchmark.await_args.args[2:] == ('Spa',78565,11)
    assert client.request('DELETE','/api/super/tracks',json={'discipline':discipline,'track':'nope'}).status_code == 404
    remove.assert_not_awaited()
    assert client.request('DELETE','/api/super/tracks',json={'discipline':discipline,'track':'Spa'}).status_code == 200
    remove.assert_awaited_once_with(discipline,'Spa')


def test_post_save_scoring_error_is_not_retryable_failure(setup, monkeypatch):
    ops, user, client = setup
    user.is_admin = True
    monkeypatch.setattr(ops.db, 'get_all_disciplines', AsyncMock(return_value=['GT3']))
    monkeypatch.setattr(ops.db, 'get_tracks_for_discipline', AsyncMock(return_value=['Spa']))
    monkeypatch.setattr(ops.db, 'get_all_class_benchmarks', AsyncMock(return_value={'GT3':{'track':'Spa'}}))
    monkeypatch.setattr(ops.db, 'get_pilot_by_number', AsyncMock(return_value={'telegram_id':55,'username':'pilot'}))
    monkeypatch.setattr(ops.miniapp_laps, 'save_lap', AsyncMock(return_value=(9, True, None)))
    monkeypatch.setattr(ops.miniapp_laps, 'finish_lap', AsyncMock())
    monkeypatch.setattr(ops, 'check_and_process_promotion', AsyncMock(side_effect=RuntimeError('scoring unavailable')))
    response = client.post('/api/admin/laps',json={'discipline':'GT3','track':'Spa','pilot_number':5,'lap_time':'1:18.565','idempotency_key':'lap-key'})
    assert response.status_code == 200
    assert response.json()['lap_id'] == 9
    assert response.json()['warning']


def test_lap_idempotency_atomic_replay_and_payload_conflict(tmp_path, monkeypatch):
    from services import miniapp_laps as service
    async def run():
        async def connect():
            return await aiosqlite.connect(str(tmp_path / 'laps.sqlite'))
        monkeypatch.setattr(service, 'get_db', connect)
        db = await connect()
        await db.execute('CREATE TABLE disciplines (id INTEGER PRIMARY KEY,name TEXT UNIQUE)')
        await db.execute('CREATE TABLE laps (id INTEGER PRIMARY KEY,discipline_id INTEGER,username TEXT,telegram_id INTEGER,track TEXT,lap_time_text TEXT,lap_time_ms INTEGER)')
        await db.commit()
        payload = {'discipline':'GT3','username':'pilot','telegram_id':55,'track':'Spa','lap_time_text':'1:18.565','lap_time_ms':78565}
        rows = await asyncio.gather(service.save_lap(7,'key',payload),service.save_lap(7,'key',payload))
        assert rows[0][0] == rows[1][0]
        assert sum(row[1] for row in rows) == 1
        assert (await (await db.execute('SELECT COUNT(*) FROM laps')).fetchone())[0] == 1
        response = {'ok':True,'lap_id':rows[0][0],'promoted_to':'GT3','warning':None}
        await service.finish_lap(7,'key',response)
        assert (await service.save_lap(7,'key',payload))[2] == response
        with pytest.raises(service.LapConflict):
            await service.save_lap(7,'key',{**payload,'lap_time_ms':79000})
        await db.close()
    asyncio.run(run())

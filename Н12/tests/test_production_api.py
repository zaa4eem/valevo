from unittest.mock import AsyncMock
from types import SimpleNamespace
from fastapi.testclient import TestClient
from webapp import api


def test_browser_module_served_with_javascript_mime():
    response=TestClient(api.app).get('/assets/js/roulette.mjs')
    assert response.status_code==200
    assert 'javascript' in response.headers['content-type']


def test_ready_accepts_initialized_booking_database(tmp_path,monkeypatch):
    import asyncio
    from database import db
    from handlers.booking import ensure_booking_schema
    monkeypatch.setattr(db,'DB_NAME',str(tmp_path/'ready.db'))
    async def initialize():
        await db.init_db()
        await ensure_booking_schema()
    asyncio.run(initialize())
    assert TestClient(api.app).get('/api/ready').status_code==200


def test_spin_requires_key_and_deduplicates_by_authenticated_user(monkeypatch):
    client=TestClient(api.app)
    api.app.dependency_overrides[api.current_user]=lambda:SimpleNamespace(id=42)
    operation=AsyncMock(return_value={'code':'rating_10'})
    monkeypatch.setattr(api,'spin',operation)
    try:
        assert client.post('/api/roulette/spin',json={}).status_code==422
        response=client.post('/api/roulette/spin',json={'idempotency_key':'request-123','user_id':999})
        assert response.status_code==200
        operation.assert_awaited_once_with(42,'request-123')
        assert response.headers['cache-control']=='no-store'
    finally:
        api.app.dependency_overrides.clear()


def test_ready_fails_when_database_is_unavailable(monkeypatch):
    from database import db
    monkeypatch.setattr(db,'get_db',AsyncMock(side_effect=OSError('private path')))
    response=TestClient(api.app).get('/api/ready')
    assert response.status_code==503
    assert 'private path' not in response.text


def test_internal_errors_are_json_and_do_not_leak_details(monkeypatch):
    api.app.dependency_overrides[api.current_user]=lambda:SimpleNamespace(id=42)
    monkeypatch.setattr(api,'spin',AsyncMock(side_effect=RuntimeError('private path')))
    try:
        response=TestClient(api.app,raise_server_exceptions=False).post('/api/roulette/spin',json={'idempotency_key':'request-123'})
        assert response.status_code==500
        assert response.json()['error']
        assert 'private path' not in response.text
    finally:
        api.app.dependency_overrides.clear()

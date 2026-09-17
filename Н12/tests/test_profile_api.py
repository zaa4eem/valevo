import asyncio
from types import SimpleNamespace

from fastapi.testclient import TestClient

from database import db
from webapp import api


def _store(tmp_path, monkeypatch):
    monkeypatch.setattr(db, 'DB_NAME', str(tmp_path / 'profile.db'))
    asyncio.run(db.init_db())


def test_profile_endpoint_returns_rank_club_achievements_and_badges(tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch)
    asyncio.run(db.create_pilot(telegram_id=77, username='pilot77', phone='70000000077'))
    asyncio.run(db.update_pilot_rating(77, 165))

    client = TestClient(api.app)
    api.app.dependency_overrides[api.current_user] = lambda: SimpleNamespace(id=77)
    try:
        response = client.get('/api/profile')
        assert response.status_code == 200
        body = response.json()

        assert body['rank']['rating'] == 165
        assert body['rank']['title'] == 'Ас трассы'
        assert body['rank']['rank_progress']['next_title'] == 'Чемпион'
        assert body['rank']['level_progress'] is None or body['rank']['level_progress']['next_level'] > body['rank']['level']

        assert body['club'] is None  # нет yclients_client_id — не пытаемся дёрнуть YCLIENTS
        assert body['club_error'] is False

        assert body['achievements']['total_results'] == 0
        assert body['achievements']['gold'] == 0

        assert body['tournament_class']['current']['class_name'] == 'MX-5'
        assert body['tournament_class']['next_class']

        assert body['badges']['total'] == len(body['badges']['items'])
        assert body['badges']['unlocked'] == 0
        assert all(not item['unlocked'] for item in body['badges']['items'])
    finally:
        api.app.dependency_overrides.clear()


def test_profile_endpoint_requires_registered_pilot(tmp_path, monkeypatch):
    _store(tmp_path, monkeypatch)
    client = TestClient(api.app)
    api.app.dependency_overrides[api.current_user] = lambda: SimpleNamespace(id=999)
    try:
        response = client.get('/api/profile')
        assert response.status_code == 404
    finally:
        api.app.dependency_overrides.clear()

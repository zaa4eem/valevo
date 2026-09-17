import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from handlers import booking as b
from database import db as database


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(database, 'DB_NAME', str(tmp_path / 'test.db'))
    asyncio.run(b.ensure_booking_schema())


def selection():
    start = (datetime.now(b.TZ) + timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)
    return dict(pilot={'telegram_id': 10, 'phone': '70000000000', 'display_name': 'Pilot'},
                username='pilot', place_type='motion', place_keys=['motion_1', 'motion_2'],
                start_at=start, end_at=start + timedelta(minutes=90), duration_minutes=90)


def _next_start(hour, weekday_ok):
    now = datetime.now(b.TZ)
    for offset in range(1, b.BOOKING_DAYS_AHEAD):
        candidate = (now + timedelta(days=offset)).replace(hour=hour, minute=0, second=0, microsecond=0)
        if weekday_ok(candidate.weekday()):
            return candidate
    raise AssertionError('no matching day within booking window')


def test_happy_hour_discounts_weekday_afternoon_booking(store):
    async def run():
        start = _next_start(14, lambda wd: wd < 5)  # будний день
        args = dict(pilot={'telegram_id': 11, 'phone': '70000000001', 'display_name': 'Pilot'},
                    username='pilot', place_type='static', place_keys=['static_1'],
                    start_at=start, end_at=start + timedelta(minutes=60), duration_minutes=60)
        ok, bid, _ = await b._create_pending_booking(**args, source='miniapp', idempotency_key='happy-static')
        assert ok
        booking = await b._fetch_booking(bid)
        assert booking['hourly_rate_kopecks'] == 60000
        assert booking['quoted_kopecks'] == 60000
        assert booking['billed_as_static'] == 0
    asyncio.run(run())


def test_weekend_afternoon_keeps_regular_rate(store):
    async def run():
        start = _next_start(14, lambda wd: wd >= 5)  # выходной
        args = dict(pilot={'telegram_id': 12, 'phone': '70000000002', 'display_name': 'Pilot'},
                    username='pilot', place_type='static', place_keys=['static_1'],
                    start_at=start, end_at=start + timedelta(minutes=60), duration_minutes=60)
        ok, bid, _ = await b._create_pending_booking(**args, source='miniapp', idempotency_key='weekend-static')
        assert ok
        booking = await b._fetch_booking(bid)
        assert booking['hourly_rate_kopecks'] == 70000
    asyncio.run(run())


def test_bill_as_static_prices_motion_seat_at_static_rate(store):
    async def run():
        start = (datetime.now(b.TZ) + timedelta(days=1)).replace(hour=20, minute=0, second=0, microsecond=0)
        args = dict(pilot={'telegram_id': 13, 'phone': '70000000003', 'display_name': 'Pilot'},
                    username='pilot', place_type='motion', place_keys=['motion_1'],
                    start_at=start, end_at=start + timedelta(minutes=60), duration_minutes=60)
        ok, bid, _ = await b._create_pending_booking(**args, source='miniapp', idempotency_key='bill-as-static', bill_as_static=True)
        assert ok
        booking = await b._fetch_booking(bid)
        assert booking['place_type'] == 'motion'
        assert booking['hourly_rate_kopecks'] == 70000  # тариф статики, не подвижки
        assert booking['billed_as_static'] == 1
        assert booking['items'][0]['staff_id'] == b.BOOKING_PLACES['motion_1']['staff_id']  # тот же физический юнит
    asyncio.run(run())


def test_bill_as_static_ignored_for_static_places(store):
    async def run():
        start = (datetime.now(b.TZ) + timedelta(days=1)).replace(hour=20, minute=0, second=0, microsecond=0)
        args = dict(pilot={'telegram_id': 14, 'phone': '70000000004', 'display_name': 'Pilot'},
                    username='pilot', place_type='static', place_keys=['static_1'],
                    start_at=start, end_at=start + timedelta(minutes=60), duration_minutes=60)
        ok, bid, _ = await b._create_pending_booking(**args, source='miniapp', idempotency_key='static-noop', bill_as_static=True)
        assert ok
        booking = await b._fetch_booking(bid)
        assert booking['billed_as_static'] == 0
        assert booking['hourly_rate_kopecks'] == 70000
    asyncio.run(run())


def test_quote_and_retry_are_persisted_atomically(store):
    async def run():
        args = selection()
        first = await b._create_pending_booking(**args, source='miniapp', idempotency_key='request-123')
        second = await b._create_pending_booking(**args, source='miniapp', idempotency_key='request-123')
        assert first[0] and first[1] == second[1]
        booking = await b._fetch_booking(first[1])
        assert booking['source'] == 'miniapp'
        assert booking['quoted_kopecks'] == 300000
        assert booking['hourly_rate_kopecks'] == 100000
        assert booking['commission_bps'] == 1000
        args['duration_minutes'] = 60
        args['end_at'] = args['start_at'] + timedelta(minutes=60)
        changed = await b._create_pending_booking(**args, source='miniapp', idempotency_key='request-123')
        assert not changed[0]
    asyncio.run(run())


@pytest.mark.parametrize('keys', [[], ['motion_1', 'motion_1'], ['motion_1', 'static_1'], ['unknown']])
def test_invalid_places_cannot_be_stored(store, keys):
    async def run():
        args = selection()
        args['place_keys'] = keys
        ok, _, _ = await b._create_pending_booking(**args)
        assert not ok
    asyncio.run(run())


def test_concurrent_bookings_only_one_claims_seats(store):
    async def run():
        first, second = await asyncio.gather(b._create_pending_booking(**selection()), b._create_pending_booking(**selection()))
        assert sum(x[0] for x in (first, second)) == 1
    asyncio.run(run())


def test_failed_cancel_keeps_slot_blocked_and_clears_deleted_ids(store, monkeypatch):
    async def run():
        _, bid, _ = await b._create_pending_booking(**selection())
        row = await b._fetch_booking(bid)
        for n, item in enumerate(row['items']):
            await b._save_yclients_record(bid, item['id'], 100 + n)
        await b._set_booking_status(bid, 'confirmed')
        monkeypatch.setattr(b, '_delete_yclients_record', AsyncMock(side_effect=[(True, None), (False, 'timeout')]))
        ok, _ = await b._cancel_booking(await b._fetch_booking(bid))
        assert not ok
        row = await b._fetch_booking(bid)
        assert row['status'] == 'cancellation_failed'
        assert row['items'][0]['yclients_record_id'] is None
        assert not (await b._create_pending_booking(**selection()))[0]
    asyncio.run(run())


def test_api_rejects_foreign_cancellation_and_non_super_admin(store, monkeypatch):
    from fastapi.testclient import TestClient
    from webapp.api import app, current_user
    from webapp.auth import TelegramWebAppUser
    bid = asyncio.run(b._create_pending_booking(**selection()))[1]
    app.dependency_overrides[current_user] = lambda: TelegramWebAppUser(20, None, None, None, True, False)
    try:
        client = TestClient(app)
        assert client.post(f'/api/bookings/{bid}/cancel').status_code == 404
        assert client.get('/api/admin/bookings').status_code == 403
        assert client.get('/api/bookings').json()['bookings'] == []
    finally:
        app.dependency_overrides.clear()


def test_uncertain_remote_creation_requires_reconciliation(store, monkeypatch):
    async def run():
        _, bid, _ = await b._create_pending_booking(**selection())
        monkeypatch.setattr(b, '_remote_conflicts', AsyncMock(return_value=([], None)))
        monkeypatch.setattr(b, '_create_yclients_record', AsyncMock(return_value=(None, 'timeout')))
        ok, _ = await b.approve_booking(bid, 99)
        assert not ok
        assert (await b._fetch_booking(bid))['status'] == 'reconciliation_required'
        assert not await b._claim_for_admin(bid, 99)
    asyncio.run(run())


def test_attendance_confirmation_cannot_resurrect_cancelled_booking(store):
    async def run():
        _, bid, _ = await b._create_pending_booking(**selection())
        await b._set_booking_status(bid, 'confirmed')
        assert await b.confirm_attendance(bid, 10)
        await b._set_booking_status(bid, 'cancelling')
        assert not await b.confirm_attendance(bid, 10)
        assert (await b._fetch_booking(bid))['status'] == 'cancelling'
        await b._set_booking_status(bid, 'cancelled')
        assert not await b.confirm_attendance(bid, 10)
    asyncio.run(run())


def test_identical_retry_recovers_booking_after_start_time(store, monkeypatch):
    async def run():
        args=selection()
        first=await b._create_pending_booking(**args,source='miniapp',idempotency_key='late-retry')
        class Later(datetime):
            @classmethod
            def now(cls,tz=None):
                return args['start_at']+timedelta(days=1)
        monkeypatch.setattr(b,'datetime',Later)
        retry=await b._create_pending_booking(**args,source='miniapp',idempotency_key='late-retry')
        assert first[0] and retry[0] and first[1]==retry[1]
    asyncio.run(run())

import asyncio
from unittest.mock import AsyncMock

import pytest
from database import db as database
from services import roulette_requests as requests


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(database, 'DB_NAME', str(tmp_path / 'roulette.db'))


def test_replay_returns_result_without_second_charge(store):
    async def run():
        operation = AsyncMock(return_value={'code': 'rating_10', 'value': 10})
        first = await requests.run_spin(1, 'request-one', operation)
        second = await requests.run_spin(1, 'request-one', operation)
        assert first == second
        assert operation.await_count == 1
    asyncio.run(run())


def test_other_process_cannot_start_second_spin(store):
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        async def operation():
            entered.set()
            await release.wait()
            return {'code': 'rating_10'}
        task = asyncio.create_task(requests.run_spin(1, 'first', operation))
        await entered.wait()
        try:
            with pytest.raises(requests.RequestPending):
                await requests.run_spin(1, 'second', AsyncMock())
        finally:
            release.set()
            await task
    asyncio.run(run())


def test_uncertain_charge_stays_blocked_across_retries(store):
    async def run():
        operation = AsyncMock(side_effect=TimeoutError())
        with pytest.raises(TimeoutError):
            await requests.run_spin(1, 'first', operation)
        for key in ['first', 'new-key']:
            with pytest.raises(requests.RequestPending):
                await requests.run_spin(1, key, operation)
        assert operation.await_count == 1
    asyncio.run(run())


def test_rejection_before_charge_does_not_block_next_spin(store):
    async def run():
        with pytest.raises(requests.RequestRejected):
            await requests.run_spin(1, 'first', AsyncMock(side_effect=requests.RequestRejected('Баланс')))
        result = await requests.run_spin(1, 'second', AsyncMock(return_value={'code': 'rating_10'}))
        assert result['code'] == 'rating_10'
    asyncio.run(run())


def test_selected_prize_survives_uncertain_external_outcome(store):
    async def run():
        async def operation():
            await requests.record_selection(1,'first',{'code':'rating_50','value':50})
            raise TimeoutError()
        with pytest.raises(TimeoutError):
            await requests.run_spin(1,'first',operation)
        db=await database.get_db()
        try:
            cursor=await db.execute('SELECT status,result FROM roulette_requests')
            status,result=await cursor.fetchone()
            assert status=='review'
            assert 'rating_50' in result
        finally:
            await db.close()
    asyncio.run(run())

import asyncio
from unittest.mock import AsyncMock
from services import yclients_service as ys


def test_post_is_not_retried_after_uncertain_server_error(monkeypatch):
    class Response:
        status = 503
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def text(self): return 'unavailable'
        async def json(self, **kwargs): return {'success': False}
    class Session:
        calls = 0
        def request(self, *args, **kwargs):
            self.calls += 1
            return Response()
    session = Session()
    monkeypatch.setattr(ys, 'yclients_enabled', lambda: True)
    monkeypatch.setattr(ys.asyncio, 'sleep', AsyncMock())
    result = asyncio.run(ys._request('POST', 'https://example.invalid', session=session))
    assert session.calls == 1
    assert result['success'] is False

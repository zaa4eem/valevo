import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from webapp import auth


def signed(user, **extra):
    data = {'auth_date': str(int(time.time())), 'user': json.dumps(user), **extra}
    secret = hmac.new(b'WebAppData', b'123:test', hashlib.sha256).digest()
    data['hash'] = hmac.new(secret, '\n'.join(f'{k}={v}' for k,v in sorted(data.items())).encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


def test_signature_and_roles_come_only_from_server(monkeypatch):
    monkeypatch.setattr(auth, 'BOT_TOKEN', '123:test')
    monkeypatch.setattr(auth, 'ADMIN_IDS', [2])
    monkeypatch.setattr(auth, 'SUPER_ADMIN_IDS', [3])
    assert not auth.authenticate(signed({'id':1,'is_admin':True})).is_admin
    assert auth.authenticate(signed({'id':2})).is_admin
    assert auth.authenticate(signed({'id':3})).is_admin
    assert auth.authenticate(signed({'id':3})).is_super_admin
    with pytest.raises(auth.InitDataError):
        auth.authenticate(signed({'id':1}) + '&user=' + json.dumps({'id':3}))
    with pytest.raises(auth.InitDataError):
        auth.authenticate(signed({'id':1}, auth_date='1'))


@pytest.mark.parametrize('payload', [[], None, {'id':True}, {'id':-1}, {'id':'3'}])
def test_malformed_signed_user_returns_auth_error(monkeypatch, payload):
    monkeypatch.setattr(auth, 'BOT_TOKEN', '123:test')
    with pytest.raises(auth.InitDataError):
        auth.authenticate(signed(payload))

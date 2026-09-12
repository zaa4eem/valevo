from __future__ import annotations
import hashlib, hmac, json, time
from dataclasses import dataclass
from urllib.parse import parse_qsl
from config import BOT_TOKEN, ADMIN_IDS, SUPER_ADMIN_IDS

MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60
class InitDataError(Exception): pass

@dataclass(frozen=True)
class TelegramWebAppUser:
    id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    is_admin: bool
    is_super_admin: bool

def validate_init_data(init_data: str) -> dict[str,str]:
    if not BOT_TOKEN: raise InitDataError('BOT_TOKEN не настроен на сервере')
    if not init_data: raise InitDataError('initData отсутствует')
    data=dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash=data.pop('hash',None)
    if not received_hash: raise InitDataError('В initData отсутствует hash')
    secret=hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
    check='\n'.join(f'{k}={v}' for k,v in sorted(data.items()))
    computed=hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, received_hash): raise InitDataError('Неверная подпись initData')
    try: age=time.time()-int(data.get('auth_date','0'))
    except ValueError: age=MAX_INIT_DATA_AGE_SECONDS+1
    if age > MAX_INIT_DATA_AGE_SECONDS or age < -60: raise InitDataError('initData устарела — переоткройте приложение')
    return data

def authenticate(init_data: str) -> TelegramWebAppUser:
    fields=validate_init_data(init_data)
    try: payload=json.loads(fields['user']); uid=int(payload['id'])
    except Exception as exc: raise InitDataError('Некорректные данные пользователя') from exc
    return TelegramWebAppUser(uid,payload.get('username'),payload.get('first_name'),payload.get('last_name'),uid in ADMIN_IDS or uid in SUPER_ADMIN_IDS,uid in SUPER_ADMIN_IDS)

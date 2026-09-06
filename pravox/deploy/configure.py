"""Run interactively on the target server. Creates a private .env once."""
import argparse
import getpass
import os
from pathlib import Path
import re

parser=argparse.ArgumentParser()
parser.add_argument('--local',action='store_true',help='Local Qwen test without an API key')
args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
target=root/'infra'/'.env'
if target.exists():raise SystemExit('.env already exists. Edit it directly; it has not been overwritten.')
print('правоХ: настройки сервера. Секреты при вводе не отображаются.')
domain='zaa4eem.ru'
public_url=input('Адрес Mini App [https://zaa4eem.ru/pravoXru]: ').strip().rstrip('/') or 'https://zaa4eem.ru/pravoXru'
from urllib.parse import urlparse
parsed=urlparse(public_url)
domain=parsed.hostname or ''
if parsed.scheme!='https' or parsed.query or parsed.fragment or not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)*',parsed.path):raise SystemExit('Нужен HTTPS-адрес с корректным путём.')
if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}',domain):raise SystemExit('Укажите корректное DNS-имя домена.')
token=getpass.getpass('Токен Telegram-бота: ').strip()
if args.local:
    key=''
    model='qwen3:4b'
    provider='Qwen3 4B на сервере правоХ (тест без проверки актуальности законов)'
    base='https://api.openai.com/v1'
else:
    key=getpass.getpass('API-ключ ИИ: ').strip()
    model=input('Модель с поддержкой Responses API + web_search: ').strip()
    provider=input('Название ИИ-провайдера для пользователей: ').strip()
    base=input('Responses API base URL [https://api.openai.com/v1]: ').strip() or 'https://api.openai.com/v1'
if not token or not model or (not args.local and not key):raise SystemExit('Нужен токен бота и настройки выбранного ИИ.')
operator=input('Оператор сервиса (ФИО/организация): ').strip()
contact=input('Контакт поддержки: ').strip()
values={'BOT_TOKEN':token,'ADMIN_TELEGRAM_ID':'6021377014','CHANNEL_USERNAME':'@pravoXru','APP_PORT':'8095',
        'PUBLIC_URL':public_url,'DATABASE_PATH':'/data/pravox.sqlite3','AI_BASE_URL':base,
        'AI_API_KEY':key,'AI_MODEL':model,'AI_PROVIDER_NAME':provider,'OPERATOR_NAME':operator,'SUPPORT_CONTACT':contact,
        'AI_BACKEND':'ollama' if args.local else 'responses','OLLAMA_URL':'http://ollama:11434',
        'AI_TIMEOUT':'300' if args.local else '120','WORKER_THREADS':'1' if args.local else '3','HISTORY_DAYS':'90','INPUT_USD_PER_MILLION':'0','OUTPUT_USD_PER_MILLION':'0'}
if any('\n' in v or '\r' in v or '\x00' in v for v in values.values()):raise SystemExit('Недопустимый перевод строки в настройках.')
def quote(value):return "'"+value.replace("'","\\'")+"'"
descriptor=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(descriptor,'w') as file:
    for name,value in values.items():file.write(name+'='+quote(value)+'\n')
print('Настройки сохранены. Запустите bash deploy/start.sh из папки проекта.')

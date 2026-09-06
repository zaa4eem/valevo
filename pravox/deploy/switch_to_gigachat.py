"""Switch an existing правоХ installation to GigaChat without printing secrets."""
import getpass
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
target = root / 'infra' / '.env'
if not target.exists():
    raise SystemExit('Сначала создайте infra/.env через configure.py.')
key = getpass.getpass('GigaChat Authorization Key: ').strip()
if not key or any(char in key for char in '\r\n\x00'):
    raise SystemExit('Нужен непустой ключ без перевода строки.')
scope = input('Scope [GIGACHAT_API_PERS]: ').strip() or 'GIGACHAT_API_PERS'
if scope not in ('GIGACHAT_API_PERS', 'GIGACHAT_API_CORP'):
    raise SystemExit('Допустимы GIGACHAT_API_PERS или GIGACHAT_API_CORP.')
model = input('Модель [GigaChat]: ').strip() or 'GigaChat'
if any(char in model for char in '\r\n\x00'):
    raise SystemExit('Некорректное имя модели.')
updates = {
    'AI_BACKEND': 'gigachat', 'AI_MODEL': model, 'AI_PROVIDER_NAME': 'GigaChat',
    'AI_API_KEY': '', 'AI_BASE_URL': 'https://api.giga.chat/v1', 'AI_TIMEOUT': '120',
    'WORKER_THREADS': '2', 'GIGACHAT_AUTH_KEY': key, 'GIGACHAT_SCOPE': scope,
}
def quote(value):
    return "'" + value.replace("'", "'\\''") + "'"
lines = target.read_text().splitlines()
seen = set()
for index, line in enumerate(lines):
    name = line.partition('=')[0]
    if name in updates:
        lines[index] = name + '=' + quote(updates[name])
        seen.add(name)
for name, value in updates.items():
    if name not in seen:
        lines.append(name + '=' + quote(value))
backup = target.with_name('.env.before-gigachat')
if backup.exists():
    raise SystemExit('Файл infra/.env.before-gigachat уже существует; проверьте его перед повторной сменой.')
os.replace(str(target), str(backup))
descriptor = os.open(str(target), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(descriptor, 'w') as file:
    file.write('\n'.join(lines) + '\n')
print('GigaChat включён. Предыдущие настройки сохранены в infra/.env.before-gigachat.')

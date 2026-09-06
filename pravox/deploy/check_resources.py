"""Conservative headroom check before starting a model beside an existing site."""
from pathlib import Path
import shutil
import subprocess

if not Path('/proc/meminfo').exists():
    raise SystemExit('Local test installer expects a Linux server.')
info = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
available = int(info['MemAvailable'].split()[0]) * 1024
docker_root = subprocess.check_output(['docker', 'info', '--format', '{{.DockerRootDir}}'], text=True).strip()
free = shutil.disk_usage(docker_root).free
if available < 6 * 1024**3:
    raise SystemExit('Для Qwen3 4B требуется не менее 6 ГиБ доступной памяти с запасом для сайта. Установка остановлена; память сервера не изменена.')
if free < 10 * 1024**3:
    raise SystemExit('Требуется не менее 10 ГиБ свободного места в хранилище Docker.')
print('Ресурсов достаточно для пробного запуска. Скорость CPU ещё предстоит измерить.')

# Запуск VALEVO на сервере через Docker

Способ запуска сохранён как в корневом `Н12/docker-compose.yml` репозитория:

- `valevo-bot`: существующий Dockerfile, `bash scripts/start.sh` → проверка Python-файлов → `python main.py`.
- `valevo-webapp`: существующий Dockerfile.webapp, `python webapp_server.py`.
- Оба читают `.env` и одну базу `/app/data/valevo.db`.
- Папки `data`, `logs`, `backups` примонтированы с сервера.
- Веб-приложение слушает8080 внутри контейнера; снаружи доступно на `127.0.0.1:${WEBAPP_PORT:-8080}`. Существующий HTTPS/nginx направляет запросы на этот порт.

Подтверждённая установка пользователя: Docker Compose project `12`, контейнеры `valevo-bot` и `valevo-webapp`, сервер `zaa4eem-vmpico`, папка `Н12`. Внешний порт `127.0.0.1:8020` → внутренний8080. Сохраните `WEBAPP_PORT=8020` в существующем `.env` и текущую конфигурацию HTTPS-прокси. Бот должен сохранить healthcheck.

## Обновление существующей установки

Выполняйте команды из той же папки проекта и с тем же Compose project name, что использовались для текущих контейнеров. Если раньше использовали `-f` или `-p`, сохраняйте эти параметры. Новый архив содержит содержимое каталога `Н12`, без дополнительной верхней папки.

Сохраните резервную копию через существующую процедуру перед обновлением. Обновите исходники из архива в действующей папке, сохраняя `.env`, `data`, `logs`, `backups`. Не запускайте `docker compose down -v`.

Согласованную копию SQLite можно сделать внутри работающего контейнера перед заменой файлов:

```bash
docker compose exec valevo-bot python -c "import sqlite3; from pathlib import Path; from datetime import datetime; from config import DB_NAME,BACKUP_DIR; target=Path(BACKUP_DIR)/('before_miniapp_'+datetime.now().strftime('%Y%m%d_%H%M%S')+'.db'); target.parent.mkdir(parents=True,exist_ok=True); src=sqlite3.connect(DB_NAME); dst=sqlite3.connect(target); src.backup(dst); dst.close(); src.close(); print(target)"
```

Если исходное приложение хранит дополнительные внешние данные, сохраните их по действующей процедуре. Эта команда только копирует SQLite через backup API и не меняет исходную базу.

Для корневого Compose из репозитория:

```bash
docker compose ps
docker compose build valevo-bot valevo-webapp
docker compose up -d valevo-bot valevo-webapp
docker compose ps
docker compose logs --tail=100 valevo-bot valevo-webapp
```

Локальная проверка веб-сервера через сам контейнер:

```bash
docker compose exec valevo-webapp python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=5).read().decode())"
```

Ответ должен быть `{"ok":true}`. Это проверка доступности процесса; дополнительно откройте Mini App из Telegram и проверьте профиль, доступность мест и роли. Реальная бронь для приёмки должна быть согласована с владельцем клуба.

`WEBAPP_URL` в существующем `.env` — публичный HTTPS-адрес приложения. Если URL уже задан и nginx настроен, менять их не требуется. Если URL отсутствует, задайте его и настройте HTTPS: Docker сам не создаёт домен и сертификат.

Текущий upstream также содержит альтернативный файл `docker/docker-compose.yml`. Он не заменяет корневой Compose автоматически. Сначала проверьте фактически используемый файл: там могут быть другие healthcheck и точки входа. Эта сборка сохраняет корневую схему, использованную исходным `Н12`; для другого файла нужно проверить вывод `docker compose ps` и параметры запуска на вашем сервере.

## Остановка и повторный запуск

```bash
docker compose stop valevo-bot valevo-webapp
docker compose start valevo-bot valevo-webapp
```

Изменения базы добавляются при старте и не удаляют существующих пилотов. Статистика считает стоимость подтверждённых броней по сохранённому тарифу и расчётные10%, исключая отменённые. Платёжных операций нет.

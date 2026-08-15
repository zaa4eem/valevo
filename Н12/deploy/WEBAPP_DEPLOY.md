# Деплой Mini App веб-сервиса (valivo.online)

Веб-сервис `webapp_server.py` (`webapp.api:app`, FastAPI) — бэкенд Telegram
Mini App и раздача статики фронтенда (`webapp/static/`). Отдельный процесс
от бота (`main.py`), но:

- читает тот же `.env`/`config.py` (тот же `BOT_TOKEN`, `ADMIN_IDS`,
  `DB_NAME` и т.д.) — отдельного конфига нет;
- читает/пишет тот же файл `valevo.db`, что и бот (WAL-режим SQLite это
  поддерживает — но **оба процесса обязаны работать на одном хосте и
  видеть один и тот же путь к файлу базы**; разнести бота и вебапп по
  разным машинам в текущем виде нельзя, sqlite для этого не годится);
- слушает порт **8020** (не путать с `tv_board.py` — тот на 8010, отдельный
  несвязанный сервис для TV-табло в клубе, его не трогаем);
- наружу должен быть доступен по **https://valivo.online** — Telegram Mini
  Apps требуют настоящий (не self-signed) сертификат.

Ниже — оба варианта деплоя, как и у самого бота (`docker-compose.yml` и
`deploy/valevo-bot.service` тоже существуют параллельно в этом репозитории).

## Вариант 1 — Docker Compose

Файлы: `Dockerfile.webapp`, сервис `valevo-webapp` в `docker-compose.yml`.

```bash
docker compose build valevo-webapp
docker compose up -d valevo-webapp
docker compose logs -f valevo-webapp
```

`docker-compose.yml` монтирует `./valevo.db` в оба контейнера
(`valevo-bot` и `valevo-webapp`) одним и тем же bind-mount'ом — **не named
volume**, а именно один файл на хосте. Так оба процесса видят один и тот же
`valevo.db`, и WAL-режим честно работает между ними как обычная
многопроцессная запись на одном файле. `./logs` и `./backups` смонтированы
аналогично.

`ports: ["127.0.0.1:8020:8020"]` — контейнер слушает только loopback хоста,
наружу отдаёт nginx (см. ниже), напрямую в интернет порт 8020 не смотрит.

## Вариант 2 — systemd (bare-metal, без Docker)

Файл: `deploy/valevo-webapp.service` (по образцу `deploy/valevo-bot.service`).

```bash
sudo cp deploy/valevo-webapp.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now valevo-webapp
sudo systemctl status valevo-webapp
journalctl -u valevo-webapp -f
```

Работает из того же `/opt/valevo-bot` и того же venv, что и бот, от того же
пользователя (`User=valevo`/`Group=valevo`) — это осознанно, иначе права на
общий `valevo.db` разойдутся. В venv должны быть доступны `fastapi`,
`uvicorn[standard]`, `python-multipart` (см. следующий раздел).

## Что нужно доустановить/дописать самим (не мои файлы)

Я их не трогал (по договорённости их ведут другие инженеры), но без этого
сервис не соберётся/не заведётся:

- **`requirements.txt`** — добавить `fastapi`, `uvicorn[standard]`,
  `python-multipart` (последнее — для загрузки фото результата заезда через
  multipart-форму). Нужно и для Docker-сборки, и для `pip install` в venv
  на bare-metal.
- **`.env.example`** — добавить `WEBAPP_PORT` и `WEBAPP_BASE_URL` (описаны
  ниже), чтобы новые переменные были видны в примере конфига.

## Переменные окружения (.env на сервере)

```
WEBAPP_PORT=8020
WEBAPP_BASE_URL=https://valivo.online
```

- `WEBAPP_PORT` — необязательная, по умолчанию `8020` (тот же дефолт зашит
  в `webapp_server.py`). Нюанс для **systemd-варианта**: этот дефолт
  читается через `os.getenv` в `webapp_server.py` до импорта
  `webapp.api`/`config.py` — то есть до того, как значение из `.env`
  попадёт в окружение процесса. Если понадобится сменить порт на
  bare-metal — меняйте `Environment=WEBAPP_PORT=` прямо в
  `valevo-webapp.service` (там уже прописано), одного `.env` недостаточно.
  В Docker Compose эта тонкость не важна: `env_file: .env` отдаёт
  переменные контейнеру ещё до старта python-процесса.
- `WEBAPP_BASE_URL` — читается обычным `config.py`-пайплайном (как и
  остальные переменные), просто добавьте в `.env`. Нужна боту для сборки
  кнопки запуска Mini App — саму переменную в `main.py`/`config.py`
  подключает другой инженер, здесь только объявление значения.

## nginx + certbot (valivo.online)

Файл: `deploy/nginx-valivo.online.conf` — сервер-блоки на 80 и 443,
проксирует на `127.0.0.1:8020`, стандартные пути сертификата certbot,
TLS 1.2+, `client_max_body_size 15m` (с запасом под фото с телефона).

```bash
sudo cp deploy/nginx-valivo.online.conf /etc/nginx/sites-available/valivo.online.conf
sudo ln -s /etc/nginx/sites-available/valivo.online.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
```

Первый выпуск сертификата — classic chicken-and-egg: nginx не запустится с
HTTPS-блоком, который ссылается на ещё не существующий сертификат. Порядок:

1. Закомментировать блок между `HTTPS BLOCK START`/`END` в конфиге,
   оставить только HTTP (порт 80).
2. `sudo nginx -t && sudo systemctl reload nginx`
3. Получить сертификат webroot-методом (под него уже есть `location` в
   HTTP-блоке конфига):
   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot \
     -d valivo.online -d www.valivo.online \
     --deploy-hook "systemctl reload nginx"
   ```
   (`--deploy-hook` нужен, чтобы автопродление само перезагружало nginx —
   `certonly` сам по себе конфиг nginx не трогает и не релоадит его.
   Альтернатива — просто `certbot --nginx -d valivo.online -d www.valivo.online`:
   certbot сам пропишет сертификат в файл, но может переписать кастомные
   TLS/proxy-настройки из этого конфига, поэтому здесь используется
   `certonly` — конфиг остаётся полностью ручным.)
4. Раскомментировать HTTPS-блок обратно.
5. `sudo nginx -t && sudo systemctl reload nginx`
6. Проверить автопродление: `sudo certbot renew --dry-run`

Не забыть открыть 80/443 во внешнем firewall/security group хостинга
(например `sudo ufw allow 'Nginx Full'`).

## BotFather — прописать Mini App

Код и nginx/certbot не связаны с настройками Telegram — URL мини-приложения
нужно отдельно указать в @BotFather:

1. `@BotFather` → `/mybots` → выбрать бота → **Bot Settings** → **Menu
   Button** (Configure Menu Button) → отправить `https://valivo.online` и
   текст кнопки (например «Открыть»). Самый простой вариант: кнопка рядом
   со строкой ввода сразу открывает Mini App.
2. Либо `/newapp`, если нужно отдельное именованное Mini App (получает
   свою короткую ссылку `t.me/<bot>/<app>`) — тоже указать
   `https://valivo.online` как URL.

## Итого: где что лежит

| Файл | Назначение |
|---|---|
| `Dockerfile.webapp` | образ вебапп-сервиса |
| `docker-compose.yml` (сервис `valevo-webapp`) | Docker-вариант деплоя |
| `deploy/valevo-webapp.service` | systemd-вариант деплоя |
| `deploy/nginx-valivo.online.conf` | reverse proxy + TLS для valivo.online |
| `.env` на сервере | `WEBAPP_PORT`, `WEBAPP_BASE_URL` |

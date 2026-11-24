# VALEVO — Linux deployment

## 1. Подготовка
Установите Docker + Docker Compose plugin и nginx. Скопируйте проект на сервер.

## 2. База
Создайте `data/` и положите текущую рабочую БД как `data/valevo.db`.
Не заменяйте живую БД пустым файлом. При первом старте новая турнирная система сама сделает backup перед миграцией.

## 3. Настройки
`cp .env.example .env` и заполните BOT_TOKEN, ADMIN_IDS, SUPER_ADMIN_IDS, WEBAPP_URL и CRM_PASSWORD.
Обычный ADMIN_IDS имеет только «Установить время». SUPER_ADMIN_IDS имеет полный административный доступ.
Расписание клуба хранится в `data/valevo.db`. Внешний календарь для новых броней не используется.
Гостевая запись без регистрации: `https://valevo.club/book`. CRM для персонала: `https://valevo.club/crm`.
Миниапп открывается и в браузере, и в Telegram. Борд (`tv_board.py`) не меняется.

## 4. Запуск
```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f --tail=100
```

## 5. HTTPS / Mini App
Telegram WebApp требует HTTPS. Настройте nginx по `deploy/nginx-valevo.conf.example`, SSL через certbot, затем задайте тот же URL в `WEBAPP_URL`.

## 6. Обновление
Перед каждым обновлением сохраните `data/valevo.db`, `.env` и `backups/`. Код можно заменить, живую базу — нет.
После обновления задайте `CRM_PASSWORD`, перезапустите `valevo-bot` и `valevo-webapp`. Проверьте `/book`, `/crm` и борд.

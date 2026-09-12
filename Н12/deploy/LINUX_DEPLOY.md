# VALEVO — Linux deployment

## 1. Подготовка
Установите Docker + Docker Compose plugin и nginx. Скопируйте проект на сервер.

## 2. База
Создайте `data/` и положите текущую рабочую БД как `data/valevo.db`.
Не заменяйте живую БД пустым файлом. При первом старте новая турнирная система сама сделает backup перед миграцией.

## 3. Настройки
`cp .env.example .env` и заполните BOT_TOKEN, ADMIN_IDS, SUPER_ADMIN_IDS, YCLIENTS_* и публичный HTTPS WEBAPP_URL.
Обычный ADMIN_IDS имеет только «Установить время». SUPER_ADMIN_IDS имеет полный административный доступ.

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
Перед каждым обновлением сохраните `data/valevo.db`, `.env` и `backups/`. Код можно заменить, данные — нет.

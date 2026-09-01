# Деплой на HOSTKEY VPS (AlmaLinux 8 + Portainer)

Конкретный план под этот сервер: HOSTKEY `vm.pico` (1 vCPU / 1 GB RAM /
40 GB SSD, Нидерланды), AlmaLinux 8, Portainer уже установлен, вход по
SSH-ключу (`ssh root@IP`, пароля нет).

Reverse proxy и SSL — через Docker (`nginx-proxy` + `acme-companion`), не
через системный nginx: на AlmaLinux/RHEL другая раскладка конфигов, чем в
Ubuntu-инструкции `deploy/WEBAPP_DEPLOY.md` (там `sites-available/
sites-enabled` — на AlmaLinux этого нет). Плюс на сервере планируется
несколько ботов — общий прокси-контейнер избавляет от ручного nginx.conf
под каждого нового бота: подключил контейнер к сети `proxy`, выставил два
env var — и он сам появляется на своём домене с сертификатом.

## 0. Прежде чем начинать — RAM-бюджет

1 GB RAM на весь сервер — тариф тесный, особенно с несколькими ботами.
Ориентировочно:

| Что | ~RAM |
|---|---|
| AlmaLinux 8 + systemd (простой) | 150–250 МБ |
| Docker daemon | 100–150 МБ |
| Portainer | ~100 МБ |
| nginx-proxy + acme-companion | ~40–60 МБ вместе |
| valevo-bot (aiogram polling) | 60–100 МБ |
| valevo-webapp (FastAPI/uvicorn) | 80–120 МБ |

Итого под один этот проект — реалистично 550–780 МБ уже занято. Свободного
запаса под ещё одного полноценного Python-бота уже немного, под
третьего-четвёртого — скорее всего не хватит без апгрейда тарифа.

**Обязательно добавить swap** — без него любой скачок (например
одновременная пересборка образов + пиковая нагрузка) валит процессы по
OOM без предупреждения:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h   # проверить, что swap виден
```

40 ГБ SSD место позволяет — 2 ГБ swap не нагрузка на диск. Это не решает
нехватку RAM для производительности, но не даёт серверу падать намертво.

## 1. Как только будет IP — проверка доступа

```bash
ssh root@IP_СЕРВЕРА
docker --version
docker compose version   # или docker-compose --version — Portainer требует один из них
```

Если `ssh` спрашивает пароль вместо ключа — значит публичный ключ не
попал на сервер при заказе, тогда пишите, разберём отдельно (не пытайтесь
`ssh-copy-id` с паролем, если пароль вообще не выдавали).

## 2. DNS

Направить `valivo.online` (A-запись) на IP этого сервера — в панели
reg.ru, там же, где сейчас `ns1.hosting.reg.ru` для старого shared-хостинга.
**Именно эту A-запись, не NS** — домен полностью переносить не нужно,
меняется только IP, на который смотрит `valivo.online`. Подождите
распространения DNS (обычно от нескольких минут до часа) перед шагом 5 —
`acme-companion` не выпустит сертификат, если домен ещё не резолвится на
сервер.

## 3. Сеть `proxy` и общий reverse-proxy стек

Сеть создаётся один раз, до любых стеков:

```bash
docker network create proxy
```

Дальше в Portainer (**Stacks → Add stack**):

- Name: `proxy`
- Web editor → вставить содержимое `deploy/docker-compose.proxy.yml`
- Deploy the stack

Это разворачивает `nginx-proxy` (слушает 80/443 на хосте) и
`acme-companion` (сам заказывает и продлевает Let's Encrypt-сертификаты
для любого контейнера в сети `proxy` с выставленными `VIRTUAL_HOST`/
`LETSENCRYPT_HOST`). Больше руками ничего с сертификатами делать не
придётся — ни для этого бота, ни для следующих.

## 4. Код на сервер

Самый простой вариант — склонировать репозиторий прямо на сервер (Portainer
тогда просто строит образы из уже лежащих на диске файлов, без выдачи ему
доступа к GitHub):

```bash
cd /opt
git clone --branch claude/miniapp-v2 https://github.com/zaa4eem/valevo.git valevo
cd valevo/Н12
cp .env.example .env
nano .env   # заполнить BOT_TOKEN, ADMIN_IDS, WEBAPP_DOMAIN=valivo.online,
            # LETSENCRYPT_EMAIL=ваш@email, YCLIENTS_*, остальное по месту
```

`valevo.db` на новом сервере ещё нет — `init_db()` в `main.py` создаёт файл
и схему сам при первом запуске бота, если это чистый сервер. **Если
переносите существующую базу с клубного ПК** — скопируйте её (`scp`) в
`/opt/valevo/Н12/valevo.db` до первого запуска стека, иначе разойдётся с
живыми данными в клубе.

## 5. Стек бота

В Portainer (**Stacks → Add stack**):

- Name: `valevo`
- Build method: **Repository** нельзя (пришлось бы отдавать Portainer
  доступ к GitHub) — используйте **Upload** или **Web editor**, указав
  путь `/opt/valevo/Н12/docker-compose.yml` как working directory
  (проще всего: Web editor → вставить содержимое файла, Portainer сам
  использует текущую директорию проекта, если стек создан из
  примонтированной папки — либо через `docker compose up -d` руками из
  `/opt/valevo/Н12`, а в Portainer потом просто смотреть на уже
  запущенный стек через "Stacks → Import").
- Environment variables: подтянутся из `.env` в той же папке
  (`env_file: .env` уже прописан в compose).
- Deploy the stack

Практичнее всего на первый раз поднять этот стек прямо командой на
сервере (SSH), а Portainer использовать для последующего наблюдения и
рестартов:

```bash
cd /opt/valevo/Н12
docker compose up -d --build
docker compose ps
docker compose logs -f valevo-bot
```

Стек появится в Portainer автоматически (Portainer видит все
docker-compose-стеки на хосте, даже поднятые из терминала).

## 6. Проверка

```bash
curl -I https://valivo.online          # должен вернуть 200, с валидным сертификатом
docker compose logs valevo-webapp | tail -30
docker compose logs valevo-bot | tail -30
```

В Telegram: `@BotFather → /mybots → [бот] → Bot Settings → Menu Button` —
указать `https://valivo.online`, если ещё не настроено (или это сделает
сам бот при старте — см. `main.py:_configure_menu_button`, он это
проверяет на каждом запуске и логирует результат).

## 7. Добавление следующего бота на этот же сервер

Ради чего вообще этот прокси-стек: у нового бота свой docker-compose.yml,
подключённый к той же внешней сети `proxy`, со своими
`VIRTUAL_HOST`/`LETSENCRYPT_HOST` (свой домен или поддомен) — ничего в
`nginx-proxy`/`acme-companion` руками менять не нужно, он подхватит новый
контейнер сам. Но см. раздел 0 — на `vm.pico` считайте RAM заранее, не
разворачивайте вслепую.

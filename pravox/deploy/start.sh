#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! command -v docker >/dev/null 2>&1; then
  echo "Install Docker Engine and Docker Compose on this server first. See README.md."
  exit 1
fi
docker compose version >/dev/null
if [[ ! -f infra/.env ]]; then
  echo "Сначала: python3 deploy/configure.py --local"
  exit 1
fi
chmod 600 infra/.env
compose=(docker compose -f infra/docker-compose.yml --env-file infra/.env)
"${compose[@]}" config --quiet
"${compose[@]}" build web
"${compose[@]}" run --rm --no-deps web python manage.py check
backend=$("${compose[@]}" run --rm --no-deps web python -c 'from app.config import Config; print(Config.from_env().ai_backend)')
if [[ "$backend" == "ollama" ]]; then
  python3 deploy/check_resources.py
  "${compose[@]}" up -d --wait --wait-timeout 60 ollama
  "${compose[@]}" exec -T ollama ollama pull qwen3:4b
fi
"${compose[@]}" run --rm --no-deps web python manage.py smoke-ai
"${compose[@]}" up -d web worker
"${compose[@]}" run --rm --no-deps web python manage.py configure-telegram
"${compose[@]}" up -d bot
"${compose[@]}" ps
echo "правоХ запущен. Чат доступен в Telegram. Для Mini App подключите /pravoXru/ к существующему HTTPS-сайту (README.md)."

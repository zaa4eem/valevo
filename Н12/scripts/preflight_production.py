#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from pathlib import Path

PLACEHOLDERS = {"", "CHANGE_ME", "CHANGE_ME_TELEGRAM_BOT_TOKEN", "CHANGE_ME_TELEGRAM_ID"}
REQUIRED_RUNTIME = (
    "BOT_TOKEN",
    "SUPER_ADMIN_IDS",
    "WEBAPP_URL",
    "YCLIENTS_COMPANY_ID",
    "YCLIENTS_PARTNER_TOKEN",
    "YCLIENTS_USER_TOKEN",
)


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def looks_placeholder(value: str) -> bool:
    upper = (value or "").strip().upper()
    return not upper or upper in PLACEHOLDERS or upper.startswith("CHANGE_ME")


def fail(errors: list[str], text: str) -> None:
    errors.append(text)
    print(f"FAIL: {text}")


def ok(text: str) -> None:
    print(f" OK : {text}")


def main() -> int:
    parser = argparse.ArgumentParser(description="VALEVO Н12 production preflight")
    parser.add_argument("--static-only", action="store_true", help="only validate files shipped by the patch")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    errors: list[str] = []

    required_files = [
        root / "main.py",
        root / "config.py",
        root / "handlers" / "booking.py",
        root / "services" / "booking_finance.py",
        root / "webapp" / "api.py",
        root / "webapp" / "static" / "index.html",
        root / "webapp" / "static" / "js" / "app.js",
        root / "webapp" / "static" / "css" / "app.css",
        root / "Dockerfile",
        root / "Dockerfile.webapp",
        root / "docker-compose.yml",
        root / "requirements.txt",
    ]
    missing = [str(p.relative_to(root)) for p in required_files if not p.exists()]
    if missing:
        fail(errors, "missing required files: " + ", ".join(missing))
    else:
        ok("required bot/Mini App/deploy files exist")

    example = root / ".env.example"
    if not example.exists():
        fail(errors, ".env.example is missing")
    else:
        text = example.read_text(encoding="utf-8", errors="replace")
        # Catch common leaked Telegram tokens and long token-looking YCLIENTS values.
        if re.search(r"\b\d{8,12}:[A-Za-z0-9_-]{25,}\b", text):
            fail(errors, ".env.example appears to contain a real Telegram token")
        else:
            ok(".env.example contains no Telegram-token pattern")
        if "BOOKING_COMMISSION_PERCENT=0" not in text:
            fail(errors, ".env.example must default commission to 0 until configured")
        else:
            ok("finance defaults are conservative")

    if args.static_only:
        if errors:
            print(f"\nPRECHECK FAILED: {len(errors)} issue(s)")
            return 1
        print("\nSTATIC PRECHECK OK")
        return 0

    env_path = root / ".env"
    env = load_env(env_path)
    if not env:
        fail(errors, ".env is missing or empty")
    else:
        ok(".env found")

    for key in REQUIRED_RUNTIME:
        value = env.get(key, os.getenv(key, ""))
        if looks_placeholder(value):
            fail(errors, f"{key} is not configured")
        else:
            ok(f"{key} configured")

    bot_token = env.get("BOT_TOKEN", "")
    if bot_token and not looks_placeholder(bot_token):
        if ":" not in bot_token or len(bot_token) < 30:
            fail(errors, "BOT_TOKEN format looks invalid")
        else:
            ok("BOT_TOKEN format looks plausible (value not printed)")

    super_admin_ids = env.get("SUPER_ADMIN_IDS", "")
    if super_admin_ids and not looks_placeholder(super_admin_ids):
        bad = [x for x in super_admin_ids.split(",") if x.strip() and not x.strip().isdigit()]
        if bad:
            fail(errors, "SUPER_ADMIN_IDS contains non-numeric values")
        else:
            ok("SUPER_ADMIN_IDS format valid")

    webapp_url = env.get("WEBAPP_URL", "")
    if webapp_url and not looks_placeholder(webapp_url):
        if not webapp_url.startswith("https://"):
            fail(errors, "WEBAPP_URL must use HTTPS for Telegram Mini App")
        else:
            ok("WEBAPP_URL uses HTTPS")

    try:
        commission = float(env.get("BOOKING_COMMISSION_PERCENT", "0").replace(",", "."))
        if not 0 <= commission <= 100:
            raise ValueError
        ok(f"commission configured in valid range ({commission:g}%)")
    except ValueError:
        fail(errors, "BOOKING_COMMISSION_PERCENT must be a number from 0 to 100")

    for key in ("BOOKING_STATIC_RUB_PER_HOUR", "BOOKING_MOTION_RUB_PER_HOUR"):
        try:
            value = float(env.get(key, "0").replace(",", "."))
            if value <= 0:
                raise ValueError
            ok(f"{key} is positive")
        except ValueError:
            fail(errors, f"{key} must be > 0")

    db_raw = env.get("DB_NAME", "") or str(root / "data" / "valevo.db")
    db_path = Path(db_raw)
    if not db_path.is_absolute():
        db_path = (root / db_path).resolve()
    if db_path.exists():
        try:
            connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
            try:
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            finally:
                connection.close()
            if str(integrity).lower() != "ok":
                fail(errors, f"database integrity_check returned: {integrity}")
            else:
                ok("database integrity_check = ok")
        except Exception as exc:
            fail(errors, f"cannot open/check database: {type(exc).__name__}")
    else:
        parent = db_path.parent
        if not parent.exists():
            try:
                parent.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
        if not parent.exists() or not os.access(parent, os.W_OK):
            fail(errors, f"database directory is not writable: {parent}")
        else:
            ok("database does not exist yet; destination directory is writable")

    if errors:
        print(f"\nPRODUCTION PREFLIGHT FAILED: {len(errors)} issue(s)")
        return 1
    print("\nPRODUCTION PREFLIGHT OK")
    print("Next: docker compose build --pull && docker compose up -d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

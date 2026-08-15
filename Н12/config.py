import os
import sys
from pathlib import Path


def get_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent

        if exe_dir.name.lower() == "dist":
            return exe_dir.parent

        return exe_dir

    return Path(__file__).resolve().parent


BASE_DIR = get_base_dir()


def _load_env_file() -> None:
    """
    Ищем .env в нескольких местах:
    1. Корень проекта
    2. Текущая рабочая папка
    3. Папка рядом с exe
    """
    possible_paths = [
        BASE_DIR / ".env",
        Path.cwd() / ".env",
    ]

    if getattr(sys, "frozen", False):
        possible_paths.append(Path(sys.executable).resolve().parent / ".env")

    env_path = None

    for path in possible_paths:
        if path.exists():
            env_path = path
            break

    if env_path is None:
        print("[CONFIG] .env not found. Checked:")
        for path in possible_paths:
            print(f" - {path}")
        return

    print(f"[CONFIG] Loading .env from: {env_path}")

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)

        os.environ[key.strip()] = value.strip().strip('"').strip("'")


_load_env_file()

DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR))).resolve()
LOG_DIR = Path(os.getenv("LOG_DIR", str(BASE_DIR / "logs"))).resolve()
BACKUP_DIR = Path(os.getenv("BACKUP_DIR", str(BASE_DIR / "backups"))).resolve()

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

DB_NAME = os.getenv("DB_NAME", str(DATA_DIR / "valevo.db"))
LOG_FILE = os.getenv("LOG_FILE", str(LOG_DIR / "bot.log"))


def _int_list(value: str) -> list[int]:
    result = []
    for item in (value or "").split(","):
        item = item.strip()
        if not item:
            continue
        try:
            result.append(int(item))
        except ValueError:
            pass
    return result


def _int_env(name: str, default: int = 0) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float = 0.0) -> float:
    try:
        return float(str(os.getenv(name, default)).replace(",", "."))
    except (TypeError, ValueError):
        return default


BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_IDS = _int_list(os.getenv("ADMIN_IDS", ""))
SUPPORT_CHAT_ID = _int_env("SUPPORT_CHAT_ID", ADMIN_IDS[0] if ADMIN_IDS else 0)
GROUP_ID = _int_env("GROUP_ID", 0)
MENU_VERSION = _int_env("MENU_VERSION", 3)

YCLIENTS_COMPANY_ID = os.getenv("YCLIENTS_COMPANY_ID", "").strip()
YCLIENTS_PARTNER_TOKEN = os.getenv("YCLIENTS_PARTNER_TOKEN", "").strip()
YCLIENTS_USER_TOKEN = os.getenv("YCLIENTS_USER_TOKEN", "").strip()
YCLIENTS_LOYALTY_CARD_TYPE_ID = os.getenv("YCLIENTS_LOYALTY_CARD_TYPE_ID", "").strip()
YCLIENTS_BONUS_RUB_PER_HOUR = _float_env("YCLIENTS_BONUS_RUB_PER_HOUR", 100.0)
YCLIENTS_ISSUE_CASHBACK = os.getenv("YCLIENTS_ISSUE_CASHBACK", "1").strip().lower() not in {"0", "false", "no", "off"}
YCLIENTS_AUTO_SYNC = os.getenv("YCLIENTS_AUTO_SYNC", "1").strip().lower() not in {"0", "false", "no", "off"}
YCLIENTS_AUTO_CREATE_LOYALTY_CARDS = os.getenv("YCLIENTS_AUTO_CREATE_LOYALTY_CARDS", "1").strip().lower() not in {"0", "false", "no", "off"}
YCLIENTS_SYNC_ON_STARTUP = os.getenv("YCLIENTS_SYNC_ON_STARTUP", "1").strip().lower() not in {"0", "false", "no", "off"}
YCLIENTS_SYNC_INTERVAL_MINUTES = _int_env("YCLIENTS_SYNC_INTERVAL_MINUTES", 360)
YCLIENTS_CARD_RETRY_INTERVAL_MINUTES = _int_env("YCLIENTS_CARD_RETRY_INTERVAL_MINUTES", 360)
SEASON_BONUS_EXPIRE_DAYS = _int_env("SEASON_BONUS_EXPIRE_DAYS", 30)
REFERRAL_BONUS_RUB = _float_env("REFERRAL_BONUS_RUB", 250.0)

MOSCOW_TZ = os.getenv("MOSCOW_TZ", "Europe/Moscow")
ENVIRONMENT = os.getenv("ENVIRONMENT", "production")

# Telegram Mini App (webapp/). Должен быть настоящий https-адрес — Telegram
# не откроет мини-приложение по http:// или самоподписанному сертификату.
WEBAPP_BASE_URL = os.getenv("WEBAPP_BASE_URL", "").strip().rstrip("/")
WEBAPP_PORT = _int_env("WEBAPP_PORT", 8020)


def validate_required_settings() -> None:
    missing = []
    if not BOT_TOKEN:
        missing.append("BOT_TOKEN")
    if not ADMIN_IDS:
        missing.append("ADMIN_IDS")
    if missing:
        raise RuntimeError("Не заполнены обязательные настройки: " + ", ".join(missing))

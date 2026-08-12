#!/usr/bin/env python3
"""
Безопасная тестовая выдача бонусных часов пилоту в локальной БД бота.

По умолчанию работает в dry-run и ничего не меняет.
Пример:
  python scripts/test_issue_bonus_hours.py --telegram-id 123456 --hours 1
  python scripts/test_issue_bonus_hours.py --telegram-id 123456 --hours 1 --apply
"""
import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import DB_NAME  # noqa: E402


def format_minutes(total_minutes: int) -> str:
    if total_minutes <= 0:
        return "0 минут"
    h = total_minutes // 60
    m = total_minutes % 60
    parts = []
    if h:
        parts.append(f"{h} ч.")
    if m:
        parts.append(f"{m} мин.")
    return " ".join(parts)


def get_pilot_by_filters(telegram_id: int | None, phone: str | None, username: str | None):
    with sqlite3.connect(DB_NAME) as db:
        if telegram_id:
            cursor = db.execute(
                "SELECT telegram_id, username, phone, bonus_mobile_minutes, bonus_static_minutes FROM pilots WHERE telegram_id = ?",
                (telegram_id,),
            )
        elif phone:
            cursor = db.execute(
                "SELECT telegram_id, username, phone, bonus_mobile_minutes, bonus_static_minutes FROM pilots WHERE phone = ?",
                (phone,),
            )
        elif username:
            username = username.lstrip("@")
            cursor = db.execute(
                "SELECT telegram_id, username, phone, bonus_mobile_minutes, bonus_static_minutes FROM pilots WHERE username = ?",
                (username,),
            )
        else:
            raise SystemExit("Укажите --telegram-id, --phone или --username")
        return cursor.fetchone()


def add_bonus_minutes(telegram_id: int, platform: str, minutes_delta: int) -> None:
    field = "bonus_mobile_minutes" if platform == "mobile" else "bonus_static_minutes"
    with sqlite3.connect(DB_NAME) as db:
        db.execute(f"UPDATE pilots SET {field} = COALESCE({field}, 0) + ? WHERE telegram_id = ?", (minutes_delta, telegram_id))
        db.commit()


def main():
    parser = argparse.ArgumentParser(description="Тестовая выдача бонусных часов в БД бота")
    parser.add_argument("--telegram-id", type=int)
    parser.add_argument("--phone")
    parser.add_argument("--username")
    parser.add_argument("--hours", type=float, required=True)
    parser.add_argument("--platform", choices=("mobile", "static"), default="mobile")
    parser.add_argument("--apply", action="store_true", help="реально записать изменение в БД")
    args = parser.parse_args()

    if args.hours <= 0:
        raise SystemExit("--hours должен быть больше 0")

    pilot = get_pilot_by_filters(args.telegram_id, args.phone, args.username)
    if not pilot:
        raise SystemExit("Пилот не найден")

    tid, username, phone, mobile, static = pilot
    before = mobile if args.platform == "mobile" else static
    delta_minutes = int(round(args.hours * 60))
    after = before + delta_minutes

    print(f"Пилот: @{username} / {phone} / telegram_id={tid}")
    print(f"Платформа: {'подвижная' if args.platform == 'mobile' else 'статичная'}")
    print(f"Сейчас: {before} мин. ({format_minutes(before)})")
    print(f"Начисление: +{delta_minutes} мин. ({format_minutes(delta_minutes)})")
    print(f"Будет: {after} мин. ({format_minutes(after)})")

    if not args.apply:
        print("DRY-RUN: БД не изменена. Для реальной тестовой выдачи добавьте --apply")
        return

    add_bonus_minutes(tid, args.platform, delta_minutes)
    print("OK: тестовая выдача записана в БД")


if __name__ == "__main__":
    main()

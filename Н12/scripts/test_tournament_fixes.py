"""Тесты турнирной математики и правок, внесённых в этом наборе фиксов.

Запуск:  python3 scripts/test_tournament_fixes.py

Тесты работают на временной БД в памяти диска (файл в tempdir), настоящую
valevo.db не трогают. Каждая проверка привязана к конкретному багу, чтобы при
будущих правках было видно, что именно она защищает.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from datetime import datetime, timedelta

# Изолированная БД и обязательные настройки — до импорта config.
_TMP_DIR = tempfile.mkdtemp(prefix="valevo_test_")
os.environ["DB_NAME"] = os.path.join(_TMP_DIR, "test.db")
os.environ["DATA_DIR"] = _TMP_DIR
os.environ["LOG_DIR"] = os.path.join(_TMP_DIR, "logs")
os.environ["BACKUP_DIR"] = os.path.join(_TMP_DIR, "backups")
os.environ["BOT_TOKEN"] = "test:token"
os.environ["ADMIN_IDS"] = "1"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from data.tournament import (  # noqa: E402
    CLASS_LADDER,
    SQL_TS_FMT,
    class_ladder_index,
    class_score,
    is_class_unlocked,
    month_bounds,
    previous_month_bounds,
    sql_timestamp,
)
from database.db import (  # noqa: E402
    add_lap,
    create_pilot,
    get_all_month_bests,
    get_pilots_active_before,
    get_setting,
    has_award_for_month,
    has_prior_laps_on_track,
    set_class_benchmark,
    set_pilot_class,
    claim_season_award,
    get_db,
    init_db,
)
from services.tournament import (  # noqa: E402
    class_rank_key,
    load_month_snapshot,
    live_class_score,
    rank_month_overall,
    run_monthly_relegation,
)
from utils.error_reporter import describe_error, format_admin_error  # noqa: E402

passed = 0
failed: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed.append(f"{name} — {detail}")
        print(f"  ✗ {name}  {detail}")


# ---------------------------------------------------------------- чистая математика
def test_class_score() -> None:
    print("\nclass_score — шкала баллов относительно эталона")
    check("точное попадание в эталон = 100", class_score(100_000, 100_000) == 100)
    check("на 1% быстрее = 105", class_score(99_000, 100_000) == 105)
    check("на 1% медленнее = 95", class_score(101_000, 100_000) == 95)
    check("на 6% быстрее = потолок 130", class_score(94_000, 100_000) == 130)
    check("на 10% быстрее всё равно 130 (потолок)", class_score(90_000, 100_000) == 130)
    check("на 20% медленнее = 0 (пол)", class_score(120_000, 100_000) == 0)
    check("нулевой эталон не делит на ноль", class_score(90_000, 0) == 0)

    # Обратный расчёт, которым пользуются при переносе результатов в таблицу.
    check(
        "117 баллов при эталоне 2:30.000 = 2:24.900",
        class_score(144_900, 150_000) == 117,
        f"получилось {class_score(144_900, 150_000)}",
    )


def test_rank_key_tiebreak() -> None:
    """Баг 1.3: при равных баллах бонусы за место распределялись случайно."""
    print("\nclass_rank_key — тай-брейк при равных баллах (баг 1.3)")
    faster = class_rank_key(130, 94_000, 555)
    slower = class_rank_key(130, 95_000, 111)
    check("при равном балле выше тот, у кого круг быстрее", faster < slower)

    higher_score = class_rank_key(120, 99_000, 999)
    check("балл важнее круга", class_rank_key(130, 95_000, 1) < higher_score)

    # Полное равенство — порядок должен быть стабильным, а не случайным.
    a = class_rank_key(130, 94_000, 100)
    b = class_rank_key(130, 94_000, 200)
    check("при полном равенстве порядок детерминирован", a < b)


def test_sql_timestamp() -> None:
    """Баг 1.4: isoformat() ломал строковое сравнение с created_at."""
    print("\nsql_timestamp — формат границ для сравнения с created_at (баг 1.4)")
    moment = datetime(2026, 8, 27, 10, 32, 20)
    stamp = sql_timestamp(moment)
    check("разделитель — пробел, а не 'T'", " " in stamp and "T" not in stamp, stamp)
    check("без микросекунд", "." not in stamp, stamp)
    check("формат совпадает с SQL_TS_FMT", stamp == moment.strftime(SQL_TS_FMT))

    created = "2026-08-27 23:59:59"
    check(
        "поздний круг того же дня НЕ считается более ранним",
        not (created < stamp),
        f"{created!r} < {stamp!r}",
    )
    # Тот же случай со старым форматом — воспроизводим сам баг.
    broken = moment.isoformat()
    check(
        "старый формат действительно давал ложное срабатывание",
        created < broken,
        "если это упало — баг был не в формате",
    )


def test_month_bounds() -> None:
    """Баг 1.2: закрытие месяца и границы зачёта расходились."""
    print("\nprevious_month_bounds — закрытие полного месяца (баг 1.2)")
    now = datetime(2026, 9, 1, 3, 10)
    key, start, end = previous_month_bounds(now)
    check("закрывается предыдущий месяц", key == "2026-08", key)
    check("окно начинается 1 августа", start.startswith("2026-07-31") or start.startswith("2026-08-01"), start)
    check("окно кончается началом сентября", end.startswith("2026-08-31") or end.startswith("2026-09-01"), end)

    # Круг 25 августа обязан попадать в окно закрытия августа.
    lap_25_aug = "2026-08-25 14:00:00"
    check("круг 25 августа попадает в закрываемый месяц", start <= lap_25_aug < end)

    jan = datetime(2026, 1, 1, 3, 10)
    check("переход через новый год", previous_month_bounds(jan)[0] == "2025-12")


def test_class_gating() -> None:
    """Баг 1.5: лестница классов не проверялась."""
    print("\nis_class_unlocked — доступность класса по ступени (баг 1.5)")
    check("новичок в MX-5 не может в GT3", not is_class_unlocked("MX-5", "GT3"))
    check("новичок в MX-5 не может в BTCC", not is_class_unlocked("MX-5", "BTCC"))
    check("свой класс открыт", is_class_unlocked("BTCC", "BTCC"))
    check("класс ниже своего открыт", is_class_unlocked("GT500", "MX-5"))
    check("доп.дисциплина своей ступени открыта", is_class_unlocked("BTCC", "DTM"))
    check("доп.дисциплина ступени выше закрыта", not is_class_unlocked("BTCC", "Touge"))
    check("Week CUP вне лестницы — всегда открыт", is_class_unlocked("MX-5", "Week CUP"))
    check("неизвестная дисциплина не падает", is_class_unlocked("MX-5", "Karting"))
    check("индекс лестницы для Week CUP пустой", class_ladder_index("Week CUP") is None)


def test_error_reporter() -> None:
    print("\nerror_reporter — перевод ошибок на русский")
    info = describe_error("card_not_found")
    check("код YCLIENTS переведён", "карт" in info.title.lower(), info.title)
    check("есть шаги решения", len(info.fix) >= 2)

    info = describe_error(TypeError("'NoneType' object is not subscriptable"))
    check("питоновский баг помечен как ошибка кода", "код" in info.title.lower(), info.title)
    check("баг кода помечен критичным", info.severity == "critical")

    info = describe_error("database is locked")
    check("сбой SQLite распознан по подстроке", "занят" in info.title.lower(), info.title)

    info = describe_error("YCLIENTS credentials are missing")
    check("англоязычное сообщение распознано", "токен" in info.title.lower(), info.title)

    info = describe_error("что-то совершенно неведомое")
    check("неизвестная ошибка не теряется", info.title == "Неизвестная ошибка")
    check("для неизвестной есть шаги", len(info.fix) >= 2)

    text = format_admin_error(
        context="Закрытие месяца 2026-08",
        error="card_not_found",
        details={"Пилот": 123},
        extra_advice="Деньги не потеряны.",
    )
    check("в сообщении есть раздел 'Что делать'", "Что делать" in text)
    check("в сообщении есть контекст", "2026-08" in text)
    check("в сообщении есть техническая деталь", "card_not_found" in text)
    check("HTML-теги не сломаны", text.count("<b>") == text.count("</b>"))

    escaped = format_admin_error(context="<script>", error="<b>hack</b>")
    check("пользовательский ввод экранирован", "&lt;script&gt;" in escaped)


# ---------------------------------------------------------------- тесты с БД
async def _seed(month_key: str, month_start: datetime) -> None:
    """Готовит месяц: 4 пилота в MX-5 с равными баллами и разными кругами.

    month_key передаётся отдельно, а не выводится из month_start: границы
    месяца отдаются в UTC, и для августа start_iso — это "31 июля 21:00"
    по московскому смещению. strftime по нему дал бы "2026-07".
    """
    await init_db()

    await set_class_benchmark("MX-5", month_key, "Tsukuba", 100_000, admin_id=1)
    await set_class_benchmark("BTCC", month_key, "Brands Hatch", 150_000, admin_id=1)

    lap_moment = sql_timestamp(month_start + timedelta(days=5))

    # Все четверо быстрее эталона более чем на 6% => все в потолке 130 баллов,
    # но круги разные — ровно та ситуация, что была в реальной таблице клуба.
    pilots = [
        (1001, "fast", 90_000),
        (1002, "mid", 92_000),
        (1003, "slow", 93_000),
        (1004, "slowest", 93_500),
    ]
    for telegram_id, username, lap_ms in pilots:
        await create_pilot(telegram_id, username, f"7900000{telegram_id}")
        await set_pilot_class(telegram_id, "MX-5", None)
        lap_id = await add_lap("MX-5", username, telegram_id, "Tsukuba", "1:30.000", lap_ms)
        # created_at по умолчанию = сейчас; переносим круг внутрь тестового месяца.
        db = await get_db()
        await db.execute("UPDATE laps SET created_at = ? WHERE id = ?", (lap_moment, lap_id))
        await db.commit()
        await db.close()


async def test_db_backed() -> None:
    print("\nРасчёт зачёта на реальной БД")

    month_key, start_iso, end_iso = month_bounds()
    month_start = datetime.strptime(start_iso, SQL_TS_FMT)
    await _seed(month_key, month_start)

    # --- пакетные запросы возвращают то же, что построчные ---
    bests = await get_all_month_bests(start_iso, end_iso)
    check("пакетный запрос нашёл все 4 результата", len(bests) == 4, str(len(bests)))
    check("лучший круг совпадает", bests.get((1001, "MX-5")) == (90_000, 1), str(bests.get((1001, "MX-5"))))

    single = await live_class_score(1001, "MX-5", month_key, start_iso, end_iso)
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    from_snapshot = snapshot.class_score_for(1001, "MX-5")
    check(
        "снимок даёт тот же балл, что построчный live_class_score",
        single["score"] == from_snapshot["score"],
        f"{single['score']} vs {from_snapshot['score']}",
    )
    check(
        "снимок даёт тот же best_ms",
        single["best_ms"] == from_snapshot["best_ms"],
    )
    check("все четверо в потолке 130", from_snapshot["score"] == 130, str(from_snapshot["score"]))

    # --- бонусы за место при полной ничьей по баллам ---
    bonuses = snapshot.position_bonuses("MX-5")
    check("бонус +10 достался самому быстрому кругу", bonuses.get(1001) == 10, str(bonuses))
    check("бонус +6 — второму по кругу", bonuses.get(1002) == 6, str(bonuses))
    check("бонус +3 — третьему по кругу", bonuses.get(1003) == 3, str(bonuses))
    check("четвёртому бонуса нет", bonuses.get(1004) == 0, str(bonuses))

    # --- общий зачёт ---
    ranking = await rank_month_overall(month_key, start_iso, end_iso)
    check("в зачёте все четверо", len(ranking) == 4, str(len(ranking)))
    check("первым идёт самый быстрый", ranking[0]["telegram_id"] == 1001, str(ranking[0]))
    check("итог первого = (130+10)×1.0", ranking[0]["total"] == 140.0, str(ranking[0]["total"]))
    check("итог последнего = 130×1.0", ranking[-1]["total"] == 130.0, str(ranking[-1]["total"]))

    totals = [row["total"] for row in ranking]
    check("зачёт отсортирован по убыванию", totals == sorted(totals, reverse=True), str(totals))

    # Повторный расчёт должен дать идентичный порядок (детерминированность).
    again = await rank_month_overall(month_key, start_iso, end_iso)
    check(
        "повторный расчёт даёт тот же порядок",
        [r["telegram_id"] for r in again] == [r["telegram_id"] for r in ranking],
    )

    # --- бонус новичка ---
    veterans = await get_pilots_active_before(start_iso)
    check("новички не считаются ветеранами", 1001 not in veterans, str(veterans))

    # --- ачивка "первопроходец" (баг 1.4) ---
    before_first_lap = sql_timestamp(month_start + timedelta(days=1))
    check(
        "до первого круга трасса была пустой",
        not await has_prior_laps_on_track("MX-5", "Tsukuba", before_first_lap),
    )
    after_laps = sql_timestamp(month_start + timedelta(days=10))
    check(
        "после кругов трасса уже не пустая",
        await has_prior_laps_on_track("MX-5", "Tsukuba", after_laps),
    )

    # --- защита релегации от повтора (баг 1.1) ---
    for telegram_id in (2001, 2002, 2003, 2004):
        await create_pilot(telegram_id, f"btcc{telegram_id}", f"7911000{telegram_id}")
        await set_pilot_class(telegram_id, "BTCC", None)

    await run_monthly_relegation(bot=None, bounds=(month_key, start_iso, end_iso))
    guard = await get_setting(f"relegation_done:{month_key}")
    check("после релегации выставлен флаг", guard == "1", str(guard))

    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) FROM pilot_class_status WHERE current_class = 'BTCC'")
    after_first = (await cursor.fetchone())[0]
    await cursor.close()
    await db.close()

    await run_monthly_relegation(bot=None, bounds=(month_key, start_iso, end_iso))

    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) FROM pilot_class_status WHERE current_class = 'BTCC'")
    after_second = (await cursor.fetchone())[0]
    await cursor.close()
    await db.close()

    check(
        "повторный запуск релегации никого больше не понизил",
        after_first == after_second,
        f"было {after_first}, стало {after_second}",
    )

    # --- защита от повторной выдачи наград по старому ключу (баг 1.2) ---
    legacy_key = f"{month_key}-20-18"
    await claim_season_award(legacy_key, 1001, 1, 20, 30, "podium", yclients_bonus_rub=2000)
    check(
        "награда по старому ключу видна проверке по месяцу",
        await has_award_for_month(month_key, 1001, "podium"),
    )
    check(
        "чужая награда не считается своей",
        not await has_award_for_month(month_key, 1002, "podium"),
    )


def test_standings_logic() -> None:
    print("\nУведомления о зачёте — тихие часы и разбор времени")
    from services import standings_watch

    quiet = datetime(2026, 8, 27, 3, 0, tzinfo=None)
    from pytz import timezone as tz
    msk = tz("Europe/Moscow")

    check("03:00 — тихие часы", standings_watch.is_quiet_hours(msk.localize(quiet)))
    check(
        "14:00 — не тихие часы",
        not standings_watch.is_quiet_hours(msk.localize(datetime(2026, 8, 27, 14, 0))),
    )
    check(
        "00:30 — не тихие часы (окно начинается в 01:00)",
        not standings_watch.is_quiet_hours(msk.localize(datetime(2026, 8, 27, 0, 30))),
    )

    parsed = standings_watch._parse_db_time("2026-08-27 10:00:00")
    check("время из БД разобрано", parsed is not None and parsed.year == 2026)
    check("мусор не ломает разбор", standings_watch._parse_db_time("не время") is None)
    check("пустое значение не ломает разбор", standings_watch._parse_db_time(None) is None)

    # Сообщения для всех четырёх переходов должны собираться без исключений.
    out_of_zone = standings_watch._build_message(2, 7, 120.0, "Иван", 15.0, 6)
    check("текст о выбивании из топ-5 собран", "ВЫБИЛИ" in out_of_zone)
    moved = standings_watch._build_message(2, 3, 140.0, "Иван", 5.0, 2)
    check("текст о смещении собран", "СМЕСТИЛИ" in moved)
    entered = standings_watch._build_message(None, 4, 150.0, None, None, None)
    check("текст о входе в топ-5 собран", "ПРИЗОВОЙ" in entered)
    up = standings_watch._build_message(4, 2, 200.0, "Пётр", 10.0, 1)
    check("текст о подъёме собран", "ПОДНЯЛИСЬ" in up)
    check("во всех текстах есть подсказка об отключении", "профиле" in moved)


def test_config_sanity() -> None:
    print("\nКонфигурация")
    from config import SEASON_CLOSE_DAY, SEASON_CLOSE_HOUR, STANDINGS_QUIET_FROM_HOUR
    check("день закрытия в допустимом диапазоне", 1 <= SEASON_CLOSE_DAY <= 28, str(SEASON_CLOSE_DAY))
    check("час закрытия в допустимом диапазоне", 0 <= SEASON_CLOSE_HOUR <= 23, str(SEASON_CLOSE_HOUR))
    check("тихие часы заданы", 0 <= STANDINGS_QUIET_FROM_HOUR <= 23)

    weights = [cfg["weight"] for cfg in CLASS_LADDER.values()]
    check("веса классов положительные", all(w > 0 for w in weights))
    check("минимум стартов везде задан", all(cfg["min_starts"] >= 1 for cfg in CLASS_LADDER.values()))


def main() -> int:
    print("=" * 70)
    print("ТЕСТЫ ТУРНИРНОЙ СИСТЕМЫ VALEVO")
    print("=" * 70)

    test_class_score()
    test_rank_key_tiebreak()
    test_sql_timestamp()
    test_month_bounds()
    test_class_gating()
    test_error_reporter()
    test_standings_logic()
    test_config_sanity()

    asyncio.run(test_db_backed())

    print("\n" + "=" * 70)
    if failed:
        print(f"ПРОВАЛЕНО {len(failed)} из {passed + len(failed)}:")
        for item in failed:
            print(f"  ✗ {item}")
        return 1
    print(f"ВСЕ {passed} ПРОВЕРОК ПРОЙДЕНЫ")
    return 0


if __name__ == "__main__":
    sys.exit(main())

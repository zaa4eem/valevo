import html

from data.tournament import CLASS_LADDER, min_starts_for_class
from database.db import get_all_pilot_display_names
from services.tournament import load_month_snapshot, month_bounds, rank_month_overall
from utils.message_style import DIVIDER
from utils.time_parser import format_ms_to_time

MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
OVERALL_TOP_N = 10

# Порядок страниц интерактивной таблицы лидеров (кнопка "🏆 Таблица лидеров").
LEADERBOARD_PAGES = ["overall", *CLASS_LADDER.keys()]


def _format_score(total: float) -> str:
    if float(total).is_integer():
        return str(int(total))
    return f"{total:.1f}"


def _name_from(names: dict[int, str], telegram_id: int) -> str:
    """Имя из заранее прочитанного справочника — без запроса к БД на строку."""
    return names.get(telegram_id) or str(telegram_id)


async def _build_class_block(class_name: str, snapshot, names: dict[int, str]) -> str | None:
    """Живая таблица класса за месяц — только личный лучший круг месяца
    относительно эталона, никакого "лучшее время за всё время".

    Работает по готовому снимку месяца: раньше на каждый класс шёл отдельный
    запрос списка участников и по 2-3 запроса к БД на каждого пилота, а сам
    блок строится для шести классов подряд после каждого засчитанного круга.
    """
    from services.tournament import class_rank_key

    qualifying: list[tuple[int, int, int | None]] = []
    pending: list[tuple[int, int]] = []

    for telegram_id in snapshot.participants:
        result = snapshot.class_score_for(telegram_id, class_name)
        if result["starts"] <= 0:
            continue
        if result["qualifies"] and result["score"] is not None:
            qualifying.append((telegram_id, result["score"], result["best_ms"]))
        else:
            pending.append((telegram_id, result["starts"]))

    if not qualifying and not pending:
        return None

    # Тот же ключ, что и у бонусов за место (class_position_bonuses), иначе
    # медали в таблице и бонусы в общем зачёте расходились бы при равных баллах.
    qualifying.sort(key=lambda row: class_rank_key(row[1], row[2], row[0]))

    role = CLASS_LADDER[class_name].get("side_of")
    title = f"{class_name} (доп. для {role})" if role else class_name

    lines = [f"🏁 <b>{html.escape(title)}</b>"]
    for i, (telegram_id, score, _best_ms) in enumerate(qualifying):
        mark = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."
        display = _name_from(names, telegram_id)
        lines.append(f"{mark} {html.escape(display)} — <b>{score}</b> баллов")

    min_starts = min_starts_for_class(class_name)
    for telegram_id, starts in pending:
        display = _name_from(names, telegram_id)
        lines.append(f"· {html.escape(display)} — {starts}/{min_starts} стартов (вне зачёта)")

    return "\n".join(lines)


async def build_leaderboard() -> str:
    """Живая таблица турнира: личный лучший круг месяца относительно эталона
    по каждому классу + общий взвешенный зачёт месяца. Раньше здесь было
    "лучшее время за всю историю" — эта версия полностью заменена, чтобы не
    было двух конкурирующих таблиц: результат живой и всегда за текущий месяц."""
    month_key, start_iso, end_iso = month_bounds()
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    # Справочник имён читается один раз на всю таблицу: раньше имя каждой
    # строки запрашивалось отдельно, и на шесть классов плюс общий зачёт
    # выходило несколько десятков запросов на один рендер таблицы.
    names = await get_all_pilot_display_names()

    class_blocks = []
    for class_name in CLASS_LADDER:
        if class_name not in snapshot.benchmarks:
            continue
        block = await _build_class_block(class_name, snapshot, names)
        if block:
            class_blocks.append(block)

    overall_block = await _build_overall_standings_block(month_key, start_iso, end_iso, names)

    if not class_blocks:
        return (
            f"🏆 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n{DIVIDER}\n\n"
            "В этом месяце пока нет результатов в зачёт.\n"
            "Установите время через «⏱ Установить время» — как только клуб задаст "
            "эталон месяца, ваш круг сразу встанет в таблицу.\n\n"
            f"{DIVIDER}\n\n{overall_block}"
        )

    return (
        f"🏆 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n{DIVIDER}\n\n"
        + f"\n\n{DIVIDER}\n\n".join(class_blocks)
        + f"\n\n{DIVIDER}\n\n"
        + overall_block
    )


async def build_leaderboard_page(page_key: str) -> str:
    """Одна страница интерактивной таблицы лидеров (кнопка "🏆 Таблица лидеров").

    page_key == "overall" — упрощённый общий зачёт (место + итог, без разбора
    по классам). Любое другое значение — название класса из CLASS_LADDER:
    топ-5 этого класса по фактическому ВРЕМЕНИ круга, не по баллам — раньше
    кнопка выдавала баллы, что смешивало "кто быстрее" с "как считается зачёт".
    Эти два вопроса теперь разведены по разным страницам.
    """
    month_key, start_iso, end_iso = month_bounds()
    if page_key == "overall":
        return await _build_overall_page(month_key, start_iso, end_iso)

    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    names = await get_all_pilot_display_names()
    return await _build_class_time_page(page_key, snapshot, names)


async def _build_overall_page(month_key: str, start_iso: str, end_iso: str) -> str:
    """Общий зачёт без раскладки по классам — только место и итоговый балл.

    Раньше под каждым итогом шла строка вида "MX-5 130+6×1 + BTCC 117+10×1.4" —
    формула для тех, кто хочет разобраться, но шум для тех, кто просто хочет
    увидеть место. Разбор для желающих остался в services.leaderboard через
    build_leaderboard() (полная версия, уходит в группу после каждого круга);
    здесь — только итог плюс одна общая пометка внизу, как это считается.
    """
    ranked = await rank_month_overall(month_key, start_iso, end_iso)

    lines = ["🏆 <b>ОБЩИЙ ЗАЧЁТ СЕЗОНА</b>", DIVIDER, ""]
    if not ranked:
        lines.append("Пока никто не набрал зачётных баллов в этом сезоне.")
    else:
        names = await get_all_pilot_display_names()
        for i, r in enumerate(ranked[:OVERALL_TOP_N]):
            display = _name_from(names, r["telegram_id"])
            mark = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."
            lines.append(f"{mark} {html.escape(display)} — <b>{_format_score(r['total'])}</b>")

    lines.append("")
    lines.append(
        "ℹ️ Итог — сумма баллов по каждому классу, где выполнен минимум стартов "
        "сезона (100 баллов = точное попадание в эталон месяца, дальше ±5 за "
        "каждый процент быстрее/медленнее), умноженная на вес класса, плюс "
        "бонус за место в личном зачёте этого класса."
    )
    return "\n".join(lines)


async def _build_class_time_page(class_name: str, snapshot, names: dict[int, str]) -> str:
    """Топ-5 класса по фактическому времени круга.

    В отличие от общего зачёта, здесь не важен ни эталон, ни минимум стартов —
    просто кто реально быстрее проехал в этом сезоне, тем же языком, которым
    об этом думает пилот на трассе."""
    ranked = [
        (telegram_id, best_ms)
        for (telegram_id, discipline), (best_ms, starts) in snapshot.bests.items()
        if discipline == class_name and best_ms is not None and starts > 0
    ]

    role = CLASS_LADDER[class_name].get("side_of")
    title = f"{class_name} (доп. для {role})" if role else class_name
    lines = [f"🏁 <b>{html.escape(title)}</b>", DIVIDER, ""]

    if not ranked:
        lines.append("В этом сезоне пока нет результатов в этом классе.")
        return "\n".join(lines)

    ranked.sort(key=lambda row: (row[1], row[0]))
    for i, (telegram_id, best_ms) in enumerate(ranked[:5]):
        mark = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."
        display = _name_from(names, telegram_id)
        lines.append(f"{mark} {html.escape(display)} — <b>{format_ms_to_time(best_ms)}</b>")

    return "\n".join(lines)


async def _build_overall_standings_block(month_key: str, start_iso: str, end_iso: str, names: dict[int, str] | None = None) -> str:
    """Итог месяца = сумма ((баллы класса + бонус за место) × вес класса) по
    всем классам, где выполнен зачёт. Раньше показывался только итоговое
    число без объяснения, из чего оно складывается — пилоту было "непонятно
    как" оно считается, особенно если он выступает в нескольких классах
    сразу. Теперь под каждым итогом — краткая раскладка по классам, из
    которой видно и вклад каждого класса, и бонус за место среди других
    пилотов в нём (если обогнали кого-то в личном зачёте класса — бонус
    у вас, обогнали вас — бонус ушёл к обогнавшему)."""
    ranked = await rank_month_overall(month_key, start_iso, end_iso)

    lines = [
        "🏆 <b>ОБЩИЙ ЗАЧЁТ МЕСЯЦА</b>",
        "<i>Итог = сумма ((баллы + бонус за место) × вес) по всем классам зачёта</i>",
    ]
    if not ranked:
        lines.append("Пока никто не набрал зачётных баллов в этом месяце.")
        return "\n".join(lines)

    if names is None:
        names = await get_all_pilot_display_names()

    for i, r in enumerate(ranked[:OVERALL_TOP_N]):
        display = _name_from(names, r["telegram_id"])
        mark = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."
        parts = []
        for b in r["breakdown"]:
            bonus = b.get("position_bonus") or 0
            bonus_text = f"+{bonus}" if bonus else ""
            parts.append(f"{html.escape(b['class_name'])} {_format_score(b['score'])}{bonus_text}×{b['weight']:g}")
        breakdown_text = " + ".join(parts)
        lines.append(
            f"{mark} {html.escape(display)} — "
            f"<code>{html.escape(_format_score(r['total']))}</code>"
            f"\n     <i>{breakdown_text}</i>"
        )

    return "\n".join(lines)

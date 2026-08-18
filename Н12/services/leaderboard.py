import html

from data.tournament import CLASS_LADDER, min_starts_for_class
from database.db import get_all_class_benchmarks, get_pilot_by_telegram_id
from services.tournament import month_bounds, month_participant_ids, rank_month_overall
from utils.message_style import DIVIDER

MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
OVERALL_TOP_N = 10


def _format_score(total: float) -> str:
    if float(total).is_integer():
        return str(int(total))
    return f"{total:.1f}"


async def _pilot_display(telegram_id: int) -> str:
    pilot = await get_pilot_by_telegram_id(telegram_id)
    if pilot:
        return str(pilot.get("display_name") or pilot.get("username") or telegram_id)
    return str(telegram_id)


async def _build_class_block(class_name: str, month_key: str, start_iso: str, end_iso: str) -> str | None:
    """Живая таблица класса за месяц — только личный лучший круг месяца
    относительно эталона, никакого "лучшее время за всё время"."""
    from services.tournament import live_class_score

    participants = await month_participant_ids(start_iso, end_iso)
    qualifying: list[tuple[int, int]] = []
    pending: list[tuple[int, int]] = []

    for telegram_id in participants:
        result = await live_class_score(telegram_id, class_name, month_key, start_iso, end_iso)
        if result["starts"] <= 0:
            continue
        if result["qualifies"] and result["score"] is not None:
            qualifying.append((telegram_id, result["score"]))
        else:
            pending.append((telegram_id, result["starts"]))

    if not qualifying and not pending:
        return None

    qualifying.sort(key=lambda pair: pair[1], reverse=True)

    role = CLASS_LADDER[class_name].get("side_of")
    title = f"{class_name} (доп. для {role})" if role else class_name

    lines = [f"🏁 <b>{html.escape(title)}</b>"]
    for i, (telegram_id, score) in enumerate(qualifying):
        mark = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."
        display = await _pilot_display(telegram_id)
        lines.append(f"{mark} {html.escape(display)} — <b>{score}</b> баллов")

    min_starts = min_starts_for_class(class_name)
    for telegram_id, starts in pending:
        display = await _pilot_display(telegram_id)
        lines.append(f"· {html.escape(display)} — {starts}/{min_starts} стартов (вне зачёта)")

    return "\n".join(lines)


async def build_leaderboard() -> str:
    """Живая таблица турнира: личный лучший круг месяца относительно эталона
    по каждому классу + общий взвешенный зачёт месяца. Раньше здесь было
    "лучшее время за всю историю" — эта версия полностью заменена, чтобы не
    было двух конкурирующих таблиц: результат живой и всегда за текущий месяц."""
    month_key, start_iso, end_iso = month_bounds()
    benchmarks = await get_all_class_benchmarks(month_key)

    class_blocks = []
    for class_name in CLASS_LADDER:
        if class_name not in benchmarks:
            continue
        block = await _build_class_block(class_name, month_key, start_iso, end_iso)
        if block:
            class_blocks.append(block)

    overall_block = await _build_overall_standings_block(month_key, start_iso, end_iso)

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


async def _build_overall_standings_block(month_key: str, start_iso: str, end_iso: str) -> str:
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

    for i, r in enumerate(ranked[:OVERALL_TOP_N]):
        display = await _pilot_display(r["telegram_id"])
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


async def _class_standings_data(class_name: str, month_key: str, start_iso: str, end_iso: str) -> dict | None:
    """JSON-friendly twin of _build_class_block — same qualifying/pending
    computation, structured for the Mini App instead of formatted as HTML."""
    from services.tournament import live_class_score

    participants = await month_participant_ids(start_iso, end_iso)
    qualifying: list[dict] = []
    pending: list[dict] = []

    for telegram_id in participants:
        result = await live_class_score(telegram_id, class_name, month_key, start_iso, end_iso)
        if result["starts"] <= 0:
            continue
        display = await _pilot_display(telegram_id)
        if result["qualifies"] and result["score"] is not None:
            qualifying.append({"telegram_id": telegram_id, "display_name": display, "score": result["score"]})
        else:
            pending.append({"telegram_id": telegram_id, "display_name": display, "starts": result["starts"]})

    if not qualifying and not pending:
        return None

    qualifying.sort(key=lambda row: row["score"], reverse=True)
    for i, row in enumerate(qualifying):
        row["place"] = i + 1
        row["medal"] = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."

    role = CLASS_LADDER[class_name].get("side_of")
    return {
        "class_name": class_name,
        "side_of": role,
        "min_starts": min_starts_for_class(class_name),
        "qualifying": qualifying,
        "pending": pending,
    }


async def get_tournament_leaderboard_data() -> dict:
    """Структурированный (JSON-совместимый) снимок живой турнирной таблицы —
    те же данные, что и build_leaderboard(), но как словари/списки для
    /api/leaderboard мини-приложения вместо HTML-текста для бота."""
    month_key, start_iso, end_iso = month_bounds()
    benchmarks = await get_all_class_benchmarks(month_key)

    classes = []
    for class_name in CLASS_LADDER:
        if class_name not in benchmarks:
            continue
        block = await _class_standings_data(class_name, month_key, start_iso, end_iso)
        if block:
            classes.append(block)

    ranked = await rank_month_overall(month_key, start_iso, end_iso)
    overall = []
    for i, r in enumerate(ranked[:OVERALL_TOP_N]):
        overall.append({
            "place": i + 1,
            "medal": MEDALS[i] if i < len(MEDALS) else f"{i + 1}.",
            "telegram_id": r["telegram_id"],
            "display_name": await _pilot_display(r["telegram_id"]),
            "total": r["total"],
            "total_text": _format_score(r["total"]),
            "breakdown": r["breakdown"],
        })

    return {"month_key": month_key, "classes": classes, "overall": overall}

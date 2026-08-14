import html

from database.db import get_leaderboard_data, get_pilot_by_username, get_pilot_by_telegram_id
from services.tournament import month_bounds, rank_month_overall
from utils.message_style import DIVIDER

MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
OVERALL_TOP_N = 10


async def build_leaderboard() -> str:
    data = await get_leaderboard_data()
    if not data:
        return (
            "🏆 <b>Таблица лидеров пока пуста.</b>\n\n"
            "Станьте первым — отправьте свой результат через «⏱ Установить время»!"
        )

    blocks = []
    for discipline, rows in data.items():
        if not rows:
            continue
        track = rows[0].get("track", "")
        lines = [f"🏁 <b>{html.escape(str(discipline))}</b> · {html.escape(str(track))}"]
        for i, r in enumerate(rows):
            pilot = await get_pilot_by_username(r["username"])
            display = pilot[4] if pilot and pilot[4] else r["username"]
            lines.append(
                f"{MEDALS[i]} {html.escape(str(display))} — "
                f"<code>{html.escape(str(r['lap_text']))}</code>"
            )
        blocks.append("\n".join(lines))

    overall_block = await _build_overall_standings_block()

    return (
        f"🏆 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n{DIVIDER}\n\n"
        + f"\n\n{DIVIDER}\n\n".join(blocks)
        + f"\n\n{DIVIDER}\n\n"
        + overall_block
    )


def _format_score(total: float) -> str:
    if float(total).is_integer():
        return str(int(total))
    return f"{total:.1f}"


async def _build_overall_standings_block() -> str:
    month_key, start_iso, end_iso = month_bounds()
    ranked = await rank_month_overall(month_key, start_iso, end_iso)

    lines = ["🏆 <b>ОБЩИЙ ЗАЧЁТ МЕСЯЦА</b>"]
    if not ranked:
        lines.append("Пока никто не набрал зачётных баллов в этом месяце.")
        return "\n".join(lines)

    for i, r in enumerate(ranked[:OVERALL_TOP_N]):
        pilot = await get_pilot_by_telegram_id(r["telegram_id"])
        display = (pilot.get("display_name") or pilot.get("username")) if pilot else r["telegram_id"]
        mark = MEDALS[i] if i < len(MEDALS) else f"{i + 1}."
        lines.append(
            f"{mark} {html.escape(str(display))} — "
            f"<code>{html.escape(_format_score(r['total']))}</code>"
        )

    return "\n".join(lines)

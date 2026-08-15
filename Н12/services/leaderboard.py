import html

from database.db import get_leaderboard_data, get_pilot_by_username

MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
DIVIDER = "━━━━━━━━━━━━━━━━━━"


async def get_leaderboard_entries() -> list[dict]:
    """Структурированные данные таблицы лидеров (для мини-приложения и текстового вывода)."""
    data = await get_leaderboard_data()
    entries = []

    for discipline, rows in data.items():
        if not rows:
            continue
        track = rows[0].get("track", "")
        places = []
        for i, r in enumerate(rows):
            pilot = await get_pilot_by_username(r["username"])
            display = pilot[4] if pilot and pilot[4] else r["username"]
            places.append({
                "place": i + 1,
                "medal": MEDALS[i] if i < len(MEDALS) else f"{i + 1}.",
                "display_name": display,
                "lap_text": r["lap_text"],
                "lap_ms": r["lap_ms"],
            })
        entries.append({"discipline": discipline, "track": track, "places": places})

    return entries


async def build_leaderboard() -> str:
    entries = await get_leaderboard_entries()
    if not entries:
        return (
            "🏆 <b>Таблица лидеров пока пуста.</b>\n\n"
            "Станьте первым — отправьте свой результат через «⏱ Установить время»!"
        )

    blocks = []
    for entry in entries:
        lines = [f"🏁 <b>{html.escape(str(entry['discipline']))}</b> · {html.escape(str(entry['track']))}"]
        for row in entry["places"]:
            lines.append(
                f"{row['medal']} {html.escape(str(row['display_name']))} — "
                f"<code>{html.escape(str(row['lap_text']))}</code>"
            )
        blocks.append("\n".join(lines))

    return (
        f"🏆 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n{DIVIDER}\n\n"
        + f"\n\n{DIVIDER}\n\n".join(blocks)
    )

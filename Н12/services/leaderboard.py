from database.db import get_leaderboard_data, get_pilot_by_username

async def build_leaderboard():
    data = await get_leaderboard_data()
    if not data:
        return "🏆 Таблица лидеров пока пуста."

    text = "🏁 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n\n"
    medals = ["🥇", "🥈", "🥉", "⚪", "⚪"]

    for discipline, rows in data.items():
        if not rows:
            continue
        # Берём название трассы из первой записи (обычно оно одинаковое для всех)
        track = rows[0].get("track", "")
        text += f"<b>{discipline} - {track}</b>\n"
        for i, r in enumerate(rows):
            pilot = await get_pilot_by_username(r["username"])
            display = pilot[4] if pilot and pilot[4] else r["username"]
            text += f"{medals[i]} {display} – {r['lap_text']}\n"
        text += "\n"

    return text
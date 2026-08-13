import html

from database.db import get_leaderboard_data, get_pilot_by_username
from utils.message_style import DIVIDER

MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]


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

    return (
        f"🏆 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n{DIVIDER}\n\n"
        + f"\n\n{DIVIDER}\n\n".join(blocks)
    )

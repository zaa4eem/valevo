import html

from data.tournament import CLASS_LADDER
from database.db import get_all_pilot_display_names
from services.tournament import load_month_snapshot, month_bounds

OVERALL_TOP_N = 7
MEDALS = ["🥇", "🥈", "🥉"]


def _name(names: dict[int, str], telegram_id: int) -> str:
    return html.escape(str(names.get(telegram_id) or telegram_id).replace("\n", " ")[:64])


def _place_mark(index: int) -> str:
    return MEDALS[index] if index < len(MEDALS) else f"{index + 1}."


def _format_ms(ms: int | None) -> str:
    if not ms or ms <= 0:
        return "—"
    minutes, rem = divmod(int(ms), 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{minutes:02d}:{seconds:02d}.{millis:03d}"


def leaderboard_chunks(text: str, limit: int = 3900) -> list[str]:
    chunks, current, size = [], [], 0
    for line in text.splitlines():
        line_size = len(line.encode("utf-16-le")) // 2 + (1 if current else 0)
        if current and size + line_size > limit:
            chunks.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += line_size
    if current:
        chunks.append("\n".join(current))
    return chunks


async def build_leaderboard() -> str:
    """Только отображение: TOP-7 общего зачёта + времена по всем дисциплинам."""
    month_key, start_iso, end_iso = month_bounds()
    snapshot = await load_month_snapshot(month_key, start_iso, end_iso)
    names = await get_all_pilot_display_names()

    lines = ["🏆 <b>ОБЩИЙ РЕЙТИНГ — TOP-7</b>"]
    overall = snapshot.overall_ranking()[:OVERALL_TOP_N]
    if overall:
        for idx, row in enumerate(overall):
            lines.append(
                f"{_place_mark(idx)} {_name(names, row['telegram_id'])} — "
                f"<b>{int(row['total'])} баллов</b>"
            )
    else:
        lines.append("Пока нет результатов.")

    # CLASS_LADDER задаёт стабильный порядок всех дисциплин турнира.
    for class_name in CLASS_LADDER:
        rows = []
        for telegram_id, place in snapshot._positions.get(class_name, {}).items():
            result = snapshot.class_score_for(telegram_id, class_name)
            if result.get("best_ms"):
                rows.append((place, telegram_id, result["best_ms"]))
        rows.sort(key=lambda x: x[0])

        lines.extend(["", f"🏁 <b>{html.escape(class_name)}</b>"])
        if not rows:
            lines.append("—")
            continue
        for place, telegram_id, best_ms in rows:
            lines.append(
                f"{place}. {_name(names, telegram_id)} — <code>{_format_ms(best_ms)}</code>"
            )

    return "\n".join(lines)

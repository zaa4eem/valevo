from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from database.db import get_tracks_for_discipline

async def get_tracks_keyboard(discipline: str):
    tracks = await get_tracks_for_discipline(discipline)
    kb = InlineKeyboardMarkup(inline_keyboard=[])
    for t in tracks:
        kb.inline_keyboard.append([InlineKeyboardButton(text=t, callback_data=f"track_{t}")])
    return kb
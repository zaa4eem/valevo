from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from data.constants import DISCIPLINES

def get_disciplines_keyboard():
    kb = InlineKeyboardMarkup(inline_keyboard=[])
    for d in DISCIPLINES:
        kb.inline_keyboard.append([InlineKeyboardButton(text=d, callback_data=f"discipline_{d}")])
    return kb
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton
)

profile_menu = InlineKeyboardMarkup(inline_keyboard=[
    [InlineKeyboardButton(text="✏️ Изменить ник", callback_data="change_nick")],
])

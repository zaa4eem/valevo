from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

def pilot_manage_keyboard(telegram_id):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="➕ Рейтинг", callback_data=f"rating_plus_{telegram_id}"),
         InlineKeyboardButton(text="➖ Рейтинг", callback_data=f"rating_minus_{telegram_id}")],
        [InlineKeyboardButton(text="🎁 Начислить бонус", callback_data=f"balance_plus_{telegram_id}"),
         InlineKeyboardButton(text="🎁 Списать бонус", callback_data=f"balance_minus_{telegram_id}")],
        [InlineKeyboardButton(text="🏎 Изменить номер", callback_data=f"number_{telegram_id}")],
        [InlineKeyboardButton(text="⬅️ Назад", callback_data="back_pilots")]
    ])

def rating_keyboard(action, telegram_id):
    kb = InlineKeyboardMarkup(inline_keyboard=[])
    for amt in [5, 10, 15, 20]:
        kb.inline_keyboard.append([InlineKeyboardButton(text=f"{action}{amt}", callback_data=f"rate_{action}_{amt}_{telegram_id}")])
    return kb

def bonus_minutes_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="15 мин", callback_data="bonus_15")],
        [InlineKeyboardButton(text="30 мин", callback_data="bonus_30")],
        [InlineKeyboardButton(text="60 мин", callback_data="bonus_60")],
        [InlineKeyboardButton(text="❌ Отмена", callback_data="cancel_bonus")]
    ])
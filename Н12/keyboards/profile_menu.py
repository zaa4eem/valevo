from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton


def build_profile_menu(notify_standings: bool = True) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✏️ Изменить ник", callback_data="change_nick"),
            InlineKeyboardButton(text="🔄 Обновить", callback_data="refresh_profile"),
        ],
        [InlineKeyboardButton(
            text="🔔 Уведомления вкл" if notify_standings else "🔕 Уведомления выкл",
            callback_data="toggle_standings_notify",
        )],
    ])


profile_menu = build_profile_menu()

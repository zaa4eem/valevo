from datetime import datetime

from aiogram import Router
from aiogram.types import (
    Message,
    CallbackQuery
)

from aiogram.utils.keyboard import (
    InlineKeyboardBuilder
)

from config import ADMIN_IDS

from database.bookings import (
    get_future_bookings
)

router = Router()


def bookings_keyboard(bookings):

    builder = InlineKeyboardBuilder()

    for booking in bookings:

        booking_time = datetime.fromisoformat(
            booking["booking_time"]
        )

        builder.button(
            text=(
                f"{booking_time.strftime('%d.%m %H:%M')} | "
                f"{booking['service_name']}"
            ),
            callback_data=(
                f"booking_{booking['id']}"
            )
        )

    builder.adjust(1)

    return builder.as_markup()


@router.message(
    lambda message:
    message.text == "📅 Бронирования"
)
async def future_bookings(
    message: Message
):

    if message.from_user.id not in ADMIN_IDS:
        return

    bookings = await get_future_bookings()

    if not bookings:

        await message.answer(
            "❌ Будущих бронирований нет"
        )

        return

    await message.answer(
        "📅 Будущие бронирования:",
        reply_markup=bookings_keyboard(
            bookings
        )
    )


@router.callback_query(
    lambda c:
    c.data.startswith(
        "booking_"
    )
)
async def booking_card(
    callback: CallbackQuery
):

    booking_id = int(
        callback.data.split("_")[1]
    )

    bookings = await get_future_bookings()

    booking = next(
        (
            b for b in bookings
            if b["id"] == booking_id
        ),
        None
    )

    if not booking:

        await callback.answer(
            "Бронь не найдена"
        )

        return

    booking_time = datetime.fromisoformat(
        booking["booking_time"]
    )

    text = (

        "📅 <b>Информация о брони</b>\n\n"

        f"👤 Telegram ID: "
        f"{booking['pilot_telegram_id']}\n"

        f"📞 {booking['phone']}\n\n"

        f"🏎 Услуга: "
        f"{booking['service_name']}\n"

        f"👨‍🔧 Сотрудник: "
        f"{booking['staff_name']}\n\n"

        f"🕒 "
        f"{booking_time.strftime('%d.%m.%Y %H:%M')}\n"

        f"⏱ "
        f"{booking['duration_minutes']} мин"
    )

    await callback.message.edit_text(
        text
    )
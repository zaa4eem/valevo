import asyncio
import html
import logging
from datetime import datetime

from pytz import timezone

from aiogram import Router, F
from aiogram.filters import BaseFilter, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    ReplyKeyboardMarkup,
    KeyboardButton,
)

from config import ADMIN_IDS, GROUP_ID, MOSCOW_TZ

from database.db import (
    add_lap,
    delete_lap,
    get_pilot_by_telegram_id,
    get_all_disciplines,
    get_tracks_for_discipline,
    update_pilot_rating,

    expire_old_time_requests,
    get_pending_time_request,
    get_time_request_cooldown_minutes,
    create_time_request,
    get_time_request,
    acquire_time_request,
    complete_time_request,
    restore_time_request_pending,
)

from handlers.admin import send_notifications
from keyboards.menu import get_menu
from services.tournament import check_and_process_promotion
from services.achievements import check_achievements_after_lap
from utils.message_style import DIVIDER, header
from utils.time_parser import time_to_ms


router = Router()
logger = logging.getLogger(__name__)


# Пользователь может отправлять заявку раз в 30 минут.
TIME_REQUEST_COOLDOWN_MINUTES = 30

# Приём заявок закрыт с 01:00 включительно до 12:00.
REQUESTS_CLOSED_FROM_HOUR = 1
REQUESTS_CLOSED_TO_HOUR = 12

CANCEL_BUTTON = "❌ Отменить"


class NonAdminFilter(BaseFilter):
    async def __call__(self, message: Message) -> bool:
        return (
            message.from_user is not None
            and message.from_user.id not in ADMIN_IDS
        )


class TimeRequestForm(StatesGroup):
    discipline = State()
    track = State()
    lap_time = State()
    proof = State()


def cancel_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=CANCEL_BUTTON)]
        ],
        resize_keyboard=True
    )


def requests_are_closed() -> bool:
    """
    Закрыто:
        01:00:00–11:59:59 МСК

    Открыто:
        12:00:00–00:59:59 МСК
    """
    now = datetime.now(timezone(MOSCOW_TZ))

    return (
        REQUESTS_CLOSED_FROM_HOUR
        <= now.hour
        < REQUESTS_CLOSED_TO_HOUR
    )


def format_cooldown(minutes: int) -> str:
    minutes = max(1, int(minutes))

    if minutes == 1:
        return "1 минуту"

    if 2 <= minutes <= 4:
        return f"{minutes} минуты"

    return f"{minutes} минут"


async def check_request_allowed(
    telegram_id: int
) -> tuple[bool, str | None]:
    """
    Общая проверка:
    - время суток;
    - старая заявка;
    - cooldown.
    """
    if requests_are_closed():
        return (
            False,
            "🌙 <b>Приём заявок сейчас закрыт</b>.\n\n"
            "Запросить установку времени можно ежедневно:\n"
            "🕛 с <b>12:00</b> до <b>01:00</b> по московскому времени.\n\n"
            "Ограничение введено, чтобы ночью администраторам "
            "не приходили уведомления."
        )

    await expire_old_time_requests()

    pending = await get_pending_time_request(telegram_id)

    if pending:
        return (
            False,
            "⏳ <b>У вас уже есть заявка на проверке</b>.\n\n"
            f"Дисциплина: <b>{html.escape(str(pending['discipline']))}</b>\n"
            f"Трасса: <b>{html.escape(str(pending['track']))}</b>\n"
            f"Время: <b>{html.escape(str(pending['lap_time_text']))}</b>\n\n"
            "Дождитесь решения администратора."
        )

    cooldown = await get_time_request_cooldown_minutes(
        telegram_id,
        TIME_REQUEST_COOLDOWN_MINUTES
    )

    if cooldown > 0:
        return (
            False,
            "⏱ <b>Слишком частая отправка заявок</b>.\n\n"
            f"Повторить попытку можно примерно через "
            f"<b>{format_cooldown(cooldown)}</b>."
        )

    return True, None


def discipline_keyboard(
    disciplines: list[str]
) -> InlineKeyboardMarkup:
    rows = []

    for index, discipline in enumerate(disciplines):
        rows.append([
            InlineKeyboardButton(
                text=discipline,
                callback_data=f"time_req_disc:{index}"
            )
        ])

    return InlineKeyboardMarkup(inline_keyboard=rows)


def track_keyboard(
    tracks: list[str]
) -> InlineKeyboardMarkup:
    rows = []

    for index, track in enumerate(tracks):
        rows.append([
            InlineKeyboardButton(
                text=track,
                callback_data=f"time_req_track:{index}"
            )
        ])

    return InlineKeyboardMarkup(inline_keyboard=rows)


def admin_decision_keyboard(
    request_id: int
) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Принять",
                    callback_data=f"time_req_approve:{request_id}"
                ),
                InlineKeyboardButton(
                    text="❌ Отклонить",
                    callback_data=f"time_req_reject:{request_id}"
                ),
            ]
        ]
    )


def request_caption(
    request_id: int,
    pilot_name: str,
    pilot_number: int | None,
    discipline: str,
    track: str,
    lap_time: str,
) -> str:
    safe_name = html.escape(pilot_name)
    safe_discipline = html.escape(discipline)
    safe_track = html.escape(track)
    safe_lap_time = html.escape(lap_time)

    number_text = (
        f"#{pilot_number}"
        if pilot_number is not None
        else "—"
    )

    return (
        header("🏁", "Новая заявка на фиксацию времени") + "\n\n"
        f"🆔 Заявка: <b>#{request_id}</b>\n"
        f"👤 Пилот: <b>{safe_name}</b>\n"
        f"#️⃣ Номер пилота: <b>{number_text}</b>\n"
        f"🏆 Дисциплина: <b>{safe_discipline}</b>\n"
        f"🗺 Трасса: <b>{safe_track}</b>\n"
        f"⏱ Время: <b>{safe_lap_time}</b>\n\n"
        "📸 Фотография результата прикреплена выше.\n\n"
        "Проверьте фотографию и выберите решение."
    )


async def edit_admin_request_message(
    callback: CallbackQuery,
    status_text: str
):
    old_caption = callback.message.caption or ""

    # Чтобы при повторном редактировании статусы не дублировались.
    base_caption = old_caption.split(
        f"\n\n{DIVIDER}\n"
    )[0]

    new_caption = (
        f"{base_caption}\n\n"
        f"{DIVIDER}\n"
        f"{status_text}"
    )

    try:
        await callback.message.edit_caption(
            caption=new_caption,
            reply_markup=None
        )
    except Exception:
        try:
            await callback.message.edit_reply_markup(
                reply_markup=None
            )
        except Exception:
            pass


# =========================================================
# НАЧАЛО ЗАЯВКИ
# =========================================================

@router.message(
    NonAdminFilter(),
    F.text == "⏱ Установить время"
)
async def user_time_request_start(
    message: Message,
    state: FSMContext
):
    pilot = await get_pilot_by_telegram_id(
        message.from_user.id
    )

    if not pilot:
        await message.answer(
            "❌ Сначала зарегистрируйтесь через /start."
        )
        return

    allowed, error_text = await check_request_allowed(
        message.from_user.id
    )

    if not allowed:
        await message.answer(
            error_text,
            reply_markup=get_menu(message.from_user.id)
        )
        return

    disciplines = await get_all_disciplines()

    if not disciplines:
        await message.answer(
            "❌ В клубе пока не настроены дисциплины."
        )
        return

    await state.clear()
    await state.update_data(
        available_disciplines=disciplines
    )
    await state.set_state(TimeRequestForm.discipline)

    await message.answer(
        "🏆 <b>Выберите дисциплину:</b>",
        reply_markup=cancel_keyboard()
    )

    await message.answer(
        "Доступные дисциплины:",
        reply_markup=discipline_keyboard(disciplines)
    )


# =========================================================
# ВЫБОР ДИСЦИПЛИНЫ
# =========================================================

@router.callback_query(
    StateFilter(TimeRequestForm.discipline),
    F.data.startswith("time_req_disc:")
)
async def user_time_request_discipline(
    callback: CallbackQuery,
    state: FSMContext
):
    await callback.answer()

    data = await state.get_data()
    disciplines = data.get(
        "available_disciplines",
        []
    )

    try:
        index = int(callback.data.split(":", 1)[1])
        discipline = disciplines[index]
    except (ValueError, IndexError, TypeError):
        await callback.answer(
            "Дисциплина больше недоступна. Начните заново.",
            show_alert=True
        )
        await state.clear()
        return

    tracks = await get_tracks_for_discipline(
        discipline
    )

    if not tracks:
        await callback.message.answer(
            "❌ Для этой дисциплины не настроены трассы."
        )
        return

    await state.update_data(
        discipline=discipline,
        available_tracks=tracks,
    )
    await state.set_state(TimeRequestForm.track)

    try:
        await callback.message.edit_text(
            f"🏆 Дисциплина: <b>{html.escape(discipline)}</b>\n\n"
            "🗺 Выберите трассу:",
            reply_markup=track_keyboard(tracks)
        )
    except Exception:
        await callback.message.answer(
            "🗺 Выберите трассу:",
            reply_markup=track_keyboard(tracks)
        )


# =========================================================
# ВЫБОР ТРАССЫ
# =========================================================

@router.callback_query(
    StateFilter(TimeRequestForm.track),
    F.data.startswith("time_req_track:")
)
async def user_time_request_track(
    callback: CallbackQuery,
    state: FSMContext
):
    await callback.answer()

    data = await state.get_data()
    tracks = data.get("available_tracks", [])

    try:
        index = int(callback.data.split(":", 1)[1])
        track = tracks[index]
    except (ValueError, IndexError, TypeError):
        await callback.answer(
            "Трасса больше недоступна. Начните заново.",
            show_alert=True
        )
        await state.clear()
        return

    await state.update_data(track=track)
    await state.set_state(TimeRequestForm.lap_time)

    try:
        await callback.message.edit_text(
            f"🗺 Трасса: <b>{html.escape(track)}</b>\n\n"
            "⏱ Введите время круга.\n"
            "Пример: <code>01:18.565</code>"
        )
    except Exception:
        await callback.message.answer(
            "⏱ Введите время круга.\n"
            "Пример: <code>01:18.565</code>"
        )


# =========================================================
# ВВОД ВРЕМЕНИ
# =========================================================

@router.message(
    StateFilter(TimeRequestForm.lap_time),
    F.text
)
async def user_time_request_lap_time(
    message: Message,
    state: FSMContext
):
    if message.text == CANCEL_BUTTON:
        await state.clear()
        await message.answer(
            "🚫 Заявка отменена.",
            reply_markup=get_menu(message.from_user.id)
        )
        return

    lap_time_text = message.text.strip()

    try:
        lap_time_ms = time_to_ms(lap_time_text)
    except Exception:
        await message.answer(
            "❌ Неверный формат времени.\n\n"
            "Введите результат в формате:\n"
            "<code>01:18.565</code>"
        )
        return

    await state.update_data(
        lap_time_text=lap_time_text,
        lap_time_ms=lap_time_ms,
    )
    await state.set_state(TimeRequestForm.proof)

    await message.answer(
        "📸 <b>Теперь отправьте фотографию результата</b>.\n\n"
        "На фотографии должны быть отчётливо видны:\n"
        "• итоговое время;\n"
        "• выбранная трасса или экран результата.\n\n"
        "Документы, видео и фотографии без подтверждения "
        "времени администратор может отклонить.",
        reply_markup=cancel_keyboard()
    )


# =========================================================
# ПОЛУЧЕНИЕ ФОТО И ОТПРАВКА АДМИНАМ
# =========================================================

@router.message(
    StateFilter(TimeRequestForm.proof),
    F.photo
)
async def user_time_request_proof(
    message: Message,
    state: FSMContext
):
    # Проверяем повторно непосредственно перед созданием заявки.
    allowed, error_text = await check_request_allowed(
        message.from_user.id
    )

    if not allowed:
        await state.clear()
        await message.answer(
            error_text,
            reply_markup=get_menu(message.from_user.id)
        )
        return

    pilot = await get_pilot_by_telegram_id(
        message.from_user.id
    )

    if not pilot:
        await state.clear()
        await message.answer(
            "❌ Профиль не найден. Используйте /start.",
            reply_markup=get_menu(message.from_user.id)
        )
        return

    data = await state.get_data()

    discipline = data.get("discipline")
    track = data.get("track")
    lap_time_text = data.get("lap_time_text")
    lap_time_ms = data.get("lap_time_ms")

    if not all([
        discipline,
        track,
        lap_time_text,
        lap_time_ms,
    ]):
        await state.clear()
        await message.answer(
            "❌ Данные заявки потеряны. Начните заново.",
            reply_markup=get_menu(message.from_user.id)
        )
        return

    photo_file_id = message.photo[-1].file_id

    username = (
        pilot.get("username")
        or message.from_user.username
        or f"user_{message.from_user.id}"
    )

    pilot_number = pilot.get("pilot_number")
    display_name = (
        pilot.get("display_name")
        or f"@{username}"
    )

    request_id = await create_time_request(
        telegram_id=message.from_user.id,
        username=username,
        pilot_number=pilot_number,
        discipline=discipline,
        track=track,
        lap_time_text=lap_time_text,
        lap_time_ms=lap_time_ms,
        photo_file_id=photo_file_id,
    )

    caption = request_caption(
        request_id=request_id,
        pilot_name=display_name,
        pilot_number=pilot_number,
        discipline=discipline,
        track=track,
        lap_time=lap_time_text,
    )

    delivered = 0

    for admin_id in ADMIN_IDS:
        try:
            await message.bot.send_photo(
                chat_id=admin_id,
                photo=photo_file_id,
                caption=caption,
                reply_markup=admin_decision_keyboard(
                    request_id
                )
            )
            delivered += 1
            await asyncio.sleep(0.05)

        except Exception as exc:
            logger.warning(
                "Не удалось отправить заявку #%s "
                "администратору %s: %s",
                request_id,
                admin_id,
                exc,
            )

    await state.clear()

    if delivered == 0:
        await complete_time_request(
            request_id=request_id,
            status="delivery_failed",
        )

        await message.answer(
            "❌ Не удалось доставить заявку администраторам.\n"
            "Попробуйте позднее или обратитесь в поддержку.",
            reply_markup=get_menu(message.from_user.id)
        )
        return

    await message.answer(
        "✅ <b>Заявка отправлена администрации</b>.\n\n"
        f"🏆 Дисциплина: <b>{html.escape(discipline)}</b>\n"
        f"🗺 Трасса: <b>{html.escape(track)}</b>\n"
        f"⏱ Время: <b>{html.escape(lap_time_text)}</b>\n\n"
        "После проверки фотографии бот сообщит решение.\n"
        f"Повторная заявка будет доступна через "
        f"{TIME_REQUEST_COOLDOWN_MINUTES} минут.",
        reply_markup=get_menu(message.from_user.id)
    )


@router.message(
    StateFilter(TimeRequestForm.proof)
)
async def user_time_request_proof_invalid(
    message: Message,
    state: FSMContext
):
    if message.text == CANCEL_BUTTON:
        await state.clear()
        await message.answer(
            "🚫 Заявка отменена.",
            reply_markup=get_menu(message.from_user.id)
        )
        return

    await message.answer(
        "❌ Нужно отправить именно фотографию результата."
    )


# =========================================================
# ОБЩАЯ ОТМЕНА ВЫБОРА
# =========================================================

@router.message(
    StateFilter(
        TimeRequestForm.discipline,
        TimeRequestForm.track,
    ),
    F.text == CANCEL_BUTTON
)
async def user_time_request_cancel(
    message: Message,
    state: FSMContext
):
    await state.clear()

    await message.answer(
        "🚫 Заявка отменена.",
        reply_markup=get_menu(message.from_user.id)
    )


# =========================================================
# ПРИНЯТИЕ ЗАЯВКИ АДМИНИСТРАТОРОМ
# =========================================================

@router.callback_query(
    F.data.startswith("time_req_approve:")
)
async def admin_approve_time_request(
    callback: CallbackQuery
):
    if callback.from_user.id not in ADMIN_IDS:
        await callback.answer(
            "⛔ Доступ запрещён",
            show_alert=True
        )
        return

    try:
        request_id = int(
            callback.data.split(":", 1)[1]
        )
    except (ValueError, IndexError):
        await callback.answer(
            "Некорректный номер заявки.",
            show_alert=True
        )
        return

    request = await get_time_request(request_id)

    if not request:
        await callback.answer(
            "Заявка не найдена.",
            show_alert=True
        )
        return

    if request["status"] != "pending":
        await callback.answer(
            "Эта заявка уже обработана другим администратором.",
            show_alert=True
        )
        return

    acquired = await acquire_time_request(
        request_id,
        callback.from_user.id
    )

    if not acquired:
        await callback.answer(
            "Заявку уже обрабатывает другой администратор.",
            show_alert=True
        )
        return

    await callback.answer("Обрабатываю заявку...")

    lap_id = None
    rating_changes: dict[int, int] = {}

    try:
        discipline = request["discipline"]
        username = request["username"]
        selected_tid = request["telegram_id"]
        track = request["track"]
        lap_time_text = request["lap_time_text"]
        lap_time_ms = request["lap_time_ms"]

        lap_id = await add_lap(
            discipline=discipline,
            username=username,
            telegram_id=selected_tid,
            track=track,
            lap_time_text=lap_time_text,
            lap_time_ms=lap_time_ms,
        )

        try:
            await check_and_process_promotion(selected_tid, discipline, callback.bot)
            await check_achievements_after_lap(
                selected_tid, discipline, callback.bot, track=track, lap_time_ms=lap_time_ms,
            )
        except Exception:
            logger.exception("Ошибка турнирного движка после круга (заявка #%s)", request_id)

        # Рейтинг теперь начисляется только турнирным движком (переходы/ачивки) —
        # старое начисление за топ-3 лучшего времени за всё время убрано.
        # rating_changes остаётся пустым — откат ниже по коду безопасен как есть.

        await complete_time_request(
            request_id=request_id,
            status="approved",
            admin_id=callback.from_user.id,
            lap_id=lap_id,
        )

        await edit_admin_request_message(
            callback,
            "✅ <b>ЗАЯВКА ПРИНЯТА</b>\n"
            f"Администратор: <code>{callback.from_user.id}</code>\n"
            "Результат добавлен в таблицу."
        )

        try:
            await send_notifications(
                bot=callback.bot,
                discipline=discipline,
                new_username=username,
                lap_text=lap_time_text,
                selected_tid=selected_tid,
                track=track,
                group_id=GROUP_ID,
            )
        except Exception as exc:
            logger.exception(
                "Заявка #%s принята, но ошибка уведомлений: %s",
                request_id,
                exc,
            )

            # Сам результат уже успешно записан,
            # поэтому откатывать его из-за Telegram-уведомления нельзя.

        await callback.answer(
            "Время зафиксировано",
            show_alert=False
        )

    except Exception as exc:
        logger.exception(
            "Ошибка принятия заявки #%s: %s",
            request_id,
            exc,
        )

        # Если круг успел записаться — удаляем.
        if lap_id is not None:
            try:
                await delete_lap(lap_id)
            except Exception:
                logger.exception(
                    "Не удалось удалить круг %s после ошибки",
                    lap_id
                )

        # Возвращаем начисленный рейтинг.
        for pilot_tid, delta in rating_changes.items():
            try:
                await update_pilot_rating(
                    pilot_tid,
                    -delta
                )
            except Exception:
                logger.exception(
                    "Не удалось вернуть рейтинг пилоту %s",
                    pilot_tid
                )

        await restore_time_request_pending(
            request_id
        )

        await callback.answer(
            "Ошибка. Заявка возвращена на проверку.",
            show_alert=True
        )


# =========================================================
# ОТКЛОНЕНИЕ ЗАЯВКИ АДМИНИСТРАТОРОМ
# =========================================================

@router.callback_query(
    F.data.startswith("time_req_reject:")
)
async def admin_reject_time_request(
    callback: CallbackQuery
):
    if callback.from_user.id not in ADMIN_IDS:
        await callback.answer(
            "⛔ Доступ запрещён",
            show_alert=True
        )
        return

    try:
        request_id = int(
            callback.data.split(":", 1)[1]
        )
    except (ValueError, IndexError):
        await callback.answer(
            "Некорректный номер заявки.",
            show_alert=True
        )
        return

    request = await get_time_request(request_id)

    if not request:
        await callback.answer(
            "Заявка не найдена.",
            show_alert=True
        )
        return

    if request["status"] != "pending":
        await callback.answer(
            "Эта заявка уже обработана другим администратором.",
            show_alert=True
        )
        return

    acquired = await acquire_time_request(
        request_id,
        callback.from_user.id
    )

    if not acquired:
        await callback.answer(
            "Заявку уже обрабатывает другой администратор.",
            show_alert=True
        )
        return

    try:
        await complete_time_request(
            request_id=request_id,
            status="rejected",
            admin_id=callback.from_user.id,
        )

        await edit_admin_request_message(
            callback,
            "❌ <b>ЗАЯВКА ОТКЛОНЕНА</b>\n"
            f"Администратор: <code>{callback.from_user.id}</code>"
        )

        try:
            await callback.bot.send_message(
                request["telegram_id"],
                "❌ <b>Администратор отклонил вашу заявку</b> "
                "на установку времени.\n\n"
                f"🏆 Дисциплина: "
                f"<b>{html.escape(str(request['discipline']))}</b>\n"
                f"🗺 Трасса: "
                f"<b>{html.escape(str(request['track']))}</b>\n"
                f"⏱ Время: "
                f"<b>{html.escape(str(request['lap_time_text']))}</b>\n\n"
                "Проверьте фотографию результата и отправьте "
                "новую заявку после окончания ограничения."
            )
        except Exception as exc:
            logger.warning(
                "Не удалось уведомить пилота об отклонении "
                "заявки #%s: %s",
                request_id,
                exc,
            )

        await callback.answer(
            "Заявка отклонена"
        )

    except Exception as exc:
        logger.exception(
            "Ошибка отклонения заявки #%s: %s",
            request_id,
            exc,
        )

        await restore_time_request_pending(
            request_id
        )

        await callback.answer(
            "Ошибка. Заявка возвращена на проверку.",
            show_alert=True
        )
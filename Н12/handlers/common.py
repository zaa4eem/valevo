import re, logging
import asyncio
import html
from aiogram import Router, F
from aiogram.filters import Command, StateFilter
from aiogram.types import (
    Message, CallbackQuery, ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton,
)
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

from config import SUPPORT_CHAT_ID, ADMIN_IDS
from database.db import (
    create_pilot, get_pilot_by_telegram_id, get_pilot_history_stats, update_display_name,
    get_top10_pilots,
    create_support_message, get_support_message, claim_support_message_for_reply,
    release_support_message, complete_support_message,
    get_pilot_class, get_pilot_achievements,
)
from services.leaderboard import build_leaderboard
from keyboards.menu import get_menu
from keyboards.profile_menu import profile_menu
from services.phone_normalizer import normalize_phone_for_bot, normalize_phone_for_yclients
from services.yclients_auto import auto_sync_pilot_with_yclients
from services.levels import pilot_rank_info, pilot_rank_progress_bar, pilot_level, pilot_level_progress_bar
from services.tournament import month_bounds, live_class_score
from data.tournament import CLASS_LADDER, next_main_class
from services.achievements import CATALOG
from utils.message_style import DIVIDER

router = Router()
logger = logging.getLogger(__name__)

class Registration(StatesGroup):
    phone = State()

class ChangeNick(StatesGroup):
    nickname = State()

class SupportMessage(StatesGroup):
    waiting_for_text = State()

class SupportReply(StatesGroup):
    waiting_for_text = State()

def _plural_ru(value: int, one: str, few: str, many: str) -> str:
    value_abs = abs(int(value))
    if value_abs % 100 in (11, 12, 13, 14):
        return many
    last = value_abs % 10
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many


def format_minutes(total_minutes: float | int | None) -> str:
    """Форматирует минуты в читаемый вид.

    В БД поля bonus_mobile_minutes / bonus_static_minutes хранятся именно в минутах.
    Раньше они ошибочно передавались в форматтер часов, поэтому 2400 минут
    отображались как «2400 час» вместо «40 часов».
    """
    try:
        minutes = int(round(float(total_minutes or 0)))
    except (TypeError, ValueError):
        minutes = 0
    if minutes <= 0:
        return "0 минут"
    hours = minutes // 60
    mins = minutes % 60
    parts = []
    if hours:
        parts.append(f"{hours} {_plural_ru(hours, 'час', 'часа', 'часов')}")
    if mins:
        parts.append(f"{mins} {_plural_ru(mins, 'минута', 'минуты', 'минут')}")
    return " ".join(parts)


def format_hours(hours: float | int | None) -> str:
    """Форматирует часы в читаемый вид: 1.5 -> «1 час 30 минут»."""
    try:
        total_minutes = int(round(float(hours or 0) * 60))
    except (TypeError, ValueError):
        total_minutes = 0
    return format_minutes(total_minutes)


def format_phone_display(phone: str | None) -> str:
    """Красиво форматирует номер телефона: 89991234567 -> +7 999 123-45-67."""
    digits = re.sub(r"\D", "", str(phone or ""))
    if len(digits) == 11 and digits[0] in "78":
        return f"+7 {digits[1:4]} {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"
    return str(phone) if phone else "—"


def _registration_phone_keyboard() -> ReplyKeyboardMarkup:
    """Кнопка Telegram-контакта; ручной ввод номера тоже остаётся доступен."""
    return ReplyKeyboardMarkup(
        keyboard=[
            [
                KeyboardButton(
                    text="📱 Отправить мой номер",
                    request_contact=True,
                )
            ]
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
        input_field_placeholder="+7 999 000-00-00",
    )


async def _sync_new_pilot_with_yclients(
    telegram_id: int,
    phone_yclients: str,
    username: str,
) -> None:
    """
    Синхронизация идёт после успешной локальной регистрации.
    Ошибка/таймаут YCLIENTS не оставляет пользователя без ответа.
    """
    try:
        result = await auto_sync_pilot_with_yclients(
            telegram_id=telegram_id,
            phone=phone_yclients,
            username=username,
        )
        logger.info(
            "YCLIENTS registration sync: telegram_id=%s status=%s",
            telegram_id,
            result.get("status") if isinstance(result, dict) else result,
        )
    except Exception:
        logger.exception(
            "YCLIENTS registration sync failed: telegram_id=%s",
            telegram_id,
        )


# ---------- Команда /start ----------
@router.message(Command("start"))
async def start(message: Message, state: FSMContext):
    pilot = await get_pilot_by_telegram_id(message.from_user.id)

    if pilot:
        await message.answer(
            "🏁 Добро пожаловать обратно!",
            reply_markup=get_menu(message.from_user.id),
        )
        return

    username = (message.from_user.username or "").strip()
    if not username:
        await message.answer(
            "❌ Установите username в Telegram и повторите /start."
        )
        return

    await state.set_state(Registration.phone)
    await message.answer(
        "📱 <b>Регистрация пилота</b>\n\n"
        "Отправьте свой номер кнопкой ниже или введите его вручную.\n\n"
        "Поддерживаются форматы:\n"
        "• <code>89990000000</code>\n"
        "• <code>79990000000</code>\n"
        "• <code>+79990000000</code>\n"
        "• <code>+7 (999) 000-00-00</code>\n"
        "• <code>9990000000</code>",
        reply_markup=_registration_phone_keyboard(),
    )


# ---------- Регистрация ----------
@router.message(Registration.phone)
async def registration_phone(message: Message, state: FSMContext):
    # Кнопка Telegram присылает contact. При ручном вводе используется text.
    if message.contact:
        # Не разрешаем случайно зарегистрироваться по пересланному чужому контакту.
        if (
            message.contact.user_id is not None
            and message.contact.user_id != message.from_user.id
        ):
            await message.answer(
                "❌ Это номер другого Telegram-пользователя.\n"
                "Нажмите «📱 Отправить мой номер» или введите свой номер вручную.",
                reply_markup=_registration_phone_keyboard(),
            )
            return
        raw_phone = message.contact.phone_number or ""
    else:
        raw_phone = message.text or ""

    phone_bot = normalize_phone_for_bot(raw_phone)
    phone_yclients = normalize_phone_for_yclients(raw_phone)

    if not phone_bot or not phone_yclients:
        await message.answer(
            "❌ Не удалось распознать номер телефона.\n\n"
            "Примеры правильного ввода:\n"
            "• <code>89990000000</code>\n"
            "• <code>79990000000</code>\n"
            "• <code>+79990000000</code>\n"
            "• <code>+7 (999) 000-00-00</code>\n"
            "• <code>9990000000</code>\n\n"
            "Или нажмите кнопку «📱 Отправить мой номер».",
            reply_markup=_registration_phone_keyboard(),
        )
        return

    username = (message.from_user.username or "").strip()
    if not username:
        await state.clear()
        await message.answer(
            "❌ Username Telegram не найден. Установите username и повторите /start."
        )
        return

    # В БД VALEVO сохраняем единый формат 8XXXXXXXXXX.
    # Благодаря этому +7/7/8 не создают разные варианты одного номера.
    success, reason = await create_pilot(
        telegram_id=message.from_user.id,
        username=username,
        phone=phone_bot,
        yclients_client_id=None,
    )

    if not success:
        if reason == "phone_exists":
            await message.answer(
                "❌ Этот номер телефона уже используется другим пилотом."
            )
        elif reason == "username_exists":
            await message.answer(
                "❌ Этот username уже привязан к другому аккаунту."
            )
        else:
            logger.error(
                "Pilot registration failed: telegram_id=%s reason=%s",
                message.from_user.id,
                reason,
            )
            await message.answer(
                "❌ Не удалось создать профиль. Попробуйте ещё раз позже."
            )
        return

    # Профиль уже создан локально — сразу отвечаем пользователю.
    # YCLIENTS не должен блокировать регистрацию.
    await state.clear()

    await message.answer(
        "🏁 <b>Добро пожаловать в VALEVO!</b>\n\n"
        "Вы успешно зарегистрированы как пилот.\n"
        f"📱 Телефон: <code>{format_phone_display(phone_bot)}</code>\n\n"
        "🔄 Профиль синхронизируется с клубной системой автоматически — "
        "загляните в «👤 Профиль» через минуту.",
        reply_markup=get_menu(message.from_user.id),
    )

    # В YCLIENTS передаём нормализованный 7XXXXXXXXXX.
    asyncio.create_task(
        _sync_new_pilot_with_yclients(
            telegram_id=message.from_user.id,
            phone_yclients=phone_yclients,
            username=username,
        )
    )


# ---------- Таблица лидеров ----------
@router.message(F.text == "🏆 Таблица лидеров")
async def leaderboard_button(message: Message):
    try:
        text = await build_leaderboard()
        await message.answer(text)
    except Exception as e:
        logger.error(f"Leaderboard error: {e}")
        await message.answer("❌ Не удалось загрузить таблицу лидеров.")

# ---------- Профиль ----------
from services.yclients_service import get_client, get_client_total_hours, get_valevo_bonus_balance



async def _build_profile_text(user_id: int, fallback_username: str | None) -> str | None:
    pilot = await get_pilot_by_telegram_id(user_id)
    if not pilot:
        return None

    username = pilot.get("username") or fallback_username or "—"
    display_name = pilot.get("display_name") or f"@{username}"
    pilot_number = pilot.get("pilot_number")
    rating = pilot.get("rating") or 0

    history = await get_pilot_history_stats(telegram_id=user_id, username=username)

    rank, _ = pilot_rank_info(rating)
    rank_emoji, rank_title = rank[1], rank[2]

    header = (
        f"{rank_emoji} <b>{html.escape(display_name)}</b>"
        + (f"  <code>#{pilot_number}</code>" if pilot_number else "")
        + f"\n{rank_title} · рейтинг <b>{rating}</b> · уровень <b>{pilot_level(rating)}</b>/80\n"
        f"{pilot_rank_progress_bar(rating)}\n"
        f"{pilot_level_progress_bar(rating)}"
    )

    identity = (
        f"{DIVIDER}\n"
        f"🆔 Username: @{html.escape(username)}\n"
        f"📱 Телефон: <code>{format_phone_display(pilot.get('phone'))}</code>"
    )

    # Ошибка YCLIENTS больше не скрывает локальную историю и достижения.
    if pilot.get("yclients_client_id"):
        try:
            yclients_data = await get_client(pilot["yclients_client_id"])
            total_hours = await get_client_total_hours(pilot["yclients_client_id"])
            bonus_balance = await get_valevo_bonus_balance(pilot["yclients_client_id"])
            visits = yclients_data.get("visits", 0) if isinstance(yclients_data, dict) else 0
            club_block = (
                f"\n\n{DIVIDER}\n"
                "🏟 <b>КЛУБ</b>\n"
                f"📅 Визитов: <b>{visits}</b>\n"
                f"⏱ Время в клубе: <b>{format_hours(total_hours)}</b>\n"
                f"💎 Бонусный счёт: <b>{bonus_balance:.2f} ₽</b>"
            )
        except Exception as exc:
            logger.warning("YCLIENTS profile data unavailable for %s: %s", user_id, exc)
            club_block = (
                f"\n\n{DIVIDER}\n"
                "🏟 <b>КЛУБ</b>\n"
                "🔄 Клубные данные временно недоступны."
            )
    else:
        club_block = (
            f"\n\n{DIVIDER}\n"
            "🏟 <b>КЛУБ</b>\n"
            "🔄 Профиль синхронизируется с клубной системой автоматически."
        )

    achievements_lines = [
        f"{DIVIDER}",
        "🏆 <b>ДОСТИЖЕНИЯ</b>",
        (
            f"🥇 <b>{history['gold']}</b>   🥈 <b>{history['silver']}</b>   "
            f"🥉 <b>{history['bronze']}</b>   ·   {history['podiums']} на подиуме"
        ),
        f"📝 Результатов: <b>{history['total_results']}</b> в <b>{history['disciplines_count']}</b> дисциплинах",
    ]

    if history["favorite_discipline"]:
        achievements_lines.append(
            f"❤️ Любимая дисциплина: <b>{html.escape(str(history['favorite_discipline']))}</b> "
            f"({history['favorite_discipline_count']} рез.)"
        )
    if history["favorite_track"]:
        achievements_lines.append(
            f"🗺 Любимая трасса: <b>{html.escape(str(history['favorite_track']))}</b> "
            f"({history['favorite_track_count']} рез.)"
        )

    last_result = history.get("last_result")
    if last_result:
        last_date = str(last_result.get("created_at") or "")[:10]
        details = " · ".join(
            html.escape(value) for value in (
                str(last_result.get("discipline") or "").strip(),
                str(last_result.get("track") or "").strip(),
                str(last_result.get("lap_time_text") or "").strip(),
            ) if value
        )
        suffix = f" ({last_date})" if last_date else ""
        achievements_lines.append(f"🕘 Последний результат: <b>{details or '—'}</b>{suffix}")
    else:
        achievements_lines.append("🏁 Первый принятый круг станет началом истории пилота.")

    # ---------- Турнирная система v2: текущий класс и живой балл месяца ----------
    def _format_class_progress(result: dict) -> str:
        class_name = result["class_name"]
        threshold = CLASS_LADDER.get(class_name, {}).get("threshold")
        if not result["qualifies"]:
            return (
                f"🏎 <b>{html.escape(class_name)}</b>: {result['starts']}/{result['min_starts']} стартов"
            )
        score = result["score"]
        if threshold is not None and score is not None and score >= threshold:
            return f"🏎 <b>{html.escape(class_name)}</b>: <b>{score}</b> баллов — готов к переходу! 🚀"
        if threshold is not None:
            return f"🏎 <b>{html.escape(class_name)}</b>: <b>{score}</b> баллов (нужно {threshold} для перехода)"
        return f"🏎 <b>{html.escape(class_name)}</b>: <b>{score}</b> баллов"

    current_class = await get_pilot_class(user_id)
    month_key, start_iso, end_iso = month_bounds()
    class_result = await live_class_score(user_id, current_class, month_key, start_iso, end_iso)

    side_class = next(
        (name for name, cfg in CLASS_LADDER.items() if cfg.get("side_of") == current_class),
        None,
    )

    class_lines = [
        f"{DIVIDER}",
        "🏎 <b>ТЕКУЩИЙ КЛАСС</b>",
        _format_class_progress(class_result),
    ]

    if side_class:
        side_result = await live_class_score(user_id, side_class, month_key, start_iso, end_iso)
        class_lines.append(_format_class_progress(side_result))

    next_class = next_main_class(current_class)
    if next_class:
        class_lines.append(f"➡️ Следующий класс: <b>{html.escape(next_class)}</b>")
    else:
        class_lines.append("🏁 Максимальный класс")

    # ---------- Достижения турнирной системы v2 ----------
    unlocked_codes = await get_pilot_achievements(user_id)
    achievements2_lines = [f"{DIVIDER}", "🎖 <b>ДОСТИЖЕНИЯ</b>"]
    if unlocked_codes:
        badge_labels = [
            f"{emoji} {html.escape(title)}"
            for code, (emoji, title, _desc, _reward) in CATALOG.items()
            if code in unlocked_codes
        ]
        achievements2_lines.append(f"Открыто: <b>{len(badge_labels)}/{len(CATALOG)}</b>")
        grouped_labels = [
            "   ".join(badge_labels[i:i + 2]) for i in range(0, len(badge_labels), 2)
        ]
        achievements2_lines.append("\n".join(grouped_labels))
    else:
        achievements2_lines.append("Пока нет открытых достижений — начните с первого заезда!")

    return "\n".join([
        header,
        identity + club_block,
        "\n".join(achievements_lines),
        "\n".join(class_lines),
        "\n".join(achievements2_lines),
    ])


@router.message(F.text == "👤 Профиль")
async def profile(message: Message, state: FSMContext):
    try:
        text = await _build_profile_text(message.from_user.id, message.from_user.username)
        if text is None:
            await message.answer("❌ Профиль не найден. Используйте /start.")
            return
        await message.answer(text, reply_markup=profile_menu)
    except Exception as e:
        logger.exception("Profile error: %s", e)
        await message.answer("❌ Ошибка при загрузке профиля.")


@router.callback_query(F.data == "refresh_profile")
async def refresh_profile(callback: CallbackQuery):
    try:
        text = await _build_profile_text(callback.from_user.id, callback.from_user.username)
        if text is None:
            await callback.answer("Профиль не найден", show_alert=True)
            return
        try:
            await callback.message.edit_text(text, reply_markup=profile_menu)
            await callback.answer("Обновлено")
        except Exception:
            # Текст не изменился с прошлого обновления — Telegram запрещает
            # редактирование сообщения "в то же самое".
            await callback.answer("Данные актуальны")
    except Exception as e:
        logger.exception("Refresh profile error: %s", e)
        await callback.answer("Не удалось обновить профиль", show_alert=True)

# ---------- Информация ----------
@router.message(F.text == "❓ Информация")
async def info(message: Message):
    text = (
        "🏁 <b>ВАЛЕВО сим рейсинг клуб</b>\n"
        f"{DIVIDER}\n\n"
        "Клуб автосимуляторов, где вы можете оказаться за рулём "
        "любого автомобиля и ощутить максимально реалистичные эмоции!\n\n"
        f"{DIVIDER}\n"
        "📘 <b>КОНТАКТЫ</b>\n"
        "☎️ <code>+7 993 950-12-51</code>\n"
        "✈️ Telegram: @ValevoRostov\n"
        "📢 Канал: @ValevoRND\n"
        "📸 Запретграм: @valovo_simclub\n\n"
        f"{DIVIDER}\n"
        "📍 <b>АДРЕС</b>\n"
        "ул. Баумана, 72"
    )
    await message.answer(text)

# ---------- Команда /leaderboard ----------
@router.message(Command("leaderboard"))
async def leaderboard_cmd(message: Message):
    await leaderboard_button(message)

# ---------- Смена ника ----------
@router.callback_query(F.data == "change_nick")
async def change_nick(callback: CallbackQuery, state: FSMContext):
    await state.set_state(ChangeNick.nickname)
    await state.update_data(
        prompt_chat_id=callback.message.chat.id,
        prompt_message_id=callback.message.message_id,
    )
    await callback.message.edit_text("✏️ Введите новый ник:")

BAD_NICK_PARTS = [
    "http", "https", "www", ".ru", ".com", ".gg", ".net",
    "t.me", "telegram", "discord", "vk.com", "@"
]

VALID_NICK_RE = re.compile(r"^[a-zA-Zа-яА-ЯёЁ0-9_ \-]+$")

def sanitize_pilot_name(name: str) -> str | None:

    if not name:
        return None

    name = str(name).strip()

    lower = name.lower()

    for bad in BAD_NICK_PARTS:
        if bad in lower:
            return None

    # запрет emoji / спецсимволов
    if not VALID_NICK_RE.fullmatch(name):
        return None

    name = re.sub(r"\s+", " ", name).strip()

    # длина
    name = name[:16]

    if len(name) < 2:
        return None

    return name

@router.message(ChangeNick.nickname)
async def set_nick(message: Message, state: FSMContext):
    data = await state.get_data()
    prompt_chat_id = data.get("prompt_chat_id")
    prompt_message_id = data.get("prompt_message_id")
    await state.clear()

    async def show(text: str, reply_markup=None) -> None:
        if prompt_chat_id and prompt_message_id:
            try:
                await message.bot.edit_message_text(
                    text,
                    chat_id=prompt_chat_id,
                    message_id=prompt_message_id,
                    reply_markup=reply_markup,
                )
                return
            except Exception:
                pass
        await message.answer(text, reply_markup=reply_markup)

    nickname = sanitize_pilot_name(message.text)

    if not nickname:
        await show(
            "❌ Некорректный ник.\n\n"
            "Разрешены только буквы, цифры, пробел, дефис и нижнее подчёркивание.\n"
            "Ссылки, реклама, emoji и спецсимволы запрещены."
        )
        return

    success = await update_display_name(message.from_user.id, nickname)

    if not success:
        await show("❌ Этот никнейм уже занят другим пилотом.")
        return

    text = await _build_profile_text(message.from_user.id, message.from_user.username)
    if text is None:
        await show("✅ Никнейм обновлён!")
    else:
        await show(text, profile_menu)

# ---------- Поддержка ----------
@router.message(F.text == "📩 Сообщить в поддержку")
async def support_start(message: Message, state: FSMContext):
    await state.set_state(SupportMessage.waiting_for_text)
    kb = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="🔙 Назад")]],
        resize_keyboard=True
    )
    await message.answer(
        f"📩 <b>ПОДДЕРЖКА ВАЛЕВО</b>\n{DIVIDER}\n\n"
        "Напишите о баге или предложении по работе бота одним сообщением.\n\n"
        "Разработчик обязательно заедет на пит-стоп и разберётся с вашим обращением! 🤝",
        reply_markup=kb
    )

def _support_admin_keyboard(support_message_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✉️ Ответить", callback_data=f"support:reply:{support_message_id}")]
        ]
    )


def _support_reply_prompt_keyboard(support_message_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data=f"support:cancel:{support_message_id}")]
        ]
    )


@router.message(SupportMessage.waiting_for_text, F.text != "🔙 Назад")
async def handle_support_message(message: Message, state: FSMContext, bot):
    text = message.text or ""
    username = message.from_user.username
    user_info = f"Обращение от @{username or 'нет юзернейма'} (ID: {message.from_user.id})"
    try:
        support_message_id = await create_support_message(message.from_user.id, username, text)
        await bot.send_message(
            SUPPORT_CHAT_ID,
            f"{user_info}\n\n{html.escape(text)}",
            reply_markup=_support_admin_keyboard(support_message_id),
        )
        await message.answer("✅ Ваше обращение отправлено разработчику. Спасибо!")
    except Exception as e:
        logger.error(f"Ошибка отправки обращения: {e}")
        await message.answer("❌ Не удалось отправить обращение. Попробуйте позже.")
    finally:
        await state.clear()
        await message.answer("Главное меню:", reply_markup=get_menu(message.from_user.id))

@router.message(SupportMessage.waiting_for_text, F.text == "🔙 Назад")
async def support_back(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("Главное меню:", reply_markup=get_menu(message.from_user.id))


# ---------- Ответ разработчика на обращение (анонимно) ----------
@router.callback_query(F.data.startswith("support:reply:"))
async def support_reply_start(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS:
        await callback.answer("Нет доступа", show_alert=True)
        return

    support_message_id = int(callback.data.rsplit(":", 1)[1])
    if not await claim_support_message_for_reply(support_message_id, callback.from_user.id):
        await callback.answer("Уже отвечает другой администратор", show_alert=True)
        return

    await callback.answer()
    original_chat_id = callback.message.chat.id
    original_message_id = callback.message.message_id
    try:
        await callback.message.edit_reply_markup(reply_markup=None)
    except Exception:
        pass

    prompt = await callback.message.answer(
        "✏️ Напишите ответ клиенту — он придёт от имени поддержки ВАЛЕВО, без вашего имени.",
        reply_markup=_support_reply_prompt_keyboard(support_message_id),
    )
    await state.set_state(SupportReply.waiting_for_text)
    await state.update_data(
        support_message_id=support_message_id,
        prompt_chat_id=prompt.chat.id,
        prompt_message_id=prompt.message_id,
        original_chat_id=original_chat_id,
        original_message_id=original_message_id,
    )


def _support_original_text(support_message: dict) -> str:
    username = support_message.get("username")
    header = f"Обращение от @{username or 'нет юзернейма'} (ID: {support_message['telegram_id']})"
    return f"{header}\n\n{html.escape(support_message.get('message_text') or '')}"


@router.callback_query(F.data.startswith("support:cancel:"))
async def support_reply_cancel(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS:
        await callback.answer("Нет доступа", show_alert=True)
        return

    support_message_id = int(callback.data.rsplit(":", 1)[1])
    data = await state.get_data()
    original_chat_id = data.get("original_chat_id")
    original_message_id = data.get("original_message_id")

    await release_support_message(support_message_id)
    await state.clear()
    await callback.answer("Отменено")
    try:
        await callback.message.edit_text("Ответ отменён.")
    except Exception:
        pass

    if original_chat_id and original_message_id:
        try:
            await callback.bot.edit_message_reply_markup(
                chat_id=original_chat_id,
                message_id=original_message_id,
                reply_markup=_support_admin_keyboard(support_message_id),
            )
        except Exception:
            pass


@router.message(SupportReply.waiting_for_text)
async def support_reply_text(message: Message, state: FSMContext):
    data = await state.get_data()
    support_message_id = data.get("support_message_id")
    prompt_chat_id = data.get("prompt_chat_id")
    prompt_message_id = data.get("prompt_message_id")
    original_chat_id = data.get("original_chat_id")
    original_message_id = data.get("original_message_id")
    await state.clear()

    async def show(text: str) -> None:
        if prompt_chat_id and prompt_message_id:
            try:
                await message.bot.edit_message_text(
                    text, chat_id=prompt_chat_id, message_id=prompt_message_id, reply_markup=None,
                )
                return
            except Exception:
                pass
        await message.answer(text)

    support_message = await get_support_message(support_message_id) if support_message_id else None
    if not support_message:
        await show("❌ Заявка не найдена — возможно, её уже удалили.")
        return

    reply_text = message.text or ""
    try:
        await message.bot.send_message(
            support_message["telegram_id"],
            "💬 <b>Ответ от поддержки ВАЛЕВО</b>\n" + DIVIDER + "\n\n" + html.escape(reply_text),
        )
    except Exception as exc:
        logger.warning("Не удалось отправить ответ клиенту %s: %s", support_message["telegram_id"], exc)
        await show("❌ Не удалось доставить ответ клиенту (возможно, он заблокировал бота).")
        return

    await complete_support_message(support_message_id, message.from_user.id, reply_text)
    await show("✅ Ответ отправлен клиенту.")

    if original_chat_id and original_message_id:
        try:
            await message.bot.edit_message_text(
                _support_original_text(support_message) + "\n\n✅ <b>Отвечено</b>",
                chat_id=original_chat_id,
                message_id=original_message_id,
            )
        except Exception:
            pass

# ---------- ТОП-10 ----------
@router.message(F.text == "🏆 ТОП-10")
async def top10(message: Message):
    try:
        pilots = await get_top10_pilots()
        if not pilots:
            await message.answer("🏆 В клубе ещё нет пилотов с рейтингом.")
            return

        medals = ["🥇", "🥈", "🥉"] + [f"{i}." for i in range(4, 11)]
        lines = [f"🏆 <b>ТОП-10 ПИЛОТОВ</b>", DIVIDER, ""]
        for i, p in enumerate(pilots):
            name = html.escape(p["display_name"] or f'@{p["username"]}')
            number = f" <code>#{p['pilot_number']}</code>" if p.get("pilot_number") else ""
            lines.append(f"{medals[i]} <b>{name}</b>{number} — <b>{p['rating']}</b>")
        await message.answer("\n".join(lines))
    except Exception as e:
        logger.error(f"Ошибка ТОП-10: {e}")
        await message.answer("❌ Не удалось загрузить рейтинг.")

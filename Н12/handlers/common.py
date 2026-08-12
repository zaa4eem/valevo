import re, logging
import asyncio
import html
from aiogram import Router, F
from aiogram.filters import Command, StateFilter
from aiogram.types import Message, CallbackQuery, ReplyKeyboardMarkup, KeyboardButton
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext

from config import SUPPORT_CHAT_ID
from database.db import (
    create_pilot, get_pilot_by_telegram_id, get_pilot_history_stats, update_display_name,
    get_top10_pilots
)
from services.leaderboard import build_leaderboard
from keyboards.menu import get_menu
from keyboards.profile_menu import profile_menu
from services.phone_normalizer import normalize_phone_for_bot, normalize_phone_for_yclients
from services.yclients_auto import auto_sync_pilot_with_yclients

router = Router()
logger = logging.getLogger(__name__)

class Registration(StatesGroup):
    phone = State()

class ChangeNick(StatesGroup):
    nickname = State()

class SupportMessage(StatesGroup):
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


# ---------- Ранги пилота ----------
# (порог рейтинга, эмодзи, название ранга)
PILOT_RANKS: list[tuple[int, str, str]] = [
    (0, "🔰", "Новичок"),
    (20, "🏎", "Гонщик"),
    (50, "🥉", "Профи"),
    (100, "🥈", "Ас трассы"),
    (200, "🥇", "Чемпион"),
    (400, "💎", "Легенда VALEVO"),
]


def pilot_rank_info(rating: int | float | None) -> tuple[tuple[int, str, str], tuple[int, str, str] | None]:
    """Возвращает (текущий_ранг, следующий_ранг) по рейтингу пилота."""
    rating_value = max(0, int(rating or 0))
    current = PILOT_RANKS[0]
    next_rank: tuple[int, str, str] | None = None
    for index, rank in enumerate(PILOT_RANKS):
        if rating_value >= rank[0]:
            current = rank
            next_rank = PILOT_RANKS[index + 1] if index + 1 < len(PILOT_RANKS) else None
        else:
            break
    return current, next_rank


def pilot_rank_progress_bar(rating: int | float | None, width: int = 10) -> str:
    """Прогресс-бар до следующего ранга: ▰▰▰▰▰▱▱▱▱▱."""
    rating_value = max(0, int(rating or 0))
    current, next_rank = pilot_rank_info(rating_value)

    if next_rank is None:
        return "▰" * width + " (макс. уровень)"

    span = next_rank[0] - current[0]
    done = rating_value - current[0]
    fraction = max(0.0, min(1.0, done / span)) if span > 0 else 1.0
    filled = round(fraction * width)

    bar = "▰" * filled + "▱" * (width - filled)
    points_left = next_rank[0] - rating_value
    return f"{bar}  ещё {points_left} до «{next_rank[1]} {next_rank[2]}»"

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

DIVIDER = "━━━━━━━━━━━━━━━━━━"


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
        + f"\n{rank_title} · рейтинг <b>{rating}</b>\n"
        f"{pilot_rank_progress_bar(rating)}"
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

    return "\n".join([header, identity + club_block, "\n".join(achievements_lines)])


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
    nickname = sanitize_pilot_name(message.text)

    if not nickname:
        await message.answer(
            "❌ Некорректный ник.\n\n"
            "Разрешены только буквы, цифры, пробел, дефис и нижнее подчёркивание.\n"
            "Ссылки, реклама, emoji и спецсимволы запрещены."
        )
        return

    success = await update_display_name(message.from_user.id, nickname)

    if not success:
        await message.answer("❌ Этот никнейм уже занят другим пилотом.")
    else:
        await message.answer("✅ Никнейм обновлён!")

    await state.clear()

# ---------- Поддержка ----------
@router.message(F.text == "📩 Сообщить в поддержку")
async def support_start(message: Message, state: FSMContext):
    await state.set_state(SupportMessage.waiting_for_text)
    kb = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="🔙 Назад")]],
        resize_keyboard=True
    )
    await message.answer(
        "🏁 ВАЛЕВО автоответчик приветствует вас!\n\n"
        "📤 Что бы передать информацию о баге или предложение для улучшения работы бота напишите это в чат.\n\n"
        "Разработчик обязательно заедет на пит-стоп и проанализирует ваше обращение! 🤝",
        reply_markup=kb
    )

@router.message(SupportMessage.waiting_for_text, F.text != "🔙 Назад")
async def handle_support_message(message: Message, state: FSMContext, bot):
    user_info = f"Обращение от @{message.from_user.username or 'нет юзернейма'} (ID: {message.from_user.id})"
    try:
        await bot.send_message(
            SUPPORT_CHAT_ID,
            f"{user_info}\n\n{html.escape(message.text or '')}"
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

import re


def normalize_phone_for_bot(phone: str) -> str | None:
    """
    Формат для БД бота:
    89889473802
    """
    if not phone:
        return None

    digits = re.sub(r"\D", "", str(phone))

    if len(digits) == 11 and digits.startswith("8"):
        return digits

    if len(digits) == 11 and digits.startswith("7"):
        return "8" + digits[1:]

    if len(digits) == 10:
        return "8" + digits

    return None


def normalize_phone_for_yclients(phone: str) -> str | None:
    """
    Формат для YCLIENTS:
    79889473802
    """
    bot_phone = normalize_phone_for_bot(phone)

    if not bot_phone:
        return None

    return "7" + bot_phone[1:]


def normalize_phone(phone: str) -> str | None:
    """
    Старое имя функции оставляем для совместимости.
    По умолчанию возвращает формат бота: 8XXXXXXXXXX
    """
    return normalize_phone_for_bot(phone)
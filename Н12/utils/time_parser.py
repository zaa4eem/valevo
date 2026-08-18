import re

# Минуты и миллисекунды не обязаны быть строго двузначными/трёхзначными —
# "1:18.565", "1:18.56" и "01:18.565" должны парситься одинаково. Раньше
# формат был жёстко \d{2}:\d{2}\.\d{3} — любое время короче 10 минут с одной
# цифрой минут (то есть почти любой реальный круг) отклонялось как невалидное.
TIME_PATTERN = re.compile(r"^(\d{1,3}):(\d{1,2})[.,](\d{1,3})$")


def time_to_ms(time_str: str) -> int:

    if not isinstance(time_str, str):
        raise ValueError("TIME MUST BE STRING")

    time_str = time_str.strip()

    match = TIME_PATTERN.fullmatch(time_str)
    if not match:
        raise ValueError("INVALID_TIME_FORMAT")

    minutes_text, seconds_text, millis_text = match.groups()

    minutes = int(minutes_text)
    seconds = int(seconds_text)
    millis = int(millis_text.ljust(3, "0")[:3])

    if seconds > 59:
        raise ValueError("INVALID_SECONDS")

    total_ms = (
        minutes * 60000
        + seconds * 1000
        + millis
    )

    return total_ms

import re


def time_to_ms(time_str: str) -> int:

    """
    Формат:
    01:18.565
    """

    time_str = time_str.strip()

    # Проверка формата

    if not re.fullmatch(
        r"\d{2}:\d{2}\.\d{3}",
        time_str
    ):

        raise ValueError(
            "INVALID_TIME_FORMAT"
        )

    minutes, rest = time_str.split(":")

    seconds, millis = rest.split(".")

    total_ms = (
        int(minutes) * 60000
        + int(seconds) * 1000
        + int(millis)
    )

    return total_ms
import re


TIME_PATTERN = re.compile(
    r"^\d{2}:\d{2}\.\d{3}$"
)


def time_to_ms(time_str: str) -> int:

    if not isinstance(time_str, str):
        raise ValueError("TIME MUST BE STRING")

    time_str = time_str.strip()

    if not TIME_PATTERN.fullmatch(time_str):
        raise ValueError("INVALID_TIME_FORMAT")

    minutes, rest = time_str.split(":")
    seconds, millis = rest.split(".")

    minutes = int(minutes)
    seconds = int(seconds)
    millis = int(millis)

    if seconds > 59:
        raise ValueError("INVALID_SECONDS")

    total_ms = (
        minutes * 60000
        + seconds * 1000
        + millis
    )

    return total_ms
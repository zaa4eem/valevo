import pytest

from utils.score_parser import (
    format_result_text,
    is_score_discipline,
    parse_result,
    parse_score,
    score_from_ms,
)


@pytest.mark.parametrize("raw,text", [
    ("100", "100.0"), ("100.0", "100.0"), ("98.6", "98.6"), ("98,6", "98.6"),
    ("56.9", "56.9"), ("0", "0.0"), ("56.95", "56.95"), (" 77.7 ", "77.7"),
])
def test_parse_score_valid(raw, text):
    assert parse_score(raw)[0] == text


@pytest.mark.parametrize("raw", [
    "101", "100.1", "-5", "abc", "", "98.6.1", "1:18.565", "98.655", "1e2", "١٠٠",
])
def test_parse_score_invalid(raw):
    with pytest.raises(ValueError):
        parse_score(raw)


def test_better_score_gives_smaller_ms_and_roundtrips():
    scores = ["56.9", "98.6", "100.0", "77", "0"]
    ordered = sorted(scores, key=lambda v: parse_score(v)[1])
    assert ordered == ["100.0", "98.6", "77", "56.9", "0"]
    for value in scores:
        text, ms = parse_score(value)
        assert ms > 0
        assert score_from_ms(ms) == float(text)


def test_discipline_routing():
    assert is_score_discipline("Week CUP") and is_score_discipline(" weekcup ")
    assert not is_score_discipline("MX-5") and not is_score_discipline(None)
    assert parse_result("Week CUP", "98,6") == ("98.6", 901400)
    assert parse_result("MX-5", " 01:18.565 ") == ("01:18.565", 78565)
    with pytest.raises(ValueError):
        parse_result("MX-5", "98.6")          # время в обычной дисциплине — по-прежнему только мм:сс.мс
    with pytest.raises(ValueError):
        parse_result("Week CUP", "01:18.565")  # и наоборот


def test_report_suffix():
    assert format_result_text("98.6") == "98.6 б."
    assert format_result_text("01:18.565") == "01:18.565"
    assert format_result_text("—") == "—"

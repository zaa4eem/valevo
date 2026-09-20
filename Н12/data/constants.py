# Лестница классов турнира v3: MX-5 -> GT500 (+доп. F4/ALL) -> DTM (+доп. Touge) -> GT3.
# Должно совпадать с MAIN_SEQUENCE/SIDE_DISCIPLINES из data/tournament.py — иначе
# кнопки «Установить время» в боте расходятся с реальной турнирной структурой
# (как раньше с устаревшим BTCC). Сами дисциплины/трассы остаются редактируемыми
# как и раньше (админ может добавить/убрать трассу) — здесь только начальный
# набор при первом запуске.
DISCIPLINES = [
    "MX-5",
    "GT500",
    "F4/ALL",
    "DTM",
    "Touge",
    "GT3",
    "Week CUP",
]

TRACKS = {

    "MX-5": [
        "Suzuka West"
    ],

    "GT500": [],

    "F4/ALL": [],

    "GT3": [
        "Silverstone GP"
    ],

    "DTM": [
        "AKAGI"
    ],

    "Touge": [],

    "Week CUP": [
        "Nürburgring GP"
    ]
}
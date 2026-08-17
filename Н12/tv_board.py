import html
import json
import logging
import sqlite3
from pathlib import Path
from datetime import datetime

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import BASE_DIR, DB_NAME
from services.tournament import month_bounds, rank_month_overall
from database.db import get_pilot_by_telegram_id

# Используем те же пути, что и основной бот (config.py), а не путь относительно
# текущей рабочей директории — иначе TV-board, запущенный из другой папки/сервиса,
# молча открывает пустую/несуществующую БД.
DB_PATH = Path(DB_NAME)
STATIC_DIR = BASE_DIR / "static"
BOT_USERNAME = "@VALEVO_RND_BOT"
PORT = 8010

STATIC_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Valevo TV Board")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# Обновлено под лестницу турнира v2 (MX-5 -> BTCC(+DTM) -> GT500(+Touge) -> GT3).
# Все 7 пунктов (включая доп.дисциплины DTM и Touge) крутятся в общей карусели
# (фиксированную левую колонку занимает не одна из дисциплин, а общий зачёт
# турнира — см. FIXED_TOP_ITEM и renderBoard). Порядок — строго по лестнице
# (MX-5 первым как этап 1, доп.дисциплина сразу после своего основного класса),
# согласовано макетом. stage/stage_type определяют плашку над колонкой:
# "main" — цифра этапа, "side" — доп.этап, "event" — вне лестницы (Week CUP).
# Меняя количество пунктов здесь, обязательно пересчитай @keyframes
# carouselStep и --cycle-time ниже — они настроены именно на 7 шагов.
DISPLAY_ORDER = [
    {"key": "MX-5", "aliases": ["MX-5", "MX5", "MIATA"], "title": "MX-5", "subtitle": "Suzuka West",
     "stage": "Этап 1", "stage_type": "main"},
    {"key": "BTCC", "aliases": ["BTCC"], "title": "BTCC", "subtitle": "Silverstone",
     "stage": "Этап 2", "stage_type": "main"},
    {"key": "DTM", "aliases": ["DTM"], "title": "DTM", "subtitle": "AKAGI",
     "stage": "Доп. этап", "stage_type": "side"},
    {"key": "GT500", "aliases": ["GT500", "GT-500"], "title": "GT500", "subtitle": "",
     "stage": "Этап 3", "stage_type": "main"},
    {"key": "Touge", "aliases": ["TOUGE", "TOGUE"], "title": "Touge", "subtitle": "",
     "stage": "Доп. этап", "stage_type": "side"},
    {"key": "GT3", "aliases": ["GT3", "GT-3", "GT4", "GT-4"], "title": "GT3", "subtitle": "Silverstone GP",
     "stage": "Этап 4", "stage_type": "main"},
    {"key": "WEEK CUP", "aliases": ["WEEK CUP", "WEEKCUP", "WEEK", "WEEK_CUP"], "title": "Week CUP",
     "subtitle": "LMU | Hyper BMW | Sebring circuit", "stage": "Отдельный кубок", "stage_type": "event"},
]

CAROUSEL_DUPLICATES = 4
CAROUSEL_HOLD_MS = 10000
CAROUSEL_MOVE_MS = 1200
DATA_REFRESH_MS = 30000


HTML_TEMPLATE = r"""
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>VALEVO LIVE LEADERBOARD</title>

<style>
*{box-sizing:border-box}

:root{
    --cyan:#4ac6c9;
    --cyan2:#56e2e5;
    --bg:#030707;
    --white:#f4f1e8;
    --line:rgba(74,198,201,.72);
    --gold:#ffcc33;
    --gold2:#ffdf75;
    --silver:#d7dee8;
    --bronze:#cd7f32;
}

html,body{
    margin:0;
    width:100%;
    height:100%;
    overflow:hidden;
    background:var(--bg);
    font-family:Arial, Helvetica, sans-serif;
    color:var(--white);
}

body{
    background:
        radial-gradient(circle at 12% 14%, rgba(74,198,201,.22), transparent 31%),
        radial-gradient(circle at 88% 6%, rgba(74,198,201,.14), transparent 27%),
        linear-gradient(135deg,#020405,#081012 52%,#020405);
}

body::before{
    content:"";
    position:fixed;
    inset:-80px;
    pointer-events:none;
    background:
        linear-gradient(135deg,transparent 0 47%,rgba(74,198,201,.11) 47% 53%,transparent 53% 100%);
    background-size:126px 126px;
    opacity:.22;
    transform:skewX(-18deg);
}

body::after{
    content:"";
    position:fixed;
    inset:0;
    pointer-events:none;
    background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px);
    background-size:100% 5px;
    opacity:.12;
}

.wrap{
    position:relative;
    z-index:2;
    height:100vh;
    min-height:100vh;
    padding:24px 30px 16px;
    display:flex;
    flex-direction:column;
    gap:14px;
}

.header{
    height:126px;
    flex:0 0 126px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    position:relative;
    overflow:visible;
}

.logo-wrap{
    height:118px;
    display:flex;
    align-items:center;
    min-width:0;
}

.logo-img{
    height:100%;
    width:auto;
    object-fit:contain;
    filter:drop-shadow(0 0 24px rgba(74,198,201,.20));
    user-select:none;
    pointer-events:none;
}

.qrbox{
    width:420px;
    height:110px;
    border:3px solid rgba(74,198,201,.82);
    border-radius:20px;
    display:flex;
    align-items:center;
    gap:18px;
    padding:14px 16px;
    background:linear-gradient(180deg,rgba(5,16,18,.82),rgba(0,0,0,.45));
    box-shadow:
        0 0 26px rgba(74,198,201,.14),
        inset 0 0 22px rgba(74,198,201,.06);
}

.qr{
    width:84px;
    height:84px;
    background:white;
    border-radius:14px;
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    flex:0 0 84px;
}

.qr img{
    width:100%;
    height:100%;
    object-fit:cover;
}

.qrtext{
    min-width:0;
    font-size:24px;
    font-weight:1000;
    color:var(--cyan);
    line-height:1.08;
    text-shadow:0 0 14px rgba(74,198,201,.18);
}

.qrtext span{
    display:block;
    margin-top:7px;
    font-size:15px;
    line-height:1.2;
    color:rgba(244,241,232,.82);
    font-weight:800;
}

.board{
    flex:1 1 auto;
    min-height:0;
    display:grid;
    grid-template-columns:54px minmax(260px,28%) minmax(0,1fr);
    gap:10px;
    align-items:start;
    position:relative;
    overflow:visible;
}

.qr-cat-static{
    position:absolute;
    right:438px;
    top:42px;
    z-index:9999;
    pointer-events:none;
    opacity:0;
    visibility:hidden;
    animation:qrCatAppear 60s linear infinite;
}

.qr-cat-static img{
    width:62px;
    height:auto;
    image-rendering:pixelated;
    animation:qrCatJump .7s ease-in-out infinite;
}

@keyframes qrCatAppear{
    0%{
        opacity:1;
        visibility:visible;
    }

    33.3%{
        opacity:1;
        visibility:visible;
    }

    33.4%{
        opacity:0;
        visibility:hidden;
    }

    100%{
        opacity:0;
        visibility:hidden;
    }
}

@keyframes qrCatJump{
    0%{
        transform:translateY(0);
    }

    50%{
        transform:translateY(-6px);
    }

    100%{
        transform:translateY(0);
    }
}

.ranks{
    padding-top:104px;
}

.rank{
    height:52px;
    display:flex;
    align-items:center;
    justify-content:center;
    border:3px solid rgba(74,198,201,.76);
    border-radius:13px;
    font-size:28px;
    font-weight:1000;
    background:rgba(0,0,0,.38);
    box-shadow:
        0 0 16px rgba(74,198,201,.12),
        inset 0 0 18px rgba(74,198,201,.10);
}

.fixed-col{
    min-width:0;
}

.carousel-viewport{
    min-width:0;
    height:670px;
    overflow:hidden;
    position:relative;
    border:3px solid rgba(74,198,201,.88);
    border-radius:20px;
    background:linear-gradient(180deg,rgba(5,16,18,.88),rgba(1,5,6,.84));
    box-shadow:
        0 0 30px rgba(74,198,201,.16),
        inset 0 0 30px rgba(74,198,201,.07);
}

/* Полоса с плашкой этапа над заголовком колонки — общая высота колонки/вьюпорта
   выросла ровно на её высоту (624px -> 670px), сам .head и .rows ниже не
   трогали, чтобы старый вид не сдвинулся и не изменился. У фиксированной
   колонки ("Общий зачёт") плашка пустая — просто резервирует то же место,
   чтобы обе колонки остались одной высоты. */
.badge-row{
    height:46px;
    display:flex;
    align-items:center;
    justify-content:center;
}

.stage-badge{
    font-size:14px;
    font-weight:1000;
    letter-spacing:.4px;
    text-transform:uppercase;
    font-style:italic;
    padding:5px 16px;
    border-radius:999px;
    line-height:1;
}

.stage-badge--main{
    color:#04211f;
    background:linear-gradient(180deg,var(--cyan2),var(--cyan));
    box-shadow:0 0 14px rgba(74,198,201,.35);
}

.stage-badge--side{
    color:#2a1600;
    background:linear-gradient(180deg,#ffcf8a,#ffb454);
    box-shadow:0 0 14px rgba(255,180,84,.30);
}

.stage-badge--event{
    color:rgba(244,241,232,.75);
    background:transparent;
    border:2px solid rgba(244,241,232,.4);
}

.carousel-track{
    --col-w:370px;
    --cycle-time:78.4s;

    height:100%;
    display:flex;
    gap:0;
    width:max-content;

    transform:translate3d(0,0,0);
    will-change:transform;

    animation:carouselStep var(--cycle-time) cubic-bezier(.22,.9,.22,1) infinite;
}

.col{
    width:370px;
    min-width:370px;
    max-width:370px;
    height:670px;
    overflow:hidden;
    background:transparent;
    border:none;
    border-radius:0;
    box-shadow:none;
}

.carousel-viewport .col + .col{
    border-left:3px solid rgba(74,198,201,.70);
}

.fixed-col .col{
    width:100%;
    max-width:none;
    min-width:0;
    border:3px solid rgba(74,198,201,.88);
    border-radius:20px;
    background:linear-gradient(180deg,rgba(5,16,18,.88),rgba(1,5,6,.84));
    box-shadow:
        0 0 30px rgba(74,198,201,.16),
        inset 0 0 30px rgba(74,198,201,.07),
        inset 0 1px 0 rgba(255,255,255,.08);
}

/* ========== ОБЩИЙ ЗАЧЁТ (фиксированная левая колонка) ========== */
/* Золотой акцент — чтобы главная, всегда видимая колонка выделялась среди
   карусели дисциплин. */

.fixed-col .col{
    border:3px solid rgba(255,204,51,.55);
    background:linear-gradient(180deg,rgba(18,14,2,.88),rgba(1,5,6,.84));
    box-shadow:
        0 0 30px rgba(255,204,51,.10),
        inset 0 0 30px rgba(255,204,51,.05),
        inset 0 1px 0 rgba(255,255,255,.08);
}

.fixed-col .head{
    border-bottom:3px solid rgba(255,204,51,.55);
    background:linear-gradient(180deg,rgba(255,204,51,.14),rgba(0,0,0,.23));
}

.head{
    height:104px;
    display:flex;
    align-items:center;
    justify-content:center;
    text-align:center;
    border-bottom:3px solid rgba(74,198,201,.72);
    background:linear-gradient(180deg,rgba(74,198,201,.14),rgba(0,0,0,.23));
}

.head .title{
    font-size:40px;
    font-weight:1000;
    font-style:italic;
    letter-spacing:-1px;
    text-transform:uppercase;
}

.head .sub{
    font-size:18px;
    margin-top:7px;
    opacity:.82;
    font-weight:900;
    font-style:italic;
    text-transform:lowercase;
}

.row{
    height:52px;
    display:grid;
    grid-template-columns:minmax(0,1fr) 126px;
    align-items:center;
    border-bottom:2px solid rgba(74,198,201,.20);
    padding:0 12px 0 14px;
    position:relative;
    will-change:opacity;
    transition:
        opacity .45s ease,
        background .55s ease,
        box-shadow .55s ease,
        filter .55s ease;
}

.name{
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    font-size:16px;
    font-weight:1000;
    font-style:italic;
    letter-spacing:-.35px;
    min-width:0;
}

.sep{color:var(--cyan);padding:0 5px}
.num{color:rgba(244,241,232,.86)}

.time{
    text-align:right;
    font-size:18px;
    font-weight:1000;
    color:var(--cyan2);
    font-variant-numeric:tabular-nums;
    white-space:nowrap;
    letter-spacing:-.65px;
    text-shadow:0 0 12px rgba(86,226,229,.34);
}

.row1{
    position:relative;
    overflow:hidden;
    background:
        linear-gradient(
            90deg,
            rgba(255,204,51,.26),
            rgba(255,230,120,.10),
            rgba(255,204,51,.20)
        );
    box-shadow:
        inset 6px 0 0 var(--gold),
        0 0 18px rgba(255,204,51,.18);
    animation:firstPlacePulse 4s ease-in-out infinite;
}

.row1 .name,
.row1 .time{
    color:var(--gold2);
    position:relative;
    z-index:2;
}

.row1::after{
    content:"";
    position:absolute;
    top:0;
    left:-80%;
    width:45%;
    height:100%;
    background:
        linear-gradient(
            90deg,
            transparent,
            rgba(255,255,255,.12),
            transparent
        );
    transform:skewX(-18deg);
    animation:rowSweep 6s linear infinite;
    pointer-events:none;
    z-index:1;
}

.row2{
    background:linear-gradient(90deg,rgba(225,235,245,.16),rgba(74,198,201,.05));
    box-shadow:inset 6px 0 0 var(--silver);
}

.row2 .name,
.row2 .time{
    color:#eaf1f8;
}

.row3{
    background:linear-gradient(90deg,rgba(205,127,50,.20),rgba(74,198,201,.04));
    box-shadow:inset 6px 0 0 var(--bronze);
}

.row3 .name,
.row3 .time{
    color:#ffc28c;
}

/* ========== ТОП-5 ОБЩЕГО ЗАЧЁТА — своя анимация и фон на каждое место ========== */
/* Только в фиксированной колонке ("Общий зачёт"): .row1/.row2/.row3 у обычных
   дисциплин-карусели остаются как были (следующие правила их не трогают —
   применяются только внутри .fixed-col через более специфичный селектор).
   row4 и row5 — новые классы (раньше 4-е и 5-е место были обычной строкой
   без акцента), но они оформлены только под .fixed-col, поэтому в
   дисциплинах карусели 4-5 строки выглядят как прежде.
   У каждого места — свой узор поверх фирменного градиента места (молнии
   у 1-го, звёзды у 2-го, искры у 3-го, шевроны-скорость у 4-го, лёгкие
   блики у 5-го), нарисованный крошечным инлайновым SVG, без внешних файлов. */
.fixed-col .row1{
    background-image:
        url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHBhdGggZmlsbD0iI2ZmZTI3YSIgZmlsbC1vcGFjaXR5PSIwLjMyIiBkPSJNMzUgNEwxNiAzNGgxMWwtNCAyNiAyMS0zMkgzM2w0LTI0eiIvPjwvc3ZnPg=="),
        linear-gradient(90deg,rgba(255,204,51,.26),rgba(255,230,120,.10),rgba(255,204,51,.20));
    background-repeat:repeat, no-repeat;
    background-size:52px 52px, cover;
    background-position:0 0, 0 0;
}

.fixed-col .row2{
    background-image:
        url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHBhdGggZmlsbD0iI2U3ZWRmNSIgZmlsbC1vcGFjaXR5PSIwLjMwIiBkPSJNMzIgNmw3LjUgMTUuNUw1NyAyNGwtMTIuNSAxMkw0NyA1NCAzMiA0NSAxNyA1NGwyLjUtMThMNyAyNGwxNy41LTIuNXoiLz48L3N2Zz4="),
        linear-gradient(90deg,rgba(225,235,245,.16),rgba(74,198,201,.05));
    background-repeat:repeat, no-repeat;
    background-size:52px 52px, cover;
    background-position:0 0, 0 0;
    animation:silverShimmer 5s ease-in-out infinite;
}

.fixed-col .row3{
    background-image:
        url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHBhdGggZmlsbD0iI2ZmYmY3YSIgZmlsbC1vcGFjaXR5PSIwLjMyIiBkPSJNMzIgNmMyIDEyIDggMTggMjAgMjAtMTIgMi0xOCA4LTIwIDIwLTItMTItOC0xOC0yMC0yMCAxMi0yIDE4LTggMjAtMjB6Ii8+PC9zdmc+"),
        linear-gradient(90deg,rgba(205,127,50,.20),rgba(74,198,201,.04));
    background-repeat:repeat, no-repeat;
    background-size:44px 44px, cover;
    background-position:0 0, 0 0;
    animation:bronzeEmber 5.4s ease-in-out infinite;
}

.fixed-col .row4{
    background-image:
        url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHBhdGggZmlsbD0iIzhmZTNlNSIgZmlsbC1vcGFjaXR5PSIwLjMwIiBkPSJNOCAxMmwxOCAyMC0xOCAyMCAxMCAwIDE4LTIwLTE4LTIwek0zNCAxMmwxOCAyMC0xOCAyMCAxMCAwIDE4LTIwLTE4LTIweiIvPjwvc3ZnPg=="),
        linear-gradient(90deg,rgba(74,198,201,.20),rgba(74,198,201,.03));
    background-repeat:repeat, no-repeat;
    background-size:48px 48px, cover;
    background-position:0 0, 0 0;
    box-shadow:inset 6px 0 0 var(--cyan);
    animation:cyanRise 4.6s ease-in-out infinite;
}

.fixed-col .row4 .name,
.fixed-col .row4 .time{
    color:var(--cyan2);
}

.fixed-col .row5{
    background-image:
        url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHBhdGggZmlsbD0iI2Y0ZjFlOCIgZmlsbC1vcGFjaXR5PSIwLjIwIiBkPSJNMzIgMTBjMS41IDkgNiAxMy41IDE1IDE1LTkgMS41LTEzLjUgNi0xNSAxNS0xLjUtOS02LTEzLjUtMTUtMTUgOS0xLjUgMTMuNS02IDE1LTE1eiIvPjwvc3ZnPg=="),
        linear-gradient(90deg,rgba(244,241,232,.10),rgba(74,198,201,.02));
    background-repeat:repeat, no-repeat;
    background-size:40px 40px, cover;
    background-position:0 0, 0 0;
    box-shadow:inset 6px 0 0 rgba(244,241,232,.55);
    animation:softFlicker 6s ease-in-out infinite;
}

@keyframes silverShimmer{
    0%,100%{box-shadow:inset 6px 0 0 var(--silver),0 0 0 rgba(215,222,232,0)}
    50%{box-shadow:inset 6px 0 0 var(--silver),0 0 20px rgba(215,222,232,.30)}
}

@keyframes bronzeEmber{
    0%,100%{box-shadow:inset 6px 0 0 var(--bronze),0 0 0 rgba(205,127,50,0)}
    50%{box-shadow:inset 6px 0 0 var(--bronze),0 0 18px rgba(205,127,50,.32)}
}

@keyframes cyanRise{
    0%,100%{filter:brightness(1)}
    50%{filter:brightness(1.16)}
}

@keyframes softFlicker{
    0%,45%,55%,100%{opacity:1}
    50%{opacity:.78}
}

.empty{
    color:rgba(244,241,232,.42);
}

.row.changed{
    animation:newTimeFlash 2.1s ease;
}

.row.enter{
    animation:rowEnter .65s cubic-bezier(.2,.9,.2,1);
}

.row.move-up{
    animation:moveUpGlow 1.25s ease;
}

.row.move-down{
    animation:moveDownGlow 1.1s ease;
}

@keyframes rowEnter{
    0%{opacity:0;transform:translateX(22px) scale(.98)}
    100%{opacity:1;transform:translateX(0) scale(1)}
}

@keyframes newTimeFlash{
    0%{box-shadow:0 0 0 rgba(86,226,229,0);filter:brightness(1)}
    28%{box-shadow:0 0 38px rgba(86,226,229,.38);filter:brightness(1.23)}
    100%{box-shadow:none;filter:brightness(1)}
}

@keyframes moveUpGlow{
    0%{filter:brightness(1)}
    25%{
        filter:brightness(1.20);
        box-shadow:
            0 0 28px rgba(255,204,51,.20),
            inset 6px 0 0 var(--gold);
    }
    100%{filter:brightness(1)}
}

@keyframes moveDownGlow{
    0%{filter:brightness(1)}
    35%{
        filter:brightness(1.08);
        box-shadow:0 0 16px rgba(86,226,229,.10);
    }
    100%{filter:brightness(1)}
}

@keyframes firstPlacePulse{
    0%{filter:brightness(1)}
    50%{filter:brightness(1.08)}
    100%{filter:brightness(1)}
}

@keyframes rowSweep{
    0%{left:-80%}
    100%{left:140%}
}

.leader-overlay{
    position:fixed;
    left:50%;
    top:48%;
    transform:translate(-50%,-50%) scale(.9);
    z-index:50;
    min-width:560px;
    padding:28px 36px;
    border:3px solid rgba(74,198,201,.86);
    border-radius:28px;
    background:
        radial-gradient(circle at 20% 0%, rgba(74,198,201,.24), transparent 38%),
        linear-gradient(180deg, rgba(7,12,12,.94), rgba(0,0,0,.90));
    box-shadow:
        0 0 70px rgba(74,198,201,.22),
        inset 0 0 40px rgba(74,198,201,.08);
    text-align:center;
    opacity:0;
    pointer-events:none;
}

.leader-overlay.show{
    animation:leaderOverlay 3.2s ease forwards;
}

.leader-overlay .kicker{
    display:inline-flex;
    align-items:center;
    gap:8px;
    padding:10px 18px;
    border-radius:999px;
    background:
        linear-gradient(
            135deg,
            rgba(74,198,201,.95),
            rgba(244,241,232,.95),
            rgba(74,198,201,.95)
        );
    background-size:200% 200%;
    color:#041010;
    font-weight:900;
    font-size:15px;
    letter-spacing:.14em;
    text-transform:uppercase;
    box-shadow:
        0 0 24px rgba(74,198,201,.30),
        0 0 34px rgba(244,241,232,.10);
    animation:
        leaderGradient 4s ease infinite,
        leaderPulse 2.2s ease-in-out infinite;
}

.leader-overlay .driver{
    margin-top:10px;
    font-size:54px;
    font-weight:1000;
    font-style:italic;
    color:#f4f1e8;
    text-shadow:0 0 26px rgba(74,198,201,.28);
}

.leader-overlay .meta{
    margin-top:8px;
    font-size:22px;
    font-weight:900;
    color:rgba(244,241,232,.86);
}

.ticker-wrap{
    height:58px;
    flex:0 0 58px;
    margin-top:auto;
    position:relative;
    overflow:visible;
    border:3px solid rgba(74,198,201,.78);
    border-radius:20px;
    display:flex;
    align-items:center;
    background:linear-gradient(180deg,rgba(5,16,18,.78),rgba(0,0,0,.42));
    box-shadow:
        0 0 24px rgba(74,198,201,.12),
        inset 0 0 18px rgba(74,198,201,.08);
}

.ticker{
    white-space:nowrap;
    padding-left:100%;
    font-size:26px;
    font-weight:1000;
    font-style:italic;
    animation:ticker 55s linear infinite;
    color:var(--white);
}

.ticker b{color:var(--cyan)}
.gold{color:var(--gold2)}

/* 7 карусельных пунктов (GT3, MX-5, BTCC, DTM, GT500, Touge, Week CUP) —
   каждый занимает 1/7 цикла: держит кадр CAROUSEL_HOLD_MS, затем едет
   CAROUSEL_MOVE_MS. Если поменяешь состав/число пунктов DISPLAY_ORDER —
   пересчитай проценты здесь и --cycle-time выше (сейчас 7 * (10000+1200)мс
   = 78.4с). */
@keyframes carouselStep{
    0%{transform:translate3d(0,0,0)}
    12.755%{transform:translate3d(0,0,0)}

    14.286%{transform:translate3d(calc(var(--col-w) * -1),0,0)}
    27.041%{transform:translate3d(calc(var(--col-w) * -1),0,0)}

    28.571%{transform:translate3d(calc(var(--col-w) * -2),0,0)}
    41.327%{transform:translate3d(calc(var(--col-w) * -2),0,0)}

    42.857%{transform:translate3d(calc(var(--col-w) * -3),0,0)}
    55.612%{transform:translate3d(calc(var(--col-w) * -3),0,0)}

    57.143%{transform:translate3d(calc(var(--col-w) * -4),0,0)}
    69.898%{transform:translate3d(calc(var(--col-w) * -4),0,0)}

    71.429%{transform:translate3d(calc(var(--col-w) * -5),0,0)}
    84.184%{transform:translate3d(calc(var(--col-w) * -5),0,0)}

    85.714%{transform:translate3d(calc(var(--col-w) * -6),0,0)}
    98.469%{transform:translate3d(calc(var(--col-w) * -6),0,0)}

    100%{transform:translate3d(calc(var(--col-w) * -7),0,0)}
}

@keyframes ticker{
    from{transform:translateX(0)}
    to{transform:translateX(-100%)}
}

@keyframes leaderOverlay{
    0%{opacity:0;transform:translate(-50%,-50%) scale(.84)}
    12%{opacity:1;transform:translate(-50%,-50%) scale(1.02)}
    78%{opacity:1;transform:translate(-50%,-50%) scale(1)}
    100%{opacity:0;transform:translate(-50%,-50%) scale(.96)}
}

@keyframes leaderGradient{
    0%{background-position:0% 50%}
    50%{background-position:100% 50%}
    100%{background-position:0% 50%}
}

@keyframes leaderPulse{
    0%{transform:scale(1);filter:brightness(1)}
    50%{transform:scale(1.03);filter:brightness(1.08)}
    100%{transform:scale(1);filter:brightness(1)}
}

@media(max-width:1400px){
    .header{height:112px;flex-basis:112px}
    .logo-wrap{height:104px}
    .qrbox{height:98px;width:360px}
    .qr{height:74px;width:74px;flex-basis:74px}
    .qrtext{font-size:20px}
    .head .title{font-size:32px}
    .row{grid-template-columns:minmax(0,1fr) 112px}
    .name{font-size:14px}
    .time{font-size:16px}
    .carousel-track{--col-w:330px}.col{width:330px;min-width:330px;max-width:330px}
}
/* ========== RUNNING CAT ========== */

.ticker-wrap{
    position:relative;
    overflow:visible;
}

.ticker-clip{
    width:100%;
    height:100%;
    overflow:hidden;
    display:flex;
    align-items:center;
}

.cat-runner{
    position:absolute;
    left:-90px;
    top:-48px;
    z-index:9999;
    pointer-events:none;
    animation:catRun 210s linear infinite;
}

.cat-runner img{
    width:62px;
    height:auto;
    image-rendering:pixelated;
}

@keyframes catRun{
    0%{
        left:-90px;
        opacity:1;
    }

    14.2%{
        left:calc(100% + 90px);
        opacity:1;
    }

    14.3%{
        opacity:0;
    }

    100%{
        left:calc(100% + 90px);
        opacity:0;
    }
}
</style>
</head>

<body>
<div class="wrap">
    <div class="header">
        <div class="logo-wrap"><img src="/static/logo.png" class="logo-img"></div>

        <div class="qr-cat-static">
            <img src="/static/line_cat.gif">
        </div>

        <div class="qrbox">
            <div class="qr"><img src="/static/qr.png"></div>
            <div class="qrtext">{bot_username}<span>клубная экосистема<br>рейтинг, сезоны, награды</span></div>
        </div>
    </div>

    <div class="board">
        <div class="ranks">{ranks}</div>
        <div class="fixed-col"><div id="fixed-root"></div></div>
        <div class="carousel-viewport">
            <div class="carousel-track" id="carousel-track"></div>
        </div>
    </div>

    <div class="ticker-wrap">
        <div class="cat-runner">
            <img src="/static/cat.gif">
        </div>

        <div class="ticker-clip">
            <div class="ticker" id="ticker">{ticker}</div>
        </div>
    </div>
</div>

<div class="leader-overlay" id="leader-overlay">
    <div class="kicker">NEW LEADER</div>
    <div class="driver" id="leader-driver">—</div>
    <div class="meta" id="leader-meta">—</div>
</div>

<script>
let DISPLAY_ORDER = {display_order_json};
const CAROUSEL_HOLD_MS = {carousel_hold_ms};
const CAROUSEL_MOVE_MS = {carousel_move_ms};
const DATA_REFRESH_MS = {data_refresh_ms};
const CAROUSEL_DUPLICATES = {carousel_duplicates};

let state = null;
let refreshLock = false;
let carouselIndex = 0;
let carouselTimer = null;
let pendingData = null;

function escapeHtml(value){
    return String(value ?? "")
        .replaceAll("&","&amp;")
        .replaceAll("<","&lt;")
        .replaceAll(">","&gt;")
        .replaceAll('"',"&quot;")
        .replaceAll("'","&#039;");
}

function makeRow(pilot, index, oldMap){
    const row = document.createElement("div");
    const placeClass = index === 0 ? "row1" : index === 1 ? "row2" : index === 2 ? "row3"
        : index === 3 ? "row4" : index === 4 ? "row5" : "";
    row.className = `row ${placeClass}`;
    row.dataset.pilot = pilot.name;
    row.dataset.place = String(index);
    row.dataset.time = pilot.time;

    const name = document.createElement("div");
    name.className = "name";

    const cleanNum = String(pilot.num ?? "—");
    if (cleanNum && cleanNum !== "—"){
        name.innerHTML = `${escapeHtml(pilot.name)} <span class="sep">|</span><span class="num">#${escapeHtml(cleanNum)}</span>`;
    } else {
        name.textContent = String(pilot.name ?? "Pilot");
    }

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = String(pilot.time ?? "--:--.---");

    row.appendChild(name);
    row.appendChild(time);

    if (oldMap){
        const old = oldMap[pilot.name];
        if (!old){
            row.classList.add("enter");
        } else {
            if (old.time !== pilot.time){
                row.classList.add("changed");
            }
            if (old.place > index){
                row.classList.add("move-up");
            } else if (old.place < index){
                row.classList.add("move-down");
            }
        }
    }

    return row;
}

function makeEmptyRow(){
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="name empty">---</div><div class="time empty">--:--.---</div>`;
    return row;
}

function makeColumn(item, pilots, oldGroups){
    const col = document.createElement("div");
    col.className = "col";
    col.dataset.discipline = item.key;

    // Плашка этапа всегда рендерится (даже пустой — у "Общий зачёт" своего
    // stage нет), чтобы высота колонки совпадала с каруселью и .head/.rows
    // ниже остались ровно там же, где были до добавления плашек.
    const badgeRow = document.createElement("div");
    badgeRow.className = "badge-row";
    if (item.stage){
        const pill = document.createElement("span");
        pill.className = `stage-badge stage-badge--${item.stage_type || "main"}`;
        pill.textContent = item.stage;
        badgeRow.appendChild(pill);
    }

    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<div><div class="title">${escapeHtml(item.title)}</div><div class="sub">${escapeHtml(item.subtitle)}</div></div>`;

    const rows = document.createElement("div");
    rows.className = "rows";

    const oldMap = {};
    if (oldGroups && oldGroups[item.key]){
        oldGroups[item.key].forEach((p, i) => {
            oldMap[p.name] = {place:i, time:p.time};
        });
    }

    for (let i = 0; i < 10; i++){
        if (i < pilots.length){
            rows.appendChild(makeRow(pilots[i], i, oldGroups ? oldMap : null));
        } else {
            rows.appendChild(makeEmptyRow());
        }
    }

    col.appendChild(badgeRow);
    col.appendChild(head);
    col.appendChild(rows);
    return col;
}

function showLeaderOverlay(item, pilot){
    if (!item || !pilot) return;

    const box = document.getElementById("leader-overlay");
    const driver = document.getElementById("leader-driver");
    const meta = document.getElementById("leader-meta");

    if (!box || !driver || !meta) return;

    const driverName = String(pilot.name || "").trim();
    const timeText = String(pilot.time || "").trim();
    const disciplineTitle = String(item.title || item.key || "LEADER").trim();

    if (!driverName || !timeText || timeText === "--:--.---") return;

    driver.textContent = driverName;
    meta.textContent = `${disciplineTitle} · ${timeText}`;

    box.classList.remove("show");
    void box.offsetWidth;

    requestAnimationFrame(() => {
        box.classList.add("show");
    });
}

function carouselItems(){
    return DISPLAY_ORDER;
}

function renderBoard(data, animate=true){
    if (data && data.display_order){
        DISPLAY_ORDER = data.display_order;
    }

    const fixedRoot = document.getElementById("fixed-root");
    const carousel = document.getElementById("carousel-track");

    if (!fixedRoot || !carousel) return;

    const oldGroups = state ? state.groups : null;
    const oldOverall = state && state.tournament ? state.tournament.overall : null;

    fixedRoot.innerHTML = "";
    carousel.innerHTML = "";

    const topItem = {key:"TOP", title:"Общий зачёт", subtitle:""};
    const topPilots = (data.tournament && data.tournament.overall) || [];
    const topOldGroups = animate && oldOverall ? {TOP: oldOverall} : null;
    fixedRoot.appendChild(makeColumn(topItem, topPilots, topOldGroups));

    const items = carouselItems();

    // Дубли обязательны: в конце Week CUP плавно уходит к следующему MX-5,
    // а reset CSS-анимации происходит на визуально одинаковом кадре.
    for (let repeat = 0; repeat < CAROUSEL_DUPLICATES; repeat++){
        items.forEach(item => {
            carousel.appendChild(makeColumn(item, data.groups[item.key] || [], animate ? oldGroups : null));
        });
    }

    let leaderEvent = null;

    if (animate && oldGroups){
        for (const item of DISPLAY_ORDER){
            const oldLeader = (oldGroups[item.key] || [])[0];
            const newLeader = (data.groups[item.key] || [])[0];

            if (!oldLeader || !newLeader) continue;

            const oldName = String(oldLeader.name || "");
            const oldTime = String(oldLeader.time || "");
            const newName = String(newLeader.name || "");
            const newTime = String(newLeader.time || "");

            if (oldName !== newName || oldTime !== newTime){
                leaderEvent = {item:item, pilot:newLeader};
                break;
            }
        }
    }

    const ticker = document.getElementById("ticker");
    if (ticker) ticker.innerHTML = data.ticker;

    state = data;

    if (leaderEvent){
        showLeaderOverlay(leaderEvent.item, leaderEvent.pilot);
    }
}

function applyPendingDataIfAny(){
    if (!pendingData) return;

    const data = pendingData;
    pendingData = null;
    renderBoard(data, true);
}

async function fetchData(){
    const res = await fetch("/api/leaderboard", {cache:"no-store"});
    return await res.json();
}

async function refreshBoard(){
    if (refreshLock) return;
    refreshLock = true;

    try{
        pendingData = await fetchData();
    }catch(e){
        console.warn("TV board refresh failed", e);
    }finally{
        setTimeout(() => { refreshLock = false; }, 500);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const initial = {initial_json};
    renderBoard(initial, false);

    const track = document.getElementById("carousel-track");

    // Данные применяем только в конце полного цикла карусели.
    // Поэтому скролл не дёргается и не бывает резких перелистываний.
    if (track){
        track.addEventListener("animationiteration", async () => {
            await refreshBoard();
            applyPendingDataIfAny();
        });
    }

    // Просто заранее подготавливаем свежие данные, но не перерисовываем экран посреди движения.
    setInterval(refreshBoard, DATA_REFRESH_MS);
});
</script>
</body>
</html>
"""


def esc(value) -> str:
    return html.escape(str(value or ""))


def normalize_discipline(name: str) -> str:
    s = str(name or "").strip().upper()
    for item in DISPLAY_ORDER:
        if s == item["key"].upper():
            return item["key"]
        for alias in item["aliases"]:
            if s == alias.upper():
                return item["key"]
    return s


def get_table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    except Exception:
        return set()


def build_sql(conn: sqlite3.Connection) -> str:
    discipline_cols = get_table_columns(conn, "disciplines")
    pilots_cols = get_table_columns(conn, "pilots")

    if "name" in discipline_cols and "title" in discipline_cols:
        discipline_expr = "COALESCE(d.name, d.title, CAST(l.discipline_id AS TEXT))"
    elif "name" in discipline_cols:
        discipline_expr = "COALESCE(d.name, CAST(l.discipline_id AS TEXT))"
    elif "title" in discipline_cols:
        discipline_expr = "COALESCE(d.title, CAST(l.discipline_id AS TEXT))"
    else:
        discipline_expr = "CAST(l.discipline_id AS TEXT)"

    if "display_name" in pilots_cols and "username" in pilots_cols:
        name_expr = "COALESCE(NULLIF(p.display_name, ''), NULLIF(p.username, ''), l.username)"
    elif "display_name" in pilots_cols:
        name_expr = "COALESCE(NULLIF(p.display_name, ''), l.username)"
    elif "username" in pilots_cols:
        name_expr = "COALESCE(NULLIF(p.username, ''), l.username)"
    else:
        name_expr = "l.username"

    if "pilot_number" in pilots_cols:
        number_expr = "CAST(p.pilot_number AS TEXT)"
    elif "number" in pilots_cols:
        number_expr = "CAST(p.number AS TEXT)"
    else:
        number_expr = "'—'"

    return f"""
        SELECT
            {discipline_expr} AS discipline,
            l.username AS username,
            l.telegram_id AS telegram_id,
            l.track AS track,
            l.lap_time_text AS lap_time_text,
            l.lap_time_ms AS lap_time_ms,
            {name_expr} AS display_name,
            COALESCE(NULLIF({number_expr}, ''), '—') AS pilot_number
        FROM laps l
        LEFT JOIN disciplines d ON d.id = l.discipline_id
        LEFT JOIN pilots p ON p.telegram_id = l.telegram_id
        ORDER BY discipline, l.track, l.lap_time_ms ASC
    """


def clean_name(value, fallback="Pilot") -> str:
    value = str(value or fallback or "Pilot").replace("@", "").strip()
    return value or "Pilot"


def clean_number(value) -> str:
    value = str(value or "").strip()
    if value in ("", "0", "None", "none", "NULL", "null", "—"):
        return "—"
    return value


async def load_tournament_data() -> dict:
    """
    Общий взвешенный зачёт месяца турнира v2 для фиксированной колонки
    ТВ-табло ("Общий зачёт" — кто сейчас лидирует за призы клуба).

    Ничего не пишет в БД, только читает — использует те же async-функции,
    что и сам бот (services.tournament / database.db), поэтому цифры на
    экране всегда совпадают с тем, что видит пилот в личном кабинете.
    """
    month_key, start_iso, end_iso = month_bounds()

    try:
        ranking = await rank_month_overall(month_key, start_iso, end_iso)
    except Exception:
        logging.exception("TV board: не удалось загрузить общий зачёт месяца")
        ranking = []

    overall = []
    for row in ranking:
        try:
            pilot = await get_pilot_by_telegram_id(row["telegram_id"]) or {}
        except Exception:
            pilot = {}
        name = clean_name(pilot.get("display_name"), pilot.get("username"))
        number = clean_number(pilot.get("pilot_number"))
        overall.append({
            "name": name,
            "num": number,
            "time": f'{row["total"]:g}',
        })

    return {
        "month_key": month_key,
        "overall": overall,
    }


def load_groups() -> dict[str, list[dict]]:
    groups = {item["key"]: [] for item in DISPLAY_ORDER}

    if not DB_PATH.exists():
        logging.warning("TV board: файл БД не найден: %s", DB_PATH)
        return groups

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(build_sql(conn)).fetchall()
        conn.close()
    except Exception:
        return groups

    seen = set()

    for row in rows:
        discipline = normalize_discipline(row["discipline"])

        if discipline not in groups:
            continue

        name = clean_name(row["display_name"], row["username"])
        number = clean_number(row["pilot_number"])
        track = str(row["track"] or "")
        key = (discipline, track, name)

        if key in seen:
            continue
        seen.add(key)

        groups[discipline].append({
            "name": name,
            "num": number,
            "time": row["lap_time_text"] or "--:--.---",
            "track": track,
        })

    return groups


def get_auto_subtitle(item: dict, groups: dict[str, list[dict]]) -> str:
    """
    Берёт описание/карту из базы.
    Если в дисциплине уже есть хотя бы одно время — subtitle = track из лучшего результата.
    Если результатов нет — оставляет стандартный subtitle из DISPLAY_ORDER.
    """
    pilots = groups.get(item["key"]) or []

    for pilot in pilots:
        track = str(pilot.get("track") or "").strip()
        if track:
            return track

    return str(item.get("subtitle") or "")


def get_dynamic_display_order(groups: dict[str, list[dict]]) -> list[dict]:
    """
    Копия DISPLAY_ORDER, но subtitle автоматически подгружается из laps.track.
    Это не меняет внешний вид сайта и не требует править код перед новым сезоном.
    """
    dynamic_order = []

    for item in DISPLAY_ORDER:
        new_item = dict(item)
        new_item["subtitle"] = get_auto_subtitle(item, groups)
        dynamic_order.append(new_item)

    return dynamic_order


def make_ticker(groups: dict[str, list[dict]], display_order: list[dict] | None = None) -> str:
    display_order = display_order or DISPLAY_ORDER
    now = datetime.now().strftime("%H:%M")

    parts = [
        "<b>Таблица в реальном времени</b>",
        f"текущее время: <b>{now}</b>",
        "VALEVO RACING",
    ]

    for item in display_order:
        pilots = groups.get(item["key"]) or []
        winner = pilots[0]["name"] if pilots else "—"
        parts.append(f'1 место {esc(item["title"])}: <span class="gold">{esc(winner)}</span>')

    parts.append(f"присоединяйся к нашей экосистеме ВАЛЕВО: <b>{BOT_USERNAME}</b>")

    return " &nbsp; | &nbsp; ".join(parts)


async def payload() -> dict:
    groups = load_groups()
    display_order = get_dynamic_display_order(groups)

    try:
        tournament = await load_tournament_data()
    except Exception:
        logging.exception("TV board: панель турнира v2 недоступна")
        tournament = {"month_key": None, "classes": [], "overall": []}

    return {
        "groups": groups,
        "ticker": make_ticker(groups, display_order),
        "updated_at": datetime.now().strftime("%H:%M:%S"),
        "display_order": display_order,
        "tournament": tournament,
    }


@app.get("/api/leaderboard")
async def api_leaderboard():
    return JSONResponse(await payload())


@app.get("/", response_class=HTMLResponse)
async def index():
    data = await payload()
    page = HTML_TEMPLATE
    page = page.replace("{bot_username}", BOT_USERNAME)
    page = page.replace("{ranks}", "".join(f'<div class="rank">{i}</div>' for i in range(1, 11)))
    page = page.replace("{ticker}", data["ticker"])
    page = page.replace("{display_order_json}", json.dumps(data["display_order"], ensure_ascii=False))
    page = page.replace("{carousel_hold_ms}", str(CAROUSEL_HOLD_MS))
    page = page.replace("{carousel_move_ms}", str(CAROUSEL_MOVE_MS))
    page = page.replace("{data_refresh_ms}", str(DATA_REFRESH_MS))
    page = page.replace("{carousel_duplicates}", str(CAROUSEL_DUPLICATES))
    page = page.replace("{initial_json}", json.dumps(data, ensure_ascii=False))
    return page


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_config=None,
        access_log=False,
    )

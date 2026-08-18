/*
 * profile.js — the flagship "Профиль" tab (home). Renders instantly from
 * the already-fetched bootstrap data in state.js, then silently refreshes
 * against GET /api/me in the background so numbers stay current without a
 * loading flash on every tab visit.
 */

import { registerScreen, push, switchTab } from "../router.js";
import { api } from "../api.js";
import { appState, setMe } from "../state.js";
import { el, clear, errorState, toastError, openSheet } from "../ui.js";
import { haptic } from "../telegram.js";
import { formatHoursValue, formatRub, formatWallDate, formatWallDateTime, clamp } from "../format.js";

// Purely decorative mirror of services/profile_service.py PILOT_RANKS, used
// only to draw the 6-step rank ladder below the progress bar. If the
// server's rank.current_title ever doesn't match a title here (tiers
// changed server-side before this list was updated) we just skip the
// ladder — the numeric progress bar above it is always authoritative.
const RANK_LADDER = [
    { emoji: "🔰", title: "Новичок" },
    { emoji: "🏎", title: "Гонщик" },
    { emoji: "🥉", title: "Профи" },
    { emoji: "🥈", title: "Ас трассы" },
    { emoji: "🥇", title: "Чемпион" },
    { emoji: "💎", title: "Легенда VALEVO" },
];

function statTile(value, label, mod = "") {
    return el("div", { class: `stat-tile ${mod}`.trim() }, [
        el("div", { class: "stat-value" }, value),
        el("div", { class: "stat-label" }, label),
    ]);
}

function kv(k, v) {
    return el("div", { class: "kv-row" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v)]);
}

function buildLadder(rank) {
    const idx = RANK_LADDER.findIndex((r) => r.title === rank.current_title);
    if (idx === -1) return null;
    const wrap = el("div", { class: "rank-ladder" });
    RANK_LADDER.forEach((r, i) => {
        const cls = i === idx ? "ladder-step current" : i < idx ? "ladder-step done" : "ladder-step";
        wrap.appendChild(el("div", { class: cls }, [
            el("div", { class: "ladder-emoji" }, r.emoji),
            el("div", { class: "ladder-dot" }),
        ]));
    });
    return wrap;
}

function buildLevelRow(level, levelProgress) {
    const isMax = levelProgress.fraction >= 1 && levelProgress.points_left === 0;
    return el("div", { class: "level-row" }, [
        el("span", { class: "level-chip" }, `${level} ур.`),
        el("div", { class: "level-track" }, [
            el("div", { class: "level-fill", style: `width:${Math.round(clamp(levelProgress.fraction, 0, 1) * 100)}%` }),
        ]),
        el("span", { class: "level-points-left" }, isMax ? "макс." : `ещё ${levelProgress.points_left}`),
    ]);
}

function buildProgress(rank) {
    const wrap = el("div", { class: "rank-progress" });

    if (rank.next_title) {
        wrap.appendChild(el("div", { class: "rank-progress-labels" }, [
            el("span", {}, `${rank.current_emoji} ${rank.current_title}`),
            el("span", { class: "to-next" }, `ещё ${rank.points_left} → ${rank.next_emoji} ${rank.next_title}`),
        ]));
        const track = el("div", { class: "progress-track" });
        track.appendChild(el("div", {
            class: "progress-fill",
            style: `width:${Math.round(clamp(rank.fraction, 0, 1) * 100)}%`,
        }));
        wrap.appendChild(track);
    } else {
        wrap.appendChild(el("div", { class: "rank-progress-max" }, `${rank.current_emoji} Максимальный ранг достигнут`));
    }

    const ladder = buildLadder(rank);
    if (ladder) wrap.appendChild(ladder);
    return wrap;
}

function buildHero(p) {
    const rank = p.rank;
    const card = el("div", { class: "card profile-hero" });

    card.appendChild(el("div", { class: "pilot-badge-row right" }, [
        p.pilot_number
            ? el("span", { class: "pilot-number" }, `#${p.pilot_number}`)
            : el("span", { class: "badge badge-muted" }, "№ не присвоен"),
    ]));

    card.appendChild(el("div", { class: "rank-emoji" }, rank.current_emoji));
    card.appendChild(el("div", { class: "profile-name-row" }, [
        el("span", { class: "profile-name" }, p.display_name),
        el("button", {
            class: "profile-edit-btn",
            "aria-label": "Изменить никнейм",
            onClick: () => { haptic("light"); push("nickname-edit"); },
        }, "✏️"),
    ]));
    card.appendChild(el("div", { class: "rank-title" }, rank.current_title));
    card.appendChild(el("div", { class: "rating-value" }, String(p.rating)));
    card.appendChild(el("div", { class: "rating-caption" }, "рейтинг пилота"));
    if (p.level != null && p.level_progress) card.appendChild(buildLevelRow(p.level, p.level_progress));
    card.appendChild(buildProgress(rank));

    return card;
}

function openAchievementDetail(item) {
    const body = el("div", { style: "text-align:center;" }, [
        el("div", { style: `font-size:44px;line-height:1;${item.unlocked ? "" : "filter:grayscale(1) brightness(.6);"}` }, item.emoji),
        el("div", { class: "modal-title", style: "margin-top:12px;" }, item.title),
        el("div", { class: "modal-text" }, item.description),
        el("div", { style: "margin-top:10px;font-weight:800;color:var(--cyan2);" },
            item.unlocked ? `Получено · +${item.reward} рейтинга` : `🔒 Заблокировано · +${item.reward} рейтинга при получении`),
    ]);
    openSheet(body, { center: true });
}

function buildBadgesCard(achievements) {
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-title" }, [
        el("span", {}, "🏅 Ачивки"),
        el("span", { class: "track-name" }, `${achievements.unlocked_count}/${achievements.total_count}`),
    ]));

    const grid = el("div", { class: "badge-grid" });
    achievements.items.forEach((item) => {
        grid.appendChild(el("button", {
            class: `achv-badge${item.unlocked ? " unlocked" : ""}`,
            onClick: () => { haptic("light"); openAchievementDetail(item); },
        }, [
            el("div", { class: "achv-emoji" }, item.emoji),
            el("div", { class: "achv-title" }, item.title),
        ]));
    });
    card.appendChild(grid);
    return card;
}

function buildClubCard(club) {
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-title" }, "🏟 Клуб"));

    if (!club || !club.linked) {
        card.appendChild(el("div", { class: "club-sync-note" }, [
            el("div", { class: "sync-icon" }, "🔄"),
            el("div", { class: "sync-text" }, "Профиль ещё не синхронизирован с клубной системой. Обычно это происходит автоматически после первого визита — если сообщение висит долго, скажите администратору."),
        ]));
        return card;
    }

    if (!club.available) {
        card.appendChild(el("div", { class: "club-sync-note" }, [
            el("div", { class: "sync-icon" }, "⚠️"),
            el("div", { class: "sync-text" }, "Клубные данные временно недоступны. Загляните сюда чуть позже."),
        ]));
        return card;
    }

    const grid = el("div", { class: "stat-grid" });
    grid.appendChild(statTile(String(club.visits ?? 0), "Визитов"));
    grid.appendChild(statTile(formatHoursValue(club.total_hours), "В клубе"));
    grid.appendChild(statTile(formatRub(club.bonus_balance), "Бонусы"));
    card.appendChild(grid);
    return card;
}

function buildAchievementsCard(history) {
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-title" }, "🏆 Достижения"));

    if (!history || !history.total_results) {
        card.appendChild(el("div", { style: "padding:10px 4px 4px;text-align:center;" }, [
            el("div", { style: "font-size:28px;margin-bottom:8px;" }, "🏁"),
            el("div", { class: "state-text", style: "margin:0 auto;" }, "Пока нет результатов. Установите время на трассе — и здесь появится ваша статистика."),
            el("button", {
                class: "btn btn-outline btn-sm",
                style: "width:auto;margin:14px auto 0;",
                onClick: () => { haptic("light"); switchTab("time"); },
            }, "Установить время"),
        ]));
        return card;
    }

    const medals = el("div", { class: "stat-grid" });
    medals.appendChild(statTile(String(history.gold || 0), "Золото", "gold"));
    medals.appendChild(statTile(String(history.silver || 0), "Серебро", "silver"));
    medals.appendChild(statTile(String(history.bronze || 0), "Бронза", "bronze"));
    card.appendChild(medals);

    const row2 = el("div", { class: "stat-grid cols-2", style: "margin-top:8px;" });
    row2.appendChild(statTile(String(history.podiums || 0), "Подиумов"));
    row2.appendChild(statTile(String(history.total_results || 0), "Результатов"));
    card.appendChild(row2);

    card.appendChild(el("div", { class: "divider" }));
    card.appendChild(kv("Дисциплин освоено", String(history.disciplines_count ?? 0)));
    card.appendChild(kv("Любимая дисциплина", history.favorite_discipline ? `${history.favorite_discipline} · ${history.favorite_discipline_count}` : "—"));
    card.appendChild(kv("Любимая трасса", history.favorite_track ? `${history.favorite_track} · ${history.favorite_track_count}` : "—"));
    card.appendChild(kv("В клубе с", history.first_result_at ? formatWallDate(history.first_result_at, { withWeekday: false, withYear: true }) : "—"));

    return card;
}

function buildLastResultCard(history) {
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-title" }, "⏱ Последний результат"));
    const r = history && history.last_result;

    if (!r) {
        card.appendChild(el("div", { class: "state-text", style: "text-align:center;padding:6px 0;" }, "Пока нет заездов."));
        return card;
    }

    card.appendChild(el("div", { class: "last-result-card" }, [
        el("div", { class: "last-result-flag" }, "🏁"),
        el("div", { class: "last-result-main" }, [
            el("div", { class: "last-result-track" }, `${r.discipline} · ${r.track}`),
            el("div", { class: "last-result-meta" }, formatWallDateTime(r.created_at)),
        ]),
        el("div", { class: "last-result-time" }, r.lap_time_text),
    ]));
    return card;
}

function buildIdentityCard(p) {
    const card = el("div", { class: "card" });
    card.appendChild(el("div", { class: "card-title" }, "🆔 Данные пилота"));
    card.appendChild(kv("Username", p.username ? `@${p.username}` : "—"));
    card.appendChild(kv("Телефон", p.phone_display || "—"));
    return card;
}

function draw(container, profile) {
    clear(container);

    let refreshing = false;
    const refreshBtn = el("button", { class: "screen-action", "aria-label": "Обновить" }, "🔄");
    refreshBtn.addEventListener("click", async () => {
        if (refreshing) return;
        refreshing = true;
        haptic("light");
        refreshBtn.style.opacity = ".5";
        const res = await api.get("/api/me");
        refreshing = false;
        refreshBtn.style.opacity = "";
        if (res.ok && res.data && res.data.registered) {
            setMe(res.data);
            draw(container, appState.me.profile);
        } else if (!res.ok && res.status !== 401) {
            toastError(res.error);
        }
    });

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [
            el("h1", { class: "screen-title" }, "Профиль"),
            el("p", { class: "screen-sub" }, "VALEVO RACING"),
        ]),
        refreshBtn,
    ]));

    const stack = el("div", { class: "stack" });
    stack.appendChild(buildHero(profile));
    if (profile.achievements) stack.appendChild(buildBadgesCard(profile.achievements));
    stack.appendChild(buildClubCard(profile.club));
    stack.appendChild(buildAchievementsCard(profile.history));
    stack.appendChild(buildLastResultCard(profile.history));
    stack.appendChild(buildIdentityCard(profile));
    container.appendChild(stack);
}

function renderProfile(container) {
    const profile = appState.me && appState.me.profile;
    if (!profile) {
        clear(container);
        container.appendChild(errorState("Не удалось загрузить профиль.", null));
        return;
    }

    draw(container, profile);

    let cancelled = false;
    api.get("/api/me").then((res) => {
        if (cancelled) return;
        if (res.ok && res.data && res.data.registered) {
            setMe(res.data);
            draw(container, appState.me.profile);
        }
    });

    return () => { cancelled = true; };
}

registerScreen("profile", renderProfile);

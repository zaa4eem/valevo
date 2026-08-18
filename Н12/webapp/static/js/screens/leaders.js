/*
 * leaders.js — "Лидеры" tab: Лидеры (per-discipline podiums) / ТОП-10
 * toggle, per the spec's suggestion to combine these two into one tab.
 */

import { registerScreen, switchTab } from "../router.js";
import { api } from "../api.js";
import { el, clear, emptyState, errorState, mountAsync } from "../ui.js";
import { haptic } from "../telegram.js";

let activeSubTab = "leaders"; // persisted across tab switches within the session

function buildClassCard(entry) {
    const card = el("div", { class: "card discipline-card" });
    const title = entry.side_of ? `${entry.class_name} (доп. для ${entry.side_of})` : entry.class_name;
    card.appendChild(el("div", { class: "card-title" }, [el("span", {}, `🏁 ${title}`)]));

    (entry.qualifying || []).forEach((row) => {
        const placeClass = row.place <= 3 ? ` place-${row.place}` : "";
        card.appendChild(el("div", { class: `medal-row${placeClass}` }, [
            el("span", { class: "medal" }, row.medal),
            el("span", { class: "pname" }, row.display_name),
            el("span", { class: "ptime" }, `${row.score} баллов`),
        ]));
    });
    (entry.pending || []).forEach((row) => {
        card.appendChild(el("div", { class: "medal-row" }, [
            el("span", { class: "medal" }, "·"),
            el("span", { class: "pname" }, row.display_name),
            el("span", { class: "ptime", style: "color:var(--text-faint);" }, `${row.starts}/${entry.min_starts} стартов`),
        ]));
    });
    return card;
}

function buildOverallCard(overall, monthKey) {
    const card = el("div", { class: "card discipline-card" });
    card.appendChild(el("div", { class: "card-title" }, [
        el("span", {}, "🏆 Общий зачёт месяца"),
        el("span", { class: "track-name" }, monthKey || ""),
    ]));
    overall.forEach((row) => {
        const placeClass = row.place <= 3 ? ` place-${row.place}` : "";
        const breakdown = (row.breakdown || [])
            .map((b) => `${b.class_name} ${b.score}${b.position_bonus ? `+${b.position_bonus}` : ""}×${b.weight}`)
            .join(" + ");
        card.appendChild(el("div", { class: `medal-row${placeClass}` }, [
            el("span", { class: "medal" }, row.medal),
            el("div", {}, [
                el("div", { class: "pname" }, row.display_name),
                breakdown ? el("div", { class: "field-hint", style: "margin-top:2px;" }, breakdown) : null,
            ]),
            el("span", { class: "ptime" }, row.total_text),
        ]));
    });
    return card;
}

function loadLeaderboard(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/leaderboard");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const classes = (res.data && res.data.classes) || [];
        const overall = (res.data && res.data.overall) || [];
        if (classes.length === 0 && overall.length === 0) {
            c.appendChild(emptyState(
                "Таблица лидеров пока пуста",
                "Станьте первым — отправьте свой результат через «Установить время»!",
                { actionText: "Установить время", onAction: () => { haptic("light"); switchTab("time"); } },
            ));
            return;
        }

        const stack = el("div", { class: "stack-sm" });
        classes.forEach((entry) => stack.appendChild(buildClassCard(entry)));
        if (overall.length) stack.appendChild(buildOverallCard(overall, res.data.month_key));
        c.appendChild(stack);
    });
}

function loadTop10(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/top10");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const pilots = (res.data && res.data.pilots) || [];
        if (pilots.length === 0) {
            c.appendChild(emptyState("Рейтинг пока пуст", "Здесь появится десятка сильнейших пилотов клуба."));
            return;
        }

        const card = el("div", { class: "card" });
        pilots.forEach((p, i) => {
            const rank = i + 1;
            const rowCls = rank <= 3 ? ` top${rank}` : "";
            const name = p.display_name || (p.username ? `@${p.username}` : "Пилот");
            const numberSuffix = p.pilot_number ? ` · #${p.pilot_number}` : "";
            card.appendChild(el("div", { class: `top10-row${rowCls}` }, [
                el("div", { class: "top10-rank" }, String(rank)),
                el("div", { class: "top10-name" }, name + numberSuffix),
                el("div", { class: "top10-rating" }, String(p.rating)),
            ]));
        });
        c.appendChild(card);
    });
}

function renderLeaders(container) {
    clear(container);

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [
            el("h1", { class: "screen-title" }, "Лидеры"),
            el("p", { class: "screen-sub" }, "рейтинг клуба VALEVO"),
        ]),
    ]));

    const content = el("div");

    const btnLeaders = el("button", {
        class: activeSubTab === "leaders" ? "active" : "",
        onClick: () => setSub("leaders"),
    }, "🏆 Лидеры");
    const btnTop10 = el("button", {
        class: activeSubTab === "top10" ? "active" : "",
        onClick: () => setSub("top10"),
    }, "📊 ТОП-10");

    function setSub(tab) {
        if (tab === activeSubTab) return;
        activeSubTab = tab;
        haptic("selection");
        btnLeaders.classList.toggle("active", tab === "leaders");
        btnTop10.classList.toggle("active", tab === "top10");
        tab === "leaders" ? loadLeaderboard(content) : loadTop10(content);
    }

    container.appendChild(el("div", { class: "segmented" }, [btnLeaders, btnTop10]));
    container.appendChild(content);

    activeSubTab === "leaders" ? loadLeaderboard(content) : loadTop10(content);
}

registerScreen("leaders", renderLeaders);

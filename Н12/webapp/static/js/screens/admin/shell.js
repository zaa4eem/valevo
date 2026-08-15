/*
 * admin/shell.js — the "Админ" tab root. A chip-nav switches between admin
 * sections (Дашборд/Пилоты/Трассы/Заявки/Брони/Week Cup/Рассылка) — these
 * are peers within this one screen (like the Лидеры/ТОП-10 toggle), NOT
 * separate pushed router screens, so BackButton at the admin root always
 * returns straight to Профиль. The one genuine drill-down — a specific
 * pilot's detail card — IS a pushed router screen and self-registers
 * inside pilots.js for exactly that reason.
 */

import { registerScreen } from "../../router.js";
import { el, clear } from "../../ui.js";
import { haptic } from "../../telegram.js";
import { renderDashboard } from "./dashboard.js";
import { renderPilots } from "./pilots.js"; // this import also runs pilots.js's own registerScreen("admin-pilot-detail", ...)
import { renderTracks } from "./tracks.js";
import { renderTimeRequests } from "./timerequests.js";
import { renderAdminBookings } from "./bookings.js";
import { renderWeekCup } from "./weekcup.js";
import { renderBroadcast } from "./broadcast.js";

const SECTIONS = [
    { key: "dashboard", label: "📊 Дашборд", render: renderDashboard },
    { key: "pilots", label: "👥 Пилоты", render: renderPilots },
    { key: "tracks", label: "🗺 Трассы", render: renderTracks },
    { key: "timerequests", label: "⏱ Заявки времени", render: renderTimeRequests },
    { key: "bookings", label: "🎟 Брони", render: renderAdminBookings },
    { key: "weekcup", label: "🏁 Week Cup", render: renderWeekCup },
    { key: "broadcast", label: "📢 Рассылка", render: renderBroadcast },
];

let activeSection = "dashboard"; // persisted across tab switches within the session

function renderAdmin(container) {
    clear(container);

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [el("h1", { class: "screen-title" }, "Админка"), el("p", { class: "screen-sub" }, "управление клубом VALEVO")]),
    ]));
    container.appendChild(el("div", { class: "admin-banner" }, "🛠 Режим администратора — эти экраны не видны обычным пилотам"));

    const chipRow = el("div", { class: "chiprow" });
    const content = el("div");

    SECTIONS.forEach((s) => {
        const chip = el("button", { class: `chip${s.key === activeSection ? " admin-active" : ""}` }, s.label);
        chip.addEventListener("click", () => {
            if (activeSection === s.key) return;
            activeSection = s.key;
            haptic("selection");
            [...chipRow.children].forEach((ch) => ch.classList.remove("admin-active"));
            chip.classList.add("admin-active");
            s.render(content);
        });
        chipRow.appendChild(chip);
    });

    container.appendChild(chipRow);
    container.appendChild(content);

    (SECTIONS.find((s) => s.key === activeSection) || SECTIONS[0]).render(content);
}

registerScreen("admin", renderAdmin);

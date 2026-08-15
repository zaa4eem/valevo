/*
 * admin/dashboard.js — GET /api/admin/stats. Plain exported render
 * function called directly by admin/shell.js's chip nav (not a router
 * screen — see shell.js for why).
 */

import { api } from "../../api.js";
import { el, clear, errorState, mountAsync } from "../../ui.js";

function statCard(icon, value, label) {
    return el("div", { class: "card", style: "text-align:center;padding:22px 10px;" }, [
        el("div", { style: "font-size:24px;margin-bottom:8px;" }, icon),
        el("div", { style: "font-size:21px;font-weight:1000;font-style:italic;color:var(--white);" }, value),
        el("div", { class: "stat-label", style: "margin-top:6px;" }, label),
    ]);
}

export function renderDashboard(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/admin/stats");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const s = res.data || {};
        const grid = el("div", { class: "dash-grid" });
        grid.appendChild(statCard("👥", String(s.total_pilots ?? 0), "Пилотов"));
        grid.appendChild(statCard("⏱", String(s.total_laps ?? 0), "Заездов"));
        grid.appendChild(statCard("🏁", String(s.total_disciplines ?? 0), "Дисциплин"));
        grid.appendChild(statCard("🔥", s.popular_discipline || "—", "Популярная"));
        c.appendChild(grid);

        c.appendChild(el("div", { class: "center-note" }, "Сводка обновляется при каждом открытии вкладки."));
    });
}

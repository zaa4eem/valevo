/*
 * admin/dashboard.js — GET /api/admin/stats. Plain exported render
 * function called directly by admin/shell.js's chip nav (not a router
 * screen — see shell.js for why).
 */

import { api } from "../../api.js";
import { el, clear, errorState, mountAsync } from "../../ui.js";

function statCard(icon, value, label, { warn = false } = {}) {
    const style = warn
        ? "text-align:center;padding:22px 10px;border-color:var(--danger);background:rgba(255,93,106,.08);"
        : "text-align:center;padding:22px 10px;";
    return el("div", { class: "card", style }, [
        el("div", { style: "font-size:24px;margin-bottom:8px;" }, icon),
        el("div", { style: `font-size:21px;font-weight:1000;font-style:italic;color:${warn ? "var(--danger2)" : "var(--white)"};` }, value),
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

        const benchSet = s.benchmarks_set ?? 0;
        const benchTotal = s.benchmarks_total ?? 0;
        const benchIncomplete = benchTotal > 0 && benchSet < benchTotal;
        const benchCard = statCard(
            benchIncomplete ? "⚠️" : "🎯",
            `${benchSet}/${benchTotal}`,
            benchIncomplete ? "Эталоны месяца — не все заданы, см. вкладку «Эталоны»" : "Эталоны месяца заданы",
            { warn: benchIncomplete },
        );
        c.appendChild(el("div", { style: "margin-top:10px;" }, [benchCard]));

        c.appendChild(el("div", { class: "center-note" }, "Сводка обновляется при каждом открытии вкладки."));
    });
}

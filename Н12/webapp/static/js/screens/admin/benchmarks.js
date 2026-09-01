/*
 * admin/benchmarks.js — "🎯 Эталоны месяца": monthly benchmark track/time per
 * tournament class (data/tournament.py:CLASS_LADDER). A class without a
 * benchmark this month is skipped entirely by the live scoring engine
 * (services/tournament.py) — until an admin sets one here, that class just
 * doesn't appear in "Лидеры" for anyone. Same underlying data as the bot's
 * "🎯 Эталоны месяца" chat flow (handlers/admin.py), just as a form instead
 * of a two-step FSM prompt.
 */

import { el, clear, errorState, mountAsync, openSheet, optionTile, toastSuccess, toastError } from "../../ui.js";
import { api } from "../../api.js";
import { invalidateCache } from "../../state.js";
import { haptic } from "../../telegram.js";

function openBenchmarkEditor(entry, onSaved) {
    const trackInput = el("input", { class: "input", placeholder: "Трасса (необязательно)", value: entry.track || "" });
    const timeInput = el("input", { class: "input", placeholder: "01:18.565", value: entry.benchmark_text || "", style: "margin-top:10px;" });
    const hint = el("div", { class: "field-hint", style: "margin-top:6px;" }, "Формат: мин:сек.мс, например 01:18.565");
    const saveBtn = el("button", { class: "btn btn-primary", style: "margin-top:14px;" }, "Сохранить эталон");

    let close;
    saveBtn.addEventListener("click", async () => {
        const timeText = timeInput.value.trim();
        if (!timeText) { haptic("error"); toastError("Введите эталонное время круга."); return; }
        haptic("light");
        saveBtn.disabled = true;
        const res = await api.post("/api/admin/benchmarks", {
            class_name: entry.class_name,
            track: trackInput.value.trim() || null,
            time_text: timeText,
        });
        saveBtn.disabled = false;
        if (res.ok && res.data && res.data.ok) {
            haptic("success");
            toastSuccess(`Эталон «${entry.class_name}» обновлён`);
            close();
            onSaved();
        } else {
            haptic("error");
            const msg = (res.data && res.data.error) || res.error || "Не удалось сохранить эталон.";
            toastError(msg);
        }
    });

    const title = entry.side_of ? `${entry.class_name} (доп. для ${entry.side_of})` : entry.class_name;
    const body = el("div", {}, [
        el("div", { class: "modal-title" }, `🎯 ${title}`),
        trackInput,
        timeInput,
        hint,
        saveBtn,
    ]);
    close = openSheet(body, { center: true });
}

export function renderBenchmarks(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/admin/benchmarks");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const classes = (res.data && res.data.classes) || [];
        const monthKey = (res.data && res.data.month_key) || "";

        c.appendChild(el("div", { class: "card-title", style: "margin-bottom:8px;" }, [
            el("span", {}, "Эталоны месяца"),
            el("span", { class: "track-name" }, monthKey),
        ]));

        const card = el("div", { class: "card" });
        classes.forEach((entry) => {
            const isSet = entry.benchmark_ms != null;
            const statusText = isSet ? `🗺 ${entry.track || "—"} · ⏱ ${entry.benchmark_text}` : "не задан";
            const title = entry.side_of ? `${entry.class_name} (доп. для ${entry.side_of})` : entry.class_name;
            card.appendChild(optionTile(isSet ? "✅" : "⚙️", title, statusText, () => {
                openBenchmarkEditor(entry, () => {
                    invalidateCache("leaderboard");
                    renderBenchmarks(container);
                });
            }));
        });
        c.appendChild(card);
    });
}

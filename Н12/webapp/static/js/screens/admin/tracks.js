/*
 * admin/tracks.js — track management per discipline. Plain function, called
 * by admin/shell.js's chip nav. Reuses the public GET /api/disciplines list
 * (no separate admin endpoint for that exists, and none is needed).
 */

import { api } from "../../api.js";
import { cached } from "../../state.js";
import { el, clear, emptyState, errorState, mountAsync, toastSuccess, toastError, confirmDialog } from "../../ui.js";
import { haptic } from "../../telegram.js";

function loadTrackList(container, discipline) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get(`/api/admin/tracks?discipline=${encodeURIComponent(discipline)}`);
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const tracks = (res.data && res.data.tracks) || [];
        if (tracks.length === 0) {
            c.appendChild(emptyState("Трасс пока нет", "Добавьте первую ниже."));
            return;
        }

        const card = el("div", { class: "card" });
        tracks.forEach((name) => {
            const delBtn = el("button", { class: "icon-btn", "aria-label": "Удалить" }, "🗑");
            delBtn.addEventListener("click", async () => {
                const sure = await confirmDialog({
                    title: "Удалить трассу?",
                    text: `«${name}» будет удалена из дисциплины «${discipline}».`,
                    confirmText: "Удалить",
                    danger: true,
                });
                if (!sure) return;
                haptic("light");
                const res2 = await api.del("/api/admin/tracks", { discipline, track_name: name });
                if (res2.ok && res2.data && res2.data.ok) {
                    haptic("success");
                    toastSuccess("Трасса удалена");
                    loadTrackList(container, discipline);
                } else if (res2.status !== 401) {
                    haptic("error");
                    toastError(res2.error || "Не удалось удалить трассу.");
                }
            });
            card.appendChild(el("div", { class: "list-row" }, [
                el("div", { class: "row-main" }, [el("div", { class: "row-title" }, name)]),
                delBtn,
            ]));
        });
        c.appendChild(card);
    });
}

export function renderTracks(container) {
    mountAsync(container, async (c, retry) => {
        const discRes = await cached("disciplines", () => api.get("/api/disciplines"));
        clear(c);
        if (!discRes.ok) { c.appendChild(errorState(discRes.error, retry)); return; }

        const disciplines = (discRes.data && discRes.data.disciplines) || [];
        if (disciplines.length === 0) {
            c.appendChild(emptyState("Дисциплины не найдены", null));
            return;
        }

        let selected = disciplines[0];
        const chipRow = el("div", { class: "chiprow" });
        const listWrap = el("div");

        disciplines.forEach((name) => {
            const chip = el("button", { class: `chip${name === selected ? " admin-active" : ""}` }, name);
            chip.addEventListener("click", () => {
                if (selected === name) return;
                selected = name;
                [...chipRow.children].forEach((ch) => ch.classList.remove("admin-active"));
                chip.classList.add("admin-active");
                haptic("selection");
                loadTrackList(listWrap, selected);
            });
            chipRow.appendChild(chip);
        });

        c.appendChild(chipRow);
        c.appendChild(listWrap);
        loadTrackList(listWrap, selected);

        const nameInput = el("input", { class: "input", placeholder: "Название новой трассы" });
        const addBtn = el("button", { class: "btn btn-primary btn-sm", style: "width:auto;margin-top:12px;" }, "➕ Добавить трассу");
        addBtn.addEventListener("click", async () => {
            const trackName = nameInput.value.trim();
            if (!trackName) { haptic("error"); toastError("Введите название трассы."); return; }
            haptic("light");
            addBtn.disabled = true;
            const res = await api.post("/api/admin/tracks", { discipline: selected, track_name: trackName });
            addBtn.disabled = false;
            if (res.ok && res.data && res.data.ok) {
                nameInput.value = "";
                haptic("success");
                toastSuccess("Трасса добавлена");
                loadTrackList(listWrap, selected);
            } else if (res.status !== 401) {
                const reason = res.data && res.data.reason;
                haptic("error");
                toastError(reason === "exists" ? "Такая трасса уже есть в этой дисциплине." : (res.error || "Не удалось добавить трассу."));
            }
        });

        c.appendChild(el("div", { class: "card", style: "margin-top:14px;" }, [
            el("div", { class: "card-title" }, "Новая трасса"),
            nameInput,
            addBtn,
        ]));
    });
}

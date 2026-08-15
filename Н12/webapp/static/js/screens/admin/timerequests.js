/*
 * admin/timerequests.js — time-trial moderation queue. Plain function,
 * called by admin/shell.js's chip nav.
 */

import { api } from "../../api.js";
import { el, clear, emptyState, errorState, mountAsync, toastSuccess, toastError, confirmDialog, openImageSheet } from "../../ui.js";
import { haptic } from "../../telegram.js";
import { formatWallDateTime } from "../../format.js";

const STATUS_CHIPS = [
    { key: "pending", label: "⏳ Ожидают" },
    { key: "approved", label: "✅ Одобрены" },
    { key: "rejected", label: "❌ Отклонены" },
    { key: "expired", label: "⌛ Истекли" },
];

function requestCard(r, status, onChanged) {
    const card = el("div", { class: "card" });

    if (r.photo_url) {
        const photoBox = el("div", { class: "req-photo tappable" }, [
            el("img", { src: r.photo_url, alt: "Фото результата", loading: "lazy" }),
        ]);
        photoBox.addEventListener("click", () => { haptic("light"); openImageSheet(r.photo_url, "Фото результата"); });
        card.appendChild(photoBox);
    }

    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Пилот"), el("span", { class: "v" }, r.pilot_name + (r.pilot_number ? ` · #${r.pilot_number}` : ""))]));
    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Дисциплина"), el("span", { class: "v" }, r.discipline)]));
    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Трасса"), el("span", { class: "v" }, r.track)]));
    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Время"), el("span", { class: "v", style: "color:var(--cyan2);" }, r.lap_time_text)]));
    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Подано"), el("span", { class: "v" }, formatWallDateTime(r.created_at))]));

    if (status === "pending") {
        const approveBtn = el("button", { class: "btn btn-primary btn-sm" }, "✅ Одобрить");
        const rejectBtn = el("button", { class: "btn btn-danger btn-sm" }, "❌ Отклонить");

        approveBtn.addEventListener("click", async () => {
            haptic("light");
            approveBtn.disabled = true; rejectBtn.disabled = true;
            const res = await api.post(`/api/admin/time-requests/${r.id}/approve`);
            if (res.ok && res.data && res.data.ok) {
                haptic("success"); toastSuccess("Заявка одобрена"); onChanged();
            } else if (res.status !== 401) {
                haptic("error"); toastError((res.data && res.data.error) || res.error || "Не удалось одобрить.");
                approveBtn.disabled = false; rejectBtn.disabled = false;
            }
        });

        rejectBtn.addEventListener("click", async () => {
            const sure = await confirmDialog({
                title: "Отклонить заявку?",
                text: `${r.pilot_name} · ${r.discipline} · ${r.lap_time_text}`,
                confirmText: "Отклонить",
                danger: true,
            });
            if (!sure) return;
            haptic("light");
            approveBtn.disabled = true; rejectBtn.disabled = true;
            const res = await api.post(`/api/admin/time-requests/${r.id}/reject`);
            if (res.ok && res.data && res.data.ok) {
                haptic("success"); toastSuccess("Заявка отклонена"); onChanged();
            } else if (res.status !== 401) {
                haptic("error"); toastError(res.error || "Не удалось отклонить.");
                approveBtn.disabled = false; rejectBtn.disabled = false;
            }
        });

        card.appendChild(el("div", { class: "btn-row", style: "margin-top:12px;" }, [approveBtn, rejectBtn]));
    }

    return card;
}

function loadRequests(container, status) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get(`/api/admin/time-requests?status=${encodeURIComponent(status)}`);
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const requests = (res.data && res.data.requests) || [];
        if (requests.length === 0) {
            c.appendChild(emptyState("Пусто", "Заявок с этим статусом нет."));
            return;
        }

        const stack = el("div", { class: "stack-sm" });
        requests.forEach((r) => stack.appendChild(requestCard(r, status, () => loadRequests(container, status))));
        c.appendChild(stack);
    });
}

export function renderTimeRequests(container) {
    clear(container);

    let selected = "pending";
    const chipRow = el("div", { class: "chiprow" });
    const listWrap = el("div");

    STATUS_CHIPS.forEach((s) => {
        const chip = el("button", { class: `chip${s.key === selected ? " admin-active" : ""}` }, s.label);
        chip.addEventListener("click", () => {
            if (selected === s.key) return;
            selected = s.key;
            [...chipRow.children].forEach((ch) => ch.classList.remove("admin-active"));
            chip.classList.add("admin-active");
            haptic("selection");
            loadRequests(listWrap, selected);
        });
        chipRow.appendChild(chip);
    });

    container.appendChild(chipRow);
    container.appendChild(listWrap);
    loadRequests(listWrap, selected);
}

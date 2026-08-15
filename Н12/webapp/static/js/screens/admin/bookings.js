/*
 * admin/bookings.js — booking moderation queue. Plain function, called by
 * admin/shell.js's chip nav.
 */

import { api } from "../../api.js";
import { el, clear, emptyState, errorState, mountAsync, toastSuccess, toastError, confirmDialog } from "../../ui.js";
import { haptic } from "../../telegram.js";
import { formatWallDateTime, formatMinutes } from "../../format.js";

const STATUS_CHIPS = [
    { key: "pending_admin", label: "⏳ Ожидают" },
    { key: "confirmed", label: "✅ Подтверждены" },
    { key: "rejected", label: "❌ Отклонены" },
    { key: "cancelled", label: "🚫 Отменены" },
];

function adminBookingCard(b, status, onChanged) {
    const card = el("div", { class: "card" });

    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Пилот"), el("span", { class: "v" }, b.display_name || "—")]));
    if (b.phone) card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Телефон"), el("span", { class: "v" }, b.phone)]));
    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Места"), el("span", { class: "v" }, (b.items || []).map((i) => i.place_title).join(", ") || b.place_type)]));
    card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Когда"), el("span", { class: "v" }, `${formatWallDateTime(b.start_at)} · ${formatMinutes(b.duration_minutes)}`)]));
    if (b.last_error) card.appendChild(el("div", { class: "field-error", style: "margin-top:8px;" }, b.last_error));

    if (status === "pending_admin") {
        const approveBtn = el("button", { class: "btn btn-primary btn-sm" }, "✅ Подтвердить");
        const rejectBtn = el("button", { class: "btn btn-danger btn-sm" }, "❌ Отклонить");

        approveBtn.addEventListener("click", async () => {
            haptic("light");
            approveBtn.disabled = true; rejectBtn.disabled = true;
            const res = await api.post(`/api/admin/bookings/${b.id}/approve`);
            if (res.ok && res.data && res.data.ok) {
                haptic("success"); toastSuccess("Бронь подтверждена"); onChanged();
            } else if (res.status !== 401) {
                haptic("error"); toastError((res.data && res.data.error) || res.error || "Не удалось подтвердить.");
                approveBtn.disabled = false; rejectBtn.disabled = false;
            }
        });

        rejectBtn.addEventListener("click", async () => {
            const sure = await confirmDialog({
                title: "Отклонить бронь?",
                text: `${b.display_name || "Пилот"} · ${formatWallDateTime(b.start_at)}`,
                confirmText: "Отклонить",
                danger: true,
            });
            if (!sure) return;
            haptic("light");
            approveBtn.disabled = true; rejectBtn.disabled = true;
            const res = await api.post(`/api/admin/bookings/${b.id}/reject`);
            if (res.ok && res.data && res.data.ok) {
                haptic("success"); toastSuccess("Бронь отклонена"); onChanged();
            } else if (res.status !== 401) {
                haptic("error"); toastError(res.error || "Не удалось отклонить.");
                approveBtn.disabled = false; rejectBtn.disabled = false;
            }
        });

        card.appendChild(el("div", { class: "btn-row", style: "margin-top:12px;" }, [approveBtn, rejectBtn]));
    }

    return card;
}

function loadAdminBookings(container, status) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get(`/api/admin/bookings?status=${encodeURIComponent(status)}`);
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const bookings = (res.data && res.data.bookings) || [];
        if (bookings.length === 0) {
            c.appendChild(emptyState("Пусто", "Броней с этим статусом нет."));
            return;
        }

        const stack = el("div", { class: "stack-sm" });
        bookings.forEach((b) => stack.appendChild(adminBookingCard(b, status, () => loadAdminBookings(container, status))));
        c.appendChild(stack);
    });
}

export function renderAdminBookings(container) {
    clear(container);

    let selected = "pending_admin";
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
            loadAdminBookings(listWrap, selected);
        });
        chipRow.appendChild(chip);
    });

    container.appendChild(chipRow);
    container.appendChild(listWrap);
    loadAdminBookings(listWrap, selected);
}

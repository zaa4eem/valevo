/*
 * admin/broadcast.js — broadcast composer. Plain function, called by
 * admin/shell.js's chip nav.
 */

import { api } from "../../api.js";
import { el, clear, toastSuccess, toastError, confirmDialog } from "../../ui.js";
import { haptic } from "../../telegram.js";

function statTile(value, label) {
    return el("div", { class: "stat-tile" }, [
        el("div", { class: "stat-value" }, value),
        el("div", { class: "stat-label" }, label),
    ]);
}

export function renderBroadcast(container) {
    clear(container);

    const textarea = el("textarea", { class: "textarea", placeholder: "Текст рассылки всем пилотам клуба…", style: "min-height:160px;" });
    const sendBtn = el("button", { class: "btn btn-primary" }, "📢 Отправить рассылку");
    const resultBox = el("div");

    sendBtn.addEventListener("click", async () => {
        const text = textarea.value.trim();
        if (!text) { haptic("error"); toastError("Введите текст рассылки."); return; }

        const sure = await confirmDialog({
            title: "Отправить рассылку?",
            text: "Сообщение получат все пилоты клуба. Действие нельзя отменить.",
            confirmText: "Отправить",
            danger: true,
        });
        if (!sure) return;

        haptic("light");
        sendBtn.disabled = true;
        sendBtn.textContent = "Отправляем…";

        const res = await api.post("/api/admin/broadcast", { text });

        sendBtn.disabled = false;
        sendBtn.textContent = "📢 Отправить рассылку";

        if (res.ok && res.data && res.data.ok) {
            haptic("success");
            toastSuccess(`Отправлено: ${res.data.sent ?? 0}, не доставлено: ${res.data.failed ?? 0}`);
            clear(resultBox);
            resultBox.appendChild(el("div", { class: "card" }, [
                el("div", { class: "card-title" }, "Результат"),
                el("div", { class: "stat-grid cols-2" }, [
                    statTile(String(res.data.sent ?? 0), "Доставлено"),
                    statTile(String(res.data.failed ?? 0), "Не доставлено"),
                ]),
            ]));
            textarea.value = "";
        } else if (res.status !== 401) {
            haptic("error");
            toastError(res.error || "Не удалось отправить рассылку.");
        }
    });

    container.appendChild(el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "📢 Рассылка"),
        el("div", { class: "field" }, [
            el("div", { class: "field-label" }, "Сообщение"),
            textarea,
        ]),
        sendBtn,
    ]));
    container.appendChild(resultBox);
}

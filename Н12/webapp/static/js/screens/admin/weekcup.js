/*
 * admin/weekcup.js — Week Cup close (confirm dialog → report). Plain
 * function, called by admin/shell.js's chip nav.
 */

import { api } from "../../api.js";
import { el, clear, toastSuccess, toastError, confirmDialog } from "../../ui.js";
import { haptic } from "../../telegram.js";

export function renderWeekCup(container) {
    clear(container);

    const resultBox = el("div");
    const closeBtn = el("button", { class: "btn btn-gold" }, "🏁 Закрыть неделю");

    closeBtn.addEventListener("click", async () => {
        const sure = await confirmDialog({
            title: "Закрыть Week Cup?",
            text: "Подводятся итоги недели и начисляются награды пилотам. Действие необратимо.",
            confirmText: "Да, закрыть",
            danger: true,
        });
        if (!sure) return;

        haptic("light");
        closeBtn.disabled = true;
        closeBtn.textContent = "Закрываем…";

        const res = await api.post("/api/admin/weekcup/close");

        closeBtn.disabled = false;
        closeBtn.textContent = "🏁 Закрыть неделю";

        if (res.ok && res.data && res.data.ok) {
            haptic("success");
            toastSuccess("Неделя закрыта");
            clear(resultBox);
            resultBox.appendChild(el("div", { class: "card" }, [
                el("div", { class: "card-title" }, "📋 Отчёт"),
                el("div", { class: "pre-block" }, res.data.report || ""),
            ]));
        } else if (res.status !== 401) {
            haptic("error");
            toastError((res.data && res.data.error) || res.error || "Не удалось закрыть неделю.");
        }
    });

    container.appendChild(el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "🏁 Week Cup"),
        el("div", { class: "field-hint", style: "margin-bottom:16px;" }, "Подводит итоги недели: считает результаты, начисляет награды и формирует отчёт для клуба."),
        closeBtn,
    ]));
    container.appendChild(resultBox);
}

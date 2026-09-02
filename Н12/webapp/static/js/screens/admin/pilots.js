/*
 * admin/pilots.js — pilot search list (plain function, called by
 * admin/shell.js's chip nav) + pilot detail (a genuine drill-down, so it
 * IS a registered router screen — BackButton should return to the search
 * results, not jump straight to Профиль).
 */

import { registerScreen, push } from "../../router.js";
import { api } from "../../api.js";
import { el, clear, emptyState, errorState, mountAsync, spinnerBlock, toastSuccess, toastError, toastWarning } from "../../ui.js";
import { haptic } from "../../telegram.js";
import { formatRub, initials } from "../../format.js";

const LIST_LIMIT = 60;

function pilotRow(p) {
    const name = p.display_name || (p.username ? `@${p.username}` : "Пилот");
    const sub = `${p.username ? "@" + p.username : "без username"}${p.pilot_number ? " · #" + p.pilot_number : ""}${p.tournament_class ? " · " + p.tournament_class : ""}`;
    return el("button", {
        class: "card-soft pilot-card",
        style: "width:100%;text-align:left;cursor:pointer;",
        onClick: () => { haptic("selection"); push("admin-pilot-detail", { telegramId: p.telegram_id }); },
    }, [
        el("div", { class: "pilot-avatar" }, initials(name)),
        el("div", { style: "flex:1 1 auto;min-width:0;" }, [
            el("div", { style: "font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" }, name),
            el("div", { class: "field-hint" }, sub),
        ]),
        el("div", { style: "font-weight:1000;color:var(--cyan2);flex:0 0 auto;" }, String(p.rating)),
    ]);
}

function loadPilotList(container, query) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get(`/api/admin/pilots?query=${encodeURIComponent(query)}`);
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const pilots = (res.data && res.data.pilots) || [];
        if (pilots.length === 0) {
            c.appendChild(emptyState("Ничего не найдено", query ? "Попробуйте другой запрос." : "Пилотов пока нет."));
            return;
        }

        const shown = pilots.slice(0, LIST_LIMIT);
        const stack = el("div", { class: "stack-sm" });
        shown.forEach((p) => stack.appendChild(pilotRow(p)));
        c.appendChild(stack);

        if (pilots.length > LIST_LIMIT) {
            c.appendChild(el("div", { class: "center-note" }, `Показаны первые ${LIST_LIMIT} из ${pilots.length}. Уточните запрос.`));
        }
    });
}

export function renderPilots(container) {
    clear(container);

    const searchInput = el("input", { class: "input", type: "search", placeholder: "Поиск по номеру или username…" });
    const list = el("div");

    let debounceTimer = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => loadPilotList(list, searchInput.value.trim()), 350);
    });

    container.appendChild(el("div", { class: "pilot-search-row" }, [searchInput]));
    container.appendChild(list);
    loadPilotList(list, "");
}

/* ------------------------------------------------------------------ */
/* Pilot detail (router-registered drill-down)                          */
/* ------------------------------------------------------------------ */

function kv(k, v) {
    return el("div", { class: "kv-row" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v)]);
}

function quickBtn(delta, formatFn, onAdjust) {
    const label = (delta > 0 ? "+" : "") + formatFn(delta);
    const btn = el("button", { class: `btn btn-sm ${delta > 0 ? "btn-outline" : "btn-ghost"}` }, label);
    btn.addEventListener("click", async () => {
        btn.disabled = true;
        await onAdjust(delta);
        btn.disabled = false;
    });
    return btn;
}

function customDeltaRow(placeholder, onSubmit) {
    const input = el("input", { class: "input", type: "number", inputmode: "decimal", placeholder, style: "flex:1;" });
    const btn = el("button", { class: "btn btn-primary btn-sm", style: "width:auto;" }, "Применить");
    btn.addEventListener("click", async () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v) || v === 0) { haptic("error"); toastError("Введите ненулевое число."); return; }
        btn.disabled = true;
        await onSubmit(v);
        btn.disabled = false;
        input.value = "";
    });
    return el("div", { class: "stepper-input-row", style: "margin-top:10px;" }, [input, btn]);
}

function drawDetail(container, p) {
    clear(container);
    const name = p.display_name || (p.username ? `@${p.username}` : "Пилот");

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [el("h1", { class: "screen-title" }, name), el("p", { class: "screen-sub" }, p.username ? `@${p.username}` : "без username")]),
    ]));

    const idCard = el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "🆔 Данные"),
        kv("Telegram ID", String(p.telegram_id)),
        kv("Номер пилота", p.pilot_number ? `#${p.pilot_number}` : "—"),
        kv("Телефон", p.phone || "—"),
        kv("Класс турнира", p.tournament_class || "—"),
    ]);
    container.appendChild(idCard);

    // Rating
    const ratingCard = el("div", { class: "card" });
    ratingCard.appendChild(el("div", { class: "card-title" }, "⭐ Рейтинг"));
    const ratingValue = el("div", { style: "font-size:30px;font-weight:1000;font-style:italic;text-align:center;margin:4px 0 14px;" }, String(p.rating));
    ratingCard.appendChild(ratingValue);

    async function adjustRating(delta) {
        haptic("light");
        const res = await api.post(`/api/admin/pilots/${p.telegram_id}/rating`, { delta });
        if (res.ok && res.data && res.data.ok) {
            p.rating = res.data.rating;
            ratingValue.textContent = String(p.rating);
            haptic("success");
            toastSuccess(`Рейтинг изменён: ${p.rating}`);
        } else if (res.status !== 401) {
            haptic("error");
            toastError((res.data && res.data.error) || res.error || "Не удалось изменить рейтинг.");
        }
    }

    const ratingBtns = el("div", { class: "quick-amounts" });
    [-20, -5, 5, 20].forEach((d) => ratingBtns.appendChild(quickBtn(d, (n) => String(n), adjustRating)));
    ratingCard.appendChild(ratingBtns);
    ratingCard.appendChild(customDeltaRow("своё значение (+/-)", adjustRating));
    container.appendChild(ratingCard);

    // Balance
    const balanceCard = el("div", { class: "card" });
    balanceCard.appendChild(el("div", { class: "card-title" }, "💰 Бонусный счёт"));
    const balanceValue = el("div", { style: "font-size:30px;font-weight:1000;font-style:italic;text-align:center;margin:4px 0 14px;" }, formatRub(p.bonus_balance));
    balanceCard.appendChild(balanceValue);

    async function adjustBalance(delta) {
        haptic("light");
        const res = await api.post(`/api/admin/pilots/${p.telegram_id}/balance`, { delta });
        if (res.ok && res.data && res.data.ok) {
            p.bonus_balance = res.data.balance;
            balanceValue.textContent = formatRub(p.bonus_balance);
            haptic("success");
            toastSuccess(`Баланс изменён: ${formatRub(p.bonus_balance)}`);
        } else if (res.ok && res.data && res.data.queued) {
            haptic("warning");
            toastWarning("Сервис недоступен — операция поставлена в очередь и применится автоматически.");
        } else if (res.status !== 401) {
            haptic("error");
            toastError((res.data && res.data.error) || res.error || "Не удалось изменить баланс.");
        }
    }

    const balanceBtns = el("div", { class: "quick-amounts" });
    [-500, -100, 100, 500].forEach((d) => balanceBtns.appendChild(quickBtn(d, (n) => formatRub(n), adjustBalance)));
    balanceCard.appendChild(balanceBtns);
    balanceCard.appendChild(customDeltaRow("сумма в ₽ (+/-)", adjustBalance));
    container.appendChild(balanceCard);

    // Pilot number
    const numberCard = el("div", { class: "card" });
    numberCard.appendChild(el("div", { class: "card-title" }, "🔢 Номер пилота"));
    const numberInput = el("input", { class: "input", type: "number", inputmode: "numeric", value: p.pilot_number || "", placeholder: "например 42" });
    const numberBtn = el("button", { class: "btn btn-outline btn-sm", style: "margin-top:10px;width:auto;" }, "Сохранить номер");
    numberBtn.addEventListener("click", async () => {
        const n = parseInt(numberInput.value, 10);
        if (!Number.isFinite(n) || n <= 0) { haptic("error"); toastError("Введите корректный номер."); return; }
        haptic("light");
        numberBtn.disabled = true;
        const res = await api.post(`/api/admin/pilots/${p.telegram_id}/number`, { number: n });
        numberBtn.disabled = false;
        if (res.ok && res.data && res.data.ok) {
            p.pilot_number = n;
            haptic("success");
            toastSuccess("Номер сохранён");
        } else if (res.status !== 401) {
            haptic("error");
            toastError((res.data && res.data.error) || res.error || "Не удалось сохранить номер.");
        }
    });
    numberCard.appendChild(el("div", { class: "field" }, [numberInput]));
    numberCard.appendChild(numberBtn);
    container.appendChild(numberCard);

    // Роулетка: своя карточка, грузится отдельно и не блокирует остальной
    // экран (specs/001-roulette-spin-audit) — реального объёма истории мало,
    // но список нужен именно "по требованию", а не в основном payload'е пилота.
    const spinsCard = el("div", { class: "card" });
    spinsCard.appendChild(el("div", { class: "card-title" }, "🎰 История спинов"));
    const spinsBody = el("div", {}, [spinnerBlock()]);
    spinsCard.appendChild(spinsBody);
    container.appendChild(spinsCard);
    loadSpinHistory(spinsBody, p.telegram_id);
}

const SPIN_STATUS_LABEL = { ok: "выдан", queued: "в очереди", failed: "ошибка" };

function spinStatusBadge(status) {
    const cls = status === "ok" ? "badge-cyan" : status === "queued" ? "badge-amber" : "badge-danger";
    return el("span", { class: `badge ${cls}` }, SPIN_STATUS_LABEL[status] || status);
}

async function loadSpinHistory(container, telegramId) {
    const res = await api.get(`/api/admin/pilots/${telegramId}/spins`);
    clear(container);
    if (!res.ok) { container.appendChild(errorState(res.error, () => loadSpinHistory(container, telegramId))); return; }

    const spins = (res.data && res.data.spins) || [];
    if (spins.length === 0) {
        container.appendChild(el("div", { class: "state-text", style: "text-align:center;padding:6px 0;" }, "Пока не крутил рулетку."));
        return;
    }

    spins.forEach((s) => {
        const valueText = s.kind === "bonus" ? `+${s.value} ₽` : `+${s.value} рейтинга`;
        container.appendChild(el("div", { class: "kv-row" }, [
            el("span", { class: "k" }, `${s.emoji} ${s.title}`),
            el("div", { style: "display:flex;align-items:center;gap:8px;" }, [
                el("span", { class: "v" }, valueText),
                spinStatusBadge(s.status),
            ]),
        ]));
    });
}

function renderPilotDetail(container, params) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get(`/api/admin/pilots/${params.telegramId}`);
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }
        drawDetail(c, res.data || {});
    });
}

registerScreen("admin-pilot-detail", renderPilotDetail);

/*
 * roulette.js — "🎰 Рулетка призов". Списывает реальные Valevo Bonus ₽ через
 * POST /api/roulette/spin (services/roulette.py) и крутит slot-reel до
 * выпавшего приза. Пушится с профиля (см. profile.js:buildClubCard).
 */

import { registerScreen } from "../router.js";
import { api } from "../api.js";
import { el, clear, errorState, mountAsync, openSheet, toastError, toastSuccess } from "../ui.js";
import { haptic } from "../telegram.js";
import { formatRub } from "../format.js";

const CELL_WIDTH = 84;
const STRIP_LOOPS = 4;
const MIN_SPIN_CELLS = 60; // минимум 3 полных прохода каталога, чтобы анимация не выглядела куце
const SPIN_MS = 3200;

function reelCell(prize) {
    return el("div", { class: "roulette-cell" }, [
        el("div", { class: "rc-emoji" }, prize.emoji),
        el("div", { class: "rc-value" }, prize.title),
    ]);
}

function buildResultBody(result) {
    const isBonus = result.kind === "bonus";
    const valueText = isBonus ? `+${result.value} ₽` : `+${result.value} рейтинга`;
    const statusNote = result.prize_status === "queued"
        ? "Приз поставлен в очередь на зачисление — придёт автоматически в течение пары минут."
        : "";
    return el("div", { style: "text-align:center;" }, [
        el("div", { style: "font-size:48px;line-height:1;" }, result.emoji),
        el("div", { class: "modal-title", style: "margin-top:12px;" }, result.title),
        el("div", { style: "margin-top:6px;font-size:20px;font-weight:1000;font-style:italic;color:var(--gold2);" }, valueText),
        statusNote ? el("div", { class: "field-hint", style: "margin-top:10px;" }, statusNote) : null,
    ]);
}

function renderRouletteScreen(container, data) {
    clear(container);

    const prizes = data.prizes;
    let balance = data.balance;

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [
            el("h1", { class: "screen-title" }, "Рулетка"),
            el("p", { class: "screen-sub" }, "испытай удачу"),
        ]),
    ]));

    const card = el("div", { class: "card" });

    const balanceValueEl = el("span", { class: "b-value" }, formatRub(balance));
    card.appendChild(el("div", { class: "roulette-balance-row" }, [
        el("span", { class: "b-label" }, "Баланс Valevo Bonus"),
        balanceValueEl,
    ]));

    const track = el("div", { class: "roulette-reel-track" });
    const viewport = el("div", { class: "roulette-reel-viewport" }, [
        track,
        el("div", { class: "roulette-pointer" }),
    ]);
    card.appendChild(viewport);

    function fillTrack(startIndex = 0) {
        clear(track);
        track.style.transition = "none";
        track.style.transform = "translateX(0)";
        for (let i = 0; i < STRIP_LOOPS * prizes.length; i++) {
            track.appendChild(reelCell(prizes[(startIndex + i) % prizes.length]));
        }
    }
    fillTrack();

    const costNote = el("div", { class: "field-hint", style: "text-align:center;margin-top:10px;" },
        `Один спин — ${data.spin_cost} ₽ со счёта Valevo Bonus`);
    card.appendChild(costNote);

    const spinBtn = el("button", { class: "roulette-spin-btn" }, `🎰 Крутить за ${data.spin_cost} ₽`);
    card.appendChild(spinBtn);

    spinBtn.addEventListener("click", async () => {
        if (balance < data.spin_cost) {
            haptic("error");
            toastError(`Недостаточно средств — на счету ${formatRub(balance)}`);
            return;
        }

        haptic("light");
        spinBtn.disabled = true;

        const res = await api.post("/api/roulette/spin");

        if (!res.ok || !res.data || !res.data.ok) {
            spinBtn.disabled = false;
            haptic("error");
            const msg = (res.data && res.data.error) || res.error || "Не удалось раскрутить рулетку.";
            toastError(msg);
            return;
        }

        const result = res.data;
        const winIndex = prizes.findIndex((p) => p.code === result.code);

        // Пересобираем ленту с нуля и мгновенно ставим в 0 — так не нужно
        // хранить позицию между спинами и подращивать бесконечную ленту.
        fillTrack();
        void track.offsetWidth; // форсируем reflow, иначе transition:none не применится до следующего кадра

        const targetIndex = MIN_SPIN_CELLS + (((winIndex - MIN_SPIN_CELLS) % prizes.length) + prizes.length) % prizes.length;
        const viewportWidth = viewport.clientWidth;
        const tx = viewportWidth / 2 - CELL_WIDTH / 2 - targetIndex * CELL_WIDTH;

        requestAnimationFrame(() => {
            track.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.12,.86,.15,1)`;
            track.style.transform = `translateX(${tx}px)`;
        });

        setTimeout(() => {
            haptic(result.kind === "bonus" && result.value >= 2000 ? "success" : "light");
            balance = result.balance;
            balanceValueEl.textContent = formatRub(balance);
            openSheet(buildResultBody(result), { center: true });
            spinBtn.disabled = false;
        }, SPIN_MS + 150);
    });

    container.appendChild(card);

    const legendCard = el("div", { class: "card", style: "margin-top:12px;" });
    legendCard.appendChild(el("div", { class: "card-title" }, "🎁 Возможные призы"));
    const grid = el("div", { class: "roulette-prize-grid" });
    prizes.forEach((p) => {
        grid.appendChild(el("div", { class: "roulette-prize-tile" }, [
            el("div", { class: "rp-emoji" }, p.emoji),
            el("div", { class: "rp-value" }, p.title),
        ]));
    });
    legendCard.appendChild(grid);
    container.appendChild(legendCard);
}

function renderRoulette(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/roulette");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }
        renderRouletteScreen(c, res.data);
    });
}

registerScreen("roulette", renderRoulette);

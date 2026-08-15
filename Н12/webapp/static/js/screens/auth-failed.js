/*
 * auth-failed.js — full-screen lock shown when the backend rejects initData
 * (HTTP 401 on any request). Triggered centrally by main.js on the
 * "tma:auth-failed" window event dispatched from api.js.
 */

import { el } from "../ui.js";

export function renderAuthFailed(container) {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "fullscreen" }, [
        el("div", { class: "state-icon", style: "font-size:46px;" }, "🔒"),
        el("div", { class: "fs-title" }, "Не удалось подтвердить личность в Telegram"),
        el("div", { class: "fs-text" }, "Перезапустите приложение."),
    ]));
}

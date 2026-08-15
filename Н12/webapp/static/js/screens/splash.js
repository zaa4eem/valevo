/*
 * splash.js — shown while GET /api/me is in flight. Not part of the router
 * (there is no tab bar yet at this point) — main.js mounts it directly.
 */

import { el } from "../ui.js";

export function renderSplash(container) {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "fullscreen" }, [
        el("img", { class: "fs-logo", src: "/static/logo.png", alt: "VALEVO" }),
        el("div", { class: "spinner" }),
        el("div", { class: "splash-eyebrow" }, "клубная экосистема"),
    ]));
}

/*
 * ui.js — shared DOM/UI building blocks: element builder, toasts, skeletons,
 * empty/error states, modals. No framework, just small composable helpers.
 */

import { haptic } from "./telegram.js";

/* ------------------------------------------------------------------ */
/* DOM builder                                                          */
/* ------------------------------------------------------------------ */

/**
 * el('div', {class:'card', onClick:fn}, [child, 'text', el(...)])
 * Values are set via textContent/attributes (safe by default). Pass
 * `html: '<b>trusted markup</b>'` only for strings you've already escaped
 * yourself (see escapeHtml in format.js).
 */
export function el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    for (const key in attrs) {
        const value = attrs[key];
        if (value == null || value === false) continue;
        if (key === "class") node.className = value;
        else if (key === "html") node.innerHTML = value;
        else if (key === "dataset") { for (const dk in value) node.dataset[dk] = value[dk]; }
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, value);
    }
    const kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
    for (const child of kids) {
        if (child == null || child === false) continue;
        node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    }
    return node;
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(container, node) {
    clear(container);
    container.appendChild(node);
}

/* ------------------------------------------------------------------ */
/* Toasts                                                               */
/* ------------------------------------------------------------------ */

const TOAST_ICON = { success: "✅", error: "⚠️", warning: "🟡", default: "🏁" };

export function toast(message, { type = "default", duration = 2800 } = {}) {
    const root = document.getElementById("toast-root");
    if (!root || !message) return;

    const node = el("div", { class: `toast toast-${type}` }, [
        el("span", { class: "toast-icon" }, TOAST_ICON[type] || TOAST_ICON.default),
        el("span", { class: "toast-msg" }, String(message)),
    ]);
    root.appendChild(node);

    const remove = () => {
        node.classList.add("leaving");
        setTimeout(() => node.remove(), 240);
    };
    setTimeout(remove, duration);
    node.addEventListener("click", remove);
}

export function toastSuccess(message) { haptic("success"); toast(message, { type: "success" }); }
export function toastError(message) { haptic("error"); toast(message, { type: "error", duration: 3600 }); }
export function toastWarning(message) { haptic("warning"); toast(message, { type: "warning", duration: 3600 }); }

/* ------------------------------------------------------------------ */
/* Skeletons                                                            */
/* ------------------------------------------------------------------ */

export function skeletonCards(count = 3) {
    const wrap = el("div");
    for (let i = 0; i < count; i++) wrap.appendChild(el("div", { class: "skel skel-card" }));
    return wrap;
}

export function skeletonLines(widths = ["80%", "60%", "40%"]) {
    const wrap = el("div", { class: "card" });
    widths.forEach((w) => wrap.appendChild(el("div", { class: "skel skel-line", style: `width:${w}` })));
    return wrap;
}

/* ------------------------------------------------------------------ */
/* Empty / error / loading states                                       */
/* ------------------------------------------------------------------ */

export function stateBlock({ icon = "🏁", title, text, actionText, onAction, error = false } = {}) {
    const children = [el("div", { class: "state-icon" }, icon)];
    if (title) children.push(el("div", { class: "state-title" }, title));
    if (text) children.push(el("div", { class: "state-text" }, text));
    if (actionText && onAction) {
        children.push(el("button", {
            class: "btn btn-outline btn-sm",
            style: "width:auto;margin:0 auto;",
            onClick: onAction,
        }, actionText));
    }
    return el("div", { class: `state-block${error ? " state-error" : ""}` }, children);
}

export function emptyState(title, text, opts = {}) {
    return stateBlock({ icon: opts.icon || "🏁", title, text, actionText: opts.actionText, onAction: opts.onAction });
}

export function errorState(message, onRetry, opts = {}) {
    return stateBlock({
        icon: opts.icon || "⚠️",
        title: opts.title || "Не удалось загрузить",
        text: message || "Проверьте соединение и попробуйте снова.",
        actionText: onRetry ? "Повторить" : null,
        onAction: onRetry,
        error: true,
    });
}

export function spinnerBlock(text) {
    return el("div", { class: "state-block" }, [
        el("div", { class: "spinner", style: "margin:0 auto 14px;" }),
        text ? el("div", { class: "state-text" }, text) : null,
    ]);
}

/**
 * Runs an async render task with a generic top-level catch: if `task`
 * throws (network blew up, unexpected shape, etc.) the container falls back
 * to a generic error+retry instead of a blank/broken screen. Screens are
 * still free to render their own specific empty/error branches inside
 * `task` for the expected {ok:false} cases — this is just the safety net.
 */
export function mountAsync(container, task) {
    const run = () => {
        clear(container);
        container.appendChild(spinnerBlock());
        Promise.resolve()
            .then(() => task(container, run))
            .catch((err) => {
                console.error(err);
                clear(container);
                container.appendChild(errorState("Что-то пошло не так на экране. Попробуйте ещё раз.", run));
            });
    };
    run();
}

/* ------------------------------------------------------------------ */
/* Modal sheet / confirm dialog                                         */
/* ------------------------------------------------------------------ */

export function openSheet(contentNode, { center = false } = {}) {
    const root = document.getElementById("modal-root");
    const backdrop = el("div", { class: "modal-backdrop" });
    const sheet = el("div", { class: `modal-sheet${center ? " modal-center" : ""}` }, contentNode);
    backdrop.appendChild(sheet);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    root.appendChild(backdrop);
    function close() { backdrop.remove(); }
    return close;
}

export function confirmDialog({ title, text, confirmText = "Подтвердить", cancelText = "Отмена", danger = false } = {}) {
    return new Promise((resolve) => {
        let close;
        const body = el("div", {}, [
            title ? el("div", { class: "modal-title" }, title) : null,
            text ? el("div", { class: "modal-text" }, text) : null,
            el("div", { class: "btn-row" }, [
                el("button", {
                    class: "btn btn-ghost",
                    onClick: () => { close(); resolve(false); },
                }, cancelText),
                el("button", {
                    class: `btn ${danger ? "btn-danger" : "btn-primary"}`,
                    onClick: () => { close(); resolve(true); },
                }, confirmText),
            ]),
        ]);
        close = openSheet(body, { center: true });
    });
}

/* ------------------------------------------------------------------ */
/* Small shared composites                                              */
/* ------------------------------------------------------------------ */

/** Full-width tappable row: icon + title (+ optional subtitle) + chevron. Fires a light selection haptic on tap. */
export function optionTile(icon, title, sub, onClick) {
    return el("button", { class: "option-tile", onClick: () => { haptic("selection"); onClick(); } }, [
        el("div", {}, [
            el("div", {}, `${icon} ${title}`),
            sub ? el("div", { class: "field-hint", style: "margin-top:4px;font-weight:600;" }, sub) : null,
        ]),
        el("span", { class: "opt-arrow" }, "›"),
    ]);
}

export function openImageSheet(src, alt = "") {
    const body = el("div", { style: "text-align:center;" }, [
        el("img", { src, alt, style: "max-width:100%;border-radius:14px;border:1px solid var(--border);" }),
    ]);
    openSheet(body, { center: true });
}

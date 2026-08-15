/*
 * router.js — small stack-based router.
 *
 * Model: each bottom tab owns its own navigation stack (array of
 * {screen, params}). Switching tabs never resets the other tabs' stacks, so
 * e.g. a half-finished booking wizard is still there if the user pokes at
 * Профиль and comes back. Telegram's BackButton always pops the *active*
 * tab's stack; at a tab's root it jumps back to the Профиль (home) tab
 * instead, per the product spec. Our own bottom tab bar is only shown at a
 * tab's root (stack depth 1) — everything deeper is a full-bleed pushed
 * screen, which is also where MainButton-driven screens live, so the two
 * never fight for the same strip of screen.
 *
 * Screens are plain functions registered by key:
 *   registerScreen('profile', async (container, params) => { ...; return cleanup; })
 * render() may be sync or async, and may return a cleanup function (called
 * right before the next render, e.g. to clear a countdown interval).
 */

import { bindBackButton, setBackButtonVisible, hideMainButton, haptic } from "./telegram.js";
import { clear, el, errorState } from "./ui.js";

const screens = new Map();
const stacks = new Map(); // tabId -> [{screen, params}]
let tabs = [];
let activeTabId = null;
let currentCleanup = null;
let viewEl = null;
let tabbarEl = null;

export function registerScreen(key, renderFn) {
    screens.set(key, renderFn);
}

export function initRouter({ view, tabbar }) {
    viewEl = view;
    tabbarEl = tabbar;
    bindBackButton(back);
}

/**
 * setTabs([{ id, label, icon, admin, root:{screen, params} }, ...])
 * Rebuilds the tab bar DOM and (re)initializes any stack that doesn't exist
 * yet — existing stacks (and their in-progress flows) are preserved, so this
 * is safe to call again e.g. right after admin status resolves.
 */
export function setTabs(tabList) {
    tabs = tabList;
    for (const t of tabs) {
        if (!stacks.has(t.id)) stacks.set(t.id, [{ screen: t.root.screen, params: t.root.params || {} }]);
    }
    renderTabBar();
}

export function getActiveTab() {
    return activeTabId;
}

export function switchTab(tabId, { silent = false } = {}) {
    if (!stacks.has(tabId)) return;
    const changed = tabId !== activeTabId;
    activeTabId = tabId;
    if (changed && !silent) haptic("light");
    renderCurrent();
    renderTabBar();
}

export function push(screen, params = {}) {
    const stack = stacks.get(activeTabId);
    stack.push({ screen, params });
    renderCurrent();
}

export function replace(screen, params = {}) {
    const stack = stacks.get(activeTabId);
    stack[stack.length - 1] = { screen, params };
    renderCurrent();
}

/** Resets a tab back to its single root entry — e.g. after a wizard completes. */
export function resetTab(tabId, screen, params = {}) {
    stacks.set(tabId, [{ screen, params }]);
    if (tabId === activeTabId) renderCurrent();
}

export function back() {
    const stack = stacks.get(activeTabId);
    if (!stack) return;
    if (stack.length > 1) {
        stack.pop();
        renderCurrent();
    } else if (activeTabId !== "profile") {
        switchTab("profile");
    }
}

function renderTabBar() {
    if (!tabbarEl) return;
    clear(tabbarEl);
    for (const t of tabs) {
        const btn = el("button", {
            class: `tab${t.id === activeTabId ? " active" : ""}${t.admin ? " admin-tab" : ""}`,
            role: "tab",
            "aria-selected": t.id === activeTabId ? "true" : "false",
            onClick: () => switchTab(t.id),
        }, [
            el("span", { class: "tab-icon", "aria-hidden": "true" }, t.icon),
            el("span", { class: "tab-label" }, t.label),
        ]);
        tabbarEl.appendChild(btn);
    }
}

function updateChrome() {
    const stack = stacks.get(activeTabId) || [];
    const atRoot = stack.length <= 1;

    document.body.classList.toggle("has-tabbar", true);
    if (tabbarEl) tabbarEl.classList.toggle("hidden", !atRoot);

    setBackButtonVisible(!(activeTabId === "profile" && atRoot));
}

function renderCurrent() {
    if (currentCleanup) {
        try { currentCleanup(); } catch (_err) { /* noop */ }
        currentCleanup = null;
    }
    hideMainButton();

    const stack = stacks.get(activeTabId);
    const top = stack[stack.length - 1];
    updateChrome();

    clear(viewEl);
    viewEl.scrollTop = 0;

    const renderFn = screens.get(top.screen);
    if (!renderFn) {
        viewEl.appendChild(errorState(`Экран «${top.screen}» ещё не готов.`, null));
        return;
    }

    let result;
    try {
        result = renderFn(viewEl, top.params);
    } catch (err) {
        console.error(err);
        clear(viewEl);
        viewEl.appendChild(errorState("Не удалось открыть экран.", () => renderCurrent()));
        return;
    }

    if (result && typeof result.then === "function") {
        result.then((cleanup) => { currentCleanup = typeof cleanup === "function" ? cleanup : null; })
            .catch((err) => {
                console.error(err);
                clear(viewEl);
                viewEl.appendChild(errorState("Не удалось загрузить экран.", () => renderCurrent()));
            });
    } else if (typeof result === "function") {
        currentCleanup = result;
    }
}

/** Called once at startup once tabs + initial tab are ready. */
export function startRouter(initialTabId) {
    activeTabId = initialTabId;
    renderCurrent();
    renderTabBar();
}

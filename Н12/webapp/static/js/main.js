/*
 * main.js — app entry point (loaded as <script type="module"> from
 * index.html). Boots the Telegram SDK, resolves auth/registration via
 * GET /api/me, then hands off to the router for the tab-based app shell.
 */

import { initTelegram, getStartParam, haptic, setBackButtonVisible, hideMainButton } from "./telegram.js";
import { api } from "./api.js";
import { appState, setMe } from "./state.js";
import { clear, errorState } from "./ui.js";
import { initRouter, setTabs, startRouter, switchTab } from "./router.js";

import { renderSplash } from "./screens/splash.js";
import { renderAuthFailed } from "./screens/auth-failed.js";
import { renderRegistration } from "./screens/registration.js";

// Every other screen module registers itself with the router purely as an
// import side effect (see the registerScreen(...) call at the bottom of
// each file) — nothing named is needed from them here.
import "./screens/profile.js";
import "./screens/nickname.js";
import "./screens/leaders.js";
import "./screens/booking.js";
import "./screens/timetrial.js";
import "./screens/roulette.js";
import "./screens/info.js";
import "./screens/admin/shell.js";

const viewEl = document.getElementById("view");
const tabbarEl = document.getElementById("tabbar");

let authLocked = false;

/**
 * Full-screen, permanent lock on HTTP 401 from any request (initData
 * rejected server-side). Wins over whatever else is on screen — including
 * mid-boot — and can't be navigated away from (BackButton/tab bar/
 * MainButton are all explicitly killed here, since api.js's 401 event can
 * fire at any point in the app's lifetime, not just at boot).
 */
function lockForAuthFailure() {
    if (authLocked) return;
    authLocked = true;
    document.body.classList.remove("has-tabbar", "has-mainbutton");
    tabbarEl.classList.add("hidden");
    hideMainButton();
    setBackButtonVisible(false);
    clear(viewEl);
    renderAuthFailed(viewEl);
}

window.addEventListener("tma:auth-failed", lockForAuthFailure);

function buildTabs(isAdmin) {
    const tabs = [
        { id: "profile", label: "Профиль", icon: "👤", root: { screen: "profile" } },
        { id: "leaders", label: "Лидеры", icon: "🏆", root: { screen: "leaders" } },
        { id: "booking", label: "Бронь", icon: "🎟", root: { screen: "booking" } },
        { id: "time", label: "Время", icon: "⏱", root: { screen: "timetrial" } },
        { id: "more", label: "Ещё", icon: "☰", root: { screen: "info" } },
    ];
    if (isAdmin) tabs.push({ id: "admin", label: "Админ", icon: "🛠", admin: true, root: { screen: "admin" } });
    return tabs;
}

// Bot notifications ("🔥 Сессия завершена!", achievement unlocks, booking
// reminders...) can deep-link straight into a tab via a Telegram
// `t.me/<bot>/<app>?startapp=<tab id>` button — the payload is just the tab
// id itself, kept in sync with buildTabs() below. Unknown/missing values
// fall through to the normal "profile" landing tab.
const DEEP_LINK_TABS = new Set(["profile", "leaders", "booking", "time", "more"]);

function startApp() {
    initRouter({ view: viewEl, tabbar: tabbarEl });
    setTabs(buildTabs(appState.me.is_admin));
    startRouter("profile");

    const target = getStartParam();
    if (target && target !== "profile" && DEEP_LINK_TABS.has(target)) {
        switchTab(target, { silent: true });
    }
}

async function boot() {
    initTelegram();
    clear(viewEl);
    renderSplash(viewEl);

    const res = await api.get("/api/me");

    if (authLocked) return; // the "tma:auth-failed" listener above already took over

    if (!res.ok) {
        clear(viewEl);
        viewEl.appendChild(errorState(res.error, boot));
        return;
    }

    setMe(res.data);

    if (!res.data.registered) {
        clear(viewEl);
        renderRegistration(viewEl, async () => {
            const me2 = await api.get("/api/me");
            if (authLocked) return;
            if (me2.ok && me2.data && me2.data.registered) {
                setMe(me2.data);
                haptic("light");
                startApp();
            } else {
                // Unexpected (registered right after a 200 {ok:true}) — just re-boot cleanly.
                boot();
            }
        });
        return;
    }

    startApp();
}

boot();

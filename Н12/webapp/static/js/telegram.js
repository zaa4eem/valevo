/*
 * telegram.js — thin wrapper around the Telegram Mini App JS SDK
 * (window.Telegram.WebApp, loaded from https://telegram.org/js/telegram-web-app.js).
 *
 * Everything here is defensive: the app must not crash when opened in a
 * plain desktop browser during development (window.Telegram is undefined),
 * and must not crash on older Telegram clients that throw on newer SDK
 * methods (setHeaderColor, setBottomBarColor, etc.).
 *
 * NOTE: we deliberately never read WebApp.colorScheme / WebApp.themeParams —
 * product decision is to always render the dark racing HUD theme regardless
 * of the user's Telegram theme.
 */

const tg = (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp)
    ? window.Telegram.WebApp
    : null;

export const isTelegram = !!tg;

function safe(fn) {
    try { fn(); } catch (_err) { /* older client / unsupported method — ignore */ }
}

/** Raw signed initData string — the only thing we ever send to the backend for auth. */
export function getInitData() {
    if (!tg) return "";
    return tg.initData || "";
}

/**
 * Boots the Telegram SDK: ready → expand → dark chrome colors → viewport sync.
 * Safe to call once at app startup even outside Telegram.
 */
export function initTelegram() {
    if (!tg) return;

    safe(() => tg.ready());
    safe(() => tg.expand());

    // Match Telegram's own chrome to --bg so there's no light flash/edge around the app.
    safe(() => tg.setHeaderColor("#030707"));
    safe(() => tg.setBackgroundColor("#030707"));
    safe(() => tg.setBottomBarColor && tg.setBottomBarColor("#030707"));

    // We render our own persistent bottom tab bar — Telegram's native
    // "swipe down to close" gesture can otherwise fight with scrolling
    // inside screens on iOS. Guarded: older clients don't have this method.
    safe(() => tg.disableVerticalSwipes && tg.disableVerticalSwipes());

    syncViewportHeight();
    safe(() => tg.onEvent("viewportChanged", syncViewportHeight));
}

function syncViewportHeight() {
    const h = (tg && (tg.viewportStableHeight || tg.viewportHeight)) || window.innerHeight;
    document.documentElement.style.setProperty("--vh", `${h}px`);
}

/* ------------------------------------------------------------------ */
/* Haptics                                                              */
/* ------------------------------------------------------------------ */

const IMPACT_STYLES = new Set(["light", "medium", "heavy", "rigid", "soft"]);
const NOTIFICATION_TYPES = new Set(["error", "success", "warning"]);

/**
 * haptic('light'|'medium'|'heavy'|'rigid'|'soft'|'success'|'warning'|'error'|'selection')
 * Small polish detail on key interactions — silently no-ops outside Telegram
 * or on clients without HapticFeedback.
 */
export function haptic(kind = "light") {
    if (!tg || !tg.HapticFeedback) return;
    safe(() => {
        if (kind === "selection") {
            tg.HapticFeedback.selectionChanged();
        } else if (NOTIFICATION_TYPES.has(kind)) {
            tg.HapticFeedback.notificationOccurred(kind);
        } else if (IMPACT_STYLES.has(kind)) {
            tg.HapticFeedback.impactOccurred(kind);
        } else {
            tg.HapticFeedback.impactOccurred("light");
        }
    });
}

/* ------------------------------------------------------------------ */
/* BackButton — single global handler, owned by router.js              */
/* ------------------------------------------------------------------ */

let backHandler = null;

export function bindBackButton(handler) {
    if (!tg || !tg.BackButton) { backHandler = handler; return; }
    if (backHandler) safe(() => tg.BackButton.offClick(backHandler));
    backHandler = handler;
    safe(() => tg.BackButton.onClick(backHandler));
}

export function setBackButtonVisible(visible) {
    if (!tg || !tg.BackButton) return;
    safe(() => (visible ? tg.BackButton.show() : tg.BackButton.hide()));
}

/* ------------------------------------------------------------------ */
/* MainButton — reconfigured per-screen, always reset between screens  */
/* ------------------------------------------------------------------ */

let mainClickHandler = null;

/**
 * setMainButton({ text, onClick, color, textColor, disabled, progress })
 * Screens call this in their render() when they want a Telegram-native
 * primary CTA instead of an in-page button. router.js calls hideMainButton()
 * automatically before every navigation, so screens don't need their own
 * cleanup for the common case.
 */
export function setMainButton({ text, onClick, color, textColor, disabled = false, progress = false } = {}) {
    if (!tg || !tg.MainButton) return;

    if (mainClickHandler) safe(() => tg.MainButton.offClick(mainClickHandler));
    mainClickHandler = onClick || null;

    safe(() => tg.MainButton.setParams({
        text: String(text || "").toUpperCase(),
        color: color || "#4ac6c9",
        text_color: textColor || "#032022",
        is_active: !disabled,
        is_visible: true,
    }));

    if (mainClickHandler) safe(() => tg.MainButton.onClick(mainClickHandler));

    if (progress) {
        safe(() => tg.MainButton.showProgress(false));
    } else {
        safe(() => tg.MainButton.hideProgress());
    }

    document.body.classList.add("has-mainbutton");
}

export function hideMainButton() {
    document.body.classList.remove("has-mainbutton");
    if (!tg || !tg.MainButton) return;
    safe(() => tg.MainButton.hideProgress());
    safe(() => tg.MainButton.hide());
    if (mainClickHandler) {
        safe(() => tg.MainButton.offClick(mainClickHandler));
        mainClickHandler = null;
    }
}

export function mainButtonProgress(on) {
    if (!tg || !tg.MainButton) return;
    safe(() => (on ? tg.MainButton.showProgress(false) : tg.MainButton.hideProgress()));
}

/* ------------------------------------------------------------------ */
/* Misc                                                                 */
/* ------------------------------------------------------------------ */

export function closeApp() {
    if (!tg) return;
    safe(() => tg.close());
}

export function openTelegramLink(url) {
    if (!tg || !tg.openTelegramLink) { window.open(url, "_blank"); return; }
    safe(() => tg.openTelegramLink(url));
}

export function openLink(url) {
    if (!tg || !tg.openLink) { window.open(url, "_blank"); return; }
    safe(() => tg.openLink(url));
}

export default tg;

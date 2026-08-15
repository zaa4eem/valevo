/*
 * format.js — small, dependency-free formatting helpers shared by screens.
 */

/* ------------------------------------------------------------------ */
/* HTML safety                                                          */
/* ------------------------------------------------------------------ */

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/* ------------------------------------------------------------------ */
/* Russian pluralization                                                */
/* ------------------------------------------------------------------ */

/** pluralRu(5, ['визит','визита','визитов']) -> 'визитов' */
export function pluralRu(n, forms) {
    const num = Math.abs(Math.trunc(n));
    const mod10 = num % 10;
    const mod100 = num % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
}

export function withCount(n, forms) {
    return `${n} ${pluralRu(n, forms)}`;
}

/* ------------------------------------------------------------------ */
/* Numbers / money / durations                                          */
/* ------------------------------------------------------------------ */

export function formatRub(amount) {
    const n = Number(amount || 0);
    const rounded = Math.round(n * 100) / 100;
    const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
    return `${text} ₽`;
}

export function formatHoursValue(hours) {
    const total = Math.round(Number(hours || 0) * 60);
    return formatMinutes(total);
}

export function formatMinutes(totalMinutes) {
    const m = Math.max(0, Math.round(Number(totalMinutes || 0)));
    const h = Math.floor(m / 60);
    const rest = m % 60;
    if (h <= 0) return `${rest} мин`;
    if (rest === 0) return `${h} ч`;
    return `${h} ч ${rest} мин`;
}

/* ------------------------------------------------------------------ */
/* Wall-clock date/time — the backend's ISO strings already carry the   */
/* club's own timezone offset, so we read the literal numbers out of    */
/* the string instead of letting the browser re-project them into the  */
/* viewer's device timezone.                                            */
/* ------------------------------------------------------------------ */

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS_SHORT = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

export function parseIsoWall(iso) {
    if (!iso || typeof iso !== "string") return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    return { year: +y, month: +mo, day: +d, hour: +h, minute: +mi, second: +(s || 0) };
}

function weekdayIndex(y, mo, d) {
    // Date-only math done through Date.UTC + UTC getters so it never shifts
    // with the viewer's own device timezone.
    return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function pad2(n) { return String(n).padStart(2, "0"); }

export function formatWallTime(iso) {
    const w = parseIsoWall(iso);
    if (!w) return "--:--";
    return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

export function formatWallDate(iso, { withWeekday = true, withYear = false } = {}) {
    const w = parseIsoWall(iso);
    if (!w) return "—";
    const wd = withWeekday ? `, ${WEEKDAYS_SHORT[weekdayIndex(w.year, w.month, w.day)]}` : "";
    const yr = withYear ? ` ${w.year}` : "";
    return `${w.day} ${MONTHS_GEN[w.month - 1]}${yr}${wd}`;
}

export function formatWallDateTime(iso) {
    const w = parseIsoWall(iso);
    if (!w) return "—";
    return `${formatWallDate(iso)} · ${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** ISO datetime -> ISO date "YYYY-MM-DD" using the same wall-clock reading. */
export function isoToDateKey(iso) {
    const w = parseIsoWall(iso);
    if (!w) return "";
    return `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** ISO datetime -> minutes since midnight, wall-clock. */
export function isoToMinutesOfDay(iso) {
    const w = parseIsoWall(iso);
    if (!w) return null;
    return w.hour * 60 + w.minute;
}

/**
 * Builds the next `count` calendar days starting today (device-local "today"
 * — the club and its clientele share one timezone, there's no better signal
 * available client-side). Used only to drive the booking date picker.
 */
export function buildUpcomingDates(count) {
    const out = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        const y = d.getFullYear(), mo = d.getMonth() + 1, day = d.getDate();
        out.push({
            key: `${y}-${pad2(mo)}-${pad2(day)}`,
            day,
            month: mo,
            year: y,
            weekday: WEEKDAYS_SHORT[d.getDay()],
            monthShort: MONTHS_GEN[mo - 1].slice(0, 3),
            isToday: i === 0,
        });
    }
    return out;
}

/** "01:18.565" -> milliseconds, best-effort, for client-side sort/compare only. */
export function lapTimeToMs(text) {
    const m = String(text || "").trim().match(/^(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return null;
    const [, mm, ss, ms] = m;
    const millis = ms.padEnd(3, "0");
    return (+mm) * 60000 + (+ss) * 1000 + (+millis);
}

/** Loose shape check — the backend is the real validator, this is just a UX hint. */
export function looksLikeLapTime(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    return /^\d{1,2}:\d{2}[.,]\d{1,3}$/.test(t) || /^\d{1,3}[.,]\d{1,3}$/.test(t);
}

/* ------------------------------------------------------------------ */
/* Phone                                                                */
/* ------------------------------------------------------------------ */

/** As-you-type mask -> "+7 999 123-45-67" for the registration input. */
export function formatPhoneInput(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
    if (!digits.startsWith("7") && digits.length > 0) digits = "7" + digits;
    digits = digits.slice(0, 11);

    const rest = digits.slice(1);
    let out = "+7";
    if (rest.length > 0) out += " " + rest.slice(0, 3);
    if (rest.length >= 4) out += " " + rest.slice(3, 6);
    if (rest.length >= 7) out += "-" + rest.slice(6, 8);
    if (rest.length >= 9) out += "-" + rest.slice(8, 10);
    return out;
}

/** What we actually send to POST /api/register — backend normalizes further. */
export function normalizePhoneForSubmit(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
    if (digits.length === 10) digits = "7" + digits;
    return digits;
}

export function phoneLooksValid(raw) {
    const digits = normalizePhoneForSubmit(raw);
    return digits.length === 11 && digits.startsWith("7");
}

/* ------------------------------------------------------------------ */
/* Misc                                                                 */
/* ------------------------------------------------------------------ */

export function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

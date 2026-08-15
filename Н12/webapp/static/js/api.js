/*
 * api.js — tiny fetch wrapper for the VALEVO Mini App backend.
 *
 * Every call:
 *   - is same-origin ("/api/...")
 *   - sends JSON by default, or multipart/form-data when a FormData body is passed
 *   - always attaches `Authorization: tma <initData>` (the raw signed string —
 *     never initDataUnsafe, which is not cryptographically verifiable)
 *   - resolves to a normalized { ok, status, data, error } shape:
 *       ok     — true iff the HTTP response itself was 2xx and JSON parsed.
 *                This is a TRANSPORT-level flag. Several endpoints in the
 *                contract return HTTP 200 with a body-level {ok:false,...}
 *                for expected "soft" failures (e.g. booking slot taken,
 *                balance queued) — callers must check `data.ok` /
 *                `data.reason` / `data.error` themselves per the documented
 *                shape of that specific endpoint. `error` here is just a
 *                best-effort human message for the generic/unhandled case.
 *       status — raw HTTP status (0 for a network-level failure).
 *       data   — parsed JSON body, or null if none/unparsable.
 *       error  — human-readable Russian message, or null when ok.
 *
 * On HTTP 401 (initData failed server-side validation) every call also
 * dispatches a window "tma:auth-failed" event so main.js can swap the whole
 * app to the full-screen "restart the app" state in one place, regardless of
 * which screen triggered it.
 */

import { getInitData } from "./telegram.js";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз.";
const NETWORK_ERROR = "Нет связи с сервером. Проверьте интернет-соединение и попробуйте снова.";
const AUTH_ERROR = "Не удалось подтвердить личность в Telegram. Перезапустите приложение.";

async function request(path, { method = "GET", body = null, isForm = false, signal } = {}) {
    const headers = { Authorization: `tma ${getInitData()}` };
    let fetchBody;

    if (isForm) {
        fetchBody = body; // FormData — browser sets multipart boundary itself
    } else if (body != null) {
        headers["Content-Type"] = "application/json";
        fetchBody = JSON.stringify(body);
    }

    let res;
    try {
        res = await fetch(path, { method, headers, body: fetchBody, signal, cache: "no-store" });
    } catch (networkErr) {
        if (networkErr && networkErr.name === "AbortError") throw networkErr;
        return { ok: false, status: 0, data: null, error: NETWORK_ERROR };
    }

    let data = null;
    try {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
    } catch (_parseErr) {
        data = null;
    }

    if (res.status === 401) {
        window.dispatchEvent(new CustomEvent("tma:auth-failed"));
        return { ok: false, status: 401, data, error: AUTH_ERROR };
    }

    if (!res.ok) {
        const msg = (data && (data.error || data.reason)) || GENERIC_ERROR;
        return { ok: false, status: res.status, data, error: msg };
    }

    return { ok: true, status: res.status, data, error: null };
}

export const api = {
    get: (path, opts) => request(path, { ...opts, method: "GET" }),
    post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
    patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
    del: (path, body, opts) => request(path, { ...opts, method: "DELETE", body }),
    postForm: (path, formData, opts) => request(path, { ...opts, method: "POST", body: formData, isForm: true }),
};

export default api;

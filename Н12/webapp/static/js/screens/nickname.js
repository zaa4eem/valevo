/*
 * nickname.js — pushed sub-screen for editing the pilot's display name.
 * Uses the Telegram MainButton for the primary "Сохранить" action, per the
 * product spec's example for this exact screen.
 */

import { registerScreen, back } from "../router.js";
import { api } from "../api.js";
import { appState, updateProfile } from "../state.js";
import { el, clear, toastSuccess } from "../ui.js";
import { setMainButton, hideMainButton, mainButtonProgress, haptic } from "../telegram.js";

const MAX_LEN = 16;
const MIN_LEN = 2;
// Mirrors services/nickname.py VALID_NICK_RE / BAD_NICK_PARTS exactly, so
// the field gives instant feedback — the backend re-validates regardless.
const VALID_RE = /^[a-zA-Zа-яА-ЯёЁ0-9_ \-]+$/;
const BAD_PARTS = ["http", "https", "www", ".ru", ".com", ".gg", ".net", "t.me", "telegram", "discord", "vk.com", "@"];

const INVALID_TEXT = "Разрешены только буквы, цифры, пробел, дефис и подчёркивание. Ссылки и реклама запрещены.";

function localValidate(name) {
    const trimmed = name.trim();
    if (trimmed.length < MIN_LEN) return "Слишком коротко — минимум 2 символа.";
    const lower = trimmed.toLowerCase();
    if (BAD_PARTS.some((bad) => lower.includes(bad))) return INVALID_TEXT;
    if (!VALID_RE.test(trimmed)) return INVALID_TEXT;
    return null;
}

function renderNicknameEdit(container) {
    clear(container);

    const profile = appState.me && appState.me.profile;
    const current = (profile && profile.display_name) || "";
    let submitting = false;

    const errorBox = el("div", { class: "field-error", style: "display:none;" });
    const countBox = el("div", { class: "char-count" }, `0/${MAX_LEN}`);

    const input = el("input", {
        class: "input",
        type: "text",
        maxlength: String(MAX_LEN),
        placeholder: "Например: Fast_Rustam",
        value: current,
        autocomplete: "off",
        autocapitalize: "off",
        spellcheck: "false",
    });

    input.addEventListener("input", () => {
        countBox.textContent = `${input.value.length}/${MAX_LEN}`;
        errorBox.style.display = "none";
        input.classList.remove("invalid");
        refreshMainButton();
    });

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [
            el("h1", { class: "screen-title" }, "Никнейм"),
            el("p", { class: "screen-sub" }, "Как вас видят другие пилоты"),
        ]),
    ]));

    container.appendChild(el("div", { class: "card" }, [
        el("div", { class: "field" }, [
            el("div", { class: "field-label" }, "Новый никнейм"),
            input,
            countBox,
            el("div", { class: "field-hint" }, "Буквы, цифры, пробел, дефис и подчёркивание. Ссылки и реклама запрещены."),
            errorBox,
        ]),
    ]));

    function refreshMainButton() {
        const value = input.value.trim();
        const changed = value !== current;
        const localError = value ? localValidate(value) : "Введите никнейм.";
        setMainButton({
            text: "Сохранить",
            disabled: submitting || !changed || !!localError,
            progress: submitting,
            onClick: submit,
        });
    }

    async function submit() {
        const value = input.value.trim();
        const localError = localValidate(value);
        if (localError) {
            input.classList.add("invalid");
            errorBox.textContent = localError;
            errorBox.style.display = "block";
            haptic("error");
            return;
        }

        submitting = true;
        refreshMainButton();
        mainButtonProgress(true);

        const res = await api.patch("/api/me/nickname", { nickname: value });

        submitting = false;
        mainButtonProgress(false);

        if (res.status === 401) return;

        if (res.ok && res.data && res.data.ok) {
            updateProfile({ display_name: value });
            haptic("success");
            toastSuccess("Никнейм обновлён");
            hideMainButton();
            back();
            return;
        }

        const reason = res.data && res.data.reason;
        const text = reason === "taken"
            ? "Этот никнейм уже занят другим пилотом."
            : reason === "invalid"
                ? INVALID_TEXT
                : (res.error || "Не удалось сохранить никнейм.");

        input.classList.add("invalid");
        errorBox.textContent = text;
        errorBox.style.display = "block";
        haptic("error");
        refreshMainButton();
    }

    countBox.textContent = `${input.value.length}/${MAX_LEN}`;
    refreshMainButton();

    return () => hideMainButton();
}

registerScreen("nickname-edit", renderNicknameEdit);

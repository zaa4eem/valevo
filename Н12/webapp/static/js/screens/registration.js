/*
 * registration.js — shown when GET /api/me returns {registered:false}.
 * Not part of the router (runs before the tab bar exists) — main.js mounts
 * it directly and passes an onSuccess callback.
 */

import { api } from "../api.js";
import { el, clear, toastError } from "../ui.js";
import { setMainButton, hideMainButton, mainButtonProgress, haptic } from "../telegram.js";
import { formatPhoneInput, normalizePhoneForSubmit, phoneLooksValid } from "../format.js";

const REASON_TEXT = {
    phone_exists: "Этот номер телефона уже используется другим пилотом.",
    username_exists: "Пилот с таким username уже зарегистрирован.",
    no_username: "Установите username в Telegram и повторите попытку.",
    conflict: "Не удалось завершить регистрацию — конфликт данных. Попробуйте ещё раз.",
};

export function renderRegistration(container, onSuccess) {
    clear(container);

    let submitting = false;

    const errorBox = el("div", { class: "field-error", style: "display:none;" });

    const input = el("input", {
        class: "input",
        type: "tel",
        inputmode: "tel",
        autocomplete: "tel",
        placeholder: "+7 999 123-45-67",
        value: "+7",
    });

    input.addEventListener("input", () => {
        const caretAtEnd = input.selectionStart === input.value.length;
        input.value = formatPhoneInput(input.value);
        if (caretAtEnd) input.setSelectionRange(input.value.length, input.value.length);
        errorBox.style.display = "none";
        refreshMainButton();
    });

    const form = el("div", { class: "card" }, [
        el("div", { class: "field" }, [
            el("div", { class: "field-label" }, "Номер телефона"),
            input,
            el("div", { class: "field-hint" }, "Тот же номер, что привязан к вашей записи в клубе VALEVO."),
            errorBox,
        ]),
    ]);

    container.appendChild(el("div", { class: "reg-hero" }, [
        el("img", { src: "/static/logo.png", alt: "VALEVO" }),
        el("h1", {}, "Добро пожаловать в VALEVO"),
        el("p", {}, "Чтобы открыть профиль пилота, подтвердите номер телефона — так мы свяжем ваш Telegram с клубной картой."),
    ]));
    container.appendChild(form);

    function refreshMainButton() {
        setMainButton({
            text: "Зарегистрироваться",
            disabled: submitting || !phoneLooksValid(input.value),
            progress: submitting,
            onClick: submit,
        });
    }

    async function submit() {
        if (submitting || !phoneLooksValid(input.value)) return;
        submitting = true;
        errorBox.style.display = "none";
        refreshMainButton();
        mainButtonProgress(true);

        const res = await api.post("/api/register", { phone: normalizePhoneForSubmit(input.value) });

        submitting = false;
        mainButtonProgress(false);

        if (res.status === 401) return; // global auth-failed screen takes over

        if (res.ok && res.data && res.data.ok) {
            haptic("success");
            hideMainButton();
            onSuccess();
            return;
        }

        const reason = res.data && res.data.reason;
        const text = REASON_TEXT[reason] || res.error || "Не удалось зарегистрироваться. Попробуйте ещё раз.";
        haptic("error");
        errorBox.textContent = text;
        errorBox.style.display = "block";
        toastError(text);
        refreshMainButton();
    }

    refreshMainButton();

    return () => hideMainButton();
}

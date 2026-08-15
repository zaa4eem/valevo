/*
 * timetrial.js — "Время" tab: submit a lap time (discipline → track → time
 * + photo), or show the pending/cooldown state instead of the form when
 * GET /api/time-request/mine says so.
 */

import { registerScreen, push, resetTab } from "../router.js";
import { api } from "../api.js";
import { cached } from "../state.js";
import { el, clear, emptyState, errorState, mountAsync, toastSuccess, toastError, optionTile } from "../ui.js";
import { haptic, setMainButton, hideMainButton, mainButtonProgress } from "../telegram.js";
import { pluralRu, looksLikeLapTime } from "../format.js";

function stepHead(title, sub, index, total = 3) {
    const wrap = el("div");
    wrap.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [el("h1", { class: "screen-title" }, title), el("p", { class: "screen-sub" }, sub)]),
    ]));
    const dots = el("div", { class: "stepper-track" });
    for (let i = 0; i < total; i++) {
        dots.appendChild(el("div", { class: i < index ? "stepper-dot done" : i === index ? "stepper-dot active" : "stepper-dot" }));
    }
    wrap.appendChild(dots);
    return wrap;
}

const STATUS_ICON = { pending: "⏳", processing: "⚙️" };

function pendingCard(request) {
    return el("div", { class: "card pending-hero" }, [
        el("div", { class: "ph-icon" }, STATUS_ICON[request.status] || "⏳"),
        el("div", { class: "ph-title" }, request.status === "processing" ? "Заявка обрабатывается" : "Заявка на рассмотрении"),
        el("div", { class: "ph-text" }, `${request.discipline} · ${request.track} · ${request.lap_time_text}`),
        el("div", { class: "ph-text", style: "margin-top:10px;" }, "Мы уведомим вас, как только администратор примет решение."),
    ]);
}

function cooldownCard(minutes) {
    return el("div", { class: "card pending-hero" }, [
        el("div", { class: "ph-icon" }, "⏱"),
        el("div", { class: "ph-title" }, "Небольшая пауза"),
        el("div", { class: "ph-text" }, `Повторная попытка через ~${minutes} ${pluralRu(minutes, ["минуту", "минуты", "минут"])}.`),
    ]);
}

const DECIDED_META = {
    approved: { icon: "✅", text: "Прошлая заявка одобрена" },
    rejected: { icon: "❌", text: "Прошлая заявка отклонена" },
    expired: { icon: "⌛", text: "Прошлая заявка истекла" },
};

function decidedBanner(request) {
    const meta = DECIDED_META[request.status];
    if (!meta) return null;
    return el("div", { class: "card-soft", style: "display:flex;align-items:center;gap:10px;margin-bottom:14px;" }, [
        el("span", { style: "font-size:18px;flex:0 0 auto;" }, meta.icon),
        el("span", { class: "field-hint" }, `${meta.text}: ${request.discipline} · ${request.track} · ${request.lap_time_text}`),
    ]);
}

/* ------------------------------------------------------------------ */
/* Root: status gate → discipline picker                                */
/* ------------------------------------------------------------------ */

function renderTimetrial(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/time-request/mine");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        c.appendChild(el("div", { class: "screen-head" }, [
            el("div", {}, [el("h1", { class: "screen-title" }, "Установить время"), el("p", { class: "screen-sub" }, "заяви свой лучший круг")]),
        ]));

        const { request, cooldown_minutes } = res.data || {};

        if (request && (request.status === "pending" || request.status === "processing")) {
            c.appendChild(pendingCard(request));
            return;
        }

        if (cooldown_minutes > 0) {
            c.appendChild(cooldownCard(cooldown_minutes));
            return;
        }

        if (request) {
            const banner = decidedBanner(request);
            if (banner) c.appendChild(banner);
        }

        const discRes = await cached("disciplines", () => api.get("/api/disciplines"));
        if (!discRes.ok) { c.appendChild(errorState(discRes.error, retry)); return; }

        const disciplines = (discRes.data && discRes.data.disciplines) || [];
        if (disciplines.length === 0) {
            c.appendChild(emptyState("Дисциплины ещё не настроены", "Загляните позже."));
            return;
        }

        const card = el("div", { class: "card" });
        card.appendChild(el("div", { class: "card-title" }, "Выберите дисциплину"));
        const list = el("div", { class: "option-list" });
        disciplines.forEach((name) => {
            list.appendChild(optionTile("🏁", name, null, () => push("timetrial-track", { discipline: name })));
        });
        card.appendChild(list);
        c.appendChild(card);
    });
}

/* ------------------------------------------------------------------ */
/* Step — track                                                         */
/* ------------------------------------------------------------------ */

function renderTrackStep(container, params) {
    const discipline = params.discipline;

    mountAsync(container, async (c, retry) => {
        const res = await api.get(`/api/tracks?discipline=${encodeURIComponent(discipline)}`);
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        c.appendChild(stepHead("Трасса", discipline, 1));

        const tracks = (res.data && res.data.tracks) || [];
        if (tracks.length === 0) {
            c.appendChild(emptyState("Трассы для этой дисциплины не найдены", "Загляните позже или выберите другую дисциплину."));
            return;
        }

        const card = el("div", { class: "card" });
        const list = el("div", { class: "option-list" });
        tracks.forEach((name) => {
            list.appendChild(optionTile("🗺", name, null, () => push("timetrial-submit", { discipline, track: name })));
        });
        card.appendChild(list);
        c.appendChild(card);
    });
}

/* ------------------------------------------------------------------ */
/* Step — time + photo + submit                                         */
/* ------------------------------------------------------------------ */

function renderSubmitStep(container, params) {
    const { discipline, track } = params;
    clear(container);

    let submitting = false;
    let photoFile = null;
    let previewUrl = null;

    const timeInput = el("input", {
        class: "input laptime-input",
        type: "text",
        inputmode: "decimal",
        placeholder: "01:18.565",
        autocomplete: "off",
    });

    const hintBox = el("div", { class: "field-hint" }, "Формат: минуты:секунды.миллисекунды, например 01:18.565");

    const fileInput = el("input", {
        type: "file",
        accept: "image/*",
        capture: "environment",
        class: "visually-hidden",
        id: "photo-input",
    });

    const dropText = el("span", { class: "file-drop-text" }, "Прикрепите фото приборной панели / экрана с результатом");
    const dropLabel = el("label", { class: "file-drop", for: "photo-input" }, [
        el("span", { class: "file-drop-icon" }, "📷"),
        dropText,
    ]);
    const previewWrap = el("div", { class: "file-drop-preview", style: "display:none;" });

    function refreshHint() {
        const v = timeInput.value.trim();
        hintBox.textContent = v && !looksLikeLapTime(v)
            ? "Проверьте формат — например 01:18.565"
            : "Формат: минуты:секунды.миллисекунды, например 01:18.565";
    }

    function refreshMainButton() {
        const ready = !!timeInput.value.trim() && !!photoFile;
        setMainButton({
            text: "Отправить",
            disabled: submitting || !ready,
            progress: submitting,
            onClick: submit,
        });
    }

    timeInput.addEventListener("input", () => { refreshHint(); refreshMainButton(); });

    fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        photoFile = file || null;
        if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }

        if (file) {
            previewUrl = URL.createObjectURL(file);
            clear(previewWrap);
            previewWrap.appendChild(el("img", { src: previewUrl, alt: "Предпросмотр фото" }));
            previewWrap.style.display = "flex";
            dropText.textContent = file.name || "Фото выбрано";
            haptic("light");
        } else {
            previewWrap.style.display = "none";
            dropText.textContent = "Прикрепите фото приборной панели / экрана с результатом";
        }
        refreshMainButton();
    });

    container.appendChild(stepHead("Ваш результат", `${discipline} · ${track}`, 2));

    container.appendChild(el("div", { class: "card" }, [
        el("div", { class: "field" }, [
            el("div", { class: "field-label" }, "Время круга"),
            timeInput,
            hintBox,
        ]),
        el("div", { class: "field" }, [
            el("div", { class: "field-label" }, "Фото подтверждения"),
            dropLabel,
            fileInput,
            previewWrap,
        ]),
    ]));

    async function submit() {
        const timeVal = timeInput.value.trim();
        if (!timeVal || !photoFile || submitting) return;

        submitting = true;
        refreshMainButton();
        mainButtonProgress(true);

        const fd = new FormData();
        fd.append("discipline", discipline);
        fd.append("track", track);
        fd.append("lap_time_text", timeVal);
        fd.append("photo", photoFile, photoFile.name || "photo.jpg");

        const res = await api.postForm("/api/time-request", fd);

        submitting = false;
        mainButtonProgress(false);

        if (res.status === 401) return;

        if (res.ok && res.data && res.data.ok) {
            haptic("success");
            toastSuccess("Заявка отправлена! Мы проверим результат.");
            hideMainButton();
            resetTab("time", "timetrial", {});
            return;
        }

        const msg = (res.data && res.data.error) || res.error || "Не удалось отправить заявку.";
        haptic("error");
        toastError(msg);
        refreshMainButton();
    }

    refreshMainButton();

    return () => {
        hideMainButton();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
}

registerScreen("timetrial", renderTimetrial);
registerScreen("timetrial-track", renderTrackStep);
registerScreen("timetrial-submit", renderSubmitStep);

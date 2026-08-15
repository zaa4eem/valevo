/*
 * booking.js — "Бронь" tab.
 *
 * Root screen toggles between "Новая бронь" (a place-type → places → date →
 * time → duration → confirm wizard) and "Мои брони" (list + cancel). The
 * wizard steps are pushed screens ('booking-places' … 'booking-confirm'),
 * each carrying a shared `draft` object forward through router params —
 * screens are re-created from scratch on every visit (see router.js), so
 * any state that must survive a step back-and-forth lives in `draft`, not
 * in a closure.
 */

import { registerScreen, push, resetTab } from "../router.js";
import { api } from "../api.js";
import { cached } from "../state.js";
import { el, clear, emptyState, errorState, mountAsync, toastSuccess, toastError, toastWarning, confirmDialog, optionTile } from "../ui.js";
import { haptic, setMainButton, hideMainButton, mainButtonProgress } from "../telegram.js";
import { pluralRu, buildUpcomingDates, isoToMinutesOfDay, formatWallDate, formatWallDateTime, formatMinutes, pad2 } from "../format.js";

let activeSubTab = "new"; // persisted across tab switches within the session

/* ------------------------------------------------------------------ */
/* Time helpers local to booking                                        */
/* ------------------------------------------------------------------ */

function timeLabelToMinutes(label) {
    const [h, m] = String(label || "0:0").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
}

/** close_time "00:00" means midnight = end of the same day, not the start. */
function closingMinutes(cfg) {
    const open = timeLabelToMinutes(cfg.open_time);
    const close = timeLabelToMinutes(cfg.close_time);
    return close <= open ? close + 24 * 60 : close;
}

function generateTimeSlots(cfg) {
    const open = timeLabelToMinutes(cfg.open_time);
    const close = closingMinutes(cfg);
    const slots = [];
    for (let m = open; m < close; m += 30) slots.push(m % (24 * 60));
    return slots;
}

function minutesToLabel(m) {
    return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

/** Busy check across every selected place — a UX nicety only, the backend re-validates on submit. */
function slotIsBusy(availability, placeKeys, slotMinutes) {
    const places = (availability && availability.places) || {};
    for (const key of placeKeys) {
        const info = places[key];
        if (!info || !info.busy) continue;
        for (const range of info.busy) {
            const startMin = isoToMinutesOfDay(range.start);
            const endMin = isoToMinutesOfDay(range.end);
            if (startMin != null && endMin != null && slotMinutes >= startMin && slotMinutes < endMin) return true;
        }
    }
    return false;
}

/** True chronological compare (unlike display formatting, this one DOES want real timezone-aware parsing). */
function isFutureIso(iso) {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t > Date.now();
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                    */
/* ------------------------------------------------------------------ */

function stepHead(title, sub, stepIndex) {
    const wrap = el("div");
    wrap.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [el("h1", { class: "screen-title" }, title), el("p", { class: "screen-sub" }, sub)]),
    ]));
    const dots = el("div", { class: "stepper-track" });
    for (let i = 0; i < 5; i++) {
        dots.appendChild(el("div", { class: i < stepIndex ? "stepper-dot done" : i === stepIndex ? "stepper-dot active" : "stepper-dot" }));
    }
    wrap.appendChild(dots);
    return wrap;
}

/* ------------------------------------------------------------------ */
/* Root: "Новая бронь" / "Мои брони"                                    */
/* ------------------------------------------------------------------ */

function renderBooking(container) {
    clear(container);
    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [
            el("h1", { class: "screen-title" }, "Бронирование"),
            el("p", { class: "screen-sub" }, "запись в клуб VALEVO"),
        ]),
    ]));

    const content = el("div");
    const btnNew = el("button", { class: activeSubTab === "new" ? "active" : "" }, "🎟 Новая бронь");
    const btnMine = el("button", { class: activeSubTab === "mine" ? "active" : "" }, "📋 Мои брони");

    function setSub(tab) {
        if (tab === activeSubTab) return;
        activeSubTab = tab;
        haptic("selection");
        btnNew.classList.toggle("active", tab === "new");
        btnMine.classList.toggle("active", tab === "mine");
        load();
    }
    btnNew.addEventListener("click", () => setSub("new"));
    btnMine.addEventListener("click", () => setSub("mine"));

    function load() {
        activeSubTab === "new" ? loadPlaceTypeStep(content) : loadMyBookings(content);
    }

    container.appendChild(el("div", { class: "segmented" }, [btnNew, btnMine]));
    container.appendChild(content);
    load();
}

function loadPlaceTypeStep(container) {
    mountAsync(container, async (c, retry) => {
        const placesRes = await cached("booking-places-list", () => api.get("/api/booking/places"));
        clear(c);
        if (!placesRes.ok) { c.appendChild(errorState(placesRes.error, retry)); return; }

        const places = (placesRes.data && placesRes.data.places) || [];
        if (places.length === 0) {
            c.appendChild(emptyState("Мест для бронирования нет", "Загляните позже."));
            return;
        }

        const staticCount = places.filter((p) => p.type === "static").length;
        const motionCount = places.filter((p) => p.type === "motion").length;

        const card = el("div", { class: "card" });
        card.appendChild(el("div", { class: "card-title" }, "Что бронируем?"));
        const list = el("div", { class: "stack-sm" });
        if (staticCount > 0) list.appendChild(optionTile("🖥", "Статичные симуляторы", `${staticCount} ${pluralRu(staticCount, ["место", "места", "мест"])}`, () => push("booking-places", { draft: { placeType: "static", placeKeys: [] } })));
        if (motionCount > 0) list.appendChild(optionTile("🏎", "Подвижные симуляторы", `${motionCount} ${pluralRu(motionCount, ["место", "места", "мест"])}`, () => push("booking-places", { draft: { placeType: "motion", placeKeys: [] } })));
        card.appendChild(list);
        c.appendChild(card);
    });
}

/* ------------------------------------------------------------------ */
/* Step 1 — places                                                      */
/* ------------------------------------------------------------------ */

function renderPlacesStep(container, params) {
    const draft = params.draft;

    mountAsync(container, async (c, retry) => {
        const [placesRes, configRes] = await Promise.all([
            cached("booking-places-list", () => api.get("/api/booking/places")),
            cached("booking-config", () => api.get("/api/booking/config")),
        ]);
        clear(c);
        if (!placesRes.ok) { c.appendChild(errorState(placesRes.error, retry)); return; }
        if (!configRes.ok) { c.appendChild(errorState(configRes.error, retry)); return; }

        const maxPlaces = (configRes.data && configRes.data.max_places_per_booking) || 1;
        const places = ((placesRes.data && placesRes.data.places) || []).filter((p) => p.type === draft.placeType);

        c.appendChild(stepHead(
            draft.placeType === "static" ? "Статичные места" : "Подвижные места",
            `выберите до ${maxPlaces} шт.`,
            0,
        ));

        if (places.length === 0) {
            c.appendChild(emptyState("Нет доступных мест этого типа", null));
            return;
        }

        const grid = el("div", { class: "place-grid" });
        places.forEach((p) => {
            const tile = el("button", { class: `place-tile${draft.placeKeys.includes(p.key) ? " selected" : ""}` }, [
                el("span", { class: "place-check" }, "✓"),
                el("div", { class: "place-title" }, p.title),
                el("div", { class: "place-type" }, draft.placeType === "static" ? "статичный" : "подвижный"),
            ]);
            tile.addEventListener("click", () => {
                const idx = draft.placeKeys.indexOf(p.key);
                if (idx >= 0) {
                    draft.placeKeys.splice(idx, 1);
                    haptic("light");
                } else {
                    if (draft.placeKeys.length >= maxPlaces) {
                        haptic("error");
                        toastWarning(`Можно выбрать максимум ${maxPlaces} шт.`);
                        return;
                    }
                    draft.placeKeys.push(p.key);
                    haptic("selection");
                }
                tile.classList.toggle("selected", draft.placeKeys.includes(p.key));
                updateMainButton();
            });
            grid.appendChild(tile);
        });
        c.appendChild(grid);
        updateMainButton();

        function updateMainButton() {
            const n = draft.placeKeys.length;
            setMainButton({
                text: n > 0 ? `Продолжить (${n})` : "Выберите место",
                disabled: n === 0,
                onClick: () => push("booking-date", { draft }),
            });
        }
    });

    return () => hideMainButton();
}

/* ------------------------------------------------------------------ */
/* Step 2 — date                                                        */
/* ------------------------------------------------------------------ */

function renderDateStep(container, params) {
    const draft = params.draft;

    mountAsync(container, async (c, retry) => {
        const configRes = await cached("booking-config", () => api.get("/api/booking/config"));
        clear(c);
        if (!configRes.ok) { c.appendChild(errorState(configRes.error, retry)); return; }

        const daysAhead = (configRes.data && configRes.data.days_ahead) || 14;
        const dates = buildUpcomingDates(daysAhead);

        c.appendChild(stepHead("Дата", "когда приедете?", 1));

        const scroller = el("div", { class: "date-scroller" });
        dates.forEach((d) => {
            const pill = el("button", { class: `date-pill${d.isToday ? " today" : ""}${draft.date === d.key ? " selected" : ""}` }, [
                el("div", { class: "dow" }, d.weekday),
                el("div", { class: "dnum" }, String(d.day)),
                el("div", { class: "dmon" }, d.monthShort),
            ]);
            pill.addEventListener("click", () => {
                draft.date = d.key;
                [...scroller.children].forEach((ch) => ch.classList.remove("selected"));
                pill.classList.add("selected");
                haptic("selection");
                updateMainButton();
            });
            scroller.appendChild(pill);
        });
        c.appendChild(scroller);
        updateMainButton();

        function updateMainButton() {
            setMainButton({ text: "Продолжить", disabled: !draft.date, onClick: () => push("booking-time", { draft }) });
        }
    });

    return () => hideMainButton();
}

/* ------------------------------------------------------------------ */
/* Step 3 — time                                                        */
/* ------------------------------------------------------------------ */

function renderTimeStep(container, params) {
    const draft = params.draft;

    mountAsync(container, async (c, retry) => {
        const [configRes, availRes] = await Promise.all([
            cached("booking-config", () => api.get("/api/booking/config")),
            api.get(`/api/booking/availability?date=${encodeURIComponent(draft.date)}`),
        ]);
        clear(c);
        if (!configRes.ok) { c.appendChild(errorState(configRes.error, retry)); return; }
        if (!availRes.ok) { c.appendChild(errorState(availRes.error, retry)); return; }

        const cfg = configRes.data;
        const slots = generateTimeSlots(cfg);
        const availability = availRes.data || { places: {} };

        c.appendChild(stepHead("Время", formatWallDate(`${draft.date}T00:00:00`, { withWeekday: true }), 2));

        const now = new Date();
        const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        const isToday = draft.date === todayKey;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        const grid = el("div", { class: "time-grid" });
        let anySelectable = false;
        slots.forEach((m) => {
            const label = minutesToLabel(m);
            const disabled = slotIsBusy(availability, draft.placeKeys, m) || (isToday && m <= nowMinutes);
            if (!disabled) anySelectable = true;
            const btn = el("button", {
                class: `time-slot${disabled ? " busy" : ""}${draft.time === label ? " selected" : ""}`,
                disabled,
            }, label);
            if (!disabled) {
                btn.addEventListener("click", () => {
                    draft.time = label;
                    [...grid.children].forEach((ch) => ch.classList.remove("selected"));
                    btn.classList.add("selected");
                    haptic("selection");
                    updateMainButton();
                });
            }
            grid.appendChild(btn);
        });
        c.appendChild(grid);

        if (!anySelectable) {
            c.appendChild(el("div", { class: "center-note" }, "На эту дату свободных слотов не осталось — попробуйте другой день."));
        }

        updateMainButton();

        function updateMainButton() {
            setMainButton({ text: "Продолжить", disabled: !draft.time, onClick: () => push("booking-duration", { draft }) });
        }
    });

    return () => hideMainButton();
}

/* ------------------------------------------------------------------ */
/* Step 4 — duration                                                    */
/* ------------------------------------------------------------------ */

function renderDurationStep(container, params) {
    const draft = params.draft;

    mountAsync(container, async (c, retry) => {
        const configRes = await cached("booking-config", () => api.get("/api/booking/config"));
        clear(c);
        if (!configRes.ok) { c.appendChild(errorState(configRes.error, retry)); return; }

        const cfg = configRes.data;
        const options = cfg.duration_options || [30, 60, 90, 120, 180];
        const closeMin = closingMinutes(cfg);
        const startMin = timeLabelToMinutes(draft.time);

        c.appendChild(stepHead("Длительность", "сколько по времени?", 3));

        const grid = el("div", { class: "duration-grid" });
        let anyFits = false;
        options.forEach((mins) => {
            const fits = startMin + mins <= closeMin;
            if (fits) anyFits = true;
            const tile = el("button", {
                class: `duration-tile${draft.duration === mins ? " selected" : ""}`,
                disabled: !fits,
                style: fits ? "" : "opacity:.35;",
            }, [
                el("div", { class: "dur-num" }, formatMinutes(mins)),
                el("div", { class: "dur-unit" }, fits ? "" : "не влезает"),
            ]);
            if (fits) {
                tile.addEventListener("click", () => {
                    draft.duration = mins;
                    [...grid.children].forEach((ch) => ch.classList.remove("selected"));
                    tile.classList.add("selected");
                    haptic("selection");
                    updateMainButton();
                });
            }
            grid.appendChild(tile);
        });
        c.appendChild(grid);

        if (!anyFits) {
            c.appendChild(el("div", { class: "center-note" }, "Ни одна длительность не влезает до закрытия клуба — выберите время пораньше."));
        }

        updateMainButton();

        function updateMainButton() {
            setMainButton({ text: "Продолжить", disabled: !draft.duration, onClick: () => push("booking-confirm", { draft }) });
        }
    });

    return () => hideMainButton();
}

/* ------------------------------------------------------------------ */
/* Step 5 — confirm + submit                                            */
/* ------------------------------------------------------------------ */

function renderConfirmStep(container, params) {
    const draft = params.draft;

    mountAsync(container, async (c, retry) => {
        const placesRes = await cached("booking-places-list", () => api.get("/api/booking/places"));
        clear(c);
        if (!placesRes.ok) { c.appendChild(errorState(placesRes.error, retry)); return; }

        const allPlaces = (placesRes.data && placesRes.data.places) || [];
        const chosenTitles = draft.placeKeys.map((k) => (allPlaces.find((p) => p.key === k) || { title: k }).title);

        c.appendChild(stepHead("Подтверждение", "проверьте перед отправкой", 4));

        const card = el("div", { class: "card" });
        card.appendChild(el("div", { class: "card-title" }, draft.placeType === "static" ? "🖥 Статичные" : "🏎 Подвижные"));
        card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Места"), el("span", { class: "v" }, chosenTitles.join(", "))]));
        card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Дата"), el("span", { class: "v" }, formatWallDate(`${draft.date}T00:00:00`, { withWeekday: true }))]));
        card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Время"), el("span", { class: "v" }, draft.time)]));
        card.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k" }, "Длительность"), el("span", { class: "v" }, formatMinutes(draft.duration))]));
        c.appendChild(card);
        c.appendChild(el("div", { class: "center-note" }, "Заявку рассмотрит администратор клуба."));

        setMainButton({ text: "Отправить заявку", onClick: submit });

        async function submit() {
            haptic("light");
            setMainButton({ text: "Отправляем…", disabled: true, progress: true, onClick: submit });

            const res = await api.post("/api/booking", {
                place_type: draft.placeType,
                place_keys: draft.placeKeys,
                date: draft.date,
                time: draft.time,
                duration_minutes: draft.duration,
            });

            mainButtonProgress(false);
            if (res.status === 401) return;

            if (res.ok && res.data && res.data.ok) {
                haptic("success");
                toastSuccess("Заявка отправлена! Ждите подтверждения администратора.");
                activeSubTab = "mine";
                resetTab("booking", "booking", {});
                return;
            }

            const msg = (res.data && res.data.error) || res.error || "Не удалось создать бронь.";
            haptic("error");
            toastError(msg);
            setMainButton({ text: "Отправить заявку", onClick: submit });
        }
    });

    return () => hideMainButton();
}

/* ------------------------------------------------------------------ */
/* "Мои брони"                                                          */
/* ------------------------------------------------------------------ */

const STATUS_META = {
    pending_admin: { label: "На рассмотрении", cls: "badge-amber" },
    creating: { label: "Создаётся", cls: "badge-amber" },
    confirmed: { label: "Подтверждено", cls: "badge-cyan" },
    user_confirmed: { label: "Подтверждено вами", cls: "badge-cyan" },
    rejected: { label: "Отклонено", cls: "badge-muted" },
    cancelled: { label: "Отменено", cls: "badge-muted" },
    cancellation_failed: { label: "Ошибка отмены", cls: "badge-danger" },
};

function bookingCard(b, onChanged) {
    const meta = STATUS_META[b.status] || { label: b.status, cls: "badge-muted" };
    const card = el("div", { class: "card-soft" });

    card.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:10px;" }, [
        el("div", {}, [
            el("div", { style: "font-weight:800;font-size:14.5px;" }, (b.items || []).map((i) => i.place_title).join(", ") || b.place_type),
            el("div", { class: "field-hint", style: "margin-top:3px;" }, `${formatWallDateTime(b.start_at)} · ${formatMinutes(b.duration_minutes)}`),
        ]),
        el("span", { class: `badge ${meta.cls}` }, meta.label),
    ]));

    if (b.status === "cancellation_failed" && b.last_error) {
        card.appendChild(el("div", { class: "field-error", style: "margin-top:8px;" }, b.last_error));
    }

    const canCancel = ["pending_admin", "confirmed", "user_confirmed"].includes(b.status) && isFutureIso(b.start_at);
    if (canCancel) {
        const btn = el("button", { class: "btn btn-danger btn-sm", style: "width:auto;margin-top:10px;" }, "Отменить");
        btn.addEventListener("click", async () => {
            const sure = await confirmDialog({
                title: "Отменить бронь?",
                text: "Место освободится для других пилотов.",
                confirmText: "Да, отменить",
                danger: true,
            });
            if (!sure) return;

            haptic("light");
            btn.disabled = true;
            btn.textContent = "Отменяем…";

            const res = await api.post(`/api/booking/${b.id}/cancel`);
            if (res.ok && res.data && res.data.ok) {
                haptic("success");
                toastSuccess("Бронь отменена");
                onChanged();
            } else if (res.status !== 401) {
                haptic("error");
                toastError((res.data && res.data.error) || res.error || "Не удалось отменить бронь.");
                btn.disabled = false;
                btn.textContent = "Отменить";
            }
        });
        card.appendChild(btn);
    }

    return card;
}

function loadMyBookings(container) {
    mountAsync(container, async (c, retry) => {
        const res = await api.get("/api/booking/mine");
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const bookings = (res.data && res.data.bookings) || [];
        if (bookings.length === 0) {
            c.appendChild(emptyState("У вас пока нет броней", "Оформите первую запись во вкладке «Новая бронь»."));
            return;
        }

        const stack = el("div", { class: "stack-sm" });
        bookings.forEach((b) => stack.appendChild(bookingCard(b, () => loadMyBookings(container))));
        c.appendChild(stack);
    });
}

/* ------------------------------------------------------------------ */

registerScreen("booking", renderBooking);
registerScreen("booking-places", renderPlacesStep);
registerScreen("booking-date", renderDateStep);
registerScreen("booking-time", renderTimeStep);
registerScreen("booking-duration", renderDurationStep);
registerScreen("booking-confirm", renderConfirmStep);

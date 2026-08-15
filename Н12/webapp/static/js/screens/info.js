/*
 * info.js — "Ещё" tab: Инфо (static club info + map) / Поддержка (message
 * form) toggle, per the spec's suggestion to combine these into one tab.
 * Support uses a plain in-page button rather than MainButton — this is a
 * tab-root screen, so our own bottom tab bar stays visible here (see
 * router.js: MainButton is reserved for pushed sub-screens to avoid the two
 * overlapping at the bottom of the viewport).
 */

import { registerScreen } from "../router.js";
import { api } from "../api.js";
import { cached } from "../state.js";
import { el, clear, errorState, mountAsync, toastSuccess, toastError, openImageSheet } from "../ui.js";
import { haptic, openLink } from "../telegram.js";

let activeSubTab = "info";

const BTN_RESET = "background:transparent;border:none;appearance:none;-webkit-appearance:none;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;width:100%;";

function toTelegramLink(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith("t.me/")) return `https://${v}`;
    return `https://t.me/${v.replace(/^@/, "")}`;
}

function toInstagramLink(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    return `https://instagram.com/${v.replace(/^@/, "")}`;
}

function infoRow({ icon, label, value, href, tag = "div" }) {
    const inner = [
        el("div", { class: "info-icon" }, icon),
        el("div", { class: "info-main" }, [
            el("div", { class: "info-label" }, label),
            el("div", { class: "info-value" }, value),
        ]),
    ];
    if (href) {
        inner.push(el("div", { class: "info-go" }, "↗"));
        return el("button", {
            class: "info-row tappable",
            style: BTN_RESET,
            onClick: () => { haptic("light"); openLink(href); },
        }, inner);
    }
    return el(tag, { class: "info-row" }, inner);
}

function loadInfo(container) {
    mountAsync(container, async (c, retry) => {
        const res = await cached("club-info", () => api.get("/api/info"));
        clear(c);
        if (!res.ok) { c.appendChild(errorState(res.error, retry)); return; }

        const data = res.data || {};
        const card = el("div", { class: "card" });

        if (data.phone) {
            card.appendChild(el("a", {
                class: "info-row tappable",
                href: `tel:${String(data.phone).replace(/[^\d+]/g, "")}`,
                style: BTN_RESET + "text-decoration:none;",
            }, [
                el("div", { class: "info-icon" }, "📞"),
                el("div", { class: "info-main" }, [
                    el("div", { class: "info-label" }, "Телефон"),
                    el("div", { class: "info-value" }, data.phone),
                ]),
                el("div", { class: "info-go" }, "↗"),
            ]));
        }
        if (data.telegram) card.appendChild(infoRow({ icon: "💬", label: "Telegram", value: data.telegram, href: toTelegramLink(data.telegram) }));
        if (data.channel) card.appendChild(infoRow({ icon: "📢", label: "Канал", value: data.channel, href: toTelegramLink(data.channel) }));
        if (data.instagram) card.appendChild(infoRow({ icon: "📷", label: "Instagram", value: data.instagram, href: toInstagramLink(data.instagram) }));
        if (data.address) card.appendChild(infoRow({ icon: "📍", label: "Адрес", value: data.address }));

        if (card.children.length > 0) c.appendChild(card);

        if (data.description) {
            const descCard = el("div", { class: "card" }, [
                el("div", { class: "card-title" }, "🏁 О клубе"),
                el("div", { class: "about-text" }, data.description),
            ]);
            c.appendChild(descCard);
        }

        const mapCard = el("div", { class: "card" }, [
            el("div", { class: "card-title" }, "🗺 Схема клуба"),
            el("div", { class: "map-thumb club-map-wrap tappable", onClick: () => { haptic("light"); openImageSheet("/static/club_map.png", "Схема клуба VALEVO"); } }, [
                el("img", { src: "/static/club_map.png", alt: "Схема клуба VALEVO" }),
            ]),
            el("div", { class: "field-hint", style: "margin-top:8px;" }, "Нажмите, чтобы увеличить."),
        ]);
        c.appendChild(mapCard);

        if (card.children.length === 0 && !data.description) {
            c.appendChild(errorState("Информация о клубе пока недоступна.", retry, { icon: "ℹ️", title: "Пусто" }));
        }
    });
}

function loadSupport(container) {
    clear(container);

    const textarea = el("textarea", {
        class: "textarea",
        placeholder: "Опишите вопрос или проблему — админы клуба ответят в Telegram.",
        maxlength: "2000",
    });

    let sending = false;
    const sendBtn = el("button", { class: "btn btn-primary" }, "📩 Отправить");

    sendBtn.addEventListener("click", async () => {
        const message = textarea.value.trim();
        if (!message) {
            haptic("error");
            toastError("Напишите сообщение перед отправкой.");
            return;
        }
        if (sending) return;
        sending = true;
        sendBtn.textContent = "Отправляем…";
        sendBtn.disabled = true;

        const res = await api.post("/api/support", { message });

        sending = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "📩 Отправить";

        if (res.ok && res.data && (res.data.ok === undefined || res.data.ok)) {
            textarea.value = "";
            toastSuccess("Сообщение отправлено! Мы ответим в ближайшее время.");
        } else if (res.status !== 401) {
            toastError(res.error || "Не удалось отправить сообщение.");
        }
    });

    container.appendChild(el("div", { class: "card" }, [
        el("div", { class: "card-title" }, "📩 Поддержка"),
        el("div", { class: "field" }, [
            el("div", { class: "field-label" }, "Сообщение"),
            textarea,
        ]),
        sendBtn,
    ]));

    container.appendChild(el("div", { class: "center-note" }, "Отвечаем обычно в течение дня."));
}

function renderMore(container) {
    clear(container);

    container.appendChild(el("div", { class: "screen-head" }, [
        el("div", {}, [
            el("h1", { class: "screen-title" }, "Ещё"),
            el("p", { class: "screen-sub" }, "инфо и поддержка"),
        ]),
    ]));

    const content = el("div");

    const btnInfo = el("button", { class: activeSubTab === "info" ? "active" : "", onClick: () => setSub("info") }, "❓ Инфо");
    const btnSupport = el("button", { class: activeSubTab === "support" ? "active" : "", onClick: () => setSub("support") }, "📩 Поддержка");

    function setSub(tab) {
        if (tab === activeSubTab) return;
        activeSubTab = tab;
        haptic("selection");
        btnInfo.classList.toggle("active", tab === "info");
        btnSupport.classList.toggle("active", tab === "support");
        tab === "info" ? loadInfo(content) : loadSupport(content);
    }

    container.appendChild(el("div", { class: "segmented" }, [btnInfo, btnSupport]));
    container.appendChild(content);

    activeSubTab === "info" ? loadInfo(content) : loadSupport(content);
}

registerScreen("info", renderMore);

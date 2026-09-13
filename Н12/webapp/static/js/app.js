const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
try { tg?.setHeaderColor?.('#050706'); tg?.setBackgroundColor?.('#050706'); } catch (_) {}

const initData = tg?.initData || '';
const view = document.querySelector('#view');
const pilotEl = document.querySelector('#pilot');
const adminTab = document.querySelector('#admin-tab');
let me = null;
let bookingRequestToken = null;
let toastTimer = null;

const apiHeaders = () => ({
  'Authorization': `tma ${initData}`,
  'Content-Type': 'application/json',
});

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal || controller.signal,
      headers: { ...apiHeaders(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Сервер отвечает слишком долго. Повторите попытку.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));
const money = value => `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
const lapTime = ms => {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(x).padStart(3, '0')}`;
};
const dateTime = value => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const statusLabel = status => ({
  pending_admin: 'Ожидает подтверждения',
  creating: 'Создаётся',
  confirmed: 'Подтверждена',
  user_confirmed: 'Вы придёте',
  cancelling: 'Отменяется',
  cancelled: 'Отменена',
  rejected: 'Отклонена',
  cancellation_failed: 'Ошибка отмены',
  rollback_failed: 'Требует проверки',
})[status] || status;
const paymentLabel = state => ({ unpaid: 'Не оплачено', partial: 'Частично', paid: 'Оплачено' })[state] || state || '—';
const token = () => crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function toast(text, kind = 'normal') {
  const el = document.querySelector('#toast');
  clearTimeout(toastTimer);
  el.textContent = text;
  el.dataset.kind = kind;
  el.style.display = 'block';
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function haptic(type = 'light') {
  try { tg?.HapticFeedback?.impactOccurred?.(type); } catch (_) {}
}

async function confirmAction(text) {
  if (tg?.showConfirm) return await new Promise(resolve => tg.showConfirm(text, resolve));
  return window.confirm(text);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Скопировано');
  haptic('light');
}

function renderError(error) {
  view.innerHTML = `<div class="card error-card"><b>Не удалось загрузить</b><div class="muted top-gap">${esc(error?.message || error)}</div><button class="btn top-gap" id="retry">Повторить</button></div>`;
  document.querySelector('#retry')?.addEventListener('click', () => go(currentScreen));
}

let currentScreen = 'booking';
async function go(name) {
  currentScreen = name;
  view.innerHTML = '<div class="card skeleton">Загрузка…</div>';
  document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  try {
    const fn = screens[name];
    if (!fn) throw new Error('Экран не найден');
    await fn();
  } catch (error) {
    renderError(error);
  }
}

async function bootstrap() {
  if (!initData) {
    view.innerHTML = '<div class="card error-card"><b>Откройте VALEVO из Telegram</b><div class="muted top-gap">В браузере вне Telegram авторизация Mini App недоступна.</div></div>';
    return;
  }
  me = await api('/api/me');
  pilotEl.textContent = me.registered
    ? (me.profile.display_name || me.profile.username || `#${me.profile.pilot_number || ''}`)
    : 'нужна регистрация';
  adminTab.hidden = !me.is_super_admin;
  await go('booking');
}

async function leaders() {
  const data = await api('/api/leaderboard');
  let html = '<div class="screen-head"><div><div class="eyebrow">СЕЗОН</div><h1 class="title">Общий рейтинг</h1></div><div class="pill">TOP-7</div></div>';
  html += '<div class="card leaderboard-card">';
  if (!data.overall.length) html += '<div class="muted">Пока нет результатов.</div>';
  for (const row of data.overall) {
    const medal = row.place === 1 ? '🥇' : row.place === 2 ? '🥈' : row.place === 3 ? '🥉' : `${row.place}.`;
    html += `<div class="row leaderboard-row"><span><b class="place">${medal}</b> ${esc(row.name)}</span><span class="points">${row.points} б.</span></div>`;
  }
  html += '</div>';
  for (const group of data.disciplines) {
    html += `<h2 class="section-title">${esc(group.name)}</h2><div class="card">`;
    if (!group.rows.length) html += '<div class="muted">Нет результатов</div>';
    for (const row of group.rows) {
      html += `<div class="row"><span>${row.place}. ${esc(row.name)}</span><span class="time">${lapTime(row.best_ms)}</span></div>`;
    }
    html += '</div>';
  }
  view.innerHTML = html;
}

async function referrals() {
  const data = await api('/api/referrals');
  view.innerHTML = `
    <div class="screen-head"><div><div class="eyebrow">РЕФЕРАЛЬНАЯ ПРОГРАММА</div><h1 class="title">Пригласи друга</h1></div></div>
    <div class="card referral-hero">
      <div class="hero">${money(data.bonus)} <span>+ ${money(data.bonus)}</span></div>
      <p>Друг регистрируется по твоей ссылке — бонус получаете вы оба.</p>
      <div class="link">${esc(data.link)}</div>
      <div class="actions"><button class="btn" id="copy-ref">Скопировать</button><button class="spin" id="share-ref">Поделиться</button></div>
    </div>
    <div class="stats">
      <div class="card"><span class="muted">Приглашено</span><div class="metric">${Number(data.stats.invited || 0)}</div></div>
      <div class="card"><span class="muted">Получено</span><div class="metric">${money(data.stats.earned || 0)}</div></div>
    </div>`;
  document.querySelector('#copy-ref').onclick = () => copyText(data.link);
  document.querySelector('#share-ref').onclick = () => {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent('Залетай в VALEVO — получим бонус оба')}`;
    tg?.openTelegramLink ? tg.openTelegramLink(shareUrl) : window.open(shareUrl, '_blank');
  };
}

async function profile() {
  if (!me?.registered) {
    view.innerHTML = '<div class="card error-card"><b>Нужна регистрация</b><div class="muted top-gap">Зарегистрируйтесь через бота, затем вернитесь в Mini App.</div></div>';
    return;
  }
  const p = me.profile;
  view.innerHTML = `
    <div class="screen-head"><div><div class="eyebrow">ПРОФИЛЬ</div><h1 class="title">${esc(p.display_name || p.username || 'Пилот')}</h1></div><div class="pilot-number">#${esc(p.pilot_number || '—')}</div></div>
    <div class="card">
      <div class="row"><span>Телефон</span><b>${esc(p.phone || '—')}</b></div>
      <div class="row"><span>Рейтинг</span><b class="points">${esc(p.rating || 0)}</b></div>
      ${p.current_class ? `<div class="row"><span>Класс</span><b>${esc(p.current_class)}</b></div>` : ''}
      ${me.is_super_admin ? '<div class="row"><span>Доступ</span><b>Супер-админ</b></div>' : me.is_admin ? '<div class="row"><span>Доступ</span><b>Админ</b></div>' : ''}
    </div>`;
}

async function roulette() {
  const data = await api('/api/roulette');
  let cells = '';
  for (let loop = 0; loop < 5; loop++) {
    for (const prize of data.prizes) cells += `<div class="cell"><div class="emoji">${prize.emoji}</div>${esc(prize.title)}</div>`;
  }
  view.innerHTML = `
    <div class="screen-head"><div><div class="eyebrow">VALEVO BONUS</div><h1 class="title">Рулетка</h1></div><div class="pill" id="balance">${money(data.balance)}</div></div>
    <div class="card">
      <div class="roulette-window"><div class="reel" id="reel">${cells}</div></div>
      <button class="spin" id="spin">🎰 Крутить за ${money(data.spin_cost)}</button>
    </div>
    <h2 class="section-title">Возможные призы</h2>
    <div class="grid">${data.prizes.map(p => `<div class="prize">${p.emoji} ${esc(p.title)}</div>`).join('')}</div>`;
  document.querySelector('#spin').onclick = async () => {
    const button = document.querySelector('#spin');
    button.disabled = true;
    try {
      const result = await api('/api/roulette/spin', { method: 'POST' });
      const index = Math.max(0, data.prizes.findIndex(item => item.code === result.code));
      const target = data.prizes.length * 3 + index;
      const reel = document.querySelector('#reel');
      reel.style.transition = 'transform 3.2s cubic-bezier(.12,.86,.15,1)';
      reel.style.transform = `translateX(calc(50vw - ${target * 92 + 46}px))`;
      setTimeout(() => {
        document.querySelector('#balance').textContent = money(result.balance);
        toast(`Выигрыш: ${result.title}`);
        haptic('heavy');
        button.disabled = false;
      }, 3300);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  };
}

function isoDateLocal(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function intervalsOverlap(startAt, endAt, intervals) {
  const start = startAt.getTime();
  const end = endAt.getTime();
  return intervals.some(interval => {
    const a = new Date(interval.start).getTime();
    const b = new Date(interval.end).getTime();
    return Number.isFinite(a) && Number.isFinite(b) && a < end && b > start;
  });
}

async function bookingScreen() {
  if (!me?.registered) {
    view.innerHTML = '<div class="card error-card"><b>Сначала зарегистрируйтесь в боте</b><div class="muted top-gap">После регистрации бронирование появится здесь автоматически.</div></div>';
    return;
  }
  const [cfg, placesData, mine] = await Promise.all([
    api('/api/booking/config'), api('/api/booking/places'), api('/api/booking/mine')
  ]);
  const today = new Date();
  const maxDay = new Date(today); maxDay.setDate(maxDay.getDate() + Math.max(0, Number(cfg.days_ahead || 1) - 1));
  const todayIso = isoDateLocal(today);
  const maxIso = isoDateLocal(maxDay);

  let html = `
    <div class="screen-head"><div><div class="eyebrow">КЛУБ VALEVO</div><h1 class="title">Бронирование</h1></div><div class="pill">12:00–00:00</div></div>
    <div class="card booking-form">
      <div class="form-grid">
        <label>Тип<select id="btype"><option value="static">Статика</option><option value="motion">Подвижка</option></select></label>
        <label>Дата<input id="bdate" type="date" min="${todayIso}" max="${maxIso}" value="${todayIso}"></label>
        <label>Время<input id="btime" type="time" min="${cfg.open_time}" value="18:00" step="1800"></label>
        <label>Длительность<select id="bduration">${cfg.duration_options.map(x => `<option value="${x}">${x} мин</option>`).join('')}</select></label>
      </div>
      <div id="places"></div>
      <div class="quote" id="availability">Выберите место</div>
      <div class="quote" id="quote">Выберите место</div>
      <button class="spin" id="book-submit">Отправить заявку</button>
      <div class="muted micro top-gap">Финальная проверка занятости выполняется сервером перед созданием заявки.</div>
    </div>`;

  html += '<h2 class="section-title">Мои брони</h2>';
  if (!mine.bookings.length) html += '<div class="card muted">Броней пока нет.</div>';
  for (const b of mine.bookings) {
    const places = b.items.map(x => esc(x.place_title)).join(', ');
    const finance = b.finance || {};
    const problem = ['cancellation_failed', 'rollback_failed'].includes(b.status);
    html += `
      <div class="card booking-card ${problem ? 'problem-card' : ''}">
        <div class="row"><b>#${b.id} · ${places}</b><span class="badge ${problem ? 'danger' : ''}">${esc(statusLabel(b.status))}</span></div>
        <div class="row"><span>${dateTime(b.start_at)}</span><b>${b.quoted_total_rub == null ? '—' : money(b.quoted_total_rub)}</b></div>
        ${b.finance ? `<div class="row"><span>${paymentLabel(finance.payment_state)}</span><b>${money(finance.net_rub)} / ${money(finance.quoted_total_rub)}</b></div>` : ''}
        ${b.last_error && problem ? `<div class="error-note">Администратор уже видит ошибку. Слот не освобождён до успешной очистки.</div>` : ''}
        ${['pending_admin', 'confirmed', 'user_confirmed', 'cancellation_failed'].includes(b.status) ? `<button class="btn danger-btn cancel-booking" data-id="${b.id}">Отменить бронь</button>` : ''}
      </div>`;
  }
  view.innerHTML = html;

  const typeEl = document.querySelector('#btype');
  const dateEl = document.querySelector('#bdate');
  const timeEl = document.querySelector('#btime');
  const durationEl = document.querySelector('#bduration');
  const placesEl = document.querySelector('#places');
  const quoteEl = document.querySelector('#quote');
  const availabilityEl = document.querySelector('#availability');
  let availabilityCache = null;
  let availabilityKey = '';

  const selectedKeys = () => [...placesEl.querySelectorAll('input:checked')].map(input => input.value);

  function renderPlaces() {
    const rows = placesData.places.filter(item => item.type === typeEl.value);
    placesEl.innerHTML = `<div class="field-title">Места · максимум ${cfg.max_places_per_booking}</div><div class="choices">${rows.map(item => `<label class="choice"><input type="checkbox" name="place" value="${esc(item.key)}"><span>${esc(item.title)}</span></label>`).join('')}</div>`;
    placesEl.querySelectorAll('input').forEach(input => {
      input.onchange = async () => {
        const checked = [...placesEl.querySelectorAll('input:checked')];
        if (checked.length > cfg.max_places_per_booking) {
          input.checked = false;
          toast(`Максимум ${cfg.max_places_per_booking} места`);
        }
        bookingRequestToken = null;
        await Promise.all([updateQuote(), updateAvailability()]);
      };
    });
  }

  async function loadAvailability() {
    const key = dateEl.value;
    if (availabilityCache && availabilityKey === key) return availabilityCache;
    availabilityEl.textContent = 'Проверяем занятость…';
    availabilityCache = await api(`/api/booking/availability?date=${encodeURIComponent(key)}`);
    availabilityKey = key;
    return availabilityCache;
  }

  async function updateAvailability() {
    const keys = selectedKeys();
    if (!keys.length) { availabilityEl.textContent = 'Выберите место'; return; }
    try {
      const data = await loadAvailability();
      const start = new Date(`${dateEl.value}T${timeEl.value}:00`);
      const end = new Date(start.getTime() + Number(durationEl.value) * 60000);
      const busy = keys.filter(key => intervalsOverlap(start, end, data.places?.[key] || []));
      if (busy.length) {
        availabilityEl.innerHTML = '<span class="danger-text">⚠️ Выбранный интервал пересекается с занятой бронью</span>';
      } else {
        availabilityEl.innerHTML = '<span class="ok-text">● По текущим данным места свободны</span>';
      }
    } catch (error) {
      availabilityEl.textContent = `Не удалось проверить заранее: ${error.message}`;
    }
  }

  async function updateQuote() {
    const count = selectedKeys().length;
    if (!count) { quoteEl.textContent = 'Выберите место'; return; }
    try {
      const q = await api('/api/booking/quote', {
        method: 'POST',
        body: JSON.stringify({ place_type: typeEl.value, duration_minutes: Number(durationEl.value), places_count: count })
      });
      quoteEl.innerHTML = `Тариф <b>${money(q.tariff_rub_per_hour)}/ч</b> · Итого <b>${money(q.quoted_total_rub)}</b>`;
    } catch (error) {
      quoteEl.textContent = error.message;
    }
  }

  typeEl.onchange = async () => { bookingRequestToken = null; renderPlaces(); availabilityCache = null; await Promise.all([updateQuote(), updateAvailability()]); };
  dateEl.onchange = async () => { bookingRequestToken = null; availabilityCache = null; await updateAvailability(); };
  timeEl.onchange = async () => { bookingRequestToken = null; await updateAvailability(); };
  durationEl.onchange = async () => { bookingRequestToken = null; await Promise.all([updateQuote(), updateAvailability()]); };
  renderPlaces();

  document.querySelector('#book-submit').onclick = async () => {
    const button = document.querySelector('#book-submit');
    const keys = selectedKeys();
    if (!keys.length) { toast('Выберите хотя бы одно место'); return; }
    if (!dateEl.value || !timeEl.value) { toast('Укажите дату и время'); return; }
    if (!bookingRequestToken) bookingRequestToken = token();
    button.disabled = true;
    try {
      const result = await api('/api/booking', {
        method: 'POST',
        body: JSON.stringify({
          place_type: typeEl.value,
          place_keys: keys,
          date: dateEl.value,
          time: timeEl.value,
          duration_minutes: Number(durationEl.value),
          request_token: bookingRequestToken,
        })
      });
      bookingRequestToken = null;
      toast(`Заявка #${result.booking.id} отправлена`);
      haptic('medium');
      await bookingScreen();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  };

  document.querySelectorAll('.cancel-booking').forEach(button => {
    button.onclick = async () => {
      if (!(await confirmAction('Отменить эту бронь?'))) return;
      button.disabled = true;
      try {
        await api(`/api/booking/${button.dataset.id}/cancel`, { method: 'POST' });
        toast('Бронь отменена');
        haptic('medium');
        await bookingScreen();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    };
  });
}

async function admin() {
  if (!me?.is_super_admin) {
    view.innerHTML = '<div class="card error-card">Нет доступа.</div>';
    return;
  }
  const [bookings, problems, fin, audit] = await Promise.all([
    api('/api/admin/bookings'),
    api('/api/admin/bookings/problems'),
    api('/api/admin/finance?limit=100'),
    api('/api/admin/audit?limit=30'),
  ]);
  const s = fin.summary;
  let html = `
    <div class="screen-head"><div><div class="eyebrow">SUPER ADMIN</div><h1 class="title">Управление</h1></div><div class="pill">${problems.bookings.length ? `⚠ ${problems.bookings.length}` : 'OK'}</div></div>
    <div class="stats">
      <div class="card"><span class="muted">Оплаты</span><div class="metric">${money(s.payments_rub)}</div></div>
      <div class="card"><span class="muted">Возвраты</span><div class="metric">${money(s.refunds_rub)}</div></div>
      <div class="card"><span class="muted">Чистыми</span><div class="metric">${money(s.net_rub)}</div></div>
      <div class="card"><span class="muted">Комиссия</span><div class="metric">${money(s.commission_rub)}</div></div>
    </div>`;

  if (problems.bookings.length) {
    html += '<h2 class="section-title danger-text">Требуют вмешательства</h2>';
    for (const b of problems.bookings) {
      html += `<div class="card problem-card"><div class="row"><b>#${b.id} · ${esc(statusLabel(b.status))}</b><span>${money(b.quoted_total_rub)}</span></div><div class="muted">${esc(b.display_name || 'Клиент')} · ${dateTime(b.start_at)}</div><div class="error-note">${esc(b.last_error || 'Ошибка внешнего сервиса')}</div><button class="btn cleanup" data-id="${b.id}">Повторить безопасную очистку</button></div>`;
    }
  }

  html += `
    <h2 class="section-title">Настройки финансов</h2>
    <div class="card">
      <div class="form-grid">
        <label>Статика, ₽/ч<input id="t-static" type="number" min="1" step="50" value="${Number(fin.tariffs.static || 0)}"></label>
        <label>Подвижка, ₽/ч<input id="t-motion" type="number" min="1" step="50" value="${Number(fin.tariffs.motion || 0)}"></label>
        <label>Комиссия, %<input id="commission" type="number" min="0" max="100" step="0.1" value="${Number(fin.commission_percent || 0)}"></label>
      </div>
      <button class="btn" id="save-fin-settings">Сохранить настройки</button>
    </div>
    <h2 class="section-title">Зарегистрировать операцию</h2>
    <div class="card">
      <div class="form-grid">
        <label>№ брони<input id="f-booking" type="number" min="1"></label>
        <label>Операция<select id="f-type"><option value="payment">Оплата</option><option value="refund">Возврат</option></select></label>
        <label>Сумма, ₽<input id="f-amount" type="number" min="0.01" step="0.01"></label>
        <label>Способ<select id="f-method"><option value="card">Карта</option><option value="cash">Наличные</option><option value="transfer">Перевод</option><option value="other">Другое</option></select></label>
      </div>
      <label>Комментарий<input id="f-note" maxlength="500"></label>
      <button class="spin top-gap" id="post-finance">Записать в журнал</button>
    </div>`;

  html += '<h2 class="section-title">Новые заявки</h2>';
  if (!bookings.bookings.length) html += '<div class="card muted">Новых заявок нет.</div>';
  for (const b of bookings.bookings) {
    html += `<div class="card"><div class="row"><b>#${b.id} · ${esc(b.display_name || 'Клиент')}</b><b>${money(b.quoted_total_rub)}</b></div><div class="row"><span>${b.items.map(x => esc(x.place_title)).join(', ')}</span><span>${dateTime(b.start_at)}</span></div><div class="actions"><button class="btn approve" data-id="${b.id}">✅ Подтвердить</button><button class="btn reject danger-btn" data-id="${b.id}">❌ Отклонить</button></div></div>`;
  }

  html += '<h2 class="section-title">Финансовый журнал</h2>';
  if (!fin.entries.length) html += '<div class="card muted">Операций пока нет.</div>';
  for (const entry of fin.entries) {
    html += `<div class="card"><div class="row"><b>${entry.entry_type === 'payment' ? 'Оплата' : 'Возврат'} · бронь #${entry.booking_id}</b><b class="${entry.entry_type === 'refund' ? 'negative' : 'points'}">${entry.entry_type === 'refund' ? '-' : '+'}${money(entry.amount_rub)}</b></div><div class="row"><span>${esc(entry.display_name || 'Клиент')} · ${esc(entry.payment_method)}</span><span>${dateTime(entry.created_at)}</span></div><div class="row"><span>Комиссия ${Number(entry.commission_percent || 0)}%</span><b>${money(entry.commission_rub)}</b></div>${entry.note ? `<div class="muted">${esc(entry.note)}</div>` : ''}</div>`;
  }

  html += '<h2 class="section-title">Аудит админ-действий</h2><div class="card">';
  if (!audit.entries.length) html += '<div class="muted">Записей пока нет.</div>';
  for (const entry of audit.entries) {
    html += `<div class="row"><span><b>${esc(entry.action)}</b><br><span class="muted">${esc(entry.entity_type)} ${esc(entry.entity_id || '')} · admin ${entry.actor_id}</span></span><span class="micro">${dateTime(entry.created_at)}</span></div>`;
  }
  html += '</div>';
  view.innerHTML = html;

  document.querySelector('#save-fin-settings').onclick = async () => {
    const button = document.querySelector('#save-fin-settings');
    if (!(await confirmAction('Сохранить новые тарифы и процент комиссии? Старые брони не будут пересчитаны.'))) return;
    button.disabled = true;
    try {
      await api('/api/admin/tariffs/static', { method: 'PUT', body: JSON.stringify({ rub_per_hour: Number(document.querySelector('#t-static').value) }) });
      await api('/api/admin/tariffs/motion', { method: 'PUT', body: JSON.stringify({ rub_per_hour: Number(document.querySelector('#t-motion').value) }) });
      await api('/api/admin/finance/commission', { method: 'PUT', body: JSON.stringify({ percent: Number(document.querySelector('#commission').value) }) });
      toast('Настройки сохранены');
      await admin();
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  };

  document.querySelector('#post-finance').onclick = async () => {
    const button = document.querySelector('#post-finance');
    const bookingId = Number(document.querySelector('#f-booking').value);
    const amount = Number(document.querySelector('#f-amount').value);
    const type = document.querySelector('#f-type').value;
    if (!bookingId || !amount) { toast('Укажите бронь и сумму'); return; }
    if (!(await confirmAction(`${type === 'payment' ? 'Зарегистрировать оплату' : 'Зарегистрировать возврат'} ${money(amount)} по брони #${bookingId}?`))) return;
    button.disabled = true;
    try {
      const result = await api(`/api/admin/bookings/${bookingId}/finance`, {
        method: 'POST',
        body: JSON.stringify({
          entry_type: type,
          amount_rub: amount,
          payment_method: document.querySelector('#f-method').value,
          note: document.querySelector('#f-note').value,
          operation_key: token(),
        })
      });
      toast(`Операция записана. Баланс: ${money(result.finance.net_rub)}`);
      haptic('medium');
      await admin();
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  };

  document.querySelectorAll('.approve').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { await api(`/api/admin/bookings/${button.dataset.id}/approve`, { method: 'POST' }); toast('Бронь подтверждена'); await admin(); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
  document.querySelectorAll('.reject').forEach(button => button.onclick = async () => {
    if (!(await confirmAction(`Отклонить заявку #${button.dataset.id}?`))) return;
    button.disabled = true;
    try { await api(`/api/admin/bookings/${button.dataset.id}/reject`, { method: 'POST' }); toast('Заявка отклонена'); await admin(); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
  document.querySelectorAll('.cleanup').forEach(button => button.onclick = async () => {
    if (!(await confirmAction(`Повторить очистку внешних записей брони #${button.dataset.id}? Слот останется заблокирован, если хотя бы одно удаление снова не пройдёт.`))) return;
    button.disabled = true;
    try { const result = await api(`/api/admin/bookings/${button.dataset.id}/retry-cleanup`, { method: 'POST' }); toast(`Восстановлено: ${statusLabel(result.status)}`); await admin(); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
}

const screens = { booking: bookingScreen, leaders, roulette, referrals, profile, admin };
document.querySelectorAll('nav button').forEach(button => button.onclick = () => go(button.dataset.view));
bootstrap().catch(renderError);

import {createSpinController, animateReel} from './roulette.mjs?v=20260914';
const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const view = document.querySelector('#view');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub = value => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'RUB',minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value || 0)/100);
const diamonds = value => `${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2}).format(Number(value || 0))} 💎`;
const row = (label,value) => `<div class="row"><span>${label}</span><b>${value}</b></div>`;
const button = (label,screen,cls='secondary') => `<button class="${cls}" data-go="${screen}">${label}</button>`;
let me, current = 'home', navigation = 0, booking = null;
async function api(path, options={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch(path,{...options,signal:controller.signal,headers:{'Authorization':`tma ${tg?.initData || ''}`,'Content-Type':'application/json',...(options.headers || {})}});
    const data=await response.json().catch(()=>{throw new Error('Сервер вернул некорректный ответ. Повторите запрос.');});
    if(!response.ok){
      const error=new Error(typeof data.error==='string'?data.error:typeof data.detail==='string'?data.detail:`Не удалось выполнить запрос (${response.status}).`);
      error.retryable=data.retryable;error.status=response.status;throw error;
    }
    return data;
  } catch(error) {
    if(error.name==='AbortError')throw new Error('Сервер долго отвечает. Проверьте результат перед повторной операцией.');
    if(error instanceof TypeError)throw new Error('Нет связи с сервером. Проверьте интернет и повторите запрос.');
    throw error;
  } finally {clearTimeout(timer);}
}
function toast(text) { const el=document.querySelector('#toast'); el.textContent=text; el.hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.hidden=true,5000); }
function botFallback(text) { return `<div class="card"><p>${esc(text)}</p><p class="muted">Эта операция пока доступна в чате бота. Приложение не отправляет её автоматически.</p><button class="primary" data-bot>Открыть бота</button></div>`; }
function bind() {
  view.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  view.querySelectorAll('[data-bot]').forEach(b=>b.onclick=()=>{if(tg?.initData)tg.close();else toast('Откройте чат бота VALEVO в Telegram.');});
}
function show(html) { view.innerHTML=html; bind(); }
function failure(error, retry) { show(`<div class="card error"><h2>Не удалось загрузить</h2><p>${esc(error.message)}</p><button id="retry">Повторить</button></div>`); document.querySelector('#retry').onclick=retry; }
async function go(screen) {
  current=screen; const version=++navigation;
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===screen));
  show('<div class="card empty">Загрузка…</div>');
  try { const html=await screens[screen](); if(version!==navigation)return; if(typeof html==='string')show(html); await after[screen]?.(); } catch(e) { if(version===navigation)failure(e,()=>go(screen)); }
}
function home() { return `<section class="card hero"><div class="kicker">VALEVO · SIM RACING CLUB</div><h1>Твой следующий<br>круг — здесь.</h1>${button('Забронировать заезд →','book','primary')}<div class="checker"></div></section><div class="two">${button('Мои бронирования','bookings')}${button('Общий зачёт','leaders')}</div><div class="card gold"><div class="kicker">КАРТОЧКА ПИЛОТА</div><h2>${esc(me.profile?.display_name || me.profile?.username || 'Добро пожаловать')}</h2>${row('Номер',esc(me.profile?.pilot_number || '—'))}${row('Рейтинг',esc(me.profile?.rating ?? '—'))}${button('Открыть карточку','profile')}</div>${button('Пригласить друга','referrals')}${button('Рулетка призов','roulette')}${button('Поддержка и информация','support')}`; }
async function leaders() { const d=await api('/api/leaderboard'); return `<div class="kicker">РЕЗУЛЬТАТЫ КЛУБА</div><h1>Общий зачёт</h1><div class="card gold">${d.overall.length?d.overall.map(r=>row(`${esc(r.place)}. ${esc(r.name)}`,`${esc(r.points)} б.`)).join(''):'Пока нет результатов'}</div>${d.disciplines.map(b=>`<h2>${esc(b.name)}</h2><div class="card">${b.rows.length?b.rows.map(r=>row(`${esc(r.place)}. ${esc(r.name)}`,lap(r.best_ms))).join(''):'Нет результатов'}</div>`).join('')}`; }
function lap(ms) { return `${Math.floor(ms/60000)}:${String(Math.floor(ms%60000/1000)).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`; }
function classLine(c) {
  if(!c.qualifies) return `<div class="class-line"><span class="name">🏎 ${esc(c.class_name)}</span><span class="val">${c.starts}/${c.min_starts} стартов</span></div>`;
  if(c.threshold!=null) {
    const pct=Math.max(0,Math.min(100,Math.round((c.score/c.threshold)*100)));
    return `<div class="class-line"><span class="name">🏎 ${esc(c.class_name)}</span><span class="val">${c.score} / ${c.threshold}${c.score>=c.threshold?' 🚀':''}</span></div><div class="progress" style="margin-bottom:8px"><i style="width:${pct}%"></i></div>`;
  }
  return `<div class="class-line"><span class="name">🏎 ${esc(c.class_name)}</span><span class="val">${c.score} баллов</span></div>`;
}
async function profile() {
  if(!me.registered)return '<h1>Карточка пилота</h1>'+botFallback('Зарегистрируйтесь в боте, чтобы бронировать заезды.');
  const p=me.profile,d=await api('/api/profile'),rank=d.rank;
  const rankProgress=rank.rank_progress
    ?`<div class="progress-label"><span>Ранг · рейтинг <b>${rank.rating}</b></span><span>ещё ${rank.rank_progress.points_left} до ${esc(rank.rank_progress.next_emoji)} ${esc(rank.rank_progress.next_title)}</span></div><div class="progress gold"><i style="width:${Math.round(rank.rank_progress.fraction*100)}%"></i></div>`
    :`<div class="progress-label"><span>Ранг · рейтинг <b>${rank.rating}</b></span><span>максимальный ранг</span></div><div class="progress gold"><i style="width:100%"></i></div>`;
  const levelProgress=rank.level_progress
    ?`<div class="progress-label"><span>Уровень <b>${rank.level}</b>/${rank.total_levels}</span><span>ещё ${rank.level_progress.points_left} до ${rank.level_progress.next_level} ур.</span></div><div class="progress"><i style="width:${Math.round(rank.level_progress.fraction*100)}%"></i></div>`
    :`<div class="progress-label"><span>Уровень <b>${rank.level}</b>/${rank.total_levels}</span><span>максимальный уровень</span></div><div class="progress"><i style="width:100%"></i></div>`;

  const clubCard=d.club
    ?`<div class="card"><h2>Клуб</h2><div class="stat-grid"><div><span class="n">${esc(d.club.visits)}</span><span class="l">визита</span></div><div><span class="n">${esc(d.club.hours_text)}</span><span class="l">в клубе</span></div><div><span class="n money">${diamonds(d.club.bonus_balance)}</span><span class="l">Valevo Bonus</span></div></div></div>`
    :`<div class="card"><h2>Клуб</h2><p class="muted">${d.club_error?'Клубные данные временно недоступны.':'Профиль синхронизируется с клубной системой автоматически.'}</p></div>`;

  const a=d.achievements;
  const achievementsCard=`<div class="card"><h2>Достижения</h2><div class="medal-row"><div><span>🥇</span><b>${a.gold}</b><small>золото</small></div><div><span>🥈</span><b>${a.silver}</b><small>серебро</small></div><div><span>🥉</span><b>${a.bronze}</b><small>бронза</small></div><div><span>🏆</span><b>${a.podiums}</b><small>подиум</small></div></div>${row('Результатов',`${a.total_results} в ${a.disciplines_count} дисциплинах`)}${a.favorite_discipline?row('Любимая дисциплина',`${esc(a.favorite_discipline)} (${a.favorite_discipline_count})`):''}${a.favorite_track?row('Любимая трасса',`${esc(a.favorite_track)} (${a.favorite_track_count})`):''}${a.last_result?row('Последний результат',`${esc(a.last_result.lap_time_text||'—')} · ${esc((a.last_result.created_at||'').slice(0,10))}`):'<p class="muted">Первый принятый круг станет началом истории пилота.</p>'}</div>`;

  const tc=d.tournament_class;
  const classCard=tc
    ?`<div class="card"><h2>Текущий класс</h2>${classLine(tc.current)}${tc.side?classLine(tc.side):''}${tc.next_class?row('Следующий класс',esc(tc.next_class)):'<p class="muted">Максимальный класс</p>'}</div>`
    :`<div class="card"><h2>Текущий класс</h2><p class="muted">Данные временно недоступны.</p></div>`;

  const badges=d.badges;
  const badgeGrid=badges.items.map(item=>`<div class="badge-chip ${item.unlocked?'on':'off'}" title="${esc(item.title)}">${item.unlocked?esc(item.emoji):'🔒'}</div>`).join('');
  const badgesCard=`<div class="card"><div class="badges-head"><h2 style="margin:0">Бейджи</h2><span class="muted">Открыто <b>${badges.unlocked}/${badges.total}</b></span></div><div class="badge-grid">${badgeGrid}</div></div>`;

  return `<h1>Карточка пилота</h1><div class="card gold"><div class="rank-hero"><div class="rank-emoji">${esc(rank.emoji)}</div><div class="rank-id"><b>${esc(p.display_name||p.username)}</b><span>${esc(rank.title)}${p.pilot_number?' · №'+esc(p.pilot_number):''}</span></div></div>${rankProgress}${levelProgress}${row('Телефон',esc(d.phone||'—'))}</div>${clubCard}${achievementsCard}${classCard}${badgesCard}${button('Изменить имя','nickname')}${button('Мои заезды','results')}${button('Отправить время круга','submitlap')}`;
}
async function referrals() { const d=await api('/api/referrals'); return `<h1>Пригласи друга</h1><div class="card gold"><div class="number">${diamonds(d.bonus)} + ${diamonds(d.bonus)}</div><p>Друг регистрируется по вашей ссылке — вы оба получаете Valevo Bonus.</p><p class="link">${esc(d.link)}</p><button class="primary" id="copy" data-link="${esc(d.link)}">Скопировать ссылку</button></div><div class="card">${row('Приглашено',esc(d.stats.invited))}${row('Получено',diamonds(d.stats.earned))}</div>`; }
let rouletteData, spinController;
const prizeCell=p=>`<div class="reel-cell"><span>${esc(p.emoji)}</span><b>${esc(p.title)}</b></div>`;
function getSpinController(){
  if(!spinController){
    const storageKey=`valevo-spin-${me.profile?.telegram_id || tg?.initDataUnsafe?.user?.id || 'pilot'}`;
    const safe=fn=>{try{return fn();}catch{return null;}};
    spinController=createSpinController(key=>api('/api/roulette/spin',{method:'POST',body:JSON.stringify({idempotency_key:key})}),{
      loadKey:()=>safe(()=>localStorage.getItem(storageKey)),saveKey:key=>safe(()=>localStorage.setItem(storageKey,key)),
      clearKey:()=>safe(()=>localStorage.removeItem(storageKey)),newKey:()=>crypto.randomUUID()
    });
  }
  return spinController;
}
async function roulette() {
  rouletteData=await api('/api/roulette');const d=rouletteData,c=getSpinController();
  return `<h1>Рулетка призов</h1><p class="muted">Используйте Valevo Bonus — выигрывайте бонусы и рейтинг.</p><div class="card gold roulette-card"><div id="roulette-balance">${row('Valevo Bonus',diamonds(d.balance))}</div><div class="reel-window" id="reel-window" aria-hidden="true"><div class="reel-pointer"></div><div class="reel-strip" id="reel-strip">${d.prizes.slice(0,5).map(prizeCell).join('')}</div></div><div id="prize-result" role="status" aria-live="polite"></div><button class="primary" id="spin">${c.recovering?'Проверить предыдущий спин':`Крутить за ${diamonds(d.spin_cost)}`}</button><p class="muted spin-help">Стоимость одного спина — ${diamonds(d.spin_cost)}.</p></div><h2>Возможные призы</h2><div class="prizes">${d.prizes.map(p=>`<div class="prize">${esc(p.emoji)} ${esc(p.title)}</div>`).join('')}</div>`;
}
function bindRoulette(){
  const btn=document.querySelector('#spin'),holder=document.querySelector('#prize-result'),strip=document.querySelector('#reel-strip'),viewport=document.querySelector('#reel-window'),balance=document.querySelector('#roulette-balance'),catalog=rouletteData.prizes;
  let animating=false;
  btn.onclick=async()=>{
    if(animating)return;animating=true;btn.disabled=true;btn.textContent='Получаем результат…';holder.textContent='';viewport.classList.add('waiting');
    try {
      const result=await getSpinController().spin();
      if(!btn.isConnected)return;
      viewport.classList.remove('waiting');btn.textContent='Рулетка вращается…';
      await animateReel(strip,viewport,catalog,result,prizeCell);
      if(!btn.isConnected)return;
      const status=result.prize_status==='queued'?'Приз ожидает начисления. Повторно крутить для получения не нужно.':result.prize_status==='failed'?'Приз зафиксирован, но начисление не завершено. Обратитесь к администратору.':'Приз начислен!';
      holder.innerHTML=`<div class="spin-win"><span>${esc(result.emoji)}</span><h2>${esc(result.title)}</h2><p>${status}</p></div>`;
      balance.innerHTML=row('Valevo Bonus',result.balance==null?'Обновляется':diamonds(result.balance));
      getSpinController().acknowledge();
      tg?.HapticFeedback?.notificationOccurred(result.prize_status==='ok'?'success':'warning');
    } catch(error) {
      if(btn.isConnected)holder.textContent=error.message;
    } finally {
      animating=false;viewport.classList.remove('waiting');btn.disabled=false;
      btn.textContent=getSpinController().recovering?'Проверить предыдущий спин':'Крутить ещё';
    }
  };
}
function clubDate(date, timezone) { return new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
// Convert club wall time to a UTC instant, independent of the pilot's device timezone.
function instant(day,time,timezone) {
  const wanted = Date.parse(`${day}T${time}:00Z`); let result=wanted;
  for(let i=0;i<3;i++) { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result)); const p=Object.fromEntries(parts.map(x=>[x.type,x.value])); const wall=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); result+=wanted-wall; }
  return new Date(result).toISOString();
}
async function book() {
  if(!me.registered)return '<h1>Бронирование</h1>'+botFallback('Для бронирования нужна регистрация пилота.');
  const options=await api('/api/booking/options');
  const today=clubDate(new Date(),options.timezone);
  booking={options,path:'time',day:today,time:'',duration:options.durations[0],selected:[],available:null,request:0,key:crypto.randomUUID(),billAsStatic:false,kidsSelected:false};
  return bookingMarkup();
}
// Координаты зала — по финальной схеме (Figma), % от .floorplan (aspect-ratio 1000/950).
const FLOORPLAN_POSITIONS={
  door:{left:74.8,top:3.58,width:22,height:15.79},
  desk:{left:14.8,top:37.05,width:60,height:9.47},
  lounge_1:{left:82.3,top:21.89,width:16,height:20.32},
  lounge_2:{left:45.9,top:49.47,width:28.9,height:15.47},
  motion_2:{left:14.8,top:6.32,width:22,height:23.16},
  motion_1:{left:46.6,top:6.32,width:22,height:23.16},
  static_4:{left:18,top:48.42,width:20,height:20},
  kids_static:{left:1.3,top:63.26,width:13.5,height:16.53},
  static_3:{left:17.5,top:74.11,width:21,height:21.05},
  static_2:{left:46.2,top:74.11,width:21,height:21.05},
  static_1:{left:74.8,top:73.68,width:21,height:21.05},
};
function posStyle(p){return `left:${p.left}%;top:${p.top}%;width:${p.width}%;height:${p.height}%`;}
function isHappyHour(b) {
  const hh=b.options.happy_hour; if(!hh||!b.day||!b.time) return false;
  const jsWeekdays=hh.weekdays.map(w=>(w+1)%7);
  const day=new Date(`${b.day}T00:00:00`).getDay();
  return jsWeekdays.includes(day) && b.time>=hh.start && b.time<hh.end;
}
function seatRate(p,b,happy) {
  const asStatic=p.type==='motion'&&b.billAsStatic;
  const table=asStatic?b.options.places.find(x=>x.type==='static'):p;
  return {price:happy?table.happy_hour_kopecks:table.hourly_rate_kopecks, full:table.hourly_rate_kopecks, asStatic};
}
function bookingMarkup() {
 const b=booking,o=b.options;const dates=Array.from({length:o.days_ahead},(_,i)=>{const d=new Date(`${clubDate(new Date(),o.timezone)}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
 const times=[];for(let m=o.open_hour*60;m+b.duration<=(o.close_hour||24)*60;m+=30){const t=`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;if(Date.parse(instant(b.day,t,o.timezone))>Date.now())times.push(t);}
 if(!times.includes(b.time))b.time=times[0]||'';
 const schedule=`<div class="two"><div><label for="day">Дата</label><select id="day">${dates.map(d=>`<option ${d===b.day?'selected':''}>${d}</option>`).join('')}</select></div><div><label for="time">Время · ${esc(o.timezone)}</label><select id="time">${times.map(t=>`<option ${t===b.time?'selected':''}>${t}</option>`).join('')}</select></div></div><label for="duration">Продолжительность</label><select id="duration">${o.durations.map(d=>`<option value="${d}" ${d===b.duration?'selected':''}>${d} минут</option>`).join('')}</select>`;
 const happy=isHappyHour(b);
 const staticPlace=o.places.find(p=>p.type==='static'), motionPlace=o.places.find(p=>p.type==='motion');
 const happyBanner=happy?`<div class="happy-banner">⚡ Счастливые часы: будни 12:00–17:00 — статика ${rub(staticPlace.happy_hour_kopecks)}, подвижка ${rub(motionPlace.happy_hour_kopecks)}/час</div>`:'';
 const zones=`<div class="zone zone-door" style="${posStyle(FLOORPLAN_POSITIONS.door)}">ВХОД</div><div class="zone zone-desk" style="${posStyle(FLOORPLAN_POSITIONS.desk)}">СТОЙКА АДМИНИСТРАТОРА</div><div class="zone zone-lounge" style="${posStyle(FLOORPLAN_POSITIONS.lounge_1)}">ЛАУНЖ-ЗОНА</div><div class="zone zone-lounge" style="${posStyle(FLOORPLAN_POSITIONS.lounge_2)}">ЛАУНЖ-ЗОНА</div>`;
 const seatCards=o.places.map(p=>{const r=seatRate(p,b,happy);const priceHtml=happy?`${rub(r.price)}/час<span class="was">${rub(r.full)}</span>`:`${rub(r.price)}/час`;return `<button class="seat" data-seat="${esc(p.key)}" aria-pressed="${b.selected.includes(p.key)}" style="${posStyle(FLOORPLAN_POSITIONS[p.key])}">${esc(p.title)}<small class="p">${priceHtml}</small></button>`;}).join('');
 const kidsCard=`<button class="seat seat-kids" data-seat="kids_static" aria-pressed="${b.kidsSelected}" style="${posStyle(FLOORPLAN_POSITIONS.kids_static)}">Детский сим<small class="p">${rub(o.kids_rate_kopecks)}/ч</small></button>`;
 const motionSelected=b.selected.some(k=>b.options.places.find(p=>p.key===k)?.type==='motion');
 const motionToggle=`<p class="muted" style="margin:10px 0 6px">Хотите занять подвижную платформу, но кататься без движения — как на статике? Включите переключатель ниже.</p><button class="chip-toggle" id="bill-as-static" aria-pressed="${b.billAsStatic?'true':'false'}">${b.billAsStatic?'✓ ':''}Подвижка как статика</button>`;
 const toggleBlock=b.kidsSelected?'':`<div style="margin-top:10px">${motionToggle}</div>${!motionSelected&&b.billAsStatic?'<p class="muted">Применится, если выберете места подвижки.</p>':''}`;
 const seats=`<h2>Выберите места</h2><p class="muted">До 3 мест одного типа · статика ${rub(staticPlace.hourly_rate_kopecks)}/час · подвижка ${rub(motionPlace.hourly_rate_kopecks)}/час · детский сим ${rub(o.kids_rate_kopecks)}/час (не через YCLIENTS)</p>${happyBanner}<div class="floorplan">${zones}${seatCards}${kidsCard}</div>${toggleBlock}<div class="legend" style="margin-top:10px"><span>Голубой — свободно</span><span>Золотой — выбрано</span></div>`;
 return `<div class="kicker">ВАШ ЗАЕЗД</div><h1>Бронирование</h1><div class="tabs"><button data-path="time" aria-pressed="${b.path==='time'}">Сначала дата и время</button><button data-path="seats" aria-pressed="${b.path==='seats'}">Сначала места</button></div>${b.path==='time'?schedule+seats:seats+schedule}<p id="availability" class="muted">Проверяем доступность…</p><div class="card gold" id="summary"></div><button class="primary" id="reserve" disabled>Отправить заявку</button><p class="muted">Заявка требует подтверждения клуба. Её статус появится в разделе «Мои бронирования».</p>`;
}
function bindBooking() {
 const b=booking;
 view.querySelectorAll('[data-path]').forEach(el=>el.onclick=()=>{b.path=el.dataset.path;show(bookingMarkup());bindBooking();});
 for(const id of ['day','time','duration'])document.getElementById(id).onchange=e=>{b[id]=id==='duration'?Number(e.target.value):e.target.value;b.key=crypto.randomUUID();show(bookingMarkup());bindBooking();};
 view.querySelectorAll('[data-seat]').forEach(el=>el.onclick=()=>{
   const key=el.dataset.seat;
   if(key==='kids_static'){b.kidsSelected=!b.kidsSelected;if(b.kidsSelected)b.selected=[];b.key=crypto.randomUUID();show(bookingMarkup());bindBooking();return;}
   const p=b.options.places.find(p=>p.key===key);
   if(b.selected.includes(key))b.selected=b.selected.filter(k=>k!==key);
   else{if(b.kidsSelected)b.kidsSelected=false;if(b.selected.length>=3)return toast('Можно выбрать до 3 мест.');if(b.selected.length&&b.options.places.find(p=>p.key===b.selected[0]).type!==p.type)return toast('Выберите места одного типа.');b.selected.push(key);}
   b.key=crypto.randomUUID();updateBooking();
 });
 document.querySelector('#bill-as-static')?.addEventListener('click',()=>{b.billAsStatic=!b.billAsStatic;b.key=crypto.randomUUID();show(bookingMarkup());bindBooking();});
 document.querySelector('#reserve').onclick=submitBooking;
 checkAvailability();
}
async function checkAvailability() {
 const b=booking,version=++b.request; b.available=null; updateBooking();
 if(!b.time){document.querySelector('#availability').textContent='На эту дату время закончилось. Выберите другой день.';return;}
 try{const d=await api(`/api/booking/availability?${new URLSearchParams({start_at:instant(b.day,b.time,b.options.timezone),duration_minutes:b.duration})}`);if(current!=='book'||booking!==b||version!==b.request)return;b.available=d.places;document.querySelector('#availability').textContent='Доступность проверена. Время указано по часовому поясу клуба.';updateBooking();}catch(e){if(current==='book'&&booking===b&&version===b.request){document.querySelector('#availability').textContent=e.message;toast('Не удалось проверить места. Измените время для повторной проверки.');}}
}
function updateBooking() {
 const b=booking; const unavailable=k=>!b.available?.find(p=>p.key===k)?.available;
 const happy=isHappyHour(b);
 view.querySelectorAll('[data-seat]').forEach(el=>{
   const key=el.dataset.seat;
   if(key==='kids_static'){el.setAttribute('aria-pressed',b.kidsSelected);el.disabled=b.selected.length>0;return;}
   el.setAttribute('aria-pressed',b.selected.includes(key));
   el.disabled=b.kidsSelected||(b.available ? unavailable(key)&&!b.selected.includes(key) : b.path==='time');
   const p=b.options.places.find(p=>p.key===key);const r=seatRate(p,b,happy);
   const priceEl=el.querySelector('.p');if(priceEl)priceEl.innerHTML=happy?`${rub(r.price)}/час<span class="was">${rub(r.full)}</span>`:`${rub(r.price)}/час`;
 });
 const chosen=b.options.places.filter(p=>b.selected.includes(p.key));
 const total=b.kidsSelected?b.options.kids_rate_kopecks*b.duration/60:chosen.reduce((n,p)=>n+seatRate(p,b,happy).price*b.duration/60,0);
 const places=b.kidsSelected?'Детский статичный сим':(chosen.map(p=>esc(p.title)+(p.type==='motion'&&b.billAsStatic?' (как статика)':'')).join(', ')||'Не выбраны');
 document.querySelector('#summary').innerHTML=row('Места',places)+row('Заезд',`${esc(b.day)} · ${esc(b.time)||'—'} · ${b.duration} мин${happy&&!b.kidsSelected?' · счастливые часы':''}`)+row('Стоимость',`<span class="money">${rub(total)}</span>`)+(!b.kidsSelected&&b.available&&b.selected.some(unavailable)?'<p class="error">Выбранное место занято. Уберите его или измените время.</p>':'')+(b.kidsSelected?'<p class="muted">Детский сим не бронируется в YCLIENTS — администратор свяжется с вами лично после отправки заявки.</p>':'');
 document.querySelector('#reserve').disabled=!b.time||(b.kidsSelected?false:(!b.selected.length||!b.available||b.selected.some(unavailable)));
}
async function submitBooking() {
 const b=booking,btn=document.querySelector('#reserve');btn.disabled=true;btn.textContent='Отправляем…';
 if(b.kidsSelected){
   try{await api('/api/booking/kids',{method:'POST',body:JSON.stringify({start_at:instant(b.day,b.time,b.options.timezone),duration_minutes:b.duration,idempotency_key:b.key})});toast('Заявка отправлена. Администратор свяжется с вами.');go('home');}catch(e){toast(e.message);if(current==='book'){btn.textContent='Повторить отправку';btn.disabled=false;}}
   return;
 }
 try{await api('/api/bookings',{method:'POST',body:JSON.stringify({place_keys:b.selected,start_at:instant(b.day,b.time,b.options.timezone),duration_minutes:b.duration,idempotency_key:b.key,bill_as_static:b.billAsStatic})});toast('Заявка отправлена. Статус доступен в бронированиях.');go('bookings');}catch(e){toast(e.message);if(current==='book'){btn.textContent='Повторить отправку';await checkAvailability();}}
}
const statusNames={pending_admin:'Ожидает подтверждения',creating:'Создаётся',user_confirmed:'Подтверждено пилотом',cancelling:'Отменяется',reconciliation_required:'Требует проверки клуба',pending:'Ожидает подтверждения',confirmed:'Подтверждено',approved:'Подтверждено',cancelled:'Отменено',rejected:'Отклонено',failed:'Ошибка',cancellation_failed:'Ошибка отмены — свяжитесь с клубом'};
async function bookings(admin=false) {
 if(admin&&!me.is_super_admin)throw new Error('Недостаточно прав');
 const d=await api(admin?'/api/admin/bookings':'/api/bookings');
 return `<h1>${admin?'Заявки клуба':'Мои бронирования'}</h1>${d.bookings.length?d.bookings.map(b=>`<div class="card"><div class="kicker">БРОНЬ #${esc(b.id)}</div><h2>${esc(statusNames[b.status]||b.status)}</h2><p>${esc(new Date(b.start_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))} МСК · ${b.duration_minutes} мин</p><p>${b.items.map(i=>esc(i.place_title||i.place_key)).join(', ')}</p>${row('Стоимость',rub(b.quoted_kopecks))}${admin&&b.status==='pending_admin'?`<div class="two"><button data-action="approve" data-id="${b.id}">Подтвердить</button><button data-action="reject" data-id="${b.id}">Отклонить</button></div>`:!admin&&['pending_admin','confirmed','user_confirmed'].includes(b.status)?`<button class="secondary" data-action="cancel" data-id="${b.id}">Отменить бронь</button>`:''}</div>`).join(''):'<div class="card empty">Бронирований пока нет</div>'}${admin?'':button('Выбрать заезд','book','primary')}`;
}
function bindBookings(admin=false) {view.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=async()=>{if(!window.confirm(btn.dataset.action==='cancel'?'Отменить это бронирование?':'Применить действие к заявке?'))return;btn.disabled=true;try{await api(`${admin?'/api/admin/bookings':'/api/bookings'}/${btn.dataset.id}/${btn.dataset.action}`,{method:'POST'});go(admin?'requests':'bookings');}catch(e){toast(e.message);btn.disabled=false;}});}
async function finance() {if(!me.is_super_admin)throw new Error('Недостаточно прав');return `<h1>Итоги клуба</h1><div class="two"><div><label for="date-from">С даты</label><input id="date-from" type="date" value="${clubDate(new Date(),'Europe/Moscow').slice(0,8)}01"></div><div><label for="date-to">По дату</label><input id="date-to" type="date" value="${clubDate(new Date(),'Europe/Moscow')}"></div></div><label for="source">Источник</label><select id="source"><option value="">Весь Telegram</option><option value="bot">Бот</option><option value="miniapp">Mini App</option></select><button class="secondary" id="load-finance">Показать</button><div id="finance-data"></div>`;}
async function loadFinance() {const holder=document.querySelector('#finance-data');holder.innerHTML='<p>Загрузка…</p>';try{const q=new URLSearchParams({date_from:document.querySelector('#date-from').value,date_to:document.querySelector('#date-to').value});const source=document.querySelector('#source').value;if(source)q.set('source',source);const d=await api('/api/admin/finance?'+q);if(current!=='finance')return;holder.innerHTML=`<div class="card gold">${row('Стоимость подтверждённых броней',rub(d.turnover_kopecks))}${row('Разработчику · расчётные 10%',rub(d.commission_kopecks))}${row('Клубу · расчётная доля',rub(d.club_kopecks))}</div><div class="card"><h2>Стоимость заездов по дням</h2>${chart(d.daily)}${row('Подтверждено бронирований',esc(d.booking_count))}${row('Место-часов',esc(d.hours))}</div>${d.missing_prices?`<p class="error">В ${esc(d.missing_prices)} старых бронях тариф не был сохранён. Они учтены в количестве и часах, но не в сумме.</p>`:""}<p class="muted">Расчёт по подтверждённым бронированиям на выбранные даты. Отменённые брони исключены. Фактические платежи не учитываются.</p>`;}catch(e){holder.innerHTML=`<p class="error">${esc(e.message)}</p>`;}}
function chart(days) {
 if(!days.length)return '<p class="muted">Нет подтверждённых броней за выбранный период</p>';
 const max=Math.max(1,...days.map(d=>Math.abs(d.turnover_kopecks))),negative=days.some(d=>d.turnover_kopecks<0),baseline=negative?85:120,scale=negative?55:90,step=270/days.length;
 return `<svg viewBox="0 0 320 170" role="img" aria-label="Стоимость подтверждённых броней по дням в рублях"><text x="0" y="12">${esc(rub(max))}</text><line x1="35" y1="${baseline}" x2="320" y2="${baseline}" stroke="#9db4d5"/><text x="0" y="${baseline+4}">0 ₽</text>${days.map((d,i)=>{const height=Math.abs(d.turnover_kopecks)/max*scale;return `<rect x="${35+i*step}" y="${d.turnover_kopecks<0?baseline:baseline-height}" width="${Math.max(1,step*.7)}" height="${height}" fill="${d.turnover_kopecks<0?'#ffcc33':'#32c8ff'}"><title>${esc(d.date)}: ${esc(rub(d.turnover_kopecks))}</title></rect>`;}).join('')}<text x="35" y="163">${esc(days[0].date)}</text><text x="320" y="163" text-anchor="end">${esc(days.at(-1).date)}</text></svg><details><summary>Данные по дням</summary>${days.map(d=>row(esc(d.date),rub(d.turnover_kopecks))).join('')}</details>`;
}
function staff() {if(!me.is_admin&&!me.is_super_admin)throw new Error('Недостаточно прав');return `<h1>Управление клубом</h1>${button('Добавить время пилота','adminlap')}${me.is_super_admin?button('Заявки на бронирование','requests')+button('Итоги клуба','finance')+button('Найти пилота','pilots')+button('Трассы','tracks')+button('Эталонные времена','benchmarks'):''}${botFallback('Модерация результатов, изменение данных пилотов, рассылки, закрытие Week CUP и поддержка доступны в меню администратора бота.')}`;}
async function nickname(){return `<h1>Имя пилота</h1><form id="nickname-form" class="card"><label for="display-name">Имя в рейтинге</label><input id="display-name" maxlength="64" required value="${esc(me.profile.display_name||'')}"><button class="primary secondary">Сохранить</button></form>`;}
async function adminlap(){if(!me.is_admin&&!me.is_super_admin)throw new Error('Недостаточно прав');const d=await api('/api/disciplines');window.lapDisciplines=d.disciplines;window.lapBenchmarks=d.benchmarks;return `<h1>Время пилота</h1><form id="lap-form" class="card"><label for="pilot-number">Номер пилота</label><input id="pilot-number" type="number" min="1" required><label for="discipline">Дисциплина</label><select id="discipline">${d.disciplines.map(x=>`<option>${esc(x.name)}</option>`).join('')}</select><label for="track">Трасса</label><select id="track"></select><p id="track-hint" class="muted"></p><label for="lap-time">Время круга · мм:сс.мс</label><input id="lap-time" placeholder="02:00.597" required><button class="primary secondary">Сохранить результат</button></form>`;}
const screens={home,leaders,profile,referrals,roulette,book,bookings,requests:()=>bookings(true),finance,staff,nickname,adminlap,results,pilots,tracks,benchmarks,submitlap:()=>'<h1>Новый круг</h1>'+botFallback('Отправьте время и фото или видео подтверждения через бота. Администратор проверит результат.'),support:()=>'<h1>Клуб на связи</h1>'+botFallback('Откройте бота, чтобы написать в поддержку или посмотреть информацию о клубе.')};
const after={pilots:bindPilots,tracks:()=>bindTrackEditor(false),benchmarks:()=>bindTrackEditor(true),book:()=>document.querySelector('#reserve')&&bindBooking(),bookings:()=>bindBookings(),requests:()=>bindBookings(true),finance:()=>{document.querySelector('#load-finance').onclick=loadFinance;return loadFinance();},referrals:()=>{document.querySelector('#copy').onclick=async e=>{try{await navigator.clipboard.writeText(e.target.dataset.link);toast('Ссылка скопирована');}catch{toast('Не удалось скопировать. Выделите ссылку вручную.');}};},roulette:bindRoulette,nickname:()=>{document.querySelector('#nickname-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await api('/api/profile',{method:'PATCH',body:JSON.stringify({display_name:document.querySelector('#display-name').value})});me=await api('/api/me');go('profile');}catch(e){toast(e.message);btn.disabled=false;}};},adminlap:()=>{let lapKey=crypto.randomUUID();document.querySelector('#lap-form').oninput=()=>lapKey=crypto.randomUUID();const discipline=document.querySelector('#discipline');const trackSelect=document.querySelector('#track');const hint=document.querySelector('#track-hint');const submitBtn=document.querySelector('#lap-form button');const tracks=()=>{const info=window.lapDisciplines.find(x=>x.name===discipline.value);const benchmark=window.lapBenchmarks?.[discipline.value];if(info?.is_ladder){if(benchmark?.track){trackSelect.innerHTML=`<option>${esc(benchmark.track)}</option>`;trackSelect.disabled=true;hint.textContent='Трасса зафиксирована эталоном сезона.';hint.classList.remove('error');submitBtn.disabled=false;}else{trackSelect.innerHTML='';trackSelect.disabled=true;hint.textContent='⚠️ Эталон на эту дисциплину в этом сезоне ещё не задан — сначала задайте его в «Эталонные времена».';hint.classList.add('error');submitBtn.disabled=true;}}else{trackSelect.disabled=false;trackSelect.innerHTML=(info?.tracks||[]).map(x=>`<option>${esc(x)}</option>`).join('');hint.textContent='';hint.classList.remove('error');submitBtn.disabled=false;}};discipline.onchange=tracks;tracks();document.querySelector('#lap-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{const saved=await api('/api/admin/laps',{method:'POST',body:JSON.stringify({idempotency_key:lapKey,pilot_number:Number(document.querySelector('#pilot-number').value),discipline:discipline.value,track:document.querySelector('#track').value,lap_time:document.querySelector('#lap-time').value})});toast(saved.warning||'Результат сохранён');go('staff');}catch(e){toast(e.message);btn.disabled=false;}};}};
async function start(){document.querySelector('.brand').onclick=e=>{e.preventDefault();if(me)go('home');};try{me=await api('/api/me');document.querySelector('#pilot').textContent=me.profile?.display_name||me.profile?.username||'Добро пожаловать в клуб';document.querySelector('#role').textContent=me.is_super_admin?'СУПЕР-АДМИН':me.is_admin?'АДМИН':'ПИЛОТ';document.querySelector('nav').innerHTML=[['home','⌂','Главная'],['book','▦','Бронь'],['roulette','🎯','Рулетка'],['leaders','🏆','Зачёт'],['profile','◉','Пилот']].map(([s,i,t])=>`<button data-view="${s}"><b>${i}</b>${t}</button>`).join('');document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>go(b.dataset.view));if(me.is_admin||me.is_super_admin){document.querySelector('#staff').innerHTML=button('Управление клубом','staff');document.querySelector('#staff button').onclick=()=>go('staff');}go('home');}catch(e){failure(e,start);}}

async function results() {
 const d=await api('/api/results'),last=d.last_result;
 return `<h1>Мои заезды</h1><div class="card gold">${row('Принято результатов',esc(d.total_results))}${row('Подиумов',esc(d.podiums))}${row('Золото / серебро / бронза',`${esc(d.gold)} / ${esc(d.silver)} / ${esc(d.bronze)}`)}</div><div class="card"><h2>Последний круг</h2>${last?`<div class="kicker">${esc(last.discipline)} · ${esc(last.track)}</div><p class="number">${esc(last.lap_time_text)}</p><p class="muted">${esc(last.created_at)}</p>`:'Пока нет принятых результатов'}</div><div class="card">${row('Любимая дисциплина',esc(d.favorite_discipline||'—'))}${row('Любимая трасса',esc(d.favorite_track||'—'))}${row('Дисциплин',esc(d.disciplines_count))}</div>${button('Отправить время круга','submitlap')}`;
}
function requireSuper(){if(!me.is_super_admin)throw new Error('Недостаточно прав');}
function pilots(){requireSuper();return `<h1>Пилоты клуба</h1><form id="pilot-search" class="card"><label for="search-number">Номер пилота</label><input id="search-number" type="number" min="1" required><button class="primary secondary">Найти</button></form><div id="pilot-result"></div>`;}
function bindPilots(){document.querySelector('#pilot-search').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button'),holder=document.querySelector('#pilot-result');btn.disabled=true;try{const d=await api('/api/super/pilots?'+new URLSearchParams({pilot_number:document.querySelector('#search-number').value}));holder.innerHTML=d.pilots.map(p=>`<div class="card gold"><h2>Карточка пилота</h2>${row('Имя',esc(p.display_name||p.username||'—'))}${row('Номер',esc(p.pilot_number))}${row('Телефон',esc(p.phone||'—'))}${row('Рейтинг',esc(p.rating||0))}${row('Класс',esc(p.current_class||'—'))}</div>`).join('')||'<div class="card empty">Пилот не найден</div>';if(d.pilots.length)holder.innerHTML+=botFallback('Изменение данных пилота и бонусного баланса доступно в боте.');bind();}catch(e){holder.innerHTML=`<p class="error">${esc(e.message)}</p>`;}finally{btn.disabled=false;}};}
let editingDisciplines=[];
async function trackEditor(benchmark){requireSuper();const d=await api('/api/disciplines');editingDisciplines=d.disciplines;return `<h1>${benchmark?'Эталонные времена':'Трассы клуба'}</h1>${benchmark?`<p class="muted">Текущий месяц: ${esc(d.month_key)}. Эталон задаётся для класса.</p>`:''}<form id="track-form" class="card"><label for="edit-discipline">${benchmark?'Класс':'Дисциплина'}</label><select id="edit-discipline">${d.disciplines.map(x=>`<option>${esc(x.name)}</option>`).join('')}</select><label for="edit-track">Трасса</label>${benchmark?'<select id="edit-track"></select>':'<input id="edit-track" required maxlength="200" placeholder="Название новой трассы">'}${benchmark?'<label for="benchmark-time">Эталон · мм:сс.мс</label><input id="benchmark-time" required placeholder="01:18.565">':''}<button class="primary secondary">${benchmark?'Сохранить эталон':'Добавить трассу'}</button></form><div id="track-list"></div>${benchmark?`<div class="card"><h2>Текущие эталоны</h2>${Object.entries(d.benchmarks||{}).map(([name,b])=>row(esc(name),`${esc(b.track||'—')} · ${b.benchmark_ms?lap(b.benchmark_ms):esc(b.lap_time_text||'—')}`)).join('')||'Эталоны пока не заданы'}</div>`:''}`;}
function tracks(){return trackEditor(false);} function benchmarks(){return trackEditor(true);}
function bindTrackEditor(benchmark){const discipline=document.querySelector('#edit-discipline'),list=document.querySelector('#track-list');function refresh(){const all=editingDisciplines.find(d=>d.name===discipline.value)?.tracks||[];if(benchmark)document.querySelector('#edit-track').innerHTML=all.map(t=>`<option>${esc(t)}</option>`).join('');else{list.innerHTML='<div class="card">'+(all.map(t=>`<div class="row"><span>${esc(t)}</span><button data-remove-track="${esc(t)}">Удалить</button></div>`).join('')||'Трасс пока нет')+'</div>';list.querySelectorAll('[data-remove-track]').forEach(btn=>btn.onclick=async()=>{if(!confirm(`Удалить трассу «${btn.dataset.removeTrack}»?`))return;btn.disabled=true;try{await api('/api/super/tracks',{method:'DELETE',body:JSON.stringify({discipline:discipline.value,track:btn.dataset.removeTrack})});go('tracks');}catch(e){toast(e.message);btn.disabled=false;}});}}discipline.onchange=refresh;refresh();document.querySelector('#track-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button'),track=document.querySelector('#edit-track').value;btn.disabled=true;try{await api(benchmark?'/api/super/benchmarks':'/api/super/tracks',{method:benchmark?'PUT':'POST',body:JSON.stringify(benchmark?{class_name:discipline.value,track,lap_time:document.querySelector('#benchmark-time').value}:{discipline:discipline.value,track})});toast(benchmark?'Эталон сохранён':'Трасса добавлена');go(benchmark?'benchmarks':'tracks');}catch(e){toast(e.message);btn.disabled=false;}};}
start();

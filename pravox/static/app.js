'use strict';
const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
const BASE = document.documentElement.dataset.basePath || '';
const state = { user:null, conversations:[], active:null, pending:null, config:null, view:'chat', report:'overview', offset:0, requestId:null, draft:null, signature:'', busy:false };
const emptyTemplate = $('empty').cloneNode(true);
const number = value => value == null ? '—' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(value);
const date = timestamp => timestamp ? new Date(timestamp*1000).toLocaleString('ru-RU') : '—';
const el = (tag, text, cls) => {const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;};
function notice(message) {$('notice').textContent=message||'';$('notice').hidden=!message;}
function modal(id) {if(!$(id).open)$(id).showModal();}
function closeSidebar() {$('sidebar').classList.remove('open');}
async function api(path, method='GET', data) {
  const headers={'Authorization':'tma '+(tg?.initData||'')};
  if(data!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(BASE+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),credentials:'omit',cache:'no-store'});
  const result=await response.json();
  if(!response.ok){const error=new Error(result.message||'Не удалось выполнить запрос.');error.code=result.error;error.status=response.status;throw error;}
  return result;
}
function handleError(error) {
  if(error.code==='subscription_required')modal('gate-dialog');
  else if(error.code==='consent_required')modal('consent-dialog');
  else notice(error.message||'Соединение прервалось. Попробуйте ещё раз.');
}
function privacyNodes() {
  const c=state.config;
  return [
    ['Что обрабатывается',`Ваш Telegram ID, имя, вопросы, ответы, время обращений и оценки ответов. История на стороне правоХ хранится до ${c.history_days} дней. Администратор видит статистику, идентификаторы и технические результаты запросов; в панели нет просмотра текстов диалогов.`],
    ['Как используется ИИ',c.local_ai?'Тестовая модель работает на сервере правоХ без внешнего API. Поиск и проверка актуальности законодательства отключены. Ответы требуют самостоятельной проверки.':`Вопрос и последние сообщения выбранного диалога передаются ИИ-провайдеру: ${c.ai_provider_name||'ещё не настроен'}. Для проверки правовых оснований сервис использует поиск; поисковый запрос также обрабатывается внешним сервисом. Условия внешнего провайдера и Telegram действуют отдельно.`],
    ['Управление историей','Вы можете удалить историю в меню приложения или командой /delete. Тексты обращений и ответов удаляются из рабочего хранилища правоХ; счётчик запросов и статистические записи сохраняются. Удаление не затрагивает сообщения в Telegram и данные, уже обработанные провайдером. Резервные копии хранятся до 7 дней.'],
    ['Безопасное описание ситуации','Не отправляйте паспорта, банковские реквизиты, полные адреса и чужие личные сведения. Используйте обезличенное описание. Ответ ИИ не является гарантией правового результата; проверяйте источники и обращайтесь к специалисту, когда нужна помощь по делу.'],
    ['Кто отвечает за сервис',`Оператор: ${c.operator_name||'сведения будут добавлены перед публичным запуском'}. Контакт: ${c.support_contact||c.channel_url}.`],
    ['Условия бесплатного доступа','Первые 3 успешно обработанных юридических запроса, включая уточнения, доступны без подписки. Затем нужна подписка на @pravoXru. Команды меню, технические ошибки и отказы по вопросам вне права не расходуют счётчик. Счётчик общий для чата и Mini App.'],
  ];
}
function setupPrivacy() {
  for(const [title,text] of privacyNodes()){$('privacy-content').append(el('h2',title),el('p',text));}
  $('consent-copy').append(el('p',`Ваши вопросы и история текущего диалога будут передаваться ИИ-сервису. История правоХ хранится до ${state.config.history_days} дней; её можно удалить в меню.`));
  const link=el('a','Открыть описание обработки обращений');link.href=BASE+'/privacy';link.target='_blank';link.rel='noopener';$('consent-copy').append(link);
}
function renderProfile() {
  const u=state.user;
  $('profile-name').textContent=u.first_name||'Пользователь';$('profile-avatar').textContent=(u.first_name||'Я').slice(0,1);
  $('admin-view-button').hidden=!u.is_admin;
  $('access-button').textContent=u.is_admin?'Администратор':u.free_remaining>0?`Бесплатно: ${u.free_remaining} из 3`:'Доступ по подписке';
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===u.mode)));
  $('mode-note').textContent=u.mode==='student'?'От понятия — к аргументации':'От ситуации — к действиям';
  const active=state.conversations.find(c=>c.id===state.active);
  $('current-title').textContent=state.view==='admin'?'Панель администратора':active?.title||'Новый диалог';
  $('conversation-list').replaceChildren();
  if(!state.conversations.length)$('conversation-list').append(el('p','Здесь появятся ваши диалоги.','history-empty'));
  for(const c of state.conversations){const b=el('button',c.title,'conversation-button'+(c.id===state.active?' active':''));b.dataset.conversation=c.id;b.append(el('small',(c.mode==='student'?'Учёба':'Ситуация')+' · '+new Date(c.updated*1000).toLocaleDateString('ru-RU')));$('conversation-list').append(b);}
}
function citedText(text,sources) {
  const fragment=document.createDocumentFragment();let last=0;
  const regex=/\[(\d+)\]/g;let match;
  while((match=regex.exec(text))){fragment.append(document.createTextNode(text.slice(last,match.index)));const source=sources[Number(match[1])-1];if(source){const a=el('a',match[0],'citation');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';a.title=source.title;fragment.append(a);}else fragment.append(document.createTextNode(match[0]));last=regex.lastIndex;}
  fragment.append(document.createTextNode(text.slice(last)));return fragment;
}
function renderMessages(messages,forceBottom=false) {
  const signature=JSON.stringify([state.active,state.user?.mode,messages]);if(signature===state.signature)return;state.signature=signature;
  const area=$('messages');const atBottom=area.scrollHeight-area.scrollTop-area.clientHeight<80;const oldTop=area.scrollTop;area.replaceChildren();
  if(!messages.length){const empty=emptyTemplate.cloneNode(true);if(state.user?.mode==='student'){empty.querySelector('h1').textContent='В какой теме разберёмся?';empty.querySelector('p').textContent='Определения, нормы, учебные примеры и логика ответа на семинаре.';}area.append(empty);}
  for(const m of messages){const article=el('article',null,'message '+m.role);article.append(el('div',m.role==='assistant'?'правоХ':'Вы','message-label'));const body=el('div',null,'message-content');body.append(citedText(m.text,m.sources||[]));article.append(body);
    if(m.role==='assistant'&&m.sources?.length){const details=el('details',null,'sources');details.append(el('summary',`Источники · ${m.sources.length}`));m.sources.forEach((s,i)=>{const a=el('a',`${i+1}. ${s.title}`);a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';try{a.append(el('small',new URL(s.url).hostname));}catch{}details.append(a);});article.append(details);}
    article.append(el('div',date(m.created)+(m.surface==='telegram'?' · Telegram':' · приложение'),'message-time'));
    if(m.role==='user'&&m.job_state==='failed')article.append(el('p','Ответ не получен — запрос не списан.','message-time'));
    if(m.role==='assistant'){const feedback=el('div',null,'feedback');for(const [value,label] of [[1,'Полезно'],[-1,'Есть ошибка']]){const b=el('button',label);b.dataset.feedback=value;b.dataset.message=m.id;b.setAttribute('aria-pressed',String(m.feedback===value));feedback.append(b);}article.append(feedback);}area.append(article);
  }
  if(forceBottom||atBottom)area.scrollTop=area.scrollHeight;else area.scrollTop=oldTop;
}
async function loadHistory(forceBottom=false){if(!state.active){renderMessages([],forceBottom);return;}const id=state.active;const data=await api('/api/conversations/'+id);if(state.active===id)renderMessages(data.messages,forceBottom);}
async function refresh(forceBottom=false) {const data=await api('/api/me');state.user=data.user;state.conversations=data.conversations;state.active=data.user.active_conversation;renderProfile();if(state.view==='chat')await loadHistory(forceBottom);if(data.active_job&&!state.pending)watchJob(data.active_job.id);if(!state.user.consent)modal('consent-dialog');}
function setPending(value){$('pending').hidden=!value;$('send').disabled=value;$('question').disabled=value;document.querySelectorAll('[data-mode]').forEach(b=>b.disabled=value);$('new-chat').disabled=value;}
async function watchJob(id){state.pending=id;setPending(true);let failures=0;while(state.pending===id){try{const job=await api('/api/jobs/'+id);failures=0;if(job.state==='done'||job.state==='failed'){state.pending=null;setPending(false);if(job.state==='failed')notice('Не удалось подготовить проверяемый ответ. Запрос не списан. Вы можете повторить вопрос.');await refresh(true);return;}}catch(error){failures++;if(error.status===401){state.pending=null;setPending(false);handleError(error);return;}if(failures===3)notice('Соединение нестабильно. Восстанавливаю статус запроса; повторно отправлять вопрос не нужно.');}await new Promise(resolve=>setTimeout(resolve,2500));}}
function switchView(view){if(view==='admin'&&!state.user?.is_admin)return;state.view=view;$('chat-view').hidden=view!=='chat';$('admin-view').hidden=view!=='admin';$('chat-view-button').classList.toggle('active',view==='chat');$('admin-view-button').classList.toggle('active',view==='admin');renderProfile();closeSidebar();if(view==='admin')loadAdmin().catch(handleError);else loadHistory().catch(handleError);}
async function newChat(mode=state.user.mode){await api('/api/conversations','POST',{mode});state.signature='';switchView('chat');await refresh(true);closeSidebar();$('question').focus();}
async function sendQuestion(event){event.preventDefault();if(state.pending||state.busy)return;const question=$('question').value.trim();if(!question)return;notice('');state.busy=true;$('send').disabled=true;if(state.draft!==question){state.requestId=crypto.randomUUID();state.draft=question;}try{const job=await api('/api/ask','POST',{question,client_id:state.requestId,conversation_id:state.active});state.active=job.conversation_id;$('question').value='';$('char-count').textContent='Без паспортных данных и реквизитов';state.requestId=null;state.draft=null;await refresh(true);if(!state.pending&&job.state==='queued')watchJob(job.id);if(job.state==='done'||job.state==='failed')await loadHistory(true);}catch(error){handleError(error);}finally{state.busy=false;if(!state.pending)$('send').disabled=false;}}
function metric(title,value,detail){const card=el('div',null,'metric');card.append(el('span',title),el('b',value),el('small',detail));return card;}
function reportCard(title,lines){const card=el('section',null,'report-card');card.append(el('h2',title));for(const [label,value] of lines){const row=el('div',null,'stat-line');row.append(el('span',label),el('b',number(value)));card.append(row);}return card;}
function makeTable(rows,columns){if(!rows.length)return el('p','За этот период данных пока нет.','empty-report');const wrapper=el('div',null,'table-scroll');const table=el('table');const head=el('tr');for(const [,label]of columns)head.append(el('th',label));const thead=el('thead');thead.append(head);table.append(thead);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const [key,,format]of columns)tr.append(el('td',format?format(row[key]):row[key]??'—'));body.append(tr);}table.append(body);wrapper.append(table);return wrapper;}
async function loadAdmin(){if(!state.user?.is_admin)return;$('admin-content').setAttribute('aria-busy','true');const report=state.report;const days=$('period').value;try{const content=document.createDocumentFragment();let rows=[];if(report==='overview'){const s=await api('/api/admin/stats?days='+days);const grid=el('div',null,'metric-grid');grid.append(metric('Пользователи всего',number(s.users_total),`Новых за период: ${number(s.users_new)}`),metric('Запросы',number(s.requests),`В очереди сейчас: ${number(s.pending)}`),metric('Успешно завершено',number(s.completed),`Доля: ${number(s.success_rate)}%`),metric('Активность за день',number(s.dau),`WAU ${number(s.wau)} · MAU ${number(s.mau)}`));content.append(grid);const split=el('div',null,'report-split');split.append(reportCard('Переход к подписке',[['Увидели требование',s.gate_users],['Подтвердили после него',s.converted_users],['Конверсия, %',s.conversion_pct],['Подписаны при последней проверке',s.known_members]]),reportCard('Качество и расход',[['Ошибки ответа',s.failed],['Медиана ответа, сек.',s.p50_seconds],['95-й процентиль, сек.',s.p95_seconds],['Входящие токены',s.input_tokens],['Исходящие токены',s.output_tokens],['Вызовы поиска',s.search_calls],['Оценка стоимости токенов, $',s.estimated_token_cost_usd]]));content.append(split);const sources=el('div',null,'report-split');sources.append(reportCard('Каналы и режимы',[['Telegram-чат',s.by_surface.telegram],['Mini App',s.by_surface.miniapp],['Гражданин',s.by_mode.citizen],['Студент',s.by_mode.student]]),reportCard('Оценки и доставка',[['Ответ полезен',s.feedback.find(f=>f.feedback===1)?.total||0],['Пользователь отметил ошибку',s.feedback.find(f=>f.feedback===-1)?.total||0],['Сообщения ждут отправки',s.delivery_pending],['Ошибки доставки',s.delivery_failed]]));content.append(sources);const daily=el('section',null,'report-card');daily.append(el('h2','Запросы по дням'));const max=Math.max(1,...s.daily.map(d=>d.requests));const chart=el('div',null,'table-scroll');const table=el('table',null,'daily-table');const tbody=el('tbody');for(const row of s.daily){const tr=el('tr');tr.append(el('td',row.day));const cell=el('td');const bar=el('progress');bar.max=max;bar.value=row.requests;bar.setAttribute('aria-label',row.day+': '+row.requests+' запросов');cell.append(bar);tr.append(cell,el('td',number(row.requests)));tbody.append(tr);}table.append(tbody);chart.append(table);daily.append(chart);content.append(daily);if(s.errors.length)content.append(reportCard('Причины ошибок',s.errors.map(e=>[e.error_code,e.total])));}else{const data=await api('/api/admin/'+report+'?offset='+state.offset);rows=data.rows;content.append(makeTable(rows,report==='users'?[['id','Telegram ID'],['first_name','Имя'],['username','Username'],['used','Запросов'],['mode','Режим'],['member_status','Подписка'],['created','Регистрация',date],['last_seen','Активность',date]]:[['created','Время',date],['user_id','Telegram ID'],['surface','Интерфейс'],['mode','Режим'],['state','Статус'],['latency','Секунды',number],['input_tokens','Токены вход'],['output_tokens','Токены выход'],['error_code','Ошибка']]));content.append(el('p',`Строки ${rows.length?state.offset+1:0}–${state.offset+rows.length}. Тексты обращений не включены.`,'export-note'));}if(state.report!==report)return;$('admin-content').replaceChildren(content);$('prev-page').hidden=report==='overview'||state.offset===0;$('next-page').hidden=report==='overview'||rows.length<50;}finally{$('admin-content').setAttribute('aria-busy','false');}}
async function exportReport(){const kind=state.report==='overview'?'daily':state.report;$('export').disabled=true;try{await api('/api/admin/export-to-telegram','POST',{kind,days:Number($('period').value)});notice('CSV отправлен вам в личный чат с ботом.');}catch(error){handleError(error);}finally{$('export').disabled=false;}}
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;try{if(b.dataset.close)$(b.dataset.close).close();if(b.dataset.mode&&b.dataset.mode!==state.user.mode)await newChat(b.dataset.mode);if(b.dataset.conversation){await api('/api/conversations/'+b.dataset.conversation+'/activate','POST',{});state.signature='';switchView('chat');await refresh(true);closeSidebar();}if(b.dataset.prompt){$('question').value=b.dataset.prompt;$('question').focus();}if(b.dataset.report){state.report=b.dataset.report;state.offset=0;document.querySelectorAll('[data-report]').forEach(item=>item.classList.toggle('active',item===b));await loadAdmin();}if(b.dataset.feedback){await api('/api/feedback','POST',{message_id:Number(b.dataset.message),value:Number(b.dataset.feedback)});b.parentElement.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));tg?.HapticFeedback?.notificationOccurred('success');}}catch(error){handleError(error);}});
$('composer').addEventListener('submit',sendQuestion);
$('question').addEventListener('input',()=>{$('char-count').textContent=$('question').value.length?`${$('question').value.length} / 6000`:'Без паспортных данных и реквизитов';});
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&window.matchMedia('(pointer:fine)').matches){event.preventDefault();$('composer').requestSubmit();}});
$('new-chat').onclick=()=>newChat().catch(handleError);
$('open-sidebar').onclick=()=>$('sidebar').classList.add('open');$('close-sidebar').onclick=closeSidebar;
$('chat-view-button').onclick=()=>switchView('chat');$('admin-view-button').onclick=()=>switchView('admin');
$('access-button').onclick=()=>{if(!state.user.is_admin)modal('gate-dialog');};
$('delete-history').onclick=()=>modal('delete-dialog');
$('confirm-delete').onclick=async()=>{try{await api('/api/history','DELETE');$('delete-dialog').close();state.signature='';await refresh(true);notice('История правоХ удалена.');}catch(error){handleError(error);}};
$('accept').onclick=async()=>{try{await api('/api/consent','POST',{accepted:true});$('consent-dialog').close();await refresh();}catch(error){handleError(error);}};
$('check-membership').onclick=async()=>{$('check-membership').disabled=true;try{const data=await api('/api/membership','POST',{});$('membership-result').textContent=data.subscribed?'Подписка подтверждена. Можно продолжать общение.':'Подписка пока не найдена. Подпишитесь и повторите проверку.';if(data.subscribed){await refresh();$('gate-dialog').close();notice('Подписка подтверждена. Отправьте ваш вопрос.');}}catch(error){$('membership-result').textContent=error.message;}finally{$('check-membership').disabled=false;}};
$('period').onchange=()=>loadAdmin().catch(handleError);$('export').onclick=exportReport;
$('prev-page').onclick=()=>{state.offset=Math.max(0,state.offset-50);loadAdmin().catch(handleError);};$('next-page').onclick=()=>{state.offset+=50;loadAdmin().catch(handleError);};
$('channel-link').onclick=event=>{if(tg?.initData){event.preventDefault();tg.openTelegramLink(state.config.channel_url);}};
async function boot(){try{const response=await fetch(BASE+'/api/public',{cache:'no-store'});if(!response.ok)throw new Error('Сервис пока недоступен.');state.config=await response.json();setupPrivacy();if(location.pathname===BASE+'/privacy'){$('boot').hidden=true;$('privacy-page').hidden=false;return;}$('channel-link').href=state.config.channel_url;if(state.config.bot_username){$('bot-link').href='https://t.me/'+state.config.bot_username;$('bot-link').hidden=false;}if(!tg?.initData){$('boot-text').textContent='Откройте приложение через кнопку «Открыть приложение» в Telegram-боте правоХ. Так мы безопасно подключим ваш профиль и историю.';return;}tg.ready();tg.expand();await refresh(true);$('boot').hidden=true;$('shell').hidden=false;if(state.config.local_ai)notice('Тестовый ИИ: актуальность законодательства не проверяется.');if(!state.config.ai_ready)notice('ИИ ещё не подключён. Ваши бесплатные запросы не расходуются.');if(location.hash==='#admin'&&state.user.is_admin)switchView('admin');setInterval(()=>{if(!document.hidden&&!state.pending&&!state.busy&&state.view==='chat')refresh().catch(handleError);},7000);}catch(error){$('boot-text').textContent=error.message||'Не удалось открыть приложение. Попробуйте позже.';}}
boot();

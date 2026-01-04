/* =========================================================
   FinanceApp - main.js (Frontend listo para GitHub Pages)
   - Multiusuario por email (no se mezclan datos)
   - Pareja: invitación + código (backend Apps Script)
   - Gasto compartido: solicitud + aceptar/rechazar + notificación in-app
   - CRUD: Ingresos / Gastos (Editar/Eliminar)
   - Charts + Dashboard + filtros
   ---------------------------------------------------------
   IMPORTANTE:
   1) Pegá tu URL del Web App (Deploy /exec) en CONFIG.API_URL
   2) Tu Apps Script debe implementar los actions usados (ver APIService.call)
   ========================================================= */

const CONFIG = {
  // ✅ Pegá acá tu URL del Web App de Apps Script:
  // Ejemplo: 'https://script.google.com/macros/s/AKfycbx.../exec'
  API_URL: 'PEGAR_AQUI_TU_URL_DEL_DEPLOY_EXEC',

  DEFAULT_CURRENCY: 'ARS',
  NOTIF_POLL_MS: 15000,      // polling de notificaciones
  SAVE_LOCAL_FALLBACK: true  // si falla API, usa LocalStorage (solo para pruebas)
};

// ===============================
// Estado global
// ===============================
const APP_STATE = {
  user: null,          // {email,name,picture?,currency?,darkMode?}
  partner: null,       // {email,name?}
  currentSection: 'dashboard',
  data: {
    categorias: [],
    ingresos: [],
    gastos: [],
    tarjetas: [],
    shared_requests: [],
    gastos_compartidos: [],
    notificaciones: []
  },
  charts: { expenses: null, trend: null },
  timers: { poll: null }
};

// ===============================
// Helpers
// ===============================
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const fmtMoney = (v) => {
  const cur = (APP_STATE.user?.currency || CONFIG.DEFAULT_CURRENCY || 'ARS').toUpperCase();
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat('es-AR', { style:'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};
const safeNum = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
};
const uid = (p='id') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const todayISO = () => {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
};
function initials(nameOrEmail='') {
  const s = String(nameOrEmail).trim();
  if (!s) return 'U';
  if (s.includes('@')) return s.split('@')[0].slice(0,2).toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0]||'U')[0]||'U';
  const b = (parts[1]||parts[0]||'U')[0]||'U';
  return (a+b).toUpperCase();
}
function parseDateAny(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  // ISO
  const d0 = new Date(s);
  if (!isNaN(d0.getTime())) return d0;
  // dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = parseInt(m[1],10);
    const mm = parseInt(m[2],10)-1;
    const yy = parseInt(m[3],10);
    const d = new Date(yy,mm,dd);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function sameMonth(d, y, m) {
  const dt = parseDateAny(d); if (!dt) return false;
  return dt.getFullYear()===y && (dt.getMonth()+1)===m;
}
function monthLabel(y,m){
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[m-1]} ${y}`;
}
function showAlert(msg, type='info', timeout=3500) {
  const c = $('#alertsContainer');
  if (!c) return;
  const id = uid('al');
  const cls = type === 'danger' ? 'alert alert-danger' :
              type === 'success' ? 'alert alert-success' :
              type === 'warning' ? 'alert alert-warning' : 'alert alert-info';
  const html = `
    <div id="${id}" class="${cls}" style="margin-bottom:12px;">
      <i class="fas fa-circle-info"></i>
      <div>${msg}</div>
    </div>`;
  c.insertAdjacentHTML('afterbegin', html);
  if (timeout) setTimeout(()=>{ const el=$('#'+id); el?.remove(); }, timeout);
}
function showModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('active');
}
function closeAllModals() {
  $$('.modal-overlay').forEach(m => m.classList.remove('active'));
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ===============================
// JSONP (para Apps Script sin CORS)
// ===============================
function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  try { return decodeURIComponent(escape(atob(str))); } catch { return ''; }
}
function jsonpRequest(url, timeoutMs=15000) {
  return new Promise((resolve, reject) => {
    const cb = `__cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Timeout JSONP')); }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cb]; } catch { window[cb]=undefined; }
      script.remove();
    }

    window[cb] = (data) => { cleanup(); resolve(data); };
    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}callback=${encodeURIComponent(cb)}`;
    script.onerror = () => { cleanup(); reject(new Error('Error JSONP')); };
    document.body.appendChild(script);
  });
}

// ===============================
// API Service
// - Espera backend con:
//   ?action=leer&tabla=ingresos&userEmail=...
//   ?action=guardar&tabla=gastos&userEmail=...&payload=BASE64(JSON)
//   + actions especiales sin tabla (tabla="")
// ===============================
const APIService = {
  async call(action, tabla='', payloadObj=null) {
    if (!CONFIG.API_URL || CONFIG.API_URL.includes('PEGAR_AQUI')) {
      throw new Error('CONFIG.API_URL no configurado');
    }
    const params = new URLSearchParams();
    params.set('action', action);
    params.set('tabla', tabla || '');
    params.set('userEmail', APP_STATE.user?.email || '');
    if (payloadObj) params.set('payload', b64EncodeUnicode(JSON.stringify(payloadObj)));
    const url = `${CONFIG.API_URL}?${params.toString()}`;
    const res = await jsonpRequest(url);
    if (!res || res.success === false) throw new Error(res?.message || 'Error API');
    return res;
  },
  async ping() {
    try { return await this.call('ping'); }
    catch { return { success:true, message:'skip' }; }
  },
  async leer(tabla) {
    const r = await this.call('leer', tabla);
    return r.datos || [];
  },
  async guardar(tabla, fila) {
    return await this.call('guardar', tabla, { fila });
  },
  async actualizar(tabla, fila) {
    return await this.call('actualizar', tabla, { fila });
  },
  async eliminar(tabla, id) {
    return await this.call('eliminar', tabla, { id });
  },

  // Pareja
  async crearInvitacion(toEmail) {
    return await this.call('crear_invitacion', '', { toEmail });
  },
  async aceptarInvitacion(code) {
    return await this.call('aceptar_invitacion', '', { code });
  },
  async leerPareja() {
    const r = await this.call('leer_pareja', '', {});
    return r.partner || null;
  },

  // Shared (solicitud)
  async crearSolicitudCompartido(req) {
    return await this.call('crear_solicitud_compartido', '', req);
  },
  async responderSolicitudCompartido(requestId, decision) {
    return await this.call('responder_solicitud_compartido', '', { requestId, decision });
  },

  // Notificaciones
  async leerNotificaciones() {
    const r = await this.call('leer_notificaciones', '', {});
    return r.datos || [];
  },
  async marcarNotificacionLeida(id) {
    return await this.call('marcar_notificacion_leida', '', { id });
  }
};

// ===============================
// Local fallback (solo pruebas)
// ===============================
const LocalStore = {
  key(tabla){ return `financeapp_${APP_STATE.user?.email||'anon'}_${tabla}`; },
  get(tabla){
    try { return JSON.parse(localStorage.getItem(this.key(tabla))||'[]'); } catch { return []; }
  },
  set(tabla, arr){
    localStorage.setItem(this.key(tabla), JSON.stringify(arr||[]));
  }
};

async function apiReadOrLocal(tabla) {
  try { return await APIService.leer(tabla); }
  catch (e) {
    if (!CONFIG.SAVE_LOCAL_FALLBACK) throw e;
    return LocalStore.get(tabla);
  }
}
async function apiSaveOrLocal(tabla, fila) {
  try { return await APIService.guardar(tabla, fila); }
  catch (e) {
    if (!CONFIG.SAVE_LOCAL_FALLBACK) throw e;
    const arr = LocalStore.get(tabla);
    arr.push(fila);
    LocalStore.set(tabla, arr);
    return { success:true, id:fila.id };
  }
}
async function apiUpdateOrLocal(tabla, fila) {
  try { return await APIService.actualizar(tabla, fila); }
  catch (e) {
    if (!CONFIG.SAVE_LOCAL_FALLBACK) throw e;
    const arr = LocalStore.get(tabla);
    const idx = arr.findIndex(x=>x.id===fila.id);
    if (idx>=0) arr[idx]=fila;
    LocalStore.set(tabla, arr);
    return { success:true };
  }
}
async function apiDeleteOrLocal(tabla, id) {
  try { return await APIService.eliminar(tabla, id); }
  catch (e) {
    if (!CONFIG.SAVE_LOCAL_FALLBACK) throw e;
    const arr = LocalStore.get(tabla).filter(x=>x.id!==id);
    LocalStore.set(tabla, arr);
    return { success:true };
  }
}

// ===============================
// Boot
// ===============================
document.addEventListener('DOMContentLoaded', () => {
  wireUI();
  restoreUser();

  if (APP_STATE.user) {
    showMainApp();
  } else {
    showLogin();
  }
});

function wireUI() {
  // login
  $('#googleLoginBtn')?.addEventListener('click', loginFallback);
  $('#emailLoginBtn')?.addEventListener('click', handleEmailLogin);


  // nav
  $$('.nav-item[data-section]').forEach(a => {
    a.addEventListener('click', (e)=>{
      e.preventDefault();
      showSection(a.dataset.section);
    });
  });

  // sidebar toggle
  $('#menuToggle')?.addEventListener('click', ()=> $('#sidebar')?.classList.toggle('active'));

  // logout
  $('#logoutBtn')?.addEventListener('click', logout);

  // modales close
  $$('.modal-close').forEach(b=> b.addEventListener('click', closeAllModals));

  // abrir modales
  $('#addIncomeBtn')?.addEventListener('click', ()=> openIncomeModal());
  $('#addExpenseBtn')?.addEventListener('click', ()=> openExpenseModal(false));
  $('#addSharedExpenseBtn')?.addEventListener('click', ()=> openExpenseModal(true));
  $('#addCardBtn')?.addEventListener('click', ()=> showModal('cardModal'));

  // guardar
  $('#saveIncomeBtn')?.addEventListener('click', saveIncome);
  $('#saveExpenseBtn')?.addEventListener('click', saveExpense);
  $('#saveCardBtn')?.addEventListener('click', saveCard);

  // pareja
  $('#invitePartnerBtn')?.addEventListener('click', ()=> showModal('inviteModal'));
  $('#acceptInviteBtn')?.addEventListener('click', ()=> showModal('acceptInviteModal'));
  $('#sendInviteBtn')?.addEventListener('click', sendInvite);
  $('#acceptInviteConfirmBtn')?.addEventListener('click', acceptInvite);

  // notificaciones modal
  $('#notifBtn')?.addEventListener('click', ()=> { renderNotifications(); showModal('notificationsModal'); });
  $('#notifList')?.addEventListener('click', onNotifListClick);

  // filtros charts
  $('#expensePeriod')?.addEventListener('change', ()=>{ updateDashboard(); });
  $('#trendPeriod')?.addEventListener('change', ()=>{ updateDashboard(); });

  // filtros ingresos/gastos
  $('#applyIncomePeriodBtn')?.addEventListener('click', loadIncomes);
  $('#clearIncomePeriodBtn')?.addEventListener('click', ()=>{ $('#incomeMonthSelect').value=''; $('#incomeYearSelect').value=''; loadIncomes(); });
  $('#applyExpensePeriodBtn')?.addEventListener('click', loadExpenses);
  $('#clearExpensePeriodBtn')?.addEventListener('click', ()=>{ $('#expenseMonthSelect').value=''; $('#expenseYearSelect').value=''; loadExpenses(); });
  $('#expenseFilter')?.addEventListener('change', loadExpenses);

  // tabs gastos
  $('#expenseTabs')?.addEventListener('click', (e)=>{
    const btn = e.target.closest('.tab'); if (!btn) return;
    $$('#expenseTabs .tab').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    loadExpenses();
  });

  // delegación editar/eliminar
  $('#incomesList')?.addEventListener('click', onIncomeListClick);
  $('#expensesList')?.addEventListener('click', onExpenseListClick);

  // toggles shared/credit en gasto
  $('#isSharedCheck')?.addEventListener('change', (e)=> $('#sharedFields')?.classList.toggle('hidden', !e.target.checked));
  $('#sharedPercentageSelect')?.addEventListener('change', (e)=> $('#customPercentageField')?.classList.toggle('hidden', e.target.value !== 'custom'));
  $('#expenseForm select[name="tipo"]')?.addEventListener('change', (e)=> $('#creditCardFields')?.classList.toggle('hidden', e.target.value !== 'credit'));
}

function showLogin() {
  $('#loginScreen')?.classList.remove('hidden');
  $('#mainApp')?.classList.add('hidden');
}
function showMainApp() {
  $('#loginScreen')?.classList.add('hidden');
  $('#mainApp')?.classList.remove('hidden');
  updateUserUI();
  initYearSelects();
  loadAll().catch(err=>{
    console.error(err);
    showAlert('Error inicial. Revisá CONFIG.API_URL y tu Apps Script.', 'danger', 6000);
  });

  // polling
  if (APP_STATE.timers.poll) clearInterval(APP_STATE.timers.poll);
  APP_STATE.timers.poll = setInterval(async ()=>{
    try { await refreshPartnerAndShared(); } catch {}
    try { await refreshNotifications(); } catch {}
  }, CONFIG.NOTIF_POLL_MS);
}

function restoreUser() {
  try {
    const raw = localStorage.getItem('financeapp_user');
    if (raw) APP_STATE.user = JSON.parse(raw);
  } catch {}
}

function loginFallback(e){
  e?.preventDefault?.();
  // Prefer el formulario de email (sin Google) para que funcione incluso en file://
  document.getElementById('loginEmail')?.focus();
  // Si no existe el formulario, usa prompt como último recurso.
  if (!document.getElementById('loginEmail')) {
    const email = prompt('Ingresá tu email para continuar');
    if (!email) return;
    const name = email.split('@')[0] || 'Usuario';
    completeLogin({ email, name, picture: null });
  }
}

function handleEmailLogin(e){
  e?.preventDefault?.();
  const name = (document.getElementById('loginName')?.value || '').trim() || 'Usuario';
  const email = (document.getElementById('loginEmail')?.value || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Ingresá un email válido', 'warning');
    document.getElementById('loginEmail')?.focus();
    return;
  }
  completeLogin({ email, name, picture: null });
}

function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  localStorage.removeItem('financeapp_user');
  APP_STATE.user = null;
  APP_STATE.partner = null;
  APP_STATE.data = { categorias:[], ingresos:[], gastos:[], tarjetas:[], shared_requests:[], gastos_compartidos:[], notificaciones:[] };
  if (APP_STATE.timers.poll) clearInterval(APP_STATE.timers.poll);
  showLogin();
}

function updateUserUI() {
  setText('userName', APP_STATE.user?.name || 'Usuario');
  setText('userEmail', APP_STATE.user?.email || '');
  setText('userInitials', initials(APP_STATE.user?.name || APP_STATE.user?.email));
  setText('currencyDisplay', (APP_STATE.user?.currency || CONFIG.DEFAULT_CURRENCY).toUpperCase());
}

// ===============================
// Navegación
// ===============================
function showSection(section) {
  APP_STATE.currentSection = section;
  // active nav
  $$('.nav-item[data-section]').forEach(a=> a.classList.toggle('active', a.dataset.section===section));

  const map = {
    dashboard: 'dashboardSection',
    incomes: 'incomesSection',
    expenses: 'expensesSection',
    shared: 'sharedSection',
    cards: 'cardsSection',
    projections: 'projectionsSection',
    reports: 'reportsSection',
    settings: 'settingsSection'
  };
  Object.values(map).forEach(id => $('#'+id)?.classList.add('hidden'));
  $('#'+map[section])?.classList.remove('hidden');

  if (section === 'dashboard') updateDashboard();
  if (section === 'shared') renderShared();
  if (section === 'cards') renderCards();
  if (section === 'projections') renderProjections();
  if (section === 'reports') renderReports();
  if (section === 'settings') renderSettings();
}

// ===============================
// Init data
// ===============================
function initYearSelects() {
  const now = new Date();
  const y0 = now.getFullYear();
  const years = [];
  for (let y = y0 - 5; y <= y0 + 1; y++) years.push(y);

  for (const id of ['incomeYearSelect','expenseYearSelect']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.innerHTML = '<option value="">Todos</option>' + years.map(y=>`<option value="${y}">${y}</option>`).join('');
    sel.value = '';
  }
  for (const id of ['incomeMonthSelect','expenseMonthSelect']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    if (!sel.querySelector('option[value=""]')) {
      const opt = document.createElement('option'); opt.value=''; opt.textContent='Todos';
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = '';
  }
}

async function loadAll() {
  await APIService.ping();

  // Pareja
  try { APP_STATE.partner = await APIService.leerPareja(); }
  catch { APP_STATE.partner = null; }

  // Datos
  APP_STATE.data.categorias = await apiReadOrLocal('categorias');
  APP_STATE.data.ingresos = await apiReadOrLocal('ingresos');
  APP_STATE.data.gastos = await apiReadOrLocal('gastos');
  APP_STATE.data.tarjetas = await apiReadOrLocal('tarjetas');

  // tablas extra (si existen en tu Sheet)
  try { APP_STATE.data.shared_requests = await apiReadOrLocal('shared_requests'); } catch {}
  try { APP_STATE.data.gastos_compartidos = await apiReadOrLocal('gastos_compartidos'); } catch {}
  try { APP_STATE.data.notificaciones = await APIService.leerNotificaciones(); } catch { APP_STATE.data.notificaciones = []; }

  // categorías default si no hay
  if (!APP_STATE.data.categorias?.length) {
    await seedDefaultCategories();
    APP_STATE.data.categorias = await apiReadOrLocal('categorias');
  }

  updateCategoryUI();
  loadIncomes();
  loadExpenses();
  await refreshPartnerAndShared();
  await refreshNotifications();
  updateDashboard();
}

async function seedDefaultCategories() {
  const defaults = [
    { nombre:'Sueldo', tipo:'income' },
    { nombre:'Freelance', tipo:'income' },
    { nombre:'Alquiler', tipo:'fixed' },
    { nombre:'Servicios', tipo:'fixed' },
    { nombre:'Supermercado', tipo:'variable' },
    { nombre:'Transporte', tipo:'variable' },
    { nombre:'Salud', tipo:'variable' },
    { nombre:'Tarjeta', tipo:'credit' }
  ];
  for (const c of defaults) {
    const fila = { id: uid('cat'), ...c, userEmail: APP_STATE.user.email, createdAt: new Date().toISOString() };
    try { await apiSaveOrLocal('categorias', fila); } catch {}
  }
}

function updateCategoryUI() {
  // filtro general de gastos
  const filter = $('#expenseFilter');
  if (filter) {
    const cats = APP_STATE.data.categorias || [];
    const opts = ['<option value="all">Todas las categorías</option>']
      .concat(cats.filter(c=>c.tipo!=='income').map(c=>`<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`));
    filter.innerHTML = opts.join('');
  }

  // selects en modales
  const expSel = $('#expenseCategorySelect');
  if (expSel) {
    const cats = APP_STATE.data.categorias || [];
    expSel.innerHTML = '<option value="">Seleccionar categoría</option>' +
      cats.filter(c=>c.tipo!=='income').map(c=>`<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('');
  }

  const incSel = $('#incomeCategorySelect');
  if (incSel) {
    const cats = APP_STATE.data.categorias || [];
    incSel.innerHTML = '<option value="">Seleccionar categoría</option>' +
      cats.filter(c=>c.tipo==='income').map(c=>`<option value="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('');
  }
}

function escapeHtml(s='') {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

// ===============================
// Ingresos CRUD
// ===============================
function loadIncomes() {
  const list = $('#incomesList');
  if (!list) return;

  const month = parseInt($('#incomeMonthSelect')?.value || '', 10);
  const year = parseInt($('#incomeYearSelect')?.value || '', 10);

  let items = (APP_STATE.data.ingresos || []).slice().sort((a,b)=>{
    const da=parseDateAny(a.fecha)||new Date(0);
    const db=parseDateAny(b.fecha)||new Date(0);
    return db-da;
  });

  if (year && month) items = items.filter(x=>sameMonth(x.fecha, year, month));
  else if (year) items = items.filter(x=> (parseDateAny(x.fecha)?.getFullYear()===year));
  else if (month) items = items.filter(x=> (parseDateAny(x.fecha)?.getMonth()+1===month));

  if (!items.length) {
    list.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-plus-circle text-4xl mb-3"></i>
        <p class="mb-3">No tienes ingresos registrados</p>
        <button class="btn btn-accent btn-sm" onclick="document.getElementById('addIncomeBtn').click()">Agregar primer ingreso</button>
      </div>`;
    return;
  }

  const tpl = document.getElementById('incomeItemTemplate');
  list.innerHTML = '';
  items.forEach(it=>{
    let node;
    if (tpl?.content) {
      node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = it.id;
      node.querySelector('[data-field="descripcion"]').textContent = it.descripcion || 'Ingreso';
      node.querySelector('[data-field="fecha"]').textContent = fmtDate(it.fecha);
      node.querySelector('[data-field="frecuencia"]').textContent = labelFreq(it.frecuencia);
      node.querySelector('[data-field="categoria"]').textContent = it.categoria || 'General';
      node.querySelector('[data-field="monto"]').textContent = fmtMoney(it.monto);
    } else {
      node = document.createElement('div');
      node.className = 'p-4 border-b border-gray-100 flex items-center justify-between gap-4';
      node.dataset.id = it.id;
      node.innerHTML = `
        <div class="min-w-0">
          <div class="font-semibold text-gray-900 truncate">${escapeHtml(it.descripcion||'Ingreso')}</div>
          <div class="text-xs text-gray-500 mt-1">${escapeHtml(fmtDate(it.fecha))} • ${escapeHtml(labelFreq(it.frecuencia))} • ${escapeHtml(it.categoria||'General')}</div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="font-bold text-green-600 text-right">${fmtMoney(it.monto)}</div>
          <button class="btn btn-secondary btn-sm" data-action="edit-income"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger btn-sm" data-action="delete-income"><i class="fas fa-trash"></i></button>
        </div>`;
    }
    list.appendChild(node);
  });
}

function onIncomeListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const row = e.target.closest('[data-id]');
  const id = row?.dataset?.id;
  if (!id) return;

  const action = btn.dataset.action;
  const item = (APP_STATE.data.ingresos||[]).find(x=>x.id===id);
  if (!item) return;

  if (action === 'edit-income') openIncomeModal(item);
  if (action === 'delete-income') deleteIncome(item);
}

function openIncomeModal(item=null) {
  const modal = $('#incomeModal');
  if (!modal) return;

  const form = $('#incomeForm');
  form.reset();
  form.querySelector('input[name="id"]').value = item?.id || '';
  form.querySelector('input[name="descripcion"]').value = item?.descripcion || '';
  form.querySelector('input[name="monto"]').value = item?.monto ?? '';
  form.querySelector('input[name="fecha"]').value = toISO(item?.fecha) || todayISO();
  form.querySelector('select[name="frecuencia"]').value = item?.frecuencia || 'monthly';
  $('#incomeCategorySelect').value = item?.categoria || '';

  setText('incomeModalTitle', item ? 'Editar Ingreso' : 'Nuevo Ingreso');
  showModal('incomeModal');
}

async function saveIncome() {
  const form = $('#incomeForm'); if (!form) return;
  const id = form.querySelector('input[name="id"]').value || '';
  const descripcion = form.querySelector('input[name="descripcion"]').value.trim();
  const monto = safeNum(form.querySelector('input[name="monto"]').value);
  const fecha = form.querySelector('input[name="fecha"]').value;
  const frecuencia = form.querySelector('select[name="frecuencia"]').value;
  const categoria = $('#incomeCategorySelect')?.value || '';

  if (!descripcion || !fecha || !categoria) {
    showAlert('Completá descripción, fecha y categoría.', 'warning');
    return;
  }

  const fila = {
    id: id || uid('inc'),
    userEmail: APP_STATE.user.email,
    descripcion, monto, fecha, frecuencia, categoria,
    updatedAt: new Date().toISOString(),
    createdAt: id ? undefined : new Date().toISOString()
  };

  try {
    if (id) await apiUpdateOrLocal('ingresos', fila);
    else await apiSaveOrLocal('ingresos', fila);

    APP_STATE.data.ingresos = await apiReadOrLocal('ingresos');
    closeAllModals();
    loadIncomes();
    updateDashboard();
    showAlert(id ? 'Ingreso actualizado.' : 'Ingreso guardado.', 'success');
  } catch (err) {
    console.error(err);
    showAlert('No se pudo guardar el ingreso.', 'danger');
  }
}

async function deleteIncome(item) {
  if (!confirm(`Eliminar ingreso "${item.descripcion}"?`)) return;
  try {
    await apiDeleteOrLocal('ingresos', item.id);
    APP_STATE.data.ingresos = await apiReadOrLocal('ingresos');
    loadIncomes();
    updateDashboard();
    showAlert('Ingreso eliminado.', 'success');
  } catch (err) {
    console.error(err);
    showAlert('No se pudo eliminar.', 'danger');
  }
}

// ===============================
// Gastos CRUD + Compartidos
// ===============================
function loadExpenses() {
  const list = $('#expensesList');
  if (!list) return;

  const month = parseInt($('#expenseMonthSelect')?.value || '', 10);
  const year = parseInt($('#expenseYearSelect')?.value || '', 10);
  const catFilter = $('#expenseFilter')?.value || 'all';
  const tab = $('#expenseTabs .tab.active')?.dataset?.tab || 'all';

  let items = (APP_STATE.data.gastos || []).slice().sort((a,b)=>{
    const da=parseDateAny(a.fecha)||new Date(0);
    const db=parseDateAny(b.fecha)||new Date(0);
    return db-da;
  });

  // filtros
  if (year && month) items = items.filter(x=>sameMonth(x.fecha, year, month));
  else if (year) items = items.filter(x=> (parseDateAny(x.fecha)?.getFullYear()===year));
  else if (month) items = items.filter(x=> (parseDateAny(x.fecha)?.getMonth()+1===month));

  if (catFilter !== 'all') items = items.filter(x=>(x.categoria||'')===catFilter);

  if (tab !== 'all') {
    if (tab==='fixed') items = items.filter(x=>x.tipo==='fixed');
    if (tab==='variable') items = items.filter(x=>x.tipo==='variable');
    if (tab==='credit') items = items.filter(x=>x.tipo==='credit');
  }

  if (!items.length) {
    list.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-receipt text-4xl mb-3"></i>
        <p class="mb-3">No tienes gastos registrados</p>
        <button class="btn btn-accent btn-sm" onclick="document.getElementById('addExpenseBtn').click()">Agregar primer gasto</button>
      </div>`;
    return;
  }

  const tpl = document.getElementById('expenseItemTemplate');
  list.innerHTML = '';
  items.forEach(it=>{
    let node;
    if (tpl?.content) {
      node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = it.id;
      node.querySelector('[data-field="descripcion"]').textContent = it.descripcion || 'Gasto';
      node.querySelector('[data-field="fecha"]').textContent = fmtDate(it.fecha);
      node.querySelector('[data-field="tipo"]').textContent = labelTipo(it.tipo);
      node.querySelector('[data-field="categoria"]').textContent = it.categoria || '—';
      node.querySelector('[data-field="monto"]').textContent = fmtMoney(it.monto);
    } else {
      node = document.createElement('div');
      node.className='p-4 border-b border-gray-100 flex items-center justify-between gap-4';
      node.dataset.id = it.id;
      node.innerHTML = `
        <div class="min-w-0">
          <div class="font-semibold text-gray-900 truncate">${escapeHtml(it.descripcion||'Gasto')}</div>
          <div class="text-xs text-gray-500 mt-1">${escapeHtml(fmtDate(it.fecha))} • ${escapeHtml(labelTipo(it.tipo))} • ${escapeHtml(it.categoria||'—')}</div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="font-bold text-red-600 text-right">${fmtMoney(it.monto)}</div>
          <button class="btn btn-secondary btn-sm" data-action="edit-expense"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger btn-sm" data-action="delete-expense"><i class="fas fa-trash"></i></button>
        </div>`;
    }
    list.appendChild(node);
  });

  // indicadores cards gastos
  updateExpenseCards();
}

function onExpenseListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const row = e.target.closest('[data-id]');
  const id = row?.dataset?.id;
  if (!id) return;

  const action = btn.dataset.action;
  const item = (APP_STATE.data.gastos||[]).find(x=>x.id===id);
  if (!item) return;

  if (action === 'edit-expense') openExpenseModal(!!item.compartido, item);
  if (action === 'delete-expense') deleteExpense(item);
}

function openExpenseModal(sharedDefault=false, item=null) {
  const modal = $('#expenseModal'); if (!modal) return;
  const form = $('#expenseForm');
  form.reset();

  form.querySelector('input[name="id"]').value = item?.id || '';
  form.querySelector('input[name="descripcion"]').value = item?.descripcion || '';
  form.querySelector('input[name="monto"]').value = item?.monto ?? '';
  form.querySelector('input[name="fecha"]').value = toISO(item?.fecha) || todayISO();
  $('#expenseCategorySelect').value = item?.categoria || '';
  form.querySelector('select[name="tipo"]').value = item?.tipo || 'variable';
  form.querySelector('select[name="metodo_pago"]').value = item?.metodo_pago || 'cash';

  // credit fields
  const isCredit = (item?.tipo || 'variable') === 'credit';
  $('#creditCardFields')?.classList.toggle('hidden', !isCredit);
  $('#expenseCardSelect')?.value = item?.tarjeta_id || '';
  form.querySelector('input[name="cuotas"]').value = item?.cuotas ?? 1;

  // shared
  const isShared = item ? !!item.compartido : !!sharedDefault;
  const sharedCheck = $('#isSharedCheck');
  if (sharedCheck) sharedCheck.checked = isShared;
  $('#sharedFields')?.classList.toggle('hidden', !isShared);

  // porcentaje
  const pct = item?.porcentaje_tu ?? 50;
  const pctSel = $('#sharedPercentageSelect');
  const customField = $('#customPercentageField');
  const customInput = $('#customPercentageInput');
  if (pctSel && customField && customInput) {
    if ([0,50,100].includes(Number(pct))) {
      pctSel.value = String(pct);
      customField.classList.add('hidden');
    } else {
      pctSel.value = 'custom';
      customField.classList.remove('hidden');
      customInput.value = String(pct);
    }
  }

  setText('expenseModalTitle', item ? 'Editar Gasto' : (isShared ? 'Nuevo Gasto Compartido' : 'Nuevo Gasto'));
  showModal('expenseModal');
}

async function saveExpense() {
  const form = $('#expenseForm'); if (!form) return;

  const id = form.querySelector('input[name="id"]').value || '';
  const descripcion = form.querySelector('input[name="descripcion"]').value.trim();
  const monto = safeNum(form.querySelector('input[name="monto"]').value);
  const fecha = form.querySelector('input[name="fecha"]').value;
  const categoria = $('#expenseCategorySelect')?.value || '';
  const tipo = form.querySelector('select[name="tipo"]').value;
  const metodo_pago = form.querySelector('select[name="metodo_pago"]').value;

  // credit
  const tarjeta_id = $('#expenseCardSelect')?.value || '';
  const cuotas = Math.max(1, parseInt(form.querySelector('input[name="cuotas"]').value || '1', 10));

  // shared
  const compartido = !!$('#isSharedCheck')?.checked;
  let porcentaje_tu = 50;
  const pctSel = $('#sharedPercentageSelect')?.value || '50';
  if (pctSel === 'custom') porcentaje_tu = safeNum($('#customPercentageInput')?.value || 50);
  else porcentaje_tu = safeNum(pctSel);

  if (!descripcion || !fecha || !categoria) {
    showAlert('Completá descripción, fecha y categoría.', 'warning');
    return;
  }
  if (monto <= 0) {
    showAlert('El monto debe ser mayor a 0.', 'warning');
    return;
  }

  // Si es compartido, usamos flujo de solicitud (accept/reject) si hay pareja
  if (compartido) {
    if (!APP_STATE.partner?.email) {
      showAlert('Primero vinculá tu pareja (Gastos Compartidos).', 'warning');
      return;
    }

    // Si es edición de un gasto compartido ya guardado como personal, lo tratamos como normal.
    // Para producción completa, lo ideal es que los compartidos vivan en "shared_requests" / "gastos_compartidos".
    if (!id) {
      try {
        const req = {
          requestId: uid('req'),
          fromEmail: APP_STATE.user.email,
          toEmail: APP_STATE.partner.email,
          descripcion, monto, fecha, categoria, tipo, metodo_pago,
          tarjeta_id, cuotas,
          porcentaje_tu,
          createdAt: new Date().toISOString(),
          status: 'pending'
        };
        await APIService.crearSolicitudCompartido(req);
        closeAllModals();
        await refreshNotifications();
        await refreshPartnerAndShared();
        showAlert('Solicitud enviada a tu pareja. Queda pendiente de aprobación.', 'success', 5000);
        return;
      } catch (err) {
        console.error(err);
        showAlert('No se pudo enviar la solicitud compartida. Revisá tu Apps Script.', 'danger', 6000);
        return;
      }
    }
  }

  // Gasto personal normal (o edición)
  const fila = {
    id: id || uid('gas'),
    userEmail: APP_STATE.user.email,
    descripcion, monto, fecha, categoria, tipo, metodo_pago,
    tarjeta_id: tipo==='credit' ? tarjeta_id : '',
    cuotas: tipo==='credit' ? cuotas : 1,
    compartido: !!compartido,
    porcentaje_tu: compartido ? porcentaje_tu : '',
    updatedAt: new Date().toISOString(),
    createdAt: id ? undefined : new Date().toISOString()
  };

  try {
    if (id) await apiUpdateOrLocal('gastos', fila);
    else await apiSaveOrLocal('gastos', fila);

    APP_STATE.data.gastos = await apiReadOrLocal('gastos');
    closeAllModals();
    loadExpenses();
    updateDashboard();
    showAlert(id ? 'Gasto actualizado.' : 'Gasto guardado.', 'success');
  } catch (err) {
    console.error(err);
    showAlert('No se pudo guardar el gasto.', 'danger');
  }
}

async function deleteExpense(item) {
  if (!confirm(`Eliminar gasto "${item.descripcion}"?`)) return;
  try {
    await apiDeleteOrLocal('gastos', item.id);
    APP_STATE.data.gastos = await apiReadOrLocal('gastos');
    loadExpenses();
    updateDashboard();
    showAlert('Gasto eliminado.', 'success');
  } catch (err) {
    console.error(err);
    showAlert('No se pudo eliminar.', 'danger');
  }
}

// ===============================
// Pareja: invitación / aceptar
// ===============================
async function sendInvite() {
  const email = ($('#partnerEmail')?.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    showAlert('Ingresá un email válido.', 'warning');
    return;
  }
  if (email === APP_STATE.user.email) {
    showAlert('No podés invitarte a vos mismo.', 'warning');
    return;
  }

  try {
    const r = await APIService.crearInvitacion(email);
    // backend debería enviar email; si no, mostramos código:
    if (r.code) {
      alert(`Código de invitación:\n\n${r.code}\n\n(Compartí este código con tu pareja)`);
    }
    closeAllModals();
    showAlert('Invitación generada. Tu pareja debe aceptar con el código.', 'success', 6000);
  } catch (err) {
    console.error(err);
    showAlert('No se pudo crear la invitación. Revisá Apps Script.', 'danger', 6000);
  }
}

async function acceptInvite() {
  const code = ($('#inviteCode')?.value || '').trim();
  if (!code) { showAlert('Ingresá el código.', 'warning'); return; }
  try {
    await APIService.aceptarInvitacion(code);
    closeAllModals();
    await refreshPartnerAndShared();
    showAlert('¡Pareja vinculada!', 'success');
    showSection('shared');
  } catch (err) {
    console.error(err);
    showAlert('Código inválido o expirado.', 'danger', 6000);
  }
}

async function refreshPartnerAndShared() {
  try {
    APP_STATE.partner = await APIService.leerPareja();
  } catch { /* ignore */ }

  // shared lists (si tu backend/Sheet las tiene)
  try { APP_STATE.data.shared_requests = await apiReadOrLocal('shared_requests'); } catch {}
  try { APP_STATE.data.gastos_compartidos = await apiReadOrLocal('gastos_compartidos'); } catch {}

  // UI nombre partner en dashboard
  setText('partnerName', APP_STATE.partner?.email ? (APP_STATE.partner.name || APP_STATE.partner.email) : 'Sin pareja vinculada');

  // badge de pendientes (si usamos notificaciones o tabla requests)
  const pending = (APP_STATE.data.notificaciones||[]).filter(n=>!isRead(n) && (n.type==='shared_request' || n.tipo==='shared_request')).length;
  const b = $('#sharedBadge');
  if (b) {
    if (pending>0) { b.style.display='inline-block'; b.textContent = String(pending); }
    else b.style.display='none';
  }

  if (APP_STATE.currentSection === 'shared') renderShared();
  updateDashboard();
}

// ===============================
// Notificaciones
// ===============================
function isRead(n) {
  return String(n.read||n.leida||'').toLowerCase()==='true' || n.read===true || n.leida===true;
}
async function refreshNotifications() {
  try {
    APP_STATE.data.notificaciones = await APIService.leerNotificaciones();
  } catch (err) {
    // si no existe en backend, dejamos vacío
    APP_STATE.data.notificaciones = [];
  }
  const unread = (APP_STATE.data.notificaciones||[]).filter(n=>!isRead(n)).length;
  const badge = $('#notifBadge');
  if (badge) {
    if (unread>0) { badge.style.display='inline-block'; badge.textContent=String(unread); }
    else badge.style.display='none';
  }
}
function renderNotifications() {
  const box = $('#notifList'); if (!box) return;
  const items = (APP_STATE.data.notificaciones||[])
    .slice()
    .sort((a,b)=> (parseDateAny(b.createdAt||b.fecha||0)||0) - (parseDateAny(a.createdAt||a.fecha||0)||0));

  if (!items.length) {
    box.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-bell-slash text-4xl mb-3"></i>
        <p>No hay notificaciones</p>
      </div>`;
    return;
  }

  box.innerHTML = items.map(n=>{
    const id = n.id || n.notifId || uid('n'); // si backend no manda id, no podremos marcar leída
    const type = n.type || n.tipo || 'info';
    const read = isRead(n);
    const title = type==='shared_request' ? 'Solicitud de gasto compartido' : (n.title||n.titulo||'Notificación');
    const msg = n.message || n.mensaje || n.descripcion || '';
    const meta = n.meta ? (typeof n.meta==='string' ? n.meta : JSON.stringify(n.meta)) : '';
    const amount = n.monto ? ` • <b>${fmtMoney(n.monto)}</b>` : '';
    const date = n.fecha ? ` • ${escapeHtml(fmtDate(n.fecha))}` : '';
    const reqId = n.requestId || n.reqId || n.sharedRequestId || '';

    return `
      <div class="p-3 border rounded-lg ${read?'opacity-60':''}" data-notif-id="${escapeHtml(id)}" data-req-id="${escapeHtml(reqId)}" data-type="${escapeHtml(type)}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-semibold">${escapeHtml(title)}</div>
            <div class="text-xs text-gray-500 mt-1">${escapeHtml(msg)}${amount}${date}</div>
          </div>
          <div class="shrink-0 flex gap-2">
            ${type==='shared_request' ? `
              <button class="btn btn-accent btn-sm" data-action="accept">Aceptar</button>
              <button class="btn btn-danger btn-sm" data-action="reject">Rechazar</button>
            ` : `
              <button class="btn btn-secondary btn-sm" data-action="markread">Ok</button>
            `}
          </div>
        </div>
      </div>`;
  }).join('');
}

async function onNotifListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const card = e.target.closest('[data-notif-id]');
  if (!card) return;

  const notifId = card.dataset.notifId;
  const type = card.dataset.type;
  const reqId = card.dataset.reqId;
  const action = btn.dataset.action;

  try {
    if (type === 'shared_request') {
      if (!reqId) {
        showAlert('Falta requestId en notificación.', 'warning', 6000);
        return;
      }
      const decision = action === 'accept' ? 'accept' : 'reject';
      await APIService.responderSolicitudCompartido(reqId, decision);
      // marcar leída si hay id
      if (notifId) await APIService.marcarNotificacionLeida(notifId);
      await refreshPartnerAndShared();
      await refreshNotifications();
      renderNotifications();
      showAlert(decision==='accept' ? 'Solicitud aceptada.' : 'Solicitud rechazada.', 'success');
      return;
    }

    // info simple
    if (notifId) await APIService.marcarNotificacionLeida(notifId);
    await refreshNotifications();
    renderNotifications();
  } catch (err) {
    console.error(err);
    showAlert('No se pudo procesar la notificación. Revisá Apps Script.', 'danger', 6000);
  }
}

// ===============================
// Dashboard + Charts
// ===============================
function updateDashboard() {
  // Totales del mes actual
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth()+1;

  const ingresosMes = (APP_STATE.data.ingresos||[])
    .filter(x=>sameMonth(x.fecha, y, m))
    .reduce((a,x)=>a+safeNum(x.monto),0);

  // gastos personales (no contamos solicitudes compartidas pendientes; eso va por tabla compartidos)
  const gastosMes = (APP_STATE.data.gastos||[])
    .filter(x=>sameMonth(x.fecha, y, m))
    .reduce((a,x)=>a+safeNum(x.monto),0);

  setText('monthlyIncome', fmtMoney(ingresosMes));
  setText('monthlyExpenses', fmtMoney(gastosMes));
  setText('totalBalance', fmtMoney(ingresosMes - gastosMes));

  setText('incomeHint', `${(APP_STATE.data.ingresos||[]).filter(x=>sameMonth(x.fecha,y,m)).length} ingresos`);

  // hint budget
  const hint = ingresosMes>0 ? `Gastas ${(gastosMes/ingresosMes*100).toFixed(0)}% de tus ingresos` : '—';
  setText('budgetHint', ingresosMes>0 ? hint : '—');

  // shared debts (estimado simple)
  const shared = (APP_STATE.data.gastos_compartidos||[]);
  const debt = calcSharedDebt(shared);
  setText('sharedDebts', fmtMoney(debt.net)); // positivo => me deben, negativo => debo

  // charts
  drawExpensesChart();
  drawTrendChart();

  // actividad
  renderRecentActivity();
}

function calcSharedDebt(sharedArr) {
  const me = APP_STATE.user?.email;
  if (!me) return { youOwe:0, owedToYou:0, net:0 };

  let youOwe = 0;
  let owedToYou = 0;

  sharedArr.forEach(r=>{
    const total = safeNum(r.total || r.monto || r.importe || r.amount);
    const creator = r.creatorEmail || r.fromEmail || r.userEmail || r.creador;
    const pctCreator = safeNum(r.porcentaje_creator ?? r.porcentaje_tu ?? r.pctCreator ?? 50);

    // calculo shares
    const creatorShare = total * (pctCreator/100);
    const partnerShare = total - creatorShare;

    // asumimos: el que registra (creator) pagó todo
    if (creator === me) {
      owedToYou += partnerShare;
    } else {
      youOwe += creatorShare; // mi parte cuando el otro pagó
    }
  });

  return { youOwe, owedToYou, net: owedToYou - youOwe };
}

function drawExpensesChart() {
  const canvas = $('#expensesChart');
  if (!canvas || !window.Chart) return;

  const period = $('#expensePeriod')?.value || 'month';
  const now = new Date();
  let start;
  if (period==='month') start = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (period==='quarter') start = new Date(now.getFullYear(), now.getMonth()-2, 1);
  else start = new Date(now.getFullYear(), now.getMonth()-11, 1);

  const filtered = (APP_STATE.data.gastos||[]).filter(x=>{
    const d = parseDateAny(x.fecha);
    return d && d >= start && d <= now;
  });

  const byCat = {};
  filtered.forEach(x=>{
    const c = x.categoria || 'Sin categoría';
    byCat[c] = (byCat[c]||0) + safeNum(x.monto);
  });

  const labels = Object.keys(byCat);
  const data = labels.map(k=>byCat[k]);

  if (APP_STATE.charts.expenses) APP_STATE.charts.expenses.destroy();
  APP_STATE.charts.expenses = new Chart(canvas, {
    type:'doughnut',
    data:{ labels, datasets:[{ data }] },
    options:{ responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });
}

function drawTrendChart() {
  const canvas = $('#trendChart');
  if (!canvas || !window.Chart) return;

  const n = parseInt($('#trendPeriod')?.value || '6', 10);
  const now = new Date();
  const labels = [];
  const incData = [];
  const expData = [];

  for (let i=n-1; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const y = d.getFullYear();
    const m = d.getMonth()+1;
    labels.push(monthLabel(y,m));

    const inc = (APP_STATE.data.ingresos||[]).filter(x=>sameMonth(x.fecha,y,m)).reduce((a,x)=>a+safeNum(x.monto),0);
    const exp = (APP_STATE.data.gastos||[]).filter(x=>sameMonth(x.fecha,y,m)).reduce((a,x)=>a+safeNum(x.monto),0);
    incData.push(inc);
    expData.push(exp);
  }

  if (APP_STATE.charts.trend) APP_STATE.charts.trend.destroy();
  APP_STATE.charts.trend = new Chart(canvas, {
    type:'line',
    data:{
      labels,
      datasets:[
        { label:'Ingresos', data: incData, tension:0.25 },
        { label:'Gastos', data: expData, tension:0.25 }
      ]
    },
    options:{
      responsive:true,
      plugins:{ legend:{ position:'bottom' } },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}

function renderRecentActivity() {
  const box = $('#recentActivity');
  if (!box) return;

  const events = [];
  (APP_STATE.data.ingresos||[]).forEach(x=> events.push({ type:'inc', fecha:x.fecha, text:`Ingreso: ${x.descripcion}`, amount:x.monto }));
  (APP_STATE.data.gastos||[]).forEach(x=> events.push({ type:'exp', fecha:x.fecha, text:`Gasto: ${x.descripcion}`, amount:x.monto }));
  events.sort((a,b)=>(parseDateAny(b.fecha)||0)-(parseDateAny(a.fecha)||0));

  const top = events.slice(0,6);
  if (!top.length) {
    box.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-inbox text-4xl mb-3"></i>
        <p>No hay actividad reciente</p>
      </div>`;
    return;
  }

  box.innerHTML = top.map(ev=>`
    <div class="p-4 border-b border-gray-100 flex items-center justify-between">
      <div class="min-w-0">
        <div class="font-semibold text-gray-900 truncate">${escapeHtml(ev.text)}</div>
        <div class="text-xs text-gray-500 mt-1">${escapeHtml(fmtDate(ev.fecha))}</div>
      </div>
      <div class="font-bold ${ev.type==='inc'?'text-green-600':'text-red-600'}">${fmtMoney(ev.amount)}</div>
    </div>
  `).join('');
}

// ===============================
// Cards resumen en sección gastos
// ===============================
function updateExpenseCards() {
  const fixed = (APP_STATE.data.gastos||[]).filter(x=>x.tipo==='fixed').reduce((a,x)=>a+safeNum(x.monto),0);
  const variable = (APP_STATE.data.gastos||[]).filter(x=>x.tipo==='variable').reduce((a,x)=>a+safeNum(x.monto),0);
  const credit = (APP_STATE.data.gastos||[]).filter(x=>x.tipo==='credit').reduce((a,x)=>a+safeNum(x.monto),0);

  setText('fixedExpenses', fmtMoney(fixed));
  setText('variableExpenses', fmtMoney(variable));
  setText('creditExpenses', fmtMoney(credit));
  setText('fixedCount', String((APP_STATE.data.gastos||[]).filter(x=>x.tipo==='fixed').length));
  setText('variableCount', String((APP_STATE.data.gastos||[]).filter(x=>x.tipo==='variable').length));
  setText('creditCount', String((APP_STATE.data.gastos||[]).filter(x=>x.tipo==='credit').length));
}

// ===============================
// Shared section render
// ===============================
function renderShared() {
  const hasPartner = !!APP_STATE.partner?.email;
  $('#noPartnerSection')?.classList.toggle('hidden', hasPartner);
  $('#partnerSection')?.classList.toggle('hidden', !hasPartner);

  if (!hasPartner) return;

  setText('partnerNameDisplay', APP_STATE.partner.name || APP_STATE.partner.email);
  setText('partnerNameDisplay2', APP_STATE.partner.name || APP_STATE.partner.email);

  const debt = calcSharedDebt(APP_STATE.data.gastos_compartidos||[]);
  setText('youOwe', fmtMoney(debt.youOwe));
  setText('owedToYou', fmtMoney(debt.owedToYou));

  // Lista de compartidos aprobados (simple)
  const box = $('#sharedExpensesList');
  if (!box) return;

  const arr = (APP_STATE.data.gastos_compartidos||[]).slice().sort((a,b)=>(parseDateAny(b.fecha)||0)-(parseDateAny(a.fecha)||0));
  if (!arr.length) {
    box.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-receipt text-4xl mb-3"></i>
        <p>No hay gastos compartidos</p>
      </div>`;
    return;
  }

  box.innerHTML = arr.slice(0,20).map(r=>{
    const total = safeNum(r.total || r.monto || r.amount);
    const creator = r.creatorEmail || r.fromEmail || r.userEmail;
    const pctCreator = safeNum(r.porcentaje_creator ?? r.porcentaje_tu ?? 50);
    const creatorShare = total*(pctCreator/100);
    const partnerShare = total-creatorShare;
    const mine = (creator===APP_STATE.user.email) ? creatorShare : partnerShare; // si el otro creó, mi parte es partnerShare
    return `
      <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="font-semibold text-gray-900 truncate">${escapeHtml(r.descripcion||'Gasto compartido')}</div>
          <div class="text-xs text-gray-500 mt-1">${escapeHtml(fmtDate(r.fecha))} • Total ${fmtMoney(total)} • Mi parte ${fmtMoney(mine)}</div>
        </div>
        <div class="font-bold text-gray-900">${fmtMoney(total)}</div>
      </div>`;
  }).join('');
}

// ===============================
// Cards section (simple CRUD básico)
// ===============================
function renderCards() {
  const box = $('#cardsList');
  if (!box) return;
  const arr = (APP_STATE.data.tarjetas||[]).slice();
  if (!arr.length) {
    box.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-credit-card text-4xl mb-3"></i>
        <p class="mb-3">No tienes tarjetas registradas</p>
        <button class="btn btn-accent btn-sm" onclick="document.getElementById('addCardBtn').click()">Agregar primera tarjeta</button>
      </div>`;
    return;
  }
  box.innerHTML = arr.map(t=>`
    <div class="p-4 border-b border-gray-100 flex items-center justify-between">
      <div>
        <div class="font-semibold">${escapeHtml(t.banco||'Tarjeta')} • **** ${escapeHtml(t.ultimos_4||'0000')}</div>
        <div class="text-xs text-gray-500">Cierre: ${escapeHtml(String(t.dia_cierre||'-'))} • Vence: ${escapeHtml(String(t.dia_vencimiento||'-'))}</div>
      </div>
      <div class="text-xs text-gray-500">${escapeHtml((t.tipo||'visa').toUpperCase())}</div>
    </div>
  `).join('');
}

async function saveCard() {
  const form = $('#cardForm'); if (!form) return;
  const id = form.querySelector('input[name="id"]').value || '';
  const banco = form.querySelector('input[name="banco"]').value.trim();
  const ultimos_4 = form.querySelector('input[name="ultimos_4"]').value.trim();
  const limite_credito = safeNum(form.querySelector('input[name="limite_credito"]').value);
  const dia_cierre = parseInt(form.querySelector('input[name="dia_cierre"]').value||'0',10);
  const dia_vencimiento = parseInt(form.querySelector('input[name="dia_vencimiento"]').value||'0',10);
  const tipo = form.querySelector('select[name="tipo"]').value;

  if (!banco || ultimos_4.length!==4 || !dia_cierre || !dia_vencimiento) {
    showAlert('Completá banco, últimos 4, cierre y vencimiento.', 'warning');
    return;
  }

  const fila = { id: id||uid('card'), userEmail: APP_STATE.user.email, banco, ultimos_4, limite_credito, dia_cierre, dia_vencimiento, tipo, createdAt: new Date().toISOString() };
  try {
    if (id) await apiUpdateOrLocal('tarjetas', fila);
    else await apiSaveOrLocal('tarjetas', fila);
    APP_STATE.data.tarjetas = await apiReadOrLocal('tarjetas');
    closeAllModals();
    renderCards();
    showAlert('Tarjeta guardada.', 'success');
  } catch (err) {
    console.error(err);
    showAlert('No se pudo guardar tarjeta.', 'danger');
  }
}

// ===============================
// Proyecciones / Reports / Settings (stubs básicos)
// ===============================
function renderProjections() {
  // Por ahora: rellena tabla con gastos fijos + cuotas del mes (estimado)
  const tbody = $('#projectionsTableBody'); if (!tbody) return;

  const monthFilter = $('#projectionMonthFilter')?.value || 'current';
  const typeFilter = $('#projectionTypeFilter')?.value || 'all';

  const base = new Date();
  let offset = 0;
  if (monthFilter==='next') offset = 1;
  else if (monthFilter==='+2') offset = 2;
  const target = new Date(base.getFullYear(), base.getMonth()+offset, 1);
  const y = target.getFullYear();
  const m = target.getMonth()+1;

  let rows = [];

  // Fijos: se repiten cada mes
  (APP_STATE.data.gastos||[]).filter(g=>g.tipo==='fixed').forEach(g=>{
    const d = parseDateAny(g.fecha) || target;
    const date = new Date(y, m-1, Math.min(d.getDate(), 28));
    rows.push({
      desc: g.descripcion,
      fecha: date,
      total: safeNum(g.monto),
      mine: safeNum(g.monto),
      partner: 0,
      tipo: 'fixed'
    });
  });

  // Crédito: cuotas
  (APP_STATE.data.gastos||[]).filter(g=>g.tipo==='credit').forEach(g=>{
    const d0 = parseDateAny(g.fecha); if (!d0) return;
    const cuotas = Math.max(1, parseInt(g.cuotas||1,10));
    const total = safeNum(g.monto);
    const per = cuotas>0 ? total/cuotas : total;
    // consideramos cuotas desde mes de compra
    const monthsFrom = (y - d0.getFullYear())*12 + (m - (d0.getMonth()+1));
    if (monthsFrom < 0 || monthsFrom >= cuotas) return;
    rows.push({ desc:`${g.descripcion} (cuota ${monthsFrom+1}/${cuotas})`, fecha: new Date(y,m-1,10), total: per, mine: per, partner:0, tipo:'credit' });
  });

  // Shared aprobados (si existen)
  (APP_STATE.data.gastos_compartidos||[]).forEach(r=>{
    const dr = parseDateAny(r.fecha); if (!dr) return;
    if (!sameMonth(dr, y, m)) return;
    const total = safeNum(r.total||r.monto||r.amount);
    const creator = r.creatorEmail || r.fromEmail || r.userEmail;
    const pctCreator = safeNum(r.porcentaje_creator ?? r.porcentaje_tu ?? 50);
    const creatorShare = total*(pctCreator/100);
    const partnerShare = total-creatorShare;
    const mine = (creator===APP_STATE.user.email) ? creatorShare : partnerShare;
    const partner = total - mine;
    rows.push({ desc:r.descripcion, fecha: dr, total, mine, partner, tipo:'shared' });
  });

  if (typeFilter !== 'all') rows = rows.filter(r=>r.tipo===typeFilter);

  rows.sort((a,b)=>a.fecha-b.fecha);

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-6 text-center text-gray-500">
          <i class="fas fa-calendar-check text-4xl mb-3"></i>
          <p>No hay pagos programados</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r=>`
    <tr class="border-b">
      <td class="p-3">${escapeHtml(r.desc||'')}</td>
      <td class="p-3">${escapeHtml(fmtDate(r.fecha))}</td>
      <td class="p-3 text-right font-semibold">${fmtMoney(r.total)}</td>
      <td class="p-3 text-right">${fmtMoney(r.mine)}</td>
      <td class="p-3 text-right">${fmtMoney(r.partner)}</td>
      <td class="p-3 text-center">${escapeHtml(labelTipo(r.tipo))}</td>
    </tr>
  `).join('');

  setText('totalToPay', fmtMoney(rows.reduce((a,r)=>a+r.total,0)));
  setText('pendingInstallments', String((APP_STATE.data.gastos||[]).filter(g=>g.tipo==='credit' && (g.cuotas||1)>1).length));
}

function renderReports() {
  // simple: muestra balances
  const y = new Date().getFullYear();
  const incY = (APP_STATE.data.ingresos||[]).filter(x=>parseDateAny(x.fecha)?.getFullYear()===y).reduce((a,x)=>a+safeNum(x.monto),0);
  const expY = (APP_STATE.data.gastos||[]).filter(x=>parseDateAny(x.fecha)?.getFullYear()===y).reduce((a,x)=>a+safeNum(x.monto),0);
  setText('yearlyBalance', fmtMoney(incY-expY));
  setText('totalSavings', fmtMoney(Math.max(0, incY-expY)));
}

function renderSettings() {
  $('#profileName') && ($('#profileName').value = APP_STATE.user?.name || '');
  $('#profileEmail') && ($('#profileEmail').value = APP_STATE.user?.email || '');
  $('#profileCurrency') && ($('#profileCurrency').value = APP_STATE.user?.currency || CONFIG.DEFAULT_CURRENCY);
  // categorías lista básica
  const list = $('#categoriesList');
  if (!list) return;

  list.innerHTML = (APP_STATE.data.categorias||[]).map(c=>`
    <div class="flex items-center justify-between border rounded-lg p-2">
      <div class="min-w-0">
        <div class="font-medium truncate">${escapeHtml(c.nombre)}</div>
        <div class="text-xs text-gray-500">${escapeHtml(labelTipo(c.tipo))}</div>
      </div>
      <button class="btn btn-danger btn-sm" data-cat-id="${escapeHtml(c.id)}" title="Eliminar"><i class="fas fa-trash"></i></button>
    </div>
  `).join('') || '<div class="text-sm text-gray-500">Sin categorías</div>';

  list.onclick = async (e)=>{
    const btn = e.target.closest('button[data-cat-id]'); if (!btn) return;
    const id = btn.dataset.catId;
    const cat = (APP_STATE.data.categorias||[]).find(x=>x.id===id);
    if (!cat) return;
    if (!confirm(`Eliminar categoría "${cat.nombre}"?`)) return;
    try {
      await apiDeleteOrLocal('categorias', id);
      APP_STATE.data.categorias = await apiReadOrLocal('categorias');
      updateCategoryUI();
      renderSettings();
      showAlert('Categoría eliminada.', 'success');
    } catch (err) {
      console.error(err);
      showAlert('No se pudo eliminar categoría.', 'danger');
    }
  };
}

// ===============================
// Utilidades labels/fechas
// ===============================
function toISO(v) {
  const d = parseDateAny(v);
  if (!d) return '';
  const dd = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return dd.toISOString().slice(0,10);
}
function fmtDate(v) {
  const d = parseDateAny(v);
  if (!d) return '—';
  return d.toLocaleDateString('es-AR', { year:'numeric', month:'2-digit', day:'2-digit' });
}
function labelTipo(t='') {
  const x = String(t||'').toLowerCase();
  if (x==='fixed') return 'Fijo';
  if (x==='variable') return 'Variable';
  if (x==='credit') return 'Crédito';
  if (x==='income') return 'Ingreso';
  if (x==='shared') return 'Compartido';
  return t || '—';
}
function labelFreq(f='') {
  const x = String(f||'').toLowerCase();
  const map = {
    weekly:'Semanal', biweekly:'Quincenal', monthly:'Mensual',
    bimonthly:'Bimestral', quarterly:'Trimestral', yearly:'Anual', onetime:'Único'
  };
  return map[x] || f || '—';
}

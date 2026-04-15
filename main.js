/* =========================================================
   FinanceApp - main.js CONECTADO A SUPABASE
   ========================================================= */

// =========================================================
// SUPABASE CONFIG
// =========================================================
const SUPABASE_URL = 'https://djkaujopwloujqkwhkqw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqa2F1am9wd2xvdWpxa3doa3F3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA4NjU1OSwiZXhwIjoyMDkxNjYyNTU5fQ.wAw_9_0orFsEFMreoHri_sYY7a1vfLfDlmuzRH9Jo3I';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// =========================================================
// CONFIG
// =========================================================
const CONFIG = { DEFAULT_CURRENCY: 'ARS', DEBUG: false };

// Anti doble-click
let incomeSaveInFlight = false;
let expenseSaveInFlight = false;

// =========================================================
// UTILIDADES BASE
// =========================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function normEmail(email) { return (email || '').toString().trim().toLowerCase(); }

// =========================================================
// TOAST / ALERTAS
// =========================================================
function ensureToastContainer_() {
  let c = document.getElementById('toastContainer');
  if (c) return c;
  c = document.createElement('div');
  c.id = 'toastContainer';
  Object.assign(c.style, { position:'fixed', top:'16px', right:'16px', zIndex:'99999', display:'flex', flexDirection:'column', gap:'10px' });
  document.body.appendChild(c);
  return c;
}

function showToast(message, type = 'info', ms = 2800) {
  try {
    const container = ensureToastContainer_();
    const el = document.createElement('div');
    el.style.cssText = 'padding:10px 12px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);font-size:13px;max-width:320px;background:#111827;color:#fff;opacity:0;transform:translateY(-6px);transition:all .18s ease;';
    if (type === 'success') el.style.background = '#065f46';
    if (type === 'warning') el.style.background = '#92400e';
    if (type === 'error') el.style.background = '#7f1d1d';
    el.textContent = message || '';
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 220);
    }, ms);
  } catch(e) { alert(message); }
}

function showAlert(msg, type = 'info', timeout = 3500) {
  showToast(msg, type === 'danger' ? 'error' : type, timeout);
}

// =========================================================
// DINERO / FECHAS
// =========================================================
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).replace(/[^\d.,-]/g, '');
  const normalized = s.replace(',', '.');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function parseMoney(value) {
  if (!value) return 0;
  const s = String(value).trim().replace(/\s/g, '').replace(/[^0-9,.\-]/g, '');
  const withDot = s.replace(',', '.');
  const n = parseFloat(withDot);
  return isNaN(n) ? 0 : n;
}

function fmtMoney(v) {
  const n = parseAmount(v);
  const currency = APP_STATE?.data?.profile?.moneda || CONFIG.DEFAULT_CURRENCY;
  const formatted = Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (n < 0 ? '-' : '') + '$' + formatted;
}

function toNumber(value) {
  const n = parseFloat(String(value || '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function pad2(n) { return String(n).padStart(2,'0'); }

function toYM(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}`;
}

function ymToLabel(ym) {
  const [y, m] = ym.split('-');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[parseInt(m)-1]} ${y}`;
}

function daysInMonth(y,m) { return new Date(y,m,0).getDate(); }
function clampDay(y,m,day) { return Math.min(day, daysInMonth(y,m)); }
function makeDate(y,m,day) { return `${y}-${pad2(m)}-${pad2(clampDay(y,m,day))}`; }

function addMonthsToYM(ym, add) {
  let [y,m] = ym.split('-').map(Number);
  m += add; while(m>12){m-=12;y++;} while(m<1){m+=12;y--;}
  return `${y}-${pad2(m)}`;
}

function addMonths(dateStr, add) {
  const d = new Date(dateStr);
  const ym = addMonthsToYM(`${d.getFullYear()}-${pad2(d.getMonth()+1)}`, add);
  return makeDate(parseInt(ym),parseInt(ym.split('-')[1]),d.getDate());
}

function sameYM(date, ym) {
  return toYM(date) === ym;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
  } catch { return dateStr; }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function initials(nameOrEmail = '') {
  const parts = nameOrEmail.trim().split(/[\s@]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return nameOrEmail.slice(0,2).toUpperCase();
}

// =========================================================
// TARJETA - CICLOS DE CIERRE
// =========================================================
function cyclesStorageKey() { return 'financeapp_cycles_v2'; }
function getCycleOverrides() {
  try { return JSON.parse(localStorage.getItem(cyclesStorageKey()) || '{}'); } catch { return {}; }
}
function saveCycleOverrides(obj) { localStorage.setItem(cyclesStorageKey(), JSON.stringify(obj)); }

function getCloseInfoForMonth(card, ym) {
  const overrides = getCycleOverrides();
  const key = `${card.id}:${ym}`;
  if (overrides[key]) return overrides[key];
  const [y, m] = ym.split('-').map(Number);
  return {
    closeDate: makeDate(y, m, card.dia_cierre || 15),
    dueDate: makeDate(y, m, card.dia_vencimiento || 5)
  };
}

function getStatementCloseYM(purchaseDate, card) {
  const ym = toYM(purchaseDate);
  const info = getCloseInfoForMonth(card, ym);
  return purchaseDate <= info.closeDate ? ym : addMonthsToYM(ym, 1);
}

function buildInstallmentSchedule({ purchaseDate, card, cuotasTotales, montoTotal, descripcion, baseItem, miParte, parejaParte }) {
  const schedule = [];
  const montoPorCuota = round2(montoTotal / cuotasTotales);
  const miPartePorCuota = round2((miParte ?? montoTotal) / cuotasTotales);
  const parejaPartePorCuota = round2((parejaParte ?? 0) / cuotasTotales);
  let firstStatementYM = getStatementCloseYM(purchaseDate, card);

  for (let i = 0; i < cuotasTotales; i++) {
    const statementYM = addMonthsToYM(firstStatementYM, i);
    const dueInfo = getCloseInfoForMonth(card, statementYM);
    schedule.push({
      ...baseItem,
      id: `${baseItem?.id || 'xx'}_c${i+1}`,
      descripcion: `${descripcion} (${i+1}/${cuotasTotales})`,
      fecha: dueInfo.dueDate,
      monto: montoPorCuota,
      mi_parte: miPartePorCuota,
      pareja_parte: parejaPartePorCuota,
      tipo: 'credito',
      cuota_actual: i+1,
      cuotas: cuotasTotales,
      monto_total: montoTotal,
      tarjeta: card
    });
  }
  return schedule;
}

// =========================================================
// APP STATE
// =========================================================
const APP_STATE = {
  user: null,
  partner: null,
  data: {
    ingresos: [],
    gastos: [],
    tarjetas: [],
    categorias: [],
    invitaciones: [],
    profile: null
  },
  charts: { expenses: null, trend: null, report: null },
  currentSection: 'dashboard',
  filters: {
    expenses: { tipo: 'all', category: 'all', month: '', year: '' },
    incomes:  { month: '', year: '' },
    shared:   { month: '', year: '', tipo: 'all' }
  }
};

// =========================================================
// DASHBOARD FILTROS
// =========================================================
function getDashboardFilters_() {
  return {
    month: $('#dashMonth')?.value || 'current',
    year:  $('#dashYear')?.value  || 'current',
    category: $('#dashCategory')?.value || 'all',
    scope: $('#dashScope')?.value || 'all'
  };
}

function setupDashboardFilters_() {
  const monthSel = $('#dashMonth');
  const yearSel  = $('#dashYear');
  const catSel   = $('#dashCategory');
  const scopeSel = $('#dashScope');

  if (!monthSel) return;

  const now = new Date();

  // Month
  if (!monthSel.options.length) {
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    monthSel.innerHTML = `<option value="all">Todos los meses</option>` +
  months.map((m,i) => `<option value="${i+1}">${m}</option>`).join('');
  }

  // Year
  if (!yearSel.options.length) {
    yearSel.innerHTML = '<option value="all">Todos los años</option>';
    for (let y = now.getFullYear(); y >= now.getFullYear()-3; y--) {
      yearSel.innerHTML += `<option value="${y}">${y}</option>`;
    }
  }

  // Categories from data
  if (catSel) {
    const cats = [...new Set((APP_STATE.data.gastos||[]).map(g=>g.categoria).filter(Boolean))];
    catSel.innerHTML = `<option value="all">Todas las cat.</option>` + cats.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  }

  // Scope
  if (scopeSel && !scopeSel.options.length) {
    scopeSel.innerHTML = `
      <option value="all">Todos</option>
      <option value="own">Solo propios</option>
      <option value="shared">Solo compartidos</option>`;
  }

  const onChange = () => updateDashboard();
  monthSel.onchange = onChange;
  yearSel.onchange  = onChange;
  if (catSel)   catSel.onchange   = onChange;
  if (scopeSel) scopeSel.onchange = onChange;
}

// =========================================================
// AUTH - SUPABASE
// =========================================================
function showLoading(show) {
  const el = $('#loadingOverlay');
  if (el) el.classList.toggle('hidden', !show);
}

async function handleQuickLogin() {
  const email = $('#quickEmail')?.value?.trim();
  const pass  = $('#quickPassword')?.value;
  if (!email || !pass) { showAlert('Ingresa email y contraseña','warning'); return; }

  showLoading(true);
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    await completeLogin(data.user);
  } catch (err) {
    showAlert(err.message || 'Error al iniciar sesión','error');
  } finally { showLoading(false); }
}

async function handleRegister() {
  const name  = $('#registerName')?.value?.trim();
  const email = $('#registerEmail')?.value?.trim();
  const pass  = $('#registerPassword')?.value;
  const conf  = $('#registerConfirmPassword')?.value;

  if (!name || !email || !pass) { showAlert('Completa todos los campos','warning'); return; }
  if (pass !== conf) { showAlert('Las contraseñas no coinciden','warning'); return; }
  if (pass.length < 6) { showAlert('La contraseña debe tener al menos 6 caracteres','warning'); return; }

  showLoading(true);
  try {
    const { data, error } = await sb.auth.signUp({ email, password: pass });
    if (error) throw error;

    // Update profile name
    if (data.user) {
      await sb.from('profiles').update({ nombre: name }).eq('id', data.user.id);
    }

    showAlert('Cuenta creada. Podés iniciar sesión ahora.','success', 5000);
    $('#registerSection')?.classList.add('hidden');
    $('#quickEmail').value = email;
  } catch (err) {
    showAlert(err.message || 'Error al registrar','error');
  } finally { showLoading(false); }
}

async function completeLogin(user) {
  APP_STATE.user = user;
  showMainApp();
}

async function logout() {
  await sb.auth.signOut();
  APP_STATE.user = null;
  APP_STATE.partner = null;
  APP_STATE.data = { ingresos:[], gastos:[], tarjetas:[], categorias:[], invitaciones:[], profile:null };
  showLogin();
}

async function restoreUser() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    APP_STATE.user = session.user;
    showMainApp();
  } else {
    showLogin();
  }
}

// =========================================================
// UI HELPERS
// =========================================================
function showLogin() {
  $('#loginScreen')?.classList.remove('hidden');
  $('#mainApp')?.classList.add('hidden');
}

function showMainApp() {
  $('#loginScreen')?.classList.add('hidden');
  $('#mainApp')?.classList.remove('hidden');
  updateUserUI();
  loadAll();
}

function updateUserUI() {
  const user = APP_STATE.user;
  if (!user) return;
  const profile = APP_STATE.data.profile;
  const name  = profile?.nombre || user.email;
  const email = user.email;
  setText('userName', name);
  setText('userEmail', email);
  setText('userInitials', initials(name));
  setText('currencyDisplay', profile?.moneda || 'ARS');
}

function initSidebar() {
  const toggle  = $('#menuToggle');
  const sidebar = $('#sidebar');
  const overlay = $('#sidebarOverlay');

  toggle?.addEventListener('click', () => {
    sidebar?.classList.toggle('active');
    overlay?.classList.toggle('hidden');
  });

  overlay?.addEventListener('click', () => {
    sidebar?.classList.remove('active');
    overlay?.classList.add('hidden');
  });
}

function showSection(section) {
  APP_STATE.currentSection = section;
  $$('.nav-item[data-section]').forEach(a => {
    a.classList.toggle('active', a.dataset.section === section);
  });
  $$('section.dashboard').forEach(s => s.classList.add('hidden'));
  const target = $(`#${section}Section`);
  if (target) target.classList.remove('hidden');

  switch(section) {
    case 'dashboard':   setupDashboardFilters_(); updateDashboard(); break;
    case 'incomes':     loadIncomes(); break;
    case 'expenses':    renderExpenses(); break;
    case 'shared':      loadSharedSection(); break;
    case 'cards':       loadCards(); break;
    case 'liquidacion': loadLiquidacion(); break;
    case 'projections': loadProjections(); break;
    case 'reports':     loadReports(); break;
    case 'settings':    loadSettings(); break;
  }
}

function toggleTheme() {
  const body = document.body;
  const isDark = body.getAttribute('data-theme') === 'dark';
  body.setAttribute('data-theme', isDark ? 'light' : 'dark');
  const icon = $('#themeToggle i');
  if (icon) { icon.className = isDark ? 'fas fa-moon' : 'fas fa-sun'; }
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}

function initYearSelects() {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Obtener rango de años desde los datos reales
  const allDates = [
    ...(APP_STATE.data.ingresos||[]).map(i=>i.fecha),
    ...(APP_STATE.data.gastos||[]).map(g=>g.fecha)
  ].filter(Boolean);
  
  const years = allDates.map(d=>new Date(d+'T00:00:00').getFullYear()).filter(y=>!isNaN(y));
  const minYear = years.length ? Math.min(...years) : currentYear - 2;
  const maxYear = Math.max(currentYear + 2, years.length ? Math.max(...years) : currentYear);

  $$('.year-select').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = '';
    for (let y = maxYear; y >= minYear; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.text = y;
      if (y === currentYear) opt.selected = true;
      sel.appendChild(opt);
    }
    if (prev) sel.value = prev;
  });
}

// =========================================================
// LOAD ALL DATA FROM SUPABASE
// =========================================================
async function loadAll() {
  showLoading(true);
  try {
    const uid = APP_STATE.user.id;

    const [
      { data: profile },
      { data: categorias },
      { data: ingresos },
      { data: gastos },
      { data: tarjetas },
      { data: invitaciones }
    ] = await Promise.all([
      sb.from('profiles').select('*').eq('id', uid).limit(1),
      sb.from('categorias').select('*').eq('user_id', uid).order('nombre'),
      sb.from('ingresos').select('*').eq('user_id', uid).order('fecha', { ascending: false }),
      sb.from('gastos').select('*').order('fecha', { ascending: false }),
      sb.from('tarjetas').select('*').eq('user_id', uid).order('banco'),
      sb.from('invitaciones').select('*').order('created_at', { ascending: false })
    ]);

    APP_STATE.data.profile = profile?.[0] || null;
    APP_STATE.data.categorias= categorias || [];
    APP_STATE.data.ingresos  = ingresos  || [];
    APP_STATE.data.gastos    = gastos    || [];
    APP_STATE.data.tarjetas  = tarjetas  || [];
    APP_STATE.data.invitaciones = invitaciones || [];

    // Cargar perfil del partner si existe
    if (APP_STATE.data.profile?.partner_email) {
  APP_STATE.partner = {
  id: APP_STATE.data.profile.partner_id,
  email: APP_STATE.data.profile.partner_email,
  nombre: APP_STATE.data.profile.partner_nombre || APP_STATE.data.profile.partner_email
};
} else {
  APP_STATE.partner = null;
}

    updateUserUI();
    updateCategoryUI();
    setupDashboardFilters_();
    updateDashboard();
    updateNotifications();

  } catch (err) {
    console.error('Error cargando datos:', err);
    showAlert('Error cargando datos','error');
  } finally {
    showLoading(false);
  }
}

async function reloadData() {
  showLoading(true);
  try { await loadAll(); }
  catch(err) { console.error(err); showAlert('Error al recargar datos','error'); }
  finally { showLoading(false); }
}

// =========================================================
// CATEGORY UI
// =========================================================
function updateCategoryUI() {
  const cats = APP_STATE.data.categorias || [];
  const gastosCats  = cats.filter(c => c.tipo !== 'ingreso').map(c => c.nombre);
  const ingresosCats = cats.filter(c => c.tipo === 'ingreso').map(c => c.nombre);

  const fillSelect = (id, items) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">Seleccionar categoría</option>` +
      items.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    if (prev) sel.value = prev;
  };

  fillSelect('expenseCategorySelect', gastosCats);
  fillSelect('incomeCategorySelect',  ingresosCats);
  fillSelect('expenseFilter',         ['Todas las categorías', ...gastosCats]);
}

// =========================================================
// NOTIFICATIONS (simple - gastos compartidos pendientes)
// =========================================================
function updateNotifications() {
  const uid = APP_STATE.user?.id;
  if (!uid) return;

  // Gastos del mes
  const now = new Date();
  const ym  = `${now.getFullYear()}-${pad2(now.getMonth()+1)}`;
  const gastosDelMes = (APP_STATE.data.gastos || []).filter(g => toYM(g.fecha) === ym);
  const badge = $('#notificationBadge');
  const count = gastosDelMes.filter(g => g.es_compartido && g.partner_id === uid).length;

  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  // Shared badge en sidebar
  const sharedBadge = $('#sharedBadge');
  if (sharedBadge) {
    const inv = (APP_STATE.data.invitaciones||[]).filter(i => i.status === 'pending' && i.to_email === normEmail(APP_STATE.user?.email||''));
    sharedBadge.textContent = inv.length;
    sharedBadge.style.display = inv.length ? '' : 'none';
  }
}

async function markAllNotificationsAsRead() {
  const panel = $('#notificationsPanel');
  if (panel) panel.classList.add('hidden');
}

function toggleNotifications() {
  const panel = $('#notificationsPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    panel.innerHTML = `
      <div class="p-4 border-b border-gray-200 flex justify-between items-center">
        <h3 class="font-semibold">Notificaciones</h3>
        <button class="text-sm text-primary" id="markAllReadBtn">Cerrar</button>
      </div>
      <div class="p-4 text-sm text-gray-500">
        ${APP_STATE.partner ? `Pareja vinculada: ${escapeHTML(APP_STATE.partner.email||APP_STATE.partner.nombre||'')}` : 'Sin pareja vinculada'}
      </div>`;
    $('#markAllReadBtn')?.addEventListener('click', markAllNotificationsAsRead);
  }
}

// =========================================================
// DASHBOARD
// =========================================================
function updateDashboard() {
  const uid = APP_STATE.user?.id;
  const now = new Date();
  const filters = getDashboardFilters_();
  const selectedYear  = (filters.year  === 'all' || filters.year  === 'current') ? null : parseInt(filters.year);
const selectedMonth = (filters.month === 'all' || filters.month === 'current') ? null : parseInt(filters.month);

const isSamePeriod = (fechaStr) => {
  if (!fechaStr) return false;
  const d = new Date(fechaStr+'T00:00:00');
  if (selectedYear  && d.getFullYear()    !== selectedYear)  return false;
  if (selectedMonth && (d.getMonth()+1)   !== selectedMonth) return false;
  return true;
};

const isSamePeriod2 = (fechaStr, m, y) => {
  if (!fechaStr) return false;
  const d = new Date(fechaStr+'T00:00:00');
  return d.getFullYear()===y && (d.getMonth()+1)===m;
};

  
  const now2 = new Date();
  const prevMonth = selectedMonth ? (selectedMonth === 1 ? 12 : selectedMonth - 1) : now2.getMonth();
  const prevYear  = selectedMonth === 1 ? (selectedYear||now2.getFullYear()) - 1 : (selectedYear||now2.getFullYear());
  const isPrevPeriod = (fechaStr) => {
    if (!fechaStr) return false;
    const d = new Date(fechaStr+'T00:00:00');
    return d.getFullYear()===prevYear && (d.getMonth()+1)===prevMonth;
  };

  const ingresos   = APP_STATE.data.ingresos || [];
  const gastosAll  = APP_STATE.data.gastos   || [];

  // ── Ingresos del mes seleccionado y anterior ──
  const ingresosMes  = ingresos.filter(i=>isSamePeriod(i.fecha)).reduce((s,i)=>s+parseAmount(i.monto),0);
  const ingresosPrev = ingresos.filter(i=>isPrevPeriod(i.fecha)).reduce((s,i)=>s+parseAmount(i.monto),0);
  const ingresosCount = ingresos.filter(i=>isSamePeriod(i.fecha)).length;

  // ── Gastos propios del mes (mi parte) ──
  const gastosMes = gastosAll
    .filter(g => isSamePeriod(g.fecha) && (g.user_id===uid || g.partner_id===uid))
    .reduce((s,g) => {
      const isOwner = g.user_id===uid;
      const myPct   = g.es_compartido ? (isOwner ? (g.porcentaje_usuario||100) : (100-(g.porcentaje_usuario||100))) : 100;
      return s + parseAmount(g.monto) * myPct / 100;
    }, 0);

  const gastosPrev = gastosAll
    .filter(g => isPrevPeriod(g.fecha) && (g.user_id===uid || g.partner_id===uid))
    .reduce((s,g) => {
      const isOwner = g.user_id===uid;
      const myPct   = g.es_compartido ? (isOwner ? (g.porcentaje_usuario||100) : (100-(g.porcentaje_usuario||100))) : 100;
      return s + parseAmount(g.monto) * myPct / 100;
    }, 0);

  // ── Gastos compartidos del mes (mi parte) ──
  const sharedMes = gastosAll
    .filter(g => g.es_compartido && isSamePeriod(g.fecha) && (g.user_id===uid || g.partner_id===uid))
    .reduce((s,g) => {
      const isOwner = g.user_id===uid;
      const myPct   = isOwner ? (g.porcentaje_usuario||100) : (100-(g.porcentaje_usuario||100));
      return s + parseAmount(g.monto) * myPct / 100;
    }, 0);

  const sharedPrev = gastosAll
    .filter(g => g.es_compartido && isPrevPeriod(g.fecha) && (g.user_id===uid || g.partner_id===uid))
    .reduce((s,g) => {
      const isOwner = g.user_id===uid;
      const myPct   = isOwner ? (g.porcentaje_usuario||100) : (100-(g.porcentaje_usuario||100));
      return s + parseAmount(g.monto) * myPct / 100;
    }, 0);

  const gastosPropiosMes = gastosAll
    .filter(g => g.user_id===uid && !g.es_compartido && isSamePeriod(g.fecha))
    .reduce((s,g) => s + parseAmount(g.monto), 0);

  const gastosPropiosPrev = gastosAll
    .filter(g => g.user_id===uid && !g.es_compartido && isPrevPeriod(g.fecha))
    .reduce((s,g) => s + parseAmount(g.monto), 0);

  // ── Balance = ingresos - gastos propios (sin compartidos) ──
  const balance = ingresosMes -gastosMes;


  // ── Variaciones % ──
  const pctChange = (curr, prev) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  };
  const ingresosPct       = pctChange(ingresosMes, ingresosPrev);
  const gastosPct         = pctChange(gastosMes, gastosPrev);
  const gastosPropiosPct  = pctChange(gastosPropiosMes, gastosPropiosPrev);
  const sharedPct         = pctChange(sharedMes, sharedPrev);

  const fmtPct = (pct, invertColor = false) => {
    const isPositive = pct >= 0;
    const color = invertColor
      ? (isPositive ? 'text-red-600' : 'text-green-600')
      : (isPositive ? 'text-green-600' : 'text-red-600');
    const icon = isPositive ? 'fa-arrow-up' : 'fa-arrow-down';
    return `<i class="fas ${icon}"></i> <span class="${color}">${isPositive?'+':''}${pct}% vs mes anterior</span>`;
  };

  // ── Pintar KPIs ──
  const elBalance  = document.getElementById('totalBalance');
  const elIncome   = document.getElementById('monthlyIncome');
  const elExpenses = document.getElementById('monthlyExpenses');
  const elShared   = document.getElementById('sharedDebts');



  // Ahorro = ingresos - gastos propios - mi parte compartida
  const ahorroMes = ingresosMes - gastosPropiosMes - sharedMes;

  if (elBalance)  elBalance.textContent  = fmtMoney(balance);
  if (elIncome)   elIncome.textContent   = fmtMoney(ingresosMes);
  if (elExpenses) elExpenses.textContent = fmtMoney(gastosPropiosMes);
  if (elShared)   elShared.textContent   = fmtMoney(sharedMes);

  // Ahorro
  const ahorroEl  = document.getElementById('ahorroMes');
  const ahorroKPI = document.getElementById('ahorroMesKPI');
  if (ahorroEl) {
    ahorroEl.textContent = fmtMoney(ahorroMes);
    ahorroEl.className = `card-value text-2xl font-bold mb-2 ${ahorroMes >= 0 ? 'text-green-600' : 'text-red-600'}`;
  }
  if (ahorroKPI) {
    ahorroKPI.textContent = ahorroMes >= 0 ? 'Superávit este mes' : 'Déficit este mes';
    ahorroKPI.className = `text-sm font-medium ${ahorroMes >= 0 ? 'text-green-600' : 'text-red-600'}`;
  }

  // KPI subtítulos
  const elIngresosMesKPI = document.getElementById('ingresosMesKPI');
  if (elIngresosMesKPI) elIngresosMesKPI.innerHTML = ingresosPrev > 0
    ? fmtPct(ingresosPct, false)
    : `<span class="text-gray-400">Sin datos mes anterior</span>`;

  const elGastosPropiosKPI = document.getElementById('gastosPropiosKPI');
  if (elGastosPropiosKPI) elGastosPropiosKPI.innerHTML = gastosPropiosPrev > 0
    ? fmtPct(gastosPropiosPct, true)
    : `<span class="text-gray-400">Sin datos mes anterior</span>`;

  const elGastosCompartidosKPI = document.getElementById('gastosCompartidosKPI');
  if (elGastosCompartidosKPI) elGastosCompartidosKPI.innerHTML = sharedPrev > 0
    ? fmtPct(sharedPct, true)
    : `<span class="text-gray-400">Tu parte con ${escapeHTML(APP_STATE.partner?.nombre || APP_STATE.partner?.email || 'tu pareja')}</span>`;
  // KPI gastos vs mes anterior

  const gastosMesAnterior = gastosAll
    .filter(g => isSamePeriod2(g.fecha, prevMonth, prevYear) && (g.user_id===uid || g.partner_id===uid))
    .reduce((s,g) => {
      const pct = g.es_compartido ? (g.porcentaje_usuario ?? 100) : 100;
      const myPct2 = g.es_compartido ? (g.user_id===uid ? pct : 100-pct) : 100;
      return s + parseAmount(g.monto) * myPct2 / 100;
    }, 0);

  const diffGastos = gastosMesAnterior > 0
    ? ((gastosMes - gastosMesAnterior) / gastosMesAnterior * 100).toFixed(1)
    : null;

  const kpiEl = document.getElementById('gastosMesKPI');
  const kpiWrap = document.getElementById('gastosMesChange');
  if (kpiEl && kpiWrap) {
    if (diffGastos !== null) {
      const subio = parseFloat(diffGastos) > 0;
      kpiEl.textContent = `${subio ? '+' : ''}${diffGastos}% vs mes anterior`;
      kpiWrap.className = `card-change text-sm flex items-center gap-1 ${subio ? 'text-red-600' : 'text-green-600'}`;
      kpiWrap.querySelector('i').className = `fas ${subio ? 'fa-arrow-up' : 'fa-arrow-down'}`;
    } else {
      kpiEl.textContent = 'Sin datos mes anterior';
      kpiWrap.className = 'card-change text-gray-500 text-sm flex items-center gap-1';
      kpiWrap.querySelector('i').className = 'fas fa-minus';
    }
  }

  // ── Subtítulos dinámicos de cada tarjeta ──
  const balanceChange = document.querySelector('#totalBalance ~ * .card-change, #totalBalance + .card-change');
  const allChanges = document.querySelectorAll('.card-change');

  // Buscar por orden en el DOM
  const cards = document.querySelectorAll('.cards-grid .card');
  if (cards[0]) {
    const sub = cards[0].querySelector('.card-change');
    if (sub) sub.innerHTML = balance >= 0
      ? `<i class="fas fa-check-circle text-green-500"></i> <span class="text-green-600">Superávit este mes</span>`
      : `<i class="fas fa-exclamation-triangle text-red-500"></i> <span class="text-red-600">Déficit este mes</span>`;
  }
  if (cards[1]) {
    const sub = cards[1].querySelector('.card-change');
    if (sub) sub.innerHTML = gastosPrev > 0
      ? fmtPct(gastosPct, true)
      : `<i class="fas fa-info-circle text-gray-400"></i> <span class="text-gray-500">Sin datos mes anterior</span>`;
  }
  if (cards[2]) {
    const sub = cards[2].querySelector('.card-change');
    if (sub) sub.innerHTML = fmtPct(ingresosPct, false) +
      ` &nbsp;·&nbsp; <span class="text-gray-500">${ingresosCount} fuente${ingresosCount!==1?'s':''}</span>`;
  }
  if (cards[3]) {
    const sub = cards[3].querySelector('.card-change');
    if (sub) {
      if (diffGastos !== null) {
        const subio = parseFloat(diffGastos) > 0;
        sub.innerHTML = `<i class="fas ${subio ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> <span>${subio ? '+' : ''}${diffGastos}% vs mes anterior</span>`;
        sub.className = `card-change text-sm flex items-center gap-1 ${subio ? 'text-red-600' : 'text-green-600'}`;
      } else {
        sub.innerHTML = `<i class="fas fa-minus"></i> <span class="text-gray-500">Sin datos mes anterior</span>`;
        sub.className = 'card-change text-gray-500 text-sm flex items-center gap-1';
      }
    }
  }
  if (cards[4]) {
    const sub = cards[4].querySelector('.card-change');
    if (sub) sub.innerHTML = APP_STATE.partner
      ? `<i class="fas fa-user text-primary"></i> <span class="text-primary">${escapeHTML(APP_STATE.partner.nombre || APP_STATE.partner.email || '')}</span>`
      : `<i class="fas fa-user-slash text-gray-400"></i> <span class="text-gray-400">Sin pareja vinculada</span>`;
  }

  // ── Gráfico distribución ──
  let expensesBase = gastosAll.filter(g=>isSamePeriod(g.fecha) && (g.user_id===uid||g.partner_id===uid));
  if (filters.scope==='own')    expensesBase = expensesBase.filter(g=>!g.es_compartido && g.user_id===uid);
  if (filters.scope==='shared') expensesBase = expensesBase.filter(g=>g.es_compartido);
  if (filters.category && filters.category!=='all') expensesBase = expensesBase.filter(g=>g.categoria===filters.category);

  const categorias = {};
  expensesBase.forEach(g => {
    const isOwner = g.user_id===uid;
    const myPct   = g.es_compartido ? (isOwner ? (g.porcentaje_usuario||100) : (100-(g.porcentaje_usuario||100))) : 100;
    const cat = g.categoria || 'Otros';
    categorias[cat] = (categorias[cat]||0) + parseAmount(g.monto) * myPct / 100;
  });

  const labels = Object.keys(categorias);
  const data   = Object.values(categorias);
  const wrap   = document.getElementById('expensesChartWrap');

  if (wrap) {
    if (labels.length > 0 && window.Chart) {
      wrap.innerHTML = '<canvas id="expensesChart"></canvas>';
      const ctx = document.getElementById('expensesChart');
      if (APP_STATE.charts.expenses) { try{APP_STATE.charts.expenses.destroy();}catch(e){} }
      APP_STATE.charts.expenses = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets:[{ data, backgroundColor:['#0f766e','#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#64748b','#a855f7'] }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'bottom'}, tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${fmtMoney(ctx.raw)}` } } } }
      });
    } else {
      wrap.innerHTML = `<div class="h-full flex items-center justify-center text-gray-500"><div class="text-center"><i class="fas fa-chart-pie text-4xl mb-2 opacity-30"></i><p>No hay gastos en el período</p></div></div>`;
    }
  }

  updateTrendChart();
  updateRecentActivity();
}

function updateTrendChart() {
  const canvas = $('#trendChart');
  if (!canvas || !window.Chart) return;
  if (APP_STATE.charts.trend) { try { APP_STATE.charts.trend.destroy(); } catch(e){} }

  const now = new Date();
  const uid = APP_STATE.user?.id;
  const months = [];
  const ingresosByMonth = [];
  const gastosByMonth   = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
    months.push(ymToLabel(ym));

    const ingresosMes = (APP_STATE.data.ingresos||[]).filter(x=>toYM(x.fecha)===ym).reduce((s,x)=>s+parseAmount(x.monto),0);
const gastosMes = (APP_STATE.data.gastos||[]).filter(x=>x.user_id===uid && toYM(x.fecha)===ym).reduce((s,x)=>{
  const isShared = x.es_compartido;
  const myPct = isShared ? (x.porcentaje_usuario||50) : 100;
  return s + parseAmount(x.monto) * myPct / 100;
}, 0);    ingresosByMonth.push(ingresosMes);
    gastosByMonth.push(gastosMes);
  }

  APP_STATE.charts.trend = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        { label:'Ingresos', data: ingresosByMonth, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.1)', tension:.4, fill:true },
        { label:'Gastos',   data: gastosByMonth,   borderColor:'#ef4444', backgroundColor:'rgba(239,68,68,.1)',   tension:.4, fill:true }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}}, scales:{y:{beginAtZero:true}} }
  });
}

function updateRecentActivity() {
  const el = $('#recentActivity');
  if (!el) return;
  const uid = APP_STATE.user?.id;
  const all = [
    ...(APP_STATE.data.gastos||[]).filter(g=>g.user_id===uid).slice(0,5).map(g=>({...g,_type:'gasto'})),
    ...(APP_STATE.data.ingresos||[]).slice(0,3).map(i=>({...i,_type:'ingreso'}))
  ].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).slice(0,8);

  if (!all.length) { el.innerHTML='<p class="text-gray-500 text-sm">Sin actividad reciente</p>'; return; }

  el.innerHTML = all.map(item => {
    const isIngreso = item._type==='ingreso';
    const icon  = isIngreso ? 'fa-arrow-up text-green-600' : 'fa-arrow-down text-red-500';
    const color = isIngreso ? 'text-green-600' : 'text-red-600';
    const sign  = isIngreso ? '+' : '-';
    return `
      <div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <i class="fas ${icon} text-sm"></i>
          </div>
          <div>
            <div class="text-sm font-medium">${escapeHTML(item.descripcion||'')}</div>
            <div class="text-xs text-gray-500">${formatDate(item.fecha)} · ${escapeHTML(item.categoria||'')}</div>
          </div>
        </div>
        <div class="font-semibold ${color}">${sign}${fmtMoney(item.monto)}</div>
      </div>`;
  }).join('');
}

// =========================================================
// INCOMES
// =========================================================
function loadIncomes() {
  const list = $('#incomesList');
  if (!list) return;

  let ingresos = APP_STATE.data.ingresos || [];

  const filterMonth = APP_STATE.filters.incomes.month;
  const filterYear  = APP_STATE.filters.incomes.year;

  if (filterMonth || filterYear) {
    ingresos = ingresos.filter(item => {
      const d = new Date(item.fecha+'T00:00:00');
      if (filterMonth && (d.getMonth()+1) !== parseInt(filterMonth)) return false;
      if (filterYear  &&  d.getFullYear()  !== parseInt(filterYear))  return false;
      return true;
    });
  }

  const total = ingresos.reduce((s,i)=>s+parseAmount(i.monto),0);

  if (!ingresos.length) {
    list.innerHTML = `<div class="p-6 text-center text-gray-500"><i class="fas fa-coins text-4xl mb-3"></i><p>No hay ingresos registrados</p></div>`;
    return;
  }

  const frecMap = { onetime:'Único', weekly:'Semanal', biweekly:'Quincenal', monthly:'Mensual', yearly:'Anual' };

  list.innerHTML = `
    <div class="p-4 bg-green-50 border-b border-green-200 flex justify-between items-center">
      <div class="font-semibold text-green-700">TOTAL INGRESOS</div>
      <div class="text-2xl font-bold text-green-700">${fmtMoney(total)}</div>
    </div>` +
    ingresos.map(item => `
      <div class="flex items-center justify-between p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50">
        <div class="flex items-center gap-3">
          <div class="card-icon success"><i class="fas fa-arrow-up"></i></div>
          <div>
            <div class="font-medium">${escapeHTML(item.descripcion)}</div>
            <div class="text-sm text-gray-500">${formatDate(item.fecha)} · ${escapeHTML(item.categoria||'')} · ${frecMap[item.frecuencia]||item.frecuencia}</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-lg font-bold text-green-600">+${fmtMoney(item.monto)}</div>
          <button class="text-gray-400 hover:text-primary" onclick="openIncomeModal('${item.id}')"><i class="fas fa-edit"></i></button>
          <button class="text-gray-400 hover:text-red-500" onclick="deleteIncome('${item.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>`).join('');
}

// =========================================================
// EXPENSES
// =========================================================
function renderExpenses() {
  const list = $('#expensesList');
  if (!list) return;

  const uid = APP_STATE.user?.id;
  // Combine own + shared where I'm involved
  let gastos = (APP_STATE.data.gastos||[]).filter(g => {
  if (g.user_id === uid) return true; // mis gastos propios siempre
  if (g.partner_id === uid) {
    // gastos de pareja compartidos: solo si mi parte > 0
    const pct = g.porcentaje_usuario ?? 100;
    const myPct = 100 - pct;
    return myPct > 0;
  }
  return false;
});

  const filterType     = APP_STATE.filters.expenses.tipo;
  const filterCategory = APP_STATE.filters.expenses.category;
  const filterMonth    = APP_STATE.filters.expenses.month;
  const filterYear     = APP_STATE.filters.expenses.year;

  if (filterType !== 'all') gastos = gastos.filter(g => g.tipo === filterType);
  if (filterCategory !== 'all') gastos = gastos.filter(g => g.categoria === filterCategory);
  if (filterMonth || filterYear) {
    gastos = gastos.filter(g => {
      const d = new Date(g.fecha+'T00:00:00');
      if (filterMonth && (d.getMonth()+1) !== parseInt(filterMonth)) return false;
      if (filterYear  &&  d.getFullYear()  !== parseInt(filterYear))  return false;
      return true;
    });
  }

  gastos.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));

  let totalFijos=0, totalVar=0, totalCred=0;
  let countFijos=0, countVar=0, countCred=0;
  gastos.forEach(g => {
    const isOwner = g.user_id === uid;
    const isShared = g.es_compartido && g.partner_id;
    const myPct = isShared ? (isOwner ? (g.porcentaje_usuario||100) : (100-(g.porcentaje_usuario||100))) : 100;
    const amt = parseAmount(g.monto) * myPct / 100;
    if (g.tipo==='fijo' || g.tipo==='fixed') { totalFijos+=amt; countFijos++; }
    else if (g.tipo==='credito' || g.tipo==='credit') { totalCred+=amt; countCred++; }
    else { totalVar+=amt; countVar++; }
  });
  const totalGeneral = totalFijos+totalVar+totalCred;

  setText('fixedExpenses', fmtMoney(totalFijos));
  setText('fixedCount', countFijos);
  setText('variableExpenses', fmtMoney(totalVar));
  setText('variableCount', countVar);
  setText('creditExpenses', fmtMoney(totalCred));
  setText('creditCount', countCred);

  if (!gastos.length) {
    list.innerHTML = `<div class="p-6 text-center text-gray-500"><i class="fas fa-receipt text-4xl mb-3"></i><p class="mb-3">No hay gastos registrados</p><button class="btn btn-accent bg-primary text-white px-3 py-1 rounded text-sm" onclick="openExpenseModal()"><i class="fas fa-plus"></i> Agregar</button></div>`;
    return;
  }

  const tipoMap = { fijo:'Fijo', fixed:'Fijo', variable:'Variable', credito:'Crédito', credit:'Crédito' };
  const metodoMap = { cash:'Efectivo', debit:'Débito', credit:'Crédito', transfer:'Transferencia' };

  let html = `
    <div class="p-4 bg-gray-50 border-b border-gray-200">
      <div class="flex justify-between items-center mb-2">
        <div class="font-semibold text-gray-700">TOTAL</div>
        <div class="text-xl font-bold text-red-600">${fmtMoney(totalGeneral)}</div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-sm">
        <div class="text-center p-2 bg-blue-50 rounded"><div class="font-semibold text-primary">Fijos</div><div class="font-bold">${fmtMoney(totalFijos)}</div></div>
        <div class="text-center p-2 bg-yellow-50 rounded"><div class="font-semibold text-yellow-600">Variables</div><div class="font-bold">${fmtMoney(totalVar)}</div></div>
        <div class="text-center p-2 bg-red-50 rounded"><div class="font-semibold text-red-600">Crédito</div><div class="font-bold">${fmtMoney(totalCred)}</div></div>
      </div>
    </div>`;

  gastos.forEach(item => {
    const isOwner   = item.user_id === uid;
    const isShared  = item.es_compartido && item.partner_id;
    const pct = item.porcentaje_usuario ?? 100;
    const myPct = isOwner ? pct : (100 - pct);
    const montoTotal = parseAmount(item.monto); // ya es monto por cuota si tiene cuotas
const miParte = isShared ? montoTotal * myPct / 100 : montoTotal;
const montoCompraTotal = item.monto_total ? parseAmount(item.monto_total) : montoTotal;

    const tipoLabel = tipoMap[item.tipo] || 'Variable';
    const metodo    = metodoMap[item.metodo_pago] || 'Efectivo';

    let sharedBadge = isShared ? '<span class="badge badge-success ml-2 text-xs">Compartido</span>' : '';
    if (!isOwner && isShared) sharedBadge += '<span class="badge badge-secondary ml-1 text-xs">De pareja</span>';

    let cuotasInfo = '';
    if ((item.tipo==='credito'||item.tipo==='credit') && item.cuotas > 1) {
  cuotasInfo = `<span class="text-xs text-gray-500 ml-2">${item.cuotas} cuotas</span>`;
}

    let sharedDetail = '';
    if (isShared) {
      const partePareja = montoTotal - (montoTotal * myPct/100);
      sharedDetail = `
        <div class="mt-2 p-2 bg-blue-50 rounded text-sm">
          <div class="font-medium text-blue-700 mb-1">Gasto compartido</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="text-blue-600"><i class="fas fa-user mr-1"></i>Tu: <strong>${fmtMoney(miParte)}</strong> (${myPct}%)</div>
            <div class="text-green-600"><i class="fas fa-user-friends mr-1"></i>Pareja: <strong>${fmtMoney(partePareja)}</strong> (${100-myPct}%)</div>
          </div>
        </div>`;
    }

    html += `
      <div class="p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3 flex-1 min-w-0">
            <div class="card-icon warning shrink-0"><i class="fas fa-arrow-down"></i></div>
            <div class="min-w-0">
              <div class="font-medium truncate">${escapeHTML(item.descripcion)} ${sharedBadge} ${cuotasInfo}</div>
              <div class="text-sm text-gray-500">${formatDate(item.fecha)} · ${escapeHTML(item.categoria||'')} · ${tipoLabel} · ${metodo}</div>
            </div>
          </div>
          <div class="flex items-center gap-3 shrink-0 ml-3">
            <div class="text-right">
              <div class="text-lg font-bold text-red-600">-${fmtMoney(isShared ? miParte : montoTotal)}</div>
              ${isShared && miParte!==montoTotal ? `<div class="text-xs text-gray-400">Total: ${fmtMoney(montoTotal)}</div>` : ''}
            </div>
            ${isOwner ? `<button class="text-gray-400 hover:text-primary" onclick="openExpenseModal('${item.id}')"><i class="fas fa-edit"></i></button>
            <button class="text-gray-400 hover:text-red-500" onclick="deleteExpense('${item.id}')"><i class="fas fa-trash"></i></button>` : ''}
          </div>
        </div>
        ${sharedDetail}
      </div>`;
  });

  list.innerHTML = html;
}

// =========================================================
// SHARED SECTION
// =========================================================
async function loadSharedSection() {
  const noPartnerSection = $('#noPartnerSection');
  const partnerSection   = $('#partnerSection');

  await loadInvitesNoPartnerUI_();

  if (!APP_STATE.partner) {
    noPartnerSection?.classList.remove('hidden');
    partnerSection?.classList.add('hidden');
    return;
  }

  noPartnerSection?.classList.remove('hidden');
  partnerSection?.classList.remove('hidden');

  const uid = APP_STATE.user?.id;
  const gastosCompartidos = (APP_STATE.data.gastos||[]).filter(g => g.es_compartido);

  let ricardoLeDebeAAlveiro = 0; // gastos que cargó Alveiro, parte de Ricardo
  let alveiroLeDebeARicardo = 0; // gastos que cargó Ricardo, parte de Alveiro

  gastosCompartidos.forEach(g => {
    const isOwner = g.user_id === uid;
    const monto   = parseAmount(g.monto);
    const pct = g.porcentaje_usuario ?? 100;
const myPct = isOwner ? pct : (100 - pct);
    const miParte    = monto * myPct / 100;
    const parteOtro  = monto - miParte;

    if (isOwner) {
      // Yo lo cargué → el otro me debe su parte
      alveiroLeDebeARicardo += parteOtro;
    } else {
      // El otro lo cargó → yo le debo mi parte
      ricardoLeDebeAAlveiro += miParte;
    }
  });

  const totalGeneral = alveiroLeDebeARicardo + ricardoLeDebeAAlveiro;

  setText('youOwe',    fmtMoney(ricardoLeDebeAAlveiro));
  setText('owedToYou', fmtMoney(alveiroLeDebeARicardo));
  setText('sharedTotal', fmtMoney(totalGeneral));
  setText('partnerNameDisplay',  APP_STATE.partner?.nombre || APP_STATE.partner?.email || 'Tu pareja');
  setText('partnerNameDisplay2', APP_STATE.partner?.nombre || APP_STATE.partner?.email || 'Tu pareja');

  const list = $('#sharedExpensesList');
  if (!list) return;

  if (!gastosCompartidos.length) {
    list.innerHTML = `<div class="p-6 text-center text-gray-500"><i class="fas fa-handshake text-4xl mb-3"></i><p>No hay gastos compartidos aún</p></div>`;
    return;
  }

  gastosCompartidos.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));

  list.innerHTML = gastosCompartidos.map(item => {
    const isOwner  = item.user_id === uid;
    const pct = item.porcentaje_usuario ?? 100;
const myPct = isOwner ? pct : (100 - pct);
    const monto    = parseAmount(item.monto);
    const miParte  = monto * myPct / 100;
    const roleLabel = isOwner ? 'Tu cargaste' : 'Pareja cargó';

    return `
      <div class="flex items-center justify-between p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50">
        <div class="flex items-center gap-3">
          <div class="card-icon primary"><i class="fas fa-share-alt"></i></div>
          <div>
            <div class="font-medium">${escapeHTML(item.descripcion)}</div>
            <div class="text-sm text-gray-500">${formatDate(item.fecha)} · ${escapeHTML(item.categoria||'')} · <span class="text-blue-600">${roleLabel}</span></div>
            <div class="text-xs text-gray-500">Total: ${fmtMoney(monto)} · Tu parte (${myPct}%): <strong>${fmtMoney(miParte)}</strong></div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <div class="font-bold text-primary">${fmtMoney(miParte)}</div>
          ${isOwner ? `<button class="text-gray-400 hover:text-red-500" onclick="deleteExpense('${item.id}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function loadInvitesNoPartnerUI_() {
  const receivedList = $('#receivedInvitesList');
  const sentList     = $('#sentInvitesList');
  const myEmail = normEmail(APP_STATE.user?.email||'');
  const invs = APP_STATE.data.invitaciones || [];

  const received = invs.filter(i => i.status==='pending' && normEmail(i.to_email)===myEmail);
  const sent     = invs.filter(i => i.status==='pending' && i.from_user_id===APP_STATE.user?.id);

  if (receivedList) {
    receivedList.innerHTML = received.length
      ? received.map(inv => `
          <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200">
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">Invitación pendiente</div>
              <div class="text-xs text-gray-500">Código: <span class="font-mono font-bold">${escapeHTML(inv.code)}</span></div>
            </div>
            <button class="btn bg-primary text-white px-3 py-1.5 rounded text-sm hover:bg-teal-700"
              onclick="acceptInviteById('${inv.id}')">Aceptar</button>
          </div>`).join('')
      : '<div class="text-sm text-gray-500">Sin invitaciones pendientes.</div>';
  }

  if (sentList) {
    sentList.innerHTML = sent.length
      ? sent.map(inv => `
          <div class="p-3 rounded-lg border border-gray-200">
            <div class="text-sm font-medium">Para: ${escapeHTML(inv.to_email)}</div>
            <div class="text-xs text-gray-500 mt-1">Código a compartir: <span class="font-mono font-bold text-primary">${escapeHTML(inv.code)}</span></div>
          </div>`).join('')
      : '<div class="text-sm text-gray-500">No has enviado invitaciones pendientes.</div>';
  }
}

// =========================================================
// CARDS
// =========================================================
async function loadCards() {
  const list = $('#cardsList');
  if (!list) return;

  const tarjetas = APP_STATE.data.tarjetas || [];

  if (!tarjetas.length) {
    list.innerHTML = `<div class="p-6 text-center text-gray-500"><i class="fas fa-credit-card text-4xl mb-3"></i><p>No hay tarjetas registradas</p></div>`;
    return;
  }

  const tipoIconos = { visa:'💳', mastercard:'💳', amex:'💳', other:'💳' };

  list.innerHTML = tarjetas.map(card => `
    <div class="flex items-center justify-between p-4 border-b border-gray-100 last:border-0 hover:bg-gray-50">
      <div class="flex items-center gap-3">
        <div class="card-icon primary"><i class="fas fa-credit-card"></i></div>
        <div>
          <div class="font-medium">${escapeHTML(card.banco)} ${card.ultimos_4 ? '****'+escapeHTML(card.ultimos_4) : ''}</div>
          <div class="text-sm text-gray-500">
            Cierre: día ${card.dia_cierre||'?'} · Venc: día ${card.dia_vencimiento||'?'} · ${(card.tipo||'').toUpperCase()}
            ${card.limite_credito ? ` · Límite: ${fmtMoney(card.limite_credito)}` : ''}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button class="text-gray-400 hover:text-primary" onclick="openCardModal('${card.id}')"><i class="fas fa-edit"></i></button>
        <button class="text-gray-400 hover:text-red-500" onclick="deleteCard('${card.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

// =========================================================
// PROJECTIONS
// =========================================================
async function loadProjections() {
  const tbody = $('#projectionsTableBody');
  if (!tbody) return;

  const uid     = APP_STATE.user?.id;
  const tarjetas = APP_STATE.data.tarjetas || [];
  const gastos   = APP_STATE.data.gastos   || [];

  const now = new Date();
  const filterYear  = parseInt($('#projectionYearFilter')?.value  || now.getFullYear());
  const filterMonth = $('#projectionMonthFilter')?.value || 'all';
  const filterType  = $('#projectionTypeFilter')?.value  || 'all';

  // Fill year filter
  const yearSel = $('#projectionYearFilter');
  if (yearSel && !yearSel.options.length) {
    for (let y = now.getFullYear()-1; y <= now.getFullYear()+2; y++) {
      const opt = document.createElement('option');
      opt.value = y; opt.text = y;
      if (y===now.getFullYear()) opt.selected = true;
      yearSel.appendChild(opt);
    }
    yearSel.onchange = loadProjections;
    $('#projectionMonthFilter').onchange = loadProjections;
    $('#projectionTypeFilter').onchange  = loadProjections;
  }

  const monthSel2 = $('#projectionMonthFilter');
if (monthSel2 && monthSel2.options.length <= 1) {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  meses.forEach((m,i) => {
    const opt = document.createElement('option');
    opt.value = i+1; opt.text = m;
    monthSel2.appendChild(opt);
  });
}
  const projections = [];

  // Todos los gastos donde estoy involucrado (excepto crédito con cuotas — se manejan abajo)
  gastos
    .filter(g => (g.user_id===uid || g.partner_id===uid) && !((g.tipo==='credito'||g.tipo==='credit') && g.cuotas > 1))
    .forEach(g => {
      const isOwner = g.user_id === uid;
      const pct     = g.porcentaje_usuario ?? 100;
      const myPct   = isOwner ? pct : (100 - pct);
      const monto   = parseAmount(g.monto);
      const miParte = monto * myPct / 100;
      const tipoMap2 = { fijo:'fixed', fixed:'fixed', variable:'variable', credito:'credit', credit:'credit' };

      projections.push({
        descripcion: g.descripcion,
        fecha: g.fecha,
        monto,
        mi_parte: miParte,
        pareja_parte: monto - miParte,
        tipo: g.es_compartido ? 'shared' : (tipoMap2[g.tipo]||'variable'),
        obs: g.es_compartido ? `Compartido ${myPct}%` : ''
      });
    });

  // Gastos crédito con cuotas → generar schedule completo
  gastos.filter(g => (g.tipo==='credito'||g.tipo==='credit') && g.cuotas > 1 && (g.user_id===uid || g.partner_id===uid)).forEach(g => {
    const isOwner = g.user_id === uid;
    const esMiTarjeta = g.tarjeta_id && tarjetas.some(t=>t.id===g.tarjeta_id);
    // Para Alveiro: la tarjeta es de Ricardo, él le debe la cuota completa
    const esPartnerTarjeta = !isOwner && g.tarjeta_id && (APP_STATE.data.tarjetas||[]).some(t=>t.id===g.tarjeta_id) === false;
    if (g.user_id !== uid && !esMiTarjeta && !esPartnerTarjeta) return; // skip si no es mi tarjeta ni de pareja
    const card = tarjetas.find(t => t.id===g.tarjeta_id) || {
      id: g.tarjeta_id,
      dia_cierre: 15,
      dia_vencimiento: 5
    };
    const pct = g.porcentaje_usuario ?? 100;
    const myPct = isOwner
      ? (esMiTarjeta ? 100 : pct)
      : (!esMiTarjeta && g.tarjeta_id ? 100 : (100 - pct));
    const montoTotal = g.monto_total ? parseAmount(g.monto_total) : parseAmount(g.monto) * (g.cuotas||1);
    const items = buildInstallmentSchedule({
      purchaseDate: g.fecha,
      card,
      cuotasTotales: g.cuotas||1,
      montoTotal,
      descripcion: g.descripcion,
      baseItem: g,
      miParte: montoTotal * myPct / 100,
      parejaParte: montoTotal * (100 - myPct) / 100
    });
    items.forEach(it => projections.push({ ...it, tipo: g.es_compartido ? 'shared' : 'credit', obs: `Cuota ${it.cuota_actual||'?'}/${g.cuotas}` }));
  });

  // Filter
  let filtered = projections.filter(p => {
    const d = new Date(p.fecha+'T00:00:00');
    if (d.getFullYear()!==filterYear) return false;
    if (filterMonth!=='all' && (d.getMonth()+1)!==parseInt(filterMonth)) return false;
    if (filterType!=='all' && p.tipo!==filterType) return false;
    return true;
  });

  filtered.sort((a,b)=>new Date(a.fecha)-new Date(b.fecha));

  const totalMonto    = filtered.reduce((s,p)=>s+p.monto,0);
  const totalMiParte  = filtered.reduce((s,p)=>s+(p.mi_parte||0),0);
  const totalParejaP  = filtered.reduce((s,p)=>s+(p.pareja_parte||0),0);

  setText('projectionTotal',      fmtMoney(totalMonto));
  setText('projectionCount',      `${filtered.length} pagos`);
  setText('projectionYourPart',   fmtMoney(totalMiParte));
  setText('projectionPartnerPart',fmtMoney(totalParejaP));

  const tipoMap = { fixed:'Fijo', credit:'Crédito', shared:'Compartido' };

  tbody.innerHTML = filtered.map(p => `
    <tr class="border-b border-gray-100 hover:bg-gray-50">
      <td class="p-3">${escapeHTML(p.descripcion)}</td>
      <td class="p-3">${formatDate(p.fecha)}</td>
      <td class="p-3 font-medium">${fmtMoney(p.monto)}</td>
      <td class="p-3 text-primary font-medium">${fmtMoney(p.mi_parte ?? p.monto)}</td>
      <td class="p-3 text-green-600">${fmtMoney(p.pareja_parte||0)}</td>
      <td class="p-3"><span class="badge badge-primary">${tipoMap[p.tipo]||p.tipo}</span></td>
      <td class="p-3 text-sm text-gray-500">${escapeHTML(p.obs||'')}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="p-6 text-center text-gray-500">No hay proyecciones para el período</td></tr>`;
}

// =========================================================
// REPORTS
// =========================================================
async function loadLiquidacion() {
  const uid = APP_STATE.user?.id;
  if (!uid) return;

  const now = new Date();
  const filterMonth = parseInt($('#liquidacionMonthFilter')?.value) || (now.getMonth()+1);
  const filterYear  = parseInt($('#liquidacionYearFilter')?.value)  || now.getFullYear();

  // Setear filtros por defecto al mes actual
  const monthSel = $('#liquidacionMonthFilter');
  const yearSel  = $('#liquidacionYearFilter');
  if (monthSel && !monthSel.dataset.init) {
    monthSel.value = now.getMonth()+1;
    monthSel.dataset.init = '1';
    monthSel.onchange = loadLiquidacion;
    yearSel.onchange  = loadLiquidacion;
  }

  const gastosCompartidos = (APP_STATE.data.gastos||[]).filter(g => {
    if (!g.es_compartido) return false;
    return g.user_id === uid || g.partner_id === uid;
  });

  const tarjetas = APP_STATE.data.tarjetas || [];
  const items = [];

  gastosCompartidos.forEach(g => {
    const esCredito = g.tipo==='credito' || g.tipo==='credit';

    if (esCredito && g.cuotas > 1 && g.tarjeta_id) {
      const card = tarjetas.find(t=>t.id===g.tarjeta_id) || {
        id: g.tarjeta_id,
        dia_cierre: 15,
        dia_vencimiento: 5
      };
      const montoTotal = g.monto_total ? parseAmount(g.monto_total) : parseAmount(g.monto) * g.cuotas;
      const schedule = buildInstallmentSchedule({
        purchaseDate: g.fecha, card,
        cuotasTotales: g.cuotas, montoTotal,
        descripcion: g.descripcion, baseItem: g,
        miParte: montoTotal, parejaParte: 0
      });
      schedule.forEach(cuota => {
        const d = new Date(cuota.fecha+'T00:00:00');
        if (filterMonth && filterMonth!==0 && (d.getMonth()+1)!==filterMonth) return;
        if (filterYear && d.getFullYear()!==filterYear) return;
        items.push({ ...g, fecha: cuota.fecha, monto: cuota.monto, _cuotaLabel: `Cuota ${cuota.cuota_actual}/${g.cuotas}` });
      });
      return;
    }

    // Gasto normal
    const d = new Date(g.fecha+'T00:00:00');
    if (filterMonth && filterMonth!==0 && (d.getMonth()+1)!==filterMonth) return;
    if (filterYear && d.getFullYear()!==filterYear) return;
    items.push(g);
  });

  const filtered = items;

  // Calcular partes
  let teDeben = 0, TuDebes = 0;
  const totalesPorTipo = { fijo: {teDeben:0, TuDebes:0}, variable: {teDeben:0, TuDebes:0}, credito: {teDeben:0, TuDebes:0} };

  const tipoMap = { fijo:'Fijo', fixed:'Fijo', variable:'Variable', credito:'Crédito', credit:'Crédito' };

  const rows = filtered.map(g => {
    const isOwner  = g.user_id === uid;
    const pct      = g.porcentaje_usuario ?? 100;
    const myPct    = isOwner ? pct : (100 - pct);
    const monto    = parseAmount(g.monto);
    const miParte  = monto * myPct / 100;
    const partePareja = monto - miParte;

    const tipoKey = (g.tipo==='credito'||g.tipo==='credit') ? 'credito' : (g.tipo==='fijo'||g.tipo==='fixed') ? 'fijo' : 'variable';

    const partnerNombre = APP_STATE.partner?.nombre || APP_STATE.partner?.email || 'Tu pareja';
    const quienPagoField = g.quien_pago || 'yo';
const yoPague = (quienPagoField === 'yo' && isOwner) || (quienPagoField === 'pareja' && !isOwner);

    if (yoPague) {
      // Quien pagó soy yo → pareja me debe su parte
      teDeben += partePareja;
      totalesPorTipo[tipoKey].teDeben += partePareja;
    } else {
      // Quien pagó es la pareja → yo le debo mi parte
      TuDebes += miParte;
      totalesPorTipo[tipoKey].TuDebes += miParte;
    }

    let quienDebe;
    if (yoPague) {
      quienDebe = partePareja > 0
        ? `<span class="text-green-600 font-medium">${partnerNombre} te debe ${fmtMoney(partePareja)}</span>`
        : `<span class="text-gray-400">Tu pagaste todo</span>`;
    } else {
      quienDebe = miParte > 0
        ? `<span class="text-yellow-600 font-medium">Tu le debés ${fmtMoney(miParte)} a ${partnerNombre}</span>`
        : `<span class="text-gray-400">${partnerNombre} pagó todo</span>`;
    }

    return { g, miParte, partePareja, isOwner, monto, tipoKey, quienDebe, tipoLabel: tipoMap[g.tipo]||'Variable' };
  });

  // Actualizar cards
  const neto = teDeben - TuDebes;
  setText('liqTeDebenTotal', fmtMoney(teDeben));
  setText('liqTuDebésTotal', fmtMoney(TuDebes));
  setText('liqNetoTotal', fmtMoney(Math.abs(neto)));
  setText('liqPartnerName', `De ${APP_STATE.partner?.nombre||APP_STATE.partner?.email||'tu pareja'}`);
  setText('liqNetoLabel', neto > 0 ? `${APP_STATE.partner?.nombre||APP_STATE.partner?.email||'Pareja'} te debe el neto` : neto < 0 ? 'Tu debés el neto' : 'Están a mano');

  const netoEl = document.getElementById('liqNetoTotal');
  if (netoEl) netoEl.className = `text-2xl font-bold ${neto > 0 ? 'text-green-600' : neto < 0 ? 'text-yellow-600' : 'text-gray-600'}`;

  // Render tabla
  const tbody = $('#liquidacionTableBody');
  if (tbody) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-gray-500">No hay gastos compartidos en este período</td></tr>`;
    } else {
      rows.sort((a,b) => new Date(a.g.fecha) - new Date(b.g.fecha));
      tbody.innerHTML = rows.map(({g, miParte, partePareja, monto, tipoLabel, quienDebe}) => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="p-3 font-medium">${escapeHTML(g.descripcion)}${g._esCuota ? ` <span class="text-xs text-gray-400">${g._cuotaLabel}</span>` : ''}</td>
          <td class="p-3 text-gray-600">${formatDate(g.fecha)}</td>
          <td class="p-3 text-gray-600">${escapeHTML(g.categoria||'')}</td>
          <td class="p-3"><span class="badge badge-primary">${tipoLabel}</span></td>
          <td class="p-3 font-medium">${fmtMoney(monto)}</td>
          <td class="p-3 ${miParte>0?'text-yellow-600 font-medium':'text-gray-400'}">${fmtMoney(miParte)}</td>
          <td class="p-3 ${partePareja>0?'text-green-600 font-medium':'text-gray-400'}">${fmtMoney(partePareja)}</td>
          <td class="p-3">${quienDebe}</td>
        </tr>`).join('');
    }
  }

  // Totales por tipo
  const totalesEl = $('#liquidacionTotalesPorTipo');
  if (totalesEl) {
    const tiposConDatos = ['fijo','variable','credito'].filter(t =>
      totalesPorTipo[t].teDeben > 0 || totalesPorTipo[t].TuDebes > 0
    );

    if (!tiposConDatos.length) {
      totalesEl.innerHTML = '';
      return;
    }

    totalesEl.innerHTML = `
      <div class="font-semibold text-gray-700 mb-3">Resumen por tipo de gasto</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="text-left py-2 text-gray-600">Tipo</th>
              <th class="text-right py-2 text-green-600">Te deben</th>
              <th class="text-right py-2 text-yellow-600">Tu debés</th>
              <th class="text-right py-2 text-gray-700">Neto</th>
            </tr>
          </thead>
          <tbody>
            ${['fijo','variable','credito'].map(tipo => {
              const t = totalesPorTipo[tipo];
              if (t.teDeben===0 && t.TuDebes===0) return '';
              const netoTipo = t.teDeben - t.TuDebes;
              return `
                <tr class="border-b border-gray-100">
                  <td class="py-2 font-medium">${tipoMap[tipo]}</td>
                  <td class="py-2 text-right text-green-600">${t.teDeben>0 ? fmtMoney(t.teDeben) : '-'}</td>
                  <td class="py-2 text-right text-yellow-600">${t.TuDebes>0 ? fmtMoney(t.TuDebes) : '-'}</td>
                  <td class="py-2 text-right font-semibold ${netoTipo>0?'text-green-600':netoTipo<0?'text-yellow-600':'text-gray-500'}">
                    ${netoTipo>0?'+':''}${fmtMoney(netoTipo)}
                  </td>
                </tr>`;
            }).join('')}
            <tr class="font-bold border-t-2 border-gray-300">
              <td class="py-2">TOTAL</td>
              <td class="py-2 text-right text-green-600">${fmtMoney(teDeben)}</td>
              <td class="py-2 text-right text-yellow-600">${fmtMoney(TuDebes)}</td>
              <td class="py-2 text-right ${(teDeben-TuDebes)>0?'text-green-600':(teDeben-TuDebes)<0?'text-yellow-600':'text-gray-500'}">
                ${fmtMoney(teDeben-TuDebes)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
  }
}

async function loadReports() {
  const uid = APP_STATE.user?.id;
  const now = new Date();
  const year = now.getFullYear();

  const gastosPropios = (APP_STATE.data.gastos||[]).filter(g=>g.user_id===uid);
  const ingresos      = APP_STATE.data.ingresos||[];

  const totalIngresos = ingresos.reduce((s,i)=>s+parseAmount(i.monto),0);
  const totalGastos = gastosPropios.reduce((s,g)=>{
    const pct = g.es_compartido ? (g.porcentaje_usuario ?? 100) : 100;
    return s + parseAmount(g.monto) * pct / 100;
  }, 0);
  const balance       = totalIngresos - totalGastos;

  // Últimos 6 meses
  const monthlySums = [];
  for (let i=5; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ym = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
    monthlySums.push(gastosPropios.filter(g=>toYM(g.fecha)===ym).reduce((s,g)=>s+parseAmount(g.monto),0));
  }
  const monthlyAvg = monthlySums.reduce((s,v)=>s+v,0) / 6;

  setText('yearlyBalance', fmtMoney(balance));
  setText('totalSavings', fmtMoney(Math.max(0, balance)));
  setText('monthlyAverage', fmtMoney(monthlyAvg));

  // Category chart
  const canvas = $('#categoryReportChart');
  if (canvas && window.Chart) {
    if (APP_STATE.charts.report) { try{APP_STATE.charts.report.destroy();}catch(e){} }
    const cats = {};
    gastosPropios.forEach(g => {
      const c = g.categoria||'Otros';
      cats[c] = (cats[c]||0) + parseAmount(g.monto);
    });
    APP_STATE.charts.report = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: Object.keys(cats),
        datasets: [{ label:'Gastos por categoría', data: Object.values(cats), backgroundColor:'#0f766e' }]
      },
      options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }
    });
  }
}

// =========================================================
// SETTINGS
// =========================================================
function loadSettings() {
  const profile = APP_STATE.data.profile;
  const user    = APP_STATE.user;
  if (!profile && !user) return;

  const nameInput     = $('#profileName');
  const emailInput    = $('#profileEmail');
  const currencyInput = $('#profileCurrency');

  if (nameInput)     nameInput.value     = profile?.nombre || '';
  if (emailInput)    emailInput.value    = user?.email || '';
  if (currencyInput) currencyInput.value = profile?.moneda || 'ARS';

  loadCategories();
}

async function saveProfile() {
  const uid  = APP_STATE.user?.id;
  if (!uid) return;
  const name     = $('#profileName')?.value?.trim();
  const currency = $('#profileCurrency')?.value || 'ARS';

  showLoading(true);
  try {
    const { error } = await sb.from('profiles').update({ nombre:name, moneda:currency }).eq('id', uid);
    if (error) throw error;
    APP_STATE.data.profile = { ...APP_STATE.data.profile, nombre:name, moneda:currency };
    updateUserUI();
    showAlert('Perfil actualizado','success');
  } catch(err) {
    showAlert(err.message||'Error al guardar','error');
  } finally { showLoading(false); }
}

async function changePassword() {
  const np = $('#newPassword')?.value;
  const cp = $('#confirmPassword')?.value;
  if (!np) { showAlert('Ingresa la nueva contraseña','warning'); return; }
  if (np !== cp) { showAlert('Las contraseñas no coinciden','warning'); return; }
  if (np.length < 6) { showAlert('Mínimo 6 caracteres','warning'); return; }

  showLoading(true);
  try {
    const { error } = await sb.auth.updateUser({ password: np });
    if (error) throw error;
    showAlert('Contraseña actualizada','success');
    $('#newPassword').value = '';
    $('#confirmPassword').value = '';
  } catch(err) {
    showAlert(err.message||'Error al cambiar contraseña','error');
  } finally { showLoading(false); }
}

async function loadCategories() {
  const list = $('#categoriesList');
  if (!list) return;
  const cats = APP_STATE.data.categorias || [];
  if (!cats.length) { list.innerHTML='<div class="text-sm text-gray-500">No hay categorías</div>'; return; }
  list.innerHTML = cats.map(c => `
    <div class="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
      <div class="flex items-center gap-2">
        <span class="badge ${c.tipo==='ingreso'?'badge-success':'badge-primary'} text-xs">${c.tipo==='ingreso'?'Ingreso':'Gasto'}</span>
        <span class="text-sm">${escapeHTML(c.nombre)}</span>
      </div>
      <button class="text-gray-400 hover:text-red-500 text-xs" onclick="deleteCategory('${c.id}')"><i class="fas fa-trash"></i></button>
    </div>`).join('');
}

async function addCategoryPrompt() {
  const nombre = prompt('Nombre de la nueva categoría:');
  if (!nombre?.trim()) return;
  const tipo = confirm('¿Es categoría de ingreso?\n(Cancelar = categoría de gasto)') ? 'ingreso' : 'gasto';
  showLoading(true);
  try {
    const { data, error } = await sb.from('categorias').insert({ user_id: APP_STATE.user.id, nombre: nombre.trim(), tipo }).select().single();
    if (error) throw error;
    APP_STATE.data.categorias.push(data);
    APP_STATE.data.categorias.sort((a,b)=>a.nombre.localeCompare(b.nombre));
    updateCategoryUI();
    loadCategories();
    showAlert('Categoría agregada','success');
  } catch(err) {
    showAlert(err.message||'Error','error');
  } finally { showLoading(false); }
}

async function deleteCategory(id) {
  if (!confirm('¿Eliminar esta categoría?')) return;
  showLoading(true);
  try {
    const { error } = await sb.from('categorias').delete().eq('id', id);
    if (error) throw error;
    APP_STATE.data.categorias = APP_STATE.data.categorias.filter(c=>c.id!==id);
    updateCategoryUI();
    loadCategories();
    showAlert('Categoría eliminada','success');
  } catch(err) {
    showAlert(err.message||'Error','error');
  } finally { showLoading(false); }
}

// =========================================================
// MODALS
// =========================================================
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function setupModals() {
  document.addEventListener('click', e => {
    const closeBtn = e.target.closest('.modal-close');
    if (closeBtn) {
      const overlay = closeBtn.closest('.modal-overlay');
      if (overlay) overlay.classList.remove('active');
    }
  });
}

function openIncomeModal(incomeId = null) {
  const form = $('#incomeForm');
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  $('#incomeModalTitle').textContent = 'Nuevo Ingreso';

  if (incomeId) {
    const item = (APP_STATE.data.ingresos||[]).find(i=>i.id===incomeId);
    if (item) {
      $('#incomeModalTitle').textContent = 'Editar Ingreso';
      form.querySelector('[name="id"]').value      = item.id;
      form.querySelector('[name="descripcion"]').value = item.descripcion;
      form.querySelector('[name="monto"]').value   = item.monto;
      form.querySelector('[name="fecha"]').value   = item.fecha;
      form.querySelector('[name="frecuencia"]').value = item.frecuencia||'monthly';
      form.querySelector('[name="categoria"]').value  = item.categoria||'';
    }
  } else {
    // Default to today
    form.querySelector('[name="fecha"]').value = new Date().toISOString().split('T')[0];
  }

  openModal('incomeModal');
}

function openExpenseModal(expenseId = null) {
  const form = $('#expenseForm');
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  $('#expenseModalTitle').textContent = 'Nuevo Gasto';

  // Populate card select
  const cardSel = $('#expenseCardSelect');
  if (cardSel) {
    cardSel.innerHTML = `<option value="">Sin tarjeta</option>` +
      (APP_STATE.data.tarjetas||[]).map(c=>`<option value="${c.id}">${escapeHTML(c.banco)} ****${c.ultimos_4||''}</option>`).join('');
  }

  // Populate partner select
  refreshSharedWithOptions_();

  if (expenseId) {
    const item = (APP_STATE.data.gastos||[]).find(g=>g.id===expenseId);
    if (item) {
      $('#expenseModalTitle').textContent = 'Editar Gasto';
      form.querySelector('[name="id"]').value       = item.id;
      form.querySelector('[name="descripcion"]').value = item.descripcion;
      form.querySelector('[name="monto"]').value    = item.monto;
      form.querySelector('[name="fecha"]').value    = item.fecha;
      form.querySelector('[name="categoria"]').value = item.categoria||'';
      form.querySelector('[name="tipo"]').value     = item.tipo||'variable';
      form.querySelector('[name="metodo_pago"]').value = item.metodo_pago||'cash';
      if (item.tarjeta_id && cardSel) cardSel.value = item.tarjeta_id;
      form.querySelector('[name="cuotas"]').value   = item.cuotas||1;
      if (item.es_compartido) {
  const check = $('#isSharedCheck');
  if (check) { check.checked = true; $('#sharedFields')?.classList.remove('hidden'); }
  refreshSharedWithOptions_();
  const sharedSel = $('#sharedWithSelect');
  if (sharedSel && item.partner_id) sharedSel.value = item.partner_id;
  const pctSel = $('#sharedPercentageSelect');
  if (pctSel) pctSel.value = item.porcentaje_usuario||50;
  const yoPagueCheck = $('#yoPagueCheck');
  if (yoPagueCheck) yoPagueCheck.checked = (item.quien_pago !== 'pareja');
}
    }
  } else {
    form.querySelector('[name="fecha"]').value = new Date().toISOString().split('T')[0];
    const yoPagueCheck = $('#yoPagueCheck');
    if (yoPagueCheck) yoPagueCheck.checked = true;
  }

  openModal('expenseModal');
}

function refreshSharedWithOptions_() {
  const sel = $('#sharedWithSelect');
  if (!sel) return;
  sel.innerHTML = `<option value="">Seleccionar...</option>`;
  if (APP_STATE.partner) {
    const email = APP_STATE.partner.email || '';
    const nombre = APP_STATE.partner.nombre || email;
    sel.innerHTML += `<option value="${escapeHTML(APP_STATE.partner.id)}">${escapeHTML(nombre)}</option>`;
  }
  const label = document.getElementById('quienPagoPartnerLabel');
  if (label && APP_STATE.partner) {
    label.textContent = (APP_STATE.partner.nombre || 'Tu pareja') + ' lo pagó';
  }
}

function openCardModal(cardId = null) {
  const form = $('#cardForm');
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';

  if (cardId) {
    const card = (APP_STATE.data.tarjetas||[]).find(c=>c.id===cardId);
    if (card) {
      form.querySelector('[name="id"]').value         = card.id;
      form.querySelector('[name="banco"]').value      = card.banco||'';
      form.querySelector('[name="ultimos_4"]').value  = card.ultimos_4||'';
      form.querySelector('[name="limite_credito"]').value = card.limite_credito||'';
      form.querySelector('[name="dia_cierre"]').value = card.dia_cierre||'';
      form.querySelector('[name="dia_vencimiento"]').value = card.dia_vencimiento||'';
      form.querySelector('[name="tipo"]').value       = card.tipo||'visa';
    }
  }
  openModal('cardModal');
}

// =========================================================
// SAVE INCOME
// =========================================================
async function saveIncome() {
  if (incomeSaveInFlight) return;
  incomeSaveInFlight = true;
  const btn = $('#saveIncomeBtn');
  if (btn) btn.disabled = true;
  showLoading(true);

  const form = $('#incomeForm');
  if (!form) { incomeSaveInFlight=false; showLoading(false); return; }

  const fd = new FormData(form);
  const payload = {
    user_id:     APP_STATE.user.id,
    descripcion: (fd.get('descripcion')||'').trim(),
    monto:       parseMoney(fd.get('monto')),
    fecha:       fd.get('fecha'),
    frecuencia:  fd.get('frecuencia')||'monthly',
    categoria:   fd.get('categoria')||''
  };

  if (!payload.descripcion || !payload.monto || !payload.fecha) {
    showAlert('Completa los campos obligatorios','warning');
    incomeSaveInFlight=false; if(btn) btn.disabled=false; showLoading(false); return;
  }

  const id = fd.get('id');
  try {
    if (id) {
      const { error } = await sb.from('ingresos').update(payload).eq('id', id);
      if (error) throw error;
      APP_STATE.data.ingresos = APP_STATE.data.ingresos.map(i => i.id===id ? {...i,...payload} : i);
    } else {
      const { data, error } = await sb.from('ingresos').insert(payload).select().single();
      if (error) throw error;
      APP_STATE.data.ingresos.unshift(data);
    }
    showAlert('Ingreso guardado','success');
    closeModal('incomeModal');
    loadIncomes();
    updateDashboard();
  } catch(err) {
    showAlert(err.message||'Error al guardar','error');
  } finally {
    showLoading(false);
    if (btn) btn.disabled = false;
    incomeSaveInFlight = false;
  }
}

// =========================================================
// SAVE EXPENSE
// =========================================================
async function saveExpense() {
  if (expenseSaveInFlight) return;
  expenseSaveInFlight = true;
  const btn = $('#saveExpenseBtn');
  if (btn) btn.disabled = true;
  showLoading(true);

  const form = $('#expenseForm');
  if (!form) { expenseSaveInFlight=false; showLoading(false); return; }

  const fd = new FormData(form);
  const descripcion  = (form.querySelector('[name="descripcion"]')?.value||'').trim();
  const montoTotal   = parseMoney(fd.get('monto'));
  const fecha        = fd.get('fecha');
  const categoria    = fd.get('categoria')||'';
  const tipo         = fd.get('tipo')||'variable';
  const metodo_pago  = fd.get('metodo_pago')||'cash';
  const tarjeta_id   = fd.get('tarjeta_id')||null;
  const cuotas       = parseInt(fd.get('cuotas')||1);
  const esCompartido = $('#isSharedCheck')?.checked || false;
  const partnerId = esCompartido 
  ? ($('#sharedWithSelect')?.value || APP_STATE.partner?.id || null) 
  : null;
  const porcentajeRaw = $('#sharedPercentageSelect')?.value;
  const quienPago = esCompartido ? ($('#yoPagueCheck')?.checked ? 'yo' : 'pareja') : 'yo';
  const porcentaje = esCompartido ? (porcentajeRaw !== null && porcentajeRaw !== '' ? parseInt(porcentajeRaw) : 50) : 100;

  if (!descripcion || !montoTotal || !fecha) {
    showAlert('Completa descripción, monto y fecha','warning');
    expenseSaveInFlight=false; if(btn) btn.disabled=false; showLoading(false); return;
  }

  const payload = {
    user_id: APP_STATE.user.id,
    descripcion,
    monto: montoTotal,
    fecha,
    categoria,
    tipo,
    metodo_pago,
    tarjeta_id: tarjeta_id || null,
    cuotas,
    cuota_actual: 1,
    monto_total: cuotas > 1 ? montoTotal : null,
    es_compartido: esCompartido,
    partner_id: partnerId || null,
    porcentaje_usuario: porcentaje,
    quien_pago: quienPago
  };

  if (cuotas > 1 && (tipo==='credito'||tipo==='credit')) {
    payload.monto = round2(montoTotal / cuotas);
    payload.monto_total = montoTotal;
  }
  // Para compartidos, el monto guardado es el total (no tu parte)
  // La parte de cada uno se calcula al mostrar según porcentaje_usuario

  const id = fd.get('id');
  try {
    if (id) {
      const { error } = await sb.from('gastos').update(payload).eq('id', id);
      if (error) throw error;
      APP_STATE.data.gastos = APP_STATE.data.gastos.map(g => g.id===id ? {...g,...payload} : g);
    } else {
      const { data, error } = await sb.from('gastos').insert(payload).select().single();
      if (error) throw error;
      APP_STATE.data.gastos.unshift(data);
    }
    showAlert('Gasto guardado','success');
    closeModal('expenseModal');
    renderExpenses();
    updateDashboard();
  } catch(err) {
    showAlert(err.message||'Error al guardar','error');
  } finally {
    showLoading(false);
    if (btn) btn.disabled = false;
    expenseSaveInFlight = false;
  }
}

// =========================================================
// SAVE CARD
// =========================================================
async function saveCard() {
  const form = $('#cardForm');
  if (!form) return;
  showLoading(true);

  const fd = new FormData(form);
  const payload = {
    user_id:        APP_STATE.user.id,
    banco:          (fd.get('banco')||'').trim(),
    ultimos_4:      (fd.get('ultimos_4')||'').trim(),
    limite_credito: toNumber(fd.get('limite_credito')),
    dia_cierre:     parseInt(fd.get('dia_cierre')||15),
    dia_vencimiento:parseInt(fd.get('dia_vencimiento')||5),
    tipo:           fd.get('tipo')||'visa'
  };

  if (!payload.banco) { showAlert('Indicá el banco','warning'); showLoading(false); return; }
  if (payload.ultimos_4 && !/^\d{4}$/.test(payload.ultimos_4)) { showAlert('Los últimos 4 deben ser 4 dígitos','warning'); showLoading(false); return; }

  const id = fd.get('id');
  try {
    if (id) {
      const { error } = await sb.from('tarjetas').update(payload).eq('id', id);
      if (error) throw error;
      APP_STATE.data.tarjetas = APP_STATE.data.tarjetas.map(c => c.id===id ? {...c,...payload} : c);
    } else {
      const { data, error } = await sb.from('tarjetas').insert(payload).select().single();
      if (error) throw error;
      APP_STATE.data.tarjetas.push(data);
    }
    showAlert('Tarjeta guardada','success');
    closeModal('cardModal');
    loadCards();
  } catch(err) {
    showAlert(err.message||'Error al guardar tarjeta','error');
  } finally { showLoading(false); }
}

// =========================================================
// DELETE FUNCTIONS
// =========================================================
async function deleteIncome(id) {
  if (!confirm('¿Eliminar este ingreso?')) return;
  showLoading(true);
  try {
    const { error } = await sb.from('ingresos').delete().eq('id', id);
    if (error) throw error;
    APP_STATE.data.ingresos = APP_STATE.data.ingresos.filter(i=>i.id!==id);
    showAlert('Ingreso eliminado','success');
    loadIncomes(); updateDashboard();
  } catch(err) { showAlert(err.message||'Error','error'); }
  finally { showLoading(false); }
}

async function deleteExpense(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  showLoading(true);
  try {
    const { error } = await sb.from('gastos').delete().eq('id', id);
    if (error) throw error;
    APP_STATE.data.gastos = APP_STATE.data.gastos.filter(g=>g.id!==id);
    showAlert('Gasto eliminado','success');
    renderExpenses(); updateDashboard();
    if (APP_STATE.currentSection==='shared') loadSharedSection();
  } catch(err) { showAlert(err.message||'Error','error'); }
  finally { showLoading(false); }
}

async function deleteCard(id) {
  if (!confirm('¿Eliminar esta tarjeta?')) return;
  showLoading(true);
  try {
    const { error } = await sb.from('tarjetas').delete().eq('id', id);
    if (error) throw error;
    APP_STATE.data.tarjetas = APP_STATE.data.tarjetas.filter(c=>c.id!==id);
    showAlert('Tarjeta eliminada','success');
    loadCards();
  } catch(err) { showAlert(err.message||'Error','error'); }
  finally { showLoading(false); }
}

// =========================================================
// INVITATIONS / PARTNER SYSTEM
// =========================================================
async function sendInvite() {
  const email = $('#partnerEmail')?.value?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAlert('Email inválido','warning'); return; }
  if (normEmail(email) === normEmail(APP_STATE.user?.email||'')) { showAlert('No puedes invitarte a Tu mismo','warning'); return; }

  showLoading(true);
  try {
    const { data, error } = await sb.from('invitaciones')
      .insert({ from_user_id: APP_STATE.user.id, to_email: normEmail(email) })
      .select().single();
    if (error) throw error;
    APP_STATE.data.invitaciones.unshift(data);
    showAlert(`Invitación enviada. Código: ${data.code}`, 'success', 8000);
    closeModal('inviteModal');
    await loadInvitesNoPartnerUI_();
  } catch(err) {
    showAlert(err.message||'Error al enviar invitación','error');
  } finally { showLoading(false); }
}

async function acceptInvite() {
  const code = ($('#inviteCode')?.value||'').trim().toUpperCase();
  if (!code) { showAlert('Ingresa el código','warning'); return; }

  // Find matching invitation
  const inv = APP_STATE.data.invitaciones.find(i => i.code===code && i.status==='pending');
  if (!inv) {
    // Try fetching directly
    const { data } = await sb.from('invitaciones').select('*').eq('code', code).eq('status','pending').single();
    if (!data) { showAlert('Código no válido o ya usado','warning'); return; }
    await processAcceptInvite(data);
  } else {
    await processAcceptInvite(inv);
  }
}

async function acceptInviteById(invId) {
  showLoading(true);
  try {
    const inv = APP_STATE.data.invitaciones.find(i=>i.id===invId);
    if (!inv) throw new Error('Invitación no encontrada');
    await processAcceptInvite(inv);
  } catch(err) {
    showAlert(err.message||'Error','error');
  } finally { showLoading(false); }
}

async function processAcceptInvite(inv) {
  showLoading(true);
  try {
    const myId = APP_STATE.user.id;

    // Update invitation status
    const { error: e1 } = await sb.from('invitaciones').update({ status:'accepted' }).eq('id', inv.id);
    if (e1) throw e1;

    // Link both users
    const { error: e2 } = await sb.from('profiles').update({ partner_id: inv.from_user_id }).eq('id', myId);
    if (e2) throw e2;
    const { error: e3 } = await sb.from('profiles').update({ partner_id: myId }).eq('id', inv.from_user_id);
    if (e3) throw e3;

    showAlert('¡Cuentas vinculadas exitosamente!','success', 5000);
    closeModal('acceptInviteModal');
    await loadAll();
    loadSharedSection();
  } catch(err) {
    showAlert(err.message||'Error al vincular cuentas','error');
  } finally { showLoading(false); }
}

// =========================================================
// FILTERS SETUP
// =========================================================
function setupFilters() {
  // Expense filters
  $('#applyExpensePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.expenses.month    = $('#expenseMonthSelect')?.value || '';
    APP_STATE.filters.expenses.year     = $('#expenseYearSelect')?.value  || '';
    APP_STATE.filters.expenses.category = $('#expenseFilter')?.value      || 'all';
    renderExpenses();
  });
  $('#clearExpensePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.expenses = { tipo:'all', category:'all', month:'', year:'' };
    if ($('#expenseMonthSelect')) $('#expenseMonthSelect').value = '';
    if ($('#expenseYearSelect'))  $('#expenseYearSelect').value  = new Date().getFullYear();
    renderExpenses();
  });

  $$('#expenseTabs .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#expenseTabs .tab').forEach(b => b.classList.remove('border-primary','text-primary'));
      btn.classList.add('border-primary','text-primary');
      APP_STATE.filters.expenses.tipo = btn.dataset.tab || 'all';
      renderExpenses();
    });
  });

  // Income filters
  $('#applyIncomePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.incomes.month = $('#incomeMonthSelect')?.value || '';
    APP_STATE.filters.incomes.year  = $('#incomeYearSelect')?.value  || '';
    loadIncomes();
  });
  $('#clearIncomePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.incomes = { month:'', year:'' };
    loadIncomes();
  });
}

// =========================================================
// EXPORT DATA
// =========================================================
function exportData() {
  const data = {
    ingresos: APP_STATE.data.ingresos,
    gastos:   APP_STATE.data.gastos,
    tarjetas: APP_STATE.data.tarjetas,
    fecha_exportacion: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `financeapp_export_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

// =========================================================
// ESCANEAR TICKET CON IA
// =========================================================
async function scanTicketWithAI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const mediaType = file.type || 'image/jpeg';

      try {
        showToast('Analizando ticket...', 'info', 4000);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType, data: base64 }
                },
                {
                  type: 'text',
                  text: `Analizá este ticket de compra y extraé la información.
Respondé SOLO con un JSON sin markdown, con estos campos:
{
  "descripcion": "nombre del local o producto principal",
  "monto": número sin puntos ni comas (ej: 21599.20),
  "fecha": "YYYY-MM-DD",
  "categoria": "una de: Alimentación, Transporte, Vivienda, Salud, Entretenimiento, Ropa, Educación, Servicios, Otros",
  "metodo_pago": "cash | debit | credit | transfer",
  "cuotas": número entero (1 si no hay cuotas)
}`
                }
              ]
            }]
          })
        });

        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fillExpenseFormFromTicket(ticket) {
  const form = $('#expenseForm');
  if (!form) return;

  if (ticket.descripcion) form.querySelector('[name="descripcion"]').value = ticket.descripcion;
  if (ticket.monto)       form.querySelector('[name="monto"]').value       = ticket.monto;
  if (ticket.fecha)       form.querySelector('[name="fecha"]').value        = ticket.fecha;
  if (ticket.metodo_pago) form.querySelector('[name="metodo_pago"]').value  = ticket.metodo_pago;

  // Categoría
  if (ticket.categoria) {
    const catSel = $('#expenseCategorySelect');
    if (catSel) {
      const opt = Array.from(catSel.options).find(o => o.value === ticket.categoria);
      if (opt) catSel.value = ticket.categoria;
    }
  }

  // Cuotas
  if (ticket.cuotas && ticket.cuotas > 1) {
    const cuotasInput = $('#cuotasInput');
    if (cuotasInput) {
      cuotasInput.value = ticket.cuotas;
      const preview = $('#cuotaPreview');
      const label   = $('#cuotaMensual');
      if (preview && label) {
        label.textContent = fmtMoney(round2(ticket.monto / ticket.cuotas));
        preview.classList.remove('hidden');
      }
    }
  }

  // Si es crédito, mostrar campos de tarjeta
  if (ticket.metodo_pago === 'credit') {
    form.querySelector('[name="tipo"]').value = 'credito';
    $('#creditCardFields')?.classList.remove('hidden');
  }

  showToast('✅ Ticket cargado correctamente', 'success');
}

// =========================================================
// WIRE UI
// =========================================================
function wireUI() {
  // Auth
  $('#quickLoginBtn')?.addEventListener('click', handleQuickLogin);
  $('#quickPassword')?.addEventListener('keydown', e => { if(e.key==='Enter') handleQuickLogin(); });
  $('#registerBtn')?.addEventListener('click', handleRegister);

  $('#registerLink')?.addEventListener('click', e => { e.preventDefault(); $('#registerSection')?.classList.toggle('hidden'); });
  $('#loginLink')?.addEventListener('click',    e => { e.preventDefault(); $('#registerSection')?.classList.add('hidden'); });

  // Nav
  $$('.nav-item[data-section]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const section = a.dataset.section;
      showSection(section);
      if (window.innerWidth < 1024) {
        $('#sidebar')?.classList.remove('active');
        $('#sidebarOverlay')?.classList.add('hidden');
      }
    });
  });

  // Logout
  $('#logoutBtn')?.addEventListener('click', e => { e.preventDefault(); logout(); });

  // Theme
  $('#themeToggle')?.addEventListener('click', toggleTheme);

  // Notifications
  $('#notificationBell')?.addEventListener('click', toggleNotifications);
  $('#markAllReadBtn')?.addEventListener('click', markAllNotificationsAsRead);

  // Income
  $('#addIncomeBtn')?.addEventListener('click', () => openIncomeModal());
  $('#saveIncomeBtn')?.addEventListener('click', saveIncome);

  // Expense
  $('#addExpenseBtn')?.addEventListener('click', () => openExpenseModal());
  $('#saveExpenseBtn')?.addEventListener('click', saveExpense);

  // Escanear ticket
  $('#scanTicketBtn')?.addEventListener('click', () => {
    $('#ticketImageInput')?.click();
  });

  $('#ticketImageInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showLoading(true);
    try {
      const ticket = await scanTicketWithAI(file);
      fillExpenseFormFromTicket(ticket);
    } catch (err) {
      showToast('No se pudo leer el ticket. Completá manualmente.', 'warning');
      console.error(err);
    } finally {
      showLoading(false);
      e.target.value = '';
    }
  });

  // Expense tipo selector → show/hide credit fields
  const tipoSel = $('[name="tipo"]', $('#expenseForm'));
  tipoSel?.addEventListener('change', () => {
    const isCredit = tipoSel.value==='credito' || tipoSel.value==='credit';
    $('#creditCardFields')?.classList.toggle('hidden', !isCredit);
  });

  // Cuotas → preview
  $('#cuotasInput')?.addEventListener('input', () => {
    const monto  = parseMoney($('[name="monto"]', $('#expenseForm'))?.value);
    const cuotas = parseInt($('#cuotasInput')?.value||1);
    const preview = $('#cuotaPreview');
    const label   = $('#cuotaMensual');
    if (cuotas>1 && monto>0 && preview && label) {
      label.textContent = fmtMoney(round2(monto/cuotas));
      preview.classList.remove('hidden');
    } else {
      preview?.classList.add('hidden');
    }
  });

  // Checkbox compartido
  $('#isSharedCheck')?.addEventListener('change', e => {
    $('#sharedFields')?.classList.toggle('hidden', !e.target.checked);
  });

  // Cards
  $('#addCardBtn')?.addEventListener('click', () => openCardModal());
  $('#saveCardBtn')?.addEventListener('click', saveCard);

  // Invite partner
  $('#invitePartnerBtn')?.addEventListener('click', () => openModal('inviteModal'));
  $('#acceptInviteBtn')?.addEventListener('click', () => openModal('acceptInviteModal'));
  $('#sendInviteBtn')?.addEventListener('click', sendInvite);
  $('#acceptInviteConfirmBtn')?.addEventListener('click', acceptInvite);

  // Shared add button
  $('#addSharedExpenseBtn')?.addEventListener('click', () => openExpenseModal());

  // Settings
  $('#saveProfileBtn')?.addEventListener('click', saveProfile);
  $('#changePasswordBtn')?.addEventListener('click', changePassword);
  $('#addCategoryBtn')?.addEventListener('click', addCategoryPrompt);
  $('#exportDataBtn')?.addEventListener('click', exportData);

  // Delegate acceptInvite buttons in invites list
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="acceptInvite"]');
    if (btn) acceptInviteById(btn.dataset.inviteId);
  });

  setupModals();
  setupFilters();
  initYearSelects();
}

// =========================================================
// REAL-TIME SUBSCRIPTION (gastos compartidos)
// =========================================================
function setupRealtime() {
  const uid = APP_STATE.user?.id;
  if (!uid) return;

  sb.channel('gastos-shared')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'gastos', filter:`partner_id=eq.${uid}` },
      payload => {
        APP_STATE.data.gastos.unshift(payload.new);
        updateDashboard();
        updateNotifications();
        if (APP_STATE.currentSection==='shared') loadSharedSection();
        if (APP_STATE.currentSection==='expenses') renderExpenses();
        showToast('Tu pareja cargó un nuevo gasto compartido','info');
      }
    )
    .subscribe();
}

// =========================================================
// INIT
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  const themeIcon = $('#themeToggle i');
  if (themeIcon) themeIcon.className = savedTheme==='dark' ? 'fas fa-sun' : 'fas fa-moon';

  initSidebar();
  wireUI();

  let realtimeInitialized = false;

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event==='SIGNED_IN' && session?.user) {
      if (!APP_STATE.user) {
        APP_STATE.user = session.user;
        showMainApp();
        if (!realtimeInitialized) {
          realtimeInitialized = true;
          setupRealtime();
        }
      }
    } else if (event==='SIGNED_OUT') {
      APP_STATE.user = null;
      showLogin();
    }
  });

  await restoreUser();
  if (APP_STATE.user && !realtimeInitialized) {
    realtimeInitialized = true;
    setupRealtime();
  }
});
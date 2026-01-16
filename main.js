

// =========================
// Toast helper (sin dependencia)
// =========================
function ensureToastContainer_() {
  let c = document.getElementById('toastContainer');
  if (c) return c;
  c = document.createElement('div');
  c.id = 'toastContainer';
  c.style.position = 'fixed';
  c.style.top = '16px';
  c.style.right = '16px';
  c.style.zIndex = '99999';
  c.style.display = 'flex';
  c.style.flexDirection = 'column';
  c.style.gap = '10px';
  document.body.appendChild(c);
  return c;
}

function showToast(message, type = 'info', ms = 2800) {
  try {
    const container = ensureToastContainer_();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.style.padding = '10px 12px';
    el.style.borderRadius = '12px';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,.12)';
    el.style.fontSize = '13px';
    el.style.maxWidth = '320px';
    el.style.background = '#111827';
    el.style.color = '#fff';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    el.style.transition = 'all .18s ease';
    if (type === 'success') el.style.background = '#065f46';
    if (type === 'warning') el.style.background = '#92400e';
    if (type === 'error') el.style.background = '#7f1d1d';
    el.textContent = message || '';
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 220);
    }, ms);
  } catch (e) {
    alert(message);
  }
}
/* =========================================================
   FinanceApp - main.js CONECTADO AL BACKEND REAL
   ========================================================= */

const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwTgIbfHXI_7qK2d0r-G5a3QdiRxjn72vWuF_et1nZ9vPL18O8B8PuRLrAdyGSTOEpPgQ/exec',
  
  DEFAULT_CURRENCY: 'ARS',
  NOTIF_POLL_MS: 30000,
  DEBUG: false,
  USE_FALLBACK: false
};

// Bloqueo anti doble-click (evita duplicados por clicks repetidos / lag)
let incomeSaveInFlight = false;
let expenseSaveInFlight = false;

// 🚀 FUNCIONES BÁSICAS
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Escapa HTML para evitar inyección al renderizar texto proveniente del backend
function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

// Normaliza emails (trim + lowercase). Devuelve "" si viene null/undefined.
function normEmail(email) {
  return (email || "").toString().trim().toLowerCase();
}

// =========================================================
// META helpers para GASTOS_COMPARTIDOS (sin tocar Code.gs)
// Guardamos info extra (crédito/cuotas/tarjeta) dentro de la columna "estado" como: META:{...}
// =========================================================
function buildSharedMeta(meta) {
  try {
    const clean = {};
    Object.keys(meta || {}).forEach(k => {
      const v = meta[k];
      if (v !== undefined && v !== null && v !== '') clean[k] = v;
    });
    return 'META:' + JSON.stringify(clean);
  } catch {
    return '';
  }
}

function parseSharedMeta(estado) {
  try {
    if (!estado) return null;
    const s = String(estado).trim();
    if (!s.toUpperCase().startsWith('META:')) return null;
    const jsonStr = s.slice(5).trim();
    if (!jsonStr) return null;
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}


function filterSharedForUser_(sharedRows, userEmail) {
  const me = normEmail(userEmail);
  const rows = Array.isArray(sharedRows) ? sharedRows : [];
  const filtered = rows.filter(r => {
    const a = normEmail(r.email_usuario);
    const b = normEmail(r.email_pareja);
    return (a && a === me) || (b && b === me);
  });

  // Dedupe: if mirror exists, prefer the row where email_usuario == me
  const map = new Map();
  const score = (r) => (normEmail(r.email_usuario) === me ? 2 : 1);

  filtered.forEach(r => {
    const meta = parseSharedMeta(r.estado) || {};
    const key = [
      String(r.descripcion || '').trim().toLowerCase(),
      String(r.fecha || '').trim(),
      String(Number(r.monto || 0)),
      String(r.categoria || '').trim().toLowerCase(),
      String(meta.cuota_actual || r.cuota_actual || ''),
      String(meta.cuotas_totales || r.cuotas_totales || ''),
      String(meta.tarjeta_id || r.tarjeta_id || ''),
      String(meta.monto_total || r.monto_total || '')
    ].join('|');

    const prev = map.get(key);
    if (!prev || score(r) > score(prev)) map.set(key, r);
  });

  return Array.from(map.values());
}

function filterSharedForPair_(sharedRows, emailA, emailB) {
  const a = normEmail(emailA);
  const b = normEmail(emailB);
  const rows = Array.isArray(sharedRows) ? sharedRows : [];
  return rows.filter(r => {
    const u = normEmail(r.email_usuario);
    const p = normEmail(r.email_pareja);
    return (u === a && p === b) || (u === b && p === a);
  });
}

function isMobile() {
  return window.matchMedia('(max-width: 1023px)').matches;
}





// Helper para mostrar alerts
function showAlert(msg, type = 'info', timeout = 3500) {
  const container = $('#alertsContainer') || (() => {
    const div = document.createElement('div');
    div.id = 'alertsContainer';
    div.className = 'fixed top-20 right-4 z-50 w-96 space-y-2';
    document.body.appendChild(div);
    return div;
  })();

  const id = 'alert_' + Date.now();
  const cls = type === 'danger' ? 'alert alert-danger' :
              type === 'success' ? 'alert alert-success' :
              type === 'warning' ? 'alert alert-warning' : 'alert alert-info';
  
  const html = `<div id="${id}" class="${cls} animate-fade-in">
    <i class="fas fa-circle-info"></i><div>${msg}</div>
  </div>`;
  
  container.insertAdjacentHTML('afterbegin', html);
  
  if (timeout) setTimeout(() => $(`#${id}`)?.remove(), timeout);
}

// Helper para formatear dinero
// ===============================
// Dashboard Filters
// ===============================
function getDashboardFilters_() {
  const monthSel = document.getElementById('dashMonth');
  const yearSel = document.getElementById('dashYear');
  const catSel = document.getElementById('dashCategory');
  const scopeSel = document.getElementById('dashScope');
  return {
    month: monthSel ? (monthSel.value || 'current') : 'current',
    year: yearSel ? (yearSel.value || 'current') : 'current',
    category: catSel ? (catSel.value || 'all') : 'all',
    scope: scopeSel ? (scopeSel.value || 'all') : 'all'
  };
}

function setupDashboardFilters_() {
  const monthSel = document.getElementById('dashMonth');
  const yearSel = document.getElementById('dashYear');
  const catSel = document.getElementById('dashCategory');
  const scopeSel = document.getElementById('dashScope');
  if (!monthSel || !yearSel || !catSel || !scopeSel) return;

  // Populate months
  const months = [
    {v:'current', t:'Mes actual'}, {v:'01',t:'Enero'},{v:'02',t:'Febrero'},{v:'03',t:'Marzo'},{v:'04',t:'Abril'},
    {v:'05',t:'Mayo'},{v:'06',t:'Junio'},{v:'07',t:'Julio'},{v:'08',t:'Agosto'},{v:'09',t:'Septiembre'},
    {v:'10',t:'Octubre'},{v:'11',t:'Noviembre'},{v:'12',t:'Diciembre'}
  ];
  monthSel.innerHTML = months.map(m=>`<option value="${m.v}">${m.t}</option>`).join('');

  // Populate years from data
  const allDates = []
    .concat((APP_STATE.data.ingresos||[]).map(x=>x.fecha))
    .concat((APP_STATE.data.gastos||[]).map(x=>x.fecha))
    .concat((APP_STATE.data.gastos_compartidos||[]).map(x=>x.fecha))
    .filter(Boolean);
  const yearsSet = new Set();
  allDates.forEach(d=>{
    const y = new Date(d).getFullYear();
    if (y && !isNaN(y)) yearsSet.add(y);
  });
  const nowY = new Date().getFullYear();
  yearsSet.add(nowY);
  const years = Array.from(yearsSet).sort((a,b)=>b-a);
  yearSel.innerHTML = ['<option value="current">Año actual</option>']
    .concat(years.map(y=>`<option value="${y}">${y}</option>`))
    .join('');

  // Categories from expenses
  const catsSet = new Set();
  (APP_STATE.data.gastos||[]).forEach(g=>{ if(g.categoria) catsSet.add(g.categoria); });
  (APP_STATE.data.gastos_compartidos||[]).forEach(g=>{ if(g.categoria) catsSet.add(g.categoria); });
  const cats = Array.from(catsSet).sort((a,b)=>a.localeCompare(b));
  catSel.innerHTML = ['<option value="all">Todas las categorías</option>']
    .concat(cats.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`))
    .join('');

  scopeSel.innerHTML = [
    '<option value="all">Gastos: Todos</option>',
    '<option value="own">Gastos: Propios</option>',
    '<option value="shared">Gastos: Compartidos</option>'
  ].join('');

  const onChange = ()=>{ updateDashboard(); };
  monthSel.onchange = onChange;
  yearSel.onchange = onChange;
  catSel.onchange = onChange;
  scopeSel.onchange = onChange;
}

function parseAmount(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;

  let s = String(v).trim();
  if (!s) return 0;

  s = s.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  
  if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1);
  
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot) {
    s = s.replace(',', '.');
  }

  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function fmtMoney(v) {
  const cur = APP_STATE.user?.currency || 'ARS';
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat('es-AR', { 
      style: 'currency', 
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}


// ==============================
// Helpers: fechas / meses / ciclos
// ==============================
const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function pad2(n){ return String(n).padStart(2,'0'); }

function toYM(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}`;
}

function ymToLabel(ym){
  const [y,m] = ym.split('-').map(Number);
  return `${MONTHS_ES[m-1]} ${y}`;
}

function daysInMonth(y,m){ // m: 1-12
  return new Date(y, m, 0).getDate();
}

function clampDay(y,m,day){
  return Math.min(Math.max(1, day), daysInMonth(y,m));
}

function makeDate(y,m,day){
  return new Date(y, m-1, clampDay(y,m,day), 12, 0, 0, 0);
}

function addMonthsToYM(ym, add){
  const [y0,m0] = ym.split('-').map(Number);
  let y=y0, m=m0+add;
  while (m>12){ m-=12; y++; }
  while (m<1){ m+=12; y--; }
  return `${y}-${pad2(m)}`;
}

function sameYM(date, ym){
  return toYM(date) === ym;
}

// Key local para cierres por mes
function cyclesStorageKey(){
  const email = APP_STATE?.user?.email || 'anon';
  return `financeapp_card_cycles_v2_${email}`;
}

function getCycleOverrides(){
  try{
    const raw = localStorage.getItem(cyclesStorageKey());
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  }catch(e){
    return {};
  }
}

function saveCycleOverrides(obj){
  try{
    localStorage.setItem(cyclesStorageKey(), JSON.stringify(obj || {}));
  }catch(e){}
}

// Devuelve {closeDate: Date, dueDate: Date} para una tarjeta y un ym (mes de cierre)
function getCloseInfoForMonth(card, ym){
  const overrides = getCycleOverrides();
  const cardId = String(card?.id ?? card?.tarjeta_id ?? card?.ID ?? '');
  const monthOverride = overrides?.[cardId]?.[ym];
  if (monthOverride && monthOverride.close && monthOverride.due){
    return { closeDate: new Date(monthOverride.close), dueDate: new Date(monthOverride.due) };
  }

  // default: cierre en ese mes, vencimiento al mes siguiente
  const [y,m] = ym.split('-').map(Number);
  const diaCierre = parseInt(card?.dia_cierre ?? card?.cierre_dia ?? 1, 10) || 1;
  const diaVenc = parseInt(card?.dia_vencimiento ?? card?.dia_vencimiento ?? card?.vencimiento_dia ?? 1, 10) || 1;

  const closeDate = makeDate(y, m, diaCierre);
  const dueYM = addMonthsToYM(ym, 1);
  const [y2,m2] = dueYM.split('-').map(Number);
  const dueDate = makeDate(y2, m2, diaVenc);
  return { closeDate, dueDate };
}

// Para una compra (fecha) devuelve el mes de cierre que le corresponde
function getStatementCloseYM(purchaseDate, card){
  const d = (purchaseDate instanceof Date) ? purchaseDate : new Date(purchaseDate);
  const ym = toYM(d);
  const infoThis = getCloseInfoForMonth(card, ym);
  // si compra luego del cierre, cae al próximo cierre
  if (d.getTime() > infoThis.closeDate.getTime()){
    return addMonthsToYM(ym, 1);
  }
  return ym;
}

// Expande una compra en cuotas a pagos mensuales según cierres/vencimientos
function buildInstallmentSchedule({purchaseDate, card, cuotasTotales, montoTotal, descripcion, baseItem, miParte, parejaParte}){
  const schedule = [];
  const totalCuotas = Math.max(1, parseInt(cuotasTotales, 10) || 1);
  const total = parseAmount(montoTotal);
  const cuotaMonto = (totalCuotas > 0) ? (total / totalCuotas) : total;
  const firstCloseYM = getStatementCloseYM(purchaseDate, card);

  for (let i=0;i<totalCuotas;i++){
    const cuotaN = i+1;
    const closeYM = addMonthsToYM(firstCloseYM, i);
    const {closeDate, dueDate} = getCloseInfoForMonth(card, closeYM);
    const pendiente = Math.max(0, total - cuotaMonto*cuotaN);

    schedule.push({
      ...baseItem,
      descripcion,
      tipo: 'credit',
      fecha: dueDate.toISOString(),
      dueDate,
      closeDate,
      closeYM,
      cardId: String(card?.id ?? ''),
      banco: card?.banco || '',
      total: cuotaMonto,
      mi_parte: miParte != null ? (parseAmount(miParte) / totalCuotas) : cuotaMonto,
      pareja: parejaParte != null ? (parseAmount(parejaParte) / totalCuotas) : 0,
      cuotaN,
      cuotasTotales: totalCuotas,
      pendiente,
      observaciones_extra: `Cuota ${cuotaN}/${totalCuotas} • Pendiente: ${fmtMoney(pendiente)}`
    });
  }
  return schedule;
}

// Helper para iniciales
function initials(nameOrEmail = '') {
  const s = String(nameOrEmail).trim();
  if (!s) return 'U';
  if (s.includes('@')) return s.split('@')[0].slice(0, 2).toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0] || 'U')[0] + (parts[1] || parts[0] || 'U')[0]).toUpperCase();
}

// Helper para escapar HTML
function escapeHtml(s = '') {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Helper: email de la pareja vinculada (si existe)
function getPartnerEmail() {
  // 1) Prefer explicit selection in the expense modal (if present)
  const sel = document.getElementById('sharedWithSelect');
  const other = document.getElementById('sharedWithOtherEmail');
  if (sel) {
    const v = String(sel.value || '').trim();
    if (v === '__other__') {
      const oe = other ? String(other.value || '').trim() : '';
      if (oe) return oe.toLowerCase();
    } else if (v) {
      return v.toLowerCase();
    }
  }

  // 2) Fallback to linked partner in state
  const email = (
    (APP_STATE && APP_STATE.partner && APP_STATE.partner.email) ||
    (APP_STATE && APP_STATE.pareja && (APP_STATE.pareja.email || APP_STATE.pareja.email_pareja)) ||
    (APP_STATE && APP_STATE.data && APP_STATE.data.pareja && (APP_STATE.data.pareja.email || APP_STATE.data.pareja.email_pareja))
  );
  return email ? String(email).trim().toLowerCase() : '';
}


function refreshSharedWithOptions_() {
  const sel = document.getElementById('sharedWithSelect');
  const other = document.getElementById('sharedWithOtherEmail');
  if (!sel) return;

  const current = String(sel.value || '').trim();

  // Reset options
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Seleccionar...';
  sel.appendChild(opt0);

  const partner = getPartnerEmail();
  if (partner) {
    const optP = document.createElement('option');
    optP.value = partner;
    optP.textContent = partner;
    sel.appendChild(optP);
  }

  const optOther = document.createElement('option');
  optOther.value = '__other__';
  optOther.textContent = 'Otro email...';
  sel.appendChild(optOther);

  // Restore selection
  if (current) sel.value = current;

  // Show/hide other input
  if (other) {
    const isOther = sel.value === '__other__';
    other.classList.toggle('hidden', !isOther);
  }

  sel.onchange = () => {
    if (!other) return;
    const isOther = sel.value === '__other__';
    other.classList.toggle('hidden', !isOther);
    if (isOther) other.focus();
  };
}

// Helper para setear texto
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Helper para fecha formateada
function formatDate(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// =========================================================
// SERVICIO API REAL (JSONP - GitHub compatible)
// =========================================================

const APIService = {
  callAPI(action, params = {}) {
    return new Promise((resolve, reject) => {
      const callbackName = 'cb_' + Math.random().toString(36).slice(2);

      const url = new URL(CONFIG.API_URL);
      const allParams = {
        action,
        callback: callbackName,
        ...params,
        timestamp: Date.now()
      };

      const skipUserEmail =
        params && (params.__skipUserEmail === true || params.__skipUserEmail === 'true');

      if (skipUserEmail) {
        delete allParams.__skipUserEmail;
      }

      if (
        APP_STATE.user &&
        APP_STATE.user.email &&
        action !== 'register' &&
        action !== 'login' &&
        !skipUserEmail
      ) {
        if (!('userEmail' in params) || !params.userEmail) {
          allParams.userEmail = APP_STATE.user.email;
        }
      }

      Object.entries(allParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, value);
        }
      });

      console.log('🌐 API Call:', action, params);

      window[callbackName] = (result) => {
        try {
          delete window[callbackName];
          script.remove();

          if (!result.success && result.message && action !== 'login' && action !== 'register') {
            showAlert(result.message, 'warning');
          }

          resolve(result);
        } catch (e) {
          reject(e);
        }
      };

      const script = document.createElement('script');
      script.src = url.toString();
      script.async = true;

      script.onerror = () => {
        delete window[callbackName];
        script.remove();
        showAlert('Error de conexión con el servidor', 'warning');
        reject(new Error('JSONP load error'));
      };

      document.body.appendChild(script);
    });
  },

  // 🔐 Autenticación
  register(email, password, name, currency = 'ARS') {
    return this.callAPI('register', { email, password, name, currency });
  },

  login(email, password) {
    return this.callAPI('login', { email, password });
  },

  // 📊 Datos
  async leer(tabla, filters = {}) {
    if (tabla === 'gastos_compartidos' && !filters.__skipUserEmail) {
      filters.__skipUserEmail = true;
    }
    const result = await this.callAPI('leer', { tabla, ...filters });
    return result.success ? (result.datos || []) : [];
  },

  crear(tabla, data) {
    return this.callAPI('crear', { tabla, ...data });
  },

  actualizar(tabla, id, data) {
    return this.callAPI('actualizar', { tabla, id, ...data });
  },

  eliminar(tabla, id) {
    return this.callAPI('eliminar', { tabla, id });
  },

  // 👥 Parejas
  getPareja() {
    return this.callAPI('get_pareja');
  },

  crearInvitacion(payload) {
    return this.crear('invitacion', payload);
  },

  aceptarInvitacion(invitationId) {
    return this.callAPI('aceptar_invitacion', { invitationId });
  },

  // 🔔 Notificaciones
  async leerNotificaciones() {
    return this.leer('notificaciones', { unread: 'true' });
  },

  marcarTodasLeidas() {
    return this.callAPI('marcar_todas_leidas');
  },

  // ⚙️ Configuración
  actualizarPerfil(data) {
    const user = APP_STATE.user;
    if (!user || !user.id) throw new Error('Usuario no autenticado');
    return this.actualizar('usuarios', user.id, data);
  },

  cambiarPassword(currentPassword, newPassword) {
    return this.callAPI('cambiar_password', { currentPassword, newPassword });
  }
};


// =========================================================
// ESTADO GLOBAL
// =========================================================

const APP_STATE = {
  user: null,
  isDemo: false,
  _registering: false,
  partner: null,
  currentSection: 'dashboard',
  data: {
    categorias: [],
    ingresos: [],
    gastos: [],
    tarjetas: [],
    gastos_compartidos: [],
    notificaciones: []
  },
  charts: { expenses: null, trend: null, category: null },
  filters: {
    incomes: { month: '', year: '' },
    expenses: { month: '', year: '', category: 'all', tipo: 'all' },
    shared: { month: '', year: '', tipo: 'all' },
    projections: { month: '', year: '', tipo: 'all' }
  }
};

// =========================================================
// FUNCIONES DE AUTENTICACIÓN
// =========================================================

function showLoading(show) {
  const loading = $('#loadingOverlay');
  if (loading) loading.classList.toggle('hidden', !show);
}

async function handleQuickLogin() {
  const email = $('#quickEmail')?.value?.trim();
  const password = $('#quickPassword')?.value?.trim();
  
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAlert('Ingresá un email válido', 'warning');
    return;
  }
  
  if (!password) {
    showAlert('Ingresá tu contraseña', 'warning');
    return;
  }
  
  showLoading(true);
  
  try {
    const result = await APIService.login(email, password);
    
    if (result.success && result.user) {
      completeLogin(result.user);
    } else {
      showAlert(result.message || 'Email o contraseña incorrectos', 'danger');
    }
  } catch (err) {
    console.error('Error en login:', err);
    showAlert('Error de conexión con el servidor', 'danger');
  } finally {
    showLoading(false);
  }
}

async function handleRegister(e) {
  try {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    console.log('📝 Registro: handleRegister()');

    if (APP_STATE._registering) {
      console.warn('⚠️ Registro ya en progreso');
      return;
    }
    APP_STATE._registering = true;

    const name = $('#registerName')?.value?.trim();
    const email = $('#registerEmail')?.value?.trim();
    const password = $('#registerPassword')?.value?.trim();
    const confirmPassword = $('#registerConfirmPassword')?.value?.trim();

    console.log('📤 Datos registro:', { name, email });

    if (!name || !email || !password || !confirmPassword) {
      showToast('Completá todos los campos', 'warning');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Ingresá un email válido', 'warning');
      return;
    }

    if (password !== confirmPassword) {
      showToast('Las contraseñas no coinciden', 'warning');
      return;
    }

    if (password.length < 6) {
      showToast('La contraseña debe tener al menos 6 caracteres', 'warning');
      return;
    }

    showLoading(true);

    console.log('🚀 Llamando a API register...');
    const result = await APIService.register(email, password, name);

    console.log('📥 Respuesta register:', result);

    if (result && result.success) {
      showToast('¡Cuenta creada exitosamente! Ahora podés iniciar sesión.', 'success');

      // Volver a login
      $('#registerSection')?.classList.add('hidden');
      $('#loginSection')?.classList.remove('hidden');

      // Limpiar formulario
      ['registerName','registerEmail','registerPassword','registerConfirmPassword']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    } else {
      showToast(result?.message || 'No se pudo crear la cuenta', 'danger');
    }

  } catch (err) {
    console.error('❌ Error en registro:', err);
    showToast('Error registrando cuenta', 'danger');
  } finally {
    APP_STATE._registering = false;
    showLoading(false);
  }
}



function completeLogin(userData, options = {}) {
  const { persist = true, isDemo = false } = options;

  APP_STATE.isDemo = !!isDemo;

  const email = (userData.email || '').toLowerCase().trim();
  const name = userData.nombre || userData.name || (email ? email.split('@')[0] : 'Usuario');

  APP_STATE.user = {
    id: userData.id || ('usr_' + Math.random().toString(36).slice(2)),
    email,
    name,
    currency: userData.moneda || userData.currency || CONFIG.DEFAULT_CURRENCY,
    foto_url: userData.foto_url || '',
    isDemo: APP_STATE.isDemo
  };

  if (persist) {
    localStorage.setItem('financeapp_user', JSON.stringify(APP_STATE.user));
  }

  showMainApp();
  showSection('dashboard');
  showAlert(`¡Bienvenido ${APP_STATE.user.name}!`, 'success');
}

function loginTest() {
  CONFIG.USE_FALLBACK = true;
  completeLogin({ 
    id: 'usr_demo',
    email: 'demo@ejemplo.com',
    nombre: 'Usuario Demo',
    moneda: 'ARS'
  }, { persist: false, isDemo: true });

  showAlert('Modo demo activado (datos locales). Para usar tus datos reales, cerrá sesión e iniciá con tu cuenta.', 'warning');
}

// ===============================
// Invitación desde Login (sin modo prueba)
// ===============================
function toggleInviteActivation_() {
  const box = document.getElementById('inviteActivationSection');
  if (!box) return;
  box.classList.toggle('hidden');
}

async function activateInviteFromLogin_() {
  const email = (document.getElementById('inviteEmail')?.value || '').trim().toLowerCase();
  const code = (document.getElementById('inviteCode')?.value || '').trim().toUpperCase();
  const password = (document.getElementById('invitePassword')?.value || '').trim();

  if (!email || !code || !password) {
    showToast('Completá email, código y contraseña.', 'warning');
    return;
  }

  try {
    // 1) Buscar invitación pendiente para ese email
    const invRes = await APIService.callAPI('leer', {
      tabla: 'invitaciones',
      email_to: email,
      estado: 'pendiente',
      __skipUserEmail: true
    });

    const invs = invRes && invRes.success ? (invRes.datos || []) : [];
    const inv = invs.find(i => String(i.codigo || '').toUpperCase() === code) || invs.find(i => String(i.id || '') === code);
    if (!inv) {
      showToast('No encontré una invitación pendiente con ese código para ese email.', 'error');
      return;
    }

    // 2) Aceptar invitación (esto vincula pareja en backend)
    const acc = await APIService.callAPI('aceptar_invitacion', { invitationId: inv.id, userEmail: email, __skipUserEmail: true });
    if (!acc || !acc.success) {
      showToast(acc?.message || 'No se pudo aceptar la invitación.', 'error');
      return;
    }

    // 3) Crear/actualizar password del usuario invitado
    const setPass = await APIService.callAPI('set_password', { email, password, __skipUserEmail: true });
    if (!setPass || !setPass.success) {
      showToast(setPass?.message || 'No se pudo configurar la contraseña.', 'error');
      return;
    }

    // 4) Login automático
    const login = await APIService.callAPI('login', { email, password, __skipUserEmail: true });
    if (!login || !login.success) {
      showToast(login?.message || 'No se pudo iniciar sesión.', 'error');
      return;
    }

    APP_STATE.user = login.user;
    localStorage.setItem('financeapp_user', JSON.stringify(APP_STATE.user));
    showToast('✅ Invitación activada. ¡Bienvenido!', 'success');

// Notificación en la bandeja del usuario
try {
  await APIService.callAPI('crear', {
    tabla: 'notificaciones',
    titulo: 'Cuenta activada',
    mensaje: 'Tu cuenta fue activada correctamente por el código de invitación.',
    tipo: 'success',
    leida: false
  });
} catch (e) { /* noop */ }

    // Ocultar login y cargar app
    document.getElementById('loginSection')?.classList.add('hidden');
    document.getElementById('appSection')?.classList.remove('hidden');

    await loadAll();
    showSection('dashboard');
  } catch (err) {
    console.error('Error activando invitación desde login:', err);
    showToast('Error activando invitación. Revisá consola.', 'error');
  }
}

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const menuToggle = document.getElementById('menuToggle');

  if (!sidebar || !menuToggle) return;

  // Evitar doble binding
  if (menuToggle.dataset.bound === 'true') return;
  menuToggle.dataset.bound = 'true';

  menuToggle.addEventListener('click', () => {
    if (!isMobile()) return;

    sidebar.classList.add('active');
    overlay?.classList.remove('hidden');
  });

  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('active');
    overlay.classList.add('hidden');
  });

  document.querySelectorAll('#sidebar .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!isMobile()) return;

      sidebar.classList.remove('active');
      overlay?.classList.add('hidden');
    });
  });
}


function showLogin() {
  $('#loginScreen')?.classList.remove('hidden');
  $('#mainApp')?.classList.add('hidden');
}

function showMainApp() {
  $('#loginScreen')?.classList.add('hidden');
  $('#mainApp')?.classList.remove('hidden');

  initSidebar();   // 👈 CLAVE

  updateUserUI();
  initYearSelects();
  loadAll();
}


function updateUserUI() {
  setText('userName', APP_STATE.user?.name || 'Usuario');
  setText('userEmail', APP_STATE.user?.email || '');
  setText('userInitials', initials(APP_STATE.user?.name || APP_STATE.user?.email));
  setText('currencyDisplay', (APP_STATE.user?.currency || CONFIG.DEFAULT_CURRENCY).toUpperCase());
  
  const currencySelect = $('#profileCurrency');
  if (currencySelect) currencySelect.value = APP_STATE.user?.currency || CONFIG.DEFAULT_CURRENCY;
}

function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  localStorage.removeItem('financeapp_user');
  APP_STATE.user = null;
  APP_STATE.partner = null;
  showLogin();
  showAlert('Sesión cerrada exitosamente', 'info');
}

function restoreUser() {
  try {
    const raw = localStorage.getItem('financeapp_user');
    if (!raw) return false;

    const userData = JSON.parse(raw);
    if (!userData || !userData.email) return false;

    const email = String(userData.email).toLowerCase().trim();
    if (email === 'demo@ejemplo.com' || userData.isDemo === true) {
      localStorage.removeItem('financeapp_user');
      return false;
    }

    APP_STATE.user = {
      id: userData.id,
      email,
      name: userData.name || email.split('@')[0],
      currency: userData.currency || CONFIG.DEFAULT_CURRENCY,
      foto_url: userData.foto_url || '',
      isDemo: false
    };
    APP_STATE.isDemo = false;

    console.log('👤 Usuario restaurado:', APP_STATE.user.email);
    return true;
  } catch (err) {
    console.warn('Error restaurando usuario:', err);
    localStorage.removeItem('financeapp_user');
    return false;
  }
}

// =========================================================
// INICIALIZACIÓN Y NAVEGACIÓN
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  wireUI();
  
  if (restoreUser()) {
    showMainApp();
  } else {
    showLogin();
  }
});

function wireUI() {
  console.log('🔧 Inicializando UI...');
  
  // Login/Register
  $('#quickLoginBtn')?.addEventListener('click', handleQuickLogin);
  $('#testLoginBtn')?.addEventListener('click', toggleInviteActivation_);
    $('#activateInviteBtn')?.addEventListener('click', activateInviteFromLogin_);
$('#registerLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('#registerSection')?.classList.remove('hidden');
    $('#registerName')?.focus();
  });
  $('#loginLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    $('#registerSection')?.classList.add('hidden');
  });
  $('#registerBtn')?.addEventListener('click', handleRegister);
  
  // Navegación
  $$('.nav-item[data-section]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const section = a.dataset.section;
      showSection(section);
    });
  });
  


// KPI cards -> navegación rápida
$$('[data-kpi-nav]').forEach(card => {
  card.style.cursor = 'pointer';
  card.addEventListener('click', () => {
    const target = card.getAttribute('data-kpi-nav');
    if (target) showSection(target);
  });
});
  // Logout
  $('#logoutBtn')?.addEventListener('click', logout);
  
  // Menú toggle
  $('#menuToggle')?.addEventListener('click', () => {
    $('#sidebar')?.classList.toggle('active');
  });
  
  // Tema toggle
  $('#themeToggle')?.addEventListener('click', toggleTheme);
  
  // Botones principales
  $('#addIncomeBtn')?.addEventListener('click', () => openIncomeModal());
  $('#addExpenseBtn')?.addEventListener('click', () => openExpenseModal());
  $('#addCardBtn')?.addEventListener('click', () => openCardModal());

  $('#openCyclesBtn')?.addEventListener('click', () => openCyclesModal());
  $('#addSharedExpenseBtn')?.addEventListener('click', () => openSharedExpenseModal());
  
  // Botones de pareja
  $('#invitePartnerBtn')?.addEventListener('click', () => openInviteModal());
  $('#acceptInviteBtn')?.addEventListener('click', () => openAcceptInviteModal());
  $('#settleDebtsBtn')?.addEventListener('click', () => showAlert('Función en desarrollo', 'info'));
  
  // Configuración
  $('#saveProfileBtn')?.addEventListener('click', saveProfile);
  $('#addCategoryBtn')?.addEventListener('click', () => showAlert('Función en desarrollo', 'info'));
  $('#changePasswordBtn')?.addEventListener('click', changePassword);
  $('#exportDataBtn')?.addEventListener('click', exportData);
  $('#clearDataBtn')?.addEventListener('click', clearData);
  $('#exportReportBtn')?.addEventListener('click', () => showAlert('Exportación en desarrollo', 'info'));
  
  // Notificaciones
  $('#notificationBell')?.addEventListener('click', toggleNotifications);
  $('#markAllReadBtn')?.addEventListener('click', markAllNotificationsAsRead);
  
  // Enter en formularios
  $('#quickPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleQuickLogin();
  });
  
  $('#registerPassword')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegister(e);
  });
  
  // Setup filters
  setTimeout(() => {
    setupFilters();
    setupModals();
    refreshSharedWithOptions_();
  }, 100);
  
  console.log('✅ UI inicializada correctamente');
}

function showSection(section) {
  APP_STATE.currentSection = section;
  
  $$('.nav-item[data-section]').forEach(a => {
    a.classList.toggle('active', a.dataset.section === section);
  });
  
  $$('.dashboard').forEach(el => {
    el.classList.add('hidden');
  });
  
  const sectionId = section + 'Section';
  const targetSection = $('#' + sectionId);
  if (targetSection) {
    targetSection.classList.remove('hidden');
  }
  
  console.log('📁 Sección activa:', section);
  
  switch(section) {
    case 'dashboard':
      updateDashboard();
      break;
    case 'incomes':
      loadIncomes();
      break;
    case 'expenses':
      loadExpenses();
      break;
    case 'shared':
      loadSharedSection();
      break;
    case 'cards':
      loadCards();
      break;
    case 'projections':
      loadProjections();
      break;
    case 'reports':
      loadReports();
      break;
    case 'settings':
      loadSettings();
      break;
  }
}

function toggleTheme() {
  const body = document.body;
  const currentTheme = body.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  body.setAttribute('data-theme', newTheme);
  localStorage.setItem('financeapp_theme', newTheme);
  
  const icon = $('#themeToggle i');
  if (icon) icon.className = newTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  
  showAlert(`Tema ${newTheme === 'dark' ? 'oscuro' : 'claro'} activado`, 'info');
}

function toggleNotifications() {
  const panel = $('#notificationsPanel');
  if (panel) panel.classList.toggle('hidden');
}

// =========================================================
// FUNCIONES DE DATOS
// =========================================================

function initYearSelects() {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  // Inicializar todos los selects de año
  $$('.year-select').forEach(select => {
    if (select) {
      let html = '<option value="">Todos</option>';
      for (let y = currentYear - 2; y <= currentYear + 1; y++) {
        html += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
      }
      select.innerHTML = html;
    }
  });
  
  // Inicializar selects de año para proyecciones
  const projectionYearFilter = $('#projectionYearFilter');
  if (projectionYearFilter) {
    let html = '<option value="">Todos los años</option>';
    for (let y = currentYear - 1; y <= currentYear + 1; y++) {
      html += `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`;
    }
    projectionYearFilter.innerHTML = html;
  }


  // Inicializar select de mes para proyecciones (por defecto: mes actual)
  const projectionMonthFilter = $('#projectionMonthFilter');
  if (projectionMonthFilter) {
    const y = parseInt($('#projectionYearFilter')?.value || currentYear, 10) || currentYear;
    let htmlM = `<option value="">Todos los meses</option>`;
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${pad2(m)}`;
      htmlM += `<option value="${ym}">${MONTHS_ES[m-1]}</option>`;
    }
    projectionMonthFilter.innerHTML = htmlM;

    // Seleccionar mes actual si no hay filtro
    const nowYM = `${currentYear}-${pad2(now.getMonth()+1)}`;
    if (!APP_STATE.filters.projections.month) {
      APP_STATE.filters.projections.month = nowYM;
    }
    projectionMonthFilter.value = APP_STATE.filters.projections.month || '';
  }
}

async function loadAll() {
  console.log('📦 Cargando todos los datos...');
  
  showLoading(true);
  
  try {
    const [
      categorias, 
      ingresos, 
      gastos, 
      tarjetas,
      gastosCompartidos,
      notificaciones,
      parejaResult
    ] = await Promise.all([
      APIService.leer('categorias'),
      APIService.leer('ingresos'),
      APIService.leer('gastos'),
      APIService.leer('tarjetas'),
      APIService.leer('gastos_compartidos', { __skipUserEmail: true }),
      APIService.leerNotificaciones(),
      APIService.getPareja()
    ]);
    
    APP_STATE.data.categorias = categorias;
    APP_STATE.data.ingresos = ingresos;
    APP_STATE.data.gastos = gastos;
    APP_STATE.data.tarjetas = tarjetas;
    APP_STATE.data.gastos_compartidos = filterSharedForUser_(gastosCompartidos, APP_STATE.user.email);
    APP_STATE.data.notificaciones = notificaciones;
    APP_STATE.partner = parejaResult.partner || null;
    
    console.log('✅ Datos cargados:', {
      categorias: categorias.length,
      ingresos: ingresos.length,
      gastos: gastos.length,
      tarjetas: tarjetas.length,
      notificaciones: notificaciones.length
    });
    
    updateCategoryUI();
    setupDashboardFilters_();
    updateDashboard();
    updateNotifications();
    
  } catch (err) {
    console.error('Error cargando datos:', err);
    showAlert('Error cargando datos del servidor', 'danger');
  } finally {
    showLoading(false);
  }
}

async function reloadData() {
  console.log('🔄 Recargando datos...');
  showLoading(true);
  
  try {
    await loadAll();
    showAlert('Datos actualizados correctamente', 'success');
  } catch (err) {
    console.error('Error recargando datos:', err);
    showAlert('Error al recargar datos', 'danger');
  } finally {
    showLoading(false);
  }
}

function updateCategoryUI() {
  // Actualizar selects de categoría en ingresos
  const incomeCategorySelect = $('#incomeCategorySelect');
  if (incomeCategorySelect) {
    const cats = APP_STATE.data.categorias?.filter(c => c.tipo === 'income') || [];
    let html = '<option value="">Seleccionar categoría</option>';
    cats.forEach(cat => {
      html += `<option value="${escapeHtml(cat.nombre)}">${escapeHtml(cat.nombre)}</option>`;
    });
    incomeCategorySelect.innerHTML = html;
  }
  
  // Actualizar selects de categoría en gastos
  const expenseCategorySelect = $('#expenseCategorySelect');
  if (expenseCategorySelect) {
    const cats = APP_STATE.data.categorias?.filter(c => c.tipo !== 'income') || [];
    let html = '<option value="">Seleccionar categoría</option>';
    cats.forEach(cat => {
      html += `<option value="${escapeHtml(cat.nombre)}">${escapeHtml(cat.nombre)}</option>`;
    });
    expenseCategorySelect.innerHTML = html;
  }
  
  // Actualizar filtro de categorías
  const expenseFilter = $('#expenseFilter');
  if (expenseFilter) {
    const cats = APP_STATE.data.categorias?.filter(c => c.tipo !== 'income') || [];
    let html = '<option value="all">Todas las categorías</option>';
    cats.forEach(cat => {
      html += `<option value="${escapeHtml(cat.nombre)}">${escapeHtml(cat.nombre)}</option>`;
    });
    expenseFilter.innerHTML = html;
  }
}

function updateNotifications() {
  const notificaciones = APP_STATE.data.notificaciones || [];
  const unreadCount = notificaciones.filter(n => !n.leida).length;
  
  const badge = $('#notificationBadge');
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
  
  const panel = $('#notificationsList');
  if (panel) {
    if (notificaciones.length === 0) {
      panel.innerHTML = `
        <div class="p-4 text-center text-gray-500">
          <i class="fas fa-bell-slash text-2xl mb-2"></i>
          <p>No hay notificaciones</p>
        </div>`;
      return;
    }
    
    let html = '';
    notificaciones.forEach(notif => {
      const tipoIcon = {
        'info': 'fa-info-circle text-blue-500',
        'success': 'fa-check-circle text-green-500',
        'warning': 'fa-exclamation-triangle text-yellow-500',
        'danger': 'fa-exclamation-circle text-red-500'
      }[notif.tipo] || 'fa-bell text-gray-500';
      
      const fecha = new Date(notif.creado_en).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      html += `
        <div class="p-3 border-b border-gray-100 ${notif.leida ? 'bg-gray-50' : 'bg-blue-50'}">
          <div class="flex items-start gap-3">
            <div class="mt-1"><i class="fas ${tipoIcon}"></i></div>
            <div class="flex-1">
              <div class="font-medium ${notif.leida ? 'text-gray-700' : 'text-gray-900'}">${escapeHtml(notif.titulo)}</div>
              <div class="text-sm text-gray-600 mt-1">${escapeHtml(notif.mensaje)}</div>
              <div class="text-xs text-gray-500 mt-1">${fecha}</div>
            </div>
            ${!notif.leida ? '<span class="w-2 h-2 bg-blue-500 rounded-full mt-2"></span>' : ''}
          </div>
        </div>`;
    });
    
    panel.innerHTML = html;
  }
}

async function markAllNotificationsAsRead() {
  try {
    const result = await APIService.marcarTodasLeidas();
    if (result.success) {
      showAlert(result.message, 'success');
      APP_STATE.data.notificaciones = await APIService.leerNotificaciones();
      updateNotifications();
      $('#notificationsPanel')?.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error marcando notificaciones:', err);
    showAlert('Error al marcar notificaciones', 'danger');
  }
}

// =========================================================
// SECCIÓN DASHBOARD (OPTIMIZADA)
// =========================================================

function updateDashboard() {
  console.log('📊 Actualizando dashboard...');

  const ingresos = APP_STATE.data.ingresos || [];
  const gastos = APP_STATE.data.gastos || [];
  const gastosCompartidosAll = APP_STATE.data.gastos_compartidos || [];
  const partnerEmail = APP_STATE.partner?.email || '';
  const gastosCompartidos = filterSharedForPair_(gastosCompartidosAll, APP_STATE.user?.email, partnerEmail);

  // --- DINERO DISPONIBLE: Total ingresos - Total gastos ---
  const totalIngresos = ingresos.reduce((sum, item) => sum + parseAmount(item.monto), 0);
  const totalGastos = gastos.reduce((sum, item) => sum + parseAmount(item.monto), 0);
  const dineroDisponible = totalIngresos - totalGastos;

  
// --- GASTOS (filtros) ---
const now = new Date();
const filters = getDashboardFilters_();

// Month/year selection
const selectedYear = (filters.year === 'current') ? now.getFullYear() : parseInt(filters.year, 10);
const selectedMonth = (filters.month === 'current') ? (now.getMonth() + 1) : parseInt(filters.month, 10);

const isSamePeriod = (fechaStr) => {
  if (!fechaStr) return false;
  const d = new Date(fechaStr);
  if (isNaN(d)) return false;
  return d.getFullYear() === selectedYear && (d.getMonth() + 1) === selectedMonth;
};

// Build combined expenses list (own + shared share)
const ownExpenses = (APP_STATE.data.gastos || [])
  .filter(g => isSamePeriod(g.fecha))
  .map(g => ({ ...g, __scope: 'own', __amount: parseAmount(g.monto) || 0 }));

const sharedAll = filterSharedForPair_(APP_STATE.data.gastos_compartidos || [], APP_STATE.user?.email, partnerEmail);

const myEmail = (APP_STATE.user?.email || '').toLowerCase();
const sharedExpenses = sharedAll
  .filter(g => isSamePeriod(g.fecha))
  .map(g => {
    const pct = parseFloat(g.porcentaje_tu ?? 50);
    const isOwner = (String(g.email_usuario || '').toLowerCase() === myEmail);
    const myPct = isOwner ? pct : (100 - pct);
    const total = parseAmount(g.monto) || 0;
    const myShare = total * (myPct / 100);
    return { ...g, __scope: 'shared', __amount: myShare, __total: total, __myPct: myPct };
  });

let expensesBase = ownExpenses.concat(sharedExpenses);

// Scope filter
if (filters.scope === 'own') expensesBase = ownExpenses;
if (filters.scope === 'shared') expensesBase = sharedExpenses;

// Category filter
if (filters.category && filters.category !== 'all') {
  expensesBase = expensesBase.filter(e => String(e.categoria || '') === String(filters.category));
}

// For the summary card: expenses of month including shared share (not full)
const gastosMesTotal = expensesBase.reduce((sum, g) => sum + (g.__amount || 0), 0);


// Ingresos del periodo (mes/año seleccionado)
const ingresosMesTotal = (APP_STATE.data.ingresos || [])
  .filter(i => isSamePeriod(i.fecha))
  .reduce((sum, i) => sum + (parseAmount(i.monto) || 0), 0);

const sharedMesTotal = sharedExpenses.reduce((sum, g) => sum + (g.__amount || 0), 0);

// Pintar KPIs
const elBalance = document.getElementById('totalBalance');
const elIncome = document.getElementById('monthlyIncome');
const elExpenses = document.getElementById('monthlyExpenses');
const elShared = document.getElementById('sharedDebts');
const elPartner = document.getElementById('partnerName');
const elHint = document.getElementById('budgetHint');

if (elBalance) elBalance.textContent = fmtMoney(dineroDisponible);
if (elIncome) elIncome.textContent = fmtMoney(ingresosMesTotal);
if (elExpenses) elExpenses.textContent = fmtMoney(gastosMesTotal);
if (elShared) elShared.textContent = fmtMoney(sharedMesTotal);
if (elPartner) elPartner.textContent = partnerEmail ? partnerEmail : 'Sin pareja';

if (elHint) {
  const mm = String(selectedMonth).padStart(2, '0');
  elHint.textContent = `Periodo: ${mm}/${selectedYear} • ${filters.scope === 'all' ? 'Todos' : (filters.scope === 'own' ? 'Propios' : 'Compartidos')}${filters.category !== 'all' ? ' • ' + filters.category : ''}`;
}


// Build category aggregation

  // Agrupar gastos por categoría
  const categorias = {};
  expensesBase.forEach(gasto => {
    const cat = gasto.categoria || 'Otros';
    categorias[cat] = (categorias[cat] || 0) + ((gasto.__amount || 0));
  });

  const labels = Object.keys(categorias);
  const data = Object.values(categorias);

  const expensesWrap = document.getElementById('expensesChartWrap');
  let expensesChartEl = document.getElementById('expensesChart');

  if (!expensesWrap) {
    console.warn('⚠️ No se encontró #expensesChartWrap (dashboard).');
  } else if (labels.length > 0 && window.Chart) {
    // Si el placeholder reemplazó el canvas, lo recreamos
    if (!expensesChartEl) {
      expensesWrap.innerHTML = '<canvas id="expensesChart"></canvas>';
      expensesChartEl = document.getElementById('expensesChart');
    }

    // Destruir gráfico previo
    if (APP_STATE.charts.expenses) {
      try { APP_STATE.charts.expenses.destroy(); } catch(e) {}
      APP_STATE.charts.expenses = null;
    }

    if (expensesChartEl) {
      APP_STATE.charts.expenses = new Chart(expensesChartEl, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: [
              '#0f766e', '#10b981', '#3b82f6', '#f59e0b', '#ef4444',
              '#8b5cf6', '#06b6d4', '#14b8a6', '#22c55e', '#a855f7',
              '#f97316', '#64748b'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });
    }
  } else if (expensesWrap) {
    // No data (o Chart no cargó)
    expensesWrap.innerHTML = `
      <div class="h-full flex items-center justify-center text-gray-500">
        <div class="text-center">
          <i class="fas fa-chart-pie text-4xl mb-2"></i>
          <p>No hay gastos en el período</p>
        </div>
      </div>`;
  }

  // Actualizar otros widgets
  updateTrendChart();
  updateRecentActivity();

}

function updateTrendChart() {
  const trendCanvas = $('#trendChart');
  if (!trendCanvas || !window.Chart) return;

  if (APP_STATE.charts.trend) {
    APP_STATE.charts.trend.destroy();
  }

  const now = new Date();
  const filters = getDashboardFilters_();
  const selectedYear = (filters.year === 'current') ? now.getFullYear() : parseInt(filters.year, 10);
  const myEmail = (APP_STATE.user?.email || '').toLowerCase();
  const partnerEmail = (APP_STATE.partner?.email || '').toLowerCase();

  const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Ingresos por mes
  const incByMonth = Array(12).fill(0);
  (APP_STATE.data.ingresos || []).forEach(i => {
    if (!i.fecha) return;
    const d = new Date(i.fecha);
    if (isNaN(d) || d.getFullYear() !== selectedYear) return;
    incByMonth[d.getMonth()] += (parseAmount(i.monto) || 0);
  });

  // Gastos por mes: propios + compartidos (tu parte)
  const ownByMonth = Array(12).fill(0);
  (APP_STATE.data.gastos || []).forEach(g => {
    if (!g.fecha) return;
    const d = new Date(g.fecha);
    if (isNaN(d) || d.getFullYear() !== selectedYear) return;
    if (filters.category && filters.category !== 'all' && String(g.categoria||'') !== String(filters.category)) return;
    ownByMonth[d.getMonth()] += (parseAmount(g.monto) || 0);
  });

  const sharedByMonth = Array(12).fill(0);
  (APP_STATE.data.gastos_compartidos || []).forEach(g => {
    if (!g.fecha) return;
    const d = new Date(g.fecha);
    if (isNaN(d) || d.getFullYear() !== selectedYear) return;

    const eU = String(g.email_usuario||'').toLowerCase();
    const eP = String(g.email_pareja||'').toLowerCase();
    const isMinePair = (eU === myEmail && eP === partnerEmail) || (eU === partnerEmail && eP === myEmail);
    if (!isMinePair) return;

    if (filters.category && filters.category !== 'all' && String(g.categoria||'') !== String(filters.category)) return;

    const pct = parseFloat(g.porcentaje_tu ?? 50);
    const isOwner = (eU === myEmail);
    const myPct = isOwner ? pct : (100 - pct);
    const total = (parseAmount(g.monto) || 0);
    const myShare = total * (myPct / 100);

    sharedByMonth[d.getMonth()] += myShare;
  });

  let gastosByMonth = ownByMonth.map((v, idx)=>v + sharedByMonth[idx]);
  if (filters.scope === 'own') gastosByMonth = ownByMonth.slice();
  if (filters.scope === 'shared') gastosByMonth = sharedByMonth.slice();

  APP_STATE.charts.trend = new Chart(trendCanvas, {
    type: 'line',
    data: {
      labels: monthNames,
      datasets: [
        {
          label: 'Ingresos',
          data: incByMonth,
          tension: 0.35
        },
        {
          label: 'Gastos',
          data: gastosByMonth,
          tension: 0.35
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return fmtMoney(value).replace('$', '');
            }
          }
        }
      }
    }
  });
}

function updateRecentActivity() {
  const container = $('#recentActivity');
  if (!container) return;

  const items = [];
  const myEmail = (APP_STATE.user?.email || '').toLowerCase();
  const partnerEmail = (APP_STATE.partner?.email || '').toLowerCase();

  (APP_STATE.data.ingresos || []).forEach(i => {
    if (!i.fecha) return;
    items.push({
      kind: 'Ingreso',
      descripcion: i.descripcion || 'Ingreso',
      monto: (parseAmount(i.monto) || 0),
      fecha: i.fecha,
      icon: 'fas fa-arrow-up text-green-500'
    });
  });

  (APP_STATE.data.gastos || []).forEach(g => {
    if (!g.fecha) return;
    items.push({
      kind: 'Gasto',
      descripcion: g.descripcion || 'Gasto',
      monto: (parseAmount(g.monto) || 0),
      fecha: g.fecha,
      icon: 'fas fa-arrow-down text-red-500'
    });
  });

  (APP_STATE.data.gastos_compartidos || []).forEach(g => {
    if (!g.fecha) return;
    const eU = String(g.email_usuario||'').toLowerCase();
    const eP = String(g.email_pareja||'').toLowerCase();
    const isMinePair = (eU === myEmail && eP === partnerEmail) || (eU === partnerEmail && eP === myEmail);
    if (!isMinePair) return;

    const pct = parseFloat(g.porcentaje_tu ?? 50);
    const isOwner = (eU === myEmail);
    const myPct = isOwner ? pct : (100 - pct);
    const total = (parseAmount(g.monto) || 0);
    const myShare = total * (myPct / 100);

    items.push({
      kind: 'Gasto compartido',
      descripcion: g.descripcion || 'Compartido',
      monto: myShare,
      fecha: g.fecha,
      icon: 'fas fa-user-friends text-blue-600',
      extra: `Total ${fmtMoney(total)} • Tu parte ${myPct}%`
    });
  });

  items.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));

  if (items.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-inbox text-4xl mb-3"></i>
        <p>No hay actividad reciente</p>
      </div>`;
    return;
  }

  container.innerHTML = items.slice(0, 12).map(it => `
    <div class="p-4 border-b border-gray-100 flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center">
        <i class="${it.icon}"></i>
      </div>
      <div class="flex-1">
        <div class="flex items-center justify-between gap-3">
          <div class="font-medium text-gray-900">${escapeHTML(it.descripcion)}</div>
          <div class="${it.kind === 'Ingreso' ? 'text-green-600' : 'text-red-600'} font-semibold">${fmtMoney(it.monto)}</div>
        </div>
        <div class="text-xs text-gray-500 flex items-center justify-between gap-3">
          <span>${escapeHTML(it.kind)} • ${formatDate(it.fecha)}</span>
          ${it.extra ? `<span>${escapeHTML(it.extra)}</span>` : ``}
        </div>
      </div>
    </div>
  `).join('');
}

// =========================================================
// SECCIÓN GASTOS (CON TABS FUNCIONALES) - CORREGIDA
// =========================================================

async function loadExpenses() {
  console.log('📥 Cargando gastos...');
  const list = $('#expensesList');
  if (!list) return;
  
  showLoading(true);
  
  try {
    // Cargar GASTOS NORMALES
    const gastosNormales = await APIService.leer('gastos');
    
    // Cargar GASTOS COMPARTIDOS donde el usuario es el creador
    const gastosCompartidosAll = await APIService.leer('gastos_compartidos', { __skipUserEmail: true });
    const gastosCompartidos = filterSharedForUser_(gastosCompartidosAll || [], APP_STATE.user.email);
    
    // Combinar ambos tipos de gastos
    let todosLosGastos = (gastosNormales || []).map(g => ({ ...g, source: 'gastos' }));
    
    // Convertir gastos compartidos al formato de gastos normales
    gastosCompartidos.forEach(gastoCompartido => {
        const meta = parseSharedMeta(gastoCompartido.estado);

        const gastoConvertido = {
          id: gastoCompartido.id,
          source: 'gastos_compartidos',
          email_pareja: gastoCompartido.email_pareja || getPartnerEmail(),
          email_usuario: gastoCompartido.email_usuario,
          descripcion: gastoCompartido.descripcion,
          monto: gastoCompartido.monto,
          fecha: gastoCompartido.fecha,
          categoria: gastoCompartido.categoria,
          tipo: (meta && meta.tipo) ? meta.tipo : ((meta && meta.metodo_pago === 'credit') || (meta && meta.tarjeta_id)) ? 'credit' : (gastoCompartido.tarjeta_id ? 'credit' : 'variable'),
          metodo_pago: (meta && meta.metodo_pago) ? meta.metodo_pago : ( (meta && meta.tipo === 'credit') ? 'credit' : (gastoCompartido.metodo_pago || 'cash') ),
          tarjeta_id: gastoCompartido.tarjeta_id || gastoCompartido.tarjetaId || '',
          cuotas_totales: gastoCompartido.cuotas_totales || gastoCompartido.cuotasTotal || gastoCompartido.cuotas || '',
          cuota_actual: gastoCompartido.cuota_actual || gastoCompartido.cuotaActual || '',
          monto_total: gastoCompartido.monto_total || gastoCompartido.montoTotal || '',
          es_cuota: gastoCompartido.es_cuota || gastoCompartido.esCuota || '',
          compartido: 'true',
          porcentaje_tu: gastoCompartido.porcentaje_tu || 50,
          creado_en: gastoCompartido.creado_en
        };

        // Si la hoja no tiene columnas extra (crédito/cuotas), las recuperamos desde META en "estado"
        if (meta) {
          if (meta.tipo) gastoConvertido.tipo = String(meta.tipo).toLowerCase();
          if (meta.metodo_pago) gastoConvertido.metodo_pago = String(meta.metodo_pago).toLowerCase();
          if (meta.tarjeta_id) gastoConvertido.tarjeta_id = meta.tarjeta_id;
          if (meta.cuotas_totales) gastoConvertido.cuotas_totales = meta.cuotas_totales;
          if (meta.cuota_actual) gastoConvertido.cuota_actual = meta.cuota_actual;
          if (meta.monto_total) gastoConvertido.monto_total = meta.monto_total;
          if (typeof meta.es_cuota !== 'undefined') gastoConvertido.es_cuota = meta.es_cuota ? 'true' : 'false';
        }
        todosLosGastos.push(gastoConvertido);
    });
    

    // Evitar duplicados visuales (por re-render/merge)
    const uniq = new Map();
    (todosLosGastos || []).forEach(it => {
      const key = `${it.source || 'gastos'}:${it.id || ''}`;
      if (!uniq.has(key)) uniq.set(key, it);
    });
    todosLosGastos = Array.from(uniq.values());

    // Si por versiones anteriores se guardó el mismo gasto en GASTOS y en GASTOS_COMPARTIDOS,
    // eliminamos el duplicado "gastos" y nos quedamos con el compartido.
    const sig = (it) => {
      const d = String(it.descripcion || '').trim().toLowerCase();
      const f = String(it.fecha || '').trim();
      const c = String(it.categoria || '').trim().toLowerCase();
      const m = Number(parseAmount(it.monto)).toFixed(2);
      const t = String(it.tipo || '').trim().toLowerCase();
      const mp = String(it.metodo_pago || '').trim().toLowerCase();
      return `${f}|${d}|${c}|${m}|${t}|${mp}`;
    };
    const sharedSigs = new Set((todosLosGastos || []).filter(x => x.source === 'gastos_compartidos').map(sig));
    if (sharedSigs.size) {
      todosLosGastos = (todosLosGastos || []).filter(x => !(x.source === 'gastos' && (String(x.compartido).toLowerCase() === 'true') && sharedSigs.has(sig(x))));
    }


    
    // Normalizar tipo para UI (Crédito por método/tarjeta aunque la categoría sea variable)
    const catType = (name) => {
      const cats = (APP_STATE.data && APP_STATE.data.categorias) ? APP_STATE.data.categorias : [];
      const c = cats.find(x => String(x.nombre || x.categoria || '').toLowerCase() === String(name || '').toLowerCase());
      const t = (c && (c.tipo || c.tipo_gasto)) ? String(c.tipo || c.tipo_gasto).toLowerCase() : '';
      if (t.includes('fij')) return 'fixed';
      if (t.includes('cred')) return 'credit';
      return 'variable';
    };
    const isCredit = (it) => (String(it.metodo_pago).toLowerCase() === 'credit' || String(it.tipo).toLowerCase() === 'credit' || (it.tarjeta_id && String(it.tarjeta_id).trim() !== ''));
    todosLosGastos = (todosLosGastos || []).map(it => {
      const it2 = { ...it };
      if (isCredit(it2)) it2.tipo = 'credit';
      else it2.tipo = (it2.tipo === 'fixed' || it2.tipo === 'variable') ? it2.tipo : catType(it2.categoria);
      if (!it2.metodo_pago) it2.metodo_pago = (it2.tipo === 'credit') ? 'credit' : 'cash';
      return it2;
    });

APP_STATE.data.gastos = todosLosGastos;
    
  } catch (err) {
    console.error('Error cargando gastos:', err);
    APP_STATE.data.gastos = [];
  }
  
  let gastos = APP_STATE.data.gastos || [];
  const filterType = APP_STATE.filters.expenses.tipo;
  const filterCategory = APP_STATE.filters.expenses.category;
  const filterMonth = APP_STATE.filters.expenses.month;
  const filterYear = APP_STATE.filters.expenses.year;
  
  // Aplicar filtros
  gastos = gastos.filter(item => {
    if (filterType !== 'all' && item.tipo !== filterType) return false;
    if (filterCategory !== 'all' && item.categoria !== filterCategory) return false;
    
    if (filterMonth || filterYear) {
      try {
        const fecha = new Date(item.fecha);
        const itemMonth = fecha.getMonth() + 1;
        const itemYear = fecha.getFullYear();
        
        if (filterMonth && itemMonth !== parseInt(filterMonth)) return false;
        if (filterYear && itemYear !== parseInt(filterYear)) return false;
      } catch {
        return false;
      }
    }
    
    return true;
  });
  
  // Calcular totales por tipo - MOSTRAR TOTALES COMPLETOS
  let totalFijos = 0, totalVariables = 0, totalCredito = 0, totalGeneral = 0;
  let countFijos = 0, countVariables = 0, countCredito = 0;

  const isCreditExpense = (it) => (String(it.metodo_pago).toLowerCase() === 'credit' || String(it.tipo).toLowerCase() === 'credit' || (it.tarjeta_id && String(it.tarjeta_id).trim() !== ''));

  gastos.forEach(item => {
    const montoTotal = parseAmount(item.monto);
    totalGeneral += montoTotal;

    if (isCreditExpense(item)) {
      totalCredito += montoTotal;
      countCredito++;
    } else if (item.tipo === 'fixed') {
      totalFijos += montoTotal;
      countFijos++;
    } else {
      totalVariables += montoTotal;
      countVariables++;
    }
  });
  
  // Actualizar tarjetas de resumen (mostrando totales)
  setText('fixedExpenses', fmtMoney(totalFijos));
  setText('fixedCount', countFijos);
  setText('variableExpenses', fmtMoney(totalVariables));
  setText('variableCount', countVariables);
  setText('creditExpenses', fmtMoney(totalCredito));
  setText('creditCount', countCredito);
  
  // Determinar qué sumatoria mostrar según el tab activo
  let sumatoriaHTML = '';
  const activeTab = APP_STATE.filters.expenses.tipo || 'all';
  
  switch(activeTab) {
    case 'all':
      sumatoriaHTML = `
        <div class="p-4 bg-gray-50 border-b border-gray-200">
          <div class="flex justify-between items-center mb-2">
            <div class="font-semibold text-gray-700">TOTAL DE GASTOS:</div>
            <div class="text-xl font-bold text-red-600">${fmtMoney(totalGeneral)}</div>
          </div>
          <div class="grid grid-cols-3 gap-4 text-sm">
            <div class="text-center p-2 bg-blue-50 rounded">
              <div class="font-semibold text-primary">Fijos</div>
              <div class="font-bold">${fmtMoney(totalFijos)}</div>
              <div class="text-xs text-gray-500">${countFijos} gastos</div>
            </div>
            <div class="text-center p-2 bg-yellow-50 rounded">
              <div class="font-semibold text-warning">Variables</div>
              <div class="font-bold">${fmtMoney(totalVariables)}</div>
              <div class="text-xs text-gray-500">${countVariables} gastos</div>
            </div>
            <div class="text-center p-2 bg-red-50 rounded">
              <div class="font-semibold text-danger">Crédito</div>
              <div class="font-bold">${fmtMoney(totalCredito)}</div>
              <div class="text-xs text-gray-500">${countCredito} gastos</div>
            </div>
          </div>
        </div>`;
      break;
      
    case 'fixed':
      sumatoriaHTML = `
        <div class="p-4 bg-blue-50 border-b border-blue-200 flex justify-between items-center">
          <div>
            <div class="font-semibold text-blue-700">TOTAL GASTOS FIJOS</div>
            <div class="text-sm text-blue-600">${countFijos} gastos</div>
          </div>
          <div class="text-2xl font-bold text-primary">${fmtMoney(totalFijos)}</div>
        </div>`;
      break;
      
    case 'variable':
      sumatoriaHTML = `
        <div class="p-4 bg-yellow-50 border-b border-yellow-200 flex justify-between items-center">
          <div>
            <div class="font-semibold text-yellow-700">TOTAL GASTOS VARIABLES</div>
            <div class="text-sm text-yellow-600">${countVariables} gastos</div>
          </div>
          <div class="text-2xl font-bold text-warning">${fmtMoney(totalVariables)}</div>
        </div>`;
      break;
      
    case 'credit':
      sumatoriaHTML = `
        <div class="p-4 bg-red-50 border-b border-red-200 flex justify-between items-center">
          <div>
            <div class="font-semibold text-red-700">TOTAL GASTOS CRÉDITO</div>
            <div class="text-sm text-red-600">${countCredito} gastos</div>
          </div>
          <div class="text-2xl font-bold text-danger">${fmtMoney(totalCredito)}</div>
        </div>`;
      break;
  }
  
  if (gastos.length === 0) {
    list.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-receipt text-4xl mb-3"></i>
        <p class="mb-3">No hay gastos registrados</p>
        <button class="btn btn-accent btn-sm bg-primary text-white px-3 py-1 rounded text-sm hover:bg-teal-700" onclick="openExpenseModal()">
          <i class="fas fa-plus"></i> Agregar primer gasto
        </button>
      </div>`;
    showLoading(false);
    return;
  }
  
  let html = sumatoriaHTML;
  
  // Ordenar por fecha (más reciente primero)
  gastos.sort((a, b) => new Date(b.fecha || b.creado_en) - new Date(a.fecha || a.creado_en));
  
  gastos.forEach(item => {
    const fechaFormateada = formatDate(item.fecha || item.creado_en);
    const categoria = item.categoria || 'General';
    const tipoMap = {
      'fixed': 'Fijo',
      'variable': 'Variable',
      'credit': 'Crédito'
    };
    const tipo = tipoMap[item.tipo] || 'Variable';
    const metodoMap = {
      'cash': 'Efectivo',
      'debit': 'Débito',
      'credit': 'Crédito',
      'transfer': 'Transferencia'
    };
    const metodo = metodoMap[item.metodo_pago] || 'Efectivo';
    
    const montoTotal = parseAmount(item.monto);
    
    // Para gastos compartidos: mostrar observación con participación
    let observacion = '';
    let badgeCompartido = '';
    
    if (item.compartido === 'true' || item.porcentaje_tu) {
      const porcentaje = parseAmount(item.porcentaje_tu) || 50;
      const miParte = montoTotal * (porcentaje / 100);
      const partePareja = montoTotal - miParte;
      
      badgeCompartido = '<span class="badge badge-success ml-2">Compartido</span>';
      observacion = `
        <div class="mt-2 p-2 bg-blue-50 rounded text-sm">
          <div class="font-medium text-blue-700">Gasto Compartido:</div>
          <div class="mt-1 text-blue-700">
            <span class="font-medium">Total del mes:</span> <span class="font-bold">${fmtMoney(montoTotal)}</span>
            ${ (item.tipo === 'credit' && item.cuotas_totales && parseInt(item.cuotas_totales) > 1 && parseAmount(item.monto_total)) ? ` <span class=\"text-blue-500\">•</span> <span class=\"font-medium\">Total compra:</span> <span class=\"font-bold\">${fmtMoney(parseAmount(item.monto_total))}</span>` : '' }
          </div>
          <div class="grid grid-cols-2 gap-2 mt-1">
            <div class="text-blue-600">
              <i class="fas fa-user mr-1"></i> Tu pagas: <span class="font-bold">${fmtMoney(miParte)}</span> (${porcentaje}%)
            </div>
            <div class="text-green-600">
              <i class="fas fa-user-friends mr-1"></i> Pareja paga: <span class="font-bold">${fmtMoney(partePareja)}</span> (${100 - porcentaje}%)
            </div>
          </div>
        </div>`;
    }
    
    // Para gastos a crédito con cuotas: calcular cuota mensual
    // Para gastos a crédito con cuotas: calcular cuota mensual
let infoCuotas = '';
if (item.tipo === 'credit' && item.cuotas_totales && parseInt(item.cuotas_totales) > 1) {
  const cuotaActual = item.cuota_actual || 1;
  const cuotasTotales = parseInt(item.cuotas_totales) || 1;
  const montoTotal = parseAmount(item.monto_total) || (parseAmount(item.monto) * cuotasTotales);
  
  infoCuotas = `<div class="text-xs text-purple-600 mt-1">
    <i class="fas fa-calendar-alt mr-1"></i> Cuota ${cuotaActual}/${cuotasTotales} • Total: ${fmtMoney(montoTotal)}
  </div>`;
}
    
    html += `
      <div class="p-4 border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <div class="flex items-center justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-gray-900 truncate flex items-center gap-2">
              <i class="fas fa-arrow-down text-red-500"></i>
              ${escapeHtml(item.descripcion || 'Gasto')}
              ${badgeCompartido}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              <span class="inline-flex items-center gap-1">
                <i class="far fa-calendar"></i> ${escapeHtml(fechaFormateada)}
              </span>
              <span class="mx-2">•</span>
              <span class="inline-flex items-center gap-1">
                <i class="fas fa-tag"></i> ${escapeHtml(categoria)}
              </span>
              <span class="mx-2">•</span>
              <span class="inline-flex items-center gap-1">
                <i class="fas fa-credit-card"></i> ${escapeHtml(metodo)}
              </span>
              <span class="mx-2">•</span>
              <span class="badge ${tipo === 'Fijo' ? 'badge-primary' : tipo === 'Variable' ? 'badge-warning' : 'badge-danger'}">
                ${escapeHtml(tipo)}
              </span>
            </div>
            ${infoCuotas}
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="font-bold text-red-600 text-right text-lg">${fmtMoney(montoTotal)}</div>
            <div class="flex gap-1">
              <button class="btn btn-sm btn-secondary bg-gray-200 text-gray-700 px-2 py-1 rounded text-sm hover:bg-gray-300" onclick="editExpense('${item.id}')">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn btn-sm btn-danger bg-red-100 text-red-700 px-2 py-1 rounded text-sm hover:bg-red-200" onclick="deleteExpense('${item.id}')">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
        ${observacion}
      </div>`;
  });
  
  list.innerHTML = html;
  showLoading(false);
}


// =========================================================
// SECCIÓN GASTOS COMPARTIDOS (CON TABLA Y 3 TARJETAS)
// =========================================================


async function loadInvitesNoPartnerUI_() {
  try {
    const receivedList = $('#receivedInvitesList');
    const sentList = $('#sentInvitesList');
    if (!receivedList && !sentList) return;

    const myEmail = (APP_STATE.user?.email || '').toLowerCase().trim();
    if (!myEmail) return;

    const received = await APIService.leer('invitaciones', { email_to: myEmail, estado: 'pendiente' });
    const sent = await APIService.leer('invitaciones', { email_from: myEmail, estado: 'pendiente' });

    if (receivedList) {
      if (!received.length) {
        receivedList.innerHTML = '<div class="text-sm text-gray-500">Sin invitaciones pendientes.</div>';
      } else {
        receivedList.innerHTML = received.map(inv => {
          const from = escapeHTML(inv.email_from || '');
          const code = escapeHTML(inv.codigo || '');
          const id = escapeHTML(inv.id || '');
          return `
            <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200">
              <div class="min-w-0">
                <div class="text-sm font-medium text-gray-800 truncate">De: ${from}</div>
                <div class="text-xs text-gray-500">Código: <span class="font-mono">${code}</span> · ID: <span class="font-mono">${id}</span></div>
              </div>
              <button class="btn btn-accent bg-primary text-white px-3 py-2 rounded-lg hover:bg-teal-700 text-sm" data-action="acceptInvite" data-invite-id="${id}">
                Aceptar
              </button>
            </div>`;
        }).join('');
      }
    }

    if (sentList) {
      if (!sent.length) {
        sentList.innerHTML = '<div class="text-sm text-gray-500">No has enviado invitaciones pendientes.</div>';
      } else {
        sentList.innerHTML = sent.map(inv => {
          const to = escapeHTML(inv.email_to || '');
          const code = escapeHTML(inv.codigo || '');
          const id = escapeHTML(inv.id || '');
          return `
            <div class="p-3 rounded-lg border border-gray-200">
              <div class="text-sm font-medium text-gray-800 truncate">Para: ${to}</div>
              <div class="text-xs text-gray-500">Compartí este código con tu pareja para que acepte: <span class="font-mono">${code}</span></div>
              <div class="text-xs text-gray-400 mt-1">ID interno: <span class="font-mono">${id}</span></div>
            </div>`;
        }).join('');
      }
    }
  } catch (e) {
    console.warn('No se pudieron cargar invitaciones:', e);
  }
}


async function loadSharedSection() {
  // 🔁 Modo "Invitaciones" (como antes): ocultamos el resumen/listado de gastos compartidos
  try {
    const noPartnerSection = document.getElementById('noPartnerSection');
    const partnerSection = document.getElementById('partnerSection');
    if (noPartnerSection) noPartnerSection.classList.remove('hidden');
    if (partnerSection) partnerSection.classList.add('hidden');

    // Ocultar tarjetas/resumen si existen
    ['sharedTotal','sharedYouOwe','sharedOwedToYou'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.closest('.data-card')?.classList?.add('hidden');
    });
    const sharedList = document.getElementById('sharedExpensesList');
    if (sharedList) sharedList.closest('.data-card')?.classList?.add('hidden');

    document.querySelectorAll('button').forEach(btn => {
      const t = (btn.textContent || '').toLowerCase();
      if (t.includes('nuevo gasto compartido') || t.includes('liquidar deudas')) btn.classList.add('hidden');
    });
  } catch (_) {}

  console.log('👥 Cargando gastos compartidos...');
  
  const noPartnerSection = $('#noPartnerSection');
  const partnerSection = $('#partnerSection');
  const sharedList = $('#sharedExpensesList');
  
  // Cargar pareja
  try {
    const result = await APIService.getPareja();
    APP_STATE.partner = result.partner;
  } catch (err) {
    console.error('Error cargando pareja:', err);
  }
  
  
  // Mostrar invitaciones pendientes (recibidas y enviadas) incluso si aún no hay pareja vinculada
  await loadInvitesNoPartnerUI_();
if (!APP_STATE.partner) {
    noPartnerSection?.classList.remove('hidden');
    partnerSection?.classList.add('hidden');
    // Sin pareja: dejamos la sección de invitaciones visible
    return;
  }
  
  // Con pareja: NO ocultamos invitaciones, solo mostramos tablero adicional
  noPartnerSection?.classList.remove('hidden');
  partnerSection?.classList.remove('hidden');
  
  // Cargar gastos compartidos
  try {
    APP_STATE.data.gastos_compartidos = await APIService.leer('gastos_compartidos', { __skipUserEmail: true });
  } catch (err) {
    console.error('Error cargando gastos compartidos:', err);
    APP_STATE.data.gastos_compartidos = [];
  }
  
  const partnerEmail = APP_STATE.partner?.email || '';
  const gastosCompartidosAll = APP_STATE.data.gastos_compartidos || [];
  const gastosCompartidos = filterSharedForPair_(gastosCompartidosAll, APP_STATE.user?.email, partnerEmail);
  const filterMonth = APP_STATE.filters.shared.month;
  const filterYear = APP_STATE.filters.shared.year;
  const filterTipo = APP_STATE.filters.shared.tipo;
  
  // Filtrar gastos
  let filteredGastos = gastosCompartidos.filter(gasto => {
    if (filterMonth || filterYear) {
      try {
        const fecha = new Date(gasto.fecha);
        const itemMonth = fecha.getMonth() + 1;
        const itemYear = fecha.getFullYear();
        
        if (filterMonth && itemMonth !== parseInt(filterMonth)) return false;
        if (filterYear && itemYear !== parseInt(filterYear)) return false;
      } catch {
        return false;
      }
    }
    
    if (filterTipo !== 'all' && gasto.categoria !== filterTipo) return false;
    
    return true;
  });
  
  // Calcular totales para las 3 tarjetas
  let totalYoDebo = 0;
  let totalParejaDebe = 0;
  let totalGeneral = 0;
  
  filteredGastos.forEach(gasto => {
    const meta = parseSharedMeta(gasto.estado);

    const monto = parseAmount(gasto.monto);
    const porcentaje = parseAmount(gasto.porcentaje_tu) || 50;
    
    const miParte = monto * (porcentaje / 100);
    const partePareja = monto - miParte;
    
    totalGeneral += monto;
    totalYoDebo += miParte;
    totalParejaDebe += partePareja;
  });
  
  // Actualizar las 3 tarjetas
  setText('youOwe', fmtMoney(totalYoDebo));
  setText('owedToYou', fmtMoney(totalParejaDebe));
  setText('sharedTotal', fmtMoney(totalGeneral));
  
  // Actualizar nombres de pareja
  setText('partnerNameDisplay', APP_STATE.partner.email);
  setText('partnerNameDisplay2', APP_STATE.partner.email);
  
  // Mostrar tabla de gastos compartidos
  if (filteredGastos.length === 0) {
    sharedList.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-users text-4xl mb-3"></i>
        <p class="mb-3">No hay gastos compartidos registrados</p>
        <button class="btn btn-accent btn-sm bg-primary text-white px-3 py-1 rounded text-sm hover:bg-teal-700" onclick="openSharedExpenseModal()">
          <i class="fas fa-plus"></i> Agregar primer gasto compartido
        </button>
      </div>`;
    return;
  }
  
  let html = `
    <div class="overflow-x-auto">
      <table class="w-full">
        <thead class="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th class="p-3 text-left">Fecha</th>
            <th class="p-3 text-left">Descripción</th>
            <th class="p-3 text-left">Categoría</th>
            <th class="p-3 text-left">Total</th>
            <th class="p-3 text-left">Yo pago</th>
            <th class="p-3 text-left">Pareja paga</th>
            <th class="p-3 text-left">Acciones</th>
          </tr>
        </thead>
        <tbody>`;
  
  filteredGastos.forEach(gasto => {
    const fecha = formatDate(gasto.fecha);
    const monto = parseAmount(gasto.monto);
    const porcentaje = parseAmount(gasto.porcentaje_tu) || 50;
    const meta = parseSharedMeta(gasto.estado);
    const miParte = monto * (porcentaje / 100);
    const partePareja = monto - miParte;
    
    // Determinar si el usuario es el creador
    const isOwner = gasto.email_usuario === APP_STATE.user.email;
    
    html += `
      <tr class="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
        <td class="p-3">${fecha}</td>
        <td class="p-3 font-medium">
          ${escapeHtml(gasto.descripcion || 'Gasto compartido')}
          ${meta && String(meta.tipo).toLowerCase() === 'credit' ? `<div class="text-xs text-purple-600 mt-1">
            <i class="fas fa-calendar-alt mr-1"></i> Cuota ${meta.cuota_actual || 1}/${meta.cuotas_totales || ''}${meta.monto_total ? ` • Total compra: ${fmtMoney(parseAmount(meta.monto_total))}` : ''}
          </div>` : ''}
        </td>
        <td class="p-3">
          <span class="badge badge-secondary px-2 py-1 rounded-full text-xs">${escapeHtml(gasto.categoria || 'General')}</span>
        </td>
        <td class="p-3 font-bold">${fmtMoney(monto)}</td>
        <td class="p-3 font-semibold ${miParte > 0 ? 'text-yellow-600' : ''}">
          ${fmtMoney(miParte)} (${porcentaje}%)
        </td>
        <td class="p-3 font-semibold ${partePareja > 0 ? 'text-blue-600' : ''}">
          ${fmtMoney(partePareja)} (${100 - porcentaje}%)
        </td>
        <td class="p-3">
          ${isOwner ? `
          <div class="flex gap-1">
            <button class="btn btn-sm btn-danger bg-red-100 text-red-700 px-2 py-1 rounded text-sm hover:bg-red-200" onclick="deleteSharedExpense('${gasto.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
          ` : '<span class="text-gray-400 text-sm">Recibido</span>'}
        </td>
      </tr>`;
  });
  
  html += `</tbody></table></div>`;
  sharedList.innerHTML = html;
}

// =========================================================
// SECCIÓN INGRESOS
// =========================================================

async function loadIncomes() {
  console.log('📥 Cargando ingresos...');
  const list = $('#incomesList');
  if (!list) return;
  
  try {
    APP_STATE.data.ingresos = await APIService.leer('ingresos');
  } catch (err) {
    console.error('Error cargando ingresos:', err);
  }
  
  let ingresos = APP_STATE.data.ingresos || [];
  
  // Aplicar filtros
  const month = APP_STATE.filters.incomes.month;
  const year = APP_STATE.filters.incomes.year;
  
  if (month || year) {
    ingresos = ingresos.filter(item => {
      try {
        const fecha = new Date(item.fecha);
        const itemMonth = fecha.getMonth() + 1;
        const itemYear = fecha.getFullYear();
        
        if (month && itemMonth !== parseInt(month)) return false;
        if (year && itemYear !== parseInt(year)) return false;
        return true;
      } catch {
        return false;
      }
    });
  }
  
  if (ingresos.length === 0) {
    list.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-plus-circle text-4xl mb-3"></i>
        <p class="mb-3">No hay ingresos registrados</p>
        <button class="btn btn-accent btn-sm bg-primary text-white px-3 py-1 rounded text-sm hover:bg-teal-700" onclick="openIncomeModal()">
          <i class="fas fa-plus"></i> Agregar primer ingreso
        </button>
      </div>`;
    return;
  }
  
  let html = '';
  ingresos.forEach(item => {
    const fechaFormateada = formatDate(item.fecha);
    const categoria = item.categoria || 'General';
    const frecuenciaMap = {
      'onetime': 'Único',
      'weekly': 'Semanal',
      'biweekly': 'Quincenal',
      'monthly': 'Mensual',
      'yearly': 'Anual'
    };
    const frecuencia = frecuenciaMap[item.frecuencia] || item.frecuencia;
    
    html += `
      <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-gray-900 truncate flex items-center gap-2">
            <i class="fas fa-arrow-up text-green-500"></i>
            ${escapeHtml(item.descripcion || 'Ingreso')}
          </div>
          <div class="text-xs text-gray-500 mt-1">
            <span class="inline-flex items-center gap-1">
              <i class="far fa-calendar"></i> ${escapeHtml(fechaFormateada)}
            </span>
            <span class="mx-2">•</span>
            <span class="inline-flex items-center gap-1">
              <i class="fas fa-tag"></i> ${escapeHtml(categoria)}
            </span>
            <span class="mx-2">•</span>
            <span class="inline-flex items-center gap-1">
              <i class="fas fa-redo"></i> ${escapeHtml(frecuencia)}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <div class="font-bold text-green-600 text-right text-lg">${fmtMoney(item.monto)}</div>
          <div class="flex gap-1">
            <button class="btn btn-sm btn-secondary bg-gray-200 text-gray-700 px-2 py-1 rounded text-sm hover:bg-gray-300" onclick="editIncome('${item.id}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger bg-red-100 text-red-700 px-2 py-1 rounded text-sm hover:bg-red-200" onclick="deleteIncome('${item.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
  });
  
  list.innerHTML = html;
}

// =========================================================
// SECCIÓN PROYECCIONES
// =========================================================

// =========================================================
// SECCIÓN PROYECCIONES CON CUOTAS
// =========================================================


async function loadProjections() {
  console.log('📅 Cargando proyecciones (estilo banco)...');

  const tableBody = $('#projectionsTableBody');
  if (!tableBody) return;

  showLoading(true);

  try {
    const [gastos, gastosCompartidos, tarjetas] = await Promise.all([
      APIService.leer('gastos'),
      APIService.leer('gastos_compartidos', { __skipUserEmail: true }),
      APIService.leer('tarjetas')
    ]);

    APP_STATE.data.gastos = gastos || [];
    APP_STATE.data.gastos_compartidos = filterSharedForUser_(gastosCompartidos || [], APP_STATE.user.email);
    APP_STATE.data.tarjetas = tarjetas || [];

  } catch (err) {
    console.error('Error cargando proyecciones:', err);
    showLoading(false);
    tableBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No se pudieron cargar las proyecciones.</td></tr>`;
    return;
  }

  const tipoFilter = APP_STATE.filters.projections.tipo || 'all';
  const yearFilter = APP_STATE.filters.projections.year || '';
  const monthFilter = APP_STATE.filters.projections.month || ''; // YYYY-MM o ''

  const now = new Date();
  const currentYM = toYM(now);

  // Determinar meses a mostrar
  let monthsToShow = [];
  if (monthFilter) {
    monthsToShow = [monthFilter];
  } else if (yearFilter) {
    const y = parseInt(yearFilter, 10);
    if (!isNaN(y)) {
      monthsToShow = Array.from({length:12}, (_,i)=> `${y}-${pad2(i+1)}`);
    }
  } else {
    // por defecto: próximos 12 meses desde el actual
    monthsToShow = Array.from({length:12}, (_,i)=> addMonthsToYM(currentYM, i));
  }

  // Preparar mapa de tarjetas por id
  const cardsById = new Map((APP_STATE.data.tarjetas||[]).map(c => [String(c.id ?? c.tarjeta_id ?? ''), c]));

  // Normalizar gastos (normales + compartidos)
  const allRaw = [];

  (APP_STATE.data.gastos || []).forEach(g => allRaw.push({ ...g, _source: 'gasto' }));
  (APP_STATE.data.gastos_compartidos || []).forEach(g => allRaw.push({ ...g, _source: 'shared' }));

  // Expandir a "pagos" (lo que efectivamente se paga por mes)
  const payments = [];

  for (const item of allRaw) {
    const rawTipo = (item.tipo || '').toLowerCase();
    const isShared = rawTipo === 'shared' || item._source === 'shared' || item.compartido === 'true' || item.porcentaje_tu;

    // Tipo para filtro
    const tipoParaFiltro = isShared ? 'shared' : (rawTipo || 'variable');

    if (tipoFilter !== 'all') {
      if (tipoFilter === 'fixed' && tipoParaFiltro !== 'fixed') continue;
      if (tipoFilter === 'credit' && tipoParaFiltro !== 'credit') continue;
      if (tipoFilter === 'shared' && tipoParaFiltro !== 'shared') continue;
    }

    const descripcion = item.descripcion || 'Gasto';
    const categoria = item.categoria || 'General';

    // Totales y partes
    const totalBase = parseAmount(item.monto_total) || (parseAmount(item.monto) || 0) * (parseInt(item.cuotas_totales || item.cuotas || 1, 10) || 1);
    let miParte = totalBase;
    let parejaParte = 0;

    if (isShared) {
      const porcentajeTu = parseAmount(item.porcentaje_tu) || 50;
      miParte = totalBase * (porcentajeTu / 100);
      parejaParte = totalBase - miParte;
    }

    // Fecha base
    const purchaseDate = item.fecha ? new Date(item.fecha) : new Date();

    // Gasto tarjeta / crédito (con o sin cuotas)
    if (tipoParaFiltro === 'credit') {
      const cuotasTotales = parseInt(item.cuotas_totales || item.cuotas || 1, 10) || 1;
      const montoTotal = parseAmount(item.monto_total) || (parseAmount(item.monto) || 0) * cuotasTotales;

      const cardId = String(item.tarjeta_id || item.card_id || item.tarjetaId || '');
      const card = cardsById.get(cardId);

      // Si no hay tarjeta, lo tratamos como pago único en el mes de la fecha
      if (!card) {
        const ym = toYM(purchaseDate);
        if (!monthsToShow.includes(ym)) continue;

        payments.push({
          descripcion,
          categoria,
          total: montoTotal,
          mi_parte: miParte,
          pareja: parejaParte,
          tipo: 'Crédito',
          fecha: purchaseDate,
          observaciones: cuotasTotales > 1 ? `Cuota 1/${cuotasTotales}` : 'Pago único'
        });
        continue;
      }

      // Expandir cuotas: lo que "vence" cada mes
      const sched = buildInstallmentSchedule({
        purchaseDate,
        card,
        cuotasTotales,
        montoTotal,
        descripcion,
        baseItem: { categoria },
        miParte,
        parejaParte
      });

      for (const p of sched) {
        const ymDue = toYM(p.dueDate);
        if (!monthsToShow.includes(ymDue)) continue;

        const obs = [
          card.banco ? `${card.banco} ****${card.ultimos_4 || ''}` : `Tarjeta ****${card.ultimos_4 || ''}`,
          `Cierra: ${formatDate(p.closeDate)}`,
          `Vence: ${formatDate(p.dueDate)}`,
          p.observaciones_extra
        ].filter(Boolean).join(' • ');

        payments.push({
          descripcion: p.descripcion,
          categoria,
          total: p.total,
          mi_parte: p.mi_parte,
          pareja: p.pareja,
          tipo: 'Tarjeta',
          fecha: p.dueDate,
          observaciones: obs
        });
      }

      continue;
    }

    // Gasto fijo: se proyecta mes a mes (por defecto, 12 meses o el año seleccionado)
    if (tipoParaFiltro === 'fixed') {
      const day = purchaseDate.getDate();
      for (const ym of monthsToShow) {
        const [y,m] = ym.split('-').map(Number);
        const payDate = makeDate(y, m, day);
        // si el fijo empezó en el futuro, respetarlo
        if (payDate.getTime() < purchaseDate.getTime()) continue;

        payments.push({
          descripcion,
          categoria,
          total: totalBase,
          mi_parte: miParte,
          pareja: parejaParte,
          tipo: isShared ? 'Compartido' : 'Fijo',
          fecha: payDate,
          observaciones: isShared ? `Compartido (${(parseAmount(item.porcentaje_tu)||50)}% - ${(100-(parseAmount(item.porcentaje_tu)||50))}%)` : 'Mensual'
        });
      }
      continue;
    }

    // Variable / compartido de una sola vez: entra en el mes de la fecha
    {
      const ym = toYM(purchaseDate);
      if (!monthsToShow.includes(ym)) continue;

      payments.push({
        descripcion,
        categoria,
        total: totalBase,
        mi_parte: miParte,
        pareja: parejaParte,
        tipo: isShared ? 'Compartido' : 'Variable',
        fecha: purchaseDate,
        observaciones: isShared ? `Compartido (${(parseAmount(item.porcentaje_tu)||50)}% - ${(100-(parseAmount(item.porcentaje_tu)||50))}%)` : ''
      });
    }
  }

  // Orden por fecha asc
  payments.sort((a,b) => (a.fecha?.getTime?.() || 0) - (b.fecha?.getTime?.() || 0));

  // Totales del mes/periodo seleccionado
  const totalPagar = payments.reduce((acc, x) => acc + (parseAmount(x.total) || 0), 0);
  const totalMiParte = payments.reduce((acc, x) => acc + (parseAmount(x.mi_parte) || 0), 0);
  const totalPareja = payments.reduce((acc, x) => acc + (parseAmount(x.pareja) || 0), 0);

  $('#projectionTotal') && ($('#projectionTotal').textContent = fmtMoney(totalPagar));
  $('#projectionYourPart') && ($('#projectionYourPart').textContent = fmtMoney(totalMiParte));
  $('#projectionPartnerPart') && ($('#projectionPartnerPart').textContent = fmtMoney(totalPareja));

  // Render tabla
  if (payments.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No hay pagos programados para el período seleccionado.</td></tr>`;
    showLoading(false);
    return;
  }

  tableBody.innerHTML = payments.map(p => {
    return `
      <tr class="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <td class="p-3">
          <div class="font-semibold text-gray-900">${escapeHTML(p.descripcion || '')}</div>
          <div class="text-xs text-gray-500">${escapeHTML(p.categoria || '')}</div>
        </td>
        <td class="p-3">${formatDate(p.fecha)}</td>
        <td class="p-3 font-semibold">${fmtMoney(p.total)}</td>
        <td class="p-3">${fmtMoney(p.mi_parte)}</td>
        <td class="p-3">${fmtMoney(p.pareja)}</td>
        <td class="p-3">${escapeHTML(p.tipo || '')}</td>
        <td class="p-3 text-sm text-gray-600">${escapeHTML(p.observaciones || '')}</td>
      </tr>
    `;
  }).join('');

  showLoading(false);
}

// =========================================================
// MODALES Y FORMULARIOS
// =========================================================

function openIncomeModal(incomeId = null) {
  const modal = $('#incomeModal');
  const title = $('#incomeModalTitle');
  const form = $('#incomeForm');
  
  if (!modal || !form) return;
  
  if (incomeId) {
    const income = APP_STATE.data.ingresos.find(i => i.id === incomeId);
    if (income) {
      title.textContent = 'Editar Ingreso';
      form.querySelector('[name="id"]').value = income.id;
      form.querySelector('[name="descripcion"]').value = income.descripcion || '';
      form.querySelector('[name="monto"]').value = income.monto || '';
      form.querySelector('[name="fecha"]').value = income.fecha ? income.fecha.split('T')[0] : '';
      form.querySelector('[name="frecuencia"]').value = income.frecuencia || 'monthly';
      form.querySelector('[name="categoria"]').value = income.categoria || '';
    }
  } else {
    title.textContent = 'Nuevo Ingreso';
    form.reset();
    refreshSharedWithOptions_();
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="fecha"]').value = new Date().toISOString().split('T')[0];
    form.querySelector('[name="frecuencia"]').value = 'monthly';
  }
  
  modal.classList.add('active');
}

function openExpenseModal(expenseId = null) {
  const modal = $('#expenseModal');
  const title = $('#expenseModalTitle');
  const form = $('#expenseForm');
  
  if (!modal || !form) return;

  refreshSharedWithOptions_();
  
  // Cargar tarjetas en el select
  const cardSelect = $('#expenseCardSelect');
  if (cardSelect) {
    const tarjetas = APP_STATE.data.tarjetas || [];
    let html = '<option value="">Seleccionar tarjeta</option>';
    tarjetas.forEach(tarjeta => {
      html += `<option value="${tarjeta.id}">${escapeHtml(tarjeta.banco)} **** ${escapeHtml(tarjeta.ultimos_4)}</option>`;
    });
    cardSelect.innerHTML = html;
  }
  
  if (expenseId) {
    const expense = APP_STATE.data.gastos.find(g => g.id === expenseId);
    if (expense) {
      title.textContent = 'Editar Gasto';
      form.querySelector('[name="id"]').value = expense.id;
      form.querySelector('[name="descripcion"]').value = expense.descripcion || '';
      form.querySelector('[name="monto"]').value = expense.monto || '';
      form.querySelector('[name="fecha"]').value = expense.fecha ? expense.fecha.split('T')[0] : '';
      form.querySelector('[name="categoria"]').value = expense.categoria || '';
      form.querySelector('[name="tipo"]').value = expense.tipo || 'variable';
      form.querySelector('[name="metodo_pago"]').value = expense.metodo_pago || 'cash';
      
      if (expense.tipo === 'credit') {
        $('#creditCardFields').classList.remove('hidden');
        if (expense.tarjeta_id) form.querySelector('[name="tarjeta_id"]').value = expense.tarjeta_id;
        if (expense.cuotas) form.querySelector('[name="cuotas"]').value = expense.cuotas;
      }
      
      if (expense.compartido === 'true' || expense.porcentaje_tu) {
    const sharedCheck = $('#isSharedCheck');
    if (sharedCheck) sharedCheck.checked = true;
        $('#sharedFields').classList.remove('hidden');
        if (expense.porcentaje_tu) {
          form.querySelector('[name="porcentaje_tu"]').value = expense.porcentaje_tu;
        }
      }
    }
  } else {
    title.textContent = 'Nuevo Gasto';
    form.reset();
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="fecha"]').value = new Date().toISOString().split('T')[0];
    form.querySelector('[name="tipo"]').value = 'variable';
    form.querySelector('[name="metodo_pago"]').value = 'cash';
    $('#creditCardFields').classList.add('hidden');
    const sharedCheck = $('#isSharedCheck');
    if (sharedCheck) sharedCheck.checked = false;
    $('#sharedFields').classList.add('hidden');
  }
  
  modal.classList.add('active');
}

function openSharedExpenseModal() {
  openExpenseModal();
  
  setTimeout(() => {
    const sharedCheck = $('#isSharedCheck');
    if (sharedCheck) sharedCheck.checked = true;
    $('#sharedFields').classList.remove('hidden');
  }, 100);
}

function openCardModal(cardId = null) {
  const modal = $('#cardModal');
  const form = $('#cardForm');
  
  if (!modal || !form) return;
  
  if (cardId) {
    const card = APP_STATE.data.tarjetas.find(c => c.id === cardId);
    if (card) {
      form.querySelector('[name="id"]').value = card.id;
      form.querySelector('[name="banco"]').value = card.banco || '';
      form.querySelector('[name="ultimos_4"]').value = card.ultimos_4 || '';
      form.querySelector('[name="limite_credito"]').value = card.limite_credito || '';
      form.querySelector('[name="dia_cierre"]').value = card.dia_cierre || 15;
      form.querySelector('[name="dia_vencimiento"]').value = card.dia_vencimiento || 5;
      form.querySelector('[name="tipo"]').value = card.tipo || 'visa';
    }
  } else {
    form.reset();
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="dia_cierre"]').value = 15;
    form.querySelector('[name="dia_vencimiento"]').value = 5;
    form.querySelector('[name="tipo"]').value = 'visa';
  }
  
  modal.classList.add('active');
}

// ==============================
// Cierres por mes (Tarjetas)
// ==============================
function openCyclesModal() {
  const modal = $('#cyclesModal');
  if (!modal) return;

  // llenar tarjetas
  const sel = $('#cycleCardSelect');
  if (sel) {
    const cards = APP_STATE.data.tarjetas || [];
    sel.innerHTML = `<option value="">Seleccionar tarjeta</option>` + cards.map(c => {
      const id = c.id ?? c.tarjeta_id ?? '';
      const label = `${c.banco || 'Banco'} • ${c.tipo ? String(c.tipo).toUpperCase() : ''} • ****${c.ultimos_4 || ''}`;
      return `<option value="${id}">${escapeHTML(label)}</option>`;
    }).join('');
  }

  // llenar meses (24 meses desde el mes anterior al actual)
  const monthSel = $('#cycleMonthSelect');
  if (monthSel) {
    const now = new Date();
    const startYM = addMonthsToYM(toYM(now), -1);
    let html = '';
    for (let i = 0; i < 24; i++) {
      const ym = addMonthsToYM(startYM, i);
      html += `<option value="${ym}">${ymToLabel(ym)}</option>`;
    }
    monthSel.innerHTML = html;
    monthSel.value = toYM(now);
  }

  // wire internos (una sola vez)
  if (!modal.dataset.wired) {
    modal.dataset.wired = '1';

    $('#cycleCardSelect')?.addEventListener('change', syncCycleFormFromSelection);
    $('#cycleMonthSelect')?.addEventListener('change', syncCycleFormFromSelection);

    $('#saveCycleBtn')?.addEventListener('click', () => {
      const cardId = $('#cycleCardSelect')?.value;
      const ym = $('#cycleMonthSelect')?.value;
      const close = $('#cycleCloseDate')?.value;
      const due = $('#cycleDueDate')?.value;
      if (!cardId || !ym) return showAlert('Elegí tarjeta y mes', 'warning');
      if (!close || !due) return showAlert('Completá cierre y vencimiento', 'warning');

      const overrides = getCycleOverrides();
      overrides[cardId] = overrides[cardId] || {};
      overrides[cardId][ym] = { close, due };
      saveCycleOverrides(overrides);

      showAlert('Cierre del mes guardado', 'success');
      renderCycleOverridesList(cardId);
      loadProjections(); // refrescar proyecciones
    });

    $('#clearCycleBtn')?.addEventListener('click', () => {
      const cardId = $('#cycleCardSelect')?.value;
      const ym = $('#cycleMonthSelect')?.value;
      if (!cardId || !ym) return showAlert('Elegí tarjeta y mes', 'warning');

      const overrides = getCycleOverrides();
      if (overrides?.[cardId]?.[ym]) {
        delete overrides[cardId][ym];
        if (Object.keys(overrides[cardId]).length === 0) delete overrides[cardId];
        saveCycleOverrides(overrides);
        showAlert('Volviste a los valores por defecto', 'info');
      } else {
        showAlert('Ese mes no tenía override guardado', 'info');
      }
      syncCycleFormFromSelection();
      renderCycleOverridesList(cardId);
      loadProjections();
    });
  }

  // set defaults based on current selection
  syncCycleFormFromSelection();

  modal.classList.add('active');
}

function syncCycleFormFromSelection() {
  const cardId = $('#cycleCardSelect')?.value;
  const ym = $('#cycleMonthSelect')?.value;

  const closeInput = $('#cycleCloseDate');
  const dueInput = $('#cycleDueDate');

  if (!closeInput || !dueInput) return;

  // si no hay tarjeta, limpiar
  if (!cardId || !ym) {
    closeInput.value = '';
    dueInput.value = '';
    $('#cycleOverridesList').innerHTML = `<div class="p-4 text-sm text-gray-500">Seleccioná una tarjeta para ver/editar cierres.</div>`;
    return;
  }

  const card = (APP_STATE.data.tarjetas || []).find(c => String(c.id ?? c.tarjeta_id ?? '') === String(cardId));
  if (!card) return;

  const overrides = getCycleOverrides();
  const ov = overrides?.[String(cardId)]?.[ym];

  if (ov?.close && ov?.due) {
    closeInput.value = ov.close;
    dueInput.value = ov.due;
  } else {
    const { closeDate, dueDate } = getCloseInfoForMonth(card, ym);
    closeInput.value = closeDate.toISOString().slice(0,10);
    dueInput.value = dueDate.toISOString().slice(0,10);
  }

  renderCycleOverridesList(String(cardId));
}

function renderCycleOverridesList(cardId) {
  const box = $('#cycleOverridesList');
  if (!box) return;

  const overrides = getCycleOverrides();
  const months = overrides?.[cardId] ? Object.keys(overrides[cardId]).sort() : [];

  if (months.length === 0) {
    box.innerHTML = `<div class="p-4 text-sm text-gray-500">No hay cierres personalizados guardados para esta tarjeta.</div>`;
    return;
  }

  box.innerHTML = months.map(ym => {
    const item = overrides[cardId][ym];
    const close = item?.close || '';
    const due = item?.due || '';
    return `
      <div class="cycle-row">
        <div class="flex-1">
          <div class="title">${ymToLabel(ym)}</div>
          <div class="meta">Cierre: ${formatDate(close)} • Vence: ${formatDate(due)}</div>
        </div>
        <div class="actions flex gap-2">
          <button class="btn btn-secondary px-3 py-1 rounded border border-gray-300 hover:bg-gray-50" type="button"
            onclick="(function(){ try{ document.getElementById('cycleMonthSelect').value='${ym}'; syncCycleFormFromSelection(); }catch(e){} })()">
            Editar
          </button>
          <button class="btn btn-danger px-3 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50" type="button"
            onclick="(function(){ try{ const o=getCycleOverrides(); delete o['${cardId}']['${ym}']; if(Object.keys(o['${cardId}']).length===0) delete o['${cardId}']; saveCycleOverrides(o); renderCycleOverridesList('${cardId}'); syncCycleFormFromSelection(); loadProjections(); }catch(e){} })()">
            Borrar
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openInviteModal() {
  $('#inviteModal')?.classList.add('active');
}

function openAcceptInviteModal() {
  $('#acceptInviteModal')?.classList.add('active');
  loadPendingInvites().catch(err => console.error('Error cargando invitaciones:', err));
}

async function loadPendingInvites() {
  const modal = $('#acceptInviteModal');
  const body = modal?.querySelector('.modal-body');
  if (!body) return;

  // contenedor dinámico
  let box = body.querySelector('#pendingInvitesBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'pendingInvitesBox';
    box.className = 'mt-4';
    body.appendChild(box);
  }

  // limpiar
  box.innerHTML = '<div class="text-sm text-gray-500">Buscando invitaciones pendientes...</div>';

  if (!APP_STATE.user?.email) {
    box.innerHTML = '<div class="text-sm text-red-600">No se pudo identificar tu sesión.</div>';
    return;
  }

  try {
    const res = await APIService.leer('invitaciones', {
      email_to: normEmail(APP_STATE.user.email),
      estado: 'pendiente'
    });

    const list = Array.isArray(res) ? res : (res?.datos || []);
    if (!list || list.length === 0) {
      box.innerHTML = '<div class="text-sm text-gray-500">No tenés invitaciones pendientes.</div>';
      return;
    }

    box.innerHTML = `
      <div class="text-sm font-semibold text-gray-800 mb-2">Invitaciones pendientes</div>
      <div class="space-y-2">
        ${list.map(inv => `
          <div class="flex items-center justify-between border rounded-lg p-3 bg-gray-50">
            <div class="text-sm">
              <div class="text-gray-900"><b>De:</b> ${escapeHTML(inv.email_from || '')}</div>
              <div class="text-gray-600"><b>ID:</b> ${escapeHTML(inv.id || '')}</div>
            </div>
            <button class="btn btn-primary btn-sm" data-accept-invite="${escapeHTML(inv.id || '')}">
              Aceptar
            </button>
          </div>
        `).join('')}
      </div>
      <div class="text-xs text-gray-500 mt-2">Tip: si preferís, también podés pegar el ID en el campo de arriba.</div>
    `;

    // event delegation dentro del modal
    box.querySelectorAll('[data-accept-invite]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-accept-invite');
        if (id) await acceptInviteById(id);
      });
    });

  } catch (err) {
    console.error(err);
    box.innerHTML = '<div class="text-sm text-red-600">Error cargando invitaciones.</div>';
  }
}

async function acceptInviteById(invitationId) {
  if (!invitationId) return;
  showLoading(true);
  try {
    const result = await APIService.aceptarInvitacion(invitationId);
    if (result.success) {
      showAlert('¡Pareja vinculada exitosamente!', 'success');
      closeModal('acceptInviteModal');
      await reloadData();
      await loadSharedSection();
    } else {
      showAlert(result.message || 'Error al aceptar la invitación', 'danger');
    }
  } catch (err) {
    console.error('Error aceptando invitación:', err);
    showAlert('Error al aceptar la invitación', 'danger');
  } finally {
    showLoading(false);
  }
}



async function saveIncome() {
  const form = $('#incomeForm');
  if (!form) return;
  if (incomeSaveInFlight) return;
  incomeSaveInFlight = true;
  const btn = $('#saveIncomeBtn');
  if (btn) btn.disabled = true;
  
  showLoading(true);
  
  const formData = new FormData(form);
  const incomeData = {
    descripcion: formData.get('descripcion'),
    monto: formData.get('monto'),
    frecuencia: formData.get('frecuencia'),
    fecha: formData.get('fecha'),
    categoria: formData.get('categoria')
  };
  
  const incomeId = formData.get('id');
  
  try {
    let result;
    if (incomeId) {
      result = await APIService.actualizar('ingresos', incomeId, incomeData);
    } else {
      result = await APIService.crear('ingresos', incomeData);
    }
    
    if (result.success) {
      showAlert('Ingreso guardado exitosamente', 'success');
      closeModal('incomeModal');
      await reloadData();
      loadIncomes();
    } else {
      showAlert(result.message || 'Error al guardar el ingreso', 'danger');
    }
  } catch (err) {
    console.error('Error guardando ingreso:', err);
    showAlert('Error al guardar el ingreso', 'danger');
  } finally {
    showLoading(false);
    const btn2 = $('#saveIncomeBtn');
    if (btn2) btn2.disabled = false;
    incomeSaveInFlight = false;
  }
}

async function saveExpense() {
  const form = $('#expenseForm');
  if (!form) return;
  if (expenseSaveInFlight) return;
  expenseSaveInFlight = true;
  const btn = $('#saveExpenseBtn');
  if (btn) btn.disabled = true;
  
  showLoading(true);
  
  const formData = new FormData(form);
  const descripcion = formData.get('descripcion');
  const montoTotal = parseFloat(formData.get('monto')) || 0;
  const fecha = formData.get('fecha');
  const categoria = formData.get('categoria');
  const tipo = formData.get('tipo');
  const metodo_pago = formData.get('metodo_pago');
  const tarjeta_id = formData.get('tarjeta_id');
  const cuotas = parseInt(formData.get('cuotas')) || 1;
  const isShared = formData.get('compartido') === 'on';
  const porcentaje_tu = isShared ? (parseFloat(formData.get('porcentaje_tu')) || 50) : 100;
  
  const expenseId = formData.get('id');
  
  try {
    let result;
    
    if (expenseId) {
      // Editar gasto existente (simplificado por ahora)
      const expenseData = {
        descripcion,
        monto: montoTotal,
        fecha,
        categoria,
        tipo,
        metodo_pago,
        tarjeta_id: tipo === 'credit' ? tarjeta_id : '',
        cuotas: tipo === 'credit' ? cuotas : ''
      };
      
      if (isShared) {
        expenseData.compartido = 'true';
        expenseData.porcentaje_tu = porcentaje_tu;
        result = await APIService.actualizar('gastos_compartidos', expenseId, expenseData);
      } else {
        result = await APIService.actualizar('gastos', expenseId, expenseData);
      }
      
    } else {
      // NUEVO GASTO
      
      // Si es gasto a crédito con cuotas > 1
      if (tipo === 'credit' && cuotas > 1) {
        const cuotaMensual = montoTotal / cuotas;
        const createdIds = [];
        
        // Crear un gasto por cada cuota
        const fechaBase = new Date(fecha);
        
        for (let i = 0; i < cuotas; i++) {
          const fechaCuota = new Date(fechaBase);
          fechaCuota.setMonth(fechaCuota.getMonth() + i);
          const fechaCuotaStr = fechaCuota.toISOString().split('T')[0];
          
          const expenseData = {
            descripcion: `${descripcion}`,
            monto: cuotaMensual,
            fecha: fechaCuotaStr,
            categoria,
            tipo: 'credit',
            metodo_pago,
            tarjeta_id,
            cuotas: 1, // Cada registro es una cuota individual
            cuota_actual: i + 1,
            cuotas_totales: cuotas,
            monto_total: montoTotal, // Guardar el monto total original
            es_cuota: 'true'
          };
          
          if (isShared) {
            expenseData.compartido = 'true';
            expenseData.porcentaje_tu = porcentaje_tu;

            const partnerEmail = getPartnerEmail();
            if (!partnerEmail) {
              showAlert('Primero debes vincular una pareja para registrar gastos compartidos.', 'warning');
              break;
            }
            expenseData.email_pareja = partnerEmail;

            // Guardar metadata (crédito/cuotas/tarjeta) dentro de "estado"
            expenseData.estado = buildSharedMeta({
              tipo: 'credit',
              metodo_pago: metodo_pago || 'credit',
              tarjeta_id: tarjeta_id || '',
              cuota_actual: i + 1,
              cuotas_totales: cuotas,
              monto_total: montoTotal,
              es_cuota: true
            });

            // Para gastos compartidos a crédito: crear en GASTOS_COMPARTIDOS
            const sharedResult = await APIService.crear('gastos_compartidos', expenseData);
            if (sharedResult.success) createdIds.push(sharedResult.id);

            // Crear espejo para que la otra persona lo vea en su sesión (y quede "balanceado")
            if (partnerEmail) {
              const mirror = { ...expenseData };
              delete mirror.id;
              mirror.email_pareja = APP_STATE.user.email;
              mirror.porcentaje_tu = (100 - (porcentaje_tu || 50));
              await APIService.callAPI('crear', { tabla: 'gastos_compartidos', userEmail: partnerEmail, ...mirror });
            }

          } else {
            // Gasto normal a crédito
            const gastoResult = await APIService.crear('gastos', expenseData);
            if (gastoResult.success) createdIds.push(gastoResult.id);
          }
        }
        
        result = { 
          success: true, 
          message: `Gasto creado en ${cuotas} cuotas de ${fmtMoney(cuotaMensual)} cada una`,
          ids: createdIds 
        };
        
      } else {
        // GASTO SIN CUOTAS (o 1 cuota)
        const expenseData = {
          descripcion,
          monto: montoTotal,
          fecha,
          categoria,
          tipo,
          metodo_pago,
          tarjeta_id: tipo === 'credit' ? tarjeta_id : '',
          cuotas: tipo === 'credit' ? cuotas : '',
          cuota_actual: 1,
          cuotas_totales: cuotas,
          monto_total: montoTotal,
          es_cuota: cuotas > 1 ? 'true' : 'false'
        };
        
        if (isShared) {
          expenseData.compartido = 'true';
          expenseData.porcentaje_tu = porcentaje_tu;

          const partnerEmail = getPartnerEmail();
          if (!partnerEmail) {
            showAlert('Primero debes vincular una pareja para registrar gastos compartidos.', 'warning');
            result = { success: false, message: 'No hay pareja vinculada' };
          } else {
            expenseData.email_pareja = partnerEmail;

            // Guardar metadata en "estado" (para que el frontend sepa si es crédito/cuotas)
            const meta = {
              tipo: tipo,
              metodo_pago: metodo_pago || (tipo === 'credit' ? 'credit' : 'cash'),
              tarjeta_id: (tipo === 'credit' ? (tarjeta_id || '') : ''),
              cuota_actual: 1,
              cuotas_totales: cuotas || 1,
              monto_total: montoTotal,
              es_cuota: (tipo === 'credit' && (cuotas || 1) > 1)
            };
            expenseData.estado = buildSharedMeta(meta);

            // Gasto compartido: crear en GASTOS_COMPARTIDOS
            const sharedResult = await APIService.crear('gastos_compartidos', expenseData);
            result = sharedResult;

            // Crear espejo para que la otra persona lo vea en su sesión
            if (partnerEmail) {
              const mirror = { ...expenseData };
              delete mirror.id;
              mirror.email_pareja = APP_STATE.user.email;
              mirror.porcentaje_tu = (100 - (porcentaje_tu || 50));
              await APIService.callAPI('crear', { tabla: 'gastos_compartidos', userEmail: partnerEmail, ...mirror });
            }
          }

        } else {
          // Gasto normal
          result = await APIService.crear('gastos', expenseData);
        }
      }
    }
    
    if (result.success) {
      showAlert(result.message, 'success');
      closeModal('expenseModal');
      await reloadData();
      
      // Actualizar la sección correspondiente
      if (APP_STATE.currentSection === 'expenses') {
        loadExpenses();
      } else if (APP_STATE.currentSection === 'shared') {
        loadSharedSection();
      } else if (APP_STATE.currentSection === 'projections') {
        loadProjections();
      }
    } else {
      showAlert(result.message || 'Error al guardar el gasto', 'danger');
    }
  } catch (err) {
    console.error('Error guardando gasto:', err);
    showAlert('Error al guardar el gasto', 'danger');
  } finally {
    showLoading(false);
    const btn2 = $('#saveExpenseBtn');
    if (btn2) btn2.disabled = false;
    expenseSaveInFlight = false;
  }
}


async function saveCard() {
  const form = $('#cardForm');
  if (!form) return;

  showLoading(true);

  const formData = new FormData(form);
  const cardData = {
    banco: (formData.get('banco') || '').toString().trim(),
    ultimos_4: (formData.get('ultimos_4') || '').toString().trim(),
    limite_credito: toNumber(formData.get('limite_credito')),
    dia_cierre: parseInt(formData.get('dia_cierre') || '15', 10),
    dia_vencimiento: parseInt(formData.get('dia_vencimiento') || '5', 10),
    tipo: (formData.get('tipo') || 'visa').toString()
  };

  // Validaciones mínimas
  if (!cardData.banco) {
    showAlert('Indicá el banco', 'warning');
    showLoading(false);
    return;
  }
  if (!/^[0-9]{4}$/.test(cardData.ultimos_4)) {
    showAlert('Los "últimos 4" deben ser 4 dígitos', 'warning');
    showLoading(false);
    return;
  }
  if (!(cardData.dia_cierre >= 1 && cardData.dia_cierre <= 31)) {
    showAlert('Día de cierre inválido (1 a 31)', 'warning');
    showLoading(false);
    return;
  }
  if (!(cardData.dia_vencimiento >= 1 && cardData.dia_vencimiento <= 31)) {
    showAlert('Día de vencimiento inválido (1 a 31)', 'warning');
    showLoading(false);
    return;
  }

  const cardId = formData.get('id');

  try {
    let result;
    if (cardId) {
      result = await APIService.actualizar('tarjetas', cardId, cardData);
    } else {
      result = await APIService.crear('tarjetas', cardData);
    }

    if (result.success) {
      showAlert('Tarjeta guardada exitosamente', 'success');
      closeModal('cardModal');
      await reloadData();
      loadCards();
      // si estás en proyecciones, refresca también
      if (APP_STATE.currentSection === 'projections') {
        loadProjections();
      }
    } else {
      showAlert(result.message || 'Error al guardar la tarjeta', 'error');
    }
  } catch (err) {
    console.error(err);
    showAlert('Error al guardar la tarjeta', 'error');
  } finally {
    showLoading(false);
  }
}



async function sendInvite() {
  const email = $('#partnerEmail')?.value?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAlert('Ingresa un email válido', 'warning');
    return;
  }
  if (!APP_STATE.user?.email) {
    showAlert('No se pudo identificar tu sesión. Cierra sesión e ingresa de nuevo.', 'danger');
    return;
  }
  if (normEmail(email) === normEmail(APP_STATE.user.email)) {
    showAlert('No puedes invitar tu propio email', 'warning');
    return;
  }

  showLoading(true);

  try {
    // ⚠️ Code.gs NO autocompleta id/email_from/código en invitaciones.
    const invitationId = 'inv_' + (crypto?.randomUUID ? crypto.randomUUID() : (Date.now() + '_' + Math.random().toString(16).slice(2)));
    const codigo = Math.random().toString(36).slice(2, 8).toUpperCase();
    const now = new Date().toISOString();

    const payload = {
      id: invitationId,
      email_from: normEmail(APP_STATE.user.email),
      email_to: normEmail(email),
      codigo,
      estado: 'pendiente',
      creado_en: now,
      aceptado_en: ''
    };

    const result = await APIService.crearInvitacion(payload);

    if (result.success) {
      showAlert(`Invitación enviada a ${email}. Código: ${codigo} | ID: ${invitationId}`, 'success');
      closeModal('inviteModal');
    } else {
      showAlert(result.message || 'Error al enviar la invitación', 'danger');
    }
  } catch (err) {
    console.error('Error enviando invitación:', err);
    showAlert('Error al enviar la invitación', 'danger');
  } finally {
    showLoading(false);
  }
}


async function acceptInvite() {
  const raw = ($('#inviteCode')?.value || '').toString().trim();
  if (!raw) {
    showAlert('Ingresa el código de invitación.', 'warning');
    return;
  }

  showLoading(true);
  try {
    let inv = null;

    if (/^inv_[\w-]+$/i.test(raw)) {
      const list = await APIService.leer('invitaciones', { id: raw });
      inv = (list && list.length) ? list[0] : null;
    } else {
      const myEmail = normEmail(APP_STATE.user?.email || '');
      const list = await APIService.leer('invitaciones', {
        estado: 'pendiente',
        codigo: raw,
        email_from: myEmail
      });
      inv = (list && list.length) ? list[list.length - 1] : null;
    }

    if (!inv) {
      showAlert('No se encontró una invitación pendiente con ese código (enviada por tu cuenta).', 'warning');
      return;
    }

    const emailFrom = normEmail(inv.email_from || '');
    const emailTo = normEmail(inv.email_to || '');
    const estado = String(inv.estado || '').toLowerCase();

    if (estado !== 'pendiente') {
      showAlert('Esa invitación ya no está pendiente.', 'info');
      return;
    }

    const myEmail = normEmail(APP_STATE.user?.email || '');
    if (emailFrom && myEmail && emailFrom !== myEmail) {
      showAlert('Este código no corresponde a una invitación enviada por tu cuenta.', 'danger');
      return;
    }

    if (!emailTo) {
      showAlert('La invitación no tiene email_to. Revisa la invitación en la hoja.', 'danger');
      return;
    }

    // Crear usuario invitado si no existe (password inicial = código)
    try {
      await APIService.register(emailTo, raw, '', 'ARS');
    } catch (_) {}

    // Aceptar invitación en nombre del email invitado
    const result = await APIService.callAPI('aceptar_invitacion', { invitationId: inv.id, userEmail: emailTo });

    if (result && result.success) {
      showAlert('¡Pareja vinculada exitosamente!', 'success');
      closeModal('acceptInviteModal');
      await reloadData();
      await loadSharedSection();
    } else {
      showAlert((result && result.message) ? result.message : 'Error al aceptar la invitación', 'danger');
    }
  } catch (err) {
    console.error('Error aceptando invitación:', err);
    showAlert('Error al aceptar la invitación', 'danger');
  } finally {
    showLoading(false);
  }
}



async function deleteIncome(incomeId) {
  if (!confirm('¿Eliminar este ingreso?')) return;
  
  showLoading(true);
  
  try {
    const result = await APIService.eliminar('ingreso', incomeId);
    if (result.success) {
      showAlert('Ingreso eliminado', 'success');
      await reloadData();
      loadIncomes();
    } else {
      showAlert(result.message || 'Error al eliminar el ingreso', 'danger');
    }
  } catch (err) {
    console.error('Error eliminando ingreso:', err);
    showAlert('Error al eliminar el ingreso', 'danger');
  } finally {
    showLoading(false);
  }
}

async function deleteExpense(expenseId) {
  if (!confirm('¿Eliminar este gasto?')) return;
  
  showLoading(true);
  
  try {
    const result = await APIService.eliminar('gasto', expenseId);
    if (result.success) {
      showAlert('Gasto eliminado', 'success');
      await reloadData();
      loadExpenses();
    } else {
      showAlert(result.message || 'Error al eliminar el gasto', 'danger');
    }
  } catch (err) {
    console.error('Error eliminando gasto:', err);
    showAlert('Error al eliminar el gasto', 'danger');
  } finally {
    showLoading(false);
  }
}

async function deleteCard(cardId) {
  if (!confirm('¿Eliminar esta tarjeta?')) return;
  
  showLoading(true);
  
  try {
    const result = await APIService.eliminar('tarjetas', cardId);
    if (result.success) {
      showAlert('Tarjeta eliminada', 'success');
      await reloadData();
      loadCards();
    } else {
      showAlert(result.message || 'Error al eliminar la tarjeta', 'danger');
    }
  } catch (err) {
    console.error('Error eliminando tarjeta:', err);
    showAlert('Error al eliminar la tarjeta', 'danger');
  } finally {
    showLoading(false);
  }
}

async function deleteSharedExpense(id) {
  if (!confirm('¿Eliminar este gasto compartido?')) return;
  
  showLoading(true);
  
  try {
    const result = await APIService.eliminar('gastos_compartidos', id);
    if (result.success) {
      showAlert('Gasto compartido eliminado', 'success');
      await reloadData();
      loadSharedSection();
    } else {
      showAlert(result.message || 'Error al eliminar el gasto compartido', 'danger');
    }
  } catch (err) {
    console.error('Error eliminando gasto compartido:', err);
    showAlert('Error al eliminar el gasto compartido', 'danger');
  } finally {
    showLoading(false);
  }
}

// =========================================================
// OTRAS SECCIONES
// =========================================================

async function loadCards() {
  const list = $('#cardsList');
  if (!list) return;
  
  try {
    APP_STATE.data.tarjetas = await APIService.leer('tarjetas');
  } catch (err) {
    console.error('Error cargando tarjetas:', err);
  }
  
  const tarjetas = APP_STATE.data.tarjetas || [];
  
  if (tarjetas.length === 0) {
    list.innerHTML = `
      <div class="p-6 text-center text-gray-500">
        <i class="fas fa-credit-card text-4xl mb-3"></i>
        <p class="mb-3">No tienes tarjetas registradas</p>
        <button class="btn btn-accent btn-sm bg-primary text-white px-3 py-1 rounded text-sm hover:bg-teal-700" onclick="openCardModal()">
          <i class="fas fa-plus"></i> Agregar primera tarjeta
        </button>
      </div>`;
    return;
  }
  
  let html = '';
  tarjetas.forEach(tarjeta => {
    const tipoMap = {
      'visa': 'Visa',
      'mastercard': 'Mastercard',
      'amex': 'American Express',
      'other': 'Otra'
    };
    const tipo = tipoMap[tarjeta.tipo] || tarjeta.tipo;
    
    html += `
      <div class="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded flex items-center justify-center">
            <i class="fas fa-credit-card text-white"></i>
          </div>
          <div>
            <div class="font-semibold">${escapeHtml(tarjeta.banco || 'Tarjeta')}</div>
            <div class="text-xs text-gray-500">
              ${escapeHtml(tipo)} • **** ${escapeHtml(tarjeta.ultimos_4 || '0000')}
            </div>
            <div class="text-xs text-gray-500 mt-1">
              Cierre: día ${tarjeta.dia_cierre} • Vencimiento: día ${tarjeta.dia_vencimiento}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="font-bold text-gray-900">${fmtMoney(tarjeta.limite_credito || 0)}</div>
            <div class="text-xs text-gray-500">Límite</div>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-sm btn-secondary bg-gray-200 text-gray-700 px-2 py-1 rounded text-sm hover:bg-gray-300" onclick="editCard('${tarjeta.id}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-sm btn-danger bg-red-100 text-red-700 px-2 py-1 rounded text-sm hover:bg-red-200" onclick="deleteCard('${tarjeta.id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>`;
  });
  
  list.innerHTML = html;
}

async function loadReports() {
  const ingresos = APP_STATE.data.ingresos || [];
  const gastos = APP_STATE.data.gastos || [];
  const gastosCompartidos = APP_STATE.data.gastos_compartidos || [];
  
  const currentYear = new Date().getFullYear();
  const ingresosAnuales = ingresos
    .filter(i => {
      try {
        return new Date(i.fecha).getFullYear() === currentYear;
      } catch {
        return false;
      }
    })
    .reduce((sum, i) => sum + (parseAmount(i.monto) || 0), 0);
  
  const gastosAnuales = [...gastos, ...gastosCompartidos]
    .filter(g => {
      try {
        return new Date(g.fecha).getFullYear() === currentYear;
      } catch {
        return false;
      }
    })
    .reduce((sum, g) => sum + (parseAmount(g.monto) || 0), 0);
  
  const balanceAnual = ingresosAnuales - gastosAnuales;
  const ahorroTotal = balanceAnual > 0 ? balanceAnual : 0;
  
  setText('yearlyBalance', fmtMoney(balanceAnual));
  setText('totalSavings', fmtMoney(ahorroTotal));
  setText('monthlyAverage', fmtMoney(gastosAnuales / 12));
}

function loadSettings() {
  const profileName = $('#profileName');
  const profileEmail = $('#profileEmail');
  const profileCurrency = $('#profileCurrency');
  
  if (profileName) profileName.value = APP_STATE.user?.name || '';
  if (profileEmail) profileEmail.value = APP_STATE.user?.email || '';
  if (profileCurrency) profileCurrency.value = APP_STATE.user?.currency || CONFIG.DEFAULT_CURRENCY;
  
  loadCategories();
}

async function loadCategories() {
  const list = $('#categoriesList');
  if (!list) return;
  
  const categorias = APP_STATE.data.categorias || [];
  
  if (categorias.length === 0) {
    list.innerHTML = `
      <div class="text-center text-gray-500 py-4">
        <p>No hay categorías configuradas</p>
      </div>`;
    return;
  }
  
  let html = '';
  categorias.forEach(cat => {
    const tipoMap = {
      'income': 'Ingreso',
      'fixed': 'Fijo',
      'variable': 'Variable'
    };
    const tipo = tipoMap[cat.tipo] || cat.tipo;
    const tipoColor = cat.tipo === 'income' ? 'success' : 
                     cat.tipo === 'fixed' ? 'primary' : 'warning';
    
    html += `
      <div class="flex items-center justify-between p-2 border border-gray-200 rounded">
        <div class="flex items-center gap-3">
          <span class="badge badge-${tipoColor}">${tipo}</span>
          <span class="font-medium">${escapeHtml(cat.nombre)}</span>
        </div>
        <div class="flex gap-1">
          <button class="btn btn-sm btn-secondary bg-gray-200 text-gray-700 px-2 py-1 rounded text-sm hover:bg-gray-300">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger bg-red-100 text-red-700 px-2 py-1 rounded text-sm hover:bg-red-200" onclick="deleteCategory('${cat.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>`;
  });
  
  list.innerHTML = html;
}

async function saveProfile() {
  const name = $('#profileName')?.value?.trim();
  const currency = $('#profileCurrency')?.value;
  
  if (!name) {
    showAlert('El nombre es requerido', 'warning');
    return;
  }
  
  showLoading(true);
  
  try {
    const result = await APIService.actualizarPerfil({
      nombre: name,
      moneda: currency
    });
    
    if (result.success) {
      APP_STATE.user.name = name;
      APP_STATE.user.currency = currency;
      
      localStorage.setItem('financeapp_user', JSON.stringify(APP_STATE.user));
      updateUserUI();
      
      showAlert('Perfil actualizado exitosamente', 'success');
    } else {
      showAlert(result.message || 'Error al actualizar el perfil', 'danger');
    }
  } catch (err) {
    console.error('Error actualizando perfil:', err);
    showAlert('Error al actualizar el perfil', 'danger');
  } finally {
    showLoading(false);
  }
}

function changePassword() {
  const newPassword = $('#newPassword')?.value;
  const confirmPassword = $('#confirmPassword')?.value;
  
  if (!newPassword || !confirmPassword) {
    showAlert('Completa ambos campos de contraseña', 'warning');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showAlert('Las contraseñas no coinciden', 'warning');
    return;
  }
  
  if (newPassword.length < 6) {
    showAlert('La contraseña debe tener al menos 6 caracteres', 'warning');
    return;
  }
  
  showAlert('Para cambiar la contraseña, contacta al administrador o usa la opción de recuperación', 'info');
  
  $('#newPassword').value = '';
  $('#confirmPassword').value = '';
}

function exportData() {
  console.log('📤 Datos del usuario:', APP_STATE.user);
  console.log('📤 Todos los datos:', APP_STATE.data);
  showAlert('Función de exportación en desarrollo. Los datos se muestran en consola.', 'info');
}

function clearData() {
  if (!confirm('¿Estás seguro? Esto eliminará todos tus datos locales del navegador.')) return;
  
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('financeapp_'));
    keys.forEach(key => localStorage.removeItem(key));
    
    showAlert('Datos locales eliminados. La página se recargará.', 'warning');
    setTimeout(() => location.reload(), 1500);
  } catch (err) {
    console.error('Error eliminando datos locales:', err);
    showAlert('Error al eliminar datos locales', 'danger');
  }
}

// =========================================================
// FILTROS Y MODALES
// =========================================================

function setupFilters() {
  // Filtros de ingresos
  $('#applyIncomePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.incomes.month = $('#incomeMonthSelect')?.value || '';
    APP_STATE.filters.incomes.year = $('#incomeYearSelect')?.value || '';
    loadIncomes();
  });
  
  $('#clearIncomePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.incomes = { month: '', year: '' };
    $('#incomeMonthSelect').value = '';
    $('#incomeYearSelect').value = '';
    loadIncomes();
  });
  
  // Filtros de gastos
  $('#applyExpensePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.expenses.month = $('#expenseMonthSelect')?.value || '';
    APP_STATE.filters.expenses.year = $('#expenseYearSelect')?.value || '';
    APP_STATE.filters.expenses.category = $('#expenseFilter')?.value || 'all';
    loadExpenses();
  });
  
  $('#clearExpensePeriodBtn')?.addEventListener('click', () => {
    APP_STATE.filters.expenses = { month: '', year: '', category: 'all', tipo: 'all' };
    $('#expenseMonthSelect').value = '';
    $('#expenseYearSelect').value = '';
    $('#expenseFilter').value = 'all';
    $$('.tab').forEach(tab => tab.classList.remove('active'));
    $('.tab[data-tab="all"]')?.classList.add('active');
    loadExpenses();
  });
  
  // Tabs de gastos
  $$('.tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      APP_STATE.filters.expenses.tipo = tab.dataset.tab;
      loadExpenses();
    });
  });
  
  // Filtros de proyecciones
  // Filtro de mes (nuevo)
  $('#projectionMonthFilter')?.addEventListener('change', () => {
    APP_STATE.filters.projections.month = $('#projectionMonthFilter').value;
    loadProjections();
  });

  // (Compat) si todavía existe el filtro viejo de período, no rompe nada
  $('#projectionPeriodFilter')?.addEventListener('change', () => {
    APP_STATE.filters.projections.periodo = $('#projectionPeriodFilter').value;
    loadProjections();
  });
$('#projectionYearFilter')?.addEventListener('change', () => {
    APP_STATE.filters.projections.year = $('#projectionYearFilter').value;

    // Re-llenar meses según el año elegido
    const y = parseInt(APP_STATE.filters.projections.year || new Date().getFullYear(), 10) || new Date().getFullYear();
    const monthSel = $('#projectionMonthFilter');
    if (monthSel) {
      let htmlM = `<option value="">Todos los meses</option>`;
      for (let m = 1; m <= 12; m++) {
        const ym = `${y}-${pad2(m)}`;
        htmlM += `<option value="${ym}">${MONTHS_ES[m-1]}</option>`;
      }
      monthSel.innerHTML = htmlM;

      // Si el filtro actual no pertenece a ese año, ajustarlo al mes actual del año elegido
      const cur = monthSel.value || APP_STATE.filters.projections.month || '';
      if (!cur.startsWith(String(y) + '-')) {
        APP_STATE.filters.projections.month = `${y}-${pad2(new Date().getMonth()+1)}`;
      }
      monthSel.value = APP_STATE.filters.projections.month || '';
    }

    loadProjections();
  });
$('#projectionTypeFilter')?.addEventListener('change', () => {
    APP_STATE.filters.projections.tipo = $('#projectionTypeFilter').value;
    loadProjections();
  });


  // Delegación (evita que se rompan botones si la UI se re-renderiza)
  document.addEventListener('click', async (ev) => {
    const t = ev.target?.closest?.('button, a');
    if (!t) return;
    const id = t.id || '';
    if (id === 'addExpenseBtn') { ev.preventDefault(); openExpenseModal(); }
    if (id === 'addIncomeBtn') { ev.preventDefault(); openIncomeModal(); }
    if (id === 'addCardBtn') { ev.preventDefault(); openCardModal(); }
    if (id === 'openCyclesBtn') { ev.preventDefault(); openCyclesModal(); }

    // Aceptar invitación desde lista (solo si estás logueado con el email invitado)
    if (t.dataset?.action === 'acceptInvite') {
      ev.preventDefault();
      const invId = (t.dataset.inviteId || '').toString().trim();
      if (!invId) return;
      try {
        const res = await APIService.aceptarInvitacion(invId);
        showToast(res.success ? '✅ Invitación aceptada' : (res.message || 'No se pudo aceptar'), res.success ? 'success' : 'error');
        await refreshAllData();
        showSection('shared');
      } catch (e) {
        showToast('Error aceptando invitación', 'error');
      }
    }
  });
}

function setupModals() {
  // Cerrar modales al hacer clic en X o fuera
  $$('.modal-close').forEach(btn => {
    btn.addEventListener('click', function() {
      const modal = this.closest('.modal-overlay');
      if (modal) modal.classList.remove('active');
    });
  });
  
  $$('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('active');
    });
  });
  
  // Botones de guardar
  $('#saveIncomeBtn')?.addEventListener('click', saveIncome);
  $('#saveExpenseBtn')?.addEventListener('click', saveExpense);
  $('#saveCardBtn')?.addEventListener('click', saveCard);
  $('#sendInviteBtn')?.addEventListener('click', sendInvite);
  $('#acceptInviteConfirmBtn')?.addEventListener('click', acceptInvite);
  
  // Event listeners para campos dinámicos
  document.addEventListener('change', (e) => {
    if (e.target.name === 'tipo') {
      const creditCardFields = $('#creditCardFields');
      if (e.target.value === 'credit') {
        creditCardFields?.classList.remove('hidden');
      } else {
        creditCardFields?.classList.add('hidden');
      }
    }
    
    if (e.target.id === 'isSharedCheck') {
      const sharedFields = $('#sharedFields');
      if (e.target.checked) {
        sharedFields?.classList.remove('hidden');
      } else {
        sharedFields?.classList.add('hidden');
      }
    }
  });
}

function closeModal(modalId) {
  $(`#${modalId}`)?.classList.remove('active');
}

// =========================================================
// EXPORTAR FUNCIONES GLOBALES PARA onclick
// =========================================================

window.openIncomeModal = openIncomeModal;
window.openExpenseModal = openExpenseModal;
window.openCardModal = openCardModal;
window.openSharedExpenseModal = openSharedExpenseModal;
window.openInviteModal = openInviteModal;
window.openAcceptInviteModal = openAcceptInviteModal;
window.editIncome = openIncomeModal;
window.editExpense = openExpenseModal;
window.editCard = openCardModal;
window.deleteIncome = deleteIncome;
window.deleteExpense = deleteExpense;
window.deleteCard = deleteCard;
window.deleteSharedExpense = deleteSharedExpense;
window.deleteCategory = async function(id) {
  if (!confirm('¿Eliminar esta categoría?')) return;
  
  showLoading(true);
  
  try {
    const result = await APIService.eliminar('categoria', id);
    if (result.success) {
      showAlert('Categoría eliminada', 'success');
      await reloadData();
      loadCategories();
    } else {
      showAlert(result.message || 'Error al eliminar la categoría', 'danger');
    }
  } catch (err) {
    console.error('Error eliminando categoría:', err);
    showAlert('Error al eliminar la categoría', 'danger');
  } finally {
    showLoading(false);
  }
};

// Calcular cuota mensual automáticamente
document.addEventListener('input', (e) => {
  if (e.target.name === 'monto' || e.target.id === 'cuotasInput') {
    const montoInput = document.querySelector('input[name="monto"]');
    const cuotasInput = document.querySelector('input[name="cuotas"]');
    const cuotaPreview = document.getElementById('cuotaPreview');
    const cuotaMensual = document.getElementById('cuotaMensual');
    
    if (montoInput && cuotasInput && cuotaPreview && cuotaMensual) {
      const monto = parseFloat(montoInput.value) || 0;
      const cuotas = parseInt(cuotasInput.value) || 1;
      
      if (monto > 0 && cuotas > 1) {
        const cuotaMensualCalculada = monto / cuotas;
        cuotaMensual.textContent = fmtMoney(cuotaMensualCalculada);
        cuotaPreview.classList.remove('hidden');
      } else {
        cuotaPreview.classList.add('hidden');
      }
    }
  }
});
// =========================================================
// INICIALIZACIÓN COMPLETA
// =========================================================

console.log('✅ FinanceApp conectado al backend real');
console.log('🌐 API URL:', CONFIG.API_URL);
console.log('👤 Usuario:', APP_STATE.user);

// Configurar polling de notificaciones (singleton)
let __notifPollHandle = null;
function startNotifPolling_() {
  try { if (__notifPollHandle) clearInterval(__notifPollHandle); } catch(e) {}
  __notifPollHandle = setInterval(async () => {
    if (!APP_STATE.user) return;
    if (APP_STATE.__notifInFlight) return;

    const now = Date.now();
    const minMs = Math.max(15000, CONFIG.NOTIF_POLL_MS); // evita spam si el init se ejecuta varias veces
    if (APP_STATE.__lastNotifPoll && (now - APP_STATE.__lastNotifPoll) < minMs) return;

    APP_STATE.__lastNotifPoll = now;
    APP_STATE.__notifInFlight = true;
    try {
      const notificaciones = await APIService.leerNotificaciones();
      APP_STATE.data.notificaciones = notificaciones;
      updateNotifications();
    } catch (err) {
      // Silenciar error en polling
    } finally {
      APP_STATE.__notifInFlight = false;
    }
  }, CONFIG.NOTIF_POLL_MS);
}

startNotifPolling_();

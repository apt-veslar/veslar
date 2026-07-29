import {
  signInWithGoogle as coreSignInWithGoogle, signOutUser, watchAuth,
  subscribeBookings as coreSubscribeBookings, subscribeCustomers as coreSubscribeCustomers,
  saveBookingDoc, deleteBookingDoc, loadSettingsDoc, saveSettingsDoc,
} from './firebase-core.js';
import { calcComputeQuote, calcFmtEuro, calcFmtDateIt } from './pricing-calc.js';

let bookings = [];
let customers = [];
let prices = { 1:{base:120,weekend:160,high:200,low:90}, 2:{base:100,weekend:140,high:170,low:80} };
let extras = { cleaning:60, deposit:200 };
let unsubBookings = null;
let unsubCustomers = null;

const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const monthsShort = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const dayNames = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
const aptNames = { 1: 'Olbe', 2: 'Poch' };
const srcLabelIt = { airbnb:'Airbnb', booking:'Booking', manual:'Manuale' };

let dashYear = new Date().getFullYear();
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth(), calApt = 1;
let dayPopupDate = null;
let editingId = null;
window.bookingsPage = 1;
const BOOKINGS_PER_PAGE = 6;

// ---- AUTH ----
window.signInWithGoogle = async () => {
  try {
    await coreSignInWithGoogle();
  } catch(e) {
    const el = document.getElementById('login-error');
    el.style.display = 'block';
    el.textContent = 'Errore di accesso: ' + e.message;
  }
};

window.signOut = async () => {
  if(unsubBookings) unsubBookings();
  if(unsubCustomers) unsubCustomers();
  await signOutUser();
};

watchAuth(async (user) => {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  await loadSettings();
  subscribeBookings();
  subscribeCustomers();
  renderDashboard();
  renderPrices();
  try {
    const saved = localStorage.getItem('apt_theme');
    document.getElementById('theme-btn').textContent = saved === 'dark' ? '🌙' : '☀️';
  } catch(e){}
}, () => {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
});

// ---- SETTINGS ----
async function loadSettings() {
  const d = await loadSettingsDoc();
  if(d) {
    if(d.prices) prices = d.prices;
    if(d.extras) extras = d.extras;
  }
}

async function saveSettings() {
  showSaving(true);
  try {
    await saveSettingsDoc({ prices, extras });
  } catch(e) { toast('Errore nel salvataggio'); }
  showSaving(false);
}

// ---- BOOKINGS / CUSTOMERS REALTIME ----
// Mobile never runs the customer backfill (see plan): running it from two
// independently-loaded pages (desktop + mobile) would race across a network
// round-trip and could create duplicate customer records. Desktop remains
// the sole backfill owner; mobile only needs the customers subscription to
// feed the guest-name autocomplete datalist.
function subscribeBookings() {
  if(unsubBookings) unsubBookings();
  unsubBookings = coreSubscribeBookings((arr) => {
    bookings = arr;
    renderDashboard();
    renderBookings();
    if(document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
  });
}

function subscribeCustomers() {
  if(unsubCustomers) unsubCustomers();
  unsubCustomers = coreSubscribeCustomers((arr) => {
    customers = arr;
    renderCustomerDatalist();
  });
}

function renderCustomerDatalist(){
  const el = document.getElementById('customer-names-list');
  if(!el) return;
  el.innerHTML = customers.map(c=>`<option value="${c.name}"></option>`).join('');
}

// ---- HELPERS ----
function showSaving(v) { document.getElementById('saving-indicator').classList.toggle('show', v); }
function fmtDate(d) { const dd=new Date(d); return dd.getDate()+'/'+(dd.getMonth()+1); }
function fmtDateFull(d) { const dd=new Date(d); return dd.getDate()+' '+monthsShort[dd.getMonth()]+' '+dd.getFullYear(); }
window.toast = function(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
};

function bookingRowHtml(b, opts){
  opts = opts || {};
  const srcLabel = srcLabelIt[b.source] || b.source;
  return `
    <div class="m-booking-row">
      <div class="m-booking-top">
        <span class="badge badge-${b.source}">${srcLabel}</span>
        <span class="badge badge-apt${b.apt}">${aptNames[b.apt]||'Apt '+b.apt}</span>
        <span class="booking-guest">${b.guest}</span>
      </div>
      <div class="m-booking-mid">
        <span class="booking-dates">${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}</span>
        <span class="booking-amount">€${Number(b.amount||0).toLocaleString('it')}</span>
      </div>
      ${b.notes?`<div class="m-booking-notes">${b.notes}</div>`:''}
      <div class="m-booking-actions">
        <button class="btn btn-sm" onclick="${opts.editHandler||`editBooking('${b.id}')`}">✎ Modifica</button>
        ${opts.showDelete?`<button class="btn btn-sm btn-danger" onclick="deleteBooking('${b.id}')">✕ Elimina</button>`:''}
      </div>
    </div>`;
}

// ---- TABS ----
window.showTab = function(t) {
  document.querySelectorAll('.m-section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.m-nav-btn').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  document.getElementById('m-nav-'+t).classList.add('active');
  bookingsPage = 1;
  if(t==='calendario') renderCalendar();
  if(t==='dashboard') renderDashboard();
  if(t==='prenotazioni') renderBookings();
  if(t==='prezzi') renderPrices();
  if(t==='calcolatore') renderCalculator();
};

// ---- DASHBOARD ----
function renderDashboard() {
  const now = new Date();
  const cm=now.getMonth(), curYear=now.getFullYear();
  const thisMonthBooks = bookings.filter(b=>{ const ci=new Date(b.checkin); return ci.getMonth()===cm&&ci.getFullYear()===curYear; });
  const revMonth = thisMonthBooks.reduce((s,b)=>s+Number(b.amount||0),0);
  const nightsMonth = thisMonthBooks.reduce((s,b)=>s+Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000),0);
  const daysInMonth = new Date(curYear,cm+1,0).getDate();
  const occRate = Math.min(100,Math.round(nightsMonth/(daysInMonth*2)*100));

  document.getElementById('m-metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Ricavi ${monthsShort[cm]}</div><div class="metric-value">€${revMonth.toLocaleString('it')}</div><div class="metric-sub">questo mese</div></div>
    <div class="metric"><div class="metric-label">Notti prenotate</div><div class="metric-value">${nightsMonth}</div><div class="metric-sub">${monthsShort[cm]}</div></div>
    <div class="metric"><div class="metric-label">Tasso occupazione</div><div class="metric-value">${occRate}%</div><div class="metric-sub">media 2 apt</div></div>
    <div class="metric"><div class="metric-label">Prenotazioni totali</div><div class="metric-value">${bookings.length}</div><div class="metric-sub">tutti gli anni</div></div>`;

  document.getElementById('m-dash-year-label').textContent = dashYear;
  const cy = dashYear;
  const maxRev=Math.max(...monthsShort.map((_,i)=>bookings.filter(b=>new Date(b.checkin).getMonth()===i&&new Date(b.checkin).getFullYear()===cy).reduce((s,b)=>s+Number(b.amount||0),0)),1);
  document.getElementById('m-bar-chart').innerHTML = monthsShort.map((m,i)=>{
    const r1=bookings.filter(b=>b.apt===1&&new Date(b.checkin).getMonth()===i&&new Date(b.checkin).getFullYear()===cy).reduce((s,b)=>s+Number(b.amount||0),0);
    const r2=bookings.filter(b=>b.apt===2&&new Date(b.checkin).getMonth()===i&&new Date(b.checkin).getFullYear()===cy).reduce((s,b)=>s+Number(b.amount||0),0);
    const h1=Math.max(Math.round(r1/maxRev*80),3), h2=Math.max(Math.round(r2/maxRev*80),3);
    return `<div class="m-bar-month"><div class="m-bar-pair"><div class="m-bar" style="height:${h1}px;background:var(--apt1);" title="Olbe: €${r1}"></div><div class="m-bar" style="height:${h2}px;background:var(--apt2);" title="Poch: €${r2}"></div></div><div class="m-bar-label">${m}</div></div>`;
  }).join('');

  const upcoming=[...bookings].filter(b=>new Date(b.checkin)>=now).sort((a,b)=>new Date(a.checkin)-new Date(b.checkin)).slice(0,5);
  document.getElementById('m-upcoming-list').innerHTML = upcoming.length ? upcoming.map(b=>`
    <div class="booking-row">
      <span class="badge badge-${b.source}">${b.source}</span>
      <span class="badge badge-apt${b.apt}">${aptNames[b.apt]||'Apt '+b.apt}</span>
      <span class="booking-guest">${b.guest}</span>
      <span class="booking-dates">${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}</span>
      <span class="booking-amount">€${Number(b.amount||0).toLocaleString('it')}</span>
    </div>`).join('') : '<div class="empty">Nessuna prenotazione futura</div>';

  [1,2].forEach(a=>{
    const ab=bookings.filter(b=>b.apt===a&&new Date(b.checkin).getFullYear()===cy);
    const rev=ab.reduce((s,b)=>s+Number(b.amount||0),0);
    const nights=ab.reduce((s,b)=>s+Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000),0);
    document.getElementById('m-apt'+a+'-year-label').textContent = cy;
    document.getElementById('m-apt'+a+'-stats').innerHTML=`
      <div class="price-row"><span style="color:var(--text-sec);">Ricavi ${cy}</span><strong>€${rev.toLocaleString('it')}</strong></div>
      <div class="price-row"><span style="color:var(--text-sec);">Notti prenotate</span><strong>${nights}</strong></div>
      <div class="price-row"><span style="color:var(--text-sec);">Prenotazioni</span><strong>${ab.length}</strong></div>
      <div class="price-row" style="border:none;"><span style="color:var(--text-sec);">Media per notte</span><strong>${nights?'€'+Math.round(rev/nights):'-'}</strong></div>`;
  });
}

window.dashYearStep = function(dir){ dashYear += dir; renderDashboard(); };

// ---- CALENDAR ----
window.setApt = function(n){
  calApt = n;
  document.getElementById('m-aptab1').className = 'apt-tab'+(n===1?' active-apt1':'');
  document.getElementById('m-aptab2').className = 'apt-tab'+(n===2?' active-apt2':'');
  document.getElementById('m-aptab0').className = 'apt-tab'+(n===0?' active-apt1':'');
  renderCalendar();
};
window.setCalMonth = function(v){ calMonth=parseInt(v); renderCalendar(); };
window.setCalYear = function(v){ calYear=parseInt(v); renderCalendar(); };
window.calMonthStep = function(dir){
  calMonth+=dir;
  if(calMonth<0){calMonth=11;calYear--;}
  else if(calMonth>11){calMonth=0;calYear++;}
  renderCalendar();
};

function populateCalDropdowns(){
  const mSel=document.getElementById('m-cal-month-select');
  const ySel=document.getElementById('m-cal-year-select');
  if(!mSel.options.length){
    monthNames.forEach((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m;mSel.appendChild(o);});
  }
  mSel.value=calMonth;
  if(!ySel.options.length || !Array.from(ySel.options).find(o=>parseInt(o.value)===calYear)){
    ySel.innerHTML='';
    for(let y=calYear-3;y<=calYear+3;y++){const o=document.createElement('option');o.value=y;o.textContent=y;ySel.appendChild(o);}
  }
  ySel.value=calYear;
}

function renderCalendar(){
  populateCalDropdowns();
  const firstDay=new Date(calYear,calMonth,1);
  let startDow=firstDay.getDay(); startDow=startDow===0?6:startDow-1;
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const daysInPrev=new Date(calYear,calMonth,0).getDate();
  const today=new Date();
  const aptFilter = calApt===0 ? [1,2] : [calApt];
  let html=dayNames.map(d=>`<div class="m-cal-day-name">${d}</div>`).join('');
  for(let i=0;i<startDow;i++) html+=`<div class="m-cal-day other-month"><div class="m-cal-day-num">${daysInPrev-startDow+i+1}</div></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const isToday=new Date(ds).toDateString()===today.toDateString();
    const dayBooks=bookings.filter(b=>aptFilter.includes(b.apt)&&ds>=b.checkin&&ds<b.checkout);
    const aptClass = dayBooks.length ? ' cal-apt'+dayBooks[0].apt : '';
    const dots = dayBooks.slice(0,4).map(b=>{
      const color = b.source==='airbnb' ? 'var(--airbnb-dot)' : b.source==='booking' ? 'var(--booking-dot)' : 'var(--manual-dot)';
      return `<div class="m-cal-dot" style="background:${color};"></div>`;
    }).join('');
    html+=`<div class="m-cal-day${isToday?' today':''}${aptClass}" ${dayBooks.length?`onclick="openDayPopup('${ds}')"`:''}>
      <div class="m-cal-day-num">${d}</div>
      <div class="m-cal-dots">${dots}</div>
    </div>`;
  }
  const total=startDow+daysInMonth; const rem=total%7===0?0:7-(total%7);
  for(let i=1;i<=rem;i++) html+=`<div class="m-cal-day other-month"><div class="m-cal-day-num">${i}</div></div>`;
  document.getElementById('m-cal-grid').innerHTML=html;
}

window.openDayPopup = function(ds){
  const dayBooks = bookings.filter(b=>b.checkin<=ds && ds<b.checkout);
  if(!dayBooks.length) return;
  dayPopupDate = ds;
  document.getElementById('day-popup-date').textContent = fmtDateFull(ds);
  document.getElementById('day-popup-bookings').innerHTML = dayBooks.map(b=>bookingRowHtml(b,{
    editHandler: `closeDayPopup();editBooking('${b.id}')`,
  })).join('');
  document.getElementById('day-popup-overlay').classList.add('open');
};
window.closeDayPopup = function(){
  document.getElementById('day-popup-overlay').classList.remove('open');
  dayPopupDate = null;
};

// ---- PRENOTAZIONI (grouped by month, paginated by whole groups) ----
window.renderBookings = function(page){
  if(page !== undefined) bookingsPage = page;
  const aptF=document.getElementById('m-filter-apt')?.value||'all';
  const srcF=document.getElementById('m-filter-src')?.value||'all';
  let filtered=bookings.filter(b=>(aptF==='all'||b.apt===parseInt(aptF))&&(srcF==='all'||b.source===srcF));
  filtered.sort((a,b)=>new Date(b.checkin)-new Date(a.checkin));

  const groups = [];
  let curKey = null, curGroup = null;
  filtered.forEach(b=>{
    const d = new Date(b.checkin);
    const key = d.getFullYear()+'-'+d.getMonth();
    if(key !== curKey){
      curKey = key;
      curGroup = { label: monthNames[d.getMonth()]+' '+d.getFullYear(), items: [] };
      groups.push(curGroup);
    }
    curGroup.items.push(b);
  });

  const pages = [];
  let curPage = [], curCount = 0;
  groups.forEach(g=>{
    if(curCount>0 && curCount+g.items.length>BOOKINGS_PER_PAGE){
      pages.push(curPage);
      curPage = []; curCount = 0;
    }
    curPage.push(g);
    curCount += g.items.length;
  });
  if(curPage.length) pages.push(curPage);

  const totalPages = Math.max(1, pages.length);
  if(bookingsPage > totalPages) bookingsPage = totalPages;
  const pageGroups = pages[bookingsPage-1] || [];

  const el=document.getElementById('m-bookings-list');
  let html = pageGroups.length ? pageGroups.map(g=>
    `<div class="m-month-header">${g.label}</div>${g.items.map(b=>bookingRowHtml(b,{showDelete:true})).join('')}`
  ).join('') : '<div class="empty">Nessuna prenotazione trovata</div>';

  if(totalPages > 1){
    const p = bookingsPage;
    html += `<div class="pagination">
      <span>Pagina ${p} di ${totalPages}</span>
      <div class="pagination-pages">
        <button class="page-btn" onclick="renderBookings(${p-1})" ${p<=1?'disabled':''}>‹</button>
        <button class="page-btn" onclick="renderBookings(${p+1})" ${p>=totalPages?'disabled':''}>›</button>
      </div>
    </div>`;
  }
  el.innerHTML = html;
};

// ---- MODAL ----
window.openModal = function(){
  editingId = null;
  document.getElementById('modal-title').textContent = 'Nuova prenotazione';
  document.getElementById('m-checkin').value = new Date().toISOString().split('T')[0];
  document.getElementById('m-checkout').value = '';
  document.getElementById('m-guest').value = '';
  document.getElementById('m-amount').value = '';
  document.getElementById('m-notes').value = '';
  document.getElementById('m-guests-num').value = '';
  document.getElementById('m-apt').value = '';
  document.getElementById('m-source').value = 'manual';
  document.getElementById('modal-overlay').classList.add('open');
};

window.editBooking = function(id){
  const b = bookings.find(b=>b.id===id);
  if(!b) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Modifica prenotazione';
  document.getElementById('m-apt').value = b.apt;
  document.getElementById('m-guest').value = b.guest;
  document.getElementById('m-checkin').value = b.checkin;
  document.getElementById('m-checkout').value = b.checkout;
  document.getElementById('m-amount').value = b.amount||'';
  document.getElementById('m-source').value = b.source||'manual';
  document.getElementById('m-guests-num').value = b.guestsNum||'';
  document.getElementById('m-notes').value = b.notes||'';
  document.getElementById('modal-overlay').classList.add('open');
};

window.closeModal = function(){ document.getElementById('modal-overlay').classList.remove('open'); editingId=null; };

window.saveBooking = async function(){
  const aptVal=document.getElementById('m-apt').value;
  const guest=document.getElementById('m-guest').value.trim();
  const checkin=document.getElementById('m-checkin').value;
  const checkout=document.getElementById('m-checkout').value;
  const amount=parseFloat(document.getElementById('m-amount').value)||0;
  if(!aptVal){toast("Seleziona l'appartamento.");return;}
  if(!guest){toast('Inserisci il nome ospite.');return;}
  if(!checkin||!checkout){toast('Inserisci le date.');return;}
  if(new Date(checkout)<=new Date(checkin)){toast('Check-out deve essere dopo check-in.');return;}
  showSaving(true);
  try {
    const data = {
      apt:parseInt(aptVal),
      guest, checkin, checkout, amount,
      source:document.getElementById('m-source').value,
      notes:document.getElementById('m-notes').value,
      guestsNum:parseInt(document.getElementById('m-guests-num').value)||0,
    };
    await saveBookingDoc(data, editingId);
    toast(editingId ? 'Prenotazione aggiornata!' : 'Prenotazione salvata!');
    closeModal();
  } catch(e){ toast('Errore: '+e.message); }
  showSaving(false);
};

window.deleteBooking = async function(id){
  if(!confirm('Eliminare questa prenotazione?')) return;
  showSaving(true);
  try {
    await deleteBookingDoc(id);
    toast('Prenotazione eliminata');
  } catch(e){ toast('Errore: '+e.message); }
  showSaving(false);
};

// ---- PREZZI ----
function renderPrices(){
  [1,2].forEach(a=>{
    const p=prices[a]||{base:120,weekend:160,high:200,low:90};
    document.getElementById('m-prices-apt'+a).innerHTML=`
      <div class="price-row"><span>Tariffa base</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="mp${a}-base" value="${p.base}" min="0"><span class="price-unit">€/notte</span></div></div>
      <div class="price-row"><span>Weekend</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="mp${a}-weekend" value="${p.weekend}" min="0"><span class="price-unit">€/notte</span></div></div>
      <div class="price-row"><span>Alta stagione</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="mp${a}-high" value="${p.high}" min="0"><span class="price-unit">€/notte</span></div></div>
      <div class="price-row" style="border:none;"><span>Bassa stagione</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="mp${a}-low" value="${p.low}" min="0"><span class="price-unit">€/notte</span></div></div>`;
  });
  document.getElementById('m-price-cleaning').value = extras.cleaning||60;
  document.getElementById('m-price-deposit').value = extras.deposit||200;
}

window.savePrices = async function(){
  [1,2].forEach(a=>{
    prices[a] = {
      base:parseInt(document.getElementById('mp'+a+'-base').value)||0,
      weekend:parseInt(document.getElementById('mp'+a+'-weekend').value)||0,
      high:parseInt(document.getElementById('mp'+a+'-high').value)||0,
      low:parseInt(document.getElementById('mp'+a+'-low').value)||0,
    };
  });
  extras.cleaning = parseInt(document.getElementById('m-price-cleaning').value)||0;
  extras.deposit = parseInt(document.getElementById('m-price-deposit').value)||0;
  await saveSettings();
  toast('Tariffe salvate!');
};

// ---- CALCOLATORE ----
let calcApt = 1;
let calcCleaning = 50;
let calcLinens = false;
let calcInitialized = false;
let calcSummaryData = null;
let calcCopyTimeout = null;

window.setCalcApt = function(n){ calcApt=n; renderCalculator(); };
window.setCalcCleaning = function(v){ calcCleaning=v; renderCalculator(); };
window.toggleCalcLinens = function(){ calcLinens=!calcLinens; renderCalculator(); };

function renderCalculator(){
  if(!calcInitialized){
    calcInitialized = true;
    const t=new Date(); const t2=new Date(t); t2.setDate(t2.getDate()+7);
    document.getElementById('calc-checkin').value = t.toISOString().split('T')[0];
    document.getElementById('calc-checkout').value = t2.toISOString().split('T')[0];
    document.getElementById('calc-adults').value = 2;
    document.getElementById('calc-children').value = 0;
    document.getElementById('calc-discount').value = 0;
  }

  document.getElementById('calc-apt-toggle').innerHTML = [1,2].map(a=>
    `<button class="apt-tab${calcApt===a?' active-apt'+a:''}" onclick="setCalcApt(${a})">${a===1?'Olbe (Apt 1)':'Poch (Apt 2)'}</button>`
  ).join('');

  document.getElementById('calc-cleaning-options').innerHTML = [40,50,60].map(v=>
    `<button class="choice-pill${calcCleaning===v?' active':''}" onclick="setCalcCleaning(${v})">€${v}</button>`
  ).join('');

  document.getElementById('calc-linens-toggle').className = 'toggle-switch'+(calcLinens?' on':'');

  const checkin = document.getElementById('calc-checkin').value;
  const checkout = document.getElementById('calc-checkout').value;
  const adults = parseInt(document.getElementById('calc-adults').value)||0;
  const children = parseInt(document.getElementById('calc-children').value)||0;
  const discountInput = parseFloat(document.getElementById('calc-discount').value)||0;

  const badgeEl = document.getElementById('calc-badge');
  badgeEl.className = 'badge badge-apt'+calcApt;
  badgeEl.textContent = aptNames[calcApt];

  const body = document.getElementById('calc-preventivo-body');
  const platformsCard = document.getElementById('calc-platforms-card');
  const quote = calcComputeQuote({ apt:calcApt, checkin, checkout, adults, children, cleaning:calcCleaning, linens:calcLinens, discountInput });

  if(!quote){
    body.innerHTML = '<div class="empty">Seleziona un check-out successivo al check-in.</div>';
    platformsCard.style.display = 'none';
    calcSummaryData = null;
    return;
  }

  let html = `<div style="font-size:12px;color:var(--text-sec);margin-bottom:10px;">${quote.nightsCount} notti · ${calcFmtDateIt(checkin)} → ${calcFmtDateIt(checkout)}</div>`;
  quote.groups.forEach(g=>{
    html += `<div class="price-row"><span>Affitto — ${g.label} (${g.count} notti, ${calcFmtEuro(g.total/g.count)}/notte)</span><strong>${calcFmtEuro(g.total)}</strong></div>`;
  });
  if(quote.discount>0){
    html += `<div class="price-row"><span>Sconto</span><strong style="color:var(--airbnb-text);">−${calcFmtEuro(quote.discount)}</strong></div>`;
  }
  html += `<div class="price-row"><span>Pulizie</span><strong>${calcFmtEuro(quote.cleaning)}</strong></div>`;
  if(quote.linensCost>0){
    html += `<div class="price-row"><span>Lenzuola e asciugamani</span><strong>${calcFmtEuro(quote.linensCost)}</strong></div>`;
  }
  html += `<div class="price-row"><span>Tassa di soggiorno (${quote.adults} adulti × ${quote.taxNights} giorni)</span><strong>${calcFmtEuro(quote.tax)}</strong></div>`;
  html += `<div class="price-row" style="border:none;padding-top:14px;"><span style="font-weight:700;">Totale</span><span style="font-weight:700;font-size:20px;">${calcFmtEuro(quote.total)}</span></div>`;
  html += `<div style="margin-top:1rem;text-align:right;"><button class="btn btn-primary" id="calc-copy-btn" onclick="copyCalcSummary()">Copia riepilogo per il cliente</button></div>`;
  body.innerHTML = html;

  platformsCard.style.display = '';
  document.getElementById('calc-platforms-body').innerHTML = `
    <div class="price-row"><span>Totale diretto</span><strong>${calcFmtEuro(quote.total)}</strong></div>
    <div class="price-row"><span>Netto host (Airbnb, −3%)</span><strong>${calcFmtEuro(quote.airbnbNet)}</strong></div>
    <div class="price-row" style="border:none;"><span>Totale pagato ospite (Airbnb, +15%)</span><strong>${calcFmtEuro(quote.airbnbGuest)}</strong></div>`;

  calcSummaryData = { aptName: aptNames[calcApt], ...quote };
}

window.copyCalcSummary = async function(){
  const d = calcSummaryData;
  if(!d) return;
  const lines = [];
  lines.push(`Preventivo appartamento ${d.aptName}`);
  lines.push(`${calcFmtDateIt(d.checkin)} → ${calcFmtDateIt(d.checkout)} (${d.nightsCount} nott${d.nightsCount===1?'e':'i'})`);
  lines.push('');
  d.groups.forEach(g=>lines.push(`${g.label} (${g.count} nott${g.count===1?'e':'i'}, ${calcFmtEuro(g.total/g.count)}/notte): ${calcFmtEuro(g.total)}`));
  if(d.discount) lines.push(`Sconto: -${calcFmtEuro(d.discount)}`);
  lines.push(`Pulizie: ${calcFmtEuro(d.cleaning)}`);
  if(d.linensCost) lines.push(`Lenzuola e asciugamani (${d.totalGuests} persone): ${calcFmtEuro(d.linensCost)}`);
  lines.push(`Tassa di soggiorno (${d.adults} adult${d.adults===1?'o':'i'} × ${d.taxNights} giorni): ${calcFmtEuro(d.tax)}`);
  lines.push('');
  lines.push(`TOTALE: ${calcFmtEuro(d.total)}`);
  try { await navigator.clipboard.writeText(lines.join('\n')); } catch(e){}
  const btn = document.getElementById('calc-copy-btn');
  if(btn){
    btn.textContent = '✓ Copiato';
    btn.classList.add('btn-success');
    clearTimeout(calcCopyTimeout);
    calcCopyTimeout = setTimeout(()=>{
      btn.textContent = 'Copia riepilogo per il cliente';
      btn.classList.remove('btn-success');
    }, 2000);
  }
};

// ---- THEME (shares the apt_theme key with the desktop app) ----
window.toggleTheme = function(){
  const isDark = document.documentElement.classList.toggle('dark');
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';
  try { localStorage.setItem('apt_theme', isDark ? 'dark' : 'light'); } catch(e){}
};
(function(){
  try {
    if(localStorage.getItem('apt_theme') === 'dark'){
      document.documentElement.classList.add('dark');
    }
  } catch(e){}
})();

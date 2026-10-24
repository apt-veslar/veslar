import {
  signInWithGoogle as coreSignInWithGoogle, signOutUser, watchAuth,
  subscribeBookings as coreSubscribeBookings, subscribeCustomers as coreSubscribeCustomers,
  saveBookingDoc, deleteBookingDoc, mergeCustomersDoc, deleteCustomerDoc,
} from './firebase-core.js';
import { calcComputeQuote, calcBuildModel, calcFmtEuro, calcFmtDateIt, CALC_CLEANING, CALC_DEFAULT_COMMISSION } from './pricing-calc.js';
import { calcQuoteHtml, calcPlatformsHtml, calcHistoryHtml, calcSummaryText } from './pricing-calc-view.js';
import { syncCheckout } from './date-range.js';
import { attachMonthSwipe } from './cal-swipe.js';

window.syncCheckout = syncCheckout;

let bookings = [];
let customers = [];
let unsubBookings = null;
let unsubCustomers = null;

const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const monthsShort = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
const dayNames = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
const aptNames = { 1: 'Olbe', 2: 'Poch' };
const srcLabelIt = { airbnb:'Airbnb', booking:'Booking', manual:'Manuale' };

let dashYear = new Date().getFullYear();
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth(), calApt = 0; // opens on "Entrambi"
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
  subscribeBookings();
  subscribeCustomers();
  renderDashboard();
  try {
    const saved = localStorage.getItem('apt_theme');
    document.getElementById('theme-btn').textContent = saved === 'dark' ? '🌙' : '☀️';
  } catch(e){}
}, () => {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
});

// ---- BOOKINGS / CUSTOMERS REALTIME ----
// Mobile never runs the customer backfill (see plan): running it from two
// independently-loaded pages (desktop + mobile) would race across a network
// round-trip and could create duplicate customer records. Desktop remains
// the sole backfill owner; mobile only needs the customers subscription to
// feed the guest-name autocomplete datalist and the Clienti tab.
function subscribeBookings() {
  if(unsubBookings) unsubBookings();
  unsubBookings = coreSubscribeBookings((arr) => {
    bookings = arr;
    renderDashboard();
    renderBookings();
    if(document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
    if(document.getElementById('tab-calcolatore').classList.contains('active')) renderCalculator();
    renderCustomers();
  });
}

function subscribeCustomers() {
  if(unsubCustomers) unsubCustomers();
  unsubCustomers = coreSubscribeCustomers((arr) => {
    customers = arr;
    renderCustomerDatalist();
    renderCustomers();
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
        <span class="booking-dates">${opts.yearInDates?`${fmtDateFull(b.checkin)} → ${fmtDateFull(b.checkout)}`:`${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}`}</span>
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
  if(t==='clienti') renderCustomers();
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
  document.getElementById('m-aptab0').className = 'apt-tab'+(n===0?' active-both':'');
  document.getElementById('m-cal-grid').parentElement.className = 'card'+(n?' apt-frame-'+n:'');
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
attachMonthSwipe(document.getElementById('m-cal-grid'), dir=>calMonthStep(dir));

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
    html+=`<div class="m-cal-day${isToday?' today':''}${aptClass}" ${dayBooks.length?`onclick="openDayPopup('${ds}')"`:`onclick="openModal('${ds}',${calApt||"''"})"`}>
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
  tintAptSelect(document.getElementById('m-filter-apt'));
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

// Colour an apartment <select> with the chosen apartment's colour (neutral when none/all).
window.tintAptSelect = function(el){
  if(!el) return;
  el.classList.remove('apt-select-1','apt-select-2');
  if(el.value==='1'||el.value==='2') el.classList.add('apt-select-'+el.value);
};

// ---- MODAL ----
window.openModal = function(checkin, apt){
  editingId = null;
  document.getElementById('modal-title').textContent = 'Nuova prenotazione';
  document.getElementById('m-checkin').value = checkin || new Date().toISOString().split('T')[0];
  document.getElementById('m-checkout').value = '';
  syncCheckout('m-checkin','m-checkout');
  document.getElementById('m-guest').value = '';
  document.getElementById('m-amount').value = '';
  document.getElementById('m-notes').value = '';
  document.getElementById('m-guests-num').value = '';
  document.getElementById('m-apt').value = apt || '';
  tintAptSelect(document.getElementById('m-apt'));
  document.getElementById('m-source').value = 'manual';
  document.getElementById('modal-overlay').classList.add('open');
};

window.editBooking = function(id){
  const b = bookings.find(b=>b.id===id);
  if(!b) return;
  editingId = id;
  document.getElementById('modal-title').textContent = 'Modifica prenotazione';
  document.getElementById('m-apt').value = b.apt;
  tintAptSelect(document.getElementById('m-apt'));
  document.getElementById('m-guest').value = b.guest;
  document.getElementById('m-checkin').value = b.checkin;
  document.getElementById('m-checkout').value = b.checkout;
  syncCheckout('m-checkin','m-checkout');
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

// ---- CLIENTI ----
// Stessa logica del tab Clienti desktop (app.js), con righe e schede adattate al telefono.
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Lettere aperte nella pagina Clienti, conservate tra un render e l'altro.
const openCustomerLetters = new Set();
window.renderCustomers = function(){
  const el = document.getElementById('customers-list');
  if(!el) return;
  const q = (document.getElementById('customer-search')?.value||'').trim().toLowerCase();
  const now = new Date();
  const rows = customers
    .filter(c=>!q || c.name.toLowerCase().includes(q))
    .map(c=>{
      const cb = bookings.filter(b=>b.customerId===c.id);
      const revenue = cb.reduce((s,b)=>s+Number(b.amount||0),0);
      const future = cb.filter(b=>new Date(b.checkin)>=now).sort((a,b)=>new Date(a.checkin)-new Date(b.checkin));
      const past = cb.filter(b=>new Date(b.checkin)<now).sort((a,b)=>new Date(b.checkin)-new Date(a.checkin));
      const highlight = future[0] || past[0];
      return { c, count: cb.length, revenue, highlight, isFuture: !!future[0] };
    });

  // Toglie dalla selezione clienti spariti (uniti/eliminati, anche da un altro dispositivo).
  [...mergeSelection].forEach(id=>{ if(!customers.some(c=>c.id===id)) mergeSelection.delete(id); });
  updateCustomerMergeBar();

  if(!rows.length){ el.innerHTML = '<div class="empty">Nessun cliente trovato</div>'; return; }

  // Raggruppamento per iniziale del nome (accenti ignorati, non-lettere in "#").
  const groups = new Map();
  rows.sort((a,b)=>a.c.name.localeCompare(b.c.name,'it',{sensitivity:'base'}))
    .forEach(x=>{
      const ch = (x.c.name||'').trim().normalize('NFD').replace(/[̀-ͯ]/g,'').charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(ch) ? ch : '#';
      if(!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(x);
    });
  const letters = [...groups.keys()].sort((a,b)=>a==='#'?1:b==='#'?-1:a.localeCompare(b));

  // In modalità unione il tap seleziona il cliente invece di aprirne la scheda.
  const rowHtml = x=>`
    <div class="m-customer-row${mergeMode&&mergeSelection.has(x.c.id)?' customer-selected':''}" onclick="${mergeMode?`toggleCustomerMergeSelect('${x.c.id}')`:`openCustomerPopup('${x.c.id}')`}">
      ${mergeMode?`<input type="checkbox" class="customer-check" tabindex="-1" ${mergeSelection.has(x.c.id)?'checked':''}>`:''}
      <div class="m-customer-main">
        <div class="m-customer-top">
          <span class="booking-guest">${escapeHtml(x.c.name)}</span>
          <span class="booking-amount">€${x.revenue.toLocaleString('it')}</span>
        </div>
        <div class="booking-dates">${x.count} prenotazion${x.count!==1?'i':'e'}${x.highlight?` · ${x.isFuture?'prossimo':'ultimo'} ${fmtDateFull(x.highlight.checkin)}`:''}</div>
      </div>
      ${!mergeMode&&!x.count?`<button class="customer-del-btn" title="Elimina cliente" onclick="event.stopPropagation();deleteCustomer('${x.c.id}')">🗑</button>`:''}
    </div>`;

  // Con una ricerca attiva i gruppi sono tutti aperti; altrimenti si ricorda
  // quali l'utente ha aperto, così il refresh realtime non li richiude.
  el.innerHTML = `
    <div class="customer-index">${letters.map(l=>`<button class="customer-index-btn" onclick="jumpToCustomerLetter('${l}')">${l}</button>`).join('')}</div>
    ${letters.map(l=>`
    <details class="customer-group" id="customer-group-${l==='#'?'other':l}" data-letter="${l}" ${q||openCustomerLetters.has(l)?'open':''} ontoggle="toggleCustomerLetter(this)">
      <summary class="customer-group-title">${l} <span class="customer-group-count">${groups.get(l).length}</span></summary>
      ${groups.get(l).map(rowHtml).join('')}
    </details>`).join('')}`;
};

window.toggleCustomerLetter = function(det){
  if(document.getElementById('customer-search')?.value.trim()) return;
  const l = det.dataset.letter;
  if(det.open) openCustomerLetters.add(l); else openCustomerLetters.delete(l);
};
window.jumpToCustomerLetter = function(l){
  const det = document.getElementById(`customer-group-${l==='#'?'other':l}`);
  if(!det) return;
  det.open = true;
  det.scrollIntoView({behavior:'smooth', block:'start'});
};

window.openCustomerPopup = function(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  const cb = bookings.filter(b=>b.customerId===id).sort((a,b)=>new Date(b.checkin)-new Date(a.checkin));
  const revenue = cb.reduce((s,b)=>s+Number(b.amount||0),0);
  const nights = cb.reduce((s,b)=>s+Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000),0);
  document.getElementById('customer-popup-name').textContent = c.name;
  document.getElementById('customer-popup-stats').innerHTML = `
    <span><strong>${cb.length}</strong> prenotazion${cb.length!==1?'i':'e'}</span>
    <span><strong>€${revenue.toLocaleString('it')}</strong> ricavi</span>
    <span><strong>${nights}</strong> notti</span>`;
  document.getElementById('customer-popup-bookings').innerHTML = cb.length ? cb.map(b=>bookingRowHtml(b,{
    yearInDates: true,
    editHandler: `closeCustomerPopup();editBooking('${b.id}')`,
  })).join('') : '<div class="empty">Nessuna prenotazione</div>';
  document.getElementById('customer-popup-actions').innerHTML = cb.length ? ''
    : `<button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')">🗑 Elimina cliente</button>`;
  document.getElementById('customer-popup-overlay').classList.add('open');
};
window.closeCustomerPopup = function(){
  document.getElementById('customer-popup-overlay').classList.remove('open');
};

// ---- CLIENTI: UNISCI / ELIMINA ----
let mergeMode = false;
const mergeSelection = new Set();
function customerBookingCount(id){ return bookings.filter(b=>b.customerId===id).length; }

function updateCustomerMergeBar(){
  const bar = document.getElementById('customer-merge-bar');
  if(!bar) return;
  bar.classList.toggle('open', mergeMode);
  document.getElementById('customer-merge-toggle').style.display = mergeMode ? 'none' : '';
  const n = mergeSelection.size;
  document.getElementById('customer-merge-count').textContent = n
    ? `${n} client${n!==1?'i':'e'} selezionat${n!==1?'i':'o'}${n<2?' (almeno 2)':''}`
    : 'Seleziona i clienti che sono la stessa persona';
  document.getElementById('customer-merge-go').disabled = n < 2;
}

window.toggleCustomerMergeMode = function(){
  mergeMode = !mergeMode;
  mergeSelection.clear();
  renderCustomers();
};
window.toggleCustomerMergeSelect = function(id){
  if(mergeSelection.has(id)) mergeSelection.delete(id); else mergeSelection.add(id);
  renderCustomers();
};

window.openCustomerMergePopup = function(){
  const sel = customers.filter(c=>mergeSelection.has(c.id));
  if(sel.length < 2) return;
  // Proposto di default il nome più completo (più lungo), a parità quello con più prenotazioni.
  const def = sel.slice().sort((a,b)=>b.name.trim().length-a.name.trim().length || customerBookingCount(b.id)-customerBookingCount(a.id))[0];
  document.getElementById('customer-merge-options').innerHTML = sel.map(c=>{
    const n = customerBookingCount(c.id);
    return `<label class="customer-merge-option">
      <input type="radio" name="customer-merge-keep" value="${c.id}" ${c.id===def.id?'checked':''} onchange="updateCustomerMergeSummary()">
      <span>${escapeHtml(c.name)}</span>
      <span>${n} prenotazion${n!==1?'i':'e'}</span>
    </label>`;
  }).join('');
  updateCustomerMergeSummary();
  document.getElementById('customer-merge-overlay').classList.add('open');
};
window.updateCustomerMergeSummary = function(){
  const keepId = document.querySelector('input[name="customer-merge-keep"]:checked')?.value;
  const keep = customers.find(c=>c.id===keepId);
  if(!keep) return;
  const others = customers.filter(c=>mergeSelection.has(c.id) && c.id!==keepId);
  const moved = others.reduce((s,c)=>s+customerBookingCount(c.id),0);
  document.getElementById('customer-merge-summary').innerHTML =
    `${moved} prenotazion${moved!==1?'i':'e'} di ${others.map(c=>`<strong>${escapeHtml(c.name)}</strong>`).join(', ')} `+
    `passeranno a <strong>${escapeHtml(keep.name)}</strong>, con questo nome come ospite. `+
    `${others.length>1?'Gli altri clienti verranno eliminati':'L\'altro cliente verrà eliminato'}.`;
};
window.closeCustomerMergePopup = function(){
  document.getElementById('customer-merge-overlay').classList.remove('open');
};
window.confirmCustomerMerge = async function(){
  const keepId = document.querySelector('input[name="customer-merge-keep"]:checked')?.value;
  const keep = customers.find(c=>c.id===keepId);
  if(!keep) return;
  showSaving(true);
  try {
    await mergeCustomersDoc(keepId, [...mergeSelection]);
    closeCustomerMergePopup();
    mergeMode = false;
    mergeSelection.clear();
    renderCustomers();
    toast(`Clienti uniti in ${keep.name}`);
  } catch(e) { console.error('merge customers', e); toast('Errore durante l\'unione: '+e.message); }
  finally { showSaving(false); }
};

window.deleteCustomer = async function(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  if(customerBookingCount(id)){ toast('Il cliente ha prenotazioni collegate'); return; }
  if(!confirm(`Eliminare il cliente "${c.name}"?`)) return;
  showSaving(true);
  try {
    await deleteCustomerDoc(id);
    closeCustomerPopup();
    toast('Cliente eliminato');
  } catch(e) { console.error('delete customer', e); toast('Errore: '+e.message); }
  finally { showSaving(false); }
};

// ---- CALCOLATORE ----
let calcApt = 0; // 0 = not chosen yet: the calculator asks for the apartment first
let calcLinens = false;
let calcInitialized = false;
let calcSummaryData = null;
let calcCopyTimeout = null;
let calcCommission = (()=>{ try { return { ...CALC_DEFAULT_COMMISSION, ...JSON.parse(localStorage.getItem('calc_commission')||'{}') }; } catch(e){ return { ...CALC_DEFAULT_COMMISSION }; } })();

window.setCalcApt = function(n){ calcApt=n; renderCalculator(); };
window.toggleCalcLinens = function(){ calcLinens=!calcLinens; renderCalculator(); };
window.setCalcCommission = function(src, v){
  calcCommission[src] = parseFloat(v)||0;
  try { localStorage.setItem('calc_commission', JSON.stringify(calcCommission)); } catch(e){}
  renderCalculator();
};

// Global: the date/guest inputs in mobile.html call it from onchange.
window.renderCalculator = function(){
  if(!calcInitialized){
    calcInitialized = true;
    const t=new Date(); const t2=new Date(t); t2.setDate(t2.getDate()+7);
    document.getElementById('calc-checkin').value = t.toISOString().split('T')[0];
    document.getElementById('calc-checkout').value = t2.toISOString().split('T')[0];
    syncCheckout('calc-checkin','calc-checkout');
    document.getElementById('calc-adults').value = 2;
    document.getElementById('calc-children').value = 0;
    document.getElementById('calc-discount').value = 0;
  }

  const aptButtons = [1,2].map(a=>
    `<button class="apt-tab${calcApt===a?' active-apt'+a:' apt-pick-btn-'+a}" onclick="setCalcApt(${a})">${a===1?'Olbe (Apt 1)':'Poch (Apt 2)'}</button>`
  ).join('');
  const toggleEl = document.getElementById('calc-apt-toggle');
  document.getElementById('tab-calcolatore').classList.toggle('calc-apt-1', calcApt===1);
  document.getElementById('tab-calcolatore').classList.toggle('calc-apt-2', calcApt===2);
  document.getElementById('calc-body').style.display = calcApt ? '' : 'none';
  if(!calcApt){
    toggleEl.innerHTML = `<div class="apt-pick"><div class="apt-pick-title">Per quale appartamento?</div>
      <div class="apt-pick-sub">Scegli l'appartamento per calcolare il preventivo</div>
      <div class="apt-tabs apt-tabs-lg">${aptButtons}</div></div>`;
    calcSummaryData = null;
    return;
  }
  toggleEl.innerHTML = `<div class="apt-tabs apt-tabs-lg">${aptButtons}</div>`;

  document.getElementById('calc-cleaning-value').textContent = calcFmtEuro(CALC_CLEANING[calcApt]);
  document.getElementById('calc-linens-toggle').className = 'toggle-switch'+(calcLinens?' on':'');

  const checkin = document.getElementById('calc-checkin').value;
  const checkout = document.getElementById('calc-checkout').value;
  const adults = parseInt(document.getElementById('calc-adults').value)||0;
  const children = parseInt(document.getElementById('calc-children').value)||0;
  const discountInput = parseFloat(document.getElementById('calc-discount').value)||0;

  const badgeEl = document.getElementById('calc-badge');
  badgeEl.className = 'badge badge-apt'+calcApt;
  badgeEl.textContent = aptNames[calcApt];

  const model = calcBuildModel(bookings);
  document.getElementById('calc-history-body').innerHTML = calcHistoryHtml(model, calcApt, aptNames);

  const body = document.getElementById('calc-preventivo-body');
  const platformsCard = document.getElementById('calc-platforms-card');
  const quote = calcComputeQuote({ model, apt:calcApt, checkin, checkout, adults, children, linens:calcLinens, discountInput, commission:calcCommission });

  if(!quote){
    body.innerHTML = '<div class="empty">Seleziona un check-out successivo al check-in e almeno un ospite.</div>';
    platformsCard.style.display = 'none';
    calcSummaryData = null;
    return;
  }

  body.innerHTML = calcQuoteHtml(quote);
  platformsCard.style.display = '';
  document.getElementById('calc-platforms-body').innerHTML = calcPlatformsHtml(quote, model);

  calcSummaryData = { aptName: aptNames[calcApt], ...quote };
};

window.copyCalcSummary = async function(){
  const d = calcSummaryData;
  if(!d) return;
  try { await navigator.clipboard.writeText(calcSummaryText(d)); } catch(e){}
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

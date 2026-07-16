import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, collection, getDocs, addDoc, deleteDoc, setDoc, getDoc, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAbCejZ27wKUl2aNlZnqHMe1QqeLohKBzk",
  authDomain: "apt-veslar.firebaseapp.com",
  projectId: "apt-veslar",
  storageBucket: "apt-veslar.firebasestorage.app",
  messagingSenderId: "315440513290",
  appId: "1:315440513290:web:04159ab6afe148cb97baf3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let bookings = [];
let prices = { 1:{base:120,weekend:160,high:200,low:90}, 2:{base:100,weekend:140,high:170,low:80} };
let extras = { cleaning:60, deposit:200 };
let ical = { 'airbnb-1':'','airbnb-2':'','booking-1':'','booking-2':'' };
let unsubBookings = null;

const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const dayNames = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
const aptNames = { 1: 'Olbe', 2: 'Poch' };
let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();
let dashYear = new Date().getFullYear();
let currentApt = 1;
let editingId = null;

// ---- AUTH ----
window.signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch(e) {
    const el = document.getElementById('login-error');
    el.style.display = 'block';
    el.textContent = 'Errore di accesso: ' + e.message;
  }
};

window.signOut = async () => {
  if(unsubBookings) unsubBookings();
  await fbSignOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  if(user) {
    currentUser = user;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('user-name-label').textContent = user.displayName?.split(' ')[0] || '';
    const avatarWrap = document.getElementById('user-avatar-wrap');
    if(user.photoURL) {
      avatarWrap.innerHTML = `<img src="${user.photoURL}" class="user-avatar" alt="">`;
    } else {
      const initials = (user.displayName||'U').split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
      avatarWrap.innerHTML = `<div class="user-avatar-fallback">${initials}</div>`;
    }
    await loadSettings();
    subscribeBookings();
    renderDashboard();
    renderPrices();
    // Sync theme button icon with saved preference
    try {
      const saved = localStorage.getItem('apt_theme');
      document.getElementById('theme-btn').textContent = saved === 'dark' ? '🌙' : '☀️';
    } catch(e){}
  } else {
    currentUser = null;
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  }
});

// ---- FIRESTORE PATHS ----
function userDoc(path) { return doc(db, 'users', currentUser.uid, ...path.split('/')); }
function bookingsCol() { return collection(db, 'users', currentUser.uid, 'bookings'); }

// ---- LOAD SETTINGS ----
async function loadSettings() {
  try {
    const snap = await getDoc(userDoc('settings/main'));
    if(snap.exists()) {
      const d = snap.data();
      if(d.prices) prices = d.prices;
      if(d.extras) extras = d.extras;
      if(d.ical) ical = d.ical;
    }
  } catch(e) { console.error('loadSettings', e); }
}

async function saveSettings() {
  showSaving(true);
  try {
    await setDoc(userDoc('settings/main'), { prices, extras, ical });
  } catch(e) { toast('Errore nel salvataggio'); }
  showSaving(false);
}

// ---- BOOKINGS REALTIME ----
function subscribeBookings() {
  if(unsubBookings) unsubBookings();
  const q = query(bookingsCol(), orderBy('checkin','desc'));
  unsubBookings = onSnapshot(q, (snap) => {
    bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
    renderBookings();
    if(document.getElementById('tab-calendario').classList.contains('active')) renderCalendar();
  }, (e) => { console.error('snapshot error', e); });
}

// ---- HELPERS ----
function showSaving(v) { document.getElementById('saving-indicator').classList.toggle('show', v); }
function fmtDate(d) { const dd=new Date(d); return dd.getDate()+'/'+(dd.getMonth()+1); }
function fmtDateFull(d) { const dd=new Date(d); return dd.getDate()+' '+monthNames[dd.getMonth()].substr(0,3)+' '+dd.getFullYear(); }
window.toast = function(msg) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
};

// ---- TABS ----
window.showTab = function(t, btn) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  if(btn) btn.classList.add('active');
  if(t==='calendario') renderCalendar();
  if(t==='dashboard') renderDashboard();
  if(t==='prenotazioni') renderBookings();
  if(t==='prezzi') renderPrices();
  if(t==='sync') loadIcalInputs();
  if(t==='backup') showLastBackupStatus();
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

  document.getElementById('metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Ricavi ${monthNames[cm].substring(0,3)}</div><div class="metric-value">€${revMonth.toLocaleString('it')}</div><div class="metric-sub">questo mese</div></div>
    <div class="metric"><div class="metric-label">Notti prenotate</div><div class="metric-value">${nightsMonth}</div><div class="metric-sub">${monthNames[cm]}</div></div>
    <div class="metric"><div class="metric-label">Tasso occupazione</div><div class="metric-value">${occRate}%</div><div class="metric-sub">media 2 apt</div></div>
    <div class="metric"><div class="metric-label">Prenotazioni totali</div><div class="metric-value">${bookings.length}</div><div class="metric-sub">tutti gli anni</div></div>`;

  const months=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

  // Populate year selector based on years present in bookings
  const allYears = [...new Set(bookings.map(b=>new Date(b.checkin).getFullYear()))];
  const curY = new Date().getFullYear();
  if(!allYears.includes(curY)) allYears.push(curY);
  allYears.sort();
  const ySel = document.getElementById('dash-year-select');
  if(ySel){
    const existing = Array.from(ySel.options).map(o=>parseInt(o.value));
    const needsRebuild = allYears.some(y=>!existing.includes(y)) || existing.some(y=>!allYears.includes(y));
    if(needsRebuild){ ySel.innerHTML=''; allYears.forEach(y=>{const o=document.createElement('option');o.value=y;o.textContent=y;ySel.appendChild(o);}); }
    ySel.value = dashYear;
  }
  const dashYearLabel = document.getElementById('dash-year-label');
  if(dashYearLabel) dashYearLabel.textContent = dashYear;

  const cy = dashYear;
  const maxRev=Math.max(...months.map((_,i)=>bookings.filter(b=>new Date(b.checkin).getMonth()===i&&new Date(b.checkin).getFullYear()===cy).reduce((s,b)=>s+Number(b.amount||0),0)),1);
  document.getElementById('bar-chart').innerHTML=months.map((_,i)=>{
    const r1=bookings.filter(b=>b.apt===1&&new Date(b.checkin).getMonth()===i&&new Date(b.checkin).getFullYear()===cy).reduce((s,b)=>s+Number(b.amount||0),0);
    const r2=bookings.filter(b=>b.apt===2&&new Date(b.checkin).getMonth()===i&&new Date(b.checkin).getFullYear()===cy).reduce((s,b)=>s+Number(b.amount||0),0);
    return `<div class="bar-group"><div class="bar" style="height:${Math.max(Math.round(r1/maxRev*100),4)}px;background:var(--apt1);" title="Olbe: €${r1}"></div><div class="bar" style="height:${Math.max(Math.round(r2/maxRev*100),4)}px;background:var(--apt2);" title="Poch: €${r2}"></div></div>`;
  }).join('');
  document.getElementById('bar-labels').innerHTML=months.map(m=>`<div class="bar-label">${m}</div>`).join('');

  const upcoming=[...bookings].filter(b=>new Date(b.checkin)>=now).sort((a,b)=>new Date(a.checkin)-new Date(b.checkin)).slice(0,5);
  document.getElementById('upcoming-list').innerHTML=upcoming.length?upcoming.map(b=>`
    <div class="booking-row">
      <span class="badge badge-${b.source}">${b.source}</span>
      <span class="badge badge-apt${b.apt}">${aptNames[b.apt]||'Apt '+b.apt}</span>
      <span class="booking-guest">${b.guest}</span>
      <span class="booking-dates">${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}</span>
      <span class="booking-amount">€${Number(b.amount||0).toLocaleString('it')}</span>
    </div>`).join(''):'<div class="empty">Nessuna prenotazione futura</div>';

  [1,2].forEach(a=>{
    const ab=bookings.filter(b=>b.apt===a&&new Date(b.checkin).getFullYear()===cy);
    const rev=ab.reduce((s,b)=>s+Number(b.amount||0),0);
    const nights=ab.reduce((s,b)=>s+Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000),0);
    const lbl = document.getElementById('apt'+a+'-year-label');
    if(lbl) lbl.textContent = cy;
    document.getElementById('apt'+a+'-stats').innerHTML=`
      <div class="price-row"><span style="color:var(--text-sec);">Ricavi ${cy}</span><strong>€${rev.toLocaleString('it')}</strong></div>
      <div class="price-row"><span style="color:var(--text-sec);">Notti prenotate</span><strong>${nights}</strong></div>
      <div class="price-row"><span style="color:var(--text-sec);">Prenotazioni</span><strong>${ab.length}</strong></div>
      <div class="price-row" style="border:none;"><span style="color:var(--text-sec);">Media per notte</span><strong>${nights?'€'+Math.round(rev/nights):'-'}</strong></div>`;
  });
}

// ---- DASHBOARD YEAR NAV ----
window.setDashYear = function(y){ dashYear=y; renderDashboard(); };
window.dashYearStep = function(dir){
  const ySel=document.getElementById('dash-year-select');
  const opts=Array.from(ySel.options).map(o=>parseInt(o.value));
  const cur=opts.indexOf(dashYear);
  const next=cur+dir;
  if(next>=0&&next<opts.length){ dashYear=opts[next]; renderDashboard(); }
};

// ---- CALENDAR ----
window.setApt=function(n){
  currentApt=n;
  document.getElementById('aptab1').className='apt-tab'+(n===1?' active-apt1':'');
  document.getElementById('aptab2').className='apt-tab'+(n===2?' active-apt2':'');
  document.getElementById('aptab0').className='apt-tab'+(n===0?' active-apt1':'');
  renderCalendar();
};
window.setCalMonth=function(v){calMonth=parseInt(v);renderCalendar();};
window.setCalYear=function(v){calYear=parseInt(v);renderCalendar();};

function populateCalDropdowns(){
  const mSel=document.getElementById('cal-month-select');
  const ySel=document.getElementById('cal-year-select');
  if(!mSel||!ySel) return;
  if(!mSel.options.length){
    monthNames.forEach((m,i)=>{const o=document.createElement('option');o.value=i;o.textContent=m;mSel.appendChild(o);});
  }
  mSel.value=calMonth;
  if(!ySel.options.length || !Array.from(ySel.options).find(o=>parseInt(o.value)===calYear)){
    ySel.innerHTML='';
    const curY=new Date().getFullYear();
    for(let y=curY-3;y<=curY+3;y++){const o=document.createElement('option');o.value=y;o.textContent=y;ySel.appendChild(o);}
  }
  ySel.value=calYear;
}

let calPopupBookingId = null;

window.openCalPopup=function(bookingId){
  const b=bookings.find(x=>x.id===bookingId);
  if(!b) return;
  calPopupBookingId=bookingId;
  const srcLabel={airbnb:'Airbnb',booking:'Booking',manual:'Manuale'};
  document.getElementById('cal-popup-guest').textContent=b.guest;
  document.getElementById('cal-popup-badges').innerHTML=
    `<span class="badge badge-${b.source}">${srcLabel[b.source]||b.source}</span>`+
    `<span class="badge badge-apt${b.apt}">${aptNames[b.apt]||'Apt '+b.apt}</span>`;
  document.getElementById('cal-popup-checkin').textContent=fmtDateFull(b.checkin);
  document.getElementById('cal-popup-checkout').textContent=fmtDateFull(b.checkout);
  const nights=Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000);
  document.getElementById('cal-popup-nights').textContent=nights+(nights===1?' notte':' notti');
  document.getElementById('cal-popup-amount').textContent=b.amount?'€'+Number(b.amount).toLocaleString('it'):'-';
  const gRow=document.getElementById('cal-popup-guests-row');
  const gVal=document.getElementById('cal-popup-guests');
  if(b.guestsNum){gVal.textContent=b.guestsNum;gRow.style.display='';}else{gRow.style.display='none';}
  const nRow=document.getElementById('cal-popup-notes-row');
  const nVal=document.getElementById('cal-popup-notes');
  if(b.notes){nVal.textContent=b.notes;nRow.style.display='';}else{nRow.style.display='none';}
  document.getElementById('cal-popup-overlay').classList.add('open');
};
window.closeCalPopup=function(){document.getElementById('cal-popup-overlay').classList.remove('open');calPopupBookingId=null;};
window.editFromCalPopup=function(){closeCalPopup();if(calPopupBookingId)editBooking(calPopupBookingId);};

function renderCalendar(){
  populateCalDropdowns();
  const firstDay=new Date(calYear,calMonth,1);
  let startDow=firstDay.getDay();startDow=startDow===0?6:startDow-1;
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const daysInPrev=new Date(calYear,calMonth,0).getDate();
  const today=new Date();
  let html=dayNames.map(d=>`<div class="cal-day-name">${d}</div>`).join('');
  for(let i=0;i<startDow;i++) html+=`<div class="cal-day other-month"><div class="cal-day-num">${daysInPrev-startDow+i+1}</div></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const isToday=new Date(ds).toDateString()===today.toDateString();
    const aptFilter = currentApt===0 ? [1,2] : [currentApt];
    const dayBooks=bookings.filter(b=>aptFilter.includes(b.apt)&&ds>=b.checkin&&ds<b.checkout);
    const bHtml=dayBooks.map(b=>{
      const aptDot = currentApt===0 ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${b.apt===1?'var(--apt1)':'var(--apt2)'};margin-right:3px;vertical-align:middle;"></span>` : '';
      return `<div class="cal-booking ${b.source}" onclick="event.stopPropagation();openCalPopup('${b.id}')" style="cursor:pointer;">${aptDot}${b.guest.split(' ')[0]}</div>`;
    }).join('');
    html+=`<div class="cal-day${isToday?' today':''}${dayBooks.length?' occupied':''}"><div class="cal-day-num">${d}</div>${bHtml}</div>`;
  }
  const total=startDow+daysInMonth;const rem=total%7===0?0:7-(total%7);
  for(let i=1;i<=rem;i++) html+=`<div class="cal-day other-month"><div class="cal-day-num">${i}</div></div>`;
  document.getElementById('cal-grid').innerHTML=html;
}

// ---- THEME ----
window.toggleTheme = function(){
  const isDark = document.documentElement.classList.toggle('dark');
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';
  try { localStorage.setItem('apt_theme', isDark ? 'dark' : 'light'); } catch(e){}
};
// Apply saved theme on load (default: light)
(function(){
  try {
    if(localStorage.getItem('apt_theme') === 'dark'){
      document.documentElement.classList.add('dark');
    }
  } catch(e){}
})();

// ---- BOOKINGS LIST (paginated) ----
window.bookingsPage = 1;
const BOOKINGS_PER_PAGE = 15;

window.renderBookings = function(page){
  if(page !== undefined) bookingsPage = page;
  const aptF=document.getElementById('filter-apt')?.value||'all';
  const srcF=document.getElementById('filter-src')?.value||'all';
  let filtered=bookings.filter(b=>(aptF==='all'||b.apt===parseInt(aptF))&&(srcF==='all'||b.source===srcF));
  filtered.sort((a,b)=>new Date(b.checkin)-new Date(a.checkin));

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / BOOKINGS_PER_PAGE));
  if(bookingsPage > totalPages) bookingsPage = totalPages;
  const start = (bookingsPage-1)*BOOKINGS_PER_PAGE;
  const pageItems = filtered.slice(start, start+BOOKINGS_PER_PAGE);

  const srcLabel={airbnb:'Airbnb',booking:'Booking',manual:'Manuale'};
  const el=document.getElementById('bookings-list');
  if(!el) return;

  let html = pageItems.length ? pageItems.map(b=>`
    <div class="booking-row">
      <span class="badge badge-${b.source}">${srcLabel[b.source]||b.source}</span>
      <span class="badge badge-apt${b.apt}">${aptNames[b.apt]||'Apt '+b.apt}</span>
      <span class="booking-guest">${b.guest}</span>
      <span class="booking-dates">${fmtDateFull(b.checkin)} → ${fmtDateFull(b.checkout)}</span>
      <span class="booking-amount">€${Number(b.amount||0).toLocaleString('it')}</span>
      ${b.notes?`<span style="font-size:11px;color:var(--text-ter);">${b.notes}</span>`:''}
      <button class="btn btn-sm" onclick="editBooking('${b.id}')">✎ Modifica</button>
      <button class="btn btn-sm btn-danger" onclick="deleteBooking('${b.id}')">✕</button>
    </div>`).join('') : '<div class="empty">Nessuna prenotazione trovata</div>';

  if(totalPages > 1){
    const p = bookingsPage;
    const pages = new Set([1, totalPages, p, p-1, p+1, p-2, p+2].filter(x=>x>=1&&x<=totalPages));
    const sortedPages = [...pages].sort((a,b)=>a-b);
    let pagesBtns = '';
    let prev = 0;
    for(const pg of sortedPages){
      if(prev && pg - prev > 1) pagesBtns += `<span style="padding:0 2px;color:var(--text-ter);">…</span>`;
      pagesBtns += `<button class="page-btn${pg===p?' active':''}" onclick="renderBookings(${pg})">${pg}</button>`;
      prev = pg;
    }
    html += `<div class="pagination">
      <span>${start+1}–${Math.min(start+BOOKINGS_PER_PAGE,total)} di ${total} prenotazioni</span>
      <div class="pagination-pages">
        <button class="page-btn" onclick="renderBookings(${p-1})" ${p<=1?'disabled':''}>‹</button>
        ${pagesBtns}
        <button class="page-btn" onclick="renderBookings(${p+1})" ${p>=totalPages?'disabled':''}>›</button>
      </div>
    </div>`;
  }
  el.innerHTML = html;
}

// ---- MODAL ----
window.openModal=function(){
  editingId = null;
  document.getElementById('modal-title').textContent = 'Nuova prenotazione';
  document.getElementById('m-checkin').value=new Date().toISOString().split('T')[0];
  document.getElementById('m-checkout').value='';
  document.getElementById('m-guest').value='';
  document.getElementById('m-amount').value='';
  document.getElementById('m-notes').value='';
  document.getElementById('m-guests-num').value='';
  document.getElementById('m-apt').value='';
  document.getElementById('m-source').value='manual';
  document.getElementById('modal-overlay').classList.add('open');
};

window.editBooking=function(id){
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

window.closeModal=function(){ document.getElementById('modal-overlay').classList.remove('open'); editingId=null; };

window.saveBooking=async function(){
  const aptVal=document.getElementById('m-apt').value;
  const guest=document.getElementById('m-guest').value.trim();
  const checkin=document.getElementById('m-checkin').value;
  const checkout=document.getElementById('m-checkout').value;
  const amount=parseFloat(document.getElementById('m-amount').value)||0;
  if(!aptVal){alert('Seleziona l\'appartamento.');return;}
  if(!guest){alert('Inserisci il nome dell\'ospite.');return;}
  if(!checkin||!checkout){alert('Inserisci le date.');return;}
  if(new Date(checkout)<=new Date(checkin)){alert('Il check-out deve essere dopo il check-in.');return;}
  const data = {
    apt:parseInt(aptVal),
    guest, checkin, checkout, amount,
    source:document.getElementById('m-source').value,
    notes:document.getElementById('m-notes').value,
    guestsNum:parseInt(document.getElementById('m-guests-num').value)||0,
  };
  showSaving(true);
  try {
    if(editingId) {
      await setDoc(doc(db,'users',currentUser.uid,'bookings',editingId), {...data, updatedAt: new Date().toISOString()}, {merge:true});
      toast('Prenotazione aggiornata!');
    } else {
      await addDoc(bookingsCol(), {...data, createdAt: new Date().toISOString()});
      toast('Prenotazione salvata!');
    }
    closeModal();
  } catch(e){ toast('Errore: '+e.message); }
  showSaving(false);
};

window.deleteBooking=async function(id){
  if(!confirm('Eliminare questa prenotazione?')) return;
  showSaving(true);
  try {
    await deleteDoc(doc(db,'users',currentUser.uid,'bookings',id));
    toast('Prenotazione eliminata');
  } catch(e){ toast('Errore: '+e.message); }
  showSaving(false);
};

// ---- PRICES ----
function renderPrices(){
  [1,2].forEach(a=>{
    const p=prices[a]||{base:120,weekend:160,high:200,low:90};
    document.getElementById('prices-apt'+a).innerHTML=`
      <div class="price-row"><span>Tariffa base (giorni settimana)</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="p${a}-base" value="${p.base}" min="0"><span class="price-unit">€/notte</span></div></div>
      <div class="price-row"><span>Weekend (ven–sab)</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="p${a}-weekend" value="${p.weekend}" min="0"><span class="price-unit">€/notte</span></div></div>
      <div class="price-row"><span>Alta stagione</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="p${a}-high" value="${p.high}" min="0"><span class="price-unit">€/notte</span></div></div>
      <div class="price-row"><span>Bassa stagione</span><div style="display:flex;align-items:center;gap:6px;"><input class="price-input" type="number" id="p${a}-low" value="${p.low}" min="0"><span class="price-unit">€/notte</span></div></div>`;
  });
  document.getElementById('price-cleaning').value=extras.cleaning||60;
  document.getElementById('price-deposit').value=extras.deposit||200;
}

window.savePrices=async function(){
  [1,2].forEach(a=>{
    prices[a]={
      base:parseInt(document.getElementById('p'+a+'-base').value)||0,
      weekend:parseInt(document.getElementById('p'+a+'-weekend').value)||0,
      high:parseInt(document.getElementById('p'+a+'-high').value)||0,
      low:parseInt(document.getElementById('p'+a+'-low').value)||0
    };
  });
  extras.cleaning=parseInt(document.getElementById('price-cleaning').value)||0;
  extras.deposit=parseInt(document.getElementById('price-deposit').value)||0;
  await saveSettings();
  toast('Tariffe salvate!');
};

// ---- ICAL ----
function loadIcalInputs(){
  ['airbnb-1','airbnb-2','booking-1','booking-2'].forEach(k=>{
    const el=document.getElementById('ical-'+k);
    if(el) el.value=ical[k]||'';
  });
}

window.saveIcalLinks=async function(){
  ['airbnb-1','airbnb-2','booking-1','booking-2'].forEach(k=>{
    const el=document.getElementById('ical-'+k);
    if(el) ical[k]=el.value.trim();
  });
  await saveSettings();
  document.getElementById('sync-status').textContent='Salvato — '+new Date().toLocaleTimeString('it');
  toast('Link iCal salvati!');
};

window.exportIcal=function(apt){
  const toExport=apt===0?bookings:bookings.filter(b=>b.apt===apt);
  const aptName=apt===0?'tutti':apt===1?'olbe':'poch';
  let ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gestione Appartamenti Montagna//IT\r\nCALSCALE:GREGORIAN\r\n';
  toExport.forEach(b=>{
    const now=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
    ics+=`BEGIN:VEVENT\r\nUID:${b.id}@apt-montagna\r\nDTSTAMP:${now}\r\nSUMMARY:${b.guest} (${b.source})\r\nDTSTART;VALUE=DATE:${b.checkin.replace(/-/g,'')}\r\nDTEND;VALUE=DATE:${b.checkout.replace(/-/g,'')}\r\n${b.notes?'DESCRIPTION:'+b.notes+'\r\n':''}END:VEVENT\r\n`;
  });
  ics+='END:VCALENDAR';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'}));
  a.download=`prenotazioni-apt-${aptName}.ics`;
  a.click();
  toast('File .ics scaricato!');
};

// ---- BACKUP ----
function showLastBackupStatus(){
  const el = document.getElementById('backup-status');
  if(!el) return;
  try {
    const last = localStorage.getItem('apt_last_backup');
    el.textContent = last ? 'Ultimo backup: '+new Date(last).toLocaleString('it') : '';
  } catch(e){}
}

window.exportBackup = function(){
  const data = {
    type: 'apt-veslar-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    bookings,
    settings: { prices, extras, ical },
  };
  const json = JSON.stringify(data, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], {type:'application/json'}));
  const stamp = new Date().toISOString().split('T')[0];
  a.download = `backup-appartamenti-${stamp}.json`;
  a.click();
  try { localStorage.setItem('apt_last_backup', new Date().toISOString()); } catch(e){}
  showLastBackupStatus();
  toast('Backup scaricato!');
};

// ---- IMPORT ----
let importRows = [];

window.triggerImport = function(){ document.getElementById('import-file-input').value=''; document.getElementById('import-file-input').click(); };

window.handleImportFile = function(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e){
    try {
      const text = e.target.result;
      parseImportCSV(text);
    } catch(err) { alert('Errore nella lettura del file: ' + err.message); }
  };
  reader.readAsText(file, 'UTF-8');
};

function parseImportCSV(text){
  const firstLine = text.split('\n')[0];
  const sep = firstLine.includes(';') ? ';' : ',';
  const lines = text.split('\n').map(l=>l.trimEnd()).filter(l=>l.length>0);
  if(lines.length < 2){ alert('Il file è vuoto o non ha righe di dati.'); return; }

  const headers = splitCSVLine(lines[0], sep);
  const col = (names) => {
    for(const n of names){
      const idx = headers.findIndex(h=>h.toLowerCase().trim()===n.toLowerCase());
      if(idx>=0) return idx;
    }
    return -1;
  };

  const iGuest   = col(['guest name','nome ospite','guest']);
  const iUnit    = col(['unit','appartamento','apt','appartment']);
  const iCheckin = col(['arrival date','checkin','check-in','arrivo','arrival']);
  const iCheckout= col(['departure date','checkout','check-out','partenza','departure']);
  const iPrice   = col(['total price','prezzo totale','total reservation cost','importo','price']);
  const iSource  = col(['sales channel','fonte','channel','source']);
  const iGuests  = col(['adults','adulti']);
  const iNote    = col(['note','notes']);

  if(iCheckin<0 || iCheckout<0){ alert('Impossibile trovare le colonne delle date (Arrival Date / Departure Date).'); return; }

  const aptMap = (v) => {
    if(!v) return null;
    const s = v.toLowerCase().trim();
    if(s==='olbe'||s==='apt 1'||s==='apt1'||s==='1') return 1;
    if(s==='poch'||s==='apt 2'||s==='apt2'||s==='2') return 2;
    return null;
  };
  const sourceMap = (v) => {
    if(!v) return 'manual';
    const s = v.toLowerCase();
    if(s.includes('airbnb')) return 'airbnb';
    if(s.includes('booking')) return 'booking';
    return 'manual';
  };
  const parseDate = (v) => {
    if(!v) return null;
    const m1 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if(m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
    const m2 = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m2) return v.substring(0,10);
    return null;
  };
  const parsePrice = (v) => {
    if(!v) return 0;
    const clean = String(v).replace(/\./g,'').replace(/,/g,'.').replace(/[^\d.]/g,'');
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
  };

  const valid = [], skipped = [];
  for(let i=1;i<lines.length;i++){
    const cells = splitCSVLine(lines[i], sep);
    const guest   = iGuest>=0 ? (cells[iGuest]||'').trim() : '';
    const unit    = iUnit>=0  ? cells[iUnit]||'' : '';
    const checkin = parseDate(cells[iCheckin]||'');
    const checkout= parseDate(cells[iCheckout]||'');
    const price   = iPrice>=0 ? parsePrice(cells[iPrice]) : 0;
    const source  = iSource>=0 ? sourceMap(cells[iSource]||'') : 'manual';
    const gNum    = iGuests>=0 ? parseInt(cells[iGuests]||'0')||0 : 0;
    const note    = iNote>=0  ? (cells[iNote]||'').trim() : '';
    const apt     = aptMap(unit);

    if(!checkin || !checkout){ skipped.push(i+1); continue; }
    if(new Date(checkout)<=new Date(checkin)){ skipped.push(i+1); continue; }

    valid.push({
      apt: apt||1,
      guest: guest||'—',
      checkin, checkout,
      amount: price,
      source,
      guestsNum: gNum,
      notes: note,
      _unit: unit,
    });
  }

  importRows = valid;

  const srcLabel={airbnb:'Airbnb',booking:'Booking',manual:'Manuale'};
  document.getElementById('import-thead').innerHTML =
    `<tr>${['Ospite','Apt','Check-in','Check-out','Importo €','Fonte'].map(h=>`<th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-sec);font-weight:600;border-bottom:0.5px solid var(--border);">${h}</th>`).join('')}</tr>`;
  document.getElementById('import-tbody').innerHTML = valid.map((r,i)=>{
    const aptBadge = `<span class="badge badge-apt${r.apt}">${r.apt===1?'Olbe':'Poch'}</span>`;
    const srcBadge = `<span class="badge badge-${r.source}">${srcLabel[r.source]}</span>`;
    const ci = new Date(r.checkin); const co = new Date(r.checkout);
    const fmtD = d => d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear();
    return `<tr style="border-bottom:0.5px solid var(--border);">
      <td style="padding:5px 8px;">${r.guest}</td>
      <td style="padding:5px 8px;">${aptBadge}</td>
      <td style="padding:5px 8px;">${fmtD(ci)}</td>
      <td style="padding:5px 8px;">${fmtD(co)}</td>
      <td style="padding:5px 8px;">${r.amount?'€'+r.amount.toLocaleString('it'):'-'}</td>
      <td style="padding:5px 8px;">${srcBadge}</td>
    </tr>`;
  }).join('');

  document.getElementById('import-parse-msg').textContent =
    `Trovate ${valid.length} prenotazione${valid.length!==1?'i':''} pronte per l'importazione.`;
  document.getElementById('import-skip-msg').textContent =
    skipped.length ? `⚠️ ${skipped.length} riga${skipped.length>1?'he':''} saltata/e (dati mancanti o date non valide).` : '';
  document.getElementById('import-confirm-btn').textContent = `Importa ${valid.length} prenotazion${valid.length!==1?'i':'e'}`;

  showImportStep('parse');
  document.getElementById('import-overlay').classList.add('open');
}

function splitCSVLine(line, sep){
  const result=[], re=new RegExp(`(?:^|\\${sep})("(?:[^"]*(?:""[^"]*)*)"|[^\\${sep}]*)`, 'g');
  let m;
  while((m=re.exec(line))!==null){
    let v=m[1];
    if(v.startsWith('"')&&v.endsWith('"')) v=v.slice(1,-1).replace(/""/g,'"');
    result.push(v);
  }
  return result;
}

function showImportStep(step){
  ['parse','done','loading'].forEach(s=>document.getElementById('import-step-'+s).style.display=s===step?'':'none');
}

window.closeImport = function(){
  document.getElementById('import-overlay').classList.remove('open');
  importRows=[];
};

window.confirmImport = async function(){
  if(!importRows.length) return;
  showImportStep('loading');
  let ok=0, fail=0;
  for(const r of importRows){
    try {
      const {_unit, ...data} = r;
      await addDoc(bookingsCol(), {...data, createdAt: new Date().toISOString()});
      ok++;
    } catch(e){ fail++; console.error(e); }
  }
  importRows=[];
  document.getElementById('import-done-msg').textContent =
    `${ok} prenotazion${ok!==1?'i importate':'e importata'} con successo!`+(fail?` (${fail} errori)`:' 🎉');
  showImportStep('done');
};

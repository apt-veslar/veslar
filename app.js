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
};

// ---- DASHBOARD ----
function renderDashboard() {
  const now = new Date();
  const cm=now.getMonth(), cy=now.getFullYear();
  const thisMonthBooks = bookings.filter(b=>{ const ci=new Date(b.checkin); return ci.getMonth()===cm&&ci.getFullYear()===cy; });
  const revMonth = thisMonthBooks.reduce((s,b)=>s+Number(b.amount||0),0);
  const nightsMonth = thisMonthBooks.reduce((s,b)=>s+Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000),0);
  const daysInMonth = new Date(cy,cm+1,0).getDate();
  const occRate = Math.min(100,Math.round(nightsMonth/(daysInMonth*2)*100));

  document.getElementById('metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Ricavi ${monthNames[cm].substring(0,3)}</div><div class="metric-value">€${revMonth.toLocaleString('it')}</div><div class="metric-sub">questo mese</div></div>
    <div class="metric"><div class="metric-label">Notti prenotate</div><div class="metric-value">${nightsMonth}</div><div class="metric-sub">${monthNames[cm]}</div></div>
    <div class="metric"><div class="metric-label">Tasso occupazione</div><div class="metric-value">${occRate}%</div><div class="metric-sub">media 2 apt</div></div>
    <div class="metric"><div class="metric-label">Prenotazioni totali</div><div class="metric-value">${bookings.length}</div><div class="metric-sub">tutti gli anni</div></div>`;

  const months=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
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
    const ab=bookings.filter(b=>b.apt===a);
    const rev=ab.reduce((s,b)=>s+Number(b.amount||0),0);
    const nights=ab.reduce((s,b)=>s+Math.round((new Date(b.checkout)-new Date(b.checkin))/86400000),0);
    document.getElementById('apt'+a+'-stats').innerHTML=`
      <div class="price-row"><span style="color:var(--text-sec);">Ricavi totali</span><strong>€${rev.toLocaleString('it')}</strong></div>
      <div class="price-row"><span style="color:var(--text-sec);">Notti prenotate</span><strong>${nights}</strong></div>
      <div class="price-row"><span style="color:var(--text-sec);">Prenotazioni</span><strong>${ab.length}</strong></div>
      <div class="price-row" style="border:none;"><span style="color:var(--text-sec);">Media per notte</span><strong>${nights?'€'+Math.round(rev/nights):'-'}</strong></div>`;
  });
}

// ---- CALENDAR ----
window.setApt=function(n){
  currentApt=n;
  document.getElementById('aptab1').className='apt-tab'+(n===1?' active-apt1':'');
  document.getElementById('aptab2').className='apt-tab'+(n===2?' active-apt2':'');
  document.getElementById('aptab0').className='apt-tab'+(n===0?' active-apt1':'');
  renderCalendar();
};
window.prevMonth=function(){calMonth--;if(calMonth<0){calMonth=11;calYear--;}renderCalendar();};
window.nextMonth=function(){calMonth++;if(calMonth>11){calMonth=0;calYear++;}renderCalendar();};

function renderCalendar(){
  document.getElementById('cal-month-label').textContent=monthNames[calMonth]+' '+calYear;
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
      return `<div class="cal-booking ${b.source}">${aptDot}${b.guest.split(' ')[0]}</div>`;
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

// ---- BOOKINGS LIST ----
window.renderBookings = function(){
  const aptF=document.getElementById('filter-apt')?.value||'all';
  const srcF=document.getElementById('filter-src')?.value||'all';
  let filtered=bookings.filter(b=>(aptF==='all'||b.apt===parseInt(aptF))&&(srcF==='all'||b.source===srcF));
  filtered.sort((a,b)=>new Date(b.checkin)-new Date(a.checkin));
  const srcLabel={airbnb:'Airbnb',booking:'Booking',manual:'Manuale'};
  const el=document.getElementById('bookings-list');
  if(!el) return;
  el.innerHTML=filtered.length?filtered.map(b=>`
    <div class="booking-row">
      <span class="badge badge-${b.source}">${srcLabel[b.source]||b.source}</span>
      <span class="badge badge-apt${b.apt}">${aptNames[b.apt]||'Apt '+b.apt}</span>
      <span class="booking-guest">${b.guest}</span>
      <span class="booking-dates">${fmtDateFull(b.checkin)} → ${fmtDateFull(b.checkout)}</span>
      <span class="booking-amount">€${Number(b.amount||0).toLocaleString('it')}</span>
      ${b.notes?`<span style="font-size:11px;color:var(--text-ter);">${b.notes}</span>`:''}
      <button class="btn btn-sm" onclick="editBooking('${b.id}')">✎ Modifica</button>
      <button class="btn btn-sm btn-danger" onclick="deleteBooking('${b.id}')">✕</button>
    </div>`).join(''):'<div class="empty">Nessuna prenotazione trovata</div>';
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
  document.getElementById('m-apt').value='1';
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
  const guest=document.getElementById('m-guest').value.trim();
  const checkin=document.getElementById('m-checkin').value;
  const checkout=document.getElementById('m-checkout').value;
  const amount=parseFloat(document.getElementById('m-amount').value)||0;
  if(!guest){alert('Inserisci il nome dell\'ospite.');return;}
  if(!checkin||!checkout){alert('Inserisci le date.');return;}
  if(new Date(checkout)<=new Date(checkin)){alert('Il check-out deve essere dopo il check-in.');return;}
  const data = {
    apt:parseInt(document.getElementById('m-apt').value),
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

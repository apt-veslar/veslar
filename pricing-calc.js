// Pure quote/pricing calculation logic for the "Calcolatore" tab — no DOM,
// no Firebase. Shared between the desktop (app.js) and mobile (mobile.js)
// entry points so the seasons, the history model and the math live in
// exactly one place.
//
// Prices are derived from past *direct* bookings: for each apartment and
// season we take the median rent per night per person (amount minus the
// cleaning fee, divided by nights and guests). Platform prices are the
// direct price grossed up by the platform commission.

export const CALC_CLEANING = { 1: 60, 2: 50 };       // € a soggiorno: Olbe, Poch
export const CALC_LINENS_PER_PERSON = 10;            // € a persona, una tantum
export const CALC_MIN_PPN = 20;                      // € minimo per notte per persona
// Sconto soggiorni lunghi, sull'affitto (la soglia più alta vince).
export const CALC_LONG_STAY = [ { minNights: 7, pct: 10 }, { minNights: 5, pct: 5 } ];
// Commissioni piattaforma di default (%), modificabili dal calcolatore.
export const CALC_DEFAULT_COMMISSION = { airbnb: 15, booking: 18 };
// Prenotazioni passate fuori da questa forchetta (€/notte/persona) sono
// considerate incoerenti e non entrano nel calcolo.
export const CALC_ANOMALY_LOW = CALC_MIN_PPN;
export const CALC_ANOMALY_HIGH = 150;

export const calcSeasons = [
  { key:'capodanno', label:'Capodanno', match:(m,d)=>(m===12&&d>=27)||(m===1&&d<=6) },
  { key:'natale', label:'Natale', match:(m,d)=>m===12&&d>=20&&d<=26 },
  { key:'alta_invernale', label:'Alta invernale', match:(m,d)=>(m===1&&d>=7)||m===2||m===3 },
  { key:'alta_estiva', label:'Alta estiva', match:(m)=>m===7||m===8 },
  { key:'bassa', label:'Bassa/media stagione', match:()=>true },
];

export function calcGetSeason(date){
  const m=date.getMonth()+1, d=date.getDate();
  return calcSeasons.find(s=>s.match(m,d));
}

function isoDay(date){
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}

function eachNight(checkin, checkout){
  if(!checkin || !checkout) return [];
  const start=new Date(checkin+'T00:00:00');
  const end=new Date(checkout+'T00:00:00');
  if(!(end>start)) return [];
  const out=[];
  for(const cur=new Date(start); cur<end; cur.setDate(cur.getDate()+1)) out.push(new Date(cur));
  return out;
}

function median(xs){
  if(!xs.length) return null;
  const s=[...xs].sort((a,b)=>a-b);
  const mid=Math.floor(s.length/2);
  return s.length%2 ? s[mid] : (s[mid-1]+s[mid])/2;
}

// Classifies every completed stay (checkout on or before today) into a usable
// sample or an anomaly. Platform bookings are kept as samples too, but only to
// compare them with direct ones: they never set the direct price.
export function calcAnalyzeHistory(bookings, today=new Date()){
  const todayIso = isoDay(today);
  const samples=[], anomalies=[];
  (bookings||[]).forEach(b=>{
    if(!b || b.checkout>todayIso) return;
    const nights = eachNight(b.checkin, b.checkout);
    if(!nights.length) return;
    const apt = Number(b.apt)===2 ? 2 : 1;
    const amount = Number(b.amount)||0;
    const guests = Number(b.guestsNum)||0;
    const source = b.source||'manual';
    const base = { booking:b, apt, source, nights:nights.length, guests, amount };
    if(amount<=0){ anomalies.push({ ...base, reason:'importo a zero o mancante' }); return; }
    if(!guests){ anomalies.push({ ...base, reason:'numero ospiti mancante' }); return; }
    const rent = amount - CALC_CLEANING[apt];
    const ppn = rent / nights.length / guests;
    if(ppn < CALC_ANOMALY_LOW){ anomalies.push({ ...base, ppn, reason:`importo molto basso (${Math.round(ppn)} €/notte/persona)` }); return; }
    if(ppn > CALC_ANOMALY_HIGH){ anomalies.push({ ...base, ppn, reason:`importo molto alto (${Math.round(ppn)} €/notte/persona)` }); return; }
    // The stay counts for the season most of its nights fall in.
    const counts={};
    nights.forEach(n=>{ const k=calcGetSeason(n).key; counts[k]=(counts[k]||0)+1; });
    const season = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    samples.push({ ...base, ppn, season });
  });
  anomalies.sort((a,b)=>(a.booking.checkin<b.booking.checkin?1:-1));
  return { samples, anomalies };
}

// Median rate per night per person for each apartment and season, from direct
// bookings, plus how platform bookings compared with direct ones.
export function calcBuildModel(bookings, today=new Date()){
  const { samples, anomalies } = calcAnalyzeHistory(bookings, today);
  const direct = samples.filter(s=>s.source==='manual');
  const rates = {};
  [1,2].forEach(apt=>{
    rates[apt]={};
    calcSeasons.forEach(season=>{
      const xs = direct.filter(s=>s.apt===apt && s.season===season.key).map(s=>s.ppn);
      rates[apt][season.key] = { ppn: median(xs), count: xs.length };
    });
  });
  const platformVsDirect = {};
  ['airbnb','booking'].forEach(src=>{
    const ratios=[];
    [1,2].forEach(apt=>calcSeasons.forEach(season=>{
      const d = rates[apt][season.key].ppn;
      const p = median(samples.filter(s=>s.source===src && s.apt===apt && s.season===season.key).map(s=>s.ppn));
      if(d && p) ratios.push(p/d);
    }));
    const r = median(ratios);
    platformVsDirect[src] = r===null ? null : { pct: Math.round((r-1)*100), pairs: ratios.length };
  });
  return { rates, samples, anomalies, directCount: direct.length, platformVsDirect };
}

// Rate for one apartment and season, falling back when there is no direct
// history for it: same season on the other apartment, then this apartment's
// other seasons (the cheapest one for the low season, so a missing low season
// is never priced like a high one), then the minimum.
export function calcRateFor(model, apt, seasonKey){
  const other = apt===1 ? 2 : 1;
  const own = model.rates[apt][seasonKey];
  if(own.ppn) return { ppn: own.ppn, basis:'storico', count: own.count };
  const alt = model.rates[other][seasonKey];
  if(alt.ppn) return { ppn: alt.ppn, basis:'altro', count: alt.count };
  const seasonal = Object.values(model.rates[apt]).filter(r=>r.ppn);
  if(seasonal.length){
    const ppn = seasonKey==='bassa' ? Math.min(...seasonal.map(r=>r.ppn)) : median(seasonal.map(r=>r.ppn));
    return { ppn, basis:'media', count: seasonal.reduce((n,r)=>n+r.count,0) };
  }
  return { ppn: CALC_MIN_PPN, basis:'minimo', count: 0 };
}

export function calcLongStayPct(nights){
  const tier = CALC_LONG_STAY.find(t=>nights>=t.minNights);
  return tier ? tier.pct : 0;
}

export function calcFmtEuro(n){ return '€'+Math.round(n).toLocaleString('it-IT'); }

export function calcFmtDateIt(iso){
  const d=new Date(iso+'T00:00:00');
  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}

// Full quote computation. Returns null if checkout<=checkin or there are no
// guests, otherwise the complete breakdown used both for on-screen rendering
// and the "copy summary" clipboard text. Every guest, children included, pays
// the per-person rate and the linens.
export function calcComputeQuote({ model, apt, checkin, checkout, adults, children, linens, discountInput, commission }){
  const nights = eachNight(checkin, checkout);
  const a = adults||0, c = children||0;
  const persons = a+c;
  if(!nights.length || !persons) return null;

  const pct = calcLongStayPct(nights.length);
  const groups = [];
  nights.forEach(date=>{
    const season = calcGetSeason(date);
    let g = groups.find(g=>g.key===season.key);
    if(!g){
      const r = calcRateFor(model, apt, season.key);
      const ppn = Math.max(r.ppn, CALC_MIN_PPN);
      const ppnDiscounted = Math.max(ppn*(1-pct/100), CALC_MIN_PPN);
      g = { key:season.key, label:season.label, count:0, ppn, ppnDiscounted, basis:r.basis, basisCount:r.count, total:0, totalDiscounted:0 };
      groups.push(g);
    }
    g.count++; g.total+=g.ppn*persons; g.totalDiscounted+=g.ppnDiscounted*persons;
  });

  const rent = groups.reduce((s,g)=>s+g.total,0);
  const longStayDiscount = rent - groups.reduce((s,g)=>s+g.totalDiscounted,0);
  const discount = Math.max(0, Math.min(discountInput||0, rent-longStayDiscount));
  const cleaning = CALC_CLEANING[apt];
  const linensCost = linens ? CALC_LINENS_PER_PERSON*persons : 0;
  const taxNights = Math.min(nights.length, 7);
  const tax = 2*a*taxNights;
  const stay = rent - longStayDiscount - discount + cleaning + linensCost;
  const total = stay + tax;

  // On a platform the stay is grossed up so that, after the commission, the
  // net matches the direct price. The tourist tax is collected apart.
  const comm = commission || CALC_DEFAULT_COMMISSION;
  const platforms = ['airbnb','booking'].map(src=>{
    const p = Math.min(Math.max(Number(comm[src])||0, 0), 60);
    return { src, pct:p, price: stay/(1-p/100) };
  });

  return {
    nightsCount: nights.length, checkin, checkout, persons, rent, groups,
    longStayPct: pct, longStayDiscount,
    adults: a, totalGuests: persons, cleaning, linensCost, taxNights, tax, discount, stay, total,
    platforms,
  };
}

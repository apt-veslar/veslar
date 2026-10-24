// Pure quote/pricing calculation logic for the "Calcolatore" tab — no DOM,
// no Firebase. Shared between the desktop (app.js) and mobile (mobile.js)
// entry points so the seasons, the history model and the math live in
// exactly one place.
//
// Prices are derived from past *direct* bookings: for each apartment and
// season we take the median rent per night (amount divided by nights; the
// amounts imported from Rentlio are rent only, cleaning was a separate extra).
// Historically the price barely moved with the number of guests, so the rate
// is per apartment, with a floor of CALC_MIN_PPN per guest per night. Only the
// last CALC_RECENT_YEARS years count when they have enough stays, and every
// past price is raised by CALC_ANNUAL_INCREASE per year since the stay, so old
// prices don't drag the quote down. Platform prices are the direct price
// grossed up by the platform commission.

export const CALC_CLEANING = { 1: 60, 2: 50 };       // € a soggiorno: Olbe, Poch
export const CALC_LINENS_PER_PERSON = 10;            // € a persona, una tantum
export const CALC_MIN_PPN = 20;                      // € minimo per notte per persona
// Posti letto: le tariffe valgono per l'appartamento pieno; per ogni ospite in
// meno si sconta l'affitto di CALC_FEWER_GUESTS_DISCOUNT %.
export const CALC_CAPACITY = { 1: 7, 2: 5 };
export const CALC_FEWER_GUESTS_DISCOUNT = 5;
// Rivalutazione annua dei prezzi passati (%): inflazione e aumento dei costi
// (riscaldamento, elettricità). Ogni soggiorno è portato ai prezzi dell'anno
// del preventivo, composto per ogni anno trascorso.
export const CALC_ANNUAL_INCREASE = 3;
// Commissioni piattaforma di default (%), modificabili dal calcolatore.
export const CALC_DEFAULT_COMMISSION = { airbnb: 15, booking: 18 };
// Prenotazioni passate considerate incoerenti, escluse dal calcolo: sotto
// €12 a persona o €40 ad appartamento per notte (parenti o importi
// incompleti; in passato 15-19 € a persona per gruppi numerosi erano prezzi
// reali), oppure sopra €600 a notte.
export const CALC_ANOMALY_LOW_PPN = 12;
export const CALC_ANOMALY_LOW_NIGHT = 40;
export const CALC_ANOMALY_HIGH_NIGHT = 600;
// Anni recenti usati per le tariffe, se hanno almeno CALC_RECENT_MIN soggiorni.
export const CALC_RECENT_YEARS = 4;
export const CALC_RECENT_MIN = 3;

// Martedì grasso falls 47 days before Easter (Gregorian computus).
function carnevaleTuesday(year){
  const a=year%19, b=Math.floor(year/100), c=year%100, d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25),
        g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30, i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7,
        m=Math.floor((a+11*h+22*l)/451), month=Math.floor((h+l-7*m+114)/31), day=((h+l-7*m+114)%31)+1;
  return new Date(year, month-1, day-47);
}
// Carnival week: the seven nights from the Saturday before Martedì grasso.
function isCarnevale(date){
  const start = carnevaleTuesday(date.getFullYear());
  start.setDate(start.getDate()-3);
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate())-start)/86400000);
  return days>=0 && days<7;
}

// Seasons are matched in order, so the specific weeks come before the
// periods that contain them. A season with no direct history for either
// apartment falls back to `fallback`. Direct history is too thin to tell
// carnival and January apart from the rest of the winter, so `atLeast` and
// `atMost` bound them to a percentage of the season around them: carnival at
// least 15% above the alta invernale, January at least 10% below it.
export const calcSeasons = [
  { key:'capodanno', label:'Capodanno', match:(m,d)=>(m===12&&d>=27)||(m===1&&d<=6) },
  { key:'natale', label:'Natale', match:(m,d)=>m===12&&d>=20&&d<=26 },
  { key:'carnevale', label:'Carnevale', match:(m,d,date)=>isCarnevale(date), fallback:'alta_invernale', atLeast:{ key:'alta_invernale', pct:15 } },
  // After Epiphany schools restart and it is very cold: quiet until February.
  { key:'gennaio', label:'Bassa invernale (gennaio)', match:(m,d)=>m===1&&d>=7, fallback:'bassa', atMost:{ key:'alta_invernale', pct:-10 } },
  { key:'alta_invernale', label:'Alta invernale', match:(m)=>m===2||m===3 },
  // The two weeks around 15 August are the most requested of the summer.
  { key:'ferragosto', label:'Ferragosto', match:(m,d)=>m===8&&d>=8&&d<=22 },
  { key:'alta_estiva', label:'Alta estiva', match:(m)=>m===7||m===8 },
  { key:'bassa', label:'Bassa/media stagione', match:()=>true },
];

export function calcGetSeason(date){
  const m=date.getMonth()+1, d=date.getDate();
  return calcSeasons.find(s=>s.match(m,d,date));
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
    // "Noi" marks the family's own stays: not a rental, so not history.
    if(!b || b.checkout>todayIso || String(b.guest||'').trim().toLowerCase()==='noi') return;
    const nights = eachNight(b.checkin, b.checkout);
    if(!nights.length) return;
    const apt = Number(b.apt)===2 ? 2 : 1;
    const amount = Number(b.amount)||0;
    const guests = Number(b.guestsNum)||0;
    const source = b.source||'manual';
    const night = amount / nights.length;
    const ppn = guests ? night/guests : null;
    const base = { booking:b, apt, source, nights:nights.length, guests, amount, night, ppn };
    if(amount<=0){ anomalies.push({ ...base, reason:'importo a zero o mancante' }); return; }
    if(night < CALC_ANOMALY_LOW_NIGHT){ anomalies.push({ ...base, reason:`importo molto basso (${Math.round(night)} €/notte)` }); return; }
    if(ppn!==null && ppn < CALC_ANOMALY_LOW_PPN){ anomalies.push({ ...base, reason:`importo molto basso (${Math.round(ppn)} €/notte a persona)` }); return; }
    if(night > CALC_ANOMALY_HIGH_NIGHT){ anomalies.push({ ...base, reason:`importo molto alto (${Math.round(night)} €/notte)` }); return; }
    // The stay counts for the season most of its nights fall in.
    const counts={};
    nights.forEach(n=>{ const k=calcGetSeason(n).key; counts[k]=(counts[k]||0)+1; });
    const season = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    samples.push({ ...base, season });
  });
  anomalies.sort((a,b)=>(a.booking.checkin<b.booking.checkin?1:-1));
  return { samples, anomalies };
}

// Median rent per night for each apartment and season, from direct bookings,
// plus how platform bookings compared with direct ones.
export function calcBuildModel(bookings, today=new Date()){
  const { samples, anomalies } = calcAnalyzeHistory(bookings, today);
  // Rates are expressed at this year's prices; calcComputeQuote moves them on
  // to the year of the stay being quoted.
  const year = today.getFullYear();
  samples.forEach(s=>{ s.indexed = s.night*calcYearFactor(year-Number(s.booking.checkin.slice(0,4))); });
  const recentFrom = (today.getFullYear()-CALC_RECENT_YEARS)+'-01-01';
  const pick = list=>{
    const recent = list.filter(s=>s.booking.checkin>=recentFrom);
    return recent.length>=CALC_RECENT_MIN ? recent : list;
  };
  const rates = {};
  [1,2].forEach(apt=>{
    rates[apt]={};
    calcSeasons.forEach(season=>{
      const xs = pick(samples.filter(s=>s.source==='manual' && s.apt===apt && s.season===season.key)).map(s=>s.indexed);
      rates[apt][season.key] = { night: median(xs), count: xs.length };
    });
  });
  const platformVsDirect = {};
  ['airbnb','booking'].forEach(src=>{
    const ratios=[];
    [1,2].forEach(apt=>calcSeasons.forEach(season=>{
      const d = rates[apt][season.key].night;
      const p = median(pick(samples.filter(s=>s.source===src && s.apt===apt && s.season===season.key)).map(s=>s.indexed));
      if(d && p) ratios.push(p/d);
    }));
    const r = median(ratios);
    platformVsDirect[src] = r===null ? null : { pct: Math.round((r-1)*100), pairs: ratios.length };
  });
  return { year, rates, samples, anomalies, directCount: samples.filter(s=>s.source==='manual').length, platformVsDirect };
}

// Rate for one apartment and season, falling back when there is no direct
// history for it: same season on the other apartment (scaled by how the two
// apartments compare in the seasons both have), then the season's own
// fallback season if it has one, then this apartment's other seasons (the
// cheapest one for the low season, so a missing low season is never priced
// like a high one), then only the per-guest minimum. Seasons with a bound
// are then kept within it.
export function calcRateFor(model, apt, seasonKey){
  const r = rawRateFor(model, apt, seasonKey);
  const season = calcSeasons.find(s=>s.key===seasonKey);
  const bound = (b, keep)=>{
    const ref = calcRateFor(model, apt, b.key);
    const night = ref.night*(1+b.pct/100);
    return ref.night && keep(night) ? { ...ref, night, basis:'come', from:b.key, pct:b.pct } : null;
  };
  return (season.atLeast && bound(season.atLeast, n=>n>r.night))
      || (season.atMost && bound(season.atMost, n=>n<r.night))
      || r;
}

function rawRateFor(model, apt, seasonKey){
  const other = apt===1 ? 2 : 1;
  const own = model.rates[apt][seasonKey];
  if(own.night) return { night: own.night, basis:'storico', count: own.count };
  const alt = model.rates[other][seasonKey];
  if(alt.night){
    const ratios = calcSeasons.map(s=>[model.rates[apt][s.key].night, model.rates[other][s.key].night]).filter(([x,y])=>x&&y).map(([x,y])=>x/y);
    return { night: alt.night*(median(ratios)||1), basis:'altro', count: alt.count };
  }
  const fallback = calcSeasons.find(s=>s.key===seasonKey).fallback;
  if(fallback) return { ...calcRateFor(model, apt, fallback), basis:'come', from:fallback, pct:0 };
  const seasonal = Object.values(model.rates[apt]).filter(r=>r.night);
  if(seasonal.length){
    const night = seasonKey==='bassa' ? Math.min(...seasonal.map(r=>r.night)) : median(seasonal.map(r=>r.night));
    return { night, basis:'media', count: seasonal.reduce((n,r)=>n+r.count,0) };
  }
  return { night: 0, basis:'minimo', count: 0 };
}

export function calcYearFactor(years){
  return Math.pow(1+CALC_ANNUAL_INCREASE/100, Math.max(0, years));
}

export function calcFmtEuro(n){ return '€'+Math.round(n).toLocaleString('it-IT'); }

export function calcFmtDateIt(iso){
  const d=new Date(iso+'T00:00:00');
  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}

// Full quote computation. Returns null if checkout<=checkin or there are no
// guests, otherwise the complete breakdown used both for on-screen rendering
// and the "copy summary" clipboard text. Every guest, children included,
// counts for the per-guest minimum, the linens and the fewer-guests discount.
export function calcComputeQuote({ model, apt, checkin, checkout, adults, children, linens, discountInput, commission }){
  const nights = eachNight(checkin, checkout);
  const a = adults||0, c = children||0;
  const persons = a+c;
  if(!nights.length || !persons) return null;

  const yearFactor = calcYearFactor(Number(checkin.slice(0,4))-model.year);
  const missing = Math.max(0, CALC_CAPACITY[apt]-persons);
  const fewerGuestsPct = missing*CALC_FEWER_GUESTS_DISCOUNT;
  const minNight = CALC_MIN_PPN*persons;
  const groups = [];
  nights.forEach(date=>{
    const season = calcGetSeason(date);
    let g = groups.find(g=>g.key===season.key);
    if(!g){
      const r = calcRateFor(model, apt, season.key);
      const base = r.night*yearFactor*(1-fewerGuestsPct/100);
      g = { key:season.key, label:season.label, count:0, night: Math.max(base, minNight), atMinimum: base<=minNight,
            basis:r.basis, basisCount:r.count, from:r.from, pct:r.pct, total:0 };
      groups.push(g);
    }
    g.count++; g.total+=g.night;
  });

  const rent = groups.reduce((s,g)=>s+g.total,0);
  const discount = Math.max(0, Math.min(discountInput||0, rent));
  const cleaning = CALC_CLEANING[apt];
  const linensCost = linens ? CALC_LINENS_PER_PERSON*persons : 0;
  const taxNights = Math.min(nights.length, 7);
  const tax = 2*a*taxNights;
  const stay = rent - discount + cleaning + linensCost;
  const total = stay + tax;

  // On a platform the stay is grossed up so that, after the commission, the
  // net matches the direct price. The tourist tax is collected apart.
  const comm = commission || CALC_DEFAULT_COMMISSION;
  const platforms = ['airbnb','booking'].map(src=>{
    const p = Math.min(Math.max(Number(comm[src])||0, 0), 60);
    return { src, pct:p, price: stay/(1-p/100) };
  });

  return {
    nightsCount: nights.length, checkin, checkout, persons, rent, groups, capacity: CALC_CAPACITY[apt], fewerGuestsPct,
    adults: a, totalGuests: persons, cleaning, linensCost, taxNights, tax, discount, stay, total,
    platforms,
  };
}

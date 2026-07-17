// Pure quote/pricing calculation logic for the "Calcolatore" tab — no DOM,
// no Firebase. Shared between the desktop (app.js) and mobile (mobile.js)
// entry points so the season rate table and math live in exactly one place.

// Season rate table + per-night rate derivation, matching the design handoff
// (design_handoff_price_calculator) exactly. The two "Alta invernale" entries
// are intentionally separate (different keys, Jan 7-31 vs Feb-Mar) even
// though they share a label and rates, reproducing the reference tool's own
// grouping behavior — a stay spanning the Jan/Feb boundary shows two
// "Alta invernale" lines rather than one merged one.
export const calcSeasons = [
  { key:'capodanno', label:'Capodanno', match:(m,d)=>(m===12&&d>=27)||(m===1&&d<=3), rates:{1:{week:1750,weekend:500},2:{week:1250,weekend:350}} },
  { key:'natale', label:'Natale', match:(m,d)=>m===12&&d>=20&&d<=26, rates:{1:{week:1500,weekend:430},2:{week:1000,weekend:280}} },
  { key:'alta_invernale', label:'Alta invernale', match:(m)=>(m===2||m===3), rates:{1:{week:1300,weekend:420},2:{week:875,weekend:300}} },
  { key:'alta_invernale_gen', label:'Alta invernale', match:(m,d)=>m===1&&d>=7, rates:{1:{week:1300,weekend:420},2:{week:875,weekend:300}} },
  { key:'alta_estiva', label:'Alta estiva', match:(m)=>m===7||m===8, rates:{1:{week:1300,weekend:420},2:{week:875,weekend:300}} },
  { key:'bassa', label:'Bassa/media stagione', match:()=>true, rates:{1:{week:750,weekend:250},2:{week:525,weekend:180}} },
];

export function calcGetSeason(date){
  const m=date.getMonth()+1, d=date.getDate();
  for(const s of calcSeasons) if(s.key!=='bassa' && s.match(m,d)) return s;
  return calcSeasons[calcSeasons.length-1];
}

export function calcNightlyRate(date, apt){
  const season = calcGetSeason(date);
  const r = season.rates[apt];
  const isWeekendNight = date.getDay()===5 || date.getDay()===6; // Fri/Sat
  const rate = isWeekendNight ? r.weekend/2 : (r.week-r.weekend)/5;
  return { season, rate };
}

export function calcComputeNights(checkin, checkout, apt){
  if(!checkin || !checkout) return [];
  const start=new Date(checkin+'T00:00:00');
  const end=new Date(checkout+'T00:00:00');
  if(end<=start) return [];
  const nights=[];
  let cur=new Date(start);
  while(cur<end){
    const {season,rate}=calcNightlyRate(cur, apt);
    nights.push({date:new Date(cur), season, rate});
    cur.setDate(cur.getDate()+1);
  }
  return nights;
}

export function calcFmtEuro(n){ return '€'+Math.round(n).toLocaleString('it-IT'); }

export function calcFmtDateIt(iso){
  const d=new Date(iso+'T00:00:00');
  const months=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}

// Full quote computation. Returns null if checkout<=checkin (invalid range),
// otherwise the complete breakdown used both for on-screen rendering and the
// "copy summary" clipboard text.
export function calcComputeQuote({ apt, checkin, checkout, adults, children, cleaning, linens, discountInput }){
  const nights = calcComputeNights(checkin, checkout, apt);
  if(!nights.length) return null;

  const rent = nights.reduce((s,n)=>s+n.rate,0);
  const groups = [];
  nights.forEach(n=>{
    let g = groups.find(g=>g.key===n.season.key);
    if(!g){ g={key:n.season.key,label:n.season.label,count:0,total:0}; groups.push(g); }
    g.count++; g.total+=n.rate;
  });

  const a = adults||0, c = children||0;
  const totalGuests = a+c;
  const linensCost = linens ? 10*totalGuests : 0;
  const taxNights = Math.min(nights.length, 7);
  const tax = 2*a*taxNights;
  const discount = Math.max(0, Math.min(discountInput||0, rent));
  const total = rent - discount + cleaning + linensCost + tax;

  return {
    nightsCount: nights.length, checkin, checkout, rent, groups,
    adults: a, totalGuests, cleaning, linensCost, taxNights, tax, discount, total,
    airbnbNet: total*0.97, airbnbGuest: total*1.15,
  };
}

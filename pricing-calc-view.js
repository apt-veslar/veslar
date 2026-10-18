// HTML/text builders for the "Calcolatore" tab, shared by desktop (app.js) and
// mobile (mobile.js). They only return strings; each entry point puts them in
// its own DOM.
import {
  calcSeasons, calcFmtEuro, calcFmtDateIt, CALC_LONG_STAY, CALC_MIN_PPN, CALC_RECENT_YEARS, CALC_RECENT_MIN,
} from './pricing-calc.js';

const srcLabel = { airbnb:'Airbnb', booking:'Booking', manual:'Diretta' };
const basisLabel = {
  storico: n=>`mediana di ${n} prenotazion${n===1?'e':'i'} dirett${n===1?'a':'e'}`,
  altro: n=>`nessun dato: stimata dall'altro appartamento (${n})`,
  media: n=>`nessun dato per la stagione: stimata dalle altre stagioni (${n})`,
  minimo: ()=>'nessun dato',
};
// Second line under a rent row: where the rate comes from, and whether the
// per-guest minimum lifted it.
function basisNote(g, persons){
  const b = basisLabel[g.basis](g.basisCount);
  return g.atMinimum ? `${b} · applicato il minimo di €${CALC_MIN_PPN} × ${persons} pers.` : b;
}

function esc(s){
  return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function calcQuoteHtml(q){
  let html = `<div style="font-size:12px;color:var(--text-sec);margin-bottom:10px;">${q.nightsCount} notti · ${q.persons} person${q.persons===1?'a':'e'} · ${calcFmtDateIt(q.checkin)} → ${calcFmtDateIt(q.checkout)}</div>`;
  q.groups.forEach(g=>{
    html += `<div class="price-row"><span>Affitto — ${g.label} (${g.count} notti × ${calcFmtEuro(g.night)})<div style="font-size:11px;color:var(--text-ter);margin-top:2px;">${basisNote(g, q.persons)}</div></span><strong>${calcFmtEuro(g.total)}</strong></div>`;
  });
  if(q.longStayDiscount>0){
    html += `<div class="price-row"><span>Sconto soggiorno lungo (−${q.longStayPct}%, minimo €${CALC_MIN_PPN}/notte/persona)</span><strong style="color:var(--airbnb-text);white-space:nowrap;">−${calcFmtEuro(q.longStayDiscount)}</strong></div>`;
  }
  if(q.discount>0){
    html += `<div class="price-row"><span>Sconto</span><strong style="color:var(--airbnb-text);white-space:nowrap;">−${calcFmtEuro(q.discount)}</strong></div>`;
  }
  html += `<div class="price-row"><span>Pulizie</span><strong>${calcFmtEuro(q.cleaning)}</strong></div>`;
  if(q.linensCost>0){
    html += `<div class="price-row"><span>Lenzuola e asciugamani (${q.persons} × €10)</span><strong>${calcFmtEuro(q.linensCost)}</strong></div>`;
  }
  html += `<div class="price-row"><span>Tassa di soggiorno (${q.adults} adulti × ${q.taxNights} giorni)</span><strong>${calcFmtEuro(q.tax)}</strong></div>`;
  html += `<div class="price-row" style="border:none;padding-top:14px;"><span style="font-weight:700;">Totale</span><span style="font-weight:700;font-size:20px;">${calcFmtEuro(q.total)}</span></div>`;
  html += `<div style="margin-top:1rem;text-align:right;"><button class="btn btn-primary" id="calc-copy-btn" onclick="copyCalcSummary()">Copia riepilogo per il cliente</button></div>`;
  return html;
}

export function calcPlatformsHtml(q, model){
  let html = `<div class="price-row"><span>Diretto (senza tassa di soggiorno)</span><strong>${calcFmtEuro(q.stay)}</strong></div>`;
  q.platforms.forEach(p=>{
    const hist = model.platformVsDirect[p.src];
    const histNote = hist ? `Storico: ${hist.pct>=0?'+':''}${hist.pct}% rispetto alle dirette (${hist.pairs} stagion${hist.pairs===1?'e':'i'} confrontabil${hist.pairs===1?'e':'i'})` : 'Storico: dati insufficienti per un confronto';
    html += `<div class="price-row"><div><div>Prezzo da impostare su ${srcLabel[p.src]}</div>
      <div style="font-size:11px;color:var(--text-ter);margin-top:2px;">Commissione <input class="price-input" style="width:52px;padding:2px 4px;" type="number" min="0" max="60" value="${p.pct}" onchange="setCalcCommission('${p.src}',this.value)">% · netto ≈ diretto · ${histNote}</div></div>
      <strong>${calcFmtEuro(p.price)}</strong></div>`;
  });
  return html;
}

export function calcHistoryHtml(model, apt, aptNames){
  const tiers = CALC_LONG_STAY.slice().reverse().map(t=>`−${t.pct}% da ${t.minNights} notti`).join(', ');
  let html = `<div style="font-size:12px;color:var(--text-sec);margin-bottom:8px;">Affitto per notte di ${aptNames[apt]}: mediana delle prenotazioni dirette concluse (importo diviso per notti; contano gli ultimi ${CALC_RECENT_YEARS} anni quando hanno almeno ${CALC_RECENT_MIN} soggiorni, altrimenti tutti). Mai meno di €${CALC_MIN_PPN} a notte per persona; ${tiers}.</div>`;
  calcSeasons.forEach(s=>{
    const r = model.rates[apt][s.key];
    html += `<div class="price-row"><span>${s.label}</span><strong>${r.night ? calcFmtEuro(r.night)+' <span style="font-weight:400;color:var(--text-sec);font-size:12px;">('+r.count+')</span>' : '<span style="font-weight:400;color:var(--text-sec);">nessun dato</span>'}</strong></div>`;
  });
  const an = model.anomalies;
  html += `<div style="font-weight:600;margin:14px 0 6px;">Prenotazioni escluse dal calcolo (${an.length})</div>`;
  if(!an.length){
    html += `<div style="font-size:12px;color:var(--text-sec);">Nessuna.</div>`;
  } else {
    html += `<div style="font-size:12px;color:var(--text-sec);margin-bottom:6px;">Importo a zero, sotto i €40 a notte (o €12 a persona) oppure sopra i €600 a notte. Tocca una riga per correggerla.</div>`;
    an.forEach(x=>{
      const b = x.booking;
      html += `<div class="price-row" style="cursor:pointer;font-size:13px;" onclick="editBooking('${esc(b.id)}')"><span>${esc(aptNames[x.apt])} · ${esc(b.guest||'—')} · ${calcFmtDateIt(b.checkin)} (${x.nights} notti, ${x.guests||'?'} osp.) · ${srcLabel[x.source]||esc(x.source)}<div style="font-size:11px;color:var(--text-ter);margin-top:2px;">${esc(x.reason)}</div></span><strong>${x.amount?calcFmtEuro(x.amount):'€0'}</strong></div>`;
    });
  }
  return html;
}

export function calcSummaryText(d){
  const lines = [];
  lines.push(`Preventivo appartamento ${d.aptName}`);
  lines.push(`${calcFmtDateIt(d.checkin)} → ${calcFmtDateIt(d.checkout)} (${d.nightsCount} nott${d.nightsCount===1?'e':'i'}, ${d.persons} person${d.persons===1?'a':'e'})`);
  lines.push('');
  d.groups.forEach(g=>lines.push(`${g.label} (${g.count} nott${g.count===1?'e':'i'} × ${calcFmtEuro(g.night)}): ${calcFmtEuro(g.total)}`));
  if(d.longStayDiscount) lines.push(`Sconto soggiorno lungo (${d.longStayPct}%): -${calcFmtEuro(d.longStayDiscount)}`);
  if(d.discount) lines.push(`Sconto: -${calcFmtEuro(d.discount)}`);
  lines.push(`Pulizie: ${calcFmtEuro(d.cleaning)}`);
  if(d.linensCost) lines.push(`Lenzuola e asciugamani (${d.totalGuests} persone): ${calcFmtEuro(d.linensCost)}`);
  lines.push(`Tassa di soggiorno (${d.adults} adult${d.adults===1?'o':'i'} × ${d.taxNights} giorni): ${calcFmtEuro(d.tax)}`);
  lines.push('');
  lines.push(`TOTALE: ${calcFmtEuro(d.total)}`);
  return lines.join('\n');
}

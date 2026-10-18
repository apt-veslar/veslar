// Keeps a check-in/check-out pair of <input type="date"> consistent, shared
// by the desktop (app.js) and mobile (mobile.js) entry points. The check-out
// can't be on or before the check-in: its picker starts from the day after,
// and when the check-in moves past it (or it is still empty) it is set to
// the check-in plus one night. A check-out already after the check-in is left
// alone, so moving the arrival inside a stay keeps the chosen departure.

function nextDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function syncCheckout(checkinId, checkoutId) {
  const checkinEl = document.getElementById(checkinId);
  const checkoutEl = document.getElementById(checkoutId);
  if (!checkinEl || !checkoutEl) return;
  const checkin = checkinEl.value;
  if (!checkin) { checkoutEl.min = ''; return; }
  const min = nextDay(checkin);
  checkoutEl.min = min;
  if (!checkoutEl.value || checkoutEl.value < min) checkoutEl.value = min;
}

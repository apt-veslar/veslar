// Sincronizzazione automatica dei feed iCal di Airbnb/Booking.com verso Firestore.
// Legge users/{uid}/settings/main.ical (chiavi: airbnb-1, airbnb-2, booking-1, booking-2)
// e mantiene allineate le prenotazioni corrispondenti in users/{uid}/bookings.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const ICAL = require('ical.js');

admin.initializeApp();
const db = admin.firestore();

const ICAL_KEYS = ['airbnb-1', 'airbnb-2', 'booking-1', 'booking-2'];
const GUEST_FALLBACK = { airbnb: 'Ospite Airbnb', booking: 'Ospite Booking.com' };

function keyToAptSource(key) {
  const [source, aptStr] = key.split('-');
  return { source, apt: parseInt(aptStr, 10) };
}

// Formatta un ICAL.Time usando i suoi componenti data diretti, evitando
// qualsiasi conversione tramite JS Date (che introdurrebbe scarti di
// fuso orario sui valori "solo data" degli eventi tutto il giorno).
function icalTimeToISODate(t) {
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

// Airbnb (and some Booking.com listings) export calendar-blocked /
// "not available" ranges as VEVENTs alongside real reservations, with no
// reservation reference in the description. Those aren't guest bookings.
const BLOCKED_SUMMARY_RE = /not available/i;
const RESERVATION_REF_RE = /reservation/i;

async function fetchAndParseFeed(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const jcalData = ICAL.parse(text);
  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents('vevent');
  const events = [];
  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent);
    if (!event.uid || !event.startDate || !event.endDate) continue;
    const summary = (event.summary || '').trim();
    const description = (event.description || '').trim();
    if (BLOCKED_SUMMARY_RE.test(summary) && !RESERVATION_REF_RE.test(description)) continue;
    events.push({
      uid: event.uid,
      checkin: icalTimeToISODate(event.startDate),
      checkout: icalTimeToISODate(event.endDate),
      summary,
      description,
    });
  }
  return events;
}

function normalizeNameKey(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Replica lato Admin SDK di findOrCreateCustomerByName in firebase-core.js.
async function findOrCreateCustomerByNameAdmin(uid, name) {
  const trimmed = (name || '').trim();
  const key = normalizeNameKey(trimmed);
  if (!key) return null;
  const customersRef = db.collection('users').doc(uid).collection('customers');
  const existing = await customersRef.where('nameKey', '==', key).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;
  const docRef = await customersRef.add({ name: trimmed, nameKey: key, createdAt: new Date().toISOString() });
  return docRef.id;
}

// Sincronizza tutti i feed configurati per un singolo utente. Ritorna un
// riepilogo per chiave e scrive lo stato in settings/main.lastSync.
async function syncUserIcalFeeds(uid, settings) {
  const ical = settings.ical || {};
  const bookingsRef = db.collection('users').doc(uid).collection('bookings');
  const results = {};

  for (const key of ICAL_KEYS) {
    const url = (ical[key] || '').trim();
    if (!url) continue;
    const { source, apt } = keyToAptSource(key);
    const stats = { added: 0, updated: 0, removed: 0, error: null };

    try {
      const events = await fetchAndParseFeed(url);
      const seenUids = new Set(events.map(e => e.uid));

      const existingSnap = await bookingsRef.where('icalKey', '==', key).get();
      const existingByUid = new Map();
      existingSnap.forEach(doc => existingByUid.set(doc.data().icalUid, doc));

      for (const ev of events) {
        const guest = ev.summary || GUEST_FALLBACK[source] || 'Ospite';
        const customerId = await findOrCreateCustomerByNameAdmin(uid, guest);
        const payload = {
          apt,
          source,
          guest,
          checkin: ev.checkin,
          checkout: ev.checkout,
          notes: ev.description || '',
          icalKey: key,
          icalUid: ev.uid,
          customerId,
        };

        const existingDoc = existingByUid.get(ev.uid);
        if (existingDoc) {
          const data = existingDoc.data();
          const changed = data.checkin !== payload.checkin
            || data.checkout !== payload.checkout
            || data.guest !== payload.guest
            || (data.notes || '') !== payload.notes;
          if (changed) {
            await existingDoc.ref.set({ ...payload, updatedAt: new Date().toISOString() }, { merge: true });
            stats.updated++;
          }
        } else {
          await bookingsRef.add({ ...payload, createdAt: new Date().toISOString() });
          stats.added++;
        }
      }

      // Prenotazioni sincronizzate in precedenza ma non più presenti nel
      // feed (es. cancellate su Airbnb/Booking) vengono rimosse.
      for (const [uidKey, doc] of existingByUid) {
        if (!seenUids.has(uidKey)) {
          await doc.ref.delete();
          stats.removed++;
        }
      }
    } catch (e) {
      stats.error = e.message || String(e);
      logger.error(`iCal sync failed for user ${uid}, feed ${key}`, e);
    }

    results[key] = stats;
  }

  await db.collection('users').doc(uid).collection('settings').doc('main')
    .set({ lastSync: { at: new Date().toISOString(), results } }, { merge: true });

  return results;
}

// Girata pianificata: ogni ora scandisce tutti gli utenti con almeno un
// link iCal salvato e li sincronizza in parallelo.
exports.syncIcalScheduled = onSchedule('every 60 minutes', async () => {
  const settingsSnap = await db.collectionGroup('settings').get();
  const jobs = [];

  settingsSnap.forEach((doc) => {
    if (doc.id !== 'main') return;
    const data = doc.data();
    const ical = data.ical || {};
    const hasFeed = ICAL_KEYS.some((k) => (ical[k] || '').trim());
    if (!hasFeed) return;
    const uid = doc.ref.parent.parent.id;
    jobs.push(syncUserIcalFeeds(uid, data));
  });

  await Promise.all(jobs);
  logger.info(`iCal scheduled sync completato per ${jobs.length} utenti.`);
});

// Sincronizzazione on-demand per il pulsante "Sincronizza ora" nell'app.
exports.triggerIcalSync = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', "Devi effettuare l'accesso.");
  }
  const uid = request.auth.uid;
  const settingsDoc = await db.collection('users').doc(uid).collection('settings').doc('main').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const results = await syncUserIcalFeeds(uid, settings);
  return { results };
});

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, collection, addDoc, deleteDoc, setDoc, getDoc, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

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
const functions = getFunctions(app);

let currentUser = null;

// Internal caches — never exposed as mutable shared state. `customers` backs
// findOrCreateCustomerByName's dedup lookup; `_bookingsCache` backs the
// backfill's "which bookings still need a customerId" scan. Callers get their
// own copy of each snapshot via onChange, so mutating these later (e.g. the
// optimistic push in findOrCreateCustomerByName) can't reach back into a
// caller's own array.
let customers = [];
let _bookingsCache = [];
let customersLoaded = false;
let bookingsLoadedOnce = false;
let backfillRan = false;

export function getCurrentUser() { return currentUser; }

// Wraps onAuthStateChanged. onUser(user) fires on sign-in, onLoggedOut() on
// sign-out (or any other reason auth state becomes null).
export function watchAuth(onUser, onLoggedOut) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      customersLoaded = false;
      bookingsLoadedOnce = false;
      backfillRan = false;
      onUser(user);
    } else {
      currentUser = null;
      onLoggedOut();
    }
  });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

// Callers must unsubscribe their own listeners (subscribeBookings/
// subscribeCustomers return values) before calling this, same order as before.
export async function signOutUser() {
  await fbSignOut(auth);
}

// ---- FIRESTORE PATHS ----
function userDoc(path) { return doc(db, 'users', currentUser.uid, ...path.split('/')); }
function bookingsCol() { return collection(db, 'users', currentUser.uid, 'bookings'); }
function customersCol() { return collection(db, 'users', currentUser.uid, 'customers'); }

// ---- SETTINGS ----
export async function loadSettingsDoc() {
  try {
    const snap = await getDoc(userDoc('settings/main'));
    return snap.exists() ? snap.data() : null;
  } catch (e) { console.error('loadSettings', e); return null; }
}

// merge:true so a caller that only tracks a subset of fields (e.g. mobile,
// which has no Sincronizzazione tab and never loads `ical`) can't wipe out
// fields it doesn't know about with a full-document overwrite.
export async function saveSettingsDoc(settings) {
  await setDoc(userDoc('settings/main'), settings, { merge: true });
}

// Chiama la Cloud Function triggerIcalSync (functions/index.js) per forzare
// una sincronizzazione immediata dei feed iCal salvati dall'utente corrente.
export async function triggerIcalSyncNow() {
  const call = httpsCallable(functions, 'triggerIcalSync');
  const res = await call();
  return res.data;
}

// ---- BOOKINGS REALTIME ----
// onChange(bookings[]) fires per snapshot with a fresh array. Returns an
// unsubscribe function.
export function subscribeBookings(onChange) {
  const q = query(bookingsCol(), orderBy('checkin', 'desc'));
  return onSnapshot(q, (snap) => {
    _bookingsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    bookingsLoadedOnce = true;
    onChange(_bookingsCache.slice());
  }, (e) => { console.error('snapshot error', e); });
}

export async function saveBookingDoc(data, editingId) {
  const customerId = await findOrCreateCustomerByName(data.guest);
  const payload = { ...data, customerId };
  if (editingId) {
    await setDoc(doc(db, 'users', currentUser.uid, 'bookings', editingId), { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
  } else {
    await addDoc(bookingsCol(), { ...payload, createdAt: new Date().toISOString() });
  }
}

export async function deleteBookingDoc(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'bookings', id));
}

// ---- CUSTOMERS REALTIME ----
export function subscribeCustomers(onChange) {
  const q = query(customersCol(), orderBy('name'));
  return onSnapshot(q, (snap) => {
    customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    customersLoaded = true;
    onChange(customers.slice());
  }, (e) => { console.error('customers snapshot error', e); });
}

function normalizeNameKey(name) {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Finds a customer by (normalized) name, creating one if none exists yet.
// Pushes newly created customers into the local `customers` cache immediately,
// so back-to-back calls for the same name (e.g. in a loop) don't race the
// onSnapshot round-trip and create duplicates.
export async function findOrCreateCustomerByName(name) {
  const trimmed = (name || '').trim();
  const key = normalizeNameKey(trimmed);
  if (!key) return null;
  const existing = customers.find(c => c.nameKey === key);
  if (existing) return existing.id;
  const docRef = await addDoc(customersCol(), { name: trimmed, nameKey: key, createdAt: new Date().toISOString() });
  customers.push({ id: docRef.id, name: trimmed, nameKey: key });
  return docRef.id;
}

// One-time, idempotent pass linking legacy bookings (saved before the
// customers feature existed) to a customer record, matched by guest name.
// No-ops instantly once every booking has a customerId. Guarded so it only
// ever runs once per page session, after both subscriptions have delivered
// at least one snapshot. onStart()/onDone(linkedCount) let the caller show
// its own saving indicator/toast — this module has no DOM access.
export async function runCustomerBackfillIfNeeded({ onStart, onDone } = {}) {
  if (backfillRan || !customersLoaded || !bookingsLoadedOnce) return;
  backfillRan = true;
  const toLink = _bookingsCache.filter(b => !b.customerId && b.guest);
  if (!toLink.length) return;
  if (onStart) onStart();
  let linked = 0;
  for (const b of toLink) {
    try {
      const customerId = await findOrCreateCustomerByName(b.guest);
      if (customerId) {
        await setDoc(doc(db, 'users', currentUser.uid, 'bookings', b.id), { customerId }, { merge: true });
        linked++;
      }
    } catch (e) { console.error('backfill link error', e); }
  }
  if (onDone) onDone(linked);
}

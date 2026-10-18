# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Italian-language SPA for managing apartment reservations at a mountain property (Veslar). Handles two apartments — Olbe (Apt 1) and Poch (Apt 2) — with booking management, revenue dashboards, calendar views, and iCal sync with Airbnb/Booking.com.

## Running Locally

No build step. Open `index.html` directly in a browser. Firebase SDK loads from CDN, so internet access is required.

## Deployment

No custom GitHub Actions workflows. GitHub Pages deploys automatically from `main` via the repo's built-in Pages deployment (Settings → Pages), independent of any workflow file.

The static site (`index.html`/`app.js`/`mobile.js`/etc.) has no tests, no linting tools, and no package manager. The `functions/` directory (Cloud Functions, see below) is a separate Node project with its own `package.json` and is deployed manually via `firebase deploy --only functions` — see `functions/README.md`.

## Architecture

The application is split across three files:

- **`index.html`** — HTML structure only (login screen, app shell, tab panels, booking modal)
- **`styles.css`** — all CSS custom properties, light/dark theme, and component styles
- **`app.js`** — ES6 module; Firebase init, auth, Firestore listeners, and all render functions

**Backend: Firebase (Auth + Firestore + Cloud Functions)**

- `users/{uid}/bookings/{id}` — individual booking documents
- `users/{uid}/settings/main` — apartment prices, extras, iCal feed URLs, and `lastSync` status
- A real-time `onSnapshot()` listener keeps the bookings list in sync after login
- `functions/` — Cloud Functions (Node, Admin SDK) that fetch and parse the Airbnb/Booking.com iCal feeds and upsert matching bookings; `syncIcalScheduled` runs hourly, `triggerIcalSync` is an `onCall` function the app invokes from the "Sincronizza ora" button. Bookings created this way carry `icalKey`/`icalUid` for dedup and are removed automatically if the corresponding event disappears from the feed before check-in (cancellation); stays already started or past are kept, since Airbnb drops them from the feed. On re-sync only dates are updated — guest/notes/amount entered by hand are preserved.

**Auth flow:** Google Sign-In → `onAuthStateChanged` → sets up Firestore listener → renders app

**UI tabs (all logic inline in `index.html`):**
- Dashboard — monthly revenue and occupancy charts
- Calendario — monthly calendar with booking overlays
- Prenotazioni — bookings list with filters (apartment, source); add/edit/delete
- Clienti — customers (`users/{uid}/customers`, linked to bookings by `customerId`) grouped by initial; "Unisci clienti" merges selected customers into the one whose name is kept (bookings move and take that name as `guest`, so a later edit doesn't recreate the old customer); customers with 0 bookings can be deleted
- Prezzi — per-apartment nightly rate, cleaning fee, deposit
- Calcolatore — quote calculator (`pricing-calc.js` math, `pricing-calc-view.js` HTML, shared by desktop and mobile). Rent per night is the median of past direct bookings per apartment and season (seasons: Capodanno, Natale, alta invernale, Ferragosto 8–22 Aug, alta estiva, bassa; amount is rent only, as imported from Rentlio; last 4 years when they have ≥3 stays), past prices raised 3%/year to the quote's year (inflation and costs), never below €20 per guest per night, no long-stay discount, fixed cleaning (Olbe 60, Poch 50), linens €10/person; platform prices gross up the direct price by an editable commission. Past bookings with zero amounts, under €40/night (or €12/guest/night) or over €600/night are excluded and listed in the tab; stays with guest "Noi" (the family itself) are ignored.
- Sincronizzazione — iCal feed URLs input, automatic hourly inbound sync + manual "Sincronizza ora" trigger, and calendar export
- Backup — export all bookings and settings as a downloadable JSON file

**Theme** preference is persisted in `localStorage`.

**PWA support** via `manifest.json` and icon assets at the root.

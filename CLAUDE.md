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
- `functions/` — Cloud Functions (Node, Admin SDK) that fetch and parse the Airbnb/Booking.com iCal feeds and upsert matching bookings; `syncIcalScheduled` runs hourly, `triggerIcalSync` is an `onCall` function the app invokes from the "Sincronizza ora" button. Bookings created this way carry `icalKey`/`icalUid` for dedup and are removed automatically if the corresponding event disappears from the feed (cancellation).

**Auth flow:** Google Sign-In → `onAuthStateChanged` → sets up Firestore listener → renders app

**UI tabs (all logic inline in `index.html`):**
- Dashboard — monthly revenue and occupancy charts
- Calendario — monthly calendar with booking overlays
- Prenotazioni — bookings list with filters (apartment, source); add/edit/delete
- Prezzi — per-apartment nightly rate, cleaning fee, deposit
- Sincronizzazione — iCal feed URLs input, automatic hourly inbound sync + manual "Sincronizza ora" trigger, and calendar export
- Backup — export all bookings and settings as a downloadable JSON file

**Theme** preference is persisted in `localStorage`.

**PWA support** via `manifest.json` and icon assets at the root.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Italian-language SPA for managing apartment reservations at a mountain property (Veslar). Handles two apartments — Olbe (Apt 1) and Poch (Apt 2) — with booking management, revenue dashboards, calendar views, and iCal sync with Airbnb/Booking.com.

## Running Locally

No build step. Open `index.html` directly in a browser. Firebase SDK loads from CDN, so internet access is required.

## Deployment

No custom GitHub Actions workflows. GitHub Pages deploys automatically from `main` via the repo's built-in Pages deployment (Settings → Pages), independent of any workflow file.

There are no tests, no linting tools, and no package manager.

## Architecture

The application is split across three files:

- **`index.html`** — HTML structure only (login screen, app shell, tab panels, booking modal)
- **`styles.css`** — all CSS custom properties, light/dark theme, and component styles
- **`app.js`** — ES6 module; Firebase init, auth, Firestore listeners, and all render functions

**Backend: Firebase (Auth + Firestore)**

- `users/{uid}/bookings/{id}` — individual booking documents
- `users/{uid}/settings/main` — apartment prices, extras, and iCal feed URLs
- A real-time `onSnapshot()` listener keeps the bookings list in sync after login

**Auth flow:** Google Sign-In → `onAuthStateChanged` → sets up Firestore listener → renders app

**UI tabs (all logic inline in `index.html`):**
- Dashboard — monthly revenue and occupancy charts
- Calendario — monthly calendar with booking overlays
- Prenotazioni — bookings list with filters (apartment, source); add/edit/delete
- Prezzi — per-apartment nightly rate, cleaning fee, deposit
- Sincronizzazione — iCal feed URLs input + calendar export
- Backup — export all bookings and settings as a downloadable JSON file

**Theme** preference is persisted in `localStorage`.

**PWA support** via `manifest.json` and icon assets at the root.

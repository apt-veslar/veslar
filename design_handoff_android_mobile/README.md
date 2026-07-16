# Handoff: Android Mobile — Gestione Appartamenti (Veslar)

## Overview
A mobile (Android) prototype of the existing "Gestione Appartamenti Montagna" apartment-booking management app (repo: `apt-veslar/veslar`). The desktop app is a single-page Italian-language admin tool for managing two rental apartments (Olbe = Apt 1, Poch = Apt 2): bookings, revenue dashboard, calendar, pricing, iCal sync, and backup. This prototype adapts the core flows to a native-feeling Android layout: bottom tab navigation, bottom-sheet modals, and Material-style status/gesture bars.

## About the Design Files
The file in this bundle (`Apartment Booking Mobile.dc.html`) is a **design reference built in HTML** — a working, click-through prototype showing intended layout, styling, and interaction, not production code to copy directly. The task is to **recreate this design in the target codebase's existing environment**. Since `apt-veslar/veslar` is currently a vanilla HTML/CSS/JS + Firebase SPA with no mobile app shell, this most likely means either:
- building a new native Android app (Kotlin/Jetpack Compose, or Kotlin + XML views) that talks to the same Firebase project (Auth + Firestore), or
- building a responsive/PWA-style mobile view reusing the existing `app.js` Firebase logic, if a native app isn't desired.
Choose whichever fits the team's plans; either way, reuse the existing Firestore schema and business logic from `app.js` rather than reinventing it.

## Fidelity
**High-fidelity.** Colors, spacing, type sizes, and copy are final/pixel-intentional and lifted directly from the production `styles.css` design tokens. Recreate pixel-perfectly, adapting only what's required for a native mobile shell (touch target sizes, bottom-sheet modals, status/gesture bars).

## Scope
This prototype covers 4 of the app's 7 tabs (chosen as the mobile priority): **Dashboard, Calendario, Prenotazioni (list + add/edit), Prezzi**. Not covered: Clienti, Sincronizzazione, Backup — apply the same visual system to these if/when built.

## Screens / Views

### Global shell
- **Status bar**: Android system status bar (time, signal/wifi/battery icons), color follows theme (black icons on light, white on dark).
- **App header**: sticky top bar, `background: var(--bg)`, `border-bottom: 0.5px solid var(--border)`, padding `10px 16px 12px`. Left: title "🏔️ Gestione Appartamenti" (17px/700) + subtitle "Montagna · 2 proprietà" (11px, `--text-sec`). Right: theme toggle button (pill, 20px radius, border `--border-sec`, ☀️/🌙 emoji, 16px).
- **Bottom tab bar**: 4 flex-equal buttons (Dashboard/Calendario/Prenotazioni/Prezzi), each a 16×16 icon (custom-drawn: 2×2 grid, calendar outline, 3 lines, €-circle) + 10px label. Active tab: icon+label in `--text` (bold), inactive in `--text-ter`.
- **Gesture nav bar**: Android pill indicator at the very bottom.
- **Toast**: bottom-center floating pill, `background: var(--text)`, `color: var(--bg)`, appears ~2.2s on save/delete actions.

### Dashboard
- 2×2 metric grid (`--bg-sec` cards, 8px radius): Ricavi mese corrente, Notti prenotate, Tasso occupazione, Prenotazioni totali. Value 20px/700, label 11px `--text-sec`.
- Monthly revenue card: year stepper (‹ / › buttons), legend dots (Olbe green / Poch blue), horizontally-scrollable 12-month twin-bar chart (bar width 9px, max height 80px, colors `--apt1`/`--apt2`).
- "Prossime prenotazioni" card: up to 5 upcoming bookings, each row = apt badge + guest name + date range + amount.
- Per-apartment yearly stats cards (Olbe, Poch): revenue, nights, booking count, avg/night — 4-row list format.

### Calendario
- Month + year `<select>` dropdowns.
- Legend row (5 colored dots: Olbe cal-purple, Poch cal-pink, Airbnb red, Booking blue, Manuale green).
- Apt filter pills: Olbe / Poch / Entrambi (both), pill style with colored border+bg when active.
- 7-column calendar grid, day cells (44px min-height) showing day number + up to 4 small colored dots (by booking source) for occupied days. Today = 1.5px `--text` border. Tapping an occupied day opens a **bottom sheet** listing that day's bookings (badges, dates, nights, amount, "✎ Modifica" edit button).

### Prenotazioni
- Apt + source filter `<select>` row.
- Full-width primary "+ Aggiungi prenotazione" button (`background:/border: var(--text)`).
- Booking list card: each row = source badge + apt badge + guest name, then date range + amount, then "✎ Modifica" / "✕ Elimina" buttons.
- Pagination (6/page): "Pagina X di Y" + ‹ › buttons.
- **Add/Edit modal**: bottom sheet (16px top corners), fields — Appartamento (select, required), Nome ospite (text, required, autocomplete-style), Check-in/Check-out (date, 2-col grid), Importo € / Fonte (2-col grid: number + select), Numero ospiti (number), Note (textarea). Footer: Annulla (outline) / Salva (filled dark) buttons. Validates apt/guest/dates required and checkout > checkin.

### Prezzi
- Two cards (Olbe, Poch): Tariffa base / Weekend / Alta stagione / Bassa stagione, each a label + right-aligned number input (70px) + unit label "€/notte".
- Extra fees card: Pulizie (€/soggiorno), Caparra (€).
- Full-width "Salva tutte le tariffe" button → toast confirmation.

## Interactions & Behavior
- Tab switch: instant, no transition, resets Prenotazioni pagination to page 1.
- Theme toggle: flips entire color token set (see Design Tokens) instantly, persists conceptually to user prefs (in the real app: `localStorage`).
- Calendar day tap → bottom-sheet slide-up (only for days with ≥1 booking).
- Modal open/close: tap backdrop or ✕/Annulla to dismiss; tapping the sheet itself must not close it (stopPropagation on the sheet).
- Booking save/delete/price save all show a bottom toast for ~2.2s.
- Form validation errors surface via the same toast mechanism (no separate error UI).

## State Management
- `theme`: 'light' | 'dark'
- `activeTab`: dashboard | calendario | prenotazioni | prezzi
- `bookings[]`: {id, apt, guest, checkin, checkout, amount, source, guestsNum, notes}
- `prices`: per-apt {base, weekend, high, low}; `extras`: {cleaning, deposit}
- Calendar: {year, month, aptFilter, openDayDate}
- Prenotazioni: {filterApt, filterSrc, page}
- Modal: {open, editingId, form fields}
- Dashboard: {selectedYear}
- Toast: {visible, message}

In production this should mirror the existing Firestore structure already used by `app.js`:
- `users/{uid}/bookings/{id}`
- `users/{uid}/settings/main` (prices, extras, ical)
- Real-time sync via Firestore `onSnapshot`, same as the web app.

## Design Tokens

**Light theme**
- `--bg:#ffffff` `--bg-sec:#f5f5f3` `--bg-ter:#eeede9`
- `--text:#1a1a18` `--text-sec:#666660` `--text-ter:#999992`
- `--border:rgba(0,0,0,.12)` `--border-sec:rgba(0,0,0,.22)`
- Olbe (apt1): `#1D9E75` / bg `#E1F5EE` / text `#0F6E56`
- Poch (apt2): `#378ADD` / bg `#E6F1FB` / text `#185FA5`
- Airbnb: bg `#FCEBEB` text `#A32D2D` dot `#E24B4A`
- Booking.com: bg `#E6F1FB` text `#0C447C` dot `#378ADD`
- Manuale: bg `#EAF3DE` text `#3B6D11` dot `#639922`
- Calendar Olbe: bg `#F3E8FD` text `#7E22CE` dot `#9333EA`
- Calendar Poch: bg `#FCE7F6` text `#A21CAF` dot `#C026D3`

**Dark theme**
- `--bg:#1c1c1a` `--bg-sec:#252523` `--bg-ter:#2e2e2c`
- `--text:#f0efea` `--text-sec:#a0a09a` `--text-ter:#6a6a64`
- `--border:rgba(255,255,255,.1)` `--border-sec:rgba(255,255,255,.2)`
- Olbe bg `#085041` text `#9FE1CB` / Poch bg `#0C447C` text `#B5D4F4`
- Airbnb bg `#501313` text `#F7C1C1` / Booking bg `#042C53` text `#B5D4F4` / Manuale bg `#173404` text `#C0DD97`
- Calendar Olbe bg `#3B0764` text `#E9D5FF` / Calendar Poch bg `#4A044E` text `#F5D0FE`

**Radii**: cards 12px, small controls 8px, pills/badges 9–20px full-round.
**Type**: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif`); sizes range 9px (chart labels) → 22px (metric values); weights 400/500/600/700.
**Spacing**: content padding 14px; card padding 12–14px; row padding 8–10px vertical.

## Assets
No image assets — all icons are hand-drawn CSS shapes (divs/borders), and the mountain 🏔️ emoji is used as the app glyph, matching the source app exactly. No external icon fonts or SVGs needed.

## Files
- `Apartment Booking Mobile.dc.html` — full interactive prototype (open directly in a browser).
- Original source reference (not included, read from GitHub during design): `apt-veslar/veslar` — `index.html`, `styles.css`, `app.js` define the desktop app this mobile version is based on; reuse its Firebase schema and business logic.

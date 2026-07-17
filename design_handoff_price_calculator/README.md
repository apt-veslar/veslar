# Handoff: Booking Price Calculator ("Calcolatore")

## Overview
An on-the-fly price calculator for the Veslar apartment booking web app (Olbe & Poch, Sappada). Used when a prospective guest asks for a quote: pick apartment, dates, and guest count, and it produces an itemized rent + fees breakdown, plus what the guest would pay on Airbnb.

## About the Design Files
The file in this bundle (`Calcolatore Prezzi.dc.html`) is a **design reference prototype** built in HTML/React-like syntax, not production code to copy verbatim. It reproduces the app's real `styles.css` tokens (colors, radii, fonts) inline. The task is to **recreate this screen inside the existing `apt-veslar/veslar` codebase** (plain HTML/CSS/ES6 modules, no build step — see `app.js`, `index.html`, `styles.css`), as a new tab alongside `Prezzi`, following the same patterns already used there (`window.xxx` global functions, `showTab()`, Firestore-backed settings).

## Fidelity
**High-fidelity.** Colors, spacing, type, and copy are final and pulled directly from the existing app's `styles.css` design tokens — implement pixel-for-pixel.

## Screen: "Calcolatore" tab

Add a new tab button next to `Prezzi` in the tabs bar (`index.html`), and a new `<div id="tab-calcolatore" class="section">`.

### Layout (top to bottom, inside `.container`, max-width 960px)
1. **Apartment toggle** — two pill buttons "Olbe (Apt 1)" / "Poch (Apt 2)", same visual pattern as `.apt-tab` / `.apt-tab.active-apt1` / `.active-apt2` in `styles.css`. Selecting switches which season rate table and apt colors are used everywhere below.
2. **Card "Date e ospiti"**:
   - Row of 2 date inputs: Check-in / Check-out (`.form-input` style, `grid-template-columns:1fr 1fr`, `gap:16px`, `box-sizing:border-box` to avoid overflow).
   - Row of 2 number inputs: Adulti / Bambini, same grid.
   - Defaults: check-in = today, check-out = today+7, adults=2, children=0.
3. **Card "Extra"** (`.card` / `.price-row` styling):
   - **Sconto sull'affitto** — number input (€), default 0. Reduces rent only, clamped to not exceed rent.
   - **Pulizie** — 3 pill buttons: €40 / €50 / €60 (selected = dark filled `background:#1a1a18;color:#fff`, unselected = outline `border:0.5px solid rgba(0,0,0,0.22);color:#666660`). Default €50.
   - **Lenzuola e asciugamani** — optional, toggle switch (44×26px pill, green `#1D9E75` when on), €10 per person (adults+children), one-off (not per night).
4. **Card "Preventivo · [Olbe/Poch badge]"**:
   - Nights count + date range line.
   - Sconto row (if 0 hidden... actually always show input — kept in Extra, but the computed "Sconto" negative line only appears in the total breakdown if discount > 0).
   - One row per season the stay touches: `Affitto — {season label} ({N} notti, {per-night}€/notte): {subtotal}€` — see pricing model below for how season groups and per-night rate are computed.
   - Pulizie row.
   - Lenzuola row (only if enabled).
   - Tassa di soggiorno row: `({adults} adulti × {min(nights,7)} giorni)`.
   - **Totale** row, bold, 20px.
   - "Copia riepilogo per il cliente" button (dark, `#1a1a18`) — copies a plain-text Italian summary to clipboard (see Copy Summary Format below), button label flips to "✓ Copiato" green for 2s.
5. **Card "Piattaforme di prenotazione"** (only shown when dates are valid):
   - Totale diretto = Totale from Preventivo.
   - Netto host (Airbnb, −3%) = Totale × 0.97.
   - Totale pagato ospite (Airbnb, +15%) = Totale × 1.15.

### Empty/invalid state
If checkout ≤ checkin (or no nights), show centered gray text "Seleziona un check-out successivo al check-in." instead of the breakdown, and hide the Piattaforme card.

## Pricing model (core logic — implement exactly)

Source data: `Listino per Stagione` sheet (uploaded Excel). Five seasons, each with a **weekly rate** and a **weekend rate** per apartment:

| Season | Period (month/day, year-agnostic) | Olbe week / weekend | Poch week / weekend |
|---|---|---|---|
| Capodanno | Dec 27 – Jan 3 | 1750 / 500 | 1250 / 350 |
| Natale | Dec 20 – Dec 26 | 1500 / 430 | 1000 / 280 |
| Alta invernale (settimana bianca) | Jan 7 – Mar 31 | 1300 / 420 | 875 / 300 |
| Alta estiva | Jul 1 – Aug 31 | 1300 / 420 | 875 / 300 |
| Bassa/media stagione | everything else (Apr–Jun, Sep–Nov, Jan 4–6, Dec 1–19) | 750 / 250 | 525 / 180 |

**Per-night rate derivation** (the sheet only gives week/weekend totals, not nightly rates — this is the formula used to convert them, verified against the sheet's own decomposition):
- For each night in the stay, find its calendar season (by month/day, ignoring year) and look up `{week, weekend}` for the selected apartment.
- If the night's weekday is **Friday or Saturday**: nightly rate = `weekend / 2`.
- Otherwise (Sun–Thu): nightly rate = `(week - weekend) / 5`.
- This exactly reproduces the sheet's week total for any full Sun→Sun 7-night stay (5 weeknights + Fri + Sat = week price).

**Totals:**
- Group consecutive/all nights by season → `rent = Σ nightly rates`; show one breakdown line per season touched, with nights count and average per-night rate for that group (`groupTotal / groupCount`).
- `discount` = user input, clamped to `[0, rent]`.
- `cleaning` = selected pill value (40/50/60), flat, one-off.
- `linens` = `10 × (adults + children)` if toggled on, else 0. One-off, not per-night.
- `tax` = `2 × adults × min(nights, 7)`. Children excluded. Capped at first 7 days of the stay.
- `total = rent - discount + cleaning + linens + tax`.
- `airbnbNet = total × 0.97` (3% host commission — from sheet's "Parametri Airbnb").
- `airbnbGuest = total × 1.15` (15% guest service fee — from sheet's "Parametri Airbnb").

## Copy Summary Format (clipboard text)
```
Preventivo appartamento {Olbe|Poch}
{d MMM yyyy} → {d MMM yyyy} ({N} notti)

{Season label} ({n} notti, {rate}€/notte): {subtotal}€
... one line per season group ...
Sconto: -{discount}€          ← only if discount > 0
Pulizie: {cleaning}€
Lenzuola e asciugamani ({guests} persone): {linens}€   ← only if enabled
Tassa di soggiorno ({adults} adulti × {taxDays} giorni): {tax}€

TOTALE: {total}€
```
Amounts formatted as `€` + rounded integer, Italian thousands separator (`toLocaleString('it-IT')`). Dates as `d MMM yyyy` with lowercase 3-letter Italian month abbreviations (gen, feb, mar, apr, mag, giu, lug, ago, set, ott, nov, dic).

## Design Tokens (from the app's existing `styles.css` — reuse these, don't invent new ones)
- Background: `#ffffff` (cards), `#f5f5f3` (tabs bg), `#eeede9` (page bg)
- Text: `#1a1a18` (primary), `#666660` (secondary), `#999992` (tertiary)
- Border: `rgba(0,0,0,0.12)` default, `rgba(0,0,0,0.22)` inputs
- Radius: `8px` standard, `12px` cards (`--radius` / `--radius-lg`)
- Olbe (Apt 1): `#1D9E75` accent, `#E1F5EE` bg, `#0F6E56` text
- Poch (Apt 2): `#378ADD` accent, `#E6F1FB` bg, `#185FA5` text
- Font: `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`, base 15px
- Discount negative amount color: `#A32D2D` (same red used for `--airbnb-text`)

## State
- `apt` (1 | 2), `checkin`, `checkout` (ISO date strings), `adults`, `children` (int), `cleaning` (40|50|60), `linens` (bool), `discount` (number ≥ 0), `copied` (transient bool for button feedback).
- Recommended: persist last-used cleaning/linens/discount defaults per apartment in the same `users/{uid}/settings/main` Firestore doc the app already uses for `prices`/`extras`, if useful — this calculator does NOT need its own Firestore writes; it's a stateless quoting tool that reads the seasonal rate table (constant, or move to Firestore settings if the owner wants to edit season dates/rates without a code change).

## Assets
None (no icons/images — emoji `🏔️` only, matches existing header).

## Files
- `Calcolatore Prezzi.dc.html` — full prototype (template + logic), reference implementation of all behavior above.

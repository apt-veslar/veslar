# Cloud Functions — sincronizzazione iCal

Sincronizza automaticamente (ogni ora, più un trigger manuale dall'app) i feed iCal di Airbnb/Booking.com salvati in `users/{uid}/settings/main.ical` dentro `users/{uid}/bookings`.

## Setup (una tantum)

1. Passa il progetto Firebase (`apt-veslar`) al piano **Blaze** (pay-as-you-go):
   Console Firebase → ⚙️ Impostazioni progetto → Utilizzo e fatturazione → Modifica piano.
   Necessario perché le Functions devono contattare Airbnb/Booking.com dall'esterno (non è permesso sul piano gratuito Spark). Con questo volume (2 utenti, sync oraria) il costo atteso resta entro il free tier di Functions/Cloud Scheduler, quindi ~€0/mese.

2. Installa la Firebase CLI (se non presente) ed effettua il login:
   ```bash
   npm install -g firebase-tools
   firebase login
   ```

3. Dalla cartella del progetto (non `functions/`), collega il progetto se non già fatto:
   ```bash
   firebase use --add
   ```
   (seleziona `apt-veslar`)

## Deploy

```bash
firebase deploy --only functions
```

Il primo deploy crea anche il job di Cloud Scheduler per `syncIcalScheduled` (girata ogni 60 minuti).

## Verifica

- `firebase functions:log` per vedere gli errori di fetch/parsing dei feed.
- Dall'app: tab **Sincronizzazione → Sincronizza ora**, poi controllare Calendario/Prenotazioni.
- Le prenotazioni importate dal feed hanno `source` (`airbnb`/`booking`) e i campi interni `icalKey`/`icalUid` usati per evitare duplicati e per rimuovere le prenotazioni cancellate lato Airbnb/Booking.

## Limitazioni note

- I feed Airbnb spesso non includono il nome dell'ospite per privacy: in quel caso la prenotazione viene creata con ospite "Ospite Airbnb"/"Ospite Booking.com", modificabile a mano (verrà però risovrascritta se il feed cambia).
- Se modifichi a mano date/ospite di una prenotazione sincronizzata, la sync successiva la riallinea di nuovo al feed (il feed resta la fonte di verità).

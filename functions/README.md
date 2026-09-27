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

- I feed Airbnb non includono il nome dell'ospite per privacy (il titolo è solo "Reserved"): la prenotazione viene creata con ospite "Ospite Airbnb"/"Ospite Booking.com". Ospite, note e importo si possono completare a mano e la sync non li sovrascrive più.
- Il feed resta la fonte di verità solo per le **date**: se le modifichi a mano, la sync successiva le riallinea al feed.
- Airbnb toglie dal feed i soggiorni appena iniziano o finiscono. Per questo una prenotazione sparita dal feed viene cancellata solo se il check-in non è ancora arrivato (vera disdetta); quelle già iniziate o passate restano come storico.
- Gli intervalli "Airbnb (Not available)" senza riferimento a una prenotazione (date bloccate, soggiorno minimo, calendario chiuso) non vengono importati.

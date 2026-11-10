# Metro Milano

Web app installabile (PWA) per trovare il percorso migliore in metropolitana a Milano (M1–M5) verso qualsiasi indirizzo.
Funziona su iPhone, iPad e Android, e anche da computer.

## Funzioni
- Partenza dalla posizione GPS ("◎ Qui"), da un indirizzo, un luogo noto, una fermata o un tocco sulla mappa
- Ricerca indirizzi tramite OpenStreetMap (Nominatim), con i risultati salvati sul dispositivo
- Tre criteri: più veloce, meno cambi, meno a piedi
- Itinerario passo passo con direzione, fermate, cambi e orario di arrivo
- Funziona offline (tranne la ricerca di indirizzi nuovi)

## Installazione sul telefono
- **iPhone / iPad (Safari):** apri il link, tocca Condividi e poi "Aggiungi alla schermata Home".
- **Android (Chrome):** apri il link e tocca "Installa" nel banner, oppure menu ⋮ e poi "Installa app".

## Pubblicazione
Basta un qualsiasi hosting statico in https (GitHub Pages, Netlify, Vercel). Su GitHub Pages:
Settings → Pages → Deploy from a branch → `main` / root.

Quando modifichi i file, aumenta `VERSION` in `sw.js` così i telefoni scaricano l'aggiornamento.

I tempi sono stime calcolate dalla rete, non gli orari reali ATM.

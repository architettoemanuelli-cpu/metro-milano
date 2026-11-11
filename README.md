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

## Metro Londra
Nella cartella `londra/` c'è la stessa app per Londra (Tube, Elizabeth line, DLR e London Overground), installabile separatamente:
https://architettoemanuelli-cpu.github.io/metro-milano/londra/
Rete da un dataset aperto (nicola/tubemaps) aggiornato a mano con Elizabeth line, estensione Northern a Battersea, Heathrow T5 e rami DLR recenti.

## Verbale di cantiere
Nella cartella `verbale/` c'è l'app per i verbali di sopralluogo CSE, installabile separatamente:
https://architettoemanuelli-cpu.github.io/metro-milano/verbale/

- Archivio dei cantieri: committente, commessa, incarico, luogo e soggetti (Amministrazione, DL, Impresa, Sub appaltatori, Collaudatore…) con email e flag **T** di trasmissione
- Nuovo verbale: dettatura degli appunti, riconoscimento del cantiere, "Distribuisci nei campi" (presenze, lavorazioni, prescrizioni, meteo, prossima riunione), foto con didascalia, colonne **P**/**T**
- I campi obbligatori ancora vuoti sono evidenziati in giallo nell'app e nel documento
- Esporta in Word (.docx) e PDF con la struttura del verbale di sopralluogo dello studio
- Invio ai destinatari del cantiere: condivisione del file con le app email, oppure email già indirizzata
- Dati solo sul dispositivo (IndexedDB), con backup e ripristino da Impostazioni; funziona offline

Librerie incluse in `verbale/vendor/`: docx 9.1.1 e jsPDF 2.5.2 (licenza MIT).

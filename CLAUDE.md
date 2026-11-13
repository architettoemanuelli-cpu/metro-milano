# CLAUDE.md

Raccolta di piccole **web app installabili (PWA)** indipendenti, in HTML/CSS/JS statici, pubblicate insieme su GitHub Pages:
https://architettoemanuelli-cpu.github.io/metro-milano/. Niente framework, niente bundler, niente package.json, niente dipendenze da installare.

| Cartella | App | Note |
|---|---|---|
| `/` (radice) | Metro Milano – percorsi M1–M5 | Tutto dentro `index.html`; ricerca indirizzi con OSM Nominatim |
| `londra/` | Metro Londra (Tube, Elizabeth, DLR, Overground) | Stessa struttura di Milano, tutto in `index.html` |
| `verbale/` | Verbale di cantiere – verbali di sopralluogo CSE | `app.js` + `docgen.js` (Word/PDF), librerie in `vendor/` |
| `dove/` | Dove l'ho messo? – ritrovare le cose che si usano di rado | `app.js` |

Ogni app ha i suoi `index.html`, `manifest.webmanifest`, `sw.js` e `icons/`, e si installa separatamente sul telefono.

## Avvio e controlli

Non c'è una fase di build né una suite di test: quello che viene caricato su GitHub è quello che viene pubblicato.

```bash
# Server locale (service worker e geolocalizzazione richiedono http://localhost o https)
python3 -m http.server 8000      # poi apri http://localhost:8000/ , /londra/ , /verbale/ , /dove/

# Controllo della sintassi dei file JS separati
for f in sw.js */sw.js dove/app.js verbale/app.js verbale/docgen.js; do node --check "$f"; done

# Controllo della sintassi degli script dentro le pagine (Milano e Londra)
for f in index.html londra/index.html; do
  python3 -c "import re,sys;print('\n'.join(re.findall(r'<script>(.*?)</script>',open(sys.argv[1]).read(),re.S)))" "$f" > /tmp/inline.js \
    && node --check /tmp/inline.js && echo "ok $f"
done
```

Per le modifiche di comportamento, apri la pagina in Chromium headless (Playwright è già installato nelle sessioni cloud)
e controlla che la console non mostri errori, a larghezza telefono (~390px) e da computer, in tema chiaro e scuro.

## Pubblicazione

- `.github/workflows/pages.yml` pubblica l'intera radice del repository su GitHub Pages a ogni push su `main`.
- Flusso di lavoro: si lavora su un branch, si apre una PR, il proprietario la unisce e Pages ripubblica da solo.

## Regole per ogni modifica

1. **Aumenta `VERSION` nel `sw.js` di ogni app modificata** (es. `verbale-v4` → `verbale-v5`), altrimenti i telefoni su cui è installata tengono la vecchia copia. Mantieni il prefisso (`metro-mi-`, `metro-ldn-`, `verbale-`, `dove-`): all'attivazione le vecchie cache vengono cancellate in base al prefisso.
2. Se aggiungi un file che serve all'app offline, aggiungilo all'elenco `SHELL` nel `sw.js` di quell'app.
3. **Nuova app in una sottocartella:** dalle `sw.js`, manifest e icone propri e un prefisso di cache unico, **e** aggiungi la cartella all'esclusione nel `sw.js` della radice (`/^(londra|verbale|dove)(\/|$)/`), altrimenti il service worker di Metro Milano intercetta le sue richieste. Aggiungi anche una sezione con il link in `README.md`.
4. Aggiorna `README.md` quando cambiano le funzioni di un'app (il README è in italiano e scritto per chi usa le app, non per sviluppatori).
5. Nessuna CDN per il codice: le librerie vanno in `<app>/vendor/` con il loro file di licenza (vedi `verbale/vendor/`), così l'app funziona offline. Dall'esterno si caricano solo i Google Fonts (salvati in cache dal service worker).
6. I dati restano solo sul dispositivo: IndexedDB per `verbale/` e `dove/` (con backup e ripristino dalle impostazioni), `localStorage` solo per piccole comodità (cache degli indirizzi, banner di installazione chiuso). Niente server, account o statistiche.
7. Racchiudi gli accessi a `localStorage` in `try/catch`, come fa il codice esistente.

## Stile del codice

- **La lingua è l'italiano**: testi dell'interfaccia, README, commenti, nomi nel codice di dominio (`cantieri`, `verbali`, `oggetti`, `salva`, `oggi`…). Mantieni il tono semplice e cordiale dei testi esistenti; niente gergo tecnico nell'interfaccia.
- `verbale/` e `dove/` (con `app.js` separato): `"use strict"`, rientro di 2 spazi, virgolette doppie, punto e virgola, arrow function, template literal; piccole funzioni di aiuto `$`, `$$`, `esc` (fai sempre l'escape del testo dell'utente prima di inserirlo nell'HTML), `uid`. Separatori di sezione come `/* ------------------------------ archivio */`.
- `index.html` (Milano) e `londra/index.html`: file unico, stile compatto e denso su una riga dentro `<script>` e `<style>`. Mantieni quello stile quando li modifichi; non riformattare interi file.
- CSS: colori come variabili su `:root`, con il tema scuro sotto `@media (prefers-color-scheme: dark)` con `:root:not([data-theme="light"])` e sotto `:root[data-theme="dark"]`. Rispetta `env(safe-area-inset-*)` per la tacca dell'iPhone. I layout devono funzionare a larghezza telefono.
- Dispositivi: **prima iPhone/iPad con Safari** (tutti i browser su iOS usano WebKit), poi Android con Chrome e computer. Attenzione ai limiti di WebKit: per esempio la dettatura Web Speech su iOS non è affidabile, quindi `verbale/` ripiega sul microfono della tastiera.
- Icone: PNG per ogni app (192, 512, maskable 512, Apple touch 180). Per le nuove app usa nomi di file specifici (`verbale-192.png`, `dove-192.png`) così iOS non confonde le icone tra un'app e l'altra.

## Commit e PR

- Messaggi di commit e titoli/descrizioni delle PR **in italiano**, descrivendo la modifica dal punto di vista di chi usa l'app
  (es. "Verbale di cantiere: il pulsante microfono non resta più bloccato"), con un breve testo di spiegazione.
- Se la modifica riguarda una sola app, inizia il titolo con il nome dell'app.
- Non caricare file zip (`metro-milano-app.zip` è in `.gitignore`).

## Note sulle singole app

- **Metro Milano / Londra:** i tempi di viaggio sono stime dalla geometria della rete (≈33 km/h, 30 s per fermata, 2–3 min di attesa, 4 min per cambio, 4,8 km/h a piedi), non gli orari reali ATM/TfL. Nominatim: al massimo 1 richiesta al secondo, risultati salvati in `localStorage`, mai nella cache del service worker. I dati della rete (`LINES`, coordinate delle fermate `S`) sono mantenuti a mano nell'HTML; in Milano una coordinata mancante scrive `coord mancante` nella console.
- **Verbale di cantiere:** l'impaginazione Word/PDF in `docgen.js` riproduce il modello di verbale di sopralluogo CSE dello studio (pagina 1 intestazione + soggetti con colonne P/T, pagina 2 argomenti e conclusioni, pagina finale scheda di sopralluogo). L'intestazione predefinita è "ARCHITETTO EMANUELLI". I campi obbligatori (`req: true` in `CAMPI`) sono evidenziati in giallo nell'app e nel documento. Librerie: docx 9.1.1, jsPDF 2.5.2.
- **Dove l'ho messo?:** una sola frase viene divisa da sola in oggetto e posto; la ricerca trova anche parole parziali e plurali.

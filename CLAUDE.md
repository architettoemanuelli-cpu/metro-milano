# CLAUDE.md

A collection of small, independent **installable PWAs** (static HTML/CSS/JS), published together on GitHub Pages at
https://architettoemanuelli-cpu.github.io/metro-milano/. No framework, no bundler, no package.json, no dependencies to install.

| Folder | App | Notes |
|---|---|---|
| `/` (root) | Metro Milano – route planner M1–M5 | Everything inline in `index.html`; geocoding via OSM Nominatim |
| `londra/` | Metro Londra (Tube, Elizabeth, DLR, Overground) | Same structure as Milano, inline `index.html` |
| `verbale/` | Verbale di cantiere – CSE site-inspection reports | `app.js` + `docgen.js` (Word/PDF), libraries in `vendor/` |
| `dove/` | Dove l'ho messo? – where did I put rarely-used things | `app.js` |

Each app has its own `index.html`, `manifest.webmanifest`, `sw.js` and `icons/`, and is installed separately on the phone.

## Build / run / check

There is no build step and no test suite. What gets pushed is what gets served.

```bash
# Local server (service workers and geolocation need http://localhost or https)
python3 -m http.server 8000      # then open http://localhost:8000/ , /londra/ , /verbale/ , /dove/

# Syntax check of the separate JS files
for f in sw.js */sw.js dove/app.js verbale/app.js verbale/docgen.js; do node --check "$f"; done

# Syntax check of the inline scripts (Milano and Londra)
for f in index.html londra/index.html; do
  python3 -c "import re,sys;print('\n'.join(re.findall(r'<script>(.*?)</script>',open(sys.argv[1]).read(),re.S)))" "$f" > /tmp/inline.js \
    && node --check /tmp/inline.js && echo "ok $f"
done
```

For behaviour changes, open the page in headless Chromium (Playwright is pre-installed in cloud sessions) and check
the console for errors, at phone width (~390px) and desktop, in light and dark mode.

## Deploy

- `.github/workflows/pages.yml` publishes the whole repo root to GitHub Pages on every push to `main`.
- Workflow: work on a branch, open a PR, the owner merges it, Pages redeploys automatically.

## Rules to follow on every change

1. **Bump `VERSION` in the `sw.js` of every app you touched** (e.g. `verbale-v4` → `verbale-v5`), otherwise installed phones keep the old cached copy. Keep the prefix (`metro-mi-`, `metro-ldn-`, `verbale-`, `dove-`): the activate handler deletes old caches by prefix.
2. If you add a file an app needs offline, add it to the `SHELL` list in that app's `sw.js`.
3. **Adding a new app in a subfolder:** give it its own `sw.js`/manifest/icons and a unique cache prefix, **and** add the folder to the exclusion regex in the root `sw.js` (`/^(londra|verbale|dove)(\/|$)/`), otherwise the Metro Milano service worker intercepts its requests. Also add a section to `README.md` with the link.
4. Update `README.md` when an app's features change (the README is in Italian, written for the user, not for developers).
5. No CDNs for code: libraries go into `<app>/vendor/` with their licence file (see `verbale/vendor/`), so the app works offline. Only Google Fonts are loaded from outside (and cached by the service worker).
6. User data stays on the device only: IndexedDB for `verbale/` and `dove/` (with backup/restore from the settings), `localStorage` only for small conveniences (geocoding cache, dismissed install banner). No server, no accounts, no analytics.
7. Wrap `localStorage` access in `try/catch` as the existing code does.

## Code style

- **User-facing language is Italian**: UI text, README, comments, identifiers in domain code (`cantieri`, `verbali`, `oggetti`, `salva`, `oggi`…). Keep the plain, friendly tone of the existing texts; avoid technical jargon in the UI.
- `verbale/` and `dove/` (separate `app.js`): `"use strict"`, 2-space indentation, double quotes, semicolons, arrow functions, template literals; small helpers `$`, `$$`, `esc` (always escape user text before putting it into HTML), `uid`. Section separators like `/* ------------------------------ archivio */`.
- `index.html` (Milano) and `londra/index.html`: single file, compact/dense one-line style inside the inline `<script>` and `<style>`. Keep that style when editing them; don't reformat whole files.
- CSS: colours as custom properties on `:root`, with dark mode under `@media (prefers-color-scheme: dark)` with `:root:not([data-theme="light"])` and under `:root[data-theme="dark"]`. Respect `env(safe-area-inset-*)` for the iPhone notch. Layouts must work at phone width.
- Target devices: **iPhone/iPad Safari first** (all iOS browsers use WebKit), then Android Chrome and desktop. Beware of WebKit gaps: e.g. Web Speech dictation is unreliable on iOS, so `verbale/` falls back to the keyboard's own microphone.
- Icons: PNGs per app (192, 512, maskable 512, Apple touch 180). Use the app-specific file names (`verbale-192.png`, `dove-192.png`) for new apps so iOS doesn't confuse icons between apps.

## Commits and PRs

- Commit messages and PR titles/descriptions **in Italian**, describing the change from the user's point of view
  (e.g. "Verbale di cantiere: il pulsante microfono non resta più bloccato"), with a short explanatory body.
- Start the title with the app name when the change concerns a single app.
- Don't commit zip files (`metro-milano-app.zip` is in `.gitignore`).

## App-specific notes

- **Metro Milano / Londra:** travel times are estimates from the network geometry (≈33 km/h, 30 s per stop, 2–3 min wait, 4 min per change, 4.8 km/h walking), not real ATM/TfL timetables. Nominatim: max 1 request/second, results cached in `localStorage`, never cached by the service worker. Network data (`LINES`, station coordinates `S`) is hand-maintained in the HTML; in Milano a missing coordinate logs `coord mancante` in the console.
- **Verbale di cantiere:** the Word/PDF layout in `docgen.js` reproduces the studio's CSE site-inspection report template (page 1 header + parties with P/T columns, page 2 topics and conclusions, final inspection sheet). The default header is "ARCHITETTO EMANUELLI". Required fields (`req: true` in `CAMPI`) are highlighted in yellow in the app and in the document. Vendor libs: docx 9.1.1, jsPDF 2.5.2.
- **Dove l'ho messo?:** a single sentence is split automatically into object and place; search tolerates partial words and plurals.

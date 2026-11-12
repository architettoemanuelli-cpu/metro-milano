/* Verbale di cantiere — app. I dati (cantieri, verbali, foto, firma) restano sul dispositivo, in IndexedDB. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const DOC = window.VerbaleDoc;
const CAMPI = DOC.CAMPI;
const V = $("#view");

/* ---------------------------------------------------------------- archivio */
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("verbale-cantiere", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("cantieri", { keyPath: "id" }); d.createObjectStore("verbali", { keyPath: "id" }); d.createObjectStore("meta"); };
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const q = fn(t.objectStore(store));
      t.oncomplete = () => res(q ? q.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  all: s => idb.run(s, "readonly", o => o.getAll()),
  get: (s, k) => idb.run(s, "readonly", o => o.get(k)),
  put: (s, v, k) => idb.run(s, "readwrite", o => k === undefined ? o.put(v) : o.put(v, k)),
  del: (s, k) => idb.run(s, "readwrite", o => o.delete(k))
};

const DEF = {
  studio: "ARCHITETTO EMANUELLI", coordinatore: "", localita: "Milano",
  incarico: "Incarico sicurezza in esecuzione e progettazione",
  nb: "N.B.: se nessun commento o richiesta di variazione dovesse pervenire entro 3 gg. dal ricevimento del presente verbale, lo stesso sarà considerato come approvato dalle Parti",
  disposizioni: "- Il tesserino di riconoscimento va tenuto visibile;\n- Dpi e casco vanno sempre indossati;",
  documentazione: "APPALTATORE: verificare la presenza della documentazione obbligatoria: Copia notifica preliminare / Libro giornale dei lavori / Valutazione rischi rumore / Documenti relativi all'impianto elettrico di cantiere, denuncia messa a terra - scariche atmosferiche - conformità impianti elettrici / Tesserino di vaccinazione antitetanica degli addetti.\n\nSI RICORDA CHE, PUR NON NECESSARI IN CANTIERE, VANNO CONSERVATI I SEGUENTI DOCUMENTI: eventuali contratti subappalto / libro matricola operai / registro infortuni / nomine responsabili sicurezza / verbali di informazione per la sicurezza / nomina medico competente / certificati di idoneità fisica dei lavoratori / piano sanitario del medico competente.",
  chiusura: "Questo verbale va considerato parte del GdL",
  firma: null
};
const RUOLI = ["Amministrazione", "Direzione Lavori", "Impresa esecutrice", "Appaltatori", "Sub appaltatori", "Collaudatore"];
let S = { ...DEF }, cantieri = [], verbali = [];
const getC = id => cantieri.find(c => c.id === id);
const getV = id => verbali.find(v => v.id === id);
async function load() {
  S = { ...DEF, ...((await idb.get("meta", "settings")) || {}) };
  if (!String(S.studio || "").trim()) S.studio = DEF.studio;
  cantieri = await idb.all("cantieri"); verbali = await idb.all("verbali");
}
let persistAsked = false;
function persist() { if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); } }
const saveS = () => { persist(); return idb.put("meta", S, "settings"); };
const saveC = c => { persist(); c.modificato = Date.now(); return idb.put("cantieri", c); };
const saveV = v => { persist(); v.modificato = Date.now(); return idb.put("verbali", v); };
function debounce(fn, ms = 400) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ------------------------------------------------------------------- avvisi */
let toastT;
function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  t.hidden = false; t.classList.add("on");
  if (action) $("button", t).onclick = () => { hideToast(); action.fn(); };
  clearTimeout(toastT); toastT = setTimeout(hideToast, action ? 7000 : 3800);
}
function hideToast() { const t = $("#toast"); t.classList.remove("on"); setTimeout(() => { if (!t.classList.contains("on")) t.hidden = true; }, 250); }
function sheet(html) {
  const o = $("#sheet");
  o.innerHTML = `<div class="sheet-box" role="dialog" aria-modal="true">${html}</div>`;
  o.hidden = false;
  o.onclick = e => { if (e.target === o || e.target.closest("[data-close]")) closeSheet(); };
  return $(".sheet-box", o);
}
function closeSheet() { const o = $("#sheet"); o.hidden = true; o.innerHTML = ""; }

/* -------------------------------------------------------------- dettatura */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function punteggiatura(s) {
  return s.replace(/\s*\bpunto e virgola\b/gi, ";").replace(/\s*\bdue punti\b/gi, ":").replace(/\s*\bvirgola\b/gi, ",")
    .replace(/\s*\bpunto\b/gi, ".").replace(/\s*\ba capo\b\s*/gi, "\n");
}
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let recBtn = null, recTimer = null;
function resetMic() {
  clearTimeout(recTimer); recTimer = null;
  if (recBtn) { recBtn.classList.remove("on"); recBtn.setAttribute("aria-pressed", "false"); }
  recBtn = null; rec = null;
}
function tastiera(target) {
  target.focus();
  try { const n = target.value.length; target.setSelectionRange(n, n); } catch {}
  toast("Tocca il microfono della tastiera per dettare.");
}
function mic(btn, target) {
  // secondo tocco: ferma subito, senza aspettare il browser
  if (rec) { const r = rec; resetMic(); try { r.abort(); } catch {} return; }
  // su iPhone e iPad la dettatura del browser non è affidabile: si usa quella della tastiera
  if (!SR || IOS) { tastiera(target); return; }
  const r = new SR(); rec = r; recBtn = btn;
  r.lang = "it-IT"; r.continuous = true; r.interimResults = true;
  const base = target.value ? target.value.replace(/\s*$/, target.value.endsWith("\n") ? "" : " ") : "";
  let fin = "", partito = false;
  const put = txt => { target.value = txt; target.dispatchEvent(new Event("input", { bubbles: true })); };
  const avviato = () => { partito = true; clearTimeout(recTimer); };
  r.onstart = r.onaudiostart = avviato;
  r.onresult = e => {
    if (rec !== r) return;
    avviato();
    let tmp = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const x = e.results[i];
      if (x.isFinal) fin += punteggiatura(x[0].transcript.trim()) + " "; else tmp += x[0].transcript;
    }
    put(base + fin + tmp);
  };
  r.onerror = e => {
    if (rec !== r) return;
    resetMic();
    if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Consenti l'uso del microfono per dettare, oppure usa il microfono della tastiera.");
    else if (e.error !== "aborted" && e.error !== "no-speech") tastiera(target);
  };
  r.onend = () => { if (rec !== r) return; resetMic(); put((base + fin).replace(/ +$/, "")); };
  btn.classList.add("on"); btn.setAttribute("aria-pressed", "true");
  // se il browser non risponde entro 4 secondi, la dettatura si ferma e si usa la tastiera
  recTimer = setTimeout(() => { if (rec === r && !partito) { resetMic(); try { r.abort(); } catch {} tastiera(target); } }, 4000);
  try { r.start(); } catch { resetMic(); tastiera(target); }
}
function stopMic() { if (rec) { const r = rec; resetMic(); try { r.abort(); } catch {} } }
const MIC = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2Z"/></svg>`;

/* --------------------------------------- appunti dettati → campi del verbale */
const NUMERI = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20 };
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const GENERICHE = new Set("via viale piazza piazzale corso largo condominio milano comune srl spa s.r.l s.p.a sede legale studio impresa arch ing geom dott con della delle dello degli del per lavori cantiere manutenzione straordinaria ristrutturazione parti comuni".split(" "));
const parole = s => norm(s).split(/[^a-z0-9]+/).filter(w => (w.length >= 4 || /^\d+$/.test(w)) && !GENERICHE.has(w));
function punteggioCantiere(c, txt) {
  const n = " " + norm(txt).replace(/[^a-z0-9]+/g, " ") + " ";
  const ws = new Set([...parole(c.nome), ...parole(c.luogo), ...parole(c.alias), ...parole(c.committente)]);
  let p = 0; ws.forEach(w => { if (n.includes(" " + w + " ")) p += /^\d+$/.test(w) ? 0.5 : 1; });
  return p;
}
function riconosciCantiere(txt) {
  let best = null, bp = 0;
  for (const c of cantieri) { const p = punteggioCantiere(c, txt); if (p > bp) { bp = p; best = c; } }
  return bp >= 1 ? best : null;
}
const REGOLE = [
  ["prossima", /\b(prossim[aoie]\s+(riunione|sopralluogo|incontro|visita)|riunione operativa|ci vediamo|ci rivediamo)\b/],
  ["meteo", /\b(meteo|soleggiat\w*|sole|sereno|nuvolos\w*|nuvol\w*|coperto|pioggia|piove\w*|piovos\w*|neve|nebbia|vento\w*|ventos\w*|gradi|temperatura)\b|°/],
  ["interventi", /\b(richiam\w*|sospension\w*|sospes\w*|allontana\w*|sanzion\w*|ammoni\w*|diffid\w*)\b/],
  ["prescrizioni", /\b(prescri\w*|obblig\w*|chiuder\w*|sistemar\w*|ripristinar\w*|rimuover\w*|integrar\w*|fissar\w*|delimitar\w*|segnalar\w*|vietat\w*|si dispone|devono|deve|occorre|bisogna|necessari\w*|provvedere|mettere in sicurezza)\b/],
  ["andamento", /\b(operai|operaio|addett\w*|lavorator\w*|presenti|presente|presenza|persone|squadr\w*)\b/],
  ["fasi", /\b(montaggio|smontaggio|posa|getto|getti|scav\w*|demolizion\w*|rasatur\w*|lattoner\w*|ponteggi\w*|intonac\w*|cappotto|impermeabilizz\w*|pavimentazion\w*|piastrell\w*|facciat\w*|copertur\w*|tinteggiatur\w*|assistenz\w*|lavorazion\w*|in corso|si procede|stanno|sta eseguendo|esecuzione|installazion\w*|carpenteri\w*|armatur\w*|massett\w*|serrament\w*|profil\w*|bonifica|sgombero|pulizia)\b/]
];
const PREFISSI = /^(prescrizion[ei]|meteo|condizioni meteo(rologiche)?|nota|note|osservazion[ei]|fasi|lavorazion[ei]|presenze|presenti|interventi|tempistica|prossima riunione( operativa)?)\s*[:,-]\s*/i;
function maiuscola(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function frasi(t) {
  return t.replace(/(\d)[.,:](\d)/g, "$1․$2").split(/[.;!?\n]+/).map(x => x.replace(/․/g, ".").trim()).filter(Boolean);
}
function distribuisci(testo, v) {
  const esito = { campi: new Set(), cantiere: null };
  if (!v.cantiereId) { const c = riconosciCantiere(testo); if (c) { applicaCantiere(v, c); esito.cantiere = c; } }
  const c = getC(v.cantiereId);
  const sogg = c ? c.soggetti || [] : [];
  const add = (k, line) => {
    const cur = (v.campi[k] || "").replace(/\s+$/, "");
    if (k === "prescrizioni") { const n = (cur.match(/^\d+\)/gm) || []).length; line = `${n + 1}) ${line}`; }
    if (k === "fasi") line = `- ${line}`;
    v.campi[k] = cur ? cur + "\n" + line : line; esito.campi.add(k);
  };
  for (let f of frasi(testo)) {
    // toglie una prima parte che nomina solo il cantiere ("Via Monte Rosa, tre operai…")
    const parti = f.split(/,\s*/);
    if (c && parti.length > 1 && punteggioCantiere(c, parti[0]) > 0 && !REGOLE.some(([, re]) => re.test(norm(parti[0])))) f = parti.slice(1).join(", ");
    f = f.replace(PREFISSI, "").trim();
    if (!f) continue;
    f = f.replace(/\b(un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti)\s+(operai|operaio|addetti|lavoratori|persone)\b/gi, (m, a, b) => `${NUMERI[a.toLowerCase()]} ${b}`)
      .replace(/(^|[^\w.])(?:n\.\s*)?(\d+)\s+(operai|operaio|addetti|lavoratori|persone)\b/gi, "$1N. $2 $3");
    const n = norm(f);
    const regola = REGOLE.find(([, re]) => re.test(n));
    if (!regola && c && punteggioCantiere(c, f) > 0 && f.split(/\s+/).length <= 6) continue;
    const k = regola ? regola[0] : "osservazioni";
    if (k === "prossima") f = f.replace(/^(la\s+)?prossim[aoie]\s+(riunione|sopralluogo|incontro|visita)(\s+operativ[aoie])?(\s+(sarà|è|si terrà|fissata|prevista))?\s*(per|il|:)?\s*/i, "");
    if (k === "meteo") f = f.replace(/^(meteo|condizioni meteo\w*|tempo)\s*:?\s*/i, "");
    if (!f) continue;
    if (k === "prossima" || k === "meteo") { const cur = (v.campi[k] || "").trim(); v.campi[k] = cur ? cur + "; " + f : maiuscola(f); esito.campi.add(k); }
    else add(k, maiuscola(f) + (/[.:;]$/.test(f) ? "" : k === "prescrizioni" ? ";" : "."));
    if (k === "andamento") {
      let trovato = false;
      for (const s of sogg) { const ws = parole(`${s.societa || ""} ${s.nome || ""}`); if (ws.some(w => (" " + n.replace(/[^a-z0-9]+/g, " ") + " ").includes(" " + w + " "))) { v.p[s.id] = true; trovato = true; } }
      if (!trovato && /operai|addett|lavorator/.test(n)) { const imp = DOC.impresa(c); if (imp) v.p[imp.id] = true; }
    }
  }
  return esito;
}

/* ----------------------------------------------------------- verbali: dati */
function numeroSuggerito(c) {
  let max = 0;
  verbali.filter(v => v.cantiereId === c.id).forEach(v => (String(v.numero).match(/\d+/g) || []).forEach(n => { max = Math.max(max, +n); }));
  return String(Math.max(+c.prossimoNumero || 1, max + 1));
}
function applicaCantiere(v, c) {
  v.cantiereId = c.id; v.numero = numeroSuggerito(c);
  v.t = {}; (c.soggetti || []).forEach(s => { v.t[s.id] = !!s.t; });
  v.p = {};
}
function daCompletare(v) { return CAMPI.filter(f => f.req && !String(v.campi[f.k] || "").trim()); }
async function nuovoVerbale() {
  const c = cantieri.length === 1 ? cantieri[0] : null;
  const v = { id: uid(), cantiereId: "", numero: "", data: oggi(), dataFine: "", appunti: "", storico: "", campi: { disposizioni: S.disposizioni }, p: {}, t: {}, foto: [], stato: "bozza", creato: Date.now() };
  if (c) applicaCantiere(v, c);
  verbali.push(v); await saveV(v);
  location.hash = "verbale-" + v.id;
}

/* ------------------------------------------------------------------ viste */
function route() {
  stopMic(); closeSheet();
  const h = decodeURIComponent(location.hash.slice(1)) || "verbali";
  const i = h.indexOf("-"); const view = i < 0 ? h : h.slice(0, i); const id = i < 0 ? "" : h.slice(i + 1);
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.v === (view === "verbale" ? "verbali" : view === "cantiere" ? "cantieri" : view)));
  window.scrollTo(0, 0);
  if (view === "verbale" && getV(id)) return viewVerbale(getV(id));
  if (view === "cantiere" && getC(id)) return viewCantiere(getC(id));
  if (view === "cantieri") return viewCantieri();
  if (view === "impostazioni") return viewImpostazioni();
  return viewVerbali();
}

function vuoto(titolo, testo, bottoni) { return `<div class="empty"><h3>${titolo}</h3><p>${testo}</p><div class="row">${bottoni}</div></div>`; }

function viewVerbali() {
  const list = [...verbali].sort((a, b) => (b.data || "").localeCompare(a.data || "") || b.creato - a.creato);
  V.innerHTML = `
    <div class="head"><h2>Verbali</h2>${cantieri.length ? `<button class="btn primary" id="nuovo" type="button">Nuovo verbale</button>` : ""}</div>
    ${!S.studio ? `<a class="callout" href="#impostazioni"><b>Prima volta?</b> Inserisci nome dello studio e firma nelle Impostazioni: compariranno su ogni verbale.</a>` : ""}
    ${list.length ? `<ul class="list">${list.map(v => {
      const c = getC(v.cantiereId), todo = daCompletare(v).length;
      const st = v.stato === "inviato" ? `<span class="pill ok">Inviato</span>` : todo ? `<span class="pill hl">${todo} da completare</span>` : `<span class="pill">Bozza pronta</span>`;
      return `<li><a class="item" href="#verbale-${v.id}"><div class="item-main"><b>${c ? esc(c.nome) : "Cantiere da scegliere"}</b><span>Verbale n. ${esc(v.numero || "—")} · ${esc(DOC.periodo(v))}</span></div>${st}</a></li>`;
    }).join("")}</ul>`
      : cantieri.length ? vuoto("Nessun verbale", "Tocca <b>Nuovo verbale</b> durante il sopralluogo: detti gli appunti, scatti le foto e il verbale si compone nel modello del cantiere.", "")
        : vuoto("Inizia da un cantiere", "Per ogni cantiere salvi committente, commessa e i soggetti a cui trasmettere il verbale. Poi ogni verbale li ritrova già compilati.",
          `<a class="btn primary" href="#cantieri" id="go-c">Aggiungi un cantiere</a><button class="btn" type="button" id="esempio">Prova con un esempio</button>`)}`;
  $("#nuovo") && ($("#nuovo").onclick = nuovoVerbale);
  $("#esempio") && ($("#esempio").onclick = esempio);
  $("#go-c") && ($("#go-c").onclick = e => { e.preventDefault(); nuovoCantiere(); });
}

function viewVerbale(v) {
  const c = getC(v.cantiereId);
  const todo = daCompletare(v);
  V.innerHTML = `
    <div class="head"><a class="back" href="#verbali">‹ Verbali</a>${v.stato === "inviato" ? `<span class="pill ok">Inviato</span>` : `<span class="pill">Bozza</span>`}</div>
    <h2 class="title">Verbale n. <span id="vnum">${esc(v.numero || "—")}</span></h2>
    <button class="todo-bar" id="todoBar" type="button" ${todo.length ? "" : "hidden"}><i></i><span>${todo.length} campi da completare</span></button>

    <section class="card">
      <h3>Cantiere</h3>
      <div class="grid2">
        <label class="fld wide"><span>Cantiere</span><select id="f-cant"><option value="">Scegli il cantiere…</option>${cantieri.map(x => `<option value="${x.id}" ${x.id === v.cantiereId ? "selected" : ""}>${esc(x.nome)}${x.commessaNum ? ` · Comm. ${esc(x.commessaNum)}` : ""}</option>`).join("")}</select></label>
        <label class="fld"><span>Verbale n.</span><input id="f-num" value="${esc(v.numero)}" inputmode="text" autocomplete="off"></label>
        <label class="fld"><span>Data</span><input id="f-data" type="date" value="${esc(v.data)}"></label>
        <label class="fld"><span>Fino al <small>(più giorni)</small></span><input id="f-fine" type="date" value="${esc(v.dataFine)}"></label>
      </div>
      ${c ? `<p class="meta">${esc(c.committente)}${c.commessaNum ? ` · Commessa ${esc(c.commessaNum)}` : ""}</p>` : `<p class="meta">Se non lo scegli, l'app lo riconosce dagli appunti dettati.</p>`}
    </section>

    <section class="card">
      <h3>Appunti del sopralluogo</h3>
      <p class="meta">Detta o scrivi quello che vedi, poi tocca <b>Distribuisci nei campi</b>: presenze, lavorazioni, prescrizioni, meteo e prossima riunione vanno al loro posto.</p>
      <textarea id="f-appunti" rows="4" placeholder="Es.: Via Monte Rosa, tre operai presenti. Montaggio del ponteggio esterno. Chiudere le botole del ponteggio non in uso. Meteo sereno, 12 gradi. Prossima riunione martedì 17 alle 10.30.">${esc(v.appunti)}</textarea>
      <div class="row"><button class="btn mic" type="button" data-mic="f-appunti" aria-pressed="false">${MIC}<span>Detta</span></button><button class="btn primary" type="button" id="distr">Distribuisci nei campi</button></div>
    </section>

    <section class="card">
      <h3>Foto <small id="nfoto">${v.foto.length || ""}</small></h3>
      <div class="photos" id="photos"></div>
      <div class="row">
        <label class="btn"><input class="vh" type="file" accept="image/*" capture="environment" id="in-cam">Scatta foto</label>
        <label class="btn"><input class="vh" type="file" accept="image/*" multiple id="in-gal">Dalla galleria</label>
      </div>
    </section>

    <section class="card">
      <h3>Presenti e destinatari</h3>
      ${c && (c.soggetti || []).length ? `
      <div class="pt-head"><span></span><span title="Presenti">P</span><span title="Trasmissione">T</span></div>
      <ul class="pt">${c.soggetti.map(s => `<li>
        <div class="pt-who"><b>${esc(s.ruolo)}</b><span>${esc(s.nome || (s.societa || "").split("\n")[0] || "")}</span><small>${esc(DOC.emails(s).join(", ") || "nessuna email")}</small></div>
        <label class="ck"><input type="checkbox" data-p="${s.id}" ${v.p[s.id] ? "checked" : ""} aria-label="Presente: ${esc(s.ruolo)}"><i></i></label>
        <label class="ck"><input type="checkbox" data-t="${s.id}" ${v.t[s.id] ? "checked" : ""} ${DOC.emails(s).length ? "" : "disabled"} aria-label="Trasmissione: ${esc(s.ruolo)}"><i></i></label>
      </li>`).join("")}</ul>
      <p class="meta"><b>P</b> = presenti al sopralluogo · <b>T</b> = ricevono il verbale per email. <a href="#cantiere-${c.id}">Modifica i soggetti del cantiere</a></p>`
      : c ? `<p class="meta">Questo cantiere non ha ancora soggetti. <a href="#cantiere-${c.id}">Aggiungili</a>.</p>` : `<p class="meta">Scegli il cantiere per vedere i soggetti.</p>`}
    </section>

    <section class="card">
      <h3>Contenuto del verbale</h3>
      ${CAMPI.map(f => {
        const val = v.campi[f.k] || "";
        return `<div class="fld-big ${f.req && !val.trim() ? "todo" : ""}" data-k="${f.k}" id="box-${f.k}">
          <div class="lab"><label for="c-${f.k}">${f.t}${f.req ? "" : ` <small>facoltativo</small>`}</label><button class="icon mic" type="button" data-mic="c-${f.k}" aria-pressed="false" aria-label="Detta: ${f.t}">${MIC}</button></div>
          ${f.hint ? `<div class="hint">${f.hint}</div>` : ""}
          <textarea id="c-${f.k}" data-k="${f.k}" rows="${f.rows || 3}">${esc(val)}</textarea></div>`;
      }).join("")}
      ${v.storico ? `<details class="storico"><summary>Appunti originali</summary><pre>${esc(v.storico)}</pre></details>` : ""}
    </section>

    <div class="danger"><button class="link" type="button" id="del">Elimina verbale</button></div>
    <div class="actionbar"><div class="actionbar-in">
      <button class="btn" type="button" id="x-docx">Word</button>
      <button class="btn" type="button" id="x-pdf">Esporta PDF</button>
      <button class="btn primary" type="button" id="x-send">Invia</button>
    </div></div>`;

  const save = debounce(() => saveV(v));
  const aggiornaTodo = () => {
    const t = daCompletare(v); const b = $("#todoBar");
    b.hidden = !t.length; $("span", b).textContent = t.length === 1 ? "1 campo da completare" : `${t.length} campi da completare`;
  };
  $("#todoBar").onclick = () => { const f = daCompletare(v)[0]; if (f) { const el = $("#c-" + f.k); el.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => el.focus({ preventScroll: true }), 350); } };
  $("#f-cant").onchange = async e => {
    const nc = getC(e.target.value);
    if (nc) applicaCantiere(v, nc); else { v.cantiereId = ""; v.t = {}; v.p = {}; }
    await saveV(v); viewVerbale(v);
  };
  $("#f-num").oninput = e => { v.numero = e.target.value.trim(); $("#vnum").textContent = v.numero || "—"; save(); };
  $("#f-data").onchange = e => { v.data = e.target.value || oggi(); save(); };
  $("#f-fine").onchange = e => { v.dataFine = e.target.value; save(); };
  $("#f-appunti").oninput = e => { v.appunti = e.target.value; save(); };
  $$("textarea[data-k]").forEach(t => t.oninput = () => {
    const k = t.dataset.k; v.campi[k] = t.value;
    const f = CAMPI.find(x => x.k === k); $("#box-" + k).classList.toggle("todo", !!f.req && !t.value.trim());
    aggiornaTodo(); save();
  });
  $$("[data-mic]").forEach(b => b.onclick = () => mic(b, $("#" + b.dataset.mic)));
  $$("[data-p]").forEach(i => i.onchange = () => { v.p[i.dataset.p] = i.checked; save(); });
  $$("[data-t]").forEach(i => i.onchange = () => { v.t[i.dataset.t] = i.checked; save(); });
  $("#distr").onclick = async () => {
    stopMic();
    const txt = (v.appunti || "").trim();
    if (!txt) { toast("Detta o scrivi prima qualche appunto."); $("#f-appunti").focus(); return; }
    const prima = JSON.stringify({ campi: v.campi, p: v.p, t: v.t, cantiereId: v.cantiereId, numero: v.numero, storico: v.storico });
    const r = distribuisci(txt, v);
    v.storico = (v.storico ? v.storico + "\n\n" : "") + txt; v.appunti = "";
    await saveV(v); viewVerbale(v);
    const n = r.campi.size;
    toast(`${r.cantiere ? `Cantiere riconosciuto: ${r.cantiere.nome}. ` : ""}Appunti distribuiti in ${n} ${n === 1 ? "campo" : "campi"}.`, {
      label: "Annulla", fn: async () => { Object.assign(v, JSON.parse(prima)); v.appunti = txt; await saveV(v); viewVerbale(v); }
    });
  };
  // foto
  const urls = [];
  const renderFoto = () => {
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    $("#nfoto").textContent = v.foto.length || "";
    $("#photos").innerHTML = v.foto.map((f, i) => { const u = URL.createObjectURL(f.blob); urls.push(u); return `<figure><img src="${u}" alt="Foto ${i + 1}"><input value="${esc(f.did)}" data-did="${f.id}" placeholder="Didascalia" aria-label="Didascalia foto ${i + 1}"><button type="button" class="x" data-rm="${f.id}" aria-label="Elimina foto ${i + 1}">×</button></figure>`; }).join("");
    $$("[data-did]").forEach(i => i.oninput = () => { v.foto.find(f => f.id === i.dataset.did).did = i.value; save(); });
    $$("[data-rm]").forEach(b => b.onclick = async () => {
      const idx = v.foto.findIndex(f => f.id === b.dataset.rm); const [tolta] = v.foto.splice(idx, 1);
      await saveV(v); renderFoto();
      toast("Foto eliminata.", { label: "Annulla", fn: async () => { v.foto.splice(idx, 0, tolta); await saveV(v); renderFoto(); } });
    });
  };
  renderFoto();
  const aggiungi = async e => {
    const files = [...e.target.files]; e.target.value = "";
    for (const file of files) { try { v.foto.push({ id: uid(), did: "", ...(await riduci(file, 1600, 0.82)) }); } catch { toast("Non riesco a leggere una delle foto."); } }
    await saveV(v); renderFoto();
  };
  $("#in-cam").onchange = aggiungi; $("#in-gal").onchange = aggiungi;
  // export
  $("#x-docx").onclick = e => esporta(v, "docx", e.currentTarget);
  $("#x-pdf").onclick = e => esporta(v, "pdf", e.currentTarget);
  $("#x-send").onclick = () => invia(v);
  conferma($("#del"), "Tocca ancora per eliminare", async () => {
    verbali = verbali.filter(x => x.id !== v.id); await idb.del("verbali", v.id);
    location.hash = "verbali"; toast("Verbale eliminato.");
  });
}

/* bottone a due tocchi al posto di confirm() */
function conferma(btn, testo, fn) {
  const orig = btn.textContent; let armato = false, t;
  btn.onclick = () => {
    if (armato) { clearTimeout(t); fn(); return; }
    armato = true; btn.textContent = testo; btn.classList.add("armed");
    t = setTimeout(() => { armato = false; btn.textContent = orig; btn.classList.remove("armed"); }, 3500);
  };
}

async function riduci(file, max, q, png = false) {
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const k = Math.min(1, max / Math.max(w, h)); const cw = Math.round(w * k), ch = Math.round(h * k);
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const g = cv.getContext("2d");
  if (!png) { g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch); }
  g.drawImage(src, 0, 0, cw, ch);
  const blob = await new Promise(res => cv.toBlob(res, png ? "image/png" : "image/jpeg", q));
  return { blob, w: cw, h: ch };
}

/* ---------------------------------------------------------- esporta / invia */
async function creaFile(v, fmt) {
  const c = getC(v.cantiereId);
  if (!c) throw new Error("cantiere");
  const blob = fmt === "pdf" ? await DOC.pdf(v, c, S) : await DOC.docx(v, c, S);
  const type = fmt === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return new File([blob], DOC.fileName(v, c, fmt), { type });
}
function scarica(file) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
async function esporta(v, fmt, btn) {
  if (!getC(v.cantiereId)) { toast("Scegli prima il cantiere."); $("#f-cant").focus(); return; }
  const orig = btn.textContent; btn.disabled = true; btn.textContent = "Preparo…";
  try {
    const f = await creaFile(v, fmt); scarica(f);
    const n = daCompletare(v).length;
    toast(n ? `File salvato. ${n} ${n === 1 ? "campo è evidenziato" : "campi sono evidenziati"} in giallo.` : "File salvato.");
  } catch (e) { console.error(e); toast("Non sono riuscito a creare il file. Riprova."); }
  finally { btn.disabled = false; btn.textContent = orig; }
}
function testoEmail(v, c) {
  const comm = [c.commessaNum ? `Commessa n. ${c.commessaNum}` : "", c.committente].filter(Boolean).join(" – ");
  return {
    oggetto: `Verbale di sopralluogo in cantiere n. ${v.numero} del ${DOC.periodo(v)} – ${c.nome}`,
    corpo: `Buongiorno,\nin allegato il verbale di sopralluogo in cantiere n. ${v.numero} del ${DOC.periodo(v)}${comm ? `\n${comm}` : ""}.\n\n${S.nb.replace(/^N\.B\.:\s*/i, "")}.\n\nCordiali saluti\n${S.coordinatore || S.studio || ""}`.trim()
  };
}
async function copia(testo) {
  try { await navigator.clipboard.writeText(testo); return true; } catch { return false; }
}
function invia(v) {
  const c = getC(v.cantiereId);
  if (!c) { toast("Scegli prima il cantiere."); $("#f-cant").focus(); return; }
  const tutti = (c.soggetti || []).filter(s => DOC.emails(s).length);
  const puoCondividere = !!(navigator.canShare && navigator.share);
  const n = daCompletare(v).length;
  const box = sheet(`
    <div class="sheet-head"><h3>Invia il verbale</h3><button class="icon" type="button" data-close aria-label="Chiudi">×</button></div>
    ${n ? `<p class="warn"><i></i>${n} ${n === 1 ? "campo è ancora da completare" : "campi sono ancora da completare"}: nel file ${n === 1 ? "è evidenziato" : "sono evidenziati"} in giallo.</p>` : ""}
    <div class="seg" role="radiogroup" aria-label="Formato">
      <label><input type="radio" name="fmt" value="pdf" checked><span>PDF</span></label>
      <label><input type="radio" name="fmt" value="docx"><span>Word</span></label>
    </div>
    <p class="meta">Destinatari del cantiere (colonna T)</p>
    ${tutti.length ? `<ul class="rcpt">${tutti.map(s => `<li><label><input type="checkbox" data-r="${s.id}" ${v.t[s.id] ? "checked" : ""}><span><b>${esc(s.ruolo)}</b> ${esc(s.nome || (s.societa || "").split("\n")[0])}<small>${esc(DOC.emails(s).join(", "))}</small></span></label></li>`).join("")}</ul>`
      : `<p class="meta">Nessun soggetto con email. <a href="#cantiere-${c.id}">Aggiungi le email nel cantiere</a>.</p>`}
    <p class="meta" id="stato">Preparo il file…</p>
    <div class="stack">
      ${puoCondividere ? `<button class="btn primary" type="button" id="s-share" disabled>Condividi il file</button>` : ""}
      <button class="btn ${puoCondividere ? "" : "primary"}" type="button" id="s-mail">Scrivi email ai destinatari</button>
      <div class="row"><button class="btn" type="button" id="s-copy">Copia indirizzi</button><button class="btn" type="button" id="s-dl" disabled>Salva il file</button></div>
    </div>
    <p class="meta small">${puoCondividere ? "<b>Condividi</b> apre l'app email con il file già allegato e copia gli indirizzi: incollali nel campo A. " : ""}<b>Scrivi email</b> apre un messaggio con destinatari, oggetto e testo: allega il file salvato.</p>`);
  let file = null, fmt = "pdf";
  const dest = () => $$("[data-r]", box).filter(i => i.checked).flatMap(i => DOC.emails(c.soggetti.find(s => s.id === i.dataset.r)));
  const prepara = async () => {
    file = null; $("#stato", box).textContent = "Preparo il file…";
    $$("#s-share,#s-dl", box).forEach(b => b.disabled = true);
    try {
      const f = await creaFile(v, fmt); if (fmt !== cur()) return;
      file = f; $("#stato", box).textContent = `Pronto: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`;
      $$("#s-share,#s-dl", box).forEach(b => b.disabled = false);
    } catch (e) { console.error(e); $("#stato", box).textContent = "Non sono riuscito a creare il file."; }
  };
  const cur = () => $("[name=fmt]:checked", box).value;
  $$("[name=fmt]", box).forEach(r => r.onchange = () => { fmt = cur(); prepara(); });
  $$("[data-r]", box).forEach(i => i.onchange = () => { v.t[i.dataset.r] = i.checked; saveV(v); });
  const segna = async () => { v.stato = "inviato"; v.inviato = Date.now(); await saveV(v); };
  const { oggetto, corpo } = testoEmail(v, c);
  $("#s-copy", box).onclick = async () => { const d = dest(); if (!d.length) return toast("Nessun destinatario selezionato."); toast(await copia(d.join(", ")) ? `${d.length} indirizzi copiati.` : d.join(", ")); };
  $("#s-dl", box).onclick = () => { if (file) { scarica(file); toast("File salvato."); } };
  $("#s-mail", box).onclick = async () => {
    const d = dest(); if (!d.length) return toast("Seleziona almeno un destinatario.");
    if (file) scarica(file);
    await segna();
    location.href = `mailto:${d.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(corpo)}`;
  };
  const sh = $("#s-share", box);
  if (sh) sh.onclick = () => {
    if (!file) return;
    const d = dest();
    if (d.length && navigator.clipboard) navigator.clipboard.writeText(d.join(", ")).catch(() => {});
    const data = { files: [file], title: oggetto, text: corpo };
    if (!navigator.canShare(data)) { scarica(file); toast("Questo dispositivo non condivide file: l'ho salvato."); return; }
    navigator.share(data).then(async () => { await segna(); closeSheet(); viewVerbale(v); toast(d.length ? "Verbale condiviso. Gli indirizzi erano copiati negli appunti." : "Verbale condiviso."); })
      .catch(e => { if (e.name !== "AbortError") toast("Condivisione non riuscita."); });
  };
  prepara();
}

/* --------------------------------------------------------------- cantieri */
function viewCantieri() {
  const list = [...cantieri].sort((a, b) => a.nome.localeCompare(b.nome, "it"));
  V.innerHTML = `
    <div class="head"><h2>Cantieri</h2><button class="btn primary" id="nuovoC" type="button">Nuovo cantiere</button></div>
    ${list.length ? `<ul class="list">${list.map(c => {
      const nv = verbali.filter(v => v.cantiereId === c.id).length, nt = (c.soggetti || []).filter(s => s.t && DOC.emails(s).length).length;
      return `<li><a class="item" href="#cantiere-${c.id}"><div class="item-main"><b>${esc(c.nome)}</b><span>${esc(c.committente || "Committente da inserire")}${c.commessaNum ? ` · Comm. ${esc(c.commessaNum)}` : ""}</span></div><span class="pill">${nt} destinatari · ${nv} verbali</span></a></li>`;
    }).join("")}</ul>`
      : vuoto("Nessun cantiere", "Aggiungi il primo: committente, commessa e soggetti con le email a cui trasmettere i verbali.", `<button class="btn" type="button" id="esempio">Prova con un esempio</button>`)}`;
  $("#nuovoC").onclick = nuovoCantiere;
  $("#esempio") && ($("#esempio").onclick = esempio);
}
async function nuovoCantiere() {
  const c = { id: uid(), nome: "Nuovo cantiere", alias: "", committente: "", commessaNum: "", commessaDesc: "", incarico: S.incarico, localita: S.localita, luogo: "", prossimoNumero: 1,
    soggetti: RUOLI.map(r => ({ id: uid(), ruolo: r, nome: "", societa: "", contatti: "", email: "", t: true, note: "" })), creato: Date.now() };
  cantieri.push(c); await saveC(c); location.hash = "cantiere-" + c.id;
}
function viewCantiere(c) {
  const nv = verbali.filter(v => v.cantiereId === c.id).length;
  const F = (k, label, o = {}) => `<label class="fld ${o.wide ? "wide" : ""}"><span>${label}</span>${o.area ? `<textarea data-f="${k}" rows="${o.rows || 2}" placeholder="${esc(o.ph || "")}">${esc(c[k])}</textarea>` : `<input data-f="${k}" value="${esc(c[k])}" placeholder="${esc(o.ph || "")}" ${o.num ? 'inputmode="numeric"' : ""}>`}${o.hint ? `<small>${o.hint}</small>` : ""}</label>`;
  V.innerHTML = `
    <div class="head"><a class="back" href="#cantieri">‹ Cantieri</a><span class="meta">Salvato automaticamente</span></div>
    <section class="card">
      <h3>Cantiere</h3>
      <div class="grid2">
        ${F("nome", "Nome breve", { wide: true, ph: "Es. Lorenteggio 35", hint: "È il nome che vedi negli elenchi e che l'app cerca negli appunti dettati." })}
        ${F("alias", "Altri modi in cui lo chiami", { wide: true, ph: "Es. Monte Rosa, condominio Rosa", hint: "Facoltativo. Separali con una virgola." })}
        ${F("committente", "Committente", { wide: true, ph: "Condominio di Via … in Milano" })}
        ${F("commessaNum", "Commessa n.", { num: true, ph: "312" })}
        ${F("prossimoNumero", "Prossimo verbale n.", { num: true })}
        ${F("commessaDesc", "Descrizione commessa", { wide: true, area: true, ph: "Ristrutturazione condominiale e manutenzione straordinaria delle parti comuni…" })}
        ${F("incarico", "Incarico", { wide: true })}
        ${F("localita", "Località")}
        ${F("luogo", "Luogo", { ph: "condominio …" })}
      </div>
    </section>
    <section class="card">
      <h3>Società e persone</h3>
      <p class="meta">Spunta <b>T</b> per chi riceve il verbale per email. Le email valgono per tutti i verbali di questo cantiere.</p>
      <div id="sogg"></div>
      <button class="btn" type="button" id="addS">Aggiungi soggetto</button>
    </section>
    <div class="row"><button class="btn primary" type="button" id="nv">Nuovo verbale per questo cantiere</button></div>
    <div class="danger"><button class="link" type="button" id="delC">${nv ? `Elimina cantiere e i suoi ${nv} verbali` : "Elimina cantiere"}</button></div>`;
  const save = debounce(() => saveC(c));
  $$("[data-f]").forEach(i => i.oninput = () => { c[i.dataset.f] = i.value; save(); });
  const renderS = () => {
    $("#sogg").innerHTML = (c.soggetti || []).map((s, i) => `
      <div class="sogg" data-s="${s.id}">
        <div class="sogg-top">
          <input class="ruolo" list="ruoli" data-k="ruolo" value="${esc(s.ruolo)}" aria-label="Ruolo" placeholder="Ruolo">
          <label class="tflag"><input type="checkbox" data-k="t" ${s.t ? "checked" : ""}><span>T</span></label>
          <button class="icon" type="button" data-up ${i === 0 ? "disabled" : ""} aria-label="Sposta su">↑</button>
          <button class="icon" type="button" data-rm aria-label="Elimina soggetto">×</button>
        </div>
        <div class="grid2">
          <label class="fld"><span>Persone</span><input data-k="nome" value="${esc(s.nome)}" placeholder="Arch. M. Rossi"></label>
          <label class="fld"><span>Email</span><input data-k="email" type="email" inputmode="email" autocomplete="off" value="${esc(s.email)}" placeholder="nome@dominio.it" multiple></label>
          <label class="fld wide"><span>Società e sede</span><textarea data-k="societa" rows="2" placeholder="Ragione sociale, indirizzo">${esc(s.societa)}</textarea></label>
          <label class="fld wide"><span>Telefono e altri contatti</span><input data-k="contatti" value="${esc(s.contatti)}"></label>
        </div>
      </div>`).join("");
    $$("#sogg [data-s]").forEach(el => {
      const s = c.soggetti.find(x => x.id === el.dataset.s);
      $$("[data-k]", el).forEach(i => i.oninput = i.onchange = () => { s[i.dataset.k] = i.type === "checkbox" ? i.checked : i.value; save(); });
      $("[data-rm]", el).onclick = async () => {
        const idx = c.soggetti.indexOf(s); c.soggetti.splice(idx, 1); await saveC(c); renderS();
        toast("Soggetto eliminato.", { label: "Annulla", fn: async () => { c.soggetti.splice(idx, 0, s); await saveC(c); renderS(); } });
      };
      $("[data-up]", el).onclick = async () => { const i = c.soggetti.indexOf(s); if (i > 0) { c.soggetti.splice(i - 1, 0, ...c.soggetti.splice(i, 1)); await saveC(c); renderS(); } };
    });
  };
  renderS();
  $("#addS").onclick = async () => { c.soggetti.push({ id: uid(), ruolo: "", nome: "", societa: "", contatti: "", email: "", t: true, note: "" }); await saveC(c); renderS(); $("#sogg .sogg:last-child .ruolo").focus(); };
  $("#nv").onclick = async () => {
    await saveC(c);
    const v = { id: uid(), cantiereId: "", numero: "", data: oggi(), dataFine: "", appunti: "", storico: "", campi: { disposizioni: S.disposizioni }, p: {}, t: {}, foto: [], stato: "bozza", creato: Date.now() };
    applicaCantiere(v, c); verbali.push(v); await saveV(v); location.hash = "verbale-" + v.id;
  };
  conferma($("#delC"), "Tocca ancora per eliminare", async () => {
    for (const v of verbali.filter(v => v.cantiereId === c.id)) await idb.del("verbali", v.id);
    verbali = verbali.filter(v => v.cantiereId !== c.id); cantieri = cantieri.filter(x => x.id !== c.id);
    await idb.del("cantieri", c.id); location.hash = "cantieri"; toast("Cantiere eliminato.");
  });
}
async function esempio() {
  const s = (ruolo, nome, societa, email, t = true) => ({ id: uid(), ruolo, nome, societa, contatti: "", email, t, note: "" });
  const c = { id: uid(), nome: "Via Monte Rosa 12 (esempio)", alias: "Monte Rosa", committente: "Condominio di Via Monte Rosa n. 12 in Milano", commessaNum: "318",
    commessaDesc: "Manutenzione straordinaria delle facciate e delle parti comuni", incarico: S.incarico, localita: "Milano", luogo: "condominio Monte Rosa 12", prossimoNumero: 27,
    soggetti: [s("Amministrazione", "Rag. L. Rinaldi", "Studio Rinaldi Amministrazioni", "amministrazione@rinaldi.example"),
      s("Direzione Lavori", "Arch. P. Ferri", "Ferri Architetti", "dl@ferriarchitetti.example"),
      s("Impresa esecutrice", "Ing. M. Conti", "Edilnord S.r.l.", "cantiere@edilnord.example"),
      s("Sub appaltatori", "", "Ponteggi Lombardi S.r.l.", "info@ponteggilombardi.example"),
      s("Collaudatore", "Ing. S. Vitale", "", "s.vitale@studiovitale.example")], creato: Date.now() };
  cantieri.push(c); await saveC(c);
  const v = { id: uid(), cantiereId: "", numero: "", data: oggi(), dataFine: "", appunti: "Via Monte Rosa, tre operai Edilnord presenti. Montaggio del ponteggio esterno. Meteo sereno, 12 gradi.", storico: "", campi: { disposizioni: S.disposizioni }, p: {}, t: {}, foto: [], stato: "bozza", creato: Date.now() };
  applicaCantiere(v, c); verbali.push(v); await saveV(v);
  location.hash = "verbale-" + v.id;
  toast("Esempio pronto: tocca Distribuisci nei campi.");
}

/* ----------------------------------------------------------- impostazioni */
function viewImpostazioni() {
  const F = (k, label, o = {}) => `<label class="fld wide"><span>${label}</span>${o.area ? `<textarea data-s="${k}" rows="${o.rows || 3}">${esc(S[k])}</textarea>` : `<input data-s="${k}" value="${esc(S[k])}" placeholder="${esc(o.ph || "")}">`}${o.hint ? `<small>${o.hint}</small>` : ""}</label>`;
  V.innerHTML = `
    <div class="head"><h2>Impostazioni</h2><span class="meta">Salvato automaticamente</span></div>
    <section class="card">
      <h3>Studio</h3>
      <div class="grid2">
        ${F("studio", "Intestazione dello studio", { ph: "Es. ARCHITETTO ROSSI", hint: "Compare in alto su ogni pagina e in “redatto da”." })}
        ${F("coordinatore", "Coordinatore in fase di esecuzione", { ph: "Arch. Mario Rossi", hint: "Nome sotto la firma e in fondo alle email." })}
      </div>
      <div class="firma">
        <div class="firma-prev" id="firmaPrev"></div>
        <div class="stack">
          <label class="btn"><input class="vh" type="file" accept="image/*" id="in-firma">${S.firma ? "Cambia firma e timbro" : "Carica firma e timbro"}</label>
          ${S.firma ? `<button class="link" type="button" id="rmFirma">Togli firma</button>` : ""}
          <small class="meta">Una foto o una scansione della firma con il timbro, su fondo bianco.</small>
        </div>
      </div>
    </section>
    <section class="card">
      <h3>Testi standard del verbale</h3>
      <div class="grid2">
        ${F("incarico", "Incarico (per i nuovi cantieri)")}
        ${F("localita", "Località (per i nuovi cantieri)")}
        ${F("disposizioni", "Disposizioni (in ogni nuovo verbale)", { area: true, hint: "Le righe che iniziano con “-” diventano un elenco puntato." })}
        ${F("nb", "Nota N.B. in prima pagina", { area: true })}
        ${F("documentazione", "Osservazioni sulle condizioni generali di sicurezza", { area: true, rows: 6 })}
        ${F("chiusura", "Frase di chiusura")}
      </div>
    </section>
    <section class="card">
      <h3>Backup</h3>
      <p class="meta">Cantieri, verbali e foto restano solo su questo dispositivo. Salva un backup ogni tanto: ti serve anche per passare a un altro telefono.</p>
      <div class="row"><button class="btn" type="button" id="bk">Salva backup</button><label class="btn"><input class="vh" type="file" accept="application/json,.json" id="rs">Ripristina backup</label></div>
    </section>
    <section class="card">
      <h3>Installa sul telefono</h3>
      <p class="meta"><b>iPhone e iPad:</b> apri questa pagina in Safari, tocca Condividi e poi “Aggiungi alla schermata Home”.<br><b>Android:</b> in Chrome tocca “Installa” nel banner, oppure il menu ⋮ e poi “Installa app”.<br>Una volta installata funziona anche senza rete. Su iPhone e iPad il pulsante microfono apre la tastiera: detta con il suo microfono. Su Android e computer il pulsante detta direttamente (serve la rete).</p>
      <button class="btn primary" type="button" id="inst" ${deferredInstall ? "" : "hidden"}>Installa l'app</button>
    </section>`;
  const save = debounce(saveS);
  $$("[data-s]").forEach(i => i.oninput = () => { S[i.dataset.s] = i.value; save(); });
  const prev = $("#firmaPrev");
  if (S.firma && S.firma.blob) { const u = URL.createObjectURL(S.firma.blob); prev.innerHTML = `<img src="${u}" alt="Firma e timbro">`; } else prev.innerHTML = `<span>Nessuna firma</span>`;
  $("#in-firma").onchange = async e => { const f = e.target.files[0]; if (!f) return; S.firma = await riduci(f, 900, 0.9, true); await saveS(); viewImpostazioni(); toast("Firma salvata."); };
  $("#rmFirma") && ($("#rmFirma").onclick = async () => { S.firma = null; await saveS(); viewImpostazioni(); });
  $("#bk").onclick = backup;
  $("#rs").onchange = ripristina;
  $("#inst").onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#inst").hidden = true; };
}
const toDataURL = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
const fromDataURL = async u => (await fetch(u)).blob();
async function backup() {
  const ser = async x => x && x.blob ? { ...x, blob: await toDataURL(x.blob) } : x;
  const data = {
    app: "verbale-di-cantiere", versione: 1, creato: new Date().toISOString(),
    impostazioni: { ...S, firma: await ser(S.firma) }, cantieri,
    verbali: await Promise.all(verbali.map(async v => ({ ...v, foto: await Promise.all(v.foto.map(ser)) })))
  };
  const f = new File([JSON.stringify(data)], `Backup verbali ${oggi()}.json`, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: f.name }); return; } catch (e) { if (e.name === "AbortError") return; } }
  scarica(f); toast("Backup salvato.");
}
async function ripristina(e) {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "verbale-di-cantiere") throw new Error("formato");
    const de = async x => x && typeof x.blob === "string" ? { ...x, blob: await fromDataURL(x.blob) } : x;
    S = { ...DEF, ...d.impostazioni, firma: await de(d.impostazioni.firma) }; await saveS();
    for (const c of d.cantieri || []) await saveC(c);
    for (const v of d.verbali || []) { v.foto = await Promise.all((v.foto || []).map(de)); await saveV(v); }
    await load(); toast(`Ripristinati ${d.cantieri.length} cantieri e ${d.verbali.length} verbali.`); location.hash = "verbali"; route();
  } catch (err) { console.error(err); toast("Questo file non è un backup di Verbale di cantiere."); }
}

/* ------------------------------------------------------------------- avvio */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; const b = $("#inst"); if (b) b.hidden = false; });
window.addEventListener("hashchange", route);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
load().then(route).catch(err => { console.error(err); V.innerHTML = vuoto("Archivio non disponibile", "Il browser non permette di salvare dati (navigazione privata?). Apri l'app in una finestra normale.", ""); });

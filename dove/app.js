/* Dove l'ho messo? — oggetti, posti e foto restano sul dispositivo, in IndexedDB. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const V = $("#view");

/* ---------------------------------------------------------------- archivio */
const idb = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const r = indexedDB.open("dove-lho-messo", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("oggetti", { keyPath: "id" });
      r.onsuccess = () => { this._db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("oggetti", mode); const q = fn(t.objectStore("oggetti"));
      t.oncomplete = () => res(q ? q.result : undefined); t.onerror = () => rej(t.error);
    });
  },
  all() { return this.run("readonly", o => o.getAll()); },
  put(v) { return this.run("readwrite", o => o.put(v)); },
  del(id) { return this.run("readwrite", o => o.delete(id)); }
};
let oggetti = [];
let persistAsked = false;
function salva(o) {
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; navigator.storage.persist().catch(() => {}); }
  return idb.put(o);
}
const getO = id => oggetti.find(o => o.id === id);

/* ------------------------------------------------------------------- testi */
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
function data(ts) { const d = new Date(ts); return `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`; }
function fa(ts) {
  const g = Math.floor((Date.now() - ts) / 864e5);
  if (g < 1) return "oggi"; if (g === 1) return "ieri"; if (g < 30) return `${g} giorni fa`;
  const m = Math.floor(g / 30.4); if (m < 12) return m === 1 ? "un mese fa" : `${m} mesi fa`;
  const a = Math.floor(g / 365); return a === 1 ? "un anno fa" : `${a} anni fa`;
}
const maiuscola = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const VUOTE = new Set("il lo la i gli le l un uno una di del dello della dei degli delle d a al allo alla ai agli alle da dal dalla in nel nello nella nei negli nelle su sul sullo sulla sui sugli sulle con per tra fra e ed o mio mia miei mie dove e' messo messa".split(" "));
const radice = w => w.length > 4 ? w.slice(0, w.length - 1) : w; // chiave/chiavi, scatola/scatole

/* «La chiave di scorta del garage è nella scatola blu, sul secondo ripiano» → nome e posto */
function capisci(frase) {
  let f = String(frase || "").trim().replace(/[.!]+$/, "");
  const m = f.match(/^(.*?)\s+(?:è|e'|sta|stanno|sono|si trova(?:no)?|l'ho messa|l'ho messo|li ho messi|le ho messe|ho messo|va|vanno)\s+(.+)$/i)
    || f.match(/^(.*?)\s*[:–—-]\s+(.+)$/);
  if (!m) return { nome: maiuscola(f), posto: "" };
  const nome = m[1].replace(/^(la|il|lo|le|i|gli|l'|un|una|uno|ho messo|ho messa)\s*/i, "").trim();
  const posto = m[2].replace(/^(dentro|sopra|sotto)\s+(a|al|alla|allo|ai|alle)\s+/i, "$1 ").trim();
  return { nome: maiuscola(nome), posto: maiuscola(posto) };
}

/* ricerca: ogni parola cercata deve comparire (anche come inizio di parola o al singolare/plurale) */
function cerca(q) {
  const parole = norm(q).split(" ").filter(w => w && !VUOTE.has(w));
  if (!parole.length) return null;
  const out = [];
  for (const o of oggetti) {
    const campi = [[o.nome, 3], [o.posto, 2], [o.note, 1], [o.prestato ? o.prestato.a : "", 2]];
    let tot = 0, ok = true;
    for (const p of parole) {
      let best = 0;
      for (const [txt, peso] of campi) {
        for (const w of norm(txt).split(" ")) {
          if (!w) continue;
          let s = 0;
          if (w === p) s = 3; else if (w.startsWith(p) || radice(w) === radice(p) || (p.length >= 4 && w.startsWith(radice(p)))) s = 2; else if (p.length >= 4 && w.includes(p)) s = 1;
          best = Math.max(best, s * peso);
        }
      }
      if (!best) { ok = false; break; }
      tot += best;
    }
    if (ok) out.push([tot, o]);
  }
  return out.sort((a, b) => b[0] - a[0] || b[1].aggiornato - a[1].aggiornato).map(x => x[1]);
}
function postiUsati(escludi) {
  const conta = new Map();
  for (const o of oggetti) for (const s of [{ posto: o.posto, data: o.aggiornato }, ...(o.storico || [])]) {
    const k = (s.posto || "").trim(); if (!k || norm(k) === norm(escludi)) continue;
    const c = conta.get(norm(k)) || { posto: k, n: 0, ultimo: 0 }; c.n++; c.ultimo = Math.max(c.ultimo, s.data || 0); conta.set(norm(k), c);
  }
  return [...conta.values()].sort((a, b) => b.ultimo - a.ultimo || b.n - a.n).slice(0, 8).map(c => c.posto);
}

/* ------------------------------------------------------------------- avvisi */
let toastT;
function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  t.hidden = false; requestAnimationFrame(() => t.classList.add("on"));
  if (action) $("button", t).onclick = () => { hide(); action.fn(); };
  clearTimeout(toastT); toastT = setTimeout(hide, action ? 7000 : 3500);
  function hide() { t.classList.remove("on"); setTimeout(() => { if (!t.classList.contains("on")) t.hidden = true; }, 250); }
}

/* -------------------------------------------------------------- dettatura */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let rec = null, recBtn = null, recTimer = null;
function resetMic() { clearTimeout(recTimer); if (recBtn) recBtn.classList.remove("on"); rec = recBtn = null; }
function tastiera(target) { target.focus(); try { target.setSelectionRange(target.value.length, target.value.length); } catch {} toast("Tocca il microfono della tastiera e detta."); }
function mic(btn, target, fine) {
  if (rec) { const r = rec; resetMic(); try { r.abort(); } catch {} return; }
  if (!SR || IOS) { tastiera(target); return; }
  const r = new SR(); rec = r; recBtn = btn; let partito = false, testo = "";
  r.lang = "it-IT"; r.interimResults = true; r.continuous = false;
  r.onstart = r.onaudiostart = () => { partito = true; clearTimeout(recTimer); };
  r.onresult = e => { partito = true; testo = [...e.results].map(x => x[0].transcript).join(" "); target.value = testo; target.dispatchEvent(new Event("input", { bubbles: true })); };
  r.onerror = e => { if (rec !== r) return; resetMic(); if (/not-allowed/.test(e.error)) toast("Consenti l'uso del microfono, oppure usa quello della tastiera."); else if (e.error !== "aborted" && e.error !== "no-speech") tastiera(target); };
  r.onend = () => { if (rec !== r) return; resetMic(); if (testo && fine) fine(testo); };
  btn.classList.add("on");
  recTimer = setTimeout(() => { if (rec === r && !partito) { resetMic(); try { r.abort(); } catch {} tastiera(target); } }, 4000);
  try { r.start(); } catch { resetMic(); tastiera(target); }
}
function stopMic() { if (rec) { const r = rec; resetMic(); try { r.abort(); } catch {} } }
const MIC = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2Z"/></svg>`;
const CAM = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 7.2 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4H9Zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>`;
const PIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>`;

async function riduci(file, max = 1400, q = 0.8) {
  let src, w, h;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; h = src.height; }
  catch { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); w = src.naturalWidth; h = src.naturalHeight; }
  const k = Math.min(1, max / Math.max(w, h)); const cw = Math.round(w * k), ch = Math.round(h * k);
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch; cv.getContext("2d").drawImage(src, 0, 0, cw, ch);
  return { blob: await new Promise(r => cv.toBlob(r, "image/jpeg", q)), w: cw, h: ch };
}
const urls = new Map();
function fotoURL(o) { if (!o.foto) return ""; if (!urls.has(o.id + o.aggiornato)) urls.set(o.id + o.aggiornato, URL.createObjectURL(o.foto.blob)); return urls.get(o.id + o.aggiornato); }

/* ------------------------------------------------------------------ viste */
const DIECI = ["Chiave di scorta", "Passaporti", "Garanzie e scontrini", "Trapano", "Scala", "Addobbi di Natale", "Cavo HDMI", "Libretto dell'auto", "Pompa della bici", "Caricabatterie di riserva"];
let ultimaRicerca = "";
function route() {
  stopMic();
  const h = decodeURIComponent(location.hash.slice(1)) || "cerca";
  const i = h.indexOf("-"); const vista = i < 0 ? h : h.slice(0, i); const id = i < 0 ? "" : h.slice(i + 1);
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.v === (vista === "oggetto" ? "cerca" : vista)));
  window.scrollTo(0, 0);
  if (vista === "oggetto" && getO(id)) return vistaOggetto(getO(id));
  if (vista === "nuovo") return vistaNuovo(id);
  if (vista === "altro") return vistaAltro();
  return vistaCerca();
}

function riga(o) {
  const f = fotoURL(o);
  return `<li><a class="item" href="#oggetto-${o.id}">
    <span class="thumb">${f ? `<img src="${f}" alt="">` : PIN}</span>
    <span class="item-main"><b>${esc(o.nome)}</b><span class="posto">${esc(o.posto || "Posto da scrivere")}</span>
    <small>${o.prestato ? `<em class="lent">Prestato a ${esc(o.prestato.a)}</em> · ` : ""}aggiornato ${fa(o.aggiornato)}</small></span></a></li>`;
}
function vistaCerca() {
  V.innerHTML = `
    <form class="search" id="fs" role="search">
      <label for="q" class="vh">Cerca un oggetto</label>
      <input id="q" type="search" placeholder="Cosa cerchi? Es. chiave garage" autocomplete="off" enterkeyhint="search" value="${esc(ultimaRicerca)}">
      <button class="icon mic" type="button" id="qmic" aria-label="Detta cosa cerchi">${MIC}</button>
    </form>
    <div id="res"></div>`;
  const q = $("#q"), res = $("#res");
  const mostra = () => {
    ultimaRicerca = q.value;
    const trovati = cerca(q.value);
    if (trovati === null) {
      if (!oggetti.length) {
        res.innerHTML = `<section class="intro">
          <h2>Dove l'ho messo?</h2>
          <p>Salva il posto delle cose che usi di rado. Quando servono, scrivi il nome e ritrovi il posto, la foto e la data.</p>
          <a class="btn primary big" href="#nuovo">${PIN}Salva il primo oggetto</a>
          <h3>Prova con questi dieci</h3>
          <p class="meta">Le cose che in casa si cercano sempre. Tocca un nome per salvarne il posto.</p>
          <div class="chips">${DIECI.map(n => `<a class="chip" href="#nuovo-${encodeURIComponent(n)}">${esc(n)}</a>`).join("")}</div>
        </section>`;
        return;
      }
      const prest = oggetti.filter(o => o.prestato).sort((a, b) => a.prestato.data - b.prestato.data);
      const rec = [...oggetti].sort((a, b) => b.aggiornato - a.aggiornato);
      const mancanti = DIECI.filter(n => !oggetti.some(o => { const a = norm(o.nome), b = norm(n); return a.includes(b) || b.includes(a); }));
      res.innerHTML = `
        ${prest.length ? `<h3 class="sec">Prestati <small>${prest.length}</small></h3><ul class="list">${prest.map(riga).join("")}</ul>` : ""}
        <h3 class="sec">Tutti gli oggetti <small>${oggetti.length}</small></h3><ul class="list">${rec.map(riga).join("")}</ul>
        ${oggetti.length < 10 && mancanti.length ? `<h3 class="sec">Da aggiungere</h3><div class="chips">${mancanti.map(n => `<a class="chip" href="#nuovo-${encodeURIComponent(n)}">+ ${esc(n)}</a>`).join("")}</div>` : ""}`;
      return;
    }
    res.innerHTML = trovati.length
      ? `<h3 class="sec">${trovati.length === 1 ? "Trovato" : `${trovati.length} risultati`}</h3>${risultatoPrincipale(trovati[0])}${trovati.length > 1 ? `<ul class="list">${trovati.slice(1).map(riga).join("")}</ul>` : ""}`
      : `<div class="none"><p>Nessun oggetto con «${esc(q.value.trim())}».</p><a class="btn primary" href="#nuovo-${encodeURIComponent(maiuscola(q.value.trim()))}">Salva «${esc(q.value.trim())}»</a></div>`;
  };
  q.oninput = mostra;
  $("#fs").onsubmit = e => { e.preventDefault(); q.blur(); };
  $("#qmic").onclick = e => mic(e.currentTarget, q);
  mostra();
}
function risultatoPrincipale(o) {
  const f = fotoURL(o);
  return `<a class="hit" href="#oggetto-${o.id}">
    ${f ? `<img src="${f}" alt="Foto: ${esc(o.nome)}">` : ""}
    <div class="hit-txt"><span class="lab">${esc(o.nome)}</span><b class="where">${esc(o.posto || "Posto da scrivere")}</b>
    ${o.prestato ? `<span class="lent">Prestato a ${esc(o.prestato.a)} dal ${data(o.prestato.data)}</span>` : ""}
    <small>Aggiornato il ${data(o.aggiornato)}</small></div></a>`;
}

function vistaNuovo(pre) {
  const nomePre = pre ? decodeURIComponent(pre) : "";
  const posti = postiUsati("");
  V.innerHTML = `
    <div class="head"><a class="back" href="#cerca">‹ Cerca</a></div>
    <h2>Salva un oggetto</h2>
    <section class="card">
      <label class="fld" for="frase"><span>Detta o scrivi una frase</span></label>
      <div class="dict"><textarea id="frase" rows="3" placeholder="La chiave di scorta del garage è nella scatola blu, sul secondo ripiano"></textarea>
      <button class="icon mic big" type="button" id="fmic" aria-label="Detta la frase">${MIC}</button></div>
      <p class="meta">Usa «è», «sta» o «sono» tra l'oggetto e il posto: l'app li separa da sola.</p>
    </section>
    <section class="card">
      <label class="fld"><span>Oggetto</span><input id="nome" value="${esc(nomePre)}" placeholder="Chiave di scorta del garage" autocomplete="off"></label>
      <label class="fld"><span>Dove si trova</span><input id="posto" placeholder="Scatola blu, secondo ripiano" autocomplete="off"></label>
      ${posti.length ? `<div class="chips small" id="pp">${posti.map(p => `<button class="chip" type="button" data-p="${esc(p)}">${esc(p)}</button>`).join("")}</div>` : ""}
      <label class="fld"><span>Note <small>facoltativo</small></span><input id="note" placeholder="Es. quella con il portachiavi rosso" autocomplete="off"></label>
      <div class="photo" id="ph"></div>
      <label class="btn"><input class="vh" type="file" accept="image/*" capture="environment" id="foto">${CAM}<span id="fotolab">Scatta una foto del posto</span></label>
    </section>
    <button class="btn primary big wide" type="button" id="ok">Salva</button>`;
  let foto = null;
  const frase = $("#frase");
  const applica = () => { const c = capisci(frase.value); if (c.nome) $("#nome").value = c.nome; if (c.posto) $("#posto").value = c.posto; };
  frase.oninput = applica;
  $("#fmic").onclick = e => mic(e.currentTarget, frase, applica);
  $$("#pp [data-p]").forEach(b => b.onclick = () => { $("#posto").value = b.dataset.p; });
  $("#foto").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { foto = await riduci(f); $("#ph").innerHTML = `<img src="${URL.createObjectURL(foto.blob)}" alt="Foto del posto">`; $("#fotolab").textContent = "Cambia foto"; }
    catch { toast("Non riesco a leggere la foto."); }
  };
  $("#ok").onclick = async () => {
    const nome = $("#nome").value.trim(), posto = $("#posto").value.trim();
    if (!nome) { toast("Scrivi il nome dell'oggetto."); $("#nome").focus(); return; }
    if (!posto && !foto) { toast("Scrivi dove si trova, oppure scatta una foto."); $("#posto").focus(); return; }
    const o = { id: uid(), nome: maiuscola(nome), posto: maiuscola(posto), note: $("#note").value.trim(), foto, prestato: null, storico: [], creato: Date.now(), aggiornato: Date.now() };
    oggetti.push(o); await salva(o);
    location.hash = "oggetto-" + o.id; toast("Salvato.");
  };
  if (!nomePre) frase.focus(); else $("#posto").focus();
}

function vistaOggetto(o) {
  const f = fotoURL(o);
  const posti = postiUsati(o.posto);
  V.innerHTML = `
    <div class="head"><a class="back" href="#cerca">‹ Cerca</a><button class="link" type="button" id="mod">Modifica</button></div>
    <article class="detail">
      ${f ? `<img class="big" src="${f}" alt="Foto: ${esc(o.nome)}">` : ""}
      <h2>${esc(o.nome)}</h2>
      <div class="where-box">${PIN}<div><span class="lab">Si trova</span><b>${esc(o.posto || "Posto da scrivere")}</b></div></div>
      ${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}
      ${o.prestato ? `<div class="lent-box"><div><span class="lab">Prestato</span><b>a ${esc(o.prestato.a)}</b><small>dal ${data(o.prestato.data)} · ${fa(o.prestato.data)}</small></div><button class="btn" type="button" id="rest">È tornato</button></div>` : ""}
      <p class="meta">Aggiornato il ${data(o.aggiornato)} (${fa(o.aggiornato)})</p>
    </article>

    <section class="card">
      <h3>L'hai spostato?</h3>
      <div class="chips">
        <button class="chip ok" type="button" id="qui">✓ È ancora lì</button>
        ${posti.map(p => `<button class="chip" type="button" data-p="${esc(p)}">${esc(p)}</button>`).join("")}
      </div>
      <div class="newplace"><input id="np" placeholder="Nuovo posto" autocomplete="off" aria-label="Nuovo posto"><button class="icon mic" type="button" id="npmic" aria-label="Detta il nuovo posto">${MIC}</button><button class="btn primary" type="button" id="npok">Sposta</button></div>
      <label class="btn"><input class="vh" type="file" accept="image/*" capture="environment" id="foto">${CAM}${o.foto ? "Nuova foto" : "Aggiungi una foto"}</label>
    </section>

    ${o.prestato ? "" : `<section class="card"><h3>Prestalo</h3>
      <div class="newplace"><input id="chi" placeholder="A chi? Es. Marco" autocomplete="off" aria-label="A chi l'hai prestato"><button class="btn" type="button" id="presta">Segna come prestato</button></div></section>`}

    ${(o.storico || []).length ? `<section class="card"><h3>Dov'era prima</h3><ul class="hist">${o.storico.slice().reverse().map(s => `<li><span>${esc(s.posto)}</span><small>fino al ${data(s.fino)}</small></li>`).join("")}</ul></section>` : ""}
    <div class="danger"><button class="link" type="button" id="del">Elimina</button></div>`;

  const sposta = async (posto, msg) => {
    posto = maiuscola(posto.trim());
    if (posto && norm(posto) !== norm(o.posto)) { (o.storico = o.storico || []).push({ posto: o.posto, data: o.aggiornato, fino: Date.now() }); o.storico = o.storico.slice(-10); o.posto = posto; }
    o.aggiornato = Date.now(); await salva(o); vistaOggetto(o); toast(msg || `Spostato: ${posto}`);
  };
  $("#qui").onclick = () => sposta(o.posto, "Confermato: è ancora lì.");
  $$("[data-p]").forEach(b => b.onclick = () => sposta(b.dataset.p));
  $("#npok").onclick = () => { const v = $("#np").value.trim(); if (!v) { $("#np").focus(); return; } sposta(v); };
  $("#np").onkeydown = e => { if (e.key === "Enter") $("#npok").click(); };
  $("#npmic").onclick = e => mic(e.currentTarget, $("#np"));
  $("#foto").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try { o.foto = await riduci(f); o.aggiornato = Date.now(); await salva(o); vistaOggetto(o); toast("Foto aggiornata."); } catch { toast("Non riesco a leggere la foto."); }
  };
  if ($("#presta")) $("#presta").onclick = async () => {
    const a = $("#chi").value.trim(); if (!a) { $("#chi").focus(); return; }
    o.prestato = { a: maiuscola(a), data: Date.now() }; await salva(o); vistaOggetto(o); toast(`Prestato a ${o.prestato.a}.`);
  };
  if ($("#rest")) $("#rest").onclick = async () => { const a = o.prestato.a; o.prestato = null; o.aggiornato = Date.now(); await salva(o); vistaOggetto(o); toast(`Restituito da ${a}. È ancora in «${o.posto}»?`); };
  $("#mod").onclick = () => modifica(o);
  let armato = false;
  $("#del").onclick = async () => {
    if (!armato) { armato = true; $("#del").textContent = "Tocca ancora per eliminare"; setTimeout(() => { armato = false; const d = $("#del"); if (d) d.textContent = "Elimina"; }, 3500); return; }
    oggetti = oggetti.filter(x => x.id !== o.id); await idb.del(o.id); location.hash = "cerca";
    toast("Eliminato.", { label: "Annulla", fn: async () => { oggetti.push(o); await salva(o); location.hash = "oggetto-" + o.id; } });
  };
}
function modifica(o) {
  V.innerHTML = `
    <div class="head"><button class="back link" type="button" id="annulla">‹ Annulla</button></div>
    <h2>Modifica</h2>
    <section class="card">
      <label class="fld"><span>Oggetto</span><input id="nome" value="${esc(o.nome)}"></label>
      <label class="fld"><span>Dove si trova</span><input id="posto" value="${esc(o.posto)}"></label>
      <label class="fld"><span>Note</span><input id="note" value="${esc(o.note)}"></label>
      ${o.foto ? `<button class="link" type="button" id="nofoto">Togli la foto</button>` : ""}
    </section>
    <button class="btn primary big wide" type="button" id="ok">Salva</button>`;
  let togli = false;
  $("#annulla").onclick = () => vistaOggetto(o);
  if ($("#nofoto")) $("#nofoto").onclick = e => { togli = true; e.currentTarget.textContent = "La foto sarà tolta"; };
  $("#ok").onclick = async () => {
    const nome = $("#nome").value.trim(); if (!nome) { $("#nome").focus(); return; }
    const posto = maiuscola($("#posto").value.trim());
    if (norm(posto) !== norm(o.posto)) { (o.storico = o.storico || []).push({ posto: o.posto, data: o.aggiornato, fino: Date.now() }); o.aggiornato = Date.now(); }
    o.nome = maiuscola(nome); o.posto = posto; o.note = $("#note").value.trim(); if (togli) o.foto = null;
    await salva(o); vistaOggetto(o); toast("Modifiche salvate.");
  };
}

/* ----------------------------------------------------------- backup e altro */
const toDataURL = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
function scarica(file) { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000); }
let deferredInstall = null;
function vistaAltro() {
  const prest = oggetti.filter(o => o.prestato).length, foto = oggetti.filter(o => o.foto).length;
  V.innerHTML = `
    <h2>Altro</h2>
    <section class="card"><h3>Il tuo elenco</h3>
      <p class="meta">${oggetti.length} oggetti · ${foto} con foto · ${prest} prestati. Tutto resta solo su questo dispositivo.</p></section>
    <section class="card"><h3>Backup</h3>
      <p class="meta">Salva un backup ogni tanto. Ti serve anche per passare l'elenco a un altro telefono o a un familiare: lui lo ripristina e ha gli stessi oggetti.</p>
      <div class="row"><button class="btn" type="button" id="bk">Salva backup</button><label class="btn"><input class="vh" type="file" accept="application/json,.json" id="rs">Ripristina backup</label></div></section>
    <section class="card"><h3>Installa sul telefono</h3>
      <p class="meta"><b>iPhone:</b> apri questa pagina nel browser, tocca Condividi e poi “Aggiungi alla schermata Home”.<br><b>Android:</b> in Chrome tocca il menu ⋮ e poi “Installa app”.<br>Per dettare, su iPhone usa il microfono della tastiera.</p>
      <button class="btn primary" type="button" id="inst" ${deferredInstall ? "" : "hidden"}>Installa l'app</button></section>`;
  $("#bk").onclick = async () => {
    const d = { app: "dove-lho-messo", versione: 1, creato: new Date().toISOString(), oggetti: await Promise.all(oggetti.map(async o => ({ ...o, foto: o.foto ? { ...o.foto, blob: await toDataURL(o.foto.blob) } : null }))) };
    const f = new File([JSON.stringify(d)], `Dove l'ho messo - backup ${new Date().toISOString().slice(0, 10)}.json`, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: f.name }); return; } catch (e) { if (e.name === "AbortError") return; } }
    scarica(f); toast("Backup salvato.");
  };
  $("#rs").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (d.app !== "dove-lho-messo") throw 0;
      for (const o of d.oggetti) { if (o.foto && typeof o.foto.blob === "string") o.foto.blob = await (await fetch(o.foto.blob)).blob(); await salva(o); }
      oggetti = await idb.all(); toast(`Ripristinati ${d.oggetti.length} oggetti.`); location.hash = "cerca";
    } catch { toast("Questo file non è un backup di Dove l'ho messo."); }
  };
  $("#inst").onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#inst").hidden = true; };
}

/* ------------------------------------------------------------------- avvio */
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; const b = $("#inst"); if (b) b.hidden = false; });
window.addEventListener("hashchange", route);
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
idb.all().then(x => { oggetti = x; route(); }).catch(() => { V.innerHTML = `<div class="none"><p>Il browser non permette di salvare dati (navigazione privata?). Apri l'app in una finestra normale.</p></div>`; });

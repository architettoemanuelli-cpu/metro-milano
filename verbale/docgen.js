/* Verbale di cantiere — generazione dei documenti Word (.docx) e PDF.
   La struttura ricalca il modello di verbale di sopralluogo CSE dello studio:
   pagina 1 intestazione + soggetti (P/T), pagina 2 argomenti e conclusioni,
   pagina finale scheda di sopralluogo. */
(function () {
  "use strict";

  const CAMPI = [
    { k: "andamento", t: "Verifica andamento lavori", hint: "Presenze in cantiere: imprese e numero di operai", req: true, rows: 3 },
    { k: "fasi", t: "Fasi di lavorazione in atto", hint: "Una lavorazione per riga", req: true, rows: 3 },
    { k: "osservazioni", t: "Osservazioni e note", rows: 3 },
    { k: "prescrizioni", t: "Prescrizioni", req: true, rows: 3 },
    { k: "disposizioni", t: "Disposizioni", rows: 3 },
    { k: "interventi", t: "Eventuali interventi disciplinari", hint: "Richiami, sospensione fase lavorativa, sospensione lavori, allontanamento soggetti inadempienti ecc.", rows: 2 },
    { k: "tempistica", t: "Tempistica", hint: "Stato di avanzamento, scadenze", rows: 2 },
    { k: "meteo", t: "Condizioni meteorologiche", req: true, rows: 1 },
    { k: "prossima", t: "Prossima riunione operativa", req: true, rows: 1 }
  ];

  const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const toDate = iso => { const [y, m, d] = String(iso || "").split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
  const pad = n => String(n).padStart(2, "0");
  function breve(iso) { const d = toDate(iso); return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ""; }
  function lunga(iso) { const d = toDate(iso); return d ? `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}` : ""; }
  function periodo(v) {
    const a = toDate(v.data), b = toDate(v.dataFine);
    if (!a) return "";
    if (!b || b <= a) return lunga(v.data);
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()}-${b.getDate()} ${MESI[b.getMonth()]} ${b.getFullYear()}`;
    return `${lunga(v.data)} - ${lunga(v.dataFine)}`;
  }
  function periodoBreve(v) { return v.dataFine && v.dataFine > v.data ? `${breve(v.data)} - ${breve(v.dataFine)}` : breve(v.data); }
  function fileName(v, c, ext) {
    const base = `Verbale di sopralluogo in cantiere ${v.numero || ""} del ${periodo(v)}`.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
    return `${base}.${ext}`;
  }
  const emails = s => String(s.email || "").split(/[\s,;]+/).filter(x => /@/.test(x));
  function destinatari(v, c) { return (c && c.soggetti || []).filter(s => v.t && v.t[s.id] && emails(s).length); }
  function impresa(c) { return (c && c.soggetti || []).find(s => /impresa|appalt/i.test(s.ruolo) && !/sub/i.test(s.ruolo) && (s.societa || s.nome)); }
  function commessa(c) { return [c.commessaNum ? `N. ${c.commessaNum}` : "", c.commessaDesc || ""].filter(Boolean).join(" "); }
  const blobU8 = async b => new Uint8Array(await b.arrayBuffer());
  const blobURL = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
  const isPng = b => /png/i.test(b.type);
  function fit(w, h, mw, mh) { const k = Math.min(mw / w, mh / h, 1); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; }
  // righe di testo: le righe che iniziano con "-", "•" o "*" diventano elenchi puntati
  function righe(text) {
    return String(text || "").split(/\n/).map(l => l.replace(/\s+$/, "")).filter((l, i, a) => l || (i > 0 && i < a.length - 1))
      .map(l => { const m = l.match(/^\s*[-•*]\s+(.*)$/); return m ? { bullet: true, s: m[1] } : { s: l }; });
  }

  /* ------------------------------------------------------------------ WORD */
  async function buildDocx(v, c, S) {
    const D = window.docx;
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
      Header, Footer, PageNumber, AlignmentType, ShadingType, TableLayoutType, PageBreak, VerticalAlign } = D;
    const BLUE = "1A4FD6", RED = "C00000", TNR = "Times New Roman", CN = "Courier New";
    const W = 10206; // larghezza utile A4 con margini di 1,5 cm, in twip
    const R = (text, o = {}) => new TextRun({ text: String(text ?? ""), font: o.font || "Arial", size: o.size || 18, bold: o.bold, italics: o.italic, color: o.color, highlight: o.hl ? "yellow" : undefined });
    const TODO = (o = {}) => R("[da completare]", { ...o, hl: true, italic: true, bold: false, color: "000000" });
    const P = (runs, o = {}) => new Paragraph({ children: [].concat(runs), alignment: o.align, spacing: o.spacing || { after: 30 }, indent: o.indent, keepNext: o.keepNext });
    function paras(text, o = {}, req = false) {
      const rr = righe(text);
      if (!rr.length) return [P(req ? TODO(o) : R("", o))];
      return rr.map(r => r.bullet ? P(R("•\t" + r.s, o), { indent: { left: 360, hanging: 240 } }) : P(R(r.s, o)));
    }
    const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const LINE = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const ALL = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };
    const BOX = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: NONE, insideVertical: NONE };
    const NO = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
    const cell = (children, w, o = {}) => new TableCell({
      children: children.length ? children : [P(R(""))], width: { size: w, type: WidthType.DXA }, columnSpan: o.span,
      shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined, verticalAlign: o.valign,
      margins: { top: 60, bottom: 60, left: 100, right: 100 }
    });
    const table = (widths, rows, borders = ALL, o = {}) => new Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders,
      rows: rows.map((r, i) => new TableRow({ children: r, tableHeader: o.header && i === 0, cantSplit: o.cantSplit }))
    });
    const box = (children, w) => table([w], [[cell(children, w)]], ALL);
    const space = (n = 120) => new Paragraph({ children: [], spacing: { after: n } });
    const img = async (f, mw, mh) => { const [w, h] = fit(f.w || 800, f.h || 600, mw, mh); return new ImageRun({ type: isPng(f.blob) ? "png" : "jpg", data: await blobU8(f.blob), transformation: { width: w, height: h } }); };
    const name = fileName(v, c, "docx");
    const studio = S.studio || "";

    const header = new Header({ children: [
      P(R("Verbale per Certificazioni/Test/Atti vari: Verbali di visita.", { bold: true }), { spacing: { after: 0 } }),
      P(R(studio, { font: CN, bold: true, color: BLUE, size: 20 }), { spacing: { after: 160 } })
    ] });
    const footer = new Footer({ children: [
      P(R(name, { size: 14 }), { spacing: { after: 0 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: "Arial", size: 14, children: ["Pagina ", PageNumber.CURRENT, " di ", PageNumber.TOTAL_PAGES] })] })
    ] });

    const K = v.campi || {};
    const out = [];
    /* pagina 1 */
    const k1 = 1500;
    out.push(table([k1, W - k1], [
      [cell([P(R("COMMITTENTE:"))], k1), cell([P(R((c.committente || "").toUpperCase(), { font: TNR, bold: true, size: 22 }))], W - k1)],
      [cell([P(R("COMMESSA:"))], k1), cell([P(R(commessa(c), { font: TNR, bold: true, size: 22 }), { spacing: { after: 30, line: 340 } })], W - k1)],
      [cell([P(R(""))], k1), cell([P(R(c.incarico || S.incarico || "", { font: TNR, bold: true, size: 28 }))], W - k1)]
    ], BOX));
    out.push(table([3700, 1700, 1500, W - 6900], [[
      cell([P(R(`Verbale di sopralluogo in cantiere n. ${v.numero || ""}`, { size: 18 }))], 3700),
      cell([P(R("Località:"), { align: AlignmentType.RIGHT })], 1700),
      cell([P(R(c.localita || S.localita || "", { bold: true }), { align: AlignmentType.RIGHT })], 1500),
      cell([P(R(`Luogo: ${c.luogo || ""}`))], W - 6900)
    ]]));
    out.push(space(200));
    const sw = [2400, 4300, 450, 450, W - 7600];
    const sogg = (c.soggetti || []).map(s => [
      cell([P(R(s.ruolo || "", { color: BLUE })), ...(s.nome ? [P(R(s.nome, { bold: true }))] : [])], sw[0]),
      cell([...(s.societa ? paras(s.societa, { color: BLUE }) : []), ...(s.contatti ? paras(s.contatti, { color: BLUE }) : []),
        ...emails(s).map(e => P(R(e, { color: BLUE })))], sw[1]),
      cell([P(R(v.p && v.p[s.id] ? "X" : ""), { align: AlignmentType.CENTER })], sw[2]),
      cell([P(R(v.t && v.t[s.id] ? "X" : ""), { align: AlignmentType.CENTER })], sw[3]),
      cell([P(R(s.note || "", { size: 16 }))], sw[4])
    ]);
    out.push(table(sw, [[
      cell([P(R("SOCIETA'/PERSONE", { bold: true }), { align: AlignmentType.CENTER })], sw[0], { fill: "E7E7E7" }),
      cell([P(R(""))], sw[1], { fill: "E7E7E7" }),
      cell([P(R("P", { bold: true }), { align: AlignmentType.CENTER })], sw[2], { fill: "E7E7E7" }),
      cell([P(R("T", { bold: true }), { align: AlignmentType.CENTER })], sw[3], { fill: "E7E7E7" }),
      cell([P(R("NOTE", { bold: true }), { align: AlignmentType.CENTER })], sw[4], { fill: "E7E7E7" })
    ], ...sogg], ALL, { header: true, cantSplit: true }));
    out.push(P([R("P", { bold: true }), R(" = Presenti     "), R("T", { bold: true }), R(" = Trasmissione")], { align: AlignmentType.RIGHT, spacing: { before: 40, after: 200 } }));
    if (S.nb) out.push(box([P(R(S.nb, { italic: true }))], W));

    /* pagina 2: argomenti e conclusioni */
    out.push(new Paragraph({ children: [new PageBreak()] }));
    const firma = S.firma && S.firma.blob ? [P(await img(S.firma, 200, 80))] : [];
    out.push(table([3000, W - 5300, 2300], [[
      cell([P(R("redatto da:")), P(R(studio, { bold: true, size: 26, color: BLUE })), ...(S.coordinatore ? [P(R(S.coordinatore, { size: 16 }))] : [])], 3000),
      cell([...firma, P(R("Firma", { size: 16 }))], W - 5300, { valign: VerticalAlign.BOTTOM }),
      cell([P(R(periodoBreve(v)), { align: AlignmentType.RIGHT })], 2300)
    ]]));
    const aw = [600, 5200, 2600, W - 8400];
    const foto = [];
    for (const f of (v.foto || [])) {
      foto.push(P(await img(f, 168, 230), { spacing: { after: 20 } }));
      if (f.did) foto.push(P(R(f.did, { size: 14, italic: true }), { spacing: { after: 100 } }));
    }
    const TX = { font: TNR, size: 20 };
    const H = t => P(R(t, { bold: true, size: 20 }), { spacing: { before: 60, after: 40 }, keepNext: true });
    const blocco2 = [H("Osservazioni e Note"), P(R("Si procede:", TX)), ...paras(K.fasi, TX, true)];
    if ((K.osservazioni || "").trim()) blocco2.push(space(60), ...paras(K.osservazioni, TX));
    const blocco3 = [H("Disposizioni"), ...paras(K.disposizioni, TX), H("Prescrizioni"), ...paras(K.prescrizioni, { ...TX, bold: true, color: RED }, true)];
    if ((K.interventi || "").trim()) blocco3.push(H("Interventi disciplinari"), ...paras(K.interventi, TX));
    blocco3.push(space(80), P([R("prossima riunione operativa ", { ...TX, bold: true }), (K.prossima || "").trim() ? R(K.prossima.trim(), { ...TX, bold: true }) : TODO(TX)]));
    out.push(table(aw, [
      [cell([P(R("rif. n."))], aw[0]), cell([P(R("Argomenti e conclusioni"), { align: AlignmentType.CENTER })], aw[1]),
        cell([P(R("Azione/Immagini"), { align: AlignmentType.CENTER })], aw[2]), cell([P(R("Tempistica"), { align: AlignmentType.CENTER })], aw[3])],
      [cell([P(R("1", { bold: true }), { align: AlignmentType.CENTER })], aw[0]), cell([H("Verifica andamento lavori"), ...paras(K.andamento, TX, true)], aw[1]),
        cell(foto, aw[2], { span: undefined }), cell(paras(K.tempistica, { italic: true }), aw[3])],
      [cell([P(R("2", { bold: true }), { align: AlignmentType.CENTER })], aw[0]), cell(blocco2, aw[1]), cell([], aw[2]), cell([], aw[3])],
      [cell([P(R("3", { bold: true }), { align: AlignmentType.CENTER })], aw[0]), cell(blocco3, aw[1]), cell([], aw[2]), cell([], aw[3])]
    ], ALL, { header: true }));

    /* pagina finale: scheda di sopralluogo */
    out.push(new Paragraph({ children: [new PageBreak()] }));
    const half = 4900, gap = W - 2 * half, inner = half - 200;
    const HC = t => P(R(t, { font: CN, bold: true, size: 20 }), { spacing: { before: 220, after: 80 }, keepNext: true });
    const CO = { font: CN, size: 16 };
    const imp = impresa(c);
    const sinistra = [
      P(R("Cantiere:", { bold: true, size: 24 }), { spacing: { after: 100 } }),
      box([P(R(`Comm. ${commessa(c)}`, { font: TNR, bold: true, size: 22 })), P(R(c.incarico || S.incarico || "", { font: TNR, bold: true, size: 22 }))], inner),
      P(R("Appaltatore", { bold: true, size: 24 }), { spacing: { before: 200, after: 60 } }),
      box([P(R(imp ? (imp.societa || imp.nome).split("\n")[0] : "", { bold: true }))], inner),
      HC("A)    FASI DI LAVORAZIONE IN ATTO:"), box(paras(K.fasi, CO, true), inner),
      HC("B)    PRESENZE IN CANTIERE:"), box(paras(K.andamento, CO, true), inner),
      HC("C)    PRESCRIZIONI:"), box(paras(K.prescrizioni, { font: TNR, bold: true, size: 22 }, true), inner),
      HC("D)    EVENTUALI INTERVENTI DISCIPLINARI"),
      P(R("(richiami, sospensione fase lavorativa, sospensione lavori, allontanamento soggetti inadempienti ecc.):", { size: 14 })),
      box(paras(K.interventi, CO), inner)
    ];
    const dest = destinatari(v, c);
    const destra = [
      P(R("Sopralluogo, data:", { bold: true, size: 22 }), { spacing: { after: 60 } }),
      P([R(v.numero || "", { size: 56 }), R("  " + periodoBreve(v), { size: 20 })], { spacing: { after: 200 } }),
      P(R("OSSERVAZIONI IN MERITO ALLE CONDIZIONI GENERALI DI SICUREZZA E DI IGIENE DEL CANTIERE:", { font: CN, bold: true, size: 20 }), { spacing: { after: 80 } }),
      box([...paras(S.documentazione, { ...CO, color: RED }), P(R("")),
        P([R("Prossima riunione operativa ", { ...CO, bold: true }), (K.prossima || "").trim() ? R(K.prossima.trim(), { ...CO, bold: true }) : TODO(CO)]),
        P(R("")), ...(S.chiusura ? [P(R(S.chiusura, { ...CO, bold: true }))] : [])], inner),
      HC("F)    AZIONI IN MERITO ALLA DOCUMENTAZIONE DI CANTIERE:"),
      P(R("CONDIZIONI METEOROLOGICHE:", { bold: true, size: 16 })), ...paras(K.meteo, { bold: true, size: 16 }, true),
      P(R("Firma Coordinatore in Fase di Esecuzione:", { size: 16 }), { spacing: { before: 160, after: 40 } }),
      ...(S.firma && S.firma.blob ? [P(await img(S.firma, 180, 70))] : []),
      ...(S.coordinatore ? [P(R(S.coordinatore, { size: 16 }))] : []),
      space(80),
      box([P(R("TRASMISSIONE VIA EMAIL", { size: 16, bold: true })), ...(dest.length ? dest.map(s => P([R(`${s.ruolo}: `, { size: 16 }), R(emails(s).join(", "), { size: 16, color: BLUE })])) : [P(R("—", { size: 16 }))])], inner),
      P(R("Firma Preposto:", { size: 16 }), { spacing: { before: 200, after: 300 } }),
      P(R("..........................................................", { size: 16 })),
      P(R("Firma Direttore Tecnico cantiere/Capo cantiere:", { size: 16 }), { spacing: { before: 200, after: 300 } }),
      P(R("..........................................................", { size: 16 }))
    ];
    out.push(table([half, gap, half], [[cell(sinistra, half), cell([], gap), cell(destra, half)]], NO));

    const doc = new Document({
      creator: studio || "Verbale di cantiere", title: name.replace(/\.docx$/, ""),
      styles: { default: { document: { run: { font: "Arial", size: 18 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1150, bottom: 900, left: 850, right: 850, header: 400, footer: 380 } } },
        headers: { default: header }, footers: { default: footer }, children: out
      }]
    });
    return Packer.toBlob(doc);
  }

  /* ------------------------------------------------------------------- PDF */
  async function buildPdf(v, c, S) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const M = 15, W = 180, TOP = 25, BOT = 284;
    const BLUE = [26, 79, 214], RED = [192, 0, 0], BLACK = [0, 0, 0];
    const name = fileName(v, c, "pdf");
    let y = TOP;
    doc.setProperties({ title: name.replace(/\.pdf$/, ""), creator: S.studio || "Verbale di cantiere" });
    function header() {
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(0);
      doc.text("Verbale per Certificazioni/Test/Atti vari: Verbali di visita.", M, 11);
      if (S.studio) { doc.setFont("courier", "bold"); doc.setFontSize(10); doc.setTextColor(...BLUE); doc.text(S.studio, M, 16); }
      doc.setTextColor(0);
    }
    function newPage() { doc.addPage(); header(); y = TOP; }
    header();
    const LH = sz => sz * 0.3528 * 1.25;
    const T = (s, o = {}) => ({ s: String(s ?? ""), ...o });
    function setF(b) { doc.setFont(b.f || "helvetica", b.b && b.i ? "bolditalic" : b.b ? "bold" : b.i ? "italic" : "normal"); doc.setFontSize(b.sz || 9); }
    function measure(blocks, w) {
      let h = 0;
      for (const b of blocks) {
        if (b.img) { h += b.img.h + 1.2; continue; }
        setF(b); const ww = b.bullet ? w - 4 : w;
        b._l = b.s === "" ? [""] : doc.splitTextToSize(b.s, ww);
        h += b._l.length * LH(b.sz || 9) + (b.gap ?? 0.5);
      }
      return h;
    }
    function draw(blocks, x, y0, w) {
      let yy = y0;
      for (const b of blocks) {
        if (b.img) { doc.addImage(b.img.data, b.img.fmt, x, yy, b.img.w, b.img.h); yy += b.img.h + 1.2; continue; }
        setF(b); const lh = LH(b.sz || 9); const xx = b.bullet ? x + 4 : x;
        b._l.forEach((ln, i) => {
          if (b.hl) { doc.setFillColor(255, 225, 77); doc.rect(xx - 0.4, yy + 0.25, doc.getTextWidth(ln) + 0.8, lh, "F"); }
          doc.setTextColor(...(b.c || BLACK));
          if (b.bullet && i === 0) doc.text("•", x + 1, yy + lh * 0.8);
          const tx = b.al === "right" ? x + w : b.al === "center" ? x + w / 2 : xx;
          doc.text(ln, tx, yy + lh * 0.8, { align: b.al || "left" });
          yy += lh;
        });
        yy += (b.gap ?? 0.5);
      }
      doc.setTextColor(0);
    }
    function row(cells, o = {}) {
      const p = 1.6;
      const hs = cells.map(cl => measure(cl.blocks, cl.w - 2 * p));
      const h = Math.max(o.minH || 0, ...hs.map(x => x + 2 * p));
      if (y + h > BOT && y > TOP + 0.5) { newPage(); if (o.repeat) o.repeat(); }
      let x = M + (o.x || 0);
      for (const cl of cells) {
        if (cl.fill) { doc.setFillColor(...cl.fill); doc.rect(x, y, cl.w, h, "F"); }
        if (o.border !== false) { doc.setDrawColor(0); doc.setLineWidth(0.2); doc.rect(x, y, cl.w, h); }
        draw(cl.blocks, x + p, y + p, cl.w - 2 * p);
        x += cl.w;
      }
      y += h;
    }
    function text(blocks, o = {}) { row([{ w: o.w || W, blocks }], { border: false, x: o.x }); }
    function paras(txt, o = {}, req = false) {
      const rr = righe(txt);
      if (!rr.length) return [req ? T("[da completare]", { ...o, hl: true, i: true, b: false, c: BLACK }) : T("", o)];
      return rr.map(r => T(r.s, { ...o, bullet: r.bullet }));
    }
    const box = (blocks, o = {}) => row([{ w: W, blocks }], { minH: o.minH });
    const K = v.campi || {};

    /* pagina 1 */
    const y0 = y;
    row([{ w: 28, blocks: [T("COMMITTENTE:", { sz: 8.5 })] }, { w: W - 28, blocks: [T((c.committente || "").toUpperCase(), { f: "times", b: true, sz: 11 })] }], { border: false });
    row([{ w: 28, blocks: [T("COMMESSA:", { sz: 8.5 })] }, { w: W - 28, blocks: [T(commessa(c), { f: "times", b: true, sz: 11 })] }], { border: false });
    row([{ w: 28, blocks: [] }, { w: W - 28, blocks: [T(c.incarico || S.incarico || "", { f: "times", b: true, sz: 13.5 })] }], { border: false });
    doc.setLineWidth(0.2); doc.rect(M, y0, W, y - y0);
    row([{ w: 66, blocks: [T(`Verbale di sopralluogo in cantiere n. ${v.numero || ""}`)] }, { w: 28, blocks: [T("Località:", { al: "right" })] },
      { w: 26, blocks: [T(c.localita || S.localita || "", { b: true, al: "right" })] }, { w: W - 120, blocks: [T(`Luogo: ${c.luogo || ""}`)] }]);
    y += 5;
    const sw = [44, 74, 7, 7, W - 132];
    const head = () => row([{ w: sw[0], blocks: [T("SOCIETA'/PERSONE", { b: true, al: "center" })], fill: [231, 231, 231] }, { w: sw[1], blocks: [], fill: [231, 231, 231] },
      { w: sw[2], blocks: [T("P", { b: true, al: "center" })], fill: [231, 231, 231] }, { w: sw[3], blocks: [T("T", { b: true, al: "center" })], fill: [231, 231, 231] },
      { w: sw[4], blocks: [T("NOTE", { b: true, al: "center" })], fill: [231, 231, 231] }]);
    head();
    for (const s of (c.soggetti || [])) {
      row([
        { w: sw[0], blocks: [T(s.ruolo || "", { c: BLUE }), ...(s.nome ? [T(s.nome, { b: true })] : [])] },
        { w: sw[1], blocks: [...(s.societa ? paras(s.societa, { c: BLUE }) : []), ...(s.contatti ? paras(s.contatti, { c: BLUE }) : []), ...emails(s).map(e => T(e, { c: BLUE }))] },
        { w: sw[2], blocks: [T(v.p && v.p[s.id] ? "X" : "", { b: true, al: "center" })] },
        { w: sw[3], blocks: [T(v.t && v.t[s.id] ? "X" : "", { b: true, al: "center" })] },
        { w: sw[4], blocks: [T(s.note || "", { sz: 8 })] }
      ], { repeat: head });
    }
    text([T("P = Presenti     T = Trasmissione", { al: "right", sz: 8.5 })]);
    y += 2;
    if (S.nb) box([T(S.nb, { i: true })]);

    /* pagina 2 */
    newPage();
    const firma = S.firma && S.firma.blob ? await (async () => { const [w, h] = fit(S.firma.w, S.firma.h, 50, 20); return { img: { data: await blobURL(S.firma.blob), fmt: isPng(S.firma.blob) ? "PNG" : "JPEG", w, h } }; })() : null;
    row([{ w: 55, blocks: [T("redatto da:"), T(S.studio || "", { b: true, sz: 12, c: BLUE }), ...(S.coordinatore ? [T(S.coordinatore, { sz: 8 })] : [])] },
      { w: 85, blocks: [...(firma ? [firma] : []), T("Firma", { sz: 8 })] }, { w: W - 140, blocks: [T(periodoBreve(v), { al: "right" })] }], { minH: 22 });
    const aw = [11, 125, W - 136];
    const ah = () => row([{ w: aw[0], blocks: [T("rif. n.", { sz: 8 })] }, { w: aw[1], blocks: [T("Argomenti e conclusioni", { al: "center" })] }, { w: aw[2], blocks: [T("Tempistica", { al: "center" })] }]);
    ah();
    const TX = { f: "times", sz: 10 };
    const Hd = s => T(s, { b: true, sz: 10, gap: 1.2 });
    row([{ w: aw[0], blocks: [T("1", { b: true, al: "center" })] }, { w: aw[1], blocks: [Hd("Verifica andamento lavori"), ...paras(K.andamento, TX, true)] },
      { w: aw[2], blocks: paras(K.tempistica, { i: true }) }], { repeat: ah });
    const b2 = [Hd("Osservazioni e Note"), T("Si procede:", TX), ...paras(K.fasi, TX, true)];
    if ((K.osservazioni || "").trim()) b2.push(T("", TX), ...paras(K.osservazioni, TX));
    row([{ w: aw[0], blocks: [T("2", { b: true, al: "center" })] }, { w: aw[1], blocks: b2 }, { w: aw[2], blocks: [] }], { repeat: ah });
    const b3 = [Hd("Disposizioni"), ...paras(K.disposizioni, TX), Hd("Prescrizioni"), ...paras(K.prescrizioni, { ...TX, b: true, c: RED }, true)];
    if ((K.interventi || "").trim()) b3.push(Hd("Interventi disciplinari"), ...paras(K.interventi, TX));
    b3.push(T("", TX), (K.prossima || "").trim() ? T("prossima riunione operativa " + K.prossima.trim(), { ...TX, b: true }) : T("prossima riunione operativa: [da completare]", { ...TX, b: true, hl: true }));
    row([{ w: aw[0], blocks: [T("3", { b: true, al: "center" })] }, { w: aw[1], blocks: b3 }, { w: aw[2], blocks: [] }], { repeat: ah });

    if ((v.foto || []).length) {
      y += 6;
      text([T("Azione/Immagini", { b: true, sz: 10 })]);
      const cw = W / 2;
      for (let i = 0; i < v.foto.length; i += 2) {
        const cells = [];
        for (const f of v.foto.slice(i, i + 2)) {
          const [w, h] = fit(f.w || 800, f.h || 600, cw - 4, 95);
          cells.push({ w: cw, blocks: [{ img: { data: await blobURL(f.blob), fmt: isPng(f.blob) ? "PNG" : "JPEG", w, h } }, ...(f.did ? [T(f.did, { i: true, sz: 8 })] : [])] });
        }
        if (cells.length === 1) cells.push({ w: cw, blocks: [] });
        row(cells);
      }
    }

    /* pagina finale: scheda */
    newPage();
    const CO = { f: "courier", sz: 7.8 };
    const HC = s => { y += 1.5; text([T(s, { f: "courier", b: true, sz: 9.5 })]); };
    row([{ w: W / 2, blocks: [T("Cantiere:", { b: true, sz: 12 })] }, { w: W / 2, blocks: [T("Sopralluogo, data:", { b: true, sz: 11 })] }], { border: false });
    row([{ w: W / 2 - 4, blocks: [T(`Comm. ${commessa(c)}`, { f: "times", b: true, sz: 11 }), T(c.incarico || S.incarico || "", { f: "times", b: true, sz: 11 })] },
      { w: 4, blocks: [] }, { w: W / 2, blocks: [T(`${v.numero || ""}   ${periodoBreve(v)}`, { sz: 20 })] }], { border: false });
    const imp = impresa(c);
    text([T("Appaltatore", { b: true, sz: 12 })]);
    box([T(imp ? (imp.societa || imp.nome).split("\n")[0] : "", { b: true })]);
    HC("A)    FASI DI LAVORAZIONE IN ATTO:"); box(paras(K.fasi, CO, true));
    HC("B)    PRESENZE IN CANTIERE:"); box(paras(K.andamento, CO, true));
    HC("C)    PRESCRIZIONI:"); box(paras(K.prescrizioni, { f: "times", b: true, sz: 11 }, true));
    HC("D)    EVENTUALI INTERVENTI DISCIPLINARI");
    text([T("(richiami, sospensione fase lavorativa, sospensione lavori, allontanamento soggetti inadempienti ecc.):", { sz: 7.5 })]);
    box(paras(K.interventi, CO), { minH: 8 });
    HC("OSSERVAZIONI IN MERITO ALLE CONDIZIONI GENERALI DI SICUREZZA E DI IGIENE DEL CANTIERE:");
    box([...paras(S.documentazione, { ...CO, c: RED }), T("", CO),
      (K.prossima || "").trim() ? T("Prossima riunione operativa " + K.prossima.trim(), { ...CO, b: true }) : T("Prossima riunione operativa: [da completare]", { ...CO, b: true, hl: true }),
      ...(S.chiusura ? [T("", CO), T(S.chiusura, { ...CO, b: true })] : [])]);
    HC("F)    AZIONI IN MERITO ALLA DOCUMENTAZIONE DI CANTIERE:");
    text([T("CONDIZIONI METEOROLOGICHE:", { b: true, sz: 8.5 }), ...paras(K.meteo, { b: true, sz: 8.5 }, true)]);
    const dest = destinatari(v, c);
    y += 2;
    box([T("TRASMISSIONE VIA EMAIL", { b: true, sz: 8.5 }), ...(dest.length ? dest.map(s => T(`${s.ruolo}: ${emails(s).join(", ")}`, { sz: 8.5 })) : [T("—", { sz: 8.5 })])]);
    y += 2;
    row([{ w: 60, blocks: [T("Firma Coordinatore in Fase di Esecuzione:", { sz: 8.5 }), ...(firma ? [firma] : []), ...(S.coordinatore ? [T(S.coordinatore, { sz: 8 })] : [])] },
      { w: 60, blocks: [T("Firma Preposto:", { sz: 8.5 }), T("", { sz: 8.5, gap: 8 }), T("....................................", { sz: 8.5 })] },
      { w: 60, blocks: [T("Firma Direttore Tecnico cantiere/Capo cantiere:", { sz: 8.5 }), T("", { sz: 8.5, gap: 4.6 }), T("....................................", { sz: 8.5 })] }], { border: false });

    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(0);
      doc.text(name, M, 288); doc.text(`Pagina ${i} di ${n}`, 105, 292, { align: "center" });
    }
    return doc.output("blob");
  }

  window.VerbaleDoc = { CAMPI, docx: buildDocx, pdf: buildPdf, fileName, periodo, breve, destinatari, emails, impresa };
})();

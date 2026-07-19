/* =========================================================
   CVLS REPERIBILITÀ E ORE VIAGGIO
   File: cvls-reperibilita.js
   Dipende da: app.js (dati, getPendingChanges, savePendingChange,
               saveLocalData, createPendingChangeId, cvlsConfirm,
               cvlsAlert, showCvlsToast, updateStatusBox)
   ========================================================= */

/* ---------------------------------------------------------
   NAMESPACE
   --------------------------------------------------------- */
window.CvlsReperibilita = (function () {

  /* -------------------------------------------------------
     COSTANTI TIPI PENDING CHANGE
     ------------------------------------------------------- */
  var TYPE_SAVE_ORE_VIAGGIO       = "SAVE_ORE_VIAGGIO";
  var TYPE_DELETE_ORE_VIAGGIO     = "DELETE_ORE_VIAGGIO";
  var TYPE_SAVE_REP_PERIODO       = "SAVE_REP_PERIODO";
  var TYPE_DELETE_REP_PERIODO     = "DELETE_REP_PERIODO";
  var TYPE_SAVE_REP_INTERVENTO    = "SAVE_REP_INTERVENTO";
  var TYPE_DELETE_REP_INTERVENTO  = "DELETE_REP_INTERVENTO";

  /* -------------------------------------------------------
     UTILITY DATE
     ------------------------------------------------------- */

  // Restituisce "YYYY-MM-DD" da una Date o stringa
  function toDateKey(val) {
    if (!val) return "";
    var d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  // Parsa "YYYY-MM-DD" in un oggetto Date a mezzanotte locale
  function parseDate(str) {
    if (!str || typeof str !== "string") return null;
    var parts = str.split("-");
    if (parts.length !== 3) return null;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  // Verifica se una data cade in un periodo [inizio, fine]
  function dateInRange(dateStr, inizioStr, fineStr) {
    var d = parseDate(dateStr);
    var i = parseDate(inizioStr);
    var f = parseDate(fineStr);
    if (!d || !i || !f) return false;
    return d >= i && d <= f;
  }

  // Formatta YYYY-MM-DD in DD/MM/YYYY per la UI
  function formatDateIt(isoStr) {
    if (!isoStr || typeof isoStr !== "string") return isoStr || "";
    var parts = isoStr.split("-");
    if (parts.length === 3) {
      return parts[2] + "/" + parts[1] + "/" + parts[0];
    }
    return isoStr;
  }

  // Aggiunge giorni a una Date
  function addDays(d, n) {
    var r = new Date(d.getTime());
    r.setDate(r.getDate() + n);
    return r;
  }

  /* -------------------------------------------------------
     ACCESSO DATI LOCALI (legge da window.dati)
     ------------------------------------------------------- */

  function _generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getAppState() {
    if (window.CvlsAppState && typeof window.CvlsAppState.getData === "function") {
      return window.CvlsAppState.getData() || {};
    }
    return {};
  }

  function getOreViaggioList() {
    var s = getAppState();
    if (!Array.isArray(s.oreViaggio)) return [];
    return s.oreViaggio;
  }

  function getPeriodi() {
    var s = getAppState();
    if (!Array.isArray(s.reperibilita_periodi)) return [];
    return s.reperibilita_periodi;
  }

  function getInterventi() {
    var s = getAppState();
    if (!Array.isArray(s.reperibilita_interventi)) return [];
    return s.reperibilita_interventi;
  }

  /* -------------------------------------------------------
     CALCOLO DATI PER MESE (usato da cvlsBuildFoglioOreMensileData)
     ------------------------------------------------------- */

  /**
   * Restituisce un oggetto con i dati di reperibilità/viaggio
   * per il mese specificato (year, monthIndex 0-based).
   *
   * {
   *   oreViaggioPerGiorno: { "YYYY-MM-DD": minuti },
   *   oreReperibilitaPerGiorno: { "YYYY-MM-DD": minuti },
   *   giorniReperibilita: Set<"YYYY-MM-DD">,
   *   settimaneConteggiate: number
   * }
   */
  function getDataForMonth(year, monthIndex) {
    var firstDay = new Date(year, monthIndex, 1);
    var lastDay  = new Date(year, monthIndex + 1, 0);
    var firstStr = toDateKey(firstDay);
    var lastStr  = toDateKey(lastDay);

    // --- Ore viaggio per giorno ---
    var oreViaggioPerGiorno = {};
    getOreViaggioList().forEach(function (rec) {
      if (rec.data >= firstStr && rec.data <= lastStr) {
        oreViaggioPerGiorno[rec.data] = Number(rec.ore_viaggio_minuti) || 0;
      }
    });

    // --- Giorni marcati R (compresi in un periodo) ---
    var giorniReperibilita = new Set();
    getPeriodi().forEach(function (p) {
      var start = parseDate(p.data_inizio);
      var end   = parseDate(p.data_fine);
      if (!start || !end) return;
      var cur = new Date(Math.max(start.getTime(), firstDay.getTime()));
      var ceiling = new Date(Math.min(end.getTime(), lastDay.getTime()));
      while (cur <= ceiling) {
        giorniReperibilita.add(toDateKey(cur));
        cur = addDays(cur, 1);
      }
    });

    // --- Ore reperibilità per giorno (somma durate interventi) ---
    var oreReperibilitaPerGiorno = {};
    getInterventi().forEach(function (inv) {
      if (inv.data >= firstStr && inv.data <= lastStr) {
        oreReperibilitaPerGiorno[inv.data] =
          (oreReperibilitaPerGiorno[inv.data] || 0) + (Number(inv.durata_minuti) || 0);
      }
    });

    // --- Calcolo settimane reperibilità attribuite al mese ---
    var settimaneConteggiate = calcolaSettimanePerMese(year, monthIndex);

    return {
      oreViaggioPerGiorno: oreViaggioPerGiorno,
      oreReperibilitaPerGiorno: oreReperibilitaPerGiorno,
      giorniReperibilita: giorniReperibilita,
      settimaneConteggiate: settimaneConteggiate
    };
  }

  /* -------------------------------------------------------
     LOGICA SETTIMANE A CAVALLO DI DUE MESI
     Una settimana è 7 giorni consecutivi all'interno di un
     periodo. Viene attribuita al mese che ha ≥ 4 giorni.
     Non conta due volte.
     ------------------------------------------------------- */
  function calcolaSettimanePerMese(year, monthIndex) {
    var count = 0;
    var periodi = getPeriodi();

    periodi.forEach(function (p) {
      var start = parseDate(p.data_inizio);
      var end   = parseDate(p.data_fine);
      if (!start || !end) return;

      var cur = new Date(start.getTime());
      while (cur <= end) {
        var weekEnd = addDays(cur, 6);
        
        var giorniNelMese = 0;
        var d = new Date(cur.getTime());
        while (d <= weekEnd) {
          if (d.getFullYear() === year && d.getMonth() === monthIndex) {
            giorniNelMese++;
          }
          d = addDays(d, 1);
        }

        if (giorniNelMese >= 4) {
          count++;
        }

        cur = addDays(cur, 7);
      }
    });

    return count;
  }

  /* -------------------------------------------------------
     GESTIONE ORE VIAGGIO — CRUD con pending changes
     ------------------------------------------------------- */

  function saveOreViaggio(data, oreMinuti) {
    var dateKey = toDateKey(parseDate(data) || data);
    if (!dateKey) return;
    var minuti = Math.max(0, Math.round(Number(oreMinuti) || 0));

    var s = getAppState();

    // Aggiorna stato locale
    if (!s.oreViaggio) s.oreViaggio = [];
    var idx = s.oreViaggio.findIndex(function (r) { return r.data === dateKey; });
    if (idx >= 0) {
      s.oreViaggio[idx].ore_viaggio_minuti = minuti;
    } else {
      s.oreViaggio.push({ data: dateKey, ore_viaggio_minuti: minuti });
    }

    // Rimuovi pending precedente per la stessa data (upsert)
    _removePendingByDataAndType(dateKey, TYPE_SAVE_ORE_VIAGGIO);
    _removePendingByDataAndType(dateKey, TYPE_DELETE_ORE_VIAGGIO);

    // Aggiungi pending change
    var pending = window.getPendingChanges();
    pending.push({
      changeId:  window.createPendingChangeId(),
      type:      TYPE_SAVE_ORE_VIAGGIO,
      createdAt: new Date().toISOString(),
      payload: {
        data: dateKey,
        ore_viaggio_minuti: minuti
      }
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(pending));

    window.saveLocalData();
    window.updateStatusBox();
  }

  function deleteOreViaggio(data) {
    var dateKey = toDateKey(parseDate(data) || data);
    if (!dateKey) return;

    var s = getAppState();

    // Rimuovi da locale
    if (Array.isArray(s.oreViaggio)) {
      s.oreViaggio = s.oreViaggio.filter(function (r) { return r.data !== dateKey; });
    }

    // Rimuovi pending save per la stessa data
    _removePendingByDataAndType(dateKey, TYPE_SAVE_ORE_VIAGGIO);

    // Aggiungi pending delete
    var pending = window.getPendingChanges();
    pending.push({
      changeId:  window.createPendingChangeId(),
      type:      TYPE_DELETE_ORE_VIAGGIO,
      createdAt: new Date().toISOString(),
      payload:   { data: dateKey }
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(pending));

    window.saveLocalData();
    window.updateStatusBox();
  }

  /* -------------------------------------------------------
     GESTIONE PERIODI REPERIBILITÀ — CRUD con pending changes
     ------------------------------------------------------- */

  function savePeriodo(periodo) {
    // periodo: { id, data_inizio, data_fine }
    var s = getAppState();
    if (!s.reperibilita_periodi) s.reperibilita_periodi = [];
    var id = periodo.id || _generateUUID();
    periodo.id = id;

    var idx = s.reperibilita_periodi.findIndex(function (p) { return p.id === id; });
    if (idx >= 0) {
      s.reperibilita_periodi[idx] = Object.assign({}, s.reperibilita_periodi[idx], periodo);
    } else {
      s.reperibilita_periodi.push(Object.assign({}, periodo));
    }

    // Upsert pending per lo stesso id
    _removePendingById(id, TYPE_SAVE_REP_PERIODO);

    var pending = window.getPendingChanges();
    pending.push({
      changeId:  window.createPendingChangeId(),
      type:      TYPE_SAVE_REP_PERIODO,
      createdAt: new Date().toISOString(),
      payload:   Object.assign({}, periodo)
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(pending));

    window.saveLocalData();
    window.updateStatusBox();
    _aggiornaViste();
  }

  function deletePeriodo(id) {
    if (!id) return;
    var s = getAppState();
    if (Array.isArray(s.reperibilita_periodi)) {
      s.reperibilita_periodi = s.reperibilita_periodi.filter(function (p) { return p.id !== id; });
    }

    _removePendingById(id, TYPE_SAVE_REP_PERIODO);

    var pending = window.getPendingChanges();
    pending.push({
      changeId:  window.createPendingChangeId(),
      type:      TYPE_DELETE_REP_PERIODO,
      createdAt: new Date().toISOString(),
      payload:   { id: id }
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(pending));

    window.saveLocalData();
    window.updateStatusBox();
    _aggiornaViste();
  }

  /* -------------------------------------------------------
     GESTIONE INTERVENTI REPERIBILITÀ — CRUD
     ------------------------------------------------------- */

  function saveIntervento(intervento) {
    var s = getAppState();
    if (!s.reperibilita_interventi) s.reperibilita_interventi = [];
    var id = intervento.id || _generateUUID();
    intervento.id = id;

    var idx = s.reperibilita_interventi.findIndex(function (r) { return r.id === id; });
    if (idx >= 0) {
      s.reperibilita_interventi[idx] = Object.assign({}, s.reperibilita_interventi[idx], intervento);
    } else {
      s.reperibilita_interventi.push(Object.assign({}, intervento));
    }

    _removePendingById(id, TYPE_SAVE_REP_INTERVENTO);

    var pending = window.getPendingChanges();
    pending.push({
      changeId:  window.createPendingChangeId(),
      type:      TYPE_SAVE_REP_INTERVENTO,
      createdAt: new Date().toISOString(),
      payload:   Object.assign({}, intervento)
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(pending));

    window.saveLocalData();
    window.updateStatusBox();
    _aggiornaViste();
  }

  function deleteIntervento(id) {
    if (!id) return;
    var s = getAppState();
    if (Array.isArray(s.reperibilita_interventi)) {
      s.reperibilita_interventi = s.reperibilita_interventi.filter(function (r) { return r.id !== id; });
    }

    _removePendingById(id, TYPE_SAVE_REP_INTERVENTO);

    var pending = window.getPendingChanges();
    pending.push({
      changeId:  window.createPendingChangeId(),
      type:      TYPE_DELETE_REP_INTERVENTO,
      createdAt: new Date().toISOString(),
      payload:   { id: id }
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(pending));

    window.saveLocalData();
    window.updateStatusBox();
    _aggiornaViste();
  }

  /* -------------------------------------------------------
     UTILITY PENDING
     ------------------------------------------------------- */

  function _removePendingByDataAndType(dateKey, type) {
    var pending = window.getPendingChanges();
    var filtered = pending.filter(function (c) {
      return !(c && c.type === type && c.payload && c.payload.data === dateKey);
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(filtered));
  }

  function _removePendingById(id, type) {
    var pending = window.getPendingChanges();
    var filtered = pending.filter(function (c) {
      return !(c && c.type === type && c.payload && c.payload.id === id);
    });
    localStorage.setItem("cvls_pending_changes", JSON.stringify(filtered));
  }

  /* -------------------------------------------------------
     RENDERING BOX REPERIBILITÀ (nella pagina Bollatura)
     ------------------------------------------------------- */

  function renderBoxReperibilita() {
    var periodi    = getPeriodi();
    var interventi = getInterventi();

    _renderPeriodi(periodi, "cvlsRepPeriodiList", "Nessun periodo registrato");
    _renderInterventi(interventi, "cvlsRepInterventiList", "Nessun intervento registrato");
  }

  function _renderPeriodi(periodi, containerId, emptyMsg) {
    var container = document.getElementById(containerId || "cvlsRepPeriodiList");
    if (!container) return;

    if (!periodi || periodi.length === 0) {
      container.innerHTML = "<div class=\"cvls-rep-empty\">" + (emptyMsg || "Nessun periodo registrato") + "</div>";
      return;
    }

    var sorted = periodi.slice().sort(function (a, b) {
      return (b.data_inizio || "").localeCompare(a.data_inizio || "");
    });

    container.innerHTML = sorted.map(function (p) {
      return "<div class=\"cvls-rep-item\">" +
        "<span class=\"cvls-rep-item-text\">" +
          escapeHtml(formatDateIt(p.data_inizio)) + " → " + escapeHtml(formatDateIt(p.data_fine)) +
        "</span>" +
        "<div class=\"cvls-rep-item-actions\">" +
          "<button class=\"cvls-rep-btn-icon\" onclick=\"CvlsReperibilita.openPeriodoDialog('" + escapeHtml(p.id) + "')\" aria-label=\"Modifica periodo\">✏️</button>" +
          "<button class=\"cvls-rep-btn-icon delete\" onclick=\"CvlsReperibilita.confirmDeletePeriodo('" + escapeHtml(p.id) + "')\" aria-label=\"Elimina periodo\">🗑</button>" +
        "</div>" +
      "</div>";
    }).join("");
  }

  function _renderInterventi(interventi, containerId, emptyMsg) {
    var container = document.getElementById(containerId || "cvlsRepInterventiList");
    if (!container) return;

    if (!interventi || interventi.length === 0) {
      container.innerHTML = "<div class=\"cvls-rep-empty\">" + (emptyMsg || "Nessun intervento registrato") + "</div>";
      return;
    }

    var sorted = interventi.slice().sort(function (a, b) {
      return (b.data || "").localeCompare(a.data || "");
    });

    container.innerHTML = sorted.map(function (inv) {
      var presidioText = inv.nome_presidio || inv.codice_presidio || "";
      var ubicazioneText = inv.nome_ubicazione ? " – " + inv.nome_ubicazione : "";
      var orario = inv.ora_chiamata ? " 📞 " + inv.ora_chiamata : "";
      var durata = inv.durata_minuti ? " (" + _minutiToText(Number(inv.durata_minuti)) + ")" : "";
      var rit = inv.numero_rit ? " RIT: " + inv.numero_rit : "";

      return "<div class=\"cvls-rep-item\">" +
        "<span class=\"cvls-rep-item-text\">" +
          "<strong>" + escapeHtml(formatDateIt(inv.data)) + "</strong>" +
          escapeHtml(orario) +
          escapeHtml(durata) +
          "<br><small>" + escapeHtml(presidioText + ubicazioneText + rit) + "</small>" +
        "</span>" +
        "<div class=\"cvls-rep-item-actions\">" +
          "<button class=\"cvls-rep-btn-icon\" onclick=\"CvlsReperibilita.openInterventoDialog('" + escapeHtml(inv.id) + "')\" aria-label=\"Modifica intervento\">✏️</button>" +
          "<button class=\"cvls-rep-btn-icon delete\" onclick=\"CvlsReperibilita.confirmDeleteIntervento('" + escapeHtml(inv.id) + "')\" aria-label=\"Elimina intervento\">🗑</button>" +
        "</div>" +
      "</div>";
    }).join("");
  }

  /* -------------------------------------------------------
     RENDERING REGISTRO MODIFICABILI (nella pagina Registro)
     ------------------------------------------------------- */

  function renderRegistroModificabili(year, monthIndex) {
    var firstDay = new Date(year, monthIndex, 1);
    var lastDay  = new Date(year, monthIndex + 1, 0);
    var firstStr = toDateKey(firstDay);
    var lastStr  = toDateKey(lastDay);

    var periodi = getPeriodi().filter(function(p) {
      return (p.data_inizio <= lastStr) && (p.data_fine >= firstStr);
    });

    var interventi = getInterventi().filter(function(inv) {
      return (inv.data >= firstStr) && (inv.data <= lastStr);
    });

    var mainContainer = document.getElementById("regPresDatiReperibilita");
    var periodiContainer = document.getElementById("cvlsRegPresModificabiliPeriodi");
    var interventiContainer = document.getElementById("cvlsRegPresModificabiliInterventi");

    if (periodi.length === 0 && interventi.length === 0) {
      if (mainContainer) mainContainer.classList.add("hidden");
      if (periodiContainer) {
        periodiContainer.innerHTML = "";
        periodiContainer.style.display = "none";
      }
      if (interventiContainer) {
        interventiContainer.innerHTML = "";
        interventiContainer.style.display = "none";
      }
      return;
    }

    if (mainContainer) mainContainer.classList.remove("hidden");

    if (periodi.length > 0) {
      if (periodiContainer) periodiContainer.style.display = "";
      _renderPeriodi(periodi, "cvlsRegPresModificabiliPeriodi", "");
    } else {
      if (periodiContainer) {
        periodiContainer.innerHTML = "";
        periodiContainer.style.display = "none";
      }
    }

    if (interventi.length > 0) {
      if (interventiContainer) interventiContainer.style.display = "";
      _renderInterventi(interventi, "cvlsRegPresModificabiliInterventi", "");
    } else {
      if (interventiContainer) {
        interventiContainer.innerHTML = "";
        interventiContainer.style.display = "none";
      }
    }
  }

  // Helper interno per aggiornare le viste dopo un CRUD (periodi e interventi)
  function _aggiornaViste() {
    renderBoxReperibilita();
    var selMese = document.getElementById("regPresFoglioOreMese");
    var selAnno = document.getElementById("regPresFoglioOreAnno");
    if (selMese && selAnno && selMese.value && selAnno.value) {
      renderRegistroModificabili(Number(selAnno.value), Number(selMese.value) - 1);
    }
    // Aggiorna l'anteprima solo se è visibile
    var preview = document.getElementById("regPresFoglioOrePreview");
    if (preview && !preview.classList.contains("hidden") && window.cvlsBuildFoglioOreMensileData) {
      if (document.getElementById("regPresGeneraFoglioOreBtn")) {
        document.getElementById("regPresVisualizzaFoglioOreBtn").click();
      }
    }
  }

  /* -------------------------------------------------------
     DIALOG ORE VIAGGIO
     ------------------------------------------------------- */

  function openViaggioDialog(dateKey, currentMinuti) {
    var dlg = document.getElementById("cvlsRepViaggioDialog");
    if (!dlg) return;

    var ore = Math.floor((Number(currentMinuti) || 0) / 60);
    var min = (Number(currentMinuti) || 0) % 60;

    var inData = document.getElementById("cvlsRepViaggioData");
    var inOre  = document.getElementById("cvlsRepViaggioOre");
    var inMin  = document.getElementById("cvlsRepViaggioMin");
    var delBtn = document.getElementById("cvlsRepViaggioCancellaBtn");

    if (inData) inData.value = dateKey;
    if (inOre)  inOre.value  = ore;
    if (inMin)  inMin.value  = min;

    if (delBtn) {
      delBtn.style.display = (Number(currentMinuti) > 0) ? "" : "none";
    }

    var titleEl = document.getElementById("cvlsRepViaggioTitle");
    if (titleEl) titleEl.textContent = "Ore viaggio – " + formatDateIt(dateKey);

    dlg.classList.add("active");
  }

  function closeViaggioDialog() {
    var dlg = document.getElementById("cvlsRepViaggioDialog");
    if (dlg) dlg.classList.remove("active");
  }

  function confirmSaveViaggio() {
    var inData = document.getElementById("cvlsRepViaggioData");
    var inOre  = document.getElementById("cvlsRepViaggioOre");
    var inMin  = document.getElementById("cvlsRepViaggioMin");

    var dateKey = inData ? inData.value : "";
    var ore  = Math.max(0, Math.round(Number(inOre ? inOre.value : 0) || 0));
    var min  = Math.max(0, Math.min(59, Math.round(Number(inMin ? inMin.value : 0) || 0)));
    var totale = ore * 60 + min;

    if (!dateKey) {
      window.cvlsAlert("Data non valida.", "Ore viaggio");
      return;
    }

    saveOreViaggio(dateKey, totale);
    closeViaggioDialog();
    window.showCvlsToast("Ore viaggio salvate");

    // Aggiorna preview foglio ore se aperta
    if (typeof window.renderRegistroPresenzeFoglioOrePreview === "function") {
      window.renderRegistroPresenzeFoglioOrePreview();
    }
  }

  function confirmDeleteViaggio() {
    var inData = document.getElementById("cvlsRepViaggioData");
    var dateKey = inData ? inData.value : "";
    if (!dateKey) return;

    window.cvlsConfirm(
      "Eliminare le ore viaggio del " + formatDateIt(dateKey) + "?",
      function () {
        deleteOreViaggio(dateKey);
        closeViaggioDialog();
        window.showCvlsToast("Ore viaggio eliminate");
        if (typeof window.renderRegistroPresenzeFoglioOrePreview === "function") {
          window.renderRegistroPresenzeFoglioOrePreview();
        }
      },
      null,
      "Elimina"
    );
  }

  /* -------------------------------------------------------
     DIALOG PERIODO REPERIBILITÀ
     ------------------------------------------------------- */

  function openPeriodoDialog(id) {
    var dlg = document.getElementById("cvlsRepPeriodoDialog");
    if (!dlg) return;

    var inId    = document.getElementById("cvlsRepPeriodoId");
    var inStart = document.getElementById("cvlsRepPeriodoInizio");
    var inEnd   = document.getElementById("cvlsRepPeriodoFine");

    var existing = id ? getPeriodi().find(function (p) { return p.id === id; }) : null;

    if (inId)    inId.value    = existing ? existing.id : "";
    if (inStart) inStart.value = existing ? existing.data_inizio : "";
    if (inEnd)   inEnd.value   = existing ? existing.data_fine : "";

    var titleEl = document.getElementById("cvlsRepPeriodoTitle");
    if (titleEl) titleEl.textContent = existing ? "Modifica periodo" : "Nuovo periodo reperibilità";

    dlg.classList.add("active");
  }

  function closePeriodoDialog() {
    var dlg = document.getElementById("cvlsRepPeriodoDialog");
    if (dlg) dlg.classList.remove("active");
  }

  function confirmSavePeriodo() {
    var inId    = document.getElementById("cvlsRepPeriodoId");
    var inStart = document.getElementById("cvlsRepPeriodoInizio");
    var inEnd   = document.getElementById("cvlsRepPeriodoFine");

    var id    = inId    ? inId.value.trim()    : "";
    var start = inStart ? inStart.value.trim() : "";
    var end   = inEnd   ? inEnd.value.trim()   : "";

    if (!start || !end) {
      window.cvlsAlert("Inserisci data inizio e data fine.", "Periodo reperibilità");
      return;
    }

    if (end < start) {
      window.cvlsAlert("La data fine non può precedere la data inizio.", "Periodo reperibilità");
      return;
    }

    var startD = parseDate(start);
    var endD = parseDate(end);
    var durationDays = Math.round((endD - startD) / (1000 * 60 * 60 * 24)) + 1;
    if (durationDays < 7 || durationDays % 7 !== 0) {
      window.cvlsAlert("La durata del periodo deve essere un multiplo esatto di 7 giorni (es. 7, 14, 21 giorni).", "Periodo reperibilità");
      return;
    }

    var periodi = getPeriodi();
    var overlap = periodi.find(function(p) {
       if (p.id === id) return false;
       var pS = parseDate(p.data_inizio);
       var pE = parseDate(p.data_fine);
       return (startD <= pE && endD >= pS);
    });
    if (overlap) {
      window.cvlsAlert("Il periodo si sovrappone a un altro periodo esistente.", "Periodo reperibilità");
      return;
    }

    savePeriodo({ id: id || undefined, data_inizio: start, data_fine: end });
    closePeriodoDialog();
    renderBoxReperibilita();
    window.showCvlsToast("Periodo salvato");
  }

  function confirmDeletePeriodo(id) {
    window.cvlsConfirm(
      "Eliminare questo periodo di reperibilità?",
      function () {
        deletePeriodo(id);
        renderBoxReperibilita();
        window.showCvlsToast("Periodo eliminato");
      },
      null,
      "Elimina"
    );
  }

  /* -------------------------------------------------------
     DIALOG INTERVENTO REPERIBILITÀ
     ------------------------------------------------------- */

  // Variabili per il presidio/ubicazione selezionati
  var _interventoPresidioSelezionato = null;
  var _interventoUbicazioneSelezionata = null;

  function openInterventoDialog(id) {
    var dlg = document.getElementById("cvlsRepInterventoDialog");
    if (!dlg) return;

    var existing = id ? getInterventi().find(function (r) { return r.id === id; }) : null;

    _interventoPresidioSelezionato = null;
    _interventoUbicazioneSelezionata = null;

    var fields = {
      cvlsRepInterventoId:           existing ? existing.id : "",
      cvlsRepInterventoData:         existing ? existing.data : "",
      cvlsRepInterventoOraChiamata:  existing ? existing.ora_chiamata || "" : "",
      cvlsRepInterventoOraPartenza:  existing ? existing.ora_partenza || "" : "",
      cvlsRepInterventoDurOre:       existing ? String(Math.floor((Number(existing.durata_minuti) || 0) / 60)) : "0",
      cvlsRepInterventoDurMin:       existing ? String((Number(existing.durata_minuti) || 0) % 60) : "0",
      cvlsRepInterventoPresidio:     existing ? existing.nome_presidio || "" : "",
      cvlsRepInterventoUbicazione:   existing ? existing.nome_ubicazione || "" : "",
      cvlsRepInterventoNumeroRit:    existing ? existing.numero_rit || "" : ""
    };

    Object.keys(fields).forEach(function (fieldId) {
      var el = document.getElementById(fieldId);
      if (el) el.value = fields[fieldId];
    });

    if (existing) {
      _interventoPresidioSelezionato = {
        codice_citta: existing.codice_citta || "",
        codice_presidio: existing.codice_presidio || "",
        nome: existing.nome_presidio || ""
      };
      if (existing.codice_ubicazione) {
        _interventoUbicazioneSelezionata = {
          codice_citta: existing.codice_citta || "",
          codice_presidio: existing.codice_presidio || "",
          codice_ubicazione: existing.codice_ubicazione || "",
          nome: existing.nome_ubicazione || ""
        };
      }
    }

    var titleEl = document.getElementById("cvlsRepInterventoTitle");
    if (titleEl) titleEl.textContent = existing ? "Modifica intervento" : "Nuovo intervento reperibilità";

    // Pulisce la lista ubicazioni (se cambio presidio)
    var ubInput = document.getElementById("cvlsRepInterventoUbicazione");
    if (ubInput && !existing) ubInput.value = "";

    dlg.classList.add("active");
  }

  function closeInterventoDialog() {
    var dlg = document.getElementById("cvlsRepInterventoDialog");
    if (dlg) dlg.classList.remove("active");
    _chiudiSuggerimenti("cvlsRepInterventoPresidioSugg");
    _chiudiSuggerimenti("cvlsRepInterventoUbicazioneSugg");
  }

  function confirmSaveIntervento() {
    var data         = _val("cvlsRepInterventoData");
    var oraChiamata  = _val("cvlsRepInterventoOraChiamata");
    var oraPartenza  = _val("cvlsRepInterventoOraPartenza");
    var durOre       = Math.max(0, Math.round(Number(_val("cvlsRepInterventoDurOre")) || 0));
    var durMin       = Math.max(0, Math.min(59, Math.round(Number(_val("cvlsRepInterventoDurMin")) || 0)));
    var durTot       = durOre * 60 + durMin;
    var numeroRit    = _val("cvlsRepInterventoNumeroRit");
    var id           = _val("cvlsRepInterventoId");

    if (!data || !oraChiamata || !oraPartenza || !numeroRit) {
      window.cvlsAlert("Compilare tutti i campi obbligatori (data, ora chiamata, ora partenza, RIT).", "Intervento reperibilità");
      return;
    }

    if (durTot <= 0) {
      window.cvlsAlert("La durata dell'intervento deve essere maggiore di zero.", "Intervento reperibilità");
      return;
    }

    if (!_interventoPresidioSelezionato || !_interventoUbicazioneSelezionata) {
      window.cvlsAlert("Devi selezionare un presidio e un'ubicazione dai suggerimenti.", "Intervento reperibilità");
      return;
    }

    var codCitta     = _interventoPresidioSelezionato.codice_citta;
    var codPresidio  = _interventoPresidioSelezionato.codice_presidio;
    var nomePresidio = _interventoPresidioSelezionato.nome;
    var codUbicazione= _interventoUbicazioneSelezionata.codice_ubicazione;
    var nomeUbicazione = _interventoUbicazioneSelezionata.nome;

    saveIntervento({
      id:              id || undefined,
      data:            data,
      ora_chiamata:    oraChiamata,
      ora_partenza:    oraPartenza,
      durata_minuti:   durTot,
      codice_citta:    codCitta,
      codice_presidio: codPresidio,
      codice_ubicazione: codUbicazione,
      nome_presidio:   nomePresidio,
      nome_ubicazione: nomeUbicazione,
      numero_rit:      numeroRit
    });

    closeInterventoDialog();
    renderBoxReperibilita();
    window.showCvlsToast("Intervento salvato");
  }

  function confirmDeleteIntervento(id) {
    window.cvlsConfirm(
      "Eliminare questo intervento di reperibilità?",
      function () {
        deleteIntervento(id);
        renderBoxReperibilita();
        window.showCvlsToast("Intervento eliminato");
      },
      null,
      "Elimina"
    );
  }

  /* -------------------------------------------------------
     AUTOCOMPLETE PRESIDIO / UBICAZIONE nel dialog intervento
     ------------------------------------------------------- */

  function handlePresidioInput() {
    var input = document.getElementById("cvlsRepInterventoPresidio");
    if (!input) return;
    var query = input.value.trim().toLowerCase();
    _interventoPresidioSelezionato = null;
    _interventoUbicazioneSelezionata = null;

    var ubInput = document.getElementById("cvlsRepInterventoUbicazione");
    if (ubInput) ubInput.value = "";

    if (!query || query.length < 1) {
      _chiudiSuggerimenti("cvlsRepInterventoPresidioSugg");
      return;
    }

    var s = getAppState();
    var presidi = Array.isArray(s.presidi) ? s.presidi : [];
    var matches = presidi.filter(function (p) {
      return (p.NomePresidio || "").toLowerCase().indexOf(query) >= 0;
    }).slice(0, 8);

    _mostraSuggerimenti("cvlsRepInterventoPresidioSugg", matches, function (p) {
      var cittaStr = "";
      if (s.citta && Array.isArray(s.citta)) {
        var codCitta = p.CodiceCitta || "";
        var c = s.citta.find(function(ci) { return ci.CodiceCitta === codCitta; });
        if (c && c.NomeCitta) cittaStr = " (" + c.NomeCitta + ")";
      }
      return (p.NomePresidio || "") + cittaStr;
    }, function (p) {
      _interventoPresidioSelezionato = {
        codice_citta: p.CodiceCitta || "",
        codice_presidio: p.CodicePresidio || "",
        nome: p.NomePresidio || ""
      };
      input.value = p.NomePresidio || "";
      _chiudiSuggerimenti("cvlsRepInterventoPresidioSugg");

      // Pulisce ubicazione
      _interventoUbicazioneSelezionata = null;
      if (ubInput) ubInput.value = "";
    });
  }

  function handleUbicazioneInput() {
    var input = document.getElementById("cvlsRepInterventoUbicazione");
    if (!input) return;
    var query = input.value.trim().toLowerCase();
    _interventoUbicazioneSelezionata = null;

    if (!query || query.length < 1) {
      _chiudiSuggerimenti("cvlsRepInterventoUbicazioneSugg");
      return;
    }

    var s = getAppState();
    var ubicazioni = Array.isArray(s.ubicazioni) ? s.ubicazioni : [];

    // Filtra per presidio selezionato (se presente) e testo
    var matches = ubicazioni.filter(function (u) {
      var matchText = (u.NomeUbicazione || "").toLowerCase().indexOf(query) >= 0;
      if (!matchText) return false;
      if (_interventoPresidioSelezionato) {
        return u.CodiceCitta === _interventoPresidioSelezionato.codice_citta &&
               u.CodicePresidio === _interventoPresidioSelezionato.codice_presidio;
      }
      return true;
    }).slice(0, 8);

    _mostraSuggerimenti("cvlsRepInterventoUbicazioneSugg", matches, function (u) {
      var presStr = "";
      if (s.presidi && Array.isArray(s.presidi)) {
        var codC = u.CodiceCitta || "";
        var codP = u.CodicePresidio || "";
        var p = s.presidi.find(function(pr) { return pr.CodiceCitta === codC && pr.CodicePresidio === codP; });
        if (p && p.NomePresidio) presStr = " (" + p.NomePresidio + ")";
      }
      return (u.NomeUbicazione || "") + presStr;
    }, function (u) {
      _interventoUbicazioneSelezionata = {
        codice_citta: u.CodiceCitta || "",
        codice_presidio: u.CodicePresidio || "",
        codice_ubicazione: u.CodiceUbicazione || "",
        nome: u.NomeUbicazione || ""
      };
      // Aggiorna anche presidio se non ancora selezionato
      if (!_interventoPresidioSelezionato) {
        var presidi = Array.isArray(s.presidi) ? s.presidi : [];
        var pres = presidi.find(function (p) {
          return p.CodiceCitta === u.CodiceCitta && p.CodicePresidio === u.CodicePresidio;
        });
        if (pres) {
          _interventoPresidioSelezionato = {
            codice_citta: pres.CodiceCitta,
            codice_presidio: pres.CodicePresidio,
            nome: pres.NomePresidio || ""
          };
          var pInput = document.getElementById("cvlsRepInterventoPresidio");
          if (pInput) pInput.value = pres.NomePresidio || "";
        }
      }
      input.value = u.NomeUbicazione || "";
      _chiudiSuggerimenti("cvlsRepInterventoUbicazioneSugg");
    });
  }

  function _mostraSuggerimenti(containerId, items, labelFn, selectFn) {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = "<div class=\"cvls-rep-suggestion-item\" style=\"color:#9ca3af;\">Nessun risultato</div>";
      container.style.display = "block";
      return;
    }

    container.innerHTML = items.map(function (item, idx) {
      return "<div class=\"cvls-rep-suggestion-item\" id=\"" + containerId + "_item_" + idx + "\">" +
        escapeHtml(labelFn(item)) + "</div>";
    }).join("");

    items.forEach(function (item, idx) {
      var el = document.getElementById(containerId + "_item_" + idx);
      if (el) {
        el.addEventListener("mousedown", function (e) {
          e.preventDefault();
          selectFn(item);
        });
      }
    });

    container.style.display = "block";
  }

  function _chiudiSuggerimenti(containerId) {
    var container = document.getElementById(containerId);
    if (container) {
      container.style.display = "none";
      container.innerHTML = "";
    }
  }

  /* -------------------------------------------------------
     UTILITY
     ------------------------------------------------------- */

  function _val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function _minutiToText(minuti) {
    var m = Math.round(Number(minuti) || 0);
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return h + "h " + String(mm).padStart(2, "0") + "m";
  }

  // Usa escapeHtml di app.js se disponibile, altrimenti inline
  function escapeHtml(str) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(str);
    return String(str === null || str === undefined ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* -------------------------------------------------------
     BINDING EVENTI (chiamato da bindEvents in app.js)
     ------------------------------------------------------- */

  function bindReperibilitaEvents() {
    _bind("cvlsRepAddPeriodoBtn",    "click", function () { openPeriodoDialog(null); });
    _bind("cvlsRepAddInterventoBtn", "click", function () { openInterventoDialog(null); });

    // Dialog Viaggio
    _bind("cvlsRepViaggioSalvaBtn",   "click", confirmSaveViaggio);
    _bind("cvlsRepViaggioCancellaBtn","click", confirmDeleteViaggio);
    _bind("cvlsRepViaggioAnnullaBtn", "click", closeViaggioDialog);

    // Dialog Periodo
    _bind("cvlsRepPeriodoSalvaBtn",   "click", confirmSavePeriodo);
    _bind("cvlsRepPeriodoAnnullaBtn", "click", closePeriodoDialog);

    // Dialog Intervento
    _bind("cvlsRepInterventoSalvaBtn",  "click", confirmSaveIntervento);
    _bind("cvlsRepInterventoAnnullaBtn","click", closeInterventoDialog);

    // Autocomplete
    _bind("cvlsRepInterventoPresidio",  "input", handlePresidioInput);
    _bind("cvlsRepInterventoUbicazione","input", handleUbicazioneInput);

    // Chiudi autocomplete cliccando fuori
    document.addEventListener("click", function (e) {
      var presDiv = document.getElementById("cvlsRepInterventoPresidioSugg");
      var ubDiv   = document.getElementById("cvlsRepInterventoUbicazioneSugg");
      var presInput = document.getElementById("cvlsRepInterventoPresidio");
      var ubInput   = document.getElementById("cvlsRepInterventoUbicazione");
      if (presDiv && presInput && !presInput.contains(e.target) && !presDiv.contains(e.target)) {
        _chiudiSuggerimenti("cvlsRepInterventoPresidioSugg");
      }
      if (ubDiv && ubInput && !ubInput.contains(e.target) && !ubDiv.contains(e.target)) {
        _chiudiSuggerimenti("cvlsRepInterventoUbicazioneSugg");
      }
    });
  }

  function _bind(id, event, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  /* -------------------------------------------------------
     API PUBBLICA
     ------------------------------------------------------- */
  return {
    // Usato da cvlsBuildFoglioOreMensileData in app.js
    getDataForMonth: getDataForMonth,

    // Apertura dialog dall'esterno (via onclick inline)
    openViaggioDialog:       openViaggioDialog,
    openPeriodoDialog:       openPeriodoDialog,
    openInterventoDialog:    openInterventoDialog,
    confirmDeletePeriodo:    confirmDeletePeriodo,
    confirmDeleteIntervento: confirmDeleteIntervento,

    // Render box nella pagina Bollatura
    renderBoxReperibilita: renderBoxReperibilita,
    renderRegistroModificabili: renderRegistroModificabili,

    // Binding eventi (chiamato da bindEvents in app.js)
    bindReperibilitaEvents: bindReperibilitaEvents,

    // Costanti tipi (per cvls-api.js)
    TYPE_SAVE_ORE_VIAGGIO:      TYPE_SAVE_ORE_VIAGGIO,
    TYPE_DELETE_ORE_VIAGGIO:    TYPE_DELETE_ORE_VIAGGIO,
    TYPE_SAVE_REP_PERIODO:      TYPE_SAVE_REP_PERIODO,
    TYPE_DELETE_REP_PERIODO:    TYPE_DELETE_REP_PERIODO,
    TYPE_SAVE_REP_INTERVENTO:   TYPE_SAVE_REP_INTERVENTO,
    TYPE_DELETE_REP_INTERVENTO: TYPE_DELETE_REP_INTERVENTO,

    // Utility esposta
    minutiToText: _minutiToText
  };

})();

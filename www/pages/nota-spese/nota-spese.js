/* =========================================================
   CVLS - Nota Spese
   File dedicato: pages/nota-spese/nota-spese.js
   ========================================================= */

(function () {
  "use strict";

  const RECEIPTS_BUCKET = "note-spese";
  const MAX_RECEIPT_SIZE = 15 * 1024 * 1024;
  const ALLOWED_RECEIPT_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];
  const ALLOWED_RECEIPT_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf"
  ];

  const state = {
    initialized: false,
    loading: false,
    client: null,
    user: null,
    nomeTecnico: "",
    anno: null,
    mese: null,
    notaSpese: null,
    righe: []
  };

  function getClient() {
    return window.supabaseClient || null;
  }

  function getRoot() {
    return document.getElementById("cvlsNotaSpeseRoot");
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function currentYearMonth() {
    const now = new Date();
    return {
      anno: now.getFullYear(),
      mese: now.getMonth() + 1
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatEuro(value) {
    return Number(value || 0).toLocaleString("it-IT", {
      style: "currency",
      currency: "EUR"
    });
  }

  function formatDateIt(value) {
    if (!value) return "";
    const parts = String(value).split("-");
    if (parts.length !== 3) return value;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function formatFileSize(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setStatus(message, type) {
    const el = document.getElementById("cvlsNotaSpeseStatus");
    if (!el) return;

    el.textContent = message || "";
    el.classList.remove("cvls-nota-spese-error", "cvls-nota-spese-ok");

    if (type === "error") el.classList.add("cvls-nota-spese-error");
    if (type === "ok") el.classList.add("cvls-nota-spese-ok");
  }

  function setButtonsDisabled(disabled) {
    [
      "cvlsNotaSpeseCaricaBtn",
      "cvlsNotaSpeseAggiungiBtn",
      "cvlsNotaSpesePulisciBtn",
      "cvlsNotaSpeseScontrino"
    ].forEach(function (id) {
      const element = document.getElementById(id);
      if (element) element.disabled = !!disabled;
    });

    document
      .querySelectorAll("[data-cvls-nota-spese-delete], [data-cvls-nota-spese-open]")
      .forEach(function (button) {
        button.disabled = !!disabled;
      });
  }

  function getSelectedYearMonth() {
    const anno = Number(document.getElementById("cvlsNotaSpeseAnno")?.value || 0);
    const mese = Number(document.getElementById("cvlsNotaSpeseMese")?.value || 0);

    if (!anno || anno < 2020 || anno > 2100) {
      throw new Error("Anno non valido.");
    }

    if (!mese || mese < 1 || mese > 12) {
      throw new Error("Mese non valido.");
    }

    return { anno: anno, mese: mese };
  }

  function readYearMonth() {
    const selected = getSelectedYearMonth();
    state.anno = selected.anno;
    state.mese = selected.mese;
    return selected;
  }

  function defaultDateForSelection() {
    try {
      const selected = getSelectedYearMonth();
      const current = currentYearMonth();

      if (selected.anno === current.anno && selected.mese === current.mese) {
        return todayIso();
      }

      return `${selected.anno}-${pad2(selected.mese)}-01`;
    } catch (error) {
      return todayIso();
    }
  }

  function resetLoadedMonth(message) {
    state.anno = null;
    state.mese = null;
    state.notaSpese = null;
    state.righe = [];

    const totaleBox = document.getElementById("cvlsNotaSpeseTotale");
    if (totaleBox) totaleBox.textContent = formatEuro(0);

    const lista = document.getElementById("cvlsNotaSpeseLista");
    if (lista) {
      lista.innerHTML = `<div class="cvls-nota-spese-empty">${escapeHtml(message || "Seleziona e carica un mese.")}</div>`;
    }

    const dataInput = document.getElementById("cvlsNotaSpeseData");
    if (dataInput) dataInput.value = defaultDateForSelection();

    setStatus("", "");
  }

  async function renderBase() {
    const root = getRoot();
    if (!root) return;

    const response = await fetch(
      "pages/nota-spese/nota-spese.html?v=3",
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(
        `Impossibile caricare Nota Spese (${response.status}).`
      );
    }

    root.innerHTML = await response.text();

    const ym = currentYearMonth();
    const annoInput = document.getElementById("cvlsNotaSpeseAnno");
    const meseSelect = document.getElementById("cvlsNotaSpeseMese");
    const dataInput = document.getElementById("cvlsNotaSpeseData");
    const fileInput = document.getElementById("cvlsNotaSpeseScontrino");

    if (annoInput) annoInput.value = String(ym.anno);
    if (meseSelect) meseSelect.value = String(ym.mese);
    if (dataInput) dataInput.value = todayIso();

    document
      .getElementById("cvlsNotaSpeseCaricaBtn")
      ?.addEventListener("click", loadCurrentMonth);

    document
      .getElementById("cvlsNotaSpeseAggiungiBtn")
      ?.addEventListener("click", addRiga);

    document
      .getElementById("cvlsNotaSpesePulisciBtn")
      ?.addEventListener("click", clearForm);

    annoInput?.addEventListener("change", function () {
      resetLoadedMonth("Mese modificato. Premi Carica mese oppure inserisci una spesa per caricarlo automaticamente.");
    });

    meseSelect?.addEventListener("change", function () {
      resetLoadedMonth("Mese modificato. Premi Carica mese oppure inserisci una spesa per caricarlo automaticamente.");
    });

    fileInput?.addEventListener("change", renderSelectedReceipt);
  }

  async function loadAuth() {
    const client = getClient();

    if (!client || !client.auth || !client.auth.getUser) {
      throw new Error("Client Supabase non disponibile.");
    }

    const result = await client.auth.getUser();

    if (result.error) throw result.error;
    if (!result.data || !result.data.user) throw new Error("Utente non autenticato.");

    state.client = client;
    state.user = result.data.user;

    let nomeTecnico = String(localStorage.getItem("cvls_user_name") || "").trim();
    const email = String(state.user.email || "").trim();

    if (
      (!nomeTecnico || nomeTecnico.includes("@")) &&
      window.CvlsSupabase &&
      typeof window.CvlsSupabase.getProfile === "function"
    ) {
      const profile = await window.CvlsSupabase.getProfile(state.user.id);
      if (profile && profile.nome_tecnico) {
        nomeTecnico = String(profile.nome_tecnico).trim();
        if (nomeTecnico && !nomeTecnico.includes("@")) {
          localStorage.setItem("cvls_user_name", nomeTecnico);
        }
      }
    }

    state.nomeTecnico = nomeTecnico || email || "Tecnico";

    const box = document.getElementById("cvlsNotaSpeseTecnico");
    if (box) box.textContent = state.nomeTecnico;
  }

  async function ensureTestata() {
    const payload = {
      user_id: state.user.id,
      nome_tecnico: state.nomeTecnico,
      anno: state.anno,
      mese: state.mese,
      stato: "bozza"
    };

    const result = await state.client
      .from("note_spese")
      .upsert(payload, { onConflict: "user_id,anno,mese" })
      .select("*")
      .single();

    if (result.error) throw result.error;
    state.notaSpese = result.data;
  }

  async function loadRighe() {
    const result = await state.client
      .from("note_spese_righe")
      .select("*")
      .eq("nota_spese_id", state.notaSpese.id)
      .order("data_spesa", { ascending: true })
      .order("creato_il", { ascending: true });

    if (result.error) throw result.error;
    state.righe = result.data || [];
  }

  async function updateTotale() {
    const totale = state.righe.reduce(function (sum, row) {
      return sum + Number(row.importo || 0);
    }, 0);

    const result = await state.client
      .from("note_spese")
      .update({ totale: totale })
      .eq("id", state.notaSpese.id)
      .eq("user_id", state.user.id)
      .select("*")
      .single();

    if (result.error) throw result.error;
    state.notaSpese = result.data;

    const totaleBox = document.getElementById("cvlsNotaSpeseTotale");
    if (totaleBox) totaleBox.textContent = formatEuro(totale);
  }

  function renderLista() {
    const lista = document.getElementById("cvlsNotaSpeseLista");
    if (!lista) return;

    if (!state.righe.length) {
      lista.innerHTML = '<div class="cvls-nota-spese-empty">Nessuna spesa inserita per il mese selezionato.</div>';
      return;
    }

    const rows = state.righe.map(function (row) {
      const receiptCell = row.scontrino_path
        ? `<button class="cvls-nota-spese-button cvls-nota-spese-button-secondary cvls-nota-spese-button-small" type="button" data-cvls-nota-spese-open="${escapeHtml(row.id)}">Apri</button>`
        : '<span class="cvls-nota-spese-receipt-missing">Non allegato</span>';

      return `
        <tr>
          <td>${formatDateIt(row.data_spesa)}</td>
          <td>${escapeHtml(row.categoria || "")}</td>
          <td>${escapeHtml(row.descrizione || "")}</td>
          <td>${formatEuro(row.importo)}</td>
          <td>${escapeHtml(row.metodo_pagamento || "")}</td>
          <td>${receiptCell}</td>
          <td>
            <div class="cvls-nota-spese-row-actions">
              <button class="cvls-nota-spese-button cvls-nota-spese-button-danger cvls-nota-spese-button-small" type="button" data-cvls-nota-spese-delete="${escapeHtml(row.id)}">Elimina</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    lista.innerHTML = `
      <div class="cvls-nota-spese-table-wrap">
        <table class="cvls-nota-spese-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Categoria</th>
              <th>Descrizione</th>
              <th>Importo</th>
              <th>Pagamento</th>
              <th>Scontrino</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    lista.querySelectorAll("[data-cvls-nota-spese-delete]").forEach(function (button) {
      button.addEventListener("click", function () {
        deleteRiga(button.getAttribute("data-cvls-nota-spese-delete"));
      });
    });

    lista.querySelectorAll("[data-cvls-nota-spese-open]").forEach(function (button) {
      button.addEventListener("click", function () {
        openReceipt(button.getAttribute("data-cvls-nota-spese-open"));
      });
    });
  }

  async function loadCurrentMonth() {
    if (state.loading) return;

    try {
      state.loading = true;
      setButtonsDisabled(true);
      setStatus("Caricamento nota spese...", "");

      await loadAuth();
      readYearMonth();
      await ensureTestata();
      await loadRighe();
      await updateTotale();
      renderLista();

      setStatus("Nota spese caricata correttamente.", "ok");
    } catch (error) {
      console.error("CVLS Nota Spese - errore caricamento:", error);
      setStatus(error.message || "Errore durante il caricamento della nota spese.", "error");
    } finally {
      state.loading = false;
      setButtonsDisabled(false);
    }
  }

  function clearForm() {
    const data = document.getElementById("cvlsNotaSpeseData");
    const categoria = document.getElementById("cvlsNotaSpeseCategoria");
    const descrizione = document.getElementById("cvlsNotaSpeseDescrizione");
    const importo = document.getElementById("cvlsNotaSpeseImporto");
    const metodo = document.getElementById("cvlsNotaSpeseMetodo");
    const scontrino = document.getElementById("cvlsNotaSpeseScontrino");
    const note = document.getElementById("cvlsNotaSpeseNote");

    if (data) data.value = defaultDateForSelection();
    if (categoria) categoria.value = "";
    if (descrizione) descrizione.value = "";
    if (importo) importo.value = "";
    if (metodo) metodo.value = "";
    if (scontrino) scontrino.value = "";
    if (note) note.value = "";

    renderSelectedReceipt();
  }

  function renderSelectedReceipt() {
    const input = document.getElementById("cvlsNotaSpeseScontrino");
    const info = document.getElementById("cvlsNotaSpeseScontrinoNome");
    if (!info) return;

    const file = input?.files?.[0] || null;
    info.textContent = file
      ? `${file.name} · ${formatFileSize(file.size)}`
      : "Nessun file selezionato";
  }

  function getReceiptFile() {
    return document.getElementById("cvlsNotaSpeseScontrino")?.files?.[0] || null;
  }

  function getFileExtension(file) {
    const name = String(file?.name || "").trim();
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex < 0) return "";
    return name.slice(dotIndex + 1).toLowerCase();
  }

  function validateReceipt(file) {
    if (!file) return;

    if (Number(file.size || 0) <= 0) {
      throw new Error("Il file selezionato è vuoto.");
    }

    if (Number(file.size || 0) > MAX_RECEIPT_SIZE) {
      throw new Error("Lo scontrino supera la dimensione massima di 15 MB.");
    }

    const extension = getFileExtension(file);
    const mimeType = String(file.type || "").toLowerCase();
    const allowedByExtension = ALLOWED_RECEIPT_EXTENSIONS.includes(extension);
    const allowedByMime = ALLOWED_RECEIPT_MIME_TYPES.includes(mimeType);

    if (!allowedByExtension && !allowedByMime) {
      throw new Error("Formato scontrino non supportato. Usa JPG, PNG, WEBP, HEIC o PDF.");
    }
  }

  function createUniqueId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getStoragePath(file) {
    const extension = getFileExtension(file) || "bin";
    return `${state.user.id}/${state.anno}/${pad2(state.mese)}/${Date.now()}-${createUniqueId()}.${extension}`;
  }

  async function uploadReceipt(file) {
    if (!file) return null;

    validateReceipt(file);
    const path = getStoragePath(file);

    const result = await state.client.storage
      .from(RECEIPTS_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        contentType: file.type || undefined,
        upsert: false
      });

    if (result.error) {
      if (/bucket not found/i.test(String(result.error.message || ""))) {
        throw new Error("Archivio scontrini non configurato su Supabase.");
      }
      throw result.error;
    }

    return path;
  }

  async function removeReceipt(path) {
    if (!path) return null;

    const result = await state.client.storage
      .from(RECEIPTS_BUCKET)
      .remove([path]);

    return result.error || null;
  }

  async function ensureSelectedMonthContext() {
    if (!state.client || !state.user) {
      await loadAuth();
    }

    const selected = readYearMonth();
    const loadedMatches = Boolean(
      state.notaSpese &&
      Number(state.notaSpese.anno) === selected.anno &&
      Number(state.notaSpese.mese) === selected.mese &&
      String(state.notaSpese.user_id || "") === String(state.user.id || "")
    );

    if (!loadedMatches) {
      await ensureTestata();
      await loadRighe();
      await updateTotale();
      renderLista();
    }
  }

  function validateExpenseDate(data) {
    const expectedPrefix = `${state.anno}-${pad2(state.mese)}-`;
    if (!String(data || "").startsWith(expectedPrefix)) {
      throw new Error("La data della spesa deve appartenere al mese selezionato.");
    }
  }

  async function addRiga() {
    if (state.loading) return;

    let uploadedReceiptPath = null;

    try {
      state.loading = true;
      setButtonsDisabled(true);
      setStatus("Salvataggio spesa...", "");

      await ensureSelectedMonthContext();

      const data = document.getElementById("cvlsNotaSpeseData")?.value || "";
      const categoria = document.getElementById("cvlsNotaSpeseCategoria")?.value || "";
      const descrizione = String(document.getElementById("cvlsNotaSpeseDescrizione")?.value || "").trim();
      const importo = Number(document.getElementById("cvlsNotaSpeseImporto")?.value || 0);
      const metodo = document.getElementById("cvlsNotaSpeseMetodo")?.value || "";
      const note = String(document.getElementById("cvlsNotaSpeseNote")?.value || "").trim();
      const receiptFile = getReceiptFile();

      if (!data) throw new Error("Inserisci la data della spesa.");
      if (!categoria) throw new Error("Seleziona una categoria.");
      if (!descrizione) throw new Error("Inserisci una descrizione.");
      if (!importo || importo <= 0) throw new Error("Inserisci un importo valido.");

      validateExpenseDate(data);
      validateReceipt(receiptFile);

      if (receiptFile) {
        setStatus("Caricamento scontrino...", "");
        uploadedReceiptPath = await uploadReceipt(receiptFile);
      }

      const result = await state.client
        .from("note_spese_righe")
        .insert({
          nota_spese_id: state.notaSpese.id,
          user_id: state.user.id,
          data_spesa: data,
          categoria: categoria,
          descrizione: descrizione,
          importo: importo,
          metodo_pagamento: metodo || null,
          note: note || null,
          scontrino_path: uploadedReceiptPath
        })
        .select("*")
        .single();

      if (result.error) throw result.error;

      clearForm();
      await loadRighe();
      await updateTotale();
      renderLista();

      setStatus("Spesa aggiunta correttamente.", "ok");
    } catch (error) {
      if (uploadedReceiptPath && state.client) {
        const cleanupError = await removeReceipt(uploadedReceiptPath);
        if (cleanupError) {
          console.warn("CVLS Nota Spese - pulizia scontrino non completata:", cleanupError);
        }
      }

      console.error("CVLS Nota Spese - errore salvataggio:", error);

      const errorMessage = error.message || "Errore durante il salvataggio della spesa.";
      setStatus("", "");

      if (typeof window.cvlsAlert === "function") {
        window.cvlsAlert(errorMessage, "Nota Spese");
      } else {
        window.alert(errorMessage);
      }
    } finally {
      state.loading = false;
      setButtonsDisabled(false);
    }
  }

  async function openReceipt(id) {
    if (!id || state.loading) return;

    const row = state.righe.find(function (item) {
      return String(item.id) === String(id);
    });

    if (!row || !row.scontrino_path) {
      setStatus("Scontrino non disponibile.", "error");
      return;
    }

    try {
      state.loading = true;
      setButtonsDisabled(true);
      setStatus("Apertura scontrino...", "");

      const result = await state.client.storage
        .from(RECEIPTS_BUCKET)
        .createSignedUrl(row.scontrino_path, 120);

      if (result.error) throw result.error;

      const signedUrl = result.data?.signedUrl || result.data?.signedURL || "";
      if (!signedUrl) throw new Error("Link dello scontrino non disponibile.");

      const browserPlugin = window.Capacitor?.Plugins?.Browser;
      if (browserPlugin && typeof browserPlugin.open === "function") {
        await browserPlugin.open({ url: signedUrl });
      } else {
        const opened = window.open(signedUrl, "_blank", "noopener,noreferrer");
        if (!opened) window.location.href = signedUrl;
      }

      setStatus("Scontrino aperto.", "ok");
    } catch (error) {
      console.error("CVLS Nota Spese - errore apertura scontrino:", error);
      setStatus(error.message || "Errore durante l'apertura dello scontrino.", "error");
    } finally {
      state.loading = false;
      setButtonsDisabled(false);
    }
  }

  async function deleteRiga(id) {
    if (!id || state.loading) return;

    const message = "Vuoi eliminare questa spesa? Verrà eliminato anche l'eventuale scontrino allegato.";

    if (typeof window.cvlsConfirm === "function") {
      window.cvlsConfirm(message, function () {
        deleteRigaConfirmed(id);
      });
      return;
    }

    if (window.confirm(message)) {
      await deleteRigaConfirmed(id);
    }
  }

  async function deleteRigaConfirmed(id) {
    const row = state.righe.find(function (item) {
      return String(item.id) === String(id);
    });

    try {
      state.loading = true;
      setButtonsDisabled(true);
      setStatus("Eliminazione spesa...", "");

      const result = await state.client
        .from("note_spese_righe")
        .delete()
        .eq("id", id)
        .eq("user_id", state.user.id);

      if (result.error) throw result.error;

      let cleanupWarning = false;
      if (row?.scontrino_path) {
        const cleanupError = await removeReceipt(row.scontrino_path);
        if (cleanupError) {
          cleanupWarning = true;
          console.warn("CVLS Nota Spese - scontrino non eliminato dallo Storage:", cleanupError);
        }
      }

      await loadRighe();
      await updateTotale();
      renderLista();

      setStatus(
        cleanupWarning
          ? "Spesa eliminata. Pulizia dello scontrino non completata."
          : "Spesa eliminata correttamente.",
        cleanupWarning ? "error" : "ok"
      );
    } catch (error) {
      console.error("CVLS Nota Spese - errore eliminazione:", error);
      setStatus(error.message || "Errore durante l'eliminazione della spesa.", "error");
    } finally {
      state.loading = false;
      setButtonsDisabled(false);
    }
  }

  async function init() {
    const root = getRoot();
    if (!root) return;

    if (!state.initialized) {
      await renderBase();
      state.initialized = true;
    }

    await loadCurrentMonth();
  }

  window.CvlsNotaSpese = {
    init: init,
    loadCurrentMonth: loadCurrentMonth
  };
})();

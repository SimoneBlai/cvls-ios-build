/* =========================================================
   CVLS - Nota Spese
   File dedicato: pages/nota-spese/nota-spese.js
   Prompt 13B: pagina base collegata a Supabase
   ========================================================= */

(function () {
  "use strict";

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
      "cvlsNotaSpesePulisciBtn"
    ].forEach(function (id) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !!disabled;
    });
  }

  function readYearMonth() {
    const anno = Number(document.getElementById("cvlsNotaSpeseAnno")?.value || 0);
    const mese = Number(document.getElementById("cvlsNotaSpeseMese")?.value || 0);

    if (!anno || anno < 2020 || anno > 2100) {
      throw new Error("Anno non valido.");
    }

    if (!mese || mese < 1 || mese > 12) {
      throw new Error("Mese non valido.");
    }

    state.anno = anno;
    state.mese = mese;
  }

  async function renderBase() {
    const root = getRoot();
    if (!root) return;

    const response = await fetch(
      "pages/nota-spese/nota-spese.html?v=1",
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

    if ((!nomeTecnico || nomeTecnico.includes("@")) && window.CvlsSupabase && typeof window.CvlsSupabase.getProfile === "function") {
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
      return `
        <tr>
          <td>${formatDateIt(row.data_spesa)}</td>
          <td>${escapeHtml(row.categoria || "")}</td>
          <td>${escapeHtml(row.descrizione || "")}</td>
          <td>${formatEuro(row.importo)}</td>
          <td>${escapeHtml(row.metodo_pagamento || "")}</td>
          <td>${row.scontrino_path ? "Presente" : "Non allegato"}</td>
          <td>
            <button class="cvls-nota-spese-button cvls-nota-spese-button-danger cvls-nota-spese-button-small" type="button" data-cvls-nota-spese-delete="${row.id}">Elimina</button>
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
    const note = document.getElementById("cvlsNotaSpeseNote");

    if (data) data.value = todayIso();
    if (categoria) categoria.value = "";
    if (descrizione) descrizione.value = "";
    if (importo) importo.value = "";
    if (metodo) metodo.value = "";
    if (note) note.value = "";
  }

  async function addRiga() {
    if (state.loading) return;

    try {
      state.loading = true;
      setButtonsDisabled(true);
      setStatus("Salvataggio spesa...", "");

      if (!state.notaSpese) {
        await loadAuth();
        readYearMonth();
        await ensureTestata();
      }

      const data = document.getElementById("cvlsNotaSpeseData")?.value || "";
      const categoria = document.getElementById("cvlsNotaSpeseCategoria")?.value || "";
      const descrizione = String(document.getElementById("cvlsNotaSpeseDescrizione")?.value || "").trim();
      const importo = Number(document.getElementById("cvlsNotaSpeseImporto")?.value || 0);
      const metodo = document.getElementById("cvlsNotaSpeseMetodo")?.value || "";
      const note = String(document.getElementById("cvlsNotaSpeseNote")?.value || "").trim();

      if (!data) throw new Error("Inserisci la data della spesa.");
      if (!categoria) throw new Error("Seleziona una categoria.");
      if (!descrizione) throw new Error("Inserisci una descrizione.");
      if (!importo || importo <= 0) throw new Error("Inserisci un importo valido.");

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
          note: note || null
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
      console.error("CVLS Nota Spese - errore salvataggio:", error);
      setStatus(error.message || "Errore durante il salvataggio della spesa.", "error");
    } finally {
      state.loading = false;
      setButtonsDisabled(false);
    }
  }

  async function deleteRiga(id) {
    if (!id || state.loading) return;

    const message = "Vuoi eliminare questa spesa?";

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

      await loadRighe();
      await updateTotale();
      renderLista();

      setStatus("Spesa eliminata correttamente.", "ok");
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

/* =========================================================
   CVLS - APP OFFLINE FIRST
   File unico ordinato:
   1. Stato / storage
   2. Avvio e binding eventi
   3. Autorizzazione dispositivo
   4. Sincronizzazione
   5. Archivio
   6. Dispositivi / schede
   7. Manutenzione
   8. Sensore O2
   9. Ricerca / menu / QR
   10. Utility
========================================================= */

const STORAGE_KEYS = {
  AUTH_STATUS: "cvls_auth_status",
  DEVICE_IDENTIFIER: "cvls_device_identifier",
  DEVICE_KEY: "cvls_device_key",
  LAST_SYNC: "cvls_last_sync",
  DATA: "cvls_local_data",
  PENDING_CHANGES: "cvls_pending_changes"
};

const AUTH_STATUS = {
  NONE: "none",
  PENDING: "in_attesa",
  AUTHORIZED: "autorizzato",
  REFUSED: "rifiutato",
  REVOKED: "revocato",
  NOT_AUTHORIZED: "non_autorizzato",
  DELETED: "eliminato"
};

const LOGO_URL = "file:///android_asset/logo_cavaletto.png";
const CVLS_TIPOLOGIE_CELLA_STORAGE_KEY = "cvls_tipologie_cella";

const campiTecnici = [
  ["dispositivo", "Dispositivo"],
  ["marca", "Marca"],
  ["modello", "Modello"],
  ["matricola", "Matricola"],
  ["anno", "Anno"],
  ["alimentazione", "Alimentazione"],
  ["kilowatt", "KW"]
];

const tipiDispositivoTecnico = [
  "POMPA",
  "COMPRESSORE",
  "CATENA FILTRANTE",
  "ESSICCATORE",
  "FILTRO BATTERICO",
  "FILTRO COALESCENTE",
  "FILTRO SEPARATORE",
  "IGROMETRO",
  "RIDUTTORE",
  "PRESA O2"
];

let dati = createEmptyData();

let selezione = {
  citta: null,
  presidio: null,
  ubicazione: null
};

let currentDeviceId = "";
let currentDeviceData = null;
let currentUserProfile = null; // Profilo Supabase dell'utente loggato

let isLoggedTecnica = false;

/*
 * Nessuna password nella pagina 2.
 * I campi di inserimento vengono aperti
 * e chiusi tramite i pulsanti + / −.
 */
let isLoggedStorico = false;
let isLoggedNoteMateriali = true;

let isLoggedCvls = false;
let isEditingCvls = false;

let deleteModeNote = false;
let deleteModeMateriali = false;
let deleteModeAllegati = false;

const CVLS_SYNC_WATCHDOG_MS = 15 * 60 * 1000;

let cvlsSyncInProgress = false;
let cvlsStartupDownloadSyncRunning = false;
let cvlsAttendanceAutoSyncRunning = false;
let cvlsAttendanceAutoSyncTimer = null;
let cvlsSyncWatchdogTimer = null;
let cvlsActiveSyncSnapshot = {};
let cvlsAttachmentSelectionContext = null;
/*
 * Cronologia delle pagine lasciate usando la navigazione indietro.
 * Permette lo swipe opposto per tornare avanti.
 */
let cvlsForwardHistory = [];
let cvlsRestoringNavigation = false;

document.addEventListener("DOMContentLoaded", initApp);

/* =========================
   AVVIO
========================= */

async function initApp() {
  // Configurazione nativa della barra di stato tramite plugin Capacitor
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) {
    const StatusBar = window.Capacitor.Plugins.StatusBar;
    StatusBar.setOverlaysWebView({ overlay: false }).catch(e => console.warn(e));
    StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(e => console.warn(e));
    StatusBar.setStyle({ style: "LIGHT" }).catch(e => console.warn(e));
  }

  bindEvents();
  abilitaPassaggioScrollArchivio();
  abilitaPassaggioScrollTabelleStorico();

  setSyncInteractionBlocked(false);
  loadLocalData();

  // --- Gestione QR scansionato ---
  // Se l'URL contiene ?device=CODICE, l'app è stata aperta scansionando un QR
  const urlParams = new URLSearchParams(window.location.search);
  const deviceCode = urlParams.get("device");

  if (deviceCode) {
    const codicePulito = format11(deviceCode);
    // Salva il codice pending così se l'utente fa login dopo, apre direttamente la scheda
    localStorage.setItem("cvls_pending_qr_open", codicePulito);

    // Controlla se già autorizzato (app installata e loggata)
    await checkStartupAuthorization();

    if (localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) === AUTH_STATUS.AUTHORIZED) {
      // Utente con app e loggato → apri direttamente la scheda del dispositivo
      openPendingQrIfPresent();
      syncDownloadOnlyOnStartup().catch(e => console.error("Errore sync avvio:", e));
    } else {
      // Utente senza app o non loggato → mostra pagina pubblica
      mostraSchedaPubblica(codicePulito);
    }
    return;
  }

  await checkStartupAuthorization();
  updateTopbarLeftButton();

  if (localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) === AUTH_STATUS.AUTHORIZED) {
    syncDownloadOnlyOnStartup().catch(e => console.error("Errore sync avvio:", e));
  }
}


function bindEvents() {
  bind("loginBtn", "click", loginWithSupabase);
  bind("logoutBtn", "click", logoutWithSupabase);

  bind("openMenuBtn", "click", handleTopbarLeftClick);
  bind("closeMenuBtn", "click", closeSideMenu);
  bind("sideOverlay", "click", closeSideMenu);

  bind("openAdminBollatureBtn", "click", openAdminBollature);
  
  bind("sideOpenRegistroPresenzeBtn", "click", openRegistroPresenzePage);
  bind("sideOpenNotaSpeseBtn", "click", () => cvlsShowPage("pageNotaSpese", "Nota Spese"));
  bind("sideOpenDocumentiBtn", "click", () => cvlsShowPage("pageDocumenti", "Documenti"));
  bind("sideOpenNoteBtn", "click", () => cvlsShowPage("pageNote", "Note"));
  bind("sideOpenImpostazioniBtn", "click", () => cvlsShowPage("pageImpostazioni", "Impostazioni"));

  bind("regPresIngressoBtn", "click", () => {
    if (window.CvlsGeobollatura && typeof window.CvlsGeobollatura.registraIngressoRegistroPresenze === "function") {
      window.CvlsGeobollatura.registraIngressoRegistroPresenze();
    }
  });
  bind("regPresUscitaBtn", "click", () => {
    if (window.CvlsGeobollatura && typeof window.CvlsGeobollatura.registraUscitaRegistroPresenze === "function") {
      window.CvlsGeobollatura.registraUscitaRegistroPresenze();
    }
  });
  bind("regPresVisualizzaBtn", "click", openRegPresListModal);
  bind("closeRegPresListBtn", "click", closeRegPresListModal);
  bind("regPresVisualizzaFoglioOreBtn", "click", visualizzaRegistroPresenzeFoglioOre);
  bind("regPresGeneraFoglioOreBtn", "click", generaRegistroPresenzeFoglioOrePdf);

  bind("closeAdminBollatureBtn", "click", closeAdminBollature);
  bind("adminAddCantiereBtn", "click", adminAddCantiere);
  bind("cancelEditTechBtn", "click", closeEditTechLocation);
  bind("confirmEditTechBtn", "click", saveTechLocation);
  bind("editTechSearchAddr", "input", handleTechSearchAddressInput);

  bind("syncBtn", "click", syncApp);
  bind("searchBtn", "click", openSearch);
  bind("closeSearchBtn", "click", closeSearch);
  bind("globalSearchInput", "input", renderSearchResults);

  bind("cercaCitta", "input", renderCitta);
  bind("cercaPresidio", "input", renderPresidi);
  bind("cercaUbicazione", "input", renderUbicazioni);
  bind("cercaDispositivo", "input", renderDispositivi);

  bind("addCittaBtn", "click", addCitta);
  bind("addPresidioBtn", "click", addPresidio);
  bind("addUbicazioneBtn", "click", addUbicazione);

  bind("openAddDispositivoBtn", "click", openAddDispositivoModal);
  bind("closeDispositivoModalBtn", "click", closeAddDispositivoModal);
  bind("cancelAddDispositivoBtn", "click", closeAddDispositivoModal);
  bind("confirmAddDispositivoBtn", "click", addDispositivoFromModal);

  bind("backArchivioBtn", "click", cvlsNavigateBack);
  bind("openTecnicaBtn", "click", abilitaModificaTecnica);
  bind("saveTecnicaBtn", "click", saveTecnica);


  bind("goStoricoBtn", "click", () => goDeviceSubpage(2));
  bind("goTecnicaBtn", "click", () => goDeviceSubpage(1));

  bind("loginStoricoBtn", "click", toggleStoricoEditor);
  bind("addManutenzioneBtn", "click", addManutenzione);

  bind("programmaManutenzioneBtn", "click", openProgrammaManutenzione);
  bind("chiudiProgrammaBtn", "click", closeProgrammaManutenzione);
  bind("confermaProgrammaBtn", "click", confermaProgrammaManutenzione);

  bind("toggleNoteEditorBtn", "click", toggleNoteEditor);
  bind("addNotaBtn", "click", addNota);


  bind("toggleMaterialiEditorBtn", "click", toggleMaterialiEditor);
  bind("addMaterialeBtn", "click", addMateriale);


  bind("toggleAllegatiEditorBtn", "click", toggleAllegatiEditor);
  bind("addAllegatoBtn", "click", addAllegato);
  bind("captureAllegatoBtn", "click", captureAllegatoPhoto);


  bind("loginCvlsBtn", "click", loginCvls);
  bind("saveCvlsBtn", "click", saveCvls);
  bind("pulisciFirmaBtn", "click", pulisciFirma);
}

function bind(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

/* =========================
   AUTORIZZAZIONE / AUTH SUPABASE
========================= */

function showAuthScreen() {
  document.getElementById("authScreen").classList.add("active");
  document.getElementById("mainApp").classList.remove("active");
}

function showMainApp() {
  document.getElementById("authScreen").classList.remove("active");
  document.getElementById("mainApp").classList.add("active");

  hideWaitingAuthModal();
  updateStatusBox();
  updateSideMenuInfo();
  updateRegistroPresenzeTecnicoBox();
  renderArchivio();
  openPendingQrIfPresent();

  window.setTimeout(function () {
    cvlsShowTecnicoIdentityPopupIfNeeded();
  }, 120);

  // Toggle admin area in side menu
  const adminBtn = document.getElementById("openAdminBollatureBtn");
  if (adminBtn) {
    const role = localStorage.getItem("cvls_user_role");
    if (role === "admin") {
      adminBtn.classList.remove("hidden");
    } else {
      adminBtn.classList.add("hidden");
    }
  }
  updateTopbarLeftButton();
}

function setAuthInfo(msg) {
  const box = document.getElementById("authInfoBox");
  if (!box) return;
  if (msg) {
    box.textContent = msg;
    box.classList.remove("hidden");
  } else {
    box.textContent = "";
    box.classList.add("hidden");
  }
}

function cvlsGetNomeTecnicoUfficiale() {
  return String(localStorage.getItem("cvls_user_name") || "").trim();
}

function cvlsIsNomeTecnicoValido(nome) {
  const value = String(nome || "").trim();
  const email = String(localStorage.getItem("cvls_user_email") || "").trim().toLowerCase();

  if (value.length < 3) {
    return false;
  }

  if (value.indexOf("@") >= 0) {
    return false;
  }

  if (email && value.toLowerCase() === email) {
    return false;
  }

  return true;
}

function cvlsGetTecnicoIdentitySessionKey() {
  return [
    String(localStorage.getItem("cvls_user_email") || "").trim().toLowerCase(),
    cvlsGetNomeTecnicoUfficiale()
  ].join("|");
}

function updateRegistroPresenzeTecnicoBox() {
  const tecnicoEl = document.getElementById("regPresTecnicoNome");

  if (!tecnicoEl) {
    return;
  }

  const nomeTecnico = cvlsGetNomeTecnicoUfficiale();

  if (cvlsIsNomeTecnicoValido(nomeTecnico)) {
    tecnicoEl.textContent = nomeTecnico;
    tecnicoEl.style.color = "var(--blue-dark)";
  } else {
    tecnicoEl.textContent = "Nome tecnico non configurato";
    tecnicoEl.style.color = "#b91c1c";
  }
}

function cvlsShowNomeTecnicoNonConfiguratoAlert() {
  cvlsAlert(
    "Nome tecnico non configurato.\nContattare l'amministratore per aggiornare il profilo su Supabase.",
    "Identità tecnico"
  );
}

function cvlsShowTecnicoIdentityPopupIfNeeded() {
  if (localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) !== AUTH_STATUS.AUTHORIZED) {
    return;
  }

  const nomeTecnico = cvlsGetNomeTecnicoUfficiale();
  const sessionKey = cvlsGetTecnicoIdentitySessionKey();

  updateRegistroPresenzeTecnicoBox();

  if (!cvlsIsNomeTecnicoValido(nomeTecnico)) {
    if (sessionStorage.getItem("cvls_tecnico_identity_invalid_warned_session") === sessionKey) {
      return;
    }

    sessionStorage.setItem("cvls_tecnico_identity_invalid_warned_session", sessionKey);
    cvlsShowNomeTecnicoNonConfiguratoAlert();
    return;
  }

  if (sessionStorage.getItem("cvls_tecnico_identity_confirmed_session") === sessionKey) {
    return;
  }

  cvlsAlert(
    "Tecnico:\n" + nomeTecnico + "\n\nQuesta app è associata al registro ore personale del tecnico autenticato.",
    "Identità tecnico"
  );

  const okBtn = document.getElementById("cvlsDialogOk");
  if (okBtn) {
    okBtn.textContent = "Conferma";
  }

  sessionStorage.setItem("cvls_tecnico_identity_confirmed_session", sessionKey);
}

function canOpenRegistroPresenze() {
  const nomeTecnico = cvlsGetNomeTecnicoUfficiale();
  updateRegistroPresenzeTecnicoBox();

  if (cvlsIsNomeTecnicoValido(nomeTecnico)) {
    return true;
  }

  cvlsShowNomeTecnicoNonConfiguratoAlert();
  return false;
}

function openRegistroPresenzePage() {
  if (!canOpenRegistroPresenze()) {
    closeSideMenu();
    return;
  }

  cvlsShowPage("pageRegistroPresenze", "Registro Presenze");
}

async function checkStartupAuthorization() {
  setAuthInfo("Verifica sessione attiva...");
  try {
    const user = await window.CvlsSupabase.getUser();
    if (user) {
      currentUserProfile = await window.CvlsSupabase.getProfile(user.id);
      if (currentUserProfile) {
        localStorage.setItem(STORAGE_KEYS.AUTH_STATUS, AUTH_STATUS.AUTHORIZED);
        localStorage.setItem("cvls_user_email", user.email);
        localStorage.setItem("cvls_user_name", String(currentUserProfile.nome_tecnico || "").trim());
        localStorage.setItem("cvls_user_role", currentUserProfile.ruolo);
        localStorage.setItem("cvls_bollatura_nome_sede", currentUserProfile.bollatura_nome_sede || "Ozegna (Sede)");
        localStorage.setItem("cvls_bollatura_latitudine", currentUserProfile.bollatura_latitudine !== null && currentUserProfile.bollatura_latitudine !== undefined ? currentUserProfile.bollatura_latitudine : 45.3496);
        localStorage.setItem("cvls_bollatura_longitudine", currentUserProfile.bollatura_longitudine !== null && currentUserProfile.bollatura_longitudine !== undefined ? currentUserProfile.bollatura_longitudine : 7.7470);
        localStorage.setItem("cvls_bollatura_raggio", currentUserProfile.bollatura_raggio !== null && currentUserProfile.bollatura_raggio !== undefined ? currentUserProfile.bollatura_raggio : 200);
        showMainApp();
        return;
      }
    }
  } catch (error) {
    console.error("Errore verifica sessione:", error);
  }
  
  localStorage.setItem(STORAGE_KEYS.AUTH_STATUS, AUTH_STATUS.NONE);
  showAuthScreen();
  setAuthInfo("");
}

async function loginWithSupabase() {
  const emailEl = document.getElementById("loginEmail");
  const passwordEl = document.getElementById("loginPassword");
  const loginBtn = document.getElementById("loginBtn");

  const email = emailEl ? emailEl.value.trim() : "";
  const password = passwordEl ? passwordEl.value : "";

  if (!email || !password) {
    alert("Inserisci email e password.");
    return;
  }

  if (loginBtn) loginBtn.disabled = true;
  setAuthInfo("Accesso in corso...");

  try {
    const result = await window.CvlsSupabase.login(email, password);
    const user = result.user;
    currentUserProfile = await window.CvlsSupabase.getProfile(user.id);

    if (!currentUserProfile) {
      throw new Error("Profilo utente non configurato su database.");
    }

    localStorage.setItem(STORAGE_KEYS.AUTH_STATUS, AUTH_STATUS.AUTHORIZED);
    localStorage.setItem("cvls_user_email", user.email);
    localStorage.setItem("cvls_user_name", String(currentUserProfile.nome_tecnico || "").trim());
    localStorage.setItem("cvls_user_role", currentUserProfile.ruolo);
    localStorage.setItem("cvls_bollatura_nome_sede", currentUserProfile.bollatura_nome_sede || "Ozegna (Sede)");
    localStorage.setItem("cvls_bollatura_latitudine", currentUserProfile.bollatura_latitudine !== null && currentUserProfile.bollatura_latitudine !== undefined ? currentUserProfile.bollatura_latitudine : 45.3496);
    localStorage.setItem("cvls_bollatura_longitudine", currentUserProfile.bollatura_longitudine !== null && currentUserProfile.bollatura_longitudine !== undefined ? currentUserProfile.bollatura_longitudine : 7.7470);
    localStorage.setItem("cvls_bollatura_raggio", currentUserProfile.bollatura_raggio !== null && currentUserProfile.bollatura_raggio !== undefined ? currentUserProfile.bollatura_raggio : 200);

    showMainApp();
  } catch (error) {
    setAuthInfo(error.message || "Errore durante il login.");
    alert(error.message || "Email o password errati.");
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

function logoutWithSupabase() {
  cvlsConfirm(
    "Sei sicuro di voler effettuare il logout?",
    async function () {
      try {
        await window.CvlsSupabase.logout();
      } catch (e) {
        console.warn("Errore durante logout Supabase:", e);
      }
      
      localStorage.removeItem(STORAGE_KEYS.AUTH_STATUS);
      localStorage.removeItem("cvls_user_email");
      localStorage.removeItem("cvls_user_name");
      localStorage.removeItem("cvls_user_role");
      currentUserProfile = null;
      sessionStorage.removeItem("cvls_tecnico_identity_confirmed_session");
      sessionStorage.removeItem("cvls_tecnico_identity_invalid_warned_session");

      closeSideMenu();
      showAuthScreen();
      setAuthInfo("");

      const emailEl = document.getElementById("loginEmail");
      const passwordEl = document.getElementById("loginPassword");
      if (emailEl) emailEl.value = "";
      if (passwordEl) passwordEl.value = "";
    },
    null,
    "Disconnetti"
  );
}

function showWaitingAuthModal() {
  document.getElementById("waitingAuthModal").classList.remove("hidden");
}

function hideWaitingAuthModal() {
  document.getElementById("waitingAuthModal").classList.add("hidden");
}

function bloccaAccessoNonAutorizzato(message) {
  localStorage.setItem(STORAGE_KEYS.PENDING_CHANGES, JSON.stringify([]));
  localStorage.removeItem(STORAGE_KEYS.DATA);
  dati = createEmptyData();
  selezione = { citta: null, presidio: null, ubicazione: null };
  currentDeviceId = "";
  currentDeviceData = null;
  updateStatusBox();

  localStorage.setItem(STORAGE_KEYS.AUTH_STATUS, AUTH_STATUS.NONE);
  showAuthScreen();
  setAuthInfo(message || "Utente non autorizzato.");
  updateSideMenuInfo();
  cvlsAlert(message || "Utente non autorizzato.", "Sessione scaduta");
}

function bloccaAccessoEliminato(message) {
  bloccaAccessoNonAutorizzato(message || "Autorizzazione non valida.");
}

/* =========================
   SINCRONIZZAZIONE
========================= */

function endAttendanceAutoSyncAttempt() {
  cvlsAttendanceAutoSyncRunning = false;

  clearTimeout(cvlsAttendanceAutoSyncTimer);
  cvlsAttendanceAutoSyncTimer = null;

  cvlsSyncInProgress = false;
  cvlsActiveSyncSnapshot = {};

  setSyncInteractionBlocked(false);
}

function getPendingBollatureForAutoSync() {
  const pending = preparePendingChangesForSync();

  return pending.filter(function (change) {
    return change && change.type === "ADD_BOLLATURA";
  });
}

function handleAttendanceAutoSyncResult(result) {
  if (!cvlsAttendanceAutoSyncRunning) {
    return false;
  }

  if (result && result.offline) {
    endAttendanceAutoSyncAttempt();
    updateStatusBox();
    showCvlsToast("Bollatura salvata offline");
    return true;
  }

  if (result && result.authState) {
    endAttendanceAutoSyncAttempt();

    const stato = normalizzaStatoAutorizzazioneApp(result.authState);

    if (stato === AUTH_STATUS.DELETED) {
      bloccaAccessoEliminato(
        result.message || "Autorizzazione eliminata dal database. Invia una nuova richiesta."
      );
      return true;
    }

    bloccaAccessoNonAutorizzato(
      result.message || "Utente non autorizzato."
    );

    return true;
  }

  const confirmedChangeIds =
    Array.isArray(result && result.confirmedChangeIds)
      ? result.confirmedChangeIds
      : (
        result && result.ok
          ? Object.keys(cvlsActiveSyncSnapshot || {})
          : []
      );

  const confirmedCount =
    removeConfirmedSyncSnapshotChanges(
      confirmedChangeIds
    );

  endAttendanceAutoSyncAttempt();
  updateStatusBox();

  if (typeof renderRegistroPresenzeList === "function") {
    renderRegistroPresenzeList();
  }

  if (!result || !result.ok) {
    if (confirmedCount > 0) {
      showCvlsToast("Bollatura sincronizzata parzialmente");
    } else {
      showCvlsToast("Bollatura salvata offline");
    }

    return true;
  }

  if (confirmedCount > 0) {
    showCvlsToast(
      confirmedCount === 1
        ? "Bollatura sincronizzata"
        : "Bollature sincronizzate"
    );
  } else {
    showCvlsToast("Nessuna bollatura da sincronizzare");
  }

  return true;
}

function syncPendingBollatureOnlyAuto() {
  const status =
    localStorage.getItem(STORAGE_KEYS.AUTH_STATUS);

  if (status !== AUTH_STATUS.AUTHORIZED) {
    return;
  }

  if (cvlsStartupDownloadSyncRunning) {
    window.setTimeout(syncPendingBollatureOnlyAuto, 3000);
    return;
  }

  if (cvlsSyncInProgress) {
    window.setTimeout(syncPendingBollatureOnlyAuto, 3000);
    return;
  }

  const pendingBollature = getPendingBollatureForAutoSync();

  if (pendingBollature.length === 0) {
    return;
  }

  captureActiveSyncSnapshot(pendingBollature);
  cvlsAttendanceAutoSyncRunning = true;
  cvlsSyncInProgress = true;

  clearTimeout(cvlsAttendanceAutoSyncTimer);
  cvlsAttendanceAutoSyncTimer = window.setTimeout(
    function () {
      if (!cvlsAttendanceAutoSyncRunning) {
        return;
      }

      endAttendanceAutoSyncAttempt();
      updateStatusBox();
      showCvlsToast("Bollatura salvata offline");
    },
    60000
  );

  if (
    window.AndroidBridge &&
    typeof window.AndroidBridge.syncDatabase === "function"
  ) {
    window.AndroidBridge.syncDatabase(
      JSON.stringify(pendingBollature),
      ""
    );

    return;
  }

  if (
    window.CvlsApi &&
    typeof window.CvlsApi.syncDatabase === "function"
  ) {
    window.CvlsApi.syncDatabase({
      pending: pendingBollature,
      deviceKey: ""
    })
      .then(function (result) {
        window.onAndroidSyncResult(JSON.stringify(result));
      })
      .catch(function () {
        endAttendanceAutoSyncAttempt();
        updateStatusBox();
        showCvlsToast("Bollatura salvata offline");
      });

    return;
  }

  endAttendanceAutoSyncAttempt();
  updateStatusBox();
  showCvlsToast("Bollatura salvata offline");
}

window.syncPendingBollatureOnlyAuto = syncPendingBollatureOnlyAuto;

function syncApp() {
  pulisciRichiesteEliminazioneAllegatoSenzaLink();
  const status =
    localStorage.getItem(STORAGE_KEYS.AUTH_STATUS);

  if (status !== AUTH_STATUS.AUTHORIZED) {
    checkStartupAuthorization();
    return;
  }

  if (cvlsSyncInProgress) {
    showCvlsToast("Sincronizzazione già in corso");
    return;
  }

  if (cvlsStartupDownloadSyncRunning) {
    showCvlsToast("Aggiornamento iniziale in corso. Attendi...");
    return;
  }

  updateSyncProgress(0, "Preparazione dati");
  const pending = preparePendingChangesForSync();

  captureActiveSyncSnapshot(pending);
  cvlsSyncInProgress = true;

  startSyncUI();
  updateSyncProgress(10, "Controllo modifiche locali");
  simulateSyncProgressUntilResponse();
  startSyncWatchdog();

  if (
    window.AndroidBridge &&
    typeof window.AndroidBridge.syncDatabase === "function"
  ) {
    updateSyncProgress(
      25,
      "Invio dati"
    );

    window.AndroidBridge.syncDatabase(
      JSON.stringify(pending),
      ""
    );

    return;
  }

  if (
    window.CvlsApi &&
    typeof window.CvlsApi.syncDatabase === "function"
  ) {
    updateSyncProgress(
      25,
      "Invio dati"
    );

    window.CvlsApi.syncDatabase({
      pending: pending,
      deviceKey: ""
    })
      .then(function (result) {
        window.onAndroidSyncResult(JSON.stringify(result));
      })
      .catch(function (error) {
        window.onAndroidSyncError(
          error && error.message
            ? error.message
            : "Errore sincronizzazione API."
        );
      });

    return;
  }

  endSyncAttempt();
  stopSyncProgressSimulation();
  failSyncUI("Collegamento API non disponibile");
}

async function syncDownloadOnlyOnStartup() {
  const status = localStorage.getItem(STORAGE_KEYS.AUTH_STATUS);
  if (status !== AUTH_STATUS.AUTHORIZED) {
    return;
  }

  if (cvlsSyncInProgress || cvlsStartupDownloadSyncRunning) {
    return;
  }

  cvlsStartupDownloadSyncRunning = true;
  const pendingBefore = localStorage.getItem(STORAGE_KEYS.PENDING_CHANGES);

  try {
    if (typeof fetchCompleteDatabaseFromSupabase !== "function") {
      console.warn("fetchCompleteDatabaseFromSupabase non disponibile.");
      cvlsStartupDownloadSyncRunning = false;
      return;
    }

    const remoteData = await fetchCompleteDatabaseFromSupabase();

    if (!remoteData) {
      throw new Error("Nessun dato restituito dal database.");
    }

    applyRemoteData(remoteData);

    const currentPending = getPendingChanges();
    reapplyPendingArchiveChanges(currentPending);

    saveLocalData();

    const pendingAfter = localStorage.getItem(STORAGE_KEYS.PENDING_CHANGES);
    if (pendingBefore !== pendingAfter) {
      if (pendingBefore) {
        localStorage.setItem(STORAGE_KEYS.PENDING_CHANGES, pendingBefore);
      } else {
        localStorage.removeItem(STORAGE_KEYS.PENDING_CHANGES);
      }
      reapplyPendingArchiveChanges(getPendingChanges());
      saveLocalData();
    }

    updateStatusBox();
    renderArchivio();

    if (currentDeviceId) {
      if (typeof renderManutenzioni === "function") renderManutenzioni();
      if (typeof renderNote === "function") renderNote();
      if (typeof renderMateriali === "function") renderMateriali();
      if (typeof renderAllegati === "function") renderAllegati();
      if (typeof renderCvls === "function") renderCvls();
    }

    console.log("Sincronizzazione automatica solo download all'avvio completata.");

  } catch (error) {
    console.error("Errore durante la sincronizzazione automatica solo download all'avvio:", error);
  } finally {
    cvlsStartupDownloadSyncRunning = false;
  }
}

function startSyncWatchdog() {
  clearTimeout(cvlsSyncWatchdogTimer);

  cvlsSyncWatchdogTimer = window.setTimeout(
    function () {
      if (!cvlsSyncInProgress) {
        return;
      }

      endSyncAttempt();
      stopSyncProgressSimulation();

      failSyncUI(
        "Sincronizzazione non completata entro 15 minuti. Riprova."
      );
    },
    CVLS_SYNC_WATCHDOG_MS
  );
}

function endSyncAttempt() {
  cvlsSyncInProgress = false;

  clearTimeout(cvlsSyncWatchdogTimer);
  cvlsSyncWatchdogTimer = null;
  cvlsActiveSyncSnapshot = {};

  setSyncInteractionBlocked(false);
}

window.onAndroidAuthorizationRequestResult = function (resultText) {
  let result;

  try {
    result = JSON.parse(resultText);
  } catch (e) {
    pendingAuthRequestLocal = null;

    const requestBtn = document.getElementById("requestAuthBtn");
    if (requestBtn) requestBtn.disabled = false;

    setAuthInfo("Risposta database non valida.");
    alert("Risposta database non valida.");
    return;
  }

  if (result.ok) {
    const requestData = pendingAuthRequestLocal || {};

    const identifier =
      result.identificativoDispositivo ||
      requestData.identificativoDispositivo ||
      getValue("deviceIdentifier").trim();

    const deviceKey =
      result.deviceKey ||
      requestData.deviceKey ||
      "";

    if (!deviceKey) {
      pendingAuthRequestLocal = null;

      const requestBtn = document.getElementById("requestAuthBtn");
      if (requestBtn) requestBtn.disabled = false;

      setAuthInfo("Richiesta inviata ma DeviceKey non ricevuto.");
      alert("Richiesta inviata ma DeviceKey non ricevuto.");
      return;
    }

    localStorage.setItem(STORAGE_KEYS.DEVICE_IDENTIFIER, identifier);
    localStorage.setItem(STORAGE_KEYS.DEVICE_KEY, deviceKey);
    localStorage.setItem(STORAGE_KEYS.AUTH_STATUS, AUTH_STATUS.PENDING);

    pendingAuthRequestLocal = null;

    updateSideMenuInfo();
    aggiornaSchermataAutorizzazione();

    setAuthInfo(
      result.alreadyExists
        ? "Richiesta già presente. Premi Sincronizza per controllare lo stato."
        : "Richiesta inviata. Attendi autorizzazione, poi premi Sincronizza."
    );

    showWaitingAuthModal();
    return;
  }

  pendingAuthRequestLocal = null;

  const requestBtn = document.getElementById("requestAuthBtn");
  if (requestBtn) requestBtn.disabled = false;

  aggiornaSchermataAutorizzazione();

  setAuthInfo(result.message || "Errore invio richiesta.");
  alert(result.message || "Errore invio richiesta.");
};

window.onAndroidAuthorizationCheckResult = function (resultText) {
  handleAuthorizationResult(resultText);
};

window.onAndroidAuthorizationError = function (message) {
  const wasSendingAuthRequest = !!pendingAuthRequestLocal;

  if (wasSendingAuthRequest) {
    pendingAuthRequestLocal = null;

    localStorage.removeItem(STORAGE_KEYS.AUTH_STATUS);
    localStorage.removeItem(STORAGE_KEYS.DEVICE_KEY);

    const requestBtn = document.getElementById("requestAuthBtn");
    if (requestBtn) requestBtn.disabled = false;

    hideWaitingAuthModal();
    aggiornaSchermataAutorizzazione();
  }

  if (cvlsSyncInProgress) {
    endSyncAttempt();
  }

  stopSyncProgressSimulation();
  failSyncUI(message || "Autorizzazione Google non completata.");

  setAuthInfo(message || "Autorizzazione Google non completata.");
  alert(message || "Autorizzazione Google non completata.");
};


window.onAndroidAttachmentProgress = function (resultText) {
  let progress;

  try {
    progress =
      typeof resultText === "string"
        ? JSON.parse(resultText)
        : resultText;
  } catch (error) {
    return;
  }

  const current = Math.max(1, Number(progress.current) || 1);
  const total = Math.max(current, Number(progress.total) || current);
  const percent = Math.min(
    94,
    40 + Math.round((current / total) * 50)
  );

  stopSyncProgressSimulation();

  updateSyncProgress(
    percent,
    progress.label || ("Allegato " + current + " di " + total)
  );
};

window.onAndroidAttachmentsSelected = function (resultText) {
  let result;

  try {
    result =
      typeof resultText === "string"
        ? JSON.parse(resultText)
        : resultText;
  } catch (error) {
    cvlsAttachmentSelectionContext = null;
    cvlsAlert(
      "Risposta del selettore allegati non valida.",
      "Errore allegati"
    );
    return;
  }

  const context = cvlsAttachmentSelectionContext || {};
  cvlsAttachmentSelectionContext = null;

  const rawDeviceId =
    context.deviceId ||
    currentDeviceId ||
    "";

  if (!String(rawDeviceId).trim()) {
    deleteImportedNativeFiles(result.files);
    cvlsAlert(
      "Scheda dispositivo non disponibile.",
      "Errore allegati"
    );
    return;
  }

  const deviceId = format11(rawDeviceId);
  const files = Array.isArray(result.files) ? result.files : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];

  if (!Array.isArray(dati.allegati[deviceId])) {
    dati.allegati[deviceId] = [];
  }

  const pending = getPendingChanges();
  const pendingBefore = pending.slice();
  const localLengthBefore = dati.allegati[deviceId].length;
  const now = new Date().toISOString();
  let addedCount = 0;

  files.forEach(function (file) {
    const syncId = String(file && file.syncId || "").trim();
    const localFileId = String(file && file.localFileId || "").trim();

    if (!syncId || !localFileId) {
      return;
    }

    const alreadyLocal = dati.allegati[deviceId].some(function (item) {
      return item && item.syncId === syncId;
    });

    const alreadyPending = pending.some(function (change) {
      return (
        change &&
        change.type === "ADD_ALLEGATO" &&
        getAttachmentChangeSyncId(change) === syncId
      );
    });

    if (alreadyLocal || alreadyPending) {
      return;
    }

    const nomeFile =
      String(file.nomeFile || file.nomeOriginale || "Allegato").trim() ||
      "Allegato";

    const allegatoLocale = {
      syncId: syncId,
      localFileId: localFileId,
      nomeFile: nomeFile,
      nomeOriginale: String(file.nomeOriginale || nomeFile),
      mimeType: String(file.mimeType || "application/octet-stream"),
      sizeBytes: Number(file.sizeBytes) || 0,
      originalSizeBytes: Number(file.originalSizeBytes) || 0,
      compressed: !!file.compressed,
      linkFile: "",
      note: String(context.note || ""),
      dataCaricamento: now
    };

    const payload = {
      syncId: syncId,
      localFileId: localFileId,
      nomeFile: nomeFile,
      nomeOriginale: allegatoLocale.nomeOriginale,
      mimeType: allegatoLocale.mimeType,
      sizeBytes: allegatoLocale.sizeBytes,
      originalSizeBytes: allegatoLocale.originalSizeBytes,
      compressed: allegatoLocale.compressed,
      linkFile: "",
      note: allegatoLocale.note,
      dataCaricamento: now
    };

    dati.allegati[deviceId].push(allegatoLocale);

    pending.push({
      changeId: createPendingChangeId(),
      type: "ADD_ALLEGATO",
      syncId: syncId,
      localFileId: localFileId,
      deviceId: deviceId,
      payload: payload,
      createdAt: now
    });

    addedCount++;
  });

  try {
    localStorage.setItem(
      STORAGE_KEYS.PENDING_CHANGES,
      JSON.stringify(pending)
    );

    saveLocalData();
  } catch (error) {
    dati.allegati[deviceId].splice(localLengthBefore);

    try {
      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingBefore)
      );
    } catch (restoreError) {
      console.error(
        "Impossibile ripristinare la coda allegati:",
        restoreError
      );
    }

    deleteImportedNativeFiles(files);

    cvlsAlert(
      "Impossibile salvare i metadati degli allegati.",
      "Errore allegati"
    );
    return;
  }

  setValue("allegatoNota", "");
  updateStatusBox();

  if (currentDeviceId === deviceId) {
    renderAllegati();
  }

  if (addedCount > 0) {
    showCvlsToast(
      addedCount === 1
        ? "Allegato preparato"
        : addedCount + " allegati preparati"
    );
  }

  if (errors.length > 0) {
    cvlsAlert(
      errors.length +
      (errors.length === 1
        ? " file non è stato importato."
        : " file non sono stati importati."),
      "Importazione parziale"
    );
  } else if (addedCount === 0) {
    cvlsAlert(
      "Nessun allegato è stato importato.",
      "Allegati"
    );
  }
};

window.onAndroidAttachmentSelectionError = function (message) {
  cvlsAttachmentSelectionContext = null;

  cvlsAlert(
    message || "Impossibile preparare gli allegati.",
    "Errore allegati"
  );
};

window.onAndroidAttachmentSynced = function (resultText) {
  let result;

  try {
    result =
      typeof resultText === "string"
        ? JSON.parse(resultText)
        : resultText;
  } catch (error) {
    console.error(
      "Risposta allegato non valida:",
      resultText
    );

    return;
  }

  const syncId = String(result.syncId || "").trim();
  const rawDeviceId = String(result.deviceId || "").trim();

  if (!syncId || !rawDeviceId || !result.linkFile) {
    return;
  }

  const deviceId = format11(rawDeviceId);

  if (!Array.isArray(dati.allegati[deviceId])) {
    dati.allegati[deviceId] = [];
  }

  let allegato = dati.allegati[deviceId].find(
    function (item) {
      return item && item.syncId === syncId;
    }
  );

  if (!allegato) {
    allegato = {
      syncId: syncId,
      nomeFile:
        result.nomeOriginale ||
        result.nomeFile ||
        "Allegato",
      mimeType: result.mimeType || "",
      note: result.note || "",
      dataCaricamento:
        result.dataCaricamento || ""
    };

    dati.allegati[deviceId].push(allegato);
  }

  allegato.linkFile = result.linkFile;
  allegato.synced = true;

  if (result.nomeOriginale) {
    allegato.nomeFile = result.nomeOriginale;
  }

  delete allegato.data;
  delete allegato.localFileId;

  removePendingAttachmentBySyncId(syncId);
  saveLocalData();

  if (currentDeviceId === deviceId) {
    renderAllegati();
  }
};

window.onAndroidSyncResult = function (resultText) {
  let result;

  try {
    result = JSON.parse(resultText);
  } catch (e) {
    endSyncAttempt();
    stopSyncProgressSimulation();
    failSyncUI("Risposta sincronizzazione non valida.");
    return;
  }

  if (handleAttendanceAutoSyncResult(result)) {
    return;
  }

  if (result.offline) {
    endSyncAttempt();
    stopSyncProgressSimulation();
    failSyncUI("Nessuna connessione");

    cvlsAlert(
      result.message || "Sembra che la connessione Internet sia andata persa. Controlla la tua connessione e riprova.",
      result.title || "Nessuna connessione disponibile"
    );

    return;
  }

  if (result.authState) {
    endSyncAttempt();
    stopSyncProgressSimulation();
    failSyncUI(result.message || "Autorizzazione non valida");

    const stato = normalizzaStatoAutorizzazioneApp(result.authState);

    if (stato === AUTH_STATUS.DELETED) {
      bloccaAccessoEliminato(
        result.message || "Autorizzazione eliminata dal database. Invia una nuova richiesta."
      );
      return;
    }

    bloccaAccessoNonAutorizzato(
      result.message || "Utente non autorizzato."
    );

    return;
  }

  /*
   * Android restituisce gli identificativi delle sole modifiche
   * realmente concluse. In caso di errore a metà sincronizzazione
   * vengono quindi rimosse soltanto quelle confermate.
   *
   * Il fallback allo snapshot completo mantiene la compatibilità
   * con una vecchia MainActivity che restituisce ok=true senza
   * confirmedChangeIds.
   */
  const confirmedChangeIds =
    Array.isArray(result.confirmedChangeIds)
      ? result.confirmedChangeIds
      : (
        result.ok
          ? Object.keys(cvlsActiveSyncSnapshot || {})
          : []
      );

  const confirmedCount =
    removeConfirmedSyncSnapshotChanges(
      confirmedChangeIds
    );

  updateStatusBox();

  if (!result.ok) {
    endSyncAttempt();
    stopSyncProgressSimulation();

    failSyncUI(
      result.message ||
      "Errore durante la sincronizzazione."
    );

    if (confirmedCount > 0) {
      const remainingCount =
        getPendingChanges().length;

      cvlsAlert(
        "Sincronizzazione completata solo in parte.\n\n" +
        confirmedCount +
        (
          confirmedCount === 1
            ? " modifica è stata salvata correttamente."
            : " modifiche sono state salvate correttamente."
        ) +
        "\nRestano da sincronizzare: " +
        remainingCount +
        ".\n\nPremendo nuovamente Sincronizza, le modifiche già confermate non verranno duplicate.",
        "Sincronizzazione parziale"
      );
    }

    return;
  }

  if (result.data) {
    updateSyncProgress(96, "Aggiornamento archivio locale");
    applyRemoteData(result.data);
    reapplyPendingArchiveChanges(getPendingChanges());
    saveLocalData();
  }

  localStorage.setItem(
    STORAGE_KEYS.LAST_SYNC,
    new Date().toISOString()
  );

  updateStatusBox();
  renderArchivio();

  if (currentDeviceId && typeof renderManutenzioni === "function") {
    renderManutenzioni();
  }
  if (currentDeviceId && typeof renderNote === "function") {
    renderNote();
  }
  if (currentDeviceId && typeof renderMateriali === "function") {
    renderMateriali();
  }
  if (currentDeviceId && typeof renderAllegati === "function") {
    renderAllegati();
  }

  updateSyncProgress(99, "Completamento sincronizzazione");
  stopSyncProgressSimulation();
  endSyncAttempt();
  finishSyncUI("Sincronizzazione completata");
};

window.onAndroidSyncError = function (message) {
  if (cvlsAttendanceAutoSyncRunning) {
    endAttendanceAutoSyncAttempt();
    updateStatusBox();
    showCvlsToast("Bollatura salvata offline");
    return;
  }

  endSyncAttempt();
  stopSyncProgressSimulation();

  failSyncUI(
    message ||
    "Errore sincronizzazione database"
  );
};

function normalizeDeleteRequestState(stato) {
  const value = String(stato || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (value === "pending" || value === "attesa") return "in_attesa";
  if (value === "authorized") return "autorizzato";
  if (value === "refused" || value === "rejected") return "rifiutato";
  if (
    value === "executed" ||
    value === "completed" ||
    value === "eseguito" ||
    value === "eseguita"
  ) return "eseguito";

  return value;
}

function getDeleteRequestCode(request) {
  return format11(
    request &&
    (
      request.CodiceCompleto ||
      request.codiceCompleto ||
      ""
    )
  );
}

function getDeleteRequestDeviceKey(request) {
  return String(
    request &&
    (
      request.DeviceKeyRichiedente ||
      request.deviceKeyRichiedente ||
      ""
    )
  ).trim();
}

function getDeleteRequestForDevice(codiceCompleto) {
  ensureDataShape();

  const codice = format11(codiceCompleto);
  const deviceKey = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_KEY) || ""
  ).trim();

  return dati.richiesteEliminazione.find(function (request) {
    return (
      getDeleteRequestCode(request) === codice &&
      getDeleteRequestDeviceKey(request) === deviceKey
    );
  }) || null;
}

function isDeleteRequestBlocking(request) {
  const stato = normalizeDeleteRequestState(
    request && request.Stato
  );

  return stato === "in_attesa" || stato === "autorizzato";
}

function getDeleteRequestStatusText(request) {
  const stato = normalizeDeleteRequestState(
    request && request.Stato
  );

  if (stato === "in_attesa") {
    return "Richiesta di cancellazione in attesa di conferma";
  }

  if (stato === "autorizzato") {
    return "Cancellazione autorizzata: eliminazione in esecuzione";
  }

  if (stato === "rifiutato") {
    return "Richiesta di cancellazione rifiutata";
  }

  if (stato === "eseguito") {
    return "Cancellazione eseguita";
  }

  return "";
}

function upsertLocalDeleteRequest(request) {
  ensureDataShape();

  const codice = getDeleteRequestCode(request);
  const deviceKey = getDeleteRequestDeviceKey(request);

  if (!codice || !deviceKey) {
    return;
  }

  const index = dati.richiesteEliminazione.findIndex(function (existing) {
    return (
      getDeleteRequestCode(existing) === codice &&
      getDeleteRequestDeviceKey(existing) === deviceKey
    );
  });

  if (index >= 0) {
    dati.richiesteEliminazione[index] = {
      ...dati.richiesteEliminazione[index],
      ...request,
      CodiceCompleto: codice,
      DeviceKeyRichiedente: deviceKey
    };
  } else {
    dati.richiesteEliminazione.push({
      ...request,
      CodiceCompleto: codice,
      DeviceKeyRichiedente: deviceKey
    });
  }
}

function applyRemoteDeleteRequests(remoteRequests, previousRequests) {
  const incoming = Array.isArray(remoteRequests)
    ? remoteRequests
    : [];

  const previous = Array.isArray(previousRequests)
    ? previousRequests
    : [];

  dati.richiesteEliminazione = incoming.map(function (request) {
    return {
      ...request,
      CodiceCompleto: getDeleteRequestCode(request),
      DeviceKeyRichiedente: getDeleteRequestDeviceKey(request),
      Stato: normalizeDeleteRequestState(request && request.Stato)
    };
  });

  const richiestaRifiutata = dati.richiesteEliminazione.find(function (request) {
    if (normalizeDeleteRequestState(request.Stato) !== "rifiutato") {
      return false;
    }

    const precedente = previous.find(function (oldRequest) {
      return (
        getDeleteRequestCode(oldRequest) === getDeleteRequestCode(request) &&
        getDeleteRequestDeviceKey(oldRequest) === getDeleteRequestDeviceKey(request)
      );
    });

    return !precedente ||
      normalizeDeleteRequestState(precedente.Stato) !== "rifiutato";
  });

  if (richiestaRifiutata) {
    window.setTimeout(function () {
      cvlsAlert(
        "La richiesta di cancellazione del dispositivo " +
        (richiestaRifiutata.NomeDispositivo || richiestaRifiutata.CodiceCompleto) +
        " è stata rifiutata. Il dispositivo è nuovamente disponibile.",
        "Cancellazione rifiutata"
      );
    }, 80);
  }
}

function applyRemoteMaintenanceDeleteRequests(remoteRequests, previousRequests) {
  const incoming = Array.isArray(remoteRequests)
    ? remoteRequests
    : [];

  const previous = Array.isArray(previousRequests)
    ? previousRequests
    : [];

  const normalizedRequests = incoming.map(function (request) {
    return {
      ...request,
      CodiceCompleto: format11(request && request.CodiceCompleto),
      TipoRecord: request && request.TipoRecord
        ? request.TipoRecord
        : "manutenzione",
      RecordKey: String(request && request.RecordKey || "").trim(),
      DeviceKeyRichiedente: String(
        request && request.DeviceKeyRichiedente || ""
      ).trim(),
      Stato: normalizeDeleteRequestState(request && request.Stato)
    };
  });

  normalizedRequests.forEach(function (request) {
    const stato = normalizeDeleteRequestState(request.Stato);

    if (stato !== "eseguita" && stato !== "eseguito") {
      return;
    }

    const codice = format11(request.CodiceCompleto);

    if (!codice || !Array.isArray(dati.manutenzioni[codice])) {
      return;
    }

    dati.manutenzioni[codice] =
      dati.manutenzioni[codice].filter(function (manutenzione) {
        return cvlsMaintenanceDeleteRecordKey(
          codice,
          manutenzione
        ) !== request.RecordKey;
      });
  });

  dati.richiesteEliminazioneManutenzioni = normalizedRequests;

  const richiestaRifiutata =
    dati.richiesteEliminazioneManutenzioni.find(function (request) {
      if (normalizeDeleteRequestState(request.Stato) !== "rifiutato") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      return !precedente ||
        normalizeDeleteRequestState(precedente.Stato) !== "rifiutato";
    });

  if (richiestaRifiutata) {
    window.setTimeout(function () {
      cvlsAlert(
        "La richiesta di cancellazione della manutenzione è stata rifiutata. La riga è nuovamente disponibile.",
        "Cancellazione rifiutata"
      );
    }, 80);
  }

  const richiestaEseguita =
    normalizedRequests.find(function (request) {
      const stato = normalizeDeleteRequestState(request.Stato);

      if (stato !== "eseguita" && stato !== "eseguito") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      const statoPrecedente = normalizeDeleteRequestState(
        precedente && precedente.Stato
      );

      return statoPrecedente !== "eseguita" &&
        statoPrecedente !== "eseguito";
    });

  if (richiestaEseguita) {
    window.setTimeout(function () {
      cvlsAlert(
        "La cancellazione della manutenzione è stata autorizzata ed eseguita.",
        "Cancellazione eseguita"
      );
    }, 120);
  }
}

function applyRemoteNoteDeleteRequests(remoteRequests, previousRequests) {
  const incoming = Array.isArray(remoteRequests)
    ? remoteRequests
    : [];

  const previous = Array.isArray(previousRequests)
    ? previousRequests
    : [];

  const normalizedRequests = incoming.map(function (request) {
    return {
      ...request,
      CodiceCompleto: format11(request && request.CodiceCompleto),
      TipoRecord: request && request.TipoRecord
        ? request.TipoRecord
        : "nota",
      RecordKey: String(request && request.RecordKey || "").trim(),
      DeviceKeyRichiedente: String(
        request && request.DeviceKeyRichiedente || ""
      ).trim(),
      Stato: normalizeDeleteRequestState(request && request.Stato)
    };
  });

  normalizedRequests.forEach(function (request) {
    const stato = normalizeDeleteRequestState(request.Stato);

    if (stato !== "eseguita" && stato !== "eseguito") {
      return;
    }

    const codice = format11(request.CodiceCompleto);

    if (!codice || !Array.isArray(dati.note[codice])) {
      return;
    }

    dati.note[codice] =
      dati.note[codice].filter(function (nota) {
        return cvlsNoteDeleteRecordKey(
          codice,
          nota
        ) !== request.RecordKey;
      });
  });

  dati.richiesteEliminazioneNote = normalizedRequests;

  const richiestaRifiutata =
    dati.richiesteEliminazioneNote.find(function (request) {
      if (normalizeDeleteRequestState(request.Stato) !== "rifiutato") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      return !precedente ||
        normalizeDeleteRequestState(precedente.Stato) !== "rifiutato";
    });

  if (richiestaRifiutata) {
    window.setTimeout(function () {
      cvlsAlert(
        "La richiesta di cancellazione della nota è stata rifiutata. La riga è nuovamente disponibile.",
        "Cancellazione rifiutata"
      );
    }, 80);
  }

  const richiestaEseguita =
    normalizedRequests.find(function (request) {
      const stato = normalizeDeleteRequestState(request.Stato);

      if (stato !== "eseguita" && stato !== "eseguito") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      const statoPrecedente = normalizeDeleteRequestState(
        precedente && precedente.Stato
      );

      return statoPrecedente !== "eseguita" &&
        statoPrecedente !== "eseguito";
    });

  if (richiestaEseguita) {
    window.setTimeout(function () {
      cvlsAlert(
        "La cancellazione della nota è stata autorizzata ed eseguita.",
        "Cancellazione eseguita"
      );
    }, 120);
  }
}

function applyRemoteMaterialDeleteRequests(remoteRequests, previousRequests) {
  const incoming = Array.isArray(remoteRequests)
    ? remoteRequests
    : [];

  const previous = Array.isArray(previousRequests)
    ? previousRequests
    : [];

  const normalizedRequests = incoming.map(function (request) {
    return {
      ...request,
      CodiceCompleto: format11(request && request.CodiceCompleto),
      TipoRecord: request && request.TipoRecord
        ? request.TipoRecord
        : "materiale",
      RecordKey: String(request && request.RecordKey || "").trim(),
      DeviceKeyRichiedente: String(
        request && request.DeviceKeyRichiedente || ""
      ).trim(),
      Stato: normalizeDeleteRequestState(request && request.Stato)
    };
  });

  normalizedRequests.forEach(function (request) {
    const stato = normalizeDeleteRequestState(request.Stato);

    if (stato !== "eseguita" && stato !== "eseguito") {
      return;
    }

    const codice = format11(request.CodiceCompleto);

    if (!codice || !Array.isArray(dati.materiali[codice])) {
      return;
    }

    dati.materiali[codice] =
      dati.materiali[codice].filter(function (materiale) {
        return cvlsMaterialDeleteRecordKey(
          codice,
          materiale
        ) !== request.RecordKey;
      });
  });

  dati.richiesteEliminazioneMateriali = normalizedRequests;

  const richiestaRifiutata =
    dati.richiesteEliminazioneMateriali.find(function (request) {
      if (normalizeDeleteRequestState(request.Stato) !== "rifiutato") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      return !precedente ||
        normalizeDeleteRequestState(precedente.Stato) !== "rifiutato";
    });

  if (richiestaRifiutata) {
    window.setTimeout(function () {
      cvlsAlert(
        "La richiesta di cancellazione del materiale è stata rifiutata. La riga è nuovamente disponibile.",
        "Cancellazione rifiutata"
      );
    }, 80);
  }

  const richiestaEseguita =
    normalizedRequests.find(function (request) {
      const stato = normalizeDeleteRequestState(request.Stato);

      if (stato !== "eseguita" && stato !== "eseguito") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      const statoPrecedente = normalizeDeleteRequestState(
        precedente && precedente.Stato
      );

      return statoPrecedente !== "eseguita" &&
        statoPrecedente !== "eseguito";
    });

  if (richiestaEseguita) {
    window.setTimeout(function () {
      cvlsAlert(
        "La cancellazione del materiale è stata autorizzata ed eseguita.",
        "Cancellazione eseguita"
      );
    }, 120);
  }
}

function applyRemoteAttachmentDeleteRequests(remoteRequests, previousRequests) {
  const incoming = Array.isArray(remoteRequests)
    ? remoteRequests
    : [];

  const previous = Array.isArray(previousRequests)
    ? previousRequests
    : [];

  const normalizedRequests = incoming.map(function (request) {
    return {
      ...request,
      CodiceCompleto: format11(request && request.CodiceCompleto),
      TipoRecord: request && request.TipoRecord
        ? request.TipoRecord
        : "allegato",
      RecordKey: String(request && request.RecordKey || "").trim(),
      DeviceKeyRichiedente: String(
        request && request.DeviceKeyRichiedente || ""
      ).trim(),
      Stato: normalizeDeleteRequestState(request && request.Stato)
    };
  });

  normalizedRequests.forEach(function (request) {
    const stato = normalizeDeleteRequestState(request.Stato);

    if (stato !== "eseguita" && stato !== "eseguito") {
      return;
    }

    const codice = format11(request.CodiceCompleto);

    if (!codice || !Array.isArray(dati.allegati[codice])) {
      return;
    }

    dati.allegati[codice] =
      dati.allegati[codice].filter(function (allegato) {
        return cvlsAttachmentDeleteRecordKey(
          codice,
          allegato
        ) !== request.RecordKey;
      });
  });

  dati.richiesteEliminazioneAllegati = normalizedRequests;

  const richiestaRifiutata =
    dati.richiesteEliminazioneAllegati.find(function (request) {
      if (normalizeDeleteRequestState(request.Stato) !== "rifiutato") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      return !precedente ||
        normalizeDeleteRequestState(precedente.Stato) !== "rifiutato";
    });

  if (richiestaRifiutata) {
    window.setTimeout(function () {
      cvlsAlert(
        "La richiesta di cancellazione dell'allegato è stata rifiutata. La riga è nuovamente disponibile.",
        "Cancellazione rifiutata"
      );
    }, 80);
  }

  const richiestaEseguita =
    normalizedRequests.find(function (request) {
      const stato = normalizeDeleteRequestState(request.Stato);

      if (stato !== "eseguita" && stato !== "eseguito") {
        return false;
      }

      const precedente = previous.find(function (oldRequest) {
        return (
          String(oldRequest.RecordKey || "") ===
          String(request.RecordKey || "") &&
          String(oldRequest.DeviceKeyRichiedente || "") ===
          String(request.DeviceKeyRichiedente || "")
        );
      });

      const statoPrecedente = normalizeDeleteRequestState(
        precedente && precedente.Stato
      );

      return statoPrecedente !== "eseguita" &&
        statoPrecedente !== "eseguito";
    });

  if (richiestaEseguita) {
    window.setTimeout(function () {
      cvlsAlert(
        "La cancellazione dell'allegato è stata autorizzata ed eseguita.",
        "Cancellazione eseguita"
      );
    }, 120);
  }
}

function applyRemoteData(remoteData) {
  const previousDeleteRequests = Array.isArray(dati.richiesteEliminazione)
    ? dati.richiesteEliminazione.slice()
    : [];
  const previousMaintenanceDeleteRequests =
    Array.isArray(dati.richiesteEliminazioneManutenzioni)
      ? dati.richiesteEliminazioneManutenzioni.slice()
      : [];
  const previousNoteDeleteRequests =
    Array.isArray(dati.richiesteEliminazioneNote)
      ? dati.richiesteEliminazioneNote.slice()
      : [];
  const previousMaterialDeleteRequests =
    Array.isArray(dati.richiesteEliminazioneMateriali)
      ? dati.richiesteEliminazioneMateriali.slice()
      : [];
  const previousAttachmentDeleteRequests =
    Array.isArray(dati.richiesteEliminazioneAllegati)
      ? dati.richiesteEliminazioneAllegati.slice()
      : [];

  dati.citta = Array.isArray(remoteData.citta) ? remoteData.citta : dati.citta;
  dati.presidi = Array.isArray(remoteData.presidi) ? remoteData.presidi : dati.presidi;
  dati.ubicazioni = Array.isArray(remoteData.ubicazioni) ? remoteData.ubicazioni : dati.ubicazioni;
  dati.dispositivi = Array.isArray(remoteData.dispositivi) ? remoteData.dispositivi : dati.dispositivi;
  dati.cantieri = Array.isArray(remoteData.cantieri) ? remoteData.cantieri : dati.cantieri;
  dati.bollature = Array.isArray(remoteData.bollature) ? remoteData.bollature : dati.bollature;

  if (
    remoteData.macchine &&
    typeof remoteData.macchine === "object" &&
    !Array.isArray(remoteData.macchine)
  ) {
    dati.macchine = remoteData.macchine;
  }

  if (
    remoteData.cvls &&
    typeof remoteData.cvls === "object" &&
    !Array.isArray(remoteData.cvls)
  ) {
    dati.cvls = remoteData.cvls;
  }

  if (
    remoteData.manutenzioni &&
    typeof remoteData.manutenzioni === "object" &&
    !Array.isArray(remoteData.manutenzioni)
  ) {
    dati.manutenzioni = mergeRemoteListWithPendingAdds(
      remoteData.manutenzioni,
      dati.manutenzioni,
      "ADD_MANUTENZIONE",
      cvlsIsPendingAddManutenzione
    );
  }

  if (
    remoteData.note &&
    typeof remoteData.note === "object" &&
    !Array.isArray(remoteData.note)
  ) {
    dati.note = mergeRemoteListWithPendingAdds(
      remoteData.note,
      dati.note,
      "ADD_NOTA",
      cvlsIsPendingAddNota
    );
  }

  if (
    remoteData.materiali &&
    typeof remoteData.materiali === "object" &&
    !Array.isArray(remoteData.materiali)
  ) {
    dati.materiali = mergeRemoteListWithPendingAdds(
      remoteData.materiali,
      dati.materiali,
      "ADD_MATERIALE",
      cvlsIsPendingAddMateriale
    );
  }

  if (
    remoteData.allegati &&
    typeof remoteData.allegati === "object" &&
    !Array.isArray(remoteData.allegati)
  ) {
    dati.allegati = mergeRemoteAllegatiWithLocal(
      remoteData.allegati,
      dati.allegati
    );
  }

  if (Array.isArray(remoteData.richiesteEliminazione)) {
    applyRemoteDeleteRequests(
      remoteData.richiesteEliminazione,
      previousDeleteRequests
    );
  }

  if (Array.isArray(remoteData.richiesteEliminazioneManutenzioni)) {
    applyRemoteMaintenanceDeleteRequests(
      remoteData.richiesteEliminazioneManutenzioni,
      previousMaintenanceDeleteRequests
    );
  }
  if (Array.isArray(remoteData.richiesteEliminazioneNote)) {
    applyRemoteNoteDeleteRequests(
      remoteData.richiesteEliminazioneNote,
      previousNoteDeleteRequests
    );
  }
  if (Array.isArray(remoteData.richiesteEliminazioneMateriali)) {
    applyRemoteMaterialDeleteRequests(
      remoteData.richiesteEliminazioneMateriali,
      previousMaterialDeleteRequests
    );
  }
  if (Array.isArray(remoteData.richiesteEliminazioneAllegati)) {
    applyRemoteAttachmentDeleteRequests(
      remoteData.richiesteEliminazioneAllegati,
      previousAttachmentDeleteRequests
    );
  }

  ensureDataShape();
}

function mergeRemoteListWithPendingAdds(remoteData, localData, pendingType, matchPendingFn) {
  const result = {};
  const remote = remoteData || {};
  const local = localData || {};
  const pending = getPendingChanges();

  Object.keys(remote).forEach(function (deviceId) {
    const cleanDeviceId = format11(deviceId);
    const remoteList = Array.isArray(remote[deviceId])
      ? remote[deviceId]
      : [];

    result[cleanDeviceId] = remoteList.slice();
  });

  Object.keys(local).forEach(function (deviceId) {
    const cleanDeviceId = format11(deviceId);
    const localList = Array.isArray(local[deviceId])
      ? local[deviceId]
      : [];

    if (!Array.isArray(result[cleanDeviceId])) {
      result[cleanDeviceId] = [];
    }

    localList.forEach(function (localItem) {
      const isStillPending = pending.some(function (change) {
        return (
          change &&
          change.type === pendingType &&
          typeof matchPendingFn === "function" &&
          matchPendingFn(change, cleanDeviceId, localItem)
        );
      });

      if (!isStillPending) {
        return;
      }

      const alreadyPresent = result[cleanDeviceId].some(function (remoteItem) {
        return typeof matchPendingFn === "function" &&
          pending.some(function (change) {
            return (
              change &&
              change.type === pendingType &&
              matchPendingFn(change, cleanDeviceId, localItem) &&
              matchPendingFn(change, cleanDeviceId, remoteItem)
            );
          });
      });

      if (!alreadyPresent) {
        result[cleanDeviceId].push(localItem);
      }
    });
  });

  return result;
}

function mergeRemoteAllegatiWithLocal(remoteAllegati, localAllegati) {
  const result = {};
  const remote = remoteAllegati || {};
  const local = localAllegati || {};

  const pending = getPendingChanges();
  const pendingAttachmentSyncIds = {};

  pending.forEach(function (change) {
    if (!change || change.type !== "ADD_ALLEGATO") {
      return;
    }

    const payload = change.payload || {};
    const syncId = String(
      change.syncId ||
      payload.syncId ||
      ""
    ).trim();

    if (syncId) {
      pendingAttachmentSyncIds[syncId] = true;
    }
  });

  Object.keys(remote).forEach(function (deviceId) {
    const cleanDeviceId = format11(deviceId);
    const remoteList = Array.isArray(remote[deviceId])
      ? remote[deviceId]
      : [];

    result[cleanDeviceId] = remoteList.map(function (item) {
      return {
        syncId: String(item.syncId || "").trim(),
        localFileId: "",
        nomeFile: String(item.nomeFile || item.nomeOriginale || "Allegato").trim(),
        nomeOriginale: String(item.nomeOriginale || item.nomeFile || "Allegato").trim(),
        mimeType: String(item.mimeType || "").trim(),
        linkFile: String(item.linkFile || "").trim(),
        note: String(item.note || "").trim(),
        dataCaricamento: String(item.dataCaricamento || "").trim(),
        synced: true
      };
    });
  });

  Object.keys(local).forEach(function (deviceId) {
    const cleanDeviceId = format11(deviceId);
    const localList = Array.isArray(local[deviceId])
      ? local[deviceId]
      : [];

    if (!Array.isArray(result[cleanDeviceId])) {
      result[cleanDeviceId] = [];
    }

    localList.forEach(function (localItem) {
      const syncId = String(localItem && localItem.syncId || "").trim();

      /*
       * Mantiene l'allegato locale solo se:
       * - è ancora davvero nella coda pending
       * - non esiste già una versione remota equivalente con link Drive
       */
      if (!syncId || !pendingAttachmentSyncIds[syncId]) {
        return;
      }

      const alreadySyncedRemote = result[cleanDeviceId].some(function (remoteItem) {
        return remoteAttachmentMatchesLocalAttachment(remoteItem, localItem);
      });

      if (alreadySyncedRemote) {
        return;
      }

      result[cleanDeviceId].push(localItem);
    });
  });

  return result;
}

function remoteAttachmentMatchesLocalAttachment(remoteItem, localItem) {
  if (!remoteItem || !localItem) {
    return false;
  }

  const remoteLink = String(remoteItem.linkFile || "").trim();

  if (!remoteLink) {
    return false;
  }

  const remoteName = String(
    remoteItem.nomeOriginale ||
    remoteItem.nomeFile ||
    ""
  ).trim();

  const localName = String(
    localItem.nomeOriginale ||
    localItem.nomeFile ||
    ""
  ).trim();

  const remoteNote = String(remoteItem.note || "").trim();
  const localNote = String(localItem.note || "").trim();

  if (!remoteName || !localName) {
    return false;
  }

  const sameName =
    remoteName === localName ||
    remoteName.endsWith(" - " + localName) ||
    remoteName.indexOf(localName) >= 0;

  const sameNote = remoteNote === localNote;

  return sameName && sameNote;
}


function createPendingChangeId() {
  return (
    "CHG-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 10).toUpperCase()
  );
}

function captureActiveSyncSnapshot(pending) {
  cvlsActiveSyncSnapshot = {};

  (Array.isArray(pending) ? pending : []).forEach(function (change) {
    if (!change || !change.changeId) {
      return;
    }

    cvlsActiveSyncSnapshot[String(change.changeId)] =
      JSON.stringify(change);
  });
}

function removeConfirmedSyncSnapshotChanges(
  confirmedChangeIds
) {
  const snapshot =
    cvlsActiveSyncSnapshot || {};

  const confirmedSet =
    new Set(
      (Array.isArray(confirmedChangeIds)
        ? confirmedChangeIds
        : []
      )
        .map(function (changeId) {
          return String(changeId || "").trim();
        })
        .filter(Boolean)
    );

  const pending =
    getPendingChanges();

  let removedCount = 0;

  const remaining = pending.filter(function (change) {
    if (!change || !change.changeId) {
      return true;
    }

    const changeId =
      String(change.changeId);

    if (!confirmedSet.has(changeId)) {
      return true;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        snapshot,
        changeId
      )
    ) {
      return true;
    }

    /*
     * Se una modifica è stata aggiornata dopo l'avvio della
     * sincronizzazione, il suo contenuto non coincide più con
     * lo snapshot inviato e deve restare nella coda.
     */
    const isUnchanged =
      JSON.stringify(change) ===
      snapshot[changeId];

    if (isUnchanged) {
      removedCount++;
      return false;
    }

    return true;
  });

  localStorage.setItem(
    STORAGE_KEYS.PENDING_CHANGES,
    JSON.stringify(remaining)
  );

  updateStatusBox();

  return removedCount;
}


function reapplyPendingArchiveChanges(pending) {
  const changes = Array.isArray(pending) ? pending : [];

  function upsertByKey(list, item, keyBuilder) {
    if (!item || !Array.isArray(list)) {
      return;
    }

    const wantedKey = keyBuilder(item);

    if (!wantedKey) {
      return;
    }

    const index = list.findIndex(function (existing) {
      return keyBuilder(existing) === wantedKey;
    });

    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...item
      };
    } else {
      list.push(item);
    }
  }

  changes.forEach(function (change) {
    if (!change) {
      return;
    }

    const payload = change.payload || {};

    if (change.type === "ADD_CITTA") {
      upsertByKey(
        dati.citta,
        payload,
        function (item) {
          return format2(item && item.CodiceCitta);
        }
      );
      return;
    }

    if (change.type === "ADD_PRESIDIO") {
      upsertByKey(
        dati.presidi,
        payload,
        function (item) {
          if (!item) return "";

          return (
            format2(item.CodiceCitta) + "|" +
            format2(item.CodicePresidio)
          );
        }
      );
      return;
    }

    if (change.type === "ADD_UBICAZIONE") {
      upsertByKey(
        dati.ubicazioni,
        payload,
        function (item) {
          if (!item) return "";

          return (
            format2(item.CodiceCitta) + "|" +
            format2(item.CodicePresidio) + "|" +
            format3(item.CodiceUbicazione)
          );
        }
      );
      return;
    }

    if (change.type === "ADD_DISPOSITIVO") {
      upsertByKey(
        dati.dispositivi,
        payload,
        function (item) {
          return format11(
            item &&
            (
              item.CodiceCompleto ||
              item.codiceCompleto ||
              item.Codice ||
              item.codice
            )
          );
        }
      );
      return;
    }

    if (change.type === "REQUEST_DELETE_DISPOSITIVO") {
      upsertLocalDeleteRequest({
        ...payload,
        Stato: normalizeDeleteRequestState(
          payload.Stato || "in_attesa"
        )
      });
      return;
    }

    if (change.type === "UPDATE_LINK_QR") {
      const codice = format11(
        change.codiceCompleto ||
        payload.CodiceCompleto ||
        payload.codiceCompleto ||
        ""
      );

      const link =
        change.linkQR ||
        payload.LinkQR ||
        payload.linkQR ||
        "";

      const dispositivo = dati.dispositivi.find(function (item) {
        return format11(item && item.CodiceCompleto) === codice;
      });

      if (dispositivo && link) {
        dispositivo.LinkQR = link;
      }
      return;
    }

    if (change.type === "SAVE_MACCHINA") {
      const deviceId = format11(change.deviceId);
      if (deviceId) {
        if (!dati.macchine) dati.macchine = {};
        dati.macchine[deviceId] = {
          ...dati.macchine[deviceId],
          ...payload
        };
      }
      return;
    }

    if (change.type === "SAVE_CVLS") {
      const deviceId = format11(change.deviceId);
      if (deviceId) {
        if (!dati.cvls) dati.cvls = {};
        dati.cvls[deviceId] = {
          ...dati.cvls[deviceId],
          ...payload
        };
      }
      return;
    }
  });

  ensureDataShape();
}

function savePendingChange(change) {
  const pending = getPendingChanges();
  const createdAt =
    change && change.createdAt
      ? change.createdAt
      : new Date().toISOString();

  pending.push({
    ...change,
    changeId:
      change && change.changeId
        ? change.changeId
        : createPendingChangeId(),
    createdAt: createdAt
  });

  localStorage.setItem(
    STORAGE_KEYS.PENDING_CHANGES,
    JSON.stringify(pending)
  );

  updateStatusBox();
}

function getPendingChanges() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_CHANGES)) || [];
  } catch (e) {
    return [];
  }
}

function updateStatusBox() {
  const lastSync = localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
  const pending = getPendingChanges();
  const validPending = pending.filter(function (change) {
    return change && change.type;
  });

  const statusEl = document.getElementById("deviceStatusText");
  const lastEl = document.getElementById("lastSyncText");
  const pendingEl = document.getElementById("pendingChangesText");

  if (statusEl) statusEl.textContent = localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) || "Non autorizzato";
  if (lastEl) lastEl.textContent = lastSync ? formatDateTime(lastSync) : "Mai";
  if (pendingEl) pendingEl.textContent = String(validPending.length);

  const syncBadgeEl = document.getElementById("syncBadge");
  if (syncBadgeEl) {
    const count = validPending.length;
    if (count > 0) {
      syncBadgeEl.textContent = String(count);
      syncBadgeEl.classList.remove("hidden");
    } else {
      syncBadgeEl.classList.add("hidden");
      syncBadgeEl.textContent = "";
    }
  }
}

function addPendingUpdateLinkQR(codiceCompleto, linkQR) {
  const codicePulito = format11(codiceCompleto);
  const pending = getPendingChanges();

  const esistente = pending.find(change => {
    if (!change || change.type !== "UPDATE_LINK_QR") return false;

    const codiceChange =
      change.codiceCompleto ||
      change.CodiceCompleto ||
      (change.payload ? change.payload.CodiceCompleto : "") ||
      (change.payload ? change.payload.codiceCompleto : "");

    return format11(codiceChange) === codicePulito;
  });

  if (esistente) {
    esistente.codiceCompleto = codicePulito;
    esistente.linkQR = linkQR;
    esistente.payload = {
      CodiceCompleto: codicePulito,
      LinkQR: linkQR
    };
    esistente.updatedAt = new Date().toISOString();
  } else {
    pending.push({
      type: "UPDATE_LINK_QR",
      codiceCompleto: codicePulito,
      linkQR: linkQR,
      payload: {
        CodiceCompleto: codicePulito,
        LinkQR: linkQR
      },
      createdAt: new Date().toISOString()
    });
  }

  localStorage.setItem(STORAGE_KEYS.PENDING_CHANGES, JSON.stringify(pending));
  updateStatusBox();
}

function ensureLinkQRDispositivo(codice) {
  ensureDataShape();

  const codicePulito = format11(codice);

  const dispositivo = dati.dispositivi.find(d =>
    format11(d.CodiceCompleto || d.codiceCompleto || d.Codice || d.codice) === codicePulito
  );

  if (!dispositivo) {
    console.warn("Dispositivo non trovato per QR:", codicePulito);
    return "";
  }

  if (dispositivo.LinkQR && dispositivo.LinkQR.trim() !== "") {
    return dispositivo.LinkQR.trim();
  }

  const linkQR = creaLinkPubblicoManutenzione(dispositivo);

  if (currentDeviceData && format11(currentDeviceData.CodiceCompleto) === codicePulito) {
    currentDeviceData.LinkQR = linkQR;
    currentDeviceData.IdPubblicoManutenzione = dispositivo.IdPubblicoManutenzione;
    currentDeviceData.TokenQR = dispositivo.TokenQR;
    currentDeviceData.StatoLinkQR = dispositivo.StatoLinkQR;
    currentDeviceData.DataCreazioneLinkQR = dispositivo.DataCreazioneLinkQR;
  }

  saveLocalData();
  addPendingUpdateLinkQR(codicePulito, linkQR);
  renderArchivio();

  return linkQR;
}

/* =========================
   DATI LOCALI
========================= */

function createEmptyData() {
  return {
    citta: [],
    presidi: [],
    ubicazioni: [],
    dispositivi: [],
    macchine: {},
    manutenzioni: {},
    note: {},
    materiali: {},
    allegati: {},
    cvls: {},
    richiesteEliminazione: [],
    richiesteEliminazioneManutenzioni: [],
    richiesteEliminazioneNote: [],
    richiesteEliminazioneMateriali: [],
    richiesteEliminazioneAllegati: [],
    programmazioni: [],
    cantieri: [],
    bollature: []
  };
}

function ensureDataShape() {
  const empty = createEmptyData();

  Object.keys(empty).forEach(key => {
    if (dati[key] === undefined || dati[key] === null) {
      dati[key] = empty[key];
    }
  });

  dati.citta = Array.isArray(dati.citta) ? dati.citta : [];
  dati.presidi = Array.isArray(dati.presidi) ? dati.presidi : [];
  dati.ubicazioni = Array.isArray(dati.ubicazioni) ? dati.ubicazioni : [];
  dati.dispositivi = Array.isArray(dati.dispositivi) ? dati.dispositivi : [];
  dati.richiesteEliminazione = Array.isArray(dati.richiesteEliminazione)
    ? dati.richiesteEliminazione
    : [];
  dati.programmazioni = Array.isArray(dati.programmazioni) ? dati.programmazioni : [];
  dati.richiesteEliminazioneManutenzioni =
    Array.isArray(dati.richiesteEliminazioneManutenzioni)
      ? dati.richiesteEliminazioneManutenzioni
      : [];
  dati.richiesteEliminazioneNote =
    Array.isArray(dati.richiesteEliminazioneNote)
      ? dati.richiesteEliminazioneNote
      : [];
  dati.richiesteEliminazioneMateriali =
    Array.isArray(dati.richiesteEliminazioneMateriali)
      ? dati.richiesteEliminazioneMateriali
      : [];
  dati.richiesteEliminazioneAllegati =
    Array.isArray(dati.richiesteEliminazioneAllegati)
      ? dati.richiesteEliminazioneAllegati
      : [];
}

function loadLocalData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.DATA));
    if (saved) dati = saved;
  } catch (e) {
    dati = createEmptyData();
  }

  ensureDataShape();
}

function saveLocalData() {
  ensureDataShape();
  localStorage.setItem(STORAGE_KEYS.DATA, JSON.stringify(dati));
  updateStatusBox();
}

/* =========================
   ARCHIVIO
========================= */

/*
 * Permette allo stesso gesto del dito di passare
 * dalla lista interna allo scorrimento della pagina
 * quando la lista raggiunge l'inizio o la fine.
 */

/*
 * Gestione fluida dello scorrimento annidato:
 * - prima scorre la lista;
 * - raggiunto il limite, continua sulla pagina;
 * - il passaggio avviene mantenendo il dito appoggiato;
 * - include una leggera inerzia al rilascio.
 */
function abilitaPassaggioScrollArchivio() {
  const listaIds = [
    "listaCitta",
    "listaPresidi",
    "listaUbicazioni",
    "listaDispositivi"
  ];

  let frameInerziaGlobale = null;

  function fermaInerziaGlobale() {
    if (frameInerziaGlobale !== null) {
      cancelAnimationFrame(frameInerziaGlobale);
      frameInerziaGlobale = null;
    }
  }

  listaIds.forEach(function (id) {
    const lista = document.getElementById(id);

    if (
      !lista ||
      lista.dataset.scrollPassaggioAttivo === "2"
    ) {
      return;
    }

    lista.dataset.scrollPassaggioAttivo = "2";

    let trascinamentoAttivo = false;
    let movimentoAvvenuto = false;

    let yIniziale = 0;
    let ultimaY = 0;
    let ultimoTempo = 0;

    let velocita = 0;

    let deltaInAttesa = 0;
    let frameScroll = null;

    /*
     * Applica lo spostamento:
     * 1. utilizza lo spazio disponibile nella lista;
     * 2. trasferisce l'eventuale parte restante alla pagina.
     */
    function applicaDelta(delta) {
      let restante = delta;
      let applicatoTotale = 0;

      const massimoLista = Math.max(
        0,
        lista.scrollHeight - lista.clientHeight
      );

      if (massimoLista > 0) {
        const posizionePrima = lista.scrollTop;

        const nuovaPosizione = Math.max(
          0,
          Math.min(
            massimoLista,
            posizionePrima + restante
          )
        );

        lista.scrollTop = nuovaPosizione;

        const applicatoLista =
          nuovaPosizione - posizionePrima;

        restante -= applicatoLista;
        applicatoTotale += applicatoLista;
      }

      /*
       * La parte che la lista non può più assorbire
       * viene trasferita immediatamente alla pagina.
       */
      if (Math.abs(restante) > 0.01) {
        const paginaPrima = window.scrollY;

        window.scrollBy(
          0,
          restante
        );

        const applicatoPagina =
          window.scrollY - paginaPrima;

        applicatoTotale += applicatoPagina;
      }

      return applicatoTotale;
    }

    /*
     * Accumula gli eventi touchmove e applica lo scroll
     * una sola volta per ogni frame grafico.
     */
    function eseguiScrollAccumulato() {
      frameScroll = null;

      const delta = deltaInAttesa;
      deltaInAttesa = 0;

      if (Math.abs(delta) > 0.01) {
        applicaDelta(delta);
      }
    }

    function accodaScroll(delta) {
      deltaInAttesa += delta;

      if (frameScroll === null) {
        frameScroll = requestAnimationFrame(
          eseguiScrollAccumulato
        );
      }
    }

    function svuotaScrollAccumulato() {
      if (frameScroll !== null) {
        cancelAnimationFrame(frameScroll);
        frameScroll = null;
      }

      if (Math.abs(deltaInAttesa) > 0.01) {
        const delta = deltaInAttesa;
        deltaInAttesa = 0;

        applicaDelta(delta);
      }
    }

    /*
     * Piccola inerzia dopo il rilascio del dito.
     */
    function avviaInerzia() {
      fermaInerziaGlobale();

      let velocitaCorrente = velocita;

      if (Math.abs(velocitaCorrente) < 0.05) {
        return;
      }

      let tempoPrecedente = performance.now();

      function passoInerzia(tempoAttuale) {
        const intervallo = Math.min(
          32,
          Math.max(
            1,
            tempoAttuale - tempoPrecedente
          )
        );

        tempoPrecedente = tempoAttuale;

        const spostamento =
          velocitaCorrente * intervallo;

        const spostamentoApplicato =
          applicaDelta(spostamento);

        /*
         * Rallentamento progressivo.
         */
        velocitaCorrente *= Math.pow(
          0.92,
          intervallo / 16.67
        );

        if (
          Math.abs(velocitaCorrente) < 0.02 ||
          Math.abs(spostamentoApplicato) < 0.1
        ) {
          frameInerziaGlobale = null;
          return;
        }

        frameInerziaGlobale =
          requestAnimationFrame(
            passoInerzia
          );
      }

      frameInerziaGlobale =
        requestAnimationFrame(
          passoInerzia
        );
    }

    lista.addEventListener(
      "touchstart",
      function (event) {
        if (
          !event.touches ||
          event.touches.length !== 1
        ) {
          return;
        }

        fermaInerziaGlobale();
        svuotaScrollAccumulato();

        const posizioneY =
          event.touches[0].clientY;

        trascinamentoAttivo = true;
        movimentoAvvenuto = false;

        yIniziale = posizioneY;
        ultimaY = posizioneY;

        ultimoTempo = performance.now();
        velocita = 0;
      },
      {
        passive: true
      }
    );

    lista.addEventListener(
      "touchmove",
      function (event) {
        if (
          !trascinamentoAttivo ||
          !event.touches ||
          event.touches.length !== 1
        ) {
          return;
        }

        const posizioneY =
          event.touches[0].clientY;

        const delta =
          ultimaY - posizioneY;

        const tempoAttuale =
          performance.now();

        const intervallo = Math.max(
          8,
          tempoAttuale - ultimoTempo
        );

        ultimaY = posizioneY;
        ultimoTempo = tempoAttuale;

        if (
          Math.abs(posizioneY - yIniziale) > 3
        ) {
          movimentoAvvenuto = true;
        }

        if (
          !movimentoAvvenuto ||
          Math.abs(delta) < 0.01
        ) {
          return;
        }

        /*
         * Con touch-action:none l'evento rimane sotto
         * il controllo JavaScript fin dall'inizio.
         */
        if (event.cancelable) {
          event.preventDefault();
        }

        const velocitaIstantanea =
          delta / intervallo;

        /*
         * Media progressiva per evitare variazioni brusche.
         */
        velocita =
          velocita * 0.72 +
          velocitaIstantanea * 0.28;

        accodaScroll(delta);
      },
      {
        passive: false
      }
    );

    lista.addEventListener(
      "touchend",
      function () {
        if (!trascinamentoAttivo) {
          return;
        }

        trascinamentoAttivo = false;

        svuotaScrollAccumulato();

        const rilascioRecente =
          performance.now() - ultimoTempo < 90;

        if (
          movimentoAvvenuto &&
          rilascioRecente
        ) {
          avviaInerzia();
        }

        movimentoAvvenuto = false;
      },
      {
        passive: true
      }
    );

    lista.addEventListener(
      "touchcancel",
      function () {
        trascinamentoAttivo = false;
        movimentoAvvenuto = false;
        velocita = 0;

        svuotaScrollAccumulato();
        fermaInerziaGlobale();
      },
      {
        passive: true
      }
    );
  });
}


function renderArchivio(listeDaMantenere) {
  const ids =
    Array.isArray(listeDaMantenere)
      ? listeDaMantenere
      : [];

  const scrollPagina =
    Math.max(
      0,
      Number(window.pageYOffset || window.scrollY) || 0
    );

  const posizioniListe = {};

  ids.forEach(function (id) {
    const lista = document.getElementById(id);

    if (lista) {
      posizioniListe[id] = lista.scrollTop;
    }
  });

  renderCitta();
  renderPresidi();
  renderUbicazioni();
  renderDispositivi();
  aggiornaPercorso();

  ids.forEach(function (id) {
    const lista = document.getElementById(id);

    if (!lista) {
      return;
    }

    const posizioneMassima =
      Math.max(
        0,
        lista.scrollHeight - lista.clientHeight
      );

    lista.scrollTop =
      Math.min(
        posizioniListe[id] || 0,
        posizioneMassima
      );
  });

  /*
   * Durante il render i box vengono aperti/chiusi e la pagina
   * può fare un piccolo assestamento. La riportiamo subito
   * dov'era, poi sarà scrollArchivioTo() a muoverla in modo fluido.
   */
  if (ids.length > 0) {
    window.scrollTo(0, scrollPagina);
  }
}

function aggiornaPercorso() {
  let testo = "";

  if (selezione.citta) {
    testo += format2(selezione.citta.CodiceCitta) + " - " + selezione.citta.NomeCitta;
  }

  if (selezione.presidio) {
    testo += " / " + format2(selezione.presidio.CodicePresidio) + " - " + selezione.presidio.NomePresidio;
  }

  if (selezione.ubicazione) {
    testo += " / " + format3(selezione.ubicazione.CodiceUbicazione) + " - " + selezione.ubicazione.NomeUbicazione;
  }

  document.getElementById("percorso").textContent = testo || "Nessuna selezione";
}

function scrollArchivioTo(elementId) {
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(function () {
      const el = document.getElementById(elementId);

      if (!el || el.classList.contains("hidden")) {
        return;
      }

      const topbar =
        document.getElementById("topbar");

      const topbarHeight =
        topbar ? topbar.offsetHeight : 0;

      const rect =
        el.getBoundingClientRect();

      const targetY =
        Math.max(
          0,
          window.pageYOffset +
          rect.top -
          topbarHeight -
          18
        );

      const scrollAttuale =
        Math.max(
          0,
          Number(window.pageYOffset || window.scrollY) || 0
        );

      /*
       * Evita micro-scroll inutili se siamo già praticamente
       * nella posizione corretta.
       */
      if (Math.abs(scrollAttuale - targetY) < 6) {
        el.classList.add("scroll-focus");

        window.setTimeout(function () {
          el.classList.remove("scroll-focus");
        }, 900);

        return;
      }

      window.scrollTo({
        top: targetY,
        behavior: "smooth"
      });

      el.classList.add("scroll-focus");

      window.setTimeout(function () {
        el.classList.remove("scroll-focus");
      }, 900);
    });
  });
}

/*
 * Calcola quanti dispositivi appartengono a un livello
 * dell'archivio. I parametri presidio e ubicazione sono
 * facoltativi, così la stessa funzione serve per tutti
 * e tre i livelli.
 */
function contaDispositiviArchivio(
  codiceCitta,
  codicePresidio,
  codiceUbicazione
) {
  return dati.dispositivi.reduce(function (totale, dispositivo) {
    if (
      format2(dispositivo.CodiceCitta) !==
      format2(codiceCitta)
    ) {
      return totale;
    }

    if (
      codicePresidio !== undefined &&
      codicePresidio !== null &&
      codicePresidio !== "" &&
      format2(dispositivo.CodicePresidio) !==
      format2(codicePresidio)
    ) {
      return totale;
    }

    if (
      codiceUbicazione !== undefined &&
      codiceUbicazione !== null &&
      codiceUbicazione !== "" &&
      format3(dispositivo.CodiceUbicazione) !==
      format3(codiceUbicazione)
    ) {
      return totale;
    }

    return totale + 1;
  }, 0);
}

/*
 * Ordina città, presidi e ubicazioni dal gruppo che contiene
 * più dispositivi a quello che ne contiene meno.
 * A parità di numero usa l'ordine alfabetico.
 */
function ordinaArchivioPerNumeroDispositivi(
  lista,
  contaDispositivi,
  leggiNome
) {
  return lista.slice().sort(function (a, b) {
    const numeroA = contaDispositivi(a);
    const numeroB = contaDispositivi(b);

    if (numeroA !== numeroB) {
      return numeroB - numeroA;
    }

    return String(leggiNome(a) || "").localeCompare(
      String(leggiNome(b) || ""),
      "it",
      {
        sensitivity: "base"
      }
    );
  });
}

/*
 * Ordina i dispositivi dagli ultimi aggiunti ai più vecchi.
 * Usa prima l'ID e, in caso di parità o ID mancanti,
 * la posizione originale nel database locale.
 */
function ordinaDispositiviUltimiAggiunti(lista) {
  const indiceOriginale = new Map();

  dati.dispositivi.forEach(function (dispositivo, index) {
    indiceOriginale.set(dispositivo, index);
  });

  return lista.slice().sort(function (a, b) {
    const idA = Number(a && a.ID);
    const idB = Number(b && b.ID);

    if (
      Number.isFinite(idA) &&
      Number.isFinite(idB) &&
      idA !== idB
    ) {
      return idB - idA;
    }

    const indiceA = indiceOriginale.has(a)
      ? indiceOriginale.get(a)
      : -1;

    const indiceB = indiceOriginale.has(b)
      ? indiceOriginale.get(b)
      : -1;

    return indiceB - indiceA;
  });
}

/*
 * Limita l'altezza della lista allo spazio occupato dai
 * primi quattro elementi, lasciando accessibili tutti gli
 * altri tramite scorrimento verticale.
 *
 * L'altezza viene misurata realmente: funziona anche con
 * le schede dispositivo, che sono più alte delle altre.
 */
function aggiornaScorrimentoListaArchivio(
  contenitore,
  numeroVisibili
) {
  if (!contenitore) {
    return;
  }

  const limite =
    Number(numeroVisibili) > 0
      ? Number(numeroVisibili)
      : 4;

  const elementi = Array.from(
    contenitore.children
  ).filter(function (elemento) {
    return elemento.classList.contains("item");
  });

  contenitore.classList.remove(
    "archive-list-scroll"
  );

  contenitore.style.maxHeight = "";
  contenitore.scrollTop = 0;

  if (elementi.length <= limite) {
    return;
  }

  let altezzaMassima = 0;

  elementi
    .slice(0, limite)
    .forEach(function (elemento) {
      const stile =
        window.getComputedStyle(elemento);

      altezzaMassima +=
        elemento.getBoundingClientRect().height +
        (parseFloat(stile.marginTop) || 0) +
        (parseFloat(stile.marginBottom) || 0);
    });

  contenitore.classList.add(
    "archive-list-scroll"
  );

  contenitore.style.maxHeight =
    Math.ceil(altezzaMassima) + "px";
}

function renderCitta() {
  const div = document.getElementById("listaCitta");
  const noCitta = document.getElementById("noCitta");
  const ricerca = getValue("cercaCitta").toLowerCase().trim();

  div.innerHTML = "";
  aggiornaScorrimentoListaArchivio(div, 4);

  const filtrate = dati.citta.filter(function (citta) {
    return String(citta.NomeCitta || "")
      .toLowerCase()
      .includes(ricerca);
  });

  const lista = ordinaArchivioPerNumeroDispositivi(
    filtrate,
    function (citta) {
      return contaDispositiviArchivio(
        citta.CodiceCitta
      );
    },
    function (citta) {
      return citta.NomeCitta;
    }
  );

  noCitta.classList.toggle(
    "hidden",
    lista.length > 0 || !ricerca
  );

  lista.forEach(function (citta) {
    const el = document.createElement("div");
    el.className = "item";

    if (
      selezione.citta &&
      format2(selezione.citta.CodiceCitta) ===
      format2(citta.CodiceCitta)
    ) {
      el.classList.add("selected");
    }

    el.innerHTML = `
      <div><strong>${escapeHtml(citta.NomeCitta)}</strong></div>
      <div class="codice">Codice città: ${format2(citta.CodiceCitta)}</div>
    `;

    el.onclick = function () {
      cvlsClearForwardHistory();
      selezione.citta = citta;
      selezione.presidio = null;
      selezione.ubicazione = null;

      document
        .getElementById("boxPresidi")
        .classList.remove("hidden");

      document
        .getElementById("boxUbicazioni")
        .classList.add("hidden");

      document
        .getElementById("boxDispositivi")
        .classList.add("hidden");

      renderArchivio([
        "listaCitta"
      ]);

      scrollArchivioTo("boxPresidi");
    };

    const cittaNonSincronizzata = !!cvlsGetPendingArchiveChange(
      "ADD_CITTA",
      citta
    ).change;

    abilitaMenuPressioneLunga(el, {
      title: citta.NomeCitta || "Città",
      modifica: function () {
        modificaNomeCitta(citta);
      },
      elimina: function () {
        eliminaCittaNonSincronizzata(citta);
      },
      puoModificare: true,
      puoEliminare: cittaNonSincronizzata
    });

    div.appendChild(el);
  });

  aggiornaScorrimentoListaArchivio(div, 4);
}

function modificaNomePresidio(presidio) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!presidio) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_PRESIDIO",
    presidio
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const codiceCitta = format2(presidio.CodiceCitta);
  const codicePresidio = format2(presidio.CodicePresidio);
  const nomeAttuale = String(presidio.NomePresidio || "").trim();

  cvlsPrompt(
    "Inserisci il nuovo nome del presidio.",
    function (value) {
      const nuovoNome = String(value || "").trim();

      if (!nuovoNome) {
        cvlsAlert("Il nome presidio non può essere vuoto.", "Nome non valido");
        return;
      }

      if (normalizeName(nuovoNome) === normalizeName(nomeAttuale)) {
        return;
      }

      const duplicato = dati.presidi.some(function (item) {
        if (!item) {
          return false;
        }

        return (
          format2(item.CodiceCitta) === codiceCitta &&
          format2(item.CodicePresidio) !== codicePresidio &&
          normalizeName(item.NomePresidio) === normalizeName(nuovoNome)
        );
      });

      if (duplicato) {
        cvlsAlert(
          "Esiste già un presidio con questo nome nella stessa città.",
          "Nome già presente"
        );
        return;
      }

      const target = dati.presidi.find(function (item) {
        return (
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio
        );
      });

      if (!target) {
        cvlsAlert("Presidio non trovato.", "Errore");
        return;
      }

      target.NomePresidio = nuovoNome;

      dati.ubicazioni.forEach(function (ubicazione) {
        if (
          format2(ubicazione.CodiceCitta) === codiceCitta &&
          format2(ubicazione.CodicePresidio) === codicePresidio
        ) {
          ubicazione.NomePresidio = nuovoNome;
        }
      });

      dati.dispositivi.forEach(function (dispositivo) {
        if (
          format2(dispositivo.CodiceCitta) === codiceCitta &&
          format2(dispositivo.CodicePresidio) === codicePresidio
        ) {
          dispositivo.NomePresidio = nuovoNome;
        }
      });

      if (
        selezione.presidio &&
        format2(selezione.presidio.CodiceCitta) === codiceCitta &&
        format2(selezione.presidio.CodicePresidio) === codicePresidio
      ) {
        selezione.presidio.NomePresidio = nuovoNome;
      }

      pendingInfo.pending.forEach(function (change) {
        if (!change) {
          return;
        }

        const payload = change.payload || {};

        if (
          change.type === "ADD_PRESIDIO" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio
        ) {
          change.payload = {
            ...(change.payload || {}),
            ...target,
            NomePresidio: nuovoNome
          };
          change.updatedAt = new Date().toISOString();
        }

        if (
          (
            change.type === "ADD_UBICAZIONE" ||
            change.type === "ADD_DISPOSITIVO"
          ) &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio
        ) {
          change.payload = {
            ...(change.payload || {}),
            NomePresidio: nuovoNome
          };
          change.updatedAt = new Date().toISOString();
        }
      });

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();

      renderArchivio([
        "listaCitta",
        "listaPresidi"
      ]);

      showCvlsToast("Nome presidio aggiornato");
    },
    {
      title: "Modifica presidio",
      value: nomeAttuale,
      placeholder: "Nome presidio"
    }
  );
}

function eliminaPresidioNonSincronizzato(presidio) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!presidio) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_PRESIDIO",
    presidio
  );

  if (!pendingInfo.change) {
    cvlsAlert(
      "Impossibile eliminare, dato già sincronizzato.",
      "Eliminazione non consentita"
    );
    return;
  }

  const codiceCitta = format2(presidio.CodiceCitta);
  const codicePresidio = format2(presidio.CodicePresidio);
  const nomePresidio = String(presidio.NomePresidio || "");

  cvlsConfirm(
    "Vuoi eliminare il presidio non ancora sincronizzato: " + nomePresidio + "? Verranno eliminate anche eventuali ubicazioni e dispositivi collegati non sincronizzati.",
    function () {
      const dispositiviDaEliminare = dati.dispositivi
        .filter(function (dispositivo) {
          return (
            format2(dispositivo.CodiceCitta) === codiceCitta &&
            format2(dispositivo.CodicePresidio) === codicePresidio
          );
        })
        .map(function (dispositivo) {
          return format11(dispositivo.CodiceCompleto);
        });

      const deviceCodeSet = new Set(dispositiviDaEliminare);

      dati.presidi = dati.presidi.filter(function (item) {
        return !(
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio
        );
      });

      dati.ubicazioni = dati.ubicazioni.filter(function (item) {
        return !(
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio
        );
      });

      dati.dispositivi = dati.dispositivi.filter(function (item) {
        return !(
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio
        );
      });

      dispositiviDaEliminare.forEach(function (codice) {
        if (dati.macchine) {
          delete dati.macchine[codice];
        }

        if (dati.manutenzioni) {
          delete dati.manutenzioni[codice];
        }

        if (dati.materiali) {
          delete dati.materiali[codice];
        }

        if (dati.allegati) {
          delete dati.allegati[codice];
        }

        if (dati.note) {
          delete dati.note[codice];
        }

        if (dati.cvls) {
          delete dati.cvls[codice];
        }
      });

      if (Array.isArray(dati.programmazioni)) {
        dati.programmazioni = dati.programmazioni.filter(function (item) {
          return !cvlsIsDeviceCodeInSet(
            item.deviceId || item.codiceCompleto || "",
            deviceCodeSet
          );
        });
      }

      cvlsRemovePendingChangesWhere(function (change) {
        if (!change) {
          return false;
        }

        const payload = change.payload || {};

        if (
          change.type === "ADD_PRESIDIO" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio
        ) {
          return true;
        }

        if (
          change.type === "ADD_UBICAZIONE" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio
        ) {
          return true;
        }

        if (
          change.type === "ADD_DISPOSITIVO" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio
        ) {
          return true;
        }

        if (cvlsIsDeviceCodeInSet(change.deviceId || "", deviceCodeSet)) {
          return true;
        }

        return cvlsIsDeviceCodeInSet(
          payload.deviceId ||
          payload.codiceCompleto ||
          payload.CodiceCompleto ||
          "",
          deviceCodeSet
        );
      });

      if (
        selezione.presidio &&
        format2(selezione.presidio.CodiceCitta) === codiceCitta &&
        format2(selezione.presidio.CodicePresidio) === codicePresidio
      ) {
        selezione.presidio = null;
        selezione.ubicazione = null;

        document
          .getElementById("boxUbicazioni")
          .classList.add("hidden");

        document
          .getElementById("boxDispositivi")
          .classList.add("hidden");
      }

      if (
        currentDeviceId &&
        cvlsIsDeviceCodeInSet(currentDeviceId, deviceCodeSet)
      ) {
        currentDeviceId = null;
        currentDeviceData = null;
      }

      saveLocalData();
      renderArchivio();

      showCvlsToast("Presidio eliminato");
    },
    null,
    "Elimina presidio"
  );
}

function renderPresidi() {
  const div = document.getElementById("listaPresidi");
  const noPresidio = document.getElementById("noPresidio");
  const ricerca = getValue("cercaPresidio").toLowerCase().trim();

  div.innerHTML = "";
  aggiornaScorrimentoListaArchivio(div, 4);

  if (!selezione.citta) {
    return;
  }

  const filtrati = dati.presidi.filter(function (presidio) {
    return (
      format2(presidio.CodiceCitta) ===
      format2(selezione.citta.CodiceCitta) &&
      String(presidio.NomePresidio || "")
        .toLowerCase()
        .includes(ricerca)
    );
  });

  const lista = ordinaArchivioPerNumeroDispositivi(
    filtrati,
    function (presidio) {
      return contaDispositiviArchivio(
        selezione.citta.CodiceCitta,
        presidio.CodicePresidio
      );
    },
    function (presidio) {
      return presidio.NomePresidio;
    }
  );

  noPresidio.classList.toggle(
    "hidden",
    lista.length > 0 || !ricerca
  );

  lista.forEach(function (presidio) {
    const el = document.createElement("div");
    el.className = "item";

    if (
      selezione.presidio &&
      format2(selezione.presidio.CodicePresidio) ===
      format2(presidio.CodicePresidio)
    ) {
      el.classList.add("selected");
    }

    el.innerHTML = `
      <div><strong>${escapeHtml(presidio.NomePresidio)}</strong></div>
      <div class="codice">Codice presidio: ${format2(presidio.CodicePresidio)}</div>
    `;

    el.onclick = function () {
      cvlsClearForwardHistory();
      selezione.presidio = presidio;
      selezione.ubicazione = null;

      document
        .getElementById("boxUbicazioni")
        .classList.remove("hidden");

      document
        .getElementById("boxDispositivi")
        .classList.add("hidden");

      renderArchivio([
        "listaCitta",
        "listaPresidi"
      ]);

      scrollArchivioTo("boxUbicazioni");
    };

    const presidioNonSincronizzato = !!cvlsGetPendingArchiveChange(
      "ADD_PRESIDIO",
      presidio
    ).change;

    abilitaMenuPressioneLunga(el, {
      title: presidio.NomePresidio || "Presidio",
      modifica: function () {
        modificaNomePresidio(presidio);
      },
      elimina: function () {
        eliminaPresidioNonSincronizzato(presidio);
      },
      puoModificare: true,
      puoEliminare: presidioNonSincronizzato
    });

    div.appendChild(el);
  });

  aggiornaScorrimentoListaArchivio(div, 4);
}

function modificaNomeUbicazione(ubicazione) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!ubicazione) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_UBICAZIONE",
    ubicazione
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const codiceCitta = format2(ubicazione.CodiceCitta);
  const codicePresidio = format2(ubicazione.CodicePresidio);
  const codiceUbicazione = format3(ubicazione.CodiceUbicazione);
  const nomeAttuale = String(ubicazione.NomeUbicazione || "").trim();

  cvlsPrompt(
    "Inserisci il nuovo nome dell'ubicazione.",
    function (value) {
      const nuovoNome = String(value || "").trim();

      if (!nuovoNome) {
        cvlsAlert("Il nome ubicazione non può essere vuoto.", "Nome non valido");
        return;
      }

      if (normalizeName(nuovoNome) === normalizeName(nomeAttuale)) {
        return;
      }

      const duplicato = dati.ubicazioni.some(function (item) {
        if (!item) {
          return false;
        }

        return (
          format2(item.CodiceCitta) === codiceCitta &&
          format2(item.CodicePresidio) === codicePresidio &&
          format3(item.CodiceUbicazione) !== codiceUbicazione &&
          normalizeName(item.NomeUbicazione) === normalizeName(nuovoNome)
        );
      });

      if (duplicato) {
        cvlsAlert(
          "Esiste già un'ubicazione con questo nome nello stesso presidio.",
          "Nome già presente"
        );
        return;
      }

      const target = dati.ubicazioni.find(function (item) {
        return (
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio &&
          format3(item && item.CodiceUbicazione) === codiceUbicazione
        );
      });

      if (!target) {
        cvlsAlert("Ubicazione non trovata.", "Errore");
        return;
      }

      target.NomeUbicazione = nuovoNome;

      dati.dispositivi.forEach(function (dispositivo) {
        if (
          format2(dispositivo.CodiceCitta) === codiceCitta &&
          format2(dispositivo.CodicePresidio) === codicePresidio &&
          format3(dispositivo.CodiceUbicazione) === codiceUbicazione
        ) {
          dispositivo.NomeUbicazione = nuovoNome;
        }
      });

      if (
        selezione.ubicazione &&
        format2(selezione.ubicazione.CodiceCitta) === codiceCitta &&
        format2(selezione.ubicazione.CodicePresidio) === codicePresidio &&
        format3(selezione.ubicazione.CodiceUbicazione) === codiceUbicazione
      ) {
        selezione.ubicazione.NomeUbicazione = nuovoNome;
      }

      if (
        currentDeviceData &&
        format2(currentDeviceData.CodiceCitta) === codiceCitta &&
        format2(currentDeviceData.CodicePresidio) === codicePresidio &&
        format3(currentDeviceData.CodiceUbicazione) === codiceUbicazione
      ) {
        currentDeviceData.NomeUbicazione = nuovoNome;
      }

      pendingInfo.pending.forEach(function (change) {
        if (!change) {
          return;
        }

        const payload = change.payload || {};

        if (
          change.type === "ADD_UBICAZIONE" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio &&
          format3(payload.CodiceUbicazione) === codiceUbicazione
        ) {
          change.payload = {
            ...(change.payload || {}),
            ...target,
            NomeUbicazione: nuovoNome
          };
          change.updatedAt = new Date().toISOString();
        }

        if (
          change.type === "ADD_DISPOSITIVO" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio &&
          format3(payload.CodiceUbicazione) === codiceUbicazione
        ) {
          change.payload = {
            ...(change.payload || {}),
            NomeUbicazione: nuovoNome
          };
          change.updatedAt = new Date().toISOString();
        }
      });

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();

      renderArchivio([
        "listaCitta",
        "listaPresidi",
        "listaUbicazioni"
      ]);

      showCvlsToast("Nome ubicazione aggiornato");
    },
    {
      title: "Modifica ubicazione",
      value: nomeAttuale,
      placeholder: "Nome ubicazione"
    }
  );
}

function eliminaUbicazioneNonSincronizzata(ubicazione) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!ubicazione) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_UBICAZIONE",
    ubicazione
  );

  if (!pendingInfo.change) {
    cvlsAlert(
      "Impossibile eliminare, dato già sincronizzato.",
      "Eliminazione non consentita"
    );
    return;
  }

  const codiceCitta = format2(ubicazione.CodiceCitta);
  const codicePresidio = format2(ubicazione.CodicePresidio);
  const codiceUbicazione = format3(ubicazione.CodiceUbicazione);
  const nomeUbicazione = String(ubicazione.NomeUbicazione || "");

  cvlsConfirm(
    "Vuoi eliminare l'ubicazione non ancora sincronizzata: " + nomeUbicazione + "? Verranno eliminati anche eventuali dispositivi collegati non sincronizzati.",
    function () {
      const dispositiviDaEliminare = dati.dispositivi
        .filter(function (dispositivo) {
          return (
            format2(dispositivo.CodiceCitta) === codiceCitta &&
            format2(dispositivo.CodicePresidio) === codicePresidio &&
            format3(dispositivo.CodiceUbicazione) === codiceUbicazione
          );
        })
        .map(function (dispositivo) {
          return format11(dispositivo.CodiceCompleto);
        });

      const deviceCodeSet = new Set(dispositiviDaEliminare);

      dati.ubicazioni = dati.ubicazioni.filter(function (item) {
        return !(
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio &&
          format3(item && item.CodiceUbicazione) === codiceUbicazione
        );
      });

      dati.dispositivi = dati.dispositivi.filter(function (item) {
        return !(
          format2(item && item.CodiceCitta) === codiceCitta &&
          format2(item && item.CodicePresidio) === codicePresidio &&
          format3(item && item.CodiceUbicazione) === codiceUbicazione
        );
      });

      dispositiviDaEliminare.forEach(function (codice) {
        if (dati.macchine) {
          delete dati.macchine[codice];
        }

        if (dati.manutenzioni) {
          delete dati.manutenzioni[codice];
        }

        if (dati.materiali) {
          delete dati.materiali[codice];
        }

        if (dati.allegati) {
          delete dati.allegati[codice];
        }

        if (dati.note) {
          delete dati.note[codice];
        }

        if (dati.cvls) {
          delete dati.cvls[codice];
        }
      });

      if (Array.isArray(dati.programmazioni)) {
        dati.programmazioni = dati.programmazioni.filter(function (item) {
          return !cvlsIsDeviceCodeInSet(
            item.deviceId || item.codiceCompleto || "",
            deviceCodeSet
          );
        });
      }

      cvlsRemovePendingChangesWhere(function (change) {
        if (!change) {
          return false;
        }

        const payload = change.payload || {};

        if (
          change.type === "ADD_UBICAZIONE" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio &&
          format3(payload.CodiceUbicazione) === codiceUbicazione
        ) {
          return true;
        }

        if (
          change.type === "ADD_DISPOSITIVO" &&
          format2(payload.CodiceCitta) === codiceCitta &&
          format2(payload.CodicePresidio) === codicePresidio &&
          format3(payload.CodiceUbicazione) === codiceUbicazione
        ) {
          return true;
        }

        if (cvlsIsDeviceCodeInSet(change.deviceId || "", deviceCodeSet)) {
          return true;
        }

        return cvlsIsDeviceCodeInSet(
          payload.deviceId ||
          payload.codiceCompleto ||
          payload.CodiceCompleto ||
          "",
          deviceCodeSet
        );
      });

      if (
        selezione.ubicazione &&
        format2(selezione.ubicazione.CodiceCitta) === codiceCitta &&
        format2(selezione.ubicazione.CodicePresidio) === codicePresidio &&
        format3(selezione.ubicazione.CodiceUbicazione) === codiceUbicazione
      ) {
        selezione.ubicazione = null;

        document
          .getElementById("boxDispositivi")
          .classList.add("hidden");
      }

      if (
        currentDeviceId &&
        cvlsIsDeviceCodeInSet(currentDeviceId, deviceCodeSet)
      ) {
        currentDeviceId = null;
        currentDeviceData = null;
      }

      saveLocalData();
      renderArchivio();

      showCvlsToast("Ubicazione eliminata");
    },
    null,
    "Elimina ubicazione"
  );
}

function renderUbicazioni() {
  const div = document.getElementById("listaUbicazioni");
  const noUbicazione = document.getElementById("noUbicazione");
  const ricerca = getValue("cercaUbicazione").toLowerCase().trim();

  div.innerHTML = "";
  aggiornaScorrimentoListaArchivio(div, 4);

  if (!selezione.citta || !selezione.presidio) {
    return;
  }

  const filtrate = dati.ubicazioni.filter(function (ubicazione) {
    return (
      format2(ubicazione.CodiceCitta) ===
      format2(selezione.citta.CodiceCitta) &&
      format2(ubicazione.CodicePresidio) ===
      format2(selezione.presidio.CodicePresidio) &&
      String(ubicazione.NomeUbicazione || "")
        .toLowerCase()
        .includes(ricerca)
    );
  });

  const lista = ordinaArchivioPerNumeroDispositivi(
    filtrate,
    function (ubicazione) {
      return contaDispositiviArchivio(
        selezione.citta.CodiceCitta,
        selezione.presidio.CodicePresidio,
        ubicazione.CodiceUbicazione
      );
    },
    function (ubicazione) {
      return ubicazione.NomeUbicazione;
    }
  );

  noUbicazione.classList.toggle(
    "hidden",
    lista.length > 0 || !ricerca
  );

  lista.forEach(function (ubicazione) {
    const el = document.createElement("div");
    el.className = "item";

    if (
      selezione.ubicazione &&
      format3(selezione.ubicazione.CodiceUbicazione) ===
      format3(ubicazione.CodiceUbicazione)
    ) {
      el.classList.add("selected");
    }

    el.innerHTML = `
      <div><strong>${escapeHtml(ubicazione.NomeUbicazione)}</strong></div>
      <div class="codice">Codice ubicazione: ${format3(ubicazione.CodiceUbicazione)}</div>
    `;

    el.onclick = function () {
      cvlsClearForwardHistory();

      selezione.ubicazione = ubicazione;

      document
        .getElementById("boxDispositivi")
        .classList.remove("hidden");

      renderArchivio([
        "listaCitta",
        "listaPresidi",
        "listaUbicazioni"
      ]);

      scrollArchivioTo("boxDispositivi");
    };

    const ubicazioneNonSincronizzata = !!cvlsGetPendingArchiveChange(
      "ADD_UBICAZIONE",
      ubicazione
    ).change;

    abilitaMenuPressioneLunga(el, {
      title: ubicazione.NomeUbicazione || "Ubicazione",
      modifica: function () {
        modificaNomeUbicazione(ubicazione);
      },
      elimina: function () {
        eliminaUbicazioneNonSincronizzata(ubicazione);
      },
      puoModificare: true,
      puoEliminare: ubicazioneNonSincronizzata
    });

    div.appendChild(el);
  });

  aggiornaScorrimentoListaArchivio(div, 4);
}

function cvlsGetArchivePendingKey(changeType, payload) {
  const p = payload || {};

  if (changeType === "ADD_CITTA") {
    return format2(p.CodiceCitta);
  }

  if (changeType === "ADD_PRESIDIO") {
    return (
      format2(p.CodiceCitta) +
      "|" +
      format2(p.CodicePresidio)
    );
  }

  if (changeType === "ADD_UBICAZIONE") {
    return (
      format2(p.CodiceCitta) +
      "|" +
      format2(p.CodicePresidio) +
      "|" +
      format3(p.CodiceUbicazione)
    );
  }

  if (changeType === "ADD_DISPOSITIVO") {
    return format11(
      p.CodiceCompleto ||
      p.codiceCompleto ||
      p.Codice ||
      p.codice ||
      ""
    );
  }

  return "";
}

function cvlsGetPendingArchiveChange(changeType, item) {
  const wantedKey = cvlsGetArchivePendingKey(changeType, item);

  if (!wantedKey) {
    return {
      pending: [],
      change: null,
      index: -1
    };
  }

  const pending = getPendingChanges();

  const index = pending.findIndex(function (change) {
    if (!change || change.type !== changeType) {
      return false;
    }

    return (
      cvlsGetArchivePendingKey(
        changeType,
        change.payload || {}
      ) === wantedKey
    );
  });

  return {
    pending: pending,
    change: index >= 0 ? pending[index] : null,
    index: index
  };
}

function cvlsAvvisaDatoGiaSincronizzato() {
  cvlsAlert(
    "Impossibile effettuare modifica, dato già sincronizzato.",
    "Modifica non consentita"
  );
}

function cvlsRemovePendingChangesWhere(predicate) {
  const pending = getPendingChanges();

  const filtered = pending.filter(function (change) {
    return !predicate(change);
  });

  localStorage.setItem(
    STORAGE_KEYS.PENDING_CHANGES,
    JSON.stringify(filtered)
  );

  updateStatusBox();

  return pending.length - filtered.length;
}

function cvlsIsDeviceCodeInSet(value, deviceCodeSet) {
  const codice = format11(value || "");

  return codice && deviceCodeSet.has(codice);
}

function modificaNomeCitta(citta) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!citta) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_CITTA",
    citta
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const codiceCitta = format2(citta.CodiceCitta);
  const nomeAttuale = String(citta.NomeCitta || "").trim();

  cvlsPrompt(
    "Inserisci il nuovo nome della città.",
    function (value) {
      const nuovoNome = String(value || "").trim();

      if (!nuovoNome) {
        cvlsAlert("Il nome città non può essere vuoto.", "Nome non valido");
        return;
      }

      if (normalizeName(nuovoNome) === normalizeName(nomeAttuale)) {
        return;
      }

      const duplicato = dati.citta.some(function (item) {
        if (!item) {
          return false;
        }

        return (
          format2(item.CodiceCitta) !== codiceCitta &&
          normalizeName(item.NomeCitta) === normalizeName(nuovoNome)
        );
      });

      if (duplicato) {
        cvlsAlert(
          "Esiste già una città con questo nome.",
          "Nome già presente"
        );
        return;
      }

      const target = dati.citta.find(function (item) {
        return format2(item && item.CodiceCitta) === codiceCitta;
      });

      if (!target) {
        cvlsAlert("Città non trovata.", "Errore");
        return;
      }

      target.NomeCitta = nuovoNome;

      if (
        selezione.citta &&
        format2(selezione.citta.CodiceCitta) === codiceCitta
      ) {
        selezione.citta.NomeCitta = nuovoNome;
      }

      pendingInfo.change.payload = {
        ...(pendingInfo.change.payload || {}),
        ...target,
        NomeCitta: nuovoNome
      };

      pendingInfo.change.updatedAt = new Date().toISOString();

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();

      renderArchivio([
        "listaCitta"
      ]);

      showCvlsToast("Nome città aggiornato");
    },
    {
      title: "Modifica città",
      value: nomeAttuale,
      placeholder: "Nome città"
    }
  );
}

function eliminaCittaNonSincronizzata(citta) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!citta) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_CITTA",
    citta
  );

  if (!pendingInfo.change) {
    cvlsAlert(
      "Impossibile eliminare, dato già sincronizzato.",
      "Eliminazione non consentita"
    );
    return;
  }

  const codiceCitta = format2(citta.CodiceCitta);
  const nomeCitta = String(citta.NomeCitta || "");

  cvlsConfirm(
    "Vuoi eliminare la città non ancora sincronizzata: " + nomeCitta + "? Verranno eliminati anche eventuali presidi, ubicazioni e dispositivi collegati non sincronizzati.",
    function () {
      const dispositiviDaEliminare = dati.dispositivi
        .filter(function (dispositivo) {
          return format2(dispositivo.CodiceCitta) === codiceCitta;
        })
        .map(function (dispositivo) {
          return format11(dispositivo.CodiceCompleto);
        });

      const deviceCodeSet = new Set(dispositiviDaEliminare);

      dati.citta = dati.citta.filter(function (item) {
        return format2(item && item.CodiceCitta) !== codiceCitta;
      });

      dati.presidi = dati.presidi.filter(function (item) {
        return format2(item && item.CodiceCitta) !== codiceCitta;
      });

      dati.ubicazioni = dati.ubicazioni.filter(function (item) {
        return format2(item && item.CodiceCitta) !== codiceCitta;
      });

      dati.dispositivi = dati.dispositivi.filter(function (item) {
        return format2(item && item.CodiceCitta) !== codiceCitta;
      });

      dispositiviDaEliminare.forEach(function (codice) {
        if (dati.macchine) {
          delete dati.macchine[codice];
        }

        if (dati.manutenzioni) {
          delete dati.manutenzioni[codice];
        }

        if (dati.materiali) {
          delete dati.materiali[codice];
        }

        if (dati.allegati) {
          delete dati.allegati[codice];
        }

        if (dati.note) {
          delete dati.note[codice];
        }

        if (dati.cvls) {
          delete dati.cvls[codice];
        }
      });

      if (Array.isArray(dati.programmazioni)) {
        dati.programmazioni = dati.programmazioni.filter(function (item) {
          return !cvlsIsDeviceCodeInSet(
            item.deviceId || item.codiceCompleto || "",
            deviceCodeSet
          );
        });
      }

      cvlsRemovePendingChangesWhere(function (change) {
        if (!change) {
          return false;
        }

        const payload = change.payload || {};

        if (
          change.type === "ADD_CITTA" &&
          format2(payload.CodiceCitta) === codiceCitta
        ) {
          return true;
        }

        if (
          change.type === "ADD_PRESIDIO" &&
          format2(payload.CodiceCitta) === codiceCitta
        ) {
          return true;
        }

        if (
          change.type === "ADD_UBICAZIONE" &&
          format2(payload.CodiceCitta) === codiceCitta
        ) {
          return true;
        }

        if (
          change.type === "ADD_DISPOSITIVO" &&
          format2(payload.CodiceCitta) === codiceCitta
        ) {
          return true;
        }

        if (cvlsIsDeviceCodeInSet(change.deviceId || "", deviceCodeSet)) {
          return true;
        }

        return cvlsIsDeviceCodeInSet(
          payload.deviceId ||
          payload.codiceCompleto ||
          payload.CodiceCompleto ||
          "",
          deviceCodeSet
        );
      });

      if (
        selezione.citta &&
        format2(selezione.citta.CodiceCitta) === codiceCitta
      ) {
        selezione.citta = null;
        selezione.presidio = null;
        selezione.ubicazione = null;

        document
          .getElementById("boxPresidi")
          .classList.add("hidden");

        document
          .getElementById("boxUbicazioni")
          .classList.add("hidden");

        document
          .getElementById("boxDispositivi")
          .classList.add("hidden");
      }

      saveLocalData();
      renderArchivio();

      showCvlsToast("Città eliminata");
    },
    null,
    "Elimina città"
  );
}

function modificaNomeDispositivo(dispositivo) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  function eliminaDispositivoNonSincronizzato(dispositivo) {
    if (cvlsSyncInProgress) {
      showCvlsToast("Attendi la fine della sincronizzazione");
      return;
    }

    if (!dispositivo) {
      return;
    }

    const pendingInfo = cvlsGetPendingArchiveChange(
      "ADD_DISPOSITIVO",
      dispositivo
    );

    if (!pendingInfo.change) {
      deleteDispositivo(
        format11(dispositivo.CodiceCompleto),
        dispositivo.NomeDispositivo
      );
      return;
    }

    const codice = format11(dispositivo.CodiceCompleto);
    const nome = String(dispositivo.NomeDispositivo || "");

    cvlsConfirm(
      "Vuoi eliminare il dispositivo non ancora sincronizzato: " + nome + "?",
      function () {
        dati.dispositivi = dati.dispositivi.filter(function (item) {
          return format11(item && item.CodiceCompleto) !== codice;
        });

        if (dati.macchine) {
          delete dati.macchine[codice];
        }

        if (dati.manutenzioni) {
          delete dati.manutenzioni[codice];
        }

        if (dati.materiali) {
          delete dati.materiali[codice];
        }

        if (dati.allegati) {
          delete dati.allegati[codice];
        }

        if (dati.note) {
          delete dati.note[codice];
        }

        if (dati.cvls) {
          delete dati.cvls[codice];
        }

        if (Array.isArray(dati.programmazioni)) {
          dati.programmazioni = dati.programmazioni.filter(function (item) {
            return (
              format11(item.deviceId || item.codiceCompleto || "") !== codice
            );
          });
        }

        cvlsRemovePendingChangesWhere(function (change) {
          if (!change) {
            return false;
          }

          const payload = change.payload || {};

          if (
            change.type === "ADD_DISPOSITIVO" &&
            cvlsGetArchivePendingKey(
              "ADD_DISPOSITIVO",
              payload
            ) === codice
          ) {
            return true;
          }

          if (format11(change.deviceId || "") === codice) {
            return true;
          }

          return (
            format11(
              payload.deviceId ||
              payload.codiceCompleto ||
              payload.CodiceCompleto ||
              ""
            ) === codice
          );
        });

        if (currentDeviceId === codice) {
          currentDeviceId = null;
          currentDeviceData = null;
        }

        saveLocalData();
        renderArchivio();

        showCvlsToast("Dispositivo eliminato");
      },
      null,
      "Elimina dispositivo"
    );
  }

  if (!dispositivo) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_DISPOSITIVO",
    dispositivo
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const codice = format11(dispositivo.CodiceCompleto);
  const nomeAttuale = String(dispositivo.NomeDispositivo || "").trim();

  cvlsPrompt(
    "Inserisci il nuovo nome del dispositivo.",
    function (value) {
      const nuovoNome = String(value || "").trim();

      if (!nuovoNome) {
        cvlsAlert("Il nome dispositivo non può essere vuoto.", "Nome non valido");
        return;
      }

      if (normalizeName(nuovoNome) === normalizeName(nomeAttuale)) {
        return;
      }

      const duplicato = dati.dispositivi.some(function (item) {
        if (!item) {
          return false;
        }

        return (
          format11(item.CodiceCompleto) !== codice &&
          format2(item.CodiceCitta) === format2(dispositivo.CodiceCitta) &&
          format2(item.CodicePresidio) === format2(dispositivo.CodicePresidio) &&
          format3(item.CodiceUbicazione) === format3(dispositivo.CodiceUbicazione) &&
          normalizeName(item.NomeDispositivo) === normalizeName(nuovoNome)
        );
      });

      if (duplicato) {
        cvlsAlert(
          "Esiste già un dispositivo con questo nome nella stessa ubicazione.",
          "Nome già presente"
        );
        return;
      }

      const target = dati.dispositivi.find(function (item) {
        return format11(item && item.CodiceCompleto) === codice;
      });

      if (!target) {
        cvlsAlert("Dispositivo non trovato.", "Errore");
        return;
      }

      target.NomeDispositivo = nuovoNome;

      if (dati.macchine && dati.macchine[codice]) {
        dati.macchine[codice].dispositivo = nuovoNome;
      }

      if (
        currentDeviceData &&
        format11(currentDeviceData.CodiceCompleto) === codice
      ) {
        currentDeviceData.NomeDispositivo = nuovoNome;
      }

      pendingInfo.change.payload = {
        ...(pendingInfo.change.payload || {}),
        ...target,
        NomeDispositivo: nuovoNome
      };

      pendingInfo.change.updatedAt = new Date().toISOString();

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();
      renderArchivio();

      showCvlsToast("Nome dispositivo aggiornato");
    },
    {
      title: "Modifica dispositivo",
      value: nomeAttuale,
      placeholder: "Nome dispositivo"
    }
  );
}

function eliminaDispositivoNonSincronizzato(dispositivo) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!dispositivo) {
    return;
  }

  const pendingInfo = cvlsGetPendingArchiveChange(
    "ADD_DISPOSITIVO",
    dispositivo
  );

  if (!pendingInfo.change) {
    deleteDispositivo(
      format11(dispositivo.CodiceCompleto),
      dispositivo.NomeDispositivo
    );
    return;
  }

  const codice = format11(dispositivo.CodiceCompleto);
  const nome = String(dispositivo.NomeDispositivo || "");

  cvlsConfirm(
    "Vuoi eliminare il dispositivo non ancora sincronizzato: " + nome + "?",
    function () {
      dati.dispositivi = dati.dispositivi.filter(function (item) {
        return format11(item && item.CodiceCompleto) !== codice;
      });

      if (dati.macchine) {
        delete dati.macchine[codice];
      }

      if (dati.manutenzioni) {
        delete dati.manutenzioni[codice];
      }

      if (dati.materiali) {
        delete dati.materiali[codice];
      }

      if (dati.allegati) {
        delete dati.allegati[codice];
      }

      if (dati.note) {
        delete dati.note[codice];
      }

      if (dati.cvls) {
        delete dati.cvls[codice];
      }

      if (Array.isArray(dati.programmazioni)) {
        dati.programmazioni = dati.programmazioni.filter(function (item) {
          return (
            format11(item.deviceId || item.codiceCompleto || "") !== codice
          );
        });
      }

      cvlsRemovePendingChangesWhere(function (change) {
        if (!change) {
          return false;
        }

        const payload = change.payload || {};

        if (
          change.type === "ADD_DISPOSITIVO" &&
          cvlsGetArchivePendingKey(
            "ADD_DISPOSITIVO",
            payload
          ) === codice
        ) {
          return true;
        }

        if (format11(change.deviceId || "") === codice) {
          return true;
        }

        return (
          format11(
            payload.deviceId ||
            payload.codiceCompleto ||
            payload.CodiceCompleto ||
            ""
          ) === codice
        );
      });

      if (currentDeviceId === codice) {
        currentDeviceId = null;
        currentDeviceData = null;
      }

      saveLocalData();
      renderArchivio();

      showCvlsToast("Dispositivo eliminato");
    },
    null,
    "Elimina dispositivo"
  );
}

function renderDispositivi() {
  const div = document.getElementById("listaDispositivi");
  const noDispositivo = document.getElementById("noDispositivo");
  const ricerca = getValue("cercaDispositivo").toLowerCase().trim();

  div.innerHTML = "";
  aggiornaScorrimentoListaArchivio(div, 4);

  if (
    !selezione.citta ||
    !selezione.presidio ||
    !selezione.ubicazione
  ) {
    return;
  }

  const filtrati = dati.dispositivi.filter(function (dispositivo) {
    return (
      format2(dispositivo.CodiceCitta) ===
      format2(selezione.citta.CodiceCitta) &&
      format2(dispositivo.CodicePresidio) ===
      format2(selezione.presidio.CodicePresidio) &&
      format3(dispositivo.CodiceUbicazione) ===
      format3(selezione.ubicazione.CodiceUbicazione) &&
      (
        String(dispositivo.NomeDispositivo || "")
          .toLowerCase()
          .includes(ricerca) ||
        String(dispositivo.CodiceCompleto || "")
          .toLowerCase()
          .includes(ricerca) ||
        format11(dispositivo.CodiceCompleto)
          .includes(ricerca)
      )
    );
  });

  const lista =
    ordinaDispositiviUltimiAggiunti(filtrati);

  noDispositivo.classList.toggle("hidden", lista.length > 0 || !ricerca);

  lista.forEach(d => {
    const codice = format11(d.CodiceCompleto);
    const link = d.LinkQR || d.linkQR || d.LinkQr || d.link_qr || "Non generato";

    const richiestaEliminazione = getDeleteRequestForDevice(codice);
    const statoEliminazione = normalizeDeleteRequestState(
      richiestaEliminazione && richiestaEliminazione.Stato
    );
    const eliminazioneBloccante = isDeleteRequestBlocking(richiestaEliminazione);
    const testoStatoEliminazione = getDeleteRequestStatusText(richiestaEliminazione);

    const el = document.createElement("div");
    el.className = "item device-item";

    if (eliminazioneBloccante) {
      el.classList.add("device-delete-pending");
    }

    if (statoEliminazione === "rifiutato") {
      el.classList.add("device-delete-refused");
    }

    el.innerHTML = `
      <div class="device-longpress-zone" data-device-zone="main">
        <div><strong>${escapeHtml(d.NomeDispositivo)}</strong></div>
        <div class="codice">Codice dispositivo: ${format4(d.CodiceDispositivo)}</div>
        <div class="codice">Codice completo: ${codice}</div>
        <div class="codice">Programma: ${escapeHtml(d.TipoProgramma || "")}</div>
      </div>

      <div class="device-actions">
        <button class="open-btn" data-action="open">Apri scheda</button>
        <button class="open-btn" data-action="qr">Stampa QR</button>
      </div>

      <div class="qr-link">QR link: ${escapeHtml(link)}</div>

${testoStatoEliminazione
        ? `<div class="delete-request-status delete-request-status-${escapeHtml(statoEliminazione)}">
        ${escapeHtml(testoStatoEliminazione)}
      </div>`
        : ""
      }
`;

    const mainZone = el.querySelector('[data-device-zone="main"]');

    if (mainZone) {
      mainZone.onclick = function (event) {
        event.stopPropagation();

        if (eliminazioneBloccante) {
          showCvlsToast("Richiesta di cancellazione in attesa di conferma");
          return;
        }

        openDevice(codice);
      };

      if (!eliminazioneBloccante) {
        abilitaMenuPressioneLunga(mainZone, {
          title: d.NomeDispositivo || "Dispositivo",
          modifica: function () {
            modificaNomeDispositivo(d);
          },
          elimina: function () {
            const dispositivoNonSincronizzato =
              !!cvlsGetPendingArchiveChange(
                "ADD_DISPOSITIVO",
                d
              ).change;

            if (dispositivoNonSincronizzato) {
              eliminaDispositivoNonSincronizzato(d);
              return;
            }

            deleteDispositivo(codice, d.NomeDispositivo);
          },
          puoModificare: true,
          puoEliminare: true
        });
      }
    }

    const openBtn = el.querySelector('[data-action="open"]');
    const qrBtn = el.querySelector('[data-action="qr"]');

    if (eliminazioneBloccante) {
      if (openBtn) openBtn.disabled = true;
      if (qrBtn) qrBtn.disabled = true;
    } else {
      if (openBtn) {
        openBtn.onclick = event => {
          event.stopPropagation();
          openDevice(codice);
        };
      }

      if (qrBtn) {
        qrBtn.onclick = event => {
          event.stopPropagation();
          generaQR(d);
        };
      }
    }

    div.appendChild(el);
  });

  aggiornaScorrimentoListaArchivio(div, 4);
}

/* =========================
   AGGIUNTE ARCHIVIO
========================= */

function addCitta() {
  cvlsPrompt(
    "Scrivi il nome della nuova città",
    function (nome) {
      const nomeInserito = String(nome || "").trim();

      if (!nomeInserito) {
        return;
      }

      const nomePulito = normalizeName(nomeInserito);

      const esiste = dati.citta.some(function (c) {
        return normalizeName(c.NomeCitta) === nomePulito;
      });

      if (esiste) {
        cvlsAlert(
          "Questa città è già presente.",
          "Città già esistente"
        );
        return;
      }

      const codice = nextCode(
        dati.citta.map(function (c) {
          return c.CodiceCitta;
        }),
        2
      );

      const item = {
        ID: dati.citta.length + 1,
        CodiceCitta: codice,
        NomeCitta: nomeInserito
      };

      dati.citta.push(item);

      saveLocalData();
      savePendingChange({
        type: "ADD_CITTA",
        payload: item
      });

      renderArchivio();
    },
    {
      title: "Nuova città",
      placeholder: "Nome città"
    }
  );
}

function addPresidio() {
  if (!selezione.citta) {
    cvlsAlert(
      "Prima seleziona una città.",
      "Selezione richiesta"
    );
    return;
  }

  cvlsPrompt(
    "Scrivi il nome del nuovo presidio",
    function (nome) {
      const nomeInserito = String(nome || "").trim();

      if (!nomeInserito) {
        return;
      }

      const lista = dati.presidi.filter(function (p) {
        return (
          format2(p.CodiceCitta) ===
          format2(selezione.citta.CodiceCitta)
        );
      });

      const esiste = lista.some(function (p) {
        return (
          normalizeName(p.NomePresidio) ===
          normalizeName(nomeInserito)
        );
      });

      if (esiste) {
        cvlsAlert(
          "Questo presidio è già presente in questa città.",
          "Presidio già esistente"
        );
        return;
      }

      const codice = nextCode(
        lista.map(function (p) {
          return p.CodicePresidio;
        }),
        2
      );

      const item = {
        ID: dati.presidi.length + 1,
        CodiceCitta: format2(
          selezione.citta.CodiceCitta
        ),
        CodicePresidio: codice,
        NomePresidio: nomeInserito
      };

      dati.presidi.push(item);

      saveLocalData();
      savePendingChange({
        type: "ADD_PRESIDIO",
        payload: item
      });

      renderArchivio();
    },
    {
      title: "Nuovo presidio",
      placeholder: "Nome presidio"
    }
  );
}

function addUbicazione() {
  if (!selezione.citta || !selezione.presidio) {
    cvlsAlert(
      "Prima seleziona città e presidio.",
      "Selezione richiesta"
    );
    return;
  }

  cvlsPrompt(
    "Scrivi il nome della nuova ubicazione",
    function (nome) {
      const nomeInserito = String(nome || "").trim();

      if (!nomeInserito) {
        return;
      }

      const lista = dati.ubicazioni.filter(function (u) {
        return (
          format2(u.CodiceCitta) ===
          format2(selezione.citta.CodiceCitta) &&
          format2(u.CodicePresidio) ===
          format2(selezione.presidio.CodicePresidio)
        );
      });

      const esiste = lista.some(function (u) {
        return (
          normalizeName(u.NomeUbicazione) ===
          normalizeName(nomeInserito)
        );
      });

      if (esiste) {
        cvlsAlert(
          "Questa ubicazione è già presente in questo presidio.",
          "Ubicazione già esistente"
        );
        return;
      }

      const codice = nextCode(
        lista.map(function (u) {
          return u.CodiceUbicazione;
        }),
        3
      );

      const item = {
        ID: dati.ubicazioni.length + 1,
        CodiceCitta: format2(
          selezione.citta.CodiceCitta
        ),
        CodicePresidio: format2(
          selezione.presidio.CodicePresidio
        ),
        CodiceUbicazione: codice,
        NomeUbicazione: nomeInserito
      };

      dati.ubicazioni.push(item);

      saveLocalData();
      savePendingChange({
        type: "ADD_UBICAZIONE",
        payload: item
      });

      renderArchivio();
    },
    {
      title: "Nuova ubicazione",
      placeholder: "Nome ubicazione"
    }
  );
}

function openAddDispositivoModal() {
  if (
    !selezione.citta ||
    !selezione.presidio ||
    !selezione.ubicazione
  ) {
    cvlsAlert(
      "Prima seleziona città, presidio e ubicazione.",
      "Selezione richiesta"
    );
    return;
  }

  document.getElementById(
    "popupNomeDispositivo"
  ).value = "";

  document.getElementById(
    "popupTipoProgramma"
  ).value = "Scheda Manutenzione";

  document
    .getElementById("popupDispositivoModal")
    .classList.add("show");

  window.setTimeout(function () {
    document
      .getElementById("popupNomeDispositivo")
      .focus();
  }, 120);
}

function closeAddDispositivoModal() {
  document
    .getElementById("popupDispositivoModal")
    .classList.remove("show");
}

function addDispositivoFromModal() {
  if (!selezione.citta || !selezione.presidio || !selezione.ubicazione) {
    alert("Prima seleziona città, presidio e ubicazione.");
    return;
  }

  const nome = getValue("popupNomeDispositivo").trim();
  const tipoProgramma = getValue("popupTipoProgramma") || "Scheda Manutenzione";

  if (!nome) {
    alert("Scrivi il nome del dispositivo.");
    return;
  }

  const lista = dati.dispositivi.filter(d =>
    format2(d.CodiceCitta) === format2(selezione.citta.CodiceCitta) &&
    format2(d.CodicePresidio) === format2(selezione.presidio.CodicePresidio) &&
    format3(d.CodiceUbicazione) === format3(selezione.ubicazione.CodiceUbicazione)
  );

  const esiste = lista.some(d => normalizeName(d.NomeDispositivo) === normalizeName(nome));
  if (esiste) {
    alert("Questo dispositivo è già presente in questa ubicazione.");
    return;
  }

  const codiceDispositivo = nextCode(lista.map(d => d.CodiceDispositivo), 4);
  const codiceCompleto =
    format2(selezione.citta.CodiceCitta) +
    format2(selezione.presidio.CodicePresidio) +
    format3(selezione.ubicazione.CodiceUbicazione) +
    codiceDispositivo;

  const item = {
    ID: dati.dispositivi.length + 1,
    CodiceCompleto: codiceCompleto,
    CodiceCitta: format2(selezione.citta.CodiceCitta),
    CodicePresidio: format2(selezione.presidio.CodicePresidio),
    CodiceUbicazione: format3(selezione.ubicazione.CodiceUbicazione),
    CodiceDispositivo: codiceDispositivo,
    NomeDispositivo: nome,
    TipoProgramma: tipoProgramma,
    LinkQR: creaLinkPubblicoManutenzione({ CodiceCompleto: codiceCompleto, TipoProgramma: tipoProgramma }),
    NomeCitta: selezione.citta.NomeCitta,
    NomePresidio: selezione.presidio.NomePresidio,
    NomeUbicazione: selezione.ubicazione.NomeUbicazione
  };

  dati.dispositivi.push(item);

  ensureDeviceData(codiceCompleto, item);

  saveLocalData();
  savePendingChange({ type: "ADD_DISPOSITIVO", payload: item });
  closeAddDispositivoModal();
  renderArchivio();

  cvlsConfirm("Dispositivo aggiunto. Vuoi aprire subito la scheda?", function () {
    openDevice(codiceCompleto);
  });
}

function createDeleteRequestId() {
  return (
    "DEL-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 10).toUpperCase()
  );
}

function savePendingDeleteRequestChange(request) {
  const pending = getPendingChanges();
  const codice = getDeleteRequestCode(request);
  const deviceKey = getDeleteRequestDeviceKey(request);
  const now = new Date().toISOString();

  const existing = pending.find(function (change) {
    if (!change || change.type !== "REQUEST_DELETE_DISPOSITIVO") {
      return false;
    }

    const payload = change.payload || {};

    return (
      getDeleteRequestCode(payload) === codice &&
      getDeleteRequestDeviceKey(payload) === deviceKey
    );
  });

  if (existing) {
    existing.deviceId = codice;
    existing.payload = { ...request };
    existing.updatedAt = now;

    if (!existing.changeId) {
      existing.changeId = createPendingChangeId();
    }

    if (!existing.createdAt) {
      existing.createdAt = request.DataRichiesta || now;
    }
  } else {
    pending.push({
      changeId: createPendingChangeId(),
      type: "REQUEST_DELETE_DISPOSITIVO",
      deviceId: codice,
      payload: { ...request },
      createdAt: request.DataRichiesta || now
    });
  }

  localStorage.setItem(
    STORAGE_KEYS.PENDING_CHANGES,
    JSON.stringify(pending)
  );

  updateStatusBox();
}

function deleteDispositivo(codiceCompleto, nomeDispositivo) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const codice = format11(codiceCompleto);
  const deviceKey = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_KEY) || ""
  ).trim();
  const identificativo = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_IDENTIFIER) || ""
  ).trim();
  const richiestaEsistente = getDeleteRequestForDevice(codice);

  if (isDeleteRequestBlocking(richiestaEsistente)) {
    cvlsAlert(
      "La richiesta di cancellazione è già in attesa di conferma.",
      "Richiesta già presente"
    );
    return;
  }

  if (!deviceKey) {
    cvlsAlert(
      "DeviceKey non disponibile. Sincronizza nuovamente l’autorizzazione del dispositivo.",
      "Richiesta non disponibile"
    );
    return;
  }

  cvlsConfirm(
    "Vuoi richiedere la cancellazione del dispositivo: " + nomeDispositivo + "?",
    function () {
      const now = new Date().toISOString();

      const request = {
        IDRichiesta:
          (richiestaEsistente && richiestaEsistente.IDRichiesta) ||
          createDeleteRequestId(),
        CodiceCompleto: codice,
        NomeDispositivo: String(nomeDispositivo || ""),
        DeviceKeyRichiedente: deviceKey,
        IdentificativoDispositivo: identificativo,
        Stato: "in_attesa",
        DataRichiesta: now,
        DataAutorizzazione: "",
        DataRifiuto: "",
        DataEsecuzione: "",
        Note: ""
      };

      upsertLocalDeleteRequest(request);
      saveLocalData();
      savePendingDeleteRequestChange(request);
      renderArchivio();

      cvlsAlert(
        "Richiesta di cancellazione in attesa di conferma",
        "Richiesta registrata"
      );
    },
    null,
    "Elimina dispositivo"
  );
}

/* =========================
   DISPOSITIVO
========================= */

/* =========================================================
   NAVIGAZIONE AVANTI
========================================================= */

function cvlsCaptureNavigationState() {
  const paginaDispositivo =
    document.getElementById("pageDispositivo");

  const pagina2 =
    document.getElementById("page2");

  return {
    page:
      paginaDispositivo &&
        paginaDispositivo.classList.contains("active")
        ? "dispositivo"
        : "archivio",

    deviceId: currentDeviceId || "",

    subpage:
      pagina2 &&
        pagina2.classList.contains("active")
        ? 2
        : 1,

    codiceCitta:
      selezione.citta
        ? format2(selezione.citta.CodiceCitta)
        : "",

    codicePresidio:
      selezione.presidio
        ? format2(selezione.presidio.CodicePresidio)
        : "",

    codiceUbicazione:
      selezione.ubicazione
        ? format3(selezione.ubicazione.CodiceUbicazione)
        : "",

    scrollY: Math.max(
      0,
      Number(window.scrollY) || 0
    )
  };
}

function cvlsRememberForwardState() {
  const state =
    cvlsCaptureNavigationState();

  cvlsForwardHistory.push(state);

  /*
   * Evita che la cronologia cresca senza limite.
   */
  if (cvlsForwardHistory.length > 20) {
    cvlsForwardHistory.shift();
  }
}

function cvlsClearForwardHistory() {
  if (cvlsRestoringNavigation) {
    return;
  }

  cvlsForwardHistory = [];
}

function cvlsRestoreArchiveSelection(state) {
  selezione.citta =
    state.codiceCitta
      ? dati.citta.find(function (citta) {
        return (
          format2(citta.CodiceCitta) ===
          state.codiceCitta
        );
      }) || null
      : null;

  selezione.presidio =
    state.codicePresidio
      ? dati.presidi.find(function (presidio) {
        return (
          format2(presidio.CodiceCitta) ===
          state.codiceCitta &&
          format2(presidio.CodicePresidio) ===
          state.codicePresidio
        );
      }) || null
      : null;

  selezione.ubicazione =
    state.codiceUbicazione
      ? dati.ubicazioni.find(function (ubicazione) {
        return (
          format2(ubicazione.CodiceCitta) ===
          state.codiceCitta &&
          format2(ubicazione.CodicePresidio) ===
          state.codicePresidio &&
          format3(ubicazione.CodiceUbicazione) ===
          state.codiceUbicazione
        );
      }) || null
      : null;
}

function cvlsUpdateArchiveVisibility() {
  const boxPresidi =
    document.getElementById("boxPresidi");

  const boxUbicazioni =
    document.getElementById("boxUbicazioni");

  const boxDispositivi =
    document.getElementById("boxDispositivi");

  if (boxPresidi) {
    boxPresidi.classList.toggle(
      "hidden",
      !selezione.citta
    );
  }

  if (boxUbicazioni) {
    boxUbicazioni.classList.toggle(
      "hidden",
      !selezione.citta ||
      !selezione.presidio
    );
  }

  if (boxDispositivi) {
    boxDispositivi.classList.toggle(
      "hidden",
      !selezione.citta ||
      !selezione.presidio ||
      !selezione.ubicazione
    );
  }
}

function cvlsNavigationOverlayIsOpen() {
  const cvlsDialog =
    document.getElementById("cvlsDialogOverlay");

  if (
    cvlsDialog &&
    cvlsDialog.classList.contains("show")
  ) {
    return true;
  }

  if (document.getElementById("appleModalRoot")) {
    return true;
  }

  if (document.getElementById("qrOverlay")) {
    return true;
  }

  const sideMenu =
    document.getElementById("sideMenu");

  if (
    sideMenu &&
    sideMenu.classList.contains("open")
  ) {
    return true;
  }

  const searchModal =
    document.getElementById("searchModal");

  if (
    searchModal &&
    !searchModal.classList.contains("hidden")
  ) {
    return true;
  }

  const dispositivoModal =
    document.getElementById(
      "popupDispositivoModal"
    );

  if (
    dispositivoModal &&
    dispositivoModal.classList.contains("show")
  ) {
    return true;
  }

  const programmaModal =
    document.getElementById(
      "popupProgrammaManutenzione"
    );

  if (
    programmaModal &&
    !programmaModal.classList.contains("hidden")
  ) {
    return true;
  }

  return false;
}

function cvlsNavigateForward() {
  if (cvlsSyncInProgress) {
    showCvlsToast(
      "Attendi il completamento della sincronizzazione"
    );

    return false;
  }

  if (cvlsNavigationOverlayIsOpen()) {
    return false;
  }

  if (cvlsForwardHistory.length === 0) {
    return false;
  }

  const state =
    cvlsForwardHistory.pop();

  cvlsRestoringNavigation = true;

  try {
    cvlsRestoreArchiveSelection(state);
    cvlsUpdateArchiveVisibility();
    renderArchivio();

    if (
      state.page === "dispositivo" &&
      state.deviceId
    ) {
      openDevice(state.deviceId);

      const manutenzioneBox =
        document.getElementById(
          "manutenzioneBox"
        );

      if (
        state.subpage === 2 &&
        manutenzioneBox &&
        !manutenzioneBox.classList.contains("hidden")
      ) {
        goDeviceSubpage(2, true);
      }
    } else {
      tornaArchivio();
      cvlsUpdateArchiveVisibility();
      renderArchivio();
    }

    window.setTimeout(function () {
      window.scrollTo(
        0,
        Math.max(0, Number(state.scrollY) || 0)
      );
    }, 0);

    return true;

  } finally {
    cvlsRestoringNavigation = false;
  }
}

function handleTopbarLeftClick() {
  const isHome = document.getElementById("pageArchivio").classList.contains("active");
  if (isHome) {
    openSideMenu();
  } else {
    tornaArchivio();
  }
}

function updateTopbarLeftButton() {
  const openMenuBtn = document.getElementById("openMenuBtn");
  if (!openMenuBtn) return;

  const isHome = document.getElementById("pageArchivio").classList.contains("active");

  if (isHome) {
    openMenuBtn.innerHTML = '<span class="menu-icon">☰</span>';
    openMenuBtn.setAttribute("aria-label", "Menu");
  } else {
    // Custom clean vector SVG Home icon
    openMenuBtn.innerHTML = `
      <svg class="home-icon" viewBox="0 0 24 24" style="width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round;">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    `;
    openMenuBtn.setAttribute("aria-label", "Home");
  }
}

function openDevice(codiceCompleto) {
  const codice = format11(codiceCompleto);
  const richiestaEliminazione = getDeleteRequestForDevice(codice);

  if (isDeleteRequestBlocking(richiestaEliminazione)) {
    cvlsAlert(
      getDeleteRequestStatusText(richiestaEliminazione),
      "Dispositivo non disponibile"
    );
    return;
  }

  currentDeviceId = codice;
  currentDeviceData = dati.dispositivi.find(d => format11(d.CodiceCompleto) === currentDeviceId);

  if (!currentDeviceData) {
    alert("Dispositivo non trovato.");
    return;
  }
  cvlsClearForwardHistory();
  isLoggedTecnica = false;

  ensureDeviceData(currentDeviceId, currentDeviceData);

  document.getElementById("pageArchivio").classList.remove("active");
  document.getElementById("pageDispositivo").classList.add("active");

  const logoBox = document.querySelector(".logo-box");
  if (logoBox) logoBox.classList.add("hidden");

  document.getElementById("mainTitle").textContent = currentDeviceData.TipoProgramma || "Scheda dispositivo";
  document.getElementById("devicePath").textContent =
    `${currentDeviceData.NomeCitta || ""} / ${currentDeviceData.NomePresidio || ""} / ${currentDeviceData.NomeUbicazione || ""} / ${currentDeviceData.NomeDispositivo || ""} / Codice: ${currentDeviceId}`;

  document.getElementById("manutenzioneBox").classList.add("hidden");
  document.getElementById("cvlsBox").classList.add("hidden");

  /*
   * I pulsanti Modifica/Salva O2 partono sempre nascosti.
   * Verranno riattivati solo da renderCvls().
   */
  setCvlsHeaderActionsVisible(false, false);

  if (currentDeviceData.TipoProgramma === "Etichetta Sensore O2") {
    document.getElementById("cvlsBox").classList.remove("hidden");
    renderCvls();
  } else {
    document.getElementById("manutenzioneBox").classList.remove("hidden");
    goDeviceSubpage(1);
    renderAllManutenzione();
  }

  window.scrollTo(0, 0);
  updateTopbarLeftButton();
}

window.selectedRegistroPresenzePresidi = [];
window.selectedRegistroPresenzeUbicazioni = [];
window.selectedRegistroPresenzeLuoghi = [];
window.selectedRegistroPresenzePranzo = "";

const CVLS_REGISTRO_PRESENZE_PRANZO_STORAGE_KEY = "cvls_registro_presenze_pranzo";

function getRegistroPresenzePranzoArchivio() {
  try {
    const raw = localStorage.getItem(CVLS_REGISTRO_PRESENZE_PRANZO_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveRegistroPresenzePranzoLocal(bollaturaId, pausaPranzo) {
  const id = String(bollaturaId || "").trim();
  const value = String(pausaPranzo || "").trim();

  if (!id || !value) {
    return;
  }

  const archivio = getRegistroPresenzePranzoArchivio();
  archivio[id] = value;

  try {
    localStorage.setItem(
      CVLS_REGISTRO_PRESENZE_PRANZO_STORAGE_KEY,
      JSON.stringify(archivio)
    );
  } catch (error) {
    console.warn("Impossibile salvare la pausa pranzo locale:", error);
  }
}

function getRegistroPresenzePranzoById(bollaturaId) {
  const id = String(bollaturaId || "").trim();
  if (!id) {
    return "";
  }

  const archivio = getRegistroPresenzePranzoArchivio();
  return String(archivio[id] || "").trim();
}

window.saveRegistroPresenzePranzoLocal = saveRegistroPresenzePranzoLocal;
window.getRegistroPresenzePranzoById = getRegistroPresenzePranzoById;

function getRegistroPresenzePranzoSelection() {
  const selected = String(window.selectedRegistroPresenzePranzo || "").trim();
  if (selected) {
    return selected;
  }

  const checked = document.querySelector('input[data-reg-pres-pranzo="1"]:checked');
  return checked ? String(checked.value || "").trim() : "";
}

function resetRegistroPresenzePranzoSelection() {
  window.selectedRegistroPresenzePranzo = "";

  document.querySelectorAll('input[data-reg-pres-pranzo="1"]').forEach(function (input) {
    input.checked = false;
  });

  updateRegistroPresenzePranzoUI();
}

function updateRegistroPresenzePranzoUI() {
  const options = Array.from(document.querySelectorAll('input[data-reg-pres-pranzo="1"]'));
  const hint = document.getElementById("regPresPranzoHint");

  if (options.length === 0) {
    return;
  }

  const activeCheckin =
    window.CvlsGeobollatura &&
    typeof window.CvlsGeobollatura.getActiveCheckin === "function"
      ? window.CvlsGeobollatura.getActiveCheckin()
      : null;

  const enabled = !!activeCheckin;

  options.forEach(function (input) {
    input.disabled = !enabled;

    const label = input.closest("label");
    if (label) {
      label.style.opacity = enabled ? "1" : "0.55";
      label.style.cursor = enabled ? "pointer" : "not-allowed";
    }

    if (!enabled) {
      input.checked = false;
    }
  });

  if (!enabled) {
    window.selectedRegistroPresenzePranzo = "";
  }

  if (hint) {
    hint.textContent = enabled
      ? "Seleziona una pausa pranzo prima di bollare l'uscita."
      : "Selezionabile dopo la bollatura di ingresso.";
  }
}

function initRegistroPresenzePranzo() {
  const options = Array.from(document.querySelectorAll('input[data-reg-pres-pranzo="1"]'));

  if (options.length === 0) {
    return;
  }

  options.forEach(function (input) {
    if (input.dataset.cvlsPranzoBound === "1") {
      return;
    }

    input.dataset.cvlsPranzoBound = "1";

    input.addEventListener("change", function () {
      if (input.checked) {
        options.forEach(function (other) {
          if (other !== input) {
            other.checked = false;
          }
        });

        window.selectedRegistroPresenzePranzo = String(input.value || "").trim();
      } else if (!options.some(function (option) { return option.checked; })) {
        window.selectedRegistroPresenzePranzo = "";
      }
    });
  });

  updateRegistroPresenzePranzoUI();
}

window.getRegistroPresenzePranzoSelection = getRegistroPresenzePranzoSelection;
window.resetRegistroPresenzePranzoSelection = resetRegistroPresenzePranzoSelection;
window.updateRegistroPresenzePranzoUI = updateRegistroPresenzePranzoUI;

function initRegistroPresenzeLuogoSearch() {
  const presidioInput = document.getElementById("regPresPresidioInput");
  const presidioSuggestions = document.getElementById("regPresPresidioSuggestions");
  const presidioSelectedContainer = document.getElementById("regPresPresidioSelected");

  const ubicazioneInput = document.getElementById("regPresUbicazioneInput");
  const ubicazioneSuggestions = document.getElementById("regPresUbicazioneSuggestions");
  const ubicazioneSelectedContainer = document.getElementById("regPresUbicazioneSelected");

  const luogoInput = document.getElementById("regPresLuogoInput");
  const luogoSuggestions = document.getElementById("regPresLuogoSuggestions");
  const luogoSelectedContainer = document.getElementById("regPresLuogoSelected");
  const luogoSearchAvailable = !!(luogoInput && luogoSuggestions && luogoSelectedContainer);

  if (!presidioInput || !presidioSuggestions || !presidioSelectedContainer ||
      !ubicazioneInput || !ubicazioneSuggestions || !ubicazioneSelectedContainer) return;

  const activeCheckin = window.CvlsGeobollatura && typeof window.CvlsGeobollatura.getActiveCheckin === "function"
    ? window.CvlsGeobollatura.getActiveCheckin()
    : null;

  // I campi Presidio/Ubicazione devono restare sempre modificabili,
  // anche quando il tecnico e' gia' in servizio.
  presidioInput.disabled = false;
  ubicazioneInput.disabled = false;
  presidioInput.placeholder = "Cerca presidio...";
  ubicazioneInput.placeholder = "Cerca ubicazione...";
  presidioInput.value = "";
  ubicazioneInput.value = "";
  if (luogoSearchAvailable) {
    luogoInput.disabled = false;
    luogoInput.placeholder = "Cerca luogo...";
    luogoInput.value = "";
    luogoSuggestions.innerHTML = "";
    luogoSuggestions.style.display = "none";
  }
  presidioSuggestions.innerHTML = "";
  presidioSuggestions.style.display = "none";
  ubicazioneSuggestions.innerHTML = "";
  ubicazioneSuggestions.style.display = "none";

  function normalizzaRicercaRegistro(value) {
    return String(value || "").trim().toLowerCase();
  }

  function presidioKey(p) {
    return String(p && p.CodiceCitta !== undefined ? p.CodiceCitta : "") + "|" +
           String(p && p.CodicePresidio !== undefined ? p.CodicePresidio : "");
  }

  function ubicazioneKey(u) {
    return String(u && u.CodiceCitta !== undefined ? u.CodiceCitta : "") + "|" +
           String(u && u.CodicePresidio !== undefined ? u.CodicePresidio : "") + "|" +
           String(u && u.CodiceUbicazione !== undefined ? u.CodiceUbicazione : "");
  }

  function hasPresidioCodes(p) {
    return p && p.CodiceCitta !== undefined && p.CodiceCitta !== null && p.CodiceCitta !== "" &&
           p.CodicePresidio !== undefined && p.CodicePresidio !== null && p.CodicePresidio !== "";
  }

  function hasUbicazioneCodes(u) {
    return u && u.CodiceCitta !== undefined && u.CodiceCitta !== null && u.CodiceCitta !== "" &&
           u.CodicePresidio !== undefined && u.CodicePresidio !== null && u.CodicePresidio !== "" &&
           u.CodiceUbicazione !== undefined && u.CodiceUbicazione !== null && u.CodiceUbicazione !== "";
  }

  function findPresidioByName(name) {
    const normalized = normalizzaRicercaRegistro(name);
    const list = Array.isArray(dati.presidi) ? dati.presidi : [];
    return list.find(function (p) {
      return normalizzaRicercaRegistro(p.NomePresidio) === normalized;
    }) || null;
  }

  function findUbicazioneByName(name) {
    const normalized = normalizzaRicercaRegistro(name);
    const list = Array.isArray(dati.ubicazioni) ? dati.ubicazioni : [];
    return list.find(function (u) {
      return normalizzaRicercaRegistro(u.NomeUbicazione) === normalized;
    }) || null;
  }

  function findPresidioForUbicazione(ubicazione) {
    if (!ubicazione) return null;

    const list = Array.isArray(dati.presidi) ? dati.presidi : [];
    return list.find(function (p) {
      return String(p.CodiceCitta) === String(ubicazione.CodiceCitta) &&
             String(p.CodicePresidio) === String(ubicazione.CodicePresidio);
    }) || null;
  }

  function ensureRegistroPresenzeLuoghiArray() {
    if (!Array.isArray(window.selectedRegistroPresenzeLuoghi)) {
      window.selectedRegistroPresenzeLuoghi = [];
    }

    return window.selectedRegistroPresenzeLuoghi;
  }

  function luogoKey(luogo) {
    if (!luogo) return "";

    if (luogo.tipo === "ubicazione") {
      return "u|" +
        String(luogo.CodiceCitta || "") + "|" +
        String(luogo.CodicePresidio || "") + "|" +
        String(luogo.CodiceUbicazione || "");
    }

    return "p|" +
      String(luogo.CodiceCitta || "") + "|" +
      String(luogo.CodicePresidio || "");
  }

  function addUniqueName(target, value) {
    const clean = String(value || "").trim();
    if (!clean) return;

    const exists = target.some(function (item) {
      return normalizzaRicercaRegistro(item) === normalizzaRicercaRegistro(clean);
    });

    if (!exists) {
      target.push(clean);
    }
  }

  function getRegistroPresenzeLuogoNames() {
    const presidiNames = [];
    const ubicazioniNames = [];

    const presidiArr = Array.isArray(window.selectedRegistroPresenzePresidi)
      ? window.selectedRegistroPresenzePresidi
      : [];

    const ubicazioniArr = Array.isArray(window.selectedRegistroPresenzeUbicazioni)
      ? window.selectedRegistroPresenzeUbicazioni
      : [];

    const luoghiArr = ensureRegistroPresenzeLuoghiArray();

    presidiArr.forEach(function (p) {
      addUniqueName(presidiNames, p && p.NomePresidio);
    });

    ubicazioniArr.forEach(function (u) {
      addUniqueName(ubicazioniNames, u && u.NomeUbicazione);
    });

    luoghiArr.forEach(function (luogo) {
      addUniqueName(presidiNames, luogo && luogo.NomePresidio);

      if (luogo && luogo.tipo === "ubicazione") {
        addUniqueName(ubicazioniNames, luogo.NomeUbicazione);
      }
    });

    return {
      cittaNome: presidiNames.length > 0 ? presidiNames.join(", ") : null,
      cantiereNome: ubicazioniNames.length > 0 ? ubicazioniNames.join(", ") : null
    };
  }

  window.getRegistroPresenzeLuogoNames = getRegistroPresenzeLuogoNames;

  function sortBySearchPriority(a, b, fieldName, query) {
    const nameA = normalizzaRicercaRegistro(a && a[fieldName]);
    const nameB = normalizzaRicercaRegistro(b && b[fieldName]);
    const aStarts = nameA.indexOf(query) === 0;
    const bStarts = nameB.indexOf(query) === 0;

    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;

    return String(a && a[fieldName] || "").localeCompare(String(b && b[fieldName] || ""));
  }

  function matchesSmartSearch(name, query) {
    return normalizzaRicercaRegistro(name).indexOf(query) !== -1;
  }

  function getLuogoSearchResults(query) {
    const normalizedQuery = normalizzaRicercaRegistro(query);
    const results = [];
    const seen = {};

    if (!normalizedQuery) {
      return results;
    }

    const presidiList = Array.isArray(dati.presidi) ? dati.presidi : [];
    const ubicazioniList = Array.isArray(dati.ubicazioni) ? dati.ubicazioni : [];

    function pushResult(result) {
      if (!result || !result.key || seen[result.key]) {
        return;
      }

      seen[result.key] = true;
      results.push(result);
    }

    presidiList.forEach(function (p) {
      const nomePresidio = String(p && p.NomePresidio || "").trim();
      const normalizedName = normalizzaRicercaRegistro(nomePresidio);

      if (!nomePresidio || normalizedName.indexOf(normalizedQuery) === -1) {
        return;
      }

      pushResult({
        key: "p|" + String(p.CodiceCitta || "") + "|" + String(p.CodicePresidio || ""),
        tipo: "presidio",
        label: nomePresidio,
        score: normalizedName.indexOf(normalizedQuery) === 0 ? 0 : 40,
        presidio: p
      });
    });

    ubicazioniList.forEach(function (u) {
      const presidio = findPresidioForUbicazione(u);
      const nomePresidio = String(
        (presidio && presidio.NomePresidio) ||
        (u && u.NomePresidio) ||
        ""
      ).trim();
      const nomeUbicazione = String(u && u.NomeUbicazione || "").trim();

      if (!nomeUbicazione) {
        return;
      }

      const normalizedPresidio = normalizzaRicercaRegistro(nomePresidio);
      const normalizedUbicazione = normalizzaRicercaRegistro(nomeUbicazione);
      const presidioStarts = normalizedPresidio.indexOf(normalizedQuery) === 0;
      const presidioContains = normalizedPresidio.indexOf(normalizedQuery) !== -1;
      const ubicazioneStarts = normalizedUbicazione.indexOf(normalizedQuery) === 0;
      const ubicazioneContains = normalizedUbicazione.indexOf(normalizedQuery) !== -1;

      if (!presidioContains && !ubicazioneContains) {
        return;
      }

      let score = 80;
      if (ubicazioneStarts) {
        score = 10;
      } else if (ubicazioneContains) {
        score = 20;
      } else if (presidioStarts) {
        score = 30;
      } else if (presidioContains) {
        score = 50;
      }

      pushResult({
        key: "u|" +
          String(u.CodiceCitta || "") + "|" +
          String(u.CodicePresidio || "") + "|" +
          String(u.CodiceUbicazione || ""),
        tipo: "ubicazione",
        label: nomePresidio ? nomePresidio + " - " + nomeUbicazione : nomeUbicazione,
        score: score,
        presidio: presidio,
        ubicazione: u
      });
    });

    return results.sort(function (a, b) {
      if (a.score !== b.score) {
        return a.score - b.score;
      }

      return String(a.label || "").localeCompare(String(b.label || ""), "it", {
        sensitivity: "base"
      });
    });
  }

  function isLuogoAlreadySelected(result) {
    const key = result && result.key ? result.key : "";
    if (!key) return false;

    return ensureRegistroPresenzeLuoghiArray().some(function (selected) {
      return luogoKey(selected) === key;
    });
  }

  function addLuogoFromSearchResult(result) {
    if (!result || isLuogoAlreadySelected(result)) {
      return;
    }

    const luoghi = ensureRegistroPresenzeLuoghiArray();

    if (result.tipo === "ubicazione") {
      const u = result.ubicazione || {};
      const p = result.presidio || {};

      luoghi.push({
        tipo: "ubicazione",
        CodiceCitta: u.CodiceCitta,
        CodicePresidio: u.CodicePresidio,
        CodiceUbicazione: u.CodiceUbicazione,
        NomePresidio: p.NomePresidio || u.NomePresidio || "",
        NomeUbicazione: u.NomeUbicazione || ""
      });
    } else {
      const p = result.presidio || {};

      luoghi.push({
        tipo: "presidio",
        CodiceCitta: p.CodiceCitta,
        CodicePresidio: p.CodicePresidio,
        NomePresidio: p.NomePresidio || ""
      });
    }

    window.registroPresenzeLuogoTouched = true;
  }

  function selectedPresidioKeys() {
    return window.selectedRegistroPresenzePresidi
      .filter(hasPresidioCodes)
      .map(presidioKey);
  }

  function selectedUbicazionePresidioKeys() {
    return window.selectedRegistroPresenzeUbicazioni
      .filter(hasUbicazioneCodes)
      .map(function (u) {
        return String(u.CodiceCitta) + "|" + String(u.CodicePresidio);
      });
  }

  function isPresidioCompatibleWithSelectedUbicazioni(p) {
    const keys = selectedUbicazionePresidioKeys();
    if (keys.length === 0) return true;
    return keys.indexOf(presidioKey(p)) !== -1;
  }

  function isUbicazioneCompatibleWithSelectedPresidi(u) {
    const keys = selectedPresidioKeys();
    if (keys.length === 0) return true;
    return keys.indexOf(String(u.CodiceCitta) + "|" + String(u.CodicePresidio)) !== -1;
  }

  function reconcileUbicazioniWithSelectedPresidi() {
    if (!Array.isArray(window.selectedRegistroPresenzeUbicazioni)) {
      window.selectedRegistroPresenzeUbicazioni = [];
      return;
    }

    const keys = selectedPresidioKeys();
    if (keys.length === 0) return;

    window.selectedRegistroPresenzeUbicazioni = window.selectedRegistroPresenzeUbicazioni.filter(function (u) {
      if (!hasUbicazioneCodes(u)) return true;
      return keys.indexOf(String(u.CodiceCitta) + "|" + String(u.CodicePresidio)) !== -1;
    });
  }

  // Se la pagina viene riaperta durante un servizio gia' attivo,
  // carica i valori salvati nel check-in solo alla prima inizializzazione.
  if (activeCheckin && !window.registroPresenzeLuogoTouched) {
    if ((!Array.isArray(window.selectedRegistroPresenzePresidi) || window.selectedRegistroPresenzePresidi.length === 0) && activeCheckin.cittaNome) {
      window.selectedRegistroPresenzePresidi = [];
      activeCheckin.cittaNome.split(", ").forEach(function (name) {
        const matched = findPresidioByName(name);
        window.selectedRegistroPresenzePresidi.push(matched || { NomePresidio: name });
      });
    }

    if ((!Array.isArray(window.selectedRegistroPresenzeUbicazioni) || window.selectedRegistroPresenzeUbicazioni.length === 0) && activeCheckin.cantiereNome) {
      window.selectedRegistroPresenzeUbicazioni = [];
      activeCheckin.cantiereNome.split(", ").forEach(function (name) {
        const matched = findUbicazioneByName(name);
        window.selectedRegistroPresenzeUbicazioni.push(matched || { NomeUbicazione: name });
      });
    }
  }

  renderPresidioChips();
  renderUbicazioneChips();
  renderLuogoChips();

  function syncRegistroPresenzeActiveLuogo() {
    const active = window.CvlsGeobollatura && typeof window.CvlsGeobollatura.getActiveCheckin === "function"
      ? window.CvlsGeobollatura.getActiveCheckin()
      : null;
    if (!active) return;

    const names = getRegistroPresenzeLuogoNames();

    active.cittaNome = names.cittaNome;
    active.cantiereNome = names.cantiereNome;

    localStorage.setItem("cvls_attendance_active", JSON.stringify(active));
  }

  presidioInput.oninput = function () {
    const query = normalizzaRicercaRegistro(presidioInput.value);
    if (!query) {
      presidioSuggestions.innerHTML = "";
      presidioSuggestions.style.display = "none";
      return;
    }

    const list = Array.isArray(dati.presidi) ? dati.presidi : [];
    const filtered = list.filter(function (p) {
      return isPresidioCompatibleWithSelectedUbicazioni(p) &&
             matchesSmartSearch(p.NomePresidio, query);
    }).sort(function (a, b) {
      return sortBySearchPriority(a, b, "NomePresidio", query);
    });

    if (filtered.length === 0) {
      presidioSuggestions.innerHTML = '<div style="padding: 10px; color: #6b7280; font-size: 13px; text-align: center;">Nessun risultato</div>';
    } else {
      presidioSuggestions.innerHTML = "";
      filtered.forEach(function (p) {
        const alreadySelected = window.selectedRegistroPresenzePresidi.some(function (sel) {
          return hasPresidioCodes(sel) && String(sel.CodiceCitta) === String(p.CodiceCitta) && String(sel.CodicePresidio) === String(p.CodicePresidio);
        });
        if (alreadySelected) return;

        const div = document.createElement("div");
        div.style.padding = "10px";
        div.style.cursor = "pointer";
        div.style.fontSize = "14px";
        div.style.borderBottom = "1px solid #f3f4f6";
        div.textContent = p.NomePresidio;
        div.onmousedown = function () {
          window.selectedRegistroPresenzePresidi.push({
            CodiceCitta: p.CodiceCitta,
            CodicePresidio: p.CodicePresidio,
            NomePresidio: p.NomePresidio
          });
          reconcileUbicazioniWithSelectedPresidi();
          window.registroPresenzeLuogoTouched = true;
          syncRegistroPresenzeActiveLuogo();
          presidioInput.value = "";
          presidioSuggestions.style.display = "none";
          renderPresidioChips();
          renderUbicazioneChips();
        };
        div.onmouseenter = function () { div.style.backgroundColor = "#f3f4f6"; };
        div.onmouseleave = function () { div.style.backgroundColor = ""; };
        presidioSuggestions.appendChild(div);
      });
    }
    if (presidioSuggestions.children.length === 0) {
      presidioSuggestions.innerHTML = '<div style="padding: 10px; color: #6b7280; font-size: 13px; text-align: center;">Nessun risultato</div>';
    }
    presidioSuggestions.style.display = "block";
  };

  presidioInput.onblur = function () {
    setTimeout(function () {
      presidioSuggestions.style.display = "none";
    }, 200);
  };

  ubicazioneInput.oninput = function () {
    const query = normalizzaRicercaRegistro(ubicazioneInput.value);
    if (!query) {
      ubicazioneSuggestions.innerHTML = "";
      ubicazioneSuggestions.style.display = "none";
      return;
    }

    let list = Array.isArray(dati.ubicazioni) ? dati.ubicazioni : [];

    if (selectedPresidioKeys().length > 0) {
      list = list.filter(function (u) {
        return isUbicazioneCompatibleWithSelectedPresidi(u);
      });
    }

    const filtered = list.filter(function (u) {
      return matchesSmartSearch(u.NomeUbicazione, query);
    }).sort(function (a, b) {
      return sortBySearchPriority(a, b, "NomeUbicazione", query);
    });

    if (filtered.length === 0) {
      ubicazioneSuggestions.innerHTML = '<div style="padding: 10px; color: #6b7280; font-size: 13px; text-align: center;">Nessun risultato</div>';
    } else {
      ubicazioneSuggestions.innerHTML = "";
      filtered.forEach(function (u) {
        const alreadySelected = window.selectedRegistroPresenzeUbicazioni.some(function (sel) {
          return hasUbicazioneCodes(sel) &&
                 String(sel.CodiceCitta) === String(u.CodiceCitta) &&
                 String(sel.CodicePresidio) === String(u.CodicePresidio) &&
                 String(sel.CodiceUbicazione) === String(u.CodiceUbicazione);
        });
        if (alreadySelected) return;

        const div = document.createElement("div");
        div.style.padding = "10px";
        div.style.cursor = "pointer";
        div.style.fontSize = "14px";
        div.style.borderBottom = "1px solid #f3f4f6";
        div.textContent = u.NomeUbicazione;
        div.onmousedown = function () {
          window.selectedRegistroPresenzeUbicazioni.push({
            CodiceCitta: u.CodiceCitta,
            CodicePresidio: u.CodicePresidio,
            CodiceUbicazione: u.CodiceUbicazione,
            NomeUbicazione: u.NomeUbicazione
          });
          window.registroPresenzeLuogoTouched = true;
          syncRegistroPresenzeActiveLuogo();
          ubicazioneInput.value = "";
          ubicazioneSuggestions.style.display = "none";
          renderUbicazioneChips();
        };
        div.onmouseenter = function () { div.style.backgroundColor = "#f3f4f6"; };
        div.onmouseleave = function () { div.style.backgroundColor = ""; };
        ubicazioneSuggestions.appendChild(div);
      });
    }
    if (ubicazioneSuggestions.children.length === 0) {
      ubicazioneSuggestions.innerHTML = '<div style="padding: 10px; color: #6b7280; font-size: 13px; text-align: center;">Nessun risultato</div>';
    }
    ubicazioneSuggestions.style.display = "block";
  };

  ubicazioneInput.onblur = function () {
    setTimeout(function () {
      ubicazioneSuggestions.style.display = "none";
    }, 200);
  };

  if (luogoSearchAvailable) {
    luogoInput.oninput = function () {
      const query = normalizzaRicercaRegistro(luogoInput.value);

      if (!query) {
        luogoSuggestions.innerHTML = "";
        luogoSuggestions.style.display = "none";
        return;
      }

      const results = getLuogoSearchResults(query).filter(function (result) {
        return !isLuogoAlreadySelected(result);
      }).slice(0, 80);

      if (results.length === 0) {
        luogoSuggestions.innerHTML = '<div style="padding: 10px; color: #6b7280; font-size: 13px; text-align: center;">Nessun risultato</div>';
      } else {
        luogoSuggestions.innerHTML = "";

        results.forEach(function (result) {
          const div = document.createElement("div");
          div.style.padding = "10px";
          div.style.cursor = "pointer";
          div.style.fontSize = "14px";
          div.style.borderBottom = "1px solid #f3f4f6";
          div.textContent = result.label;

          div.onmousedown = function () {
            addLuogoFromSearchResult(result);
            syncRegistroPresenzeActiveLuogo();
            luogoInput.value = "";
            luogoSuggestions.style.display = "none";
            renderLuogoChips();
          };

          div.onmouseenter = function () { div.style.backgroundColor = "#f3f4f6"; };
          div.onmouseleave = function () { div.style.backgroundColor = ""; };
          luogoSuggestions.appendChild(div);
        });
      }

      luogoSuggestions.style.display = "block";
    };

    luogoInput.onblur = function () {
      setTimeout(function () {
        luogoSuggestions.style.display = "none";
      }, 200);
    };
  }

  function renderPresidioChips() {
    presidioSelectedContainer.innerHTML = "";

    window.selectedRegistroPresenzePresidi.forEach(function (p, index) {
      const chip = document.createElement("div");
      chip.style.display = "flex";
      chip.style.alignItems = "center";
      chip.style.backgroundColor = "#eff6ff";
      chip.style.border = "1px solid #bfdbfe";
      chip.style.borderRadius = "16px";
      chip.style.padding = "4px 10px";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "500";
      chip.style.color = "#1e40af";
      chip.style.gap = "6px";

      const span = document.createElement("span");
      span.textContent = p.NomePresidio;
      chip.appendChild(span);

      {
        const close = document.createElement("span");
        close.textContent = "x";
        close.style.cursor = "pointer";
        close.style.fontWeight = "bold";
        close.style.color = "#3b82f6";
        close.onclick = function () {
          window.selectedRegistroPresenzePresidi.splice(index, 1);
          reconcileUbicazioniWithSelectedPresidi();
          window.registroPresenzeLuogoTouched = true;
          syncRegistroPresenzeActiveLuogo();
          renderPresidioChips();
          renderUbicazioneChips();
        };
        chip.appendChild(close);
      }
      presidioSelectedContainer.appendChild(chip);
    });
  }

  function renderUbicazioneChips() {
    ubicazioneSelectedContainer.innerHTML = "";

    window.selectedRegistroPresenzeUbicazioni.forEach(function (u, index) {
      const chip = document.createElement("div");
      chip.style.display = "flex";
      chip.style.alignItems = "center";
      chip.style.backgroundColor = "#f0fdf4";
      chip.style.border = "1px solid #bbf7d0";
      chip.style.borderRadius = "16px";
      chip.style.padding = "4px 10px";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "500";
      chip.style.color = "#166534";
      chip.style.gap = "6px";

      const span = document.createElement("span");
      span.textContent = u.NomeUbicazione;
      chip.appendChild(span);

      {
        const close = document.createElement("span");
        close.textContent = "x";
        close.style.cursor = "pointer";
        close.style.fontWeight = "bold";
        close.style.color = "#22c55e";
        close.onclick = function () {
          window.selectedRegistroPresenzeUbicazioni.splice(index, 1);
          window.registroPresenzeLuogoTouched = true;
          syncRegistroPresenzeActiveLuogo();
          renderUbicazioneChips();
        };
        chip.appendChild(close);
      }
      ubicazioneSelectedContainer.appendChild(chip);
    });
  }

  function renderLuogoChips() {
    if (!luogoSearchAvailable) {
      return;
    }

    luogoSelectedContainer.innerHTML = "";

    ensureRegistroPresenzeLuoghiArray().forEach(function (luogo, index) {
      const chip = document.createElement("div");
      chip.style.display = "flex";
      chip.style.alignItems = "center";
      chip.style.backgroundColor = "#f5f3ff";
      chip.style.border = "1px solid #ddd6fe";
      chip.style.borderRadius = "16px";
      chip.style.padding = "4px 10px";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "500";
      chip.style.color = "#5b21b6";
      chip.style.gap = "6px";

      const label = luogo && luogo.tipo === "ubicazione"
        ? [luogo.NomePresidio, luogo.NomeUbicazione].filter(Boolean).join(" - ")
        : String(luogo && luogo.NomePresidio || "");

      const span = document.createElement("span");
      span.textContent = label;
      chip.appendChild(span);

      const close = document.createElement("span");
      close.textContent = "x";
      close.style.cursor = "pointer";
      close.style.fontWeight = "bold";
      close.style.color = "#7c3aed";
      close.onclick = function () {
        ensureRegistroPresenzeLuoghiArray().splice(index, 1);
        window.registroPresenzeLuogoTouched = true;
        syncRegistroPresenzeActiveLuogo();
        renderLuogoChips();
      };
      chip.appendChild(close);

      luogoSelectedContainer.appendChild(chip);
    });
  }

  window.renderRegistroPresenzeLuogoChips = function () {
    renderPresidioChips();
    renderUbicazioneChips();
    renderLuogoChips();
  };

  window.resetRegistroPresenzeLuogoSelections = function () {
    window.selectedRegistroPresenzePresidi = [];
    window.selectedRegistroPresenzeUbicazioni = [];
    window.selectedRegistroPresenzeLuoghi = [];
    window.registroPresenzeLuogoTouched = false;

    presidioInput.value = "";
    ubicazioneInput.value = "";
    presidioSuggestions.innerHTML = "";
    ubicazioneSuggestions.innerHTML = "";
    presidioSuggestions.style.display = "none";
    ubicazioneSuggestions.style.display = "none";

    if (luogoSearchAvailable) {
      luogoInput.value = "";
      luogoSuggestions.innerHTML = "";
      luogoSuggestions.style.display = "none";
    }

    renderPresidioChips();
    renderUbicazioneChips();
    renderLuogoChips();
  };
}
function openRegPresListModal() {
  renderRegistroPresenzeList();

  const preview = document.getElementById("regPresFoglioOrePreview");
  if (preview) {
    preview.innerHTML = "";
    preview.classList.add("hidden");
  }

  const modal = document.getElementById("regPresListModal");
  if (modal) modal.classList.remove("hidden");
}

function closeRegPresListModal() {
  const modal = document.getElementById("regPresListModal");
  if (modal) modal.classList.add("hidden");
}

function formatRegistroPresenzeListMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours + "h " + String(mins).padStart(2, "0") + "m";
}

function renderRegistroPresenzeList() {
  const container = document.getElementById("regPresListContainer");
  if (!container) return;

  container.innerHTML = "";

  const list = Array.isArray(dati.bollature) ? dati.bollature.slice() : [];

  list.sort(function (a, b) {
    const timeA = new Date(a.orario || 0).getTime();
    const timeB = new Date(b.orario || 0).getTime();
    return timeB - timeA;
  });

  if (list.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #6b7280; font-size: 14px;">Nessuna bollatura presente</div>';
    return;
  }

  const pending = getPendingChanges();

  list.forEach(function (b) {
    const isPending = pending.some(function (p) {
      return p.type === "ADD_BOLLATURA" && p.payload && p.payload.id === b.id;
    });

    const card = document.createElement("div");
    card.className = "admin-box";
    card.style.margin = "0";
    card.style.borderLeft = isPending ? "4px solid #f59e0b" : "4px solid #10b981";
    card.style.padding = "12px";

    const formattedTime = formatDateTime(b.orario);
    const tipoText = String(b.tipo_bollatura || "").toUpperCase();
    const tipoColor = (b.tipo_bollatura || "").toLowerCase() === "ingresso" ? "#10b981" : "#ef4444";
    const statusSyncText = isPending ? "In attesa di sincronizzazione" : "Sincronizzato";
    const statusSyncColor = isPending ? "#d97706" : "#059669";

    let detailsHtml = "";
    if (b.citta_nome) {
      detailsHtml += '<div>Presidio: <strong>' + b.citta_nome + '</strong></div>';
    }
    if (b.cantiere_nome) {
      detailsHtml += '<div>Ubicazione: <strong>' + b.cantiere_nome + '</strong></div>';
    }

    const pausaPranzo = String(
      b.pausa_pranzo ||
      (typeof getRegistroPresenzePranzoById === "function"
        ? getRegistroPresenzePranzoById(b.id)
        : "") ||
      ""
    ).trim();

    if (pausaPranzo) {
      detailsHtml += '<div>Pranzo: <strong>' + pausaPranzo + '</strong></div>';
    }

    if (b.totale_lavorato_testo || Number.isFinite(Number(b.totale_lavorato_minuti))) {
      const totaleReale = b.totale_lavorato_testo || formatRegistroPresenzeListMinutes(b.totale_lavorato_minuti);
      detailsHtml += '<div>Totale reale: <strong>' + totaleReale + '</strong></div>';
    }

    if (b.totale_calcolato_testo || Number.isFinite(Number(b.totale_calcolato_minuti))) {
      const totaleCalcolato = b.totale_calcolato_testo || formatRegistroPresenzeListMinutes(b.totale_calcolato_minuti);
      detailsHtml += '<div>Totale calcolato: <strong>' + totaleCalcolato + '</strong></div>';
    }

    if (b.regola_calcolo) {
      detailsHtml += '<div>Regola calcolo: <strong>' + b.regola_calcolo + '</strong></div>';
    }

    if (b.nome_sede) {
      detailsHtml += '<div>Sede Geofence: <strong>' + b.nome_sede + '</strong></div>';
    }
    if (b.stato_gps) {
      const gpsLabel = b.stato_gps === "in_zona" ? "In zona" : "Fuori zona (sbloccato)";
      detailsHtml += '<div>Stato GPS: <strong>' + gpsLabel + '</strong></div>';
    }

    card.innerHTML = 
      '<div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin-bottom: 6px;">' +
        '<span style="color: ' + tipoColor + '">' + tipoText + '</span>' +
        '<span style="color: #374151;">' + formattedTime + '</span>' +
      '</div>' +
      '<div style="font-size: 13px; color: #4b5563; line-height: 1.5; text-align: left; display: flex; flex-direction: column; gap: 4px;">' +
        '<div>Tecnico: <strong>' + (b.tecnico || "Tecnico") + '</strong></div>' +
        detailsHtml +
        '<div style="margin-top: 4px; font-size: 11px; font-weight: bold; color: ' + statusSyncColor + ';">' +
          statusSyncText +
        '</div>' +
      '</div>';

    container.appendChild(card);
  });
}


function cvlsPad2(value) {
  return String(value).padStart(2, "0");
}

function cvlsRegistroDateFromValue(value) {
  const date = new Date(value);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function cvlsRegistroDayKey(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }

  return date.getFullYear() + "-" + cvlsPad2(date.getMonth() + 1) + "-" + cvlsPad2(date.getDate());
}

function cvlsRegistroMonthKey(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }

  return date.getFullYear() + "-" + cvlsPad2(date.getMonth() + 1);
}

function cvlsFormatRegistroTime(value) {
  const date = cvlsRegistroDateFromValue(value);

  if (!date) {
    return "";
  }

  return cvlsPad2(date.getHours()) + ":" + cvlsPad2(date.getMinutes());
}

function cvlsFormatRegistroDayLabel(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }

  return cvlsPad2(date.getDate()) + "/" + cvlsPad2(date.getMonth() + 1);
}

function cvlsGetRegistroMeseLabel(year, monthIndex) {
  const date = new Date(year, monthIndex, 1);
  const month = date.toLocaleDateString("it-IT", {
    month: "long"
  });

  return month.charAt(0).toUpperCase() + month.slice(1) + " " + year;
}

function cvlsMinutesToHourText(minutes, emptyIfZero) {
  const numeric = Math.round(Number(minutes) || 0);

  if (emptyIfZero && numeric === 0) {
    return "";
  }

  const sign = numeric < 0 ? "-" : "";
  const value = Math.abs(numeric);
  const hours = Math.floor(value / 60);
  const mins = value % 60;

  return sign + hours + "h " + cvlsPad2(mins) + "m";
}

function cvlsGetBollaturaLuogoText(bollatura) {
  if (!bollatura) {
    return "";
  }

  const presidio = String(bollatura.citta_nome || "").trim();
  const ubicazione = String(bollatura.cantiere_nome || "").trim();

  if (presidio && ubicazione) {
    return presidio + " - " + ubicazione;
  }

  return presidio || ubicazione || "";
}

function cvlsUniqueJoin(values, separator) {
  const seen = {};
  const result = [];

  (Array.isArray(values) ? values : []).forEach(function (value) {
    const text = String(value || "").trim();

    if (!text || seen[text]) {
      return;
    }

    seen[text] = true;
    result.push(text);
  });

  return result.join(separator || ", ");
}

function cvlsGetRegistroPresenzeMonthReference(list) {
  const dates = (Array.isArray(list) ? list : [])
    .map(function (item) {
      return cvlsRegistroDateFromValue(item && item.orario);
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return b.getTime() - a.getTime();
    });

  return dates[0] || new Date();
}

function cvlsBuildFoglioOreMensileData() {
  ensureDataShape();

  const allBollature = Array.isArray(dati.bollature) ? dati.bollature.slice() : [];
  const monthReference = cvlsGetRegistroPresenzeMonthReference(allBollature);
  const year = monthReference.getFullYear();
  const monthIndex = monthReference.getMonth();
  const monthKey = cvlsRegistroMonthKey(monthReference);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const monthBollature = allBollature
    .map(function (item) {
      return {
        raw: item,
        date: cvlsRegistroDateFromValue(item && item.orario)
      };
    })
    .filter(function (item) {
      return item.date && cvlsRegistroMonthKey(item.date) === monthKey;
    })
    .sort(function (a, b) {
      return a.date.getTime() - b.date.getTime();
    });

  const byDay = {};
  monthBollature.forEach(function (item) {
    const key = cvlsRegistroDayKey(item.date);

    if (!byDay[key]) {
      byDay[key] = [];
    }

    byDay[key].push(item);
  });

  const rows = [];
  let totaleGiornalieroMinuti = 0;
  let totaleStraordinarioMinuti = 0;
  let totaleViaggioMinuti = 0;
  let totaleReperibilitaMinuti = 0;
  let totalePranzoMinuti = 0;
  let settimaneReperibilita = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, monthIndex, day);
    const dayKey = cvlsRegistroDayKey(currentDate);
    const dayItems = byDay[dayKey] || [];
    const ingressi = dayItems.filter(function (item) {
      return String(item.raw && item.raw.tipo_bollatura || "").toLowerCase() === "ingresso";
    });
    const uscite = dayItems.filter(function (item) {
      return String(item.raw && item.raw.tipo_bollatura || "").toLowerCase() === "uscita";
    });

    const firstIngresso = ingressi[0] || null;
    const lastUscita = uscite.length > 0 ? uscite[uscite.length - 1] : null;
    const luoghi = cvlsUniqueJoin(
      dayItems.map(function (item) {
        return cvlsGetBollaturaLuogoText(item.raw);
      }),
      " / "
    );

    const pranzoLabels = cvlsUniqueJoin(
      uscite.map(function (item) {
        return item.raw && item.raw.pausa_pranzo;
      }),
      ", "
    );

    const pranzoMinuti = uscite.reduce(function (totale, item) {
      return totale + Math.max(0, Math.round(Number(item.raw && item.raw.pausa_pranzo_minuti) || 0));
    }, 0);

    const totaleCalcolatoMinuti = uscite.reduce(function (totale, item) {
      const raw = item.raw || {};
      const calcolato = Number(raw.totale_calcolato_minuti);
      const reale = Number(raw.totale_lavorato_minuti);

      if (Number.isFinite(calcolato) && calcolato > 0) {
        return totale + Math.round(calcolato);
      }

      if (Number.isFinite(reale) && reale > 0) {
        return totale + Math.round(reale);
      }

      return totale;
    }, 0);

    const straordinarioMinuti = Math.max(0, totaleCalcolatoMinuti - 480);
    const note = [];

    if (dayItems.length > 0 && ingressi.length === 0) {
      note.push("Ingresso mancante");
    }

    if (dayItems.length > 0 && uscite.length === 0) {
      note.push("Uscita mancante");
    }

    if (ingressi.length > 1 || uscite.length > 1) {
      note.push("Più bollature nella giornata");
    }

    totaleGiornalieroMinuti += totaleCalcolatoMinuti;
    totaleStraordinarioMinuti += straordinarioMinuti;
    totalePranzoMinuti += pranzoMinuti;

    rows.push({
      giorno: cvlsFormatRegistroDayLabel(currentDate),
      dataISO: dayKey,
      luogo: luoghi,
      ingresso: firstIngresso ? cvlsFormatRegistroTime(firstIngresso.raw.orario) : "",
      uscita: lastUscita ? cvlsFormatRegistroTime(lastUscita.raw.orario) : "",
      totaleGiornoMinuti: totaleCalcolatoMinuti,
      totaleGiorno: cvlsMinutesToHourText(totaleCalcolatoMinuti, true),
      oreStraordinarioMinuti: straordinarioMinuti,
      oreStraordinario: cvlsMinutesToHourText(straordinarioMinuti, true),
      oreViaggioMinuti: 0,
      oreViaggio: "",
      reperibilita: "",
      oreReperibilitaMinuti: 0,
      oreReperibilita: "",
      pranzoMinuti: pranzoMinuti,
      pranzo: pranzoLabels,
      note: note.join("; ")
    });
  }

  return {
    dipendente: cvlsGetNomeTecnicoUfficiale(),
    mese: cvlsGetRegistroMeseLabel(year, monthIndex),
    anno: year,
    meseNumero: monthIndex + 1,
    rows: rows,
    totals: {
      totaleGiornalieroMinuti: totaleGiornalieroMinuti,
      totaleGiornaliero: cvlsMinutesToHourText(totaleGiornalieroMinuti, false),
      totaleStraordinarioMinuti: totaleStraordinarioMinuti,
      totaleStraordinario: cvlsMinutesToHourText(totaleStraordinarioMinuti, false),
      totaleViaggioMinuti: totaleViaggioMinuti,
      totaleViaggio: cvlsMinutesToHourText(totaleViaggioMinuti, false),
      settimaneReperibilita: settimaneReperibilita,
      totaleReperibilitaMinuti: totaleReperibilitaMinuti,
      totaleReperibilita: cvlsMinutesToHourText(totaleReperibilitaMinuti, false),
      totalePranzoMinuti: totalePranzoMinuti,
      totalePranzo: cvlsMinutesToHourText(totalePranzoMinuti, false)
    }
  };
}

function renderRegistroPresenzeFoglioOrePreview() {
  const preview = document.getElementById("regPresFoglioOrePreview");

  if (!preview) {
    return;
  }

  const data = cvlsBuildFoglioOreMensileData();

  const bodyRows = data.rows.map(function (row) {
    return "<tr>" +
      "<td>" + escapeHtml(row.giorno) + "</td>" +
      "<td>" + escapeHtml(row.luogo) + "</td>" +
      "<td>" + escapeHtml(row.ingresso) + "</td>" +
      "<td>" + escapeHtml(row.uscita) + "</td>" +
      "<td>" + escapeHtml(row.totaleGiorno) + "</td>" +
      "<td>" + escapeHtml(row.oreViaggio) + "</td>" +
      "<td>" + escapeHtml(row.oreStraordinario) + "</td>" +
      "<td>" + escapeHtml(row.reperibilita) + "</td>" +
      "<td>" + escapeHtml(row.oreReperibilita) + "</td>" +
      "<td>" + escapeHtml(row.pranzo) + "</td>" +
      "<td>" + escapeHtml(row.note) + "</td>" +
      "</tr>";
  }).join("");

  preview.innerHTML =
    "<div class=\"admin-box\" style=\"margin: 0; background: #ffffff;\">" +
      "<span class=\"admin-title\">Foglio ore mensile</span>" +
      "<div style=\"font-size: 13px; color: #374151; line-height: 1.6; margin-bottom: 12px;\">" +
        "<div><strong>Dipendente:</strong> " + escapeHtml(data.dipendente || "-") + "</div>" +
        "<div><strong>Mese:</strong> " + escapeHtml(data.mese || "-") + "</div>" +
      "</div>" +
      "<div class=\"table-wrapper\" style=\"overflow-x: auto; margin-top: 10px;\">" +
        "<table class=\"maintenance-apple-table\" style=\"min-width: 980px; font-size: 12px;\">" +
          "<thead>" +
            "<tr>" +
              "<th>Giorno</th>" +
              "<th>Luogo</th>" +
              "<th>Ingresso</th>" +
              "<th>Uscita</th>" +
              "<th>Tot ore giorno</th>" +
              "<th>Ore viaggio</th>" +
              "<th>Ore straordinario</th>" +
              "<th>Reperibilità</th>" +
              "<th>Ore reperibilità</th>" +
              "<th>Pranzo</th>" +
              "<th>Note</th>" +
            "</tr>" +
          "</thead>" +
          "<tbody>" + bodyRows + "</tbody>" +
        "</table>" +
      "</div>" +
      "<div style=\"margin-top: 14px; border-top: 1px solid #e5e7eb; padding-top: 12px; font-size: 13px; color: #374151; line-height: 1.7;\">" +
        "<div><strong>Totale ore giornaliere:</strong> " + escapeHtml(data.totals.totaleGiornaliero) + "</div>" +
        "<div><strong>Totale ore straordinario:</strong> " + escapeHtml(data.totals.totaleStraordinario) + "</div>" +
        "<div><strong>Totale ore viaggio:</strong> " + escapeHtml(data.totals.totaleViaggio) + "</div>" +
        "<div><strong>Settimane reperibilità:</strong> " + escapeHtml(String(data.totals.settimaneReperibilita || 0)) + "</div>" +
        "<div><strong>Totale ore reperibilità:</strong> " + escapeHtml(data.totals.totaleReperibilita) + "</div>" +
        "<div><strong>Totale pranzo:</strong> " + escapeHtml(data.totals.totalePranzo) + "</div>" +
      "</div>" +
    "</div>";

  preview.classList.remove("hidden");
  preview.scrollIntoView({ behavior: "smooth", block: "start" });

  window.cvlsUltimoFoglioOreMensileData = data;
}

function visualizzaRegistroPresenzeFoglioOre() {
  renderRegistroPresenzeFoglioOrePreview();
}

function generaRegistroPresenzeFoglioOrePreview() {
  renderRegistroPresenzeFoglioOrePreview();
  showCvlsToast("Foglio ore aggiornato");
}

async function generaRegistroPresenzeFoglioOrePdf() {
  const data = cvlsBuildFoglioOreMensileData();
  const pdfBytes = cvlsBuildFoglioOreMensilePdfBytes(data);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const fileName = cvlsBuildFoglioOrePdfFileName(data);

  window.cvlsUltimoFoglioOreMensileData = data;

  showCvlsToast("Preparo foglio ore PDF...");

  const condivisoConSistemaNativo = await cvlsShareFoglioOrePdfNative(
    pdfBytes,
    fileName,
    data
  );

  if (condivisoConSistemaNativo) {
    return;
  }

  if (window.cvlsUltimoFoglioOrePdfUrl) {
    try {
      URL.revokeObjectURL(window.cvlsUltimoFoglioOrePdfUrl);
    } catch (error) {
      console.warn("Impossibile liberare il PDF precedente:", error);
    }
  }

  const url = URL.createObjectURL(blob);
  window.cvlsUltimoFoglioOrePdfUrl = url;

  let file = null;
  if (typeof File === "function") {
    file = new File([blob], fileName, { type: "application/pdf" });
  }

  if (
    file &&
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    navigator.share({
      title: "Foglio ore mensile",
      text: "Foglio ore mensile " + (data.mese || ""),
      files: [file]
    })
      .then(function () {
        showCvlsToast("Foglio ore pronto");
      })
      .catch(function (error) {
        if (error && error.name === "AbortError") {
          return;
        }
        cvlsFallbackOpenFoglioOrePdf(url, fileName);
      });
    return;
  }

  cvlsFallbackOpenFoglioOrePdf(url, fileName);
}

async function cvlsShareFoglioOrePdfNative(pdfBytes, fileName, data) {
  const capacitor = window.Capacitor;
  const plugins = capacitor && capacitor.Plugins ? capacitor.Plugins : null;
  const Filesystem = plugins && plugins.Filesystem ? plugins.Filesystem : null;
  const Share = plugins && plugins.Share ? plugins.Share : null;

  if (!Filesystem || !Share) {
    return false;
  }

  try {
    const base64Data = cvlsUint8ArrayToBase64(pdfBytes);
    const safeFileName = String(fileName || "foglio-ore.pdf")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "foglio-ore.pdf";

    const result = await Filesystem.writeFile({
      path: safeFileName,
      data: base64Data,
      directory: "CACHE",
      recursive: true
    });

    const fileUri = result && result.uri ? result.uri : "";

    if (!fileUri) {
      return false;
    }

    await Share.share({
      title: "Foglio ore mensile",
      text: "Foglio ore mensile " + (data && data.mese ? data.mese : ""),
      url: fileUri,
      dialogTitle: "Condividi foglio ore"
    });

    showCvlsToast("Foglio ore pronto");
    return true;
  } catch (error) {
    if (error && (error.message === "Share canceled" || error.message === "Share cancelled")) {
      return true;
    }

    console.warn("Condivisione nativa PDF non disponibile:", error);
    return false;
  }
}

function cvlsUint8ArrayToBase64(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binary);
}

function cvlsFallbackOpenFoglioOrePdf(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(function () {
    try {
      window.open(url, "_blank");
    } catch (error) {
      console.warn("Apertura PDF non disponibile:", error);
    }
  }, 250);

  showCvlsToast("Foglio ore PDF generato");
}

function cvlsBuildFoglioOrePdfFileName(data) {
  const safeName = cvlsPdfAsciiText(data && data.dipendente ? data.dipendente : "tecnico")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "tecnico";

  const year = data && data.anno ? String(data.anno) : String(new Date().getFullYear());
  const month = data && data.meseNumero ? cvlsPad2(data.meseNumero) : cvlsPad2(new Date().getMonth() + 1);

  return "foglio-ore-" + year + "-" + month + "-" + safeName + ".pdf";
}

function cvlsPdfAsciiText(value) {
  const normalized = String(value === undefined || value === null ? "" : value)
    .replace(/[àáâãäå]/g, "a")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ÀÁÂÃÄÅ]/g, "A")
    .replace(/[ÈÉÊË]/g, "E")
    .replace(/[ÌÍÎÏ]/g, "I")
    .replace(/[ÒÓÔÕÖ]/g, "O")
    .replace(/[ÙÚÛÜ]/g, "U")
    .replace(/[ç]/g, "c")
    .replace(/[Ç]/g, "C")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");

  let result = "";
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) {
      result += normalized.charAt(i);
    }
  }
  return result;
}

function cvlsPdfEscapeText(value) {
  return cvlsPdfAsciiText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function cvlsPdfClipText(value, maxLength) {
  const text = cvlsPdfAsciiText(value).trim();

  if (!maxLength || text.length <= maxLength) {
    return text;
  }

  return text.slice(0, Math.max(0, maxLength - 3)).trim() + "...";
}

function cvlsBuildFoglioOreMensilePdfBytes(data) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const titleY = 566;
  const headerY = 540;
  const tableTop = 520;
  const rowHeight = 10.9;

  const columns = [
    { key: "giorno", label: "Giorno", width: 34, max: 5, align: "center" },
    { key: "luogo", label: "Luogo", width: 172, max: 32, align: "left" },
    { key: "ingresso", label: "Ingresso", width: 56, max: 8, align: "center" },
    { key: "uscita", label: "Uscita", width: 56, max: 8, align: "center" },
    { key: "totaleGiorno", label: "Tot ore", width: 70, max: 10, align: "center" },
    { key: "oreViaggio", label: "Viaggio", width: 56, max: 9, align: "center" },
    { key: "oreStraordinario", label: "Straord.", width: 70, max: 10, align: "center" },
    { key: "reperibilita", label: "Rep.", width: 50, max: 5, align: "center" },
    { key: "oreReperibilita", label: "Ore rep.", width: 64, max: 10, align: "center" },
    { key: "pranzo", label: "Pranzo", width: 50, max: 8, align: "center" },
    { key: "note", label: "Note", width: 136, max: 25, align: "left" }
  ];

  let content = "0.55 w\n";

  function drawLine(x1, y1, x2, y2) {
    content += x1.toFixed(2) + " " + y1.toFixed(2) + " m " + x2.toFixed(2) + " " + y2.toFixed(2) + " l S\n";
  }

  function drawRect(x, y, w, h, fill) {
    if (fill) {
      content += "0.93 0.93 0.93 rg\n";
      content += x.toFixed(2) + " " + y.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re f\n";
      content += "0 0 0 RG 0 0 0 rg\n";
    }
    content += x.toFixed(2) + " " + y.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re S\n";
  }

  function drawText(text, x, y, size, bold, align, boxWidth) {
    const clean = cvlsPdfEscapeText(text);
    const approxWidth = clean.length * size * 0.48;
    let tx = x;

    if (align === "center" && boxWidth) {
      tx = x + Math.max(0, (boxWidth - approxWidth) / 2);
    } else if (align === "right" && boxWidth) {
      tx = x + Math.max(0, boxWidth - approxWidth - 2);
    }

    content += "BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + tx.toFixed(2) + " " + y.toFixed(2) + " Td (" + clean + ") Tj ET\n";
  }

  drawText("FOGLIO ORE MENSILE", pageWidth / 2 - 132, titleY, 24, true, "left", 0);

  drawText("Dipendente:", margin + 4, headerY, 8, true, "left", 0);
  drawText(data.dipendente || "-", margin + 68, headerY, 8, false, "left", 0);
  drawLine(margin + 66, headerY - 3, margin + 295, headerY - 3);

  drawText("Mese:", pageWidth / 2 - 58, headerY, 8, true, "left", 0);
  drawText(data.mese || "-", pageWidth / 2 - 20, headerY, 8, false, "left", 0);
  drawLine(pageWidth / 2 - 22, headerY - 3, pageWidth / 2 + 150, headerY - 3);

  drawText("Anno:", pageWidth - 170, headerY, 8, true, "left", 0);
  drawText(data.anno || "-", pageWidth - 132, headerY, 8, false, "left", 0);
  drawLine(pageWidth - 134, headerY - 3, pageWidth - 52, headerY - 3);

  let x = margin;
  const tableBottom = tableTop - rowHeight * 38;

  drawRect(margin, tableTop - rowHeight, contentWidth, rowHeight, true);
  columns.forEach(function (column) {
    drawLine(x, tableTop, x, tableBottom);
    drawText(column.label, x + 2, tableTop - 7.7, 6.2, true, column.align, column.width - 4);
    x += column.width;
  });
  drawLine(margin + contentWidth, tableTop, margin + contentWidth, tableBottom);

  for (let i = 0; i <= 38; i++) {
    const y = tableTop - rowHeight * i;
    drawLine(margin, y, margin + contentWidth, y);
  }

  data.rows.forEach(function (row, index) {
    let cellX = margin;
    const y = tableTop - rowHeight * (index + 1) - 7.7;

    columns.forEach(function (column) {
      const text = row[column.key] || "";
      drawText(cvlsPdfClipText(text, column.max), cellX + 2, y, 6.2, column.key === "giorno", column.align, column.width - 4);
      cellX += column.width;
    });
  });

  const totalRows = [
    ["Totale ore giornaliere", data.totals.totaleGiornaliero],
    ["Totale ore straordinario", data.totals.totaleStraordinario],
    ["Totale ore viaggio", data.totals.totaleViaggio],
    ["Settimane reperibilita", String(data.totals.settimaneReperibilita || 0)],
    ["Totale ore reperibilita", data.totals.totaleReperibilita],
    ["Totale pranzo", data.totals.totalePranzo]
  ];

  totalRows.forEach(function (item, index) {
    const rowIndex = data.rows.length + index + 1;
    const yTop = tableTop - rowHeight * rowIndex;
    drawRect(margin, yTop - rowHeight, columns[0].width + columns[1].width, rowHeight, true);
    drawText(item[0], margin + 4, yTop - 7.7, 6.8, true, "left", 0);
    drawText(item[1] || "", margin + columns[0].width + columns[1].width + 6, yTop - 7.7, 6.8, true, "left", 0);
  });

  drawText("Reperibilita: indicare con R le settimane di reperibilita. Pranzo: 1 ora / 1/2 ora / 0 ore.", margin + 4, 20, 8, true, "left", 0);

  return cvlsBuildSinglePagePdf(pageWidth, pageHeight, content);
}

function cvlsBuildSinglePagePdf(pageWidth, pageHeight, content) {
  const objects = [];

  function addObject(body) {
    objects.push(body);
    return objects.length;
  }

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageWidth + " " + pageHeight + "] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  addObject("<< /Length " + content.length + " >>\nstream\n" + content + "endstream");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach(function (body, index) {
    offsets.push(pdf.length);
    pdf += (index + 1) + " 0 obj\n" + body + "\nendobj\n";
  });

  const xrefStart = pdf.length;
  pdf += "xref\n0 " + (objects.length + 1) + "\n";
  pdf += "0000000000 65535 f \n";

  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }

  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root " + catalogId + " 0 R >>\n";
  pdf += "startxref\n" + xrefStart + "\n%%EOF";

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) {
    bytes[i] = pdf.charCodeAt(i) & 0xff;
  }

  return bytes;
}

window.cvlsBuildFoglioOreMensileData = cvlsBuildFoglioOreMensileData;

function cvlsShowPage(pageId, title) {
  if (pageId === "pageRegistroPresenze" && !canOpenRegistroPresenze()) {
    closeSideMenu();
    return;
  }

  closeSideMenu();

  if (pageId !== "pageRegistroPresenze" && window.CvlsGeobollatura && typeof window.CvlsGeobollatura.stopPageTracking === "function") {
    window.CvlsGeobollatura.stopPageTracking();
  }

  const pages = [
    "pageArchivio",
    "pageDispositivo",
    "pageRegistroPresenze",
    "pageNotaSpese",
    "pageDocumenti",
    "pageNote",
    "pageImpostazioni"
  ];

  pages.forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  });

  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.add("active");
  }

  document.getElementById("mainTitle").textContent = title || "CVLS";

  const logoBox = document.querySelector(".logo-box");
  if (logoBox) {
    if (pageId === "pageArchivio") {
      logoBox.classList.remove("hidden");
    } else {
      logoBox.classList.add("hidden");
    }
  }

  window.scrollTo(0, 0);
  updateTopbarLeftButton();

  if (pageId === "pageRegistroPresenze") {
    updateRegistroPresenzeTecnicoBox();
    if (window.CvlsGeobollatura && typeof window.CvlsGeobollatura.startPageTracking === "function") {
      window.CvlsGeobollatura.startPageTracking();
    }
    initRegistroPresenzeLuogoSearch();
    initRegistroPresenzePranzo();
  }
}

function tornaArchivio() {
  if (window.CvlsGeobollatura && typeof window.CvlsGeobollatura.stopPageTracking === "function") {
    window.CvlsGeobollatura.stopPageTracking();
  }

  setCvlsHeaderActionsVisible(false, false);
  document.getElementById("mainTitle").textContent = "GESTIONE MANUTENZIONI";
  document.getElementById("pageDispositivo").classList.remove("active");

  const newPages = ["pageRegistroPresenze", "pageNotaSpese", "pageDocumenti", "pageNote", "pageImpostazioni"];
  newPages.forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  });

  document.getElementById("pageArchivio").classList.add("active");

  const logoBox = document.querySelector(".logo-box");
  if (logoBox) logoBox.classList.remove("hidden");
  currentDeviceId = "";
  currentDeviceData = null;
  renderArchivio();
  window.scrollTo(0, 0);
  updateTopbarLeftButton();
}

/*
 * Navigazione indietro unica per:
 * - pulsante <
 * - swipe Android verso destra
 * - finestre e popup aperti
 * - pagine interne della scheda
 * - livelli dell'archivio
 */
function cvlsNavigateBack() {
  /*
   * Durante la sincronizzazione ogni navigazione
   * deve restare bloccata.
   */
  if (cvlsSyncInProgress) {
    showCvlsToast(
      "Attendi il completamento della sincronizzazione"
    );

    return false;
  }

  /*
   * Popup CVLS personalizzato.
   */
  const cvlsDialog =
    document.getElementById("cvlsDialogOverlay");

  if (
    cvlsDialog &&
    cvlsDialog.classList.contains("show")
  ) {
    cvlsCloseDialog();
    return true;
  }

  /*
   * Vecchio popup stile Apple.
   */
  const appleModal =
    document.getElementById("appleModalRoot");

  if (appleModal) {
    closeAppleModal();
    return true;
  }

  /*
   * Popup QR.
   */
  const qrOverlay =
    document.getElementById("qrOverlay");

  if (qrOverlay) {
    qrOverlay.remove();
    return true;
  }

  /*
   * Menu laterale.
   */
  const sideMenu =
    document.getElementById("sideMenu");

  if (
    sideMenu &&
    sideMenu.classList.contains("open")
  ) {
    closeSideMenu();
    return true;
  }

  /*
   * Ricerca dispositivo.
   */
  const searchModal =
    document.getElementById("searchModal");

  if (
    searchModal &&
    !searchModal.classList.contains("hidden")
  ) {
    closeSearch();
    return true;
  }

  /*
   * Popup aggiunta dispositivo.
   */
  const dispositivoModal =
    document.getElementById("popupDispositivoModal");

  if (
    dispositivoModal &&
    dispositivoModal.classList.contains("show")
  ) {
    closeAddDispositivoModal();
    return true;
  }

  /*
   * Popup programmazione manutenzione.
   */
  const programmaModal =
    document.getElementById(
      "popupProgrammaManutenzione"
    );

  if (
    programmaModal &&
    !programmaModal.classList.contains("hidden")
  ) {
    closeProgrammaManutenzione();
    return true;
  }

  /*
   * Popup autorizzazione in attesa.
   */
  const waitingModal =
    document.getElementById("waitingAuthModal");

  if (
    waitingModal &&
    !waitingModal.classList.contains("hidden")
  ) {
    hideWaitingAuthModal();
    return true;
  }

  /*
   * Navigazione dentro la scheda dispositivo.
   */
  const paginaDispositivo =
    document.getElementById("pageDispositivo");

  if (
    paginaDispositivo &&
    paginaDispositivo.classList.contains("active")
  ) {
    const pagina2 =
      document.getElementById("page2");

    /*
     * Dalla pagina 2 torniamo alla pagina 1.
     */
    if (
      pagina2 &&
      pagina2.classList.contains("active")
    ) {
      cvlsRememberForwardState();
      goDeviceSubpage(1, true);
      return true;
    }

    /*
     * Dalla pagina 1 torniamo all'archivio.
     * Vale anche per la scheda Sensore O2.
     */
    cvlsRememberForwardState();
    tornaArchivio();
    return true;
  }

  /*
   * Navigazione a ritroso nei livelli dell'archivio:
   * dispositivo → ubicazione → presidio → città.
   */
  const paginaArchivio =
    document.getElementById("pageArchivio");

  if (
    paginaArchivio &&
    paginaArchivio.classList.contains("active")
  ) {
    if (selezione.ubicazione) {
      cvlsRememberForwardState();

      selezione.ubicazione = null;

      const boxDispositivi =
        document.getElementById("boxDispositivi");

      if (boxDispositivi) {
        boxDispositivi.classList.add("hidden");
      }

      renderArchivio();
      scrollArchivioTo("boxUbicazioni");

      return true;
    }

    if (selezione.presidio) {
      cvlsRememberForwardState();

      selezione.presidio = null;
      selezione.ubicazione = null;

      const boxUbicazioni =
        document.getElementById("boxUbicazioni");

      const boxDispositivi =
        document.getElementById("boxDispositivi");

      if (boxUbicazioni) {
        boxUbicazioni.classList.add("hidden");
      }

      if (boxDispositivi) {
        boxDispositivi.classList.add("hidden");
      }

      renderArchivio();
      scrollArchivioTo("boxPresidi");

      return true;
    }

    if (selezione.citta) {
      cvlsRememberForwardState();

      selezione.citta = null;
      selezione.presidio = null;
      selezione.ubicazione = null;

      const boxPresidi =
        document.getElementById("boxPresidi");

      const boxUbicazioni =
        document.getElementById("boxUbicazioni");

      const boxDispositivi =
        document.getElementById("boxDispositivi");

      if (boxPresidi) {
        boxPresidi.classList.add("hidden");
      }

      if (boxUbicazioni) {
        boxUbicazioni.classList.add("hidden");
      }

      if (boxDispositivi) {
        boxDispositivi.classList.add("hidden");
      }

      renderArchivio();
      window.scrollTo(0, 0);

      return true;
    }
  }

  return false;
}

/* =========================================================
   BLOCCO SWIPE ANDROID SU TABELLE
========================================================= */

function cvlsTargetBloccaSwipeAndroid(target) {
  if (!target || !target.closest) {
    return false;
  }

  return !!target.closest(
    ".table-wrapper, table, thead, tbody, tr, th, td"
  );
}

document.addEventListener(
  "touchstart",
  function (event) {
    const target = event.target;
    const bloccaSwipe =
      cvlsTargetBloccaSwipeAndroid(target);

    if (
      window.AndroidBridge &&
      typeof window.AndroidBridge.setSwipeBloccatoDaTabella ===
      "function"
    ) {
      window.AndroidBridge.setSwipeBloccatoDaTabella(
        bloccaSwipe
      );
    }
  },
  true
);

/*
 * Questa funzione verrà richiamata da MainActivity.java
 * quando Android riconosce lo swipe verso destra.
 */
window.onAndroidSwipeBack = function () {
  cvlsNavigateBack();
};

window.onAndroidSwipeForward = function () {
  cvlsNavigateForward();
};

function openDeviceFromQRNow(codice) {
  loadLocalData();

  const codicePulito = format11(codice);

  const dispositivo = dati.dispositivi.find(d =>
    format11(d.CodiceCompleto || d.codiceCompleto || d.Codice || d.codice) === codicePulito
  );

  if (!dispositivo) {
    alert("Dispositivo non trovato. Sincronizza il database e riprova.\nCodice: " + codicePulito);
    return;
  }

  document.getElementById("authScreen").classList.remove("active");
  document.getElementById("mainApp").classList.add("active");

  renderArchivio();
  openDevice(codicePulito);
}

function openPendingQrIfPresent() {
  const pendingCode = localStorage.getItem("cvls_pending_qr_open");

  if (!pendingCode) {
    return;
  }

  if (localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) !== AUTH_STATUS.AUTHORIZED) {
    return;
  }

  localStorage.removeItem("cvls_pending_qr_open");
  openDeviceFromQRNow(pendingCode);
}

window.openDeviceFromQR = function (codice) {
  const codicePulito = format11(codice);

  if (localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) !== AUTH_STATUS.AUTHORIZED) {
    localStorage.setItem("cvls_pending_qr_open", codicePulito);
    showAuthScreen();
    alert("Dispositivo non autorizzato. Effettua l'autorizzazione e poi sincronizza.");
    return;
  }

  openDeviceFromQRNow(codicePulito);
};

function ensureDeviceData(codiceCompleto, device) {
  const id = format11(codiceCompleto);

  if (!dati.macchine[id]) {
    dati.macchine[id] = {
      dispositivo: "",
      marca: "",
      modello: "",
      matricola: "",
      anno: "",
      alimentazione: "",
      kilowatt: ""
    };
  }

  if (!dati.manutenzioni[id]) dati.manutenzioni[id] = [];
  if (!dati.note[id]) dati.note[id] = [];
  if (!dati.materiali[id]) dati.materiali[id] = [];
  if (!dati.allegati[id]) dati.allegati[id] = [];

  if (!dati.cvls[id]) {
    dati.cvls[id] = {
      Modello: "",
      Mat: "",
      "Tipologia cella": "",
      "Codice cella": "",
      Calibrazione: "NO",
      Sostituzione: "NO",
      "Data scadenza cella": "",
      "Prossimo controllo": "",
      "Data scadenza cella calendar": "",
      "Prossimo controllo calendar": "",
      Data: "",
      Tecnico: "",
      Firma: ""
    };
  }

  /*
   * Aggiorna anche le vecchie etichette già esistenti,
   * così non mancano i nuovi campi.
   */
  if (dati.cvls[id]) {
    if (dati.cvls[id]["Tipologia cella"] === undefined) {
      dati.cvls[id]["Tipologia cella"] = "";
    }

    if (dati.cvls[id]["Codice cella"] === undefined) {
      dati.cvls[id]["Codice cella"] = "";
    }

    if (dati.cvls[id]["Data scadenza cella calendar"] === undefined) {
      dati.cvls[id]["Data scadenza cella calendar"] = "";
    }

    if (dati.cvls[id]["Prossimo controllo calendar"] === undefined) {
      dati.cvls[id]["Prossimo controllo calendar"] = "";
    }
  }

  saveLocalData();
}

/* =========================
   MANUTENZIONE
========================= */

let cvlsTabelleStoricoFrame = null;

function aggiornaAltezzaTabellaStorico(scrollId, bodyId, righeVisibili) {
  const box = document.getElementById(scrollId);
  const body = document.getElementById(bodyId);

  if (!box || !body) return;

  const table = box.querySelector("table");
  if (!table) return;

  const rows = Array.from(body.children).filter(function (row) {
    return row.tagName === "TR";
  });

  box.style.maxHeight = "";
  box.classList.remove("maintenance-table-scroll-active");

  if (rows.length <= righeVisibili) return;

  let height = table.tHead
    ? table.tHead.getBoundingClientRect().height
    : 0;

  rows.slice(0, righeVisibili).forEach(function (row) {
    height += row.getBoundingClientRect().height;
  });

  box.style.maxHeight = Math.ceil(height + 2) + "px";
  box.classList.add("maintenance-table-scroll-active");
}

function aggiornaScorrimentoTabelleStorico() {
  aggiornaAltezzaTabellaStorico("manutenzioniTableScroll", "manutenzioniBody", 4);
  aggiornaAltezzaTabellaStorico("noteTableScroll", "noteBody", 4);
  aggiornaAltezzaTabellaStorico("materialiTableScroll", "materialiBody", 4);
  aggiornaAltezzaTabellaStorico("allegatiTableScroll", "allegatiBody", 4);
}

function pianificaAggiornamentoTabelleStorico() {
  if (cvlsTabelleStoricoFrame !== null) {
    cancelAnimationFrame(cvlsTabelleStoricoFrame);
  }

  cvlsTabelleStoricoFrame = requestAnimationFrame(function () {
    cvlsTabelleStoricoFrame = null;
    aggiornaScorrimentoTabelleStorico();
  });
}

function abilitaPassaggioScrollTabelleStorico() {
  const configurazioni = [
    ["manutenzioniTableScroll", "manutenzioniBody"],
    ["noteTableScroll", "noteBody"],
    ["materialiTableScroll", "materialiBody"],
    ["allegatiTableScroll", "allegatiBody"]
  ];

  let inertiaFrame = null;

  function stopInertia() {
    if (inertiaFrame !== null) {
      cancelAnimationFrame(inertiaFrame);
      inertiaFrame = null;
    }
  }

  configurazioni.forEach(function (config) {
    const box = document.getElementById(config[0]);
    const body = document.getElementById(config[1]);

    if (!box) return;

    if (body && !box.cvlsTableObserver) {
      box.cvlsTableObserver = new MutationObserver(function () {
        pianificaAggiornamentoTabelleStorico();
      });

      box.cvlsTableObserver.observe(body, {
        childList: true,
        subtree: true
      });
    }

    if (box.dataset.scrollTabellaAttivo === "1") return;
    box.dataset.scrollTabellaAttivo = "1";

    let active = false;
    let axis = "";
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocityY = 0;

    function applyVerticalDelta(delta) {
      let remaining = delta;
      let applied = 0;

      const maxBoxScroll = Math.max(
        0,
        box.scrollHeight - box.clientHeight
      );

      const beforeBox = box.scrollTop;
      const nextBox = Math.max(
        0,
        Math.min(maxBoxScroll, beforeBox + remaining)
      );

      box.scrollTop = nextBox;

      const boxDelta = nextBox - beforeBox;
      remaining -= boxDelta;
      applied += boxDelta;

      if (Math.abs(remaining) > 0.01) {
        const beforePage = window.scrollY;
        window.scrollBy(0, remaining);
        applied += window.scrollY - beforePage;
      }

      return applied;
    }

    function startInertia() {
      stopInertia();

      let velocity = velocityY;
      if (Math.abs(velocity) < 0.05) return;

      let previousTime = performance.now();

      function step(currentTime) {
        const elapsed = Math.min(
          32,
          Math.max(1, currentTime - previousTime)
        );

        previousTime = currentTime;

        const moved = applyVerticalDelta(
          velocity * elapsed
        );

        velocity *= Math.pow(
          0.92,
          elapsed / 16.67
        );

        if (
          Math.abs(velocity) < 0.02 ||
          Math.abs(moved) < 0.1
        ) {
          inertiaFrame = null;
          return;
        }

        inertiaFrame = requestAnimationFrame(step);
      }

      inertiaFrame = requestAnimationFrame(step);
    }

    box.addEventListener("touchstart", function (event) {
      if (!event.touches || event.touches.length !== 1) return;

      stopInertia();

      const touch = event.touches[0];

      active = true;
      axis = "";
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = touch.clientY;
      lastTime = performance.now();
      velocityY = 0;
    }, { passive: true });

    box.addEventListener("touchmove", function (event) {
      if (!active || !event.touches || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const distanceX = Math.abs(touch.clientX - startX);
      const distanceY = Math.abs(touch.clientY - startY);

      if (!axis) {
        if (Math.max(distanceX, distanceY) <= 4) {
          lastY = touch.clientY;
          return;
        }

        axis = distanceX > distanceY ? "x" : "y";
      }

      if (axis === "x") return;

      const newY = touch.clientY;
      const deltaY = lastY - newY;
      const now = performance.now();
      const elapsed = Math.max(8, now - lastTime);

      lastY = newY;
      lastTime = now;

      if (event.cancelable) event.preventDefault();

      const instantVelocity = deltaY / elapsed;
      velocityY = velocityY * 0.72 + instantVelocity * 0.28;

      applyVerticalDelta(deltaY);
    }, { passive: false });

    box.addEventListener("touchend", function () {
      if (!active) return;

      active = false;

      if (
        axis === "y" &&
        performance.now() - lastTime < 90
      ) {
        startInertia();
      }

      axis = "";
    }, { passive: true });

    box.addEventListener("touchcancel", function () {
      active = false;
      axis = "";
      velocityY = 0;
      stopInertia();
    }, { passive: true });
  });

  window.addEventListener(
    "resize",
    pianificaAggiornamentoTabelleStorico,
    { passive: true }
  );

  pianificaAggiornamentoTabelleStorico();
}


function renderAllManutenzione() {
  renderTecnica();
  renderManutenzioni();
  renderNote();
  renderMateriali();
  renderAllegati();
  refreshAdminView();
}

function renderTecnica() {
  const view = document.getElementById("viewTecnica");
  const edit = document.getElementById("editTecnica");
  const macchina = dati.macchine[currentDeviceId] || {};

  view.innerHTML = "";
  edit.innerHTML = "";

  campiTecnici.forEach(([key, label]) => {
    const value = macchina[key] || "";

    const rowView = document.createElement("div");
    rowView.className = "row";
    rowView.innerHTML = `
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    `;
    view.appendChild(rowView);

    const rowEdit = document.createElement("div");
    rowEdit.className = "row";

    const labelEdit = document.createElement("div");
    labelEdit.className = "label";
    labelEdit.textContent = label;

    const editField = document.createElement("div");
    editField.className = "edit-field";

    let input;

    if (key === "dispositivo") {
      input = document.createElement("select");

      const opzioneVuota = document.createElement("option");
      opzioneVuota.value = "";
      opzioneVuota.textContent = "-";
      opzioneVuota.selected = !value;
      input.appendChild(opzioneVuota);

      tipiDispositivoTecnico.forEach(function (nome) {
        const option = document.createElement("option");
        option.value = nome;
        option.textContent = nome;
        option.selected = value === nome;
        input.appendChild(option);
      });
    } else {
      input = document.createElement("input");
      input.value = value;
    }

    input.id = "tech_" + key;

    editField.appendChild(input);
    rowEdit.appendChild(labelEdit);
    rowEdit.appendChild(editField);
    edit.appendChild(rowEdit);
  });
}

function abilitaModificaTecnica() {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!currentDeviceId) {
    return;
  }

  isLoggedTecnica = true;
  refreshAdminView();

  window.setTimeout(function () {
    const primoCampo = document.querySelector(
      "#editTecnica input, #editTecnica select"
    );

    if (primoCampo) {
      primoCampo.focus();
    }
  }, 0);
}

function saveTecnica() {
  const macchina = dati.macchine[currentDeviceId];

  campiTecnici.forEach(([key]) => {
    const el = document.getElementById("tech_" + key);
    if (el) macchina[key] = el.value;
  });

  isLoggedTecnica = false;

  saveLocalData();
  savePendingChange({ type: "SAVE_MACCHINA", deviceId: currentDeviceId, payload: macchina });
  renderAllManutenzione();
  alert("Dati salvati.");
}

function refreshAdminView() {
  const viewTecnica =
    document.getElementById("viewTecnica");

  const editTecnica =
    document.getElementById("editTecnica");

  const modificaTecnicaBtn =
    document.getElementById("openTecnicaBtn");

  const salvaTecnicaBtn =
    document.getElementById("saveTecnicaBtn");

  const azioniHead =
    document.getElementById("azioniHead");

  /*
   * Scheda manutenzione:
   * i campi devono essere sempre visibili.
   * Non usiamo più la vista testo con linee tratteggiate.
   */
  if (viewTecnica) {
    viewTecnica.classList.add("hidden");
  }

  if (editTecnica) {
    editTecnica.classList.remove("hidden");
    editTecnica.classList.toggle(
      "tecnica-readonly-mode",
      !isLoggedTecnica
    );
  }

  bloccaCampiTecnica(!isLoggedTecnica);

  if (modificaTecnicaBtn) {
    modificaTecnicaBtn.classList.toggle(
      "hidden",
      isLoggedTecnica
    );
  }

  if (salvaTecnicaBtn) {
    salvaTecnicaBtn.classList.toggle(
      "hidden",
      !isLoggedTecnica
    );
  }

  if (azioniHead) {
    azioniHead.classList.toggle(
      "hidden",
      !isLoggedStorico
    );
  }

  renderManutenzioni();
}

function bloccaCampiTecnica(bloccato) {
  const editTecnica =
    document.getElementById("editTecnica");

  if (!editTecnica) {
    return;
  }

  editTecnica
    .querySelectorAll("input, select, textarea")
    .forEach(function (el) {
      if (bloccato) {
        el.disabled = true;
        el.readOnly = true;
        el.tabIndex = -1;
        el.style.pointerEvents = "none";
      } else {
        el.disabled = false;
        el.readOnly = false;
        el.tabIndex = 0;
        el.style.pointerEvents = "auto";
      }
    });
}

function goDeviceSubpage(num, preserveForwardHistory) {
  if (!preserveForwardHistory) {
    cvlsClearForwardHistory();
  }
  document
    .querySelectorAll(".device-subpage")
    .forEach(function (page) {
      page.classList.remove("active");
    });

  const targetPage =
    document.getElementById("page" + num);

  if (targetPage) {
    targetPage.classList.add("active");
  }

  /*
   * Ogni volta che si apre la pagina 2:
   * - le tabelle restano visibili;
   * - i quattro pannelli di compilazione partono chiusi;
   * - i pulsanti mostrano il simbolo +.
   */
  if (Number(num) === 2) {
    resetPage2Editors();

    renderManutenzioni();
    renderNote();
    renderMateriali();
    renderAllegati();
  }

  window.scrollTo(0, 0);
}

function cvlsCreateLocalRowId(prefix) {
  return (
    prefix +
    "-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

function cvlsManutenzioneKey(manutenzione) {
  const m = manutenzione || {};

  return [
    String(m.descrizione || "").trim(),
    String(m.ore || "").trim(),
    String(m.data || "").trim(),
    String(m.tecnico || "").trim()
  ].join("|");
}

function cvlsIsPendingAddManutenzione(change, deviceId, manutenzione) {
  if (!change || change.type !== "ADD_MANUTENZIONE") {
    return false;
  }

  if (format11(change.deviceId || "") !== format11(deviceId || "")) {
    return false;
  }

  const payload = change.payload || {};
  const localId = String(manutenzione && manutenzione.__localId || "").trim();

  if (localId) {
    return String(payload.__localId || "").trim() === localId;
  }

  return cvlsManutenzioneKey(payload) === cvlsManutenzioneKey(manutenzione);
}

function cvlsGetPendingAddManutenzione(deviceId, manutenzione) {
  const pending = getPendingChanges();

  const index = pending.findIndex(function (change) {
    return cvlsIsPendingAddManutenzione(
      change,
      deviceId,
      manutenzione
    );
  });

  return {
    pending: pending,
    change: index >= 0 ? pending[index] : null,
    index: index
  };
}

function cvlsApriPopupModificaManutenzione(manutenzione, onSave) {
  const oldOverlay = document.getElementById("cvlsEditManutenzioneOverlay");

  if (oldOverlay) {
    oldOverlay.remove();
  }

  const m = manutenzione || {};

  const overlay = document.createElement("div");
  overlay.id = "cvlsEditManutenzioneOverlay";
  overlay.className = "cvls-dialog-overlay";

  overlay.innerHTML = `
    <div class="cvls-dialog-card">
      <h3>Modifica manutenzione</h3>

      <label>Descrizione</label>
      <input
        id="cvlsEditManutenzioneDescrizione"
        class="cvls-dialog-form-control"
        type="text"
        value="${escapeHtml(m.descrizione || "")}"
      >

      <label>Ore</label>
      <input
        id="cvlsEditManutenzioneOre"
        class="cvls-dialog-form-control"
        type="text"
        value="${escapeHtml(m.ore || "")}"
      >

      <label>Data</label>
      <input
        id="cvlsEditManutenzioneData"
        class="cvls-dialog-form-control"
        type="date"
        value="${escapeHtml(m.data || "")}"
      >

      <label>Nome tecnico</label>
      <input
        id="cvlsEditManutenzioneTecnico"
        class="cvls-dialog-form-control"
        type="text"
        value="${escapeHtml(m.tecnico || "")}"
      >

      <div class="cvls-dialog-actions">
        <button
          id="cvlsEditManutenzioneCancel"
          class="cvls-dialog-btn cancel"
          type="button"
        >
          Annulla
        </button>

        <button
          id="cvlsEditManutenzioneOk"
          class="cvls-dialog-btn ok"
          type="button"
        >
          Salva
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = function () {
    overlay.remove();
  };

  document
    .getElementById("cvlsEditManutenzioneCancel")
    .onclick = close;

  document
    .getElementById("cvlsEditManutenzioneOk")
    .onclick = function () {
      const nuovaManutenzione = {
        ...(m || {}),
        descrizione: getValue("cvlsEditManutenzioneDescrizione").trim(),
        ore: getValue("cvlsEditManutenzioneOre").trim(),
        data: getValue("cvlsEditManutenzioneData").trim(),
        tecnico: getValue("cvlsEditManutenzioneTecnico").trim()
      };

      if (
        !nuovaManutenzione.descrizione &&
        !nuovaManutenzione.ore &&
        !nuovaManutenzione.data &&
        !nuovaManutenzione.tecnico
      ) {
        cvlsAlert(
          "Inserisci almeno un dato.",
          "Dati mancanti"
        );
        return;
      }

      close();

      if (typeof onSave === "function") {
        onSave(nuovaManutenzione);
      }
    };

  window.setTimeout(function () {
    const input = document.getElementById("cvlsEditManutenzioneDescrizione");

    if (input) {
      input.focus();
    }
  }, 80);
}

function modificaManutenzione(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.manutenzioni[currentDeviceId] || [];
  const manutenzione = lista[originalIndex];

  if (!manutenzione) {
    cvlsAlert("Manutenzione non trovata.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddManutenzione(
    currentDeviceId,
    manutenzione
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const oldOverlay = document.getElementById("cvlsEditManutenzioneOverlay");

  if (oldOverlay) {
    oldOverlay.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "cvlsEditManutenzioneOverlay";
  overlay.className = "cvls-action-menu-overlay";

  const card = document.createElement("div");
  card.className = "cvls-action-menu-card cvls-edit-row-card";

  card.innerHTML = `
    <div class="cvls-action-menu-title">Modifica manutenzione</div>

    <input
      id="cvlsEditManutenzioneDescrizione"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Descrizione"
      value="${escapeHtml(manutenzione.descrizione || "")}"
    >

    <input
      id="cvlsEditManutenzioneOre"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Ore"
      value="${escapeHtml(manutenzione.ore || "")}"
    >

    <input
      id="cvlsEditManutenzioneData"
      class="cvls-edit-row-input"
      type="date"
      value="${escapeHtml(manutenzione.data || "")}"
    >

    <input
      id="cvlsEditManutenzioneTecnico"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Nome tecnico"
      value="${escapeHtml(manutenzione.tecnico || "")}"
    >

    <button
      id="cvlsEditManutenzioneSave"
      class="cvls-action-menu-btn"
      type="button"
    >
      Salva
    </button>

    <button
      id="cvlsEditManutenzioneCancel"
      class="cvls-action-menu-btn cancel"
      type="button"
    >
      Annulla
    </button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  document
    .getElementById("cvlsEditManutenzioneCancel")
    .onclick = function () {
      overlay.remove();
    };

  document
    .getElementById("cvlsEditManutenzioneSave")
    .onclick = function () {
      const nuovaManutenzione = {
        ...(manutenzione || {}),
        descrizione: getValue("cvlsEditManutenzioneDescrizione").trim(),
        ore: getValue("cvlsEditManutenzioneOre").trim(),
        data: getValue("cvlsEditManutenzioneData").trim(),
        tecnico: getValue("cvlsEditManutenzioneTecnico").trim()
      };

      if (
        !nuovaManutenzione.descrizione &&
        !nuovaManutenzione.ore &&
        !nuovaManutenzione.data &&
        !nuovaManutenzione.tecnico
      ) {
        cvlsAlert(
          "Inserisci almeno un dato.",
          "Dati mancanti"
        );
        return;
      }

      lista[originalIndex] = nuovaManutenzione;

      pendingInfo.change.payload = {
        ...(pendingInfo.change.payload || {}),
        ...nuovaManutenzione
      };

      pendingInfo.change.updatedAt = new Date().toISOString();

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      overlay.remove();

      saveLocalData();
      updateStatusBox();
      renderManutenzioni();

      showCvlsToast("Manutenzione aggiornata");
    };

  window.setTimeout(function () {
    const input = document.getElementById("cvlsEditManutenzioneDescrizione");

    if (input) {
      input.focus();
    }
  }, 100);
}

function eliminaManutenzioneNonSincronizzata(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.manutenzioni[currentDeviceId] || [];
  const manutenzione = lista[originalIndex];

  if (!manutenzione) {
    return;
  }

  const pendingInfo = cvlsGetPendingAddManutenzione(
    currentDeviceId,
    manutenzione
  );

  if (!pendingInfo.change) {
    deleteManutenzione(originalIndex);
    return;
  }

  cvlsConfirm(
    "Vuoi eliminare questa manutenzione non ancora sincronizzata?",
    function () {
      lista.splice(originalIndex, 1);

      cvlsRemovePendingChangesWhere(function (change) {
        return cvlsIsPendingAddManutenzione(
          change,
          currentDeviceId,
          manutenzione
        );
      });

      saveLocalData();
      renderManutenzioni();

      showCvlsToast("Manutenzione eliminata");
    },
    null,
    "Elimina manutenzione"
  );
}

function renderManutenzioni() {
  const body = document.getElementById("manutenzioniBody");
  const azioniHead = document.getElementById("azioniHead");
  const listaOriginale = dati.manutenzioni[currentDeviceId] || [];

  if (azioniHead) {
    azioniHead.classList.add("hidden");
  }

  body.innerHTML = "";

  if (listaOriginale.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "Nessuna manutenzione registrata.";

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const listaOrdinata = listaOriginale
    .map((manutenzione, originalIndex) => ({
      manutenzione,
      originalIndex
    }))
    .sort((a, b) => {
      const dataA = a.manutenzione.data || "";
      const dataB = b.manutenzione.data || "";

      const confrontoData = dataB.localeCompare(dataA);

      if (confrontoData !== 0) {
        return confrontoData;
      }

      return b.originalIndex - a.originalIndex;
    });

  listaOrdinata.forEach(({ manutenzione: m, originalIndex }) => {
    const tr = document.createElement("tr");

    addCell(tr, m.descrizione || "");
    addCell(tr, m.ore || "");
    addCell(tr, m.data || "");
    addCell(tr, m.tecnico || "");

    const richiestaEliminazione = getDeleteRequestForMaintenance(
      currentDeviceId,
      m
    );

    const eliminazioneInAttesa =
      isDeleteRequestBlocking(richiestaEliminazione);

    if (eliminazioneInAttesa) {
      tr.classList.add("cvls-delete-request-pending");
      tr.title = "Richiesta di cancellazione in attesa di conferma";
    } else {
      abilitaMenuPressioneLunga(tr, {
        title: "Manutenzione",
        modifica: function () {
          modificaManutenzione(originalIndex);
        },
        elimina: function () {
          const manutenzioneNonSincronizzata =
            !!cvlsGetPendingAddManutenzione(
              currentDeviceId,
              m
            ).change;

          if (manutenzioneNonSincronizzata) {
            eliminaManutenzioneNonSincronizzata(originalIndex);
            return;
          }

          deleteManutenzione(originalIndex);
        },
        puoModificare: true,
        puoEliminare: true
      });
    }

    body.appendChild(tr);
  });
}

function toggleStoricoEditor() {
  const panel =
    document.getElementById("addManutenzioneBox");

  if (!panel) {
    return;
  }

  const deveAprire =
    panel.classList.contains("hidden");

  isLoggedStorico = deveAprire;

  setPage2EditorState(
    "addManutenzioneBox",
    "loginStoricoBtn",
    deveAprire
  );

  refreshAdminView();
}

function addManutenzione() {
  const manutenzione = {
    __localId: cvlsCreateLocalRowId("MAN"),
    descrizione: getValue("mDescrizione"),
    ore: getValue("mOre"),
    data: getValue("mData"),
    tecnico: getValue("mTecnico")
  };

  if (!manutenzione.descrizione && !manutenzione.ore && !manutenzione.data && !manutenzione.tecnico) {
    alert("Inserisci almeno un dato.");
    return;
  }

  dati.manutenzioni[currentDeviceId].push(manutenzione);

  setValue("mDescrizione", "");
  setValue("mOre", "");
  setValue("mData", "");
  setValue("mTecnico", "");

  saveLocalData();
  savePendingChange({ type: "ADD_MANUTENZIONE", deviceId: currentDeviceId, payload: manutenzione });
  renderManutenzioni();
}

function cvlsFormatDateTimeDb(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);

  if (isNaN(d.getTime())) {
    return "";
  }

  const pad = function (value) {
    return String(value).padStart(2, "0");
  };

  return (
    pad(d.getDate()) +
    "/" +
    pad(d.getMonth() + 1) +
    "/" +
    d.getFullYear() +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

function createMaintenanceDeleteRequestId() {
  return (
    "DEL-MAN-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

function getMaintenanceDeleteRequests() {
  if (!Array.isArray(dati.richiesteEliminazioneManutenzioni)) {
    dati.richiesteEliminazioneManutenzioni = [];
  }

  return dati.richiesteEliminazioneManutenzioni;
}

function cvlsMaintenanceDeleteRecordKey(deviceId, manutenzione) {
  const m = manutenzione || {};

  return [
    format11(deviceId || ""),
    String(m.descrizione || "").trim(),
    String(m.ore || "").trim(),
    String(m.data || "").trim(),
    String(m.tecnico || "").trim()
  ].join("|");
}

function cvlsMaintenanceDeleteDescription(manutenzione) {
  const m = manutenzione || {};

  return [
    String(m.data || "").trim(),
    String(m.descrizione || "").trim(),
    String(m.ore || "").trim() ? "Ore: " + String(m.ore || "").trim() : "",
    String(m.tecnico || "").trim()
  ]
    .filter(Boolean)
    .join(" - ");
}

function getDeleteRequestForMaintenance(deviceId, manutenzione) {
  const recordKey = cvlsMaintenanceDeleteRecordKey(
    deviceId,
    manutenzione
  );

  return getMaintenanceDeleteRequests().find(function (request) {
    return (
      String(request.RecordKey || "") === recordKey &&
      String(request.Stato || "") !== "eseguita"
    );
  }) || null;
}

function upsertLocalMaintenanceDeleteRequest(request) {
  const lista = getMaintenanceDeleteRequests();

  const index = lista.findIndex(function (item) {
    return String(item.IDRichiesta || "") === String(request.IDRichiesta || "");
  });

  if (index >= 0) {
    lista[index] = {
      ...lista[index],
      ...request
    };
  } else {
    lista.push(request);
  }
}

function savePendingMaintenanceDeleteRequestChange(request) {
  savePendingChange({
    type: "RICHIESTA_ELIMINAZIONE_MANUTENZIONE",
    deviceId: currentDeviceId,
    payload: request
  });
}

function deleteManutenzione(index) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.manutenzioni[currentDeviceId] || [];
  const manutenzione = lista[index];

  if (!manutenzione) {
    cvlsAlert("Manutenzione non trovata.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddManutenzione(
    currentDeviceId,
    manutenzione
  );

  if (pendingInfo.change) {
    eliminaManutenzioneNonSincronizzata(index);
    return;
  }

  const deviceKey = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_KEY) || ""
  ).trim();

  const identificativo = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_IDENTIFIER) || ""
  ).trim();

  const richiestaEsistente = getDeleteRequestForMaintenance(
    currentDeviceId,
    manutenzione
  );

  if (isDeleteRequestBlocking(richiestaEsistente)) {
    cvlsAlert(
      "La richiesta di cancellazione è già in attesa di conferma.",
      "Richiesta già presente"
    );
    return;
  }

  if (!deviceKey) {
    cvlsAlert(
      "DeviceKey non disponibile. Sincronizza nuovamente l’autorizzazione del dispositivo.",
      "Richiesta non disponibile"
    );
    return;
  }

  cvlsConfirm(
    "Vuoi richiedere la cancellazione di questa manutenzione?",
    function () {
      const now = cvlsFormatDateTimeDb(new Date());

      const request = {
        IDRichiesta:
          (richiestaEsistente && richiestaEsistente.IDRichiesta) ||
          createMaintenanceDeleteRequestId(),
        CodiceCompleto: format11(currentDeviceId),
        TipoRecord: "manutenzione",
        RecordKey: cvlsMaintenanceDeleteRecordKey(
          currentDeviceId,
          manutenzione
        ),
        DescrizioneRecord: cvlsMaintenanceDeleteDescription(manutenzione),
        DeviceKeyRichiedente: deviceKey,
        IdentificativoDispositivo: identificativo,
        Stato: "in_attesa",
        DataRichiesta: now,
        DataAutorizzazione: "",
        DataRifiuto: "",
        DataEsecuzione: "",
        Note: ""
      };

      upsertLocalMaintenanceDeleteRequest(request);
      saveLocalData();
      savePendingMaintenanceDeleteRequestChange(request);
      renderManutenzioni();

      cvlsAlert(
        "Richiesta di cancellazione in attesa di conferma",
        "Richiesta registrata"
      );
    },
    null,
    "Elimina manutenzione"
  );
}
/*
 * Non serve più un pulsante Fine:
 * il pannello viene chiuso dal pulsante −.
 */

function openProgrammaManutenzione() {
  document.getElementById("popupProgrammaManutenzione").classList.remove("hidden");
}

function closeProgrammaManutenzione() {
  document.getElementById("popupProgrammaManutenzione").classList.add("hidden");
}

function confermaProgrammaManutenzione() {
  const device = currentDeviceData || {};

  const item = {
    id: "PM-" + Date.now().toString(36).toUpperCase(),
    deviceId: currentDeviceId,
    codiceCompleto: currentDeviceId,

    data: getValue("pmData"),
    testo: getValue("pmTesto").trim(),
    tipo: getValue("pmTipo") || "dispositivo",

    nomeDispositivo: device.NomeDispositivo || "",
    codicePresidio: device.CodicePresidio ? format2(device.CodicePresidio) : "",
    nomePresidio: device.NomePresidio || "",
    nomeCitta: device.NomeCitta || "",
    nomeUbicazione: device.NomeUbicazione || "",

    createdAt: new Date().toISOString(),
    calendarStatus: "pending"
  };

  if (!item.data || !item.testo) {
    alert("Compila tutti i campi.");
    return;
  }

  if (!Array.isArray(dati.programmazioni)) {
    dati.programmazioni = [];
  }

  dati.programmazioni.push(item);

  setValue("pmData", "");
  setValue("pmTesto", "");
  closeProgrammaManutenzione();

  saveLocalData();

  savePendingChange({
    type: "PROGRAMMA_MANUTENZIONE",
    deviceId: currentDeviceId,
    payload: item
  });

  alert("Programmazione salvata localmente. Premi Sincronizza per creare l’evento su Google Calendar.");
}

/* =========================
   NOTE / MATERIALI / ALLEGATI
========================= */

function toggleNoteEditor() {
  const panel =
    document.getElementById("noteEditorPanel");

  if (!panel) {
    return;
  }

  const deveAprire =
    panel.classList.contains("hidden");

  if (!deveAprire) {
    deleteModeNote = false;
  }

  setPage2EditorState(
    "noteEditorPanel",
    "toggleNoteEditorBtn",
    deveAprire
  );

  renderNote();
}

function toggleMaterialiEditor() {
  const panel =
    document.getElementById("materialiEditorPanel");

  if (!panel) {
    return;
  }

  const deveAprire =
    panel.classList.contains("hidden");

  if (!deveAprire) {
    deleteModeMateriali = false;
  }

  setPage2EditorState(
    "materialiEditorPanel",
    "toggleMaterialiEditorBtn",
    deveAprire
  );

  renderMateriali();
}

function toggleAllegatiEditor() {
  const panel =
    document.getElementById("allegatiEditorPanel");

  if (!panel) {
    return;
  }

  const deveAprire =
    panel.classList.contains("hidden");

  if (!deveAprire) {
    deleteModeAllegati = false;
  }

  setPage2EditorState(
    "allegatiEditorPanel",
    "toggleAllegatiEditorBtn",
    deveAprire
  );

  renderAllegati();
}

function setPage2EditorState(
  panelId,
  buttonId,
  isOpen
) {
  const panel =
    document.getElementById(panelId);

  const button =
    document.getElementById(buttonId);

  if (panel) {
    panel.classList.toggle(
      "hidden",
      !isOpen
    );
  }

  if (button) {
    button.textContent =
      isOpen ? "−" : "+";

    button.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false"
    );
  }
}

function resetPage2Editors() {
  isLoggedStorico = false;
  isLoggedNoteMateriali = true;

  deleteModeNote = false;
  deleteModeMateriali = false;
  deleteModeAllegati = false;

  setPage2EditorState(
    "addManutenzioneBox",
    "loginStoricoBtn",
    false
  );

  setPage2EditorState(
    "noteEditorPanel",
    "toggleNoteEditorBtn",
    false
  );

  setPage2EditorState(
    "materialiEditorPanel",
    "toggleMaterialiEditorBtn",
    false
  );

  setPage2EditorState(
    "allegatiEditorPanel",
    "toggleAllegatiEditorBtn",
    false
  );

  refreshAdminView();
}

function cvlsNotaKey(nota) {
  const n = nota || {};

  return [
    String(n.nota || "").trim(),
    String(n.data || "").trim()
  ].join("|");
}

function cvlsIsPendingAddNota(change, deviceId, nota) {
  if (!change || change.type !== "ADD_NOTA") {
    return false;
  }

  const payload = change.payload || {};

  const changeDeviceId = format11(
    change.deviceId ||
    payload.deviceId ||
    payload.codiceCompleto ||
    payload.CodiceCompleto ||
    ""
  );

  if (changeDeviceId && changeDeviceId !== format11(deviceId || "")) {
    return false;
  }

  const localId = String(nota && nota.__localId || "").trim();

  if (localId) {
    return String(payload.__localId || "").trim() === localId;
  }

  return cvlsNotaKey(payload) === cvlsNotaKey(nota);
}

function cvlsGetPendingAddNota(deviceId, nota) {
  const pending = getPendingChanges();

  const index = pending.findIndex(function (change) {
    return cvlsIsPendingAddNota(change, deviceId, nota);
  });

  return {
    pending: pending,
    change: index >= 0 ? pending[index] : null,
    index: index
  };
}

function createNoteDeleteRequestId() {
  return (
    "DEL-NOTA-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

function getNoteDeleteRequests() {
  if (!Array.isArray(dati.richiesteEliminazioneNote)) {
    dati.richiesteEliminazioneNote = [];
  }

  return dati.richiesteEliminazioneNote;
}

function cvlsNoteDeleteRecordKey(deviceId, nota) {
  const n = nota || {};

  return [
    format11(deviceId || ""),
    String(n.nota || "").trim(),
    String(n.data || "").trim()
  ].join("|");
}

function cvlsNoteDeleteDescription(nota) {
  const n = nota || {};

  return [
    String(n.data || "").trim(),
    String(n.nota || "").trim()
  ]
    .filter(Boolean)
    .join(" - ");
}

function getDeleteRequestForNote(deviceId, nota) {
  const recordKey = cvlsNoteDeleteRecordKey(
    deviceId,
    nota
  );

  return getNoteDeleteRequests().find(function (request) {
    return (
      String(request.RecordKey || "") === recordKey &&
      String(request.Stato || "") !== "eseguita"
    );
  }) || null;
}

function upsertLocalNoteDeleteRequest(request) {
  const lista = getNoteDeleteRequests();

  const index = lista.findIndex(function (item) {
    return String(item.IDRichiesta || "") === String(request.IDRichiesta || "");
  });

  if (index >= 0) {
    lista[index] = {
      ...lista[index],
      ...request
    };
  } else {
    lista.push(request);
  }
}

function savePendingNoteDeleteRequestChange(request) {
  savePendingChange({
    type: "RICHIESTA_ELIMINAZIONE_NOTA",
    deviceId: currentDeviceId,
    payload: request
  });
}

function modificaNota(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.note[currentDeviceId] || [];
  const nota = lista[originalIndex];

  if (!nota) {
    cvlsAlert("Nota non trovata.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddNota(
    currentDeviceId,
    nota
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const oldOverlay = document.getElementById("cvlsEditNotaOverlay");

  if (oldOverlay) {
    oldOverlay.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "cvlsEditNotaOverlay";
  overlay.className = "cvls-action-menu-overlay";

  const card = document.createElement("div");
  card.className = "cvls-action-menu-card cvls-edit-row-card";

  card.innerHTML = `
    <div class="cvls-action-menu-title">Modifica nota</div>

    <textarea
      id="cvlsEditNotaTesto"
      class="cvls-edit-row-input"
      placeholder="Nota"
      rows="4"
    >${escapeHtml(nota.nota || "")}</textarea>

    <input
      id="cvlsEditNotaData"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Data"
      value="${escapeHtml(nota.data || "")}"
    >

    <button
      id="cvlsEditNotaSave"
      class="cvls-action-menu-btn"
      type="button"
    >
      Salva
    </button>

    <button
      id="cvlsEditNotaCancel"
      class="cvls-action-menu-btn cancel"
      type="button"
    >
      Annulla
    </button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  document
    .getElementById("cvlsEditNotaCancel")
    .onclick = function () {
      overlay.remove();
    };

  document
    .getElementById("cvlsEditNotaSave")
    .onclick = function () {
      const nuovaNota = {
        ...(nota || {}),
        nota: getValue("cvlsEditNotaTesto").trim(),
        data: getValue("cvlsEditNotaData").trim()
      };

      if (!nuovaNota.nota) {
        cvlsAlert(
          "Scrivi una nota.",
          "Dati mancanti"
        );
        return;
      }

      lista[originalIndex] = nuovaNota;

      pendingInfo.change.payload = {
        ...(pendingInfo.change.payload || {}),
        ...nuovaNota
      };

      pendingInfo.change.updatedAt = new Date().toISOString();

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      overlay.remove();

      saveLocalData();
      updateStatusBox();
      renderNote();

      showCvlsToast("Nota aggiornata");
    };

  window.setTimeout(function () {
    const input = document.getElementById("cvlsEditNotaTesto");

    if (input) {
      input.focus();
    }
  }, 100);
}

function eliminaNotaNonSincronizzata(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.note[currentDeviceId] || [];
  const nota = lista[originalIndex];

  if (!nota) {
    cvlsAlert("Nota non trovata.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddNota(
    currentDeviceId,
    nota
  );

  if (!pendingInfo.change) {
    deleteNota(originalIndex);
    return;
  }

  cvlsConfirm(
    "Vuoi eliminare questa nota non ancora sincronizzata?",
    function () {
      lista.splice(originalIndex, 1);

      pendingInfo.pending.splice(pendingInfo.index, 1);

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();
      renderNote();

      showCvlsToast("Nota eliminata");
    },
    null,
    "Elimina nota"
  );
}

function renderNote() {
  const body = document.getElementById("noteBody");
  const listaOriginale = dati.note[currentDeviceId] || [];

  body.innerHTML = "";

  const noteAzioniHead =
    document.getElementById("noteAzioniHead");

  if (noteAzioniHead) {
    noteAzioniHead.classList.add("hidden");
  }

  if (listaOriginale.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 2;
    td.textContent = "Nessuna nota registrata.";

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const listaOrdinata = listaOriginale
    .map((nota, originalIndex) => ({
      nota,
      originalIndex
    }))
    .sort((a, b) => {
      const dataA = a.nota.data || "";
      const dataB = b.nota.data || "";

      const confrontoData = dataB.localeCompare(dataA);

      if (confrontoData !== 0) {
        return confrontoData;
      }

      return b.originalIndex - a.originalIndex;
    });

  listaOrdinata.forEach(({ nota, originalIndex }) => {
    const tr = document.createElement("tr");

    addCell(tr, nota.nota || "");
    addCell(tr, nota.data || "");

    const richiestaEliminazione = getDeleteRequestForNote(
      currentDeviceId,
      nota
    );

    const eliminazioneInAttesa =
      isDeleteRequestBlocking(richiestaEliminazione);

    if (eliminazioneInAttesa) {
      tr.classList.add("cvls-delete-request-pending");
      tr.title = "Richiesta di cancellazione in attesa di conferma";
    } else {
      abilitaMenuPressioneLunga(tr, {
        title: "Nota",
        modifica: function () {
          modificaNota(originalIndex);
        },
        elimina: function () {
          const notaNonSincronizzata =
            !!cvlsGetPendingAddNota(
              currentDeviceId,
              nota
            ).change;

          if (notaNonSincronizzata) {
            eliminaNotaNonSincronizzata(originalIndex);
            return;
          }

          deleteNota(originalIndex);
        },
        puoModificare: true,
        puoEliminare: true
      });
    }

    body.appendChild(tr);
  });
}

function addNota() {
  const testo = getValue("noteArea").trim();

  if (!testo) {
    cvlsAlert("Scrivi una nota.", "Dati mancanti");
    return;
  }

  if (!Array.isArray(dati.note[currentDeviceId])) {
    dati.note[currentDeviceId] = [];
  }

  const nota = {
    __localId: cvlsCreateLocalRowId("NOTA"),
    nota: testo,
    data: new Date().toLocaleDateString("it-IT")
  };

  dati.note[currentDeviceId].push(nota);
  setValue("noteArea", "");

  saveLocalData();

  savePendingChange({
    type: "ADD_NOTA",
    deviceId: currentDeviceId,
    payload: nota
  });

  renderNote();
}

function toggleDeleteNoteMode() {
  deleteModeNote = !deleteModeNote;
  renderNote();
}

function deleteNota(index) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.note[currentDeviceId] || [];
  const nota = lista[index];

  if (!nota) {
    cvlsAlert("Nota non trovata.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddNota(
    currentDeviceId,
    nota
  );

  if (pendingInfo.change) {
    eliminaNotaNonSincronizzata(index);
    return;
  }

  const deviceKey = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_KEY) || ""
  ).trim();

  const identificativo = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_IDENTIFIER) || ""
  ).trim();

  const richiestaEsistente = getDeleteRequestForNote(
    currentDeviceId,
    nota
  );

  if (isDeleteRequestBlocking(richiestaEsistente)) {
    cvlsAlert(
      "La richiesta di cancellazione è già in attesa di conferma.",
      "Richiesta già presente"
    );
    return;
  }

  if (!deviceKey) {
    cvlsAlert(
      "DeviceKey non disponibile. Sincronizza nuovamente l’autorizzazione del dispositivo.",
      "Richiesta non disponibile"
    );
    return;
  }

  cvlsConfirm(
    "Vuoi richiedere la cancellazione di questa nota?",
    function () {
      const now = cvlsFormatDateTimeDb(new Date());

      const request = {
        IDRichiesta:
          (richiestaEsistente && richiestaEsistente.IDRichiesta) ||
          createNoteDeleteRequestId(),
        CodiceCompleto: format11(currentDeviceId),
        TipoRecord: "nota",
        RecordKey: cvlsNoteDeleteRecordKey(
          currentDeviceId,
          nota
        ),
        DescrizioneRecord: cvlsNoteDeleteDescription(nota),
        DeviceKeyRichiedente: deviceKey,
        IdentificativoDispositivo: identificativo,
        Stato: "in_attesa",
        DataRichiesta: now,
        DataAutorizzazione: "",
        DataRifiuto: "",
        DataEsecuzione: "",
        Note: ""
      };

      upsertLocalNoteDeleteRequest(request);
      saveLocalData();
      savePendingNoteDeleteRequestChange(request);
      renderNote();

      cvlsAlert(
        "Richiesta di cancellazione in attesa di conferma",
        "Richiesta registrata"
      );
    },
    null,
    "Elimina nota"
  );
}

function cvlsMaterialeKey(materiale) {
  const m = materiale || {};

  return [
    String(m.codice || "").trim(),
    String(m.descrizione || "").trim(),
    String(m.marca || "").trim(),
    String(m.note || "").trim()
  ].join("|");
}

function cvlsIsPendingAddMateriale(change, deviceId, materiale) {
  if (!change || change.type !== "ADD_MATERIALE") {
    return false;
  }

  const payload = change.payload || {};

  const changeDeviceId = format11(
    change.deviceId ||
    payload.deviceId ||
    payload.codiceCompleto ||
    payload.CodiceCompleto ||
    ""
  );

  if (changeDeviceId && changeDeviceId !== format11(deviceId || "")) {
    return false;
  }

  const localId = String(materiale && materiale.__localId || "").trim();

  if (localId) {
    return String(payload.__localId || "").trim() === localId;
  }

  return cvlsMaterialeKey(payload) === cvlsMaterialeKey(materiale);
}

function cvlsGetPendingAddMateriale(deviceId, materiale) {
  const pending = getPendingChanges();

  const index = pending.findIndex(function (change) {
    return cvlsIsPendingAddMateriale(change, deviceId, materiale);
  });

  return {
    pending: pending,
    change: index >= 0 ? pending[index] : null,
    index: index
  };
}

function createMaterialDeleteRequestId() {
  return (
    "DEL-MAT-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

function getMaterialDeleteRequests() {
  if (!Array.isArray(dati.richiesteEliminazioneMateriali)) {
    dati.richiesteEliminazioneMateriali = [];
  }

  return dati.richiesteEliminazioneMateriali;
}

function cvlsMaterialDeleteRecordKey(deviceId, materiale) {
  const m = materiale || {};

  return [
    format11(deviceId || ""),
    String(m.codice || "").trim(),
    String(m.descrizione || "").trim(),
    String(m.marca || "").trim(),
    String(m.note || "").trim()
  ].join("|");
}

function cvlsMaterialDeleteDescription(materiale) {
  const m = materiale || {};

  return [
    String(m.codice || "").trim(),
    String(m.descrizione || "").trim(),
    String(m.marca || "").trim(),
    String(m.note || "").trim()
  ]
    .filter(Boolean)
    .join(" - ");
}

function getDeleteRequestForMateriale(deviceId, materiale) {
  const recordKey = cvlsMaterialDeleteRecordKey(
    deviceId,
    materiale
  );

  return getMaterialDeleteRequests().find(function (request) {
    return (
      String(request.RecordKey || "") === recordKey &&
      String(request.Stato || "") !== "eseguita"
    );
  }) || null;
}

function upsertLocalMaterialDeleteRequest(request) {
  const lista = getMaterialDeleteRequests();

  const index = lista.findIndex(function (item) {
    return String(item.IDRichiesta || "") === String(request.IDRichiesta || "");
  });

  if (index >= 0) {
    lista[index] = {
      ...lista[index],
      ...request
    };
  } else {
    lista.push(request);
  }
}

function savePendingMaterialDeleteRequestChange(request) {
  savePendingChange({
    type: "RICHIESTA_ELIMINAZIONE_MATERIALE",
    deviceId: currentDeviceId,
    payload: request
  });
}

function modificaMateriale(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.materiali[currentDeviceId] || [];
  const materiale = lista[originalIndex];

  if (!materiale) {
    cvlsAlert("Materiale non trovato.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddMateriale(
    currentDeviceId,
    materiale
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  const oldOverlay = document.getElementById("cvlsEditMaterialeOverlay");

  if (oldOverlay) {
    oldOverlay.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "cvlsEditMaterialeOverlay";
  overlay.className = "cvls-action-menu-overlay";

  const card = document.createElement("div");
  card.className = "cvls-action-menu-card cvls-edit-row-card";

  card.innerHTML = `
    <div class="cvls-action-menu-title">Modifica materiale</div>

    <input
      id="cvlsEditMaterialeCodice"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Codice"
      value="${escapeHtml(materiale.codice || "")}"
    >

    <input
      id="cvlsEditMaterialeDescrizione"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Descrizione"
      value="${escapeHtml(materiale.descrizione || "")}"
    >

    <input
      id="cvlsEditMaterialeMarca"
      class="cvls-edit-row-input"
      type="text"
      placeholder="Marca"
      value="${escapeHtml(materiale.marca || "")}"
    >

    <textarea
      id="cvlsEditMaterialeNote"
      class="cvls-edit-row-input"
      placeholder="Note"
      rows="3"
    >${escapeHtml(materiale.note || "")}</textarea>

    <button
      id="cvlsEditMaterialeSave"
      class="cvls-action-menu-btn"
      type="button"
    >
      Salva
    </button>

    <button
      id="cvlsEditMaterialeCancel"
      class="cvls-action-menu-btn cancel"
      type="button"
    >
      Annulla
    </button>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  document
    .getElementById("cvlsEditMaterialeCancel")
    .onclick = function () {
      overlay.remove();
    };

  document
    .getElementById("cvlsEditMaterialeSave")
    .onclick = function () {
      const nuovoMateriale = {
        ...(materiale || {}),
        codice: getValue("cvlsEditMaterialeCodice").trim(),
        descrizione: getValue("cvlsEditMaterialeDescrizione").trim(),
        marca: getValue("cvlsEditMaterialeMarca").trim(),
        note: getValue("cvlsEditMaterialeNote").trim()
      };

      if (
        !nuovoMateriale.codice &&
        !nuovoMateriale.descrizione &&
        !nuovoMateriale.marca &&
        !nuovoMateriale.note
      ) {
        cvlsAlert(
          "Inserisci almeno un dato materiale.",
          "Dati mancanti"
        );
        return;
      }

      lista[originalIndex] = nuovoMateriale;

      pendingInfo.change.payload = {
        ...(pendingInfo.change.payload || {}),
        ...nuovoMateriale
      };

      pendingInfo.change.updatedAt = new Date().toISOString();

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      overlay.remove();

      saveLocalData();
      updateStatusBox();
      renderMateriali();

      showCvlsToast("Materiale aggiornato");
    };

  window.setTimeout(function () {
    const input = document.getElementById("cvlsEditMaterialeCodice");

    if (input) {
      input.focus();
    }
  }, 100);
}

function eliminaMaterialeNonSincronizzato(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.materiali[currentDeviceId] || [];
  const materiale = lista[originalIndex];

  if (!materiale) {
    cvlsAlert("Materiale non trovato.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddMateriale(
    currentDeviceId,
    materiale
  );

  if (!pendingInfo.change) {
    deleteMateriale(originalIndex);
    return;
  }

  cvlsConfirm(
    "Vuoi eliminare questo materiale non ancora sincronizzato?",
    function () {
      lista.splice(originalIndex, 1);

      pendingInfo.pending.splice(pendingInfo.index, 1);

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();
      renderMateriali();

      showCvlsToast("Materiale eliminato");
    },
    null,
    "Elimina materiale"
  );
}

function renderMateriali() {
  const body = document.getElementById("materialiBody");
  const listaOriginale = dati.materiali[currentDeviceId] || [];

  body.innerHTML = "";

  const materialiAzioniHead =
    document.getElementById("materialiAzioniHead");

  if (materialiAzioniHead) {
    materialiAzioniHead.classList.add("hidden");
  }

  if (listaOriginale.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 4;
    td.textContent = "Nessun materiale inserito.";

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const listaOrdinata = listaOriginale
    .map((materiale, originalIndex) => ({
      materiale,
      originalIndex
    }))
    .sort((a, b) => b.originalIndex - a.originalIndex);

  listaOrdinata.forEach(({ materiale: m, originalIndex }) => {
    const tr = document.createElement("tr");

    addCell(tr, m.codice || "");
    addCell(tr, m.descrizione || "");
    addCell(tr, m.marca || "");
    addCell(tr, m.note || "");

    const richiestaEliminazione = getDeleteRequestForMateriale(
      currentDeviceId,
      m
    );

    const eliminazioneInAttesa =
      isDeleteRequestBlocking(richiestaEliminazione);

    if (eliminazioneInAttesa) {
      tr.classList.add("cvls-delete-request-pending");
      tr.title = "Richiesta di cancellazione in attesa di conferma";
    } else {
      abilitaMenuPressioneLunga(tr, {
        title: "Materiale",
        modifica: function () {
          modificaMateriale(originalIndex);
        },
        elimina: function () {
          const materialeNonSincronizzato =
            !!cvlsGetPendingAddMateriale(
              currentDeviceId,
              m
            ).change;

          if (materialeNonSincronizzato) {
            eliminaMaterialeNonSincronizzato(originalIndex);
            return;
          }

          deleteMateriale(originalIndex);
        },
        puoModificare: true,
        puoEliminare: true
      });
    }

    body.appendChild(tr);
  });
}

function addMateriale() {
  const materiale = {
    __localId: cvlsCreateLocalRowId("MAT"),
    codice: getValue("matCodice").trim(),
    descrizione: getValue("matDescrizione").trim(),
    marca: getValue("matMarca").trim(),
    note: getValue("matNote").trim()
  };

  if (
    !materiale.codice &&
    !materiale.descrizione &&
    !materiale.marca &&
    !materiale.note
  ) {
    cvlsAlert("Inserisci almeno un dato materiale.", "Dati mancanti");
    return;
  }

  if (!Array.isArray(dati.materiali[currentDeviceId])) {
    dati.materiali[currentDeviceId] = [];
  }

  dati.materiali[currentDeviceId].push(materiale);

  setValue("matCodice", "");
  setValue("matDescrizione", "");
  setValue("matMarca", "");
  setValue("matNote", "");

  saveLocalData();

  savePendingChange({
    type: "ADD_MATERIALE",
    deviceId: currentDeviceId,
    payload: materiale
  });

  renderMateriali();
}

function toggleDeleteMaterialiMode() {
  deleteModeMateriali = !deleteModeMateriali;
  renderMateriali();
}

function deleteMateriale(index) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.materiali[currentDeviceId] || [];
  const materiale = lista[index];

  if (!materiale) {
    cvlsAlert("Materiale non trovato.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddMateriale(
    currentDeviceId,
    materiale
  );

  if (pendingInfo.change) {
    eliminaMaterialeNonSincronizzato(index);
    return;
  }

  const deviceKey = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_KEY) || ""
  ).trim();

  const identificativo = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_IDENTIFIER) || ""
  ).trim();

  const richiestaEsistente = getDeleteRequestForMateriale(
    currentDeviceId,
    materiale
  );

  if (isDeleteRequestBlocking(richiestaEsistente)) {
    cvlsAlert(
      "La richiesta di cancellazione è già in attesa di conferma.",
      "Richiesta già presente"
    );
    return;
  }

  if (!deviceKey) {
    cvlsAlert(
      "DeviceKey non disponibile. Sincronizza nuovamente l’autorizzazione del dispositivo.",
      "Richiesta non disponibile"
    );
    return;
  }

  cvlsConfirm(
    "Vuoi richiedere la cancellazione di questo materiale?",
    function () {
      const now = cvlsFormatDateTimeDb(new Date());

      const request = {
        IDRichiesta: createMaterialDeleteRequestId(),
        CodiceCompleto: format11(currentDeviceId),
        TipoRecord: "materiale",
        RecordKey: cvlsMaterialDeleteRecordKey(
          currentDeviceId,
          materiale
        ),
        DescrizioneRecord: cvlsMaterialDeleteDescription(materiale),
        DeviceKeyRichiedente: deviceKey,
        IdentificativoDispositivo: identificativo,
        Stato: "in_attesa",
        DataRichiesta: now,
        DataAutorizzazione: "",
        DataRifiuto: "",
        DataEsecuzione: "",
        Note: ""
      };

      upsertLocalMaterialDeleteRequest(request);
      saveLocalData();
      savePendingMaterialDeleteRequestChange(request);
      renderMateriali();

      cvlsAlert(
        "Richiesta di cancellazione in attesa di conferma",
        "Richiesta registrata"
      );
    },
    null,
    "Elimina materiale"
  );
}

function createAttachmentSyncId() {
  return (
    "ATT-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 10).toUpperCase()
  );
}

function getAttachmentChangeSyncId(change) {
  if (!change) return "";

  return String(
    change.syncId ||
    (change.payload ? change.payload.syncId : "") ||
    ""
  ).trim();
}

function getPendingAttachmentData(syncId) {
  if (!syncId) return "";

  const pending = getPendingChanges();

  const change = pending.find(function (item) {
    return (
      item &&
      item.type === "ADD_ALLEGATO" &&
      getAttachmentChangeSyncId(item) === syncId
    );
  });

  return change && change.payload
    ? String(change.payload.data || "")
    : "";
}

function preparePendingChangesForSync() {
  const pending = getPendingChanges();

  let pendingChanged = false;
  let localDataChanged = false;

  pending.forEach(function (change) {
    if (!change) {
      return;
    }

    if (!change.changeId) {
      change.changeId = createPendingChangeId();
      pendingChanged = true;
    }

    if (!change.createdAt) {
      change.createdAt = new Date().toISOString();
      pendingChanged = true;
    }

    if (change.type !== "ADD_ALLEGATO") {
      return;
    }

    if (!change.payload) {
      change.payload = {};
      pendingChanged = true;
    }

    let syncId = getAttachmentChangeSyncId(change);

    if (!syncId) {
      syncId = createAttachmentSyncId();

      change.legacyRecovery = true;
      change.payload.legacyRecovery = true;
      pendingChanged = true;
    }

    if (change.syncId !== syncId) {
      change.syncId = syncId;
      pendingChanged = true;
    }

    if (change.payload.syncId !== syncId) {
      change.payload.syncId = syncId;
      pendingChanged = true;
    }

    const localFileId = String(
      change.localFileId ||
      change.payload.localFileId ||
      ""
    ).trim();

    if (localFileId) {
      if (change.localFileId !== localFileId) {
        change.localFileId = localFileId;
        pendingChanged = true;
      }

      if (change.payload.localFileId !== localFileId) {
        change.payload.localFileId = localFileId;
        pendingChanged = true;
      }
    }

    const rawDeviceId =
      change.deviceId ||
      change.payload.deviceId ||
      "";

    if (!String(rawDeviceId).trim()) {
      return;
    }

    const deviceId = format11(rawDeviceId);
    const lista = dati.allegati[deviceId] || [];

    let allegatoLocale = lista.find(function (item) {
      return item && item.syncId === syncId;
    });

    if (!allegatoLocale) {
      allegatoLocale = lista.find(function (item) {
        return (
          item &&
          !item.syncId &&
          item.nomeFile === change.payload.nomeFile &&
          item.dataCaricamento === change.payload.dataCaricamento
        );
      });
    }

    if (!allegatoLocale) {
      return;
    }

    if (!allegatoLocale.syncId) {
      allegatoLocale.syncId = syncId;
      localDataChanged = true;
    }

    if (localFileId && !allegatoLocale.localFileId) {
      allegatoLocale.localFileId = localFileId;
      localDataChanged = true;
    }

    /*
     * Recupero delle vecchie code: prima assicuriamo che
     * l'eventuale Base64 legacy sia nella modifica pendente,
     * poi lo rimuoviamo dalla seconda copia nei dati locali.
     */
    if (
      allegatoLocale.data &&
      !change.payload.data
    ) {
      change.payload.data = allegatoLocale.data;
      change.legacyRecovery = true;
      change.payload.legacyRecovery = true;
      pendingChanged = true;
    }

    if (allegatoLocale.data) {
      delete allegatoLocale.data;
      localDataChanged = true;
    }
  });

  if (pendingChanged) {
    localStorage.setItem(
      STORAGE_KEYS.PENDING_CHANGES,
      JSON.stringify(pending)
    );
  }

  if (localDataChanged) {
    saveLocalData();
  } else {
    updateStatusBox();
  }

  return pending;
}

function removePendingAttachmentBySyncId(syncId) {
  if (!syncId) return;

  const pending = getPendingChanges();

  const remaining = pending.filter(function (change) {
    return !(
      change &&
      change.type === "ADD_ALLEGATO" &&
      getAttachmentChangeSyncId(change) === syncId
    );
  });

  localStorage.setItem(
    STORAGE_KEYS.PENDING_CHANGES,
    JSON.stringify(remaining)
  );

  updateStatusBox();
}

function isAllegatoSincronizzato(allegato) {
  return !!String(allegato && allegato.linkFile || "").trim();
}

async function openCvlsExternalUrl(url) {
  const cleanUrl = String(url || "").trim();

  if (!cleanUrl) {
    showCvlsToast("Link allegato non disponibile");
    return;
  }

  if (
    window.Capacitor &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.Browser &&
    typeof window.Capacitor.Plugins.Browser.open === "function"
  ) {
    await window.Capacitor.Plugins.Browser.open({
      url: cleanUrl,
      presentationStyle: "fullscreen"
    });
    return;
  }

  window.location.href = cleanUrl;
}

async function openCvlsLocalAttachment(allegato) {
  cvlsAlert(
    "Questo allegato è ancora salvato solo sul dispositivo.\n\n" +
    "Per aprirlo correttamente, premi Sincronizza e poi riaprilo dalla lista allegati.",
    "Allegato non ancora sincronizzato"
  );
}

async function openCvlsAttachment(allegato) {
  const linkFile = String(
    allegato && allegato.linkFile || ""
  ).trim();

  if (linkFile) {
    try {
      await openCvlsExternalUrl(linkFile);
    } catch (error) {
      cvlsAlert(
        "Impossibile aprire il link dell'allegato.",
        "Errore allegato"
      );
    }

    return;
  }

  const inlineData = String(
    allegato && allegato.data ||
    getPendingAttachmentData(allegato && allegato.syncId) ||
    ""
  ).trim();

  if (inlineData) {
    const opened = window.open(
      inlineData,
      "_blank",
      "noopener,noreferrer"
    );

    if (!opened) {
      showCvlsToast("Impossibile aprire l'allegato");
    }

    return;
  }

  try {
    await openCvlsLocalAttachment(allegato);
  } catch (error) {
    cvlsAlert(
      error && error.message
        ? error.message
        : "Impossibile aprire l'allegato locale.",
      "Errore allegato"
    );
  }
}

function cvlsIsPendingAddAllegato(change, deviceId, allegato) {
  if (!change || change.type !== "ADD_ALLEGATO") {
    return false;
  }

  const payload = change.payload || {};

  const changeDeviceId = format11(
    change.deviceId ||
    payload.deviceId ||
    payload.codiceCompleto ||
    payload.CodiceCompleto ||
    ""
  );

  if (changeDeviceId && changeDeviceId !== format11(deviceId || "")) {
    return false;
  }

  const syncId = String(allegato && allegato.syncId || "").trim();

  if (syncId) {
    return getAttachmentChangeSyncId(change) === syncId;
  }

  const localFileId = String(allegato && allegato.localFileId || "").trim();

  if (localFileId) {
    return String(
      change.localFileId ||
      payload.localFileId ||
      ""
    ).trim() === localFileId;
  }

  return cvlsAttachmentDeleteRecordKey(deviceId, payload) ===
    cvlsAttachmentDeleteRecordKey(deviceId, allegato);
}

function cvlsGetPendingAddAllegato(deviceId, allegato) {
  const pending = getPendingChanges();

  const index = pending.findIndex(function (change) {
    return cvlsIsPendingAddAllegato(
      change,
      deviceId,
      allegato
    );
  });

  return {
    pending: pending,
    change: index >= 0 ? pending[index] : null,
    index: index
  };
}

function createAttachmentDeleteRequestId() {
  return (
    "DEL-ALG-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase()
  );
}

function getAttachmentDeleteRequests() {
  if (!Array.isArray(dati.richiesteEliminazioneAllegati)) {
    dati.richiesteEliminazioneAllegati = [];
  }

  return dati.richiesteEliminazioneAllegati;
}

function cvlsAttachmentDeleteRecordKey(deviceId, allegato) {
  const a = allegato || {};

  return [
    format11(deviceId || ""),
    String(a.linkFile || "").trim()
  ].join("|");
}

function cvlsAttachmentDeleteDescription(allegato) {
  const a = allegato || {};

  return String(
    a.nomeFile ||
    a.nomeOriginale ||
    a.linkFile ||
    "Allegato"
  ).trim();
}

function getDeleteRequestForAllegato(deviceId, allegato) {
  const recordKey = cvlsAttachmentDeleteRecordKey(
    deviceId,
    allegato
  );

  return getAttachmentDeleteRequests().find(function (request) {
    const stato = normalizeDeleteRequestState(
      request && request.Stato
    );

    return (
      String(request.RecordKey || "") === recordKey &&
      stato !== "eseguita" &&
      stato !== "eseguito"
    );
  }) || null;
}

function upsertLocalAttachmentDeleteRequest(request) {
  const lista = getAttachmentDeleteRequests();

  const index = lista.findIndex(function (item) {
    return String(item.IDRichiesta || "") ===
      String(request.IDRichiesta || "");
  });

  if (index >= 0) {
    lista[index] = {
      ...lista[index],
      ...request
    };
  } else {
    lista.push(request);
  }
}

function savePendingAttachmentDeleteRequestChange(request) {
  savePendingChange({
    type: "RICHIESTA_ELIMINAZIONE_ALLEGATO",
    deviceId: currentDeviceId,
    payload: request
  });
}

function hasPendingDeleteRequestForAllegato(deviceId, allegato) {
  const linkFile = String(
    allegato && allegato.linkFile || ""
  ).trim();

  if (!linkFile) {
    return false;
  }

  const cleanDeviceId = format11(deviceId);
  const pending = getPendingChanges();

  return pending.some(function (change) {
    if (!change || change.type !== "RICHIESTA_ELIMINAZIONE_ALLEGATO") {
      return false;
    }

    const changeDeviceId = format11(change.deviceId || "");
    const payload = change.payload || {};

    const changeLinkFile = String(
      payload.linkFile ||
      payload.link ||
      ""
    ).trim();

    return (
      changeDeviceId === cleanDeviceId &&
      changeLinkFile === linkFile
    );
  });
}

function pulisciRichiesteEliminazioneAllegatoSenzaLink() {
  const pending = getPendingChanges();

  const puliti = pending.filter(function (change) {
    if (!change || change.type !== "RICHIESTA_ELIMINAZIONE_ALLEGATO") {
      return true;
    }

    const payload = change.payload || {};
    const linkFile = String(
      payload.linkFile ||
      payload.link ||
      ""
    ).trim();

    return !!linkFile;
  });

  if (puliti.length !== pending.length) {
    localStorage.setItem(
      STORAGE_KEYS.PENDING_CHANGES,
      JSON.stringify(puliti)
    );

    showCvlsToast(
      "Pulita richiesta allegato non valida. Ripeti la richiesta."
    );
  }
}

function richiediEliminazioneAllegato(index) {
  const allegati = dati.allegati[currentDeviceId] || [];
  const allegato = allegati[index];

  if (!allegato) {
    showCvlsToast("Allegato non disponibile");
    return;
  }

  const linkFile = String(allegato.linkFile || "").trim();

  if (!linkFile) {
    eliminaAllegatoNonSincronizzato(index);
    return;
  }

  const nomeFile = String(
    allegato.nomeFile ||
    allegato.nomeOriginale ||
    "Allegato"
  ).trim();

  cvlsConfirm(
    "Vuoi richiedere l'eliminazione di questo allegato?",
    function () {
      const now = new Date().toISOString();

      savePendingAttachmentDeleteRequestChange({
        linkFile: linkFile,
        nomeFile: nomeFile,
        nomeOriginale: String(allegato.nomeOriginale || nomeFile),
        note: String(allegato.note || ""),
        dataCaricamento: String(allegato.dataCaricamento || ""),
        dataRichiesta: now
      });

      allegato.deletePending = true;
      allegato.deleteStatus = "in_attesa";

      saveLocalData();
      renderAllegati();
      updateStatusBox();

      cvlsAlert(
        "Richiesta di cancellazione in attesa di conferma.",
        "Eliminazione allegato"
      );
    }
  );
}

function modificaAllegato(originalIndex) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.allegati[currentDeviceId] || [];
  const allegato = lista[originalIndex];

  if (!allegato) {
    cvlsAlert("Allegato non trovato.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddAllegato(
    currentDeviceId,
    allegato
  );

  if (!pendingInfo.change) {
    cvlsAvvisaDatoGiaSincronizzato();
    return;
  }

  cvlsPrompt(
    "Modifica nota allegato.",
    function (value) {
      const nuovaNota = String(value || "").trim();

      allegato.note = nuovaNota;

      if (pendingInfo.change.payload) {
        pendingInfo.change.payload.note = nuovaNota;
      }

      pendingInfo.change.updatedAt = new Date().toISOString();

      localStorage.setItem(
        STORAGE_KEYS.PENDING_CHANGES,
        JSON.stringify(pendingInfo.pending)
      );

      saveLocalData();
      updateStatusBox();
      renderAllegati();

      showCvlsToast("Allegato aggiornato");
    },
    {
      title: "Modifica allegato",
      value: allegato.note || "",
      placeholder: "Nota allegato"
    }
  );
}

function eliminaAllegatoNonSincronizzato(index) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.allegati[currentDeviceId] || [];
  const allegato = lista[index];

  if (!allegato) {
    cvlsAlert("Allegato non trovato.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddAllegato(
    currentDeviceId,
    allegato
  );

  if (!pendingInfo.change) {
    deleteAllegato(index);
    return;
  }

  cvlsConfirm(
    "Vuoi eliminare questo allegato non ancora sincronizzato?",
    function () {
      const syncId = String(allegato.syncId || "").trim();
      const localFileId = String(allegato.localFileId || "").trim();

      lista.splice(index, 1);

      if (syncId) {
        removePendingAttachmentBySyncId(syncId);
      } else if (pendingInfo.index >= 0) {
        pendingInfo.pending.splice(pendingInfo.index, 1);

        localStorage.setItem(
          STORAGE_KEYS.PENDING_CHANGES,
          JSON.stringify(pendingInfo.pending)
        );
      }

      if (
        localFileId &&
        window.AndroidBridge &&
        typeof window.AndroidBridge.deleteLocalAttachment === "function"
      ) {
        window.AndroidBridge.deleteLocalAttachment(localFileId);
      } else if (
        localFileId &&
        window.CvlsLocalAttachments &&
        typeof window.CvlsLocalAttachments.deleteAttachment === "function"
      ) {
        window.CvlsLocalAttachments.deleteAttachment(localFileId).catch(function (error) {
          console.warn("Impossibile eliminare allegato locale:", error);
        });
      }

      saveLocalData();
      updateStatusBox();
      renderAllegati();

      showCvlsToast("Allegato eliminato");
    },
    null,
    "Elimina allegato"
  );
}

function renderAllegati() {
  const body =
    document.getElementById("allegatiBody");

  const table =
    document.getElementById("allegatiTable");

  const listaOriginale =
    dati.allegati[currentDeviceId] || [];

  body.innerHTML = "";

  if (table) {
    table.classList.remove("delete-mode");
  }

  const azioniHead =
    document.getElementById("allegatiAzioniHead");

  if (azioniHead) {
    azioniHead.classList.add("hidden");
  }

  if (listaOriginale.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 2;
    td.textContent = "Nessun allegato inserito.";

    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const listaOrdinata = listaOriginale
    .map((allegato, originalIndex) => ({
      allegato,
      originalIndex
    }))
    .sort((a, b) => b.originalIndex - a.originalIndex);

  listaOrdinata.forEach(function (elemento) {
    const allegato = elemento.allegato;
    const originalIndex = elemento.originalIndex;

    const richiestaEliminazione = getDeleteRequestForAllegato(
      currentDeviceId,
      allegato
    );

    const eliminazioneInAttesa =
      isDeleteRequestBlocking(richiestaEliminazione) ||
      hasPendingDeleteRequestForAllegato(currentDeviceId, allegato);

    const tr = document.createElement("tr");

    if (eliminazioneInAttesa) {
      tr.classList.add("cvls-delete-request-pending");
      tr.title = "Richiesta di cancellazione in attesa di conferma";
    }

    const tdFile = document.createElement("td");
    const link = document.createElement("a");

    const href =
      allegato.linkFile ||
      allegato.data ||
      getPendingAttachmentData(allegato.syncId);

    link.textContent =
      allegato.nomeFile ||
      "Apri allegato";

    if (eliminazioneInAttesa) {
      link.href = "#";

      link.onclick = function (event) {
        event.preventDefault();

        showCvlsToast(
          "Richiesta cancellazione in attesa di conferma"
        );

        return false;
      };

    } else if (href || allegato.localFileId) {
      link.href = "#";

      link.onclick = function (event) {
        event.preventDefault();

        openCvlsAttachment(allegato);

        return false;
      };

    } else {
      link.href = "#";

      link.onclick = function (event) {
        event.preventDefault();

        showCvlsToast(
          "Allegato in attesa di sincronizzazione"
        );

        return false;
      };
    }

    tdFile.appendChild(link);
    tr.appendChild(tdFile);

    addCell(tr, allegato.note || "");

    if (!eliminazioneInAttesa) {
      abilitaMenuPressioneLunga(tr, {
        title: allegato.nomeFile || "Allegato",
        modifica: function () {
          modificaAllegato(originalIndex);
        },
        elimina: function () {
          const allegatoNonSincronizzato =
            !!cvlsGetPendingAddAllegato(
              currentDeviceId,
              allegato
            ).change;

          if (allegatoNonSincronizzato) {
            eliminaAllegatoNonSincronizzato(originalIndex);
            return;
          }

          richiediEliminazioneAllegato(originalIndex);
        },
        puoModificare: true,
        puoEliminare: true
      });
    }

    body.appendChild(tr);
  });
}


function deleteImportedNativeFiles(files) {
  if (
    !window.AndroidBridge ||
    typeof window.AndroidBridge.deleteLocalAttachment !== "function"
  ) {
    return;
  }

  (Array.isArray(files) ? files : []).forEach(function (file) {
    const localFileId = String(file && file.localFileId || "").trim();

    if (localFileId) {
      window.AndroidBridge.deleteLocalAttachment(localFileId);
    }
  });
}

function beginNativeAttachmentSelection(mode) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!currentDeviceId) {
    cvlsAlert(
      "Apri prima una scheda dispositivo.",
      "Allegati"
    );
    return;
  }

  cvlsAttachmentSelectionContext = {
    deviceId: currentDeviceId,
    note: getValue("allegatoNota").trim(),
    mode: mode,
    requestedAt: new Date().toISOString()
  };

  const methodName =
    mode === "camera"
      ? "captureAttachmentPhoto"
      : "selectAttachments";

  if (
    window.AndroidBridge &&
    typeof window.AndroidBridge[methodName] === "function"
  ) {
    try {
      window.AndroidBridge[methodName]();
      return;
    } catch (error) {
      cvlsAttachmentSelectionContext = null;

      cvlsAlert(
        "Impossibile aprire il selettore Android.",
        "Errore allegati"
      );
      return;
    }
  }

  if (
    window.CvlsLocalAttachments &&
    typeof window.CvlsLocalAttachments.selectAttachments === "function"
  ) {
    window.CvlsLocalAttachments
      .selectAttachments({
        mode: mode
      })
      .then(function (result) {
        window.onAndroidAttachmentsSelected(JSON.stringify(result));
      })
      .catch(function (error) {
        cvlsAttachmentSelectionContext = null;

        cvlsAlert(
          error && error.message
            ? error.message
            : "Impossibile preparare gli allegati.",
          "Errore allegati"
        );
      });

    return;
  }

  cvlsAttachmentSelectionContext = null;

  cvlsAlert(
    "Selettore allegati non disponibile.",
    "Allegati"
  );
}

function addAllegato() {
  beginNativeAttachmentSelection("files");
}

function captureAllegatoPhoto() {
  beginNativeAttachmentSelection("camera");
}

function toggleDeleteAllegatiMode() {
  deleteModeAllegati = !deleteModeAllegati;
  renderAllegati();
}

function deleteAllegato(index) {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  const lista = dati.allegati[currentDeviceId] || [];
  const allegato = lista[index];

  if (!allegato) {
    cvlsAlert("Allegato non trovato.", "Errore");
    return;
  }

  const pendingInfo = cvlsGetPendingAddAllegato(
    currentDeviceId,
    allegato
  );

  if (pendingInfo.change) {
    eliminaAllegatoNonSincronizzato(index);
    return;
  }

  if (!isAllegatoSincronizzato(allegato)) {
    eliminaAllegatoNonSincronizzato(index);
    return;
  }

  const deviceKey = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_KEY) || ""
  ).trim();

  const identificativo = String(
    localStorage.getItem(STORAGE_KEYS.DEVICE_IDENTIFIER) || ""
  ).trim();

  const recordKey = cvlsAttachmentDeleteRecordKey(
    currentDeviceId,
    allegato
  );

  if (!String(allegato.linkFile || "").trim()) {
    cvlsAlert(
      "Link allegato non disponibile. Impossibile creare la richiesta di cancellazione.",
      "Richiesta non disponibile"
    );
    return;
  }

  const richiestaEsistente = getDeleteRequestForAllegato(
    currentDeviceId,
    allegato
  );

  if (isDeleteRequestBlocking(richiestaEsistente)) {
    cvlsAlert(
      "La richiesta di cancellazione è già in attesa di conferma.",
      "Richiesta già presente"
    );
    return;
  }

  if (!deviceKey) {
    cvlsAlert(
      "DeviceKey non disponibile. Sincronizza nuovamente l’autorizzazione del dispositivo.",
      "Richiesta non disponibile"
    );
    return;
  }

  cvlsConfirm(
    "Vuoi richiedere la cancellazione di questo allegato?",
    function () {
      const now = cvlsFormatDateTimeDb(new Date());

      const request = {
        IDRichiesta: createAttachmentDeleteRequestId(),
        CodiceCompleto: format11(currentDeviceId),
        TipoRecord: "allegato",
        RecordKey: recordKey,
        DescrizioneRecord: cvlsAttachmentDeleteDescription(allegato),
        DeviceKeyRichiedente: deviceKey,
        IdentificativoDispositivo: identificativo,
        Stato: "in_attesa",
        DataRichiesta: now,
        DataAutorizzazione: "",
        DataRifiuto: "",
        DataEsecuzione: "",
        Note: ""
      };

      upsertLocalAttachmentDeleteRequest(request);
      saveLocalData();
      savePendingAttachmentDeleteRequestChange(request);
      renderAllegati();

      cvlsAlert(
        "Richiesta di cancellazione in attesa di conferma",
        "Richiesta registrata"
      );
    },
    null,
    "Elimina allegato"
  );
}
/* =========================
   ETICHETTA SENSORE O2
========================= */

function renderCvls() {
  const d = dati.cvls[currentDeviceId] || {};

  setValue("cvlsFirma", d.Firma || "");
  setCvlsHeaderActionsVisible(true, false);
  setCvlsEditMode(false);
}

function setCvlsHeaderActionsVisible(visible, editing) {
  const editBtn = document.getElementById("loginCvlsBtn");
  const saveBtn = document.getElementById("saveCvlsBtn");

  if (editBtn) {
    editBtn.classList.toggle("hidden", !visible || editing);
    editBtn.disabled = false;
    editBtn.textContent = "Modifica";
  }

  if (saveBtn) {
    saveBtn.classList.toggle("hidden", !visible || !editing);
    saveBtn.disabled = false;
    saveBtn.textContent = "Salva";
  }
}

function renderCvlsReadOnly(d) {
  pulisciCampiCvlsEditabili();
  setText("cvlsViewModello", d.Modello || "");
  setText("cvlsViewMat", d.Mat || "");
  setText("cvlsViewTipologiaCella", d["Tipologia cella"] || "");
  setText("cvlsViewCodiceCella", d["Codice cella"] || "");

  setText(
    "cvlsViewCalibrazione",
    (d.Calibrazione === "SI" ? "☑" : "☐") + " Calibrazione"
  );

  setText(
    "cvlsViewSostituzione",
    (d.Sostituzione === "SI" ? "☑" : "☐") + " Sostituzione"
  );

  setText("cvlsViewScadenza", d["Data scadenza cella"] || "");
  setText("cvlsViewControllo", d["Prossimo controllo"] || "");
  setText("cvlsViewData", d.Data || "");
  setText("cvlsViewTecnico", d.Tecnico || "");

  const firmaBox = document.getElementById("cvlsFirmaBox");

  if (firmaBox) {
    firmaBox.classList.remove("editing");
    firmaBox.innerHTML = "";

    if (d.Firma) {
      const img = document.createElement("img");
      img.src = d.Firma;
      firmaBox.appendChild(img);
    }
  }
}

function preparaCampoCvlsEditabile(el) {
  if (!el) return el;

  el.disabled = false;
  el.readOnly = false;
  el.tabIndex = 0;
  el.style.pointerEvents = "auto";

  el.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  el.addEventListener("mousedown", function (event) {
    event.stopPropagation();
  });

  el.addEventListener("touchstart", function (event) {
    event.stopPropagation();
  }, { passive: true });

  el.addEventListener("touchend", function (event) {
    event.stopPropagation();

    window.setTimeout(function () {
      el.focus();
    }, 0);
  }, { passive: true });

  return el;
}

function creaCvlsInlineInput(id, value, type, placeholder) {
  const input = document.createElement("input");

  input.id = id;
  input.className = "cvls-inline-input";
  input.type = type || "text";
  input.value = value || "";

  if (placeholder) {
    input.placeholder = placeholder;
  }

  return preparaCampoCvlsEditabile(input);
}

function cvlsPad2(value) {
  return String(value || "").padStart(2, "0");
}

function cvlsDateToMonthValue(dateValue) {
  if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return "";
  }

  const parts = dateValue.split("-");
  const anno = parts[0];
  const mese = parts[1];

  return mese + "/" + anno;
}

function cvlsDateToCalendarFirstDay(dateValue) {
  if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return "";
  }

  const parts = dateValue.split("-");
  const anno = parts[0];
  const mese = parts[1];

  return anno + "-" + mese + "-01";
}

function cvlsMonthValueToDate(value) {
  const clean = String(value || "").trim();

  if (!clean) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }

  const match = clean.match(/^(\d{1,2})\/(\d{4})$/);

  if (!match) {
    return "";
  }

  const meseNumero = Number(match[1]);
  const anno = match[2];

  if (meseNumero < 1 || meseNumero > 12) {
    return "";
  }

  return anno + "-" + cvlsPad2(meseNumero) + "-01";
}

function creaCvlsInlineMonthDatePicker(monthInputId, monthValue, calendarInputId, calendarValue) {
  const wrapper = document.createElement("div");
  wrapper.className = "cvls-month-date-picker";
  wrapper.style.position = "relative";

  const hiddenMonth = document.createElement("input");
  hiddenMonth.id = monthInputId;
  hiddenMonth.type = "hidden";
  hiddenMonth.value = monthValue || "";

  const hiddenCalendar = document.createElement("input");
  hiddenCalendar.id = calendarInputId;
  hiddenCalendar.type = "hidden";
  hiddenCalendar.value = calendarValue || "";

  const displayInput = document.createElement("input");
  displayInput.type = "text";
  displayInput.className = "cvls-month-date-display";
  displayInput.readOnly = true;
  displayInput.value = monthValue || "";
  displayInput.placeholder = "Data";

  const nativeDate = document.createElement("input");
  nativeDate.type = "date";
  nativeDate.className = "cvls-month-date-native";

  // IMPORTANTE:
  // il calendario nativo resta attivo, ma il suo box non si vede più
  nativeDate.tabIndex = -1;
  nativeDate.setAttribute("aria-hidden", "true");
  nativeDate.style.position = "absolute";
  nativeDate.style.left = "0";
  nativeDate.style.top = "0";
  nativeDate.style.width = "1px";
  nativeDate.style.height = "1px";
  nativeDate.style.opacity = "0";
  nativeDate.style.pointerEvents = "none";
  nativeDate.style.border = "0";
  nativeDate.style.padding = "0";
  nativeDate.style.margin = "0";

  const initialDate =
    cvlsMonthValueToDate(calendarValue) ||
    cvlsMonthValueToDate(monthValue);

  if (initialDate) {
    nativeDate.value = initialDate;
    hiddenMonth.value = cvlsDateToMonthValue(initialDate);
    hiddenCalendar.value = cvlsDateToCalendarFirstDay(initialDate);
    displayInput.value = hiddenMonth.value;
  }

  function aggiornaDaCalendario() {
    const selectedDate = nativeDate.value;

    if (!selectedDate) return;

    hiddenMonth.value = cvlsDateToMonthValue(selectedDate);
    hiddenCalendar.value = cvlsDateToCalendarFirstDay(selectedDate);
    displayInput.value = hiddenMonth.value;
  }

  function apriCalendario(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (nativeDate.showPicker) {
      nativeDate.showPicker();
    } else {
      nativeDate.focus();
      nativeDate.click();
    }
  }

  nativeDate.addEventListener("change", aggiornaDaCalendario);

  displayInput.addEventListener("click", apriCalendario);

  wrapper.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  wrapper.addEventListener("touchstart", function (event) {
    event.stopPropagation();
  }, { passive: true });

  wrapper.appendChild(hiddenMonth);
  wrapper.appendChild(hiddenCalendar);
  wrapper.appendChild(displayInput);
  wrapper.appendChild(nativeDate);

  return wrapper;
}

function creaCvlsInlineSelect(id, value) {
  const select = document.createElement("select");

  select.id = id;
  select.className = "cvls-inline-select";

  ["NO", "SI"].forEach(function (valore) {
    const option = document.createElement("option");
    option.value = valore;
    option.textContent = valore;
    option.selected = valore === (value || "NO");
    select.appendChild(option);
  });

  return preparaCampoCvlsEditabile(select);
}

function creaCvlsInlineCheckToggle(id, value, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cvls-inline-check-toggle";

  const hidden = document.createElement("input");
  hidden.id = id;
  hidden.type = "hidden";
  hidden.value = value === "SI" ? "SI" : "NO";

  const box = document.createElement("span");
  box.className = "cvls-inline-check-box";

  const text = document.createElement("span");
  text.className = "cvls-inline-check-label";
  text.textContent = label;

  function aggiornaVista() {
    const attivo = hidden.value === "SI";

    button.classList.toggle("checked", attivo);
    box.textContent = attivo ? "✓" : "";
  }

  button.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();

    if (!isEditingCvls) {
      return;
    }

    hidden.value = hidden.value === "SI" ? "NO" : "SI";
    aggiornaVista();
  });

  button.appendChild(hidden);
  button.appendChild(box);
  button.appendChild(text);

  aggiornaVista();

  return button;
}

function inserisciCampoCvls(containerId, campo) {
  const container = document.getElementById(containerId);

  if (!container) {
    return;
  }

  container.classList.add("cvls-edit-value");
  container.innerHTML = "";
  container.appendChild(campo);
}

function pulisciCampiCvlsEditabili() {
  document.querySelectorAll("#cvlsBox .value.cvls-edit-value").forEach(function (el) {
    el.classList.remove("cvls-edit-value");
  });
}

function normalizzaTipologiaCella(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function getTipologieCella() {
  const saved = localStorage.getItem(CVLS_TIPOLOGIE_CELLA_STORAGE_KEY);

  if (!saved) {
    const iniziali = ["KE25", "7Ox-V"];
    localStorage.setItem(
      CVLS_TIPOLOGIE_CELLA_STORAGE_KEY,
      JSON.stringify(iniziali)
    );
    return iniziali;
  }

  try {
    const lista = JSON.parse(saved);

    if (!Array.isArray(lista)) {
      return [];
    }

    return lista
      .map(normalizzaTipologiaCella)
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function saveTipologieCella(lista) {
  const pulita = [];

  lista.forEach(function (item) {
    const valore = normalizzaTipologiaCella(item);

    if (
      valore &&
      !pulita.some(function (existing) {
        return existing.toLowerCase() === valore.toLowerCase();
      })
    ) {
      pulita.push(valore);
    }
  });

  localStorage.setItem(
    CVLS_TIPOLOGIE_CELLA_STORAGE_KEY,
    JSON.stringify(pulita)
  );

  return pulita;
}

function aggiungiTipologiaCella(value) {
  const valore = normalizzaTipologiaCella(value);

  if (!valore) {
    return getTipologieCella();
  }

  const lista = getTipologieCella();

  const esiste = lista.some(function (item) {
    return item.toLowerCase() === valore.toLowerCase();
  });

  if (!esiste) {
    lista.push(valore);
  }

  return saveTipologieCella(lista);
}

function eliminaTipologiaCella(value, onDone) {
  const valore = normalizzaTipologiaCella(value);

  if (!valore) {
    return;
  }

  cvlsConfirm(
    "Vuoi eliminare la tipologia cella \"" + valore + "\"?",
    function () {
      const lista = getTipologieCella().filter(function (item) {
        return item.toLowerCase() !== valore.toLowerCase();
      });

      saveTipologieCella(lista);

      if (typeof onDone === "function") {
        onDone();
      }
    },
    null,
    "Elimina tipologia"
  );
}

function creaCvlsTipologiaCellaPicker(value) {
  const valoreIniziale = normalizzaTipologiaCella(value);

  if (valoreIniziale) {
    aggiungiTipologiaCella(valoreIniziale);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "cvls-tipologia-picker";

  const hidden = document.createElement("input");
  hidden.id = "cvlsInlineTipologiaCella";
  hidden.type = "hidden";
  hidden.value = valoreIniziale;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cvls-tipologia-button";

  const panel = document.createElement("div");
  panel.className = "cvls-tipologia-panel hidden";

  function aggiornaBottone() {
    button.textContent = hidden.value || "Seleziona tipologia";
  }

  function chiudiPanel() {
    panel.classList.add("hidden");
  }

  function apriPanel() {
    panel.classList.remove("hidden");
  }

  function renderLista() {
    panel.innerHTML = "";

    const lista = getTipologieCella();

    lista.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "cvls-tipologia-row";

      const scelta = document.createElement("button");
      scelta.type = "button";
      scelta.className = "cvls-tipologia-choice";
      scelta.textContent = item;

      scelta.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();

        hidden.value = item;
        aggiornaBottone();
        chiudiPanel();
      };

      const elimina = document.createElement("button");
      elimina.type = "button";
      elimina.className = "cvls-tipologia-delete";
      elimina.textContent = "×";
      elimina.setAttribute("aria-label", "Elimina " + item);

      elimina.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();

        eliminaTipologiaCella(item, function () {
          if (hidden.value.toLowerCase() === item.toLowerCase()) {
            hidden.value = "";
            aggiornaBottone();
          }

          renderLista();
          apriPanel();
        });
      };

      row.appendChild(scelta);
      row.appendChild(elimina);
      panel.appendChild(row);
    });

    const addBox = document.createElement("div");
    addBox.className = "cvls-tipologia-add-box";

    const nuovoInput = document.createElement("input");
    nuovoInput.type = "text";
    nuovoInput.className = "cvls-tipologia-new-input";
    nuovoInput.placeholder = "Nuova cella";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "cvls-tipologia-add-btn";
    addBtn.textContent = "Aggiungi";

    function confermaNuovaTipologia(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      const nuovoValore = normalizzaTipologiaCella(nuovoInput.value);

      if (!nuovoValore) {
        return;
      }

      aggiungiTipologiaCella(nuovoValore);

      hidden.value = nuovoValore;
      aggiornaBottone();
      renderLista();
      apriPanel();
    }

    nuovoInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        confermaNuovaTipologia(event);
      }
    });

    addBtn.onclick = confermaNuovaTipologia;

    addBox.appendChild(nuovoInput);
    addBox.appendChild(addBtn);
    panel.appendChild(addBox);
  }

  button.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();

    renderLista();
    panel.classList.toggle("hidden");
  };

  wrapper.addEventListener("click", function (event) {
    event.stopPropagation();
  });

  wrapper.addEventListener("touchstart", function (event) {
    event.stopPropagation();
  }, { passive: true });

  aggiornaBottone();

  wrapper.appendChild(hidden);
  wrapper.appendChild(button);
  wrapper.appendChild(panel);

  return wrapper;
}

function renderCvlsEditable(d) {
  inserisciCampoCvls(
    "cvlsViewModello",
    creaCvlsInlineInput("cvlsInlineModello", d.Modello || "")
  );

  inserisciCampoCvls(
    "cvlsViewMat",
    creaCvlsInlineInput("cvlsInlineMat", d.Mat || "")
  );

  inserisciCampoCvls(
    "cvlsViewTipologiaCella",
    creaCvlsTipologiaCellaPicker(
      d["Tipologia cella"] || ""
    )
  );

  inserisciCampoCvls(
    "cvlsViewCodiceCella",
    creaCvlsInlineInput(
      "cvlsInlineCodiceCella",
      d["Codice cella"] || ""
    )
  );

  inserisciCampoCvls(
    "cvlsViewCalibrazione",
    creaCvlsInlineCheckToggle(
      "cvlsInlineCalibrazione",
      d.Calibrazione || "NO",
      "Calibrazione"
    )
  );

  inserisciCampoCvls(
    "cvlsViewSostituzione",
    creaCvlsInlineCheckToggle(
      "cvlsInlineSostituzione",
      d.Sostituzione || "NO",
      "Sostituzione"
    )
  );

  inserisciCampoCvls(
    "cvlsViewScadenza",
    creaCvlsInlineMonthDatePicker(
      "cvlsInlineScadenza",
      d["Data scadenza cella"] || "",
      "cvlsInlineScadenzaCalendar",
      d["Data scadenza cella calendar"] || ""
    )
  );

  inserisciCampoCvls(
    "cvlsViewControllo",
    creaCvlsInlineMonthDatePicker(
      "cvlsInlineControllo",
      d["Prossimo controllo"] || "",
      "cvlsInlineControlloCalendar",
      d["Prossimo controllo calendar"] || ""
    )
  );

  inserisciCampoCvls(
    "cvlsViewData",
    creaCvlsInlineInput("cvlsInlineData", d.Data || "", "date")
  );

  inserisciCampoCvls(
    "cvlsViewTecnico",
    creaCvlsInlineInput("cvlsInlineTecnico", d.Tecnico || "")
  );

  renderCvlsFirmaEditable(d);
}

function renderCvlsFirmaEditable(d) {
  const firmaBox = document.getElementById("cvlsFirmaBox");

  if (!firmaBox) {
    return;
  }

  firmaBox.innerHTML = "";

  /*
   * In sola visualizzazione non mostriamo il canvas editabile.
   * Mostriamo solo la firma salvata, se esiste.
   */
  if (!isEditingCvls) {
    firmaBox.classList.remove("editing");
    setValue("cvlsFirma", d && d.Firma ? d.Firma : "");

    if (d && d.Firma) {
      const img = document.createElement("img");
      img.src = d.Firma;
      firmaBox.appendChild(img);
    }

    return;
  }

  firmaBox.classList.add("editing");

  /*
   * Quando si entra in modifica, la firma viene svuotata
   * e deve essere rifatta, come nel comportamento attuale.
   */
  setValue("cvlsFirma", "");

  const canvas = document.createElement("canvas");
  canvas.id = "firmaCanvasInline";
  canvas.width = 300;
  canvas.height = 120;
  canvas.className = "firma-canvas";

  canvas.style.pointerEvents = "auto";
  canvas.style.touchAction = "none";

  firmaBox.appendChild(canvas);

  initCvlsInlineCanvas(canvas);
}
function initCvlsInlineCanvas(canvas) {
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  let drawing = false;

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if (event.touches && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if (event.changedTouches && event.changedTouches.length > 0) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function beginDraw(event) {
    if (!isEditingCvls) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    event.stopPropagation();

    drawing = true;

    const point = getPoint(event);

    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function moveDraw(event) {
    if (!drawing || !isEditingCvls) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    event.stopPropagation();

    const point = getPoint(event);

    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000000";

    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    setValue("cvlsFirma", canvas.toDataURL("image/png"));
  }

  function endDraw(event) {
    if (!drawing) {
      return;
    }

    if (event && event.cancelable) {
      event.preventDefault();
    }

    if (event) {
      event.stopPropagation();
    }

    drawing = false;

    setValue("cvlsFirma", canvas.toDataURL("image/png"));
  }

  canvas.addEventListener("touchstart", beginDraw, { passive: false });
  canvas.addEventListener("touchmove", moveDraw, { passive: false });
  canvas.addEventListener("touchend", endDraw, { passive: false });
  canvas.addEventListener("touchcancel", endDraw, { passive: false });

  canvas.addEventListener("mousedown", beginDraw);
  canvas.addEventListener("mousemove", moveDraw);
  canvas.addEventListener("mouseup", endDraw);
  canvas.addEventListener("mouseleave", endDraw);
}

function setCvlsEditMode(editing) {
  isEditingCvls = !!editing;

  const d = dati.cvls[currentDeviceId] || {};

  setCvlsHeaderActionsVisible(true, isEditingCvls);

  /*
   * I campi O2 devono essere sempre visibili.
   * Quando non siamo in modifica vengono mostrati ma bloccati.
   */
  renderCvlsEditable(d);
  bloccaCampiCvlsO2(!isEditingCvls);

  if (isEditingCvls) {
    window.setTimeout(function () {
      const primoCampo = document.getElementById("cvlsInlineModello");

      if (primoCampo) {
        primoCampo.focus();
      }
    }, 120);
  }
}

function bloccaCampiCvlsO2(bloccato) {
  const box = document.getElementById("cvlsBox");

  if (!box) {
    return;
  }

  box.classList.toggle("cvls-readonly-mode", !!bloccato);

  box
    .querySelectorAll("input, select, textarea, button")
    .forEach(function (el) {
      /*
       * I campi hidden servono per salvataggio e Calendar.
       * Non vanno mai bloccati.
       */
      if (el.type === "hidden") {
        el.disabled = false;
        return;
      }

      /*
       * Non tocchiamo i pulsanti Modifica / Salva,
       * perché sono fuori da cvlsBox, ma lasciamo comunque la protezione.
       */
      if (
        el.id === "loginCvlsBtn" ||
        el.id === "saveCvlsBtn"
      ) {
        return;
      }

      if (bloccato) {
        el.disabled = true;
        el.readOnly = true;
        el.tabIndex = -1;
        el.style.pointerEvents = "none";
      } else {
        el.disabled = false;
        el.readOnly = false;
        el.tabIndex = 0;
        el.style.pointerEvents = "auto";
      }
    });

  /*
   * Il calendario nativo nascosto deve essere disattivato
   * quando non siamo in modifica.
   */
  box
    .querySelectorAll(".cvls-month-date-native")
    .forEach(function (el) {
      el.disabled = !!bloccato;
    });

  /*
   * Se la tendina tipologia era aperta, la richiudiamo.
   */
  if (bloccato) {
    box
      .querySelectorAll(".cvls-tipologia-panel")
      .forEach(function (panel) {
        panel.classList.add("hidden");
      });
  }

  const firmaBox = document.getElementById("cvlsFirmaBox");

  if (firmaBox) {
    firmaBox.classList.toggle("editing", isEditingCvls);

    firmaBox
      .querySelectorAll("canvas")
      .forEach(function (canvas) {
        canvas.style.pointerEvents = isEditingCvls ? "auto" : "none";
      });
  }
}

function loginCvls() {
  if (cvlsSyncInProgress) {
    showCvlsToast("Attendi la fine della sincronizzazione");
    return;
  }

  if (!currentDeviceId) {
    return;
  }

  setCvlsEditMode(true);
}

function cvlsBuildO2CalendarDescription(titoloEvento, formData, device, meseAnno) {
  const ubicazione = [
    device.NomeCitta || "",
    device.NomePresidio || "",
    device.NomeUbicazione || ""
  ].filter(Boolean).join(" / ");

  return [
    titoloEvento,
    "",
    "Dispositivo: " + (device.NomeDispositivo || ""),
    "Codice dispositivo: " + currentDeviceId,
    "Tipologia cella: " + (formData["Tipologia cella"] || "-"),
    "Codice cella: " + (formData["Codice cella"] || "-"),
    "Scadenza: " + (meseAnno || "-"),
    "Ubicazione: " + (ubicazione || "-")
  ].join("\n");
}

function cvlsCreateO2CalendarItem(options) {
  const device = currentDeviceData || {};
  const formData = options.formData || {};
  const tipoEvento = options.tipoEvento || "";
  const dataCalendar = options.dataCalendar || "";
  const meseAnno = options.meseAnno || "";
  const key = options.key || "";

  const titoloEvento =
    tipoEvento + " - " + (device.NomeDispositivo || currentDeviceId);

  const descrizioneEvento = cvlsBuildO2CalendarDescription(
    titoloEvento,
    formData,
    device,
    meseAnno
  );

  return {
    id: "O2-" + key + "-" + currentDeviceId,
    o2CalendarKey: "O2_" + key + "_" + currentDeviceId,

    deviceId: currentDeviceId,
    codiceCompleto: currentDeviceId,

    /*
     * Data evento Calendar:
     * sempre primo giorno del mese selezionato.
     */
    data: dataCalendar,

    /*
     * Compatibilità con la logica Calendar già esistente.
     * In MainActivity poi faremo leggere titoloEvento e descrizioneEvento
     * in modo pulito.
     */
    testo: descrizioneEvento,
    titoloEvento: titoloEvento,
    descrizioneEvento: descrizioneEvento,

    tipo: "dispositivo",
    tipoProgrammazione: "Etichetta Sensore O2",
    tipoScadenza: tipoEvento,

    nomeDispositivo: device.NomeDispositivo || "",
    codicePresidio: device.CodicePresidio ? format2(device.CodicePresidio) : "",
    nomePresidio: device.NomePresidio || "",
    nomeCitta: device.NomeCitta || "",
    nomeUbicazione: device.NomeUbicazione || "",

    tipologiaCella: formData["Tipologia cella"] || "",
    codiceCella: formData["Codice cella"] || "",
    meseAnno: meseAnno,

    createdAt: new Date().toISOString(),
    calendarStatus: "pending"
  };
}

function savePendingProgrammazioneCvlsO2(item) {
  if (!item || !item.data || !item.o2CalendarKey) {
    return;
  }

  if (!Array.isArray(dati.programmazioni)) {
    dati.programmazioni = [];
  }

  const localIndex = dati.programmazioni.findIndex(function (existing) {
    return (
      existing &&
      existing.o2CalendarKey === item.o2CalendarKey &&
      existing.deviceId === item.deviceId &&
      existing.calendarStatus === "pending"
    );
  });

  if (localIndex >= 0) {
    dati.programmazioni[localIndex] = {
      ...dati.programmazioni[localIndex],
      ...item,
      updatedAt: new Date().toISOString()
    };
  } else {
    dati.programmazioni.push(item);
  }

  const pending = getPendingChanges();

  const existingPending = pending.find(function (change) {
    return (
      change &&
      change.type === "PROGRAMMA_MANUTENZIONE" &&
      change.payload &&
      change.payload.o2CalendarKey === item.o2CalendarKey &&
      format11(change.deviceId || "") === format11(item.deviceId)
    );
  });

  if (existingPending) {
    existingPending.deviceId = item.deviceId;
    existingPending.payload = { ...item };
    existingPending.updatedAt = new Date().toISOString();

    if (!existingPending.changeId) {
      existingPending.changeId = createPendingChangeId();
    }

    if (!existingPending.createdAt) {
      existingPending.createdAt = item.createdAt || new Date().toISOString();
    }
  } else {
    pending.push({
      changeId: createPendingChangeId(),
      type: "PROGRAMMA_MANUTENZIONE",
      deviceId: item.deviceId,
      payload: { ...item },
      createdAt: item.createdAt || new Date().toISOString()
    });
  }

  localStorage.setItem(
    STORAGE_KEYS.PENDING_CHANGES,
    JSON.stringify(pending)
  );

  updateStatusBox();
}

function programmaEventiCalendarCvlsO2(formData, previousData) {
  let eventiCreati = 0;

  const configurazioni = [
    {
      key: "SCADENZA_CELLA",
      tipoEvento: "Scadenza cella",
      monthField: "Data scadenza cella",
      calendarField: "Data scadenza cella calendar"
    },
    {
      key: "PROSSIMO_CONTROLLO",
      tipoEvento: "Scadenza controllo",
      monthField: "Prossimo controllo",
      calendarField: "Prossimo controllo calendar"
    }
  ];

  configurazioni.forEach(function (config) {
    const nuovaDataCalendar = String(formData[config.calendarField] || "").trim();
    const vecchiaDataCalendar = String((previousData || {})[config.calendarField] || "").trim();

    /*
     * Crea evento solo se:
     * - la data esiste
     * - la data è nuova o modificata
     *
     * Così evitiamo duplicati se premi Salva senza cambiare data.
     */
    if (!nuovaDataCalendar || nuovaDataCalendar === vecchiaDataCalendar) {
      return;
    }

    const item = cvlsCreateO2CalendarItem({
      key: config.key,
      tipoEvento: config.tipoEvento,
      dataCalendar: nuovaDataCalendar,
      meseAnno: formData[config.monthField] || "",
      formData: formData
    });

    savePendingProgrammazioneCvlsO2(item);
    eventiCreati++;
  });

  return eventiCreati;
}

function leggiFirmaCvlsDaCanvas() {
  const firmaHidden = getValue("cvlsFirma");

  if (firmaHidden && firmaHidden.trim() !== "") {
    return firmaHidden;
  }

  const canvas = document.getElementById("firmaCanvasInline");

  if (!canvas) {
    return "";
  }

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return "";
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) {
      return canvas.toDataURL("image/png");
    }
  }

  return "";
}

function saveCvls() {
  if (!isEditingCvls) {
    return;
  }

  const previousData = {
    ...(dati.cvls[currentDeviceId] || {})
  };

  const firmaCvls =
    leggiFirmaCvlsDaCanvas() ||
    previousData.Firma ||
    "";

  const formData = {
    Modello: getValue("cvlsInlineModello"),
    Mat: getValue("cvlsInlineMat"),
    "Tipologia cella": getValue("cvlsInlineTipologiaCella"),
    "Codice cella": getValue("cvlsInlineCodiceCella"),
    Calibrazione: getValue("cvlsInlineCalibrazione") || "NO",
    Sostituzione: getValue("cvlsInlineSostituzione") || "NO",
    "Data scadenza cella": getValue("cvlsInlineScadenza"),
    "Prossimo controllo": getValue("cvlsInlineControllo"),
    "Data scadenza cella calendar": getValue("cvlsInlineScadenzaCalendar"),
    "Prossimo controllo calendar": getValue("cvlsInlineControlloCalendar"),
    Data: getValue("cvlsInlineData"),
    Tecnico: getValue("cvlsInlineTecnico"),
    Firma: firmaCvls
  };

  dati.cvls[currentDeviceId] = formData;

  const eventiCreati = programmaEventiCalendarCvlsO2(
    formData,
    previousData
  );

  saveLocalData();

  savePendingChange({
    type: "SAVE_CVLS",
    deviceId: currentDeviceId,
    payload: formData
  });

  renderCvls();

  if (eventiCreati > 0) {
    alert(
      "Etichetta salvata.\n\n" +
      eventiCreati +
      (
        eventiCreati === 1
          ? " evento Calendar preparato. Premi Sincronizza per crearlo."
          : " eventi Calendar preparati. Premi Sincronizza per crearli."
      )
    );
    return;
  }

  alert("Etichetta salvata.");
}

/*
 * Rimane solo per compatibilità con vecchi binding.
 * Non viene più usata da pulsanti visibili.
 */
function pulisciFirma() {
  setValue("cvlsFirma", "");
}

/* =========================
   RICERCA
========================= */

function openSearch() {
  document.getElementById("searchModal").classList.remove("hidden");
  setValue("globalSearchInput", "");
  document.getElementById("searchResults").innerHTML = "";
  setTimeout(() => document.getElementById("globalSearchInput").focus(), 100);
}

function closeSearch() {
  document.getElementById("searchModal").classList.add("hidden");
}

function renderSearchResults() {
  const query = getValue("globalSearchInput").toLowerCase().trim();
  const box = document.getElementById("searchResults");

  box.innerHTML = "";

  if (!query) {
    box.innerHTML = `<div class="codice">Scrivi una parola chiave per cercare un dispositivo.</div>`;
    return;
  }

  const results = dati.dispositivi.filter(d => {
    const text = [
      d.NomeDispositivo,
      d.CodiceCompleto,
      d.CodiceDispositivo,
      d.TipoProgramma,
      d.NomeCitta,
      d.NomePresidio,
      d.NomeUbicazione
    ].join(" ").toLowerCase();

    return text.includes(query);
  });

  if (results.length === 0) {
    box.innerHTML = `<div class="codice">Nessun dispositivo trovato.</div>`;
    return;
  }

  results.forEach(d => {
    const el = document.createElement("div");
    el.className = "search-result";

    el.innerHTML = `
      <div class="search-result-title">${escapeHtml(d.NomeDispositivo)}</div>
      <div class="codice">Codice: ${format11(d.CodiceCompleto)}</div>
      <div class="search-result-path">
        ${escapeHtml(d.NomeCitta || "")}
        /
        ${escapeHtml(d.NomePresidio || "")}
        /
        ${escapeHtml(d.NomeUbicazione || "")}
        /
        ${escapeHtml(d.NomeDispositivo || "")}
      </div>
      <div class="codice">Programma: ${escapeHtml(d.TipoProgramma || "")}</div>
      <button>Apri</button>
    `;

    el.querySelector("button").onclick = function () {
      closeSearch();
      openDevice(d.CodiceCompleto);
    };

    box.appendChild(el);
  });
}

/* =========================
   MENU / QR
========================= */

function openSideMenu() {
  updateSideMenuInfo();
  document.getElementById("sideOverlay").classList.remove("hidden");
  document.getElementById("sideMenu").classList.add("open");
}

function closeSideMenu() {
  document.getElementById("sideOverlay").classList.add("hidden");
  document.getElementById("sideMenu").classList.remove("open");
}

function updateSideMenuInfo() {
  setText("sideUserName", localStorage.getItem("cvls_user_name") || "-");
  setText("sideUserEmail", localStorage.getItem("cvls_user_email") || "-");
  setText("sideUserRole", localStorage.getItem("cvls_user_role") || "-");
}

function cvlsRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";

  if (window.crypto && window.crypto.getRandomValues) {
    const values = new Uint32Array(length);
    window.crypto.getRandomValues(values);

    for (let i = 0; i < length; i++) {
      out += chars[values[i] % chars.length];
    }

    return out;
  }

  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return out;
}

function generaIdPubblicoManutenzione() {
  return "mnt_" + cvlsRandomString(10);
}

function generaTokenSicuroQR() {
  return cvlsRandomString(48);
}

function estraiCodiceDispositivo(dispositivo) {
  if (!dispositivo) return "";

  return format11(
    dispositivo.CodiceCompleto ||
    dispositivo.codiceCompleto ||
    dispositivo.Codice ||
    dispositivo.CodiceDispositivo ||
    dispositivo.ID ||
    dispositivo.codice ||
    ""
  );
}

function trovaDispositivoPerCodice(codice) {
  const codicePulito = format11(codice);

  return dati.dispositivi.find(d =>
    format11(d.CodiceCompleto || d.codiceCompleto || d.Codice || d.codice) === codicePulito
  ) || null;
}

function isDispositivoEtichettaO2(dispositivo) {
  const tipoProgramma = String(
    dispositivo &&
    (
      dispositivo.TipoProgramma ||
      dispositivo.tipoProgramma ||
      ""
    )
  ).trim().toLowerCase();

  return tipoProgramma === "etichetta sensore o2";
}

function creaLinkPubblicoManutenzione(dispositivo) {
  const codicePulito = estraiCodiceDispositivo(dispositivo);

  let link =
    WEBAPP_CLIENTE_URL +
    "?device=" +
    encodeURIComponent(codicePulito);

  if (isDispositivoEtichettaO2(dispositivo)) {
    link += "&o2=1";
  }

  return link;
}

function salvaLinkQRNelDispositivo(dispositivo) {
  const codicePulito = estraiCodiceDispositivo(dispositivo);

  if (!codicePulito) {
    console.warn("LinkQR non salvato: codice dispositivo mancante.");
    return false;
  }

  const index = dati.dispositivi.findIndex(d =>
    format11(d.CodiceCompleto || d.codiceCompleto || d.Codice || d.codice) === codicePulito
  );

  if (index >= 0) {
    dati.dispositivi[index] = {
      ...dati.dispositivi[index],
      ...dispositivo
    };
  }

  if (currentDeviceData && format11(currentDeviceData.CodiceCompleto) === codicePulito) {
    currentDeviceData = {
      ...currentDeviceData,
      ...dispositivo
    };
  }

  saveLocalData();
  addPendingUpdateLinkQR(codicePulito, dispositivo.LinkQR);
  renderArchivio();

  return true;
}

function estraiIdPubblicoDaLink(link) {
  if (!link) return "";

  try {
    const url = new URL(link);
    const parti = url.pathname.split("/").filter(Boolean);

    if (parti.length >= 2 && parti[0] === "m") {
      return decodeURIComponent(parti[1]);
    }

    return "";
  } catch (e) {
    return "";
  }
}

function estraiTokenDaLink(link) {
  if (!link) return "";

  try {
    const url = new URL(link);
    return url.searchParams.get("t") || "";
  } catch (e) {
    return "";
  }
}

// URL base per i link QR — Supabase Edge Function
// In produzione (Supabase del cliente): aggiornare con il project ID del cliente
const WEBAPP_CLIENTE_URL = "https://script.google.com/macros/s/AKfycbxBh-UuUwLRz7PzGqqgLjCItlAxGJSFZl7tsPerjnlDVVBJ8krxr_-rVrJ3qlBUw1ICCA/exec";

function generaQR(input) {
  ensureDataShape();

  let dispositivo = null;

  if (typeof input === "object" && input !== null) {
    dispositivo = input;
  } else {
    dispositivo = trovaDispositivoPerCodice(input);
  }

  if (!dispositivo) {
    alert("Dispositivo non trovato per generare il QR.");
    return;
  }

  const codicePulito = estraiCodiceDispositivo(dispositivo);
  const richiestaEliminazione = getDeleteRequestForDevice(codicePulito);

  if (isDeleteRequestBlocking(richiestaEliminazione)) {
    cvlsAlert(
      getDeleteRequestStatusText(richiestaEliminazione),
      "QR non disponibile"
    );
    return;
  }

  const link = creaLinkPubblicoManutenzione(dispositivo);

  dispositivo.LinkQR = link;
  dispositivo.linkQR = link;

  salvaLinkQRNelDispositivo(dispositivo);

  const qrUrl =
    "https://quickchart.io/qr?text=" +
    encodeURIComponent(link) +
    "&size=260";

  window.cvlsQrPrintData = {
    codice: codicePulito,
    link: link,
    qrUrl: qrUrl,
    logoUrl: LOGO_URL
  };

  const oldOverlay = document.getElementById("qrOverlay");
  if (oldOverlay) {
    oldOverlay.remove();
  }

  const html = `
    <div id="qrOverlay" class="modal">
      <div class="modal-card qr-card">
        <h2 class="qr-title">CERTIFICATO DI<br>MANUTENZIONE</h2>

        <img src="${qrUrl}" class="qr-image" alt="QR">

        <img src="${LOGO_URL}" class="qr-logo" alt="Logo">

        <div class="qr-code">${codicePulito}</div>

        <div class="qr-actions">
          <button class="qr-btn qr-btn-back" type="button" onclick="chiudiQR()">Indietro</button>
          <button class="qr-btn qr-btn-print" type="button" onclick="stampaQR()">Stampa</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);
}

function stampaQR() {
  const data = window.cvlsQrPrintData;

  if (!data) {
    alert("QR non pronto per la condivisione.");
    return;
  }

  if (
    window.AndroidBridge &&
    typeof window.AndroidBridge.shareQrImage === "function"
  ) {
    window.AndroidBridge.shareQrImage(data.qrUrl, data.logoUrl);
    return;
  }

  alert("Condivisione non disponibile su questo dispositivo.");
}

function creaHtmlStampaQR(data) {
  return `
<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <title>Certificato di manutenzione</title>

  <style>
    @page {
      size: A4;
      margin: 14mm;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      background: white;
      color: #111827;
      font-family: Arial, sans-serif;
    }

    .print-page {
      width: 100%;
      min-height: 260mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      text-align: center;
      padding-top: 18mm;
    }

    h1 {
      margin: 0 0 18mm;
      font-size: 28pt;
      line-height: 1.15;
      font-weight: 900;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .qr-print {
      width: 95mm;
      height: 95mm;
      object-fit: contain;
      display: block;
      margin: 0 auto 24mm;
    }

    .logo-print {
      width: 82mm;
      height: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
  </style>
</head>

<body>
  <div class="print-page">
    <h1>CERTIFICATO DI<br>MANUTENZIONE</h1>

    <img class="qr-print" src="${data.qrUrl}" alt="QR">

    <img class="logo-print" src="${data.logoUrl}" alt="Cavaletto Sanità">
  </div>
</body>
</html>
`;
}

function chiudiQR() {
  const overlay = document.getElementById("qrOverlay");
  if (overlay) overlay.remove();
}

window.apriSchedaManutenzioneDaLinkPubblico = function (idPubblico, token) {
  ensureDataShape();
  loadLocalData();

  const idPulito = String(idPubblico || "").trim();
  const tokenPulito = String(token || "").trim();

  if (!idPulito) {
    alert("Link QR non valido: ID mancante.");
    return;
  }

  const dispositivo = dati.dispositivi.find(d => {
    const idDaCampo =
      d.IdPubblicoManutenzione ||
      d.idPubblicoManutenzione ||
      "";

    const idDaLink = estraiIdPubblicoDaLink(d.LinkQR || d.linkQR || "");

    return idDaCampo === idPulito || idDaLink === idPulito;
  });

  if (!dispositivo) {
    alert("Scheda manutenzione non trovata nell'app. Sincronizza il database e riprova.\nID: " + idPulito);
    return;
  }

  const stato =
    dispositivo.StatoLinkQR ||
    dispositivo.statoLinkQR ||
    "attivo";

  if (stato !== "attivo") {
    alert("Link QR disattivato o non valido.");
    return;
  }

  const tokenSalvato =
    dispositivo.TokenQR ||
    dispositivo.tokenQR ||
    estraiTokenDaLink(dispositivo.LinkQR || dispositivo.linkQR || "");

  if (tokenSalvato && tokenPulito && tokenSalvato !== tokenPulito) {
    alert("Token QR non valido.");
    return;
  }

  const codice = estraiCodiceDispositivo(dispositivo);

  if (!codice) {
    alert("Codice dispositivo non trovato per questa scheda.");
    return;
  }

  if (localStorage.getItem(STORAGE_KEYS.AUTH_STATUS) !== AUTH_STATUS.AUTHORIZED) {
    localStorage.setItem("cvls_pending_qr_open", codice);
    showAuthScreen();
    alert("Dispositivo non autorizzato. Effettua l'autorizzazione e poi sincronizza.");
    return;
  }

  openDevice(codice);
};

/* =========================
   UTILITY
========================= */

function addCell(tr, text) {
  const td = document.createElement("td");
  td.textContent = text;
  tr.appendChild(td);
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value || "" : "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function format2(v) {
  return String(v || "").padStart(2, "0");
}

function format3(v) {
  return String(v || "").padStart(3, "0");
}

function format4(v) {
  return String(v || "").padStart(4, "0");
}

function format11(v) {
  return String(v || "")
    .replace(/\D/g, "")
    .padStart(11, "0")
    .slice(-11);
}

function normalizeName(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function nextCode(values, length) {
  let max = 0;

  values.forEach(value => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > max) max = n;
  });

  return String(max + 1).padStart(length, "0");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  try {
    const d = new Date(value);
    return d.toLocaleString("it-IT");
  } catch (e) {
    return String(value || "");
  }

  function formatCvlsDateTimeForSheet(date) {
    const d = date instanceof Date ? date : new Date(date);

    if (isNaN(d.getTime())) {
      return "";
    }

    const giorno = String(d.getDate()).padStart(2, "0");
    const mese = String(d.getMonth() + 1).padStart(2, "0");
    const anno = d.getFullYear();

    const ore = String(d.getHours()).padStart(2, "0");
    const minuti = String(d.getMinutes()).padStart(2, "0");

    return giorno + "/" + mese + "/" + anno + " " + ore + ":" + minuti;
  }
}

/* =========================================================
   CVLS - UI SINCRONIZZAZIONE
   Aggiunta sicura: non modifica funzioni archivio/schede/QR
========================================================= */

let cvlsSyncProgressTimer = null;


function ensureSyncBlockingOverlay() {
  let overlay = document.getElementById("syncBlockingOverlay");

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "syncBlockingOverlay";
    overlay.className = "sync-blocking-overlay hidden";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");

    overlay.innerHTML = `
      <div class="sync-blocking-card">
        <div class="sync-blocking-spinner" aria-hidden="true"></div>
        <div class="sync-blocking-title">Sincronizzazione in corso</div>
        <div class="sync-blocking-message">
          Attendi il completamento. Le modifiche e la navigazione sono temporaneamente bloccate.
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  return overlay;
}

function setSyncInteractionBlocked(blocked) {
  const overlay = ensureSyncBlockingOverlay();

  document.documentElement.classList.toggle(
    "cvls-sync-locked",
    !!blocked
  );

  document.body.setAttribute(
    "aria-busy",
    blocked ? "true" : "false"
  );

  overlay.classList.toggle("hidden", !blocked);
  overlay.setAttribute("aria-hidden", blocked ? "false" : "true");

  if (blocked) {
    /*
     * Stili minimi di sicurezza. style.css aggiungerà la
     * presentazione definitiva, ma l'overlay blocca già i tocchi.
     */
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "24px";
    overlay.style.background = "rgba(15, 23, 42, 0.52)";
    overlay.style.pointerEvents = "auto";

    closeSideMenu();
    closeSearch();
  } else {
    overlay.style.display = "none";
  }
}

function startSyncUI() {
  setSyncInteractionBlocked(true);

  const topbar = document.getElementById("topbar");
  const syncBtn = document.getElementById("syncBtn");
  const progressArea = document.getElementById("syncProgressArea");

  if (topbar) topbar.classList.add("syncing");
  if (syncBtn) syncBtn.classList.add("syncing");
  if (progressArea) progressArea.classList.remove("hidden");

  updateSyncProgress(0, "Preparazione...");
}

function updateSyncStatus(message) {
  const overlayMessage = document.querySelector("#syncBlockingOverlay .sync-blocking-message");
  if (overlayMessage && message) {
    overlayMessage.textContent = message;
  }
}

function updateSyncProgress(percent, label) {
  const progressBar =
    document.getElementById("syncProgressBar");

  const progressPercent =
    document.getElementById("syncProgressPercent");

  const progressLabel =
    document.getElementById("syncProgressLabel");

  const safePercent = Math.max(
    0,
    Math.min(100, Number(percent) || 0)
  );

  if (progressBar) {
    progressBar.style.width = safePercent + "%";
  }

  if (progressPercent) {
    progressPercent.textContent = safePercent + "%";
  }

  if (progressLabel && label) {
    progressLabel.textContent = label;
  }

  /*
   * L'overlay copre la topbar durante la sincronizzazione.
   * Mostriamo quindi lo stesso stato anche al centro
   * dell'overlay.
   */
  if (cvlsSyncInProgress && label) {
    updateSyncStatus(label);
  }
}

function finishSyncUI(message) {
  setSyncInteractionBlocked(false);
  updateSyncProgress(100, "Sincronizzazione completata");

  window.setTimeout(function () {
    const topbar = document.getElementById("topbar");
    const syncBtn = document.getElementById("syncBtn");
    const progressArea = document.getElementById("syncProgressArea");

    if (topbar) topbar.classList.remove("syncing");
    if (syncBtn) syncBtn.classList.remove("syncing");
    if (progressArea) progressArea.classList.add("hidden");

    updateSyncProgress(0, "Sincronizzazione...");

    showCvlsToast(message || "Sincronizzazione completata");
  }, 500);
}

function failSyncUI(message) {
  setSyncInteractionBlocked(false);

  const topbar = document.getElementById("topbar");
  const syncBtn = document.getElementById("syncBtn");
  const progressArea = document.getElementById("syncProgressArea");

  if (topbar) topbar.classList.remove("syncing");
  if (syncBtn) syncBtn.classList.remove("syncing");
  if (progressArea) progressArea.classList.add("hidden");

  updateSyncProgress(0, "Sincronizzazione...");

  showCvlsToast(message || "Errore sincronizzazione");
}

function showCvlsToast(message) {
  let toast = document.getElementById("cvlsToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "cvlsToast";
    toast.className = "cvls-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");

  window.setTimeout(function () {
    toast.classList.remove("show");
  }, 1800);
}

function simulateSyncProgressUntilResponse() {
  clearInterval(cvlsSyncProgressTimer);

  let progress = 5;
  // La simulazione di avvio fa solo una breve attesa iniziale, poi la sincronizzazione reale prende il controllo
  cvlsSyncProgressTimer = window.setInterval(function () {
    if (progress < 15) {
      progress += 3;
      updateSyncProgress(progress, "Preparazione dati per Supabase...");
    }
  }, 200);
}

function stopSyncProgressSimulation() {
  clearInterval(cvlsSyncProgressTimer);
  cvlsSyncProgressTimer = null;
}

// Handler per l'avanzamento reale della sincronizzazione
window.cvlsOnSyncProgressUpdate = function (progressData) {
  // Ferma immediatamente la barra di simulazione fasulla
  stopSyncProgressSimulation();

  if (!progressData || typeof progressData !== "object") return;

  const total = Number(progressData.total) || 1;
  const current = Number(progressData.current) || 0;

  // Calcola la percentuale di avanzamento reale (riservando da 15% a 92% per l'upload e il resto per l'download)
  let percent = Math.min(92, Math.round((current / total) * 77) + 15);
  let label = "Invio dati...";

  if (progressData.type === "DOWNLOAD_DB") {
    percent = 95;
    label = "Download dati aggiornati";
  } else if (progressData.isAttachment) {
    const attCurrent = progressData.attachmentsCurrent || 1;
    const attTotal = progressData.attachmentsTotal || 1;
    const name = progressData.nomeFile || "";
    label = "Allegato " + attCurrent + " di " + attTotal + (name ? " (" + name + ")" : "");
  } else {
    const type = String(progressData.type || "");
    if (type.includes("DISPOSITIVO")) {
      label = "Invio dati (" + current + " di " + total + ")";
    } else if (type.includes("MANUTENZIONE")) {
      label = "Invio manutenzioni (" + current + " di " + total + ")";
    } else if (type.includes("NOTA")) {
      label = "Invio note (" + current + " di " + total + ")";
    } else if (type.includes("MATERIALE")) {
      label = "Invio materiali (" + current + " di " + total + ")";
    } else if (type.includes("ALLEGATO")) {
      label = "Invio allegati (" + current + " di " + total + ")";
    } else {
      label = "Invio dati (" + current + " di " + total + ")";
    }
  }

  updateSyncProgress(percent, label);
};

/* =========================================================
   CVLS - POPUP APPLE STYLE
========================================================= */

function showAppleModal(options) {
  closeAppleModal();

  const modal = document.createElement("div");
  modal.id = "appleModalRoot";
  modal.className = "apple-modal-root";

  const title = options && options.title ? options.title : "CVLS";
  const message = options && options.message ? options.message : "";
  const primaryText = options && options.primaryText ? options.primaryText : "OK";
  const secondaryText = options && options.secondaryText ? options.secondaryText : "";
  const onPrimary = options && typeof options.onPrimary === "function" ? options.onPrimary : closeAppleModal;
  const onSecondary = options && typeof options.onSecondary === "function" ? options.onSecondary : closeAppleModal;

  modal.innerHTML = `
    <div class="apple-modal-card">
      <h2 class="apple-modal-title">${escapeHtml(title)}</h2>
      <p class="apple-modal-message">${escapeHtml(message)}</p>
      <div class="apple-modal-actions">
        ${secondaryText ? `<button id="appleModalSecondary" class="apple-btn-secondary">${escapeHtml(secondaryText)}</button>` : ""}
        <button id="appleModalPrimary" class="apple-btn-primary">${escapeHtml(primaryText)}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const primaryBtn = document.getElementById("appleModalPrimary");
  const secondaryBtn = document.getElementById("appleModalSecondary");

  if (primaryBtn) {
    primaryBtn.onclick = function () {
      onPrimary();
    };
  }

  if (secondaryBtn) {
    secondaryBtn.onclick = function () {
      onSecondary();
    };
  }
}

function closeAppleModal() {
  const modal = document.getElementById("appleModalRoot");
  if (modal) {
    modal.remove();
  }
}

/* =========================================================
   BLOCCO ZOOM APP
   impedisce pinch zoom e doppio tap zoom nella WebView
========================================================= */

document.addEventListener(
  "touchmove",
  function (event) {
    if (event.touches && event.touches.length > 1) {
      event.preventDefault();
    }
  },
  { passive: false }
);

let cvlsLastTouchEnd = 0;

document.addEventListener(
  "touchend",
  function (event) {
    const now = Date.now();

    if (now - cvlsLastTouchEnd <= 300) {
      event.preventDefault();
    }

    cvlsLastTouchEnd = now;
  },
  false
);

/* =========================================================
   CVLS UI SYSTEM
   - alert stile Apple
   - confirm stile Apple
   - prompt stile Apple
   - blocco highlight azzurro pulsanti
========================================================= */

function cvlsEnsureDialog() {
  let overlay = document.getElementById("cvlsDialogOverlay");

  if (overlay) {
    return overlay;
  }

  const html = `
    <div id="cvlsDialogOverlay" class="cvls-dialog-overlay">
      <div class="cvls-dialog-card">
        <h3 id="cvlsDialogTitle" class="cvls-dialog-title">CVLS</h3>
        <p id="cvlsDialogMessage" class="cvls-dialog-message"></p>
        <input id="cvlsDialogInput" class="cvls-dialog-input hidden" />
        <div id="cvlsDialogActions" class="cvls-dialog-actions">
          <button id="cvlsDialogCancel" class="cvls-dialog-btn cancel" type="button">Annulla</button>
          <button id="cvlsDialogOk" class="cvls-dialog-btn ok" type="button">OK</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", html);

  return document.getElementById("cvlsDialogOverlay");
}

function cvlsCloseDialog() {
  const overlay = document.getElementById("cvlsDialogOverlay");

  if (overlay) {
    overlay.classList.remove("show");
  }
}

function cvlsAlert(message, title) {
  const overlay = cvlsEnsureDialog();
  const titleEl = document.getElementById("cvlsDialogTitle");
  const messageEl = document.getElementById("cvlsDialogMessage");
  const inputEl = document.getElementById("cvlsDialogInput");
  const actionsEl = document.getElementById("cvlsDialogActions");
  const cancelBtn = document.getElementById("cvlsDialogCancel");
  const okBtn = document.getElementById("cvlsDialogOk");

  titleEl.textContent = title || "CVLS";
  messageEl.textContent = String(message || "");
  inputEl.classList.add("hidden");
  inputEl.value = "";

  actionsEl.classList.add("single");
  cancelBtn.classList.add("hidden");
  okBtn.textContent = "OK";

  okBtn.onclick = function () {
    cvlsCloseDialog();
  };

  overlay.classList.add("show");
}

function cvlsConfirm(message, onOk, onCancel, title) {
  const overlay = cvlsEnsureDialog();
  const titleEl = document.getElementById("cvlsDialogTitle");
  const messageEl = document.getElementById("cvlsDialogMessage");
  const inputEl = document.getElementById("cvlsDialogInput");
  const actionsEl = document.getElementById("cvlsDialogActions");
  const cancelBtn = document.getElementById("cvlsDialogCancel");
  const okBtn = document.getElementById("cvlsDialogOk");

  titleEl.textContent = title || "Conferma";
  messageEl.textContent = String(message || "");
  inputEl.classList.add("hidden");
  inputEl.value = "";

  actionsEl.classList.remove("single");
  cancelBtn.classList.remove("hidden");
  cancelBtn.textContent = "Annulla";
  okBtn.textContent = "Conferma";

  cancelBtn.onclick = function () {
    cvlsCloseDialog();

    if (typeof onCancel === "function") {
      onCancel();
    }
  };

  okBtn.onclick = function () {
    cvlsCloseDialog();

    if (typeof onOk === "function") {
      onOk();
    }
  };

  overlay.classList.add("show");
}

function cvlsPrompt(message, onOk, options) {
  const opts = options || {};
  const overlay = cvlsEnsureDialog();
  const titleEl = document.getElementById("cvlsDialogTitle");
  const messageEl = document.getElementById("cvlsDialogMessage");
  const inputEl = document.getElementById("cvlsDialogInput");
  const actionsEl = document.getElementById("cvlsDialogActions");
  const cancelBtn = document.getElementById("cvlsDialogCancel");
  const okBtn = document.getElementById("cvlsDialogOk");

  titleEl.textContent = opts.title || "CVLS";
  messageEl.textContent = String(message || "");

  inputEl.classList.remove("hidden");
  inputEl.value = opts.value || "";
  inputEl.type = opts.type || "text";
  inputEl.placeholder = opts.placeholder || "";

  actionsEl.classList.remove("single");
  cancelBtn.classList.remove("hidden");
  cancelBtn.textContent = "Annulla";
  okBtn.textContent = "OK";

  cancelBtn.onclick = function () {
    cvlsCloseDialog();
  };

  okBtn.onclick = function () {
    const value = inputEl.value;
    cvlsCloseDialog();

    if (typeof onOk === "function") {
      onOk(value);
    }
  };

  overlay.classList.add("show");

  setTimeout(function () {
    inputEl.focus();
  }, 120);
}

/* Tutti gli alert diventano popup Apple, niente più file:// */
window.alert = function (message) {
  cvlsAlert(message);
};

/* Rimuove highlight blu da tutti i cliccabili e dà feedback uniforme */
function cvlsInstallPressFeedback() {
  const selector = [
    "button",
    "a",
    "[onclick]",
    "[role='button']",
    ".topbar-btn",
    ".primary-btn",
    ".secondary-btn",
    ".small-action-btn",
    ".plus-btn",
    ".round-back-btn",
    ".close-btn",
    ".item",
    ".list-item",
    ".admin-item"
  ].join(",");

  document.addEventListener("touchstart", function (event) {
    const el = event.target.closest(selector);

    if (!el) {
      return;
    }

    el.classList.add("cvls-pressing");
  }, { passive: true });

  document.addEventListener("touchend", function () {
    document.querySelectorAll(".cvls-pressing").forEach(function (el) {
      el.classList.remove("cvls-pressing");
    });
  }, { passive: true });

  document.addEventListener("touchcancel", function () {
    document.querySelectorAll(".cvls-pressing").forEach(function (el) {
      el.classList.remove("cvls-pressing");
    });
  }, { passive: true });
}

cvlsInstallPressFeedback();

/* =========================================================
   CENTRATURA AUTOMATICA ICONE NEI PULSANTI TONDI
========================================================= */

function cvlsCenterCircleIcons() {
  const selectors = [
    "#openMenuBtn",
    "#syncBtn",
    "#searchBtn",
    "#backArchivioBtn",
    ".round-back-btn",
    ".topbar-btn",
    ".circle-btn",
    ".icon-btn"
  ];

  document.querySelectorAll(selectors.join(",")).forEach(function (btn) {
    btn.classList.add("cvls-circle-icon-center");
  });
}

cvlsCenterCircleIcons();

document.addEventListener("DOMContentLoaded", function () {
  cvlsCenterCircleIcons();
});

const cvlsCircleIconObserver = new MutationObserver(function () {
  cvlsCenterCircleIcons();
});

cvlsCircleIconObserver.observe(document.body, {
  childList: true,
  subtree: true
});

function formatCvlsDateTimeForSheet(date) {
  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) {
    return "";
  }

  const giorno = String(d.getDate()).padStart(2, "0");
  const mese = String(d.getMonth() + 1).padStart(2, "0");
  const anno = d.getFullYear();

  const ore = String(d.getHours()).padStart(2, "0");
  const minuti = String(d.getMinutes()).padStart(2, "0");

  return giorno + "/" + mese + "/" + anno + " " + ore + ":" + minuti;
}

/* =========================
   MENU CONTESTUALE PRESSIONE LUNGA
========================= */

const CVLS_LONG_PRESS_MS = 1000;
const CVLS_LONG_PRESS_MOVE_LIMIT = 12;

function cvlsShowActionMenu(options) {
  const config = options || {};
  const title = config.title || "Azioni";
  const actions = Array.isArray(config.actions) ? config.actions : [];

  if (actions.length === 0) {
    return;
  }

  const oldMenu = document.getElementById("cvlsActionMenuOverlay");

  if (oldMenu) {
    oldMenu.remove();
  }

  const overlay = document.createElement("div");
  overlay.id = "cvlsActionMenuOverlay";
  overlay.className = "cvls-action-menu-overlay";

  const card = document.createElement("div");
  card.className = "cvls-action-menu-card";

  const titleEl = document.createElement("div");
  titleEl.className = "cvls-action-menu-title";
  titleEl.textContent = title;

  card.appendChild(titleEl);

  actions.forEach(function (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cvls-action-menu-btn";

    if (action.danger) {
      btn.classList.add("danger");
    }

    btn.textContent = action.label || "Azione";

    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();

      overlay.remove();

      if (typeof action.onClick === "function") {
        action.onClick();
      }
    });

    card.appendChild(btn);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "cvls-action-menu-btn cancel";
  cancelBtn.textContent = "Annulla";

  cancelBtn.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    overlay.remove();
  });

  card.appendChild(cancelBtn);

  overlay.addEventListener("click", function (event) {
    if (event.target === overlay) {
      overlay.remove();
    }
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

function abilitaMenuPressioneLunga(elemento, options) {
  if (!elemento || elemento.dataset.cvlsLongPressEnabled === "1") {
    return;
  }

  elemento.dataset.cvlsLongPressEnabled = "1";

  const config = options || {};

  let timer = null;
  let startX = 0;
  let startY = 0;
  let longPressTriggered = false;

  function clearLongPressTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    elemento.classList.remove("cvls-longpress-active");
  }

  function startLongPress(event) {
    if (cvlsSyncInProgress) {
      return;
    }

    longPressTriggered = false;

    const point =
      event.touches && event.touches.length > 0
        ? event.touches[0]
        : event;

    startX = point.clientX || 0;
    startY = point.clientY || 0;

    clearLongPressTimer();
    elemento.classList.add("cvls-longpress-active");

    timer = setTimeout(function () {
      longPressTriggered = true;

      if (navigator.vibrate) {
        navigator.vibrate(35);
      }

      const actions = [];

      if (config.modifica && config.puoModificare !== false) {
        actions.push({
          label: "Modifica",
          onClick: config.modifica
        });
      }

      if (config.elimina && config.puoEliminare !== false) {
        actions.push({
          label: "Elimina",
          danger: true,
          onClick: config.elimina
        });
      }

      cvlsShowActionMenu({
        title: config.title || "Azioni",
        actions: actions
      });
    }, CVLS_LONG_PRESS_MS);
  }

  function moveLongPress(event) {
    if (!timer) {
      return;
    }

    const point =
      event.touches && event.touches.length > 0
        ? event.touches[0]
        : event;

    const currentX = point.clientX || 0;
    const currentY = point.clientY || 0;

    const diffX = Math.abs(currentX - startX);
    const diffY = Math.abs(currentY - startY);

    if (
      diffX > CVLS_LONG_PRESS_MOVE_LIMIT ||
      diffY > CVLS_LONG_PRESS_MOVE_LIMIT
    ) {
      clearLongPressTimer();
    }
  }

  function endLongPress(event) {
    clearLongPressTimer();

    if (longPressTriggered && event) {
      event.preventDefault();
      event.stopPropagation();
    }

    window.setTimeout(function () {
      longPressTriggered = false;
    }, 80);
  }

  elemento.addEventListener("touchstart", startLongPress, { passive: true });
  elemento.addEventListener("touchmove", moveLongPress, { passive: true });
  elemento.addEventListener("touchend", endLongPress);
  elemento.addEventListener("touchcancel", endLongPress);

  elemento.addEventListener("mousedown", startLongPress);
  elemento.addEventListener("mousemove", moveLongPress);
  elemento.addEventListener("mouseup", endLongPress);
  elemento.addEventListener("mouseleave", endLongPress);

  elemento.addEventListener("click", function (event) {
    if (longPressTriggered) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
}

/* =========================================================
   INTEGRAZIONE CANTIERE & CITTÀ IN BOLLATURA PRESENZA
========================================================= */

function populateBollaturaSelectors() {
  const cittaSelect = document.getElementById("bollaturaCittaSelect");
  const cantiereSelect = document.getElementById("bollaturaCantiereSelect");
  if (!cittaSelect || !cantiereSelect) return;

  // Popola Città
  cittaSelect.innerHTML = '<option value="">-- Seleziona Città --</option>';
  (dati.citta || []).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.NomeCitta;
    opt.textContent = c.NomeCitta;
    cittaSelect.appendChild(opt);
  });

  // Popola Cantieri
  cantiereSelect.innerHTML = '<option value="">-- Seleziona Cantiere --</option>';
  (dati.cantieri || []).forEach(cant => {
    const opt = document.createElement("option");
    opt.value = cant.nome;
    opt.textContent = cant.nome;
    cantiereSelect.appendChild(opt);
  });
}

// Intercettiamo l'inizializzazione della bollatura per popolare le tendine
const originalBollaturaInit = window.CvlsGeobollatura ? window.CvlsGeobollatura.init : null;
if (window.CvlsGeobollatura) {
  window.CvlsGeobollatura.init = function() {
    populateBollaturaSelectors();
    if (originalBollaturaInit) originalBollaturaInit.apply(this, arguments);
  };
}

/* =========================================================
   GESTIONE SEDI E BOLLATURA PER UTENTI AMMINISTRATORI
========================================================= */

async function openAdminBollature() {
  closeSideMenu();
  document.getElementById("adminBollatureModal").classList.remove("hidden");
  await loadAndRenderAdminTechList();
  renderAdminCantieriList();
}

function closeAdminBollature() {
  document.getElementById("adminBollatureModal").classList.add("hidden");
}

let adminTechniciansCache = [];

async function loadAndRenderAdminTechList() {
  const container = document.getElementById("adminTechList");
  if (!container) return;
  
  container.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 20px;">Caricamento dipendenti...</div>';
  
  try {
    const list = await window.CvlsSupabase.getAllTechnicians();
    adminTechniciansCache = list;
    
    container.innerHTML = "";
    
    if (list.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 20px;">Nessun tecnico trovato nel database.</div>';
      return;
    }
    
    list.forEach(tech => {
      const card = document.createElement("div");
      card.className = "cvls-bollatura-card";
      card.style.background = "#ffffff";
      card.style.border = "1px solid #e5e7eb";
      card.style.borderRadius = "12px";
      card.style.padding = "15px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "8px";
      card.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
      
      const nomeSede = tech.bollatura_nome_sede || "Ozegna (Sede)";
      const lat = tech.bollatura_latitudine !== null && tech.bollatura_latitudine !== undefined ? tech.bollatura_latitudine : 45.3496;
      const lon = tech.bollatura_longitudine !== null && tech.bollatura_longitudine !== undefined ? tech.bollatura_longitudine : 7.7470;
      const raggio = tech.bollatura_raggio !== null && tech.bollatura_raggio !== undefined ? tech.bollatura_raggio : 200;
      
      card.innerHTML = `
        <div style="font-weight: bold; font-size: 16px; color: #111827;">${tech.nome_tecnico}</div>
        <div style="font-size: 14px; color: #4b5563; line-height: 1.4;">
          <strong>Sede/Trasferta:</strong> ${nomeSede}<br>
          <strong>Coordinate:</strong> ${lat.toFixed(5)}, ${lon.toFixed(5)}<br>
          <strong>Raggio:</strong> ${raggio} metri
        </div>
        <button class="primary-btn edit-tech-loc-btn" data-id="${tech.id}" style="padding: 6px 12px; font-size: 13px; align-self: flex-start; margin-top: 5px; background-color: #0284c7; border: none; border-radius: 6px; color: white; cursor: pointer;">
          Modifica Sede/Trasferta
        </button>
      `;
      
      const btn = card.querySelector(".edit-tech-loc-btn");
      btn.onclick = () => openEditTechLocation(tech);
      
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Errore caricamento dipendenti:", error);
    container.innerHTML = `<div style="text-align: center; color: #dc2626; padding: 20px;">Errore: ${error.message || "Impossibile caricare i dati"}</div>`;
  }
}

function openEditTechLocation(tech) {
  document.getElementById("editTechUserId").value = tech.id;
  document.getElementById("editTechLocName").value = tech.bollatura_nome_sede || "Ozegna (Sede)";
  document.getElementById("editTechLocLat").value = tech.bollatura_latitudine !== null && tech.bollatura_latitudine !== undefined ? tech.bollatura_latitudine : 45.3496;
  document.getElementById("editTechLocLon").value = tech.bollatura_longitudine !== null && tech.bollatura_longitudine !== undefined ? tech.bollatura_longitudine : 7.7470;
  document.getElementById("editTechLocRadius").value = tech.bollatura_raggio !== null && tech.bollatura_raggio !== undefined ? tech.bollatura_raggio : 200;
  
  // Resetta i campi di ricerca indirizzo
  document.getElementById("editTechSearchAddr").value = "";
  const suggestionsBox = document.getElementById("addrSuggestions");
  if (suggestionsBox) {
    suggestionsBox.innerHTML = "";
    suggestionsBox.style.display = "none";
  }
  
  document.getElementById("editTechLocationModal").classList.add("show");
}

function closeEditTechLocation() {
  document.getElementById("editTechLocationModal").classList.remove("show");
}

async function saveTechLocation() {
  const userId = document.getElementById("editTechUserId").value;
  const name = document.getElementById("editTechLocName").value.trim();
  const latRaw = document.getElementById("editTechLocLat").value;
  const lonRaw = document.getElementById("editTechLocLon").value;
  const radiusRaw = document.getElementById("editTechLocRadius").value;
  
  if (!name) {
    alert("Inserisci un nome per la sede o trasferta.");
    return;
  }
  
  const lat = parseFloat(latRaw);
  const lon = parseFloat(lonRaw);
  const radius = parseFloat(radiusRaw);
  
  if (isNaN(lat) || isNaN(lon) || isNaN(radius)) {
    alert("Inserisci valori numerici validi per coordinate e raggio.");
    return;
  }
  
  try {
    await window.CvlsSupabase.updateTechnicianLocation(userId, name, lat, lon, radius);
    closeEditTechLocation();
    await loadAndRenderAdminTechList();
    alert("Area di bollatura modificata con successo!");
  } catch (error) {
    console.error("Errore salvataggio trasferta:", error);
    alert("Errore nel salvataggio: " + (error.message || error));
  }
}

let searchAddrTimeout = null;

async function handleTechSearchAddressInput(e) {
  const query = e.target.value.trim();
  const suggestionsBox = document.getElementById("addrSuggestions");
  if (!suggestionsBox) return;
  
  if (query.length < 3) {
    suggestionsBox.innerHTML = "";
    suggestionsBox.style.display = "none";
    return;
  }
  
  clearTimeout(searchAddrTimeout);
  searchAddrTimeout = setTimeout(async () => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
        headers: {
          "User-Agent": "CVLS-App-Client"
        }
      });
      const data = await response.json();
      
      suggestionsBox.innerHTML = "";
      if (data && data.length > 0) {
        suggestionsBox.style.display = "block";
        data.forEach(item => {
          const div = document.createElement("div");
          div.style.padding = "10px 12px";
          div.style.cursor = "pointer";
          div.style.borderBottom = "1px solid #e5e7eb";
          div.style.fontSize = "13px";
          div.style.color = "#1f2937";
          div.style.background = "#ffffff";
          
          div.textContent = item.display_name;
          
          div.onclick = () => {
            const parts = item.display_name.split(",");
            const shortName = (parts[0] + (parts[1] ? ", " + parts[1] : "")).trim();
            
            document.getElementById("editTechLocName").value = shortName;
            document.getElementById("editTechLocLat").value = parseFloat(item.lat).toFixed(6);
            document.getElementById("editTechLocLon").value = parseFloat(item.lon).toFixed(6);
            
            document.getElementById("editTechSearchAddr").value = shortName;
            suggestionsBox.innerHTML = "";
            suggestionsBox.style.display = "none";
          };
          
          suggestionsBox.appendChild(div);
        });
      } else {
        suggestionsBox.style.display = "none";
      }
    } catch (err) {
      console.error("Errore Nominatim:", err);
    }
  }, 500);
}

function renderAdminCantieriList() {
  const container = document.getElementById("adminCantieriList");
  if (!container) return;
  
  const list = dati.cantieri || [];
  if (list.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 10px; font-size: 13px;">Nessun cantiere caricato.</div>';
    return;
  }
  
  container.innerHTML = "";
  list.forEach(cantiere => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.padding = "8px 12px";
    row.style.borderBottom = "1px solid #f3f4f6";
    row.style.background = "#ffffff";
    row.style.borderRadius = "6px";
    row.style.fontSize = "13px";
    row.style.color = "#1f2937";
    row.style.boxShadow = "0 1px 2px rgba(0,0,0,0.02)";
    
    row.innerHTML = `
      <span style="font-weight: 500;">${cantiere.nome || cantiere.Nome}</span>
    `;
    container.appendChild(row);
  });
}

async function adminAddCantiere() {
  const input = document.getElementById("adminNewCantiereName");
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    cvlsAlert("Inserisci il nome del cantiere.", "Campo vuoto");
    return;
  }
  
  // Controlla se esiste già
  const esiste = (dati.cantieri || []).some(c => (c.nome || c.Nome || "").toLowerCase() === name.toLowerCase());
  if (esiste) {
    cvlsAlert("Questo cantiere esiste già.", "Duplicato");
    return;
  }
  
  // Aggiungi a dati.cantieri e salva pendente
  const newCantiere = {
    nome: name,
    created_by: localStorage.getItem("cvls_user_name") || "Admin"
  };
  
  if (!dati.cantieri) dati.cantieri = [];
  dati.cantieri.push(newCantiere);
  saveLocalData();
  
  savePendingChange({
    type: "ADD_CANTIERE",
    payload: newCantiere
  });
  
  input.value = "";
  
  // Renderizza la lista aggiornata
  renderAdminCantieriList();
  
  // Avvia sincronizzazione automatica in background
  syncApp();
  
  cvlsAlert(`Cantiere "${name}" aggiunto e in fase di sincronizzazione!`, "Cantiere Aggiunto");
}

/* =========================
   SCHEDA PUBBLICA (QR SENZA APP)
========================= */

async function mostraSchedaPubblica(codice) {
  // Nascondi tutte le schermate e mostra quella pubblica
  const allScreens = document.querySelectorAll(".screen");
  allScreens.forEach(s => s.classList.remove("active"));

  const publicView = document.getElementById("publicDeviceView");
  if (!publicView) return;
  publicView.classList.add("active");
  publicView.style.display = "block";

  // Popola il sottotitolo con il codice dispositivo
  const subtitle = document.getElementById("publicDeviceSubtitle");
  if (subtitle) subtitle.textContent = "Codice: " + codice;

  // Configura il tasto "Apri nell'app CVLS" con deep link + fallback popup
  const appBtn = document.getElementById("publicOpenAppBtn");
  if (appBtn) {
    // Deep link schema usato dall'app Capacitor
    const deepLink = "cvls://device/" + encodeURIComponent(codice);
    appBtn.href = deepLink;
    appBtn.onclick = function (e) {
      e.preventDefault();
      // Tenta di aprire l'app via deep link
      window.location.href = deepLink;
      // Dopo 2 secondi, se la pagina è ancora visibile (app non installata), mostra il popup
      setTimeout(function () {
        if (!document.hidden) {
          mostraPopupNonAutorizzato();
        }
      }, 2000);
    };
  }

  // Carica i dati del dispositivo da Supabase
  try {
    await caricaDatiPubblici(codice);
  } catch (err) {
    console.error("Errore caricamento scheda pubblica:", err);
    const specsList = document.getElementById("publicTechSpecsList");
    if (specsList) {
      specsList.innerHTML = '<p style="color:#6e6e73; font-size:15px;">Impossibile caricare i dati del dispositivo.</p>';
    }
  }
}

async function caricaDatiPubblici(codice) {
  const SUPABASE_URL = "https://pucnnjirnyjihofbkllp.supabase.co";
  const SUPABASE_KEY = "sb_publishable_uwk_fJ0NDi4XKoo5h1j-Fw_204EHAIB";

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY
  };

  // 1. Carica informazioni base del dispositivo
  const dispositivoRes = await fetch(
    SUPABASE_URL + "/rest/v1/dispositivi?codice_completo=eq." + encodeURIComponent(codice),
    { headers }
  );
  const dispositivi = await dispositivoRes.json();
  const dispositivo = dispositivi && dispositivi[0] ? dispositivi[0] : null;

  // Popola sottotitolo con nome dispositivo
  const subtitle = document.getElementById("publicDeviceSubtitle");
  if (subtitle && dispositivo) {
    subtitle.textContent = dispositivo.nome || ("Codice: " + codice);
  }

  // Popola caratteristiche tecniche
  const specsList = document.getElementById("publicTechSpecsList");
  if (specsList) {
    if (dispositivo) {
      const datiTecnici = dispositivo.dati_tecnici || {};
      const campi = [
        { label: "Nome dispositivo", value: dispositivo.nome },
        { label: "Tipo", value: dispositivo.tipo_dispositivo },
        { label: "Presidio", value: dispositivo.nome_presidio },
        { label: "Ubicazione", value: dispositivo.nome_ubicazione },
        { label: "Città", value: dispositivo.nome_citta },
        { label: "Marca", value: datiTecnici.marca || datiTecnici.Marca },
        { label: "Modello", value: datiTecnici.modello || datiTecnici.Modello },
        { label: "Matricola", value: datiTecnici.matricola || datiTecnici.Matricola },
        { label: "Anno", value: datiTecnici.anno || datiTecnici.Anno },
        { label: "Alimentazione", value: datiTecnici.alimentazione || datiTecnici.Alimentazione },
        { label: "Note", value: datiTecnici.note || datiTecnici.Note }
      ].filter(c => c.value);

      if (campi.length > 0) {
        specsList.innerHTML = campi.map((c, i) => `
          <div style="border-top: ${i === 0 ? "none" : "1px solid #e5e5ea"}; padding: ${i === 0 ? "0 0 12px" : "12px 0"};">
            <div style="font-size: 12px; color: #8e8e93; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 5px; font-weight: 600;">${escapeHtmlPublic(c.label)}</div>
            <div style="font-size: 18px; font-weight: 600; color: #1d1d1f;">${escapeHtmlPublic(String(c.value))}</div>
          </div>
        `).join("");
      } else {
        specsList.innerHTML = '<p style="color:#6e6e73; font-size:15px;">Nessuna caratteristica tecnica registrata.</p>';
      }
    } else {
      specsList.innerHTML = '<p style="color:#6e6e73; font-size:15px;">Dispositivo non trovato nel sistema.</p>';
    }
  }

  // 2. Carica storico manutenzione
  const interventiRes = await fetch(
    SUPABASE_URL + "/rest/v1/manutenzioni?codice_completo=eq." + encodeURIComponent(codice) + "&order=data.desc",
    { headers }
  );
  const interventi = await interventiRes.json();

  const tbody = document.getElementById("publicHistoryTableBody");
  const emptyMsg = document.getElementById("publicHistoryEmpty");

  if (tbody) {
    if (interventi && interventi.length > 0) {
      if (emptyMsg) emptyMsg.classList.add("hidden");
      tbody.innerHTML = interventi.map(r => `
        <tr>
          <td style="padding: 14px 16px; border-bottom: 1px solid #ececf0; vertical-align: top; color: #1d1d1f; font-weight: 500;">${escapeHtmlPublic(formatDataPubblica(r.data))}</td>
          <td style="padding: 14px 16px; border-bottom: 1px solid #ececf0; vertical-align: top; color: #1d1d1f; font-weight: 500;">${escapeHtmlPublic(r.descrizione || "")}</td>
          <td style="padding: 14px 16px; border-bottom: 1px solid #ececf0; vertical-align: top; color: #1d1d1f; font-weight: 500;">${escapeHtmlPublic(String(r.ore || ""))}</td>
          <td style="padding: 14px 16px; border-bottom: 1px solid #ececf0; vertical-align: top; color: #1d1d1f; font-weight: 500;">${escapeHtmlPublic(r.tecnico || "")}</td>
        </tr>
      `).join("");
    } else {
      tbody.innerHTML = "";
      if (emptyMsg) emptyMsg.classList.remove("hidden");
    }
  }
}

function mostraPopupNonAutorizzato() {
  // Crea il popup overlay al volo se non esiste già
  let overlay = document.getElementById("publicNoAppOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "publicNoAppOverlay";
    overlay.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(0,0,0,0.35);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:9999;";
    overlay.innerHTML = `
      <div style="width:100%;max-width:340px;background:rgba(255,255,255,0.97);border-radius:26px;padding:28px 24px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,0.22);">
        <div style="font-size:48px;margin-bottom:12px;">🔒</div>
        <h3 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#1d1d1f;letter-spacing:-0.02em;">Utente non autorizzato</h3>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.5;color:#6e6e73;">Per aprire la scheda nell'app è necessario essere autorizzati da Cavaletto Sanità.</p>
        <button onclick="document.getElementById('publicNoAppOverlay').remove()" style="width:100%;border:0;border-radius:999px;padding:14px 18px;background:linear-gradient(180deg,#0a84ff,#0071e3);color:white;font-size:16px;font-weight:700;cursor:pointer;">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
}

function escapeHtmlPublic(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDataPubblica(value) {
  if (!value) return "";
  // Formato Supabase: 2024-03-15 → 15/03/2024
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parts = value.split("-");
    return parts[2].substring(0, 2) + "/" + parts[1] + "/" + parts[0];
  }
  return String(value);
}

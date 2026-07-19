/* =========================================================
   CVLS - BOLLATURA GEOLOCALIZZATA & GEOFENCING (ATTENDANCE)
   ========================================================= */

window.CvlsGeobollatura = (function () {
    let watchId = null;
    let currentCoords = null;
    let isPageTrackingActive = false;
    let isModalOpen = false;

    function getActiveCheckinStorageKey() {
        const userId = String(localStorage.getItem("cvls_user_id") || "").trim();
        return userId ? "cvls_attendance_active_" + userId : "";
    }

    function getActiveAttendance() {
        const key = getActiveCheckinStorageKey();
        if (!key) return null;
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function setActiveAttendance(data) {
        const key = getActiveCheckinStorageKey();
        if (!key) return;
        localStorage.setItem(key, JSON.stringify(data));
    }

    function clearActiveAttendance() {
        const key = getActiveCheckinStorageKey();
        if (!key) return;
        localStorage.removeItem(key);
    }

    // Calcolo della distanza in metri tramite formula dell'Emi-seno (Haversine)
    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Raggio della terra in metri
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function init() {
        // Chiude il menu laterale se aperto
        const sideMenu = document.getElementById("sideMenu");
        const sideOverlay = document.getElementById("sideOverlay");
        if (sideMenu) sideMenu.classList.remove("open");
        if (sideOverlay) sideOverlay.classList.add("hidden");

        // Mostra la modale della bollatura
        const modal = document.getElementById("bollaturaModal");
        if (modal) modal.classList.remove("hidden");

        const closeBtn = document.getElementById("closeBollaturaBtn");
        if (closeBtn) closeBtn.onclick = cleanup;

        const ingBtn = document.getElementById("bollaturaIngressoBtn");
        const uscBtn = document.getElementById("bollaturaUscitaBtn");

        if (ingBtn) ingBtn.onclick = registraIngresso;
        if (uscBtn) uscBtn.onclick = registraUscita;

        isModalOpen = true;

        // Aggiorna lo stato dei bottoni e del testo
        updateUI();

        // Avvia il tracciamento della posizione GPS
        startGpsTracking();
    }

    function cleanup() {
        isModalOpen = false;
        if (!isPageTrackingActive) {
            stopGpsTracking();
            currentCoords = null;
        }

        const modal = document.getElementById("bollaturaModal");
        if (modal) modal.classList.add("hidden");
    }

    function startGpsTracking() {
        if (watchId !== null) {
            // Se sta già tracciando, facciamo solo aggiornamento UI immediato
            if (isModalOpen) updateUI();
            if (isPageTrackingActive) updatePageUI();
            return;
        }

        const statusText = document.getElementById("bollaturaStatusText");
        const statusDot = document.getElementById("bollaturaGpsStatus");

        if (isModalOpen) {
            if (statusText) statusText.textContent = "Acquisizione posizione GPS...";
            if (statusDot) {
                statusDot.className = "gps-dot orange";
            }
        }

        if (isPageTrackingActive) {
            const pageStatusText = document.getElementById("regPresGpsStatusText");
            const pageStatusDot = document.getElementById("regPresGpsStatusDot");
            if (pageStatusText) pageStatusText.textContent = "Non autorizzato";
            if (pageStatusDot) pageStatusDot.className = "gps-dot orange";
        }

        if (!navigator.geolocation) {
            if (isModalOpen) {
                if (statusText) statusText.textContent = "Errore: GPS non supportato dal dispositivo.";
                if (statusDot) statusDot.className = "gps-dot red";
            }
            if (isPageTrackingActive) {
                const pageStatusText = document.getElementById("regPresGpsStatusText");
                const pageStatusDot = document.getElementById("regPresGpsStatusDot");
                if (pageStatusText) pageStatusText.textContent = "Non autorizzato";
                if (pageStatusDot) pageStatusDot.className = "gps-dot orange";
            }
            return;
        }

        // Usiamo watchPosition per avere la posizione aggiornata continuamente
        watchId = navigator.geolocation.watchPosition(
            function (position) {
                currentCoords = position.coords;
                if (isModalOpen) {
                    updateUI();
                }
                if (isPageTrackingActive) {
                    updatePageUI();
                }
            },
            function (error) {
                console.error("Errore GPS:", error);
                if (isModalOpen) {
                    if (statusText) {
                        if (error.code === error.PERMISSION_DENIED) {
                            statusText.textContent = "Errore GPS: Permesso negato. Abilita la geolocalizzazione.";
                        } else {
                            statusText.textContent = "Errore GPS: Segnale non disponibile.";
                        }
                    }
                    if (statusDot) statusDot.className = "gps-dot red";
                }

                if (isPageTrackingActive) {
                    const pageStatusText = document.getElementById("regPresGpsStatusText");
                    const pageStatusDot = document.getElementById("regPresGpsStatusDot");
                    const pageDistText = document.getElementById("regPresDistanzaAttuale");
                    if (pageStatusText) pageStatusText.textContent = "Non autorizzato";
                    if (pageStatusDot) pageStatusDot.className = "gps-dot orange";
                    if (pageDistText) pageDistText.textContent = "Non disponibile";
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }

    function stopGpsTracking() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }

    function updateUI() {
        const statusText = document.getElementById("bollaturaStatusText");
        const statusDot = document.getElementById("bollaturaGpsStatus");
        const ingressoBtn = document.getElementById("bollaturaIngressoBtn");
        const uscitaBtn = document.getElementById("bollaturaUscitaBtn");

        if (!statusText || !ingressoBtn || !uscitaBtn) return;

        // Recupera le informazioni della sede/trasferta assegnata dal profilo
        const nomeSede = localStorage.getItem("cvls_bollatura_nome_sede") || "Ozegna (Sede)";
        const latTarget = parseFloat(localStorage.getItem("cvls_bollatura_latitudine") || "45.3496");
        const lonTarget = parseFloat(localStorage.getItem("cvls_bollatura_longitudine") || "7.7470");
        const raggioTarget = parseFloat(localStorage.getItem("cvls_bollatura_raggio") || "200");

        // Recupera eventuale check-in attivo (da localStorage)
        const activeCheckin = getActiveCheckin();

        // Se non abbiamo ancora acquisito la posizione GPS
        if (!currentCoords) {
            ingressoBtn.disabled = true;
            ingressoBtn.classList.add("disabled");
            uscitaBtn.disabled = true;
            uscitaBtn.classList.add("disabled");
            return;
        }

        // Calcolo distanza e geofencing
        const distance = getDistance(
            currentCoords.latitude,
            currentCoords.longitude,
            latTarget,
            lonTarget
        );

        const isWithinRange = distance <= raggioTarget;

        if (statusDot) {
            statusDot.className = isWithinRange ? "gps-dot green" : "gps-dot orange";
        }

        const distanceText = `<br>Sede: <strong>${nomeSede}</strong><br>Distanza attuale: <strong>${Math.round(distance)}m</strong> (Limite: ${raggioTarget}m).`;

        const cittaSelect = document.getElementById("bollaturaCittaSelect");
        const cantiereSelect = document.getElementById("bollaturaCantiereSelect");

        // Aggiorna lo stato in base al check-in corrente del dispositivo
        if (activeCheckin) {
            // C'è un check-in attivo
            const timeDiff = new Date() - new Date(activeCheckin.time);
            const minutes = Math.floor(timeDiff / 60000);

            const luogoRegistrazione = activeCheckin.statoGps === "fuori_zona_sbloccata"
                ? "<strong>FUORI ZONA (Forzato)</strong>"
                : `presso <strong>${activeCheckin.nomeSede}</strong>`;

            statusText.innerHTML = `Ingresso registrato ${luogoRegistrazione} da <strong>${minutes} min</strong>.<br>Città: <strong>${activeCheckin.cittaNome || "-"}</strong><br>Cantiere: <strong>${activeCheckin.cantiereNome || "-"}</strong>${distanceText}`;

            ingressoBtn.disabled = true;
            ingressoBtn.classList.add("disabled");

            uscitaBtn.disabled = false;
            uscitaBtn.classList.remove("disabled");

            if (cittaSelect && cantiereSelect) {
                cittaSelect.value = activeCheckin.cittaNome || "";
                cantiereSelect.value = activeCheckin.cantiereNome || "";
                cittaSelect.disabled = true;
                cantiereSelect.disabled = true;
            }
        } else {
            // Nessun check-in attivo
            statusText.innerHTML = `Pronto per registrare l'ingresso al lavoro.${distanceText}`;

            ingressoBtn.disabled = false;
            ingressoBtn.classList.remove("disabled");

            uscitaBtn.disabled = true;
            uscitaBtn.classList.add("disabled");

            if (cittaSelect && cantiereSelect) {
                cittaSelect.disabled = false;
                cantiereSelect.disabled = false;
            }
        }
    }

    function getActiveCheckin() {
        return getActiveAttendance();
    }

    function getRegistroPresenzeSelectedNames(fallbackCitta, fallbackCantiere, fallbackLuoghi) {
        if (typeof window.getRegistroPresenzeLuogoNames === "function") {
            const names = window.getRegistroPresenzeLuogoNames() || {};
            return {
                cittaNome: names.cittaNome || fallbackCitta || null,
                cantiereNome: names.cantiereNome || fallbackCantiere || null,
                luoghi: Array.isArray(names.luoghi)
                    ? names.luoghi
                    : (Array.isArray(fallbackLuoghi) ? fallbackLuoghi : [])
            };
        }

        const luoghi = typeof window.getRegistroPresenzeLuoghi === "function"
            ? window.getRegistroPresenzeLuoghi()
            : (Array.isArray(window.selectedRegistroPresenzeLuoghi)
                ? window.selectedRegistroPresenzeLuoghi
                : []);
        const presidiArr = Array.isArray(window.selectedRegistroPresenzePresidi)
            ? window.selectedRegistroPresenzePresidi
            : [];
        const ubicazioniArr = Array.isArray(window.selectedRegistroPresenzeUbicazioni)
            ? window.selectedRegistroPresenzeUbicazioni
            : [];

        return {
            cittaNome: presidiArr.length > 0
                ? presidiArr.map(function (p) { return p.NomePresidio; }).filter(Boolean).join(", ")
                : (fallbackCitta || null),
            cantiereNome: ubicazioniArr.length > 0
                ? ubicazioniArr.map(function (u) { return u.NomeUbicazione; }).filter(Boolean).join(", ")
                : (fallbackCantiere || null),
            luoghi: Array.isArray(luoghi)
                ? luoghi
                : (Array.isArray(fallbackLuoghi) ? fallbackLuoghi : [])
        };
    }

    async function registraIngresso() {
        if (!currentCoords) {
            cvlsAlert("Errore GPS: Impossibile acquisire la posizione. Assicurati che il GPS del dispositivo sia attivo e di aver concesso i permessi all'applicazione.", "GPS non disponibile");
            return;
        }

        const activeCheckin = getActiveCheckin();
        if (activeCheckin) return; // Già in servizio

        // Verifica selezione Città e Cantiere
        const cittaSelect = document.getElementById("bollaturaCittaSelect");
        const cantiereSelect = document.getElementById("bollaturaCantiereSelect");
        const selectedCitta = cittaSelect ? cittaSelect.value : "";
        const selectedCantiere = cantiereSelect ? cantiereSelect.value : "";

        if (!selectedCitta) {
            alert("Seleziona la città prima di registrare l'ingresso.");
            return;
        }
        if (!selectedCantiere) {
            alert("Seleziona il cantiere prima di registrare l'ingresso.");
            return;
        }

        const nomeSede = localStorage.getItem("cvls_bollatura_nome_sede") || "Ozegna (Sede)";
        const latTarget = parseFloat(localStorage.getItem("cvls_bollatura_latitudine") || "45.3496");
        const lonTarget = parseFloat(localStorage.getItem("cvls_bollatura_longitudine") || "7.7470");
        const raggioTarget = parseFloat(localStorage.getItem("cvls_bollatura_raggio") || "200");

        // Calcolo e geofencing
        const distance = getDistance(
            currentCoords.latitude,
            currentCoords.longitude,
            latTarget,
            lonTarget
        );
        const isWithinRange = distance <= raggioTarget;
        let statoGps = isWithinRange ? "in_zona" : "fuori_zona_sbloccata";

        if (!isWithinRange) {
            // Sblocco con conferma
            const forzato = await confirmForceRegistration(distance, raggioTarget, nomeSede, "ingresso");
            if (!forzato) return; // Abortito
        }

        const now = new Date().toISOString();
        const checkinInfo = {
            time: now,
            lat: currentCoords.latitude,
            lon: currentCoords.longitude,
            statoGps: statoGps,
            nomeSede: nomeSede,
            cittaNome: selectedCitta,
            cantiereNome: selectedCantiere
        };

        // Salva in localStorage come presenza attiva
        setActiveAttendance(checkinInfo);

        // Registra la bollatura localmente e in pending
        inviaBollatura("ingresso", checkinInfo);
        syncBollatureRegistroPresenzeAuto();

        cvlsAlert("Ingresso al lavoro registrato con successo!", "Bollatura effettuata");
        updateUI();
    }

    async function registraUscita() {
        if (!currentCoords) {
            cvlsAlert("Errore GPS: Impossibile acquisire la posizione. Assicurati che il GPS del dispositivo sia attivo e di aver concesso i permessi all'applicazione.", "GPS non disponibile");
            return;
        }

        const activeCheckin = getActiveCheckin();
        if (!activeCheckin) return; // Non in servizio

        const nomeSede = activeCheckin.nomeSede || "Ozegna (Sede)";
        const latTarget = parseFloat(localStorage.getItem("cvls_bollatura_latitudine") || "45.3496");
        const lonTarget = parseFloat(localStorage.getItem("cvls_bollatura_longitudine") || "7.7470");
        const raggioTarget = parseFloat(localStorage.getItem("cvls_bollatura_raggio") || "200");

        // Calcolo e geofencing per uscita
        const distance = getDistance(
            currentCoords.latitude,
            currentCoords.longitude,
            latTarget,
            lonTarget
        );
        const isWithinRange = distance <= raggioTarget;
        let statoGps = isWithinRange ? "in_zona" : "fuori_zona_sbloccata";

        if (!isWithinRange) {
            const forzato = await confirmForceRegistration(distance, raggioTarget, nomeSede, "uscita");
            if (!forzato) return; // Abortito
        }

        const checkoutInfo = {
            time: new Date().toISOString(),
            lat: currentCoords.latitude,
            lon: currentCoords.longitude,
            statoGps: statoGps,
            nomeSede: nomeSede
        };

        // Rimuovi check-in attivo da localStorage
        clearActiveAttendance();

        // Registra la bollatura localmente e in pending
        inviaBollatura("uscita", checkoutInfo);
        syncBollatureRegistroPresenzeAuto();

        cvlsAlert("Uscita dal lavoro registrata con successo!", "Bollatura effettuata");
        updateUI();
    }

    function confirmForceRegistration(distance, raggio, nomeSede, tipo = "ingresso") {
        return new Promise((resolve) => {
            cvlsConfirm(
                `Sei fuori zona da ${nomeSede} (distante ${Math.round(distance)}m, limite: ${raggio}m). Vuoi forzare la registrazione dell'${tipo} comunque?`,
                function () {
                    resolve(true);
                },
                function () {
                    resolve(false);
                },
                "Fuori Zona Geofencing"
            );
        });
    }

    function confirmRegistroPresenzeBollatura(tipo) {
        return new Promise(function (resolve) {
            const testo = tipo === "uscita"
                ? "Vuoi bollare l'uscita?"
                : "Vuoi bollare l'ingresso?";

            cvlsConfirm(
                testo,
                function () {
                    resolve(true);
                },
                function () {
                    resolve(false);
                },
                "Conferma bollatura"
            );
        });
    }

    function getPausaPranzoMinuti(value) {
        const normalized = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");

        if (normalized === "1 ora" || normalized === "60" || normalized === "60 minuti") {
            return 60;
        }

        if (
            normalized === "1/2 ora" ||
            normalized === "mezz'ora" ||
            normalized === "mezza ora" ||
            normalized === "30" ||
            normalized === "30 minuti"
        ) {
            return 30;
        }

        if (normalized === "continuato" || normalized === "0" || normalized === "0 minuti") {
            return 0;
        }

        return null;
    }

    function formatRegistroPresenzeMinuti(minutes) {
        const value = Math.max(0, Math.round(Number(minutes) || 0));
        const hours = Math.floor(value / 60);
        const mins = value % 60;
        return hours + "h " + String(mins).padStart(2, "0") + "m";
    }

    function calculateRegistroPresenzeTotali(activeCheckin, checkoutTime, pausaPranzo) {
        const ingressoDate = activeCheckin && activeCheckin.time ? new Date(activeCheckin.time) : null;
        const uscitaDate = checkoutTime ? new Date(checkoutTime) : null;
        const pausaMinuti = getPausaPranzoMinuti(pausaPranzo);

        if (!ingressoDate || isNaN(ingressoDate.getTime()) ||
            !uscitaDate || isNaN(uscitaDate.getTime()) ||
            uscitaDate.getTime() < ingressoDate.getTime() ||
            pausaMinuti === null) {
            return {
                pausaPranzoMinuti: pausaMinuti,
                durataLordaMinuti: null,
                totaleLavoratoMinuti: null,
                totaleLavoratoTesto: null,
                totaleCalcolatoMinuti: null,
                totaleCalcolatoTesto: null,
                orePermessoMinuti: null,
                orePermessoTesto: null,
                regolaCalcolo: null
            };
        }

        let oreViaggioMin = 0;
        try {
            const raw = localStorage.getItem("cvls_local_data");
            if (raw) {
                const dati = JSON.parse(raw);
                if (dati && Array.isArray(dati.oreViaggio)) {
                    const pad = (n) => String(n).padStart(2, "0");
                    const dateStr = ingressoDate.getFullYear() + "-" + pad(ingressoDate.getMonth() + 1) + "-" + pad(ingressoDate.getDate());
                    const match = dati.oreViaggio.find(v => v.data === dateStr);
                    if (match) oreViaggioMin = Number(match.ore_viaggio_minuti) || 0;
                }
            }
        } catch(e) {}

        const calcoli = window.CvlsRegistroPresenzeCalcoli.calcolaGiornata({
            ingresso: ingressoDate,
            uscita: uscitaDate,
            pausaMinuti: pausaMinuti,
            oreViaggioMinuti: oreViaggioMin
        });

        if (!calcoli) {
            return {
                pausaPranzoMinuti: pausaMinuti,
                durataLordaMinuti: null,
                totaleLavoratoMinuti: null,
                totaleLavoratoTesto: null,
                totaleCalcolatoMinuti: null,
                totaleCalcolatoTesto: null,
                orePermessoMinuti: null,
                orePermessoTesto: null,
                regolaCalcolo: null
            };
        }

        const orePermessoMinuti = calcoli.totaleNettoMinuti < 480 ? 480 - calcoli.totaleNettoMinuti : 0;

        return {
            pausaPranzoMinuti: calcoli.pausaMinuti,
            durataLordaMinuti: calcoli.totaleLordoMinuti,
            totaleLavoratoMinuti: calcoli.totaleNettoMinuti,
            totaleLavoratoTesto: formatRegistroPresenzeMinuti(calcoli.totaleNettoMinuti),
            totaleCalcolatoMinuti: calcoli.totaleNettoMinuti,
            totaleCalcolatoTesto: formatRegistroPresenzeMinuti(calcoli.totaleNettoMinuti),
            orePermessoMinuti: orePermessoMinuti,
            orePermessoTesto: orePermessoMinuti > 0 ? formatRegistroPresenzeMinuti(orePermessoMinuti) : null,
            esuberoMinuti: calcoli.esuberoMinuti,
            oreViaggioMinuti: calcoli.oreViaggioMinuti,
            straordinarioMinuti: calcoli.straordinarioMinuti,
            regolaCalcolo: null
        };
    }

    function inviaBollatura(tipo, info) {
        const tecnico = localStorage.getItem("cvls_user_name") || "Tecnico";

        const bollaturaRecord = {
            id: "BOL-" + Date.now().toString(36).toUpperCase(),
            tecnico: tecnico,
            codice_completo: null, // Indipendente dai dispositivi
            tipo_bollatura: tipo,
            orario: info.time,
            latitudine: info.lat,
            longitudine: info.lon,
            stato_gps: info.statoGps,
            nome_sede: info.nomeSede,
            cantiere_nome: info.cantiereNome || null,
            citta_nome: info.cittaNome || null,
            luoghi: Array.isArray(info.luoghi) ? info.luoghi : [],
            pausa_pranzo: info.pausaPranzo || null,
            pausa_pranzo_minuti: info.pausaPranzoMinuti ?? null,
            durata_lorda_minuti: info.durataLordaMinuti ?? null,
            totale_lavorato_minuti: info.totaleLavoratoMinuti ?? null,
            totale_lavorato_testo: info.totaleLavoratoTesto || null,
            totale_calcolato_minuti: info.totaleCalcolatoMinuti ?? null,
            totale_calcolato_testo: info.totaleCalcolatoTesto || null,
            ore_permesso_minuti: info.orePermessoMinuti ?? null,
            ore_permesso_testo: info.orePermessoTesto || null,
            regola_calcolo: info.regolaCalcolo || null
        };

        // Salva localmente in dati.bollature per eventuale storico
        ensureDataShape();
        if (!dati.bollature) dati.bollature = [];
        dati.bollature.push(bollaturaRecord);

        if (bollaturaRecord.pausa_pranzo && typeof window.saveRegistroPresenzePranzoLocal === "function") {
            window.saveRegistroPresenzePranzoLocal(bollaturaRecord.id, bollaturaRecord.pausa_pranzo);
        }

        saveLocalData();

        // Queue pending change per il sync
        savePendingChange({
            type: "ADD_BOLLATURA",
            deviceId: null,
            payload: {
                id: bollaturaRecord.id,
                tecnico: bollaturaRecord.tecnico,
                codice_completo: bollaturaRecord.codice_completo,
                tipo_bollatura: bollaturaRecord.tipo_bollatura,
                orario: bollaturaRecord.orario,
                latitudine: bollaturaRecord.latitudine,
                longitudine: bollaturaRecord.longitudine,
                stato_gps: bollaturaRecord.stato_gps,
                nome_sede: bollaturaRecord.nome_sede,
                cantiere_nome: info.cantiereNome || null,
                citta_nome: info.cittaNome || null,
                luoghi: bollaturaRecord.luoghi,
                pausa_pranzo: bollaturaRecord.pausa_pranzo,
                pausa_pranzo_minuti: bollaturaRecord.pausa_pranzo_minuti,
                durata_lorda_minuti: bollaturaRecord.durata_lorda_minuti,
                totale_lavorato_minuti: bollaturaRecord.totale_lavorato_minuti,
                totale_lavorato_testo: bollaturaRecord.totale_lavorato_testo,
                totale_calcolato_minuti: bollaturaRecord.totale_calcolato_minuti,
                totale_calcolato_testo: bollaturaRecord.totale_calcolato_testo,
                ore_permesso_minuti: bollaturaRecord.ore_permesso_minuti,
                ore_permesso_testo: bollaturaRecord.ore_permesso_testo,
                regola_calcolo: bollaturaRecord.regola_calcolo
            }
        });
    }

    function syncBollatureRegistroPresenzeAuto() {
        if (
            window &&
            typeof window.syncPendingBollatureOnlyAuto === "function"
        ) {
            window.setTimeout(function () {
                window.syncPendingBollatureOnlyAuto();
            }, 500);
        }
    }

    // Assicura l'esistenza del tracciato dati locale
    function ensureDataShape() {
        if (typeof dati === "undefined") {
            window.dati = {};
        }
    }

    function saveLocalData() {
        if (typeof window.saveLocalData === "function") {
            window.saveLocalData();
        } else {
            localStorage.setItem("cvls_dati", JSON.stringify(dati));
        }
    }

    function updatePageUI() {
        const statusText = document.getElementById("regPresGpsStatusText");
        const statusDot = document.getElementById("regPresGpsStatusDot");
        const areaText = document.getElementById("regPresAreaAutorizzata");
        const distText = document.getElementById("regPresDistanzaAttuale");
        const ingressoBtn = document.getElementById("regPresIngressoBtn");
        const uscitaBtn = document.getElementById("regPresUscitaBtn");

        // Recupera le informazioni della sede/trasferta assegnata dal profilo
        const nomeSede = localStorage.getItem("cvls_bollatura_nome_sede") || "Ozegna (Sede)";
        const latTarget = parseFloat(localStorage.getItem("cvls_bollatura_latitudine") || "45.3496");
        const lonTarget = parseFloat(localStorage.getItem("cvls_bollatura_longitudine") || "7.7470");
        const raggioTarget = parseFloat(localStorage.getItem("cvls_bollatura_raggio") || "200");

        if (areaText) {
            areaText.textContent = nomeSede;
        }

        const activeCheckin = getActiveCheckin();

        // Funzione helper per disabilitare un bottone con stile grigio chiaro
        function disableBtn(btn) {
            if (!btn) return;
            btn.disabled = true;
            btn.classList.add("disabled");
            btn.style.backgroundColor = "#e5e7eb";
            btn.style.color = "#9ca3af";
            btn.style.cursor = "not-allowed";
        }

        // Funzione helper per abilitare un bottone (ripristina stile)
        function enableBtn(btn) {
            if (!btn) return;
            btn.disabled = false;
            btn.classList.remove("disabled");
            btn.style.backgroundColor = "";
            btn.style.color = "";
            btn.style.cursor = "pointer";
        }

        // Se non abbiamo ancora acquisito la posizione GPS
        if (!currentCoords) {
            if (statusText) statusText.textContent = "Non autorizzato";
            if (statusDot) statusDot.className = "gps-dot orange";
            if (distText) distText.textContent = "GPS non disponibile";
            disableBtn(ingressoBtn);
            disableBtn(uscitaBtn);

            if (typeof window.cvlsAggiornaOreViaggioRegistroPresenze === "function") {
                window.cvlsAggiornaOreViaggioRegistroPresenze();
            }
            return;
        }

        // Calcolo distanza e geofencing
        let distance = null;
        let isAuthorized = false;

        if (!isNaN(latTarget) && !isNaN(lonTarget)) {
            distance = getDistance(
                currentCoords.latitude,
                currentCoords.longitude,
                latTarget,
                lonTarget
            );
            isAuthorized = distance <= raggioTarget;
        } else {
            isAuthorized = false;
        }

        // Aggiorna stato GPS
        if (statusDot) {
            statusDot.className = isAuthorized ? "gps-dot green" : "gps-dot orange";
        }
        if (statusText) {
            statusText.textContent = isAuthorized ? "Autorizzato" : "Non autorizzato";
        }
        if (distText) {
            if (distance !== null) {
                distText.textContent = Math.round(distance) + "m (limite " + raggioTarget + "m)";
            } else {
                distText.textContent = "Non disponibile";
            }
        }

        // Se non autorizzato: disabilita entrambi i pulsanti
        if (!isAuthorized) {
            disableBtn(ingressoBtn);
            disableBtn(uscitaBtn);
        } else {
            // Autorizzato: logica normale Ingresso/Uscita in base a activeCheckin
            if (activeCheckin) {
                disableBtn(ingressoBtn);
                enableBtn(uscitaBtn);
            } else {
                enableBtn(ingressoBtn);
                disableBtn(uscitaBtn);
            }
        }

        // Presidio e ubicazione restano modificabili fino alla bollatura successiva.
        var presInput = document.getElementById("regPresPresidioInput");
        var ubiInput = document.getElementById("regPresUbicazioneInput");
        var addLuogoBtn = document.getElementById("regPresLuogoAddBtn");
        if (presInput) { presInput.disabled = false; presInput.placeholder = "Cerca presidio..."; }
        if (ubiInput) { ubiInput.disabled = false; ubiInput.placeholder = "Cerca ubicazione..."; }
        if (addLuogoBtn) { addLuogoBtn.disabled = false; }

        if (typeof window.updateRegistroPresenzePranzoUI === "function") {
            window.updateRegistroPresenzePranzoUI();
        }

        if (typeof window.cvlsAggiornaOreViaggioRegistroPresenze === "function") {
            window.cvlsAggiornaOreViaggioRegistroPresenze();
        }
    }

    function startPageTracking() {
        isPageTrackingActive = true;
        updatePageUI();
        startGpsTracking();
    }

    function stopPageTracking() {
        isPageTrackingActive = false;
        if (!isModalOpen) {
            stopGpsTracking();
            currentCoords = null;
        }
    }

    async function registraIngressoRegistroPresenze() {
        if (!currentCoords) {
            cvlsAlert("Errore GPS: Impossibile acquisire la posizione. Assicurati che il GPS del dispositivo sia attivo e di aver concesso i permessi all'applicazione.", "GPS non disponibile");
            return;
        }

        const activeCheckin = getActiveCheckin();
        if (activeCheckin) return;

        const selectedNames = getRegistroPresenzeSelectedNames(null, null, []);
        const selectedPresidioName = selectedNames.cittaNome;
        const selectedUbicazioneName = selectedNames.cantiereNome;

        const nomeSede = localStorage.getItem("cvls_bollatura_nome_sede") || "Ozegna (Sede)";
        const latTarget = parseFloat(localStorage.getItem("cvls_bollatura_latitudine") || "45.3496");
        const lonTarget = parseFloat(localStorage.getItem("cvls_bollatura_longitudine") || "7.7470");
        const raggioTarget = parseFloat(localStorage.getItem("cvls_bollatura_raggio") || "200");

        let distance = null;
        let isWithinRange = true;
        let statoGps = "in_zona";

        if (!isNaN(latTarget) && !isNaN(lonTarget)) {
            distance = getDistance(
                currentCoords.latitude,
                currentCoords.longitude,
                latTarget,
                lonTarget
            );
            isWithinRange = distance <= raggioTarget;
            statoGps = isWithinRange ? "in_zona" : "non_autorizzato";
        } else {
            isWithinRange = false;
            statoGps = "non_autorizzato";
        }

        if (!isWithinRange) {
            cvlsAlert("Bollatura non consentita: posizione non autorizzata.", "Non autorizzato");
            updatePageUI();
            return;
        }

        const now = new Date().toISOString();
        const checkinInfo = {
            time: now,
            lat: currentCoords.latitude,
            lon: currentCoords.longitude,
            statoGps: statoGps,
            nomeSede: nomeSede,
            cittaNome: selectedPresidioName,
            cantiereNome: selectedUbicazioneName,
            luoghi: selectedNames.luoghi
        };

        const confermato = await confirmRegistroPresenzeBollatura("ingresso");
        if (!confermato) {
            updatePageUI();
            return;
        }

        setActiveAttendance(checkinInfo);
        window.registroPresenzeLuogoTouched = true;

        inviaBollatura("ingresso", checkinInfo);
        syncBollatureRegistroPresenzeAuto();

        cvlsAlert("Ingresso al lavoro registrato con successo!", "Bollatura effettuata");

        updateUI();
        updatePageUI();

        if (typeof window.updateRegistroPresenzePranzoUI === "function") {
            window.updateRegistroPresenzePranzoUI();
        }
    }

    async function registraUscitaRegistroPresenze() {
        if (!currentCoords) {
            cvlsAlert("Errore GPS: Impossibile acquisire la posizione. Assicurati che il GPS del dispositivo sia attivo e di aver concesso i permessi all'applicazione.", "GPS non disponibile");
            return;
        }

        const activeCheckin = getActiveCheckin();
        if (!activeCheckin) return;

        const pausaPranzo = typeof window.getRegistroPresenzePranzoSelection === "function"
            ? window.getRegistroPresenzePranzoSelection()
            : "";

        if (!pausaPranzo) {
            cvlsAlert("Seleziona la pausa pranzo prima di bollare l'uscita.", "Pranzo");

            if (typeof window.updateRegistroPresenzePranzoUI === "function") {
                window.updateRegistroPresenzePranzoUI();
            }

            return;
        }

        const selectedNames = getRegistroPresenzeSelectedNames(
            activeCheckin.cittaNome || null,
            activeCheckin.cantiereNome || null,
            activeCheckin.luoghi || []
        );
        const selectedPresidioName = selectedNames.cittaNome;
        const selectedUbicazioneName = selectedNames.cantiereNome;

        const nomeSede = activeCheckin.nomeSede || localStorage.getItem("cvls_bollatura_nome_sede") || "Ozegna (Sede)";
        const latTarget = parseFloat(localStorage.getItem("cvls_bollatura_latitudine") || "45.3496");
        const lonTarget = parseFloat(localStorage.getItem("cvls_bollatura_longitudine") || "7.7470");
        const raggioTarget = parseFloat(localStorage.getItem("cvls_bollatura_raggio") || "200");

        let distance = null;
        let isWithinRange = true;
        let statoGps = "in_zona";

        if (!isNaN(latTarget) && !isNaN(lonTarget)) {
            distance = getDistance(
                currentCoords.latitude,
                currentCoords.longitude,
                latTarget,
                lonTarget
            );
            isWithinRange = distance <= raggioTarget;
            statoGps = isWithinRange ? "in_zona" : "non_autorizzato";
        } else {
            isWithinRange = false;
            statoGps = "non_autorizzato";
        }

        if (!isWithinRange) {
            cvlsAlert("Bollatura non consentita: posizione non autorizzata.", "Non autorizzato");
            updatePageUI();
            return;
        }

        const checkoutTime = new Date().toISOString();
        const totali = calculateRegistroPresenzeTotali(activeCheckin, checkoutTime, pausaPranzo);

        const checkoutInfo = {
            time: checkoutTime,
            lat: currentCoords.latitude,
            lon: currentCoords.longitude,
            statoGps: statoGps,
            nomeSede: nomeSede,
            cittaNome: selectedPresidioName,
            cantiereNome: selectedUbicazioneName,
            luoghi: selectedNames.luoghi,
            pausaPranzo: pausaPranzo,
            pausaPranzoMinuti: totali.pausaPranzoMinuti,
            durataLordaMinuti: totali.durataLordaMinuti,
            totaleLavoratoMinuti: totali.totaleLavoratoMinuti,
            totaleLavoratoTesto: totali.totaleLavoratoTesto,
            totaleCalcolatoMinuti: totali.totaleCalcolatoMinuti,
            totaleCalcolatoTesto: totali.totaleCalcolatoTesto,
            orePermessoMinuti: totali.orePermessoMinuti,
            orePermessoTesto: totali.orePermessoTesto,
            regolaCalcolo: totali.regolaCalcolo
        };

        const confermato = await confirmRegistroPresenzeBollatura("uscita");
        if (!confermato) {
            updatePageUI();
            return;
        }

        clearActiveAttendance();

        inviaBollatura("uscita", checkoutInfo);
        syncBollatureRegistroPresenzeAuto();

        // Reset le selezioni dopo uscita. I valori sono gia' stati copiati in checkoutInfo.
        if (typeof window.resetRegistroPresenzeLuogoSelections === "function") {
            window.resetRegistroPresenzeLuogoSelections();
        } else {
            window.selectedRegistroPresenzePresidi = [];
            window.selectedRegistroPresenzeUbicazioni = [];
            window.selectedRegistroPresenzeLuoghi = [];
            window.registroPresenzeLuogoTouched = false;
        }

        if (typeof window.resetRegistroPresenzePranzoSelection === "function") {
            window.resetRegistroPresenzePranzoSelection();
        } else {
            window.selectedRegistroPresenzePranzo = "";
        }

        cvlsAlert("Uscita dal lavoro registrata con successo!", "Bollatura effettuata");

        updateUI();
        updatePageUI();
    }

    return {
        init: init,
        cleanup: cleanup,
        updateUI: updateUI,
        startPageTracking: startPageTracking,
        stopPageTracking: stopPageTracking,
        updatePageUI: updatePageUI,
        registraIngressoRegistroPresenze: registraIngressoRegistroPresenze,
        registraUscitaRegistroPresenze: registraUscitaRegistroPresenze,
        getActiveCheckin: getActiveCheckin
    };
})();

window.cvlsAggiornaOreViaggioRegistroPresenze = function() {
    const box = document.getElementById("regPresOreViaggioBox");
    const select = document.getElementById("regPresOreViaggioSelect");
    const help = document.getElementById("regPresOreViaggioHelp");

    if (!box || !select || !help) return;

    if (select.options.length === 0) {
        for (let m = 0; m <= 23 * 60 + 30; m += 30) {
            const h = Math.floor(m / 60);
            const min = m % 60;
            let label = "";
            if (h === 0 && min === 0) label = "0 ore";
            else if (h === 0) label = min + " min";
            else if (min === 0) label = h + (h === 1 ? " ora" : " ore");
            else label = h + (h === 1 ? " ora " : " ore ") + min + " min";

            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = label;
            select.appendChild(opt);
        }
    }

    const activeCheckin = window.CvlsGeobollatura.getActiveCheckin();
    if (!activeCheckin || !activeCheckin.time) {
        box.classList.add("reg-pres-ore-viaggio-disabled");
        select.disabled = true;
        select.value = "0";
        help.textContent = "Selezionabile dopo la bollatura di ingresso";
    } else {
        box.classList.remove("reg-pres-ore-viaggio-disabled");
        select.disabled = false;
        help.textContent = "Seleziona le ore viaggio della giornata";

        let oreViaggioMin = 0;
        try {
            const ingressoDate = new Date(activeCheckin.time);
            const pad = (n) => String(n).padStart(2, "0");
            const dateStr = ingressoDate.getFullYear() + "-" + pad(ingressoDate.getMonth() + 1) + "-" + pad(ingressoDate.getDate());

            if (window.CvlsReperibilita && typeof window.CvlsReperibilita.getOreViaggioLocale === "function") {
                oreViaggioMin = window.CvlsReperibilita.getOreViaggioLocale(dateStr);
            }
        } catch(e) {}

        select.value = String(oreViaggioMin);
    }
};

document.addEventListener("DOMContentLoaded", function() {
    const select = document.getElementById("regPresOreViaggioSelect");
    if (select) {
        select.addEventListener("change", function() {
            const activeCheckin = window.CvlsGeobollatura.getActiveCheckin();
            if (!activeCheckin || !activeCheckin.time) return;

            const val = Math.max(0, parseInt(this.value) || 0);
            if (val % 30 !== 0) return;

            const ingressoDate = new Date(activeCheckin.time);
            const pad = (n) => String(n).padStart(2, "0");
            const dateStr = ingressoDate.getFullYear() + "-" + pad(ingressoDate.getMonth() + 1) + "-" + pad(ingressoDate.getDate());

            try {
                if (window.CvlsReperibilita && typeof window.CvlsReperibilita.salvaOreViaggioLocale === "function") {
                    const success = window.CvlsReperibilita.salvaOreViaggioLocale(dateStr, val);
                    if (success) {
                        window.cvlsAggiornaOreViaggioRegistroPresenze();
                        if (typeof window.renderRegistroPresenzeList === "function") {
                            window.renderRegistroPresenzeList();
                        }
                    }
                }
            } catch(e) {}
        });
    }
});

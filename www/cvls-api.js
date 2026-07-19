/* =========================================================
   CVLS API CLIENT - SUPABASE PROVIDER
   ========================================================= */

const CVLS_APP_VERSION = "1.0";

// Converte e carica un file in formato Base64 nello storage bucket 'allegati' di Supabase
async function uploadFileToSupabaseStorage(syncId, base64Data, mimeType, filename) {
    const supabase = window.supabaseClient;
    
    // Converte base64 in Blob
    const byteCharacters = atob(base64Data.split(',')[1] || base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    // Nome file univoco nello storage bucket
    const fileExt = filename.split('.').pop();
    const uniqueName = `${syncId}_${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
        .from('allegati')
        .upload(uniqueName, blob, {
            contentType: mimeType,
            cacheControl: '3600',
            upsert: false
        });

    if (error) {
        console.error("Errore caricamento storage Supabase:", error);
        throw error;
    }

    // Ottieni URL pubblico del file caricato
    const { data: urlData } = supabase.storage
        .from('allegati')
        .getPublicUrl(uniqueName);

    return urlData.publicUrl;
}

// Applica una singola modifica in attesa sul database Supabase
async function applyPendingChangeToSupabase(change) {
    const supabase = window.supabaseClient;
    const type = change.type;
    const payload = change.payload || {};

    if (type === "ADD_CITTA") {
        const { error } = await supabase.from('citta').upsert({
            codice_citta: payload.CodiceCitta,
            nome: payload.NomeCitta
        }, { onConflict: 'codice_citta' });
        if (error) throw error;
    } 
    else if (type === "ADD_PRESIDIO") {
        const { error } = await supabase.from('presidi').upsert({
            codice_citta: payload.CodiceCitta,
            codice_presidio: payload.CodicePresidio,
            nome: payload.NomePresidio
        }, { onConflict: 'codice_citta,codice_presidio' });
        if (error) throw error;
    } 
    else if (type === "ADD_UBICAZIONE") {
        const { error } = await supabase.from('ubicazioni').upsert({
            codice_citta: payload.CodiceCitta,
            codice_presidio: payload.CodicePresidio,
            codice_ubicazione: payload.CodiceUbicazione,
            nome: payload.NomeUbicazione
        }, { onConflict: 'codice_citta,codice_presidio,codice_ubicazione' });
        if (error) throw error;
    } 
    else if (type === "ADD_DISPOSITIVO") {
        const { error } = await supabase.from('dispositivi').upsert({
            codice_completo: payload.CodiceCompleto,
            codice_citta: payload.CodiceCitta,
            codice_presidio: payload.CodicePresidio,
            codice_ubicazione: payload.CodiceUbicazione,
            codice_dispositivo: payload.CodiceDispositivo,
            nome: payload.NomeDispositivo,
            tipo_dispositivo: payload.TipoProgramma,
            nome_citta: payload.NomeCitta,
            nome_presidio: payload.NomePresidio,
            nome_ubicazione: payload.NomeUbicazione,
            link_qr: payload.LinkQR || ""
        }, { onConflict: 'codice_completo' });
        if (error) throw error;
    } 
    else if (type === "SAVE_MACCHINA") {
        const { error } = await supabase.from('dispositivi').update({
            dati_tecnici: payload
        }).eq('codice_completo', change.deviceId);
        if (error) throw error;
    } 
    else if (type === "ADD_MANUTENZIONE") {
        const { error } = await supabase.from('manutenzioni').insert({
            codice_completo: change.deviceId,
            descrizione: payload.Descrizione || payload.descrizione,
            ore: Number(payload.Ore || payload.ore) || null,
            data: payload.Data || payload.data,
            tecnico: payload.Tecnico || payload.tecnico || localStorage.getItem("cvls_user_name")
        });
        if (error) throw error;
    } 
    else if (type === "ADD_NOTA") {
        const { error } = await supabase.from('note').insert({
            codice_completo: change.deviceId,
            contenuto: payload.Nota || payload.nota || payload.contenuto,
            tecnico: payload.Tecnico || payload.tecnico || localStorage.getItem("cvls_user_name"),
            data: payload.Data || payload.data
        });
        if (error) throw error;
    } 
    else if (type === "ADD_MATERIALE") {
        const { error } = await supabase.from('componenti').insert({
            codice_completo: change.deviceId,
            codice: payload.Codice || payload.codice,
            descrizione: payload.Descrizione || payload.descrizione,
            marca: payload.Marca || payload.marca,
            modello: payload.Modello || payload.modello,
            sn: payload.SN || payload.sn || payload.Sn,
            lotto: payload.Lotto || payload.lotto,
            note: payload.Note || payload.note
        });
        if (error) throw error;
    } 
    else if (type === "ADD_ALLEGATO") {
        let publicUrl = payload.linkFile;
        
        // Se il file non è ancora stato caricato e abbiamo i dati base64, lo carichiamo
        if (!publicUrl && payload.data) {
            publicUrl = await uploadFileToSupabaseStorage(
                payload.syncId, 
                payload.data, 
                payload.mimeType, 
                payload.nomeFile
            );
        }

        if (!publicUrl) {
            throw new Error("Impossibile caricare il file allegato: URL mancante.");
        }

        const { error } = await supabase.from('allegati').upsert({
            codice_completo: change.deviceId,
            sync_id: payload.syncId,
            local_file_id: payload.localFileId || "",
            nome_file: payload.nomeFile,
            nome_originale: payload.nomeOriginale || payload.nomeFile,
            mime_type: payload.mimeType,
            size_bytes: payload.size_bytes || 0,
            original_size_bytes: payload.original_size_bytes || 0,
            compressed: !!payload.compressed,
            link_file: publicUrl,
            note: payload.note || ""
        }, { onConflict: 'sync_id' });
        
        if (error) throw error;
        
        // Ritorna il link del file aggiornato per salvare nello stato locale
        return { syncId: payload.syncId, linkFile: publicUrl };
    } 
    else if (type === "ADD_TIPO_DISPOSITIVO") {
        const { error } = await supabase.from('tipi_dispositivo').upsert({
            id: payload.id,
            nome: payload.nome
        }, { onConflict: 'id' });
        if (error) throw error;
    }
    else if (type === "UPDATE_TIPO_DISPOSITIVO") {
        const { error } = await supabase.from('tipi_dispositivo').update({
            nome: payload.nome
        }).eq('id', payload.id);
        if (error) throw error;
    }
    else if (type === "REQUEST_DELETE_DISPOSITIVO" || type.startsWith("RICHIESTA_ELIMINAZIONE_")) {
        const recordType = payload.TipoRecord || (type === "REQUEST_DELETE_DISPOSITIVO" ? "dispositivo" : type.replace("RICHIESTA_ELIMINAZIONE_", "").toLowerCase());
        const { error } = await supabase.from('richieste_eliminazione').insert({
            codice_completo: payload.CodiceCompleto || "",
            tipo_record: recordType,
            record_key: payload.RecordKey || payload.CodiceCompleto,
            device_key_richiedente: payload.DeviceKeyRichiedente || "",
            nome_dispositivo: payload.NomeDispositivo || payload.DescrizioneRecord || "",
            stato: payload.Stato || "in_attesa"
        });
        if (error) throw error;
    }
    else if (type === "PROGRAMMA_MANUTENZIONE") {
        const { error } = await supabase.from('programmazioni').upsert({
            id: payload.id || payload.o2CalendarKey || `PM-${Date.now()}`,
            device_id: change.deviceId || payload.deviceId,
            codice_completo: payload.codiceCompleto || change.deviceId,
            data: payload.data,
            testo: payload.testo,
            tipo: payload.tipo || "dispositivo",
            tipo_programmazione: payload.tipoProgrammazione || "Manutenzione programmata",
            tipo_scadenza: payload.tipoScadenza || "",
            nome_dispositivo: payload.nomeDispositivo || payload.nome_dispositivo || "",
            codice_presidio: payload.codicePresidio || payload.codice_presidio || "",
            nome_presidio: payload.nomePresidio || payload.nome_presidio || "",
            nome_citta: payload.nomeCitta || payload.nome_citta || "",
            nome_ubicazione: payload.nomeUbicazione || payload.nome_ubicazione || "",
            tipologia_cella: payload.tipologiaCella || payload.tipologia_cella || "",
            codice_cella: payload.codiceCella || payload.codice_cella || "",
            mese_anno: payload.meseAnno || payload.mese_anno || "",
            o2_calendar_key: payload.o2CalendarKey || payload.o2_calendar_key || "",
            calendar_status: payload.calendarStatus || payload.calendar_status || "pending"
        });
        if (error) throw error;
    }
    else if (type === "ADD_BOLLATURA") {
        const toNullableInteger = function (value) {
            if (value === null || value === undefined || value === "") {
                return null;
            }

            const numberValue = Number(value);
            return Number.isFinite(numberValue)
                ? Math.round(numberValue)
                : null;
        };

        const { error } = await supabase.from('bollature').insert({
            tecnico: payload.tecnico || localStorage.getItem("cvls_user_name") || "Tecnico",
            codice_completo: payload.codice_completo || null,
            tipo_bollatura: payload.tipo_bollatura,
            orario: payload.orario,
            latitudine: payload.latitudine,
            longitudine: payload.longitudine,
            stato_gps: payload.stato_gps,
            nome_sede: payload.nome_sede || null,
            cantiere_nome: payload.cantiere_nome || null,
            citta_nome: payload.citta_nome || null,
            luoghi: Array.isArray(payload.luoghi) ? payload.luoghi : [],
            pausa_pranzo: payload.pausa_pranzo || null,
            pausa_pranzo_minuti: toNullableInteger(payload.pausa_pranzo_minuti),
            durata_lorda_minuti: toNullableInteger(payload.durata_lorda_minuti),
            totale_lavorato_minuti: toNullableInteger(payload.totale_lavorato_minuti),
            totale_lavorato_testo: payload.totale_lavorato_testo || null,
            totale_calcolato_minuti: toNullableInteger(payload.totale_calcolato_minuti),
            totale_calcolato_testo: payload.totale_calcolato_testo || null,
            ore_permesso_minuti: toNullableInteger(payload.ore_permesso_minuti),
            ore_permesso_testo: payload.ore_permesso_testo || null,
            regola_calcolo: payload.regola_calcolo || null
        });
        if (error) throw error;
    }
    else if (type === "ADD_CANTIERE") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        const { error } = await supabase.from('cantieri').upsert({
            nome: payload.nome,
            created_by: userId
        }, { onConflict: 'nome' });
        if (error) throw error;
    }
    else if (type === "ADD_CANTIERE_NOTE") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        const { error } = await supabase.from('cantiere_note').insert({
            cantiere_id: payload.cantiere_id,
            contenuto: payload.contenuto,
            spuntato: !!payload.spuntato,
            created_by: userId
        });
        if (error) throw error;
    }
    else if (type === "TOGGLE_CANTIERE_NOTE") {
        const { error } = await supabase.from('cantiere_note').update({
            spuntato: !!payload.spuntato
        }).eq('id', payload.id);
        if (error) throw error;
    }
    else if (type === "ADD_CANTIERE_ALLEGATO") {
        let publicUrl = payload.linkFile;
        if (!publicUrl && payload.data) {
            publicUrl = await uploadFileToSupabaseStorage(
                payload.syncId, 
                payload.data, 
                payload.mimeType, 
                payload.nomeFile
            );
        }
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        const { error } = await supabase.from('cantiere_allegati').insert({
            cantiere_id: payload.cantiere_id,
            nome_file: payload.nomeFile,
            mime_type: payload.mimeType,
            link_file: publicUrl,
            created_by: userId
        });
        if (error) throw error;
    }
    else if (type === "ADD_CANTIERE_MATERIALE") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        const { error } = await supabase.from('cantiere_materiali').insert({
            cantiere_id: payload.cantiere_id,
            codice: payload.codice,
            lotto: payload.lotto,
            created_by: userId
        });
        if (error) throw error;
    }
    else if (type === "ADD_SPESA") {
        let publicUrl = payload.linkFile;
        if (!publicUrl && payload.data) {
            publicUrl = await uploadFileToSupabaseStorage(
                payload.syncId, 
                payload.data, 
                payload.mimeType, 
                payload.nomeFile
            );
        }
        const { error } = await supabase.from('spese').insert({
            tecnico_id: payload.tecnico_id,
            data: payload.data,
            totale: Number(payload.totale),
            nota: payload.nota,
            link_scontrino: publicUrl
        });
        if (error) throw error;
    }
    else if (type === "ADD_RICHIESTA_MODIFICA") {
        const { error } = await supabase.from('richieste_modifica').insert({
            tipo_record: payload.tipo_record,
            record_key: payload.record_key,
            nuovi_dati: payload.nuovi_dati,
            richiedente_id: payload.richiedente_id,
            stato: payload.stato || "in_attesa"
        });
        if (error) throw error;
    }
    // -------------------------------------------------------
    // ORE VIAGGIO
    // -------------------------------------------------------
    else if (type === "SAVE_ORE_VIAGGIO") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        if (!userId) throw new Error("Utente non autenticato");
        const { error } = await supabase.from('registro_giornaliero').upsert({
            user_id: userId,
            data: payload.data,
            ore_viaggio_minuti: Number(payload.ore_viaggio_minuti) || 0,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,data' });
        if (error) throw error;
    }
    else if (type === "DELETE_ORE_VIAGGIO") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        if (!userId) throw new Error("Utente non autenticato");
        const { error } = await supabase.from('registro_giornaliero')
            .delete()
            .eq('user_id', userId)
            .eq('data', payload.data);
        if (error) throw error;
    }
    // -------------------------------------------------------
    // PERIODI REPERIBILITÀ
    // -------------------------------------------------------
    else if (type === "SAVE_REP_PERIODO") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        if (!userId) throw new Error("Utente non autenticato");
        const localId = String(payload.id || "").trim();
        const { error } = await supabase.from('reperibilita_periodi').upsert({
            id:          localId,
            user_id:     userId,
            data_inizio: payload.data_inizio,
            data_fine:   payload.data_fine,
            updated_at:  new Date().toISOString()
        }, { onConflict: 'id' });
        if (error) throw error;
    }
    else if (type === "DELETE_REP_PERIODO") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        if (!userId) throw new Error("Utente non autenticato");
        const localId = String(payload.id || "").trim();
        if (!localId) return;
        const { error } = await supabase.from('reperibilita_periodi')
            .delete()
            .eq('id', localId)
            .eq('user_id', userId);
        if (error) throw error;
    }
    // -------------------------------------------------------
    // INTERVENTI REPERIBILITÀ
    // -------------------------------------------------------
    else if (type === "SAVE_REP_INTERVENTO") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        if (!userId) throw new Error("Utente non autenticato");
        const localId = String(payload.id || "").trim();
        const { error } = await supabase.from('reperibilita_interventi').upsert({
            id:                localId,
            user_id:           userId,
            data:              payload.data,
            ora_chiamata:      payload.ora_chiamata || null,
            ora_partenza:      payload.ora_partenza || null,
            durata_minuti:     Number(payload.durata_minuti) || 0,
            codice_citta:      payload.codice_citta || "",
            codice_presidio:   payload.codice_presidio || "",
            codice_ubicazione: payload.codice_ubicazione || "",
            nome_presidio:     payload.nome_presidio || "",
            nome_ubicazione:   payload.nome_ubicazione || "",
            numero_rit:        payload.numero_rit || "",
            updated_at:        new Date().toISOString()
        }, { onConflict: 'id' });
        if (error) throw error;
    }
    else if (type === "DELETE_REP_INTERVENTO") {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user ? user.id : null;
        if (!userId) throw new Error("Utente non autenticato");
        const localId = String(payload.id || "").trim();
        if (!localId) return;
        const { error } = await supabase.from('reperibilita_interventi')
            .delete()
            .eq('id', localId)
            .eq('user_id', userId);
        if (error) throw error;
    }
}

// Scarica l'intero database da Supabase e lo formatta come si aspetta l'app
async function fetchCompleteDatabaseFromSupabase(expectedUserId) {
    const supabase = window.supabaseClient;

    // Verifica identità pre-download
    const { data: { user: userPre } } = await supabase.auth.getUser();
    if (!userPre) {
        throw new Error("Utente non autenticato durante il download dei dati");
    }
    if (expectedUserId && userPre.id !== expectedUserId) {
        throw new Error("Disallineamento utente durante il download dei dati");
    }
    const userId = userPre.id;

    // Eseguiamo query in parallelo per velocizzare
    const [
        { data: citta },
        { data: presidi },
        { data: ubicazioni },
        { data: dispositivi },
        { data: manutenzioni },
        { data: note },
        { data: componenti },
        { data: allegati },
        { data: richieste_el },
        { data: tipi_dispositivo },
        { data: programmazioni },
        { data: cantieri },
        { data: cantiere_note },
        { data: cantiere_allegati },
        { data: cantiere_materiali },
        { data: spese },
        { data: richieste_modifica },
        // TODO FASE 2: filtrare anche bollature per user_id dopo migrazione schema
        { data: bollature },
        res_registro_giornaliero,
        res_reperibilita_periodi,
        res_reperibilita_interventi
    ] = await Promise.all([
        supabase.from('citta').select('*'),
        supabase.from('presidi').select('*'),
        supabase.from('ubicazioni').select('*'),
        supabase.from('dispositivi').select('*'),
        supabase.from('manutenzioni').select('*').order('data', { ascending: false }),
        supabase.from('note').select('*').order('data', { ascending: false }),
        supabase.from('componenti').select('*'),
        supabase.from('allegati').select('*'),
        supabase.from('richieste_eliminazione').select('*'),
        supabase.from('tipi_dispositivo').select('*'),
        supabase.from('programmazioni').select('*'),
        supabase.from('cantieri').select('*').order('nome'),
        supabase.from('cantiere_note').select('*').order('created_at', { ascending: true }),
        supabase.from('cantiere_allegati').select('*').order('created_at', { ascending: true }),
        supabase.from('cantiere_materiali').select('*').order('created_at', { ascending: true }),
        supabase.from('spese').select('*').order('data', { ascending: false }),
        supabase.from('richieste_modifica').select('*').order('created_at', { ascending: false }),
        supabase.from('bollature')
            .select('*')
            .eq('tecnico', String(localStorage.getItem("cvls_user_name") || "").trim())
            .order('orario', { ascending: false }),
        supabase.from('registro_giornaliero')
            .select('*')
            .eq('user_id', userId)
            .order('data', { ascending: false }),
        supabase.from('reperibilita_periodi')
            .select('*')
            .eq('user_id', userId)
            .order('data_inizio', { ascending: false }),
        supabase.from('reperibilita_interventi')
            .select('*')
            .eq('user_id', userId)
            .order('data', { ascending: false })
    ]);

    // Verifica identità post-query
    const { data: { user: userPost } } = await supabase.auth.getUser();
    if (!userPost || userPost.id !== userId) {
        throw new Error("Identità utente cambiata durante il download dei dati");
    }
    if (expectedUserId && userPost.id !== expectedUserId) {
        throw new Error("Disallineamento utente dopo il download dei dati");
    }

    if (res_registro_giornaliero.error) throw res_registro_giornaliero.error;
    if (res_reperibilita_periodi.error) throw res_reperibilita_periodi.error;
    if (res_reperibilita_interventi.error) throw res_reperibilita_interventi.error;

    const registro_giornaliero = res_registro_giornaliero.data;
    const reperibilita_periodi = res_reperibilita_periodi.data;
    const reperibilita_interventi = res_reperibilita_interventi.data;

    // Formatta anagrafica
    const formattedCitta = (citta || []).map(c => ({
        CodiceCitta: c.codice_citta,
        NomeCitta: c.nome
    }));

    const formattedPresidi = (presidi || []).map(p => ({
        CodiceCitta: p.codice_citta,
        CodicePresidio: p.codice_presidio,
        NomePresidio: p.nome,
        Latitudine: p.latitudine,
        Longitudine: p.longitudine,
        RaggioMetri: p.raggio_metri || 200
    }));

    const formattedUbicazioni = (ubicazioni || []).map(u => ({
        CodiceCitta: u.codice_citta,
        CodicePresidio: u.codice_presidio,
        CodiceUbicazione: u.codice_ubicazione,
        NomeUbicazione: u.nome
    }));

    const formattedDispositivi = (dispositivi || []).map(d => ({
        ID: d.id,
        CodiceCompleto: d.codice_completo,
        CodiceCitta: d.codice_citta,
        CodicePresidio: d.codice_presidio,
        CodiceUbicazione: d.codice_ubicazione,
        CodiceDispositivo: d.codice_dispositivo,
        NomeDispositivo: d.nome,
        TipoProgramma: d.tipo_dispositivo,
        LinkQR: d.link_qr || "",
        NomeCitta: d.nome_citta || "",
        NomePresidio: d.nome_presidio || "",
        NomeUbicazione: d.nome_ubicazione || ""
    }));

    // Formatta dati_tecnici dei dispositivi (macchine in app.js)
    const formattedMacchine = {};
    (dispositivi || []).forEach(d => {
        formattedMacchine[d.codice_completo] = d.dati_tecnici || {};
    });

    // Formatta tabelle collegate per dispositivo
    const formattedManutenzioni = {};
    (manutenzioni || []).forEach(m => {
        if (!formattedManutenzioni[m.codice_completo]) {
            formattedManutenzioni[m.codice_completo] = [];
        }
        formattedManutenzioni[m.codice_completo].push({
            id: m.id,
            descrizione: m.descrizione,
            ore: m.ore,
            data: m.data,
            tecnico: m.tecnico
        });
    });

    const formattedNote = {};
    (note || []).forEach(n => {
        if (!formattedNote[n.codice_completo]) {
            formattedNote[n.codice_completo] = [];
        }
        formattedNote[n.codice_completo].push({
            id: n.id,
            nota: n.contenuto,
            data: n.data,
            tecnico: n.tecnico
        });
    });

    const formattedMateriali = {};
    (componenti || []).forEach(c => {
        if (!formattedMateriali[c.codice_completo]) {
            formattedMateriali[c.codice_completo] = [];
        }
        formattedMateriali[c.codice_completo].push({
            id: c.id,
            codice: c.codice,
            descrizione: c.descrizione,
            marca: c.marca,
            modello: c.modello,
            sn: c.sn,
            lotto: c.lotto,
            note: c.note
        });
    });

    const formattedAllegati = {};
    (allegati || []).forEach(a => {
        if (!formattedAllegati[a.codice_completo]) {
            formattedAllegati[a.codice_completo] = [];
        }
        formattedAllegati[a.codice_completo].push({
            syncId: a.sync_id,
            localFileId: a.local_file_id || "",
            nomeFile: a.nome_file,
            nomeOriginale: a.nome_originale || a.nome_file,
            mimeType: a.mime_type,
            sizeBytes: a.size_bytes,
            originalSizeBytes: a.original_size_bytes,
            compressed: a.compressed,
            linkFile: a.link_file,
            note: a.note || "",
            dataCaricamento: a.created_at
        });
    });

    const formattedBollature = (bollature || []).map(b => ({
        id: b.id,
        tecnico: b.tecnico,
        codice_completo: b.codice_completo || null,
        tipo_bollatura: b.tipo_bollatura,
        orario: b.orario,
        latitudine: b.latitudine,
        longitudine: b.longitudine,
        stato_gps: b.stato_gps,
        nome_sede: b.nome_sede || "",
        cantiere_nome: b.cantiere_nome || "",
        citta_nome: b.citta_nome || "",
        luoghi: Array.isArray(b.luoghi) ? b.luoghi : [],
        pausa_pranzo: b.pausa_pranzo || "",
        pausa_pranzo_minuti: b.pausa_pranzo_minuti,
        durata_lorda_minuti: b.durata_lorda_minuti,
        totale_lavorato_minuti: b.totale_lavorato_minuti,
        totale_lavorato_testo: b.totale_lavorato_testo || "",
        totale_calcolato_minuti: b.totale_calcolato_minuti,
        totale_calcolato_testo: b.totale_calcolato_testo || "",
        ore_permesso_minuti: b.ore_permesso_minuti,
        ore_permesso_testo: b.ore_permesso_testo || "",
        regola_calcolo: b.regola_calcolo || ""
    }));

    // Formatta richieste di eliminazione suddivise per tipo
    const richiesteDispositivi = [];
    const richiesteManutenzioni = [];
    const richiesteNote = [];
    const richiesteMateriali = [];
    const richiesteAllegati = [];
    const richiesteTipiDispositivo = [];

    (richieste_el || []).forEach(r => {
        const req = {
            IDRichiesta: r.id,
            CodiceCompleto: r.codice_completo,
            TipoRecord: r.tipo_record,
            RecordKey: r.record_key,
            DeviceKeyRichiedente: r.device_key_richiedente,
            NomeDispositivo: r.nome_dispositivo,
            Stato: r.stato
        };
        if (r.tipo_record === 'dispositivo') {
            richiesteDispositivi.push(req);
        } else if (r.tipo_record === 'manutenzione') {
            richiesteManutenzioni.push(req);
        } else if (r.tipo_record === 'nota') {
            richiesteNote.push(req);
        } else if (r.tipo_record === 'materiale') {
            richiesteMateriali.push(req);
        } else if (r.tipo_record === 'allegato') {
            richiesteAllegati.push(req);
        } else if (r.tipo_record === 'tipo_dispositivo') {
            richiesteTipiDispositivo.push(req);
        }
    });

    // Formatta programmazioni
    const formattedProgrammazioni = (programmazioni || []).map(p => ({
        id: p.id,
        deviceId: p.device_id,
        codiceCompleto: p.codice_completo,
        data: p.data,
        testo: p.testo,
        tipo: p.tipo,
        tipoProgrammazione: p.tipo_programmazione,
        tipoScadenza: p.tipo_scadenza,
        nomeDispositivo: p.nome_dispositivo,
        codicePresidio: p.codice_presidio,
        nomePresidio: p.nome_presidio,
        nomeCitta: p.nome_citta,
        nomeUbicazione: p.nome_ubicazione,
        tipologiaCella: p.tipologia_cella,
        codiceCella: p.codice_cella,
        meseAnno: p.mese_anno,
        o2CalendarKey: p.o2_calendar_key,
        createdAt: p.created_at,
        calendarStatus: p.calendar_status
    }));

    // Formatta tipi_dispositivo
    const formattedTipiDispositivo = (tipi_dispositivo || []).map(t => ({
        id: t.id,
        nome: t.nome
    }));

    return {
        citta: formattedCitta,
        presidi: formattedPresidi,
        ubicazioni: formattedUbicazioni,
        dispositivi: formattedDispositivi,
        macchine: formattedMacchine,
        manutenzioni: formattedManutenzioni,
        note: formattedNote,
        materiali: formattedMateriali,
        allegati: formattedAllegati,
        bollature: formattedBollature,
        richiesteEliminazione: richiesteDispositivi,
        richiesteEliminazioneManutenzioni: richiesteManutenzioni,
        richiesteEliminazioneNote: richiesteNote,
        richiesteEliminazioneMateriali: richiesteMateriali,
        richiesteEliminazioneAllegati: richiesteAllegati,
        richiesteEliminazioneTipiDispositivo: richiesteTipiDispositivo,
        tipiDispositivo: formattedTipiDispositivo,
        programmazioni: formattedProgrammazioni,
        cantieri: cantieri || [],
        cantiereNote: cantiere_note || [],
        cantiereAllegati: cantiere_allegati || [],
        cantiereMateriali: cantiere_materiali || [],
        spese: spese || [],
        richiesteModifica: richieste_modifica || [],
        oreViaggio: (registro_giornaliero || []).map(function(r) {
            return {
                id: r.id,
                data: r.data,
                ore_viaggio_minuti: Number(r.ore_viaggio_minuti) || 0
            };
        }),
        reperibilita_periodi: (reperibilita_periodi || []).map(function(p) {
            return {
                id: p.id,
                data_inizio: p.data_inizio,
                data_fine: p.data_fine
            };
        }),
        reperibilita_interventi: (reperibilita_interventi || []).map(function(i) {
            return {
                id: i.id,
                data: i.data,
                ora_chiamata: i.ora_chiamata || null,
                ora_partenza: i.ora_partenza || null,
                durata_minuti: Number(i.durata_minuti) || 0,
                codice_citta: i.codice_citta || "",
                codice_presidio: i.codice_presidio || "",
                codice_ubicazione: i.codice_ubicazione || "",
                nome_presidio: i.nome_presidio || "",
                nome_ubicazione: i.nome_ubicazione || "",
                numero_rit: i.numero_rit || ""
            };
        })
    };
}

async function cvlsPreparePendingForApi(pending) {
    const changes = Array.isArray(pending) ? pending : [];
    const prepared = [];

    for (const change of changes) {
        const copy = JSON.parse(JSON.stringify(change || {}));

        if (copy.type === "ADD_ALLEGATO") {
            await cvlsAttachLocalFileDataToChange(copy);
        }

        prepared.push(copy);
    }

    return prepared;
}

async function cvlsAttachLocalFileDataToChange(change) {
    const payload = change.payload || {};
    change.payload = payload;

    const linkFile = String(payload.linkFile || "").trim();
    const existingData = String(payload.data || "").trim();

    if (linkFile || existingData) {
        return;
    }

    const localFileId = String(
        payload.localFileId ||
        change.localFileId ||
        ""
    ).trim();

    if (!localFileId) {
        throw new Error("Allegato locale senza localFileId.");
    }

    if (
        !window.CvlsLocalAttachments ||
        typeof window.CvlsLocalAttachments.getAttachment !== "function" ||
        typeof window.CvlsLocalAttachments.blobToDataUrl !== "function"
    ) {
        throw new Error("Archivio locale allegati non disponibile.");
    }

    const record = await window.CvlsLocalAttachments.getAttachment(localFileId);

    if (!record || !record.blob) {
        throw new Error("File locale allegato non trovato: " + localFileId);
    }

    const dataUrl = await window.CvlsLocalAttachments.blobToDataUrl(record.blob);

    payload.data = dataUrl;
    payload.mimeType = payload.mimeType || record.mimeType || "application/octet-stream";
    payload.nomeFile = payload.nomeFile || record.nomeFile || "Allegato";
    payload.nomeOriginale = payload.nomeOriginale || record.nomeOriginale || payload.nomeFile;
    payload.sizeBytes = payload.sizeBytes || record.sizeBytes || 0;
    payload.originalSizeBytes = payload.originalSizeBytes || record.originalSizeBytes || payload.sizeBytes || 0;
}

async function cvlsCleanupConfirmedLocalAttachments(originalPending, result) {
    if (
        !window.CvlsLocalAttachments ||
        typeof window.CvlsLocalAttachments.deleteAttachment !== "function"
    ) {
        return;
    }

    const confirmedIds = Array.isArray(result && result.confirmedChangeIds)
        ? result.confirmedChangeIds
        : [];

    if (confirmedIds.length === 0) {
        return;
    }

    const confirmedMap = {};

    confirmedIds.forEach(function (changeId) {
        confirmedMap[String(changeId || "").trim()] = true;
    });

    const pending = Array.isArray(originalPending) ? originalPending : [];

    for (const change of pending) {
        if (!change || change.type !== "ADD_ALLEGATO") {
            continue;
        }

        const changeId = String(change.changeId || "").trim();

        if (!changeId || !confirmedMap[changeId]) {
            continue;
        }

        const payload = change.payload || {};
        const localFileId = String(
            payload.localFileId ||
            change.localFileId ||
            ""
        ).trim();

        if (localFileId) {
            try {
                await window.CvlsLocalAttachments.deleteAttachment(localFileId);
            } catch (error) {
                console.warn(
                    "Impossibile eliminare allegato locale confermato:",
                    error
                );
            }
        }
    }
}

window.CvlsApi = {
    baseUrl: "",

    ping: async function () {
        return { ok: true, message: "pong" };
    },

    requestAuthorization: async function (payload) {
        return { ok: true, stato: "autorizzato" };
    },

    checkAuthorization: async function (payload) {
        return { ok: true, stato: "autorizzato" };
    },

    syncDatabase: async function (payload) {
        const originalPending = Array.isArray(payload.pending)
            ? payload.pending
            : [];

        const pendingForApi = await cvlsPreparePendingForApi(originalPending);
        const confirmedChangeIds = [];

        const total = pendingForApi.length;
        const attachmentsTotal = pendingForApi.filter(c => c.type === "ADD_ALLEGATO").length;
        let attachmentsCurrent = 0;
        let currentIndex = 0;

        // Elabora ciascun cambiamento sequenzialmente su Supabase
        for (const change of pendingForApi) {
            currentIndex++;
            const isAttachment = change.type === "ADD_ALLEGATO";
            if (isAttachment) {
                attachmentsCurrent++;
            }

            // Notifica l'interfaccia dell'avanzamento reale
            if (typeof window.cvlsOnSyncProgressUpdate === "function") {
                window.cvlsOnSyncProgressUpdate({
                    total: total,
                    current: currentIndex,
                    isAttachment: isAttachment,
                    attachmentsTotal: attachmentsTotal,
                    attachmentsCurrent: attachmentsCurrent,
                    nomeFile: isAttachment ? (change.payload && change.payload.nomeOriginale) : "",
                    type: change.type,
                    nomeOggetto: (change.payload && (change.payload.nome || change.payload.Nome || change.payload.descrizione || change.payload.CodiceCompleto)) || ""
                });
            }

            try {
                const result = await applyPendingChangeToSupabase(change);
                
                // Se si tratta di un allegato, aggiorniamo il link temporaneo nello stato locale
                if (change.type === "ADD_ALLEGATO" && result && result.linkFile) {
                    change.payload.linkFile = result.linkFile;
                    // Notifica l'app del completamento del singolo allegato per salvarlo localmente
                    if (typeof window.onAndroidAttachmentSynced === "function") {
                        window.onAndroidAttachmentSynced(JSON.stringify({
                            syncId: result.syncId,
                            deviceId: change.deviceId,
                            linkFile: result.linkFile,
                            nomeFile: change.payload.nomeFile,
                            nomeOriginale: change.payload.nomeOriginale,
                            mimeType: change.payload.mimeType,
                            note: change.payload.note
                        }));
                    }
                }

                confirmedChangeIds.push(change.changeId);
            } catch (error) {
                console.error("Errore durante l'elaborazione del pending:", JSON.stringify(change), error ? (error.message || JSON.stringify(error)) : "Sconosciuto");
                // In caso di errore ci fermiamo, ritornando quello che siamo riusciti a confermare finora
                await cvlsCleanupConfirmedLocalAttachments(originalPending, { confirmedChangeIds });
                return {
                    ok: false,
                    confirmedChangeIds: confirmedChangeIds,
                    message: "Errore salvataggio modifica: " + (error ? (error.message || JSON.stringify(error)) : "Errore")
                };
            }
        }

        // Pulisce gli allegati locali confermati dal DB locale IndexedDB
        await cvlsCleanupConfirmedLocalAttachments(originalPending, { confirmedChangeIds });

        // Scarica i dati freschi da Supabase
        if (typeof window.cvlsOnSyncProgressUpdate === "function") {
            window.cvlsOnSyncProgressUpdate({
                total: total,
                current: total,
                isAttachment: false,
                type: "DOWNLOAD_DB",
                nomeOggetto: "Scaricamento database aggiornato..."
            });
        }

        try {
            const data = await fetchCompleteDatabaseFromSupabase();
            return {
                ok: true,
                confirmedChangeIds: confirmedChangeIds,
                data: data
            };
        } catch (error) {
            console.error("Errore fetch database dopo sync:", error);
            return {
                ok: false,
                confirmedChangeIds: confirmedChangeIds,
                message: "Errore recupero dati: " + error.message
            };
        }
    }
};
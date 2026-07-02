/* =========================================================
   CVLS SUPABASE INITIALIZATION & WRAPPERS
   ========================================================= */

const SUPABASE_URL = "https://pucnnjirnyjihofbkllp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uwk_fJ0NDi4XKoo5h1j-Fw_204EHAIB";

// Inizializza il client Supabase caricato via CDN
const { createClient } = supabase;
window.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper per ottenere l'utente corrente
async function getSupabaseUser() {
    const { data: { user }, error } = await window.supabaseClient.auth.getUser();
    if (error) {
        console.error("Errore recupero utente Supabase:", error);
        return null;
    }
    return user;
}

// Helper per ottenere il profilo dell'utente loggato (nome tecnico e ruolo)
async function getSupabaseProfile(userId) {
    if (!userId) return null;
    const { data, error } = await window.supabaseClient
        .from('profili')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) {
        console.error("Errore recupero profilo:", error);
        return null;
    }
    return data;
}

// Esporta le funzioni globalmente per essere usate in app.js
window.CvlsSupabase = {
    url: SUPABASE_URL,
    client: window.supabaseClient,
    getUser: getSupabaseUser,
    getProfile: getSupabaseProfile,

    getAllTechnicians: async function() {
        const { data, error } = await window.supabaseClient
            .from('profili')
            .select('*')
            .eq('ruolo', 'tecnico')
            .order('nome_tecnico');
        if (error) throw error;
        return data;
    },

    updateTechnicianLocation: async function(userId, name, lat, lon, radius) {
        const { data, error } = await window.supabaseClient
            .from('profili')
            .update({
                bollatura_nome_sede: name,
                bollatura_latitudine: parseFloat(lat),
                bollatura_longitudine: parseFloat(lon),
                bollatura_raggio: parseFloat(radius)
            })
            .eq('id', userId);
        if (error) throw error;
        return true;
    },

    login: async function(email, password) {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });
        if (error) throw error;
        return data;
    },

    logout: async function() {
        const { error } = await window.supabaseClient.auth.signOut();
        if (error) throw error;
        return true;
    }
};

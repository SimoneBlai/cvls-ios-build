-- ============================================================
-- MIGRAZIONE: Ore viaggio e Reperibilità
-- Branch: feature/reperibilita-ore-viaggio
-- ============================================================
-- DA ESEGUIRE MANUALMENTE su Supabase SQL Editor.
-- Non eseguire con l'app, da terminale o da deploy automatici.
-- ============================================================

-- ------------------------------------------------------------
-- 1. registro_giornaliero
-- Contiene le ore viaggio giornaliere inserite manualmente.
-- Un record per (user_id, data): upsert per modificare/azzerare.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registro_giornaliero (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data date NOT NULL,
    ore_viaggio_minuti integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT registro_giornaliero_user_data_unique UNIQUE (user_id, data),
    CONSTRAINT registro_giornaliero_ore_viaggio_non_negative CHECK (ore_viaggio_minuti >= 0)
);

ALTER TABLE public.registro_giornaliero ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "registro_giornaliero_select_own" ON public.registro_giornaliero;
CREATE POLICY "registro_giornaliero_select_own"
    ON public.registro_giornaliero FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "registro_giornaliero_insert_own" ON public.registro_giornaliero;
CREATE POLICY "registro_giornaliero_insert_own"
    ON public.registro_giornaliero FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "registro_giornaliero_update_own" ON public.registro_giornaliero;
CREATE POLICY "registro_giornaliero_update_own"
    ON public.registro_giornaliero FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "registro_giornaliero_delete_own" ON public.registro_giornaliero;
CREATE POLICY "registro_giornaliero_delete_own"
    ON public.registro_giornaliero FOR DELETE
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. reperibilita_periodi
-- Registra i periodi di reperibilità (data inizio / fine).
-- Un utente può avere periodi sovrapposti (gestiti lato app).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reperibilita_periodi (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data_inizio date NOT NULL,
    data_fine date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reperibilita_periodi_date_check CHECK (data_fine >= data_inizio),
    CONSTRAINT reperibilita_periodi_durata_valida CHECK ( ((data_fine - data_inizio) + 1) >= 7 AND ((data_fine - data_inizio) + 1) % 7 = 0 )
);

ALTER TABLE public.reperibilita_periodi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reperibilita_periodi_select_own" ON public.reperibilita_periodi;
CREATE POLICY "reperibilita_periodi_select_own"
    ON public.reperibilita_periodi FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reperibilita_periodi_insert_own" ON public.reperibilita_periodi;
CREATE POLICY "reperibilita_periodi_insert_own"
    ON public.reperibilita_periodi FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reperibilita_periodi_update_own" ON public.reperibilita_periodi;
CREATE POLICY "reperibilita_periodi_update_own"
    ON public.reperibilita_periodi FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reperibilita_periodi_delete_own" ON public.reperibilita_periodi;
CREATE POLICY "reperibilita_periodi_delete_own"
    ON public.reperibilita_periodi FOR DELETE
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. reperibilita_interventi
-- Registra gli interventi di reperibilità.
-- Presidio e ubicazione conservano codici + nomi (fotografia
-- storica) e sono selezionati dagli archivi presidi/ubicazioni.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reperibilita_interventi (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data date NOT NULL,
    ora_chiamata time,
    ora_partenza time,
    durata_minuti integer NOT NULL DEFAULT 0,
    codice_citta text NOT NULL DEFAULT '',
    codice_presidio text NOT NULL DEFAULT '',
    codice_ubicazione text NOT NULL DEFAULT '',
    nome_presidio text NOT NULL DEFAULT '',
    nome_ubicazione text NOT NULL DEFAULT '',
    numero_rit text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reperibilita_interventi_durata_non_negative CHECK (durata_minuti >= 0)
);

ALTER TABLE public.reperibilita_interventi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reperibilita_interventi_select_own" ON public.reperibilita_interventi;
CREATE POLICY "reperibilita_interventi_select_own"
    ON public.reperibilita_interventi FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "reperibilita_interventi_insert_own" ON public.reperibilita_interventi;
CREATE POLICY "reperibilita_interventi_insert_own"
    ON public.reperibilita_interventi FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reperibilita_interventi_update_own" ON public.reperibilita_interventi;
CREATE POLICY "reperibilita_interventi_update_own"
    ON public.reperibilita_interventi FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reperibilita_interventi_delete_own" ON public.reperibilita_interventi;
CREATE POLICY "reperibilita_interventi_delete_own"
    ON public.reperibilita_interventi FOR DELETE
    USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Trigger per updated_at automatico (le tre tabelle)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registro_giornaliero_updated_at ON public.registro_giornaliero;
CREATE TRIGGER trg_registro_giornaliero_updated_at
    BEFORE UPDATE ON public.registro_giornaliero
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reperibilita_periodi_updated_at ON public.reperibilita_periodi;
CREATE TRIGGER trg_reperibilita_periodi_updated_at
    BEFORE UPDATE ON public.reperibilita_periodi
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reperibilita_interventi_updated_at ON public.reperibilita_interventi;
CREATE TRIGGER trg_reperibilita_interventi_updated_at
    BEFORE UPDATE ON public.reperibilita_interventi
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

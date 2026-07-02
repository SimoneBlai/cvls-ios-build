-- ==========================================
-- SCHEMA DATABASE SUPABASE PER APP CVLS (AGGIORNATO)
-- Copia e incolla questo script nel SQL Editor di Supabase.
-- ATTENZIONE: Questo script elimina le tabelle esistenti per ricrearle con i campi legacy corretti.
-- ==========================================

-- Rimozione tabelle precedenti per aggiornamento schema
drop table if exists public.bollature cascade;
drop table if exists public.richieste_eliminazione cascade;
drop table if exists public.allegati cascade;
drop table if exists public.componenti cascade;
drop table if exists public.note cascade;
drop table if exists public.manutenzioni cascade;
drop table if exists public.dispositivi cascade;
drop table if exists public.ubicazioni cascade;
drop table if exists public.presidi cascade;
drop table if exists public.citta cascade;
drop table if exists public.profili cascade;

-- 1. Tabella profili utenti per gestire i ruoli (admin / tecnico)
create table public.profili (
  id uuid references auth.users on delete cascade primary key,
  nome_tecnico text not null,
  ruolo text check (ruolo in ('tecnico', 'admin')) not null default 'tecnico',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Abilita RLS sui profili
alter table public.profili enable row level security;

-- Policy RLS sui profili
create policy "I profili sono visibili da tutti gli utenti autenticati" 
  on public.profili for select to authenticated using (true);

create policy "Gli utenti possono modificare solo il proprio profilo" 
  on public.profili for update to authenticated using (auth.uid() = id);

-- 2. Tabelle Anagrafiche Territoriali con codici gerarchici
create table public.citta (
  id uuid primary key default gen_random_uuid(),
  codice_citta text unique not null, -- Es. "01"
  nome text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.presidi (
  id uuid primary key default gen_random_uuid(),
  codice_citta text not null,
  codice_presidio text not null, -- Es. "01"
  nome text not null,
  latitudine double precision,
  longitudine double precision,
  raggio_metri double precision default 200, -- per geofencing bollatura
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(codice_citta, codice_presidio)
);

create table public.ubicazioni (
  id uuid primary key default gen_random_uuid(),
  codice_citta text not null,
  codice_presidio text not null,
  codice_ubicazione text not null, -- Es. "001"
  nome text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(codice_citta, codice_presidio, codice_ubicazione)
);

-- 3. Tabella Dispositivi (Sensore O2, Dispositivo IDGM, ecc.)
create table public.dispositivi (
  id uuid primary key default gen_random_uuid(),
  codice_completo text unique not null, -- Es. "0101001001" (10 cifre)
  codice_citta text not null,
  codice_presidio text not null,
  codice_ubicazione text not null,
  codice_dispositivo text not null,
  nome text not null,
  tipo_dispositivo text not null,
  link_qr text,
  nome_citta text,
  nome_presidio text,
  nome_ubicazione text,
  dati_tecnici jsonb default '{}'::jsonb, -- Contiene Marca, Modello, Matricola, Anno, Lotto, Alimentazione, kW, Portata, Altro/Note
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Tabelle Operative (Manutenzioni, Note, Componenti, Allegati)
create table public.manutenzioni (
  id uuid primary key default gen_random_uuid(),
  codice_completo text not null, -- Si collega a dispositivi.codice_completo
  descrizione text not null,
  ore numeric(10, 2),
  data date not null default current_date,
  tecnico text, -- Nome del tecnico
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.note (
  id uuid primary key default gen_random_uuid(),
  codice_completo text not null, -- Si collega a dispositivi.codice_completo
  contenuto text not null,
  tecnico text, -- Nome del tecnico
  data date not null default current_date,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.componenti (
  id uuid primary key default gen_random_uuid(),
  codice_completo text not null, -- Si collega a dispositivi.codice_completo
  codice text, -- Codice del materiale
  descrizione text not null,
  marca text,
  modello text,
  sn text,
  lotto text,
  note text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.allegati (
  id uuid primary key default gen_random_uuid(),
  codice_completo text not null, -- Si collega a dispositivi.codice_completo
  sync_id text unique not null,
  local_file_id text,
  nome_file text not null,
  nome_originale text,
  mime_type text,
  size_bytes numeric,
  original_size_bytes numeric,
  compressed boolean default false,
  link_file text not null, -- URL dell'allegato nel bucket Supabase Storage
  note text,
  data_caricamento timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Tabella Richieste Eliminazione (per flusso approvazione Admin)
create table public.richieste_eliminazione (
  id uuid primary key default gen_random_uuid(),
  codice_completo text not null,
  tipo_record text check (tipo_record in ('dispositivo', 'manutenzione', 'nota', 'materiale', 'allegato')) not null,
  record_key text not null, -- id del record o chiave identificativa
  device_key_richiedente text not null, -- identificativo dell'utente/sessione
  nome_dispositivo text,
  stato text check (stato in ('in_attesa', 'autorizzato', 'rifiutato', 'eseguito')) not null default 'in_attesa',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tabella Bollature Geolocalizzate (Check-in / Check-out)
create table public.bollature (
  id uuid primary key default gen_random_uuid(),
  tecnico text not null,
  codice_completo text, -- Si riferisce al dispositivo su cui si lavora
  tipo_bollatura text check (tipo_bollatura in ('ingresso', 'uscita')) not null,
  orario timestamp with time zone default timezone('utc'::text, now()) not null,
  latitudine double precision not null,
  longitudine double precision not null,
  stato_gps text not null -- 'in_zona', 'fuori_zona_sbloccata'
);

-- ==========================================
-- ABILITAZIONE ROW LEVEL SECURITY (RLS) GENERALIZZATA
-- ==========================================

alter table public.citta enable row level security;
alter table public.presidi enable row level security;
alter table public.ubicazioni enable row level security;
alter table public.dispositivi enable row level security;
alter table public.manutenzioni enable row level security;
alter table public.note enable row level security;
alter table public.componenti enable row level security;
alter table public.allegati enable row level security;
alter table public.richieste_eliminazione enable row level security;
alter table public.bollature enable row level security;

-- Policy di lettura/scrittura per utenti autenticati
create policy "Accesso totale utenti autenticati" on public.citta for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.presidi for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.ubicazioni for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.dispositivi for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.manutenzioni for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.note for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.componenti for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.allegati for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.richieste_eliminazione for all to authenticated using (true) with check (true);
create policy "Accesso totale utenti autenticati" on public.bollature for all to authenticated using (true) with check (true);

-- ==========================================
-- TRIGGER PER PROFILO UTENTE AUTOMATICO
-- ==========================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profili (id, nome_tecnico, ruolo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome_tecnico', new.email),
    coalesce(new.raw_user_meta_data->>'ruolo', 'tecnico')
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==========================================
-- CONFIGURAZIONE STORAGE BUCKETS E RLS POLICIES
-- ==========================================

-- 1. Assicurati che il bucket 'allegati' esista come pubblico
insert into storage.buckets (id, name, public)
values ('allegati', 'allegati', true)
on conflict (id) do nothing;

-- 2. Policy per consentire l'inserimento/caricamento di file nel bucket 'allegati' da utenti autenticati
create policy "Consenti inserimento file nel bucket allegati ad utenti autenticati"
on storage.objects for insert
to authenticated
with check (bucket_id = 'allegati');

-- 3. Policy per consentire la lettura pubblica dei file nel bucket 'allegati'
create policy "Consenti lettura pubblica dei file nel bucket allegati"
on storage.objects for select
to public
using (bucket_id = 'allegati');

-- 4. Policy per consentire l'eliminazione dei file nel bucket 'allegati' ad utenti autenticati
create policy "Consenti eliminazione file nel bucket allegati ad utenti autenticati"
on storage.objects for delete
to authenticated
using (bucket_id = 'allegati');

-- 5. Policy per consentire l'aggiornamento dei file nel bucket 'allegati' ad utenti autenticati
create policy "Consenti aggiornamento file nel bucket allegati ad utenti autenticati"
on storage.objects for update
to authenticated
using (bucket_id = 'allegati')
with check (bucket_id = 'allegati');

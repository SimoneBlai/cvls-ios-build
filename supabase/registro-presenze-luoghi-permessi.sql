begin;

alter table public.bollature
  add column if not exists luoghi jsonb;

alter table public.bollature
  add column if not exists ore_permesso_minuti integer;

alter table public.bollature
  add column if not exists ore_permesso_testo text;

update public.bollature
set luoghi = '[]'::jsonb
where luoghi is null;

alter table public.bollature
  alter column luoghi set default '[]'::jsonb;

alter table public.bollature
  alter column luoghi set not null;

comment on column public.bollature.luoghi is
  'Elenco JSON delle coppie presidio/ubicazione associate alla bollatura.';

comment on column public.bollature.ore_permesso_minuti is
  'Minuti di permesso calcolati quando il totale giornaliero e inferiore a 8 ore.';

comment on column public.bollature.ore_permesso_testo is
  'Rappresentazione leggibile delle ore di permesso, ad esempio 0h 45m.';

commit;

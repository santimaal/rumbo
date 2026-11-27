-- Fecha de la última vez que alguien abrió cada viaje, para borrar los que llevan un año sin uso.
alter table public.viajes add column if not exists leido timestamptz not null default now();

create or replace function public.leer_viaje(p_id text)
returns table (datos jsonb, version integer) language sql security definer set search_path = public as $$
  update viajes set leido = now() where id = p_id returning datos, version;
$$;

revoke all on function public.leer_viaje(text) from public;
grant execute on function public.leer_viaje(text) to anon, authenticated;

create extension if not exists pg_cron;

-- Cada noche, a las 4:00 UTC, se borran los viajes que nadie ha abierto ni cambiado en un año.
select cron.schedule(
  'borrar-viajes-sin-uso',
  '0 4 * * *',
  $$delete from public.viajes where greatest(actualizado, leido) < now() - interval '1 year'$$
);

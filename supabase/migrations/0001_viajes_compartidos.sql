-- Viajes compartidos. Nadie puede listar ni leer la tabla directamente:
-- solo a través de estas funciones y conociendo el código del viaje.
create table public.viajes (
  id text primary key,
  datos jsonb not null,
  version integer not null default 1,
  actualizado timestamptz not null default now()
);
alter table public.viajes enable row level security;

create or replace function public.crear_viaje(p_datos jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare nuevo text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  if octet_length(p_datos::text) > 200000 then raise exception 'Viaje demasiado grande'; end if;
  insert into viajes (id, datos) values (nuevo, p_datos);
  return nuevo;
end $$;

create or replace function public.leer_viaje(p_id text)
returns table (datos jsonb, version integer) language sql security definer set search_path = public as $$
  select datos, version from viajes where id = p_id;
$$;

-- Guarda solo si nadie lo ha cambiado desde la versión que se tenía; si no, devuelve null.
create or replace function public.guardar_viaje(p_id text, p_datos jsonb, p_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare nueva integer;
begin
  if octet_length(p_datos::text) > 200000 then raise exception 'Viaje demasiado grande'; end if;
  update viajes set datos = p_datos, version = version + 1, actualizado = now()
   where id = p_id and version = p_version
   returning version into nueva;
  return nueva;
end $$;

revoke all on function public.crear_viaje(jsonb), public.leer_viaje(text), public.guardar_viaje(text, jsonb, integer) from public;
grant execute on function public.crear_viaje(jsonb), public.leer_viaje(text), public.guardar_viaje(text, jsonb, integer) to anon, authenticated;

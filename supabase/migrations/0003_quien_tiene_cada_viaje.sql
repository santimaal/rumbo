-- Qué móviles tienen cada viaje compartido. Cuando el último lo borra (al vaciar su papelera), el viaje se
-- borra también de aquí. Cada móvil se identifica con el código aleatorio que ya usa en la presencia.
create table public.viajes_miembros (
  viaje text not null references public.viajes (id) on delete cascade,
  dispositivo text not null,
  visto timestamptz not null default now(),
  primary key (viaje, dispositivo)
);
alter table public.viajes_miembros enable row level security;

-- Apunta este móvil como uno de los que tienen el viaje (o renueva la fecha si ya lo estaba).
create function public.unirse_viaje(p_id text, p_dispositivo text)
returns void language sql security definer set search_path = public as $$
  insert into viajes_miembros (viaje, dispositivo)
  select p_id, p_dispositivo
   where p_dispositivo ~ '^[0-9a-f-]{36}$' and exists (select 1 from viajes where id = p_id)
  on conflict (viaje, dispositivo) do update set visto = now();
$$;

-- Este móvil deja el viaje; si ya no lo tiene nadie, se borra. Devuelve true si se ha borrado.
create function public.dejar_viaje(p_id text, p_dispositivo text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from viajes_miembros where viaje = p_id and dispositivo = p_dispositivo;
  if exists (select 1 from viajes_miembros where viaje = p_id) then return false; end if;
  delete from viajes where id = p_id;
  return found;
end $$;

revoke all on function public.unirse_viaje(text, text), public.dejar_viaje(text, text) from public;
grant execute on function public.unirse_viaje(text, text), public.dejar_viaje(text, text) to anon, authenticated;

-- M0 · Cimientos: perfiles de usuario y helpers comunes.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- Criterio de seguridad (igual que en Vector-One, donde funcionó bien):
-- RLS activo y SIN políticas en todas las tablas. Solo el backend, con la
-- llave service_role, lee y escribe; cada route handler valida la sesión y
-- el rol del usuario antes de tocar la base.

-- ---------------------------------------------------------------------------
-- 1. Helper: updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Perfiles: espejo de auth.users con el rol de la aplicación
-- ---------------------------------------------------------------------------
-- Roles:
--   admin      → todo, incluida la administración de usuarios.
--   planner    → maestros y planificación (el "usuario" de V1, renombrado).
--   comprador  → solo lectura hoy; en Fase 3 registra sus compras.
--
-- `activo = false` bloquea el acceso sin borrar la cuenta: la sesión sigue
-- existiendo en Auth pero el guard del backend la rechaza.
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  rol text not null default 'planner'
    constraint perfiles_rol_check check (rol in ('admin', 'planner', 'comprador')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists perfiles_email_uniq on public.perfiles (lower(email));

drop trigger if exists set_updated_at on public.perfiles;
create trigger set_updated_at before update on public.perfiles
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.perfiles enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Primer administrador
-- ---------------------------------------------------------------------------
-- El usuario se crea en Authentication → Users (o con la API admin). Esta
-- sentencia le da el rol admin a quien ya exista en auth.users con ese correo
-- y no tenga perfil todavía. Cambia el correo si hace falta.
insert into public.perfiles (id, email, nombre, rol)
select u.id, u.email, 'Javier Pérez', 'admin'
from auth.users u
where lower(u.email) = lower('jperezalbela@jeruth.pe')
on conflict (id) do nothing;

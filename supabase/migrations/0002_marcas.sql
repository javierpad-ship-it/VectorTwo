-- M2 · Agrupaciones de marca y marcas.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN `DROP`. A diferencia de `0001`, los triggers se declaran con
-- `create or replace trigger` (Postgres ≥ 14), que ya es idempotente por sí
-- solo. Motivo: las migraciones se aplican con `execute_sql` del MCP de
-- Supabase y cualquier `DROP` se queda esperando una confirmación que nunca
-- llega. `0001` ya está aplicada y no se toca.
--
-- Convenciones (ver docs/modulos/02-marcas.md § Modelo de datos), las mismas
-- que en el árbol de producto:
--   * `nombre` llega ya normalizado desde el backend (NFC, trim, mayúsculas
--     en español): `levi's` → `LEVI'S`. La base solo exige longitud 1–120.
--   * `codigo` es un identificador corto ASCII (`LEVI'S` → `LEVI_S`, máximo
--     40), único sobre `upper(codigo)` para que `h` y `H` no convivan si
--     alguien lo escribe a mano en el SQL Editor.
--   * Marca → agrupación es `on delete restrict`: la acción normal es
--     desactivar; eliminar una agrupación solo cuando tiene 0 marcas (activas
--     o no). El handler traduce la violación de FK (23503) a un 409 legible.
--   * Desactivar una agrupación NO se propaga: una marca es vigente si
--     marca.activo ∧ agrupacion.activo (`marcaVigente` en la aplicación), así
--     reactivar la agrupación devuelve sus marcas tal cual estaban.
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Agrupaciones de marca (catálogo plano y ABIERTO, lo edita el admin)
-- ---------------------------------------------------------------------------
-- Misma estructura que `generos` y `mundos` para reutilizar sin cambios los
-- esquemas y el helper de catálogos del backend. A diferencia de
-- `agrupaciones_talla` se puede crear, renombrar, reordenar, desactivar y
-- eliminar desde pantalla: los nombres que dio Javier todavía no son
-- oficiales (decisión "Agrupaciones de marca con mantenimiento", 2026-10-02).
create table if not exists public.agrupaciones_marca (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint agrupaciones_marca_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint agrupaciones_marca_nombre_len_check check (length(nombre) between 1 and 120),
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agrupaciones_marca_codigo_uniq on public.agrupaciones_marca (upper(codigo));
create unique index if not exists agrupaciones_marca_nombre_uniq on public.agrupaciones_marca (nombre);

create or replace trigger set_updated_at before update on public.agrupaciones_marca
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Marcas
-- ---------------------------------------------------------------------------
-- `nombre` es único GLOBAL y no por agrupación: una marca está en una sola
-- agrupación (dos filas `LEVI'S` en agrupaciones distintas serían un error de
-- carga, no dos marcas) y la Fase 2 resuelve cada fila de venta y stock por
-- nombre de marca, así que el nombre tiene que identificar una sola fila.
--
-- `agrupacion_marca_id` es obligatorio: no existe una agrupación comodín
-- "sin agrupar", por el mismo criterio que "toda línea tiene mundo". Las
-- filas de un archivo que vengan sin agrupación se omiten y se reportan.
--
-- `tratamiento_especial`: la marca se trata aparte al elaborar los flujos
-- (Fase 2, M8 define qué significa). `nota_tratamiento` explica POR QUÉ y
-- solo tiene sentido con la bandera encendida: una nota sin bandera no tiene
-- lectura posible y confundiría a quien filtre por tratamiento. La API borra
-- la nota al desmarcar la bandera; el check `marcas_nota_sin_tratamiento_check`
-- garantiza que nunca quede una nota huérfana aunque alguien escriba por el
-- SQL Editor. Es texto libre corto (≤ 200), no un catálogo de motivos: Javier
-- no ha dicho que haya tipos de tratamiento (pregunta abierta 6). El backend
-- guarda la nota recortada y convierte la cadena vacía en null, por eso el
-- check de longitud exige al menos 1 carácter cuando no es null.
create table if not exists public.marcas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint marcas_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint marcas_nombre_len_check check (length(nombre) between 1 and 120),
  agrupacion_marca_id uuid not null
    constraint marcas_agrupacion_marca_id_fkey
    references public.agrupaciones_marca(id) on delete restrict,
  tratamiento_especial boolean not null default false,
  nota_tratamiento text
    constraint marcas_nota_len_check
      check (nota_tratamiento is null or length(nota_tratamiento) between 1 and 200)
    constraint marcas_nota_sin_tratamiento_check
      check (nota_tratamiento is null or tratamiento_especial),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists marcas_codigo_uniq on public.marcas (upper(codigo));
create unique index if not exists marcas_nombre_uniq on public.marcas (nombre);

-- Filtro por agrupación en la pantalla y conteo de hijos antes de eliminar
-- una agrupación. No se indexa `tratamiento_especial`: son cientos de filas y
-- ese filtro se hace en memoria.
create index if not exists marcas_agrupacion_marca_id_idx on public.marcas (agrupacion_marca_id);

create or replace trigger set_updated_at before update on public.marcas
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Seed de agrupaciones de marca
-- ---------------------------------------------------------------------------
-- En el orden que dio Javier ("1 · 2 · 3 · 4 · 5" es `orden / 10`). Los
-- nombres van en mayúsculas normalizadas, como todo catálogo del árbol: si
-- se sembrara `Mid Value` y Javier lo editara desde la pantalla, el PATCH lo
-- devolvería como `MID VALUE` y parecería un error.
--
-- El único de `codigo` es un índice sobre la expresión `upper(codigo)`, así
-- que el objetivo del `on conflict` tiene que ser esa misma expresión. Solo
-- inserta lo que falta: si Javier renombra una agrupación, volver a aplicar
-- la migración NO lo revierte.
insert into public.agrupaciones_marca (codigo, nombre, orden) values
  ('ULTRA_LOW',  'ULTRA LOW',  10),
  ('MID_VALUE',  'MID VALUE',  20),
  ('VALOR',      'VALOR',      30),
  ('RECONOCIDO', 'RECONOCIDO', 40),
  ('PREMIUM',    'PREMIUM',    50)
on conflict ((upper(codigo))) do nothing;

-- ---------------------------------------------------------------------------
-- 4. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.agrupaciones_marca enable row level security;
alter table public.marcas enable row level security;

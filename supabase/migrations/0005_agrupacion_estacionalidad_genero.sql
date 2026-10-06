-- M3 (cambio de modelo) · Géneros de una agrupación de estacionalidad.
--
-- Javier: "las agrupaciones de estacionalidad tienen que poder asignarse a 1 o
-- más géneros". Interpretación acordada: cada agrupación pertenece a UNO O MÁS
-- géneros (relación muchos a muchos con `generos`) y solo puede recibir
-- equivalencias cuyo género (el del nodo género-mundo-línea de la equivalencia,
-- `equivalencias.genero_mundo_linea_id → genero_mundo_linea.genero_id`) esté
-- entre los suyos.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN `DROP`, `DELETE` ni `TRUNCATE`. Como en `0002`–`0004`, el trigger se
-- declara con `create or replace trigger` (Postgres ≥ 14), que ya es
-- idempotente por sí solo. Motivo: las migraciones se aplican con
-- `execute_sql` del MCP de Supabase y cualquier sentencia destructiva se queda
-- esperando una confirmación que nunca llega. `0000`–`0004` ya están aplicadas
-- y no se tocan.
--
-- Qué NO hace la base: la regla "la equivalencia solo entra en una agrupación
-- que incluye su género" cruza tres tablas (equivalencias → nodo → género y
-- agrupación → géneros) y no se puede expresar con un `check` ni con una FK
-- compuesta sin duplicar el género en `equivalencias`. La hace cumplir el
-- backend (asignación individual, masiva e importador) y la pantalla; esta
-- migración solo deja el dato y el backfill para que lo ya asignado cumpla la
-- regla desde el primer momento.

-- ---------------------------------------------------------------------------
-- 1. Agrupación ↔ género (tabla de relación)
-- ---------------------------------------------------------------------------
-- Sin columna `activo`: el vínculo existe o no existe. Quitarle un género a una
-- agrupación es borrar la fila (lo hace el backend, no esta migración); "apagar"
-- un vínculo no tendría un significado distinto de no tenerlo.
--
-- Las dos FK difieren a propósito:
--   * `agrupacion_estacionalidad_id` → `on delete cascade`. Los géneros de una
--     agrupación son un ATRIBUTO de ella, no datos con vida propia: si la
--     agrupación se elimina, sus vínculos se van con ella. Eliminarla ya está
--     protegido arriba: el handler solo deja eliminar agrupaciones sin
--     equivalencias (`equivalencias.agrupacion_estacionalidad_id` es
--     `on delete restrict`), así que el cascade nunca borra trabajo del planner,
--     solo la etiqueta de géneros de una agrupación vacía.
--   * `genero_id` → `on delete restrict`. El género es un catálogo raíz que
--     manda sobre el árbol (regla de M1: nada se elimina con hijos, se
--     desactiva). Un género con agrupaciones vinculadas no se puede borrar y
--     arrastrar en silencio la configuración de estacionalidad; el handler lo
--     traduce a un 409 como en el resto del árbol.
create table if not exists public.agrupacion_estacionalidad_genero (
  id uuid primary key default gen_random_uuid(),
  agrupacion_estacionalidad_id uuid not null
    constraint agrupacion_estacionalidad_genero_agrupacion_id_fkey
    references public.agrupaciones_estacionalidad(id) on delete cascade,
  genero_id uuid not null
    constraint agrupacion_estacionalidad_genero_genero_id_fkey
    references public.generos(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un género aparece una sola vez por agrupación. Con la agrupación al frente,
-- este único también cubre "¿qué géneros tiene esta agrupación?" (la lectura
-- más frecuente: el catálogo y la validación de cada asignación).
create unique index if not exists agrupacion_estacionalidad_genero_par_uniq
  on public.agrupacion_estacionalidad_genero (agrupacion_estacionalidad_id, genero_id);

-- Dirección inversa: "¿qué agrupaciones sirven a este género?" (filtro de los
-- `Select` de asignación) y la comprobación de FK al eliminar un género.
create index if not exists agrupacion_estacionalidad_genero_genero_id_idx
  on public.agrupacion_estacionalidad_genero (genero_id);

create or replace trigger set_updated_at before update on public.agrupacion_estacionalidad_genero
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Backfill: que toda asignación existente siga siendo válida
-- ---------------------------------------------------------------------------
-- Para cada equivalencia que ya tiene agrupación se registra el género de su
-- nodo como género de esa agrupación. Así, bajo la regla nueva, ninguna
-- asignación previa queda en una agrupación que no incluye su género.
--
-- Idempotente: `select distinct` colapsa los pares repetidos dentro de la
-- misma corrida y `on conflict do nothing` sobre el único hace que correrla de
-- nuevo no duplique ni falle. Tampoco hay `DELETE`: el backfill solo agrega, y
-- si el planner ya quitó un género a una agrupación sin equivalencias de ese
-- género, el backfill no lo resucita (solo agrega géneros que SÍ tienen
-- equivalencias asignadas, que son los que la regla obliga a conservar).
--
-- DECISIÓN: las agrupaciones que hoy NO tienen equivalencias quedan con CERO
-- géneros. No se les inventa ninguno (ni "todos los géneros", ni uno por
-- defecto): un género supuesto por nosotros escondería la decisión que
-- Javier tiene que tomar, igual que se descartó sembrar una agrupación
-- `GENERAL` en `0003`. La pantalla las marca "sin género" y, mientras no
-- tengan al menos uno, no aceptan asignaciones.
insert into public.agrupacion_estacionalidad_genero (agrupacion_estacionalidad_id, genero_id)
select distinct e.agrupacion_estacionalidad_id, n.genero_id
from public.equivalencias e
join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
where e.agrupacion_estacionalidad_id is not null
on conflict (agrupacion_estacionalidad_id, genero_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.agrupacion_estacionalidad_genero enable row level security;

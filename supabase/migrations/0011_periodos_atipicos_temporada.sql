-- M6 · Periodos atípicos y temporada de la agrupación de estacionalidad
-- (PASO 1 de la entrega en dos pasos de M6, versión 0.9.0).
--
-- ALCANCE DE ESTA MIGRACIÓN: solo lo que necesita el paso 1 ("mantenimiento"):
--   * la tabla `periodos_atipicos` (catálogo editable de meses atípicos, p. ej.
--     el Niño costero), que se puede usar antes de que exista ningún cálculo;
--   * la columna `agrupaciones_estacionalidad.temporada`, que decide a qué
--     agrupaciones afecta un periodo de alcance `invierno`.
-- NO crea todavía la vista materializada `venta_mensual_estacionalidad`, ni la
-- función `refrescar_venta_mensual_estacionalidad`, ni `corridas_estacionalidad`,
-- ni `curvas_estacionalidad`: son del PASO 2 (cálculo, versión 0.9.1) y se harán
-- en una migración posterior, `0012`. Se parten así para no dejar objetos sin
-- uso (y una vista materializada sin refrescar) mientras Javier solo mantiene el
-- catálogo.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN sentencias destructivas ni de modificación de datos: ni DROP, ni DELETE,
-- ni TRUNCATE, ni UPDATE. Motivo: las migraciones se aplican con `execute_sql`
-- del MCP de Supabase y cualquier sentencia destructiva se queda esperando una
-- confirmación que nunca llega. Sin backfill: la columna nueva lleva `default`.
--
-- Diseño (docs/modulos/06-curvas-estacionalidad.md § Modelo de datos):
--   * RLS activo y SIN políticas en la tabla nueva: solo entra el backend con
--     service_role.
--   * SIN seed: los meses del Niño los decide Javier (hito del paso 1).
--   * Todos los nombres de constraint e índice miden ≤ 63 caracteres (el
--     límite de identificadores de Postgres).

-- ---------------------------------------------------------------------------
-- 1. `agrupaciones_estacionalidad.temporada` (M3)
-- ---------------------------------------------------------------------------
-- Decidido por Javier el 2026-10-13: la temporada vive en la agrupación de
-- estacionalidad ("invierno, verano o toda temporada; las de invierno se
-- afectan por el Niño"). Tres valores en minúsculas con guion bajo (son
-- códigos, como `estado` en M5), distintos de las etiquetas de `lineas.temporada`
-- (`Verano` / `Invierno` / `Todo el año`, de M1): la agrupación NO hereda la
-- temporada de sus líneas, la fija el planner (el sistema solo la sugiere).
--
-- `not null default 'todo_el_ano'`: las agrupaciones existentes nacen como
-- "toda temporada", el valor NEUTRO al que ningún periodo de alcance `invierno`
-- afecta. No hace falta ningún `update` (y sería inventar una clasificación):
-- Javier marca las de invierno desde la pantalla. Si la columna ya existe,
-- `add column if not exists` omite también el check inline, así que repetir la
-- migración no duplica nada.
alter table public.agrupaciones_estacionalidad
  add column if not exists temporada text not null default 'todo_el_ano'
    constraint agrupaciones_estacionalidad_temporada_check
      check (temporada in ('invierno', 'verano', 'todo_el_ano'));

-- ---------------------------------------------------------------------------
-- 2. `periodos_atipicos` (catálogo editable, nunca meses fijos en el código)
-- ---------------------------------------------------------------------------
-- Cada fila es un rango de meses inclusive (`desde`, `hasta`, siempre primer día
-- del mes, como `cargas_venta_stock.periodo`) con un motivo corto ("Niño costero
-- 2023") y un alcance:
--   * `invierno` (por defecto): solo afecta a las agrupaciones con
--     `temporada = 'invierno'`, que es lo que Javier dijo del Niño;
--   * `todas`: afecta a todas las agrupaciones (una paralización, una pandemia,
--     un cierre masivo).
-- Pueden solaparse (se toma la unión) y pueden incluir meses futuros (un periodo
-- de 2026 declarado antes de cargar diciembre), por eso no hay únicos ni
-- comparación con la fecha actual. Sin FKs: nada cuelga de aquí (las corridas
-- del paso 2 guardan copia de los meses atípicos que usaron), así que no aplica
-- `on delete`.
--
-- `motivo` se guarda con `trim` pero SIN pasar a mayúsculas (es una etiqueta, no
-- un nombre de catálogo): por eso no hay único sobre él.
--
-- `activo` SÍ se usa aquí: desactivar un periodo lo saca del cálculo sin perder
-- el registro.
create table if not exists public.periodos_atipicos (
  id uuid primary key default gen_random_uuid(),
  -- Primer día del primer mes incluido.
  desde date not null
    constraint periodos_atipicos_desde_dia1_check
      check (extract(day from desde) = 1),
  -- Primer día del último mes incluido (inclusive).
  hasta date not null
    constraint periodos_atipicos_hasta_dia1_check
      check (extract(day from hasta) = 1),
  motivo text not null
    constraint periodos_atipicos_motivo_len_check
      check (length(motivo) between 1 and 120),
  descripcion text
    constraint periodos_atipicos_descripcion_len_check
      check (descripcion is null or length(descripcion) <= 500),
  alcance text not null default 'invierno'
    constraint periodos_atipicos_alcance_check
      check (alcance in ('invierno', 'todas')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un periodo no puede terminar antes de empezar (un solo mes: desde = hasta).
  constraint periodos_atipicos_rango_check check (hasta >= desde)
);

-- Solo por orden de lectura (la pantalla los lista por `desde`): la tabla tendrá
-- del orden de diez filas.
create index if not exists periodos_atipicos_desde_idx
  on public.periodos_atipicos (desde);

create or replace trigger set_updated_at before update on public.periodos_atipicos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
-- `agrupaciones_estacionalidad` ya lo tiene desde 0003; repetirlo es inocuo.
alter table public.periodos_atipicos enable row level security;

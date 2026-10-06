-- M3 · Agrupaciones de estacionalidad.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN `DROP`, `DELETE` ni `TRUNCATE`. Como en `0002`, el trigger se declara
-- con `create or replace trigger` (Postgres ≥ 14), que ya es idempotente por
-- sí solo. Motivo: las migraciones se aplican con `execute_sql` del MCP de
-- Supabase y cualquier sentencia destructiva se queda esperando una
-- confirmación que nunca llega. `0001` y `0002` ya están aplicadas y no se
-- tocan.
--
-- Convenciones (ver docs/modulos/03-agrupaciones-estacionalidad.md § Modelo
-- de datos), las mismas que en el árbol de producto y en marcas:
--   * `nombre` llega ya normalizado desde el backend (NFC, trim, mayúsculas
--     en español): `pantalones invierno` → `PANTALONES INVIERNO`. La base solo
--     exige longitud 1–120.
--   * `codigo` es un identificador corto ASCII derivado del nombre
--     (`PANTALONES_INVIERNO`, máximo 40), único sobre `upper(codigo)` para que
--     `h` y `H` no convivan si alguien lo escribe a mano en el SQL Editor. M6
--     lo usará para nombrar las curvas en exportaciones.
--   * `descripcion` es texto libre (≤ 500) que explica para qué sirve la
--     curva. NO se normaliza a mayúsculas; el backend la recorta y guarda la
--     cadena vacía como null, por eso aquí solo se limita la longitud.
--   * Equivalencia → agrupación es `on delete restrict`: la acción normal es
--     desactivar; eliminar una agrupación solo cuando tiene 0 equivalencias
--     (activas o no). El handler traduce la violación de FK (23503) a un 409
--     legible con el conteo.
--   * Desactivar una agrupación NO se propaga a sus equivalencias: conservan
--     el id, el reporte de faltantes las lista por "agrupación inactiva" y,
--     al reactivarla, vuelven a estar completas sin reasignar nada.
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Agrupaciones de estacionalidad (catálogo plano, lo mantiene el planner)
-- ---------------------------------------------------------------------------
-- Misma estructura que `generos`, `mundos` y `agrupaciones_marca` (más
-- `descripcion`) para reutilizar el helper de catálogos del backend. Cada
-- agrupación será, en la Fase 2 (M6), la unidad sobre la que se calcula una
-- curva de estacionalidad: muchas equivalencias venden poco y una curva propia
-- sería ruido, así que se agrupan bajo un nombre del negocio.
create table if not exists public.agrupaciones_estacionalidad (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint agrupaciones_estacionalidad_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint agrupaciones_estacionalidad_nombre_len_check check (length(nombre) between 1 and 120),
  descripcion text
    constraint agrupaciones_estacionalidad_descripcion_len_check
      check (descripcion is null or length(descripcion) <= 500),
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agrupaciones_estacionalidad_codigo_uniq
  on public.agrupaciones_estacionalidad (upper(codigo));
create unique index if not exists agrupaciones_estacionalidad_nombre_uniq
  on public.agrupaciones_estacionalidad (nombre);

create or replace trigger set_updated_at before update on public.agrupaciones_estacionalidad
  for each row execute function public.tg_set_updated_at();

-- SIN SEED. Los nombres de las agrupaciones son del negocio (Javier los define
-- con su equipo) y ninguna es necesaria para que el sistema funcione. Se
-- descartó sembrar una `GENERAL` por defecto: un comodín inventado termina
-- siendo el cajón donde cae todo y esconde justo la señal que M3 quiere dar
-- (el reporte de equivalencias sin curva). Decisión "Agrupaciones de
-- estacionalidad sin seed; nombres del negocio".

-- ---------------------------------------------------------------------------
-- 2. Equivalencias: asignación a una agrupación
-- ---------------------------------------------------------------------------
-- Una FK en `equivalencias` y no una tabla de relación: cada equivalencia
-- tiene EXACTAMENTE una curva (o ninguna). Una tabla aparte permitiría dos
-- curvas por equivalencia, que es justo lo que no queremos.
--
-- Nullable: una equivalencia nace sin agrupación y el reporte de faltantes la
-- persigue hasta que el planner se la asigne. La columna se agrega con
-- `add column if not exists`, así que las 1 956 equivalencias existentes
-- quedan con `null` y ninguna fila cambia de valor al aplicar esta migración.
alter table public.equivalencias
  add column if not exists agrupacion_estacionalidad_id uuid
    constraint equivalencias_agrupacion_estacionalidad_id_fkey
    references public.agrupaciones_estacionalidad(id) on delete restrict;

-- Responde "¿qué equivalencias tiene esta agrupación?": conteo por fila del
-- catálogo (y para rechazar el DELETE con 409), vista inversa de la pantalla
-- de asignación y, en M6, la agregación de venta por agrupación. No hay
-- índice parcial sobre `null`: el reporte de faltantes se calcula en memoria
-- sobre el estado completo del árbol porque necesita la vigencia del nodo
-- (género, mundo y línea activos), que no está en esta tabla.
create index if not exists equivalencias_agrupacion_estacionalidad_id_idx
  on public.equivalencias (agrupacion_estacionalidad_id);

-- ---------------------------------------------------------------------------
-- 3. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
-- `equivalencias` ya tiene RLS desde `0001`; repetirlo es inocuo.
alter table public.agrupaciones_estacionalidad enable row level security;
alter table public.equivalencias enable row level security;

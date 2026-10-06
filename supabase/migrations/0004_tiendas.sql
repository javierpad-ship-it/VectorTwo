-- M4 · Tiendas y aperturas.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN `DROP`, `DELETE` ni `TRUNCATE`. Como en `0002` y `0003`, el trigger se
-- declara con `create or replace trigger` (Postgres ≥ 14), que ya es
-- idempotente por sí solo. Motivo: las migraciones se aplican con
-- `execute_sql` del MCP de Supabase y cualquier sentencia destructiva se queda
-- esperando una confirmación que nunca llega. `0000`–`0003` ya están aplicadas
-- y no se tocan.
--
-- Convenciones (ver docs/modulos/04-tiendas.md § Modelo de datos):
--   * M4 es INDEPENDIENTE del árbol de producto y de las marcas: no hay FKs.
--     Ventas y stock por tienda (M5) colgarán de aquí más adelante.
--   * `codigo` es el código REAL de la tienda (`Cod.Tda` del archivo oficial:
--     `R401`, `RD50`), obligatorio y NO derivado del nombre: es el
--     identificador con el que llegarán las ventas y el stock, así que lo
--     escribe el usuario o lo trae el archivo. El backend lo pasa por
--     `aCodigo` (ASCII en mayúsculas, máximo 40); único sobre `upper(codigo)`
--     para que `r401` y `R401` no convivan si alguien lo escribe a mano en el
--     SQL Editor.
--   * `nombre` llega ya normalizado desde el backend (NFC, trim, mayúsculas
--     en español): `Lukers Iquitos Lores` → `LUKERS IQUITOS LORES`. Único
--     global; la base solo exige longitud 1–120.
--   * `zona` y `razon_social` son texto libre normalizado igual que `nombre`,
--     nulos si vienen vacíos. NO son catálogos todavía (hoy hay dos zonas y
--     dos razones sociales); la pantalla autocompleta con los valores ya
--     usados. Si la Fase 2 proyecta o reporta por zona, se promueven a
--     catálogo con FK en una migración posterior.
--   * El ESTADO de la tienda (Planificada · Activa · Cerrada) NO se guarda:
--     lo calcula el backend a partir de `fecha_apertura`, `fecha_cierre` y el
--     día de hoy en America/Lima. En V1 era una columna y las tiendas no
--     cambiaban de estado al abrir. `activo` es otra cosa: la fila está
--     vigente en el maestro. Una tienda que cerró conserva `activo = true`,
--     su `fecha_cierre` y su histórico.
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Tiendas y centros de distribución
-- ---------------------------------------------------------------------------
-- Una sola tabla para tiendas y CD, distinguidos por `tipo`. El modelo admite
-- varios CD aunque hoy haya uno (`RD50`). No existe relación tienda → CD que
-- abastece: V1 la tuvo y la eliminó porque con un solo CD no distinguía nada.
--
-- `tipo` es texto con `check` y no un enum: agregar un valor a un enum de
-- Postgres no es idempotente de forma sencilla y los tipos generados cambian
-- de forma. Un `check` sobre texto se reemplaza en una migración posterior
-- con `alter table … drop constraint if exists … add constraint`, como
-- `lineas.temporada`.
--
-- Fechas:
--   * `fecha_apertura`: primer día en que la tienda vende.
--   * `fecha_cierre`: ÚLTIMO día en que la tienda vende (inclusive). "Cerró el
--     31 de marzo" = vendió el 31; una tienda con cierre hoy sigue Activa hoy
--     y pasa a Cerrada mañana. M7 deja de proyectarla desde el día siguiente.
--   * El cierre exige apertura: un cierre sin apertura no dice nada a la
--     proyección (¿desde cuándo había venta?). Si la apertura de una tienda
--     vieja no se conoce con exactitud, se carga una aproximada.
--   * Cierre = apertura está permitido (abrió y cerró el mismo día).
--
-- `venta_esperada_promedio` son soles por mes (supuesto heredado de V1,
-- pregunta abierta 4 de la ficha). M7 la usará como escala para proyectar una
-- tienda Planificada sin histórico. No se restringe a las Planificadas (una
-- tienda recién abierta sigue sin histórico útil durante meses), pero sí se
-- rechaza en un centro de distribución: el CD no vende, es stock.
create table if not exists public.tiendas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint tiendas_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint tiendas_nombre_len_check check (length(nombre) between 1 and 120),
  tipo text not null default 'Tienda'
    constraint tiendas_tipo_check check (tipo in ('Tienda', 'Centro de Distribución')),
  zona text
    constraint tiendas_zona_len_check check (zona is null or length(zona) between 1 and 120),
  razon_social text
    constraint tiendas_razon_social_len_check
      check (razon_social is null or length(razon_social) between 1 and 120),
  fecha_apertura date,
  fecha_cierre date,
  venta_esperada_promedio numeric(14, 2)
    constraint tiendas_venta_no_negativa_check
      check (venta_esperada_promedio is null or venta_esperada_promedio >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Checks entre columnas, a nivel de tabla. El backend los valida antes con
  -- `motivoRechazoTienda` (400 con mensaje); estos son la red de seguridad.
  constraint tiendas_cierre_requiere_apertura_check
    check (fecha_cierre is null or fecha_apertura is not null),
  constraint tiendas_cierre_apertura_check
    check (fecha_cierre is null or fecha_cierre >= fecha_apertura),
  constraint tiendas_venta_solo_tienda_check
    check (venta_esperada_promedio is null or tipo = 'Tienda')
);

-- Solo los dos únicos. La tabla tiene del orden de una docena de filas;
-- los filtros por tipo, estado y zona se hacen en memoria.
create unique index if not exists tiendas_codigo_uniq
  on public.tiendas (upper(codigo));
create unique index if not exists tiendas_nombre_uniq
  on public.tiendas (nombre);

create or replace trigger set_updated_at before update on public.tiendas
  for each row execute function public.tg_set_updated_at();

-- SIN SEED. La lista oficial de tiendas (archivo *CODIGOS DE TIENDAS LUKERS*)
-- la entrega Javier o la carga por el importador; son datos reales de Lukers
-- y no van en el repo. El módulo queda usable con alta manual desde el primer
-- día. Decisión "Sin semilla de tiendas; sin relación tienda → CD".

-- ---------------------------------------------------------------------------
-- 2. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.tiendas enable row level security;

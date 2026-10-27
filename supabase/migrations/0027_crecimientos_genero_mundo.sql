-- M6 06d · Crecimiento del año siguiente por género x mundo, global y versionado (versión 0.12.1).
--
-- Ficha: docs/modulos/06d-curva-y-crecimiento-por-genero-mundo.md (§2 Modelo de datos).
-- Numeración: la ficha 08 nombra la 0025 (M8) y la 0026 (M9a); esta toma la 0027 (§2.5).
-- No hay conflicto técnico: depende de 0001 (géneros y mundos), 0003 (perfiles y
-- `tg_set_updated_at`), 0007 (cargas y `venta_stock_vigente`), 0015 (agrupaciones),
-- 0018 (proyecciones) y 0023 (`proyeccion_crecimientos`), todas anteriores.
--
-- Qué hace:
--   1. Tabla `crecimientos_genero_mundo`: una fila por VERSIÓN del crecimiento bruto
--      aprobado de un género x mundo (GM) o del Resto, por año de aplicación.
--   2. `proyeccion_crecimientos` pasa a ser la foto de lo aplicado: gana
--      `crecimiento_id` (FK a la versión usada) y `version`.
--   3. Función `venta_genero_mundo(p_desde date)`: la venta mensual por GM x
--      temporada x tienda que alimenta el análisis y las referencias de la pantalla.
--
-- Idempotente: `create table if not exists`, `add column if not exists` (que omite
-- también los checks y FK en línea si la columna ya existe), `create index if not
-- exists`, `create or replace trigger`, `create or replace function`,
-- `revoke`/`grant`/`comment` repetibles. Sin bloques `do $$ ... $$` (las comillas de
-- dólar del cuerpo de la función no son un bloque anónimo). SIN DROP, DELETE,
-- TRUNCATE ni UPDATE (tampoco dentro de la función) y SIN backfill: las migraciones
-- se aplican con `execute_sql` y esas sentencias se quedan esperando una confirmación
-- que nunca llega. Si hubiera celdas guardadas en `proyeccion_crecimientos`, no se
-- copian solas: Javier las aprueba en la pantalla (ficha §2.2).
--
-- Seguridad: RLS activo y SIN políticas; `revoke` a public, anon y authenticated y
-- `grant` a service_role (convención de 0013 a 0024). Solo entra el backend.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `crecimientos_genero_mundo` (una fila por versión)
-- ---------------------------------------------------------------------------
-- Nunca se borra una versión: aprobar una nueva pasa la vigente a `reemplazada` y
-- crea `max(version) + 1` de la clave (año, alcance, GM). Lo hace la API (sin función
-- SQL: las migraciones no admiten UPDATE ni dentro de una función).
--
-- `alcance` ('gm' | 'resto') y `base_tipo` ('acumulado', 'cierre_proyectado',
-- 'anio_completo', 'aplicado_hoy', 'ninguna') NO llevan `check` de catálogo: los
-- valida zod. Un alcance futuro (p. ej. por género) no puede exigir un `drop
-- constraint`, que las migraciones no admiten (mismo criterio que 0019, 0020 y 0024).
-- Lo que sí se cierra en la base es la FORMA: un `gm` lleva género y mundo; el `resto`
-- no lleva ninguno. Qué géneros son detallables (HOMBRE y MUJER) lo valida la API: un
-- `check` por nombre no cabe, el nombre vive en otra tabla.
--
-- `estado`: `retirada` entra desde ya aunque 0.12.1 no la use (igual que
-- `curvas_estacionalidad_estado_check` de 0015), para no tener que ampliar el
-- `check` después.
--
-- `pct` es el % BRUTO `Y+1 / Y - 1` de las mismas tiendas de Y+1, sin corregir por el
-- Niño. Mismo rango que `proyeccion_fila_anios.crecimiento_pct`.
--
-- `referencia` es la foto de lo que vio quien aprobó (cifras, tiendas, rebote, huella,
-- composición del GM y proyección de referencia): explica la versión sin releer venta.
--
-- Las FK a género y mundo son `restrict` (no se elimina un género o mundo con
-- crecimientos); las de proyección y perfil son `set null` (la versión sobrevive).
create table if not exists public.crecimientos_genero_mundo (
  id uuid primary key default gen_random_uuid(),
  anio_aplicacion integer not null
    constraint crecimientos_genero_mundo_anio_check
      check (anio_aplicacion between 2024 and 2100),
  alcance text not null,
  genero_id uuid
    constraint crecimientos_genero_mundo_genero_id_fkey
      references public.generos(id) on delete restrict,
  mundo_id uuid
    constraint crecimientos_genero_mundo_mundo_id_fkey
      references public.mundos(id) on delete restrict,
  version integer not null
    constraint crecimientos_genero_mundo_version_check check (version >= 1),
  estado text not null default 'vigente'
    constraint crecimientos_genero_mundo_estado_check
      check (estado in ('vigente', 'reemplazada', 'retirada')),
  pct numeric(6, 2) not null
    constraint crecimientos_genero_mundo_pct_check check (pct between -95 and 500),
  nota text
    constraint crecimientos_genero_mundo_nota_len_check
      check (nota is null or char_length(nota) <= 300),
  base_tipo text not null,
  base_valor numeric(8, 2),
  referencia jsonb not null
    constraint crecimientos_genero_mundo_referencia_check
      check (jsonb_typeof(referencia) = 'object'),
  proyeccion_referencia_id uuid
    constraint crecimientos_genero_mundo_proyeccion_referencia_id_fkey
      references public.proyecciones(id) on delete set null,
  perfil_id uuid
    constraint crecimientos_genero_mundo_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  aprobada_at timestamptz not null default now(),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Forma del alcance sin cerrar el catálogo: un alcance nuevo que no sea 'gm' ni
  -- 'resto' pasa estos dos checks sin tocarlos.
  constraint crecimientos_genero_mundo_gm_check
    check (alcance <> 'gm' or (genero_id is not null and mundo_id is not null)),
  constraint crecimientos_genero_mundo_resto_check
    check (alcance <> 'resto' or (genero_id is null and mundo_id is null))
);

-- Único por clave y versión. `genero_id` y `mundo_id` son nulos en el Resto y dos NULL
-- no chocan en un UNIQUE normal: por eso `coalesce` con el uuid cero, en vez de
-- `nulls not distinct`, que depende de la versión de Postgres.
create unique index if not exists crecimientos_genero_mundo_version_uniq
  on public.crecimientos_genero_mundo (
    anio_aplicacion,
    alcance,
    coalesce(genero_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(mundo_id, '00000000-0000-0000-0000-000000000000'::uuid),
    version
  );

-- Una sola vigente por GM y año (misma clave, sin `version`, solo `estado = 'vigente'`).
create unique index if not exists crecimientos_genero_mundo_vigente_uniq
  on public.crecimientos_genero_mundo (
    anio_aplicacion,
    alcance,
    coalesce(genero_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(mundo_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where estado = 'vigente';

-- Cubren las FK (`restrict` y `set null` recorrerían la tabla al eliminar un género,
-- un mundo, una proyección o un perfil; el advisor marca toda FK sin índice).
create index if not exists crecimientos_genero_mundo_genero_id_idx
  on public.crecimientos_genero_mundo (genero_id);
create index if not exists crecimientos_genero_mundo_mundo_id_idx
  on public.crecimientos_genero_mundo (mundo_id);
create index if not exists crecimientos_genero_mundo_proyeccion_referencia_id_idx
  on public.crecimientos_genero_mundo (proyeccion_referencia_id);
create index if not exists crecimientos_genero_mundo_perfil_id_idx
  on public.crecimientos_genero_mundo (perfil_id);

create or replace trigger set_updated_at before update on public.crecimientos_genero_mundo
  for each row execute function public.tg_set_updated_at();

comment on table public.crecimientos_genero_mundo is
  'M6 06d: crecimiento bruto del anio siguiente por genero x mundo (o Resto), global y versionado. Una fila por version; una sola vigente por (anio, alcance, GM). Nunca se borra una version. Todas las proyecciones leen la vigente (precedencia: % propio de la fila > GM vigente > Resto vigente > crecimiento_pct_defecto). Aprobar no escribe en ninguna proyeccion. Solo HOMBRE y MUJER se detallan (lo valida la API).';
comment on column public.crecimientos_genero_mundo.anio_aplicacion is
  'M6 06d: anio al que se aplica el % (Y+1, p. ej. 2027). Un supuesto por anio: el de 2028 se aprueba aparte.';
comment on column public.crecimientos_genero_mundo.alcance is
  'M6 06d: gm (lleva genero_id y mundo_id) o resto (todo lo no detallado; sin genero ni mundo). Sin check de catalogo a proposito: lo valida zod y un alcance futuro no exige drop constraint.';
comment on column public.crecimientos_genero_mundo.estado is
  'M6 06d: vigente (una por clave y anio), reemplazada (una version mas nueva la sustituye) o retirada (reservada; 0.12.1 no la usa). Igual que curvas_estacionalidad_estado_check.';
comment on column public.crecimientos_genero_mundo.pct is
  'M6 06d: variacion BRUTA Y+1 / Y - 1 (porcentaje) de las mismas tiendas de Y+1, sin corregir por el Nino. Rango -95..500, igual que proyeccion_crecimientos.pct.';
comment on column public.crecimientos_genero_mundo.base_tipo is
  'M6 06d: base con la que se aprobo: acumulado, cierre_proyectado, anio_completo, aplicado_hoy o ninguna. Sin check de catalogo: lo valida zod (BASES).';
comment on column public.crecimientos_genero_mundo.base_valor is
  'M6 06d: valor bruto-equivalente para Y+1 de la base elegida al aprobar. Nulo con base ninguna o si no era calculable. Sirve para la regla de nota (R-N) y para marcar la version como obsoleta.';
comment on column public.crecimientos_genero_mundo.referencia is
  'M6 06d: foto de lo que vio quien aprobo (cifras de referencia, tiendas y k, rebote, huella de datos, composicion del GM y proyeccion de referencia). Explica la version sin releer venta.';
comment on column public.crecimientos_genero_mundo.proyeccion_referencia_id is
  'M6 06d: proyeccion con la que se miro el cierre proyectado y el aplicado hoy. set null al eliminarla; la foto en referencia conserva su nombre y fecha.';
comment on column public.crecimientos_genero_mundo.perfil_id is
  'Quien aprobo la version (decision 33). aprobada_at dice cuando. set null al eliminar el perfil; usuario_nombre conserva el nombre.';
comment on column public.crecimientos_genero_mundo.activo is
  'Por convencion (PLAN 4); sin uso. Una version nunca se borra ni se desactiva: cambia de estado.';

-- ---------------------------------------------------------------------------
-- 2. `proyeccion_crecimientos` pasa a ser la foto de lo aplicado
-- ---------------------------------------------------------------------------
-- Desde 0.12.1 el planner ya no escribe estas filas: cada CÁLCULO de la proyección las
-- reescribe con los crecimientos por GM que usó (`pct`, `nota`, `perfil_id` y
-- `usuario_nombre` se copian de la versión global). `crecimiento_id` apunta a la
-- versión usada (`restrict`: no se borra una versión que una foto usa) y `version` la
-- repite para leerla sin join. Nulos = celda escrita en 0.10.8 (hoy 0 filas): vale
-- hasta el primer recálculo, que la reemplaza.
--
-- Si la columna ya existe, `add column if not exists` omite también el check y la FK
-- en línea, así que repetir la migración no los duplica. Sin default ni backfill.
alter table public.proyeccion_crecimientos
  add column if not exists crecimiento_id uuid
    constraint proyeccion_crecimientos_crecimiento_id_fkey
      references public.crecimientos_genero_mundo(id) on delete restrict;

alter table public.proyeccion_crecimientos
  add column if not exists version integer
    constraint proyeccion_crecimientos_version_check
      check (version is null or version >= 1);

-- Cubre la FK `restrict` (que no recorra la tabla al eliminar una versión).
create index if not exists proyeccion_crecimientos_crecimiento_id_idx
  on public.proyeccion_crecimientos (crecimiento_id);

comment on table public.proyeccion_crecimientos is
  'M6 06d (antes M7 07c): FOTO de los crecimientos por genero x mundo que uso el ultimo calculo de la proyeccion; la reescribe cada calculo desde crecimientos_genero_mundo (vigentes de Y+1). El Resto usado va en proyecciones.parametros.crecimiento_resto_usado. Filas con crecimiento_id nulo = celdas escritas en 0.10.8: valen hasta el primer recalculo.';
comment on column public.proyeccion_crecimientos.crecimiento_id is
  'M6 06d: version global (crecimientos_genero_mundo) de la que sale esta celda. Nulo = celda escrita en 0.10.8. on delete restrict: no se borra una version que una foto usa.';
comment on column public.proyeccion_crecimientos.version is
  'M6 06d: numero de version de la version global usada (copia de crecimientos_genero_mundo.version). Nulo = celda de 0.10.8.';

-- ---------------------------------------------------------------------------
-- 3. `venta_genero_mundo(p_desde date)`
-- ---------------------------------------------------------------------------
-- Devuelve, en UNA sola sentencia (un solo estado de los datos):
--
--   {
--     "series": [ { "g": genero_id, "m": mundo_id,
--                   "temp": "invierno|verano|todo_el_ano|sin_agrupacion",
--                   "t": tienda_id, "u": { "2023-01": 120, "2023-02": 98, ... } } ],
--     "cargas": { "2023-01": "<carga_id>", ... }
--   }
--
-- * Unidades netas (suma de `unidades`, sin filtrar signos), solo tiendas de tipo
--   `Tienda` (los centros de distribución no son venta), periodo >= p_desde. No se
--   filtra por `tiendas.activo` ni por `equivalencias.activo`: la red comparable la
--   decide el backend por fechas (M4) y los hechos de lo desactivado siguen siendo
--   historia del GM.
-- * El GM sale del ÁRBOL VIGENTE (`equivalencias -> genero_mundo_linea`): si un nodo
--   cambia de mundo, se lleva su historia. Cada equivalencia tiene un solo nodo, así
--   que ninguna venta se cuenta dos veces.
-- * La temporada es la de la agrupación ACTIVA de la equivalencia; sin agrupación o con
--   agrupación inactiva va como 'sin_agrupacion' (igual que la 0017; `left join`).
-- * `cargas`: sale del MISMO CTE `meses` que usa la 0017, dentro de la misma
--   sentencia: la huella de cargas que calcula el backend y la venta leída son del mismo
--   estado de los datos. Hay a lo sumo una carga publicada por periodo (índice único
--   parcial `cargas_periodo_publicada_uniq`).
--
-- PREAGREGACIÓN: primero se suma por (equivalencia, tienda, periodo) sobre
-- `venta_stock_vigente` y solo después se sube a GM x temporada. Así el `group by` caro
-- trabaja sobre ~870 mil filas una vez, con las claves más estrechas, y los joins con
-- el árbol y la agrupación se hacen sobre lo ya agregado (miles de filas, no cientos de
-- miles). Medido por el revisor: 1,94 s en la forma ingenua (el `sort` derrama ~28 MB)
-- frente a 1,63 s con la preagregación.
--
-- POR QUÉ `jsonb` Y NO `setof`: las series superan el corte de 1 000 filas de PostgREST
-- y paginar un `rpc` reejecutaría el agregado en cada página. Un `jsonb` viaja en una
-- sola respuesta. Orden determinista (`order by` dentro de `jsonb_agg`): mismos datos,
-- mismo documento (útil para las huellas).
--
-- MEDICIÓN en vector-two (2026-10-27, `p_desde = 2023-01-01`, 870 359 filas de
-- `venta_stock_vigente`, 45 meses publicados), `explain (analyze, timing off)` de
-- `select public.venta_genero_mundo('2023-01-01')`, dos pasadas seguidas:
--   * 1 507 ms y 1 471 ms (≈ 1,5 s; presupuesto <= 3 s en frío, techo duro 8 s).
--   * El agregado por (equivalencia, tienda, periodo) saca 245 434 filas desde
--     751 309 y derrama ~32 MB a disco (`work_mem` de 4 MB, 5 lotes): es la parte
--     cara (~0,8 s del total); el resto es construir el `jsonb`. Los joins con el
--     árbol y la agrupación (2 336 equivalencias, 590 nodos, 15 agrupaciones) van
--     por hash y son baratos. Plan: `venta_stock_mensual_pkey` solo índice
--     (`Heap Fetches: 0`), sin `seq scan` sobre la venta.
--   * Resultado: 609 series (GM x temporada x tienda), 19 213 celdas tienda x mes,
--     36 GM, 45 cargas, 0 celdas netas negativas; 386 812 bytes de texto
--     (553 422 bytes de `jsonb`, ~540 KB). Coincide con lo medido por el revisor.
--   * Plan B (`p_desde` = enero de Y-3): hoy no ahorra nada, los 45 meses
--     publicados empiezan en 2023-01. Queda como palanca si la historia crece.
--
-- `stable`, `security invoker` y `search_path` vacío (todo calificado con esquema): la
-- ejecuta solo el backend (`service_role`); el `revoke` quita el acceso por `rpc` a
-- `anon` y `authenticated`. El cuerpo va sin comentarios `--` (el SQL Editor de
-- Supabase los parsea mal dentro de `$$`).
create or replace function public.venta_genero_mundo(p_desde date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with por_equivalencia as (
    select
      v.equivalencia_id,
      v.tienda_id,
      v.periodo,
      sum(v.unidades)::bigint as unidades
    from public.venta_stock_vigente v
    join public.tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda'
    where v.periodo >= p_desde
    group by v.equivalencia_id, v.tienda_id, v.periodo
  ),
  celdas as (
    select
      n.genero_id,
      n.mundo_id,
      coalesce(a.temporada, 'sin_agrupacion') as temporada,
      p.tienda_id,
      p.periodo,
      sum(p.unidades)::bigint as unidades
    from por_equivalencia p
    join public.equivalencias e on e.id = p.equivalencia_id
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
    left join public.agrupaciones_estacionalidad a
      on a.id = e.agrupacion_estacionalidad_id
     and a.activo
    group by n.genero_id, n.mundo_id, coalesce(a.temporada, 'sin_agrupacion'), p.tienda_id, p.periodo
  ),
  series as (
    select
      c.genero_id,
      c.mundo_id,
      c.temporada,
      c.tienda_id,
      jsonb_object_agg(to_char(c.periodo, 'YYYY-MM'), c.unidades order by c.periodo) as u
    from celdas c
    group by c.genero_id, c.mundo_id, c.temporada, c.tienda_id
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
  )
  select jsonb_build_object(
    'series',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'g', s.genero_id,
                    'm', s.mundo_id,
                    'temp', s.temporada,
                    't', s.tienda_id,
                    'u', s.u
                  )
                  order by s.genero_id, s.mundo_id, s.temporada, s.tienda_id
                )
           from series s),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_genero_mundo(date) from public, anon, authenticated;
grant execute on function public.venta_genero_mundo(date) to service_role;

comment on function public.venta_genero_mundo(date) is
  'M6 06d: venta publicada por genero x mundo (arbol vigente) x temporada x tienda (solo tipo Tienda) desde p_desde, en un jsonb { series [ { g, m, temp, t, u { aaaa-mm: unidades netas } } ], cargas (periodo aaaa-mm -> carga_id publicada, mismo estado de datos) }. Preagrega por (equivalencia, tienda, periodo) antes de subir a GM. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
-- `proyeccion_crecimientos` ya lo tiene desde la 0023; repetirlo es inocuo.
alter table public.crecimientos_genero_mundo enable row level security;
alter table public.proyeccion_crecimientos enable row level security;

revoke all on public.crecimientos_genero_mundo from public, anon, authenticated;
grant all on public.crecimientos_genero_mundo to service_role;

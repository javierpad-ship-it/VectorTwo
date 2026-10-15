-- M12 · Análisis de marcas al barrer por GML y modalidad `mixta` (versión 0.11.0).
--
-- Ficha: docs/modulos/12-analisis-marcas-barrer.md (§ 6 "Modelo de datos"). La
-- ficha ya pasó revisión independiente. Numeración: la 0018 fue la última de M7;
-- esta es la siguiente libre.
--
-- Qué hace:
--   1. `marcas.resto_al_barrer`: la modalidad `mixta` sin tocar el check de 0010.
--   2. Reemplaza la vista `marca_gml_especial_vigente` (mismas columnas) para que
--      una mixta aparezca en dos filas.
--   3. `repartos_marca_barrido` y `reparto_marca_barrido_gml`: el reparto de una
--      marca al barrer a los GML, versionado, con UNA versión vigente por marca
--      (contrato con M8 y M9).
--   4. Las funciones `venta_marca_gml` y `venta_marca_gml_resumen`: agregan en SQL,
--      sin talla, lo que el análisis necesita (la lectura de hechos de M12).
--   5. `proyecciones.huella_flujo`: la huella de la configuración de 02b con la
--      que M7 calculó una proyección (motivo `config_cambiada`).
--
-- Idempotente: `add column if not exists` (con sus constraints inline, que se
-- omiten junto con la columna si ya existe), `create table if not exists`,
-- `create or replace view`, `create or replace function`, `create index if not
-- exists`, `create or replace trigger`, `revoke`/`grant`/`comment` repetibles.
-- Sin bloques `do $$ ... $$` (las comillas de dólar del cuerpo de las funciones no
-- son un bloque anónimo): el SQL Editor de Supabase la acepta tal cual.
--
-- SIN DROP, DELETE, TRUNCATE ni UPDATE (tampoco dentro de las funciones): las
-- migraciones se aplican con `execute_sql` del MCP de Supabase y esas sentencias
-- se quedan esperando una confirmación que nunca llega. Sin backfill: lo nuevo
-- lleva `default` o es nulo. En particular, ninguna marca cambia de modalidad al
-- aplicar (`resto_al_barrer` nace en `false`) y `huella_flujo` nace nula.
--
-- Criterio I9 de la ficha: la base solo lleva invariantes ESTRUCTURALES (no
-- negativos, rangos 0-1 de una participación, mes 1-12, primer día de mes). Los
-- catálogos (`modo`, `fuente`, `temporada`, los valores de `ventana_meses`) los
-- valida zod, para poder ampliarlos sin `DROP constraint`.
--
-- Seguridad: RLS activo y SIN políticas en las dos tablas nuevas; `revoke`
-- explícito a `public`, `anon` y `authenticated` y `grant` a `service_role` sobre
-- CADA objeto nuevo (convención de 0013 a 0018). Las funciones son `stable`,
-- `security invoker` y `search_path` vacío (todo calificado con esquema).
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `marcas.resto_al_barrer`: la modalidad `mixta`
-- ---------------------------------------------------------------------------
-- El check `marcas_modalidad_valor_check` de 0010 admite solo `por_gml` y
-- `barrido`, y ampliarlo exigiría `drop constraint` (que esta migración no puede
-- emitir). La `mixta` se representa con una columna que se combina con la
-- existente:
--
--   mixta  <=>  modalidad_tratamiento = 'por_gml'  y  resto_al_barrer
--
-- Una mixta tiene GML con compras específicas (los de `marca_gml_especial`, que
-- entran directo al flujo de ese GML) y el RESTO de su venta va al flujo al
-- barrer con el reparto estadístico. El `default false` deja todas las marcas
-- como estaban; apagar la bandera devuelve la marca a `por_gml` conservando sus
-- asignaciones.
--
-- El check va inline: si la columna ya existe, `add column if not exists` omite
-- también el check y repetir la migración no lo duplica. Pide `tratamiento_especial`
-- además de la modalidad: con el check de 0010 (modalidad => casilla) la modalidad
-- `por_gml` ya la implica, pero así el invariante se lee completo en un solo lugar
-- y no depende de que aquel siga existiendo. Una marca con la bandera encendida y
-- modalidad `barrido` o nula (casilla sin modalidad, que se lee como `barrido`) se
-- rechaza: sería ambigua.
--
-- OJO con el nulo: `modalidad_tratamiento = 'por_gml'` con modalidad nula da NULL y
-- un CHECK deja pasar el NULL, o sea que `resto_al_barrer = true` con modalidad nula
-- se habría aceptado. Por eso se compara `coalesce(modalidad_tratamiento, '')`. (El
-- humo `scripts/humo-0019-0020.sql` lo detectó.)
--
-- NOTA PARA UNA BASE QUE YA APLICÓ LA PRIMERA VERSIÓN de esta migración (la del
-- proyecto Vector2 el 2026-10-15, con `modalidad_tratamiento = 'por_gml'` a secas): el
-- `add column if not exists` no reemplaza el check y cambiarlo exige un `DROP`, que una
-- migración no puede emitir. Una sola vez, a mano en el SQL Editor (Javier):
--   alter table public.marcas drop constraint marcas_resto_al_barrer_check;
--   alter table public.marcas add constraint marcas_resto_al_barrer_check
--     check (not resto_al_barrer
--            or (tratamiento_especial and coalesce(modalidad_tratamiento, '') = 'por_gml'));
-- Mientras tanto la API es la que impide encender la bandera con modalidad nula.
alter table public.marcas
  add column if not exists resto_al_barrer boolean not null default false
    constraint marcas_resto_al_barrer_check
      check (not resto_al_barrer
             or (tratamiento_especial and coalesce(modalidad_tratamiento, '') = 'por_gml'));

comment on column public.marcas.resto_al_barrer is
  'M12 0.11.0: con modalidad_tratamiento = por_gml, la venta de la marca fuera de sus GML va al flujo al barrer en vez de a otras (modalidad mixta). Lectura: modalidadEfectiva (por_gml | barrido | mixta | null). El check exige casilla y modalidad por_gml.';

-- ---------------------------------------------------------------------------
-- 2. Vista `marca_gml_especial_vigente` con la mixta
-- ---------------------------------------------------------------------------
-- Reemplaza la de 0010 con las MISMAS columnas y tipos (`create or replace view`
-- no admite otra cosa). Una fila por unidad de marca con parte al barrer
-- (`genero_mundo_linea_id` nulo) y una por par unidad x GML vigente. Un solo
-- cambio: la primera rama admite ahora también a la mixta.
--
--   * `barrido` (o casilla sin modalidad): una fila, GML nulo.
--   * `por_gml`: una fila por GML vigente (como antes).
--   * `mixta` (por_gml + resto_al_barrer): DOS clases de filas: la de GML nulo
--     (su resto al barrer) y una por GML vigente. Una mixta sin GML vigente
--     aparece solo con la fila nula (se comporta como al barrer y la pantalla la
--     persigue como `mixta_sin_gml`).
--
-- La columna `modalidad` conserva los dos valores de siempre: la fila de GML nulo
-- dice `barrido` y las de GML dicen `por_gml`, también para una mixta. Así el
-- código que ya lee la vista (que compara con esos dos literales) no cambia; la
-- mixta se reconoce porque la misma marca tiene las dos clases de fila. La
-- segunda rama no cambia: ya exigía `modalidad_tratamiento = 'por_gml'`, que una
-- mixta cumple. Con `resto_al_barrer = false` en todas las marcas (el estado al
-- aplicar) el resultado es idéntico fila por fila al de 0010.
create or replace view public.marca_gml_especial_vigente
with (security_invoker = true) as
select
  m.id as marca_id,
  m.agrupacion_marca_id,
  'barrido'::text as modalidad,
  null::uuid as genero_mundo_linea_id
from public.marcas m
join public.marcas_unidad u on u.marca_id = m.id and u.unidad_marca_id = m.id
join public.agrupaciones_marca am on am.id = m.agrupacion_marca_id
where m.activo
  and am.activo
  and m.tratamiento_especial
  and (
    coalesce(m.modalidad_tratamiento, 'barrido') = 'barrido'
    or (m.modalidad_tratamiento = 'por_gml' and m.resto_al_barrer)
  )
union all
select
  m.id,
  m.agrupacion_marca_id,
  'por_gml',
  a.genero_mundo_linea_id
from public.marca_gml_especial a
join public.marcas m on m.id = a.marca_id
join public.marcas_unidad u on u.marca_id = m.id and u.unidad_marca_id = m.id
join public.agrupaciones_marca am on am.id = m.agrupacion_marca_id
join public.genero_mundo_linea n on n.id = a.genero_mundo_linea_id
join public.generos g on g.id = n.genero_id
join public.mundos mu on mu.id = n.mundo_id
join public.lineas l on l.id = n.linea_id
where a.activo
  and m.activo
  and am.activo
  and m.tratamiento_especial
  and m.modalidad_tratamiento = 'por_gml'
  and n.activo
  and g.activo
  and mu.activo
  and l.activo;

-- ---------------------------------------------------------------------------
-- 3. `repartos_marca_barrido` (una versión por aprobación)
-- ---------------------------------------------------------------------------
-- Cada aprobación del planner es una versión nueva; la VIGENTE (una por marca) es
-- el contrato con M8: M8 reparte cada compra al barrer de una marca con ella y
-- nunca recalcula. El cálculo del análisis es a demanda y no se guarda (criterio
-- 06b); aquí solo queda la foto de cada aprobación.
--
-- `marca_id` es la UNIDAD de marca (la cabeza del conjunto): lo cumple la API
-- (`409 marca_en_conjunto` si es miembro, `409 modalidad_no_barrer` si no es
-- barrido ni mixta); un check no cruza filas. `on delete restrict`: no se elimina
-- una marca con repartos (la API de M2 lo traduce a 409).
--
-- Catálogos sin check (I9): `modo` (anual | por_temporada | por_mes), `fuente`
-- (historico | cerrada) y los valores de `ventana_meses` (12, 24, 36); la base solo
-- exige `ventana_meses > 0`.
--
-- `huella_cargas` y `huella_config` (regla 11 de la ficha) permiten marcar el
-- reparto como obsoleto sin recalcularlo. `factores_usados` guarda la foto del
-- factor del Niño aplicado ([{ anio, temporada, ratio }]).
--
-- `error_reparto_pp` (backtesting) y `eat_pp` son informativos: `>= 0` por ser
-- puntos porcentuales de un error absoluto. `share_barrido` es una fracción 0-1.
--
-- `aprobada_at` lleva `default now()` y no admite nulo (la ficha no lo decía): una
-- fila de esta tabla existe porque alguien la aprobó, y así la API no puede
-- olvidar la fecha.
create table if not exists public.repartos_marca_barrido (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null
    constraint repartos_marca_barrido_marca_id_fkey
      references public.marcas(id) on delete restrict,
  version integer not null
    constraint repartos_marca_barrido_version_check check (version > 0),
  -- Aprobar una versión nueva pone la anterior en `false` (el orden lo respeta el
  -- backend, que no tiene transacción): el único parcial de abajo impide dos.
  vigente boolean not null default true,
  ventana_meses integer not null
    constraint repartos_marca_barrido_ventana_check check (ventana_meses > 0),
  modo text not null,
  fuente text not null default 'historico',
  -- { generos?: uuid[], mundos?: uuid[], lineas?: uuid[] }; vacío = todo.
  alcance jsonb not null default '{}'::jsonb
    constraint repartos_marca_barrido_alcance_check
      check (jsonb_typeof(alcance) = 'object'),
  -- El `k` con el que se calculó: primer día de mes.
  hasta_periodo date not null
    constraint repartos_marca_barrido_hasta_check
      check (extract(day from hasta_periodo) = 1),
  normaliza_nino boolean not null default true,
  huella_cargas text not null,
  huella_config text not null,
  factores_usados jsonb not null default '[]'::jsonb
    constraint repartos_marca_barrido_factores_check
      check (jsonb_typeof(factores_usados) = 'array'),
  share_barrido numeric(6, 4)
    constraint repartos_marca_barrido_share_check
      check (share_barrido is null or share_barrido between 0 and 1),
  eat_pp numeric(6, 2)
    constraint repartos_marca_barrido_eat_check
      check (eat_pp is null or eat_pp >= 0),
  error_reparto_pp numeric(6, 2)
    constraint repartos_marca_barrido_error_check
      check (error_reparto_pp is null or error_reparto_pp >= 0),
  nota text
    constraint repartos_marca_barrido_nota_len_check
      check (nota is null or length(nota) <= 300),
  aprobada_por_id uuid
    constraint repartos_marca_barrido_aprobada_por_id_fkey
      references public.perfiles(id) on delete set null,
  aprobada_por_nombre text,
  aprobada_at timestamptz not null default now(),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La API asigna `max(version) + 1`; el único también cubre la FK a `marcas`.
  constraint repartos_marca_barrido_marca_version_key
    unique (marca_id, version)
);

-- UNA vigente por marca: la garantía que M8 necesita. Es un índice único parcial
-- sobre una columna no nula, así que no hace falta `coalesce`.
create unique index if not exists repartos_marca_barrido_vigente_uniq
  on public.repartos_marca_barrido (marca_id)
  where vigente;

-- "¿Cuál es el vigente de estas marcas?" y el listado de versiones.
create index if not exists repartos_marca_barrido_marca_vigente_idx
  on public.repartos_marca_barrido (marca_id, vigente);
-- Cubre la FK a `perfiles` (comprobación al eliminar un perfil).
create index if not exists repartos_marca_barrido_aprobada_por_id_idx
  on public.repartos_marca_barrido (aprobada_por_id);

create or replace trigger set_updated_at before update on public.repartos_marca_barrido
  for each row execute function public.tg_set_updated_at();

comment on table public.repartos_marca_barrido is
  'M12 0.11.0: una version por aprobacion del reparto de una marca al barrer (o mixta) a los GML. La vigente (una por marca, indice unico parcial) es el contrato con M8: repartir una compra de una sola marca sin recalcular.';

-- ---------------------------------------------------------------------------
-- 4. `reparto_marca_barrido_gml` (las filas de cada versión)
-- ---------------------------------------------------------------------------
-- Una fila por unidad de planificación `g` (nodo GML, o nodo x equivalencia si el
-- nodo era GMLE al aprobar) y, en el modo `por_temporada`, por temporada de
-- llegada. Si la fila vino de una fila "resto" (GML pequeños agrupados por género
-- x mundo), `grupo_resto` lo dice ('genero_id|mundo_id') y la versión guarda una
-- fila por `g`, de modo que M8 no cambia.
--
-- `participacion_vigente` es `coalesce(participacion_ajustada, participacion_calculada)`
-- PERO no se fuerza con un check a propósito: en una fila de resto editada por el
-- planner, el reparto entre sus miembros (en proporción a sus unidades) puede dejar
-- una vigente que no es ni la calculada ni una ajustada a mano de esa `g`. La suma
-- por (reparto, temporada, mes) = 1 +- 0,0005 la verifica la API (`409
-- suma_invalida`): un check no cruza filas.
--
-- `temporada` (verano | invierno, nula en `anual`) es catálogo en zod. `mes` solo se
-- usa en `por_mes` (segunda entrega). `genero_mundo_linea_id` y `equivalencia_id`
-- van `on delete restrict`: no se elimina un nodo ni una equivalencia que un
-- reparto usa. `reparto_id` va `on delete cascade`: las filas no existen sin su
-- versión.
create table if not exists public.reparto_marca_barrido_gml (
  id uuid primary key default gen_random_uuid(),
  reparto_id uuid not null
    constraint reparto_marca_barrido_gml_reparto_id_fkey
      references public.repartos_marca_barrido(id) on delete cascade,
  genero_mundo_linea_id uuid not null
    constraint reparto_marca_barrido_gml_gml_id_fkey
      references public.genero_mundo_linea(id) on delete restrict,
  -- No nulo solo si el nodo era GMLE al aprobar.
  equivalencia_id uuid
    constraint reparto_marca_barrido_gml_equivalencia_id_fkey
      references public.equivalencias(id) on delete restrict,
  temporada text,
  mes integer
    constraint reparto_marca_barrido_gml_mes_check
      check (mes is null or mes between 1 and 12),
  grupo_resto text,
  unidades_ventana integer not null default 0
    constraint reparto_marca_barrido_gml_unidades_check
      check (unidades_ventana >= 0),
  participacion_calculada numeric(7, 4) not null
    constraint reparto_marca_barrido_gml_calculada_check
      check (participacion_calculada between 0 and 1),
  -- Nulo = sin ajuste del planner.
  participacion_ajustada numeric(7, 4)
    constraint reparto_marca_barrido_gml_ajustada_check
      check (participacion_ajustada is null or participacion_ajustada between 0 and 1),
  participacion_vigente numeric(7, 4) not null
    constraint reparto_marca_barrido_gml_vigente_check
      check (participacion_vigente between 0 and 1),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una fila por (versión, g, temporada, mes). Es un índice de EXPRESIÓN porque la
-- equivalencia, la temporada y el mes admiten nulo y dos NULL no chocan en un
-- UNIQUE normal. Su primera columna (`reparto_id`) cubre también la FK y la lectura
-- de todas las filas de una versión, por eso no hay un índice aparte por `reparto_id`.
create unique index if not exists reparto_marca_barrido_gml_clave_uniq
  on public.reparto_marca_barrido_gml (
    reparto_id,
    genero_mundo_linea_id,
    coalesce(equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(temporada, ''),
    coalesce(mes, 0)
  );

-- Cubren las FK `restrict` (eliminar un nodo o una equivalencia comprueba estas
-- columnas).
create index if not exists reparto_marca_barrido_gml_gml_id_idx
  on public.reparto_marca_barrido_gml (genero_mundo_linea_id);
create index if not exists reparto_marca_barrido_gml_equivalencia_id_idx
  on public.reparto_marca_barrido_gml (equivalencia_id);

create or replace trigger set_updated_at before update on public.reparto_marca_barrido_gml
  for each row execute function public.tg_set_updated_at();

comment on table public.reparto_marca_barrido_gml is
  'M12 0.11.0: filas de cada version del reparto (una por unidad g y temporada). participacion_vigente = coalesce(ajustada, calculada) por regla de la API; la suma por (reparto, temporada, mes) = 1 la verifica la API.';

-- ---------------------------------------------------------------------------
-- 5. Funciones de lectura (I7 de la ficha: agregar en SQL, sin talla)
-- ---------------------------------------------------------------------------
-- El revisor midió que agregar por unidad x equivalencia x talla x periodo da unos
-- 90 mil hechos en 36 meses para las marcas al barrer: demasiado para una llamada.
-- Aquí se agrega al grano que el análisis usa, SIN talla y con la equivalencia SOLO
-- en los nodos GMLE (en un nodo GML la fila agrupa todas sus equivalencias; es la
-- misma regla que `venta_proyeccion` de 0018).
--
-- Ambas: `stable`, `security invoker`, `search_path` vacío, solo lectura, solo
-- `service_role` (el `revoke` quita el acceso por `rpc` a `anon`/`authenticated`).
-- Universo: SOLO tiendas de tipo Tienda (el CD queda fuera: sus hechos son stock,
-- no venta) y cargas publicadas (por `venta_stock_vigente`). `marcas_unidad` suma
-- los miembros de un conjunto en su cabeza (BETA UNO cuenta como BETA).
-- `p_desde` y `p_hasta` son primer día de mes e inclusivos; nulo = sin ese límite.
--
-- Orden determinista (`order by` dentro de `jsonb_agg`): con los mismos datos el
-- documento es idéntico (la huella del cache depende de ello).

-- 5.1 `venta_marca_gml`: hechos de las unidades pedidas y totales de sus GML.
--
--   {
--     "hechos":  [ { unidad_marca_id, gml_id, equivalencia_id, periodo, unidades } ],
--     "totales": [ { gml_id, equivalencia_id, periodo, unidades } ],
--     "cargas":  { "2024-10": "<carga_id>", ... }
--   }
--
-- * `p_marca_ids` son ids de UNIDAD de marca (cabezas o marcas sueltas); un id de
--   miembro no devuelve hechos porque la unidad de ese miembro es otra. Nulo o
--   vacío = lista vacía (devuelve `hechos` y `totales` vacíos).
-- * `totales` es la venta de TODAS las marcas en las mismas `g` donde alguna de las
--   unidades pedidas tiene hechos (el denominador del peso de la marca en el GML,
--   `p1`); no se calcula para los GML donde las unidades pedidas no venden.
-- * `cargas` sale de la misma sentencia (mismo estado de datos) que los hechos:
--   `periodo aaaa-mm -> carga_id` de las cargas publicadas entre `p_desde` y
--   `p_hasta`; es la huella de cargas.
create or replace function public.venta_marca_gml(
  p_marca_ids uuid[],
  p_desde date,
  p_hasta date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with tds as materialized (
    select t.id as tienda_id
    from public.tiendas t
    where t.tipo = 'Tienda'
  ),
  miembros as materialized (
    -- Marcas cuya UNIDAD es una de las pedidas (la cabeza y sus miembros).
    select mu.marca_id, mu.unidad_marca_id
    from public.marcas_unidad mu
    where mu.unidad_marca_id = any (coalesce(p_marca_ids, '{}'::uuid[]))
  ),
  nodos as materialized (
    select
      e.id as equivalencia_real_id,
      e.genero_mundo_linea_id as gml_id,
      case when n.nivel_planificacion = 'GMLE' then e.id end as equivalencia_id
    from public.equivalencias e
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
  ),
  hechos as (
    select
      mi.unidad_marca_id,
      q.gml_id,
      q.equivalencia_id,
      v.periodo,
      sum(v.unidades)::bigint as unidades
    from public.venta_stock_vigente v
    join miembros mi on mi.marca_id = v.marca_id
    join tds on tds.tienda_id = v.tienda_id
    join nodos q on q.equivalencia_real_id = v.equivalencia_id
    where v.periodo >= coalesce(p_desde, v.periodo)
      and v.periodo <= coalesce(p_hasta, v.periodo)
    group by mi.unidad_marca_id, q.gml_id, q.equivalencia_id, v.periodo
  ),
  gml_con_hechos as materialized (
    select distinct h.gml_id, h.equivalencia_id
    from hechos h
  ),
  gml_ids as materialized (
    select distinct g.gml_id
    from gml_con_hechos g
  ),
  totales as (
    select
      q.gml_id,
      q.equivalencia_id,
      v.periodo,
      sum(v.unidades)::bigint as unidades
    from public.venta_stock_vigente v
    join tds on tds.tienda_id = v.tienda_id
    join nodos q on q.equivalencia_real_id = v.equivalencia_id
    join gml_ids gi on gi.gml_id = q.gml_id
    where v.periodo >= coalesce(p_desde, v.periodo)
      and v.periodo <= coalesce(p_hasta, v.periodo)
    group by q.gml_id, q.equivalencia_id, v.periodo
  ),
  totales_g as (
    -- Solo las `g` donde alguna unidad pedida vende (en un nodo GMLE, solo sus
    -- equivalencias con hechos).
    select t.*
    from totales t
    join gml_con_hechos g
      on g.gml_id = t.gml_id
     and g.equivalencia_id is not distinct from t.equivalencia_id
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
      and c.periodo >= coalesce(p_desde, c.periodo)
      and c.periodo <= coalesce(p_hasta, c.periodo)
  )
  select jsonb_build_object(
    'hechos',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'unidad_marca_id', h.unidad_marca_id,
                    'gml_id', h.gml_id,
                    'equivalencia_id', h.equivalencia_id,
                    'periodo', h.periodo,
                    'unidades', h.unidades
                  )
                  order by h.unidad_marca_id, h.gml_id, h.equivalencia_id, h.periodo
                )
           from hechos h),
        '[]'::jsonb),
    'totales',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'gml_id', t.gml_id,
                    'equivalencia_id', t.equivalencia_id,
                    'periodo', t.periodo,
                    'unidades', t.unidades
                  )
                  order by t.gml_id, t.equivalencia_id, t.periodo
                )
           from totales_g t),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_marca_gml(uuid[], date, date)
  from public, anon, authenticated;
grant execute on function public.venta_marca_gml(uuid[], date, date)
  to service_role;

comment on function public.venta_marca_gml(uuid[], date, date) is
  'M12 0.11.0: venta de las unidades de marca pedidas por unidad x nodo GML (equivalencia solo si GMLE) x mes, SIN talla, mas los totales de todas las marcas en esas mismas g y la huella de cargas { hechos, totales, cargas }. Solo tiendas de tipo Tienda; miembros de conjunto suman en la cabeza. Solo lectura. Solo service_role.';

-- 5.2 `venta_marca_gml_resumen`: la lista (una fila por unidad con parte al barrer).
--
--   {
--     "unidades": [ { unidad_marca_id, unidades, gml_con_venta, gml_pequenos } ],
--     "por_gml":  [ { unidad_marca_id, gml_id, equivalencia_id, unidades } ],
--     "cargas":   { "2024-10": "<carga_id>", ... }
--   }
--
-- * Las unidades salen de `marca_gml_especial_vigente` (filas de GML nulo): una
--   `barrido` o una `mixta` marcada, activa y con su agrupación activa; las
--   `por_gml` puras no se analizan aquí. Una unidad sin venta en la ventana sale
--   igual (con ceros) para que la lista diga "Sin reparto" en vez de omitirla.
-- * `unidades` es la venta TOTAL de la unidad en la ventana (en una mixta incluye
--   su parte específica: separar "al barrer" de "específica" lo hace TypeScript con
--   `claveFlujo`, a partir de `por_gml`).
-- * `gml_con_venta` cuenta las `g` con unidades > 0; `gml_pequenos` las que tienen
--   entre 1 y `p_umbral_pequeno - 1` unidades (`UMBRAL_GML_PEQUENO`, supuesto a
--   validar: la ficha lo fija en 50; llega como parámetro para no cablearlo aquí).
--   Ninguno cuenta las `g` netas en cero o negativas (devoluciones).
-- * `por_gml` es el segundo agregado: unidad x `g` x total de la ventana, sin
--   periodo, para esa clasificación. La lista no lee hechos por mes.
create or replace function public.venta_marca_gml_resumen(
  p_desde date,
  p_hasta date,
  p_umbral_pequeno integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with unidades as materialized (
    select v.marca_id as unidad_marca_id
    from public.marca_gml_especial_vigente v
    where v.genero_mundo_linea_id is null
  ),
  tds as materialized (
    select t.id as tienda_id
    from public.tiendas t
    where t.tipo = 'Tienda'
  ),
  miembros as materialized (
    select mu.marca_id, mu.unidad_marca_id
    from public.marcas_unidad mu
    join unidades u on u.unidad_marca_id = mu.unidad_marca_id
  ),
  nodos as materialized (
    select
      e.id as equivalencia_real_id,
      e.genero_mundo_linea_id as gml_id,
      case when n.nivel_planificacion = 'GMLE' then e.id end as equivalencia_id
    from public.equivalencias e
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
  ),
  por_g as (
    select
      mi.unidad_marca_id,
      q.gml_id,
      q.equivalencia_id,
      sum(v.unidades)::bigint as unidades
    from public.venta_stock_vigente v
    join miembros mi on mi.marca_id = v.marca_id
    join tds on tds.tienda_id = v.tienda_id
    join nodos q on q.equivalencia_real_id = v.equivalencia_id
    where v.periodo >= coalesce(p_desde, v.periodo)
      and v.periodo <= coalesce(p_hasta, v.periodo)
    group by mi.unidad_marca_id, q.gml_id, q.equivalencia_id
  ),
  por_unidad as (
    select
      g.unidad_marca_id,
      sum(g.unidades)::bigint as unidades,
      count(*) filter (where g.unidades > 0)::integer as gml_con_venta,
      count(*) filter (
        where g.unidades > 0 and g.unidades < coalesce(p_umbral_pequeno, 50)
      )::integer as gml_pequenos
    from por_g g
    group by g.unidad_marca_id
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
      and c.periodo >= coalesce(p_desde, c.periodo)
      and c.periodo <= coalesce(p_hasta, c.periodo)
  )
  select jsonb_build_object(
    'unidades',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'unidad_marca_id', u.unidad_marca_id,
                    'unidades', coalesce(pu.unidades, 0),
                    'gml_con_venta', coalesce(pu.gml_con_venta, 0),
                    'gml_pequenos', coalesce(pu.gml_pequenos, 0)
                  )
                  order by u.unidad_marca_id
                )
           from unidades u
           left join por_unidad pu on pu.unidad_marca_id = u.unidad_marca_id),
        '[]'::jsonb),
    'por_gml',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'unidad_marca_id', g.unidad_marca_id,
                    'gml_id', g.gml_id,
                    'equivalencia_id', g.equivalencia_id,
                    'unidades', g.unidades
                  )
                  order by g.unidad_marca_id, g.gml_id, g.equivalencia_id
                )
           from por_g g),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_marca_gml_resumen(date, date, integer)
  from public, anon, authenticated;
grant execute on function public.venta_marca_gml_resumen(date, date, integer)
  to service_role;

comment on function public.venta_marca_gml_resumen(date, date, integer) is
  'M12 0.11.0: la lista de marcas al barrer: una fila por unidad con parte al barrer (barrido o mixta, de marca_gml_especial_vigente) con unidades de la ventana, g con venta y g pequenas (< p_umbral_pequeno), mas el agregado por g sin periodo y la huella de cargas { unidades, por_gml, cargas }. Solo tiendas de tipo Tienda. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 6. `proyecciones.huella_flujo` (M7: motivo `config_cambiada`)
-- ---------------------------------------------------------------------------
-- La huella de la configuración de 02b (marcas relevantes, modalidades y
-- conjuntos, la `ConfigFlujo` serializada más `VERSION_METODO_BARRER`) con la que
-- `calcular` produjo la proyección. `motivosDesactualizada` la compara con la
-- actual y, si difiere, añade `config_cambiada`. Nula = proyección calculada antes
-- de este cambio (queda `desactualizada` si está en trabajo; una cerrada no se
-- toca). Es un dato de la API: la migración no la escribe.
alter table public.proyecciones
  add column if not exists huella_flujo text;

comment on column public.proyecciones.huella_flujo is
  'M12 0.11.0: hash de la ConfigFlujo (02b: relevantes, modalidades, conjuntos) y VERSION_METODO_BARRER con el que se calculo. Nulo = calculada antes de M12. Dato de la API.';

-- ---------------------------------------------------------------------------
-- 7. Permisos y RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
-- La vista se reemplazó: se repiten sus revoke y grant por si el reemplazo los
-- hubiera tocado (no lo hace, pero el costo es nulo y deja el archivo completo).
alter table public.repartos_marca_barrido enable row level security;
alter table public.reparto_marca_barrido_gml enable row level security;

revoke all on public.repartos_marca_barrido from public, anon, authenticated;
grant all on public.repartos_marca_barrido to service_role;

revoke all on public.reparto_marca_barrido_gml from public, anon, authenticated;
grant all on public.reparto_marca_barrido_gml to service_role;

revoke all on public.marca_gml_especial_vigente from public, anon, authenticated;
grant select on public.marca_gml_especial_vigente to service_role;

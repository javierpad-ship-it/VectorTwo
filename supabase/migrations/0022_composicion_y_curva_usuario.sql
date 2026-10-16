-- M6 06c · Composición de la agrupación y curva del usuario (`U`) · Base de datos.
--
-- Ficha: docs/modulos/06c-curvas-composicion-y-curva-usuario.md (§ Modelo de datos).
--
-- Qué hace:
--   1. `curvas_estacionalidad.origen_curva` ('sistema' | 'avanzada' | 'usuario'),
--      con dos checks de coherencia contra `modelo`.
--   2. `curvas_estacionalidad.curva_manual jsonb` (solo en la curva del usuario),
--      con un check de tipo y otro de coherencia contra `origen_curva`.
--   3. Función `venta_composicion_agrupacion(p_agrupacion_id, p_red, p_hasta)`:
--      venta de la agrupación por GML x mes y por equivalencia x año sobre la red
--      comparable de cada año, más la venta de esos GML en otras agrupaciones.
--
-- Idempotente (`add column if not exists`, `create or replace function`,
-- `revoke`/`grant`/`comment` repetibles). Sin bloques `do $$ ... $$` (las comillas
-- de dólar del cuerpo de la función no son un bloque anónimo). SIN DROP, DELETE,
-- TRUNCATE ni UPDATE de datos (tampoco dentro de la función): las migraciones se
-- aplican con `execute_sql` y esas sentencias se quedan esperando una
-- confirmación. Sin tablas nuevas: no hay nada que activar con RLS
-- (`curvas_estacionalidad` ya lo tiene, sin políticas).

-- ---------------------------------------------------------------------------
-- 1. `curvas_estacionalidad.origen_curva`
-- ---------------------------------------------------------------------------
-- Por qué una columna nueva y no ampliar `origen` ('propia' | 'prestada', 0015):
-- ampliar su check exigiría `drop constraint` (sin DROP en las migraciones). Y por
-- qué `modelo` no se restringe: su único check es `length between 1 and 10`; la
-- restricción A..F / T / U vive en zod (MODELOS_APROBABLES). Los dos checks de
-- coherencia dan a la base lo que `modelo` no tiene: 'usuario' <=> modelo U y
-- 'avanzada' <=> modelo F, sin impedir ninguna letra de sistema.
--
-- El `default 'sistema'` rellena las filas existentes sin UPDATE: todas son del
-- sistema (modelo A..E o T), así que los dos checks se cumplen al agregar la
-- columna. Si la columna ya existe, `add column if not exists` omite también los
-- checks en línea (repetir la migración no los duplica).
alter table public.curvas_estacionalidad
  add column if not exists origen_curva text not null default 'sistema'
    constraint curvas_estacionalidad_origen_curva_check
      check (origen_curva in ('sistema', 'avanzada', 'usuario'))
    constraint curvas_estacionalidad_origen_usuario_modelo_check
      check ((origen_curva = 'usuario') = (modelo = 'U'))
    constraint curvas_estacionalidad_origen_avanzada_modelo_check
      check ((origen_curva = 'avanzada') = (modelo = 'F'));

comment on column public.curvas_estacionalidad.origen_curva is
  'M6 06c: quien produjo la curva. sistema = candidatas A..E o T (origen propia o prestada); avanzada = candidata F (modelo avanzado); usuario = curva escrita por el planner (modelo U, no se vuelve obsoleta sola). Coherente con modelo por check: usuario <=> modelo U, avanzada <=> modelo F. Se agrega aparte de origen para no tocar su check.';

-- ---------------------------------------------------------------------------
-- 2. `curvas_estacionalidad.curva_manual`
-- ---------------------------------------------------------------------------
-- Detalle de la curva del usuario: valores tal como se escribieron (antes de
-- normalizar), de donde partió, EAT y error máximo EN MUESTRA (`eat` y
-- `error_max` de la fila quedan nulos: significan "fuera de muestra"), `igual_a`.
-- Nulo en toda curva que no sea del usuario. `p01..p12` guardan la curva ya
-- normalizada (suma 1, check de la 0015).
alter table public.curvas_estacionalidad
  add column if not exists curva_manual jsonb
    constraint curvas_estacionalidad_curva_manual_check
      check (curva_manual is null or jsonb_typeof(curva_manual) = 'object')
    constraint curvas_estacionalidad_curva_manual_origen_check
      check ((curva_manual is not null) = (origen_curva = 'usuario'));

comment on column public.curvas_estacionalidad.curva_manual is
  'M6 06c: solo en la curva del usuario (origen_curva = usuario; check de coherencia). Objeto con valores_ingresados (12 porcentajes antes de normalizar), partida, en_muestra, eat_en_muestra, error_max_en_muestra, eat_en_muestra_por_anio, eat_parcial_en_muestra, igual_a. eat y error_max de la fila quedan nulos (no hay medida fuera de muestra).';

comment on column public.curvas_estacionalidad.modelo is
  'Letra de la candidata aprobada: A..E (propias del sistema), F (modelo avanzado, desde M6 06c), T (prestada de la temporada) o U (curva del usuario, desde M6 06c). Sin check de conjunto (solo length 1..10): lo restringe zod y lo cruza origen_curva.';

comment on column public.curvas_estacionalidad.origen is
  'propia o prestada (T). Las curvas F y U son propias; lo que las distingue es origen_curva (esta columna no se amplia: su check exigiria quitar la restriccion).';

-- ---------------------------------------------------------------------------
-- 3. `venta_composicion_agrupacion(p_agrupacion_id, p_red, p_hasta)`
-- ---------------------------------------------------------------------------
-- Devuelve, en UNA sola sentencia (un solo estado de los datos):
--
--   {
--     "nodos":         [ { gml_id, periodo, unidades } ],                  -- GML x mes
--     "equivalencias": [ { equivalencia_id, gml_id, anio, unidades } ],    -- equivalencia x año
--     "otras":         [ { gml_id, agrupacion_id, anio, unidades } ],      -- GML en OTRAS agrupaciones
--     "cargas":        { "2023-01": "<carga_id uuid>", ... }
--   }
--
-- Parámetros:
--   * p_agrupacion_id: agrupación de estacionalidad. Nulo -> nada.
--   * p_red: `{ "2024": ["<tienda_id>", ...], ... }`, la red comparable de cada año
--     tal como la decidió el cálculo de la 06b (la API la arma siempre desde
--     `entrada.redes`). Así los pesos y las curvas por GML suman exactamente la
--     serie de la agrupación. Nulo, `{}` o algo que no sea un objeto -> `nodos` y
--     `equivalencias` vacíos (`otras` y `cargas` salen igual: no dependen de la red).
--     Un año ausente de p_red no produce filas de ese año.
--   * p_hasta: primer día del último mes que entra (`hasta_periodo`). Nulo -> nada
--     (la comparación con nulo nunca es verdadera).
--
-- Cómo está armada (el costo):
--   * `hechos` (MATERIALIZED) agrega PRIMERO por equivalencia x tienda x mes
--     solo la venta de la agrupación pedida y hasta el tope: entra por el índice
--     de `equivalencias(agrupacion_estacionalidad_id)` y el de
--     `venta_stock_mensual(equivalencia_id)`, activas o no (los hechos de una
--     equivalencia desactivada siguen siendo venta de esa agrupación mientras
--     apunte a ella; igual que la 0017). Se materializa porque lo usan DOS
--     agregados (`nodos` y `equivalencias`); sin eso el planificador podría
--     reevaluar el join con la venta dos veces.
--   * DESPUÉS se cruza con la red del año (`red`, ya deduplicada): el cruce se hace
--     sobre lo agregado, no sobre las ~870 mil filas de la venta. Por qué esto
--     importa: un join red x venta antes de filtrar por agrupación es lo que no cabe.
--   * `otras`: para los GML presentes en `hechos`, la venta de sus equivalencias que
--     pertenecen a una agrupación DISTINTA (las equivalencias sin agrupación, con
--     `agrupacion_estacionalidad_id` nulo, no cuentan: `<>` con nulo no es
--     verdadero), de todas las tiendas, por agrupación y año, hasta p_hasta. No
--     filtra por red a propósito: es "cuánto de este GML vive en otro lado".
--   * `cargas`: periodo aaaa-mm -> carga_id de las cargas publicadas, de la misma
--     sentencia que la venta (misma huella de datos que la 0017). Hay a lo sumo una
--     carga publicada por periodo (índice único parcial).
--
-- `numeric`/`bigint` salen como números JSON. Orden determinista (`order by` dentro
-- de `jsonb_agg`): mismos datos, mismo documento.
--
-- Objetivo: <= 1.5 s en la agrupación mayor (166 GML, 450 equivalencias, ~4 700
-- filas GML x mes). Si no cupiera, `otras` pasa a una segunda llamada diferida.
--
-- `stable`, `security invoker` y `search_path` vacío (todo calificado con esquema):
-- la ejecuta solo el backend (`service_role`); el `revoke` quita el acceso por
-- `rpc` a `anon` y `authenticated`.
create or replace function public.venta_composicion_agrupacion(
  p_agrupacion_id uuid,
  p_red jsonb,
  p_hasta date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with red as (
    select distinct r.key::int as anio, t.tienda_id::uuid as tienda_id
    from jsonb_each(
           case when jsonb_typeof(p_red) = 'object' then p_red else '{}'::jsonb end
         ) as r(key, value)
    cross join lateral jsonb_array_elements_text(
           case when jsonb_typeof(r.value) = 'array' then r.value else '[]'::jsonb end
         ) as t(tienda_id)
  ),
  hechos as materialized (
    select
      e.id as equivalencia_id,
      e.genero_mundo_linea_id as gml_id,
      v.tienda_id,
      v.periodo,
      extract(year from v.periodo)::int as anio,
      sum(v.unidades)::bigint as unidades
    from public.equivalencias e
    join public.venta_stock_vigente v on v.equivalencia_id = e.id
    where p_agrupacion_id is not null
      and e.agrupacion_estacionalidad_id = p_agrupacion_id
      and v.periodo <= p_hasta
    group by e.id, e.genero_mundo_linea_id, v.tienda_id, v.periodo
  ),
  en_red as (
    select h.equivalencia_id, h.gml_id, h.periodo, h.anio, h.unidades
    from hechos h
    join red r on r.anio = h.anio and r.tienda_id = h.tienda_id
  ),
  nodos as (
    select n.gml_id, n.periodo, sum(n.unidades)::bigint as unidades
    from en_red n
    group by n.gml_id, n.periodo
  ),
  por_equivalencia as (
    select n.equivalencia_id, n.gml_id, n.anio, sum(n.unidades)::bigint as unidades
    from en_red n
    group by n.equivalencia_id, n.gml_id, n.anio
  ),
  otras as (
    select
      e2.genero_mundo_linea_id as gml_id,
      e2.agrupacion_estacionalidad_id as agrupacion_id,
      extract(year from v.periodo)::int as anio,
      sum(v.unidades)::bigint as unidades
    from (select distinct h.gml_id from hechos h) g
    join public.equivalencias e2
      on e2.genero_mundo_linea_id = g.gml_id
     and e2.agrupacion_estacionalidad_id <> p_agrupacion_id
    join public.venta_stock_vigente v on v.equivalencia_id = e2.id
    where v.periodo <= p_hasta
    group by e2.genero_mundo_linea_id, e2.agrupacion_estacionalidad_id, extract(year from v.periodo)
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
  )
  select jsonb_build_object(
    'nodos',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object('gml_id', n.gml_id, 'periodo', n.periodo, 'unidades', n.unidades)
                  order by n.gml_id, n.periodo
                )
           from nodos n),
        '[]'::jsonb),
    'equivalencias',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'equivalencia_id', q.equivalencia_id,
                    'gml_id', q.gml_id,
                    'anio', q.anio,
                    'unidades', q.unidades
                  )
                  order by q.equivalencia_id, q.anio
                )
           from por_equivalencia q),
        '[]'::jsonb),
    'otras',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'gml_id', o.gml_id,
                    'agrupacion_id', o.agrupacion_id,
                    'anio', o.anio,
                    'unidades', o.unidades
                  )
                  order by o.gml_id, o.agrupacion_id, o.anio
                )
           from otras o),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_composicion_agrupacion(uuid, jsonb, date) from public, anon, authenticated;
grant execute on function public.venta_composicion_agrupacion(uuid, jsonb, date) to service_role;

comment on function public.venta_composicion_agrupacion(uuid, jsonb, date) is
  'M6 06c: composicion de una agrupacion de estacionalidad en un jsonb { nodos (GML x mes), equivalencias (equivalencia x anio), otras (venta del GML en otras agrupaciones, todas las tiendas), cargas (periodo aaaa-mm -> carga_id publicada) }. nodos y equivalencias solo cuentan las tiendas de la red comparable de cada anio recibida en p_red ({ "2024": [tienda_id, ...] }) y hasta p_hasta (primer dia del ultimo mes). Solo lectura. Solo service_role.';

-- M6 · Rediseño por agrupación (versión 0.9.7) · Lectura de venta filtrada.
--
-- Ficha: docs/modulos/06b-curvas-trabajo-por-agrupacion.md (§ Modelo de datos).
-- Sustituye el flujo de corrida global de la 0.9.6 (refresco de la vista
-- materializada + candado + lectura de 6 500 filas) por una lectura a demanda de
-- UNA agrupación.
--
-- Qué hace:
--   1. Función `venta_estacionalidad_agrupacion(p_agrupacion_id uuid)` que
--      devuelve un `jsonb` con la venta de la agrupación (tienda × mes), la venta
--      por temporada (temporada × tienda × mes) y los meses publicados.
--   2. Columna `corridas_estacionalidad.agrupacion_estacionalidad_id` (foto de
--      aprobación de una agrupación) y su índice.
--   3. `comment on` de lo que queda sin uso desde la 0.9.7 (no se puede borrar).
--
-- Idempotente (`create or replace function`, `add column if not exists`,
-- `create index if not exists`, `revoke`/`grant`/`comment` repetibles). Sin
-- bloques `do $$ ... $$` (las comillas de dólar del cuerpo no son un bloque
-- anónimo). SIN DROP, DELETE, TRUNCATE ni UPDATE (tampoco dentro de la función):
-- las migraciones se aplican con `execute_sql` y esas sentencias se quedan
-- esperando una confirmación. La función es de solo lectura (`stable`).
-- Sin tablas nuevas: no hay nada que activar con RLS (las dos tablas tocadas ya
-- lo tienen, sin políticas).

-- ---------------------------------------------------------------------------
-- 1. `venta_estacionalidad_agrupacion(p_agrupacion_id uuid)`
-- ---------------------------------------------------------------------------
-- Devuelve, en UNA sola sentencia (un solo estado de los datos):
--
--   {
--     "agrupacion": [ { tienda_id, periodo, unidades, venta_soles, costo_vendido } ]
--                   | null,          -- null cuando p_agrupacion_id es nulo
--     "temporadas": [ { temporada, tienda_id, periodo, unidades } ],
--     "meses_publicados": [ "2023-01-01", ... ],
--     "cargas": { "2023-01": "<carga_id uuid>", ... }
--   }
--
-- * `agrupacion`: suma por tienda y mes de las equivalencias cuyo
--   `agrupacion_estacionalidad_id = p_agrupacion_id`, activas o no (los hechos de
--   una equivalencia desactivada siguen siendo venta de esa agrupación mientras
--   apunte a ella; es lo que hacía la vista materializada). Entra por el índice de
--   `equivalencias(agrupacion_estacionalidad_id)` y el de
--   `venta_stock_mensual(equivalencia_id)`.
--
-- * `temporadas`: temporada × tienda × mes sobre TODA la venta publicada. La
--   temporada es la de la agrupación ACTIVA de la equivalencia; las equivalencias
--   sin agrupación o con agrupación inactiva van como 'sin_agrupacion'. Así la suma
--   de `temporadas` por tienda y mes es la venta total de la tienda (la red
--   comparable se decide sobre la venta total, regla 4 de la ficha 06) y sirve
--   también para la curva T y el control de todo el año. `left join` y no `join`:
--   ninguna fila de venta se pierde del total.
--
-- * `meses_publicados`: periodos de las cargas en estado `publicada`.
--
-- * `cargas`: objeto `{ "<periodo aaaa-mm>": "<carga_id>" }` de esas mismas cargas
--   publicadas. Sale del MISMO CTE `meses` que `meses_publicados`, dentro de la
--   misma sentencia: la huella de cargas que calcula el backend y la venta leída
--   corresponden al mismo estado de los datos (no se desfasan si una carga se
--   publica o se retira entre dos lecturas). Hay a lo sumo una carga publicada por
--   periodo (índice único parcial `cargas_periodo_publicada_uniq`), así que la
--   clave nunca se pisa. Orden estable: `jsonb_object_agg` ordenado por periodo
--   (jsonb además ordena las claves al guardarlas).
--
-- POR QUÉ `jsonb` Y NO `setof`: `temporadas` supera el corte de 1 000 filas de
-- PostgREST y paginar un `rpc` reejecutaría el agregado en cada página. Un `jsonb`
-- viaja en una sola respuesta (~250 KB).
--
-- `numeric` y `bigint` salen como números JSON; `date` como `aaaa-mm-dd`.
-- Orden determinista (`order by` dentro de `jsonb_agg`): dos llamadas con los
-- mismos datos devuelven el mismo documento, útil para las huellas.
--
-- COSTO: un agregado completo de `venta_stock_vigente` (~870 mil filas hoy) más un
-- agregado indexado de la agrupación. Objetivo: < 3 s. PLAN B si no cabe: que la
-- misma función lea de la vista materializada `venta_mensual_estacionalidad` de la
-- 0015 (refrescada con `refrescar_venta_mensual_estacionalidad()` cuando cambie la
-- huella de cargas; función nueva en una 0018, sin tocar la API). Por eso la vista
-- se deja sin uso pero no se declara muerta.
--
-- `security invoker` y `search_path` vacío (todo calificado con esquema): la
-- ejecuta solo el backend (`service_role`); el `revoke` quita el acceso por `rpc`
-- a `anon` y `authenticated`.
create or replace function public.venta_estacionalidad_agrupacion(p_agrupacion_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with agrupacion as (
    -- Vacío cuando p_agrupacion_id es nulo (`e.agrupacion_estacionalidad_id = null`
    -- nunca es verdadero): no se toca la venta y `agrupacion` sale como null.
    select
      v.tienda_id,
      v.periodo,
      sum(v.unidades)::bigint as unidades,
      sum(v.venta_soles)::numeric as venta_soles,
      sum(v.costo_vendido)::numeric as costo_vendido
    from public.equivalencias e
    join public.venta_stock_vigente v on v.equivalencia_id = e.id
    where p_agrupacion_id is not null
      and e.agrupacion_estacionalidad_id = p_agrupacion_id
    group by v.tienda_id, v.periodo
  ),
  temporadas as (
    select
      coalesce(a.temporada, 'sin_agrupacion') as temporada,
      v.tienda_id,
      v.periodo,
      sum(v.unidades)::bigint as unidades
    from public.venta_stock_vigente v
    left join public.equivalencias e on e.id = v.equivalencia_id
    left join public.agrupaciones_estacionalidad a
      on a.id = e.agrupacion_estacionalidad_id
     and a.activo
    group by coalesce(a.temporada, 'sin_agrupacion'), v.tienda_id, v.periodo
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
  )
  select jsonb_build_object(
    'agrupacion',
      case
        when p_agrupacion_id is null then null
        else coalesce(
          (select jsonb_agg(
                    jsonb_build_object(
                      'tienda_id', g.tienda_id,
                      'periodo', g.periodo,
                      'unidades', g.unidades,
                      'venta_soles', g.venta_soles,
                      'costo_vendido', g.costo_vendido
                    )
                    order by g.tienda_id, g.periodo
                  )
             from agrupacion g),
          '[]'::jsonb)
      end,
    'temporadas',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'temporada', t.temporada,
                    'tienda_id', t.tienda_id,
                    'periodo', t.periodo,
                    'unidades', t.unidades
                  )
                  order by t.temporada, t.tienda_id, t.periodo
                )
           from temporadas t),
        '[]'::jsonb),
    'meses_publicados',
      coalesce(
        (select jsonb_agg(m.periodo order by m.periodo) from meses m),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_estacionalidad_agrupacion(uuid) from public, anon, authenticated;
grant execute on function public.venta_estacionalidad_agrupacion(uuid) to service_role;

comment on function public.venta_estacionalidad_agrupacion(uuid) is
  'M6 0.9.7: venta publicada en un jsonb { agrupacion (tienda x mes de la agrupacion; null con id nulo), temporadas (temporada x tienda x mes; sin_agrupacion incluida), meses_publicados, cargas (periodo aaaa-mm -> carga_id publicada, mismo estado de datos) }. Solo lectura, sin vista materializada ni candado. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 2. `corridas_estacionalidad.agrupacion_estacionalidad_id`
-- ---------------------------------------------------------------------------
-- Desde la 0.9.7 solo se guarda la FOTO de cada aprobación (los cálculos que se
-- miran y no se aprueban no se guardan). La foto lleva la agrupación a la que
-- pertenece; `curvas_estacionalidad.corrida_id` apunta a ella.
-- Nulo = corrida global heredada de la 0.9.6 (se conserva como historial, sin
-- uso). No nulo = foto de aprobación de esa agrupación.
-- `on delete restrict`: no se borra una agrupación con fotos (se desactiva).
-- Si la columna ya existe, `add column if not exists` omite también la FK en línea,
-- así que repetir la migración no la duplica.
alter table public.corridas_estacionalidad
  add column if not exists agrupacion_estacionalidad_id uuid
    constraint corridas_estacionalidad_agrupacion_fkey
      references public.agrupaciones_estacionalidad(id) on delete restrict;

-- Cubre la FK y la lectura de la última foto de una agrupación.
create index if not exists corridas_estacionalidad_agrupacion_idx
  on public.corridas_estacionalidad (agrupacion_estacionalidad_id, created_at desc);

comment on column public.corridas_estacionalidad.agrupacion_estacionalidad_id is
  'M6 0.9.7: agrupacion a la que pertenece esta foto de aprobacion. Nulo = corrida global heredada de la 0.9.6 (historial, sin uso). No nulo = foto congelada de lo que vio el planner al aprobar la curva de esa agrupacion.';

-- ---------------------------------------------------------------------------
-- 3. Lo que queda sin uso desde la 0.9.7 (no se puede borrar: sin DROP)
-- ---------------------------------------------------------------------------
comment on column public.corridas_estacionalidad.referencia is
  'SIN USO desde 0.9.7 (M6 0.9.6: corrida de referencia, maximo una). Ninguna ruta la lee ni la escribe; el factor del Nino se calcula a demanda. Se conserva con su indice unico parcial.';

comment on materialized view public.venta_mensual_estacionalidad is
  'SIN USO desde 0.9.7: nadie la lee. Reserva de rendimiento: si venta_estacionalidad_agrupacion() no cabe en 3 s, esa funcion puede leer de aqui (plan B, 0018). Derivada, sin RLS posible: acceso solo para service_role.';

comment on function public.refrescar_venta_mensual_estacionalidad() is
  'SIN USO desde 0.9.7: refresca la vista venta_mensual_estacionalidad (reserva de rendimiento, plan B de venta_estacionalidad_agrupacion). Solo service_role.';

comment on function public.refrescar_y_leer_agregado_estacionalidad() is
  'SIN USO desde 0.9.7: sustituida por venta_estacionalidad_agrupacion(). Refrescaba la vista materializada con un candado de aviso y devolvia el agregado global. Solo service_role.';

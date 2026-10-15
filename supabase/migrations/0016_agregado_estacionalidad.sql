-- M6 · Paso 2 · Lectura atómica del agregado y corrida de referencia.
--
-- Idempotente (`create or replace function`, `add column if not exists`,
-- `create unique index if not exists`, `revoke` y `grant` repetibles). Sin
-- bloques `do $$ ... $$` (las comillas de dólar del cuerpo no son un bloque
-- anónimo). SIN DROP, DELETE, TRUNCATE ni sentencias de modificación de filas
-- (tampoco dentro de la función): las migraciones se aplican con `execute_sql`
-- y esas sentencias se quedan esperando una confirmación. La única operación de
-- escritura de la función es el refresco de la vista materializada de la 0015,
-- que no es una sentencia de datos de negocio.
--
-- POR QUÉ UNA FUNCIÓN QUE DEVUELVE `jsonb`
--   * El grano agrupación × tienda × mes son unas 6 500 filas, por encima del
--     corte de 1 000 filas de PostgREST. Paginar un `rpc` con `range`
--     reejecutaría la función (y el refresco) en cada página, y paginar la vista
--     materializada (unas 86 páginas) no es atómico: un refresco concurrente la
--     deja a medias. Un `jsonb` con todas las filas viaja en una sola respuesta
--     y refleja un solo estado de los datos.
--   * El candado de aviso (`pg_try_advisory_xact_lock`) está ligado a la
--     transacción de la llamada: dos cálculos a la vez no se pisan el refresco;
--     el segundo recibe `calculo_en_curso` (errcode 55P03) y la API responde 409.
--
-- Qué devuelve: { "refresco": { filas, duracion_ms, refrescada_at },
--                 "filas": [ { agrupacion_id, tienda_id, periodo, unidades,
--                              venta_soles, costo_vendido }, ... ] }
-- Las filas con `agrupacion_id` nulo (equivalencias sin agrupación) se devuelven:
-- dan las unidades sin agrupación y entran en la venta total por tienda de la
-- red. `genero_id` y `linea_id` no salen: nada los usa en esta entrega.
--
-- `security invoker`, `search_path` vacío: la ejecuta solo el backend
-- (`service_role`, dueño de la vista materializada) y el `revoke` quita el
-- acceso por `rpc` a `anon` y `authenticated`.
create or replace function public.refrescar_y_leer_agregado_estacionalidad()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_refresco jsonb;
  v_filas jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('venta_mensual_estacionalidad')) then
    raise exception 'calculo_en_curso' using errcode = '55P03';
  end if;

  v_refresco := public.refrescar_venta_mensual_estacionalidad();

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'agrupacion_id', g.agrupacion_estacionalidad_id,
               'tienda_id', g.tienda_id,
               'periodo', g.periodo,
               'unidades', g.unidades,
               'venta_soles', g.venta_soles,
               'costo_vendido', g.costo_vendido
             )
             order by g.agrupacion_estacionalidad_id nulls last, g.tienda_id, g.periodo
           ),
           '[]'::jsonb
         )
    into v_filas
  from (
    select
      m.agrupacion_estacionalidad_id,
      m.tienda_id,
      m.periodo,
      sum(m.unidades)::bigint as unidades,
      sum(m.venta_soles)::numeric as venta_soles,
      sum(m.costo_vendido)::numeric as costo_vendido
    from public.venta_mensual_estacionalidad m
    group by m.agrupacion_estacionalidad_id, m.tienda_id, m.periodo
  ) g;

  return jsonb_build_object('refresco', v_refresco, 'filas', v_filas);
end;
$$;

revoke execute on function public.refrescar_y_leer_agregado_estacionalidad() from public, anon, authenticated;
grant execute on function public.refrescar_y_leer_agregado_estacionalidad() to service_role;

comment on function public.refrescar_y_leer_agregado_estacionalidad() is
  'M6: toma un candado de aviso (55P03 calculo_en_curso si otro calculo corre), refresca venta_mensual_estacionalidad y devuelve en un solo jsonb el agregado agrupacion x tienda x mes. Solo service_role.';

-- ---------------------------------------------------------------------------
-- Corrida de referencia: a lo sumo una. La escribe la API
-- (`PATCH /api/curvas/corridas/[id]`), nunca esta migración. De la corrida de
-- referencia salen el factor de volumen del Niño y los contratos para M7.
-- ---------------------------------------------------------------------------
alter table public.corridas_estacionalidad
  add column if not exists referencia boolean not null default false;

create unique index if not exists corridas_estacionalidad_referencia_uniq
  on public.corridas_estacionalidad (referencia)
  where referencia;

comment on column public.corridas_estacionalidad.referencia is
  'M6: corrida de referencia (maximo una, indice unico parcial). La marca el planner desde la API; de ella leen /anios y M7.';

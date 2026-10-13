-- M2b · Sugerencias de marcas relevantes, versión 2 de la función SQL.
--
-- Idempotente: se puede correr más de una vez (`create or replace function`,
-- `revoke` y `grant` repetibles). Sin bloques `do $$ ... $$` (el cuerpo de la
-- función usa comillas de dólar, que no es un bloque anónimo).
--
-- SIN sentencias destructivas ni de modificación de datos: ni DROP, ni DELETE,
-- ni TRUNCATE, ni UPDATE (tampoco dentro de la función). Motivo: las
-- migraciones se aplican con `execute_sql` del MCP de Supabase y cualquier
-- sentencia destructiva se queda esperando una confirmación que nunca llega.
--
-- POR QUÉ UNA FUNCIÓN NUEVA y no cambiar `sugerir_marcas_relevantes` de 0010:
--   1. Paginar con `range` la función de 0010 la re-ejecuta completa en cada
--      página (agrega todo `venta_stock_vigente`, ~0,65 s con ~392 mil filas) y
--      devolvía ~11 mil filas con top 4: de 12 a 58 páginas, minutos en el
--      compute Micro. La v2 aplica el tope por (nodo, agrupación) y la
--      participación mínima DENTRO de SQL y devuelve pocas filas.
--   2. Con `medida = unidades` el cliente recalculaba la participación sobre
--      una cola ya truncada por soles (inexacta). La v2 ordena y mide con la
--      misma medida, sobre el total completo de la agrupación en el nodo.
--   3. Cambiar el tipo de argumentos de una función existente con `create or
--      replace` crea un overload; con un nombre distinto no hay ambigüedad.
-- La de 0010 se CONSERVA sin uso (no se elimina: nada de DROP en migraciones).
--
-- Mismas reglas que la de 0010:
--   * Agrega `venta_stock_vigente` (solo cargas publicadas) entre `p_desde` y
--     `p_hasta` (primer día de mes, inclusive) por nodo (vía
--     `equivalencias.genero_mundo_linea_id`), UNIDAD de marca (vía
--     `marcas_unidad`: ALFA JEANS suma en ALFA) y agrupación de la unidad.
--   * `p_excluir` (VARIOS, OTROS, SIN MARCA) se excluye ANTES de agregar, así que
--     el denominador de la participación son solo las unidades no excluidas.
--   * Desempate por id de la unidad de marca (resultado determinista).
--   * Solo lectura; nunca escribe.
--
-- Diferencias:
--   * `p_medida` ('venta_soles' | 'unidades'): decide el orden, el `rango` y la
--     base de `participacion` = medida de la unidad ÷ Σ medida de TODAS las
--     unidades no excluidas de esa agrupación en ese nodo (total completo, nunca
--     un recorte). Cualquier otro valor lanza una excepción clara. Las dos
--     medidas (`unidades` y `venta_soles`) se devuelven siempre.
--   * `p_top` (por defecto 4; nulo = 4): máximo de filas por (nodo, agrupación).
--   * `p_min_participacion` (por defecto 0; nulo = 0): descarta las filas cuya
--     participación (ya redondeada a 6 decimales, tal como se devuelve) sea
--     menor. El `rango` se calcula ANTES de este filtro, igual que el recorte
--     que hacía el cliente (primero top, después mínimo): el rango 1 sigue
--     siendo la marca mayor aunque otras queden fuera.
--   * `participacion` es 0 si el total de la agrupación en el nodo no es
--     positivo (devoluciones netas), para no dividir entre cero ni devolver
--     negativos.
--
-- `plpgsql` (y no `sql`) para poder lanzar la excepción de `p_medida`.
-- `#variable_conflict use_column`: las columnas de salida (`marca_id`, `rango`,
-- ...) son variables en plpgsql y comparten nombre con columnas de las tablas;
-- con esta directiva un nombre ambiguo se resuelve como columna.
-- `security invoker`, `stable`, `search_path` vacío: la ejecuta solo el backend
-- (service_role, que salta el RLS) y el `revoke` quita el acceso por `rpc` a
-- `anon` y `authenticated`.
create or replace function public.sugerir_marcas_relevantes_v2(
  p_desde date,
  p_hasta date,
  p_top integer default 4,
  p_excluir uuid[] default null,
  p_medida text default 'venta_soles',
  p_min_participacion numeric default 0
)
returns table (
  genero_mundo_linea_id uuid,
  agrupacion_marca_id uuid,
  marca_id uuid,
  unidades bigint,
  venta_soles numeric,
  participacion numeric,
  rango integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_medida text := coalesce(p_medida, 'venta_soles');
  v_top integer := coalesce(p_top, 4);
  v_min numeric := coalesce(p_min_participacion, 0);
begin
  if v_medida not in ('venta_soles', 'unidades') then
    raise exception 'p_medida debe ser venta_soles o unidades (recibido: %)', v_medida
      using errcode = '22023';
  end if;

  return query
  with agregado as (
    select
      e.genero_mundo_linea_id as gml_id,
      c.agrupacion_marca_id as agr_id,
      u.unidad_marca_id as unidad_id,
      sum(v.unidades)::bigint as unidades,
      sum(v.venta_soles)::numeric as venta_soles
    from public.venta_stock_vigente v
    join public.equivalencias e on e.id = v.equivalencia_id
    join public.marcas_unidad u on u.marca_id = v.marca_id
    join public.marcas c on c.id = u.unidad_marca_id
    where v.periodo >= p_desde
      and v.periodo <= p_hasta
      and not (u.unidad_marca_id = any (coalesce(p_excluir, '{}'::uuid[])))
    group by e.genero_mundo_linea_id, c.agrupacion_marca_id, u.unidad_marca_id
  ),
  medido as (
    select
      a.*,
      case when v_medida = 'unidades' then a.unidades::numeric else a.venta_soles end as medida
    from agregado a
  ),
  ordenado as (
    select
      m.*,
      sum(m.medida) over (partition by m.gml_id, m.agr_id) as total,
      row_number() over (
        partition by m.gml_id, m.agr_id
        order by m.medida desc, m.unidad_id
      ) as rn
    from medido m
  ),
  final as (
    select
      o.gml_id,
      o.agr_id,
      o.unidad_id,
      o.unidades,
      o.venta_soles,
      case when o.total > 0 then round(o.medida / o.total, 6) else 0::numeric end as part,
      o.rn::integer as rn
    from ordenado o
    where o.rn <= v_top
  )
  select f.gml_id, f.agr_id, f.unidad_id, f.unidades, f.venta_soles, f.part, f.rn
  from final f
  where f.part >= v_min
  order by f.gml_id, f.agr_id, f.rn;
end;
$$;

-- Solo el backend (service_role) la ejecuta. Los revoke y grant son idempotentes.
revoke execute on function public.sugerir_marcas_relevantes_v2(date, date, integer, uuid[], text, numeric)
  from public, anon, authenticated;
grant execute on function public.sugerir_marcas_relevantes_v2(date, date, integer, uuid[], text, numeric)
  to service_role;

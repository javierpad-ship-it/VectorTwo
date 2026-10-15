-- M7 · Cola larga con validación de disponibilidad (versión 0.10.1).
--
-- Ficha: docs/modulos/07-proyeccion-anual.md, sección "Cambios 0.10.1", punto 2
-- (decisión 21 de la ronda 4 de Javier) y punto 3 (decisión 22).
-- NUMERACIÓN: la ficha la llama `0019_proyeccion_disponibilidad`, pero la 0019
-- (M12, analisis_marcas_barrer) y la 0020 (M13, intercompany) ya se aplicaron en
-- Vector2; esta es la siguiente libre. La ficha debe actualizarse a `0021`.
--
-- Qué hace:
--   1. `create or replace function public.venta_proyeccion(...)`: misma firma que
--      la de la 0018, y el documento gana UNA clave nueva, `disponibilidad`. Las
--      claves anteriores (`filas`, `por_tienda`, `equivalencias`, `detalle_w12`,
--      `cargas`) salen byte a byte iguales (se verificó con md5 por clave sobre
--      dos tandas reales antes y después).
--   2. `comment on column public.tiendas.venta_esperada_promedio`: el significado
--      pasa a ser "soles, sin IGV, del año de apertura" (decisión 22). Es solo
--      documentación: la columna no se renombra ni se convierte (los valores ya
--      cargados los reescribe Javier; un UPDATE queda fuera de las migraciones).
--
-- NINGUNA columna ni tabla nueva. Se revisó qué más pide 0.10.1 y todo cabe en
-- jsonb ya existentes, sin tocar el esquema:
--   * `umbral_disponibilidad` (0,75) y el umbral de cola larga: viven en
--     `proyecciones.parametros` (jsonb, el check solo exige que sea un objeto).
--   * `VERSION_METODO = 3`: vive en `proyecciones.resumen.version_metodo` (jsonb).
--   * detalle de cola larga (disponibilidad, tienda-meses, venta corregida,
--     veredicto): `proyeccion_filas.historico.cola_larga` (jsonb `not null`).
--   * avisos nuevos (`revision_cola_larga`, `cola_larga_con_quiebres`,
--     `sin_stock_historico`, `apertura_tardia`): `avisos` jsonb en las tres tablas;
--     ninguna tiene check sobre los códigos.
--   * `periodo_referencia` y `por_marca` de las participaciones:
--     `proyeccion_filas.participaciones` (jsonb sin check de forma).
--   * `proyeccion_tiendas.venta_esperada_usada` ya es numeric(14,2) con check
--     `>= 0`: guarda la cifra anual tal cual.
--   * `proyeccion_filas.clave`, `proyeccion_fila_anios.metodo` y `.origen` no
--     cambian: el veredicto "para revisión" bloquea el cierre sin estado propio
--     (lo deriva el backend de `historico.cola_larga` y de `decidido is null`).
--
-- Idempotente: `create or replace function`, `revoke`/`grant`/`comment`
-- repetibles. Sin bloques `do $$ ... $$` (las comillas de dólar del cuerpo de la
-- función no son un bloque anónimo). SIN DROP, DELETE, TRUNCATE ni UPDATE.
-- El cuerpo de la función no lleva comentarios `--` a propósito: así el archivo
-- (sin sus líneas de comentario) corre tal cual con `execute_sql`.
--
-- Seguridad: la función sigue `stable`, `security invoker` y `search_path` vacío;
-- `create or replace` conserva los permisos de la 0018, pero se repiten el
-- `revoke` (public, anon, authenticated) y el `grant` a service_role.
--
-- CLAVE `disponibilidad`:
--
--   "disponibilidad": [ { gml_id, equivalencia_id, agrupacion_marca_id, periodo,
--                         tiendas_total, tiendas_con_stock, unidades_con_stock,
--                         stock_cd } ]
--
--   Una fila por (nodo, equivalencia si GMLE, agrupacion de la unidad de marca,
--   mes) con periodo >= p_desde_w12 (la función no tiene techo: el backend
--   recorta a W12 hasta el mes cerrado `k`). Es la misma "fila base" que `filas`
--   (misma regla de equivalencia_id nula en GML y de agrupación de la UNIDAD de
--   marca), de modo que el backend la cruza con `filas` por esa identidad.
--
--   * `tiendas_total`: tiendas de tipo Tienda con '1' en la posición Y de su clave
--     de pertenencia (la cuarta: M(Y), las mismas tiendas del año proyectado). Es
--     el mismo número para todas las filas (n_t de la ficha); va en cada fila para
--     que cada elemento se baste solo.
--   * `tiendas_con_stock`: de esas tiendas, las que tienen stock > 0 al cierre del
--     mes sumando todas las marcas de la unidad, tallas y (en un GML) equivalencias
--     de la fila. Es el proxy MENSUAL de disponibilidad (M5 no guarda días con
--     stock): una tienda con una sola unidad cuenta como "con stock".
--   * `unidades_con_stock`: unidades vendidas ese mes por ESAS tiendas (sin
--     normalizar por el factor del Niño: eso lo hace TypeScript con `factoresMes`).
--   * `stock_cd`: stock al cierre del mes en el Centro de Distribución (todo lo que
--     no es tipo Tienda) para la misma fila. Es la ÚNICA lectura del CD en M7, solo
--     para este dato: `filas`, `por_tienda`, `equivalencias` y `detalle_w12` siguen
--     sin CD.
--
--   Aparecen los meses en que la fila tuvo algún hecho de una tienda de M(Y) o
--   stock en el CD (aunque `tiendas_con_stock` sea 0: es justo el quiebre que se
--   busca). Un mes sin ningún hecho no trae fila: el backend lo lee como todo 0
--   (sin stock en ninguna tienda ni en el CD, sin venta). Las tiendas de M(Y) sin
--   hechos en la fila cuentan en `tiendas_total` y no en `tiendas_con_stock`.
--   El stock se suma por tienda ANTES de comparar con 0 (stock_unidades es
--   `not null` y hoy no hay negativos).
--
--   Misma sentencia y mismo estado que `cargas`: `disponibilidad` sale de la misma
--   CTE `hechos` (materializada una vez) que las demás claves; la lectura del CD
--   usa `venta_stock_vigente` en la misma sentencia (mismo snapshot).
--
-- COSTO (medido en vector-two el 2026-10-15): ver el informe de la entrega; la
-- lectura nueva reutiliza `hechos` (ya materializada) y añade solo la del CD
-- (un almacén, ~1/11 de los hechos de la tanda).

create or replace function public.venta_proyeccion(
  p_gml_ids uuid[],
  p_grupos jsonb,
  p_tiendas_detalle uuid[],
  p_desde date,
  p_desde_w12 date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with tds as materialized (
    select
      t.id as tienda_id,
      coalesce(p_grupos ->> t.id::text, '00000') as clave
    from public.tiendas t
    where t.tipo = 'Tienda'
  ),
  cds as materialized (
    select t.id as tienda_id
    from public.tiendas t
    where t.tipo <> 'Tienda'
  ),
  marcas_u as materialized (
    select mu.marca_id, mu.unidad_marca_id, cab.agrupacion_marca_id
    from public.marcas_unidad mu
    join public.marcas cab on cab.id = mu.unidad_marca_id
  ),
  equivalencias_nodo as materialized (
    select
      e.id as equivalencia_real_id,
      e.genero_mundo_linea_id as gml_id,
      case when n.nivel_planificacion = 'GMLE' then e.id end as equivalencia_id
    from public.equivalencias e
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
    where e.genero_mundo_linea_id = any (coalesce(p_gml_ids, '{}'::uuid[]))
  ),
  hechos as materialized (
    select
      q.gml_id,
      q.equivalencia_id,
      q.equivalencia_real_id,
      mu.agrupacion_marca_id,
      mu.unidad_marca_id as marca_unidad_id,
      v.agrupacion_talla_id,
      v.tienda_id,
      td.clave,
      v.periodo,
      v.unidades,
      v.venta_soles,
      v.costo_vendido,
      v.stock_unidades
    from equivalencias_nodo q
    join public.venta_stock_vigente v on v.equivalencia_id = q.equivalencia_real_id
    join tds td on td.tienda_id = v.tienda_id
    join marcas_u mu on mu.marca_id = v.marca_id
    where v.periodo >= coalesce(least(p_desde, p_desde_w12), v.periodo)
  ),
  filas as (
    select
      h.gml_id,
      h.equivalencia_id,
      h.agrupacion_marca_id,
      h.clave,
      h.periodo,
      sum(h.unidades)::bigint as unidades,
      sum(h.venta_soles)::numeric as venta_soles,
      sum(h.costo_vendido)::numeric as costo_vendido,
      sum(h.stock_unidades)::bigint as stock_unidades
    from hechos h
    where h.periodo >= coalesce(p_desde, h.periodo)
    group by h.gml_id, h.equivalencia_id, h.agrupacion_marca_id, h.clave, h.periodo
  ),
  por_tienda as (
    select
      h.tienda_id,
      h.gml_id,
      h.equivalencia_id,
      h.agrupacion_marca_id,
      h.periodo,
      sum(h.unidades)::bigint as unidades,
      sum(h.venta_soles)::numeric as venta_soles,
      sum(h.stock_unidades)::bigint as stock_unidades
    from hechos h
    where h.tienda_id = any (coalesce(p_tiendas_detalle, '{}'::uuid[]))
      and h.periodo >= coalesce(p_desde_w12, h.periodo)
    group by h.tienda_id, h.gml_id, h.equivalencia_id, h.agrupacion_marca_id, h.periodo
  ),
  pesos as (
    select
      h.gml_id,
      h.equivalencia_real_id as equivalencia_id,
      sum(h.unidades)::bigint as unidades
    from hechos h
    where substr(h.clave, 4, 1) = '1'
      and h.periodo >= coalesce(p_desde_w12, h.periodo)
    group by h.gml_id, h.equivalencia_real_id
  ),
  detalle as (
    select
      h.gml_id,
      h.equivalencia_id,
      h.agrupacion_marca_id,
      h.marca_unidad_id as marca_id,
      h.agrupacion_talla_id,
      sum(h.unidades)::bigint as unidades
    from hechos h
    where substr(h.clave, 4, 1) = '1'
      and h.periodo >= coalesce(p_desde_w12, h.periodo)
    group by h.gml_id, h.equivalencia_id, h.agrupacion_marca_id, h.marca_unidad_id, h.agrupacion_talla_id
  ),
  n_tiendas as materialized (
    select count(*)::int as n
    from tds
    where substr(tds.clave, 4, 1) = '1'
  ),
  stock_tienda as (
    select
      h.gml_id,
      h.equivalencia_id,
      h.agrupacion_marca_id,
      h.tienda_id,
      h.periodo,
      sum(h.unidades) as unidades,
      sum(h.stock_unidades) as stock
    from hechos h
    where substr(h.clave, 4, 1) = '1'
      and h.periodo >= coalesce(p_desde_w12, h.periodo)
    group by h.gml_id, h.equivalencia_id, h.agrupacion_marca_id, h.tienda_id, h.periodo
  ),
  disp_tiendas as (
    select
      s.gml_id,
      s.equivalencia_id,
      s.agrupacion_marca_id,
      s.periodo,
      count(*) filter (where s.stock > 0)::bigint as tiendas_con_stock,
      coalesce(sum(s.unidades) filter (where s.stock > 0), 0)::bigint as unidades_con_stock,
      0::bigint as stock_cd
    from stock_tienda s
    group by s.gml_id, s.equivalencia_id, s.agrupacion_marca_id, s.periodo
  ),
  disp_cd as (
    select
      q.gml_id,
      q.equivalencia_id,
      mu.agrupacion_marca_id,
      v.periodo,
      0::bigint as tiendas_con_stock,
      0::bigint as unidades_con_stock,
      sum(v.stock_unidades)::bigint as stock_cd
    from equivalencias_nodo q
    join public.venta_stock_vigente v on v.equivalencia_id = q.equivalencia_real_id
    join cds c on c.tienda_id = v.tienda_id
    join marcas_u mu on mu.marca_id = v.marca_id
    where v.periodo >= coalesce(p_desde_w12, v.periodo)
    group by q.gml_id, q.equivalencia_id, mu.agrupacion_marca_id, v.periodo
  ),
  disp as (
    select
      u.gml_id,
      u.equivalencia_id,
      u.agrupacion_marca_id,
      u.periodo,
      sum(u.tiendas_con_stock)::bigint as tiendas_con_stock,
      sum(u.unidades_con_stock)::bigint as unidades_con_stock,
      sum(u.stock_cd)::bigint as stock_cd
    from (
      select * from disp_tiendas
      union all
      select * from disp_cd
    ) u
    group by u.gml_id, u.equivalencia_id, u.agrupacion_marca_id, u.periodo
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
  )
  select jsonb_build_object(
    'filas',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'gml_id', f.gml_id,
                    'equivalencia_id', f.equivalencia_id,
                    'agrupacion_marca_id', f.agrupacion_marca_id,
                    'clave', f.clave,
                    'periodo', f.periodo,
                    'unidades', f.unidades,
                    'venta_soles', f.venta_soles,
                    'costo_vendido', f.costo_vendido,
                    'stock_unidades', f.stock_unidades
                  )
                  order by f.gml_id, f.equivalencia_id, f.agrupacion_marca_id, f.clave, f.periodo
                )
           from filas f),
        '[]'::jsonb),
    'por_tienda',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'tienda_id', pt.tienda_id,
                    'gml_id', pt.gml_id,
                    'equivalencia_id', pt.equivalencia_id,
                    'agrupacion_marca_id', pt.agrupacion_marca_id,
                    'periodo', pt.periodo,
                    'unidades', pt.unidades,
                    'venta_soles', pt.venta_soles,
                    'stock_unidades', pt.stock_unidades
                  )
                  order by pt.tienda_id, pt.gml_id, pt.equivalencia_id, pt.agrupacion_marca_id, pt.periodo
                )
           from por_tienda pt),
        '[]'::jsonb),
    'equivalencias',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'gml_id', p.gml_id,
                    'equivalencia_id', p.equivalencia_id,
                    'unidades', p.unidades
                  )
                  order by p.gml_id, p.equivalencia_id
                )
           from pesos p),
        '[]'::jsonb),
    'detalle_w12',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'gml_id', d.gml_id,
                    'equivalencia_id', d.equivalencia_id,
                    'agrupacion_marca_id', d.agrupacion_marca_id,
                    'marca_id', d.marca_id,
                    'agrupacion_talla_id', d.agrupacion_talla_id,
                    'unidades', d.unidades
                  )
                  order by d.gml_id, d.equivalencia_id, d.agrupacion_marca_id, d.marca_id, d.agrupacion_talla_id
                )
           from detalle d),
        '[]'::jsonb),
    'disponibilidad',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'gml_id', x.gml_id,
                    'equivalencia_id', x.equivalencia_id,
                    'agrupacion_marca_id', x.agrupacion_marca_id,
                    'periodo', x.periodo,
                    'tiendas_total', (select nt.n from n_tiendas nt),
                    'tiendas_con_stock', x.tiendas_con_stock,
                    'unidades_con_stock', x.unidades_con_stock,
                    'stock_cd', x.stock_cd
                  )
                  order by x.gml_id, x.equivalencia_id, x.agrupacion_marca_id, x.periodo
                )
           from disp x),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_proyeccion(uuid[], jsonb, uuid[], date, date)
  from public, anon, authenticated;
grant execute on function public.venta_proyeccion(uuid[], jsonb, uuid[], date, date)
  to service_role;

comment on function public.venta_proyeccion(uuid[], jsonb, uuid[], date, date) is
  'M7 0.10.1: venta de una tanda de nodos GML en un jsonb { filas (nodo x equivalencia si GMLE x agrupacion de la unidad de marca x clave de pertenencia a M(Y-3..Y+1) x mes), por_tienda (solo p_tiendas_detalle), equivalencias (pesos de la curva, tiendas con 1 en la posicion Y), detalle_w12 (marca de la unidad x talla, tiendas con 1 en Y), disponibilidad (nodo x equivalencia si GMLE x agrupacion x mes desde p_desde_w12: tiendas_total y tiendas_con_stock de M(Y), unidades vendidas por las tiendas con stock > 0 al cierre del mes, stock_cd = unica lectura del CD), cargas (periodo aaaa-mm -> carga_id publicada, mismo estado de datos) }. Excluye el CD salvo stock_cd. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- `tiendas.venta_esperada_promedio`: nuevo significado (decisión 22, 0.10.1)
-- ---------------------------------------------------------------------------
-- La columna conserva nombre y tipo. Antes (0.10.0) eran soles por mes de tienda
-- madura; ahora son los soles, netos de IGV, que la tienda venderá en su AÑO DE
-- APERTURA (de `fecha_apertura` al 31 de diciembre de ese año). M7 deduce el año
-- maduro con la curva y la fracción del año. Los valores ya cargados con el
-- significado anterior los reescribe Javier; no hay conversión automática.
comment on column public.tiendas.venta_esperada_promedio is
  'M4/M7 0.10.1: soles, netos de IGV, que la tienda vendera en su anio de apertura (desde fecha_apertura hasta el 31 de diciembre de ese anio). No es venta mensual ni de tienda madura: M7 deduce el anio maduro con la curva y la fraccion del anio. Antes de 0.10.1 eran soles por mes de tienda madura: los valores cargados con ese significado los reescribe el dueno.';

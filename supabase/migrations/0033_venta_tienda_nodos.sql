-- M7 07f · Venta por tienda y año de un género x mundo, dentro de Crecimientos (versión prevista `0.15.0 · M7 b`).
--
-- Ficha: docs/modulos/07f-venta-por-tienda-en-crecimientos.md (§2 modelo de datos, §2.2 la función y su presupuesto).
-- NUMERACIÓN: la ficha cita esta migración con el marcador `00F1_venta_tienda_nodos.sql` («la siguiente libre al construir»). Estaban
-- aplicadas 0000-0025, 0027, 0029, 0030, 0031 y 0032 (08b-1); la 0026 (0.13.1 · M8) y la 0028 (M9a) siguen reservadas. Esta toma la 0033.
--
-- Qué hace: UNA función de solo lectura, `venta_tienda_nodos(p_gml_ids, p_desde, p_hasta)`. Sin tablas, columnas, índices, triggers,
-- seeds ni backfill. No hay RLS que activar porque no hay tablas nuevas.
--
-- Por qué una función nueva y no una existente (ficha §2.1):
--   * `venta_genero_mundo` (0029) da solo unidades, todos los GM a la vez, y es de M6 (la prueba estática de M7 prohíbe nombrarla).
--   * `venta_lineas_ia` (0030) da solo unidades y sin tienda, por diseño.
--   * `venta_proyeccion` (0021) da soles por tienda pero por FILA de proyección (decenas de miles de tuplas por GM) y calcula stock del CD.
--   * Leer `venta_stock_vigente` directo devolvería decenas de miles de filas, por encima del corte de 1 000 de PostgREST.
--
-- Contrato (un solo jsonb, una sola sentencia = un solo estado de los datos):
--
--   {
--     "series": [ { "t": tienda_id, "p": "aaaa-mm", "u": unidades_netas, "s": venta_soles_netos_de_IGV } ... ],
--     "cargas": { "aaaa-mm": "<carga_id>", ... }
--   }
--
--   * Parámetros: `p_gml_ids` = ids de `genero_mundo_linea` (los nodos). El backend los arma desde el catálogo, así la misma función sirve
--     para una celda GM y para el Resto (todos los nodos de géneros no detallados) y la asignación de nodos a GM es la del
--     `GET .../crecimientos`. Los ids viajan en el cuerpo del `rpc`, sin límite de URL. `p_gml_ids` nulo o vacío da `series = []`.
--   * Rango: `p_desde <= periodo <= p_hasta`, ambos inclusive y por fecha de la carga (primer día del mes). `p_desde` o `p_hasta` nulos
--     dan `series = []` y `cargas = {}` (una comparación con null no es verdadera).
--   * Solo tiendas `tipo = 'Tienda'`: el CD nunca entra. No se filtra por `tiendas.activo` ni `equivalencias.activo` (como 0027/0029): la
--     venta histórica de una tienda cerrada o desactivada cuenta; el backend decide el grupo con los `bloques` guardados.
--   * Lee de `venta_stock_vigente` (solo cargas publicadas) ÚNICAMENTE `unidades` y `venta_soles`: ni costo ni stock. Una prueba estática
--     de M7 lo comprueba leyendo este archivo.
--   * Unidades netas (las devoluciones restan, sin filtrar signos) y soles netos de IGV, tal como los guarda M5 (numeric con 2 decimales).
--   * Una serie por (tienda, periodo) con venta registrada; no se inventan ceros: el backend completa las tiendas de la base que no vendieron.
--   * Orden determinista (`t`, `p`): mismos datos, mismo documento.
--   * `cargas` sale del mismo CTE dentro de la misma sentencia y solo cubre [p_desde, p_hasta]: sirve para detectar meses sin carga
--     publicada. Hay a lo sumo una carga publicada por periodo (índice único parcial `cargas_periodo_publicada_uniq`).
--
-- Tamaño: es UN jsonb (una fila para PostgREST), así que el corte de 1 000 filas no aplica. El tope práctico es tiendas x meses (~15 x 45
-- ≈ 700 tuplas, < 150 KB); ver la MEDICIÓN 0033 al final. El plazo de 8 s de PostgREST se respeta con holgura (ver medición).
--
-- PREAGREGACIÓN por (equivalencia, tienda, periodo) sobre `venta_stock_vigente` y solo después se sube a (tienda, periodo), como 0027 y
-- 0029; el filtro de nodos entra como semiunión sobre `equivalencias` antes de agregar.
--
-- `stable`, `security invoker` y `search_path` vacío (todo calificado con esquema): la ejecuta solo el backend (`service_role`). El cuerpo
-- va sin comentarios `--` (el SQL se aplica por `execute_sql` en trozos y el SQL Editor los parsea mal dentro de `$$`).
--
-- Idempotente: `create or replace function`, `revoke`, `grant` y `comment` repetibles. Sin `drop`, `delete`, `truncate` ni `update`.
create or replace function public.venta_tienda_nodos(p_gml_ids uuid[], p_desde date, p_hasta date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with equivalencias_nodo as (
    select e.id
    from public.equivalencias e
    where e.genero_mundo_linea_id = any(p_gml_ids)
  ),
  por_equivalencia as (
    select
      v.equivalencia_id,
      v.tienda_id,
      v.periodo,
      sum(v.unidades)::bigint as unidades,
      sum(v.venta_soles) as venta_soles
    from public.venta_stock_vigente v
    join public.tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda'
    join equivalencias_nodo q on q.id = v.equivalencia_id
    where v.periodo >= p_desde
      and v.periodo <= p_hasta
    group by v.equivalencia_id, v.tienda_id, v.periodo
  ),
  por_tienda as (
    select
      p.tienda_id,
      p.periodo,
      sum(p.unidades)::bigint as unidades,
      sum(p.venta_soles) as venta_soles
    from por_equivalencia p
    group by p.tienda_id, p.periodo
  ),
  meses as (
    select c.periodo, c.id as carga_id
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
      and c.periodo >= p_desde
      and c.periodo <= p_hasta
  )
  select jsonb_build_object(
    'series',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    't', s.tienda_id,
                    'p', to_char(s.periodo, 'YYYY-MM'),
                    'u', s.unidades,
                    's', s.venta_soles
                  )
                  order by s.tienda_id, s.periodo
                )
           from por_tienda s),
        '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.carga_id order by m.periodo)
           from meses m),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_tienda_nodos(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.venta_tienda_nodos(uuid[], date, date) to service_role;

comment on function public.venta_tienda_nodos(uuid[], date, date) is
  'M7 07f: venta publicada de los nodos genero_mundo_linea p_gml_ids por tienda (solo tipo Tienda, sin CD) y mes, p_desde <= periodo <= p_hasta, en un jsonb { series [ { t tienda_id, p aaaa-mm, u unidades netas, s venta_soles netos de IGV } ordenadas por (t, p) ], cargas (periodo aaaa-mm -> carga_id publicada del rango, mismo estado de datos) }. Lee solo unidades y venta_soles de venta_stock_vigente. Solo lectura. Solo service_role.';

-- MEDICIÓN 0033 en vector-two (2026-11-04, `p_desde = 2023-01-01`, `p_hasta = 2026-09-01`, 870 359 filas de `venta_stock_vigente`, 45 cargas
-- publicadas, 11 tiendas de tipo Tienda, 590 nodos), `explain (analyze, buffers)` y cronometrado de `select public.venta_tienda_nodos(...)`.
-- Solo lectura; la base compartida añade ruido (las repeticiones varían ±40 %):
--   * MUJER x URBANO (55 nodos, 373 equivalencias): 922 ms la primera pasada tras crear la función (casi en frío), luego 706, 672, 682 y
--     1 076 ms. Documento de 38 679 bytes (38 KB): 412 series, 10 tiendas, 45 cargas. Dentro del presupuesto (<= 3 s en frío, <= 150 KB);
--     en caliente ronda 0,7 s y rozó 1,1 s en una pasada.
--   * Resto (todos los nodos de géneros distintos de HOMBRE y MUJER, 365 nodos): 1 311 ms la primera pasada, luego 1 349, 1 293, 2 089 y 2 148 ms.
--     Documento de 37 821 bytes: 411 series, 10 tiendas. Cumple el presupuesto en frío (<= 3 s) y el tamaño, pero NO el de caliente
--     (<= 1 s): se mueve entre 1,3 y 2,1 s. Muy por debajo de los 8 s de PostgREST. El mismo cuerpo escrito en línea con el array literal
--     tarda 0,7 s; dentro de la función el plan cambia (el array llega como parámetro). Una variante con `unnest` materializado no mejoró.
--     Si en producción el Resto pasa de 3 s en frío, la palanca de la ficha es `p_desde` = enero de Y-2 (tres años), no un cambio de esquema.
--   * Cuadre contra la fuente en vector-two (MUJER x URBANO): `sum(u)` y `sum(s)` del documento = `sum(unidades)` y `sum(venta_soles)` de
--     `venta_stock_vigente` de sus equivalencias en tiendas Tienda y en el rango; ninguna serie es de un CD; claves del documento = series y cargas.

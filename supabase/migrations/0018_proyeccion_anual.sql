-- M7 · Proyección anual de unidades (versión 0.10.0).
--
-- Ficha: docs/modulos/07-proyeccion-anual.md (§ 6 "Modelo de datos" y § 11
-- "Orden de construcción", paso A). La ficha ya pasó revisión independiente.
-- Numeración: la 0017 fue la última de M6 (06b); esta es la siguiente libre.
--
-- Qué crea:
--   1. `tiendas.tienda_referencia_id` (M4): la tienda a cuya composición de venta
--      debe parecerse una tienda nueva.
--   2. La función `venta_proyeccion(p_gml_ids, p_grupos, p_tiendas_detalle,
--      p_desde, p_desde_w12)`: única lectura de venta de M7, un `jsonb` por tandas
--      de nodos GML.
--   3. `proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios` y
--      `proyeccion_tiendas` (el objeto de trabajo, sus filas, los números por año
--      y la decisión por tienda nueva o cierre).
--   4. `factores_volumen_atipico` (el factor del Niño, editable; vive fuera de la
--      proyección porque es un hecho sobre el histórico).
--
-- Idempotente: `create table if not exists`, `add column if not exists`,
-- `create or replace function`, `create index if not exists`,
-- `create or replace trigger`, `revoke`/`grant`/`comment` repetibles. Sin bloques
-- `do $$ ... $$` (las comillas de dólar del cuerpo de la función no son un bloque
-- anónimo): el SQL Editor de Supabase la acepta tal cual.
--
-- SIN DROP, DELETE, TRUNCATE ni UPDATE (tampoco dentro de la función): las
-- migraciones se aplican con `execute_sql` del MCP de Supabase y esas sentencias
-- se quedan esperando una confirmación que nunca llega. Sin backfill: lo nuevo
-- lleva `default` o es nulo. En particular `proyecciones.calculando_desde` es un
-- dato de la API (lo pone y lo limpia `calcular`); la migración no lo toca.
--
-- Seguridad: RLS activo y SIN políticas en las cinco tablas nuevas; `revoke`
-- explícito a `public`, `anon` y `authenticated` y `grant` a `service_role` sobre
-- CADA objeto nuevo (convención de 0013 a 0017). La función es `stable`,
-- `security invoker` y `search_path` vacío (todo calificado con esquema).
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `tiendas.tienda_referencia_id` (M4)
-- ---------------------------------------------------------------------------
-- La tienda de referencia de una tienda nueva: su composición de venta (mezcla
-- por GML, agrupación de marca y género) es la que debe heredar la nueva, en vez
-- de la composición promedio de la red. Es un atributo de la tienda con un solo
-- valor, por eso una columna y no una tabla.
--
-- `on delete restrict` (decisión de Javier al encargar esta migración, distinta
-- del `set null` que traía la ficha): una tienda que es referente de otra no se
-- puede eliminar mientras alguien la use; la API de M4 traduce el error de FK a
-- un 409. Sin cadenas: la composición del referente se calcula siempre con SUS
-- hechos, nunca con los de su propio referente (lo exige la API; un check no
-- puede cruzar filas). El check solo impide apuntarse a sí misma.
-- Si la columna ya existe, `add column if not exists` omite también la FK y el
-- check en línea, así que repetir la migración no los duplica.
alter table public.tiendas
  add column if not exists tienda_referencia_id uuid
    constraint tiendas_tienda_referencia_id_fkey
      references public.tiendas(id) on delete restrict
    constraint tiendas_referencia_no_propia_check
      check (tienda_referencia_id is null or tienda_referencia_id <> id);

-- Cubre la FK (comprobación al eliminar una tienda: ¿alguien la usa de
-- referente?) y la lectura inversa.
create index if not exists tiendas_referencia_idx
  on public.tiendas (tienda_referencia_id);

comment on column public.tiendas.tienda_referencia_id is
  'M7 0.10.0: tienda a cuya composicion de venta (por GML, agrupacion de marca y genero) debe parecerse esta tienda cuando es nueva. Nulo = composicion promedio de las mismas tiendas. La API exige un referente de tipo Tienda, activo y distinto; sin cadenas (se usan siempre los hechos propios del referente). on delete restrict: no se elimina una tienda que es referente de otra.';

-- ---------------------------------------------------------------------------
-- 2. Función `venta_proyeccion`
-- ---------------------------------------------------------------------------
-- La única lectura de venta de M7, en UNA sola sentencia (un solo estado de los
-- datos), por tandas de nodos género-mundo-línea (TANDA_GML = 60). Devuelve:
--
--   {
--     "filas":       [ { gml_id, equivalencia_id, agrupacion_marca_id, clave,
--                        periodo, unidades, venta_soles, costo_vendido,
--                        stock_unidades } ],            periodo >= p_desde
--     "por_tienda":  [ { tienda_id, gml_id, equivalencia_id, agrupacion_marca_id,
--                        periodo, unidades, venta_soles, stock_unidades } ],
--                                                       solo p_tiendas_detalle,
--                                                       periodo >= p_desde_w12
--     "equivalencias": [ { gml_id, equivalencia_id, unidades } ],
--                                                       pesos de curvaUnidad
--     "detalle_w12": [ { gml_id, equivalencia_id, agrupacion_marca_id, marca_id,
--                        agrupacion_talla_id, unidades } ],
--     "cargas":      { "2023-01": "<carga_id>", ... }
--   }
--
-- * Filtro de nodos: `equivalencias.genero_mundo_linea_id = any(p_gml_ids)`; entra
--   por el índice `venta_stock_mensual(equivalencia_id, carga_id)`. Se incluyen
--   las equivalencias inactivas: sus hechos siguen siendo venta del nodo (la
--   fila cuadra con la venta real del nodo; el backend decide qué unidades
--   proyecta).
--
-- * El CD queda FUERA de todo: se une `tiendas` con `tipo = 'Tienda'`. No se
--   filtra por `activo`: una tienda desactivada con venta recibe la clave `00000`
--   y el backend la cuenta como fuera de bloque.
--
-- * `agrupacion_marca_id` es SIEMPRE la de la unidad de marca (la cabeza del
--   conjunto o la marca misma, vía `marcas_unidad`), nunca la del miembro; igual
--   `marca_id` de `detalle_w12` (la claveFlujo se evalúa sobre la unidad de
--   marca y se aplica en TypeScript).
--
-- * `equivalencia_id` de `filas`, `por_tienda` y `detalle_w12` solo viene si el
--   nodo es GMLE (`case when nivel_planificacion = 'GMLE' then e.id end`); en un
--   nodo GML es null y la fila agrupa todas sus equivalencias. En cambio
--   `equivalencias` (los pesos de la curva de un GML, que mezcla las curvas de
--   sus equivalencias) lleva siempre la equivalencia real.
--
-- * `p_grupos` es `{ "<tienda_id>": "<clave>" }`: la CLAVE DE PERTENENCIA de la
--   tienda a M(Y-3) ... M(Y+1), cinco caracteres 0/1 en ese orden. Una tienda de
--   tipo Tienda que no está en `p_grupos` recibe `00000` (fuera de toda M(Z)).
--   Agrupar `filas` por clave (pocas claves distintas, no una fila por tienda)
--   sirve a las barras históricas de cada año con su red, a la prueba con el año
--   anterior y a los dos años proyectados con la misma lectura.
--
-- * `equivalencias` y `detalle_w12` suman SOLO las tiendas con `1` en la posición
--   Y (la cuarta del texto: M(Y)) y periodo >= p_desde_w12.
--
-- * `cargas` sale del MISMO estado de datos (misma sentencia, mismo snapshot):
--   como en la 0017, la huella de cargas y la venta leída corresponden al mismo
--   estado. `calcular` compara `cargas` entre tandas y aborta con 409
--   `datos_cambiaron` si difieren. A lo sumo hay una carga publicada por periodo
--   (índice único parcial `cargas_periodo_publicada_uniq`).
--
-- * Orden determinista (`order by` dentro de `jsonb_agg`): con los mismos datos
--   el documento es idéntico. `numeric` y `bigint` salen como números JSON y
--   `date` como `aaaa-mm-dd`.
--
-- * Entradas nulas: `p_gml_ids` o `p_tiendas_detalle` nulos se leen como lista
--   vacía; `p_grupos` nulo deja todas las tiendas en `00000`; `p_desde` o
--   `p_desde_w12` nulos hacen que la sección correspondiente no filtre por
--   periodo inferior (el piso de lectura es el menor de los dos que no sea nulo;
--   con ambos nulos se lee todo el histórico).
--
-- POR QUÉ `jsonb` POR TANDAS Y NO UNA VISTA MATERIALIZADA: 06b abandonó la MV por
-- el candado y el refresco; aquí la lectura ocurre una vez por cálculo y su costo
-- es proporcional a la tanda. Un `jsonb` viaja en una sola respuesta (la tanda
-- supera el corte de 1 000 filas de PostgREST y paginar un `rpc` reejecutaría el
-- agregado en cada página). Plan B si el hito mide más de 30 s: subir TANDA_GML o
-- una MV con refresco por huella (0019), sin tocar la API.
--
-- COSTO (medido en vector-two el 2026-10-15, 870 mil hechos, 45 meses): una tanda
-- de 60 nodos tarda ~0,6 s de media (las 10 tandas de la base, 6,3 s en serie) y
-- ~3,5 s la tanda artificial de los 60 nodos con más hechos (527 mil hechos, 21 mil
-- filas, ~8 MB de jsonb). `hechos` se referencia cuatro veces: se materializa una
-- sola vez (`materialized`), con la clave de cada tienda, la unidad de marca y las
-- equivalencias del nodo ya resueltas en CTE pequeñas (unir tres veces `marcas` y
-- evaluar `p_grupos ->> tienda` por hecho costaba ~0,5 s más).
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
    -- Las tiendas son ~10: la clave se resuelve aquí, una vez por tienda, y no
    -- una vez por hecho (cientos de miles de lecturas de jsonb).
    select
      t.id as tienda_id,
      coalesce(p_grupos ->> t.id::text, '00000') as clave
    from public.tiendas t
    where t.tipo = 'Tienda'
  ),
  marcas_u as materialized (
    -- Marca -> unidad de marca -> agrupación de la unidad (la de la cabeza).
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
  'M7 0.10.0: venta de una tanda de nodos GML en un jsonb { filas (nodo x equivalencia si GMLE x agrupacion de la unidad de marca x clave de pertenencia a M(Y-3..Y+1) x mes), por_tienda (solo p_tiendas_detalle), equivalencias (pesos de la curva, tiendas con 1 en la posicion Y), detalle_w12 (marca de la unidad x talla, tiendas con 1 en Y), cargas (periodo aaaa-mm -> carga_id publicada, mismo estado de datos) }. Excluye el CD. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 3. `proyecciones` (el objeto de trabajo)
-- ---------------------------------------------------------------------------
-- Una proyección por año en curso (`anio_en_curso` = Y; el siguiente es Y + 1),
-- con estado `en_trabajo` -> `cerrada` -> `archivada`. A lo sumo UNA `cerrada`
-- por año en curso (índice único parcial): es lo que lee M8.
--
-- `parametros` (ParametrosProyeccion) y `resumen` son jsonb porque su forma
-- evoluciona con el método (`version_metodo` entra en el resumen). `parametros`
-- guarda la foto de los bloques de tiendas de M4 y de los factores del Niño que
-- se aplicaron, para que "desactualizada" compare contra lo usado.
--
-- `calculando_desde`: dato de la API (nunca se escribe desde esta migración). Lo
-- pone `calcular` al empezar y lo limpia al terminar o fallar; con menos de 15
-- minutos, `PUT` y otro `calcular` responden 409 `calculo_en_curso`; pasado ese
-- tiempo se considera abandonado y un `calcular` nuevo lo reemplaza.
--
-- `activo` por convención (PLAN §4); eliminar solo se permite en `en_trabajo` sin
-- decisiones (lo hace cumplir la API: si no, 409 y se archiva).
create table if not exists public.proyecciones (
  id uuid primary key default gen_random_uuid(),
  anio_en_curso integer not null
    constraint proyecciones_anio_check check (anio_en_curso between 2024 and 2100),
  nombre text not null
    constraint proyecciones_nombre_len_check check (length(nombre) between 1 and 80),
  estado text not null default 'en_trabajo'
    constraint proyecciones_estado_check
      check (estado in ('en_trabajo', 'cerrada', 'archivada')),
  -- Último mes cerrado `k`: primer día de un mes del año en curso. Solo se puede
  -- retroceder dentro del año en curso (lo valida la API).
  hasta_periodo date not null,
  parametros jsonb not null
    constraint proyecciones_parametros_check check (jsonb_typeof(parametros) = 'object'),
  resumen jsonb
    constraint proyecciones_resumen_check
      check (resumen is null or jsonb_typeof(resumen) = 'object'),
  calculando_desde timestamptz,
  calculado_at timestamptz,
  cerrada_at timestamptz,
  cerrada_por_id uuid
    constraint proyecciones_cerrada_por_id_fkey
      references public.perfiles(id) on delete set null,
  cerrada_por_nombre text,
  nota text
    constraint proyecciones_nota_len_check check (nota is null or length(nota) <= 500),
  perfil_id uuid
    constraint proyecciones_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- `hasta_periodo` es el primer día de un mes del año en curso.
  constraint proyecciones_hasta_periodo_check
    check (
      extract(day from hasta_periodo) = 1
      and extract(year from hasta_periodo) = anio_en_curso
    )
);

-- Una sola proyección CERRADA por año en curso: la garantía que M8 necesita. Al
-- cerrar, la anterior pasa a `archivada` ANTES (el orden lo respeta el backend,
-- que no tiene transacción: ver riesgos de la ficha).
create unique index if not exists proyecciones_cerrada_anio_uniq
  on public.proyecciones (anio_en_curso)
  where estado = 'cerrada';

-- Nombre único por año en curso, sin distinguir mayúsculas.
create unique index if not exists proyecciones_nombre_anio_uniq
  on public.proyecciones (anio_en_curso, upper(nombre));

-- Cubren las dos FK a `perfiles` (comprobación al eliminar un perfil).
create index if not exists proyecciones_perfil_id_idx
  on public.proyecciones (perfil_id);
create index if not exists proyecciones_cerrada_por_id_idx
  on public.proyecciones (cerrada_por_id);

create or replace trigger set_updated_at before update on public.proyecciones
  for each row execute function public.tg_set_updated_at();

comment on column public.proyecciones.calculando_desde is
  'Dato de la API (nunca de la migracion): lo pone calcular al empezar y lo limpia al terminar o fallar. Con menos de 15 minutos, PUT y otro calcular responden 409 calculo_en_curso; pasado ese tiempo se considera abandonado.';

-- ---------------------------------------------------------------------------
-- 4. `proyeccion_filas` (identidad, histórico y curva; base y por tienda)
-- ---------------------------------------------------------------------------
-- `tienda_id` nulo = FILA BASE (las mismas tiendas del año de cada registro, por
-- GML x agrupación de marca); no nulo = fila de esa tienda nueva o cierre. Las
-- decisiones cuelgan de estas filas (por eso llevan `id`).
--
-- `clave` = coalesce(tienda_id, '') | gml_id | coalesce(equivalencia_id, '') |
-- agrupacion_marca_id (texto, la arma el backend): identidad estable entre
-- cálculos, única por proyección; es el `onConflict` del upsert. Los nulos no
-- chocan en un UNIQUE normal, y la clave los resuelve sin `coalesce` de uuid.
--
-- `activo` CON USO: queda en `false` cuando un recálculo ya no encuentra la fila
-- (nodo desactivado, nivel cambiado, sin venta en 24 meses, tienda fuera de todo
-- bloque); conserva sus decisiones y no cuenta.
--
-- `historico` no lo seleccionan `matriz` ni `mensual` (pesa): es del detalle.
-- FKs `restrict`: no se elimina un nodo, equivalencia, agrupación o tienda que
-- una proyección usa (la API de M4 traduce el 23503 a 409 "archívala antes").
create table if not exists public.proyeccion_filas (
  id uuid primary key default gen_random_uuid(),
  proyeccion_id uuid not null
    constraint proyeccion_filas_proyeccion_id_fkey
      references public.proyecciones(id) on delete cascade,
  tienda_id uuid
    constraint proyeccion_filas_tienda_id_fkey
      references public.tiendas(id) on delete restrict,
  gml_id uuid not null
    constraint proyeccion_filas_gml_id_fkey
      references public.genero_mundo_linea(id) on delete restrict,
  equivalencia_id uuid
    constraint proyeccion_filas_equivalencia_id_fkey
      references public.equivalencias(id) on delete restrict,
  agrupacion_marca_id uuid not null
    constraint proyeccion_filas_agrupacion_marca_id_fkey
      references public.agrupaciones_marca(id) on delete restrict,
  clave text not null
    constraint proyeccion_filas_clave_len_check check (length(clave) between 1 and 300),
  -- Nivel del nodo al calcular (para el aviso `nivel_cambiado`).
  nivel_proyectado text not null
    constraint proyeccion_filas_nivel_check check (nivel_proyectado in ('GML', 'GMLE')),
  -- La agrupación de estacionalidad dominante de la unidad (empate: nombre).
  -- Solo etiqueta la fila para los filtros de temporada y agrupación.
  agrupacion_estacionalidad_id uuid
    constraint proyeccion_filas_agrupacion_estacionalidad_id_fkey
      references public.agrupaciones_estacionalidad(id) on delete restrict,
  temporada text
    constraint proyeccion_filas_temporada_check
      check (temporada is null or temporada in ('invierno', 'verano', 'todo_el_ano')),
  -- Doce fracciones que suman 1; nulo sin curva vigente.
  curva jsonb
    constraint proyeccion_filas_curva_check
      check (
        curva is null
        or case when jsonb_typeof(curva) = 'array'
                then jsonb_array_length(curva) = 12
                else false end
      ),
  -- [{ agrupacion_id, curva_id, version, peso }]
  curva_origen jsonb not null default '[]'::jsonb,
  -- { [anio]: number[12] }: factor del Niño por mes y año (M2); nulo en todo_el_ano.
  factores_mes jsonb,
  -- HistoricoFila: por año, los doce meses de M(Z), total, clase, tiendas del
  -- bloque, tendencia, prueba con el año anterior y pesos de equivalencias.
  historico jsonb not null,
  -- Solo filas base: participaciones históricas por claveFlujo y por talla sobre
  -- W12 y M(Y) (I6, contrato de M8).
  participaciones jsonb,
  -- Solo filas de tienda: { origen: referente | red | propia, s, p, unidades_maduras }.
  composicion jsonb,
  avisos jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un nodo GMLE lleva la equivalencia; un nodo GML no (igual que `venta_proyeccion`).
  constraint proyeccion_filas_nivel_equivalencia_check
    check ((nivel_proyectado = 'GMLE') = (equivalencia_id is not null)),
  -- Identidad estable por proyección; también es el `onConflict` del upsert y su
  -- primera columna cubre el índice de la FK a `proyecciones`.
  constraint proyeccion_filas_proyeccion_clave_key
    unique (proyeccion_id, clave)
);

create index if not exists proyeccion_filas_gml_idx
  on public.proyeccion_filas (proyeccion_id, gml_id);
create index if not exists proyeccion_filas_tienda_idx
  on public.proyeccion_filas (proyeccion_id, tienda_id);
-- Un índice por cada FK restrict que no queda cubierta por los dos anteriores
-- (eliminar una tienda, equivalencia, agrupación o nodo comprueba estas columnas).
create index if not exists proyeccion_filas_tienda_id_idx
  on public.proyeccion_filas (tienda_id);
create index if not exists proyeccion_filas_gml_id_idx
  on public.proyeccion_filas (gml_id);
create index if not exists proyeccion_filas_equivalencia_id_idx
  on public.proyeccion_filas (equivalencia_id);
create index if not exists proyeccion_filas_agrupacion_marca_id_idx
  on public.proyeccion_filas (agrupacion_marca_id);
create index if not exists proyeccion_filas_agrupacion_estacionalidad_id_idx
  on public.proyeccion_filas (agrupacion_estacionalidad_id);

create or replace trigger set_updated_at before update on public.proyeccion_filas
  for each row execute function public.tg_set_updated_at();

comment on column public.proyeccion_filas.tienda_id is
  'Nulo = fila base (mismas tiendas del anio de cada registro). No nulo = fila de esa tienda nueva o cierre (on delete restrict).';
comment on column public.proyeccion_filas.clave is
  'Identidad estable: coalesce(tienda_id, vacio) | gml_id | coalesce(equivalencia_id, vacio) | agrupacion_marca_id. La arma el backend; unica por proyeccion; es el onConflict del upsert.';
comment on column public.proyeccion_filas.activo is
  'Con uso: false cuando un recalculo ya no encuentra la fila (nodo desactivado, nivel cambiado, sin venta en 24 meses, tienda fuera de todo bloque). Conserva sus decisiones y no cuenta.';

-- ---------------------------------------------------------------------------
-- 5. `proyeccion_fila_anios` (los números de cada año y la decisión)
-- ---------------------------------------------------------------------------
-- Una fila por (fila, año): el mismo código y el mismo contrato sirven al año en
-- curso y al siguiente. Lo que decide Javier es `decidido`; el resto lo calcula el
-- sistema y se rehace en cada cálculo, SIN tocar nunca `decidido`, `origen`,
-- `nota` ni `propuesta_al_decidir`.
--
-- `bloque` `mismas` solo va con una fila base (`tienda_id` nulo); `nuevas` y
-- `cierres` solo con una fila de tienda. Ese cruce entre tablas no cabe en un
-- check: lo verifica la API. Sí cabe el cruce interno `subbloque` <-> `bloque`.
--
-- Decisión: `decidido` nulo = sin decidir; `origen` es nulo exactamente cuando
-- `decidido` es nulo. `propuesta_cambio` (calculado, no guardado) = decidido y
-- `propuesta_al_decidir` distinto de `propuesto`. `escalada` = cifra resultante
-- del total decidido de la tienda nueva.
--
-- Curva viva (I8): `curva_origen_usada` es la versión con la que se repartió ESTA
-- cifra; `curva_cambio` = difiere de la vigente. En registros decididos con curva
-- cambiada, `meses` y `curva_origen_usada` se conservan y el reparto con la curva
-- vigente va en `meses_propuestos` / `curva_origen_propuesta` hasta que el planner
-- lo aplica.
--
-- `vendido`: real hasta `k` (0 en el año siguiente). Entero >= 0: el vendido de
-- cada mes se trunca a 0 antes de sumar (aviso `mes_negativo`).
create table if not exists public.proyeccion_fila_anios (
  id uuid primary key default gen_random_uuid(),
  fila_id uuid not null
    constraint proyeccion_fila_anios_fila_id_fkey
      references public.proyeccion_filas(id) on delete cascade,
  anio integer not null
    constraint proyeccion_fila_anios_anio_check check (anio between 2024 and 2101),
  bloque text not null
    constraint proyeccion_fila_anios_bloque_check
      check (bloque in ('mismas', 'nuevas', 'cierres')),
  subbloque text
    constraint proyeccion_fila_anios_subbloque_check
      check (subbloque is null or subbloque in ('nuevas_anterior', 'aperturas')),
  vendido integer not null default 0
    constraint proyeccion_fila_anios_vendido_check check (vendido >= 0),
  -- Nulo sin curva o sin base.
  propuesto integer
    constraint proyeccion_fila_anios_propuesto_check check (propuesto is null or propuesto >= 0),
  metodo text not null default 'sin_propuesta'
    constraint proyeccion_fila_anios_metodo_check
      check (metodo in ('avance', 'plan_anterior', 'crecimiento', 'apertura',
                        'avance_propio', 'maduro_propio', 'cierre', 'sin_propuesta')),
  -- La otra cifra: V / C_k cuando el metodo es plan_anterior; por venta esperada
  -- en avance_propio y maduro_propio; por avance en apertura.
  referencia_alternativa integer,
  -- Ultimos tres meses, en filas de tienda con avance_propio.
  referencia_tres_meses integer,
  explicacion text not null default '',
  -- Override de la fila: solo año siguiente y bloque `mismas`.
  crecimiento_pct numeric(6, 2)
    constraint proyeccion_fila_anios_crecimiento_check
      check (crecimiento_pct is null or crecimiento_pct between -95 and 500),
  -- En filas de tienda es la cifra fijada a mano para esa fila (opcional).
  decidido integer
    constraint proyeccion_fila_anios_decidido_check check (decidido is null or decidido >= 0),
  origen text
    constraint proyeccion_fila_anios_origen_check
      check (origen is null or origen in ('propuesta', 'manual', 'escalada')),
  propuesta_al_decidir integer,
  nota text
    constraint proyeccion_fila_anios_nota_len_check check (nota is null or length(nota) <= 300),
  decidido_at timestamptz,
  decidido_por_id uuid
    constraint proyeccion_fila_anios_decidido_por_id_fkey
      references public.perfiles(id) on delete set null,
  decidido_por_nombre text,
  -- Doce enteros; su suma es el total vigente (lo prueba TypeScript).
  meses integer[]
    constraint proyeccion_fila_anios_meses_check
      check (meses is null or cardinality(meses) = 12),
  -- `real` o `proyectado` por mes.
  origen_meses text[]
    constraint proyeccion_fila_anios_origen_meses_check
      check (
        origen_meses is null
        or (cardinality(origen_meses) = 12
            and origen_meses <@ array['real', 'proyectado']::text[])
      ),
  curva_origen_usada jsonb not null default '[]'::jsonb,
  meses_propuestos integer[]
    constraint proyeccion_fila_anios_meses_propuestos_check
      check (meses_propuestos is null or cardinality(meses_propuestos) = 12),
  curva_origen_propuesta jsonb,
  avisos jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- `subbloque` solo existe en las tiendas nuevas.
  constraint proyeccion_fila_anios_subbloque_bloque_check
    check (subbloque is null or bloque = 'nuevas'),
  -- Decisión coherente: hay origen si y solo si hay cifra decidida.
  constraint proyeccion_fila_anios_decision_check
    check ((decidido is null) = (origen is null)),
  -- Un registro por fila y año; su primera columna cubre la FK a la fila.
  constraint proyeccion_fila_anios_fila_anio_key
    unique (fila_id, anio)
);

create index if not exists proyeccion_fila_anios_decidido_por_id_idx
  on public.proyeccion_fila_anios (decidido_por_id);

create or replace trigger set_updated_at before update on public.proyeccion_fila_anios
  for each row execute function public.tg_set_updated_at();

comment on column public.proyeccion_fila_anios.meses_propuestos is
  'I8: reparto con la curva vigente cuando el registro esta decidido y su curva cambio; nulo si coincide con meses. Aplicar curva nueva lo copia a meses y curva_origen_propuesta a curva_origen_usada.';

-- ---------------------------------------------------------------------------
-- 6. `proyeccion_tiendas` (la decisión por tienda nueva o cierre y año)
-- ---------------------------------------------------------------------------
-- Una fila por (proyección, tienda, año) con el total de la tienda: la foto de
-- lo usado al calcular (fecha, venta esperada, referente, rampa), la propuesta,
-- las referencias y la decisión. Sus filas GML x agrupación de marca viven en
-- `proyeccion_filas` (con `tienda_id`) y `proyeccion_fila_anios`.
--
-- `referente_id_usado` es una FOTO (uuid sin FK): si el referente cambia o se
-- elimina después, el registro conserva con quién se calculó y la proyección
-- queda `desactualizada` (`tiendas_cambiadas`).
-- `origen` de la decisión solo `propuesta` o `manual` (la escalada es de las
-- filas, no del total).
create table if not exists public.proyeccion_tiendas (
  id uuid primary key default gen_random_uuid(),
  proyeccion_id uuid not null
    constraint proyeccion_tiendas_proyeccion_id_fkey
      references public.proyecciones(id) on delete cascade,
  tienda_id uuid not null
    constraint proyeccion_tiendas_tienda_id_fkey
      references public.tiendas(id) on delete restrict,
  anio integer not null
    constraint proyeccion_tiendas_anio_check check (anio between 2024 and 2101),
  bloque text not null
    constraint proyeccion_tiendas_bloque_check check (bloque in ('nuevas', 'cierres')),
  subbloque text
    constraint proyeccion_tiendas_subbloque_check
      check (subbloque is null or subbloque in ('nuevas_anterior', 'aperturas')),
  -- Fecha de apertura o de cierre con la que se calculó.
  fecha_usada date not null,
  venta_esperada_usada numeric(14, 2)
    constraint proyeccion_tiendas_venta_esperada_check
      check (venta_esperada_usada is null or venta_esperada_usada >= 0),
  referente_id_usado uuid,
  origen_composicion text
    constraint proyeccion_tiendas_origen_composicion_check
      check (origen_composicion is null or origen_composicion in ('referente', 'red', 'propia')),
  -- Rampa de maduración usada: de uno a seis valores en (0, 5] (lo valida la API).
  rampa jsonb not null default '[1, 1, 1]'::jsonb
    constraint proyeccion_tiendas_rampa_check
      check (
        case when jsonb_typeof(rampa) = 'array'
             then jsonb_array_length(rampa) between 1 and 6
             else false end
      ),
  unidades_maduras integer
    constraint proyeccion_tiendas_unidades_maduras_check
      check (unidades_maduras is null or unidades_maduras >= 0),
  vendido integer not null default 0
    constraint proyeccion_tiendas_vendido_check check (vendido >= 0),
  propuesto integer
    constraint proyeccion_tiendas_propuesto_check check (propuesto is null or propuesto >= 0),
  metodo text not null default 'sin_propuesta'
    constraint proyeccion_tiendas_metodo_check
      check (metodo in ('avance', 'plan_anterior', 'crecimiento', 'apertura',
                        'avance_propio', 'maduro_propio', 'cierre', 'sin_propuesta')),
  decidido integer
    constraint proyeccion_tiendas_decidido_check check (decidido is null or decidido >= 0),
  origen text
    constraint proyeccion_tiendas_origen_check
      check (origen is null or origen in ('propuesta', 'manual')),
  propuesta_al_decidir integer,
  nota text
    constraint proyeccion_tiendas_nota_len_check check (nota is null or length(nota) <= 300),
  decidido_at timestamptz,
  decidido_por_id uuid
    constraint proyeccion_tiendas_decidido_por_id_fkey
      references public.perfiles(id) on delete set null,
  decidido_por_nombre text,
  explicacion text not null default '',
  referencia_alternativa integer,
  referencia_tres_meses integer,
  avisos jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proyeccion_tiendas_subbloque_bloque_check
    check (subbloque is null or bloque = 'nuevas'),
  constraint proyeccion_tiendas_decision_check
    check ((decidido is null) = (origen is null)),
  -- Una decisión por tienda y año; su primera columna cubre la FK a la proyección.
  constraint proyeccion_tiendas_proyeccion_tienda_anio_key
    unique (proyeccion_id, tienda_id, anio)
);

-- Cubre la FK `restrict` a `tiendas` (eliminar una tienda comprueba esta columna).
create index if not exists proyeccion_tiendas_tienda_id_idx
  on public.proyeccion_tiendas (tienda_id);
create index if not exists proyeccion_tiendas_decidido_por_id_idx
  on public.proyeccion_tiendas (decidido_por_id);

create or replace trigger set_updated_at before update on public.proyeccion_tiendas
  for each row execute function public.tg_set_updated_at();

comment on column public.proyeccion_tiendas.referente_id_usado is
  'Foto del referente con el que se calculo (uuid sin FK a proposito): si el referente cambia o se elimina despues, el registro conserva con quien se calculo y la proyeccion queda desactualizada.';

-- ---------------------------------------------------------------------------
-- 7. `factores_volumen_atipico` (el factor del Niño, editable)
-- ---------------------------------------------------------------------------
-- Un factor por año atípico y temporada: `ratio_calculado` lo trae M6 (a demanda,
-- `GET /api/periodos-atipicos/anios?con_volumen=1`, que M7 sincroniza por POST) y
-- `ratio_aplicado` lo escribe el planner; el efectivo es
-- `ratio_aplicado ?? ratio_calculado`. Es un hecho sobre el histórico, no un
-- supuesto de una proyección, por eso vive fuera de ella; cada proyección guarda
-- en `parametros.factores_usados` los que aplicó. `todo_el_ano` nunca se ajusta,
-- así que no es una temporada válida aquí.
-- `ratio_aplicado` en (0.05, 3], el mismo rango que valida la API.
create table if not exists public.factores_volumen_atipico (
  id uuid primary key default gen_random_uuid(),
  anio integer not null
    constraint factores_volumen_atipico_anio_check check (anio between 2000 and 2101),
  temporada text not null
    constraint factores_volumen_atipico_temporada_check
      check (temporada in ('invierno', 'verano')),
  ratio_calculado numeric(6, 4)
    constraint factores_volumen_atipico_ratio_calculado_check
      check (ratio_calculado is null or ratio_calculado > 0),
  ratio_aplicado numeric(6, 4)
    constraint factores_volumen_atipico_ratio_aplicado_check
      check (ratio_aplicado is null or (ratio_aplicado > 0.05 and ratio_aplicado <= 3)),
  huella_cargas text,
  calculado_at timestamptz,
  tiendas_comunes integer
    constraint factores_volumen_atipico_tiendas_comunes_check
      check (tiendas_comunes is null or tiendas_comunes >= 0),
  meses_comparados integer
    constraint factores_volumen_atipico_meses_comparados_check
      check (meses_comparados is null or meses_comparados >= 0),
  -- El año aún no está completo en los datos (p. ej. verano de 2026 con un mes).
  parcial boolean not null default false,
  nota text
    constraint factores_volumen_atipico_nota_len_check check (nota is null or length(nota) <= 200),
  perfil_id uuid
    constraint factores_volumen_atipico_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un factor por año y temporada.
  constraint factores_volumen_atipico_anio_temporada_key
    unique (anio, temporada)
);

create index if not exists factores_volumen_atipico_perfil_id_idx
  on public.factores_volumen_atipico (perfil_id);

create or replace trigger set_updated_at before update on public.factores_volumen_atipico
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.proyecciones enable row level security;
alter table public.proyeccion_filas enable row level security;
alter table public.proyeccion_fila_anios enable row level security;
alter table public.proyeccion_tiendas enable row level security;
alter table public.factores_volumen_atipico enable row level security;

revoke all on public.proyecciones from public, anon, authenticated;
grant all on public.proyecciones to service_role;

revoke all on public.proyeccion_filas from public, anon, authenticated;
grant all on public.proyeccion_filas to service_role;

revoke all on public.proyeccion_fila_anios from public, anon, authenticated;
grant all on public.proyeccion_fila_anios to service_role;

revoke all on public.proyeccion_tiendas from public, anon, authenticated;
grant all on public.proyeccion_tiendas to service_role;

revoke all on public.factores_volumen_atipico from public, anon, authenticated;
grant all on public.factores_volumen_atipico to service_role;

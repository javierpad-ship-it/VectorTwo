-- M6 06e · Cierre del año en curso por curva y base del año siguiente sin el Niño (método 5), versión 0.14.0.
--
-- Ficha: docs/modulos/06e-cierre-del-anio-y-base-sin-nino.md (§2 Modelo de datos, §5.6 Transición).
-- Numeración: la 0026 queda para 0.13.1 · M8 y la 0028 para M9a (ficha 06e, encabezado).
-- Depende de 0007, 0015, 0017, 0018, 0023 y 0027, todas aplicadas; NO depende de 0025 a 0028.
--
-- SE APLICA EN LA TANDA 1, ANTES DEL CÓDIGO DE 0.14.0, sobre la única base (producción) mientras
-- sigue desplegada 0.13.x: todo lo que añade es inocuo para ese código.
--   * Las columnas nuevas son nullable o llevan un default que reproduce el significado viejo.
--   * `venta_genero_mundo` conserva firma y forma; solo gana la clave `a` por serie, que el
--     lector de 0.12.1/0.13.x ignora y suma (ficha R21).
--
-- Qué hace:
--   1. `crecimientos_genero_mundo.sobre_base`: sobre qué base se escribió el % (bruta | corregida).
--   2. `proyeccion_crecimientos.sobre_base`: la foto de lo aplicado repite ese valor.
--   3. `factores_volumen_atipico`: seis columnas para el factor del Niño relativo (fórmula,
--      ratio de volumen, ratio de control, huella de composición, huella con que se confirmó
--      y diagnóstico mes a mes).
--   4. Comentarios de columnas que cambian de significado sin migración de datos
--      (`pct`, `meses_comparados`, `proyeccion_fila_anios.base_normalizada`).
--   5. `venta_genero_mundo(p_desde date)`: misma firma, una dimensión más (la agrupación `a`).
--
-- Idempotente: `add column if not exists` (que omite también los checks en línea si la columna ya
-- existe), `create or replace function`, `revoke`/`grant`/`comment` repetibles. Sin bloques
-- `do $$ ... $$` (las comillas de dólar del cuerpo de la función no son un bloque anónimo).
-- SIN DROP, DELETE, TRUNCATE ni UPDATE (tampoco dentro de la función), SIN backfill y SIN ningún
-- `alter column ... set default`: las migraciones se aplican con `execute_sql` y esas sentencias
-- se quedan esperando una confirmación que nunca llega.
--
-- Seguridad: no hay tablas nuevas; las tres tablas tocadas ya tienen RLS activo y SIN políticas
-- (solo entra el backend con service_role). La función conserva `security invoker`,
-- `search_path = ''`, `revoke` a public, anon y authenticated y `grant` a service_role.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `crecimientos_genero_mundo.sobre_base` (B1 de la revisión)
-- ---------------------------------------------------------------------------
-- UNA SOLA sentencia, y el default es `bruta` PARA SIEMPRE (nunca `set default`, ni ahora ni
-- después). Valores:
--   * bruta      el % es `Y+1 / Y real - 1`: toda versión escrita por 0.12.1 o 0.13.x, que no
--                conocen esta columna y no la envían en el `insert`.
--   * corregida  el % es sobre `Y` corregido del Niño de las mismas tiendas de Y+1: solo la
--                escribe la API de 0.14.0, SIEMPRE explícita en el `insert`.
-- Por qué `bruta` y no `corregida` (B1): Javier va a aprobar crecimientos con 0.13.x entre esta
-- migración y el despliegue de 0.14.0. Con un default `corregida`, esas versiones quedarían
-- marcadas como corregidas aunque la pantalla vieja las presentó brutas, y al desplegar sus
-- líneas de invierno saltarían a `B' x (1+g)` sin pedir reaprobar. Con default `bruta`, una fila
-- sin el valor explícito es siempre una versión vieja, que es exactamente su significado.
-- Sin `check` de catálogo (mismo criterio que `alcance` y `base_tipo` en 0027): lo valida zod.
alter table public.crecimientos_genero_mundo
  add column if not exists sobre_base text not null default 'bruta';

comment on column public.crecimientos_genero_mundo.sobre_base is
  'M6 06e: sobre que base se escribio el pct. bruta = Y+1 / Y real - 1 (toda version de 0.12.1 y 0.13.x; default para siempre, nunca set default). corregida = sobre Y corregido del Nino de las mismas tiendas de Y+1 (solo la API de 0.14.0, siempre explicita en el insert). Sin check de catalogo: lo valida zod (SOBRE_BASE).';

-- `pct` conserva su check (-95 a 500); solo cambia su lectura según `sobre_base`.
comment on column public.crecimientos_genero_mundo.pct is
  'M6 06d/06e: variacion porcentual de Y+1 respecto de la base de las mismas tiendas de Y+1. Se interpreta segun sobre_base: bruta = Y real (sin corregir por el Nino); corregida = Y corregido del Nino. Rango -95..500, igual que proyeccion_crecimientos.pct.';

-- ---------------------------------------------------------------------------
-- 2. `proyeccion_crecimientos.sobre_base` (la foto de lo aplicado)
-- ---------------------------------------------------------------------------
-- Nullable y sin default: `null` = foto escrita antes de 0.14.0 y se lee como `bruta`. Cada
-- cálculo de 0.14.0 reescribe la foto con el valor explícito de la versión aplicada, así las
-- explicaciones y las lecturas saben cómo se aplicó cada GM sin leer `crecimientos_genero_mundo`.
-- El Resto usado va en `proyecciones.parametros.crecimiento_resto_usado.sobre_base` (clave nueva
-- del jsonb, sin migración).
alter table public.proyeccion_crecimientos
  add column if not exists sobre_base text;

comment on column public.proyeccion_crecimientos.sobre_base is
  'M6 06e: sobre_base de la version aplicada (bruta | corregida), copiada de crecimientos_genero_mundo en cada calculo. Nulo = foto escrita antes de 0.14.0: se lee como bruta. Sin check de catalogo: lo valida zod.';

-- ---------------------------------------------------------------------------
-- 3. `factores_volumen_atipico`: columnas del factor relativo (D3, D4, D5)
-- ---------------------------------------------------------------------------
-- Todas nullable y sin default. Con `add column if not exists` el check en línea se omite si la
-- columna ya existe (repetir la migración no falla ni duplica el check).
-- 0.13.x sigue escribiendo `ratio_calculado`, `huella_cargas`, `parcial`, `tiendas_comunes` y
-- `meses_comparados` y deja estas columnas en null: esas filas quedan con `formula` nula (fórmula
-- vieja), que es la verdad. Nada de UPDATE: las filas existentes se ponen al día con
-- «Sincronizar» en 0.14.0.
alter table public.factores_volumen_atipico
  add column if not exists formula text;

alter table public.factores_volumen_atipico
  add column if not exists ratio_volumen numeric(6, 4)
    constraint factores_volumen_atipico_ratio_volumen_check
      check (ratio_volumen is null or ratio_volumen > 0);

alter table public.factores_volumen_atipico
  add column if not exists ratio_control numeric(6, 4)
    constraint factores_volumen_atipico_ratio_control_check
      check (ratio_control is null or ratio_control > 0);

alter table public.factores_volumen_atipico
  add column if not exists huella_composicion text;

alter table public.factores_volumen_atipico
  add column if not exists aplicado_huella text;

alter table public.factores_volumen_atipico
  add column if not exists diagnostico jsonb;

comment on column public.factores_volumen_atipico.formula is
  'M6 06e: formula con que se escribio ratio_calculado. relativo_periodo desde 0.14.0. Nulo = formula vieja (ratio de volumen sobre todos los meses publicados): es factor desfasado si es de Y. Sin check de catalogo: lo valida el codigo.';
comment on column public.factores_volumen_atipico.ratio_volumen is
  'M6 06e: rho_P, ratio de volumen de la temporada en los meses del periodo atipico (mismas tiendas, anio normal mas cercano). Solo se muestra. Nulo en filas de 0.13.x. Mayor que 0.';
comment on column public.factores_volumen_atipico.ratio_control is
  'M6 06e: kappa_P, ratio de la red de todo el anio en los mismos meses y tiendas. ratio_calculado = ratio_volumen / ratio_control (factor relativo). Solo se muestra. Mayor que 0.';
comment on column public.factores_volumen_atipico.huella_composicion is
  'M6 06e: md5 de las huellas de composicion (equivalencias activas) de las agrupaciones de la temporada y de todo_el_ano con que se calculo. Remapear una equivalencia mueve el factor y deja la fila desfasada.';
comment on column public.factores_volumen_atipico.aplicado_huella is
  'M6 06e: huella_cargas de la fila en el momento en que se escribio ratio_aplicado. Confirma el factor contra el calculo que tenia delante quien lo escribio (factor_sin_confirmar). Nulo si no hay ratio_aplicado.';
comment on column public.factores_volumen_atipico.diagnostico is
  'M6 06e: diagnostico mes a mes del periodo (por mes m, en_periodo, u, u_ref, ratio, control, relativo; y ratio_fuera, meses_periodo, meses_periodo_con_dato). Lo valida el codigo, sin check.';
comment on column public.factores_volumen_atipico.meses_comparados is
  'Desde 0.14.0 (formula relativo_periodo): numero de meses del periodo atipico comparados (|P|). Con formula nula conserva el significado viejo: meses publicados comparados del anio.';
comment on column public.factores_volumen_atipico.ratio_calculado is
  'Factor calculado. Desde 0.14.0 es relativo: ratio_volumen / ratio_control en los meses del periodo (nulo con menos de 2 meses del periodo). Con formula nula es el ratio de volumen viejo sobre todos los meses publicados.';

-- ---------------------------------------------------------------------------
-- 4. `proyeccion_fila_anios.base_normalizada` cambia de significado (solo comentario)
-- ---------------------------------------------------------------------------
-- Desde el método 5 guarda B', la base de Y corregida del Niño (lo que habrían vendido las
-- mismas tiendas de Y+1 en un año normal), y ya no B'' = B' x suma(c phi_{Y+1}). Las proyecciones
-- de método 4 quedan desactualizadas y la pantalla de GM las ignora (version_metodo < 5).
-- `base_siguiente` (B, real) no cambia.
comment on column public.proyeccion_fila_anios.base_normalizada is
  'M6 06e: desde el metodo 5 es B, la base de Y corregida del Nino (lo que habrian vendido las mismas tiendas de Y+1 en un anio normal). Antes (metodo 4) era B normalizada con el factor de Y+1. base_siguiente (B real) no cambia.';

-- ---------------------------------------------------------------------------
-- 5. `venta_genero_mundo(p_desde date)`: misma firma, una dimensión más
-- ---------------------------------------------------------------------------
-- Devuelve, en UNA sola sentencia (un solo estado de los datos):
--
--   {
--     "series": [ { "g": genero_id, "m": mundo_id,
--                   "temp": "invierno|verano|todo_el_ano|sin_agrupacion",
--                   "a": agrupacion_estacionalidad_id | null,
--                   "t": tienda_id, "u": { "2023-01": 120, "2023-02": 98, ... } } ],
--     "cargas": { "2023-01": "<carga_id>", ... }
--   }
--
-- Lo ÚNICO nuevo respecto de 0027 es `a` y que el agrupamiento pasa a (g, m, a, t) en lugar de
-- (g, m, temp, t). `temp` se mantiene (es función de `a`). `a` es null cuando la equivalencia no
-- tiene agrupación ACTIVA (sin agrupación o con agrupación inactiva): ahí `temp` es
-- 'sin_agrupacion', igual que en 0027. El cierre por curva de la pantalla de GM necesita lo
-- vendido por agrupación, cada una con su curva vigente.
--
-- COMPATIBLE HACIA ATRÁS: el lector de 0.12.1/0.13.x (`comoVentaGeneroMundo`) ignora `a` y suma
-- las entradas que comparten (g, m, temp, t), así que con la migración aplicada antes del código
-- todo da lo mismo (ficha R21). Dos agrupaciones de la misma temporada ahora salen en series
-- separadas; sumadas dan la serie anterior.
--
-- Todo lo demás es idéntico a 0027: unidades netas (suma de `unidades`, sin filtrar signos),
-- solo tiendas de tipo `Tienda`, periodo >= p_desde, sin filtrar por `tiendas.activo` ni por
-- `equivalencias.activo`; el GM sale del árbol vigente (`equivalencias -> genero_mundo_linea`);
-- `cargas` sale del mismo CTE `meses` dentro de la misma sentencia (hay a lo sumo una carga
-- publicada por periodo, índice único parcial `cargas_periodo_publicada_uniq`).
--
-- PREAGREGACIÓN por (equivalencia, tienda, periodo) sobre `venta_stock_vigente` como en 0027 y
-- solo después se sube a GM x agrupación x tienda. Orden determinista (`order by` dentro de
-- `jsonb_agg`, con `a` nulo primero): mismos datos, mismo documento (útil para las huellas).
-- `jsonb` y no `setof` porque las series superan el corte de 1 000 filas de PostgREST.
--
-- MEDICIÓN en vector-two: ver el bloque «MEDICIÓN 0029» al final de este archivo.
--
-- `stable`, `security invoker` y `search_path` vacío (todo calificado con esquema): la ejecuta
-- solo el backend (`service_role`). El cuerpo va sin comentarios `--` (el SQL Editor de
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
      a.id as agrupacion_id,
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
    group by n.genero_id, n.mundo_id, a.id, coalesce(a.temporada, 'sin_agrupacion'), p.tienda_id, p.periodo
  ),
  series as (
    select
      c.genero_id,
      c.mundo_id,
      c.agrupacion_id,
      c.temporada,
      c.tienda_id,
      jsonb_object_agg(to_char(c.periodo, 'YYYY-MM'), c.unidades order by c.periodo) as u
    from celdas c
    group by c.genero_id, c.mundo_id, c.agrupacion_id, c.temporada, c.tienda_id
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
                    'a', s.agrupacion_id,
                    't', s.tienda_id,
                    'u', s.u
                  )
                  order by s.genero_id, s.mundo_id, s.temporada, s.agrupacion_id nulls first, s.tienda_id
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
  'M6 06d/06e: venta publicada por genero x mundo (arbol vigente) x agrupacion de estacionalidad x tienda (solo tipo Tienda) desde p_desde, en un jsonb { series [ { g, m, temp, a, t, u { aaaa-mm: unidades netas } } ], cargas (periodo aaaa-mm -> carga_id publicada, mismo estado de datos) }. a = id de la agrupacion activa de la equivalencia o null (sin agrupacion activa; temp = sin_agrupacion). Preagrega por (equivalencia, tienda, periodo) antes de subir a GM. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 6. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
-- No hay tablas nuevas; las tres ya lo tienen (0018, 0023 y 0027). Repetirlo es inocuo.
alter table public.crecimientos_genero_mundo enable row level security;
alter table public.proyeccion_crecimientos enable row level security;
alter table public.factores_volumen_atipico enable row level security;

-- MEDICIÓN 0029 en vector-two (2026-10-30, `p_desde = 2023-01-01`, 870 359 filas de
-- `venta_stock_vigente`), `explain (analyze, buffers)` de
-- `select public.venta_genero_mundo('2023-01-01')`, tres pasadas seguidas justo después de aplicar:
--   * 4 688 ms (primera pasada, en frío, fuera del presupuesto), luego 1 674 ms y 1 544 ms
--     (≈ 1,6 s, dentro del presupuesto <= 3 s). Mismos buffers en las tres (`shared hit=276566`,
--     `temp read=7803 written=11216`): la primera pasada fue ruido de arranque del servidor, no
--     del plan. Si en producción vuelve a salir > 3 s en frío, la palanca es `p_desde` (enero
--     de Y-3) o subir `work_mem` de la sesión; no hay plan B de esquema (ficha 06e §2.5, M10).
--   * Resultado: 851 series (GM x agrupación x tienda), 25 403 celdas tienda x mes,
--     14 agrupaciones distintas en `a`, ninguna serie con `a` nulo (toda equivalencia con venta
--     tiene hoy agrupación activa); 554 224 bytes de texto. Coincide con lo medido por el
--     revisor (851 series, 25 403 celdas, 1 614 ms).

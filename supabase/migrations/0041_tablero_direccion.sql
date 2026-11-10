-- M14 · Tablero de aprobación de dirección (versión 0.19.0 · M14): registro inmutable de aprobaciones y lecturas del tablero.
--
-- Ficha: docs/modulos/14-dashboard-aprobacion-direccion.md (§2 modelo de datos, §2.3 las cuatro funciones, §2.4 rendimiento).
-- NUMERACIÓN: la 0041 es de M14 (decisión 140: se retira su reserva para la tabla de agregados de venta, que tendrá su propia ficha).
-- Depende de 0000 (`tg_set_updated_at`), 0001 (árbol), 0002 y 0010 (`marcas`, `marcas_unidad`), 0004 (`tiendas`), 0006 (`perfiles`),
-- 0007 (`venta_stock_vigente`), 0018 (`proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios`, `proyeccion_tiendas`), 0023 y 0029
-- (`proyeccion_crecimientos`, `base_siguiente`, `base_normalizada`) y 0035 (`migraciones_aplicadas`).
--
-- SE APLICA ANTES DEL CÓDIGO DE 0.19.0: todo lo que añade es inocuo para el código anterior (una tabla nueva y cinco funciones nuevas).
-- Ninguna tabla ni columna existente cambia. No hay seed ni backfill.
--
-- Qué hace:
--   1. `aprobaciones_direccion`: una fila por acto de aprobación de dirección (aprobada, con observaciones o rechazada) sobre una
--      proyección ENTERA, atada a su huella de cifras. SOLO INSERCIÓN: el estado se deriva al leer (manda la más reciente).
--   2. `tg_aprobaciones_direccion_inmutable()`: trigger por fila (update y delete) y por sentencia (truncate).
--   3. `huella_proyeccion(id)`: md5 de las cifras de una proyección, por contenido (no por identificador).
--   4. `tablero_proyeccion(id, p)`: lo proyectado, agregado para el tablero (trae su huella en la misma sentencia).
--   5. `tablero_venta(p)`: la venta publicada, agregada para el tablero (sin CD salvo su stock del último mes).
--   6. `registrar_aprobacion_direccion(p)`: la ÚNICA escritura de `aprobaciones_direccion`.
--
-- Idempotente: `create table if not exists`, `create index if not exists`, `create or replace function`, `create or replace trigger`,
-- `revoke`/`grant`/`comment` repetibles y registro final con `on conflict do nothing`. Sin `do $$ ... $$`. Sin `drop`, `delete`,
-- `truncate` ni `update` (ni a nivel de migración ni dentro de las funciones: `registrar_aprobacion_direccion` solo inserta).
-- Los cuerpos de las funciones van sin comentarios `--` (el SQL Editor de Supabase los parsea mal dentro de `$$`): lo que hay que saber
-- de cada una está aquí, encima. Todos los identificadores miden <= 63 caracteres.
--
-- Seguridad: RLS activo y SIN políticas (solo entra el backend con `service_role`); `anon` y `authenticated` sin privilegios;
-- `service_role` solo `select, insert` sobre la tabla (regla de la 0035 y H-6 de la 0040: sin update, delete, truncate, references ni
-- trigger). Funciones `security invoker`, `search_path` vacío, todo calificado con esquema, `execute` solo para `service_role`. Las
-- listas de ids entran como arreglos dentro del `jsonb` (sin SQL dinámico). `tablero_venta` lee de `venta_stock_vigente` únicamente
-- unidades, soles de venta y stock en unidades: ni costo ni stock valorizado (lo comprueba una prueba estática leyendo este archivo,
-- por eso esas dos columnas no se nombran en ninguna parte de él).

-- ---------------------------------------------------------------------------
-- 1. `aprobaciones_direccion` (solo inserción; ficha §2.1)
-- ---------------------------------------------------------------------------
-- `proyeccion_id` con `restrict`: una proyección con aprobaciones no se elimina (la API lo traduce a `409 tiene_aprobaciones`); borrar
-- una proyección no debe borrar el rastro de una decisión de dirección. `estado_proyeccion` es el estado AL APROBAR (una archivada no
-- se aprueba). `huella` es la de `huella_proyeccion` RECALCULADA por `registrar_aprobacion_direccion`, nunca la del cliente.
-- `resumen` es la foto de lo aprobado (forma en la ficha §3.3, `ResumenAprobacionApi`) y debe traer LA MISMA huella (D10).
-- `perfil_id` con `set null` para no impedir eliminar un usuario: quedan el nombre y el rol.
-- `rol`: hoy solo aprueba el admin (D7); un rol aprobador futuro exigirá su propia migración, que es donde debe decidirse.
-- `activo` y `updated_at` van por convención y no se usan: no se «desactiva» una aprobación, se registra otra.
--
-- DOS DETALLES de los `check` (más estrictos que un `=` simple, mismo propósito):
--   * `resumen ->> 'huella' is not distinct from huella` y no `=`: con `=`, un resumen SIN la clave `huella` da NULL y un `check`
--     deja pasar el NULL. `huella` es `not null`, así que `is not distinct from` solo es verdadero si la clave existe y coincide.
--   * `jsonb_typeof(resumen) = 'object'`: un escalar o un arreglo no tienen clave `huella` (lo cubre el anterior), pero así el
--     mensaje de error dice qué falló.
-- A propósito NO hay único sobre (proyeccion_id, huella): dos aprobaciones simultáneas con la misma huella son dos filas de historial.
create table if not exists public.aprobaciones_direccion (
  id uuid primary key default gen_random_uuid(),
  proyeccion_id uuid not null
    constraint aprobaciones_direccion_proyeccion_id_fkey
      references public.proyecciones(id) on delete restrict,
  anio_en_curso integer not null
    constraint aprobaciones_direccion_anio_check
      check (anio_en_curso between 2024 and 2100),
  estado_proyeccion text not null
    constraint aprobaciones_direccion_estado_proyeccion_check
      check (estado_proyeccion in ('en_trabajo', 'cerrada')),
  huella text not null
    constraint aprobaciones_direccion_huella_check
      check (huella ~ '^[0-9a-f]{32}$'),
  resultado text not null
    constraint aprobaciones_direccion_resultado_check
      check (resultado in ('aprobada', 'con_observaciones', 'rechazada')),
  motivo text
    constraint aprobaciones_direccion_motivo_check
      check (motivo is null or motivo in ('crecimiento_alto', 'crecimiento_bajo', 'contra_tendencia', 'tiendas_nuevas', 'nino',
                                          'filas_sin_decidir', 'concentracion', 'otro')),
  comentario text
    constraint aprobaciones_direccion_comentario_len_check
      check (comentario is null or char_length(comentario) <= 1000),
  resumen jsonb not null
    constraint aprobaciones_direccion_resumen_objeto_check
      check (jsonb_typeof(resumen) = 'object')
    constraint aprobaciones_direccion_resumen_tamano_check
      check (pg_column_size(resumen) <= 65536),
  perfil_id uuid
    constraint aprobaciones_direccion_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text not null
    constraint aprobaciones_direccion_usuario_nombre_len_check
      check (char_length(usuario_nombre) between 1 and 200),
  rol text not null
    constraint aprobaciones_direccion_rol_check
      check (rol = 'admin'),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La foto y la huella son del mismo estado (D10, R14).
  constraint aprobaciones_direccion_resumen_huella_check
    check ((resumen ->> 'huella') is not distinct from huella),
  -- Con observaciones o rechazada: motivo del catálogo y comentario de al menos 10 caracteres (R18).
  constraint aprobaciones_direccion_motivo_comentario_check
    check (resultado = 'aprobada' or (motivo is not null and comentario is not null and char_length(btrim(comentario)) >= 10))
);

-- Estado e historial de una proyección, de la más reciente a la más antigua; el prefijo (proyeccion_id) cubre la FK.
create index if not exists aprobaciones_direccion_proyeccion_created_idx
  on public.aprobaciones_direccion (proyeccion_id, created_at desc);
-- La última aprobada o con observaciones de cualquier proyección («Comparar con» por defecto, D6).
create index if not exists aprobaciones_direccion_no_rechazada_idx
  on public.aprobaciones_direccion (created_at desc) where resultado <> 'rechazada';
create index if not exists aprobaciones_direccion_perfil_id_idx
  on public.aprobaciones_direccion (perfil_id);

comment on table public.aprobaciones_direccion is
  'M14 0.19.0: una fila por acto de aprobacion de direccion sobre una proyeccion ENTERA (aprobada, con_observaciones o rechazada), atada a la huella de cifras de huella_proyeccion. INMUTABLE (insert-only): tg_aprobaciones_direccion_inmutable rechaza update, delete y truncate, tambien para service_role; excepcion: perfil_id a NULL. El estado se deriva al leer: manda la mas reciente de la proyeccion y vale solo si su huella es la actual. Solo la escribe registrar_aprobacion_direccion. No bloquea el cierre ni el flujo (decision 138).';
comment on column public.aprobaciones_direccion.huella is
  'M14: la de huella_proyeccion recalculada por registrar_aprobacion_direccion al insertar (nunca la del cliente). Si difiere de la huella actual de la proyeccion, la aprobacion esta invalidada.';
comment on column public.aprobaciones_direccion.estado_proyeccion is
  'M14: estado de la proyeccion AL APROBAR (en_trabajo o cerrada). Una archivada no se aprueba.';
comment on column public.aprobaciones_direccion.resumen is
  'M14 (D10): foto de lo aprobado (ResumenAprobacionApi de la ficha 14, 3.3) para leerla aunque la proyeccion cambie. Debe traer la misma huella que la columna huella. Hasta 64 KB.';
comment on column public.aprobaciones_direccion.rol is
  'M14 (D7): solo aprueba el admin. Un rol aprobador nuevo exige su propia migracion.';

-- ---------------------------------------------------------------------------
-- 2. Trigger de inmutabilidad (por fila y por sentencia)
-- ---------------------------------------------------------------------------
-- Mismo patrón que `tg_proveedor_eventos_inmutable` (0039) y `tg_proyeccion_lote_inmutable` (0031): rechaza DELETE, TRUNCATE (trigger
-- por sentencia: uno por fila no lo cubre) y todo UPDATE salvo el que SOLO pone `perfil_id` en NULL (lo emite la FK `on delete set null`
-- al borrar un perfil), con todo lo demás igual. Vale para TODOS los roles, `service_role` y el dueño incluidos. SQLSTATE
-- `restrict_violation`. Las ramas de DELETE y TRUNCATE no tocan `old` ni `new` (en TRUNCATE no existen).
-- ORDEN DE TRIGGERS: los `before update` de una tabla se disparan por orden alfabético de nombre. `aprobaciones_direccion_inmutable`
-- corre ANTES que `set_updated_at`, así que cuando compara `new` con `old` el `updated_at` aún no cambió. No renombrar ninguno de los
-- dos de forma que se invierta ese orden (el humo borra un perfil y comprueba que `perfil_id` queda en NULL).
create or replace function public.tg_aprobaciones_direccion_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.perfil_id is not null
       and new.perfil_id is null
       and (to_jsonb(new) - 'perfil_id') = (to_jsonb(old) - 'perfil_id') then
      return new;
    end if;
  end if;
  raise exception 'aprobaciones_direccion es un registro inmutable'
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_aprobaciones_direccion_inmutable() from public, anon, authenticated;
grant execute on function public.tg_aprobaciones_direccion_inmutable() to service_role;

comment on function public.tg_aprobaciones_direccion_inmutable() is
  'M14: trigger de aprobaciones_direccion. Rechaza delete, truncate y todo update salvo el que solo pone perfil_id en NULL (FK set null). Vale tambien para service_role.';

create or replace trigger aprobaciones_direccion_inmutable
  before update or delete on public.aprobaciones_direccion
  for each row execute function public.tg_aprobaciones_direccion_inmutable();
create or replace trigger aprobaciones_direccion_sin_vaciado
  before truncate on public.aprobaciones_direccion
  for each statement execute function public.tg_aprobaciones_direccion_inmutable();

-- Por convención (no se dispara en la práctica: el único update admitido es el de la FK `set null`).
create or replace trigger set_updated_at
  before update on public.aprobaciones_direccion
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. `huella_proyeccion(p_proyeccion_id uuid) returns text` (ficha §2.3 a)
-- ---------------------------------------------------------------------------
-- md5 de un texto canónico armado POR CONTENIDO (D9): dos proyecciones con las mismas cifras tienen la misma huella (una copia sin
-- cambios), porque se usa la `clave` de cada fila (`tienda|gml|equivalencia|agrupacion_marca`, única por proyección, 0018) y no
-- `proyeccion_id` ni `fila_id`. Cada campo va con `coalesce(campo::text, '~')`, los campos de una línea unidos por `|`, las líneas por
-- salto de línea y cada línea empieza con su etiqueta. Orden total determinista:
--   0. `v|1`  LA VERSIÓN DE LA FÓRMULA. Cambiar cualquier cosa de este texto (un campo, un orden, un formato) cambia la huella de
--      TODAS las proyecciones y, por tanto, INVALIDA TODAS LAS APROBACIONES VIGENTES (su huella guardada deja de coincidir). Quien
--      cambie la fórmula debe subir este número en la misma migración y saber que dirección tendrá que volver a aprobar.
--   1. `p|anio_en_curso|hasta_periodo|version_metodo`  (NO entran id, nombre, estado, nota, cerrada_at ni updated_at).
--   2. `b|anio|grupo|subbloque|tienda_id|clave`  por cada tienda de `parametros.bloques` (cada año presente; grupos mismas, nuevas,
--      cierres y fuera), por (anio, grupo, tienda_id). SOLO PERTENENCIA: renombrar una tienda o cambiar su zona no mueve la huella.
--   3. `f|clave|anio|bloque|subbloque|propuesto|vigente|B|B'|meses`  por cada registro activo de fila activa, por (clave, anio);
--      vigente = coalesce(decidido, propuesto); `meses` como texto del arreglo.
--   4. `t|tienda_id|anio|coalesce(decidido, propuesto)`  por cada `proyeccion_tiendas` activa, por (tienda_id, anio).
--   5. `c|genero_id|mundo_id|pct|sobre_base`  por cada `proyeccion_crecimientos` ACTIVO, por (genero_id, mundo_id); y
--      `r|pct|sobre_base` del RESTO QUE DE VERDAD SE APLICÓ: `parametros.crecimiento_resto_usado` (lo escribe cada cálculo). NO se usa
--      `parametros.crecimiento_pct_defecto`: es el provisional que se fija al crear la proyección y nunca se sobrescribe (en vector-two
--      vale 20 mientras el aplicado es −3 sobre la base corregida). Si `crecimiento_resto_usado` falta (proyección sin calcular o de
--      antes de 0.12.1) o su `pct` no es un número, la línea es el valor fijo `r|~|~`. El `pct` va sin ceros de cola (5 y 5.0 dan lo
--      mismo); `at`, `por_nombre`, `version` y `crecimiento_id` del Resto no entran.
-- Devuelve 32 caracteres hexadecimales, o NULL si la proyección no existe. Entra todo lo que mueve una cifra que dirección ve; no
-- entran estado, nombre, notas, autores ni fechas: CERRAR SIN CAMBIAR CIFRAS NO INVALIDA (R12). md5 porque es nativo y detecta
-- cambios; no es un control contra un atacante (quien escribe la proyección ya es planner).
--
-- Tres precauciones para que el mismo contenido dé SIEMPRE el mismo texto, sea cual sea la sesión:
--   * `hasta_periodo` va con `to_char(..., 'YYYY-MM-DD')` y no con `::text`, que depende de `DateStyle`.
--   * El orden por texto usa `collate "C"` (byte a byte), que no depende de la configuración regional de la base.
--   * `parametros.bloques` se recorre con guardas de tipo: si no es un objeto de objetos de arreglos, esa parte queda vacía en lugar
--     de lanzar un error. `tienda_id` se compara como texto (no se convierte a uuid).
-- Los numéricos (`base_normalizada` numeric(14,2), `pct` numeric(6,2)) tienen escala fija, así que su `::text` es estable.
-- La `clave` de una fila contiene `|` (es `tienda|gml|equivalencia|agrupacion_marca`), el mismo separador de los campos, pero
-- SIEMPRE tiene exactamente 4 partes (las vacías también se escriben), así que cada línea `f` tiene un número fijo de campos y no
-- hay dos contenidos distintos que den el mismo texto.
create or replace function public.huella_proyeccion(p_proyeccion_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select md5(concat_ws(E'\n',
    concat_ws('|', 'v', '1'),
    concat_ws('|',
      'p',
      pp.anio_en_curso::text,
      to_char(pp.hasta_periodo, 'YYYY-MM-DD'),
      coalesce(pp.resumen ->> 'version_metodo', '~')
    ),
    (
      select string_agg(x.linea, E'\n' order by x.anio collate "C", x.grupo collate "C", x.tienda collate "C", x.linea collate "C")
      from (
        select
          an.anio,
          gr.grupo,
          coalesce(ti.t ->> 'tienda_id', '~') as tienda,
          concat_ws('|',
            'b',
            an.anio,
            gr.grupo,
            coalesce(ti.t ->> 'subbloque', '~'),
            coalesce(ti.t ->> 'tienda_id', '~'),
            coalesce(ti.t ->> 'clave', '~')
          ) as linea
        from jsonb_each(
               case when jsonb_typeof(pp.parametros -> 'bloques') = 'object' then pp.parametros -> 'bloques' else '{}'::jsonb end
             ) as an(anio, grupos)
        cross join lateral jsonb_each(
               case when jsonb_typeof(an.grupos) = 'object' then an.grupos else '{}'::jsonb end
             ) as gr(grupo, lista)
        cross join lateral jsonb_array_elements(
               case when jsonb_typeof(gr.lista) = 'array' then gr.lista else '[]'::jsonb end
             ) as ti(t)
        where gr.grupo in ('mismas', 'nuevas', 'cierres', 'fuera')
      ) x
    ),
    (
      select string_agg(
               concat_ws('|',
                 'f',
                 f.clave,
                 a.anio::text,
                 a.bloque,
                 coalesce(a.subbloque, '~'),
                 coalesce(a.propuesto::text, '~'),
                 coalesce(coalesce(a.decidido, a.propuesto)::text, '~'),
                 coalesce(a.base_siguiente::text, '~'),
                 coalesce(a.base_normalizada::text, '~'),
                 coalesce(a.meses::text, '~')
               ),
               E'\n' order by f.clave collate "C", a.anio
             )
      from public.proyeccion_filas f
      join public.proyeccion_fila_anios a on a.fila_id = f.id
      where f.proyeccion_id = pp.id
        and f.activo
        and a.activo
    ),
    (
      select string_agg(
               concat_ws('|', 't', t.tienda_id::text, t.anio::text, coalesce(coalesce(t.decidido, t.propuesto)::text, '~')),
               E'\n' order by t.tienda_id, t.anio
             )
      from public.proyeccion_tiendas t
      where t.proyeccion_id = pp.id
        and t.activo
    ),
    (
      select string_agg(
               concat_ws('|', 'c', c.genero_id::text, c.mundo_id::text, c.pct::text, coalesce(c.sobre_base, '~')),
               E'\n' order by c.genero_id, c.mundo_id
             )
      from public.proyeccion_crecimientos c
      where c.proyeccion_id = pp.id
        and c.activo
    ),
    concat_ws('|',
      'r',
      case
        when jsonb_typeof(pp.parametros #> '{crecimiento_resto_usado,pct}') = 'number'
          then trim_scale((pp.parametros #>> '{crecimiento_resto_usado,pct}')::numeric)::text
        else '~'
      end,
      case
        when jsonb_typeof(pp.parametros #> '{crecimiento_resto_usado,sobre_base}') = 'string'
          then pp.parametros #>> '{crecimiento_resto_usado,sobre_base}'
        else '~'
      end
    )
  ))
  from public.proyecciones pp
  where pp.id = p_proyeccion_id;
$$;

revoke execute on function public.huella_proyeccion(uuid) from public, anon, authenticated;
grant execute on function public.huella_proyeccion(uuid) to service_role;

comment on function public.huella_proyeccion(uuid) is
  'M14 0.19.0 (D9): huella md5 (32 hex) de las cifras de una proyeccion, por contenido. VERSION 1 de la formula (primera linea del texto: v|1). REGLA: cambiar la formula exige subir esa version en la misma migracion y saber que INVALIDA TODAS LAS APROBACIONES VIGENTES (su huella guardada deja de coincidir). Entran: anio, hasta_periodo y version_metodo; pertenencia de tiendas a los bloques; por registro activo de fila activa clave, anio, bloque, subbloque, propuesto, vigente, B, B corregida y meses; decisiones de proyeccion_tiendas; crecimientos activos y el Resto aplicado (parametros.crecimiento_resto_usado: pct y sobre_base; no el provisional crecimiento_pct_defecto). No entran id, nombre, estado, notas, autores ni fechas: cerrar sin cambiar cifras no la mueve y una copia sin cambios tiene la misma. NULL si la proyeccion no existe. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4. `tablero_proyeccion(p_proyeccion_id uuid, p jsonb) returns jsonb` (ficha §2.3 b)
-- ---------------------------------------------------------------------------
-- Lo proyectado de UNA proyección, agregado para el tablero, en un solo jsonb y una sola sentencia (un solo estado de los datos).
-- Solo lectura sobre lo guardado (D1): suma `meses` y el vigente de los registros ACTIVOS de filas ACTIVAS; nunca recalcula ni reparte.
-- Devuelve NULL si la proyección no existe.
--
-- ENTRADA `p` (una clave ausente o `null` = sin filtro en esa dimensión; un arreglo vacío = nada coincide):
--   { "gml_ids": uuid[], "agrupacion_marca_ids": uuid[], "unidad_marca_id": uuid,
--     "temporadas": ("invierno"|"verano"|"todo_el_ano"|"sin_temporada")[],
--     "desglose": "genero"|"mundo"|"linea"|"agrupacion_marca"|"marca"|"temporada"|"tienda" }
--   NO recibe tiendas: la proyección de las mismas tiendas no está por tienda; el servidor atribuye (ficha §3.4) y recorta.
--
-- FILTROS: GML, AM y temporada sobre la FILA (`gml_id`, `agrupacion_marca_id`, `temporada`; `sin_temporada` = temporada nula).
-- UNIDAD DE MARCA: cada registro se multiplica por la participación `w` de esa unidad en `participaciones->'por_marca'` de SU FILA
-- BASE (la misma (gml_id, equivalencia_id, agrupacion_marca_id) sin tienda, activa; igual que `claveBaseDe` de M7). Si esa fila base
-- no trae `por_marca` (nulo, no arreglo o arreglo vacío) o no existe, el vigente del registro va a `sin_participacion_marca` y no a
-- las series. Si trae `por_marca` y la unidad no está en él, `w = 0` y el registro no aparece. Las multiplicaciones van en `numeric`
-- y se redondean UNA sola vez, al final (por mes en `meses`). Sin unidad de marca `w = 1` y todo es entero exacto.
--
-- SALIDA (claves cortas, orden determinista; `Y` = `anio_en_curso`, `k` = mes de `hasta_periodo`, vigente = coalesce(decidido,
-- propuesto, 0)). Todas las claves salen SIEMPRE; lo que no aplica al año va en `null`:
--   {
--     "huella": "32 hex",                 -- la de `huella_proyeccion`, llamada dentro de ESTA sentencia (mismo snapshot, D10)
--     "resto": { "pct": n | null, "sobre_base": "bruta"|"corregida"|null },   -- el Resto DECLARADO que se aplicó
--     "anios": [ {                        -- Y y Y+1, siempre los dos, en ese orden
--       "anio": 2027,
--       "base": {                         -- registros de filas SIN tienda
--         "meses": [12 enteros], "vigente": n, "propuesto": n, "vendido": n,
--         "sin_meses": n,                 -- vigente menos la suma de `meses` (un registro sin `meses` aporta todo su vigente)
--         "B": n | null, "B_corr": n | null,          -- solo Y+1: suma de base_siguiente y de base_normalizada de los registros con B
--         "vigente_con_B": n, "propuesto_con_B": n,   -- solo Y+1: lo mismo restringido a los registros con B no nulo
--         "vigente_sin_B": n,                         -- solo Y+1: registros base sin B (otro método)
--         "delta_manual": n, "delta_otras": n,        -- solo Y+1: vigente_con_B − propuesto_con_B partido en dos (ver PRECISIONES)
--         "meses_sin_nino": [12 números] | null       -- solo Y: suma de meses_m / phi_Y,m de la fila (factores_mes[Y]; 1 si no hay o no es > 0)
--       },
--       "tiendas": [ { "t": uuid, "bloque": "nuevas"|"cierres", "subbloque": "nuevas_anterior"|"aperturas"|null,
--                      "meses": [12], "vigente": n, "sin_meses": n,
--                      "para_base": n | null } ],     -- solo Y y solo tiendas de bloques[Y+1].mismas: vigente de sus filas de tienda cuya
--                                                     -- fila base tiene B no nulo en Y+1 (= vigentesDeTiendasNuevas.paraBase de 07f)
--       "decisiones": {                               -- excluyente, en este orden: lote > ia > origen > sin decidir
--         "lote": { "n": n, "u": n }, "ia": {…}, "propuesta": {…}, "manual": {…}, "escalada": {…}, "sin_decidir": {…},
--         "autores": [ { "nombre": text, "n": n, "u": n, "desde": "aaaa-mm-dd"|null, "hasta": "aaaa-mm-dd"|null } ],
--         "dia_pico": { "fecha": "aaaa-mm-dd", "n": n } | null },
--       "conteos": { "registros": n, "propuesta_cambio": n, "curva_cambio": n } } ],
--     "por_gm": [ { "g": genero_id, "m": mundo_id,    -- SIEMPRE de toda la proyección: sin filtros y sin unidad de marca
--       "Y":  { "cierre": n, "base": n, "fuera_base_exacto": n },
--       "Y1": { "B": n | null, "B_corr": n | null, "propuesto_con_B": n, "vigente_con_B": n, "vigente_sin_B": n,
--               "delta_manual": n, "delta_otras": n, "nuevas_anterior": n, "aperturas": n, "cierres": n, "total": n } } ],
--     "por_dim": [ { "d": id_o_texto, "Y": { "base": n, "base_resto": n, "tiendas": [[uuid, n]] },
--                    "Y1": { "base": n, "tiendas": [[uuid, n]] } } ] | null,
--     "por_temporada": [ { "temporada": text | null, "Y1": n, "Y1_con_factor_Y": n } ],
--     "por_par": { "gml": [uuid], "am": [uuid], "filas": [[i_gml, i_am, y_resto, y1]] },
--     "mayores": [ { "clave": text, "gml_id": uuid, "am_id": uuid, "Y1": n, "B": n | null } ],
--     "sin_participacion_marca": { "Y": n, "Y1": n } | null
--   }
--
-- PRECISIONES (lo que la ficha deja a la construcción):
--   * `resto`: `pct` y `sobre_base` de `parametros.crecimiento_resto_usado`, el Resto que aplicó el último cálculo (NO
--     `crecimiento_pct_defecto`, que es el provisional de la creación y nunca cambia). `null` si falta. Es el mismo dato que entra
--     en la huella.
--   * `delta_manual` y `delta_otras` (línea «decisiones a mano» del puente): `vigente − propuesta` de los registros base con B
--     mezcla dos cosas distintas, así que va partido. `delta_manual` suma `vigente − propuesto` de los registros con
--     `origen = 'manual'` (los fijó una persona, incluida una cifra de la IA aceptada, que también se guarda como manual);
--     `delta_otras` es todo lo demás: sobre todo filas aceptadas tal cual o en bloque cuya propuesta cambió después al recalcular.
--     Siempre `delta_manual + delta_otras = vigente_con_B − propuesto_con_B`, exacto (con unidad de marca, `delta_otras` se calcula
--     como el complemento de las cifras ya redondeadas, para que la identidad no dependa del redondeo): el cuadre del puente no cambia.
--   * `base` son los registros de filas sin tienda y `tiendas` los de filas con tienda, agrupados por (tienda, bloque, subbloque) del
--     registro. `tiendas` va ordenado por (t, bloque, subbloque).
--   * `B_corr` conserva dos decimales (`base_normalizada` es numeric(14,2)): así la suma de `por_gm` es exactamente la del total.
--     `B` y `B_corr` son `null` cuando ningún registro base del recorte (o del GM) tiene B: también en `por_gm` (un GM calculado con un
--     método anterior no tiene base corregida y el tablero debe poder decir «—» en vez de 0).
--   * `decisiones`: `n` cuenta registros y `u` suma su vigente; incluye base y tiendas del recorte. `autores` agrupa los registros
--     DECIDIDOS por `decidido_por_nombre` ('' si es nulo), ordenados por `u` descendente; fechas en la zona America/Lima.
--     `dia_pico` es el día (Lima) con más registros decididos; en empate, el más reciente.
--   * `conteos.propuesta_cambio`: registros decididos con `propuesto` distinto de `propuesta_al_decidir` (`is distinct from`, la misma
--     comparación estricta de M7). `conteos.curva_cambio`: registros con `meses_propuestos` no nulo.
--   * `por_gm.Y.fuera_base_exacto` = vigente de las filas de tienda de Y menos el `para_base` de las tiendas que entran. En `Y1`, los
--     registros de tienda se clasifican sin huecos: `cierres` si su bloque es `cierres`; si no, `nuevas_anterior` si ese es su
--     subbloque; si no, `aperturas`. Así vigente_con_B + vigente_sin_B + nuevas_anterior + aperturas + cierres = total, exacto (R4).
--   * `por_dim`: `d` es `genero_id`, `mundo_id`, `gml_id` (línea), `agrupacion_marca_id`, la unidad de marca (cada registro se
--     reparte con `por_marca` de su fila base; con `unidad_marca_id` solo sale esa unidad) o la temporada ('sin_temporada' si es nula,
--     el mismo texto que el filtro). `null` si no hay `desglose` o si es `tienda` (la tienda sale de `tiendas` y de la atribución).
--     `base_resto` (Y) = proyectado de `k+1` a 12 de los registros base. Ordenado por `d`.
--   * `por_temporada`: del recorte. `Y1` = vigente de Y+1 (base y tiendas) de las filas de esa temporada; `Y1_con_factor_Y` = el de
--     las filas BASE con algún phi_Y,m distinto de 1. La temporada nula va como `null`, al final.
--   * `por_par` (para valorizar en soles, D2): por (gml, am) del recorte, base y tiendas; `y_resto` = proyectado de `k+1` a 12 de Y;
--     `y1` = vigente de Y+1. `i_gml` e `i_am` son índices (desde 0) en `gml` y `am`. Solo los pares con alguna cifra distinta de 0.
--   * `mayores`: las 20 filas base de mayor vigente en Y+1 del recorte (empate: por `clave`).
--   * `sin_participacion_marca`: no nulo solo con `unidad_marca_id` o con `desglose = marca`: el vigente del recorte cuya fila base no
--     trae `por_marca` (lo que falta en las series, o en `por_dim` si solo se pidió el desglose).
--
-- CÓMO ESTÁ ESCRITA: sin cruces entre CTEs (no tienen estadísticas y, como el plan se arma sin conocer los parámetros, un cruce así
-- puede acabar en un bucle anidado sin índice: una versión anterior tardaba 10 s con `desglose = marca` sobre 6 400 registros). La
-- fila base de cada fila se obtiene con una ventana sobre (gml, equivalencia, AM) (la fila sin tienda va primero; si hubiera dos, la
-- de menor `clave`); que esa fila base tenga B en Y+1, con otra ventana; el peso de la unidad de marca, con una subconsulta sobre el
-- `por_marca` de la fila base; el desglose por marca, con un `lateral` sobre ese mismo arreglo.
create or replace function public.tablero_proyeccion(p_proyeccion_id uuid, p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with pr as materialized (
    select
      pp.id,
      pp.anio_en_curso as y,
      extract(month from pp.hasta_periodo)::integer as k,
      case
        when jsonb_typeof(pp.parametros #> '{crecimiento_resto_usado,pct}') = 'number'
          then (pp.parametros #>> '{crecimiento_resto_usado,pct}')::numeric
        else null
      end as resto_pct,
      case
        when jsonb_typeof(pp.parametros #> '{crecimiento_resto_usado,sobre_base}') = 'string'
          then pp.parametros #>> '{crecimiento_resto_usado,sobre_base}'
        else null
      end as resto_sobre_base,
      array(
        select e.t ->> 'tienda_id'
        from jsonb_array_elements(
               case
                 when jsonb_typeof(pp.parametros #> array['bloques', (pp.anio_en_curso + 1)::text, 'mismas']) = 'array'
                   then pp.parametros #> array['bloques', (pp.anio_en_curso + 1)::text, 'mismas']
                 else '[]'::jsonb
               end
             ) as e(t)
        where e.t ->> 'tienda_id' is not null
      ) as mis_ids,
      case when jsonb_typeof(p -> 'gml_ids') = 'array'
           then array(select jsonb_array_elements_text(p -> 'gml_ids'))::uuid[] end as gml_ids,
      case when jsonb_typeof(p -> 'agrupacion_marca_ids') = 'array'
           then array(select jsonb_array_elements_text(p -> 'agrupacion_marca_ids'))::uuid[] end as am_ids,
      case when jsonb_typeof(p -> 'temporadas') = 'array'
           then array(select jsonb_array_elements_text(p -> 'temporadas')) end as temporadas,
      nullif(p ->> 'unidad_marca_id', '')::uuid as unidad,
      nullif(p ->> 'desglose', '') as desglose
    from public.proyecciones pp
    where pp.id = p_proyeccion_id
  ),
  filas as materialized (
    select
      f.id,
      f.clave,
      f.gml_id,
      coalesce(f.equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid) as eq_nodo,
      f.agrupacion_marca_id,
      f.tienda_id,
      f.temporada,
      f.factores_mes -> (select pr.y::text from pr) as phi,
      n.genero_id,
      n.mundo_id,
      first_value(case when f.tienda_id is null then f.id end) over w as base_id,
      first_value(case when f.tienda_id is null then f.participaciones -> 'por_marca' end) over w as pm_base
    from public.proyeccion_filas f
    join public.genero_mundo_linea n on n.id = f.gml_id
    where f.proyeccion_id = p_proyeccion_id
      and f.activo
    window w as (
      partition by f.gml_id, coalesce(f.equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid), f.agrupacion_marca_id
      order by (f.tienda_id is not null), f.clave collate "C"
    )
  ),
  reg as materialized (
    select
      a.anio,
      (a.anio = pr.y) as es_y,
      a.bloque,
      a.subbloque,
      a.vendido,
      a.propuesto,
      a.decidido,
      a.origen,
      a.decision_lote_id,
      a.decision_ia_fila_id,
      a.decidido_por_nombre,
      a.decidido_at,
      a.propuesta_al_decidir,
      a.meses,
      a.meses_propuestos,
      a.base_siguiente,
      a.base_normalizada,
      coalesce(a.decidido, a.propuesto, 0) as vig,
      coalesce((select sum(x.u) from unnest(a.meses) as x(u)), 0) as suma_meses,
      coalesce((select sum(x.u) from unnest(a.meses) with ordinality as x(u, i) where x.i > pr.k), 0) as resto,
      f.clave,
      f.gml_id,
      f.agrupacion_marca_id,
      f.tienda_id,
      f.temporada,
      f.phi,
      exists (
        select 1
        from jsonb_array_elements(case when jsonb_typeof(f.phi) = 'array' then f.phi else '[]'::jsonb end) as e(v)
        where jsonb_typeof(e.v) = 'number'
          and e.v <> '1'::jsonb
      ) as con_factor_y,
      f.genero_id,
      f.mundo_id,
      case when jsonb_typeof(f.pm_base) = 'array' then jsonb_array_length(f.pm_base) > 0 else false end as con_pm,
      case when jsonb_typeof(f.pm_base) = 'array' then f.pm_base else '[]'::jsonb end as pm,
      coalesce(
        bool_or(f.id = f.base_id and a.anio = pr.y + 1 and a.base_siguiente is not null)
          over (partition by f.gml_id, f.eq_nodo, f.agrupacion_marca_id),
        false
      ) as base_con_b,
      (f.tienda_id is not null and f.tienda_id::text = any (pr.mis_ids)) as en_mismas_sig
    from pr
    join filas f on true
    join public.proyeccion_fila_anios a
      on a.fila_id = f.id
     and a.activo
     and a.anio in (pr.y, pr.y + 1)
  ),
  rec as materialized (
    select
      r.*,
      case
        when pr.unidad is null then 1::numeric
        when r.con_pm then coalesce((
          select sum((e.m ->> 'participacion')::numeric)
          from jsonb_array_elements(r.pm) as e(m)
          where jsonb_typeof(e.m -> 'participacion') = 'number'
            and e.m ->> 'marca_id' = pr.unidad::text
        ), 0)
        else 0::numeric
      end as w
    from pr
    join reg r on true
    where (pr.gml_ids is null or r.gml_id = any (pr.gml_ids))
      and (pr.am_ids is null or r.agrupacion_marca_id = any (pr.am_ids))
      and (pr.temporadas is null or coalesce(r.temporada, 'sin_temporada') = any (pr.temporadas))
  ),
  rs as materialized (
    select r.*
    from rec r
    where r.w > 0
  ),
  mes as materialized (
    select
      q.anio,
      q.tienda_id,
      q.bloque,
      q.subbloque,
      jsonb_agg(round(q.u) order by q.i) as meses,
      jsonb_agg(round(q.u_sn, 2) order by q.i) as meses_sn
    from (
      select
        r.anio,
        r.tienda_id,
        case when r.tienda_id is not null then r.bloque end as bloque,
        case when r.tienda_id is not null then r.subbloque end as subbloque,
        x.i,
        coalesce(sum(r.w * x.u), 0) as u,
        coalesce(sum(
          r.w * x.u / (
            case
              when jsonb_typeof(r.phi -> (x.i - 1)::integer) = 'number' then
                case
                  when (r.phi ->> (x.i - 1)::integer)::numeric > 0 then (r.phi ->> (x.i - 1)::integer)::numeric
                  else 1::numeric
                end
              else 1::numeric
            end
          )
        ), 0) as u_sn
      from rs r
      cross join lateral unnest(r.meses) with ordinality as x(u, i)
      group by 1, 2, 3, 4, 5
    ) q
    group by q.anio, q.tienda_id, q.bloque, q.subbloque
  ),
  tot as materialized (
    select
      r.anio,
      r.tienda_id,
      case when r.tienda_id is not null then r.bloque end as bloque,
      case when r.tienda_id is not null then r.subbloque end as subbloque,
      sum(r.w * r.vig) as vigente,
      sum(r.w * r.propuesto) as propuesto,
      sum(r.w * r.vendido) as vendido,
      sum(r.w * (r.vig - r.suma_meses)) as sin_meses,
      sum(r.w * r.base_siguiente) as b,
      sum(r.w * r.base_normalizada) filter (where r.base_siguiente is not null) as b_corr,
      sum(r.w * r.vig) filter (where r.base_siguiente is not null) as vigente_con_b,
      sum(r.w * r.propuesto) filter (where r.base_siguiente is not null) as propuesto_con_b,
      sum(r.w * r.vig) filter (where r.base_siguiente is null) as vigente_sin_b,
      sum(r.w * (r.vig - coalesce(r.propuesto, 0))) filter (
        where r.base_siguiente is not null and r.origen is not distinct from 'manual'
      ) as delta_manual,
      sum(r.w * r.vig) filter (where r.base_con_b) as para_base,
      bool_or(r.en_mismas_sig) as en_mismas_sig
    from rs r
    group by 1, 2, 3, 4
  ),
  dec as materialized (
    select
      r.anio,
      case
        when r.decision_lote_id is not null then 'lote'
        when r.decision_ia_fila_id is not null then 'ia'
        when r.decidido is null then 'sin_decidir'
        when r.origen = 'propuesta' then 'propuesta'
        when r.origen = 'escalada' then 'escalada'
        else 'manual'
      end as clase,
      count(*) as n,
      sum(r.w * r.vig) as u
    from rs r
    group by 1, 2
  ),
  aut as materialized (
    select
      r.anio,
      coalesce(r.decidido_por_nombre, '') as nombre,
      count(*) as n,
      sum(r.w * r.vig) as u,
      min((r.decidido_at at time zone 'America/Lima')::date) as desde,
      max((r.decidido_at at time zone 'America/Lima')::date) as hasta
    from rs r
    where r.decidido is not null
    group by 1, 2
  ),
  dia as materialized (
    select
      r.anio,
      (r.decidido_at at time zone 'America/Lima')::date as fecha,
      count(*) as n
    from rs r
    where r.decidido is not null
      and r.decidido_at is not null
    group by 1, 2
  ),
  cnt as materialized (
    select
      r.anio,
      count(*) as registros,
      count(*) filter (where r.decidido is not null and r.propuesto is distinct from r.propuesta_al_decidir) as propuesta_cambio,
      count(*) filter (where r.meses_propuestos is not null) as curva_cambio
    from rs r
    group by 1
  ),
  gm as materialized (
    select
      r.genero_id,
      r.mundo_id,
      coalesce(sum(r.vig) filter (where r.es_y), 0) as y_cierre,
      coalesce(sum(r.vig) filter (where r.es_y and r.tienda_id is null), 0) as y_base,
      coalesce(sum(r.vig) filter (where r.es_y and r.tienda_id is not null), 0)
        - coalesce(sum(r.vig) filter (where r.es_y and r.tienda_id is not null and r.en_mismas_sig and r.base_con_b), 0) as y_fuera,
      sum(r.base_siguiente) filter (where not r.es_y and r.tienda_id is null) as b,
      sum(r.base_normalizada) filter (where not r.es_y and r.tienda_id is null and r.base_siguiente is not null) as b_corr,
      coalesce(sum(r.propuesto) filter (where not r.es_y and r.tienda_id is null and r.base_siguiente is not null), 0) as propuesto_con_b,
      coalesce(sum(r.vig) filter (where not r.es_y and r.tienda_id is null and r.base_siguiente is not null), 0) as vigente_con_b,
      coalesce(sum(r.vig) filter (where not r.es_y and r.tienda_id is null and r.base_siguiente is null), 0) as vigente_sin_b,
      coalesce(sum(r.vig - coalesce(r.propuesto, 0)) filter (
        where not r.es_y and r.tienda_id is null and r.base_siguiente is not null and r.origen is not distinct from 'manual'
      ), 0) as delta_manual,
      coalesce(sum(r.vig - coalesce(r.propuesto, 0)) filter (
        where not r.es_y and r.tienda_id is null and r.base_siguiente is not null and r.origen is distinct from 'manual'
      ), 0) as delta_otras,
      coalesce(sum(r.vig) filter (
        where not r.es_y and r.tienda_id is not null and r.bloque <> 'cierres' and r.subbloque is not distinct from 'nuevas_anterior'
      ), 0) as nuevas_anterior,
      coalesce(sum(r.vig) filter (
        where not r.es_y and r.tienda_id is not null and r.bloque <> 'cierres' and r.subbloque is distinct from 'nuevas_anterior'
      ), 0) as aperturas,
      coalesce(sum(r.vig) filter (where not r.es_y and r.tienda_id is not null and r.bloque = 'cierres'), 0) as cierres,
      coalesce(sum(r.vig) filter (where not r.es_y), 0) as total
    from reg r
    group by 1, 2
  ),
  dimr as materialized (
    select
      case pr.desglose
        when 'genero' then r.genero_id::text
        when 'mundo' then r.mundo_id::text
        when 'linea' then r.gml_id::text
        when 'agrupacion_marca' then r.agrupacion_marca_id::text
        else coalesce(r.temporada, 'sin_temporada')
      end as d,
      r.es_y,
      r.tienda_id,
      r.w * r.vig as v,
      r.w * r.resto as v_resto
    from pr
    join rs r on true
    where pr.desglose in ('genero', 'mundo', 'linea', 'agrupacion_marca', 'temporada')
    union all
    select
      e.m ->> 'marca_id' as d,
      r.es_y,
      r.tienda_id,
      (e.m ->> 'participacion')::numeric * r.vig as v,
      (e.m ->> 'participacion')::numeric * r.resto as v_resto
    from pr
    join rec r on true
    cross join lateral jsonb_array_elements(r.pm) as e(m)
    where pr.desglose = 'marca'
      and r.con_pm
      and jsonb_typeof(e.m -> 'participacion') = 'number'
      and jsonb_typeof(e.m -> 'marca_id') = 'string'
      and (pr.unidad is null or e.m ->> 'marca_id' = pr.unidad::text)
  ),
  dimt as materialized (
    select
      z.d,
      z.es_y,
      z.tienda_id,
      sum(z.v) as v,
      sum(z.v_resto) as v_resto
    from dimr z
    group by 1, 2, 3
  ),
  dimg as materialized (
    select
      x.d,
      round(coalesce(sum(x.v) filter (where x.es_y and x.tienda_id is null), 0)) as y_base,
      round(coalesce(sum(x.v_resto) filter (where x.es_y and x.tienda_id is null), 0)) as y_resto,
      round(coalesce(sum(x.v) filter (where not x.es_y and x.tienda_id is null), 0)) as y1_base,
      coalesce(
        jsonb_agg(jsonb_build_array(x.tienda_id, round(x.v)) order by x.tienda_id) filter (where x.es_y and x.tienda_id is not null),
        '[]'::jsonb
      ) as y_tiendas,
      coalesce(
        jsonb_agg(jsonb_build_array(x.tienda_id, round(x.v)) order by x.tienda_id) filter (where not x.es_y and x.tienda_id is not null),
        '[]'::jsonb
      ) as y1_tiendas
    from dimt x
    group by x.d
  ),
  par as materialized (
    select
      q.gml_id,
      q.am_id,
      q.y_resto,
      q.y1,
      (dense_rank() over (order by q.gml_id) - 1) as i_gml,
      (dense_rank() over (order by q.am_id) - 1) as i_am
    from (
      select
        r.gml_id,
        r.agrupacion_marca_id as am_id,
        round(coalesce(sum(r.w * r.resto) filter (where r.es_y), 0)) as y_resto,
        round(coalesce(sum(r.w * r.vig) filter (where not r.es_y), 0)) as y1
      from rs r
      group by 1, 2
    ) q
    where q.y_resto <> 0
       or q.y1 <> 0
  )
  select jsonb_build_object(
    'huella', public.huella_proyeccion(pr.id),
    'resto', jsonb_build_object('pct', pr.resto_pct, 'sobre_base', pr.resto_sobre_base),
    'anios', (
      select jsonb_agg(
               jsonb_build_object(
                 'anio', z.anio,
                 'base', (
                   select jsonb_build_object(
                            'meses', coalesce(m.meses, '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'::jsonb),
                            'vigente', round(coalesce(t.vigente, 0)),
                            'propuesto', round(coalesce(t.propuesto, 0)),
                            'vendido', round(coalesce(t.vendido, 0)),
                            'sin_meses', round(coalesce(t.sin_meses, 0)),
                            'B', case when z.es_y then null else round(t.b) end,
                            'B_corr', case when z.es_y then null else round(t.b_corr, 2) end,
                            'vigente_con_B', case when z.es_y then null else round(coalesce(t.vigente_con_b, 0)) end,
                            'propuesto_con_B', case when z.es_y then null else round(coalesce(t.propuesto_con_b, 0)) end,
                            'vigente_sin_B', case when z.es_y then null else round(coalesce(t.vigente_sin_b, 0)) end,
                            'delta_manual', case when z.es_y then null else round(coalesce(t.delta_manual, 0)) end,
                            'delta_otras', case
                                             when z.es_y then null
                                             else round(coalesce(t.vigente_con_b, 0)) - round(coalesce(t.propuesto_con_b, 0))
                                                  - round(coalesce(t.delta_manual, 0))
                                           end,
                            'meses_sin_nino', case
                                                when z.es_y then coalesce(m.meses_sn, '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'::jsonb)
                                                else null
                                              end
                          )
                   from (select 1) uno
                   left join tot t on t.anio = z.anio and t.tienda_id is null
                   left join mes m on m.anio = z.anio and m.tienda_id is null
                 ),
                 'tiendas', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              't', t.tienda_id,
                              'bloque', t.bloque,
                              'subbloque', t.subbloque,
                              'meses', coalesce(m.meses, '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'::jsonb),
                              'vigente', round(coalesce(t.vigente, 0)),
                              'sin_meses', round(coalesce(t.sin_meses, 0)),
                              'para_base', case when z.es_y and t.en_mismas_sig then round(coalesce(t.para_base, 0)) else null end
                            )
                            order by t.tienda_id, t.bloque collate "C", t.subbloque collate "C"
                          )
                   from tot t
                   left join mes m
                     on m.anio = t.anio
                    and m.tienda_id = t.tienda_id
                    and m.bloque is not distinct from t.bloque
                    and m.subbloque is not distinct from t.subbloque
                   where t.anio = z.anio
                     and t.tienda_id is not null
                 ), '[]'::jsonb),
                 'decisiones', jsonb_build_object(
                   'lote', (select jsonb_build_object('n', coalesce(sum(d.n), 0), 'u', round(coalesce(sum(d.u), 0)))
                            from dec d where d.anio = z.anio and d.clase = 'lote'),
                   'ia', (select jsonb_build_object('n', coalesce(sum(d.n), 0), 'u', round(coalesce(sum(d.u), 0)))
                          from dec d where d.anio = z.anio and d.clase = 'ia'),
                   'propuesta', (select jsonb_build_object('n', coalesce(sum(d.n), 0), 'u', round(coalesce(sum(d.u), 0)))
                                 from dec d where d.anio = z.anio and d.clase = 'propuesta'),
                   'manual', (select jsonb_build_object('n', coalesce(sum(d.n), 0), 'u', round(coalesce(sum(d.u), 0)))
                              from dec d where d.anio = z.anio and d.clase = 'manual'),
                   'escalada', (select jsonb_build_object('n', coalesce(sum(d.n), 0), 'u', round(coalesce(sum(d.u), 0)))
                                from dec d where d.anio = z.anio and d.clase = 'escalada'),
                   'sin_decidir', (select jsonb_build_object('n', coalesce(sum(d.n), 0), 'u', round(coalesce(sum(d.u), 0)))
                                   from dec d where d.anio = z.anio and d.clase = 'sin_decidir'),
                   'autores', coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'nombre', u.nombre,
                                'n', u.n,
                                'u', round(u.u),
                                'desde', to_char(u.desde, 'YYYY-MM-DD'),
                                'hasta', to_char(u.hasta, 'YYYY-MM-DD')
                              )
                              order by u.u desc, u.nombre collate "C"
                            )
                     from aut u
                     where u.anio = z.anio
                   ), '[]'::jsonb),
                   'dia_pico', (
                     select jsonb_build_object('fecha', to_char(d.fecha, 'YYYY-MM-DD'), 'n', d.n)
                     from dia d
                     where d.anio = z.anio
                     order by d.n desc, d.fecha desc
                     limit 1
                   )
                 ),
                 'conteos', (
                   select jsonb_build_object(
                            'registros', coalesce(c.registros, 0),
                            'propuesta_cambio', coalesce(c.propuesta_cambio, 0),
                            'curva_cambio', coalesce(c.curva_cambio, 0)
                          )
                   from (select 1) uno
                   left join cnt c on c.anio = z.anio
                 )
               )
               order by z.anio
             )
      from (
        select pr.y as anio, true as es_y
        union all
        select pr.y + 1, false
      ) z
    ),
    'por_gm', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'g', g.genero_id,
                 'm', g.mundo_id,
                 'Y', jsonb_build_object('cierre', g.y_cierre, 'base', g.y_base, 'fuera_base_exacto', g.y_fuera),
                 'Y1', jsonb_build_object(
                         'B', g.b,
                         'B_corr', g.b_corr,
                         'propuesto_con_B', g.propuesto_con_b,
                         'vigente_con_B', g.vigente_con_b,
                         'vigente_sin_B', g.vigente_sin_b,
                         'delta_manual', g.delta_manual,
                         'delta_otras', g.delta_otras,
                         'nuevas_anterior', g.nuevas_anterior,
                         'aperturas', g.aperturas,
                         'cierres', g.cierres,
                         'total', g.total
                       )
               )
               order by g.genero_id, g.mundo_id
             )
      from gm g
    ), '[]'::jsonb),
    'por_dim', case
      when pr.desglose in ('genero', 'mundo', 'linea', 'agrupacion_marca', 'marca', 'temporada') then coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'd', x.d,
                   'Y', jsonb_build_object('base', x.y_base, 'base_resto', x.y_resto, 'tiendas', x.y_tiendas),
                   'Y1', jsonb_build_object('base', x.y1_base, 'tiendas', x.y1_tiendas)
                 )
                 order by x.d collate "C"
               )
        from dimg x
      ), '[]'::jsonb)
      else null
    end,
    'por_temporada', coalesce((
      select jsonb_agg(
               jsonb_build_object('temporada', x.temporada, 'Y1', x.y1, 'Y1_con_factor_Y', x.y1f)
               order by x.temporada collate "C" nulls last
             )
      from (
        select
          r.temporada,
          round(coalesce(sum(r.w * r.vig) filter (where not r.es_y), 0)) as y1,
          round(coalesce(sum(r.w * r.vig) filter (where not r.es_y and r.tienda_id is null and r.con_factor_y), 0)) as y1f
        from rs r
        group by r.temporada
      ) x
    ), '[]'::jsonb),
    'por_par', jsonb_build_object(
      'gml', coalesce((
        select jsonb_agg(q.gml_id order by q.i_gml)
        from (select distinct x.gml_id, x.i_gml from par x) q
      ), '[]'::jsonb),
      'am', coalesce((
        select jsonb_agg(q.am_id order by q.i_am)
        from (select distinct x.am_id, x.i_am from par x) q
      ), '[]'::jsonb),
      'filas', coalesce((
        select jsonb_agg(jsonb_build_array(x.i_gml, x.i_am, x.y_resto, x.y1) order by x.i_gml, x.i_am)
        from par x
      ), '[]'::jsonb)
    ),
    'mayores', coalesce((
      select jsonb_agg(
               jsonb_build_object('clave', x.clave, 'gml_id', x.gml_id, 'am_id', x.am_id, 'Y1', x.y1, 'B', x.b)
               order by x.orden
             )
      from (
        select
          r.clave,
          r.gml_id,
          r.agrupacion_marca_id as am_id,
          round(r.w * r.vig) as y1,
          round(r.w * r.base_siguiente) as b,
          row_number() over (order by r.w * r.vig desc, r.clave collate "C") as orden
        from rs r
        where not r.es_y
          and r.tienda_id is null
        order by r.w * r.vig desc, r.clave collate "C"
        limit 20
      ) x
    ), '[]'::jsonb),
    'sin_participacion_marca', case
      when pr.unidad is not null or pr.desglose is not distinct from 'marca' then (
        select jsonb_build_object(
                 'Y', coalesce(sum(r.vig) filter (where r.es_y), 0),
                 'Y1', coalesce(sum(r.vig) filter (where not r.es_y), 0)
               )
        from rec r
        where not r.con_pm
      )
      else null
    end
  )
  from pr;
$$;

revoke execute on function public.tablero_proyeccion(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tablero_proyeccion(uuid, jsonb) to service_role;

comment on function public.tablero_proyeccion(uuid, jsonb) is
  'M14 0.19.0: lo proyectado de una proyeccion agregado para el tablero de direccion, en un jsonb { huella (la de huella_proyeccion, misma sentencia), anios [Y, Y+1] con base (filas sin tienda: meses, vigente, propuesto, vendido, sin_meses, B, B_corr, con y sin B, meses_sin_nino), tiendas (filas de tienda por tienda, bloque y subbloque, con para_base), decisiones por origen, autores, dia pico y conteos; por_gm (siempre toda la proyeccion); por_dim (desglose pedido, totales por elemento); por_temporada; por_par (gml x agrupacion de marca, para valorizar); mayores (20 filas base); sin_participacion_marca }. Filtros en p: gml_ids, agrupacion_marca_ids, temporadas, unidad_marca_id (estimado con por_marca de la fila base). Suma lo guardado, no recalcula. NULL si la proyeccion no existe. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 5. `tablero_venta(p jsonb) returns jsonb` (ficha §2.3 c)
-- ---------------------------------------------------------------------------
-- La venta publicada agregada para el tablero, en un solo jsonb y una sola sentencia. Lleva `set work_mem = '16MB'` como las lecturas
-- pesadas de la 0037 y `set hash_mem_multiplier = 8` (ver CÓMO ESTÁ ESCRITA). OJO: un `create or replace` futuro debe repetir los dos
-- en la cabecera o se pierden sin avisar.
--
-- ENTRADA `p` (una clave ausente o `null` = sin filtro en esa dimensión; un arreglo vacío = nada coincide):
--   { "gml_ids": uuid[], "agrupacion_marca_ids": uuid[], "unidad_marca_id": uuid, "tienda_ids": uuid[],
--     "temporadas": text[], "proyeccion_id": uuid, "desde": "aaaa-mm-01", "hasta": "aaaa-mm-01",
--     "k": 1..12, "k_prima": 1..12, "desglose": "genero"|"mundo"|"linea"|"agrupacion_marca"|"marca"|"temporada"|"tienda",
--     "solo_tendencia": boolean }
--   * `Y` es el AÑO DE `hasta` (el backend pide de enero de Y−3 al último mes publicado `k'`, que es de Y). `k_prima` por defecto es
--     el mes de `hasta`. `desde` o `hasta` ausentes dan un documento vacío (una comparación con null no es verdadera).
--   * `k` se acepta y NO se usa: ninguna clave de la salida depende de él (el real de enero a `k` por tienda lo suma el backend con
--     las tuplas mensuales de `por_tienda`).
--
-- QUÉ LEE: `venta_stock_vigente` (solo cargas publicadas) con `tiendas`, `equivalencias` y su nodo de planificación (la misma
-- correspondencia que `venta_proyeccion`, 0021: `equivalencia_id` solo si el nodo es GMLE) y `marcas_unidad` con la marca cabeza (la
-- AM es la de la UNIDAD de marca). Venta y soles SOLO de `tipo = 'Tienda'`; el CD (todo lo que no es tipo Tienda) solo entra en
-- `stock.cd`. Columnas de hechos: unidades, soles de venta y, solo para el mes `hasta`, stock en unidades.
--
-- FILTROS: GML sobre el nodo de la equivalencia; AM y unidad de marca sobre la unidad (`unidad_marca_id` = todas las marcas de la
-- unidad). TEMPORADA: semiunión con las FILAS BASE ACTIVAS de `proyeccion_id` (sin tienda) sobre (nodo, equivalencia si el nodo es
-- GMLE, AM): con `temporadas`, solo cuenta la venta cuya fila base tiene una de esas temporadas ('sin_temporada' = nula); la venta
-- sin fila en la proyección queda fuera de las cifras y se cuenta en `fuera_universo`. Sin `proyeccion_id`, un filtro de temporada no
-- deja nada. `tienda_ids` SOLO recorta `por_dim`, `precios` y `stock`: `por_tienda` trae siempre todas las tiendas del recorte, porque
-- la atribución las necesita a todas (R10).
--
-- SALIDA:
--   {
--     "periodos": { "aaaa-mm": carga_id },                 -- meses publicados en [desde, hasta]
--     "tiendas": [uuid],                                   -- TODAS las de tipo Tienda, por id: es el índice `i_t` (desde 0)
--     "por_tienda": [[i_t, "aaaa-mm", u, s]],              -- por (i_t, mes); sin CD; no se inventan ceros
--     "por_dim": { "ids": [id], "filas": [[i_d, u_Y-3, u_Y-2, u_Y-1, u_ac_ant, u_ac_cur, s_Y-1, s_ac_cur]] } | null,
--                                                          -- ac = enero a k' de Y−1 (ant) y de Y (cur); `i_d` índice en `ids`
--     "precios": { "gml": [uuid], "am": [uuid], "filas": [[i_gml, i_am, u12, s12]] },   -- los 12 meses que terminan en `hasta`
--     "stock": { "periodo": "aaaa-mm", "por_tienda": [[i_t, u]], "cd": n | null },      -- cd null si hay tienda_ids
--     "tendencia_gm": [[genero_id, mundo_id, i_t, u_ac_cur, u_ac_ant]] | null,          -- solo con solo_tendencia
--     "fuera_universo": [[anio, u]] | null                                              -- solo con proyeccion_id
--   }
--   Con `solo_tendencia = true` devuelve SOLO `periodos`, `tiendas` y `tendencia_gm`, y `tendencia_gm` va SIN filtros (toda la
--   empresa, tiendas de tipo Tienda): la usa la alerta «contra la tendencia» y se cachea aparte. Sin él, `tendencia_gm` es `null`.
--
-- PRECISIONES:
--   * `por_dim` es `null` sin `desglose` o con `desglose = tienda` (esa dimensión es `por_tienda`). `ids` son `genero_id`,
--     `mundo_id`, `gml_id` (línea), `agrupacion_marca_id`, la unidad de marca o la temporada de la fila base ('sin_temporada' si es
--     nula; 'fuera_universo' si esa venta no tiene fila base en la proyección o no se pasó `proyeccion_id`), los mismos identificadores
--     que `por_dim` de `tablero_proyeccion`. Ordenados; solo elementos con alguna cifra distinta de 0.
--   * `precios`: por (nodo, AM) del recorte, con `tienda_ids`; solo pares con unidades o soles distintos de 0.
--   * `stock`: stock en unidades de la carga publicada de `hasta` en el recorte (GML, AM, unidad, temporada). `por_tienda` con
--     `tienda_ids` y solo las tiendas con stock distinto de 0; `cd` es el del CD en el mismo recorte, 0 si no hay, `null` si se
--     pidieron tiendas.
--   * `fuera_universo`: por año (de Y−3 a Y, hasta `hasta`), unidades (tiendas de tipo Tienda) del recorte de GML, AM y unidad cuya
--     (nodo, equivalencia, AM) no tiene fila base activa en `proyeccion_id`; no depende de `temporadas` ni de `tienda_ids`. Solo los
--     años con alguna venta así; `[]` si no hay ninguna.
--   * `tendencia_gm`: una tupla por (género, mundo, tienda) con venta en alguno de los dos acumulados (no se inventan ceros).
--   * Unidades netas (las devoluciones restan) y soles netos de IGV, como los guarda M5. Orden determinista en todo el documento.
--
-- CÓMO ESTÁ ESCRITA (rendimiento, ficha §2.4; es la «salida» de esa sección llevada más lejos: no hay ningún preagregado de cientos
-- de miles de grupos). Una función `language sql` se planifica SIN conocer los valores de sus parámetros, así que el plan tiene que
-- ser bueno para el peor caso (sin filtros) y no puede depender de estimaciones sobre ellos. Reglas que sigue el cuerpo, cada una
-- aprendida con una versión que en una base local con 890 mil hechos sintéticos tardaba de 9 s a más de 150 s:
--   1. Los parámetros se leen UNA vez en la CTE `a`; el resto los usa como subconsultas escalares (el cuerpo se puede medir como
--      consulta suelta con el mismo plan) y las ramas que no se piden no se ejecutan (filtro de una sola vez).
--   2. Los hechos se recorren UNA vez (CTE `g`) y se cruzan solo con TABLAS REALES (tiendas, marcas, equivalencias), nunca con CTEs:
--      una CTE no tiene estadísticas y el planificador la cruza mal (bucles anidados sin índice, hash sobre el lado grande o merge con
--      ordenación en disco).
--   3. NINGÚN filtro de parámetros va en el `where` del recorrido, ni siquiera el rango de periodos: todos van DENTRO de cada
--      agregado (`filter`), como expresiones baratas. Así la estimación de filas no se hunde y el plan es siempre recorrido
--      secuencial + hash joins. Con `periodo between desde and hasta` en el `where` el planificador estima un rango del 0,5 % (una
--      carga) y elige bucles anidados; con una sola cota estima un tercio de las cargas y, en vector-two (`random_page_cost` 1,1),
--      entra por la clave primaria de los hechos, que pesa tanto como la tabla (116 MB + 113 MB frente a 113 MB del recorrido
--      secuencial, con 256 MB de `shared_buffers`). Hoy el tablero pide de enero de Y−3 al último mes: TODA la tabla. Cuando haya
--      muchos más años cargados que los cuatro que pide, convendrá revisar esto (cota en el `where` o un índice por carga).
--      El filtro de GML es un `left join` a `equivalencias` (con cientos de nodos un `= any` por fila sería lento); el de temporada
--      es un subplan con hash sobre (equivalencia, AM), que solo se evalúa si hay filtro de temporada.
--   4. Se agrega DIRECTO al grano final con `grouping sets` sobre columnas reales: (tienda, mes) para `por_tienda`; (equivalencia, AM
--      de la unidad) para `por_dim`, `precios` y `fuera_universo`; (unidad de marca) para el desglose por marca. Son unos pocos miles
--      de grupos. El nodo, el género, el mundo, la temporada y si la venta tiene fila base se resuelven DESPUÉS, sobre esos grupos.
--   5. `hash_mem_multiplier = 8`: con `grouping sets` el planificador solo agrega por hash si su ESTIMACIÓN del tamaño cabe en
--      `work_mem x hash_mem_multiplier`; si no, ordena los 800 mil hechos una vez por conjunto (en disco). Con el valor por defecto
--      (2, es decir 32 MB) la estimación de hoy cabe con poco margen (cambia de plan por debajo de ~10 MB y crece con el número de
--      equivalencias y de agrupaciones de marca). Lo que de verdad se usa son unos 14 MB.
-- El stock se lee aparte, solo de la carga de `hasta`. Los cruces con las filas base usan `coalesce(equivalencia_id, uuid cero)` para
-- que sean igualdades (un `is not distinct from` no admite hash). Ver MEDICIÓN al final.
create or replace function public.tablero_venta(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set work_mem = '16MB'
set hash_mem_multiplier = 8
as $$
  with a as materialized (
    select
      x.desde,
      x.hasta,
      extract(year from x.hasta)::integer as y,
      coalesce(x.kp, extract(month from x.hasta)::integer) as kp,
      (x.hasta - interval '11 months')::date as desde12,
      make_date(extract(year from x.hasta)::integer - 3, 1, 1) as ini3,
      make_date(extract(year from x.hasta)::integer - 2, 1, 1) as ini2,
      make_date(extract(year from x.hasta)::integer - 1, 1, 1) as ini1,
      make_date(extract(year from x.hasta)::integer, 1, 1) as ini0,
      make_date(extract(year from x.hasta)::integer - 1, least(greatest(coalesce(x.kp, extract(month from x.hasta)::integer), 1), 12), 1) as fin1,
      make_date(extract(year from x.hasta)::integer, least(greatest(coalesce(x.kp, extract(month from x.hasta)::integer), 1), 12), 1) as fin0,
      x.gml_ids,
      x.am_ids,
      x.tienda_ids,
      x.temporadas,
      x.unidad,
      x.proy,
      x.desglose,
      x.solo
    from (
      select
        nullif(p ->> 'desde', '')::date as desde,
        nullif(p ->> 'hasta', '')::date as hasta,
        nullif(p ->> 'k_prima', '')::integer as kp,
        case when jsonb_typeof(p -> 'gml_ids') = 'array'
             then array(select jsonb_array_elements_text(p -> 'gml_ids'))::uuid[] end as gml_ids,
        case when jsonb_typeof(p -> 'agrupacion_marca_ids') = 'array'
             then array(select jsonb_array_elements_text(p -> 'agrupacion_marca_ids'))::uuid[] end as am_ids,
        case when jsonb_typeof(p -> 'tienda_ids') = 'array'
             then array(select jsonb_array_elements_text(p -> 'tienda_ids'))::uuid[] end as tienda_ids,
        case when jsonb_typeof(p -> 'temporadas') = 'array'
             then array(select jsonb_array_elements_text(p -> 'temporadas')) end as temporadas,
        nullif(p ->> 'unidad_marca_id', '')::uuid as unidad,
        nullif(p ->> 'proyeccion_id', '')::uuid as proy,
        nullif(p ->> 'desglose', '') as desglose,
        coalesce((p ->> 'solo_tendencia')::boolean, false) as solo
    ) x
  ),
  td as materialized (
    select
      t.id,
      (row_number() over (order by t.id) - 1)::integer as i
    from public.tiendas t
    where t.tipo = 'Tienda'
  ),
  bs as materialized (
    select distinct on (f.gml_id, coalesce(f.equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid), f.agrupacion_marca_id)
      f.gml_id,
      coalesce(f.equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid) as eq_nodo,
      f.agrupacion_marca_id as am_id,
      coalesce(f.temporada, 'sin_temporada') as temporada
    from public.proyeccion_filas f
    where f.proyeccion_id = (select a.proy from a)
      and f.tienda_id is null
      and f.activo
    order by f.gml_id, coalesce(f.equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid), f.agrupacion_marca_id,
             f.clave collate "C"
  ),
  bse as materialized (
    select distinct
      e.id as equivalencia_id,
      b.am_id
    from bs b
    join public.equivalencias e on e.genero_mundo_linea_id = b.gml_id
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
    where (select a.temporadas from a) is not null
      and b.temporada = any ((select a.temporadas from a)::text[])
      and b.eq_nodo = (case when n.nivel_planificacion = 'GMLE' then e.id else '00000000-0000-0000-0000-000000000000'::uuid end)
  ),
  g as materialized (
    select
      (grouping(v.tienda_id) = 0) as es_pt,
      (grouping(v.equivalencia_id) = 0) as es_eq,
      (grouping(cab.id) = 0) as es_un,
      v.tienda_id,
      v.periodo,
      v.equivalencia_id,
      cab.agrupacion_marca_id as am_id,
      cab.id as unidad_id,
      sum(v.unidades) filter (where fl.r and fl.t) as u,
      sum(v.venta_soles) filter (where fl.r and fl.t) as s,
      sum(v.unidades) filter (where v.periodo < (select a.ini2 from a) and v.periodo >= (select a.ini3 from a) and fl.r and fl.okt and fl.t) as u3,
      sum(v.unidades) filter (where v.periodo < (select a.ini1 from a) and v.periodo >= (select a.ini2 from a) and fl.r and fl.okt and fl.t) as u2,
      sum(v.unidades) filter (where v.periodo < (select a.ini0 from a) and v.periodo >= (select a.ini1 from a) and fl.r and fl.okt and fl.t) as u1,
      sum(v.unidades) filter (where v.periodo <= (select a.fin1 from a) and v.periodo >= (select a.ini1 from a) and fl.r and fl.okt and fl.t) as u_ant,
      sum(v.unidades) filter (where v.periodo <= (select a.fin0 from a) and v.periodo >= (select a.ini0 from a) and fl.r and fl.okt and fl.t) as u_cur,
      sum(v.venta_soles) filter (where v.periodo < (select a.ini0 from a) and v.periodo >= (select a.ini1 from a) and fl.r and fl.okt and fl.t) as s1,
      sum(v.venta_soles) filter (where v.periodo <= (select a.fin0 from a) and v.periodo >= (select a.ini0 from a) and fl.r and fl.okt and fl.t) as s_cur,
      sum(v.unidades) filter (where v.periodo >= (select a.desde12 from a) and fl.r and fl.okt and fl.t) as u12,
      sum(v.venta_soles) filter (where v.periodo >= (select a.desde12 from a) and fl.r and fl.okt and fl.t) as s12,
      sum(v.unidades) filter (where v.periodo < (select a.ini2 from a) and v.periodo >= (select a.ini3 from a) and fl.r) as f3,
      sum(v.unidades) filter (where v.periodo < (select a.ini1 from a) and v.periodo >= (select a.ini2 from a) and fl.r) as f2,
      sum(v.unidades) filter (where v.periodo < (select a.ini0 from a) and v.periodo >= (select a.ini1 from a) and fl.r) as f1,
      sum(v.unidades) filter (where v.periodo >= (select a.ini0 from a) and fl.r) as f0
    from public.venta_stock_vigente v
    join public.tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda'
    join public.marcas_unidad mu on mu.marca_id = v.marca_id
    join public.marcas cab on cab.id = mu.unidad_marca_id
    left join public.equivalencias fe
      on fe.id = v.equivalencia_id
     and fe.genero_mundo_linea_id = any ((select a.gml_ids from a)::uuid[])
    cross join lateral (
      select
        coalesce(
          v.periodo >= (select a.desde from a)
          and v.periodo <= (select a.hasta from a)
          and ((select a.gml_ids from a) is null or fe.id is not null)
          and ((select a.am_ids from a) is null or cab.agrupacion_marca_id = any ((select a.am_ids from a)::uuid[]))
          and ((select a.unidad from a) is null or cab.id = (select a.unidad from a)),
          false
        ) as r,
        coalesce(
          (select a.tienda_ids from a) is null
          or v.tienda_id = any ((select a.tienda_ids from a)::uuid[]),
          false
        ) as okt,
        coalesce(
          (select a.temporadas from a) is null
          or (v.equivalencia_id, cab.agrupacion_marca_id) in (select x.equivalencia_id, x.am_id from bse x),
          false
        ) as t
    ) fl
    where not (select a.solo from a)
    group by grouping sets (
      (v.tienda_id, v.periodo),
      (v.equivalencia_id, cab.agrupacion_marca_id),
      (cab.id)
    )
  ),
  gb as materialized (
    select
      e.genero_mundo_linea_id as gml_id,
      n.genero_id,
      n.mundo_id,
      x.am_id,
      b.temporada,
      (b.gml_id is not null) as en_universo,
      x.u3, x.u2, x.u1, x.u_ant, x.u_cur, x.s1, x.s_cur, x.u12, x.s12, x.f3, x.f2, x.f1, x.f0
    from g x
    join public.equivalencias e on e.id = x.equivalencia_id
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
    left join bs b
      on b.gml_id = e.genero_mundo_linea_id
     and b.am_id = x.am_id
     and b.eq_nodo = (case when n.nivel_planificacion = 'GMLE' then e.id else '00000000-0000-0000-0000-000000000000'::uuid end)
    where x.es_eq
  ),
  dimv as materialized (
    select
      z.d,
      coalesce(sum(z.u3), 0)::bigint as u3,
      coalesce(sum(z.u2), 0)::bigint as u2,
      coalesce(sum(z.u1), 0)::bigint as u1,
      coalesce(sum(z.u_ant), 0)::bigint as u_ant,
      coalesce(sum(z.u_cur), 0)::bigint as u_cur,
      coalesce(sum(z.s1), 0) as s1,
      coalesce(sum(z.s_cur), 0) as s_cur
    from (
      select
        case (select a.desglose from a)
          when 'genero' then y.genero_id::text
          when 'mundo' then y.mundo_id::text
          when 'linea' then y.gml_id::text
          when 'agrupacion_marca' then y.am_id::text
          else coalesce(y.temporada, 'fuera_universo')
        end as d,
        y.u3, y.u2, y.u1, y.u_ant, y.u_cur, y.s1, y.s_cur
      from gb y
      where (select a.desglose from a) in ('genero', 'mundo', 'linea', 'agrupacion_marca', 'temporada')
      union all
      select
        x.unidad_id::text as d,
        x.u3, x.u2, x.u1, x.u_ant, x.u_cur, x.s1, x.s_cur
      from g x
      where x.es_un
        and (select a.desglose from a) = 'marca'
    ) z
    group by z.d
  ),
  dimi as materialized (
    select
      x.*,
      (row_number() over (order by x.d collate "C") - 1) as i
    from dimv x
    where x.u3 <> 0 or x.u2 <> 0 or x.u1 <> 0 or x.u_ant <> 0 or x.u_cur <> 0 or x.s1 <> 0 or x.s_cur <> 0
  ),
  pre as materialized (
    select
      q.gml_id,
      q.am_id,
      q.u12,
      q.s12,
      (dense_rank() over (order by q.gml_id) - 1) as i_gml,
      (dense_rank() over (order by q.am_id) - 1) as i_am
    from (
      select
        y.gml_id,
        y.am_id,
        coalesce(sum(y.u12), 0)::bigint as u12,
        coalesce(sum(y.s12), 0) as s12
      from gb y
      group by y.gml_id, y.am_id
    ) q
    where q.u12 <> 0
       or q.s12 <> 0
  ),
  st as materialized (
    select
      v.tienda_id,
      sum(v.stock_unidades) filter (
        where ((select a.gml_ids from a) is null or fe.id is not null)
          and ((select a.am_ids from a) is null or cab.agrupacion_marca_id = any ((select a.am_ids from a)::uuid[]))
          and ((select a.unidad from a) is null or cab.id = (select a.unidad from a))
          and (
            (select a.temporadas from a) is null
            or (v.equivalencia_id, cab.agrupacion_marca_id) in (select x.equivalencia_id, x.am_id from bse x)
          )
      )::bigint as u
    from public.venta_stock_vigente v
    join public.marcas_unidad mu on mu.marca_id = v.marca_id
    join public.marcas cab on cab.id = mu.unidad_marca_id
    left join public.equivalencias fe
      on fe.id = v.equivalencia_id
     and fe.genero_mundo_linea_id = any ((select a.gml_ids from a)::uuid[])
    where not (select a.solo from a)
      and v.periodo = (select a.hasta from a)
    group by v.tienda_id
  ),
  tg as materialized (
    select
      n.genero_id,
      n.mundo_id,
      v.tienda_id,
      coalesce(sum(v.unidades) filter (
        where v.periodo >= (select a.ini0 from a) and v.periodo <= (select a.fin0 from a) and v.periodo <= (select a.hasta from a)
      ), 0)::bigint as u_cur,
      coalesce(sum(v.unidades) filter (
        where v.periodo >= (select a.ini1 from a) and v.periodo <= (select a.fin1 from a)
      ), 0)::bigint as u_ant
    from public.venta_stock_vigente v
    join public.tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda'
    join public.equivalencias e on e.id = v.equivalencia_id
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
    where (select a.solo from a)
      and v.periodo >= (select a.ini1 from a)
    group by 1, 2, 3
  ),
  per as materialized (
    select coalesce(jsonb_object_agg(to_char(c.periodo, 'YYYY-MM'), c.id order by c.periodo), '{}'::jsonb) as doc
    from public.cargas_venta_stock c
    where c.estado = 'publicada'
      and c.periodo >= (select a.desde from a)
      and c.periodo <= (select a.hasta from a)
  ),
  tds as materialized (
    select coalesce(jsonb_agg(td.id order by td.i), '[]'::jsonb) as doc
    from td
  )
  select case
    when a.solo then jsonb_build_object(
      'periodos', (select per.doc from per),
      'tiendas', (select tds.doc from tds),
      'tendencia_gm', coalesce((
        select jsonb_agg(jsonb_build_array(x.genero_id, x.mundo_id, td.i, x.u_cur, x.u_ant) order by x.genero_id, x.mundo_id, td.i)
        from tg x
        join td on td.id = x.tienda_id
        where x.u_cur <> 0
           or x.u_ant <> 0
      ), '[]'::jsonb)
    )
    else jsonb_build_object(
      'periodos', (select per.doc from per),
      'tiendas', (select tds.doc from tds),
      'por_tienda', coalesce((
        select jsonb_agg(jsonb_build_array(td.i, to_char(x.periodo, 'YYYY-MM'), x.u::bigint, x.s) order by td.i, x.periodo)
        from g x
        join td on td.id = x.tienda_id
        where x.es_pt
          and x.u is not null
      ), '[]'::jsonb),
      'por_dim', case
        when a.desglose in ('genero', 'mundo', 'linea', 'agrupacion_marca', 'marca', 'temporada') then jsonb_build_object(
          'ids', coalesce((select jsonb_agg(x.d order by x.i) from dimi x), '[]'::jsonb),
          'filas', coalesce((
            select jsonb_agg(jsonb_build_array(x.i, x.u3, x.u2, x.u1, x.u_ant, x.u_cur, x.s1, x.s_cur) order by x.i)
            from dimi x
          ), '[]'::jsonb)
        )
        else null
      end,
      'precios', jsonb_build_object(
        'gml', coalesce((
          select jsonb_agg(q.gml_id order by q.i_gml)
          from (select distinct x.gml_id, x.i_gml from pre x) q
        ), '[]'::jsonb),
        'am', coalesce((
          select jsonb_agg(q.am_id order by q.i_am)
          from (select distinct x.am_id, x.i_am from pre x) q
        ), '[]'::jsonb),
        'filas', coalesce((
          select jsonb_agg(jsonb_build_array(x.i_gml, x.i_am, x.u12, x.s12) order by x.i_gml, x.i_am)
          from pre x
        ), '[]'::jsonb)
      ),
      'stock', jsonb_build_object(
        'periodo', to_char(a.hasta, 'YYYY-MM'),
        'por_tienda', coalesce((
          select jsonb_agg(jsonb_build_array(td.i, x.u) order by td.i)
          from st x
          join td on td.id = x.tienda_id
          where x.u <> 0
            and (a.tienda_ids is null or x.tienda_id = any (a.tienda_ids))
        ), '[]'::jsonb),
        'cd', case
          when a.tienda_ids is null then coalesce((
            select sum(x.u)
            from st x
            where x.tienda_id not in (select td.id from td)
          ), 0)
          else null
        end
      ),
      'tendencia_gm', null,
      'fuera_universo', case
        when a.proy is not null then coalesce((
          select jsonb_agg(jsonb_build_array(q.anio, q.u) order by q.anio)
          from (
            select w.anio, sum(w.u)::bigint as u
            from gb y
            cross join lateral (values (a.y - 3, y.f3), (a.y - 2, y.f2), (a.y - 1, y.f1), (a.y, y.f0)) as w(anio, u)
            where not y.en_universo
              and w.u is not null
            group by w.anio
          ) q
        ), '[]'::jsonb)
        else null
      end
    )
  end
  from a;
$$;

revoke execute on function public.tablero_venta(jsonb) from public, anon, authenticated;
grant execute on function public.tablero_venta(jsonb) to service_role;

comment on function public.tablero_venta(jsonb) is
  'M14 0.19.0: venta publicada agregada para el tablero de direccion, en un jsonb { periodos (aaaa-mm -> carga publicada del rango), tiendas (indice de las de tipo Tienda), por_tienda [i_t, mes, unidades, soles] (todas las tiendas del recorte, sin CD), por_dim (totales por elemento del desglose: tres anios, acumulados a k_prima y soles), precios (unidades y soles de 12 meses por nodo x agrupacion de marca), stock (unidades del mes hasta por tienda y en el CD), tendencia_gm (solo con solo_tendencia: sin filtros), fuera_universo (venta sin fila base en la proyeccion, por anio) }. Filtros en p: gml_ids, agrupacion_marca_ids, unidad_marca_id, temporadas (semiunion con las filas base de proyeccion_id) y tienda_ids (solo recorta por_dim, precios y stock). Lee de venta_stock_vigente solo unidades, soles de venta y stock en unidades. work_mem 16MB. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 6. `registrar_aprobacion_direccion(p jsonb) returns jsonb` (ficha §2.3 d)
-- ---------------------------------------------------------------------------
-- La ÚNICA escritura de `aprobaciones_direccion` (el servidor no hace `insert` directo). Solo la llama
-- `src/lib/direccion/consultas.ts` con `service_role`, desde `POST /api/direccion/aprobaciones` (`requireAdmin`). Entrada, ya
-- validada por zod; `perfil_id`, `usuario_nombre` y `rol` los pone el servidor desde la sesión:
--   { proyeccion_id, huella_vista, resultado, motivo, comentario, resumen, perfil_id, usuario_nombre, rol }
-- En una transacción (la de la llamada RPC):
--   1. `select ... for share` de la proyección: impide que otra sesión la cierre, archive o borre mientras se registra (choca con el
--      `update` de cerrar y con el `for no key update` de `aplicar_lote_proyeccion`).
--   2. No existe O ESTÁ INACTIVA (`activo = false`: eliminada de forma lógica) -> { "error": "no_encontrada" }, el mismo código
--      para las dos; `estado = 'archivada'` -> "archivada"; `calculando_desde` de menos de 15 minutos (`CALCULO_CADUCA_MIN`) ->
--      "calculo_en_curso"; `resumen is null` -> "sin_calcular".
--   3. Recalcula la huella. Si difiere de `huella_vista` o de `resumen.huella` -> { "error": "huella_distinta", "huella_actual": h }
--      SIN insertar (R14, R16).
--   4. Inserta con `huella = h` y `estado_proyeccion` = el estado leído en el paso 1, y devuelve la fila como jsonb.
-- QUÉ FRENA Y QUÉ NO EL `for share`: bloquea la FILA de `proyecciones` (cerrar, archivar, borrar, aplicar un lote), pero NO las
-- decisiones fila a fila, que escriben en `proyeccion_fila_anios` sin tocar la cabecera. Entre el cálculo de la huella (paso 3) y el
-- `insert` (paso 4), o justo después, otra sesión puede decidir una fila: la aprobación queda registrada con la huella que vio el
-- admin y NACE YA INVALIDADA (la huella actual es otra). Es un fallo SEGURO: nunca se da por aprobado algo distinto de lo que se
-- miró; el tablero la mostrará como invalidada y habrá que volver a aprobar. No se bloquean las filas a propósito (frenaría el
-- trabajo del planner mientras dirección decide).
-- Los códigos vuelven EN EL JSONB, sin `raise`, para que el handler los traduzca a 404 o 409 sin interpretar mensajes (se aparta a
-- propósito de `aplicar_lote_proyeccion`, que usa `raise` con LP001 a LP007). La respuesta de éxito es la fila (trae `id` y no trae
-- `error`). Un dato que viole un `check` de la tabla (por ejemplo un `rol` que no sea admin) sí lanza la excepción del `check`: zod
-- ya lo validó y la base es la segunda barrera.
create or replace function public.registrar_aprobacion_direccion(p jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'proyeccion_id', '')::uuid;
  v_proy public.proyecciones%rowtype;
  v_huella text;
  v_fila public.aprobaciones_direccion%rowtype;
begin
  select * into v_proy
    from public.proyecciones
   where id = v_id
     for share;
  if not found or not v_proy.activo then
    return jsonb_build_object('error', 'no_encontrada');
  end if;
  if v_proy.estado = 'archivada' then
    return jsonb_build_object('error', 'archivada');
  end if;
  if v_proy.calculando_desde is not null and v_proy.calculando_desde > now() - interval '15 minutes' then
    return jsonb_build_object('error', 'calculo_en_curso');
  end if;
  if v_proy.resumen is null then
    return jsonb_build_object('error', 'sin_calcular');
  end if;

  v_huella := public.huella_proyeccion(v_id);
  if v_huella is distinct from (p ->> 'huella_vista')
     or v_huella is distinct from (p -> 'resumen' ->> 'huella') then
    return jsonb_build_object('error', 'huella_distinta', 'huella_actual', v_huella);
  end if;

  insert into public.aprobaciones_direccion (
    proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, motivo, comentario, resumen, perfil_id, usuario_nombre, rol
  )
  values (
    v_proy.id,
    v_proy.anio_en_curso,
    v_proy.estado,
    v_huella,
    p ->> 'resultado',
    nullif(p ->> 'motivo', ''),
    nullif(p ->> 'comentario', ''),
    p -> 'resumen',
    nullif(p ->> 'perfil_id', '')::uuid,
    p ->> 'usuario_nombre',
    p ->> 'rol'
  )
  returning * into v_fila;

  return to_jsonb(v_fila);
end;
$$;

revoke execute on function public.registrar_aprobacion_direccion(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_aprobacion_direccion(jsonb) to service_role;

comment on function public.registrar_aprobacion_direccion(jsonb) is
  'M14 0.19.0: unica escritura de aprobaciones_direccion. Bloquea la proyeccion con for share (frena cerrar, archivar, borrar y lotes; no las decisiones fila a fila: una aprobacion puede nacer ya invalidada, que es el fallo seguro), comprueba que exista y este activa, que no este archivada, que no haya calculo en curso (15 minutos) y que este calculada, recalcula la huella y la compara con huella_vista y con resumen.huella; si todo coincide inserta la aprobacion con la huella recalculada y devuelve la fila. Los errores vuelven en el jsonb sin raise: no_encontrada, archivada, calculo_en_curso, sin_calcular, huella_distinta (con huella_actual). Solo service_role.';

-- ---------------------------------------------------------------------------
-- 7. RLS (sin políticas: solo el backend con service_role) y privilegios
-- ---------------------------------------------------------------------------
alter table public.aprobaciones_direccion enable row level security;

-- Tabla de solo inserción (regla de la 0035, H-6 de la 0040): `service_role` solo lee e inserta. Sin update, delete, truncate,
-- references ni trigger; el trigger de inmutabilidad queda como segunda barrera (la que vale para el dueño). La FK `set null` de
-- `perfil_id` corre con los privilegios del dueño de la tabla, no con los de quien borra el perfil: no exige update a `service_role`.
-- `revoke all` primero porque los privilegios por defecto dan `all` a `service_role` (y a anon y authenticated en una base nueva).
revoke all on public.aprobaciones_direccion from public, anon, authenticated, service_role;
grant select, insert on public.aprobaciones_direccion to service_role;

-- ---------------------------------------------------------------------------
-- MEDICIÓN 0041 (puerta de la ficha §2.4) · estado al 2026-11-10: PENDIENTE DE LOS TIEMPOS REALES
-- ---------------------------------------------------------------------------
-- La medición definitiva (tiempo en frío y en caliente y tamaño del documento, cinco casos) se hace llamando a `tablero_venta` YA
-- APLICADA en vector-two, con un `statement_timeout` corto, y se anota aquí. Lo que hay hasta ese momento:
--
-- 1. Lo que pasó en vector-two (solo lecturas, sin crear nada). La PRIMERA versión del cuerpo (dimensiones en CTEs filtradas por
--    parámetros y un preagregado por nodo x AM x tienda x mes), medida como consulta suelta con `explain (analyze, buffers)` en el
--    caso 1 (sin filtros, `desglose = linea`), NO TERMINÓ: la llamada del MCP expiró a los 60 s (el `statement_timeout` de la base
--    es de 2 minutos). No se volvió a ejecutar en vector-two ninguna versión del cuerpo.
--
-- 2. Reproducción en LOCAL a escala real (PostgreSQL 16; datos SINTÉTICOS: 889 675 hechos, 45 cargas, 11 tiendas + 1 CD, 590 nodos,
--    2 336 equivalencias, 599 marcas, una proyección con 1 606 filas base y 6 424 registros; con los parámetros de vector-two:
--    `random_page_cost` 1,1, `effective_cache_size` 768 MB, `work_mem` 3,5 MB, `jit` off y sin paralelismo). Caso 1:
--      * 1.ª versión: más de 150 s (cancelada). El planificador, que no ve los parámetros, estimaba 5 marcas x 51 equivalencias x
--        1 carga y recorría 1,4 millones de pares con bucles anidados.
--      * tablas reales con los filtros en el `where`: 9,4 s (bucles anidados y ordenación de 69 MB en disco).
--      * banderas por fila con dimensiones en CTEs: 3,3 s (hash construido sobre los hechos; merge join con 111 MB ordenados).
--      * `grouping sets` sobre una subconsulta con barrera: 2,2 s (un conjunto por hash y dos ordenando 85 MB en disco).
--      * VERSIÓN DE ESTE ARCHIVO, llamando a la función: caso 1 (sin filtros, línea) 1,5 a 1,7 s; caso 2 (sin filtros, marca)
--        1,5 s; caso 3 (una AM) 1,4 s; caso 4 (una unidad de marca y una tienda) 1,2 s; caso 5 (`solo_tendencia`) 0,28 s;
--        temporada + 300 nodos 1,2 s. Dos tandas seguidas, sin diferencia apreciable entre la primera y la segunda. Como el plan
--        recorre siempre toda la tabla, filtrar no lo hace más rápido: todos los cambios de filtro cuestan lo mismo.
--      * `tablero_proyeccion`: 0,31 s sin desglose, 0,34 s por línea, 0,46 s por marca, 0,18 s con unidad de marca (una versión
--        anterior tardaba 10 s por marca y 5 s con unidad: bucle anidado sobre una CTE). `huella_proyeccion`: 19 ms.
--    El criterio de tiempo (2,5 s en frío para los casos 1 y 2) se cumple en local con margen; la máquina de vector-two es otra.
--
-- 3. Plan en vector-two de la versión de este archivo (`explain` SIN `analyze`: no ejecuta la consulta; PostgreSQL 17.11, 870 359
--    hechos en 14 491 páginas, clave primaria de 116 MB): recorrido secuencial de `venta_stock_mensual` + hash joins con `tiendas`,
--    `cargas_venta_stock`, `marcas` (tres veces, por la vista `marcas_unidad`) y `equivalencias` + `HashAggregate` con tres claves
--    de hash (9 422 grupos estimados). Es el mismo plan que en local. Con la cota `periodo >= desde` en el `where` el plan real
--    entraba por la clave primaria (Nested Loop cargas -> Index Scan): por eso no hay ningún filtro de periodo en el `where`.
--
-- 4. TAMAÑO (criterio: documento del caso 1 <= 150 KB). Sin medir en real. En local el caso 1 pesa 175 KB, pero con 2 876 pares
--    nodo x AM con venta (`precios` 96 KB, `por_dim` 58 KB, `por_tienda` 17 KB); en vector-two la proyección tiene 1 606 pares, lo
--    que apunta a unos 130 a 145 KB: JUSTO. Si al medir pasa de 150 KB es un asunto del contrato (los uuid de los nodos van dos
--    veces: en `precios.gml` y en `por_dim.ids`), no de rendimiento. `tablero_proyeccion` sin desglose: `por_par` (un uuid por nodo
--    más una tupla por par) pesa unos 55 KB con 1 606 pares, así que el documento rondará los 80 KB, por encima de los 60 KB que
--    estima la ficha; con `desglose = linea`, `por_dim` añade unos 230 bytes por nodo (las tiendas van con su uuid completo).

-- ---------------------------------------------------------------------------
-- 8. Registro de esta migración (convención de la 0035: la última sentencia)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas (nombre, nota)
values ('0041_tablero_direccion', 'M14: aprobaciones_direccion (solo insercion), huella_proyeccion, tablero_proyeccion, tablero_venta y registrar_aprobacion_direccion')
on conflict (nombre) do nothing;

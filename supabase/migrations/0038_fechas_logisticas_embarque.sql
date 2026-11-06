-- 0038 · Fechas logísticas del embarque, línea de tiempo de la compra, número de OC y mes de destino por asignación (M8 · 08b-1b).
--
-- Ficha: docs/modulos/08b-fechas-logisticas.md (revisión 5; §2 modelo, §2.4 y §2.4 bis la regla del mes, §2.5 el piso del ingreso de un
-- paquete, §2.9 funciones, §2.10 `cambiar_fecha`, §2.11 número de OC). Decisiones propuestas 115 a 121. Depende de 0025 (`compras`,
-- `compra_eventos`), 0032 (viajes, embarques, paquetes, asignaciones, `compra_agrupador_eventos`) y 0036 (versiones vigentes de las
-- funciones de agrupadores). La 0037 es la última aplicada en Vector2 y hay 0 viajes, embarques, paquetes, asignaciones, compras,
-- líneas, entregas y eventos: no hay nada que mover ni backfill.
--
-- SE APLICA EN LA MISMA VENTANA QUE LA APLICACIÓN NUEVA (ficha §9.1): primero esta migración, enseguida el despliegue. Con la base nueva
-- y el código viejo, un `PATCH` que mande la salida de un embarque ya guardado recibe `fecha_por_movimiento` (la salida deja de editarse
-- ahí); con la base vieja y el código nuevo, la ruta `/fechas` fallaría.
--
-- Qué hace (en este orden; §2.9):
--   1. Columnas nuevas, aditivas y nulas, con sus `check` declarados dentro de `add column if not exists`:
--      `compra_embarques` (fecha_puerto_estimada, fecha_inicio_operativo_estimada, hora_inicio_operativo, hito_confirmado, origen,
--      fecha_ingreso_estimada), `compra_paquetes` (fecha_ingreso_estimada y `periodo_ingreso` generada), `compra_agrupador_eventos.causa`
--      y `compras.numero_oc`.
--   2. `compra_embarques.periodo_llegada` pasa a leer `coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`
--      (decisión 115: el mes del flujo es el del ingreso al stock; nulo = el día del Ingreso CD). VER «PostgreSQL 17 y 16» abajo.
--   3. Índices: `compras_numero_oc_idx` y el único parcial `compras_proveedor_oc_uidx` (una OC es de una sola compra viva de cada
--      proveedor, I10). `compra_embarques_periodo_llegada_idx` se reafirma con `if not exists`.
--   4. Funciones (`create or replace`, misma firma, a partir de la versión vigente: la 0032 para las dos de lectura y la 0036 para las
--      de escritura): agrupador_foto_embarque, agrupadores_desalineados, guardar_embarque, guardar_paquete, cambiar_estado_agrupador,
--      aplicar_movimiento_agrupador e importar_agrupadores; y TRES nuevas: agrupador_hitos_resumen, editar_oc_compra y el ayudante
--      agrupador_hito_violado (I7; ver «Desvíos»).
--   5. Registro en `migraciones_aplicadas` (convención de la 0035: la última sentencia).
-- Idempotente: se corre dos veces sin error. Sin `delete`, `truncate` ni `update` a nivel de migración (los hay dentro de las funciones,
-- que es su trabajo). Los cuerpos de las funciones no llevan comentarios `--` (se aplican por `execute_sql` en trozos): lo que hay que
-- saber de cada una está aquí, encima. No hay tablas nuevas: no hay RLS que activar (las seis tablas tocadas ya la tienen, sin
-- políticas). `compra_agrupador_eventos` sigue siendo de solo inserción (el trigger de inmutabilidad no se toca; una columna nueva
-- no dispara triggers de fila).
--
-- PostgreSQL 17 y 16 (EXCEPCIÓN DOCUMENTADA a «sin `do $$`»). Vector2 y la CI son PostgreSQL 17, que tiene
-- `alter table ... alter column ... set expression as (...)`; el contenedor de desarrollo es PostgreSQL 16, que NO lo tiene. Cambiar la
-- expresión de una columna generada sin `set expression` exige recrear la columna, y eso no se puede escribir como una sentencia que
-- valga en las dos versiones. Por eso el paso 2 es UN bloque `do` que mira `server_version_num` y toma uno de dos caminos:
--     >= 17: `set expression` (reescribe `compra_embarques` y su índice bajo ACCESS EXCLUSIVE; no dispara triggers ni cambia datos);
--     <  17: quita y vuelve a crear `periodo_llegada` con la expresión nueva (solo existe para que la base local de pruebas valga).
--            Es el único `drop` de esta migración; no corre nunca en Vector2. Deja la columna al final de la tabla (en 17 conserva su
--            posición); los lectores usan nombres, no posiciones.
-- Ambos caminos son idempotentes: si la expresión de la columna ya nombra `fecha_ingreso_estimada`, no hacen nada. El bloque va
-- DESPUÉS de los `add column` (la expresión nombra `fecha_ingreso_estimada`) y ANTES de las funciones. Quien aplique la migración a
-- mano en el SQL Editor de Supabase (PostgreSQL 17) puede saltarse el bloque y correr directamente la sentencia `set expression` de su
-- primera rama; el resultado es el mismo.
--
-- Reglas que esta migración fija en las funciones (todas con `security invoker`, `search_path` vacío, `revoke ... from public, anon,
-- authenticated` y `grant execute ... to service_role`; candados de la 0036 intactos: viajes y embarques `for no key update`, compras
-- `for update` y el orden viajes -> embarques -> compras):
--   * MES DE DESTINO DE UNA ASIGNACIÓN (§2.4 bis): siempre `coalesce(pq.periodo_ingreso, b.periodo_llegada)` con
--     `left join public.compra_paquetes pq on pq.id = a.paquete_id`, escrito en línea (no hay función auxiliar). I2 generalizada:
--     `aplicar_movimiento_agrupador` la exige sobre TODAS las asignaciones activas de TODOS los embarques del plan, en TODA operación
--     (hoy solo las que recibieron unidades y solo en cuatro operaciones), y `agrupadores_desalineados()` la usa con la misma firma
--     (su columna de salida `periodo_llegada` pasa a contener el mes de destino; cambiar las columnas de salida exigiría `drop`).
--   * `cambiar_fecha` acepta planes SIN `fecha_llegada_estimada`: cualquier hito, `hito_confirmado`, el ingreso del embarque y los
--     `paquetes`. Una clave presente en el embarque del plan es el valor nuevo (`null` = vaciar), una ausente conserva lo guardado.
--     Motivo y causa solo si REPROGRAMA (§2.10, paso 3). Un plan «viejo» (sin clave `causa`, sin `paquetes` y con solo
--     `fecha_llegada_estimada`) se comporta como hoy: pide motivo, no causa (los humos 0032, 0034 y 0036 siguen en verde).
--   * Piso del ingreso propio de un paquete (I9): los planes lo ajustan y avisan (`ingreso_paquete_ajustado`, es de TypeScript); la
--     función lo comprueba al final sobre los embarques del plan (`AG002`).
--   * I7 en todo guardado: el hito confirmado tiene fecha y ningún hito en o antes de él tiene fecha futura (hora de Lima).
--   * `guardar_embarque` al editar NO escribe fechas ni horas: clave ausente conserva (corrige el defecto de §0: un `PATCH` sin salida
--     la borraba), clave presente y distinta (null incluido) da `fecha_por_movimiento`.
--   * `editar_oc_compra` NO sube `compras.revision` (la OC no toca cantidades ni fechas).
--   * Los códigos `aamm##` de un paquete nuevo toman el mes del Ingreso CD de su embarque (como el embarque), no `periodo_llegada`.
--
-- Desvíos respecto de la ficha (menores, todos para que el SQL sea verificable): (1) el ayudante `agrupador_hito_violado(uuid)` evita
-- repetir en dos sitios la expresión larga de I7; (2) `agrupador_hitos_resumen` devuelve además la fila `ingreso_paquete` por cada
-- paquete con ingreso propio; (3) `editar_oc_compra` devuelve `oc_invalida` si la OC no cabe en el `check` (40 caracteres, sin espacios
-- al borde) en lugar de dejar pasar un error de base; (4) en `aplicar_movimiento_agrupador`, `paquetes` solo vale en `cambiar_fecha` y
-- `mover_paquete` (en otra operación es un plan inválido, `AG002`).

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------------
-- `compra_embarques` (§2.1). Los cinco hitos logísticos son del embarque: Zarpe = `fecha_salida_estimada` (ya existía), Arribo =
-- `fecha_puerto_estimada`, Ingreso CD = `fecha_llegada_estimada` (conserva su significado de origen y es la obligatoria), Inicio
-- operativo = `fecha_inicio_operativo_estimada` + `hora_inicio_operativo` (hora de Lima, sin zona: las previsiones son por día y la hora
-- aparece cuando de verdad arranca) e Ingreso al stock = `fecha_ingreso_estimada` (nulo = el día del Ingreso CD; manda el mes del flujo).
-- `hito_confirmado`: último hito que YA ocurrió, en orden zarpe < arribo < ingreso_cd < inicio_operativo (el ingreso al stock se confirma
-- al recibir, 08b-2). `origen`: almacén o ciudad de origen («California», «Nueva York»), texto libre con sugerencias, sin catálogo.
-- El `check` de la hora lo declara la propia columna: el `add column if not exists` omite la cláusula entera si la columna ya existe,
-- así que repetir la migración no falla y no hace falta un bloque `do` para los `check`.
alter table public.compra_embarques
  add column if not exists fecha_puerto_estimada date,
  add column if not exists fecha_inicio_operativo_estimada date,
  add column if not exists hora_inicio_operativo time
    constraint compra_embarques_hora_sin_fecha_check
      check (hora_inicio_operativo is null or fecha_inicio_operativo_estimada is not null),
  add column if not exists hito_confirmado text
    constraint compra_embarques_hito_confirmado_check
      check (hito_confirmado is null or hito_confirmado in ('zarpe', 'arribo', 'ingreso_cd', 'inicio_operativo')),
  add column if not exists origen text
    constraint compra_embarques_origen_len_check
      check (origen is null or char_length(origen) <= 80),
  add column if not exists fecha_ingreso_estimada date;

comment on column public.compra_embarques.fecha_puerto_estimada is
  'M8 08b-1b: Arribo (llegada a puerto). Nulo si no se sabe; no aplica a embarques local (puerto_en_local). Se cambia solo por aplicar_movimiento_agrupador (cambiar_fecha).';
comment on column public.compra_embarques.fecha_inicio_operativo_estimada is
  'M8 08b-1b: Inicio operativo (empieza el conteo y el proceso en el CD). Fecha prevista o real; la hora opcional va en hora_inicio_operativo. Nunca decide el mes (I6).';
comment on column public.compra_embarques.hora_inicio_operativo is
  'M8 08b-1b: hora de Lima (sin zona) del Inicio operativo, opcional; sin fecha no puede existir (check).';
comment on column public.compra_embarques.hito_confirmado is
  'M8 08b-1b: ultimo hito que YA ocurrio: zarpe, arribo, ingreso_cd o inicio_operativo (en ese orden; check). Exige la fecha de ese hito, no futura (I7). El ingreso al stock se confirma al recibir (08b-2).';
comment on column public.compra_embarques.origen is
  'M8 08b-1b: almacen o ciudad de origen del embarque (California, Nueva York), texto de hasta 80 con sugerencias. No es puerto_embarque.';
comment on column public.compra_embarques.fecha_ingreso_estimada is
  'M8 08b-1b (decision 115): Ingreso al stock fijado a mano. Nulo = el dia del Ingreso CD (fecha_llegada_estimada) y lo sigue. Con valor manda el mes del flujo (periodo_llegada).';
comment on column public.compra_embarques.fecha_llegada_estimada is
  'M8 08b-1: Ingreso CD (llegada fisica al centro de distribucion); obligatoria. Desde 08b-1b ya no manda sola el mes: lo manda coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada). Se cambia solo por aplicar_movimiento_agrupador.';

-- `compra_paquetes` (§2.1, §2.5): ingreso al stock PROPIO del paquete (lo al barrer se programa por paquete, todo junto o por partes).
-- Nulo = hereda el del embarque. Nunca anterior a `coalesce(fecha_llegada_real, fecha_llegada_estimada)` de su embarque (I9; los planes
-- lo ajustan). `periodo_ingreso`: primer día del mes de ese ingreso, nulo si es nulo; la misma expresión inmutable con `make_date` de
-- `periodo_llegada` (con `date_trunc` sobre un `date` la columna generada falla). Agregarla reescribe `compra_paquetes` (decenas de filas).
alter table public.compra_paquetes
  add column if not exists fecha_ingreso_estimada date,
  add column if not exists periodo_ingreso date generated always as (
    make_date(
      extract(year from fecha_ingreso_estimada)::integer,
      extract(month from fecha_ingreso_estimada)::integer,
      1
    )
  ) stored;

comment on column public.compra_paquetes.fecha_ingreso_estimada is
  'M8 08b-1b (decision 119): ingreso al stock propio del paquete (lo al barrer). Nulo = hereda el del embarque. Nunca anterior a coalesce(fecha_llegada_real, fecha_llegada_estimada) del embarque (I9): los planes lo suben al piso y avisan ingreso_paquete_ajustado.';
comment on column public.compra_paquetes.periodo_ingreso is
  'M8 08b-1b: primer dia del mes de fecha_ingreso_estimada (nulo si ella es nula). Generada con make_date (inmutable). El mes de destino de una asignacion es coalesce(periodo_ingreso, embarque.periodo_llegada).';

-- `compra_agrupador_eventos.causa` (§2.6): por qué se reprograma. Catálogo en zod Y en la base; ampliarlo pedirá una migración
-- (aceptado: casi no cambia). Las causas `correccion` y `programacion` quedan en el historial pero no cuentan como atraso.
alter table public.compra_agrupador_eventos
  add column if not exists causa text
    constraint compra_agrupador_eventos_causa_check
      check (causa is null or causa in ('pago', 'produccion', 'naviera', 'aduana', 'transporte', 'cola_conteo', 'programacion', 'correccion', 'otro'));

comment on column public.compra_agrupador_eventos.causa is
  'M8 08b-1b: causa de una reprogramacion de fechas (pago, produccion, naviera, aduana, transporte, cola_conteo, programacion, correccion u otro). Nula en los eventos que no reprograman. correccion y programacion no cuentan como atraso.';

-- `compras.numero_oc` (§2.11, decisión 121): el número de la orden de compra real (p. ej. de SAP), aparte del código X (`numero`,
-- inmutable) y de la `referencia` del importador (congelada: es la clave con que se reimporta sin duplicar). Se guarda tal como se
-- escribe, sin espacios al borde; se compara con `upper(btrim())`. Nula = todavía sin registrar.
alter table public.compras
  add column if not exists numero_oc text
    constraint compras_numero_oc_check
      check (numero_oc is null or (char_length(numero_oc) between 1 and 40 and numero_oc = btrim(numero_oc)));

comment on column public.compras.numero_oc is
  'M8 08b-1b (decision 121): numero de la orden de compra real (SAP), de 1 a 40 caracteres sin espacios al borde; nulo hasta que se registra. Unica por proveedor entre compras no canceladas (compras_proveedor_oc_uidx). Se edita solo con editar_oc_compra (no sube revision, deja el evento editar_oc). No es la referencia del importador ni el codigo X.';

-- ---------------------------------------------------------------------------
-- 2. `periodo_llegada` lee el ingreso al stock (decisión 115)
-- ---------------------------------------------------------------------------
-- `periodo_llegada = primer día del mes de coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`. DESPUÉS del
-- `add column` de `fecha_ingreso_estimada` (la expresión la nombra). Sin datos que reescribir en Vector2 (0 embarques); el índice
-- `compra_embarques_periodo_llegada_idx` es lo único que depende de la columna (ninguna vista ni función con cuerpo SQL estándar la usa).
-- Reaplicarla no hace nada: se compara la expresión vigente. Lo explica la cabecera («PostgreSQL 17 y 16»).
do $do$
declare
  v_actual text;
  v_expr constant text := 'make_date(extract(year from coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada))::integer, extract(month from coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada))::integer, 1)';
begin
  select pg_get_expr(d.adbin, d.adrelid)
    into v_actual
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.compra_embarques'::regclass
     and a.attname = 'periodo_llegada';
  if v_actual is not null and v_actual like '%fecha_ingreso_estimada%' then
    null;
  elsif current_setting('server_version_num')::integer >= 170000 then
    execute 'alter table public.compra_embarques alter column periodo_llegada set expression as (' || v_expr || ')';
  else
    execute 'alter table public.compra_embarques drop column periodo_llegada';
    execute 'alter table public.compra_embarques add column periodo_llegada date generated always as (' || v_expr || ') stored';
  end if;
end
$do$;

comment on column public.compra_embarques.periodo_llegada is
  'M8 08b-1b (decision 115): primer dia del mes de coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada): el real; si no, el ingreso al stock fijado; si no, el Ingreso CD. Generada con make_date (inmutable). TypeScript usa la misma regla (periodoLlegada). El mes de una asignacion es coalesce(paquete.periodo_ingreso, periodo_llegada).';

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
-- Cubre el índice de `periodo_llegada` si el camino de PostgreSQL 16 recreó la columna (en 17 ya existe: no hace nada).
create index if not exists compra_embarques_periodo_llegada_idx on public.compra_embarques (periodo_llegada);

-- Búsqueda exacta por OC y aviso `oc_de_otro_proveedor`: el único de abajo empieza por `proveedor_id` y no sirve para buscar solo por OC.
create index if not exists compras_numero_oc_idx on public.compras (upper(btrim(numero_oc))) where numero_oc is not null;

-- I10: una OC es de UNA sola compra viva de cada proveedor (Javier: «bloquear en el mismo proveedor, avisar en otro»). Parcial: las
-- compras sin OC no chocan (dos NULL no chocan en un único normal) y las canceladas liberan su OC. Sobre una expresión: no cuenta
-- como clave para los candados de fila (un `update` de `numero_oc` sigue tomando `for no key update`). Hoy no hay compras.
create unique index if not exists compras_proveedor_oc_uidx
  on public.compras (proveedor_id, upper(btrim(numero_oc)))
  where numero_oc is not null and estado <> 'cancelada';

-- ---------------------------------------------------------------------------
-- 4.1 `agrupador_foto_embarque` (0032)
-- ---------------------------------------------------------------------------
-- Suma Arribo, Inicio operativo (fecha y hora), el ingreso al stock fijado, `hito_confirmado`, `origen` y el ingreso propio de cada
-- paquete abierto (`paquetes`), para que `compra_agrupador_eventos.antes` y `despues` cuenten la historia de cada hito. Las claves que ya
-- existían conservan su nombre y su forma. `agrupador_hitos_resumen` lee esta forma.
create or replace function public.agrupador_foto_embarque(p_embarque uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'estado', e.estado,
    'revision', e.revision,
    'viaje_id', e.viaje_id,
    'fecha_salida_estimada', e.fecha_salida_estimada,
    'fecha_puerto_estimada', e.fecha_puerto_estimada,
    'fecha_llegada_estimada', e.fecha_llegada_estimada,
    'fecha_inicio_operativo_estimada', e.fecha_inicio_operativo_estimada,
    'hora_inicio_operativo', e.hora_inicio_operativo,
    'fecha_ingreso_estimada', e.fecha_ingreso_estimada,
    'fecha_llegada_real', e.fecha_llegada_real,
    'periodo_llegada', e.periodo_llegada,
    'hito_confirmado', e.hito_confirmado,
    'origen', e.origen,
    'paquetes', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', p.id,
                  'codigo', p.codigo,
                  'fecha_ingreso_estimada', p.fecha_ingreso_estimada,
                  'periodo_ingreso', p.periodo_ingreso)
                order by p.id)
         from public.compra_paquetes p
         where p.embarque_id = e.id
           and p.estado = 'abierto'),
      '[]'::jsonb)
  )
  from public.compra_embarques e
  where e.id = p_embarque;
$$;

revoke execute on function public.agrupador_foto_embarque(uuid) from public, anon, authenticated;
grant execute on function public.agrupador_foto_embarque(uuid) to service_role;

comment on function public.agrupador_foto_embarque(uuid) is
  'M8 08b-1 + 08b-1b: instantanea de un embarque (estado, revision, viaje, los cinco hitos con hora del inicio operativo, ingreso al stock fijado, real, periodo, hito_confirmado, origen y el ingreso propio de cada paquete abierto) para compra_agrupador_eventos. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4.2 `agrupadores_desalineados()` (0032): I2 generalizada
-- ---------------------------------------------------------------------------
-- Asignaciones ACTIVAS cuya entrega no está en su mes de destino `coalesce(pq.periodo_ingreso, b.periodo_llegada)` (§2.4 bis): el del
-- ingreso propio de su paquete si lo tiene y, si no, el del embarque. MISMA firma que la 0032: la columna de salida `periodo_llegada`
-- pasa a contener el mes de destino (cambiar las columnas de salida exigiría `drop function`). El humo exige 0 filas antes y después.
create or replace function public.agrupadores_desalineados()
returns table (
  asignacion_id uuid,
  embarque_id uuid,
  entrega_id uuid,
  periodo date,
  periodo_llegada date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.embarque_id, a.entrega_id, e.periodo, coalesce(pq.periodo_ingreso, b.periodo_llegada)
  from public.compra_entrega_asignaciones a
  join public.compra_linea_entregas e on e.id = a.entrega_id
  join public.compra_lineas l on l.id = e.linea_id
  join public.compras c on c.id = l.compra_id
  join public.compra_embarques b on b.id = a.embarque_id
  left join public.compra_paquetes pq on pq.id = a.paquete_id
  where public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
    and e.periodo <> coalesce(pq.periodo_ingreso, b.periodo_llegada);
$$;

revoke execute on function public.agrupadores_desalineados() from public, anon, authenticated;
grant execute on function public.agrupadores_desalineados() to service_role;

comment on function public.agrupadores_desalineados() is
  'M8 08b-1 (R2) + 08b-1b (I2 generalizada): asignaciones activas con entrega.periodo distinto de su mes de destino coalesce(paquete.periodo_ingreso, embarque.periodo_llegada) (aviso desalineada). La columna periodo_llegada de salida contiene el mes de destino. El humo exige cero filas. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4.3 `agrupador_hito_violado(p_embarque)` (NUEVA, ayudante de I7)
-- ---------------------------------------------------------------------------
-- I7: si `hito_confirmado` no es nulo, ese hito tiene fecha y ningún hito en o antes de él tiene fecha futura, y el embarque no está
-- `planificado`. Devuelve NULL si se cumple, o `fecha_requerida`, `fecha_futura` o `estado_planificado`. «Futuro» se mide con la hora de
-- Lima (`America/Lima`, sin horario de verano): un `date` es futuro si es posterior a hoy; el Inicio operativo, con fecha y hora si hay
-- hora. Orden de los hitos: zarpe < arribo < ingreso_cd < inicio_operativo. La usa `aplicar_movimiento_agrupador` (con los valores ya
-- escritos, para rechazar con el motivo de usuario, y al final como red de seguridad AG002).
create or replace function public.agrupador_hito_violado(p_embarque uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when e.hito_confirmado is null then null
    when (case e.hito_confirmado
            when 'zarpe' then e.fecha_salida_estimada
            when 'arribo' then e.fecha_puerto_estimada
            when 'ingreso_cd' then e.fecha_llegada_estimada
            when 'inicio_operativo' then e.fecha_inicio_operativo_estimada
          end) is null then 'fecha_requerida'
    when (r.rango >= 1 and e.fecha_salida_estimada > (now() at time zone 'America/Lima')::date)
      or (r.rango >= 2 and e.fecha_puerto_estimada > (now() at time zone 'America/Lima')::date)
      or (r.rango >= 3 and e.fecha_llegada_estimada > (now() at time zone 'America/Lima')::date)
      or (r.rango >= 4 and e.fecha_inicio_operativo_estimada is not null
          and (e.fecha_inicio_operativo_estimada + coalesce(e.hora_inicio_operativo, time '00:00')) > (now() at time zone 'America/Lima'))
      then 'fecha_futura'
    when e.estado = 'planificado' then 'estado_planificado'
    else null
  end
  from public.compra_embarques e
  cross join lateral (
    select case e.hito_confirmado
             when 'zarpe' then 1
             when 'arribo' then 2
             when 'ingreso_cd' then 3
             when 'inicio_operativo' then 4
             else 0
           end as rango
  ) r
  where e.id = p_embarque;
$$;

revoke execute on function public.agrupador_hito_violado(uuid) from public, anon, authenticated;
grant execute on function public.agrupador_hito_violado(uuid) to service_role;

comment on function public.agrupador_hito_violado(uuid) is
  'M8 08b-1b (I7): NULL si el embarque cumple la integridad del hito confirmado; si no, fecha_requerida (el hito confirmado no tiene fecha), fecha_futura (algun hito en o antes de el tiene fecha futura en hora de Lima, el Inicio operativo con su hora) o estado_planificado. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4.4 `guardar_embarque` (0036)
-- ---------------------------------------------------------------------------
-- Al CREAR escribe los cinco hitos (Ingreso CD obligatorio: `fecha_requerida`; hora sin fecha: `hora_sin_fecha`; Arribo en un `local`:
-- `puerto_en_local`), el ingreso al stock y `origen`. Al EDITAR no escribe NINGUNA fecha ni hora (van por `aplicar_movimiento_agrupador`):
-- una clave de fecha u hora PRESENTE con un valor distinto del guardado (`null` incluido) da `fecha_por_movimiento`; una AUSENTE conserva
-- lo guardado (corrige el defecto de §0: antes un `PATCH` sin salida la borraba). `origen` sí se edita (clave ausente conserva).
-- Pasar `tipo` a `local` con Arribo con fecha o con `hito_confirmado = 'arribo'` da `puerto_en_local`. Candados de la 0036 intactos:
-- viajes (`v_viaje`, `v_viaje_ant`, por id) y después el embarque, ambos `for no key update`. El código de un embarque nuevo toma el mes
-- de su Ingreso CD (`v_llegada`), como hasta hoy.
create or replace function public.guardar_embarque(p_embarque jsonb, p_revision integer, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_id uuid := nullif(p_embarque ->> 'id', '')::uuid;
  v_nombre text := btrim(coalesce(p_embarque ->> 'nombre', ''));
  v_tipo text := coalesce(nullif(p_embarque ->> 'tipo', ''), 'importacion');
  v_viaje uuid := nullif(p_embarque ->> 'viaje_id', '')::uuid;
  v_viaje_ant uuid;
  v_resp uuid := nullif(p_embarque ->> 'responsable_id', '')::uuid;
  v_ref text := nullif(btrim(p_embarque ->> 'referencia_logistica'), '');
  v_puerto text := nullif(btrim(p_embarque ->> 'puerto_embarque'), '');
  v_salida date := nullif(p_embarque ->> 'fecha_salida_estimada', '')::date;
  v_arribo date := nullif(p_embarque ->> 'fecha_puerto_estimada', '')::date;
  v_llegada date := nullif(p_embarque ->> 'fecha_llegada_estimada', '')::date;
  v_ini date := nullif(p_embarque ->> 'fecha_inicio_operativo_estimada', '')::date;
  v_hora time := nullif(p_embarque ->> 'hora_inicio_operativo', '')::time;
  v_ingreso date := nullif(p_embarque ->> 'fecha_ingreso_estimada', '')::date;
  v_origen text := nullif(btrim(p_embarque ->> 'origen'), '');
  v_nota text := nullif(btrim(p_embarque ->> 'nota'), '');
  v_codigo text := upper(btrim(coalesce(p_embarque ->> 'codigo', '')));
  v_emb public.compra_embarques%rowtype;
  v_viaje_row public.compra_viajes%rowtype;
  v_avisos jsonb := '[]'::jsonb;
  v_antes jsonb;
begin
  if v_id is not null then
    select e.viaje_id into v_viaje_ant from public.compra_embarques e where e.id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
  end if;

  perform 1
     from public.compra_viajes v
    where v.id in (v_viaje, v_viaje_ant)
    order by v.id
      for no key update;

  if v_viaje is not null then
    select * into v_viaje_row from public.compra_viajes where id = v_viaje;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if v_viaje_row.estado = 'cancelado' and v_viaje is distinct from v_viaje_ant then
      return jsonb_build_object('ok', false, 'motivo', 'viaje_cancelado');
    end if;
    if v_viaje_row.estado = 'cerrado' then
      v_avisos := v_avisos || jsonb_build_array(jsonb_build_object('codigo', 'viaje_cerrado', 'viaje', v_viaje_row.codigo));
    end if;
  end if;
  if v_tipo = 'local' and v_viaje is not null then
    return jsonb_build_object('ok', false, 'motivo', 'local_con_viaje');
  end if;
  if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) and v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;

  if v_id is null then
    if v_llegada is null then
      return jsonb_build_object('ok', false, 'motivo', 'fecha_requerida');
    end if;
    if v_hora is not null and v_ini is null then
      return jsonb_build_object('ok', false, 'motivo', 'hora_sin_fecha');
    end if;
    if v_tipo = 'local' and v_arribo is not null then
      return jsonb_build_object('ok', false, 'motivo', 'puerto_en_local');
    end if;
    if v_salida is not null and v_salida > v_llegada then
      return jsonb_build_object('ok', false, 'motivo', 'salida_despues_de_llegada');
    end if;
    if v_codigo = '' then
      v_codigo := public.agrupador_siguiente_codigo('embarque', v_llegada);
      if v_codigo is null then
        return jsonb_build_object('ok', false, 'motivo', 'correlativo_agotado');
      end if;
    else
      if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
      end if;
      if exists (select 1 from public.compra_embarques x where upper(x.codigo) = v_codigo) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
      end if;
    end if;
    begin
      insert into public.compra_embarques (
        codigo, nombre, tipo, viaje_id, responsable_id, referencia_logistica, puerto_embarque,
        fecha_salida_estimada, fecha_puerto_estimada, fecha_llegada_estimada,
        fecha_inicio_operativo_estimada, hora_inicio_operativo, fecha_ingreso_estimada, origen, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, v_tipo, v_viaje, v_resp, v_ref, v_puerto,
        v_salida, v_arribo, v_llegada,
        v_ini, v_hora, v_ingreso, v_origen, v_nota,
        v_perfil, v_nombre_actor, v_perfil, v_nombre_actor
      )
      returning * into v_emb;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
    end;
    insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
    values (
      v_emb.id, v_emb.viaje_id, 'crear', null, public.agrupador_foto_embarque(v_emb.id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo),
      left(format('Embarque %s creado: %s', v_emb.codigo, v_emb.nombre), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'embarque_id', v_emb.id, 'codigo', v_emb.codigo, 'revision', v_emb.revision, 'creado', true, 'avisos', v_avisos);
  end if;

  select * into v_emb from public.compra_embarques where id = v_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if v_emb.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if p_revision is null or v_emb.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
  end if;
  if (p_embarque ? 'fecha_salida_estimada' and v_salida is distinct from v_emb.fecha_salida_estimada)
     or (p_embarque ? 'fecha_puerto_estimada' and v_arribo is distinct from v_emb.fecha_puerto_estimada)
     or (p_embarque ? 'fecha_llegada_estimada' and v_llegada is distinct from v_emb.fecha_llegada_estimada)
     or (p_embarque ? 'fecha_inicio_operativo_estimada' and v_ini is distinct from v_emb.fecha_inicio_operativo_estimada)
     or (p_embarque ? 'hora_inicio_operativo' and v_hora is distinct from v_emb.hora_inicio_operativo)
     or (p_embarque ? 'fecha_ingreso_estimada' and v_ingreso is distinct from v_emb.fecha_ingreso_estimada) then
    return jsonb_build_object('ok', false, 'motivo', 'fecha_por_movimiento');
  end if;
  if v_resp is distinct from v_emb.responsable_id and v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;
  if v_tipo = 'local' and (v_emb.fecha_puerto_estimada is not null or v_emb.hito_confirmado = 'arribo') then
    return jsonb_build_object('ok', false, 'motivo', 'puerto_en_local');
  end if;

  v_antes := public.agrupador_foto_embarque(v_id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo);
  update public.compra_embarques
     set nombre = v_nombre,
         tipo = v_tipo,
         viaje_id = v_viaje,
         responsable_id = v_resp,
         referencia_logistica = v_ref,
         puerto_embarque = v_puerto,
         origen = case when p_embarque ? 'origen' then v_origen else origen end,
         nota = v_nota,
         revision = revision + 1,
         updated_by_id = v_perfil,
         updated_by_nombre = v_nombre_actor
   where id = v_id
   returning * into v_emb;

  insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    v_emb.id, v_emb.viaje_id, 'editar', v_antes, public.agrupador_foto_embarque(v_emb.id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo),
    left(format('Embarque %s editado', v_emb.codigo), 300), v_perfil, v_nombre_actor
  );
  return jsonb_build_object('ok', true, 'embarque_id', v_emb.id, 'codigo', v_emb.codigo, 'revision', v_emb.revision, 'creado', false, 'avisos', v_avisos);
end;
$$;

revoke execute on function public.guardar_embarque(jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_embarque(jsonb, integer, jsonb) to service_role;

comment on function public.guardar_embarque(jsonb, integer, jsonb) is
  'M8 08b-1 + 08b-1b: crea o edita un embarque. Al crear escribe los cinco hitos (Ingreso CD obligatorio), el ingreso al stock y el origen. Al editar NO escribe ninguna fecha ni hora: clave de fecha u hora presente y distinta de lo guardado (null incluido) da fecha_por_movimiento, ausente conserva (un PATCH sin salida ya no la borra); origen si se edita. Bloquea viajes y luego el embarque. local sin viaje, salida <= Ingreso CD, hora sin fecha y Arribo en local bloquean; viaje cancelado bloquea y cerrado avisa. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, responsable_no_asignable, fecha_por_movimiento, salida_despues_de_llegada, local_con_viaje, viaje_cancelado, fecha_requerida, hora_sin_fecha, puerto_en_local. Solo service_role. Candados: viajes y embarque con for no key update (0036).';

-- ---------------------------------------------------------------------------
-- 4.5 `guardar_paquete` (0036)
-- ---------------------------------------------------------------------------
-- SOLO cambia el código de un paquete nuevo: toma el mes del INGRESO CD de su embarque (`fecha_llegada_estimada`), no `periodo_llegada`
-- (que desde esta migración es el mes del ingreso al stock). Así un embarque y sus paquetes comparten el prefijo `aamm` aunque el
-- ingreso al stock caiga en otro mes. Un código nunca cambia después de creado. Nada más: no escribe el ingreso propio del paquete (eso
-- es `aplicar_movimiento_agrupador`). Candado del embarque `for no key update` como en la 0036.

create or replace function public.guardar_paquete(p_paquete jsonb, p_revision_embarque integer, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_id uuid := nullif(p_paquete ->> 'id', '')::uuid;
  v_embarque_id uuid := nullif(p_paquete ->> 'embarque_id', '')::uuid;
  v_nombre text := btrim(coalesce(p_paquete ->> 'nombre', ''));
  v_resp uuid := nullif(p_paquete ->> 'responsable_id', '')::uuid;
  v_nota text := nullif(btrim(p_paquete ->> 'nota'), '');
  v_codigo text := upper(btrim(coalesce(p_paquete ->> 'codigo', '')));
  v_paq public.compra_paquetes%rowtype;
  v_emb public.compra_embarques%rowtype;
  v_antes jsonb;
begin
  if v_id is not null then
    select * into v_paq from public.compra_paquetes where id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    v_embarque_id := v_paq.embarque_id;
  end if;

  select * into v_emb from public.compra_embarques where id = v_embarque_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if p_revision_embarque is null or v_emb.revision <> p_revision_embarque then
    return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
  end if;
  if v_emb.estado not in ('planificado', 'en_transito') then
    return jsonb_build_object('ok', false, 'motivo', 'embarque_no_editable');
  end if;

  if v_id is null then
    if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
      return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
    end if;
    if v_codigo = '' then
      v_codigo := public.agrupador_siguiente_codigo('paquete', v_emb.fecha_llegada_estimada);
      if v_codigo is null then
        return jsonb_build_object('ok', false, 'motivo', 'correlativo_agotado');
      end if;
    else
      if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
      end if;
      if exists (select 1 from public.compra_paquetes x where upper(x.codigo) = v_codigo) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
      end if;
    end if;
    begin
      insert into public.compra_paquetes (
        embarque_id, codigo, nombre, responsable_id, nota, perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (v_embarque_id, v_codigo, v_nombre, v_resp, v_nota, v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
      returning * into v_paq;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
    end;
    v_antes := null;
  else
    if v_paq.estado <> 'abierto' then
      return jsonb_build_object('ok', false, 'motivo', 'no_editable');
    end if;
    if v_resp is distinct from v_paq.responsable_id and v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
      return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
    end if;
    v_antes := to_jsonb(v_paq);
    update public.compra_paquetes
       set nombre = v_nombre,
           responsable_id = v_resp,
           nota = v_nota,
           updated_by_id = v_perfil,
           updated_by_nombre = v_nombre_actor
     where id = v_id
     returning * into v_paq;
  end if;

  update public.compra_embarques
     set revision = revision + 1,
         updated_by_id = v_perfil,
         updated_by_nombre = v_nombre_actor
   where id = v_embarque_id
   returning * into v_emb;

  insert into public.compra_agrupador_eventos (paquete_id, embarque_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    v_paq.id, v_embarque_id, case when v_id is null then 'crear' else 'editar' end, v_antes, to_jsonb(v_paq),
    left(format('Paquete %s %s', v_paq.codigo, case when v_id is null then 'creado' else 'editado' end), 300), v_perfil, v_nombre_actor
  );
  return jsonb_build_object(
    'ok', true, 'paquete_id', v_paq.id, 'embarque_id', v_embarque_id, 'codigo', v_paq.codigo,
    'embarque_revision', v_emb.revision, 'creado', v_id is null
  );
end;
$$;

revoke execute on function public.guardar_paquete(jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_paquete(jsonb, integer, jsonb) to service_role;

comment on function public.guardar_paquete(jsonb, integer, jsonb) is
  'M8 08b-1 + 08b-1b: crea o edita un paquete de un embarque. Bloquea el embarque, compara su revision (cubre a sus paquetes) y la sube. El embarque debe estar planificado o en transito. Codigo con el mes del Ingreso CD (fecha_llegada_estimada) del embarque, no con periodo_llegada. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, embarque_no_editable, responsable_no_asignable. Solo service_role. Candado del embarque: for no key update (0036).';


-- ---------------------------------------------------------------------------
-- 4.6 `cambiar_estado_agrupador` (0036)
-- ---------------------------------------------------------------------------
-- Solo suma `volver_a_planificado` con `hito_confirmado` -> `hito_confirmado` (I7: un embarque con un hito que ya ocurrió no puede
-- volver a planificado; primero se baja la confirmación con `cambiar_fecha`). Candados de la 0036 intactos.

create or replace function public.cambiar_estado_agrupador(
  p_tipo text,
  p_id uuid,
  p_accion text,
  p_revision integer,
  p_motivo text,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_viaje public.compra_viajes%rowtype;
  v_emb public.compra_embarques%rowtype;
  v_paq public.compra_paquetes%rowtype;
  v_hacia text;
  v_activas integer;
  v_antes jsonb;
  v_revision integer;
begin
  if p_tipo = 'viaje' then
    select * into v_viaje from public.compra_viajes where id = p_id for no key update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if p_revision is null or v_viaje.revision <> p_revision then
      return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
    end if;
    if v_viaje.estado = 'cancelado' then
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    if p_accion = 'cerrar' and v_viaje.estado = 'abierto' then
      v_hacia := 'cerrado';
    elsif p_accion = 'reabrir' and v_viaje.estado = 'cerrado' then
      v_hacia := 'abierto';
    elsif p_accion = 'cancelar' then
      if v_motivo is null or char_length(v_motivo) > 200 then
        return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
      end if;
      if exists (select 1 from public.compras c where c.viaje_id = p_id and c.estado <> 'cancelada')
         or exists (select 1 from public.compra_embarques e where e.viaje_id = p_id and e.estado <> 'cancelado') then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_compras');
      end if;
      v_hacia := 'cancelado';
    else
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    v_antes := jsonb_build_object('estado', v_viaje.estado, 'revision', v_viaje.revision);
    update public.compra_viajes
       set estado = v_hacia, revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_id
     returning revision into v_revision;
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      p_id, 'cambiar_estado', v_antes, jsonb_build_object('estado', v_hacia, 'revision', v_revision), left(v_motivo, 300),
      left(format('Viaje %s: %s a %s', v_viaje.codigo, v_viaje.estado, v_hacia), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'tipo', 'viaje', 'id', p_id, 'estado', v_hacia, 'revision', v_revision);

  elsif p_tipo = 'embarque' then
    select * into v_emb from public.compra_embarques where id = p_id for no key update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if p_revision is null or v_emb.revision <> p_revision then
      return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
    end if;
    if v_emb.estado = 'cancelado' then
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    if p_accion = 'en_transito' and v_emb.estado = 'planificado' then
      v_hacia := 'en_transito';
    elsif p_accion = 'volver_a_planificado' and v_emb.estado = 'en_transito' then
      if v_emb.hito_confirmado is not null then
        return jsonb_build_object('ok', false, 'motivo', 'hito_confirmado');
      end if;
      v_hacia := 'planificado';
    elsif p_accion = 'cancelar' then
      if v_motivo is null or char_length(v_motivo) > 200 then
        return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
      end if;
      if exists (
        select 1
        from public.compra_linea_recepciones r
        join public.compra_entrega_asignaciones a on a.id = r.asignacion_id
        where a.embarque_id = p_id
      ) then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_recepciones');
      end if;
      select count(*) into v_activas
        from public.compra_entrega_asignaciones a
        join public.compra_linea_entregas e on e.id = a.entrega_id
        join public.compra_lineas l on l.id = e.linea_id
        join public.compras c on c.id = l.compra_id
       where a.embarque_id = p_id
         and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas);
      if v_activas > 0 then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_asignaciones_activas');
      end if;
      v_hacia := 'cancelado';
    else
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    v_antes := public.agrupador_foto_embarque(p_id);
    update public.compra_embarques
       set estado = v_hacia, revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_id
     returning revision into v_revision;
    insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      p_id, v_emb.viaje_id, 'cambiar_estado', v_antes, public.agrupador_foto_embarque(p_id), left(v_motivo, 300),
      left(format('Embarque %s: %s a %s', v_emb.codigo, v_emb.estado, v_hacia), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'tipo', 'embarque', 'id', p_id, 'estado', v_hacia, 'revision', v_revision);

  elsif p_tipo = 'paquete' then
    select * into v_paq from public.compra_paquetes where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    select * into v_emb from public.compra_embarques where id = v_paq.embarque_id for no key update;
    if p_revision is null or v_emb.revision <> p_revision then
      return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
    end if;
    if p_accion <> 'cancelar' or v_paq.estado <> 'abierto' then
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    if v_motivo is null or char_length(v_motivo) > 200 then
      return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
    end if;
    select count(*) into v_activas
      from public.compra_entrega_asignaciones a
      join public.compra_linea_entregas e on e.id = a.entrega_id
      join public.compra_lineas l on l.id = e.linea_id
      join public.compras c on c.id = l.compra_id
     where a.paquete_id = p_id
       and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas);
    if v_activas > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'tiene_asignaciones_activas');
    end if;
    update public.compra_paquetes
       set estado = 'cancelado', updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_id;
    update public.compra_embarques
       set revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = v_paq.embarque_id
     returning revision into v_revision;
    insert into public.compra_agrupador_eventos (paquete_id, embarque_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      p_id, v_paq.embarque_id, 'cambiar_estado', jsonb_build_object('estado', 'abierto'), jsonb_build_object('estado', 'cancelado'),
      left(v_motivo, 300), left(format('Paquete %s: abierto a cancelado', v_paq.codigo), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'tipo', 'paquete', 'id', p_id, 'estado', 'cancelado', 'revision', v_revision, 'embarque_id', v_paq.embarque_id);
  end if;

  return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
end;
$$;

revoke execute on function public.cambiar_estado_agrupador(text, uuid, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.cambiar_estado_agrupador(text, uuid, text, integer, text, jsonb) to service_role;

comment on function public.cambiar_estado_agrupador(text, uuid, text, integer, text, jsonb) is
  'M8 08b-1 (R13) + 08b-1b: cambia el estado de un viaje (cerrar, reabrir, cancelar), un embarque (en_transito, volver_a_planificado, cancelar) o un paquete (cancelar). Cancelar exige motivo y que no quede nada activo (viaje: compras o embarques sin cancelar; embarque: recepciones vinculadas o asignaciones activas; paquete: asignaciones activas). volver_a_planificado con hito_confirmado da hito_confirmado. Para un paquete, p_revision es la del embarque. Motivos: agrupador_cambio, no_encontrado, transicion_invalida, tiene_asignaciones_activas, tiene_compras, tiene_recepciones, motivo_requerido, hito_confirmado. Solo service_role. Candados de viaje y embarque: for no key update (0036); su evento pide key share del viaje.';

-- ---------------------------------------------------------------------------
-- 4.7 `aplicar_movimiento_agrupador` (0036)
-- ---------------------------------------------------------------------------
-- Diff explícito sobre la 0036 (ficha §2.9; los candados no cambian: embarques `for no key update` por id, después compras `for update`
-- por id; NO bloquea viajes):
--   (a) `cambiar_fecha` acepta planes SIN `fecha_llegada_estimada`: la clave `embarques[0]` lleva solo lo que cambia (`fecha_salida_estimada`,
--       `fecha_puerto_estimada`, `fecha_llegada_estimada` = Ingreso CD, `fecha_inicio_operativo_estimada`, `hora_inicio_operativo`,
--       `fecha_ingreso_estimada` = ingreso al stock, `hito_confirmado`; clave presente = valor nuevo, `null` = vaciar, ausente = conserva) y
--       `paquetes` = [{ id, embarque_id, fecha_ingreso_estimada, ajustado? }] (ingreso propio; null = hereda; `ajustado` = subido al piso).
--       Admite UN solo embarque (`AG002` si no). Vaciar la fecha del Inicio operativo vacía también la hora; hora sin fecha: `hora_sin_fecha`.
--   (b) En `cambiar_fecha` motivo y causa se exigen SOLO si REPROGRAMA (`motivo_requerido`, `causa_requerida`): cambiar o vaciar un Zarpe,
--       Arribo o Inicio operativo (fecha u hora) que tenía valor; cambiar el Ingreso CD; cambiar la fecha efectiva del ingreso al stock
--       (`coalesce(ingreso, Ingreso CD)`) por fijarla o igualarla; cambiar el ingreso de un paquete; bajar `hito_confirmado`. NO reprograma:
--       completar una fecha u hora vacía, confirmar un hito, que el ingreso sin fijar siga al Ingreso CD, ni que un paquete suba a su piso
--       como consecuencia (`ajustado`; si el Ingreso CD no cambió, esa subida ES la acción del usuario y sí reprograma). Plan «viejo» (sin clave
--       `causa`, sin `paquetes` y con solo `fecha_llegada_estimada`): pide motivo y no causa, como hoy. `mover_paquete` y `pasar_pendientes`
--       siguen pidiendo motivo siempre; `mover_a_paquete` pide motivo y causa solo si algún movimiento cambia de mes. `causa` fuera del
--       catálogo: `AG002`. El evento de embarque guarda la `causa`.
--   (c) Por cada paquete de `paquetes` (en `cambiar_fecha`), DESPUÉS de bloquear su embarque, se comprueba que sigue en ese embarque y está
--       abierto: si no, `agrupador_cambio` (un `mover_paquete` pudo cambiarlo entre la lectura y el candado).
--   (d) `mover_a_paquete` ya mueve por unidades (los movimientos llevan `unidades` y `asignacion_id`) y puede cambiar de mes.
--   (e) `mover_paquete` conserva el ingreso propio del paquete; si `paquetes` trae su entrada, la escribe (el plan lo ajusta al piso del
--       destino).
--   (f) Recepciones vinculadas POR ASIGNACIÓN: en `cambiar_fecha`, una asignación activa con recepciones cuyo mes de destino cambiaría da
--       `embarque_con_recepciones` (cambio de fechas del embarque) o `asignacion_con_recepciones` (si es de un paquete cuyo ingreso cambia).
--   (g) I2 generalizada: TODAS las asignaciones activas de TODOS los embarques del plan quedan en `coalesce(pq.periodo_ingreso,
--       b.periodo_llegada)`, en toda operación (`AG002`).
--   (h) Al final, I7 (`agrupador_hito_violado`) e I9 (ningún paquete abierto con ingreso propio anterior a `coalesce(fecha_llegada_real,
--       fecha_llegada_estimada)` de su embarque) sobre los embarques del plan (`AG002`). En `cambiar_fecha`, I7 con los valores escritos
--       rechaza antes con `fecha_requerida` o `fecha_futura`; confirmar un hito con el embarque `planificado` lo pasa a `en_transito`.
--   (i) Un plan viejo (`cambiar_fecha` con solo `fecha_llegada_estimada`) se comporta como hoy. `sin_cambios` si el plan no cambia nada.
--   Estados en `cambiar_fecha`: Ingreso CD, ingreso al stock y paquetes solo cambian en `planificado` o `en_transito`; los otros hitos y
--   `hito_confirmado` también en `recibido`; en `cancelado`, nada (`embarque_no_editable`). Los demás operaciones, como en la 0036.
-- Todo rechazo (AG001) deshace lo escrito en la llamada y devuelve `{ ok: false, motivo }`; una violación de invariante que delata un plan
-- mal armado se lanza con AG002 y NO se atrapa. «Hoy» es la fecha de Lima (`America/Lima`).
create or replace function public.aplicar_movimiento_agrupador(p_plan jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_op text := p_plan ->> 'operacion';
  v_motivo text := nullif(btrim(p_plan ->> 'motivo'), '');
  v_causa text := nullif(btrim(p_plan ->> 'causa'), '');
  v_resumen text := left(coalesce(nullif(btrim(p_plan ->> 'resumen'), ''), p_plan ->> 'operacion'), 300);
  v_movs jsonb := coalesce(p_plan -> 'movimientos', '[]'::jsonb);
  v_paqs jsonb := case when jsonb_typeof(p_plan -> 'paquetes') = 'array' then p_plan -> 'paquetes' else '[]'::jsonb end;
  v_pm jsonb := p_plan -> 'paquete_a_mover';
  v_pm_id uuid;
  v_pm_dest uuid;
  v_pm_orig uuid;
  v_pm_estado text;
  v_pm_ing date;
  v_pm_ajusta boolean := false;
  v_emb_ids uuid[];
  v_compra_ids uuid[];
  v_lineas uuid[];
  v_n integer;
  v_cf_id uuid;
  v_e public.compra_embarques%rowtype;
  v_ex jsonb;
  v_salida date;
  v_arribo date;
  v_llegada date;
  v_ini date;
  v_hora time;
  v_ingreso date;
  v_hito text;
  v_hay_cambio boolean;
  v_reprograma boolean;
  v_cambia_cd boolean;
  v_cambia_paq boolean;
  v_paq_pura boolean;
  v_paq_ajustada boolean;
  v_legado boolean;
  v_mueve_mes boolean;
  v_viol text;
  v_antes_f jsonb := '{}'::jsonb;
  v_antes_x jsonb := '{}'::jsonb;
  v_desp_x jsonb;
  v_antes_e jsonb := '{}'::jsonb;
  v_id uuid;
  v_res jsonb;
  v_rev integer;
  v_accion_compra text;
  v_res_c jsonb := '[]'::jsonb;
  v_res_e jsonb := '[]'::jsonb;
begin
  begin
    if v_op is null or v_op not in ('asignar', 'quitar', 'mover_a_paquete', 'cambiar_fecha', 'pasar_pendientes', 'mover_paquete') then
      raise exception 'plan invalido: operacion desconocida' using errcode = 'AG002';
    end if;
    if v_causa is not null
       and v_causa not in ('pago', 'produccion', 'naviera', 'aduana', 'transporte', 'cola_conteo', 'programacion', 'correccion', 'otro') then
      raise exception 'plan invalido: causa fuera del catalogo' using errcode = 'AG002';
    end if;
    if jsonb_array_length(v_paqs) > 0 and v_op not in ('cambiar_fecha', 'mover_paquete') then
      raise exception 'plan invalido: paquetes solo vale en cambiar_fecha y mover_paquete' using errcode = 'AG002';
    end if;
    v_accion_compra := case when v_op in ('asignar', 'quitar', 'mover_a_paquete') then 'asignar_agrupador' else 'mover_entregas' end;

    select coalesce(array_agg((e ->> 'id')::uuid order by (e ->> 'id')::uuid), '{}'::uuid[]) into v_emb_ids
      from jsonb_array_elements(coalesce(p_plan -> 'embarques', '[]'::jsonb)) e;
    if cardinality(v_emb_ids) = 0 then
      raise exception 'plan invalido: sin embarques' using errcode = 'AG002';
    end if;
    select coalesce(array_agg((c ->> 'id')::uuid order by (c ->> 'id')::uuid), '{}'::uuid[]) into v_compra_ids
      from jsonb_array_elements(coalesce(p_plan -> 'compras', '[]'::jsonb)) c;
    select coalesce(array_agg(distinct (m ->> 'linea_id')::uuid), '{}'::uuid[]) into v_lineas
      from jsonb_array_elements(v_movs) m;

    perform 1 from public.compra_embarques e where e.id = any (v_emb_ids) order by e.id for no key update;
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_emb_ids) then
      raise exception 'no_encontrado' using errcode = 'AG001';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_plan -> 'embarques') as x(id uuid, revision integer)
      join public.compra_embarques e on e.id = x.id
      where e.revision is distinct from x.revision
    ) then
      raise exception 'agrupador_cambio' using errcode = 'AG001';
    end if;

    if v_op in ('asignar', 'mover_a_paquete', 'mover_paquete')
       and exists (select 1 from public.compra_embarques e where e.id = any (v_emb_ids) and e.estado not in ('planificado', 'en_transito')) then
      raise exception 'embarque_no_editable' using errcode = 'AG001';
    end if;
    if v_op = 'pasar_pendientes' then
      if exists (select 1 from public.compra_embarques e where e.id = any (v_emb_ids) and e.estado = 'cancelado') then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v_movs) m
        join public.compra_embarques e on e.id = nullif(m -> 'destino' ->> 'embarque_id', '')::uuid
        where e.estado not in ('planificado', 'en_transito')
      ) then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;
    end if;
    if v_op in ('mover_paquete', 'pasar_pendientes') and v_motivo is null then
      raise exception 'motivo_requerido' using errcode = 'AG001';
    end if;

    if v_op = 'cambiar_fecha' then
      if cardinality(v_emb_ids) <> 1 then
        raise exception 'plan invalido: cambiar_fecha admite un solo embarque' using errcode = 'AG002';
      end if;
      v_cf_id := v_emb_ids[1];
      select * into v_e from public.compra_embarques where id = v_cf_id;
      v_ex := (p_plan -> 'embarques') -> 0;

      if exists (
        select 1
        from jsonb_to_recordset(v_paqs) as x(id uuid, embarque_id uuid)
        left join public.compra_paquetes p on p.id = x.id
        where p.id is null or p.embarque_id is distinct from x.embarque_id or p.estado <> 'abierto'
      ) then
        raise exception 'agrupador_cambio' using errcode = 'AG001';
      end if;
      if exists (select 1 from jsonb_to_recordset(v_paqs) as x(embarque_id uuid) where x.embarque_id <> v_cf_id) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;

      v_salida := case when v_ex ? 'fecha_salida_estimada' then nullif(v_ex ->> 'fecha_salida_estimada', '')::date else v_e.fecha_salida_estimada end;
      v_arribo := case when v_ex ? 'fecha_puerto_estimada' then nullif(v_ex ->> 'fecha_puerto_estimada', '')::date else v_e.fecha_puerto_estimada end;
      if v_ex ? 'fecha_llegada_estimada' then
        v_llegada := nullif(v_ex ->> 'fecha_llegada_estimada', '')::date;
        if v_llegada is null then
          raise exception 'fecha_requerida' using errcode = 'AG001';
        end if;
      else
        v_llegada := v_e.fecha_llegada_estimada;
      end if;
      v_ini := case when v_ex ? 'fecha_inicio_operativo_estimada' then nullif(v_ex ->> 'fecha_inicio_operativo_estimada', '')::date else v_e.fecha_inicio_operativo_estimada end;
      v_hora := case when v_ex ? 'hora_inicio_operativo' then nullif(v_ex ->> 'hora_inicio_operativo', '')::time else v_e.hora_inicio_operativo end;
      if v_ini is null then
        if v_ex ? 'hora_inicio_operativo' and v_hora is not null then
          raise exception 'hora_sin_fecha' using errcode = 'AG001';
        end if;
        v_hora := null;
      end if;
      v_ingreso := case when v_ex ? 'fecha_ingreso_estimada' then nullif(v_ex ->> 'fecha_ingreso_estimada', '')::date else v_e.fecha_ingreso_estimada end;
      v_hito := case when v_ex ? 'hito_confirmado' then nullif(btrim(v_ex ->> 'hito_confirmado'), '') else v_e.hito_confirmado end;
      if v_hito is not null and v_hito not in ('zarpe', 'arribo', 'ingreso_cd', 'inicio_operativo') then
        raise exception 'plan invalido: hito_confirmado fuera del catalogo' using errcode = 'AG002';
      end if;

      select coalesce(bool_or(p.fecha_ingreso_estimada is distinct from x.fecha_ingreso_estimada), false),
             coalesce(bool_or(p.fecha_ingreso_estimada is distinct from x.fecha_ingreso_estimada and not coalesce(x.ajustado, false)), false),
             coalesce(bool_or(p.fecha_ingreso_estimada is distinct from x.fecha_ingreso_estimada and coalesce(x.ajustado, false)), false)
        into v_cambia_paq, v_paq_pura, v_paq_ajustada
        from jsonb_to_recordset(v_paqs) as x(id uuid, fecha_ingreso_estimada date, ajustado boolean)
        join public.compra_paquetes p on p.id = x.id;

      v_cambia_cd := v_llegada is distinct from v_e.fecha_llegada_estimada;
      v_hay_cambio := v_cambia_paq
        or v_salida is distinct from v_e.fecha_salida_estimada
        or v_arribo is distinct from v_e.fecha_puerto_estimada
        or v_cambia_cd
        or v_ini is distinct from v_e.fecha_inicio_operativo_estimada
        or v_hora is distinct from v_e.hora_inicio_operativo
        or v_ingreso is distinct from v_e.fecha_ingreso_estimada
        or v_hito is distinct from v_e.hito_confirmado;
      if not v_hay_cambio then
        raise exception 'sin_cambios' using errcode = 'AG001';
      end if;

      v_reprograma := (v_e.fecha_salida_estimada is not null and v_salida is distinct from v_e.fecha_salida_estimada)
        or (v_e.fecha_puerto_estimada is not null and v_arribo is distinct from v_e.fecha_puerto_estimada)
        or (v_e.fecha_inicio_operativo_estimada is not null and v_ini is distinct from v_e.fecha_inicio_operativo_estimada)
        or (v_e.hora_inicio_operativo is not null and v_hora is distinct from v_e.hora_inicio_operativo)
        or v_cambia_cd
        or (v_ingreso is distinct from v_e.fecha_ingreso_estimada
            and coalesce(v_ingreso, v_llegada) is distinct from coalesce(v_e.fecha_ingreso_estimada, v_e.fecha_llegada_estimada))
        or (case coalesce(v_hito, '') when 'zarpe' then 1 when 'arribo' then 2 when 'ingreso_cd' then 3 when 'inicio_operativo' then 4 else 0 end)
           < (case coalesce(v_e.hito_confirmado, '') when 'zarpe' then 1 when 'arribo' then 2 when 'ingreso_cd' then 3 when 'inicio_operativo' then 4 else 0 end)
        or v_paq_pura
        or (v_paq_ajustada and not v_cambia_cd);
      v_legado := not (p_plan ? 'causa')
        and jsonb_array_length(v_paqs) = 0
        and not exists (
          select 1 from jsonb_object_keys(v_ex) k where k not in ('id', 'revision', 'fecha_llegada_estimada')
        );
      if v_reprograma then
        if v_motivo is null then
          raise exception 'motivo_requerido' using errcode = 'AG001';
        end if;
        if v_causa is null and not v_legado then
          raise exception 'causa_requerida' using errcode = 'AG001';
        end if;
      end if;

      if v_e.estado = 'cancelado'
         or ((v_cambia_cd or v_ingreso is distinct from v_e.fecha_ingreso_estimada or v_cambia_paq)
             and v_e.estado not in ('planificado', 'en_transito')) then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;

      if v_salida is not null and v_salida > v_llegada then
        raise exception 'salida_despues_de_llegada' using errcode = 'AG001';
      end if;
      if v_e.tipo = 'local' and (v_arribo is not null or v_hito = 'arribo') then
        raise exception 'puerto_en_local' using errcode = 'AG001';
      end if;
    end if;

    if cardinality(v_compra_ids) > 0 then
      perform 1 from public.compras c where c.id = any (v_compra_ids) order by c.id for update;
      get diagnostics v_n = row_count;
      if v_n <> cardinality(v_compra_ids) then
        raise exception 'compra_cambio' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(p_plan -> 'compras') as x(id uuid, revision integer)
        join public.compras c on c.id = x.id
        where c.revision is distinct from x.revision
      ) then
        raise exception 'compra_cambio' using errcode = 'AG001';
      end if;
    end if;

    if jsonb_array_length(v_movs) > 0 then
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(entrega_id uuid, linea_id uuid, compra_id uuid)
        where m.compra_id <> all (v_compra_ids)
           or not exists (
             select 1
             from public.compra_linea_entregas e
             join public.compra_lineas l on l.id = e.linea_id
             where e.id = m.entrega_id and l.id = m.linea_id and l.compra_id = m.compra_id
           )
      ) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v_movs) m
        where nullif(m -> 'destino' ->> 'embarque_id', '') is not null
          and (m -> 'destino' ->> 'embarque_id')::uuid <> all (v_emb_ids)
      ) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(asignacion_id uuid)
        join public.compra_entrega_asignaciones a on a.id = m.asignacion_id
        where a.embarque_id <> all (v_emb_ids)
      ) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(compra_id uuid)
        join public.compras c on c.id = m.compra_id
        where c.estado = 'recibida' and c.cancelada_at is not null
      ) then
        raise exception 'saldo_cerrado' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(linea_id uuid, compra_id uuid)
        join public.compras c on c.id = m.compra_id
        join public.compra_lineas l on l.id = m.linea_id
        where not public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
      ) then
        raise exception 'compra_no_asignable' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from public.compra_entrega_asignaciones a
        join public.compra_linea_entregas e on e.id = a.entrega_id
        join public.compra_lineas l on l.id = e.linea_id
        join public.compras c on c.id = l.compra_id
        where a.embarque_id = any (v_emb_ids)
          and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
          and c.id <> all (v_compra_ids)
      ) then
        raise exception 'compra_cambio' using errcode = 'AG001';
      end if;
    end if;

    if v_op = 'mover_a_paquete' then
      select exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(entrega_id uuid, destino jsonb)
        join public.compra_linea_entregas e on e.id = m.entrega_id
        where (left(m.destino ->> 'periodo', 7) || '-01')::date <> e.periodo
      ) into v_mueve_mes;
      if v_mueve_mes then
        if v_motivo is null then
          raise exception 'motivo_requerido' using errcode = 'AG001';
        end if;
        if v_causa is null then
          raise exception 'causa_requerida' using errcode = 'AG001';
        end if;
      end if;
    end if;

    if jsonb_typeof(v_pm) = 'object' then
      v_pm_id := (v_pm ->> 'paquete_id')::uuid;
      v_pm_dest := (v_pm ->> 'embarque_destino_id')::uuid;
      select p.embarque_id, p.estado into v_pm_orig, v_pm_estado from public.compra_paquetes p where p.id = v_pm_id;
      if not found then
        raise exception 'no_encontrado' using errcode = 'AG001';
      end if;
      if v_pm_estado <> 'abierto' then
        raise exception 'no_editable' using errcode = 'AG001';
      end if;
      if v_pm_orig <> all (v_emb_ids) or v_pm_dest <> all (v_emb_ids) or v_pm_orig = v_pm_dest then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from public.compra_linea_recepciones r
        join public.compra_entrega_asignaciones a on a.id = r.asignacion_id
        where a.paquete_id = v_pm_id
      ) then
        raise exception 'asignacion_con_recepciones' using errcode = 'AG001';
      end if;
      if exists (select 1 from jsonb_to_recordset(v_paqs) as x(id uuid) where x.id <> v_pm_id) then
        raise exception 'plan invalido: paquetes de mover_paquete solo puede traer el paquete movido' using errcode = 'AG002';
      end if;
      select x.fecha_ingreso_estimada into v_pm_ing
        from jsonb_to_recordset(v_paqs) as x(id uuid, fecha_ingreso_estimada date)
       where x.id = v_pm_id;
      v_pm_ajusta := found;
    elsif v_op = 'mover_paquete' and jsonb_array_length(v_paqs) > 0 then
      raise exception 'plan invalido: paquetes sin paquete_a_mover' using errcode = 'AG002';
    end if;

    foreach v_id in array v_compra_ids loop
      v_antes_f := v_antes_f || jsonb_build_object(v_id::text, public.compra_foto(v_id));
      v_antes_x := v_antes_x || jsonb_build_object(v_id::text, public.compra_foto_entregas(v_id));
    end loop;
    foreach v_id in array v_emb_ids loop
      v_antes_e := v_antes_e || jsonb_build_object(v_id::text, public.agrupador_foto_embarque(v_id));
    end loop;

    if v_op = 'cambiar_fecha' then
      update public.compra_embarques
         set fecha_salida_estimada = v_salida,
             fecha_puerto_estimada = v_arribo,
             fecha_llegada_estimada = v_llegada,
             fecha_inicio_operativo_estimada = v_ini,
             hora_inicio_operativo = v_hora,
             fecha_ingreso_estimada = v_ingreso,
             hito_confirmado = v_hito,
             estado = case when v_hito is not null and estado = 'planificado' then 'en_transito' else estado end,
             updated_by_id = v_perfil,
             updated_by_nombre = v_nombre_actor
       where id = v_cf_id;
      update public.compra_paquetes p
         set fecha_ingreso_estimada = x.fecha_ingreso_estimada, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
        from jsonb_to_recordset(v_paqs) as x(id uuid, fecha_ingreso_estimada date)
       where p.id = x.id
         and p.fecha_ingreso_estimada is distinct from x.fecha_ingreso_estimada;

      v_viol := public.agrupador_hito_violado(v_cf_id);
      if v_viol in ('fecha_requerida', 'fecha_futura') then
        raise exception using errcode = 'AG001', message = v_viol;
      end if;

      select case
               when a.paquete_id is not null and exists (
                      select 1 from jsonb_to_recordset(v_paqs) as x(id uuid) where x.id = a.paquete_id
                    ) then 'asignacion_con_recepciones'
               else 'embarque_con_recepciones'
             end
        into v_viol
        from public.compra_entrega_asignaciones a
        join public.compra_linea_entregas e on e.id = a.entrega_id
        join public.compra_lineas l on l.id = e.linea_id
        join public.compras c on c.id = l.compra_id
        join public.compra_embarques b on b.id = a.embarque_id
        left join public.compra_paquetes pq on pq.id = a.paquete_id
       where a.embarque_id = v_cf_id
         and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
         and e.periodo <> coalesce(pq.periodo_ingreso, b.periodo_llegada)
         and exists (select 1 from public.compra_linea_recepciones r where r.asignacion_id = a.id)
       order by a.id
       limit 1;
      if v_viol is not null then
        raise exception using errcode = 'AG001', message = v_viol;
      end if;
    end if;
    if jsonb_typeof(v_pm) = 'object' then
      update public.compra_paquetes
         set embarque_id = v_pm_dest,
             fecha_ingreso_estimada = case when v_pm_ajusta then v_pm_ing else fecha_ingreso_estimada end,
             updated_by_id = v_perfil,
             updated_by_nombre = v_nombre_actor
       where id = v_pm_id;
    end if;

    v_res := public.agrupador_mover_entregas(v_movs, coalesce(p_plan -> 'repartos', '[]'::jsonb), p_actor);

    if exists (
      select 1
      from jsonb_to_recordset(coalesce(p_plan -> 'entregas', '[]'::jsonb)) as x(linea_id uuid, periodo text, unidades integer)
      where coalesce(
              (select e.unidades from public.compra_linea_entregas e
                where e.linea_id = x.linea_id and e.periodo = (left(x.periodo, 7) || '-01')::date),
              0
            ) <> x.unidades
    ) then
      raise exception 'plan inconsistente: las entregas que dejo la base no coinciden con el plan' using errcode = 'AG002';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(coalesce(p_plan -> 'entregas', '[]'::jsonb)) as x(linea_id uuid, periodo text, unidades integer)
      join public.compra_lineas l on l.id = x.linea_id
      join public.compra_linea_entregas e on e.linea_id = x.linea_id and e.periodo = (left(x.periodo, 7) || '-01')::date
      where l.tipo <> 'especifica'
        and e.unidades > 0
        and coalesce((select sum(r.unidades) from public.compra_linea_repartos r where r.entrega_id = e.id), 0) <> e.unidades
    ) then
      raise exception 'reparto_sin_vector' using errcode = 'AG001';
    end if;

    if exists (
      select 1
      from public.compra_lineas l
      where l.id = any (v_lineas)
        and coalesce((select sum(e.unidades) from public.compra_linea_entregas e where e.linea_id = l.id), 0) <> l.unidades
    ) then
      raise exception 'invariante I3: la suma de las entregas ya no es la de la linea' using errcode = 'AG002';
    end if;
    if exists (
      select 1
      from public.compra_lineas l
      where l.id = any (v_lineas)
        and (select count(*) from public.compra_linea_entregas e where e.linea_id = l.id) > 24
    ) then
      raise exception 'max_entregas' using errcode = 'AG001';
    end if;
    if exists (
      select 1
      from public.compra_lineas l
      where l.id = any (v_lineas)
        and not exists (select 1 from public.compra_linea_entregas e where e.linea_id = l.id)
    ) then
      raise exception 'invariante I3: una linea se quedo sin entregas' using errcode = 'AG002';
    end if;
    if exists (
      select 1
      from public.compra_linea_entregas e
      where e.linea_id = any (v_lineas)
        and coalesce((select sum(a.unidades) from public.compra_entrega_asignaciones a where a.entrega_id = e.id), 0) > e.unidades
    ) then
      raise exception 'excede_entrega' using errcode = 'AG001';
    end if;
    if exists (
      select 1
      from public.compra_entrega_asignaciones a
      join public.compra_linea_entregas e on e.id = a.entrega_id
      join public.compra_lineas l on l.id = e.linea_id
      join public.compras c on c.id = l.compra_id
      join public.compra_embarques b on b.id = a.embarque_id
      left join public.compra_paquetes pq on pq.id = a.paquete_id
      where a.embarque_id = any (v_emb_ids)
        and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
        and e.periodo <> coalesce(pq.periodo_ingreso, b.periodo_llegada)
    ) then
      raise exception 'invariante I2: una asignacion activa de los embarques del plan no queda en su mes de destino' using errcode = 'AG002';
    end if;
    if exists (
      select 1
      from public.compra_paquetes pq
      join public.compra_embarques b on b.id = pq.embarque_id
      where pq.embarque_id = any (v_emb_ids)
        and pq.estado = 'abierto'
        and pq.fecha_ingreso_estimada < coalesce(b.fecha_llegada_real, b.fecha_llegada_estimada)
    ) then
      raise exception 'invariante I9: el ingreso de un paquete queda antes de la llegada de su embarque' using errcode = 'AG002';
    end if;
    if exists (select 1 from unnest(v_emb_ids) u(id) where public.agrupador_hito_violado(u.id) is not null) then
      raise exception 'invariante I7: un hito confirmado sin fecha, con fecha futura o con el embarque planificado' using errcode = 'AG002';
    end if;

    foreach v_id in array v_compra_ids loop
      v_desp_x := public.compra_foto_entregas(v_id);
      if v_desp_x is not distinct from (v_antes_x -> (v_id::text)) then
        continue;
      end if;
      perform public.compra_recalcular_estado(v_id);
      update public.compras
         set revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
       where id = v_id
       returning revision into v_rev;
      v_res_c := v_res_c || jsonb_build_array(jsonb_build_object('id', v_id, 'revision', v_rev));
      insert into public.compra_eventos (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_id, null, v_accion_compra, (v_antes_f -> (v_id::text)) || (v_antes_x -> (v_id::text)),
        public.compra_foto(v_id) || v_desp_x,
        left(v_motivo, 300), v_resumen, v_perfil, v_nombre_actor
      );
    end loop;

    foreach v_id in array v_emb_ids loop
      update public.compra_embarques
         set revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
       where id = v_id
       returning revision into v_rev;
      v_res_e := v_res_e || jsonb_build_array(jsonb_build_object('id', v_id, 'revision', v_rev));
    end loop;

    foreach v_id in array v_emb_ids loop
      insert into public.compra_agrupador_eventos (embarque_id, viaje_id, paquete_id, accion, antes, despues, motivo, causa, resumen, compras, perfil_id, usuario_nombre)
      select
        v_id, e.viaje_id, v_pm_id,
        coalesce(nullif(p_plan ->> 'accion', ''), v_op),
        v_antes_e -> (v_id::text), public.agrupador_foto_embarque(v_id),
        left(v_motivo, 300), v_causa, v_resumen,
        (select coalesce(jsonb_agg(jsonb_build_object('compra_id', x ->> 'id', 'revision_nueva', (x ->> 'revision')::integer)), '[]'::jsonb)
           from jsonb_array_elements(v_res_c) x),
        v_perfil, v_nombre_actor
      from public.compra_embarques e
      where e.id = v_id;
    end loop;

    return jsonb_build_object('ok', true, 'embarques', v_res_e, 'compras', v_res_c);
  exception
    when sqlstate 'AG001' then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm);
    when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end;
end;
$$;

revoke execute on function public.aplicar_movimiento_agrupador(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_movimiento_agrupador(jsonb, jsonb) to service_role;

comment on function public.aplicar_movimiento_agrupador(jsonb, jsonb) is
  'M8 08b-1 + 0034 + 08b-1b: aplica un plan de movimiento (asignar, quitar, mover_a_paquete, cambiar_fecha, pasar_pendientes, mover_paquete) en una transaccion. Bloquea embarques y compras en orden y compara la revision de TODAS las del plan (agrupador_cambio, compra_cambio), comprueba pertenencia y estados, ejecuta los movimientos con agrupador_mover_entregas y verifica I1 a I3, I2 generalizada (todas las asignaciones activas de los embarques del plan en coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)), I7 e I9. cambiar_fecha acepta cualquier hito, hito_confirmado, el ingreso al stock y los paquetes (clave presente = valor nuevo; motivo y causa solo si reprograma; sin_cambios; hora_sin_fecha, puerto_en_local, fecha_requerida, fecha_futura). mover_a_paquete mueve por unidades y puede cambiar de mes; mover_paquete conserva el ingreso propio. Sube revision y deja evento SOLO en las compras cuya compra_foto_entregas cambio; el evento del embarque guarda la causa. Todo rechazo deshace lo escrito y devuelve { ok: false, motivo }. Solo service_role. Candados: embarques for no key update (0036); compras for update.';

-- ---------------------------------------------------------------------------
-- 4.8 `importar_agrupadores` (0036)
-- ---------------------------------------------------------------------------
-- Columnas nuevas del embarque (§3.6): `fecha_puerto_estimada` (FECHA_ARRIBO), `fecha_inicio_operativo_estimada` y `hora_inicio_operativo`
-- (INICIO_OPERATIVO), `fecha_ingreso_estimada` (FECHA_INGRESO_STOCK, vacía = igual al Ingreso CD) y `origen` (ORIGEN). `fecha_llegada_estimada`
-- sigue siendo el Ingreso CD obligatorio (FECHA_INGRESO_CD o su sinónimo FECHA_LLEGADA, que resuelve TypeScript). Nuevos rechazos:
-- `hora_sin_fecha` y `puerto_en_local` (TypeScript ya ignora el Arribo de un LOCAL con aviso; esto es la red de seguridad). El código de un
-- paquete nuevo toma el mes del Ingreso CD de su embarque (`fecha_llegada_estimada`). La clave natural sin código sigue siendo (nombre,
-- Ingreso CD). Solo crea (decisión 97). Candados de la 0036 intactos (`agrupador_importar`, viajes y embarques `for no key update`).
create or replace function public.importar_agrupadores(p_lote jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_archivo text := nullif(left(btrim(coalesce(p_lote ->> 'archivo_nombre', '')), 250), '');
  v_motivo_ev text;
  v_it jsonb;
  v_tipo_act text := null;
  v_fila_act integer := null;
  v_codigo text;
  v_ref date;
  v_creados jsonb := '[]'::jsonb;
  v_viaje public.compra_viajes%rowtype;
  v_emb public.compra_embarques%rowtype;
  v_paq public.compra_paquetes%rowtype;
  v_viaje_id uuid;
  v_emb_id uuid;
  v_resp uuid;
  v_nombre text;
  v_inicio date;
  v_fin date;
  v_salida date;
  v_llegada date;
  v_arribo date;
  v_ini date;
  v_hora time;
  v_ingreso date;
  v_origen text;
  v_tipo_emb text;
begin
  v_motivo_ev := left('Importado de ' || coalesce(v_archivo, 'archivo'), 300);
  perform pg_advisory_xact_lock(hashtext('agrupador_importar'));

  perform 1
     from public.compra_viajes v
    where v.id in (
      select (e ->> 'viaje_id')::uuid
        from jsonb_array_elements(coalesce(p_lote -> 'embarques', '[]'::jsonb)) e
       where nullif(e ->> 'viaje_id', '') is not null
    )
    order by v.id
      for no key update;
  perform 1
     from public.compra_embarques b
    where b.id in (
      select (e ->> 'embarque_id')::uuid
        from jsonb_array_elements(coalesce(p_lote -> 'paquetes', '[]'::jsonb)) e
       where nullif(e ->> 'embarque_id', '') is not null
    )
    order by b.id
      for no key update;

  begin
    v_tipo_act := 'viaje';
    for v_it in
      select x.value
        from jsonb_array_elements(coalesce(p_lote -> 'viajes', '[]'::jsonb)) as x(value)
       order by (case when nullif(btrim(x.value ->> 'codigo'), '') is null then 1 else 0 end), (x.value ->> 'fila')::integer
    loop
      v_fila_act := (v_it ->> 'fila')::integer;
      v_nombre := btrim(coalesce(v_it ->> 'nombre', ''));
      v_resp := nullif(v_it ->> 'responsable_id', '')::uuid;
      v_inicio := nullif(v_it ->> 'fecha_inicio', '')::date;
      v_fin := nullif(v_it ->> 'fecha_fin', '')::date;
      v_codigo := upper(btrim(coalesce(v_it ->> 'codigo', '')));
      if v_inicio is null then
        raise exception 'fecha_requerida' using errcode = 'AG001';
      end if;
      if v_fin is not null and v_fin < v_inicio then
        raise exception 'fin_antes_de_inicio' using errcode = 'AG001';
      end if;
      if v_resp is null or not public.agrupador_responsable_asignable(v_resp) then
        raise exception 'responsable_no_asignable' using errcode = 'AG001';
      end if;
      if v_codigo = '' then
        if exists (
          select 1 from public.compra_viajes x
           where public.agrupador_nombre_clave(x.nombre) = public.agrupador_nombre_clave(v_nombre) and x.fecha_inicio = v_inicio
        ) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
        v_codigo := public.agrupador_siguiente_codigo('viaje', v_inicio);
        if v_codigo is null then
          raise exception 'correlativo_agotado' using errcode = 'AG001';
        end if;
      else
        if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
          raise exception 'codigo_invalido' using errcode = 'AG001';
        end if;
        if exists (select 1 from public.compra_viajes x where upper(x.codigo) = v_codigo) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
      end if;
      insert into public.compra_viajes (
        codigo, nombre, destino, fecha_inicio, fecha_fin, responsable_id, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, nullif(btrim(v_it ->> 'destino'), ''), v_inicio, v_fin, v_resp, nullif(btrim(v_it ->> 'nota'), ''),
        v_perfil, v_nombre_actor, v_perfil, v_nombre_actor
      )
      returning * into v_viaje;
      insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_viaje.id, 'crear', null, to_jsonb(v_viaje), v_motivo_ev,
        left(format('Viaje %s creado: %s', v_viaje.codigo, v_viaje.nombre), 300), v_perfil, v_nombre_actor
      );
      v_creados := v_creados || jsonb_build_array(
        jsonb_build_object('tipo', 'viaje', 'fila', v_fila_act, 'id', v_viaje.id, 'codigo', v_viaje.codigo)
      );
    end loop;

    v_tipo_act := 'embarque';
    for v_it in
      select x.value
        from jsonb_array_elements(coalesce(p_lote -> 'embarques', '[]'::jsonb)) as x(value)
       order by (case when nullif(btrim(x.value ->> 'codigo'), '') is null then 1 else 0 end), (x.value ->> 'fila')::integer
    loop
      v_fila_act := (v_it ->> 'fila')::integer;
      v_nombre := btrim(coalesce(v_it ->> 'nombre', ''));
      v_tipo_emb := coalesce(nullif(v_it ->> 'tipo', ''), 'importacion');
      v_resp := nullif(v_it ->> 'responsable_id', '')::uuid;
      v_salida := nullif(v_it ->> 'fecha_salida_estimada', '')::date;
      v_llegada := nullif(v_it ->> 'fecha_llegada_estimada', '')::date;
      v_arribo := nullif(v_it ->> 'fecha_puerto_estimada', '')::date;
      v_ini := nullif(v_it ->> 'fecha_inicio_operativo_estimada', '')::date;
      v_hora := nullif(v_it ->> 'hora_inicio_operativo', '')::time;
      v_ingreso := nullif(v_it ->> 'fecha_ingreso_estimada', '')::date;
      v_origen := nullif(btrim(v_it ->> 'origen'), '');
      v_codigo := upper(btrim(coalesce(v_it ->> 'codigo', '')));
      v_viaje_id := nullif(v_it ->> 'viaje_id', '')::uuid;
      if v_viaje_id is null and nullif(btrim(v_it ->> 'viaje_codigo'), '') is not null then
        select v.id into v_viaje_id from public.compra_viajes v where upper(v.codigo) = upper(btrim(v_it ->> 'viaje_codigo'));
        if not found then
          raise exception 'no_encontrado' using errcode = 'AG001';
        end if;
      end if;
      if v_llegada is null then
        raise exception 'fecha_requerida' using errcode = 'AG001';
      end if;
      if v_salida is not null and v_salida > v_llegada then
        raise exception 'salida_despues_de_llegada' using errcode = 'AG001';
      end if;
      if v_hora is not null and v_ini is null then
        raise exception 'hora_sin_fecha' using errcode = 'AG001';
      end if;
      if v_tipo_emb = 'local' and v_arribo is not null then
        raise exception 'puerto_en_local' using errcode = 'AG001';
      end if;
      if v_viaje_id is not null then
        select * into v_viaje from public.compra_viajes where id = v_viaje_id;
        if not found then
          raise exception 'no_encontrado' using errcode = 'AG001';
        end if;
        if v_viaje.estado = 'cancelado' then
          raise exception 'viaje_cancelado' using errcode = 'AG001';
        end if;
      end if;
      if v_tipo_emb = 'local' and v_viaje_id is not null then
        raise exception 'local_con_viaje' using errcode = 'AG001';
      end if;
      if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
        raise exception 'responsable_no_asignable' using errcode = 'AG001';
      end if;
      if v_codigo = '' then
        if exists (
          select 1 from public.compra_embarques x
           where public.agrupador_nombre_clave(x.nombre) = public.agrupador_nombre_clave(v_nombre) and x.fecha_llegada_estimada = v_llegada
        ) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
        v_codigo := public.agrupador_siguiente_codigo('embarque', v_llegada);
        if v_codigo is null then
          raise exception 'correlativo_agotado' using errcode = 'AG001';
        end if;
      else
        if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
          raise exception 'codigo_invalido' using errcode = 'AG001';
        end if;
        if exists (select 1 from public.compra_embarques x where upper(x.codigo) = v_codigo) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
      end if;
      insert into public.compra_embarques (
        codigo, nombre, tipo, viaje_id, responsable_id, referencia_logistica, puerto_embarque,
        fecha_salida_estimada, fecha_puerto_estimada, fecha_llegada_estimada,
        fecha_inicio_operativo_estimada, hora_inicio_operativo, fecha_ingreso_estimada, origen, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, v_tipo_emb, v_viaje_id, v_resp, nullif(btrim(v_it ->> 'referencia_logistica'), ''),
        nullif(btrim(v_it ->> 'puerto_embarque'), ''), v_salida, v_arribo, v_llegada,
        v_ini, v_hora, v_ingreso, v_origen, nullif(btrim(v_it ->> 'nota'), ''),
        v_perfil, v_nombre_actor, v_perfil, v_nombre_actor
      )
      returning * into v_emb;
      insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_emb.id, v_emb.viaje_id, 'crear', null,
        public.agrupador_foto_embarque(v_emb.id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo),
        v_motivo_ev, left(format('Embarque %s creado: %s', v_emb.codigo, v_emb.nombre), 300), v_perfil, v_nombre_actor
      );
      v_creados := v_creados || jsonb_build_array(
        jsonb_build_object('tipo', 'embarque', 'fila', v_fila_act, 'id', v_emb.id, 'codigo', v_emb.codigo)
      );
    end loop;

    v_tipo_act := 'paquete';
    for v_it in
      select x.value
        from jsonb_array_elements(coalesce(p_lote -> 'paquetes', '[]'::jsonb)) as x(value)
       order by (case when nullif(btrim(x.value ->> 'codigo'), '') is null then 1 else 0 end), (x.value ->> 'fila')::integer
    loop
      v_fila_act := (v_it ->> 'fila')::integer;
      v_nombre := btrim(coalesce(v_it ->> 'nombre', ''));
      v_resp := nullif(v_it ->> 'responsable_id', '')::uuid;
      v_codigo := upper(btrim(coalesce(v_it ->> 'codigo', '')));
      v_emb_id := nullif(v_it ->> 'embarque_id', '')::uuid;
      if v_emb_id is null and nullif(btrim(v_it ->> 'embarque_codigo'), '') is not null then
        select b.id into v_emb_id from public.compra_embarques b where upper(b.codigo) = upper(btrim(v_it ->> 'embarque_codigo'));
        if not found then
          raise exception 'no_encontrado' using errcode = 'AG001';
        end if;
      end if;
      select * into v_emb from public.compra_embarques where id = v_emb_id;
      if not found then
        raise exception 'no_encontrado' using errcode = 'AG001';
      end if;
      if v_emb.estado not in ('planificado', 'en_transito') then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;
      if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
        raise exception 'responsable_no_asignable' using errcode = 'AG001';
      end if;
      v_ref := v_emb.fecha_llegada_estimada;
      if v_codigo = '' then
        if exists (
          select 1 from public.compra_paquetes x
           where x.embarque_id = v_emb_id and public.agrupador_nombre_clave(x.nombre) = public.agrupador_nombre_clave(v_nombre)
        ) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
        v_codigo := public.agrupador_siguiente_codigo('paquete', v_ref);
        if v_codigo is null then
          raise exception 'correlativo_agotado' using errcode = 'AG001';
        end if;
      else
        if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
          raise exception 'codigo_invalido' using errcode = 'AG001';
        end if;
        if exists (select 1 from public.compra_paquetes x where upper(x.codigo) = v_codigo) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
      end if;
      insert into public.compra_paquetes (
        embarque_id, codigo, nombre, responsable_id, nota, perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (v_emb_id, v_codigo, v_nombre, v_resp, nullif(btrim(v_it ->> 'nota'), ''), v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
      returning * into v_paq;
      insert into public.compra_agrupador_eventos (paquete_id, embarque_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_paq.id, v_emb_id, 'crear', null, to_jsonb(v_paq), v_motivo_ev,
        left(format('Paquete %s creado: %s', v_paq.codigo, v_paq.nombre), 300), v_perfil, v_nombre_actor
      );
      v_creados := v_creados || jsonb_build_array(
        jsonb_build_object('tipo', 'paquete', 'fila', v_fila_act, 'id', v_paq.id, 'codigo', v_paq.codigo)
      );
    end loop;

    return jsonb_build_object('ok', true, 'creados', v_creados);
  exception
    when sqlstate 'AG001' then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm, 'tipo', v_tipo_act, 'fila', v_fila_act);
    when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado', 'tipo', v_tipo_act, 'fila', v_fila_act);
  end;
end;
$$;

revoke execute on function public.importar_agrupadores(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.importar_agrupadores(jsonb, jsonb) to service_role;

comment on function public.importar_agrupadores(jsonb, jsonb) is
  'M8 08b-1 (3.11, decision 97) + 08b-1b: crea viajes, embarques y paquetes de un lote (solo filas nuevas) en una transaccion, todo o nada, bajo el candado agrupador_importar. Los embarques traen los cinco hitos (Ingreso CD obligatorio), el ingreso al stock y el origen; hora_sin_fecha y puerto_en_local rechazan. El codigo de un paquete nuevo toma el mes del Ingreso CD de su embarque. Reserva primero los codigos escritos y autonumera despues en orden de fila. Vuelve a comprobar cada clave (clave_existente: no duplica; aplicar dos veces el mismo lote no crea nada la segunda vez) y cada referencia. Solo crea: nunca edita, mueve ni asigna compras. Deja un evento crear por agrupador. Devuelve { ok, creados[] } o { ok: false, motivo, tipo, fila }. Solo service_role. Candados de viajes y embarques existentes: for no key update (0036).';

-- ---------------------------------------------------------------------------
-- 4.9 `agrupador_hitos_resumen(p_embarques uuid[])` (NUEVA, solo lectura)
-- ---------------------------------------------------------------------------
-- Por cada embarque pedido y cada uno de los cinco hitos (`zarpe`, `arribo`, `ingreso_cd`, `inicio_operativo`, `ingreso_stock`), más una
-- fila `ingreso_paquete` (con `paquete_id`) por cada paquete del embarque que alguna vez tuvo ingreso propio:
--   * `fecha_original`: la primera fecha no nula que aparece en los eventos del embarque (antes y después, en orden), es decir, lo
--     planeado al crear. Para `ingreso_stock` es la fecha EFECTIVA (`coalesce(ingreso fijado, Ingreso CD)`).
--   * `reprogramaciones`: eventos en que el hito tenía valor y cambió o se vació, SIN contar las causas `correccion` ni `programacion`.
--     Completar una fecha vacía no cuenta. En `inicio_operativo` cuenta cambiar o vaciar la fecha o la hora que tenían valor. En
--     `ingreso_stock` cuenta fijar o igualar el ingreso cuando la fecha efectiva cambia (que el ingreso sin fijar siga al Ingreso CD no
--     cuenta: eso es una reprogramación del Ingreso CD). En un paquete, cambiar un ingreso propio que ya tenía valor.
--   * `ultima_causa`: la causa del último evento que cambió el hito (sea cual sea; nula si no hubo o no llevaba causa).
-- Lee solo los eventos con foto de embarque (`despues` trae `fecha_llegada_estimada`; los eventos de paquete llevan otra forma). Los
-- embarques sin eventos devuelven sus cinco filas con `fecha_original` nula y 0. El retraso en días lo calcula TypeScript contra la
-- fecha vigente. Usa `compra_agrupador_eventos_embarque_created_idx`.
create or replace function public.agrupador_hitos_resumen(p_embarques uuid[])
returns table (
  embarque_id uuid,
  paquete_id uuid,
  hito text,
  fecha_original date,
  reprogramaciones integer,
  ultima_causa text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select x.embarque_id, x.id, x.created_at, x.causa, x.antes, x.despues
    from public.compra_agrupador_eventos x
    where x.embarque_id = any (p_embarques)
      and x.despues ? 'fecha_llegada_estimada'
  ),
  h as (
    select ev.embarque_id, ev.id, ev.created_at, ev.causa, k.hito, k.a, k.d, k.cambio
    from ev
    cross join lateral (
      select 'zarpe'::text as hito,
             ev.antes ->> 'fecha_salida_estimada' as a,
             ev.despues ->> 'fecha_salida_estimada' as d,
             (ev.antes ->> 'fecha_salida_estimada') is not null
               and (ev.antes ->> 'fecha_salida_estimada') is distinct from (ev.despues ->> 'fecha_salida_estimada') as cambio
      union all
      select 'arribo',
             ev.antes ->> 'fecha_puerto_estimada',
             ev.despues ->> 'fecha_puerto_estimada',
             (ev.antes ->> 'fecha_puerto_estimada') is not null
               and (ev.antes ->> 'fecha_puerto_estimada') is distinct from (ev.despues ->> 'fecha_puerto_estimada')
      union all
      select 'ingreso_cd',
             ev.antes ->> 'fecha_llegada_estimada',
             ev.despues ->> 'fecha_llegada_estimada',
             (ev.antes ->> 'fecha_llegada_estimada') is not null
               and (ev.antes ->> 'fecha_llegada_estimada') is distinct from (ev.despues ->> 'fecha_llegada_estimada')
      union all
      select 'inicio_operativo',
             ev.antes ->> 'fecha_inicio_operativo_estimada',
             ev.despues ->> 'fecha_inicio_operativo_estimada',
             ((ev.antes ->> 'fecha_inicio_operativo_estimada') is not null
                and (ev.antes ->> 'fecha_inicio_operativo_estimada') is distinct from (ev.despues ->> 'fecha_inicio_operativo_estimada'))
             or ((ev.antes ->> 'hora_inicio_operativo') is not null
                and (ev.antes ->> 'hora_inicio_operativo') is distinct from (ev.despues ->> 'hora_inicio_operativo'))
      union all
      select 'ingreso_stock',
             coalesce(ev.antes ->> 'fecha_ingreso_estimada', ev.antes ->> 'fecha_llegada_estimada'),
             coalesce(ev.despues ->> 'fecha_ingreso_estimada', ev.despues ->> 'fecha_llegada_estimada'),
             ev.antes is not null
               and (ev.antes ->> 'fecha_ingreso_estimada') is distinct from (ev.despues ->> 'fecha_ingreso_estimada')
               and coalesce(ev.antes ->> 'fecha_ingreso_estimada', ev.antes ->> 'fecha_llegada_estimada')
                   is distinct from coalesce(ev.despues ->> 'fecha_ingreso_estimada', ev.despues ->> 'fecha_llegada_estimada')
    ) k
  ),
  orig as (
    select distinct on (h.embarque_id, h.hito) h.embarque_id, h.hito, coalesce(h.a, h.d)::date as fecha_original
    from h
    where h.a is not null or h.d is not null
    order by h.embarque_id, h.hito, h.created_at, h.id
  ),
  cnt as (
    select h.embarque_id, h.hito,
           (count(*) filter (where h.cambio and coalesce(h.causa, '') not in ('correccion', 'programacion')))::integer as reprogramaciones
    from h
    group by h.embarque_id, h.hito
  ),
  ult as (
    select distinct on (h.embarque_id, h.hito) h.embarque_id, h.hito, h.causa as ultima_causa
    from h
    where h.cambio
    order by h.embarque_id, h.hito, h.created_at desc, h.id desc
  ),
  pq0 as (
    select ev.embarque_id, ev.id, ev.created_at, ev.causa, 0 as lado, x ->> 'id' as pid, x ->> 'fecha_ingreso_estimada' as valor
    from ev
    cross join lateral jsonb_array_elements(coalesce(ev.antes -> 'paquetes', '[]'::jsonb)) x
    union all
    select ev.embarque_id, ev.id, ev.created_at, ev.causa, 1, x ->> 'id', x ->> 'fecha_ingreso_estimada'
    from ev
    cross join lateral jsonb_array_elements(coalesce(ev.despues -> 'paquetes', '[]'::jsonb)) x
  ),
  pq as (
    select q.embarque_id, q.id, q.created_at, q.causa, q.pid,
           bool_or(q.lado = 0) as ta, max(q.valor) filter (where q.lado = 0) as va,
           bool_or(q.lado = 1) as td, max(q.valor) filter (where q.lado = 1) as vd
    from pq0 q
    group by q.embarque_id, q.id, q.created_at, q.causa, q.pid
  ),
  pq_orig as (
    select distinct on (q.embarque_id, q.pid) q.embarque_id, q.pid,
           coalesce(case when q.ta then q.va end, case when q.td then q.vd end)::date as fecha_original
    from pq q
    where (q.ta and q.va is not null) or (q.td and q.vd is not null)
    order by q.embarque_id, q.pid, q.created_at, q.id
  ),
  pq_cnt as (
    select q.embarque_id, q.pid,
           (count(*) filter (where q.ta and q.td and q.va is not null and q.va is distinct from q.vd
                                   and coalesce(q.causa, '') not in ('correccion', 'programacion')))::integer as reprogramaciones
    from pq q
    group by q.embarque_id, q.pid
  ),
  pq_ult as (
    select distinct on (q.embarque_id, q.pid) q.embarque_id, q.pid, q.causa as ultima_causa
    from pq q
    where q.ta and q.td and q.va is not null and q.va is distinct from q.vd
    order by q.embarque_id, q.pid, q.created_at desc, q.id desc
  )
  select u.id, null::uuid, hs.hito, o.fecha_original, coalesce(c.reprogramaciones, 0), l.ultima_causa
  from (select distinct x as id from unnest(p_embarques) x) u
  cross join (values ('zarpe'), ('arribo'), ('ingreso_cd'), ('inicio_operativo'), ('ingreso_stock')) as hs(hito)
  left join orig o on o.embarque_id = u.id and o.hito = hs.hito
  left join cnt c on c.embarque_id = u.id and c.hito = hs.hito
  left join ult l on l.embarque_id = u.id and l.hito = hs.hito
  union all
  select po.embarque_id, po.pid::uuid, 'ingreso_paquete', po.fecha_original, coalesce(pc.reprogramaciones, 0), pu.ultima_causa
  from pq_orig po
  join public.compra_paquetes p on p.id = po.pid::uuid and p.embarque_id = po.embarque_id
  left join pq_cnt pc on pc.embarque_id = po.embarque_id and pc.pid = po.pid
  left join pq_ult pu on pu.embarque_id = po.embarque_id and pu.pid = po.pid;
$$;

revoke execute on function public.agrupador_hitos_resumen(uuid[]) from public, anon, authenticated;
grant execute on function public.agrupador_hitos_resumen(uuid[]) to service_role;

comment on function public.agrupador_hitos_resumen(uuid[]) is
  'M8 08b-1b (decision 116): por embarque y hito (zarpe, arribo, ingreso_cd, inicio_operativo, ingreso_stock) mas una fila ingreso_paquete por paquete con ingreso propio: fecha_original (la primera no nula en los eventos), reprogramaciones (sin contar las causas correccion ni programacion) y ultima_causa. Se deriva de las fotos antes/despues de compra_agrupador_eventos. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4.10 `editar_oc_compra(p_compra, p_antes, p_numero_oc, p_motivo, p_actor)` (NUEVA)
-- ---------------------------------------------------------------------------
-- Registra, cambia o quita (`p_numero_oc` nulo) el número de OC de una compra (ficha §2.11, decisión 121). Análoga a `editar_ficha_linea`
-- de 08c: valor previo en `p_antes` (lo que vio el formulario), SIN subir `compras.revision` (la OC no toca cantidades ni fechas; subirla
-- daría `compra_cambio` falsos a quien tiene la compra abierta o un plan de movimiento ya previsualizado). Pasos:
--   1. Bloquea SOLO la compra (`for no key update`: no es columna clave y así no choca con el `key share` de las FK de líneas y eventos;
--      las funciones que mueven compras toman `for update` de la misma fila y se esperan, sin ciclo, porque esta toma una sola fila).
--   2. Compra inexistente: `no_encontrado`; cancelada: `no_editable`.
--   3. Guardado igual al nuevo: `sin_cambios`, comparado ANTES que `p_antes` (un reintento tras un corte de red devuelve `sin_cambios`).
--   4. `p_antes` distinto de lo guardado: `oc_cambio` (otra persona la cambió) y no escribe.
--   5. Escribe `numero_oc` y `updated_by_*`. Si el índice único `compras_proveedor_oc_uidx` la rechaza, devuelve
--      `{ ok: false, motivo: 'oc_repetida', compra: <número de la compra que ya la tiene> }` sin escribir (también cuando dos personas
--      ponen la misma OC a la vez en dos compras del proveedor: la segunda espera a la primera y la recibe).
--   6. Deja el evento `editar_oc` en `compra_eventos` con `antes = { numero_oc }`, `despues = { numero_oc }`, el motivo (opcional, 300)
--      y el resumen. El evento mueve la huella del flujo una vez (cuenta eventos) sin cambiar cifras.
--   7. Devuelve `{ ok, numero_oc, avisos }` con `oc_de_otro_proveedor` por cada compra viva de OTRO proveedor con la misma OC.
-- `oc_invalida` si la OC no cabe en el `check` (1 a 40 caracteres tras quitar espacios al borde). Los permisos de la persona los decide la API.
create or replace function public.editar_oc_compra(
  p_compra uuid,
  p_antes text,
  p_numero_oc text,
  p_motivo text,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_nuevo text := nullif(btrim(p_numero_oc), '');
  v_antes text := nullif(btrim(p_antes), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_c public.compras%rowtype;
  v_otra text;
  v_avisos jsonb;
begin
  if v_nuevo is not null and char_length(v_nuevo) > 40 then
    return jsonb_build_object('ok', false, 'motivo', 'oc_invalida');
  end if;

  select * into v_c from public.compras where id = p_compra for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if v_c.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if v_c.numero_oc is not distinct from v_nuevo then
    return jsonb_build_object('ok', false, 'motivo', 'sin_cambios');
  end if;
  if v_c.numero_oc is distinct from v_antes then
    return jsonb_build_object('ok', false, 'motivo', 'oc_cambio');
  end if;

  begin
    update public.compras
       set numero_oc = v_nuevo, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_compra;
  exception
    when unique_violation then
      select c2.numero into v_otra
        from public.compras c2
       where c2.proveedor_id = v_c.proveedor_id
         and c2.id <> p_compra
         and c2.estado <> 'cancelada'
         and upper(btrim(c2.numero_oc)) = upper(v_nuevo)
       order by c2.numero
       limit 1;
      return jsonb_build_object('ok', false, 'motivo', 'oc_repetida', 'compra', v_otra);
  end;

  insert into public.compra_eventos (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
  values (
    p_compra, null, 'editar_oc',
    jsonb_build_object('numero_oc', v_c.numero_oc), jsonb_build_object('numero_oc', v_nuevo),
    left(v_motivo, 300),
    left(format('OC: %s → %s', coalesce(v_c.numero_oc, '—'), coalesce(v_nuevo, '—')), 300),
    v_perfil, v_nombre_actor
  );

  select coalesce(
           jsonb_agg(jsonb_build_object('codigo', 'oc_de_otro_proveedor', 'compra', x.numero, 'proveedor', x.nombre) order by x.numero),
           '[]'::jsonb)
    into v_avisos
    from (
      select c2.numero, p.nombre
        from public.compras c2
        join public.proveedores p on p.id = c2.proveedor_id
       where v_nuevo is not null
         and c2.proveedor_id <> v_c.proveedor_id
         and c2.estado <> 'cancelada'
         and upper(btrim(c2.numero_oc)) = upper(v_nuevo)
       order by c2.numero
       limit 10
    ) x;

  return jsonb_build_object('ok', true, 'numero_oc', v_nuevo, 'avisos', v_avisos);
end;
$$;

revoke execute on function public.editar_oc_compra(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.editar_oc_compra(uuid, text, text, text, jsonb) to service_role;

comment on function public.editar_oc_compra(uuid, text, text, text, jsonb) is
  'M8 08b-1b (decision 121): registra, cambia o quita (p_numero_oc nulo) el numero de OC de una compra. Bloquea solo la compra (for no key update), compara el valor previo p_antes (oc_cambio), responde sin_cambios a un reintento (antes que oc_cambio), rechaza una compra cancelada (no_editable) y una OC repetida en el mismo proveedor (oc_repetida con el numero de la compra que ya la tiene, por el indice unico compras_proveedor_oc_uidx). NO sube compras.revision. Deja el evento editar_oc en compra_eventos. Devuelve { ok, numero_oc, avisos } con oc_de_otro_proveedor. Motivos: no_encontrado, no_editable, sin_cambios, oc_cambio, oc_repetida, oc_invalida. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 5. Registro de esta migración (convención de la 0035: la última sentencia)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas(nombre) values ('0038_fechas_logisticas_embarque') on conflict do nothing;

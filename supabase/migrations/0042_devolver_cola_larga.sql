-- M7 07h · Entrega previa (versión 0.20.0 · M7 i): devolver a la propuesta la cola larga decidida «tal cual» y deshacerlo.
--
-- Ficha: docs/modulos/07h-plan-por-tienda.md (§8.1 b, §2.2 «Ya en la migración de la entrega previa», invariantes RP5 a RP7 de
-- §8.1 g y caso G de §6.1). Patrón y contrato hermanos: 0031 (`aplicar_lote_proyeccion`, ficha 07g).
-- NUMERACIÓN: la 0042 es la siguiente libre al construir (aplicadas 0000-0025, 0027, 0029-0041; 0026 y 0028 reservadas).
-- Depende de 0018 (`proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios`), 0031 (`proyeccion_lotes`, `proyeccion_lote_filas`,
-- `decision_lote_id`, `respuesta_lote_proyeccion`) y 0035 (`migraciones_aplicadas`).
--
-- SE APLICA ANTES DEL CÓDIGO DE 0.20.0, con el código anterior desplegado: todo lo que añade es inocuo para él (dos columnas nulas en
-- tablas de solo inserción, con su `check`, y una función nueva). Ningún `check` existente cambia (en particular el de `origen`, C7, y
-- el de `revierte_lote_id` de la 0031). No hay seed ni backfill: los lotes anteriores quedan con las dos columnas en NULL.
--
-- Qué hace:
--   1. `proyeccion_lote_filas.anterior` (jsonb, nulo): foto de las columnas de decisión del registro objetivo ANTES de escribir.
--   2. `proyeccion_lotes.deshace_lote_id` (uuid, nulo, FK restrict, índice) con `check (deshace_lote_id is null or tipo like
--      'revertir\_%')`.
--   3. `devolver_cola_larga(p jsonb)`: la función hermana de `aplicar_lote_proyeccion` que escribe los lotes de tipo
--      `devolver_cola_larga` y `revertir_cola_larga` (el «Deshacer» de un lote devuelto).
--
-- POR QUÉ `deshace_lote_id` Y NO `revierte_lote_id` (ficha §2.2, H5): el `check` de la 0031 `proyeccion_lotes_revierte_tipo_check`
-- exige `(tipo = 'revertir') = (revierte_lote_id is not null)`; usarlo para `revertir_cola_larga` obligaría a cambiar ese `check`, y eso
-- es un `DROP CONSTRAINT`. La columna nueva es aditiva. Su `check` solo pide una dirección (no nulo ⇒ tipo `revertir_*`): así sirve
-- también para `revertir_plan_tienda` de la mesa (0.21.x) sin tocarlo; la otra dirección (tipo `revertir_cola_larga` ⇒ no nulo) la
-- exige la función.
--
-- TIPOS DE LOTE: `proyeccion_lotes.tipo` NO tiene `check` de catálogo (0031, ficha 07g §2.0: lo valida zod), así que los dos tipos
-- nuevos (`devolver_cola_larga`, `revertir_cola_larga`) no necesitan ningún cambio de esquema: los añade el catálogo de zod. La única
-- restricción de la base sobre `tipo` es estructural: la pareja `revertir` / `revierte_lote_id` (0031) y ahora `deshace_lote_id`.
--
-- Idempotente: `add column if not exists` (que omite también la FK y el `check` en línea si la columna ya existe), `create index if
-- not exists`, `create or replace function`, `revoke`/`grant`/`comment` repetibles y registro final con `on conflict do nothing`. Sin
-- `do $$ ... $$`. Sin `drop`, `delete`, `truncate` ni `update` A NIVEL DE MIGRACIÓN; dentro de `devolver_cola_larga` sí hay `insert` y
-- `update` (es su trabajo). Añadir una columna nula SIN default no reescribe filas, así que el trigger de inmutabilidad de la 0031 no
-- se dispara y no hace falta tocarlo (`deshace_lote_id` es `restrict`, no `set null`: no entra en su lista de excepciones).
--
-- Seguridad: las dos tablas ya tienen RLS sin políticas y `service_role` con `select, insert` a nivel de TABLA (0031 y 0035): las
-- columnas nuevas quedan cubiertas por ese mismo privilegio, sin grants por columna. La función es `security invoker`, `search_path`
-- vacío, todo calificado con esquema, `execute` solo para `service_role`. Los cuerpos van sin comentarios `--` (el SQL Editor de
-- Supabase los parsea mal dentro de `$$`): lo que hay que saber está aquí, encima. Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `proyeccion_lote_filas.anterior` (§2.2)
-- ---------------------------------------------------------------------------
-- Foto de las NUEVE columnas de decisión del registro objetivo justo antes de escribir: `decidido`, `origen`, `nota`,
-- `propuesta_al_decidir`, `decidido_por_id`, `decidido_por_nombre`, `decidido_at`, `decision_lote_id`, `decision_ia_fila_id` (con las
-- claves presentes aunque valgan null). La CALCULA la función a partir del registro bloqueado (no viene del cliente) y solo en las
-- líneas aplicadas; las rechazadas la dejan en NULL. Con ella «Deshacer» restaura lo que había, no la propuesta de hoy (RP7). La mesa
-- (0.21.x) la reutiliza y le añade, en las líneas de total de tienda, la decisión de `proyeccion_tiendas` y `delta_por_gml`: por eso el
-- `check` solo exige un objeto, sin fijar las claves.
alter table public.proyeccion_lote_filas
  add column if not exists anterior jsonb
    constraint proyeccion_lote_filas_anterior_check
      check (anterior is null or jsonb_typeof(anterior) = 'object');

comment on column public.proyeccion_lote_filas.anterior is
  'M7 07h 0.20.0 (8.1 b): foto de las columnas de decision del registro objetivo antes de escribir (decidido, origen, nota, propuesta_al_decidir, decidido_por_id, decidido_por_nombre, decidido_at, decision_lote_id, decision_ia_fila_id). La calcula la funcion con el registro bloqueado; solo en lineas aplicadas. Deshacer la restaura tal cual. NULL en los lotes anteriores a 0.20.0.';

-- ---------------------------------------------------------------------------
-- 2. `proyeccion_lotes.deshace_lote_id` (§2.2)
-- ---------------------------------------------------------------------------
-- No nulo = este lote deshace ese otro (`revertir_cola_larga` -> el `devolver_cola_larga`; en la mesa, `revertir_plan_tienda` -> el
-- `plan_tienda`). `restrict`: un lote deshecho no se borra (de todos modos los lotes son inmutables). No es diferible: la cabecera
-- que lo lleva se inserta al final de la función, cuando el lote deshecho ya existe. El `check` va en el mismo `add column if not
-- exists`: si la columna existe se omite entero (repetible sin `do $$`). En LIKE la barra invertida es el escape por defecto: `\_` es
-- un guion bajo literal, así que `revertir` (07g) NO cumple el patrón y `revertir_cola_larga` sí.
alter table public.proyeccion_lotes
  add column if not exists deshace_lote_id uuid
    constraint proyeccion_lotes_deshace_lote_id_fkey
      references public.proyeccion_lotes(id) on delete restrict
    constraint proyeccion_lotes_deshace_tipo_check
      check (deshace_lote_id is null or tipo like 'revertir\_%');

-- Índice de la FK (borrar un lote comprobaría esta columna) y de la consulta «¿qué lotes deshacen éste?».
create index if not exists proyeccion_lotes_deshace_lote_id_idx on public.proyeccion_lotes (deshace_lote_id);

comment on column public.proyeccion_lotes.deshace_lote_id is
  'M7 07h 0.20.0 (8.1 b): lote que este deshace (revertir_cola_larga -> devolver_cola_larga; en la mesa, revertir_plan_tienda -> plan_tienda). check: no nulo implica tipo revertir_*. No se usa revierte_lote_id porque su check de la 0031 lo ata a tipo = revertir y cambiarlo exigiria DROP CONSTRAINT. FK restrict.';

-- ---------------------------------------------------------------------------
-- 3. `devolver_cola_larga(p jsonb) returns jsonb` (§8.1 b)
-- ---------------------------------------------------------------------------
-- Escribe UN lote de tipo `devolver_cola_larga` o `revertir_cola_larga` en una sola transacción (la que abre la llamada RPC). No toca
-- `aplicar_lote_proyeccion` (su contrato y su prueba estática siguen iguales). Una confirmación de la pantalla son DOS lotes (uno por
-- año, mismo `confirmacion_id`, primero `Y` y después `Y+1`) troceados en tandas de <= 300 registros: cada tanda es una llamada.
-- Payload (lo arma el servicio de 0.20.0; los `set` salen de `payloadAnioDecision`, igual que en 07g):
--   { lote:  { id, confirmacion_id, proyeccion_id, tipo: devolver_cola_larga | revertir_cola_larga, deshace_lote_id?, anio,
--              huella_cuerpo, calculado_at_esperado, filtro?, efecto_gm_previsto?, revision_confirmada?, propuestas_gm?, nota?,
--              perfil_id?, usuario_nombre? },
--     filas: [ { fila_id, fila_clave, gm_clave, anio, decidido_esperado?, valor_esperado?, valor_actual?, decidido_anterior?,
--                rechazo?, registros: [ { id, updated_at_esperado, objetivo: true | false, set: { ... } } ] } ] }
-- Sin grupos ni `registros_lectura` (no hay IA): cada fila es atómica (su objetivo y el `Y+1` que B2 reescribe van juntos o nada).
--
-- Pasos (mismo orden que `aplicar_lote_proyeccion`):
--   1. Validación del payload (DC007). `tipo` cerrado a los dos de esta función; `revertir_cola_larga` exige `deshace_lote_id` y
--      `devolver_cola_larga` lo prohíbe (la dirección que el `check` de la tabla no cubre).
--   2. CANDADO de la proyección (`for no key update`) ANTES de mirar `lote.id`: un duplicado concurrente espera aquí al primero.
--   3. IDEMPOTENCIA: lote con ese `id` en la misma proyección y con la misma `huella_cuerpo` -> lo guardado con `repetido: true`;
--      si no, DC004 `lote_ajeno`. La `unique_violation` concurrente se traduce igual (bloque de escritura = subtransacción).
--   4. Proyección: `estado <> 'en_trabajo'` -> DC001 (`proyeccion_cerrada` o `proyeccion_archivada`); cálculo vivo (< 15 min) ->
--      DC002; `calculado_at` distinto del esperado -> DC003. En `revertir_cola_larga`: el lote deshecho debe existir, ser
--      `devolver_cola_larga` y de la misma proyección -> si no, DC005 `no_revertible`; y del mismo año -> si no, DC007. La regla
--      «recalculada con el método vigente» (409 `proyeccion_desactualizada`) es de TypeScript y no se repite aquí.
--   5. PASADA 1 (nada se escribe): `for update` UNA vez de todos los registros del lote, en orden `(fila_id, anio)` y solo de esta
--      proyección (un id ajeno cuenta como ausente: `cambio_concurrente`). Por cada fila, con el estado del INICIO del lote:
--        - payload: `anio` de la fila = el del lote; `(fila_clave, anio)` no repetido; un registro en una sola fila; `set` objeto con
--          claves de la lista fija (la misma de 07g: `payloadAnioDecision` sin `activo`, `fila_id` ni `anio`, más `decision_lote_id`);
--          exactamente un objetivo, del año de la fila y de una fila BASE (`tienda_id` nulo). El objetivo lleva en `set` LAS NUEVE
--          columnas de decisión: en `devolver_cola_larga` todas null (limpiar la decisión, como «Volver a la propuesta» de Por línea);
--          en `revertir_cola_larga` exactamente los valores de `anterior` de su línea del lote deshecho (comparados ya tipados), y
--          así `decision_lote_id` solo puede volver al lote de 07g que tenía y a ningún otro. Un registro NO objetivo (el `Y+1` que
--          B2 recalcula) no lleva ninguna columna de decisión ni `crecimiento_pct`. Si algo de esto falla -> DC007 y nada se escribe.
--        - `updated_at` igual al esperado (timestamptz exacto, microsegundos) -> si no, `cambio_concurrente`; `activo` -> si no,
--          `fila_inactiva`.
--        - objetivo de `devolver_cola_larga` (RP5): sigue siendo candidato con la cifra que vio la persona: `decidido` no nulo e igual
--          a `decidido_esperado` (obligatorio en el payload), `origen = 'propuesta'`, `decidido = propuesta_al_decidir` y sin traza de
--          IA -> si no, `cambiada_despues`. Por eso un `manual` (o una `escalada`, o una propuesta editada) NUNCA se escribe aunque
--          llegue en el payload. Con o sin `decision_lote_id`. Los avisos de cola larga (`revision_cola_larga`,
--          `disponibilidad_bajo_minimo`) y `decidido <> propuesto` (`sin_cambio`) los filtra TypeScript al elegir candidatas.
--        - objetivo de `revertir_cola_larga` (RP7): su línea APLICADA en el lote deshecho (por `fila_clave` y `anio`) debe existir con
--          `anterior` -> si no, DC009 `fila_no_devuelta`; otra línea aplicada de otro `revertir_cola_larga` del mismo lote deshecho ->
--          `ya_revertida`; el registro debe seguir SIN decidir -> si no, `cambiada_despues` (lo decidido después no se pisa).
--   6. PASADA 2: escribe las filas sin código con el mismo `update` de lista fija de 07g (clave ausente = columna intacta; clave con
--      null = null; `where activo = true`); `row_count <> 1` -> DC008. Inserta una `proyeccion_lote_filas` por fila (aplicada o
--      rechazada) con `fuente` = `devolver` o `revertir` (la fija la función), `anterior` = la foto (solo aplicadas), `valor` = el
--      `decidido` escrito (null al devolver; el restaurado al deshacer), `decidido_anterior` = el `decidido` leído antes de escribir y,
--      en las rechazadas, `valor_actual` = el `decidido` leído (si se leyó el registro). Calcula el `resumen` con la forma de 07g
--      (`pedidas`, `aplicadas`, `rechazadas`, `por_fuente` con `ia` y `metodo` en cero más `devolver` o `revertir`) e inserta la
--      cabecera AL FINAL (FK diferibles de 0031), con `revierte_lote_id` null y `deshace_lote_id`.
--   7. Devuelve `respuesta_lote_proyeccion(lote_id, false)` (0031): `{ lote_id, repetido, resumen, filas[] }`, la misma forma que 07g.
--
-- Errores propios (SQLSTATE, con `raise`, como los LP de 07g: un error deshace todo y TypeScript lo traduce): DC001
-- proyeccion_cerrada | proyeccion_archivada; DC002 calculo_en_curso; DC003 datos_cambiaron; DC004 lote_ajeno; DC005 no_revertible;
-- DC006 proyeccion_no_encontrada; DC007 payload_invalido (mensaje con el motivo); DC008 registro_no_escrito; DC009 fila_no_devuelta.
-- Códigos por fila (`resultado` de la línea): aplicada | cambio_concurrente | fila_inactiva | cambiada_despues | ya_revertida | el
-- `rechazo` que traiga TypeScript. Un interbloqueo (40P01) lo traduce TypeScript a `conflicto_reintentar`.
create or replace function public.devolver_cola_larga(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lote jsonb := p -> 'lote';
  v_lote_id uuid;
  v_proy_id uuid;
  v_tipo text;
  v_deshace uuid;
  v_huella text;
  v_calc timestamptz;
  v_anio integer;
  v_proy public.proyecciones%rowtype;
  v_ex public.proyeccion_lotes%rowtype;
  v_des public.proyeccion_lotes%rowtype;
  v_f jsonb;
  v_r jsonb;
  v_i integer;
  v_n integer;
  v_obj integer;
  v_cf text;
  v_a public.proyeccion_fila_anios%rowtype;
  v_x public.proyeccion_fila_anios%rowtype;
  v_ant public.proyeccion_fila_anios%rowtype;
  v_tienda uuid;
  v_set jsonb;
  v_ids uuid[];
  v_vistos uuid[] := '{}'::uuid[];
  v_claves text[] := '{}'::text[];
  v_est jsonb := '{}'::jsonb;
  v_fila_id uuid;
  v_fila_anio integer;
  v_fila_clave text;
  v_foto jsonb;
  v_anterior jsonb;
  v_leido integer;
  v_leyo boolean;
  v_fid uuid;
  v_fuente text;
  v_resumen jsonb;
  v_permitidas text[] := array[
    'bloque', 'subbloque', 'vendido', 'propuesto', 'metodo', 'referencia_alternativa', 'referencia_tres_meses', 'explicacion',
    'base_siguiente', 'base_normalizada', 'meses', 'origen_meses', 'curva_origen_usada', 'meses_propuestos',
    'curva_origen_propuesta', 'avisos', 'crecimiento_pct', 'decidido', 'origen', 'propuesta_al_decidir', 'nota', 'decidido_at',
    'decidido_por_id', 'decidido_por_nombre', 'decision_ia_fila_id', 'decision_lote_id'
  ];
  v_decision text[] := array[
    'decidido', 'origen', 'nota', 'propuesta_al_decidir', 'decidido_por_id', 'decidido_por_nombre', 'decidido_at',
    'decision_lote_id', 'decision_ia_fila_id'
  ];
begin
  if v_lote is null or jsonb_typeof(v_lote) <> 'object' or jsonb_typeof(p -> 'filas') is distinct from 'array' then
    raise exception 'payload_invalido: faltan lote o filas' using errcode = 'DC007';
  end if;
  v_lote_id := (v_lote ->> 'id')::uuid;
  v_proy_id := (v_lote ->> 'proyeccion_id')::uuid;
  v_tipo := v_lote ->> 'tipo';
  v_deshace := nullif(v_lote ->> 'deshace_lote_id', '')::uuid;
  v_huella := v_lote ->> 'huella_cuerpo';
  v_calc := (v_lote ->> 'calculado_at_esperado')::timestamptz;
  v_anio := (v_lote ->> 'anio')::integer;
  if v_lote_id is null or v_proy_id is null or v_huella is null or v_anio is null then
    raise exception 'payload_invalido: lote sin id, proyeccion_id, huella_cuerpo o anio' using errcode = 'DC007';
  end if;
  if v_tipo is null or v_tipo not in ('devolver_cola_larga', 'revertir_cola_larga') then
    raise exception 'payload_invalido: tipo de lote desconocido' using errcode = 'DC007';
  end if;
  if (v_tipo = 'revertir_cola_larga') <> (v_deshace is not null) then
    raise exception 'payload_invalido: deshace_lote_id va con el tipo revertir_cola_larga y solo con el' using errcode = 'DC007';
  end if;

  select * into v_proy
    from public.proyecciones
   where id = v_proy_id
     for no key update;
  if not found then
    raise exception 'proyeccion_no_encontrada' using errcode = 'DC006';
  end if;

  select * into v_ex
    from public.proyeccion_lotes
   where id = v_lote_id;
  if found then
    if v_ex.proyeccion_id is not distinct from v_proy_id and v_ex.huella_cuerpo = v_huella then
      return public.respuesta_lote_proyeccion(v_lote_id, true);
    end if;
    raise exception 'lote_ajeno' using errcode = 'DC004';
  end if;

  if v_proy.estado <> 'en_trabajo' then
    raise exception 'proyeccion_%', v_proy.estado using errcode = 'DC001';
  end if;
  if v_proy.calculando_desde is not null and v_proy.calculando_desde > now() - interval '15 minutes' then
    raise exception 'calculo_en_curso' using errcode = 'DC002';
  end if;
  if v_proy.calculado_at is null or v_calc is distinct from v_proy.calculado_at then
    raise exception 'datos_cambiaron' using errcode = 'DC003';
  end if;
  if v_tipo = 'revertir_cola_larga' then
    select * into v_des
      from public.proyeccion_lotes
     where id = v_deshace;
    if not found or v_des.proyeccion_id is distinct from v_proy_id or v_des.tipo <> 'devolver_cola_larga' then
      raise exception 'no_revertible' using errcode = 'DC005';
    end if;
    if v_des.anio <> v_anio then
      raise exception 'payload_invalido: el lote que deshace no es del anio del lote devuelto' using errcode = 'DC007';
    end if;
  end if;

  begin
    select coalesce(array_agg(distinct (r ->> 'id')::uuid), '{}'::uuid[]) into v_ids
      from jsonb_array_elements(p -> 'filas') as f
      cross join lateral jsonb_array_elements(coalesce(f -> 'registros', '[]'::jsonb)) as r;

    perform 1
       from public.proyeccion_fila_anios a
       join public.proyeccion_filas pf on pf.id = a.fila_id
      where a.id = any (v_ids)
        and pf.proyeccion_id = v_proy_id
      order by a.fila_id, a.anio
        for update of a;

    v_i := 0;
    for v_f in
      select e.value
        from jsonb_array_elements(p -> 'filas') with ordinality as e(value, ord)
       order by e.ord
    loop
      v_i := v_i + 1;
      v_cf := nullif(v_f ->> 'rechazo', '');
      v_foto := null;
      v_leido := null;
      v_leyo := false;
      v_fila_clave := v_f ->> 'fila_clave';
      v_fila_anio := (v_f ->> 'anio')::integer;
      if v_fila_clave is null or v_fila_anio is null then
        raise exception 'payload_invalido: fila sin fila_clave o anio' using errcode = 'DC007';
      end if;
      if v_fila_anio <> v_anio then
        raise exception 'payload_invalido: una fila no es del anio del lote' using errcode = 'DC007';
      end if;
      if (v_fila_clave || '#' || v_fila_anio::text) = any (v_claves) then
        raise exception 'payload_invalido: una fila aparece dos veces en el lote' using errcode = 'DC007';
      end if;
      v_claves := v_claves || (v_fila_clave || '#' || v_fila_anio::text);

      if v_cf is null then
        v_fila_id := (v_f ->> 'fila_id')::uuid;
        if v_fila_id is null then
          raise exception 'payload_invalido: fila sin fila_id' using errcode = 'DC007';
        end if;
        if v_tipo = 'devolver_cola_larga' and nullif(v_f ->> 'decidido_esperado', '') is null then
          raise exception 'payload_invalido: devolver exige decidido_esperado' using errcode = 'DC007';
        end if;
        v_anterior := null;
        if v_tipo = 'revertir_cola_larga' then
          select lf.anterior into v_anterior
            from public.proyeccion_lote_filas lf
           where lf.lote_id = v_deshace
             and lf.fila_clave = v_fila_clave
             and lf.anio = v_fila_anio
             and lf.resultado = 'aplicada';
          if v_anterior is null then
            raise exception 'fila_no_devuelta' using errcode = 'DC009';
          end if;
          v_ant := jsonb_populate_record(null::public.proyeccion_fila_anios, v_anterior);
        end if;
        v_obj := 0;
        for v_r in
          select e.value
            from jsonb_array_elements(coalesce(v_f -> 'registros', '[]'::jsonb)) with ordinality as e(value, ord)
           order by e.ord
        loop
          if (v_r ->> 'id') is null then
            raise exception 'payload_invalido: registro sin id' using errcode = 'DC007';
          end if;
          if (v_r ->> 'id')::uuid = any (v_vistos) then
            raise exception 'payload_invalido: un registro aparece en mas de una fila del lote' using errcode = 'DC007';
          end if;
          v_vistos := v_vistos || (v_r ->> 'id')::uuid;
          v_set := coalesce(v_r -> 'set', '{}'::jsonb);
          if jsonb_typeof(v_set) <> 'object' then
            raise exception 'payload_invalido: set no es un objeto' using errcode = 'DC007';
          end if;
          if exists (select 1 from jsonb_object_keys(v_set) as k where k <> all (v_permitidas)) then
            raise exception 'payload_invalido: columna fuera de la lista fija de set' using errcode = 'DC007';
          end if;
          if coalesce((v_r ->> 'objetivo')::boolean, false) then
            v_obj := v_obj + 1;
            if exists (select 1 from unnest(v_decision) as k where not (v_set ? k)) then
              raise exception 'payload_invalido: el set del objetivo lleva las nueve columnas de decision' using errcode = 'DC007';
            end if;
            if v_tipo = 'devolver_cola_larga' then
              if exists (select 1 from unnest(v_decision) as k where (v_set -> k) <> 'null'::jsonb) then
                raise exception 'payload_invalido: devolver deja las columnas de decision en null' using errcode = 'DC007';
              end if;
            else
              v_x := jsonb_populate_record(null::public.proyeccion_fila_anios, v_set);
              if v_x.decidido is distinct from v_ant.decidido
                 or v_x.origen is distinct from v_ant.origen
                 or v_x.nota is distinct from v_ant.nota
                 or v_x.propuesta_al_decidir is distinct from v_ant.propuesta_al_decidir
                 or v_x.decidido_por_id is distinct from v_ant.decidido_por_id
                 or v_x.decidido_por_nombre is distinct from v_ant.decidido_por_nombre
                 or v_x.decidido_at is distinct from v_ant.decidido_at
                 or v_x.decision_lote_id is distinct from v_ant.decision_lote_id
                 or v_x.decision_ia_fila_id is distinct from v_ant.decision_ia_fila_id then
                raise exception 'payload_invalido: deshacer restaura exactamente la decision de anterior' using errcode = 'DC007';
              end if;
            end if;
          else
            if exists (select 1 from unnest(v_decision || 'crecimiento_pct'::text) as k where v_set ? k) then
              raise exception 'payload_invalido: un registro no objetivo no lleva columnas de decision' using errcode = 'DC007';
            end if;
          end if;

          select a.* into v_a
            from public.proyeccion_fila_anios a
            join public.proyeccion_filas pf on pf.id = a.fila_id
           where a.id = (v_r ->> 'id')::uuid
             and pf.proyeccion_id = v_proy_id;
          if not found then
            if v_cf is null then
              v_cf := 'cambio_concurrente';
            end if;
            continue;
          end if;
          if v_a.fila_id is distinct from v_fila_id then
            raise exception 'payload_invalido: un registro no es de la fila indicada' using errcode = 'DC007';
          end if;
          if coalesce((v_r ->> 'objetivo')::boolean, false) then
            if v_a.anio is distinct from v_fila_anio then
              raise exception 'payload_invalido: el registro objetivo no es del anio de la fila' using errcode = 'DC007';
            end if;
            select pf.tienda_id into v_tienda from public.proyeccion_filas pf where pf.id = v_a.fila_id;
            if v_tienda is not null then
              raise exception 'payload_invalido: el registro objetivo no es de una fila base' using errcode = 'DC007';
            end if;
            v_leyo := true;
            v_leido := v_a.decidido;
            v_foto := jsonb_build_object(
              'decidido', v_a.decidido,
              'origen', v_a.origen,
              'nota', v_a.nota,
              'propuesta_al_decidir', v_a.propuesta_al_decidir,
              'decidido_por_id', v_a.decidido_por_id,
              'decidido_por_nombre', v_a.decidido_por_nombre,
              'decidido_at', v_a.decidido_at,
              'decision_lote_id', v_a.decision_lote_id,
              'decision_ia_fila_id', v_a.decision_ia_fila_id
            );
          end if;
          if v_cf is null and v_a.updated_at is distinct from (v_r ->> 'updated_at_esperado')::timestamptz then
            v_cf := 'cambio_concurrente';
          end if;
          if v_cf is null and not v_a.activo then
            v_cf := 'fila_inactiva';
          end if;
          if v_cf is null and coalesce((v_r ->> 'objetivo')::boolean, false) then
            if v_tipo = 'devolver_cola_larga' then
              if v_a.decidido is null
                 or v_a.decidido is distinct from nullif(v_f ->> 'decidido_esperado', '')::integer
                 or v_a.origen is distinct from 'propuesta'
                 or v_a.decidido is distinct from v_a.propuesta_al_decidir
                 or v_a.decision_ia_fila_id is not null then
                v_cf := 'cambiada_despues';
              end if;
            else
              if exists (
                select 1
                  from public.proyeccion_lote_filas lf
                  join public.proyeccion_lotes l on l.id = lf.lote_id
                 where l.deshace_lote_id = v_deshace
                   and l.tipo = 'revertir_cola_larga'
                   and lf.fila_clave = v_fila_clave
                   and lf.anio = v_fila_anio
                   and lf.resultado = 'aplicada'
              ) then
                v_cf := 'ya_revertida';
              elsif v_a.decidido is not null then
                v_cf := 'cambiada_despues';
              end if;
            end if;
          end if;
        end loop;
        if v_obj <> 1 then
          raise exception 'payload_invalido: cada fila lleva exactamente un registro objetivo' using errcode = 'DC007';
        end if;
      end if;

      v_est := v_est || jsonb_build_object(
        v_i::text,
        jsonb_build_object('cod', v_cf, 'foto', v_foto, 'leido', v_leido, 'leyo', v_leyo)
      );
    end loop;

    v_fuente := case when v_tipo = 'devolver_cola_larga' then 'devolver' else 'revertir' end;
    v_i := 0;
    for v_f in
      select e.value
        from jsonb_array_elements(p -> 'filas') with ordinality as e(value, ord)
       order by e.ord
    loop
      v_i := v_i + 1;
      v_cf := v_est -> (v_i::text) ->> 'cod';
      v_x := null;

      if v_cf is null then
        for v_r in
          select e.value
            from jsonb_array_elements(coalesce(v_f -> 'registros', '[]'::jsonb)) with ordinality as e(value, ord)
           order by e.ord
        loop
          v_set := coalesce(v_r -> 'set', '{}'::jsonb);
          v_x := jsonb_populate_record(null::public.proyeccion_fila_anios, v_set);
          update public.proyeccion_fila_anios a
             set bloque = case when v_set ? 'bloque' then v_x.bloque else a.bloque end,
                 subbloque = case when v_set ? 'subbloque' then v_x.subbloque else a.subbloque end,
                 vendido = case when v_set ? 'vendido' then v_x.vendido else a.vendido end,
                 propuesto = case when v_set ? 'propuesto' then v_x.propuesto else a.propuesto end,
                 metodo = case when v_set ? 'metodo' then v_x.metodo else a.metodo end,
                 referencia_alternativa = case when v_set ? 'referencia_alternativa' then v_x.referencia_alternativa else a.referencia_alternativa end,
                 referencia_tres_meses = case when v_set ? 'referencia_tres_meses' then v_x.referencia_tres_meses else a.referencia_tres_meses end,
                 explicacion = case when v_set ? 'explicacion' then v_x.explicacion else a.explicacion end,
                 base_siguiente = case when v_set ? 'base_siguiente' then v_x.base_siguiente else a.base_siguiente end,
                 base_normalizada = case when v_set ? 'base_normalizada' then v_x.base_normalizada else a.base_normalizada end,
                 meses = case when v_set ? 'meses' then v_x.meses else a.meses end,
                 origen_meses = case when v_set ? 'origen_meses' then v_x.origen_meses else a.origen_meses end,
                 curva_origen_usada = case when v_set ? 'curva_origen_usada' then v_x.curva_origen_usada else a.curva_origen_usada end,
                 meses_propuestos = case when v_set ? 'meses_propuestos' then v_x.meses_propuestos else a.meses_propuestos end,
                 curva_origen_propuesta = case when v_set ? 'curva_origen_propuesta' then v_x.curva_origen_propuesta else a.curva_origen_propuesta end,
                 avisos = case when v_set ? 'avisos' then v_x.avisos else a.avisos end,
                 crecimiento_pct = case when v_set ? 'crecimiento_pct' then v_x.crecimiento_pct else a.crecimiento_pct end,
                 decidido = case when v_set ? 'decidido' then v_x.decidido else a.decidido end,
                 origen = case when v_set ? 'origen' then v_x.origen else a.origen end,
                 propuesta_al_decidir = case when v_set ? 'propuesta_al_decidir' then v_x.propuesta_al_decidir else a.propuesta_al_decidir end,
                 nota = case when v_set ? 'nota' then v_x.nota else a.nota end,
                 decidido_at = case when v_set ? 'decidido_at' then v_x.decidido_at else a.decidido_at end,
                 decidido_por_id = case when v_set ? 'decidido_por_id' then v_x.decidido_por_id else a.decidido_por_id end,
                 decidido_por_nombre = case when v_set ? 'decidido_por_nombre' then v_x.decidido_por_nombre else a.decidido_por_nombre end,
                 decision_ia_fila_id = case when v_set ? 'decision_ia_fila_id' then v_x.decision_ia_fila_id else a.decision_ia_fila_id end,
                 decision_lote_id = case when v_set ? 'decision_lote_id' then v_x.decision_lote_id else a.decision_lote_id end
           where a.id = (v_r ->> 'id')::uuid
             and a.activo = true;
          get diagnostics v_n = row_count;
          if v_n <> 1 then
            raise exception 'registro_no_escrito' using errcode = 'DC008';
          end if;
          if coalesce((v_r ->> 'objetivo')::boolean, false) then
            v_leido := nullif(v_set ->> 'decidido', '')::integer;
          end if;
        end loop;
      end if;

      v_fid := nullif(v_f ->> 'fila_id', '')::uuid;
      if v_fid is not null and not exists (
        select 1 from public.proyeccion_filas where id = v_fid and proyeccion_id = v_proy_id
      ) then
        v_fid := null;
      end if;
      insert into public.proyeccion_lote_filas (
        lote_id, fila_id, fila_clave, gm_clave, anio, fuente, resultado, valor, valor_esperado, valor_actual,
        decidido_anterior, anterior
      )
      values (
        v_lote_id, v_fid, v_f ->> 'fila_clave', coalesce(v_f ->> 'gm_clave', ''), (v_f ->> 'anio')::integer, v_fuente,
        coalesce(v_cf, 'aplicada'),
        case when v_cf is null then v_leido else null end,
        coalesce(nullif(v_f ->> 'valor_esperado', ''), nullif(v_f ->> 'decidido_esperado', ''))::integer,
        case
          when v_cf is null then null
          when (v_est -> (v_i::text) ->> 'leyo')::boolean then (v_est -> (v_i::text) ->> 'leido')::integer
          else nullif(v_f ->> 'valor_actual', '')::integer
        end,
        case
          when (v_est -> (v_i::text) ->> 'leyo')::boolean then (v_est -> (v_i::text) ->> 'leido')::integer
          else nullif(v_f ->> 'decidido_anterior', '')::integer
        end,
        case when v_cf is null then v_est -> (v_i::text) -> 'foto' else null end
      );
    end loop;

    select jsonb_build_object(
        'pedidas', count(*),
        'aplicadas', count(*) filter (where f.resultado = 'aplicada'),
        'rechazadas', coalesce((
          select jsonb_object_agg(r.resultado, r.n)
            from (
              select f2.resultado, count(*) as n
                from public.proyeccion_lote_filas f2
               where f2.lote_id = v_lote_id
                 and f2.resultado <> 'aplicada'
               group by f2.resultado
            ) r
        ), '{}'::jsonb),
        'por_fuente', '{"ia": {"filas": 0, "unidades": 0}, "metodo": {"filas": 0, "unidades": 0}}'::jsonb || coalesce((
          select jsonb_object_agg(s.fuente, jsonb_build_object('filas', s.n, 'unidades', s.u))
            from (
              select f3.fuente, count(*) as n, coalesce(sum(f3.valor), 0) as u
                from public.proyeccion_lote_filas f3
               where f3.lote_id = v_lote_id
                 and f3.resultado = 'aplicada'
               group by f3.fuente
            ) s
        ), '{}'::jsonb)
      )
      into v_resumen
      from public.proyeccion_lote_filas f
     where f.lote_id = v_lote_id;

    insert into public.proyeccion_lotes (
      id, confirmacion_id, proyeccion_id, tipo, revierte_lote_id, deshace_lote_id, anio, huella_cuerpo, calculado_at_proyeccion,
      filtro, resumen, efecto_gm_previsto, revision_confirmada, propuestas_gm, nota, perfil_id, usuario_nombre
    )
    select
      x.id, x.confirmacion_id, v_proy_id, v_tipo, null, v_deshace, v_anio, v_huella, v_proy.calculado_at,
      case when jsonb_typeof(x.filtro) = 'object' then x.filtro else '{}'::jsonb end,
      v_resumen,
      case when jsonb_typeof(x.efecto_gm_previsto) = 'array' then x.efecto_gm_previsto else '[]'::jsonb end,
      coalesce(x.revision_confirmada, false), coalesce(x.propuestas_gm, '{}'::uuid[]), x.nota, x.perfil_id, x.usuario_nombre
    from jsonb_to_record(v_lote) as x(
      id uuid, confirmacion_id uuid, filtro jsonb, efecto_gm_previsto jsonb, revision_confirmada boolean,
      propuestas_gm uuid[], nota text, perfil_id uuid, usuario_nombre text
    );
  exception
    when unique_violation then
      select * into v_ex
        from public.proyeccion_lotes
       where id = v_lote_id;
      if not found then
        raise;
      end if;
      if v_ex.proyeccion_id is not distinct from v_proy_id and v_ex.huella_cuerpo = v_huella then
        return public.respuesta_lote_proyeccion(v_lote_id, true);
      end if;
      raise exception 'lote_ajeno' using errcode = 'DC004';
  end;

  return public.respuesta_lote_proyeccion(v_lote_id, false);
end;
$$;

revoke execute on function public.devolver_cola_larga(jsonb) from public, anon, authenticated;
grant execute on function public.devolver_cola_larga(jsonb) to service_role;

comment on function public.devolver_cola_larga(jsonb) is
  'M7 07h 0.20.0 (8.1 b): escribe un lote devolver_cola_larga (limpia la decision de registros de filas base aceptados tal cual: origen propuesta, decidido = propuesta_al_decidir = decidido_esperado, sin IA; con o sin lote; nunca manual) o revertir_cola_larga (deshace_lote_id: restaura exactamente la foto anterior en los que siguen sin decidir). Candado for no key update de la proyeccion antes de la idempotencia por lote.id (repetido o DC004). Estado DC001, calculo vivo DC002, calculado_at DC003, lote deshecho DC005. Pasada 1 for update en orden (fila_id, anio) y veredictos; pasada 2 update con la lista fija de 07g. Lineas con anterior y cabecera al final; resumen con la forma de 07g. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 4. Registro de esta migración (convención de la 0035: la última sentencia)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas (nombre, nota)
values ('0042_devolver_cola_larga', 'M7 07h 0.20.0: proyeccion_lote_filas.anterior, proyeccion_lotes.deshace_lote_id y devolver_cola_larga (devolver y deshacer la cola larga heredada)')
on conflict (nombre) do nothing;

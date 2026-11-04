-- 0036 · Candados de viajes y embarques: `for no key update` en lugar de `for update` (solo base de datos). Reemplaza SIETE funciones
-- (`create or replace`, misma firma, sin tablas ni columnas nuevas):
--   guardar_viaje, guardar_embarque, guardar_paquete, cambiar_estado_agrupador, asignar_viaje_compras (0034),
--   aplicar_movimiento_agrupador (0034) e importar_agrupadores.
-- Idempotente (`create or replace function`, `revoke`/`grant`/`comment` repetibles, registro con `on conflict do nothing`). Sin
-- `do $$ ... $$`. Sin `drop`, `delete`, `truncate` ni `update` a nivel de migración. Los cuerpos de las funciones no llevan comentarios
-- `--` (se aplican por `execute_sql` en trozos). Las siete siguen `security invoker`, `search_path` vacío, `revoke ... from public, anon,
-- authenticated` y `grant execute ... to service_role`. No hay tablas nuevas: no hay nada que activar en RLS.
--
-- EL HALLAZGO (40P01, encontrado por tests/integracion/concurrencia.int.test.ts): con un embarque DENTRO de un viaje y una compra
-- compartida, `asignar_viaje_compras` tomaba el viaje con `for update` y esperaba la compra; `aplicar_movimiento_agrupador` ya tenía
-- embarque y compra y, al final, insertaba eventos con `viaje_id`: la FK pide `for key share` sobre el viaje, que choca con el `for update`.
-- Postgres aborta a una de las dos con 40P01 (la otra termina bien; no queda nada a medias, pero la API lo vería como un 500 genérico).
--
-- LA REGLA. `for update` es el único modo que choca con `for key share` (el que toma una FK al insertar una fila hija) y existe solo para
-- proteger cambios de columnas CLAVE (el `id` al que apuntan las FK) o un borrado. En viajes y embarques la única columna clave es el `id`
-- (los índices únicos sobre `upper(codigo)` son de expresión y el código nunca cambia) y nada se borra: todas las escrituras de estas
-- funciones son de columnas no clave. `for no key update` da la misma exclusión entre escritores (choca con `no key update` y con
-- `update`) pero deja pasar el `key share` de las FK. Por eso: viajes y embarques de TODAS las funciones de agrupadores pasan a
-- `for no key update`. Las COMPRAS conservan `for update` (0025: cada función de escritura de compras toma la compra para comparar y
-- subir `revision`; ninguna espera un viaje ni un embarque con una compra tomada, así que no cierran ciclo).
--
-- AUDITORÍA. Los ciclos que la regla anterior cierra, todos reproducidos con tres o cuatro conexiones y una compuerta determinista en
-- tests/integracion/concurrencia.int.test.ts (antes de esta migración las cuatro daban 40P01; después, ninguna):
--   a. aplicar_movimiento_agrupador (embarque + compra, luego key share del viaje)    vs asignar_viaje_compras (viaje, luego compra);
--   b. cambiar_estado_agrupador de un embarque (embarque, luego key share del viaje)  vs guardar_embarque (viaje, luego embarque);
--   c. importar_agrupadores (candado `agrupador_codigo:embarque`, luego key share del viaje referido por código)
--                                                                                    vs guardar_embarque (viaje, luego ese candado);
--   d. importar_agrupadores (candado `agrupador_codigo:paquete`, luego key share del embarque referido por código)
--                                                                                    vs guardar_paquete (embarque, luego ese candado).
-- El orden global de candados no cambia: viajes (por id) -> embarques (por id) -> compras (por id). Solo cambia el MODO de los de viajes y
-- embarques. Con `no key update` ninguna función que ya sostiene un embarque o una compra espera a una que sostiene un viaje (el único
-- pedido sobre el viaje que hace es un `key share`, compatible), y nadie pide `no key update` o más sobre un viaje o un embarque que no
-- haya tomado ya por su cuenta; los candados consultivos (`agrupador_importar`, `agrupador_codigo:<tipo>`) se toman siempre después de
-- los de fila. Funciones de M8 fuera de agrupadores (importar_compra y las de 0025) solo toman compras y no cambian.


-- ---------------------------------------------------------------------------
-- 1. `guardar_viaje` (0032)
-- ---------------------------------------------------------------------------
-- Solo edita columnas no clave (nombre, destino, fechas, responsable, nota, revision) y solo espera al propio viaje, así que no puede ser parte de un ciclo; pasa a `for no key update` por coherencia y para no frenar a quien inserta un embarque, una compra o un evento que apunta a este viaje (su FK pide `key share`, que ya no choca). La exclusión entre quienes editan, cancelan o asignan sobre el viaje se mantiene: `no key update` choca con `no key update`.

create or replace function public.guardar_viaje(p_viaje jsonb, p_revision integer, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_id uuid := nullif(p_viaje ->> 'id', '')::uuid;
  v_nombre text := btrim(coalesce(p_viaje ->> 'nombre', ''));
  v_destino text := nullif(btrim(p_viaje ->> 'destino'), '');
  v_inicio date := nullif(p_viaje ->> 'fecha_inicio', '')::date;
  v_fin date := nullif(p_viaje ->> 'fecha_fin', '')::date;
  v_resp uuid := nullif(p_viaje ->> 'responsable_id', '')::uuid;
  v_nota text := nullif(btrim(p_viaje ->> 'nota'), '');
  v_codigo text := upper(btrim(coalesce(p_viaje ->> 'codigo', '')));
  v_viaje public.compra_viajes%rowtype;
  v_antes jsonb;
begin
  if v_id is null then
    if v_inicio is null then
      return jsonb_build_object('ok', false, 'motivo', 'fecha_requerida');
    end if;
    if v_fin is not null and v_fin < v_inicio then
      return jsonb_build_object('ok', false, 'motivo', 'fin_antes_de_inicio');
    end if;
    if v_resp is null or not public.agrupador_responsable_asignable(v_resp) then
      return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
    end if;
    if v_codigo = '' then
      v_codigo := public.agrupador_siguiente_codigo('viaje', v_inicio);
      if v_codigo is null then
        return jsonb_build_object('ok', false, 'motivo', 'correlativo_agotado');
      end if;
    else
      if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
      end if;
      if exists (select 1 from public.compra_viajes x where upper(x.codigo) = v_codigo) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
      end if;
    end if;
    begin
      insert into public.compra_viajes (
        codigo, nombre, destino, fecha_inicio, fecha_fin, responsable_id, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (v_codigo, v_nombre, v_destino, v_inicio, v_fin, v_resp, v_nota, v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
      returning * into v_viaje;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
    end;
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
    values (
      v_viaje.id, 'crear', null, to_jsonb(v_viaje),
      left(format('Viaje %s creado: %s', v_viaje.codigo, v_viaje.nombre), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'viaje_id', v_viaje.id, 'codigo', v_viaje.codigo, 'revision', v_viaje.revision, 'creado', true);
  end if;

  select * into v_viaje from public.compra_viajes where id = v_id for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if v_viaje.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if p_revision is null or v_viaje.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
  end if;
  if v_inicio is null then
    return jsonb_build_object('ok', false, 'motivo', 'fecha_requerida');
  end if;
  if v_fin is not null and v_fin < v_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'fin_antes_de_inicio');
  end if;
  if v_resp is distinct from v_viaje.responsable_id and (v_resp is null or not public.agrupador_responsable_asignable(v_resp)) then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;

  v_antes := to_jsonb(v_viaje);
  update public.compra_viajes
     set nombre = v_nombre,
         destino = v_destino,
         fecha_inicio = v_inicio,
         fecha_fin = v_fin,
         responsable_id = v_resp,
         nota = v_nota,
         revision = revision + 1,
         updated_by_id = v_perfil,
         updated_by_nombre = v_nombre_actor
   where id = v_id
   returning * into v_viaje;

  insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    v_viaje.id, 'editar', v_antes, to_jsonb(v_viaje),
    left(format('Viaje %s editado', v_viaje.codigo), 300), v_perfil, v_nombre_actor
  );
  return jsonb_build_object('ok', true, 'viaje_id', v_viaje.id, 'codigo', v_viaje.codigo, 'revision', v_viaje.revision, 'creado', false);
end;
$$;

revoke execute on function public.guardar_viaje(jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_viaje(jsonb, integer, jsonb) to service_role;

comment on function public.guardar_viaje(jsonb, integer, jsonb) is
  'M8 08b-1: crea (sin id, revision nula) o edita (con id y revision) un viaje. Codigo aamm## autonumerado con candado o escrito a mano (unico por upper). El responsable debe ser comprador o admin activo (solo se revalida si cambia). Deja evento crear o editar. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, responsable_no_asignable, fecha_requerida, fin_antes_de_inicio. Solo service_role. Candado del viaje: for no key update (0036).';

-- ---------------------------------------------------------------------------
-- 2. `guardar_embarque` (0032)
-- ---------------------------------------------------------------------------
-- Toma viajes (`v_viaje` y `v_viaje_ant`, por id) y después el embarque, y espera a este último con los viajes tomados: es quien cierra el ciclo con `cambiar_estado_agrupador` (que ya tiene el embarque y pide `key share` del viaje para su evento) si el viaje va con `for update`. Cambia el `viaje_id` del embarque (columna con FK, no clave del embarque) y nunca el `id` del viaje: `for no key update` en los dos. El UPDATE del embarque ya sube `no key update` por su cuenta.

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
  v_llegada date := nullif(p_embarque ->> 'fecha_llegada_estimada', '')::date;
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
        fecha_salida_estimada, fecha_llegada_estimada, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, v_tipo, v_viaje, v_resp, v_ref, v_puerto,
        v_salida, v_llegada, v_nota,
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
  if v_llegada is not null and v_llegada <> v_emb.fecha_llegada_estimada then
    return jsonb_build_object('ok', false, 'motivo', 'fecha_por_movimiento');
  end if;
  if v_resp is distinct from v_emb.responsable_id and v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;
  if v_salida is not null and v_salida > v_emb.fecha_llegada_estimada then
    return jsonb_build_object('ok', false, 'motivo', 'salida_despues_de_llegada');
  end if;

  v_antes := public.agrupador_foto_embarque(v_id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo);
  update public.compra_embarques
     set nombre = v_nombre,
         tipo = v_tipo,
         viaje_id = v_viaje,
         responsable_id = v_resp,
         referencia_logistica = v_ref,
         puerto_embarque = v_puerto,
         fecha_salida_estimada = v_salida,
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
  'M8 08b-1: crea o edita un embarque. Edita todo menos fecha_llegada_estimada (va por aplicar_movimiento_agrupador: fecha_por_movimiento). Bloquea viajes y luego el embarque. local sin viaje, salida <= llegada, viaje cancelado bloquea y cerrado avisa. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, responsable_no_asignable, fecha_por_movimiento, salida_despues_de_llegada, local_con_viaje, viaje_cancelado, fecha_requerida. Solo service_role. Candados: viajes y embarque con for no key update (0036), para no chocar con el key share de las FK de quien ya tiene el embarque.';

-- ---------------------------------------------------------------------------
-- 3. `guardar_paquete` (0032)
-- ---------------------------------------------------------------------------
-- Toma el embarque y después pide el candado consultivo `agrupador_codigo:paquete`. `importar_agrupadores` puede tener ese candado y estar esperando el `key share` del embarque para insertar un paquete que apunta a él por código: con `for update` en el embarque, ciclo. Solo cambia `revision`, `updated_by_*` y filas de paquetes: `for no key update`.

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
      v_codigo := public.agrupador_siguiente_codigo('paquete', v_emb.periodo_llegada);
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
  'M8 08b-1: crea o edita un paquete de un embarque. Bloquea el embarque, compara su revision (cubre a sus paquetes) y la sube. El embarque debe estar planificado o en transito. Codigo con el mes de periodo_llegada. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, embarque_no_editable, responsable_no_asignable. Solo service_role. Candado del embarque: for no key update (0036).';

-- ---------------------------------------------------------------------------
-- 4. `cambiar_estado_agrupador` (0032)
-- ---------------------------------------------------------------------------
-- Viaje: cambia `estado` y `revision` (no clave); no espera nada más, `for no key update`. Embarque y paquete: sostiene el embarque y al final inserta un evento con `viaje_id` (`key share` del viaje), lo que lo hacía víctima del `for update` de `guardar_embarque`, `asignar_viaje_compras` e `importar_agrupadores`; también `for no key update`. Un paquete nunca cambia de embarque aquí.

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
  'M8 08b-1 (R13): cambia el estado de un viaje (cerrar, reabrir, cancelar), un embarque (en_transito, volver_a_planificado, cancelar) o un paquete (cancelar). Cancelar exige motivo y que no quede nada activo (viaje: compras o embarques sin cancelar; embarque: recepciones vinculadas o asignaciones activas; paquete: asignaciones activas). Para un paquete, p_revision es la del embarque. Motivos: agrupador_cambio, no_encontrado, transicion_invalida, tiene_asignaciones_activas, tiene_compras, tiene_recepciones, motivo_requerido. Solo service_role. Candados de viaje y embarque: for no key update (0036); su evento pide key share del viaje.';

-- ---------------------------------------------------------------------------
-- 5. `asignar_viaje_compras` (0034)
-- ---------------------------------------------------------------------------
-- El caso del hallazgo. Toma viajes (por id) y después compras (por id): con un embarque dentro del viaje y una compra compartida, `aplicar_movimiento_agrupador` ya tenía embarque y compra y al final insertaba su evento con `viaje_id` (`key share` del viaje) contra el `for update` de esta función, que esperaba esa compra: 40P01. Con `for no key update` el viaje se sigue serializando entre escritores, pero el `key share` pasa. Las compras se quedan con `for update`: la función compara y sube `compras.revision` y debe excluir a cualquier otro escritor de la compra.

create or replace function public.asignar_viaje_compras(p_viaje uuid, p_compras jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_viaje public.compra_viajes%rowtype;
  v_ids uuid[];
  v_viajes uuid[];
  v_n integer;
  v_c public.compras%rowtype;
  v_item record;
  v_antes jsonb;
  v_rev integer;
  v_res jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_cambios jsonb := '[]'::jsonb;
  v_ev record;
  v_items jsonb;
begin
  if p_compras is null or jsonb_typeof(p_compras) <> 'array' or jsonb_array_length(p_compras) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'revision', q.revision) order by q.id, q.revision), '[]'::jsonb) into v_items
    from (select distinct x.id, x.revision from jsonb_to_recordset(p_compras) as x(id uuid, revision integer)) q;

  select coalesce(array_agg(distinct x.id order by x.id), '{}'::uuid[]) into v_ids
    from jsonb_to_recordset(v_items) as x(id uuid, revision integer);

  select coalesce(array_agg(distinct v), '{}'::uuid[]) into v_viajes
    from (
      select p_viaje as v
      union all
      select c.viaje_id from public.compras c where c.id = any (v_ids)
    ) q
   where v is not null;

  perform 1 from public.compra_viajes v where v.id = any (v_viajes) order by v.id for no key update;

  if p_viaje is not null then
    select * into v_viaje from public.compra_viajes where id = p_viaje;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if v_viaje.estado = 'cancelado' then
      return jsonb_build_object('ok', false, 'motivo', 'viaje_cancelado');
    end if;
    if v_viaje.estado = 'cerrado' then
      v_avisos := jsonb_build_array(jsonb_build_object('codigo', 'viaje_cerrado', 'viaje', v_viaje.codigo));
    end if;
  end if;

  perform 1 from public.compras c where c.id = any (v_ids) order by c.id for update;
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_ids) then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_items) as x(id uuid, revision integer)
    join public.compras c on c.id = x.id
    where c.revision is distinct from x.revision
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if exists (select 1 from public.compras c where c.id = any (v_ids) and c.estado = 'cancelada') then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;

  for v_item in
    select distinct x.id from jsonb_to_recordset(v_items) as x(id uuid, revision integer) order by x.id
  loop
    select * into v_c from public.compras where id = v_item.id;
    if v_c.viaje_id is not distinct from p_viaje then
      v_res := v_res || jsonb_build_array(jsonb_build_object('id', v_c.id, 'revision', v_c.revision));
      continue;
    end if;
    v_antes := public.compra_foto(v_c.id) || public.compra_foto_entregas(v_c.id);
    update public.compras
       set viaje_id = p_viaje, revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = v_c.id
     returning revision into v_rev;
    insert into public.compra_eventos (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      v_c.id, null, 'asignar_viaje', v_antes, public.compra_foto(v_c.id) || public.compra_foto_entregas(v_c.id), null,
      case when p_viaje is null then 'Viaje quitado de la compra' else left(format('Viaje %s asignado a la compra', v_viaje.codigo), 300) end,
      v_perfil, v_nombre_actor
    );
    v_res := v_res || jsonb_build_array(jsonb_build_object('id', v_c.id, 'revision', v_rev));
    v_cambios := v_cambios || jsonb_build_array(
      jsonb_build_object('compra_id', v_c.id, 'revision_nueva', v_rev, 'viaje_antes', v_c.viaje_id)
    );
  end loop;

  if p_viaje is not null and jsonb_array_length(v_cambios) > 0 then
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, compras, perfil_id, usuario_nombre)
    values (
      p_viaje, 'asignar_viaje', null, null,
      left(format('%s compra(s) asignadas al viaje', jsonb_array_length(v_cambios)), 300),
      (select jsonb_agg(jsonb_build_object('compra_id', x -> 'compra_id', 'revision_nueva', x -> 'revision_nueva'))
         from jsonb_array_elements(v_cambios) x),
      v_perfil, v_nombre_actor
    );
  end if;

  for v_ev in
    select (x ->> 'viaje_antes')::uuid as viaje_id,
           jsonb_agg(jsonb_build_object('compra_id', x -> 'compra_id', 'revision_nueva', x -> 'revision_nueva')) as compras
      from jsonb_array_elements(v_cambios) x
     where nullif(x ->> 'viaje_antes', '') is not null
     group by 1
  loop
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, compras, perfil_id, usuario_nombre)
    values (
      v_ev.viaje_id, 'asignar_viaje', null, null,
      left(format('%s compra(s) %s', jsonb_array_length(v_ev.compras), case when p_viaje is null then 'sin este viaje' else 'pasadas a otro viaje' end), 300),
      v_ev.compras, v_perfil, v_nombre_actor
    );
  end loop;

  return jsonb_build_object('ok', true, 'viaje_id', p_viaje, 'compras', v_res, 'avisos', v_avisos);
end;
$$;

revoke execute on function public.asignar_viaje_compras(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.asignar_viaje_compras(uuid, jsonb, jsonb) to service_role;

comment on function public.asignar_viaje_compras(uuid, jsonb, jsonb) is
  'M8 08b-1 + correcciones (0034): pone o quita el viaje de compras [{id, revision}]. Deduplica ids repetidos. Bloquea viajes y luego compras, compara revision (compra_cambio), sube la revision y deja evento asignar_viaje por compra y por viaje (el nuevo y cada viaje de origen). Viaje cerrado acepta con aviso viaje_cerrado; cancelado bloquea. Compra cancelada: no_editable. Solo service_role. Candado de los viajes: for no key update (0036); las compras siguen con for update.';

-- ---------------------------------------------------------------------------
-- 6. `aplicar_movimiento_agrupador` (0034)
-- ---------------------------------------------------------------------------
-- Toma embarques (por id) y después compras (por id), y pide `key share` del viaje (evento del embarque) y de los embarques (asignaciones y paquetes que apuntan a ellos). Sus embarques pasan a `for no key update`: solo cambia `revision`, `updated_by_*` y `fecha_llegada_estimada` (no clave), y así no choca con `importar_agrupadores`, que inserta paquetes por código sin bloquear el embarque. NO bloquea viajes (a propósito: ninguna función espera un viaje con embarque o compra tomados). Las compras se quedan con `for update`, como en 0025.

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
  v_resumen text := left(coalesce(nullif(btrim(p_plan ->> 'resumen'), ''), p_plan ->> 'operacion'), 300);
  v_movs jsonb := coalesce(p_plan -> 'movimientos', '[]'::jsonb);
  v_pm jsonb := p_plan -> 'paquete_a_mover';
  v_pm_id uuid;
  v_pm_dest uuid;
  v_pm_orig uuid;
  v_pm_estado text;
  v_emb_ids uuid[];
  v_compra_ids uuid[];
  v_lineas uuid[];
  v_n integer;
  v_cf_id uuid;
  v_cf_fecha date;
  v_antes_f jsonb := '{}'::jsonb;
  v_antes_x jsonb := '{}'::jsonb;
  v_desp_x jsonb;
  v_antes_e jsonb := '{}'::jsonb;
  v_id uuid;
  v_res jsonb;
  v_dest uuid[];
  v_rev integer;
  v_accion_compra text;
  v_res_c jsonb := '[]'::jsonb;
  v_res_e jsonb := '[]'::jsonb;
begin
  begin
    if v_op is null or v_op not in ('asignar', 'quitar', 'mover_a_paquete', 'cambiar_fecha', 'pasar_pendientes', 'mover_paquete') then
      raise exception 'plan invalido: operacion desconocida' using errcode = 'AG002';
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

    if v_op in ('asignar', 'mover_a_paquete', 'cambiar_fecha', 'mover_paquete')
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
    if v_op in ('cambiar_fecha', 'mover_paquete', 'pasar_pendientes') and v_motivo is null then
      raise exception 'motivo_requerido' using errcode = 'AG001';
    end if;

    if v_op = 'cambiar_fecha' then
      select (x ->> 'id')::uuid, (x ->> 'fecha_llegada_estimada')::date into v_cf_id, v_cf_fecha
        from jsonb_array_elements(p_plan -> 'embarques') x
       where nullif(x ->> 'fecha_llegada_estimada', '') is not null
       limit 1;
      if v_cf_id is null then
        raise exception 'plan invalido: cambiar_fecha sin fecha' using errcode = 'AG002';
      end if;
      if exists (select 1 from public.compra_embarques e where e.id = v_cf_id and e.fecha_salida_estimada > v_cf_fecha) then
        raise exception 'salida_despues_de_llegada' using errcode = 'AG001';
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
    end if;

    if v_op = 'cambiar_fecha' and exists (
      select 1
      from public.compra_embarques e
      where e.id = v_cf_id
        and make_date(
              extract(year from coalesce(e.fecha_llegada_real, v_cf_fecha))::integer,
              extract(month from coalesce(e.fecha_llegada_real, v_cf_fecha))::integer,
              1
            ) <> e.periodo_llegada
    ) and exists (
      select 1
      from public.compra_linea_recepciones r
      join public.compra_entrega_asignaciones a on a.id = r.asignacion_id
      where a.embarque_id = v_cf_id
    ) then
      raise exception 'embarque_con_recepciones' using errcode = 'AG001';
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
         set fecha_llegada_estimada = v_cf_fecha
       where id = v_cf_id;
    end if;
    if jsonb_typeof(v_pm) = 'object' then
      update public.compra_paquetes
         set embarque_id = v_pm_dest, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
       where id = v_pm_id;
    end if;

    v_res := public.agrupador_mover_entregas(v_movs, coalesce(p_plan -> 'repartos', '[]'::jsonb), p_actor);
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_dest
      from jsonb_array_elements_text(v_res -> 'asignaciones_destino') x;

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
    if v_op in ('asignar', 'cambiar_fecha', 'mover_paquete', 'pasar_pendientes') and exists (
      select 1
      from public.compra_entrega_asignaciones a
      join public.compra_linea_entregas e on e.id = a.entrega_id
      join public.compra_embarques b on b.id = a.embarque_id
      where a.id = any (v_dest)
        and e.periodo <> b.periodo_llegada
    ) then
      raise exception 'invariante I2: una asignacion que recibio unidades no queda en el mes de llegada de su embarque' using errcode = 'AG002';
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
      insert into public.compra_agrupador_eventos (embarque_id, viaje_id, paquete_id, accion, antes, despues, motivo, resumen, compras, perfil_id, usuario_nombre)
      select
        v_id, e.viaje_id, v_pm_id,
        coalesce(nullif(p_plan ->> 'accion', ''), v_op),
        v_antes_e -> (v_id::text), public.agrupador_foto_embarque(v_id),
        left(v_motivo, 300), v_resumen,
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
  'M8 08b-1 + correcciones (0034): aplica un plan de movimiento (asignar, quitar, mover_a_paquete, cambiar_fecha, pasar_pendientes, mover_paquete) en una transaccion. Bloquea embarques y compras en orden y compara la revision de TODAS las del plan (agrupador_cambio, compra_cambio), comprueba pertenencia y estados, ejecuta los movimientos con agrupador_mover_entregas y verifica I1 a I3 e I2. Sube revision y deja evento SOLO en las compras cuya compra_foto_entregas cambio (entregas, repartos o asignaciones); compras en la respuesta = solo las tocadas. Todo rechazo deshace lo escrito y devuelve { ok: false, motivo }. Solo service_role. Candado de los embarques: for no key update (0036); las compras siguen con for update.';

-- ---------------------------------------------------------------------------
-- 7. `importar_agrupadores` (0032)
-- ---------------------------------------------------------------------------
-- Toma el candado consultivo `agrupador_importar`, viajes y embarques existentes (por id) y luego inserta, pidiendo los candados `agrupador_codigo:<tipo>` y el `key share` de viajes y embarques referidos por CÓDIGO (esos no los bloquea). Con `for update` en los viajes y embarques, `guardar_embarque` y `guardar_paquete` (que tienen el viaje o el embarque y esperan el candado del código que tiene esta función) formaban ciclo con ella. Solo inserta filas nuevas que apuntan a viajes y embarques: `for no key update` en ambos mantiene la exclusión frente a quien los cancela o edita. Pendiente para backend: los viajes y embarques referidos por código siguen sin candado (como antes).

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
        fecha_salida_estimada, fecha_llegada_estimada, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, v_tipo_emb, v_viaje_id, v_resp, nullif(btrim(v_it ->> 'referencia_logistica'), ''),
        nullif(btrim(v_it ->> 'puerto_embarque'), ''), v_salida, v_llegada, nullif(btrim(v_it ->> 'nota'), ''),
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
      v_ref := v_emb.periodo_llegada;
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
  'M8 08b-1 (3.11, decision 97): crea viajes, embarques y paquetes de un lote (solo filas nuevas) en una transaccion, todo o nada, bajo el candado agrupador_importar. Reserva primero los codigos escritos y autonumera despues en orden de fila. Vuelve a comprobar cada clave (clave_existente: no duplica; aplicar dos veces el mismo lote no crea nada la segunda vez) y cada referencia. Solo crea: nunca edita, mueve ni asigna compras. Deja un evento crear por agrupador. Devuelve { ok, creados[] } o { ok: false, motivo, tipo, fila }. Solo service_role. Candados de viajes y embarques existentes: for no key update (0036).';


-- ---------------------------------------------------------------------------
-- 8. Registro de esta migración (convención de la 0035: la última sentencia)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas(nombre) values ('0036_candados_viajes') on conflict do nothing;

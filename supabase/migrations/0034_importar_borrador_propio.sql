-- 0034 · Correcciones de 08b-1 tras QA y seguridad (solo base de datos). Reemplaza TRES funciones (`create or replace`, misma firma,
-- sin tablas ni columnas nuevas):
--   1. `importar_compra` (0025): un actor RESTRINGIDO (comprador) solo puede agregar líneas a una compra existente si está en
--      `borrador` Y es suya; si no, devuelve `compra_no_borrador` sin escribir nada (A1/A2, bloqueante de seguridad).
--   2. `aplicar_movimiento_agrupador` (0032): sigue bloqueando y comparando la revisión de TODAS las compras del plan, pero sube
--      `revision` y escribe `compra_eventos` solo en las compras cuyo estado de entregas realmente cambió (M1, QA).
--   3. `asignar_viaje_compras` (0032): deduplica `p_compras` (B2) y deja también un evento en el viaje de ORIGEN al mover una
--      compra de un viaje a otro (B3).
-- Idempotente (`create or replace function`, `revoke`/`grant`/`comment` repetibles). Sin `do $$ ... $$`. Sin `drop`, `delete`,
-- `truncate` ni `update` a nivel de migración. Los cuerpos de las funciones no llevan comentarios `--`: se aplican por `execute_sql`
-- en trozos y el humo (`scripts/humo-0034.sql`) lo comprueba. Las tres siguen `security invoker`, `search_path` vacío, `revoke ... from
-- public, anon, authenticated` y `grant execute ... to service_role`. No hay tablas nuevas: no hay nada que activar en RLS.

-- ---------------------------------------------------------------------------
-- 1. `importar_compra`: el comprador solo agrega a su propio borrador (cambio 1, A1/A2)
-- ---------------------------------------------------------------------------
-- Cómo se activa la restricción (contrato con backend). El actor del RPC (`p_actor`) es `{ perfil_id, nombre }`; el backend añade
-- `restringido: true` cuando quien llama es comprador (`requireUser` con rol `comprador`) y lo omite (o manda `false`) para admin y
-- planner. Además la función se defiende sola, como última barrera: si el `perfil_id` del actor es un perfil con rol `comprador`, la
-- restricción se aplica aunque el backend olvide la clave. La clave solo puede AÑADIR restricción (un comprador con `restringido:
-- false` sigue restringido); nunca la quita. La firma no cambia.
-- Regla: solo cuenta cuando la compra YA EXISTE (mismo proveedor y referencia, sin cancelar). Se acepta únicamente si
-- `estado = 'borrador'` y `perfil_id = actor` (un borrador sin dueño, por perfil borrado, o un actor sin perfil, se rechazan). Si no,
-- `{ ok: false, motivo: 'compra_no_borrador' }` y no se escribe nada: el rechazo ocurre antes de crear el proveedor, la compra o las
-- líneas, igual que `saldo_cerrado`. Orden de motivos: `saldo_cerrado` (saldo cerrado de una compra recibida) va antes. Una compra
-- cancelada no entra en la búsqueda (`estado <> 'cancelada'`): no se agrega a ella y se crea una nueva, como hasta ahora. Compra
-- NUEVA: sin cambios (el comprador crea la suya; su estado y origen los fija el backend).
-- El resto de la función, incluidos los motivos y la forma de la respuesta, es idéntico a 0025.

create or replace function public.importar_compra(p_compra jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre text := nullif(p_actor ->> 'nombre', '');
  v_prov_id uuid := nullif(p_compra ->> 'proveedor_id', '')::uuid;
  v_prov_nombre text := nullif(btrim(p_compra ->> 'proveedor_nombre'), '');
  v_prov_activo boolean;
  v_prov_creado boolean := false;
  v_referencia text := nullif(btrim(p_compra ->> 'referencia'), '');
  v_estado_nuevo text := coalesce(nullif(p_compra ->> 'estado', ''), 'confirmada');
  v_restringido boolean := coalesce(p_actor ->> 'restringido', '') = 'true';
  v_compra public.compras%rowtype;
  v_existia boolean := false;
  v_compra_id uuid;
  v_antes jsonb;
  v_estado text;
  v_revision integer;
  v_numero text;
  v_l jsonb;
  v_linea_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_unidades bigint := 0;
  v_n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('vector2:importar_compra', 0));

  if not v_restringido and v_perfil is not null then
    select exists (select 1 from public.perfiles pf where pf.id = v_perfil and pf.rol = 'comprador') into v_restringido;
  end if;

  if p_compra -> 'lineas' is null
     or jsonb_typeof(p_compra -> 'lineas') <> 'array'
     or jsonb_array_length(p_compra -> 'lineas') = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_lineas');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_compra -> 'lineas') l
    where coalesce(
            (select sum((e ->> 'unidades')::integer) from jsonb_array_elements(l -> 'entregas') e),
            0
          ) <> (l ->> 'unidades')::integer
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'entregas_no_cuadran');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_compra -> 'lineas') l
    where coalesce(
            (select sum((x ->> 'unidades')::integer) from jsonb_array_elements(l -> 'recepciones') x),
            0
          ) > (l ->> 'unidades')::integer
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'excede_pendiente');
  end if;

  if exists (
    select 1
    from (
      select l ->> 'clave_importacion' as clave
      from jsonb_array_elements(p_compra -> 'lineas') l
      where nullif(l ->> 'clave_importacion', '') is not null
    ) k
    group by k.clave
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'clave_existente');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_compra -> 'lineas') l
    join public.compra_lineas cl on cl.clave_importacion = (l ->> 'clave_importacion')
    join public.compras c on c.id = cl.compra_id and c.estado <> 'cancelada'
    where nullif(l ->> 'clave_importacion', '') is not null
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'clave_existente');
  end if;

  if v_prov_id is not null then
    select p.activo into v_prov_activo from public.proveedores p where p.id = v_prov_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'proveedor_inexistente');
    end if;
  elsif v_prov_nombre is not null then
    select p.id, p.activo into v_prov_id, v_prov_activo
    from public.proveedores p
    where upper(p.nombre) = upper(v_prov_nombre);
  else
    return jsonb_build_object('ok', false, 'motivo', 'proveedor_requerido');
  end if;

  if v_prov_id is not null and not v_prov_activo then
    return jsonb_build_object('ok', false, 'motivo', 'proveedor_inactivo');
  end if;

  if v_prov_id is not null and v_referencia is not null then
    select * into v_compra
    from public.compras c
    where c.proveedor_id = v_prov_id
      and upper(btrim(c.referencia)) = upper(v_referencia)
      and c.estado <> 'cancelada'
    order by c.created_at, c.id
    limit 1
    for update;
    v_existia := found;
    if v_existia and v_compra.cancelada_at is not null then
      return jsonb_build_object('ok', false, 'motivo', 'saldo_cerrado');
    end if;
    if v_existia
       and v_restringido
       and (v_compra.estado <> 'borrador' or v_perfil is null or v_compra.perfil_id is distinct from v_perfil) then
      return jsonb_build_object('ok', false, 'motivo', 'compra_no_borrador');
    end if;
  end if;

  if v_prov_id is null then
    insert into public.proveedores (nombre, es_intercompany, perfil_id, usuario_nombre)
    values (v_prov_nombre, coalesce((p_compra ->> 'proveedor_es_intercompany')::boolean, false), v_perfil, v_nombre)
    returning id into v_prov_id;
    v_prov_creado := true;
  end if;

  if v_existia then
    v_compra_id := v_compra.id;
    v_numero := v_compra.numero;
    v_antes := public.compra_foto(v_compra_id);
  else
    insert into public.compras (
      proveedor_id, origen, estado, fecha_compra, referencia, moneda, nota,
      confirmada_at, confirmada_por_id, confirmada_por_nombre,
      perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
    )
    values (
      v_prov_id,
      coalesce(nullif(p_compra ->> 'origen', ''), 'carga_inicial'),
      v_estado_nuevo,
      (p_compra ->> 'fecha_compra')::date,
      v_referencia,
      coalesce(nullif(p_compra ->> 'moneda', ''), 'PEN'),
      nullif(p_compra ->> 'nota', ''),
      case when v_estado_nuevo = 'borrador' then null else now() end,
      case when v_estado_nuevo = 'borrador' then null else v_perfil end,
      case when v_estado_nuevo = 'borrador' then null else v_nombre end,
      v_perfil, v_nombre, v_perfil, v_nombre
    )
    returning id, numero into v_compra_id, v_numero;
    v_antes := null;
  end if;

  for v_l in select value from jsonb_array_elements(p_compra -> 'lineas') loop
    insert into public.compra_lineas (
      compra_id, tipo, genero_mundo_linea_id, equivalencia_id, marca_id, agrupacion_marca_id, tallas,
      unidades, costo_unitario, llegada_periodo, destino, tienda_id, alcance,
      clave_importacion, huella_importacion, nota, avisos
    )
    values (
      v_compra_id,
      coalesce(nullif(v_l ->> 'tipo', ''), 'especifica'),
      nullif(v_l ->> 'genero_mundo_linea_id', '')::uuid,
      nullif(v_l ->> 'equivalencia_id', '')::uuid,
      nullif(v_l ->> 'marca_id', '')::uuid,
      nullif(v_l ->> 'agrupacion_marca_id', '')::uuid,
      coalesce(nullif(v_l ->> 'tallas', ''), 'ambas'),
      (v_l ->> 'unidades')::integer,
      nullif(v_l ->> 'costo_unitario', '')::numeric,
      (select min((e ->> 'periodo')::date) from jsonb_array_elements(v_l -> 'entregas') e),
      coalesce(nullif(v_l ->> 'destino', ''), 'cd'),
      nullif(v_l ->> 'tienda_id', '')::uuid,
      case when jsonb_typeof(v_l -> 'alcance') = 'object' then v_l -> 'alcance' else '{}'::jsonb end,
      nullif(v_l ->> 'clave_importacion', ''),
      nullif(v_l ->> 'huella_importacion', ''),
      nullif(v_l ->> 'nota', ''),
      case when jsonb_typeof(v_l -> 'avisos') = 'array' then v_l -> 'avisos' else '[]'::jsonb end
    )
    returning id into v_linea_id;

    insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen)
    select v_linea_id, (e ->> 'periodo')::date, (e ->> 'unidades')::integer, coalesce(nullif(e ->> 'origen', ''), 'importada')
    from jsonb_array_elements(v_l -> 'entregas') e;

    insert into public.compra_linea_repartos (
      linea_id, entrega_id, marca_id, genero_mundo_linea_id, equivalencia_id, unidades,
      reparto_id, reparto_version, temporada, error_reparto_pp
    )
    select
      v_linea_id,
      en.id,
      (r ->> 'marca_id')::uuid,
      (r ->> 'genero_mundo_linea_id')::uuid,
      nullif(r ->> 'equivalencia_id', '')::uuid,
      (r ->> 'unidades')::integer,
      nullif(r ->> 'reparto_id', '')::uuid,
      nullif(r ->> 'reparto_version', '')::integer,
      nullif(r ->> 'temporada', ''),
      nullif(r ->> 'error_reparto_pp', '')::numeric
    from jsonb_array_elements(v_l -> 'repartos') r
    left join public.compra_linea_entregas en
      on en.linea_id = v_linea_id and en.periodo = (r ->> 'entrega_periodo')::date;

    insert into public.compra_linea_recepciones
      (linea_id, recibida_periodo, unidades, fecha_recepcion, origen, perfil_id, usuario_nombre, nota)
    select v_linea_id, (x ->> 'recibida_periodo')::date, (x ->> 'unidades')::integer, (x ->> 'fecha_recepcion')::date,
           'importada', v_perfil, v_nombre, nullif(x ->> 'nota', '')
    from jsonb_array_elements(v_l -> 'recepciones') x;

    v_ids := v_ids || jsonb_build_array(
      jsonb_build_object('clave_importacion', nullif(v_l ->> 'clave_importacion', ''), 'linea_id', v_linea_id)
    );
    v_unidades := v_unidades + (v_l ->> 'unidades')::integer;
    v_n := v_n + 1;
  end loop;

  v_estado := public.compra_recalcular_estado(v_compra_id);

  if v_existia then
    update public.compras
    set revision = revision + 1,
        updated_by_id = v_perfil,
        updated_by_nombre = v_nombre
    where id = v_compra_id
    returning revision into v_revision;
  else
    select c.revision into v_revision from public.compras c where c.id = v_compra_id;
  end if;

  insert into public.compra_eventos
    (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
  values (
    v_compra_id,
    null,
    'importar',
    v_antes,
    public.compra_foto(v_compra_id) || jsonb_build_object('importado', v_ids),
    null,
    format('Importada%s: %s linea(s) nueva(s), %s u', case when v_existia then ' en compra existente' else '' end, v_n, v_unidades),
    v_perfil,
    v_nombre
  );

  return jsonb_build_object(
    'ok', true,
    'compra_id', v_compra_id,
    'numero', v_numero,
    'revision', v_revision,
    'estado', v_estado,
    'creada', not v_existia,
    'proveedor_id', v_prov_id,
    'proveedor_creado', v_prov_creado,
    'lineas', v_ids
  );
end;
$$;

revoke execute on function public.importar_compra(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.importar_compra(jsonb, jsonb) to service_role;

comment on function public.importar_compra(jsonb, jsonb) is
  'M8 0.13.0 + 08b-1 correcciones (0034): importa UNA compra en una transaccion bajo un candado consultivo global. Si el actor es restringido (p_actor ->> restringido = true, o su perfil es comprador), solo agrega lineas a una compra existente en borrador y propia (perfil_id = actor); si no devuelve compra_no_borrador sin escribir nada. Admin y planner agregan a cualquier compra viva. Motivos: sin_lineas, entregas_no_cuadran, excede_pendiente, clave_existente, proveedor_requerido, proveedor_inexistente, proveedor_inactivo, saldo_cerrado, compra_no_borrador. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 2. `asignar_viaje_compras`: ids repetidos y evento en el viaje de origen (cambios 3 y 4, B2 y B3)
-- ---------------------------------------------------------------------------
-- B2: un `id` repetido en `p_compras` ya no da `compra_cambio` espurio: se deduplica por `(id, revision)` antes de bloquear, comparar y
-- escribir (la compra se procesa una vez y sale una vez en `compras`). Si el mismo `id` llega con DOS revisiones distintas, una no
-- coincide con la base y sigue siendo `compra_cambio` (vista vencida).
-- B3: al mover compras de un viaje A a un viaje B queda un evento `asignar_viaje` en B (compras que entraron) y otro en cada A de
-- origen (compras que salieron, resumen «pasadas a otro viaje»). Quitar el viaje (`p_viaje` nulo) deja un evento por viaje de origen,
-- como antes. Los viajes de origen ya estaban bloqueados. Sin cambios de firma ni de respuesta.

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

  perform 1 from public.compra_viajes v where v.id = any (v_viajes) order by v.id for update;

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
  'M8 08b-1 + correcciones (0034): pone o quita el viaje de compras [{id, revision}]. Deduplica ids repetidos. Bloquea viajes y luego compras, compara revision (compra_cambio), sube la revision y deja evento asignar_viaje por compra y por viaje (el nuevo y cada viaje de origen). Viaje cerrado acepta con aviso viaje_cerrado; cancelado bloquea. Compra cancelada: no_editable. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 3. `aplicar_movimiento_agrupador`: revision y evento solo en las compras tocadas (cambio 2, M1)
-- ---------------------------------------------------------------------------
-- Criterio de «compra tocada» (M1). La función sigue exigiendo que el plan liste todas las compras con asignación activa en sus
-- embarques, las bloquea y compara su revisión (compra_cambio) sin excepción. Lo que cambia es la escritura final: antes de mover se
-- toma `compra_foto_entregas(c)` de cada compra del plan (entregas con id, mes, unidades y origen; repartos resumidos por entrega;
-- asignaciones con id, entrega, embarque, paquete y unidades) y al terminar se vuelve a tomar. Una compra está TOCADA si ambas fotos
-- difieren, es decir, si cambió el `entrega_id` o las `unidades` de alguna asignación, se creó, borró o movió una asignación (también
-- de paquete o de embarque), o cambió una entrega (mes, unidades, alta o baja) o su reparto. Solo las tocadas llaman a
-- `compra_recalcular_estado`, suben `compras.revision` en 1 (I5), dejan su evento en `compra_eventos` y salen en `compras` de la
-- respuesta y en `compras` del evento del embarque. Las no tocadas conservan su revisión: no se rompe ninguna vista abierta.
-- Cambio de contrato: `compras` de la respuesta ya NO tiene una entrada por cada compra del plan, sino solo las tocadas (puede ser
-- una lista vacía). Las revisiones de los embarques y sus eventos no cambian.
-- Se conserva la firma, `agrupador_mover_entregas` y todos los motivos.

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

    perform 1 from public.compra_embarques e where e.id = any (v_emb_ids) order by e.id for update;
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
  'M8 08b-1 + correcciones (0034): aplica un plan de movimiento (asignar, quitar, mover_a_paquete, cambiar_fecha, pasar_pendientes, mover_paquete) en una transaccion. Bloquea embarques y compras en orden y compara la revision de TODAS las del plan (agrupador_cambio, compra_cambio), comprueba pertenencia y estados, ejecuta los movimientos con agrupador_mover_entregas y verifica I1 a I3 e I2. Sube revision y deja evento SOLO en las compras cuya compra_foto_entregas cambio (entregas, repartos o asignaciones); compras en la respuesta = solo las tocadas. Todo rechazo deshace lo escrito y devuelve { ok: false, motivo }. Solo service_role.';

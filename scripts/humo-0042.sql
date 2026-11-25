-- Humo SQL de la migración 0042 (M7 07h, entrega previa 0.20.0 · M7 i: devolver a la propuesta la cola larga heredada y deshacerlo):
--   * estructura: `proyeccion_lote_filas.anterior` (jsonb nulo, check de objeto), `proyeccion_lotes.deshace_lote_id` (uuid nulo, FK
--     restrict no diferible, índice, check «no nulo ⇒ tipo revertir_*»), el check de la 0031 de `revierte_lote_id` intacto, ningún
--     check de catálogo nuevo sobre `tipo`, la función (security invoker, search_path vacío, sin `--` en el cuerpo, misma lista fija de
--     26 columnas que 07g, execute solo para service_role) y el registro en `migraciones_aplicadas`;
--   * caso G de la ficha (§6.1) en los dos años: dos registros aceptados «tal cual» en 400 (uno sin lote y otro con lote de 07g) se
--     devuelven a la propuesta; el `manual` en 350 y la propuesta editada quedan intactos (`cambiada_despues`); el `Y+1` que B2
--     recalcula se escribe sin tocar su decisión; líneas con `anterior`; `resumen` con la forma de 07g;
--   * idempotencia: mismo lote -> `repetido` sin cambios; mismo id con otra huella -> DC004; un lote nuevo sobre lo ya devuelto ->
--     `cambiada_despues` (nada que devolver);
--   * rechazos: proyección cerrada (DC001), cálculo vivo (DC002), `calculado_at` (DC003), no encontrada (DC006), payload inválido
--     (DC007, sin escribir nada), `updated_at` desfasado (`cambio_concurrente`), cifra distinta de la vista (`cambiada_despues`);
--   * deshacer (`revertir_cola_larga`): restaura EXACTAMENTE lo anterior (decidido, origen, propuesta_al_decidir, autor, fecha y el
--     lote de 07g), no pisa lo decidido después (`cambiada_despues`), dos veces -> `ya_revertida`, un set distinto de `anterior` ->
--     DC007, un lote que no es `devolver_cola_larga` -> DC005, una fila que no se devolvió -> DC009;
--   * inmutabilidad de lo nuevo (el trigger de la 0031 rechaza cambiar `anterior` o `deshace_lote_id`) y privilegios (anon y
--     authenticated sin execute ni acceso; service_role ejecuta);
--   * la parte de esquema de la migración repetida dentro del humo no falla (la doble pasada completa la hace el validador local).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0042.sql"   (o bash scripts/correr-humos.sh scripts/humo-0042.sql)
-- Al final imprime la lista de comprobaciones (`ok = t`) y el resumen `comprobaciones | fallos | sin_resultado` (esperado: fallos = 0).
--
-- Carga su propio fixture (todo inventado: nada de datos reales de Lukers). TODO va dentro de UNA transacción que termina en
-- `rollback`: no deja nada escrito.
\set ON_ERROR_STOP off
\pset pager off
begin;

alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);

create or replace function pg_temp.estado(q text, como text default null) returns text language plpgsql as $f$
begin
  if como is not null then
    execute format('set local role %I', como);
  end if;
  execute q;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end
$f$;

create or replace function pg_temp.msg(t text) returns text language plpgsql as $f$
begin
  execute t;
  return null;
exception when others then
  return sqlerrm;
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura  [solo lectura]
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('proyeccion_lote_filas.anterior: jsonb, nullable, sin default',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proyeccion_lote_filas'
       and column_name = 'anterior' and data_type = 'jsonb' and is_nullable = 'YES' and column_default is null) = 1),
  ('check de anterior: nulo o un objeto',
    exists (select 1 from pg_constraint where conrelid = 'public.proyeccion_lote_filas'::regclass and contype = 'c'
              and conname = 'proyeccion_lote_filas_anterior_check'
              and pg_get_constraintdef(oid) like '%anterior IS NULL%jsonb_typeof(anterior)%object%')),
  ('proyeccion_lotes.deshace_lote_id: uuid, nullable, sin default',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proyeccion_lotes'
       and column_name = 'deshace_lote_id' and data_type = 'uuid' and is_nullable = 'YES' and column_default is null) = 1),
  ('FK deshace_lote_id -> proyeccion_lotes(id), on delete restrict, NO diferible',
    exists (select 1 from pg_constraint where conname = 'proyeccion_lotes_deshace_lote_id_fkey' and contype = 'f'
              and conrelid = 'public.proyeccion_lotes'::regclass and confrelid = 'public.proyeccion_lotes'::regclass
              and confdeltype = 'r' and not condeferrable)),
  ('indice de deshace_lote_id',
    exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'proyeccion_lotes'
              and indexname = 'proyeccion_lotes_deshace_lote_id_idx' and indexdef like '%(deshace_lote_id)%')),
  ('check de deshace_lote_id: nulo o tipo like revertir\_%',
    exists (select 1 from pg_constraint where conname = 'proyeccion_lotes_deshace_tipo_check' and contype = 'c'
              and pg_get_constraintdef(oid) like '%deshace_lote_id IS NULL%tipo%revertir%')),
  ('el check de la 0031 (revertir <-> revierte_lote_id) sigue igual',
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'proyeccion_lotes_revierte_tipo_check')
      = 'CHECK (((tipo = ''revertir''::text) = (revierte_lote_id IS NOT NULL)))'),
  ('sobre tipo solo hay los 2 checks de pareja (revierte de 0031 y deshace de 0042): ningun catalogo',
    (select array_agg(conname::text order by conname::text collate "C") from pg_constraint
      where contype = 'c' and conrelid = 'public.proyeccion_lotes'::regclass and pg_get_constraintdef(oid) ~ '\mtipo\M')
      = array['proyeccion_lotes_deshace_tipo_check', 'proyeccion_lotes_revierte_tipo_check']),
  ('devolver_cola_larga(jsonb) returns jsonb: plpgsql, security invoker, search_path vacio',
    exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname = 'public' and p.proname = 'devolver_cola_larga'
                and pg_get_function_identity_arguments(p.oid) = 'p jsonb' and p.prorettype = 'jsonb'::regtype
                and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
                and not p.prosecdef
                and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path=')))),
  ('devolver_cola_larga: execute solo para service_role (ni public, ni anon, ni authenticated)',
    has_function_privilege('service_role', 'public.devolver_cola_larga(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.devolver_cola_larga(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.devolver_cola_larga(jsonb)', 'execute')
    and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) x
                     where p.proname = 'devolver_cola_larga' and x.grantee = 0)),
  ('el cuerpo de devolver_cola_larga no tiene comentarios -- (el SQL Editor los parsea mal)',
    (select prosrc not like '%--%' from pg_proc where proname = 'devolver_cola_larga')),
  ('la lista fija de columnas de devolver_cola_larga es la misma que la de aplicar_lote_proyeccion (26 columnas, mismas asignaciones)',
    (select (length(p.prosrc) - length(replace(p.prosrc, ' = case when v_set ? ''', ''))) / length(' = case when v_set ? ''')
       from pg_proc p where p.proname = 'devolver_cola_larga') = 26
    and not exists (select 1 from information_schema.columns c, pg_proc p
                     where c.table_schema = 'public' and c.table_name = 'proyeccion_fila_anios'
                       and c.column_name not in ('id', 'fila_id', 'anio', 'activo', 'created_at', 'updated_at')
                       and p.proname = 'devolver_cola_larga'
                       and p.prosrc not like '%' || c.column_name || ' = case when v_set ? ''' || c.column_name || '''%')
    and not exists (select 1 from pg_proc p where p.proname = 'devolver_cola_larga'
                     and p.prosrc ~ '(^|[^_a-z])(id|fila_id|anio|activo|created_at|updated_at) = case when')),
  ('aplicar_lote_proyeccion no cambio: sigue admitiendo solo aprobar, reaprobar y revertir',
    (select prosrc like '%v_tipo not in (''aprobar'', ''reaprobar'', ''revertir'')%' from pg_proc where proname = 'aplicar_lote_proyeccion')),
  ('registro en migraciones_aplicadas: 0042_devolver_cola_larga',
    exists (select 1 from public.migraciones_aplicadas where nombre = '0042_devolver_cola_larga' and nota like 'M7 07h 0.20.0%')),
  ('las tablas siguen con RLS activo y sin politicas; service_role solo select e insert (las columnas nuevas no tienen grants propios)',
    (select count(*) from pg_class where oid in ('public.proyeccion_lotes'::regclass, 'public.proyeccion_lote_filas'::regclass) and relrowsecurity) = 2
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('proyeccion_lotes', 'proyeccion_lote_filas')) = 0
    and not has_column_privilege('service_role', 'public.proyeccion_lote_filas', 'anterior', 'update')
    and not has_column_privilege('service_role', 'public.proyeccion_lotes', 'deshace_lote_id', 'update')
    and has_column_privilege('service_role', 'public.proyeccion_lote_filas', 'anterior', 'insert')
    and not has_column_privilege('anon', 'public.proyeccion_lote_filas', 'anterior', 'select')
    and not has_column_privilege('authenticated', 'public.proyeccion_lotes', 'deshace_lote_id', 'select'));

-- La parte de esquema repetida (como en la segunda pasada del validador) no falla ni duplica.
insert into r (caso, ok) values
  ('repetir el add column if not exists (con su FK y su check en linea) y el create index if not exists no falla',
    pg_temp.estado($q$
      alter table public.proyeccion_lote_filas add column if not exists anterior jsonb
        constraint proyeccion_lote_filas_anterior_check check (anterior is null or jsonb_typeof(anterior) = 'object');
      alter table public.proyeccion_lotes add column if not exists deshace_lote_id uuid
        constraint proyeccion_lotes_deshace_lote_id_fkey references public.proyeccion_lotes(id) on delete restrict
        constraint proyeccion_lotes_deshace_tipo_check check (deshace_lote_id is null or tipo like 'revertir\_%');
      create index if not exists proyeccion_lotes_deshace_lote_id_idx on public.proyeccion_lotes (deshace_lote_id);
      insert into public.migraciones_aplicadas (nombre, nota) values ('0042_devolver_cola_larga', 'otra') on conflict (nombre) do nothing$q$) = 'ok'
    and (select count(*) from pg_constraint where conname in ('proyeccion_lotes_deshace_tipo_check', 'proyeccion_lotes_deshace_lote_id_fkey',
           'proyeccion_lote_filas_anterior_check')) = 3
    and (select nota like 'M7 07h%' from public.migraciones_aplicadas where nombre = '0042_devolver_cola_larga'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture (caso G de la ficha, §6.1, con cifras inventadas)
-- ---------------------------------------------------------------------------------------------------------------------
-- Proyección A en trabajo (ya recalculada) y C, que se cerrará. En A, filas base G1..G5 y una fila de tienda GT, con 2026 y 2027:
--   G1: aceptada tal cual en 400 (origen propuesta, propuesta_al_decidir 400), SIN lote; propuesta de hoy 180 (revision).
--   G2: aceptada tal cual en 400 CON lote de 07g (aprobar); propuesta de hoy 80 (bajo_minimo).
--   G3: fijada a mano en 350 (manual): nunca se toca.
--   G4: origen propuesta pero editada (decidido 300 <> propuesta_al_decidir 400): no es «tal cual».
--   G5: aceptada tal cual en 500, para los rechazos por updated_at y por cifra vista distinta.
--   GT: fila de tienda aceptada tal cual (el objetivo debe ser de una fila base).
insert into generos (codigo, nombre) values ('H42H', 'HOMBRE H42');
insert into mundos (codigo, nombre) values ('H42U', 'URBANO H42');
insert into lineas (codigo, nombre, temporada) values ('H42L1', 'LINEA UNO H42', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML' from lineas l, generos g, mundos mu where l.codigo = 'H42L1' and g.codigo = 'H42H' and mu.codigo = 'H42U';
insert into agrupaciones_marca (codigo, nombre) values ('H42AG1', 'AGRUPACION UNO H42');
insert into tiendas (codigo, nombre, tipo) values ('H42T1', 'Tienda H42', 'Tienda');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000042d01', 'humo42a@example.invalid'),
  ('00000000-0000-4000-8000-000000042d02', 'humo42b@example.invalid');
insert into perfiles (id, email, nombre, rol) values
  ('00000000-0000-4000-8000-000000042d01', 'humo42a@example.invalid', 'Humo 42 A', 'admin'),
  ('00000000-0000-4000-8000-000000042d02', 'humo42b@example.invalid', 'Humo 42 B', 'planner');

insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros, calculado_at) values
  (2026, 'HUMO 42 A', date '2026-09-01', '{}'::jsonb, timestamptz '2026-11-20 09:00:00.424242+00'),
  (2026, 'HUMO 42 C', date '2026-09-01', '{}'::jsonb, timestamptz '2026-11-20 09:00:00.111111+00');

insert into proyeccion_filas (proyeccion_id, gml_id, agrupacion_marca_id, tienda_id, clave, nivel_proyectado, historico)
select p.id, n.id, a.id, case when v.clave = 'H42-GT' then (select id from tiendas where codigo = 'H42T1') end, v.clave, 'GML', '{}'::jsonb
from proyecciones p, genero_mundo_linea n, agrupaciones_marca a,
     (values ('HUMO 42 A', 'H42-G1'), ('HUMO 42 A', 'H42-G2'), ('HUMO 42 A', 'H42-G3'), ('HUMO 42 A', 'H42-G4'),
             ('HUMO 42 A', 'H42-G5'), ('HUMO 42 A', 'H42-GT'), ('HUMO 42 C', 'H42-C1')) as v(proy, clave)
where a.codigo = 'H42AG1' and p.nombre = v.proy and n.linea_id = (select id from lineas where codigo = 'H42L1');

-- Lote de 07g que aprobó G2 en bloque (en la propia copia).
insert into proyeccion_lotes (id, confirmacion_id, proyeccion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen, perfil_id, usuario_nombre)
select '00000000-0000-4000-8000-000000042a07', gen_random_uuid(), id, 'aprobar', 2026, repeat('7', 64), calculado_at, '{}', '00000000-0000-4000-8000-000000042d02', 'Humo 42 B'
from proyecciones where nombre = 'HUMO 42 A';

-- Registros con la propuesta de hoy (método 6: G1 180 en 2026 y 190 en 2027; G2 80 y 85; el resto 200 y 210) y las decisiones
-- heredadas, con autor, fecha con microsegundos y nota, para comprobar que deshacer las restaura exactas. Se insertan de una vez (el
-- trigger de updated_at es de UPDATE): cada registro queda con un updated_at propio con microsegundos.
insert into proyeccion_fila_anios (fila_id, anio, bloque, vendido, propuesto, metodo, meses, avisos, updated_at,
    decidido, origen, propuesta_al_decidir, nota, decidido_at, decidido_por_id, decidido_por_nombre, decision_lote_id)
select f.id, a.anio, 'mismas', case a.anio when 2026 then 60 else 0 end,
       case f.clave when 'H42-G1' then (case a.anio when 2026 then 180 else 190 end)
                    when 'H42-G2' then (case a.anio when 2026 then 80 else 85 end)
                    else (case a.anio when 2026 then 200 else 210 end) end,
       'avance', array[1,1,1,1,1,1,1,1,1,1,1,1],
       case f.clave when 'H42-G1' then '["revision_cola_larga"]'::jsonb when 'H42-G2' then '["disponibilidad_bajo_minimo"]'::jsonb else '[]'::jsonb end,
       timestamptz '2026-11-20 08:00:00.100000+00' + (row_number() over (order by f.clave, a.anio)) * interval '1 millisecond' + interval '42 microseconds',
       v.dec, v.ori, v.pad, v.nota, timestamptz '2026-11-08 10:00:00.123456+00', v.por::uuid, v.nom, v.lote::uuid
from proyeccion_filas f
cross join (values (2026), (2027)) as a(anio)
join (values ('H42-G1', 400, 'propuesta', 400, 'nota g1', '00000000-0000-4000-8000-000000042d01', 'Humo 42 A', null),
             ('H42-G2', 400, 'propuesta', 400, null, '00000000-0000-4000-8000-000000042d02', 'Humo 42 B', '00000000-0000-4000-8000-000000042a07'),
             ('H42-G3', 350, 'manual', 200, 'planner 08-nov', '00000000-0000-4000-8000-000000042d02', 'Humo 42 B', null),
             ('H42-G4', 300, 'propuesta', 400, null, null, 'Humo 42 A', null),
             ('H42-G5', 500, 'propuesta', 500, null, null, 'Humo 42 A', null),
             ('H42-GT', 400, 'propuesta', 400, null, null, 'Humo 42 A', null),
             ('H42-C1', 400, 'propuesta', 400, null, null, 'Humo 42 A', null)) as v(clave, dec, ori, pad, nota, por, nom, lote)
  on v.clave = f.clave;

update proyecciones set estado = 'cerrada', cerrada_at = now() where nombre = 'HUMO 42 C';

-- Foto del estado inicial de los registros (para «intacto» y «restaurado exacto»).
create temp table antes as
select f.clave, a.anio, a.id, a.decidido, a.origen, a.propuesta_al_decidir, a.nota, a.decidido_at, a.decidido_por_id, a.decidido_por_nombre,
       a.decision_lote_id, a.decision_ia_fila_id, a.updated_at, a.meses, a.propuesto, a.avisos
  from proyeccion_fila_anios a join proyeccion_filas f on f.id = a.fila_id where f.clave like 'H42-%';

create temp table ids as
select (select id from proyecciones where nombre = 'HUMO 42 A') as proy_a,
       (select id from proyecciones where nombre = 'HUMO 42 C') as proy_c;

-- ---------------------------------------------------------------------------------------------------------------------
-- Ayudantes del payload (imitan lo que hará el servicio: updated_at en texto ISO con microsegundos)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;

create or replace function pg_temp.iso(t timestamptz) returns text language sql as $f$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') $f$;

create or replace function pg_temp.reg(p_clave text, p_anio integer, p_obj boolean, p_set jsonb default '{}'::jsonb,
                                       p_desfase interval default interval '0') returns jsonb language sql as $f$
  select jsonb_build_object('id', a.id, 'updated_at_esperado', pg_temp.iso(a.updated_at + p_desfase), 'objetivo', p_obj, 'set', p_set)
    from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id
   where f.clave = p_clave and a.anio = p_anio $f$;

-- Set de devolver del objetivo: las nueve columnas de decisión en null y los meses rehechos con la propuesta de hoy.
create or replace function pg_temp.set_dev(p_meses integer[] default array[2,2,2,2,2,2,2,2,2,2,2,2]) returns jsonb language sql as $f$
  select jsonb_build_object('decidido', null, 'origen', null, 'nota', null, 'propuesta_al_decidir', null, 'decidido_por_id', null,
           'decidido_por_nombre', null, 'decidido_at', null, 'decision_lote_id', null, 'decision_ia_fila_id', null, 'meses', to_jsonb(p_meses)) $f$;

-- Set del Y+1 que B2 recalcula (sin columnas de decisión).
create or replace function pg_temp.set_b2(p_propuesto integer) returns jsonb language sql as $f$
  select jsonb_build_object('propuesto', p_propuesto, 'meses', to_jsonb(array[3,3,3,3,3,3,3,3,3,3,3,3])) $f$;

-- Fila de devolver: objetivo del año y, si se pide, el Y+1 recalculado.
create or replace function pg_temp.fila_dev(p_clave text, p_anio integer, p_esperado integer, p_b2 integer default null,
                                            p_set jsonb default null, p_desfase interval default interval '0', p_extra jsonb default '{}'::jsonb)
  returns jsonb language sql as $f$
  select jsonb_build_object('fila_id', f.id, 'fila_clave', f.clave, 'gm_clave', 'GM-H42', 'anio', p_anio, 'decidido_esperado', p_esperado,
           'registros', jsonb_build_array(pg_temp.reg(p_clave, p_anio, true, coalesce(p_set, pg_temp.set_dev()), p_desfase))
                        || case when p_b2 is null then '[]'::jsonb else jsonb_build_array(pg_temp.reg(p_clave, p_anio + 1, false, pg_temp.set_b2(p_b2))) end)
         || p_extra
    from public.proyeccion_filas f where f.clave = p_clave $f$;

-- Fila de deshacer: el set del objetivo = `anterior` de su línea en el lote devuelto (lo que hará restaurarDecision) + otra columna.
create or replace function pg_temp.fila_rev(p_clave text, p_anio integer, p_lote uuid, p_ajuste jsonb default '{}'::jsonb)
  returns jsonb language sql as $f$
  select jsonb_build_object('fila_id', f.id, 'fila_clave', f.clave, 'gm_clave', 'GM-H42', 'anio', p_anio,
           'registros', jsonb_build_array(pg_temp.reg(p_clave, p_anio, true,
              coalesce((select lf.anterior from public.proyeccion_lote_filas lf where lf.lote_id = p_lote and lf.fila_clave = p_clave and lf.anio = p_anio),
                       (select jsonb_build_object('decidido', null, 'origen', null, 'nota', null, 'propuesta_al_decidir', null, 'decidido_por_id', null,
                          'decidido_por_nombre', null, 'decidido_at', null, 'decision_lote_id', null, 'decision_ia_fila_id', null)))
              || jsonb_build_object('meses', to_jsonb(array[4,4,4,4,4,4,4,4,4,4,4,4])) || p_ajuste)))
    from public.proyeccion_filas f where f.clave = p_clave $f$;

create or replace function pg_temp.lote(p_id uuid, p_tipo text, p_anio integer, p_proy uuid default null, p_extra jsonb default '{}'::jsonb)
  returns jsonb language sql as $f$
  select jsonb_build_object('id', p_id, 'confirmacion_id', pg_temp.id(42999), 'proyeccion_id', pr.id, 'tipo', p_tipo, 'anio', p_anio,
           'huella_cuerpo', md5(p_id::text) || md5('humo42'), 'calculado_at_esperado', pg_temp.iso(pr.calculado_at),
           'filtro', '{}'::jsonb, 'efecto_gm_previsto', '[]'::jsonb, 'nota', 'humo 42',
           'perfil_id', '00000000-0000-4000-8000-000000042d01', 'usuario_nombre', 'Humo 42 A') || p_extra
    from public.proyecciones pr where pr.id = coalesce(p_proy, (select proy_a from ids)) $f$;

create or replace function pg_temp.payload(p_lote jsonb, p_filas jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('lote', p_lote, 'filas', p_filas) $f$;

create or replace function pg_temp.dc(p jsonb) returns jsonb language plpgsql as $f$
begin
  return public.devolver_cola_larga(p);
exception when others then
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end
$f$;

create or replace function pg_temp.cod(p_res jsonb, p_clave text, p_anio integer) returns text language sql as $f$
  select coalesce(e ->> 'codigo', e ->> 'resultado') from jsonb_array_elements(p_res -> 'filas') e
   where e ->> 'fila_clave' = p_clave and (e ->> 'anio')::integer = p_anio $f$;

create or replace function pg_temp.a(p_clave text, p_anio integer) returns public.proyeccion_fila_anios language sql as $f$
  select a.* from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id
   where f.clave = p_clave and a.anio = p_anio $f$;

create temp table res (k text primary key, v jsonb);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Rechazos de cabecera y de payload (nada se escribe)
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('cerrada', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42101), 'devolver_cola_larga', 2026, (select proy_c from ids)),
     jsonb_build_array(pg_temp.fila_dev('H42-C1', 2026, 400))))),
  ('no_encontrada', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42102), 'devolver_cola_larga', 2026) || jsonb_build_object('proyeccion_id', pg_temp.id(42777)),
     '[]'::jsonb))),
  ('calc', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42103), 'devolver_cola_larga', 2026) || jsonb_build_object('calculado_at_esperado', '2026-11-20T09:00:00.424243+00:00'),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400))))),
  ('tipo', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42104), 'aprobar', 2026), '[]'::jsonb))),
  ('rev_sin_deshace', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42105), 'revertir_cola_larga', 2026), '[]'::jsonb))),
  ('dev_con_deshace', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42106), 'devolver_cola_larga', 2026,
     null, jsonb_build_object('deshace_lote_id', '00000000-0000-4000-8000-000000042a07')), '[]'::jsonb))),
  ('set_no_nulo', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42107), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400), pg_temp.fila_dev('H42-G2', 2026, 400, null, pg_temp.set_dev() || '{"decidido": 80}'::jsonb))))),
  ('set_incompleto', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42108), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400, null, pg_temp.set_dev() - 'decision_lote_id'))))),
  ('b2_con_decision', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42109), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400) #- '{registros,1}'
       || jsonb_build_object('registros', jsonb_build_array(pg_temp.reg('H42-G1', 2026, true, pg_temp.set_dev()),
                                                            pg_temp.reg('H42-G1', 2027, false, '{"decidido": null}'::jsonb))))))),
  ('fuera_lista', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42110), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400, null, pg_temp.set_dev() || '{"activo": false}'::jsonb))))),
  ('tienda', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42111), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-GT', 2026, 400))))),
  ('otro_anio', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42112), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2027, 400))))),
  ('sin_esperado', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42113), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400) - 'decidido_esperado')))),
  ('dos_objetivos', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42114), 'devolver_cola_larga', 2026),
     jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400) || jsonb_build_object('registros', jsonb_build_array(
       pg_temp.reg('H42-G1', 2026, true, pg_temp.set_dev()), pg_temp.reg('H42-G1', 2027, true, pg_temp.set_dev())))))));

-- Cálculo vivo: se marca y se desmarca alrededor de la llamada.
update proyecciones set calculando_desde = now() where nombre = 'HUMO 42 A';
insert into res values ('vivo', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42115), 'devolver_cola_larga', 2026),
  jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400)))));
update proyecciones set calculando_desde = null where nombre = 'HUMO 42 A';

insert into r (caso, ok) values
  ('proyeccion cerrada: DC001 proyeccion_cerrada', (select v ->> 'error' = 'DC001' and v ->> 'msg' = 'proyeccion_cerrada' from res where k = 'cerrada')),
  ('proyeccion inexistente: DC006', (select v ->> 'error' = 'DC006' from res where k = 'no_encontrada')),
  ('calculado_at distinto por 1 microsegundo: DC003 datos_cambiaron', (select v ->> 'error' = 'DC003' and v ->> 'msg' = 'datos_cambiaron' from res where k = 'calc')),
  ('calculo vivo: DC002 calculo_en_curso', (select v ->> 'error' = 'DC002' from res where k = 'vivo')),
  ('tipo de 07g (aprobar) en la funcion hermana: DC007', (select v ->> 'error' = 'DC007' from res where k = 'tipo')),
  ('revertir_cola_larga sin deshace_lote_id: DC007', (select v ->> 'error' = 'DC007' from res where k = 'rev_sin_deshace')),
  ('devolver_cola_larga con deshace_lote_id: DC007', (select v ->> 'error' = 'DC007' from res where k = 'dev_con_deshace')),
  ('devolver con una columna de decision no nula en el set: DC007 y la primera fila (valida) NO queda escrita',
    (select v ->> 'error' = 'DC007' from res where k = 'set_no_nulo') and (pg_temp.a('H42-G1', 2026)).decidido = 400),
  ('set del objetivo sin las nueve columnas de decision: DC007', (select v ->> 'error' = 'DC007' from res where k = 'set_incompleto')),
  ('registro no objetivo (Y+1 de B2) con una columna de decision: DC007', (select v ->> 'error' = 'DC007' from res where k = 'b2_con_decision')),
  ('columna fuera de la lista fija (activo): DC007', (select v ->> 'error' = 'DC007' from res where k = 'fuera_lista')),
  ('objetivo de una fila de tienda: DC007', (select v ->> 'error' = 'DC007' and v ->> 'msg' like '%fila base%' from res where k = 'tienda')),
  ('fila de otro anio que el lote: DC007', (select v ->> 'error' = 'DC007' from res where k = 'otro_anio')),
  ('devolver sin decidido_esperado: DC007', (select v ->> 'error' = 'DC007' from res where k = 'sin_esperado')),
  ('dos registros objetivo en una fila: DC007', (select v ->> 'error' = 'DC007' from res where k = 'dos_objetivos')),
  ('ninguno de los rechazos de cabecera o payload dejo lotes, lineas ni registros cambiados',
    not exists (select 1 from proyeccion_lotes where id between pg_temp.id(42100) and pg_temp.id(42199))
    and not exists (select 1 from proyeccion_lote_filas where lote_id between pg_temp.id(42100) and pg_temp.id(42199))
    and not exists (select 1 from antes b join proyeccion_fila_anios a on a.id = b.id where a.updated_at <> b.updated_at));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Devolver 2026 (caso G): G1 sin lote y G2 con lote se devuelven; G3 manual y G4 editada no; G5 con updated_at desfasado y con
--    la cifra vista distinta. G1 lleva además su 2027 recalculado por B2.
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values ('d26', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42201), 'devolver_cola_larga', 2026),
  jsonb_build_array(
    pg_temp.fila_dev('H42-G1', 2026, 400, 150),
    pg_temp.fila_dev('H42-G2', 2026, 400),
    pg_temp.fila_dev('H42-G3', 2026, 350),
    pg_temp.fila_dev('H42-G4', 2026, 300),
    pg_temp.fila_dev('H42-G5', 2026, 500, null, null, interval '1 microsecond'),
    jsonb_build_object('fila_id', null, 'fila_clave', 'H42-RECHAZO-TS', 'gm_clave', 'GM-H42', 'anio', 2026, 'rechazo', 'cola_larga_revision', 'registros', '[]'::jsonb)))));

insert into r (caso, ok) values
  ('d26: aplica sin error, repetido false', (select v ? 'lote_id' and (v ->> 'repetido')::boolean = false from res where k = 'd26')),
  ('d26: G1 (sin lote) y G2 (con lote de 07g) aplicadas',
    (select pg_temp.cod(v, 'H42-G1', 2026) = 'aplicada' and pg_temp.cod(v, 'H42-G2', 2026) = 'aplicada' from res where k = 'd26')),
  ('d26: G3 manual -> cambiada_despues; G4 propuesta editada -> cambiada_despues; G5 desfasada 1 us -> cambio_concurrente; rechazo de TS conservado',
    (select pg_temp.cod(v, 'H42-G3', 2026) = 'cambiada_despues' and pg_temp.cod(v, 'H42-G4', 2026) = 'cambiada_despues'
            and pg_temp.cod(v, 'H42-G5', 2026) = 'cambio_concurrente' and pg_temp.cod(v, 'H42-RECHAZO-TS', 2026) = 'cola_larga_revision' from res where k = 'd26')),
  ('d26: G1 y G2 2026 quedan SIN decidir (decidido, origen, propuesta_al_decidir, autor, fecha, nota, lote y traza nulos), vigente = propuesta de hoy 180 y 80',
    (select bool_and(a.decidido is null and a.origen is null and a.propuesta_al_decidir is null and a.nota is null and a.decidido_at is null
                     and a.decidido_por_id is null and a.decidido_por_nombre is null and a.decision_lote_id is null and a.decision_ia_fila_id is null
                     and a.meses = array[2,2,2,2,2,2,2,2,2,2,2,2])
       from (select (pg_temp.a('H42-G1', 2026)).* union all select (pg_temp.a('H42-G2', 2026)).*) a)
    and (pg_temp.a('H42-G1', 2026)).propuesto = 180 and (pg_temp.a('H42-G2', 2026)).propuesto = 80),
  ('d26: el 2027 de G1 (B2) se reescribe sin tocar su decision (propuesto 150, sigue decidido 400 con su autor)',
    (pg_temp.a('H42-G1', 2027)).propuesto = 150 and (pg_temp.a('H42-G1', 2027)).decidido = 400
    and (pg_temp.a('H42-G1', 2027)).origen = 'propuesta' and (pg_temp.a('H42-G1', 2027)).decidido_por_nombre = 'Humo 42 A'),
  ('d26: G3 (manual), G4, G5 y GT quedan INTACTOS (todas las columnas de decision y updated_at)',
    not exists (select 1 from antes b join proyeccion_fila_anios a on a.id = b.id
                 where b.clave in ('H42-G3', 'H42-G4', 'H42-G5', 'H42-GT', 'H42-C1')
                   and (a.updated_at <> b.updated_at or a.decidido is distinct from b.decidido or a.origen is distinct from b.origen
                        or a.propuesta_al_decidir is distinct from b.propuesta_al_decidir or a.meses is distinct from b.meses))),
  ('d26: cabecera tipo devolver_cola_larga, anio 2026, deshace y revierte nulos, calculado_at de la proyeccion, confirmacion del payload',
    exists (select 1 from proyeccion_lotes l, ids where l.id = pg_temp.id(42201) and l.tipo = 'devolver_cola_larga' and l.anio = 2026
              and l.deshace_lote_id is null and l.revierte_lote_id is null and l.proyeccion_id = ids.proy_a
              and l.calculado_at_proyeccion = timestamptz '2026-11-20 09:00:00.424242+00' and l.confirmacion_id = pg_temp.id(42999))),
  ('d26: una linea por fila pedida (6), fuente devolver en todas',
    (select count(*) = 6 and bool_and(fuente = 'devolver') from proyeccion_lote_filas where lote_id = pg_temp.id(42201))),
  ('d26: anterior de G1 = foto exacta de antes (las 9 claves; decidido 400, origen propuesta, pad 400, nota, autor, fecha, sin lote)',
    (select lf.anterior = jsonb_build_object('decidido', 400, 'origen', 'propuesta', 'nota', 'nota g1', 'propuesta_al_decidir', 400,
              'decidido_por_id', '00000000-0000-4000-8000-000000042d01', 'decidido_por_nombre', 'Humo 42 A',
              'decidido_at', to_jsonb(timestamptz '2026-11-08 10:00:00.123456+00'), 'decision_lote_id', null, 'decision_ia_fila_id', null)
       from proyeccion_lote_filas lf where lf.lote_id = pg_temp.id(42201) and lf.fila_clave = 'H42-G1')),
  ('d26: anterior de G2 guarda su lote de 07g',
    (select lf.anterior ->> 'decision_lote_id' = '00000000-0000-4000-8000-000000042a07' and (lf.anterior ->> 'decidido')::int = 400
       from proyeccion_lote_filas lf where lf.lote_id = pg_temp.id(42201) and lf.fila_clave = 'H42-G2')),
  ('d26: lineas aplicadas con valor null, decidido_anterior 400 y valor_esperado 400; rechazadas sin anterior y con valor_actual leido',
    (select bool_and(valor is null and decidido_anterior = 400 and valor_esperado = 400 and anterior is not null)
       from proyeccion_lote_filas where lote_id = pg_temp.id(42201) and resultado = 'aplicada')
    and (select bool_and(anterior is null) from proyeccion_lote_filas where lote_id = pg_temp.id(42201) and resultado <> 'aplicada')
    and (select valor_actual = 350 from proyeccion_lote_filas where lote_id = pg_temp.id(42201) and fila_clave = 'H42-G3')
    and (select fila_id is null from proyeccion_lote_filas where lote_id = pg_temp.id(42201) and fila_clave = 'H42-RECHAZO-TS')),
  ('d26: resumen con la forma de 07g: pedidas 6, aplicadas 2, rechazadas por codigo, por_fuente ia y metodo en cero y devolver {2, 0}',
    (select l.resumen = jsonb_build_object('pedidas', 6, 'aplicadas', 2,
              'rechazadas', jsonb_build_object('cambiada_despues', 2, 'cambio_concurrente', 1, 'cola_larga_revision', 1),
              'por_fuente', jsonb_build_object('ia', jsonb_build_object('filas', 0, 'unidades', 0), 'metodo', jsonb_build_object('filas', 0, 'unidades', 0),
                                               'devolver', jsonb_build_object('filas', 2, 'unidades', 0)))
       from proyeccion_lotes l where l.id = pg_temp.id(42201))),
  ('d26: la respuesta trae el resumen guardado y una entrada por linea',
    (select (v -> 'resumen') = (select resumen from proyeccion_lotes where id = pg_temp.id(42201)) and jsonb_array_length(v -> 'filas') = 6 from res where k = 'd26'));

-- Idempotencia.
insert into res values ('d26_rep', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42201), 'devolver_cola_larga', 2026),
  jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400)))));
insert into res values ('d26_ajeno', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42201), 'devolver_cola_larga', 2026)
  || jsonb_build_object('huella_cuerpo', repeat('e', 64)), '[]'::jsonb)));
insert into res values ('d26_otra', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42202), 'devolver_cola_larga', 2026),
  jsonb_build_array(pg_temp.fila_dev('H42-G1', 2026, 400), pg_temp.fila_dev('H42-G2', 2026, 400)))));
insert into r (caso, ok) values
  ('reintento (mismo id, misma huella): repetido true, misma respuesta, sin lineas nuevas',
    (select (v ->> 'repetido')::boolean and (v -> 'resumen') = (select v -> 'resumen' from res where k = 'd26') from res where k = 'd26_rep')
    and (select count(*) from proyeccion_lote_filas where lote_id = pg_temp.id(42201)) = 6),
  ('mismo id con otra huella: DC004 lote_ajeno', (select v ->> 'error' = 'DC004' and v ->> 'msg' = 'lote_ajeno' from res where k = 'd26_ajeno')),
  ('un lote NUEVO sobre lo ya devuelto: las dos filas cambiada_despues (ya no son candidatas), nada escrito',
    (select pg_temp.cod(v, 'H42-G1', 2026) = 'cambiada_despues' and pg_temp.cod(v, 'H42-G2', 2026) = 'cambiada_despues'
            and (v -> 'resumen' ->> 'aplicadas')::int = 0 from res where k = 'd26_otra')
    and (pg_temp.a('H42-G1', 2026)).decidido is null);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Devolver 2027 (el segundo lote de la misma confirmación): G1 y G2 en 2027; G3 manual intacto
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values ('d27', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42203), 'devolver_cola_larga', 2027),
  jsonb_build_array(pg_temp.fila_dev('H42-G1', 2027, 400), pg_temp.fila_dev('H42-G2', 2027, 400), pg_temp.fila_dev('H42-G3', 2027, 350)))));
insert into r (caso, ok) values
  ('d27: G1 y G2 de 2027 aplicadas; G3 manual cambiada_despues',
    (select pg_temp.cod(v, 'H42-G1', 2027) = 'aplicada' and pg_temp.cod(v, 'H42-G2', 2027) = 'aplicada' and pg_temp.cod(v, 'H42-G3', 2027) = 'cambiada_despues' from res where k = 'd27')),
  ('d27: G1 y G2 2027 sin decidir; G3 2027 sigue manual en 350 con su autor',
    (pg_temp.a('H42-G1', 2027)).decidido is null and (pg_temp.a('H42-G2', 2027)).decidido is null and (pg_temp.a('H42-G2', 2027)).decision_lote_id is null
    and (pg_temp.a('H42-G3', 2027)).decidido = 350 and (pg_temp.a('H42-G3', 2027)).origen = 'manual' and (pg_temp.a('H42-G3', 2027)).decidido_por_nombre = 'Humo 42 B'),
  ('d27: cabecera anio 2027 con el mismo confirmacion_id que la de 2026',
    (select l27.anio = 2027 and l27.confirmacion_id = l26.confirmacion_id from proyeccion_lotes l27, proyeccion_lotes l26
      where l27.id = pg_temp.id(42203) and l26.id = pg_temp.id(42201))),
  ('ningun registro manual de la proyeccion cambio en todo el humo hasta aqui',
    not exists (select 1 from antes b join proyeccion_fila_anios a on a.id = b.id where b.origen = 'manual'
                 and (a.updated_at <> b.updated_at or a.decidido is distinct from b.decidido or a.origen is distinct from b.origen)));

-- Lo decidido DESPUÉS de devolver: G2 2027 se decide a mano (no debe pisarse al deshacer).
update proyeccion_fila_anios a set decidido = 90, origen = 'manual', propuesta_al_decidir = 85, decidido_por_nombre = 'Humo 42 B'
  from proyeccion_filas f where f.id = a.fila_id and f.clave = 'H42-G2' and a.anio = 2027;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Deshacer (revertir_cola_larga)
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('r_mal_set', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42301), 'revertir_cola_larga', 2026, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
     jsonb_build_array(pg_temp.fila_rev('H42-G2', 2026, pg_temp.id(42201), jsonb_build_object('decision_lote_id', pg_temp.id(42201))))))),
  ('r_mal_set2', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42302), 'revertir_cola_larga', 2026, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
     jsonb_build_array(pg_temp.fila_rev('H42-G1', 2026, pg_temp.id(42201), '{"decidido": 180}'::jsonb))))),
  ('r_no_rev', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42303), 'revertir_cola_larga', 2026, null, jsonb_build_object('deshace_lote_id', '00000000-0000-4000-8000-000000042a07')),
     '[]'::jsonb))),
  ('r_anio', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42304), 'revertir_cola_larga', 2027, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
     '[]'::jsonb))),
  ('r_no_dev', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42305), 'revertir_cola_larga', 2026, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
     jsonb_build_array(pg_temp.fila_rev('H42-G3', 2026, pg_temp.id(42201)))))),
  ('r_cerrada', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42306), 'revertir_cola_larga', 2026, (select proy_c from ids), jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
     '[]'::jsonb)));
insert into r (caso, ok) values
  ('deshacer con decision_lote_id distinto del de anterior (el del lote devuelto): DC007', (select v ->> 'error' = 'DC007' from res where k = 'r_mal_set')),
  ('deshacer con un decidido distinto del de anterior (la propuesta de hoy): DC007', (select v ->> 'error' = 'DC007' from res where k = 'r_mal_set2')),
  ('deshacer un lote que no es devolver_cola_larga (uno de 07g): DC005 no_revertible', (select v ->> 'error' = 'DC005' from res where k = 'r_no_rev')),
  ('deshacer con un anio distinto del lote devuelto: DC007', (select v ->> 'error' = 'DC007' from res where k = 'r_anio')),
  ('deshacer una fila que el lote no devolvio (G3, rechazada): DC009 fila_no_devuelta', (select v ->> 'error' = 'DC009' and v ->> 'msg' = 'fila_no_devuelta' from res where k = 'r_no_dev')),
  ('deshacer en una proyeccion cerrada: DC001', (select v ->> 'error' = 'DC001' from res where k = 'r_cerrada')),
  ('los deshacer rechazados no escribieron nada (G1 y G2 2026 siguen sin decidir; sin lotes 423xx)',
    (pg_temp.a('H42-G1', 2026)).decidido is null and (pg_temp.a('H42-G2', 2026)).decidido is null
    and not exists (select 1 from proyeccion_lotes where id between pg_temp.id(42300) and pg_temp.id(42399)));

-- Deshacer 2026: restaura G1 y G2 exactos.
insert into res values ('r26', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42310), 'revertir_cola_larga', 2026, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
  jsonb_build_array(pg_temp.fila_rev('H42-G1', 2026, pg_temp.id(42201)), pg_temp.fila_rev('H42-G2', 2026, pg_temp.id(42201))))));
-- Deshacer 2027: G1 se restaura; G2 se decidió después -> cambiada_despues.
insert into res values ('r27', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42311), 'revertir_cola_larga', 2027, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42203))),
  jsonb_build_array(pg_temp.fila_rev('H42-G1', 2027, pg_temp.id(42203)), pg_temp.fila_rev('H42-G2', 2027, pg_temp.id(42203))))));

insert into r (caso, ok) values
  ('r26: G1 y G2 aplicadas', (select pg_temp.cod(v, 'H42-G1', 2026) = 'aplicada' and pg_temp.cod(v, 'H42-G2', 2026) = 'aplicada' from res where k = 'r26')),
  ('r26 (RP7): G1 y G2 2026 vuelven EXACTAMENTE a lo de antes: decidido 400, origen propuesta, propuesta_al_decidir 400, nota, autor, fecha y (G2) su lote de 07g',
    not exists (select 1 from antes b join proyeccion_fila_anios a on a.id = b.id
                 where b.clave in ('H42-G1', 'H42-G2') and b.anio = 2026
                   and (a.decidido is distinct from b.decidido or a.origen is distinct from b.origen
                        or a.propuesta_al_decidir is distinct from b.propuesta_al_decidir or a.nota is distinct from b.nota
                        or a.decidido_at is distinct from b.decidido_at or a.decidido_por_id is distinct from b.decidido_por_id
                        or a.decidido_por_nombre is distinct from b.decidido_por_nombre or a.decision_lote_id is distinct from b.decision_lote_id
                        or a.decision_ia_fila_id is distinct from b.decision_ia_fila_id))
    and (pg_temp.a('H42-G2', 2026)).decision_lote_id = '00000000-0000-4000-8000-000000042a07'
    and (pg_temp.a('H42-G1', 2026)).decidido = 400 and (pg_temp.a('H42-G1', 2026)).propuesto = 180
    and (pg_temp.a('H42-G1', 2026)).meses = array[4,4,4,4,4,4,4,4,4,4,4,4]),
  ('r26: cabecera revertir_cola_larga con deshace_lote_id = el devuelto y revierte_lote_id nulo',
    exists (select 1 from proyeccion_lotes where id = pg_temp.id(42310) and tipo = 'revertir_cola_larga'
              and deshace_lote_id = pg_temp.id(42201) and revierte_lote_id is null and anio = 2026)),
  ('r26: lineas fuente revertir, valor = decidido restaurado (400), decidido_anterior null y anterior = foto sin decidir',
    (select bool_and(fuente = 'revertir' and valor = 400 and decidido_anterior is null and (anterior ->> 'decidido') is null and anterior ? 'decision_lote_id')
       from proyeccion_lote_filas where lote_id = pg_temp.id(42310))),
  ('r26: resumen: pedidas 2, aplicadas 2, por_fuente revertir {2, 800} con ia y metodo en cero',
    (select resumen = jsonb_build_object('pedidas', 2, 'aplicadas', 2, 'rechazadas', '{}'::jsonb,
              'por_fuente', jsonb_build_object('ia', jsonb_build_object('filas', 0, 'unidades', 0), 'metodo', jsonb_build_object('filas', 0, 'unidades', 0),
                                               'revertir', jsonb_build_object('filas', 2, 'unidades', 800)))
       from proyeccion_lotes where id = pg_temp.id(42310))),
  ('r27: G1 2027 restaurada a 400 propuesta; G2 2027 (decidida despues a mano en 90) cambiada_despues y NO se pisa',
    (select pg_temp.cod(v, 'H42-G1', 2027) = 'aplicada' and pg_temp.cod(v, 'H42-G2', 2027) = 'cambiada_despues' from res where k = 'r27')
    and (pg_temp.a('H42-G1', 2027)).decidido = 400 and (pg_temp.a('H42-G1', 2027)).origen = 'propuesta'
    and (pg_temp.a('H42-G2', 2027)).decidido = 90 and (pg_temp.a('H42-G2', 2027)).origen = 'manual');

-- Deshacer dos veces: ya_revertida (aunque el registro volviera a quedar sin decidir).
update proyeccion_fila_anios a set decidido = null, origen = null, propuesta_al_decidir = null, nota = null, decidido_at = null,
       decidido_por_id = null, decidido_por_nombre = null, decision_lote_id = null
  from proyeccion_filas f where f.id = a.fila_id and f.clave = 'H42-G1' and a.anio = 2026;
insert into res values ('r26_bis', pg_temp.dc(pg_temp.payload(pg_temp.lote(pg_temp.id(42312), 'revertir_cola_larga', 2026, null, jsonb_build_object('deshace_lote_id', pg_temp.id(42201))),
  jsonb_build_array(pg_temp.fila_rev('H42-G1', 2026, pg_temp.id(42201))))));
insert into r (caso, ok) values
  ('deshacer otra vez el mismo lote: ya_revertida y nada escrito',
    (select pg_temp.cod(v, 'H42-G1', 2026) = 'ya_revertida' and (v -> 'resumen' ->> 'aplicadas')::int = 0 from res where k = 'r26_bis')
    and (pg_temp.a('H42-G1', 2026)).decidido is null);

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Checks de la tabla, inmutabilidad y privilegios
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('check: deshace_lote_id con tipo revertir (07g) -> 23514',
    pg_temp.estado($q$insert into public.proyeccion_lotes (id, confirmacion_id, tipo, revierte_lote_id, deshace_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
      values (gen_random_uuid(), gen_random_uuid(), 'revertir', '00000000-0000-4000-8000-000000042a07', '00000000-0000-4000-8000-000000042a07', 2026, repeat('a', 64), now(), '{}')$q$) = '23514'),
  ('check: deshace_lote_id con tipo aprobar o devolver_cola_larga -> 23514',
    pg_temp.estado($q$insert into public.proyeccion_lotes (id, confirmacion_id, tipo, deshace_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
      values (gen_random_uuid(), gen_random_uuid(), 'aprobar', '00000000-0000-4000-8000-000000042a07', 2026, repeat('a', 64), now(), '{}')$q$) = '23514'
    and pg_temp.estado($q$insert into public.proyeccion_lotes (id, confirmacion_id, tipo, deshace_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
      values (gen_random_uuid(), gen_random_uuid(), 'devolver_cola_larga', '00000000-0000-4000-8000-000000042a07', 2026, repeat('a', 64), now(), '{}')$q$) = '23514'),
  ('check: deshace_lote_id con tipo revertir_plan_tienda (la mesa) se admite',
    pg_temp.estado($q$insert into public.proyeccion_lotes (id, confirmacion_id, tipo, deshace_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
      values (gen_random_uuid(), gen_random_uuid(), 'revertir_plan_tienda', '00000000-0000-4000-8000-000000042a07', 2026, repeat('a', 64), now(), '{}')$q$) = 'ok'),
  ('FK: deshace_lote_id a un lote inexistente -> 23503',
    pg_temp.estado($q$insert into public.proyeccion_lotes (id, confirmacion_id, tipo, deshace_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
      values (gen_random_uuid(), gen_random_uuid(), 'revertir_cola_larga', gen_random_uuid(), 2026, repeat('a', 64), now(), '{}')$q$) = '23503'),
  ('check: anterior que no es objeto (arreglo) -> 23514',
    pg_temp.estado($q$insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado, anterior)
      values ('00000000-0000-4000-8000-000000042a07', 'x', 'g', 2026, 'devolver', 'aplicada', '[1]'::jsonb)$q$) = '23514'),
  ('inmutable: cambiar anterior de una linea lo rechaza el trigger de la 0031 (23001), tambien al dueño',
    pg_temp.estado(format($q$update public.proyeccion_lote_filas set anterior = '{}'::jsonb where lote_id = %L$q$, pg_temp.id(42201))) = '23001'),
  ('inmutable: cambiar deshace_lote_id de un lote lo rechaza el trigger (23001)',
    pg_temp.estado(format($q$update public.proyeccion_lotes set deshace_lote_id = null where id = %L$q$, pg_temp.id(42310))) = '23001'),
  ('anon no puede ejecutar devolver_cola_larga (42501)',
    pg_temp.estado($q$select public.devolver_cola_larga('{}'::jsonb)$q$, 'anon') = '42501'),
  ('authenticated no puede ejecutar devolver_cola_larga (42501)',
    pg_temp.estado($q$select public.devolver_cola_larga('{}'::jsonb)$q$, 'authenticated') = '42501'),
  ('service_role SI ejecuta devolver_cola_larga (llega a la validacion: DC007 con un payload vacio)',
    pg_temp.estado($q$select public.devolver_cola_larga('{}'::jsonb)$q$, 'service_role') = 'DC007'),
  ('anon y authenticated no leen las columnas nuevas (42501)',
    pg_temp.estado('select anterior from public.proyeccion_lote_filas limit 1', 'anon') = '42501'
    and pg_temp.estado('select deshace_lote_id from public.proyeccion_lotes limit 1', 'authenticated') = '42501');

-- Como service_role (el rol de la API), una devolución real de punta a punta: G5 2026 (aceptada tal cual en 500).
insert into res values ('srv', null);
create or replace function pg_temp.como_servicio(p jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.devolver_cola_larga(p);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end
$f$;
update res set v = pg_temp.como_servicio(pg_temp.payload(pg_temp.lote(pg_temp.id(42401), 'devolver_cola_larga', 2026),
  jsonb_build_array(pg_temp.fila_dev('H42-G5', 2026, 500)))) where k = 'srv';
insert into r (caso, ok) values
  ('service_role devuelve G5 2026 de punta a punta (aplicada, sin decidir, linea con anterior 500)',
    (select pg_temp.cod(v, 'H42-G5', 2026) = 'aplicada' from res where k = 'srv')
    and (pg_temp.a('H42-G5', 2026)).decidido is null
    and (select (anterior ->> 'decidido')::int = 500 from proyeccion_lote_filas where lote_id = pg_temp.id(42401)));

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;

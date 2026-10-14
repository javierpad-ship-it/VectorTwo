-- M6 · Curvas de estacionalidad (PASO 2: cálculo, versión 0.9.6).
--
-- Ficha: docs/modulos/06-curvas-estacionalidad.md (§ Modelo de datos y
-- "Actualización del 2026-10-14, segunda pasada"; reglas de negocio 30 y 31).
-- Numeración: la 0011 fue el paso 1; la 0013 (`endurecer_permisos`) y la 0014
-- (`unidades_mensuales`, M11) se adelantaron a lo que estaba previsto, así que
-- el paso 2 toma la 0015.
--
-- Qué crea:
--   1. `periodos_atipicos.temporadas text[]` (el conjunto de temporadas a las que
--      aplica un periodo) y deja `alcance` documentada como columna heredada.
--   2. La vista materializada `venta_mensual_estacionalidad` (agregado
--      agrupación × género × línea × tienda × mes) y su función de refresco
--      `refrescar_venta_mensual_estacionalidad()`.
--   3. La función `venta_mensual_tienda()` (red comparable antes de cualquier
--      corrida).
--   4. `corridas_estacionalidad` (una fila por cálculo) y `curvas_estacionalidad`
--      (la curva elegida, versionada).
--
-- Idempotente: se puede correr más de una vez. Sin bloques `do $$ ... $$`
-- (los cuerpos de función con comillas de dólar no son un bloque anónimo).
--
-- SIN DROP, DELETE, TRUNCATE ni UPDATE (ni dentro de funciones): las migraciones
-- se aplican con `execute_sql` del MCP de Supabase y esas sentencias se quedan
-- esperando una confirmación que nunca llega. Sin backfill: lo nuevo lleva
-- `default` o es nulo.
--
-- Seguridad: RLS activo y SIN políticas en las tablas nuevas; `revoke` explícito
-- a `public`, `anon` y `authenticated` y `grant` a `service_role` sobre CADA
-- objeto nuevo (como 0013 y 0014; la 0013 ya fija los privilegios por defecto del
-- rol `postgres`, pero el `revoke` explícito no depende de quién aplique esto).
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `periodos_atipicos.temporadas`
-- ---------------------------------------------------------------------------
-- El Niño de 2023 afecta a invierno todo el año y a verano desde setiembre: es un
-- CONJUNTO de temporadas, no un valor. Ampliar el `check` de `alcance` exigiría
-- `drop constraint` (no admitido), así que se añade una columna con su propio
-- `check` (`<@`: "contenido en" la lista permitida).
--
-- `null` solo en las filas que creó el paso 1 (el código deriva el conjunto de
-- `alcance`). SIN `default` a propósito: un `default '{invierno}'` haría que una
-- fila vieja con `alcance = 'todas'` se leyera como solo invierno.
-- Si la columna ya existe, `add column if not exists` omite también el check en
-- línea, así que repetir la migración no lo duplica.
alter table public.periodos_atipicos
  add column if not exists temporadas text[]
    constraint periodos_atipicos_temporadas_check
      check (
        temporadas is null
        or (
          cardinality(temporadas) between 1 and 3
          and temporadas <@ array['invierno', 'verano', 'todo_el_ano']::text[]
        )
      );

comment on column public.periodos_atipicos.alcance is
  'Columna heredada del paso 1 (M6, 0011). El codigo no la lee cuando temporadas no es nulo; solo se escribe para satisfacer su check (todas si temporadas cubre las tres temporadas, invierno en cualquier otro caso). Su check no se amplia porque eso exige quitar la restriccion.';

comment on column public.periodos_atipicos.temporadas is
  'Conjunto de temporadas de agrupacion a las que aplica el periodo (invierno, verano, todo_el_ano; de una a tres). Nulo solo en filas del paso 1: se deriva de alcance. Sin default a proposito.';

-- ---------------------------------------------------------------------------
-- 2. Vista materializada `venta_mensual_estacionalidad`
-- ---------------------------------------------------------------------------
-- Agregado precalculado de `venta_stock_vigente` (solo cargas publicadas) por
-- agrupación de estacionalidad × género × línea × tienda × mes. El cálculo de una
-- corrida lo necesita una vez, la pantalla en cada clic y M7 lo volverá a usar:
-- re-agregar ~870 mil filas cada vez no es viable.
--
-- `left join` (no `join`): la venta de una equivalencia sin agrupación sale con
-- `agrupacion_estacionalidad_id` nulo (la pantalla lo reporta) y nunca se pierde
-- una fila del total. Mismo criterio para género y línea.
-- El stock no entra (es de M8). Sin `id`, `activo` ni `updated_at`: es derivada
-- e inmutable entre refrescos (misma excepción que la tabla de hechos de M5).
--
-- `with no data`: se crea vacía y el primer refresco la llena (en la ficha, el
-- primer `calcular`). Así crear el objeto es instantáneo y la carga pesada va en
-- su propia llamada.
create materialized view if not exists public.venta_mensual_estacionalidad as
select
  e.agrupacion_estacionalidad_id,
  n.genero_id,
  n.linea_id,
  v.tienda_id,
  v.periodo,
  sum(v.unidades)::bigint as unidades,
  sum(v.venta_soles)::numeric as venta_soles,
  sum(v.costo_vendido)::numeric as costo_vendido
from public.venta_stock_vigente v
left join public.equivalencias e on e.id = v.equivalencia_id
left join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
group by
  e.agrupacion_estacionalidad_id,
  n.genero_id,
  n.linea_id,
  v.tienda_id,
  v.periodo
with no data;

-- Único sobre el grano. Las columnas anulables pasan por `coalesce`: dos NULL no
-- chocan en un UNIQUE normal. Es la garantía de que el `group by` no duplica
-- filas. (No sirve para `refresh ... concurrently`, que no admite expresiones;
-- ver el refresco más abajo.)
create unique index if not exists venta_mensual_estacionalidad_grano_uniq
  on public.venta_mensual_estacionalidad (
    coalesce(agrupacion_estacionalidad_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(genero_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(linea_id, '00000000-0000-0000-0000-000000000000'::uuid),
    tienda_id,
    periodo
  );

-- Lecturas de la pantalla: serie de una agrupación y serie de una línea.
create index if not exists venta_mensual_estacionalidad_agrupacion_periodo_idx
  on public.venta_mensual_estacionalidad (agrupacion_estacionalidad_id, periodo);
create index if not exists venta_mensual_estacionalidad_linea_periodo_idx
  on public.venta_mensual_estacionalidad (linea_id, periodo);

-- DUEÑO = service_role, para que la función de refresco sea `security invoker`
-- (`refresh materialized view` exige ser dueño). Supabase no deja hacerlo
-- directamente: `service_role` no tiene `create` sobre `public` y el nuevo dueño
-- lo necesita ("permission denied for schema public"). Salida: darle `create` un
-- instante, cambiar el dueño y quitárselo. Las migraciones se aplican en una sola
-- transacción, así que si algo falla entre medias el `grant` se deshace con todo
-- lo demás. `service_role` NO tenía `create` antes (verificado), por lo que el
-- `revoke` deja el esquema exactamente como estaba. El rol que aplica la
-- migración (`postgres`) es miembro de `service_role`, por eso puede volver a
-- crear índices sobre la vista en una segunda pasada.
grant create on schema public to service_role;
alter materialized view public.venta_mensual_estacionalidad owner to service_role;
revoke create on schema public from service_role;

-- Una vista materializada no admite RLS ni `security_invoker`: sin esto
-- `anon` y `authenticated` podrían leerla por PostgREST.
revoke all on public.venta_mensual_estacionalidad from public, anon, authenticated;
grant select on public.venta_mensual_estacionalidad to service_role;

comment on materialized view public.venta_mensual_estacionalidad is
  'M6: venta por agrupacion de estacionalidad, genero, linea, tienda y mes (solo cargas publicadas). Derivada: se llena con refrescar_venta_mensual_estacionalidad(). Sin RLS posible: acceso solo para service_role.';

-- ---------------------------------------------------------------------------
-- 3. `refrescar_venta_mensual_estacionalidad()`
-- ---------------------------------------------------------------------------
-- Refresco SIN `concurrently`: no hay otra sesión leyendo la vista mientras
-- `POST /api/curvas/calcular` la refresca (es lo primero que hace) y `concurrently`
-- exigiría un índice único solo sobre columnas (el nuestro lleva `coalesce`) y
-- guardaría una segunda copia. El refresco normal bloquea las lecturas unos
-- segundos y es más rápido.
-- `security invoker` + `search_path` vacío: la ejecuta solo el backend
-- (`service_role`, dueño de la vista) y el `revoke` quita el acceso por `rpc` a
-- `anon` y `authenticated`. `plpgsql` solo para medir el tiempo.
-- Devuelve { filas, duracion_ms, refrescada_at }; `duracion_ms` mide solo el
-- `refresh`.
create or replace function public.refrescar_venta_mensual_estacionalidad()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inicio timestamptz := clock_timestamp();
  v_fin timestamptz;
  v_filas bigint;
begin
  refresh materialized view public.venta_mensual_estacionalidad;
  v_fin := clock_timestamp();
  select count(*) into v_filas from public.venta_mensual_estacionalidad;
  return jsonb_build_object(
    'filas', v_filas,
    'duracion_ms', round(extract(epoch from (v_fin - v_inicio)) * 1000)::bigint,
    'refrescada_at', v_fin
  );
end;
$$;

revoke execute on function public.refrescar_venta_mensual_estacionalidad() from public, anon, authenticated;
grant execute on function public.refrescar_venta_mensual_estacionalidad() to service_role;

-- ---------------------------------------------------------------------------
-- 4. `venta_mensual_tienda()`
-- ---------------------------------------------------------------------------
-- Venta por tienda y mes (solo cargas publicadas), para ver la red comparable
-- antes de cualquier corrida y sin refrescar la vista. ~11 tiendas × 45 meses =
-- ~500 filas (por debajo del corte de 1 000 de PostgREST). Mismo patrón que
-- `unidades_mensuales` (0014). Solo lectura. Unidades netas (las devoluciones
-- restan).
create or replace function public.venta_mensual_tienda()
returns table (
  tienda_id uuid,
  periodo date,
  unidades bigint,
  venta_soles numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.tienda_id,
    v.periodo,
    coalesce(sum(v.unidades), 0)::bigint as unidades,
    coalesce(sum(v.venta_soles), 0)::numeric as venta_soles
  from public.venta_stock_vigente v
  group by v.tienda_id, v.periodo
  order by v.tienda_id, v.periodo;
$$;

revoke execute on function public.venta_mensual_tienda() from public, anon, authenticated;
grant execute on function public.venta_mensual_tienda() to service_role;

-- ---------------------------------------------------------------------------
-- 5. `corridas_estacionalidad` (una fila por cálculo)
-- ---------------------------------------------------------------------------
-- Las corridas no se editan ni se borran desde la API: son el historial de "qué
-- vio el planner cuando eligió". `activo` queda por convención.
create table if not exists public.corridas_estacionalidad (
  id uuid primary key default gen_random_uuid(),
  -- Último mes usado (primer día del mes, como `cargas_venta_stock.periodo`).
  hasta_periodo date not null
    constraint corridas_estacionalidad_hasta_dia1_check
      check (extract(day from hasta_periodo) = 1),
  -- `Parametros` de la corrida (medida, red comparable, huecos, umbrales).
  parametros jsonb not null,
  -- Salida por agrupación (~250 KB en total); el tope evita filas desbocadas.
  resultado jsonb not null
    constraint corridas_estacionalidad_resultado_size_check
      check (pg_column_size(resultado) < 4000000),
  -- Conteos de la corrida (agrupaciones, años por clase, duración, meses...).
  resumen jsonb not null,
  -- `RedAnio[]`: por año, qué tiendas entraron y cuáles no (y por qué). Aparte de
  -- `resultado` porque es de la corrida y la pantalla la lee sin cargar 250 KB.
  red_comparable jsonb not null default '[]'::jsonb,
  -- Efecto del Niño a nivel de corrida (volumen por temporada y año, cruce
  -- invierno/verano, veredictos). Es lo que lee la pestaña Años Niño y recibirá M7.
  efecto_atipico jsonb not null default '{}'::jsonb,
  perfil_id uuid
    constraint corridas_estacionalidad_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists corridas_estacionalidad_created_at_idx
  on public.corridas_estacionalidad (created_at desc);
create index if not exists corridas_estacionalidad_perfil_id_idx
  on public.corridas_estacionalidad (perfil_id);

create or replace trigger set_updated_at before update on public.corridas_estacionalidad
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. `curvas_estacionalidad` (la curva elegida, versionada)
-- ---------------------------------------------------------------------------
-- Doce columnas `p01..p12` (y no jsonb ni una tabla hija): M7 leerá la curva
-- vigente sin desempaquetar nada y el `check` de la suma vive en la base.
--
-- Transiciones (las hace el backend, sin transacción): la anterior pasa a
-- `reemplazada` y DESPUÉS se inserta la nueva `vigente` con `version + 1`. El
-- único parcial garantiza a lo sumo una curva vigente por agrupación.
--
-- `on delete restrict` desde la agrupación y desde la corrida: no se borra una
-- agrupación con curvas (se desactiva) ni una corrida de la que salió una curva.
create table if not exists public.curvas_estacionalidad (
  id uuid primary key default gen_random_uuid(),
  agrupacion_estacionalidad_id uuid not null
    constraint curvas_estacionalidad_agrupacion_fkey
      references public.agrupaciones_estacionalidad(id) on delete restrict,
  -- 1, 2, 3... por agrupación.
  version integer not null
    constraint curvas_estacionalidad_version_check check (version >= 1),
  estado text not null default 'vigente'
    constraint curvas_estacionalidad_estado_check
      check (estado in ('vigente', 'reemplazada', 'retirada')),
  corrida_id uuid not null
    constraint curvas_estacionalidad_corrida_id_fkey
      references public.corridas_estacionalidad(id) on delete restrict,
  -- Código de la candidata (A...H).
  modelo text not null
    constraint curvas_estacionalidad_modelo_len_check
      check (length(modelo) between 1 and 10),
  origen text not null
    constraint curvas_estacionalidad_origen_check
      check (origen in ('propia', 'prestada')),
  -- Si era la recomendada de la corrida al elegirla (auditoría).
  recomendada boolean not null,
  -- Del backtesting; nulos sin validación.
  eat numeric(6,2),
  error_max numeric(6,2),
  -- [{ anio, clase }]
  anios_utilizados jsonb not null,
  -- Participación de cada mes como fracción.
  p01 numeric(8,6) not null constraint curvas_estacionalidad_p01_check check (p01 between 0 and 1),
  p02 numeric(8,6) not null constraint curvas_estacionalidad_p02_check check (p02 between 0 and 1),
  p03 numeric(8,6) not null constraint curvas_estacionalidad_p03_check check (p03 between 0 and 1),
  p04 numeric(8,6) not null constraint curvas_estacionalidad_p04_check check (p04 between 0 and 1),
  p05 numeric(8,6) not null constraint curvas_estacionalidad_p05_check check (p05 between 0 and 1),
  p06 numeric(8,6) not null constraint curvas_estacionalidad_p06_check check (p06 between 0 and 1),
  p07 numeric(8,6) not null constraint curvas_estacionalidad_p07_check check (p07 between 0 and 1),
  p08 numeric(8,6) not null constraint curvas_estacionalidad_p08_check check (p08 between 0 and 1),
  p09 numeric(8,6) not null constraint curvas_estacionalidad_p09_check check (p09 between 0 and 1),
  p10 numeric(8,6) not null constraint curvas_estacionalidad_p10_check check (p10 between 0 and 1),
  p11 numeric(8,6) not null constraint curvas_estacionalidad_p11_check check (p11 between 0 and 1),
  p12 numeric(8,6) not null constraint curvas_estacionalidad_p12_check check (p12 between 0 and 1),
  -- Medida con la que M7 debe interpretar la curva.
  medida text not null
    constraint curvas_estacionalidad_medida_check
      check (medida in ('unidades', 'venta_soles')),
  perfil_id uuid
    constraint curvas_estacionalidad_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  aprobada_at timestamptz not null default now(),
  nota text
    constraint curvas_estacionalidad_nota_len_check
      check (nota is null or length(nota) <= 300),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- La curva suma 1 (tolerancia por los 6 decimales de cada mes).
  constraint curvas_estacionalidad_suma_check
    check (abs(p01 + p02 + p03 + p04 + p05 + p06 + p07 + p08 + p09 + p10 + p11 + p12 - 1) < 0.0001),
  -- Una sola fila por agrupación y versión. Su primera columna es la agrupación,
  -- así que también cubre el índice de esa clave foránea.
  constraint curvas_estacionalidad_agrupacion_version_key
    unique (agrupacion_estacionalidad_id, version)
);

-- A lo sumo UNA curva vigente por agrupación: la garantía que M7 necesita.
create unique index if not exists curvas_estacionalidad_vigente_uniq
  on public.curvas_estacionalidad (agrupacion_estacionalidad_id)
  where estado = 'vigente';

create index if not exists curvas_estacionalidad_corrida_id_idx
  on public.curvas_estacionalidad (corrida_id);
create index if not exists curvas_estacionalidad_perfil_id_idx
  on public.curvas_estacionalidad (perfil_id);

create or replace trigger set_updated_at before update on public.curvas_estacionalidad
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.corridas_estacionalidad enable row level security;
alter table public.curvas_estacionalidad enable row level security;

revoke all on public.corridas_estacionalidad from public, anon, authenticated;
grant all on public.corridas_estacionalidad to service_role;

revoke all on public.curvas_estacionalidad from public, anon, authenticated;
grant all on public.curvas_estacionalidad to service_role;

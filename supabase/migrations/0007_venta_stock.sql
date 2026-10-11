-- M5 · Carga de venta, costo y stock (histórico mensual).
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` (los cuerpos de función con $$ no son bloques anónimos) para
-- que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN sentencias destructivas (ni en el texto de las funciones). Motivo: las
-- migraciones se aplican con `execute_sql` del MCP de Supabase y cualquier
-- sentencia destructiva se queda esperando una confirmación que nunca llega.
-- `on delete restrict` / `on delete set null` en una FK no cuentan (0002 a
-- 0006 ya pasaron por `execute_sql` con ellas). El borrado de datos viejos es
-- de tiempo de ejecución (handler), nunca de la migración; por eso publicar
-- una carga es un cambio de estado (solo `update`).
--
-- Diseño (docs/modulos/05-venta-stock.md § Modelo de datos, camino B):
--   * Una carga es UN MES COMPLETO que reemplaza ese mes. Cada intento de carga
--     es una fila de `cargas_venta_stock`; los hechos de `venta_stock_mensual`
--     van etiquetados con su `carga_id`.
--   * Solo se ve lo de las cargas `publicada` (vista `venta_stock_vigente`).
--     Un corte a medias deja filas de una carga `en_curso` que nadie lee, y el
--     mes anterior sigue intacto: nunca hay un mes parcial a la vista.
--   * Publicar es un único cambio de estado atómico dentro de una función que
--     antes concilia lo que hay en la base contra lo que el cliente dice
--     haber enviado.
--   * `marcas` NO cambia: la marca va al detalle, con FK, y su agrupación se
--     lee del maestro al agregar.
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Cargas (un intento de carga de un mes)
-- ---------------------------------------------------------------------------
-- Estados y transiciones válidas (las controla el backend, no la base):
--   en_curso   → publicada    (función `publicar_carga_venta_stock`)
--   en_curso   → abandonada   (cancelación o caducidad: 30 min sin tandas)
--   en_curso   → fallida      (no concilió o falló una tanda)
--   publicada  → reemplazada  (la publica otra del mismo mes, en la misma función)
--   publicada  → retirada     (retiro manual de un mes cargado por error)
--
-- Sin `activo`: una carga no se desactiva, cambia de estado.
--
-- Los totales (`filas` … `stock_valorizado`) son los REALMENTE cargados,
-- medidos por la base al publicar (no los dicta el cliente); `null` mientras
-- la carga no esté publicada. `reporte` es la conciliación declarada por el
-- cliente (informativa, auditoría): lo que manda es lo que la base midió.
-- `usuario_nombre` copia el nombre al cargar para que el historial sobreviva
-- si se elimina al usuario (`perfil_id` pasa a null).
-- `limpiada_at` es solo informativa: la fuente de verdad de la limpieza es
-- `cargas_pendientes_limpieza()`, que mira las filas que de verdad quedan.
create table if not exists public.cargas_venta_stock (
  id uuid primary key default gen_random_uuid(),
  -- Primer día del mes.
  periodo date not null
    constraint cargas_venta_stock_periodo_dia1_check
      check (extract(day from periodo) = 1),
  estado text not null default 'en_curso'
    constraint cargas_venta_stock_estado_check
      check (estado in ('en_curso', 'publicada', 'reemplazada', 'retirada', 'abandonada', 'fallida')),
  archivo_nombre text
    constraint cargas_venta_stock_archivo_len_check
      check (archivo_nombre is null or length(archivo_nombre) <= 255),
  perfil_id uuid
    constraint cargas_venta_stock_perfil_id_fkey
      references public.perfiles (id) on delete set null,
  usuario_nombre text,
  filas integer,
  unidades bigint,
  venta_soles numeric(16, 2),
  costo_vendido numeric(16, 2),
  stock_unidades bigint,
  stock_valorizado numeric(16, 2),
  reporte jsonb not null default '{}'::jsonb,
  publicada_at timestamptz,
  limpiada_at timestamptz,
  created_at timestamptz not null default now(),
  -- Cada tanda recibida refresca `updated_at` (latido del candado de 30 min).
  updated_at timestamptz not null default now()
);

-- La garantía central: una sola carga publicada por mes. Es un índice único
-- PARCIAL; `periodo` es not null, así que no hace falta `coalesce`.
create unique index if not exists cargas_periodo_publicada_uniq
  on public.cargas_venta_stock (periodo) where estado = 'publicada';
-- Dos personas no cargan el mismo mes a la vez.
create unique index if not exists cargas_periodo_en_curso_uniq
  on public.cargas_venta_stock (periodo) where estado = 'en_curso';
-- Cubre la FK al perfil.
create index if not exists cargas_perfil_id_idx
  on public.cargas_venta_stock (perfil_id);

create or replace trigger set_updated_at before update on public.cargas_venta_stock
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Hechos: venta, costo y stock por carga × tienda × equivalencia × marca × talla
-- ---------------------------------------------------------------------------
-- EXCEPCIÓN a la convención de PLAN §4: sin `id`, `activo`, `created_at` ni
-- `updated_at`. Las filas son inmutables (solo se insertan y se borran en
-- bloque por carga), la clave primaria compuesta es la clave natural del
-- grano, y un `id uuid` más su índice costarían ~70 MB en 1,5 millones de
-- filas sin usarse. Sin trigger `set_updated_at` por lo mismo.
--
-- No lleva `periodo`: el mes sale de la carga (no se duplica un dato que podría
-- contradecirse) y toda lectura pasa por `venta_stock_vigente`, que la une.
-- Género, mundo y línea se derivan de `equivalencia_id` por el árbol: el
-- histórico sigue la clasificación vigente. La agrupación de la marca se lee
-- de `marcas` al agregar: nada se copia en cada fila.
--
-- FKs `on delete restrict`: una tienda, equivalencia, marca o agrupación de
-- talla con histórico no se puede eliminar (la API responde 409).
--
-- Medidas `not null default 0` para que `sum()` nunca devuelva `null` y una
-- fila "solo stock" no necesite tratamiento especial. Unidades y stock pueden
-- ser negativos (devoluciones, ajustes).
create table if not exists public.venta_stock_mensual (
  carga_id uuid not null
    constraint venta_stock_mensual_carga_id_fkey
      references public.cargas_venta_stock (id) on delete restrict,
  tienda_id uuid not null
    constraint venta_stock_mensual_tienda_id_fkey
      references public.tiendas (id) on delete restrict,
  equivalencia_id uuid not null
    constraint venta_stock_mensual_equivalencia_id_fkey
      references public.equivalencias (id) on delete restrict,
  marca_id uuid not null
    constraint venta_stock_mensual_marca_id_fkey
      references public.marcas (id) on delete restrict,
  agrupacion_talla_id uuid not null
    constraint venta_stock_mensual_agrupacion_talla_id_fkey
      references public.agrupaciones_talla (id) on delete restrict,
  -- Unidades vendidas (puede ser negativa).
  unidades integer not null default 0,
  -- Venta neta de IGV, en soles.
  venta_soles numeric(14, 2) not null default 0,
  costo_vendido numeric(14, 2) not null default 0,
  -- Stock de fin de mes en unidades (`Stk Fin Act`).
  stock_unidades integer not null default 0,
  -- Stock a costo (`Stk Val Act`).
  stock_valorizado numeric(14, 2) not null default 0,
  -- Con `carga_id` primero: todo lo que va por mes (publicar, contar, limpiar,
  -- el stock de un mes) entra por el prefijo y toca solo las filas de esa carga.
  constraint venta_stock_mensual_pkey
    primary key (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id)
);

-- Dos índices de lectura, no más. La serie de UNA equivalencia a lo largo de
-- los meses (M6/M7) y la de UNA marca (M7); además cubren la FK al eliminar
-- una equivalencia o una marca. NO se indexan `tienda_id` (~15 valores; M8 lee
-- el stock por mes, que ya resuelve `carga_id`) ni `agrupacion_talla_id` (dos
-- valores): un índice ahí no discrimina nada y cada uno costaría ~75 MB. El
-- advisor `unindexed_foreign_keys` marcará esas dos FK: es esperado.
create index if not exists venta_stock_mensual_equivalencia_idx
  on public.venta_stock_mensual (equivalencia_id, carga_id);
create index if not exists venta_stock_mensual_marca_idx
  on public.venta_stock_mensual (marca_id, carga_id);

-- ---------------------------------------------------------------------------
-- 3. Vista `venta_stock_vigente`: la única puerta de lectura del histórico
-- ---------------------------------------------------------------------------
-- Filas de las cargas `publicada`, con el `periodo` de la carga. Leer
-- `venta_stock_mensual` directamente contaría doble los meses recargados.
--
-- `security_invoker = true` (Postgres ≥ 15): sin eso, una vista en `public` se
-- lee con los permisos de su dueño y salta el RLS (cualquiera con la clave
-- anónima la consultaría). Con la opción, `anon` y `authenticated` obtienen
-- CERO filas (RLS sin políticas); el `service_role` del backend salta el RLS
-- y las lee completas.
create or replace view public.venta_stock_vigente
with (security_invoker = true) as
select
  c.periodo,
  m.carga_id,
  m.tienda_id,
  m.equivalencia_id,
  m.marca_id,
  m.agrupacion_talla_id,
  m.unidades,
  m.venta_soles,
  m.costo_vendido,
  m.stock_unidades,
  m.stock_valorizado
from public.venta_stock_mensual m
join public.cargas_venta_stock c on c.id = m.carga_id
where c.estado = 'publicada';

-- ---------------------------------------------------------------------------
-- 4. Funciones (solo `update` y consultas; security invoker, search_path vacío)
-- ---------------------------------------------------------------------------
-- 4.1 Publicar una carga: concilia y, si cuadra, cambia estados en una sola
-- transacción (la función entera lo es).
--
-- El orden de los dos `update` (primero la carga publicada anterior, luego
-- esta) es lo que respeta el índice único parcial `cargas_periodo_publicada_uniq`.
-- Si no concilia devuelve `no_concilia` SIN cambiar nada. Una carga que no
-- existe se trata como `no_en_curso`.
create or replace function public.publicar_carga_venta_stock(
  p_carga uuid,
  p_filas bigint,
  p_unidades bigint,
  p_venta numeric,
  p_costo numeric,
  p_stock_unidades bigint,
  p_stock_valorizado numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_carga public.cargas_venta_stock%rowtype;
  v_filas bigint;
  v_unidades bigint;
  v_venta numeric;
  v_costo numeric;
  v_stock_unidades bigint;
  v_stock_valorizado numeric;
  v_medido jsonb;
  v_prev_id uuid;
  v_prev_filas integer;
begin
  -- Bloquea la fila de la carga: dos publicaciones simultáneas se serializan.
  select * into v_carga
  from public.cargas_venta_stock
  where id = p_carga
  for update;

  if not found or v_carga.estado <> 'en_curso' then
    return jsonb_build_object('ok', false, 'motivo', 'no_en_curso');
  end if;

  -- Lo que hay de verdad en la base (por el prefijo `carga_id` de la PK).
  select
    count(*),
    coalesce(sum(unidades), 0),
    coalesce(sum(venta_soles), 0),
    coalesce(sum(costo_vendido), 0),
    coalesce(sum(stock_unidades), 0),
    coalesce(sum(stock_valorizado), 0)
  into v_filas, v_unidades, v_venta, v_costo, v_stock_unidades, v_stock_valorizado
  from public.venta_stock_mensual
  where carga_id = p_carga;

  v_medido := jsonb_build_object(
    'filas', v_filas,
    'unidades', v_unidades,
    'venta_soles', v_venta,
    'costo_vendido', v_costo,
    'stock_unidades', v_stock_unidades,
    'stock_valorizado', v_stock_valorizado
  );

  -- Coincidencia exacta; `is distinct from` hace que un parámetro nulo no concilie.
  if v_filas is distinct from p_filas
     or v_unidades is distinct from p_unidades
     or v_venta is distinct from p_venta
     or v_costo is distinct from p_costo
     or v_stock_unidades is distinct from p_stock_unidades
     or v_stock_valorizado is distinct from p_stock_valorizado then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'no_concilia',
      'esperado', jsonb_build_object(
        'filas', p_filas,
        'unidades', p_unidades,
        'venta_soles', p_venta,
        'costo_vendido', p_costo,
        'stock_unidades', p_stock_unidades,
        'stock_valorizado', p_stock_valorizado
      ),
      'medido', v_medido
    );
  end if;

  -- Primero la vieja publicada del mismo mes (si hay) pasa a reemplazada...
  update public.cargas_venta_stock
  set estado = 'reemplazada'
  where periodo = v_carga.periodo
    and estado = 'publicada'
    and id <> p_carga
  returning id, filas into v_prev_id, v_prev_filas;

  -- ...y después esta pasa a publicada con sus totales medidos.
  update public.cargas_venta_stock
  set estado = 'publicada',
      filas = v_filas::integer,
      unidades = v_unidades,
      venta_soles = v_venta,
      costo_vendido = v_costo,
      stock_unidades = v_stock_unidades,
      stock_valorizado = v_stock_valorizado,
      publicada_at = now()
  where id = p_carga;

  return jsonb_build_object(
    'ok', true,
    'medido', v_medido,
    'reemplaza', case
      when v_prev_id is null then null
      else jsonb_build_object('id', v_prev_id, 'filas', v_prev_filas)
    end
  );
end;
$$;

-- 4.2 Totales recalculados desde los hechos de cada carga publicada (un
-- escaneo con `group by`). Lo usa `GET /api/ventas/cargas?verificar=1` para
-- marcar los meses cuyos totales guardados difieran de los medidos. `left
-- join`: una carga publicada que se hubiera quedado sin filas sale con ceros
-- en vez de desaparecer.
create or replace function public.totales_cargas_publicadas()
returns table (
  carga_id uuid,
  periodo date,
  filas bigint,
  unidades bigint,
  venta_soles numeric,
  costo_vendido numeric,
  stock_unidades bigint,
  stock_valorizado numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.periodo,
    count(m.carga_id)::bigint,
    coalesce(sum(m.unidades), 0)::bigint,
    coalesce(sum(m.venta_soles), 0)::numeric,
    coalesce(sum(m.costo_vendido), 0)::numeric,
    coalesce(sum(m.stock_unidades), 0)::bigint,
    coalesce(sum(m.stock_valorizado), 0)::numeric
  from public.cargas_venta_stock c
  left join public.venta_stock_mensual m on m.carga_id = c.id
  where c.estado = 'publicada'
  group by c.id, c.periodo
  order by c.periodo
$$;

-- 4.3 Cargas en estado terminal que TODAVÍA tienen filas. Es la fuente de
-- verdad de la limpieza (el handler las elimina por carga): una fila que
-- aterrizara tarde, justo después de abandonar la carga, no se queda invisible
-- para siempre. Cada conteo entra por el prefijo `carga_id` de la PK
-- (instantáneo cuando la carga ya está vacía).
create or replace function public.cargas_pendientes_limpieza()
returns table (
  carga_id uuid,
  estado text,
  filas bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.estado, n.filas
  from public.cargas_venta_stock c
  cross join lateral (
    select count(*) as filas
    from public.venta_stock_mensual m
    where m.carga_id = c.id
  ) n
  where c.estado in ('reemplazada', 'retirada', 'abandonada', 'fallida')
    and n.filas > 0
  order by c.created_at
$$;

-- Por defecto Supabase deja ejecutables por `rpc` las funciones de `public` para
-- `anon` y `authenticated` (privilegios por defecto); una función de
-- publicación abierta a la clave anónima sería una puerta trasera. Solo el
-- backend (service_role) las ejecuta. Los revoke y grant son idempotentes.
revoke execute on function public.publicar_carga_venta_stock(uuid, bigint, bigint, numeric, numeric, bigint, numeric)
  from public, anon, authenticated;
revoke execute on function public.totales_cargas_publicadas()
  from public, anon, authenticated;
revoke execute on function public.cargas_pendientes_limpieza()
  from public, anon, authenticated;

grant execute on function public.publicar_carga_venta_stock(uuid, bigint, bigint, numeric, numeric, bigint, numeric)
  to service_role;
grant execute on function public.totales_cargas_publicadas()
  to service_role;
grant execute on function public.cargas_pendientes_limpieza()
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.cargas_venta_stock enable row level security;
alter table public.venta_stock_mensual enable row level security;

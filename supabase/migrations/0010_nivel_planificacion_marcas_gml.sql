-- M2b · Nivel de planificación (GML/GMLE), marcas relevantes por GML y
-- conjuntos de marcas (versión 0.8.3).
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` (los cuerpos de función usan comillas de dólar, que no son
-- bloques anónimos) para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN sentencias destructivas ni de modificación de datos: ni DROP, ni DELETE,
-- ni TRUNCATE, ni UPDATE (tampoco dentro de las funciones). Motivo: las
-- migraciones se aplican con `execute_sql` del MCP de Supabase y cualquier
-- sentencia destructiva se queda esperando una confirmación que nunca llega.
-- No hay backfill: las columnas nuevas llevan `default` o `null`, y toda
-- lectura aplica una regla (`modalidadEfectiva`, `marcas_unidad`).
-- `on delete restrict` / `cascade` en una FK no cuentan (0002 a 0009 ya
-- pasaron por `execute_sql` con ellas).
--
-- Diseño (docs/modulos/02b-marcas-tratamiento-gml.md § Modelo de datos):
--   * El nivel de planificación (GML | GMLE) es una propiedad del nodo
--     `genero_mundo_linea`, no una tabla aparte.
--   * La marca relevante por GML (nivel B) es un par marca × nodo en
--     `marca_gml_especial`; la modalidad (`por_gml` | `barrido`) vive en la marca.
--   * Un CONJUNTO de marcas es una marca cabeza (`marcas.conjunto_marca_id`):
--     la unidad de marca es `coalesce(cabeza activa, la marca)`. Se aplica AL
--     LEER (vista `marcas_unidad`); la venta de M5 sigue al detalle de marca.
--   * `tratamiento_especial` y `nota_tratamiento` (0002) se conservan tal cual.
--   * RLS activo y SIN políticas en la tabla nueva: solo entra el backend con
--     service_role. Las vistas son `security_invoker` y además se les revoca
--     el acceso a `anon` y `authenticated` (ver sección 6).
--   * Todos los nombres de constraint e índice miden ≤ 63 caracteres (el
--     límite de identificadores de Postgres).

-- ---------------------------------------------------------------------------
-- 1. `genero_mundo_linea.nivel_planificacion` (M1)
-- ---------------------------------------------------------------------------
-- `GML` (por defecto): el flujo del nodo es una sola unidad. `GMLE`: el nodo se
-- abre y cada equivalencia activa es una unidad. El `default` rellena los nodos
-- existentes sin reescribir ni `update` (Postgres ≥ 11). Cambiar el nivel no
-- toca equivalencias, curvas (M3/M6) ni hechos (M5). Sin índice: dos valores y
-- unos cientos de filas; el filtro "abiertos a GMLE" se hace en memoria.
-- Si la columna ya existe, `add column if not exists` omite también el check
-- inline, así que repetir la migración no duplica nada.
alter table public.genero_mundo_linea
  add column if not exists nivel_planificacion text not null default 'GML'
    constraint genero_mundo_linea_nivel_check
      check (nivel_planificacion in ('GML', 'GMLE'));

-- ---------------------------------------------------------------------------
-- 2. `marcas`: modalidad del tratamiento y conjunto (M2)
-- ---------------------------------------------------------------------------
-- 2.1 `modalidad_tratamiento`: `por_gml` (relevante en los GML asignados) o
-- `barrido` (flujo propio sin detalle por GML). Nula sin casilla. Sin default.
--
-- El segundo check va en UN SOLO SENTIDO (modalidad ⇒ casilla). El sentido
-- inverso (casilla ⇒ modalidad) exigiría rellenar antes las marcas ya marcadas,
-- es decir un `update` en la migración. Lo garantiza la API (toda escritura que
-- enciende la casilla escribe una modalidad) y toda lectura pasa por
-- `modalidadEfectiva`: casilla con modalidad nula se lee como `barrido`.
--
-- 2.2 `conjunto_marca_id`: la cabeza del conjunto a la que pertenece esta marca
-- (ALFA JEANS → ALFA). `null` = no pertenece a ninguno, que es el estado de
-- todas las marcas al aplicar. `on delete restrict`: eliminar una cabeza con
-- miembros se rechaza (la API responde 409); eliminar un miembro no afecta a
-- nadie. El check impide apuntarse a sí misma. Lo que un `check` no puede
-- garantizar (no cruza filas) lo hace cumplir la API: la cabeza no es miembro
-- de otro conjunto (sin cadenas), un miembro no tiene miembros, y VARIOS, OTROS
-- y SIN MARCA no entran en conjuntos. Si alguien crea una cadena desde el SQL
-- Editor, `marcas_unidad` resuelve un solo nivel.
alter table public.marcas
  add column if not exists modalidad_tratamiento text
    constraint marcas_modalidad_valor_check
      check (modalidad_tratamiento is null or modalidad_tratamiento in ('por_gml', 'barrido'))
    constraint marcas_modalidad_sin_tratamiento_check
      check (modalidad_tratamiento is null or tratamiento_especial);

alter table public.marcas
  add column if not exists conjunto_marca_id uuid
    constraint marcas_conjunto_marca_id_fkey
      references public.marcas(id) on delete restrict
    constraint marcas_conjunto_no_propio_check
      check (conjunto_marca_id is null or conjunto_marca_id <> id);

-- "¿Qué miembros tiene ALFA?", el conteo al rechazar el DELETE de la cabeza y
-- la unión de `marcas_unidad`. Cubre además la FK.
create index if not exists marcas_conjunto_marca_id_idx
  on public.marcas (conjunto_marca_id);

-- ---------------------------------------------------------------------------
-- 3. `marca_gml_especial` (marcas relevantes por GML, nivel B)
-- ---------------------------------------------------------------------------
-- Un par marca × nodo género-mundo-línea: dentro de ese GML, y de la agrupación
-- de marca de la marca, esa marca se muestra y se planifica aparte; las demás
-- son "otras de la agrupación". La relevancia se asigna a la UNIDAD (la cabeza
-- ALFA, nunca ALFA JEANS mientras sea miembro): lo cumple la API; una fila
-- propia de un miembro se conserva y se lee como ignorada.
--
-- Las dos FK difieren a propósito:
--   * `marca_id` → `on delete cascade`. La relevancia es un atributo de la marca
--     (mismo criterio que `responsables_genero_mundo.perfil_id`): eliminar una
--     marca (solo posible sin venta, M5) se lleva sus GML y el `confirm` lo dice.
--   * `genero_mundo_linea_id` → `on delete restrict`. El nodo es árbol y no
--     arrastra configuración: eliminar un nodo con marcas relevantes responde 409.
--
-- Qué NO se guarda: ni la vigencia (se calcula con el estado del árbol y de la
-- marca), ni la agrupación de la marca (se lee de `marcas`), ni la equivalencia
-- (la relevancia es por GML), ni un orden o "principal".
--
-- `activo` existe solo por la convención de PLAN §4 y NO SE USA en la API
-- (como `responsables_genero_mundo`): quitar borra la fila y las lecturas tratan
-- `activo = false` (solo desde el SQL Editor) como ausente.
create table if not exists public.marca_gml_especial (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null
    constraint marca_gml_especial_marca_id_fkey
    references public.marcas(id) on delete cascade,
  genero_mundo_linea_id uuid not null
    constraint marca_gml_especial_gml_id_fkey
    references public.genero_mundo_linea(id) on delete restrict,
  nota text
    constraint marca_gml_especial_nota_len_check
      check (nota is null or length(nota) between 1 and 200),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un par marca × nodo una sola vez. Ambas columnas son `not null`, así que no
-- hace falta `coalesce`. Sobre COLUMNAS (no expresiones) para que PostgREST lo
-- admita en `onConflict: "marca_id,genero_mundo_linea_id"` del `upsert`. Con
-- `marca_id` al frente cubre también la FK hacia `marcas`.
create unique index if not exists marca_gml_especial_par_uniq
  on public.marca_gml_especial (marca_id, genero_mundo_linea_id);
-- Vista inversa (marcas relevantes de un GML) y comprobación de la FK al
-- eliminar un nodo.
create index if not exists marca_gml_especial_gml_idx
  on public.marca_gml_especial (genero_mundo_linea_id);

create or replace trigger set_updated_at before update on public.marca_gml_especial
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Vistas (security_invoker)
-- ---------------------------------------------------------------------------
-- `security_invoker = true`: sin eso una vista en `public` se lee con los
-- permisos de su dueño y salta el RLS. Con la opción, y sobre tablas con RLS sin
-- políticas, `anon` y `authenticated` no ven filas; el `service_role` del
-- backend salta el RLS y las lee completas. Además se revoca el acceso directo
-- en la sección 6.

-- 4.1 `marcas_unidad`: la unidad de marca de cada marca. Una sola definición de
-- "conjunto efectivo" para M7, M8, la vista de abajo y la función de sugerencias.
--   * Conjunto efectivo = la cabeza existe y está ACTIVA. La membresía de una
--     marca desactivada sigue valiendo (su venta histórica se queda en el
--     conjunto): solo se mira `c.activo`, no `m.activo`.
--   * Cabeza inactiva: los miembros vuelven a contar como ellos mismos
--     (`cabeza_inactiva`); al reactivarla el conjunto vuelve. Nada se borra.
--   * Una cabeza no tiene bandera: es la marca con `unidad_marca_id = marca_id`
--     que figura como `unidad_marca_id` de al menos otra fila.
--   * Resuelve UN SOLO nivel (A → B → C cuenta A como B): la API no crea
--     cadenas y un `check` no puede impedirlas.
create or replace view public.marcas_unidad
with (security_invoker = true) as
select
  m.id as marca_id,
  case when c.id is not null and c.activo then c.id else m.id end as unidad_marca_id,
  (c.id is not null and c.activo) as en_conjunto,
  (c.id is not null and not c.activo) as cabeza_inactiva
from public.marcas m
left join public.marcas c on c.id = m.conjunto_marca_id;

-- 4.2 `marca_gml_especial_vigente`: contrato SQL para M7 y M8. Una fila por
-- UNIDAD de marca al barrer (`genero_mundo_linea_id` nulo) y una por par
-- unidad × GML vigente. Solo las unidades (marcas que son su propia unidad:
-- cabezas y marcas sueltas): la configuración propia de un miembro no aparece.
-- Vigente = marca activa, su agrupación activa, casilla encendida y, para el par,
-- modalidad `por_gml` y nodo, género, mundo y línea activos.
-- Una marca `por_gml` sin ningún GML vigente no aparece (va a "otras de la
-- agrupación" y la pantalla la persigue como pendiente). Casilla con modalidad
-- nula se lee como `barrido` (`coalesce`).
create or replace view public.marca_gml_especial_vigente
with (security_invoker = true) as
select
  m.id as marca_id,
  m.agrupacion_marca_id,
  'barrido'::text as modalidad,
  null::uuid as genero_mundo_linea_id
from public.marcas m
join public.marcas_unidad u on u.marca_id = m.id and u.unidad_marca_id = m.id
join public.agrupaciones_marca am on am.id = m.agrupacion_marca_id
where m.activo
  and am.activo
  and m.tratamiento_especial
  and coalesce(m.modalidad_tratamiento, 'barrido') = 'barrido'
union all
select
  m.id,
  m.agrupacion_marca_id,
  'por_gml',
  a.genero_mundo_linea_id
from public.marca_gml_especial a
join public.marcas m on m.id = a.marca_id
join public.marcas_unidad u on u.marca_id = m.id and u.unidad_marca_id = m.id
join public.agrupaciones_marca am on am.id = m.agrupacion_marca_id
join public.genero_mundo_linea n on n.id = a.genero_mundo_linea_id
join public.generos g on g.id = n.genero_id
join public.mundos mu on mu.id = n.mundo_id
join public.lineas l on l.id = n.linea_id
where a.activo
  and m.activo
  and am.activo
  and m.tratamiento_especial
  and m.modalidad_tratamiento = 'por_gml'
  and n.activo
  and g.activo
  and mu.activo
  and l.activo;

-- ---------------------------------------------------------------------------
-- 5. Función `sugerir_marcas_relevantes` (solo ayuda: nunca escribe)
-- ---------------------------------------------------------------------------
-- Agrega `venta_stock_vigente` entre `p_desde` y `p_hasta` (primer día de mes,
-- inclusive) por nodo (vía `equivalencias.genero_mundo_linea_id`), UNIDAD de
-- marca (vía `marcas_unidad`: ALFA JEANS suma en ALFA) y la agrupación de la
-- unidad (la de la cabeza, no la del miembro). Devuelve las `p_top` primeras por
-- `venta_soles` dentro de cada (nodo, agrupación).
--   * `p_excluir`: ids de VARIOS, OTROS y SIN MARCA (que M5 fija en MID VALUE y
--     no se planifican aparte). Se excluyen ANTES de agregar, de modo que
--     `participacion` = venta ÷ Σ venta de las marcas NO excluidas de esa
--     agrupación en ese nodo (suma 1 si `p_top` cubre todas). `null` = ninguna.
--   * `p_top` nulo = 4 (lo que habló Javier: 3 o 4 relevantes).
--   * `participacion` va con 6 decimales; 0 si el total de la agrupación en el
--     nodo no es positivo (devoluciones netas) para no dividir entre cero ni
--     devolver negativos.
--   * `rango` por `row_number()`; empate en venta → desempata por id de marca
--     para que el resultado sea determinista.
--
-- `security invoker` y `search_path` vacío, como las tres de 0007: la ejecuta
-- solo el backend (service_role, que salta el RLS) y el `revoke` quita el
-- acceso por `rpc` a `anon` y `authenticated`. Es lectura pura (`stable`).
-- Toda la agregación va en SQL (decisión de M5: ninguna lectura del histórico
-- trae filas a Node).
create or replace function public.sugerir_marcas_relevantes(
  p_desde date,
  p_hasta date,
  p_top integer,
  p_excluir uuid[]
)
returns table (
  genero_mundo_linea_id uuid,
  agrupacion_marca_id uuid,
  marca_id uuid,
  unidades bigint,
  venta_soles numeric,
  participacion numeric,
  rango integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with agregado as (
    select
      e.genero_mundo_linea_id as gml_id,
      c.agrupacion_marca_id as agr_id,
      u.unidad_marca_id as unidad_id,
      sum(v.unidades)::bigint as unidades,
      sum(v.venta_soles)::numeric as venta_soles
    from public.venta_stock_vigente v
    join public.equivalencias e on e.id = v.equivalencia_id
    join public.marcas_unidad u on u.marca_id = v.marca_id
    join public.marcas c on c.id = u.unidad_marca_id
    where v.periodo >= p_desde
      and v.periodo <= p_hasta
      and not (u.unidad_marca_id = any (coalesce(p_excluir, '{}'::uuid[])))
    group by e.genero_mundo_linea_id, c.agrupacion_marca_id, u.unidad_marca_id
  ),
  ordenado as (
    select
      a.*,
      sum(a.venta_soles) over (partition by a.gml_id, a.agr_id) as total,
      row_number() over (
        partition by a.gml_id, a.agr_id
        order by a.venta_soles desc, a.unidad_id
      ) as rn
    from agregado a
  )
  select
    o.gml_id,
    o.agr_id,
    o.unidad_id,
    o.unidades,
    o.venta_soles,
    case when o.total > 0 then round(o.venta_soles / o.total, 6) else 0::numeric end,
    o.rn::integer
  from ordenado o
  where o.rn <= coalesce(p_top, 4)
  order by o.gml_id, o.agr_id, o.rn
$$;

-- ---------------------------------------------------------------------------
-- 6. Permisos
-- ---------------------------------------------------------------------------
-- Por defecto Supabase deja `select` sobre lo nuevo de `public` para `anon` y
-- `authenticated` (privilegios por defecto) y ejecutables por `rpc` las
-- funciones. Aquí solo lee el backend con service_role: se cierra todo lo demás.
-- Los revoke y grant son idempotentes.
revoke all on public.marcas_unidad from public, anon, authenticated;
revoke all on public.marca_gml_especial_vigente from public, anon, authenticated;
grant select on public.marcas_unidad to service_role;
grant select on public.marca_gml_especial_vigente to service_role;

revoke execute on function public.sugerir_marcas_relevantes(date, date, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.sugerir_marcas_relevantes(date, date, integer, uuid[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
-- `genero_mundo_linea` y `marcas` ya lo tienen desde 0001 y 0002; repetirlo es
-- inocuo.
alter table public.marca_gml_especial enable row level security;

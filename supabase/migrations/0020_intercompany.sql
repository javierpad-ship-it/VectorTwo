-- M13 · Intercompany: cobertura esperada por marca x GML y reposición directa
-- (versión 0.12.0).
--
-- Ficha: docs/modulos/13-intercompany.md (§ 6 "Modelo de datos"). La ficha ya
-- pasó revisión independiente. Numeración: la 0019 fue la de M12; esta es la
-- siguiente libre.
--
-- Qué crea:
--   1. `intercompany_reglas`: una regla por marca x GML [x equivalencia] x mes de
--      vigencia, con la cobertura esperada (mínimo y tope, en meses) y el
--      porcentaje de la demanda que llega directo del intercompany.
--   2. La vista `intercompany_vigente`: cada regla con su "hasta" derivado.
--
-- Idempotente: `create table if not exists`, `create or replace view`,
-- `create index if not exists`, `create or replace trigger`, `revoke`/`grant`/
-- `comment` repetibles. Sin bloques `do $$ ... $$`: el SQL Editor de Supabase la
-- acepta tal cual. Sin seed: las reglas las escribe el planner (decenas de filas).
--
-- SIN DROP, DELETE, TRUNCATE ni UPDATE: las migraciones se aplican con
-- `execute_sql` del MCP de Supabase y esas sentencias se quedan esperando una
-- confirmación que nunca llega. (Eliminar una regla desde la app es un DELETE de
-- la API con service_role; no es una migración.)
--
-- Criterio I9 de la ficha: la base solo lleva invariantes ESTRUCTURALES (no
-- negativos, primer día de mes, un porcentaje entre 0 y 100). Que el tope sea >=
-- el mínimo, que ambos estén entre 0,5 y 24 meses y los catálogos los valida zod,
-- para poder aflojarlos sin `DROP constraint`.
--
-- Seguridad: RLS activo y SIN políticas en la tabla nueva; `revoke` explícito a
-- `public`, `anon` y `authenticated` y `grant` a `service_role` sobre CADA objeto
-- nuevo (convención de 0013 a 0019). La vista es `security_invoker`.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `intercompany_reglas`
-- ---------------------------------------------------------------------------
-- Las reglas de una CLAVE (marca, GML, equivalencia opcional) forman una secuencia
-- por `vigente_desde`: la vigente en un mes `m` es la de mayor `vigente_desde <= m`.
-- NO hay `vigente_hasta` guardado: se deriva (vista y `hastaDerivado` en TS), así
-- no puede contradecir a la regla siguiente. Antes de la primera regla de una
-- clave no hay subflujo intercompany. Una regla con `pct_directo = 0` y la
-- cobertura general "termina" un acuerdo desde ese mes.
--
-- La marca es una UNIDAD de marca (la cabeza del conjunto: JH = JOHN HOLDEN +
-- JOHN); la API rechaza un miembro (`409 marca_en_conjunto`) y VARIOS / OTROS /
-- SIN MARCA (`409 marca_generica`), y que la equivalencia pertenezca al nodo
-- (`409 equivalencia_de_otro_nodo`): un check no cruza filas. No hay bandera
-- "intercompany" en `marcas`: la lista de marcas intercompany se deriva de las
-- reglas.
--
-- FKs `on delete restrict`: no se elimina una marca, un nodo ni una equivalencia
-- que una regla usa (la API traduce el 23503 a 409). `perfil_id` es `set null`: el
-- nombre (`usuario_nombre`) queda como foto de quién la creó o editó por última vez.
--
-- `vigente_desde` primer día de mes: se comprueba con `extract(day ...) = 1`, igual
-- que `proyecciones.hasta_periodo` (0018); es equivalente a comparar con
-- `date_trunc('month', ...)` pero no depende de la zona horaria de la sesión.
--
-- `cobertura_*_meses` `numeric(4,1)` (un decimal, hasta 999,9) y `pct_directo`
-- `numeric(5,2)` (0 a 100,00). `activo` va por convención y sin uso: eliminar borra
-- la fila (las lecturas tratan `activo = false`, solo posible desde el SQL Editor,
-- como regla inexistente).
create table if not exists public.intercompany_reglas (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null
    constraint intercompany_reglas_marca_id_fkey
      references public.marcas(id) on delete restrict,
  genero_mundo_linea_id uuid not null
    constraint intercompany_reglas_gml_id_fkey
      references public.genero_mundo_linea(id) on delete restrict,
  -- Nulo = la regla es del GML entero; no nulo = de esa equivalencia (nodo GMLE).
  -- La más específica manda.
  equivalencia_id uuid
    constraint intercompany_reglas_equivalencia_id_fkey
      references public.equivalencias(id) on delete restrict,
  vigente_desde date not null
    constraint intercompany_reglas_vigente_desde_check
      check (extract(day from vigente_desde) = 1),
  cobertura_min_meses numeric(4, 1) not null
    constraint intercompany_reglas_cobertura_min_check
      check (cobertura_min_meses >= 0),
  cobertura_max_meses numeric(4, 1) not null
    constraint intercompany_reglas_cobertura_max_check
      check (cobertura_max_meses >= 0),
  pct_directo numeric(5, 2) not null default 0
    constraint intercompany_reglas_pct_directo_check
      check (pct_directo between 0 and 100),
  nota text
    constraint intercompany_reglas_nota_len_check
      check (nota is null or length(nota) between 1 and 200),
  perfil_id uuid
    constraint intercompany_reglas_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Una regla por clave y mes. Es un índice único de EXPRESIÓN porque
-- `equivalencia_id` admite nulo y dos NULL no chocan en un UNIQUE normal: sin el
-- `coalesce`, dos reglas del GML entero para el mismo mes serían válidas. Con
-- `marca_id` al frente cubre también la FK a `marcas`.
create unique index if not exists intercompany_reglas_clave_uniq
  on public.intercompany_reglas (
    marca_id,
    genero_mundo_linea_id,
    coalesce(equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid),
    vigente_desde
  );

-- Reglas de un nodo (la lectura inversa y la comprobación de la FK al eliminar un
-- nodo) y de una marca.
create index if not exists intercompany_reglas_gml_idx
  on public.intercompany_reglas (genero_mundo_linea_id);
create index if not exists intercompany_reglas_marca_idx
  on public.intercompany_reglas (marca_id);
-- Cubren las otras dos FK (eliminar una equivalencia o un perfil comprueba estas
-- columnas).
create index if not exists intercompany_reglas_equivalencia_id_idx
  on public.intercompany_reglas (equivalencia_id);
create index if not exists intercompany_reglas_perfil_id_idx
  on public.intercompany_reglas (perfil_id);

create or replace trigger set_updated_at before update on public.intercompany_reglas
  for each row execute function public.tg_set_updated_at();

comment on table public.intercompany_reglas is
  'M13 0.12.0: regla intercompany por marca x GML [x equivalencia] desde un mes (vigente_desde): cobertura esperada minima y tope en meses y porcentaje de la demanda que llega directo por compras regulares. Sin vigente_hasta: se deriva de la regla siguiente de la misma clave. pct_directo = 0 termina un acuerdo. La mas especifica (equivalencia) manda sobre la del GML.';
comment on column public.intercompany_reglas.pct_directo is
  'Porcentaje (0 a 100) de la demanda de la marca en ese GML que se espera que llegue directo del intercompany; M8 lo usa como reposicion directa esperada (ingreso), no como recorte de demanda ni de stock.';

-- ---------------------------------------------------------------------------
-- 2. Vista `intercompany_vigente`
-- ---------------------------------------------------------------------------
-- Contrato SQL opcional para M8 (en código, `leerReglasIntercompany(db)` trae todas
-- las reglas, que son pocas, y `reglaIntercompany` resuelve en TypeScript). Una fila
-- por regla ACTIVA con:
--   * `hasta_derivado`: el mes anterior al `vigente_desde` de la regla siguiente de
--     la MISMA CLAVE EXACTA (marca, nodo, equivalencia nula contada como una sola
--     clave), o nulo si está abierta. Una regla de una equivalencia no cierra la
--     del GML (ficha, regla 3).
--   * los nombres de la marca, del nodo (género, mundo, línea, nivel) y de la
--     equivalencia.
-- La ventana `lead()` se calcula ANTES de unir los nombres y solo sobre reglas
-- activas, de modo que una regla inactiva no cierra a ninguna. El `coalesce` de la
-- partición usa el mismo uuid cero que el índice único.
--
-- `security_invoker = true`: sin eso, una vista en `public` se lee con los permisos
-- de su dueño y salta el RLS. Además se revoca el acceso a `anon`/`authenticated`.
create or replace view public.intercompany_vigente
with (security_invoker = true) as
select
  r.id,
  r.marca_id,
  m.nombre as marca_nombre,
  r.genero_mundo_linea_id,
  n.genero_id,
  n.mundo_id,
  n.linea_id,
  n.nivel_planificacion,
  g.nombre as genero_nombre,
  mu.nombre as mundo_nombre,
  l.nombre as linea_nombre,
  r.equivalencia_id,
  e.nombre as equivalencia_nombre,
  r.vigente_desde,
  (r.siguiente_desde - interval '1 month')::date as hasta_derivado,
  r.cobertura_min_meses,
  r.cobertura_max_meses,
  r.pct_directo,
  r.nota,
  r.perfil_id,
  r.usuario_nombre,
  r.created_at,
  r.updated_at
from (
  select
    ir.id,
    ir.marca_id,
    ir.genero_mundo_linea_id,
    ir.equivalencia_id,
    ir.vigente_desde,
    ir.cobertura_min_meses,
    ir.cobertura_max_meses,
    ir.pct_directo,
    ir.nota,
    ir.perfil_id,
    ir.usuario_nombre,
    ir.created_at,
    ir.updated_at,
    lead(ir.vigente_desde) over (
      partition by
        ir.marca_id,
        ir.genero_mundo_linea_id,
        coalesce(ir.equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by ir.vigente_desde
    ) as siguiente_desde
  from public.intercompany_reglas ir
  where ir.activo
) r
join public.marcas m on m.id = r.marca_id
join public.genero_mundo_linea n on n.id = r.genero_mundo_linea_id
join public.generos g on g.id = n.genero_id
join public.mundos mu on mu.id = n.mundo_id
join public.lineas l on l.id = n.linea_id
left join public.equivalencias e on e.id = r.equivalencia_id;

comment on view public.intercompany_vigente is
  'M13 0.12.0: una fila por regla intercompany activa con hasta_derivado (mes anterior a la regla siguiente de la misma clave exacta marca x nodo x equivalencia; nulo = abierta) y los nombres de marca, nodo y equivalencia.';

-- ---------------------------------------------------------------------------
-- 3. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.intercompany_reglas enable row level security;

revoke all on public.intercompany_reglas from public, anon, authenticated;
grant all on public.intercompany_reglas to service_role;

revoke all on public.intercompany_vigente from public, anon, authenticated;
grant select on public.intercompany_vigente to service_role;

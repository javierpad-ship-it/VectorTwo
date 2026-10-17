-- M7 07c + 07d · Crecimientos del año siguiente por género x mundo (versión 0.10.8).
--
-- Fichas: docs/modulos/07c-crecimientos-por-genero-mundo.md (§2 Modelo de datos) y
-- docs/modulos/07d-venta-esperada-tienda-nueva.md (§3, el `comment on column`).
-- Numeración: la 0022 fue la última (M6 06c); esta es la siguiente libre. La ficha
-- 07c la llama `0023_proyeccion_crecimientos`; el archivo lleva el nombre acordado
-- con el encargo (`0023_crecimientos_por_genero_mundo`).
--
-- Qué hace:
--   1. Tabla `proyeccion_crecimientos`: una fila por celda género x mundo (GM) de
--      la matriz de crecimientos de una proyección.
--   2. Dos columnas nuevas en `proyeccion_fila_anios` (solo filas base de Y+1):
--      `base_siguiente` (B) y `base_normalizada` (B'').
--   3. `comment on column public.tiendas.venta_esperada_promedio` (07d): el valor
--      pasa a ser la venta MENSUAL promedio en régimen. Solo documentación: no hay
--      columna nueva, renombre ni conversión (la cifra cargada ya es mensual).
--
-- Idempotente: `create table if not exists`, `add column if not exists` (que omite
-- también los checks en línea si la columna ya existe), `create index if not
-- exists`, `create or replace trigger`, `revoke`/`grant`/`comment` repetibles.
-- Sin bloques `do $$ ... $$`: las restricciones van en línea dentro del `create
-- table` o del `add column`, así que no hace falta preguntar si ya existen. Sin
-- función nueva. Sin sentencias destructivas ni backfill de datos: las migraciones
-- se aplican con `execute_sql` y esas sentencias se quedan esperando una
-- confirmación que nunca llega. Las dos columnas nuevas son nulas hasta el próximo
-- cálculo (VERSION_METODO = 4 obliga a recalcular una sola vez).
--
-- Seguridad: RLS activo y SIN políticas; `revoke` a public, anon y authenticated y
-- `grant` a service_role (convención de 0013 a 0022). Solo entra el backend.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `proyeccion_crecimientos` (una fila por celda GM con %)
-- ---------------------------------------------------------------------------
-- La matriz pertenece a una proyección (`on delete cascade`: al eliminar una
-- proyección en trabajo sin decisiones se va su matriz; una cerrada o archivada
-- conserva la que usó). Una copia (`copiar_de`) empieza con las celdas del origen:
-- lo hace la API.
--
-- `genero_id` solo admite HOMBRE o MUJER, pero lo valida la API: un `check` por
-- nombre no cabe en la base (el nombre vive en otra tabla). Las FK son `restrict`:
-- no se elimina un género ni un mundo que una matriz usa.
--
-- `pct` es la variación BRUTA `Y+1 / Y - 1` de las mismas tiendas de Y+1, sin
-- corregir por el Niño. Mismo rango que `proyeccion_fila_anios.crecimiento_pct`.
--
-- El Resto NO tiene fila aquí: es `proyecciones.parametros.crecimiento_pct_defecto`
-- (ficha §2.2). Tampoco se guarda el GM de cada fila de la proyección: se resuelve
-- al leer, desde el nodo vigente (`genero_mundo_linea`), porque el mundo de un nodo
-- se puede editar y la regla debe seguir al árbol.
--
-- `perfil_id`/`usuario_nombre`: quién fijó la celda por última vez (decisión 33);
-- `updated_at` dice cuándo. `activo` va por convención (PLAN §4) y no tiene uso:
-- quitar una celda borra la fila, como en `responsables_genero_mundo`.
create table if not exists public.proyeccion_crecimientos (
  id uuid primary key default gen_random_uuid(),
  proyeccion_id uuid not null
    constraint proyeccion_crecimientos_proyeccion_id_fkey
      references public.proyecciones(id) on delete cascade,
  genero_id uuid not null
    constraint proyeccion_crecimientos_genero_id_fkey
      references public.generos(id) on delete restrict,
  mundo_id uuid not null
    constraint proyeccion_crecimientos_mundo_id_fkey
      references public.mundos(id) on delete restrict,
  pct numeric(6, 2) not null
    constraint proyeccion_crecimientos_pct_check check (pct between -95 and 500),
  nota text
    constraint proyeccion_crecimientos_nota_len_check
      check (nota is null or char_length(nota) <= 300),
  perfil_id uuid
    constraint proyeccion_crecimientos_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Una celda por proyección, género y mundo. Las tres columnas son `not null`,
  -- así que un UNIQUE normal basta (sin `coalesce`). Su primera columna cubre la
  -- FK a la proyección.
  constraint proyeccion_crecimientos_celda_key
    unique (proyeccion_id, genero_id, mundo_id)
);

-- Cubren las FK `restrict` (que no recorran la tabla al eliminar un género o un
-- mundo) y la de `perfiles` (`set null` al eliminar un perfil). La ficha pide los
-- dos primeros; el de `perfil_id` sigue la convención del repo (el advisor marca
-- toda FK sin índice, como en `proyecciones_perfil_id_idx`).
create index if not exists proyeccion_crecimientos_genero_id_idx
  on public.proyeccion_crecimientos (genero_id);
create index if not exists proyeccion_crecimientos_mundo_id_idx
  on public.proyeccion_crecimientos (mundo_id);
create index if not exists proyeccion_crecimientos_perfil_id_idx
  on public.proyeccion_crecimientos (perfil_id);

create or replace trigger set_updated_at before update on public.proyeccion_crecimientos
  for each row execute function public.tg_set_updated_at();

comment on table public.proyeccion_crecimientos is
  'M7 07c: matriz de crecimientos del anio siguiente por genero x mundo (una fila por celda con %). Solo HOMBRE y MUJER (lo valida la API); el Resto es proyecciones.parametros.crecimiento_pct_defecto y no tiene fila. Cadena de precedencia: % propio de la fila > celda GM > Resto. El GM de cada fila de la proyeccion se resuelve al leer desde el nodo, no se guarda.';
comment on column public.proyeccion_crecimientos.pct is
  'M7 07c: variacion BRUTA Y+1 / Y - 1 (porcentaje) de las mismas tiendas de Y+1, sin corregir por el Nino. P = round(B x (1 + pct/100)) con B = proyeccion_fila_anios.base_siguiente. Rango -95..500, igual que proyeccion_fila_anios.crecimiento_pct.';
comment on column public.proyeccion_crecimientos.perfil_id is
  'Quien fijo la celda por ultima vez (decision 33: queda registrado quien decidio). updated_at dice cuando. set null al eliminar el perfil; usuario_nombre conserva el nombre.';
comment on column public.proyeccion_crecimientos.activo is
  'Por convencion (PLAN 4); sin uso. Quitar una celda borra la fila, como en responsables_genero_mundo.';

-- ---------------------------------------------------------------------------
-- 2. `proyeccion_fila_anios.base_siguiente` y `base_normalizada`
-- ---------------------------------------------------------------------------
-- Solo se llenan en las filas base de Y+1; nulas sin base o sin curva. Las
-- escriben `calcular` y cada `recalcularBaseSiguiente` en el acto. Hacen falta
-- porque calcular B necesita `historico.salientes` (el jsonb pesado que la matriz
-- no lee): con estas columnas la matriz suma sin releer nada.
--
-- Si la columna ya existe, `add column if not exists` omite también el check en
-- línea, así que repetir la migración no lo duplica. Sin `default`, sin backfill.
alter table public.proyeccion_fila_anios
  add column if not exists base_siguiente integer
    constraint proyeccion_fila_anios_base_siguiente_check
      check (base_siguiente is null or base_siguiente >= 0);

alter table public.proyeccion_fila_anios
  add column if not exists base_normalizada numeric(14, 2)
    constraint proyeccion_fila_anios_base_normalizada_check
      check (base_normalizada is null or base_normalizada >= 0);

comment on column public.proyeccion_fila_anios.base_siguiente is
  'M7 07c, solo filas base de Y+1: B = vigente de Y de las tiendas de M(Y+1), SIN normalizar (vigente de la fila base de Y mas las nuevas de Y que pasan a M(Y+1), menos las salientes). Denominador del % bruto y peso de la fila en Calcular promedio. Nulo sin base o sin curva.';
comment on column public.proyeccion_fila_anios.base_normalizada is
  'M7 07c, solo filas base de Y+1: B'''' = B'' x suma(c_m x factor_Nino_(Y+1,m)): lo que la fila venderia en Y+1 con 0 % si Y hubiera sido un anio normal. Solo referencia (rebote del Nino y % sobre la base normalizada): no entra en la propuesta. Nulo sin base o sin curva.';

-- ---------------------------------------------------------------------------
-- 3. `tiendas.venta_esperada_promedio` (07d): significado mensual
-- ---------------------------------------------------------------------------
-- Reemplaza el comentario de la 0021 (soles del año de apertura, decisión 22).
-- Solo documentación: la columna conserva nombre, tipo y checks, y no se convierte
-- ningún valor.
comment on column public.tiendas.venta_esperada_promedio is
  'M4/M7 0.10.8: venta mensual promedio esperada de la tienda en regimen, en soles sin IGV (nunca incluye IGV; el sistema no convierte). M7 la multiplica por 12 (anio maduro) y la reparte con la estacionalidad y la rampa de cada fila en los meses en que la tienda esta abierta. Entre 0.10.1 y 0.10.7 se leia como soles del anio de apertura.';

-- ---------------------------------------------------------------------------
-- 4. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.proyeccion_crecimientos enable row level security;

revoke all on public.proyeccion_crecimientos from public, anon, authenticated;
grant all on public.proyeccion_crecimientos to service_role;

-- M7 07g · Aprobación en bloque de la proyección (versión 0.15.0 · M7 c): lotes auditables, traza por registro y escritura
-- transaccional y condicional de un lote.
--
-- Ficha: docs/modulos/07g-aprobacion-en-bloque.md (§2 Modelo de datos, §2.4 y §2.5 función y payload, §3.4 códigos por fila).
-- NUMERACIÓN: la ficha cita esta migración con el marcador `00L1_lotes_proyeccion.sql` («el número siguiente libre al
-- construir»). Estaban aplicadas 0000-0025, 0027, 0029 y 0030; la 0026 (0.13.1 · M8) y la 0028 (M9a) siguen reservadas. Esta toma
-- la 0031, que la ficha 07f había reservado (`0031_venta_tienda_nodos.sql`) pero que NO está construida ni aplicada: 07f pasará a
-- tomar la siguiente libre. Depende de 0000 (`tg_set_updated_at`), 0006 (`perfiles`), 0018 (`proyecciones`, `proyeccion_filas`,
-- `proyeccion_fila_anios`) y 0030 (`ia_propuestas_gm`, `ia_propuestas_filas`).
--
-- SE APLICA ANTES DEL CÓDIGO DE 0.15.0 M7 c, con el código anterior desplegado: todo lo que añade es inocuo para él (tablas
-- nuevas, UNA columna nula con su FK diferible y su `check`, y funciones nuevas). No hay seed ni backfill.
--
-- Qué hace:
--   1. `proyeccion_lotes`: una cabecera por lote (tipo aprobar, reaprobar o revertir). INMUTABLE (solo inserción).
--   2. `proyeccion_lote_filas`: una línea por fila pedida del lote, aplicada o rechazada, con su código. INMUTABLE.
--   3. `proyeccion_fila_anios.decision_lote_id` (§2.3): no nulo = el `decidido` vigente lo escribió ese lote y nadie lo cambió
--      a mano. FK DIFERIBLE (`deferrable initially deferred`) y `check` (decision_lote_id no nulo implica decidido no nulo).
--   4. `tg_proyeccion_lote_inmutable()`: trigger por fila (update y delete) y por sentencia (truncate), igual que
--      `tg_ia_inmutable` de 0030, también para service_role.
--   5. `respuesta_lote_proyeccion(lote_id, repetido)`: arma la respuesta de la función a partir de lo guardado.
--   6. `aplicar_lote_proyeccion(p jsonb)`: escribe un lote entero (todos los grupos) en UNA transacción.
--
-- Idempotente: `create table if not exists`, `add column if not exists` (que omite también la FK y el `check` en línea si la
-- columna ya existe), `create index if not exists`, `create or replace trigger`, `create or replace function`,
-- `revoke`/`grant`/`comment` repetibles. Sin `do $$ ... $$`. Sin `drop`, `delete`, `truncate` ni `update` A NIVEL DE
-- MIGRACIÓN; dentro de `aplicar_lote_proyeccion` sí hay `insert` y `update` (es su trabajo).
--
-- Criterio de la base (ficha §2): solo invariantes ESTRUCTURALES (rangos, longitudes, `jsonb_typeof`, huellas de 64
-- caracteres, que `revierte_lote_id` vaya con el tipo `revertir` y el `check` de `decision_lote_id`). Los catálogos (`tipo`,
-- `fuente`, `resultado` y los códigos de §3.4) NO llevan `check`: los valida zod.
--
-- EXCEPCIÓN A LA CONVENCIÓN: las dos tablas nuevas son inmutables y no llevan `activo` ni `updated_at` (igual que
-- `compra_eventos` y las `ia_*` inmutables): nunca cambian.
--
-- Seguridad: RLS activo y SIN políticas (solo entra el backend con `service_role`); `revoke` a public, anon y authenticated y
-- `grant` a service_role. Funciones `security invoker`, `search_path` vacío, solo `service_role`. El trigger de inmutabilidad
-- vale para TODOS los roles, `service_role` incluido: la API corre con él, así que un `revoke` no bastaría. El dueño de la
-- base puede desactivar triggers: queda fuera del alcance de la aplicación.
--
-- Los cuerpos de las funciones van sin comentarios `--` (el SQL Editor de Supabase los parsea mal dentro de `$$`): lo que hay
-- que saber de cada una está aquí, encima.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `proyeccion_lotes` (cabecera del lote; INMUTABLE; §2.1)
-- ---------------------------------------------------------------------------
-- El `id` lo genera el navegador (D10, idempotencia): sin default. `confirmacion_id` agrupa las tandas de una misma
-- confirmación (D17). `tipo` (zod): aprobar | reaprobar | revertir. `revierte_lote_id` solo en `revertir` (check de
-- estructura) y `restrict`: un lote revertido no se borra. `huella_cuerpo` = sha-256 del cuerpo canónico: con ella un reintento
-- (mismo `id`, mismo cuerpo) devuelve lo guardado y otro cuerpo con el mismo `id` es `lote_ajeno`.
-- `resumen` lo CALCULA `aplicar_lote_proyeccion` con lo realmente escrito: { pedidas, aplicadas, rechazadas: { codigo: n },
-- por_fuente: { ia: { filas, unidades }, metodo: { filas, unidades } } }. `por_fuente` trae siempre `ia` y `metodo` (en cero si
-- no hay) y suma una clave más por cada otra fuente con filas aplicadas (`revertir` en un lote de reversión).
-- `efecto_gm_previsto` es lo que TypeScript calculó ANTES de escribir («previsto», D11): no tiene por qué coincidir con lo escrito.
-- Excepciones a la inmutabilidad: `proyeccion_id` y `perfil_id` -> NULL (las FK `on delete set null`).
create table if not exists public.proyeccion_lotes (
  id uuid not null,
  confirmacion_id uuid not null,
  proyeccion_id uuid
    constraint proyeccion_lotes_proyeccion_id_fkey
      references public.proyecciones(id) on delete set null,
  tipo text not null,
  revierte_lote_id uuid
    constraint proyeccion_lotes_revierte_lote_id_fkey
      references public.proyeccion_lotes(id) on delete restrict,
  anio integer not null
    constraint proyeccion_lotes_anio_check
      check (anio between 2024 and 2101),
  huella_cuerpo text not null
    constraint proyeccion_lotes_huella_cuerpo_len_check
      check (char_length(huella_cuerpo) = 64),
  calculado_at_proyeccion timestamptz not null,
  filtro jsonb not null default '{}'::jsonb
    constraint proyeccion_lotes_filtro_check
      check (jsonb_typeof(filtro) = 'object'),
  resumen jsonb not null
    constraint proyeccion_lotes_resumen_check
      check (jsonb_typeof(resumen) = 'object'),
  efecto_gm_previsto jsonb not null default '[]'::jsonb
    constraint proyeccion_lotes_efecto_gm_previsto_check
      check (jsonb_typeof(efecto_gm_previsto) = 'array'),
  revision_confirmada boolean not null default false,
  propuestas_gm uuid[] not null default '{}',
  nota text
    constraint proyeccion_lotes_nota_len_check
      check (nota is null or char_length(nota) <= 300),
  perfil_id uuid
    constraint proyeccion_lotes_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  constraint proyeccion_lotes_pkey primary key (id),
  -- `revierte_lote_id` va con el tipo `revertir` y solo con él (las dos direcciones).
  constraint proyeccion_lotes_revierte_tipo_check
    check ((tipo = 'revertir') = (revierte_lote_id is not null))
);

create index if not exists proyeccion_lotes_confirmacion_id_idx on public.proyeccion_lotes (confirmacion_id);
-- El historial de una proyección, del más reciente al más antiguo; el prefijo (proyeccion_id) cubre la FK.
create index if not exists proyeccion_lotes_proyeccion_created_idx on public.proyeccion_lotes (proyeccion_id, created_at desc);
create index if not exists proyeccion_lotes_revierte_lote_id_idx on public.proyeccion_lotes (revierte_lote_id);
create index if not exists proyeccion_lotes_perfil_id_idx on public.proyeccion_lotes (perfil_id);

comment on table public.proyeccion_lotes is
  'M7 07g 0.15.0: una cabecera por lote de aprobacion en bloque (tipo aprobar, reaprobar o revertir). INMUTABLE (insert-only): tg_proyeccion_lote_inmutable rechaza update, delete y truncate, tambien para service_role; excepciones: proyeccion_id y perfil_id a NULL. El id lo genera el navegador (idempotencia). El resumen lo calcula aplicar_lote_proyeccion con lo realmente escrito; efecto_gm_previsto es lo que calculo TypeScript antes de escribir.';
comment on column public.proyeccion_lotes.huella_cuerpo is
  'M7 07g: sha-256 del cuerpo canonico. Mismo id y misma huella en la misma proyeccion = reintento (repetido); mismo id con otra huella u otra proyeccion = lote_ajeno (LP004).';
comment on column public.proyeccion_lotes.resumen is
  'M7 07g (D11): { pedidas, aplicadas, rechazadas: { codigo: n }, por_fuente: { ia: { filas, unidades }, metodo: { filas, unidades } } } calculado en SQL con las proyeccion_lote_filas del lote. por_fuente trae siempre ia y metodo y una clave mas por cada otra fuente con filas aplicadas.';
comment on column public.proyeccion_lotes.efecto_gm_previsto is
  'M7 07g (D11): EfectoGMApi[] que calculo TypeScript antes de escribir. Es lo PREVISTO: no se corrige si SQL rechazo grupos.';

-- ---------------------------------------------------------------------------
-- 2. `proyeccion_lote_filas` (una línea por fila pedida; INMUTABLE; §2.2)
-- ---------------------------------------------------------------------------
-- `lote_id` es FK DIFERIBLE: la función escribe las líneas ANTES de insertar la cabecera (que necesita los conteos reales), así
-- que la comprobación de la FK se hace al `commit`. `fila_clave` sobrevive al `set null` de `fila_id`. `fuente` (zod): ia |
-- metodo | revertir. `resultado`: `aplicada` o un código de §3.4. Único por (lote, fila_clave, anio): una fila aparece una sola
-- vez en el lote. `valor`: lo escrito; `valor_esperado`: lo que vio la persona; `valor_actual`: el de la base al rechazar;
-- `decidido_anterior`: lo que tenía el registro antes. Excepción a la inmutabilidad: `fila_id` -> NULL (FK `set null`).
create table if not exists public.proyeccion_lote_filas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null
    constraint proyeccion_lote_filas_lote_id_fkey
      references public.proyeccion_lotes(id) on delete restrict deferrable initially deferred,
  fila_id uuid
    constraint proyeccion_lote_filas_fila_id_fkey
      references public.proyeccion_filas(id) on delete set null,
  fila_clave text not null
    constraint proyeccion_lote_filas_fila_clave_len_check
      check (char_length(fila_clave) <= 300),
  gm_clave text not null
    constraint proyeccion_lote_filas_gm_clave_len_check
      check (char_length(gm_clave) <= 80),
  anio integer not null
    constraint proyeccion_lote_filas_anio_check
      check (anio between 2024 and 2101),
  fuente text not null
    constraint proyeccion_lote_filas_fuente_len_check
      check (char_length(fuente) between 1 and 20),
  resultado text not null
    constraint proyeccion_lote_filas_resultado_len_check
      check (char_length(resultado) between 1 and 60),
  valor integer
    constraint proyeccion_lote_filas_valor_check
      check (valor is null or valor >= 0),
  valor_esperado integer
    constraint proyeccion_lote_filas_valor_esperado_check
      check (valor_esperado is null or valor_esperado >= 0),
  valor_actual integer
    constraint proyeccion_lote_filas_valor_actual_check
      check (valor_actual is null or valor_actual >= 0),
  decidido_anterior integer
    constraint proyeccion_lote_filas_decidido_anterior_check
      check (decidido_anterior is null or decidido_anterior >= 0),
  propuesta_fila_id uuid
    constraint proyeccion_lote_filas_propuesta_fila_id_fkey
      references public.ia_propuestas_filas(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- También cubre la FK al lote (`lote_id` va primero).
  constraint proyeccion_lote_filas_lote_fila_anio_key unique (lote_id, fila_clave, anio)
);

create index if not exists proyeccion_lote_filas_fila_id_idx on public.proyeccion_lote_filas (fila_id);
create index if not exists proyeccion_lote_filas_propuesta_fila_id_idx on public.proyeccion_lote_filas (propuesta_fila_id);

comment on table public.proyeccion_lote_filas is
  'M7 07g 0.15.0: una linea por fila pedida de un lote, aplicada o rechazada (resultado = aplicada o un codigo de la ficha 07g 3.4). INMUTABLE (insert-only): tg_proyeccion_lote_inmutable rechaza update, delete y truncate, tambien para service_role; excepcion: fila_id a NULL. FK lote_id diferible: la cabecera se inserta al final. Unica por (lote, fila_clave, anio).';
comment on column public.proyeccion_lote_filas.lote_id is
  'M7 07g: FK a proyeccion_lotes DEFERRABLE INITIALLY DEFERRED. aplicar_lote_proyeccion inserta las lineas antes que la cabecera (que necesita los conteos reales): sin cabecera al commit, la transaccion falla.';

-- ---------------------------------------------------------------------------
-- 3. `proyeccion_fila_anios.decision_lote_id` (§2.3)
-- ---------------------------------------------------------------------------
-- No nulo = el `decidido` vigente lo escribió ese lote y nadie lo cambió a mano. TODA decisión individual sobre el registro lo
-- pone en NULL (lo hace el código de M7); el registro de Y+1 que solo se recalcula lo conserva; `calcular` no lo toca y
-- `copiar_de` no lo copia. `restrict`: un lote con registros decididos no se borra. FK DIFERIBLE: la función escribe los
-- registros antes de insertar la cabecera. El `check` exige cifra decidida (la FK diferida no cubre esa coherencia).
-- Va DENTRO del mismo `add column if not exists`: si la columna ya existe la cláusula entera se omite, así la migración
-- repite sin error y sin bloque `do $$`. Nullable: inocuo para el código anterior.
alter table public.proyeccion_fila_anios
  add column if not exists decision_lote_id uuid
    constraint proyeccion_fila_anios_decision_lote_id_fkey
      references public.proyeccion_lotes(id) on delete restrict deferrable initially deferred
    constraint proyeccion_fila_anios_decision_lote_decidido_check
      check (decision_lote_id is null or decidido is not null);

create index if not exists proyeccion_fila_anios_decision_lote_id_idx
  on public.proyeccion_fila_anios (decision_lote_id);

comment on column public.proyeccion_fila_anios.decision_lote_id is
  'M7 07g (D2): no nulo = el decidido vigente lo escribio ese lote de aprobacion en bloque y nadie lo cambio a mano. Toda decision individual lo pone en null; el Y+1 que solo se recalcula lo conserva; calcular no lo toca; copiar_de no lo copia. FK diferible (la cabecera del lote se inserta al final). check: implica decidido no nulo.';

-- ---------------------------------------------------------------------------
-- 4. Trigger de inmutabilidad (por fila y por sentencia)
-- ---------------------------------------------------------------------------
-- Mismo patrón que `tg_ia_inmutable` (0030): rechaza DELETE, TRUNCATE (trigger por sentencia: uno por fila no lo cubre) y todo
-- UPDATE salvo el que SOLO pone en NULL una FK `on delete set null` de esa tabla (las lista el `case`): la emite la FK al
-- borrar un usuario, una proyección o una fila, y el historial sobrevive sin el vínculo. SQLSTATE `restrict_violation`.
-- Las ramas de DELETE y TRUNCATE no tocan `old`/`new` (en TRUNCATE no existen).
create or replace function public.tg_proyeccion_lote_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cols text[];
  v_col text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'UPDATE' then
    v_cols := case tg_table_name
      when 'proyeccion_lotes' then array['perfil_id', 'proyeccion_id']
      when 'proyeccion_lote_filas' then array['fila_id']
      else array[]::text[]
    end;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if (v_new - v_cols) = (v_old - v_cols) then
      foreach v_col in array v_cols loop
        if (v_new -> v_col) is distinct from (v_old -> v_col) and (v_new ->> v_col) is not null then
          raise exception '% es un registro inmutable: solo se admite poner % en NULL', tg_table_name, v_col
            using errcode = 'restrict_violation';
        end if;
      end loop;
      return new;
    end if;
  end if;
  raise exception '% es un registro inmutable: no admite cambios, borrados ni vaciado', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_proyeccion_lote_inmutable() from public, anon, authenticated;
grant execute on function public.tg_proyeccion_lote_inmutable() to service_role;

comment on function public.tg_proyeccion_lote_inmutable() is
  'M7 07g: trigger de proyeccion_lotes y proyeccion_lote_filas. Rechaza delete, truncate y todo update salvo el que solo pone en NULL una FK on delete set null de la tabla (lotes: perfil_id y proyeccion_id; lineas: fila_id). Vale tambien para service_role.';

create or replace trigger proyeccion_lotes_inmutable
  before update or delete on public.proyeccion_lotes
  for each row execute function public.tg_proyeccion_lote_inmutable();
create or replace trigger proyeccion_lotes_sin_vaciado
  before truncate on public.proyeccion_lotes
  for each statement execute function public.tg_proyeccion_lote_inmutable();

create or replace trigger proyeccion_lote_filas_inmutable
  before update or delete on public.proyeccion_lote_filas
  for each row execute function public.tg_proyeccion_lote_inmutable();
create or replace trigger proyeccion_lote_filas_sin_vaciado
  before truncate on public.proyeccion_lote_filas
  for each statement execute function public.tg_proyeccion_lote_inmutable();

-- ---------------------------------------------------------------------------
-- 5. `respuesta_lote_proyeccion(p_lote_id, p_repetido)`
-- ---------------------------------------------------------------------------
-- Respuesta de `aplicar_lote_proyeccion`, armada SIEMPRE con lo guardado: { lote_id, repetido, resumen, filas }. Cada elemento de
-- `filas` es { fila_id, fila_clave, anio, gm_clave, fuente, resultado ('aplicada' | 'rechazada'), codigo (null si se aplicó),
-- valor, valor_actual }, ordenado por (gm_clave, fila_clave, anio). Devuelve null si el lote no existe.
create or replace function public.respuesta_lote_proyeccion(p_lote_id uuid, p_repetido boolean)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'lote_id', l.id,
    'repetido', p_repetido,
    'resumen', l.resumen,
    'filas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fila_id', f.fila_id,
          'fila_clave', f.fila_clave,
          'anio', f.anio,
          'gm_clave', f.gm_clave,
          'fuente', f.fuente,
          'resultado', case when f.resultado = 'aplicada' then 'aplicada' else 'rechazada' end,
          'codigo', case when f.resultado = 'aplicada' then null else f.resultado end,
          'valor', f.valor,
          'valor_actual', f.valor_actual
        )
        order by f.gm_clave, f.fila_clave, f.anio
      )
      from public.proyeccion_lote_filas f
      where f.lote_id = l.id
    ), '[]'::jsonb)
  )
  from public.proyeccion_lotes l
  where l.id = p_lote_id;
$$;

revoke execute on function public.respuesta_lote_proyeccion(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respuesta_lote_proyeccion(uuid, boolean) to service_role;

comment on function public.respuesta_lote_proyeccion(uuid, boolean) is
  'M7 07g: respuesta de aplicar_lote_proyeccion armada con lo guardado: { lote_id, repetido, resumen, filas[] }. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 6. `aplicar_lote_proyeccion(p jsonb) returns jsonb` (§2.4 y §2.5)
-- ---------------------------------------------------------------------------
-- Escribe UN lote (todos sus grupos) en una sola transacción: la que abre la llamada RPC. Solo la llama
-- `src/lib/aprobacion/consultas.ts` con `service_role`. Payload:
--   { lote:   { id, confirmacion_id, proyeccion_id, tipo, revierte_lote_id?, anio, huella_cuerpo, calculado_at_esperado, filtro,
--               efecto_gm_previsto, revision_confirmada, propuestas_gm[], nota?, perfil_id?, usuario_nombre? },
--     grupos: [ { tipo: ia | metodo | revertir, gm_clave, propuesta_gm_id?,
--                 registros_lectura: [ { id, updated_at_esperado } ],
--                 filas: [ { fila_id, fila_clave, anio, fuente, valor?, valor_esperado?, valor_actual?, decidido_anterior?,
--                            decidido_esperado?, propuesta_fila_id?, rechazo?,
--                            registros: [ { id, updated_at_esperado, objetivo: true | false, set: { ... } } ] } ] } ] }
--
-- Pasos (el orden importa):
--   1. CANDADO de la proyección ANTES de mirar `lote.id`: `select ... for no key update` (no bloquea los `insert` con FK de otras
--      tablas). Un duplicado concurrente del mismo lote espera aquí al primero.
--   2. IDEMPOTENCIA, después del candado: si ya existe un lote con ese `id` (en READ COMMITTED se ve el commit del primero):
--      misma proyección y misma `huella_cuerpo` -> devuelve lo guardado con `repetido: true`; en otro caso SQLSTATE LP004.
--      Si aun así salta una `unique_violation` al escribir (otra proyección con el mismo `id` que commitea a la vez), todo lo
--      escrito por la llamada se deshace (el bloque de escritura es una subtransacción), se relee el lote y se responde igual:
--      `repetido` o LP004. La traducción del 23505 de `proyeccion_lotes_pkey` ocurre aquí, no en TypeScript.
--   3. Comprobaciones de la proyección: `estado <> 'en_trabajo'` -> LP001 (mensaje proyeccion_cerrada o proyeccion_archivada);
--      cálculo vivo (`calculando_desde` de menos de 15 minutos) -> LP002; `calculado_at` distinto del esperado -> LP003. En
--      `revertir`, el lote revertido debe existir, ser `aprobar` o `reaprobar` y de la misma proyección -> si no, LP005.
--      `revertir` NO se bloquea por desactualizada: esa regla es de TypeScript y no se repite aquí.
--   4. Por GRUPO, en el orden recibido: `select ... for update` de todos los registros que se leen o se escriben, ordenados por
--      (fila_id, anio) (el orden que debe usar `guardarRegistros` para no interbloquearse), y solo de esta proyección (un id
--      de otra proyección cuenta como ausente: `cambio_concurrente`, nunca se escribe). Después se comprueba:
--        - `updated_at` de cada registro de las FILAS igual al esperado -> si no, `cambio_concurrente` en esa fila;
--        - `registros_lectura` (todo el grupo): si alguno cambió o falta, las filas sin código propio salen
--          `cambio_concurrente` (D7: la cifra de la IA depende de todo el GM);
--        - registro `activo` -> si no, `fila_inactiva`;
--        - registro objetivo: aprobar -> `decidido is null` (`ya_decidida`); reaprobar -> `decision_lote_id` no nulo y
--          `decidido` igual a `decidido_esperado` (`cambiada_despues`); revertir -> `decision_lote_id` = `revierte_lote_id`
--          (`cambiada_despues`);
--        - grupo `ia`: `propuesta_gm_id` es la vigente de (proyección, GM) con el orden de `leerPropuestaVigenteDeGM`
--          (`created_at desc, id asc`) -> si no, `ia_no_vigente`; y la `propuesta_fila_id` de cada fila es de esa propuesta
--          -> si no, `ia_fila_ajena`.
--      ATOMICIDAD: un grupo `ia` se escribe ENTERO o NO SE ESCRIBE (D7): si una fila falla, la que falló lleva su código y las
--      demás `grupo_rechazado` (o el código del grupo: `cambio_concurrente` o `ia_no_vigente`). Los grupos `metodo` y
--      `revertir` son atómicos POR FILA (D9, «una fila entera o nada»: el 2026 y el 2027 de una fila se escriben juntos o
--      ninguno): una fila que falla no arrastra a las demás, salvo que falle `registros_lectura`, que es del grupo. Las filas
--      que TypeScript ya rechazó viajan con `rechazo` y sin registros; en un grupo `ia` también tumban al resto del grupo.
--   5. Escritura: el `update` de cada registro de una fila aplicable usa una LISTA FIJA de columnas (las de
--      `payloadAnioDecision` sin `activo`, `id`, `fila_id` ni `anio`, más `decision_lote_id`). Una clave ausente de `set` deja la
--      columna como está; una clave con `null` la pone en `null`. Una clave fuera de la lista (incluidas `activo`, `id`,
--      `fila_id` y `anio`) -> LP007 y se deshace todo; se comprueba en la pasada de lectura, para TODAS las filas con registros
--      (también las que luego se rechazan), antes de escribir nada. `decision_lote_id` solo puede ser null o el id del lote (null siempre en
--      `revertir`). El `where` exige `activo = true`: un lote nunca reactiva un registro.
--   6. Inserta las `proyeccion_lote_filas` (todas, aplicadas y rechazadas), calcula el `resumen` a partir de ellas y inserta la
--      cabecera AL FINAL (las FK de `lote_filas.lote_id` y de `decision_lote_id` son diferibles: se comprueban al commit).
--      Devuelve `{ lote_id, repetido: false, filas, resumen }` (ver `respuesta_lote_proyeccion`).
--
-- COMPARACIÓN DE `updated_at`: `updated_at_esperado` es un texto con microsegundos tal como lo devuelve la base (nunca pasado por
-- `Date`, que los pierde) y se convierte a `timestamptz` para comparar. Eso es exacto (microsegundos) y no depende del
-- formato ni del huso de la sesión, que sí cambian la salida de `updated_at::text` (con PostgREST llega
-- `2026-11-03T10:00:00.123456+00:00`, no `2026-11-03 10:00:00.123456+00`).
--
-- Errores propios (SQLSTATE): LP001 proyeccion_cerrada | proyeccion_archivada; LP002 calculo_en_curso; LP003 datos_cambiaron;
-- LP004 lote_ajeno; LP005 no_revertible; LP006 proyeccion_no_encontrada; LP007 payload invalido (mensaje con el motivo);
-- LP008 registro_no_escrito (el `update` no tocó la fila: no debería pasar con el registro bloqueado). Un error no previsto
-- deshace todo. Un interbloqueo (40P01) lo traduce TypeScript a `conflicto_reintentar`.
--
-- `security invoker`, `search_path` vacío, solo `service_role`. Cuerpo sin comentarios `--`.
create or replace function public.aplicar_lote_proyeccion(p jsonb)
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
  v_revierte uuid;
  v_huella text;
  v_calc timestamptz;
  v_proy public.proyecciones%rowtype;
  v_ex public.proyeccion_lotes%rowtype;
  v_rev public.proyeccion_lotes%rowtype;
  v_g jsonb;
  v_f jsonb;
  v_r jsonb;
  v_gtipo text;
  v_gprop uuid;
  v_vig uuid;
  v_ids uuid[];
  v_lect_mal integer;
  v_gcod text;
  v_cod text[];
  v_falla boolean;
  v_i integer;
  v_n integer;
  v_obj integer;
  v_cf text;
  v_a public.proyeccion_fila_anios%rowtype;
  v_x public.proyeccion_fila_anios%rowtype;
  v_set jsonb;
  v_fila_id uuid;
  v_fila_anio integer;
  v_fid uuid;
  v_pfid uuid;
  v_resumen jsonb;
  v_permitidas text[] := array[
    'bloque', 'subbloque', 'vendido', 'propuesto', 'metodo', 'referencia_alternativa', 'referencia_tres_meses', 'explicacion',
    'base_siguiente', 'base_normalizada', 'meses', 'origen_meses', 'curva_origen_usada', 'meses_propuestos',
    'curva_origen_propuesta', 'avisos', 'crecimiento_pct', 'decidido', 'origen', 'propuesta_al_decidir', 'nota', 'decidido_at',
    'decidido_por_id', 'decidido_por_nombre', 'decision_ia_fila_id', 'decision_lote_id'
  ];
begin
  if v_lote is null or jsonb_typeof(v_lote) <> 'object' or jsonb_typeof(p -> 'grupos') is distinct from 'array' then
    raise exception 'payload_invalido: faltan lote o grupos' using errcode = 'LP007';
  end if;
  v_lote_id := (v_lote ->> 'id')::uuid;
  v_proy_id := (v_lote ->> 'proyeccion_id')::uuid;
  v_tipo := v_lote ->> 'tipo';
  v_revierte := nullif(v_lote ->> 'revierte_lote_id', '')::uuid;
  v_huella := v_lote ->> 'huella_cuerpo';
  v_calc := (v_lote ->> 'calculado_at_esperado')::timestamptz;
  if v_lote_id is null or v_proy_id is null or v_huella is null then
    raise exception 'payload_invalido: lote sin id, proyeccion_id o huella_cuerpo' using errcode = 'LP007';
  end if;
  if v_tipo is null or v_tipo not in ('aprobar', 'reaprobar', 'revertir') then
    raise exception 'payload_invalido: tipo de lote desconocido' using errcode = 'LP007';
  end if;
  if (v_tipo = 'revertir') <> (v_revierte is not null) then
    raise exception 'payload_invalido: revierte_lote_id va con el tipo revertir y solo con el' using errcode = 'LP007';
  end if;

  select * into v_proy
    from public.proyecciones
   where id = v_proy_id
     for no key update;
  if not found then
    raise exception 'proyeccion_no_encontrada' using errcode = 'LP006';
  end if;

  select * into v_ex
    from public.proyeccion_lotes
   where id = v_lote_id;
  if found then
    if v_ex.proyeccion_id is not distinct from v_proy_id and v_ex.huella_cuerpo = v_huella then
      return public.respuesta_lote_proyeccion(v_lote_id, true);
    end if;
    raise exception 'lote_ajeno' using errcode = 'LP004';
  end if;

  if v_proy.estado <> 'en_trabajo' then
    raise exception 'proyeccion_%', v_proy.estado using errcode = 'LP001';
  end if;
  if v_proy.calculando_desde is not null and v_proy.calculando_desde > now() - interval '15 minutes' then
    raise exception 'calculo_en_curso' using errcode = 'LP002';
  end if;
  if v_proy.calculado_at is null or v_calc is distinct from v_proy.calculado_at then
    raise exception 'datos_cambiaron' using errcode = 'LP003';
  end if;
  if v_tipo = 'revertir' then
    select * into v_rev
      from public.proyeccion_lotes
     where id = v_revierte;
    if not found or v_rev.proyeccion_id is distinct from v_proy_id or v_rev.tipo not in ('aprobar', 'reaprobar') then
      raise exception 'no_revertible' using errcode = 'LP005';
    end if;
  end if;

  begin
    for v_g in
      select e.value
        from jsonb_array_elements(p -> 'grupos') with ordinality as e(value, ord)
       order by e.ord
    loop
      v_gtipo := v_g ->> 'tipo';
      if v_gtipo is null or v_gtipo not in ('ia', 'metodo', 'revertir') or (v_gtipo = 'revertir') <> (v_tipo = 'revertir') then
        raise exception 'payload_invalido: tipo de grupo incoherente con el tipo de lote' using errcode = 'LP007';
      end if;
      v_gprop := nullif(v_g ->> 'propuesta_gm_id', '')::uuid;

      select coalesce(array_agg(distinct q.id), '{}'::uuid[]) into v_ids
        from (
          select (l ->> 'id')::uuid as id
            from jsonb_array_elements(coalesce(v_g -> 'registros_lectura', '[]'::jsonb)) as l
          union all
          select (r ->> 'id')::uuid
            from jsonb_array_elements(coalesce(v_g -> 'filas', '[]'::jsonb)) as f
            cross join lateral jsonb_array_elements(coalesce(f -> 'registros', '[]'::jsonb)) as r
        ) q;

      perform 1
         from public.proyeccion_fila_anios a
         join public.proyeccion_filas pf on pf.id = a.fila_id
        where a.id = any (v_ids)
          and pf.proyeccion_id = v_proy_id
        order by a.fila_id, a.anio
          for update of a;

      select count(*) into v_lect_mal
        from jsonb_to_recordset(coalesce(v_g -> 'registros_lectura', '[]'::jsonb)) as l(id uuid, updated_at_esperado timestamptz)
        left join lateral (
          select a.updated_at
            from public.proyeccion_fila_anios a
            join public.proyeccion_filas pf on pf.id = a.fila_id
           where a.id = l.id
             and pf.proyeccion_id = v_proy_id
        ) as ra on true
       where ra.updated_at is null
          or l.updated_at_esperado is null
          or ra.updated_at <> l.updated_at_esperado;

      v_gcod := null;
      if v_lect_mal > 0 then
        v_gcod := 'cambio_concurrente';
      elsif v_gtipo = 'ia' then
        select pg.id into v_vig
          from public.ia_propuestas_gm pg
         where pg.proyeccion_id = v_proy_id
           and pg.gm_clave = (v_g ->> 'gm_clave')
         order by pg.created_at desc, pg.id asc
         limit 1;
        if v_vig is distinct from v_gprop then
          v_gcod := 'ia_no_vigente';
        end if;
      end if;

      v_cod := array[]::text[];
      v_falla := false;
      v_i := 0;
      for v_f in
        select e.value
          from jsonb_array_elements(coalesce(v_g -> 'filas', '[]'::jsonb)) with ordinality as e(value, ord)
         order by e.ord
      loop
        v_i := v_i + 1;
        v_cf := nullif(v_f ->> 'rechazo', '');
        if v_cf is null then
          v_fila_id := (v_f ->> 'fila_id')::uuid;
          v_fila_anio := (v_f ->> 'anio')::integer;
          v_obj := 0;
          for v_r in
            select e.value
              from jsonb_array_elements(coalesce(v_f -> 'registros', '[]'::jsonb)) with ordinality as e(value, ord)
             order by e.ord
          loop
            v_set := coalesce(v_r -> 'set', '{}'::jsonb);
            if jsonb_typeof(v_set) <> 'object' then
              raise exception 'payload_invalido: set no es un objeto' using errcode = 'LP007';
            end if;
            if exists (select 1 from jsonb_object_keys(v_set) as k where k <> all (v_permitidas)) then
              raise exception 'payload_invalido: columna fuera de la lista fija de set' using errcode = 'LP007';
            end if;
            if (v_set ->> 'decision_lote_id') is not null
               and (v_tipo = 'revertir' or (v_set ->> 'decision_lote_id')::uuid <> v_lote_id) then
              raise exception 'payload_invalido: decision_lote_id solo puede ser null o el id del lote' using errcode = 'LP007';
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
              if coalesce((v_r ->> 'objetivo')::boolean, false) then
                v_obj := v_obj + 1;
              end if;
              continue;
            end if;
            if v_a.fila_id is distinct from v_fila_id then
              raise exception 'payload_invalido: un registro no es de la fila indicada' using errcode = 'LP007';
            end if;
            if coalesce((v_r ->> 'objetivo')::boolean, false) then
              v_obj := v_obj + 1;
              if v_a.anio is distinct from v_fila_anio then
                raise exception 'payload_invalido: el registro objetivo no es del anio de la fila' using errcode = 'LP007';
              end if;
            end if;
            if v_cf is null and v_a.updated_at is distinct from (v_r ->> 'updated_at_esperado')::timestamptz then
              v_cf := 'cambio_concurrente';
            end if;
            if v_cf is null and not v_a.activo then
              v_cf := 'fila_inactiva';
            end if;
            if v_cf is null and coalesce((v_r ->> 'objetivo')::boolean, false) then
              if v_tipo = 'aprobar' then
                if v_a.decidido is not null then
                  v_cf := 'ya_decidida';
                end if;
              elsif v_tipo = 'reaprobar' then
                if v_a.decision_lote_id is null
                   or v_a.decidido is distinct from nullif(v_f ->> 'decidido_esperado', '')::integer then
                  v_cf := 'cambiada_despues';
                end if;
              else
                if v_a.decision_lote_id is distinct from v_revierte then
                  v_cf := 'cambiada_despues';
                end if;
              end if;
            end if;
          end loop;
          if v_obj <> 1 then
            raise exception 'payload_invalido: cada fila lleva exactamente un registro objetivo' using errcode = 'LP007';
          end if;
          if v_cf is null and v_gtipo = 'ia' then
            v_pfid := nullif(v_f ->> 'propuesta_fila_id', '')::uuid;
            if v_pfid is null
               or v_gprop is null
               or not exists (
                 select 1
                   from public.ia_propuestas_filas ipf
                  where ipf.id = v_pfid
                    and ipf.propuesta_gm_id = v_gprop
               ) then
              v_cf := 'ia_fila_ajena';
            end if;
          end if;
        end if;
        v_cod[v_i] := v_cf;
        if v_cf is not null then
          v_falla := true;
        end if;
      end loop;

      v_i := 0;
      for v_f in
        select e.value
          from jsonb_array_elements(coalesce(v_g -> 'filas', '[]'::jsonb)) with ordinality as e(value, ord)
         order by e.ord
      loop
        v_i := v_i + 1;
        v_cf := v_cod[v_i];
        if v_cf is null then
          if v_gcod is not null then
            v_cf := v_gcod;
          elsif v_gtipo = 'ia' and v_falla then
            v_cf := 'grupo_rechazado';
          end if;
        end if;

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
              raise exception 'registro_no_escrito' using errcode = 'LP008';
            end if;
          end loop;
        end if;

        v_fid := nullif(v_f ->> 'fila_id', '')::uuid;
        if v_fid is not null and not exists (select 1 from public.proyeccion_filas where id = v_fid) then
          v_fid := null;
        end if;
        v_pfid := nullif(v_f ->> 'propuesta_fila_id', '')::uuid;
        if v_pfid is not null and not exists (select 1 from public.ia_propuestas_filas where id = v_pfid) then
          v_pfid := null;
        end if;
        insert into public.proyeccion_lote_filas (
          lote_id, fila_id, fila_clave, gm_clave, anio, fuente, resultado, valor, valor_esperado, valor_actual,
          decidido_anterior, propuesta_fila_id
        )
        values (
          v_lote_id, v_fid, v_f ->> 'fila_clave', v_g ->> 'gm_clave', (v_f ->> 'anio')::integer,
          coalesce(nullif(v_f ->> 'fuente', ''), v_gtipo), coalesce(v_cf, 'aplicada'),
          nullif(v_f ->> 'valor', '')::integer, nullif(v_f ->> 'valor_esperado', '')::integer,
          nullif(v_f ->> 'valor_actual', '')::integer, nullif(v_f ->> 'decidido_anterior', '')::integer, v_pfid
        );
      end loop;
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
      id, confirmacion_id, proyeccion_id, tipo, revierte_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, filtro, resumen,
      efecto_gm_previsto, revision_confirmada, propuestas_gm, nota, perfil_id, usuario_nombre
    )
    select
      x.id, x.confirmacion_id, v_proy_id, v_tipo, v_revierte, x.anio, v_huella, v_proy.calculado_at,
      case when jsonb_typeof(x.filtro) = 'object' then x.filtro else '{}'::jsonb end,
      v_resumen,
      case when jsonb_typeof(x.efecto_gm_previsto) = 'array' then x.efecto_gm_previsto else '[]'::jsonb end,
      coalesce(x.revision_confirmada, false), coalesce(x.propuestas_gm, '{}'::uuid[]), x.nota, x.perfil_id, x.usuario_nombre
    from jsonb_to_record(v_lote) as x(
      id uuid, confirmacion_id uuid, anio integer, filtro jsonb, efecto_gm_previsto jsonb, revision_confirmada boolean,
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
      raise exception 'lote_ajeno' using errcode = 'LP004';
  end;

  return public.respuesta_lote_proyeccion(v_lote_id, false);
end;
$$;

revoke execute on function public.aplicar_lote_proyeccion(jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_lote_proyeccion(jsonb) to service_role;

comment on function public.aplicar_lote_proyeccion(jsonb) is
  'M7 07g 0.15.0: escribe un lote de aprobacion en bloque (aprobar, reaprobar o revertir) en una transaccion. Candado de la proyeccion (for no key update) antes de la idempotencia por lote.id (repetido, o LP004 lote_ajeno; tambien traduce la unique_violation). Comprueba estado (LP001), calculo vivo (LP002), calculado_at (LP003) y, en revertir, el lote revertido (LP005). Por grupo bloquea los registros en orden (fila_id, anio) y comprueba updated_at (timestamptz exacto), registros_lectura, activo, el objetivo segun el tipo y, en ia, la propuesta vigente. Grupo ia atomico entero; metodo y revertir atomicos por fila. Update con lista fija de columnas (sin activo, id, fila_id, anio; con decision_lote_id). Inserta lote_filas, calcula el resumen en SQL e inserta la cabecera al final (FK diferibles). Solo service_role.';

-- ---------------------------------------------------------------------------
-- 7. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.proyeccion_lotes enable row level security;
alter table public.proyeccion_lote_filas enable row level security;
-- `proyeccion_fila_anios` ya tiene RLS (0018); repetirlo es inocuo.
alter table public.proyeccion_fila_anios enable row level security;

revoke all on public.proyeccion_lotes from public, anon, authenticated;
grant all on public.proyeccion_lotes to service_role;
revoke all on public.proyeccion_lote_filas from public, anon, authenticated;
grant all on public.proyeccion_lote_filas to service_role;

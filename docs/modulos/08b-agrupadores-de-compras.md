# 08b · Agrupadores de compras: viajes de compras, embarques y paquetes (con el viaje activo, el comprador responsable y las fechas de recepción alineadas)

> **Estado: especificada el 2026-11-02, pendiente del `arquitecto-revisor` y de las respuestas de Javier (§10).** Es una mejora de la parte de compras de M8 (ficha [08](08-flujo-y-compras.md)), anterior a M9a. Pedido textual de Javier (2026-11-02): «en el modulo de compras necesito poder generar agrupadores de compras. que son los siguientes: Viaje de compras. Embarque. Paquete. Necesitamos un modulo para gestionar estas agrupaciones. y las fechas de recepción van alineadas a ellos. Tambien tendriamos que incluir un comprador responsable. Tambien hay compras locales que si las clasificamos con embarque y paquete.» Contexto que añadió el mismo día: (1) en COTV, la app anterior, el viaje es la entidad `campaigns` (nombre y periodo), y un **«viaje activo»** elegido por cada usuario filtra el trabajo de compras; los proveedores se comparten entre viajes. (2) El maestro de **Proveedores** (puerto de embarque, país, etc.) tiene ficha propia, que escribe otro arquitecto en paralelo (`docs/modulos/NN-proveedores-y-fotos-de-compras.md`): esta ficha solo **usa** `proveedores` como hoy (`compras.proveedor_id`) y no lo define. (3) Orden del menú: Inicio, Compras, Planificación, Maestros, Administración; los agrupadores van **dentro de Compras**.
>
> **Numeración (verificada el 2026-11-02 con `ls supabase/migrations`, `src/lib/version.ts`, PLAN y la ficha 07f).** Aplicadas: `0000`–`0025`, `0027`, `0029`, `0030`. Reservadas: `0026` (`0.13.1 · M8`), `0028` (M9a) y `0031` (07f). **Migración de esta ficha: `0032_agrupadores_compras.sql`** (con `scripts/humo-0032.sql`). **Ojo con la ficha paralela de proveedores**: si también necesita migración, la que se construya primero toma la `0032` y la otra la siguiente libre (decisión 48). **Versión**: la siguiente libre al cerrar (las versiones se asignan en el orden en que cierran las entregas). Hoy `APP_VERSION = "0.15.0 · M7"`; están reservadas `0.13.1 · M8`, `0.15.0 · M7 b` (07f) y `0.15.1 · M7`, así que hoy sería **`0.16.0 · M8`**. Commits `M8:`.
>
> **Verificación de la base real: pendiente.** En la sesión del arquitecto no estaban disponibles el MCP de Supabase ni las credenciales, así que no se leyó `vector-two` (ref `tzjsxzmsvvhxyiooihyq`). Según PLAN §7, la carga inicial de compras sigue pendiente de Javier, de modo que lo más probable es que `compras` esté vacía o casi. En T1, `datos`, y antes el `arquitecto-revisor`, corren en **solo lectura** las consultas de §2.9 y anotan el resultado aquí. **Nunca contra `lukers-compras`.**
>
> Sin datos reales: proveedores «Proveedor Norte», «Feria Sur» y «Taller Lima Centro», compradores C1, C2 y C3, cifras inventadas.

## 0. Lo que esta ficha toma como dado (no se reabre)

| Fuente | Qué se respeta |
|---|---|
| Decisión 2 (M8) | **Se compra por oportunidad, sin OTB por temporada ni por viaje.** El viaje es contexto y filtro, nunca presupuesto. El flujo y los huecos siguen siendo globales |
| Decisión 12 y 28 | Todos los compradores ven todo. **«Lo mío» es un filtro, nunca un permiso.** Una compra al barrer no se asigna a un único comprador |
| Decisión 31 y §3 de la ficha 08 | La fecha de recepción del flujo es el **mes** de cada entrega (`compra_linea_entregas.periodo`). Una línea puede tener varias entregas, en meses distintos |
| Decisión 54 y 55 | **No hay recepción presunta.** Una persona confirma el ingreso en un mes X. Un atajo de un clic se registra siempre a nombre de quien lo usa |
| Decisión 56 y §0.11 | Cancelar con recepciones cierra el saldo. Con el saldo cerrado no se toca el cronograma |
| Decisión 60 y §0.12 | Toda escritura de compras va por funciones plpgsql transaccionales, con candado por `revision` y un evento inmutable por mutación (el trigger también frena a `service_role`) |
| §0.4 (0.13.1) | Toda escritura lleva `revision`; distinta → `409 compra_cambio` |
| PLAN §4 | `id uuid`, `activo`, `created_at`/`updated_at`; RLS sin políticas; `revoke` a `public`, `anon` y `authenticated` con `grant` a `service_role`; migración idempotente, sin `DROP`, `DELETE`, `UPDATE` ni `TRUNCATE` a nivel de migración, sin `do $$`, sin backfill; los catálogos van en zod, sin `check` |
| `VERSION_METODO` (M7) | **No cambia.** Los agrupadores no tocan la proyección |

**Cambio que se propone (§9, decisión 81).** La ficha 08 §4.0 decía «No se adopta: campañas, OTB por viaje». Ahora sí se adopta la **campaña como viaje activo**, pero solo como **contexto y filtro**: OTB por viaje sigue sin adoptarse.

## 1. Objetivo

Hoy las compras de M8 son sueltas: no se sabe en qué viaje se negociaron ni en qué embarque o paquete llegan, y la fecha de llegada de cada entrega se escribe a mano, línea por línea. Este módulo crea tres agrupadores:

- **Viaje de compras**: el comercial; dónde y cuándo se compró. Además es el «viaje activo» con que cada usuario filtra su trabajo.
- **Embarque**: el logístico; qué llega junto y en qué fecha. Hay embarques de importación y locales.
- **Paquete**: la subdivisión de un embarque, con su comprador responsable.

Cada uno lleva un comprador responsable. **La fecha de recepción pasa a vivir en el embarque**: las entregas asignadas se alinean al mes de llegada del embarque, y cambiar esa fecha mueve en bloque, con trazabilidad, todo lo que viaja en él. El flujo y el IMI de M8 no cambian su método: siguen leyendo las mismas entregas, solo que ahora las mueve el embarque.

## 2. Modelo de datos (`0032_agrupadores_compras.sql`)

### 2.1 Forma: jerarquía logística con el viaje como origen comercial (recomendada; pregunta A1/A2)

```
compra_viajes (comercial: dónde y cuándo se compró; «viaje activo»)
   ▲ 0..1                      ▲ 0..1 (opcional: embarque del viaje; los locales no tienen)
compras.viaje_id          compra_embarques (logístico: fecha de llegada, tipo importación | local)
   │                               ▲ 1                         ▲ 1
   │ 1..n                          │                           │
compra_lineas ─1..n─► compra_linea_entregas ◄─1── compra_entrega_asignaciones ──0..1─► compra_paquetes (dentro de UN embarque)
                       (mes × unidades; M8)        (entrega × embarque × paquete × unidades)
                              ▲
compra_linea_recepciones.asignacion_id (0..1: «llegó con este embarque»)
compra_agrupador_eventos (inmutable: viaje | embarque | paquete)
```

**Por qué así y no una jerarquía estricta viaje → embarque → paquete:**

1. **El viaje es un hecho comercial de la compra**, no de la llegada. Se conoce al negociar, antes de que exista un embarque, y la vista del viaje («qué compramos en la Feria Sur») tiene que funcionar desde el primer día. Si el viaje se derivara del embarque, una compra sin embarcar no tendría viaje. Por eso va en `compras.viaje_id`.
2. **El embarque es un hecho de la entrega, no de la compra.** Una compra o una línea puede llegar en dos embarques (entregas parciales, decisión 31), y un embarque consolida compras de varios proveedores. El vínculo correcto es **entrega → embarque**.
3. **El paquete vive dentro de un único embarque** (subdivisión por comprador, línea o lo que Lukers use, pregunta A1). Que el paquete sea de su embarque lo hace cumplir la base con una clave foránea compuesta.
4. **Las compras locales** usan embarque (tipo `local`) y paquete, sin viaje, que es justo lo que pidió Javier.
5. `compra_embarques.viaje_id` es **opcional**: agrupa «los embarques del viaje» en la vista. Si una entrega de una compra del viaje V entra en un embarque del viaje W, el sistema **avisa** (`viaje_distinto`) y no bloquea, porque una consolidación en origen es posible.

**Por qué una tabla de asignaciones y no columnas `embarque_id` y `paquete_id` en `compra_linea_entregas`.** M8 tiene `unique (linea_id, periodo)`: una línea tiene a lo sumo una entrega por mes. Si dos embarques de la misma línea terminan en el mismo mes (uno se atrasa y alcanza al siguiente, que es lo habitual), las dos entregas tendrían que fundirse en una fila que no puede pertenecer a dos embarques. Cambiar la unicidad exigiría `DROP CONSTRAINT`, que el proyecto evita (06c, M12). La tabla `compra_entrega_asignaciones` reparte **las unidades de una entrega** entre embarques y paquetes. Así una entrega de dic de 500 u puede ser 300 de EM-0001 y 200 de EM-0002, y lo que no está asignado queda «sin embarque». El flujo de M8 sigue leyendo `compra_linea_entregas` sin cambios. *Descartada*: una FK compuesta `(embarque_id, periodo)` con `on update cascade` hacia el embarque, porque choca con esa misma unicidad y no rehace los repartos por temporada de los lotes (§5, R6).

### 2.2 `compra_viajes`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `codigo` | `text not null` | Entre 1 y 30 caracteres, en mayúsculas al guardar; **único sobre `upper(codigo)`**. Si llega vacío, la función lo genera: `'VJ-' \|\| lpad(nextval('compra_viajes_codigo_seq'), 4, '0')` (pregunta A4) |
| `nombre` | `text not null` | Entre 1 y 120 («Feria Sur · oct-2026») |
| `destino` | `text null` | ≤ 120, texto libre (país, ciudad, feria). El puerto es dato del proveedor (ficha de proveedores) |
| `fecha_inicio` | `date not null` | El «periodo» de la campaña de COTV |
| `fecha_fin` | `date null` | `check (fecha_fin is null or fecha_fin >= fecha_inicio)` |
| `responsable_id` | `uuid null → perfiles on delete set null` | Índice. La API lo **exige al crear** (comprador activo, §2.7). Nulo solo si se borra el perfil (cuenta como faltante) |
| `estado` | `text not null default 'abierto'` | zod: `abierto`, `cerrado`, `cancelado`. Sin `check` (I9) |
| `nota` | `text null` | ≤ 500 |
| `revision` | `integer not null default 0` | `check (revision >= 0)`; candado optimista, como `compras.revision` |
| `perfil_id → perfiles set null`, `usuario_nombre` | | Quién lo creó |
| `updated_by_id → perfiles set null`, `updated_by_nombre` | | Último cambio |
| `activo`, `created_at`, `updated_at` | | Trigger `set_updated_at`. **Nunca se borra**: se cancela (las FK `restrict` de compras y eventos lo impiden) |

Índices: único `upper(codigo)`, `(estado)`, `(fecha_inicio)`, `(responsable_id)`, `(perfil_id)`, `(updated_by_id)`.

### 2.3 `compra_embarques`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `codigo` | `text not null` | Único sobre `upper`; autogenerado `'EM-' \|\| lpad(…)` si llega vacío (secuencia `compra_embarques_codigo_seq`) |
| `nombre` | `text not null` | Entre 1 y 120 |
| `tipo` | `text not null default 'importacion'` | zod: `importacion`, `local`. La API exige `local` ⇒ `viaje_id` nulo |
| `viaje_id` | `uuid null → compra_viajes on delete restrict` | Índice |
| `responsable_id` | `uuid null → perfiles on delete set null` | Nulo = hereda del viaje (§2.7). Índice |
| `referencia_logistica` | `text null` | ≤ 80 (BL, contenedor, guía de remisión del proveedor local) |
| `fecha_salida_estimada` | `date null` | Informativa (ETD) |
| `fecha_llegada_estimada` | `date not null` | **Llegada al CD** (pregunta B2). Es la que alinea las entregas |
| `fecha_llegada_real` | `date null` | La pone «Recibir embarque» (§3.6) |
| `periodo_llegada` | `date generated always as (…) stored` | Primer día del mes de `coalesce(fecha_llegada_real, fecha_llegada_estimada)`. **`datos` debe usar una expresión inmutable** (`make_date(extract(year …)::int, extract(month …)::int, 1)` o `date_trunc('month', x::timestamp)::date`; `date_trunc` sobre `date` sin el cast a `timestamp` resuelve a la versión con zona horaria, que es `stable`, y la columna generada falla). Índice |
| `estado` | `text not null default 'planificado'` | zod: `planificado`, `en_transito`, `recibido`, `cancelado` |
| `nota` | `text null` | ≤ 500 |
| `revision`, `perfil_id`, `usuario_nombre`, `updated_by_*`, `activo`, timestamps | | Como en viajes. La `revision` del embarque cubre también a **sus paquetes** |

Checks: `fecha_salida_estimada is null or fecha_salida_estimada <= fecha_llegada_estimada`. Índices: único `upper(codigo)`, `(viaje_id)`, `(periodo_llegada)`, `(estado)`, `(responsable_id)`, más los de autoría.

**Proveedores en un embarque.** El embarque **no** tiene `proveedor_id`: sus proveedores se derivan de las compras de sus entregas (`compras.proveedor_id`). El país y el puerto de embarque de cada proveedor los define la ficha de proveedores; la pantalla del embarque los muestra cuando esa ficha esté construida.

### 2.4 `compra_paquetes`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `embarque_id` | `uuid not null → compra_embarques on delete restrict` | Índice |
| `codigo` | `text not null` | Entre 1 y 20; **único por embarque sobre `upper(codigo)`** (`P1`, `P2`…; autogenerado `P<n>` si llega vacío) |
| `nombre` | `text null` | ≤ 120 |
| `responsable_id` | `uuid null → perfiles set null` | Nulo = hereda del embarque (§2.7). Índice |
| `estado` | `text not null default 'abierto'` | zod: `abierto`, `cancelado` |
| `nota` | `text null` | ≤ 300 |
| autoría, `activo`, timestamps | | |
| | `constraint compra_paquetes_id_embarque_key unique (id, embarque_id)` | Destino de la FK compuesta de §2.5. Va **dentro** del `create table if not exists` para que sea idempotente sin `do $$` |

Sin fecha propia: **un paquete llega con su embarque** (pregunta B1).

### 2.5 `compra_entrega_asignaciones` (qué unidades de qué entrega viajan en qué embarque y paquete)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `entrega_id` | `uuid not null → compra_linea_entregas on delete restrict` | Índice. `restrict` a propósito: ninguna función (tampoco las de `0.13.1`) puede borrar una entrega con unidades asignadas sin ocuparse de la asignación (§3.10) |
| `embarque_id` | `uuid not null → compra_embarques on delete restrict` | Índice |
| `paquete_id` | `uuid null` | **FK compuesta** `(paquete_id, embarque_id) → compra_paquetes (id, embarque_id) on update cascade on delete restrict`. Con `paquete_id` presente, la base garantiza que el paquete es de ese embarque. Si un paquete pasa a otro embarque, sus asignaciones siguen al paquete solas; la función rehace en la misma transacción el mes de las entregas (§3.5) |
| `unidades` | `integer not null` | `check (unidades > 0)` |
| `perfil_id`, `usuario_nombre` | | Quién asignó |
| `activo`, timestamps | | `activo` por convención y sin uso: quitar borra la fila dentro de la función, y la fila completa queda en el `antes` del evento |

Único: `(entrega_id, embarque_id, coalesce(paquete_id, '00000000-0000-0000-0000-000000000000'))`. Índice `(paquete_id)`.

Invariantes que la base no puede expresar y que la función central (§2.8) **verifica al final de cada llamada** (si fallan, lanza una excepción y se deshace todo):

- **I1**: `Σ asignaciones.unidades` de una entrega `≤ entrega.unidades`.
- **I2 (alineación)**: para toda asignación **activa** (compra en `borrador` o `confirmada`), `entrega.periodo = embarque.periodo_llegada`.
- **I3**: `Σ entregas = compra_lineas.unidades`, al menos una entrega por línea, y en un lote `Σ repartos` por entrega `= entrega.unidades` (las mismas de M8).

**Asignación histórica**: la de una compra `recibida` o `cancelada`. Se conserva como historia y queda fuera de I2, de los movimientos y de los totales «pendientes» del embarque (§5, R10).

### 2.6 Columnas nuevas en tablas de M8 (aditivas)

- `compras.viaje_id uuid null references compra_viajes(id) on delete restrict`, con índice (`add column if not exists`). **Sin backfill**: las compras ya cargadas quedan sin viaje, y la pestaña «Sin agrupador» (§4.4) las lista para asignarlas en bloque.
- `compra_linea_recepciones.asignacion_id uuid null references compra_entrega_asignaciones(id) on delete restrict`, con índice. Nulo en todo lo que hay hoy y en lo que registren las rutas de M8 (Confirmar ingreso, Aceptar sugerencia, importador). Lleno solo en «Recibir embarque». `restrict`: no se quita una asignación que ya tiene recepciones (primero se quita la recepción).

### 2.7 Comprador responsable

- **Asignables**: perfiles con `rol = 'comprador'` y `activo = true`, como M1b (pregunta C2). Se reutiliza la consulta de compradores asignables de `src/lib/responsables/consultas.ts`.
- **Uno por nivel; obligatorio solo en el viaje** (pregunta C1). **Responsable efectivo** (se calcula al leer, no se guarda): `paquete.responsable ?? embarque.responsable ?? viaje.responsable` (el viaje, si el embarque tiene). Cada fila de la API lleva `responsable_efectivo { perfil_id, nombre, origen: 'propio' | 'embarque' | 'viaje' } | null`.
- **Faltante** (aviso `sin_responsable`): el efectivo es nulo o ya no es un comprador activo (desactivado o con otro rol). Como en M1b, desactivar o cambiar el rol **conserva** la asignación y la marca como faltante; borrar el perfil la pone en nulo (`on delete set null`) y entonces pasa a heredar.
- **«Mis viajes / Mis embarques / Mis paquetes»** = responsable efectivo igual al usuario. Es un **filtro**, nunca un permiso (decisión 28). No se mezcla con «Mis líneas» de M8, que sale de M1b por género × mundo; las dos se ofrecen como chips distintos.

### 2.8 Funciones (todas `plpgsql`, `security invoker`, `set search_path = ''`, solo `service_role`, `returns jsonb` `{ ok, … }` o `{ ok: false, motivo }`)

| Función | Qué hace | Motivos de rechazo |
|---|---|---|
| `guardar_viaje(p_viaje jsonb, p_revision int, p_actor jsonb)` | Crea (`p_revision` nulo) o edita; genera el código; evento `crear`/`editar` | `agrupador_cambio`, `codigo_duplicado`, `no_encontrado`, `no_editable` (cancelado) |
| `guardar_embarque(p_embarque jsonb, p_revision int, p_actor jsonb)` | Crea o edita todo **menos las fechas de llegada** una vez creado (esas van por movimiento) | Lo anterior y `fecha_por_movimiento` |
| `guardar_paquete(p_paquete jsonb, p_revision_embarque int, p_actor jsonb)` | Crea o edita un paquete de un embarque | `agrupador_cambio`, `codigo_duplicado`, `embarque_no_editable` |
| `cambiar_estado_agrupador(p_tipo text, p_id uuid, p_accion text, p_revision int, p_motivo text, p_actor jsonb)` | Transiciones de §5, R13 | `transicion_invalida`, `tiene_asignaciones_activas`, `tiene_compras`, `tiene_recepciones`, `motivo_requerido` |
| `asignar_viaje_compras(p_viaje uuid, p_compras jsonb, p_actor jsonb)` | Pone o quita (`p_viaje` nulo) el viaje de varias compras `[{ id, revision }]`; bloquea las compras en orden de `id`; `revision + 1` y un evento `asignar_viaje` por compra | `compra_cambio`, `no_editable` (cancelada), `viaje_no_abierto` |
| **`aplicar_movimiento_agrupador(p_plan jsonb, p_actor jsonb)`** | **La función central.** Aplica un plan que la API calcula en TS: asignar, quitar, mover a otro paquete, cambiar la fecha, pasar pendientes, mover un paquete o recibir. (1) Bloquea los embarques del plan y después las compras, siempre en orden de `id` (sin abrazos mortales) y compara sus `revision`. (2) Comprueba la pertenencia de entregas, asignaciones, paquetes y recepciones. (3) Escribe entregas (upsert por `(linea_id, periodo)`; borra las que queden en 0 sin asignaciones), repartos de las entregas tocadas, asignaciones, fechas y estado del embarque y, en `recibir`, recepciones con `asignacion_id`. (4) Verifica I1 a I3. (5) Llama a `compra_recalcular_estado` de M8 por compra y sube `revision` y `updated_by_*` de cada compra y de cada embarque. (6) Registra un evento en `compra_eventos` por compra (acción nueva `mover_entregas`, `asignar_agrupador` o `recibir`, con `antes` y `despues` de entregas, repartos y asignaciones de esa compra) y uno en `compra_agrupador_eventos` por embarque | `agrupador_cambio`, `compra_cambio`, `no_pertenece`, `embarque_no_editable`, `embarque_con_recepciones`, `asignacion_con_recepciones`, `excede_entrega`, `compra_no_asignable`, `saldo_cerrado`, `excede_pendiente`, `recepcion_antes_de_compra` |
| `agrupadores_desalineados()` | Solo lectura: asignaciones activas con `entrega.periodo ≠ embarque.periodo_llegada`. Para el humo, la prueba de I2 y el aviso `desalineada` | — |
| `tg_compra_agrupador_eventos_inmutable` | Trigger `before update or delete` por fila, más uno de sentencia contra `TRUNCATE` (como `0030`), también para `service_role`. Única excepción: el `UPDATE` que solo pone `perfil_id` en nulo (decisión 60) | — |

**No se reemplaza ninguna función de M8** (`registrar_recepciones`, `importar_compra`, `cancelar_compra` y `quitar_recepcion` quedan tal cual). `aplicar_movimiento_agrupador` repite las tres validaciones de recepción de `registrar_recepciones` (`no_editable`, `excede_pendiente`, `recepcion_antes_de_compra`) y reutiliza `compra_recalcular_estado`. Se eligió esa duplicación pequeña antes que tocar una función ya aplicada y validada.

**`compra_agrupador_eventos`**: `viaje_id`, `embarque_id` y `paquete_id`, nulos y con `on delete restrict`, con `check (num_nonnulls(viaje_id, embarque_id, paquete_id) >= 1)` (el evento de un paquete lleva también su embarque); `accion text not null` (zod: `crear`, `editar`, `cambiar_estado`, `asignar_viaje`, `asignar`, `quitar`, `mover_paquete`, `cambiar_fecha`, `pasar_pendientes`, `recibir`); `antes` y `despues` en `jsonb`; `motivo` (≤ 300); `resumen` (≤ 300); `compras jsonb not null default '[]'` (`[{ compra_id, revision_nueva }]`); `perfil_id → perfiles set null`; `usuario_nombre`; `created_at`. Sin `updated_at` ni `activo`. Índices `(embarque_id, created_at)`, `(viaje_id, created_at)`, `(paquete_id)` y `(perfil_id)`.

**Secuencias**: `compra_viajes_codigo_seq` y `compra_embarques_codigo_seq`, con `revoke all … from public, anon, authenticated` y `grant usage, select … to service_role`, como `compras_numero_seq`. **RLS** activo y sin políticas en las cinco tablas nuevas; `revoke`/`grant` por objeto; `comment on` en cada uno.

**La huella del flujo no cambia.** Todo movimiento que toca entregas sube `compras.revision` e inserta en `compra_eventos`, que ya forman parte de `flujo_huella_base()`. Editar solo el nombre de un embarque no invalida el flujo, que es lo correcto.

### 2.9 Consultas de verificación de la base (solo lectura, `vector-two`; las corre `datos` en T1 y el revisor antes)

```sql
select estado, origen, count(*) from public.compras group by 1, 2;
select count(*) lineas, count(*) filter (where tipo = 'barrer_marca') lotes from public.compra_lineas;
select to_char(periodo, 'YYYY-MM') mes, count(*), sum(unidades) from public.compra_linea_entregas group by 1 order by 1;
select count(*) from (select linea_id from public.compra_linea_entregas group by 1 having count(*) > 1) x;   -- líneas con entregas parciales
select count(*), sum(unidades) from public.compra_linea_recepciones;
select rol, activo, count(*) from public.perfiles group by 1, 2;                                             -- compradores asignables
select to_regclass('public.compra_viajes'), to_regclass('public.compra_embarques'), to_regclass('public.compra_paquetes');  -- nombres libres
```

## 3. Contratos de API

Convenciones: handlers en `src/app/api/compras/{viajes,embarques,paquetes,agrupadores}/**`. **La primera sentencia de cada handler es el guard.** Solo `supabaseAdmin()`. Cuerpo con `leerCuerpo(request, esquema)` y respuestas con `ok({ … })` (`{ data }`) y `errorConCodigo(mensaje, status, codigo)` de `src/lib/api/respuestas.ts`. Lectura con `leerTodo` en orden estable. **Ninguna escritura directa** (`.insert(`, `.update(`, `.upsert(` o `.delete(`) sobre las tablas nuevas ni sobre las de compras: solo `.rpc(` (prueba estática). Lógica pura en `src/lib/compras/agrupadores/`.

**Guards en esta entrega**: las lecturas son `requireUser` y las escrituras `requirePlanner` (en M8 el comprador todavía no escribe). Con M9a las escrituras pasan a `requireUser` con la misma lista blanca de M9a (pregunta C3). `requireAdmin` no se usa.

**Concurrencia**: viajes y embarques llevan `revision`. Las escrituras que tocan compras llevan además la `revision` de cada compra que el usuario vio (asignar y quitar) o ninguna (cambiar fecha, pasar pendientes, mover paquete y recibir: la API lee las revisiones justo antes de llamar a la función). Si la función devuelve `compra_cambio` en esas operaciones de bloque, **la API recalcula el plan y reintenta una vez**; si vuelve a fallar, `409`. Toda escritura de movimiento acepta `?previsualizar=1`, que devuelve el plan y los avisos sin escribir.

### 3.1 Esquemas zod (`src/lib/compras/agrupadores/esquemas.ts`)

```ts
const codigo = z.string().trim().max(30).transform(s => s.toUpperCase());
guardarViajeSchema = z.object({
  revision: z.number().int().min(0).optional(),           // ausente = crear
  codigo: codigo.optional(), nombre: z.string().trim().min(1).max(120),
  destino: z.string().trim().max(120).nullable().optional(),
  fecha_inicio: fechaIso, fecha_fin: fechaIso.nullable().optional(),
  responsable_id: z.uuid(), nota: z.string().trim().max(500).nullable().optional(),
}).refine(v => !v.fecha_fin || v.fecha_fin >= v.fecha_inicio, "fin_antes_de_inicio");
guardarEmbarqueSchema = z.object({
  revision: z.number().int().min(0).optional(), codigo: codigo.optional(),
  nombre: z.string().trim().min(1).max(120), tipo: z.enum(["importacion", "local"]),
  viaje_id: z.uuid().nullable(), responsable_id: z.uuid().nullable(),
  referencia_logistica: z.string().trim().max(80).nullable().optional(),
  fecha_salida_estimada: fechaIso.nullable().optional(),
  fecha_llegada_estimada: fechaIso.optional(),             // obligatoria al crear; prohibida al editar
  nota: z.string().trim().max(500).nullable().optional(),
}).refine(v => v.tipo !== "local" || v.viaje_id === null, "local_con_viaje")
  .refine(salidaAntesDeLlegada, "salida_despues_de_llegada");
guardarPaqueteSchema = z.object({ revision_embarque: z.number().int().min(0), codigo: z.string().trim().max(20).optional(),
  nombre: z.string().trim().max(120).nullable().optional(), responsable_id: z.uuid().nullable(),
  nota: z.string().trim().max(300).nullable().optional() });
cambiarEstadoSchema = z.object({ revision: z.number().int().min(0),
  accion: z.enum(["cerrar", "reabrir", "cancelar", "en_transito", "volver_a_planificado"]),
  motivo: z.string().trim().max(200).optional() });          // obligatorio (1–200) con cancelar
asignarViajeSchema = z.object({ viaje_id: z.uuid().nullable(),
  compras: z.array(z.object({ id: z.uuid(), revision: z.number().int().min(0) })).min(1).max(500) });
asignarEntregasSchema = z.object({ revision: z.number().int().min(0), paquete_id: z.uuid().nullable(),
  items: z.array(z.object({ entrega_id: z.uuid(), unidades: z.number().int().positive(),
    compra_revision: z.number().int().min(0) })).min(1).max(2000) });
quitarAsignacionesSchema = z.object({ revision: z.number().int().min(0),
  asignaciones: z.array(z.object({ id: z.uuid(), compra_revision: z.number().int().min(0) })).min(1).max(2000) });
moverAPaqueteSchema = z.object({ revision: z.number().int().min(0), paquete_id: z.uuid().nullable(),
  asignaciones: z.array(z.uuid()).min(1).max(2000) });      // mismo embarque: no mueve meses
cambiarFechaSchema = z.object({ revision: z.number().int().min(0), fecha_llegada_estimada: fechaIso,
  motivo: z.string().trim().min(1).max(300) });
moverPaqueteSchema = z.object({ revision: z.number().int().min(0), embarque_destino_id: z.uuid(),
  revision_destino: z.number().int().min(0), motivo: z.string().trim().min(1).max(300) });
pasarPendientesSchema = z.object({ revision: z.number().int().min(0), embarque_destino_id: z.uuid(),
  revision_destino: z.number().int().min(0), paquete_destino_id: z.uuid().nullable(),
  asignaciones: z.array(z.uuid()).max(2000).optional(),    // ausente = todas las que tengan pendiente
  motivo: z.string().trim().min(1).max(300) });
recibirEmbarqueSchema = z.object({ revision: z.number().int().min(0), fecha_llegada_real: fechaIso,
  periodo: mesIso.optional(),                               // ausente = mes de fecha_llegada_real
  items: z.array(z.object({ asignacion_id: z.uuid(), unidades: z.number().int().min(0) })).max(2000).optional(), // ausente = todo lo pendiente
  nota: z.string().trim().max(200).nullable().optional() });
viajeActivoSchema = z.object({ viaje_id: z.union([z.uuid(), z.literal("todos"), z.literal("sin_viaje")]) });
```

### 3.2 Tipos de respuesta (`src/lib/compras/agrupadores/tipos-api.ts`)

`ViajeApi { id, codigo, nombre, destino, fecha_inicio, fecha_fin, estado, revision, responsable: PerfilRef | null, responsable_valido: boolean, totales: { compras, unidades, costo: { PEN, USD }, embarques, unidades_sin_embarque }, avisos: AvisoAgrupador[], creado_por, modificado_por }`.
`EmbarqueApi { id, codigo, nombre, tipo, viaje: { id, codigo, nombre } | null, referencia_logistica, fecha_salida_estimada, fecha_llegada_estimada, fecha_llegada_real, periodo_llegada: 'aaaa-mm', estado, recepcion: 'sin_recibir' | 'parcial' | 'completa' | 'vacio', revision, responsable_efectivo: ResponsableEfectivo | null, totales: { paquetes, compras, lineas, unidades, recibidas, pendientes, historicas, costo: { PEN, USD } }, proveedores: { id, nombre }[], avisos }`.
`EmbarqueDetalleApi = EmbarqueApi & { paquetes: PaqueteApi[], asignaciones: AsignacionApi[], historial_resumen }`.
`PaqueteApi { id, embarque_id, codigo, nombre, estado, responsable_efectivo, totales: { compras, unidades, recibidas, pendientes } }`.
`AsignacionApi { id, entrega_id, periodo, paquete_id, unidades, recibidas, pendiente, historica, compra: { id, numero, revision, estado, proveedor, viaje_id }, linea: { id, tipo, gml: NombreGml | null, marca, agrupacion_marca, tallas, costo_unitario, moneda } }`.
`PlanMovimientoApi { operacion, compras_afectadas: number, lineas: number, unidades_movidas: number, movimientos: { compra_numero, linea, de: 'aaaa-mm', a: 'aaaa-mm', unidades }[], avisos }`.
`RespuestaMovimientoApi { embarque: EmbarqueDetalleApi, embarques_tocados: string[], compras: { id, revision }[], avisos }`.
`SinAgrupadorApi { entregas: { entrega_id, periodo, unidades_sin_embarque, compra, linea }[], compras_sin_viaje: { id, numero, proveedor, fecha_compra, unidades }[] }`.
`AvisoAgrupador` (códigos): `atrasado` (ETA anterior a hoy en Lima, estado `planificado` o `en_transito` y pendiente > 0), `sin_responsable`, `viaje_distinto`, `cambia_temporada` (un lote cruza de temporada y se reparte de nuevo), `fecha_en_mes_cerrado` (mes de llegada ≤ `k'`: sus pendientes quedan vencidas y el flujo las espera en `k'+1`), `pendientes_tras_recibir`, `desalineada`, `asignaciones_historicas`, `entregas_fusionadas`.

### 3.3 Rutas

| Ruta | Método | Guard | Cuerpo | Respuesta `{ data }` | Errores |
|---|---|---|---|---|---|
| `/api/compras/viajes` | GET | `requireUser` | `?estado&responsable_id&mio=1&q` | `{ viajes: ViajeApi[], compradores_asignables }` | — |
| `/api/compras/viajes` | POST | `requirePlanner` | `guardarViajeSchema` (sin `revision`) | `{ viaje: ViajeApi }` | 400 `validacion`, 409 `codigo_duplicado`, 409 `responsable_no_comprador` |
| `/api/compras/viajes/[id]` | GET | `requireUser` | — | `{ viaje, compras: CompraResumenApi[], embarques: EmbarqueApi[] }` | 404 `no_encontrado` |
| `/api/compras/viajes/[id]` | PATCH | `requirePlanner` | `guardarViajeSchema` con `revision` | `{ viaje }` | 404, 409 `agrupador_cambio`, `codigo_duplicado`, `no_editable` |
| `/api/compras/viajes/[id]/estado` | POST | `requirePlanner` | `cambiarEstadoSchema` | `{ viaje }` | 409 `transicion_invalida`, `tiene_compras`, `motivo_requerido` |
| `/api/compras/viajes/[id]/compras` | POST | `requirePlanner` | `asignarViajeSchema` (`viaje_id` = el de la ruta o `null` para quitar) | `{ viaje, compras: {id, revision}[] }` | 409 `compra_cambio`, `viaje_no_abierto`, `no_editable` |
| `/api/compras/embarques` | GET | `requireUser` | `?estado&tipo&viaje_id\|sin_viaje&desde&hasta&responsable_id&mio=1&atrasados=1&q` | `{ embarques: EmbarqueApi[] }` | — |
| `/api/compras/embarques` | POST | `requirePlanner` | `guardarEmbarqueSchema` | `{ embarque }` | 400 `local_con_viaje`, 409 `codigo_duplicado`, `viaje_no_abierto`, `responsable_no_comprador` |
| `/api/compras/embarques/[id]` | GET | `requireUser` | — | `{ embarque: EmbarqueDetalleApi }` | 404 |
| `/api/compras/embarques/[id]` | PATCH | `requirePlanner` | `guardarEmbarqueSchema` sin fecha de llegada | `{ embarque }` | 409 `agrupador_cambio`, `fecha_por_movimiento`, `embarque_no_editable` |
| `/api/compras/embarques/[id]/estado` | POST | `requirePlanner` | `cambiarEstadoSchema` | `{ embarque }` | 409 `transicion_invalida`, `tiene_asignaciones_activas`, `tiene_recepciones` |
| `/api/compras/embarques/[id]/paquetes` | POST | `requirePlanner` | `guardarPaqueteSchema` | `{ embarque }` | 409 `agrupador_cambio`, `codigo_duplicado`, `embarque_no_editable` |
| `/api/compras/paquetes/[id]` | PATCH | `requirePlanner` | `guardarPaqueteSchema` | `{ embarque }` | 404, 409 como arriba |
| `/api/compras/paquetes/[id]/estado` | POST | `requirePlanner` | `cambiarEstadoSchema` (`cancelar`) | `{ embarque }` | 409 `tiene_asignaciones_activas` |
| `/api/compras/paquetes/[id]/mover` | POST | `requirePlanner` | `moverPaqueteSchema` | `RespuestaMovimientoApi` o `PlanMovimientoApi` | 409 `agrupador_cambio`, `asignacion_con_recepciones`, `embarque_no_editable` |
| `/api/compras/embarques/[id]/asignar` | POST | `requirePlanner` | `asignarEntregasSchema` | ídem | 404 `no_pertenece`, 409 `excede_entrega`, `compra_no_asignable`, `saldo_cerrado`, `compra_cambio`, `agrupador_cambio`, `embarque_no_editable` |
| `/api/compras/embarques/[id]/quitar` | POST | `requirePlanner` | `quitarAsignacionesSchema` (las unidades quedan **sin embarque en el mismo mes**) | ídem | 409 `asignacion_con_recepciones`, `compra_cambio` |
| `/api/compras/embarques/[id]/paquete` | POST | `requirePlanner` | `moverAPaqueteSchema` | ídem | 404 `no_pertenece` |
| `/api/compras/embarques/[id]/fecha` | POST | `requirePlanner` | `cambiarFechaSchema` | ídem | 409 `embarque_con_recepciones`, `embarque_no_editable`, `agrupador_cambio` |
| `/api/compras/embarques/[id]/pasar-pendientes` | POST | `requirePlanner` | `pasarPendientesSchema` | ídem | 409 `sin_pendientes`, `embarque_no_editable` (destino `recibido` o `cancelado`), `paquete_de_otro_embarque` |
| `/api/compras/embarques/[id]/recibir` | POST | `requirePlanner` | `recibirEmbarqueSchema` | ídem | 409 `excede_pendiente`, `recepcion_antes_de_compra`, `embarque_no_editable`, `sin_pendientes` |
| `/api/compras/agrupadores/sin-asignar` | GET | `requireUser` | `?viaje_id&desde&hasta&proveedor_id&q` | `SinAgrupadorApi` | — |
| `/api/compras/agrupadores/opciones` | GET | `requireUser` | — | `{ viajes, embarques, paquetes, compradores_asignables }` (abiertos o planificados, para los selectores) | — |
| `/api/compras/agrupadores/historial` | GET | `requireUser` | `?viaje_id\|embarque_id\|paquete_id` | `{ eventos: EventoAgrupadorApi[] }` | 404 |
| `/api/compras/viaje-activo` | PUT | `requireUser` | `viajeActivoSchema` | `{ viaje_activo }` (pone la cookie `v2_viaje_activo`) | 404 `no_encontrado` |

**Cambios aditivos en rutas de M8** (dueño `backend`): `GET /api/compras` acepta `?viaje_id=…|sin_viaje&embarque_id=…`. `CompraApi` suma `viaje { id, codigo, nombre } | null` y, en cada entrega, `asignaciones: { embarque_codigo, paquete_codigo, unidades }[]` y `sin_embarque: number`. `POST /api/compras/importar` gana las columnas opcionales de §3.9. `ACCIONES_EVENTO` de `src/lib/compras/tipos.ts` suma `asignar_viaje`, `asignar_agrupador` y `mover_entregas` (es un catálogo zod: la base no cambia).

### 3.4 Asignar (lógica pura `planAsignar`)

Por cada ítem (una entrega y unidades), comprueba que la entrega es de una compra en `borrador` o `confirmada` (si no, `compra_no_asignable`) y que la compra no tiene el saldo cerrado (`saldo_cerrado`). Las unidades no pueden pasar de lo que la entrega tiene sin asignar (`excede_entrega`). Si `entrega.periodo ≠ embarque.periodo_llegada`, esas unidades **pasan** de la entrega de origen a la entrega del mes del embarque en la misma línea (la crea o la funde). La de origen baja y, si queda en 0 sin otras asignaciones, se borra. Un lote se reparte de nuevo (R6). Aviso `entregas_fusionadas` cuando hubo fusión.

### 3.5 Cambiar la fecha, mover un paquete, pasar pendientes

- **Cambiar la fecha** dentro del mismo mes: solo cambia el embarque (evento `cambiar_fecha`), sin tocar compras. **A otro mes**: todas las asignaciones **activas** se mueven al mes nuevo (como en §3.4); las históricas no se mueven y se informan (`asignaciones_historicas`). Bloquea si el embarque tiene recepciones vinculadas (`embarque_con_recepciones`): lo que ya llegó no cambia de fecha, y lo que falta se pasa a otro embarque. El motivo es obligatorio.
- **Mover un paquete** a otro embarque: solo si el paquete no tiene recepciones vinculadas. La FK compuesta lleva las asignaciones al embarque nuevo y la función mueve sus entregas al mes de ese embarque.
- **Pasar pendientes**: de cada asignación elegida, lo **pendiente** (§3.7) sale a una asignación nueva en el embarque (y paquete) de destino, y su entrega se mueve al mes del destino. La asignación de origen queda con las unidades recibidas, o se borra si no tiene recepciones.

### 3.6 Recibir un embarque («Confirmar ingreso» en bloque; decisiones 54 y 55)

Una persona pulsa «Recibir embarque», confirma un texto como «Confirmar ingreso de 1 180 u de 5 compras de EM-0001 en dic-2026, a tu nombre» y la función, en **una** transacción:

1. pone `fecha_llegada_real` y `estado = 'recibido'`;
2. si `periodo_llegada` cambia de mes, alinea las asignaciones activas al mes real (como §3.5, lotes incluidos);
3. registra una recepción por asignación y unidades (por defecto todo lo pendiente, editable por paquete o línea), con `recibida_periodo = periodo` (por defecto el mes real), `fecha_recepcion = fecha_llegada_real`, `origen = 'manual'`, `asignacion_id`, el usuario y la nota «Llegada del embarque EM-0001»;
4. recalcula el estado de cada compra y sube su `revision`.

Si queda pendiente, el embarque queda `recibido` con `recepcion = 'parcial'` y el aviso `pendientes_tras_recibir`, y ofrece «Registrar otra llegada», «Pasar pendientes» o «Quitar del embarque». **Nunca se ejecuta sola.** El botón se desactiva mientras la petición está en vuelo.

### 3.7 Pendiente por asignación (pura, `pendientesPorAsignacion`) y cambio en `pendientesPorEntrega`

- **`pendientesPorEntrega` (M8, `src/lib/compras/pendientes.ts`)**: `RecepcionParaPendientes` gana `entrega_id?: string`, que `consultas.ts` deriva de `asignacion_id → asignación.entrega_id`. **Las recepciones vinculadas consumen primero su entrega**; las demás siguen FIFO como hoy sobre lo que quede libre. Sin recepciones vinculadas (todo lo que existe hoy), el resultado es **idéntico** (prueba de regresión con todos los fixtures de M8). Por qué: si EM-0002 (dic) llega antes que EM-0001 (nov) y nadie movió la fecha de EM-0001, el FIFO puro daría por recibido nov y dejaría pendiente dic, que es el mes equivocado para el flujo. **`VERSION_METODO_FLUJO` pasa de 3 a 4** (`src/lib/flujo/tipos.ts`), para invalidar la caché; el método del flujo no cambia.
- **Dentro de una entrega**, lo asignado por FIFO a la entrega se reparte entre sus asignaciones: primero las recepciones vinculadas de cada una; después lo no vinculado, en orden `(embarque.periodo_llegada, embarque.codigo, paquete.codigo)`; la parte «sin embarque» va al final. Lo cancelado (saldo cerrado) se descuenta en orden inverso. `pendiente_a = unidades_a − recibidas_a − canceladas_a`.

### 3.8 Viaje activo (el papel de `campaigns` en COTV)

- Es una **preferencia de cada usuario**, no un dato de negocio: la cookie `v2_viaje_activo` guarda el `uuid` de un viaje, `todos` o `sin_viaje`. La pone `PUT /api/compras/viaje-activo` tras comprobar que el viaje existe. **Nunca se usa como permiso**: las rutas reciben `viaje_id` de forma explícita en la consulta y la cookie solo fija el valor inicial de la pantalla.
- **Valor por defecto si no hay cookie** (o el viaje ya no existe o está cancelado): el último viaje `abierto` por `fecha_inicio` del que el usuario es responsable; si no tiene ninguno, «Todos» (pregunta C4). COTV tomaba el más reciente para todos; aquí un planner ve todo por defecto.
- **Qué filtra**: Compras (lista e importador), Viajes y embarques (embarques del viaje más, con «Sin viaje», los locales) y Sin agrupador. **Qué no filtra**: Huecos y Flujo mensual, porque la necesidad es global (decisión 2). Ahí el selector no aparece.
- **Qué propone**: al crear una compra (captura de `0.13.1` y M9a), `viaje_id` = el viaje activo, editable. El importador de M9a usa el viaje activo cuando la columna `VIAJE` llega vacía; **la carga inicial (`0.13.0`) no**: allí solo cuenta lo explícito.
- Los proveedores son de todos los viajes, como en COTV (la ficha de proveedores los define).

### 3.9 Importador de compras de M8: columnas opcionales `VIAJE`, `EMBARQUE`, `PAQUETE` (por código)

Las tres van **fuera de `huella_importacion`**, así que un archivo ya importado sigue dando `igual`. El importador **no crea agrupadores**: un código desconocido da la omisión `viaje_desconocido`, `embarque_desconocido` o `paquete_desconocido`. Reglas:

- `PAQUETE` exige `EMBARQUE` (`paquete_sin_embarque`).
- Con `EMBARQUE`, la línea toma el mes del embarque. Si `LLEGADA` viene con otro mes, se omite (`llegada_distinta_del_embarque`). Si viene `ENTREGAS` con más de una entrega, también (`entregas_con_embarque`: una línea con entregas parciales se asigna en pantalla).
- Una línea `igual` sin asignación recibe la asignación. Una línea ya asignada a otro embarque se omite (`agrupador_distinto`: eso se cambia en pantalla).
- **Dos transacciones por compra**: primero `importar_compra` (M8, sin cambios) y después `asignar_viaje_compras` y `aplicar_movimiento_agrupador`. Un corte entre las dos deja la compra sin agrupador, y **reimportar lo completa** (`igual` + asignación). El reporte final lo dice.

### 3.10 Contrato con `0.13.1` (para su ficha; no se construye aquí)

Las funciones de `0026` que editan cronogramas (reemplazar entregas, editar línea, cambiar el tipo) deben respetar I1 a I3. No pueden bajar las unidades de una entrega por debajo de lo asignado (`409 entrega_asignada`, «quítala del embarque o muévela con el embarque»). No pueden cambiar el mes de una entrega con asignaciones activas (la mueve el embarque). Una entrega nueva nace sin embarque. La captura manual ofrece «Viaje» (por defecto el activo) y, por entrega, «Embarque / paquete» (opcional; si se elige, el mes lo pone el embarque). Si `0.13.1` se construye **antes** que esta ficha, la `0032` añade estas comprobaciones con `create or replace` de esas funciones (pregunta D1).

## 4. Pantallas (kit de UI de Vector2: `Tabs`, `DataTable`, `Modal`, `Form`, `Chips`, `Badge`, `Alert`, `EmptyState`; hook `useColeccion`; formato `es-PE`; usable a 390 px)

**Menú (`src/lib/nav.ts`, sección Compras, `TODOS`)**: Huecos · Flujo mensual · Compras · **Viajes y embarques** (`/compras/agrupadores`). La ficha de proveedores añadirá su propia entrada en la misma sección. `puedeVerRuta` cubre por prefijo las subrutas `/compras/agrupadores/viajes/[id]` y `/compras/agrupadores/embarques/[id]`. La barra de **Viaje activo** (`Select` con «Todos», «Sin viaje (locales)» y los viajes abiertos y cerrados, con el texto «Las listas de Compras y de Viajes y embarques muestran solo este viaje») aparece arriba en Compras y en Viajes y embarques.

**Qué ve cada rol en esta entrega**: admin y planner, todo con botones de escritura. El comprador ve todo **sin** botones de escritura, con los chips «Mis embarques» y «Mis viajes» activos si es responsable efectivo de alguno. Los costos se muestran como en Compras (decisión pendiente de Javier en M8 §0.16: si se restringe para el comprador, aplica aquí igual).

### 4.1 `/compras/agrupadores` · pestaña **Embarques** (por defecto)

| Columna | Contenido |
|---|---|
| Código · nombre | `EM-0001 · Contenedor Feria Sur 1` |
| Tipo | Importación / Local |
| Viaje | código, o «—» |
| Responsable | efectivo, con «(del viaje)» si se hereda; ⚠ si es faltante |
| Llega | fecha estimada y mes (`20-nov-2026 · nov-26`); real si existe; badge **Atrasado** |
| Estado | Planificado · En tránsito · Recibido (completo/parcial) · Cancelado |
| Unidades | asignadas · recibidas · pendientes |
| Compras · paquetes · proveedores | conteos |
| Costo | por moneda |
| Avisos | chips |

Filtros: chips Mis embarques / Todos; Estado; Tipo; Atrasados; mes de llegada desde/hasta; texto. Acciones (planner): **Nuevo embarque** (`Modal`), **Abrir** y **Excel** (`EMBARQUES`, `PAQUETES`, `ASIGNACIONES`). En el celular, una tarjeta por embarque.

### 4.2 Detalle del embarque (`/compras/agrupadores/embarques/[id]`)

- **Cabecera** con «Editar» (`Modal`: nombre, tipo, viaje, responsable, referencia logística, salida estimada y nota) y **«Cambiar fecha de llegada»** (`Modal`: fecha nueva y motivo obligatorio). Muestra la vista previa antes de confirmar: «Mueve 12 líneas de 5 compras de nov-26 a dic-26 · 2 lotes cambian de temporada (BETA: verano → invierno) · 1 compra recibida no se mueve».
- **Paquetes**: lista con responsable efectivo y totales; Nuevo, Editar, «Pasar a otro embarque» y Cancelar.
- **Contenido**: `DataTable` agrupada por paquete (y «Sin paquete»). Columnas: compra, proveedor, línea (GML · marca · tallas o «Lote BETA»), unidades asignadas, recibidas, pendientes y estado de la compra; las históricas, atenuadas. Selección múltiple con **Agregar compras** (`Modal` con la lista de entregas candidatas, filtros por viaje, proveedor, mes y «sin embarque», unidades editables por entrega y vista previa de lo que se mueve), **Quitar del embarque**, **Mover a paquete** y **Pasar pendientes a…**
- **«Recibir embarque»**: `Modal` con fecha real, mes de ingreso X (por defecto el de la fecha real) y unidades por paquete y línea (por defecto lo pendiente). Pide un `confirm` con el resumen. Después muestra el banner de pendientes si quedó algo.
- **Historial**: eventos del embarque y de sus paquetes (quién, cuándo, resumen y motivo), con enlace a cada compra.
- **Validaciones visibles**: «Un embarque local no lleva viaje»; «La salida no puede ser posterior a la llegada»; «Este embarque ya tiene ingresos confirmados: lo que falta se pasa a otro embarque»; «Solo hay 120 u sin asignar en esta entrega».

### 4.3 Pestaña **Viajes** y detalle del viaje

Lista: código, nombre, destino, fechas, responsable (⚠ si falta), estado, compras, unidades, costo, embarques y unidades sin embarque. Acciones: Nuevo, Cerrar o Reabrir, Cancelar, Excel (`VIAJES`) y «Usar como viaje activo».

Detalle: **Compras del viaje** (lista con Quitar del viaje y «Agregar compras», que abre el selector de compras sin viaje), **Embarques del viaje** (con llegada y avance de recepción) y **Sin embarque** (entregas pendientes de compras del viaje que no viajan en ningún embarque, por mes, con «Asignar a embarque…»).

### 4.4 Pestaña **Sin agrupador**

Dos bloques con selección múltiple: «Entregas sin embarque» (compras en borrador o confirmadas; por mes) con «Asignar a embarque…», y «Compras sin viaje» con «Asignar a viaje…». Es la pantalla del **backfill manual** de las compras ya cargadas. Respeta el viaje activo cuando no es «Todos».

### 4.5 Cambios en `/compras/registro` (M8)

- **Lista**: columnas Viaje y Embarques (códigos), y filtros Viaje y Embarque.
- **Detalle**: «Viaje: VJ-0001 [Cambiar]» y, en cada entrega, chips `EM-0001 · P1 · 300 u` más «120 u sin embarque».
- **Importador**: columnas opcionales `VIAJE`, `EMBARQUE` y `PAQUETE` en la plantilla y en el reporte (omisiones de §3.9).

## 5. Reglas de negocio (cada una con su prueba en vitest)

| # | Regla | Dónde se prueba |
|---|---|---|
| R1 | Un paquete pertenece a un solo embarque. Una asignación con paquete tiene el embarque de ese paquete (FK compuesta; la API devuelve `no_pertenece` antes) | humo + `agrupadores.movimiento.test.ts` |
| R2 | **Alineación (I2)**: toda asignación activa tiene `entrega.periodo = periodo_llegada` del embarque, después de cualquier operación | `planAsignar`, `planCambiarFecha`, `planPasarPendientes`, `planMoverPaquete`, `planRecibir`; humo con `agrupadores_desalineados() = 0` |
| R3 | `Σ asignaciones ≤ entrega.unidades` (I1) | movimiento |
| R4 | Un movimiento conserva `Σ entregas = unidades` de la línea, deja al menos una entrega y respeta `unique (linea, periodo)` fundiendo y separando entregas sin perder qué unidades son de qué embarque | movimiento (casos 3 y 4) |
| R5 | Cambiar la fecha dentro del mismo mes no toca compras ni su `revision` | movimiento |
| R6 | **Lote al barrer**: la entrega de destino se reparte de nuevo **completa** con la **misma versión** de M12 que ya usa la línea (todas sus entregas comparten `reparto_id`; si no, la más reciente) y el vector de la **temporada del mes de destino** (`temporadaDe(mes, reparto.temporadas_usadas)`); `Σ repartos = entrega.unidades`; aviso `cambia_temporada`. **Nunca cambia de versión** (eso lo hace «aplicar reparto» de `0.13.1`). La mezcla de M9a se reparte con sus mismos porcentajes | movimiento (caso 5) |
| R7 | Un embarque con recepciones vinculadas no cambia de mes, y un paquete con recepciones vinculadas no cambia de embarque | estados |
| R8 | «Recibir embarque» crea recepciones vinculadas a nombre de quien lo pulsa, ≤ lo pendiente de cada asignación y con `X ≥ mes(fecha_compra)` de cada compra. Nunca hay recepción sin una acción explícita (decisión 54) | recibir (caso 6) |
| R9 | `pendientesPorEntrega`: las recepciones vinculadas consumen primero su entrega y las demás siguen FIFO. **Sin recepciones vinculadas da exactamente lo mismo que en M8** (todos los casos de `tests/compras.pendientes.test.ts` y `tests/flujo.*` siguen verdes sin tocarlos) | `compras.pendientes.test.ts` (casos nuevos 7a y 7b) |
| R10 | Una compra `cancelada` o `recibida` deja sus asignaciones como **históricas**: no se mueven, no cuentan como pendientes, no bloquean cancelar el embarque y se informan. Si una compra vuelve a `confirmada` (por quitar una recepción) y quedó desalineada, aparece el aviso `desalineada` con «Realinear» | movimiento + estados (caso 9) |
| R11 | Responsable efectivo = paquete ?? embarque ?? viaje. Solo se asignan compradores activos (`409 responsable_no_comprador`). Desactivado o con otro rol → faltante; asignación conservada | `agrupadores.responsable.test.ts` (caso 10) |
| R12 | Embarque `local` ⇒ sin viaje. Las compras de un viaje en un embarque de otro viaje → aviso `viaje_distinto`, sin bloqueo | esquemas + avisos |
| R13 | **Estados**. Viaje: `abierto ⇄ cerrado`; `abierto|cerrado → cancelado` solo sin compras no canceladas ni embarques no cancelados (`tiene_compras`); un viaje cerrado no recibe compras nuevas (`viaje_no_abierto`); `cancelado` es inmutable. Embarque: `planificado ⇄ en_transito`; `→ recibido` solo por «Recibir»; `recibido → en_transito` solo sin recepciones vinculadas; `→ cancelado` solo sin asignaciones activas ni recepciones vinculadas (`tiene_asignaciones_activas`, `tiene_recepciones`); en `recibido` (salvo «Registrar otra llegada» y «Pasar pendientes») y en `cancelado` no se asigna (`embarque_no_editable`). Paquete: `abierto → cancelado` solo sin asignaciones activas | `agrupadores.estados.test.ts` |
| R14 | Códigos únicos: viaje y embarque en toda la base y paquete dentro de su embarque, sin distinguir mayúsculas. Vacío → autogenerado | humo + esquemas |
| R15 | **Toda escritura va por función.** Ningún handler escribe directo en las tablas nuevas ni en las de compras | `tests/agrupadores.estatico.test.ts` |
| R16 | Cada mutación deja un evento inmutable en `compra_agrupador_eventos` por agrupador tocado y uno en `compra_eventos` por compra tocada, y sube `revision`. Los dos triggers rechazan `UPDATE`, `DELETE` y `TRUNCATE`, también con `service_role`, salvo `perfil_id → NULL` | humo + `agrupadores.eventos.test.ts` |
| R17 | Revisión distinta → `409 agrupador_cambio` o `compra_cambio`. En los movimientos en bloque, la API reintenta una vez | handlers |
| R18 | Importador: las columnas de agrupador no entran en la huella; una línea `igual` sin asignación recibe la del archivo; las omisiones de §3.9 | `compras.importar.test.ts` (casos nuevos) |
| R19 | El viaje activo nunca es permiso: una ruta llamada con otro `viaje_id` responde igual. Huecos y Flujo no lo leen | handlers + estático |
| R20 | El flujo de M8 con agrupadores da las mismas cifras que con las mismas entregas sin agrupadores (los agrupadores solo mueven entregas) | `flujo.agrupadores.test.ts` |
| R21 | Guards: GET `requireUser`; toda escritura `requirePlanner` (el comprador recibe 403) | `tests/api.guards.roles.test.ts` |
| R22 | IDOR: una asignación, paquete o entrega de otro embarque o de otra compra dan `no_pertenece` en todas las rutas de §3.3 | handlers |

### Casos sintéticos (`tests/agrupadores.fixture.ts`; `k' = 2026-09`; temporadas por defecto)

Perfiles C1 y C2 (compradores activos), C3 (comprador inactivo) y P (planner). Proveedores «Feria Sur», «Proveedor Norte» y «Taller Lima Centro». Viaje **VJ-0001** «Feria Sur · oct-2026», de C1, abierto. Embarques **EM-0001** (importación, VJ-0001, ETA 20-nov-2026, sin responsable → C1), con paquetes **P1** (C2) y **P2** (sin responsable → C1); **EM-0002** (importación, VJ-0001, ETA 10-dic-2026); **EM-0003** (importación, sin viaje, ETA 15-mar-2027); **EM-L001** (local, ETA 05-nov-2026, C3), con paquete **PL1**. Compras: **C-000101** (Feria Sur, VJ-0001), con l1 específica HOMBRE·URBANO·DENIM × ALFA de 500 u (nov 300 · dic 200) y l2 lote BETA de 1 000 u (mar-27 600 · abr-27 400; reparto v2 con vector de verano y de invierno distintos); **C-000102** (Proveedor Norte, sin viaje), POLO 400 u en nov; **C-000103** (Taller Lima Centro), CAMISA 120 u en nov.

1. Asignar C-000101 l1 nov 300 → EM-0001/P1 y dic 200 → EM-0002: no se mueve nada; I2 se cumple.
2. Asignar C-000102 nov 400 → EM-0002: su entrega pasa a dic 400; `revision` +1; evento `asignar_agrupador`.
3. Cambiar EM-0001 al 03-dic-2026: l1 queda con una entrega dic de 500 y dos asignaciones (300 EM-0001/P1 y 200 EM-0002); aviso `entregas_fusionadas`.
4. Devolver EM-0001 al 18-nov-2026: l1 vuelve a nov 300 · dic 200.
5. Asignar l2 mar 600 → EM-0003 y cambiar EM-0003 a abr-27: entrega abr de 1 000 repartida con v2 e invierno; `Σ` repartos = 1 000; aviso `cambia_temporada`.
6. Recibir EM-0001 el 22-nov-2026 con P1 = 250 de 300: recepción vinculada de 250 en nov-26; C-000101 sigue `confirmada`; EM-0001 `recibido` parcial con 50 pendientes. Pasar pendientes → EM-0002: l1 queda nov 250 · dic 250, con EM-0001 250 y EM-0002 200 + 50.
7. a) Sin vínculos, `pendientesPorEntrega` da lo mismo que en M8 (regresión). b) Con EM-0002 (dic, 200) recibido antes que EM-0001 (nov, 300) sin mover la fecha: pendiente nov 300 y dic 0 (con FIFO puro saldría nov 100 y dic 200).
8. Cambiar la fecha de EM-0001 después del caso 6 → `409 embarque_con_recepciones`.
9. Cancelar C-000102 (M8): su asignación en EM-0002 pasa a histórica y los totales bajan 400. Cancelar EM-0002 sigue bloqueado por las asignaciones activas de C-000101; quitarlas → se puede cancelar.
10. Responsable efectivo: P1 → C2 (propio), P2 → C1 (del viaje), EM-0003 → nulo (`sin_responsable`), EM-L001 → C3 inactivo (faltante).
11. Crear un embarque `local` con viaje → 400 `local_con_viaje`.
12. Dos pestañas sobre EM-0002 → la segunda recibe `409 agrupador_cambio`. Una compra que cambió entre la vista previa y la escritura → la API reintenta y aplica.
13. Importar con `EMBARQUE = EM-0002` en una línea `igual` → asignada. Con `LLEGADA = 2026-11` → `llegada_distinta_del_embarque`. Con `ENTREGAS` de dos meses → `entregas_con_embarque`. La huella no cambia.
14. Cambiar EM-0002 a 30-ago-2026 (≤ `k'`): aviso `fecha_en_mes_cerrado`; el flujo espera esas unidades en oct-26 como vencidas (regla de M8).
15. Cancelar VJ-0001 con compras → `409 tiene_compras`.
16. Asignar a EM-0002 (dic) 300 u de una entrega nov de 500 de una línea que ya tiene 100 u sin embarque en dic: quedan nov 200 y dic 400 (300 en EM-0002 y 100 sin embarque).
17. Viaje activo: con la cookie en VJ-0001, Compras lista C-000101 y no C-000102; `GET /api/compras` sin `viaje_id` devuelve las tres; Flujo no cambia.

## 6. Criterios de aceptación / hito de prueba (QA en Chromium y después Javier)

- [ ] `0032` aplica dos veces en local y en `vector-two` sin errores; el humo pasa (I1–I3, R14, R16, trigger también con `service_role` y contra `TRUNCATE`, `agrupadores_desalineados() = 0`); tipos regenerados; tiempos de `aplicar_movimiento_agrupador` con 200 líneas ≤ 2 s.
- [ ] lint, `tsc`, vitest (casos 1–17, regresión de M8 sin tocar sus pruebas) y build limpios; `VERSION_METODO_FLUJO = 4`.
- [ ] El menú muestra «Viajes y embarques» dentro de Compras para los tres roles.
- [ ] Como planner: crear el viaje VJ-0001, ponerlo como viaje activo y ver Compras filtrada; Huecos y Flujo no cambian.
- [ ] Crear EM-0001 y EM-0002 con paquetes y un embarque local sin viaje (y comprobar que con viaje lo rechaza).
- [ ] En «Sin agrupador», asignar compras de la carga inicial a viajes y embarques; ver en Compras los chips por entrega.
- [ ] Cambiar la fecha de EM-0001 de nov a dic: la vista previa enumera lo que se mueve; tras confirmar, en **Flujo mensual** las entregas de esas filas aparecen en dic, y el historial de la compra y del embarque lo registra con el motivo.
- [ ] Un lote al barrer que cruza de temporada muestra `cambia_temporada` y su reparto nuevo con la misma versión.
- [ ] «Recibir embarque» parcial: las compras quedan con el ingreso confirmado a nombre del usuario en el mes elegido; el embarque, «Recibido · parcial»; «Pasar pendientes» lleva el resto al siguiente; cambiar la fecha del recibido se rechaza con su mensaje.
- [ ] Cancelar una compra de un embarque (M8): queda como histórica y los totales bajan.
- [ ] Como comprador: ve todo, sin botones de escritura; «Mis embarques» activo si es responsable; la API le devuelve 403 en cada escritura.
- [ ] Un responsable desactivado aparece como faltante; un paquete sin responsable muestra el heredado.
- [ ] Excel de embarques, paquetes, viajes y asignaciones con los filtros vigentes.
- [ ] Importar la plantilla con `VIAJE`, `EMBARQUE` y `PAQUETE`: asigna, reimportar no duplica y las omisiones salen con su motivo.
- [ ] A 390 px, listas y modales sin controles fuera de pantalla.
- [ ] `seguridad` (sonnet): guards, IDOR (R22), funciones solo `service_role`, cookie del viaje activo sin efecto en permisos.

## 7. Fuera de alcance

- **El maestro de proveedores** (puerto de embarque, país, contactos, fotos): ficha `NN-proveedores-y-fotos-de-compras.md`. Aquí solo se usa `compras.proveedor_id`; los proveedores de un embarque se derivan.
- OTB, presupuesto o metas por viaje (decisión 2). El viaje no filtra Huecos ni Flujo.
- Impacto en el IMI y justificación de exceso al mover un embarque: se suman cuando `0.13.1` traiga `impacto` (§0.4 de la ficha 08). Mientras tanto, mover solo pide motivo (pregunta B3).
- Vista del flujo por embarque o viaje («qué llega en EM-0001 por GML») y la columna Embarque en «Entregas que llegan» del Flujo mensual.
- Importador de agrupadores (crear viajes y embarques desde Excel); por ahora, alta en pantalla.
- Acompañantes de un viaje (varios compradores), costos logísticos (flete, aduana, landed cost), documentos y seguimiento naviero.
- Fecha propia del paquete (pregunta B1).
- Escritura del comprador: llega con M9a (pregunta C3).
- Captura manual y edición de cronogramas: `0.13.1`, con el contrato de §3.10.

## 8. Plan de construcción por tandas (dueño único por archivo)

| Tanda | Agente | Depende de | Archivos (dueño exclusivo) | Se da por buena cuando |
|---|---|---|---|---|
| **T0 · Contratos** | `backend` | — | `src/lib/compras/agrupadores/{tipos-api,tipos,esquemas}.ts`, `tests/agrupadores.fixture.ts`, `tests/agrupadores.esquemas.test.ts` | `tsc` limpio; esquemas probados (R12, R14 de forma, códigos); fixtures tipados |
| **T1 · Datos** | `datos` | — | `supabase/migrations/0032_agrupadores_compras.sql`, `scripts/humo-0032.sql`, `src/lib/supabase/database.types.ts` | Corre primero las consultas de §2.9 (solo lectura) y anota el resultado en la ficha; aplica dos veces; humo verde; tiempos medidos |
| **T2 · Lógica pura** | `backend` | T0 | `src/lib/compras/agrupadores/{movimiento,pendientes-asignacion,responsable,estados,avisos,viaje-activo,excel}.ts`, `tests/agrupadores.{movimiento,estados,responsable,eventos}.test.ts`, **cambio en `src/lib/compras/pendientes.ts` y en `src/lib/compras/tipos.ts`** (`entrega_id?` y acciones nuevas), **`src/lib/flujo/tipos.ts`** (`VERSION_METODO_FLUJO = 4`), casos nuevos en `tests/compras.pendientes.test.ts`, `tests/flujo.agrupadores.test.ts` | R2–R13 y R20 verdes; las pruebas de M8 siguen verdes **sin modificarlas** |
| **T3a · Pantallas con fixtures** | `frontend` | T0 | `src/app/(app)/compras/agrupadores/**`, `src/components/compras/agrupadores/**` (incluida la barra de viaje activo), `src/lib/compras/agrupadores/use-agrupadores.ts`, **`src/lib/nav.ts`**, `tests/agrupadores.pantalla.estatico.test.ts` | build y `tsc` limpios; pantallas con los fixtures |
| **T3b · Servicio y API** | `backend` | T1, T2 | `src/lib/compras/agrupadores/{consultas,servicio}.ts`, `src/app/api/compras/{viajes,embarques,paquetes,agrupadores,viaje-activo}/**`, `tests/agrupadores.handlers.test.ts`, `tests/agrupadores.estatico.test.ts`; **aditivos** en `src/lib/compras/{consultas,servicio,tipos-api,importar}.ts`, `src/lib/flujo/consultas.ts` (leer `asignacion_id`), `src/app/api/compras/route.ts`, `src/app/api/compras/importar/route.ts`; altas en `tests/api.guards.roles.test.ts`, casos nuevos en `tests/compras.importar.test.ts` | R15–R19, R21 y R22 verdes |
| **T4 · Integración** | `frontend` | T3a, T3b | Los de T3a más `src/app/(app)/compras/registro/registro-panel.tsx` y `src/components/compras/**` que toque (chips por entrega, filtros, columnas del importador) | Pantallas contra la API real en local; Excel; 390 px |
| **T5 · Cierre** | `qa`, `seguridad` (sonnet), `documentador` | T4 | `qa` y `seguridad` solo leen; `documentador`: `docs/**` (PLAN, DECISIONES 81–86, CHANGELOG, esta ficha, checklist del hito) y `src/lib/version.ts` | Hito de §6 en Chromium; versión subida |

Reglas para no pisarse (las de la ficha 08 §0.8): `nav.ts` solo `frontend`; `database.types.ts` solo `datos`; `tests/api.guards.roles.test.ts` solo `backend`; en `src/lib/flujo/**` solo `backend` y solo los dos cambios listados. `src/lib/compras/agrupadores/**` no importa `src/lib/flujo/**` (prueba estática). **Coordinación con la ficha de proveedores**: ninguna de las dos toca los archivos de la otra; si las dos necesitan `src/lib/compras/tipos-api.ts` o `nav.ts`, se construyen en serie y no en paralelo.

## 9. Decisiones nuevas propuestas (para `docs/DECISIONES.md` cuando Javier apruebe)

- **81 · El viaje de compras es contexto y filtro, nunca presupuesto.** Cumple el papel de `campaigns` de COTV (el viaje activo de cada usuario, en una cookie, sin efecto en permisos) sin adoptar OTB por viaje. Matiza la frase «No se adopta: campañas» de la ficha 08 §4.0.
- **82 · El viaje va en la compra; el embarque y el paquete van en la entrega, por unidades; el paquete vive dentro de un embarque.** Tabla de asignaciones en lugar de columnas en la entrega, para no tocar `unique (linea_id, periodo)` sin `DROP`.
- **83 · La fecha de recepción vive en el embarque**: las entregas asignadas se alinean al mes de llegada y cambiarla las mueve en bloque, con motivo y eventos. Lo recibido no cambia de fecha.
- **84 · «Recibir embarque» es confirmar el ingreso en bloque** por una persona (decisiones 54 y 55). Las recepciones quedan vinculadas a la asignación y `pendientesPorEntrega` honra ese vínculo antes del FIFO (`VERSION_METODO_FLUJO = 4`, mismo resultado sin vínculos).
- **85 · Un responsable por nivel, heredado de paquete a embarque y a viaje; obligatorio solo en el viaje; solo compradores activos; «Mis…» es filtro** (decisión 28).
- **86 · Un lote que cambia de mes por su embarque se reparte de nuevo con la misma versión de M12 y la temporada del mes nuevo**; nunca cambia de versión solo.

## 10. Preguntas abiertas para Javier (cada una con recomendación)

**A · Modelo**
1. **¿Qué es un paquete?** Recomendación: una subdivisión de **un** embarque (por comprador, línea o marca), **opcional** (un embarque chico puede no tener paquetes). La alternativa sería un paquete comercial que cruza embarques (por ejemplo, una campaña): si es así, el modelo cambia antes de construir.
2. **¿El viaje es de la compra (dónde se negoció) y un embarque puede consolidar compras de otro viaje?** Recomendación: sí. El viaje va en la compra; el embarque es opcionalmente de un viaje; la mezcla avisa y no bloquea.
3. **¿Una misma línea puede llegar repartida en dos embarques?** Recomendación: sí, por unidades (son las entregas parciales de la decisión 31).
4. **¿Lukers ya tiene códigos propios de viaje, embarque o paquete?** Recomendación: código libre y único, con autonumeración `VJ-0001`, `EM-0001` y `P1` si se deja vacío, y la referencia de la agencia en `referencia_logistica`.

**B · Fechas**
1. **¿Un paquete puede llegar en otra fecha que su embarque?** Recomendación: no; hereda la de su embarque.
2. **¿La fecha que manda es la llegada al CD?** Recomendación: sí (es lo que usa el flujo); la salida estimada es informativa.
3. **¿Mover la fecha de un embarque pide solo un motivo, sin justificar el exceso de IMI, hasta que `0.13.1` traiga el impacto?** Recomendación: sí.
4. **¿«Recibir embarque» confirma en un clic, a tu nombre, el ingreso de todo lo pendiente (editable por paquete o línea)?** Recomendación: sí; es el atajo de las decisiones 54 y 55, nunca automático.

**C · Responsable, permisos y viaje activo**
1. **¿Responsable en los tres niveles con herencia paquete → embarque → viaje, obligatorio solo en el viaje?** Recomendación: sí.
2. **¿Solo compradores pueden ser responsables, o también planner y admin?** Recomendación: solo compradores activos, como M1b.
3. **¿Quién escribe?** Recomendación: en esta entrega, admin y planner. Con M9a, **cualquier comprador edita cualquier agrupador** (decisión 28) y «Mis…» queda como filtro. Si quieres que el comprador edite **solo** lo suyo, es una decisión nueva que contradice la 28 y se registra como tal.
4. **Viaje activo por defecto**: recomendación, el último viaje abierto del que el usuario es responsable y, si no tiene, «Todos» (COTV tomaba el más reciente para todos). Además, ¿el viaje necesita acompañantes (varios compradores, decisión 12)? Recomendación: por ahora un responsable; los acompañantes quedan para después.

**D · Orden**
1. **¿Construir 08b después de validar `0.13.0` y antes de `0.13.1`?** Recomendación: sí. Es lo que pides ahora, no depende de la captura manual, y la ficha de `0.13.1` se escribe ya sabiendo de los embarques (§3.10). La alternativa (después de `0.13.1`) obliga a reabrir sus funciones con `create or replace`.
2. **¿El importador de compras lleva ya las columnas `VIAJE`, `EMBARQUE` y `PAQUETE`, con los agrupadores creados antes en pantalla?** Recomendación: sí; el importador de agrupadores queda para después.

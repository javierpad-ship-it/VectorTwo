# 08b · Agrupadores de compras: viajes de compras, embarques y paquetes (con el viaje activo, el comprador responsable y las fechas de recepción alineadas)

> **Estado: especificada el 2026-11-02 y ajustada el mismo día con las respuestas de Javier y la revisión independiente del `arquitecto-revisor` (bloqueantes B1–B3, importantes I1–I9 y menores, todos incorporados), y de nuevo con las respuestas de Javier a sus cuatro preguntas (2026-11-02, e–h). **No quedan preguntas abiertas (§10).** Es una mejora de la parte de compras de M8 (ficha [08](08-flujo-y-compras.md)) y se construye en **dos entregas, 08b-1 y 08b-2** (§0.2).
>
> **Pedido de Javier** (2026-11-02, textual): «en el modulo de compras necesito poder generar agrupadores de compras. que son los siguientes: Viaje de compras. Embarque. Paquete. Necesitamos un modulo para gestionar estas agrupaciones. y las fechas de recepción van alineadas a ellos. Tambien tendriamos que incluir un comprador responsable. Tambien hay compras locales que si las clasificamos con embarque y paquete.»
>
> **Contexto que añadió ese mismo día:**
> 1. En COTV, el viaje es `campaigns` (nombre y periodo). Un **viaje activo** por usuario filtra el trabajo, y los proveedores se comparten entre viajes.
> 2. El maestro de proveedores es de la ficha [08c](08c-proveedores-y-fotos-de-compras.md). Aquí solo se usa `compras.proveedor_id`.
> 3. Menú: Inicio, Compras, Planificación, Maestros, Administración. Los agrupadores van **dentro de Compras**.
>
> **Respuestas de Javier (2026-11-02; mandan sobre lo que propuso la ficha):**
> - **a)** El paquete es una subdivisión de **un** embarque y no cruza embarques.
> - **b)** «El comprador añade mercadería a los pedidos; el planner y el comprador pueden modificar la fecha de salida y de recepción de la mercadería»: **los compradores escriben agrupadores desde esta entrega** (§0.3, decisión 92).
> - **c)** Código alfanumérico con formato **`aamm##`** (año de dos dígitos, mes y correlativo de dos dígitos, p. ej. `261101`) más un **nombre libre** (§2.2).
> - **d)** Compras y proyección van por caminos separados. No se fija fecha; se construye por entregas.
> - **e)** Un viaje **cerrado** sigue aceptando que se le añadan o quiten compras, y **lo hace también el comprador** (§0.3, decisión 95).
> - **f)** El **admin** también puede ser responsable: compradores y admin; el planner no (§2.8, decisión 85).
> - **g)** El puerto real se guarda **por embarque** (`compra_embarques.puerto_embarque`), con el puerto habitual del proveedor (08c) como sugerencia (decisión 96).
> - **h)** Habrá **más de 15 viajes y embarques abiertos** al arrancar: el **importador de agrupadores** se adelanta a 08b-1 (§3.11, decisión 97).
>
> **Numeración** (registro único en `docs/PLAN.md` §5, actualizado el 2026-11-04). Aplicadas: `0000`–`0025`, `0027` y `0029`–`0031` (`0031` = 07g). Reservadas: `0026` (`0.13.1 · M8`) y `0028` (M9a).
> - **Migraciones de esta ficha**: se citan con marcador, como hace la 08c: **`00B1_agrupadores_compras.sql`** (08b-1) y **`00B2_recibir_embarque.sql`** (08b-2), con `scripts/humo-00B1.sql` y `scripts/humo-00B2.sql`. `datos` les pone el número libre al construir (decisión 48). **08b-1 tomó la `0032`** (`0032_agrupadores_compras.sql`); `00B2` toma la siguiente libre al construir, por orden de cierre (la 08c usa `00E1` y `00E2`, y 07f `00F1`).
> - **Versión**: la siguiente libre al cerrar cada entrega (hoy `APP_VERSION = "0.15.0 · M7 c"`; reservadas `0.13.1 · M8`, `0.15.0 · M7 b` y `0.15.1 · M7`).
> - Commits `M8:`.
>
> **Base real.** El arquitecto no pudo leer `vector-two`: en su sesión no había MCP ni credenciales. Según el coordinador, hoy hay **0 planners activos, 1 admin (Javier) y 2 compradores activos**. En T1 de 08b-1, `datos` corre en solo lectura las consultas de §2.10 y anota el resultado aquí. **Nunca contra `lukers-compras`.**
>
> Sin datos reales: proveedores «Proveedor Norte», «Feria Sur» y «Taller Lima Centro»; compradores C1, C2 y C3; admin A; cifras inventadas.

## 0. Punto de partida

### 0.1 Lo que se respeta (no se reabre)

| Fuente | Qué se respeta |
|---|---|
| Decisión 2 | **Se compra por oportunidad**: no hay OTB por temporada ni por viaje. El flujo y los huecos son globales. El viaje es contexto y filtro, nunca presupuesto |
| Decisiones 12 y 28 | Todos ven todo. **El responsable y «lo mío» son filtros, no permisos** |
| Decisión 31 y ficha 08 §3 | La fecha de recepción del flujo es el **mes** de cada entrega (`compra_linea_entregas.periodo`), con varias entregas por línea |
| Decisiones 54 y 55 | No hay recepción presunta: una persona confirma el ingreso en un mes X, a su nombre |
| Decisión 56 y ficha 08 §0.11 | Con el saldo cerrado no se toca el cronograma |
| Decisión 60 y ficha 08 §0.12 | Escritura de compras solo por funciones plpgsql, con `revision`, pertenencia y evento inmutable |
| PLAN §4 | Convenciones: RLS sin políticas, `revoke`/`grant` explícitos, migración idempotente sin `DROP`, `DELETE`, `UPDATE` ni `TRUNCATE` a nivel de migración, sin `do $$` ni backfill, catálogos en zod sin `check` |
| `VERSION_METODO` (M7) | No cambia |

### 0.2 Entregas

| Entrega | Qué trae | Migración | Requiere |
|---|---|---|---|
| **08b-1** | Viajes, embarques y paquetes (alta, edición, estados y códigos `aamm##`), **asignación** de compras a viajes y de entregas a embarques y paquetes, **alinear y mover fechas** de salida y de llegada, puerto real del embarque, **comprador responsable**, **viaje activo**, pestaña Sin agrupador, **importador de agrupadores** con su plantilla (§3.11), columnas `VIAJE`, `EMBARQUE` y `PAQUETE` del importador de compras, Excel. **El flujo no cambia de método** (sigue leyendo las mismas entregas) | `00B1` (todas las tablas y columnas, también `compra_linea_recepciones.asignacion_id`, que usará 08b-2; funciones de 08b-1, incluida `importar_agrupadores`) | `0.13.0` validada; **en serie con la E1 de 08c** (comparten `nav.ts`, `src/lib/compras/tipos-api.ts` y `src/components/compras/**`) |
| **08b-2** | **«Recibir embarque»**, «Registrar otra llegada», volver de recibido a en tránsito, **recepciones vinculadas** al embarque, pendiente por asignación, `pendientesPorEntrega` que respeta el vínculo y **`VERSION_METODO_FLUJO` de 3 a 4** | `00B2` (solo funciones: `recibir_embarque` y `revertir_recepcion_embarque`) | 08b-1 |

Javier no fija fecha (respuesta d). Dentro del camino de compras, el orden (fijado el 2026-11-04, con 08b-1 ya en construcción) es 08b-1, E1 (08c), 08b-2, E2 y E3 (08c), `0.13.1` y M9a. Nunca dos de ellas en paralelo. El contrato de §3.10 vale para cualquier orden respecto de `0.13.1`.

### 0.3 Permisos: el comprador escribe agrupadores (decisiones 92 y 95, nuevas)

Javier (b): el comprador añade mercadería a los pedidos, y planner y comprador cambian las fechas de salida y de llegada. Hoy hay 0 planners, así que **sin escritura del comprador nadie salvo el admin podría operar el módulo**.

| Acción | admin | planner | comprador | Por qué |
|---|:-:|:-:|:-:|---|
| Leer todo, Excel, viaje activo | ✓ | ✓ | ✓ | Decisión 28 |
| Crear y editar viaje, embarque y paquete (nombre, tipo, viaje del embarque, responsable, referencia logística, puerto, nota), también los de un viaje cerrado; **importar agrupadores** (§3.11) | ✓ | ✓ | ✓ | Es su trabajo diario; al arrancar hay más de 15 abiertos (Javier, h) |
| Cambiar la **fecha de salida** y la **fecha de llegada estimada** (mueve las entregas) | ✓ | ✓ | ✓ | Respuesta b, textual |
| Asignar o quitar compras de un viaje **abierto o cerrado** (con el aviso `viaje_cerrado`; Javier, e); asignar, quitar o mover entregas entre paquetes y embarques; pasar pendientes; mover un paquete; marcar en tránsito | ✓ | ✓ | ✓ | «Añade mercadería a los pedidos» |
| **Recibir embarque** y Registrar otra llegada (08b-2) | ✓ | ✓ | ✓ | Es confirmar ingreso, que en M9a también tiene el comprador (ficha 08 §0.7); recibe quien llega con la mercadería |
| **Cerrar o reabrir un viaje**; **cancelar** viaje, embarque o paquete | ✓ | ✓ | — | Cancelar es irreversible. Cerrar o reabrir cambia el estado de un viaje compartido y su lugar en los selectores y en el viaje activo de todos; como cerrado ya no bloquea nada (decisión 95), basta con que lo decida admin o planner. Hoy los hace Javier como admin |
| Volver de recibido a en tránsito (08b-2) | ✓ | ✓ | — | Deshace un ingreso confirmado por otros; quien se equivocó puede quitar su recepción en M8 |

**Qué significa «cerrado» (decisión 95).** Un viaje cerrado es **un estado informativo**: el viaje terminó y sale del uso diario. Sus diferencias con uno abierto son tres: no es el viaje activo por defecto (§3.8); en los selectores aparece al final, marcado «(cerrado)»; y toda operación sobre él muestra el aviso `viaje_cerrado` («El viaje 261001 está cerrado: igual se registra»). **No bloquea nada**: los tres roles le añaden o le quitan compras, crean o asignan embarques del viaje y lo editan, también desde los dos importadores. Solo **`cancelado`** bloquea (`viaje_cancelado`).

**Matiz con la decisión 28.** El permiso es **por rol, no por responsable**: cualquier comprador edita cualquier agrupador, sea o no el responsable, y «Mis…» sigue siendo un filtro. **Adelanto a M9a**: el comprador escribe las funciones de agrupadores, que tocan las entregas y las recepciones de compras de otros, antes de tener escritura en el resto de Compras (captura y edición), que sigue en `0.13.1` y M9a. Guards: `requireUser` más la lista blanca de la tabla para lo de los tres roles; `requirePlanner` para lo de admin y planner. La 08c ya da `requireUser` al comprador en proveedores: **las dos fichas quedan alineadas en que los compradores escriben**.

## 1. Objetivo

Hoy las compras de M8 son sueltas: no se sabe en qué viaje se negociaron ni con qué embarque llegan, y la fecha de llegada se escribe a mano en cada entrega. Este módulo crea tres agrupadores, cada uno con su comprador responsable:

- **Viaje de compras**: comercial, dónde y cuándo se compró. También es el **viaje activo** con que cada usuario filtra su trabajo.
- **Embarque**: logístico, qué llega junto, cuándo sale y cuándo llega. Puede ser de importación o local.
- **Paquete**: la subdivisión de un embarque.

**La fecha de recepción vive en el embarque.** Las entregas asignadas se alinean a su mes de llegada, y cambiarla mueve en bloque y con trazabilidad lo que viaja en él. El flujo y el IMI de M8 no cambian su método.

## 2. Modelo de datos

### 2.1 Forma

```
compra_viajes (comercial; viaje activo)
   ▲ 0..1                     ▲ 0..1 (embarque del viaje; los locales no tienen)
compras.viaje_id         compra_embarques (salida, llegada estimada y real, puerto real, tipo importación | local)
   │ 1..n                           ▲ 1                         ▲ 1
compra_lineas ─1..n─► compra_linea_entregas ◄─1── compra_entrega_asignaciones ──0..1─► compra_paquetes (dentro de UN embarque)
                        (mes × unidades; M8)        (entrega × embarque × paquete × unidades)
compra_linea_recepciones.asignacion_id (0..1; 08b-2: «llegó con este embarque»)
compra_agrupador_eventos (inmutable)
```

**Por qué así:**

1. **El viaje va en la compra**: se conoce al negociar, antes de que exista un embarque.
2. **El embarque va en la entrega**: una línea puede llegar en dos embarques (decisión 31), y un embarque consolida a varios proveedores.
3. **El paquete pertenece a un único embarque** (respuesta a): lo garantiza una clave foránea compuesta.
4. **Las compras locales** usan un embarque `local`, sin viaje.
5. **Si el viaje de la compra y el del embarque difieren**, se avisa (`viaje_distinto`) y no se bloquea.

**Por qué una tabla de asignaciones.** M8 tiene `unique (linea_id, periodo)`. Si dos embarques de la misma línea caen en el mismo mes, sus entregas se funden en una fila, y esa fila no podría pertenecer a dos embarques. Cambiar la unicidad exige `DROP CONSTRAINT`, que el proyecto evita. Por eso la tabla reparte **unidades** de una entrega entre embarques y paquetes, y el flujo sigue leyendo `compra_linea_entregas` sin cambios. *Descartadas*: columnas en la entrega, y una FK compuesta con `on update cascade` hacia el mes del embarque, que choca con la misma unicidad y no rehace los repartos por temporada.

### 2.2 Códigos `aamm##` (respuesta c)

- **Formato**: seis dígitos: año de dos dígitos, mes y correlativo `01`–`99` (`261101`). El **nombre** es libre (1–120) y es lo que se lee en pantalla. Viajes, embarques y paquetes tienen **cada uno su propia numeración**: puede existir el viaje `261101` y el embarque `261101`, y la pantalla siempre antepone el tipo («Viaje 261101», «Embarque 261101», «Paquete 261101»).
- **Mes `aamm`**: el de la fecha de referencia **al crear** (viaje: `fecha_inicio`; embarque: `fecha_llegada_estimada`; paquete: el de su embarque). Así los códigos se ordenan por viaje y por llegada, que es como se buscan. **El código no cambia si después cambian las fechas.** Un código no se reutiliza.
- **Autonumeración** (solo si `codigo` llega vacío): dentro de la función, con `pg_advisory_xact_lock(hashtext('agrupador_codigo:<tipo>'))`, el correlativo es el mayor `##` de los códigos de ese tipo que cumplen `^<aamm>[0-9]{2}$` (hayan sido escritos a mano o no) más uno. Un hueco no se rellena. Con `99` ya usado → `409 correlativo_agotado` («Escribe el código a mano»). No usa secuencias.
- **Código escrito a mano**: se pasa a mayúsculas y debe cumplir `^[A-Z0-9-]{1,30}$`; puede tener o no el formato `aamm##`. Si lo cumple, ocupa ese correlativo, y la autonumeración siguiente lo salta porque toma el máximo. Es único por tipo sin distinguir mayúsculas (`409 codigo_duplicado`); el índice único es la red contra carreras. Al escribirlo, la pantalla sugiere el siguiente automático.

### 2.3 `compra_viajes`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `codigo` | `text not null` | §2.2; único `upper(codigo)` |
| `nombre` | `text not null` | 1–120 |
| `destino` | `text null` | ≤ 120 (país, ciudad o feria) |
| `fecha_inicio` | `date not null` | El «periodo» de COTV |
| `fecha_fin` | `date null` | `check (fecha_fin is null or fecha_fin >= fecha_inicio)` |
| `responsable_id` | `uuid null → perfiles on delete set null` | Índice. Obligatorio al crear (§2.8); nulo solo si se borra el perfil |
| `estado` | `text not null default 'abierto'` | zod: `abierto`, `cerrado` (informativo, no bloquea: decisión 95), `cancelado` |
| `nota` | `text null` | ≤ 500 |
| `revision` | `integer not null default 0` | `check (revision >= 0)` |
| `perfil_id`, `usuario_nombre`, `updated_by_id`, `updated_by_nombre` | | Autoría (`perfiles set null`) |
| `activo`, `created_at`, `updated_at` | | Trigger `set_updated_at`. Nunca se borra: se cancela |

Índices: único `upper(codigo)`, `(estado)`, `(fecha_inicio)`, `(responsable_id)` y los de autoría.

### 2.4 `compra_embarques`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `codigo`, `nombre` | | Como en viajes |
| `tipo` | `text not null default 'importacion'` | zod: `importacion`, `local`; `local` ⇒ `viaje_id` nulo (API) |
| `viaje_id` | `uuid null → compra_viajes on delete restrict` | Índice |
| `responsable_id` | `uuid null → perfiles set null` | Nulo = hereda del viaje |
| `referencia_logistica` | `text null` | ≤ 80 (BL, contenedor o guía) |
| **`puerto_embarque`** | `text null` | ≤ 80. **Puerto real de este envío** (revisión I8; lo da por existente la 08c §2.1, cuyo `proveedores.puerto_embarque` es el puerto habitual y se muestra aquí como sugerencia). Javier (g): **se guarda por embarque**. Texto con sugerencias (el habitual de cada proveedor del embarque primero, después los valores ya usados), sin catálogo |
| `fecha_salida_estimada` | `date null` | La editan planner y comprador (respuesta b) |
| `fecha_llegada_estimada` | `date not null` | **Llegada al CD**; alinea las entregas |
| `fecha_llegada_real` | `date null` | Solo la escriben las funciones de 08b-2 |
| `periodo_llegada` | `date generated always as (…) stored` | Primer día del mes de `coalesce(fecha_llegada_real, fecha_llegada_estimada)`. **Expresión inmutable** (`make_date(extract(year from x)::int, extract(month from x)::int, 1)`): `date_trunc` sobre un `date` sin `::timestamp` resuelve a la versión `stable` y la columna falla. **La lógica TS usa exactamente la misma regla** (`periodoLlegada(fechaReal, fechaEstimada)`, revisión B2). Índice |
| `estado` | `text not null default 'planificado'` | zod: `planificado`, `en_transito`, `recibido` (08b-2), `cancelado` |
| `nota`, `revision`, autoría, `activo`, timestamps | | `revision` cubre también a sus paquetes |

`check (fecha_salida_estimada is null or fecha_salida_estimada <= fecha_llegada_estimada)` queda como red de seguridad: la función lo valida antes y devuelve `salida_despues_de_llegada` (`409`). Los proveedores del embarque se derivan de sus compras.

### 2.5 `compra_paquetes`

`id`; `embarque_id uuid not null → compra_embarques on delete restrict` (índice); `codigo` (§2.2, único `upper(codigo)` entre paquetes); `nombre` 1–120; `responsable_id → perfiles set null` (nulo = hereda del embarque); `estado` (zod: `abierto`, `cancelado`); `nota` ≤ 300; autoría, `activo` y timestamps; **`constraint compra_paquetes_id_embarque_key unique (id, embarque_id)`** dentro del `create table if not exists`. Sin fecha propia: llega con su embarque.

### 2.6 `compra_entrega_asignaciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `entrega_id` | `uuid not null → compra_linea_entregas on delete restrict` | Índice. Nadie borra una entrega con asignaciones sin ocuparse de ellas |
| `embarque_id` | `uuid not null → compra_embarques on delete restrict` | Índice |
| `paquete_id` | `uuid null` | FK compuesta `(paquete_id, embarque_id) → compra_paquetes (id, embarque_id) on update cascade on delete restrict` |
| `unidades` | `integer not null` | `check (unidades > 0)` |
| autoría, `activo` (convención, sin uso), timestamps | | |

Único: `(entrega_id, embarque_id, coalesce(paquete_id, uuid cero))`. Si un movimiento lleva unidades a una entrega que ya tiene una asignación con el mismo embarque y paquete, **las suma a esa fila** en vez de crear otra (fusión por el índice único). Índice `(paquete_id)`.

**Asignación histórica** (revisión, menor): la de una compra `recibida` o `cancelada`, o la de una línea inactiva o con `recibidas + canceladas = unidades` (aviso `linea_recibida` en una compra todavía `confirmada`). No se mueve, no cuenta como pendiente y no bloquea cancelar el embarque. **Activa**: todas las demás.

### 2.7 Columnas nuevas en tablas de M8 (aditivas, en `00B1`)

- `compras.viaje_id uuid null references compra_viajes(id) on delete restrict`, con índice. Sin backfill.
- `compra_linea_recepciones.asignacion_id uuid null references compra_entrega_asignaciones(id) on delete restrict`, con índice. Nula en todo lo que registra M8. **La llenan solo las funciones de 08b-2.**
- `ORIGENES_ENTREGA` (zod de M8) suma `embarque`: el origen de las entregas que crea un movimiento.
- `ACCIONES_EVENTO` suma `asignar_viaje`, `asignar_agrupador`, `mover_entregas` y (08b-2) `recibir_embarque`.

### 2.8 Comprador responsable

- **Asignables** (Javier, f): perfiles activos con rol **`comprador` o `admin`**; el **planner, no**. Se reutiliza la consulta de asignables de M1b con un parámetro nuevo, `incluirAdmin` (por defecto `false`, así M1b no cambia). Un admin desactivado o que pasa a planner cuenta como faltante, igual que un comprador.
- **Uno por nivel**, obligatorio solo en el viaje. **Efectivo**: `paquete ?? embarque ?? viaje`; se calcula al leer (`{ perfil_id, nombre, origen: 'propio' | 'embarque' | 'viaje' } | null`).
- **Faltante** (`sin_responsable`): sin efectivo, o con un efectivo que ya no es asignable. Desactivarlo o cambiarle el rol conserva la asignación; borrar el perfil la deja en nulo.
- «Mis viajes», «Mis embarques» y «Mis paquetes» filtran por el responsable efectivo; nunca son permiso.

### 2.9 Funciones, candados e invariantes

**Orden global de candados** (revisión I4; lo siguen todas las funciones de esta ficha y las de `0.13.1`): **viajes (por `id`) → embarques (por `id`) → compras (por `id`)**, siempre `for update` y siempre en ese orden. **La función deriva ella misma** las compras afectadas, después de bloquear los embarques: una compra afectada es la dueña de una entrega o asignación del plan, o de cualquier asignación activa del embarque. Las bloquea y compara su `revision` con la del plan; si difiere, devuelve `compra_cambio` (I3). Nunca confía en una lista de compras que mande la API.

**Invariantes** (las verifica la función al final, antes de confirmar; si una falla, lanza una excepción y se deshace todo):

| | Invariante | Alcance |
|---|---|---|
| **I1** | `Σ asignaciones.unidades` de una entrega `≤ entrega.unidades` | Entregas tocadas |
| **I2** | Alineación: `entrega.periodo = embarque.periodo_llegada` | **Solo las asignaciones activas que toca el plan** (revisión B1). Una asignación que vuelve a ser activa por fuera (p. ej. quitar una recepción en M8) puede quedar desalineada: se avisa `desalineada` con «Realinear». `agrupadores_desalineados() = 0` se exige **solo en el humo** |
| **I3** | `Σ entregas = compra_lineas.unidades`; ≥ 1 entrega por línea; ≤ `MAX_ENTREGAS = 24` entregas por línea (`max_entregas`); en un lote, `Σ repartos` por entrega `= entrega.unidades` | Líneas tocadas |
| **I4** | (08b-2) La recepción vinculada es de la línea de la entrega de su asignación, y `Σ recepciones vinculadas ≤ asignación.unidades` (revisión I5) | Recepciones y asignaciones tocadas; también en el humo |
| **I5** | **Todo cambio de `asignacion.entrega_id`, `asignacion.unidades` o `recepciones.asignacion_id` sube `compras.revision`** de la compra dueña y deja un evento en `compra_eventos` | Prueba del humo: revisión antes y después |

**Funciones** (todas `plpgsql`, `security invoker`, `set search_path = ''`, solo `service_role`, `returns jsonb` con `{ ok, … }` o `{ ok: false, motivo }`):

| Función | Entrega | Qué hace | Motivos |
|---|---|---|---|
| `guardar_viaje(p_viaje, p_revision, p_actor)` | 1 | Crea (revisión nula) o edita; código §2.2 | `agrupador_cambio`, `codigo_duplicado`, `codigo_invalido`, `correlativo_agotado`, `no_encontrado`, `no_editable`, `responsable_no_asignable` |
| `guardar_embarque(p_embarque, p_revision, p_actor)` | 1 | Crea o edita **todo menos `fecha_llegada_estimada`** después de creado (esa va por movimiento). `fecha_salida_estimada` sí se edita aquí, porque no mueve entregas | Los anteriores y `fecha_por_movimiento`, `salida_despues_de_llegada`, `local_con_viaje`, `viaje_cancelado`; aviso `viaje_cerrado` |
| `guardar_paquete(p_paquete, p_revision_embarque, p_actor)` | 1 | Crea o edita un paquete | `agrupador_cambio`, `codigo_duplicado`, `embarque_no_editable` |
| `cambiar_estado_agrupador(p_tipo, p_id, p_accion, p_revision, p_motivo, p_actor)` | 1 | Transiciones de R13 (las de 08b-2, por su función) | `transicion_invalida`, `tiene_asignaciones_activas`, `tiene_compras`, `tiene_recepciones`, `motivo_requerido` |
| `asignar_viaje_compras(p_viaje, p_compras, p_actor)` | 1 | Pone o quita el viaje de compras `[{ id, revision }]`. Bloquea primero el viaje y después las compras; revisión +1 y evento `asignar_viaje` por compra | `compra_cambio`, `no_editable`, `viaje_cancelado`; aviso `viaje_cerrado` |
| **`aplicar_movimiento_agrupador(p_plan, p_actor)`** | 1 | Función central de 08b-1: aplica asignar, quitar, mover a paquete, cambiar la fecha de llegada, pasar pendientes y mover un paquete. Bloquea en el orden global; comprueba pertenencia; escribe entregas (upsert por `(linea_id, periodo)` **conservando el `id`** de las que sobreviven; borra una entrega solo si queda en 0 y sin asignaciones; las nuevas con `origen = 'embarque'`), repartos de las entregas tocadas **de origen y de destino**, asignaciones (con fusión) y la fecha del embarque; verifica I1 a I3 e I5; llama a `compra_recalcular_estado` de M8; sube las revisiones; registra los eventos | `agrupador_cambio`, `compra_cambio`, `no_pertenece`, `embarque_no_editable`, `embarque_con_recepciones`, `asignacion_con_recepciones`, `excede_entrega`, `compra_no_asignable`, `saldo_cerrado`, `max_entregas`, `sin_pendientes`, `paquete_de_otro_embarque`, `reparto_sin_vector` |
| `agrupador_mover_entregas(p_movimientos jsonb)` | 1 | **Ayudante interno**, sin candados ni eventos: el paso de escritura de entregas, repartos y asignaciones que comparten `aplicar_movimiento_agrupador` y `recibir_embarque`. Solo lo llaman ellas | — |
| `importar_agrupadores(p_lote jsonb, p_actor jsonb)` | 1 | Aplica el importador de §3.11 en **una** transacción. Toma el candado consultivo `agrupador_importar` y los de los códigos (§2.2); vuelve a comprobar cada clave y cada referencia; crea viajes, después embarques y después paquetes (autonumerando los que vengan sin código); deja un evento `crear` por agrupador, con motivo «Importado de <archivo>». **Solo crea**: nunca edita, mueve ni asigna compras | `clave_existente` (alguien creó la misma clave entre previsualizar y aplicar: la API responde `409 vuelve_a_previsualizar`), `viaje_cancelado`, `embarque_no_editable`, `responsable_no_asignable`, `correlativo_agotado`, `codigo_duplicado` |
| `compra_foto_entregas(p_compra)` | 1 | Ayudante de solo lectura (revisión I9): entregas, repartos y asignaciones de la compra. El evento guarda `antes` y `despues` como `compra_foto(c) \|\| compra_foto_entregas(c)`. **No se reemplaza `compra_foto` de M8** | — |
| `agrupadores_desalineados()` | 1 | Solo lectura: asignaciones activas con `entrega.periodo ≠ periodo_llegada`. Para el humo y el aviso `desalineada` | — |
| `recibir_embarque(p_plan, p_actor)` | 2 | Recibir y Registrar otra llegada (§3.6). Bloquea en el orden global y verifica I1 a I5 | `agrupador_cambio`, `compra_cambio`, `no_pertenece`, `no_confirmada`, `excede_pendiente`, `recepcion_antes_de_compra`, `sin_unidades`, `llegada_futura`, `embarque_no_editable`, `recepcion_cambio`, `reparto_sin_vector` |
| `revertir_recepcion_embarque(p_embarque, p_revision, p_plan, p_actor)` | 2 | `recibido → en_transito` solo si no quedan recepciones vinculadas; pone `fecha_llegada_real = null` y **realinea** al mes estimado con el plan (revisión B2) | `tiene_recepciones`, `agrupador_cambio`, `compra_cambio` |
| Triggers de inmutabilidad | 1 | En `compra_agrupador_eventos`: `before update or delete` por fila (con la excepción `perfil_id → NULL` de la decisión 60) y **`before truncate` por sentencia**. **Se añade también `before truncate` a `compra_eventos`**, con `create or replace trigger` (cierra el pendiente M-3 de M8; revisión, menor). No toca su trigger de fila | — |

**No se reemplaza ninguna función de M8.** Las tres validaciones de recepción de `registrar_recepciones` (`no_editable`, `excede_pendiente`, `recepcion_antes_de_compra`) se repiten en `recibir_embarque`; `compra_recalcular_estado` se reutiliza tal cual.

**`compra_agrupador_eventos`**: `viaje_id`, `embarque_id` y `paquete_id` (nulos, `restrict`; `check (num_nonnulls(…) >= 1)`); `accion` (zod: `crear`, `editar`, `cambiar_estado`, `asignar_viaje`, `asignar`, `quitar`, `mover_a_paquete`, `cambiar_fecha`, `pasar_pendientes`, `mover_paquete`, `recibir`, `otra_llegada`, `revertir_recepcion`); `antes` y `despues` en `jsonb`; `motivo` ≤ 300; `resumen` ≤ 300; `compras jsonb default '[]'` (`[{ compra_id, revision_nueva }]`); `perfil_id → perfiles set null`; `usuario_nombre`; `created_at`. Índices `(embarque_id, created_at)`, `(viaje_id, created_at)`, `(paquete_id)` y `(perfil_id)`.

**Seguridad**: RLS activo y sin políticas en las cinco tablas nuevas; `revoke all … from public, anon, authenticated` y `grant` a `service_role` por objeto (no hay secuencias); `comment on` en cada uno.

**Huella del flujo**: no cambia. Todo lo que mueve entregas sube `compras.revision` e inserta en `compra_eventos` (I5), que ya están en `flujo_huella_base()`.

### 2.10 Consultas de verificación (solo lectura, `vector-two`; T1 de 08b-1)

```sql
select estado, origen, count(*) from public.compras group by 1, 2;
select count(*) lineas, count(*) filter (where tipo = 'barrer_marca') lotes from public.compra_lineas;
select to_char(periodo, 'YYYY-MM') mes, count(*), sum(unidades) from public.compra_linea_entregas group by 1 order by 1;
select count(*) from (select linea_id from public.compra_linea_entregas group by 1 having count(*) > 1) x;
select max(n) from (select linea_id, count(*) n from public.compra_linea_entregas group by 1) x;      -- frente a MAX_ENTREGAS
select count(*), sum(unidades) from public.compra_linea_recepciones;
select rol, activo, count(*) from public.perfiles group by 1, 2;
select to_regclass('public.compra_viajes'), to_regclass('public.compra_embarques'), to_regclass('public.compra_paquetes');
```

## 3. Contratos de API

Handlers en `src/app/api/compras/{viajes,embarques,paquetes,agrupadores,viaje-activo}/**`. **La primera sentencia es el guard.** Solo `supabaseAdmin()`. `leerCuerpo` y respuestas `ok({ … })` o `errorConCodigo` de `src/lib/api/respuestas.ts`. Lectura con `leerTodo`. **Ninguna escritura directa** sobre las tablas nuevas ni sobre las de compras: solo `.rpc(` (prueba estática). Lógica pura en `src/lib/compras/agrupadores/`.

**Guards**: lecturas, `requireUser`. Escrituras: `requireUser` para lo que permite a los tres roles la tabla de §0.3, y **`requirePlanner`** solo para cerrar, reabrir y cancelar, y para revertir una recepción. Asignar a un viaje cerrado y los dos importadores son de los tres roles (`requireUser`).

**Concurrencia y reintentos** (revisión I2):
- Viajes y embarques llevan `revision`; asignar y quitar llevan además la `revision` de cada compra vista.
- Todo movimiento admite `?previsualizar=1`, que devuelve un `PlanMovimientoApi` con su `huella_plan` (hash del resumen: compras, líneas, de → a y unidades).
- Al escribir, el cliente manda `huella_plan` si vio la vista previa. Si la función devuelve `compra_cambio`, la API recalcula el plan **y solo reintenta una vez si la huella nueva es idéntica** a la enviada; si no, `409 plan_cambio` («Cambió lo que ibas a mover: revisa la vista previa»). Sin `huella_plan` no hay reintento.
- **«Recibir embarque» nunca reintenta**: el cliente manda `items` explícitos o `total_confirmado` (el total que vio en el `confirm`). Si lo pendiente ya no suma eso, `409 recepcion_cambio`.

### 3.1 Esquemas zod (`src/lib/compras/agrupadores/esquemas.ts`)

```ts
const codigo = z.string().trim().transform(s => s.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9-]{1,30}$/));
const nombre = z.string().trim().min(1).max(120);
guardarViajeSchema = z.object({ revision: z.number().int().min(0).optional(), codigo: codigo.optional(), nombre,
  destino: z.string().trim().max(120).nullable().optional(), fecha_inicio: fechaIso, fecha_fin: fechaIso.nullable().optional(),
  responsable_id: z.uuid(), nota: z.string().trim().max(500).nullable().optional() });
guardarEmbarqueSchema = z.object({ revision: z.number().int().min(0).optional(), codigo: codigo.optional(), nombre,
  tipo: z.enum(["importacion", "local"]), viaje_id: z.uuid().nullable(), responsable_id: z.uuid().nullable(),
  referencia_logistica: z.string().trim().max(80).nullable().optional(), puerto_embarque: z.string().trim().max(80).nullable().optional(),
  fecha_salida_estimada: fechaIso.nullable().optional(),
  fecha_llegada_estimada: fechaIso.optional(),                       // obligatoria al crear; prohibida al editar (va por /fecha)
  nota: z.string().trim().max(500).nullable().optional() });
// local ⇒ sin viaje y salida ≤ llegada: las comprueba la función y responde 409 (no 400), porque la llegada vigente vive en la base.
guardarPaqueteSchema = z.object({ revision_embarque: z.number().int().min(0), codigo: codigo.optional(), nombre,
  responsable_id: z.uuid().nullable(), nota: z.string().trim().max(300).nullable().optional() });
cambiarEstadoSchema = z.object({ revision: z.number().int().min(0),
  accion: z.enum(["cerrar", "reabrir", "cancelar", "en_transito", "volver_a_planificado"]), motivo: z.string().trim().max(200).optional() });
asignarViajeSchema = z.object({ viaje_id: z.uuid().nullable(),
  compras: z.array(z.object({ id: z.uuid(), revision: z.number().int().min(0) })).min(1).max(500) });
const huella_plan = z.string().length(64).optional();
asignarEntregasSchema = z.object({ revision: z.number().int().min(0), paquete_id: z.uuid().nullable(), huella_plan,
  items: z.array(z.object({ entrega_id: z.uuid(), unidades: z.number().int().positive(), compra_revision: z.number().int().min(0) })).min(1).max(2000) });
quitarAsignacionesSchema = z.object({ revision: z.number().int().min(0), huella_plan,
  asignaciones: z.array(z.object({ id: z.uuid(), compra_revision: z.number().int().min(0) })).min(1).max(2000) });
moverAPaqueteSchema = z.object({ revision: z.number().int().min(0), paquete_id: z.uuid().nullable(), asignaciones: z.array(z.uuid()).min(1).max(2000) });
cambiarFechaSchema = z.object({ revision: z.number().int().min(0), fecha_llegada_estimada: fechaIso, motivo: z.string().trim().min(1).max(300), huella_plan });
moverPaqueteSchema = z.object({ revision: z.number().int().min(0), embarque_destino_id: z.uuid(), revision_destino: z.number().int().min(0),
  motivo: z.string().trim().min(1).max(300), huella_plan });
pasarPendientesSchema = z.object({ revision: z.number().int().min(0), embarque_destino_id: z.uuid(), revision_destino: z.number().int().min(0),
  paquete_destino_id: z.uuid().nullable(), asignaciones: z.array(z.uuid()).max(2000).optional(), motivo: z.string().trim().min(1).max(300), huella_plan });
// 08b-2
recibirEmbarqueSchema = z.object({ revision: z.number().int().min(0),
  modo: z.enum(["llegada", "otra_llegada"]),                         // otra_llegada: no toca fecha_llegada_real ni mueve entregas (B3)
  fecha_llegada_real: fechaIso,                                        // ≤ hoy en Lima (409 llegada_futura)
  periodo: mesIso.optional(),                                          // mes X; por defecto, el de la fecha
  items: z.array(z.object({ asignacion_id: z.uuid(), unidades: z.number().int().min(0) })).max(MAX_ASIGNACIONES_RECIBIR).optional(),
  total_confirmado: z.number().int().positive().optional(),            // obligatorio si no hay items
  nota: z.string().trim().max(200).nullable().optional() })
  .refine(v => v.items ? v.items.some(i => i.unidades > 0) : v.total_confirmado !== undefined, "sin_unidades");
viajeActivoSchema = z.object({ viaje_id: z.union([z.uuid(), z.literal("todos"), z.literal("sin_viaje")]) });
// Importador de agrupadores (§3.11): las filas llegan ya leídas por el navegador (`src/components/importador`), como texto.
filaAgrupadorSchema = z.object({ fila: z.number().int().min(1), tipo: z.string(), codigo: z.string().optional(), nombre: z.string().optional(),
  viaje: z.string().optional(), embarque: z.string().optional(), tipo_embarque: z.string().optional(), destino: z.string().optional(),
  fecha_inicio: z.string().optional(), fecha_fin: z.string().optional(), fecha_salida: z.string().optional(), fecha_llegada: z.string().optional(),
  puerto: z.string().optional(), referencia_logistica: z.string().optional(), responsable: z.string().optional(), nota: z.string().optional() });
importarAgrupadoresSchema = z.object({ modo: z.enum(["previsualizar", "aplicar"]), archivo_nombre: z.string().trim().max(200),
  filas: z.array(filaAgrupadorSchema).min(1).max(MAX_FILAS_IMPORTAR_AGRUPADORES) });   // 1 000
```

`MAX_ASIGNACIONES_RECIBIR = 2000` es el tope propio de una llegada. **No es** `MAX_RECEPCIONES_POR_LLAMADA = 50` de M8, que limita el «Confirmar ingreso» a mano de una sola compra; una llegada consolida decenas de compras en una transacción, y lo mide `datos` (≤ 2 s con 500 asignaciones).

### 3.2 Tipos (`src/lib/compras/agrupadores/tipos-api.ts`)

`ViajeApi { id, codigo, nombre, destino, fecha_inicio, fecha_fin, estado, revision, responsable, responsable_valido, totales { compras, unidades, costo { PEN, USD }, embarques, unidades_sin_embarque }, avisos, creado_por, modificado_por }`.
`EmbarqueApi { id, codigo, nombre, tipo, viaje, referencia_logistica, puerto_embarque, puertos_habituales: string[] (de los proveedores, si existe la 08c), fecha_salida_estimada, fecha_llegada_estimada, fecha_llegada_real, periodo_llegada, estado, recepcion: 'sin_recibir' | 'parcial' | 'completa' | 'vacio', revision, responsable_efectivo, totales { paquetes, compras, lineas, unidades, recibidas, pendientes, historicas, costo { PEN, USD } }, proveedores, avisos }`.
`EmbarqueDetalleApi = EmbarqueApi & { paquetes: PaqueteApi[], asignaciones: AsignacionApi[] }`.
`AsignacionApi { id, entrega_id, periodo, paquete_id, unidades, recibidas, recibidas_estimadas: boolean, pendiente, historica, compra { id, numero, revision, estado, proveedor, viaje_id, fecha_compra }, linea { id, tipo, gml, marca, agrupacion_marca, tallas, costo_unitario, moneda } }`. En 08b-1 `recibidas` sale del FIFO de M8 y siempre lleva `recibidas_estimadas = true` (se rotula «estimado»); en 08b-2 lo vinculado es exacto.
`PlanMovimientoApi { operacion, huella_plan, compras_afectadas, lineas, unidades_movidas, movimientos: { compra_numero, linea, de, a, unidades }[], avisos }`. `RespuestaMovimientoApi { embarque, embarques_tocados, compras: { id, revision }[], avisos }`. `SinAgrupadorApi { entregas[], compras_sin_viaje[] }`. `ReporteImportacionAgrupadoresApi { modo, resumen { nuevas, iguales, cambiadas, omitidas, por_tipo }, filas: { fila, tipo, clave, clasificacion: 'nueva' | 'igual' | 'cambiada' | 'omitida', codigo_final: string | null, motivo?, detalle?, avisos[] }[], creados?: { tipo, id, codigo }[] }` (`codigo_final` es nulo en `previsualizar` para las nuevas sin código: «se numera al aplicar»).

**Avisos**: `viaje_cerrado` (decisión 95), `atrasado`, `sin_responsable`, `viaje_distinto`, `cambia_temporada`, `fecha_en_mes_cerrado`, `llegada_antes_de_compra` (el mes de llegada es anterior al de alguna compra asignada; la recepción se rechazará), `entregas_fusionadas`, `desalineada`, `asignaciones_historicas`, `linea_recibida`, `en_embarque_cancelado` (asignación activa en un embarque cancelado; se ofrece «Quitar del embarque», B1), `pendientes_tras_recibir` (08b-2), `borradores_excluidos` (08b-2).

### 3.3 Rutas

| Ruta | Método | Guard | Cuerpo | Respuesta `{ data }` | Errores |
|---|---|---|---|---|---|
| `/api/compras/viajes` | GET | `requireUser` | `?estado&responsable_id&mio=1&q` | `{ viajes, asignables }` | — |
| `/api/compras/viajes` | POST | `requireUser` | `guardarViajeSchema` | `{ viaje }` | 400; 409 `codigo_duplicado`, `codigo_invalido`, `correlativo_agotado`, `responsable_no_asignable` |
| `/api/compras/viajes/[id]` | GET · PATCH | `requireUser` | — · con `revision` | `{ viaje, compras, embarques }` · `{ viaje }` | 404; 409 `agrupador_cambio`, `no_editable` |
| `/api/compras/viajes/[id]/estado` | POST | `requirePlanner` | `cambiarEstadoSchema` | `{ viaje }` | 409 `transicion_invalida`, `tiene_compras`, `motivo_requerido` |
| `/api/compras/viajes/[id]/compras` | POST | `requireUser` (abierto o cerrado; aviso `viaje_cerrado`) | `asignarViajeSchema` | `{ viaje, compras, avisos }` | 409 `compra_cambio`, `viaje_cancelado`, `no_editable` |
| `/api/compras/embarques` | GET · POST | `requireUser` | filtros (`?estado&tipo&viaje_id\|sin_viaje&desde&hasta&responsable_id&mio=1&atrasados=1&q`) · `guardarEmbarqueSchema` | `{ embarques }` · `{ embarque }` | 409 `local_con_viaje`, `salida_despues_de_llegada`, `viaje_cancelado`, `codigo_duplicado` |
| `/api/compras/embarques/[id]` | GET · PATCH | `requireUser` | — · sin fecha de llegada | `{ embarque: EmbarqueDetalleApi }` | 404; 409 `fecha_por_movimiento`, `salida_despues_de_llegada`, `embarque_no_editable` |
| `/api/compras/embarques/[id]/estado` | POST | `requireUser` para `en_transito` y `volver_a_planificado`; `requirePlanner` para `cancelar` | `cambiarEstadoSchema` | `{ embarque }` | 403; 409 `transicion_invalida`, `tiene_asignaciones_activas`, `tiene_recepciones` |
| `/api/compras/embarques/[id]/paquetes` · `/api/compras/paquetes/[id]` | POST · PATCH | `requireUser` | `guardarPaqueteSchema` | `{ embarque }` | 409 `agrupador_cambio`, `codigo_duplicado`, `embarque_no_editable` |
| `/api/compras/paquetes/[id]/estado` | POST | `requirePlanner` | `cancelar` | `{ embarque }` | 409 `tiene_asignaciones_activas` |
| `/api/compras/paquetes/[id]/mover` | POST | `requireUser` | `moverPaqueteSchema` | `RespuestaMovimientoApi` / `PlanMovimientoApi` | 409 `asignacion_con_recepciones`, `embarque_no_editable`, `plan_cambio` |
| `/api/compras/embarques/[id]/asignar` | POST | `requireUser` | `asignarEntregasSchema` | ídem | 404 `no_pertenece`; 409 `excede_entrega`, `compra_no_asignable`, `saldo_cerrado`, `max_entregas`, `reparto_sin_vector`, `embarque_no_editable`, `plan_cambio` |
| `/api/compras/embarques/[id]/quitar` | POST | `requireUser` | `quitarAsignacionesSchema`; las unidades quedan **sin embarque en el mismo mes**. **Se permite en cualquier estado del embarque, también `cancelado` y `recibido`** (B1) | ídem | 409 `asignacion_con_recepciones` |
| `/api/compras/embarques/[id]/paquete` | POST | `requireUser` | `moverAPaqueteSchema` (mismo embarque: no mueve meses; se permite con recepciones) | ídem | 404 `no_pertenece`, 409 `paquete_de_otro_embarque` |
| `/api/compras/embarques/[id]/fecha` | POST | `requireUser` | `cambiarFechaSchema` | ídem | 409 `embarque_con_recepciones`, `embarque_no_editable`, `salida_despues_de_llegada`, `max_entregas`, `reparto_sin_vector`, `plan_cambio` |
| `/api/compras/embarques/[id]/pasar-pendientes` | POST | `requireUser` | `pasarPendientesSchema` | ídem | 409 `sin_pendientes`, `embarque_no_editable`, `paquete_de_otro_embarque`, `max_entregas` |
| `/api/compras/embarques/[id]/recibir` (08b-2) | POST | `requireUser` | `recibirEmbarqueSchema` | ídem | 409 `no_confirmada`, `excede_pendiente`, `recepcion_antes_de_compra`, `sin_unidades`, `llegada_futura`, `recepcion_cambio`, `embarque_no_editable` |
| `/api/compras/embarques/[id]/revertir-recepcion` (08b-2) | POST | `requirePlanner` | `{ revision, huella_plan }` | ídem | 409 `tiene_recepciones` |
| `/api/compras/agrupadores/sin-asignar` · `/opciones` · `/historial` | GET | `requireUser` | filtros · — · `?viaje_id\|embarque_id\|paquete_id` | `SinAgrupadorApi` · selectores · `{ eventos }` | 404 |
| `/api/compras/agrupadores/importar` | POST | `requireUser` | `importarAgrupadoresSchema` | `ReporteImportacionAgrupadoresApi` | 400 validación (más de 1 000 filas); 413 cuerpo > 6 MB (`leerCuerpo`); 409 `vuelve_a_previsualizar` |
| `/api/compras/viaje-activo` | PUT | `requireUser` | `viajeActivoSchema` | `{ viaje_activo }` (cookie) | 404 `no_encontrado` |

**Cambios aditivos en M8** (dueño `backend`): `GET /api/compras` acepta `?viaje_id=…|sin_viaje&embarque_id=…`. `CompraApi` suma `viaje` y, en cada entrega, `asignaciones[]` y `sin_embarque`. El importador suma las columnas de §3.9.

### 3.4 Asignar (`planAsignar`, puro)

Por cada ítem:
- La compra está en `borrador` o `confirmada` (si no, `compra_no_asignable`), sin el saldo cerrado (`saldo_cerrado`) y con la línea activa.
- `unidades ≤` lo no asignado de la entrega (`excede_entrega`).
- Si `entrega.periodo ≠ periodo_llegada`, esas unidades **pasan** a la entrega del mes del embarque en la misma línea. Esa entrega se crea con `origen = 'embarque'` o se funde con la existente (`entregas_fusionadas`). La de origen baja, y si queda en 0 sin asignaciones se borra. Una línea que pasaría de 24 entregas da `max_entregas`.
- Los lotes se reparten de nuevo en **origen y destino** (R6).
- Avisos: `viaje_distinto`, `llegada_antes_de_compra` y `fecha_en_mes_cerrado`.

### 3.5 Cambiar la fecha de llegada, mover un paquete, pasar pendientes

- **El mes nuevo se calcula como la columna**: `periodoLlegada(fecha_llegada_real, fecha_llegada_nueva)` (B2). En 08b-1 no hay fecha real, así que es el de la estimada. Si el mes no cambia, solo cambia el embarque (evento `cambiar_fecha`) y no se toca ninguna compra.
- **Si el mes cambia**, se mueven todas las asignaciones **activas**; las históricas no se mueven (`asignaciones_historicas`). Con recepciones vinculadas (08b-2), `409 embarque_con_recepciones`: lo que falta se pasa a otro embarque. El motivo es obligatorio.
- **Mover un paquete** a otro embarque: solo sin recepciones vinculadas. La FK compuesta arrastra las asignaciones y la función mueve sus entregas.
- **Pasar pendientes**: lo pendiente de cada asignación sale a una asignación del destino (con fusión), y su entrega se mueve al mes del destino. El origen conserva lo recibido o se borra si no tiene recepciones. En 08b-1, «pendiente» es `unidades − recibidas estimadas` (FIFO de M8; rotulado «estimado»).

### 3.6 Recibir un embarque (08b-2)

- **`modo = 'llegada'`** (embarque `planificado` o `en_transito`): una persona confirma «Confirmar ingreso de 1 180 u de 5 compras de Embarque 261101 en dic-2026, a tu nombre». La función, en **una** transacción:
  1. Pone `fecha_llegada_real` (≤ hoy en Lima) y `estado = 'recibido'`.
  2. Si el mes cambia, realinea las asignaciones activas al mes real con el plan, lotes incluidos.
  3. Crea una recepción por asignación con unidades > 0: `recibida_periodo = X` (por defecto el mes real), `fecha_recepcion = fecha_llegada_real`, `origen = 'manual'`, `asignacion_id`, el usuario y la nota «Llegada del embarque 261101».
  4. Recalcula cada compra y sube su revisión.
- **Validaciones**: exige al menos una unidad (`sin_unidades`, B2). **Las compras en `borrador` quedan fuera** (I1): la lista por defecto las excluye con el aviso `borradores_excluidos`, y si vienen en `items`, `409 no_confirmada`.
- **`modo = 'otra_llegada'`** (embarque ya `recibido` con pendientes; B3): **no toca `fecha_llegada_real` ni mueve entregas**. Solo crea recepciones vinculadas con **su propio mes X** y su fecha.
- **Volver a en tránsito** (`requirePlanner`): solo si no queda ninguna recepción vinculada (se quitan en M8 por compra). Pone `fecha_llegada_real = null` y realinea al mes estimado (B2).
- Nunca se ejecuta sola y nunca se reintenta (§3).

### 3.7 Pendientes (08b-2)

- **`pendientesPorEntrega`** (`src/lib/compras/pendientes.ts`): `RecepcionParaPendientes` gana `entrega_id?: string` (lo deriva `consultas.ts` de `asignacion_id → asignación.entrega_id`). **Las recepciones vinculadas consumen primero su entrega**; las demás siguen FIFO, como hoy, sobre lo libre. **Sin recepciones vinculadas el resultado es idéntico** (regresión con todos los casos de M8). `VERSION_METODO_FLUJO` sube de 3 a 4.
- **`pendientesPorAsignacion`**: dentro de una entrega, primero las recepciones vinculadas de cada asignación. Después lo no vinculado, en orden `(periodo_llegada, código del embarque, código del paquete)`, **rotulado como estimación**. Lo «sin embarque» va al final. Lo cancelado se descuenta en orden inverso.

### 3.8 Viaje activo (el papel de `campaigns` de COTV)

- **Dónde vive**: preferencia **por navegador**, en la cookie `v2_viaje_activo` (`path=/`, `sameSite=lax`, un año, sin `httpOnly` porque no es secreta). La escribe solo `PUT /api/compras/viaje-activo`, que valida que sea un `uuid` de un viaje existente no cancelado, `todos` o `sin_viaje`.
- **Quién la lee**: las páginas de servidor de Compras y de Viajes y embarques, con `cookies()`. Validan otra vez el formato y la existencia y pasan el valor inicial al cliente; una cookie inválida o de un viaje cancelado se trata como ausente. **Las rutas de la API nunca la leen**: reciben `viaje_id` explícito, y la cookie no da ni quita permisos.
- **Valor por defecto**: el último viaje `abierto` (por `fecha_inicio`) del que el usuario es responsable; si no tiene, «Todos».
- **Qué filtra**: Compras, Viajes y embarques (los embarques del viaje; «Sin viaje» muestra los locales) y Sin agrupador. **No filtra** Huecos ni Flujo (decisión 2). Las compras nuevas de `0.13.1` y M9a proponen el viaje activo; la carga inicial, no.

### 3.9 Columnas `VIAJE`, `EMBARQUE` y `PAQUETE` en el importador de compras (08b-1; revisión I7)

1. **Primero se clasifica la fila** como en M8 (`nueva`, `igual` o `cambiada`), con la huella **de lo que dice el archivo**. Las columnas de agrupador **no** entran en la huella. Una entrega que después movió un embarque sigue dando `igual`, porque se compara contra la huella guardada, no contra la base.
2. **Las reglas de agrupador se aplican solo a `nueva` y a `igual` sin asignación.** A una `igual` ya asignada a otro embarque se le aplica `agrupador_distinto`, y no se toca: los cambios se hacen en pantalla. Una `cambiada` sigue su regla de M8.
3. **Con `EMBARQUE`**, `LLEGADA` sigue siendo **obligatoria** y debe caer en el mes del embarque (`llegada_distinta_del_embarque`). `ENTREGAS` con más de una entrega da `entregas_con_embarque`. `PAQUETE` sin `EMBARQUE`, `paquete_sin_embarque`. Los códigos desconocidos dan `viaje_desconocido`, `embarque_desconocido` y `paquete_desconocido` (el importador no crea agrupadores). Un `VIAJE` cerrado se acepta con el aviso `viaje_cerrado`, para los tres roles (decisión 95); uno cancelado se omite (`viaje_cancelado`).
4. **Tres llamadas en tres transacciones** por compra: `importar_compra` (M8, sin cambios), `asignar_viaje_compras` y `aplicar_movimiento_agrupador`. Un corte deja la compra sin agrupador; reimportar lo completa y el reporte lo dice.

### 3.10 Contrato con `0.13.1` (para su ficha)

- Sigue el **orden global de candados** de §2.9 y **nunca escribe asignaciones**. Cuando una edición necesita moverlas, llama a `aplicar_movimiento_agrupador` **en otra transacción**, después de la suya.
- Reemplazar entregas o reimportar una `cambiada` **actualiza en el lugar** las entregas con asignaciones (conserva su `id`). No baja sus unidades por debajo de lo asignado ni les cambia el mes (`409 entrega_asignada`).
- Desactivar una línea con asignaciones activas da `409 entrega_asignada`.
- Las entregas nuevas nacen sin embarque. La captura ofrece Viaje (por defecto el activo) y Embarque o paquete por entrega.
- **Si `0026` ya existe cuando se construya 08b-1**, `00B1` le añade estas comprobaciones con `create or replace` de esas funciones; si no existe, las escribe `0026` desde el principio.

### 3.11 Importador de agrupadores (08b-1; Javier, h)

Se adelanta porque al arrancar habrá más de 15 viajes y embarques abiertos. **Solo crea viajes, embarques y paquetes**: no asigna compras (eso lo hacen las columnas de §3.9 o la pantalla) y nunca edita ni mueve uno existente.

- **Archivo**: CSV (UTF-8, coma o punto y coma) o Excel (`.xlsx`). Se lee **en el navegador** con el importador compartido (`src/components/importador`: `use-importador`, `csv.ts`, `excel.ts`, `mapeo.ts`, los cuatro pasos archivo → columnas → reporte → aplicar) y el servidor recibe filas de texto, como en los demás importadores del repositorio (tiendas, M3, compras). Hasta **1 000 filas**.
- **Una sola hoja, con una columna `TIPO`**: así sirve también en CSV.

| Columna | Viaje | Embarque | Paquete | Formato |
|---|---|---|---|---|
| `TIPO` | `VIAJE` | `EMBARQUE` | `PAQUETE` | obligatoria |
| `CODIGO` | opcional | opcional | opcional | `aamm##` u otro `^[A-Z0-9-]{1,30}$`; vacío = se numera al aplicar (§2.2) |
| `NOMBRE` | obligatoria | obligatoria | obligatoria | 1–120, libre |
| `VIAJE` | — | opcional | — | código de un viaje existente o de una fila `VIAJE` del archivo |
| `EMBARQUE` | — | — | obligatoria | código de un embarque existente o de una fila `EMBARQUE` del archivo |
| `TIPO_EMBARQUE` | — | `IMPORTACION` (por defecto) o `LOCAL` | — | |
| `DESTINO` | opcional | — | — | ≤ 120 |
| `FECHA_INICIO` · `FECHA_FIN` | obligatoria · opcional | — | — | `aaaa-mm-dd` o número de serie de Excel |
| `FECHA_SALIDA` · `FECHA_LLEGADA` | — | opcional · **obligatoria** | — | ídem |
| `PUERTO` · `REFERENCIA_LOGISTICA` | — | opcionales | — | ≤ 80 |
| `RESPONSABLE` | **obligatoria** | opcional | opcional | correo de un perfil asignable (comprador o admin activos, §2.8) |
| `NOTA` | opcional | opcional | opcional | ≤ 500 / 500 / 300 |

- **Orden y referencias**: se procesan viajes, después embarques y después paquetes, sin importar el orden de las filas. Un embarque puede apuntar a un viaje y un paquete a un embarque **del mismo archivo**, pero solo por código: la fila referida debe traer `CODIGO` (si no, `referencia_sin_codigo`).
- **Clave e idempotencia**:
  - Con `CODIGO`, la clave es (tipo, código).
  - Sin `CODIGO`, la clave natural es: viaje (`NOMBRE` en mayúsculas, `FECHA_INICIO`); embarque (`NOMBRE` en mayúsculas, `FECHA_LLEGADA`); paquete (`EMBARQUE`, `NOMBRE` en mayúsculas).
  - Contra la base, cada fila es `nueva`, `igual` (existe con el mismo contenido normalizado: no hace nada) o `cambiada` (existe con otro contenido: se omite con `cambiada_requiere_edicion` y el detalle de qué difiere; se corrige en pantalla). **Reimportar el mismo archivo no duplica nada.**
  - La plantilla recomienda escribir el código.
- **Omisiones**: `tipo_invalido`, `nombre_requerido`, `nombre_largo`, `codigo_invalido`, `codigo_repetido_en_archivo`, `fila_repetida` (misma clave dos veces), `fecha_requerida`, `fecha_invalida`, `fin_antes_de_inicio`, `salida_despues_de_llegada`, `local_con_viaje`, `viaje_desconocido`, `viaje_cancelado`, `embarque_desconocido`, `embarque_requerido`, `embarque_no_editable` (paquete en un embarque cancelado o recibido), `responsable_requerido`, `responsable_desconocido`, `responsable_no_asignable`, `referencia_sin_codigo`, `referencia_omitida` (apunta a una fila del archivo que se omitió), `cambiada_requiere_edicion`, `correlativo_agotado`, `campo_largo`.
- **Avisos**: `viaje_cerrado`, `sin_responsable` (embarque o paquete sin responsable propio ni heredable), `puerto_distinto_del_habitual` (informativo, si existe la 08c).
- **Aplicar**: una sola llamada a `importar_agrupadores` (§2.9), todo o nada. Si entre previsualizar y aplicar alguien creó una de las claves, `409 vuelve_a_previsualizar`. El reporte final da los códigos asignados.
- **Plantilla**: en la pestaña Importar, **Descargar plantilla** (CSV y Excel) con el encabezado y una fila de ejemplo de cada tipo (sintética). La exportación Excel de Viajes y embarques suma una hoja `AGRUPADORES` con las mismas columnas, así que se puede bajar, completar y volver a subir: lo existente sale `igual`.

## 4. Pantallas (kit de Vector2: `Tabs`, `DataTable`, `Modal`, `Form`, `Chips`, `Badge`, `Alert`, `EmptyState`; `useColeccion`; `es-PE`; 390 px)

**Menú** (`nav.ts`, sección Compras, `TODOS`): Huecos · Flujo mensual · Compras · **Viajes y embarques** (`/compras/agrupadores`). La 08c añade sus entradas en la misma sección.

**Barra de viaje activo** en Compras y en Viajes y embarques: «Todos», «Sin viaje (locales)» y viajes abiertos y cerrados. Texto: «Las listas de Compras y de Viajes y embarques muestran solo este viaje».

**Qué ve cada rol**: los tres ven los botones de §0.3 que les corresponden. Cerrar, reabrir y cancelar, y volver a en tránsito, solo admin y planner. El comprador abre con «Mis embarques» activo si es responsable de alguno. Los costos se ven como en Compras (decisión pendiente de la ficha 08 §0.16).

**Pestañas de `/compras/agrupadores`**: Embarques (por defecto) · Viajes · Sin agrupador · **Importar**. En todos los selectores de viaje, los cerrados van al final y marcados «(cerrado)».

### 4.1 Pestaña Embarques (por defecto)

**Columnas**: Embarque `261101` · nombre · tipo · viaje · puerto · responsable (ⓘ heredado, ⚠ faltante) · sale y llega (estimadas; la real en 08b-2) con badge **Atrasado** · estado · unidades (asignadas, recibidas «est.», pendientes) · compras, paquetes y proveedores · costo · avisos.

**Filtros**: Mis embarques / Todos, estado, tipo, atrasados, mes de llegada y texto.

**Acciones**: Nuevo embarque (el código se propone `aamm##` y se puede editar), Abrir y Excel (`EMBARQUES`, `PAQUETES`, `ASIGNACIONES`). En el celular, tarjetas.

### 4.2 Detalle del embarque

- **Cabecera**:
  - «Editar» en un `Modal`, que incluye fecha de salida y puerto (con los puertos habituales de sus proveedores como sugerencia).
  - **«Cambiar fecha de llegada»** con motivo obligatorio y vista previa: «Mueve 12 líneas de 5 compras de nov-26 a dic-26 · 2 lotes cambian de temporada (BETA: verano → invierno) · 1 línea recibida no se mueve».
- **Paquetes**: nuevo, editar, pasar a otro embarque y cancelar (solo admin y planner).
- **Contenido**: una `DataTable` por paquete y «Sin paquete»; las asignaciones históricas, atenuadas. Acciones: **Agregar compras** (en un `Modal`: candidatas con filtros por viaje, proveedor, mes y «sin embarque», unidades editables y vista previa), **Quitar del embarque** (también en embarques cancelados o recibidos), **Mover a paquete** y **Pasar pendientes a…**
- **08b-2**: **Recibir embarque** (fecha real, mes X, unidades por paquete y línea, `confirm` con el total) y, con pendientes, **Registrar otra llegada** y el banner de pendientes.
- **Historial** del embarque y sus paquetes.
- **Mensajes**: «Un embarque local no lleva viaje», «La salida no puede ser posterior a la llegada», «Este embarque ya tiene ingresos confirmados: lo que falta se pasa a otro embarque», «Solo hay 120 u sin asignar en esta entrega», «Esta línea llegaría a 25 entregas: el máximo es 24».

### 4.3 Viajes

- **Lista**: viaje `261101` · nombre · destino · fechas · responsable · estado · compras · unidades · costo · embarques · unidades sin embarque. Acciones: Nuevo, Cerrar o Reabrir y Cancelar (admin y planner), Excel y «Usar como viaje activo».
- **Detalle**: compras del viaje (agregar y quitar), embarques del viaje y «Sin embarque» con «Asignar a embarque…».

### 4.4 Sin agrupador

«Entregas sin embarque» (compras en borrador o confirmadas, por mes) con «Asignar a embarque…», y «Compras sin viaje» con «Asignar a viaje…». Es el backfill manual de lo ya cargado y respeta el viaje activo.

### 4.4b Pestaña Importar (para los tres roles)

Los cuatro pasos del importador compartido: (1) elegir un archivo CSV o Excel, o **Descargar plantilla**; (2) confirmar el mapeo de columnas; (3) **reporte** con totales por tipo y por clasificación, una tabla de filas omitidas con su motivo, una de cambiadas con su diferencia y una de nuevas con el código que tendrán o «se numera al aplicar»; (4) **Aplicar** con un `confirm` («Se crearán 12 viajes, 18 embarques y 30 paquetes»), y el reporte final con los códigos asignados y un enlace a cada agrupador. Al cerrar el último paso se refrescan las listas.

### 4.5 Compras (`/compras/registro`)

- **Lista**: columnas y filtros de Viaje y de Embarque.
- **Detalle**: «Viaje: 261101 · Feria Sur [Cambiar]» y, por entrega, los chips `Embarque 261101 · P 261101 · 300 u` y «120 u sin embarque».
- **Importador**: las tres columnas nuevas.

## 5. Reglas de negocio (cada una con su prueba en vitest)

| # | Regla | Entrega |
|---|---|---|
| R1 | El paquete pertenece a un único embarque; una asignación con paquete lleva el embarque del paquete (FK compuesta; antes, `no_pertenece` o `paquete_de_otro_embarque`) | 1 |
| R2 | I2 sobre lo que toca el plan, tras asignar, cambiar la fecha, pasar pendientes, mover un paquete, recibir y revertir. `agrupadores_desalineados() = 0` en el humo | 1 y 2 |
| R3 | I1, con fusión de asignaciones por el índice único | 1 |
| R4 | I3: los movimientos conservan `Σ entregas`, funden y separan entregas sin perder qué unidades son de qué embarque, conservan los `id` de las entregas que sobreviven y respetan `MAX_ENTREGAS` | 1 |
| R5 | Cambiar la fecha dentro del mismo mes no toca compras ni revisiones; editar la salida nunca mueve entregas | 1 |
| R6 | **Lote al barrer**: las entregas tocadas **de origen y de destino** se reparten de nuevo completas, con la **misma versión** de M12 que usa la línea y el vector de la temporada de su mes (`temporadaDe(mes, temporadas_usadas)`). La versión se lee con **`leerRepartosPorId`** (exportación nueva y aditiva en `src/lib/marcas-barrer/servicio.ts`, sin filtrar por vigente ni por activo; revisión I6). Sin vector para esa temporada, `409 reparto_sin_vector`. Nunca se cambia de versión. Las mezclas de M9a se reparten con sus porcentajes | 1 |
| R7 | Un embarque con recepciones vinculadas no cambia de mes; un paquete con recepciones vinculadas no cambia de embarque | 2 (desde 1 por estructura) |
| R8 | Recibir: al menos 1 unidad; borradores fuera (`no_confirmada`); `≤` pendiente por asignación; `X ≥ mes(fecha_compra)`; llegada real `≤` hoy; a nombre de quien pulsa; nunca sola ni con reintento | 2 |
| R9 | Registrar otra llegada no toca `fecha_llegada_real` ni las entregas | 2 |
| R10 | Revertir pone `fecha_llegada_real = null` y realinea al mes estimado; solo sin recepciones vinculadas | 2 |
| R11 | `pendientesPorEntrega`: primero lo vinculado y después FIFO; **sin recepciones vinculadas da idéntico a M8** (todas las pruebas de M8 en verde sin tocarlas) | 2 |
| R12 | Asignaciones históricas (compra recibida o cancelada, línea inactiva o recibida al 100 %): no se mueven, no son pendientes, no bloquean cancelar y se informan; `desalineada`, `linea_recibida` y `en_embarque_cancelado` con su acción | 1 |
| R13 | **Estados.** **Viaje**: `abierto ⇄ cerrado` (solo admin y planner); **un viaje cerrado no bloquea ninguna operación, solo avisa `viaje_cerrado`** (decisión 95); `→ cancelado` solo sin compras no canceladas ni embarques no cancelados; `cancelado` es inmutable y bloquea (`viaje_cancelado`). **Embarque**: `planificado ⇄ en_transito`; `→ recibido` solo al recibir (08b-2); `recibido → en_transito` solo al revertir; `→ cancelado` solo sin asignaciones activas ni recepciones vinculadas. En `cancelado` y en `recibido` solo se permite «Quitar del embarque» (más, en `recibido`, «Registrar otra llegada» y «Pasar pendientes»). **Paquete**: `abierto → cancelado` solo sin asignaciones activas | 1 y 2 |
| R14 | Códigos `aamm##`: el mes de la fecha de referencia al crear, el máximo más uno con candado, sin reutilizar, `correlativo_agotado` en 99; los escritos a mano siguen `^[A-Z0-9-]{1,30}$` y son únicos por tipo | 1 |
| R15 | Permisos de §0.3: el comprador escribe lo suyo y lo de los demás, también en viajes cerrados y en los dos importadores; recibe `403` solo en cerrar, reabrir y cancelar, y en revertir | 1 y 2 |
| R16 | Solo `.rpc(`: ningún `.insert`, `.update`, `.upsert` ni `.delete` sobre las tablas nuevas o de compras | 1 |
| R17 | Eventos inmutables: `UPDATE`, `DELETE` y **`TRUNCATE`** rechazados en `compra_agrupador_eventos` **y en `compra_eventos`** (trigger de sentencia nuevo), también con `service_role`; salvo `perfil_id → NULL` | 1 |
| R18 | I5: todo cambio de `asignacion.entrega_id`, de sus unidades o de `recepciones.asignacion_id` sube la revisión de la compra y deja un evento | 1 y 2 |
| R19 | Reintentos solo con la huella del plan idéntica; recibir nunca reintenta (`recepcion_cambio`) | 1 y 2 |
| R20 | **Sin recepciones vinculadas**, el flujo con agrupadores da las mismas cifras que con las mismas entregas sin agrupadores | 1 y 2 |
| R21 | Importador: clasificar primero; reglas solo para `nueva` e `igual` sin asignación; huella del archivo; `LLEGADA` obligatoria y alineada; tres llamadas | 1 |
| R22 | La cookie del viaje activo no es permiso, ninguna ruta de la API la lee y una cookie inválida se ignora | 1 |
| R23 | IDOR: asignaciones, paquetes, entregas y recepciones de otro embarque o de otra compra dan `no_pertenece` en todas las rutas | 1 y 2 |
| R25 | **Importador de agrupadores**: solo crea; clave por código o natural; `nueva`, `igual` o `cambiada`; reimportar no duplica; referencias dentro del archivo solo por código; orden viajes → embarques → paquetes; todo o nada al aplicar; las omisiones de §3.11 | 1 |
| R26 | Responsables asignables: comprador o admin activos; planner, `responsable_no_asignable` (Javier, f) | 1 |
| R24 | I4: la recepción vinculada es de la línea de la entrega de su asignación, y `Σ` vinculadas `≤` las unidades de la asignación | 2 |

### Casos sintéticos (`tests/agrupadores.fixture.ts`; `k' = 2026-09`; temporadas por defecto)

Perfiles: C1 y C2 (compradores activos), C3 (comprador inactivo), A (admin). Proveedores: «Feria Sur», «Proveedor Norte» y «Taller Lima Centro».

- **Viaje 261001**, «Feria Sur · oct-2026», de C1, abierto.
- **Embarque 261101**: importación, del viaje 261001, puerto «Puerto Sur», llega el 20-nov-2026, sin responsable (hereda C1). Paquetes **261101** (C2) y **261102** (sin responsable, hereda C1).
- **Embarque 261201**: importación, del viaje 261001, llega el 10-dic-2026.
- **Embarque 270301**: importación, sin viaje, llega el 15-mar-2027.
- **Embarque 261102**: local, llega el 05-nov-2026, de C3.
- **C-000101** (Feria Sur, viaje 261001): l1 específica DENIM × ALFA de 500 u (nov 300 · dic 200); l2 lote BETA de 1 000 u (mar-27 600 · abr-27 400; reparto v2 con vectores de verano y de invierno).
- **C-000102** (Proveedor Norte, sin viaje): POLO 400 u en nov.
- **C-000103** (Taller Lima Centro, en borrador): CAMISA 120 u en nov.

| # | Caso | Resultado esperado |
|---|---|---|
| 1 | l1 nov 300 → 261101/P261101 y dic 200 → 261201 | Nada se mueve |
| 2 | C2 (comprador) asigna C-000102 → 261201 | La entrega pasa a dic; `revision` +1; evento con actor C2 |
| 3 | C1 cambia la llegada de 261101 al 03-dic | l1 queda en dic 500 con dos asignaciones; aviso `entregas_fusionadas` |
| 4 | Devolverla al 18-nov | l1 vuelve a nov 300 · dic 200 con los mismos `id` de entrega |
| 5 | l2 mar 600 → 270301 y llegada a abr-27 | Entrega abr de 1 000 repartida con v2 e invierno, y la de origen desaparece. Si v2 no tiene vector de invierno, `reparto_sin_vector` |
| 6 | Con `261101` y `261102` ya creados (el segundo a mano), crear otro embarque que llega en nov-26 sin código | Recibe `261103`. Escribir `261101` a mano da `codigo_duplicado`; con `261199` ya usado, `correlativo_agotado`; el viaje `261101` puede convivir con el embarque `261101` |
| 7 | Cancelar C-000102 (M8) y después cancelar 261201 como admin | La asignación pasa a histórica; el embarque se cancela si no quedan activas; C1 recibe `403` al cancelar |
| 8 | Una línea de 261201 vuelve a ser activa (quitar una recepción en M8) | Aviso `en_embarque_cancelado`; «Quitar del embarque» funciona |
| 9 | Responsables efectivos | P261101 → C2; P261102 → C1 (del viaje); 270301 → `sin_responsable`; 261102 → C3, faltante; A (admin) asignable; un planner da `responsable_no_asignable` |
| 10 | Embarque local con viaje; salida posterior a la llegada | `409 local_con_viaje` y `409 salida_despues_de_llegada` |
| 11 | Dos pestañas sobre 261201 | La segunda recibe `agrupador_cambio`. Una compra que cambió después de la vista previa: reintenta si la huella es igual y, si no, `409 plan_cambio` |
| 12 | Importar `EMBARQUE = 261201` en una línea `igual` sin asignación | Se asigna |
| 13 | El mismo archivo con `LLEGADA = 2026-11` | `llegada_distinta_del_embarque` |
| 14 | `ENTREGAS` de dos meses con `EMBARQUE` | `entregas_con_embarque` |
| 15 | Reimportar después de mover el embarque | Sigue `igual` |
| 16 | Una llegada en ago-26 (≤ `k'`) | `fecha_en_mes_cerrado`; el flujo espera lo pendiente en oct-26 |
| 17 | Asignar a 261201 (dic) 300 de una entrega nov de 500, con 100 sin embarque en dic | Quedan nov 200 y dic 400 (300 en el embarque y 100 sin embarque) |
| 18 | La línea alcanza 25 entregas | `max_entregas` |
| 19a | Cerrar 261001 como admin; C2 le añade C-000102 y crea un embarque del viaje | Se aplica con el aviso `viaje_cerrado`; 261001 deja de ser el viaje activo por defecto; C2 recibe `403` al reabrirlo |
| 19b | Importar un archivo con 2 viajes (uno con código `261201`, otro sin código), 3 embarques (uno que apunta al viaje `261201` del archivo y otro a 261001) y 4 paquetes | Previsualizar: 9 nuevas, la del viaje sin código «se numera al aplicar». Aplicar crea todo en una transacción. Reimportar da 9 `igual` |
| 19c | El mismo archivo con la fecha de llegada de un embarque cambiada; un paquete cuyo embarque del archivo no trae código; un responsable planner | `cambiada_requiere_edicion` con la diferencia; `referencia_sin_codigo`; `responsable_no_asignable`; lo demás, `igual` |
| 19 | Viaje activo 261001 | Compras lista C-000101 y no C-000102; la API sin `viaje_id` devuelve todo; Flujo no cambia; una cookie con texto basura se ignora |
| **20** (08b-2) | Recibir 261101 el 22-nov con P261101 = 250 de 300 | Recepción vinculada de 250 en nov; el embarque queda recibido parcial; pasar 50 a 261201 deja nov 250 · dic 250 |
| 21 (08b-2) | Registrar otra llegada de 30 en dic | `fecha_llegada_real` sigue en 22-nov y las entregas no se mueven |
| 22 (08b-2) | Cambiar la fecha de 261101 | `embarque_con_recepciones` |
| 23 (08b-2) | Recibir con C-000103 (borrador) en `items` | `no_confirmada`; por defecto se excluye con aviso |
| 24 (08b-2) | `pendientesPorEntrega` | Sin vínculos, igual que M8. Con 261201 (dic) recibido antes que 261101 (nov) sin mover fechas: pendiente nov 300 y dic 0 |
| 25 (08b-2) | Revertir sin recepciones | `fecha_llegada_real = null`, realinea al mes estimado; con recepciones, `tiene_recepciones` |
| 26 (08b-2) | Recibir con una unidad menos de las del `confirm` | `recepcion_cambio`, sin reintento |

## 6. Criterios de aceptación / hito de prueba

**08b-1**
- [ ] `00B1` aplica dos veces; el humo pasa (I1–I3 e I5, códigos, triggers con `service_role` y `TRUNCATE` en las dos tablas de eventos, `agrupadores_desalineados() = 0`); tipos regenerados; un movimiento de 200 líneas ≤ 2 s.
- [ ] lint, `tsc`, vitest (casos 1–19, con las pruebas de M8 en verde sin tocarlas) y build.
- [ ] «Viajes y embarques» aparece dentro de Compras para los tres roles.
- [ ] **Como comprador (C1 o C2)**: crear el viaje con código propuesto `aamm##` y nombre libre, embarques con puerto y paquetes, un embarque local sin viaje; asignar compras de la carga inicial desde Sin agrupador; cambiar la salida y la llegada, ver la vista previa y después las entregas en el mes nuevo en **Flujo mensual**; historial con motivo y autor. Al intentar cerrar o cancelar, `403`.
- [ ] **Como admin**: cerrar y cancelar. Con el viaje cerrado, **un comprador** le añade y le quita compras y ve el aviso; al reabrir recibe `403`.
- [ ] **Importador de agrupadores, como comprador**: descargar la plantilla, cargar **todos los viajes y embarques abiertos reales** (más de 15) con sus paquetes, puerto y responsables (comprador o admin), revisar el reporte, aplicar y reimportar sin duplicar; un responsable planner se rechaza.
- [ ] El puerto real se ve y se edita por embarque, con el habitual del proveedor como sugerencia si la 08c ya está construida.
- [ ] Un lote que cruza de temporada muestra `cambia_temporada`.
- [ ] El viaje activo filtra Compras y no Flujo.
- [ ] Importar con las columnas nuevas y reimportar sin duplicar.
- [ ] Excel; 390 px; `seguridad` (sonnet): guards por acción, IDOR, funciones solo `service_role`, cookie.

**08b-2**
- [ ] `00B2` aplica dos veces; humo con I4 e I5.
- [ ] Casos 20–26 en verde; `VERSION_METODO_FLUJO = 4`; regresión de M8.
- [ ] Recibir parcial como comprador: ingresos a su nombre en el mes elegido; registrar otra llegada; pasar pendientes; cambiar la fecha del recibido, rechazado; el admin revierte un embarque sin recepciones.

## 7. Fuera de alcance

- Maestro de proveedores, fotos y proformas: ficha 08c.
- OTB o presupuesto por viaje; el viaje no filtra Huecos ni Flujo.
- Impacto en el IMI y justificación de exceso al mover un embarque: cuando `0.13.1` traiga `impacto`. Hasta entonces, mover solo pide motivo.
- Vista del flujo por embarque o viaje.
- Que el importador de agrupadores **edite** lo existente o asigne compras: solo crea (las compras se asignan con las columnas de §3.9 o en pantalla).
- Acompañantes de viaje, costos logísticos, documentos y seguimiento naviero.
- Fecha propia del paquete.
- Captura manual y edición de cronogramas: `0.13.1`, con el contrato de §3.10.

## 8. Plan de construcción por tandas (dueño único por archivo; reglas de la ficha 08 §0.8)

**08b-1**

| Tanda | Agente | Depende de | Archivos | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Contratos | `backend` | — | `src/lib/compras/agrupadores/{tipos-api,tipos,esquemas}.ts`, `tests/agrupadores.fixture.ts`, `tests/agrupadores.esquemas.test.ts` | `tsc` limpio; esquemas probados |
| T1 · Datos | `datos` | — | `supabase/migrations/00B1_agrupadores_compras.sql` (renombrada al número libre; incluye `importar_agrupadores`), `scripts/humo-00B1.sql`, `src/lib/supabase/database.types.ts` | Consultas de §2.10 anotadas; aplica dos veces; humo verde (también importar el mismo lote dos veces); tiempos medidos (1 000 filas ≤ 3 s) |
| T2 · Lógica pura | `backend` | T0 | `src/lib/compras/agrupadores/{codigos,movimiento,responsable,estados,avisos,permisos,viaje-activo,excel,importar,plantilla}.ts`, `tests/agrupadores.{codigos,movimiento,estados,responsable,permisos,importar}.test.ts`; `src/lib/compras/tipos.ts` (catálogos de §2.7); **aditivo** `leerRepartosPorId` en `src/lib/marcas-barrer/servicio.ts` | R1–R6, R12–R15, R20, R21, R25 y R26 en verde; M8 y M12 en verde sin tocar sus pruebas |
| T3a · Pantallas con fixtures | `frontend` | T0 | `src/app/(app)/compras/agrupadores/**`, `src/components/compras/agrupadores/**` (incluida la barra de viaje activo), `src/lib/compras/agrupadores/use-agrupadores.ts`, `src/lib/nav.ts`, `tests/agrupadores.pantalla.estatico.test.ts` (la pestaña Importar **reutiliza** `src/components/importador/**` sin modificarlo; si hiciera falta un cambio, lo hace `frontend` y lo avisa) | build y `tsc` limpios |
| T3b · Servicio y API | `backend` | T1, T2 | `src/lib/compras/agrupadores/{consultas,servicio}.ts`, `src/app/api/compras/{viajes,embarques,paquetes,agrupadores,viaje-activo}/**` (incluida `agrupadores/importar`), `tests/agrupadores.{handlers,estatico}.test.ts`; aditivos en `src/lib/compras/{consultas,servicio,tipos-api,importar}.ts`, `src/app/api/compras/route.ts` y `src/app/api/compras/importar/route.ts`; altas en `tests/api.guards.roles.test.ts`; casos en `tests/compras.importar.test.ts` | R15–R19, R21–R23 en verde |
| T4 · Integración | `frontend` | T3a, T3b | Los de T3a, más `src/app/(app)/compras/registro/**` y `src/components/compras/**` que toque | Contra la API real en local; Excel; 390 px |
| T5 · Cierre | `qa`, `seguridad` (sonnet), `documentador` | T4 | solo lectura · `docs/**`, `src/lib/version.ts` | Hito 08b-1 |

**08b-2**

| Tanda | Agente | Depende de | Archivos | Se da por buena cuando |
|---|---|---|---|---|
| T1 · Datos | `datos` | — | `supabase/migrations/00B2_recibir_embarque.sql`, `scripts/humo-00B2.sql`, `src/lib/supabase/database.types.ts` | Aplica dos veces; I4 e I5 en el humo |
| T2 · Lógica | `backend` | — | `src/lib/compras/agrupadores/{recibir,pendientes-asignacion}.ts`, `src/lib/compras/pendientes.ts`, `src/lib/flujo/tipos.ts` (`VERSION_METODO_FLUJO = 4`), casos nuevos en `tests/compras.pendientes.test.ts`, `tests/agrupadores.recibir.test.ts`, `tests/flujo.agrupadores.test.ts` | R7–R11, R20 y R24 en verde; M8 en verde sin tocar sus pruebas |
| T3 · API | `backend` | T1, T2 | Rutas `recibir` y `revertir-recepcion`; lectura de `asignacion_id` en `src/lib/compras/consultas.ts` y `src/lib/flujo/consultas.ts` | Handlers y guards |
| T4 · Pantalla | `frontend` | T3 | Los de T3a de 08b-1 | Recibir y Otra llegada en Chromium |
| T5 · Cierre | `qa`, `seguridad`, `documentador` | T4 | — | Hito 08b-2 |

**Para no pisarse**: `nav.ts`, solo `frontend`; `database.types.ts`, solo `datos`; `tests/api.guards.roles.test.ts`, solo `backend`. En `src/lib/flujo/**` y `src/lib/marcas-barrer/**`, solo `backend` y solo lo listado. `src/lib/compras/agrupadores/**` no importa `src/lib/flujo/**`. **Con la 08c, siempre en serie.**

## 9. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

En `DECISIONES.md` están registradas la 70 a la 80 y la **82, que es de 07g** (aprobación en bloque); la 81 sigue reservada para esta ficha. Esta ficha usa la **81, 83 a 86 y 92 a 97**, y la que antes numeraba como 82 pasa a ser la **98**; las **87–91 las toma la 08c**. Los números quedan reservados en `DECISIONES.md` (entrada del 2026-11-03) hasta que se registren.

| N.º | Decisión |
|---|---|
| 81 | El viaje es contexto y filtro, nunca presupuesto. Cumple el papel de `campaigns` de COTV con un viaje activo por navegador, que no da permisos. Matiza «No se adopta: campañas» de la ficha 08 §4.0 |
| 83 | La fecha de llegada al CD vive en el embarque y alinea las entregas que toca cada operación. Cambiarla mueve en bloque, con motivo. Lo recibido no se mueve |
| 84 | (08b-2) Recibir un embarque es confirmar el ingreso en bloque por una persona; las recepciones quedan vinculadas y `pendientesPorEntrega` las respeta (`VERSION_METODO_FLUJO = 4`) |
| 85 | Un responsable por nivel, heredado, obligatorio en el viaje y filtro, no permiso. **Pueden ser responsables los compradores y el admin activos; el planner, no** (Javier, f) |
| 86 | Un lote movido se reparte de nuevo con la misma versión de M12 y la temporada del mes |
| 92 | **El comprador escribe agrupadores desde 08b-1** (Javier, b y e): crear, editar e importar; asignar compras, también a un viaje cerrado; cambiar la salida y la llegada; pasar pendientes y recibir. Cerrar, reabrir y cancelar, y revertir una recepción, quedan para admin y planner. Permiso por rol, no por responsable (matiz de la 28). Adelanta a M9a solo esta parte de la escritura |
| 93 | Códigos `aamm##` por tipo (Javier, c): mes de la fecha de referencia al crear, máximo más uno con candado, sin reutilizar, códigos a mano permitidos y nombre libre |
| 94 | Orden global de candados viaje → embarques → compras; `0.13.1` nunca escribe asignaciones |
| 95 | **Un viaje cerrado es solo un estado informativo** (Javier, e): sigue aceptando que los tres roles le añadan o quiten compras y embarques, con el aviso `viaje_cerrado`; deja de ser el viaje activo por defecto y va al final de los selectores. Solo `cancelado` bloquea. Cerrar, reabrir y cancelar, solo admin y planner |
| 96 | **El puerto real va por embarque** (`compra_embarques.puerto_embarque`), con el puerto habitual del proveedor (08c) como sugerencia (Javier, g) |
| 97 | **Importador de agrupadores en 08b-1** (Javier, h: más de 15 abiertos al arrancar): una hoja con `TIPO`, CSV o Excel, previsualizar y aplicar, solo crea, idempotente por código o por clave natural, todo o nada, para los tres roles, con plantilla |
| 98 | El viaje va en la compra; el embarque y el paquete van en la entrega, por unidades; el paquete pertenece a un único embarque (Javier, a). Tabla de asignaciones para no tocar `unique (linea_id, periodo)` |

## 10. Preguntas abiertas para Javier

**No quedan.** Las cuatro de la versión anterior las respondió Javier el 2026-11-02 (e–h en la cabecera, decisiones 85 y 95–97). Lo que el arquitecto decidió sin preguntar, y Javier puede corregir antes de construir, es esto:
- El mes del código `aamm##` sale de la fecha de referencia al crear (decisión 93).
- El importador de agrupadores solo crea, nunca edita (decisión 97).
- Cerrar y reabrir un viaje siguen siendo de admin y planner (decisión 95).

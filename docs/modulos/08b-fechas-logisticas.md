# 08b-1b · Fechas logísticas del embarque (cuatro hitos editables, cola de ingreso y compras por dividir)

> **Estado (2026-11-05): especificada, sin construir. Revisión 2**, ajustada con las respuestas de Javier a las cuatro preguntas de la versión 1 (commit `0d5a1b8`). Es una mejora de 08b-1 (ficha [08b](08b-agrupadores-de-compras.md), que manda en todo lo que esta no cambie; su §11 describe lo construido). La diseñó el `arquitecto` (opus) leyendo las migraciones `0025`, `0032`, `0034` y `0036` (las versiones vigentes de las funciones de agrupadores son las de la `0036`) y el código de `src/lib/compras/**`. **Antes de construir**: Javier responde §9 (tres preguntas nuevas) y la ficha pasa por el `arquitecto-revisor` (opus).
>
> **Pedido de Javier** (textual): «déjalo para completar y tiene que ser editable, la logística no siempre es tan previsible, se demoran los pagos, los embarques, la aduana. Deberíamos marcar fecha de embarque, fecha prevista en puerto, fecha prevista en el área de conteo, fecha prevista de ingreso al stock».
>
> **Respuestas de Javier a la versión 1** (mandan sobre lo que proponía la versión 1):
> - **P1 · Compras sin mes (COTV)**: «Tienen información de viaje de compras. Pero tengo que dividirlas luego en dos embarques, uno sale de California y otro de Nueva York según donde están sus almacenes.» → §2.7.
> - **P2 · Pagos**: «causa del retraso», como se recomendaba → §2.6.
> - **P3 · «Ya ocurrió»**: sí, se marca → `hito_confirmado`, §2.1.
> - **P4 · Fechas de llegada**: «Tengo la llegada al área de conteo, pero luego hay cola y tengo que poder programar su ingreso, especialmente en lo que se comporta al barrer.» → La fecha que Javier conoce y carga es la **llegada a conteo**. El **ingreso al stock** (el que manda el mes) se **programa**: por defecto es conteo más unos días de cola, se edita por embarque y se programa aparte para lo al barrer (por paquete). §2.2 a §2.4.
>
> **Qué cambió respecto de la versión 1**: ver §12.
>
> **Numeración.** Migración **`0038_fechas_logisticas_embarque.sql`** (la siguiente libre; ver §8.1) con `scripts/humo-0038.sql`. Versión sugerida **`0.17.0 · M8 b`**. Decisiones propuestas **115 a 119** (§7). Commits `M8:`.
>
> Sin datos reales: proveedores («Proveedor Norte», «Feria Sur»), compradores C1 y C2, admin A, embarques, días de cola y cifras son inventados.

## 0. Punto de partida

**Qué hay en Vector2** (`0032` + `0036`):

- **`compra_embarques.fecha_salida_estimada date null`**. Se edita con `PATCH` (`guardar_embarque`), sin motivo, y no mueve entregas.
- **`compra_embarques.fecha_llegada_estimada date not null`**. Rotulada «**Llegada al CD**» (08b §2.4) y llamada «Llegada» en la plantilla del importador de agrupadores (`FECHA_LLEGADA`). Se cambia solo por `POST …/[id]/fecha` (`aplicar_movimiento_agrupador`, operación `cambiar_fecha`), con motivo, vista previa y huella del plan.
- **`fecha_llegada_real date null`**. La escribirá 08b-2.
- **`periodo_llegada`**. Columna generada: `make_date(año, mes, 1)` de `coalesce(fecha_llegada_real, fecha_llegada_estimada)`. Es el mes que alinea las entregas (I2 de 08b; decisión 83).
- **Check `compra_embarques_salida_llegada_check`** (salida ≤ llegada estimada). Bloquea con `409 salida_despues_de_llegada`.
- **Paquetes sin fecha propia** (08b §7). `mover_a_paquete` nunca mueve meses y mueve **asignaciones enteras**. Asignar desde «Sin agrupador» sí reparte una entrega **por unidades** entre embarques y paquetes (`asignarEntregasSchema.items[].unidades`; 08b §3.4 y caso 17).
- **Lotes al barrer** (`compra_lineas.tipo = 'barrer_marca'`). Sus filas de reparto se guardan **por entrega** (`compra_linea_repartos`), y el vector sale de la **temporada del mes de la entrega** (`temporadaDe`). Mover una entrega de mes la reparte de nuevo con la misma versión de M12 o da `reparto_sin_vector` (decisión 86, R6 de 08b). En el flujo, cada entrega pendiente entra en su mes con ese reparto (ficha 08 §5, 4b).
- **`flujo_parametros`** (una fila `clave = 'global'`). Imi, temporadas, umbrales. Lo edita admin o planner (`/api/flujo/parametros`).
- **Eventos inmutables** en `compra_agrupador_eventos`: `antes` y `despues` = `agrupador_foto_embarque()`.

**Qué no se reabre**:

- Decisiones 2, 54/55, 60, 83 (se precisa), 86, 92, 94 (con los modos de la `0036`), 95, 97 y 98.
- I1 a I5. **I2 se generaliza a paquetes** (§2.8).
- Convenciones de migración: idempotente; sin `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ni `do $$`; sin backfill.

## 1. Objetivo

La llegada de una compra al stock es una cadena: sale, llega a puerto, llega al área de conteo del CD, hace **cola** y recién ingresa al stock. Cada eslabón se atrasa por razones distintas (pago, naviera, aduana, conteo). Este cambio le da al embarque **cuatro hitos** que se editan con motivo y causa y quedan en el historial.

**El ingreso al stock decide el mes del flujo.** Por defecto se calcula como la llegada a conteo más unos **días de cola** configurables. Se programa a mano por embarque y, para lo **al barrer**, por **paquete**, también en tandas.

Las compras que llegan con viaje pero todavía sin embarque (COTV) cuentan en un **mes provisional del viaje**. Después se **dividen** por unidades entre los embarques reales (p. ej. California y Nueva York) sin contarse dos veces.

## 2. Modelo de datos

### 2.1 Los cuatro hitos y su columna

| # | Hito (pantalla) | Columna | Nulable | Nueva | Qué significa |
|---|---|---|:-:|:-:|---|
| 1 | **Sale** (fecha de embarque) | `fecha_salida_estimada` | sí | no | Como hoy |
| 2 | **Llega a puerto** | `fecha_puerto_estimada` | sí | **sí** | No aplica a embarques `local` |
| 3 | **Llega a conteo** (área de conteo del CD) | **`fecha_llegada_estimada`** | **no** | no | **Conserva su significado de origen** («llegada al CD», 08b §2.4). Es la fecha que Javier conoce y carga |
| 4 | **Ingresa al stock** (programado) | **`fecha_ingreso_estimada`** | sí | **sí** | Nula = la del conteo (equivale a cola 0). Ver §2.3 |
| 4' | Ingreso real (08b-2) | `fecha_llegada_real` | sí | no | Lo confirma «Recibir embarque» |

Otras columnas nuevas:

| Tabla | Columna | Tipo | Notas |
|---|---|---|---|
| `compra_embarques` | `ingreso_programado` | `boolean not null default false` | `true` = alguien fijó el ingreso a mano: si cambia el conteo, el ingreso **no** lo sigue. `false` = el ingreso sigue al conteo más la cola |
| `compra_embarques` | `hito_confirmado` | `text null` | Último hito que **ya ocurrió**: zod `embarque`, `puerto` o `conteo`, en orden (si llegó a puerto, también salió). El ingreso se confirma al recibir (08b-2) |
| `compra_embarques` | `origen` | `text null` | ≤ 80. **Almacén o ciudad de origen** («California», «Nueva York»). Texto con sugerencias (valores ya usados y, cuando exista la 08c, la región de los proveedores del embarque). Sin catálogo (§2.7) |
| `compra_embarques` | `es_provisional` | `boolean not null default false` | El embarque «**Por dividir**» de un viaje (§2.7). A lo sumo uno por viaje: índice único parcial `create unique index if not exists … (viaje_id) where es_provisional` |
| `compra_paquetes` | `fecha_ingreso_estimada` | `date null` | **Ingreso propio del paquete**. Nula = hereda el del embarque. No tiene conteo ni puerto propios: viaja con su embarque y solo puede **entrar al stock en otra fecha** |
| `compra_paquetes` | `periodo_ingreso` | `date generated always as (…) stored` | Primer día del mes de `fecha_ingreso_estimada`, nulo si ella es nula. Usa la misma expresión inmutable `make_date(…)` de 08b |
| `compra_agrupador_eventos` | `causa` | `text null` | El catálogo de §2.5, en zod |
| `flujo_parametros` | `dias_cola_ingreso` | `integer not null default 0` + `check (… between 0 and 365)` | Días entre llegada a conteo e ingreso al stock. **Valor inicial 0**: es exactamente el comportamiento de hoy, en el que manda la llegada al CD. Javier lo ajusta en pantalla (P-N2). No se inventa una cifra |
| `flujo_parametros` | `dias_cola_ingreso_barrer` | `integer null` + `check (… is null or between 0 and 365)` | La cola para lo al barrer. Nula = la general |

Todo con `add column if not exists`. Un `check` declarado dentro de `add column if not exists` no se repite al reaplicar. No hay backfill. Las columnas booleanas con default constante no reescriben la tabla.

### 2.2 El mes del flujo: `periodo_llegada` pasa a leer el ingreso

**Regla (decisión 115).** El mes de un embarque es el del **ingreso al stock**:

`periodo_llegada = mes de coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`

Es decir, primero el real, luego el programado y, si no hay programado, el de llegada a conteo.

- **Cómo se cambia la columna generada.** Con `alter table public.compra_embarques alter column periodo_llegada set expression as (make_date(…coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)…))`.
  - Es Postgres 17 (lo usa la CI, `postgres:17`). **`datos` verifica `server_version_num ≥ 170000` en `vector-two` en T1.**
  - No es un `DROP`, es idempotente (reaplicarla deja la misma expresión) y reescribe una tabla de decenas de filas.
  - El índice sobre `periodo_llegada` se reconstruye solo.
  - **Plan B**, si `vector-two` no fuera 17: §2.9.
- **Por qué no se reinterpreta `fecha_llegada_estimada` como ingreso** (lo que hacía la versión 1). La fecha que Javier tiene y ya cargó es la de llegada a conteo, y la columna nació como «llegada al CD». Mantenerle el significado deja bien todo lo cargado y la plantilla vieja (`FECHA_LLEGADA` = conteo) sin tocar un dato. Y el ingreso nuevo, nulo en lo existente, cae al conteo: **ninguna entrega se mueve con la migración**.
- **La misma regla en TypeScript.** `periodoLlegada(real, ingreso, conteo)` en `src/lib/compras/agrupadores/` (revisión B2 de 08b: la lógica TS usa exactamente la expresión de la columna). Cambia su firma y se actualizan sus llamadas.
- **El código `aamm##`** de un embarque nuevo sigue tomando el mes de `fecha_llegada_estimada` (conteo) al crear. No cambia nunca, igual que hoy.

### 2.3 Programar el ingreso: cola por defecto, editable por embarque

- **Al crear un embarque**, o al cambiarle el conteo **sin** `ingreso_programado`, la función escribe `fecha_ingreso_estimada = conteo + cola`, con la cola leída de `flujo_parametros` en ese momento.
- **Con cola 0** escribe `null`. Así lo existente y lo nuevo con cola 0 se ven igual: «ingresa el mismo día que llega a conteo».
- **Programar a mano** (diálogo de fechas, §4.2) fija la fecha y pone `ingreso_programado = true`. Si después cambia el conteo, el ingreso no se mueve. Si el conteo queda después del ingreso, aparece el aviso `orden_de_fechas`.
- **«Volver a calcular»** pone `ingreso_programado = false` y recalcula con la cola vigente.
- **Cambiar la cola en parámetros no mueve nada retroactivamente.** Hacerlo movería entregas de decenas de compras sin motivo ni vista previa. Se aplica a los embarques nuevos y a los que cambien de conteo. La pantalla de parámetros lo dice, y cada embarque calculado con otra cola muestra «Calculado con 0 días de cola; hoy son 10 · Volver a calcular».
- **Cola con capacidad** (unidades por día en el área de conteo, que sugiera fechas según lo que ya está en cola): **no se construye ahora** (P-N2, recomendación: no). Si se pide, es un módulo aparte: lee las unidades por mes de conteo de todos los embarques y propone ingresos. El modelo de esta ficha ya lo admite, porque solo escribiría `fecha_ingreso_estimada` por las mismas funciones.

### 2.4 Lo al barrer: ingreso por paquete y en tandas (decisión 119)

**Qué tiene de especial.** Un lote al barrer no es un modelo con su GML: es mercadería de una marca que el flujo **reparte con el vector de la temporada del mes en que entra** (§0). Javier lo programa aparte porque procesarlo lleva más cola, y porque **cuándo** entra decide **cómo se reparte**: el mismo lote se distribuye distinto en verano que en invierno.

**Cómo se programa.** Con un **paquete** con ingreso propio. Los paquetes ya son la subdivisión del embarque (decisión 98, Javier a) y ya llevan asignaciones por unidades.

- **El mes de una asignación es el de su paquete**, si el paquete tiene ingreso. Si no, es el del embarque (I2 generalizada, §2.8).
- **Mover a un paquete con otro mes**, o fijarle o cambiarle el ingreso, **mueve entregas**, igual que cambiar la fecha de un embarque. Pasa por la vista previa y la huella del plan, y si cambia la temporada **reparte de nuevo** con la misma versión de M12 (R6 de 08b, decisión 86; avisos `cambia_temporada` y `reparto_sin_vector`). Si hay recepciones vinculadas, `asignacion_con_recepciones`.
- **En tandas.** Para que 1 000 u de un lote entren 500 en abril y 500 en mayo: dos paquetes (por ejemplo «Al barrer · tanda 1» y «tanda 2») con su ingreso, y se reparten las unidades. Por eso **`mover_a_paquete` acepta unidades por asignación** (hoy mueve asignaciones enteras). Es el mismo reparto por unidades que ya hace asignar.
- **Sugerencia, no automatismo.** En el detalle del embarque, **«Programar lo al barrer»** propone un paquete con ingreso = conteo + `dias_cola_ingreso_barrer` y lista los lotes al barrer del embarque, con sus unidades editables para moverlos ahí. Nada se mueve solo. Una línea al barrer no cambia de paquete por ser al barrer.
- **Lo que no cambia**:
  - Puerto y conteo siguen siendo del embarque.
  - El paquete no tiene «ya ocurrió» propio.
  - Recibir (08b-2) sigue siendo por embarque, y cada recepción lleva su propio mes X, que es lo que de verdad cuenta al confirmar.

### 2.5 Causas de reprogramación (zod `CAUSAS_FECHA`, en `tipos.ts`)

| Valor | En pantalla |
|---|---|
| `pago` | Demora en el pago al proveedor |
| `produccion` | El proveedor no terminó a tiempo |
| `naviera` | Naviera, zarpe o transbordo |
| `aduana` | Aduana |
| `transporte` | Transporte local (puerto → CD) |
| `cola_conteo` | Cola en el área de conteo |
| `programacion` | Programación del ingreso (decisión propia, p. ej. soltar lo al barrer más tarde) |
| `correccion` | Corrección de un dato mal puesto (no es atraso) |
| `otro` | Otro (el motivo lo explica) |

Las reprogramaciones con causa `correccion` o `programacion` **no cuentan como atraso** en el contador visible, aunque quedan en el historial.

### 2.6 Pagos: causa, no campo (decisión 118, confirmada por Javier)

El pago es por compra y proveedor, y un embarque consolida varios. Se registra como la causa `pago` de cada reprogramación. No se modela un pago.

### 2.7 Compras con viaje pero sin embarque ni mes: el «Por dividir» del viaje (decisión 117)

**Situación** (Javier, P1). Las compras de COTV traen **viaje** y no traen mes. Después se dividen en dos embarques según el **almacén de origen** del proveedor (California o Nueva York), cada uno con sus fechas.

**Diseño.** Cada viaje puede tener **un** embarque provisional, `es_provisional = true`, que se muestra como «**Por dividir**», no como un embarque logístico.

- Lo crea quien carga, con la **llegada a conteo provisional** que Javier estime para el viaje. Es la única fecha que pide, y el ingreso se calcula como en cualquier embarque.
- Sus compras **cuentan en el flujo en ese mes provisional**: así Huecos no muestra un hueco falso que lleve a comprar dos veces.
- **Se divide pasando unidades a los embarques reales** con «Pasar pendientes», que gana unidades por asignación. Las unidades **se mueven** de una asignación a otra dentro de la misma línea: el total de la línea no cambia (I3) y por eso **no hay doble conteo**. Lo que se pasa toma el mes del embarque real (I2). Lo que todavía no se dividió sigue en el mes provisional.
- **Una línea se divide entre los dos embarques por unidades.** Ya está soportado: una asignación es (entrega, embarque, paquete, unidades), y una entrega se reparte entre varias (I1). Si los dos embarques caen en meses distintos, la entrega se separa en dos entregas de la línea (08b §3.4, caso 17). Queda confirmado contra `aplicar_movimiento_agrupador` de la `0036`: los movimientos llevan unidades, y la invariante I1 es la que limita.
- **Qué lo diferencia de un embarque normal**:
  - No tiene salida, puerto ni «ya ocurrió».
  - No sale en la lista de Embarques ni cuenta en «Atrasados». Sale en el detalle del viaje y en Sin agrupador.
  - Su aviso propio es `provisional_vencido`: «El mes provisional ya pasó: divide o reprograma».
  - No se puede asignar un paquete ni recibirlo. Si llega `recibir` (08b-2), da `409 embarque_provisional`.
  - Mover su fecha usa el mismo diálogo, con motivo y causa.
- **Por qué un embarque marcado y no un mes en el viaje.** Hay tres razones:
  - Reutiliza todo lo que ya existe: mover la fecha con vista previa, repartos de lotes, historial, candados y «Pasar pendientes».
  - La alternativa (un mes provisional en `compra_viajes` y entregas sueltas «sin embarque» en ese mes) obligaba a escribir una operación nueva de movimiento a nivel de viaje, con su propio orden de candados, reparto de lotes y eventos.
  - *Descartado también*: entregas sin mes (dejan al flujo ciego y tocan M8, versión 1 §2.7).
- **Origen (California o Nueva York): un dato del embarque, `origen`, texto con sugerencias.** No es `puerto_embarque`: el almacén de Nueva York puede embarcar por otro puerto, y Javier divide por almacén. No es un maestro todavía, porque hoy son dos valores y un maestro pide pantalla, permisos y pruebas. Si más adelante cada proveedor tiene sus almacenes, el lugar natural es la ficha del proveedor de la 08c (`region` ya guarda el estado de EE. UU. desde COTV, 08c §12.2 a).
- **Sugerencia de división.** «**Dividir por origen…**» en el Por dividir del viaje propone, para cada compra, el embarque del viaje cuyo `origen` coincide con la región de su proveedor. Esto funciona **solo cuando exista la 08c**; antes, se elige a mano. Unidades editables y vista previa. Se aplica con **una** llamada por embarque de destino.

**Importador de compras con esto** (§3.6): una fila con `VIAJE` y sin `LLEGADA`, `ENTREGAS` ni `EMBARQUE` va al Por dividir de ese viaje, en su mes.

### 2.8 Invariantes

- **I1, I3, I4 e I5** de 08b, sin cambios.
- **I2 (generalizada)**: `entrega.periodo = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)` para las asignaciones activas que toca el plan.
- **`agrupadores_desalineados()`** se reemplaza con la misma regla. En el humo se exige `= 0` antes y después de aplicar la `0038`.

| | Invariante nueva | Dónde |
|---|---|---|
| **I6** | Un cambio de fechas que no cambia el mes de ninguna asignación no bloquea compras, no sube `compras.revision`, no escribe en `compra_eventos` y deja `flujo_huella_base()` igual | Función y humo |
| **I7** | Si `hito_confirmado` no es nulo, las fechas de ese hito y de los anteriores no son nulas, y el estado no es `planificado`. Un embarque provisional no tiene `hito_confirmado` | Función y humo |
| **I8** | Todo cambio de fecha, de ingreso de paquete o de `hito_confirmado` deja un evento con la foto antes y después. Si reprograma, lleva motivo y causa | Función y humo |
| **I9** | A lo sumo un embarque provisional por viaje (índice único parcial). Un provisional siempre tiene viaje y es de tipo `importacion` | Índice y función |

### 2.9 Funciones de la `0038`

Todas con `create or replace` **a partir de su versión vigente** (la `0036` para las de agrupadores), con la misma firma, `security invoker`, `search_path = ''`, `revoke`/`grant` a `service_role` y `comment on` nuevo. Los candados siguen siendo los de la `0036`: viajes y embarques `for no key update`, compras `for update`, en orden viajes → embarques → compras.

| Función | Cambio |
|---|---|
| `agrupador_foto_embarque(uuid)` | Suma puerto, ingreso, `ingreso_programado`, `hito_confirmado`, `origen`, `es_provisional` y el ingreso de cada paquete |
| `guardar_embarque` | **Al crear**: las fechas (conteo obligatorio: `fecha_requerida`), el ingreso calculado con la cola, `origen` y `es_provisional` (exige viaje: `provisional_sin_viaje`; si ya hay uno, `provisional_existente`). **Al editar**: no escribe ninguna fecha y conserva la de la fila. Hoy, si la API no manda la salida, la vacía (§10, punto 5). Una fecha distinta de la vigente da `fecha_por_movimiento` |
| `guardar_paquete` | Rechaza crear paquetes en un provisional (`embarque_provisional`). El ingreso del paquete **no** se toca aquí: va por movimiento |
| `aplicar_movimiento_agrupador` | Tres cambios. (1) `cambiar_fecha` se amplía (§2.10). (2) `mover_a_paquete` puede mover meses y acepta unidades. (3) I2 generalizada en la comprobación final, también para `mover_a_paquete`. `pasar_pendientes` acepta unidades parciales, que el plan ya manda por movimiento. Un plan viejo se comporta como hoy |
| `cambiar_estado_agrupador` | `volver_a_planificado` con `hito_confirmado` → `409 hito_confirmado`. Pasar a `en_transito` un provisional → `embarque_provisional` |
| `importar_agrupadores` | Columnas nuevas (§3.5), con `fecha_ingreso_estimada` calculada con la cola si no viene. La clave natural sin código sigue siendo (nombre, conteo). Solo crea |
| `agrupadores_desalineados()` | I2 generalizada |
| **`agrupador_hitos_resumen(p_embarques uuid[])`** (nueva, `stable`) | Por embarque y hito, más el ingreso de cada paquete: fecha original (la primera no nula en los eventos), reprogramaciones (sin contar `correccion` ni `programacion`) y la última causa |

**Plan B, si `vector-two` no es Postgres 17.** No se cambia la expresión de `periodo_llegada`: `fecha_llegada_estimada` pasa a guardar el **ingreso** (lo que manda) y se suma `fecha_conteo_estimada`. Lo existente se corrige con una llamada a la función por embarque, que pone conteo = valor viejo y causa `correccion`, sin mover nada, porque la cola inicial es 0. Esa corrección la hace `datos`, no la migración. Es peor porque la columna cambia de significado y la plantilla vieja quedaría al revés; por eso solo es plan B.

### 2.10 `cambiar_fecha` ampliada

El plan lo arma `planCambiarFechas`, puro, en `movimiento.ts`:

```
{ operacion: 'cambiar_fecha', motivo, causa, resumen,
  embarques: [{ id, revision,
                fecha_salida_estimada?, fecha_puerto_estimada?,          // clave presente = valor nuevo (null = vaciar)
                fecha_llegada_estimada?,                                  // conteo (nunca null)
                fecha_ingreso_estimada?, ingreso_programado?,             // ingreso a mano, o null + false = recalcular
                hito_confirmado? }],
  paquetes: [{ id, fecha_ingreso_estimada }],                             // ingreso propio (null = hereda)
  compras: [...], movimientos: [...], entregas: [...], repartos: [...] }  // solo si cambia algún mes
```

Pasos de la función:

1. Bloquea los embarques. Calcula los valores finales, incluido el ingreso derivado (conteo + cola, leída de `flujo_parametros` bajo la misma transacción).
2. Sin cambios → `sin_cambios`.
3. **Si reprograma** (cambia o vacía una fecha con valor, cambia el ingreso de un paquete o baja `hito_confirmado`), exige motivo y causa (`motivo_requerido`, `causa_requerida`). Completar una fecha vacía, confirmar un hito o que el ingreso **derivado** siga al conteo no cuentan como reprogramación propia.
4. **Estados.**
   - El conteo y el ingreso solo cambian en `planificado` o `en_transito`.
   - Salida, puerto y `hito_confirmado` también cambian en `recibido`.
   - En `cancelado`, nada.
   - En un provisional, solo el conteo y el ingreso.
5. **Bloqueos.** Salida ≤ conteo (el check de la base) con los valores finales. Un hito confirmado necesita su fecha y las anteriores, y no puede ser futuro (`fecha_requerida`, `fecha_futura`). Confirmar con el embarque `planificado` lo pasa a `en_transito` (`pasa_a_en_transito`).
6. **Recepciones vinculadas** (08b-2): si cambia el mes de una asignación con recepciones → `embarque_con_recepciones` o `asignacion_con_recepciones`.
7. **Mes sin cambios** en ninguna asignación: se escribe el embarque, sube su `revision`, queda **un** evento y no se bloquea ninguna compra (I6).
8. **Mes con cambios**: el camino de hoy (bloquear compras derivadas, comparar `revision`, `agrupador_mover_entregas`, I1 a I3, I2 generalizada, I5 y eventos solo en las compras que cambiaron).

## 3. Contratos de API

Los guards y la forma son los de 08b §3. **Todo es `requireUser`** (decisión 92), salvo los parámetros de cola, que van con `requirePlanner`, como el resto de `flujo_parametros`.

### 3.1 Esquemas zod (`src/lib/compras/agrupadores/esquemas.ts`)

```ts
const HITOS_CONFIRMABLES = ["embarque", "puerto", "conteo"] as const;
const CAUSAS_FECHA = ["pago","produccion","naviera","aduana","transporte","cola_conteo","programacion","correccion","otro"] as const;

cambiarFechasSchema = z.strictObject({
  revision: z.number().int().min(0).max(MAX_REVISION),
  fecha_embarque: fechaIso.nullable().optional(),      // → fecha_salida_estimada
  fecha_puerto: fechaIso.nullable().optional(),        // → fecha_puerto_estimada
  fecha_conteo: fechaIso.optional(),                   // → fecha_llegada_estimada (nunca null)
  fecha_ingreso: fechaIso.nullable().optional(),       // fecha = programar a mano; null = volver a calcular (conteo + cola)
  hito_confirmado: z.enum(HITOS_CONFIRMABLES).nullable().optional(),
  motivo: z.string().trim().min(1).max(300).optional(),
  causa: z.enum(CAUSAS_FECHA).optional(),
  huella_plan,
}).refine(v => ["fecha_embarque","fecha_puerto","fecha_conteo","fecha_ingreso","hito_confirmado"].some(k => k in v), "sin_cambios");

ingresoPaqueteSchema = z.strictObject({ revision_embarque: z.number().int().min(0), fecha_ingreso: fechaIso.nullable(),   // null = hereda del embarque
  motivo: z.string().trim().min(1).max(300).optional(), causa: z.enum(CAUSAS_FECHA).optional(), huella_plan });

// Cambios en esquemas existentes:
guardarEmbarqueSchema += { fecha_puerto_estimada?, fecha_ingreso_estimada? (programa a mano al crear), origen: z.string().trim().max(80).nullable().optional(),
                           provisional: z.boolean().optional() };   // fecha_llegada_estimada sigue obligatoria al crear: es el CONTEO
moverAPaqueteSchema.asignaciones: z.array(z.union([z.uuid(), z.strictObject({ id: z.uuid(), unidades: z.number().int().positive() })]))
                    + motivo?, causa?, huella_plan   // obligatorios solo si el movimiento cambia de mes (lo decide el servidor)
pasarPendientesSchema.asignaciones: ídem, con unidades opcionales por asignación
parametrosFlujoSchema += { dias_cola_ingreso: z.number().int().min(0).max(365), dias_cola_ingreso_barrer: z.number().int().min(0).max(365).nullable() }
```

**La API habla con nombres de hito** (`fecha_embarque`, `fecha_puerto`, `fecha_conteo`, `fecha_ingreso`), y `consultas.ts` los traduce a las columnas.

### 3.2 Rutas

| Ruta | Método | Guard | Cuerpo | `{ data }` | Errores |
|---|---|---|---|---|---|
| **`/api/compras/embarques/[id]/fechas`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `cambiarFechasSchema` | `PlanFechasApi` o `RespuestaMovimientoApi` + `avisos` | 400; 404; 409 `sin_cambios`, `motivo_requerido`, `causa_requerida`, `salida_despues_de_llegada`, `fecha_requerida`, `fecha_futura`, `embarque_no_editable`, `embarque_con_recepciones`, `agrupador_cambio`, `plan_cambio`, `max_entregas`, `reparto_sin_vector` |
| **`/api/compras/paquetes/[id]/ingreso`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `ingresoPaqueteSchema` | ídem | Los anteriores más `asignacion_con_recepciones` y `embarque_provisional` |
| `/api/compras/embarques/[id]/fecha` (existe) | POST | `requireUser` | sin cambios | ídem | **Alias por una versión**: equivale a `/fechas` con `fecha_conteo` y `causa = 'otro'`. Hoy esa ruta cambia la «llegada», que es el conteo, así que el significado se conserva |
| `/api/compras/embarques` | POST | `requireUser` | alta con fechas, `origen` y `provisional` | `{ embarque }` | más `provisional_existente`, `provisional_sin_viaje` |
| `/api/compras/embarques/[id]` | PATCH | `requireUser` | sin fechas (`origen` sí) | `{ embarque }` | `409 fecha_por_movimiento`. Una fecha ausente ya no se vacía |
| `/api/compras/embarques/[id]/paquete` (mover a paquete) | POST (`?previsualizar=1` nuevo) | `requireUser` | `moverAPaqueteSchema` ampliado | ídem | más `asignacion_con_recepciones`, `motivo_requerido`, `causa_requerida`, `plan_cambio`, `reparto_sin_vector` |
| `/api/compras/embarques/[id]/pasar-pendientes` | POST | `requireUser` | ampliado con unidades | ídem | más `excede_pendiente` (unidades > pendiente) |
| `/api/compras/embarques/[id]/estado` | POST | como hoy | — | — | más `hito_confirmado`, `embarque_provisional` |
| `/api/compras/embarques` | GET | `requireUser` | más `reprogramados=1`, `origen`, `provisionales=1` (por defecto se excluyen); `atrasados=1` = algún hito vencido | `{ embarques }` con `hitos` | — |
| `/api/compras/agrupadores/provisionales` (nueva) | GET | `requireUser` | `?viaje_id` | `{ meses: { periodo, unidades, compras, viajes[] }[] }` | — |
| `/api/flujo/parametros` | GET · PUT | como hoy | más los dos campos de cola | — | — |

### 3.3 Tipos (`tipos-api.ts`)

```ts
type Hito = "embarque" | "puerto" | "conteo" | "ingreso";
HitoApi { hito; fecha: string | null; confirmado: boolean; fecha_original: string | null; retraso_dias: number | null;
          reprogramaciones: number; vencido: boolean; manda_el_mes: boolean;
          calculado?: { dias_cola: number; cola_vigente: number } }        // solo 'ingreso' cuando no está programado a mano
EmbarqueApi += { hitos: HitoApi[]; hito_confirmado; ingreso_programado; origen; es_provisional; reprogramaciones_total;
                 proximo_hito: { hito, fecha, vencido } | null }
PaqueteApi  += { fecha_ingreso: string | null; periodo_ingreso: string | null; ingreso_propio: boolean; lotes_al_barrer: number }
PlanFechasApi = PlanMovimientoApi & { cambios: { hito | 'ingreso_paquete', paquete?, antes, despues, dias }[];
                                      meses: { de, a, unidades }[]; reprograma: boolean; avisos }
```

`fecha_salida_estimada` y `fecha_llegada_estimada` **se conservan** en `EmbarqueApi` (Excel, importador, avisos). En pantalla, la segunda pasa a leerse «Llega a conteo».

### 3.4 Avisos nuevos

| Aviso | Texto |
|---|---|
| `orden_de_fechas` | «El ingreso al stock (12-nov) es anterior a la llegada a conteo (15-nov)» |
| `hito_vencido` | «Debía llegar a puerto el 08-nov (hace 4 días): ¿ya llegó?». En la lista reemplaza a `atrasado`, que queda como el caso del ingreso |
| `cola_desactualizada` | «Calculado con 0 días de cola; hoy son 10» |
| `pasa_a_en_transito` | — |
| `provisional_vencido` | — |
| `mes_provisional` | En el detalle de la compra y en el reporte del importador: «Por dividir · mes provisional feb-27» |
| `compra_sin_mes_propio` | En el importador: «toma el mes de ingreso del Embarque 261101» |

### 3.5 Importador de agrupadores (08b §3.11)

| Columna | Embarque | Nota |
|---|---|---|
| `FECHA_SALIDA` | opcional | Como hoy |
| **`FECHA_PUERTO`** | opcional | Se ignora en `LOCAL`, con aviso |
| **`FECHA_CONTEO`** | **obligatoria** | **`FECHA_LLEGADA` se acepta como sinónimo**: es lo que ya significaba. Los archivos y las plantillas viejas siguen sirviendo |
| **`FECHA_INGRESO`** | opcional | Vacía = conteo + cola. Con valor, ingreso programado a mano |
| **`ORIGEN`** | opcional | ≤ 80 |
| **`PROVISIONAL`** | opcional (`SI`/vacío) | Exige `VIAJE`. Uno por viaje (`provisional_existente`, también dentro del mismo archivo: `provisional_repetido`) |

`igual` o `cambiada` compara también las columnas nuevas; una columna ausente en el archivo cuenta como «no dice nada». Sigue solo creando (decisión 97). La plantilla y la hoja `AGRUPADORES` del Excel usan `FECHA_CONTEO`.

### 3.6 Importador de compras (08b §3.9, regla 3)

1. **Con `EMBARQUE`** y sin `LLEGADA` ni `ENTREGAS`: una entrega en el mes del embarque, con aviso `compra_sin_mes_propio`. El embarque tiene que estar `planificado` o `en_transito` y no ser provisional. Si no lo cumple: `embarque_desconocido` o `embarque_no_editable`.
2. **Con `VIAJE`**, sin `EMBARQUE`, `LLEGADA` ni `ENTREGAS`: una entrega en el mes del **Por dividir** del viaje, asignada a él, con aviso `mes_provisional`. Si el viaje no tiene Por dividir, la fila se omite con `viaje_sin_por_dividir` («Crea el "Por dividir" del viaje con su mes provisional»).
3. **Con `LLEGADA`**: como hoy. Si además trae `EMBARQUE`, la llegada tiene que caer en su mes (`llegada_distinta_del_embarque`).
4. **Sin nada de lo anterior**: `llegada_invalida`, con el texto «Indica LLEGADA, ENTREGAS, un EMBARQUE o un VIAJE con "Por dividir"».
5. **Huella** (`huellaContenido`). En los casos 1 y 2 las entregas de la huella llevan el **texto del archivo**, `[["EMBARQUE:<código>", u]]` o `[["POR_DIVIDIR:<viaje>", u]]`, y no el mes resuelto. Así, reimportar después de reprogramar o de dividir sigue dando `igual`. Es la única excepción a «las columnas de agrupador no entran en la huella», porque aquí reemplazan a `LLEGADA`.
6. **Tres llamadas en tres transacciones** (08b §3.9): `importar_compra` (ya con el mes), `asignar_viaje_compras` y `aplicar_movimiento_agrupador` (asignar al embarque o al Por dividir). Un corte entre la primera y la tercera deja la compra en el mes correcto pero sin embarque. Reimportar lo completa. `importar_compra` no cambia.

### 3.7 Flujo y Huecos

- **El método del flujo no cambia** (`VERSION_METODO_FLUJO` igual). Sigue leyendo entregas. Lo único que lo mueve es un cambio de **mes** de una asignación (I5, revisiones, huella).
- **Banner nuevo** en Flujo mensual y en Huecos, solo si hay compras por dividir: «Incluye 1 000 u con mes provisional (feb-27, viaje 261001, por dividir) · Ver». Lo lee `/api/compras/agrupadores/provisionales`. **No toca `src/lib/flujo/**`**: la página lo pide aparte, y así se respeta la regla de 08b de que agrupadores no importa flujo.

## 4. Pantallas (kit de Vector2; `es-PE`; 390 px; lenguaje llano)

Nombres fijos en toda la pantalla: **Sale · Llega a puerto · Llega a conteo · Ingresa al stock**.

### 4.1 Alta y edición de embarque

- **Campos**: Sale, Llega a puerto (oculto en `local`), **Llega a conteo** (obligatorio), **Ingresa al stock** y **Origen** (con sugerencias).
- **Ingresa al stock** se muestra calculado: «25-nov · conteo + 10 días de cola», con un enlace **«Programar a mano»**.
- **Nota** ⓘ: «El ingreso al stock decide el mes en que la mercadería cuenta en el flujo».
- **Editar** (`PATCH`) ya no tiene fechas: las muestra de solo lectura con el botón **«Cambiar fechas»**.

### 4.2 Diálogo «Fechas del embarque»

| Hito | Ahora | Nueva | ¿Ya ocurrió? |
|---|---|---|---|
| Sale | 05-oct ✓ | — | ☑ |
| Llega a puerto | 08-nov | [18-nov] | ☐ |
| Llega a conteo | 15-nov | [22-nov] | ☐ |
| Ingresa al stock (manda el mes) | 25-nov *(conteo + 10 d)* | → **02-dic** *(sigue al conteo)* · [Programar a mano] | al recibir |

- **El ingreso sigue al conteo en vivo** mientras no esté programado a mano. **«Volver a calcular»** aparece solo si está programado.
- **Motivo y causa**: solo si se reprograma.
- **Vista previa**:
  - «El ingreso pasa de 25-nov a 02-dic. **Cambia el mes: mueve 12 líneas de 5 compras de nov-26 a dic-26.** El paquete "Al barrer" tiene ingreso propio (15-ene) y no se mueve.»
  - O bien: «Estas fechas no cambian el mes: el flujo no se mueve».
- **Mensajes**:
  - «Este embarque ya tiene ingresos confirmados: el mes no se puede cambiar.»
  - «No puedes marcar como ocurrida una fecha futura.»
  - «Cambió el embarque mientras editabas: vuelve a abrirlo.»

### 4.3 Línea de tiempo (detalle del embarque)

- **Los cuatro hitos** con una marca de «hoy». Cada uno muestra:
  - estado: ✓ ocurrió, previsto o **vencido** («hace 4 días»);
  - retraso contra lo planeado al crear («+10 d»);
  - número de cambios («2 cambios», enlazado al historial).
- **Debajo de «Ingresa al stock»**, los **paquetes con ingreso propio**: «Al barrer · tanda 1 → 15-ene (dic → ene) · 600 u de 2 lotes».
- **A 390 px**, en vertical.

### 4.4 Paquetes y lo al barrer

- **En cada paquete**: «Ingreso: hereda del embarque (25-nov)» o «Ingreso propio: 15-ene», con **«Programar ingreso…»** (motivo, causa y vista previa con temporada: «2 lotes al barrer cambian de temporada: verano → invierno, se reparten de nuevo con la versión 3»).
- **«Mover a paquete»**: unidades editables por asignación, con vista previa si cambia de mes.
- **«Programar lo al barrer»**: propone el paquete «Al barrer» con ingreso = conteo + cola al barrer y lista los lotes al barrer con sus unidades. Para tandas, **«Agregar otra tanda»** crea un segundo paquete y reparte unidades. La suma queda a la vista: «Asignado 1 000 de 1 000 u».

### 4.5 Viajes y el «Por dividir»

- **Detalle del viaje**, bloque **«Por dividir»**: «Mes provisional: feb-27 (conteo estimado 05-feb) · 1 000 u de 3 compras».
  - Acciones: **Cambiar mes provisional** (el diálogo de fechas, solo conteo e ingreso), **Dividir en embarques…** y **Crear "Por dividir"** si el viaje no lo tiene.
- **«Dividir en embarques…»**:
  - una tabla por compra y línea, con columnas por embarque de destino del viaje («California», «Nueva York») y unidades editables;
  - la columna «Queda por dividir»;
  - la sugerencia «Dividir por origen» cuando exista la 08c;
  - la vista previa («550 u pasan a ene-27, 450 u a feb-27; quedan 0 por dividir»);
  - motivo prellenado «División por almacén» y causa `programacion`.
- **Sin agrupador** muestra también lo que está «Por dividir», con su viaje.

### 4.6 Lista de Embarques, Compras, Historial y Parámetros

- **Lista de Embarques**:
  - columnas Sale · Puerto · Conteo · **Ingresa al stock** (mes; «calculado» o «programado») · Origen · **Próximo hito** · **Reprogramado ×N**;
  - filtros Atrasados, Reprogramados y Origen;
  - los provisionales no salen (filtro «Ver por dividir»);
  - en el celular, tarjetas.
- **Detalle de compra**: el chip por entrega «Embarque 261101 · ingresa 02-dic · reprogramado ×2» o «Por dividir · feb-27 (provisional)».
- **Historial**, en llano y por hito:
  - «C1 cambió las fechas · Causa: Aduana · "Aforo físico" · Conteo 15-nov → 22-nov · Ingreso 25-nov → 02-dic (sigue al conteo; movió 5 compras de nov a dic)»;
  - «C2 programó el ingreso del paquete Al barrer: 15-ene (causa: Programación)».
- **Parámetros del flujo** (admin y planner): «Días de cola entre conteo e ingreso» y «Días de cola de lo al barrer (vacío = los mismos)», con la nota «No cambia los embarques ya programados».

### 4.7 Qué ve cada rol

- **Los tres roles**: todo lo de esta ficha.
- **Solo admin y planner**: los parámetros de cola y lo que ya lo era (cancelar, cerrar, reabrir).

## 5. Reglas de negocio (con su prueba en vitest)

| # | Regla |
|---|---|
| F-R1 | Mes de un embarque = mes de `coalesce(real, ingreso, conteo)`, en la columna y en TS. El mes de una asignación es el de su paquete, si tiene ingreso propio, o el del embarque (I2 generalizada). Cambiar salida, puerto o `hito_confirmado` nunca toca compras (I6) |
| F-R2 | Ingreso derivado = conteo + cola vigente al escribir (0 → `null`). Sigue al conteo mientras `ingreso_programado = false`. Cambiar la cola en parámetros no mueve nada |
| F-R3 | Reprogramar exige motivo y causa. Completar, confirmar o que el ingreso derivado siga al conteo, no |
| F-R4 | Salida ≤ conteo bloquea. Cualquier otro desorden (incluido ingreso < conteo) solo avisa |
| F-R5 | Confirmar un hito es secuencial, con fecha no futura, y pasa el embarque a en tránsito. Volver a planificado con un hito confirmado da `hito_confirmado` |
| F-R6 | El ingreso de un paquete o el movimiento a un paquete con otro mes mueve entregas, reparte de nuevo los lotes si cambia la temporada (misma versión) y respeta las recepciones vinculadas |
| F-R7 | `mover_a_paquete` y `pasar_pendientes` aceptan unidades parciales, y `Σ` de la línea no cambia (I3) |
| F-R8 | Un Por dividir por viaje. No admite paquetes, en tránsito ni recibir. No sale en Atrasados. Dividirlo mueve unidades sin duplicarlas |
| F-R9 | Reprogramaciones y retraso se derivan de los eventos, sin contar `correccion` ni `programacion` |
| F-R10 | `PATCH` no cambia ni vacía fechas |
| F-R11 | Importador de compras: las reglas 1 a 6 de §3.6, con la huella del texto del archivo |
| F-R12 | Importador de agrupadores: `FECHA_CONTEO` (o `FECHA_LLEGADA`) obligatoria; ingreso calculado si viene vacío; un `PROVISIONAL` por viaje |
| F-R13 | La `0038` no mueve nada: mismas `periodo_llegada`, entregas y asignaciones, y `agrupadores_desalineados() = 0` antes y después |

### Casos numéricos

**Supuestos del fixture de 08b**: hoy es **2026-11-12**, `k' = 2026-09` y temporadas por defecto (verano oct–mar, invierno abr–sep). En las pruebas, **`dias_cola_ingreso = 10`** y **`dias_cola_ingreso_barrer = 30`** (valores de prueba, no propuestos).

**Datos de partida**:

- **261101**: importación, viaje 261001. Sale 05-oct, puerto 08-nov y conteo 15-nov, así que el ingreso calculado es **25-nov** (nov-26). Contiene l1 de C-000101 (nov 300) y C-000102 POLO (nov 400).
- **270301**: conteo 05-mar-27, así que el ingreso es 15-mar-27 (mar). Contiene l2 de C-000101, el lote BETA de 1 000 u (mar 600 · abr 400, reparto v2).

| # | Acción | Resultado esperado |
|---|---|---|
| F1 | Crear con conteo 15-nov y cola 10 | Ingreso 25-nov (calculado), mes nov, código `2611##` (por el conteo). Con cola 0, ingreso `null` y mes nov. Sin conteo → `fecha_requerida` |
| F2 | Aplicar la `0038` sobre el fixture de 08b cargado | Ingreso `null` en todos y meses iguales (cae al conteo). Entregas y asignaciones intactas. `agrupadores_desalineados() = 0`. Aplicarla dos veces no da error |
| F3 | C1 cambia el conteo de 261101 a 22-nov (causa `aduana`) | El ingreso sigue: 02-dic. **Cambia el mes**: l1 nov 300 → dic, que se funde con la dic 200 (`entregas_fusionadas`). POLO nov 400 → dic 400. `revision` +1 en las dos compras. Un evento de embarque. Conteo: 1 reprogramación y +7 d |
| F4 | Programar a mano el ingreso de 261101 en 28-nov (causa `cola_conteo`) | Vuelve a nov: l1 nov 300 · dic 200 **con los mismos `id`** de entrega. `ingreso_programado = true` |
| F5 | Con el ingreso programado, mover el conteo a 30-nov | El ingreso queda en 28-nov y no se mueve nada. Aviso `orden_de_fechas` (ingreso < conteo) |
| F6 | «Volver a calcular» | Ingreso 10-dic (30-nov + 10). Mueve a dic. `ingreso_programado = false` |
| F7 | Cambiar el puerto de 08-nov a 18-nov (causa `naviera`) | Compras sin cambio y huella del flujo idéntica (I6). Puerto: 1 reprogramación y +10 d |
| F8 | Lo mismo sin causa, o sin motivo | `causa_requerida` / `motivo_requerido`. Completar un puerto vacío no los pide |
| F9 | Paquete «Al barrer» en 270301 con ingreso = conteo + 30 = **04-abr-27**; mover las 600 u de l2 que están en mar | La entrega de mar desaparece y abr queda con 1 000 u, repartidas con **v2 e invierno**. Aviso `cambia_temporada` (verano → invierno). Si v2 no tiene vector de invierno, `reparto_sin_vector` y nada cambia |
| F10 | Tandas: 500 u en «tanda 1» (ingreso 04-abr) y 500 en «tanda 2» (ingreso 10-may) | l2 queda abr 500 · may 500 (cada una con el vector de invierno). Σ = 1 000 (I3) |
| F11 | Mover el conteo de 270301 a 20-mar con los paquetes ya programados | Lo sin paquete sigue al conteo (ingreso 30-mar, mar). Los paquetes con ingreso propio no se mueven |
| F12 | Ingreso de paquete con una recepción vinculada (en el humo se inserta como `postgres`), cambiando de mes | `asignacion_con_recepciones` |
| F13 | Viaje 261001: crear su Por dividir con conteo provisional 05-feb-27 (ingreso 15-feb, feb). Importar 3 filas `VIAJE = 261001` sin `LLEGADA`: C-000201 (Proveedor Norte, 300 u), C-000202 (Feria Sur, 500 u) y C-000203 (200 u) | Tres compras con entrega feb-27 asignada al Por dividir; aviso `mes_provisional`. Flujo de feb +1 000 u. Banner «Incluye 1 000 u con mes provisional» |
| F14 | Crear el embarque «California» (origen California, conteo 20-ene-27 → ingreso 30-ene) y «Nueva York» (conteo 05-feb → ingreso 15-feb). Dividir: C-000201 300 → California; C-000202 250 → California y 250 → Nueva York; C-000203 200 → Nueva York | ene-27 550 u y feb-27 450 u. Por dividir: 0. Σ por compra igual a antes (**sin doble conteo**). C-000202 queda con dos entregas (ene 250 · feb 250) |
| F15 | Reimportar el archivo de F13 | 3 `igual`. No se mueve nada |
| F16 | Un segundo Por dividir en 261001 | `provisional_existente`. Sin viaje, `provisional_sin_viaje`. Paquete en un Por dividir, `embarque_provisional` |
| F17 | Con hoy en 20-feb-27 y algo sin dividir | Aviso `provisional_vencido`. No sale en «Atrasados» |
| F18 | Fila con `EMBARQUE = 261101` y sin `LLEGADA` | Entrega en el mes del embarque. Reimportar después de F3 da `igual`. Sin `LLEGADA`, `ENTREGAS`, `EMBARQUE` ni `VIAJE`: `llegada_invalida` con el texto nuevo |
| F19 | Importar agrupadores con un archivo viejo (`FECHA_LLEGADA`) | Se lee como conteo y el ingreso se calcula. Reimportar da `igual`. Con `FECHA_INGRESO`, queda programado. Dos `PROVISIONAL = SI` del mismo viaje dan `provisional_repetido` |
| F20 | Salida 25-nov con conteo 22-nov | `salida_despues_de_llegada`. Si en el mismo envío el conteo pasa a 30-nov: OK |
| F21 | Marcar «ya llegó a puerto» con el puerto en 18-nov (futuro) | `fecha_futura`. Marcar «ya salió» con el embarque planificado: pasa a en tránsito. Volver a planificado: `hito_confirmado` |
| F22 | `PATCH` sin `fecha_salida_estimada` | La salida se conserva. Si trae una distinta: `fecha_por_movimiento` |
| F23 | Parámetros: un comprador hace PUT de la cola | `403`. Un admin pone 10: los embarques existentes no cambian y avisan `cola_desactualizada` |
| F24 | Alias `/fecha` | Igual que `/fechas` con solo el conteo |

**Concurrencia** (`tests/integracion/concurrencia.int.test.ts`; ninguna debe dar `40P01`):

- (a) `/fechas` con cambio de mes contra `asignar_viaje_compras`, con una compra compartida.
- (b) `/fechas` contra `guardar_embarque` del mismo embarque.
- (c) Ingreso de un paquete contra `guardar_paquete` del mismo embarque.
- (d) Dividir el Por dividir contra `importar_compra` sobre una de sus compras.
- (e) `/fechas` contra el PUT de parámetros de cola: la función lee la cola dentro de su transacción y gana el valor confirmado. La prueba fija que no hay error y que el ingreso queda con una de las dos colas, nunca mezclado.

**Humo `scripts/humo-0038.sql`**:

- Casos F2, F3, F4, F6, F7, F9, F12, F14 y F16, en SQL.
- I6 a I9.
- La expresión de `periodo_llegada` (`pg_get_expr`).
- Aplicar la migración dos veces.
- Privilegios.
- `migraciones_aplicadas`.

## 6. Criterios de aceptación / hito de prueba

- [ ] La `0038` aplica dos veces; humo en verde; tipos regenerados; F2 sin movimiento. `server_version_num ≥ 170000` anotado.
- [ ] lint, `tsc`, vitest (F1–F24 y los casos 1–19 de 08b sin tocarlos, salvo el texto de `llegada_invalida`) y build en verde. Concurrencia (a) a (e) sin `40P01`.
- [ ] **Javier**: poner la cola en parámetros. Crear un embarque con su llegada a conteo y ver el ingreso calculado. Programarlo a mano y volver a calcularlo. Reprogramar el conteo por «Aduana» y ver en Flujo mensual que las compras cambian de mes. Marcar «ya salió».
- [ ] **Lo al barrer**: «Programar lo al barrer» en un embarque con un lote, en dos tandas; ver el cambio de temporada en la vista previa y el lote en sus meses en el Flujo.
- [ ] **COTV**: crear el Por dividir de cada viaje con su mes provisional, importar las compras sin mes y ver el banner. Crear los embarques California y Nueva York con origen y fechas, dividir (una compra entre los dos) y comprobar que el total del flujo no cambió.
- [ ] Historial con causa y motivo, contador de reprogramaciones, Atrasados, todo a 390 px.
- [ ] `seguridad` (sonnet): guards (los parámetros con `requirePlanner`), IDOR de paquetes y asignaciones en `mover_a_paquete` y `pasar_pendientes` con unidades, funciones solo `service_role`, catálogos.

## 7. Decisiones propuestas (a registrar al construir; reemplazan las 115 a 118 de la versión 1)

| N.º | Decisión |
|---|---|
| 115 | **Cuatro hitos por embarque (sale, puerto, conteo, ingreso al stock), y el mes del flujo es el del ingreso.** `fecha_llegada_estimada` conserva su significado de origen (llegada al CD = área de conteo) y es la obligatoria. El ingreso es una columna nueva, nula = el conteo. `periodo_llegada = mes de coalesce(real, ingreso, conteo)`, cambiando la expresión de la columna generada (Postgres 17). Precisa la 83 |
| 116 | **Toda reprogramación lleva motivo y causa** (catálogo con `pago`); completar, confirmar o que el ingreso calculado siga al conteo, no. Contadores y retraso derivados de los eventos, sin contar `correccion` ni `programacion`. «Ya ocurrió» con `hito_confirmado` secuencial (Javier, P3). Los desórdenes avisan; solo salida > conteo bloquea |
| 117 | **Compras con viaje y sin mes: el «Por dividir» del viaje** (un embarque provisional por viaje, con mes provisional, que cuenta en el flujo). Se divide pasando **unidades** a los embarques reales, sin doble conteo. El origen (California o Nueva York) es un dato de texto del embarque. Matiza 08b §3.9 regla 3 y responde G2 de 08c §12.8 |
| 118 | **Pagos: causa de la reprogramación, no un campo** (Javier, P2) |
| 119 | **El ingreso se programa.** Por defecto, conteo + días de cola (`flujo_parametros`, general y al barrer, inicial 0); editable por embarque (`ingreso_programado`) y **por paquete**, que tiene ingreso propio; lo al barrer se programa por paquete y en tandas, y se reparte de nuevo con la temporada del mes nuevo (decisión 86). Cambiar la cola no mueve lo existente. Sin cola con capacidad por ahora. Levanta «fecha propia del paquete», que 08b §7 dejaba fuera, solo para el ingreso |

## 8. Plan de construcción

### 8.1 Antes de empezar

- **Lugar en el camino de compras**: 08b-1 ✔ → **08b-1b** → E1 → 08b-2 → E2 → E3.
  - Desbloquea la carga de compras de COTV (C2), que necesita el Por dividir.
  - 08b-2 se construye ya sobre «ingreso real» e I2 por paquete.
  - Nunca en paralelo con otra entrega de compras. La sugerencia «Dividir por origen» se enciende cuando cierre E1.
- **T1 de `datos`** (solo lectura en `vector-two`):
  - `show server_version_num` (≥ 170000; si no, el plan B de §2.9);
  - conteo de embarques, paquetes y asignaciones, para el antes y el después de F2;
  - poner al día el registro de PLAN §5, al que le faltan la `0035`, la `0036` y la `0037`.

### 8.2 Tandas

| Tanda | Agente | Depende de | Archivos | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Contratos | `backend` | — | `src/lib/compras/agrupadores/{tipos,tipos-api,esquemas}.ts`; esquema de parámetros en `src/lib/flujo/` (solo esa adición); `tests/agrupadores.fixture.ts` (casos F) y `tests/agrupadores.esquemas.test.ts` | `tsc` limpio |
| T1 · Datos | `datos` | — | `supabase/migrations/0038_fechas_logisticas_embarque.sql`, `scripts/humo-0038.sql`, `src/lib/supabase/database.types.ts`, PLAN §5 | Aplica dos veces; humo en verde; F2; `agrupador_hitos_resumen` < 50 ms con 500 embarques |
| T2 · Lógica pura | `backend` | T0 | `movimiento.ts` (`planCambiarFechas`, `planIngresoPaquete`, unidades en `mover_a_paquete` y `pasar_pendientes`, I2 por paquete), `periodoLlegada`, nuevos `hitos.ts` y `cola.ts`, `avisos.ts`, `importar.ts` (agrupadores), `plantilla.ts`, `excel.ts`; `src/lib/compras/importar.ts` (reglas 1, 2 y 5); pruebas `tests/agrupadores.{fechas,hitos,paquete-ingreso,por-dividir,importar}.test.ts` y `tests/compras.importar.test.ts` | F-R1 a F-R13 en verde; M8, M12 y 08b sin tocar sus pruebas |
| T3a · Pantallas | `frontend` | T0 | `modal-embarque.tsx`, `dialogo-fechas.tsx` (reemplaza `dialogo-fecha.tsx`), `linea-tiempo.tsx`, `modal-paquete.tsx` y `dialogo-a-paquete.tsx` (ingreso y unidades), `dialogo-programar-barrer.tsx`, `dialogo-dividir.tsx`, `detalle-viaje.tsx`, `lista-embarques.tsx`, `filtros-embarques.tsx`, `historial.tsx`, `insignias.tsx`, `pestana-sin-agrupador.tsx`; chip en el detalle de compra; banner en Flujo mensual y Huecos (componente nuevo en `src/components/compras/agrupadores/`, montado en las dos páginas); parámetros de cola en la pantalla de parámetros del flujo | build y `tsc` limpios; 390 px |
| T3b · Servicio y API | `backend` | T1, T2 | `consultas.ts`, `servicio.ts`; rutas `embarques/[id]/fechas`, `paquetes/[id]/ingreso`, `agrupadores/provisionales`; cambios en `embarques/[id]` (PATCH), `[id]/fecha` (alias), `[id]/paquete`, `[id]/pasar-pendientes`, `embarques/route.ts`, `flujo/parametros`; pruebas `tests/agrupadores.{handlers,estatico}.test.ts` y `tests/api.guards.roles.test.ts` | F-R3, F-R10, F23 y F24 en verde |
| T4 · Integración | `frontend` | T3a, T3b | Los de T3a | F3, F9, F13 y F14 a mano |
| T5 · Cierre | `qa` (con concurrencia), `seguridad` (sonnet), `documentador` | T4 | docs (08b §11, esta ficha §11, PLAN, CHANGELOG, DECISIONES 115–119, checklist), `src/lib/version.ts` | Hito con Javier |

**Versión sugerida**: `0.17.0 · M8 b`.

### 8.3 Riesgos

1. **`set expression` sobre `periodo_llegada`.**
   - *Riesgo*: si `vector-two` no es 17, falla.
   - *Mitigación*: T1 lo comprueba antes; plan B en §2.9.
2. **Reemplazar `aplicar_movimiento_agrupador` por tercera vez**, ahora con I2 por paquete y unidades parciales.
   - *Mitigación*: partir de la `0036`; diff acotado a `cambiar_fecha`, `mover_a_paquete` y la comprobación de I2; volver a correr los humos de la `0032`, `0034` y `0036`.
3. **Lotes al barrer que cambian de temporada** al programar su ingreso.
   - *Riesgo*: la vista previa debe decirlo siempre. Con la versión de M12 sin vector de la temporada nueva, no se puede programar (`reparto_sin_vector`).
   - *Mitigación*: Javier aprueba el vector en M12 antes.
4. **El Por dividir olvidado.**
   - *Riesgo*: queda contando en un mes que ya pasó.
   - *Mitigación*: `provisional_vencido` y el banner del flujo.
5. **El texto «Llegada»** en pantallas viejas.
   - *Riesgo*: ahora significa conteo y confunde.
   - *Mitigación*: prueba estática sobre `src/components/compras/agrupadores/**`; solo puede quedar en el sinónimo del importador.
6. **Recibir (08b-2) con paquetes con ingreso propio.**
   - *Riesgo*: su ficha debe fijar qué pasa con el ingreso real cuando el paquete entra en otra fecha que el resto del embarque.
   - *Propuesta*: cada recepción ya lleva su mes X, y «Registrar otra llegada» cubre la tanda posterior. Queda anotado para 08b-2.

## 9. Preguntas abiertas para Javier (nuevas; las cuatro anteriores ya están respondidas)

1. **Mientras no divides las compras de un viaje, ¿cuentan en el flujo en un mes provisional que tú pones para el viaje?** Por ejemplo: «este viaje llega a conteo hacia el 5 de febrero». *Recomendación: sí. Si no cuentan en ningún mes, Huecos te mostrará faltantes que ya compraste. Cuando las dividas entre California y Nueva York, cada parte toma el mes de su embarque y nada se cuenta dos veces.*
2. **La cola después del conteo: ¿basta con un número de días que tú ajustas (uno general y otro para lo al barrer), más mover a mano el ingreso cuando la cola se llena?** ¿O necesitas que el sistema calcule la cola según cuántas unidades se pueden contar por día? *Recomendación: los días ajustables ahora. Arrancan en 0 (como hoy) hasta que me digas cuántos son, y el cálculo por capacidad queda para más adelante si lo ves necesario.*
3. **Lo al barrer, ¿entra al stock todo junto en una fecha o lo sueltas por partes en varios meses?** *Recomendación: dejar las dos posibilidades. Lo al barrer va en un paquete con su propia fecha de ingreso, y si lo sueltas por partes, en dos o tres paquetes con fechas distintas. Así el flujo lo reparte con la temporada del mes en que de verdad entra.*

## 10. Contradicciones con lo construido o especificado

1. **Decisión 83 y 08b §2.4.** La «llegada al CD» mandaba el mes. Ahora manda el ingreso, y la llegada pasa a ser el conteo (115). **Respecto de la versión 1 de esta ficha** se invierte el mapeo: la columna vieja es el conteo, no el ingreso.
2. **08b §3.9, regla 3, y 08c §12.2 b / G2** exigían `LLEGADA` con `EMBARQUE`. Ahora el mes sale del embarque o del Por dividir del viaje (117).
3. **08b §7, «Fecha propia del paquete» fuera de alcance**, y 08b §3.3: `mover_a_paquete` «no mueve meses» y va con asignaciones enteras. Ahora el paquete tiene ingreso propio y mover a paquete puede mover meses y por unidades (119). Cambian I2 y R1 de 08b.
4. **«Avisos, no bloqueos».** Salida > conteo sigue bloqueando por el check de la `0032`.
5. **Defecto en lo construido.** `servicio.ts` (~ línea 943) manda `fecha_salida_estimada: … ?? null` y `guardar_embarque` (`0036`) la escribe sin condición. Un `PATCH` sin salida la borra sin motivo. Se corrige (F22).
6. **PLAN §5** no registra la `0035`, la `0036` ni la `0037`.
7. **La decisión 94 dice «siempre `for update`»**, pero la `0036` usa `for no key update` en viajes y embarques. Esta ficha sigue la `0036`.
8. **Decisión 97.** El importador de agrupadores no completa fechas de embarques existentes; se hace en pantalla.
9. **Convención «sin backfill».** Se respeta: nada se copia. `set expression` es un cambio de esquema, no de datos, pero reescribe la tabla. Se anota como la primera vez que el proyecto lo usa.

## 11. Fuera de alcance

- Cola con capacidad (unidades por día en conteo) que sugiera fechas (P-N2; módulo aparte).
- Maestro de almacenes de origen o almacenes por proveedor (más adelante, en la ficha del proveedor de la 08c).
- Fecha real por hito, salvo el ingreso (08b-2); seguimiento naviero o de aduana.
- Pagos como entidad (118).
- Entregas sin mes en M8.
- Conteo y puerto propios del paquete; «ya ocurrió» por paquete.
- Mover automáticamente lo existente al cambiar la cola.
- Que el importador de agrupadores edite o complete lo existente (decisión 97).
- Vista del flujo por embarque; el banner de provisionales es solo un total.
- Recibir y confirmar el ingreso: 08b-2.

## 12. Qué cambió respecto de la versión 1 (commit `0d5a1b8`)

| Tema | Versión 1 | Versión 2 | Por qué |
|---|---|---|---|
| Qué es `fecha_llegada_estimada` | Ingreso al stock (reinterpretada) | **Llegada a conteo** (su significado de origen) | Javier tiene la llegada a conteo (P4) |
| Ingreso al stock | La misma columna vieja, obligatoria | **Columna nueva** `fecha_ingreso_estimada`: calculada como conteo + cola o programada a mano; nula = conteo | «Hay cola y tengo que poder programar su ingreso» |
| `periodo_llegada` | Sin cambios | `set expression` a `coalesce(real, ingreso, conteo)` (Postgres 17; plan B) | Para que mande el ingreso sin mover nada al migrar |
| Cola | — | `dias_cola_ingreso` y `dias_cola_ingreso_barrer` en `flujo_parametros`, inicial 0; sin capacidad | Lo mínimo; la capacidad, pregunta N2 |
| Paquetes | Sin fecha | **Ingreso propio** y mover por unidades: lo al barrer en tandas, con nuevo reparto por temporada | «especialmente en lo que se comporta al barrer» |
| Compras sin mes | Embarque «por programar» genérico | **«Por dividir» del viaje** (uno por viaje, marcado, fuera de las listas logísticas) y división por unidades con «Pasar pendientes» | Traen viaje y se dividen por almacén (P1) |
| Origen | — | `compra_embarques.origen` (texto con sugerencias) | California o Nueva York |
| Causas | 8 | 9: se agregan `cola_conteo` y `programacion` (esta no cuenta como atraso); `conteo` pasa a `cola_conteo` | Programar no es atrasarse |
| Importadores | `FECHA_INGRESO` obligatoria; `FECHA_LLEGADA` sinónimo del ingreso | **`FECHA_CONTEO` obligatoria (`FECHA_LLEGADA` es su sinónimo)**, `FECHA_INGRESO` opcional, más `ORIGEN` y `PROVISIONAL`; compras con `VIAJE` sin mes van al Por dividir | Coherente con P4 y P1 |
| Decisiones | 115–118 | 115–119 (115 y 117 reescritas; 119 nueva) | — |
| Preguntas | P1–P4 | Respondidas; tres nuevas (mes provisional, cola con capacidad, tandas al barrer) | — |

# 08b-1b · Línea de tiempo de la compra, número de OC y fechas logísticas del embarque

> **Estado (2026-11-05): especificada, sin construir. Revisión 4 (cerrada)**: la revisión 3 (respuestas de Javier a las preguntas de la revisión 2, commit `573d865`) más dos pedidos posteriores de Javier: la **línea de tiempo por compra** y el **número de OC** editable sobre el código inicial de la compra. Es una mejora de 08b-1 (ficha [08b](08b-agrupadores-de-compras.md), que manda en todo lo que esta no cambie; su §11 describe lo construido). La diseñó el `arquitecto` (opus) leyendo las migraciones `0025`, `0032`, `0034` y `0036` (las versiones vigentes de las funciones de agrupadores son las de la `0036`), `src/lib/compras/**`, `src/components/compras/agrupadores/**` y el plan de carga de COTV (08c §12). **Antes de construir**: pasa por el `arquitecto-revisor` (opus). No quedan preguntas imprescindibles para Javier (§12).
>
> **Pedidos de Javier** (textuales):
> - «déjalo para completar y tiene que ser editable, la logística no siempre es tan previsible, se demoran los pagos, los embarques, la aduana. Deberíamos marcar fecha de embarque, fecha prevista en puerto, fecha prevista en el área de conteo, fecha prevista de ingreso al stock».
> - «Inicialmente una nueva compra a un proveedor debe iniciar con un código X, pero luego debo poder incluir el número de la OC».
> - «Me vas a matar, quisiera tener este detalle para la compra a cada proveedor: ⚪ Orden de Compra: 06/07/2026 · 🔵 Zarpe (Salida): Pendiente · 🔴 Arribo (Puerto): Pendiente · ⚫ Ingreso CD: 02/11/2026 · 🚀 Inicio Operativo: 05/11/2026 09:22 · Ingreso al stock».
>
> **Respuestas de Javier** (mandan sobre todo lo anterior):
> - **Revisión 1** (P1–P4): las compras de COTV traen viaje y se dividen en dos embarques según el almacén (California o Nueva York); el pago es una **causa** de retraso; «ya ocurrió» se marca; la fecha que él conoce es la **llegada al CD** y el ingreso al stock se programa, sobre todo lo al barrer.
> - **Revisión 2**: (1) «Yo lo divido inmediatamente por proveedor en cuanto lo cargues para que cuente en el mes. Inicialmente ponle a todo llegada en diciembre.» → §2.7. (2) «Yo defino la fecha esperada de ingreso.» → §2.4. (3) Lo al barrer: «Soportar las dos formas» → §2.5.
>
> **Qué cambió respecto de las revisiones anteriores**: §11.
>
> **Numeración.** Migración **`0038_fechas_logisticas_embarque.sql`** (la siguiente libre) con `scripts/humo-0038.sql`. Versión sugerida **`0.17.0 · M8 b`**. Decisiones propuestas **115 a 121** (§8; la siguiente libre después es la 122). Commits `M8:`.
>
> Sin datos reales: proveedores («Proveedor Norte», «Feria Sur»), compradores C1 y C2, admin A, embarques y cifras son inventados.

## 0. Punto de partida

**Qué hay en Vector2** (`0025` + `0032` + `0036`):

- **`compras.fecha_compra date not null`** (M8). La pone quien registra o la columna `FECHA_COMPRA` del importador. Es la fecha de la **Orden de Compra** de Javier.
- **`compras.numero text not null`** (M8): `C-000001`, de la secuencia `compras_numero_seq`, único e inmutable. Es el **«código X»** con que nace toda compra.
- **`compras.referencia text null`** (≤ 80). La escribe el importador y es **su clave de agrupación**: `clave_importacion = PROVEEDOR|REFERENCIA|LINEA` (normalizada) en cada línea, y `importar_compra` agrega líneas a la compra viva (no cancelada) del mismo proveedor y referencia (`upper(btrim)`), bajo candado consultivo. En la carga de COTV es `COTV-{id}`. No hay columna para el número de OC real.
- **`compra_embarques.fecha_salida_estimada date null`**. Se edita con `PATCH` (`guardar_embarque`), sin motivo, y no mueve entregas.
- **`compra_embarques.fecha_llegada_estimada date not null`**. Rotulada «**Llegada al CD**» (08b §2.4) y `FECHA_LLEGADA` en la plantilla del importador de agrupadores. Se cambia solo por `POST …/[id]/fecha` (`aplicar_movimiento_agrupador`, operación `cambiar_fecha`), con motivo, vista previa y huella del plan.
- **`fecha_llegada_real date null`**. La escribirá 08b-2.
- **`periodo_llegada`**. Columna generada: `make_date(año, mes, 1)` de `coalesce(fecha_llegada_real, fecha_llegada_estimada)`, con índice. Es el mes que alinea las entregas (I2 de 08b; decisión 83).
- **Check `compra_embarques_salida_llegada_check`** (salida ≤ llegada estimada). Bloquea con `409 salida_despues_de_llegada`.
- **Paquetes sin fecha propia** (08b §7). `mover_a_paquete` nunca mueve meses y mueve **asignaciones enteras**.
- **Asignar ya reparte por unidades** (`asignarEntregasSchema.items[].unidades`; 08b §3.4): si el embarque cae en otro mes, esas unidades **pasan** a la entrega de ese mes **en la misma línea**, y la función comprueba al final que `Σ entregas = unidades de la línea` (I3). «Agregar compras» del detalle del embarque ya filtra por viaje, mes y **proveedor**, tiene «Marcar las visibles» y unidades editables; «Sin agrupador» filtra por proveedor y tiene «Asignar a embarque…».
- **Lotes al barrer** (`compra_lineas.tipo = 'barrer_marca'`). Reparto **por entrega** (`compra_linea_repartos`) con el vector de la **temporada del mes de la entrega**. Mover una entrega de mes la reparte de nuevo con la misma versión de M12 o da `reparto_sin_vector` (decisión 86, R6 de 08b).
- **Excel de Viajes y embarques** (`src/lib/compras/agrupadores/excel.ts`): hojas `VIAJES`, `AGRUPADORES`, `EMBARQUES`, `PAQUETES` y `ASIGNACIONES`.
- **Eventos inmutables** en `compra_agrupador_eventos`: `antes` y `despues` = `agrupador_foto_embarque()`.

**Defecto real en lo construido** (se corrige aquí): `servicio.ts` (~ línea 943) manda `fecha_salida_estimada: cuerpo.fecha_salida_estimada ?? null` y `guardar_embarque` (`0036`, ~ línea 289) escribe `fecha_salida_estimada = v_salida` sin condición. **Un `PATCH` que no trae la salida la borra, sin motivo ni evento de fechas.**

**Qué no se reabre**: decisiones 2, 54/55, 60, 83 (se precisa), 86, 92, 94 (con los modos de la `0036`), 95, 97 y 98; I1 a I5 (I2 se generaliza a paquetes, §2.8); convenciones de migración (idempotente; sin `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ni `do $$`; sin backfill).

## 1. Objetivo

Javier quiere ver, **por cada compra a un proveedor**, en qué punto está: cuándo se hizo la orden, cuándo zarpa, cuándo llega a puerto, cuándo entra al CD, cuándo arranca la operación y cuándo ingresa al stock. Cada eslabón se atrasa por razones distintas (pago, naviera, aduana, conteo). Este cambio le da al **embarque** cinco hitos logísticos que se editan con motivo y causa y quedan en el historial, y a cada **compra** una **línea de tiempo** de seis hitos (la orden de compra y los cinco de su embarque).

**El ingreso al stock decide el mes del flujo, y lo fija Javier.** Si no lo fija, es el día del ingreso al CD. Se fija por embarque y, para lo **al barrer**, por **paquete**, también por partes en varios meses.

Toda compra nace con su **código X** (`C-000123`) y después se le puede **registrar el número de la OC real** (el de SAP), con historial y sin romper la reimportación.

Las compras de COTV entran con su viaje y **llegada en diciembre de 2026, sin embarque**, cuentan en diciembre como cualquier entrega sin embarque, y Javier las reparte por proveedor entre los embarques reales (California y Nueva York) con el «Asignar» que ya existe, sin contarlas dos veces.

## 2. Modelo de datos

### 2.1 Los seis hitos de la línea de tiempo (decisión 120)

| # | Hito (pantalla, con el marcador de Javier) | Dónde vive | Columna | Nulable | Nueva | Qué significa |
|---|---|---|---|:-:|:-:|---|
| 0 | ⚪ **Orden de compra** | compra | `compras.fecha_compra` | no | no | La fecha de la compra de M8. Siempre «real». No se edita en esta entrega (la edición de compras es de `0.13.1`) |
| 1 | 🔵 **Zarpe** (salida) | embarque | `fecha_salida_estimada` | sí | no | Como hoy |
| 2 | 🔴 **Arribo** (puerto) | embarque | `fecha_puerto_estimada` | sí | **sí** | No aplica a embarques `local` (`puerto_en_local`) |
| 3 | ⚫ **Ingreso CD** | embarque | **`fecha_llegada_estimada`** | **no** | no | La mercadería llega físicamente al CD. **Conserva su significado de origen** («llegada al CD», 08b §2.4). Es la fecha que Javier conoce y carga |
| 4 | 🚀 **Inicio operativo** | embarque | `fecha_inicio_operativo_estimada` + `hora_inicio_operativo` | sí | **sí** | Empieza el conteo y el proceso en el CD. **Fecha y, si se conoce, hora** (§2.3) |
| 5 | 🟢 **Ingreso al stock** | embarque (o paquete) | `fecha_ingreso_estimada` | sí | **sí** | La mercadería queda disponible. **Manda el mes del flujo.** La fija Javier; **nula = el día del Ingreso CD** |
| 5' | Ingreso real (08b-2) | embarque | `fecha_llegada_real` | sí | no | Lo confirma «Recibir embarque» |

**Inicio operativo complementa, no reemplaza.** Son tres momentos distintos que en el CD pueden separarse días: llega (Ingreso CD), se empieza a contar y procesar (Inicio operativo) y queda disponible (Ingreso al stock). El hito «llegada al área de conteo» de la revisión 3 **es** el Ingreso CD (misma columna); solo cambia el nombre en pantalla al de Javier.

**Por qué los hitos 1 a 5 son del embarque y no de la compra.** Un embarque es un contenedor o envío: todas sus compras zarpan, arriban y entran al CD juntas. Lo que Javier llama «la compra a cada proveedor» se ve como la línea de tiempo **de la compra**, armada con la orden de compra y las fechas de su embarque. **No se permite una fecha propia por compra** dentro del mismo embarque: no hay una necesidad real (si un proveedor zarpa en otra fecha, va en otro embarque), duplicaría cada fecha en decenas de compras y abriría el problema de qué fecha manda el mes. La única excepción ya decidida es el **ingreso al stock por paquete** (§2.5), que sirve para lo al barrer.

**Una compra repartida en dos embarques** (California y Nueva York) tiene **una línea de tiempo por tramo**: el tramo es (embarque, paquete) con sus unidades. Lo que todavía no tiene embarque es un tramo «Sin embarque», con la orden de compra y el mes de su entrega como ingreso al stock previsto; los otros hitos salen «Pendiente».

Otras columnas nuevas:

| Tabla | Columna | Tipo | Notas |
|---|---|---|---|
| `compra_embarques` | `fecha_inicio_operativo_estimada` | `date null` | §2.3 |
| `compra_embarques` | `hora_inicio_operativo` | `time null` | `check (hora_inicio_operativo is null or fecha_inicio_operativo_estimada is not null)`, declarado dentro de `add column if not exists`. Hora de Lima, sin zona |
| `compra_embarques` | `hito_confirmado` | `text null` | Último hito que **ya ocurrió**: zod `zarpe`, `arribo`, `ingreso_cd` o `inicio_operativo`, en orden. El ingreso al stock se confirma al recibir (08b-2) |
| `compra_embarques` | `origen` | `text null` | ≤ 80. **Almacén o ciudad de origen** («California», «Nueva York»). Texto con sugerencias (valores ya usados y, cuando exista la 08c, la región de los proveedores del embarque). Sin catálogo (§2.7) |
| `compra_paquetes` | `fecha_ingreso_estimada` | `date null` | **Ingreso al stock propio del paquete.** Nula = hereda el del embarque |
| `compra_paquetes` | `periodo_ingreso` | `date generated always as (…) stored` | Primer día del mes de `fecha_ingreso_estimada`, nulo si ella es nula. La misma expresión inmutable `make_date(extract(year …)::int, extract(month …)::int, 1)` de 08b. Agregarla reescribe `compra_paquetes` (decenas de filas) |
| `compra_agrupador_eventos` | `causa` | `text null` | El catálogo de §2.6, en zod |

- Todo con `add column if not exists`. No hay backfill: lo existente queda con los hitos nuevos nulos y el ingreso al stock nulo (= Ingreso CD), así que **ningún mes cambia**.
- **Sin bandera «ingreso fijado a mano».** La columna nula ya lo dice: nula sigue al Ingreso CD; con valor, la fijó alguien y no se mueve sola. «Igualar al Ingreso CD» la vuelve a `null`.
- **Por qué el ingreso al stock sin fijar es el Ingreso CD y no el Inicio operativo.** Si dependiera del Inicio operativo, anotar o corregir esa hora podría cambiar el mes de decenas de compras sin que nadie lo decidiera. El mes solo se mueve cuando cambia el Ingreso CD o cuando Javier fija el ingreso.
- **Orden de los hitos: avisa, no bloquea**, salvo Zarpe > Ingreso CD (el check de la `0032`). Zarpe ≤ Arribo ≤ Ingreso CD ≤ Inicio operativo ≤ Ingreso al stock se comprueba al guardar y da el aviso `orden_de_fechas` con los dos hitos implicados.

### 2.2 Estado de cada hito

| Estado | Cuándo | En pantalla (texto, nunca solo color) |
|---|---|---|
| `real` | Orden de compra; o el hito está en o antes de `hito_confirmado` y tiene fecha; o ingreso al stock con `fecha_llegada_real` | «02/11/2026 · Ocurrió ✓» |
| `sin_registrar` | Está en o antes de `hito_confirmado` pero no tiene fecha (p. ej. nadie anotó el zarpe y ya entró al CD) | «Ocurrió · sin fecha» |
| `vencido` | Previsto con fecha anterior a hoy (Lima) y no confirmado | «18/11/2026 · Debía ocurrir hace 4 días» |
| `previsto` | Con fecha, no confirmado, fecha ≥ hoy | «18/11/2026 · Previsto» |
| `pendiente` | Sin fecha y no confirmado (o tramo sin embarque) | «Pendiente» |
| — | Arribo en un embarque `local` | «No aplica» |

El ingreso al stock sin fijar muestra la fecha del Ingreso CD con la nota «igual al Ingreso CD». En el tramo «Sin embarque» muestra el mes («dic-26, sin embarque»).

**Confirmar un hito** (`hito_confirmado`) exige la fecha de **ese** hito, no futura, y que ninguno de los anteriores con fecha sea futuro. Los anteriores **sin** fecha quedan `sin_registrar`: el ejemplo de Javier (Zarpe y Arribo «Pendiente» con Ingreso CD ya ocurrido) se puede registrar tal cual. Para el Inicio operativo, «no futuro» se mide con fecha y hora si hay hora.

### 2.3 Inicio operativo: fecha más hora opcional, no `timestamptz`

- **Dos columnas** (`date` y `time`), no una `timestamptz`. Las razones:
  - Las **previsiones son por día**; la hora aparece cuando de verdad arranca («05/11/2026 09:22»). Con `timestamptz` una previsión sin hora quedaría con un 00:00 inventado.
  - Todas las fechas del embarque son `date` y se comparan entre sí por día; la hora es solo un detalle del Inicio operativo.
  - Sin zona horaria que convertir: es la hora de Lima tal como la escribe el CD, y Lima no tiene horario de verano.
- **Hora sin fecha** se rechaza (el `check` y `hora_sin_fecha` en la API). Vaciar la fecha vacía también la hora.
- Al marcar «ya empezó», la pantalla propone la hora actual de Lima («Ahora»), editable.
- **No mueve el mes**: cambiar el Inicio operativo nunca toca compras (I6), pero sí pide motivo y causa si reprograma.

### 2.4 El mes del flujo: `periodo_llegada` pasa a leer el ingreso al stock (decisión 115)

**Regla.** `periodo_llegada = mes de coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada)`: el real; si no, el ingreso fijado; si no, el Ingreso CD.

**El ingreso al stock lo fija Javier** (decisión 119):

- **Sin fijar** (nulo): ingresa el día del Ingreso CD. Si el Ingreso CD se reprograma, lo sigue en el mismo cambio (un solo motivo).
- **Fijado**: se escribe en el alta o en el diálogo de fechas (§4.3). Si después cambia el Ingreso CD, no se mueve; si queda antes, aviso `orden_de_fechas`.
- **«Igualar al Ingreso CD»** lo vuelve a nulo. Si eso cambia el mes, mueve entregas como cualquier reprogramación.
- **No hay días de cola, parámetros ni cálculo.** Una cola con capacidad, si algún día se pide, sería un módulo aparte que **propone** fechas y las escribe por las mismas funciones.

**Primera tarea de `datos` en T1, antes de escribir la `0038`: comprobar la versión de `vector-two`.** El arquitecto no tuvo el MCP de Supabase en esta sesión, así que **no está verificado**. `datos` corre, solo lectura, con `mcp__Supabase__execute_sql` y `project_id = tzjsxzmsvvhxyiooihyq` (nunca `lukers-compras`): `select version(); show server_version_num;` y anota el resultado en §9.1. La CI usa `postgres:17` y los proyectos nuevos de Supabase nacen en 17, así que lo esperable es que sí.

**Tres maneras de cambiar la regla, comparadas:**

| | A · `alter column periodo_llegada set expression as (…)` | B · Columna generada nueva (`periodo_ingreso`) y reemplazo en los lectores | C · Dejar la columna y derivar en las funciones |
|---|---|---|---|
| Requisito | **Postgres ≥ 17** | Cualquiera | Cualquiera |
| Qué reescribe | `compra_embarques` (decenas de filas; candado exclusivo de milisegundos) y su índice. Reaplicarla la reescribe otra vez, con el mismo resultado | `compra_embarques` igual (agregar una columna `stored` también reescribe) | Nada |
| Lectores que hay que tocar | **Ninguno**: todo lo que lee `periodo_llegada` (I2 de `aplicar_movimiento_agrupador`, `agrupadores_desalineados`, `agrupador_foto_embarque`, `consultas.ts`, la regla 3 del importador de compras, 08b-2) queda bien solo | **Todos**. Si se escapa uno, compara contra el mes viejo: I2 lanza `AG002` o se desalinea en silencio | Todos, y además se pierde el índice por mes |
| Nombres | Uno, con su significado nuevo en `comment on` | Dos columnas parecidas; `periodo_llegada` queda como «mes del Ingreso CD» sin uso | Uno, con un significado que ya no es el que manda |
| Riesgo | Bajo y localizado en una sentencia | Medio (olvidos) | Alto |

**Recomendación: A si `server_version_num ≥ 170000`; B si no.** El costo de A (reescribir decenas de filas) es despreciable, no es `DROP` ni cambia datos, y deja correctos a todos los lectores presentes y futuros. En B, `periodo_ingreso` se agrega con índice, la `0038` reemplaza todas las funciones que leen `periodo_llegada` y una **prueba estática** exige que ninguna función vigente posterior a la `0038` ni ningún archivo de `src/lib/compras/**` lea `periodo_llegada` salvo en el `comment on` y en el Excel. C se descarta. *Descartado también*: reinterpretar `fecha_llegada_estimada` como el ingreso (revisión 1), que invierte el significado de lo cargado y de la plantilla vieja.

- **La misma regla en TypeScript.** `periodoLlegada(real, ingreso, ingresoCd)` en `movimiento.ts` (revisión B2 de 08b). Cambia su firma y se actualizan sus llamadas.
- **El código `aamm##`** de un embarque nuevo sigue tomando el mes de `fecha_llegada_estimada` (Ingreso CD) al crear. No cambia nunca.

### 2.5 Lo al barrer: ingreso al stock por paquete, todo junto o por partes (decisión 119)

**Qué tiene de especial.** Un lote al barrer se reparte entre GML con el vector de la **temporada del mes en que entra** (§0): el mismo lote se distribuye distinto en verano que en invierno. Por eso **cuándo** entra decide **cómo** se reparte.

- **Todo junto**: un paquete («Al barrer») con su ingreso, y los lotes van ahí enteros.
- **Por partes**: dos o más paquetes («Al barrer · tanda 1», «tanda 2») con fechas distintas, y las unidades se reparten entre ellos. Por eso **`mover_a_paquete` acepta unidades por asignación** (hoy mueve asignaciones enteras). `agrupador_mover_entregas` ya acepta movimientos parciales por asignación: no cambia.
- **El mes de una asignación es el de su paquete** si el paquete tiene ingreso; si no, el del embarque (I2 generalizada, §2.8).
- **Fijar o cambiar el ingreso de un paquete, o mover a un paquete con otro mes, mueve entregas**: vista previa, huella del plan, motivo y causa. Si cambia la temporada, **reparte de nuevo** con la misma versión de M12 (avisos `cambia_temporada` y `reparto_sin_vector`). Con recepciones vinculadas, `asignacion_con_recepciones`.
- **«Programar lo al barrer»** (atajo de pantalla, sin ruta nueva): lista los lotes al barrer del embarque y ofrece crear el paquete con la fecha que Javier escriba (propone la del ingreso del embarque) y moverlos ahí; «Agregar otra tanda» crea otro paquete. Son tres llamadas que ya existen (crear paquete, fijar su ingreso sin asignaciones, que no mueve nada, y mover a paquete con unidades), cada una consistente por sí sola.
- **Lo que no cambia**: los hitos 1 a 4 son del embarque; el paquete no tiene «ya ocurrió» propio; recibir (08b-2) sigue siendo por embarque y cada recepción lleva su propio mes X.

### 2.6 Causas de reprogramación (zod `CAUSAS_FECHA`, en `tipos.ts`)

| Valor | En pantalla |
|---|---|
| `pago` | Demora en el pago al proveedor |
| `produccion` | El proveedor no terminó a tiempo |
| `naviera` | Naviera, zarpe o transbordo |
| `aduana` | Aduana |
| `transporte` | Transporte local (puerto → CD) |
| `cola_conteo` | Cola o capacidad en el CD (conteo, proceso) |
| `programacion` | Programación del ingreso (decisión propia, p. ej. soltar lo al barrer más tarde) |
| `correccion` | Corrección de un dato mal puesto (no es atraso) |
| `otro` | Otro (el motivo lo explica) |

Las reprogramaciones con causa `correccion` o `programacion` **no cuentan como atraso** en el contador visible, aunque quedan en el historial. **Pagos** (decisión 118): el pago es por compra y proveedor y un embarque consolida varios; se registra como la causa `pago`, no como un campo.

### 2.7 Compras de COTV: llegada en diciembre, sin embarque, y Javier las reparte (decisión 117)

**Cómo entran.** Por el importador de compras **de siempre, sin cambios** (`POST /api/compras/importar`, `carga_inicial`; 08c §12.2 b). La planilla C2 lleva:

- `FECHA_COMPRA` = `purchases.purchase_date` de COTV, tal cual (08c §12.2 b). **Es la Orden de compra de la línea de tiempo.** Ojo: en COTV es el **día en que se registró** la compra (no está en el formulario, toma `current_date` del servidor en UTC; 08c §12.1, patrón 3). Es la única fecha que COTV tiene; Javier la corrige en la planilla si la orden real es otra.
- `VIAJE` = el código del viaje de COTV en Vector2.
- **`LLEGADA = 2026-12`** en todas las filas (Javier: «inicialmente ponle a todo llegada en diciembre»). Es un **mes**, como siempre en el importador: la entrega queda con `periodo = 2026-12-01`, que en M8 significa «diciembre», no «el día 1».
- `EMBARQUE` y `PAQUETE` vacíos. `RECIBIDAS` vacía salvo que Javier diga que algo ya llegó.

COTV no tiene zarpe, arribo, ingreso al CD ni inicio operativo: esos hitos salen «Pendiente» hasta que Javier crea los embarques y les pone fechas.

**Qué pasa en el flujo.** Cada compra queda con una entrega de diciembre **sin embarque**, el caso que M8 y 08b-1 ya soportan: cuenta en diciembre en Flujo mensual y en Huecos, y sale en «Sin agrupador» con su viaje. No hay embarque provisional, mes provisional, banner ni aviso nuevo.

**Cómo las reparte Javier** (todo existe hoy):

1. Crea los embarques reales del viaje («California», «Nueva York»), cada uno con su **origen** y sus fechas.
2. En el detalle de cada embarque, **«Agregar compras»**: filtra por el viaje y por **proveedor**, «Marcar las visibles», ajusta unidades si una línea va partida, mira la vista previa y asigna. O, desde «Sin agrupador», filtra por proveedor, marca y «Asignar a embarque…».
3. Lo que asigna toma el mes del embarque (I2); lo que todavía no asignó sigue sin embarque en diciembre.

**Por qué no hay doble conteo** (comprobado contra la `0036`). La operación `asignar` de `aplicar_movimiento_agrupador` llama a `agrupador_mover_entregas` con movimientos `{ entrega_id, linea_id, compra_id, unidades, destino }`: si el embarque cae en otro mes, esas unidades **salen** de la entrega de diciembre y **entran** en la del mes del embarque **de la misma línea** (se crea con `origen = 'embarque'` o se funde). Al final la función exige `Σ entregas = compra_lineas.unidades` (I3, `AG002` si no) y `Σ asignaciones ≤ entrega` (I1). Una línea partida entre los dos embarques queda con dos asignaciones (y dos entregas si los meses difieren). Si el embarque también es de diciembre, no se mueve ninguna entrega: solo se crea la asignación.

**Fecha de un embarque cuando solo se sabe el mes.** El embarque pide una **fecha** de Ingreso CD, no un mes. Convención: **el día 15 del mes** (para diciembre de 2026, `2026-12-15`): un error de una o dos semanas no lo cambia de mes, y no se confunde con «llegó el día 1». El formulario lo dice como ayuda («Si solo sabes el mes, pon el 15»); no se rellena solo.

**Origen (California o Nueva York): `origen`, texto con sugerencias.** No es `puerto_embarque`: el almacén de Nueva York puede embarcar por otro puerto, y Javier divide por almacén. No es un maestro todavía (hoy son dos valores). Si más adelante cada proveedor tiene sus almacenes, el lugar natural es la ficha del proveedor de la 08c (`region` ya guarda el estado de EE. UU. desde COTV, 08c §12.2 a).

**Ayuda «Dividir por origen»: mejora futura, no se construye ahora.** **Recomendación**: cuando cierre E1 de la 08c, sumar a «Agregar compras» un filtro **«Región del proveedor»** (varios proveedores a la vez) en lugar de una operación nueva de «dividir»: es solo un filtro de pantalla sobre la misma asignación. Se evalúa con lo que Javier cuente después de repartir los dos viajes.

### 2.8 Invariantes

- **I1, I3, I4 e I5** de 08b, sin cambios.
- **I2 (generalizada)**: `entrega.periodo = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)` para las asignaciones activas que toca el plan. **`agrupadores_desalineados()`** se reemplaza con la misma regla; el humo exige `= 0` antes y después de aplicar la `0038`.

| | Invariante nueva | Dónde |
|---|---|---|
| **I6** | Un cambio de fechas que no cambia el mes de ninguna asignación (Zarpe, Arribo, Inicio operativo, `hito_confirmado`, o Ingreso CD / ingreso al stock dentro del mismo mes) no bloquea compras, no sube `compras.revision`, no escribe en `compra_eventos` y deja `flujo_huella_base()` igual | Función y humo |
| **I7** | Si `hito_confirmado` no es nulo: ese hito tiene fecha, ningún hito confirmado tiene fecha futura al confirmar, y el estado no es `planificado` | Función y humo |
| **I8** | Todo cambio de fecha u hora de embarque, de ingreso de paquete o de `hito_confirmado` deja un evento con la foto antes y después. Si reprograma, lleva motivo y causa | Función y humo |

### 2.9 Funciones de la `0038`

Todas con `create or replace` **a partir de su versión vigente** (la `0036` para las de agrupadores), con la misma firma, `security invoker`, `search_path = ''`, `revoke`/`grant` a `service_role` y `comment on` nuevo. Candados de la `0036`: viajes y embarques `for no key update`, compras `for update`, en orden viajes → embarques → compras. Las columnas nuevas no son clave, así que `for no key update` sigue bastando.

| Función | Cambio |
|---|---|
| `agrupador_foto_embarque(uuid)` | Suma arribo, inicio operativo (fecha y hora), ingreso al stock, `hito_confirmado`, `origen` y el ingreso de cada paquete |
| `guardar_embarque` | **Al crear**: los cinco hitos (Ingreso CD obligatorio: `fecha_requerida`; hora sin fecha: `hora_sin_fecha`) y `origen`. **Al editar**: no escribe **ninguna** fecha ni hora y conserva las de la fila (**corrige el defecto de §0**); una presente y distinta de la vigente da `fecha_por_movimiento`; `origen` sí se edita |
| `aplicar_movimiento_agrupador` | (1) `cambiar_fecha` ampliada (§2.10). (2) `mover_a_paquete` acepta unidades y puede mover meses (motivo y causa solo si mueve meses). (3) I2 generalizada en la comprobación final, también para `mover_a_paquete` y el ingreso de un paquete. Un plan viejo (`cambiar_fecha` con solo `fecha_llegada_estimada`) se comporta como hoy |
| `cambiar_estado_agrupador` | `volver_a_planificado` con `hito_confirmado` → `409 hito_confirmado` |
| `importar_agrupadores` | Columnas nuevas (§3.6). La clave natural sin código sigue siendo (nombre, Ingreso CD). Solo crea (decisión 97) |
| `agrupadores_desalineados()` | I2 generalizada |
| **`agrupador_hitos_resumen(p_embarques uuid[])`** (nueva, `stable`) | Por embarque y hito (los cinco), más el ingreso de cada paquete: fecha original (la primera no nula en los eventos), reprogramaciones (sin contar `correccion` ni `programacion`) y la última causa |

**No se tocan**: `guardar_paquete`, `agrupador_mover_entregas`, `asignar_viaje_compras`, `importar_compra` ni ninguna función de M8. La línea de tiempo de la compra **no tiene función propia**: se arma en TypeScript (§3.4) con la compra, sus asignaciones y los embarques, que ya se leen. En el **plan B** (§2.4) se reemplazan además todas las funciones que leen `periodo_llegada`.

### 2.10 `cambiar_fecha` ampliada

El plan lo arma `planCambiarFechas`, puro, en `movimiento.ts`:

```
{ operacion: 'cambiar_fecha', motivo, causa, resumen,
  embarques: [{ id, revision,
                fecha_salida_estimada?, fecha_puerto_estimada?,            // clave presente = valor nuevo (null = vaciar)
                fecha_llegada_estimada?,                                    // Ingreso CD (nunca null)
                fecha_inicio_operativo_estimada?, hora_inicio_operativo?,   // vaciar la fecha vacía la hora
                fecha_ingreso_estimada?,                                    // fecha = fijar; null = igualar al Ingreso CD
                hito_confirmado? }],
  paquetes: [{ id, fecha_ingreso_estimada }],                               // ingreso propio (null = hereda)
  compras: [...], movimientos: [...], entregas: [...], repartos: [...] }    // solo si cambia algún mes
```

Pasos de la función:

1. Bloquea los embarques y calcula los valores finales.
2. Sin cambios → `sin_cambios`.
3. **Si reprograma**, exige motivo y causa (`motivo_requerido`, `causa_requerida`). Reprograma: cambiar o vaciar un Zarpe, Arribo o Inicio operativo (fecha **u hora**) que tenía valor; cambiar el Ingreso CD; cambiar la fecha **efectiva** de ingreso al stock (`coalesce(ingreso, Ingreso CD)`) por fijarla o igualarla; cambiar el ingreso de un paquete; bajar `hito_confirmado`. **No** reprograma: completar una fecha u hora vacía, confirmar un hito, o que el ingreso sin fijar siga al Ingreso CD (ya va en ese motivo).
4. **Estados.** Ingreso CD e ingreso al stock (de embarque y de paquete) solo cambian en `planificado` o `en_transito`. Zarpe, Arribo, Inicio operativo y `hito_confirmado` también cambian en `recibido`. En `cancelado`, nada (`embarque_no_editable`).
5. **Bloqueos.** Zarpe ≤ Ingreso CD con los valores finales (el check de la base). Arribo en un `local` → `puerto_en_local`. Hora sin fecha → `hora_sin_fecha`. Confirmar un hito: §2.2 (`fecha_requerida`, `fecha_futura`, con la fecha y hora de Lima). Confirmar con el embarque `planificado` lo pasa a `en_transito` (aviso `pasa_a_en_transito`).
6. **Recepciones vinculadas** (08b-2): si cambia el mes de una asignación con recepciones → `embarque_con_recepciones` o `asignacion_con_recepciones`.
7. **Mes sin cambios** en ninguna asignación: se escribe el embarque, sube su `revision`, queda **un** evento y no se bloquea ninguna compra (I6).
8. **Mes con cambios**: el camino de hoy (bloquear compras derivadas, comparar `revision`, `agrupador_mover_entregas`, I1 a I3, I2 generalizada, I5 y eventos solo en las compras que cambiaron).

### 2.11 Número de OC de la compra (decisión 121)

**Qué es cada código.**

| Código | Columna | Quién lo pone | ¿Cambia? | Para qué |
|---|---|---|---|---|
| **Código X** | `compras.numero` (`C-000123`) | El sistema, al crear | Nunca | Identificar la compra desde que nace |
| Referencia de importación | `compras.referencia` (`COTV-…`, o la del archivo) | El importador | **Nunca** (no se edita) | Agrupar las filas del archivo en una compra y reimportar sin duplicar |
| **Número de OC** | **`compras.numero_oc`** (nueva) | Una persona, cuando lo tiene | Sí, con historial | La orden de compra real (p. ej. de SAP) |

**Por qué la OC no es la `referencia`.** Si la OC editable fuera la referencia, cambiarla rompería la clave del importador: al reimportar el archivo original (con la referencia vieja) no se encontraría la compra y se **crearía otra igual**, contando dos veces en el flujo; y las `clave_importacion` ya guardadas en las líneas quedarían con la referencia vieja. Por eso la referencia queda congelada y la OC es un dato aparte que el importador nunca usa para enlazar.

**Columna** (en la `0038`; es aditiva y chica, no pide migración propia):

| Columna | Tipo | Notas |
|---|---|---|
| `compras.numero_oc` | `text null` | `check (numero_oc is null or (char_length(numero_oc) between 1 and 40 and numero_oc = btrim(numero_oc)))`, declarado dentro de `add column if not exists`. Se guarda tal como se escribe, sin espacios al borde; se compara y se busca con `upper()`. zod: `^[A-Za-z0-9][A-Za-z0-9\-/_. ]{0,39}$` |
| índice `compras_numero_oc_idx` | `on public.compras (upper(numero_oc)) where numero_oc is not null` | Para el aviso de repetidas y la búsqueda exacta |

- **No es única.** COTV creó **una compra por ítem** (08c §12.1, patrón 1), así que una OC real de SAP puede cubrir varias compras del mismo proveedor en Vector2. Una OC ya usada **avisa** y no bloquea: `oc_repetida` («La OC 4500012345 ya está en C-000201 y C-000203 de este proveedor») y, si está en compras de **otro** proveedor, `oc_de_otro_proveedor` (casi siempre un error de tipeo). Las compras canceladas no cuentan.
- **Sin backfill**: todo lo existente queda sin OC.

**Función nueva `editar_oc_compra(p_compra uuid, p_antes text, p_numero_oc text, p_motivo text, p_actor jsonb)`** (`plpgsql`, `security invoker`, `search_path = ''`, solo `service_role`), análoga a `editar_ficha_linea` de 08c (I6, decisión del 2026-11-04 que matiza la 60):

1. Bloquea **solo la compra** (`for no key update`; no es columna clave, y así no choca con el `key share` de las FK de líneas y eventos). Las funciones que mueven compras toman `for update` de la misma fila: se esperan, sin interbloqueo, porque esta toma una sola fila y nada más.
2. Compra inexistente → `no_encontrado`; `cancelada` → `no_editable`.
3. Compara `numero_oc` guardado con `p_antes` (`is distinct from`): si alguien la cambió entre medio, `oc_cambio` y no escribe.
4. Igual al nuevo → `sin_cambios`.
5. Escribe `numero_oc` (nulo = quitarla) y `updated_by_*`, **sin subir `compras.revision`**: la OC no toca cantidades ni fechas, y subir la revisión daría `409` falsos a quien tiene la compra abierta en otra vista o a un plan de movimiento ya previsualizado.
6. Inserta en `compra_eventos` la acción **`editar_oc`** (zod `ACCIONES_EVENTO`; `datos` confirma en T1 que `accion` no tiene `check` en la base, como `origen` y `estado`) con `antes = { numero_oc }`, `despues = { numero_oc }`, el motivo (opcional, ≤ 300) y el `resumen` («OC: — → 4500012345»). El evento mueve la huella del flujo una vez (cuenta eventos), sin cambiar cifras, igual que en 08c R7.
7. Devuelve `{ ok, numero_oc, avisos: [oc_repetida | oc_de_otro_proveedor …] }`.

**Permisos.** `requireUser`: los tres roles registran o cambian la OC de **cualquier** compra no cancelada desde la pantalla. Es un dato de identificación que no mueve el flujo, y el responsable es un filtro, no un permiso (decisión 28). Cambiar una OC que ya tenía valor pide motivo en la pantalla (en la base es opcional, para el importador) y siempre deja el antes y el después. **En el importador**, en cambio, se aplica la regla de la decisión 109 (§3.7): el comprador solo pone OC en su propio borrador, para que un archivo no pise en lote la OC de compras ajenas.


Guards y forma de 08b §3 (`ok({ … })`, `errorConCodigo`, `leerCuerpo` de `src/lib/api/respuestas.ts`; solo `.rpc(` para escribir). **Todo es `requireUser`** (decisión 92), salvo lo que ya era `requirePlanner` (cancelar, cerrar, reabrir).

### 3.1 Esquemas zod (`src/lib/compras/agrupadores/esquemas.ts`)

```ts
const HITOS_CONFIRMABLES = ["zarpe", "arribo", "ingreso_cd", "inicio_operativo"] as const;
const CAUSAS_FECHA = ["pago","produccion","naviera","aduana","transporte","cola_conteo","programacion","correccion","otro"] as const;
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);            // hh:mm, hora de Lima

cambiarFechasSchema = z.strictObject({
  revision: z.number().int().min(0).max(MAX_REVISION),
  fecha_zarpe: fechaIso.nullable().optional(),          // → fecha_salida_estimada
  fecha_arribo: fechaIso.nullable().optional(),         // → fecha_puerto_estimada
  fecha_ingreso_cd: fechaIso.optional(),                // → fecha_llegada_estimada (nunca null)
  inicio_operativo: z.strictObject({ fecha: fechaIso, hora: hora.nullable() }).nullable().optional(),
  fecha_ingreso_stock: fechaIso.nullable().optional(),  // fecha = fijar; null = igualar al Ingreso CD
  hito_confirmado: z.enum(HITOS_CONFIRMABLES).nullable().optional(),
  motivo: z.string().trim().min(1).max(300).optional(),
  causa: z.enum(CAUSAS_FECHA).optional(),
  huella_plan,
}).refine(v => ["fecha_zarpe","fecha_arribo","fecha_ingreso_cd","inicio_operativo","fecha_ingreso_stock","hito_confirmado"].some(k => k in v), "sin_cambios");

editarOcSchema = z.strictObject({ antes: z.string().nullable(),            // la OC que vio el formulario
  numero_oc: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9\-\/_. ]{0,39}$/).nullable(),   // null = quitar
  motivo: z.string().trim().min(1).max(300).optional() });

ingresoPaqueteSchema = z.strictObject({ revision_embarque: z.number().int().min(0), fecha_ingreso_stock: fechaIso.nullable(),   // null = hereda
  motivo: z.string().trim().min(1).max(300).optional(), causa: z.enum(CAUSAS_FECHA).optional(), huella_plan });

// Cambios en esquemas existentes:
guardarEmbarqueSchema += { fecha_puerto_estimada?, fecha_inicio_operativo_estimada?, hora_inicio_operativo?: hora.nullable(),
                           fecha_ingreso_estimada?,                    // solo al crear
                           origen: z.string().trim().max(80).nullable().optional() };   // fecha_llegada_estimada sigue obligatoria al crear: es el Ingreso CD
moverAPaqueteSchema.asignaciones: z.array(z.union([z.uuid(), z.strictObject({ id: z.uuid(), unidades: z.number().int().positive() })])).min(1).max(2000)
                    + motivo?, causa?, huella_plan   // obligatorios solo si el movimiento cambia de mes (lo decide el servidor)
```

**La API habla con nombres de hito** y `consultas.ts` los traduce a columnas. `pasarPendientesSchema` y `asignarEntregasSchema` **no cambian**. La fila del importador de compras suma solo `oc` (§3.7).

### 3.2 Rutas

| Ruta | Método | Guard | Cuerpo | `{ data }` | Errores |
|---|---|---|---|---|---|
| **`/api/compras/embarques/[id]/fechas`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `cambiarFechasSchema` | `PlanFechasApi` o `RespuestaMovimientoApi` + `avisos` | 400; 404; 409 `sin_cambios`, `motivo_requerido`, `causa_requerida`, `salida_despues_de_llegada`, `puerto_en_local`, `hora_sin_fecha`, `fecha_requerida`, `fecha_futura`, `embarque_no_editable`, `embarque_con_recepciones`, `agrupador_cambio`, `plan_cambio`, `max_entregas`, `reparto_sin_vector` |
| **`/api/compras/paquetes/[id]/ingreso`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `ingresoPaqueteSchema` | ídem | Los anteriores más `asignacion_con_recepciones`, `no_editable` (paquete cancelado) |
| `/api/compras/embarques/[id]/fecha` (existe) | POST | `requireUser` | sin cambios | ídem | **Alias por una versión**: equivale a `/fechas` con `fecha_ingreso_cd` y `causa = 'otro'` (hoy esa ruta cambia la «llegada al CD»: el significado se conserva) |
| `/api/compras/embarques` | POST | `requireUser` | alta con los cinco hitos y `origen` | `{ embarque }` | más `puerto_en_local`, `hora_sin_fecha` |
| `/api/compras/embarques/[id]` | PATCH | `requireUser` | sin fechas (`origen` sí) | `{ embarque }` | `409 fecha_por_movimiento`. **Una fecha ausente ya no se vacía** |
| `/api/compras/embarques/[id]/paquete` (mover a paquete) | POST (`?previsualizar=1` nuevo) | `requireUser` | `moverAPaqueteSchema` ampliado | ídem | más `asignacion_con_recepciones`, `excede_entrega`, `motivo_requerido`, `causa_requerida`, `plan_cambio`, `reparto_sin_vector` |
| `/api/compras/embarques/[id]/estado` | POST | como hoy | — | — | más `hito_confirmado` |
| `/api/compras/embarques` | GET | `requireUser` | más `reprogramados=1` y `origen`; `atrasados=1` = algún hito vencido | `{ embarques }` con `hitos` | — |
| `/api/compras/[id]` (M8, existe) | GET | `requireUser` | — | `CompraApi` **+ `linea_de_tiempo`** | — |
| `/api/compras` (M8, existe) | GET | `requireUser` | más `?proximo_hito=vencido`; `q` busca también en `numero_oc` (y sigue buscando en `numero` y `referencia`) | cada compra **+ `proximo_hito`** y `numero_oc` | — |
| **`/api/compras/[id]/oc`** (nueva) | PUT | `requireUser` | `editarOcSchema` | `{ compra: { id, numero, numero_oc }, avisos }` | 400; 404 `no_encontrado`; 409 `oc_cambio` («Otra persona cambió la OC: vuelve a abrirla»), `no_editable`, `sin_cambios` |

Los cambios en las lecturas de M8 son **aditivos** (dueño `backend`). La única escritura nueva sobre compras es `/oc`, por `editar_oc_compra`.

### 3.3 Tipos (`tipos-api.ts`)

```ts
type Hito = "orden_compra" | "zarpe" | "arribo" | "ingreso_cd" | "inicio_operativo" | "ingreso_stock";
type EstadoHito = "real" | "sin_registrar" | "vencido" | "previsto" | "pendiente" | "no_aplica";
HitoApi { hito; fecha: string | null; hora: string | null;          // hora solo en inicio_operativo
          estado: EstadoHito; igual_a_ingreso_cd?: boolean;         // ingreso_stock sin fijar
          fecha_original: string | null; retraso_dias: number | null; reprogramaciones: number; manda_el_mes: boolean }
EmbarqueApi += { hitos: HitoApi[] /* los 5 logísticos */; hito_confirmado; origen; reprogramaciones_total;
                 proximo_hito: { hito, fecha, hora, estado } | null }
PaqueteApi  += { fecha_ingreso: string | null; periodo_ingreso: string | null; ingreso_propio: boolean; lotes_al_barrer: number }
TramoLineaTiempoApi { embarque: { id, codigo, nombre, origen } | null; paquete: { id, codigo, nombre } | null;
                      unidades: number; mes: string; hitos: HitoApi[] /* los 6, la orden de compra incluida */ }
CompraApi   += { numero_oc: string | null;
                 linea_de_tiempo: TramoLineaTiempoApi[];            // solo en GET /api/compras/[id]
                 proximo_hito: { hito, fecha, hora, estado, embarque_codigo } | null }   // en la lista
PlanFechasApi = PlanMovimientoApi & { cambios: { hito | 'ingreso_paquete', paquete?, antes, despues, dias }[];
                                      meses: { de, a, unidades }[]; reprograma: boolean; avisos }
```

`fecha_salida_estimada` y `fecha_llegada_estimada` **se conservan** en `EmbarqueApi` (Excel, importador, avisos).

### 3.4 Línea de tiempo y próximo hito (lógica pura, `src/lib/compras/agrupadores/hitos.ts`)

- **`lineaDeTiempo(compra, asignaciones, embarques, paquetes, hoy)`**: un tramo por (embarque, paquete) de las asignaciones activas de la compra, con la suma de sus unidades, más un tramo «Sin embarque» por cada mes con unidades sin asignar. Orden: por mes y luego por código de embarque. Las asignaciones históricas forman tramos igual (salen con sus hitos `real` cuando el embarque fue recibido).
- **`estadoHito`**: la tabla de §2.2. `hoy` entra como parámetro (sin reloj, como el resto de la lógica pura).
- **`proximoHito(compra)`**: entre los tramos que no están completos, el primer hito no `real` ni `sin_registrar` con la fecha más temprana; si alguno está `vencido`, gana el vencido más antiguo. Una compra sin tramos pendientes no tiene próximo hito.
- **Lectura**: `GET /api/compras/[id]` ya lee las asignaciones de la compra; suma una lectura de sus embarques y paquetes (una consulta, `in` por id). `GET /api/compras` lee, para las compras de la página, las asignaciones activas y sus embarques en **dos** consultas en tandas de 150 ids (decisión de M3), no una por compra.

### 3.5 Avisos nuevos

| Aviso | Texto |
|---|---|
| `oc_repetida` · `oc_de_otro_proveedor` | §2.11 |
| `orden_de_fechas` | «El Ingreso al stock (12-nov) es anterior al Ingreso CD (15-nov)». Para cualquier par de hitos fuera de orden y para el ingreso de un paquete |
| `hito_vencido` | «Debía arribar a puerto el 08-nov (hace 4 días): ¿ya arribó?». En la lista reemplaza a `atrasado`, que queda como el caso del ingreso al stock |
| `pasa_a_en_transito` | «Marcar que ya zarpó pasa el embarque a En tránsito» |

### 3.6 Importador de agrupadores (08b §3.11)

| Columna | Embarque | Formato | Nota |
|---|---|---|---|
| **`FECHA_ZARPE`** | opcional | fecha | **`FECHA_SALIDA` se acepta como sinónimo** |
| **`FECHA_ARRIBO`** | opcional | fecha | Se ignora en `LOCAL`, con aviso |
| **`FECHA_INGRESO_CD`** | **obligatoria** | fecha | **`FECHA_LLEGADA` se acepta como sinónimo** (es lo que ya significaba): archivos y plantillas viejos siguen sirviendo |
| **`INICIO_OPERATIVO`** | opcional | `aaaa-mm-dd`, `aaaa-mm-dd hh:mm`, `dd/mm/aaaa hh:mm`, o celda de fecha y hora de Excel | Sin hora, solo la fecha. Hora fuera de rango: `hora_invalida` |
| **`FECHA_INGRESO_STOCK`** | opcional | fecha | Vacía = igual al Ingreso CD |
| **`ORIGEN`** | opcional | texto ≤ 80 | |

- Una columna y su sinónimo con valores distintos en la misma fila: `fechas_en_conflicto`.
- `igual` o `cambiada` compara también las columnas nuevas; una columna ausente en el archivo cuenta como «no dice nada». Sigue solo creando (decisión 97). La plantilla y la hoja `AGRUPADORES` del Excel usan los nombres nuevos.
- La celda de fecha y hora de Excel la convierte el lector del navegador (`src/components/importador`) a texto `aaaa-mm-dd hh:mm` sin zona, igual que hoy convierte las fechas.

### 3.7 Importador de compras: solo la columna `OC`

- **La fecha de la Orden de compra ya es `FECHA_COMPRA`**, obligatoria desde M8. No se agregan columnas logísticas a la plantilla de compras: esas fechas son del embarque, y escribirlas desde un archivo de compras sería editar embarques existentes desde otro importador (contra la decisión 97) y permitir fechas distintas por compra dentro de un embarque (descartado en §2.1).
- **Columna nueva `OC`** (opcional; plantilla y lector de `src/lib/compras/importar.ts`). El enlace con la compra **no cambia**: la fila encuentra su compra por `PROVEEDOR` + `REFERENCIA`, como siempre; la `OC` nunca sirve para encontrar ni crear una compra.
  - **`OC` no entra en la huella** (`huellaContenido`) ni en `clave_importacion`. Así, completar la OC y reimportar sigue dando `igual` en las líneas, y nunca `cambiada` ni `nueva`.
  - **Vacía = «no dice nada»**: nunca borra una OC. Para quitarla, la pantalla.
  - Fila `nueva` (compra creada) o `igual`/`nueva` sobre una compra existente: si la `OC` del archivo es distinta de la guardada, se aplica con `editar_oc_compra` (con `p_antes` = la que leyó la previsualización y motivo «Importado de <archivo>»), en **una llamada más, en su propia transacción**, después de `importar_compra` y antes de las llamadas de agrupador. Un corte deja la compra sin OC; reimportar lo completa.
  - El reporte la muestra por compra: «OC registrada: 4500012345», «OC cambiada: 4500012300 → 4500012345», con los avisos `oc_repetida` y `oc_de_otro_proveedor`.
  - **Filas de una misma compra con OC distintas**: la OC no se aplica a esa compra y sale el aviso `oc_distinta_en_compra` (las líneas siguen su regla). No se elige una al azar, como sí se hace con `FECHA_COMPRA`, porque una OC equivocada es peor que ninguna.
  - **Comprador** (decisión 109): solo aplica OC a compras **nuevas** o a su **propio borrador**. Sobre una compra ajena o confirmada, la OC se omite con el aviso `oc_no_editable` («Pide a quien la registró o a un planner que ponga la OC, o hazlo desde la compra»); sus líneas siguen la regla de 109 sin cambios. Admin y planner la aplican en cualquier compra no cancelada. La función recibe el actor y lo vuelve a comprobar (como `importar_compra` en la `0034`), para que un descuido del backend no la desactive.
  - Compra cancelada: `oc_no_editable`.
- Las compras de COTV entran como en §2.7, con `OC` vacía. Después Javier completa la OC **en pantalla** o **reimportando la misma planilla C2** con la columna `OC` llena: la referencia `COTV-{id}` encuentra cada compra, nada se duplica y solo cambia la OC.
- **Regla 3 de 08b §3.9** (con `EMBARQUE`, `LLEGADA` debe caer en el mes del embarque, `llegada_distinta_del_embarque`): igual; como compara contra `periodo_llegada`, desde la `0038` compara contra **el mes del ingreso al stock**, que es el que cuenta.
- **Reimportar** el archivo de COTV después de repartir da `igual` (la huella es del archivo, 08b §3.9 regla 1) y una fila ya asignada no se toca (regla 2).

### 3.8 Excel: la línea de tiempo por proveedor

Hoja nueva **`LINEA_DE_TIEMPO`** en la descarga de Viajes y embarques (`excel.ts`, `hojaLineaDeTiempo`), **una fila por compra y tramo**, ordenada por proveedor y compra:

`PROVEEDOR · COMPRA (código X) · OC · VIAJE · EMBARQUE · ORIGEN · PAQUETE · UNIDADES · ORDEN DE COMPRA · ZARPE · ESTADO ZARPE · ARRIBO · ESTADO ARRIBO · INGRESO CD · ESTADO INGRESO CD · INICIO OPERATIVO (fecha y hora) · ESTADO INICIO OPERATIVO · INGRESO AL STOCK · ESTADO INGRESO AL STOCK · MES DEL FLUJO · REPROGRAMACIONES · ÚLTIMA CAUSA`

- Las fechas van como fecha de Excel (el Inicio operativo, como fecha y hora si tiene hora); el estado, en texto («Pendiente», «Previsto», «Ocurrió», «Vencido», «Ocurrió sin fecha», «No aplica»).
- Incluye los tramos «Sin embarque» de las compras del viaje elegido (se leen con `/agrupadores/sin-asignar`, que la página ya usa).
- Respeta el viaje activo y los filtros de la lista, como las demás hojas.
- La hoja `ASIGNACIONES` suma la columna `OC` junto a `COMPRA`.

### 3.9 Flujo y Huecos

**Sin cambios.** El método del flujo (`VERSION_METODO_FLUJO`) no cambia: sigue leyendo entregas, y lo único que lo mueve es un cambio de **mes** de una asignación (I5, revisiones, huella). No se toca `src/lib/flujo/**`.

## 4. Pantallas (kit de Vector2; `es-PE`; 390 px; lenguaje llano)

**Nombres y marcadores fijos en toda la pantalla**: ⚪ Orden de compra · 🔵 Zarpe · 🔴 Arribo · ⚫ Ingreso CD · 🚀 Inicio operativo · 🟢 Ingreso al stock. Los marcadores son los del reporte de Javier y se dibujan como un punto o ícono de color (`aria-hidden`) **siempre acompañado** del nombre del hito y del estado en texto (§2.2): el color nunca es la única señal. Un hito `vencido` lleva además el texto «Vencido» y un borde; uno `real`, «✓ Ocurrió».

### 4.1 Línea de tiempo en el detalle de la compra (nuevo)

**Encabezado de la compra**: «Compra C-000201 · OC 4500012345» con **«Editar OC»**, o «Compra C-000201 · OC sin registrar» con **«Registrar OC»**. El diálogo pide el número (≤ 40, letras, números, `-`, `/`, `_`, `.` y espacios), y motivo solo si reemplaza una OC que ya tenía; muestra los avisos de §2.11 antes de guardar («Ya está en C-000203 de este proveedor: ¿es la misma OC?»). Mensajes: «Otra persona cambió la OC mientras editabas: vuelve a abrirla» (`oc_cambio`), «Una compra cancelada no se edita». El historial de la compra muestra «C1 registró la OC 4500012345» y «A cambió la OC 4500012300 → 4500012345 · "Error de tipeo"».

Bloque «Línea de tiempo», un recuadro por tramo. Encabezado del tramo: «Embarque 261201 · California · 300 u» (o «Sin embarque · 200 u»). Debajo, los seis hitos en vertical (también en escritorio, porque son pocos):

| Marcador | Hito | Fecha | Estado |
|---|---|---|---|
| ⚪ | Orden de compra | 06/07/2026 | Ocurrió ✓ |
| 🔵 | Zarpe (salida) | — | Pendiente |
| 🔴 | Arribo (puerto) | — | Pendiente |
| ⚫ | Ingreso CD | 02/11/2026 | Ocurrió ✓ |
| 🚀 | Inicio operativo | 05/11/2026 09:22 | Ocurrió ✓ |
| 🟢 | Ingreso al stock | 08/11/2026 | Previsto · manda el mes (nov-26) |

- Cada hito con reprogramaciones muestra «+10 d · 2 cambios», enlazado al historial del embarque.
- Botón **«Cambiar fechas del embarque»** (abre §4.3) en cada tramo con embarque. En el tramo «Sin embarque», **«Asignar a embarque…»**.
- Si el tramo está en un paquete con ingreso propio, el ingreso al stock muestra «del paquete Al barrer».

### 4.2 Lista de Compras: código X, OC y «Próximo hito»

- La columna **Compra** muestra el código X y, debajo, «OC 4500012345» (o nada si no tiene). El buscador encuentra por código X, por OC o por referencia («Compra, OC, referencia o proveedor»).

- Columna **«Próximo hito»**: «🔴 Arribo · 18-nov · Previsto» o «⚫ Ingreso CD · 08-nov · Vencido (hace 4 días)»; con varios tramos, el más urgente y «+1 tramo».
- Filtro **«Con hitos vencidos»** (`proximo_hito=vencido`).
- En el celular, la tarjeta de la compra lleva el próximo hito en una línea.

### 4.3 Alta de embarque y diálogo «Fechas del embarque»

- **Alta**: Zarpe, Arribo (oculto en `local`), **Ingreso CD** (obligatorio; ayuda «Si solo sabes el mes, pon el 15»), Inicio operativo (fecha y hora opcional), **Ingreso al stock** (vacío = «el mismo día del Ingreso CD») y **Origen**. Nota ⓘ: «El Ingreso al stock decide el mes en que la mercadería cuenta en el flujo». **Editar** (`PATCH`) ya no tiene fechas: las muestra de solo lectura con **«Cambiar fechas»**.
- **Diálogo**:

| Hito | Ahora | Nueva | ¿Ya ocurrió? |
|---|---|---|---|
| 🔵 Zarpe | 05-oct ✓ | — | ☑ |
| 🔴 Arribo | 08-nov | [18-nov] | ☐ |
| ⚫ Ingreso CD | 15-nov | [03-dic] | ☐ |
| 🚀 Inicio operativo | — | [04-dic] [hh:mm] | ☐ (al marcar, «Ahora» propone la hora) |
| 🟢 Ingreso al stock (manda el mes) | 15-nov *(igual al Ingreso CD)* | → **03-dic** *(sigue al Ingreso CD)* · [Fijar fecha] | al recibir |

- Sin fijar, el ingreso **sigue al Ingreso CD en vivo**; fijado, muestra **«Igualar al Ingreso CD»**.
- **Motivo y causa**: solo si se reprograma (§2.10, paso 3). Si solo cambia el ingreso al stock, la causa se propone `programacion`.
- **Vista previa**: «El ingreso al stock pasa de 15-nov a 03-dic. **Cambia el mes: mueve 12 líneas de 5 compras de nov-26 a dic-26.** El paquete "Al barrer" tiene ingreso propio (15-ene) y no se mueve.» O bien: «Estas fechas no cambian el mes: el flujo no se mueve».
- **Mensajes**: «Este embarque ya tiene ingresos confirmados: el mes no se puede cambiar.» · «No puedes marcar como ocurrida una fecha futura.» · «Pon la fecha del inicio operativo antes que la hora.» · «Cambió el embarque mientras editabas: vuelve a abrirlo.»

### 4.4 Línea de tiempo del embarque

- Los **cinco hitos logísticos** con la marca de «hoy», estado, retraso contra lo planeado al crear y número de cambios. Encima, «Órdenes de compra: 06-jul a 20-jul · 5 compras» (el rango de `fecha_compra` de sus compras).
- Debajo del Ingreso al stock, los **paquetes con ingreso propio**: «Al barrer · tanda 1 → 15-ene (dic → ene) · 600 u de 2 lotes».
- A 390 px, en vertical.

### 4.5 Paquetes y lo al barrer

- **En cada paquete**: «Ingreso al stock: hereda del embarque (03-dic)» o «Ingreso propio: 15-ene», con **«Fijar ingreso…»** (motivo, causa y vista previa con temporada: «2 lotes al barrer cambian de temporada: verano → invierno, se reparten de nuevo con la versión 3»).
- **«Mover a paquete»**: unidades editables por asignación, con vista previa si cambia de mes.
- **«Programar lo al barrer»** (§2.5) con **«Agregar otra tanda»**; la suma queda a la vista: «Asignado 1 000 de 1 000 u».

### 4.6 Repartir las compras de un viaje (COTV)

Sin pantalla nueva: «Sin agrupador» (filtro Proveedor, «Asignar a embarque…») y «Agregar compras» del detalle del embarque (filtros Viaje y Proveedor, «Marcar las visibles», unidades editables, vista previa). Lo nuevo que se ve es el **Origen** en el selector de embarques («Embarque 261201 · California») y, en cada compra, su línea de tiempo con un tramo por embarque.

### 4.7 Lista de Embarques e Historial

- **Lista de Embarques**: columnas Zarpe · Arribo · Ingreso CD · Inicio operativo · **Ingreso al stock** (fecha y mes; «fijado» o «igual al Ingreso CD») · Origen · **Próximo hito** · **Reprogramado ×N**; filtros Atrasados, Reprogramados y Origen; en el celular, tarjetas.
- **Historial**, en llano y por hito:
  - «C1 cambió las fechas · Causa: Aduana · "Aforo físico" · Ingreso CD 15-nov → 03-dic · Ingreso al stock 15-nov → 03-dic (sigue al Ingreso CD; movió 5 compras de nov a dic)»;
  - «A marcó el inicio operativo: 05-nov 09:22 (ocurrió)»;
  - «C2 fijó el ingreso al stock del paquete Al barrer: 15-ene (causa: Programación)».

### 4.8 Qué ve cada rol

Los tres roles: todo lo de esta ficha (el comprador ya ve Compras y escribe agrupadores, decisiones 92 y 108). Solo admin y planner: lo que ya lo era (cancelar, cerrar, reabrir).

## 5. Reglas de negocio (con su prueba en vitest)

| # | Regla |
|---|---|
| F-R1 | Mes de un embarque = mes de `coalesce(real, ingreso al stock, Ingreso CD)`, en la columna y en TS. Mes de una asignación = el de su paquete si tiene ingreso propio; si no, el del embarque (I2 generalizada). Zarpe, Arribo, Inicio operativo y `hito_confirmado` nunca tocan compras (I6) |
| F-R2 | Ingreso al stock nulo = el día del Ingreso CD, y lo sigue. Fijado no se mueve si cambia el Ingreso CD. «Igualar al Ingreso CD» lo vuelve a nulo. El Inicio operativo nunca decide el mes |
| F-R3 | Reprogramar exige motivo y causa; completar una fecha u hora vacía, confirmar un hito o que el ingreso sin fijar siga al Ingreso CD, no (§2.10 paso 3) |
| F-R4 | Zarpe ≤ Ingreso CD bloquea; Arribo en `local` y hora sin fecha bloquean. Cualquier otro desorden entre hitos solo avisa |
| F-R5 | Confirmar un hito exige su fecha, no futura (con hora si la tiene), deja los anteriores sin fecha como «ocurrió sin fecha» y pasa el embarque a en tránsito. Volver a planificado con un hito confirmado da `hito_confirmado` |
| F-R6 | El ingreso de un paquete, o mover a un paquete con otro mes, mueve entregas, reparte de nuevo los lotes si cambia la temporada (misma versión) y respeta las recepciones vinculadas |
| F-R7 | `mover_a_paquete` acepta unidades parciales y `Σ` de la línea no cambia (I3) |
| F-R8 | Asignar a un embarque compras sin embarque mueve unidades dentro de la misma línea: `Σ` por línea y `Σ` del flujo no cambian (sin doble conteo) |
| F-R9 | Reprogramaciones y retraso se derivan de los eventos, sin contar `correccion` ni `programacion` |
| F-R10 | `PATCH` no cambia ni vacía fechas ni horas |
| F-R11 | Importador de agrupadores: `FECHA_INGRESO_CD` (o `FECHA_LLEGADA`) obligatoria; sinónimos; `INICIO_OPERATIVO` con hora opcional; `FECHA_INGRESO_STOCK` vacía = Ingreso CD |
| F-R12 | La `0038` no mueve nada: mismas `periodo_llegada`, entregas y asignaciones, y `agrupadores_desalineados() = 0` antes y después |
| F-R13 | Línea de tiempo de la compra: un tramo por (embarque, paquete) más uno por mes sin embarque; Σ unidades de los tramos = Σ de las líneas de la compra; estados según §2.2; próximo hito según §3.4 |
| F-R14 | Número de OC: editarlo no sube `compras.revision` ni bloquea movimientos, deja el evento `editar_oc` con antes y después, rechaza si cambió entre medio (`oc_cambio`) y no se edita en una compra cancelada. No es único: repetirla avisa. La `referencia` nunca cambia. En el importador, la `OC` no entra en la huella, vacía no borra y el comprador solo la pone en compras nuevas o en su borrador |

### Casos numéricos

**Supuestos del fixture de 08b**: hoy es **2026-11-12** (Lima, 10:00), `k' = 2026-09` y temporadas por defecto (verano oct–mar, invierno abr–sep).

**Datos de partida**:

- **261101**: importación, viaje 261001. Zarpe 05-oct, Arribo 08-nov, Ingreso CD 15-nov, sin Inicio operativo, ingreso al stock nulo → **nov-26**. Contiene l1 de C-000101 (fecha de compra 06-jul-26; nov 300; la línea tiene además dic 200 sin embarque) y C-000102 POLO (nov 400).
- **270301**: Ingreso CD 05-mar-27, ingreso nulo → mar-27. Contiene l2 de C-000101, el lote BETA de 1 000 u (mar 600 en el embarque · abr 400 sin embarque, reparto v2).

| # | Acción | Resultado esperado |
|---|---|---|
| F1 | Crear con Ingreso CD 15-nov sin ingreso al stock | Ingreso nulo, mes nov, código `2611##`. Con ingreso 02-dic: mes dic, código `2611##`. Sin Ingreso CD → `fecha_requerida` |
| F2 | Aplicar la `0038` sobre el fixture de 08b cargado | Hitos nuevos nulos y meses iguales. Entregas y asignaciones intactas. `agrupadores_desalineados() = 0`. Aplicarla dos veces no da error |
| F3 | C1 cambia el Ingreso CD de 261101 a 03-dic (causa `aduana`) | El ingreso sin fijar sigue: 03-dic. **Cambia el mes**: l1 nov 300 → dic, se funde con la dic 200 (`entregas_fusionadas`; la de dic conserva su `id`). POLO nov 400 → dic 400. `revision` +1 en las dos compras. Un evento de embarque. Ingreso CD: 1 reprogramación, +18 d |
| F4 | Desde el inicio, fijar el ingreso al stock de 261101 en 28-nov (causa `cola_conteo`) | Mismo mes: I6. Un evento con causa. Ingreso al stock: 1 reprogramación |
| F5 | Fijar el ingreso al stock de 261101 en 04-dic (causa `programacion`) | Mueve a dic como en F3. El contador de atraso **no** sube |
| F6 | «Igualar al Ingreso CD» | Vuelve a nov. l1 queda nov 300 · dic 200 (la de dic con su `id` original) |
| F7 | Con el ingreso fijado en 04-dic, mover el Ingreso CD a 10-dic (causa `naviera`) | El ingreso queda en 04-dic y no se mueve nada (I6). Aviso `orden_de_fechas` |
| F8 | Cambiar el Arribo de 08-nov a 18-nov (causa `naviera`) | Compras sin cambio y huella del flujo idéntica (I6). Arribo: 1 reprogramación, +10 d |
| F9 | F8 sin causa, o sin motivo | `causa_requerida` / `motivo_requerido`. Completar un Arribo vacío no los pide. Fijar por primera vez un ingreso que cambia la fecha efectiva sí |
| F10 | Paquete «Al barrer» en 270301 con ingreso **04-abr-27**; mover las 600 u de l2 que están en mar | La entrega de mar desaparece y abr queda con 1 000 u, repartidas con **v2 e invierno**. Aviso `cambia_temporada`. Sin vector de invierno en v2: `reparto_sin_vector` y nada cambia |
| F11 | Desde el inicio, por partes: 300 u a «tanda 1» (ingreso 04-abr) y 300 a «tanda 2» (ingreso 10-may) | l2 queda abr 700 (300 de la tanda 1 + 400 sin embarque) · may 300, cada una con el vector de invierno. Σ = 1 000 (I3) |
| F12 | Mover el Ingreso CD de 270301 a 02-abr-27 con los paquetes ya programados | Lo que no está en paquete pasa a abr; los paquetes con ingreso propio no se mueven |
| F13 | Ingreso de paquete con una recepción vinculada (en el humo se inserta como `postgres`), cambiando de mes | `asignacion_con_recepciones` |
| F14 | Importar 3 filas `VIAJE = 261001`, `LLEGADA = 2026-12`, sin `EMBARQUE`: C-000201 (Proveedor Norte, 300 u, compra 06-jul), C-000202 (Feria Sur, 500 u, compra 10-jul), C-000203 (Proveedor Norte, 200 u) | Tres compras con entrega dic-26 **sin embarque**. Flujo de dic +1 000 u. Línea de tiempo de C-000201: un tramo «Sin embarque · 300 u» con ⚪ 06/07/2026 Ocurrió, 🔵🔴⚫🚀 Pendiente y 🟢 «dic-26, sin embarque» |
| F15 | Crear «California» (origen California, Ingreso CD 15-dic → dic) y «Nueva York» (Ingreso CD 15-ene-27 → ene). Asignar: Proveedor Norte (C-000201 300 y C-000203 200) → California; C-000202 250 → California y 250 → Nueva York | dic-26 750 u y ene-27 250 u: **Σ 1 000, sin doble conteo**. C-000202 queda con dos entregas (dic 250 · ene 250) y **dos tramos** en su línea de tiempo (California 250 · Nueva York 250). Nada queda sin embarque |
| F16 | Reimportar el archivo de F14 | 3 `igual`. No se mueve nada |
| F17 | Fila de compras con `EMBARQUE` = Nueva York y `LLEGADA = 2026-12` | `llegada_distinta_del_embarque` (compara con el mes del ingreso al stock). Con `2027-01`, entra |
| F18 | Importar agrupadores con un archivo viejo (`FECHA_SALIDA`, `FECHA_LLEGADA`) | Se leen como Zarpe e Ingreso CD; ingreso al stock nulo. Reimportar da `igual`. `INICIO_OPERATIVO = 2026-11-05 09:22` queda con fecha y hora; `= 2026-11-05` solo con fecha; `= 2026-11-05 25:10` da `hora_invalida`. `FECHA_LLEGADA` y `FECHA_INGRESO_CD` distintas: `fechas_en_conflicto` |
| F19 | Zarpe 25-nov con Ingreso CD 22-nov | `salida_despues_de_llegada`. Si en el mismo envío el Ingreso CD pasa a 30-nov: OK. Arribo en un `local`: `puerto_en_local`. Hora sin fecha de Inicio operativo: `hora_sin_fecha` |
| F20 | Marcar «ya arribó» con el Arribo en 18-nov (futuro) | `fecha_futura`. Marcar «ya zarpó» con el embarque planificado: pasa a en tránsito. Volver a planificado: `hito_confirmado` |
| F21 | **El caso de Javier**: embarque con Zarpe y Arribo vacíos, Ingreso CD 02-nov-26; marcar `hito_confirmado = inicio_operativo` con Inicio operativo 05-nov-26 09:22 | Se acepta. Zarpe y Arribo quedan `sin_registrar` («Ocurrió · sin fecha»); Ingreso CD e Inicio operativo `real`; ingreso al stock 02-nov `previsto`… salvo que sea pasado: `vencido` (hoy es 12-nov). Con Inicio operativo 12-nov 11:00 (más tarde que la hora de hoy): `fecha_futura` |
| F22 | `PATCH` sin `fecha_salida_estimada` | **La salida se conserva** (hoy se borra). Si trae una distinta: `fecha_por_movimiento` |
| F23 | Alias `/fecha` | Igual que `/fechas` con solo el Ingreso CD y causa `otro` |
| F24 | `agrupador_hitos_resumen` tras F3, F5 y F8 | Ingreso CD 1 reprogramación (+18 d, `aduana`); Arribo 1 (+10 d); el cambio de F5 queda en el historial y no suma atraso |
| F25 | Línea de tiempo y próximo hito de C-000101 (fixture de partida) | Tramos: 261101 nov 300 · «Sin embarque» dic 200 · 270301 mar 600 · «Sin embarque» abr 400. Σ = 1 500 = Σ de sus líneas. Próximo hito: ⚫ Ingreso CD 15-nov Previsto (Arribo 08-nov es `vencido`: gana el vencido → «🔴 Arribo · 08-nov · Vencido (hace 4 días)») |
| F26 | Hoja `LINEA_DE_TIEMPO` del Excel con el estado de F15 | Una fila por compra y tramo (C-000202 en dos filas), ordenadas por proveedor; fechas como fecha de Excel; el Inicio operativo con hora cuando la tiene; estados en texto |

| F27 | Registrar la OC `4500012345` en C-000201 (sin OC, `antes = null`) | `numero_oc` guardada; `compras.revision` **igual**; un evento `editar_oc` con `antes { numero_oc: null }` y `despues`; la huella del flujo cambia una vez y ninguna cifra del flujo cambia. Un plan de movimiento previsualizado antes sobre C-000201 se aplica sin `plan_cambio` |
| F28 | Dos personas editan la OC a la vez con `antes = null`; la segunda llega después | La segunda: `409 oc_cambio`, sin escribir. Con `antes` igual al nuevo valor ya guardado y el mismo número: `sin_cambios` |
| F29 | Editar la OC de una compra cancelada | `no_editable` |
| F30 | Poner `4500012345` también en C-000203 (Proveedor Norte) y en C-000202 (Feria Sur) | C-000203: se guarda con `oc_repetida`. C-000202: se guarda con `oc_de_otro_proveedor`. Quitar la OC (`null`) deja el evento «OC: 4500012345 → —» |
| F31 | Reimportar el archivo de F14 con la columna `OC` llena (C-000201 `4500012345`, C-000202 vacía), como admin | Líneas: 3 `igual`. C-000201 queda con OC (reporte «OC registrada»); C-000202 sin cambio (vacía no borra). Reimportar otra vez: nada cambia. Dos filas de una compra con OC distintas: `oc_distinta_en_compra` y la OC no se aplica |
| F32 | Un comprador importa un archivo con `OC` para una compra confirmada ajena | Sus líneas siguen la decisión 109; la OC se omite con `oc_no_editable`; la función también lo rechaza si el backend la llamara igual. En una compra nueva suya, la OC se registra |
| F33 | Buscar en la lista de Compras por `4500012345`, por `c-000201` y por `COTV-` | Encuentra por OC, por código X y por referencia; la columna Compra muestra el código X y la OC. La hoja `LINEA_DE_TIEMPO` y la hoja `ASIGNACIONES` llevan la OC |

**Concurrencia** (`tests/integracion/concurrencia.int.test.ts`; ninguna debe dar `40P01`):

- (a) `/fechas` con cambio de mes contra `asignar_viaje_compras`, con una compra compartida.
- (b) `/fechas` contra `guardar_embarque` del mismo embarque.
- (c) Ingreso de un paquete contra `guardar_paquete` del mismo embarque.
- (d) `mover_a_paquete` con unidades contra «Agregar compras» (asignar) sobre la misma compra.
- (e) `editar_oc_compra` contra `aplicar_movimiento_agrupador` sobre la misma compra: los dos terminan, y el movimiento no recibe `compra_cambio` (la OC no sube la revisión).

**Humo `scripts/humo-0038.sql`**: casos F2, F3, F5, F6, F8, F10, F13, F15, F21, F27, F28 y F29 en SQL; I6 a I8; el `check` de hora sin fecha y el de `numero_oc`; la expresión de `periodo_llegada` (`pg_get_expr`; en el plan B, la de `periodo_ingreso`); `guardar_embarque` al editar sin salida conserva la salida (F22); aplicar la migración dos veces; privilegios; `migraciones_aplicadas`.

## 6. Criterios de aceptación / hito de prueba

- [ ] `select version()` de `vector-two` anotado en §9.1 y camino A o B elegido **antes** de escribir la `0038`.
- [ ] La `0038` aplica dos veces; humo en verde; tipos regenerados; F2 sin movimiento.
- [ ] lint, `tsc`, vitest (F1–F33 y los casos 1–19 de 08b sin tocarlos; las pruebas del importador de M8 sin tocar, salvo las nuevas de `OC`) y build en verde. Concurrencia (a) a (e) sin `40P01`.
- [ ] **Javier, línea de tiempo**: abrir una compra y ver sus seis hitos con los marcadores ⚪🔵🔴⚫🚀🟢 y el estado en texto; registrar el caso de su ejemplo (Zarpe y Arribo sin fecha, Ingreso CD, Inicio operativo con hora) y verlo igual que en su reporte. Ver «Próximo hito» en la lista de Compras y filtrar los vencidos. Descargar el Excel y revisar la hoja `LINEA_DE_TIEMPO`.
- [ ] **Javier, número de OC**: ver una compra nueva con su código X y «OC sin registrar»; registrar la OC, cambiarla con un motivo y ver las dos cosas en el historial; buscar la compra por su OC en la lista; reimportar una planilla con la columna `OC` y comprobar que no se duplicó ninguna compra.
- [ ] **Javier, fechas**: crear un embarque con su Ingreso CD y ver que ingresa al stock el mismo día. Fijar el ingreso al stock en otro mes y ver en Flujo mensual que las compras cambian de mes; «Igualar al Ingreso CD» y verlas volver. Reprogramar el Ingreso CD por «Aduana». Marcar «ya zarpó». Editar el nombre de un embarque y comprobar que el zarpe **no** se borra.
- [ ] **Javier, lo al barrer**: «Programar lo al barrer» en un embarque con un lote, primero todo junto y después en dos tandas; ver el cambio de temporada en la vista previa y el lote en sus meses en el Flujo.
- [ ] **Javier, COTV** (cuando C2 esté lista): importar la planilla con `LLEGADA = 2026-12` y ver las compras en diciembre en el Flujo, con la orden de compra en su línea de tiempo. Crear «California» y «Nueva York» con origen y fechas, asignar por proveedor (una compra partida entre los dos: dos tramos) y comprobar que el total del flujo no cambió y que nada queda en «Sin agrupador».
- [ ] Historial con causa y motivo, contador de reprogramaciones, Atrasados, todo a 390 px, y los marcadores legibles sin color (lector de pantalla y escala de grises).
- [ ] `seguridad` (sonnet): guards, IDOR de paquetes y asignaciones en `mover_a_paquete` con unidades y en `paquetes/[id]/ingreso`, que `linea_de_tiempo` no exponga embarques de otra compra, que `/oc` no permita editar sin `antes` correcto ni una compra cancelada, que el comprador no pise OC ajenas por el importador, funciones solo `service_role`, catálogos zod.

## 7. Fuera de alcance

- Fechas logísticas propias por compra dentro de un embarque (§2.1); conteo, arribo o inicio operativo propios del paquete; «ya ocurrió» por paquete.
- Editar la fecha de la Orden de compra (`fecha_compra`) desde esta pantalla: es de `0.13.1`.
- Editar la `referencia` de importación; unir varias compras que comparten OC en una sola; OC única obligatoria; traer la OC desde SAP automáticamente.
- Cola calculada o con capacidad; parámetros de cola.
- Embarque o mes provisional por viaje; avisos o banners de unidades sin repartir.
- Operación «dividir por origen» y filtro por región del proveedor (mejora futura tras E1 de la 08c, §2.7).
- Maestro de almacenes de origen (más adelante, en la ficha del proveedor de la 08c).
- Hora en otros hitos que no sean el Inicio operativo; seguimiento naviero o de aduana; fecha real por hito distinta de la confirmación, salvo el ingreso (08b-2).
- Pagos como entidad (118).
- Columnas logísticas en el importador de compras; cambios al flujo.
- Que el importador de agrupadores edite o complete lo existente (decisión 97).
- Recibir y confirmar el ingreso al stock: 08b-2.

## 8. Decisiones propuestas (a registrar al construir; reemplazan las 115 a 119 de las revisiones anteriores; 120 y 121 nuevas)

| N.º | Decisión |
|---|---|
| 115 | **El mes del flujo es el del ingreso al stock.** `fecha_llegada_estimada` conserva su significado de origen (Ingreso CD) y es la obligatoria. El ingreso al stock es una columna nueva, nula = el día del Ingreso CD. `periodo_llegada = mes de coalesce(real, ingreso, Ingreso CD)`, cambiando la expresión de la columna generada si `vector-two` es Postgres 17 o, si no, con una columna generada nueva y todos sus lectores reemplazados. Precisa la 83 |
| 116 | **Toda reprogramación lleva motivo y causa** (catálogo con `pago`, `cola_conteo`, `programacion`, `correccion`…); completar, confirmar o que el ingreso sin fijar siga al Ingreso CD, no. Contadores y retraso derivados de los eventos, sin contar `correccion` ni `programacion`. «Ya ocurrió» con `hito_confirmado`: exige la fecha del hito confirmado, no futura; los anteriores sin fecha quedan «ocurrió sin fecha». Los desórdenes avisan; solo zarpe > Ingreso CD, arribo en local y hora sin fecha bloquean. El `PATCH` de un embarque nunca cambia ni vacía fechas |
| 117 | **Compras de COTV: entran con su viaje, `FECHA_COMPRA` de COTV, `LLEGADA = 2026-12` y sin embarque**, y cuentan en diciembre como cualquier entrega sin embarque. Javier las reparte por proveedor con «Asignar» por unidades, que mueve unidades dentro de la misma línea (sin doble conteo). Sin embarque ni mes provisional. El origen (California o Nueva York) es un dato de texto del embarque. Si de un embarque solo se sabe el mes, su fecha es el día 15. Responde G2 de 08c §12.8 y cambia §12.2 b |
| 118 | **Pagos: causa de la reprogramación, no un campo** (Javier, P2) |
| 119 | **El ingreso al stock lo fija Javier**, sin cola calculada ni parámetros: por embarque (nulo = Ingreso CD) y **por paquete** (ingreso propio). Lo al barrer se programa por paquete, todo junto o por partes en varios paquetes, y se reparte de nuevo con la temporada del mes nuevo (decisión 86). Levanta «fecha propia del paquete», que 08b §7 dejaba fuera, solo para el ingreso |
| 120 | **Línea de tiempo por compra con seis hitos**: Orden de compra (`compras.fecha_compra`), Zarpe, Arribo, Ingreso CD, **Inicio operativo** (nuevo, fecha más hora opcional en dos columnas, no `timestamptz`) e Ingreso al stock. Los cinco logísticos viven en el embarque y la compra los hereda, sin fechas propias por compra; una compra repartida tiene un tramo por embarque y paquete, y lo sin embarque es su propio tramo. Estados `real`, `sin_registrar`, `vencido`, `previsto`, `pendiente` y `no_aplica`, siempre en texto además del color. Se ve en el detalle de la compra, como «Próximo hito» en la lista de Compras, en el embarque y en la hoja `LINEA_DE_TIEMPO` del Excel |
| 121 | **Número de OC aparte del código X y de la referencia.** Toda compra nace con su código X (`compras.numero`, inmutable). La OC real va en `compras.numero_oc` (nueva, nula, ≤ 40, no única: repetida avisa), editable por los tres roles en pantalla con `editar_oc_compra`, que compara el valor previo y **no sube `compras.revision`** (como `editar_ficha_linea`; matiza la 60) y deja el evento `editar_oc`. La `referencia` del importador nunca se edita, para no romper la reimportación. El importador de compras suma la columna `OC`, fuera de la huella; vacía no borra; el comprador solo la pone en compras nuevas o en su borrador (decisión 109) |

## 9. Plan de construcción

### 9.1 Antes de empezar

- **Lugar en el camino de compras**: 08b-1 ✔ → **08b-1b** → E1 → 08b-2 → E2 → E3. 08b-2 se construye ya sobre «ingreso real», I2 por paquete y la línea de tiempo (su «Recibir» pone el 🟢 en `real`). Nunca en paralelo con otra entrega de compras. **La carga C2 de COTV no depende de esta entrega** (usa el importador sin cambios), pero conviene hacerla después para que Javier reparta ya con origen, fechas y línea de tiempo.
- **T1 de `datos`, primera tarea** (solo lectura en `vector-two`, ref `tzjsxzmsvvhxyiooihyq`):
  - `select version(); show server_version_num;` → **resultado: _por anotar_**. ≥ 170000: camino A de §2.4; si no, camino B.
  - Conteo de embarques, paquetes y asignaciones, y `agrupadores_desalineados()`, para el antes y el después de F2.
  - Poner al día el registro de PLAN §5, al que le faltan la `0035`, la `0036` y la `0037`.

### 9.2 Tandas

| Tanda | Agente | Depende de | Archivos | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Contratos | `backend` | — | `src/lib/compras/agrupadores/{tipos,tipos-api,esquemas}.ts`; los campos aditivos de `CompraApi`, `editarOcSchema`, la acción `editar_oc` y la columna `oc` de la fila del importador en `src/lib/compras/{tipos,tipos-api,esquemas}.ts`; `tests/agrupadores.fixture.ts` (casos F) y `tests/agrupadores.esquemas.test.ts` | `tsc` limpio |
| T1 · Datos | `datos` | — | Versión de Postgres (§9.1) primero; `supabase/migrations/0038_fechas_logisticas_embarque.sql` (columnas de §2.1, `periodo_llegada` por A o B, funciones de §2.9, `compras.numero_oc` con su índice y `editar_oc_compra` de §2.11), `scripts/humo-0038.sql`, `src/lib/supabase/database.types.ts`, PLAN §5 | Aplica dos veces; humo en verde; F2; `agrupador_hitos_resumen` < 50 ms con 500 embarques |
| T2 · Lógica pura | `backend` | T0 | `movimiento.ts` (`planCambiarFechas`, `planIngresoPaquete`, unidades en `planMoverAPaquete`, I2 por paquete, `periodoLlegada` de tres argumentos), nuevo `hitos.ts` (`estadoHito`, `lineaDeTiempo`, `proximoHito`, resumen), `avisos.ts`, `importar.ts` y `plantilla.ts` (agrupadores, con la hora), `excel.ts` (`hojaLineaDeTiempo`, OC en `ASIGNACIONES`); `src/lib/compras/importar.ts` (columna `OC`: lectura, avisos, regla del comprador, fuera de la huella); pruebas `tests/agrupadores.{fechas,hitos,linea-tiempo,paquete-ingreso,importar,excel}.test.ts` y el reparto COTV (F14–F16) en `tests/agrupadores.movimiento.test.ts`; `tests/compras.importar.test.ts` (F31, F32) | F-R1 a F-R14 en verde; M8, M12 y 08b sin tocar sus pruebas |
| T3a · Pantallas | `frontend` | T0 | `modal-embarque.tsx`, `dialogo-fechas.tsx` (reemplaza `dialogo-fecha.tsx`), `linea-tiempo.tsx` (nuevo, compartido por compra y embarque, con los marcadores accesibles), `modal-paquete.tsx` y `dialogo-a-paquete.tsx`, `dialogo-programar-barrer.tsx` (nuevo), `lista-embarques.tsx`, `filtros-embarques.tsx`, `historial.tsx`, `insignias.tsx`, origen en el selector de `dialogo-asignar.tsx`; en `src/components/compras/`: encabezado con código X y OC, diálogo «Registrar / Editar OC», la línea de tiempo en el detalle de la compra, la columna Compra con OC, «Próximo hito» con su filtro y el buscador por OC en la lista; reporte del importador con la OC | build y `tsc` limpios; 390 px |
| T3b · Servicio y API | `backend` | T1, T2 | `agrupadores/consultas.ts` y `servicio.ts` (**corrige el `?? null` del PATCH**); rutas `embarques/[id]/fechas`, `paquetes/[id]/ingreso`; cambios en `embarques/[id]` (PATCH), `[id]/fecha` (alias), `[id]/paquete`, `[id]/estado`, `embarques/route.ts`; lectura aditiva en `src/lib/compras/consultas.ts` y en `GET /api/compras` y `GET /api/compras/[id]`; ruta nueva `src/app/api/compras/[id]/oc/route.ts`; la cuarta llamada (`editar_oc_compra`) en la aplicación del importador de compras; pruebas `tests/agrupadores.{handlers,estatico}.test.ts`, `tests/compras.handlers.test.ts` (solo los campos nuevos) y `tests/api.guards.roles.test.ts` | F-R3, F-R10, F22, F23, F25 y F27–F32 en verde |
| T4 · Integración | `frontend` | T3a, T3b | Los de T3a | F3, F10, F11, F14, F15, F21, F27, F31 y F33 a mano |
| T5 · Cierre | `qa` (con concurrencia), `seguridad` (sonnet), `documentador` | T4 | docs (08b §11, esta ficha con su sección de construido, 08c §12.2 b y §12.8 G2 según la decisión 117 (y la columna `OC` de la planilla C2), una nota en 08 §0.17 que apunte a §2.11 de esta ficha, PLAN, CHANGELOG, DECISIONES 115–121, checklist), `src/lib/version.ts` | Hito con Javier |

**Versión sugerida**: `0.17.0 · M8 b`.

### 9.3 Riesgos

1. **Versión de Postgres.** Si `vector-two` no es 17, `set expression` falla. *Mitigación*: T1 lo comprueba antes de escribir la migración; camino B con prueba estática de lectores.
2. **Reemplazar `aplicar_movimiento_agrupador` por tercera vez**, ahora con I2 por paquete y unidades en `mover_a_paquete`. *Mitigación*: partir de la `0036`; diff acotado a `cambiar_fecha`, `mover_a_paquete` y la comprobación de I2; volver a correr los humos de la `0032`, `0034` y `0036`.
3. **Lotes al barrer que cambian de temporada** al programar su ingreso. *Mitigación*: la vista previa lo dice siempre; sin vector de la temporada nueva, `reparto_sin_vector`; Javier aprueba el vector en M12 antes.
4. **Compras de COTV sin repartir** contando en diciembre. *Mitigación*: «Sin agrupador» las muestra con su viaje y su línea de tiempo dice «Sin embarque»; el hito de C2 comprueba que no quede nada.
5. **La lista de Compras se vuelve más lenta** por el próximo hito. *Mitigación*: dos consultas por página en tandas de 150 ids (§3.4); `qa` mide la lista con 500 compras (presupuesto: ≤ 300 ms más que hoy).
6. **La Orden de compra de COTV es la fecha de registro**, no la de la orden real, y puede correrse un día por UTC. *Mitigación*: la planilla C2 la muestra y Javier la corrige antes de importar.
7. **El texto «Llegada»** en pantallas viejas. *Mitigación*: prueba estática sobre `src/components/compras/agrupadores/**`; solo puede quedar en el sinónimo del importador.
8. **Recibir (08b-2) con paquetes con ingreso propio.** Su ficha debe fijar qué pasa con el ingreso real cuando el paquete entra en otra fecha. *Propuesta*: cada recepción ya lleva su mes X, y «Registrar otra llegada» cubre la tanda posterior.
9. **Una OC escrita mal** en varias compras por el importador. *Mitigación*: el reporte la muestra por compra con sus avisos antes de aplicar; quitarla o corregirla en pantalla deja historial.

## 10. Contradicciones con lo construido o especificado

1. **Decisión 83 y 08b §2.4.** La «llegada al CD» mandaba el mes. Ahora manda el ingreso al stock, y la llegada al CD es el hito Ingreso CD (115).
2. **08c §12.2 b y §12.8 G2** dejaban `LLEGADA` vacía para que Javier la completara. Ahora va **`2026-12`** en todas las filas (117). §12.3 («habría que inventarla») queda respondida por Javier.
3. **08b §7, «Fecha propia del paquete» fuera de alcance**, y 08b §3.3: `mover_a_paquete` «no mueve meses» y va con asignaciones enteras. Ahora el paquete tiene ingreso propio y mover a paquete puede mover meses y por unidades (119). Cambian I2 y R1 de 08b.
4. **«Avisos, no bloqueos».** Zarpe > Ingreso CD sigue bloqueando por el check de la `0032`; se suman `puerto_en_local` y `hora_sin_fecha`.
5. **Defecto en lo construido** (§0): el `PATCH` borra la salida si no la trae. Se corrige en `servicio.ts` y en `guardar_embarque` (F22).
6. **Rutas de M8** (`GET /api/compras` y `/api/compras/[id]`) ganan campos de solo lectura (`linea_de_tiempo`, `proximo_hito`, `numero_oc`). Es la primera vez que la lectura de compras lee embarques para algo más que la etiqueta.
7. **PLAN §5** no registra la `0035`, la `0036` ni la `0037`.
8. **La decisión 94 dice «siempre `for update`»**, pero la `0036` usa `for no key update` en viajes y embarques. Esta ficha sigue la `0036`.
9. **Decisión 97.** El importador de agrupadores no completa fechas de embarques existentes; se hace en pantalla.
10. **Convención «sin backfill».** Se respeta: nada se copia. `set expression` (o la columna generada nueva del plan B) es un cambio de esquema, no de datos, pero reescribe la tabla. Se anota como la primera vez que el proyecto lo usa.
11. **Decisión 60** («toda mutación de compras con `revision`»): `editar_oc_compra` escribe la cabecera de la compra **sin** subir la revisión, con candado de fila y valor previo. Es la misma matiz que ya se aceptó para la descripción y el modelo de una línea (decisión del 2026-11-04, propuesta 88 de 08c), ahora en un campo de la cabecera.
12. **Importador de M8**: suma una columna y una cuarta llamada por compra. La clasificación (`nueva`, `igual`, `cambiada`) y la huella no cambian.

## 11. Qué cambió

### 11.1 Respecto de la revisión 2 (commit `573d865`)

| Tema | Revisión 2 | Revisión 4 | Por qué |
|---|---|---|---|
| Hitos | Cuatro, del embarque (sale, puerto, conteo, ingreso) | **Seis en la línea de tiempo de la compra**: Orden de compra (de la compra) + cinco del embarque, con **Inicio operativo** nuevo (fecha y hora) | Pedido de Javier con su reporte ⚪🔵🔴⚫🚀 |
| Nombres | Sale · Llega a puerto · Llega a conteo · Ingresa al stock | Zarpe · Arribo · **Ingreso CD** · Inicio operativo · Ingreso al stock (los de Javier). «Llega a conteo» = Ingreso CD, misma columna | Ídem |
| `hito_confirmado` | `embarque`, `puerto`, `conteo`, secuencial estricto (los anteriores con fecha) | `zarpe`, `arribo`, `ingreso_cd`, `inicio_operativo`; los anteriores sin fecha quedan «ocurrió sin fecha» | El ejemplo de Javier tiene Zarpe y Arribo «Pendiente» con el Ingreso CD ya ocurrido |
| Estados de hito | Ocurrió, previsto, vencido | Seis estados (§2.2), en texto además del color | Accesibilidad y «Pendiente» de Javier |
| Pantallas | Embarque | Más **línea de tiempo en el detalle de la compra**, **«Próximo hito» en la lista de Compras** y hoja **`LINEA_DE_TIEMPO`** en el Excel | «Este detalle para la compra a cada proveedor» |
| Ingreso al stock | Calculado como conteo + días de cola, o programado a mano (`ingreso_programado`) | **Lo fija Javier**; nulo = el día del Ingreso CD. Sin bandera | «Yo defino la fecha esperada de ingreso» |
| Cola | `dias_cola_ingreso` y `dias_cola_ingreso_barrer`, aviso `cola_desactualizada`, concurrencia (e) | **Eliminados**, con la ruta de parámetros y la pantalla | Ídem |
| Compras de COTV | Embarque provisional «Por dividir» (`es_provisional`, índice único, I9), mes provisional, banner, ruta `provisionales`, avisos `mes_provisional`, `provisional_vencido`, `compra_sin_mes_propio` | **`LLEGADA = 2026-12` sin embarque** por el importador de siempre; Javier asigna por proveedor con «Agregar compras» / «Asignar a embarque…» | «Inicialmente ponle a todo llegada en diciembre»; «lo divido inmediatamente por proveedor» |
| Importador de compras | Reglas nuevas de mes | Sin reglas de mes; solo la columna **`OC`** (§3.7) | Ya no hace falta lo otro; la OC es pedido nuevo |
| Importador de agrupadores | `FECHA_CONTEO`, `FECHA_INGRESO`, `PROVISIONAL` | `FECHA_ZARPE`, `FECHA_ARRIBO`, `FECHA_INGRESO_CD`, **`INICIO_OPERATIVO` con hora**, `FECHA_INGRESO_STOCK`, `ORIGEN`; sinónimos `FECHA_SALIDA` y `FECHA_LLEGADA` | Nombres de Javier y hora |
| `pasar_pendientes`, `guardar_paquete` | Cambiaban | **Sin cambios** | Servían al Por dividir |
| `periodo_llegada` | `set expression` con plan B «reinterpretar la columna» | `set expression` si PG17; **plan B nuevo**: columna generada `periodo_ingreso` con todos los lectores reemplazados. Comparación A/B/C en §2.4 | El plan B viejo invertía el significado de lo cargado |
| Número de OC | — | **`compras.numero_oc`** editable con `editar_oc_compra` (sin subir la revisión), columna `OC` en el importador de compras, código X + OC en el encabezado, la lista, el buscador y el Excel | «Inicialmente … un código X, pero luego debo poder incluir el número de la OC» |
| Pruebas | F1–F24 | **F1–F33 rehechas** (F14–F17 COTV, F21 el caso de Javier, F25–F26 línea de tiempo y Excel, F27–F33 número de OC) | — |
| Decisiones | 115–119 | 115–119 reajustadas y **120** (línea de tiempo) y **121** (número de OC) nuevas | — |
| Preguntas | Tres | Respondidas; ninguna imprescindible | — |

### 11.2 Revisiones anteriores, en una línea

Revisión 1 → 2: `fecha_llegada_estimada` dejó de reinterpretarse como ingreso (vuelve a ser la llegada al CD) y el ingreso pasó a columna nueva; se sumaron `origen`, ingreso por paquete y las causas `cola_conteo` y `programacion`. Revisión 3 fue la simplificación de §11.1 sin la línea de tiempo; no se commiteó por separado.

## 12. Preguntas abiertas para Javier

Una sola, que **no bloquea** la construcción (se construye con la recomendación y se ajusta en el hito):

1. **¿Una misma OC puede cubrir varias compras del sistema?** Por ejemplo, en COTV cada producto quedó como una compra aparte, y en SAP todo lo de ese proveedor puede ser una sola orden. *Recomendación: sí, se permite y el sistema solo te avisa «esta OC ya está en otras compras de este proveedor»; si está en otro proveedor, te avisa también porque suele ser un error. Juntar esas compras en una sola queda para más adelante.* Si me dices que cada OC es de una sola compra, se vuelve obligatorio que no se repita (un cambio pequeño).

Lo demás se construye con la opción por defecto y Javier lo confirma en el hito (§6):

- **Orden de compra de COTV**: es el día en que se registró la compra en COTV. *Por defecto*: se usa tal cual y él la corrige en la planilla si la orden real es otra.
- **Inicio operativo**: se entiende como «empieza el conteo y el proceso en el CD», distinto del Ingreso CD (llega) y del Ingreso al stock (disponible). *Por defecto*: tres hitos separados; el mes lo manda solo el Ingreso al stock.

# 08b-1b · Línea de tiempo de la compra, número de OC y fechas logísticas del embarque

> **Estado (2026-11-05): especificada, sin construir. Revisión 5: lista para construir.** Es la revisión 4 (commit `31d2060`) con la **revisión independiente** del `arquitecto-revisor` (opus) integrada entera (dos bloqueantes, cuatro altos, siete medios y los bajos) y las **respuestas definitivas de Javier** a sus preguntas y a la jerarquía de compras. Es una mejora de 08b-1 (ficha [08b](08b-agrupadores-de-compras.md), que manda en todo lo que esta no cambie; su §11 describe lo construido). La diseñó el `arquitecto` (opus) leyendo las migraciones `0025`, `0032`, `0034` y `0036` (las versiones vigentes de las funciones de agrupadores son las de la `0036`), `src/lib/compras/**`, `src/components/compras/agrupadores/**` y el plan de carga de COTV (08c §12). No quedan preguntas para Javier (§12).
>
> **Pedidos de Javier** (textuales):
> - «déjalo para completar y tiene que ser editable, la logística no siempre es tan previsible, se demoran los pagos, los embarques, la aduana. Deberíamos marcar fecha de embarque, fecha prevista en puerto, fecha prevista en el área de conteo, fecha prevista de ingreso al stock».
> - «Inicialmente una nueva compra a un proveedor debe iniciar con un código X, pero luego debo poder incluir el número de la OC».
> - «Me vas a matar, quisiera tener este detalle para la compra a cada proveedor: ⚪ Orden de Compra: 06/07/2026 · 🔵 Zarpe (Salida): Pendiente · 🔴 Arribo (Puerto): Pendiente · ⚫ Ingreso CD: 02/11/2026 · 🚀 Inicio Operativo: 05/11/2026 09:22 · Ingreso al stock».
>
> **Respuestas de Javier** (mandan sobre todo lo anterior):
> - **Revisión 1** (P1–P4): las compras de COTV traen viaje y se dividen en dos embarques según el almacén (California o Nueva York); el pago es una **causa** de retraso; «ya ocurrió» se marca; la fecha que él conoce es la **llegada al CD** y el ingreso al stock se programa, sobre todo lo al barrer.
> - **Revisión 2**: (1) «Yo lo divido inmediatamente por proveedor en cuanto lo cargues para que cuente en el mes. Inicialmente ponle a todo llegada en diciembre.» → §2.7. (2) «Yo defino la fecha esperada de ingreso.» → §2.4. (3) Lo al barrer: «Soportar las dos formas» → §2.5.
> - **Revisión 4** (después de la revisión independiente; definitivas): (1) **Jerarquía**: varios productos → **una compra a un proveedor = una orden de compra (OC)**; varias OC → un embarque; varios embarques → un viaje de compras. Un proveedor puede tener **dos OC en un mismo viaje** (compró en dos momentos) → §0, §2.7 y §2.11. (2) **Carga de COTV**: «**solo por proveedor + viaje**» (no por día de registro, contra la recomendación del revisor): una compra por proveedor y viaje; si un proveedor tuvo dos OC, él parte el grupo en la planilla antes de importar → §2.7. (3) **OC repetida**: «**bloquear en el mismo proveedor, avisar en otro**» → §2.11. (4) **Lo al barrer**: «**nunca antes de la llegada y te avisa**» → §2.5. (5) **Ingreso al stock pasado** mientras no exista «Recibir embarque»: «**Por confirmar**», no «Vencido» → §2.2.
>
> **Hechos verificados** (revisor, solo lectura en `vector-two`, 2026-11-05): PostgreSQL **17.11** (`server_version_num = 170011`), así que el camino A de §2.4 aplica y el plan B sobra; el único objeto que depende de `compra_embarques.periodo_llegada` es su índice (`pg_depend`); la última migración registrada es la `0037`; hay **0** viajes, embarques, paquetes, asignaciones, compras, líneas, entregas, recepciones y eventos; `compra_eventos.accion` no tiene `check`; `compras` no tiene más único que `numero`.
>
> **Qué cambió respecto de las revisiones anteriores**: §11 (§11.0, esta revisión).
>
> **Numeración.** Migración **`0038_fechas_logisticas_embarque.sql`** (libre: la `0037` es la última aplicada), que se **registra sola** en `migraciones_aplicadas` (como la `0037`), con `scripts/humo-0038.sql`. Versión sugerida **`0.17.0 · M8 b`**. Decisiones propuestas **115 a 121** (§8; la siguiente libre después es la 122). Commits `M8:`.
>
> Sin datos reales: proveedores («Proveedor Norte», «Feria Sur»), compradores C1 y C2, admin A, embarques y cifras son inventados.

## 0. Punto de partida

**Qué hay en Vector2** (`0025` + `0032` + `0036`):

- **`compras.fecha_compra date not null`** (M8). La pone quien registra o la columna `FECHA_COMPRA` del importador. Es la fecha de la **Orden de Compra** de Javier.
- **`compras.numero text not null`** (M8): `C-000001`, de la secuencia `compras_numero_seq`, único e inmutable. Es el **«código X»** con que nace toda compra.
- **`compras.referencia text null`** (≤ 80). La escribe el importador y es **su clave de agrupación**: `clave_importacion = PROVEEDOR|REFERENCIA|LINEA` (normalizada) en cada línea, y `importar_compra` agrega líneas a la compra viva (no cancelada) del mismo proveedor y referencia (`upper(btrim)`), bajo candado consultivo. En la carga de COTV será `COTV-{codigo_viaje}-{supplier_id}` (una compra por proveedor y viaje, §2.7). No hay columna para el número de OC real.
- **Jerarquía** (Javier, revisión 4): los productos son **líneas** de una **compra** a un proveedor; **una compra es una OC**; varias compras van en un **embarque**, y varios embarques forman un **viaje**. Un proveedor puede tener **dos compras (dos OC) en el mismo viaje**. Una compra puede repartirse por unidades entre dos embarques (asignaciones, F15); el embarque pertenece a un viaje (`viaje_id`) y una compra de otro viaje solo da el aviso `viaje_distinto`.
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

**Defecto real en lo construido** (se corrige aquí): `servicio.ts` (~ línea 943) manda `fecha_salida_estimada: cuerpo.fecha_salida_estimada ?? null` y `guardar_embarque` (`0036`, ~ línea 289) escribe `fecha_salida_estimada = v_salida` sin condición. **Un `PATCH` que no trae la salida la borra, sin motivo ni evento de fechas.** Matiz (revisor): el modal actual (`modal-embarque.tsx:95`) siempre manda la salida, así que en pantalla no pasa; la pierde un cliente de API que omite el campo.

**Qué no se reabre**: decisiones 2, 54/55, 60, 83 (se precisa), 86, 92, 94 (con los modos de la `0036`), 95, 97 y 98; I1 a I5 (I2 se generaliza a paquetes, §2.8); convenciones de migración (idempotente; sin `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ni `do $$`; sin backfill).

## 1. Objetivo

Javier quiere ver, **por cada compra a un proveedor**, en qué punto está: cuándo se hizo la orden, cuándo zarpa, cuándo llega a puerto, cuándo entra al CD, cuándo arranca la operación y cuándo ingresa al stock. Cada eslabón se atrasa por razones distintas (pago, naviera, aduana, conteo). Este cambio le da al **embarque** cinco hitos logísticos que se editan con motivo y causa y quedan en el historial, y a cada **compra** una **línea de tiempo** de seis hitos (la orden de compra y los cinco de su embarque).

**El ingreso al stock decide el mes del flujo, y lo fija Javier.** Si no lo fija, es el día del ingreso al CD. Se fija por embarque y, para lo **al barrer**, por **paquete**, también por partes en varios meses.

Toda compra nace con su **código X** (`C-000123`) y después se le puede **registrar el número de la OC real** (el de SAP), con historial y sin romper la reimportación.

Las compras de COTV entran agrupadas en **una compra por proveedor y viaje** (Javier puede partir un grupo antes de importar), con su viaje y **llegada en diciembre de 2026, sin embarque**, cuentan en diciembre como cualquier entrega sin embarque, y Javier las reparte por proveedor entre los embarques reales (California y Nueva York) con el «Asignar» que ya existe, sin contarlas dos veces.

## 2. Modelo de datos

### 2.1 Los seis hitos de la línea de tiempo (decisión 120)

| # | Hito (pantalla, con el marcador de Javier) | Dónde vive | Columna | Nulable | Nueva | Qué significa |
|---|---|---|---|:-:|:-:|---|
| 0 | ⚪ **Orden de compra** | compra | `compras.fecha_compra` | no | no | La fecha de la compra de M8. Siempre «real». No se edita en esta entrega (la edición de compras es de `0.13.1`) |
| 1 | 🔵 **Zarpe** (salida) | embarque | `fecha_salida_estimada` | sí | no | Como hoy |
| 2 | 🔴 **Arribo** (puerto) | embarque | `fecha_puerto_estimada` | sí | **sí** | No aplica a embarques `local` (`puerto_en_local`) |
| 3 | ⚫ **Ingreso CD** | embarque | **`fecha_llegada_estimada`** | **no** | no | La mercadería llega físicamente al CD. **Conserva su significado de origen** («llegada al CD», 08b §2.4). Es la fecha que Javier conoce y carga |
| 4 | 🚀 **Inicio operativo** | embarque | `fecha_inicio_operativo_estimada` + `hora_inicio_operativo` | sí | **sí** | Empieza el conteo y el proceso en el CD. **Fecha y, si se conoce, hora** (§2.3) |
| 5 | 🟢 **Ingreso al stock** | embarque (o paquete) | `fecha_ingreso_estimada` | sí | **sí** | La mercadería queda disponible. **Manda el mes del flujo.** La fija Javier; **nula = el día del Ingreso CD**. La de un paquete nunca queda antes de la llegada del embarque (§2.5) |
| 5' | Ingreso real (08b-2) | embarque | `fecha_llegada_real` | sí | no | Lo confirma «Recibir embarque» |

**Inicio operativo complementa, no reemplaza.** Son tres momentos distintos que en el CD pueden separarse días: llega (Ingreso CD), se empieza a contar y procesar (Inicio operativo) y queda disponible (Ingreso al stock). El hito «llegada al área de conteo» de la revisión 3 **es** el Ingreso CD (misma columna); solo cambia el nombre en pantalla al de Javier.

**Por qué los hitos 1 a 5 son del embarque y no de la compra.** Un embarque es un contenedor o envío: todas sus compras zarpan, arriban y entran al CD juntas. Lo que Javier llama «la compra a cada proveedor» se ve como la línea de tiempo **de la compra**, armada con la orden de compra y las fechas de su embarque. **No se permite una fecha propia por compra** dentro del mismo embarque: no hay una necesidad real (si un proveedor zarpa en otra fecha, va en otro embarque), duplicaría cada fecha en decenas de compras y abriría el problema de qué fecha manda el mes. La única excepción ya decidida es el **ingreso al stock por paquete** (§2.5), que sirve para lo al barrer.

**Una compra repartida en dos embarques** (California y Nueva York) tiene **una línea de tiempo por tramo**: el tramo es (embarque, paquete) con sus unidades. Lo que todavía no tiene embarque es un tramo «Sin embarque», con la orden de compra y el mes de su entrega como ingreso al stock previsto; los otros hitos salen «Pendiente».

Otras columnas nuevas:

| Tabla | Columna | Tipo | Notas |
|---|---|---|---|
| `compra_embarques` | `fecha_inicio_operativo_estimada` | `date null` | §2.3 |
| `compra_embarques` | `hora_inicio_operativo` | `time null` | `check (hora_inicio_operativo is null or fecha_inicio_operativo_estimada is not null)`, declarado dentro de `add column if not exists`. Hora de Lima, sin zona |
| `compra_embarques` | `hito_confirmado` | `text null` | Último hito que **ya ocurrió**: `zarpe`, `arribo`, `ingreso_cd` o `inicio_operativo`, en orden. Catálogo en zod **y en la base**: `check (hito_confirmado is null or hito_confirmado in ('zarpe', 'arribo', 'ingreso_cd', 'inicio_operativo'))`, declarado dentro de `add column if not exists`. El ingreso al stock se confirma al recibir (08b-2) |
| `compra_embarques` | `origen` | `text null` | ≤ 80. **Almacén o ciudad de origen** («California», «Nueva York»). Texto con sugerencias (valores ya usados y, cuando exista la 08c, la región de los proveedores del embarque). Sin catálogo (§2.7) |
| `compra_paquetes` | `fecha_ingreso_estimada` | `date null` | **Ingreso al stock propio del paquete.** Nula = hereda el del embarque. Nunca anterior a la llegada del embarque (I9, §2.5) |
| `compra_paquetes` | `periodo_ingreso` | `date generated always as (…) stored` | Primer día del mes de `fecha_ingreso_estimada`, nulo si ella es nula. La misma expresión inmutable `make_date(extract(year …)::int, extract(month …)::int, 1)` de 08b. Agregarla reescribe `compra_paquetes` (decenas de filas) |
| `compra_agrupador_eventos` | `causa` | `text null` | El catálogo de §2.6, en zod **y en la base**: `check (causa is null or causa in (…los nueve valores…))`, dentro de `add column if not exists`. Ampliar el catálogo pedirá una migración (aceptado: casi no cambia) |

- Todo con `add column if not exists`. No hay backfill: lo existente queda con los hitos nuevos nulos y el ingreso al stock nulo (= Ingreso CD), así que **ningún mes cambia**.
- **Sin bandera «ingreso fijado a mano».** La columna nula ya lo dice: nula sigue al Ingreso CD; con valor, la fijó alguien y no se mueve sola. «Igualar al Ingreso CD» la vuelve a `null`.
- **Por qué el ingreso al stock sin fijar es el Ingreso CD y no el Inicio operativo.** Si dependiera del Inicio operativo, anotar o corregir esa hora podría cambiar el mes de decenas de compras sin que nadie lo decidiera. El mes solo se mueve cuando cambia el Ingreso CD o cuando Javier fija el ingreso.
- **Orden de los hitos: avisa, no bloquea**, salvo Zarpe > Ingreso CD (el check de la `0032`). Zarpe ≤ Arribo ≤ Ingreso CD ≤ Inicio operativo ≤ Ingreso al stock se comprueba al guardar y da el aviso `orden_de_fechas` con los dos hitos implicados.

### 2.2 Estado de cada hito

| Estado | Cuándo | En pantalla (texto, nunca solo color) |
|---|---|---|
| `real` | Orden de compra; o el hito está en o antes de `hito_confirmado` y tiene fecha; o ingreso al stock con `fecha_llegada_real` | «02/11/2026 · Ocurrió ✓» |
| `sin_registrar` | Está en o antes de `hito_confirmado` pero no tiene fecha (p. ej. nadie anotó el zarpe y ya entró al CD) | «Ocurrió · sin fecha» |
| `vencido` | Previsto con fecha anterior a hoy (Lima) y no confirmado, salvo el caso `por_confirmar` | «18/11/2026 · Debía ocurrir hace 4 días» |
| `por_confirmar` | **Solo el ingreso al stock**: fecha anterior a hoy, sin `fecha_llegada_real` y con `hito_confirmado` en `ingreso_cd` o `inicio_operativo` (la mercadería ya está en el CD). Hasta que exista «Recibir embarque» (08b-2) no hay cómo confirmarlo, así que no es un atraso (Javier, revisión 4) | «08/11/2026 · Llegó, falta confirmar el ingreso» |
| `previsto` | Con fecha, no confirmado, fecha ≥ hoy | «18/11/2026 · Previsto» |
| `pendiente` | Sin fecha y no confirmado, o tramo «Sin embarque» (siempre, también cuando su mes ya pasó: el «ingreso por confirmar» de M8 ya lo cubre y no se duplica como vencido) | «Pendiente» |
| — | Arribo en un embarque `local` | «No aplica» |

El ingreso al stock sin fijar muestra la fecha del Ingreso CD con la nota «igual al Ingreso CD». En el tramo «Sin embarque» muestra el mes («dic-26, sin embarque»).

**Confirmar un hito** (`hito_confirmado`) exige la fecha de **ese** hito, no futura, y que ninguno de los anteriores con fecha sea futuro. Los anteriores **sin** fecha quedan `sin_registrar`: el ejemplo de Javier (Zarpe y Arribo «Pendiente» con Ingreso CD ya ocurrido) se puede registrar tal cual. Para el Inicio operativo, «no futuro» se mide con fecha y hora si hay hora.

**Integridad después de confirmar (I7, ALTO 3).** No se mide solo al confirmar: **todo guardado** se comprueba con los valores finales. El hito confirmado tiene fecha (vaciarla da `fecha_requerida`) y ningún hito en o antes de `hito_confirmado` tiene fecha futura (moverlo a una fecha futura da `fecha_futura`). Para reprogramar a futuro un hito que ya figuraba como ocurrido, primero se baja la confirmación; puede ir en el mismo envío y eso es reprogramar (motivo y causa). Así no puede quedar «Ocurrió ✓» con fecha futura. Pasar un embarque a `local` (por `PATCH`) con Arribo con fecha o con `hito_confirmado = 'arribo'` da `puerto_en_local`.

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

**Cómo se cambia la columna: `alter table public.compra_embarques alter column periodo_llegada set expression as (…)`** (camino A; verificado: `vector-two` es PostgreSQL 17.11).

- **Qué hace.** Reescribe `compra_embarques` y su índice `compra_embarques_periodo_llegada_idx` bajo un candado **`ACCESS EXCLUSIVE`** (hoy hay 0 filas: instantáneo; con decenas, milisegundos). La reescritura **no dispara triggers** y no cambia ningún dato que no sea la columna generada. Reaplicarla da el mismo resultado.
- **Orden en la `0038`**: **después** del `add column if not exists fecha_ingreso_estimada` (la expresión la nombra) y antes de reemplazar las funciones (§2.9).
- **Dependencias.** Solo su índice (`pg_depend`): ninguna vista ni función con cuerpo SQL estándar la usa, así que la sentencia no falla por ellas. Las funciones que la leen por texto (`agrupador_foto_embarque`, `agrupadores_desalineados`, `aplicar_movimiento_agrupador`, `guardar_paquete`, `importar_agrupadores`) siguen compilando y leen el mes nuevo.
- **Qué deja bien y qué no** (corrige la revisión 4, que decía «lectores que hay que tocar: ninguno»). Deja correctos a todos los lectores **de nivel embarque**: el mes de un embarque, `agrupador_foto_embarque`, la lista de embarques, la regla 3 del importador cuando la fila no trae paquete. **No** basta para los lectores **de nivel asignación**: una asignación que está en un paquete con ingreso propio no cuenta en el mes del embarque. Esos pasan a la regla única de §2.4 bis.
- **Descartados**: B (una columna generada nueva con todos los lectores reemplazados: el mismo trabajo sin ninguna ventaja, ahora que PG 17 está confirmado); C (derivar el mes en cada función: pierde el índice y multiplica los lugares donde equivocarse); reinterpretar `fecha_llegada_estimada` como el ingreso (revisión 1), que invierte el significado de lo cargado y de la plantilla vieja.

- **La misma regla en TypeScript.** `periodoLlegada(real, ingreso, ingresoCd)` en `movimiento.ts` (revisión B2 de 08b). Cambia su firma y se actualizan sus llamadas.
- **Códigos `aamm##`** (MEDIO 1). El de un **embarque** nuevo toma el mes de su **Ingreso CD** (`fecha_llegada_estimada`), como hoy (`guardar_embarque` e `importar_agrupadores` usan `v_llegada`, 0036:225 y :1272). El de un **paquete** nuevo hoy toma `v_emb.periodo_llegada` (`guardar_paquete` 0036:360, `importar_agrupadores` 0036:1333), que desde la `0038` sería el mes del **ingreso al stock** del embarque. **Decisión: el paquete también toma el mes del Ingreso CD de su embarque**, para que un embarque y sus paquetes compartan prefijo (con el ingreso fijado en otro mes, si no, el embarque sería `2611##` y su paquete `2612##`). Un código nunca cambia después de creado. Cuesta una línea en cada una de las dos funciones y, en TS, que `mesPaquete` (`agrupadores/importar.ts:547`) lea el Ingreso CD (`fecha_llegada_estimada` del embarque o `FECHA_INGRESO_CD` del archivo).

### 2.4 bis Mes de destino de una asignación: una sola regla (BLOQUEANTE 1 de la revisión independiente)

**Regla.** `mesDeDestino(embarque, paquete) = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)`: el mes del ingreso propio del paquete si lo tiene; si no, el mes del embarque (que ya es el del ingreso al stock, §2.4). Como el ingreso propio **nunca queda antes de la llegada** (I9, §2.5), basta un `coalesce`: no hace falta un `greatest` en cada lector.

- **TypeScript**: `mesDeDestino(e: Pick<EmbarqueRegistro, "periodo_llegada">, p: Pick<PaqueteRegistro, "periodo_ingreso"> | null): Mes`, exportada **una sola vez** desde `movimiento.ts`. Una prueba estática (`tests/agrupadores.estatico.test.ts`) exige que en `src/lib/compras/**` ninguna entrega se compare contra `periodo_llegada` fuera de `mesDeDestino`, `periodoLlegada` y el Excel.
- **SQL**: siempre en línea y con la misma forma, `coalesce(pq.periodo_ingreso, b.periodo_llegada)` con `left join public.compra_paquetes pq on pq.id = a.paquete_id`. El humo comprueba con `pg_get_functiondef` que las funciones de la tabla la contienen. No se crea una función auxiliar: serían cuatro lugares y una subconsulta por fila.

**Dónde se usa** (todos cambian en esta entrega):

| Lugar | Hoy | Desde la `0038` |
|---|---|---|
| `planAsignar` (`movimiento.ts:618`) | `destino.periodo = e.periodo_llegada` aunque haya paquete destino | `mesDeDestino(e, paquete destino)` |
| `planCambiarFecha` → `planCambiarFechas` (`:683-695`) | Mueve **todas** las asignaciones del embarque al mes nuevo | Cada asignación a `mesDeDestino(e con los valores nuevos, su paquete con su ingreso final)`. Las de paquetes con ingreso propio no se mueven, salvo que el ajuste al piso (§2.5) les cambie el mes |
| `planMoverPaquete` (`:739`) | `destino.periodo_llegada` | `mesDeDestino(destino, paquete con su ingreso propio, ajustado al piso del destino)` |
| `planPasarPendientes` (`:785`) | `destino.periodo_llegada` | `mesDeDestino(destino, paquete_destino)` |
| `planMoverAPaquete` | No mueve meses | `mesDeDestino(e, paquete destino)`; al sacar de un paquete, el mes del embarque |
| `cerrarPlan` y `verificarAlineacion` (`:836-842`) | Un mes por embarque (`destinoPeriodo`) y solo el embarque destino | Un mes **por asignación**: `verificarAlineacion(asignaciones, mesDe: (a) => Mes)` sobre **todas** las asignaciones activas de los embarques del plan. `destinoPeriodo` queda solo para `fecha_en_mes_cerrado` y el resumen; el reparto al barrer ya usa el `periodo` de cada entrega, que sale de `destino.periodo` de cada movimiento |
| `avisos.ts:54` (embarque) y `:70` (paquete) | `desalineada` contra `embarque.periodo_llegada` | Contra `mesDeDestino(embarque, paquete de la asignación)`; `AsignacionParaAviso` suma `periodo_destino`, que calcula `consultas.ts` |
| Regla 3 del importador de compras (`agrupadores/importar.ts:768`) | `LLEGADA` contra `embarque.periodo_llegada`, aunque la fila traiga `PAQUETE` | Contra `mesDeDestino(embarque, paquete de la fila)` |
| Simulación del importador de agrupadores (`:655`) | `periodo_llegada: fecha_llegada_estimada.slice(0, 7)` | Mes de `coalesce(FECHA_INGRESO_STOCK, FECHA_INGRESO_CD)` (al crear no hay real). Los paquetes que crea el importador nacen sin ingreso propio |
| `mesPaquete` (`:547`) | Mes del embarque | Mes del Ingreso CD (es solo para el código, §2.4) |
| `hitos.ts` (`lineaDeTiempo`) | — | Mes del tramo = `mesDeDestino` |
| SQL · I2 de `aplicar_movimiento_agrupador` (0036:1039-1047) | Solo las asignaciones de `v_dest` y solo en `asignar`, `cambiar_fecha`, `mover_paquete` y `pasar_pendientes` | **Todas** las asignaciones activas (`agrupador_es_activa`) de **todos los embarques del plan** (origen y destino), en **todas** las operaciones (también `mover_a_paquete` y `quitar`), contra el `coalesce` |
| SQL · `embarque_con_recepciones` (0036:942-956) | Recalcula el mes **del embarque** con `coalesce(real, v_cf_fecha)` | **Por asignación**: si un movimiento del plan toca una asignación con recepciones vinculadas → `embarque_con_recepciones` (cambio de fechas del embarque) o `asignacion_con_recepciones` (ingreso o movimiento de un paquete). Un plan que omitiera ese movimiento deja la asignación desalineada y cae en la I2 general (`AG002`) |
| SQL · `agrupadores_desalineados()` | Contra `b.periodo_llegada` | Contra el `coalesce`. **Misma firma**: su columna de salida `periodo_llegada` pasa a contener el mes de destino (cambiar las columnas de salida exigiría `DROP`); lo dice su `comment on` |

**No cambian por esta regla**: el Flujo (lee entregas), `agrupador_foto_embarque` (ya suma el ingreso de cada paquete, §2.9) y `agrupador_mover_entregas` (recibe el destino ya calculado).

### 2.5 Lo al barrer: ingreso al stock por paquete, todo junto o por partes (decisión 119)

**Qué tiene de especial.** Un lote al barrer se reparte entre GML con el vector de la **temporada del mes en que entra** (§0): el mismo lote se distribuye distinto en verano que en invierno. Por eso **cuándo** entra decide **cómo** se reparte.

- **Todo junto**: un paquete («Al barrer») con su ingreso, y los lotes van ahí enteros.
- **Por partes**: dos o más paquetes («Al barrer · tanda 1», «tanda 2») con fechas distintas, y las unidades se reparten entre ellos. Por eso **`mover_a_paquete` acepta unidades por asignación** (hoy mueve asignaciones enteras). `agrupador_mover_entregas` ya acepta movimientos parciales por asignación: no cambia.
- **El mes de una asignación es el de su paquete** si el paquete tiene ingreso; si no, el del embarque: `mesDeDestino` (§2.4 bis; I2 generalizada, §2.8).
- **Fijar o cambiar el ingreso de un paquete, o mover a un paquete con otro mes, mueve entregas**: vista previa, huella del plan, motivo y causa. Si cambia la temporada, **reparte de nuevo** con la misma versión de M12 (avisos `cambia_temporada` y `reparto_sin_vector`). Con recepciones vinculadas, `asignacion_con_recepciones`.
- **«Programar lo al barrer»** (atajo de pantalla, sin ruta nueva): lista los lotes al barrer del embarque y ofrece crear el paquete con la fecha que Javier escriba (propone la del ingreso del embarque) y moverlos ahí; «Agregar otra tanda» crea otro paquete. Son tres llamadas que ya existen (crear paquete, fijar su ingreso sin asignaciones, que no mueve nada, y mover a paquete con unidades), cada una consistente por sí sola.
- **Lo que no cambia**: los hitos 1 a 4 son del embarque; el paquete no tiene «ya ocurrió» propio; recibir (08b-2) sigue siendo por embarque y cada recepción lleva su propio mes X.

**Nunca antes de la llegada (Javier, revisión 4; ALTO 1).**

- **Piso** de un paquete = `coalesce(fecha_llegada_real, fecha_llegada_estimada)` de su embarque: el ingreso real si ya llegó, si no el Ingreso CD. El ingreso propio de un paquete **nunca** queda antes de su piso (I9). Se compara por día, así que el mes tampoco puede quedar antes.
- **Se acepta y se ajusta, con aviso; no se rechaza.** Si un cambio deja el ingreso propio de un paquete antes de su piso, el plan lo **sube al piso** (ese día exacto) y avisa `ingreso_paquete_ajustado`: «La tanda 1 estaba para el 04-abr, pero el embarque llega al CD el 20-abr: queda el 20-abr. Reprográmala si quieres otra fecha.» Se ve en la vista previa, antes de aplicar.
- **Por qué ajustar y no rechazar.** Es lo que pidió Javier («se corrige al mes de llegada y te aviso»). Es **una sola regla para todos los caminos**: fijar el ingreso de un paquete, atrasar el Ingreso CD, mover el paquete a otro embarque y, en 08b-2, registrar el ingreso real. Rechazar bloquearía reprogramar el embarque (lo que impone la logística) por una tanda que se puede reprogramar después; rechazar solo en el diálogo del paquete daría dos comportamientos para lo mismo.
- **Dónde se ajusta**: en `planCambiarFechas` (el Ingreso CD pasa después de una tanda; o se fija el ingreso de un paquete antes del piso: se guarda el piso) y en `planMoverPaquete` (piso del embarque destino). Los ajustes viajan en `plan.paquetes`, con el motivo y la causa del cambio que los provoca (no piden otro motivo). Si cambian el mes, mueven entregas y reparten de nuevo como cualquier otro cambio, y quedan en el evento.
- **No se deshace solo**: si después el Ingreso CD vuelve a adelantarse, el paquete se queda en la fecha ajustada, que ya es su ingreso propio.
- **La función lo comprueba al final (I9)**: ningún paquete abierto de los embarques del plan con `fecha_ingreso_estimada < coalesce(fecha_llegada_real, fecha_llegada_estimada)` de su embarque; si no, `AG002` (plan inconsistente).
- **`mover_paquete`** conserva el ingreso propio y lo valida contra el piso del embarque **destino** (se ajusta si queda antes).
- **08b-2 lo hereda**: al registrar el ingreso real de un embarque, el paquete con ingreso propio anterior al real se ajusta al real con el mismo aviso.
- **«Programar lo al barrer»** propone el ingreso del embarque y su selector de fecha no ofrece días antes del Ingreso CD.

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

### 2.7 Compras de COTV: una compra por proveedor y viaje, llegada en diciembre, sin embarque (decisión 117)

**Cómo entran.** Por el importador de compras **de siempre, sin cambios** (`POST /api/compras/importar`, `carga_inicial`; 08c §12.2 b, actualizada). COTV creó una cabecera por ítem (08c §12.1, patrón 1), pero en Vector2 **una compra es una OC** (§0): la planilla C2 **agrupa los ítems en compras**.

**Agrupación: solo por proveedor + viaje** (Javier, revisión 4). Una compra por (proveedor de Vector2, después de unir los repetidos de C1; viaje). **No** se agrupa por día de registro. La planilla C2 lleva:

| Columna | Valor |
|---|---|
| `PROVEEDOR` | El proveedor de Vector2 (C1) |
| `REFERENCIA` | **`COTV-{codigo_viaje}-{supplier_id}`**: el código del viaje en Vector2 (6 caracteres) y el `id` de COTV del proveedor que quedó en C1 al unir repetidos (el de su `clave_origen`). 48 caracteres (≤ 80) |
| `LINEA_ORDINAL` | 1, 2, 3… dentro del grupo, por `purchase_items.created_at` y luego `id` |
| `FECHA_COMPRA` | **Una sola por grupo, igual en todas sus filas**: el **día en Lima del registro del ítem más antiguo** del grupo, `min((purchase_items.created_at at time zone 'America/Lima')::date)`. **Es la Orden de compra de la línea de tiempo** |
| `DIA_REGISTRO` (informativa) | El día en Lima del registro de **cada** ítem. Sirve para decidir dónde partir un grupo |
| `ITEM_COTV` (informativa) | `purchase_items.id`. Enlaza después descripción, modelo y fotos con su línea aunque Javier parta el grupo (08c §12.2 c) |
| `VIAJE` | El código del viaje de COTV en Vector2 |
| **`LLEGADA`** | **`2026-12`** en todas las filas (Javier: «inicialmente ponle a todo llegada en diciembre»). Es un **mes**, como siempre en el importador: la entrega queda con `periodo = 2026-12-01`, que en M8 significa «diciembre», no «el día 1» |
| `EMBARQUE` · `PAQUETE` · `OC` | Vacías (la OC se completa después, §3.7). `RECIBIDAS` vacía salvo que Javier diga que algo ya llegó |
| `NOTA` | **Una sola por grupo**, igual en todas sus filas: «Registrada en COTV por {compradores distintos}» y las notas distintas de las cabeceras del grupo, separadas por « · », cortadas a 500 (el corte se avisa en la sesión) |

Las demás columnas, como 08c §12.2 b. Las dos informativas las ignora el importador: `filaImportacionCompraSchema` es `z.object` no estricto y descarta claves que no conoce (`qa` lo comprueba en el ensayo C0).

**Por qué el día en Lima del registro y no `purchase_date`.** `purchase_date` no está en el formulario de COTV: toma `current_date` del servidor en **UTC** (08c §12.1, patrón 3), así que un registro de la noche de Lima (de 19:00 a 23:59) cae al día siguiente. `created_at` es `timestamptz not null default now()` en `purchases` y en `purchase_items` (`supabase/schema.sql` de COTV) y la aplicación lo usa (`lib/data.ts:68` lo lee de `purchase_items`; `:146` ordena `purchases` por él). Pasado a `America/Lima` (sin horario de verano) da el día real del registro. Se toma el del **ítem** porque es la fila que se carga; el de su cabecera es del mismo `savePurchase`. Sigue siendo una fecha de registro, no la de la orden real: Javier la corrige en la planilla si la conoce.

**Verificación en COTV (la corre `datos` en C0, antes de armar la planilla; solo `SELECT` agregados en `hcqwabksrheneitpyhtm`, solo cifras a esta ficha).** El arquitecto no tuvo el MCP de Supabase en esta sesión: lo de arriba sale del código de COTV, no de la base.

```sql
-- 1. ¿Existe created_at y es timestamptz en las dos tablas?
select table_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name in ('purchases', 'purchase_items') and column_name = 'created_at';
-- 2. Cuántos ítems cambian de día frente a purchase_date, y tamaño de los grupos proveedor + viaje
with it as (
  select p.campaign_id, p.supplier_id, p.purchase_date d,
         (i.created_at at time zone 'America/Lima')::date d_lima
    from purchase_items i join purchases p on p.id = i.purchase_id),
g as (select campaign_id, supplier_id, count(*) n, count(distinct d_lima) dias from it group by 1, 2)
select (select count(*) from it) items,
       (select count(*) from it where d_lima <> d) items_dia_distinto,
       count(*) grupos,
       count(*) filter (where dias > 1) grupos_varios_dias,
       max(n) max_lineas,
       percentile_disc(0.9) within group (order by n) p90_lineas
  from g;
```

Usa el `supplier_id` de COTV: los proveedores que C1 une se juntan después, en la sesión. Si (1) no devolviera las dos filas (contra lo que dice el código), la fecha del grupo sería el `purchase_date` más antiguo, y se anota aquí.

**Si un proveedor tuvo dos OC en el viaje** (compró en dos momentos), la planilla lo deja fácil y Javier decide **antes de importar**:

- Las filas van ordenadas por proveedor y `DIA_REGISTRO`. Una hoja **`GRUPOS`** lista cada grupo con proveedor, viaje, líneas, primer y último día de registro y la marca «**varios días**» (los candidatos a partir). Una hoja **`LEEME`** lo explica: «Si este proveedor tuvo dos órdenes de compra en el viaje, cambia la `REFERENCIA` de las filas de la segunda (por ejemplo, agrega `-2` al final) y pon en esas filas una sola `FECHA_COMPRA` (la de su `DIA_REGISTRO` más antiguo). Cada referencia distinta será una compra».
- No hay que renumerar `LINEA_ORDINAL`: era único en el grupo y sigue único en cada parte (la clave es `PROVEEDOR|REFERENCIA|LINEA`).
- **Una compra tiene una sola `FECHA_COMPRA`.** El importador no elige una: `src/lib/compras/importar.ts:572-576` **omite** las filas con otra fecha que la primera de su compra (`cabecera_inconsistente`). Por eso la planilla uniforma la fecha en cada grupo, el ensayo C0 exige 0 `cabecera_inconsistente`, y si Javier deja fechas distintas en una referencia lo ve en la previsualización, antes de aplicar.
- **Después de importar**, corregir una agrupación mal hecha es **cancelar** la compra (libera sus `clave_importacion`) y **reimportar** esas filas con otra referencia. **Dividir, unir o mover líneas entre compras** queda como mejora de `0.13.1` (§7): mover una línea arrastra entregas, repartos, asignaciones y recepciones, pide candados de dos compras y deja vieja su clave de importación. La OC no sirve para separar una compra mal agrupada: es de la compra entera.

COTV no tiene zarpe, arribo, ingreso al CD ni inicio operativo: esos hitos salen «Pendiente» hasta que Javier crea los embarques y les pone fechas.

**Qué pasa en el flujo.** Cada línea queda con una entrega de diciembre **sin embarque**, el caso que M8 y 08b-1 ya soportan: cuenta en diciembre en Flujo mensual y en Huecos, y sale en «Sin agrupador» con su viaje. No hay embarque provisional, mes provisional, banner ni aviso nuevo.

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
- **I2 (generalizada)**: `entrega.periodo = mesDeDestino(embarque, paquete) = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)` para **todas** las asignaciones activas de **todos** los embarques del plan, en **toda** operación (§2.4 bis). **`agrupadores_desalineados()`** usa la misma regla; el humo exige `= 0` antes y después de aplicar la `0038`.

| | Invariante nueva | Dónde |
|---|---|---|
| **I6** | Un cambio de fechas que no cambia el mes de ninguna asignación (Zarpe, Arribo, Inicio operativo, `hito_confirmado`, o Ingreso CD / ingreso al stock dentro del mismo mes) no bloquea compras, no sube `compras.revision`, no escribe en `compra_eventos` y deja `flujo_huella_base()` igual | Función y humo |
| **I7** | Si `hito_confirmado` no es nulo: ese hito tiene fecha, ningún hito en o antes de él tiene fecha futura, y el estado no es `planificado`. Se comprueba en **todo** guardado con los valores finales, no solo al confirmar (§2.2). El catálogo, además, con `check` en la base | Función, `check` y humo |
| **I8** | Todo cambio de fecha u hora de embarque, de ingreso de paquete o de `hito_confirmado` deja un evento con la foto antes y después. Si reprograma, lleva motivo y causa | Función y humo |
| **I9** | Ningún paquete abierto tiene `fecha_ingreso_estimada` anterior a `coalesce(fecha_llegada_real, fecha_llegada_estimada)` de su embarque (§2.5). Los planes ajustan; la función lo comprueba al final sobre los embarques del plan (`AG002`) | Plan, función y humo |
| **I10** | Una OC (`upper(btrim(numero_oc))`) está en **una sola** compra no cancelada de cada proveedor (§2.11) | Índice único parcial `compras_proveedor_oc_uidx` y humo |

### 2.9 Funciones de la `0038`

**Orden de la `0038`** (idempotente; sin `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ni `do $$`; sin backfill):

1. `add column if not exists` de §2.1 (con sus `check`) y `compras.numero_oc` (con el suyo, §2.11).
2. `alter table public.compra_embarques alter column periodo_llegada set expression as (…)` (§2.4), **después** de 1.
3. Índices: `compras_numero_oc_idx` y el único parcial `compras_proveedor_oc_uidx` (§2.11), con `if not exists`.
4. Funciones (`create or replace`) y sus `comment on`, `revoke` y `grant`.
5. `insert into public.migraciones_aplicadas(nombre) values ('0038_fechas_logisticas_embarque') on conflict do nothing;`, como la `0037` (línea 123). La migración **se registra sola**.

Funciones: todas con `create or replace` **a partir de su versión vigente** (la `0036` para las de agrupadores), con la misma firma, `security invoker`, `search_path = ''`, `revoke`/`grant` a `service_role` y `comment on` nuevo. Candados de la `0036`: viajes y embarques `for no key update`, compras `for update`, en orden viajes → embarques → compras. Las columnas nuevas no son clave, así que `for no key update` sigue bastando.

| Función | Cambio |
|---|---|
| `agrupador_foto_embarque(uuid)` | Suma arribo, inicio operativo (fecha y hora), ingreso al stock, `hito_confirmado`, `origen` y el ingreso de cada paquete |
| `guardar_embarque` | **Al crear**: los cinco hitos (Ingreso CD obligatorio: `fecha_requerida`; hora sin fecha: `hora_sin_fecha`) y `origen`. **Al editar** no escribe **ninguna** fecha ni hora. Distingue **clave ausente** de `null` (MEDIO 2): una clave de fecha u hora **presente** (`p_embarque ? 'fecha_salida_estimada'`, y lo mismo con las demás) con un valor distinto del guardado, `null` incluido, da `fecha_por_movimiento`; una **ausente** conserva lo guardado (**corrige el defecto de §0**). `origen` sí se edita. Pasar `tipo` a `local` con Arribo con fecha o con `hito_confirmado = 'arribo'` da `puerto_en_local` (ALTO 3) |
| `guardar_paquete` | **Solo** el código de un paquete nuevo: el mes del **Ingreso CD** de su embarque, no `periodo_llegada` (§2.4, 0036:360). Nada más |
| `aplicar_movimiento_agrupador` | **Diff explícito sobre la `0036`**: (a) `cambiar_fecha` acepta planes **sin** `fecha_llegada_estimada` (hoy da `AG002`, 0036:830-836): cualquier hito, `hito_confirmado`, el ingreso del embarque y los `paquetes`. (b) En `cambiar_fecha` el motivo se exige **solo si reprograma**, y con él la causa (hoy, motivo siempre, 0036:825); `mover_paquete` y `pasar_pendientes` siguen pidiéndolo siempre. (c) Por cada paquete del plan, **después** de bloquear su embarque, comprueba que el paquete **sigue en ese embarque** y está abierto; si no, `agrupador_cambio` (MEDIO 3: `mover_paquete` pudo cambiarlo entre la lectura y el candado). (d) `mover_a_paquete` acepta unidades y puede mover meses (motivo y causa solo si los mueve). (e) `mover_paquete` conserva el ingreso propio y lo ajusta al piso del destino (§2.5). (f) Recepciones por asignación (§2.4 bis). (g) I2 general (§2.4 bis). (h) I7 e I9 al final. (i) Un plan viejo (`cambiar_fecha` con solo `fecha_llegada_estimada`) se comporta como hoy |
| `cambiar_estado_agrupador` | `volver_a_planificado` con `hito_confirmado` → `409 hito_confirmado` |
| `importar_agrupadores` | Columnas nuevas (§3.6) y el código del paquete con el mes del Ingreso CD (0036:1333). La clave natural sin código sigue siendo (nombre, Ingreso CD). Solo crea (decisión 97) |
| `agrupadores_desalineados()` | I2 generalizada con la **misma firma** (§2.4 bis) |
| **`agrupador_hitos_resumen(p_embarques uuid[])`** (nueva, `stable`) | Por embarque y hito (los cinco), más el ingreso de cada paquete: fecha original (la primera no nula en los eventos), reprogramaciones (sin contar `correccion` ni `programacion`) y la última causa |
| **`editar_oc_compra`** (nueva) | §2.11 |

**No se tocan**: `agrupador_mover_entregas`, `asignar_viaje_compras`, `importar_compra` ni ninguna otra función de M8. La línea de tiempo de la compra **no tiene función propia**: se arma en TypeScript (§3.4) con la compra, sus asignaciones y los embarques, que ya se leen.

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
  paquetes: [{ id, embarque_id, fecha_ingreso_estimada, ajustado? }],        // ingreso propio (null = hereda); ajustado = subido al piso (§2.5)
  compras: [...], movimientos: [...], entregas: [...], repartos: [...] }    // solo si cambia algún mes
```

Pasos de la función:

1. Bloquea los embarques y, por cada paquete del plan, comprueba que **sigue en su embarque** y está abierto (`agrupador_cambio`). Calcula los valores finales.
2. Sin cambios → `sin_cambios`.
3. **Si reprograma**, exige motivo y causa (`motivo_requerido`, `causa_requerida`). Reprograma: cambiar o vaciar un Zarpe, Arribo o Inicio operativo (fecha **u hora**) que tenía valor; cambiar el Ingreso CD; cambiar la fecha **efectiva** de ingreso al stock (`coalesce(ingreso, Ingreso CD)`) por fijarla o igualarla; cambiar el ingreso de un paquete; bajar `hito_confirmado`. **No** reprograma: completar una fecha u hora vacía, confirmar un hito, que el ingreso sin fijar siga al Ingreso CD o que un paquete suba a su piso (van en el motivo del cambio que los provoca).
4. **Estados.** Ingreso CD e ingreso al stock (de embarque y de paquete) solo cambian en `planificado` o `en_transito`. Zarpe, Arribo, Inicio operativo y `hito_confirmado` también cambian en `recibido`. En `cancelado`, nada (`embarque_no_editable`).
5. **Bloqueos.** Zarpe ≤ Ingreso CD con los valores finales (el check de la base). Arribo en un `local` → `puerto_en_local`. Hora sin fecha → `hora_sin_fecha`. **I7 con los valores finales, en todo guardado** (§2.2): el hito confirmado sin fecha da `fecha_requerida`; un hito en o antes del confirmado con fecha futura (con la hora de Lima en el Inicio operativo) da `fecha_futura`. Confirmar con el embarque `planificado` lo pasa a `en_transito` (aviso `pasa_a_en_transito`).
6. **Recepciones vinculadas** (08b-2), **por asignación**: si un movimiento del plan toca una asignación con recepciones → `embarque_con_recepciones` (fechas del embarque) o `asignacion_con_recepciones` (paquete).
7. **Mes sin cambios** en ninguna asignación: se escribe el embarque, sube su `revision`, queda **un** evento y no se bloquea ninguna compra (I6).
8. **Mes con cambios**: el camino de hoy (bloquear compras derivadas, comparar `revision`, `agrupador_mover_entregas`, I1 a I3, I2 generalizada, I5 y eventos solo en las compras que cambiaron).
9. **Al final**, I7 e I9 sobre los embarques del plan.

**`huella_plan` solo cuando cambia algún mes** (MEDIO 7). La exige el servidor, no el esquema: si el plan recalculado mueve entregas, el cuerpo debe traer la huella de la vista previa y coincidir (`plan_cambio`, «Revisa la vista previa: el plan cambió»); si ningún mes cambia (Zarpe, Arribo, Inicio operativo, confirmar), se aplica sin vista previa.

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
| índice `compras_numero_oc_idx` | `on public.compras (upper(btrim(numero_oc))) where numero_oc is not null` | Para el aviso `oc_de_otro_proveedor` y la búsqueda exacta (el único empieza por `proveedor_id` y no sirve para buscar solo por OC) |
| índice **`compras_proveedor_oc_uidx`** | `create unique index if not exists … on public.compras (proveedor_id, upper(btrim(numero_oc))) where numero_oc is not null and estado <> 'cancelada'` | **Una OC es de una sola compra viva de cada proveedor** (I10). Hoy hay 0 compras: no puede haber duplicados al crearlo |

- **Única por proveedor** (Javier, revisión 4: «bloquear en el mismo proveedor, avisar en otro»). Con la jerarquía de §0, una OC es una compra, así que la misma OC en dos compras vivas del **mismo** proveedor es un error y se **bloquea** (`409 oc_repetida`: «La OC 4500012345 ya está en C-000201 de este proveedor. Una OC es de una sola compra»). En compras de **otro** proveedor solo **avisa** (`oc_de_otro_proveedor`: casi siempre es un error de tipeo, pero dos proveedores pueden numerar igual). Las compras canceladas no cuentan, así que cancelar una compra libera su OC.
- **Comparación**: `upper(btrim(…))`; la columna ya se guarda sin espacios al borde. Los espacios internos no se normalizan: «4500 012345» y «4500012345» no cuentan como la misma OC (límite aceptado; §7).
- **Candado.** El índice es parcial y sobre una expresión, así que no cuenta como «clave» para los candados de fila de PostgreSQL (solo cuentan los únicos que una FK podría usar): un `update` de `numero_oc` sigue tomando `for no key update` y el candado del paso 1 de `editar_oc_compra` vale.
- **Para `0.13.1`**: cambiar el proveedor de una compra podrá chocar con este índice (`oc_repetida`); esa entrega lo trata.
- **Sin backfill**: todo lo existente queda sin OC.

**Función nueva `editar_oc_compra(p_compra uuid, p_antes text, p_numero_oc text, p_motivo text, p_actor jsonb)`** (`plpgsql`, `security invoker`, `search_path = ''`, solo `service_role`), análoga a `editar_ficha_linea` de 08c (I6, decisión del 2026-11-04 que matiza la 60):

1. Bloquea **solo la compra** (`for no key update`; no es columna clave, y así no choca con el `key share` de las FK de líneas y eventos). Las funciones que mueven compras toman `for update` de la misma fila: se esperan, sin interbloqueo, porque esta toma una sola fila y nada más.
2. Compra inexistente → `no_encontrado`; `cancelada` → `no_editable`.
3. **Guardado igual al nuevo → `sin_cambios`**, comparado **antes** que `p_antes` (MEDIO 4): así un reintento tras un corte de red devuelve `sin_cambios` y no `oc_cambio`.
4. Compara `numero_oc` guardado con `p_antes` (`is distinct from`): si alguien la cambió entre medio, `oc_cambio` y no escribe.
5. Escribe `numero_oc` (nulo = quitarla) y `updated_by_*`, **sin subir `compras.revision`**: la OC no toca cantidades ni fechas, y subir la revisión daría `409` falsos a quien tiene la compra abierta en otra vista o a un plan de movimiento ya previsualizado. La escritura va en un bloque `begin … exception when unique_violation then …`: si el índice `compras_proveedor_oc_uidx` la rechaza, devuelve `{ ok: false, motivo: 'oc_repetida', compra: <número de la compra que ya la tiene> }` sin escribir nada (también cuando dos personas ponen la misma OC a la vez en dos compras del proveedor: la segunda espera a la primera y recibe `oc_repetida`).
6. Inserta en `compra_eventos` la acción **`editar_oc`** (zod `ACCIONES_EVENTO`; `accion` no tiene `check` en la base, verificado) con `antes = { numero_oc }`, `despues = { numero_oc }`, el motivo (opcional, ≤ 300) y el `resumen` («OC: — → 4500012345»). El evento mueve la huella del flujo una vez (cuenta eventos), sin cambiar cifras, igual que en 08c R7.
7. Devuelve `{ ok, numero_oc, avisos: [oc_de_otro_proveedor …] }`.

**Permisos.** `requireUser`: los tres roles registran o cambian la OC de **cualquier** compra no cancelada desde la pantalla. Es un dato de identificación que no mueve el flujo, y el responsable es un filtro, no un permiso (decisión 28). Cambiar una OC que ya tenía valor pide motivo en la pantalla (en la base es opcional, para el importador) y siempre deja el antes y el después. **En el importador**, en cambio, se aplica la regla de la decisión 109 (§3.7): el comprador solo pone OC en compras nuevas o en su propio borrador. **La asimetría es deliberada y queda escrita en la decisión 121** (MEDIO 6): en pantalla se edita **una** compra a la vez, viéndola, con el valor previo, motivo si reemplaza y los avisos; por archivo se escriben **muchas** en lote, sin mirarlas una por una, y con la misma regla que ya limita las líneas que ese comprador puede escribir por archivo. Igualar las dos reglas se descartó: restringir la pantalla le quitaría al comprador registrar la OC de la compra que gestiona aunque la haya creado otro, y abrir el importador permitiría pisar en lote OC ajenas.

## 3. Contratos de API

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
  huella_plan: huella_plan.optional(),                  // la exige el servidor solo si cambia algún mes (§2.10)
}).refine(v => ["fecha_zarpe","fecha_arribo","fecha_ingreso_cd","inicio_operativo","fecha_ingreso_stock","hito_confirmado"].some(k => k in v), "sin_cambios");

editarOcSchema = z.strictObject({ antes: z.string().nullable(),            // la OC que vio el formulario
  numero_oc: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9\-\/_. ]{0,39}$/).nullable(),   // null = quitar
  motivo: z.string().trim().min(1).max(300).optional() });

ingresoPaqueteSchema = z.strictObject({ revision_embarque: z.number().int().min(0), fecha_ingreso_stock: fechaIso.nullable(),   // null = hereda
  motivo: z.string().trim().min(1).max(300).optional(), causa: z.enum(CAUSAS_FECHA).optional(), huella_plan: huella_plan.optional() });

// Cambios en esquemas existentes:
guardarEmbarqueSchema += { fecha_puerto_estimada?, fecha_inicio_operativo_estimada?, hora_inicio_operativo?: hora.nullable(),
                           fecha_ingreso_estimada?,                    // solo al crear
                           origen: z.string().trim().max(80).nullable().optional() };   // fecha_llegada_estimada sigue obligatoria al crear: es el Ingreso CD
moverAPaqueteSchema.asignaciones: z.array(z.union([z.uuid(), z.strictObject({ id: z.uuid(), unidades: z.number().int().positive() })])).min(1).max(2000)
                    + motivo?, causa?, huella_plan?  // obligatorios solo si el movimiento cambia de mes (lo decide el servidor)
```

**La API habla con nombres de hito** y `consultas.ts` los traduce a columnas. `pasarPendientesSchema` y `asignarEntregasSchema` **no cambian**. La fila del importador de compras suma solo `oc` (§3.7).

### 3.2 Rutas

| Ruta | Método | Guard | Cuerpo | `{ data }` | Errores |
|---|---|---|---|---|---|
| **`/api/compras/embarques/[id]/fechas`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `cambiarFechasSchema` | `PlanFechasApi` o `RespuestaMovimientoApi` + `avisos` | 400; 404; 409 `sin_cambios`, `motivo_requerido`, `causa_requerida`, `salida_despues_de_llegada`, `puerto_en_local`, `hora_sin_fecha`, `fecha_requerida`, `fecha_futura`, `embarque_no_editable`, `embarque_con_recepciones`, `agrupador_cambio`, `plan_cambio` (también si cambia un mes y falta la huella), `max_entregas`, `reparto_sin_vector`. Aviso `ingreso_paquete_ajustado` |
| **`/api/compras/paquetes/[id]/ingreso`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `ingresoPaqueteSchema` | ídem | Los anteriores más `asignacion_con_recepciones`, `no_editable` (paquete cancelado) y `agrupador_cambio` si el paquete cambió de embarque entre la lectura y el candado |
| `/api/compras/embarques/[id]/fecha` (existe) | POST | `requireUser` | sin cambios | ídem | **Alias por una sola versión (`0.17.x`)**, solo para pestañas abiertas durante el despliegue (la pantalla nueva ya usa `/fechas`): equivale a `/fechas` con `fecha_ingreso_cd` y `causa = 'otro'` (hoy esa ruta cambia la «llegada al CD»: el significado se conserva). Se borra en la versión siguiente |
| `/api/compras/embarques` | POST | `requireUser` | alta con los cinco hitos y `origen` | `{ embarque }` | más `puerto_en_local`, `hora_sin_fecha` |
| `/api/compras/embarques/[id]` | PATCH | `requireUser` | sin fechas (`origen` sí) | `{ embarque }` | `409 fecha_por_movimiento` (clave de fecha presente y distinta, `null` incluido), `puerto_en_local` (pasar a `local` con Arribo o con `hito_confirmado = 'arribo'`). **Una fecha ausente ya no se vacía**: el servicio deja de mandar `?? null` y solo pasa las claves que trae el cuerpo |
| `/api/compras/embarques/[id]/paquete` (mover a paquete) | POST (`?previsualizar=1` nuevo) | `requireUser` | `moverAPaqueteSchema` ampliado | ídem | más `asignacion_con_recepciones`, `excede_entrega`, `motivo_requerido`, `causa_requerida`, `plan_cambio`, `reparto_sin_vector` |
| `/api/compras/embarques/[id]/estado` | POST | como hoy | — | — | más `hito_confirmado` |
| `/api/compras/embarques` | GET | `requireUser` | más `reprogramados=1` y `origen`; `atrasados=1` = algún hito `vencido` (no cuenta `por_confirmar`) | `{ embarques }` con `hitos` | — |
| `/api/compras/[id]` (M8, existe) | GET | `requireUser` | — | `CompraApi` **+ `linea_de_tiempo`** | — |
| `/api/compras` (M8, existe) | GET | `requireUser` | más `?proximo_hito=vencido` (no incluye `por_confirmar`); `q` busca también en `numero_oc` (y sigue buscando en `numero` y `referencia`) | cada compra **+ `proximo_hito`** y `numero_oc` | — |
| **`/api/compras/[id]/oc`** (nueva) | PUT | `requireUser` | `editarOcSchema` | `{ compra: { id, numero, numero_oc }, avisos }` | 400; 404 `no_encontrado`; 409 `oc_repetida` («La OC 4500012345 ya está en C-000201 de este proveedor»), `oc_cambio` («Otra persona cambió la OC: vuelve a abrirla»), `no_editable`, `sin_cambios`. Aviso `oc_de_otro_proveedor` |

Los cambios en las lecturas de M8 son **aditivos** (dueño `backend`). La única escritura nueva sobre compras es `/oc`, por `editar_oc_compra`.

### 3.3 Tipos (`tipos-api.ts`)

```ts
type Hito = "orden_compra" | "zarpe" | "arribo" | "ingreso_cd" | "inicio_operativo" | "ingreso_stock";
type EstadoHito = "real" | "sin_registrar" | "vencido" | "por_confirmar" | "previsto" | "pendiente" | "no_aplica";
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
- **`estadoHito`**: la tabla de §2.2, `por_confirmar` incluido. `hoy` entra como parámetro (sin reloj, como el resto de la lógica pura). El mes de cada tramo es `mesDeDestino` (§2.4 bis).
- **`proximoHito(compra)`**: entre los tramos que no están completos, el primer hito no `real` ni `sin_registrar` con la fecha más temprana (un `por_confirmar` cuenta, con su texto); si alguno está `vencido`, gana el vencido más antiguo. Una compra sin tramos pendientes no tiene próximo hito. El filtro «Con hitos vencidos» mira solo `vencido`.
- **Lectura** (ALTO 4). `GET /api/compras/[id]` ya lee las asignaciones de la compra; suma una lectura de sus embarques y paquetes (`in` por id). `GET /api/compras` lee, para las compras de la página, las asignaciones activas y después sus embarques y paquetes, en tandas de 150 ids (decisión de M3), no una consulta por compra. **Cada tanda se lee con `leerTodo`** (`src/lib/arbol/consultas.ts:19`, `order('id')` y `range`), como ya hace `src/lib/compras/consultas.ts:82`: 150 compras con varias líneas y asignaciones pasan con facilidad de 1 000 filas, y PostgREST corta en 1 000 **sin avisar** (el próximo hito saldría mal sin ningún error). Lo prueba F41 con más de 1 000 asignaciones.

### 3.5 Avisos nuevos

| Aviso | Texto |
|---|---|
| `oc_de_otro_proveedor` | §2.11 («La OC 4500012345 también está en C-000202 de Feria Sur: ¿es otra orden?»). `oc_repetida` ya no es un aviso: es un `409` (y, en el importador, una OC que no se aplica, §3.7) |
| `ingreso_paquete_ajustado` | §2.5 («La tanda 1 estaba para el 04-abr, pero el embarque llega al CD el 20-abr: queda el 20-abr. Reprográmala si quieres otra fecha») |
| `llegada_antes_de_compra` (existe, `movimiento.ts:980`) | Cambia el texto para decir contra qué compara: «El ingreso al stock (mes del flujo: mar-27) es anterior al mes de la orden de compra de C-000101 (jul-26): el ingreso se rechazará» |
| `orden_de_fechas` | «El Ingreso al stock (12-nov) es anterior al Ingreso CD (15-nov)». Para cualquier par de hitos del embarque fuera de orden (el ingreso de un paquete no puede quedar antes de la llegada: se ajusta, `ingreso_paquete_ajustado`) |
| `hito_vencido` | «Debía arribar a puerto el 08-nov (hace 4 días): ¿ya arribó?». En la lista reemplaza a `atrasado`, que queda como el caso del ingreso al stock **`vencido`** (no sale si está `por_confirmar`) |
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
- **Simulación** (§2.4 bis): el mes de un embarque nuevo del archivo es el de `coalesce(FECHA_INGRESO_STOCK, FECHA_INGRESO_CD)` (`importar.ts:655`), y el código de sus paquetes, el del Ingreso CD (`mesPaquete`, `:547`). Los paquetes del importador nacen sin ingreso propio.
- La celda de fecha y hora de Excel la convierte el lector del navegador (`src/components/importador`) a texto `aaaa-mm-dd hh:mm` sin zona, igual que hoy convierte las fechas.

### 3.7 Importador de compras: solo la columna `OC`

- **La fecha de la Orden de compra ya es `FECHA_COMPRA`**, obligatoria desde M8. No se agregan columnas logísticas a la plantilla de compras: esas fechas son del embarque, y escribirlas desde un archivo de compras sería editar embarques existentes desde otro importador (contra la decisión 97) y permitir fechas distintas por compra dentro de un embarque (descartado en §2.1).
- **Columna nueva `OC`** (opcional; plantilla y lector de `src/lib/compras/importar.ts`). El enlace con la compra **no cambia**: la fila encuentra su compra por `PROVEEDOR` + `REFERENCIA`, como siempre; la `OC` nunca sirve para encontrar ni crear una compra.
  - **`OC` no entra en la huella** (`huellaContenido`) ni en `clave_importacion`. Así, completar la OC y reimportar sigue dando `igual` en las líneas, y nunca `cambiada` ni `nueva`.
  - **Vacía = «no dice nada»**: nunca borra una OC. Para quitarla, la pantalla.
  - Fila `nueva` (compra creada) o `igual`/`nueva` sobre una compra existente: si la `OC` del archivo es distinta de la guardada, se aplica con `editar_oc_compra` (con `p_antes` = la que leyó la previsualización y motivo «Importado de <archivo>»), en **una llamada más, en su propia transacción**, después de `importar_compra` y antes de las llamadas de agrupador. Un corte deja la compra sin OC; reimportar lo completa.
  - El reporte la muestra por compra: «OC registrada: 4500012345», «OC cambiada: 4500012300 → 4500012345», con el aviso `oc_de_otro_proveedor`.
  - **OC repetida en el mismo proveedor** (§2.11): si otra compra viva del proveedor ya la tiene en la base, o si otra compra **del mismo archivo** y del mismo proveedor trae la misma OC (la segunda en el orden del archivo), esa compra sale con `oc_repetida` y **su OC no se aplica**; sus líneas siguen su regla. La previsualización lo detecta leyendo las OC vivas de los proveedores del archivo; si aun así `editar_oc_compra` devuelve `oc_repetida` al aplicar (otra persona la puso entre medio), el reporte lo muestra igual.
  - **Filas de una misma compra con OC distintas**: la OC no se aplica a esa compra y sale el aviso `oc_distinta_en_compra` (las líneas siguen su regla), porque una OC equivocada es peor que ninguna. Con `FECHA_COMPRA` tampoco se elige una: las filas con otra fecha que la primera de su compra se **omiten** (`cabecera_inconsistente`, `src/lib/compras/importar.ts:572-576`). (La revisión 4 decía, mal, que con la fecha se elegía una al azar.)
  - **Comprador** (decisión 109): solo aplica OC a compras **nuevas** o a su **propio borrador**. Sobre una compra ajena o confirmada, la OC se omite con el aviso `oc_no_editable` («Pide a quien la registró o a un planner que ponga la OC, o hazlo desde la compra»); sus líneas siguen la regla de 109 sin cambios. Admin y planner la aplican en cualquier compra no cancelada. La función recibe el actor y lo vuelve a comprobar (como `importar_compra` en la `0034`), para que un descuido del backend no la desactive.
  - Compra cancelada: `oc_no_editable`.
- Las compras de COTV entran como en §2.7, con `OC` vacía. Después Javier completa la OC **en pantalla** o **reimportando la misma planilla C2** (la que importó, con sus referencias partidas si las partió) con la columna `OC` llena, la misma en todas las filas de cada compra: la referencia `COTV-{codigo_viaje}-{supplier_id}` encuentra cada compra, nada se duplica y solo cambia la OC.
- **Regla 3 de 08b §3.9** (con `EMBARQUE`, `LLEGADA` debe caer en el mes de destino, `llegada_distinta_del_embarque`): compara contra **`mesDeDestino(embarque, paquete de la fila)`** (§2.4 bis): el ingreso propio del paquete si la fila trae `PAQUETE` y el paquete lo tiene; si no, el mes del ingreso al stock del embarque.
- **Reimportar** el archivo de COTV después de repartir da `igual` (la huella es del archivo, 08b §3.9 regla 1) y una fila ya asignada no se toca (regla 2).

### 3.8 Excel: la línea de tiempo por proveedor

Hoja nueva **`LINEA_DE_TIEMPO`** en la descarga de Viajes y embarques (`excel.ts`, `hojaLineaDeTiempo`), **una fila por compra y tramo**, ordenada por proveedor y compra:

`PROVEEDOR · COMPRA (código X) · OC · VIAJE · EMBARQUE · ORIGEN · PAQUETE · UNIDADES · ORDEN DE COMPRA · ZARPE · ESTADO ZARPE · ARRIBO · ESTADO ARRIBO · INGRESO CD · ESTADO INGRESO CD · INICIO OPERATIVO (fecha y hora) · ESTADO INICIO OPERATIVO · INGRESO AL STOCK · ESTADO INGRESO AL STOCK · MES DEL FLUJO · REPROGRAMACIONES · ÚLTIMA CAUSA`

- Las fechas van como fecha de Excel (el Inicio operativo, como fecha y hora si tiene hora); el estado, en texto («Pendiente», «Previsto», «Ocurrió», «Vencido», «Por confirmar», «Ocurrió sin fecha», «No aplica»).
- Incluye los tramos «Sin embarque» de las compras del viaje elegido (se leen con `/agrupadores/sin-asignar`, que la página ya usa).
- Respeta el viaje activo y los filtros de la lista, como las demás hojas.
- La hoja `ASIGNACIONES` suma la columna `OC` junto a `COMPRA`.

### 3.9 Flujo y Huecos

**Sin cambios.** El método del flujo (`VERSION_METODO_FLUJO`) no cambia: sigue leyendo entregas, y lo único que lo mueve es un cambio de **mes** de una asignación (I5, revisiones, huella). No se toca `src/lib/flujo/**`.

## 4. Pantallas (kit de Vector2; `es-PE`; 390 px; lenguaje llano)

**Nombres y marcadores fijos en toda la pantalla**: ⚪ Orden de compra · 🔵 Zarpe · 🔴 Arribo · ⚫ Ingreso CD · 🚀 Inicio operativo · 🟢 Ingreso al stock. Los marcadores son los del reporte de Javier y se dibujan como un punto o ícono de color (`aria-hidden`) **siempre acompañado** del nombre del hito y del estado en texto (§2.2): el color nunca es la única señal. Un hito `vencido` lleva además el texto «Vencido» y un borde; uno `real`, «✓ Ocurrió».

### 4.1 Línea de tiempo en el detalle de la compra (nuevo)

**Encabezado de la compra**: «Compra C-000201 · OC 4500012345» con **«Editar OC»**, o «Compra C-000201 · OC sin registrar» con **«Registrar OC»**. El diálogo pide el número (≤ 40, letras, números, `-`, `/`, `_`, `.` y espacios), y motivo solo si reemplaza una OC que ya tenía; muestra antes de guardar, mientras se escribe, si la OC ya está en otra compra: del **mismo** proveedor bloquea el botón («Ya está en C-000203 de este proveedor. Una OC es de una sola compra: revisa el número o cancela la otra compra»); de **otro** proveedor solo avisa («También está en C-000202 de Feria Sur: ¿es otra orden?»). Mensajes: «Otra persona cambió la OC mientras editabas: vuelve a abrirla» (`oc_cambio`), la misma frase de `oc_repetida` si alguien la puso entre medio, «Una compra cancelada no se edita». El historial de la compra muestra «C1 registró la OC 4500012345» y «A cambió la OC 4500012300 → 4500012345 · "Error de tipeo"».

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
- Un ingreso al stock `por_confirmar` se ve «08/11/2026 · Llegó, falta confirmar el ingreso», sin borde de vencido.

### 4.2 Lista de Compras: código X, OC y «Próximo hito»

- La columna **Compra** muestra el código X y, debajo, «OC 4500012345» (o nada si no tiene). El buscador encuentra por código X, por OC o por referencia («Compra, OC, referencia o proveedor»).

- Columna **«Próximo hito»**: «🔴 Arribo · 18-nov · Previsto» o «⚫ Ingreso CD · 08-nov · Vencido (hace 4 días)»; con varios tramos, el más urgente y «+1 tramo».
- Filtro **«Con hitos vencidos»** (`proximo_hito=vencido`): solo `vencido`; un ingreso «Por confirmar» no entra.
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
- **Ajustes al piso** (§2.5), en la vista previa: «La tanda 1 (04-abr) quedará el 20-abr, el día que llega al CD.»
- **Mensajes**: «Este embarque ya tiene ingresos confirmados: el mes no se puede cambiar.» · «No puedes marcar como ocurrida una fecha futura.» · «Este hito ya figura como ocurrido: para moverlo a una fecha futura, desmarca «¿Ya ocurrió?».» · «Pon la fecha del inicio operativo antes que la hora.» · «Cambió el embarque mientras editabas: vuelve a abrirlo.»

### 4.4 Línea de tiempo del embarque

- Los **cinco hitos logísticos** con la marca de «hoy», estado, retraso contra lo planeado al crear y número de cambios. Encima, «Órdenes de compra: 06-jul a 20-jul · 5 compras» (el rango de `fecha_compra` de sus compras).
- Debajo del Ingreso al stock, los **paquetes con ingreso propio**: «Al barrer · tanda 1 → 15-ene (dic → ene) · 600 u de 2 lotes».
- A 390 px, en vertical.

### 4.5 Paquetes y lo al barrer

- **En cada paquete**: «Ingreso al stock: hereda del embarque (03-dic)» o «Ingreso propio: 15-ene», con **«Fijar ingreso…»** (motivo, causa y vista previa con temporada: «2 lotes al barrer cambian de temporada: verano → invierno, se reparten de nuevo con la versión 3»). El selector no ofrece días antes del Ingreso CD; si el paquete fue subido al piso, lo dice: «Ajustado a la llegada del embarque (antes: 04-abr)».
- **«Mover a paquete»**: unidades editables por asignación, con vista previa si cambia de mes.
- **«Programar lo al barrer»** (§2.5) con **«Agregar otra tanda»**; la suma queda a la vista: «Asignado 1 000 de 1 000 u».

### 4.6 Repartir las compras de un viaje (COTV)

Sin pantalla nueva: «Sin agrupador» (filtro Proveedor, «Asignar a embarque…») y «Agregar compras» del detalle del embarque (filtros Viaje y Proveedor, «Marcar las visibles», unidades editables, vista previa). Lo nuevo que se ve es el **Origen** en el selector de embarques («Embarque 261201 · California») y, en cada compra, su línea de tiempo con un tramo por embarque.

### 4.7 Lista de Embarques e Historial

- **Lista de Embarques**: columnas Zarpe · Arribo · Ingreso CD · Inicio operativo · **Ingreso al stock** (fecha y mes; «fijado» o «igual al Ingreso CD») · Origen · **Próximo hito** · **Reprogramado ×N**; filtros Atrasados (algún hito `vencido`; «Por confirmar» no cuenta), Reprogramados y Origen; en el celular, tarjetas.
- **Historial**, en llano y por hito:
  - «C1 cambió las fechas · Causa: Aduana · "Aforo físico" · Ingreso CD 15-nov → 03-dic · Ingreso al stock 15-nov → 03-dic (sigue al Ingreso CD; movió 5 compras de nov a dic)»;
  - «A marcó el inicio operativo: 05-nov 09:22 (ocurrió)»;
  - «C2 fijó el ingreso al stock del paquete Al barrer: 15-ene (causa: Programación)».

### 4.8 Qué ve cada rol

Los tres roles: todo lo de esta ficha (el comprador ya ve Compras y escribe agrupadores, decisiones 92 y 108). Solo admin y planner: lo que ya lo era (cancelar, cerrar, reabrir).

## 5. Reglas de negocio (con su prueba en vitest)

| # | Regla |
|---|---|
| F-R1 | Mes de un embarque = mes de `coalesce(real, ingreso al stock, Ingreso CD)`, en la columna y en TS. Mes de una asignación = `mesDeDestino(embarque, paquete) = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)`, la misma regla en los cuatro planes, `mover_a_paquete`, `cerrarPlan`, `avisos.ts`, los dos importadores, la línea de tiempo, la I2 de la función, `embarque_con_recepciones` y `agrupadores_desalineados` (§2.4 bis). Zarpe, Arribo, Inicio operativo y `hito_confirmado` nunca tocan compras (I6) |
| F-R2 | Ingreso al stock nulo = el día del Ingreso CD, y lo sigue. Fijado no se mueve si cambia el Ingreso CD. «Igualar al Ingreso CD» lo vuelve a nulo. El Inicio operativo nunca decide el mes |
| F-R3 | Reprogramar exige motivo y causa; completar una fecha u hora vacía, confirmar un hito o que el ingreso sin fijar siga al Ingreso CD, no (§2.10 paso 3) |
| F-R4 | Zarpe ≤ Ingreso CD bloquea; Arribo en `local` y hora sin fecha bloquean. Cualquier otro desorden entre hitos solo avisa |
| F-R5 | Confirmar un hito exige su fecha, no futura (con hora si la tiene), deja los anteriores sin fecha como «ocurrió sin fecha» y pasa el embarque a en tránsito. Volver a planificado con un hito confirmado da `hito_confirmado`. **En todo guardado** (I7) ningún hito en o antes del confirmado queda con fecha futura ni el confirmado sin fecha; pasar a `local` con Arribo da `puerto_en_local` |
| F-R6 | El ingreso de un paquete, o mover a un paquete con otro mes, mueve entregas, reparte de nuevo los lotes si cambia la temporada (misma versión) y respeta las recepciones vinculadas |
| F-R7 | `mover_a_paquete` acepta unidades parciales y `Σ` de la línea no cambia (I3) |
| F-R8 | Asignar a un embarque compras sin embarque mueve unidades dentro de la misma línea: `Σ` por línea y `Σ` del flujo no cambian (sin doble conteo) |
| F-R9 | Reprogramaciones y retraso se derivan de los eventos, sin contar `correccion` ni `programacion` |
| F-R10 | `PATCH` no cambia ni vacía fechas ni horas |
| F-R11 | Importador de agrupadores: `FECHA_INGRESO_CD` (o `FECHA_LLEGADA`) obligatoria; sinónimos; `INICIO_OPERATIVO` con hora opcional; `FECHA_INGRESO_STOCK` vacía = Ingreso CD |
| F-R12 | La `0038` no mueve nada: mismas `periodo_llegada`, entregas y asignaciones, y `agrupadores_desalineados() = 0` antes y después |
| F-R13 | Línea de tiempo de la compra: un tramo por (embarque, paquete) más uno por mes sin embarque; Σ unidades de los tramos = Σ de las líneas de la compra; estados según §2.2; próximo hito según §3.4 |
| F-R14 | Número de OC: editarlo no sube `compras.revision` ni bloquea movimientos, deja el evento `editar_oc` con antes y después, responde `sin_cambios` a un reintento antes de mirar `antes`, rechaza si cambió entre medio (`oc_cambio`) y no se edita en una compra cancelada. **Única por proveedor entre compras no canceladas** (`409 oc_repetida`); en otro proveedor, aviso `oc_de_otro_proveedor`. La `referencia` nunca cambia. En el importador, la `OC` no entra en la huella, vacía no borra, repetida en el proveedor (en la base o en el archivo) no se aplica, y el comprador solo la pone en compras nuevas o en su borrador |
| F-R15 | **Nunca antes de la llegada** (I9): el ingreso propio de un paquete que quedaría antes de `coalesce(real, Ingreso CD)` de su embarque se sube a ese día con aviso `ingreso_paquete_ajustado`, al fijarlo, al atrasar el Ingreso CD y al mover el paquete; nunca se rechaza por eso. Un plan que lo viole: `AG002` |
| F-R16 | `por_confirmar`: ingreso al stock pasado, sin real y con `hito_confirmado` ≥ `ingreso_cd`; no cuenta como vencido ni en Atrasados ni en «Con hitos vencidos». El tramo «Sin embarque» es siempre `pendiente` |
| F-R17 | La lista de Compras calcula `proximo_hito` con **todas** las asignaciones de la página aunque pasen de 1 000 filas (`leerTodo` por tanda) |
| F-R18 | Planilla C2 de COTV: una compra por (proveedor de Vector2, viaje); `REFERENCIA = COTV-{codigo_viaje}-{supplier_id}`; `LINEA_ORDINAL` por `created_at`, `id`; **una** `FECHA_COMPRA` por grupo = día en Lima del ítem más antiguo; `DIA_REGISTRO` e `ITEM_COTV` por fila; `NOTA` igual en el grupo. Importarla da 0 `cabecera_inconsistente` |

### Casos numéricos

**Supuestos del fixture de 08b**: hoy es **2026-11-12** (Lima, 10:00), `k' = 2026-09` y temporadas por defecto (verano oct–mar, invierno abr–sep).

**Datos de partida**:

- **261101**: importación, viaje 261001, **en tránsito con `hito_confirmado = zarpe`** (MEDIO 5). Zarpe 05-oct, Arribo 08-nov, Ingreso CD 15-nov, sin Inicio operativo, ingreso al stock nulo → **nov-26**. Contiene l1 de C-000101 (fecha de compra 06-jul-26; nov 300; la línea tiene además dic 200 sin embarque) y C-000102 POLO (nov 400).
- **270301**: planificado, sin hitos confirmados. Ingreso CD 05-mar-27, ingreso nulo → mar-27. Contiene l2 de C-000101, el lote BETA de 1 000 u (mar 600 en el embarque · abr 400 sin embarque, reparto v2).
- **270401** (Ingreso CD 20-abr-27) y **270601** (Ingreso CD 15-jun-27), planificados y vacíos, para F36.

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
| F14 | Importar 3 filas `VIAJE = 261001`, `LLEGADA = 2026-12`, sin `EMBARQUE`: dos de Proveedor Norte con la misma `REFERENCIA` (`COTV-261001-…norte`, ordinales 1 y 2: 300 u y 200 u, `FECHA_COMPRA` 06-jul en las dos) y una de Feria Sur (`COTV-261001-…sur`, 500 u, 10-jul) | **Dos compras**: C-000201 (Proveedor Norte, 2 líneas, 500 u) y C-000202 (Feria Sur, 500 u), con entregas dic-26 **sin embarque**. Flujo de dic +1 000 u. Línea de tiempo de C-000201: un tramo «Sin embarque · 500 u» con ⚪ 06/07/2026 Ocurrió, 🔵🔴⚫🚀 Pendiente y 🟢 «dic-26, sin embarque». Con la segunda fila de Norte en `FECHA_COMPRA` 07-jul: esa fila sale `cabecera_inconsistente` y no entra |
| F15 | Crear «California» (origen California, Ingreso CD 15-dic → dic) y «Nueva York» (Ingreso CD 15-ene-27 → ene). Asignar: Proveedor Norte (C-000201, sus dos líneas, 500 u) → California; C-000202 250 → California y 250 → Nueva York | dic-26 750 u y ene-27 250 u: **Σ 1 000, sin doble conteo**. C-000202 queda con dos entregas (dic 250 · ene 250) y **dos tramos** en su línea de tiempo (California 250 · Nueva York 250). Nada queda sin embarque |
| F16 | Reimportar el archivo de F14 | 3 `igual`. No se mueve nada |
| F17 | Fila de compras con `EMBARQUE` = Nueva York y `LLEGADA = 2026-12` | `llegada_distinta_del_embarque` (compara con el mes de destino). Con `2027-01`, entra |
| F18 | Importar agrupadores con un archivo viejo (`FECHA_SALIDA`, `FECHA_LLEGADA`) | Se leen como Zarpe e Ingreso CD; ingreso al stock nulo. Reimportar da `igual`. `INICIO_OPERATIVO = 2026-11-05 09:22` queda con fecha y hora; `= 2026-11-05` solo con fecha; `= 2026-11-05 25:10` da `hora_invalida`. `FECHA_LLEGADA` y `FECHA_INGRESO_CD` distintas: `fechas_en_conflicto` |
| F19 | Zarpe 25-nov con Ingreso CD 22-nov | `salida_despues_de_llegada`. Si en el mismo envío el Ingreso CD pasa a 30-nov: OK. Arribo en un `local`: `puerto_en_local`. Hora sin fecha de Inicio operativo: `hora_sin_fecha` |
| F20 | En 270301 (planificado), poner el Arribo en 18-nov (futuro) y marcar «ya arribó» | `fecha_futura`. Poner Zarpe 10-nov y marcar «ya zarpó»: pasa a en tránsito (aviso `pasa_a_en_transito`). Volver a planificado: `hito_confirmado` |
| F21 | **El caso de Javier**: embarque con Zarpe y Arribo vacíos, Ingreso CD 02-nov-26; marcar `hito_confirmado = inicio_operativo` con Inicio operativo 05-nov-26 09:22 | Se acepta. Zarpe y Arribo quedan `sin_registrar` («Ocurrió · sin fecha»); Ingreso CD e Inicio operativo `real`; ingreso al stock 02-nov (igual al Ingreso CD) **`por_confirmar`** («Llegó, falta confirmar el ingreso»), no `vencido`: ya pasó (hoy es 12-nov) y el hito confirmado es posterior al Ingreso CD. Con Inicio operativo 12-nov 11:00 (más tarde que la hora de hoy): `fecha_futura` |
| F22 | `PATCH` sin `fecha_salida_estimada` | **La salida se conserva** (hoy se borra). Si trae una distinta, o `null` explícito con una salida guardada: `fecha_por_movimiento`. Con la misma: OK |
| F23 | Alias `/fecha` | Igual que `/fechas` con solo el Ingreso CD y causa `otro` |
| F24 | `agrupador_hitos_resumen` tras F3, F5 y F8 | Ingreso CD 1 reprogramación (+18 d, `aduana`); Arribo 1 (+10 d); el cambio de F5 queda en el historial y no suma atraso |
| F25 | Línea de tiempo y próximo hito de C-000101 (fixture de partida, con el Zarpe de 261101 confirmado) | Tramos: 261101 nov 300 · «Sin embarque» dic 200 · 270301 mar 600 · «Sin embarque» abr 400. Σ = 1 500 = Σ de sus líneas. En 261101: Zarpe 05-oct `real`, Arribo 08-nov `vencido`, Ingreso CD 15-nov `previsto`. Próximo hito: el vencido más antiguo → «🔴 Arribo · 08-nov · Vencido (hace 4 días)» (sin el Zarpe confirmado, el vencido más antiguo sería el Zarpe; por eso el fixture lo confirma) |
| F26 | Hoja `LINEA_DE_TIEMPO` del Excel con el estado de F15 | Una fila por compra y tramo (C-000202 en dos filas), ordenadas por proveedor; fechas como fecha de Excel; el Inicio operativo con hora cuando la tiene; estados en texto |

| F27 | Registrar la OC `4500012345` en C-000201 (sin OC, `antes = null`) | `numero_oc` guardada; `compras.revision` **igual**; un evento `editar_oc` con `antes { numero_oc: null }` y `despues`; la huella del flujo cambia una vez y ninguna cifra del flujo cambia. Un plan de movimiento previsualizado antes sobre C-000201 se aplica sin `plan_cambio` |
| F28 | Dos personas editan la OC a la vez con `antes = null`; la segunda llega después | La segunda: `409 oc_cambio`, sin escribir. Con `antes` igual al nuevo valor ya guardado y el mismo número: `sin_cambios` |
| F29 | Editar la OC de una compra cancelada | `no_editable` |
| F30 | Crear a mano C-000203 (Proveedor Norte, viaje 261001: su segunda OC del viaje). Poner `4500012345` en C-000203 y en C-000202 (Feria Sur) | C-000203: **`409 oc_repetida`** («ya está en C-000201 de este proveedor»), no escribe nada. Con ` 4500012345` o en otra caja de letras (`4500AB` / `4500ab`), igual (`upper(btrim)`). C-000202: se guarda con aviso `oc_de_otro_proveedor`. Cancelar C-000201 y repetir en C-000203: se guarda. Quitar la OC (`null`) deja el evento «OC: 4500012345 → —» |
| F31 | Reimportar el archivo de F14 con la columna `OC` llena (las dos filas de C-000201 con `4500012345`, C-000202 vacía), como admin | Líneas: 3 `igual`. C-000201 queda con OC (reporte «OC registrada»); C-000202 sin cambio (vacía no borra). Reimportar otra vez: nada cambia. Dos filas de una compra con OC distintas: `oc_distinta_en_compra` y la OC no se aplica. Un archivo con dos compras de Proveedor Norte (C-000201 y C-000203) con la misma OC: la segunda sale `oc_repetida` y su OC no se aplica (sus líneas sí siguen su regla); igual si la OC ya estaba en otra compra viva de Norte en la base |
| F32 | Un comprador importa un archivo con `OC` para una compra confirmada ajena | Sus líneas siguen la decisión 109; la OC se omite con `oc_no_editable`; la función también lo rechaza si el backend la llamara igual. En una compra nueva suya, la OC se registra |
| F33 | Buscar en la lista de Compras por `4500012345`, por `c-000201` y por `COTV-` | Encuentra por OC, por código X y por referencia; la columna Compra muestra el código X y la OC. La hoja `LINEA_DE_TIEMPO` y la hoja `ASIGNACIONES` llevan la OC |

**Mes de destino, piso, estados y lecturas** (revisión 5):

| # | Acción | Resultado esperado |
|---|---|---|
| F34 | Desde F11 (l2: abr 700 = 300 de la tanda 1 + 400 sin embarque · may 300 en la tanda 2, ingreso 10-may), «Agregar compras» en 270301 con destino el paquete **tanda 2**: 100 u de la entrega abr sin embarque | Las 100 u van a **may-27**, no a mar-27 (el mes del embarque): l2 queda abr 600 · may 400, Σ 1 000, repartidas con invierno. Sin `AG002` ni `desalineada` |
| F35 | `pasar_pendientes` de 261101 (C-000102 POLO, 400 sin recibir) a 270301 con paquete destino **tanda 2** | Las 400 u quedan en **may-27** (el mes de la tanda), no en mar-27 |
| F36 | `mover_paquete` de la tanda 2 (ingreso 10-may) de 270301 a 270401 (Ingreso CD 20-abr) | Conserva el 10-may: ninguna entrega cambia de mes, solo el embarque de las asignaciones. Moverla después a 270601 (Ingreso CD 15-jun): el ingreso sube al **15-jun** con aviso `ingreso_paquete_ajustado`; sus asignaciones pasan de may a jun y los lotes se reparten de nuevo (invierno, misma versión) |
| F37 | Importar compras: fila con `EMBARQUE` 270301, `PAQUETE` tanda 2 y `LLEGADA = 2027-03` | `llegada_distinta_del_embarque` (el mes de destino es may-27). Con `2027-05` entra, queda en may y aplicar no da `AG002` |
| F38 | Piso. (a) Fijar el ingreso de la tanda 1 de 270301 en 01-mar-27 (Ingreso CD 05-mar). (b) Desde F11, mover el Ingreso CD de 270301 a 20-abr-27 (causa `naviera`). (c) Moverlo a 12-may-27 | (a) Queda el **05-mar** con aviso; mes mar. (b) La tanda 1 (04-abr) sube a 20-abr con aviso y sigue en abr; la tanda 2 (10-may) no se mueve; lo que no está en paquete pasa de mar a abr. (c) Las dos tandas suben a 12-may (dos avisos) y todo queda en may. Un solo evento con el motivo; I9 en verde. Un plan armado a mano que deja un paquete antes del piso: `AG002` |
| F39 | Embarque con Ingreso CD 02-nov, ingreso al stock fijado 08-nov y `hito_confirmado = ingreso_cd` (hoy 12-nov) | Ingreso al stock **`por_confirmar`**; la compra no sale en «Con hitos vencidos» ni el embarque en Atrasados; su próximo hito es ese ingreso «Por confirmar». Con `hito_confirmado = arribo`: Ingreso CD e ingreso al stock `vencido` |
| F40 | Integridad. (a) En F21, cambiar el Inicio operativo confirmado a 20-nov. (b) Lo mismo bajando en el mismo envío `hito_confirmado` a nulo. (c) En F21, vaciar el Inicio operativo (el hito confirmado). (d) `PATCH` de 261101 (Arribo 08-nov) a `tipo = local`. (e) Insertar como `postgres` `hito_confirmado = 'llegada'` o `causa = 'clima'` | (a) `fecha_futura`. (b) Se acepta como reprogramación (pide motivo y causa). (c) `fecha_requerida`. (d) `puerto_en_local`; un embarque sin Arribo y sin `hito_confirmado = arribo` pasa a `local`. (e) Viola el `check` (humo) |
| F41 | Handler de `GET /api/compras` con 150 compras de 8 líneas y una asignación por línea (1 200 asignaciones) y un cliente simulado que corta en 1 000 filas | El `proximo_hito` de las 150 compras es el mismo que con todas las filas en memoria; ninguna compra pierde tramos |
| F42 | Planilla C2 (`agruparItemsCotv`, datos sintéticos): proveedor X del viaje V con ítems registrados el 06-jul a las 23:30 de Lima (`purchase_date` 07-jul por UTC) y el 20-jul a las 10:00; un proveedor Z que C1 unió a X; un proveedor Y con un ítem | Dos compras: X+Z en `COTV-{V}-{id de X}` con ordinales 1… por `created_at`, `FECHA_COMPRA` **06-jul** (no el 07-jul de `purchase_date`) en todas sus filas, `DIA_REGISTRO` por fila y la marca «varios días» en `GRUPOS`; Y aparte. Si Javier cambia la `REFERENCIA` de las filas del 20-jul a `…-2` y su `FECHA_COMPRA` a 20-jul, el importador crea tres compras sin `cabecera_inconsistente`; si no cambia la fecha, la segunda queda con 06-jul (sin error) |
| F43 | Reintento de F27 tras un corte de red (mismo cuerpo `antes = null`, `numero_oc = 4500012345`, ya guardado) | `sin_cambios`, no `oc_cambio` |
| F44 | Cambiar solo el Arribo (F8) sin `huella_plan`. Cambiar el Ingreso CD de 261101 a otro mes sin `huella_plan` | El primero se aplica. El segundo: `plan_cambio` («Revisa la vista previa») |
| F45 | Humo: un plan `asignar` sobre 270301 que deja otra asignación del embarque (de un paquete con ingreso propio) fuera de su mes de destino; `agrupadores_desalineados()` con una asignación de un paquete con ingreso propio alineada a su paquete y otra desalineada (insertadas como `postgres`) | `AG002`. La función cuenta solo la desalineada |
| F46 | Crear un embarque con Ingreso CD 15-nov e ingreso al stock 02-dic, y un paquete en él (en pantalla y por el importador de agrupadores) | Embarque `2611##` (cuenta en dic); paquete `2611##`: el mes del Ingreso CD, no dic |

**Concurrencia** (`tests/integracion/concurrencia.int.test.ts`; ninguna debe dar `40P01`):

- (a) `/fechas` con cambio de mes contra `asignar_viaje_compras`, con una compra compartida.
- (b) `/fechas` contra `guardar_embarque` del mismo embarque.
- (c) Ingreso de un paquete contra `guardar_paquete` del mismo embarque.
- (d) `mover_a_paquete` con unidades contra «Agregar compras» (asignar) sobre la misma compra.
- (e) `editar_oc_compra` contra `aplicar_movimiento_agrupador` sobre la misma compra: los dos terminan, y el movimiento no recibe `compra_cambio` (la OC no sube la revisión).
- (f) Dos `editar_oc_compra` a la vez con la misma OC sobre dos compras del mismo proveedor: una se guarda y la otra recibe `oc_repetida`.
- (g) `/paquetes/[id]/ingreso` contra `mover_paquete` del mismo paquete: el que llega segundo recibe `agrupador_cambio` (o se aplica sobre el embarque nuevo si su plan ya lo era), nunca un paquete con ingreso escrito en el embarque equivocado.

**Humo `scripts/humo-0038.sql`**: casos F2, F3, F5, F6, F8, F10, F13, F15, F21, F27 a F30, F38, F40 (c, e), F43, F45 y F46 en SQL; I6 a I10; los `check` de hora sin fecha, `numero_oc`, `hito_confirmado` y `causa`; el índice único `compras_proveedor_oc_uidx` (F30); la expresión de `periodo_llegada` (`pg_get_expr`) y que las tres funciones de §2.4 bis contienen el `coalesce`; `guardar_embarque` al editar sin salida conserva la salida y con `null` explícito da `fecha_por_movimiento` (F22); aplicar la migración dos veces; privilegios; la fila `0038_fechas_logisticas_embarque` en `migraciones_aplicadas`. **F2 se prueba en local con el fixture cargado**: en `vector-two` hay 0 filas y no prueba nada.

## 6. Criterios de aceptación / hito de prueba

- [ ] `datos` confirma al empezar T0 los hechos de §9.1 (PostgreSQL 17, `0037` última, 0 filas).
- [ ] La `0038` aplica dos veces y queda en `migraciones_aplicadas`; humo en verde; tipos regenerados; F2 sin movimiento (en local, con el fixture).
- [ ] lint, `tsc`, vitest (F1–F46 y los casos 1–19 de 08b sin tocarlos; las pruebas del importador de M8 sin tocar, salvo las nuevas de `OC`) y build en verde. Concurrencia (a) a (g) sin `40P01`. La prueba estática de `mesDeDestino` en verde.
- [ ] **Javier, línea de tiempo**: abrir una compra y ver sus seis hitos con los marcadores ⚪🔵🔴⚫🚀🟢 y el estado en texto; registrar el caso de su ejemplo (Zarpe y Arribo sin fecha, Ingreso CD, Inicio operativo con hora) y verlo igual que en su reporte. Ver «Próximo hito» en la lista de Compras y filtrar los vencidos. Descargar el Excel y revisar la hoja `LINEA_DE_TIEMPO`.
- [ ] **Javier, número de OC**: ver una compra nueva con su código X y «OC sin registrar»; registrar la OC, cambiarla con un motivo y ver las dos cosas en el historial; intentar poner la misma OC en otra compra del mismo proveedor y ver que no lo deja; buscar la compra por su OC en la lista; reimportar una planilla con la columna `OC` y comprobar que no se duplicó ninguna compra.
- [ ] **Javier, fechas**: crear un embarque con su Ingreso CD y ver que ingresa al stock el mismo día. Fijar el ingreso al stock en otro mes y ver en Flujo mensual que las compras cambian de mes; «Igualar al Ingreso CD» y verlas volver. Reprogramar el Ingreso CD por «Aduana». Marcar «ya zarpó». Editar el nombre de un embarque y comprobar que el zarpe **no** se borra.
- [ ] **Javier, lo al barrer**: «Programar lo al barrer» en un embarque con un lote, primero todo junto y después en dos tandas; ver el cambio de temporada en la vista previa y el lote en sus meses en el Flujo. Atrasar el Ingreso CD después de la tanda 1 y ver que la vista previa la corre a la llegada y te avisa.
- [ ] **Javier, COTV** (cuando C2 esté lista): revisar en la planilla la hoja `GRUPOS`, partir por `REFERENCIA` los proveedores que tuvieron dos OC, importarla con `LLEGADA = 2026-12` y ver una compra por proveedor y viaje (o por OC partida) en diciembre en el Flujo, con la orden de compra en su línea de tiempo. Crear «California» y «Nueva York» con origen y fechas, asignar por proveedor (una compra partida entre los dos: dos tramos) y comprobar que el total del flujo no cambió y que nada queda en «Sin agrupador».
- [ ] Un embarque ya ingresado al CD con su ingreso al stock pasado se ve «Por confirmar» y no sale en Atrasados. Historial con causa y motivo, contador de reprogramaciones, Atrasados, todo a 390 px, y los marcadores legibles sin color (lector de pantalla y escala de grises).
- [ ] `seguridad` (sonnet): guards, IDOR de paquetes y asignaciones en `mover_a_paquete` con unidades y en `paquetes/[id]/ingreso`, que `linea_de_tiempo` no exponga embarques de otra compra, que `/oc` no permita editar sin `antes` correcto ni una compra cancelada, que el comprador no pise OC ajenas por el importador (asimetría deliberada de la decisión 121), que `paquetes/[id]/ingreso` no escriba en un paquete que cambió de embarque, funciones solo `service_role`, catálogos zod y `check` de la base.

## 7. Fuera de alcance

- Fechas logísticas propias por compra dentro de un embarque (§2.1); conteo, arribo o inicio operativo propios del paquete; «ya ocurrió» por paquete.
- Editar la fecha de la Orden de compra (`fecha_compra`) desde esta pantalla: es de `0.13.1`.
- Editar la `referencia` de importación; **dividir, unir o mover líneas entre compras** (mejora de `0.13.1`; hasta entonces, cancelar y reimportar, §2.7); cambiar el proveedor de una compra (`0.13.1`, chocará con `compras_proveedor_oc_uidx`); normalizar espacios internos de la OC; traer la OC desde SAP automáticamente.
- Cola calculada o con capacidad; parámetros de cola.
- Embarque o mes provisional por viaje; avisos o banners de unidades sin repartir.
- Operación «dividir por origen» y filtro por región del proveedor (mejora futura tras E1 de la 08c, §2.7).
- Maestro de almacenes de origen (más adelante, en la ficha del proveedor de la 08c).
- Hora en otros hitos que no sean el Inicio operativo; seguimiento naviero o de aduana; fecha real por hito distinta de la confirmación, salvo el ingreso (08b-2).
- Pagos como entidad (118).
- Columnas logísticas en el importador de compras; cambios al flujo.
- Que el importador de agrupadores edite o complete lo existente (decisión 97).
- Recibir y confirmar el ingreso al stock: 08b-2 (hereda el piso de §2.5 y convierte `por_confirmar` en `real`).
- Columna de ingreso propio de paquete en el importador de agrupadores (los paquetes importados nacen sin él).

## 8. Decisiones propuestas (a registrar al construir; siguen propuestas hasta entonces; 115, 117, 119, 120 y 121 reajustadas en la revisión 5)

| N.º | Decisión |
|---|---|
| 115 | **El mes del flujo es el del ingreso al stock.** `fecha_llegada_estimada` conserva su significado de origen (Ingreso CD) y es la obligatoria. El ingreso al stock es una columna nueva, nula = el día del Ingreso CD. `periodo_llegada = mes de coalesce(real, ingreso, Ingreso CD)`, cambiando la expresión de la columna generada (`set expression`, PostgreSQL 17.11 verificado). **El mes de una asignación es `mesDeDestino(embarque, paquete) = coalesce(paquete.periodo_ingreso, embarque.periodo_llegada)`**, una sola regla en TS y en SQL para planes, avisos, importadores, la I2 de la función, `embarque_con_recepciones` y `agrupadores_desalineados`. Los códigos `aamm##` de embarque **y de paquete** toman el mes del Ingreso CD. Precisa la 83 |
| 116 | **Toda reprogramación lleva motivo y causa** (catálogo con `pago`, `cola_conteo`, `programacion`, `correccion`…); completar, confirmar o que el ingreso sin fijar siga al Ingreso CD, no. Contadores y retraso derivados de los eventos, sin contar `correccion` ni `programacion`. «Ya ocurrió» con `hito_confirmado`: exige la fecha del hito confirmado, no futura; los anteriores sin fecha quedan «ocurrió sin fecha». Los desórdenes avisan; solo zarpe > Ingreso CD, arribo en local y hora sin fecha bloquean. El `PATCH` de un embarque nunca cambia ni vacía fechas |
| 117 | **Compras de COTV: una compra por proveedor y viaje** (Javier: «solo por proveedor + viaje»), `REFERENCIA = COTV-{codigo_viaje}-{supplier_id}`, una sola `FECHA_COMPRA` por grupo = día en Lima del registro del ítem más antiguo (no `purchase_date`, que es el día UTC), `DIA_REGISTRO` e `ITEM_COTV` informativas, `VIAJE`, `LLEGADA = 2026-12` y sin embarque; cuentan en diciembre como cualquier entrega sin embarque. Si un proveedor tuvo dos OC en el viaje, Javier parte el grupo editando `REFERENCIA` antes de importar; después, se corrige cancelando y reimportando (dividir o mover líneas es de `0.13.1`). Javier las reparte por proveedor con «Asignar» por unidades, que mueve unidades dentro de la misma línea (sin doble conteo). Sin embarque ni mes provisional. El origen (California o Nueva York) es un dato de texto del embarque. Si de un embarque solo se sabe el mes, su fecha es el día 15. Responde G2 de 08c §12.8 y cambia §12.2 b y §12.5 |
| 118 | **Pagos: causa de la reprogramación, no un campo** (Javier, P2) |
| 119 | **El ingreso al stock lo fija Javier**, sin cola calculada ni parámetros: por embarque (nulo = Ingreso CD) y **por paquete** (ingreso propio). Lo al barrer se programa por paquete, todo junto o por partes en varios paquetes, y se reparte de nuevo con la temporada del mes nuevo (decisión 86). **Nunca antes de la llegada** (Javier): el ingreso propio de un paquete no queda antes de `coalesce(real, Ingreso CD)` de su embarque; si un cambio lo dejaría antes, se sube a ese día y se avisa (no se rechaza), al fijarlo, al atrasar el Ingreso CD, al mover el paquete y, en 08b-2, al registrar el real. Levanta «fecha propia del paquete», que 08b §7 dejaba fuera, solo para el ingreso |
| 120 | **Línea de tiempo por compra con seis hitos**: Orden de compra (`compras.fecha_compra`), Zarpe, Arribo, Ingreso CD, **Inicio operativo** (nuevo, fecha más hora opcional en dos columnas, no `timestamptz`) e Ingreso al stock. Los cinco logísticos viven en el embarque y la compra los hereda, sin fechas propias por compra; una compra repartida tiene un tramo por embarque y paquete, y lo sin embarque es su propio tramo. Estados `real`, `sin_registrar`, `vencido`, **`por_confirmar`** (ingreso al stock pasado con la mercadería ya en el CD, hasta que 08b-2 permita confirmarlo; no es atraso), `previsto`, `pendiente` y `no_aplica`, siempre en texto además del color. Un hito confirmado nunca queda con fecha futura (I7 en todo guardado, `check` del catálogo en la base). Se ve en el detalle de la compra, como «Próximo hito» en la lista de Compras, en el embarque y en la hoja `LINEA_DE_TIEMPO` del Excel |
| 121 | **Número de OC aparte del código X y de la referencia; una OC es una compra.** Toda compra nace con su código X (`compras.numero`, inmutable). La OC real va en `compras.numero_oc` (nueva, nula, ≤ 40), **única por proveedor entre compras no canceladas** (índice único parcial `compras_proveedor_oc_uidx` sobre `proveedor_id, upper(btrim(numero_oc))`; Javier: «bloquear en el mismo proveedor, avisar en otro»): repetida en el mismo proveedor da `409 oc_repetida`, en otro proveedor solo el aviso `oc_de_otro_proveedor`. Se edita con `editar_oc_compra`, que responde `sin_cambios` a un reintento, compara el valor previo y **no sube `compras.revision`** (como `editar_ficha_linea`; matiza la 60), y deja el evento `editar_oc`. La `referencia` del importador nunca se edita. El importador de compras suma la columna `OC`, fuera de la huella; vacía no borra; repetida en el proveedor no se aplica. **Permisos asimétricos a propósito**: en pantalla los tres roles editan la OC de cualquier compra no cancelada (una a una, viéndola); por archivo, el comprador solo en compras nuevas o en su borrador (decisión 109), para no pisar OC ajenas en lote |

## 9. Plan de construcción

### 9.1 Antes de empezar

- **Lugar en el camino de compras**: 08b-1 ✔ → **08b-1b** → E1 → 08b-2 → E2 → E3. 08b-2 se construye ya sobre «ingreso real», I2 por paquete, el piso de §2.5 y la línea de tiempo (su «Recibir» pone el 🟢 en `real`). Nunca en paralelo con otra entrega de compras. **La carga C2 de COTV no depende de esta entrega** (usa el importador sin cambios), pero conviene hacerla después para que Javier reparta ya con origen, fechas y línea de tiempo.
- **Verificado por el revisor** (2026-11-05, solo lectura en `vector-two`, ref `tzjsxzmsvvhxyiooihyq`): PostgreSQL **17.11** → camino A; dependencias de `periodo_llegada`: solo su índice; `0037_estadisticas_y_work_mem` es la última migración registrada; **0** filas en viajes, embarques, paquetes, asignaciones, compras, líneas, entregas, recepciones y eventos; `agrupadores_desalineados() = 0`; `compra_eventos.accion` sin `check`. **Ya no hay plan B.**
- **Primera tarea de `datos` en T0** (solo lectura): repetir esas comprobaciones por si algo cambió desde el 2026-11-05 y poner al día el registro de PLAN §5, al que le faltan la `0035`, la `0036` y la `0037`.
- **Despliegue** (MEDIO 2): la `0038` y la aplicación nueva **en la misma ventana**: primero la migración y enseguida el despliegue. Entre medio, el modal viejo que cambiara la salida recibiría `fecha_por_movimiento` con un texto que habla de la llegada; con la base vieja y la aplicación nueva, `/fechas` fallaría. Hoy hay 0 embarques, así que el riesgo real es nulo, pero el orden se respeta.
- **COTV (08c, C0)**: las consultas de §2.7 las corre `datos` antes de armar la planilla C2; no bloquean esta entrega.

### 9.2 Tandas

Orden de agentes: `datos` → `backend` → `frontend` → `qa` → `seguridad` → `documentador`.

| Tanda | Agente | Depende de | Archivos | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Base | `datos` | — | Comprobaciones de §9.1; `supabase/migrations/0038_fechas_logisticas_embarque.sql` en el orden de §2.9 (columnas y `check` de §2.1, `set expression` después del `add column`, `compras.numero_oc` con `compras_numero_oc_idx` y `compras_proveedor_oc_uidx`, funciones de §2.9 con la regla de §2.4 bis, I7, I9 y los códigos de paquete, `editar_oc_compra` de §2.11, y el `insert` en `migraciones_aplicadas`); `scripts/humo-0038.sql`; `src/lib/supabase/database.types.ts`; PLAN §5 | Aplica dos veces y queda registrada; humo en verde (y los de la `0032`, `0034` y `0036`); F2 en local con el fixture; `agrupador_hitos_resumen` < 50 ms con 500 embarques (en local: `vector-two` tiene 0) |
| T1 · Contratos | `backend` | — (en paralelo con T0) | `src/lib/compras/agrupadores/{tipos,tipos-api,esquemas}.ts` (`por_confirmar`, `ingreso_paquete_ajustado`, `huella_plan` opcional, `CAUSAS_FECHA`, `HITOS_CONFIRMABLES`); en `src/lib/compras/{tipos,tipos-api,esquemas}.ts` los campos aditivos de `CompraApi`, `editarOcSchema`, la acción `editar_oc`, `oc_repetida` y la columna `oc` de la fila del importador; `tests/agrupadores.fixture.ts` (261101 con el Zarpe confirmado, 270401 y 270601, las tandas) y `tests/agrupadores.esquemas.test.ts` | `tsc` limpio |
| T2 · Lógica pura | `backend` | T1 | **Bloqueante 1**: `mesDeDestino` en `movimiento.ts` y su uso en `planAsignar`, `planCambiarFechas` (reemplaza `planCambiarFecha`), `planMoverPaquete`, `planPasarPendientes`, `planMoverAPaquete` (con unidades), `cerrarPlan` y `verificarAlineacion` por asignación; el ajuste al piso (§2.5); `planIngresoPaquete`; `periodoLlegada` de tres argumentos; el texto de `llegada_antes_de_compra`. `hitos.ts` nuevo (`estadoHito` con `por_confirmar`, `lineaDeTiempo`, `proximoHito`, resumen). `avisos.ts` (`:54`, `:70`). `agrupadores/importar.ts` (`:547`, `:655`, `:768` y columnas nuevas) y `plantilla.ts`. `excel.ts` (`hojaLineaDeTiempo`, OC en `ASIGNACIONES`). `src/lib/compras/importar.ts` (columna `OC`: lectura, `oc_repetida` en la base y en el archivo, `oc_distinta_en_compra`, regla del comprador, fuera de la huella). **Planilla C2 agrupada**: `scripts/cotv/planilla-c2.ts` con la función pura `agruparItemsCotv` (sin datos, fuera de `src/`; la corre `datos` en la sesión con lo que lee de COTV) y las hojas `GRUPOS` y `LEEME`. Pruebas: `tests/agrupadores.{fechas,hitos,linea-tiempo,paquete-ingreso,mes-destino,importar,excel}.test.ts`, el reparto COTV (F14–F16) en `tests/agrupadores.movimiento.test.ts`, `tests/compras.importar.test.ts` (F31, F32) y `tests/cotv.planilla-c2.test.ts` (F42) | F-R1 a F-R18 en verde; F34–F38 y F46 en TS; la prueba estática de `mesDeDestino`; M8, M12 y 08b sin tocar sus pruebas |
| T3a · Servicio y API | `backend` | T0, T2 | `agrupadores/consultas.ts` (`periodo_destino` por asignación) y `servicio.ts` (**PATCH sin `?? null`**, solo las claves presentes); rutas `embarques/[id]/fechas` y `paquetes/[id]/ingreso`; cambios en `embarques/[id]` (PATCH), `[id]/fecha` (alias de una versión), `[id]/paquete`, `[id]/estado` y `embarques/route.ts`; lectura aditiva en `src/lib/compras/consultas.ts` con **`leerTodo` por tanda** y en `GET /api/compras` y `GET /api/compras/[id]`; ruta nueva `src/app/api/compras/[id]/oc/route.ts` (`oc_repetida`); la cuarta llamada (`editar_oc_compra`) en la aplicación del importador de compras; pruebas `tests/agrupadores.{handlers,estatico}.test.ts`, `tests/compras.handlers.test.ts` (solo los campos nuevos) y `tests/api.guards.roles.test.ts` | F-R3, F-R10, F-R17, F22, F23, F25, F27–F33, F41, F43 y F44 en verde |
| T3b · Pantallas | `frontend` | T1 | `modal-embarque.tsx`, `dialogo-fechas.tsx` (reemplaza `dialogo-fecha.tsx`; ajustes al piso en la vista previa; mensaje de hito confirmado), `linea-tiempo.tsx` (nuevo, compartido por compra y embarque, con los marcadores accesibles y `por_confirmar`), `modal-paquete.tsx` y `dialogo-a-paquete.tsx`, `dialogo-programar-barrer.tsx` (nuevo; mínimo del selector = Ingreso CD), `lista-embarques.tsx`, `filtros-embarques.tsx`, `historial.tsx`, `insignias.tsx`, origen en el selector de `dialogo-asignar.tsx`; en `src/components/compras/`: encabezado con código X y OC, diálogo «Registrar / Editar OC» (bloquea la repetida del proveedor, avisa la de otro), la línea de tiempo en el detalle, la columna Compra con OC, «Próximo hito» con su filtro y el buscador por OC; reporte del importador con la OC | build y `tsc` limpios; 390 px |
| T4 · QA | `qa` | T3a, T3b | Integración a mano: F3, F10, F11, F14, F15, F21, F27, F30, F31, F33–F39. Concurrencia (a) a (g). Lista de Compras con 500 compras (≤ 300 ms más que hoy) y con más de 1 000 asignaciones. Humos de la `0032`, `0034`, `0036` y `0038`. Ensayo de la planilla C2 con datos sintéticos contra el importador real (0 `cabecera_inconsistente`; columnas informativas ignoradas) | Todo en verde; hallazgos corregidos por `backend`, `frontend` o `datos` |
| T5 · Cierre | `seguridad` (sonnet), luego `documentador` | T4 | `seguridad`: los puntos de §6 (solo lectura; corrigen `backend` y `datos`). `documentador`: 08b §11, esta ficha con su sección de construido, 08c §12 (marca vigente lo agregado por esta ficha), una nota en 08 §0.17 que apunte a §2.11, PLAN, CHANGELOG, DECISIONES 115–121 de propuestas a vigentes, checklist; `src/lib/version.ts` | Hito con Javier |

**Versión sugerida**: `0.17.0 · M8 b`.

### 9.3 Riesgos

1. **Reemplazar `aplicar_movimiento_agrupador` por tercera vez**, ahora con I2 general, piso de paquetes y unidades en `mover_a_paquete`. *Mitigación*: partir de la `0036`; el diff explícito de §2.9; volver a correr los humos de la `0032`, `0034` y `0036`; F45.
2. **Un lector que se escape de `mesDeDestino`** (el bloqueante 1 de la revisión). *Mitigación*: una sola función en TS con prueba estática; la misma forma en SQL comprobada por el humo; la I2 general en la función atrapa cualquier plan desalineado (`AG002`) en vez de dejarlo en silencio.
3. **Lotes al barrer que cambian de temporada** al programar su ingreso o al subir al piso. *Mitigación*: la vista previa lo dice siempre; sin vector de la temporada nueva, `reparto_sin_vector`; Javier aprueba el vector en M12 antes.
4. **Compras de COTV sin repartir** contando en diciembre. *Mitigación*: «Sin agrupador» las muestra con su viaje y su línea de tiempo dice «Sin embarque»; el hito de C2 comprueba que no quede nada.
5. **Agrupación de COTV equivocada** (dos OC de un proveedor en una compra). *Mitigación*: hoja `GRUPOS` con «varios días», `DIA_REGISTRO` por fila y la explicación en `LEEME`; antes de importar, partir es editar `REFERENCIA`; después, cancelar y reimportar.
6. **La lista de Compras más lenta o cortada** por el próximo hito. *Mitigación*: tandas de 150 ids leídas con `leerTodo` (§3.4); `qa` mide 500 compras (presupuesto: ≤ 300 ms más que hoy) y prueba más de 1 000 asignaciones (F41).
7. **La Orden de compra de COTV es la fecha de registro**, no la de la orden real. *Mitigación*: se toma el día de Lima (no el de UTC) y la planilla C2 la muestra para que Javier la corrija antes de importar.
8. **El texto «Llegada»** en pantallas viejas. *Mitigación*: prueba estática sobre `src/components/compras/agrupadores/**`; solo puede quedar en el sinónimo del importador.
9. **Una OC escrita mal** en varias compras por el importador. *Mitigación*: en el mismo proveedor ya no puede repetirse (índice único); el reporte la muestra por compra con sus avisos; quitarla o corregirla en pantalla deja historial.
10. **Ventana de despliegue** entre la `0038` y la aplicación. *Mitigación*: §9.1; hoy 0 embarques.

## 10. Contradicciones con lo construido o especificado

1. **Decisión 83 y 08b §2.4.** La «llegada al CD» mandaba el mes. Ahora manda el ingreso al stock, y la llegada al CD es el hito Ingreso CD (115).
2. **08c §12.2 b y §12.8 G2** dejaban `LLEGADA` vacía para que Javier la completara. Ahora va **`2026-12`** en todas las filas (117). §12.3 («habría que inventarla») queda respondida por Javier.
3. **08b §7, «Fecha propia del paquete» fuera de alcance**, y 08b §3.3: `mover_a_paquete` «no mueve meses» y va con asignaciones enteras. Ahora el paquete tiene ingreso propio (nunca antes de la llegada) y mover a paquete puede mover meses y por unidades (119). Cambian I2 y R1 de 08b, y el código de un paquete nuevo deja de leer `periodo_llegada` (`guardar_paquete` se toca, solo en eso).
4. **«Avisos, no bloqueos».** Zarpe > Ingreso CD sigue bloqueando por el check de la `0032`; se suman `puerto_en_local` y `hora_sin_fecha`.
5. **Defecto en lo construido** (§0): el `PATCH` borra la salida si no la trae. Se corrige en `servicio.ts` y en `guardar_embarque` (F22).
6. **Rutas de M8** (`GET /api/compras` y `/api/compras/[id]`) ganan campos de solo lectura (`linea_de_tiempo`, `proximo_hito`, `numero_oc`). Es la primera vez que la lectura de compras lee embarques para algo más que la etiqueta.
7. **PLAN §5** no registra la `0035`, la `0036` ni la `0037`.
8. **La decisión 94 dice «siempre `for update`»**, pero la `0036` usa `for no key update` en viajes y embarques. Esta ficha sigue la `0036`.
9. **Decisión 97.** El importador de agrupadores no completa fechas de embarques existentes; se hace en pantalla.
10. **Convención «sin backfill».** Se respeta: nada se copia. `set expression` es un cambio de esquema, no de datos, pero reescribe la tabla bajo `ACCESS EXCLUSIVE`. Se anota como la primera vez que el proyecto lo usa.
11. **Decisión 60** («toda mutación de compras con `revision`»): `editar_oc_compra` escribe la cabecera de la compra **sin** subir la revisión, con candado de fila y valor previo. Es la misma matiz que ya se aceptó para la descripción y el modelo de una línea (decisión del 2026-11-04, propuesta 88 de 08c), ahora en un campo de la cabecera.
12. **Importador de M8**: suma una columna y una cuarta llamada por compra. La clasificación (`nueva`, `igual`, `cambiada`) y la huella no cambian.
13. **Revisión 4 de esta ficha y decisión 121 tal como estaba propuesta**: la OC «no es única, repetida avisa». Javier fijó que una OC es una compra: ahora es única por proveedor (§2.11).
14. **08c §12.2 b y §12.5**: «una compra de Vector2 por cabecera de COTV» (`REFERENCIA = COTV-{purchases.id}`) pasa a «una por proveedor y viaje», y las fotos y la ficha se enlazan por el ítem (`ITEM_COTV`). **08c §12.6** decía que la carga no sumaba código: la función pura de la planilla C2 va a `scripts/cotv/` con su prueba (sin datos), porque agrupar y uniformar la fecha es lo que puede romper la carga.
15. **08c §12.1, patrón 3**, usaba `purchase_date` como fecha de compra; ahora es el día de Lima de `created_at`.

## 11. Qué cambió

### 11.0 Revisión 5, respecto de la revisión 4 (commit `31d2060`)

| Tema | Revisión 4 | Revisión 5 | Por qué |
|---|---|---|---|
| Mes de una asignación | La I2 generalizada en la función; «A no toca ningún lector» | **`mesDeDestino`**, una sola regla en TS y SQL, aplicada en los cuatro planes, `mover_a_paquete`, `cerrarPlan`, `avisos.ts`, los dos importadores, la línea de tiempo, la I2 (todas las asignaciones de los embarques del plan, toda operación), `embarque_con_recepciones` (por asignación) y `agrupadores_desalineados` (misma firma). Tabla A/B/C corregida (§2.4, §2.4 bis) | Bloqueante 1 |
| `periodo_llegada` | A si PG 17, plan B si no | **Solo A** (PG 17.11 verificado): `ACCESS EXCLUSIVE`, después del `add column`. Plan B y su riesgo, fuera | Medio 1 |
| Código de un paquete nuevo | Sin decidir (tomaría el mes del ingreso) | Mes del Ingreso CD, como el embarque; `guardar_paquete` cambia en eso | Medio 1 |
| Lo al barrer | El ingreso del paquete ganaba aun antes de la llegada; antes del Ingreso CD solo avisaba | **Nunca antes de la llegada**: piso `coalesce(real, Ingreso CD)`, se ajusta y avisa (I9); `mover_paquete` lo conserva y valida contra el destino; 08b-2 lo hereda | Javier (4); Alto 1 |
| Estados de hito | El ingreso pasado salía `vencido` | **`por_confirmar`** con `hito_confirmado` ≥ Ingreso CD; fuera de Atrasados y de «Con hitos vencidos»; el tramo sin embarque, siempre `pendiente` | Javier (5); Alto 2 |
| Hitos confirmados | I7 solo al confirmar; `check` solo en zod | I7 en **todo** guardado; `puerto_en_local` también en el `PATCH`; `check` en la base para `hito_confirmado` y `causa` | Alto 3 |
| Lista de Compras | Dos consultas por tandas de 150 | Cada tanda con **`leerTodo`**; F41 con más de 1 000 asignaciones | Alto 4 |
| Número de OC | No única: repetida avisaba | **Única por proveedor** entre compras vivas (`compras_proveedor_oc_uidx`, `409 oc_repetida`); otro proveedor avisa; el importador no aplica la repetida | Javier (3); Bloqueante 2 |
| `editar_oc_compra` | `p_antes` antes que «sin cambios» | **«Sin cambios» primero** (reintentos); captura `unique_violation` | Medio 4 |
| Permisos de la OC | Asimetría pantalla / importador sin justificar | Asimetría **deliberada y escrita** en la decisión 121 | Medio 6 |
| Carga de COTV | `COTV-{purchases.id}`: una compra por ítem; `FECHA_COMPRA = purchase_date`; «se elige una fecha al azar» | **Una compra por proveedor y viaje**, `COTV-{codigo_viaje}-{supplier_id}`, una `FECHA_COMPRA` por grupo (día de Lima del ítem más antiguo), `DIA_REGISTRO`, `ITEM_COTV`, hojas `GRUPOS` y `LEEME`; las filas con otra fecha se **omiten** (`cabecera_inconsistente`); corregir después = cancelar y reimportar | Javier (1, 2); Bloqueante 2 |
| `PATCH` | «No escribe fechas» | Distingue clave ausente de `null`; el servicio deja de mandar `?? null`; despliegue junto con la `0038` | Medio 2 |
| `/paquetes/[id]/ingreso` | — | Comprueba que el paquete sigue en el embarque tras el candado; diff de `cambiar_fecha` explícito (sin fecha de llegada, motivo solo si reprograma) | Medio 3 |
| `huella_plan` | Siempre | Solo si cambia algún mes | Medio 7 |
| Fixture | F25 se contradecía | 261101 con el Zarpe confirmado; F20 sobre 270301 | Medio 5 |
| Bajos | — | Texto de `llegada_antes_de_compra`; espacios internos de la OC como límite; alias `/fecha` por una versión; PLAN §5 en T0 | Bajos |
| Casos | F1–F33 | **F1–F46** (F34–F38 mes de destino y piso, F39 `por_confirmar`, F40 integridad, F41 1 000 filas, F42 planilla C2, F43 reintento de OC, F44 huella, F45 I2 general, F46 códigos); concurrencia (f) y (g) | — |
| Tandas | T0 contratos, T1 datos… | T0 `datos` → T1–T3a `backend` → T3b `frontend` → T4 `qa` → T5 `seguridad` y `documentador`; T2 con los planes del bloqueante 1 y la planilla C2 | — |
| Preguntas | Una (¿OC repetida?) | Ninguna | Javier respondió |

### 11.1 Revisión 4 respecto de la revisión 2 (commit `573d865`)

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

**Ninguna.** Las cuatro preguntas de la revisión independiente y la de la revisión 4 (¿una OC puede cubrir varias compras?) quedaron respondidas por Javier el 2026-11-05 (§11.0).

Se construye con estos valores por defecto, que Javier confirma en el hito (§6):

- **Orden de compra de COTV**: el día en Lima en que se registró el ítem más antiguo del grupo. *Por defecto*: se usa así y él la corrige en la planilla si la orden real es otra.
- **Inicio operativo**: «empieza el conteo y el proceso en el CD», distinto del Ingreso CD (llega) y del Ingreso al stock (disponible). *Por defecto*: tres hitos separados; el mes lo manda solo el Ingreso al stock.

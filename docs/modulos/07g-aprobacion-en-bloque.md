# 07g · Aprobación en bloque de las filas que bloquean el cierre (método en 2026, IA en 2027) y reaprobación mensual

> Estado: **especificada (2026-11-02), ajustada el 2026-11-03** con las respuestas de Javier (§9) y la revisión independiente del `arquitecto-revisor` (§10). Lista para construir salvo las preguntas que quedan en §Preguntas abiertas. Mejora de M7 sobre `0.15.0 · M7` (07e construida con la IA apagada). Petición de Javier (2026-11-02): «tendríamos que hacer un módulo para poder aprobar más de una con la sugerencia de la IA», para poder cerrar las proyecciones.
>
> - **Relaja a propósito una regla registrada.** «Nada se aprueba en bloque» (07 §2 punto 7, DECISIONES 2026-10-15) y el «una fila a la vez» de «Aceptar IA» (07e D2, decisión 70) pasan a: **las filas que bloquean el cierre se pueden aprobar en bloque, siempre por una persona que filtra, selecciona y confirma viendo el resumen por género × mundo (GM), con traza por lote, reversible y sin pisar nunca una decisión tomada a mano.** Decisión 82 de `docs/DECISIONES.md` (la 81 la reservó 08b).
> - **Versión prevista `0.15.0 · M7 c`** (la `b` es de 07f; la `0.15.1` es de sublíneas y cierre del año por IA). Las versiones se asignan al cerrar: si otra entrega cierra antes, esta toma la siguiente libre. Commits `M7:`.
> - **Migración: sí, una.** Se cita con el marcador **`00L1_lotes_proyeccion.sql`** (con `scripts/humo-00L1.sql`) y toma el **número siguiente libre al construir**. Las reservas de otras fichas (07f, 08b, 08c) se respetan; `datos` pone el número (decisión 48). Por qué hace falta: §2.0.
> - Depende de [07](07-proyeccion-anual.md) (regla 37 de cierre, B2, `decidirFila`, `cerrarProyeccion`), [07e](07e-propuesta-con-ia.md) (`asignarMeta`, `lecturaDelGM`, `aceptarIaFila`, `decision_ia_fila_id`, §5.1 y §5.3) y [06e](06e-cierre-del-anio-y-base-sin-nino.md) (método 5, factores, `reaprobar`).
> - **Cifras reales de referencia** (revisor, 2026-11-03, solo `SELECT`, única proyección en trabajo): bloquean el cierre **679 filas en 2026 y 686 en 2027**, de las cuales **290 por año son «para revisión»** (42 %); 36 GM (26 con pendientes); máximo **119 filas por GM** (mediana 9); 2 918 filas de tienda; `historico` ≈ 1,6 KB por fila (máx. 3,4 KB). **Esa proyección es de método 3** (`version_metodo = 3 < 5`), así que hoy todo lote quedaría bloqueado por `version_metodo`: las mediciones de §6.1 se rehacen después de recalcular con el método 5. La IA está apagada y sin datos (0 configuraciones, 0 propuestas): todo lo de IA se prueba con fixture.
> - Ejemplos con cifras sintéticas (las del ejemplo A de 07e). Ningún dato real de Lukers en esta ficha ni en los fixtures. Vector-One no tiene aprobación en bloque: no hay nada que citar.

## 1. Objetivo

Para cerrar una proyección hay que decidir cada fila base de 2026 y de 2027 que tenga propuesta ≥ 100 u o que esté marcada «para revisión» (regla 37; `motivoRechazoCerrar` → `409 filas_sin_decidir`). Son unas 680 por año y hoy se deciden una por una en Por línea. Este módulo añade la pestaña **«Aprobación»**, donde se aprueban en **lotes** auditables y reversibles:

- **2026** con la propuesta del **método**: avance real por línea más la estacionalidad de los meses que faltan.
- **2027** con la **IA**, que distribuye la meta de crecimiento anual del GM entre sus líneas.

El rótulo de cada fuente queda siempre visible. Javier revisa las proyecciones cada vez que se cierra un mes. Para eso, el modo **«Reaprobar»** actualiza, después de un recálculo, las filas aprobadas en bloque cuya propuesta cambió, sin tocar nada de lo decidido a mano.

### 1.1 Decisiones cerradas (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Universo = lo que bloquea el cierre.** Son las filas base activas (`tienda_id` nulo) de `Y` o `Y+1`, sin decidir, con `propuesto` no nulo y `propuesto ≥ umbral_cola_larga` o con el aviso `revision_cola_larga`. Ese predicado se extrae de `motivoRechazoCerrar` (`reglas.ts:340-349`) como **`filaBloqueaCierre(registro, umbral)`, exportada** (cambio mínimo, sin cambiar el comportamiento), y la usan el cierre y este módulo. | Así no hay dos copias del predicado. La cola larga se cierra sola. Las filas y totales de tienda tienen su propio flujo (07b, 07d). |
| D2 | **Nunca se toca lo decidido a mano.** Un lote **aprobar** solo escribe registros sin decidir (`ya_decidida` en otro caso). Un lote **reaprobar** solo escribe registros con `decision_lote_id` no nulo, es decir, aprobados en bloque y que nadie cambió después: cualquier decisión individual pone esa columna en `null` (§2.3). Un lote **revertir** solo escribe registros con `decision_lote_id` igual al del lote revertido. **Lo decidido a mano** (cifra, «Aceptar», «Aceptar IA» de una fila) **no lo toca ningún tipo de lote.** | Es la regla que pidió Javier. `decision_lote_id` es la marca de «aprobado en bloque y sin tocar». |
| D3 | **Fuentes y rótulos.** **«Método»** escribe `decidido = propuesto` con `origen = propuesta` (lo mismo que el botón «Aceptar»). **«IA»** escribe `decidido = A_f` con `origen = manual` y `decision_ia_fila_id` (lo mismo que «Aceptar IA»), solo en `Y+1`. Las dos escriben además `decision_lote_id`. En pantalla, «En bloque · Método» y «En bloque · IA»; en 2027, el método de un GM sin IA lleva su propio badge: **«Método · GM sin IA»**. | En datos, lo aprobado en bloque es lo mismo que lo aprobado fila por fila, más la traza del lote. La IA de `0.15.0` solo distribuye 2027 (en `0.15.1`, `cierre_y` abrirá «IA» en `Y` sin cambiar el contrato). |
| D4 | **Fuente de cada fila de 2027 (Javier, e).** Si el GM tiene propuesta de IA **aceptable** (`al_dia` o `meta_movida`): fuente «IA» para las filas libres con cifra IA. **Las filas libres sin cifra IA (libre nueva) quedan fuera del bloque**, con el motivo «decídela en Por línea o regenera el GM». Si el GM **no tiene IA** (IA apagada, `sin_propuesta`, `fallida`, `bloqueado_privacidad`, `sin_meta`): fuente «Método · GM sin IA», con aviso en la confirmación. Un GM `desactualizada` no tiene fuente: «regenera el GM». **Con la IA encendida no existe un modo global «Solo método» en 2027.** Las filas `fija_pct` (con % propio) de un GM con IA usan el método, porque la IA no las reparte. | Una libre sin cifra IA recibe igual una `A` (por `P^GM`, `lectura-gm.ts:117-128`). Aprobarla por el método rompería `Σ fijas + Σ A = Meta_GM`. Un «Solo método» global en un GM con IA dejaría cifras del método donde la IA reparte la meta. |
| D5 | **Exclusión dura por baja confianza (Javier, b).** Una fila de 2027 con cifra en la propuesta vigente de su GM y `confianza` `baja` **o nula** no entra en ningún lote, ni por «IA» ni por «Método» (código `confianza_baja`). El `GET` la devuelve con `fuente_sugerida = null` y la casilla deshabilitada; el servidor la rechaza aunque llegue en el cuerpo. Se decide en Por línea. Alcance: §Preguntas A1. | La IA no sabe; aprobarlas sin mirarlas sería aprobar una cifra que la propia IA no respalda. |
| D6 | **Un año por lote.** La pestaña trabaja 2026 o 2027 y propone 2026 primero. | Decidir 2026 mueve la base y la meta de 2027 (B2). |
| D7 | **La IA de un GM se aprueba entera o no se aprueba**, calculada de **una sola foto** (una `asignarMeta`). El grupo IA lleva **`registros_lectura`**: todos los registros base activos de 2026 y 2027 del GM, con su `updated_at`. La función SQL los bloquea y, si alguno cambió, rechaza el grupo entero (`cambio_concurrente`). | `A_f` depende de todas las filas del GM (fijas, `B'` que viene de 2026, la meta), no solo de las que se escriben. Bloquear solo lo escrito dejaría pasar un cambio en una fila no seleccionada y el GM ya no sumaría su meta. |
| D8 | **`valor_esperado` en cada fila**, más la **huella de la simulación** en el cuerpo: el `POST` lleva la huella del resultado simulado que el planner revisó (`huella_simulacion`), y si el servidor obtiene otro resultado responde `409 simulacion_distinta` sin escribir nada. | Nada cambia entre lo que se vio y lo que se aprueba, ni fila por fila ni en conjunto. |
| D9 | **Escritura transaccional y condicional en SQL** (`aplicar_lote_proyeccion`, §2.4). Toma un candado sobre la proyección y, por grupo, `for update` de todos los registros que lee o escribe. Una fila (con el 2027 que recalcula B2) se escribe entera o no se escribe. **El lote es parcial por diseño:** cada grupo tiene su resultado. | `decidirFila` relee y hace un `upsert` sin condición. En un lote grande eso podría pisar una decisión tomada en el mismo momento. Todo o nada castigaría las filas buenas por unas pocas que cambiaron. |
| D10 | **Idempotente.** El navegador genera `lote_id` y lo guarda en la confirmación. Un reintento devuelve lo guardado (`repetido: true`). Tras recargar la pantalla, la confirmación es nueva y usa un `lote_id` nuevo. Mismo `lote_id` con otro cuerpo → `409 lote_ajeno`. | Un reintento tras un corte de red no aprueba dos veces. |
| D11 | **Auditoría inmutable por lote.** `proyeccion_lotes` y `proyeccion_lote_filas` son de solo inserción. **La función calcula los conteos con lo que de verdad escribió** (aplicadas, rechazadas por código, filas y unidades por fuente). El efecto por GM que calcula TypeScript se guarda como **«previsto»**. El lote guarda también si el planner marcó «Revisé el resumen por GM». | Un resumen calculado antes de escribir mentiría si SQL rechaza grupos. La tabla es inmutable: lo que se escribe tiene que ser verdad. |
| D12 | **Revertir (Javier, g).** Cualquier planner puede revertirlo, mientras la proyección esté en trabajo, entero o en parte, y solo vuelve a la propuesta lo que nadie cambió después. La reversión es otro lote (`tipo = revertir`); una reversión no se revierte. Se puede revertir una confirmación completa (todas sus tandas) por `confirmacion_id`. | Es el «Volver a la propuesta» en bloque, acotado a lo que escribió el bloque. |
| D13 | **Reaprobar (Javier, d).** Tras un recálculo, la pestaña avisa «N filas aprobadas en bloque cambiaron de propuesta tras el último recálculo» y ofrece **«Reaprobar»**. Son reaprobables los registros con `decision_lote_id` no nulo cuyo valor de hoy difiere del decidido. En «Método», el valor de hoy es `propuesto` (aviso `propuesta_cambio`). En «IA», es `A_f`, calculada **tratando como libres las filas que se reaprueban** (§5.1 de 07e con la clasificación ampliada de §3.5). Pasa por la misma selección, simulación, exclusiones (D5) y confirmación que aprobar, y escribe un lote `tipo = reaprobar`. | Cada cierre de mes cambia el vendido de 2026, que entra en la `huella_historia`: todas las propuestas de IA quedan desactualizadas y las propuestas del método cambian. Sin «Reaprobar», lo aprobado en bloque quedaría congelado con cifras viejas, o habría que revertir y volver a aprobar cientos de filas. |
| D14 | **Bloqueo sin excepción (Javier, c), para todo lote aprobar o reaprobar, de cualquier año.** Bloquean: proyección cerrada, archivada o calculándose; `version_metodo` < 5; **desactualizada por cualquier motivo** (`desactualizadaDe(…).length > 0`, como `cerrarProyeccion`, `servicio.ts:1040`, sin depender de `src/lib/ia/`); los del Niño (`bloqueosNinoDeCierre`); **crecimientos de 2027 sin aprobar** (incluye Resto provisional y `reaprobar` de 06e). Se implementa llamando a `motivoRechazoCerrar` con `filasBase` y `tiendas` vacíos, `forzar = false`, `desactualizada = des.length > 0` y los crecimientos de `Y+1` siempre. Revertir solo exige que la proyección esté en trabajo y sin cálculo en curso (§Preguntas B1). | Las decisiones sobreviven al recálculo: aprobar sobre datos viejos fijaría cifras que ya no se propondrían. |
| D15 | **Un lote de 2026 puede crear un `reaprobar` de crecimientos.** `ninoDeFilas` usa la base de 2027 que B2 reescribe. La simulación lo calcula en memoria y avisa: «este lote dejará N GM con crecimientos que reaprobar: hasta reaprobarlos no se podrá aprobar 2027 ni cerrar». Después del lote aparece un enlace a Crecimientos. | Es el efecto de B2 sobre `B'` con el Niño; con D14 bloquearía los lotes de 2027 sin aviso previo. |
| D16 | **IA no disponible o corrida en curso: `409` del cuerpo entero, nada escrito** (`ia_no_disponible`, `capacidad_apagada`, `corrida_en_curso`). El navegador ofrece «Aprobar solo las de método», que reenvía sin los ítems de IA. Además, la función comprueba que la propuesta de cada grupo IA siga siendo la vigente de su GM (`ia_no_vigente`). | Una sola regla: o se escribe todo lo que pasa, o no se escribe nada por una causa de servicio. |
| D17 | **Tope de 300 filas por petición**, en tandas automáticas que **no parten un GM** (máximo actual: 119 por GM) y comparten `confirmacion_id`. | Una sola sentencia RPC (la base corta a los 8 s, también `lock_timeout = 8 s`) más la lectura previa con `historico` de las filas de 2026. |
| D18 | **El cuadre sigue sin exigirse al cerrar** (07e D19). La confirmación muestra, por GM, el total antes y después, el crecimiento implícito y el desvío frente a la meta. | Exigirlo sería una regla nueva que nadie pidió. |
| D19 | **Pestaña nueva «Aprobación»**, entre «Por línea» y «Matriz». | §4.0. |

### 1.2 Flujo

```
Pestaña Aprobación (2026 · Método | 2027 · IA)          [cabecera: «N filas aprobadas en bloque cambiaron de propuesta» → Reaprobar]
  GET …/aprobacion?anio&modo=aprobar|reaprobar ──► filas elegibles + método + IA vigente + confianza + cuadre por GM + bloqueos
        │  filtros, selección, totales en el navegador
        ▼
  POST …/aprobacion/lotes { simular: true } ──► resultado exacto sin escribir + huella_simulacion
        │  resumen por GM, 10 filas con más unidades y 10 con mayor |brecha|, casilla «Revisé el resumen por GM» si hace falta
        ▼
  POST …/aprobacion/lotes { lote_id, confirmacion_id, tipo, huella_simulacion, filas ≤ 300 } × tandas (sin partir un GM)
        │  bloqueos (D14) → foto → valor_esperado y exclusiones → aplicarDecision en memoria (B2 en 2026) → ¿misma huella?
        ▼
  aplicar_lote_proyeccion(p jsonb)  [candado de la proyección → idempotencia → grupos con for update → lote con conteos reales]
        ▼
  refrescarResumen → Matriz (cuadre) → Cerrar (regla 37 sin cambios) → M8 (sin cambios)

Revertir: POST …/aprobacion/lotes/[loteId]/revertir  ·  POST …/aprobacion/confirmaciones/[confirmacionId]/revertir
```

## 2. Modelo de datos (`00L1_lotes_proyeccion.sql`)

### 2.0 Por qué hace falta una migración

| Necesidad | Sin migración | Con migración |
|---|---|---|
| No pisar decisiones (D2) | `upsert` sin condición por fila | función con `for update` y condición por registro |
| Una fila entera o nada; el GM IA entero (D7, D9) | `decidirFila` en bucle: ≈ 10 idas a la base por fila más `refrescarResumen` (relee todas las filas) → minutos | una RPC por tanda y `refrescarResumen` una vez |
| Auditoría (D11) | no hay tabla de eventos de decisiones en M7 | `proyeccion_lotes`, `proyeccion_lote_filas` |
| Revertir y reaprobar solo lo del bloque (D12, D13) | adivinar por `decidido_at` (frágil) | `proyeccion_fila_anios.decision_lote_id` |

Convenciones de `0018`, `0025` y `0030`:
- idempotente (`create … if not exists`, `add column if not exists`, `create or replace`); sin `DROP`, `UPDATE`, `DELETE`, `TRUNCATE`, backfill, seed ni `do $$`;
- RLS sin políticas; `revoke all … from public, anon, authenticated` y `grant … to service_role`; `comment on` en cada objeto;
- funciones `security invoker`, `set search_path = ''`, sin `--` dentro de `$$`; catálogos sin `check` (zod);
- inocua para `0.15.0` desplegada.

**Tablas inmutables** (como `compra_eventos` e `ia_*`): sin `activo` ni `updated_at` (excepción documentada). Un trigger `before update or delete` por fila rechaza todo salvo poner en `NULL` una FK `on delete set null`, y otro `before truncate` por sentencia.

### 2.1 `proyeccion_lotes`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | Lo genera el navegador (D10); sin default |
| `confirmacion_id` | `uuid not null` | agrupa las tandas (D17). Índice |
| `proyeccion_id` | `uuid null → proyecciones on delete set null` | índice `(proyeccion_id, created_at desc)` |
| `tipo` | `text not null` | `aprobar` / `reaprobar` / `revertir` (zod) |
| `revierte_lote_id` | `uuid null → proyeccion_lotes on delete restrict` | solo `revertir`; índice |
| `anio` | `integer not null check (anio between 2024 and 2101)` | |
| `huella_cuerpo` | `text not null check (char_length(huella_cuerpo) = 64)` | sha-256 del cuerpo canónico (D10) |
| `calculado_at_proyeccion` | `timestamptz not null` | |
| `filtro` | `jsonb not null default '{}'` (`object`) | contexto de pantalla |
| `resumen` | `jsonb not null` (`object`) | **lo calcula la función** con lo escrito: `{ pedidas, aplicadas, rechazadas: { codigo: n }, por_fuente: { ia: { filas, unidades }, metodo: {…} } }` |
| `efecto_gm_previsto` | `jsonb not null default '[]'` (`array`) | `EfectoGMApi[]` de TypeScript (D11, «previsto») |
| `revision_confirmada` | `boolean not null default false` | casilla «Revisé el resumen por GM» (§4.4) |
| `propuestas_gm` | `uuid[] not null default '{}'` | propuestas de IA usadas |
| `nota` | `text null check (nota is null or char_length(nota) <= 300)` | |
| `perfil_id` | `uuid null → perfiles on delete set null` | índice |
| `usuario_nombre` | `text null` | |
| `created_at` | `timestamptz not null default now()` | |

### 2.2 `proyeccion_lote_filas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `lote_id` | `uuid not null → proyeccion_lotes on delete restrict` **`deferrable initially deferred`** | la cabecera se inserta al final (§2.4) |
| `fila_id` | `uuid null → proyeccion_filas on delete set null` | índice |
| `fila_clave`, `gm_clave` | `text not null` (≤ 300, ≤ 80) | |
| `anio` | `integer not null` | único `(lote_id, fila_clave, anio)` |
| `fuente` | `text not null` | `ia` / `metodo` / `revertir` (zod) |
| `resultado` | `text not null` | `aplicada` o un código de §3.4 |
| `valor`, `valor_esperado`, `valor_actual`, `decidido_anterior` | `integer null` (`≥ 0` donde aplica) | |
| `propuesta_fila_id` | `uuid null → ia_propuestas_filas on delete restrict` | |
| `created_at` | `timestamptz not null default now()` | |

### 2.3 Una columna en `proyeccion_fila_anios`

| Columna | Tipo | Para qué |
|---|---|---|
| `decision_lote_id` | `uuid null → proyeccion_lotes(id) on delete restrict` **`deferrable initially deferred`**, `check (decision_lote_id is null or decidido is not null)`, índice | No nulo = el `decidido` vigente lo escribió ese lote y nadie lo cambió a mano. **Toda decisión individual sobre el registro lo pone en `null`.** El registro de `Y+1` que se recalcula sin decidirse lo conserva (§3.6). `calcular` no lo toca. `copiar_de` no lo copia. |

La FK es diferible porque la función escribe los registros antes de insertar la cabecera del lote, que necesita los conteos reales (B1 de la revisión). El humo prueba que, si la transacción termina sin cabecera, falla en el `commit`.

### 2.4 Función `aplicar_lote_proyeccion(p jsonb) returns jsonb`

`language plpgsql`, `security invoker`, `search_path = ''`, solo `service_role`. La llama solo `src/lib/aprobacion/consultas.ts`. En una transacción:

1. **Candado de la proyección primero:** `select … from proyecciones where id = … for no key update` (no bloquea los `insert` con FK de otras tablas). Así un duplicado concurrente espera aquí al primero.
2. **Idempotencia, después del candado:** si existe `proyeccion_lotes.id = p.lote.id` (en `READ COMMITTED` ya se ve el `commit` del primero): misma proyección y misma `huella_cuerpo` → devuelve lo guardado con `repetido: true`; si no → **`LP004`** (`409 lote_ajeno`). Si aun así salta `23505` en `proyeccion_lotes_pkey`, TypeScript lo traduce releyendo el lote (`repetido`).
3. Comprobaciones de la proyección: `estado ≠ 'en_trabajo'` → **`LP001`** (`409 cerrada` / `archivada`); cálculo vivo → **`LP002`** (`409 calculo_en_curso`); `calculado_at` distinto → **`LP003`** (`409 datos_cambiaron`). En `revertir`, el lote revertido debe ser `aprobar` o `reaprobar` de la misma proyección (**`LP005`**, `409 no_revertible`).
4. **Por grupo**, en orden de `(fila_id, anio)` (el mismo orden que debe usar `guardarRegistros`, §3.6, para no interbloquearse): `select … for update` de los `registros` a escribir **y** de los `registros_lectura` (grupo IA: todos los base activos de 2026 y 2027 del GM; lote de 2026: también las filas de tienda que B2 usó). Comprobaciones:
   - `updated_at::text = updated_at_esperado` en todos (cadena con microsegundos, nunca pasada por `Date`; si no, `cambio_concurrente`);
   - en el registro objetivo: `aprobar` → `decidido is null` (`ya_decidida`); `reaprobar` → `decision_lote_id is not null and decidido = decidido_esperado` (`cambiada_despues`); `revertir` → `decision_lote_id = revierte_lote_id` (`cambiada_despues`);
   - grupo IA: su `propuesta_gm_id` es la vigente de `(proyeccion_id, gm_clave)`, con el mismo orden que `leerPropuestaVigenteDeGM` (`created_at desc, id asc`; `ia/consultas.ts:382-385`); si no, `ia_no_vigente`.
   Si algo falla, no se escribe nada del grupo: la fila que falló lleva su código y las demás del grupo, `grupo_rechazado`. Si todo pasa, se hace el `update` de cada registro con la lista fija de §2.5.
5. Inserta las `proyeccion_lote_filas` (todas, aplicadas y rechazadas). **Calcula el `resumen`** a partir de ellas e inserta la cabecera **al final**. Devuelve `{ lote_id, repetido: false, filas, resumen }`.

Un error no previsto deshace todo. Un interbloqueo (`40P01`) se traduce a `409 conflicto_reintentar` y el navegador reintenta una vez con el mismo `lote_id`.

### 2.5 Payload

```jsonc
{ "lote": { "id", "confirmacion_id", "proyeccion_id", "tipo", "revierte_lote_id"?, "anio", "huella_cuerpo", "calculado_at_esperado",
            "filtro", "efecto_gm_previsto", "revision_confirmada", "propuestas_gm", "nota"?, "perfil_id", "usuario_nombre" },
  "grupos": [ { "tipo": "ia" | "metodo" | "revertir", "gm_clave", "propuesta_gm_id"?,
      "registros_lectura": [ { "id", "updated_at_esperado" } ],
      "filas": [ { "fila_id", "fila_clave", "anio", "fuente", "valor"?, "valor_esperado"?, "valor_actual"?, "decidido_anterior"?, "decidido_esperado"?,
                   "propuesta_fila_id"?, "rechazo"?,
                   "registros": [ { "id", "updated_at_esperado", "objetivo": true | false, "set": { } } ] } ] } ] }
```

- **Lista fija de columnas de `set`:** las de `payloadAnioDecision` (`persistencia.ts:186-206`) **sin `activo`** (un lote nunca reactiva un registro), más `decision_lote_id`; nunca `id`, `fila_id` ni `anio`. Una clave ausente deja la columna como está y una clave con `null` la pone en `null`. El registro de `Y+1` que B2 reescribe no lleva `decidido`, `origen`, `nota`, `decidido_*`, `decision_ia_fila_id` ni `decision_lote_id`: conserva lo que tenga. Una prueba estática compara la lista de la función con las claves de `payloadAnioDecision` menos `activo` (R14).
- Las filas que TypeScript ya rechazó viajan con `rechazo` y sin `registros`.
- Tamaño: ≤ 300 filas × ≤ 2 registros × ≈ 2 KB, más los `registros_lectura` (solo id y fecha). Presupuesto de la RPC: ≤ 2 s (§6.1).

### 2.6 Lo que no cambia

`proyecciones`, `proyeccion_filas`, `proyeccion_tiendas`, los `check` de `origen` y de `decision_ia_fila_id`, las tablas `ia_*`, el comportamiento de `motivoRechazoCerrar` (solo se extrae `filaBloqueaCierre`), `VERSION_METODO` y `GET /api/proyeccion/cerrada`. M8 no cambia.

## 3. Contratos de API

Convenciones de M7: `{ data }` / `{ error, codigo }`; zod `strict`; ninguna mutación por `GET`; errores `401`, `403`, `400`, `404` y `409` con `codigo`. **Todas las rutas con `requirePlanner`** (el comprador recibe `403`). Código en `src/lib/aprobacion/`:
- lógica pura en `reglas.ts`, `plan.ts`, `efecto.ts`, `trocear.ts` y `huella.ts`;
- base solo en `consultas.ts`, el único archivo que nombra `aplicar_lote_proyeccion` y `proyeccion_lote*`;
- orquestación en `servicio.ts`.

Importa de `src/lib/proyeccion/`, y de `src/lib/ia/servicio.ts` solo para ítems o columnas de IA. **Los bloqueos (D14) no dependen de `src/lib/ia/`.** Ningún archivo de `src/lib/proyeccion/` importa `src/lib/aprobacion/`.

### 3.1 Rutas

| Ruta | Método | Cuerpo / consulta | Respuesta · errores |
|---|---|---|---|
| `/api/proyeccion/proyecciones/[id]/aprobacion` | GET | `?anio=<Y \| Y+1>&modo=aprobar \| reaprobar` | `AprobacionApi`. `404`; `409 anio_no_admitido` |
| `…/aprobacion/lotes` | POST | `loteSchema` | `simular` → `200 ResultadoLoteApi` (sin `lote`, con `huella_simulacion`); si no → `201`, o `200` con `repetido`. `409`: `cerrada`, `archivada`, `calculo_en_curso`, `version_metodo`, `proyeccion_desactualizada` (con los motivos), los del Niño, `crecimientos_sin_aprobar`, `anio_no_admitido`, `ia_no_disponible`, `capacidad_apagada`, `corrida_en_curso`, `datos_cambiaron`, `simulacion_distinta`, `revision_requerida`, `lote_ajeno`, `conflicto_reintentar`. Los rechazos por fila van en `filas[]` |
| `…/aprobacion/lotes` | GET | — | `{ lotes: LoteApi[] }` **de esta proyección**, del más reciente al más antiguo, con conteos derivados |
| `…/aprobacion/lotes/[loteId]` | GET | — | `LoteApi & { filas: FilaLoteApi[] }`. `404` si no es de la proyección |
| `…/aprobacion/lotes/[loteId]/revertir` | POST | `revertirSchema = { lote_id: uuid, filas?: uuid[] (1..300, sin repetidos), nota?, simular = false, huella_simulacion? }` | `ResultadoLoteApi`. `404`; `409`: `no_revertible`, `cerrada`, `archivada`, `calculo_en_curso`, `datos_cambiaron`, `simulacion_distinta`, `lote_ajeno`, `conflicto_reintentar` |
| `…/aprobacion/confirmaciones/[confirmacionId]/revertir` | POST | `{ lote_ids: uuid[] /* uno por lote a revertir, generados por el navegador */, nota?, simular = false }` | `ResultadoLoteApi[]` (un lote de reversión por cada lote de la confirmación). Mismos errores |

La simulación de una reversión de 2026 muestra el efecto en 2027 (B2), igual que la de aprobar.

### 3.2 Esquemas y tipos (`esquemas.ts`, `tipos-api.ts`, autocontenido)

```ts
export const MAX_FILAS_LOTE = 300;
export const REVISION_OBLIGATORIA_DESDE = 100;                  // filas; o algún GM fuera de ±1 % (§4.4)
const itemLote = z.strictObject({
  fila_id: uuid, fuente: z.enum(["ia", "metodo"]),
  valor_esperado: z.int().min(0).max(MAX_TOTAL),
  decidido_esperado: z.int().min(0).max(MAX_TOTAL).optional(),  // obligatorio en reaprobar (refine)
  propuesta_fila_id: uuid.optional(),                          // obligatorio con "ia", prohibido con "metodo" (refine)
});
export const loteSchema = z.strictObject({
  lote_id: uuid, confirmacion_id: uuid,
  tipo: z.enum(["aprobar", "reaprobar"]).default("aprobar"),
  anio: z.int(), simular: z.boolean().default(false),
  huella_simulacion: z.string().regex(/^[0-9a-f]{64}$/).optional(),   // obligatoria si simular = false (refine)
  revision_confirmada: z.boolean().default(false),
  filas: z.array(itemLote).min(1).max(MAX_FILAS_LOTE),           // fila_id sin repetidos (refine)
  nota: nota.optional(), filtro: filtroLoteSchema.optional(),
});

export type FuenteAprobacion = "ia" | "metodo";
export type FilaAprobacionApi = {
  fila_id: string; anio: number; gm_clave: string; genero: string; mundo: string; es_resto: boolean;
  linea: string; linea_id: string; equivalencia: string | null; agrupacion_marca: string; agrupacion_marca_id: string;
  motivo_cierre: "umbral" | "revision_cola_larga"; vendido: number; base: number | null; base_corregida: number | null;
  metodo: { valor: number; pct_propio: number | null; avisos: AvisoFila[] };
  ia: null | { propuesta_fila_id: string; valor: number | null; natural: number | null; brecha_u: number | null; brecha_pct: number | null;
    contra_metodo_u: number | null; absorbido_pct: number | null; confianza: "alta" | "media" | "baja" | null; avisos: AvisoIa[];
    razon: string | null; aceptable: boolean; motivo: string | null };
  decidido: number | null;                               // solo en modo reaprobar: lo aprobado en bloque
  fuente_sugerida: FuenteAprobacion | null; badge: "ia" | "metodo" | "metodo_gm_sin_ia" | null;
  excluida: CodigoExclusion | null; motivo_exclusion: string | null; avisos_fuertes: boolean;
};
export type CodigoExclusion = "confianza_baja" | "sin_cifra_ia" | "ia_desactualizada" | "ia_no_aceptable";
export type GMAprobacionApi = { gm_clave: string; genero: string; mundo: string; es_resto: boolean; meta: number | null;
  fuente_meta: "gm" | "resto" | "resto_provisional" | null; base_total: number | null; vigente_total: number;
  crecimiento_implicito_pct: number | null; desvio_u: number | null; desvio_pct: number | null; libres: number; pendientes: number;
  estado_ia: EstadoPropuestaGM | null; propuesta_gm_id: string | null };
export type AprobacionApi = {
  anio: number; anio_en_curso: number; modo: "aprobar" | "reaprobar"; calculado_at: string; editable: boolean;
  bloqueos: { codigo: string; mensaje: string; detalle?: Record<string, unknown> }[];
  ia: { disponible: boolean; motivo: string | null; corrida_en_curso: boolean; gms_con_propuesta: number };
  filas: FilaAprobacionApi[]; gms: GMAprobacionApi[];
  pendientes_cierre: { filas_y: number; filas_y1: number; para_revision: number; tiendas: number };
  reaprobables: { y: number; y1: number };              // aviso de la cabecera (D13)
  umbral_cola_larga: number;
};
export type CodigoRechazoFila = "ya_decidida" | "no_bloquea_cierre" | "no_reaprobable" | "sin_cambio" | "fila_inactiva" | "fila_no_encontrada"
  | "propuesta_cambio" | "ia_valor_cambio" | "ia_no_vigente" | "ia_desactualizada" | "ia_fila_ajena" | "fila_no_libre" | "ia_sin_valor"
  | "sin_cifra_ia" | "metodo_en_gm_con_ia" | "confianza_baja" | "grupo_rechazado" | "cambio_concurrente" | "cambiada_despues" | "menor_que_vendido";
export type ResultadoFilaLoteApi = { fila_id: string; anio: number; gm_clave: string; fuente: FuenteAprobacion | "revertir";
  resultado: "aplicada" | "rechazada"; codigo: CodigoRechazoFila | null; valor: number | null; valor_actual: number | null };
export type EfectoGMApi = { gm_clave: string; total_antes: number; total_despues: number; crecimiento_implicito_antes_pct: number | null;
  crecimiento_implicito_despues_pct: number | null; meta_antes: number | null; meta_despues: number | null;
  desvio_antes_u: number | null; desvio_despues_u: number | null; libres_antes: number; libres_despues: number };
export type ResultadoLoteApi = { lote: LoteApi | null; simulado: boolean; repetido: boolean; huella_simulacion: string;
  filas: ResultadoFilaLoteApi[]; totales: { pedidas: number; aplicadas: number; rechazadas: number; unidades: number;
    por_fuente: Record<FuenteAprobacion, { filas: number; unidades: number }> };
  efecto_gm: EfectoGMApi[]; mayores_unidades: ResultadoFilaLoteApi[] /* 10 */; mayores_brechas: ResultadoFilaLoteApi[] /* 10 */;
  crecimientos_a_reaprobar: { gm_clave: string; genero: string; mundo: string }[];   // D15, solo lotes de Y
  revision_requerida: boolean; pendientes_cierre: AprobacionApi["pendientes_cierre"] };
```

- `huella_simulacion` = sha-256 canónico de `{ filas[], efecto_gm }` (`huella.ts`, puro).
- `crecimiento_implicito_pct` del GM = `Σ vigente 2027 de sus filas base ÷ Σ B^s − 1` (con la `sobre_base` de su meta); en 2026, `Σ vigente 2026 ÷ Σ vendido 2025 de mismas tiendas − 1`.
- `AnioFilaApi` gana `decision_lote: { lote_id, tipo, created_at, usuario_nombre, fuente } | null`.

### 3.3 Qué hace el servidor en `POST …/lotes`

1. zod; `anio ∈ {Y, Y+1}`; ítems `ia` solo en `Y+1`.
2. **Bloqueos (D14)** → `409` con el primero (también en `reaprobar`).
3. Con ítems `ia`: `evaluarServicio` + `aceptarPermitido` + capacidad `distribucion_y1`; corrida de IA en curso no caducada → `409` del cuerpo entero (D16).
4. **Foto:**
   - los registros de los ítems con su `updated_at` en texto;
   - con `historico` solo las filas de `Y` (B2) y, sin `historico`, las de `Y+1`;
   - las filas de tienda de sus grupos GML-AM (B2);
   - catálogo, tiendas, foto de crecimientos y `contextoModelo`;
   - para los GM con ítems IA, todas sus filas base activas (`registros_lectura`) y una `lecturaDelGM`. En `reaprobar`, con las filas a reaprobar clasificadas como libres (§3.5).
   - Lecturas `.in` en tandas de 150 ids, paginadas de a 1 000.
5. **Por ítem:**
   - elegibilidad con `filaBloqueaCierre` (en aprobar) o `decision_lote_id` no nulo y valor de hoy ≠ `decidido` (en reaprobar: `no_reaprobable`, `sin_cambio`, `cambiada_despues`);
   - exclusiones duras de D4 y D5 (`confianza_baja`, `sin_cifra_ia`, `metodo_en_gm_con_ia`, `ia_desactualizada`);
   - en método: `propuesta_cambio`;
   - en IA, las comprobaciones de `aceptarIaFila` agrupadas por GM (D7);
   - `motivoRechazoDecision`.
6. **En memoria:** `aplicarDecision` por fila con un `ctx` compartido (en `Y`, B2 recalcula `Y+1`). `decidido_at` es el sello del lote y la nota es la del lote.
7. **Efecto** (`efecto.ts`): total, crecimiento implícito, `metaDeGM` y desvío por GM, antes y después; las 10 filas con más unidades y las 10 con mayor `|brecha|`. En lotes de `Y`, `ninoDeFilas` en memoria → `crecimientos_a_reaprobar` (D15). `revision_requerida` = más de 100 filas o algún GM con `|desvio_despues_pct| > 1 %`.
8. `huella_simulacion`. Si `simular`, responde aquí. Si no: huella distinta de la del cuerpo → `409 simulacion_distinta`; `revision_requerida` sin `revision_confirmada` → `409 revision_requerida`. Después, `aplicar_lote_proyeccion` y **un solo** `refrescarResumen`.

Presupuesto: ≤ 8 s por petición de 300 filas (§6.1); `MAX_FILAS_LOTE` se puede bajar si no cabe.

**Revertir:** en cada registro con `decision_lote_id = loteId` se aplica `aplicarDecision` con `decidido = null` (en `Y`, B2) y se limpian la traza IA y el lote. Los demás registros quedan `cambiada_despues` o `fila_inactiva`.

### 3.4 Códigos por fila

| Código | Cuándo |
|---|---|
| `ya_decidida` | aprobar: el registro ya tiene decisión |
| `no_bloquea_cierre` | aprobar: cola larga sin revisión, sin propuesta o fila de tienda |
| `no_reaprobable` · `sin_cambio` | reaprobar: no fue aprobada en bloque o la decidió alguien a mano después / su valor de hoy es el decidido |
| `confianza_baja` | D5, con cualquier fuente |
| `sin_cifra_ia` · `metodo_en_gm_con_ia` | D4: libre sin cifra en un GM con IA / ítem «Método» en un GM con IA aceptable (salvo `fija_pct`) |
| `propuesta_cambio` · `ia_valor_cambio` | el valor de hoy no es el `valor_esperado` (con `valor_actual`) |
| `ia_no_vigente` · `ia_desactualizada` · `ia_fila_ajena` · `fila_no_libre` · `ia_sin_valor` | los de «Aceptar IA» (07e §3.1) |
| `grupo_rechazado` | otra fila del mismo grupo IA no pasó (D7) |
| `cambio_concurrente` | un registro leído o escrito cambió entre la foto y la escritura |
| `cambiada_despues` | reaprobar o revertir: alguien la cambió después del lote |
| `fila_inactiva` · `fila_no_encontrada` · `menor_que_vendido` | como en `decidirFila` |

### 3.5 Cambio en 07e: clasificación con filas aprobadas en bloque

`estadoFilaMeta` (`src/lib/ia/meta.ts`) gana el estado **`libre_en_bloque`**. Lo tiene un registro de 2027 decidido por un lote con traza IA (`decision_lote_id` y `decision_ia_fila_id` no nulos):
- **Al generar la propuesta de la IA** y **al calcular `A`** cuenta como libre. Así, tras un cierre de mes, regenerar un GM vuelve a darle cifra y «Reaprobar» puede actualizarla (D13).
- Para «Aceptar IA» de una fila no es aceptable, porque ya está decidida.
- En la Matriz cuenta por su `decidido`, como siempre.

Con eso, la cifra IA de una fila aprobada en bloque es la que la IA le daría hoy si no estuviera decidida, y la absorción de las demás libres no cambia por haberla aprobado. Ejemplo A1′ en §5.3. Prueba R25.

### 3.6 Cambio en M7: los registros que solo se recalculan no pisan decisiones

Hoy `propagarTienda` (`servicio-edicion.ts:455-466`) y la B2 de `decidirFila` reescriben la base de `Y+1` con `guardarRegistros` → `payloadAnioDecision`, que incluye `decidido`, `origen` y las trazas, a partir de una lectura que puede ser vieja. Con lotes, eso puede perder una decisión del lote o violar el `check` de `decision_lote_id` (I8 de la revisión). Ya ocurría con `decision_ia_fila_id`, pero los lotes lo agravan. Cambio (Backend B):
- los registros que solo se recalculan (los que no son el objetivo de la decisión) se escriben con un **`update` condicional por `updated_at`** (`.eq("id", …).eq("updated_at", leído)`) y **sin columnas de decisión**. Si no toca ninguna fila, la operación responde `409 conflicto` («la proyección cambió mientras guardabas; recarga») sin escribir;
- `guardarRegistros` escribe en orden de `(fila_id, anio)`;
- toda decisión individual pone `decision_lote_id = null` en el registro decidido (`payloadAnioDecision` gana el quinto parámetro opcional `decisionLoteId?: string | null`).

Prueba R26.

## 4. Pantallas

### 4.0 Dónde vive

| Opción | Por qué no / por qué sí |
|---|---|
| Dentro de «Propuesta IA» | No: con la IA apagada solo dice el motivo, y 2026 se aprueba por el método. |
| Modo selección en «Por línea» | No: Por línea trabaja una línea a la vez; para 680 filas en 36 GM hacen falta filtros transversales y el cuadre por GM. |
| **Pestaña «Aprobación»** (entre «Por línea» y «Matriz») | Sí: es la lista de lo que falta para cerrar y la revisión mensual. Se llega desde el modal de Cerrar («Ir a Aprobación»), desde cada GM de «Propuesta IA» («Aprobar este GM») y desde Por línea («Aprobar en bloque las de esta línea»), con el filtro en la URL. |

Kit: `Tabs`, `Chips`, `ChipsMultiples`, `Checkbox`, tabla agrupada (patrón `tabla-filas.tsx`), `Badge`, `Alert`, `Modal`, `Field`, `EmptyState`. Formato `es-PE`. Las razones de la IA y las notas se pintan como texto.

### 4.1 Roles

| Rol | Ve | Acciones |
|---|---|---|
| admin, planner | todo | filtrar, seleccionar, simular, aprobar, reaprobar y revertir (cualquier lote de la proyección, D12) |
| comprador | nada (toda la API de M7 es `requirePlanner`) | — |
| proyección cerrada o archivada | lista e historial en solo lectura | — |

### 4.2 Cabecera

- «Para cerrar faltan: 2026 · 679 filas · 2027 · 686 filas (290 para revisión) · 3 tiendas nuevas → Tiendas nuevas y cierres».
- **Reaprobar:** «**N filas aprobadas en bloque cambiaron de propuesta tras el último recálculo** → Reaprobar» (abre `modo=reaprobar`).
- **Bloqueos** (D14) en un `Alert` con el motivo y el enlace (Recalcular, Factores del Niño, Crecimientos). Mientras haya un bloqueo no hay casillas.
- IA: «IA encendida · propuesta vigente en 27 de 36 GM» / «IA apagada: 2027 se aprueba con el método solo en GM sin IA» / «Hay una corrida de IA en curso».
- Año: `Tabs` «2026 · Método» y «2027 · IA» (empieza por 2026 si tiene pendientes), con el texto «Aprueba 2026 primero: cada cierre de 2026 mueve la base y la meta de 2027».

### 4.3 Filtros y selección

- Filtros (en la URL): género, mundo, línea, agrupación de marca; chips «Solo sin avisos fuertes» (por defecto) y «Para revisión» (incluidas por defecto, Javier f); confianza (alta, media); estado IA del GM; «|brecha| hasta … %». **No hay un modo «Solo método» en 2027 con la IA encendida** (D4).
- Tabla agrupada por GM (fila del GM plegable, con su casilla), con subtotal por línea:

| Columna | Qué muestra |
|---|---|
| casilla | deshabilitada con el motivo si la fila está excluida (D4, D5) |
| Línea · AM (o equivalencia) | «para revisión» si aplica |
| 2026 vendido / base 2027 | |
| Método | `propuesto` (y «% propio») |
| IA con meta | cifra vigente (2027) |
| Natural IA · Brecha · vs método · Absorbido | como 07e §4.1 |
| Confianza | baja o sin dato en rojo, con «se decide en Por línea» |
| Avisos | `brecha_extrema`, `absorcion_alta`, `base_movida`, `meta_movida`, `propuesta_cambio`, `curva_cambio` |
| En reaprobar: aprobada → hoy | «10 961 → 10 940» |
| Se aprueba con | «IA 10 961» · «Método 10 000» · «Método · GM sin IA 841» · «—» con el motivo |

- **Avisos fuertes** (fuera de la selección por defecto, se pueden incluir a propósito): `brecha_extrema`, `absorcion_alta`.
- «Seleccionar las N visibles» respeta los filtros y nunca marca filas excluidas.
- **Barra de selección:** «214 filas · IA 198 (46 120 u) · Método 16 (2 090 u) · en 6 GM» y el desvío previsto por GM. Botón «Revisar y aprobar».

### 4.4 Confirmación (salvaguardas de la revisión)

`Modal` que simula (por tandas si pasa de 300) y muestra:
- **por GM:** total antes y después, crecimiento implícito antes y después y desvío frente a la meta (en ámbar si pasa de ±1 %);
- **las 10 filas con más unidades y las 10 con mayor |brecha|** del lote;
- las filas que no se aprobarían, con su motivo;
- avisos:
  - «16 filas con método en GM sin IA»;
  - «HOMBRE · URBANO en meta movida»;
  - «2026 sin decidir en 3 de estos GM»;
  - en 2026, «este lote dejará 2 GM con crecimientos que reaprobar» (D15);
- **casilla obligatoria «Revisé el resumen por GM»** cuando el lote tiene más de 100 filas o algún GM queda fuera de ±1 %. Se guarda en el lote;
- nota opcional y «Aprobar 214 filas». El `POST` lleva la `huella_simulacion`.

Durante: «tanda 1 de 2». Después: «212 aprobadas · 2 no aprobadas (ver)», «Deshacer esta aprobación» (revierte la confirmación) y, si aplica, «Reaprobar crecimientos». Si una tanda falla por red, «Reintentar» la reenvía con el mismo `lote_id`.

### 4.5 Historial

Muestra fecha, quién, tipo, año, pedidas, aplicadas y rechazadas, IA y método, si se confirmó la revisión, nota, estado derivado (vigente, revertido en parte, revertido) y «Ver». Desde ahí se revierte el lote (entero o las filas marcadas) o la confirmación, previa simulación.

### 4.6 Otras pestañas

- Por línea y detalle: badges «En bloque · IA», «En bloque · Método» y «Método · GM sin IA», con quién, cuándo y «ver lote».
- Modal de Cerrar: «Ir a Aprobación».
- Propuesta IA: «Aprobar este GM»; las filas `libre_en_bloque` se muestran como «aprobada en bloque: X · IA hoy: A».
- La Matriz no cambia.

## 5. Reglas de negocio

### 5.1 Invariantes (vitest; la función SQL, con el humo)

| # | Regla | Dónde |
|---|---|---|
| R1 | Ningún lote escribe un registro decidido a mano (`decision_lote_id` nulo y `decidido` no nulo): `ya_decidida` en aprobar, `no_reaprobable` en reaprobar, `cambiada_despues` en revertir. | `plan.ts`, función |
| R2 | `filaBloqueaCierre` es la única definición; `motivoRechazoCerrar` da lo mismo que antes sobre todo el fixture de M7. Aprobar todas las elegibles de `Y` y de `Y+1` deja sin `filas_sin_decidir`, **salvo las excluidas** (D4, D5), que se listan. | `reglas.ts` |
| R3 | IA exacta por GM: una sola `asignarMeta`; después, `Σ fijas + Σ A = Meta_GM`; con todas las libres aprobadas, desvío 0 (A1). | `plan.ts`, `efecto.ts` |
| R4 | GM entero o nada: un `valor_esperado` distinto, o un `registros_lectura` cambiado, deja sin escribir todo el grupo; los demás GM sí se escriben (L, L′). | `plan.ts`, función |
| R5 | Método: `decidido = propuesto`, `origen = propuesta`, sin traza IA; `propuesta_cambio` si difiere. | `plan.ts` |
| R6 | 2026 con el método no mueve la meta de 2027 sin `curva_cambio` (K); con `curva_cambio`, el efecto se informa. | `efecto.ts` |
| R7 | Un año por lote; `ia` en `Y` → `409 anio_no_admitido`. | ruta |
| R8 | IA apagada: `ia = null`; en 2027, método solo con badge «GM sin IA»; un ítem `ia` → `409 ia_no_disponible` del cuerpo entero. Una lectura de IA que falla no impide un lote de método (N). Las pruebas de M7 y 07e pasan sin cambios. | servicio, rutas |
| R9 | Idempotencia: mismo `lote_id` en serie y **en paralelo** → una aplicación y `repetido` (también si salta `23505`); otro cuerpo → `lote_ajeno`. | función, servicio |
| R10 | Transacción (humo): estado, cálculo o `calculado_at` → nada escrito ni lote; grupo con `updated_at` cambiado → el grupo no se escribe; `Y` e `Y+1` de una fila juntos o ninguno; lote y filas existen si y solo si la función terminó. | SQL |
| R11 | Revertir: solo `decision_lote_id = L`; en `Y`, B2; limpia trazas; revertir un `revertir` → `no_revertible`; la reversión por confirmación revierte todas las tandas. | servicio, función |
| R12 | Toda decisión individual limpia `decision_lote_id` del registro decidido; el `Y+1` recalculado lo conserva; `calcular` lo conserva; `copiar_de` no lo copia. | `servicio-edicion.ts`, `persistencia.ts`, `servicio.ts` |
| R13 | Bloqueos (D14) para todo lote aprobar o reaprobar, de cualquier año, incluido **cualquier** motivo de `desactualizadaDe` (por ejemplo `tiendas_cambiadas`, `recalculo_pendiente`); revertir no se bloquea por ellos. Estático: `reglas.ts` y `servicio.ts` de aprobación no importan `src/lib/ia/` para los bloqueos. | `reglas.ts`, estático |
| R14 | Lista de columnas de la función = claves de `payloadAnioDecision` − `activo` + `decision_lote_id`; clave ausente no cambia la columna; el `Y+1` recalculado no lleva columnas de decisión. | estático, SQL |
| R15 | 301 ítems, `fila_id` repetido, `ia` sin `propuesta_fila_id`, `metodo` con él, reaprobar sin `decidido_esperado`, aplicar sin `huella_simulacion` → `400`. | esquemas |
| R16 | `trocear`: ninguna tanda pasa de 300, ningún GM queda partido, el orden es estable. | `trocear.ts` |
| R17 | Corrida de IA en curso → `409 corrida_en_curso` del cuerpo; propuesta reemplazada entre la foto y la escritura → `ia_no_vigente` en el grupo (con el orden de `leerPropuestaVigenteDeGM`). | servicio, función |
| R18 | Comprador `403` en todas las rutas; sin sesión, `401`. | rutas |
| R19 | **Humo de auditoría:** el `resumen` del lote coincide con las `proyeccion_lote_filas` aplicadas (también cuando SQL rechaza grupos); FK diferibles: sin cabecera, el `commit` falla; `UPDATE`, `DELETE` y `TRUNCATE` fallan también con `service_role`; poner en `NULL` una FK `set null` funciona; `anon` y `authenticated` sin acceso; la migración aplica dos veces. | SQL |
| R20 | Un solo `refrescarResumen` por lote y `decididas` al día. | servicio |
| R21 | Estático: solo `consultas.ts` nombra la función y las tablas; `src/lib/proyeccion/` no importa `src/lib/aprobacion/`; toda ruta `…/aprobacion` usa `requirePlanner`. | estático |
| R22 | Simular y aplicar dan los mismos `filas[]`, `efecto_gm` y `huella_simulacion`; una huella distinta → `409 simulacion_distinta` sin escribir; `revision_requerida` sin casilla → `409 revision_requerida`. | servicio |
| R23 | **Confianza:** `baja` o `null` → `GET` con `fuente_sugerida = null` y `excluida = confianza_baja`; el `POST` la rechaza por «IA» y por «Método» (I4). | `plan.ts`, servicio |
| R24 | **Reaprobar:** solo registros con `decision_lote_id` y valor de hoy ≠ decidido; un registro decidido a mano con propuesta cambiada **no** aparece ni se escribe; en IA, `A` se calcula con las reaprobadas como libres (A1′, M′); escribe `decision_lote_id` del lote nuevo. | `plan.ts`, servicio |
| R25 | `libre_en_bloque`: cuenta como libre al generar y al calcular `A`, no es aceptable fila por fila y en la Matriz cuenta por su `decidido`. | `ia/meta.ts` |
| R26 | M7: la B2 de `decidirFila` y `propagarTienda` escribe el `Y+1` recalculado con `update` condicional y sin columnas de decisión. Si otro proceso lo cambió → `409 conflicto` y nada escrito; una decisión de lote en ese `Y+1` sobrevive. | `servicio-edicion.ts` |
| R27 | Lote de 2026 que crea un `reaprobar` → `crecimientos_a_reaprobar` no vacío en la simulación (D15). | `efecto.ts` |

### 5.2 Ciclo mensual y casos borde

**Ciclo mensual (Javier, d).**
1. Se publica el mes y se recalcula la proyección: las decisiones sobreviven y las propuestas del método cambian.
2. Las propuestas de IA quedan desactualizadas, porque la `huella_historia` incluye el vendido de 2026: se regeneran los GM. Las filas `libre_en_bloque` vuelven a recibir cifra.
3. La cabecera de Aprobación dice «N filas aprobadas en bloque cambiaron de propuesta».
4. Reaprobar: primero 2026 (método) y después 2027 (IA). Así se revisan «el cierre de año y el año siguiente» con un par de lotes.
5. **Lo decidido a mano no se toca:** si su propuesta cambió, lo muestra Por línea con `propuesta_cambio`, como hoy.

| Caso | Comportamiento |
|---|---|
| Otra persona fija una fila del GM entre ver y aprobar | La cifra IA cambia → GM rechazado (`ia_valor_cambio`); si el cambio ocurre después de la foto del servidor, `cambio_concurrente` por `registros_lectura`. |
| Dos planners aprueban el mismo GM a la vez | El segundo espera el candado y sale con `ya_decidida` o `cambio_concurrente`. |
| Decisión individual simultánea | `for update` en el mismo orden; nunca el lote la pisa. Si la individual reescribe un `Y+1` que el lote acaba de decidir, su `update` condicional falla con `409 conflicto` (§3.6). |
| Reintento tras un corte | Mismo `lote_id` → `repetido`. |
| Falla la tanda 2 de 3 | La 1 queda; «Reintentar» la 2; «Deshacer esta aprobación» revierte las aplicadas. |
| Recálculo entre ver y aprobar | `datos_cambiaron` o `calculo_en_curso`; o `proyeccion_desactualizada` si quedó un motivo. |
| GM `meta_movida` | Aprobable, con aviso. |
| GM `desactualizada` | Sin fuente hasta regenerarlo (D4). |
| Libre sin cifra IA en un GM con IA | Excluida (`sin_cifra_ia`). |
| Fila con % propio (2027) en un GM con IA | Método. |
| `fijadas_exceden_meta` | Sin cifras IA: el GM se trata como «sin IA» (método con badge). |
| Confianza baja o sin dato | Excluida; se decide en Por línea. |
| Aprobar 2027 con 2026 pendiente en el GM | Permitido, con aviso. |
| Lote de 2026 que crea un `reaprobar` | Aviso en la simulación; después, los lotes de 2027 y el cierre quedan bloqueados hasta reaprobar en Crecimientos. |
| Reaprobar una fila que alguien decidió a mano después | No aparece (`decision_lote_id` nulo). |
| Revertir una fila desactivada por un recálculo | `fila_inactiva`. |
| Cerrar con desvío | Se puede (07e D19). |

### 5.3 Ejemplos sintéticos (`tests/aprobacion.fixture.ts`, sobre el ejemplo A de 07e)

HOMBRE · URBANO 2027, `g = 8 %` sobre corregida, umbral 100. `Meta_GM = 26 006`; fijas f4 (decidida 3 300) y f5 (cola larga 86), `Σ fijas = 3 386`; libres f1, f2, f3 con método 10 800 · 6 480 · 5 400, IA 10 961 · 6 677 · 4 982 y confianza alta · media · alta. Desvío de hoy: `+60`.

**A1 · Las tres libres con IA.** Aplicadas con `origen = manual`, traza IA y `decision_lote_id`. Desvío: `10 961 + 6 677 + 4 982 + 3 300 + 86 − 26 006 = 0`. Crecimiento implícito del GM: `26 006 ÷ 24 080 − 1 = +8,0 %` (`Σ B'` = 10 000 + 6 000 + 5 000 + 3 000 + 80).

**A1′ · `libre_en_bloque`.** Tras A1, la lectura IA trata f1, f2 y f3 como libres: `Meta_libre = 26 006 − 3 386 = 22 620` → `A` = 10 961 · 6 677 · 4 982, igual a lo aprobado: nada que reaprobar.

**A2 · Solo f1 y f2.** Desvío `+418`; f3 sigue en 4 982 con la IA.

**C · Confianza baja.** f2 con confianza `baja` (o nula): excluida; un cuerpo con f2 por «IA» o por «Método» → f2 `confianza_baja`. Al estar f2 en el mismo grupo IA, f1 y f3 quedan `grupo_rechazado`. En pantalla, f2 nunca aparece seleccionable, así que esto solo ocurre con un cuerpo armado a mano.

**K · 2026 con el método.** `propuesto` 2026 = 10 000 · 6 000 · 4 000 (sin tiendas; f3 de invierno, `φ = 0,80`). Lote → `B` y `B'` iguales, `Meta_GM = 26 006` sin cambios.

**L · Cambio entre ver y aprobar.** Tras cargar, otra persona fija f1 en 11 500 → la IA de hoy da 6 368 · 4 752. El lote {f2: 6 677, f3: 4 982, NIÑA · CASUAL (GM sin IA): método 841} → f2 y f3 `ia_valor_cambio`; NIÑA · CASUAL `aplicada` con el badge «Método · GM sin IA». El `resumen` calculado por SQL dice: aplicadas 1, `ia_valor_cambio` 2.

**L′ · Cambio en una fila no seleccionada.** Entre la foto del servidor y la RPC, alguien cambia f4 (no seleccionada) → su `updated_at` difiere en `registros_lectura` → el grupo IA entero `cambio_concurrente`.

**M · Revertir.** Tras A1, alguien cambia f3 a mano a 5 000. Revertir → f1 y f2 vuelven a sin decidir y f3 queda `cambiada_despues`. Con f3 fija en 5 000, `asignarMeta(17 620, [11 000, 6 700])` da exactos 10 950,28 · 6 669,72 → **10 950 · 6 670**.

**M′ · Reaprobar tras un cierre de mes.** Tras A1, el recálculo hace que f4 (decidida a mano, 3 300) siga igual y que la meta pase a 26 546 (B2 de otra fila del GM: `P^GM_f1` = 11 340). Se regenera el GM con los mismos pesos (11 000 · 6 700 · 5 000). Las tres filas `libre_en_bloque`: `Meta_libre = 26 546 − 3 386 = 23 160` → `A` = **11 223 · 6 836 · 5 101** (07e, ejemplo H). Reaprobar las tres → `decidido` pasa a esas cifras con el `decision_lote_id` nuevo, y el desvío vuelve a 0. f4 no se toca.

**N · IA apagada.** 2026 se aprueba con el método. En 2027, f1, f2 y f3 salen con «Método · GM sin IA» (10 800 · 6 480 · 5 400; desvío +60) y un aviso en la confirmación. Un ítem `ia` → `409 ia_no_disponible`, nada escrito.

## 6. Criterios de aceptación / hito de prueba

### 6.1 Verificación previa (`datos`, solo `SELECT` en `vector-two`; se rehace **después de recalcular con el método 5**)

1. Por año y GM: filas que bloquean el cierre, por motivo (referencia actual de método 3: 679 / 686, 290 «para revisión», máximo 119 por GM).
2. Filas de 2026 con `curva_cambio`; filas de 2027 con % propio.
3. Lectura de 300 filas de 2026 con `historico` y filas de tienda (≤ 3 s).
4. GM que un lote completo de 2026 dejaría con `reaprobar` (`ninoDeFilas` sobre la base recalculada).
5. Tras aplicar `00L1` en local: `explain analyze` de la función con 300 filas y `registros_lectura` de 119 filas × 2 años (≤ 2 s, por debajo de los 8 s de `statement_timeout` y `lock_timeout`); humo en verde (R10, R14, R19); dos aplicaciones.

### 6.2 Hito (Javier y Cowork)

1. **IA apagada:** Aprobación lista 2026 «Método» y 2027 «Método · GM sin IA». [ESCRIBE] Aprobar un GM pequeño de 2026: la confirmación muestra el resumen por GM, las 10 mayores, el efecto (meta de 2027 sin cambios o el aviso de `reaprobar`); en Por línea, el badge.
2. **[ESCRIBE] Revertir** ese lote: vuelve a sin decidir; una fila cambiada a mano antes queda «cambiada después».
3. **Bloqueos:** publicar un mes (desactualizada) bloquea los lotes de 2026 y de 2027; recalcular lo quita.
4. **[ESCRIBE] Lote grande:** más de 100 filas → casilla obligatoria «Revisé el resumen por GM»; más de 300 → tandas sin partir un GM; «Deshacer esta aprobación» revierte todas.
5. **Ciclo mensual:** tras publicar y recalcular, la cabecera dice «N filas aprobadas en bloque cambiaron de propuesta». [ESCRIBE] Reaprobar 2026: solo cambian las aprobadas en bloque, ninguna decidida a mano.
6. **(IA encendida, si 07e ganó)** [ESCRIBE] Aprobar un GM de 2027 al día: las filas de confianza baja no tienen casilla; con todas las libres aprobadas, el desvío del GM en la Matriz es 0. Con dos ventanas: fijar una fila en una y aprobar en la otra → GM no aprobado. Tras un cierre de mes, regenerar el GM y reaprobar.
7. **Cerrar:** con todo aprobado (las excluidas, decididas en Por línea) y las tiendas nuevas decididas, Cerrar ya no pide filas; M8 da las mismas cifras que si se hubieran aceptado una por una.
8. Comprador: `403`. Pasan `lint`, `tsc`, `vitest` y `build`; humo en verde; `APP_VERSION = "0.15.0 · M7 c"` (o la siguiente libre).

## 7. Fuera de alcance

- Sobrescribir en bloque decisiones tomadas a mano (D2).
- Tiendas nuevas y cierres (`tiendas_sin_decidir`): la cabecera muestra la cuenta y el enlace.
- Cifras a mano o % propio en bloque; aprobar desde la Matriz.
- La IA en 2026 (`cierre_y`, `0.15.1`).
- Exigir el cuadre al cerrar; aprobar o reaprobar sin una persona que confirme.
- Cola larga sin revisión (se cierra sola).

## 8. Plan de tandas (sin pisarse)

Cada archivo tiene un solo dueño por tanda; los traspasos ocurren entre tandas.

**Tanda 1 (en paralelo).**
- **Datos** (`datos`): `supabase/migrations/00L1_lotes_proyeccion.sql` (número siguiente libre al construir), `scripts/humo-00L1.sql`, `src/lib/supabase/database.types.ts`; mediciones de §6.1.
- **Backend · lógica pura** (`backend`): `src/lib/aprobacion/{tipos-api,esquemas,reglas,plan,efecto,trocear,huella}.ts`, `tests/aprobacion.{reglas,plan,efecto,trocear,esquemas,huella}.test.ts`, `tests/aprobacion.fixture.ts` (R1 a R7, R15, R16, R23, R24 y R27 puros; ejemplos A1 a N). Quedan congelados `tipos-api.ts` y `esquemas.ts`.

**Tanda 2 (en paralelo).**
- **Backend A · servicio y rutas:** `src/lib/aprobacion/{consultas,servicio}.ts`, `src/app/api/proyeccion/proyecciones/[id]/aprobacion/**`; en `src/lib/ia/servicio.ts` solo la función exportada nueva `valoresIaParaAprobacion(d, pi, servicio, gms, { reaprobar })`. Pruebas: `tests/aprobacion.{servicio,rutas,estatico}.test.ts`, `tests/aprobacion.fake-db.ts` (R8 a R13, R17 a R22).
- **Backend B · M7 y 07e:**
  - `src/lib/proyeccion/{reglas,persistencia,servicio-edicion,servicio-lectura,servicio,tipos-api,consultas}.ts`: `filaBloqueaCierre` exportada, `payloadAnioDecision(…, decisionLoteId?)`, §3.6, `AnioFilaApi.decision_lote`, `copiar_de`, columnas `"decision"` (sin `historico`) y `updated_at` en las ligeras;
  - `src/lib/ia/{meta,lectura-gm,tipos-api}.ts`: `libre_en_bloque` (§3.5). Se descongelan puntualmente; `servicio.ts` no, que es de Backend A.
  - Pruebas: `tests/proyeccion.{lote-decision,b2-condicional,estatico}.test.ts`, `tests/ia.meta-lote.test.ts` (R2, R12, R14, R25, R26).
  - Contrato con Backend A: `payloadAnioDecision(filaId, r, decididoPorId, decisionIaFilaId?, decisionLoteId?)` y `filaBloqueaCierre(registro, umbral)`.
- **Frontend A · pestaña:** `src/app/(app)/planificacion/proyeccion/{aprobacion-tab,aprobacion-vista,use-aprobacion,confirmar-lote-modal,historial-lotes}.tsx/ts`, `vista.ts` (solo `PESTANAS` y el filtro), `proyeccion-panel.tsx`; exporta y congela `rutaAprobacion(proyeccionId, filtro)`. Pruebas de vista y render.
- **Frontend B · enlaces y badges:** `celda-decision.tsx`, `bloque-decision.tsx`, `detalle-fila.tsx`, `cerrar-modal.tsx`, `propuesta-ia-tab.tsx`, `gm-ia-detalle.tsx`, `linea-tab.tsx`.

**Tanda 3.**
1. `qa`: lint, tsc, vitest, build, diff, recorrido con la IA apagada y con el proveedor falso de 07e, y medición de 300 filas en local.
2. `seguridad` (sonnet): guards, que ningún lote pise lo decidido a mano (SQL), idempotencia, inmutabilidad, FK diferibles, permisos y `search_path`, la lista de columnas (sin `activo`, `id`, `fila_id` ni `anio`), §3.6, XSS.
3. `documentador`: CHANGELOG, PLAN, DECISIONES (estado de la 82), esta ficha, checklist (sección siguiente libre), `version.ts`.

## 9. Respuestas de Javier (2026-11-03) y dónde quedaron

| | Respuesta | Dónde |
|---|---|---|
| a | 2026 por el método, aprobado en bloque con «Método»; 2027, la IA distribuye la meta del GM | §1, D3, D6 |
| b | Confianza baja, sin bloque, tampoco por el método; sin dato = baja | D5, R23, ejemplo C |
| c | Desactualizada (cualquier motivo) o crecimientos de 2027 sin aprobar bloquean todos los lotes | D14, R13 |
| d | Revisión mensual → «Reaprobar» | D2, D13, §3.5, §5.2, R24, R25, ejemplo M′ |
| e | Método solo en GM sin IA, con badge y aviso; libres sin cifra excluidas; sin «Solo método» global | D4, R8 |
| f | «Para revisión» en la selección por defecto si su confianza no es baja ni nula y no tienen avisos fuertes | §4.3 |
| g | Revertir: cualquier planner, en trabajo, entero o en parte, solo lo no cambiado | D12, R11 |

## 10. Revisión independiente (2026-11-03) y dónde quedó

| Hallazgo | Dónde |
|---|---|
| B1: FK a un lote inexistente; `resumen` previsto en TypeScript | §2.1 a §2.4 (FK diferibles, cabecera al final, `resumen` calculado en SQL, `efecto_gm_previsto`), R19 |
| B2: ciclo mensual | D13, §3.5, §5.2 |
| I1: `registros_lectura` | D7, §2.4, §2.5, R4, ejemplo L′ |
| I2: libres sin cifra en un GM con IA | D4 |
| I3: desactualizada por cualquier motivo | D14, R13 |
| I4: `confianza_baja` | D5, R23 |
| I5: sin «Solo método» global | D4, §4.3 |
| I6: `reaprobar` de crecimientos por un lote de 2026 | D15, R27 |
| I7: idempotencia con candado primero y `23505` | §2.4, R9 |
| I8: `propagarTienda` y B2 pisan decisiones | §3.6, R26 |
| I9: regla única del `409` | D16 |
| Menores: orden de candados, `for no key update`, sin `activo`, `updated_at` en texto, `ia_no_vigente` con el mismo orden, filas de tienda en `registros_lectura`, numeración, cifras reales, revertir por confirmación, `lote_id` nuevo tras recargar, `GET` por proyección, simulación de revertir 2026 | §2.4, §2.5, §3.1, encabezado, D10 |
| Salvaguardas: resumen por GM con crecimiento implícito, 10 + 10 filas, casilla obligatoria, huella de la simulación | D8, §4.4, R22 |
| `filaBloqueaCierre` exportada | D1, R2 |

## Preguntas abiertas para Javier

Quedan dos. Ninguna impide empezar las tandas 1 y 2; cada una tiene una recomendación que se construye si no hay otra respuesta.

1. **Alcance de «sin dato de confianza = baja».** En 2026 la IA no propone (no hay confianza) y un GM sin IA tampoco tiene confianza. Si «sin dato» contara como baja ahí, no se podría aprobar en bloque ninguna fila de 2026 ni ninguna fila de un GM sin IA, lo que contradice (a) y (e). **Recomendación:** la regla aplica solo a las filas de 2027 que tienen cifra en la propuesta vigente de su GM (allí, confianza nula = baja). En 2026 y en GM sin IA no aplica, y sus «para revisión» entran por defecto si no tienen avisos fuertes.
2. **¿Revertir también se bloquea cuando la proyección está desactualizada?** (c) dice «todos los lotes» y (g) pone para revertir solo la condición «en trabajo». **Recomendación: no bloquear la reversión.** Volver a la propuesta nunca fija cifras viejas, y permite deshacer un error justo antes o después de un recálculo.

# 07g · Aprobación en bloque de las filas que bloquean el cierre (sugerencia de la IA o propuesta del método)

> Estado: **especificada (2026-11-02), pendiente de que Javier responda §Preguntas abiertas y de una pasada del `arquitecto-revisor`.** Mejora de M7 sobre `0.15.0 · M7` (07e construida, IA apagada). Petición de Javier (2026-11-02): «tendríamos que hacer un módulo para poder aprobar más de una con la sugerencia de la IA», para poder cerrar las proyecciones.
>
> - **Relaja a propósito una regla registrada.** «Nada se aprueba en bloque» (07 §2 punto 7, DECISIONES 2026-10-15, y 07e D2 / decisión 70: «una fila a la vez») pasa a: **las filas que bloquean el cierre se pueden aprobar en bloque, siempre por una persona que selecciona y confirma viendo los totales y el efecto en la meta, con traza por lote, reversible, sin pisar nunca una decisión existente.** Entrada nueva en `docs/DECISIONES.md` (2026-11-02, decisión 82; la 81 la reservó 08b).
> - **Versión prevista `0.15.0 · M7 c`** (la `b` es de 07f; la `0.15.1` es de sublíneas y cierre por IA). Las versiones se asignan al cerrar: si otra entrega cierra antes, esta toma la siguiente libre. Commits `M7:`.
> - **Migración: sí, una.** Aplicadas `0000`–`0025`, `0027`, `0029`, `0030`; reservadas `0026` (`0.13.1 · M8`), `0028` (M9a), `0031` (07f), `0032` (08b) y las dos de 08c, que toman la siguiente libre al construir. Esta ficha la cita como **`00L1_lotes_proyeccion.sql`** (hoy sería la `0033` si 08c no la toma antes) con `scripts/humo-00L1.sql`; `datos` le pone el número al construir (decisión 48). Por qué hace falta, en §2.0.
> - Depende de [07](07-proyeccion-anual.md) (regla 37 de cierre, B2, `decidirFila`), [07e](07e-propuesta-con-ia.md) (`asignarMeta`, `lecturaDelGM`, `aceptarIaFila`, `decision_ia_fila_id`, estados de §5.3, absorción de §5.1) y [06e](06e-cierre-del-anio-y-base-sin-nino.md) (método 5, factores).
> - Cifras sintéticas (las del ejemplo A de 07e). Ningún dato real de Lukers en esta ficha ni en los fixtures. Vector-One no tiene aprobación en bloque: no hay nada que citar.

## 1. Objetivo

Para cerrar una proyección hay que decidir cada fila base de 2026 y de 2027 con propuesta ≥ 100 u o marcada «para revisión» (regla 37: `motivoRechazoCerrar` → `409 filas_sin_decidir`). Son unas 690 filas solo en 2027 y otras tantas en 2026, y hoy se deciden una por una en Por línea. Este módulo añade una pestaña **«Aprobación»** donde el planner filtra esas filas, ve por cada una la propuesta del método, la de la IA (si está encendida), la brecha, los avisos y la confianza, selecciona muchas a la vez, ve antes de confirmar cuánto suman y cómo queda el cuadre de la meta de cada género × mundo (GM), y las aprueba en un **lote** auditable y reversible.

### 1.1 Decisiones cerradas (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Universo = lo que bloquea el cierre.** Solo filas base activas (`tienda_id` nulo) de `Y` o `Y+1`, **sin decidir**, con `propuesto` no nulo y `propuesto ≥ umbral_cola_larga` o aviso `revision_cola_larga`. Exactamente el predicado de `motivoRechazoCerrar` (`reglas.ts:340-349`). | La cola larga se cierra sola con la propuesta; aprobarla no destraba nada. Las filas de tienda y los totales de tienda tienen su propio flujo (07b, 07d). |
| D2 | **Nunca pisa una decisión.** Un registro con `decidido` no nulo (a mano, «Aceptar», «Aceptar IA» o de otro lote) no se toca: resultado `ya_decidida`. Para rehacer una fila aprobada en bloque se **revierte el lote** (§3.3) y se vuelve a aprobar; para cambiar una decidida a mano, Por línea. | Es la petición explícita: «nunca pise una decisión manual salvo que se pida explícito». El pedido explícito es revertir el lote, que solo toca lo que el lote escribió. Descartado: un modo «sobrescribir decididas» (§7). |
| D3 | **Dos fuentes, con rótulo propio:** **«IA»** = la cifra «IA con meta» vigente de 07e (`A_f` de `asignarMeta` con la meta y las fijas de hoy), solo en `Y+1`, solo filas `libre` de un GM con propuesta aceptable; se guarda como «Aceptar IA» (`origen = manual` + `decision_ia_fila_id`). **«Método»** = `propuesto` de la fila; se guarda como «Aceptar» (`origen = propuesta`, sin traza IA). Ambas llevan además `decision_lote_id`. | Es la misma semántica que ya tienen los dos botones de una fila: lo que se aprueba en bloque es indistinguible en datos de lo aprobado fila por fila, salvo la traza del lote. La IA de `0.15.0` solo distribuye 2027; en 2026 solo hay método (en `0.15.1`, con `cierre_y`, la fuente «IA» se abre a `Y` sin cambiar el contrato). |
| D4 | **Fuente por defecto en 2027: «IA donde la haya; método donde el GM no tenga IA».** «No tiene IA» = IA apagada, GM `sin_propuesta`, `fallida`, `bloqueado_privacidad`, `sin_meta`, o fila libre sin cifra IA (libre nueva). **Una fila de un GM con IA no aceptable (`desactualizada`) no cae al método en silencio:** queda sin fuente con el motivo («IA desactualizada: regenera el GM o elige “Solo método”»). Selector global: «IA donde haya» · «Solo método» (· «Solo IA»). | Mezclar en silencio cifras del método en un GM que la IA está repartiendo cambiaría el cuadre sin que el planner lo vea. |
| D5 | **Un año por lote.** El cuerpo lleva `anio`; la pestaña trabaja 2026 o 2027, nunca los dos juntos, y propone 2026 primero. | Decidir 2026 mueve la base y la meta de 2027 (B2); con un año por lote, los valores de 2027 que el planner ve no cambian por algo que el mismo lote hace. Mantiene la recomendación de la decisión 75 («decide 2026 antes que 2027»). |
| D6 | **La IA se aprueba por GM entero o no se aprueba.** Los valores IA de las filas seleccionadas de un GM se calculan **juntos**, de una sola foto del estado (una llamada a `asignarMeta`), y se escriben juntos. Si una sola fila IA del GM no pasa (`valor_esperado` distinto, decidida entretanto, propuesta ya no vigente), **ninguna fila IA de ese GM** se escribe (`grupo_rechazado`); los demás GM del lote siguen. Las filas de método se resuelven fila por fila. | Aceptar una fila a su cifra vigente no cambia lo que absorben las demás (07e R7), pero solo salvo redondeo: aceptarlas en serie puede mover ±1 u a las siguientes y provocar `ia_valor_cambio` en cadena. Calculadas juntas, `Σ fijas + Σ A = Meta_GM` se cumple exacto y, si se aprueban todas las libres del GM, el desvío del GM queda en 0. Un cambio real del GM (alguien fijó una fila) cambia todas las cifras: rechazar el GM entero es lo mismo que rechazar fila por fila, pero más claro. |
| D7 | **`valor_esperado` en cada fila**, como en «Aceptar IA»: el navegador envía la cifra que el planner vio (IA o método) y el servidor la compara con la de su foto. Distinta → `ia_valor_cambio` / `propuesta_cambio` con `valor_actual`, nada escrito en esa fila (o en ese GM, D6). | Nada cambia entre ver y aprobar. |
| D8 | **Escritura transaccional y condicional en SQL** (`aplicar_lote_proyeccion`, §2.4): en una transacción, con candado sobre la proyección, comprueba estado, cálculo en curso y `calculado_at`, y por cada fila que el registro sigue sin decidir y que **ningún registro que se va a escribir cambió** desde que el servidor lo leyó (`updated_at`). Una fila (con su `Y+1` recalculado por B2) se escribe entera o no se escribe. **El lote es parcial por diseño:** cada fila o grupo IA tiene su resultado; si 3 de 200 fallan, se escriben 197 y la respuesta lista las 3 con su código. | `decidirFila` relee antes de escribir (`sigueEditable`) y hace `upsert`, que no admite condición: en un lote de cientos de filas, la ventana entre leer y escribir podría pisar una decisión hecha en ese momento por otra persona (contradice D2). Todo o nada para el lote entero castigaría 197 filas buenas por 3 que cambiaron. |
| D9 | **Idempotente:** el navegador genera `lote_id` (uuid) y lo manda; repetir la petición devuelve el resultado guardado (`repetido: true`) sin volver a aplicar. El mismo `lote_id` con otro cuerpo → `409 lote_ajeno` (huella del cuerpo). | Un reintento del navegador tras un corte de red no debe aprobar dos veces ni dejar dos lotes. |
| D10 | **Auditoría por lote, inmutable:** `proyeccion_lotes` (quién, cuándo, año, cuántas pedidas, aplicadas y rechazadas por motivo, por fuente, unidades, propuestas de IA usadas, efecto por GM, filtro, nota) y `proyeccion_lote_filas` (resultado por fila, con la cifra y la propuesta IA). Solo inserción, como `compra_eventos` e `ia_*`. Cada registro aprobado guarda `decision_lote_id`. | «Quién, cuándo, cuántas, de qué propuesta». Sin contadores: el estado de un lote (vigente, revertido en parte, revertido) se deriva de sus reversiones y de `decision_lote_id`. |
| D11 | **Deshacer = revertir un lote**, entero o algunas de sus filas: «Volver a la propuesta» sobre los registros cuyo `decision_lote_id` sigue siendo ese lote (nadie los cambió después). Las que alguien cambió quedan `cambiada_despues`. La reversión es otro lote (`tipo = revertir`), con su propia traza; una reversión no se revierte. Sin límite de tiempo mientras la proyección está en trabajo. | Es el «Volver a la propuesta» en bloque que pidió Javier, acotado a lo que el bloque escribió: nunca deshace una decisión a mano. |
| D12 | **Tope de 300 filas por petición** (`MAX_FILAS_LOTE`). Una selección mayor se envía en **tandas automáticas** de ≤ 300 (el navegador las conduce en serie, como las corridas de 07e), **sin partir nunca un GM** entre tandas; todas comparten `confirmacion_id`, y «Deshacer esta aprobación» revierte todas. | La escritura es una sola sentencia RPC (la base corta a los 8 s) y la lectura previa trae `historico` de las filas de 2026 (B2); 300 deja margen. Partir un GM rompería D6. |
| D13 | **Mismos bloqueos que cerrar, salvo las filas y tiendas sin decidir**, y sin «forzar»: proyección cerrada, archivada o calculándose; `version_metodo` < 5; `crecimientos_cambiados`; los del Niño (`bloqueosNinoDeCierre`: 2027 atípico, factor de `Y` faltante, desfasado o sin confirmar); en 2027, `crecimientos_sin_aprobar` (incluye Resto provisional y `reaprobar`); **y desactualizada** por cargas, curvas, crecimientos o temporada (los motivos de `MOTIVOS_QUE_BLOQUEAN` de 07e; `proyeccion_desactualizada`, no forzable). Se implementa llamando a `motivoRechazoCerrar` con `filasBase` y `tiendas` vacíos, `forzar = false`, `desactualizada` = «algún motivo de esa lista» y `crecimientosSinAprobar` solo si el lote es de `Y+1` (sin tocar `reglas.ts`; `ya_cerrada` se responde como `cerrada`). | Las decisiones sobreviven a un recálculo: aprobar cientos de propuestas sobre datos viejos las dejaría fijadas con cifras que el recálculo ya no propondría. Si hoy no se podría cerrar por un motivo de fondo, tampoco tiene sentido aprobar en bloque para cerrar. |
| D14 | **Con la IA apagada el módulo funciona entero para el método** y no ofrece la fuente IA: la lectura no llama a nada de `src/lib/ia/servicio*` que pueda fallar más allá de `evaluarServicio`, las columnas IA no se pintan, el selector de fuente no aparece y un ítem `fuente = ia` responde `409 ia_no_disponible` (o `capacidad_apagada`) **sin escribir nada**. Si la lectura IA falla con la IA encendida, la pestaña sigue con el método y un `Alert` (07e D15). | M7 no puede depender de un servicio externo para cerrar. |
| D15 | **Con una corrida de IA en curso** en la proyección, los ítems IA → `409 corrida_en_curso` (nada escrito); los de método siguen. Además, la función SQL comprueba que la propuesta de cada grupo IA sigue siendo la más reciente de su GM (`ia_no_vigente`). | Aprobar mientras se regeneran las propuestas aceptaría cifras que están por reemplazarse. |
| D16 | **El cuadre sigue sin exigirse al cerrar** (07e D19). La pestaña muestra, antes de confirmar, el desvío frente a la meta de cada GM antes y después del lote. | Cambiarlo sería una regla nueva de M7 que nadie pidió. |
| D17 | **Pestaña nueva «Aprobación»**, entre «Por línea» y «Matriz». | Ver §4.0. |

### 1.2 Flujo

```
Pestaña Aprobación (año 2026 o 2027)
  GET …/aprobacion?anio ──► filas que bloquean el cierre + método + IA vigente (07e, si está encendida) + cuadre por GM
        │  filtros, selección, totales y desvío por GM calculados en el navegador
        ▼
  POST …/aprobacion/lotes { simular: true }  ──► mismo cálculo que aplicar, sin escribir: efecto exacto por GM y filas que no pasarían
        │  confirmar (nota opcional)
        ▼
  POST …/aprobacion/lotes { lote_id, confirmacion_id, filas ≤ 300 } × tandas (sin partir un GM)
        │  servidor: bloqueos (D13) → foto (filas, IA por GM con asignarMeta) → valor_esperado (D7) → aplicarDecision en memoria (B2 en 2026)
        ▼
  aplicar_lote_proyeccion(p jsonb)  [una transacción: candado de la proyección, condición por registro, lote + filas del lote]
        ▼
  refrescarResumen → Matriz (cuadre) → Cerrar (regla 37 sin cambios) → M8 (sin cambios)

Deshacer: POST …/aprobacion/lotes/[loteId]/revertir ──► «Volver a la propuesta» de lo que el lote escribió y nadie cambió después
```

## 2. Modelo de datos (`00L1_lotes_proyeccion.sql`)

### 2.0 Por qué hace falta una migración

| Necesidad | Sin migración | Con migración |
|---|---|---|
| No pisar decisiones (D2) en un lote grande | `upsert` en tandas: sin condición por fila; la ventana leer → escribir puede pisar una decisión de otra persona | función con `select … for update` y condición por registro |
| Una fila entera o nada (D8) y resultado por fila | `decidirFila` en bucle: ≈ 10 idas a la base por fila más `refrescarResumen`, que relee todas las filas en cada decisión → varios minutos para 690 filas | una sola RPC por tanda, `refrescarResumen` una vez |
| Auditoría por lote (D10) | no hay tabla de eventos de decisiones en M7 | `proyeccion_lotes`, `proyeccion_lote_filas` |
| Revertir solo lo del lote (D11) | adivinar por `decidido_at` y `decidido_por_id` (frágil) | `proyeccion_fila_anios.decision_lote_id` |

Convenciones de `0018`, `0025` y `0030`: idempotente (`create table if not exists`, `add column if not exists`, `create index if not exists`, `create or replace function`, `create or replace trigger`); **sin `DROP`, `UPDATE`, `DELETE`, `TRUNCATE`, backfill, seed ni `do $$`**; RLS activo sin políticas; `revoke all … from public, anon, authenticated` y `grant … to service_role` en cada objeto; `comment on` en cada objeto; funciones `security invoker`, `set search_path = ''`, sin comentarios `--` dentro de `$$`; catálogos sin `check` (los valida zod, como en `0030`); identificadores ≤ 63. Todo es inocuo para `0.15.0` desplegada (tablas nuevas, una columna nula con `check`, una función nueva): se puede aplicar antes de desplegar.

**Tablas inmutables.** `proyeccion_lotes` y `proyeccion_lote_filas` son de solo inserción, como `compra_eventos` e `ia_*`: **sin `activo` ni `updated_at`** (excepción documentada). Trigger `before update or delete` por fila que rechaza todo salvo poner en `NULL` una FK `on delete set null` (patrón `to_jsonb(new) − col = to_jsonb(old) − col`), y trigger `before truncate` por sentencia.

### 2.1 `proyeccion_lotes`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | **Lo genera el navegador** (clave de idempotencia, D9). Sin default: lo pone siempre la API |
| `confirmacion_id` | `uuid not null` | Agrupa las tandas de una misma confirmación (D12). Índice |
| `proyeccion_id` | `uuid null → proyecciones on delete set null` | Una proyección sin decisiones se puede eliminar (regla 38); el lote queda como auditoría. Índice `(proyeccion_id, created_at desc)` |
| `tipo` | `text not null` | `aprobar` / `revertir` (zod) |
| `revierte_lote_id` | `uuid null → proyeccion_lotes on delete restrict` | Solo en `revertir`. Índice. La regla «`revertir` ⇔ no nulo» la garantiza la función |
| `anio` | `integer not null check (anio between 2024 and 2101)` | D5 |
| `huella_cuerpo` | `text not null check (char_length(huella_cuerpo) = 64)` | sha-256 del cuerpo canónico (D9) |
| `calculado_at_proyeccion` | `timestamptz not null` | La foto con que se calculó (D8) |
| `filtro` | `jsonb not null default '{}' check (jsonb_typeof(filtro) = 'object')` | Filtros y fuente elegidos en pantalla: solo contexto |
| `resumen` | `jsonb not null check (jsonb_typeof(resumen) = 'object')` | `{ pedidas, aplicadas, rechazadas: { codigo: n }, por_fuente: { ia: { filas, unidades }, metodo: {…} }, efecto_gm: EfectoGMApi[] }`. Se escribe una vez, al insertar |
| `propuestas_gm` | `uuid[] not null default '{}'` | Las `ia_propuestas_gm` usadas (vacío si solo método) |
| `nota` | `text null check (nota is null or char_length(nota) <= 300)` | |
| `perfil_id` | `uuid null → perfiles on delete set null` | Índice |
| `usuario_nombre` | `text null` | |
| `created_at` | `timestamptz not null default now()` | |

### 2.2 `proyeccion_lote_filas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `lote_id` | `uuid not null → proyeccion_lotes on delete restrict` | lo cubre el único |
| `fila_id` | `uuid null → proyeccion_filas on delete set null` | Índice |
| `fila_clave` | `text not null check (char_length(fila_clave) <= 300)` | sobrevive al `set null` |
| `gm_clave` | `text not null check (char_length(gm_clave) <= 80)` | |
| `anio` | `integer not null` | |
| — | **único** `(lote_id, fila_clave, anio)` | una fila una vez por lote |
| `fuente` | `text not null` | `ia` / `metodo` / `revertir` (zod) |
| `resultado` | `text not null` | `aplicada` o el código de rechazo de §3.4 (zod) |
| `valor` | `integer null check (valor is null or valor >= 0)` | lo escrito (`null` al revertir o si no se aplicó) |
| `valor_esperado` | `integer null check (valor_esperado is null or valor_esperado >= 0)` | lo que el planner vio |
| `valor_actual` | `integer null` | la cifra de hoy si difería |
| `decidido_anterior` | `integer null` | al revertir: lo que había |
| `propuesta_fila_id` | `uuid null → ia_propuestas_filas on delete restrict` | solo `ia` |
| `created_at` | `timestamptz not null default now()` | |

### 2.3 Una columna en `proyeccion_fila_anios`

| Columna | Tipo | Para qué |
|---|---|---|
| `decision_lote_id` | `uuid null → proyeccion_lotes(id) on delete restrict`, `check (decision_lote_id is null or decidido is not null)`, índice | No nulo = el `decidido` vigente lo escribió ese lote. **Cualquier otra decisión sobre el registro lo pone en `null`** (cifra a mano, «Aceptar», «Aceptar IA», «Volver a la propuesta», otro lote); el registro de `Y+1` que B2 reescribe al decidir `Y` **lo conserva** (misma regla que `decision_ia_fila_id`, `servicio-edicion.ts:77-82`). `calcular` no lo toca (el `upsert` del cálculo no escribe columnas de decisión). **`copiar_de` no lo copia** (el lote es de la otra proyección; se copian `decidido`, `origen` y `decision_ia_fila_id` como hoy). Va en el mismo `add column if not exists` que su `check`. |

### 2.4 Función `aplicar_lote_proyeccion(p jsonb) returns jsonb` (transaccional; patrón `registrar_propuesta_ia_gm`)

`language plpgsql`, `security invoker`, `search_path = ''`, solo `service_role`. La arma solo `src/lib/aprobacion/consultas.ts`. En una transacción:

1. **Idempotencia.** Si existe `proyeccion_lotes.id = p.lote.id`: misma `proyeccion_id` y misma `huella_cuerpo` → devuelve lo guardado con `repetido: true` (sin escribir); si no → SQLSTATE **`LP004`** (`409 lote_ajeno`). Un duplicado concurrente espera al primero por el `pk` y cae aquí.
2. **Candado de la proyección:** `select … from proyecciones where id = … for update`. `estado ≠ 'en_trabajo'` → **`LP001`** (`409 cerrada` / `archivada`, según el estado); `calculando_desde` vivo (más reciente que `now() − CALCULO_CADUCA`) → **`LP002`** (`409 calculo_en_curso`); `calculado_at ≠ p.lote.calculado_at_esperado` → **`LP003`** (`409 datos_cambiaron`). Con el candado, un `cerrar` o un `calcular` que llegue a la vez espera a que el lote termine (los dos marcan la proyección con `UPDATE` condicional) y, al seguir, ven las decisiones nuevas.
3. **Reversión:** `revierte_lote_id` debe ser un lote `aprobar` de la misma proyección; si no, **`LP005`** (`409 no_revertible`).
4. **Por grupo** (un grupo = las filas IA de un GM, o una sola fila de método o de reversión), en orden de `fila_id`: `select … from proyeccion_fila_anios where id = any(…) order by id for update` de **todos** los registros que el grupo escribe. Comprobaciones:
   - cada registro: `updated_at = updated_at_esperado` (lo que leyó el servidor), si no `cambio_concurrente`;
   - el registro objetivo: `aprobar` → `decidido is null`, si no `ya_decidida`; `revertir` → `decision_lote_id = revierte_lote_id`, si no `cambiada_despues`;
   - grupo IA: la `ia_propuestas_gm` de sus filas es la más reciente de `(proyeccion_id, gm_clave)`, si no `ia_no_vigente`.
   Si alguna falla, **no se escribe ningún registro del grupo** (la fila que falló lleva su código; las demás del grupo, `grupo_rechazado`). Si pasan, `update` de cada registro con las columnas de §2.5.
5. Inserta el lote y **todas** sus filas (aplicadas y rechazadas) y devuelve `{ lote_id, repetido: false, filas: [{ fila_id, anio, resultado }] }`.

Si algo falla fuera de lo previsto, la transacción entera se deshace: no queda lote sin filas ni filas sin lote. Un interbloqueo (`40P01`) contra una decisión individual simultánea se traduce a `409 conflicto_reintentar` y el navegador reintenta **con el mismo `lote_id`** una vez.

### 2.5 Payload de la función

```jsonc
{ "lote": { "id", "confirmacion_id", "proyeccion_id", "tipo": "aprobar" | "revertir", "revierte_lote_id"?, "anio",
            "huella_cuerpo", "calculado_at_esperado", "filtro", "resumen", "propuestas_gm": [], "nota"?, "perfil_id", "usuario_nombre" },
  "grupos": [ { "tipo": "ia" | "metodo" | "revertir", "gm_clave", "propuesta_gm_id"?,
      "filas": [ { "fila_id", "fila_clave", "anio", "valor"?, "valor_esperado"?, "valor_actual"?, "decidido_anterior"?, "propuesta_fila_id"?,
                   "rechazo"?: "<código ya decidido en TypeScript>",
                   "registros": [ { "id", "updated_at_esperado", "objetivo": true | false, "set": { /* columnas */ } } ] } ] } ] }
```

- **`set` lleva exactamente las columnas que escribe `payloadAnioDecision`** (`persistencia.ts:186-206`: las del cálculo más `crecimiento_pct`, `decidido`, `origen`, `propuesta_al_decidir`, `nota`, `decidido_at`, `decidido_por_id`, `decidido_por_nombre`, `decision_ia_fila_id`) **más `decision_lote_id`**. La función tiene esa lista fija (nunca `id`, `fila_id` ni `anio`) con la semántica del `upsert`: **clave ausente = la columna no cambia; presente con `null` = la pone en `null`**. Así el registro de `Y+1` reescrito por B2 conserva su `decidido_por_id`, su `decision_ia_fila_id` y su `decision_lote_id`. Una prueba estática compara la lista de la función con las claves de `payloadAnioDecision` (R14).
- Las filas que TypeScript ya rechazó (`rechazo`, p. ej. `ia_valor_cambio`) viajan sin `registros`: la función solo las anota en `proyeccion_lote_filas`.
- Tamaño: ≤ 300 filas × ≤ 2 registros × ≈ 2 KB ≈ 1,2 MB. Presupuesto de la RPC: ≤ 2 s (medir; §6.1).

### 2.6 Lo que no cambia

`proyecciones`, `proyeccion_filas`, `proyeccion_tiendas`, el `check` de `origen` y el de `decision_ia_fila_id`, las tablas `ia_*`, `motivoRechazoCerrar`, `VERSION_METODO` y el contrato de `GET /api/proyeccion/cerrada`. M8 no cambia.

## 3. Contratos de API

Convenciones de M7: `{ data }` / `{ error, codigo }` (`ok`, `errorConCodigo`, `leerCuerpo`, `idDeRuta`, `traducirErrorDb`); zod `strict`; ninguna mutación por `GET`; `401` sin sesión, `403` rol, `400` zod, `404`, `409` regla con `codigo`. **Todas con `requirePlanner`** (admin y planner; el comprador recibe `403`, como toda la API de M7). Código nuevo en `src/lib/aprobacion/`: lógica pura (`reglas.ts`, `plan.ts`, `efecto.ts`, `trocear.ts`), lectura y escritura solo en `consultas.ts` (el único archivo que nombra `aplicar_lote_proyeccion` y las tablas `proyeccion_lote*`), orquestación en `servicio.ts`. Importa de `src/lib/proyeccion/` (decisiones, lecturas, contexto) y, **solo para ítems o columnas IA**, de `src/lib/ia/servicio.ts`. Ningún archivo de `src/lib/proyeccion/` importa `src/lib/aprobacion/` (R24 de 07e se extiende).

### 3.1 Rutas

| Ruta | Método | Cuerpo / consulta (zod) | Respuesta · errores |
|---|---|---|---|
| `/api/proyeccion/proyecciones/[id]/aprobacion` | GET | `?anio=<Y \| Y+1>` | `AprobacionApi` (§3.2). `404`; `409 anio_no_admitido` |
| `…/[id]/aprobacion/lotes` | POST | `loteSchema` (§3.2) | `simular: true` → `200 ResultadoLoteApi` sin escribir (sin `lote`). Si no → `201 ResultadoLoteApi` (con `lote`), o `200` con `repetido: true`. `409`: `cerrada`, `archivada`, `calculo_en_curso`, `version_metodo`, `crecimientos_cambiados`, los del Niño (`anio_siguiente_atipico`, `factor_faltante`, `factor_desfasado`, `factor_sin_confirmar`…), `crecimientos_sin_aprobar` (solo `Y+1`), `proyeccion_desactualizada`, `anio_no_admitido`, `ia_no_disponible`, `capacidad_apagada`, `corrida_en_curso`, `datos_cambiaron`, `lote_ajeno`, `conflicto_reintentar`. Los rechazos por fila **no** son error HTTP: van en `filas[]` |
| `…/[id]/aprobacion/lotes` | GET | — | `{ lotes: LoteApi[] }` de la proyección, del más reciente al más antiguo, con conteos derivados |
| `…/[id]/aprobacion/lotes/[loteId]` | GET | — | `LoteApi & { filas: FilaLoteApi[] }`. `404` |
| `…/[id]/aprobacion/lotes/[loteId]/revertir` | POST | `revertirSchema = { lote_id: uuid /* idempotencia del lote de reversión */, filas?: uuid[] (1..300, sin repetidos) /* sin ella, todo el lote */, nota?: ≤ 300, simular: boolean = false }` | `ResultadoLoteApi`. `404`; `409`: `no_revertible`, `cerrada`, `archivada`, `calculo_en_curso`, `datos_cambiaron`, `lote_ajeno`, `conflicto_reintentar`. **No** bloquea por desactualizada ni por crecimientos: volver a la propuesta nunca fija cifras viejas |

### 3.2 Esquemas y tipos (`src/lib/aprobacion/esquemas.ts`, `tipos-api.ts`, autocontenido)

```ts
export const MAX_FILAS_LOTE = 300;
const itemLote = z.strictObject({
  fila_id: uuid,
  fuente: z.enum(["ia", "metodo"]),
  valor_esperado: z.int().min(0).max(MAX_TOTAL),
  propuesta_fila_id: uuid.optional(),            // obligatorio con "ia"; prohibido con "metodo" (refine)
});
export const loteSchema = z.strictObject({
  lote_id: uuid, confirmacion_id: uuid,
  anio: z.int(),
  simular: z.boolean().default(false),
  filas: z.array(itemLote).min(1).max(MAX_FILAS_LOTE),   // fila_id sin repetidos (refine)
  nota: nota.optional(),                                   // CARACTERES_PROHIBIDOS_NOTA, ≤ 300
  filtro: filtroLoteSchema.optional(),                     // solo auditoría: { genero_id?, mundo_id?, linea_id?, agrupacion_marca_id?, fuente_modo?, chips? }
});

export type FuenteAprobacion = "ia" | "metodo";
export type MotivoCierre = "umbral" | "revision_cola_larga";
export type FilaAprobacionApi = {
  fila_id: string; anio: number; gm_clave: string; genero: string; mundo: string; es_resto: boolean;
  linea: string; linea_id: string; equivalencia: string | null; agrupacion_marca: string; agrupacion_marca_id: string;
  motivo_cierre: MotivoCierre; vendido: number; base: number | null; base_corregida: number | null;   // base: solo Y+1
  metodo: { valor: number; pct_propio: number | null; avisos: AvisoFila[] };                         // propuesto
  ia: null | {                                                    // null con la IA apagada, en Y o si el GM no tiene propuesta
    propuesta_fila_id: string; valor: number | null /* meta_y1 vigente = valor_esperado */; natural: number | null;
    brecha_u: number | null; brecha_pct: number | null; contra_metodo_u: number | null; absorbido_pct: number | null;
    confianza: "alta" | "media" | "baja" | null; avisos: AvisoIa[]; razon: string | null;
    aceptable: boolean; motivo: string | null };
  fuente_sugerida: FuenteAprobacion | null; motivo_sin_fuente: string | null;                       // D4
};
export type GMAprobacionApi = { gm_clave: string; genero: string; mundo: string; es_resto: boolean;
  meta: number | null; fuente_meta: "gm" | "resto" | "resto_provisional" | null; vigente_total: number; desvio_u: number | null; desvio_pct: number | null;
  libres: number; pendientes: number; estado_ia: EstadoPropuestaGM | null; propuesta_gm_id: string | null };
export type BloqueoAprobacion = { codigo: string; mensaje: string; detalle?: Record<string, unknown> };
export type AprobacionApi = {
  anio: number; anio_en_curso: number; calculado_at: string; editable: boolean; bloqueos: BloqueoAprobacion[];
  ia: { disponible: boolean; motivo: string | null; corrida_en_curso: boolean; gms_con_propuesta: number };
  filas: FilaAprobacionApi[]; gms: GMAprobacionApi[];
  pendientes_cierre: { filas_y: number; filas_y1: number; para_revision: number; tiendas: number };
  umbral_cola_larga: number;
};
export type CodigoRechazoFila = "ya_decidida" | "no_bloquea_cierre" | "fila_inactiva" | "fila_no_encontrada" | "propuesta_cambio"
  | "ia_valor_cambio" | "ia_no_vigente" | "ia_desactualizada" | "ia_fila_ajena" | "fila_no_libre" | "ia_sin_valor"
  | "grupo_rechazado" | "cambio_concurrente" | "cambiada_despues" | "menor_que_vendido";
export type ResultadoFilaLoteApi = { fila_id: string; anio: number; gm_clave: string; fuente: FuenteAprobacion | "revertir";
  resultado: "aplicada" | "rechazada"; codigo: CodigoRechazoFila | null; valor: number | null; valor_actual: number | null };
export type EfectoGMApi = { gm_clave: string; meta_antes: number | null; meta_despues: number | null;
  desvio_antes_u: number | null; desvio_despues_u: number | null; libres_antes: number; libres_despues: number };
export type LoteApi = { id: string; confirmacion_id: string; tipo: "aprobar" | "revertir"; revierte_lote_id: string | null; anio: number;
  usuario_nombre: string | null; created_at: string; nota: string | null; resumen: ResumenLoteApi;
  vigentes: number; revertidas: number; cambiadas_despues: number };       // derivados al leer (decision_lote_id y reversiones)
export type ResultadoLoteApi = { lote: LoteApi | null; simulado: boolean; repetido: boolean; filas: ResultadoFilaLoteApi[];
  totales: { pedidas: number; aplicadas: number; rechazadas: number; unidades: number; por_fuente: Record<FuenteAprobacion, { filas: number; unidades: number }> };
  efecto_gm: EfectoGMApi[]; pendientes_cierre: AprobacionApi["pendientes_cierre"] };
```

- **M7:** `AnioFilaApi` gana `decision_lote: { lote_id, created_at, usuario_nombre, fuente: FuenteAprobacion } | null` (Por línea y detalle muestran el badge).
- **`decidirFila`** no cambia de firma: toda decisión individual pone `decision_lote_id` en `null` en el registro decidido (en `payloadAnioDecision`, que gana un quinto parámetro opcional `decisionLoteId?: string | null` con la misma semántica que `decisionIaFilaId`).

### 3.3 Qué hace el servidor en `POST …/lotes` (orden)

1. zod; `anio ∈ {Y, Y+1}`; ítems `ia` solo con `anio = Y+1` (si no, `409 anio_no_admitido`).
2. Bloqueos de la proyección (D13) → `409` con el primero.
3. Si hay ítems `ia`: `evaluarServicio` + `aceptarPermitido` (07e: un tope mensual o una clave rechazada no impiden aceptar) + capacidad `distribucion_y1` → si no, `409 ia_no_disponible` / `capacidad_apagada`; corrida en curso no caducada → `409 corrida_en_curso` (D15).
4. **Foto:** filas de los ítems con sus registros y `updated_at` (con `historico` solo las de `Y`, que necesitan B2; las de `Y+1`, sin `historico`), las filas de tienda de sus grupos GML-AM (B2), catálogo, tiendas de la proyección, foto de crecimientos y `contextoModelo`; para los GM con ítems IA, `cargarLecturaProyeccion` + `lecturaDelGM` (una sola `asignarMeta` por GM). Lecturas `.in` en tandas de 150 ids y paginadas de a 1 000.
5. **Por ítem:** elegibilidad (D1) → `no_bloquea_cierre`, `ya_decidida`, `fila_inactiva`, `fila_no_encontrada`; método: `propuesto = valor_esperado` o `propuesta_cambio`; IA: las comprobaciones de `aceptarIaFila` (`ia_fila_ajena`, `ia_no_vigente`, `ia_desactualizada`, `fila_no_libre`, `ia_sin_valor`, `ia_valor_cambio`), agrupadas por GM (D6); `motivoRechazoDecision` (`menor_que_vendido`).
6. **En memoria:** `aplicarDecision` por fila con el mismo `ctx` (método: `origen = propuesta`; IA: `origen = manual`, `decidido = A_f`; en `Y`, B2 recalcula `Y+1`), `decidido_at` = sello del lote, `decidido_por` = actor, `nota` = la del lote.
7. **Efecto por GM** (`efecto.ts`, puro): `metaDeGM` y cuadre (`Σ V − Meta_GM`, 07e §5.1) antes y después, sobre las filas en memoria.
8. `simular` → responde sin escribir. Si no → `aplicar_lote_proyeccion` → `refrescarResumen` **una vez** → respuesta.

Presupuesto: ≤ 8 s por petición de 300 filas (medido en §6.1; si no cabe, se baja `MAX_FILAS_LOTE`, que es una constante).

**Revertir** (`…/revertir`): mismas lecturas; por cada registro con `decision_lote_id = loteId` (o los de `filas`): `aplicarDecision` con `decidido = null` (en `Y`, B2), `decision_ia_fila_id = null`, `decision_lote_id = null`; los que ya no tienen ese `decision_lote_id` → `cambiada_despues` (o `fila_inactiva`). Cada fila es su propio grupo. Más de 300 filas en el lote original es imposible (D12).

### 3.4 Códigos por fila

| Código | Cuándo |
|---|---|
| `ya_decidida` | el registro tiene decisión (cualquier origen) |
| `no_bloquea_cierre` | cola larga sin revisión, sin propuesta o fila de tienda: no hace falta aprobarla |
| `fila_inactiva` / `fila_no_encontrada` | desactivada por un recálculo / no es de la proyección |
| `propuesta_cambio` | el `propuesto` de hoy no es el `valor_esperado` (método) |
| `ia_valor_cambio` | la cifra IA de hoy no es el `valor_esperado`; trae `valor_actual` |
| `ia_no_vigente` · `ia_desactualizada` · `ia_fila_ajena` · `fila_no_libre` · `ia_sin_valor` | los de «Aceptar IA» (07e §3.1) |
| `grupo_rechazado` | otra fila IA del mismo GM no pasó (D6) |
| `cambio_concurrente` | un registro cambió entre la lectura del servidor y la escritura |
| `cambiada_despues` | al revertir: alguien decidió la fila después del lote |
| `menor_que_vendido` | regla de `decidirFila` (no debería ocurrir con propuestas) |

## 4. Pantallas

### 4.0 Dónde vive: pestaña nueva «Aprobación» (entre «Por línea» y «Matriz»)

| Opción | Por qué no / por qué sí |
|---|---|
| Modo dentro de «Propuesta IA» | No: esa pestaña existe para la IA y con la IA apagada solo dice el motivo; el método en bloque también hace falta (D14) y en 2026 no hay IA. |
| Modo selección dentro de «Por línea» | No: Por línea trabaja **una línea a la vez**, con gráfico e histórico (07 §1); para 690 filas en 29 GM hacen falta filtros transversales, agrupación por GM y el cuadre de cada GM, que no caben ahí. Además, `tabla-filas.tsx` y `celda-decision.tsx` ya los tocó 07e. |
| **Pestaña «Aprobación»** | **Sí:** es la lista de lo que falta para cerrar. Orden de trabajo: crecimientos → propuesta IA → revisar por línea lo dudoso → **aprobar el resto en bloque** → cuadre en Matriz → Cerrar. Enlaces: desde el modal de Cerrar («Faltan 690 filas → Ir a Aprobación»), desde cada GM de «Propuesta IA» («Aprobar este GM») y desde Por línea («Aprobar en bloque las de esta línea»), que abren la pestaña con el filtro puesto en la URL. |

Formato `es-PE`; kit: `Tabs`, `Chips`, `ChipsMultiples`, `Checkbox`, `DataTable` (o tabla agrupada de `tabla-filas.tsx`), `Badge`, `Alert`, `Modal`, `Field`, `EmptyState`. Los textos de la IA se pintan como texto (07e R27).

### 4.1 Qué ve cada rol

| Rol | Ve | Acciones |
|---|---|---|
| admin, planner | la pestaña completa | filtrar, seleccionar, simular, aprobar, revertir |
| comprador | nada (no entra a la proyección: toda la API de M7 es `requirePlanner`) | — |
| cualquiera, proyección cerrada o archivada | la lista sin casillas y el historial, en solo lectura | — |

### 4.2 Cabecera

- **«Para cerrar faltan: 2026 · 412 filas · 2027 · 690 filas (38 para revisión) · 3 tiendas nuevas → Tiendas nuevas y cierres».**
- **Bloqueos** (D13) en un `Alert` con el motivo y el enlace (Recalcular, Factores del Niño, Crecimientos); con un bloqueo no hay casillas.
- **IA:** «IA encendida · propuesta vigente en 27 de 29 GM» / «IA apagada: se aprueba con la propuesta del método» / «Hay una corrida de IA en curso: la fuente IA vuelve cuando termine».
- **Año:** `Tabs` 2026 · 2027 (por defecto, 2026 si tiene pendientes) con el texto «Aprueba 2026 primero: cada cierre de 2026 mueve la base y la meta de 2027» mientras queden pendientes de 2026 en algún GM con filas de 2027 seleccionadas.

### 4.3 Filtros y selección

- **Filtros** (en la URL): género, mundo, línea, agrupación de marca; **fuente** («IA donde haya» · «Solo método» · «Solo IA»; solo en 2027 con la IA encendida); chips «Solo sin avisos», «Incluir para revisión (cola larga con quiebres)», confianza (alta · media · baja), estado IA del GM (al día · meta movida · desactualizada · sin propuesta) y «|brecha| hasta … %».
- **Tabla agrupada por GM** (la fila del GM es plegable y tiene su casilla), con subtotal por línea:

| Columna | Qué muestra |
|---|---|
| ☐ | casilla; deshabilitada con el motivo al pasar el cursor si la fila no tiene fuente (D4) |
| Línea · AM (o equivalencia en GMLE) | con «para revisión» si `motivo_cierre = revision_cola_larga` |
| 2026 vendido / base 2027 | en 2026: vendido a `k`; en 2027: base real / corregida |
| **Método** | `propuesto` (y «% propio» si lo tiene) |
| **IA con meta** | cifra vigente (2027, IA encendida) |
| Natural IA · Brecha · vs método · Absorbido | como en 07e §4.1, mismos colores |
| Confianza | |
| Avisos | chips: `brecha_extrema`, `absorcion_alta`, `base_movida`, `sin_propuesta_ia`, `meta_movida` (del GM), `propuesta_cambio`, `curva_cambio` |
| **Se aprueba con** | «IA 10 961» (badge azul) / «Método 10 800» (badge gris) / «—» con el motivo |
| Razón | ícono «¿por qué?» (razón IA) |

- **Fila del GM:** meta 2027 y fuente, «desvío frente a la meta hoy: +60 u (+0,2 %)», libres y pendientes, estado IA.
- **«Seleccionar las N visibles»** respeta los filtros y **no** marca filas sin fuente; con «Solo sin avisos» apagado pide confirmar cuántas llevan avisos.
- **Barra fija de selección:** «214 filas · IA 198 (46 120 u) · Método 16 (2 090 u) · en 6 GM» y, por cada GM tocado, «HOMBRE · URBANO: desvío +60 u → +418 u · quedan 1 libre» (calculado en el navegador con los datos de la lista; aproximado en 2026). Botón **«Revisar y aprobar»**.

### 4.4 Confirmación

`Modal` que llama `POST …/lotes { simular: true }` (en tandas si pasa de 300) y muestra:
- totales por fuente; **efecto exacto por GM** (meta antes y después, desvío antes y después, libres que quedan), con ámbar si el desvío del GM pasa de ±1 % (mismo umbral que la Matriz);
- **las filas que no se aprobarían** con su motivo (p. ej. «la cifra IA cambió a 6 368: otra persona fijó una fila del GM») y «Volver a cargar»;
- avisos: «12 filas con brecha extrema», «HOMBRE · URBANO está en “meta movida”», «2026 sin decidir en 3 de estos GM»;
- nota opcional (≤ 300) y **«Aprobar 214 filas»**.

Durante: «Aprobando · tanda 1 de 2». Después: «212 aprobadas · 2 no aprobadas (ver)» y **«Deshacer esta aprobación»** (revierte todas las tandas de la confirmación). Si una tanda falla por red, las anteriores quedan aprobadas, la pantalla lo dice y «Reintentar» reenvía la tanda con el mismo `lote_id`.

### 4.5 Historial de aprobaciones

Segmento «Historial» en la misma pestaña: fecha, quién, año, tipo, pedidas / aplicadas / rechazadas, IA y método (filas y u), nota, estado derivado (vigente · revertido en parte · revertido) y «Ver» (filas con resultado). En un lote `aprobar` vigente: **«Revertir»** (entero o las filas marcadas), con un `Modal` que dice cuántas siguen como las dejó el lote y cuántas cambió alguien después (esas no se tocan).

### 4.6 Cambios en otras pestañas

- **Por línea y detalle de la fila:** badge **«En bloque · IA»** o **«En bloque · Método»** junto a la decisión, con «aprobada por J. Pérez el 02/11 15:40 · ver lote». «Volver a la propuesta» de una fila sigue funcionando y quita el badge.
- **Cerrar (modal):** con `filas_sin_decidir`, enlace «Ir a Aprobación».
- **Propuesta IA:** en cada GM, «Aprobar este GM» (abre Aprobación en 2027 filtrada por el GM).
- **Matriz:** sin cambios (su «Desvío frente a la meta» es la garantía, 07e D19).

## 5. Reglas de negocio

### 5.1 Invariantes (cada una con su prueba vitest; la función SQL, con el humo)

| # | Regla | Dónde |
|---|---|---|
| R1 | **Nunca pisa:** un registro con `decidido` no nulo no se escribe en un lote `aprobar` (`ya_decidida`), cualquiera sea su origen. | `plan.ts`, función |
| R2 | **Universo:** una fila es elegible si y solo si `motivoRechazoCerrar` la contaría en `filas_sin_decidir`. Propiedad sobre el fixture: aprobar todas las elegibles de `Y` y de `Y+1` deja `motivoRechazoCerrar` sin `filas_sin_decidir`. | `reglas.ts` (aprobación) |
| R3 | **IA exacta por GM:** las cifras escritas son las `A_f` de una sola `asignarMeta` sobre la foto; tras el lote, `Σ fijas + Σ A = Meta_GM`; si el lote aprueba todas las libres del GM, el desvío de ese GM es 0 (ejemplo A1). | `plan.ts`, `efecto.ts` |
| R4 | **GM entero o nada (D6):** un `valor_esperado` distinto en una fila IA de un GM → ninguna fila IA de ese GM escrita (`ia_valor_cambio` + `grupo_rechazado`), los demás GM sí (ejemplo L). | `plan.ts`, función |
| R5 | **Método:** escribe `decidido = propuesto`, `origen = propuesta`, `decision_ia_fila_id = null`; `propuesto ≠ valor_esperado` → `propuesta_cambio` y nada escrito en esa fila. | `plan.ts` |
| R6 | **2026 con el método no mueve la meta 2027** cuando los meses de 2026 no cambian (sin `curva_cambio`): `Meta_GM` antes = después (ejemplo K). Con `curva_cambio`, el efecto se informa en `efecto_gm` (no se oculta). | `efecto.ts` |
| R7 | **Un año por lote;** ítem `ia` con `anio = Y` → `409 anio_no_admitido`. | ruta |
| R8 | **IA apagada:** `GET` devuelve `ia = null` en todas las filas y `fuente_sugerida = metodo` donde hay propuesta; un ítem `ia` → `409 ia_no_disponible` y **nada** escrito (tampoco las de método del mismo cuerpo). Con la lectura IA fallando (proveedor falso que lanza), un lote solo de método se aplica igual. Las pruebas de M7 y 07e existentes pasan sin cambios. | servicio, rutas |
| R9 | **Idempotencia:** el mismo `lote_id` dos veces (también en paralelo) → una sola aplicación, la segunda `repetido: true`; mismo `lote_id` con otro cuerpo → `409 lote_ajeno`. | función, servicio |
| R10 | **Transacción** (humo): proyección cerrada, archivada o calculándose, o `calculado_at` distinto → nada escrito, ni lote; un registro con `updated_at` cambiado → su grupo no se escribe y los demás sí; el `Y` y el `Y+1` de una fila se escriben juntos o ninguno; lote y filas del lote existen si y solo si la función terminó. | SQL |
| R11 | **Revertir:** solo registros con `decision_lote_id = L`; los demás `cambiada_despues`; en `Y` rehace `Y+1` (B2); limpia `decision_ia_fila_id`; revertir un `revertir` → `409 no_revertible`; revertir dos veces la misma fila → la segunda `cambiada_despues`. | servicio, función |
| R12 | **Cualquier otra decisión limpia `decision_lote_id`** del registro decidido (`decidirFila`, `aceptarIaFila`, «Volver a la propuesta»); el `Y+1` reescrito por B2 lo conserva; `calcular` lo conserva; `copiar_de` no lo copia. | `servicio-edicion.ts`, `persistencia.ts`, `servicio.ts` |
| R13 | **Bloqueos (D13):** cada motivo de §3.1 da su `409` y nada escrito; desactualizada no se salta (no hay `forzar`); revertir no se bloquea por desactualizada ni por crecimientos. | `reglas.ts` (aprobación) |
| R14 | **Columnas:** la lista fija de la función = claves de `payloadAnioDecision` + `decision_lote_id` (estático sobre la migración); clave ausente no cambia la columna. | estático, SQL |
| R15 | **Tope y forma:** 301 ítems o un `fila_id` repetido → `400`; `ia` sin `propuesta_fila_id` o `metodo` con él → `400`. | esquemas |
| R16 | **Tandas (`trocear.ts`):** ninguna tanda pasa de 300; ningún GM queda partido entre tandas; el orden es estable; una selección de un GM con más de 300 filas (no ocurre hoy; máx. ≈ 120) → error explícito. | `trocear.ts` |
| R17 | **Corrida en curso** → `409 corrida_en_curso` con ítems IA; los de método siguen. Propuesta del GM reemplazada entre la lectura y la escritura → `ia_no_vigente` en ese grupo. | servicio, función |
| R18 | **Permisos:** comprador `403` en las cinco rutas; sin sesión `401`. | rutas |
| R19 | **Auditoría:** el lote guarda pedidas, aplicadas, rechazadas por código, por fuente (filas y u), `propuestas_gm` y `efecto_gm`; `proyeccion_lote_filas` tiene una fila por ítem (también rechazados). `UPDATE`, `DELETE` y `TRUNCATE` sobre las dos tablas fallan también con `service_role`; poner en `NULL` una FK `set null` funciona; `anon` y `authenticated` no leen ni ejecutan. La migración aplica dos veces. | SQL |
| R20 | **Resumen:** tras un lote, `resumen.decididas` de la proyección refleja las filas nuevas (un solo `refrescarResumen`). | servicio |
| R21 | **Estático:** solo `src/lib/aprobacion/consultas.ts` nombra `aplicar_lote_proyeccion` y `proyeccion_lote*`; ningún archivo de `src/lib/proyeccion/` importa `src/lib/aprobacion/`; toda ruta bajo `…/aprobacion` usa `requirePlanner`. | estático |
| R22 | **Simular = aplicar sin escribir:** para el mismo cuerpo y el mismo estado, `simular` y aplicar dan los mismos `filas[]` y `efecto_gm`; simular no inserta nada (el falso de la base cuenta escrituras = 0). | servicio |

### 5.2 Casos borde

| Caso | Comportamiento |
|---|---|
| Otra persona fija una fila del GM entre ver y aprobar | Las cifras IA del GM cambian → GM rechazado con `ia_valor_cambio` y `valor_actual`; «Volver a cargar» y aprobar de nuevo (ejemplo L). |
| Dos planners aprueban el mismo GM a la vez | El segundo espera el candado de la proyección; al seguir, sus filas están decididas → `ya_decidida` (o `cambio_concurrente`). |
| Una decisión individual llega en el mismo milisegundo | `for update` + `updated_at`: o la individual espera al lote (y lo pisa después: es una decisión explícita, como hoy entre dos individuales) o el grupo del lote cae con `cambio_concurrente`. Nunca el lote pisa a la individual. |
| El navegador reintenta tras un corte | Mismo `lote_id` → `repetido: true`, nada se aplica dos veces. |
| Falla la tanda 2 de 3 | La 1 queda aprobada (su propio lote); «Reintentar» reenvía la 2 con su `lote_id`. «Deshacer esta aprobación» revierte las que se aplicaron. |
| Alguien recalcula entre ver y aprobar | `409 datos_cambiaron` (o `calculo_en_curso`); nada escrito. |
| Recalcular después de un lote | Las decisiones sobreviven con `decision_lote_id`; si la propuesta se movió, la fila lleva `propuesta_cambio`; el lote se puede revertir igual. |
| Regenerar la IA de un GM después de aprobarlo | Lo aprobado queda con la traza a la propuesta vieja (como «Aceptar IA»). Para usar la nueva: revertir esas filas y aprobar otra vez. |
| GM `meta_movida` | Aprobable, con el aviso en la confirmación (07e §5.3). |
| GM `desactualizada` | Sus filas no tienen fuente en «IA donde haya» (D4); con «Solo método», se aprueban con el método. |
| Fila libre sin cifra IA en un GM con IA (libre nueva) | Fuente «Método» con el motivo «sin cifra de la IA». |
| Fila con % propio sin decidir (2027) | Es `fija_pct` para la IA: solo método («Método · % propio»). |
| `fijadas_exceden_meta` en un GM | Sin cifras IA: solo método, y el desvío se ve en la confirmación. |
| Selección de parte de un GM | Permitida; el desvío del GM solo llega a 0 cuando se aprueban todas sus libres (ejemplo A2). |
| Aprobar 2027 con 2026 pendiente en el mismo GM | Permitido, con aviso: decidir 2026 después moverá la meta y el cuadre lo mostrará. |
| Fila desactivada por un recálculo antes de revertir | `fila_inactiva`, no se toca. |
| Proyección cerrada o archivada | Solo lectura; aplicar y revertir `409`. Una cerrada nunca se revierte. |
| Proyección de método < 5, factor sin confirmar, crecimientos sin aprobar | `409` con el motivo y el enlace (D13). |
| Cerrar con el desvío distinto de 0 | Se puede (07e D19); la Matriz lo muestra. |

### 5.3 Ejemplos sintéticos (fixture `tests/aprobacion.fixture.ts`, sobre el ejemplo A de 07e)

HOMBRE · URBANO 2027, `g = 8 %` sobre corregida, umbral 100. `Meta_GM = 26 006`; fijas f4 (decidida 3 300) y f5 (cola larga 86) → `Σ fijas = 3 386`; libres f1, f2, f3 con método 10 800 · 6 480 · 5 400 e IA vigente **10 961 · 6 677 · 4 982**. Desvío de hoy (todo vigente): `10 800 + 6 480 + 5 400 + 3 300 + 86 − 26 006 = +60`.

**A1 · Aprobar las tres libres con la IA.** Lote `{ f1: 10 961, f2: 6 677, f3: 4 982 }` → las tres `aplicada`, `origen = manual`, `decision_ia_fila_id` y `decision_lote_id`. Desvío después: `10 961 + 6 677 + 4 982 + 3 300 + 86 − 26 006 = 0`. `efecto_gm`: meta 26 006 → 26 006, desvío +60 → 0, libres 3 → 0.

**A2 · Aprobar solo f1 y f2.** Desvío después: `10 961 + 6 677 + 5 400 + 3 386 − 26 006 = +418` (f3 sigue con su `propuesto`). Libre que queda: `Meta_libre = 26 006 − 3 386 − 10 961 − 6 677 = 4 982` → la IA de f3 sigue en **4 982**; aprobarla después deja el desvío en 0.

**K · 2026 con el método.** Las tres libres tienen en 2026 `propuesto` 10 000 · 6 000 · 4 000 (sin tiendas que entren ni salgan; f3 de invierno con `φ = 0,80`, `B' = 5 000`). Lote 2026 «Método» → `decidido = propuesto`, `origen = propuesta`; B2 da `B` y `B'` iguales → `propuesto 2027` 10 800 · 6 480 · 5 400 y `Meta_GM = 26 006` sin cambios; las cifras IA de 2027 no cambian.

**L · Cambio entre ver y aprobar.** El planner carga la pestaña (IA 10 961 · 6 677 · 4 982) y selecciona f2 y f3, más NIÑA · CASUAL del ejemplo F (una libre, método 841, GM sin propuesta IA). Antes de confirmar, otra persona fija f1 en 11 500 a mano (ejemplo B de 07e) → la IA de hoy es 6 368 · 4 752. Resultado: f2 `ia_valor_cambio` (`valor_actual` 6 368), f3 `ia_valor_cambio` (4 752); ninguna escrita; NIÑA · CASUAL `aplicada` con 841 (`origen = propuesta`). Lote con `pedidas 3, aplicadas 1, rechazadas { ia_valor_cambio: 2 }`.

**M · Revertir.** Tras A1, alguien cambia f3 a mano a 5 000. «Revertir» el lote → f1 y f2 vuelven a sin decidir (traza y lote en `null`); f3 `cambiada_despues` y conserva 5 000. Con f3 fija en 5 000: `Meta_libre = 26 006 − 3 386 − 5 000 = 17 620`, `asignarMeta(17 620, [11 000, 6 700])` → exactos 10 950,28 · 6 669,72; pisos 17 619; la unidad que falta va al mayor resto (f2) → **10 950 · 6 670**: las nuevas cifras IA de f1 y f2.

**N · IA apagada.** La misma proyección sin IA: la columna IA no existe, f1, f2 y f3 se ofrecen con «Método» (10 800 · 6 480 · 5 400); aprobarlas deja el desvío en +60 (lo que el método da hoy, 07e ejemplo A). Un cuerpo con un ítem `ia` → `409 ia_no_disponible`, nada escrito.

## 6. Criterios de aceptación / hito de prueba

### 6.1 Verificación previa (`datos`, solo `SELECT` en `vector-two`, nunca en `lukers-compras`)

1. Por año (2026, 2027) y GM: filas que bloquean el cierre, por motivo (`umbral`, `revision_cola_larga`); máximo por GM (confirma que ningún GM pasa de 300).
2. Filas de 2026 con `curva_cambio` (R6) y con `crecimiento_pct` propio en 2027.
3. Tamaño de `historico` de 300 filas de 2026 y tiempo de leerlas con sus filas de tienda (presupuesto ≤ 3 s).
4. Después de aplicar `00L1`: `explain analyze` de la función con 300 filas sintéticas en una base local (≤ 2 s); humo en verde (R10, R14, R19); dos aplicaciones.

### 6.2 Hito (Javier y Cowork)

1. **IA apagada:** la pestaña Aprobación muestra los pendientes de cierre de 2026 y 2027 con «Método», sin columnas IA; la cabecera lo dice. [ESCRIBE] Aprobar en 2026 un GM pequeño completo: el modal muestra el efecto (meta 2027 sin cambios) y el resultado; en Por línea esas filas llevan «En bloque · Método».
2. **[ESCRIBE] Revertir** ese lote desde el Historial: las filas vuelven a «sin decidir»; una que se cambió a mano antes de revertir queda como estaba («cambiada después»).
3. **Bloqueos:** con la proyección desactualizada (publicar un mes) o con un factor sin confirmar, la pestaña bloquea con el motivo y el enlace; recalcular lo quita.
4. **(IA encendida, si 07e ganó la evaluación)** [ESCRIBE] 2027 · un GM con propuesta al día: seleccionar todas sus libres «Sin avisos» y aprobar; en la Matriz, el desvío de ese GM queda en 0 si se aprobaron todas sus libres.
5. **[ESCRIBE] Cambio entre ver y aprobar:** con la pestaña abierta en dos ventanas, fijar a mano una libre en una y aprobar el GM en la otra → el GM sale «no aprobado: la cifra IA cambió», nada escrito en él; «Volver a cargar» y aprobar.
6. **[ESCRIBE] Selección grande:** «IA donde haya» con todo 2027 visible (más de 300) → tandas («tanda 1 de 3»), sin partir un GM; «Deshacer esta aprobación» revierte todas.
7. **Cerrar:** tras aprobar 2026 y 2027 y decidir las tiendas nuevas, Cerrar ya no pide filas; la cerrada y el flujo de M8 dan las mismas cifras que si se hubieran aceptado una por una.
8. **Comprador:** `403` en `/api/proyeccion/proyecciones/<id>/aprobacion`.
9. Pasan `lint`, `tsc`, `vitest` y `build`; la `00L1` corre dos veces y el humo está en verde; `APP_VERSION = "0.15.0 · M7 c"` (o la siguiente libre).

## 7. Fuera de alcance

- **Sobrescribir decisiones existentes** en bloque (a mano, «Aceptar», «Aceptar IA»). El camino es revertir el lote o Por línea (D2).
- **Tiendas nuevas y cierres** (`tiendas_sin_decidir`): pocas por año y cada total mueve la composición de sus filas; se deciden en «Tiendas nuevas y cierres» (la cabecera lleva la cuenta y el enlace).
- Cifras a mano en bloque («+5 % a todas»), % propio en bloque, aprobar desde la Matriz.
- La IA para 2026: llega con `cierre_y` en `0.15.1`; el contrato ya admite `fuente = ia` en `Y` cuando exista la capacidad.
- Exigir el cuadre al cerrar (07e D19); aprobar sin una persona que confirme (automático, nocturno).
- La cola larga sin revisión: se cierra sola con la propuesta.

## Plan de tandas (sin pisarse)

**Regla:** cada archivo, un solo dueño por tanda; los traspasos solo entre tandas. Antes de la tanda 1, pasada corta del **`arquitecto-revisor` (opus)** sobre esta ficha y respuestas de Javier a §Preguntas.

### Tanda 1 (dos en paralelo)

**Datos** (`datos`): `supabase/migrations/00L1_lotes_proyeccion.sql` (número al construir), `scripts/humo-00L1.sql`, `src/lib/supabase/database.types.ts` (regenerado). Mediciones de §6.1 (solo `SELECT`); aplicar en `vector-two` después del humo local.

**Backend · lógica pura** (`backend`): `src/lib/aprobacion/{tipos-api,esquemas,reglas,plan,efecto,trocear}.ts` y `tests/aprobacion.{reglas,plan,efecto,trocear,esquemas}.test.ts`, `tests/aprobacion.fixture.ts` (R1 a R7 puros, R15, R16, ejemplos A1, A2, K, L, M, N). Al cerrar la tanda quedan congelados `tipos-api.ts` y `esquemas.ts`.

### Tanda 2 (cuatro en paralelo)

**Backend A · servicio y rutas** (`backend`): `src/lib/aprobacion/{consultas,servicio}.ts`; `src/app/api/proyeccion/proyecciones/[id]/aprobacion/**`; en `src/lib/ia/servicio.ts`, **solo** una función exportada nueva `valoresIaParaAprobacion(d, pi, servicio, gms)` (envuelve `cargarLecturaProyeccion` + `lecturaDelGM`; dueño único de ese archivo en esta tanda). Lee M7 solo por funciones exportadas (`proyeccionOr404`, `cargarCatalogo`, `leerTiendasProyeccion`, `cargarMatriz`, `contextoModelo`, `aFilaModelo`, `aplicarDecision`, `motivoRechazoDecision`, `motivoRechazoCerrar`, `payloadAnioDecision`, `refrescarResumen`, `leerFilasConAnios`). Pruebas: `tests/aprobacion.{servicio,rutas,estatico}.test.ts`, `tests/aprobacion.fake-db.ts` (R8 a R13, R17 a R22).

**Backend B · integración en M7** (`backend`): `src/lib/proyeccion/{persistencia,servicio-edicion,servicio-lectura,servicio,tipos-api,consultas}.ts`: `payloadAnioDecision(…, decisionLoteId?)`, toda decisión individual limpia `decision_lote_id`, `copiar_de` no lo copia, `AnioFilaApi.decision_lote`, columnas `"decision"` de `leerFilasConAnios` (todo menos `historico`) y `updated_at` en las ligeras. Pruebas: `tests/proyeccion.{lote-decision,estatico}.test.ts` (R12, R14 del lado TS). **Contrato con Backend A**, fijado aquí: `payloadAnioDecision(filaId, r, decididoPorId, decisionIaFilaId?, decisionLoteId?)`.

**Frontend A · pestaña** (`frontend`): `src/app/(app)/planificacion/proyeccion/{aprobacion-tab,aprobacion-vista,use-aprobacion,confirmar-lote-modal,historial-lotes}.tsx/ts` (nuevos), `vista.ts` (solo `PESTANAS` y el filtro en la URL) y `proyeccion-panel.tsx`. Pruebas: `tests/aprobacion.pantalla-{vista,render}.test.ts` (selección, totales, desvío en el navegador, tandas, texto plano de la razón).

**Frontend B · enlaces y badges** (`frontend`): `celda-decision.tsx`, `bloque-decision.tsx`, `detalle-fila.tsx`, `cerrar-modal.tsx`, `propuesta-ia-tab.tsx`, `gm-ia-detalle.tsx`, `linea-tab.tsx`. **No toca** `vista.ts` ni `proyeccion-panel.tsx` (los enlaces se arman con una función que exporta Frontend A en `aprobacion-vista.ts`, congelada al empezar la tanda: `rutaAprobacion(proyeccionId, filtro)`).

### Tanda 3

1. `qa`: lint, tsc, vitest, build, revisión del diff y recorrido en Chromium con la IA apagada y con el proveedor falso de 07e; medir una petición de 300 filas sintéticas en local.
2. `seguridad` (sonnet, solo lectura): guards, que ningún lote pise una decisión (condición en SQL, `for update`), idempotencia, inmutabilidad y permisos de la `00L1`, `search_path` y `security invoker` de la función, que la lista de columnas no deje escribir `fila_id`, `anio` ni `id`, XSS de razón y nota.
3. `documentador`: `CHANGELOG.md`, `docs/PLAN.md` (versión, migración, estado), `docs/DECISIONES.md` (estado de la decisión 82), esta ficha (lo construido), `docs/pruebas/cowork-checklist.md` (sección nueva, la siguiente letra libre) y `src/lib/version.ts` = `0.15.0 · M7 c` (o la siguiente libre).

## Preguntas abiertas para Javier

Ninguna impide aplicar la migración; las del bloque A cambian qué se ofrece por defecto.

**Bloque A · qué se aprueba**

1. **¿Se aceptan en bloque las propuestas del método** (todo 2026 y las filas de 2027 sin IA o con la IA apagada)? Sin esto, con la IA apagada el módulo no sirve y 2026 se sigue decidiendo fila por fila. **Recomendación: sí**, con rótulo «Método», `origen = propuesta` (lo mismo que el botón «Aceptar» de una fila) y un año por lote.
2. **Filas «para revisión» (cola larga con quiebres de stock):** ¿entran en «Seleccionar visibles»? Su propuesta es la demanda corregida `A_f`, que 07 pidió revisar a mano. **Recomendación: aprobables en bloque, pero fuera de la selección por defecto** (hay que activar el chip «Incluir para revisión»).
3. **Filas con avisos fuertes de la IA** (`brecha_extrema`, `absorcion_alta`, confianza baja): ¿fuera de la selección por defecto? **Recomendación: sí**, con el chip «Solo sin avisos» activo por defecto; se pueden incluir a propósito.
4. **2026 antes que 2027:** ¿bloquear la IA de 2027 en un GM con 2026 pendiente, o solo avisar? **Recomendación: avisar, no bloquear** (07e ya lo recomienda sin exigirlo; bloquear sería una regla nueva, y el cuadre de la Matriz muestra el efecto).

**Bloque B · operación**

1. **Tope de 300 filas por petición, con tandas automáticas** que no parten un GM y se deshacen juntas. **Recomendación: sí**; QA lo mide y la constante se ajusta sin cambiar el contrato.
2. **Bloquear la aprobación en bloque con la proyección desactualizada** (mes nuevo, curva, crecimientos) **o con crecimientos de 2027 sin aprobar**, sin «forzar». **Recomendación: sí**: las decisiones sobreviven al recálculo y aprobar sobre datos viejos fijaría cientos de cifras que ya no se propondrían. Recalcular es un clic.
3. **Deshacer:** revertir un lote entero o en parte, sin límite de tiempo mientras la proyección esté en trabajo, y solo lo que nadie cambió después. **Recomendación: sí**; sin modo «sobrescribir decididas».
4. **Tiendas nuevas sin decidir:** ¿fuera de este módulo? **Recomendación: fuera** (son pocas y cada una mueve la composición de sus filas); la pestaña muestra la cuenta y el enlace.

**Revisión:** conviene una pasada corta del `arquitecto-revisor` (opus) antes de construir: relaja una regla registrada, introduce una función de escritura transaccional sobre la tabla central de M7 y una nueva vía de concurrencia con `decidirFila`.

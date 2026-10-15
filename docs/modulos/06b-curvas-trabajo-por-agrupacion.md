# M6b · Curvas de estacionalidad: trabajo agrupación por agrupación

> Estado: **rediseño de flujo especificado el 2026-10-15, pendiente de aprobación por Javier.** Sustituye el flujo de **corrida global** de la ficha [06-curvas-estacionalidad](06-curvas-estacionalidad.md) (tercera pasada, construida en `0.9.6 · M6`) por un flujo en el que **la unidad de trabajo es una agrupación de estacionalidad**: se abre, se ve en un mismo gráfico y tabla la curva aprobada vigente, la curva de cada año y la que propone el sistema, se ajustan sus parámetros, y se aprueba esa curva. La lógica estadística de la 06 (red comparable por fechas y por datos, candidatas `A`…`E` y `T`, backtesting con EAT, veredicto de forma relativo al ruido, recomendación con empate relativo, volumen y forma del Niño por separado, obsolescencia con huellas) **se conserva tal cual**; lo que cambia es cómo se llega a ella, qué se lee, qué se guarda y qué ve el planner. Migración prevista **`0017_venta_estacionalidad_agrupacion.sql`** (pequeña) y versión **`0.9.7 · M6`** (la vigente es `0.9.6 · M6`); commits con prefijo `M6:`. Módulo anterior: [05-venta-stock](05-venta-stock.md); dependen de aquí [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (temporada), [04-tiendas](04-tiendas.md) (fechas de apertura y cierre) y [07-proyeccion-anual](07-proyeccion-anual.md) (contratos de salida, que no cambian). Ningún dato real de Lukers en esta ficha: los ejemplos son sintéticos y las observaciones sobre la base real van en cifras agregadas sin nombres.

## Objetivo

Que el planner trabaje la estacionalidad **como la trabaja de verdad**: abre una agrupación, mira superpuestas la curva que aprobó, las curvas de cada uno de los últimos años (participación mensual sobre la red comparable de ese año, con el año en curso parcial y los años del Niño diferenciados) y la que el sistema propone hoy, entiende en una frase por qué el sistema propone esa, mueve si hace falta los parámetros de **esa** agrupación (años, tratamiento del Niño, red de tiendas, candidata) y aprueba. La `0.9.6` construyó el motor completo y lo expuso con una corrida global ("Calcular" para las 15 agrupaciones, guardada entera, y después una tabla con propuestas); Javier la probó y describió otra forma de trabajar: **agrupación por agrupación**, con la vista única de aprobada, años y sistema, y con el sistema comprobando antes de calcular que esa agrupación tiene lo que necesita (temporada marcada, periodos del Niño cargados, meses y fechas de tiendas completos). Esta ficha reordena el módulo alrededor de ese flujo, reutilizando casi todo lo construido, y deja para M7 los mismos contratos que ya tenía (curva vigente con versión y huellas, curva acumulada, factor de volumen por temporada).

## Decidido por Javier

Rigen todas las decisiones de la 06 (1 a 10 de "Decidido por Javier" y 1 a 22 de "Decisiones nuevas"), más lo dicho el **2026-10-15** tras probar la `0.9.6` desplegada:

1. **"Se tiene que trabajar agrupación de estacionalidad una por una."** La pantalla principal lista las agrupaciones con su estado y, al abrir una, se trabaja esa.
2. **"Tener una vista de la curva que definimos aprobada y las de los últimos años, así como la que genera el sistema en automático."** Las tres en el mismo gráfico y la misma tabla, con la diferencia mes a mes entre aprobada y propuesta.
3. **La lógica de Vector-One sirve hasta M6**: todos los años superpuestos; participación medida para las mismas tiendas (solo las que estuvieron todo el año); una curva propuesta con una lógica explicable. Se mantiene.
4. **Las curvas no quedan escritas en piedra**: una tienda nueva puede modificarlas (requisito del 2026-10-14, vigente). No hay aprobación en bloque; cada curva se aprueba por agrupación tras revisar su detalle.
5. **El Niño de 2023 y 2026 afecta el año completo a invierno y adelanta el verano (desde setiembre).** Catálogo de periodos atípicos como está en la 06; el cálculo de una agrupación de invierno o verano **no corre sin periodos cargados** (ver "Prerrequisitos").
6. De la 06 y sin cambio: `meses_tienda_nueva = 0`; veredicto de forma relativo al ruido; recomendación con empate relativo al promedio simple; volumen y forma por separado y por temporada; rol `requirePlanner` en toda la API; M7 recibe la curva vigente con versión y huellas, la curva acumulada por unidad y el factor de volumen por temporada (calculado aquí, editable en M7).

## Qué cambia y qué no (resumen para quien construyó la 0.9.6)

| Aspecto | `0.9.6` (corrida global) | `0.9.7` (por agrupación) |
|---|---|---|
| Unidad de trabajo | Una corrida para las 15 agrupaciones; luego tabla con propuestas | **Una agrupación**: lista con estado → abrir → trabajar → aprobar |
| Cuándo se calcula | Al pulsar Calcular (2 a 5 s: refresco de la MV + lectura de 1 MB) | **Al abrir la agrupación y al cambiar un parámetro** (una lectura filtrada, objetivo < 3 s) |
| Lectura de la venta | `refrescar_y_leer_agregado_estacionalidad()` (MV completa, lock) | **`venta_estacionalidad_agrupacion(p_agrupacion_id)`** (`0017`): la agrupación × tienda × mes, las temporadas × tienda × mes y los totales por tienda, en un `jsonb`; sin MV |
| Qué se guarda | Toda corrida (120 KB) y la corrida de referencia | **Solo la foto de cada aprobación** (fila de `corridas_estacionalidad` con alcance de una agrupación, ~6 a 10 KB) y la curva versionada. Los cálculos que se miran y no se aprueban no se guardan |
| Prerrequisitos | Se calculaba con el catálogo vacío (0 periodos) | **Se comprueban antes de calcular**, con motivo, y bloquean cuando falta lo imprescindible |
| Parámetros | Globales, en la tarjeta Calcular | **De esa agrupación**, visibles en su panel; se guardan en la foto y son el punto de partida de la siguiente revisión |
| Estado de la lista | Depende de la corrida seleccionada | **Sin corrida**: `sin_curva` / `al_dia` / `al_dia_distinta` (se aprobó una candidata distinta de la recomendada) / `obsoleta` (con motivo) / `inactiva_con_curva`; "Comparar con el sistema" a demanda |
| Factor del Niño para M7 | De la corrida de referencia | **Calculado a demanda** desde las series por temporada (misma función SQL sin agrupación); M7 guarda el valor que usó (ya era editable allí) |
| Pestañas | Curvas · Años Niño · Periodos atípicos | **Agrupaciones · Años Niño (apoyo) · Periodos atípicos** |
| Modelo (`src/lib/curvas/`) | — | **Sin cambios de fórmula.** Tres extensiones de entrada: series agregadas por temporada (para `T` y el control), `anios_excluidos` y `tiendas_excluidas` |

## Requisitos que vienen del informe QA de la `0.9.6` (sin bloqueantes; se resuelven en este rediseño)

| # | Hallazgo | Requisito en `0.9.7` |
|---|---|---|
| Q1 | Un año `descartado` tiene `participacion = null` y su curva real en `participacion_real`; `serieDeAnio` (`src/components/curvas/series.ts:62`) y `celdaAnioMes` (`vista.ts:830`) leen solo `participacion`, así que **el año desaparece** del gráfico y de la tabla | En la vista "curvas de los últimos años" **se ven todos los años con red**: cada serie usa `participacion_real ?? participacion` (y `participacion_parcial` en el año en curso); los descartados y excluidos a mano van en gris apagado (encendibles), los imputados punteados en sus meses, los del Niño con banda vertical, el año en curso discontinuo. Un año desaparece solo si no tiene red (`sin_red_comparable`) o no tiene volumen, y entonces la tabla lo lista con "—" y el motivo. Regla 47 |
| Q2 | `ruido_normal` solo viaja en `efecto_atipico.forma`, que es `null` en agrupaciones sin periodo atípico (hoy las 10 de toda temporada); el `confirm` dice "ruido: no medible" aunque haya dos años normales | `AgrupacionResultado.ruido_normal: number | null` **a nivel de agrupación** (la EAT entre sus años normales, calculada siempre que haya dos, exista o no periodo atípico) y `ruido_normal_detalle` con los pares; la frase de recomendación, la tabla de candidatas ("EAT 29,1 · ruido 33"), el `confirm` y la lista lo muestran **siempre junto al EAT**; "no medible" solo con menos de dos años normales. `efecto_atipico.forma.ruido_normal` sigue siendo el mismo valor. Regla 48 |
| Q3 | `carga_nueva` compara todos los meses publicados hoy con `resumen.cargas` de la corrida sin mirar `hasta_periodo` (`obsolescencia.ts:113`, `lectura.ts:119`): un mes posterior al `hasta` de la curva la marca obsoleta y **recalcular y aprobar no la limpia** si ese mes sigue fuera de `hasta` | Regla corregida: `carga_nueva` solo por **meses `≤ hasta_periodo` de la foto** que no estén en `cargas` o estén republicados con otro `carga_id`; un mes publicado posterior a `hasta` se informa aparte como **`datos_posteriores`** (aviso, no obsolescencia: "hay 1 mes publicado después de 2026-08; la curva sigue al día hasta ese mes") y se convierte en `carga_nueva` solo cuando el `hasta` por defecto (último publicado y cerrado) ya lo incluye. Reaprobar con el `hasta` nuevo la limpia; la foto guarda `hasta_periodo` y `cargas` solo hasta ahí. Regla 49 |
| Q4 | La `frase` del backend usa coma decimal y el front, punto | Toda cifra de texto que genera el servidor (`formatearPuntos`, frases, detalles de avisos) y la pantalla usan el **mismo formateador `es-PE`** (`src/lib/formato.ts`): coma decimal, espacio fino de miles. Test de que ninguna `frase` ni `detalle` contiene `\d\.\d` |
| Q5 | El detalle vive en estado React y se pierde al recargar | La agrupación abierta va en la URL: **`?agrupacion=<id>`** (y `&modelo=` para la candidata dibujada); recargar o compartir el enlace reabre la misma vista; "← Agrupaciones" quita el parámetro. Mismo patrón que `?hoy=` de M4 |
| Q6 | Contadores de "sin venta" incoherentes (`sin_venta` cuenta `origen === null` en el modelo y "tiene unidades" en `conVenta`) | Una sola definición: **`sin_venta` = ningún mes con unidades positivas sobre la red comparable** (prerrequisito bloqueante en la vista: no hay nada que calcular ni aprobar); una agrupación **con venta pero sin años de ajuste suficientes** es `prestada` (candidata `T`) y **sí se puede aprobar** (el `confirm` lo dice: "curva prestada de la temporada"). `origen = null` solo ocurre si además `T` no existe (la temporada entera sin años), y entonces `sin_curva_posible` bloquea la aprobación. Regla 50 |
| Q7 | `/api/periodos-atipicos/anios` leía la corrida completa (~250 KB) tres veces | El flujo por agrupación lee solo lo de la agrupación: `calcular` lee una agrupación y las series por temporada; `/anios` sin `con_volumen` no lee venta; con `con_volumen=1` llama una vez a `venta_estacionalidad_agrupacion(null)` y no toca `corridas_estacionalidad`; la lista lee las fotos de las vigentes **sin `resultado`** (`select` de columnas) salvo `red_comparable`, `parametros` y `resumen`, que necesita la obsolescencia. Regla 46 (estático) lo cubre |

## Flujo de usuario paso a paso (planner)

**Paso 0 · Entrar.** `/planificacion/curvas-estacionalidad` abre en la pestaña **Agrupaciones**. Arriba, el resumen: "15 agrupaciones activas · 0 con curva aprobada · 15 sin curva · 0 obsoletas"; avisos globales de prerrequisitos (por ejemplo "No hay periodos atípicos cargados: las 5 agrupaciones de invierno y verano no se pueden calcular → Periodos atípicos"; "2 tiendas sin fecha de apertura → Tiendas"; "Falta cargar 2025-11"). *Decide*: por dónde empezar (filtros por temporada, estado, género; buscador).

**Paso 1 · Abrir una agrupación.** Pulsa **Trabajar** en una fila. La pantalla pasa a la vista de esa agrupación y pide `POST /api/curvas/agrupaciones/[id]/calcular` con los parámetros iniciales (los de su última aprobación si existe; si no, los valores por defecto). Mientras llega: "Leyendo la venta de HO INVIERNO (45 meses, 10 tiendas)…".

**Paso 2 · Prerrequisitos.** Lo primero que se ve es la tarjeta **Antes de calcular**. Si algo bloquea (sin periodos para su temporada, tienda con venta sin fecha de apertura, sin ningún año completo, sin venta, sin equivalencias), no hay gráfico: se muestra el motivo con el enlace para arreglarlo y, cuando aplica, la casilla de excepción ("Confirmo que esta temporada no tiene años atípicos"). Si solo avisa (temporada "Toda temporada" sin confirmar, meses sin cargar que dejan un año incompleto, apertura dudosa, pocos años normales), el cálculo sigue y los avisos quedan visibles. *Decide*: corregir en M3/M4/M5/Periodos y volver, o aceptar la excepción.

**Paso 3 · Mirar las curvas.** Bloque **Curvas de la agrupación**: un gráfico con (a) la **aprobada vigente** (v2, gris oscuro), (b) **cada año** (2023 Niño completo, 2024, 2025 en continuo; 2026 parcial ene–set en discontinuo; descartados en gris), (c) la **propuesta del sistema** (trazo grueso) y la banda mín–máx; debajo, la tabla año × mes con las mismas filas, más las filas "Propuesta", "Aprobada v2" y "Diferencia (pp)". Conmutador Participación / Unidades. *Decide*: si lo que ve tiene sentido (un año raro, un mes en cero, una tienda que distorsiona), antes de mirar ninguna cifra de ajuste.

**Paso 4 · Entender la recomendación.** Bloque **Lo que propone el sistema**: la frase de recomendación ("Propone **A · Promedio simple** de 2024 y 2025 (2023 entra incluido: su forma difiere 31 pp de la referencia y los dos años normales difieren 33 pp entre sí). B se equivoca 27,4 pp frente a 29,1 de A en 3 pruebas; la diferencia (1,7) es menor que el ruido entre años normales (33): sin evidencia para apartarse del promedio."), la tabla de candidatas con EAT (y EAT por pliegue desplegable), "Igual a A", "No disponible: motivo", y el `radio` para dibujar otra candidata en el gráfico y en la tabla. Al lado, el bloque **Efecto del Niño en esta agrupación** (volumen por año sobre tiendas comunes; forma con las tres cifras y el veredicto; para 2026 las dos formas parciales). *Decide*: quedarse con la recomendada o elegir otra (con nota).

**Paso 5 · Ajustar parámetros de esta agrupación (opcional).** Panel **Parámetros de esta agrupación** (plegado por defecto cuando no hay nada fuera del valor por defecto): años (cada año con su clase y una casilla "Excluir del ajuste"), tratamiento del Niño (`auto` / incluir / imputar / descartar), red de tiendas (solo tiendas completas, exigir venta todo el año, meses de tienda nueva, y la lista de tiendas de la red con casilla "Excluir"), umbrales (piso de forma, margen sobre el ruido, mínimo de unidades por año, máximo de huecos, dominante, liquidación), "Calcular hasta". Cada cambio **recalcula** (debounce 300 ms, cancelando la petición anterior) y el gráfico, la tabla, la recomendación y el comparador se actualizan; un chip "3 parámetros distintos del valor por defecto" y el botón "Restablecer". *Decide*: qué años y tiendas cuentan para esta agrupación y con qué tratamiento del Niño.

**Paso 6 · Comparar con la aprobada.** Bloque **Aprobada frente a propuesta** (solo si hay vigente): EAT entre ambas, la fila de doce diferencias con color por signo, "el mes que más cambia: enero (+1,8)"; y, si la vigente está **obsoleta**, el motivo nombrado ("la tienda T10 entra en la red de 2026; mes publicado después: 2026-09"). *Decide*: si vale la pena reemplazar la vigente.

**Paso 7 · Aprobar.** Botón **Aprobar esta curva** (campo `nota` opcional, obligatorio si la elegida no es la recomendada: así queda escrito por qué). El `confirm` resume: agrupación, temporada, candidata, años usados con clase y tratamiento, años y tiendas excluidos a mano, EAT frente al ruido, diferencia con la vigente, avisos. `PUT /api/curvas/agrupaciones/[id]` con `{ modelo, parametros, huella_calculo, nota }`: el servidor recalcula con esos parámetros, comprueba que la huella coincide (si los datos cambiaron entre abrir y aprobar responde `409 datos_cambiados` y la pantalla recarga), guarda la **foto** y crea la versión siguiente. Mensaje: "Curva A aprobada como versión 3 de HO INVIERNO". La lista la muestra "Al día".

**Paso 8 · Historial.** Bloque **Versiones** al pie: v3 vigente, v2 reemplazada, v1 reemplazada (modelo, fecha, quién, nota, mini curva); "Ver foto" abre el detalle congelado de esa versión (datos y parámetros de aquel momento). **Retirar** (confirm) deja la agrupación sin curva.

**Paso 9 · Volver a la lista y seguir con la siguiente.** "← Agrupaciones" conserva filtros; la fila recién aprobada queda "Al día · v3 · A · hoy". Cuando cambien los datos (mes nuevo, tienda que cumple su primer año completo, equivalencia movida, periodo editado), la fila pasará a **Obsoleta** con el motivo; **Comparar con el sistema** (por fila, o "las obsoletas" de una vez) calcula la propuesta de hoy y muestra la diferencia, sin aprobar nada.

### Qué decide el planner y qué decide el sistema

| Decisión | Quién | Dónde |
|---|---|---|
| Qué agrupación trabajar y en qué orden | planner | lista |
| Temporada de la agrupación | planner (M3 o cabecera de la agrupación) | prerrequisito (avisa) |
| Qué meses son del Niño | planner (catálogo) | prerrequisito (bloquea sin periodos para invierno/verano) |
| Qué tiendas forman la red de cada año | sistema (fechas de M4 y venta de M5) + planner (exclusión manual con motivo visible) | panel Red |
| Qué años entran en el ajuste | sistema (clase, escaso, tratamiento efectivo) + planner (`anios_excluidos`, `tratamiento_atipicos`) | panel Años |
| Qué candidata se propone | sistema (backtesting, empate relativo al ruido) | bloque Lo que propone el sistema |
| Qué candidata se aprueba | **planner**, una por agrupación | botón Aprobar |
| Cuándo una curva está obsoleta | sistema (huellas) | lista y cabecera |
| Cuándo reaprobar | planner | lista → Trabajar |

## Conceptos nuevos o ajustados

### Cálculo a demanda y foto de aprobación

Un **cálculo** es la ejecución de `calcularCorrida` (06, regla 19, sin cambios) sobre la entrada de **una** agrupación; es determinista, dura milisegundos y **no se guarda**. Lo que se guarda es la **foto de aprobación**: la fila de `corridas_estacionalidad` que `PUT` inserta justo antes de la curva, con `agrupacion_estacionalidad_id` (nueva columna), `parametros` (incluidos `anios_excluidos` y `tiendas_excluidas`), `resultado = { agrupaciones: [la agrupación], temporadas: [la suya y, si es distinta, todo_el_ano como control] }`, `red_comparable`, `efecto_atipico` (solo su temporada y el control), `resumen` (`cargas`, `red_huella`, `huella_calculo`, `meses_publicados`, `duracion_ms`) y quién. `curvas_estacionalidad.corrida_id` apunta a la foto: el contrato con M7 (`GET /api/curvas/vigentes`, `curva_id`, `version`, huellas) **no cambia**.

**Huella de cálculo** (`huella_calculo`, `huellas.ts`): md5 de `cargas_huella | red_huella | composicion.huella | temporada | hasta_periodo | periodos aplicables (id, desde, hasta ordenados) | parámetros canónicos`. Identifica la entrada: dos cálculos con la misma huella dan el mismo resultado (regla 19). Sirve para (a) rechazar una aprobación cuya entrada ya no es la que el planner vio (`409 datos_cambiados`) y (b) saber en la lista, sin calcular, que "el sistema hoy" propondría lo mismo que al aprobar.

### Estado de una agrupación en la lista (sin corrida)

| Estado | Condición | Cómo se ve |
|---|---|---|
| `sin_curva` | sin curva vigente | badge "Sin curva"; botón Trabajar |
| `al_dia` | vigente, `obsoleta = null` y `recomendada = true` en la foto | "Al día · v2 · A · 15/10 · Javier" |
| `al_dia_distinta` | vigente, no obsoleta, pero se aprobó una candidata distinta de la recomendada | "Al día · v2 · **B** (el sistema proponía A)"; `title` con la nota |
| `obsoleta` | `motivosObsoleta` no vacío (06, regla 24, sin cambios) | badge ámbar "Obsoleta: la tienda X entra en la red de 2026"; botón Comparar con el sistema |
| `inactiva_con_curva` | agrupación inactiva con vigente | al final, atenuada |

Por qué basta con esto: si nada de lo que la huella cubre cambió, el modelo es determinista y la propuesta de hoy es la de la foto; si algo cambió, la curva es `obsoleta` por definición y la propuesta de hoy se calcula a demanda ("Comparar con el sistema"). No hace falta una corrida global ni guardar propuestas. El resultado de "Comparar" vive en memoria de la pantalla (columna "Sistema hoy": candidata, EAT frente a la vigente, "difiere 4,1 pp") hasta recargar.

### Prerrequisitos de una agrupación (lo que faltó en la 0.9.6)

`prerrequisitosAgrupacion(entrada)` (pura, `src/lib/curvas/prerrequisitos.ts`) devuelve `{ bloquea: Prerrequisito[], avisa: Prerrequisito[] }` con `{ codigo, detalle, enlace: { pantalla, id? } | null }`. Se evalúa **antes** de armar la entrada; con `bloquea` no vacío, el endpoint responde `200` con `calculo: null` (la pantalla muestra la tarjeta y nada más).

| Código | Nivel | Condición | Arreglo |
|---|---|---|---|
| `sin_meses_publicados` | bloquea | M5 sin cargas publicadas | Venta y stock |
| `sin_anio_completo` | bloquea | ningún año calendario con los 12 meses publicados antes de `hasta_periodo` | cargar los meses que faltan (lista) |
| `periodos_temporada_faltantes` | bloquea | agrupación de `invierno` o `verano` **y** ningún periodo atípico activo cuyo conjunto `temporadas` incluya la suya; se levanta con `sin_periodos_confirmado = true` (casilla "Confirmo que esta temporada no tiene años atípicos", que se guarda en la foto) | Periodos atípicos |
| `tienda_sin_apertura` | bloquea | una tienda de tipo Tienda, activa, **con venta publicada** y sin `fecha_apertura` (la red comparable no se puede decidir) | Tiendas (enlace a la fila) |
| `sin_venta` | bloquea | la agrupación no tiene unidades positivas en ningún mes publicado | revisar la asignación en M3 |
| `composicion_vacia` | bloquea | 0 equivalencias activas | M3 |
| `temporada_sin_confirmar` | avisa | `temporada = todo_el_ano` y la agrupación nunca tuvo curva aprobada (al aprobar, el `confirm` repite la temporada: aprobar la confirma) | cabecera o M3 |
| `meses_sin_cargar` | avisa | huecos en la serie publicada hasta `hasta_periodo` (los años afectados son `incompleto` y no entran) | Venta y stock |
| `periodo_fuera_de_datos` | avisa | un periodo aplicable incluye meses posteriores al último publicado (normal en el año en curso) | — |
| `apertura_dudosa` / `cierre_dudoso` | avisa | de la red comparable (06, regla 4d) | Tiendas |
| `pocos_anos_normales`, `escaso`, `cambio_volumen_extremo`, `tienda_dominante`, `tienda_distinta`, … | avisa | avisos del modelo (06), se muestran en el mismo bloque | — |

En la lista, los prerrequisitos **globales** (los que no dependen de la agrupación: meses, periodos por temporada, tiendas sin apertura) se calculan una vez y se muestran arriba; por fila, un icono si la agrupación tiene alguno que bloquea (sin calcular: temporada y conteo de periodos aplicables, composición, y para `sin_venta` el dato de la última foto o "—").

### Parámetros por agrupación

`ParametrosCurvas` de la 06 (sin cambios de nombre ni valor por defecto) más tres campos:

| Campo | Tipo | Defecto | Efecto |
|---|---|---|---|
| `anios_excluidos` | `number[]` | `[]` | el año queda `tratamiento = 'descartado'` con motivo `excluido_manual`, fuera del ajuste y de la referencia de forma; se dibuja en gris; sigue contando para el volumen (diagnóstico) |
| `tiendas_excluidas` | `uuid[]` | `[]` | la tienda sale de la red de todos los años con motivo `excluida_manual` (nuevo en `MOTIVOS_RED`) |
| `sin_periodos_confirmado` | `boolean` | `false` | levanta `periodos_temporada_faltantes` |

Los parámetros de la **última aprobación** son el punto de partida al reabrir la agrupación (con el botón "Restablecer valores por defecto"); así "Comparar con el sistema" compara like-for-like. `hasta_periodo` por defecto sigue siendo el último mes publicado y cerrado en Lima.

### Las tres curvas en el mismo gráfico y la misma tabla

Series (todas existen ya en `AgrupacionResultado`): **aprobada vigente** (`vigente.curva`), **años** (`anios[].participacion_real ?? participacion` continuo, de modo que un año descartado o excluido sigue dibujado, Q1; `participacion` imputada punteada en los meses imputados; `participacion_parcial` del año en curso discontinuo; escasos atenuados; descartados y excluidos en gris, apagados por defecto; meses atípicos con banda vertical; liquidación con punto ámbar), **propuesta** (la candidata elegida con el `radio`; por defecto la recomendada; `T` encendible) y **banda** mín–máx. La tabla año × mes (`TablaMatriz`) añade al pie las filas **Propuesta**, **Aprobada vN** y **Diferencia (pp)** con color por signo (`claseVariacion` de M11), y la cabecera de cada año lleva clase, tratamiento, unidades, tiendas en la red y peso de la mayor. CSV con las mismas filas.

## Modelo de datos

Migración **`0017_venta_estacionalidad_agrupacion.sql`**, idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE` (tampoco dentro de funciones), sin bloques `do $$`, `create or replace` / `if not exists`, `revoke` a `public`, `anon` y `authenticated` más `grant` a `service_role` sobre cada objeto nuevo, `security invoker` y `search_path = ''`, como `0014` a `0016`. `datos` verifica que la última migración siga siendo la `0016`.

### 1. Función `venta_estacionalidad_agrupacion(p_agrupacion_id uuid default null) returns jsonb`

`language sql`, `stable`. Es la **única lectura de venta de M6** a partir de esta entrega y devuelve, en una sola sentencia (un solo estado de los datos), tres bloques sobre `venta_stock_vigente` (solo cargas publicadas):

```jsonc
{ "agrupacion": [ { "tienda_id": "…", "periodo": "2024-01-01", "unidades": 930, "venta_soles": 41200.50, "costo_vendido": 20100.25 }, … ] | null,   // solo con p_agrupacion_id; ~10 tiendas × 45 meses = ~450 objetos
  "temporadas": [ { "temporada": "invierno", "tienda_id": "…", "periodo": "2024-01-01", "unidades": 12030 }, … ],                                // temporada × tienda × mes, ≤ 4 × 10 × 45 = 1 800 objetos
  "meses_publicados": [ "2023-01-01", … ] }                                                                                                      // de cargas_venta_stock publicadas
```

- `temporada` sale de `equivalencias → agrupaciones_estacionalidad`: la `temporada` de la agrupación **activa**; `'sin_agrupacion'` para equivalencias sin agrupación o con agrupación inactiva. Así la suma de `temporadas` por tienda y mes es la **venta total de la tienda** (la red comparable se decide sobre la venta total, 06 regla 4), y los objetos con `sin_agrupacion` dan `unidades_sin_agrupacion`. Ya no hace falta `venta_mensual_tienda()` en este flujo (se conserva para `GET /api/curvas/red-comparable` y la obsolescencia, que no cambian).
- `agrupacion` es la suma por tienda y mes de las equivalencias con `agrupacion_estacionalidad_id = p_agrupacion_id` (activas o no: los hechos de una equivalencia desactivada siguen siendo venta de esa agrupación mientras apunte a ella; coincide con lo que hacía la MV). Entra por el índice de `equivalencias(agrupacion_estacionalidad_id)` y el de `venta_stock_mensual(equivalencia_id, carga_id)`.
- `numeric` viaja como número o texto (lo normaliza `leerAgregado`, que se reutiliza con la forma nueva); `date` como `aaaa-mm-dd`.
- Por qué `jsonb` y no `setof`: `temporadas` supera el corte de 1 000 filas de PostgREST; paginar un `rpc` reejecutaría el agregado por página. ~2 300 objetos pesan ≈ 250 KB.
- Costo: un agregado completo de `venta_stock_vigente` (~1,5 M filas, `group by` de tres columnas; del orden de `venta_mensual_tienda()`, que ya corre en cada `GET /api/curvas`) más uno indexado para la agrupación. **Objetivo: abrir una agrupación en menos de 3 s en el compute actual**; se mide en el hito. Si no cabe, la salida de reserva es que la **misma función** lea de la MV `venta_mensual_estacionalidad` refrescada con `refrescar_venta_mensual_estacionalidad()` cuando cambie la huella de cargas (una función nueva en una `0018`, sin tocar la API); por eso la MV no se declara muerta, solo sin uso.
- Con `p_agrupacion_id` nulo (`agrupacion: null`) sirve a la pestaña Años Niño y a `/anios` (factor por temporada).

### 2. `corridas_estacionalidad.agrupacion_estacionalidad_id uuid null`

`add column if not exists … references public.agrupaciones_estacionalidad(id) on delete restrict`; índice `corridas_estacionalidad_agrupacion_idx (agrupacion_estacionalidad_id, created_at desc)`. **Nulo = corrida global heredada de la `0.9.6`** (hay una en la base; se conserva como historial, sin uso); **no nulo = foto de aprobación de esa agrupación**. `comment on column`. El `check` de 4 MB de `resultado` sigue sobrando; no se toca.

### 3. Lo que queda sin uso (no se puede borrar; se documenta con `comment on`)

- `corridas_estacionalidad.referencia` y su índice único parcial: **sin uso desde `0.9.7`** (ninguna ruta lo lee ni lo escribe; el factor del Niño se calcula a demanda). El comentario lo dice.
- MV `venta_mensual_estacionalidad`, `refrescar_venta_mensual_estacionalidad()` y `refrescar_y_leer_agregado_estacionalidad()`: **sin uso**; quedan como reserva de rendimiento (arriba). La MV sigue protegida con `revoke` y vacía o con el último refresco; nadie la lee.
- `venta_mensual_tienda()` y `unidades_mensuales()`: siguen en uso (obsolescencia, vista previa de la red, M11).

### Diagrama

```
periodos_atipicos (temporadas[]) ─┐
agrupaciones_estacionalidad.temporada ─┼─► prerrequisitosAgrupacion ─► [bloquea] tarjeta "Antes de calcular"
tiendas (M4) ─────────────────────┤
cargas publicadas (M5) ───────────┤
venta_stock_vigente ─► venta_estacionalidad_agrupacion(id) [0017, jsonb] ─┘
        │  (una lectura por apertura o cambio de parámetro; nada se guarda)
        ▼
armarEntradaAgrupacion ─► calcularCorrida (06, sin cambios) ─► POST /api/curvas/agrupaciones/[id]/calcular ─► pantalla: aprobada · años · propuesta
        │ el planner aprueba UNA curva con sus parámetros y la huella del cálculo
        ▼
PUT /api/curvas/agrupaciones/[id] ─► recalcula, compara huella ─► corridas_estacionalidad (foto, agrupacion_estacionalidad_id) ─► curvas_estacionalidad (vigente v+1) ─► M7 (GET /api/curvas/vigentes: sin cambios)
```

## Contratos de API

Convenciones de la 06: `{ data }` con `ok()`, `{ error, codigo }` con `errorConCodigo`, cuerpos con `leerCuerpo`, esquemas zod en `src/lib/curvas/esquemas.ts`, `idDeRuta`, `traducirErrorDb`. **Toda ruta de M6 exige `requirePlanner`.** Errores: `401` · `403` · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio · `500`.

### Rutas que cambian o nacen

| Ruta | Método | Cuerpo / query | Respuesta |
|---|---|---|---|
| `/api/curvas` | GET | — | **`EstadoCurvasApi` v2** (abajo): sin `corrida` ni `corridas`; `estado` por agrupación; prerrequisitos globales |
| `/api/curvas/agrupaciones/[id]/calcular` | **POST** (lectura con cuerpo, como `POST /api/reportes/agrupacion-gmle/unidades-mensuales`) | `calcularAgrupacionSchema` | `200 TrabajoAgrupacionApi` (abajo). `404` agrupación. Nunca escribe |
| `/api/curvas/agrupaciones/[id]` | PUT | `aprobarCurvaSchema` | `201 { curva, foto_id }`. `404` · `409 agrupacion_inactiva` · `409 prerrequisitos` (algún bloqueante) · `409 candidata_no_disponible` · `409 datos_cambiados` (la huella recalculada difiere de `huella_calculo`) · `409 sin_cambio` (misma candidata y misma huella que la vigente) · `409 nota_requerida` (candidata distinta de la recomendada sin nota) |
| `/api/curvas/agrupaciones/[id]` | DELETE | — | retira la vigente (sin cambios) |
| `/api/curvas/agrupaciones/[id]/versiones` | **GET** | — | `{ versiones: [{ id, version, estado, modelo, origen, recomendada, eat, curva, nota, aprobada_at, usuario_nombre, foto_id, parametros_resumen }] }` por `version desc` |
| `/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` | GET | `?modelo=` | **se conserva**: el detalle **congelado** de una foto ("Ver foto" de una versión). `404` si la corrida no es de esa agrupación |
| `/api/curvas/anios-atipicos` | GET | — | **calcula a demanda** con `venta_estacionalidad_agrupacion(null)`: `{ efecto: EfectoAtipicoCorrida, periodos, anios, temporadas, calculado_at, huella_cargas }`; ya no recibe `corrida_id` |
| `/api/periodos-atipicos/anios` | GET | `?con_volumen=1` opcional | sin `con_volumen`, `ratio_volumen` y `volumen` son `null` (barato; la pestaña Periodos lo usa así). Con `con_volumen=1` (M7 y la pestaña Años Niño) se calculan a demanda; `corrida_id` pasa a `null` siempre y se añade `calculado_at` |
| `/api/curvas/vigentes` · `/api/curvas/red-comparable` · `/api/periodos-atipicos*` | | | **sin cambios** |

### Rutas que se retiran (se borran los handlers)

`POST /api/curvas/calcular`, `GET /api/curvas/corridas`, `GET` y `PATCH /api/curvas/corridas/[id]`. El test estático de guards no las echa de menos; se añade un test estático de que **no existen** (regla 31b).

### Esquemas

```ts
export const calcularAgrupacionSchema = calcularSchema                       // 06: mismos campos y defectos, sin marcar_referencia
  .omit({ marcar_referencia: true })
  .extend({
    anios_excluidos: z.array(z.number().int().min(2000).max(2100)).max(20).default([]),
    tiendas_excluidas: z.array(z.uuid()).max(100).default([]),
    sin_periodos_confirmado: z.boolean().default(false),
  });

export const aprobarCurvaSchema = z.object({
  modelo: z.enum(MODELOS_CURVA),                                             // A..E, T
  parametros: calcularAgrupacionSchema,                                       // los que vio el planner
  huella_calculo: z.string().regex(/^[0-9a-f]{32}$/),                         // la que devolvió calcular
  nota: z.string().trim().max(300).optional(),
});
// No existen `elegirCurvaSchema` (sustituido), `marcarReferenciaSchema` ni `aprobarSchema` en bloque (estático).
```

### `POST /api/curvas/agrupaciones/[id]/calcular` → `TrabajoAgrupacionApi`

Pasos del handler: (1) en paralelo, `leerAgrupacionConDatos(id)` (géneros, equivalencias activas, huella, temporada, última foto si tiene vigente), `leerTiendas`, `leerPeriodos(activos)`, `leerCargasPublicadas`, `leerCurvaVigente`, y **una** llamada `venta_estacionalidad_agrupacion(id)`; (2) `prerrequisitosAgrupacion` → si bloquea, `200` con `calculo: null`; (3) `armarEntradaAgrupacion` (series de la agrupación y de las temporadas sobre la red comparable de cada año; `tiendas_excluidas` aplicadas en `redComparable`); (4) `calcularCorrida` (06) y `efectoAtipicoCorrida` con los grupos de temporada; (5) obsolescencia de la vigente (`leerObsolescencia`, sin cambios); (6) comparador vigente / candidata pedida; (7) `huella_calculo`.

```jsonc
{ "data": {
  "agrupacion": { "id", "nombre", "codigo", "activo", "temporada", "temporada_sugerida", "generos", "equivalencias_activas" },
  "datos": { "desde": "2023-01", "hasta": "2026-09", "meses_publicados": 45, "faltantes": [], "hasta_periodo": "2026-09", "ultimo_mes_cerrado": "2026-09" },
  "parametros": { …efectivos, con defectos aplicados… },
  "prerrequisitos": { "bloquea": [], "avisa": [ { "codigo": "temporada_sin_confirmar", "detalle": "Sigue en Toda temporada: confirma la temporada antes de aprobar", "enlace": null } ] },
  "huella_calculo": "md5…",
  "calculo": {                                                       // null si bloquea
    "resultado": { …AgrupacionResultado de la 06; añade ruido_normal y ruido_normal_detalle a nivel de agrupación (Q2) y anios[].tratamiento_motivo con 'excluido_manual'… },
    "temporada_curva": { …TemporadaResultado de su temporada… },
    "efecto_temporada": [ …EfectoTemporadaAnio de su temporada y de todo_el_ano (control)… ],
    "red": [ …RedAnioApi con codigo y nombre; motivos incluyen 'excluida_manual'… ],
    "tiendas": [ { "id", "codigo", "nombre" } ],
    "duracion_ms": 1840 },
  "vigente": { …VigenteResumenApi… , "foto_id": "…", "recomendada_entonces": "A", "parametros": { … }, "huella_calculo": "md5…", "nota": null } | null,
  "obsoleta": { "motivos": [ … ] } | null,
  "comparador": { …ComparadorApi (candidata pedida por `?modelo=` o la recomendada frente a la vigente)… } | null,
  "versiones": 2 } }
```

### `PUT /api/curvas/agrupaciones/[id]`

(1) Lee lo mismo que `calcular`; (2) `prerrequisitosAgrupacion` → `409 prerrequisitos` si bloquea; (3) recalcula con `parametros`; (4) `huella_calculo` recalculada ≠ enviada → `409 datos_cambiados` ("Los datos cambiaron desde que abriste la agrupación: vuelve a cargar"); (5) `motivoRechazoAprobar` (regla 26 ajustada: inactiva, candidata sin curva, `sin_cambio` si la vigente tiene la misma `huella_calculo` y el mismo `modelo`, `nota_requerida`); (6) inserta la **foto** en `corridas_estacionalidad` (`agrupacion_estacionalidad_id = id`, `referencia = false`); (7) `filaCurva` (regla 27, sin cambios salvo `anios_utilizados` que añade `huella_calculo`, `recomendada_entonces`, `anios_excluidos`, `tiendas_excluidas`) con `corrida_id = foto.id`, transición `reemplazada` → `insert` como hoy (sin transacción, con la misma compensación); (8) `201 { curva, foto_id }`. Una foto sin curva (fallo en el paso 7) es basura inofensiva: no la referencia nadie y las versiones la ignoran.

### `GET /api/curvas` → `EstadoCurvasApi` v2

```jsonc
{ "data": {
  "datos": { "desde", "hasta", "meses_publicados", "faltantes", "ultimo_mes_cerrado" },
  "prerrequisitos_globales": [ { "codigo": "periodos_temporada_faltantes", "detalle": "No hay periodos atípicos para invierno (4 agrupaciones) ni verano (1)", "enlace": { "pantalla": "periodos" } } ],
  "agrupaciones": [ { "id", "nombre", "codigo", "activo", "temporada", "temporada_sugerida", "generos", "equivalencias_activas", "periodos_aplicables": 2,
                      "vigente": { "id", "version", "modelo", "origen", "recomendada", "recomendada_entonces", "eat", "aprobada_at", "usuario_nombre", "foto_id", "hasta_periodo", "curva", "nota" } | null,
                      "obsoleta": { "motivos": [ … ] } | null,
                      "estado": "sin_curva" | "al_dia" | "al_dia_distinta" | "obsoleta" | "inactiva_con_curva",
                      "bloqueada_por": [ "periodos_temporada_faltantes" ],          // prerrequisitos evaluables sin calcular
                      "versiones": 2 } ],
  "periodos_atipicos": [ … ],
  "resumen": { "agrupaciones_activas": 15, "por_temporada": { … }, "sin_revisar_toda_temporada": 10, "con_curva_vigente": 0, "sin_curva": 15, "obsoletas": 0,
               "al_dia_distintas": 0, "inactivas_con_curva": 0, "bloqueadas": 5, "equivalencias_sin_agrupacion": 0 } } }
```

Lee: agrupaciones con datos, vigentes, periodos, cargas, tiendas, `venta_mensual_tienda()` (obsolescencia, como hoy), fotos de las vigentes (`leerCorridasPorIds`), conteo de versiones y de equivalencias sin agrupación. **No llama a `venta_estacionalidad_agrupacion`**: la lista nunca calcula.

### Contratos de lógica pura (lo que `backend` escribe y `tests/curvas.*` prueban)

| Función | Archivo | Estado |
|---|---|---|
| `calcularCorrida`, candidatas, backtesting, `recomendar`, `efectoAtipicoCorrida`, `compararFormaAnio`, `redComparable`, `motivosObsoleta`, `evaluarObsolescencia`, `filaCurva`, `armarComparador`, huellas | `modelo.ts`, `candidatas.ts`, `backtesting.ts`, `efecto.ts`, `atipicos.ts`, `red.ts`, `obsolescencia.ts`, `reglas.ts`, `huellas.ts` | **sin cambios de fórmula** |
| `armarGrupoTemporada(t, miembros, ctx, serieAgregada?)` | `modelo.ts` | extensión: con `serieAgregada` (series temporada × tienda × mes de la función SQL) la usa en vez de sumar `miembros`; sin ella, como hoy (compatibilidad y tests existentes) |
| `EntradaCorrida.series_temporada?: { temporada, por_tienda: { tienda_id, unidades: SerieAnual[] }[] }[]` | `modelo.ts` | tipo nuevo opcional |
| `redComparable(…, parametros)` con `tiendas_excluidas` | `red.ts` | extensión: motivo `excluida_manual`, evaluado antes de la condición 1 |
| `anios_excluidos` en `analizarAgrupacion` | `modelo.ts` | extensión: `tratamiento = 'descartado'`, `tratamiento_motivo = 'excluido_manual'`, `en_ajuste = false`, aviso `anio_excluido` |
| `armarEntradaAgrupacion(datos, parametros)` | `entrada.ts` | nueva: a partir de `{ agrupacion, temporadas, meses_publicados }` de la función SQL; `ventaPorTienda` suma `temporadas` (incluida `sin_agrupacion`) |
| `leerVentaEstacionalidad(json)` | `agregado.ts` | nueva (misma validación que `leerAgregado`, forma nueva) |
| `prerrequisitosAgrupacion(entrada)` | `prerrequisitos.ts` | nueva |
| `ruidoNormalAgrupacion(anios)` → `ruido_normal`, `ruido_normal_detalle` en `AgrupacionResultado` (Q2) | `modelo.ts` (usa `ruidoNormal` de `atipicos.ts`) | extensión |
| `EstadoGuardado.hasta_periodo`, aviso `datos_posteriores`, `EstadoActual.hasta_por_defecto` (Q3) | `obsolescencia.ts` | corrección de regla |
| `serieDeAnio`, `celdaAnioMes` con `participacion_real ?? participacion` (Q1) | `series.ts`, `vista.ts` | corrección |
| `huellaCalculo(partes)` | `huellas.ts` | nueva |
| `estadoDeAgrupacion(vigente, obsoleta, activo)` y `armarEstadoCurvas` v2 | `estado.ts` | ajustadas (sin corrida) |
| `motivoRechazoAprobar(agrupacion, calculo, modelo, vigente, nota)` | `reglas.ts` | sustituye a `motivoRechazoElegir` |
| `resolverCorrida`, `corridaDeReferencia`, `planificarReferencia`, `marcarReferencia`, `quitarReferencia`, `refrescarYLeerAgregado` | `lectura.ts`, `reglas.ts`, `consultas.ts` | **se borran** (y sus tests) |

## Pantallas

Ruta `/planificacion/curvas-estacionalidad` (menú Planificación; admin y planner; el comprador no la ve y la página redirige a `/`). La agrupación abierta vive en la URL (`?agrupacion=<id>&modelo=A`, Q5): recargar reabre la misma vista con los mismos parámetros iniciales. `curvas-panel.tsx` conserva el `Tabs` con tres pestañas: **Agrupaciones · Años Niño · Periodos atípicos**. Se reutilizan `useColeccion` / `useRecurso`, el kit de UI (`Card`, `DataTable`, `Chips`, `Badge`, `Alert`, `EmptyState`, `Modal`), `BadgeAgrupacion` con los colores de M3, `BadgeTemporada`, `GraficoCurvas`, `MiniCurva`, `series.ts`, `CandidatasTabla`, `ComparadorCurvas`, `TablaAnioMes`, `EfectoNinoDetalle`, `RedComparable` y `parametros-form.ts` (que pasa a alimentar el panel por agrupación).

### Pestaña Agrupaciones (lista)

```
Curvas de estacionalidad                                                     [Descargar curvas vigentes (CSV)]
La curva mensual de cada agrupación sale de la venta real... Trabaja las agrupaciones una por una.

┌ Resumen ────────────────────────────────────────────────────────────────────────────────────────────┐
│ 15 agrupaciones activas · 3 con curva al día · 1 aprobada distinta de la recomendada · 2 obsoletas   │
│ · 9 sin curva · 10 siguen en Toda temporada (revísalas)                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
⚠ Antes de calcular (global)
  • No hay periodos atípicos para invierno (4 agrupaciones) ni verano (1): no se pueden calcular → Periodos atípicos
  • 1 tienda con venta sin fecha de apertura → Tiendas
  • 2 equivalencias activas sin agrupación → Faltantes de M3

Filtros: Temporada [Todas 15 | Invierno 4 | Verano 1 | Toda temporada 10]  Estado [Todas | Sin curva 9 | Obsoletas 2 | Distintas 1 | Al día 3 | Bloqueadas 5]
         Género [▾]  Buscar [__________]                       [Comparar las obsoletas con el sistema (2)]  [▸ Red comparable por año]

┌─────────────────────┬────────────┬──────────────────────────────┬──────────────────────────────┬───────────┬──────────┬───────────┐
│ Agrupación          │ Temporada  │ Curva aprobada               │ Estado                       │ Sistema   │ Mini     │ Acciones  │
│                     │ (editable) │                              │                              │ hoy       │ curva    │           │
├─────────────────────┼────────────┼──────────────────────────────┼──────────────────────────────┼───────────┼──────────┼───────────┤
│ ● HO INVIERNO  H    │ Invierno ▾ │ v2 · A Promedio simple       │ ● Al día                     │ = (A)     │ ∿        │ Trabajar  │
│                     │            │ EAT 29,1 · Javier · 15/10    │                              │           │          │ Retirar   │
│ ● MU VERANO    M    │ Verano ▾   │ v1 · B Ponderado por volumen │ ● Al día · distinta de la    │ A (vs B)  │ ∿        │ Trabajar  │
│                     │            │ nota: "2025 tuvo..."         │   recomendada (A)            │           │          │           │
│ ● INF INVIERNO I    │ Invierno ▾ │ v1 · A                       │ ▲ Obsoleta: la tienda T10    │ Comparar  │ ∿        │ Trabajar  │
│                     │            │                              │   entra en la red de 2026;   │ → A,      │          │           │
│                     │            │                              │   mes publicado después:     │ difiere   │          │           │
│                     │            │                              │   2026-09                    │ 4,1 pp    │          │           │
│ ● ACC CASUAL   H M  │ Toda temp ▾│ Sin curva                    │ ○ Sin curva                  │ —         │          │ Trabajar  │
│ ● NIÑOS INV    I    │ Invierno ▾ │ Sin curva                    │ ⊘ Bloqueada: sin periodos    │ —         │          │ Trabajar  │
│                     │            │                              │   para invierno              │           │          │           │
└─────────────────────┴────────────┴──────────────────────────────┴──────────────────────────────┴───────────┴──────────┴───────────┘
Inactivas con curva (1) al final, atenuadas.
```

- **Sistema hoy**: "= (A)" cuando `al_dia` (determinismo: sin calcular); "A (vs B)" cuando `al_dia_distinta` (de la foto); "Comparar" cuando `obsoleta` o `sin_curva`; tras pulsar Comparar (por fila o "las obsoletas"), la celda muestra la candidata recomendada hoy, la EAT frente a la vigente y "difiere N pp" (o "sin vigente"); un cálculo en curso muestra "7 de 15…" y se puede cancelar. Los resultados no se guardan.
- Temporada editable en línea (mismo `PATCH` de M3): cambiarla marca la curva `obsoleta` (`temporada_cambiada`) y el prerrequisito de periodos se reevalúa al reabrir.
- **Red comparable por año** (plegable, `RedPanel` con `GET /api/curvas/red-comparable` y los parámetros por defecto): tabla tiendas × años, pesos siempre visibles, Dominante, Distinta, motivos legibles. Es la red "de la casa"; cada agrupación la ve con sus pesos propios en su vista.
- No hay tarjeta Calcular, selector de corridas, "Marcar como referencia" ni selección múltiple.

### Vista de una agrupación ("Trabajar")

```
← Agrupaciones        ● HO INVIERNO   H   Temporada [Invierno ▾]   140 equivalencias · Red: 8 · 9 · 9 · 10 tiendas · Calculado en 1,8 s (datos hasta 2026-09)

┌ Antes de calcular ───────────────────────────────────────────────────────────────────────────────────┐
│ ✔ Temporada invierno · ✔ 2 periodos del Niño aplican (2023 completo, 2026 en curso) · ✔ 45 meses sin huecos│
│ ⚠ Pocos años normales: 2 (2024, 2025) · ⚠ Tienda T10 pesa 22 % en 2026 y se aparta 14 pp de la red    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
(si bloquea, en su lugar:)
┌ No se puede calcular todavía ────────────────────────────────────────────────────────────────────────┐
│ ✖ No hay periodos atípicos para invierno. Crea los periodos del Niño 2023 y 2026 → Periodos atípicos  │
│   [ ] Confirmo que esta temporada no tiene años atípicos (se guardará con la curva)                   │
│ ✖ La tienda T04 tiene venta y no tiene fecha de apertura → Tiendas                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Curvas de la agrupación ─────────────────────────── [Participación | Unidades]  [Mostrar: ☑2023 ☑2024 ☑2025 ☑2026 ☐T ☑banda] ┐
│ 25 %┤                                        ━━━ Propuesta (A)      ─── Aprobada v2 (A)                                     │
│     │                    ╭──╮                ─── 2024   ─── 2025    ┄┄┄ 2023 (Niño completo, incluido)   ╌╌╌ 2026 parcial ene–set │
│ 15 %┤               ╭────╯  ╰───╮            ░░░ banda mín–máx      ▌ meses atípicos    • liquidación                        │
│     │          ╭────╯           ╰────╮                                                                                        │
│  5 %┤ ─────────╯                     ╰───────────                                                                             │
│     └──┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬─                                                                         │
│       Ene Feb Mar Abr May Jun Jul Ago Set Oct Nov Dic                 (lectura por mes al pasar el cursor)                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ Tabla año × mes ─────────────────────────────────────────────────────────────────────────────────────── [CSV] ┐
│ Año / fila            Ene   Feb   Mar   Abr   May   Jun   Jul   Ago   Set   Oct   Nov   Dic   Total  Tiendas  Clase          │
│ 2023 Niño · incluido  2,1   2,0   6,2  12,4  19,8  23,9  16,1   8,0   4,1   2,0   2,1   1,3   2 980   8      atípico completo│
│ 2024 normal           2,0   2,0   6,0  12,0  20,0  24,0  16,0   8,0   4,0   2,0   2,0   2,0   4 730   9      normal          │
│ 2025 normal           1,9   2,1   6,1  11,8  20,3  23,7  16,2   8,1   3,9   2,0   2,0   1,9   5 680   9      normal          │
│ 2026 parcial (Niño)   2,4   2,2   6,6  12,9  21,0  24,1  15,8   8,4   6,6    —     —     —    3 040  10      en curso        │
│ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│ Propuesta A           2,0   2,0   6,1  12,1  20,0  23,9  16,1   8,0   4,0   2,0   2,0   1,7   100 %                            │
│ Aprobada v2 (A)       2,0   2,0   6,0  12,0  20,0  24,0  16,0   8,0   4,0   2,0   2,0   2,0   100 %                            │
│ Diferencia (pp)      +0,0  +0,0  +0,1  +0,1  +0,0  −0,1  +0,1  +0,0  +0,0  +0,0  +0,0  −0,3   EAT 0,8                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Lo que propone el sistema ──────────────────────────────────┐ ┌ Efecto del Niño en esta agrupación ─────────────────────────┐
│ Propone A · Promedio simple de 2023, 2024 y 2025.           │ │ Volumen (tiendas comunes, frente al año normal más cercano) │
│ 2023 (Niño, año completo) entra tal cual: su forma difiere  │ │   2023 ×0,63 frente a 2024 (7 tiendas) · 2026 ene–set ×0,66 │
│ 31 pp de la referencia y los dos años normales difieren     │ │   frente a 2025 (9 tiendas)                                 │
│ 33 pp entre sí: estable respecto al ruido.                  │ │ Forma: 2023 difiere 31 pp · ruido 33 · umbral 33 → Estable  │
│ B se equivoca 27,4 pp frente a 29,1 de A en 3 pruebas; la   │ │   pico junio (= referencia) · 2026 parcial: 12,1 pp (red    │
│ diferencia (1,7) es menor que el ruido (33): sin evidencia  │ │   completa) / 9,4 pp (tiendas comunes con 2025)             │
│ para apartarse del promedio.                                │ │ El factor que recibirá M7 es el de la temporada → Años Niño │
│                                                             │ └─────────────────────────────────────────────────────────────┘
│ ( ) A Promedio simple     EAT 29,1 · ruido 33 (3 pruebas ▸) ★│
│ ( ) B Ponderado volumen   EAT 27,4   nota: la mayor pesa 38 %│
│ ( ) C Ponderado recencia  EAT 28,0                          │
│ ( ) D Suavizada           EAT 30,2                          │
│ ( ) E Promedio de tiendas EAT 31,5                          │
│ ( ) T Curva de la temporada (referencia, prestada)          │
│ Estabilidad: Media (0,71) · Ruido entre años normales: 33 pp│
│ (2024 frente a 2025; se muestra aunque no haya Niño)        │
└─────────────────────────────────────────────────────────────┘

┌ Parámetros de esta agrupación ───────────────────────────── [▸ plegado: "3 distintos del valor por defecto" · Restablecer] ┐
│ Años          [☑ 2023 Niño completo · incluido (auto)] [☑ 2024] [☑ 2025] [2026 parcial: solo valida]   Excluir del ajuste: ☐ ☐ ☐ │
│ Niño          Tratamiento (auto ▾)   Piso de forma [3] pp   Máximo de huecos [4]   Margen sobre el ruido [0,25]              │
│ Red           ☑ Solo tiendas completas  ☑ Exigir venta todo el año  Meses de tienda nueva [0]  Dominante [35] %                │
│               Tiendas: T01 ☑ · T02 ☑ · … · T10 ☑ (entra en 2026, 22 %) · T04 (fuera 2023: no abierta todo el año)   Excluir ☐ │
│ Pequeñas      Mínimo de unidades por año [120]   Cambio de volumen extremo [3]   Liquidación [0,15]   Calcular hasta [2026-09 ▾]│
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Aprobada frente a propuesta ────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Vigente v2 · A · aprobada el 15/10 por Javier con datos hasta 2026-08 · ▲ Obsoleta: mes publicado después: 2026-09           │
│ EAT entre ambas: 0,8 pp · el mes que más cambia: diciembre (−0,3)                                                             │
│ Nota [______________________________________________]  (obligatoria si eliges una candidata distinta de la recomendada)       │
│                                                                                  [Aprobar esta curva (A) como versión 3]      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

▸ Red comparable de esta agrupación (pesos sobre la venta de la agrupación; perfil de cada tienda frente a la agrupación; Distinta)
▸ Versiones (3): v3 vigente · A · hoy · Javier    v2 reemplazada · A · 15/10 · Javier · [Ver foto]    v1 reemplazada · B · 14/10 · nota: "…" · [Ver foto]    [Retirar la vigente]
```

Comportamiento: el `radio` de candidatas cambia la serie "Propuesta" del gráfico, la fila de la tabla y el comparador (sin llamar al servidor: todas las candidatas vienen en `resultado`); cualquier cambio en Parámetros vuelve a pedir `calcular` (debounce 300 ms, `signal` para cancelar) y muestra "Recalculando…" sin vaciar el gráfico; el botón Aprobar queda deshabilitado mientras recalcula, si bloquea algún prerrequisito, si la agrupación está inactiva o si la candidata elegida no tiene curva. "Ver foto" abre `GET /api/curvas/corridas/[foto]/agrupaciones/[id]` en un `Modal` de solo lectura con la cabecera "Foto del 15/10/2026 10:42 · datos hasta 2026-08 · parámetros de ese momento".

### Pestaña Años Niño (vista de apoyo)

Como en la 06 pero sin corrida: botón **Calcular efecto por temporada** (o automático al entrar, con "Calculando…") que llama a `GET /api/curvas/anios-atipicos`; cabecera "Calculado ahora con los datos hasta 2026-09"; bloques Volumen (tabla de ratios con control y relativo, lectura generada), Forma (por agrupación: requiere abrir cada una; aquí se muestra solo lo agregado por temporada que la función devuelve: `forma` con conteos no está disponible sin calcular cada agrupación, así que el bloque Forma lista las agrupaciones de la temporada con "Ver" → Trabajar), **Lo que recibirá M7** (factor por temporada y año con "N agrupaciones", crecimiento normal, CSV, nota "calculado a demanda; M7 guarda el valor que use y puede editarlo") y avisos. Sin "Marcar como referencia".

### Pestaña Periodos atípicos

Sin cambios de fondo. El pie dice: "Cambiar un periodo no recalcula nada: las curvas aprobadas afectadas se marcan obsoletas (`periodo_cambiado`) y las agrupaciones de invierno y verano no se pueden calcular sin al menos un periodo para su temporada (o la confirmación explícita)". La tarjeta "Años marcados como atípicos" deja de mostrar `ratio_volumen` (es de la pestaña Años Niño).

## Reglas de negocio

Se mantienen las reglas 1 a 29 de la 06 salvo donde se indica; las nuevas continúan la numeración. Todas con vitest sobre fixtures sintéticos salvo la 30 (SQL de humo) y 31 (estático).

**`prerrequisitos.ts`**

32. `prerrequisitosAgrupacion`: con el fixture base y sin periodos, ABRIGO (invierno) → `bloquea: [periodos_temporada_faltantes]`; con `sin_periodos_confirmado = true` → pasa a `avisa`; PEQUEÑA (`todo_el_ano`) sin periodos → no bloquea; una tienda `Tienda` activa con venta y `fecha_apertura = null` → `tienda_sin_apertura` bloquea (una tienda sin venta y sin apertura no bloquea); sin ningún año con 12 meses publicados → `sin_anio_completo`; agrupación con 0 unidades positivas → `sin_venta`; 0 equivalencias → `composicion_vacia`; `todo_el_ano` sin versiones → `avisa: temporada_sin_confirmar`; con una versión aprobada, no; huecos en la serie → `meses_sin_cargar` con la lista; cada código se prueba por separado y el orden de `bloquea` es estable.
33. Los prerrequisitos globales de `GET /api/curvas` son la unión de los que no dependen de la agrupación (`armarPrerrequisitosGlobales`), y `bloqueada_por` de cada fila solo contiene los evaluables sin venta (`periodos_temporada_faltantes`, `composicion_vacia`, `tienda_sin_apertura`).

**`huellas.ts`**

34. `huellaCalculo` cambia si cambia cualquiera de: un `carga_id`, el maestro de tiendas (fecha, activo, tipo), la composición, la temporada, `hasta_periodo`, un periodo aplicable (rango o alta/baja), cualquier parámetro (incluidos `anios_excluidos` y `tiendas_excluidas`, insensibles al orden); no cambia si cambia el nombre de una tienda o un periodo que no aplica a la temporada.

**`entrada.ts` y `modelo.ts`**

35. `armarEntradaAgrupacion`: con la forma `{ agrupacion, temporadas, meses_publicados }` del fixture, la venta total por tienda es la suma de `temporadas` (incluida `sin_agrupacion`), la red comparable coincide con la que daba `armarEntradaCorrida` sobre el agregado completo (mismo fixture, misma red: 2023 → T1; 2024 → T1, T4; 2025 → T1, T2, T4; 2026 → T1, T2, T3, T4), y `series_temporada` lleva una entrada por temporada presente.
36. `calcularCorrida` con una sola agrupación y `series_temporada`: la `curva_T` de su temporada es la de la serie agregada (con ABRIGO y una segunda agrupación de invierno en la serie agregada 1:3, `T` está más cerca de la grande, como la regla 11b) y **no** la `A` de la agrupación; sin `series_temporada` el comportamiento es el de hoy (los tests de la 06 siguen pasando sin cambios).
37. `anios_excluidos = [2024]`: 2024 sale `tratamiento = 'descartado'`, `tratamiento_motivo = 'excluido_manual'`, `en_ajuste = false`, aviso `anio_excluido`; las candidatas se ajustan sin él; su `ratio_volumen` (si era atípico) se sigue midiendo; excluir todos los años de ajuste → `pocos_anos_ajuste` y `T`.
38. `tiendas_excluidas = [T1]`: T1 `entra = false` con motivo `excluida_manual` en todos los años, antes de evaluar fechas y datos; los pesos se reparten entre las demás; `huellaRed` no cambia (la exclusión es parámetro, no maestro).
39. Determinismo con huella: dos llamadas con la misma `huella_calculo` dan `resultado` idéntico (JSON igual); cambiar una unidad en un mes publicado cambia la huella.

**`estado.ts` y `reglas.ts`**

40. `estadoDeAgrupacion`: sin vigente → `sin_curva`; vigente con motivos → `obsoleta`; vigente sin motivos y `recomendada` → `al_dia`; vigente sin motivos y `recomendada = false` → `al_dia_distinta`; inactiva con vigente → `inactiva_con_curva` (gana a los demás). `resumen.sin_curva + con_curva_vigente = agrupaciones_activas`.
41. `motivoRechazoAprobar`: inactiva → `409 agrupacion_inactiva`; algún `bloquea` → `409 prerrequisitos` (con la lista); candidata sin curva o `T` sin `curva_T` → `409 candidata_no_disponible`; `huella_calculo` enviada ≠ recalculada → `409 datos_cambiados`; vigente con el mismo `modelo` y la misma `huella_calculo` → `409 sin_cambio`; `modelo ≠ recomendada` y nota vacía → `409 nota_requerida`; si no, `null`.
42. `filaCurva`: `anios_utilizados` lleva además `huella_calculo`, `recomendada_entonces`, `anios_excluidos`, `tiendas_excluidas` y `sin_periodos_confirmado`; `corrida_id` es el id de la foto; `version = anterior + 1`; `huellasDeCurva` sigue devolviendo las tres huellas (contrato de M7 intacto).
43. `versionesDeAgrupacion(filas)`: ordenadas por `version desc`; a lo sumo una `vigente`; `foto_id = corrida_id`; `parametros_resumen` lista solo los parámetros distintos del valor por defecto.

**`esquemas.ts`**

44. `calcularAgrupacionSchema` aplica los defectos de la 06, rechaza `marcar_referencia` (clave desconocida según la convención de `leerCuerpo`), acepta `anios_excluidos` (enteros 2000–2100, ≤ 20) y `tiendas_excluidas` (uuid, ≤ 100); `aprobarCurvaSchema` exige `huella_calculo` de 32 hex y `parametros` completos; **no existen** `elegirCurvaSchema`, `marcarReferenciaSchema` ni `aprobarSchema` (estático).

**Hallazgos de QA (Q1, Q2, Q3, Q6)**

47. `serieDeAnio` y `celdaAnioMes`: un año `descartado` (por tratamiento o `excluido_manual`) con `participacion_real` produce serie y celdas (gris, `porDefecto = false`); un año `imputado` dibuja `participacion` con los meses imputados punteados y la tabla muestra la real en `title`; un año `sin_red_comparable` o sin volumen devuelve `null` y la tabla lo lista con "—" y el motivo; con el fixture "forma corrida" (2023 descartado) el gráfico tiene cuatro series, no tres.
48. `ruidoNormalAgrupacion(anios)`: EAT entre las participaciones reales de los años `normal` completos y no escasos; `null` con menos de dos; con tres o más, promedio de los pares y `ruido_normal_detalle = [{ anios: [2024, 2025], eat }]`; PEQUEÑA (`todo_el_ano`, sin periodos) con 2024 y 2025 normales tiene `ruido_normal` no nulo aunque `efecto_atipico.forma` sea `null`; en ABRIGO coincide con `efecto_atipico.forma.ruido_normal`; `recomendar` recibe este valor (el margen de empate ya no depende de que exista un periodo); `textoConfirmarAprobacion` dice "no medible" solo cuando es `null`.
49. `motivosObsoleta` con `hasta_periodo`: `carga_nueva` solo considera meses `≤ guardado.hasta_periodo` (nuevo campo de `EstadoGuardado`); un mes publicado posterior produce `datos_posteriores` (aviso, no motivo) salvo que `actual.hasta_por_defecto > guardado.hasta_periodo`, en cuyo caso sí es `carga_nueva` ("mes publicado después y ya cerrado: 2026-09"); recalcular con el `hasta` nuevo y aprobar deja `motivos = []`; republicar un mes `≤ hasta` con otro `carga_id` sigue siendo `carga_nueva`.
50. `sin_venta` y prestadas: `prerrequisitosAgrupacion` bloquea `sin_venta` cuando ninguna serie de unidades sobre la red tiene un mes positivo; con venta y `origen = 'prestada'` la aprobación de `T` está permitida y la fila cuenta en `con_curva_vigente` y `vigentes_prestadas`; con `origen = null` (ni propias ni `T`) `motivoRechazoAprobar` devuelve `409 sin_curva_posible`; el resumen cumple `activas = al_dia + al_dia_distintas + obsoletas + sin_curva` y `sin_curva = bloqueadas + calculables_sin_curva`.

**SQL y estático**

45. **SQL (humo local)**: la `0017` aplica dos veces sin error y sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; `venta_estacionalidad_agrupacion(null)` devuelve `agrupacion = null` y `temporadas` cuya suma por tienda y mes coincide con `venta_mensual_tienda()` y cuya suma por mes coincide con `unidades_mensuales()`; con un id, `agrupacion` suma lo mismo que `unidades_mensuales(sus equivalencias)` por mes; las equivalencias sin agrupación o con agrupación inactiva salen como `sin_agrupacion`; `anon` y `authenticated` no pueden ejecutarla; `corridas_estacionalidad.agrupacion_estacionalidad_id` admite nulo, rechaza un id inexistente y bloquea el borrado de la agrupación (`restrict`); se anota la **duración** de la función con y sin id sobre la base real (objetivo < 2 s).
46. **Estático**: no existen `src/app/api/curvas/calcular`, `src/app/api/curvas/corridas/route.ts` ni `src/app/api/curvas/corridas/[id]/route.ts`; existen `…/agrupaciones/[id]/calcular/route.ts` y `…/agrupaciones/[id]/versiones/route.ts`; solo `consultas.ts` nombra `venta_estacionalidad_agrupacion`; **ningún archivo de `src/` nombra** `venta_mensual_estacionalidad`, `refrescar_venta_mensual_estacionalidad`, `refrescar_y_leer_agregado_estacionalidad` ni `referencia` de corridas; `prerrequisitos.ts`, `modelo.ts`, `red.ts` y `obsolescencia.ts` no importan de `@supabase/*` ni de React; toda ruta de M6 usa `requirePlanner`; la `0017` no contiene `drop`, `delete`, `truncate` ni `update` fuera de comentarios.

## Casos de prueba sintéticos

Mismo fixture `tests/curvas.fixture.ts` de la 06 (ABRIGO SINTÉTICO de invierno, VERANO SINTÉTICO, PEQUEÑA de toda temporada; tiendas T1 a T4 y CD; los cuatro periodos confirmados), reescrito en la forma `{ agrupacion, temporadas, meses_publicados }` con una función `fixtureVentaEstacionalidad(agrupacionId)` que la deriva de las series existentes (así los casos 1 a 12 de la 06 se reejecutan por agrupación con los mismos resultados esperados: participación 2024 de ABRIGO, red por año, volumen 0,65, forma estable/corrida, verano imputado, recomendación relativa, obsolescencia a–f, determinismo). Casos nuevos:

13. **Prerrequisitos**: fixture sin periodos → ABRIGO bloqueada (`periodos_temporada_faltantes`), PEQUEÑA no; con la casilla de confirmación, ABRIGO calcula y 2023 sale `normal` (sin atípicos) con el aviso en `avisa`; T4 con `fecha_apertura = null` y venta → bloquea las tres agrupaciones con enlace a Tiendas; quitar 2024-05 de los publicados → `meses_sin_cargar` avisa, 2024 `incompleto`, y con 2023 también incompleto y 2025 normal → sigue calculando (un año completo basta para no bloquear) pero `pocos_anos_ajuste` y `T`.
14. **Tres curvas en la vista**: ABRIGO con vigente v1 = `A` del fixture base: `calcular` devuelve `vigente.curva`, `resultado.anios[].participacion_real` (4 años) y `comparador` con `eat_vs_vigente = 0` y `difiere = false`; pedir `?modelo=B` cambia el comparador a `B` sin cambiar `resultado`.
15. **Parámetros que recalculan**: con `tiendas_excluidas = [T3]`, la red de 2026 pasa a T1, T2, T4 y la forma parcial de 2026 (red completa) se acerca a la de tiendas comunes; con `anios_excluidos = [2023]` sobre el fixture base, las candidatas coinciden con las de `tratamiento_atipicos = 'descartar'`; con `meses_tienda_nueva = 12`, T3 `tienda_nueva` en 2026.
16. **Aprobar con huella**: `calcular` → `huella_calculo = h`; `PUT` con `h` y `modelo = A` → `201`, foto con `agrupacion_estacionalidad_id`, curva v1 con `corrida_id = foto.id`; publicar un mes en el fixture y repetir el `PUT` con `h` → `409 datos_cambiados`; `PUT` de `B` sin nota → `409 nota_requerida`; con nota → v2 `recomendada = false`; `PUT` de `A` con la misma huella que la v1 (fixture sin cambios) → `409 sin_cambio`.
17. **Estados de la lista**: tras 16, ABRIGO `al_dia`; tras aprobar `B` con nota, `al_dia_distinta` con `recomendada_entonces = "A"`; tras publicar un mes, `obsoleta` (`carga_nueva`); PEQUEÑA sin curva, `sin_curva`; desactivar ABRIGO → `inactiva_con_curva`; sin periodos en el fixture, ABRIGO y VERANO `bloqueada_por: ["periodos_temporada_faltantes"]` y PEQUEÑA `[]`.
18. **Versiones y foto**: `versiones` de ABRIGO lista v2 vigente, v1 reemplazada con sus `foto_id`; `GET /api/curvas/corridas/[foto v1]/agrupaciones/[ABRIGO]` devuelve el resultado congelado (los años de entonces) aunque el fixture tenga ya un mes más; con el id de otra agrupación → `404`.
19. **Años Niño a demanda**: `anios-atipicos` sobre el fixture con las tres agrupaciones reproduce `por_temporada[2023, invierno] = 0,65 / control 1 / relativo 0,65` y `verano 1,46` (caso 1f de la 06) sin ninguna corrida en la base; `/anios?temporada=invierno&con_volumen=1` devuelve `ratio_volumen` y `corrida_id: null`; sin `con_volumen`, `ratio_volumen: null` y no llama a la función de venta (espía).
20. **Determinismo y rendimiento**: diez llamadas a `calcular` con la misma entrada dan el mismo `huella_calculo` y el mismo `resultado`; `calcularCorrida` sobre una agrupación con 4 años y 10 tiendas tarda < 50 ms (test de humo local, no de CI).
21. **Todos los años visibles (Q1)**: fixture "forma corrida" → `construirSeries` devuelve 2023 (gris, apagada), 2024, 2025 y 2026; `filasCsvAnioMes` incluye 2023 con su participación real; con `anios_excluidos = [2024]`, 2024 sigue en el gráfico en gris.
22. **Ruido sin Niño (Q2)**: PEQUEÑA con 2024 = 2025 × 1,2 → `ruido_normal = 0`; con abril y junio intercambiados en 2025 → ≈ 24 pp; el `confirm` de PEQUEÑA muestra "ruido entre años normales: 24"; `efecto_atipico.forma` sigue `null`.
23. **Obsolescencia por mes posterior (Q3)**: curva aprobada con `hasta = 2026-08`; publicar 2026-09 en el fixture con `hoy` tal que 2026-09 no está cerrado → `datos_posteriores`, sin motivos; con `hoy` que lo cierra → `carga_nueva`; reaprobar con `hasta = 2026-09` → sin motivos; republicar 2024-03 → `carga_nueva` en ambos casos.
24. **Sin venta y prestada (Q6)**: una cuarta agrupación VACÍA sin filas → `sin_venta` bloquea y `PUT` responde `409 prerrequisitos`; PEQUEÑA (prestada) → `PUT` de `T` responde `201` con `origen = 'prestada'`; si la temporada entera queda sin años → `409 sin_curva_posible`.
25. **Formato (Q4)**: ninguna `frase`, `detalle` de aviso ni motivo de obsolescencia generado por `modelo.ts`, `obsolescencia.ts` o `prerrequisitos.ts` contiene un número con punto decimal; `formatearPuntos` y `formatearPp` dan el mismo texto para 27,43.

## Hito de prueba (para recorrer con Cowork, usuario planner; nada se escribe salvo en los pasos marcados ✍️)

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build` y `scripts/validar-migraciones-local.sh` en verde; `0017` aplicada en `vector-two` (la `0015` y la `0016` se verifican, no se reaplican); tipos regenerados (`agrupacion_estacionalidad_id` en `corridas_estacionalidad`, `venta_estacionalidad_agrupacion` bajo `Functions`); `APP_VERSION = 0.9.7 · M6`; PLAN, DECISIONES, CHANGELOG, la ficha 06 (nota de cabecera) y `docs/pruebas/cowork-checklist.md` (sección D reescrita con lo de abajo) actualizados.

**Prerrequisitos de Javier** (los mismos de la 06): faltantes de M3 en cero; fechas de apertura y cierre en M4; las 10 agrupaciones de toda temporada revisadas; ✍️ los cuatro periodos del Niño creados (la pantalla no deja calcular invierno ni verano sin ellos).

**Recorrido**

1. [ ] Roles: el comprador no ve el menú y recibe `403` en toda la API de M6; `POST …/calcular` y `PUT` con comprador → `403`.
2. [ ] **Lista sin periodos** (antes del paso ✍️): la pestaña Agrupaciones abre primero; arriba el aviso "No hay periodos atípicos para invierno (4) ni verano (1)"; las 5 filas marcan "Bloqueada: sin periodos"; las 10 de toda temporada, "Sin curva"; no existe ninguna tarjeta Calcular, selector de corridas ni botón de referencia.
3. [ ] **Trabajar una de invierno sin periodos**: abre la vista, muestra la tarjeta "No se puede calcular todavía" con el enlace a Periodos atípicos y la casilla de confirmación; sin gráfico; marcar la casilla calcula y 2023 sale "normal" con el aviso (se desmarca después; no aprobar).
4. [ ] ✍️ Crear los cuatro periodos con los atajos. Volver a la lista: las 5 filas pasan a "Sin curva".
5. [ ] **Trabajar una de toda temporada** (datos reales, cifras agregadas): la vista aparece en **menos de 3 s** (anotar `duracion_ms` de la cabecera y el tiempo total percibido); se ven 2023, 2024 y 2025 continuas, 2026 discontinua hasta setiembre, la propuesta gruesa y la banda; **no hay aprobada** (fila "Aprobada" ausente); la tabla año × mes suma 100 % por año y sus unidades coinciden con la suma de la red (no con el histograma crudo de M11); la frase de recomendación se lee entera; el `radio` cambia la propuesta sin llamar al servidor; el aviso "Sigue en Toda temporada: confirma la temporada" aparece.
6. [ ] **Trabajar una de invierno**: red 8 · 9 · 9 · 10; 2023 "Niño completo" con su tratamiento y las tres cifras del veredicto; 2026 parcial con las dos formas; volumen 2023 y 2026 sobre tiendas comunes; T10 (la tienda nueva) con su peso en 2026 y, si aplica, "Distinta".
7. [ ] **Parámetros**: excluir T10 de la red → recalcula en < 3 s, la red de 2026 baja a 9 y la curva parcial de 2026 cambia; "Restablecer" vuelve; excluir 2023 del ajuste → las candidatas cambian y 2023 queda en gris; el chip cuenta los parámetros distintos del valor por defecto.
8. [ ] ✍️ **Aprobar** en una agrupación de toda temporada la recomendada: `confirm` con agrupación, temporada, candidata, años, EAT frente al ruido y avisos; "Curva A aprobada como versión 1"; la vista muestra la fila "Aprobada v1" igual a la propuesta (diferencia 0,0) y la lista "Al día · v1".
9. [ ] ✍️ **Aprobar otra candidata** en la misma agrupación sin nota → mensaje "nota requerida"; con nota → v2, la lista "Al día · distinta de la recomendada (A)", y en Versiones v1 "reemplazada" con "Ver foto" que abre el detalle congelado.
10. [ ] **Datos cambiados**: dejar abierta una agrupación, en otra pestaña cambiar su temporada (o una fecha de tienda en M4 y revertirla), volver y pulsar Aprobar → `409 datos_cambiados` legible y recarga; la lista marca **Obsoleta** con el motivo; "Comparar con el sistema" llena la columna Sistema hoy sin crear nada en la base (`select count(*) from corridas_estacionalidad` no cambia).
11. [ ] ✍️ **Las 15 una por una**: Javier recorre cada agrupación, revisa, ajusta si hace falta y aprueba; al final `select count(*) from curvas_estacionalidad where estado = 'vigente'` = 15 y `select count(*) from corridas_estacionalidad where agrupacion_estacionalidad_id is not null` = número de aprobaciones; "Sin curva" = 0; sin aprobación en bloque en ningún sitio.
12. [ ] **Años Niño**: calcular a demanda reproduce sobre tiendas comunes las cifras de la 06 (invierno 2026 ene–set ≈ 0,66, verano 2026 ≈ 1,24, toda temporada ≈ 0,975; 2023: invierno ≈ 0,63, verano ≈ 0,73, toda temporada ≈ 0,95); "Lo que recibirá M7" descarga CSV; `/anios?temporada=invierno&con_volumen=1` devuelve el mismo `ratio_volumen` con `corrida_id: null`.
12b. [ ] **Hallazgos de QA**: en una agrupación de invierno con 2023 descartado (forzar `tratamiento = descartar`), 2023 sigue visible en gris y en la tabla; en una de toda temporada el ruido entre años normales aparece junto al EAT y en el `confirm`; tras aprobar con datos hasta 2026-09, la lista no marca Obsoleta por un mes posterior no cerrado (si lo hubiera) sino "datos posteriores"; recargar el navegador con `?agrupacion=<id>` reabre la misma vista; todas las cifras se leen con coma decimal.
13. [ ] `GET /api/curvas/vigentes` devuelve 15 filas con `curva` (suma 1), `acumulada`, `version`, `curva_id` y huellas (contrato con M7 intacto); el CSV abre en Excel.
14. [ ] **Validación de negocio (Javier)**: en cinco agrupaciones conocidas, la curva aprobada se parece a la del Excel de planeamiento; donde difiere, la tabla año × mes, la red comparable y los parámetros explican por qué; se anota qué parámetro la acerca y si alguna curva "aprobada distinta de la recomendada" tiene su nota.

## Qué se reutiliza y qué se descarta

**Se conserva sin cambios**: `src/lib/curvas/` `red.ts`, `candidatas.ts`, `backtesting.ts`, `efecto.ts`, `atipicos.ts`, `anios.ts`, `liquidacion.ts`, `huellas.ts` (más `huellaCalculo`), `obsolescencia.ts`, `grafico.ts`, `tipos.ts`, `agregado.ts` (más la forma nueva), `reglas.ts` (`filaCurva`, `armarComparador`, `aVigenteResumen`, `aCurvaVigente`, `huellasDeCurva`), `esquemas.ts` (periodos, `calcularSchema` como base, `leerConsultaRed`), `consultas.ts` (periodos, agrupaciones, tiendas, cargas, curvas, corridas por id), `lectura.ts` (`leerObsolescencia`, `errorConCodigo`); rutas `GET /api/curvas/vigentes`, `GET /api/curvas/red-comparable`, `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]`, `DELETE /api/curvas/agrupaciones/[id]`, todo `/api/periodos-atipicos*`; componentes `grafico-curvas`, `mini-curva`, `series.ts`, `candidatas-tabla`, `comparador-curvas`, `tabla-anio-mes`, `efecto-nino-detalle`, `red-comparable`, `red-panel`, `periodos-tab`, `formulario-periodo`, `anios-atipicos-card`, `parametros-form.ts`, `vista.ts` (textos, filtros, CSV), `use-recurso`, `meses.ts`, `atajos.ts`; migraciones `0011`, `0015` y `0016` tal como están; las 2 119 pruebas salvo las que prueban lo retirado.

**Se extiende**: `modelo.ts` (`series_temporada`, `anios_excluidos`), `red.ts` (`tiendas_excluidas`), `entrada.ts` (`armarEntradaAgrupacion`), `estado.ts` (estados sin corrida), `tipos-api.ts` (tipos nuevos; `MOTIVOS_RED` + `excluida_manual`; `CODIGOS_AVISO` + `anio_excluido`; `MOTIVOS_PRERREQUISITO`), `detalle-agrupacion.tsx` (pasa a ser la vista de trabajo con parámetros, prerrequisitos y versiones), `curvas-tab.tsx` (lista v2), `curvas-panel.tsx` (sin corrida seleccionada), `anios-nino-tab.tsx` (a demanda).

**Se retira**: `POST /api/curvas/calcular`, `GET /api/curvas/corridas`, `GET`/`PATCH /api/curvas/corridas/[id]`, `calcular-card.tsx`, el selector de corridas, "Marcar como referencia", `resolverCorrida`, `corridaDeReferencia`, `planificarReferencia`, `marcarReferencia`, `quitarReferencia`, `refrescarYLeerAgregado`, `leerCorridasLista`, `leerMarcasDeCorridas`, `leerCorridaReferencia`, `leerUltimaCorrida`, `elegirCurvaSchema`, `marcarReferenciaSchema`, `motivoRechazoElegir` (sustituido), y sus tests. En la base, **nada se borra**: la corrida global de la `0.9.6` queda como historial con `agrupacion_estacionalidad_id` nulo, `referencia` y la MV quedan sin uso y comentadas.

## Riesgos

- **Tiempo de la función SQL**: un agregado completo de `venta_stock_vigente` por apertura de agrupación. Mitigación: objetivo medido en el hito (< 2 s la función, < 3 s la vista); reserva: la misma función sobre la MV con refresco por huella de cargas (`0018`), sin tocar la API. El agregado de la agrupación va por índice y no es el problema.
- **Cálculo repetido al mover parámetros**: cada cambio es una llamada completa (lectura + modelo). Mitigación: debounce y cancelación; si molesta, cachear la lectura `jsonb` en memoria del servidor unos segundos por `huella_cargas` (fuera de alcance hasta medir).
- **"Comparar las obsoletas con el sistema" encadena N cálculos** desde el navegador: 15 × ~2 s. Es la forma por agrupación aplicada N veces, cancelable, sin escribir; nunca es obligatorio.
- **Prerrequisito de periodos bloqueante**: puede frenar a un planner que sabe que una temporada no tuvo Niño. Por eso existe la casilla de confirmación, que queda en la foto.
- **Sin transacción al aprobar**: una foto sin curva o una curva reemplazada sin sustituta son visibles y se reparan repitiendo; mismo riesgo que en la 06, un paso más (la foto).
- **Determinismo como base del estado "al día"**: cualquier dependencia del modelo que no entre en la huella (por ejemplo, el reloj en `hastaPorDefecto`) rompería la lectura; por eso `hasta_periodo` efectivo entra en la huella y el modelo no lee el reloj (06, regla 19).
- **Objetos sin uso en la base** (MV, funciones de refresco, `referencia`): no se pueden borrar por la regla de migraciones; quedan documentados con `comment on` y cubiertos por el test estático de que nadie los nombra.

## Fuera de alcance

- Guardar cada cálculo que se mira (solo se guarda la foto al aprobar); recálculo automático al cambiar los datos (solo `obsoleta` con motivo); aprobación en bloque; notificaciones.
- Cachear la lectura de venta en el servidor; la variante de la función sobre la MV (`0018`, solo si la medición lo exige).
- Curvas por tienda o por grupo de tiendas (M6b en el sentido de la 06: el diagnóstico `tienda_distinta` sigue siendo la evidencia); candidatas `G`/`H`, `medida = venta_soles`, CV % por línea, mediana por mes, modelos con tendencia.
- Edición del factor de volumen del Niño (M7); mezcla de curvas por GML (`curvaUnidad`, M7); proyección del resto del año (M7).
- Un historial de "quién miró qué" (auditoría general).

## Decisiones nuevas propuestas (para `docs/DECISIONES.md`, fecha 2026-10-15)

23. **La unidad de trabajo de M6 es una agrupación de estacionalidad.** La pantalla lista agrupaciones con su estado y se trabaja una por una: curva aprobada vigente, curva de cada año y propuesta del sistema en el mismo gráfico y la misma tabla, con la diferencia mes a mes. Javier, 2026-10-15. Descartado: la corrida global con tabla de propuestas (construida en `0.9.6`, sustituida).
24. **El cálculo es a demanda y no se guarda; se guarda la foto de cada aprobación.** Una función SQL `jsonb` filtrada por agrupación (`venta_estacionalidad_agrupacion`) sustituye a la MV y al candado; la foto reutiliza `corridas_estacionalidad` con `agrupacion_estacionalidad_id`; la curva apunta a su foto y M7 no cambia. Descartado: guardar cada cálculo visto; una tabla nueva de fotos; seguir refrescando la MV.
25. **Antes de calcular se comprueban los prerrequisitos de la agrupación y se bloquea con motivo** cuando falta lo imprescindible (periodos para invierno o verano, tienda con venta sin apertura, ningún año completo, sin venta, sin composición); el planner puede confirmar explícitamente "sin años atípicos" y esa confirmación queda en la foto. Descartado: calcular siempre y solo avisar (es lo que permitió calcular con cero periodos).
26. **La aprobación lleva la huella del cálculo** que el planner vio; el servidor recalcula y rechaza con `409 datos_cambiados` si la entrada cambió. Descartado: aprobar por `corrida_id`.
27. **El estado de la lista se deriva de las huellas y del determinismo del modelo**, sin corrida: al día, al día pero distinta de la recomendada, obsoleta con motivo, sin curva; "Comparar con el sistema" calcula a demanda y no escribe. Descartado: una corrida de referencia.
28. **El factor de volumen del Niño para M7 se calcula a demanda** por temporada (misma función sin agrupación) y M7 guarda el valor que use; `corridas_estacionalidad.referencia` y la MV quedan sin uso, documentadas, nunca borradas. Descartado: borrar objetos en una migración.
29. **Los parámetros son por agrupación**, incluidos `anios_excluidos` y `tiendas_excluidas`; los de la última aprobación son el punto de partida al reabrir. Descartado: parámetros globales; exclusión de tiendas como maestro.

30. **Hallazgos de QA de la `0.9.6` como requisitos del rediseño**: todos los años con red se dibujan (`participacion_real ?? participacion`); el ruido entre años normales se calcula a nivel de agrupación y se muestra siempre junto al EAT; `carga_nueva` solo mira meses hasta el `hasta` de la curva y reaprobar la limpia; una sola definición de `sin_venta`; la agrupación abierta va en la URL; formato `es-PE` compartido entre servidor y pantalla.

## Cambios que el documentador debe integrar al construir

- `docs/PLAN.md`: §4 fila de M6 (flujo por agrupación, `0017`, función SQL, foto de aprobación, MV sin uso) y tabla de tablas (`corridas_estacionalidad.agrupacion_estacionalidad_id`; "MV y `referencia` sin uso desde `0.9.7`"); §5 M6 "Paso 2 construido en `0.9.6`; rediseño de flujo `0.9.7` (06b)"; §7 pendientes de Javier (prerrequisitos y preguntas de abajo).
- `docs/DECISIONES.md`: entradas 23 a 29; nota en la 19 (lectura atómica del agregado) y la 22 (referencia): "sustituidas por 06b el 2026-10-15".
- `docs/CHANGELOG.md`: `0.9.7 · M6`; `src/lib/version.ts`; `docs/pruebas/cowork-checklist.md` sección D.
- `docs/modulos/07-proyeccion-anual.md`: la nota de M6 pasa a decir "factor por temporada calculado a demanda (`/anios?con_volumen=1`), sin corrida de referencia".

## Preguntas abiertas para Javier (con recomendación)

1. **Periodos del Niño como prerrequisito bloqueante.** Una agrupación de invierno o verano sin ningún periodo atípico cargado para su temporada **no se calcula** (hay una casilla "Confirmo que esta temporada no tiene años atípicos" que lo levanta y queda registrada). ¿Bloquear así, o solo avisar? **Recomendación: bloquear** (es lo que faltó en la `0.9.6`; la casilla cubre el caso legítimo).
2. **Toda temporada sin confirmar.** No podemos distinguir una agrupación que revisaste y es de toda temporada de una que nadie revisó. Propuesta: aviso "Sigue en Toda temporada" hasta la primera aprobación (el `confirm` repite la temporada; aprobar la confirma). ¿Prefieres que la primera aprobación de una agrupación de toda temporada exija marcar "Confirmo la temporada"? **Recomendación: aviso sin casilla**, para no añadir un clic a 10 agrupaciones.
3. **Nota obligatoria al apartarse de la recomendación.** Si apruebas una candidata distinta de la que el sistema propone, el sistema exige una nota (queda en la versión y en la lista como "distinta de la recomendada"). ¿Obligatoria u opcional? **Recomendación: obligatoria** (es el único rastro de por qué la curva no es la del modelo).
4. **Exclusión manual de años y tiendas por agrupación.** Se añaden "Excluir del ajuste" por año y "Excluir" por tienda como parámetros de esa agrupación, guardados en la foto y reutilizados al reabrirla. ¿Lo quieres así, o prefieres que cada apertura parta siempre de los valores por defecto? **Recomendación: partir de los parámetros de la última aprobación**, con "Restablecer" a la vista.
5. **"Comparar las obsoletas con el sistema" desde la lista.** Calcula a demanda cada agrupación obsoleta (o todas), una tras otra, y muestra la propuesta de hoy y la diferencia sin aprobar nada ni guardar. ¿Lo quieres en la lista, o solo dentro de cada agrupación? **Recomendación: en la lista**, para ver de un vistazo cuáles merecen reabrirse cuando entre un mes nuevo o una tienda cumpla su primer año.

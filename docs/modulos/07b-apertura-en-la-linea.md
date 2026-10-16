# 07b · Apertura editable en el detalle de la línea y marcas representativas por agrupación

> Estado: **construida en `0.10.7 · M7`** (2026-10-16), commits `M7:`. Mejora de M7 sobre `0.10.6`. **Sin migración** (la `0023` queda libre). Depende de [07-proyeccion-anual](07-proyeccion-anual.md) (§4 pasos 2 y 3, §5 paso 4, §6.4 a 6.6, §7 y "Cambios 0.10.1", punto 4). Sin datos reales: la tienda nueva del ejemplo es "Tienda nueva B" (T12, abre en 2027). La ficha se escribió el mismo día con dos reglas del arquitecto que Javier cambió antes de construir; lo que sigue describe lo construido y marca los cambios en "Cambios respecto a la especificación" y en "Cambios posteriores a QA/seguridad (0.10.7)".

## 1. Objetivo y alcance

Antes de `0.10.7`, en Por línea, la tabla «Filas de la línea (GML × agrupación de marca)» solo mostraba y editaba las filas base (`tienda_id = null`). La apertura de la línea aparecía como una frase de texto y solo se movía desde la pestaña Tiendas nuevas y cierres, entre las ~400 filas de la tienda. Ahora (a) la misma tabla muestra y deja editar una fila por agrupación de marca de cada tienda nueva de la línea, con el mismo campo y ✓ que las demás; y (b) debajo hay un gráfico con las **3 marcas de más peso** de cada agrupación de marca de la línea, más «Otras», con su % real, y el reparto de la apertura con esa composición.

**Entra:** tiendas del bloque `nuevas` (aperturas y nuevas del año anterior) en los dos años. **No entra:** cierres (siguen como texto, solo lectura), el detalle `&fila=` de una fila de tienda, la creación de filas de tienda que no existen y la decisión por marca.

## 2. Decisiones de Javier (no se reabren)

1. El volumen se decide por GML × agrupación de marca; las marcas son desglose, no decisión (07 §2.1). El reparto por marca de este gráfico es **solo dato**: no se guarda.
2. Ninguna recomendación automática reemplaza la decisión del planner (08-09, decisión 33).
3. Orden de las agrupaciones: el del catálogo `agrupaciones_marca.orden` (PREMIUM → ULTRA LOW, `0.10.5`, `ordenMarcaDe`).
4. Las marcas representativas son las 3 que más unidades venden en esa línea y agrupación en los **últimos 12 meses de las mismas tiendas** («su peso en la línea»), con su % de unidades.
5. **«Solo se mueve lo modificado»** (respuesta a la pregunta 1 de la ficha): al fijar una fila de una tienda con total decidido, el total de la tienda se mueve en lo que cambió esa fila y ninguna otra fila se toca. No hay pregunta ni opción: es el único comportamiento.
6. **3 marcas más «Otras» con su % real** (respuesta a la pregunta 2): el reparto suma 100 % sin reescalar ni inventar. Se descartó mostrar solo las 3 reescaladas.

Las decisiones 5 y 6 quedan en `docs/DECISIONES.md` (2026-10-16) y como 49 a 53 de `08-09-definiciones-del-dueno.md`.

## 3. Cómo funcionaba antes (lo que se reutiliza)

- **Filas de tienda:** cada tienda nueva tiene sus propias filas en `proyeccion_filas` (`tienda_id` no nulo, misma `gml_id`, `equivalencia_id` y `agrupacion_marca_id` que la base) con un registro por año en `proyeccion_fila_anios` (`bloque = nuevas`). El universo es la composición del referente (o de la red) ∪ la venta propia (`calculo.ts`): **puede faltar la fila de una agrupación** si el referente no la vende.
- **Edición de una fila de tienda:** `PUT …/filas/[filaId]/anios/[anio]` (`decidirFila`) ya la aceptaba: fija la fila y llama a `propagarTienda`. Si la tienda tiene total decidido `D` (`proyeccion_tiendas.decidido`), las filas no fijadas se re-escalaban (`origen = escalada`) para que `Σ = D` (`escalarTienda`). Si la tienda de `Y` pasa a `M(Y+1)`, se recalcula la base de `Y+1` de esa GML-AM (B2).
- **Lo que ya cuadraba:** `leerLineas` lee todas las filas de la GML con `*` (incluidas las de tienda y sus `participaciones`); el segmento «tiendas nuevas» del gráfico anual (`construirBarras`) y la columna de aperturas de la Matriz ya sumaban el `vigente` de las **filas** de tienda. Al recargar `/lineas` tras decidir, el gráfico se actualiza sin tocar el cálculo.
- **Composición por marca:** desde `0.10.1` cada fila base guarda `participaciones.por_marca` (toda unidad de marca, la cabeza del conjunto, con venta en `W12` sobre `M(Y)`, `Σ = 1`) y `periodo_referencia`. Es exactamente la decisión 4 y lo que M8 aplicará a las filas de tienda (07 §7: «en las de tienda, M8 usa las de la fila base del mismo GML-AM»). **No hizo falta tocar la BD.** Descartados: `venta_marca_gml` (M12, para el reparto al barrer, relee venta) y `venta_composicion_agrupacion` (06c, compone GML dentro de una agrupación de estacionalidad, no marcas).

**Tres defectos previos que se corrigieron antes de exponer la edición en la línea:**
- **D1.** ✓ (`origen = propuesta`) en una fila de tienda se perdía: `escalarTienda`, `recalcularFilasTienda`, `aPrevias` y `calculo.ts` solo conservaban `origen = manual`. Ahora `decidirFila` convierte `propuesta` en `{ decidido: propuesto, origen: manual }` cuando `tienda_id ≠ null`: aceptar en una fila de tienda es fijar la propuesta, y no hubo que cambiar la regla de «fijada» en cuatro sitios.
- **D2.** Con la tienda sin total decidido, fijar una fila de `Y` no rehacía el `Y+1` `maduro_propio` de esa fila. `propagarTienda` ahora guarda siempre las filas ya recalculadas.
- **D3.** Fijar filas cuya suma pasaba `D` dejaba `Σ filas ≠ D` sin que nadie lo decidiera. Se resolvió con la regla del total movido (§5.3): el total nunca queda por debajo de lo fijado a mano.

## 4. Contrato de API (`tipos-api.ts`, `servicio-lectura.ts`, `servicio-edicion.ts`)

```ts
// GET …/[id]/lineas: tres claves nuevas o ampliadas (solo con línea elegida)
export type FilaTiendaLineaApi = FilaApi & { tienda_codigo: string; composicion_s: number | null }; // tienda_id no nulo; `anios` = los años en que es nueva
export type TiendaLineaApi = TiendaLineaBaseApi & {
  tienda_id: string; fecha_apertura: string | null; origen_composicion: "referente" | "red" | "propia"; referente: string | null;
  total_tienda: { propuesto: number | null; decidido: number | null };   // de proyeccion_tiendas: TODA la tienda, todas las líneas
};
export type MarcasDeFilaApi = {
  fila_id: string; equivalencia_id: string | null; agrupacion_marca_id: string;
  periodo: { desde: string; hasta: string; tiendas: number } | null;     // periodo_referencia + |M(Y)|
  top: { marca_id: string; marca: string; participacion: number }[];     // ≤ 3, de mayor a menor (empate: nombre)
  otras: { marcas: number; participacion: number } | null;               // el resto, para que Σ = 1
};
RespuestaLineasApi: { …; tiendas_linea: TiendaLineaApi[]; filas_tienda: FilaTiendaLineaApi[]; marcas: MarcasDeFilaApi[] }
// filas_tienda ordenadas por año en que es nueva, código de tienda, lugar del GML, equivalencia y orden de agrupación de marca; solo bloque `nuevas` y filas activas.

// PUT …/[id]/filas/[filaId]/anios/[anio]: el cuerpo NO cambia (decisionSchema). Sin `ajuste_tienda`.
// Respuesta: RespuestaDecidirFilaApi = AnioFilaApi & { tienda?: { anio: number; decidido: number | null; suma_filas: number } }
//   (`tienda` solo en filas de tienda: el total ya actualizado y la suma de sus filas)
// Se mantienen: 409 cerrada · archivada · calculo_en_curso · fila_inactiva · sin_propuesta · menor_que_vendido
// Nuevo en fila de tienda: 409 menor_que_vendido también sobre el TOTAL movido (en el año en curso); 409 total_excesivo si el total pasaría de MAX_TOTAL

// GET …/[id]/tiendas: TiendaProyeccionApi gana { suma_filas: number | null; filas_fijadas: number }
```

**Costo.** `/lineas` no hace ninguna lectura pesada nueva: las filas de tienda y las `participaciones` ya llegan en la lectura `*` de la GML. Solo se agrega un `select id, nombre from marcas` con los ids del top (las 3 marcas de mayor peso más las empatadas con la tercera, `marcasQueNecesitanNombre`), en tandas de 100 ids para que la URL de PostgREST no crezca. A la respuesta no se manda `por_marca` completo, solo el top 3 y el resto. `GET /tiendas` lee además las filas de tienda con columnas ligeras (`leerFilasConAnios`, paginado) para calcular `suma_filas` y `filas_fijadas`; esas filas no viajan al navegador. **No se midió** el tamaño en bytes ni el tiempo de `/lineas` frente a `0.10.6` (la regla 10 del plan original quedó sin ejecutar; ver §8).

## 5. Cálculo (puro, en `apertura-linea.ts`, `decision.ts` y `servicio-edicion.ts`)

1. **Aceptar en una fila de tienda = fijar la propuesta** (corrige D1), como en §3.
2. **Un solo comportamiento: `mover_total`.** No existe `ajuste_tienda`, ni `mantener_total`, ni el `Modal` «Mantener / Subir el total», ni el `409 excede_total_tienda` de la ficha original.
3. **Total movido.** Si la tienda tiene total decidido `D` en el año, al fijar una fila el total pasa a `D' = max(D + Δ, Σ fijadas)`, con `Δ = vigente nuevo de la fila − vigente anterior` y `Σ fijadas` = la suma de lo fijado a mano (`origen = manual` con cifra) en todas las filas de la tienda, contando la nueva (`totalTiendaTrasMover`). El máximo evita D3: si la tienda arrastraba un `D` menor que sus fijadas, el total sube a lo fijado. `D'` se guarda en `proyeccion_tiendas` como decisión **explícita** del planner (`origen = manual`, quién y cuándo, y la `nota` existente más «ajustado desde la línea G · M · L», sin repetirla y con el tope de una nota: `notaMoverTotal`). Las demás filas **no se mueven** (`moverTotalTienda`, a diferencia de `aplicarDecisionTienda`, que re-escala las no fijadas). En el año en curso, `D'` no puede quedar bajo lo vendido por la tienda (`409 menor_que_vendido`, `motivoRechazoTotalTienda`).
4. **Sin `D`:** solo se fija la fila; la tienda sigue sin decidir y su propuesta no cambia. `propagarTienda` rehace igual el `Y+1` `maduro_propio` de la tienda cuando `anio = Y` (corrige D2).
5. **Volver una fila a la propuesta** (↺) no mueve el total: la tienda vuelve a escalar esa fila con `D`.
6. **Total de la línea por año** = `Σ vigente` de las filas base + `Σ vigente` de `filas_tienda` del año (`totalLinea`). Es la misma cifra que la barra anual y que la Matriz. B2 sigue igual: decidir una fila de `Y` de una tienda que pasa a `M(Y+1)` rehace la propuesta de `Y+1` de la base de esa GML-AM.
7. **Reparto por marca de una fila de apertura** (en pantalla, sin guardar): `repartoPorMarca` usa `repartirEntero(vigente_fila, [p₁, p₂, p₃, p_otras])`, en enteros que suman la cifra de la fila. Cada fila de tienda usa las participaciones de la fila base con su misma clave base (equivalencia incluida en un nodo GMLE).
8. **Tarjeta de Tiendas nuevas** (`FilasDeTienda`): fijar una fila desde la tarjeta usa el mismo `PUT` y por lo tanto también mueve el total; el aviso posterior dice el total ya actualizado (`textoTotalTiendaTras`). Aceptar la propuesta de la **tienda** conserva su efecto (re-escala las no fijadas) y su texto lo avisa.

## 6. Pantallas (Por línea y Tiendas nuevas; solo admin y planner, como toda la Parte 1)

- **Tabla de filas** (`tabla-filas.tsx`): después de las filas base va una sección por tienda nueva y año. La cabecera dice «Aperturas 2027 · T12 · Tienda nueva B · abre 2027-03-15 · referente T03 (o "composición de la red")», el total de la tienda («total de la tienda: 7 840 decididas» o «sin decidir, propuesta 7 840»), lo que aporta a esta línea y el enlace «Ver la tienda». Las tiendas nuevas del año anterior llevan «Nueva del año anterior». Debajo, una fila por agrupación de marca (y equivalencia en GMLE) en orden de catálogo. En el año en curso van vendido, propuesto y decidido; en el siguiente, propuesto y decidido; las demás columnas llevan «—». Una cifra escalada se ve en gris con el título «Escalada desde el total de la tienda» y se puede fijar escribiendo o con ✓; una fijada lleva ✓ y ↺ (`CeldaDecision` con `filaDeTienda`). Una agrupación con fila base pero sin fila de tienda dice «Sin fila de apertura: el referente no vende esta agrupación».
- **Al escribir en una fila de apertura**, junto al campo aparece una nota estimada: «Cambia solo esta fila; el total de la tienda pasa a X» (o, sin total decidido, «la tienda aún no tiene total decidido y las demás filas no se tocan»). **No hay modal ni pregunta**: Enter guarda. Tras guardar, un aviso dice el total ya actualizado, que puede ser mayor que la estimación si las fijadas lo obligan a subir.
- **Pie de la tabla:** «Línea (mismas tiendas)» como antes; luego «Tiendas nuevas» (`Σ` de las filas de apertura por año) y «Total línea» (las dos sumas). Solo aparecen si hay apertura.
- **Gráfico «Marcas de más peso por agrupación»** (`grafico-marcas.tsx`, debajo de la tabla; SVG propio con la geometría en `vista.ts`, como `grafico-barras.tsx`): una barra horizontal al 100 % por agrupación de marca (y equivalencia en GMLE), con segmentos para la marca 1, 2 y 3 y «Otras (N)», cada uno con nombre y % en la leyenda (porcentajes de 1 decimal que suman exactamente 100 %). Pie: «Unidades de los últimos 12 meses de las mismas tiendas (desde a hasta, N tiendas), sin normalizar por el Niño». Debajo, la tabla «Reparto de la apertura por marca», por año: tienda, agrupación, unidades y el reparto («MARCA A 88 · MARCA B 40 · MARCA C 30 · otras 52»). Los colores son tokens del tema, también en modo oscuro.
- **Tarjeta de Tiendas nuevas y cierres:** si hay filas fijadas, dice «2 filas fijadas a mano (también desde Por línea) · suma de filas 7 940» y añade el botón **Usar la suma de filas**, que envía el `PUT` de la tienda con `origen = manual` y la suma como total (deshabilitado si ya es el total decidido). Junto a las filas de la tienda, la nota explica que cambiar una fila solo mueve esa fila y el total pasa a `D + Δ`.

## 7. Casos borde

| Caso | Comportamiento |
|---|---|
| Apertura sin referente | composición de la red (`origen_composicion = red`); la cabecera lo dice; se edita igual |
| Sin venta esperada | la fila puede no tener propuesta (`sin_propuesta`): ✓ deshabilitado, se escribe la cifra; la tienda no bloquea el cierre |
| Sin composición por marca (fila base sin venta en `W12`, o calculada antes de `0.10.1`, con `por_marca` nulo) | la barra dice «Sin datos de marca en los últimos 12 meses (o recalcula la proyección)»; la fila de apertura se edita igual, sin reparto |
| Menos de 3 marcas en la agrupación | se muestran las que hay; `otras = null` y la barra igual suma 100 % |
| Año sin tiendas nuevas en la línea | sin sección de tienda; el gráfico de marcas se muestra igual y su tabla dice «Sin tiendas nuevas en 2027» |
| Nodo GMLE (varias equivalencias) | filas, secciones y barras por equivalencia × agrupación de marca, como las filas base; no se agrega entre equivalencias |
| Tienda ya decidida en Tiendas nuevas | fijar una fila mueve el total a `max(D + Δ, Σ fijadas)`; no hay pregunta |
| Tienda sin total decidido | solo se fija la fila; la tienda sigue sin decidir |
| Tienda nueva de `Y` que pasa a `M(Y+1)` | editar su fila de `Y` rehace la propuesta de `Y+1` de la base (B2), que queda con ▲ si estaba decidida |
| Año en curso con meses reales | mínimo = vendido de la fila (`menor_que_vendido`) y del total de la tienda |
| Proyección cerrada o archivada / cálculo en curso | `bloqueada`: celdas deshabilitadas; el servidor responde `409`. El gráfico se muestra (es lo que M8 lee de esa cerrada) |
| Recalcular | las filas fijadas (también las aceptadas con ✓, gracias a §5.1) sobreviven; las escaladas se rehacen con `D` |

## 8. Reglas (vitest) y plan de pruebas

Pruebas en `tests/proyeccion.apertura-linea.test.ts` (puras), `tests/proyeccion.apertura-rutas.test.ts` (rutas con base falsa), `tests/proyeccion.apertura-vista.test.ts` (vista, render y estructura de la pantalla) y `tests/proyeccion.orden-agrupacion-marca.test.ts`.

1. `marcasDeFila`: top 3 de mayor a menor (empate por nombre), `Σ top + otras = 1`, `null` si no hay `por_marca`; una marca sin nombre se rotula.
2. `repartoPorMarca`: enteros que suman `vigente`; con `vigente = 0` todo es 0; sin composición, `null`.
3. `filasTiendaDeLinea`: solo bloque `nuevas` y filas activas, en el orden de §4; las filas de tienda nunca entran en los totales de las filas base.
4. `totalLinea(anio) = Σ base + Σ filas_tienda`, igual a la barra de `construirBarras` y a la columna de la Matriz.
5. Aceptar en una fila de tienda deja `origen = manual` y `decidido = propuesto`; sobrevive a `aPrevias` y a Recalcular; en una fila base `propuesta` sigue siendo `propuesta`.
6. Total movido: `D' = D + Δ`, las otras filas no cambian, la decisión de la tienda lleva actor, fecha y nota «ajustado desde la línea»; bajar una fila baja el total en lo mismo; nunca queda `Σ fijadas > D'` (D3); `409 menor_que_vendido` si el total movido queda bajo lo vendido (y no se escribe nada).
7. Sin `D`: la tienda sigue sin decidir, su propuesta no cambia y el `Y+1` `maduro_propio` de la fila se rehace (D2).
8. Estados de la proyección: cerrada, archivada o calculándose responden `409` con su código y nada cambia; fila inactiva y fila sin propuesta siguen en `409`; un cuerpo mal formado es `400`.
9. Estructura de la pantalla: no hay modal ni pregunta ni campo `ajuste_tienda`; el gráfico de marcas es SVG propio, accesible y con tokens del tema.

**Quitadas respecto a la ficha original** (obsoletas por la decisión de Javier): la regla de `mantener_total` con `409 excede_total_tienda` (antigua 6) y la de `PUT` con `ajuste_tienda` sobre una fila base → `400` (antigua 9); la de `mover_total` opcional (antigua 7) pasó a ser el comportamiento único (regla 6).

**No medido.** La antigua regla 10 pedía medir la respuesta de `/lineas` (bytes y tiempo, menos de +10 % que en `0.10.6`). **No se midió**: queda pendiente si se quiere confirmar el costo en la base real. Tampoco se amplió el fixture compartido de `tests/proyeccion.fixture.ts`; las pruebas de apertura arman sus propios datos sintéticos.

## 9. Criterios de aceptación (hito de Javier)

1. En la línea que tiene la apertura de 2027 aparece la sección de la tienda con una fila por agrupación de marca, de PREMIUM a ULTRA LOW.
2. [ESCRIBE] Subir la cifra de una fila de la apertura con la tienda ya decidida: no hay pregunta; la nota del campo dice a cuánto pasa el total y, al guardar, el aviso y la tarjeta de la tienda muestran el nuevo total decidido a su nombre; las demás filas de la tienda no cambian.
3. La barra de 2027 del gráfico anual, el «Total línea» del pie y la Matriz (columna de aperturas) dan la misma cifra después de cada cambio.
4. ✓ en una fila de la apertura fija la propuesta, y la cifra sigue fijada después de Recalcular.
5. El gráfico de marcas muestra, por agrupación, las 3 marcas con su % y «Otras» con su % real (suma 100 %); el reparto de la apertura suma la cifra de la fila.
6. En una proyección cerrada todo se ve y nada se edita.

## 10. Fuera de alcance

Editar cierres desde la línea; decidir o guardar cifras por marca; crear una fila de tienda para una agrupación que el referente no vende; composición por marca **propia del referente** (exigiría leer venta por tienda × marca: hoy `por_tienda` no trae marca); normalizar las participaciones por el Niño (regla 48 de la ficha 07); medir bytes y tiempo de `/lineas`.

## 11. Cambios respecto a la especificación

La ficha se escribió el 2026-10-16 con dos preguntas abiertas que Javier respondió antes de construir, y eso quitó piezas del diseño:

- **Sin `ajuste_tienda`, sin `mantener_total`, sin Modal, sin `409 excede_total_tienda`.** La ficha proponía preguntar cada vez «Mantener el total / Subir el total». Javier decidió «solo se mueve lo modificado»: comportamiento único `mover_total`. El cuerpo del `PUT` de una fila no cambió. El rechazo nuevo es `total_excesivo` (el total pasaría de `MAX_TOTAL`), y `menor_que_vendido` también se aplica al total movido.
- **`D' = max(D + Δ, Σ fijadas)`** en lugar de `D + Δ` a secas: así D3 queda resuelto sin rechazar nada.
- **Tarjeta de Tiendas nuevas:** también mueve el total al fijar una fila; gana la suma de filas, las filas fijadas y «Usar la suma de filas».
- **Marcas:** 3 marcas más «Otras» con su % real (la alternativa descartada era las 3 reescaladas).
- **Plan de pruebas:** ver §8 (reglas quitadas y regla 10 sin medir).

Registro en `docs/DECISIONES.md` (2026-10-16).

## 12. Cambios posteriores a QA/seguridad (0.10.7)

Tras la revisión de QA y de seguridad se añadieron tres endurecimientos al mismo `0.10.7`, sin cambiar el contrato de lectura:

1. **Bloqueo optimista del total de la tienda.** Mover el total lee `D`, calcula `D'` y escribe en varias idas a la base; si otra persona decide la tienda en medio, el segundo guardado pisaría el primero sin que nadie lo notara. Ahora la escritura de `D'` solo se aplica si el total de la tienda sigue siendo el que se leyó; si cambió, el servidor responde `409` con código `conflicto` y no escribe nada. La pantalla lo muestra como cualquier otro error de decisión, con la opción de recargar. Se eligió bloqueo optimista y no una transacción porque el resto de M7 ya usa `UPDATE` condicional y relectura (`sigueEditable`) y la ventana es de milisegundos.
2. **Σ filas(Y+1) = D(Y+1) tras editar Y.** Editar una fila de `Y` rehace el `Y+1` `maduro_propio` de la tienda; si la tienda tiene total decidido en `Y+1`, sus filas no fijadas se re-escalan de nuevo a `D(Y+1)`, de modo que la suma de filas de `Y+1` sigue igualando al total decidido de `Y+1` y no queda un desfase silencioso entre la tarjeta y la línea.
3. **`sigueEditable` antes de escribir.** Igual que ya hacían las demás decisiones, `decidirFila` relee el estado de la proyección justo antes de escribir: si mientras se calculaba alguien cerró, archivó o puso a calcular la proyección, no se escribe nada (`409`).

## 13. Preguntas abiertas

Ninguna. Las dos de la ficha original quedaron respondidas (decisiones 5 y 6 de §2).

**Añadido al corregir (0.10.7).** El UPDATE condicional del total se hace *antes* de guardar la fila y, si el guardado de la fila falla, el total se revierte también de forma condicional. Si falla `propagarTienda` (rehacer filas del otro año), no se revierte: responde `500 guardado_parcial` («Recarga la proyección y revisa la tienda antes de volver a intentar») y el error crudo solo va al log. Tras rehacer el año siguiente se vuelve a aplicar su total decidido (Σ filas = total en los dos años), y `sigueEditable` se comprueba dentro de `propagarTienda`, pegado a su escritura.

# M6c · Composición de la agrupación (GML y equivalencias) y curva del usuario

> Estado: **especificada el 2026-10-15 a partir de la prueba de Javier sobre la `0.9.7 · M6` en producción; pendiente de revisión por el `arquitecto-revisor` y de aprobación de Javier.** Es una ampliación de [06b-curvas-trabajo-por-agrupacion](06b-curvas-trabajo-por-agrupacion.md) (vigente, `0.9.7`), que a su vez conserva el modelo de [06-curvas-estacionalidad](06-curvas-estacionalidad.md). No cambia ninguna fórmula del modelo ni ningún contrato de salida hacia M7: añade dos cosas a la vista de trabajo de una agrupación: **la composición completa** (todos los GML y equivalencias con su peso y su comportamiento frente a la curva) y **la curva del usuario** (doce participaciones escritas a mano, medidas con la misma vara que las candidatas y aprobables como versión). Versión prevista **`0.9.8 · M6`** (etiqueta del encargo; ver la nota de versión más abajo), migración **`0021_composicion_y_curva_usuario.sql`** (la `0019` es de M12 y la `0020` de M13: la siguiente libre es la `0021`, no la `0018` que una lectura rápida de la 06b supondría), commits con prefijo `M6:`. Ningún dato real de Lukers: la agrupación y los GML de los ejemplos son inventados (`SINT_INV`, `HOMBRE · URBANO · CASACA`…), y lo observado en producción va en cifras agregadas sin nombres.

**Nota de versión.** El código está en `APP_VERSION = 0.10.0 · M7`, y las fichas 12 y 13 reservan `0.11.0` y `0.12.0`. La etiqueta `0.9.8 · M6` del encargo queda **por detrás** de la vigente: al construir, `backend` toma la siguiente libre en ese momento (`0.10.1 · M6` si M12 y M13 no han salido todavía; si ya salieron, la que siga) y el `documentador` anota aquí la definitiva. En esta ficha "0.9.8" nombra la entrega, no el número que verá Javier al pie del menú.

## Objetivo

Que la vista de trabajo de una agrupación responda dos preguntas que hoy no responde. **Primera: "¿qué hay dentro?"** La cabecera dice "14 equivalencias activas" y nada más; Javier necesita ver todos los GML (género · mundo · línea) y las equivalencias que forman la agrupación, cuánto pesa cada uno (unidades por año y porcentaje de la agrupación sobre la misma red comparable con la que se calcula la curva), cómo se comporta cada GML mes a mes frente a la curva de la agrupación (pequeños múltiplos y selección en el gráfico principal), con una alerta sobre los GML que se apartan de forma consistente y el enlace a M3 para reasignar una equivalencia. **Segunda: "¿y si la curva la pongo yo?"** El planner debe poder escribir su propia curva mensual (doce participaciones que suman 100 %, en tabla, normalizando, partiendo de una candidata, de un año, de la vigente o pegando desde Excel), verla en el mismo gráfico y la misma tabla que la aprobada, los años y la propuesta del sistema, conocer su error contra los años con la **misma métrica** (EAT) y el mismo ruido que las candidatas, y aprobarla como **curva del usuario** con nota obligatoria, de modo que quede en la foto de aprobación con sus doce valores, versionada y consumida por M7 exactamente igual que cualquier otra vigente.

## Decidido por Javier

Rigen las decisiones de la 06 y las 1 a 12 de la 06b. Añadidas el **2026-10-15**, al probar la `0.9.7` en producción:

13. **"Aquí necesito ver todas las GML del grupo."** En la vista de trabajo de una agrupación se ve la composición completa: todos los GML y las equivalencias, con su peso (unidades por año y % de la agrupación), cómo se comporta cada GML frente a la curva de la agrupación (curva mensual propia frente a la de la agrupación: pequeños múltiplos o selección), alertas de GML que se apartan, y el enlace a M3 para reasignar una equivalencia.
14. **"También necesito poder definir una curva propuesta por el usuario."** Doce participaciones que suman 100 %, editadas en tabla con normalización; se puede partir de copiar una candidata, un año, la vigente, o pegar desde Excel; se ve en el mismo gráfico y la misma tabla junto a la aprobada, los años y la propuesta del sistema; se mide su error contra los años (EAT, con la misma métrica que las candidatas y su ruido); se aprueba como "curva del usuario" con nota obligatoria, queda en la foto de aprobación con sus doce valores y versionada; **M7 consume la curva vigente igual que cualquiera**.

Lo que esta ficha fija como **supuesto a validar** (recomendación del arquitecto donde el dueño no se pronunció) va marcado con *(supuesto)* y recogido en "Preguntas abiertas".

## Flujo de usuario (UX primero)

Se inserta en el flujo de la 06b sin mover nada de lo que ya existe. Los pasos 0 a 9 de la 06b siguen iguales; aquí se añaden **3b** (composición, después de mirar las curvas) y **4b** (la curva del usuario, después de entender la recomendación y antes de ajustar parámetros).

**Paso 3b · Mirar la composición.** Debajo de la tabla año × mes, la tarjeta **Composición de la agrupación** (abierta al entrar; se pide a la API en paralelo con el primer cálculo). Una fila por GML con su nivel de planificación (GML / GMLE, de 02b), cuántas equivalencias aporta, unidades y % por año sobre la red comparable del año (las mismas tiendas con las que se calculó la curva), EAT de su curva anual frente a la de la agrupación en cada año de ajuste, la marca **Se aparta** cuando se aparta en todos los años de ajuste, una mini curva (la del GML en sólido, la propuesta en discontinuo) y la casilla "Ver en el gráfico", que dibuja ese GML como una serie más en **Curvas de la agrupación**. Al desplegar un GML se ven sus equivalencias (nombre, código, genérica, activa) con las mismas cifras. Arriba, "3 GML · 4 equivalencias activas · 1 inactiva con venta (cuenta en la curva)"; abajo, "Pequeños múltiplos" (una tarjeta por GML con su curva de cada año y la de la agrupación) y "Descargar CSV". En cada GML que se aparta, el enlace **Reasignar en M3** lleva a `/maestros/estacionalidad?pestana=asignacion`. *Decide*: si la agrupación está bien armada o si una equivalencia debe moverse antes de aprobar nada.

```
Composición de la agrupación · 3 GML · 4 equivalencias activas · pesos sobre la red comparable de cada año        [Pequeños múltiplos] [CSV]
Misma huella que el cálculo de arriba (umbral «se aparta»: 3.8 pp = max(piso 3, ruido 3.8); peso mínimo 5 %)

GML                          Nivel  Equiv.   2024 u.    %      2025 u.    %      2026 ene–set   %     EAT vs agrupación   Curva del GML   Gráfico
▸ HOMBRE · URBANO · CASACA   GML    2        600     60.0 %   660     60.0 %   420         60.0 %   2.8 · 3.0           ▁▁▂▃▅▆▆▅▄▂▁▁    [ ] ver
▸ HOMBRE · URBANO · CHOMPA   GML    1        350     35.0 %   385     35.0 %   245         35.0 %   2.8 · 3.0           ▁▁▂▃▅▆▆▅▄▂▁▁    [ ] ver
▾ HOMBRE · FORMAL · ABRIGO   GML    1 (gen.) 50       5.0 %   55       5.0 %   35           5.0 %   53.2 · 57.0 ⚠ Se aparta  ▄▅▆▆▅▃▂▁▁▁▁▁   [x] ver   → Reasignar en M3
    SIN EQUIVALENCIA (genérica, activa)      50       5.0 %   55       5.0 %   35           5.0 %
Total                                4        1,000   100 %    1,100   100 %    700         100 %
⚠ 1 GML se aparta de la curva de la agrupación en todos sus años de ajuste (HOMBRE · FORMAL · ABRIGO, 5 % del peso): revisa si sus equivalencias van en otra agrupación.
```

**Paso 4b · Definir mi curva (opcional).** Debajo de **Lo que propone el sistema**, la tarjeta **Mi curva (curva del usuario)**, plegada hasta pulsar "Definir mi curva". Al abrirla: una fila de doce celdas en porcentaje (un decimal visible, hasta cuatro admitidos), la **suma en vivo** ("Suma 98.0 % · faltan 2.0") y el botón **Normalizar a 100 %** (reparte proporcionalmente); "Partir de" (candidata `A`…`E`/`T`, un año con curva, la vigente vN, o en blanco); **Pegar desde Excel** (pegar en cualquier celda doce valores separados por tabulador, salto de línea, `;` o `,`; coma o punto decimal; con o sin `%`; fracciones que suman 1 se convierten; unidades se normalizan avisando); "Limpiar". Mientras la curva es válida (doce valores, cada uno de 0 a 100, suma 100 ± 0.05): aparece como serie **Mi curva** en el gráfico (trazo grueso con guion largo, color propio) y como fila **Mi curva** en la tabla año × mes con su **Diferencia (pp)** frente a la aprobada; en la tabla de candidatas se añade una última fila **`U` · Mi curva** con `radio`, "EAT 5.2 pp en muestra · ruido 3.8", error máximo, EAT parcial del año en curso y "Igual a A" si coincide con una candidata; y, debajo del editor, la lectura: "Tu curva se equivoca 4.6 pp frente a 2024 y 5.8 frente a 2025 (promedio 5.2, en muestra); A, fuera de muestra, 3.8; ruido entre años normales 3.8. Frente a la aprobada v2 difiere 4.0 pp; el mes que más cambia es enero (+0.7)". *Decide*: si su curva es mejor explicación que las candidatas, y con qué motivo.

```
Mi curva (curva del usuario)                                                     Partir de: [A · Promedio simple ▾] [Año 2025 ▾] [Vigente v2] [En blanco]   [Pegar desde Excel]
        ene    feb    mar    abr    may    jun    jul    ago    set    oct    nov    dic      Suma
Mi curva [5.0] [5.0] [6.0] [8.0] [11.0] [14.0] [13.0] [12.0] [10.0] [7.0] [5.0] [4.0]   100.0 % ✓        [Normalizar a 100 %] [Limpiar]
A         4.3    4.4    6.4    8.3   11.05  14.65   13.6   11.65   9.75    6.9    5.0    4.0
Dif. (pp) +0.7   +0.6   −0.4   −0.3   −0.05  −0.65  −0.6   +0.35  +0.25  +0.1    0.0    0.0   EAT 4.0 · el mes que más cambia: enero (+0.7)
Error contra los años (en muestra): 2024 4.6 pp (máx. 1.0 en mayo) · 2025 5.8 pp (máx. 1.6 en junio) · promedio 5.2 · 2026 parcial ene–set: 3.1 · ruido entre años normales 3.8 · A fuera de muestra: 3.8
Para aprobarla elige «U · Mi curva» en la tabla de candidatas y escribe la nota: la curva del usuario siempre lleva motivo.
```

**Paso 7 (ampliado) · Aprobar mi curva.** Con `U` elegida, el bloque **Aprobada frente a propuesta** compara **Mi curva** con la vigente; el campo "Nota / motivo" es obligatorio ("aprobaste tu propia curva"); el botón dice "Aprobar mi curva (U) como versión 3". El `confirm` repite los doce valores, el EAT en muestra frente al ruido, qué proponía el sistema, de dónde partió la curva (candidata, año, vigente, pegado o en blanco) y la diferencia con la vigente. `PUT` con `modelo: "U"`, `curva_usuario` (doce porcentajes), `partida`, `parametros`, `huella_calculo`, `version_vigente` y `nota`. Mensaje: "Curva del usuario aprobada como versión 3 de SINT_INV". La lista la muestra "Al día · v3 · **U · curva del usuario** (el sistema proponía A)"; Versiones y "Ver foto" la muestran con sus doce valores y la candidata `U` de aquel momento.

### Qué decide el planner y qué decide el sistema (añadido a la tabla de la 06b)

| Decisión | Quién | Dónde |
|---|---|---|
| Qué GML "se aparta" | sistema (umbral relativo al ruido y peso mínimo, los mismos de `tienda_distinta`) | tarjeta Composición |
| Si una equivalencia cambia de agrupación | planner (en M3) | enlace Reasignar |
| Los doce valores de la curva del usuario y de dónde parten | planner | tarjeta Mi curva |
| Cuánto se equivoca esa curva contra los años | sistema (EAT en muestra, mismo `eat` que las candidatas) | tabla de candidatas y lectura |
| Aprobar la curva del usuario | **planner**, con nota siempre | botón Aprobar |

## Conceptos

### Composición medida sobre la red comparable

La composición que hoy existe es un conteo y una huella (`leerAgrupacionesConDatos`: `equivalencias_activas` y `huellaComposicion(ids)`), y la venta de la agrupación llega a TypeScript **ya sumada** por tienda × mes (`venta_estacionalidad_agrupacion` → `agrupacion`). Para ver cada GML hace falta un desglose nuevo: unidades por **GML × mes** y por **equivalencia × año**, sobre la **misma red comparable de cada año** que usó el cálculo (así los pesos y las curvas de los GML suman exactamente la serie de la agrupación que se ve en la tabla año × mes). La red la decide el modelo en TypeScript (`armarEntradaAgrupacion` → `entrada.redes`), así que la lectura nueva **recibe la red por año** (`p_red`) y devuelve solo lo filtrado: con 30 GML × 45 meses son unas 1 350 filas y 140 equivalencias × 4 años unas 560, en vez de equivalencia × tienda × mes (que con 140 equivalencias y 10 tiendas pasaría de 60 000 objetos).

**Curva de un GML**: la participación mensual del GML en cada año (sobre la red del año, `participacion(meses)`) y, como curva anual, `A` (promedio simple, `curvaA`) sobre los **años de ajuste de la agrupación** en los que el GML tiene volumen. No se backtestea ni se recomienda: es una lectura.

**GML que se aparta** *(supuesto)*: por año, `diagnosticarTiendas` (`red.ts`) aplicado a los GML en vez de a las tiendas: `eat_vs_agrupacion = EAT(p(GML, Y), p(agrupación, Y))`, `distinta` si supera `max(umbral_forma, ruido_normal)` y el GML pesa al menos `peso_minimo_diagnostico` (0.05) en ese año. El GML **se aparta** si es `distinta` en **todos** sus años de ajuste con venta (uno solo ya cuenta si solo hay uno): un año raro no basta; dos seguidos sí. Es diagnóstico: no cambia la curva. Un GML de peso menor al mínimo no se marca aunque su forma sea otra (pesa poco en la curva); su EAT se muestra igual.

**Nivel y unidad**: cada GML lleva `nivel_planificacion` (02b). Sirve para leer: un nodo `GMLE` que se aparta en una sola de sus equivalencias se ve al desplegarlo (las equivalencias también llevan unidades y peso por año; su curva no se calcula en esta entrega para no multiplicar la lectura).

### Curva del usuario (`U`)

Una curva de doce participaciones escrita por el planner. **Se mide con la misma vara que las candidatas**: `eat(curva, real)` de `backtesting.ts` contra la participación usada de cada año de ajuste (`anios[].participacion`, la imputada si el año se imputó: lo mismo que ve `realDe` en `proponer`), `errorMax`, promedio sobre los años, `validacionParcial` contra el año en curso y el mismo `ruido_normal`. Diferencia honesta que la pantalla dice siempre: las candidatas se miden **fuera de muestra** (se ajustan sin el año que se prueba); la curva del usuario es fija y se mide **en muestra** (el planner pudo verla con esos mismos años delante). Si la curva coincide con una candidata (tolerancia `TOLERANCIA_IGUAL`), se muestra "Igual a A" y la EAT fuera de muestra de esa candidata al lado. Nunca entra en `recomendar`: el sistema no la propone; `recomendada = false` siempre y `recomendada_entonces` guarda lo que el sistema proponía.

**Representación sin `DROP`** (lo que pedía el encargo). En `curvas_estacionalidad`, `modelo` solo tiene `check (length(modelo) between 1 and 10)` (`0015`): **no restringe a `A`…`E`/`T`**; la restricción vive en zod (`MODELOS_CURVA`) y en `esModeloCurva`, que además degrada a `"A"` cualquier valor desconocido (por eso hay que ampliar los tipos **antes** de que exista una fila `U`, regla 71). `origen` sí tiene `check in ('propia', 'prestada')`. Decisión: `modelo = 'U'` (cabe en el `check`), `origen = 'propia'` (la curva es de esta agrupación, no prestada de su temporada) y una columna nueva `curva_manual jsonb` con los doce valores tal como los escribió el planner y de dónde partió. Sin `DROP` de ninguna restricción. La alternativa `origen = 'usuario'` **exigiría `alter table … drop constraint curvas_estacionalidad_origen_check`** y queda descartada salvo que Javier la autorice caso por caso (pregunta 5).

| Opción | Qué da | Qué cuesta | Veredicto |
|---|---|---|---|
| **(a) `modelo = 'U'` + `curva_manual jsonb`, `origen = 'propia'`** | Cabe en los `check` actuales; la lista, las versiones y M7 distinguen la curva por `modelo`; `curva_manual` guarda lo escrito y la procedencia; `origen_curva` se deriva (`modelo = 'U'`) | Ampliar `ModeloCurva` a `ModeloAprobable` en tipos y lectores; `origen = 'propia'` no dice "usuario" en SQL (lo dice `modelo`) | **Sí** |
| (b) `modelo` = modelo base (`A` si partió de `A`) + `origen_curva = 'usuario'` | "Con el modelo base" literal | Una curva editada a mano llevaría la etiqueta de un modelo que no es; M7 (`leerVigentesProy`) tomaría el `eat_por_pliegue` de `A` de la foto como si fuera de la curva aprobada | No |
| (c) `origen = 'usuario'` | Un solo campo | `DROP CONSTRAINT` (prohibido sin autorización) | Solo si Javier lo autoriza |

**En la foto de aprobación**, `resultado.agrupaciones[0].candidatas` lleva, además de las del cálculo, una entrada `U` (`CandidataApi` con `modelo: "U"`, la curva normalizada, `eat` en muestra, `error_max`, `eat_parcial`, `pruebas: 0`, `pliegues: 0`, **`eat_por_pliegue: []`**, `igual_a`, `prestada: false`, `en_muestra: true`, `eat_en_muestra_por_anio`) y `resumen.curva_usuario` repite valores, partida y EAT. Por qué así: "Ver foto" y M7 ya buscan `candidatas.find(c => c.modelo === curva.modelo)`; con `eat_por_pliegue` vacío, M7 muestra "sin backtesting" (su código ya lo contempla) y **no cambia ni una línea**; con la entrada `U` presente, "Ver foto" dibuja la curva de esa versión sin código nuevo.

## Modelo de datos

Migración **`0021_composicion_y_curva_usuario.sql`**: idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE` (tampoco dentro de la función), sin bloques `do $$`, `create or replace function`, `add column if not exists`, `revoke` a `public`, `anon` y `authenticated` y `grant` a `service_role`, `security invoker`, `stable`, `search_path = ''`, `comment on`. Sin tablas nuevas (nada que activar con RLS). `datos` la aplica en `vector-two` con el MCP y regenera `database.types.ts`.

### 1. `curvas_estacionalidad.curva_manual jsonb null`

`add column if not exists curva_manual jsonb constraint curvas_estacionalidad_curva_manual_check check (curva_manual is null or jsonb_typeof(curva_manual) = 'object')`. Nulo en toda curva del sistema (todas las filas de hoy, sin backfill); no nulo **exactamente** en las curvas con `modelo = 'U'`. Esa equivalencia cruza dos columnas y la hace cumplir la API (`filaCurva`) con prueba, igual que la regla de género de M3; el `check` solo garantiza la forma. Contenido:

```jsonc
{ "valores_ingresados": [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4],    // porcentajes tal como se enviaron (hasta 4 decimales), ANTES de normalizar
  "partida": { "tipo": "candidata", "referencia": "A" },               // candidata | anio | vigente | pegado | en_blanco; referencia: "A", "2025", "v2" o null
  "en_muestra": true,
  "eat_en_muestra_por_anio": [ { "anio": 2024, "eat": 4.6, "error_max": 1.0 }, { "anio": 2025, "eat": 5.8, "error_max": 1.6 } ],
  "igual_a": null }
```

`p01`…`p12` guardan la curva **normalizada** (`normalizarCurva(valores / 100)`: seis decimales, suma exacta 1, el `check` de suma de la `0015` la acepta), `eat` y `error_max` guardan el promedio en muestra (`numeric(6,2)`), `recomendada = false`, `origen = 'propia'`, `modelo = 'U'`, `nota` obligatoria, `anios_utilizados` con todo lo de la regla 42 de la 06b (la huella, `recomendada_entonces`, parámetros). `comment on column` de `modelo` y `origen` en la `0021`: "`modelo`: A…E y T del sistema, U = curva del usuario (0.9.8); el `check` solo limita la longitud, el conjunto lo valida la API. `origen`: una curva del usuario va como `propia`; no se amplía el `check` para no usar DROP".

### 2. Función `venta_composicion_agrupacion(p_agrupacion_id uuid, p_red jsonb) returns jsonb`

`language sql`, `stable`. La única lectura nueva de venta de esta entrega; solo `consultas.ts` la nombra. `p_red` es `{ "2024": ["<tienda_id>", …], "2025": [...], … }`: la red comparable de cada año tal como la decidió `armarEntradaAgrupacion` (`tiendasQueEntran` por año); la API la arma siempre desde el cálculo (nunca llega del cliente). Devuelve, en una sola sentencia (un solo estado de los datos):

```jsonc
{ "nodos":         [ { "gml_id": "…", "periodo": "2024-01-01", "unidades": 48 }, … ],            // GML × mes, solo tiendas de la red del año del mes
  "equivalencias": [ { "equivalencia_id": "…", "gml_id": "…", "anio": 2024, "unidades": 600 }, … ],  // equivalencia × año, misma red
  "cargas":        { "2023-01": "<carga_id>", … } }                                                 // como en 0017: misma sentencia, mismo estado
```

Esqueleto: un CTE `red` con `jsonb_each(coalesce(p_red, '{}'))` y `jsonb_array_elements_text` → `(anio int, tienda_id uuid)`; un CTE `hechos` = `equivalencias e join venta_stock_vigente v on v.equivalencia_id = e.id join red on red.tienda_id = v.tienda_id and red.anio = extract(year from v.periodo)::int where e.agrupacion_estacionalidad_id = p_agrupacion_id` (equivalencias **activas o no**, como la `0017`: los hechos de una equivalencia desactivada siguen siendo venta de la agrupación); dos agregados sobre `hechos` con `jsonb_agg(… order by …)` y `coalesce('[]')`. `p_red` nulo o vacío → arreglos vacíos. Entra por `equivalencias(agrupacion_estacionalidad_id)` y `venta_stock_mensual(equivalencia_id, carga_id)`: es el agregado "pequeño" de la `0017` (la parte cara de aquella es `temporadas`, que aquí no existe); objetivo < 0.5 s, se mide en el hito. `revoke execute … from public, anon, authenticated; grant … to service_role`. Por qué `jsonb` y no `setof`: las mismas razones de la `0017` (una respuesta, un estado, sin paginar un `rpc`).

### 3. Lo que no cambia

`corridas_estacionalidad` (la foto reutiliza `resultado` y `resumen`), `venta_estacionalidad_agrupacion`, los índices y la vista de M5. `database.types.ts` gana la columna y la función.

### Diagrama

```
calcular (06b) ─► entrada.redes (red por año) ──┐
                                                ▼
POST …/composicion ─► venta_composicion_agrupacion(id, p_red) [0021] ─► armarComposicion (pura) ─► GML × año: peso, participación, curva A, EAT vs agrupación, distinta, se_aparta
                                                                                                   └─► pantalla: tabla, múltiplos, «Ver en el gráfico», Reasignar en M3
Mi curva (12 valores) ─► evaluarCurvaUsuario (pura, cliente y servidor) ─► EAT en muestra por año, parcial, igual_a, vs aprobada
      └─► PUT { modelo: "U", curva_usuario, partida, nota } ─► filaCurva: modelo U, origen propia, curva_manual, foto con candidata U ─► curvas_estacionalidad v+1 ─► M7 (GET /api/curvas/vigentes: sin cambios de forma; + origen_curva)
```

## Contratos de API y lógica pura

Convenciones de la 06b: `requirePlanner` en todo, `{ data }` / `{ error, codigo }`, `leerCuerpo`, esquemas en `src/lib/curvas/esquemas.ts`, `idDeRuta`, `traducirErrorDb`.

### Rutas

| Ruta | Método | Cuerpo / query | Respuesta |
|---|---|---|---|
| `/api/curvas/agrupaciones/[id]/composicion` | **POST** (lectura con cuerpo, nueva) | `calcularAgrupacionSchema` (los mismos parámetros que `calcular`, `partir_de_vigente` incluido) | `200 ComposicionAgrupacionApi`. `404` agrupación · `409 hasta_periodo_sin_cargar` · `409 prerrequisitos` (algún bloqueante: no hay red con qué medir) · `500` venta incompleta. Nunca escribe. Reutiliza `leerContextoTrabajo` (venta por la caché) y `prepararTrabajo`; de `trabajo.entrada.redes` arma `p_red`; llama a `venta_composicion_agrupacion` (cacheable con clave `id | cargas_huella | composicion | md5(p_red)`, TTL 120 s, mismo patrón de `cache-venta.ts`) |
| `/api/curvas/agrupaciones/[id]/calcular` | POST | sin cambios | sin cambios (la curva del usuario se evalúa en el cliente con la lógica pura compartida; el servidor la vuelve a evaluar en el `PUT`) |
| `/api/curvas/agrupaciones/[id]` | PUT | `aprobarCurvaSchema` ampliado (abajo) | `201 { curva, foto_id }`. Con `modelo: "U"`, los `409` en este orden: `hasta_periodo_sin_cargar` · `agrupacion_inactiva` · `prerrequisitos` · `datos_cambiados` · `vigente_cambiada` · `sin_cambio` (vigente `U` con la misma huella **y** los mismos doce valores normalizados) · `nota_requerida` (siempre para `U`). **No** aplican `sin_curva_posible` ni `candidata_no_disponible` *(supuesto: una curva del usuario se puede aprobar aunque el sistema no tenga curva posible; su EAT queda "no medible")* |
| `/api/curvas` · `/api/curvas/agrupaciones/[id]/versiones` · `/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` | GET | — | `modelo` pasa a `ModeloAprobable` (puede ser `"U"`); `VigenteResumenApi` y `VersionAgrupacionApi` suman `origen_curva: "sistema" \| "usuario"` y `curva_manual: CurvaManualApi \| null` |
| `/api/curvas/vigentes` | GET | — | cada fila suma `origen_curva` (aditivo; M7 no lo necesita) |

### Esquemas

```ts
export const MODELO_USUARIO = "U" as const;
export const MODELOS_APROBABLES = [...MODELOS_CURVA, MODELO_USUARIO] as const;   // A..E, T, U
export type ModeloAprobable = (typeof MODELOS_APROBABLES)[number];
export function esModeloAprobable(v: unknown): v is ModeloAprobable;             // esModeloCurva sigue siendo A..E/T (candidatas y ?modelo=)

const porcentaje = z.number("Cada mes debe ser un número.").min(0, "Un mes no puede ser negativo.").max(100, "Un mes no puede pasar de 100 %.");
export const curvaUsuarioSchema = z.array(porcentaje, "La curva debe ser una lista de doce porcentajes.").length(12, "La curva debe tener doce meses.")
  .refine((v) => Math.abs(v.reduce((s, x) => s + x, 0) - 100) <= TOLERANCIA_SUMA_USUARIO /* 0.05 */, "Los doce meses deben sumar 100 % (± 0.05).")
  .refine((v) => v.some((x) => x > 0), "La curva no puede ser toda ceros.");
export const partidaSchema = z.object({
  tipo: z.enum(["candidata", "anio", "vigente", "pegado", "en_blanco"]),
  referencia: z.string().trim().max(40).nullable().default(null),
}).strict();

export const aprobarCurvaSchema = z.object({
  modelo: z.enum(MODELOS_APROBABLES, "El modelo debe ser A, B, C, D, E, T o U."),
  curva_usuario: curvaUsuarioSchema.optional(),      // obligatoria con U; prohibida con cualquier otro modelo (400 en los dos sentidos)
  partida: partidaSchema.optional(),                 // solo con U
  parametros: …, huella_calculo: …, version_vigente: …, nota: …,   // como en la 06b
}).strict().superRefine(/* U ⇔ curva_usuario presente */);
```

`CurvaManualApi = { valores_ingresados: number[]; partida: Partida; en_muestra: true; eat_en_muestra_por_anio: { anio; eat; error_max }[]; igual_a: ModeloPropio | "T" | null }`.

### `POST …/composicion` → `ComposicionAgrupacionApi`

```ts
export type GmlComposicionApi = {
  gml_id: string; genero: string; mundo: string; linea: string; nivel: "GML" | "GMLE"; vigente: boolean;
  equivalencias: { id: string; nombre: string; codigo: string; es_generica: boolean; activo: boolean; por_anio: { anio: number; unidades: number; peso: number }[] }[];
  por_anio: { anio: number; clase: ClaseAnioCurva; en_ajuste: boolean; unidades: number; peso: number;            // peso sobre la agrupación en ese año (0..1)
              participacion: number[] | null;                                                                    // sobre la red del año; parcial en el año en curso; null sin volumen
              eat_vs_agrupacion: number | null; distinta: boolean }[];
  curva: number[] | null;              // A sobre los años de ajuste con volumen; null sin ninguno
  anios_curva: number[];
  se_aparta: boolean;                  // distinta en TODOS sus años de ajuste con venta (≥ 1)
  avisos: ("se_aparta" | "sin_venta" | "peso_pequeno" | "nodo_no_vigente")[];
};
export type ComposicionAgrupacionApi = {
  huella_calculo: string;              // la del cálculo con esos parámetros: la pantalla comprueba que coincide con la vista
  hasta_periodo: string;
  umbral_distinta: number;             // max(umbral_forma, ruido_normal ?? 0)
  ruido_normal: number | null;
  peso_minimo: number;                 // peso_minimo_diagnostico
  anios: { anio: number; clase: ClaseAnioCurva; en_ajuste: boolean; unidades: number }[];   // totales de la agrupación por año (= resultado.anios[].unidades)
  gml: GmlComposicionApi[];            // por género, mundo, línea (orden del árbol)
  equivalencias_activas: number; equivalencias_inactivas_con_venta: number; equivalencias_sin_venta: string[];
  duracion_ms: number;
};
```

### Lógica pura (lo que `backend` escribe y `tests/curvas.*` prueban)

| Función | Archivo | Qué hace |
|---|---|---|
| `armarRedPorAnio(redes: RedAnio[]): Record<string, string[]>` | `src/lib/curvas/composicion.ts` | `p_red` desde `tiendasQueEntran` por año; años sin red → `[]` |
| `armarComposicion(lectura, contexto)` | `composicion.ts` | de `nodos`/`equivalencias` de la función, el árbol (nombres, nivel, vigencia), `resultado.anios` (clase, `en_ajuste`, `unidades`, `participacion`/`participacion_real`/`participacion_parcial`), `ruido_normal` y los parámetros → `GmlComposicionApi[]`; reutiliza `participacion`, `curvaA`, `diagnosticarTiendas`, `eat` |
| `evaluarCurvaUsuario(valores, resultado, temporada)` | `src/lib/curvas/curva-usuario.ts` (sin React ni `@supabase/*`: lo importan el editor y el `PUT`) | normaliza (`normalizarCurva(valores/100)`), EAT y `errorMax` por año de ajuste contra `anios[].participacion`, promedio, `validacionParcial` sobre el año en curso con sus atípicos, `igual_a` contra `candidatas` y `curva_T` (`TOLERANCIA_IGUAL`), y la `CandidataApi` sintética `U` |
| `parsearPegado(texto): { valores: number[]; origen: "porcentaje" \| "fraccion" \| "unidades" } \| { error: string }` | `curva-usuario.ts` | separadores `\t`, `\n`, `;`, `,` (con coma decimal, el separador de lista es `\t`/`\n`/`;`); quita `%` y espacios; coma o punto decimal (si un valor trae ambos, el último es el decimal); exactamente 12 números (si no, error con cuántos llegaron); suma ≈ 100 (± 0.5) → porcentaje; ≈ 1 (± 0.005) → fracción × 100; otra cosa → unidades normalizadas (aviso) |
| `normalizarA100(valores)` | `curva-usuario.ts` | reparto proporcional; con suma 0 no hace nada |
| `curvaDesde(partida, resultado, vigente)` | `curva-usuario.ts` | los doce porcentajes de una candidata, de un año (`participacion_real ?? participacion`), de la vigente; `null` si no existe |
| `filaCurva` (ampliada) | `reglas.ts` | con `U`: `modelo 'U'`, `origen 'propia'`, `recomendada false`, `eat`/`error_max` en muestra, `curva_manual`, `p01..p12` normalizados; sin `U`, como hoy |
| `motivoRechazoAprobar` (ampliada) | `reglas.ts` | orden de la tabla de rutas para `U`; `notaRequeridaPor` devuelve primero "aprobaste tu propia curva" |
| `armarFoto` (ampliada) | `trabajo.ts` | con `U`, añade la candidata sintética a `resultado.agrupaciones[0].candidatas` y `resumen.curva_usuario` |
| `aVigenteResumen`, `versionesDeAgrupacion`, `aCurvaVigente`, `aCurvaAprobada` | `reglas.ts` | `esModeloAprobable`; `origen_curva`; `curva_manual` |
| `construirSeries` (ampliada) | `src/components/curvas/series.ts` | acepta `extras: { clave, etiqueta, curva, color, trazo }[]` (Mi curva y los GML marcados "ver"); Mi curva: `COLOR_USUARIO = "#0f766e"`, trazo `discontinuo`, grosor 3.5, encendida por defecto; GML: color por posición, grosor 1.5 |
| `textoConfirmarAprobacion` (ampliada) | `vista.ts` | con `U`: los doce valores, "en muestra", partida, lo que proponía el sistema |

### Pantalla (componentes)

`composicion-card.tsx` (tabla, desplegables, múltiplos reutilizando `PerfilTienda` de `red-comparable.tsx` generalizado a `PerfilCurva`, casillas "ver", enlace a M3, CSV con `descargarCsv`), `use-composicion.ts` (pide `POST …/composicion` con el mismo cuerpo que el último `calcular` cuando la tarjeta está visible y cambia `huella_calculo`; `AbortController`; descarta respuestas cuya `huella_calculo` no sea la de la vista), `curva-usuario-editor.tsx` (doce `Input` numéricos con `inputMode="decimal"`, `onPaste` → `parsearPegado`, suma en vivo con `aria-live`, "Normalizar", "Partir de", "Limpiar"; borrador en `sessionStorage` con clave `curva-usuario:<agrupacionId>` *(supuesto)*), `candidatas-tabla.tsx` (fila `U` al final, solo cuando hay curva válida), `tabla-anio-mes.tsx` (fila "Mi curva" y su diferencia), `aprobar-panel.tsx` (texto "Aprobar mi curva (U)"; nota siempre obligatoria), `curvas-tab.tsx` y `versiones-panel.tsx` (badge **Curva del usuario**; "A (vs U)" en Sistema hoy), `detalle-agrupacion.tsx` (cabecera "14 equivalencias activas en 3 GML · Ver composición"). Formato `es-PE` compartido (`formatearPctSolo`, `formatearPp`).

## Reglas de negocio

Continúan la numeración de la 06b (la última es la 59; la 45 y la 46 son SQL y estático). Todas con vitest sobre fixtures sintéticos salvo la 60 (SQL de humo) y la 74 (estático).

**`0021` y `composicion.ts`**

60. **SQL (humo local)**: la `0021` aplica dos veces sin error y sin `drop`/`delete`/`truncate`/`update` fuera de comentarios; `curva_manual` admite nulo y rechaza un `jsonb` que no sea objeto; `venta_composicion_agrupacion(id, p_red)` con `p_red` que cubre todas las tiendas de todos los años suma por mes lo mismo que `agrupacion` de `venta_estacionalidad_agrupacion(id)`; con `p_red = '{}'` o nulo devuelve `nodos = []` y `equivalencias = []`; un año ausente en `p_red` no produce filas; una equivalencia desactivada con venta sí aparece; `cargas` coincide con `leerCargasPublicadas`; `anon` y `authenticated` no pueden ejecutarla; duración medida sobre la base real en el hito (objetivo < 0.5 s).
61. `armarRedPorAnio(redes)` devuelve, por año, exactamente `tiendasQueEntran(red)` ordenadas; un año `sin_red` → `[]`; `tiendas_excluidas` cambia `p_red` (y por tanto los pesos) sin cambiar `huellaRed`.
62. `armarComposicion`: para cada año con red, `Σ_gml unidades = resultado.anios[anio].unidades` (la misma red da la misma suma) y `Σ_gml peso = 1` (± 1e-6) cuando la suma es positiva; un GML sin venta en el año tiene `peso = 0` y `participacion = null`; en el año en curso la participación es parcial sobre los meses cargados; las equivalencias de un GML suman las unidades del GML por año.
63. **Curva del GML**: `curva = curvaA` sobre los años con `en_ajuste = true` de la agrupación en los que el GML tiene volumen; `anios_curva` los lista; con cero años → `null`; con `anios_excluidos` el año excluido sale también de `anios_curva`.
64. **GML que se aparta**: `eat_vs_agrupacion` y `distinta` por año salen de `diagnosticarTiendas` con la participación de la agrupación de ese año (`participacion_real ?? participacion`; en el año en curso, `participacion_parcial` renormalizada a los meses cargados), `umbral = max(umbral_forma, ruido_normal ?? 0)` y `peso_minimo_diagnostico`; `se_aparta` ⇔ `distinta` en todos los años de ajuste con venta y hay al menos uno; un año `en_curso` o `incompleto` nunca decide `se_aparta`; un GML con `peso < peso_minimo` en todos sus años lleva `peso_pequeno` y nunca `se_aparta`.
65. **Huella y determinismo**: `POST …/composicion` devuelve la misma `huella_calculo` que `calcular` con el mismo cuerpo; dos llamadas con la misma huella dan `gml` idéntico (JSON igual); con un prerrequisito que bloquea responde `409 prerrequisitos` y no llama a la función SQL (espía).

**`curva-usuario.ts`**

66. `parsearPegado`: `"5\t5\t6\t8\t11\t14\t13\t12\t10\t7\t5\t4"` → doce valores, `porcentaje`; `"4,3;4,4;…"` (coma decimal) → `4.3, 4.4, …`; `"4.3%\n4.4%\n…"` → igual; doce fracciones que suman 1 → × 100; doce unidades (`48 48 72 …`, suma 1 000) → normalizadas, origen `unidades`; once valores → `error` "se esperaban 12 valores y llegaron 11"; texto sin números → error; un valor negativo → error.
67. `normalizarA100([5,5,6,8,11,14,13,12,10,7,5,2])` (suma 98) → cada valor × 100/98 y la suma de los doce resultados es 100 (± 1e-9); con todos ceros no cambia nada; `curvaUsuarioSchema` acepta suma 100 ± 0.05 y rechaza 99.9, un valor fuera de 0..100, once valores y todo ceros; la curva guardada (`normalizarCurva(valores/100)`) suma exactamente 1 y pasa el `check` de la `0015`.
68. `evaluarCurvaUsuario`: con el fixture `SINT_INV` (abajo) y la curva `[5,5,6,8,11,14,13,12,10,7,5,4]` → `eat_en_muestra_por_anio = [{2024, 4.6, 1.0}, {2025, 5.8, 1.6}]`, `eat = 5.2`, `error_max = 1.3`, `en_muestra = true`, `igual_a = null`; con la curva exactamente igual a `A` → `igual_a = "A"`; la EAT se calcula contra `anios[].participacion` de los años `en_ajuste` (un año imputado se compara con su curva imputada, como las candidatas) y nunca contra el año en curso, que solo alimenta `eat_parcial` (`validacionParcial` con sus atípicos); sin años de ajuste → `eat = null` y `eat_en_muestra_por_anio = []`.
69. `curvaDesde`: `{ tipo: "candidata", referencia: "A" }` devuelve la curva de `A` en porcentaje (cuatro decimales); `"anio", "2024"` la `participacion_real ?? participacion` de 2024; `"vigente", "v2"` la curva vigente; una referencia inexistente → `null`.

**`esquemas.ts` y `reglas.ts`**

70. `aprobarCurvaSchema`: `modelo = "U"` sin `curva_usuario` → `400`; `modelo = "A"` con `curva_usuario` → `400`; `partida` sin `U` → `400`; con `U` y doce valores válidos → pasa y `parametros` siguen siendo obligatorios y estrictos.
71. **Tipos antes que filas**: `esModeloAprobable("U")` es `true`; `aVigenteResumen`, `versionesDeAgrupacion`, `aCurvaVigente` y `aCurvaAprobada` devuelven `modelo = "U"` (no `"A"`) para una fila `U`, con `origen_curva = "usuario"` y `curva_manual` leída de la columna; para una fila del sistema, `origen_curva = "sistema"` y `curva_manual = null`; `esModeloCurva("U")` sigue siendo `false` (el `?modelo=` de la URL y las candidatas no admiten `U`).
72. `motivoRechazoAprobar` con `U`: inactiva → `agrupacion_inactiva`; bloqueante → `prerrequisitos`; con `origen = null` (ni propias ni `T`) **no** rechaza *(supuesto, pregunta 1)*; huella distinta → `datos_cambiados`; `version_vigente` distinta → `vigente_cambiada`; vigente `U` con la misma huella y los mismos doce valores normalizados (max |Δ| < `TOLERANCIA_IGUAL`) → `sin_cambio`; vigente `U` con la misma huella y otros valores → sigue; nota vacía → `nota_requerida` con "aprobaste tu propia curva (U)"; `candidata_no_disponible` nunca con `U`.
73. `filaCurva` con `U`: `modelo = "U"`, `origen = "propia"`, `recomendada = false`, `eat`/`error_max` = promedio en muestra a dos decimales (o `null` sin años), `curva_manual` con `valores_ingresados` tal cual, `partida`, `en_muestra`, `eat_en_muestra_por_anio`, `igual_a`; `anios_utilizados.recomendada_entonces` = la recomendada del cálculo; `huellasDeCurva` devuelve las tres huellas (M7 intacto); `armarFoto` añade a `resultado.agrupaciones[0].candidatas` la entrada `U` con `eat_por_pliegue = []` y `pruebas = 0`, y `resumen.curva_usuario`; una foto de una aprobación del sistema no lleva ninguna entrada `U`.

**Estado, lista, foto y M7**

74. **Estático**: `composicion.ts` y `curva-usuario.ts` no importan de `@supabase/*` ni de React; solo `consultas.ts` nombra `venta_composicion_agrupacion`; existe `src/app/api/curvas/agrupaciones/[id]/composicion/route.ts` y abre con `requirePlanner`; la `0021` no contiene `drop`, `delete`, `truncate` ni `update` fuera de comentarios; ningún archivo de `src/` escribe `origen = 'usuario'`.
75. Una vigente `U` da `estado = al_dia_distinta` (no es la recomendada), `sistemaHoy` → `{ tipo: "distinta", texto: "A (vs U)" }`, y la obsolescencia la evalúa con las mismas huellas que a cualquier curva (`carga_nueva`, `composicion_cambiada`, `tienda_entra_red`…); `temporada_recompuesta` es aviso (es `propia`).
76. **Ver foto** de una versión `U`: `curva_de_la_foto.modelo = "U"`, la candidata `U` de la foto se encuentra en `resultado.candidatas`, el comparador frente a la curva de esa foto da `eat_vs_vigente = 0` y `difiere = false`, y la tabla de candidatas de la foto muestra la fila `U` con "en muestra".
77. **M7 sin cambios**: `leerVigentesProy` con una vigente `U` devuelve su `curva`, `curva_id` y `version` y **no** devuelve `eat_por_pliegue` (la entrada `U` de la foto lo trae vacío): el fixture de `tests/proyeccion.*` con una curva `U` no falla y la fila queda "sin backtesting"; `GET /api/curvas/vigentes` lleva `origen_curva = "usuario"` y `acumulada[11] = 1`.
78. `construirSeries` con `extras`: Mi curva y los GML marcados aparecen después de la propuesta en el orden de dibujo, encendidos por defecto, solo en modo participación; `filasCsvAnioMes` incluye la fila "Mi curva" y su diferencia cuando existe.

## Casos de prueba sintéticos

Continúan los de la 06b (el último es el 31). Fixture **`SINT_INV`** (invierno, `tests/curvas.composicion.fixture.ts`): tres GML, cuatro equivalencias activas: `HOMBRE · URBANO · CASACA` (G1: `E1`, `E2`), `HOMBRE · URBANO · CHOMPA` (G2: `E3`), `HOMBRE · FORMAL · ABRIGO` (G3: `E4`, genérica). Dos tiendas en la red todos los años; 2024 y 2025 normales y completos (sin periodos en el fixture, confirmados sin atípicos), 2026 en curso. Unidades por año: 2024 G1 600, G2 350, G3 50 (total 1 000); 2025 G1 660, G2 385, G3 55 (total 1 100). Forma mensual en % (ene…dic): **S** (G1 y G2 en 2024) = `4 4 6 8 12 14 14 12 10 7 5 4`; **S′** (G1 y G2 en 2025) = `4 4 6 8 10 16 14 12 10 7 5 4`; **D** (G3 ambos años) = `10 12 14 14 12 8 6 5 5 5 5 4`. Las tres suman 100.

32. **Pesos y totales**: `armarComposicion` da pesos 0.60 / 0.35 / 0.05 en 2024 y 2025; `Σ unidades` por año = 1 000 y 1 100 = `resultado.anios[].unidades`; la equivalencia `E4` lleva las 50 y 55 unidades de G3.
33. **Curva de la agrupación y ruido**: 2024 = `0.95·S + 0.05·D` = `4.3 4.4 6.4 8.3 12.0 13.7 13.6 11.65 9.75 6.9 5.0 4.0` (suma 100.0); 2025 = `0.95·S′ + 0.05·D` = igual salvo may 10.1 y jun 15.6; `ruido_normal = EAT(2024, 2025) = |12.0 − 10.1| + |13.7 − 15.6| = 3.8 pp`; `A` = promedio = `4.3 4.4 6.4 8.3 11.05 14.65 13.6 11.65 9.75 6.9 5.0 4.0` (suma 100.0); EAT de `A` fuera de muestra = 3.8 en los dos pliegues (cada pliegue ajusta con un solo año).
34. **GML que se aparta**: umbral = `max(3, 3.8) = 3.8`; `Σ|S − D| = 56` y `Σ|S′ − D| = 60`, así que en 2024 `eat_vs_agrupacion` = G1 `0.05 × 56 = 2.8`, G2 2.8, G3 `0.95 × 56 = 53.2`; en 2025 G1 3.0, G2 3.0, G3 57.0; G3 (peso 0.05 ≥ 0.05) es `distinta` en 2024 y 2025 → `se_aparta = true`; G1 y G2 no (2.8 y 3.0 < 3.8); con `peso_minimo_diagnostico = 0.06`, G3 pasa a `peso_pequeno` y no se aparta; con G3 `distinta` solo en 2025 (si en 2024 pesara 0.04), `se_aparta = false`.
35. **Curva del GML**: la de G3 es `D` (promedio de dos años iguales) y `EAT(D, A) = 5.7 + 7.6 + 7.6 + 5.7 + 0.95 + 6.65 + 7.6 + 6.65 + 4.75 + 1.9 + 0 + 0 = 55.1 pp`; la de G1 = promedio de `S` y `S′` = `4 4 6 8 11 15 14 12 10 7 5 4`.
36. **Pegado**: los casos de la regla 66; además `"4,3\t4,4\t6,4\t8,3\t12\t13,7\t13,6\t11,65\t9,75\t6,9\t5\t4"` → la curva de 2024 (coma decimal, separador tabulador).
37. **Normalización**: `[5,5,6,8,11,14,13,12,10,7,5,2]` (98) → `normalizarA100` → `[5.102, 5.102, 6.122, 8.163, 11.224, 14.286, 13.265, 12.245, 10.204, 7.143, 5.102, 2.041]` (tres decimales mostrados aquí; la pantalla enseña uno y la suma de los valores completos es 100.0); guardada con `normalizarCurva` suma exactamente 1.
38. **EAT en muestra**: curva `[5,5,6,8,11,14,13,12,10,7,5,4]` frente a 2024: `0.7 + 0.6 + 0.4 + 0.3 + 1.0 + 0.3 + 0.6 + 0.35 + 0.25 + 0.1 + 0 + 0 = 4.6 pp` (máx. 1.0 en mayo); frente a 2025: may `|11 − 10.1| = 0.9` y jun `|14 − 15.6| = 1.6` en lugar de 1.0 y 0.3 → `4.6 − 1.3 + 2.5 = 5.8 pp` (máx. 1.6 en junio); promedio `5.2`, `error_max` `1.3`; frente a `A`: `0.7 + 0.6 + 0.4 + 0.3 + 0.05 + 0.65 + 0.6 + 0.35 + 0.25 + 0.1 = 4.0 pp`, mes de mayor cambio enero (+0.7).
39. **Aprobar `U`**: `calcular` → `huella h`; `PUT { modelo: "U", curva_usuario: [5,…,4], partida: { tipo: "pegado" }, huella_calculo: h, version_vigente: null }` sin nota → `409 nota_requerida`; con nota → `201`, curva v1 con `modelo "U"`, `origen "propia"`, `recomendada false`, `eat 5.2`, `curva_manual.valores_ingresados = [5,…,4]`, `p05 = 0.11`, `p06 = 0.14`, foto con la candidata `U` (`eat_por_pliegue = []`) y `resumen.curva_usuario`; repetir el mismo `PUT` con `version_vigente: 1` → `409 sin_cambio`; cambiar un valor (`[5,5,6,8,11,14,13,12,10,7,4,5]`) → v2; `PUT` de `A` después → v3 del sistema con `curva_manual = null`.
40. **Lista, foto y M7**: tras 39, la lista da `al_dia_distinta` con `recomendada_entonces = "A"`, `vigente.modelo = "U"`, `origen_curva = "usuario"`; publicar un mes → `obsoleta` (`carga_nueva`) igual que una curva del sistema; "Ver foto" de v1 compara con su propia curva (diferencia 0.0) y muestra la fila `U` en muestra; `leerVigentesProy` sobre el fixture devuelve la curva de v1 sin `eat_por_pliegue`; `GET /api/curvas/vigentes` suma 1 y `acumulada` termina en 1.
41. **Composición con parámetros**: `tiendas_excluidas = [T2]` cambia `p_red`, los totales por año y los pesos sin cambiar `huellaRed`; `anios_excluidos = [2024]` deja `anios_curva = [2025]` en los tres GML y `se_aparta` de G3 se decide solo con 2025 (`distinta` → sigue `true`); un prerrequisito bloqueante (`sin_venta`) → `409 prerrequisitos` sin tocar la función SQL.

## Hito de prueba (para recorrer con Cowork, usuario planner; nada se escribe salvo en los pasos marcados ✍️)

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todas las anteriores más `tests/curvas.composicion.*` y `tests/curvas.curva-usuario.*`), `npm run build` y `scripts/validar-migraciones-local.sh` en verde; `0021` aplicada dos veces en `vector-two` (`select venta_composicion_agrupacion(null, '{}') ? 'nodos'` → `true`; `curva_manual` en `curvas_estacionalidad`); tipos regenerados; `APP_VERSION` con la etiqueta definitiva (nota de versión); PLAN §4 (tabla de `curvas_estacionalidad` y función nueva), DECISIONES, CHANGELOG, la cabecera de la 06b y `docs/pruebas/cowork-checklist.md` (sección D, pasos 15 a 22) actualizados.

**Prerrequisitos de Javier**: los de la 06b cumplidos (periodos del Niño creados, las 15 con curva o en camino).

**Recorrido** (continúa la numeración de la sección D del checklist; agrupación de invierno de hombre con 14 equivalencias, cifras agregadas sin nombres)

15. [ ] **Composición visible.** Al abrir la agrupación, la cabecera dice "14 equivalencias activas en N GML · Ver composición" y la tarjeta **Composición de la agrupación** aparece en **menos de 1 s** después del cálculo (anotar `duracion_ms`), con una fila por GML, su nivel (GML/GMLE), unidades y % por año (8 · 9 · 9 · 10 tiendas: la suma de unidades de cada año coincide con el "Total" de la tabla año × mes de ese año), EAT frente a la agrupación en 2024 y 2025 y la mini curva; el total por año da 100 %.
16. [ ] **Desplegar un GML**: se ven sus equivalencias con unidades y % por año; una equivalencia inactiva con venta (si la hay) aparece atenuada con "cuenta en la curva"; "Descargar CSV" abre en Excel con las mismas columnas.
17. [ ] **Ver en el gráfico**: marcar "ver" en un GML lo dibuja en **Curvas de la agrupación** con su etiqueta y lo quita al desmarcar; "Pequeños múltiplos" muestra una tarjeta por GML con sus años y la curva de la agrupación en discontinuo.
18. [ ] **Se aparta**: si algún GML lleva ⚠ **Se aparta**, su EAT supera el umbral indicado (max(3, ruido)) en todos sus años de ajuste y pesa ≥ 5 %; el enlace "Reasignar en M3" abre Agrupaciones de estacionalidad en la pestaña Asignación; al volver, la composición se vuelve a pedir y la huella coincide con la del cálculo. Si ninguno se aparta, anotar el mayor EAT visto.
19. [ ] **Parámetros y composición**: excluir una tienda de la red cambia las unidades y pesos de la composición en **menos de 1 s** (misma huella que el cálculo nuevo); "Restablecer" los devuelve.
20. [ ] **Mi curva**: "Definir mi curva" abre el editor; "Partir de A" rellena los doce valores y la fila `U` de candidatas dice "Igual a A"; cambiar mayo a +2 y junio a −2 → la suma sigue en 100.0, la fila `U` muestra "EAT … en muestra · ruido …", Mi curva aparece en el gráfico y en la tabla con su diferencia; escribir 98 de suma → la suma sale en alerta y "Normalizar a 100 %" la arregla; pegar doce valores copiados de Excel (una fila y una columna, con coma decimal) rellena la tabla; pegar once da el mensaje "se esperaban 12 valores".
21. [ ] ✍️ **Aprobar mi curva** (solo con autorización de Javier en este paso, en una agrupación que él elija): elegir `U`, pulsar Aprobar sin nota → "nota requerida"; con nota → `confirm` con los doce valores, "en muestra", qué proponía el sistema y la diferencia con la vigente; "Curva del usuario aprobada como versión N"; la vista muestra "Aprobada vN (U)" igual a Mi curva (diferencia 0.0); la lista dice "Al día · vN · U · curva del usuario (el sistema proponía A)"; en Versiones, badge **Curva del usuario**; "Ver foto" dibuja esa curva con su fila `U` y diferencia 0.0.
22. [ ] **Contrato con M7**: `/api/curvas/vigentes` sigue devolviendo 15 filas; la de la agrupación del paso 21 trae `modelo: "U"`, `origen_curva: "usuario"`, `curva` que suma 1 y `acumulada`; en `/planificacion/proyeccion`, recalcular una proyección en trabajo reparte esa agrupación con la curva nueva ("la curva cambió" si una fila usaba la anterior) y la prueba dentro de muestra de M7 muestra "sin backtesting" para ella, sin error.

Además, en cada paso: la versión del pie del menú es la definitiva de esta entrega, y no hay errores en la consola del navegador.

## Qué se reutiliza y qué se extiende

**Sin cambios**: el modelo (`modelo.ts`, `candidatas.ts`, `backtesting.ts`, `atipicos.ts`, `efecto.ts`, `red.ts` salvo exportar `diagnosticarTiendas` ya pública), `huellas.ts` (la curva del usuario **no** entra en la huella: es una decisión, no una entrada), `prerrequisitos.ts`, `obsolescencia.ts`, `cache-venta.ts` (se reutiliza el patrón), `venta_estacionalidad_agrupacion`, `GET /api/curvas/red-comparable`, `/api/periodos-atipicos*`, Años Niño, M7 entero. **Se extiende**: `tipos-api.ts` (`MODELOS_APROBABLES`, `ModeloAprobable`, `CurvaManualApi`, `ComposicionAgrupacionApi`, `origen_curva`, `en_muestra` opcional en `CandidataApi`), `esquemas.ts`, `reglas.ts`, `trabajo.ts` (`armarFoto`, `armarRedPorAnio`), `consultas.ts` (`leerVentaComposicion`, `leerArbolDeAgrupacion`), `lectura.ts` (contexto compartido con `composicion`), `series.ts`, `vista.ts`, `trabajo-vista.ts` (`cuerpoAprobar` con `U`), los componentes listados en "Pantalla". **Nuevo**: `composicion.ts`, `curva-usuario.ts`, la ruta `composicion`, `composicion-card.tsx`, `use-composicion.ts`, `curva-usuario-editor.tsx`, la migración `0021`.

## Fuera de alcance

- Curva propia por equivalencia (la composición muestra unidades y peso de cada equivalencia, no su curva: con 140 equivalencias la lectura y la pantalla se multiplican; si hace falta, segunda entrega sobre la misma función con `p_grano = 'equivalencia'`).
- Reasignar desde M6 (se enlaza a M3; que M3 abra "Por agrupación" con la agrupación preseleccionada vía `?agrupacion=` es una mejora mínima de M3, opcional, no prerrequisito).
- Bloquear meses al normalizar (fijar unos y repartir el resto solo entre los demás), deshacer/rehacer en el editor, guardar borradores sin aprobar en la base (el borrador vive en `sessionStorage`), varias curvas del usuario en paralelo.
- Que la curva del usuario entre en `recomendar`, en el backtesting fuera de muestra o en la banda mín–máx.
- Mostrar en M7 la etiqueta "curva del usuario" (M7 ya funciona sin cambios; la etiqueta es cosmética y usaría `origen_curva`).
- Lo diferido en la 06b (umbrales editables, "Comparar las obsoletas", temporada en línea).

## Riesgos

- **Tipos antes que datos**: si se aprueba una fila `U` antes de ampliar `esModeloCurva`/`aVigenteResumen`, la lista la mostraría como `A`. Mitigación: regla 71 y orden de construcción (tipos y lectores primero, `PUT` al final).
- **EAT en muestra leída como fuera de muestra**: una curva copiada de `A` y retocada parecerá "mejor" que `A` por construcción. Mitigación: la pantalla, el `confirm`, la foto y las versiones dicen siempre "en muestra"; la EAT fuera de muestra de la candidata igual se muestra al lado; M7 no recibe `eat_por_pliegue` de una `U`.
- **Composición pesada en agrupaciones grandes** (una de toda temporada con más de 100 equivalencias y 30 GML): la función devuelve GML × mes y equivalencia × año (pocas filas) y no equivalencia × tienda × mes; se mide en el hito. Si pesara, la tarjeta se pide solo al desplegarla.
- **Un GML "se aparta" por composición de equivalencias, no por estacionalidad** (por ejemplo, una equivalencia nueva con venta solo desde 2025): la tabla por año lo deja ver (distinto solo en 2025 → no se aparta) y el peso mínimo filtra los pequeños; sigue siendo diagnóstico.
- **`modelo = 'U'` sin `check`** en la base: una fila con un `modelo` arbitrario escrita por SQL se leería como `A`. Mitigación: comentario en la columna y el test estático de que `ningún archivo escribe origen 'usuario'`; añadir un `check` exigiría `DROP` y no se hace.
- **Sin transacción al aprobar** (igual que la 06b): una foto con candidata `U` y sin curva es inofensiva.

## Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

35. **La composición de una agrupación se mide sobre la misma red comparable que su curva.** Una función SQL `jsonb` recibe la red por año decidida por el modelo y devuelve GML × mes y equivalencia × año; los pesos suman exactamente la serie de la agrupación. Descartado: pesos sobre toda la venta (no cuadrarían con la curva); equivalencia × tienda × mes (demasiado para 140 equivalencias).
36. **"GML que se aparta" usa la misma vara que `tienda_distinta`** (EAT frente a la agrupación mayor que `max(piso, ruido)` y peso mínimo) y exige apartarse en todos los años de ajuste. Es diagnóstico; reasignar se hace en M3. Descartado: un umbral fijo en puntos; marcar por un solo año.
37. **La curva del usuario es el modelo `U`**: `modelo = 'U'`, `origen = 'propia'`, `curva_manual` con lo escrito y su procedencia, `recomendada = false`, nota obligatoria, EAT **en muestra** con la misma métrica que las candidatas, foto con la candidata `U` y `eat_por_pliegue` vacío. Sin `DROP` de ninguna restricción. Descartado: `origen = 'usuario'` (exige `DROP CONSTRAINT`); guardar el modelo base como `modelo` (etiquetaría mal la curva y confundiría a M7).

## Preguntas abiertas para Javier (máximo cinco; cada una tiene un valor por defecto que es lo que se construye si no responde)

1. **¿Se puede aprobar una curva del usuario cuando el sistema no tiene curva posible** (agrupación con venta pero sin años de ajuste ni `T`)? *Por defecto: sí*, con EAT "no medible" y el aviso en el `confirm`; es la salida para una agrupación nueva sin histórico. Si prefieres que no, `sin_curva_posible` aplica también a `U`.
2. **Umbral de "se aparta"**: *por defecto* el mismo de las tiendas (EAT > max(3 pp, ruido entre años normales) y peso ≥ 5 %) y en **todos** los años de ajuste. ¿Te sirve, o prefieres que baste un año, o un peso mínimo menor para no perder GML chicos?
3. **Pesos de la composición**: *por defecto* sobre la red comparable de cada año (cuadran con la curva). ¿Quieres además la columna "unidades totales, todas las tiendas" (la cifra de QlikView) al lado?
4. **Borrador de "Mi curva"**: *por defecto* se conserva en el navegador (`sessionStorage`) hasta aprobar o cerrar la pestaña, y no se guarda en la base hasta aprobar. ¿Quieres poder guardar borradores sin aprobar?
5. **Representación en la base**: *por defecto* `modelo = 'U'` con `origen = 'propia'` y `curva_manual`, sin `DROP`. Si quieres que `origen` diga literalmente `usuario`, hace falta `alter table curvas_estacionalidad drop constraint curvas_estacionalidad_origen_check` y volver a crearlo con tres valores: te lo pediría como autorización explícita antes de escribir esa migración.

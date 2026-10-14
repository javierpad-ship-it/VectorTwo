# M11 · Reporte de agrupación GMLE (revisión de la clasificación)

> Estado: **especificado el 2026-10-14, pendiente de aprobación por Javier.** Pedido textual: "hazme un reporte donde aparezca agrupación GMLE detallado, para poder revisarlo, como un módulo dentro del sistema". Módulo de **solo lectura**, sin migración (la `0014` queda libre para el paso 2 de M6). Versión prevista **`0.9.4 · M11`** (la vigente es `0.9.3 · M2b`); commits con prefijo `M11:`. Depende de [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (agrupación por equivalencia, regla de faltante, regla de género) y de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (nivel GML/GMLE del nodo). No cambia ninguna decisión registrada. Datos de ejemplo de esta ficha: inventados.

## Objetivo

Javier acaba de asignar las 2 336 equivalencias a las 19 agrupaciones de estacionalidad (y está uniendo duplicadas), y el 2026-10-14 se crearon 117 genéricas `SIN EQUIVALENCIA` que heredaron la agrupación del nodo (100) o quedaron sin ella porque el nodo mezcla dos (17). Hoy no hay dónde **ver cómo quedó cada agrupación**: el Mapa de M3 resume por agrupación, Faltantes solo lista lo que no tiene agrupación, y nada cruza la agrupación con el **nivel de planificación** (GML/GMLE) de 02b, que es lo que decide si M7 lee el nodo como una unidad (curva mezclada) o cada equivalencia por separado.

Este módulo entrega un reporte con tres vistas (resumen por agrupación, detalle plano por equivalencia y revisión de anomalías), filtros, orden y descarga a CSV y Excel, para que Javier recorra la clasificación y corrija en M3 lo que encuentre. En Vector-One la clasificación se revisaba fuera del sistema (exportar, mirar en Excel, reimportar); aquí la revisión vive dentro y señala sola lo sospechoso.

## Modelo de datos

**Sin tablas, columnas, vistas ni migración.** Todo se deriva en memoria de lo que ya existe: las cinco tablas del árbol (`genero_mundo_linea.nivel_planificacion` incluido), `agrupaciones_estacionalidad` (con `temporada`) y `agrupacion_estacionalidad_genero`. Es el mismo criterio con el que M3 calcula los faltantes en memoria: las reglas de vigencia (`nodoVigente`) y de faltante (`motivoFaltante`) viven en TypeScript y una vista SQL las duplicaría, exigiría `revoke` y una migración para un dato que no se guarda.

Definiciones que el código debe respetar (todas sobre el universo **vigente**: equivalencia activa, nodo vigente —nodo, género, mundo y línea activos—; lo inactivo se muestra si se pide, pero no cuenta ni genera anomalías, regla 8 de M3):

| Concepto | Definición |
|---|---|
| **Nodo** | `genero_mundo_linea` (GML). Lleva `nivel_planificacion`: `GML` (por defecto) o `GMLE`. |
| **Unidad de planificación** | Lo que M7 proyecta como una fila. Nodo `GML` con al menos una equivalencia vigente = **una** unidad (sus equivalencias se resumen). Nodo `GMLE` = **una unidad por equivalencia vigente**, genérica incluida. Nodo sin equivalencias vigentes = cero unidades. |
| **Reparto del nodo** | Conteo de equivalencias vigentes por agrupación dentro del nodo (las sin agrupación o con agrupación inactiva cuentan en `sin`). |
| **Agrupación del nodo GML** | `unica` si todas sus equivalencias vigentes con agrupación activa comparten una; `mixta` si hay dos o más; `sin` si ninguna tiene. En un nodo `GMLE` no se calcula: cada equivalencia es su propia unidad y que haya varias agrupaciones es justamente lo esperado. |
| **Agrupación mayoritaria** | En cualquier nodo: la agrupación con más equivalencias vigentes **reales** (la genérica no vota, porque heredó la suya "por mayoría" y votaría por sí misma). Empate → ninguna (`null`). Nodo cuya única equivalencia es la genérica → la de la genérica. |
| **Línea partida** | Par género · línea (todos sus mundos) cuyas equivalencias vigentes están en 2 o más agrupaciones activas. |

Por qué un nodo GML repartido es `mixta` y no "la de su genérica" ni "la mayoritaria": `curvaUnidad` (02b, regla 13) mezcla las curvas de sus equivalencias ponderadas por venta, así que el nodo **no tiene** una agrupación: tiene una curva compuesta. Eso puede ser deliberado o un descuido, y es justo lo que Javier quiere revisar; la mayoritaria se muestra al lado como ayuda. Tomar la de la genérica sería circular (se le asignó por herencia el 2026-10-14) y hoy 17 genéricas no tienen ninguna precisamente porque su nodo es mixto.

### Anomalías

Seis códigos (`AnomaliaGmle`). Una fila puede llevar varios. Ninguna es un error del sistema: son avisos para revisar, con prioridad sugerida.

| Código | Grano | Definición | Prioridad |
|---|---|---|---|
| `sin_agrupacion` | equivalencia | Faltante de M3 (`motivoFaltante` ≠ `null`: sin agrupación o agrupación inactiva). | alta |
| `genero_no_incluido` | equivalencia | Su agrupación no incluye el género del nodo (`generoPermitido` falso). Solo puede venir de antes de `0005` o del SQL Editor. | alta |
| `generica_discrepante` | equivalencia | Genérica con agrupación distinta de la mayoritaria del nodo (solo si hay mayoritaria). | media |
| `nodo_gml_mixto` | nodo | Nodo de nivel `GML` con reparto en 2+ agrupaciones activas. Se marca en el nodo y en todas sus equivalencias. | media |
| `linea_partida` | línea | Género · línea con equivalencias en 2+ agrupaciones. Se marca en todas sus equivalencias. | baja |
| `agrupacion_vacia` | agrupación | Agrupación **activa** sin equivalencias vigentes. | baja |

Lo que no es anomalía, a propósito: un nodo `GMLE` con equivalencias en varias agrupaciones; una genérica en un nodo donde es la única equivalencia; una agrupación inactiva vacía; una línea en dos mundos con agrupaciones distintas cuando cada nodo es `unica` (sale como `linea_partida` de prioridad baja y el detalle muestra los mundos para juzgarla: pregunta 1).

### Diagrama

```
genero_mundo_linea (nivel GML | GMLE) ──► equivalencias (es_generica, activo, agrupacion_estacionalidad_id)
        │                                        │
        │                                        └─► agrupaciones_estacionalidad (temporada, activo) ◄─ agrupacion_estacionalidad_genero
        ▼
aplanarEquivalencias (M3, incluirInactivos) + nivel del nodo ─► armarReporteAgrupacionGmle (pura) ─► { resumen, agrupaciones[], nodos[], equivalencias[], lineas_partidas[] }
                                                                                                        └─► filtros/orden/descarga en el navegador
```

## Contratos de API

Una sola lectura. Convenciones de M1 a M6: `{ data }` con `ok()`, `{ error }` con `error()` (`src/lib/api/respuestas.ts`), `Cache-Control: no-store`, errores `401` sin sesión · `403` sin perfil, inactivo o comprador · `500` error de base no previsto. Sin cuerpo, sin zod (no hay parámetros: los filtros se aplican en el navegador, como en la lista plana de M3; 2 336 filas son ~400 KB, del orden de `GET /api/estacionalidad/equivalencias`).

| Ruta | Método | Guard | Respuesta |
|---|---|---|---|
| `/api/reportes/agrupacion-gmle` | GET | **`requirePlanner`** | el reporte completo (abajo). El comprador recibe `403`. |

**Guard `requirePlanner` y no `requireUser`**: aunque las lecturas de M3 son `requireUser`, este reporte es una herramienta de revisión de la planificación, cruza el nivel de planificación de 02b (cuya API es `requirePlanner`) y no tiene uso para el comprador. La prueba estática de guards (`tests/api.guards.estatico.test.ts`) lo cubre al existir la ruta.

**Lectura.** El handler llama a `cargarEstadoEstacionalidad(db)` (`src/lib/estacionalidad/consultas.ts`), que ya lee las cinco tablas del árbol, las agrupaciones y los vínculos de género con `leerTodo` (páginas de 1 000, orden estable). Los nodos llegan con `nivel_planificacion` (`select("*")`). **No hace falta ningún `.in()` por tandas**: no se filtra por ids; si algún día un filtro pasa al servidor, se hace con `TANDA_IN = 150` como en el resto. Después: `aplanarEquivalencias(estado, agrupacionesConGeneros(estado), { incluirInactivos: true })` y la función pura.

**Función pura** `armarReporteAgrupacionGmle(reporteM3, nodos)` en `src/lib/reportes/agrupacion-gmle.ts` (carpeta nueva `src/lib/reportes/` con `tipos-api.ts`, `filtros.ts` y `descargas.ts`; sin importar nada de `@supabase/*` ni de componentes). Entrada: el `ReporteEstacionalidad` de M3 con inactivos (trae `genero_id`, `mundo_id`, `linea_id`, `vigente`, `agrupacion`, `faltante`, `motivo_faltante`, `es_generica`, los catálogos y las agrupaciones con `genero_ids` y `temporada`) más `nodos: { id, nivel_planificacion }[]`. Reutiliza `nivelDeNodo`, `generoPermitido`, `compararOrdenNombre`, `compararNombre`, `ETIQUETA_TEMPORADA`. Determinista: no muta la entrada y el orden de salida es fijo (regla 9).

```jsonc
{ "data": {
  "resumen": { "agrupaciones": 19, "agrupaciones_activas": 19, "nodos": 556, "nodos_gml": 530, "nodos_gmle": 26,
               "nodos_gml_mixtos": 41, "unidades": 612, "equivalencias": 2336, "genericas": 403,
               "anomalias": { "sin_agrupacion": 17, "genero_no_incluido": 0, "generica_discrepante": 9,
                              "nodo_gml_mixto": 41, "linea_partida": 23, "agrupacion_vacia": 1 } },
  "agrupaciones": [
    { "id": "…", "codigo": "PANT_INV", "nombre": "PANTALONES INVIERNO", "temporada": "invierno", "activo": true,
      "generos": [ { "id": "…", "nombre": "HOMBRE" } ],
      "nodos_gml": 12, "nodos_gml_mixtos": 3, "unidades_gmle": 4, "equivalencias": 140, "genericas": 11, "lineas": 6,
      "anomalias": [] } ],                                    // o ["agrupacion_vacia"]
  "nodos": [
    { "id": "…", "genero_id": "…", "mundo_id": "…", "linea_id": "…", "ruta": "HOMBRE / URBANO / PANTALON",
      "nivel": "GML", "vigente": true, "unidades": 1,
      "agrupacion_nodo": "mixta",                             // "unica" | "mixta" | "sin" | null (GMLE)
      "agrupacion_id": null, "mayoritaria_id": "…",
      "reparto": [ { "agrupacion_id": "…", "equivalencias": 5 }, { "agrupacion_id": "…", "equivalencias": 2 }, { "agrupacion_id": null, "equivalencias": 1 } ],
      "anomalias": ["nodo_gml_mixto"] } ],
  "equivalencias": [
    { "id": "…", "nodo_id": "…", "agrupacion_id": "…", "agrupacion": "PANTALONES INVIERNO", "temporada": "invierno",
      "genero": "HOMBRE", "mundo": "URBANO", "linea": "PANTALON", "nivel": "GML", "unidad": "nodo",   // "nodo" | "equivalencia" | "ninguna"
      "equivalencia": "SIN EQUIVALENCIA", "codigo": "SIN_EQUIVALENCIA", "es_generica": true, "activo": true, "vigente": true,
      "agrupacion_activa": true, "anomalias": ["generica_discrepante", "nodo_gml_mixto"] } ],
  "lineas_partidas": [
    { "genero_id": "…", "linea_id": "…", "genero": "HOMBRE", "linea": "PANTALON",
      "agrupaciones": [ { "id": "…", "nombre": "PANTALONES INVIERNO", "equivalencias": 9, "mundos": ["URBANO", "CASUAL"] },
                        { "id": "…", "nombre": "PANTALONES VERANO",   "equivalencias": 4, "mundos": ["FORMAL"] } ] } ],
  "catalogos": { "generos": [ { "id", "nombre", "orden", "activo" } ], "mundos": [ /* idem */ ] }
} }
```

`nivel` del nodo es el guardado aunque el nodo esté inactivo; `unidad` es `"ninguna"` en filas no vigentes. Las filas de `equivalencias` llevan nombres, no solo ids, para que la descarga sea literal; `agrupacion` vacío y `agrupacion_id: null` = sin agrupación. Orden de `equivalencias` y `nodos`: género `orden`, mundo `orden`, línea `nombre`, y dentro del nodo `ordenarEquivalencias` (reales por nombre, genérica al final). `agrupaciones` por nombre (criterio de `0.6.0`). `lineas_partidas` por género y línea.

## Pantallas

**Ruta `/maestros/agrupacion-gmle`**, item nuevo en `nav.ts` dentro de **Maestros**, justo debajo de "Agrupaciones de estacionalidad": `{ href: "/maestros/agrupacion-gmle", label: "Reporte agrupación GMLE", roles: PLANIFICACION }`. Admin y planner lo ven; el comprador no lo ve en el menú, `puedeVerRuta` le niega la URL y `page.tsx` (servidor) hace `redirect("/")` si `perfilActual()` no es `ok` o `!puedeEditarMaestros(rol)`, exactamente como `maestros/estacionalidad/page.tsx`. Va en Maestros y no en Planificación porque revisa datos de maestro (árbol y agrupaciones) y Javier lo usará a continuación de la pantalla de M3; una sección "Reportes" nueva para un solo item no se justifica (pregunta 4). Desde el Mapa y Faltantes de M3 se añade un enlace "Revisar en el reporte GMLE" (una línea, sin otro cambio en M3). El menú de M3 no cambia.

Panel cliente `agrupacion-gmle-panel.tsx` con una sola llamada (`useColeccion` no encaja porque la respuesta no es un array: hook propio `useReporteGmle()` con `api.get`, `cargando`, `error`, `recargar`, como `use-estacionalidad.ts`). Cabecera con el resumen: "19 agrupaciones · 556 nodos (530 GML · 26 GMLE) · 612 unidades · 2 336 equivalencias (403 genéricas) · 91 anomalías" y el botón Recargar.

**Barra de filtros**, compartida por las tres pestañas y aplicada en memoria (`filtros.ts`, funciones puras): `Select` Agrupación (Todas · Sin agrupación · una por nombre, con su conteo), `Select` Género, `Select` Mundo, `Select` Nivel (Todos · GML · GMLE), `Input` texto (busca en línea, equivalencia y código, sin acentos ni mayúsculas), `Chips` Anomalía (Todas · una por código, con conteo), `Switch` Solo genéricas, `Switch` Solo anomalías, `Switch` Incluir inactivos (apagado: solo vigentes). El estado de los filtros vive en el panel; la URL no lo guarda. "Limpiar filtros" a la derecha. Cada pestaña muestra "N de M filas".

**Pestaña Resumen** (`DataTable` ordenable por cualquier columna; orden inicial por nombre). Solo cuenta lo vigente que pase los filtros de género, mundo, nivel, texto y genéricas (así "Resumen con filtro HOMBRE" responde "qué tiene cada agrupación de HOMBRE").

| Columna | Contenido |
|---|---|
| Agrupación | nombre + punto de color (`colores.ts` de M3) + `Badge` Inactiva si aplica |
| Temporada | `ETIQUETA_TEMPORADA` |
| Géneros | chips; "Sin género" en tono alerta |
| Nodos GML | nodos `unica` en esta agrupación |
| GML mixtos | nodos mixtos que la tocan (tono alerta si > 0) |
| Unidades GMLE | equivalencias de nodos GMLE en esta agrupación |
| Equivalencias | vigentes con esta agrupación |
| Genéricas | de las anteriores |
| Líneas | líneas distintas |
| Anomalías | chips (`agrupacion_vacia`) |

Fila final **Sin agrupación** (tono alerta, con "Ir a Faltantes"). Al pulsar una fila se abre debajo el **detalle de la agrupación** (patrón de `conjunto-detalle.tsx`; `DataTable` no expande filas): sus nodos con ruta, nivel, "equivalencias de esta agrupación / del nodo", badge Mixto, y al expandir un nodo sus equivalencias con la genérica marcada. "Ver en Detalle" fija el filtro de agrupación y cambia de pestaña.

**Pestaña Detalle** (plano, una fila por equivalencia, `DataTable` ordenable; orden inicial el del contrato). Columnas, **idénticas a la descarga** (`COLUMNAS_DETALLE`): `AGRUPACION`, `TEMPORADA`, `GENERO`, `MUNDO`, `LINEA`, `NIVEL`, `UNIDAD`, `EQUIVALENCIA`, `CODIGO`, `GENERICA` (Sí/No), `ACTIVA` (Sí/No), `NODO_VIGENTE` (Sí/No), `AGRUPACION_NODO` (Única / Mixta / Sin / — en GMLE), `MAYORITARIA`, `ANOMALIAS` (códigos separados por `; `). En pantalla la genérica lleva badge, las inactivas van atenuadas y las filas con anomalía de prioridad alta resaltadas (`claseFila`).

**Pestaña Anomalías**. Cuatro bloques con conteo en el título, cada uno con su tabla y su descarga, todos respetando la barra de filtros:

1. **Líneas partidas** (género · línea · nº de agrupaciones · "PANTALONES INVIERNO (9: URBANO, CASUAL) · PANTALONES VERANO (4: FORMAL)").
2. **Nodos GML mixtos** (ruta · reparto "5 PANT. INVIERNO · 2 PANT. VERANO · 1 sin" · mayoritaria · nº de equivalencias).
3. **Equivalencias** (`sin_agrupacion`, `genero_no_incluido`, `generica_discrepante`; columnas del Detalle filtradas; chips para elegir el código).
4. **Agrupaciones vacías** (nombre · temporada · géneros).

Cada bloque enlaza a donde se corrige: Asignación o Faltantes de M3 (`/maestros/estacionalidad?pestana=asignacion` o `?pestana=faltantes`), Agrupaciones de M3, o el Árbol para el nivel. Con todo en cero, `EmptyState`: "Sin anomalías con estos filtros."

**Descargas**: en cada pestaña, botones "Descargar CSV" y "Descargar Excel" sobre **lo filtrado y en el orden visible**, con las mismas columnas que la tabla (`descargas.ts`: `COLUMNAS_RESUMEN`, `COLUMNAS_DETALLE`, `COLUMNAS_LINEAS_PARTIDAS`, `COLUMNAS_NODOS_MIXTOS` y sus `filas…()` puras). Reutiliza `generarCsv` / `descargarCsv` (`src/components/importador/csv.ts`, con el escape de fórmulas) y `descargarExcel` (`excel.ts`, SheetJS bajo demanda, hoja `REPORTE`). Nombres: `agrupacion-gmle-{resumen|detalle|anomalias-…}-AAAA-MM-DD.{csv|xlsx}`. Sin acciones de escritura en ninguna parte.

## Reglas de negocio

Todas sobre `armarReporteAgrupacionGmle` o las funciones de `filtros.ts` y `descargas.ts`, probables con vitest y datos sintéticos.

1. **Universo vigente.** Solo equivalencias activas en nodos vigentes cuentan en `resumen`, en los conteos por agrupación y en las anomalías. Una fila inactiva o no vigente sale en `equivalencias` con `activo`/`vigente` en falso, `unidad: "ninguna"` y `anomalias: []`.
2. **Unidades.** Nodo `GML` vigente con ≥ 1 equivalencia vigente → `unidades = 1`; nodo `GMLE` → `unidades` = número de equivalencias vigentes; sin equivalencias vigentes → 0. `resumen.unidades = Σ nodos.unidades`.
3. **Agrupación del nodo.** Solo en `GML`: `unica` (una sola agrupación activa en el reparto, sin contar `sin`), `mixta` (dos o más), `sin` (ninguna); en `GMLE`, `null`. `agrupacion_id` solo se llena con `unica`.
4. **Mayoritaria.** Sobre equivalencias vigentes reales con agrupación activa; empate → `null`; si no hay reales con agrupación, la de la genérica si la tiene, si no `null`.
5. **Conteos por agrupación.** `equivalencias` = vigentes con ese `agrupacion_id` (aunque la agrupación esté inactiva); `nodos_gml` = nodos con `agrupacion_nodo = "unica"` y ese id; `nodos_gml_mixtos` = nodos mixtos cuyo reparto la incluye; `unidades_gmle` = equivalencias vigentes de nodos `GMLE` con ese id; `lineas` = líneas distintas de esas equivalencias. Invariantes: `Σ agrupaciones.equivalencias + (equivalencias vigentes con agrupacion_id nulo) = resumen.equivalencias` (las que apuntan a una agrupación inactiva cuentan en su agrupación y además como `sin_agrupacion`), y `Σ agrupaciones.unidades_gmle + (unidades GMLE cuya equivalencia no tiene agrupación) + nodos GML con unidades = resumen.unidades` (corregido tras la implementación: las equivalencias de nodos GMLE sin agrupación también son unidades y no cuentan en ninguna agrupación).
6. **Anomalías por definición exacta** de la tabla de arriba. `nodo_gml_mixto` y `linea_partida` se propagan a todas las equivalencias vigentes del nodo o de la línea; `agrupacion_vacia` solo a agrupaciones activas; `generica_discrepante` exige mayoritaria no nula y distinta; una genérica sin agrupación lleva `sin_agrupacion` y no `generica_discrepante`. `resumen.anomalias[c]` cuenta filas del grano de `c` (líneas, nodos, equivalencias o agrupaciones), no equivalencias propagadas.
7. **Un nodo GMLE nunca es `nodo_gml_mixto`**, y una línea partida se evalúa con los nodos de todos sus mundos.
8. **La regla de faltante es la de M3**: `sin_agrupacion` ⇔ `faltante` de `aplanarEquivalencias` (una prueba lo compara fila a fila sobre la fixture).
9. **Determinismo.** Misma entrada → misma salida (igualdad profunda); la entrada no se muta; el orden es el del contrato.
10. **Filtros componibles.** `filtrarReporte(filas, filtros)` es la conjunción de todos los filtros; con filtros vacíos devuelve todo; "Solo anomalías" ⇔ `anomalias.length > 0`; "Incluir inactivos" apagado ⇔ `activo && vigente`; el texto normaliza acentos y mayúsculas.
11. **Descarga = tabla.** Para cada vista, `COLUMNAS_*.length` = longitud de cada fila de `filas*()`, en el mismo orden que las columnas de la `DataTable` (la prueba compara contra la lista de `clave` de las columnas de pantalla, como `tests/estacionalidad.descarga-faltantes.test.ts`); el CSV pasa por `generarCsv` y una equivalencia llamada `=SUMA(1)` sale escapada.
12. **Seguridad.** El handler abre con `requirePlanner` (prueba estática global); `puedeVerRuta("comprador", "/maestros/agrupacion-gmle")` es falso y para admin y planner verdadero (`tests/nav.test.ts`); la página redirige al comprador; ninguna ruta de escritura nueva.

## Criterios de aceptación / hito de prueba

Automático: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (con `tests/reportes.agrupacion-gmle.test.ts`, `tests/reportes.agrupacion-gmle.fixture.ts`, `tests/reportes.agrupacion-gmle.filtros.test.ts`, `tests/reportes.agrupacion-gmle.descargas.test.ts` y la ampliación de `nav.test.ts`; fixture **sintética**: géneros HOMBRE/MUJER, mundos URBANO/FORMAL, líneas PANTALON/POLO/CASACA, nodos GML y GMLE, agrupaciones A, B, C, una vacía, una inactiva y una sin género; nunca datos de Lukers) y `npm run build` en verde. Las reglas 1 a 12 tienen al menos una prueba cada una.

Hito que recorren QA (Chromium, tres roles) y Javier (Railway, datos reales):

1. Como comprador: el item no aparece en el menú, `/maestros/agrupacion-gmle` redirige a `/` y `GET /api/reportes/agrupacion-gmle` responde `403`. Como admin y planner: se ve y carga en menos de 3 s.
2. La cabecera muestra 19 agrupaciones, 2 336 equivalencias y 403 genéricas (cifras del 2026-10-14; si Javier siguió uniendo agrupaciones, las que haya), y la suma de "Equivalencias" del Resumen más "Sin agrupación" da el total.
3. Resumen: abrir una agrupación y ver sus nodos con nivel y reparto; una con "GML mixtos" > 0 muestra el nodo con badge Mixto y su mayoritaria.
4. Detalle: filtrar por Agrupación + Género, buscar una línea, ordenar por LINEA; descargar CSV y Excel y comprobar en Excel que las columnas y el número de filas coinciden con lo visible.
5. Anomalías: las 17 genéricas sin agrupación salen en `sin_agrupacion`; los nodos que las contienen salen en Nodos GML mixtos; corregir una en Asignación de M3, Recargar y ver que desaparece de los dos bloques.
6. Cambiar un nodo mixto a GMLE en el Árbol, Recargar: deja de ser `nodo_gml_mixto`, sus equivalencias pasan a `unidad: "equivalencia"` y el conteo de unidades sube.
7. Unir dos agrupaciones duplicadas en M3 (mover y desactivar): la desactivada aparece Inactiva con 0 equivalencias y no cuenta como `agrupacion_vacia`; una activa recién creada sin equivalencias sí.
8. "Incluir inactivos": aparecen atenuadas las equivalencias inactivas, sin anomalías y sin cambiar los conteos de la cabecera.
9. Anotar cuántas líneas partidas y nodos mixtos son deliberados: es el insumo para la pregunta 2.

## Fuera de alcance

- **Escribir desde el reporte** (asignar, mover, cambiar nivel, unir agrupaciones): se hace en M3 y en el Árbol; el reporte solo enlaza. Un enlace a Asignación con filtros prellenados exigiría que M3 lea parámetros de URL que hoy no lee; si Javier lo pide, es una mejora de M3.
- **Peso por venta** (qué equivalencias de un nodo mixto pesan de verdad): vendría de M5 (`venta_stock_vigente`) y convertiría la lectura en una agregación; queda para cuando M6 paso 2 tenga la vista materializada (columna "unidades 12 m" en el Detalle).
- **Curvas, corridas y el efecto de la mezcla** (`curvaUnidad`): M6 paso 2 y M7.
- **Marcas relevantes y conjuntos por nodo** (02b): otro reporte si hace falta.
- **Guardar filtros en la URL, paginar en servidor o persistir el reporte**: no con 2 336 filas.
- **Corrección automática** de genéricas discrepantes o de líneas partidas: toda escritura sigue siendo decisión del planner en M3.

## Preguntas abiertas para Javier

Ninguna bloquea el arranque: cada una tiene valor por defecto y cambiarla después es una regla y su prueba.

1. **Línea partida: ¿por género · línea (todos los mundos) o por nodo?** Por defecto género · línea, mostrando los mundos de cada agrupación; si prefieres que PANTALON de FORMAL pueda ir aparte de PANTALON de URBANO sin aviso, la regla pasa a nodo y el bloque 1 se funde con el 2.
2. **Nodo GML mixto: ¿aviso a revisar o error a corregir?** Por defecto aviso (prioridad media), porque 02b permite la curva mezclada; si decides que un nodo GML debe tener una sola agrupación (o abrirse a GMLE), pasa a prioridad alta y se resalta como `sin_agrupacion`.
3. **Genérica discrepante: ¿comparar con la mayoría de las reales (por defecto) o debe la genérica seguir siempre a la mayoritaria?** Lo segundo sería una escritura automática y queda fuera de este módulo; dímelo y se abre como mejora de M3.
4. **Ubicación: Maestros, debajo de "Agrupaciones de estacionalidad" (por defecto), o una sección "Reportes" nueva** para este y los que vengan (M8). Es una línea en `nav.ts`.

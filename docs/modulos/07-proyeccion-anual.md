# M7 · Proyección anual de unidades (rediseño desde cero)

> Estado: **especificada de nuevo el 2026-10-15, pendiente de aprobación por Javier.** Reemplaza al borrador del 2026-10-13 (que suponía la lógica de proyección de Vector-One) y a su nota del 2026-10-14. Javier: *"hasta M6 sirvió Vector-One; de M7 en adelante se diseña casi desde cero"*. Lo único que se conserva del borrador son las respuestas del dueño (sección 0) y los contratos que M6, 06b y 02b ya ofrecen. Migración prevista **`0018_proyeccion_anual.sql`** (la siguiente libre tras la `0017`; si M6 tomara la `0018` para su variante sobre la vista materializada, M7 pasa a la `0019` y `datos` lo anota aquí); versión **`0.10.0 · M7`** (después de `0.9.7 · M6`, la 06b); commits con prefijo `M7:`. Depende de [05-venta-stock](05-venta-stock.md) (hechos mensuales por tienda × equivalencia × marca × talla), [06b-curvas-trabajo-por-agrupacion](06b-curvas-trabajo-por-agrupacion.md) y [06-curvas-estacionalidad](06-curvas-estacionalidad.md) (curva vigente por agrupación con versión y huellas, curva acumulada, `claseDeAnio`, red comparable por fechas, factor de volumen del Niño por temporada a demanda), [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (`nivel_planificacion` GML/GMLE, `curvaUnidad`, vista `marcas_unidad`), [04-tiendas](04-tiendas.md) (fechas de apertura y cierre, `venta_esperada_promedio`; esta ficha le añade la tienda de referencia) y [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (temporada). Toda la API, lecturas incluidas, es `requirePlanner` (criterio de M5 y M6). Ningún dato real de Lukers en esta ficha: nombres y cifras son sintéticos; las observaciones sobre la base real van como agregados sin nombres (45 meses cargados, 2023-01 a 2026-09; 10 tiendas más el CD; 15 agrupaciones de estacionalidad activas; red comparable 8 / 9 / 9 / 10 tiendas por año). Es el primer módulo en el que el `analista-planeamiento` revisa fórmulas (sección 5) y casos sintéticos (sección 9) antes de construir; el `arquitecto-revisor` (opus) revisa esta ficha antes de abrir la construcción.

## 0. Respuestas del dueño conservadas del borrador anterior (2026-10-14)

Se transcriben tal como quedaron registradas; son la base de la sección 2.

- **Nivel de decisión:** *"el volumen lo quiero definir por GML - Agrupación de marcas"*. La fila donde Javier decide el volumen es **GML × agrupación de marca** (en los nodos abiertos a GMLE, la equivalencia ocupa el lugar del GML). Las marcas relevantes por GML y "otras" quedan como **desglose dentro de esa fila**, no como el nivel de decisión.
- **Proyección del resto del año en curso:** *"para proyectar el resto del año debería calcular el avance del año entre el avance de la estacionalidad de la línea para proponer las unidades totales a vender de las GML-AM"*: total propuesto del año = unidades vendidas a la fecha ÷ suma de la curva hasta el último mes cerrado; resto = total − vendido, repartido con la curva. Cuidados anotados: años Niño (la curva normal sobreestima el total del verano de 2026 porque el avance real ya viene adelantado), no extrapolar con avance de curva bajo (~30 %), solo meses cerrados y conciliados, quiebres de stock.
- **Proyección del año siguiente:** *"para la proyección del año siguiente, mismas tiendas, debería pedirme un estimado de crecimiento de unidades para la venta anual y dividirla entre los meses por la estacionalidad"*: base = unidades del último año de las **mismas tiendas** por GML × agrupación de marca; el planner ingresa un porcentaje de crecimiento; total = base × (1 + crecimiento); reparto mensual con la curva del GML (`curvaUnidad`). Medida: **unidades**; horizonte: año siguiente completo.
- **De M6 (2026-10-14):** el factor de volumen del año Niño es **calculado por M6 y editable en M7**; el valor editado vive en M7. Desde la 06b el factor se calcula **a demanda por temporada** (`GET /api/periodos-atipicos/anios?temporada=&con_volumen=1`), sin corrida de referencia. M6 entrega además la **curva acumulada** por agrupación (`acumulada[12]` en `GET /api/curvas/vigentes`); la mezcla de curvas de las equivalencias de un GML y sus pesos son de M7.
- **Curvas vivas (2026-10-14):** cada plan guarda la versión de curva que usó; si después se aprueba otra, M7 avisa "la curva cambió" y ofrece recalcular el reparto mensual mostrando el impacto; un total ya decidido no cambia por una curva nueva, solo su reparto.

## 1. Objetivo

Proyectar, en **unidades anuales**, el **año en curso completo** y el **año siguiente completo**, por **GML × agrupación de marca**, separando en cada año las **mismas tiendas** (las que operaron los doce meses del año anterior), las **tiendas nuevas** y los **cierres**. El planner trabaja **ordenado, una línea a la vez** (Parte 1: filtra género, mundo y línea; ve el histórico de unidades por año en un gráfico y una tabla; el sistema le propone el cierre del año en curso como vendido ÷ avance de la curva, y el año siguiente como ese cierre, normalizado si fue año Niño, por el crecimiento que él escribe; él decide cada cifra) y después mira la **matriz** (Parte 2: una fila por género · mundo · línea con la venta a la fecha, lo proyectado de mismas tiendas, de tiendas nuevas y del año siguiente, con totales por mundo, género y compañía y la composición de cada bloque de tiendas). No hay ventanas móviles ni horizonte de meses: los meses aparecen solo cuando cada total anual se reparte con la curva vigente de M6, en la **vista mensual** (Parte 3: solo lectura, meses reales y proyectados distinguidos, con los mismos filtros y exportación a Excel), que es el contrato que consume M8. Nada se aprueba en bloque; la proyección cerrada es el único insumo de volumen de M8.

## 2. Decidido por Javier (2026-10-14 y 2026-10-15)

1. **El volumen se define por GML × agrupación de marca (GML-AM), en unidades.** En un nodo GMLE, por equivalencia × agrupación de marca. Marcas relevantes, "otras" y marcas al barrer son desglose, no decisión.
2. **Resto del año en curso:** cierre = unidades vendidas del año ÷ avance acumulado de la curva de la agrupación hasta el último mes cerrado → unidades totales a vender por GML-AM; el resto se reparte por los meses con la curva.
3. **Año siguiente con las mismas tiendas:** el sistema pide un estimado de crecimiento de unidades para la venta anual (base = mismas tiendas) y lo reparte por los meses con la curva.
4. **Las curvas no están escritas en piedra:** M7 usa la versión vigente y avisa "la curva cambió" si una fila guardada usó otra versión.
5. **Las aperturas de tiendas se tratan aparte**, fuera de la base de mismas tiendas.
6. **El año Niño se normaliza con el factor por temporada de M6:** invierno año completo en 2023 y 2026; verano de setiembre a diciembre.
7. **El planner revisa y decide; nada se aprueba en bloque.**
8. **Se proyectan unidades anuales; los patrones mensuales salen siempre de las curvas aprobadas en M6.** M7 nunca calcula ni guarda una curva propia: aplica la vigente (o la mezcla de vigentes de un GML) a un total anual, también en tiendas nuevas y cierres.
9. **Tiendas nuevas: el volumen se define por la venta esperada de la tienda** (`tiendas.venta_esperada_promedio`, M4) **y cada tienda puede tener una tienda de referencia**, aquella a cuya composición de venta (mezcla por GML, agrupación de marca, género) debe parecerse. Ejemplo de Javier: la tienda de El Sol vende mucha ropa de hombre formal, pero es un caso particular; una tienda nueva no debe heredar la composición promedio de la red sino la de la tienda que se le parece. Sin referente, la composición de la red de mismas tiendas.
10. **El objetivo es el año en curso y el año siguiente completo, en unidades anuales; no hay horizonte móvil de meses.** Prevalece sobre cualquier versión anterior. Dos partes: **Parte 1, análisis detallado por línea** (filtro género, mundo, línea; gráfico y tabla con el histórico de unidades por año y el monto proyectado de cada año) y **Parte 2, la matriz** (punto 12).
11. **Regla de "mismas tiendas" (por año proyectado):** para proyectar el año `Y`, las mismas tiendas son las **abiertas los doce meses del año `Y−1`**, con la lógica de red comparable de M6 por fechas de apertura y cierre. Ejemplo de Javier: en 2026 la base es la red que operó todo 2025; Jirón de la Unión (abrió en noviembre de 2025) va aparte como tienda nueva en 2026; para 2027 Jirón **ya entra** en mismas tiendas porque estuvo abierta todo 2026; una tienda que abre a mitad de 2026 se ve separada en 2027 y entra en mismas tiendas recién en 2028. El conjunto cambia según el año proyectado y la matriz muestra esa composición (desplegable con las tiendas de cada bloque). Una tienda abierta en el año en curso tiene venta real parcial más la proyección del resto.
12. **Parte 2 es una matriz**: una fila por género · mundo · línea; columnas: venta a la fecha (unidades del año en curso), venta proyectada de mismas tiendas, venta de tiendas nuevas, venta del año siguiente, venta de las tiendas abiertas en el periodo en curso y venta en unidades de tiendas nuevas (del año siguiente); totales por género, mundo y compañía; definición precisa de cada columna sin solapes (sección 4, paso 5).
13. **La matriz lleva filtros** (género, mundo, línea y los útiles que proponga esta ficha: temporada, agrupación de estacionalidad, agrupación de marca, solo líneas con tiendas nuevas, solo sin proyectar u obsoletas) **y exportación a Excel** que respeta los filtros activos, con SheetJS cargado bajo demanda como el reporte M11, solo para admin y planner (el comprador no la ve ni la descarga).
14. **Parte 3: vista mensual, solo como dato.** La venta mensual en unidades del año en curso y del año siguiente, mensualizada con las curvas vigentes de M6: en el año en curso, los meses cerrados con su real y los restantes proyectados, distinguidos visualmente; el año siguiente con doce meses proyectados. Solo lectura, mismos filtros y exportación a Excel, sin edición. **Es lo que consume M8 (flujo de mercadería)**: su contrato de datos es por género · mundo · línea · agrupación de marca · mes, con bloque de tiendas (mismas, nuevas, cierres) y origen del dato (real o proyectado).

De fichas anteriores y sin cambio: la unidad de planificación es GML o GMLE según `nivel_planificacion` (02b); la curva de un GML es la mezcla ponderada de las curvas de sus equivalencias (`curvaUnidad`); la unidad de marca es la cabeza del conjunto (`marcas_unidad`); las curvas se calculan sobre la red comparable de cada año (06); toda la API de planificación es `requirePlanner`.

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Proyección** | El objeto de trabajo: `anio_en_curso` (`Y`, el de `k`) y `anio_siguiente = Y + 1`, nombre, parámetros, filas, bloques de tiendas, estado `en_trabajo` → `cerrada` → `archivada`. **Una sola `cerrada` por año en curso**: lo que M8 lee. |
| **Unidad de planificación (`u`)** | Nodo GML vigente (`nivel = GML`, `equivalencia_id = null`) o una equivalencia activa de un nodo `GMLE`. Id: `(gml_id, equivalencia_id \| null)`. |
| **Fila (`f`)** | Unidad × agrupación de marca de la **unidad de marca** (`marcas_unidad`: la cabeza del conjunto o la marca misma; nunca la del miembro). Donde Javier decide. Incluye **toda** la venta de esa unidad en esa agrupación (relevantes, "otras" y al barrer): cuadra con la venta real del nodo. Universo: filas con al menos una unidad vendida en cualquier tienda en los últimos 24 meses publicados (~1 000 a 1 500). |
| **Bloques de tiendas de un año `Z`** (`Z ∈ {Y, Y+1}`) | **Mismas tiendas `M(Z)`**: tipo Tienda, activas, `fecha_apertura ≤ 1 de enero de Z−1` y (sin `fecha_cierre` o `fecha_cierre ≥ 31 de diciembre de Z`). **Tiendas nuevas `N(Z)`**: tipo Tienda, activas, `fecha_apertura > 1 de enero de Z−1` y `≤ 31 de diciembre de Z`, sin cierre antes del 31 de diciembre de `Z`. **Cierres `C(Z)`**: tipo Tienda, activas, con `fecha_cierre` entre el 1 de enero de `Z−1` y el 30 de diciembre de `Z` que vendieron algo en `Z−1` o `Z` (cerraron durante `Z` o durante `Z−1`, por lo que no estuvieron los doce meses). Fuera de todo bloque: el CD, las desactivadas, las sin apertura (bloquea si tienen venta) y las Planificadas más allá de `Z`. Cada tienda está a lo sumo en un bloque por año; los bloques de `Y` y `Y+1` son distintos (regla 1). |
| **Fila de bloque** | Cada fila `f` tiene, por año, un registro para `M(Z)` (la fila base) y, aparte, un registro por cada tienda de `N(Z)` y `C(Z)` (filas de tienda). Las decisiones de Javier son sobre la fila base de cada año y sobre el total de cada tienda nueva o cierre por año (sección 4). |
| **Total vigente** | `decidido ?? propuesto` de un registro. |
| **Último mes cerrado (`k`)** | `hastaPorDefecto` de M6: último mes publicado en M5 y terminado en Lima. `hasta_periodo` de la proyección arranca ahí y solo se puede retroceder dentro del año en curso. |
| **Tienda de referencia** | `tiendas.tienda_referencia_id` (columna nueva de M4): la tienda a cuya composición debe parecerse una tienda nueva. Su composición sale de sus propios hechos, nunca de su referente (sin cadenas). Sin referente: composición de `M(Z)`. |
| **Composición de una tienda (o de un bloque)** | Participación `s_f` de cada fila en los **soles** y precio medio `p_f` (soles ÷ unidades) por fila, sobre los 12 meses cerrados hasta `k`, con los meses del Niño normalizados por el factor de su temporada. |
| **Curva de la fila** | `curvaUnidad(u)` (02b): GMLE → la curva vigente de su agrupación; GML → mezcla ponderada de las curvas de sus equivalencias con pesos = unidades por equivalencia en los 12 meses cerrados hasta `k` sobre `M(Y)`. Todas las filas de una unidad comparten curva, también las de tiendas nuevas y cierres. `curva_origen` guarda `[{ agrupacion_id, curva_id, version, peso }]`. |
| **Agrupación dominante y temporada** | La agrupación de estacionalidad de mayor peso en la unidad (empate: nombre). Da la `temporada` y, con `claseDeAnio`, los **meses atípicos** `A(Z)` de cada año. Si una unidad GML mezcla temporadas: aviso `temporadas_mezcladas`. |
| **Factor del Niño `φ(Z, temporada)`** | Ratio de volumen del año atípico `Z` frente al año normal más cercano, por temporada (`ratio_volumen` de `/anios?con_volumen=1`). Vive en `factores_volumen_atipico` (calculado y editable; `ratio_aplicado ?? ratio_calculado`). `todo_el_ano` nunca se ajusta. |
| **Propuesta / Decisión** | La propuesta la calcula el sistema y se rehace en cada cálculo. La decisión la fija Javier (`decidido`, origen `propuesta` si aceptó la cifra tal cual o `manual`, nota) y sobrevive a cualquier recálculo. |
| **Reparto mensual** | Doce enteros que suman el total vigente, con la curva (mayor resto). En el año en curso, los meses ≤ `k` son el real y solo se reparte el resto. En tiendas nuevas y cierres la curva se multiplica por la rampa (apertura y maduración) o por la fracción abierta hasta el cierre. Es lo que M8 lee. |

## 4. Flujo de pantalla del planner (UX primero)

Ruta **`/planificacion/proyeccion`**, item "Proyección de unidades" en la sección Planificación de `nav.ts` (`PLANIFICACION`: admin y planner; el comprador no lo ve y la página lo redirige). Pestañas: **Por línea** (Parte 1) · **Matriz** (Parte 2) · **Mensual** (Parte 3) · **Tiendas nuevas y cierres** · **Factores del Niño**. Los filtros de la Matriz y de Mensual son los mismos y van en la URL (`&genero=&mundo=&linea=&temporada=&agrupacion_estacionalidad=&agrupacion_marca=&solo=`), de modo que cambiar de pestaña conserva el recorte. La proyección abierta va en la URL (`?proyeccion=<id>`), los filtros de la Parte 1 también (`&genero=&mundo=&linea=`), la fila abierta (`&fila=<id>`) y la tienda (`&tienda=<id>`), como `?agrupacion=` en 06b. Kit: `Card`, `DataTable`, `Chips`, `Select`, `Modal`, `Alert`, `Badge`, `EmptyState`, `Switch`, `mini-curva` de M6; hook propio `use-proyeccion.ts` (patrón `useResponsables`); formato `es-PE` de `src/lib/formato.ts` en servidor y pantalla.

**Paso 0 · Entrar.** Cabecera con la proyección en trabajo ("Proyección 2026–2027 · datos hasta 2026-09 · 2026: 9 mismas tiendas, 1 nueva (T10) · 2027: 10 mismas, 1 nueva (T12) · 1 312 filas: 418 decididas en 2026, 402 en 2027") o `EmptyState` con **Nueva proyección**; selector para abrir otra (cerradas y archivadas en solo lectura). Tarjeta **Antes de proyectar**: bloquea sin meses publicados, con una tienda con venta sin fecha de apertura o sin ninguna tienda en `M(Y)`; avisa N agrupaciones con venta sin curva vigente, curvas obsoletas en M6, factor del Niño sin calcular para un año atípico, año siguiente marcado atípico, tiendas nuevas sin venta esperada o sin referente, referente sin doce meses cerrados, nivel de nodo cambiado. *Decide*: con qué proyección trabajar y si corrige algo antes.

**Paso 1 · Nueva proyección.** `Modal`: nombre (por defecto "Proyección 2026–2027"), "Datos hasta" (arranca en `k`), crecimiento por defecto del año siguiente (0 %; al lado, la tendencia del último año completo como referencia), rampa de maduración por defecto (`[0,70, 0,85, 1]`), "copiar decisiones de" otra proyección del mismo año. Debajo, la **composición de los bloques** que el sistema deduce de M4 (2026: mismas T01–T09; nueva T10 abrió 2025-11; 2027: mismas T01–T10; nueva T12 abre 2027-03-15; cierres: ninguno) con enlace a Tiendas. Al crear se calcula. *Decide*: parámetros de partida; si los bloques no son los que espera, corrige fechas en M4.

**Paso 2 · Parte 1, elegir una línea.** Pestaña Por línea: tres `Select` (Género · Mundo · Línea, opcionales; el buscador acepta "DENIM") y un índice lateral de líneas con su estado (sin proyectar · parcial · proyectada · curva cambió) para avanzar en orden. La vista de la línea:

```
HOMBRE · URBANO · DENIM                 datos hasta 2026-09 · curvas: DENIM HO v2 (100 %) · 2026 mismas tiendas: 9 · 2027: 10     [← anterior] [siguiente →]
┌ Unidades por año (mismas tiendas de cada año; 2026 = vendido + resto; 2027 = proyección) ─────────────────────────────────┐
│ 60 000 ┤                                                   ▒▒▒▒                                                              │
│ 50 000 ┤                            ████       ████  ░░░░  ▒▒▒▒                                                              │
│ 40 000 ┤        ████       ████     ████       ████  ░░░░  ▒▒▒▒       █ real   ░ resto propuesto   ▒ año siguiente           │
│        └────────2023───────2024─────2025───────2026────────2027──    (banda vertical: Niño en 2023 y 2026 si es de invierno) │
│         34 100     38 900    42 300   31 980+12 874      49 080                                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ Filas de la línea (GML × agrupación de marca) ─────────────────────────────────────────────────── [CSV] [Ver meses ▸] ┐
│ Agrup. marca   2023    2024    2025    2026 vendido  Avance  2026 propuesto  2026 decidido  Crec.  2027 propuesto  2027 decidido │
│ RECONOCIDO     14 500  15 310  16 480  12 480        71,3 %  17 504          [17 504] ✓     [5 %]  20 395          [20 395] ✓    │
│ MID VALUE       9 800  11 200  12 100   9 040        71,3 %  12 679          [       ]      [5 %]  14 820          [       ]      │
│ VALOR           6 400   7 900   8 600   6 310        71,3 %   8 850          [ 9 200 ] ✓ n   [8 %]  11 050          [       ]      │
│ PREMIUM         2 900   3 600   4 200   3 100        71,3 %   4 348          [       ]      [5 %]   5 072          [       ]      │
│ ULTRA LOW         500     890     920   1 050        71,3 %   1 473          [       ]      [0 %]   1 640          [       ]      │
│ Línea (mismas) 34 100  38 900  42 300  31 980                44 854          2 de 5         —      52 977          1 de 5        │
│ Tiendas nuevas 2026 (T10): vendido 3 420 · proyectado 4 760 · Cierres 2026: —   ·   Tiendas nuevas 2027 (T12): 484  → pestaña   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Explicación (RECONOCIDO): 2026 → vendido ene–set 12 480 (9 tiendas) ÷ avance 71,3 % (DENIM HO v2) = 17 504; resto oct–dic 5 024 (1 540 ·
1 610 · 1 874). 2027 (10 tiendas) → base = cierre 2026 mismas 17 504 + T10 en 2026 1 920 = 19 424; 2026 no es Niño para toda temporada;
× 1,05 = 20 395, repartido con DENIM HO v2. Prueba con 2025: a set-2025 el método habría dado 16 210; el real fue 16 480 (−1,6 %).
```

Cada celda "decidido" se edita en línea: escribir y Enter, o **Aceptar** (toma la propuesta); `n` = nota. El crecimiento por fila sustituye al de la proyección solo en la propuesta de 2027. "Ver meses" despliega los doce meses de cada año (real en gris, proyectado en cursiva), solo para ver. *Decide*: para cada fila, el total 2026 (mismas tiendas) y el total 2027 (mismas tiendas), y el crecimiento que alimenta la propuesta.

**Paso 3 · Abrir una fila.** `&fila=` muestra el detalle: serie mensual de cada año (como el gráfico de M6 pero en unidades), tabla año × mes con clase (normal · Niño · en curso) y las tiendas del bloque, stock de fin de mes con la señal de quiebre (`cobertura < 0,25`), curva usada y origen (agrupaciones, pesos, versión), la prueba con el año anterior, y los bloques **Tu decisión 2026** y **Tu decisión 2027** (cifra, Aceptar, nota, Volver a la propuesta; en 2026 el mínimo es lo vendido). Para una fila de invierno en 2026: "2026 es año Niño en invierno: el cierre no cambia (la curva se aplica al vendido real) pero la base de 2027 se normaliza: 4 300 ÷ 0,66 = 6 515 × 1,03 = 6 710". Para una de verano: "setiembre es mes Niño (verano ×1,24): set ÷ 1,24 antes de dividir por el avance; oct–dic × 1,24". Si el año siguiente estuviera marcado atípico en M6: "2027 marcado como Niño (invierno): × 0,66 (factor editable en Factores del Niño)". *Decide*: lo mismo que en la tabla, con toda la explicación delante.

**Paso 4 · Tiendas nuevas y cierres (pestaña).** Dos secciones por año. Una tarjeta por tienda; arriba lo de M4 con atajo (`PATCH` de M4): fecha de apertura o cierre, venta esperada, **tienda de referencia**. Debajo, por año, la explicación y la decisión:

```
2027 · T12 · SAN MIGUEL · abre 2027-03-15 · venta esperada S/ 85 000 / mes · referente: T03 (SOL)                 [Cambiar en Tiendas]
┌ Cómo se calculó ─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Composición de T03 (oct-2025 a set-2026; invierno 2026 ÷ 0,66, set ÷ 1,24 en verano), 412 filas:              │
│   HOMBRE FORMAL CAMISA × RECONOCIDO 6,1 % de los soles · precio medio S/ 89 → 69 u / mes maduro                │
│   HOMBRE URBANO DENIM × RECONOCIDO 4,2 % · S/ 118 → 30 u / mes maduro · …                                       │
│ Año maduro completo: S/ 1 020 000 → 9 850 u                                                                   │
│ 2027: abre el 15 de marzo (marzo cuenta 17/31) · maduración mar 70 % · abr 85 % · may 100 % (de la proyección) │
│   → cada fila: unidades maduras × curva de M6 × rampa → 6 930 u en 2027                                        │
│ Referencia: con la composición de las mismas tiendas de 2027 serían 7 410 u                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Unidades de T12 en 2027  [ 6 930 ]  [Aceptar la propuesta] [Guardar esta cifra]  Nota [________]
Filas de T12 (412) · GML × agrup. marca · % composición · u / mes maduro · 2027 propuesto · Ene … Dic · Decidido (opcional)

2026 · T10 · JIRÓN · abrió 2025-11-20 · tienda nueva en 2026 (no estuvo todo 2025); en 2027 pasa a mismas tiendas
│ Vendido ene–set 2026: 3 420 u (9 meses cerrados, rampa cumplida) → resto por su propio avance: 3 420 ÷ 71,3 % = 4 797;             │
│ oct–dic 1 377 · (por venta esperada y referente T03 serían 1 290) · Propuesta 2026: 4 797                                            │
Unidades de T10 en 2026  [ 4 797 ]  [Aceptar] …

Cierres · 2027 · T05 · cierra 2027-06-30 (último día con venta) · no está en mismas tiendas de 2027
│ Composición propia (oct-2025 a set-2026) · año maduro 12 400 u · abierta 6/12 → cada fila × curva ene–jun → 5 580 u en 2027 │
Unidades de T05 en 2027  [ 5 580 ]  [Aceptar] …
```

Sin venta esperada, la propuesta es `null` y Javier puede escribir el total igual (se reparte con la composición y las curvas). Sin referente: "composición de las mismas tiendas"; referente sin doce meses cerrados → aviso y mismas tiendas. Una tienda nueva con meses reales en el año en curso: los meses cerrados son reales; para el resto, si tiene al menos tres meses cerrados después de la rampa, se propone **por su propio avance** (vendido ÷ `C_k`, fila a fila) y la cifra por venta esperada se muestra como referencia; con menos, por venta esperada y referente (supuesto a validar, decisión 3 de la sección 14). Cambiar el total de la tienda escala sus filas en proporción; una fila se puede fijar a mano. Las filas de tiendas nuevas y cierres **no entran** en las filas base de la Parte 1; la matriz las suma en sus propias columnas. *Decide*: el total de cada tienda nueva y de cada cierre, por año.

**Paso 5 · Parte 2, Matriz.** Una fila por género · mundo · línea (desplegable por género y mundo; fila Compañía arriba), unidades siempre, sin solapes. Las columnas, en el orden de Javier, con su definición y de dónde sale cada celda:

| # | Columna | Definición exacta | De dónde se llena |
|---|---|---|---|
| 1 | **Venta a la fecha** (`Y`) | Unidades reales de enero a `k` del año en curso, **todas las tiendas** (mismas + nuevas + cierres + fuera de bloque). Es la cifra que Javier concilia con QlikView. | Σ `vendido` de las filas base de `Y` + Σ `vendido` de las filas de tienda de `Y` + `fuera_bloque` (informativo, normalmente 0) |
| 2 | **Proyección mismas tiendas** (`Y`) | Total vigente del año en curso de las filas base: vendido de `M(Y)` + resto proyectado o decidido. | Σ `vigente` (año `Y`) de las filas base de la línea (Parte 1, columna "2026 decidido" o, si no, "propuesto") |
| 3 | **Tiendas abiertas en el periodo en curso** (`Y`) | Total vigente del año en curso de las tiendas de `N(Y)`: su venta real a `k` más el resto proyectado. | Σ `vigente` (año `Y`) de las filas de tienda nueva de la línea (pestaña Tiendas nuevas) |
| 3b | Cierres (`Y`) | Total vigente del año en curso de `C(Y)` (real hasta el cierre más, si el cierre es futuro, el resto hasta esa fecha). Columna oculta si es 0 en toda la matriz. | filas de cierre de `Y` |
| = | **Total `Y`** | 2 + 3 + 3b. La columna 1 es la parte real de este total, no se suma. | |
| 4 | **Proyección mismas tiendas** (`Y+1`) | Total vigente del año siguiente de las filas base: `M(Y+1)` (incluye las que en `Y` eran nuevas y estuvieron todo `Y`). | Σ `vigente` (año `Y+1`) de las filas base (Parte 1, "2027 decidido / propuesto") |
| 5 | **Tiendas nuevas** (`Y+1`) | Total vigente del año siguiente de `N(Y+1)`: las que abren en `Y+1` y las que abrieron en `Y` después del 1 de enero (siguen nuevas). | Σ `vigente` (año `Y+1`) de las filas de tienda nueva |
| 5b | Cierres (`Y+1`) | `C(Y+1)`: tiendas que cierran durante `Y+1` (abiertas hasta esa fecha). Oculta si es 0. | filas de cierre de `Y+1` |
| = | **Total `Y+1`** y **variación** `Total Y+1 ÷ Total Y − 1` | 4 + 5 + 5b | |
| · | **Estado** de la línea | `sin_proyectar` · `parcial` (N de M filas decididas por año) · `proyectada` · `curva_cambio` · `propuesta_cambio` | `estadoLinea` |

**Filtros de la matriz** (barra superior, los mismos que en Mensual): Género · Mundo · Línea (`Select`, opcionales), Temporada y Agrupación de estacionalidad (de la agrupación dominante de la unidad), Agrupación de marca (recorta las cifras a esa agrupación), y `Chips` **Solo**: con tiendas nuevas · sin proyectar · parciales · curva cambió · propuesta cambió · cola larga. Los totales por mundo, género y compañía se recalculan sobre lo filtrado y el pie dice "N líneas de M; 62 % del total de 2026". **Exportar a Excel** (botón, SheetJS cargado bajo demanda como en M11, generado en el navegador a partir de lo ya cargado): hoja `MATRIZ` con las filas visibles y los totales, hoja `BLOQUES` con las tiendas de cada bloque por año y hoja `FILTROS` con los filtros activos y la fecha de datos; el archivo se llama `proyeccion-2026-2027-matriz.xlsx`. Solo admin y planner (la ruta de datos es `requirePlanner`; el comprador no ve la pestaña ni obtiene datos para exportar).

Encima de la matriz, la **composición de los bloques** (desplegable): "2026 · mismas tiendas (9): T01 … T09 · nuevas (1): T10, abrió 2025-11-20 · cierres: — │ 2027 · mismas (10): T01 … T10 · nuevas (1): T12, abre 2027-03-15 · cierres (1): T05, cierra 2027-06-30", con el motivo por tienda y enlace a Tiendas. Totales por mundo, género y compañía son sumas de sus líneas. Vista alternativa **por agrupación de marca** (las mismas columnas con una fila por agrupación de marca × género). Al pulsar una línea se va a la Parte 1 con los filtros puestos; al pulsar una celda de tiendas nuevas, a la pestaña de tiendas. En la matriz no se decide nada.

```
Matriz · Proyección 2026–2027 · datos hasta 2026-09     Filtros: [Género ▾] [Mundo ▾] [Línea ▾] [Temporada ▾] [Agrup. marca ▾] Solo: (con tiendas nuevas) (sin proyectar) (curva cambió)
▸ Composición de los bloques                                                                                       [Por agrupación de marca] [Exportar a Excel]
                      2026 venta   2026 mismas   2026 tiendas   Total 2026   2027 mismas   2027 tiendas   Total 2027   Var.     Estado
                      a la fecha   tiendas       nuevas (T10)                tiendas       nuevas (T12)
Compañía              1 201 700    1 612 400     52 300         1 664 700    1 762 900     46 100         1 809 000    +8,7 %   parcial
 HOMBRE                 493 100      660 100     21 900           682 000      722 400     18 300           740 700    +8,6 %   parcial
  URBANO                171 300      228 900      7 400           236 300      250 600      6 200           256 800    +8,7 %   parcial
   DENIM                 35 400       44 854      4 797            49 651       52 977        484            53 461    +7,7 %   parcial 2/5 · 1/5
   POLO                  30 100       39 020      3 100            42 120       43 600        310            43 910    +4,2 %   proyectada ▲ curva cambió
```

**Paso 5b · Parte 3, Mensual (solo lectura; el contrato de M8).** La misma matriz, pero por mes: cada fila género · mundo · línea (desplegable a agrupación de marca) muestra los doce meses del año en curso y los doce del siguiente, **mensualizados con las curvas vigentes de M6**. En el año en curso, los meses cerrados llevan el **real** (fondo gris, cifra en redonda) y los restantes el **proyectado** (cursiva, fondo blanco, con una línea vertical en `k`); en el año siguiente, doce meses proyectados. Conmutador de bloque: **Mismas tiendas · Tiendas nuevas · Cierres · Todas** (por defecto Todas, que es la suma). Filtros idénticos a la Matriz; `Switch` "mostrar por agrupación de marca". No hay ninguna celda editable: lo que se ve es el reparto de los totales vigentes decididos o propuestos en la Parte 1 y en Tiendas nuevas y cierres. **Exportar a Excel** respeta los filtros y el bloque: hoja `MENSUAL` (una fila por género · mundo · línea · agrupación de marca · bloque, columnas `2026-01 … 2026-12`, `2027-01 … 2027-12`, más `TOTAL_2026`, `TOTAL_2027` y una columna `ORIGEN_2026` con `real:9/proy:3`), hoja `BLOQUES` y hoja `FILTROS`; nombre `proyeccion-2026-2027-mensual.xlsx`. Una fila sin curva vigente sale con el total en la columna de total y los meses vacíos (no en cero), con el aviso `sin_curva` en una columna `AVISOS`.

```
Mensual · Proyección 2026–2027 · datos hasta 2026-09 · bloque: (Todas) (Mismas) (Nuevas) (Cierres)   Filtros: HOMBRE · URBANO · —      [Exportar a Excel]
                        2026 ene   feb    mar    abr    may    jun    jul    ago    set  │ oct    nov    dic    Total 26 │ 2027 ene   feb   …   dic    Total 27
HOMBRE URBANO DENIM     3 980     3 720  4 100  4 420  4 710  5 010  5 180  5 090  4 650 │ 5 040  5 260  6 112  57 272   │ 4 530     4 240  …  6 980   53 461
  RECONOCIDO            1 190     1 110  1 250  1 350  1 450  1 540  1 600  1 580  1 410 │ 1 540  1 610  1 874  17 504   │ 1 388     1 300  …  2 183   20 395
  MID VALUE               …
HOMBRE URBANO POLO        …                                                              │                                │
(real en gris hasta setiembre · proyectado en cursiva desde octubre · 2027 todo proyectado)
```

*Decide*: nada; mira y exporta. Lo que M8 lee de aquí es exactamente el contrato de `GET /api/proyeccion/cerrada` (sección 7): filas por género · mundo · línea · agrupación de marca (y equivalencia si el nodo es GMLE) · bloque de tiendas · tienda (en nuevas y cierres) · año, con `meses[12]` y `origen_meses[12]` (`real` o `proyectado`).

**Paso 6 · Cuando cambian los datos.** Publicar un mes en M5, aprobar una curva en M6, editar un factor, cambiar el nivel de un nodo, las fechas, la venta esperada o el referente de una tienda marcan la proyección **desactualizada** con el motivo. **Recalcular** rehace bloques, propuestas, composiciones, curvas y repartos y **conserva todas las decisiones**; las filas decididas cuya propuesta se movió quedan con `propuesta_cambio` ("decidiste 4 300 aceptando 4 168; hoy la propuesta es 4 402"); las que usaron otra versión de curva, con `curva_cambio` ("HO INVIERNO v2 → v3: el reparto oct–dic pasa de 190/180/208 a 185/182/211"). Si una tienda cambia de bloque (una fecha corregida en M4), las decisiones de sus registros se conservan con aviso `bloque_cambiado`. El total decidido nunca cambia solo. *Decide*: revisar o no esas filas.

**Paso 7 · Cerrar.** Botón **Cerrar proyección**: el `confirm` resume filas decididas y sin decidir por año, cola larga que se cerrará con la propuesta, tiendas nuevas y cierres sin decidir, avisos. Bloquea si queda sin decidir, en cualquiera de los dos años, una fila base con propuesta ≥ `umbral_cola_larga`, o una tienda nueva con venta esperada o un cierre; `?forzar=1` solo salta el aviso de desactualizada. Al cerrar, la `cerrada` anterior del mismo año pasa a `archivada`; una cerrada es solo lectura (se copia para seguir). *Decide*: cerrar.

**Pestaña Factores del Niño.** Tabla año atípico × temporada (`invierno`, `verano`): ratio calculado por M6 (`tiendas_comunes`, `meses_comparados`, fecha, huella de cargas; `parcial` si el año no está completo), ratio aplicado (editable; vacío = el calculado), nota, quién. **Sincronizar con M6** llama a `/anios?temporada=&con_volumen=1`. Ayuda: "0,66 = en 2026 el invierno vendió un 34 % menos de lo que esperaban las mismas tiendas; al proyectar, los meses del Niño se dividen entre el factor". Editar un factor marca desactualizadas las proyecciones en trabajo.

### Qué decide el planner y qué decide el sistema

| Decisión | Quién | Dónde |
|---|---|---|
| Datos hasta, crecimiento por defecto, rampa de maduración | planner | Nueva proyección / parámetros |
| Qué tiendas son mismas, nuevas o cierres en cada año | sistema (regla 1 sobre las fechas de M4), visible con motivo | Antes de proyectar, Matriz |
| Fechas, venta esperada y referente de cada tienda | planner (M4, con atajo) | Tiendas / pestaña Tiendas nuevas y cierres |
| Composición de una tienda nueva o de un cierre | sistema (hechos del referente, de la propia tienda o de las mismas tiendas) | pestaña Tiendas nuevas y cierres |
| Qué meses son del Niño y con qué factor | planner (catálogo de M6; factor editable aquí) | Factores del Niño |
| Curva de cada fila y el reparto mensual | sistema (`curvaUnidad` sobre la vigente de M6) | detalle y "Ver meses" |
| Propuesta de cada año de cada fila | sistema | Por línea |
| **Total `Y` y total `Y+1` de cada fila base; total por año de cada tienda nueva y de cada cierre** | **planner, una por una** | Por línea / Tiendas nuevas y cierres |
| Crecimiento de una fila (solo alimenta la propuesta) | planner | Por línea |
| Cuándo algo está desactualizado | sistema (huellas y versiones) | chips, Matriz |
| Qué se exporta a Excel | planner (filtros y bloque activos); el archivo se genera en el navegador | Matriz, Mensual |
| Cerrar | planner | Cerrar proyección |

## 5. Método (lógica pura en `src/lib/proyeccion/`, TypeScript sin I/O)

Notación: fila `f` de la unidad `u`; año en curso `Y`, siguiente `Y+1`; `k` = índice (1..12) del último mes cerrado; `v_m` = unidades de la fila en el mes `m` de `Y` sumando solo las tiendas de `M(Y)`, truncadas a 0 después de sumar (aviso `mes_negativo`, como M6 regla 2b); `c = curvaUnidad(u)` (doce fracciones que suman 1) y `C_k = Σ_{j≤k} c_j` (la `acumulada` de M6 cuando la unidad tiene una sola agrupación); `A(Z)` = meses atípicos del año `Z` para la agrupación dominante de `u` (`claseDeAnio`); `φ_Z` = factor de la temporada de `u` en `Z` (`ratio_aplicado ?? ratio_calculado`; si falta y `A(Z)` no está vacío, `φ_Z = 1` y aviso `sin_factor`). Para `todo_el_ano`, `A(Z) = ∅`.

**Paso 0 · Bloques de tiendas (regla 1).** `bloquesDeAnio(tiendas, Z)` clasifica cada tienda de tipo Tienda y activa en `M(Z)`, `N(Z)`, `C(Z)` o fuera, con las fechas de M4 y las definiciones de la sección 3; una tienda sin `fecha_apertura` y con venta bloquea (prerrequisito); el CD queda fuera. Se evalúa dos veces (`Y` y `Y+1`) y el resultado se guarda en la proyección.

**Paso 1 · Cierre del año en curso, fila base (propuesta `P_Y`).**
- `V = Σ_{m≤k} v_m` (vendido real de `M(Y)`). `V' = Σ_{m≤k} v_m ÷ (m ∈ A(Y) ? φ_Y : 1)`.
- `T' = V' ÷ C_k`. Resto: `r_m = T' × c_m × (m ∈ A(Y) ? φ_Y : 1)` para `m > k`.
- `P_Y = V + repartirEntero(round(Σ_{m>k} r_m), r)`; meses `≤ k` = `v_m`, meses `> k` = reparto del resto.
- Si `A(Y)` cubre los doce meses (invierno en 2023 y 2026), el factor se cancela: `P_Y = V ÷ C_k`, la decisión 2 tal cual. Si cubre setiembre a diciembre (verano), setiembre se divide por `φ_Y` antes de dividir por el avance y octubre a diciembre se multiplican por `φ_Y`.
- `C_k < umbral_avance` (0,30) → se calcula igual con aviso `avance_bajo` y la referencia del año anterior al lado. Sin curva → `P_Y = null`, aviso `sin_curva`; Javier escribe el total y el reparto queda sin meses. `V = 0` con venta en `Y−1` → `P_Y = 0`, aviso `sin_venta_anio`.

**Paso 2 · Año siguiente, fila base (propuesta `P_{Y+1}`).**
- Base `B` = total vigente de `Y` de **las tiendas de `M(Y+1)`** = vigente de la fila base de `Y` (`M(Y)`) + Σ vigente de `Y` de las filas de tienda nueva de `Y` cuya tienda está en `M(Y+1)` (las que abrieron en `Y−1` después del 1 de enero y estuvieron todo `Y`; ejemplo: Jirón) − Σ vigente de `Y` de las tiendas de `M(Y)` que no están en `M(Y+1)` (las que cierran en `Y+1`: su `Y` real se resta con su participación por tienda, leída de `por_tienda`). Normalización: `B' = Σ_m b_m ÷ (m ∈ A(Y) ? φ_Y : 1)`, con `b_m` el reparto mensual de `B`; si `A(Y)` cubre todo el año, `B' = B ÷ φ_Y`. Sin total vigente en `Y` → `P_{Y+1} = null`, aviso `sin_base`.
- `g_f` = `crecimiento_pct` de la fila, si no el de la proyección (0 por defecto). `P_{Y+1} = round(Σ_m B' × (1 + g_f) × c_m × (m ∈ A(Y+1) ? φ_{Y+1} : 1))`. `φ_{Y+1}` existe solo si el catálogo de M6 tiene un periodo que cubra `Y+1` para esa temporada (fila `Y+1` en Factores con `ratio_calculado = null`; por defecto el efectivo del último año atípico de la temporada); aviso `objetivo_atipico`.
- Reparto: `repartirEntero(total vigente, c')` con `c'_m ∝ c_m × (m ∈ A(Y+1) ? φ_{Y+1} : 1)`.

**Paso 3 · Reparto entero (`repartirEntero(total, pesos)`).** `m_i = floor(total × w_i)` y el resto, de uno en uno, a los mayores restos fraccionarios (empate: el mes más temprano). Suma exacta. `total = 0` → doce ceros; pesos nulos → `null`.

**Paso 4 · Tiendas nuevas (`N(Z)`).** Para la tienda `t` con apertura `d`, venta esperada `E` (soles por mes de tienda madura) y referente `R` (o `M(Z)` si no hay):
- Composición de `R` sobre `W12` (los doce meses cerrados hasta `k`) con los hechos de `R` solamente: `S_f = Σ_{m∈W12} soles_{f,m} ÷ (m ∈ A(año de m) ? φ : 1)`; `s_f = S_f ÷ Σ_f S_f`; `p_f = S_f ÷ U_f` con `U_f` las unidades normalizadas igual (si `U_f = 0`, `p_f` = precio medio de `R`). Composición de `M(Z)`: lo mismo sumando sus tiendas.
- Unidades maduras por fila: `Md_f = E × 12 × s_f ÷ p_f`. Año maduro de la tienda: `Σ_f Md_f`.
- Rampa `r_m` del año `Z`: 0 antes del mes de apertura; en el mes de apertura, `rampa[0] × días abiertos ÷ días del mes`; luego `rampa[1]`, `rampa[2]`, …; después 1. `rampa` por defecto `[0,70, 0,85, 1]` (supuesto a validar), editable por proyección y por tienda.
- Propuesta de la fila: `P_{t,f,Z} = round(Σ_m Md_f × c_{u,m} × r_m)`; de la tienda: `Σ_f`. Reparto: `repartirEntero(vigente de la fila, c × r)`.
- **Tienda nueva con meses reales en `Y`** (abrió en `Y−1` después del 1 de enero, o en `Y` antes de `k`): meses `≤ k` reales (sus hechos). Resto: si tiene al menos `MESES_MIN_AVANCE = 3` meses cerrados posteriores a la rampa, por **su propio avance** fila a fila (`V_t ÷ C_k`, con la misma normalización del Niño que el paso 1); si no, por venta esperada y referente con `r_m` desde el mes siguiente a `k`. La otra cifra se muestra como referencia. Sin `E` y sin meses reales suficientes: propuesta `null`, aviso `sin_venta_esperada`.
- Decisión por tienda y año `D_{t,Z}`: las filas no fijadas se escalan por `(D − Σ fijadas) ÷ Σ propuestas no fijadas`; si `Σ fijadas > D`, el resto queda en 0 y aviso `fijadas_exceden`.

**Paso 5 · Cierres (`C(Z)`).** Tienda `t` con `fecha_cierre` en `Z` (o en `Z−1`, en cuyo caso en `Z` todo es 0 y solo aparece en `Z−1`): meses `≤ k` reales; meses `> k` hasta el mes del cierre: composición **propia** (sus hechos en `W12`, normalizados, `Md_f` = sus unidades anuales normalizadas) × `c_{u,m}` × `q_m`, con `q_m = 1` antes del mes de cierre, `días hasta el cierre ÷ días del mes` en el mes de cierre y 0 después. Decisión por tienda y año, como en las nuevas. Una tienda que cierra el 31 de diciembre de `Z` sigue en `M(Z)` (vendió todo `Z`) y sale de `M(Z+1)`.

**Paso 6 · Mensualización (Parte 3 y contrato de M8).** Para cada registro (fila base por año; fila de tienda por año) `meses[12]` sale del paso 1, 2, 4 o 5 y `origen_meses[12]` marca `real` (`m ≤ k` en `Y`, siempre que la tienda estuviera abierta) o `proyectado`. La vista Mensual y `GET /api/proyeccion/cerrada` suman por género · mundo · línea · agrupación de marca · bloque; nunca vuelven a repartir.

**Paso 7 · Prueba con el año anterior (informativa).** El paso 1 aplicado a `Y−1` con el mismo `k`, la curva vigente y `φ_{Y−1}`, sobre `M(Y−1)`: `P_{Y−1}` frente al real de `Y−1`. "A set-2025 el método habría dado X; el real fue Z (±%)", por fila y agregado por línea.

**Paso 8 · Señales (no cambian cifras).** Quiebre: `stock_fin_m ÷ v_m < umbral_cobertura` (0,25) con `v_m > 0`. Tendencia: `total(Y−1) ÷ total(Y−2) − 1` sobre `M(Y)`, normalizados. Fuera de bloque por fila y año (debe ser 0). Temporadas mezcladas. Cola larga: `P_Y < umbral_cola_larga` (24 unidades, supuesto).

Todo el método es determinista y nunca lee el reloj (recibe `k` y `hoy`); `calcularProyeccion(entrada)` devuelve bloques, filas, registros por año y el resumen; `aplicarDecision` y `repartir` corren en milisegundos sobre lo guardado sin releer la venta.

## 6. Modelo de datos (`0018_proyeccion_anual.sql`)

Idempotente: `create table if not exists`, `add column if not exists`, `create or replace function`, `create index if not exists`, `create or replace trigger`; **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`** (tampoco dentro de funciones), sin bloques `do $$`, sin backfill. Toda tabla con `id uuid`, `activo`, `created_at`, `updated_at` con trigger `tg_set_updated_at`, RLS activo sin políticas, `revoke all … from public, anon, authenticated` y `grant … to service_role` sobre cada objeto nuevo (convención de `0013` a `0017`). Funciones `security invoker`, `stable`, `set search_path = ''`.

### 6.1 `tiendas.tienda_referencia_id` (M4, columna nueva)

`uuid null references public.tiendas(id) on delete set null`, `check (tienda_referencia_id is null or tienda_referencia_id <> id)`, índice `tiendas_referencia_idx`, `comment on column`. Por qué una columna y no una tabla: es un atributo de la tienda con un solo valor; `set null` porque eliminar el referente (solo posible sin hechos) no debe impedirse ni dejar la apertura apuntando a nada. La API de M4 (`PATCH /api/tiendas/[id]`) exige referente de tipo Tienda, activo y distinto; sin cadenas porque la composición se calcula siempre con los hechos propios del referente (regla 15). `GET /api/tiendas` devuelve `tienda_referencia_id` y `tienda_referencia` (código y nombre); el importador de M4 gana la columna opcional `TIENDA_REFERENCIA` (código); el diálogo de edición de la tienda gana un `Select`. Una tienda existente también puede llevar referente, pero M7 **no** ajusta la composición de una tienda con historia con la de su referente (segunda entrega: "tienda que cambió de perfil").

### 6.2 Función `venta_proyeccion(p_gml_ids uuid[], p_tiendas_m_ec uuid[], p_tiendas_m_sg uuid[], p_tiendas_detalle uuid[], p_desde date, p_desde_pesos date) returns jsonb`

La única lectura de venta de M7, en una sola sentencia (un solo estado de los datos), por **tandas de nodos** (`TANDA_GML = 60`, 3 en paralelo; filtra por `equivalencias.genero_mundo_linea_id = any(p_gml_ids)` y entra por `venta_stock_mensual(equivalencia_id, carga_id)`):

```jsonc
{ "filas": [ { "gml_id", "equivalencia_id": "<uuid|null: solo si el nodo es GMLE>", "agrupacion_marca_id",
               "grupo": "m_ambos" | "m_solo_sg" | "m_solo_ec" | "otras",         // pertenencia a M(Y) y M(Y+1): cuatro grupos, no diez tiendas
               "periodo": "2026-09-01", "unidades": 1410, "venta_soles": 166380.00, "costo_vendido": 81200.00, "stock_unidades": 290 } ],   // periodo ≥ p_desde
  "por_tienda": [ { "tienda_id", "gml_id", "equivalencia_id", "agrupacion_marca_id", "periodo", "unidades", "venta_soles", "stock_unidades" } ],  // solo p_tiendas_detalle (nuevas, cierres, referentes, y las de M(Y) que salen de M(Y+1)), periodo ≥ p_desde_pesos
  "equivalencias": [ { "gml_id", "equivalencia_id", "unidades" } ],                   // pesos de curvaUnidad: tiendas de M(Y), periodo ≥ p_desde_pesos
  "cargas": { "2023-01": "<carga_id>", … } }                                           // como 0017: la huella sale del mismo estado
```

`agrupacion_marca_id` es **siempre** la de la unidad de marca (`join public.marcas_unidad mu on mu.marca_id = v.marca_id join public.marcas cab on cab.id = mu.unidad_marca_id`); `equivalencia_id = case when n.nivel_planificacion = 'GMLE' then e.id end`; `grupo` sale de `v.tienda_id = any(p_tiendas_m_ec)` y `= any(p_tiendas_m_sg)`. Tamaño esperado: ~1 300 filas × ≤ 4 grupos × 45 meses, ~1 MB por tanda. Por qué `jsonb` por tandas y no una vista materializada: 06b abandonó la MV por el candado y el refresco; aquí la lectura ocurre una vez por cálculo y el costo es proporcional a la tanda. Si el hito midiera más de 30 s, la salida es subir `TANDA_GML` o una MV con refresco por huella (`0019`), sin tocar la API.

### 6.3 `proyecciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `anio_en_curso` | `integer not null` | `check between 2024 and 2100`; el siguiente es `+ 1` |
| `nombre` | `text not null` | 1-80; único `(anio_en_curso, upper(nombre))` |
| `estado` | `text not null default 'en_trabajo'` | `check in ('en_trabajo','cerrada','archivada')`; **único parcial `(anio_en_curso) where estado = 'cerrada'`** |
| `hasta_periodo` | `date not null` | primer día de mes, del año en curso (`check`) |
| `parametros` | `jsonb not null` | `ParametrosProyeccion`: `crecimiento_pct_defecto`, `umbral_avance`, `umbral_cobertura`, `umbral_cola_larga`, `rampa_maduracion`, `factores_usados`, `bloques: { [anio]: { mismas: [{ tienda_id, codigo }], nuevas: [{ tienda_id, codigo, fecha_apertura, venta_esperada, referente_id, rampa }], cierres: [{ tienda_id, codigo, fecha_cierre }], fuera: [{ tienda_id, codigo, motivo }] } }` (foto de M4 al calcular) |
| `resumen` | `jsonb null` | filas, decididas por año, totales por año y bloque, avisos contados, `huella_cargas`, `curvas_usadas: [{ agrupacion_id, curva_id, version }]`, `version_metodo`, `duracion_ms` |
| `calculado_at`, `cerrada_at`, `cerrada_por_id → perfiles on delete set null`, `cerrada_por_nombre`, `nota ≤ 500`, `perfil_id`, `usuario_nombre` | | |
| `activo`, `created_at`, `updated_at` | | `activo` por convención; eliminar solo `en_trabajo` sin decisiones (si no, `409`: se archiva) |

### 6.4 `proyeccion_filas` (identidad, histórico y curva; base y por tienda)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | las decisiones cuelgan de ellas: llevan `id` |
| `proyeccion_id` | `→ proyecciones on delete cascade` | índice |
| `tienda_id` | `uuid null → tiendas on delete restrict` | **`null` = fila base (mismas tiendas del año de cada registro); no nulo = fila de esa tienda nueva o cierre** |
| `gml_id` (`→ genero_mundo_linea restrict`), `equivalencia_id` (`uuid null → equivalencias restrict`), `agrupacion_marca_id` (`→ agrupaciones_marca restrict`) | | `clave text not null` = `coalesce(tienda_id,'')|gml_id|coalesce(equivalencia_id,'')|agrupacion_marca_id`; único `(proyeccion_id, clave)` |
| `nivel_proyectado` | `text check in ('GML','GMLE')` | para `nivel_cambiado` |
| `agrupacion_estacionalidad_id` (`null`, restrict), `temporada` | | la dominante |
| `curva` | `jsonb null` | doce fracciones; `null` sin curva |
| `curva_origen` | `jsonb not null default '[]'` | `[{ agrupacion_id, curva_id, version, peso }]` |
| `historico` | `jsonb not null` | `HistoricoFila`: por año, los doce meses del bloque (`unidades`, `venta_soles`, `stock_fin`, `cobertura`, `quiebre`, `atipico`), total, clase, tiendas del bloque; `tendencia`; `prueba_anterior`; `pesos_equivalencias` |
| `composicion` | `jsonb null` | solo filas de tienda: `{ origen: 'referente'|'red'|'propia', s, p, unidades_maduras }` |
| `avisos` | `jsonb not null default '[]'` | |
| `activo` | `boolean` | **con uso**: `false` cuando un recálculo ya no encuentra la fila (nodo desactivado, nivel cambiado, sin venta en 24 meses, tienda fuera de todo bloque); conserva sus decisiones y no cuenta |
| `created_at`, `updated_at` | | |

Índices: `(proyeccion_id, gml_id)`, `(proyeccion_id, tienda_id)`.

### 6.5 `proyeccion_fila_anios` (los números de cada año y la decisión)

Una fila por `(fila, anio)`. Grano por año para que el mismo código y el mismo contrato sirvan a los dos años.

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `fila_id → proyeccion_filas on delete cascade`, `anio integer` | | único `(fila_id, anio)` |
| `bloque` | `text not null check in ('mismas','nuevas','cierres')` | `mismas` solo con `tienda_id` nulo; `nuevas` y `cierres` solo con `tienda_id` (lo verifica la API; el `check` cruzado entre tablas no cabe) |
| `vendido` | `integer not null default 0` | real hasta `k` (0 en el año siguiente) |
| `propuesto` | `integer null` | `check >= 0`; `null` sin curva o sin base |
| `metodo` | `text check in ('avance','crecimiento','apertura','avance_propio','cierre','sin_propuesta')` | |
| `explicacion` | `text not null default ''` | la frase, generada en el servidor con `es-PE` |
| `crecimiento_pct` | `numeric(6,2) null` | `check between -95 and 500`; override de la fila (solo año siguiente, bloque `mismas`) |
| `decidido` | `integer null` | `check >= 0`; `null` = sin decidir. En filas de tienda es la cifra fijada a mano para esa fila (opcional) |
| `origen` | `text null check in ('propuesta','manual','escalada')` | `check ((decidido is null) = (origen is null))`; `escalada` = resultado del total de la tienda |
| `propuesta_al_decidir` | `integer null` | `propuesta_cambio` = `decidido is not null and propuesta_al_decidir is distinct from propuesto` |
| `nota`, `decidido_at`, `decidido_por_id → perfiles set null`, `decidido_por_nombre` | | |
| `meses` | `integer[] null` | `check (meses is null or cardinality(meses) = 12)`; suma = total vigente (lo prueba TS) |
| `origen_meses` | `text[] null` | `check (origen_meses is null or cardinality(origen_meses) = 12)`; valores `real` / `proyectado` |
| `curva_origen_usada` | `jsonb not null default '[]'` | la versión con la que se repartió **esta** cifra; `curva_cambio` = difiere de la vigente |
| `avisos` | `jsonb not null default '[]'` | |
| `activo`, `created_at`, `updated_at` | | `activo` por convención |

### 6.6 `proyeccion_tiendas` (la decisión por tienda nueva o cierre y año)

`proyeccion_id` (cascade), `tienda_id` (restrict), `anio`, `bloque text check in ('nuevas','cierres')`, `fecha_usada date` (apertura o cierre), `venta_esperada_usada numeric(14,2) null`, `referente_id_usado uuid null`, `origen_composicion text check in ('referente','red','propia')`, `rampa jsonb`, `unidades_maduras integer null`, `vendido integer`, `propuesto integer null`, `metodo`, `decidido integer null`, `origen`, `propuesta_al_decidir`, `nota`, `decidido_*`, `explicacion`, `referencia_alternativa integer null` (la otra cifra: por venta esperada o por avance propio), `avisos`, `activo`, timestamps; único `(proyeccion_id, tienda_id, anio)`. Sus filas GML-AM viven en `proyeccion_filas` (con `tienda_id`) y `proyeccion_fila_anios` (bloque `nuevas` o `cierres`).

### 6.7 `factores_volumen_atipico` (el factor del Niño, editable; fuera de la proyección)

`anio integer`, `temporada text check in ('invierno','verano')`, `ratio_calculado numeric(6,4) null`, `ratio_aplicado numeric(6,4) null` (`check > 0.05 and <= 3`), `huella_cargas text null`, `calculado_at timestamptz null`, `tiendas_comunes integer null`, `meses_comparados integer null`, `parcial boolean not null default false`, `nota ≤ 200`, `perfil_id`, `usuario_nombre`; único `(anio, temporada)`. Es un hecho sobre el histórico, no un supuesto de una proyección: por eso vive fuera; cada proyección guarda en `parametros.factores_usados` los que aplicó.

### Diagrama

```
tiendas (apertura, cierre, venta_esperada, tienda_referencia_id) ─► bloquesDeAnio(Y), bloquesDeAnio(Y+1) ─┐
periodos_atipicos + claseDeAnio ─► factores_volumen_atipico ─────────────────────────────────────────────┤
curvas_estacionalidad vigentes (GET /api/curvas/vigentes) + curvaUnidad ─────────────────────────────────┼─► calcularProyeccion (TS puro) ─► proyecciones
genero_mundo_linea.nivel + marcas_unidad ─► venta_proyeccion(gml[], M(Y), M(Y+1), detalle[]) ─────────────┘        │        ├─ proyeccion_filas (base: tienda_id null · por tienda: tienda_id)
                                                                                 decisiones del planner ──────────┘        │     └─ proyeccion_fila_anios (Y, Y+1: bloque, propuesto, decidido, meses, origen_meses)
                                                                                                                           └─ proyeccion_tiendas (decisión por tienda nueva o cierre y año)
                                        Parte 1 (decide) ─► Parte 2 matriz (suma) ─► Parte 3 mensual (reparte con M6) ─► una `cerrada` por año ─► M8 (GET /api/proyeccion/cerrada?anio=)
```

## 7. Contratos de API y de lógica pura

Convenciones de M1 a M6: `ok` / `error` / `leerCuerpo` / `idDeRuta` (`src/lib/api/respuestas.ts`), `errorConCodigo` de M6 para los `409` con código, `traducirErrorDb`, `leerTodo`. Handlers en `src/app/api/proyeccion/`; lógica pura en `src/lib/proyeccion/` (`tipos-api.ts` autocontenido, `tipos.ts` con constantes, `esquemas.ts`, `bloques.ts`, `nino.ts`, `cierre.ts`, `siguiente.ts`, `reparto.ts`, `composicion.ts`, `tiendas-nuevas.ts`, `cierres-tienda.ts`, `curva-fila.ts`, `explicar.ts`, `matriz.ts`, `mensual.ts`, `desactualizado.ts`, `reglas.ts`, `excel.ts` (hojas, en el navegador), `modelo.ts`); acceso a datos solo en `consultas.ts` (único archivo que nombra `venta_proyeccion`). Errores: `401` · `403` (comprador) · `400` zod · `404` · `409` regla · `500`. **Toda ruta `requirePlanner`.** Las exportaciones a Excel se generan en el navegador con SheetJS cargado bajo demanda (patrón de M11, `src/lib/reportes/descargas.ts`) a partir de los datos ya cargados por rutas `requirePlanner`: no existe una ruta de descarga.

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/proyeccion` | GET | — | `{ datos: { desde, hasta, meses_publicados, ultimo_mes_cerrado, curvas_vigentes, agrupaciones_sin_curva, curvas_obsoletas }, prerrequisitos: { bloquea, avisa }, bloques_hoy: BloquesApi, proyecciones: ProyeccionApi[] (sin resumen largo), factores: FactorApi[] }` |
| `/api/proyeccion/proyecciones` | POST | `crearSchema = { nombre: 1-80, hasta_periodo?: mes, parametros?: parametrosSchema.partial(), copiar_de?: uuid }` | `201 ProyeccionApi` ya calculada; `409 nombre_repetido`, `409 sin_datos`, `409 prerrequisitos` |
| `/api/proyeccion/proyecciones/[id]` | GET / PATCH / DELETE | `editarSchema = { nombre?, nota?, hasta_periodo?, parametros?: parametrosSchema.partial() }` | `ProyeccionApi` con `desactualizada: Motivo[]` y `bloques`; `PATCH` de parámetros marca `recalculo_pendiente`; `409 cerrada`; `DELETE` solo `en_trabajo` sin decisiones (`409`) |
| `…/[id]/calcular` | POST | `{}` | `201 ProyeccionApi`: bloques desde M4 → `venta_proyeccion` por tandas → `calcularProyeccion` → `upsert` de filas, registros por año y tiendas por `clave` (tandas de 500; `activo = false` en lo que desaparece; **nunca toca `decidido`, `origen`, `nota`, `propuesta_al_decidir`**) → resumen; `409 cerrada`; `409 prerrequisitos` |
| `…/[id]/lineas` | GET | `?genero_id&mundo_id&linea_id&q` | **Parte 1**: `{ filtro, filas: FilaApi[] (bloque mismas, con `anios`), totales_por_anio, historico_linea: { anio, unidades, clase }[], tiendas_linea: { anio, bloque, tienda, vendido, vigente }[], prueba_anterior, indice_lineas: { genero, mundo, linea, estado }[] }`; sin filtro, solo `indice_lineas` y totales |
| `…/[id]/filas/[filaId]` | GET | — | `FilaApi & { historico: HistoricoFila, curva, curva_origen, anios: AnioFilaApi[] (con `meses`, `origen_meses`, `explicacion`) }`; `404` |
| `…/[id]/filas/[filaId]/anios/[anio]` | PUT | `decisionSchema = { decidido: int ≥ 0 \| null, origen: 'propuesta' \| 'manual', nota?: ≤ 300, crecimiento_pct?: -95..500 }` | `AnioFilaApi` recalculado (reparto; si `anio = Y` y bloque `mismas`, también la propuesta de `Y+1`); `null` = volver a la propuesta; `409 cerrada`; `409 menor_que_vendido`; `409 fila_inactiva`; `origen = 'propuesta'` copia `propuesto` e ignora `decidido` |
| `…/[id]/tiendas` | GET | `?anio&bloque` | `TiendaProyeccionApi[]` (nuevas y cierres por año: composición resumida, propuesta, referencia alternativa, decisión, filas) |
| `…/[id]/tiendas/[tiendaId]/anios/[anio]` | PUT | `decisionSchema` (sin `crecimiento_pct`) + `rampa?: number[1..6] en (0,1]` | `TiendaProyeccionApi`; reescala sus filas no fijadas (`origen = 'escalada'`); `409 cerrada` |
| `…/[id]/matriz` | GET | `?genero_id&mundo_id&linea_id&temporada&agrupacion_estacionalidad_id&agrupacion_marca_id&solo=&por=arbol \| agrupacion_marca` | **Parte 2**: `{ filtro, nodos: NodoMatrizApi[] (compañía, género, mundo, línea), bloques: BloquesApi, resumen: { lineas, lineas_total, porcentaje_total } }`; los filtros se aplican en el servidor sobre las tablas (sin releer venta) |
| `…/[id]/mensual` | GET | los mismos filtros + `?bloque=todas \| mismas \| nuevas \| cierres&por_agrupacion=1` | **Parte 3**: `{ filtro, filas: FilaMensualApi[], totales: { anio, meses, origen_meses }[], bloques }` |
| `…/[id]/cerrar` | POST | `{ nota? }` + `?forzar=1` | `ProyeccionApi`; `409 filas_sin_decidir` (lista: fila, año, propuesto), `409 tiendas_sin_decidir`, `409 desactualizada` (salvo forzar), `409 ya_cerrada`; archiva la cerrada anterior del año (`archivada_id`) |
| `…/[id]/archivar` | POST | — | `ProyeccionApi` |
| `/api/proyeccion/factores` | GET / PUT | `PUT { factores: [{ anio, temporada, ratio_aplicado: number \| null, nota? }] }`; `GET ?sincronizar=1` | `FactorApi[]`; sincronizar llama por temporada a la lógica de `/anios?con_volumen=1` y guarda `ratio_calculado`, `huella_cargas`, `calculado_at`, `parcial` |
| `/api/proyeccion/cerrada` | GET | `?anio=2026` (año en curso de la proyección) | **Contrato de M8** (abajo); `404 sin_cerrada`. En código, `leerProyeccionCerrada(db, anio)` de `consultas.ts`; M8 nunca recalcula ni reparte |

**Contrato de M8 (`GET /api/proyeccion/cerrada`)**: `{ proyeccion: ProyeccionApi, bloques: BloquesApi, filas: FilaCerradaApi[] }` con una fila por **género · mundo · línea · equivalencia (si GMLE) · agrupación de marca · bloque · tienda (nula en `mismas`) · año**: `{ gml_id, equivalencia_id, agrupacion_marca_id, genero, mundo, linea, equivalencia, agrupacion_marca, nivel, agrupacion_estacionalidad_id, temporada, bloque, tienda_id, anio, total, meses: number[] | null, origen_meses: ("real" | "proyectado")[] | null, curva_origen_usada, avisos }`. Reglas que M8 puede asumir: `Σ meses = total` cuando `meses` no es nulo; en el año en curso `origen_meses[m] = "real"` para `m ≤ k` de la proyección (`proyeccion.hasta_periodo`); los tres bloques son disjuntos y su suma por fila es el total del año; la fila `mismas` de `Y` y la de `Y+1` pueden tener distintas tiendas (`bloques[anio].mismas`). Lo mismo, con los mismos tipos, devuelve `…/mensual` de la proyección en trabajo (es lo que la pantalla muestra); M8 solo lee la cerrada.

Tipos explícitos (`tipos-api.ts`), para construir backend y frontend en paralelo:

```ts
export type EstadoProyeccion = "en_trabajo" | "cerrada" | "archivada";
export type Bloque = "mismas" | "nuevas" | "cierres";
export type MotivoDesactualizada = "cargas_nuevas" | "curvas_cambiadas" | "nivel_cambiado" | "tiendas_cambiadas" | "factores_cambiados" | "periodos_cambiados" | "recalculo_pendiente";
export type AvisoFila = "sin_curva" | "curva_incompleta" | "curva_cambio" | "propuesta_cambio" | "avance_bajo" | "sin_venta_anio" | "sin_base" | "sin_factor" | "objetivo_atipico"
  | "temporadas_mezcladas" | "mes_negativo" | "quiebre" | "cola_larga" | "nivel_cambiado" | "bloque_cambiado" | "sin_venta_esperada" | "sin_referente" | "referente_sin_historia" | "fijadas_exceden";
export type TiendaBloqueApi = { tienda_id: string; codigo: string; nombre: string; fecha_apertura: string | null; fecha_cierre: string | null; motivo: string;
  venta_esperada?: number | null; referente_id?: string | null; rampa?: number[] };
export type BloquesApi = Record<number, { mismas: TiendaBloqueApi[]; nuevas: TiendaBloqueApi[]; cierres: TiendaBloqueApi[]; fuera: TiendaBloqueApi[] }>;
export type ParametrosProyeccion = { crecimiento_pct_defecto: number; umbral_avance: number; umbral_cobertura: number; umbral_cola_larga: number; rampa_maduracion: number[];
  factores_usados: { anio: number; temporada: "invierno" | "verano"; ratio: number | null; origen: "calculado" | "manual" | null }[]; bloques: BloquesApi };
export type AnioFilaApi = { anio: number; bloque: Bloque; vendido: number; propuesto: number | null; metodo: "avance" | "crecimiento" | "apertura" | "avance_propio" | "cierre" | "sin_propuesta";
  explicacion: string; crecimiento_pct: number | null; decidido: number | null; origen: "propuesta" | "manual" | "escalada" | null; propuesta_al_decidir: number | null; vigente: number | null;
  nota: string | null; decidido_por_nombre: string | null; decidido_at: string | null; meses: number[] | null; origen_meses: ("real" | "proyectado")[] | null; avance: number | null; avisos: AvisoFila[] };
export type FilaApi = { id: string; tienda_id: string | null; gml_id: string; equivalencia_id: string | null; agrupacion_marca_id: string; nivel: "GML" | "GMLE";
  genero: string; mundo: string; linea: string; equivalencia: string | null; agrupacion_marca: string; agrupacion_estacionalidad: { id: string; nombre: string; temporada: string } | null;
  historico_anual: { anio: number; unidades: number; clase: "normal" | "atipico" | "en_curso"; completo: boolean; tiendas: number }[]; anios: AnioFilaApi[]; avisos: AvisoFila[]; activo: boolean };
export type HistoricoFila = { anios: { anio: number; clase: "normal" | "atipico" | "en_curso"; meses_atipicos: string[]; total: number; total_normalizado: number; tiendas: string[];
  meses: { periodo: string; unidades: number; venta_soles: number; stock_fin: number; cobertura: number | null; quiebre: boolean; atipico: boolean }[] }[];
  tendencia: number | null; prueba_anterior: { anio: number; propuesto: number; real: number; desvio_pct: number } | null; pesos_equivalencias: { equivalencia_id: string; peso: number }[] };
export type TiendaProyeccionApi = { tienda_id: string; codigo: string; nombre: string; bloque: "nuevas" | "cierres"; anio: number; fecha_usada: string; venta_esperada: number | null;
  referente: { id: string; codigo: string; nombre: string } | null; origen_composicion: "referente" | "red" | "propia"; unidades_maduras: number | null; rampa: number[]; vendido: number;
  propuesto: number | null; metodo: AnioFilaApi["metodo"]; referencia_alternativa: number | null; decidido: number | null; origen: "propuesta" | "manual" | null; propuesta_al_decidir: number | null;
  vigente: number | null; explicacion: string; nota: string | null; filas: FilaApi[]; avisos: AvisoFila[] };
export type EstadoLinea = "sin_proyectar" | "parcial" | "proyectada" | "curva_cambio" | "propuesta_cambio";
export type NodoMatrizApi = { nivel: "compania" | "genero" | "mundo" | "linea" | "agrupacion_marca"; ids: { genero_id?: string; mundo_id?: string; linea_id?: string; agrupacion_marca_id?: string }; nombre: string;
  en_curso: { venta_a_la_fecha: number; mismas: number; nuevas: number; cierres: number; total: number; decididas: number; filas: number };
  siguiente: { mismas: number; nuevas: number; cierres: number; total: number; decididas: number; filas: number }; variacion_pct: number | null; estado: EstadoLinea; avisos: AvisoFila[] };
export type FilaMensualApi = { ids: NodoMatrizApi["ids"]; genero: string; mundo: string; linea: string; agrupacion_marca: string | null; bloque: Bloque | "todas";
  anios: { anio: number; total: number; meses: (number | null)[]; origen_meses: ("real" | "proyectado")[]; sin_curva: number }[] };
export type FactorApi = { anio: number; temporada: "invierno" | "verano"; ratio_calculado: number | null; ratio_aplicado: number | null; ratio_efectivo: number | null;
  origen: "calculado" | "manual" | null; parcial: boolean; tiendas_comunes: number | null; meses_comparados: number | null; calculado_at: string | null; nota: string | null; objetivo: boolean };
```

Constantes (`tipos.ts`): `UMBRAL_AVANCE = 0.30`, `UMBRAL_COBERTURA = 0.25`, `UMBRAL_COLA_LARGA = 24`, `RAMPA_MADURACION = [0.7, 0.85, 1]`, `MESES_MIN_AVANCE = 3`, `MESES_UNIVERSO = 24`, `MESES_COMPOSICION = 12`, `TANDA_GML = 60`, `PARALELO = 3`, `TANDA_UPSERT = 500`, `RATIO_MIN = 0.05`, `RATIO_MAX = 3`, `VERSION_METODO = 1` (entra en `resumen` para detectar fórmulas cambiadas, como `VERSION_MODELO` de M6).

### Contratos de lógica pura (lo que `backend` escribe y `tests/proyeccion.*` prueban)

| Función | Archivo | Qué garantiza |
|---|---|---|
| `bloquesDeAnio(tiendas, anio, hoy)` → `{ mismas, nuevas, cierres, fuera }` | `bloques.ts` | reglas 1-4 |
| `mesesAtipicosFila(agrupacionDominante, periodos, anio)` (envuelve `claseDeAnio`), `factorDe(factores, anio, temporada)`, `normalizar(serie, atipicos, factor)` | `nino.ts` | reglas 5-7 |
| `proponerCierre({ serie, k, curva, atipicos, factor, umbralAvance })` | `cierre.ts` | reglas 8-11 |
| `proponerSiguiente({ baseVigente, aportesTiendas, atipicosEnCurso, factorEnCurso, crecimiento, curva, atipicosObjetivo, factorObjetivo })` | `siguiente.ts` | reglas 12-14 |
| `repartirEntero(total, pesos)`, `repartirResto(total, serieReal, k, curva, atipicos, factor)` | `reparto.ts` | reglas 15, 16 |
| `composicionTienda(hechosPorTienda, W12, atipicos, factores)`, `proponerTiendaNueva(...)`, `proponerCierreTienda(...)`, `escalarTienda(filas, decidido)` | `composicion.ts`, `tiendas-nuevas.ts`, `cierres-tienda.ts` | reglas 17-23 |
| `curvaFila(unidad, equivalencias, vigentes, pesos)` (envuelve `curvaUnidad` de 02b) y `agrupacionDominante` | `curva-fila.ts` | regla 24 |
| `explicar(registro)` → texto `es-PE` | `explicar.ts` | regla 25 |
| `armarMatriz(filas, tiendas, arbol, filtro)` y `estadoLinea`; `armarMensual(filas, filtro, bloque)` | `matriz.ts`, `mensual.ts` | reglas 26-29 |
| `hojasMatriz`, `hojasMensual` (filas y cabeceras de cada hoja; SheetJS solo en el componente) | `excel.ts` | regla 30 |
| `motivosDesactualizada(proyeccion, estadoActual)` y `avisosDeCambio(registro, vigentes)` | `desactualizado.ts` | reglas 31, 32 |
| `motivoRechazoDecision`, `motivoRechazoCerrar`, `puedeEliminar` | `reglas.ts` | reglas 33-35 |
| `calcularProyeccion(entrada)` determinista; `aplicarDecision(registro, decision)` sin releer venta | `modelo.ts` | reglas 36, 37 |

## 8. Reglas de negocio (vitest, funciones puras salvo donde se indica)

**Bloques de tiendas (`bloques.ts`)**
1. **Mismas tiendas de `Z`** = tipo Tienda, activa, `fecha_apertura ≤ Z−1-01-01` y (`fecha_cierre` nula o `≥ Z-12-31`). Una tienda con apertura exactamente el 1 de enero de `Z−1` entra (estuvo los doce meses); con apertura el 2 de enero, no. La red comparable de M6 por fechas da el mismo conjunto para `Z−1`.
2. **Tiendas nuevas de `Z`** = tipo Tienda, activa, `Z−1-01-01 < fecha_apertura ≤ Z-12-31`, sin cierre `< Z-12-31`. Jirón (apertura 2025-11-20) es nueva en 2026 y misma en 2027; una tienda que abre 2026-07-01 es nueva en 2026 y en 2027 y misma en 2028.
3. **Cierres de `Z`** = tipo Tienda, activa, con `fecha_cierre` entre `Z−1-01-01` y `Z-12-30`, con venta en `Z−1` o `Z`. Cierre el 31 de diciembre de `Z` → sigue en mismas de `Z` y sale de mismas de `Z+1` (no es "cierre" en ningún año: vendió los dos años completos). Cierre a mitad de `Z` → cierre de `Z`; a mitad de `Z−1` → cierre de `Z−1` y, en `Z`, fuera (vendió 0).
4. **Fuera**: CD (`centro_distribucion`), desactivada, sin `fecha_apertura` (bloquea si tiene venta), apertura posterior a `Z-12-31` (`planificada_despues`). Cada tienda está a lo sumo en un bloque por año; `mismas ∪ nuevas ∪ cierres ∪ fuera` = todas; la suma de la venta de los bloques es la venta total (test con el fixture).

**Niño (`nino.ts`)** · 5. `mesesAtipicosFila` = `claseDeAnio(anio, { temporada: dominante }).meses_atipicos`; `todo_el_ano` → vacío. 6. `factorDe` = `ratio_aplicado ?? ratio_calculado ?? null`; `null` con meses atípicos → `sin_factor` y `φ = 1`. 7. `normalizar(serie, A, φ)`: `m ∈ A` → `u ÷ φ`; `A` vacío → idéntica; `φ = 1` → idéntica.

**Cierre del año en curso (`cierre.ts`)** · 8. `proponerCierre` con `A = ∅`: `P = V + round((V ÷ C_k − V))` repartido; `A` = los doce meses → `P = V ÷ C_k` exacto (el factor se cancela, test de propiedad con `φ ∈ {0,5, 0,66, 1,24}`). 9. `A` = set–dic con `k = 9`: `V' = Σ_{m≤8} v_m + v_9 ÷ φ`; `r_m = V' ÷ C_9 × c_m × φ` para `m ≥ 10`. 10. `C_k < umbral` → `avance_bajo`, cifra igual; `C_k = 0` o curva nula → `propuesto = null`, `sin_curva`, `meses = null`. 11. `V = 0` → `P = 0` y `sin_venta_anio` si hubo venta en `Y−1`.

**Año siguiente (`siguiente.ts`)** · 12. `B` = vigente `Y` de la fila base + Σ vigente `Y` de las tiendas nuevas de `Y` que son mismas en `Y+1` − aporte `Y` de las mismas de `Y` que cierran en `Y+1`; cambiar la decisión de `Y` cambia `B` (test: decidir 17 504 → 18 000 sube `P_{Y+1}` en `(1 + g) × 496 ÷ φ`). 13. `A(Y)` completo → `B' = B ÷ φ_Y`; parcial → mes a mes sobre el reparto de `B`. 14. `g` de la fila manda sobre el de la proyección; `A(Y+1)` no vacío → `objetivo_atipico` y `c'` reponderada; sin base → `null` y `sin_base`.

**Reparto (`reparto.ts`)** · 15. `repartirEntero(1 001, plana)` → cinco de 84 y siete de 83; `Σ = total` para `total ∈ 0..5 000` (propiedad); `total = 0` → doce ceros. 16. `repartirResto`: meses `≤ k` = real; `Σ_{m>k} = total − V`; `origen_meses` = `real` hasta `k`.

**Tiendas nuevas y cierres (`composicion.ts`, `tiendas-nuevas.ts`, `cierres-tienda.ts`)** · 17. `composicionTienda`: `Σ s_f = 1`; `p_f` = soles ÷ unidades normalizadas; fila con unidades 0 toma el precio medio de la tienda; meses atípicos normalizados en soles y unidades por igual. 18. Sin referente → composición de `M(Z)` (`origen = red`); referente con menos de 12 meses cerrados → `referente_sin_historia` y red; el referente del referente se ignora (sin cadenas). 19. Rampa: `r` = 0 antes de abrir; mes de apertura `rampa[0] × días ÷ días del mes` (abre el 15 de marzo → `0,70 × 17/31`); después `rampa[1]`, `rampa[2]`, 1…; `Σ_f P_{t,f}` = propuesta de la tienda. 20. `Md_f = E × 12 × s_f ÷ p_f`; sin `E` → `propuesto = null` y `sin_venta_esperada`; el total decidido se reparte igual. 21. Tienda nueva con `n` meses cerrados después de la rampa: `n ≥ 3` → `avance_propio` y `referencia_alternativa` = por venta esperada; `n < 3` → `apertura` desde `k + 1` y la alternativa al revés. 22. `escalarTienda(filas, D)`: no fijadas × `(D − Σ fijadas) ÷ Σ no fijadas`; `Σ fijadas > D` → resto 0 y `fijadas_exceden`; `Σ` final = `D` (propiedad). 23. Cierre a mitad de año: `q_m = 1` hasta el mes anterior, `días ÷ días del mes` en el mes del cierre (cierra el 30 de junio → 1), 0 después; cierre ya pasado (`≤ k`) → solo real.

**Curva (`curva-fila.ts`)** · 24. `curvaFila` = `curvaUnidad` (02b, regla 13) con pesos de `equivalencias`; `agrupacionDominante` por mayor peso, empate por nombre; temporadas distintas con peso > 0 → `temporadas_mezcladas`; `curva_origen` lleva `curva_id` y `version` de cada agrupación con peso.

**Explicación (`explicar.ts`)** · 25. Toda `explicacion` nombra el método, las cifras de entrada, la curva y versión, y el Niño si aplica; usa `es-PE` (test: ninguna contiene `\d\.\d`); cambia si cambia cualquier entrada (propiedad sobre el fixture).

**Matriz y mensual (`matriz.ts`, `mensual.ts`)** · 26. Columnas sin solapes: `total_Z = mismas + nuevas + cierres`; `venta_a_la_fecha = Σ vendido` de los tres bloques (+ `fuera`, que debe ser 0); los totales por mundo, género y compañía son sumas exactas de sus líneas; con filtro, las sumas se recalculan sobre lo filtrado y `porcentaje_total` dice qué parte del total sin filtro representa. 27. `estadoLinea`: ninguna decidida en ninguno de los dos años → `sin_proyectar`; todas las filas con `propuesto ≥ umbral_cola_larga` decididas en los dos años y las tiendas de la línea decididas → `proyectada`; en medio → `parcial`; `curva_cambio` o `propuesta_cambio` si alguna fila lo tiene (prevalecen sobre `proyectada`, no sobre `sin_proyectar`). 28. `armarMensual`: `bloque = todas` suma los tres; `origen_meses` de una suma es `real` solo si todos los sumandos de ese mes son `real`; una fila sin curva aporta su total a `total` y `null` a los meses, y cuenta en `sin_curva`. 29. Los filtros `temporada` y `agrupacion_estacionalidad` miran la dominante de la unidad; `agrupacion_marca` recorta a esa agrupación en todas las columnas; `solo=con_tiendas_nuevas` deja las líneas con alguna fila de bloque `nuevas` > 0.

**Excel (`excel.ts`)** · 30. `hojasMatriz` y `hojasMensual` devuelven exactamente las filas visibles (mismo filtro y bloque) más `BLOQUES` y `FILTROS`; las cabeceras de meses son `aaaa-mm`; una celda sin curva va vacía, no 0; el componente solo convierte con SheetJS (`XLSX.utils.aoa_to_sheet`), cargado bajo demanda como en M11 (`src/lib/reportes/descargas.ts`), y nunca llama a una ruta nueva.

**Desactualización (`desactualizado.ts`)** · 31. `motivosDesactualizada`: `cargas_nuevas` (una carga publicada con `publicada_at > calculado_at` y periodo `≤ hasta_periodo`, o un mes nuevo que adelanta `k`), `curvas_cambiadas` (alguna `curva_id` de `curvas_usadas` ya no es vigente), `nivel_cambiado`, `tiendas_cambiadas` (fechas, venta esperada o referente con `updated_at > calculado_at`), `factores_cambiados`, `periodos_cambiados`, `recalculo_pendiente`. 32. `avisosDeCambio` por registro: `curva_cambio` si `curva_origen_usada ≠` vigente (con detalle "v2 → v3" y el reparto antes y después), `propuesta_cambio` si `decidido` y `propuesta_al_decidir ≠ propuesto`, `bloque_cambiado` si la tienda cambió de bloque.

**Reglas de estado (`reglas.ts`)** · 33. `motivoRechazoDecision`: `cerrada` → `409`; fila inactiva → `409`; año en curso y `decidido < vendido` → `409 menor_que_vendido`; `origen = propuesta` con `propuesto = null` → `409 sin_propuesta`. 34. `motivoRechazoCerrar`: alguna fila base con `propuesto ≥ umbral_cola_larga` sin decidir en `Y` o `Y+1` → `filas_sin_decidir` (lista); alguna tienda nueva con venta esperada o cierre sin decidir → `tiendas_sin_decidir`; desactualizada sin `forzar` → `409`; la cola larga se cierra con la propuesta y queda `cola_larga` en `avisos`. 35. `puedeEliminar`: `en_trabajo` y sin ningún `decidido`; si no, se archiva.

**Modelo (`modelo.ts`)** · 36. `calcularProyeccion` es determinista, nunca usa meses posteriores a `hasta_periodo`, y devuelve `Σ` por fila igual a la venta leída (partición completa de los hechos entre filas y bloques). 37. `aplicarDecision` no cambia `propuesto`, `historico` ni `curva`; recalcula `meses` y, si es `Y` y bloque `mismas`, la propuesta de `Y+1` de la misma fila; `calcular` conserva `decidido`, `origen`, `nota` y `propuesta_al_decidir` de cada registro existente (test: recalcular con otra venta cambia `propuesto` y deja la decisión).

**SQL (script de humo local)** · 38. `0018` aplica dos veces; `venta_proyeccion` parte un juego sintético igual que `claveFlujo` colapsado a GML-AM (ALFA JEANS suma en la agrupación de ALFA; un nodo GMLE da `equivalencia_id`); `grupo` respeta las dos listas; `anon` no ejecuta la función ni lee las tablas; el único parcial rechaza dos `cerrada` del mismo año; el `check` de `cardinality` rechaza once meses; `tiendas.tienda_referencia_id = id` se rechaza.

**Estático** · 39. Solo `consultas.ts` nombra `venta_proyeccion`; `src/lib/proyeccion/` no importa de `src/components/` ni de `@supabase/*` fuera de `consultas.ts`; toda ruta bajo `/api/proyeccion` usa `requirePlanner`; `nav.ts` marca el item con `PLANIFICACION`; el componente de Excel importa SheetJS con `import()` dinámico.

## 9. Casos de prueba sintéticos (`tests/proyeccion.fixture.ts`)

Árbol: **HOMBRE · URBANO · DENIM** (GML; equivalencias SKINNY y RECTO en "DENIM HO", `todo_el_ano`, curva plana 1/12) y **HOMBRE · CASUAL · ABRIGO** (GMLE; equivalencia PARKA en "HO INVIERNO", `invierno`, curva `[.02,.02,.06,.12,.20,.24,.16,.08,.04,.02,.02,.02]`) y **MUJER · CASUAL · SANDALIA** (GML; "MU VERANO", `verano`, curva `[.14,.12,.08,.04,.03,.02,.02,.03,.08,.12,.14,.18]`). Marcas ALFA (RECONOCIDO; conjunto con ALFA JEANS), DELTA (RECONOCIDO), BETA (PREMIUM). Tiendas: **T1** (abre 2020-01-10), **T6** (abre 2025-01-01), **T2** "Jirón" (abre 2025-11-20), **T3** (abre 2026-07-01), **T4** (abre 2027-03-15; venta esperada 85 000; referente T1), **T5** (abre 2019, cierra 2027-06-30), **T7** (abre 2019, cierra 2026-06-30), **T8** (abre 2019, cierra 2025-12-31), CD. Periodos: "Niño 2023" (2023-01..12 invierno; 2023-09..12 verano) y "Niño 2026" (2026-01..12 invierno; 2026-09..12 verano). Factores: invierno 2023 0,63; invierno 2026 0,66; verano 2023 0,73; verano 2026 1,24. `hasta_periodo = 2026-09`, `k = 9`, `Y = 2026`.

1. **Bloques 2026**: mismas = {T1, T6, T5} (T7 no: cierra el 2026-06-30 y no estará todo 2026); nuevas = {T2, T3}; cierres = {T7}; T8 (cerró el 2025-12-31) fuera en 2026 con venta 0 (`cerrada_antes`) y misma en 2025; CD fuera. **Bloques 2027**: mismas = {T1, T6, T2}; nuevas = {T3, T4}; cierres = {T5}. Casos borde de la regla 1: T6 (abrió justo el 1 de enero de 2025) es misma en 2026; una tienda que abriera el 2 de enero de 2025 sería nueva en 2026; T7 (cierra a mitad de 2026) es cierre en 2026 y fuera en 2027; T8 (cierre el 31 de diciembre) nunca es "cierre".
2. **Partición**: `Σ` unidades de todas las filas y bloques de 2026 = `Σ` hechos de 2026 (sin el CD); un hecho de ALFA JEANS en SKINNY cae en `(DENIM, null, RECONOCIDO)`; BETA en `(DENIM, null, PREMIUM)`; en ABRIGO la fila lleva `equivalencia_id = PARKA`.
3. **Cierre DENIM × RECONOCIDO (mismas 2026)**: 100 u/mes en T1 + 30 en T6 + 20 en T5 → `V = 1 350`, `C_9 = 0,75` → `P = 1 800`, resto oct–dic 150/150/150; `metodo = avance`; `explicacion` contiene "1 350", "75,0 %", "DENIM HO v1" y "1 800".
4. **Niño invierno (ABRIGO × RECONOCIDO)**: 2026 = `[20,20,60,120,200,240,160,80,40]` a set en mismas; `V = 940`, `C_9 = 0,94` → `P = 1 000` (el factor 0,66 no interviene); meses oct–dic 20/20/20. **Base 2027**: `B = 1 000 ÷ 0,66 = 1 515`; `g = 3 %` → `P_{2027} = 1 561`; sin factor (fila de factores vacía) → `B = 1 000`, `sin_factor`.
5. **Niño verano (SANDALIA × VALOR)**: `v_9 = 124` con `φ = 1,24` → `V' = Σ_{m≤8} + 100`; `C_9 = 0,56`; oct–dic × 1,24; test numérico cerrado en el fixture; `A(2027) = ∅` → 2027 sin factor.
6. **Avance bajo**: con `hasta_periodo = 2026-02` en SANDALIA (`C_2 = 0,26`) → `avance_bajo`, cifra calculada igual y `referencia_anterior` = total 2025.
7. **Sin curva**: quitar la vigente de "DENIM HO" → DENIM `propuesto = null`, `meses = null`, `sin_curva`; decidir 1 800 a mano → `meses = null`, total en matriz y mensual con los meses vacíos.
8. **Año siguiente con Jirón**: DENIM × RECONOCIDO 2027: `B` = 1 800 (mismas 2026) + vigente 2026 de T2 (nueva en 2026, misma en 2027: 9 meses reales 25/mes = 225 → `avance_propio`: `225 ÷ 0,75 = 300`) − aporte 2026 de T5 (cierra 2027-06-30: 20 × 12 = 240 vigente) = 1 860; `g = 5 %` → 1 953. Cambiar la decisión 2026 de la fila base a 1 900 → `B = 1 960` → 2 058.
9. **Tienda nueva por venta esperada (T4, 2027)**: composición de T1 sobre oct-2025..set-2026 con dos filas (DENIM × RECONOCIDO 70 % de los soles, `p = 100`; ABRIGO × RECONOCIDO 30 %, `p = 200`, meses de invierno 2026 ÷ 0,66): `Md_DENIM = 85 000 × 12 × 0,7 ÷ 100 = 7 140`; rampa `[0,7, 0,85, 1]` y apertura el 15 de marzo → `r_3 = 0,7 × 17/31`, `r_4 = 0,85`, `r_5.. = 1`; `P_{T4,DENIM,2027} = round(Σ 7 140 × (1/12) × r_m)`; sin referente → composición de mismas 2027; sin venta esperada → `null` + `sin_venta_esperada`; decidir 6 000 para T4 → filas escaladas y `Σ = 6 000`; fijar DENIM = 5 000 → ABRIGO = 1 000.
10. **Tienda nueva con pocos meses (T3, abre 2026-07-01, `k = 9`)**: 3 meses cerrados pero la rampa ocupa jul–set → `n = 0 < 3` → `apertura` desde octubre con venta esperada; en 2027 sigue nueva (`N(2027)`), con `r = 1` todo el año → doce meses maduros.
11. **Cierres**: T7 (cierra 2026-06-30, `≤ k`) → solo real ene–jun, `propuesto = vendido`; T5 (cierra 2027-06-30) → composición propia, `q_m = 1` ene–jun y 0 desde julio; `Σ` 2027 de T5 ≈ la mitad de su año maduro ajustada por curva.
12. **Matriz**: fila DENIM 2026: venta a la fecha = 1 350 (mismas) + 225 (T2) + 0 (T3 sin venta aún… o lo que el fixture cargue) + real T7; `total = mismas 1 800 + nuevas (T2 300 + T3) + cierres T7`; HOMBRE = DENIM + ABRIGO; Compañía = HOMBRE + MUJER; con filtro `genero = MUJER` la compañía filtrada = MUJER y `porcentaje_total` < 100 %; `solo=con_tiendas_nuevas` deja las líneas con T2, T3 o T4 > 0.
13. **Mensual y contrato de M8**: DENIM × RECONOCIDO mismas 2026 `meses = [150×9 reales…]` con `origen_meses = real×9, proyectado×3`; `bloque = todas` suma T2 y T7 por mes; `GET /api/proyeccion/cerrada?anio=2026` devuelve las mismas filas que `…/mensual` con `Σ meses = total` en todas las que tienen curva; `404` sin cerrada.
14. **Curva cambió**: aprobar v2 de "DENIM HO" con otra forma → `curvas_cambiadas` en la proyección y `curva_cambio` en las filas de DENIM con el reparto antes y después; recalcular deja `decidido` intacto y cambia `meses`.
15. **Propuesta cambió**: decidir ABRIGO 2026 = 1 000 aceptando la propuesta; publicar octubre con 60 u → recalcular: `propuesto = 1 020`, `decidido = 1 000`, `propuesta_al_decidir = 1 000` → `propuesta_cambio`.
16. **Cierre de la proyección**: con DENIM × PREMIUM (`propuesto = 12 < 24`) sin decidir se cierra y queda `cola_larga`; con DENIM × RECONOCIDO sin decidir en 2027 → `409 filas_sin_decidir` listando la fila; con T4 sin decidir → `409 tiendas_sin_decidir`; cerrar una segunda del mismo año archiva la primera; decidir en una cerrada → `409 cerrada`.
17. **Prueba con el año anterior**: 2025 con `k = 9` sobre mismas 2025 (T1, T5, T7, T8) y la curva plana → `propuesto = real` exacto cuando la venta fue plana; con diciembre al doble, `desvio_pct` negativo.
18. **Excel**: `hojasMatriz` con filtro `genero = HOMBRE` devuelve 2 líneas + 2 mundos + 1 género + compañía filtrada, hoja `BLOQUES` con 2026 y 2027, hoja `FILTROS` con `genero = HOMBRE`; `hojasMensual` con `bloque = nuevas` solo T2, T3 y T4; celdas sin curva vacías.

## 10. Criterios de aceptación / hito de prueba (para Cowork y Javier)

**Automático** · `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todas más `tests/proyeccion.*`), `npm run build`, `scripts/validar-migraciones-local.sh`; `0018` aplicada en `vector-two`; tipos regenerados; `APP_VERSION = 0.10.0 · M7`.

**Prerrequisitos de Javier** · Histórico de M5 hasta el último mes cerrado; curvas vigentes de M6 (06b) en las 15 agrupaciones; periodos del Niño 2023 y 2026 cargados; fechas de apertura y cierre en las 10 tiendas (y la fecha real de Jirón); venta esperada y tienda de referencia en las tiendas que abran en 2026–2027; nodos GMLE y conjuntos de 02b cargados.

**Hito en navegador (sección F del `cowork-checklist.md`, usuario planner; [ESCRIBE] = pide confirmación a Javier antes; no cerrar ninguna proyección)**
1. Con el comprador: no aparece "Proyección de unidades" en el menú; `/planificacion/proyeccion` redirige; `GET /api/proyeccion` responde `403`.
2. Factores del Niño: [ESCRIBE] Sincronizar con M6; aparecen invierno 2023 (≈ 0,63), verano 2023 (≈ 0,73), invierno 2026 (≈ 0,66, `parcial`) y verano 2026 (≈ 1,24, `parcial`, un mes comparado); editar el de invierno 2026 a 0,70 y ver `manual` [ESCRIBE]; volver a dejarlo vacío.
3. [ESCRIBE] Nueva proyección "Proyección 2026–2027": el modal muestra los bloques (2026: 9 mismas, Jirón como nueva; 2027: 10 mismas, las aperturas previstas como nuevas); crear calcula en menos de 30 s (anotar el tiempo del cálculo y de las tandas SQL).
4. Por línea: elegir una línea de toda temporada con volumen; el gráfico muestra 2023 a 2027; la tabla, sus filas GML-AM con vendido, avance, propuesta y explicación; "Ver meses" despliega los repartos; la prueba con 2025 aparece con su desvío.
5. En una línea de invierno: 2026 con banda de Niño; la explicación de 2027 dice "÷ 0,66"; en una de verano, "set ÷ 1,24". En una línea sin curva (si la hay): propuesta vacía y aviso.
6. [ESCRIBE] Decidir dos filas: una con Aceptar y otra escribiendo una cifra con nota; en 2026 intentar una cifra menor que lo vendido y ver el rechazo; ver que la propuesta de 2027 de la fila cambia al cambiar la decisión de 2026; "Volver a la propuesta" la limpia.
7. Tiendas nuevas y cierres: Jirón en 2026 con sus meses reales y resto por avance propio (y la referencia por venta esperada al lado); una apertura de 2027 con la composición del referente y la rampa; cambiar el referente desde el atajo [ESCRIBE] y recalcular: la composición cambia y la decisión (si la hubo) se conserva.
8. Matriz: las columnas suman (mismas + nuevas + cierres = total; venta a la fecha concilia con el total de QlikView del año a la fecha); desplegable de bloques con las tiendas; filtros por género y "solo con tiendas nuevas"; Exportar a Excel abre con las tres hojas y respeta el filtro.
9. Mensual: la línea elegida en 4 muestra ene–set en gris y oct–dic en cursiva, 2027 completo; conmutar a "Nuevas" muestra solo Jirón y las aperturas; exportar a Excel con el bloque activo.
10. Publicar un mes en M5 (o aprobar una curva en M6, si Javier lo autoriza) [ESCRIBE]: la cabecera dice "desactualizada" con el motivo; Recalcular conserva las dos decisiones y marca `propuesta_cambio` o `curva_cambio` donde corresponda.
11. Comparar cinco líneas conocidas (dos de invierno, dos de verano, una de toda temporada) con el Excel de planeamiento de Javier: las diferencias se explican con la frase de la fila, los bloques de tiendas o el factor; si no, anotar qué parámetro las acerca antes de abrir M8.
12. Anotar tiempos: cálculo completo, apertura de una línea, matriz, mensual, exportación (> 3 s se reporta).

## 11. Alcance: primera entrega (`0.10.0 · M7`) frente a segunda

**Primera entrega**: una proyección por año en curso con `Y` y `Y+1`; bloques de tiendas por año (regla 1); Parte 1 por línea con gráfico, tabla, explicación, decisión por fila y año, detalle con serie, curva y prueba del año anterior; cierre por avance con Niño por temporada; año siguiente por base normalizada × crecimiento; tiendas nuevas (venta esperada, referente, rampa, avance propio) y cierres; Parte 2 matriz con filtros y Excel; Parte 3 mensual con filtros, bloque y Excel; Factores del Niño; desactualización y "la curva cambió"; cerrar y archivar; `GET /api/proyeccion/cerrada` para M8; columna `tienda_referencia_id` en M4 con su `Select` e importador.

**Segunda entrega (`0.10.1 · M7`)**: desglose informativo por marca dentro de la fila (relevantes, "otras", al barrer, con `claveFlujo`) y, si Javier lo quiere, decisión por marca relevante; tallas (centrales/extremas) como participación histórica por fila; ajuste de la composición de una tienda existente con su referente ("tienda que cambió de perfil"); cierres parciales dentro de las mismas tiendas (fracción de año en vez de bloque aparte, si Javier lo prefiere); historial de decisiones (quién cambió qué y cuándo, más allá de la última); seguimiento mes a mes del plan contra el real al publicar cada mes (desvío por línea); imputación de quiebres con la curva (hoy solo señal); CV % por línea-mes como señal de liquidación; vista Parte 1 por agrupación de marca × género; proyección en soles con el precio medio; filtro "mis combinaciones" por responsable (M1b) para el documento de compradores (M8); edición de umbrales avanzados en pantalla.

## 12. Riesgos

- **Tamaño y tiempo del cálculo**: ~10 llamadas a `venta_proyeccion` de ~1 MB (la base real tiene 870 mil hechos) más ~3 000 `upsert` en 6 tandas. Estimación 10 a 25 s en el compute Micro; aceptable para una acción con avance, no para un clic. Si el hito mide más, se sube `TANDA_GML` o se añade una MV con refresco por huella (`0019`) sin cambiar la API. La edición de decisiones no lee venta: milisegundos.
- **Mismas tiendas por año**: la base de `Y+1` suma la fila base y las tiendas nuevas de `Y` que pasan a mismas; un error de fecha en M4 cambia bloques y cifras de golpe. Por eso los bloques se muestran antes de crear y en la matriz, con motivo por tienda, y `tiendas_cambiadas` marca la proyección.
- **Avance propio en tiendas nuevas jóvenes**: con 3 meses posteriores a la rampa la extrapolación es ruidosa; el umbral es un parámetro y la alternativa se muestra al lado (decisión 3 de la sección 14).
- **Composición por soles con precios de la tienda referente**: una tienda nueva con otro nivel de precios (más PREMIUM) heredará el precio medio del referente; el planner lo corrige con el total de la tienda o fijando filas. Es más fiel que la composición en unidades de la red (el ejemplo de El Sol).
- **Factor del Niño de 2026 parcial**: el verano de 2026 se mide con un mes (setiembre); la pestaña lo marca `parcial` y el factor es editable.
- **Determinismo**: cualquier dependencia que no entre en `resumen` (reloj, orden de lectura) rompería "propuesta cambió"; el método recibe `k` y `hoy` y `VERSION_METODO` entra en el resumen.
- **Sin transacción** al cerrar (archivar la anterior y cerrar esta) y al recalcular (upsert por tandas): un fallo intermedio es visible (`desactualizada`, año sin cerrada) y se repara repitiendo, como en M6.
- **Excel en el navegador**: una matriz completa (≈ 600 líneas) o la mensual con 24 meses y tres bloques (≈ 4 000 filas) caben; SheetJS comunitario no escribe estilos (misma limitación que M3 y M11).

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`) y cambios en otros documentos

`DECISIONES.md` no numera: cada entrada es `## 2026-10-15 · M7: <título>` con Decisión / Por qué / Descartado.

1. **M7 se rediseña desde cero: proyección de unidades anuales del año en curso y del año siguiente por GML × agrupación de marca, con tres partes (por línea, matriz, mensual).** Descartado: escenarios con ventana base móvil, crecimiento por unidad y factor de tiendas (borrador del 2026-10-13, inspirado en Vector-One); horizonte de 18 meses.
2. **Regla de mismas tiendas por año proyectado**: abiertas los doce meses del año anterior; nuevas y cierres en bloques aparte y distintos para `Y` y `Y+1`. Descartado: una base única para los dos años; un factor de red por unidad.
3. **El cierre del año en curso es vendido ÷ avance de la curva, con el Niño normalizado por temporada; el año siguiente es el cierre vigente normalizado por el crecimiento del planner.** Descartado: últimos doce meses como base; tendencia aplicada sola.
4. **La fila incluye toda la venta del GML-AM (relevantes, otras y al barrer)**; el desglose por marca es segunda entrega. Descartado: filas por `claveFlujo` × talla como nivel de decisión.
5. **Tiendas nuevas: venta esperada × composición del referente (en soles y precio medio por fila) × rampa × curva de M6; `tiendas.tienda_referencia_id` en M4.** Descartado: composición promedio de la red por defecto cuando hay referente; tabla aparte de referentes.
6. **Decisión por fila y año, y por tienda y año; nada en bloque; la cola larga se cierra con la propuesta.** Descartado: aceptar en bloque; cerrar con filas grandes sin decidir.
7. **Las curvas son de M6 y versionadas: cada registro guarda la versión con que se repartió; "la curva cambió" nunca cambia un total decidido.** Descartado: curvas propias de M7.
8. **Matriz y mensual son vistas derivadas con filtros y Excel en el navegador (SheetJS, patrón M11); la mensual es el contrato de M8.** Descartado: rutas de descarga en el servidor; que M8 reparta.
9. **Factor del Niño calculado por M6 (a demanda) y editable en `factores_volumen_atipico`, fuera de la proyección.** Cierra la pregunta 14 de la ficha 06.
10. **Lectura de venta por función `jsonb` en tandas de nodos (`venta_proyeccion`), sin vista materializada.** Descartado: MV (06b la abandonó); `leerTodo` sobre cientos de miles de filas.

**Cambios que integra el `documentador` al aprobar**: PLAN §4 (diagrama y tabla: `proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios`, `proyeccion_tiendas`, `factores_volumen_atipico`, `tiendas.tienda_referencia_id`, función `venta_proyeccion`, migración `0018`, versión `0.10.0 · M7`), PLAN §5 fila M7 (resumen de esta ficha y el hito) y fila M8 ("consume `GET /api/proyeccion/cerrada?anio=` / `leerProyeccionCerrada`: filas por GML-AM × bloque × tienda × año con `meses` y `origen_meses`; nunca recalcula"), PLAN §7 (pendientes: fechas reales de tiendas, venta esperada y referente de las aperturas, Excel de planeamiento, respuestas a la sección 14); ficha 04 (columna `tienda_referencia_id`, `Select`, importador `TIENDA_REFERENCIA`, "Para qué sirve a M7" reescrito con los bloques); ficha 06 ("Lo que M7 necesitará": tachar la corrida de referencia; pregunta 14 resuelta aquí); ficha 02b ("Lo que M7 y M8 consumen": M7 usa `curvaUnidad` y `marcas_unidad`; `claveFlujo` entra en la segunda entrega como desglose); `cowork-checklist.md` sección F con el hito de la sección 10; `nav.ts` al construir.

## 14. Decisiones que solo Javier puede confirmar (máximo seis; mientras tanto rige la recomendación)

1. **Tienda nueva con meses reales.** ¿El resto del año en curso de una tienda nueva se propone por su propio avance cuando ya tiene tres meses cerrados después de la rampa, o siempre por venta esperada y referente? **Recomendación: por avance propio desde tres meses (Jirón hoy), con la cifra por venta esperada visible al lado.**
2. **Base del año siguiente.** ¿La base de 2027 es el cierre vigente de 2026 (decidido o, si no, propuesto) de las mismas tiendas de 2027, o los últimos doce meses reales? **Recomendación: el cierre vigente de 2026; así una decisión de 2026 arrastra 2027 y no hay dos bases.**
3. **Cola larga y cierre de la proyección.** ¿Se puede cerrar con filas sin decidir cuya propuesta sea menor que 24 unidades al año (toman la propuesta y quedan marcadas), exigiendo decisión en todas las demás? **Recomendación: sí, con 24 como umbral editable.**
4. **Rampa de maduración.** ¿Mes de apertura al 70 % (prorrateado por días), segundo al 85 %, tercero al 100 %? **Recomendación: esa rampa por defecto, editable por proyección y por tienda.**
5. **Marcas al barrer y tallas dentro de la fila.** ¿La fila GML-AM incluye toda la venta (relevantes, otras, al barrer) y las tallas no se proyectan en M7 (M8 reparte por participación histórica)? **Recomendación: sí; el desglose por marca es segunda entrega.**
6. **Cierres de tienda como bloque aparte.** ¿Una tienda que cierra dentro del año proyectado sale de "mismas tiendas" y se muestra en un bloque "Cierres" (real hasta el cierre más la proyección de los meses que quedan), en vez de restar una fracción dentro de las mismas tiendas? **Recomendación: bloque aparte (más legible y simétrico con las aperturas).**

## 15. Lo que necesito del Excel de planeamiento de Javier (todavía no enviado)

- **La hoja de una línea**: estructura real de filas (¿GML × agrupación de marca, como decidido, o también por marca o talla?) y de columnas (años históricos, vendido a la fecha, avance, cierre, crecimiento, año siguiente); qué celdas son fórmula y cuáles escribe él; en qué orden las llena.
- **Cómo calcula hoy el avance** (¿curva de la línea o de la agrupación?, ¿sobre la red completa o sobre mismas tiendas?) y **qué hace con Jirón** en 2026 (¿la suma al total o la lleva aparte?), para contrastar con la regla 1.
- **La matriz actual** (si existe): cabeceras exactas de sus columnas, para que la Parte 2 y el Excel exportado reproduzcan sus nombres y orden.
- **Cómo planifica una apertura hoy**: ¿parte de la venta esperada en soles?, ¿cómo pasa a unidades (precio medio de qué tienda)?, ¿usa una tienda parecida?, ¿qué rampa aplica en los primeros meses?
- **Cinco líneas de validación** (dos de invierno, dos de verano, una de toda temporada) con sus cifras de 2025, vendido 2026 a setiembre, cierre 2026 y 2027 planificados, para el paso 11 del hito; y, si lo tiene, el cierre que planificó en setiembre de 2025 frente al real (valida la "prueba con el año anterior").
- **Qué le entrega a M8 / a los compradores** desde esa hoja (columnas del documento mensual), para que la Parte 3 y `GET /api/proyeccion/cerrada` no dejen fuera ningún campo.

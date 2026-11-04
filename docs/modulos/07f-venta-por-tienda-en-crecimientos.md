# 07f · Venta por tienda y año de un género × mundo, dentro de Crecimientos

> Estado: **construida y validada por QA (2026-11-04); falta el hito con Javier** (sección P de `docs/pruebas/cowork-checklist.md`). Mejora pequeña de M7. Versión **`0.16.1 · M7 d`** (la ficha reservaba `0.15.0 · M7 b`, pero al cerrar la vigente ya era la `0.16.0 · M8 b` de 08b-1 y una versión no baja: ver «Cambios respecto a la especificación»). Commits `M7:` (`60a49f2`, `846351e`, `fc96e66` y las correcciones de QA). **Migración `0033_venta_tienda_nodos.sql`**, de solo lectura, **aplicada en Vector2** (la ficha la citaba como `00F1`; tomó la siguiente libre al construir, registro único en `docs/PLAN.md` §5). Depende de [07](07-proyeccion-anual.md) (regla 11, bloques), [07c](07c-crecimientos-por-genero-mundo.md) (`B`, `base_siguiente`, B2), [06d](06d-curva-y-crecimiento-por-genero-mundo.md) §4.2 (la pestaña de solo lectura) y [06e](06e-cierre-del-anio-y-base-sin-nino.md) (`base_normalizada = B'`). Cifras sintéticas; ningún dato real de Lukers. Las secciones 1 a 12 son la especificación; lo construido y lo que cambió respecto a ella está en «Construido y validado» y «Cambios respecto a la especificación», al final.

## 1. Objetivo

En la pestaña Crecimientos, Javier ve por género × mundo (GM) una «Base 2026 (u) real» y no sabe qué tiendas ni qué años hay detrás («¿qué estoy evaluando? ¿mismas tiendas?»). 07f añade, por celda GM y para el Resto, una **tabla de venta por tienda y año** (unidades y soles netos de IGV, 2023 a 2026) con su variación, las tiendas de la base marcadas aparte de las que quedan fuera, y un subtotal de la base que **cuadra exacto con `Σ B`** de esa celda. No cambia ningún cálculo, no escribe nada y no lee IA.

## 2. Modelo de datos

**Sin tablas ni columnas nuevas.** Solo una función de lectura.

### 2.1 Por qué no basta lo que ya existe

| Función | Unidades y soles por tienda × mes de un GM | Veredicto |
|---|---|---|
| `venta_genero_mundo(p_desde)` (0029) | Tienda × mes × GM × agrupación, **solo unidades**, todos los GM a la vez (1,6 s, 554 KB) | No: le faltan los soles. Además, la prueba estática de M7 prohíbe nombrarla desde `src/lib/proyeccion/`, porque es de M6 |
| `venta_lineas_ia(...)` (0030) | Por fila × **clave de pertenencia** × mes, **solo unidades** | No: no da la tienda ni los soles. Por diseño (D12 de 07e) nunca da soles |
| `venta_proyeccion(...)` (0021) | `por_tienda` con unidades y soles, pero **por fila** (GML × agrupación de marca × equivalencia) × tienda × mes, y además calcula `filas`, `pesos`, `detalle_w12` y la disponibilidad con el stock del CD | No: para MUJER · URBANO serían unas 180 filas × 11 tiendas × 45 meses, ≈ 90 000 tuplas (varios MB), y se arriesga el límite de 8 s |
| `venta_mensual_tienda()` (0015) | Tienda × mes con soles, pero de **todo** el producto y **con el CD** | No: no corta por GM |
| Consulta directa a `venta_stock_vigente` | — | No: decenas de miles de filas por GM, por encima del corte de 1 000 filas de PostgREST |

### 2.2 Función nueva `venta_tienda_nodos(p_gml_ids uuid[], p_desde date, p_hasta date) returns jsonb`

- **Qué lee.** `venta_stock_vigente` (solo cargas publicadas), de las equivalencias de los nodos `p_gml_ids`, **solo de tiendas `tipo = 'Tienda'`** (el CD nunca entra) y solo de los periodos `p_desde ≤ periodo ≤ p_hasta`. Selecciona **únicamente `unidades` y `venta_soles`**: ni costo ni stock.
- **Por qué recibe nodos y no `(genero, mundo)`.** El backend arma la lista desde `catalogo.nodos`, igual que el `GET …/crecimientos` asigna cada fila base a su GM. Así la misma función sirve para una celda GM y para el Resto (todos los nodos de géneros no detallados), y la asignación de nodos a GM es la misma en las dos lecturas. Los ids viajan en el cuerpo del `rpc`, sin límite de URL.
- **Forma.** Preagrega por `(equivalencia, tienda, periodo)` y después sube a `(tienda, periodo)`, como 0027 y 0029. Devuelve:
  `{ "series": [ { "t": tienda_id, "p": "aaaa-mm", "u": unidades_netas, "s": venta_soles } ... ], "cargas": { "aaaa-mm": carga_id } }`.
  - Orden determinista (`t`, `p`).
  - `cargas` sale de la misma sentencia y solo cubre `[p_desde, p_hasta]`. Sirve para detectar meses sin carga publicada.
  - Unidades netas (las devoluciones restan) y soles netos de IGV, tal como los guarda M5.
- **Convenciones.** `language sql stable security invoker set search_path = ''`, todo calificado con esquema y cuerpo sin comentarios `--`. Lleva `revoke execute … from public, anon, authenticated`, `grant execute … to service_role` y `comment on function`. La migración es idempotente (`create or replace`) y no usa `DROP`, `UPDATE` ni backfill.
- **Presupuesto (lo mide `datos` antes de dar la tanda por buena y lo anota al pie de la migración):**
  - casos: MUJER · URBANO (el GM más grande) y el Resto, con `p_desde = 2023-01-01` y `p_hasta = 2026-09-01`;
  - en frío: ≤ 3 s; en caliente: ≤ 1 s; tamaño: ≤ 150 KB (son unas 15 tiendas × 45 meses ≈ 700 tuplas).
  - Si el Resto pasa de 3 s en frío, se mide de nuevo con `p_desde = enero de Y−2`, y la ficha se ajusta a tres años.
- **Script de humo `scripts/humo-0033.sql`.** Comprueba que:
  - ninguna serie es de un CD;
  - `Σ u` de un GM coincide con la suma de `venta_stock_vigente` de sus equivalencias en tiendas de tipo Tienda;
  - el documento no contiene ninguna clave distinta de `t`, `p`, `u`, `s` y `cargas`.

### 2.3 Qué se lee de la proyección (sin escribir nada)

| Dato | De dónde | Para qué |
|---|---|---|
| `anio_en_curso` (`Y`), `hasta_periodo` (`k`), `estado`, `calculando_desde`, `resumen.version_metodo`, `resumen.gm_fuera_base`, `resumen.gm_con_nino` | `proyecciones` | El corte del año en curso y los avisos |
| `parametros.bloques[Y]` y `parametros.bloques[Y+1]` | `proyecciones.parametros` (los guardó el cálculo) | Qué tienda está en la base y por qué; fechas de apertura y cierre **con que se calculó** |
| Filas base activas de `Y+1`: `base_siguiente` (`B`) y `base_normalizada` (`B'`) | `leerFilasConAnios(…, { columnas: "ligeras", tiendaId: null, soloActivas: true })`, **la misma lectura del `GET …/crecimientos`**, filtrada en memoria por GM | `Σ B` y `Σ B'` del conjunto |
| Filas de tienda activas, registro de `Y` con `bloque = 'nuevas'`: `decidido ?? propuesto` | `leerFilasConAnios(…, { columnas: "ligeras", soloTiendas: true, soloActivas: true })`, filtrada en memoria | El vigente exacto de `Y` de las tiendas que entran a la base y de las aperturas de `Y` |
| Código y nombre de las tiendas | `tiendas` (`id, codigo, nombre`), una tabla de unas 20 filas | Mostrar nombres actuales. La **clasificación** sale de `bloques`, no de M4 |
| Catálogo de nodos, géneros y mundos | `cargarCatalogo`, `leerGenerosMundos` | Los nodos del GM o del Resto y los nombres |

No lee `historico`, `factores_mes`, `ia_*` ni stock.

## 3. Cómo se arma (lógica pura en `src/lib/proyeccion/venta-por-tienda.ts`)

### 3.1 Grupos de tiendas (de los `bloques` guardados)

| Estado | Condición | Grupo | Texto |
|---|---|---|---|
| `misma` | en `bloques[Y+1].mismas` y en `bloques[Y].mismas` | **base** | «Misma tienda de 2026 y de 2027» |
| `entra` | en `bloques[Y+1].mismas` y en `bloques[Y].nuevas` | **base** | «Abrió en nov 2025: entra en la base de 2027 con su 2026 vigente» |
| `sale` | en `bloques[Y].mismas` y en `bloques[Y+1].cierres` | fuera | «Cierra el 30 jun 2027: su 2026 sale de la base» |
| `abrio_en_curso` | en `bloques[Y].nuevas` y fuera de `bloques[Y+1].mismas` | fuera | «Abrió en may 2026: en 2027 va aparte (nueva del año anterior); entra en la base de 2028» |
| `cerro` | `fuera` en `Y+1` con motivo `cerrada_antes`, o en `bloques[Y].cierres` | fuera | «Cerró el 31 ago 2024» |
| `otra` | cualquier otro `fuera` de `Y+1` (desactivada, sin apertura, planificada) | fuera | `textoMotivoTienda(motivo, Y+1)` |
| `sin_bloque` | tiene venta pero no aparece en `bloques` (se creó después de calcular) | fuera | «No existía al calcular: recalcula» |

- **Base** = todas las tiendas de `bloques[Y+1].mismas`, **también las que no vendieron nada en el GM**. Esa fila sale en ceros, y así el número de tiendas de la cabecera coincide con la regla 11 de 07.
- **Fuera** = solo las tiendas con alguna unidad o algún sol en el rango, o con un vigente de `Y` distinto de 0.
- **El CD nunca aparece:** la función no lo devuelve.

### 3.2 Periodos (columnas) y el año en curso

Con `Y = 2026` y `k = 9`, las columnas son las siguientes. «Real» es venta publicada; «vigente» es lo que usa M7.

| Clave | Columna | Contenido |
|---|---|---|
| `2023`, `2024`, `2025` | Año completo | Real, en u y S/. Solo aparecen los años de `Y−3` a `Y−1` con al menos un mes publicado |
| `2025-ac` | «2025 ene–sep» | Real de los mismos meses del año anterior, en u y S/ (la referencia honesta para el ritmo de 2026) |
| `2026-ac` | «2026 ene–sep (real)» | Real hasta `k`, en u y S/ |
| `vigente` | «2026 cierre vigente» | **Solo en unidades**: real ene–sep más el proyectado de oct–dic, con el que M7 arma `B` (§3.3) |

**Decisión sobre el año en curso: se muestran las dos columnas.** «2026 ene–sep (real)» es el único dato duro, y es el que se compara con «2025 ene–sep». «2026 cierre vigente» es lo que mide `B`, el número sobre el que se aplica el crecimiento, y se compara con «2025» completo. Mostrar solo el real no cuadra con `B`, y mostrar solo el vigente esconde qué parte es proyección.

- **El corte es el `hasta_periodo` de la proyección, no el último mes publicado.** Si hay octubre publicado y la proyección se calculó hasta septiembre, la tabla corta en septiembre. La pestaña ya avisa de `cargas_nuevas`.
- **Soles del cierre vigente: no se muestran.** M7 no proyecta soles, y la tabla no los inventa (pregunta abierta 1).

### 3.3 La columna «cierre vigente» por tienda y su cuadre con `Σ B`

Para el conjunto `G` (la celda GM o el Resto), con las filas base `f ∈ G` de `Y+1` con `B_f ≠ null`:

1. **Tiendas que entran (exacto).** `V_t = Σ` del vigente de `Y` (`decidido ?? propuesto`) de las filas de tienda `t` con `bloque = 'nuevas'` cuya fila base (`claveBaseDe`) es una `f ∈ G` con `B_f ≠ null`. Es exactamente el sumando que `recalcularBaseSiguiente` agrega a `B`.
2. **Resto de la base.** `R = Σ_f B_f − Σ_{t ∈ entra} V_t`.
3. **Mismas tiendas (estimado por tienda, exacto en la suma).** `R` se reparte entre las tiendas `misma` en proporción a su real ene–`k` de `Y` en el GM, con pesos `max(0, real)`. El reparto es entero por mayor resto, y los empates se rompen por código de tienda. Es **el mismo criterio** con que M7 estima el aporte de una tienda que sale (`aporteSaliente`: `cierre × vendido_tienda ÷ vendido_fila`), aplicado aquí al GM entero y no fila por fila. Por eso la cifra por tienda se rotula «estimado».
4. **Lo que no se puede repartir.** Si todas las `misma` tienen peso 0, o si `R < 0` (por el `max(0, ·)` de `B`), lo que falta va a una fila **«Sin atribuir a tienda»** dentro de la base.

**Invariante:** `Σ_{t ∈ base} vigente_t + sin_atribuir = Σ_f B_f`, que es el `agregado.base` de la misma celda en el `GET …/crecimientos`.

**El cuadre no depende de que la venta de hoy sea la del cálculo:** si se republicó un mes, solo cambia cómo se reparte el vigente entre tiendas.

- **Aperturas de `Y`:** su vigente es exacto, sale de sus filas de tienda y se muestra en el grupo fuera.
- **Tiendas `sale`:** muestran «—» en el vigente, con el título «su 2026 sale de la base (B2); no se reparte por tienda».
- **Cada celda del vigente** lleva debajo «real 6 000 + proy. 2 400». El proyectado puede salir negativo si la base excluye filas (aviso `filas_sin_base`).

### 3.4 Variaciones

`variacionVenta(anterior, actual)` devuelve un `%` o un motivo:
- `nueva`, si el anterior es 0 y el actual es mayor que 0;
- `sin_dato`, si los dos son 0 o el anterior es negativo;
- `parcial`, si la tienda no estuvo abierta todo uno de los dos periodos según sus fechas de `bloques`. Un año `Z` completo exige apertura ≤ `Z-01-01` y cierre nulo o ≥ `Z-12-31`. Un periodo ene–`k` exige apertura ≤ `Z-01-01` y cierre nulo o ≥ el último día de `k`;
- `incompleto`, si en alguno de los dos periodos falta un mes publicado.

Se calcula en u y en S/ para:
- `2024` frente a `2023`;
- `2025` frente a `2024`;
- `2026-ac` frente a `2025-ac`;
- el vigente frente a `2025`, solo en unidades.

En los subtotales:
- la variación se calcula sobre las sumas;
- si alguna tienda incluida es `parcial`, se añade la variación **comparable** (sin esas tiendas) y la nota «incluye T10, sin 2025 completo».

## 4. Contrato de API

**`GET /api/proyeccion/proyecciones/[id]/crecimientos/por-tienda?gm=<genero_id>.<mundo_id>|resto`**: `requirePlanner` (el comprador recibe `403` y sin sesión, `401`). Es solo lectura, no tiene cuerpo y usa `leerConsulta`, `idDeRuta`, `ok` y `errorConCodigo`.

```ts
// esquemas.ts
export const porTiendaQuerySchema = z.object({
  gm: z.string().refine((v) => v === "resto" || /^[0-9a-f-]{36}\.[0-9a-f-]{36}$/i.test(v), "gm debe ser «genero_id.mundo_id» o «resto»."),
});

// tipos-api.ts
export type CifraVentaApi = { u: number; s: number };                   // unidades netas; S/ sin IGV, 2 decimales
export type MotivoVariacion = "nueva" | "sin_dato" | "parcial" | "incompleto";
export type PeriodoVentaApi = { clave: string; anio: number; hasta_mes: number; meses_faltantes: string[] };   // "2023" … "2025-ac", "2026-ac"
export type EstadoTiendaVenta = "misma" | "entra" | "sale" | "abrio_en_curso" | "cerro" | "otra" | "sin_bloque";
export type TiendaVentaApi = {
  tienda_id: string; codigo: string; nombre: string;
  grupo: "base" | "fuera"; estado: EstadoTiendaVenta; estado_texto: string;
  fecha_apertura: string | null; fecha_cierre: string | null;          // las de `bloques`
  periodos: Record<string, CifraVentaApi & { completo: boolean }>;
  vigente: { u: number; real: number; proyectado: number; exacto: boolean } | null;   // null = «—»
};
export type TotalVentaApi = {
  periodos: Record<string, CifraVentaApi>; vigente: number | null;   // en `base`: = base.total (incluye «sin atribuir»); en `conjunto`: null
  no_comparables: Record<string, string[]>;                            // clave de periodo → códigos `parcial`
};
export type VentaPorTiendaApi = {
  conjunto: { clave: string; nombre: string; es_resto: boolean };     // "MUJER · URBANO" | "Resto"
  anio_en_curso: number; anio_siguiente: number; hasta_periodo: string; k: number;
  periodos: PeriodoVentaApi[];
  base: { total: number | null; corregida: number | null; tiendas: number; entran: string[]; sin_atribuir: number;
          motivo_nulo: null | "metodo_anterior" | "sin_filas" };     // total = Σ B = agregado.base del GET …/crecimientos
  tiendas: TiendaVentaApi[];                                          // base primero; en cada grupo, por u. de 2026-ac desc y código
  totales: { base: TotalVentaApi; fuera: TotalVentaApi; conjunto: TotalVentaApi };
  avisos: { codigo: "filas_sin_base" | "meses_faltantes" | "sin_atribuir" | "sin_bloque"; mensaje: string }[];
};
```

| Caso | Respuesta |
|---|---|
| Correcto | `200 { data: VentaPorTiendaApi }` |
| `gm` ausente o mal formado | `400` (zod, mensaje en castellano) |
| Proyección inexistente o `id` que no es uuid | `404` |
| Género o mundo que no existen en el catálogo | `404 gm_no_encontrado` |
| Género que no es HOMBRE ni MUJER (`generosDeMatriz`) | `400 genero_no_detallado`: «Ese género va en el Resto: usa gm=resto» |
| Proyección sin `bloques` (nunca calculada) | `409 sin_calcular`: «Calcula la proyección para ver la venta por tienda» |
| Cálculo vivo (`calculoEnCurso`) | `409 calculo_en_curso` (`MENSAJE_CALCULO_EN_CURSO_PROYECCION`) |
| `version_metodo < 4` o GM sin filas base de `Y+1` | `200` con `base.total = null` y `motivo_nulo`; las columnas reales se muestran igual |
| Error de base o timeout | `500` por `fallaDb` |

- Vale igual para proyecciones en trabajo, cerradas y archivadas.
- **Excel:** no hay ruta propia. La pantalla arma la hoja con la misma respuesta (§5).

## 5. Pantalla (pestaña Crecimientos; admin y planner; formato `es-PE`)

- **Acción.** En la tabla por GM, el Resto y el Total, cada fila de GM y la del Resto ganan el botón «**Ver por tienda**», junto a «Analizar y aprobar». El Total no lo tiene. Al pulsarlo:
  - se abre, **debajo de la tabla**, una `Card` «Venta por tienda · MUJER · URBANO» con un `Select` para cambiar de GM o pasar al Resto, y el botón «Cerrar»;
  - la elección vive en la URL como `?por_tienda=<clave>`, que se conserva al recargar y se borra al cambiar de pestaña o de proyección, igual que `gm_ia`.
- **Cabecera de la Card** (la aclaración que pidió Javier), por ejemplo: «**Base 2027 = 15 600 u**: unidades 2026 **vigentes** (real ene–sep + proyectado oct–dic) de las **mismas tiendas de 2027 (4 tiendas: abiertas los doce meses de 2026)**. Es la "Base 2026 (u) real" de la tabla de arriba. El crecimiento aprobado se aplica sobre la base corregida del Niño (16 400 u), que no se reparte por tienda.» La parte de la corregida solo aparece si `Σ B' ≠ Σ B`. Debajo va la leyenda «Soles netos de IGV. Sin CD. Datos hasta sep 2026».
- **Tabla (`DataTable`, con desplazamiento horizontal).**
  - **Columnas:** Tienda (código, nombre y `Badge` del estado, con el texto de §3.1 como título) · 2023 · Var. · 2024 · Var. · 2025 · Var. · 2025 ene–sep · 2026 ene–sep · Var. · 2026 cierre vigente · Var.
  - **Celda de periodo:** dos líneas, «7 000 u» y «S/ 412 300».
  - **Celda de variación:** dos líneas, «+11,1 % u» y «+9,8 % S/». Si hay motivo, se ve «nueva», «parcial», «incompleto» o «—», con el motivo como título.
  - **Celda del vigente:** «8 400 u» y, debajo, «real 6 000 + proy. 2 400 · estimado», salvo cuando es exacto.
  - **Periodos:** un año parcial de la tienda se ve en gris con «parcial». Un periodo con meses faltantes lleva en su cabecera el `Badge` «faltan: mar 2024».
- **Orden de las filas:**
  1. las tiendas de la **base**;
  2. «Sin atribuir a tienda», si no es 0;
  3. el subtotal **«Base 2027 · mismas tiendas de 2027 (4)»**, en negrita, con el vigente igual a `Σ B` y la marca «= base de la tabla de arriba»;
  4. las tiendas de **fuera**, con el subtotal «Fuera de la base (3)»;
  5. **«Total MUJER · URBANO (todas las tiendas, sin CD)»**, solo con las columnas reales.
- **Subtotales con tiendas parciales:** la variación lleva una segunda línea, «comparable +17,6 %», con el título «sin T10 (sin 2025 completo)».
- **Avisos (`Alert` sobre la tabla):**
  - `filas_sin_base`: «2 filas sin curva vendieron 150 u en 2026: no entran en la base y sí en el real por tienda»;
  - `sin_atribuir`;
  - `meses_faltantes`;
  - `sin_bloque`;
  - si `proyeccion.desactualizada` incluye `cargas_nuevas`, `tiendas_cambiadas` o `crecimientos_cambiados`: «La proyección cambió de datos después de calcular: el real por tienda es el de hoy; recalcula para que el reparto use la misma venta». El cuadre con `Σ B` se mantiene.
- **Otros estados:**
  - `motivo_nulo = metodo_anterior`: la cabecera dice «Recalcula la proyección para ver la base 2027» y no se muestra la columna de vigente.
  - `sin_filas`: «Este GM no tiene filas base en 2027».
- **Excel.** El botón «Descargar Excel» genera en el navegador (`descargarLibro`) dos hojas: `POR_TIENDA`, con las mismas filas y una columna por cifra (u, S/ y %), y `FILTROS` (proyección, conjunto, corte, fecha). El archivo se llama `nombreArchivoProyeccion(Y, "por-tienda")`.
- **Comprador:** no ve la pestaña. **Cerrada o archivada:** se ve igual.

## 6. Reglas de negocio (vitest)

1. **Cuadre:** para toda celda GM y para el Resto, `base.total` del `GET …/por-tienda` = `agregado.base` de la misma celda del `GET …/crecimientos` sobre la misma base falsa. Además, `Σ vigente(base) + sin_atribuir = base.total`, exacto en enteros.
2. **Reparto:** con `R = 1 000` y tres `misma` con real 1:1:1 → 334 / 333 / 333, en orden de código. Con pesos 0 en todas → todo va a `sin_atribuir`. Una tienda con real negativo pesa 0.
3. **Tiendas que entran:** su vigente es exactamente la suma de sus filas de tienda `nuevas` de `Y` cuya fila base tiene `B ≠ null`. Una fila de tienda sin fila base, o con `B = null`, no suma.
4. **Grupos:** los siete estados de §3.1 salen de `bloques`, no de M4. Cambiar `fecha_cierre` en M4 después de calcular no mueve una tienda de grupo. Todas las de `bloques[Y+1].mismas` aparecen, aunque no tengan venta.
5. **Sin CD:** una serie de un CD en la base falsa no aparece en `tiendas` ni en ningún total. Además, una prueba estática comprueba que la migración filtra `tipo = 'Tienda'` y que solo nombra `unidades` y `venta_soles` de `venta_stock_vigente`.
6. **Corte:** con venta publicada en octubre y `hasta_periodo = 2026-09`, «2026 ene–sep» no incluye octubre. «2025 ene–sep» usa los mismos `k` meses.
7. **Variaciones:** son correctas para `nueva`, `sin_dato`, `parcial` e `incompleto`. El subtotal con una tienda `parcial` trae la variación total y la comparable.
8. **Meses faltantes:** si falta `2024-03` en `cargas`, el periodo `2024` trae `meses_faltantes = ["2024-03"]`, y sus dos variaciones salen `incompleto`.
9. **Solo lectura y aislamiento:**
   - el servicio no llama a `insert`, `update`, `upsert`, `delete` ni a otro `rpc` que no sea `venta_tienda_nodos`;
   - no nombra tablas `ia_*` ni `venta_lineas_ia`;
   - solo `consultas.ts` nombra `venta_tienda_nodos` (prueba estática).
10. **Ruta:**
    - `403` para el comprador y `401` sin sesión;
    - `400` con `gm` mal formado;
    - `404 gm_no_encontrado`, `400 genero_no_detallado`, `409 sin_calcular` y `409 calculo_en_curso`;
    - `200` con `motivo_nulo` en el método 3.

## 7. Casos borde

| Caso | Comportamiento |
|---|---|
| Tienda de la base sin venta en un año o en todo el GM | La fila aparece con 0. La variación sale `nueva` o `sin_dato`. En el vigente pesa 0 |
| Tienda que entra (abrió en nov 2025) | En la base; su 2025 sale `parcial`, su vigente es exacto y su ene–sep 2025 es 0, así que la variación sale `nueva` |
| Apertura del año en curso | Va fuera, con su vigente exacto y el texto «entra en la base de 2028» |
| Cierre del año siguiente | Va fuera, con «—» en el vigente y el texto «su 2026 sale de la base» |
| Tienda cerrada en años anteriores | Va fuera, solo con años reales; el año del cierre sale `parcial` |
| CD | No aparece nunca |
| Mes faltante en las cargas | `Badge` en la cabecera del periodo; las variaciones salen `incompleto` |
| Primer año con datos incompleto (por ejemplo, desde 2023-03) | Igual que un mes faltante |
| GM sin filas base de `Y+1` | `motivo_nulo = sin_filas`; las columnas reales se muestran |
| GM sin ninguna venta | Las tiendas de la base salen en 0, sin «fuera», y el vigente se reparte a `sin_atribuir` si `Σ B > 0` |
| Filas sin curva (`gm_fuera_base`) | Aviso `filas_sin_base`; el proyectado de una tienda puede salir negativo |
| Tienda creada después de calcular | Estado `sin_bloque`, fuera |
| Nodo que cambió de mundo después de calcular | Las dos lecturas usan el árbol vigente, así que el cuadre se mantiene. El aviso de `crecimientos_cambiados` pide recalcular |
| Proyección de método 3 | `motivo_nulo = metodo_anterior` |

## 8. Caso sintético (`tests/proyeccion.venta-por-tienda.fixture.ts`)

`Y = 2026`, `k = 9`, MUJER · URBANO, datos publicados de 2023-01 a 2026-09. Tiendas:
- T01, T02 y T03, mismas;
- T04, que cierra el 2027-06-30 (`sale`);
- T10, que abrió el 2025-11-15 (`entra`);
- T11, que abrió el 2026-05-02 (`abrio_en_curso`);
- T09, que cerró el 2024-08-31 (`cerro`);
- CD1, con venta, que no debe aparecer.

| Tienda | 2023 | 2024 | 2025 | 2025 ene–sep | 2026 ene–sep | 2026 cierre vigente |
|---|---|---|---|---|---|---|
| T01 | 6 000 | 6 300 | 7 000 | 5 000 | 6 000 | **8 400** (est.) · +20,0 % |
| T02 | 3 000 | 3 200 | 3 500 | 2 500 | 3 000 | **4 200** (est.) · +20,0 % |
| T03 | 1 200 | 1 100 | 1 400 | 1 000 | 1 000 | **1 400** (est.) · 0,0 % |
| T10 (entra) | 0 | 0 | 300 parcial | 0 | 1 200 | **1 600** (exacto) · parcial |
| **Base 2027 (4)** | 10 200 | 10 600 | 12 200 | 8 500 | 11 200 (+31,8 %; comparable +17,6 %) | **15 600 = Σ B** (+27,9 %; comparable +17,6 %) |
| T04 (sale) | 1 000 | 1 000 | 1 100 | 800 | 800 | — |
| T11 (abrió 2026) | 0 | 0 | 0 | 0 | 400 | 700 (exacto) |
| T09 (cerró 2024) | 900 | 500 parcial | 0 | 0 | 0 | — |

- **Reparto:** `Σ B = 15 600` y `V_T10 = 1 600`, así que `R = 14 000`, repartido 6 000 : 3 000 : 1 000 = 8 400 / 4 200 / 1 400. La suma de la base da 15 600.
- **Soles de T01:** ene–sep 2025 S/ 380 000 y ene–sep 2026 S/ 480 000, una variación de +26,3 % S/ (frente a +20,0 % en u).
- **Variaciones de T03:** 2024 frente a 2023 da −8,3 % y 2025 frente a 2024, +27,3 %.

## 9. Criterios de aceptación (hito de Javier)

1. En Crecimientos, «Ver por tienda» en MUJER · URBANO abre la tabla. La cabecera dice cuántas tiendas tiene la base de 2027 y que la base es «2026 vigente = real ene–sep + proyectado oct–dic».
2. El subtotal «Base 2027» de la columna «2026 cierre vigente» es **igual** a la «Base 2026 (u) real» de esa celda en la tabla de arriba. Comprobar en dos GM y en el Resto.
3. Se ven por separado las tiendas que entran y las que quedan fuera (cierres de 2027, aperturas de 2026, cerradas), cada una con su motivo. No aparece el CD.
4. Cada periodo muestra unidades y soles netos de IGV, y la variación de 2026 ene–sep frente a 2025 ene–sep en las dos medidas.
5. La URL con `?por_tienda=` sobrevive a recargar. El Excel descarga las mismas cifras.
6. El comprador no ve la pestaña. En una proyección cerrada se ve igual.
7. Pasan `lint`, `tsc`, `vitest` y `build`, y `APP_VERSION = "0.16.1 · M7 d"` (la ficha decía `0.15.0 · M7 b`).

## 10. Fuera de alcance

- soles del cierre vigente o precio medio proyectado (pregunta 1);
- repartir `B'` (la corregida del Niño) por tienda;
- el reparto del vigente fila por fila (se reparte por GM: §3.3);
- vista por tienda del Total o por línea;
- gráfico;
- la red comparable `C(Y)` de las referencias de M6 (06d §5.1) en esta tabla;
- cualquier escritura, decisión o enlace a «Aprobar» desde la tabla;
- datos de IA;
- stock y costo.

## 11. Plan de tandas (cada archivo con un solo dueño)

**Tanda 1 (en paralelo).**
- **`datos`:**
  - archivos: `supabase/migrations/0033_venta_tienda_nodos.sql` (antes `00F1`), `scripts/humo-0033.sql` y `src/lib/supabase/database.types.ts` (regenerado);
  - aplica en **`vector-two`** (nunca en `lukers-compras`), mide según §2.2 y anota la medición al pie.
- **`backend` · contratos:**
  - `src/lib/proyeccion/tipos-api.ts`: solo los tipos nuevos de §4;
  - `src/lib/proyeccion/esquemas.ts`: solo `porTiendaQuerySchema`.
  - Se commitean solos y desbloquean al `frontend`.

**Tanda 2 (en paralelo, después de la 1).**
- **`backend`:**
  - `src/lib/proyeccion/venta-por-tienda.ts` (puro: `clasificarTiendasVenta`, `periodosVenta`, `agregarSeries`, `atribuirBase`, `variacionVenta`);
  - `src/lib/proyeccion/servicio-venta-por-tienda.ts`;
  - `src/lib/proyeccion/consultas.ts`: solo `leerVentaTiendaNodos`;
  - `src/app/api/proyeccion/proyecciones/[id]/crecimientos/por-tienda/route.ts`;
  - pruebas: `tests/proyeccion.venta-por-tienda.fixture.ts`, `tests/proyeccion.venta-por-tienda.test.ts` (reglas 2 a 4 y 6 a 8), `tests/proyeccion.venta-por-tienda-rutas.test.ts` (reglas 1, 5, 9 y 10), `tests/proyeccion.fake-db.ts` (el `rpc` falso `venta_tienda_nodos`) y `tests/proyeccion.estatico.test.ts` (mapa de rutas, lista de módulos de `src/lib/proyeccion/` y «solo `consultas.ts` nombra `venta_tienda_nodos`»).
  - Importa sin modificar: `crecimientos.ts` (`agregarFilas`, `claveGM`, `generosDeMatriz`), `servicio-base.ts`, `contexto.ts`, `bloques.ts`, `reglas.ts` y `tipos.ts` (`claveBaseDe`).
- **`frontend`:**
  - `src/app/(app)/planificacion/proyeccion/venta-por-tienda.tsx` (la `Card`);
  - `src/app/(app)/planificacion/proyeccion/venta-por-tienda-vista.ts` (puro: filas, textos, motivos y hoja de Excel);
  - `crecimientos-tab.tsx` (el botón por fila y el montaje de la `Card`);
  - `proyeccion-panel.tsx` (el parámetro `por_tienda`, que se limpia como `gm_ia`);
  - pruebas: `tests/proyeccion.venta-por-tienda-vista.test.ts`, `tests/proyeccion.venta-por-tienda-render.test.ts` y `tests/proyeccion.venta-por-tienda-pantalla.fixture.ts`.
  - Importa sin modificar: los tipos de la tanda 1, `descarga-libro.ts`, `vista.ts` (`unidades`, `formatearPct`) y el kit de UI.

**Tanda 3.**
- **`qa`:** corre las cuatro verificaciones, recorre §9 con la base falsa y añade los casos borde de §7 que falten en `tests/proyeccion.venta-por-tienda-qa.test.ts`, su único archivo.
- **`seguridad`** (sonnet): revisión de solo lectura (guard, ausencia de CD, IA y escrituras, y `revoke` de la función).
- **`documentador`:** `CHANGELOG.md`, `docs/PLAN.md`, `docs/DECISIONES.md`, esta ficha (lo construido), `docs/pruebas/cowork-checklist.md` (sección M) y `src/lib/version.ts` (`0.16.1 · M7 d`; la ficha decía `0.15.0 · M7 b`).

## 12. Propuestas para `docs/DECISIONES.md`

*Registradas como decisiones 110, 111 y 112 (la 113 es la del permiso y la 114 la del Resto).*

1. **La venta por tienda de un GM muestra el año en curso dos veces:** el real hasta `k` (u y S/, comparado con los mismos meses del año anterior) y el cierre vigente (solo u, comparado con el año anterior completo), que es lo que mide `B`.
2. **El vigente por tienda de las mismas tiendas es una atribución informativa:** el resto de la base del GM se reparte en proporción al real ene–`k`, con el mismo criterio que `aporteSaliente`. El subtotal cuadra exacto con `Σ B`, y las tiendas que entran usan su vigente exacto. Descartado: el reparto fila por fila (exige venta fila × tienda, ≈ 90 000 tuplas por GM).
3. **Una función de lectura nueva, `venta_tienda_nodos`, con unidades y soles por tienda × mes, sin CD.** Descartado: reutilizar `venta_proyeccion`, por tamaño y tiempo, y `venta_genero_mundo`, que no trae soles y es de M6.

## Preguntas abiertas (solo Javier)

*(Respondidas por defecto al construir; Javier puede revertirlas. Ver «Cambios respecto a la especificación».)*

1. **¿Soles del cierre vigente 2026 por tienda?** M7 solo proyecta unidades. Se podría mostrar un S/ estimado (vigente u × precio medio ene–sep de esa tienda en el GM), rotulado «estimado». **Recomendación: no en esta entrega. Aplicada: no.** El S/ se queda como referencia del real, y la base es en unidades.
2. **¿«Ver por tienda» también en el Resto?** La ficha lo incluye porque es el mismo contrato y el Resto también tiene base. **Recomendación: sí. Aplicada: sí.** Si prefieres solo las celdas HOMBRE y MUJER, se quita el botón del Resto y el `gm=resto`, sin más cambios.

## Construido y validado (2026-11-04)

**Qué hay.** En la pestaña Crecimientos, cada fila de género × mundo (GM) y la del Resto tiene el botón «Ver por tienda», que abre debajo de la tabla una tarjeta con la venta por tienda y año (unidades y soles netos de IGV, de 2023 a 2026), las tiendas de la base de 2027 aparte de las que quedan fuera y un subtotal de la base que cuadra exacto con `Σ B` de esa celda. No cambia ningún cálculo, no escribe nada y no lee IA.

| Pieza | Archivo |
|---|---|
| Función de lectura (migración `0033`, humo `scripts/humo-0033.sql`, tipos regenerados) | `supabase/migrations/0033_venta_tienda_nodos.sql` |
| Lógica pura: grupos de tiendas, periodos, reparto de la base, variaciones | `src/lib/proyeccion/venta-por-tienda.ts` |
| Servicio y lectura de la función | `src/lib/proyeccion/servicio-venta-por-tienda.ts`, `leerVentaTiendaNodos` en `consultas.ts` |
| Ruta `GET …/crecimientos/por-tienda?gm=` | `src/app/api/proyeccion/proyecciones/[id]/crecimientos/por-tienda/route.ts` |
| Tarjeta, vista pura (filas, textos, motivos, Excel) y botón por fila | `venta-por-tienda.tsx`, `venta-por-tienda-vista.ts` y `crecimientos-tab.tsx` en `src/app/(app)/planificacion/proyeccion/`; el parámetro `por_tienda` vive en `proyeccion-panel.tsx` y `use-proyeccion.ts` |

**Qué se ve.** La cabecera dice «Base 2027 = N u» y cuántas tiendas tiene la base. La tabla trae, por tienda, cada periodo con unidades y soles, y las variaciones de 2024 frente a 2023, 2025 frente a 2024, 2026 ene–sep frente a 2025 ene–sep y el cierre vigente frente a 2025. Una variación que no se puede dar lleva su motivo (`nueva`, `parcial`, `incompleto` o `sin dato`). Un periodo con meses sin publicar lleva en la cabecera «faltan: mes año». Debajo de la tabla hay una leyenda de los motivos. «Descargar Excel» genera `proyeccion-2026-2027-por-tienda.xlsx` con las hojas `POR_TIENDA` y `FILTROS`, en el navegador. La elección se guarda en la URL como `?por_tienda=<clave>`, sobrevive a recargar y se borra al cambiar de pestaña o de proyección.

**Rendimiento medido.** El documento de `venta_tienda_nodos` pesa unos 38 KB (presupuesto: 150 KB). MUJER × URBANO responde en unos 0,7 a 0,9 s; el Resto, en caliente, en 1,3 a 2,1 s. El presupuesto era de 1 s en caliente, así que el Resto lo supera; queda dentro del máximo de 3 s en frío y muy por debajo de los 8 s que corta PostgREST. La palanca prevista, si se vuelve molesto, es bajar `ANIOS_ATRAS_VENTA_TIENDA` de 3 a 2 (un solo número en `venta-por-tienda.ts`; se pierde la columna del año más antiguo). Es un pendiente, no un bloqueo.

**Resultado de QA.**
- Las cuatro verificaciones (`lint`, `tsc`, `vitest`, `build`) en verde.
- Humo de la `0033` en la base: 36 comprobaciones, 0 fallos.
- Fuzz de atribución: 20 000 casos aleatorios de la regla `Σ vigente(base) + sin_atribuir = Σ B`, que se mantuvo exacta en todos.
- Casos borde de §7 en `tests/proyeccion.venta-por-tienda-qa.test.ts` (su único archivo).
- Hallazgos corregidos antes de cerrar: la ruta pasó de `requireUser` a `requirePlanner`; formato de miles `es-PE` y mes «set» uniformes; el botón «Ver por tienda» bajó a la primera columna, bajo el nombre del GM, para que se vea en móvil; la leyenda de motivos se hizo visible; el Excel se hizo legible; con `k = 12` ya no sale la columna «ene–dic» duplicada del año completo.
- **No verificado:** el cuadre con las cifras reales de Vector2 (lo valida Javier con el punto 3 del checklist), la descarga real del Excel en un navegador y la vista de escritorio. Todo lo demás se probó con base falsa y datos sintéticos.

## Cambios respecto a la especificación

1. **Cuatro columnas «Var.».** La lista de columnas de §5 escribía una «Var.» detrás de cada año, incluido 2023, que no tiene año anterior con qué compararse. Lo construido son las cuatro comparaciones de §3.4, cada una pegada al periodo que se compara: 2024 frente a 2023, 2025 frente a 2024, 2026 ene–sep frente a 2025 ene–sep y cierre vigente frente a 2025. «2025 ene–sep» no lleva variación propia y 2023 tampoco.
2. **Formato `es-PE` y mes «set».** Todos los miles salen con coma (`15,600`) y septiembre se abrevia «set», igual en la tabla, los avisos, los títulos y el Excel. La especificación escribía los ejemplos con espacio y «sep».
3. **El botón «Ver por tienda» va en la primera columna**, bajo el nombre del GM, y no junto a «Analizar y aprobar». En móvil «Analizar y aprobar» queda fuera de pantalla en la tabla de Crecimientos (heredado, no de 07f), y el botón nuevo debía verse sin desplazarse.
4. **`ANIOS_ATRAS_VENTA_TIENDA = 3`.** La lectura pide desde enero de `Y − 3` (2023, con `Y = 2026`), como preveía §2.2, y se queda en tres años porque el Resto cabe en el máximo de 3 s en frío. Es una constante exportada para poder bajarla a 2.
5. **Precedencia de `variacionVenta`.** §3.4 enumeraba los motivos sin orden. Lo construido es: `incompleto` primero (si falta un mes publicado ninguna cifra es fiable), después `nueva`, después `sin_dato`, y por último `parcial`. Así una tienda que abrió a mitad de año con un mes sin publicar se rotula `incompleto`, que es el aviso accionable.
6. **`totales.fuera.vigente = null`.** §4 solo fijaba el vigente de `base` (igual a `Σ B`) y el de `conjunto` (`null`). El subtotal «Fuera de la base» tampoco lleva vigente: mezcla aperturas exactas con cierres sin cifra, y sumarlas no significaría nada.
7. **Permiso de la ruta (no es una desviación, pero se registra).** La ficha decía `requirePlanner`; el primer borrador del código usó `requireUser` (por la decisión 99, que deja al comprador ver venta y stock del flujo) y QA lo corrigió. Quedó `requirePlanner`: el comprador no ve Planificación y recibe `403`. Decisión 113.
8. **Soles del cierre vigente: no se muestran** y **«Ver por tienda» también en el Resto:** las dos preguntas abiertas se aplicaron con la recomendación de la ficha. Decisiones 110 y 114.
9. **Con `k = 12` no hay columna «ene–dic» duplicada:** el año en curso completo ya es el real, y se compara con el año anterior completo.
10. **Versión `0.16.1 · M7 d`, no `0.15.0 · M7 b`.** Cuando 07f cerró, la vigente era la `0.16.0 · M8 b` (08b-1), y una versión no puede bajar. Toma el parche de la vigente y el sufijo `· M7 d` por la letra siguiente a `· M7 c` de 07g.

## Pendientes

- **Abrir Planificación al comprador.** Hoy el comprador no ve Planificación y por eso la ruta es solo para planner y admin. Si Javier quiere que los compradores vean la venta por tienda, es un cambio de permiso del módulo entero de Planificación, no de esta ruta (decisión 113). La decisión 99 (el comprador ve venta y stock del flujo) no se extiende a los datos de la proyección.
- **El Resto, en caliente, tarda más de 1 s** (1,3 a 2,1 s). Mirar si molesta con datos reales; la palanca es `ANIOS_ATRAS_VENTA_TIENDA = 2`.
- **`Analizar y aprobar` queda fuera de pantalla en móvil** en la tabla de Crecimientos (a 390 px). Heredado de antes de 07f; el botón de 07f se movió para evitarlo, pero «Analizar y aprobar» sigue pendiente.
- **Sin verificar con cifras reales:** el cuadre con Vector2, la descarga del Excel y el escritorio (los cubre el hito de Javier, sección P).

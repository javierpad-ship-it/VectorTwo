# M12 · Análisis de marcas al barrer por GML y modalidad `mixta` (cambio de M2b)

> Estado: **especificada el 2026-10-15 y ajustada el mismo día con el informe del `arquitecto-revisor` (opus) y la ronda 3 de Javier; pendiente de aprobación por Javier.** Es el módulo de análisis que Javier pidió **antes de M8** (decisiones 3, 4, 8, 9 y 14 de `08-09-definiciones-del-dueno.md`) y lleva además el cambio de M2b que convierte la modalidad excluyente `por_gml` / `barrido` en tres: `por_gml`, `barrido` y **`mixta`**. Migración prevista **`0019_marcas_barrer.sql`** (la `0018` es de M7 y ya está aplicada; se confirma al construir); versión prevista **`0.11.0 · M12`**, después de `0.10.0 · M7`; commits con prefijo `M12:`. Depende de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (modalidad, `marca_gml_especial`, `marcas_unidad`, `claveFlujo`, `curvaUnidad`), [05-venta-stock](05-venta-stock.md) (`venta_stock_vigente`), [06-curvas-estacionalidad](06-curvas-estacionalidad.md) (`claseDeAnio`, curvas vigentes) y [07-proyeccion-anual](07-proyeccion-anual.md) (`factores_volumen_atipico`, `factoresMes`, `participaciones_historicas`; **M7 ya está construido en `0.10.0`**: el cambio que este módulo le pide es mínimo y está enumerado en 6.2). Lo consumen [08-flujo-y-compras](08-flujo-y-compras.md) (reparto vigente de cada marca al barrer o mixta, para los lotes de **una sola marca**) y, por `claveFlujo`, M7. Toda la API es `requirePlanner`. Ningún dato real de Lukers: marcas ALFA, BETA, GAMMA, DELTA; nodos `HOMBRE · URBANO · DENIM`, `HOMBRE · CASUAL · POLO`, `MUJER · CASUAL · SANDALIA`; tiendas `T01…T09`; cifras inventadas. Los únicos agregados reales citados son los que midió el revisor sobre la base (sección 2).

## 1. Objetivo

Las marcas con tratamiento especial **al barrer** se compran por marca, no por GML: el comprador va a la feria y trae "N unidades de BETA" que después se reparten entre varias líneas. M7 ya proyecta la venta de esas marcas **dentro** de la fila GML × agrupación de marca de cada GML, de modo que M8 sabe cuánta demanda de cada GML es "al barrer" pero no sabe **a qué GML** llegará una compra de BETA. Este módulo hace esa estadística para los lotes de **una sola marca** y la deja aprobada: para cada marca al barrer (o mixta), cuánto pesa en la venta de cada GML por mes y año, cómo tiende, si su estacionalidad se parece a la del GML, qué parte se compra al barrer y qué parte con compras específicas, **qué tan estable ha sido su mezcla de GML de un año a otro (el error del reparto)** y el **reparto** de una compra de la marca a los GML (por temporada de llegada, sobre una ventana, normalizado en los meses del Niño, acotable a un alcance de género, mundo o líneas, con los GML pequeños agrupados, comparado con lo que dice la cerrada de M7, ajustable a mano y versionado). M8 reparte cada compra al barrer de una marca con el reparto vigente y nunca recalcula. Los lotes que **mezclan varias marcas** no se reparten con estadística: el comprador escribe los porcentajes por marca y GML en M9 (Javier, ronda 3).

Además cierra el hueco que Javier señaló en M2b: hoy una marca es `por_gml` **o** `barrido`, y los GML asignados a una marca al barrer quedan ignorados. Con la modalidad **`mixta`** una marca tiene GML (o nodos GMLE) con compras específicas, que entran directo al flujo de esos GML, y el resto de su venta va al flujo al barrer con el reparto estadístico.

## 2. Decidido por Javier (2026-10-15) y lo que midió el revisor

1. **Hay que hacer estadística que llegue a nivel de GML** para incorporar las marcas al barrer a los flujos de cada GML; es un módulo de análisis propio (decisión 3).
2. **Hay marcas mixtas**: parte al barrer y parte con compras específicas de un GML o GMLE; la modalidad de M2b debe cubrirlo con una **modalidad `mixta` explícita** (decisiones 4 y 8).
3. **Este módulo va antes de M8** (decisión 9).
4. **Lotes de varias marcas** (ronda 3, decisión 14): el comprador registra los porcentajes que espera recibir por marca y por GML; la estadística de aquí sirve **cuando el lote es de una sola marca**.

**Lo que midió el `arquitecto-revisor` sobre la base real (B1)** y que esta ficha incorpora: el reparto `p2` anual por GML, calculado sobre toda la ventana, **no predice bien dónde vende un lote**: entre un año y el siguiente la mezcla de GML de una marca al barrer se mueve 24 a 40 puntos porcentuales (EAT), salvo en una marca grande; **16 marcas al barrer son ~58 % de las unidades** vendidas, así que el reparto importa; y **casi la mitad de los GML tienen menos de 50 unidades en 24 meses**, por lo que su `p2` es ruido. Respuesta de diseño: alcance opcional, reparto por **temporada de llegada**, GML pequeños agrupados en un "resto", **error del reparto visible** por marca y una columna con el reparto que se deduce de la cerrada de M7.

De fichas anteriores y sin cambio: la unidad de marca es la cabeza del conjunto (`marcas_unidad`); la relevancia es por marca × GML (nivel B); la partición de `claveFlujo` es completa y disjunta; las marcas al barrer quedan fuera de "mi flujo de Jeans" en la vista de 02b pero **dentro** de la fila GML-AM de M7.

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Marca analizada (`B`)** | Una **unidad de marca** marcada, vigente y con modalidad efectiva `barrido` o `mixta`. Las `por_gml` puras no se analizan aquí. |
| **Unidad `g`** | Unidad de planificación de 02b: nodo `GML`, o nodo × equivalencia si el nodo es `GMLE`. El grano del reparto, el mismo que M7 y M8. |
| **Parte al barrer de `B`** | Los hechos de `B` cuya `claveFlujo` es `{ tipo: "barrido" }`. En una `barrido` es toda su venta; en una `mixta`, la venta fuera de sus GML específicos. |
| **Parte específica de `B`** | Solo en `mixta`: los hechos de `B` en los GML donde es relevante, con clave `{ tipo: "unidad", marca_id: B }`. Entran al flujo del GML como una marca relevante más; no se reparten. |
| **Peso de la marca en el GML (`p1`)** | `p1_{B,g,m} = u_{B,g,m} ÷ U_{g,m}`: unidades de `B` en `g` el mes `m` sobre las unidades totales de `g`. Dice cuánto de "mi flujo de Jeans" es BETA. |
| **Alcance (`A`)** | Subconjunto opcional de unidades `g` al que se limita el reparto de la marca: por género, mundo o líneas (p. ej. "BETA solo se compra para hombre"). Es un parámetro del reparto (se guarda en la versión) y también puede acotarse **por lote** en M9 (una línea "este lote es de hombre" renormaliza el reparto vigente sobre ese subconjunto). Vacío = todas las `g` con venta al barrer. |
| **Reparto de la marca a los GML (`p2`)** | `p2_{B,g} = ũ_{B,g} ÷ Σ_{g∈A} ũ_{B,g}` sobre los meses que correspondan, con `ũ` las unidades de la **parte al barrer** normalizadas por el Niño. `Σ_g p2 = 1`. Es lo que M8 usa para los lotes de una marca. |
| **Modo del reparto** | **`por_temporada`** (por defecto; un vector `p2` para los lotes que llegan en **verano** y otro para los que llegan en **invierno**, cada uno calculado sobre los meses de esa temporada dentro de la ventana), `anual` (un solo vector sobre toda la ventana) o `por_mes` (doce vectores; **segunda entrega**). Temporada de un mes: `verano` = octubre a marzo, `invierno` = abril a septiembre (constante `MESES_TEMPORADA`, supuesto a validar; es el calendario con el que M6 marca el Niño de verano de septiembre a diciembre). Una temporada con menos de `MIN_MESES_TEMPORADA = 6` meses en la ventana cae a `anual` con aviso `temporada_corta`. |
| **Ventana (`W`)** | Meses cerrados hasta `k` (último mes publicado y terminado): `12`, `24` o `36` meses. Por defecto **24**. |
| **Normalización del Niño** | Cada mes `m` de la unidad `g` se divide por `φ_{año(m),m}` de M7 (`factoresMes`); 1 fuera de los meses atípicos; falta el factor → 1 y aviso `sin_factor`. |
| **GML pequeño y resto** | Una `g` con menos de `UMBRAL_GML_PEQUENO = 50` unidades al barrer en la ventana (supuesto a validar) no se muestra ni se edita sola: se agrupa en una fila **"Resto de GÉNERO · MUNDO"** con las demás pequeñas de su género × mundo. El planner edita el resto como una sola fila; al aprobar, su participación se reparte entre sus miembros en proporción a sus unidades y **la versión guarda una fila por `g`** (con `grupo_resto`), de modo que M8 no cambia. |
| **Error del reparto (`err`)** | Backtesting: `EAT` (en pp) entre el `p2` calculado con los datos **hasta el fin del año `A−1`** (mismo modo, misma ventana recortada) y la **mezcla real** de la parte al barrer en el año `A`, para el último año completo `A` de la ventana y, si cabe, el anterior. Dice cuánto se habría equivocado el reparto si se hubiera usado para comprar el año pasado. Veredicto: `estable` si `err ≤ 10`, `inestable` si `> 25`, `dudoso` entre medias (umbrales a validar). Se muestra en la lista y en el bloque 1, se guarda en la versión y M9 lo enseña al lado del reparto de cada línea. |
| **`p2` según la cerrada** | La mezcla que **M7 ya proyecta** para la marca: `p2^cerrada_{B,g} = Σ_m D^b_{B,g,m} ÷ Σ_g Σ_m D^b_{B,g,m}` con `D^b_{B,g,m} = D_{g,a_B,m} × part_{barrido B,g}` sobre los doce meses siguientes a `k` (o los meses de la temporada, en `por_temporada`). Es un **candidato** de reparto (`fuente = 'cerrada'`): ya lleva el crecimiento por GML y la curva de cada línea; sin cerrada no existe. Se muestra al lado del histórico y el planner puede aprobar cualquiera de los dos (supuesto a validar; por defecto `historico`). |
| **Estacionalidad propia de `B`**, **estacionalidad del GML para `B`**, **tendencia** | Como en la primera versión: doce valores propios sobre los años completos; `c^{GML} = Σ_g p2 × curvaUnidad(g)`; `EAT`; tendencia `A₂ ÷ A₁ − 1`. Informativos. |
| **Reparto aprobado (vigente)** | Foto de `p2` por `g` (y por temporada) calculado y, si el planner lo cambió, ajustado; con ventana, modo, alcance, fuente, huellas, error, versión y quién. **Una vigente por marca**, versionada. Contrato con M8. |
| **Obsoleto** | El reparto vigente difiere de lo que se calcularía hoy **más allá de un umbral**: `config_cambiada` (modalidad, GML, conjunto, nivel, alcance) siempre; `cargas_nuevas` solo si algún `p2` se mueve más de `UMBRAL_OBSOLETO_PP = 5` puntos (si se mueve menos, la lista dice "al día (difiere 1,2 pp)"). Se avisa con motivo; no se recalcula solo. |

### Por qué el reparto se guarda y se aprueba, en vez de calcularse al vuelo en M8

M8 reparte compras que el comprador ya confirmó: si `p2` cambiara con cada mes publicado, una compra de 1 000 BETA cambiaría de GML sin que nadie lo decida. Con un reparto aprobado y versionado, M8 guarda qué versión usó en cada línea, avisa "el reparto cambió" y el planner aplica la nueva cuando quiere (una línea, una compra o todas las de la marca). El cálculo sigue siendo **a demanda y no se guarda** (criterio 06b); solo se guarda la foto de cada aprobación.

## 4. Flujo de pantalla (UX primero)

Ruta **`/planificacion/marcas-barrer`**, item "Marcas al barrer por GML" en Planificación de `nav.ts` (`PLANIFICACION`; el comprador no lo ve y `page.tsx` lo redirige). Kit: `Card`, `DataTable`, `Chips`, `Select`, `Switch`, `Badge`, `Alert`, `EmptyState`, `Modal`, `mini-curva` de M6. Hook propio `use-marcas-barrer.ts` (patrón `use-estacionalidad.ts`). Formato `es-PE`. La marca abierta, la ventana, el modo y el alcance van en la URL (`?marca=<id>&ventana=24&modo=por_temporada&genero=&mundo=&lineas=`).

**Paso 0 · Lista.** Una fila por marca analizada, en orden de unidades de la ventana (la lista sale de la función **resumen**, no de los hechos: I7):

```
Marcas al barrer por GML · datos hasta 2026-09 · ventana [24 meses ▾] · modo [por temporada ▾]      [Recargar]   [Excel]
Filtros: [Modalidad: todas ▾] [Agrup. marca ▾] [Género ▾] [Mundo ▾] [Línea ▾]  Solo: (sin reparto) (obsoletas) (mixtas) (inestables)
Marca     Modalidad  Agrup.      Unid. 24 m  Al barrer  Específica  GML con venta (pequeños)  Error reparto  Reparto vigente        Estado
BETA      Al barrer  PREMIUM        12 480     100 %         —            14 (6)               8 pp estable   v2 · 2026-09-30       Al día (difiere 1,2 pp)
GAMMA     Mixta      RECONOCIDO      8 310      61 %       39 %            9 (4) +2 específicos 31 pp inestable v1 · 2026-08-12     Obsoleto: config. cambiada
DELTA     Al barrer  VALOR           1 020     100 %         —             6 (5)               — (1 año)      —                     Sin reparto
3 marcas · 21 810 unidades al barrer en 24 meses · 1 sin reparto · 1 obsoleta · 1 inestable
```

*Decide*: qué marca abrir primero (las sin reparto bloquean a M8 para los lotes de esa marca: sus líneas quedan con aviso `sin_reparto`; las inestables conviene acotarlas con un alcance o comprarlas con porcentajes del comprador).

**Paso 1 · Abrir una marca (`?marca=`).** Cabecera: marca, miembros del conjunto, modalidad (con `Select`: Por GML · Al barrer · Mixta, `PATCH /api/marcas/[id]`, con `confirm`), agrupación, GML específicos si es mixta, **alcance** (chips de género, mundo y líneas; vacío = todo), ventana, modo. Cuatro bloques:

```
BETA · Al barrer · PREMIUM · conjunto: BETA UNO, BETA DOS · ventana oct-2024 → set-2026 (24 m) · por temporada · alcance: HOMBRE · Niño: inv 2026 ÷ 0,66 · ver 2026 set ÷ 1,24
┌ 1. Dónde vende BETA (reparto p2, parte al barrer, normalizada) · temporada: (Verano) (Invierno) · error del reparto 2025→2026: 8 pp (estable) ───────────────┐
│ GML / unidad                        Unid. 24 m  p2 hist.  p2 cerrada  p2 ajust.   p1 (peso en el GML)  Tendencia   2024  2025  2026 (a set)                 │
│ HOMBRE · URBANO · DENIM                 5 120    41,0 %     43,5 %    [ 41,0 ]     8,2 %                +6 %        2 310  2 480  1 890                       │
│ HOMBRE · CASUAL · POLO                  3 740    30,0 %     27,0 %    [ 30,0 ]    12,5 %                −3 %        1 900  1 840  1 410                       │
│ HOMBRE · URBANO · DENIM › SLIM (GMLE)   1 500    12,0 %     12,5 %    [ 12,0 ]     9,9 %                +2 %          700    740    520                       │
│ HOMBRE · FORMAL · CAMISA                  980     7,9 %      8,0 %    [  7,9 ]     3,1 %                +9 %          400    430    350                       │
│ Resto de HOMBRE · CASUAL (6 GML < 50 u)    290     2,3 %      2,2 %    [  2,3 ]     —                    —              ▸ ver los 6                           │
│ Resto de HOMBRE · URBANO (3 GML < 50 u)    120     1,0 %      0,9 %    [  1,0 ]     —                    —              ▸ ver los 3                           │
│ Suma                                   11 750   100,0 %    100,0 %     100,0 %   (fuera del alcance: MUJER · CASUAL · SANDALIA 730 u, no se reparte)         │
│ Fuente a aprobar: (Histórico) (Cerrada)   [Renormalizar el resto] [Volver a lo calculado]   Nota [__________]   [Aprobar este reparto como v3]               │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ 2. Peso de BETA en cada GML por mes y año (p1) ─── [Tabla ▾ | Gráfico] [GML: DENIM ▾] ───┐   (sin hoja Excel en la primera entrega)
┌ 3. Estacionalidad propia frente a la del GML ─── EAT 4,8 pp · similar (informativo) ─────┐
┌ 4. Qué parte se compra al barrer ─── BETA: 100 % al barrer; GAMMA: 61 % al barrer, 39 % específica en CAMISA y TERNO (no se reparte) ─┐
Versiones: v2 (2026-09-30, 24 m, por temporada, histórico, alcance HOMBRE, error 8 pp, Javier: "sin ajuste") · v1 (2026-07-02, 12 m, anual) · [Comparar v2 con lo calculado hoy]
```

Reglas de la pantalla: las celdas `p2 ajust.` se editan en línea por temporada (porcentaje con un decimal); al editar una, la suma deja de ser 100 y **Aprobar** se deshabilita hasta **Renormalizar el resto** (escala proporcionalmente las no editadas) o corregir a mano; una fila de resto se edita como una; una `g` con `p2 = 0` solo aparece si el planner la agrega con "Agregar GML" (segunda entrega). La nota es obligatoria si algún ajuste difiere del calculado, si la ventana no es la por defecto, si la fuente es `cerrada` o si hay alcance (criterio 06b). *Decide*: ventana, modo, alcance, fuente, ajustes y aprobar.

**Paso 2 · Cambiar la modalidad a `mixta`.** Desde la cabecera o desde Marcas (M2): `Select` Por GML · Al barrer · Mixta. Al elegir Mixta en una `barrido` con GML asignados e ignorados, el `confirm` enumera esos GML y avisa que el reparto vigente quedará obsoleto (`config_cambiada`). Al elegir Mixta en una `por_gml`: "su venta fuera de sus GML dejará de contar como 'otras' y pasará al flujo al barrer; M7 marcará desactualizadas las proyecciones en trabajo". Sin GML asignados, Mixta se guarda y la marca queda **pendiente** (`mixta_sin_gml`). **Al asignar el primer GML a una marca al barrer** (desde Marcas relevantes por GML, Por marca, Por GML, en bloque o por importador), la pantalla pregunta **"¿Por GML o Mixta?"** antes de escribir (I3): hoy `cambioMarca` la pasa a `por_gml` sin preguntar y su resto iría a "otras". La API lo exige con `modalidad_destino` (sección 7). *Decide*: la modalidad.

**Paso 3 · Excel.** SheetJS bajo demanda en el navegador (patrón M11): hoja `RESUMEN` (la lista con los filtros, con error del reparto), hoja `REPARTO` (marca × temporada × GML × `p2` histórico, cerrada, ajustado, vigente, versión, grupo resto), hoja `ESTACIONALIDAD`, hoja `FILTROS`. La hoja `PESO_MENSUAL` va a la segunda entrega.

**Pestaña en Marcas (M2).** La pestaña "Marcas relevantes por GML" gana el estado `mixta` en chips y resúmenes (`marcadas · por_gml · barrido · mixta · pendientes`); el `Select` de modalidad ofrece el tercer valor; la asignación del primer GML a una `barrido` pregunta la modalidad destino.

### Qué decide el planner y qué decide el sistema

| Decisión | Quién |
|---|---|
| Modalidad de la marca (por GML, al barrer, mixta) y sus GML específicos | planner (M2 / 02b, con atajo aquí) |
| Ventana, modo, alcance, fuente y normalización del Niño | planner (parámetros por marca; por defecto 24 m, por temporada, sin alcance, histórico, con Niño) |
| `p2` histórico y según la cerrada, `p1`, estacionalidad, tendencia, error del reparto, resto, avisos | sistema, a demanda, nunca se guarda |
| `p2` ajustado por GML y la aprobación (versión nueva) | planner, una marca a la vez; nada en bloque |
| Cuándo un reparto está obsoleto (umbral) | sistema (huellas y diferencia en pp) |
| Qué versión usa cada línea; aplicar la nueva a una línea, una compra o toda la marca | M8/M9 (planner) |

## 5. Método (lógica pura en `src/lib/marcas-barrer/`, TypeScript sin I/O)

Notación: marca `B`; unidad `g`; mes `m`; ventana `W` de `n ∈ {12, 24, 36}` meses cerrados hasta `k`; `u_{B,g,m}` unidades de la **parte al barrer**; `e_{B,g,m}` parte específica (solo mixta); `U_{g,m}` unidades totales de `g`; `φ_{g,m}` factor del Niño; `ũ = u ÷ φ`; alcance `A` (conjunto de `g`); temporada `T(m) ∈ {verano, invierno}`. Universo: tiendas de tipo Tienda (sin el CD), cargas publicadas. Redondeo solo al presentar.

1. **Clasificación.** Cada hecho (ya agregado por unidad de marca × `g` × periodo por la función SQL, sin talla) pasa por `claveFlujo` con la configuración vigente (02b + mixta): va a `u`, a `e` o a "resto del GML" (solo alimenta `U`).
2. **Peso `p1`.** `p1_{B,g,m} = (u + e)_{B,g,m} ÷ U_{g,m}`; anual y de la ventana por cociente de sumas; `U = 0` → `null`.
3. **Alcance.** `G_A = { g : u_{B,g} > 0 en W y g ∈ A }`; lo que queda fuera se muestra ("fuera del alcance: … no se reparte") y no entra en el denominador.
4. **Reparto `p2` por temporada (defecto).** Para `T ∈ {verano, invierno}`: `p2_{B,g,T} = Σ_{m∈W, T(m)=T} ũ_{B,g,m} ÷ Σ_{g∈G_A} Σ_{m∈W, T(m)=T} ũ_{B,g,m}`; menos de `MIN_MESES_TEMPORADA` meses de `T` en `W` → `anual` con `temporada_corta`; `anual`: lo mismo sobre todo `W`. `Σ_g p2 = 1`; sin venta al barrer en `W` → `null` y `sin_venta_barrer`. Un GML específico de una mixta tiene `u = 0` y `p2 = 0`.
5. **Resto.** `pequeña(g)` ⇔ `Σ_W u_{B,g} < UMBRAL_GML_PEQUENO`; las pequeñas se agrupan por `(género, mundo)` en una fila `resto` con `p2 = Σ` de sus miembros; al aprobar, `p2_vigente` del resto se reparte entre sus miembros en proporción a `Σ ũ` (`repartirProporcional`, suma exacta); la versión guarda una fila por `g` con `grupo_resto = 'genero|mundo'`.
6. **Error del reparto.** Para el último año completo `A` de `W` (y el anterior si cabe): `p2^{(A−1)}` = regla 4 sobre la ventana recortada a `≤ dic(A−1)` (mismo `n`, mismo modo, mismo alcance); `mix_A` = mezcla real de `ũ` en `A` (por temporada si el modo lo es); `err_A = EAT(p2^{(A−1)}, mix_A)` en pp; `err` = promedio de los años disponibles; menos de un año completo con datos previos → `null` y aviso `sin_backtesting`. Veredicto con `ERR_ESTABLE = 10`, `ERR_INESTABLE = 25`.
7. **`p2` según la cerrada.** Con la cerrada vigente de M7 (`leerProyeccionCerrada`): `D^b_{B,g,m} = D_{g,a_B,m} × part_{barrido B,g}` para `m = k+1 … k+12` (o los meses de la temporada `T` dentro de ese rango), `p2^cerrada_{B,g,T} = Σ_m D^b ÷ Σ_{g∈G_A} Σ_m D^b`; sin cerrada o sin participación de `B` → `null` y aviso `sin_cerrada`.
8. **Estacionalidad y tendencia.** Como en la primera versión (propia sobre años completos; `c^{GML} = Σ_g p2 × curvaUnidad(g)`; `EAT`; tendencia `A₂ ÷ A₁ − 1`).
9. **Parte al barrer.** `share_barrido = Σ u ÷ (Σ u + Σ e)`; `barrido` → 1; mixta sin GML vigentes → 1 con `mixta_sin_gml`.
10. **Ajuste y aprobación.** `ajustado_{g,T} ∈ [0, 100]` con un decimal; `renormalizarResto(filas, editadas)` por temporada; `puedeAprobar` ⇔ cada vector suma 100,0 ± 0,05, ≥ 1 fila con `ajustado > 0` y nota si hay ajuste, ventana no por defecto, fuente `cerrada` o alcance. La versión guarda `calculado` (de la fuente elegida), `ajustado` y `vigente = ajustado ?? calculado` por fila y temporada.
11. **Huellas y obsolescencia.** `huella_cargas` = ids de las cargas publicadas de `W`; `huella_config` = hash de (modalidad efectiva de `B`, GML vigentes de `B`, miembros del conjunto, nivel de cada `g` con venta, ventana, modo, alcance, fuente, `VERSION_METODO_BARRER`). Motivos: `config_cambiada`, `nivel_cambiado`, `ventana_distinta` siempre; `cargas_nuevas` solo si `max_{g,T} |p2_vigente − p2_calculado_hoy| > UMBRAL_OBSOLETO_PP`; si no, `al_dia` con `diferencia_pp` informativa.

Todo determinista: `analizarMarca(entrada)` recibe hechos ya clasificados, curvas, factores, la cerrada (opcional) y `k`; no lee el reloj.

## 6. Modelo de datos (`0019_marcas_barrer.sql`)

Idempotente: `add column if not exists` con constraints inline, `create table if not exists`, `create or replace view`, `create or replace function`, `create index if not exists`, `create or replace trigger`; **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`**, sin bloques `do $$`, sin backfill. Tablas nuevas con `id uuid`, `activo`, `created_at`, `updated_at`, RLS activo sin políticas, `revoke`/`grant` por objeto. **Criterio I9**: la base solo lleva invariantes estructurales (no negativos, primer día de mes, rangos 0–1 de una participación, mes 1–12); los catálogos (`modo`, `fuente`, `ventana_meses`) los valida zod, para poder ampliarlos sin `DROP`.

### 6.1 Modalidad `mixta` sin tocar el check de `0010`

El check `marcas_modalidad_valor_check` admite solo `por_gml` y `barrido` y no se puede ampliar sin `drop constraint`. La `mixta` se representa con **una columna nueva que se combina con la existente**:

| Columna nueva en `marcas` | Tipo | Notas |
|---|---|---|
| `resto_al_barrer` | `boolean not null default false` | `add column if not exists … constraint marcas_resto_al_barrer_check check (not resto_al_barrer or modalidad_tratamiento = 'por_gml')`. **`mixta` ⇔ `modalidad_tratamiento = 'por_gml' and resto_al_barrer`.** El `default false` deja todas las marcas como estaban. |

Lectura: `modalidadEfectiva(marca)` devuelve `null`, `por_gml`, `barrido` o **`mixta`**. Escritura: `modalidad_tratamiento: 'mixta'` en zod se normaliza a `{ modalidad_tratamiento: 'por_gml', resto_al_barrer: true }`; cualquier otra modalidad escribe `resto_al_barrer = false`. **Alternativa descartada**: `drop constraint` a mano en el SQL Editor (dejaría una migración que no reproduce la base).

**Archivos que leen `modalidad_tratamiento` hoy y que la construcción debe refactorizar (I3)** para que todo pase por `modalidadEfectiva` y por un campo `modalidad_efectiva` en los tipos de la API:

| Archivo | Qué toca |
|---|---|
| `src/lib/marcas/reglas.ts` | `MODALIDADES` gana `'mixta'` en el esquema de entrada (no en el valor de la columna); `modalidadEfectiva` lee `resto_al_barrer`; `normalizarModalidad` nueva; `aplicarCambioTratamiento` escribe el par |
| `src/lib/marcas/filas.ts:25` (`modalidadDe`) y `src/lib/marcas/tipos-api.ts` | la fila de la API lleva `modalidad_efectiva: 'por_gml' \| 'barrido' \| 'mixta' \| null` además de la columna cruda |
| `src/lib/marcas/gml/flujo.ts:65` | `construirConfigFlujo` arma `relevantes` solo con `u.modalidad === 'por_gml'`: debe incluir `'mixta'`; `claveFlujo` gana la fila de la mixta (6.2) |
| `src/lib/marcas/gml/vista.ts` (líneas 188, 218–219, 287–331, 364, 395) | `unidadesFlujoEspecial` produce dos filas por mixta; el resumen cuenta `mixta`; el tipo `modalidad` admite el tercer valor |
| `src/lib/marcas/gml/reglas.ts` (`cambioMarca` 49–53, `motivoRechazoAsignacion` 137, `motivoPendiente` 157–158) | `cambioMarca` de una `barrido` devuelve `{ de: 'barrido', a: 'por_gml' \| 'mixta' }` según `modalidad_destino`; `marca_en_barrido` deja de rechazar cuando el destino es `mixta`; `motivoPendiente` suma `mixta_sin_gml` |
| `src/lib/marcas/gml/asignar.ts`, `src/lib/marcas/gml/importar.ts`, `src/lib/marcas/gml/esquemas.ts` | `modalidad_destino` obligatorio al asignar a una `barrido` (`409 modalidad_destino_requerida`); el importador de GML lo pide como columna opcional `MODALIDAD` (`POR_GML` / `MIXTA`; sin ella, omisión `modalidad_destino_requerida` para marcas al barrer) |
| `src/lib/marcas/esquemas.ts`, `src/lib/marcas/importar.ts`, `src/lib/marcas/consultas.ts` | zod con `mixta`; el importador de marcas acepta `MIXTA` en `TRATAMIENTO_ESPECIAL`; `select` de `resto_al_barrer` |
| `src/lib/marcas/conjuntos/vista.ts`, `src/lib/marcas/conjuntos/reglas.ts` | la modalidad de la cabeza que "manda" es la efectiva |
| `src/components/marcas/comunes-m2b.ts` (`ETIQUETA_MODALIDAD`, `estadoMarca` 75–76, `resumen` 98–103, `cambioMarcaDe` 111–121) | etiqueta "Mixta"; estados y conteos; el diálogo "¿Por GML o Mixta?" |
| `src/app/(app)/maestros/marcas/marcas-tabla.tsx`, `gml-por-marca.tsx`, `conjunto-detalle.tsx` | `Select` con tres valores; leen `modalidad_efectiva`, no la columna |
| `src/app/api/marcas/route.ts`, `[id]/route.ts`, `importar/route.ts`, `gml-especial/route.ts` | normalización al escribir; `modalidad_destino` |

**Prueba estática que reemplaza a la prometida en la primera versión** ("ningún archivo compara `modalidad_tratamiento` con un literal fuera de `reglas.ts`", irrealizable porque `database.types.ts`, `esquemas.ts` y `consultas.ts` deben nombrarla): **ningún archivo bajo `src/components/` ni `src/app/(app)/` nombra `modalidad_tratamiento`** (todos leen `modalidad_efectiva`), y bajo `src/lib/` solo lo hacen `marcas/reglas.ts`, `marcas/filas.ts`, `marcas/esquemas.ts`, `marcas/consultas.ts`, `marcas/importar.ts` y `supabase/database.types.ts`.

**Qué pasa con las asignaciones existentes.** Nada se borra ni se mueve: una `barrido` con GML ignorados que pasa a mixta ve esas asignaciones **vigentes**; una mixta que vuelve a `barrido` las conserva ignoradas (la API pone `resto_al_barrer = false` en la misma escritura).

### 6.2 Cambio en `claveFlujo`, en la vista y en M7 (código, más una columna)

`claveFlujo` gana una fila: **unidad marcada y vigente, `mixta`, no relevante en este GML → `{ tipo: "barrido", marca_id }`**; relevante aquí → fila de la marca. La vista `marca_gml_especial_vigente` se reemplaza con `create or replace view` (mismas columnas) para que una mixta aparezca **dos veces** (una fila con GML nulo y una por GML vigente). `GET /api/marcas/gml-especial/vigentes` suma `mixtas[]`.

**Efecto en M7 (ya construido; cambio mínimo, I2).** Las participaciones de las filas base pasan a tener, para una mixta, una clave `barrido` con su `marca_id`. Hoy `motivosDesactualizada` (`src/lib/proyeccion/desactualizado.ts`) no tiene con qué comparar un cambio de configuración de 02b. Cambio: columna **`proyecciones.huella_flujo text null`** (`add column if not exists`, en la `0019`; recomendación del revisor; la alternativa sin migración es una clave en `resumen`), que `calcular` escribe con `hash(ConfigFlujo serializada + VERSION_METODO_BARRER)` donde hoy escribe `huella_cargas` (`src/lib/proyeccion/calculo.ts`, ~línea 868); `contexto.ts` calcula la huella actual con `construirConfigFlujo` (ya la construye en la línea 206); `desactualizado.ts` compara y añade el motivo **`config_cambiada`** ("cambió la configuración de marcas relevantes, modalidades o conjuntos después de calcular"); `tipos-api.ts` suma el código a `Motivo`. Una cerrada no se toca; una en trabajo con huella vieja (o nula, las calculadas antes de este cambio) queda `desactualizada`. Por eso **este cambio debe estar construido antes de la primera proyección cerrada que lea M8**.

### 6.3 `repartos_marca_barrido` (una versión por aprobación; la vigente es el contrato con M8)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `marca_id` | `uuid not null → marcas on delete restrict` | la **unidad**; la API rechaza un miembro (`409 marca_en_conjunto`) y una marca que no sea `barrido` ni `mixta` (`409 modalidad_no_barrer`) |
| `version` | `integer not null` | único `(marca_id, version)`; `check (version > 0)`; la API asigna `max + 1` |
| `vigente` | `boolean not null default true` | **único parcial `(marca_id) where vigente`**; aprobar una nueva pone la anterior en `false` |
| `ventana_meses` | `integer not null` | `check (ventana_meses > 0)`; los valores admitidos (12, 24, 36) los valida zod |
| `modo` | `text not null` | `anual`, `por_temporada` o `por_mes`; catálogo en zod, **sin check** |
| `fuente` | `text not null default 'historico'` | `historico` o `cerrada`; catálogo en zod |
| `alcance` | `jsonb not null default '{}'` | `{ generos?: uuid[], mundos?: uuid[], lineas?: uuid[] }`; vacío = todo |
| `hasta_periodo` | `date not null` | el `k`; `check` primer día de mes |
| `normaliza_nino` | `boolean not null default true` | |
| `huella_cargas`, `huella_config` | `text not null` | regla 11 |
| `factores_usados` | `jsonb not null default '[]'` | `[{ anio, temporada, ratio }]` |
| `share_barrido` | `numeric(6,4) null` | `check between 0 and 1` |
| `eat_pp`, `error_reparto_pp` | `numeric(6,2) null` | `check >= 0`; informativos (reglas 8 y 6) |
| `nota` | `text null` | `≤ 300` |
| `aprobada_por_id → perfiles set null`, `aprobada_por_nombre`, `aprobada_at` | | |
| `activo`, `created_at`, `updated_at` | | |

Índice `(marca_id, vigente)`.

### 6.4 `reparto_marca_barrido_gml` (las filas de cada versión)

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `reparto_id → repartos_marca_barrido on delete cascade` | | índice por `reparto_id` |
| `genero_mundo_linea_id` | `uuid not null → genero_mundo_linea restrict` | |
| `equivalencia_id` | `uuid null → equivalencias restrict` | no nulo solo si el nodo era `GMLE` al aprobar |
| `temporada` | `text null` | `verano` / `invierno` en modo `por_temporada`; `null` en `anual`; catálogo en zod |
| `mes` | `integer null` | `check between 1 and 12`; solo en `por_mes` (segunda entrega) |
| `grupo_resto` | `text null` | `'genero_id|mundo_id'` si la fila venía de una fila de resto; informativo |
| `unidades_ventana` | `integer not null default 0` | `check >= 0` |
| `participacion_calculada` | `numeric(7,4) not null` | `check between 0 and 1` |
| `participacion_ajustada` | `numeric(7,4) null` | `check between 0 and 1`; `null` = sin ajuste |
| `participacion_vigente` | `numeric(7,4) not null` | `check between 0 and 1`; `= coalesce(ajustada, calculada)`; la suma por `(reparto_id, temporada, mes)` = 1 ± 0,0005 la verifica la API |
| `activo`, `created_at`, `updated_at` | | |

Único `(reparto_id, genero_mundo_linea_id, coalesce(equivalencia_id, uuid cero), coalesce(temporada, ''), coalesce(mes, 0))` (índice único de expresión).

### 6.5 Funciones `venta_marca_gml` y `venta_marca_gml_resumen` (I7)

El revisor midió que agregar por unidad × equivalencia × talla × periodo da **~90 289 hechos** en 36 meses para las marcas al barrer: demasiado para una llamada. Se agrega **en SQL** al grano que el análisis usa, **sin talla**, y con la equivalencia **solo en nodos GMLE** (hoy 0 nodos GMLE: el grano real es unidad × nodo × periodo).

- `venta_marca_gml(p_marca_ids uuid[], p_desde date, p_hasta date) returns jsonb`: hechos de las unidades pedidas (`unidad_marca_id`, `gml_id`, `equivalencia_id` (nula si el nodo es GML), `periodo`, `unidades`) y totales `U` de las mismas `g` (todas las marcas), **solo tiendas de tipo Tienda**, cargas publicadas, `marcas_unidad` para sumar miembros en la cabeza; más `cargas` (huella). Tamaño: ~1/6 de la cifra medida.
- `venta_marca_gml_resumen(p_desde date, p_hasta date) returns jsonb`: **para la lista**, una fila por unidad de marca marcada (`barrido` o `mixta`): unidades totales en la ventana, número de `g` con venta, número de `g` pequeñas (`< UMBRAL_GML_PEQUENO`, que recibe como parámetro), y la clasificación al barrer / específica la hace TS sobre un segundo agregado por `g` (unidad × `g` × total de la ventana, sin periodo). La lista no lee hechos por mes; el error del reparto de la lista sale de la última versión aprobada (`error_reparto_pp`) o de un cálculo diferido por marca al abrirla.

Ambas `security invoker`, `stable`, `search_path` vacío; `revoke` a `anon`/`authenticated`. Sin escritura.

### Diagrama

```
marcas (tratamiento_especial, modalidad_tratamiento, resto_al_barrer) ─► modalidadEfectiva: por_gml | barrido | mixta ─┐
marca_gml_especial (GML específicos; vigentes también en mixta) ────────────────────────────────────────────────────────┤
marcas_unidad (cabeza del conjunto) ────────────────────────────────────────────────────────────────────────────────────┼─► claveFlujo (02b + mixta) ─► M7 (huella_flujo → config_cambiada)
venta_stock_vigente ─► venta_marca_gml(unidades, W) / venta_marca_gml_resumen ─► hechos sin talla + totales ──────────┘        │
factores_volumen_atipico + periodos_atipicos ─► factoresMes (M7) ─► ũ = u ÷ φ ─────────────────────────────────────────────────┤
curvas vigentes (M6) + curvaUnidad (02b) ─► estacionalidad del GML para la marca ──────────────────────────────────────────────┤
proyección cerrada (M7): D^b = D × part_barrido ─► p2 según la cerrada ────────────────────────────────────────────────────────┤
                                                      analizarMarca (TS puro, a demanda) ◄────────────────────────────────────┘
                                                        │ p1, p2 por temporada (histórico y cerrada), alcance, resto, error del reparto, estacionalidad, tendencia, avisos
                                           planner ajusta y aprueba ─► repartos_marca_barrido (vigente, versión) + reparto_marca_barrido_gml ─► M8/M9 (lotes de una marca)
```

## 7. Contratos de API y de lógica pura

Convenciones de M1 a M7. Handlers en `src/app/api/marcas-barrer/`; lógica pura en `src/lib/marcas-barrer/` (`tipos-api.ts`, `tipos.ts`, `esquemas.ts`, `clasificar.ts`, `reparto.ts`, `resto.ts`, `error.ts`, `cerrada.ts`, `estacionalidad.ts`, `tendencia.ts`, `huellas.ts`, `reglas.ts`, `excel.ts`, `modelo.ts`); datos solo en `consultas.ts` (único archivo que nombra las dos funciones SQL). **Toda ruta `requirePlanner`; ningún `GET` escribe.**

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/marcas-barrer` | GET | `?ventana=24` | `{ datos: { hasta_periodo, ventana, cargas: n }, marcas: MarcaBarrerResumenApi[], resumen: { marcas, sin_reparto, obsoletas, mixtas, inestables, unidades_barrer } }` (desde `venta_marca_gml_resumen`; cache en memoria por huella) |
| `/api/marcas-barrer/[marcaId]` | GET | `?ventana=&modo=por_temporada\|anual&normaliza_nino=1&genero=&mundo=&lineas=` | `AnalisisMarcaApi`; `404`; `409 modalidad_no_barrer` |
| `/api/marcas-barrer/[marcaId]/repartos` | GET | — | `RepartoApi[]` (todas las versiones, con filas) |
| `/api/marcas-barrer/[marcaId]/repartos` | POST | `aprobarRepartoSchema = { ventana_meses: 12\|24\|36, modo: 'anual'\|'por_temporada', fuente: 'historico'\|'cerrada', alcance: { generos?, mundos?, lineas? }, normaliza_nino: boolean, huella: string, filas: [{ genero_mundo_linea_id, equivalencia_id?, temporada?: 'verano'\|'invierno'\|null, participacion_ajustada: 0..1 \| null }], nota?: ≤ 300 }` (las filas de resto llegan expandidas por `g`: la pantalla expande antes de enviar) | `201 RepartoApi`; `409 huella_cambiada`, `409 suma_invalida`, `409 nota_requerida`, `409 modalidad_no_barrer`, `409 marca_en_conjunto`, `409 sin_cerrada` (fuente `cerrada` sin cerrada) |
| `/api/marcas-barrer/vigentes` | GET | `?marca_ids=` | **Contrato de M8/M9**: `{ repartos: [{ marca_id, reparto_id, version, modo, alcance, error_reparto_pp, filas: [{ gml_id, equivalencia_id, temporada, participacion }] }], sin_reparto: uuid[] }`. En código, `leerRepartosVigentes(db, marcaIds)`; **M8 lo incluye en su propia respuesta** (`GET /api/flujo`) porque el comprador no puede llamar aquí (I8) |
| `/api/marcas/[id]` (M2, PATCH) | ampliado | `modalidad_tratamiento: z.enum(['por_gml','barrido','mixta'])` | normaliza al par; respuesta con `modalidad_efectiva` y `avisos` |
| `/api/marcas/gml-especial` y `…/asignar`, `…/importar` (02b) | ampliados | `modalidad_destino?: 'por_gml'\|'mixta'` (obligatorio si la marca es `barrido`) | `409 modalidad_destino_requerida` |
| `/api/marcas/gml-especial/vigentes` (02b) | ampliado | — | suma `mixtas: [...]` |

```ts
export type ModalidadEfectiva = "por_gml" | "barrido" | "mixta";
export type ModoReparto = "anual" | "por_temporada" | "por_mes";
export type Temporada = "verano" | "invierno";
export type AvisoBarrer = "sin_venta_barrer" | "temporada_corta" | "sin_anio_completo" | "sin_backtesting" | "sin_cerrada" | "curva_incompleta" | "sin_factor" | "red_no_comparable" | "mixta_sin_gml" | "nivel_cambiado" | "sin_reparto";
export type MotivoObsoleto = "cargas_nuevas" | "config_cambiada" | "nivel_cambiado" | "ventana_distinta";
export type FilaRepartoApi = { gml_id: string; equivalencia_id: string | null; ruta: string; nivel: "GML" | "GMLE"; unidades_ventana: number; pequena: boolean; grupo_resto: string | null; en_alcance: boolean;
  p1_ventana: number | null; p1_anual: { anio: number; valor: number | null; completo: boolean }[]; p1_mensual: { anio: number; meses: (number | null)[] }[]; tendencia: number | null;
  p2: { temporada: Temporada | null; historico: number; cerrada: number | null; vigente: number | null; ajustado_vigente: number | null }[]; es_especifico: boolean };
export type FilaRestoApi = { grupo_resto: string; etiqueta: string; miembros: string[]; unidades_ventana: number; p2: { temporada: Temporada | null; historico: number; cerrada: number | null; vigente: number | null }[] };
export type AnalisisMarcaApi = { marca: { id: string; nombre: string; modalidad: ModalidadEfectiva; agrupacion_marca: string; miembros: string[]; gml_especificos: { gml_id: string; ruta: string }[] };
  parametros: { ventana_meses: 12 | 24 | 36; modo: ModoReparto; modo_efectivo: ModoReparto; fuente_disponible: ("historico" | "cerrada")[]; alcance: { generos: string[]; mundos: string[]; lineas: string[] }; normaliza_nino: boolean; hasta_periodo: string; desde_periodo: string; factores: { anio: number; temporada: string; ratio: number | null }[] };
  filas: FilaRepartoApi[]; restos: FilaRestoApi[]; fuera_de_alcance: { ruta: string; unidades: number }[]; share_barrido: number; unidades_barrer: number; unidades_especificas: number;
  error_reparto: { pp: number | null; veredicto: "estable" | "dudoso" | "inestable" | null; anios: { anio: number; pp: number }[] };
  estacionalidad: { propia: number[] | null; gml: number[] | null; eat_pp: number | null; veredicto: "similar" | "dudosa" | "distinta" | null; anios_completos: number[] };
  tendencia_total: number | null; vigente: { reparto_id: string; version: number; modo: ModoReparto; fuente: string; aprobada_at: string; aprobada_por_nombre: string | null; nota: string | null; diferencia_pp: number | null } | null;
  obsoleto: MotivoObsoleto[]; avisos: AvisoBarrer[]; huella: string };
```

Constantes (`tipos.ts`): `VENTANAS = [12, 24, 36]`, `VENTANA_DEFECTO = 24`, `MODO_DEFECTO = 'por_temporada'`, `MESES_TEMPORADA = { verano: [10, 11, 12, 1, 2, 3], invierno: [4, 5, 6, 7, 8, 9] }`, `MIN_MESES_TEMPORADA = 6`, `UMBRAL_GML_PEQUENO = 50`, `ERR_ESTABLE = 10`, `ERR_INESTABLE = 25`, `UMBRAL_OBSOLETO_PP = 5`, `EAT_SIMILAR = 6`, `EAT_DISTINTA = 10`, `TOLERANCIA_SUMA = 0.0005`, `VERSION_METODO_BARRER = 2`.

| Función pura | Archivo | Reglas |
|---|---|---|
| `clasificarHechos(hechos, configFlujo)` → `{ u, e, U }` por `(g, m)` | `clasificar.ts` | 1, 2 |
| `aplicarAlcance(filas, alcance)`, `repartoPorTemporada(u, φ, n)`, `repartoAnual(u, φ)`, `renormalizarResto(filas, editadas)`, `puedeAprobar(filas, nota, parametros)` | `reparto.ts` | 3, 4, 10 |
| `agruparPequenas(filas, umbral)`, `expandirResto(resto, miembros)` (`repartirProporcional`) | `resto.ts` | 5 |
| `errorReparto(u, φ, anios, modo, alcance)` | `error.ts` | 6 |
| `repartoSegunCerrada(cerrada, marcaId, k, modo, alcance)` | `cerrada.ts` | 7 |
| `estacionalidadPropia`, `estacionalidadGml`, `eat`, `veredicto`, `tendencia` | `estacionalidad.ts`, `tendencia.ts` | 8 |
| `huellaConfig(...)`, `motivosObsoleto(vigente, actual, umbral)` | `huellas.ts` | 11, 12 |
| `modalidadEfectiva` (ampliada), `normalizarModalidad`, `motivoPendiente` (+ `mixta_sin_gml`), `cambioMarca` (+ `modalidad_destino`) | `src/lib/marcas/reglas.ts`, `src/lib/marcas/gml/reglas.ts` | 13 |
| `claveFlujo` (ampliada) | `src/lib/marcas/gml/flujo.ts` | 14 |
| `analizarMarca(entrada)` determinista | `modelo.ts` | 15 |
| `hojasMarcasBarrer(lista)`, `hojasMarca(analisis)` | `excel.ts` | 16 |

## 8. Reglas de negocio (vitest, funciones puras salvo donde se indica)

1. **Universo.** Solo tiendas de tipo Tienda y cargas publicadas; el CD no entra (fixture: un hecho en el CD no cambia nada).
2. **Partición.** Para cada `(g, m)`: `u + e + resto = U`; un hecho de un miembro (BETA UNO) cuenta en la unidad (BETA).
3. **Alcance.** Con alcance `HOMBRE`, SANDALIA (MUJER) sale del denominador y aparece en `fuera_de_alcance`; sin alcance, entra; el alcance cambia `huella_config`.
4. **`p2` por temporada** suma 1 por temporada (± 1e-9) sobre las `g` del alcance con `u > 0`; con ventana 12 (3 meses de verano al inicio y 6 de invierno… según `k`) una temporada con menos de 6 meses cae a `anual` con `temporada_corta` y `modo_efectivo = 'anual'`; un GML específico de una mixta tiene `p2 = 0`; sin `u` → `null` + `sin_venta_barrer`.
5. **Resto.** Con `UMBRAL_GML_PEQUENO = 50`, nueve `g` de 10 a 40 u se agrupan en dos restos por género × mundo; `expandirResto` devuelve una fila por `g` con `grupo_resto`, suma exacta igual al `p2` del resto; un resto editado por el planner se reparte entre sus miembros en proporción a `Σ ũ`.
6. **Error del reparto.** Con dos años completos en los que la mezcla es idéntica → `0 pp` y `estable`; con DENIM 70 % → 30 % de un año al otro → `40 pp` e `inestable`; un solo año completo → `null` y `sin_backtesting`.
7. **`p2` según la cerrada.** Con participaciones `barrido BETA` de 0,12 en DENIM × PREMIUM y 0,30 en POLO × PREMIUM y las demandas del fixture de M8 → `p2^cerrada` cerrado en el fixture; sin cerrada → `null` + `sin_cerrada`; aprobar con `fuente = 'cerrada'` sin cerrada → `409 sin_cerrada`.
8. **Estacionalidad y tendencia**: como en la primera versión (`propia` suma 1; `eat` de iguales = 0 y de disjuntas = 100; dos años → ratio − 1; uno → `null`).
9. **Parte al barrer**: `barrido` → 1; mixta `u = 600`, `e = 400` → 0,6; mixta sin GML vigentes → 1 y `mixta_sin_gml`.
10. **Ajuste**: `renormalizarResto([41, 30, 17, 12] con la primera editada a 50)` → `[50, 25,4, 14,4, 10,2]`; suma ≠ 100 → `suma_invalida`; ajuste, ventana no por defecto, fuente `cerrada` o alcance sin nota → `nota_requerida`.
11. **Huellas y umbral**: cambiar modalidad, un GML vigente, un miembro, el nivel de una `g`, la ventana, el modo, el alcance o la fuente cambia `huella_config` → obsoleto siempre; publicar un mes que mueve el `p2` máximo 1,2 pp → **no** obsoleto (`al_dia`, `diferencia_pp = 1,2`); que lo mueve 6 pp → `cargas_nuevas`.
12. **Obsoleto no recalcula**: el reparto vigente no cambia al publicar un mes ni al cambiar la modalidad; solo se marca.
13. **Modalidad (M2 y 02b)**: `normalizarModalidad('mixta')` → `{ por_gml, resto_al_barrer: true }`; `modalidadEfectiva({ casilla, 'por_gml', resto_al_barrer: true })` = `mixta`; sin casilla → `null`; `cambioMarca(barrido, destino 'mixta')` → `{ de: 'barrido', a: 'mixta' }`; asignar un GML a una `barrido` sin `modalidad_destino` → `409 modalidad_destino_requerida` (handler); el importador de GML sin columna `MODALIDAD` omite esas filas con el mismo motivo.
14. **`claveFlujo` con mixta**: hecho de GAMMA en un GML donde es relevante → `{ unidad, marca_id: GAMMA }`; en otro GML → `{ barrido, marca_id: GAMMA }`; `construirConfigFlujo` incluye en `relevantes` los GML de una mixta; la partición sigue completa y disjunta (prueba de 02b ampliada).
15. **Determinismo**: misma entrada → misma salida; la entrada no se muta; `VERSION_METODO_BARRER` entra en `huella_config`.
16. **Excel = pantalla**: `hojasMarcasBarrer` devuelve las filas visibles con los filtros; `hojasMarca` tres hojas (`REPARTO` con una fila por `g` × temporada; sin `PESO_MENSUAL`); SheetJS solo en el componente con `import()` dinámico.
17. **M7 (handler y función pura)**: `calcular` escribe `huella_flujo`; `motivosDesactualizada` devuelve `config_cambiada` si la huella guardada difiere de la actual o es nula; una cerrada no cambia.
18. **SQL (humo local)**: `0019` aplica dos veces; `marcas_resto_al_barrer_check` rechaza `resto_al_barrer = true` con modalidad `barrido` o nula; el único parcial rechaza dos vigentes de la misma marca; `venta_marca_gml` excluye el CD, suma miembros en la cabeza y no devuelve talla; `venta_marca_gml_resumen` devuelve una fila por unidad marcada con sus conteos; `anon` no ejecuta las funciones ni lee las tablas; la vista reemplazada devuelve dos filas para una mixta; `proyecciones.huella_flujo` existe y admite nulo.
19. **Estático**: solo `consultas.ts` nombra las funciones SQL; `src/lib/marcas-barrer/` no importa `@supabase/*` ni componentes; toda ruta bajo `/api/marcas-barrer` usa `requirePlanner`; `nav.ts` marca el item con `PLANIFICACION`; ningún `GET` escribe; la prueba de `modalidad_tratamiento` de 6.1.

## 9. Casos sintéticos (`tests/marcas-barrer.fixture.ts`)

Árbol: `HOMBRE · URBANO · DENIM` (GML; curva plana), `HOMBRE · CASUAL · POLO` (GML; verano), `MUJER · CASUAL · SANDALIA` (GML; verano), `HOMBRE · FORMAL · CAMISA` (GMLE: MANGA LARGA, MANGA CORTA; invierno), más nueve GML pequeños de HOMBRE · CASUAL y HOMBRE · URBANO con 10 a 40 u. Marcas: BETA (PREMIUM, `barrido`; conjunto con BETA UNO), GAMMA (RECONOCIDO, mixta: relevante en CAMISA), DELTA (VALOR, `barrido`, sin venta en la ventana), ALFA (RECONOCIDO, `por_gml`, relevante en DENIM: no se analiza). Tiendas T01, T02 y el CD. Niño 2026 (invierno año completo; verano set–dic), factores invierno 2026 = 0,66, verano 2026 = 1,24. `k = 2026-09`, ventana 24 (oct-2024 → set-2026): verano = oct-24…mar-25 y oct-25…mar-26 (12 meses), invierno = abr-25…set-25 y abr-26…set-26 (12 meses).

1. **Clasificación**: BETA 100 u/mes en DENIM (T01) + 50 en POLO (T02) + BETA UNO 20 en SANDALIA + 30 u/mes de BETA en el CD → `u` = {DENIM 2 400, POLO 1 200, SANDALIA 480, pequeños 290}; el CD no cuenta.
2. **`p2` por temporada** de BETA (verano e invierno) cerrados en el fixture; con `normaliza_nino = false` difieren en el tercer decimal; `anual` iguala el reparto de la primera versión (`[0,590; 0,293; 0,117]` sin los pequeños).
3. **Alcance HOMBRE**: SANDALIA sale (`fuera_de_alcance = [{ SANDALIA, 480 }]`), DENIM/POLO/pequeños se renormalizan.
4. **Resto**: los nueve pequeños forman "Resto de HOMBRE · CASUAL" (6) y "Resto de HOMBRE · URBANO" (3); aprobar guarda nueve filas con `grupo_resto`; `GET …/vigentes` devuelve las nueve.
5. **Error del reparto**: BETA constante → `0 pp`, `estable`; variante "BETA cambia": 2025 DENIM 70 % / POLO 30 % y 2026 al revés → `40 pp`, `inestable`, chip "inestable" en la lista.
6. **`p2` según la cerrada**: con la cerrada del fixture de M8 (participaciones `barrido BETA` 0,12 en DENIM × PREMIUM y 0,30 en POLO × PREMIUM) → `p2^cerrada` cerrado; aprobar con `fuente = 'cerrada'` y nota → v1 con `fuente = 'cerrada'`.
7. **Mixta GAMMA**: 40 u/mes en CAMISA › MANGA LARGA (→ `e`), 60 u/mes en DENIM (→ `u`): `share_barrido = 0,6`; `p2` = {DENIM 1,0}; CAMISA `es_especifico = true`; apagar la bandera → `409 modalidad_no_barrer`.
8. **Asignar el primer GML a BETA** (`barrido`) sin `modalidad_destino` → `409`; con `'mixta'` → BETA pasa a mixta con ese GML vigente y su reparto vigente queda `config_cambiada`.
9. **Ajuste y aprobación**: editar DENIM (verano) a 0,50 → `renormalizarResto`; `POST` sin nota → `409 nota_requerida`; con nota → v1; otra vez con la misma huella → v2, `v1.vigente = false`; publicar oct-2026 que mueve `p2` 0,8 pp → `obsoleto = []`, `diferencia_pp = 0,8`; que lo mueve 7 pp → `["cargas_nuevas"]` y `POST` con la huella vieja → `409 huella_cambiada`.
10. **DELTA** sin venta → `sin_venta_barrer`, `filas = []`, aprobar → `409 suma_invalida`; en la lista "Sin reparto".
11. **Vigentes para M8**: `GET /api/marcas-barrer/vigentes?marca_ids=BETA,GAMMA,DELTA` → BETA v2 (por temporada, con `alcance`, `error_reparto_pp`), GAMMA (si aprobada), `sin_reparto = [DELTA]`.
12. **Vista SQL**: GAMMA mixta → dos filas en `marca_gml_especial_vigente`; BETA → una (`barrido`); ALFA → una por GML.
13. **M7**: una proyección en trabajo calculada antes de pasar GAMMA a mixta (`huella_flujo` distinta o nula) → `motivosDesactualizada` incluye `config_cambiada`; una cerrada no cambia.

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todas más `tests/marcas-barrer.*`, la ampliación de `tests/marcas.gml.*` con la mixta y `tests/proyeccion.*` con `config_cambiada`), `npm run build`, `scripts/validar-migraciones-local.sh`; `0019` aplicada en `vector-two`; tipos regenerados; `APP_VERSION = 0.11.0 · M12`.

**Prerrequisitos de Javier** · Lista real de marcas con tratamiento especial (M2) con sus conjuntos y la hoja de GML (02b); al menos 24 meses publicados; factores del Niño sincronizados en M7; curvas vigentes en las agrupaciones donde venden las marcas al barrer; decidir qué marcas son mixtas y en qué GML; decidir si alguna marca al barrer se compra solo para un género o mundo (alcance).

**Hito en navegador (sección G de `cowork-checklist.md`, usuario planner; ✍️ = pedir confirmación a Javier)**
1. Como comprador: "Marcas al barrer por GML" no aparece en el menú, la URL redirige y `GET /api/marcas-barrer` responde `403`.
2. La lista carga en menos de 3 s con todas las marcas al barrer y mixtas, unidades de 24 meses, GML con venta (y cuántos pequeños), error del reparto y estado; anotar cuántas hay de cada modalidad y cuántas inestables.
3. Abrir la marca al barrer de mayor volumen: bloque 1 con los dos vectores (verano e invierno), `p2` histórico y según la cerrada lado a lado, los restos plegados; cambiar la ventana a 12 y a 36; en una marca de invierno la cabecera dice "÷ 0,66".
4. ✍️ Poner un alcance (por ejemplo HOMBRE) en una marca que vende en varios géneros y ver qué sale del reparto; quitarlo.
5. Bloque 2 (tabla año × mes de `p1`); bloque 3 (estacionalidad y EAT); bloque 4 (parte al barrer frente a específica).
6. ✍️ Aprobar el reparto calculado de una marca (sin ajuste): "v1 · al día"; editar un GML al alza, "Renormalizar el resto", nota y aprobar v2; "Comparar v2 con lo calculado hoy".
7. ✍️ Asignar el primer GML a una marca al barrer desde Marcas relevantes por GML: aparece "¿Por GML o Mixta?"; elegir Mixta; el bloque 4 muestra la parte específica; el reparto vigente aparece obsoleto (`config_cambiada`); volver a dejarla como estaba.
8. En Marcas (M2), el `Select` ofrece Mixta y la pestaña cuenta las mixtas; en Proyección (M7) una proyección en trabajo dice "desactualizada: configuración cambiada" tras el paso 7.
9. `GET /api/marcas-barrer/vigentes` devuelve los repartos aprobados con su versión, temporada, alcance y error.
10. Excel de la lista y de una marca: las hojas y las filas coinciden con la pantalla y los filtros.
11. ✍️ Javier revisa tres marcas que conoce: el reparto por temporada se parece a cómo las compra; para las inestables, decide si las acota con un alcance, si prefiere el reparto según la cerrada o si esas se registrarán siempre con porcentajes del comprador (M9).

## 11. Alcance

**Primera entrega (`0.11.0 · M12`)**: modalidad `mixta` (columna `resto_al_barrer`, `modalidadEfectiva`, zod, `Select`, pregunta "¿Por GML o Mixta?", `claveFlujo`, vista reemplazada, `vigentes` con `mixtas`, `huella_flujo` + `config_cambiada` en M7); lista desde la función resumen; análisis por marca (`p1`, `p2` por temporada y anual, histórico y según la cerrada, alcance, restos, error del reparto, estacionalidad, tendencia, parte al barrer); ventana 12/24/36, normalización del Niño; ajuste por GML con renormalización, aprobación versionada con huellas, umbral de obsolescencia; `GET …/vigentes`; Excel (`RESUMEN`, `REPARTO`, `ESTACIONALIDAD`, `FILTROS`).

**Segunda entrega (`0.11.1 · M12`)**: modo `por_mes` y hoja `PESO_MENSUAL` (diferidos por el revisor); tendencia y `p1` sobre mismas tiendas; reparto por agrupación de talla; "agregar GML sin venta"; sugerencia automática de qué marcas deberían ser mixtas; comparación de versiones con las compras que usaron cada una (necesita M9); umbrales (`UMBRAL_GML_PEQUENO`, `ERR_*`, `UMBRAL_OBSOLETO_PP`) editables en pantalla.

**Fuera de alcance**: registrar compras, repartir compras concretas, los porcentajes del comprador para lotes de varias marcas o mostrar el flujo (M9/M8); cambiar M5, M3 ni M6; decidir el volumen de la marca (M7); relevancia por equivalencia (pregunta 13 de 02b).

## 12. Riesgos

- **Inestabilidad medida (B1)**: 24–40 pp entre años para la mayoría de las marcas al barrer; el reparto por temporada, el alcance y el resto reducen el ruido pero no lo eliminan; el error del reparto se muestra para que el comprador sepa cuánto fiarse, y los lotes de varias marcas ya no dependen de esta estadística.
- **Ventana y Niño**: con 24 meses hasta set-2026 la ventana incluye todo el invierno Niño de 2026 y un solo invierno normal; la normalización corrige el volumen, no la mezcla.
- **Mixta sin GML**: se comporta como al barrer y se persigue como pendiente.
- **El cambio de `claveFlujo` toca M7**: `config_cambiada` lo hace visible; hay que cerrar una proyección nueva tras construir M12 (orden M12 → M8).
- **Sin transacción al aprobar**: igual que M6; visible y reparable repitiendo.
- **Representación de `mixta` con dos columnas**: cualquier lectura directa de `modalidad_tratamiento` fuera de los archivos listados en 6.1 vería `por_gml`; la prueba estática lo vigila.
- **Calendario de temporadas fijo** (octubre–marzo / abril–septiembre): si Javier usa otro corte, es una constante.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M12: las compras al barrer de una sola marca se reparten a los GML con un reparto estadístico aprobado y versionado, que M8 usa sin recalcular; los lotes de varias marcas llevan porcentajes del comprador (M9).** Por qué: una compra confirmada no debe cambiar de GML sola; y la estadística no sabe qué mezcla trae un lote de varias marcas (Javier, ronda 3). Descartado: calcular `p2` al vuelo en M8; repartir por tienda; estadística para lotes mezclados.
2. **M12: el reparto es por temporada de llegada por defecto, con alcance opcional por género, mundo o líneas, GML pequeños agrupados en un resto por género × mundo, error del reparto (backtesting) visible y guardado, y el reparto que se deduce de la cerrada de M7 como fuente alternativa.** Por qué: B1 del revisor (24–40 pp de inestabilidad; la mitad de los GML con menos de 50 u). Descartado: un solo vector anual; suavizado automático.
3. **M12: la modalidad `mixta` se representa como `por_gml` + `resto_al_barrer`, sin tocar el check de `0010`; al asignar el primer GML a una marca al barrer se pregunta la modalidad destino.** Descartado: `drop constraint` a mano; "barrido + GML = mixta" implícito.
4. **M12: en `claveFlujo`, la venta de una mixta fuera de sus GML va al flujo al barrer, no a "otras"; M7 gana `proyecciones.huella_flujo` y el motivo `config_cambiada`.**
5. **M12: ventana por defecto de 24 meses, normalización del Niño por mes con los factores de M7; un reparto vigente es obsoleto por cargas nuevas solo si algún `p2` se mueve más de 5 pp.** Supuestos a validar.
6. **M12: el análisis se calcula a demanda y no se guarda; la lista sale de una función resumen y los hechos se agregan en SQL sin talla** (I7). Descartado: una llamada con ~90 mil hechos; tabla de agregados.
7. **M12 y M13: la base solo lleva invariantes estructurales; los catálogos (`modo`, `fuente`, `ventana_meses`, `temporada`) van en zod** (I9).

**Cambios que integra el `documentador`**: PLAN §4 (columna `marcas.resto_al_barrer`, `proyecciones.huella_flujo`, tablas `repartos_marca_barrido` y `reparto_marca_barrido_gml`, funciones `venta_marca_gml` y `venta_marca_gml_resumen`, migración `0019`, versión `0.11.0 · M12`), PLAN §5 (fila M12 entre M7 y M8), PLAN §7 (pendiente: qué marcas son mixtas, alcances), ficha 02b (modalidad con tres valores; pregunta al asignar; vista con dos filas por mixta; regla 12 ampliada), ficha 07 (`huella_flujo`; `config_cambiada`; participaciones con `barrido` + `marca_id` de mixtas), `cowork-checklist.md` sección G, `nav.ts`.

## 14. Preguntas para Javier (cuatro; mientras tanto rige la recomendación)

1. **Temporada de llegada.** ¿Verano = octubre a marzo e invierno = abril a septiembre, como corte para "a qué temporada llega un lote"? **Recomendación: sí; es una constante.**
2. **Umbrales.** GML pequeño por debajo de 50 unidades en 24 meses; reparto "inestable" por encima de 25 pp; obsoleto por cargas nuevas a partir de 5 pp. **Recomendación: estos valores en la primera entrega; editables en la segunda.**
3. **Fuente del reparto.** ¿Prefieres por defecto el reparto histórico (ventana) o el que se deduce de la cerrada de M7 (ya lleva el crecimiento por GML)? **Recomendación: histórico por defecto, con el de la cerrada al lado; lo decide el paso 11 del hito.**
4. **Normalización del Niño en el reparto.** ¿Se dividen los meses atípicos por el factor de M7 antes de calcular el reparto? **Recomendación: sí, con la cifra cruda al lado.**

Resueltas por Javier (ronda 3): los lotes de varias marcas llevan porcentajes del comprador (antes pregunta 1); la representación de `mixta` como `por_gml` + `resto_al_barrer` se mantiene como recomendación (antes pregunta 5); el grano de la parte específica sigue por GML (antes pregunta 1 de la primera versión).

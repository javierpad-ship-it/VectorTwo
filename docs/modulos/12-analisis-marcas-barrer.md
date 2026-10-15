# M12 · Análisis de marcas al barrer por GML y modalidad `mixta` (cambio de M2b)

> Estado: **especificada el 2026-10-15, pendiente de revisión por el `arquitecto-revisor` y de aprobación por Javier.** Es el módulo de análisis que Javier pidió **antes de M8** (decisiones 3, 4, 8 y 9 de `08-09-definiciones-del-dueno.md`) y lleva además el cambio de M2b que convierte la modalidad excluyente `por_gml` / `barrido` en tres: `por_gml`, `barrido` y **`mixta`**. Migración prevista **`0019_marcas_barrer.sql`** (la `0018` es de M7 y ya está aplicada); versión prevista **`0.11.0 · M12`**, después de `0.10.0 · M7`; commits con prefijo `M12:`. Depende de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (modalidad, `marca_gml_especial`, `marcas_unidad`, `claveFlujo`, `curvaUnidad`), [05-venta-stock](05-venta-stock.md) (`venta_stock_vigente`), [06-curvas-estacionalidad](06-curvas-estacionalidad.md) (`claseDeAnio`, curvas vigentes) y [07-proyeccion-anual](07-proyeccion-anual.md) (`factores_volumen_atipico`, `factoresMes`, `participaciones_historicas`). Lo consumen [08-flujo-y-compras](08-flujo-y-compras.md) (reparto vigente de cada marca al barrer) y, por `claveFlujo`, M7. Toda la API es `requirePlanner`. Ningún dato real de Lukers: marcas ALFA, BETA, GAMMA, DELTA; nodos `HOMBRE · URBANO · DENIM`, `HOMBRE · CASUAL · POLO`, `MUJER · CASUAL · SANDALIA`; tiendas `T01…T09`; cifras inventadas.

## 1. Objetivo

Las marcas con tratamiento especial **al barrer** se compran por marca, no por GML: el comprador va a la feria y trae "N unidades de BETA" que después se reparten entre varias líneas. M7 ya proyecta la venta de esas marcas **dentro** de la fila GML × agrupación de marca de cada GML (la fila cuadra con la venta real del nodo), de modo que M8 sabe cuánta demanda de cada GML es "al barrer" pero no sabe **a qué GML** llegará una compra de BETA. Este módulo hace esa estadística y la deja aprobada: para cada marca al barrer (o mixta), cuánto pesa en la venta de cada GML por mes y año, cómo tiende, si su estacionalidad se parece a la del GML, qué parte de la marca se compra al barrer y qué parte con compras específicas, y el **reparto** de una compra de la marca a los GML (calculado sobre una ventana, normalizado en los meses del Niño, ajustable a mano por GML y versionado). M8 reparte cada compra al barrer con el reparto vigente y nunca recalcula.

Además cierra el hueco que Javier señaló en M2b: hoy una marca es `por_gml` **o** `barrido`, y los GML asignados a una marca al barrer quedan ignorados. Con la modalidad **`mixta`** una marca tiene GML (o nodos GMLE) con compras específicas, que entran directo al flujo de esos GML, y el resto de su venta va al flujo al barrer con el reparto estadístico.

## 2. Decidido por Javier (2026-10-15)

1. **Hay que hacer estadística que llegue a nivel de GML** para incorporar las marcas al barrer a los flujos de cada GML; es un módulo de análisis propio (decisión 3).
2. **Hay marcas mixtas**: parte al barrer y parte con compras específicas de un GML o GMLE; la modalidad de M2b debe cubrirlo con una **modalidad `mixta` explícita** (decisiones 4 y 8).
3. **Este módulo va antes de M8** (decisión 9).
4. Interpretación propuesta en el borrador y que esta ficha adopta: una compra al barrer se registra a nivel de marca; el sistema la reparte entre los GML con la participación histórica de la marca en cada GML; M7 ya incluye la venta de esas marcas en la fila GML-AM, así que M8 no duplica demanda, solo decide cómo se cubre.

De fichas anteriores y sin cambio: la unidad de marca es la cabeza del conjunto (`marcas_unidad`); la relevancia es por marca × GML (nivel B); la partición de `claveFlujo` es completa y disjunta; las marcas al barrer quedan fuera de las unidades de planificación en la vista "mi flujo de Jeans" de 02b (pregunta 12 de esa ficha), pero **dentro** de la fila GML-AM de M7 (decisión registrada el 2026-10-15).

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Marca analizada (`B`)** | Una **unidad de marca** (cabeza o marca suelta) marcada, vigente y con modalidad efectiva `barrido` o `mixta`. Las `por_gml` puras no se analizan aquí (su detalle vive en M7 como marca relevante). |
| **Unidad `g`** | Unidad de planificación de 02b: nodo `GML`, o nodo × equivalencia si el nodo es `GMLE`. Es el grano del reparto, el mismo que M7 y M8. |
| **Parte al barrer de `B`** | Los hechos de `B` cuya `claveFlujo` es `{ tipo: "barrido" }`. En una marca `barrido` es toda su venta; en una `mixta`, la venta fuera de sus GML específicos. |
| **Parte específica de `B`** | Solo en `mixta`: los hechos de `B` en los GML donde es relevante (`marca_gml_especial` vigente), con clave `{ tipo: "unidad", marca_id: B }`. Entran al flujo del GML como una marca relevante más; no se reparten. |
| **Peso de la marca en el GML (`p1`)** | `p1_{B,g,m} = u_{B,g,m} ÷ U_{g,m}`: unidades de `B` en `g` el mes `m` sobre las unidades totales de `g` ese mes (todas las marcas, todas las claves). Anual: cociente de sumas. Dice cuánto de "mi flujo de Jeans" es BETA. |
| **Reparto de la marca a los GML (`p2`)** | `p2_{B,g} = ũ_{B,g} ÷ Σ_g ũ_{B,g}` sobre la ventana, con `ũ` las unidades de la **parte al barrer** normalizadas por el Niño. Dice a qué GML va una compra de BETA. `Σ_g p2 = 1`. Es lo que M8 usa. |
| **Ventana (`W`)** | Meses cerrados hasta `k` (último mes publicado y terminado, `hastaPorDefecto` de M6): `12`, `24` o `36` meses. Por defecto **24** (dos ciclos completos de temporada; con 12 una marca de invierno comprada en una feria de verano saldría sesgada). |
| **Modo del reparto** | `anual` (un `p2` por GML sobre toda la ventana; por defecto) o `por_mes` (un `p2` por GML y mes del año, promediando los años de la ventana: sirve si la mezcla de GML de la marca cambia con la temporada). `por_mes` exige al menos 24 meses de ventana y dos observaciones por mes; si no, cae a `anual` con aviso `ventana_corta`. |
| **Normalización del Niño** | Cada mes `m` de la unidad `g` se divide por `φ_{año(m),m}` de M7 (`factoresMes`: factor de la temporada de la agrupación dominante de `g`, ponderado si mezcla temporadas; 1 fuera de los meses atípicos). Si falta el factor de una temporada con meses atípicos en la ventana → 1 y aviso `sin_factor`. |
| **Estacionalidad propia de `B`** | Participación de cada mes del año en las unidades de `B` (parte al barrer, normalizada), sobre los **años completos** de la ventana: doce valores que suman 1, el mismo concepto que la curva de M6 pero sobre todas las tiendas (sin red comparable; aviso `red_no_comparable`). |
| **Estacionalidad del GML para `B`** | `c^{GML}_m = Σ_g p2_{B,g} × curvaUnidad(g)_m`: la curva que M7 aplicará a la venta de `B` al estar dentro de cada GML. Distancia `EAT = Σ_m |c^B_m − c^{GML}_m| ÷ 2`, en puntos porcentuales (misma métrica que el backtesting de M6). |
| **Tendencia** | `Σ ũ_{B}(año A) ÷ Σ ũ_{B}(año A−1) − 1` para los dos últimos años completos, sobre todas las tiendas (aviso `red_no_comparable`; la versión sobre mismas tiendas con los bloques de M7 es segunda entrega). |
| **Reparto aprobado (vigente)** | Foto de `p2` por GML (calculado y, si el planner lo cambió, ajustado), con ventana, modo, huella de cargas y de configuración, versión y quién. **Una vigente por marca**, versionada como las curvas de M6. Es el contrato con M8. |
| **Obsoleto** | El reparto vigente difiere de lo que se calcularía hoy: cargas publicadas después, modalidad o GML de la marca cambiados, nivel de un nodo cambiado, conjunto cambiado. Se avisa con motivo; no se recalcula solo. |

### Por qué el reparto se guarda y se aprueba, en vez de calcularse al vuelo en M8

M8 reparte compras que el comprador ya confirmó: si `p2` cambiara con cada mes publicado, una compra de 1 000 BETA cambiaría de GML sin que nadie lo decida y el saldo por comprar de cada GML se movería solo. Con un reparto aprobado y versionado, M8 guarda qué versión usó en cada compra, avisa "el reparto cambió" y el planner aplica la nueva cuando quiere (el patrón de "la curva cambió" de M7). El cálculo sigue siendo **a demanda y no se guarda** (criterio 06b); solo se guarda la foto de cada aprobación.

## 4. Flujo de pantalla (UX primero)

Ruta **`/planificacion/marcas-barrer`**, item "Marcas al barrer por GML" en la sección Planificación de `nav.ts` (`PLANIFICACION`: admin y planner; el comprador no lo ve y `page.tsx` lo redirige). Kit: `Card`, `DataTable`, `Chips`, `Select`, `Switch`, `Badge`, `Alert`, `EmptyState`, `Modal`, `mini-curva` de M6. Hook propio `use-marcas-barrer.ts` (patrón `use-estacionalidad.ts`: la respuesta no es un array). Formato `es-PE` (`src/lib/formato.ts`). La marca abierta, la ventana y el modo van en la URL (`?marca=<id>&ventana=24&modo=anual`), como `?agrupacion=` en 06b.

**Paso 0 · Lista.** Una fila por marca analizada, en orden de unidades de la ventana:

```
Marcas al barrer por GML · datos hasta 2026-09 · ventana [24 meses ▾] · modo [anual ▾]      [Recargar]   [Excel]
Filtros: [Modalidad: todas ▾] [Agrup. marca ▾] [Género ▾] [Mundo ▾] [Línea ▾]  Solo: (sin reparto) (obsoletas) (mixtas)
Marca     Modalidad  Agrup.      Unid. 24 m  Al barrer  Específica  GML con venta  Reparto vigente        Estado
BETA      Al barrer  PREMIUM        12 480     100 %         —            14        v2 · 2026-09-30       Al día
GAMMA     Mixta      RECONOCIDO      8 310      61 %       39 %           9 (+2 específicos)  v1 · 2026-08-12  Obsoleto: cargas nuevas
DELTA     Al barrer  VALOR           1 020     100 %         —             6        —                     Sin reparto
3 marcas · 21 810 unidades al barrer en 24 meses · 1 sin reparto · 1 obsoleta
```

*Decide*: qué marca abrir primero (las sin reparto bloquean a M8 para esa marca: sus compras al barrer no se reparten y quedan con aviso `sin_reparto`).

**Paso 1 · Abrir una marca (`?marca=`).** Cabecera: marca, miembros del conjunto, modalidad (con `Select` para cambiarla: Por GML · Al barrer · Mixta, `PATCH /api/marcas/[id]`, con `confirm`), agrupación, GML específicos si es mixta (enlace a Marcas relevantes por GML). Cuatro bloques, en el orden de lectura:

```
BETA · Al barrer · PREMIUM · conjunto: BETA UNO, BETA DOS · ventana oct-2024 → set-2026 (24 m) · Niño: inv 2026 ÷ 0,66 · ver 2026 set ÷ 1,24
┌ 1. Dónde vende BETA (reparto p2, parte al barrer, normalizada) ───────────────────────────────────────────────────────────────┐
│ GML / unidad                   Unid. 24 m   p2 calc.   p2 ajust.   p1 (peso en el GML)   Tendencia   2024  2025  2026 (a set) │
│ HOMBRE · URBANO · DENIM            5 120     41,0 %    [ 41,0 ]     8,2 %                 +6 %        2 310  2 480  1 890     │
│ HOMBRE · CASUAL · POLO             3 740     30,0 %    [ 30,0 ]    12,5 %                 −3 %        1 900  1 840  1 410     │
│ MUJER · CASUAL · SANDALIA          2 120     17,0 %    [ 17,0 ]     4,1 %                +14 %          860    980    900     │
│ HOMBRE · URBANO · DENIM › SLIM (GMLE) 1 500  12,0 %    [ 12,0 ]     9,9 %                 +2 %          700    740    520     │
│ Suma                              12 480    100,0 %     100,0 %                                                                │
│ [Renormalizar el resto] [Volver a lo calculado]   Nota [__________________________]   [Aprobar este reparto como v3]          │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ 2. Peso de BETA en cada GML por mes y año (p1) ──────────────── [Tabla ▾ | Gráfico] [GML: DENIM ▾] ──────────────────────────┐
│          ene   feb   mar   abr   may   jun   jul   ago   set   oct   nov   dic   Año                                           │
│ 2024    7,1   7,4   8,0   8,8   9,1   9,4   8,9   8,2   7,8   7,5   7,2   7,0   8,0 %                                        │
│ 2025    7,3   7,6   8,2   9,0   9,6   9,8   9,1   8,4   8,0   7,7   7,4   7,2   8,3 %                                        │
│ 2026    7,5   7,9   8,4   9,3   9,9  10,1   9,4   8,6   8,1    —     —     —    8,8 % (a set; Niño inv ÷ 0,66 en la tabla normalizada) │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ 3. Estacionalidad propia frente a la del GML ────────────────────────────────────────────────────────────────────────────────┐
│ ▂▃▄▅▇█▆▄▃▂▂▂  BETA (2 años completos)     ▂▃▄▆▇█▇▅▃▂▂▂  GML ponderado por p2 (DENIM HO v2 41 % · POLO HO v1 30 % · …)        │
│ EAT 4,8 pp · la forma de BETA se parece a la de sus GML: M7 la proyecta con la curva de cada GML sin corrección (informativo)  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ 4. Qué parte se compra al barrer ────────────────────────────────────────────────────────────────────────────────────────────┐
│ BETA es "Al barrer": el 100 % de su venta (12 480 u) se cubre con compras de marca repartidas con el bloque 1.                 │
│ (En GAMMA, mixta: 61 % al barrer → bloque 1; 39 % específica en HOMBRE · FORMAL · CAMISA (2 780 u) y HOMBRE · FORMAL · TERNO  │
│  (460 u), que entran al flujo de esos GML como marca relevante y NO se reparten.)                                              │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Versiones: v2 (2026-09-30, ventana 24 m, anual, Javier: "sin ajuste") · v1 (2026-07-02, 12 m) · [Comparar v2 con lo calculado hoy]
```

Reglas de la pantalla: las celdas `p2 ajust.` se editan en línea (porcentaje con un decimal); al editar una, la suma deja de ser 100 y el botón **Aprobar** se deshabilita hasta que el planner pulse **Renormalizar el resto** (escala proporcionalmente las no editadas) o corrija a mano; una fila con `p2 calc. = 0` (GML sin venta de la marca) solo aparece si el planner la agrega con "Agregar GML" (para una marca que entra a una línea nueva: supuesto a validar, pregunta 4). La nota es obligatoria si algún ajuste difiere del calculado o si la ventana no es la por defecto (criterio 06b). *Decide*: ventana, modo, ajustes por GML y aprobar.

**Paso 2 · Cambiar la modalidad a `mixta`.** Desde la cabecera o desde Marcas (M2): `Select` Por GML · Al barrer · Mixta. Al elegir Mixta en una marca `barrido` con GML asignados e ignorados, el `confirm` dice: "GAMMA pasará a mixta: sus 2 GML asignados (HOMBRE · FORMAL · CAMISA, HOMBRE · FORMAL · TERNO) serán compras específicas y el resto de su venta seguirá al barrer. Su reparto vigente quedará obsoleto (`config_cambiada`)". Al elegir Mixta en una `por_gml`: "GAMMA pasará a mixta: su venta fuera de sus 2 GML dejará de contar como 'otras de RECONOCIDO' y pasará al flujo al barrer; M7 debe recalcular las participaciones". Sin GML asignados, Mixta se guarda y la marca queda **pendiente** (`mixta_sin_gml`: se comporta como al barrer y la pantalla la persigue). *Decide*: la modalidad.

**Paso 3 · Excel.** Botón en la lista y en cada marca; SheetJS bajo demanda en el navegador (patrón M11, `src/lib/reportes/descargas.ts`), sin ruta de descarga: hoja `RESUMEN` (la lista con los filtros), hoja `REPARTO` (marca × GML × p2 calculado, ajustado, vigente, versión), hoja `PESO_MENSUAL` (marca × GML × año × mes `p1`), hoja `ESTACIONALIDAD` (doce valores propios y del GML, EAT), hoja `FILTROS`. Nombre `marcas-barrer-AAAA-MM-DD.xlsx` o `marcas-barrer-BETA-AAAA-MM-DD.xlsx`.

**Pestaña en Marcas (M2).** La pestaña "Marcas relevantes por GML" gana el estado `mixta` en sus chips y resúmenes (`marcadas · por_gml · barrido · mixta · pendientes`); el `Select` de modalidad de la tabla de Marcas ofrece el tercer valor. Nada más cambia en M2.

### Qué decide el planner y qué decide el sistema

| Decisión | Quién |
|---|---|
| Modalidad de la marca (por GML, al barrer, mixta) y sus GML específicos | planner (M2 / 02b, con atajo aquí) |
| Ventana, modo y normalización del Niño | planner (parámetros por marca; por defecto 24 m, anual, con Niño) |
| `p2` calculado, `p1`, estacionalidad, tendencia, avisos | sistema, a demanda, nunca se guarda |
| `p2` ajustado por GML y la aprobación (versión nueva) | planner, una marca a la vez; nada en bloque |
| Cuándo un reparto está obsoleto | sistema (huellas) |
| Qué versión usa cada compra | M8 (guarda la versión; "aplicar reparto nuevo" es del planner, en M8) |

## 5. Método (lógica pura en `src/lib/marcas-barrer/`, TypeScript sin I/O)

Notación: marca `B`; unidad `g`; mes `m`; ventana `W` de `n ∈ {12, 24, 36}` meses cerrados hasta `k`; `u_{B,g,m}` unidades de la **parte al barrer** de `B` en `g` (clave `barrido` de `claveFlujo` tras el cambio de la sección 6.2); `e_{B,g,m}` unidades de la parte específica (solo mixta); `U_{g,m}` unidades totales de `g` (todas las marcas); `φ_{g,m}` el factor del Niño de `g` en el mes `m` (`factoresMes` de M7, con `factores_volumen_atipico`); `ũ = u ÷ φ`. Universo: tiendas de tipo Tienda (sin el CD), cargas publicadas. Redondeo solo al presentar.

1. **Clasificación.** Cada hecho de la ventana pasa por `claveFlujo` con la configuración vigente (02b + mixta): va a `u` (clave `barrido` con `marca_id = B`), a `e` (clave `unidad` con `marca_id = B`) o a "resto del GML" (todo lo demás, que solo alimenta `U`). `U_{g,m} = Σ` de todas las claves de `g`.
2. **Peso `p1`.** `p1_{B,g,m} = (u + e)_{B,g,m} ÷ U_{g,m}` (en una mixta, el peso en su GML específico cuenta la parte específica: es "cuánto de este GML es GAMMA"); anual y de la ventana por cociente de sumas; `U = 0` → `null`.
3. **Reparto `p2` (anual).** `p2_{B,g} = Σ_{m∈W} ũ_{B,g,m} ÷ Σ_g Σ_{m∈W} ũ_{B,g,m}`. Solo la parte al barrer. Un GML específico de una mixta tiene `u = 0` ahí y por tanto `p2 = 0` (no recibe compras al barrer). `Σ_g p2 = 1`; sin venta al barrer en `W` → `null` y aviso `sin_venta_barrer`.
4. **Reparto `p2` (por mes).** `p2_{B,g,j} = Σ_{m∈W, mes(m)=j} ũ_{B,g,m} ÷ Σ_g Σ_{m∈W, mes(m)=j} ũ_{B,g,m}` para `j = 1..12`; exige `n ≥ 24` y al menos dos observaciones de `j`; si no, `anual` y `ventana_corta`.
5. **Estacionalidad propia.** Sobre los años completos de `W` (`A ⊂ W`): `c^B_j = Σ_{a∈A} Σ_g ũ_{B,g,(a,j)} ÷ Σ_{a∈A} Σ_g Σ_j ũ`. Menos de un año completo → `null` y `sin_anio_completo`. `c^{GML}_j = Σ_g p2_{B,g} × curvaUnidad(g)_j` (curvas vigentes de M6; una `g` sin curva se excluye y renormaliza, aviso `curva_incompleta`). `EAT = Σ_j |c^B_j − c^{GML}_j| ÷ 2` (en pp, ×100). Veredicto: `similar` si `EAT ≤ 6`, `distinta` si `> 10`, `dudosa` entre medias (umbrales a validar; informativo).
6. **Tendencia.** Con los dos últimos años completos `A₁ < A₂` dentro de `W`: `t = Σ ũ(A₂) ÷ Σ ũ(A₁) − 1`; con menos, `null`. Por GML y total.
7. **Parte al barrer.** `share_barrido = Σ u ÷ (Σ u + Σ e)` sobre `W`; `barrido` → 1; mixta sin GML vigentes → 1 con `mixta_sin_gml`.
8. **Ajuste y aprobación.** `ajustado_g ∈ [0, 100]` con un decimal; `renormalizarResto(filas, editadas)` escala las no editadas para que la suma sea exactamente 100 (el residuo de redondeo va a la mayor no editada); `puedeAprobar` ⇔ suma = 100,0 ± 0,05 y ≥ 1 fila con `ajustado > 0` y (nota si hay ajuste o ventana no por defecto). La versión guarda `calculado`, `ajustado` y `vigente = ajustado ?? calculado` por fila.
9. **Huellas.** `huella_cargas` = ids de las cargas publicadas de `W` (como 06b); `huella_config` = hash de (modalidad efectiva de `B`, GML vigentes de `B`, miembros del conjunto, nivel de cada `g` con venta, ventana, modo). Obsoleto si alguna difiere de la vigente: motivos `cargas_nuevas`, `config_cambiada`, `nivel_cambiado`, `ventana_distinta`.

Todo determinista: `analizarMarca(entrada)` recibe hechos ya clasificados, curvas, factores y `k`; no lee el reloj.

## 6. Modelo de datos (`0019_marcas_barrer.sql`)

Idempotente: `add column if not exists` con constraints inline, `create table if not exists`, `create or replace view`, `create or replace function`, `create index if not exists`, `create or replace trigger`; **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`**, sin bloques `do $$`, sin backfill. Tablas nuevas con `id uuid`, `activo`, `created_at`, `updated_at` (`tg_set_updated_at`), RLS activo sin políticas, `revoke all … from public, anon, authenticated` y `grant … to service_role` sobre cada objeto nuevo (convención `0013`–`0018`). Funciones `security invoker`, `stable`, `set search_path = ''`.

### 6.1 Modalidad `mixta` sin tocar el check de `0010`

El check `marcas_modalidad_valor_check` admite solo `por_gml` y `barrido`. **No se puede ampliar en sitio**: Postgres no permite alterar la expresión de un `check`; la única vía es `alter table … drop constraint` seguido de `add constraint`, y `DROP` está prohibido en las migraciones (se aplican con `execute_sql` del MCP, que se queda esperando una confirmación). Como hizo la `0012` con la función (nombre nuevo en vez de alterar), aquí la `mixta` se representa con **una columna nueva que se combina con la existente**, y el valor `mixta` existe en la API, en las vistas y en la pantalla, no en la columna `modalidad_tratamiento`:

| Columna nueva en `marcas` | Tipo | Notas |
|---|---|---|
| `resto_al_barrer` | `boolean not null default false` | `add column if not exists … constraint marcas_resto_al_barrer_check check (not resto_al_barrer or modalidad_tratamiento = 'por_gml')`. **`mixta` ⇔ `modalidad_tratamiento = 'por_gml' and resto_al_barrer`.** El `default false` deja todas las marcas existentes exactamente como estaban, sin `UPDATE`. |

Por qué este par y no otro: una marca mixta **es** relevante en sus GML (compras específicas = `por_gml` en esos nodos) y lo que cambia es **a dónde va el resto**: en `por_gml` el resto es "otras de la agrupación"; en `mixta` el resto es el flujo al barrer. La bandera dice exactamente eso. Lectura: `modalidadEfectiva(marca)` devuelve `null` sin casilla, `por_gml`, `barrido` o **`mixta`** (`por_gml` con `resto_al_barrer`). Escritura: `modalidad_tratamiento: 'mixta'` en los esquemas zod de M2 se normaliza a `{ modalidad_tratamiento: 'por_gml', resto_al_barrer: true }`; cualquier otra modalidad escribe `resto_al_barrer = false` (lo exige el check). `database.types.ts` sigue viendo `modalidad_tratamiento: string | null` más el booleano. **Alternativa descartada** (y registrada por si Javier prefiere la columna "pura"): aplicar a mano en el SQL Editor un `drop constraint` y recrearlo con tres valores, como la `0012` se aplicó a mano; no se recomienda porque dejaría una migración del repositorio que no reproduce la base.

**Qué pasa con las asignaciones existentes.** Nada se borra ni se mueve: `marca_gml_especial` no cambia. Una marca `barrido` con GML ignorados (`marca_en_barrido`) que pasa a mixta ve esas asignaciones **vigentes** (compras específicas); una `por_gml` que pasa a mixta conserva las suyas; una mixta que vuelve a `barrido` las conserva ignoradas (la API pone `resto_al_barrer = false` en la misma escritura, para no violar el check). `motivoPendiente` suma `mixta_sin_gml` (mixta sin GML vigentes: se comporta como al barrer y se persigue).

### 6.2 Cambio en `claveFlujo` (código, sin migración) y en la vista

`claveFlujo` (regla 12 de 02b) gana una fila en su tabla: **unidad marcada y vigente, `mixta`, no relevante en este GML → `{ tipo: "barrido", marca_id }`**; relevante en este GML → fila de la marca, como `por_gml`. La partición sigue completa y disjunta (test de 02b ampliado). La vista `marca_gml_especial_vigente` se reemplaza con `create or replace view` (mismas columnas, mismo orden) para que una mixta aparezca **dos veces**: una fila con `modalidad = 'mixta'` y GML nulo (su flujo al barrer) y una fila por GML vigente con `modalidad = 'mixta'`; el `where` de la primera rama pasa a `coalesce(m.modalidad_tratamiento, 'barrido') = 'barrido' or m.resto_al_barrer`, y la segunda deja de exigir `not resto_al_barrer` (no lo exigía). `GET /api/marcas/gml-especial/vigentes` suma `mixtas[]` junto a `barrido[]`. **Efecto en M7**: `participaciones_historicas.por_clave_flujo` de las filas base pasa a tener, para una mixta, una clave `barrido` con su `marca_id` en los GML donde no es relevante; M7 no cambia código (usa `claveFlujo`), pero las proyecciones en trabajo quedan `desactualizada` con motivo `config_cambiada` (se añade a `motivosDesactualizada`) y una cerrada no se toca. Por eso **este cambio debe estar construido antes de la primera proyección cerrada que lea M8**.

### 6.3 `repartos_marca_barrido` (una versión por aprobación; la vigente es el contrato con M8)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `marca_id` | `uuid not null → marcas on delete restrict` | la **unidad** (cabeza o suelta); la API rechaza un miembro (`409 marca_en_conjunto`) y una marca que no sea `barrido` ni `mixta` (`409 modalidad_no_barrer`) |
| `version` | `integer not null` | único `(marca_id, version)`; la API asigna `max + 1` |
| `vigente` | `boolean not null default true` | **único parcial `(marca_id) where vigente`**: una vigente por marca; aprobar una nueva pone la anterior en `false` (escritura de la API, como `curvas_estacionalidad`) |
| `ventana_meses` | `integer not null` | `check in (12, 24, 36)` |
| `modo` | `text not null` | `check in ('anual', 'por_mes')` |
| `hasta_periodo` | `date not null` | el `k` con que se calculó (primer día de mes) |
| `normaliza_nino` | `boolean not null default true` | |
| `huella_cargas`, `huella_config` | `text not null` | regla 9 |
| `factores_usados` | `jsonb not null default '[]'` | `[{ anio, temporada, ratio }]` |
| `share_barrido` | `numeric(6,4) null` | regla 7, informativo |
| `eat_pp` | `numeric(6,2) null` | regla 5, informativo |
| `nota` | `text null` | `≤ 300` |
| `aprobada_por_id → perfiles set null`, `aprobada_por_nombre`, `aprobada_at` | | |
| `activo`, `created_at`, `updated_at` | | `activo` por convención |

Índice `(marca_id, vigente)`.

### 6.4 `reparto_marca_barrido_gml` (las filas de cada versión)

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `reparto_id → repartos_marca_barrido on delete cascade` | | índice por `reparto_id` |
| `genero_mundo_linea_id` | `uuid not null → genero_mundo_linea restrict` | |
| `equivalencia_id` | `uuid null → equivalencias restrict` | no nulo solo si el nodo era `GMLE` al aprobar |
| `mes` | `integer null` | `check between 1 and 12`; `null` en modo `anual`; único `(reparto_id, genero_mundo_linea_id, equivalencia_id, mes)` (con `coalesce` en un índice único de expresión) |
| `unidades_ventana` | `integer not null default 0` | `Σ ũ` de la fila (informativo) |
| `participacion_calculada` | `numeric(7,4) not null` | `check between 0 and 1` |
| `participacion_ajustada` | `numeric(7,4) null` | `null` = sin ajuste |
| `participacion_vigente` | `numeric(7,4) not null` | `= coalesce(ajustada, calculada)`; la suma por `(reparto_id, mes)` = 1 ± 0,0005 la verifica la API (un `check` no cruza filas) |
| `activo`, `created_at`, `updated_at` | | |

### 6.5 Función `venta_marca_gml(p_marca_ids uuid[], p_desde date, p_hasta date) returns jsonb`

La única lectura de venta de M12, en una sentencia: agrega `venta_stock_vigente` entre `p_desde` y `p_hasta` (periodo ≤ `k`), **solo tiendas de tipo Tienda**, uniendo `marcas_unidad` (ALFA JEANS suma en ALFA) y `equivalencias` → nodo. `p_marca_ids` son **unidades**; devuelve:

```jsonc
{ "hechos":  [ { "unidad_marca_id", "gml_id", "equivalencia_id", "agrupacion_talla_id", "periodo": "2026-09-01", "unidades": 310, "venta_soles": 24800.00 } ],   // solo las unidades pedidas; equivalencia siempre (la clave la aplica TS según el nivel)
  "totales": [ { "gml_id", "equivalencia_id", "periodo", "unidades": 4120 } ],                                  // U_{g,m}: todos los GML/equivalencias donde las unidades pedidas tienen venta, TODAS las marcas
  "cargas":  { "2024-10": "<carga_id>", … } }                                                                   // huella, como 0017
```

Tamaño: una marca × ~15 unidades × 36 meses ≈ 500 filas de hechos y ~600 de totales; la lista completa (30 marcas, 24 meses) cabe en una llamada (< 2 MB). Si el hito midiera más de 3 s por marca, se precalcula por mes con una tabla de agregados (`0020`+), sin cambiar la API. **Sin `UPDATE` ni escritura** en la función.

### Diagrama

```
marcas (tratamiento_especial, modalidad_tratamiento, resto_al_barrer) ─► modalidadEfectiva: por_gml | barrido | mixta ─┐
marca_gml_especial (GML específicos; vigentes también en mixta) ───────────────────────────────────────────────────────┤
marcas_unidad (cabeza del conjunto) ────────────────────────────────────────────────────────────────────────────────────┼─► claveFlujo (02b + mixta): barrido | unidad(marca) | otras
venta_stock_vigente ─► venta_marca_gml(unidades, W) ─► hechos + totales ──────────────────────────────────────────────┘        │
factores_volumen_atipico + periodos_atipicos ─► factoresMes (M7) ─► ũ = u ÷ φ ─────────────────────────────────────────────────┤
curvas vigentes (M6) + curvaUnidad (02b) ─► estacionalidad del GML para la marca ──────────────────────────────────────────────┤
                                                                                     analizarMarca (TS puro, a demanda) ◄──────┘
                                                                                                 │ p1, p2, estacionalidad, tendencia, share_barrido, avisos
                                                                                      planner ajusta y aprueba ─► repartos_marca_barrido (vigente, versión) + reparto_marca_barrido_gml ─► M8 (compras al barrer)
```

## 7. Contratos de API y de lógica pura

Convenciones de M1 a M7: `ok` / `error` / `leerCuerpo` / `idDeRuta` (`src/lib/api/respuestas.ts`), `errorConCodigo` para `409` con código, `traducirErrorDb`, `leerTodo` por tandas de 1 000 con `TANDA_IN = 150`. Handlers en `src/app/api/marcas-barrer/`; lógica pura en `src/lib/marcas-barrer/` (`tipos-api.ts`, `tipos.ts`, `esquemas.ts`, `clasificar.ts`, `reparto.ts`, `estacionalidad.ts`, `tendencia.ts`, `huellas.ts`, `reglas.ts`, `excel.ts`, `modelo.ts`); datos solo en `consultas.ts` (único archivo que nombra `venta_marca_gml`). **Toda ruta `requirePlanner`; ningún `GET` escribe.** Errores: `401` · `403` · `400` zod · `404` · `409` regla · `500`.

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/marcas-barrer` | GET | `?ventana=24&modo=anual` | `{ datos: { hasta_periodo, ventana, modo, cargas: n }, marcas: MarcaBarrerResumenApi[], resumen: { marcas, sin_reparto, obsoletas, mixtas, unidades_barrer } }`. Calcula a demanda la lista entera con una llamada a la función (cache en memoria por huella, como 06b) |
| `/api/marcas-barrer/[marcaId]` | GET | `?ventana=&modo=&normaliza_nino=1` | `AnalisisMarcaApi` (secciones 1 a 4 de la pantalla, `calculado` por GML, `vigente` con su versión y la comparación, `avisos`, `obsoleto: Motivo[]`, `huella`); `404` si la marca no existe o no es unidad; `409 modalidad_no_barrer` |
| `/api/marcas-barrer/[marcaId]/repartos` | GET | — | `RepartoApi[]` (todas las versiones, con filas) |
| `/api/marcas-barrer/[marcaId]/repartos` | POST | `aprobarRepartoSchema = { ventana_meses: 12\|24\|36, modo: 'anual'\|'por_mes', normaliza_nino: boolean, huella: string, filas: [{ genero_mundo_linea_id: uuid, equivalencia_id?: uuid\|null, mes?: 1..12\|null, participacion_ajustada: number 0..1 \| null }], nota?: ≤ 300 }` | `201 RepartoApi` (versión nueva vigente; la anterior deja de serlo); `409 huella_cambiada` (lo que el planner vio ya no es lo que se calcularía: recarga), `409 suma_invalida`, `409 nota_requerida`, `409 modalidad_no_barrer`, `409 marca_en_conjunto` |
| `/api/marcas-barrer/vigentes` | GET | `?marca_ids=` | **Contrato de M8**: `{ repartos: [{ marca_id, reparto_id, version, modo, filas: [{ gml_id, equivalencia_id, mes, participacion }] }], sin_reparto: uuid[] }` (solo vigentes). En código, `leerRepartosVigentes(db, marcaIds)` de `consultas.ts` |
| `/api/marcas/[id]` (M2, PATCH) | ampliado | `modalidad_tratamiento: z.enum(['por_gml','barrido','mixta'])` | normaliza a `(modalidad_tratamiento, resto_al_barrer)` (regla 10); respuesta con `modalidad_efectiva` y `avisos` (`mixta_sin_gml`, `reparto_obsoleto`) |
| `/api/marcas/gml-especial/vigentes` (02b) | ampliado | — | suma `mixtas: [{ marca_id, marca, agrupacion_marca_id, gml: [...], miembros }]` |

```ts
export type ModalidadEfectiva = "por_gml" | "barrido" | "mixta";
export type AvisoBarrer = "sin_venta_barrer" | "ventana_corta" | "sin_anio_completo" | "curva_incompleta" | "sin_factor" | "red_no_comparable" | "mixta_sin_gml" | "nivel_cambiado" | "sin_reparto";
export type MotivoObsoleto = "cargas_nuevas" | "config_cambiada" | "nivel_cambiado" | "ventana_distinta";
export type FilaRepartoApi = { gml_id: string; equivalencia_id: string | null; mes: number | null; ruta: string; nivel: "GML" | "GMLE"; unidades_ventana: number;
  p1_ventana: number | null; p1_anual: { anio: number; valor: number | null; completo: boolean }[]; p1_mensual: { anio: number; meses: (number | null)[] }[];
  tendencia: number | null; p2_calculado: number; p2_vigente: number | null; p2_ajustado_vigente: number | null; es_especifico: boolean };
export type AnalisisMarcaApi = { marca: { id: string; nombre: string; modalidad: ModalidadEfectiva; agrupacion_marca: string; miembros: string[]; gml_especificos: { gml_id: string; ruta: string }[] };
  parametros: { ventana_meses: 12 | 24 | 36; modo: "anual" | "por_mes"; normaliza_nino: boolean; hasta_periodo: string; desde_periodo: string; factores: { anio: number; temporada: string; ratio: number | null }[] };
  filas: FilaRepartoApi[]; share_barrido: number; unidades_barrer: number; unidades_especificas: number;
  estacionalidad: { propia: number[] | null; gml: number[] | null; eat_pp: number | null; veredicto: "similar" | "dudosa" | "distinta" | null; anios_completos: number[] };
  tendencia_total: number | null; vigente: { reparto_id: string; version: number; aprobada_at: string; aprobada_por_nombre: string | null; nota: string | null } | null;
  obsoleto: MotivoObsoleto[]; avisos: AvisoBarrer[]; huella: string };
```

Constantes (`tipos.ts`): `VENTANAS = [12, 24, 36]`, `VENTANA_DEFECTO = 24`, `MODO_DEFECTO = 'anual'`, `MIN_OBS_POR_MES = 2`, `EAT_SIMILAR = 6`, `EAT_DISTINTA = 10`, `TOLERANCIA_SUMA = 0.0005`, `VERSION_METODO_BARRER = 1`.

| Función pura | Archivo | Reglas |
|---|---|---|
| `clasificarHechos(hechos, configFlujo)` → `{ u, e, U }` por `(g, m)` | `clasificar.ts` | 1, 2 |
| `repartoAnual(u, φ)`, `repartoPorMes(u, φ, n)`, `renormalizarResto(filas, editadas)`, `puedeAprobar(filas, nota, parametros)` | `reparto.ts` | 3, 4, 8, 11 |
| `estacionalidadPropia(u, φ, aniosCompletos)`, `estacionalidadGml(p2, curvas)`, `eat(a, b)`, `veredicto(eat)` | `estacionalidad.ts` | 5 |
| `tendencia(serie, aniosCompletos)` | `tendencia.ts` | 6 |
| `huellaConfig(marca, gmlVigentes, miembros, niveles, parametros)`, `motivosObsoleto(vigente, actual)` | `huellas.ts` | 9, 12 |
| `modalidadEfectiva` (ampliada en `src/lib/marcas/reglas.ts`), `normalizarModalidad(entrada)` → `(modalidad_tratamiento, resto_al_barrer)`, `motivoPendiente` (+ `mixta_sin_gml`) | `src/lib/marcas/reglas.ts`, `src/lib/marcas/gml/reglas.ts` | 10 |
| `claveFlujo` (ampliada) | `src/lib/marcas/gml/flujo.ts` | 13 |
| `analizarMarca(entrada)` determinista | `modelo.ts` | 14 |
| `hojasMarcasBarrer(lista)`, `hojasMarca(analisis)` | `excel.ts` | 15 |

## 8. Reglas de negocio (vitest, funciones puras salvo donde se indica)

1. **Universo.** Solo tiendas de tipo Tienda y cargas publicadas; el CD no entra en `u`, `e` ni `U` (test con fixture: un hecho en el CD no cambia nada).
2. **Partición.** Para cada `(g, m)`: `u + e + resto = U`; un hecho de un miembro (BETA UNO) cuenta en la unidad (BETA).
3. **`p2` anual** suma 1 (± 1e-9) sobre los GML con `u > 0`; un GML específico de una mixta tiene `p2 = 0`; sin `u` en la ventana → `null` + `sin_venta_barrer`; con `φ` de unos, `p2` iguala el reparto en unidades crudas.
4. **`p2` por mes**: doce vectores que suman 1 cada uno; con `n = 12` o un mes con una sola observación → cae a `anual` con `ventana_corta` (el resultado trae `modo_efectivo`).
5. **Estacionalidad**: `propia` suma 1 y usa solo años completos; `gml` es la mezcla por `p2` de `curvaUnidad` (una `g` sin curva renormaliza y avisa); `eat` de dos curvas iguales = 0 y de dos disjuntas = 100; veredicto por umbrales.
6. **Tendencia**: dos años completos → ratio − 1; un solo año → `null`; todo normalizado por `φ`.
7. **Parte al barrer**: `barrido` → `share = 1`; mixta con `u = 600`, `e = 400` → 0,6; mixta sin GML vigentes → 1 y `mixta_sin_gml`.
8. **Ajuste**: `renormalizarResto([41, 30, 17, 12] con la primera editada a 50)` → `[50, 25,4, 14,4, 10,2]` (proporcional, suma exactamente 100, residuo a la mayor no editada); todas editadas y suma ≠ 100 → `puedeAprobar = false` con motivo `suma_invalida`; ajuste sin nota → `nota_requerida`.
9. **Huellas**: cambiar la modalidad, un GML vigente, un miembro del conjunto, el nivel de una `g` con venta, la ventana o el modo cambia `huella_config`; publicar un mes dentro de la ventana cambia `huella_cargas`; `motivosObsoleto` devuelve el motivo exacto y vacío si nada cambió.
10. **Modalidad (M2)**: `normalizarModalidad('mixta')` → `{ por_gml, resto_al_barrer: true }`; `'por_gml'` o `'barrido'` → `resto_al_barrer: false`; `modalidadEfectiva({ casilla, 'por_gml', resto_al_barrer: true })` = `mixta`; sin casilla → `null` aunque la bandera esté encendida (la API apaga la bandera al apagar la casilla); `motivoPendiente` de una mixta con 0 GML vigentes = `mixta_sin_gml`.
11. **Aprobar** (API, probada con el handler y la fixture): crea `version = max + 1`, pone `vigente = false` en la anterior **antes** de insertar (si el `insert` falla, la marca queda sin vigente y la pantalla lo muestra: repetir arregla; sin transacción, criterio M6); `huella` del cuerpo distinta de la calculada → `409 huella_cambiada` sin escribir; `participacion_vigente = coalesce(ajustada, calculada)`; la suma por mes = 1 ± `TOLERANCIA_SUMA`.
12. **Obsoleto no recalcula**: el reparto vigente no cambia al publicar un mes ni al cambiar la modalidad; solo se marca.
13. **`claveFlujo` con mixta**: hecho de GAMMA en un GML donde es relevante → `{ unidad, marca_id: GAMMA }`; en otro GML → `{ barrido, marca_id: GAMMA }`; GAMMA `por_gml` (bandera apagada) en ese otro GML → `{ unidad, marca_id: null }` (otras); la partición sigue completa y disjunta (la prueba de 02b se amplía con la mixta); `textoClaveFlujo` no cambia.
14. **Determinismo**: misma entrada → misma salida (igualdad profunda); la entrada no se muta; `VERSION_METODO_BARRER` entra en `huella_config`.
15. **Excel = pantalla**: `hojasMarcasBarrer` devuelve las filas visibles con los filtros; `hojasMarca` las cuatro hojas de la marca; cabeceras de meses `aaaa-mm`; `null` → celda vacía; SheetJS solo en el componente con `import()` dinámico.
16. **SQL (humo local)**: `0019` aplica dos veces; `marcas_resto_al_barrer_check` rechaza `resto_al_barrer = true` con modalidad `barrido` o nula; el único parcial rechaza dos vigentes de la misma marca; `venta_marca_gml` excluye el CD y suma miembros en la cabeza; `anon` no ejecuta la función ni lee las tablas; la vista reemplazada devuelve dos filas para una mixta con un GML vigente.
17. **Estático**: solo `consultas.ts` nombra `venta_marca_gml`; `src/lib/marcas-barrer/` no importa de `@supabase/*` ni de componentes; toda ruta bajo `/api/marcas-barrer` usa `requirePlanner`; `nav.ts` marca el item con `PLANIFICACION`; ningún `GET` escribe.

## 9. Casos sintéticos (`tests/marcas-barrer.fixture.ts`)

Árbol: `HOMBRE · URBANO · DENIM` (GML; curva plana), `HOMBRE · CASUAL · POLO` (GML; "POLO HO", verano, curva `[.14,.12,.08,.04,.03,.02,.02,.03,.08,.12,.14,.18]`), `MUJER · CASUAL · SANDALIA` (GML; verano), `HOMBRE · FORMAL · CAMISA` (GMLE con equivalencias MANGA LARGA y MANGA CORTA, "CAMISA HO", invierno). Marcas: BETA (PREMIUM, `barrido`; conjunto con BETA UNO), GAMMA (RECONOCIDO, mixta: relevante en CAMISA), DELTA (VALOR, `barrido`, sin venta en la ventana), ALFA (RECONOCIDO, `por_gml`, relevante en DENIM: no se analiza). Tiendas T01, T02 y el CD. Periodos del Niño 2026 (invierno año completo; verano set–dic), factores invierno 2026 = 0,66, verano 2026 = 1,24. `k = 2026-09`, ventana 24 (oct-2024 → set-2026).

1. **Clasificación**: BETA 100 u/mes en DENIM (T01) + 50 en POLO (T02) + BETA UNO 20 en SANDALIA + 30 u/mes de BETA en el CD → `u` = {DENIM 2 400, POLO 1 200, SANDALIA 480}; el CD no cuenta; `U_DENIM` incluye ALFA y "otras".
2. **`p2` anual** de BETA con `φ = 1` en DENIM (toda temporada) y `φ_{2026,set} = 1,24` en POLO y SANDALIA (verano): POLO `ũ = 1 200 − 50 + 50 ÷ 1,24 = 1 190,3`; SANDALIA `480 − 20 + 20 ÷ 1,24 = 476,1`; `p2 = [0,590; 0,293; 0,117]` (cerrado en el fixture); con `normaliza_nino = false` → `[0,588; 0,294; 0,118]`.
3. **`p1`**: DENIM con `U = 1 220/mes` → `p1 = 8,2 %`; un mes con `U = 0` → `null`.
4. **Mixta GAMMA**: 40 u/mes en CAMISA › MANGA LARGA (relevante → `e`), 60 u/mes en DENIM (→ `u`): `share_barrido = 0,6`; `p2` = {DENIM 1,0}; CAMISA no aparece en el reparto (`es_especifico = true`, `p2 = 0`); al apagar la bandera (`por_gml`), DENIM de GAMMA pasa a "otras" y `GET /api/marcas-barrer/GAMMA` → `409 modalidad_no_barrer`.
5. **Por mes** con 24 meses: cada vector suma 1; con ventana 12 → `modo_efectivo = anual` y `ventana_corta`.
6. **Estacionalidad**: BETA plana en DENIM y de verano en POLO/SANDALIA → `propia` intermedia; `gml` = `0,59 × plana + 0,41 × verano`; `EAT` ≈ 0 (cerrado en el fixture, porque la propia se construyó con esas mismas curvas); forzar BETA con pico en junio → `EAT > 10` y `distinta`.
7. **Tendencia**: 2025 = 2 040, 2024 completo no está en la ventana de 24 meses (empieza en oct-2024) → `null`; con ventana 36 → 2025 ÷ 2024 − 1.
8. **Ajuste y aprobación**: editar DENIM a 0,50 → `renormalizarResto` → POLO 0,357, SANDALIA 0,143; `POST` sin nota → `409 nota_requerida`; con nota → `v1` vigente con `participacion_vigente` = ajustado; `POST` otra vez con la misma huella → `v2`, `v1.vigente = false`; publicar oct-2026 → `obsoleto = ["cargas_nuevas"]` y `POST` con la huella vieja → `409 huella_cambiada`.
9. **DELTA** sin venta → `sin_venta_barrer`, `filas = []`, aprobar → `409 suma_invalida`; en la lista, estado "Sin reparto".
10. **Vigentes para M8**: `GET /api/marcas-barrer/vigentes?marca_ids=BETA,GAMMA,DELTA` → BETA v2, GAMMA (si aprobada), `sin_reparto = [DELTA]`.
11. **Vista SQL**: GAMMA mixta → dos filas en `marca_gml_especial_vigente` (`gml null`, `modalidad = 'mixta'`; `gml = CAMISA`, `modalidad = 'mixta'`); BETA → una (`barrido`); ALFA → una por GML (`por_gml`).
12. **M7 desactualizada**: una proyección en trabajo con `huella_config` previa a pasar GAMMA a mixta → `motivosDesactualizada` incluye `config_cambiada`; una cerrada no cambia.

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todas más `tests/marcas-barrer.*` y la ampliación de `tests/marcas.gml.*` con la mixta), `npm run build`, `scripts/validar-migraciones-local.sh`; `0019` aplicada en `vector-two`; tipos regenerados; `APP_VERSION = 0.11.0 · M12`.

**Prerrequisitos de Javier** · Lista real de marcas con tratamiento especial cargada (M2) con sus conjuntos y la hoja de GML (02b); al menos 24 meses publicados; factores del Niño sincronizados en M7; curvas vigentes en las agrupaciones de las líneas donde venden las marcas al barrer; decidir qué marcas son mixtas y en qué GML.

**Hito en navegador (sección G de `cowork-checklist.md`, usuario planner; ✍️ = pedir confirmación a Javier)**
1. Como comprador: "Marcas al barrer por GML" no aparece en el menú, la URL redirige y `GET /api/marcas-barrer` responde `403`.
2. La lista carga en menos de 3 s con todas las marcas al barrer y mixtas, sus unidades de 24 meses y el estado (sin reparto / al día / obsoleto); anotar cuántas hay de cada modalidad.
3. Abrir la marca al barrer de mayor volumen: el bloque 1 muestra sus GML con `p2`, `p1` y tendencia; cambiar la ventana a 12 y a 36 y ver que `p2` se mueve y que la URL lo conserva; en una marca que vende en líneas de invierno, la cabecera dice "÷ 0,66" y las cifras normalizadas difieren de las crudas al apagar "Normalizar el Niño".
4. Bloque 2: elegir un GML y ver la tabla año × mes de `p1`; cambiar a gráfico.
5. Bloque 3: la estacionalidad propia y la del GML se ven en el mismo gráfico con la EAT y el veredicto; en una marca claramente de temporada, el veredicto tiene sentido para Javier.
6. ✍️ Aprobar el reparto calculado de una marca (sin ajuste): queda "v1 · al día"; editar un GML al alza, pulsar "Renormalizar el resto", escribir una nota y aprobar v2; "Comparar v2 con lo calculado hoy" muestra las dos columnas.
7. ✍️ Pasar una marca al barrer con GML asignados a **Mixta** desde la cabecera: el `confirm` enumera sus GML; después, el bloque 4 muestra la parte específica y la parte al barrer y el reparto vigente aparece obsoleto (`config_cambiada`); volver a dejarla como estaba.
8. En Marcas (M2), el `Select` de modalidad ofrece Mixta y la pestaña "Marcas relevantes por GML" cuenta las mixtas.
9. `GET /api/marcas-barrer/vigentes` devuelve los repartos aprobados en el paso 6 con su versión.
10. Excel de la lista y de una marca: las hojas y las filas coinciden con la pantalla y los filtros.
11. Javier revisa tres marcas que conoce: el reparto calculado se parece a cómo las compra; donde no, anota qué ventana o ajuste lo acerca (insumo de la pregunta 2).

## 11. Alcance

**Primera entrega (`0.11.0 · M12`)**: modalidad `mixta` (columna `resto_al_barrer`, `modalidadEfectiva`, zod, `Select`, `claveFlujo`, vista reemplazada, `vigentes` con `mixtas`, `config_cambiada` en M7); lista y análisis por marca (`p1` por mes y año, `p2` anual y por mes, estacionalidad propia frente a la del GML con EAT, tendencia, parte al barrer frente a específica); ventana 12/24/36, normalización del Niño; ajuste por GML con renormalización, aprobación versionada con huellas y obsolescencia; `GET …/vigentes` para M8; Excel en el navegador.

**Segunda entrega (`0.11.1 · M12`)**: tendencia y `p1` sobre mismas tiendas (bloques de M7); reparto por agrupación de talla (hoy M8 usa la participación por talla de M7); reparto por tienda (hoy no hace falta: M8 fluye CD + tiendas); "agregar GML sin venta" al reparto (pregunta 4); sugerencia automática de qué marcas deberían ser mixtas (marcas al barrer con un GML dominante por encima de un umbral); comparación de versiones lado a lado con las compras que usaron cada una (necesita M8).

**Fuera de alcance**: registrar compras, repartir compras concretas o mostrar el flujo (M8); cambiar M5, M3 ni M6; decidir el volumen de la marca (M7); relevancia por equivalencia (sigue por GML, pregunta 13 de 02b).

## 12. Riesgos

- **Ventana y Niño**: con 24 meses hasta set-2026 la ventana incluye todo el invierno Niño de 2026 y un solo invierno normal; la normalización por `φ` corrige el volumen, no la mezcla de GML (si en año Niño BETA vendió más en sandalias que en casacas, `p2` lo hereda). La pantalla muestra `p2` con y sin normalización y la ventana de 36 meses como contraste.
- **Marcas pequeñas**: con pocas unidades `p2` es ruidoso; el bloque 1 muestra las unidades por GML y Javier ajusta; no hay suavizado automático (segunda entrega si hace falta).
- **Mixta sin GML**: se comporta como al barrer y se persigue como pendiente; si Javier marca muchas mixtas antes de asignar GML, M8 las repartirá entero al barrer hasta que asigne.
- **El cambio de `claveFlujo` toca M7**: participaciones distintas para las mixtas; si M7 ya tiene una cerrada que M8 lee, hay que cerrar una nueva tras construir M12 (por eso el orden M12 → M8).
- **Sin transacción al aprobar**: igual que M6; visible y reparable repitiendo.
- **Representación de `mixta` con dos columnas**: cualquier lectura directa de `modalidad_tratamiento` fuera de `modalidadEfectiva` vería `por_gml`; la prueba estática exige que ningún archivo bajo `src/` compare `modalidad_tratamiento` con un literal fuera de `src/lib/marcas/reglas.ts`.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M12: las marcas al barrer se reparten a los GML con un reparto estadístico aprobado y versionado, que M8 usa sin recalcular.** Por qué: una compra confirmada no debe cambiar de GML sola. Descartado: calcular `p2` al vuelo en M8; repartir por tienda.
2. **M12: la modalidad `mixta` se representa como `por_gml` + `resto_al_barrer`, sin tocar el check de `0010`.** Por qué: ampliar el check exige `drop constraint`, prohibido en las migraciones; y una mixta es relevante en sus GML con el resto al barrer. Descartado: `drop constraint` a mano en el SQL Editor; columna de modalidad nueva; "barrido + GML asignados = mixta" implícito (cambiaría en silencio marcas que hoy tienen GML ignorados).
3. **M12: en `claveFlujo`, la venta de una mixta fuera de sus GML va al flujo al barrer, no a "otras".** Por qué: es lo que la hace mixta. Descartado: un cuarto tipo de clave.
4. **M12: ventana por defecto de 24 meses, modo anual, normalización del Niño por mes con los factores de M7.** Supuesto a validar (pregunta 2).
5. **M12: el análisis se calcula a demanda y no se guarda; se guarda la foto de cada aprobación** (criterio 06b). Descartado: tabla de agregados por marca × GML × mes (solo si el hito mide más de 3 s).
6. **M12: la modalidad `mixta` desactualiza las proyecciones en trabajo de M7 con `config_cambiada`; una cerrada no cambia.**

**Cambios que integra el `documentador`**: PLAN §4 (columna `marcas.resto_al_barrer`, tablas `repartos_marca_barrido` y `reparto_marca_barrido_gml`, función `venta_marca_gml`, migración `0019`, versión `0.11.0 · M12`; diagrama: `claveFlujo` con mixta), PLAN §5 (fila nueva M12 entre M7 y M8; M8 "consume el reparto vigente de M12"), PLAN §7 (pendiente: qué marcas son mixtas y en qué GML), ficha 02b (modalidad con tres valores; vista con dos filas por mixta; regla 12 ampliada; pregunta 12 resuelta: fuera de "mi flujo de Jeans" en la vista de 02b, dentro de la fila GML-AM de M7), ficha 07 (`config_cambiada` en `motivosDesactualizada`; participaciones con `barrido` + `marca_id` de mixtas), `cowork-checklist.md` sección G, `nav.ts`.

## 14. Preguntas para Javier (cinco; mientras tanto rige la recomendación)

1. **Grano de la parte específica de una mixta.** ¿Los GML específicos se definen por GML (como las marcas relevantes de 02b; si el nodo es GMLE, aplican a todas sus equivalencias) o necesitas marcar una sola equivalencia de un nodo como específica? **Recomendación: por GML, reutilizando `marca_gml_especial` tal cual; las compras sí se registran por GMLE (M9). Si necesitas una equivalencia suelta, es la pregunta 13 de 02b y una columna más.**
2. **Ventana y modo del reparto.** ¿24 meses y un reparto anual por GML, o prefieres 12 meses, o un reparto por mes del año para marcas cuya mezcla cambia con la temporada? **Recomendación: 24 meses y anual por defecto, con `por_mes` disponible por marca; lo valida el paso 11 del hito.**
3. **Normalización del Niño en el reparto.** ¿Se dividen los meses atípicos por el factor de M7 antes de calcular el reparto (recomendado: sí, con la cifra cruda al lado), o se usan las unidades tal cual?
4. **GML sin venta en el reparto.** Si vas a llevar una marca al barrer a una línea donde no ha vendido, ¿quieres poder agregarle un GML con un porcentaje manual (segunda entrega), o basta con esperar a que venda? **Recomendación: esperar; agregar GML sin venta queda en `0.11.1`.**
5. **Representación de `mixta`.** ¿Aceptas que la base la guarde como `por_gml` + `resto_al_barrer` (la pantalla y la API dicen "Mixta" en todas partes), o prefieres que `datos` aplique a mano un `drop constraint` en el SQL Editor para que la columna admita `mixta` literal? **Recomendación: la columna nueva; evita una migración que el repositorio no reproduce.**

# M13 · Intercompany: rango IMI por marca × GML (4–8 por defecto, editable) y reposición directa

> Estado: **especificada el 2026-10-15 y ajustada el mismo día con el informe del `arquitecto-revisor` (opus), la ronda 3 y la ronda 4 de Javier (decisiones 27, 29 y 30 de `08-09-definiciones-del-dueno.md`, que prevalecen: la "cobertura esperada" de esta ficha es el **rango IMI de la marca**, 4–8 por defecto y editable por marca; VAN HEUSEN entra desde ahora; los ingresos reales del intercompany directo salen de la conciliación de inventarios de M8); pendiente de aprobación por Javier.** Recoge las decisiones 6, 10, 15, 16 y 17: para las marcas intercompany (**JOHN HOLDEN + JOHN = JH**, **DONATELLI** y **VAN HEUSEN**; sin UNDERWEAR, WOMAN ni DONNA) y dentro de cada GML de **hombre formal, casual y RI**, qué parte de la venta llega **directo del intercompany por compras regulares** y qué **rango IMI** (mínimo y máximo en meses de inventario; **4–8 por defecto**, editable) debe tener esa marca en ese GML. Es un módulo propio, pequeño, que alimenta el flujo de M8. Migración prevista **`0021_intercompany.sql`** (la `0018` es de M7, ya aplicada; la `0019` es de `0.10.1 · M7`; la `0020` es de M12; se confirma al construir); versión prevista **`0.12.0 · M13`**, después de `0.11.0 · M12` y antes de `0.13.0 · M8`; commits con prefijo `M13:`. Depende de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (marcas relevantes por GML, conjuntos, `marcas_unidad`), [01-arbol-producto](01-arbol-producto.md) (nodos) y [07-proyeccion-anual](07-proyeccion-anual.md) (`participaciones_historicas.por_marca` desde `0.10.1`, con `por_clave_flujo` como respaldo: por donde M8 sabe cuánto de un GML-AM es JH). Lo consume [08-flujo-y-compras](08-flujo-y-compras.md) (subflujo por marca intercompany). Toda la API es `requirePlanner`. Sin datos reales: los porcentajes, coberturas y nodos de los ejemplos son inventados.

## 1. Objetivo

Parte de la venta de JH, Donatelli y VH en las líneas de hombre formal, casual y RI no pasa por nuestro centro de distribución: llega a las tiendas **directo del intercompany** por compras regulares (reposición continua). Si M8 tratara a esas marcas como a cualquier otra, con el objetivo general de 4 a 8 meses y sin contar que una parte se repone sola, pediría comprar lo que ya llega por su cuenta. La primera versión de esta ficha descontaba esa parte de la **demanda**; el revisor mostró (B2) que el **stock** de esas marcas en las tiendas incluye lo que llegó directo, de modo que se comparaba un stock completo contra una demanda recortada y la cobertura salía inflada. Javier no quiere tampoco restar del stock la parte directa: quiere **una cobertura esperada intercompany en el flujo**. Este módulo guarda, por **marca × GML** (o GMLE) y con **vigencia en el tiempo**, (a) el **rango IMI** de la marca en ese GML (mínimo y máximo en meses de inventario; **por defecto el mismo 4–8 general, editable por marca y GML**: Javier, ronda 4, decisión 29) y (b) el **porcentaje que llega directo** por compras regulares, que M8 usa como **reposición directa esperada** (un ingreso esperado, no un recorte de demanda ni de stock). M8 lleva para esas marcas un **subflujo** dentro de la fila GML-AM con demanda completa, stock completo y objetivo propio. Se mantiene a mano (no hay dato de origen de la mercadería en M5), con historial y avisos cuando la configuración de 02b o la cerrada de M7 no permiten aplicarlo.

## 2. Decidido por Javier (2026-10-15)

1. **Módulo propio de intercompany** para las líneas de hombre: qué porcentaje de la venta viene directo del intercompany por compras regulares y cuánto sale del CD (decisión 6), **por GML y marca** (decisión 10).
2. Las compras que el administrador de producto hace **directo del CD intercompany** son otra cosa: son **ingresos al CD** y se registran como compras en M9 (decisión 5a). Este módulo no las toca.
3. **El stock del intercompany directo no se resta** (ronda 3, decisión 15): para las marcas con regla, el flujo usa una **cobertura esperada propia** por marca y GML en vez de un cálculo sobre stock neto o demanda neta.
4. **Marcas** (decisión 16): JOHN HOLDEN, JOHN, DONATELLI y VAN HEUSEN; JH es el conjunto JOHN HOLDEN + JOHN (cabeza JOHN HOLDEN) y **no** incluye UNDERWEAR, WOMAN ni DONNA. VAN HEUSEN hoy no tiene tratamiento especial en 02b: **se recomienda marcarla**, pero desde `0.10.1` la aplicabilidad sale del eje `por_marca` de la cerrada y no lo exige (sección 3, "Aplicable").
5. **Ámbito** (decisión 17): hombre **formal, casual y RI**.
6. **Rango IMI por marca** (ronda 4, decisión 29): el rango general es 4–8; JH, Donatelli y Van Heusen usan por ahora ese rango, con parámetros **editables por marca** (reemplaza los rangos propios fijos de la primera versión de esta ficha: ya no hay "2–4" por defecto).
7. **Van Heusen desde ahora** (decisión 30): tratamiento especial **parametrizable** en este módulo antes de la próxima proyección cerrada; sus reglas se crean con el rango por defecto y el % directo que Javier entregue.
8. **Ingresos reales del intercompany directo** (decisión 27): salen de la **conciliación de inventarios** de M8 (`Ing^B_m = S^B_m − S^B_{m−1} + V^B_m` por marca, a nivel cadena), no de compras registradas; M8 devuelve a este módulo el **% directo observado** como referencia al lado del `pct_directo` de la regla.

Supuestos de esta ficha a validar (sección 14): el rango IMI y el porcentaje son de **unidades**; aplican igual a tallas centrales y extremas; la marca es una **unidad de marca** de 02b; la reposición directa regular se modela como **ingreso esperado** `pct × demanda de la marca` (sin él, el flujo pediría comprar también lo que llega solo).

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Marca intercompany** | Una unidad de marca (02b) para la que existe al menos una regla aquí. No hay bandera en `marcas`: la lista **se deriva** de las reglas. JH, DONATELLI y VAN HEUSEN son las de hoy; el módulo admite cualquier marca. |
| **Regla** | `(marca, GML, equivalencia opcional, vigente_desde, imi_min, imi_max, pct_directo)`: desde ese mes (inclusive) y hasta la regla siguiente de la misma clave, la marca en esa unidad se evalúa con **su** rango IMI (**por defecto 4 y 8**, los mismos que `flujo_parametros`; editables), y el `pct_directo` % de su demanda se espera que llegue directo por compras regulares. |
| **Vigencia** | Las reglas de una clave forman una **secuencia por `vigente_desde`**; la vigente en el mes `m` es la de mayor `vigente_desde ≤ m`. No hay `vigente_hasta` guardado: se deriva. Antes de la primera regla no hay subflujo (la marca va con el resto de la fila, 4–8 general). Una regla con `pct_directo = 0` y rango igual al general "termina" el intercompany desde un mes. |
| **Clave** | `(marca_id, genero_mundo_linea_id, equivalencia_id)` con `equivalencia_id` nulo si la regla es del GML entero. Si el nodo es `GMLE`, una regla por GML aplica a todas sus equivalencias salvo las que tengan regla propia (**la más específica manda**). |
| **Ámbito sugerido** | Género HOMBRE y mundos FORMAL, CASUAL y RI: filtro por defecto de la pantalla, **no** una restricción de la base. Un nodo fuera del ámbito muestra el aviso `fuera_de_ambito`, informativo. |
| **Participación de la marca (`part_B`)** | En la fila GML-AM de la cerrada de M7, `part_B` = la participación de `B` en **`participaciones_historicas.por_marca`** (eje nuevo de `0.10.1`: todas las unidades de marca, tengan o no tratamiento); si la cerrada no lo trae (calculada en `0.10.0`), la **suma de `por_clave_flujo` cuyo `marca_id` es `B`**, sea cual sea el tipo de clave (`unidad` si es relevante, `barrido` si es al barrer o mixta fuera de sus GML). No exige reparto de M12 (I1 del revisor). |
| **Aplicable** | Una regla es aplicable en el flujo si la cerrada tiene `part_B > 0` en alguna fila de ese GML. Con una cerrada de `0.10.1` (`por_marca`) **VAN HEUSEN es aplicable aunque no esté marcada relevante** (decisión 30: tratamiento desde ahora; el eje `por_marca` que el revisor propuso entra en `0.10.1`, no en una segunda entrega). Con una cerrada de `0.10.0` (sin `por_marca`) y la marca sin tratamiento, su venta cae en "otras" y la regla queda `no_aplicable` con motivo `marca_sin_clave`; la pantalla lo señala con el atajo a Marcas relevantes por GML y el aviso "cierra una proyección con `0.10.1`". **Recomendación (no bloqueante)**: marcar VAN HEUSEN, JH y DONATELLI como relevantes (`por_gml`) en sus GML de hombre formal, casual y RI para que M7 también las desglose. |
| **Subflujo intercompany (`B` en `f`)** | En M8, dentro de la fila `f = (g, a)` y para cada marca intercompany `B` con regla vigente y aplicable: demanda `D^B_m = D_m × part_B` (completa), stock `S^B_k` = stock de `B` en `g` (CD + tiendas, **completo**), ingresos `I^B_m` = líneas de M9 con marca `B` que caen en `g` (cualquier destino, incluido `intercompany_directo`), **reposición directa esperada** `R^B_m = D^B_m × pct_directo ÷ 100`, `VPM^B_m = Σ_{j=m+1}^{m+12} D^B_j ÷ 12`, `imi^B_m = S^B_m ÷ VPM^B_m`, y objetivo `obj^B_m = min_B × VPM^B_m`, `tope^B_m = max_B × VPM^B_m` (la misma definición de IMI de M8, decisión 25). El **resto de la fila** (`D − Σ_B D^B`, `S − Σ_B S^B`, `I − Σ_B I^B`) usa el 4–8 general. En los meses cerrados, M8 muestra para `B` el **ingreso inferido** `Ing^B_m` (conciliación) y el `% directo observado`. Definido en M8 §5, paso 2b; la función pura vive aquí para que la prueba sea compartida. |

### Por qué un rango IMI propio ("cobertura esperada") y no demanda neta ni stock neto

| Opción | Qué da | Qué cuesta | Veredicto |
|---|---|---|---|
| (a) Demanda neta `D − pct × D` (primera versión de esta ficha) | Simple; una resta | El stock de la marca incluye lo que llegó directo y se compara contra una demanda que lo excluye: cobertura inflada (**B2 del revisor**) | No |
| (b) Stock neto (restar del stock la parte directa) | Cobertura coherente con la demanda neta | No se sabe qué parte del stock llegó directo (M5 no lo trae); Javier no lo quiere | No (**Javier, ronda 3**) |
| **(c) Subflujo por marca con rango IMI propio (4–8 por defecto, editable) y reposición directa como ingreso esperado (recomendada; Javier, rondas 3 y 4)** | Demanda completa contra stock completo; el objetivo refleja que la marca se repone sola; el saldo por comprar de la marca es lo que el CD debe aportar | Una regla con tres números en vez de uno; M8 calcula un subflujo por marca dentro de la fila | **Sí** |

Por qué una tabla de reglas con vigencia y no una columna en `marca_gml_especial`: historial (el acuerdo de abastecimiento cambia), reglas por GMLE, y no obliga a que la marca sea relevante por la vía de 02b si mañana se usa el eje `por_marca`.

## 4. Flujo de pantalla (UX primero)

Ruta **`/maestros/intercompany`**, item "Intercompany" en Maestros de `nav.ts` (`PLANIFICACION`; el comprador no lo ve y la página lo redirige). Pestañas **Reglas · Historial** (Importar y Nueva vigencia en bloque: segunda entrega, por recomendación del revisor; hoy son decenas de reglas). Kit: `DataTable`, `Select`, `Input`, `Chips`, `Badge`, `Modal`, `Alert`, `EmptyState`; `useColeccion` para la lista plana de reglas. Filtros en la URL (`?marca=&genero=&mundo=&linea=&mes=2026-10&solo=`).

**Pestaña Reglas.** Una fila por clave con la regla **vigente en el mes elegido** (por defecto el mes en curso):

```
Intercompany · reglas vigentes en [oct-2026 ▾]   Filtros: [Marca ▾] [Género: HOMBRE ▾] [Mundo: FORMAL, CASUAL, RI ▾] [Línea ▾]  Solo: (no aplicables) (fuera de ámbito)
[+ Nueva regla]  [Excel]
Marca       GML / unidad                      Vigente desde  IMI mín  IMI máx  % directo  % observado (M8)  Aplicable                 Nota          Acciones
JH          HOMBRE · FORMAL · CAMISA             2026-01        4,0      8,0      80 %       80 % (set-26)     Sí                        acuerdo 2026  [Nueva vigencia] [Historial]
JH          HOMBRE · FORMAL · CAMISA › M. CORTA  2026-06        3,0      6,0      50 %       —                 Sí (GMLE: manda)          verano        [Nueva vigencia] [Historial]
DONATELLI   HOMBRE · FORMAL · TERNO              2025-03        4,0      8,0      60 %       55 % (set-26)     Sí                        —             [Nueva vigencia] [Historial]
VAN HEUSEN  HOMBRE · CASUAL · POLO               2026-01        4,0      8,0      70 %       —                 Sí (por marca, 0.10.1)    —             [Nueva vigencia] [Historial]
VAN HEUSEN  HOMBRE · RI · CASACA                 2026-01        3,0      6,0      40 %       —                 Sí                        —             [Nueva vigencia] [Historial]
5 reglas vigentes · 0 no aplicables · 0 fuera de ámbito · rango por defecto 4–8 (editado en 2 reglas)
```

**Nueva regla / Nueva vigencia** (`Modal`): marca (`Select` de unidades de marca activas; un miembro de conjunto se ofrece como su cabeza), GML (selector de nodos vigentes de 02b, filtrado por defecto a HOMBRE × FORMAL/CASUAL/RI, desactivable), equivalencia (solo si el nodo es `GMLE`, opcional), vigente desde (mes; por defecto el siguiente a hoy), IMI mínimo y máximo (meses, un decimal; **por defecto los de la regla anterior de la clave o `4,0` / `8,0`**, el rango general de `flujo_parametros`; decisión 29), % directo (0 a 100, un decimal; al lado "% del CD" calculado), nota (≤ 200). Validaciones en pantalla: clave + mes repetidos → "ya hay una regla de esa clave desde ese mes: edítala"; tope < mínimo → bloquea; marca sin clave en la cerrada vigente (solo con una cerrada de `0.10.0`) → aviso amarillo "se guardará como no aplicable hasta que se cierre una proyección con `0.10.1` (o VAN HEUSEN sea relevante en POLO)" con atajo a 02b (`confirm`, no bloqueo). La columna **% observado** viene de la conciliación de M8 (último mes cerrado; vacía hasta construir M8).

**Pestaña Historial.** Por clave, la secuencia de reglas (`vigente_desde`, mínimo, tope, %, quién, cuándo, nota), con la derivada "hasta" calculada; una regla se puede **editar** (coberturas, porcentaje, nota) o **eliminar** (borra la fila; la anterior vuelve a regir desde entonces: `confirm` lo dice). Editar la fecha no: se elimina y se crea.

**Efecto visible en M8** (para que Javier lo vea en el hito): en el flujo de un GML-AM la fila muestra, desplegable, "de la cual JH (intercompany · rango IMI 4–8 por defecto): demanda 480 · reposición directa esperada 384 · entregas 0 · stock 900 · IMI 1,7 → falta 1 116", y el resto de la fila con el 4–8 general; en los meses cerrados, "ingresos inferidos de JH 384 · directo observado 80 %".

### Qué decide el planner y qué decide el sistema

| Decisión | Quién |
|---|---|
| Qué marcas, qué GML, desde cuándo, qué rango IMI (4–8 si no lo cambia) y qué porcentaje directo | planner (pantalla) |
| Cuál regla rige en cada mes; que la más específica mande | sistema (secuencia por `vigente_desde`) |
| Si una regla es aplicable | sistema (`part_B` en la cerrada), con enlace para corregir en 02b |
| Demanda, stock, reposición esperada, IMI y saldo de cada marca intercompany por GML-AM-mes; ingreso inferido y % directo observado en los meses cerrados | M8, con la cerrada de M7 y el stock de M5 |

## 5. Método (lógica pura en `src/lib/intercompany/`)

1. **Regla vigente** `reglaVigente(reglas, clave, mes)`: entre las reglas activas de la clave, la de mayor `vigente_desde ≤ mes`; ninguna → `null`.
2. **Resolución de clave** `reglaIntercompany(reglas, marca, gml, equivalencia | null, mes)`: si hay regla vigente para `(marca, gml, equivalencia)` manda; si no, la de `(marca, gml, null)`; si no, `null`.
3. **"Hasta" derivado** `hastaDerivado(reglas, regla)`: el mes anterior al `vigente_desde` de la regla siguiente de la misma clave exacta, o `null` (abierta).
4. **Aplicabilidad** `aplicable(regla, participacionesCerrada)`: `part_B(g)` = participación de `B` en `por_marca` de las filas de `g` de la cerrada si existe; si no, `Σ` de las participaciones de `por_clave_flujo` con `marca_id = B` (tipo `unidad` o `barrido`); `> 0` → aplicable; si no, `{ aplicable: false, motivo: 'marca_sin_clave' }`. Sin cerrada → `{ aplicable: null, motivo: 'sin_cerrada' }` (la pantalla dice "se sabrá al cerrar una proyección").
5. **Subflujo intercompany** `subflujoIntercompany(D, part_B, S_B, I_B, regla, meses)` (vive en M8, se define aquí para la prueba compartida): `D^B_m = D_m × part_B`; `R^B_m = D^B_m × pct ÷ 100`; `S^B_m = S^B_{m−1} + I^B_m + R^B_m − D^B_m`; `VPM^B_m = Σ_{j=m+1}^{m+12} D^B_j ÷ 12`, `imi^B_m = S^B_m ÷ VPM^B_m` (sobre la demanda **completa**); `obj^B_m = min_B × VPM^B_m`, `tope^B_m = max_B × VPM^B_m`; `C^B_m = max(0, obj^B_m − (S*^B_{m−1} + I^B_m + R^B_m − D^B_m))` secuencial; `X^B_m = max(0, S^B_m − tope^B_m)`; señales con `min_B` / `max_B`. Propiedad: `R^B ≤ D^B` siempre (`pct ≤ 100`).
6. **Ámbito** `fueraDeAmbito(nodo)` = género ≠ HOMBRE o mundo ∉ {FORMAL, CASUAL, RI} (por códigos de M1; informativo).
7. **% directo observado** (vive en M8, `conciliacion.ts`; se muestra aquí): `pctDirectoObservado(Ing^B_m, R^B_m, V^B_m) = max(0, Ing^B_m − R^B_m) ÷ V^B_m` (`null` si `V^B_m = 0`); informativo, nunca cambia la regla.

## 6. Modelo de datos (`0021_intercompany.sql`)

Mismas convenciones de idempotencia y seguridad que `0020` (M12) (sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`; sin `do $$`; RLS sin políticas; `revoke`/`grant`). **Criterio I9 del revisor**: la base solo lleva invariantes **estructurales**; los catálogos y rangos de negocio van en zod, para poder aflojarlos sin `DROP`.

### 6.1 `intercompany_reglas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `marca_id` | `uuid not null → marcas on delete restrict` | la unidad de marca; la API rechaza un miembro (`409 marca_en_conjunto`) y VARIOS / OTROS / SIN MARCA (`409 marca_generica`) |
| `genero_mundo_linea_id` | `uuid not null → genero_mundo_linea on delete restrict` | |
| `equivalencia_id` | `uuid null → equivalencias on delete restrict` | la API exige que pertenezca al nodo (`409 equivalencia_de_otro_nodo`) |
| `vigente_desde` | `date not null` | `check (vigente_desde = date_trunc('month', vigente_desde)::date)`; primer día de mes (estructural) |
| `imi_min` | `numeric(4,1) not null default 4` | `check (imi_min >= 0)`; el default es el rango general (decisión 29); que `máximo ≥ mínimo` y los rangos razonables (`0,5` a `24`) los valida zod |
| `imi_max` | `numeric(4,1) not null default 8` | `check (imi_max >= 0)` |
| `pct_directo` | `numeric(5,2) not null default 0` | `check between 0 and 100` (estructural: es un porcentaje) |
| `nota` | `text null` | `check (nota is null or length(nota) between 1 and 200)` |
| `perfil_id → perfiles on delete set null`, `usuario_nombre text` | | quién la creó o editó por última vez |
| `activo` | `boolean not null default true` | por convención y **sin uso**: eliminar borra la fila |
| `created_at`, `updated_at` | | trigger |

Único **`intercompany_reglas_clave_uniq` sobre `(marca_id, genero_mundo_linea_id, coalesce(equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid), vigente_desde)`**. Índices `(genero_mundo_linea_id)` y `(marca_id)`. Sin seed. Tamaño: decenas de filas.

### 6.2 Vista `intercompany_vigente` (contrato SQL opcional para M8)

`create or replace view … with (security_invoker = true)`: una fila por regla con `hasta_derivado` (`lead(vigente_desde) over (partition by clave order by vigente_desde) − 1 mes`) y las columnas de la marca y el nodo. En código, `leerReglasIntercompany(db)` trae todas las reglas (son pocas) y `reglaIntercompany` resuelve en TS. `revoke` a `anon`/`authenticated`, `grant select to service_role`.

### Diagrama

```
marcas (unidad: JH = JOHN HOLDEN + JOHN, DONATELLI, VAN HEUSEN) ─┐
genero_mundo_linea (+ equivalencia si GMLE) ─────────────────────┼─► intercompany_reglas (vigente_desde, imi_min 4, imi_max 8, pct_directo) ─► reglaVigente(mes) · la más específica manda
proyección cerrada (M7 0.10.1): part_B = por_marca[B] (o Σ por_clave_flujo con marca_id = B) ─► aplicable(regla) ─────────────────────┤
stock_flujo por unidad de marca (M5) + entregas de compras con marca B + conciliación (Ing^B, % observado) ───────────────────────────┴─► M8: subflujo de B en la fila (D^B, S^B, I^B, R^B, imi^B con min_B/max_B, C^B, X^B) + resto de la fila con 4–8
```

## 7. Contratos de API y de lógica pura

Convenciones de siempre; handlers en `src/app/api/intercompany/`; lógica pura en `src/lib/intercompany/` (`tipos-api.ts`, `esquemas.ts`, `reglas.ts`, `subflujo.ts`, `excel.ts`); datos en `consultas.ts`. **Todo `requirePlanner`** (el comprador ve el efecto en M8, no la tabla).

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/intercompany/reglas` | GET | `?mes=aaaa-mm&incluir_historial=1` | `ReglaIntercompanyApi[]` (sin `incluir_historial`: solo la vigente de cada clave en `mes`, con `hasta_derivado`, `aplicable`, `motivo_no_aplicable`, `fuera_de_ambito`, nombres) |
| `/api/intercompany/reglas` | POST | `crearReglaSchema = { marca_id: uuid, genero_mundo_linea_id: uuid, equivalencia_id?: uuid\|null, vigente_desde: mes, imi_min?: 0.5..24 (1 decimal; por defecto 4), imi_max?: 0.5..24 (≥ mínimo, `refine`; por defecto 8), pct_directo: 0..100 (≤ 2 decimales), nota?: ≤ 200 }` | `201 ReglaIntercompanyApi`; `404` marca o nodo; `409 marca_en_conjunto`, `409 marca_generica`, `409 nodo_no_vigente`, `409 equivalencia_de_otro_nodo`, `409 clave_mes_repetido` |
| `/api/intercompany/reglas/[id]` | PATCH / DELETE | `editarReglaSchema = { imi_min?, imi_max?, pct_directo?, nota? }` (el `refine` de tope ≥ mínimo se evalúa con los valores resultantes) | `ReglaIntercompanyApi`; `DELETE` → `{ id, regla_anterior_id }` |
| `/api/intercompany/vigentes` | GET | `?desde=aaaa-mm&hasta=aaaa-mm` | **Contrato de M8**: `{ reglas: ReglaIntercompanyApi[] (todas las activas, con `hasta_derivado`), marcas: [{ marca_id, nombre }] }`; en código `leerReglasIntercompany(db)` |

Segunda entrega: `POST /api/intercompany/reglas/bloque` (nueva vigencia en bloque) y `POST /api/intercompany/importar` (columnas `MARCA`, `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA`, `DESDE`, `IMI_MIN`, `IMI_MAX` (opcionales; vacíos = 4 y 8), `PCT_DIRECTO`, `NOTA`; el archivo manda; `resolverGml` de 02b).

```ts
export type ReglaIntercompanyApi = { id: string; marca_id: string; marca: string; genero_mundo_linea_id: string; equivalencia_id: string | null; ruta: string; nivel: "GML" | "GMLE";
  vigente_desde: string; hasta_derivado: string | null; imi_min: number; imi_max: number; es_rango_defecto: boolean; pct_directo: number; pct_cd: number; pct_directo_observado: { periodo: string; valor: number } | null; nota: string | null; usuario_nombre: string | null; updated_at: string;
  aplicable: boolean | null; motivo_no_aplicable: "marca_sin_clave" | "sin_cerrada" | null; fuera_de_ambito: boolean };
```

| Función pura | Reglas |
|---|---|
| `reglaVigente`, `reglaIntercompany`, `hastaDerivado`, `secuenciaPorClave` | 1–3, 7 |
| `aplicable(regla, participacionesCerrada)` | 4 |
| `subflujoIntercompany(D, part_B, S_B, I_B, regla, meses)` | 5, 8 |
| `fueraDeAmbito(nodo, catalogos)` | 6 |
| `motivoRechazoRegla(entrada, estado)` | 9 |
| `hojasIntercompany(filas)` | 10 |

## 8. Reglas de negocio (vitest)

1. **Vigente por mes**: reglas de una clave en ene-2026 y jun-2026: en may-2026 rige la de enero, en jun-2026 la de junio, en dic-2025 ninguna; una regla inactiva no cuenta.
2. **La más específica manda**: regla del GML (4–8, 80 %) y de la equivalencia MANGA CORTA (3–6, 50 %): MANGA CORTA → la específica, MANGA LARGA → la del GML; sin regla del GML, MANGA LARGA → `null`.
3. **Hasta derivado**: la regla de enero tiene `hasta = 2026-05` si hay otra de la **misma clave exacta** en junio; una regla de la equivalencia no cierra la del GML; eliminar la de junio deja la de enero abierta (`regla_anterior_id` apunta a enero).
4. **Aplicable**: JH con clave `unidad` en CAMISA (`part = 0,40`) → `true`; BETA al barrer con clave `barrido` en TERNO (`part = 0,50`) → `true` (sin reparto de M12); VAN HEUSEN sin tratamiento con una cerrada de `0.10.1` (`por_marca` VH = 0,25 en POLO) → `true`; la misma con una cerrada de `0.10.0` (su venta está en "otras") → `false` con `marca_sin_clave`; sin cerrada → `null` con `sin_cerrada`.
5. **Subflujo**: `D = 1 200`, `part = 0,40`, `pct = 80`, rango por defecto `min = 4`, `max = 8`, `S^B_k = 900`, sin ingresos → `D^B = 480`, `R^B = 384`, `S^B_{k+1} = 900 + 384 − 480 = 804`, `VPM^B = 480`, `imi^B_{k+1} = 804 ÷ 480 = 1,675`, `obj^B = 1 920` → `C^B_{k+1} = 1 920 − 804 = 1 116`, señal `falta` (`imi < 4`); con la regla editada a `2–4`, `obj^B = 960` y `C^B = 156`; con `pct = 0`, `R = 0` y `C` sube; `R^B ≤ D^B` siempre (propiedad). `pctDirectoObservado(384, 0, 480) = 0,80`; `(384, 384, 480) = 0`; `(…, V = 0) = null`.
6. **Ámbito**: HOMBRE·FORMAL, HOMBRE·CASUAL y HOMBRE·RI → dentro; MUJER·CASUAL y HOMBRE·URBANO → fuera (informativo; la regla se guarda igual).
7. **Secuencia**: `secuenciaPorClave` ordena por `vigente_desde` y nunca tiene dos reglas del mismo mes (lo garantiza el único de expresión; prueba SQL).
8. **Determinismo** de `subflujoIntercompany` y de la resolución: misma entrada, misma salida; sin reloj (recibe `mes`).
9. **Rechazos**: miembro de conjunto (JOHN) → `marca_en_conjunto` con `detalle` "usa JOHN HOLDEN (cabeza)"; VARIOS → `marca_generica`; nodo no vigente → `nodo_no_vigente`; equivalencia de otro nodo → `equivalencia_de_otro_nodo`; `pct` 100,5 → `400`; máximo 3 con mínimo 4 → `400` (`refine`); `POST` sin `imi_min` ni `imi_max` → se guarda 4 y 8 con `es_rango_defecto = true`; `vigente_desde` que no es primer día de mes → `400`.
10. **Excel = tabla**: columnas y filas de `hojasIntercompany` coinciden con la `DataTable` y el filtro.
11. **SQL (humo local)**: `0021` aplica dos veces; `imi_min` e `imi_max` tienen default 4 y 8; el único de expresión rechaza dos reglas de la misma clave y mes con `equivalencia_id` nulo; el `check` de mes rechaza `2026-01-15`; `pct_directo = 101` se rechaza; `anon` no lee la tabla ni la vista; `intercompany_vigente.hasta_derivado` coincide con `hastaDerivado` sobre la fixture.
12. **Estático**: toda ruta bajo `/api/intercompany` usa `requirePlanner`; `src/lib/intercompany/` no importa `@supabase/*` fuera de `consultas.ts`; `nav.ts` marca el item con `PLANIFICACION`.

## 9. Casos sintéticos (`tests/intercompany.fixture.ts`)

Nodos: `HOMBRE · FORMAL · CAMISA` (GMLE: MANGA LARGA, MANGA CORTA), `HOMBRE · FORMAL · TERNO` (GML), `HOMBRE · CASUAL · POLO` (GML), `HOMBRE · RI · CASACA` (GML), `MUJER · CASUAL · POLO` (GML). Marcas: JOHN HOLDEN (RECONOCIDO, cabeza del conjunto con JOHN; relevante en CAMISA y POLO), DONATELLI (PREMIUM, relevante en TERNO), VAN HEUSEN (RECONOCIDO, **sin tratamiento** en la fixture base; en la variante "marcada" es relevante en POLO y CASACA), BETA (PREMIUM, al barrer), JOHN HOLDEN UNDERWEAR (marca aparte, fuera del conjunto). Reglas: JH·CAMISA 2026-01 (4–8 por defecto, 80 %); JH·CAMISA›M. CORTA 2026-06 (3–6, 50 %); DONATELLI·TERNO 2025-03 (4–8, 60 %); VAN HEUSEN·POLO 2026-01 (4–8, 70 %); VAN HEUSEN·CASACA 2026-01 (3–6, 40 %); BETA·TERNO 2026-01 (4–8, 20 %). Cerrada **`0.10.1`** con participaciones: CAMISA›M. LARGA × RECONOCIDO `por_clave_flujo { unidad JH: 0,40, otras: 0,60 }`, `por_marca { JH: 0,40, ALFA: 0,35, OMEGA: 0,25 }`; TERNO × PREMIUM `{ unidad DONATELLI: 0,30, barrido BETA: 0,50, otras: 0,20 }`; POLO × RECONOCIDO `por_clave_flujo { otras: 1,0 }`, `por_marca { VAN HEUSEN: 0,25, ALFA: 0,75 }` (VH sin tratamiento pero con eje por marca); variante **cerrada `0.10.0`** sin `por_marca`.

1. Vigentes en oct-2026: seis reglas; con la cerrada `0.10.1`, VAN HEUSEN·POLO aplicable por `por_marca` (·CASACA aplicable si su fila trae VH); con la variante `0.10.0`, ambas `aplicable = false` (`marca_sin_clave`) hasta marcarla o cerrar con `0.10.1`; BETA aplicable por su clave `barrido`; ninguna fuera de ámbito; cuatro reglas con `es_rango_defecto = true`.
2. `reglaIntercompany(JH, CAMISA, M. CORTA, 2026-05)` = la del GML (aún no rige la específica); en 2026-07 = la específica; `(JH, CAMISA, M. LARGA, 2026-07)` = la del GML.
3. Subflujo de JH en CAMISA › M. LARGA × RECONOCIDO, oct-2026: `D = 1 200` → `D^B = 480`, `R^B = 384`; `S^B_set = 900`; sin ingresos: `S^B_oct = 804`, `imi^B = 1,7`, `C^B_oct = 1 116`, `falta`; con la regla editada a 2–4, `C^B_oct = 156`; con una línea de JH · CAMISA › M. LARGA · 300 · entrega nov · `intercompany_directo` → `I^B_nov = 300` (cuenta: el stock es completo) y `C^B_nov` baja; el resto de la fila (`D = 720`) se evalúa con 4–8; conciliación de set (stock JH ago 996, set 900, venta 480) → `Ing^B = 384`, `pct_directo_observado = 0,80`.
4. `POST` JOHN·CAMISA → `409 marca_en_conjunto`; `POST` VAN HEUSEN·POLO sin rango → 4–8 y `es_rango_defecto`; `POST` JOHN HOLDEN UNDERWEAR·CAMISA → se acepta (es otra unidad de marca; aviso informativo `fuera_de_marcas_sugeridas`); `POST` JH·CAMISA 2026-01 otra vez → `409 clave_mes_repetido`; `PATCH` a 85 % → `pct_cd = 15`.
5. `DELETE` de JH·CAMISA›M. CORTA → `regla_anterior_id = null` (la clave específica queda sin reglas; vuelve a mandar la del GML).
6. Historial de JH·CAMISA: la regla del GML sigue abierta (`hasta = null`) aunque exista la específica de junio: `hastaDerivado` es por clave exacta (reemplaza al caso 8 de la primera versión, que se corregía a sí mismo).

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · lint, tsc, vitest (más `tests/intercompany.*`), build, `validar-migraciones-local.sh`; `0021` aplicada; tipos regenerados; `APP_VERSION = 0.12.0 · M13`.

**Prerrequisitos de Javier** · JOHN HOLDEN, JOHN, DONATELLI y VAN HEUSEN cargadas como marcas; el conjunto JH (cabeza JOHN HOLDEN, miembro JOHN; UNDERWEAR, WOMAN y DONNA fuera); las tres unidades marcadas **relevantes** (`por_gml`) en los GML de hombre formal, casual y RI donde aplica (02b): recomendado, **ya no bloqueante** (una cerrada de `0.10.1` trae `por_marca`); la lista de porcentajes directos por GML y, solo si difieren de 4–8, los rangos IMI por marca.

**Hito (sección H de `cowork-checklist.md`, usuario planner)**
1. Como comprador: "Intercompany" no aparece, la URL redirige, `GET /api/intercompany/reglas` → `403`.
2. La pestaña Reglas abre filtrada a HOMBRE × FORMAL/CASUAL/RI y vacía (`EmptyState` con "Nueva regla").
3. ✍️ Crear una regla para JH en una camisa de hombre formal desde el mes siguiente dejando el rango por defecto (4–8) y 80 % directo: aparece con "% del CD 20 %", el rango marcado "por defecto" y Aplicable "Sí" (si hay cerrada con JH ahí) o "No: sin clave" con el atajo; editarla a 3–6 y ver que deja de ser "por defecto".
4. ✍️ "Nueva vigencia" sobre la misma clave dos meses después con 60 %: Historial muestra las dos con el "hasta" derivado; cambiar el mes del selector cambia cuál se ve vigente.
5. ✍️ Crear la regla de VAN HEUSEN en un polo de hombre casual (decisión 30): con una cerrada de `0.10.1` sale aplicable "Sí (por marca)" aunque no esté marcada; con una de `0.10.0`, "No: sin clave" hasta cerrar una nueva o marcarla.
6. Excel de la lista con el filtro de mundo.
7. (Tras construir M8) abrir el flujo de ese GML-AM y ver el subflujo de JH con demanda `D × part_JH`, reposición esperada `× 80 %`, su stock y su IMI contra su rango (4–8 o el editado), el resto de la fila contra 4–8, y en los meses cerrados el ingreso inferido y el % directo observado, que también aparece en esta pantalla.
8. ✍️ Eliminar las reglas de prueba si Javier no las quiere conservar.

## 11. Alcance

**Primera entrega (`0.12.0 · M13`)**: tabla de reglas con vigencia por mes y clave marca × GML (× equivalencia), con rango IMI (4–8 por defecto, editable) y porcentaje directo; la más específica manda; % directo observado desde M8; pantalla con reglas vigentes por mes, nueva regla, nueva vigencia individual, historial con editar y eliminar; `vigentes` para M8; aplicabilidad por la cerrada de M7; Excel.

**Segunda entrega**: nueva vigencia en bloque e importador (diferidos por el revisor); rango o porcentaje distintos por agrupación de talla; sugerencia automática del porcentaje a partir del % directo observado (hoy solo se muestra); reglas por tienda. (El eje `por_marca` ya entra en `0.10.1` de M7.)

**Fuera de alcance**: registrar las compras directas del CD intercompany (M8/M9a: son ingresos al CD); calcular el ingreso inferido o el % observado (M8, conciliación); calcular la demanda (M7); el flujo y el subflujo (M8, que importa `subflujoIntercompany` de aquí); una bandera "intercompany" en `marcas` o en `proveedores` (M9 tiene `proveedores.es_intercompany`).

## 12. Riesgos

- **Depende de la cerrada**: con una cerrada de `0.10.0` (sin `por_marca`) y VAN HEUSEN sin marcar, sus reglas quedan no aplicables y M8 la trata con el 4–8 general (la pantalla lo muestra y M8 lo lista en `intercompany_no_aplicable`); se resuelve cerrando una proyección con `0.10.1`.
- **Rango por defecto igual al general**: mientras Javier no edite una regla, el subflujo de JH se evalúa con 4–8 como el resto; su valor está en la reposición directa esperada y en el desglose, no en un objetivo distinto.
- **Reposición directa esperada como ingreso**: es un supuesto (sección 14); si Javier prefiere no modelarla, `pct_directo` queda informativo y el saldo de la marca sube.
- **Doble conteo con líneas `intercompany_directo`**: una línea de M9 con ese destino se suma a `R^B`; si la compra directa registrada es la misma reposición regular, se cuenta dos veces. Aviso informativo `directo_con_regla` en la línea; `directo_sin_regla` si la marca no tiene regla.
- **Sin dato de origen en M5**: el porcentaje y el rango son un juicio del planner; el % directo observado de la conciliación (M8) es una referencia a nivel cadena, ruidosa en meses con transferencias o ajustes.
- **Reglas por mes**: una regla con `vigente_desde` en el pasado cambia el flujo de meses ya cerrados solo en las vistas; no hay reproceso.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M13: el intercompany es una tabla de reglas por marca × GML (× equivalencia) con vigencia por mes y sin `vigente_hasta` guardado; cada regla lleva un rango IMI (por defecto 4–8, el general; editable por marca y GML: Javier, ronda 4, decisión 29) y porcentaje directo; la más específica manda.** Descartado: rangos propios fijos por defecto (2–4); columna en `marca_gml_especial`; porcentaje por marca sin GML; `vigente_hasta` editable.
2. **M13 + M8: el intercompany directo no recorta la demanda ni el stock; la marca se evalúa en un subflujo con demanda completa, stock completo, reposición directa esperada como ingreso y su rango IMI propio; los ingresos reales del intercompany directo salen de la conciliación de inventarios de M8 (decisión 27)** (Javier, rondas 3 y 4; B2 del revisor). Descartado: demanda neta (primera versión); stock neto.
3. **M13: la aplicabilidad sale de la cerrada de M7 (`part_B` = `por_marca` de `0.10.1`, o la suma de participaciones con `marca_id = B` de cualquier tipo de clave), sin exigir reparto de M12 ni que la marca esté marcada relevante; VAN HEUSEN entra desde ahora (decisión 30).** Descartado: exigir marcar VH antes de la cerrada (ahora solo recomendado).
4. **M13: las marcas intercompany se derivan de las reglas; no hay bandera en `marcas`.**
5. **M13: el ámbito hombre formal, casual y RI es un filtro por defecto, no una restricción; la base solo lleva invariantes estructurales y los catálogos y rangos van en zod** (I9).

**Cambios que integra el `documentador`**: PLAN §4 (tabla `intercompany_reglas`, vista `intercompany_vigente`, migración `0021`, versión `0.12.0 · M13`), PLAN §5 (fila nueva M13), PLAN §7 (pendiente: lista de porcentajes por GML y rangos distintos de 4–8 si los hay; conjunto JH; marcar JH, DONATELLI y VAN HEUSEN como relevantes, recomendado), ficha 02b ("Lo que M7 y M8 consumen": la clave en la cerrada habilita el intercompany), `cowork-checklist.md` sección H, `nav.ts`.

## 14. Preguntas para Javier (dos abiertas; la 3 y la 4 quedaron resueltas en la ronda 4)

1. **¿La reposición directa regular se modela como ingreso esperado (`% directo × demanda de la marca`)?** Sin eso el saldo por comprar de JH pediría también lo que llega solo. **Recomendación: sí.**
2. **¿Cobertura esperada y porcentaje en unidades, iguales para centrales y extremas?** **Recomendación: sí en la primera entrega.**
3. ~~¿Valores iniciales?~~ **Resuelta (decisión 29): 4–8 por defecto, editable por marca; falta solo la lista de porcentajes directos por GML.**
4. ~~¿Marcar VAN HEUSEN antes de cerrar o eje `por_marca`?~~ **Resuelta (decisión 30 y `0.10.1`): las dos cosas; VH entra desde ahora y el eje `por_marca` llega con `0.10.1`, así que marcarla es recomendable pero no bloqueante.**

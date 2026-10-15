# M13 · Intercompany: cobertura esperada por marca × GML y reposición directa

> Estado: **especificada el 2026-10-15 y ajustada el mismo día con el informe del `arquitecto-revisor` (opus) y la ronda 3 de Javier; pendiente de aprobación por Javier.** Recoge las decisiones 6, 10, 15, 16 y 17 de `08-09-definiciones-del-dueno.md`: para las marcas intercompany (**JOHN HOLDEN + JOHN = JH**, **DONATELLI** y **VAN HEUSEN**; sin UNDERWEAR, WOMAN ni DONNA) y dentro de cada GML de **hombre formal, casual y RI**, qué parte de la venta llega **directo del intercompany por compras regulares** y qué **cobertura esperada** (mínimo y tope en meses) debe tener esa marca en ese GML. Es un módulo propio, pequeño, que alimenta el flujo de M8. Migración prevista **`0020_intercompany.sql`** (la `0018` es de M7, ya aplicada; la `0019` es de M12; se confirma al construir); versión prevista **`0.12.0 · M13`**, después de `0.11.0 · M12`; commits con prefijo `M13:`. Depende de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (marcas relevantes por GML, conjuntos, `marcas_unidad`), [01-arbol-producto](01-arbol-producto.md) (nodos) y [07-proyeccion-anual](07-proyeccion-anual.md) (`participaciones_historicas.por_clave_flujo`, por donde M8 sabe cuánto de un GML-AM es JH). Lo consume [08-flujo-y-compras](08-flujo-y-compras.md) (subflujo por marca intercompany). Toda la API es `requirePlanner`. Sin datos reales: los porcentajes, coberturas y nodos de los ejemplos son inventados.

## 1. Objetivo

Parte de la venta de JH, Donatelli y VH en las líneas de hombre formal, casual y RI no pasa por nuestro centro de distribución: llega a las tiendas **directo del intercompany** por compras regulares (reposición continua). Si M8 tratara a esas marcas como a cualquier otra, con el objetivo general de 4 a 8 meses y sin contar que una parte se repone sola, pediría comprar lo que ya llega por su cuenta. La primera versión de esta ficha descontaba esa parte de la **demanda**; el revisor mostró (B2) que el **stock** de esas marcas en las tiendas incluye lo que llegó directo, de modo que se comparaba un stock completo contra una demanda recortada y la cobertura salía inflada. Javier no quiere tampoco restar del stock la parte directa: quiere **una cobertura esperada intercompany en el flujo**. Este módulo guarda, por **marca × GML** (o GMLE) y con **vigencia en el tiempo**, (a) la **cobertura esperada** de la marca en ese GML (mínimo y tope en meses, distintos del 4–8 general) y (b) el **porcentaje que llega directo** por compras regulares, que M8 usa como **reposición directa esperada** (un ingreso esperado, no un recorte de demanda ni de stock). M8 lleva para esas marcas un **subflujo** dentro de la fila GML-AM con demanda completa, stock completo y objetivo propio. Se mantiene a mano (no hay dato de origen de la mercadería en M5), con historial y avisos cuando la configuración de 02b o la cerrada de M7 no permiten aplicarlo.

## 2. Decidido por Javier (2026-10-15)

1. **Módulo propio de intercompany** para las líneas de hombre: qué porcentaje de la venta viene directo del intercompany por compras regulares y cuánto sale del CD (decisión 6), **por GML y marca** (decisión 10).
2. Las compras que el administrador de producto hace **directo del CD intercompany** son otra cosa: son **ingresos al CD** y se registran como compras en M9 (decisión 5a). Este módulo no las toca.
3. **El stock del intercompany directo no se resta** (ronda 3, decisión 15): para las marcas con regla, el flujo usa una **cobertura esperada propia** por marca y GML en vez de un cálculo sobre stock neto o demanda neta.
4. **Marcas** (decisión 16): JOHN HOLDEN, JOHN, DONATELLI y VAN HEUSEN; JH es el conjunto JOHN HOLDEN + JOHN (cabeza JOHN HOLDEN) y **no** incluye UNDERWEAR, WOMAN ni DONNA. VAN HEUSEN hoy no tiene tratamiento especial: **se marca antes de cerrar la proyección** que lea M8 (sección 3, "Aplicable").
5. **Ámbito** (decisión 17): hombre **formal, casual y RI**.

Supuestos de esta ficha a validar (sección 14): la cobertura esperada y el porcentaje son de **unidades**; aplican igual a tallas centrales y extremas; la marca es una **unidad de marca** de 02b; la reposición directa regular se modela como **ingreso esperado** `pct × demanda de la marca` (sin él, el flujo pediría comprar también lo que llega solo).

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Marca intercompany** | Una unidad de marca (02b) para la que existe al menos una regla aquí. No hay bandera en `marcas`: la lista **se deriva** de las reglas. JH, DONATELLI y VAN HEUSEN son las de hoy; el módulo admite cualquier marca. |
| **Regla** | `(marca, GML, equivalencia opcional, vigente_desde, cobertura_min_meses, cobertura_max_meses, pct_directo)`: desde ese mes (inclusive) y hasta la regla siguiente de la misma clave, la marca en esa unidad se evalúa con **su** mínimo y tope, y el `pct_directo` % de su demanda se espera que llegue directo por compras regulares. |
| **Vigencia** | Las reglas de una clave forman una **secuencia por `vigente_desde`**; la vigente en el mes `m` es la de mayor `vigente_desde ≤ m`. No hay `vigente_hasta` guardado: se deriva. Antes de la primera regla no hay subflujo (la marca va con el resto de la fila, 4–8 general). Una regla con `pct_directo = 0` y cobertura igual a la general "termina" el intercompany desde un mes. |
| **Clave** | `(marca_id, genero_mundo_linea_id, equivalencia_id)` con `equivalencia_id` nulo si la regla es del GML entero. Si el nodo es `GMLE`, una regla por GML aplica a todas sus equivalencias salvo las que tengan regla propia (**la más específica manda**). |
| **Ámbito sugerido** | Género HOMBRE y mundos FORMAL, CASUAL y RI: filtro por defecto de la pantalla, **no** una restricción de la base. Un nodo fuera del ámbito muestra el aviso `fuera_de_ambito`, informativo. |
| **Participación de la marca (`part_B`)** | En la fila GML-AM de la cerrada de M7, `part_B` = **suma de las participaciones de `participaciones_historicas.por_clave_flujo` cuyo `marca_id` es `B`, sea cual sea el tipo de clave** (`unidad` si es relevante, `barrido` si es al barrer o mixta fuera de sus GML). No exige reparto de M12 (I1 del revisor). |
| **Aplicable** | Una regla es aplicable en el flujo si la cerrada tiene `part_B > 0` en alguna fila de ese GML. Si la marca no tiene tratamiento especial (hoy VAN HEUSEN), su venta cae en "otras de la agrupación" sin `marca_id` y no hay `part_B`: la regla queda `no_aplicable` con motivo `marca_sin_clave`; la pantalla lo señala y enlaza a Marcas relevantes por GML. **Prerrequisito del hito**: marcar VAN HEUSEN como relevante (`por_gml`) en sus GML de hombre formal, casual y RI **antes de cerrar la proyección**; JH y DONATELLI, igual si todavía no lo están. La alternativa del revisor (un eje `por_marca` en las participaciones de M7, con las marcas principales de cada fila tengan o no tratamiento) queda como segunda entrega si marcar VH resulta incómodo. |
| **Subflujo intercompany (`B` en `f`)** | En M8, dentro de la fila `f = (g, a)` y para cada marca intercompany `B` con regla vigente y aplicable: demanda `D^B_m = D_m × part_B` (completa), stock `S^B_k` = stock de `B` en `g` (CD + tiendas, **completo**), ingresos `I^B_m` = líneas de M9 con marca `B` que caen en `g` (cualquier destino, incluido `intercompany_directo`), **reposición directa esperada** `R^B_m = D^B_m × pct_directo ÷ 100`, y objetivo `obj^B_m = Σ_{j=m+1}^{m+min_B} D^B_j`, `tope^B_m` con `max_B`. El **resto de la fila** (`D − Σ_B D^B`, `S − Σ_B S^B`, `I − Σ_B I^B`) usa el 4–8 general. Definido en M8 §5, paso 2b; la función pura vive aquí para que la prueba sea compartida. |

### Por qué cobertura esperada y no demanda neta ni stock neto

| Opción | Qué da | Qué cuesta | Veredicto |
|---|---|---|---|
| (a) Demanda neta `D − pct × D` (primera versión de esta ficha) | Simple; una resta | El stock de la marca incluye lo que llegó directo y se compara contra una demanda que lo excluye: cobertura inflada (**B2 del revisor**) | No |
| (b) Stock neto (restar del stock la parte directa) | Cobertura coherente con la demanda neta | No se sabe qué parte del stock llegó directo (M5 no lo trae); Javier no lo quiere | No (**Javier, ronda 3**) |
| **(c) Subflujo por marca con cobertura esperada propia y reposición directa como ingreso esperado (recomendada)** | Demanda completa contra stock completo; el objetivo refleja que la marca se repone sola; el saldo por comprar de la marca es lo que el CD debe aportar | Una regla con tres números en vez de uno; M8 calcula un subflujo por marca dentro de la fila | **Sí** |

Por qué una tabla de reglas con vigencia y no una columna en `marca_gml_especial`: historial (el acuerdo de abastecimiento cambia), reglas por GMLE, y no obliga a que la marca sea relevante por la vía de 02b si mañana se usa el eje `por_marca`.

## 4. Flujo de pantalla (UX primero)

Ruta **`/maestros/intercompany`**, item "Intercompany" en Maestros de `nav.ts` (`PLANIFICACION`; el comprador no lo ve y la página lo redirige). Pestañas **Reglas · Historial** (Importar y Nueva vigencia en bloque: segunda entrega, por recomendación del revisor; hoy son decenas de reglas). Kit: `DataTable`, `Select`, `Input`, `Chips`, `Badge`, `Modal`, `Alert`, `EmptyState`; `useColeccion` para la lista plana de reglas. Filtros en la URL (`?marca=&genero=&mundo=&linea=&mes=2026-10&solo=`).

**Pestaña Reglas.** Una fila por clave con la regla **vigente en el mes elegido** (por defecto el mes en curso):

```
Intercompany · reglas vigentes en [oct-2026 ▾]   Filtros: [Marca ▾] [Género: HOMBRE ▾] [Mundo: FORMAL, CASUAL, RI ▾] [Línea ▾]  Solo: (no aplicables) (fuera de ámbito)
[+ Nueva regla]  [Excel]
Marca       GML / unidad                      Vigente desde  Cob. mín  Cob. tope  % directo  Aplicable                 Nota          Acciones
JH          HOMBRE · FORMAL · CAMISA             2026-01        2,0       4,0        80 %     Sí                        acuerdo 2026  [Nueva vigencia] [Historial]
JH          HOMBRE · FORMAL · CAMISA › M. CORTA  2026-06        1,5       3,0        50 %     Sí (GMLE: manda)          verano        [Nueva vigencia] [Historial]
DONATELLI   HOMBRE · FORMAL · TERNO              2025-03        3,0       6,0        60 %     Sí                        —             [Nueva vigencia] [Historial]
VAN HEUSEN  HOMBRE · CASUAL · POLO               2026-01        2,0       4,0        70 %     No: sin clave en la cerrada [Hacer relevante] [Nueva vigencia]
VAN HEUSEN  HOMBRE · RI · CASACA                 2026-01        2,0       5,0        40 %     Sí                        —             [Nueva vigencia] [Historial]
5 reglas vigentes · 1 no aplicable · 0 fuera de ámbito
```

**Nueva regla / Nueva vigencia** (`Modal`): marca (`Select` de unidades de marca activas; un miembro de conjunto se ofrece como su cabeza), GML (selector de nodos vigentes de 02b, filtrado por defecto a HOMBRE × FORMAL/CASUAL/RI, desactivable), equivalencia (solo si el nodo es `GMLE`, opcional), vigente desde (mes; por defecto el siguiente a hoy), cobertura mínima y tope (meses, un decimal; por defecto los de la regla anterior de la clave o `2,0` / `4,0`, supuesto a validar), % directo (0 a 100, un decimal; al lado "% del CD" calculado), nota (≤ 200). Validaciones en pantalla: clave + mes repetidos → "ya hay una regla de esa clave desde ese mes: edítala"; tope < mínimo → bloquea; marca sin clave en la cerrada vigente → aviso amarillo "se guardará como no aplicable hasta que VAN HEUSEN sea relevante en POLO y se cierre una proyección nueva" con atajo a 02b (`confirm`, no bloqueo).

**Pestaña Historial.** Por clave, la secuencia de reglas (`vigente_desde`, mínimo, tope, %, quién, cuándo, nota), con la derivada "hasta" calculada; una regla se puede **editar** (coberturas, porcentaje, nota) o **eliminar** (borra la fila; la anterior vuelve a regir desde entonces: `confirm` lo dice). Editar la fecha no: se elimina y se crea.

**Efecto visible en M8** (para que Javier lo vea en el hito): en el flujo de un GML-AM la fila muestra, desplegable, "de la cual JH (intercompany · cobertura esperada 2–4 m): demanda 480 · reposición directa esperada 384 · ingresos 0 · stock 900 · cobertura 1,9 → falta 60", y el resto de la fila con el 4–8 general.

### Qué decide el planner y qué decide el sistema

| Decisión | Quién |
|---|---|
| Qué marcas, qué GML, desde cuándo, qué cobertura esperada y qué porcentaje directo | planner (pantalla) |
| Cuál regla rige en cada mes; que la más específica mande | sistema (secuencia por `vigente_desde`) |
| Si una regla es aplicable | sistema (`part_B` en la cerrada), con enlace para corregir en 02b |
| Demanda, stock, reposición esperada, cobertura y saldo de cada marca intercompany por GML-AM-mes | M8, con la cerrada de M7 y el stock de M5 |

## 5. Método (lógica pura en `src/lib/intercompany/`)

1. **Regla vigente** `reglaVigente(reglas, clave, mes)`: entre las reglas activas de la clave, la de mayor `vigente_desde ≤ mes`; ninguna → `null`.
2. **Resolución de clave** `reglaIntercompany(reglas, marca, gml, equivalencia | null, mes)`: si hay regla vigente para `(marca, gml, equivalencia)` manda; si no, la de `(marca, gml, null)`; si no, `null`.
3. **"Hasta" derivado** `hastaDerivado(reglas, regla)`: el mes anterior al `vigente_desde` de la regla siguiente de la misma clave exacta, o `null` (abierta).
4. **Aplicabilidad** `aplicable(regla, participacionesCerrada)`: `part_B(g) = Σ` de las participaciones con `marca_id = B` (tipo `unidad` o `barrido`) en las filas de `g` de la cerrada; `> 0` → aplicable; si no, `{ aplicable: false, motivo: 'marca_sin_clave' }`. Sin cerrada → `{ aplicable: null, motivo: 'sin_cerrada' }` (la pantalla dice "se sabrá al cerrar una proyección").
5. **Subflujo intercompany** `subflujoIntercompany(D, part_B, S_B, I_B, regla, meses)` (vive en M8, se define aquí para la prueba compartida): `D^B_m = D_m × part_B`; `R^B_m = D^B_m × pct ÷ 100`; `S^B_m = S^B_{m−1} + I^B_m + R^B_m − D^B_m`; `cob^B_m = mesesCobertura(S^B_m, D^B_{m+1…})` (sobre la demanda **completa**); `obj^B_m = Σ_{j=m+1}^{m+min_B} D^B_j`, `tope^B_m` con `max_B`; `C^B_m = max(0, obj^B_m − (S*^B_{m−1} + I^B_m + R^B_m − D^B_m))` secuencial; `X^B_m = max(0, S^B_m − tope^B_m)`; señales con `min_B` / `max_B`. Propiedad: `R^B ≤ D^B` siempre (`pct ≤ 100`).
6. **Ámbito** `fueraDeAmbito(nodo)` = género ≠ HOMBRE o mundo ∉ {FORMAL, CASUAL, RI} (por códigos de M1; informativo).

## 6. Modelo de datos (`0020_intercompany.sql`)

Mismas convenciones de idempotencia y seguridad que `0019` (sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`; sin `do $$`; RLS sin políticas; `revoke`/`grant`). **Criterio I9 del revisor**: la base solo lleva invariantes **estructurales**; los catálogos y rangos de negocio van en zod, para poder aflojarlos sin `DROP`.

### 6.1 `intercompany_reglas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `marca_id` | `uuid not null → marcas on delete restrict` | la unidad de marca; la API rechaza un miembro (`409 marca_en_conjunto`) y VARIOS / OTROS / SIN MARCA (`409 marca_generica`) |
| `genero_mundo_linea_id` | `uuid not null → genero_mundo_linea on delete restrict` | |
| `equivalencia_id` | `uuid null → equivalencias on delete restrict` | la API exige que pertenezca al nodo (`409 equivalencia_de_otro_nodo`) |
| `vigente_desde` | `date not null` | `check (vigente_desde = date_trunc('month', vigente_desde)::date)`; primer día de mes (estructural) |
| `cobertura_min_meses` | `numeric(4,1) not null` | `check (cobertura_min_meses >= 0)`; que `tope ≥ mínimo` y los rangos razonables (`0,5` a `24`) los valida zod |
| `cobertura_max_meses` | `numeric(4,1) not null` | `check (cobertura_max_meses >= 0)` |
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
genero_mundo_linea (+ equivalencia si GMLE) ─────────────────────┼─► intercompany_reglas (vigente_desde, cob. mín, cob. tope, pct_directo) ─► reglaVigente(mes) · la más específica manda
proyección cerrada (M7): part_B = Σ participaciones con marca_id = B ─► aplicable(regla) ──────────────────────────────────────────────┤
stock_flujo(k') por unidad de marca (M5) + líneas de M9 con marca B ───────────────────────────────────────────────────────────────────┴─► M8: subflujo de B en la fila (D^B, S^B, I^B, R^B, cob^B con min_B/max_B, C^B, X^B) + resto de la fila con 4–8
```

## 7. Contratos de API y de lógica pura

Convenciones de siempre; handlers en `src/app/api/intercompany/`; lógica pura en `src/lib/intercompany/` (`tipos-api.ts`, `esquemas.ts`, `reglas.ts`, `subflujo.ts`, `excel.ts`); datos en `consultas.ts`. **Todo `requirePlanner`** (el comprador ve el efecto en M8, no la tabla).

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/intercompany/reglas` | GET | `?mes=aaaa-mm&incluir_historial=1` | `ReglaIntercompanyApi[]` (sin `incluir_historial`: solo la vigente de cada clave en `mes`, con `hasta_derivado`, `aplicable`, `motivo_no_aplicable`, `fuera_de_ambito`, nombres) |
| `/api/intercompany/reglas` | POST | `crearReglaSchema = { marca_id: uuid, genero_mundo_linea_id: uuid, equivalencia_id?: uuid\|null, vigente_desde: mes, cobertura_min_meses: 0.5..24 (1 decimal), cobertura_max_meses: 0.5..24 (≥ mínimo, `refine`), pct_directo: 0..100 (≤ 2 decimales), nota?: ≤ 200 }` | `201 ReglaIntercompanyApi`; `404` marca o nodo; `409 marca_en_conjunto`, `409 marca_generica`, `409 nodo_no_vigente`, `409 equivalencia_de_otro_nodo`, `409 clave_mes_repetido` |
| `/api/intercompany/reglas/[id]` | PATCH / DELETE | `editarReglaSchema = { cobertura_min_meses?, cobertura_max_meses?, pct_directo?, nota? }` (el `refine` de tope ≥ mínimo se evalúa con los valores resultantes) | `ReglaIntercompanyApi`; `DELETE` → `{ id, regla_anterior_id }` |
| `/api/intercompany/vigentes` | GET | `?desde=aaaa-mm&hasta=aaaa-mm` | **Contrato de M8**: `{ reglas: ReglaIntercompanyApi[] (todas las activas, con `hasta_derivado`), marcas: [{ marca_id, nombre }] }`; en código `leerReglasIntercompany(db)` |

Segunda entrega: `POST /api/intercompany/reglas/bloque` (nueva vigencia en bloque) y `POST /api/intercompany/importar` (columnas `MARCA`, `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA`, `DESDE`, `COB_MIN`, `COB_TOPE`, `PCT_DIRECTO`, `NOTA`; el archivo manda; `resolverGml` de 02b).

```ts
export type ReglaIntercompanyApi = { id: string; marca_id: string; marca: string; genero_mundo_linea_id: string; equivalencia_id: string | null; ruta: string; nivel: "GML" | "GMLE";
  vigente_desde: string; hasta_derivado: string | null; cobertura_min_meses: number; cobertura_max_meses: number; pct_directo: number; pct_cd: number; nota: string | null; usuario_nombre: string | null; updated_at: string;
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
2. **La más específica manda**: regla del GML (2–4, 80 %) y de la equivalencia MANGA CORTA (1,5–3, 50 %): MANGA CORTA → la específica, MANGA LARGA → la del GML; sin regla del GML, MANGA LARGA → `null`.
3. **Hasta derivado**: la regla de enero tiene `hasta = 2026-05` si hay otra de la **misma clave exacta** en junio; una regla de la equivalencia no cierra la del GML; eliminar la de junio deja la de enero abierta (`regla_anterior_id` apunta a enero).
4. **Aplicable**: JH con clave `unidad` en CAMISA (`part = 0,40`) → `true`; BETA al barrer con clave `barrido` en TERNO (`part = 0,50`) → `true` (sin reparto de M12); VAN HEUSEN sin tratamiento (su venta está en "otras") → `false` con `marca_sin_clave`; sin cerrada → `null` con `sin_cerrada`.
5. **Subflujo**: `D = 1 200`, `part = 0,40`, `pct = 80`, `min = 2`, `max = 4`, `S^B_k = 900`, sin ingresos → `D^B = 480`, `R^B = 384`, `S^B_{k+1} = 900 + 384 − 480 = 804`, `cob^B_{k+1} = 804 ÷ 480 = 1,675` (con demanda constante), `obj^B = 960` → `C^B_{k+1} = 960 − 804 = 156`, señal `falta` (`cob < 2`); con `pct = 0`, `R = 0` y `C` sube; `R^B ≤ D^B` siempre (propiedad).
6. **Ámbito**: HOMBRE·FORMAL, HOMBRE·CASUAL y HOMBRE·RI → dentro; MUJER·CASUAL y HOMBRE·URBANO → fuera (informativo; la regla se guarda igual).
7. **Secuencia**: `secuenciaPorClave` ordena por `vigente_desde` y nunca tiene dos reglas del mismo mes (lo garantiza el único de expresión; prueba SQL).
8. **Determinismo** de `subflujoIntercompany` y de la resolución: misma entrada, misma salida; sin reloj (recibe `mes`).
9. **Rechazos**: miembro de conjunto (JOHN) → `marca_en_conjunto` con `detalle` "usa JOHN HOLDEN (cabeza)"; VARIOS → `marca_generica`; nodo no vigente → `nodo_no_vigente`; equivalencia de otro nodo → `equivalencia_de_otro_nodo`; `pct` 100,5 → `400`; tope 1,5 con mínimo 2 → `400` (`refine`); `vigente_desde` que no es primer día de mes → `400`.
10. **Excel = tabla**: columnas y filas de `hojasIntercompany` coinciden con la `DataTable` y el filtro.
11. **SQL (humo local)**: `0020` aplica dos veces; el único de expresión rechaza dos reglas de la misma clave y mes con `equivalencia_id` nulo; el `check` de mes rechaza `2026-01-15`; `pct_directo = 101` se rechaza; `anon` no lee la tabla ni la vista; `intercompany_vigente.hasta_derivado` coincide con `hastaDerivado` sobre la fixture.
12. **Estático**: toda ruta bajo `/api/intercompany` usa `requirePlanner`; `src/lib/intercompany/` no importa `@supabase/*` fuera de `consultas.ts`; `nav.ts` marca el item con `PLANIFICACION`.

## 9. Casos sintéticos (`tests/intercompany.fixture.ts`)

Nodos: `HOMBRE · FORMAL · CAMISA` (GMLE: MANGA LARGA, MANGA CORTA), `HOMBRE · FORMAL · TERNO` (GML), `HOMBRE · CASUAL · POLO` (GML), `HOMBRE · RI · CASACA` (GML), `MUJER · CASUAL · POLO` (GML). Marcas: JOHN HOLDEN (RECONOCIDO, cabeza del conjunto con JOHN; relevante en CAMISA y POLO), DONATELLI (PREMIUM, relevante en TERNO), VAN HEUSEN (RECONOCIDO, **sin tratamiento** en la fixture base; en la variante "marcada" es relevante en POLO y CASACA), BETA (PREMIUM, al barrer), JOHN HOLDEN UNDERWEAR (marca aparte, fuera del conjunto). Reglas: JH·CAMISA 2026-01 (2–4, 80 %); JH·CAMISA›M. CORTA 2026-06 (1,5–3, 50 %); DONATELLI·TERNO 2025-03 (3–6, 60 %); VAN HEUSEN·POLO 2026-01 (2–4, 70 %); VAN HEUSEN·CASACA 2026-01 (2–5, 40 %); BETA·TERNO 2026-01 (2–4, 20 %). Cerrada con participaciones: CAMISA›M. LARGA × RECONOCIDO `{ unidad JH: 0,40, otras: 0,60 }`; TERNO × PREMIUM `{ unidad DONATELLI: 0,30, barrido BETA: 0,50, otras: 0,20 }`; POLO × RECONOCIDO `{ otras: 1,0 }` (VH sin clave).

1. Vigentes en oct-2026: seis reglas; VAN HEUSEN·POLO y ·CASACA `aplicable = false` (`marca_sin_clave`); BETA aplicable por su clave `barrido`; ninguna fuera de ámbito; en la variante "marcada" y con una cerrada nueva, VH pasa a aplicable.
2. `reglaIntercompany(JH, CAMISA, M. CORTA, 2026-05)` = la del GML (aún no rige la específica); en 2026-07 = la específica; `(JH, CAMISA, M. LARGA, 2026-07)` = la del GML.
3. Subflujo de JH en CAMISA › M. LARGA × RECONOCIDO, oct-2026: `D = 1 200` → `D^B = 480`, `R^B = 384`; `S^B_set = 900`; sin ingresos: `S^B_oct = 804`, `C^B_oct = 156`, `falta`; con una línea de JH · CAMISA › M. LARGA · 300 · nov · `intercompany_directo` → `I^B_nov = 300` (cuenta: el stock es completo) y `C^B_nov` baja; el resto de la fila (`D = 720`) se evalúa con 4–8.
4. `POST` JOHN·CAMISA → `409 marca_en_conjunto`; `POST` JOHN HOLDEN UNDERWEAR·CAMISA → se acepta (es otra unidad de marca; aviso informativo `fuera_de_marcas_sugeridas`); `POST` JH·CAMISA 2026-01 otra vez → `409 clave_mes_repetido`; `PATCH` a 85 % → `pct_cd = 15`.
5. `DELETE` de JH·CAMISA›M. CORTA → `regla_anterior_id = null` (la clave específica queda sin reglas; vuelve a mandar la del GML).
6. Historial de JH·CAMISA: la regla del GML sigue abierta (`hasta = null`) aunque exista la específica de junio: `hastaDerivado` es por clave exacta (reemplaza al caso 8 de la primera versión, que se corregía a sí mismo).

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · lint, tsc, vitest (más `tests/intercompany.*`), build, `validar-migraciones-local.sh`; `0020` aplicada; tipos regenerados; `APP_VERSION = 0.12.0 · M13`.

**Prerrequisitos de Javier** · JOHN HOLDEN, JOHN, DONATELLI y VAN HEUSEN cargadas como marcas; el conjunto JH (cabeza JOHN HOLDEN, miembro JOHN; UNDERWEAR, WOMAN y DONNA fuera); las tres unidades marcadas **relevantes** (`por_gml`) en los GML de hombre formal, casual y RI donde aplica (02b) **antes de cerrar la proyección** que lea M8; la lista de coberturas esperadas y porcentajes por GML.

**Hito (sección H de `cowork-checklist.md`, usuario planner)**
1. Como comprador: "Intercompany" no aparece, la URL redirige, `GET /api/intercompany/reglas` → `403`.
2. La pestaña Reglas abre filtrada a HOMBRE × FORMAL/CASUAL/RI y vacía (`EmptyState` con "Nueva regla").
3. ✍️ Crear una regla para JH en una camisa de hombre formal desde el mes siguiente con cobertura 2–4 y 80 % directo: aparece con "% del CD 20 %" y Aplicable "Sí" (si hay cerrada con clave de JH ahí) o "No: sin clave" con el atajo.
4. ✍️ "Nueva vigencia" sobre la misma clave dos meses después con 60 %: Historial muestra las dos con el "hasta" derivado; cambiar el mes del selector cambia cuál se ve vigente.
5. ✍️ Crear la regla de VAN HEUSEN en un polo de hombre casual: sale "No: sin clave en la cerrada" hasta marcarla relevante y cerrar una proyección nueva; hacerlo y verla aplicable.
6. Excel de la lista con el filtro de mundo.
7. (Tras construir M8) abrir el flujo de ese GML-AM y ver el subflujo de JH con demanda `D × part_JH`, reposición esperada `× 80 %`, su stock y su cobertura contra 2–4, y el resto de la fila contra 4–8.
8. ✍️ Eliminar las reglas de prueba si Javier no las quiere conservar.

## 11. Alcance

**Primera entrega (`0.12.0 · M13`)**: tabla de reglas con vigencia por mes y clave marca × GML (× equivalencia), con cobertura esperada (mínimo y tope) y porcentaje directo; la más específica manda; pantalla con reglas vigentes por mes, nueva regla, nueva vigencia individual, historial con editar y eliminar; `vigentes` para M8; aplicabilidad por la cerrada de M7; Excel.

**Segunda entrega**: nueva vigencia en bloque e importador (diferidos por el revisor); eje `por_marca` en las participaciones de M7 si marcar VH como relevante resulta incómodo; cobertura o porcentaje distintos por agrupación de talla; sugerencia del porcentaje a partir del histórico de compras de M9; reglas por tienda.

**Fuera de alcance**: registrar las compras directas del CD intercompany (M9: son ingresos al CD); calcular la demanda (M7); el flujo y el subflujo (M8, que importa `subflujoIntercompany` de aquí); una bandera "intercompany" en `marcas` o en `proveedores` (M9 tiene `proveedores.es_intercompany`).

## 12. Riesgos

- **Depende de que la marca tenga clave en la cerrada**: si VAN HEUSEN no se marca antes de cerrar, sus reglas quedan no aplicables y M8 la trata con el 4–8 general (la pantalla lo muestra y M8 lo lista en `intercompany_no_aplicable`).
- **Reposición directa esperada como ingreso**: es un supuesto (sección 14); si Javier prefiere no modelarla, `pct_directo` queda informativo y el saldo de la marca sube.
- **Doble conteo con líneas `intercompany_directo`**: una línea de M9 con ese destino se suma a `R^B`; si la compra directa registrada es la misma reposición regular, se cuenta dos veces. Aviso informativo `directo_con_regla` en la línea; `directo_sin_regla` si la marca no tiene regla.
- **Sin dato de origen en M5**: el porcentaje y la cobertura son un juicio del planner.
- **Reglas por mes**: una regla con `vigente_desde` en el pasado cambia el flujo de meses ya cerrados solo en las vistas; no hay reproceso.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M13: el intercompany es una tabla de reglas por marca × GML (× equivalencia) con vigencia por mes y sin `vigente_hasta` guardado; cada regla lleva cobertura esperada (mínimo y tope) y porcentaje directo; la más específica manda.** Descartado: columna en `marca_gml_especial`; porcentaje por marca sin GML; `vigente_hasta` editable.
2. **M13 + M8: el intercompany directo no recorta la demanda ni el stock; la marca se evalúa en un subflujo con demanda completa, stock completo, reposición directa esperada como ingreso y su cobertura esperada propia** (Javier, ronda 3; B2 del revisor). Descartado: demanda neta (primera versión); stock neto.
3. **M13: la aplicabilidad sale de la cerrada de M7 (`part_B` = suma de participaciones con `marca_id = B`, de cualquier tipo de clave), sin exigir reparto de M12; VAN HEUSEN se marca relevante antes de la cerrada.** Descartado para la primera entrega: eje `por_marca` en M7.
4. **M13: las marcas intercompany se derivan de las reglas; no hay bandera en `marcas`.**
5. **M13: el ámbito hombre formal, casual y RI es un filtro por defecto, no una restricción; la base solo lleva invariantes estructurales y los catálogos y rangos van en zod** (I9).

**Cambios que integra el `documentador`**: PLAN §4 (tabla `intercompany_reglas`, vista `intercompany_vigente`, migración `0020`, versión `0.12.0 · M13`), PLAN §5 (fila nueva M13), PLAN §7 (pendiente: lista de coberturas y porcentajes por GML; conjunto JH; marcar JH, DONATELLI y VAN HEUSEN como relevantes antes de la cerrada), ficha 02b ("Lo que M7 y M8 consumen": la clave en la cerrada habilita el intercompany), `cowork-checklist.md` sección H, `nav.ts`.

## 14. Preguntas para Javier (cuatro; mientras tanto rige la recomendación)

1. **¿La reposición directa regular se modela como ingreso esperado (`% directo × demanda de la marca`)?** Sin eso el saldo por comprar de JH pediría también lo que llega solo. **Recomendación: sí.**
2. **¿Cobertura esperada y porcentaje en unidades, iguales para centrales y extremas?** **Recomendación: sí en la primera entrega.**
3. **¿Valores iniciales?** Por defecto 2–4 meses y el porcentaje que entregues por GML. **Recomendación: que la lista traiga los tres números por marca y GML.**
4. **¿Marcar VAN HEUSEN (y JH y DONATELLI) como relevantes en 02b antes de cerrar la proyección, o prefieres que M7 gane un eje `por_marca`?** **Recomendación: marcarlas; el eje queda para la segunda entrega.**

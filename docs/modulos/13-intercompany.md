# M13 · Intercompany: porcentaje de la venta que llega directo y porcentaje que sale del CD

> Estado: **especificada el 2026-10-15, pendiente de revisión por el `arquitecto-revisor` y de aprobación por Javier.** Recoge las decisiones 6 y 10 de `08-09-definiciones-del-dueno.md`: para las marcas intercompany (JH, Donatelli y VH, maestros del dominio) y dentro de cada GML de **hombre formal y casual**, qué porcentaje de la venta viene **directo del intercompany por compras regulares** y cuánto **sale del CD**. Es un módulo propio, pequeño, que alimenta el flujo de M8. Migración prevista **`0020_intercompany.sql`**; versión prevista **`0.12.0 · M13`**, después de `0.11.0 · M12`; commits con prefijo `M13:`. Depende de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (marcas relevantes por GML, `marcas_unidad`), [01-arbol-producto](01-arbol-producto.md) (nodos) y [07-proyeccion-anual](07-proyeccion-anual.md) (`participaciones_historicas.por_clave_flujo`, que es por donde M8 sabe cuánto de un GML-AM es JH). Lo consume [08-flujo-y-compras](08-flujo-y-compras.md). Toda la API es `requirePlanner`. Sin datos reales: los porcentajes y los nodos de los ejemplos son inventados.

## 1. Objetivo

Parte de la venta de JH, Donatelli y VH en las líneas de hombre formal y casual no pasa por el centro de distribución: llega a las tiendas **directo del intercompany** por compras regulares (reposición continua). Si M8 comparara toda la venta proyectada contra el stock del CD, pediría comprar lo que ya llega solo. Este módulo guarda, por **marca × GML** (o GMLE) y con **vigencia en el tiempo**, el porcentaje que llega directo; M8 descuenta esa parte de la demanda que debe cubrirse con stock del CD y compras, y muestra el resto ("sale del CD") como lo que sí hay que abastecer. Se mantiene a mano (no hay dato histórico de origen de la mercadería en M5), con importador, historial y avisos cuando la configuración de 02b no permite aplicarlo.

## 2. Decidido por Javier (2026-10-15)

1. **Módulo propio de intercompany** para las líneas de hombre formales y casuales: qué porcentaje de la venta viene directo del intercompany por compras regulares y cuánto sale del CD (decisión 6).
2. **Por GML y marca**: para JH, Donatelli y VH, dentro de cada GML de hombre formal y casual (decisión 10).
3. Las compras que el administrador de producto hace **directo del CD intercompany** son otra cosa: son **ingresos al CD** y se registran como compras en M9 (decisión 5a). Este módulo no las toca; solo describe la parte que **no** pasa por nuestro CD.

Supuestos de esta ficha a validar (sección 14): el porcentaje es de **unidades**; aplica igual a tallas centrales y extremas; la marca es una **unidad de marca** de 02b (cabeza del conjunto si lo hay); el porcentaje se aplica a la **parte de la marca** dentro de la fila GML-AM de M7, que sale de `participaciones_historicas` y por tanto exige que la marca sea **relevante** en ese GML (02b).

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Marca intercompany** | Una unidad de marca (02b) para la que existe al menos una regla aquí. No hay bandera en `marcas`: la lista de marcas intercompany **se deriva** de las reglas (como la relación marca ↔ equivalencia se deriva de la venta). JH, Donatelli y VH son las de hoy; el módulo admite cualquier marca. |
| **Regla** | `(marca, GML, equivalencia opcional, vigente_desde, pct_intercompany)`: desde ese mes (inclusive) y hasta la regla siguiente de la misma clave, el `pct_intercompany` % de las unidades vendidas de esa marca en esa unidad llega directo; el `100 − pct` % sale del CD. |
| **Vigencia** | Las reglas de una clave forman una **secuencia por `vigente_desde`**; la vigente en el mes `m` es la de mayor `vigente_desde ≤ m`. No hay `vigente_hasta` guardado: se deriva (evita solapes y huecos y cualquier `UPDATE` de la fila anterior). Antes de la primera regla, 0 % (todo sale del CD). Una regla con `pct = 0` sirve para "terminar" el intercompany desde un mes. |
| **Clave** | `(marca_id, genero_mundo_linea_id, equivalencia_id)` con `equivalencia_id` nulo si la regla es del GML entero. Si el nodo es `GMLE`, una regla por GML aplica a todas sus equivalencias salvo las que tengan regla propia (**la más específica manda**). |
| **Ámbito sugerido** | Género HOMBRE y mundos FORMAL y CASUAL: es el filtro por defecto de la pantalla y del importador, **no** una restricción de la base (si mañana aplica a otra línea, se registra igual). Un nodo fuera del ámbito muestra el aviso `fuera_de_ambito`, informativo. |
| **Aplicable** | Una regla es aplicable en el flujo si su marca es **relevante vigente** en ese GML (02b) o, si es `barrido`/`mixta`, tiene reparto vigente (M12). Si no, M8 no tiene cómo saber cuánto del GML-AM es esa marca y la regla queda `no_aplicable` con motivo `marca_no_relevante`; la pantalla lo señala y enlaza a Marcas relevantes por GML. |
| **Demanda directa (`D^ic`)** | En M8, para la unidad `g`, agrupación `a` (la de la marca) y mes `m`: `D^ic_{g,a,m} = Σ_B D_{g,a,m} × part_{g,a}(B) × pct_{B,g,m} ÷ 100`, con `D` la venta proyectada de M7 (bloque todas) y `part` la participación de la clave `{ unidad, marca_id: B }` (o `{ barrido, marca_id: B }`) en `participaciones_historicas.por_clave_flujo` de la fila base. **No es un ingreso ni un stock**: es demanda que no hay que abastecer desde el CD. |

### Por qué una tabla de reglas con vigencia y no una columna en `marca_gml_especial`

| Opción | Qué da | Qué cuesta | Veredicto |
|---|---|---|---|
| **(a) Tabla `intercompany_reglas` con `vigente_desde` (recomendada)** | Historial (el porcentaje cambia cuando cambia el acuerdo de abastecimiento); reglas por GMLE; `pct = 0` para terminar; M8 lee por mes | Una tabla; la vigencia se deriva en TS y en una vista | **Sí** |
| (b) Columna `pct_intercompany` en `marca_gml_especial` | Cero tablas | Sin historial ni GMLE; obliga a que la marca sea relevante aunque sea al barrer; cambiar el % reescribe el pasado del flujo | No |
| (c) Porcentaje por marca (sin GML) | Más simple de mantener | Javier lo definió por GML: en camisa puede ser 80 % y en terno 0 % | No |

## 4. Flujo de pantalla (UX primero)

Ruta **`/maestros/intercompany`**, item "Intercompany" en Maestros de `nav.ts` (`PLANIFICACION`; el comprador no lo ve y la página lo redirige). Pestañas **Reglas · Historial · Importar**. Kit: `DataTable`, `Select`, `Input`, `Chips`, `Badge`, `Modal`, `Alert`, `EmptyState`; `useColeccion` para la lista plana de reglas (`GET /api/intercompany/reglas` devuelve un array). Filtros en la URL (`?marca=&genero=&mundo=&linea=&mes=2026-10&solo=`).

**Pestaña Reglas.** Una fila por clave con la regla **vigente en el mes elegido** (por defecto el mes en curso), el porcentaje y el estado:

```
Intercompany · reglas vigentes en [oct-2026 ▾]       Filtros: [Marca ▾] [Género: HOMBRE ▾] [Mundo: FORMAL, CASUAL ▾] [Línea ▾]  Solo: (no aplicables) (fuera de ámbito)
[+ Nueva regla]  [Nueva vigencia en bloque]  [Excel]
Marca       GML / unidad                     Vigente desde  % directo  % del CD  Aplicable            Nota                 Acciones
JH          HOMBRE · FORMAL · CAMISA            2026-01        80 %       20 %    Sí                   acuerdo 2026         [Nueva vigencia] [Historial]
JH          HOMBRE · FORMAL · CAMISA › M. CORTA 2026-06        50 %       50 %    Sí (GMLE: manda)     verano                [Nueva vigencia] [Historial]
DONATELLI   HOMBRE · FORMAL · TERNO             2025-03        60 %       40 %    No: no es relevante  —                    [Hacer relevante] [Nueva vigencia]
VH          HOMBRE · CASUAL · POLO              2026-01        70 %       30 %    Sí                   —                    [Nueva vigencia] [Historial]
VH          MUJER · CASUAL · POLO               2026-01        30 %       70 %    Sí · fuera de ámbito —                    [Nueva vigencia] [Historial]
5 reglas vigentes · 1 no aplicable · 1 fuera de ámbito
```

**Nueva regla / Nueva vigencia** (`Modal`): marca (`Select` de unidades de marca activas; un miembro de conjunto se ofrece como su cabeza), GML (selector de nodos vigentes de 02b, filtrado por defecto a HOMBRE × FORMAL/CASUAL, desactivable), equivalencia (solo si el nodo es `GMLE`, opcional), vigente desde (mes; por defecto el mes siguiente a hoy), % directo (0 a 100, un decimal; al lado "% del CD" calculado), nota (≤ 200). "Nueva vigencia" prellena la clave y propone el mes siguiente. Validaciones en pantalla: clave + mes repetidos → "ya hay una regla de esa clave desde ese mes: edítala"; marca no relevante en ese GML → aviso amarillo "se guardará como no aplicable hasta que JH sea relevante en CAMISA" con atajo a 02b (`confirm`, no bloqueo). **Nueva vigencia en bloque**: elegir varias filas, un mes y un porcentaje, y crear una regla por clave (patrón de la asignación en bloque de 02b).

**Pestaña Historial.** Por clave, la secuencia de reglas (`vigente_desde`, `%`, quién, cuándo, nota), con la derivada "hasta" calculada; una regla se puede **editar** (porcentaje, nota) o **eliminar** (borra la fila; la anterior vuelve a regir desde entonces: `confirm` lo dice). Editar la fecha no: se elimina y se crea (evita mover una regla por encima de otra).

**Pestaña Importar.** Columnas `MARCA`, `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA` (opcional), `DESDE` (`aaaa-mm`), `PCT_INTERCOMPANY` (0–100), `NOTA` (opcional). Mismo flujo de cuatro pasos (`use-importador`), `resolverGml` compartida con 02b; **el archivo manda** para la misma clave y mes (crea o actualiza el porcentaje y lo lista en `cambios[]`); nunca crea marcas ni árbol; omisiones: las de `resolverGml`, `marca_desconocida`, `marca_en_conjunto` (se ofrece la cabeza), `equivalencia_desconocida`, `desde_invalido`, `pct_invalido`, `duplicada_en_archivo`, `fila_total`; aviso (no omisión) `marca_no_relevante` y `fuera_de_ambito`. Plantilla CSV descargable. Idempotente.

**Efecto visible en M8** (para que Javier lo vea en el hito): en el flujo de un GML-AM la fila muestra "Demanda 1 200 · directo intercompany 384 (JH 80 % de su 40 %) · del CD 816".

### Qué decide el planner y qué decide el sistema

| Decisión | Quién |
|---|---|
| Qué marcas, qué GML, desde cuándo y qué porcentaje | planner (pantalla o importador) |
| Cuál regla rige en cada mes; que la más específica mande | sistema (secuencia por `vigente_desde`) |
| Si una regla es aplicable | sistema (relevancia de 02b o reparto de M12), con enlace para corregir |
| Cuánta demanda es directa en cada GML-AM-mes | M8, con `participaciones_historicas` de la cerrada de M7 |

## 5. Método (lógica pura en `src/lib/intercompany/`)

1. **Regla vigente** `reglaVigente(reglas, clave, mes)`: entre las reglas activas de la clave, la de mayor `vigente_desde ≤ mes`; ninguna → `null` (0 %).
2. **Resolución de clave** `pctIntercompany(reglas, marca, gml, equivalencia | null, mes)`: si hay regla vigente para `(marca, gml, equivalencia)` manda; si no, la de `(marca, gml, null)`; si no, 0.
3. **"Hasta" derivado** `hastaDerivado(reglas, regla)`: el mes anterior al `vigente_desde` de la regla siguiente de la misma clave, o `null` (abierta).
4. **Aplicabilidad** `aplicable(regla, configFlujo, repartosVigentes)`: la unidad de marca es relevante vigente en ese GML (clave `relevantes` de `construirConfigFlujo`), o su modalidad efectiva es `barrido`/`mixta` con reparto vigente que incluya ese GML; si no, `{ aplicable: false, motivo: 'marca_no_relevante' | 'sin_reparto' }`.
5. **Demanda directa** (vive en M8 pero se define aquí para que la prueba sea compartida) `demandaDirecta(D, participaciones, reglas, mes)` = `Σ_B D × part_B × pct_B(mes) ÷ 100`; `≤ D` siempre porque `Σ part ≤ 1` y `pct ≤ 100`.
6. **Ámbito** `fueraDeAmbito(nodo)` = género ≠ HOMBRE o mundo ∉ {FORMAL, CASUAL} (por códigos de M1, `H`, `FORMAL`, `CASUAL`; informativo).

## 6. Modelo de datos (`0020_intercompany.sql`)

Mismas convenciones de idempotencia y seguridad que `0019` (sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`; sin `do $$`; RLS sin políticas; `revoke`/`grant`).

### 6.1 `intercompany_reglas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `marca_id` | `uuid not null → marcas on delete restrict` | la unidad de marca; la API rechaza un miembro (`409 marca_en_conjunto`) y VARIOS / OTROS / SIN MARCA (`409 marca_generica`). `restrict`: eliminar una marca con reglas → `409` (hoy solo se eliminan marcas sin venta) |
| `genero_mundo_linea_id` | `uuid not null → genero_mundo_linea on delete restrict` | |
| `equivalencia_id` | `uuid null → equivalencias on delete restrict` | la API exige que pertenezca al nodo (`409 equivalencia_de_otro_nodo`) |
| `vigente_desde` | `date not null` | `check (vigente_desde = date_trunc('month', vigente_desde)::date)`; primer día de mes |
| `pct_intercompany` | `numeric(5,2) not null` | `check between 0 and 100` |
| `nota` | `text null` | `check (nota is null or length(nota) between 1 and 200)` |
| `perfil_id → perfiles on delete set null`, `usuario_nombre text` | | quién la creó o editó por última vez |
| `activo` | `boolean not null default true` | por convención y **sin uso**: eliminar borra la fila (criterio de `marca_gml_especial`) |
| `created_at`, `updated_at` | | trigger |

Único **`intercompany_reglas_clave_uniq` sobre `(marca_id, genero_mundo_linea_id, coalesce(equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid), vigente_desde)`** (índice único de expresión, porque `null` no colisiona en un `unique` normal). Índices `(genero_mundo_linea_id)` y `(marca_id)`. Sin seed. Tamaño: decenas o pocos cientos de filas.

### 6.2 Vista `intercompany_vigente` (contrato SQL opcional para M8)

`create or replace view … with (security_invoker = true)`: una fila por regla con `hasta_derivado` (`lead(vigente_desde) over (partition by clave order by vigente_desde) − 1 mes`) y las columnas de la marca y el nodo. M8 la puede leer con un `where vigente_desde <= :mes and (hasta_derivado is null or hasta_derivado >= :mes)`; en código, `leerReglasIntercompany(db)` trae todas las reglas (son pocas) y `pctIntercompany` resuelve en TS. La vista existe para consultas a mano y para la prueba SQL de que TS y SQL coinciden. `revoke` a `anon`/`authenticated`, `grant select to service_role`.

### Diagrama

```
marcas (unidad de marca; JH, DONATELLI, VH) ─┐
genero_mundo_linea (+ equivalencia si GMLE) ─┼─► intercompany_reglas (vigente_desde, pct_intercompany) ─► reglaVigente(mes) · la más específica manda
                                             │                                                               │
marca_gml_especial_vigente (02b) / repartos_marca_barrido (M12) ─► aplicable(regla) ─────────────────────────┤
proyección cerrada (M7): D_{g,a,m} + participaciones_historicas.por_clave_flujo ─────────────────────────────┴─► M8: D^ic (directo) y D − D^ic (del CD)
```

## 7. Contratos de API y de lógica pura

Convenciones de siempre; handlers en `src/app/api/intercompany/`; lógica pura en `src/lib/intercompany/` (`tipos-api.ts`, `esquemas.ts`, `reglas.ts`, `importar.ts`, `excel.ts`); datos en `consultas.ts`. **Todo `requirePlanner`** (maestro de planificación; el comprador ve el efecto en M8, no la tabla).

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/intercompany/reglas` | GET | `?mes=aaaa-mm&incluir_historial=1` | `ReglaIntercompanyApi[]` (sin `incluir_historial`: solo la vigente de cada clave en `mes`, con `hasta_derivado`, `aplicable`, `motivo_no_aplicable`, `fuera_de_ambito`, nombres de marca y nodo) |
| `/api/intercompany/reglas` | POST | `crearReglaSchema = { marca_id: uuid, genero_mundo_linea_id: uuid, equivalencia_id?: uuid\|null, vigente_desde: mes, pct_intercompany: number 0..100 (≤ 2 decimales), nota?: ≤ 200 }` | `201 ReglaIntercompanyApi`; `404` marca o nodo; `409 marca_en_conjunto`, `409 marca_generica`, `409 nodo_no_vigente`, `409 equivalencia_de_otro_nodo`, `409 clave_mes_repetido` |
| `/api/intercompany/reglas/[id]` | PATCH / DELETE | `editarReglaSchema = { pct_intercompany?, nota? }` | `ReglaIntercompanyApi`; `DELETE` → `{ id, regla_anterior_id }` (la que vuelve a regir, o `null`) |
| `/api/intercompany/reglas/bloque` | POST | `{ claves: [{ marca_id, genero_mundo_linea_id, equivalencia_id? }] (1..200), vigente_desde: mes, pct_intercompany, nota? }` | `{ creadas, sin_cambio, no_permitidas: [{ clave, motivo }] }` |
| `/api/intercompany/importar` | POST | `importarIntercompanySchema = { modo: 'previsualizar'\|'aplicar', filas: [{ marca, genero, mundo, linea, equivalencia?, desde, pct_intercompany, nota? }] (1..5000) }` | reporte (`totales`, `a_crear[]`, `cambios[]` de → a, `existentes`, `omitidas[]` con motivo, `avisos[]`) |
| `/api/intercompany/vigentes` | GET | `?desde=aaaa-mm&hasta=aaaa-mm` | **Contrato de M8**: `{ reglas: ReglaIntercompanyApi[] (todas las activas, con `hasta_derivado`), marcas: [{ marca_id, nombre }] }`; en código `leerReglasIntercompany(db)` |

```ts
export type ReglaIntercompanyApi = { id: string; marca_id: string; marca: string; genero_mundo_linea_id: string; equivalencia_id: string | null; ruta: string; nivel: "GML" | "GMLE";
  vigente_desde: string; hasta_derivado: string | null; pct_intercompany: number; pct_cd: number; nota: string | null; usuario_nombre: string | null; updated_at: string;
  aplicable: boolean; motivo_no_aplicable: "marca_no_relevante" | "sin_reparto" | null; fuera_de_ambito: boolean };
```

| Función pura | Reglas |
|---|---|
| `reglaVigente`, `pctIntercompany`, `hastaDerivado`, `secuenciaPorClave` | 1–3, 7 |
| `aplicable(regla, configFlujo, repartos)` | 4 |
| `demandaDirecta(D, participaciones, reglas, mes)` | 5, 8 |
| `fueraDeAmbito(nodo, catalogos)` | 6 |
| `motivoRechazoRegla(entrada, estado)` | 9 |
| `previsualizarImportacion(filas, estado)` | 10 |
| `hojasIntercompany(filas)` | 11 |

## 8. Reglas de negocio (vitest)

1. **Vigente por mes**: reglas de una clave en ene-2026 (80 %) y jun-2026 (50 %): en may-2026 rige 80, en jun-2026 50, en dic-2025 ninguna (0 %); una regla inactiva no cuenta.
2. **La más específica manda**: regla del GML 80 % y de la equivalencia MANGA CORTA 50 %: MANGA CORTA → 50, MANGA LARGA → 80; sin regla del GML, MANGA LARGA → 0.
3. **Hasta derivado**: la regla de enero tiene `hasta = 2026-05`; la de junio, `null`; eliminar la de junio deja la de enero abierta (`regla_anterior_id` en la respuesta del `DELETE` apunta a enero cuando se borra junio).
4. **Aplicable**: JH relevante en CAMISA → `true`; DONATELLI no relevante en TERNO → `false` con `marca_no_relevante`; BETA al barrer con reparto vigente que incluye el GML → `true`; sin reparto → `sin_reparto`.
5. **Demanda directa**: `D = 1 200`, `part_JH = 0,40`, `pct = 80` → `384`; dos marcas → suma; `pct = 0` → 0; nunca `> D` (propiedad con `part` que suman ≤ 1).
6. **Ámbito**: HOMBRE·FORMAL y HOMBRE·CASUAL → dentro; MUJER·CASUAL y HOMBRE·URBANO → fuera (informativo; la regla se guarda igual).
7. **Secuencia**: `secuenciaPorClave` ordena por `vigente_desde` y nunca tiene dos reglas del mismo mes (lo garantiza el único de expresión; prueba SQL).
8. **Determinismo** de `demandaDirecta` y de la resolución: misma entrada, misma salida; sin reloj (recibe `mes`).
9. **Rechazos**: miembro de conjunto → `marca_en_conjunto`; VARIOS → `marca_generica`; nodo no vigente → `nodo_no_vigente`; equivalencia de otro nodo → `equivalencia_de_otro_nodo`; `pct` 100,5 → `400`; `vigente_desde` que no es primer día de mes → `400` (zod normaliza `aaaa-mm` a primer día).
10. **Importador**: el archivo manda para la misma clave y mes (`cambios[]` con `de → a`); una fila con marca miembro se omite con `marca_en_conjunto` y `detalle` "usa JH (cabeza)"; reimportar → `a_crear = 0`, `cambios = 0`; `marca_no_relevante` es aviso, no omisión.
11. **Excel = tabla**: columnas y filas de `hojasIntercompany` coinciden con la `DataTable` y el filtro.
12. **SQL (humo local)**: `0020` aplica dos veces; el único de expresión rechaza dos reglas de la misma clave y mes con `equivalencia_id` nulo; el `check` de mes rechaza `2026-01-15`; `anon` no lee la tabla ni la vista; `intercompany_vigente.hasta_derivado` coincide con `hastaDerivado` sobre la fixture.
13. **Estático**: toda ruta bajo `/api/intercompany` usa `requirePlanner`; `src/lib/intercompany/` no importa `@supabase/*` fuera de `consultas.ts`; `nav.ts` marca el item con `PLANIFICACION`.

## 9. Casos sintéticos (`tests/intercompany.fixture.ts`)

Nodos: `HOMBRE · FORMAL · CAMISA` (GMLE: MANGA LARGA, MANGA CORTA), `HOMBRE · FORMAL · TERNO` (GML), `HOMBRE · CASUAL · POLO` (GML), `MUJER · CASUAL · POLO` (GML). Marcas: JH (RECONOCIDO, relevante en CAMISA y POLO), DONATELLI (PREMIUM, sin GML relevantes), VH (RECONOCIDO, relevante en POLO HOMBRE y POLO MUJER), BETA (PREMIUM, al barrer, reparto vigente con TERNO 100 %), JH SPORT (miembro de JH). Reglas: JH·CAMISA 2026-01 80 %; JH·CAMISA›M. CORTA 2026-06 50 %; DONATELLI·TERNO 2025-03 60 %; VH·POLO H 2026-01 70 %; VH·POLO M 2026-01 30 %; BETA·TERNO 2026-01 20 %.

1. Vigentes en oct-2026: seis reglas; DONATELLI `aplicable = false` (`marca_no_relevante`); VH·POLO M `fuera_de_ambito`; BETA aplicable por reparto.
2. `pctIntercompany(JH, CAMISA, M. CORTA, 2026-05)` = 80 (aún no rige la específica); en 2026-07 = 50; `(JH, CAMISA, M. LARGA, 2026-07)` = 80.
3. `demandaDirecta` en CAMISA › M. LARGA × RECONOCIDO, oct-2026, `D = 1 200`, participaciones `{ JH: 0,40, otras: 0,60 }` → 384 directo, 816 del CD; en TERNO × PREMIUM con `D = 300`, participaciones `{ barrido BETA: 0,5 }` → 30 directo (20 % de 150); DONATELLI no aporta (no aplicable).
4. `POST` JH SPORT·CAMISA → `409 marca_en_conjunto`; `POST` JH·CAMISA 2026-01 otra vez → `409 clave_mes_repetido`; `PATCH` a 85 % → cambia `pct_cd` a 15.
5. `DELETE` de JH·CAMISA›M. CORTA → `regla_anterior_id = null` (la clave específica queda sin reglas; vuelve a mandar la del GML, 80 %).
6. Importar un CSV con las seis reglas más `JH SPORT, HOMBRE, FORMAL, TERNO, 2026-03, 40` y `JH, HOMBRE, FORMAL, CAMISA, 2026-01, 85` → `cambios = 1` (80 → 85), `omitidas = 1` (`marca_en_conjunto`), resto `existentes`; reimportar → nada.
7. Bloque: `{ claves: [JH·CAMISA, VH·POLO H], vigente_desde: 2027-01, pct: 75 }` → `creadas = 2`; repetir → `sin_cambio = 2`.
8. Historial de JH·CAMISA: enero (`hasta 2026-05` **no**: la específica es otra clave; la regla del GML sigue abierta, `hasta = null`) — la prueba deja claro que `hastaDerivado` es por clave exacta.

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · lint, tsc, vitest (más `tests/intercompany.*`), build, `validar-migraciones-local.sh`; `0020` aplicada; tipos regenerados; `APP_VERSION = 0.12.0 · M13`.

**Prerrequisitos de Javier** · JH, Donatelli y VH cargadas como marcas (con sus conjuntos si los hay) y marcadas **relevantes** en los GML de hombre formal y casual donde aplica (02b); la lista de porcentajes por GML (puede venir en la plantilla del importador).

**Hito (sección H de `cowork-checklist.md`, usuario planner)**
1. Como comprador: "Intercompany" no aparece, la URL redirige, `GET /api/intercompany/reglas` → `403`.
2. La pestaña Reglas abre filtrada a HOMBRE × FORMAL/CASUAL y vacía (`EmptyState` con "Nueva regla" e "Importar").
3. ✍️ Crear una regla para JH en una camisa de hombre formal desde el mes siguiente con 80 %: aparece con "% del CD 20 %" y Aplicable "Sí" (si JH es relevante ahí) o "No: no es relevante" con el atajo.
4. ✍️ "Nueva vigencia" sobre la misma clave dos meses después con 60 %: Historial muestra las dos con el "hasta" derivado; cambiar el mes del selector de la lista cambia cuál se ve vigente.
5. ✍️ Importar la plantilla con las reglas reales (previsualizar: ver `a_crear`, `cambios`, omitidas con motivo; aplicar; reimportar sin cambios).
6. Excel de la lista con el filtro de mundo.
7. (Tras construir M8) abrir el flujo de ese GML-AM y ver "directo intercompany" y "del CD" con la cifra esperada: `D × participación de JH × 80 %`.
8. ✍️ Eliminar la regla de prueba del paso 3 y 4 si Javier no las quiere conservar.

## 11. Alcance

**Primera entrega (`0.12.0 · M13`)**: tabla de reglas con vigencia por mes y clave marca × GML (× equivalencia), la más específica manda; pantalla con reglas vigentes por mes, nueva regla, nueva vigencia individual y en bloque, historial con editar y eliminar; importador; `vigentes` para M8; aplicabilidad por 02b/M12; Excel.

**Segunda entrega**: porcentaje distinto por agrupación de talla (hoy igual para centrales y extremas); sugerencia del porcentaje a partir del histórico de compras de M9 (ingresos al CD de la marca frente a su venta); reglas por tienda (si algún día una tienda recibe directo y otra no); % en soles.

**Fuera de alcance**: registrar las compras directas del CD intercompany (M9: son ingresos al CD); calcular la demanda (M7); el flujo (M8); una bandera "intercompany" en `marcas` o en `proveedores` (M9 tiene `proveedores.es_intercompany` para las compras; aquí la lista se deriva de las reglas).

## 12. Riesgos

- **Depende de que la marca sea relevante en el GML** (o tenga reparto si es al barrer): si Javier no carga la hoja de GML de 02b, las reglas quedan no aplicables y M8 pedirá comprar de más. La pantalla lo muestra en rojo y M8 lo lista en sus avisos (`intercompany_no_aplicable`).
- **Porcentaje de unidades aplicado a una participación histórica**: si la participación de JH en el GML cambia (M7 la recalcula en cada cerrada), la demanda directa se mueve aunque la regla no cambie; es lo esperado, pero conviene que Javier lo sepa.
- **Sin dato de origen en M5**: el porcentaje es un juicio del planner; no hay cómo validarlo contra la venta hasta que M9 acumule compras (segunda entrega).
- **Reglas por mes**: una regla con `vigente_desde` en el pasado cambia el flujo de meses ya cerrados solo en las vistas (el flujo de M8 es a demanda); no hay reproceso.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M13: el intercompany es una tabla de reglas por marca × GML (× equivalencia) con vigencia por mes y sin `vigente_hasta` guardado; la más específica manda y `pct = 0` termina un acuerdo.** Descartado: columna en `marca_gml_especial`; porcentaje por marca sin GML; `vigente_hasta` editable.
2. **M13: la demanda directa se calcula en M8 como demanda × participación histórica de la marca × porcentaje, y exige que la marca sea relevante en el GML (o tenga reparto si es al barrer).** Descartado: aplicar el porcentaje al GML entero sin distinguir marca.
3. **M13: las marcas intercompany se derivan de las reglas; no hay bandera en `marcas`.**
4. **M13: el ámbito hombre formal y casual es un filtro por defecto, no una restricción.**

**Cambios que integra el `documentador`**: PLAN §4 (tabla `intercompany_reglas`, vista `intercompany_vigente`, migración `0020`, versión `0.12.0 · M13`), PLAN §5 (fila nueva M13), PLAN §7 (pendiente: lista de porcentajes por GML y marcar JH/Donatelli/VH como relevantes), ficha 02b ("Lo que M7 y M8 consumen": la relevancia habilita el intercompany), `cowork-checklist.md` sección H, `nav.ts`.

## 14. Preguntas para Javier (cinco; mientras tanto rige la recomendación)

1. **¿Porcentaje de unidades o de soles?** **Recomendación: unidades**, porque el flujo de M8 es en unidades y así se descuenta directo de la demanda.
2. **¿Aplica igual a tallas centrales y extremas?** **Recomendación: sí en la primera entrega**; si las extremas no llegan directo, es un campo más por regla (segunda entrega).
3. **¿El porcentaje es por GML entero o lo necesitas por equivalencia en las líneas abiertas a GMLE?** **Recomendación: por GML, con la posibilidad de afinar por equivalencia cuando haga falta (la más específica manda).**
4. **¿JH, Donatelli y VH están (o estarán) marcadas como relevantes en esos GML?** Sin eso, M8 no sabe qué parte del GML es de cada marca. **Recomendación: sí, cargarlas en la hoja de GML de 02b antes del hito; si prefieres no marcarlas relevantes, hay que definir la participación de otra forma (el análisis de M12 ampliado a marcas `por_gml`).**
5. **¿Un solo porcentaje por marca y GML, o cambia con la temporada?** **Recomendación: uno, con vigencias por mes para cambiarlo cuando cambie el acuerdo**; si cambia cada temporada, se registran dos vigencias al año.

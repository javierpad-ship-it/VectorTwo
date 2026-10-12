# M5b · Mapeo de combinaciones históricas (mejora de M5)

> Estado: **especificación urgente, pendiente de aprobación por Javier (2026-10-12)**. No hay código ni migración. Mejora de [05-venta-stock](05-venta-stock.md) (construido, `0.8.0 · M5`); toca el resolutor, el informe y la pantalla de carga de M5 y usa el árbol de [01-arbol-producto](01-arbol-producto.md) (nodos GML, equivalencia `-` = igual a la línea, genérica `SIN EQUIVALENCIA`). Contexto de [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md): un destino "GML" o "GMLE" es siempre, en los hechos, una `equivalencia_id`. Versión `0.8.1 · M5`, migración **`0008_mapeo_combinaciones.sql`**; por eso 02b pasa a `0009` / `0.8.2 · M2b` y M6 a `0010` (renumeración anotada en esas fichas y en `docs/PLAN.md`). Ningún dato real de Lukers: géneros, líneas y equivalencias de ejemplo son inventados.

## Objetivo

Al cargar el histórico (2023 en adelante) aparecen combinaciones género/mundo/línea/equivalencia que ya no existen en el árbol o cambiaron de nombre, y hoy se excluyen como error (`equivalencia_inexistente`, `nodo_inexistente`, `linea_desconocida`, `genero_desconocido`, `mundo_desconocido`, `clasificacion_incompleta`); en un mes pueden pasar del 2 % y bloquearlo. Pedido de Javier: "necesito poder cargar los errores a las GML o GMLE existentes, seleccionándolo yo; si le pones una lógica que sugiera algo, sería mejor". Esta mejora añade un **mapeo persistente** origen (texto del archivo) → destino (una equivalencia vigente), que el resolutor aplica solo cuando el árbol no resuelve, con selección desde el reporte previo, sugerencia determinista como ayuda, administración con CSV, y recálculo del reporte sin releer el archivo. El árbol no se crea ni se modifica desde aquí: si la combinación debe existir, sigue el camino de "formato árbol" → importador de M1.

## Decisiones de diseño

| Tema | Decisión | Por qué |
|---|---|---|
| Qué se mapea | Un **origen exacto** (`genero`, `mundo`, `linea`, `equivalencia` tal como llegan a `previsualizar`: normalizados con `normalizarNombre`, con `-` ya sustituido por el nombre de la línea y vacío por `SIN EQUIVALENCIA`) → una **`equivalencia_id`** | Es la clave que el acumulador ya envía (`CombinacionPeticion`); el destino "GML" es el nodo con su equivalencia `-` (la que se llama como la línea), o la genérica, elegida explícitamente |
| Comodín | Solo `*` en `origen_equivalencia`: "cualquier equivalencia de esa terna que no resuelva" → una equivalencia fija. No hay comodín en género, mundo ni línea | Cubre "toda una línea histórica a otra" sin crear N filas y sin esperar a que cada equivalencia vieja aparezca en otro año. Un comodín en la terna sería una regla de renombre (otro mecanismo), fuera de alcance |
| Precedencia | **El árbol manda**: el mapeo se consulta solo si el resolutor devuelve algo distinto de `ok` (inexistente o inactivo). Exacto antes que comodín. Nunca se encadena: el destino es un id del árbol, no un texto que vuelva a resolverse | Sin encadenamiento no hay ciclos por construcción. Un origen que después se crea en el árbol deja el mapeo **obsoleto** (se muestra, no se aplica) |
| Destino no vigente | Equivalencia, nodo, línea, género o mundo del destino inactivos → el mapeo **no se aplica**, la fila conserva su motivo original y el reporte avisa (`mapeos_no_aplicables`) | Nunca se carga a un destino que el maestro dice que no debe aparecer |
| Qué sigue siendo error | Mapeables: los cinco motivos de combinación inexistente, los cinco inactivos y `clasificacion_incompleta`. **No** mapeables: `sin_clasificar` (los tres en blanco; decisión de Javier de excluir), tienda, marca, talla, cifras, mes | Tiendas ya tienen su mecanismo (M4, desactivar); marcas no tienen alias por decisión; una fila sin ninguna clasificación no tiene origen que mapear (pregunta 2) |
| Efecto en lo cargado | El hecho se guarda con la `equivalencia_id` destino, sin marca alguna en la fila; el `reporte` de la carga guarda qué mapeos se aplicaron y cuánto pesaron. Borrar o cambiar un mapeo **no toca** cargas publicadas: el efecto se ve al recargar el mes | Mismo criterio que el árbol vigente: los hechos no copian texto; la auditoría va en `reporte` |
| Recalcular | Al guardar mapeos desde el reporte, el navegador vuelve a llamar a `previsualizar` con la **misma petición** (valores distintos, < 1 MB) y reconstruye el informe con el **acumulador que sigue en memoria**; el archivo no se relee | Es el camino que ya existe; cuesta 1 a 2 s y trae además el árbol fresco |
| Sugerencia | TypeScript puro y determinista (`sugerir-mapeo.ts`), calculada en el servidor (tiene el árbol), **nunca aplicada sola**; 3 mejores con puntuación y razón | Ayuda, no automatismo (criterio de 02b para sugerencias) |

Descartado: tabla de renombres de línea (segundo mecanismo), mapeo con vigencia por fecha (el árbol vigente rige todo el histórico, DECISIONES 2026-10-11), aplicar mapeos retroactivamente con `update` sobre los hechos (los hechos son inmutables; se recarga el mes).

## Modelo de datos

Migración `supabase/migrations/0008_mapeo_combinaciones.sql`, idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`, sin bloques `do $$`, trigger con `create or replace trigger`, RLS activo sin políticas, estilo de la `0007`. No hay vistas ni funciones nuevas (nada que revocar). `venta_stock_mensual`, `cargas_venta_stock` y `equivalencias` no cambian.

### `mapeos_combinacion`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `origen_genero`, `origen_mundo`, `origen_linea` | `text not null` | Normalizados (`normalizarNombre`); `''` permitido en uno o dos (origen de `clasificacion_incompleta`); `check (origen_genero <> '' or origen_mundo <> '' or origen_linea <> '')` (los tres vacíos es `sin_clasificar`, no mapeable); `length(...) <= 120` cada uno |
| `origen_equivalencia` | `text not null` | Ya sustituida (`-` → nombre de la línea, vacío → `SIN EQUIVALENCIA`) o `*` (comodín); `check (origen_equivalencia <> '' and length(origen_equivalencia) <= 120)` |
| `equivalencia_id` | `uuid not null` | FK `mapeos_combinacion_equivalencia_id_fkey` → `equivalencias(id)` **`on delete cascade`**: un mapeo sin destino no sirve para nada, y una equivalencia con hechos ya no se puede eliminar (M5). Índice `mapeos_combinacion_equivalencia_idx` |
| `motivo_origen` | `text null` | Con qué motivo se creó (`linea_desconocida`, …); informativo; `check (motivo_origen is null or motivo_origen in (<los 11 mapeables>))` |
| `nota` | `text null` | `check (nota is null or length(nota) <= 200)` |
| `perfil_id`, `usuario_nombre` | `uuid null` FK `perfiles(id) on delete set null` · `text null` | Quién lo creó; mismo patrón que `cargas_venta_stock`. Índice por `perfil_id` |
| `activo` | `boolean not null default true` | **Con uso**: un mapeo inactivo no se aplica (pausarlo sin borrarlo) |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `set_updated_at` |

Único **`mapeos_combinacion_origen_uniq (origen_genero, origen_mundo, origen_linea, origen_equivalencia)`**: un origen tiene un solo destino (activo o no). Volumen: cientos de filas; se cargan enteras en `previsualizar` con `leerTodo`.

```
archivo (G/M/L/E texto) ─► resolutor del árbol ─ ok ──────────────────────────► equivalencia_id (árbol manda)
                                 └─ no ok ─► mapeos_combinacion (exacto, luego terna + '*', solo activos y con destino vigente)
                                                 ├─ hay ─► equivalencia_id destino  (+ aviso "reasignadas por mapeo")
                                                 └─ no hay ─► motivo original (error o decisión, como hoy)
```

## Contratos de API

Todas `requirePlanner` (como toda la API de M5), `{ data }` / `{ error }` de `respuestas.ts`, esquemas zod en `src/lib/ventas/esquemas.ts`, ids con `idDeRuta`, errores de base con `traducirErrorDb`. Handlers en `src/app/api/ventas/mapeos/`. Tipos en el archivo nuevo **`src/lib/ventas/tipos-mapeo.ts`** (autocontenido, como `tipos-api.ts`): backend y frontend lo escriben primero, juntos, y después cada uno trabaja contra él.

```ts
// src/lib/ventas/tipos-mapeo.ts
import type { CombinacionPeticion, Periodo } from "./tipos-api";
export const COMODIN_EQUIVALENCIA = "*";
export type MotivoMapeable =
  | "genero_desconocido" | "mundo_desconocido" | "linea_desconocida" | "nodo_inexistente" | "equivalencia_inexistente"
  | "genero_inactivo" | "mundo_inactivo" | "linea_inactiva" | "nodo_inactivo" | "equivalencia_inactiva"
  | "clasificacion_incompleta";
export type OrigenMapeo = CombinacionPeticion;                      // ya normalizado y sustituido; equivalencia puede ser "*"
export type DestinoMapeo = { equivalencia_id: string; genero: string; mundo: string; linea: string; equivalencia: string; es_generica: boolean; vigente: boolean };
export type EstadoMapeo = "vigente" | "inactivo" | "obsoleto" | "destino_inactivo";   // obsoleto = el origen hoy resuelve en el árbol
export type MapeoApi = { id: string; origen: OrigenMapeo; destino: DestinoMapeo; motivo_origen: MotivoMapeable | null; nota: string | null;
  usuario_nombre: string | null; activo: boolean; estado: EstadoMapeo; created_at: string; updated_at: string };
export type MapeosRespuesta = { mapeos: MapeoApi[]; resumen: Record<EstadoMapeo, number> };
export type CrearMapeoItem = { origen: OrigenMapeo; equivalencia_id: string; motivo_origen?: MotivoMapeable; nota?: string };
export type CrearMapeosPeticion = { mapeos: CrearMapeoItem[]; reemplazar?: boolean };          // 1..500
export type CrearMapeosRespuesta = { creados: number; actualizados: number; sin_cambio: number; mapeos: MapeoApi[] };
export type EditarMapeoPeticion = { equivalencia_id?: string; nota?: string | null; activo?: boolean };
export type SugerenciaMapeo = { equivalencia_id: string; genero: string; mundo: string; linea: string; equivalencia: string;
  puntuacion: number; razon: string; fuerte: boolean };
export type SugerirPeticion = { combinaciones: OrigenMapeo[] };                                   // 1..500, sin "*"
export type SugerirRespuesta = { sugerencias: SugerenciaMapeo[][] };                              // misma posición; [] = sin sugerencia
export type FilaMapeoCsv = { ORIGEN_GENERO: string; ORIGEN_MUNDO: string; ORIGEN_LINEA: string; ORIGEN_EQUIVALENCIA: string;
  DESTINO_GENERO: string; DESTINO_MUNDO: string; DESTINO_LINEA: string; DESTINO_EQUIVALENCIA: string; NOTA?: string };
export type MotivoOmisionMapeo = "origen_sin_clasificar" | "origen_existe_en_arbol" | "origen_repetido_en_archivo" | "destino_no_resuelve"
  | "destino_inactivo" | "existente_igual" | "existente_distinto";
export type ImportarMapeosPeticion = { modo: "previsualizar" | "aplicar"; filas: FilaMapeoCsv[] };  // 1..5 000
export type ImportarMapeosRespuesta = { recibidas: number; crear: number; creados: number; omitidas: { motivo: MotivoOmisionMapeo; fila: number; detalle: string }[] };
```

Cambios en `tipos-api.ts` (aditivos): `ResultadoCombinacionError` suma `"clasificacion_incompleta"`; la variante `ok` de `ResolucionCombinacionApi` suma `mapeo?: { id: string; motivo_original: MotivoMapeable }`; `PrevisualizarRespuesta` suma `mapeos_no_aplicables: { id: string; origen: OrigenMapeo; motivo: "destino_inactivo" }[]`.

| Ruta | Método | Cuerpo (zod) | Respuesta y errores |
|---|---|---|---|
| `/api/ventas/mapeos` | GET | `?q=` (texto sobre origen y destino) · `?estado=` | `MapeosRespuesta`, orden `updated_at desc`. `estado` se calcula resolviendo el origen contra el árbol sin mapeos (`crearResolutorCombinaciones`) y comprobando la vigencia del destino |
| `/api/ventas/mapeos` | POST | `crearMapeosSchema`: 1..500 items; origen con los tres de la terna `max(120)` y no los tres vacíos; `equivalencia` `min(1).max(120)` o `*`; `equivalencia_id` uuid; `nota` ≤ 200 | `201 CrearMapeosRespuesta`. Por item: `404` equivalencia inexistente · `409 destino_inactivo` · `409 origen_existe_en_arbol` (hoy resuelve `ok`: no hace falta mapeo) · `409 origen_repetido` (ya existe con otro destino y `reemplazar` es falso; con `reemplazar` se actualiza destino y nota). Cualquier equivalencia vigente vale como destino (también la genérica). Es **todo o nada** por petición: se valida la lista entera antes de escribir (`upsert` sobre el único, `ignoreDuplicates: false` solo si `reemplazar`) |
| `/api/ventas/mapeos/[id]` | PATCH | `editarMapeoSchema` (al menos un campo) | `MapeoApi`; `404`; `409 destino_inactivo` |
| `/api/ventas/mapeos/[id]` | DELETE | — | `{ id }`; `404`. No toca cargas |
| `/api/ventas/mapeos/sugerir` | POST | `sugerirSchema`: 1..500 orígenes sin `*` | `SugerirRespuesta` (hasta 3 por origen, orden puntuación desc, nombre asc). No escribe |
| `/api/ventas/mapeos/importar` | POST | `importarMapeosSchema` | `ImportarMapeosRespuesta`. Resuelve el destino con el resolutor del árbol (sin mapeos); omite con motivo; `aplicar` inserta solo `crear`, en tandas de 500 con `upsert … ignoreDuplicates: true` (idempotente; `existente_distinto` **no** se actualiza, criterio de M2) |
| `/api/ventas/previsualizar` | POST | sin cambio | El resolutor recibe los mapeos activos; `combinaciones[i]` puede llegar `ok` con `mapeo`, o `clasificacion_incompleta`; suma `mapeos_no_aplicables` |

CSV de descarga (cliente, `descargarCsv` con BOM, desde el GET): `ORIGEN_GENERO, ORIGEN_MUNDO, ORIGEN_LINEA, ORIGEN_EQUIVALENCIA, DESTINO_GENERO, DESTINO_MUNDO, DESTINO_LINEA, DESTINO_EQUIVALENCIA, NOTA, ESTADO`; el importador acepta ese mismo archivo (ignora `ESTADO`). Cabeceras con `detectarMapeo` (`aCodigo`); en `ORIGEN_EQUIVALENCIA` y `DESTINO_EQUIVALENCIA` valen vacío, `-` y `SIN EQUIVALENCIA` con las reglas del árbol.

## Cambios en el resolutor y en el informe (backend y cliente, lógica pura)

1. **`interpretar.ts` (regla 14 y 15 de M5, ajuste).** Una fila con uno o dos de género/mundo/línea en blanco ya **no** se excluye localmente: sale `cargable` con los campos vacíos como `""` y entra al diccionario de combinaciones; el resolutor devuelve `clasificacion_incompleta` (detalle `HOMBRE / (vacío) / PANTALON`) antes de buscar el género. Consecuencia: en la precedencia, `clasificacion_incompleta` pasa de la posición 6 a la de "combinación" (después de tienda y talla). `sin_clasificar` (los tres en blanco) no cambia.
2. **`resolver.ts`.** `crearResolutorCombinaciones(estado, mapeos: MapeoResolvible[] = [])` con `MapeoResolvible = { id, origen, equivalencia_id, activo }`. Índice por clave exacta `g\u0001m\u0001l\u0001e` y por terna para `*`. Flujo: resolver como hoy; si `ok` → devolver; si no, buscar mapeo activo (exacto, luego comodín); si lo hay y su destino resuelve vigente (equivalencia activa en nodo vigente: reutiliza el mismo índice de equivalencias del resolutor y `nodoVigente` de M1) → `{ resultado: "ok", equivalencia_id, mapeo: { id, motivo_original } }`; si el destino no es vigente → el motivo original y el mapeo se registra en `mapeos_no_aplicables`.
3. **`informe.ts`.** Las combinaciones `ok` con `mapeo` entran al consolidado con la equivalencia destino (el hecho se guarda con ese id). Novedades por mes en `InformeMes`: `reasignadas: MedidasInforme` (filas y medidas que pasaron de error a cargable) y un aviso **`reasignadas_por_mapeo`** (severidad `aviso`, plegado por el umbral del 1 %) con detalle por valor `ORIGEN → DESTINO` (filas, venta, costo, stock). Si una fila reasignada coincide en clave (tienda, equivalencia, marca, talla) con una nativa, se **suma** y cuenta como `fusionadas` (la identidad `archivo = cargadas + fusionadas + excluidas` sigue exacta; el aviso de claves repetidas puede incluirlas y lo dice). `mapeos_no_aplicables` produce el aviso **`mapeos_no_aplicables`** (rojo, con el origen y el destino desactivado). `armarReporteMes` guarda `reasignadas`, el detalle del aviso (recortado a 500) y los ids de mapeo aplicados.
4. **Descargas.** `tablaCombinacionesDesconocidas` deja de incluir las reasignadas (ya no son desconocidas). `tablaOmitidas` no cambia.
5. **`use-carga-ventas.ts`.** El acumulador pasa a un `useRef` que vive mientras `prevVigente` exista (≈ 25 MB por año de archivo; se libera al elegir otro archivo o al terminar la carga). Acción nueva `recalcularConMapeos()`: `apiVentas.previsualizar(crearPeticionPrevisualizar(acumRef.current))` → `construirInforme` → `setPrev` con la **misma firma**. El botón Cargar sigue exigiendo previsualización vigente.

## Sugerencia automática (`src/lib/ventas/sugerir-mapeo.ts`, TypeScript puro)

Entrada: un origen y el `EstadoImportacion` del árbol (solo piezas activas y nodos vigentes). Salida: hasta 3 `SugerenciaMapeo`. Determinista (sin azar, sin fecha), probada con vitest.

- **Similitud** `similitud(a, b)`: `ca = aCodigo(a)`, `cb = aCodigo(b)`; si `ca === cb` → `1` (razón "mismo nombre sin tildes ni signos"); si alguno tiene menos de 2 caracteres → `0`; si no, **Dice sobre bigramas** de caracteres de `ca` y `cb` (multiconjuntos): `2·|A∩B| / (|A|+|B|)`, redondeado a 2 decimales (razón "similar 0,82"). Elegido frente a Levenshtein porque tolera reordenar y recortar palabras (`PANTALON DENIM` ~ `DENIM PANTALON`) y es trivial de probar.
- **Umbrales**: se listan candidatas con puntuación ≥ `0,50`; `fuerte = puntuacion >= 0,80`. Orden: puntuación desc, nombre asc. Nunca se aplica sola.
- **Casos**, en este orden (el primero que aplique):
  1. **Terna resuelta, equivalencia no** (`equivalencia_inexistente` / `equivalencia_inactiva`): candidatas = equivalencias activas del nodo; `puntuacion = similitud(e, nombre)`; la genérica solo si no hay ninguna ≥ 0,5 (entra con 0,50 y razón "única opción: genérica del nodo").
  2. **Género y mundo resueltos, línea no** (`linea_desconocida`, `nodo_inexistente` en esa terna): candidatas = nodos vigentes de ese género-mundo; `sl = similitud(l, linea)`; dentro de cada nodo con `sl ≥ 0,5`, la equivalencia: si `e === l` (venía `-`) → la equivalencia que se llama como la línea nueva, o la genérica (`se = 1`); si no, `se = max similitud(e, nombre)` (la genérica con 0,5 si no hay otra); `puntuacion = redondear2(sl · (0,5 + 0,5·se))`; razón "línea similar 0,90 · equivalencia igual a la línea" o "línea similar 0,90 · equivalencia similar 0,75".
  3. **Género o mundo no resueltos**: se buscan sustitutos por `similitud ≥ 0,8` entre los catálogos activos (`HOMBRES` → `HOMBRE` 0,91); con sustitutos se vuelve a 1 o 2 y la puntuación se multiplica por la similitud del sustituto; sin sustituto, sin sugerencia.
  4. **`clasificacion_incompleta`** con línea no vacía: candidatas = nodos vigentes de esa línea (exacta o ≥ 0,8) que coincidan con las piezas conocidas; puntuación como el caso 2 multiplicada por `(piezas conocidas que coinciden) / 3`; con línea vacía, sin sugerencia.
- Peso de la venta: **no** entra en la puntuación (sería sesgo hacia lo grande); el cliente ordena la **lista de grupos** del modal por venta + stock, como ya hace el informe.

**Casos de prueba sintéticos** (`tests/ventas.sugerir-mapeo.test.ts`, fixture en `tests/ventas.fixture.ts`). Árbol: géneros HOMBRE, MUJER; mundos URBANO, CASUAL; nodos HOMBRE/URBANO/DENIM (equivalencias SKINNY, SLIM, DENIM, genérica), HOMBRE/URBANO/PANTALON DRILL (DRILL CLASICO, PANTALON DRILL), MUJER/URBANO/DENIM (SKINNY, MOM), HOMBRE/CASUAL/POLO (POLO BASICO); línea CHOMPA inactiva en HOMBRE/CASUAL.

| Origen (G / M / L / E) | Esperado |
|---|---|
| HOMBRE / URBANO / DENIM / SKINY | caso 1: SKINNY 0,86 fuerte ("similar 0,86"), SLIM 0,25 fuera; 1 sugerencia |
| HOMBRE / URBANO / DENIM / SKÍNNY | SKINNY 1,00 "mismo nombre sin tildes ni signos" |
| HOMBRE / URBANO / DENIM / BOOTCUT | nada ≥ 0,5 → genérica 0,50 "única opción: genérica del nodo", no fuerte |
| HOMBRE / URBANO / JEAN / JEAN (venía `-`) | caso 2: `similitud(JEAN, DENIM)` < 0,5 y `similitud(JEAN, PANTALON DRILL)` < 0,5 → sin sugerencia (`[]`) |
| HOMBRE / URBANO / PANTALÓN DRIL / PANTALÓN DRIL | caso 2: línea PANTALON DRILL 0,91; `e === l` → equivalencia PANTALON DRILL; puntuación 0,91 fuerte |
| HOMBRES / URBANO / DENIM / SLIM | caso 3: HOMBRE 0,91; luego caso 1 SLIM 1,00 → 0,91 fuerte, razón "género HOMBRES → HOMBRE (0,91) · mismo nombre" |
| HOMBRE / (vacío) / DENIM / SKINNY | caso 4: HOMBRE/URBANO/DENIM → SKINNY, puntuación 1 · 2/3 = 0,67 (no fuerte, razón "línea igual · 2 de 3 piezas conocidas"); MUJER/URBANO/DENIM queda fuera (contradice el género conocido) |
| (vacío) / (vacío) / DENIM / MOM | caso 4: MUJER/URBANO/DENIM → MOM 0,33; HOMBRE/URBANO/DENIM → genérica… ambos < 0,5 → `[]` |
| HOMBRE / CASUAL / CHOMPA / CHOMPA | línea inactiva: caso 2 sobre nodos vigentes; `similitud(CHOMPA, POLO)` < 0,5 → `[]` |
| Determinismo | el mismo origen y árbol dan el mismo arreglo (igualdad profunda) en dos llamadas y con los nodos en otro orden |

## Pantallas

Admin y planner, mismas acciones; el comprador no ve nada (ruta y API `403`).

### Reporte previo (pestaña Cargar, detalle de un mes y resumen)

- Tabla "un mes por fila": la columna de filas pasa a `archivo / se cargan (N reasignadas) / fuera`; badge **"N reasignadas por mapeo"** cuando `reasignadas.filas > 0`.
- Bloque **Errores**: cada grupo cuyo motivo es mapeable tiene una **casilla de selección** y un botón **Asignar**; sobre la tabla, **"Asignar seleccionados (N)"** y **"Seleccionar todos los de este motivo"** (respeta el chip de motivo). Los grupos de motivos inactivos (bloque "Excluidas por decisión") tienen el mismo botón **Asignar** (pregunta 3).
- **Modal Asignar destino** (`src/app/(app)/planificacion/venta-stock/asignar-mapeo.tsx`): arriba, la lista de orígenes elegidos ordenada por venta + stock con filas y peso; al abrir llama a `mapeos/sugerir` con todos los orígenes (una llamada) y muestra para cada uno sus 3 sugerencias con puntuación y razón (la fuerte resaltada). Selector de destino con búsqueda: **GML** (texto libre sobre `GENERO / MUNDO / LINEA`, datos de `GET /api/arbol` ya cargado una vez por sesión de pantalla; solo nodos vigentes) y después **equivalencia** del nodo (preseleccionada la que se llama como la línea; si no existe, la genérica; marcada como "GML" en la lista, el resto como "GMLE"). Casilla **"Aplicar a cualquier equivalencia de esta terna"** (crea el origen con `*`; solo disponible si todos los orígenes seleccionados comparten terna). Nota opcional. Botón **Guardar y recalcular** → `POST /api/ventas/mapeos` (todos los orígenes al mismo destino, `motivo_origen` del grupo) → `recalcularConMapeos()`; muestra "Reporte recalculado: 1 240 filas reasignadas" y el mes cambia de bloqueado a cargable si procede. Clic en una sugerencia rellena el selector. Un origen `obsoleto` o repetido se informa con el mensaje del `409`.
- Aviso `reasignadas_por_mapeo` en Avisos (plegado por umbral) con el detalle `ORIGEN → DESTINO`; `mapeos_no_aplicables` en rojo con enlace a la pestaña Mapeos.
- Texto de ayuda del bloque Errores: "Si la combinación existió con otro nombre, asígnala a su GML o GMLE actual; si debe existir, descárgala en formato árbol".

### Pestaña nueva **Mapeos** (en `/planificacion/venta-stock`, junto a Cargar y Cargas por mes)

- Cabecera: "N mapeos · N vigentes · N obsoletos · N con destino desactivado · N inactivos"; chips por estado; buscador (`q`, en memoria sobre el GET).
- Tabla: origen (cuatro piezas; `*` se muestra "cualquier equivalencia"), destino (`G / M / L / E` con badge GML cuando la equivalencia se llama como la línea o es la genérica), motivo de origen, nota, estado (badge: Vigente · **Obsoleto: ya existe en el árbol** · **Destino desactivado** · Inactivo), quién y cuándo. Acciones por fila: **Cambiar destino** (mismo selector del modal), **Editar nota**, **Desactivar / Reactivar**, **Eliminar** (`confirm`: "No cambia los meses ya cargados; para que deje de aplicarse en ellos, recarga el mes").
- Botones: **Descargar CSV**, **Importar** (archivo CSV o Excel con `leerArchivoTabular` y `PasoMapeo` de `src/components/importador/`, previsualizar con omitidas por motivo y aplicar; idempotente), **Nuevo mapeo** (origen a mano, para los que aún no aparecieron en un archivo).
- Detalle de una carga (Cargas por mes): muestra `reasignadas` y el aviso guardado.

## Reglas de negocio (vitest salvo donde se indica)

1. `resolverCombinacion` devuelve `ok` **sin** `mapeo` cuando el árbol resuelve, aunque exista un mapeo para ese origen (el árbol manda).
2. Con el árbol sin resolver y un mapeo exacto activo con destino vigente → `ok` con `mapeo.id` y `motivo_original` igual al que devolvería sin mapeos.
3. Exacto gana a `*`; `*` solo aplica a la terna completa (género, mundo y línea iguales) y a cualquier equivalencia, la genérica incluida.
4. Mapeo inactivo → se ignora. Destino con equivalencia inactiva, o cuyo nodo, línea, género o mundo esté inactivo → se ignora, la fila conserva su motivo original y el mapeo aparece en `mapeos_no_aplicables` (una vez por mapeo).
5. Nunca se encadena: con un mapeo A→X y un mapeo cuyo origen coincida con el nombre de X, resolver A devuelve X.
6. Una fila con uno o dos de género/mundo/línea en blanco es `clasificacion_incompleta` por el **resolutor**, es mapeable, y con los tres en blanco sigue `sin_clasificar` (no mapeable). Precedencia: `tienda_vacia` y `talla_desconocida` ganan a `clasificacion_incompleta` (ajuste de la regla 14 de M5; se actualiza su test).
7. **Identidad** (regla 20 de M5) con mapeos: `archivo = cargado + Σ exclusiones` en las cinco medidas y `archivo.filas = cargadas + fusionadas + excluidas`; `reasignadas` ⊆ `cargado`; propiedad con semilla fija sobre datos aleatorios que incluyen orígenes mapeados y colisiones de clave.
8. El bloqueo del 2 % se calcula **después** de aplicar mapeos: un mes bloqueado solo por combinaciones mapeadas queda cargable.
9. `reasignadas_por_mapeo` suma exactamente las filas y medidas de las combinaciones con `mapeo`; su detalle se agrupa por `ORIGEN → DESTINO`; `tablaCombinacionesDesconocidas` no las incluye.
10. `planificarCrearMapeos(items, estado, existentes)` (puro, lo usa el POST): rechaza origen con los tres de la terna vacíos, origen que resuelve `ok` en el árbol (`origen_existe_en_arbol`), destino inexistente o no vigente, y repetido con otro destino sin `reemplazar`; dos items con el mismo origen en la petición → `400`; es todo o nada.
11. `planificarImportacionMapeos(filas, estado, existentes)`: cabeceras por `aCodigo`; `ORIGEN_EQUIVALENCIA` vacío → `SIN EQUIVALENCIA`, `-` → nombre de `ORIGEN_LINEA`, `*` se conserva; destino resuelto con el resolutor del árbol (sin mapeos); motivos de omisión de `MotivoOmisionMapeo`; reimportar el mismo archivo crea 0.
12. `estadoMapeo(mapeo, estado)`: `inactivo` si `!activo`; `obsoleto` si el origen resuelve `ok`; `destino_inactivo` si el destino no es vigente; si no, `vigente` (en ese orden).
13. `sugerirMapeo`: las diez filas de la tabla de casos; nunca más de 3; nunca una puntuación < 0,5; todas las sugeridas son vigentes.
14. **Estático**: toda ruta bajo `src/app/api/ventas/mapeos/` usa `requirePlanner`; `sugerir-mapeo.ts` y `mapeos.ts` (lógica pura) no importan de `@supabase/*` ni de `src/components/`; solo `src/lib/ventas/consultas.ts` nombra `mapeos_combinacion`.
15. **SQL (script de humo local)**: la `0008` aplica dos veces sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; el origen repetido choca con el único; los tres de la terna vacíos y la equivalencia vacía violan el `check`; eliminar la equivalencia destino borra el mapeo (cascade); `anon` obtiene cero filas (RLS sin políticas).

## Criterios de aceptación / hito de prueba

`[x]` lo cubren los checks automáticos y QA; `[ ]` lo recorre Javier con `0.8.1 · M5`, con un archivo sintético o con el histórico real.

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (los 781 de M5 ajustados por la regla 6 más `tests/ventas.mapeos.*` y `tests/ventas.sugerir-mapeo.*`), `npm run build` y `scripts/validar-migraciones-local.sh` en verde; `0008_mapeo_combinaciones.sql` aplicada en `vector-two`; tipos regenerados; `APP_VERSION` = `0.8.1 · M5`.
- [ ] Roles: el comprador recibe `403` en `GET /api/ventas/mapeos` y no ve la pestaña.
- [ ] Previsualizar un año del histórico: los grupos de error de combinación muestran casilla y **Asignar**; abrir el modal con un grupo muestra hasta 3 sugerencias con puntuación y razón; la fuerte coincide con lo que Javier habría elegido en la mayoría de los casos (anotar cuántos no).
- [ ] Asignar un grupo a su GMLE actual y **Guardar y recalcular**: el reporte se rehace sin volver a elegir el archivo (segundos), el grupo desaparece de Errores, aparece "N reasignadas por mapeo" con el detalle `ORIGEN → DESTINO`, la identidad cierra y, si el mes estaba bloqueado solo por eso, deja de estarlo.
- [ ] Seleccionar varios grupos de la misma línea vieja y asignarlos a la vez a un destino con la casilla de terna (`*`): un solo mapeo; al previsualizar otro año con una equivalencia vieja distinta de esa misma línea, también se reasigna.
- [ ] Cargar el mes: en Cargas por mes el detalle muestra `reasignadas` y el aviso; `select count(*) from venta_stock_vigente where equivalencia_id = <destino>` incluye las filas reasignadas.
- [ ] Crear en el árbol (importador de M1) una combinación que tenía mapeo y previsualizar de nuevo: resuelve por el árbol y el mapeo sale **Obsoleto** en la pestaña Mapeos.
- [ ] Desactivar la equivalencia destino de un mapeo y previsualizar: las filas vuelven a su error original y el aviso rojo `mapeos_no_aplicables` lo nombra; reactivarla lo arregla.
- [ ] Pestaña Mapeos: buscar, cambiar destino, desactivar, eliminar (el mes cargado no cambia; recargarlo sí lo cambia), descargar CSV, editarlo en Excel, importarlo: previsualización con omitidas por motivo; aplicar y reimportar sin duplicar.
- [ ] Un archivo con filas de género en blanco y línea conocida: el grupo sale como `clasificacion_incompleta` con sugerencia y es asignable; las de los tres en blanco siguen como `sin_clasificar` sin botón.

## Fuera de alcance

- Reglas de renombre (línea vieja → línea nueva para todas sus equivalencias, resolviendo la equivalencia por nombre en el destino); mapeos con vigencia por fecha; mapeo de `sin_clasificar` (pregunta 2).
- Mapeo de tiendas (M4: crearlas o desactivarlas), de marcas (sin alias, decisión de Javier), de tallas (`MAPEO_TALLA` es constante) y de cifras.
- Aplicar mapeos a meses ya publicados sin recargarlos (los hechos son inmutables; se recarga el mes).
- Crear o modificar el árbol desde el modal; aplicar una sugerencia sin que Javier la elija.
- Sugerencias que miren la venta histórica del destino o el stock (02b tiene su propia función para marcas).

## Riesgos

- **Mapeo equivocado = histórico mezclado en silencio.** Mitigación: aviso con detalle `ORIGEN → DESTINO` en cada previsualización y en el reporte guardado, pestaña Mapeos con estado, y recarga del mes como corrección (idempotente).
- **Memoria del navegador**: conservar el acumulador mientras la previsualización está vigente son ≈ 25 MB por año de archivo (≈ 90 MB para el histórico entero); aceptable, se libera al cambiar de archivo o al terminar.
- **Comodín `*` demasiado ancho**: una terna vieja con equivalencias que debían ir a destinos distintos quedaría toda en uno; el modal lo ofrece solo con terna única y lo dice en el texto.
- **Ajuste de precedencia** (regla 6): filas con tienda vacía y género vacío cambian de `clasificacion_incompleta` a `tienda_vacia`; es un caso marginal y se documenta en el test.
- **02b no construido**: el selector muestra GML/GMLE por la forma de la equivalencia, no por `nivel_planificacion`; cuando exista, se añade el badge (aditivo).

## Decisiones nuevas propuestas (para `docs/DECISIONES.md` al aprobar)

1. **El árbol manda; el mapeo solo entra cuando el árbol no resuelve, nunca se encadena y nunca apunta a un destino no vigente.** Descartado: mapeo con prioridad sobre el árbol; renombres encadenados.
2. **El origen del mapeo es la combinación exacta del archivo (normalizada y sustituida) con un único comodín `*` en la equivalencia.** Descartado: comodines en la terna, expresiones regulares.
3. **Los hechos guardan solo el destino; la auditoría del mapeo va en el `reporte` de la carga; cambiar un mapeo exige recargar el mes.**
4. **`clasificacion_incompleta` se decide en el resolutor y es mapeable; `sin_clasificar` sigue excluida por decisión.**
5. **La sugerencia es Dice sobre bigramas de `aCodigo`, umbral 0,5 y "fuerte" 0,8, calculada en el servidor y nunca aplicada sola.**
6. **La mejora toma `0008` y `0.8.1 · M5`; 02b pasa a `0009` / `0.8.2 · M2b` y M6 a `0010`.**

## Preguntas abiertas para Javier (con valor por defecto)

1. **Comodín de terna (`*`).** ¿Te sirve "cualquier equivalencia de esa línea vieja va a este destino"? **Por defecto: sí**, solo en la equivalencia y solo desde el modal cuando todos los seleccionados comparten terna.
2. **Filas sin género, mundo ni línea (`sin_clasificar`, ~4 % del stock y ~1 % de la venta en el piloto).** **Por defecto: siguen excluidas** (tu decisión del 2026-10-11). Si quisieras cargarlas, sería un único destino para "todo lo sin clasificar"; dímelo y se añade como un mapeo especial.
3. **Combinaciones desactivadas en el árbol** (equivalencia, nodo, línea, género o mundo con `activo = false`). **Por defecto: también mapeables** (el mapeo es una decisión más concreta que "desactivado"). ¿Prefieres que lo desactivado nunca se reasigne?
4. **Destino por defecto al elegir un GML.** **Por defecto: la equivalencia que se llama como la línea (`-`)** y, si no existe, la genérica `SIN EQUIVALENCIA`. ¿Prefieres siempre la genérica?
5. **Mapeos cuyo origen ya existe en el árbol (obsoletos).** **Por defecto: se conservan y se muestran como Obsoleto** (no se aplican); no se borran solos.
6. **Importar un origen que ya tiene otro destino.** **Por defecto: se omite y se lista** (como el importador de marcas); desde la pantalla sí se cambia el destino uno a uno o con "Asignar" (que pide confirmación para reemplazar).
7. **Umbrales de la sugerencia** (listar ≥ 0,50; fuerte ≥ 0,80; 3 alternativas). **Por defecto: esos**; se ajustan con tu primera pasada por el histórico.
8. **Ubicación.** **Por defecto: pestaña Mapeos dentro de Planificación → Carga de venta y stock**; alternativa: una pantalla propia en Maestros.

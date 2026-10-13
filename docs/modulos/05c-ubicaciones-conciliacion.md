# M5c · Ubicaciones ignoradas y conciliación con QlikView

> Estado: **especificación pendiente de aprobación por Javier (2026-10-12)**. No hay código ni migración. Es una **mejora de M5** ([05-venta-stock](05-venta-stock.md), construido en `0.8.0`) que toca también la pantalla de M4 ([04-tiendas](04-tiendas.md)). Migración prevista `0009_ubicaciones_ignoradas.sql`; versión `0.8.2 · M5` (la `0.8.1 · M5` y la `0008` las toma [05b-mapeo-combinaciones](05b-mapeo-combinaciones.md), que se construye antes). Toda la API `requirePlanner`. Ningún dato real de Lukers: tiendas, ubicaciones y cifras inventadas.

## Objetivo

Dos decisiones de Javier del 2026-10-12. **A.** "La central y la oficina no son tiendas inactivas, son espacios sin importancia": hoy salen como `tienda_desconocida` (error que pesa en el 2 % y bloquea), y la regla vigente ("créalas desactivadas en M4") las mete en el maestro de tiendas como si fueran tiendas. Se reemplaza por una lista editable de **ubicaciones ignoradas**, cuyas filas se excluyen **por decisión** (motivo propio `ubicacion_ignorada`, sin peso en el porcentaje de errores, sin crear tiendas), administrada en Maestros → Tiendas y con un atajo en el reporte previo que recalcula sin releer el archivo. **B.** La conciliación contra QlikView compara hoy con el archivo **completo**, pero la tabla de QlikView de Javier no muestra las filas sin género, mundo ni línea (`sin_clasificar`), así que siempre dice "difiere". Pasa a comparar contra una base **comparable** (archivo menos lo que QlikView no muestra), mostrando todas las cifras para que se vea de dónde sale cada diferencia.

## Modelo de datos (solo A)

Migración `supabase/migrations/0009_ubicaciones_ignoradas.sql`, idempotente, sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`, sin bloques `do $$`, trigger con `create or replace trigger … execute function public.tg_set_updated_at()`, RLS activo **sin políticas** (plantilla: `0004_tiendas.sql`). Sin FKs y sin seed: la lista la llena Javier (tres valores hoy).

### `ubicaciones_ignoradas`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `nombre` | `text not null` | tal como viene en la columna `TIENDA` del archivo, ya **normalizado** por el backend con `normalizarNombre` (NFC, trim, espacios colapsados, mayúsculas en español), igual que `tiendas.nombre`; `check ubicaciones_ignoradas_nombre_len_check (length between 1 and 120)`; único `ubicaciones_ignoradas_nombre_uniq on (nombre)` |
| `nota` | `text null` | `check ubicaciones_ignoradas_nota_len_check (nota is null or length(nota) <= 200)`; "Oficina administrativa, solo stock de muestras" |
| `activo` | `boolean not null default true` | por convención de PLAN §4 y **sin uso** (mismo criterio que `responsables_genero_mundo`): la baja borra la fila; una fila con `activo = false` (solo desde el SQL Editor) se lee como si no existiera |
| `created_at`, `updated_at` | `timestamptz not null default now()` | trigger `set_updated_at` |

Por qué una tabla y no `tiendas.activo = false` (la regla de `0.8.0`): una ubicación ignorada **no es una tienda** y no debe aparecer en selectores, calendario, importador ni conteos de M4, ni exigir un código inventado. Por qué sin `tipo` ni `codigo`: QlikView trae el nombre y se resuelve por nombre (regla 28 de M5); si algún día el archivo trajera códigos, se añade una columna nullable. Por qué único por `nombre` plano y no sobre `upper`: el backend normaliza siempre antes de escribir, como en `tiendas.nombre`. Por qué `on delete` no aplica: nada cuelga de aquí (las filas ignoradas no se cargan, así que nunca hay hechos que apunten a una ubicación).

**Regla de resolución (la tienda manda).** El resolutor de M5 busca en este orden: tienda por nombre normalizado → tienda por código → **ubicación ignorada** → desconocida. Si existe una tienda con el mismo nombre (activa o desactivada), gana la tienda (`ok` o `tienda_inactiva`) y la fila de `ubicaciones_ignoradas` queda **sin efecto**; la pantalla lo marca. Es exactamente el orden que `crearResolutorTiendas` ya tiene con su parámetro `excluidas` (hoy siempre vacío).

Diagrama:

```
archivo.TIENDA ─► tiendas (por nombre, por código) ─► ok | tienda_inactiva
                  └─ no está ─► ubicaciones_ignoradas (activo) ─► ubicacion_ignorada (decisión, con nota)
                                 └─ no está ─► tienda_desconocida (error)
```

## Contratos de API

Todo con `ok()`/`error()`/`leerCuerpo`/`idDeRuta` de `src/lib/api/respuestas.ts`, errores de base por `traducirErrorDb` (`MENSAJES_UNICO` suma `ubicaciones_ignoradas_nombre` → "Esa ubicación ya está en la lista."), **`requirePlanner` en todas, lecturas incluidas** (decisión de Javier; es una pieza de M5, no un maestro que el comprador consulte). Handlers propios en `src/app/api/tiendas/ubicaciones-ignoradas/` (el segmento estático convive con `[id]`, como `aperturas` e `importar`); no se usa `catalogo.ts` (la tabla no tiene `codigo` ni `orden` y el listado anexa un campo calculado). Lógica pura en `src/lib/tiendas/ubicaciones.ts`; esquemas en `src/lib/tiendas/esquemas.ts`; tipos de red en `src/lib/tiendas/tipos-api.ts`.

```ts
// src/lib/tiendas/tipos-api.ts (añadidos)
export type UbicacionIgnoradaApi = {
  id: string; nombre: string; nota: string | null; created_at: string; updated_at: string;
  /** Tienda (activa o no) con el mismo nombre normalizado: la fila no tiene efecto. Se calcula al listar. */
  sin_efecto: { tienda_id: string; codigo: string; activo: boolean } | null;
};
export type CrearUbicacionIgnoradaPeticion = { nombre: string; nota?: string | null };
export type EditarUbicacionIgnoradaPeticion = { nombre?: string; nota?: string | null };   // al menos uno
```

```ts
// src/lib/tiendas/esquemas.ts (añadidos; `textoOpcional` y `normalizarNombre` ya existen ahí)
const nombreUbicacion = z.string("El nombre debe ser texto.").transform(normalizarNombre)
  .pipe(z.string().min(1, "El nombre es obligatorio.").max(120));
const notaUbicacion = z.string().nullable().optional().transform(v => { const t = (v ?? "").trim(); return t === "" ? null : t; })
  .pipe(z.string().max(200, "La nota no puede superar 200 caracteres.").nullable());
crearUbicacionIgnoradaSchema = z.object({ nombre: nombreUbicacion, nota: notaUbicacion });
editarUbicacionIgnoradaSchema = z.object({ nombre: nombreUbicacion.optional(), nota: notaUbicacion })
  .refine(d => d.nombre !== undefined || d.nota !== undefined, "No hay nada que cambiar.");
```

| Ruta | Método | Guard | Cuerpo | Respuesta y errores |
|---|---|---|---|---|
| `/api/tiendas/ubicaciones-ignoradas` | GET | `requirePlanner` | — | `{ data: UbicacionIgnoradaApi[] }` por `nombre`; solo `activo = true`; `sin_efecto` se calcula en memoria contra `leerTiendas(db, { soloActivas: false })` |
| `/api/tiendas/ubicaciones-ignoradas` | POST | `requirePlanner` | `crearUbicacionIgnoradaSchema` | `201` con la fila (`sin_efecto: null`); `400` zod; **`409 nombre_es_tienda`** si existe una tienda (activa o no) con ese nombre: "Ya existe la tienda R101 con ese nombre. Si no debe cargarse, desactívala en Tiendas."; `409` nombre repetido (único) |
| `/api/tiendas/ubicaciones-ignoradas/[id]` | PATCH | `requirePlanner` | `editarUbicacionIgnoradaSchema` | fila actualizada; `404`; mismos `409` que crear si cambia el nombre |
| `/api/tiendas/ubicaciones-ignoradas/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `404`. Nunca `409`: nada cuelga de la fila |

**Por qué `409` al crear con nombre de tienda** y no solo "sin efecto": una fila que nace sin efecto es casi siempre un error de quien la escribe (quiso desactivar una tienda). En cambio una tienda creada **después** con ese nombre es legítima ("la tienda manda"), no se bloquea en `POST /api/tiendas`, y la fila ignorada pasa a `sin_efecto` en el listado.

### Cambios en la API de M5

- **`POST /api/ventas/previsualizar`**: el handler lee además `ubicaciones_ignoradas` (`activo = true`, `leerTodo`, `src/lib/tiendas/consultas.ts` → `leerUbicacionesIgnoradas`) y la pasa a `crearResolutorTiendas(tiendas, ignoradas)` como `ReadonlyMap<nombre, nota | null>`. Resultado nuevo en `ResolucionTiendaApi` (`src/lib/ventas/tipos-api.ts`), **reemplaza** al `excluida` sin uso:

```ts
| { valor: string; resultado: "ignorada"; id: string; nota: string | null }
```

- `src/lib/ventas/tipos.ts`: en `MOTIVOS_DECISION`, `tienda_excluida` pasa a llamarse **`ubicacion_ignorada`** (etiqueta "Ubicación ignorada (no es tienda)"); `informe.ts` mapea `ignorada` → `ubicacion_ignorada`. El renombre es seguro: el motivo viejo nunca pudo aparecer en un reporte guardado (la lista estaba vacía). Constante nueva `MOTIVOS_NO_COMPARABLES` (ver B).
- Nada cambia en `cargas`, `filas`, `publicar`, `limpiar` ni en `marcas-nuevas`.
- **`src/lib/ventas/tipos.ts`, `FilaConciliacion`** (B), dos campos nuevos y el significado de dos existentes:

```ts
export type FilaConciliacion = {
  medida: MedidaVenta;
  qlik: number | null;
  archivo: number;
  /** Lo que QlikView no muestra: Σ exclusiones con motivo en MOTIVOS_NO_COMPARABLES (sin_clasificar, fila_total). */
  no_comparable: number;
  /** `archivo - no_comparable`: la cifra que se compara con QlikView. */
  comparable: number;
  excluido: number;          // todas las exclusiones (incluye no_comparable)
  cargado: number;
  descuadre: number;         // archivo - excluido - cargado = 0
  diferencia_qlik: number | null;      // ahora `comparable - qlik`
  diferencia_relativa: number | null;  // ahora `|comparable - qlik| / |qlik|`
  estado_qlik: "coincide" | "difiere" | "sin_qlik";
};
export const MOTIVOS_NO_COMPARABLES: readonly MotivoExclusion[] = ["sin_clasificar", "fila_total"];
export const BASE_CONCILIACION = "comparable" as const;   // va al reporte guardado como `base_conciliacion`
```

### B · Conciliación contra la base comparable

**Qué se resta y por qué.** La tabla de QlikView de la que Javier copia los totales es un objeto con las dimensiones género, mundo y línea: una fila con las tres en blanco **no existe para ese objeto**, por eso el archivo completo nunca cuadra. Se resta `sin_clasificar`. Se resta también `fila_total` (si el archivo trajera una fila de totales, en QlikView es un pie, no un dato; sumarla sería contar doble). **No se restan**: las `ubicacion_ignorada` (la central y las oficinas traen género, mundo y línea; para QlikView son filas como cualquier otra, y la precedencia de motivos ya manda a `sin_clasificar` las que no los traigan), las de **género, mundo o línea desconocidos** (QlikView las muestra con ese valor; son errores del árbol, no filas invisibles) ni ninguna otra exclusión. Si en el hito el residuo de stock coincide exactamente con la línea de ubicaciones ignoradas, la tabla de Javier tampoco las muestra: añadir `ubicacion_ignorada` a `MOTIVOS_NO_COMPARABLES` es un cambio de una línea (pregunta abierta 1).

**Tolerancia (ya decidida, sin cambios):** unidades y stock en unidades **exactos**; venta, costo y stock valorizado con diferencia relativa **menor al 0,1 %** (`coincideConQlik` no cambia; solo cambia qué cifra se le pasa: `comparable` en vez de `archivo`).

**Ejemplo sintético (un mes):** archivo 66 128 unidades; `sin_clasificar` 11 366; comparable **54 762**; cargado 54 700 (quedan fuera 62 de una tienda desconocida). Con QlikView = 54 762 → "Coincide (exacto)". Con QlikView = **54 763** → "**Difiere en 1 unidad** (0,002 %)": la regla de unidades exactas no se relaja; la pantalla dice cuánto y Javier decide si es una fila que su tabla sí muestra y el archivo no trajo (pregunta abierta 2). En soles, con QlikView S/ 1 000 000: comparable S/ 1 000 999 → coincide (0,0999 %); comparable S/ 1 001 000 → difiere (0,1 %). La diferencia relativa se mide contra el total de QlikView (`|comparable − qlik| / |qlik| < 0,1 %`), de modo que 0,1 % exacto no es menor y difiere; con QlikView S/ 1 001 000 y comparable S/ 1 000 000 también coincide (0,0999 %).

**El residuo en costo y stock valorizado.** QlikView suma con decimales y muestra el total redondeado; el CSV trae cada fila redondeada a soles enteros (decisión 8 de M5). La suma de 32 000 redondeos no es el redondeo de la suma: el residuo esperado es del orden de ±S/ 100 (en septiembre, medido: venta +0,0008 %, costo +0,016 %, stock valorizado +0,004 %), muy por debajo del 0,1 %. Un segundo origen es una fila que la tabla de QlikView no muestra por otra dimensión en blanco (talla, marca); ese residuo aparece **también en unidades**, exacto, y por eso unidades sigue sin tolerancia: es el detector. Presentación: `Coincide (exacto)` para unidades con diferencia 0; `Coincide dentro de la tolerancia: S/ 143 (0,004 %)` para soles con diferencia distinta de 0 y menor al 0,1 %; `Difiere: 1 unidad` / `Difiere: S/ 12 345 (1,2 %)` en ámbar. Siempre se muestran las **cinco cifras**: archivo · no comparable · comparable · cargado · QlikView.

**Cambios en el código (puro, ambos lados reutilizan):**

- `src/lib/ventas/conciliacion.ts` (nuevo, puro): `coincideConQlik` y `estadoQlik` (movidos desde `informe.ts`, que los re-exporta), `conciliarFilasConQlik` (lo que usa `conciliarConQlik` de `plan.ts`), `textoEstadoQlik` y `formatearPorcentaje` (los textos de estado; el porcentaje se trunca, no se redondea, para que 0,099996 % no se lea "0,1" dentro de un "Coincide"), y los lectores de reportes guardados (`leerConciliacionGuardada`, `leerFilaConciliacionGuardada`, `NOTA_CONCILIACION_080`). `TOLERANCIA_UNIDADES` (hoy 0) se define en un único lugar, `tipos.ts`.
- `src/lib/ventas/recalcular.ts` → `recalcularConIgnorada(acumulador, respuesta, valor, id, nota, opciones)`: `marcarIgnorada` + `construirInforme` sobre el mismo acumulador, sin releer el archivo ni llamar a `previsualizar`; es lo que invoca `ignorarUbicacionDelArchivo` en `use-carga-ventas.ts`.

- `informe.ts` → `conciliarMes(archivo, excluido, cargado, noComparable, qlik?)`: `noComparable` es el tally de los grupos del mes con motivo en `MOTIVOS_NO_COMPARABLES`; `estadoQlik(medida, q, comparable)`.
- `plan.ts` → `conciliarConQlik` compara contra `f.comparable` (no `f.archivo`), para que escribir un total siga sin recorrer el archivo.
- `armarReporteMes` guarda `base_conciliacion: "comparable"` junto a `conciliacion` y `totales_qlik` (estos dos no cambian de forma salvo los dos campos nuevos por fila).

**Compatibilidad con reportes ya guardados (solo lectura, no se migra).** Un reporte de `0.8.0` no trae `base_conciliacion` ni `comparable`. `ConciliacionGuardada` (`detalle-mes.tsx`) lee `f.comparable ?? f.archivo` y `f.no_comparable ?? 0`, y si `reporte.base_conciliacion` falta muestra la nota "Esta carga concilió contra el archivo completo (versión 0.8.0); desde 0.8.2 se concilia contra el comparable". `GET /api/ventas/cargas/[id]` no cambia (el reporte viaja tal cual).

## Pantallas

Admin y planner, mismas acciones; el comprador no ve ninguna de las dos (ya era así).

### Maestros → Tiendas: pestaña nueva **Ubicaciones ignoradas**

`tiendas-panel.tsx` suma `{ id: "ignoradas", label: "Ubicaciones ignoradas" }` a `Tabs` (el switch "Mostrar inactivos" se oculta en esta pestaña, como en Importar). Componente `ubicaciones-tab.tsx` con `useColeccion<UbicacionIgnoradaApi>("/api/tiendas/ubicaciones-ignoradas")`.

- Texto de cabecera: "Nombres de la columna TIENDA del archivo de venta que no son tiendas (central, oficinas, almacenes de muestras). Sus filas quedan fuera de toda carga como decisión, sin contar como error ni crear tiendas. Si existe una tienda con el mismo nombre, la tienda manda."
- **Alta**: formulario en línea `Nombre` (obligatorio; se muestra normalizado al guardar) y `Nota` (opcional, ≤ 200). Errores de la API en `Alert` (`409` nombre de tienda, `409` repetido).
- **Tabla** (`DataTable`): Nombre · Nota (edición en línea, `PATCH`) · Creada · estado: badge **"Sin efecto: existe la tienda R101"** (ámbar) cuando `sin_efecto` no es nulo, con enlace a la pestaña Tiendas · botón **Quitar** (`confirm`: "«CENTRAL EJEMPLO» volverá a salir como tienda desconocida en la próxima lectura"; `DELETE`).
- Vacío: "Todavía no hay ubicaciones ignoradas. También puedes añadirlas desde el reporte previo de la carga de venta."
- Resumen bajo las pestañas (línea existente) suma "· N ubicaciones ignoradas".

### Carga de venta y stock → reporte previo

- El bloque **Tiendas desconocidas** (`reporte-previo.tsx`) cambia el texto del `Alert`: "… si es una tienda real, créala o corrige su nombre en Tiendas y aperturas; si **no es una tienda** (la central, una oficina), pulsa *Ignorar esta ubicación*: sus filas quedarán fuera como decisión, sin contar como error." Cada fila gana el botón **Ignorar esta ubicación** (`confirm` con el nombre, las filas y el peso del grupo en todos los meses del archivo).
- Al confirmar: `POST /api/tiendas/ubicaciones-ignoradas { nombre }` → si `201` (o `409` repetido, que se trata como éxito), el hook aplica `marcarIgnorada(respuesta, valor, id, nota)` (función pura en `src/lib/ventas/resolver.ts`: devuelve una `PrevisualizarRespuesta` con esa tienda como `ignorada`) y **vuelve a ejecutar `construirInforme` sobre el mismo acumulador**, sin releer el archivo ni volver a llamar a `previsualizar`. Para eso `Previsualizacion` (`use-carga-ventas.ts`) conserva el `acumulador` (hoy se descarta; ~60 B por fila, 25 MB para un año) y lo libera en `reiniciarResultados`. La `firma` no cambia (mismo archivo y mapeo), así que `prevVigente` sigue válida; los totales de QlikView escritos **se conservan**. Mientras recalcula (uno o dos segundos en un archivo de un año) la pantalla muestra "Recalculando el reporte…" y deshabilita Cargar.
- Resultado visible: la ubicación desaparece de Tiendas desconocidas, aparece en **Excluidas por decisión** con el motivo "Ubicación ignorada (no es tienda)" y su línea en `resumen_exclusiones` (filas, unidades, venta, costo, stock en unidades y stock a costo, con % de filas, venta y stock); el porcentaje de errores del mes baja y, si estaba bloqueado solo por eso, deja de estarlo. Un `409 nombre_es_tienda` (alguien creó la tienda entre lectura y clic) se muestra tal cual y se sugiere volver a leer.
- No hay "deshacer" en el reporte: se quita desde Maestros → Tiendas → Ubicaciones ignoradas y se vuelve a leer (fuera de alcance; ver preguntas).

### Conciliación (detalle de mes, reporte previo y carga guardada)

Tabla `Medida · QlikView (opcional) · Archivo · No comparable · Comparable · Cargado · Comparable frente a QlikView`. Pie: "QlikView no muestra las filas sin género, mundo ni línea (ni filas de totales): se comparan sus totales con el **comparable** = archivo − no comparable. Unidades y stock en unidades exactos; soles con diferencia menor al 0,1 %." La celda de estado usa los tres textos de arriba (exacto / dentro de la tolerancia con la cifra / difiere con cifra y %). En la carga guardada, misma tabla en solo lectura con la nota de compatibilidad.

## Reglas de negocio

Todas probables con vitest salvo la 12 (script SQL local). Funciones puras en `src/lib/ventas/` y `src/lib/tiendas/`; pruebas en `tests/ventas.resolver.test.ts`, `tests/ventas.informe.test.ts`, `tests/tiendas.ubicaciones.test.ts`, `tests/tiendas.esquemas.test.ts`.

1. **Orden de resolución de tienda**: nombre de tienda → código de tienda → ubicación ignorada → desconocida. `resolverTienda("central ejemplo", TIENDAS, ignoradas{CENTRAL EJEMPLO})` → `ignorada` con `id` y `nota`; si `TIENDAS` incluye una tienda `CENTRAL EJEMPLO` activa → `ok`; desactivada → `inactiva` (la tienda manda en ambos casos).
2. **Normalización**: `" central  ejemplo "` y `"Central Ejemplo"` resuelven a la misma ubicación; el esquema de alta guarda `CENTRAL EJEMPLO`; vacío tras normalizar → `400`.
3. **Sin efecto**: `sinEfecto(ubicacion, tiendas)` devuelve la tienda (activa o no) con el mismo nombre normalizado o `null`; `rechazoCrearUbicacion(nombre, tiendas)` devuelve el mensaje `409` solo si hay tienda con ese nombre (por nombre, no por código).
4. **Decisión, no error**: `ubicacion_ignorada ∈ MOTIVOS_DECISION`; un mes cuyo único problema son 5 000 filas de una ubicación ignorada tiene `errores.maximo = 0`, `bloqueado = false` y `tipo = "decision"` en el resumen; si pesa más del 2 % en venta o stock, `resaltada = true` (igual que cualquier decisión).
5. **Precedencia**: una fila con género, mundo y línea en blanco y tienda ignorada cuenta como `sin_clasificar`; una fila con tienda ignorada y combinación inexistente cuenta como `ubicacion_ignorada` (la tienda se decide antes que la combinación); una fila con tienda ignorada y talla desconocida cuenta como `ubicacion_ignorada`.
6. **Identidad**: con ubicaciones ignoradas sigue `archivo = cargado + Σ exclusiones` en las cinco medidas y `archivo.filas = cargadas + fusionadas + excluidas` (regla 20 de M5, propiedad con semilla fija extendida con el motivo nuevo).
7. **Recalcular sin releer**: `marcarIgnorada(respuesta, valor, id, nota)` cambia solo la posición de ese valor en `respuesta.tiendas` (de `desconocida` a `ignorada`) y `construirInforme` sobre el mismo acumulador da el mismo `archivo`, el grupo `tienda_desconocida` de ese valor desaparece y aparece uno `ubicacion_ignorada` con **las mismas** filas y medidas; el consolidado no cambia. Es idempotente (aplicarla dos veces da lo mismo).
8. **Comparable**: `comparable = archivo − Σ exclusiones con motivo ∈ MOTIVOS_NO_COMPARABLES`, en las cinco medidas y en filas; `ubicacion_ignorada`, `tienda_inactiva`, `genero_desconocido` y el resto **no** se restan; sin exclusiones no comparables, `comparable = archivo`. `MOTIVOS_NO_COMPARABLES ⊆ MOTIVOS_DECISION` (test estático).
9. **Conciliación con la base comparable**: con el ejemplo sintético (66 128 / 11 366 / 54 762), QlikView 54 762 → `coincide`; 54 763 → `difiere` con `diferencia_qlik = −1`; soles, con QlikView 1 000 000: comparable 1 000 999 → `coincide` (0,0999 %), comparable 1 001 000 → `difiere` (0,1 % exacto, que no es menor); la diferencia relativa es `|comparable − qlik| / |qlik|` y, con QlikView 1 001 000 y comparable 1 000 000, también `coincide`; `conciliarConQlik` (`plan.ts`) da el mismo estado que `conciliarMes` para los mismos totales (los dos usan `comparable`); sin totales → `sin_qlik` y no es error.
10. **Reporte guardado**: `armarReporteMes` incluye `base_conciliacion: "comparable"` y cada fila de `conciliacion` trae `comparable` y `no_comparable`; el lector (`leerFilaConciliacionGuardada`) completa una fila de `0.8.0` con `comparable = archivo`, `no_comparable = 0` y marca `base: "archivo"`.
11. **Esquemas**: `crearUbicacionIgnoradaSchema` rechaza nombre vacío o de más de 120 y nota de más de 200; `editarUbicacionIgnoradaSchema` rechaza un cuerpo sin cambios; `nota: ""` se guarda como `null`.
12. **SQL (script de humo local)**: `0009` aplica dos veces sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; dos filas con el mismo `nombre` chocan con `ubicaciones_ignoradas_nombre_uniq`; una nota de 201 caracteres falla el `check`; `anon` obtiene cero filas (RLS sin políticas); `updated_at` cambia al editar.
13. **Guards**: las cuatro rutas de ubicaciones responden `403` a un comprador (test estático: todo handler bajo `src/app/api/tiendas/ubicaciones-ignoradas/` empieza con `requirePlanner`).

## Criterios de aceptación / hito de prueba

`[x]` lo cubren los checks automáticos y la QA; `[ ]` lo recorre Javier con `0.8.2 · M5`, con datos inventados primero y después con septiembre.

- [x] `0009_ubicaciones_ignoradas.sql` aplicada en `vector-two`; tipos regenerados; `APP_VERSION = "0.8.2 · M5"`; lint, tsc, vitest y build limpios; `tienda_excluida` no aparece en `src/` (grep).
- [ ] Maestros → Tiendas muestra la pestaña **Ubicaciones ignoradas** vacía; crear `CENTRAL EJEMPLO` con nota; repetirla responde "ya está en la lista"; crear una con el nombre de una tienda existente responde el `409` con el código de la tienda.
- [ ] Crear después una tienda llamada `CENTRAL EJEMPLO`: la fila de la lista pasa a "Sin efecto"; eliminar esa tienda la devuelve a la normalidad.
- [ ] Reporte previo de un archivo inventado con tres ubicaciones que no son tiendas: salen en Tiendas desconocidas; pulsar **Ignorar esta ubicación** en una → desaparece de la tabla y aparece en Excluidas por decisión con sus filas, unidades, venta, costo y stock; el porcentaje de errores baja; los totales de QlikView ya escritos siguen; el recálculo no vuelve a leer el archivo (la barra de lectura no aparece).
- [ ] Un mes que estaba **Bloqueado** solo por esas ubicaciones deja de estarlo tras ignorarlas; el botón Cargar se habilita.
- [ ] Si las tres ubicaciones ya se habían creado como tiendas desactivadas: siguen saliendo como "Tienda desactivada" (la tienda manda); eliminarlas desde Tiendas (no tienen hechos) y darlas de alta como ignoradas las pasa al motivo nuevo.
- [ ] **Conciliación con septiembre real**: la tabla muestra archivo · no comparable (= las filas sin clasificar) · comparable · cargado · QlikView; unidades y stock en unidades dan "Coincide (exacto)" contra el comparable; venta, costo y stock valorizado "Coincide dentro de la tolerancia" con su residuo en soles y %; si stock en unidades difiere exactamente por la línea de ubicaciones ignoradas, se anota (pregunta abierta 1).
- [ ] Cargar el mes; en Cargas por mes el detalle muestra la misma tabla; abrir el detalle de una carga hecha con `0.8.0` muestra la nota de compatibilidad y no rompe.
- [ ] Quitar una ubicación ignorada y volver a leer el archivo: vuelve a salir como tienda desconocida.

## Fuera de alcance

- Código, tipo o fechas en las ubicaciones ignoradas; importador de ubicaciones (hoy son tres valores).
- "Deshacer" desde el reporte previo (se quita en Maestros y se relee) y un historial de quién ignoró qué (pendiente de auditoría desde M0).
- Aviso en `POST /api/tiendas` cuando el nombre está en ubicaciones ignoradas (la tienda manda; el listado lo muestra como "sin efecto").
- Tolerancia en unidades, o una tolerancia distinta por medida: siguen las decididas.
- Conciliar contra lo **cargado** o contra varias bases a elegir: una sola base (comparable), con todas las cifras a la vista.
- Restar `ubicacion_ignorada` o `genero_desconocido` del comparable: solo si el hito lo demuestra (una línea en `MOTIVOS_NO_COMPARABLES`).
- Migrar los reportes guardados con `0.8.0`: se leen con `base: "archivo"`.
- Resolver ubicaciones por código de tienda o por alias.

## Riesgos

- Conservar el acumulador en memoria hasta cambiar de archivo (~25 MB por año, ~90 MB el histórico): aceptable; hay que liberarlo en `reiniciarResultados` y al desmontar, y medirlo en el hito con un archivo de un año.
- Si la tabla de QlikView de Javier oculta más de lo previsto (ubicaciones, tallas en blanco), el comparable seguirá diciendo "difiere" en alguna medida; la tabla con las cinco cifras está pensada para que se vea cuál, y la corrección es la constante.
- El ejemplo del encargo (54 762 frente a 54 763) **difiere en 1 unidad** con la regla de unidades exactas; no se maquilla: se muestra.
- Renombrar `tienda_excluida` → `ubicacion_ignorada` toca `tipos.ts`, `informe.ts`, `tipos-api.ts`, `resolver.ts` y un test; QA debe verificar que ningún reporte guardado real lo contenga (no puede, pero se comprueba).
- **Numeración (fijada el 2026-10-12 al integrar PLAN)**: 05b toma `0008` y `0.8.1 · M5`; esta mejora, `0009` y `0.8.2 · M5`; 02b pasa a `0010` y `0.8.3 · M2b`; M6 a `0011` (`0.9.0 · M6` no cambia). Se construye después de 05b.
- **Acumulador compartido con 05b.** Esta ficha dice que `Previsualizacion` "conserva el `acumulador` (hoy se descarta)"; 05b, que se construye antes, ya lo conserva en un `useRef` mientras `prevVigente` exista y libera al elegir otro archivo o terminar la carga. Al construir 05c se **reutiliza ese mecanismo** (no se añade un segundo) y `marcarIgnorada` se apoya en él. Por lo demás las dos mejoras no se pisan: 05b recalcula llamando de nuevo a `previsualizar` (que ya leerá las ubicaciones ignoradas) y 05c recalcula sin llamar; ambas añaden campos al reporte guardado (`reasignadas` y `base_conciliacion`/`comparable`) sin tocar los del otro.

## Decisiones nuevas propuestas (para `docs/DECISIONES.md`, 2026-10-12)

1. **Las ubicaciones del archivo que no son tiendas viven en `ubicaciones_ignoradas`, no en `tiendas` desactivadas.** Sustituye a la entrada del 2026-10-11 "sin tabla de exclusiones". Por qué: Javier las definió como "espacios sin importancia", no como tiendas; el maestro de tiendas no debe llevar filas que no lo son. La tienda manda si coincide el nombre. Descartado: seguir con `tiendas.activo = false`; un botón "Excluir siempre" sin pantalla de administración.
2. **La conciliación contra QlikView compara con el comparable (archivo menos `sin_clasificar` y `fila_total`), mostrando siempre archivo, no comparable, comparable, cargado y QlikView.** Sustituye a "compara con el archivo tal cual". Tolerancias sin cambios. Descartado: conciliar contra lo cargado; restar también ubicaciones ignoradas o géneros desconocidos sin evidencia.

## Cambios que había que hacer en PLAN.md y en otras fichas

> **Integrados el 2026-10-12** por el documentador: PLAN §4 (fila y diagrama), §5 (M2, M5, M6) y §7; fichas `02b`, `04`, `05`, `05b` y `06`; y las ocho propuestas de `DECISIONES.md` (seis de 05b y dos de esta ficha) como "propuesta, pendiente de construcción". `CHANGELOG.md` se escribe al construir. La lista de abajo se conserva como registro de lo pedido.

- `docs/PLAN.md` §4: fila nueva `ubicaciones_ignoradas` (`nombre` único normalizado, `nota` ≤ 200, `activo` por convención sin uso, sin FKs ni seed; 05c, `0009`) y línea en el diagrama; en la fila `venta_stock_mensual`, sustituir "Las tiendas del archivo que no deben cargarse se crean desactivadas en `tiendas` (no hay tabla de exclusiones)" por "las ubicaciones que no son tiendas van en `ubicaciones_ignoradas` (05c) y se excluyen por decisión".
- `docs/PLAN.md` §5, fila M5: añadir la mejora 05c (`0.8.2 · M5`, `0009`, pendiente de aprobación): ubicaciones ignoradas con atajo en el reporte previo y conciliación contra el comparable. Filas M2 (02b) y M6, y las fichas `02b` y `06`: renumerar sus migraciones después de `0009` (lo fija quien integre junto con 05b).
- `docs/PLAN.md` §7, viñeta de M5: en el orden de carga, el paso (2) deja de ser "las tres tiendas… creadas y desactivadas en M4" y pasa a "las tres ubicaciones en Maestros → Tiendas → Ubicaciones ignoradas, o con *Ignorar esta ubicación* desde el reporte previo"; la frase "Sigue abierta… la de las tres tiendas que no son del sistema" pasa a resuelta (05c).
- `docs/modulos/05-venta-stock.md`: "Construido" (desviación de la conciliación contra el archivo tal cual → sustituida en 05c), "Decidido con Javier" 13, sección "Tiendas del archivo que no son del sistema (sin tabla nueva)", "Orden de carga" paso 2, "Tiendas que no deben cargarse", texto del bloque Tiendas desconocidas en Pantallas, reglas 21 y 28, checklist "Antes" y "Reporte previo", "Fuera de alcance" (`tiendas_excluidas`), pregunta abierta 2 (resuelta), "Revisión de diseño" punto 8 y "Cambios respecto a la especificación" 5: todos remiten a 05c.
- `docs/modulos/04-tiendas.md`: viñeta "M5" de "Qué consume la Fase 2" (una tienda desactivada sigue rechazando filas; las ubicaciones que no son tiendas ya no se crean aquí) y la pestaña nueva en Pantallas.
- `docs/DECISIONES.md`: las dos entradas de arriba; `docs/CHANGELOG.md` al construir.

## Preguntas abiertas para Javier (con valor por defecto)

1. **¿Tu tabla de QlikView muestra las filas de la central y las oficinas** (traen género, mundo y línea; solo stock)? **Por defecto: sí**, no se restan del comparable. Si el hito muestra que el stock difiere exactamente por esa línea, se añaden a `MOTIVOS_NO_COMPARABLES`.
2. **¿Muestra filas con género, mundo o línea que no existan en el árbol?** **Por defecto: sí**, no se restan (son errores a corregir, no filas invisibles).
3. **Unidades exactas** (decidido). En el ejemplo, 54 762 frente a 54 763 saldrá "Difiere en 1 unidad". ¿Quieres admitir una tolerancia absoluta pequeña en unidades (por ejemplo ±2)? **Por defecto: no.**
4. **¿Ya creaste las tres como tiendas desactivadas?** **Por defecto:** elimínalas de Tiendas (no tienen hechos) y dalas de alta como ignoradas; si prefieres dejarlas, siguen saliendo como "Tienda desactivada" y nada se rompe.
5. **Baja = borrar la fila** (sin "desactivar"). **Por defecto: sí.**
6. **Editar el nombre** de una ubicación ignorada (además de la nota). **Por defecto: sí**, con las mismas validaciones que el alta.
7. **Nombre de la pestaña y del motivo**: "Ubicaciones ignoradas" y "Ubicación ignorada (no es tienda)". **Por defecto: esos.**

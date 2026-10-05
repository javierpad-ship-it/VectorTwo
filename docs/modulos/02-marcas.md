# M2 · Agrupaciones de marca y marcas

> Estado: **construido (2026-10-05, `0.3.0 · M2`); hito pendiente de recorrer por Javier**. Módulo anterior: [01-arbol-producto](01-arbol-producto.md). Reglas de base en `docs/PLAN.md` §4 y `docs/DECISIONES.md`. Lo que se construyó distinto de lo especificado está en "Cambios respecto a la especificación", al final; la ficha describe lo que hay en el código.

## Objetivo

Dar al planner el maestro de marcas con el que Lukers planifica: cada marca pertenece a **una** agrupación de marca (Ultra Low · Mid Value · Valor · Reconocido · Premium, nombres todavía no oficiales y por eso editables) y puede llevar la bandera **tratamiento especial**, que la Fase 2 usará para tratarla aparte al elaborar los flujos. Javier pidió dos mantenimientos separados ("uno de agrupación de marcas y otro para asignar las marcas a cada grupo") y todavía no entregó la lista de marcas, así que el módulo tiene que quedar usable con alta manual desde el primer día y con un importador CSV/Excel para cuando llegue el archivo.

La relación Marca ↔ Equivalencia (`equivalencia_marca` en PLAN §4) **no** se construye aquí: se propone derivarla de la data real de venta y stock en M5 (ver "Fuera de alcance" y pregunta abierta 1).

## Modelo de datos

Migración `supabase/migrations/0002_marcas.sql`, idempotente, sin bloques `do $$`. Mismas convenciones que M1: `id uuid primary key default gen_random_uuid()`, `activo boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` con `public.tg_set_updated_at()` (existe desde M0), `enable row level security` sin políticas, FKs `on delete restrict`.

**Trigger sin `drop`.** A diferencia de `0001`, el trigger se declara con `create or replace trigger set_updated_at before update on … for each row execute function public.tg_set_updated_at()`. Las migraciones se aplican con `execute_sql` del MCP y cualquier `DROP` se queda colgado; `create or replace trigger` es idempotente por sí solo (Postgres ≥ 14). `0001` ya está aplicada y no se toca.

### Convenciones de nombre y código (heredadas de M1)

- `nombre` se guarda **normalizado** con `normalizarNombre` de `src/lib/arbol/normalizar.ts` (NFC, `trim`, espacios colapsados, mayúsculas en español). Vale para agrupaciones y marcas: `levi's` → `LEVI'S`, `Mid Value` → `MID VALUE`. Por eso el seed de agrupaciones va en mayúsculas: si se guardara `Mid Value` y Javier lo editara desde la pantalla, el `PATCH` lo devolvería como `MID VALUE` y parecería un error.
- `codigo` ASCII con `aCodigo`, único sobre `upper(codigo)`, propuesto al crear y editable: `MID VALUE` → `MID_VALUE`, `LEVI'S` → `LEVI_S`, `H&M` → `H_M`. Si dos marcas distintas derivan al mismo código, el importador agrega `_2`, `_3` con `codigoUnico` (ya existe en `src/lib/arbol/importar.ts`).
- Las agrupaciones llevan `orden` (lista fija, como géneros y mundos). Las marcas se ordenan por `nombre`.

### `agrupaciones_marca`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | `check (length between 1 and 40)`; único `agrupaciones_marca_codigo_uniq on (upper(codigo))` |
| `nombre` | `text not null` | `check (length between 1 and 120)`; único `agrupaciones_marca_nombre_uniq on (nombre)` |
| `orden` | `integer not null default 0` | |

Misma estructura que `generos` y `mundos`, así reutiliza sin cambios `crearCatalogoSchema` / `editarCatalogoSchema` y el helper `src/lib/api/catalogo.ts`. Es un catálogo **abierto** (a diferencia de `agrupaciones_talla`): crear, renombrar, reordenar, desactivar y eliminar desde pantalla, tal como registra la decisión "Agrupaciones de marca con mantenimiento" del 2026-10-02.

Seed (`insert … on conflict ((upper(codigo))) do nothing`), en el orden que dio Javier:

| codigo | nombre | orden |
|---|---|---|
| `ULTRA_LOW` | ULTRA LOW | 10 |
| `MID_VALUE` | MID VALUE | 20 |
| `VALOR` | VALOR | 30 |
| `RECONOCIDO` | RECONOCIDO | 40 |
| `PREMIUM` | PREMIUM | 50 |

El "1 · 2 · 3 · 4 · 5" con que Javier numera las agrupaciones es `orden / 10`; la pantalla muestra la columna `orden` como en Catálogos. El seed solo inserta lo que falta: si Javier renombra `MID VALUE` a otra cosa, volver a aplicar la migración **no** lo revierte (el conflicto es por código y hace `do nothing`).

### `marcas`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | `check (length between 1 and 40)`; único `marcas_codigo_uniq on (upper(codigo))` |
| `nombre` | `text not null` | `check (length between 1 and 120)`; único `marcas_nombre_uniq on (nombre)` |
| `agrupacion_marca_id` | `uuid not null references agrupaciones_marca(id) on delete restrict` | toda marca tiene agrupación; no hay comodín "sin agrupar" (mismo criterio que "toda línea tiene mundo") |
| `tratamiento_especial` | `boolean not null default false` | la marca se trata aparte al elaborar los flujos (Fase 2) |
| `nota_tratamiento` | `text null` | `check marcas_nota_len_check (nota_tratamiento is null or length(nota_tratamiento) between 1 and 200)` y `check marcas_nota_sin_tratamiento_check (nota_tratamiento is null or tratamiento_especial)` |

Índices: los dos únicos de arriba e `index marcas_agrupacion_marca_id_idx on (agrupacion_marca_id)` (filtro por agrupación y conteo de hijos al eliminar una agrupación). No se indexa `tratamiento_especial`: son cientos de filas y el filtro se hace en memoria en la pantalla.

**Por qué el nombre de marca es único global y no por agrupación.** Una marca está en una sola agrupación; dos filas `LEVI'S` en agrupaciones distintas serían un error de carga, no dos marcas. Y la Fase 2 va a resolver cada fila de venta por nombre de marca: necesita que el nombre identifique una sola fila.

**Por qué la nota exige la bandera.** `nota_tratamiento` explica *por qué* la marca tiene tratamiento especial; una nota sin bandera no tiene lectura posible y confundiría a quien filtre por tratamiento. Al desmarcar la bandera la API borra la nota (regla 6); el `check` es la garantía de que nunca queda una nota huérfana aunque alguien escriba por el SQL Editor. Se guarda recortada (`trim`); una cadena vacía se convierte en `null`. Es texto libre corto (≤ 200) y no un catálogo de motivos: Javier no ha dicho que haya tipos de tratamiento (pregunta abierta 6).

**Borrado y desactivación.** Misma regla que el árbol: la acción normal es desactivar. Eliminar una agrupación solo con 0 marcas (activas o no), lo garantiza el `restrict` y el handler lo anticipa con `motivoRechazoEliminar("agrupacion_marca", n)` → `409 "No se puede eliminar la agrupación de marca: tiene N marcas. Desactívala."`. Eliminar una marca es posible en M2 (no tiene hijos todavía); dejará de poderse cuando M5 cuelgue filas de venta y stock. Desactivar una agrupación **no** se propaga: una marca es vigente si `marca.activo ∧ agrupacion.activo` (`marcaVigente`, regla 2) y la pantalla la muestra como "Oculta por agrupación inactiva", igual que `nodoVigente` en M1.

### Diagrama

```
agrupaciones_marca (ULTRA LOW · MID VALUE · VALOR · RECONOCIDO · PREMIUM)
        │ 1
        │
        ▼ N
      marcas ── tratamiento_especial (bool) + nota_tratamiento (≤ 200, solo con bandera)
        │
        └──▶ (M5) venta y stock traen marca + equivalencia; de ahí se deriva qué marcas hay en cada equivalencia
```

## Contratos de API

Todos devuelven `{ data }` con `ok()` o `{ error }` con `error()` de `src/lib/api/respuestas.ts`; cuerpos con `leerCuerpo` y esquemas zod en `src/lib/marcas/esquemas.ts`; ids de ruta con `idDeRuta`; errores de base con `traducirErrorDb`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod o `check` · `404` id inexistente o no UUID · `409` regla de negocio, único o FK · `500` genérico. Lecturas con `?incluir_inactivos=1`, por defecto solo `activo = true`, siempre vía `leerTodo`.

Extensiones a lo compartido (sin cambiar el comportamiento de M1; sus 131 tests siguen en verde):

- `src/lib/api/catalogo.ts`: `TablaCatalogo` suma `"agrupaciones_marca"`. `columnaHijos` / `conConteoNodos` se generalizan a `hijos?: { tabla: "genero_mundo_linea" | "marcas"; columna: string; clave: "nodos" | "marcas" }` de modo que el conteo que se anexa a cada fila se llame como diga `clave` (`nodos` para géneros, mundos y líneas; `marcas` para agrupaciones). Los tres configs de M1 se ajustan mecánicamente.
- `src/lib/arbol/reglas.ts`: `TipoEliminable` suma `"agrupacion_marca"` (sujeto "la agrupación de marca", hijos "marca/marcas", "Desactívala") y `"marca"` (hijos "registro asociado/s", "Desactívala").
- `src/lib/api/errores-db.ts`: `MENSAJES_UNICO` suma `agrupaciones_marca_codigo` / `agrupaciones_marca_nombre` ("Ya existe una agrupación de marca con ese código/nombre.") y `marcas_codigo` / `marcas_nombre` ("Ya existe una marca con ese código/nombre."); `MENSAJES_CHECK` suma `marcas_nota_len` ("La nota no puede superar 200 caracteres.") y `marcas_nota_sin_tratamiento` ("La nota solo se guarda si la marca tiene tratamiento especial.").

### Agrupaciones de marca (catálogo plano, helper `catalogo.ts`)

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/agrupaciones-marca` | GET | `requireUser` | — | `agrupaciones_marca[]` por `orden, nombre`, cada fila con `marcas: number` (todas, activas o no) y `marcas_activas: number` |
| `/api/agrupaciones-marca` | POST | `requireAdmin` | `crearCatalogoSchema` | fila creada, `201`; `409` nombre o código repetido |
| `/api/agrupaciones-marca/[id]` | PATCH | `requireAdmin` | `editarCatalogoSchema` | fila actualizada; `404`; `409` repetido |
| `/api/agrupaciones-marca/[id]` | DELETE | `requireAdmin` | — | `{ id }`; `409` si tiene marcas (conteo en el mensaje) |

Escritura `requireAdmin` porque es un catálogo raíz, como géneros y mundos (si Javier prefiere que el planner también lo edite, es cambiar `guardEscritura` en la config: pregunta abierta 2). Config en `src/lib/marcas/catalogos.ts` → `catalogoAgrupacionesMarca: ConfigCatalogo<"agrupaciones_marca">` con `tipo: "agrupacion_marca"`, `hijos: { tabla: "marcas", columna: "agrupacion_marca_id", clave: "marcas" }`. `marcas_activas` lo calcula el mismo listado (una lectura de `marcas` con `id, agrupacion_marca_id, activo`); la pantalla lo usa en el `confirm` de desactivar.

```jsonc
{ "data": [
  { "id": "…", "codigo": "ULTRA_LOW", "nombre": "ULTRA LOW", "orden": 10, "activo": true,
    "created_at": "…", "updated_at": "…", "marcas": 12, "marcas_activas": 11 }
] }
```

### Marcas

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/marcas?agrupacion_id=&incluir_inactivos=1` | GET | `requireUser` | — | `marcas[]` por `nombre`, con la agrupación embebida y `vigente`. `400` si `agrupacion_id` no es UUID |
| `/api/marcas` | POST | `requirePlanner` | `crearMarcaSchema` | `201`; `404` agrupación inexistente · `409` agrupación inactiva · `409` nombre o código repetido · `400` nota sin bandera |
| `/api/marcas/[id]` | PATCH | `requirePlanner` | `editarMarcaSchema` | actualizada; `404`; `409` si `agrupacion_marca_id` apunta a una agrupación inactiva o inexistente (`404`); `409` repetido; `400` nota sin bandera |
| `/api/marcas/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` si tiene hijos (ninguno en M2; a partir de M5) |

```jsonc
// GET /api/marcas
{ "data": [
  { "id": "…", "codigo": "LEVI_S", "nombre": "LEVI'S", "agrupacion_marca_id": "…",
    "tratamiento_especial": true, "nota_tratamiento": "Marca con flujo propio por licencia",
    "activo": true, "created_at": "…", "updated_at": "…",
    "agrupacion_marca": { "id": "…", "codigo": "PREMIUM", "nombre": "PREMIUM", "orden": 50, "activo": true },
    "vigente": true }          // activo ∧ agrupacion_marca.activo
] }
```

El handler lee `marcas` con `select("*, agrupacion_marca:agrupaciones_marca(id, codigo, nombre, orden, activo)")` paginado con `leerTodo` y calcula `vigente` con `marcaVigente`. Sin `incluir_inactivos` filtra `marcas.activo = true` (una marca activa de una agrupación inactiva sí viaja, con `vigente: false`, para que la pantalla la muestre atenuada; es la misma semántica que `GET /api/arbol`).

```ts
// pseudocódigo zod — src/lib/marcas/esquemas.ts (reutiliza nombre, codigo, codigoOpcional, uuid, activo de arbol/esquemas.ts; exportarlos si hace falta)
const notaTratamiento = z.string().nullable().optional()
  .transform(v => { const t = (v ?? "").trim(); return t === "" ? null : t; })
  .pipe(z.string().max(200, "La nota no puede superar 200 caracteres.").nullable());

crearMarcaSchema = z.object({
  nombre, codigo: codigoOpcional, agrupacion_marca_id: uuid,
  tratamiento_especial: z.boolean().default(false),
  nota_tratamiento: notaTratamiento,
}).transform(derivarCodigo)
  .refine(v => v.nota_tratamiento === null || v.tratamiento_especial,
          { message: "La nota solo se guarda si la marca tiene tratamiento especial.", path: ["nota_tratamiento"] });

editarMarcaSchema = z.object({
  nombre, codigo, agrupacion_marca_id: uuid,
  tratamiento_especial: z.boolean(), nota_tratamiento: notaTratamiento, activo,
}).partial().refine(tieneAlgo, noVacio);
// La coherencia nota ↔ bandera en PATCH la resuelve el handler con `normalizarTratamiento(cambio, actual)` (regla 6),
// porque depende del valor actual de la marca que el esquema no conoce.
```

Orden de comprobaciones en `POST` y en `PATCH` con `agrupacion_marca_id`: existe la agrupación (`404 "Agrupación de marca no encontrada."`) → está activa (`409 "La agrupación X está inactiva: reactívala antes de asignarle marcas."`) → escribir y traducir únicos. Un `PATCH` que **no** toca `agrupacion_marca_id` sobre una marca cuya agrupación está inactiva sí se permite (renombrar, desactivar, reactivar): la restricción es sobre *mover a* una agrupación inactiva, no sobre *estar* en ella.

### Importador de marcas

`POST /api/marcas/importar` · `requirePlanner`.

```ts
filaImportacionMarcaSchema = z.object({
  marca: z.string(), agrupacion: z.string(),
  tratamiento_especial: z.string().default(""),   // la columna es opcional en el archivo; el cliente manda "" si no la mapeó
});
importarMarcasSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"]),
  filas: z.array(filaImportacionMarcaSchema).min(1).max(10_000),
});
```

El cliente lee el archivo con `leerArchivoTabular` (`src/lib/arbol/leer-archivo.ts`: CSV con papaparse, Excel con SheetJS bajo demanda, selector de hoja) y mapea columnas con autodetección por nombre: `MARCA` (alias `MARCAS`, `BRAND`), `AGRUPACION` (alias `AGRUPACION_MARCA`, `AGRUPACIÓN`, `GRUPO`, `GRUPO_MARCA`, `NIVEL`), `TRATAMIENTO_ESPECIAL` (alias `TRATAMIENTO`, `ESPECIAL`). Las dos primeras son obligatorias para habilitar Previsualizar; la tercera es opcional y, si no se mapea, todas las marcas nuevas entran con `tratamiento_especial = false`.

Algoritmo, función pura `planificarImportacionMarcas(filas, estado)` en `src/lib/marcas/importar.ts`, donde `estado = { agrupaciones, marcas }` leídos planos de la base (ambas tablas completas, activas e inactivas):

1. Normalizar `marca` y `agrupacion` con `normalizarNombre`. `marca` vacía → `omitida` (`marca_vacia`). `marca === "TOTAL"` → `omitida` (`fila_total`).
2. Resolver la **agrupación** con `resolverCatalogo` de `src/lib/arbol/importar.ts` (solo activas; por `aCodigo(valor) = codigo` o por `nombre`). Si no resuelve, se reintenta con el valor **sin prefijo numérico** (`1 ULTRA LOW` → `ULTRA LOW`, `3 - VALOR` → `VALOR`; función `sinPrefijoNumerico`), porque Javier numera las agrupaciones así. Vacía → `agrupacion_vacia`; no existe → `agrupacion_desconocida` (con `detalle`); existe pero inactiva → `agrupacion_inactiva`. **El importador no crea agrupaciones** (son raíz y de admin; mismo criterio que géneros y mundos en M1).
3. Leer **tratamiento especial** con `leerSiNo(valor): boolean | null`: `""`, `NO`, `N`, `0`, `FALSE`, `FALSO` → `false`; `SI`, `SÍ`, `S`, `X`, `1`, `TRUE`, `VERDADERO`, `YES`, `Y` → `true` (sin distinguir caja ni acentos); cualquier otra cosa → `omitida` (`tratamiento_invalido`, `detalle` = el valor). No se importa `nota_tratamiento`: el archivo no la trae y es texto libre que se escribe desde la pantalla.
4. **Duplicados en el archivo** por nombre de marca normalizado → `duplicada_en_archivo` con `fila_original` (la primera aparición manda, aunque la segunda traiga otra agrupación: se informa en `detalle` "agrupación distinta: X").
5. **Marca existente** (por `nombre`): `existentes++` si está activa, `existentes_inactivos++` si no; **no se modifica**. Si la agrupación o el tratamiento del archivo difieren de lo que hay en la base, se anota en `diferencias[]` (`{ fila, marca, campo: "agrupacion" | "tratamiento_especial", en_base, en_archivo }`), informativo: el importador nunca actualiza ni reactiva, igual que en M1 (pregunta abierta 4 por si Javier quiere lo contrario).
6. **Marca nueva** → `crear.marcas++` con `codigo = codigoUnico(aCodigo(nombre), usados, "MARCA")` donde `usados` son los códigos de la base más los del propio archivo; `crear.con_tratamiento_especial` cuenta cuántas de las nuevas llevan la bandera. `muestra.marcas` lista las primeras 20 como `"LEVI'S → PREMIUM"`.
7. `previsualizar` devuelve el reporte sin escribir. `aplicar` inserta en tandas de 500 (`enTandas`) con `upsert(filas, { onConflict: "nombre", ignoreDuplicates: true })` (solo columnas en `onConflict`, nunca expresiones) y cuenta lo realmente insertado. Sin transacción; si una tanda falla, `500` con lo creado hasta ahí y **reimportar completa el resto sin duplicar**.

Reporte, igual en los dos modos (en `aplicar`, `crear` es lo insertado):

```jsonc
{ "data": {
  "modo": "previsualizar",
  "totales": { "recibidas": 240, "procesadas": 231, "omitidas": 9 },
  "crear": { "marcas": 225, "con_tratamiento_especial": 14 },
  "existentes": { "marcas": 6 },
  "existentes_inactivos": { "marcas": 0 },
  "diferencias": [
    { "fila": 18, "marca": "LEVI'S", "campo": "agrupacion", "en_base": "RECONOCIDO", "en_archivo": "PREMIUM" }
  ],
  "omitidas": [
    { "fila": 3,  "motivo": "agrupacion_desconocida", "detalle": "ULTRA LOWW", "marca": "ACME", "agrupacion": "ULTRA LOWW", "tratamiento_especial": "" },
    { "fila": 40, "motivo": "duplicada_en_archivo", "fila_original": 12, "marca": "ADIDAS", "agrupacion": "PREMIUM", "tratamiento_especial": "SI" },
    { "fila": 77, "motivo": "tratamiento_invalido", "detalle": "TAL VEZ", "marca": "ZARA", "agrupacion": "VALOR", "tratamiento_especial": "TAL VEZ" }
  ],
  "muestra": { "marcas": ["ACME → ULTRA LOW", "…"] }
} }
```

Cada omitida lleva la fila completa normalizada (`marca`, `agrupacion`, `tratamiento_especial` tal como vino) para corregir el archivo desde la previsualización, como en M1. Motivos (`MotivoOmisionMarca` en `src/lib/marcas/tipos.ts`): `marca_vacia`, `fila_total`, `agrupacion_vacia`, `agrupacion_desconocida`, `agrupacion_inactiva`, `tratamiento_invalido`, `duplicada_en_archivo`; etiquetas legibles en `ETIQUETA_MOTIVO_OMISION_MARCA` (`tipos-api.ts`). Los motivos "con errores" son todos menos `duplicada_en_archivo`.

## Pantallas

Ruta `/maestros/marcas`. En `src/lib/nav.ts` se quita `pendiente: "M2"` del item "Agrupaciones y marcas"; conserva `roles: PLANIFICACION` (decisión registrada: los items M2–M4 son de admin y planner; si Javier quiere que el comprador vea las marcas, es una línea, pregunta abierta 7). `page.tsx` servidor redirige a `/` si `perfilActual()` no es `ok` o `!puedeEditarMaestros(rol)`, igual que `catalogos/page.tsx`, y pasa `rol` al panel cliente `marcas-panel.tsx`.

Un solo panel con tres pestañas (`Tabs`): **Agrupaciones · Marcas · Importar**, con **Marcas** abierta por defecto (es donde se trabaja a diario; las agrupaciones son cinco y rara vez cambian). Encima, resumen `5 agrupaciones · N marcas · M con tratamiento especial` (cuenta solo activas, de las dos colecciones cargadas con `useColeccion`) y el interruptor **Mostrar inactivos** (`Switch`), compartido por las dos primeras pestañas.

### Pestaña Agrupaciones (admin edita; planner solo ve)

Reutiliza el componente `CatalogoPlano` de `catalogos-panel.tsx`, que para eso se extrae a `src/components/catalogo/catalogo-plano.tsx` (junto a `vista-previa-nombre.tsx`) con props `recurso`, `singular`, `plural`, `puedeEditar`, `hijos: { clave: "nodos" | "marcas", titulo, avisoDesactivar, bloqueoEliminar }` y `vigentes?: (fila) => number` opcional. Catálogos de M1 lo sigue usando con `hijos.clave = "nodos"` sin cambio visible.

| Columnas | Alta y edición | Quién edita |
|---|---|---|
| orden, código, nombre, marcas (`marcas` de la API), estado | nombre, código, orden (formulario arriba, edición en línea abajo); desactivar/reactivar; eliminar (solo con 0 marcas; el botón se deshabilita con `title` "Tiene marcas: desactívala en vez de eliminarla.") | admin |

- El `confirm` de desactivar dice "Quedarán ocultas N marcas activas hasta que la reactives" con `marcas_activas`.
- Planner y comprador (si llegara) ven la tabla con el `Alert` informativo "Las agrupaciones las gestiona un administrador".
- Vista previa del nombre normalizado y del código propuesto (`VistaPreviaNombre`).

### Pestaña Marcas (admin y planner)

Carga `GET /api/marcas?incluir_inactivos=1` y `GET /api/agrupaciones-marca?incluir_inactivos=1` una vez; filtra en memoria.

**Formulario de alta** (`Card` "Nueva marca"): nombre (obligatorio), código (propuesto, editable), agrupación (`Select` con las agrupaciones **activas** por `orden`; vacío por defecto, obligatorio), casilla "Tratamiento especial", y nota (≤ 200, con contador) visible solo con la casilla marcada. Vista previa "Se guardará como LEVI'S con código LEVI_S". Tras crear: `Alert` de éxito y el formulario se limpia conservando la agrupación elegida (para cargar varias seguidas de la misma agrupación).

**Filtros**, encima de la tabla: chips por agrupación con conteo (`Chips`: Todas · ULTRA LOW (12) · …, incluyendo agrupaciones inactivas solo si "Mostrar inactivos" está encendido), chip "Con tratamiento especial (M)", y buscador por texto que compara contra `nombre` normalizado y `codigo` (`aCodigo` del texto), como el filtro de Líneas.

**Tabla** (`DataTable`), ordenada por nombre:

| Columna | Lectura | Edición en línea (planner y admin) |
|---|---|---|
| Código | `code` | `Input` |
| Nombre | negrita | `Input` |
| Agrupación | nombre; si la agrupación está inactiva, badge "Agrupación inactiva" | `Select` con agrupaciones activas (más la actual si está inactiva, deshabilitada) |
| Tratamiento especial | `Badge` tono `marca` "Tratamiento especial" si aplica; vacío si no | casilla |
| Nota | texto, truncado con `title` completo | `Input` (≤ 200), deshabilitado si la casilla está apagada |
| Estado | `Badge` Activa / Desactivada; "Oculta por agrupación inactiva" si `!vigente` con `activo` | — |
| Acciones | — | Editar · Guardar/Cancelar · Desactivar/Reactivar · Eliminar |

- Cambiar la agrupación o la bandera **sin entrar en edición** se guarda al instante (`PATCH` con solo ese campo), como la temporada de Líneas; nombre, código y nota se editan con Editar → Guardar.
- Al apagar la casilla con una nota escrita, el `confirm` avisa "Se borrará la nota" (regla 6).
- Eliminar pide `confirm`; en M2 siempre está habilitado (sin hijos). Desactivar no pide `confirm` (no oculta nada más).
- Errores `400/404/409` de la API se muestran con `Alert` tal cual llegan.
- Vacío: "Sin marcas. Crea la primera o importa el archivo de marcas."

### Pestaña Importar (admin y planner)

Mismo flujo de cuatro pasos que la pestaña Importar CSV de M1 (`importar-csv.tsx`): 1. Archivo (CSV/Excel, selector de hoja) → 2. Mapeo de columnas (MARCA y AGRUPACION obligatorias, TRATAMIENTO_ESPECIAL opcional con la nota "si no la mapeas, las marcas nuevas entran sin tratamiento especial") → 3. Previsualizar → 4. Aplicar, habilitado solo con una previsualización vigente del mismo archivo y mapeo; `confirm` con "Se crearán N marcas (M con tratamiento especial). Quedarán fuera K filas con errores. J repetidas se cargan una sola vez."

Reporte: tarjetas `Se crearán` (marcas, con tratamiento especial) · `Ya existían` · `Existentes inactivas (no se tocan)` · `Omitidas` (con errores / repetidas); bloque **Filas con errores** con filtro por motivo, aviso "Estas filas NO se cargarán…", botón **Descargar omitidas (CSV)** (BOM); bloque **Repetidas en el archivo**; bloque nuevo **Diferencias con lo ya cargado** (tabla `fila · marca · campo · en la base · en el archivo`, con el aviso "El importador no modifica marcas existentes; cámbialas desde la pestaña Marcas") y la muestra de marcas que se crearán. "Nada nuevo que crear" cuando `crear.marcas = 0`.

Para no duplicar 500 líneas, las piezas genéricas de `importar-csv.tsx` (selector de archivo y hoja, mapeo por campos, tarjetas, `Muestra`, descarga de omitidas) se extraen a `src/components/importador/` parametrizadas por la lista de campos y por las columnas de la fila omitida; el importador del árbol pasa a usarlas sin cambiar su comportamiento ni su hito. Es una decisión del frontend; lo que no es negociable es que M1 siga igual.

## Reglas de negocio

Funciones puras en `src/lib/marcas/` probadas en `tests/marcas.*.test.ts`. Normalización y códigos se toman de `src/lib/arbol/normalizar.ts` (no se duplica).

**`reglas.ts`**

1. `marcaVigente(marca, agrupacion)` es `marca.activo ∧ agrupacion.activo`. Marca activa en agrupación inactiva → `false`; marca inactiva en agrupación activa → `false`.
2. `motivoRechazoAgrupacionDestino(agrupacion | undefined)`: `undefined` → "Agrupación de marca no encontrada." (el handler responde `404`); `activo = false` → "La agrupación X está inactiva: reactívala antes de asignarle marcas." (`409`); activa → `null`. Se aplica en `POST` siempre y en `PATCH` solo si el cuerpo trae `agrupacion_marca_id`; un `PATCH` sin ese campo sobre una marca de agrupación inactiva no se rechaza.
3. `motivoRechazoMarca(marcasExistentes, cambio)`: nombre repetido tras normalizar (sin contar la propia marca) → rechazo; código repetido sin distinguir caja → rechazo; si no, `null`. (El índice único es la garantía; la función da el mensaje antes de intentar y sirve al cliente.)
4. `motivoRechazoEliminar("agrupacion_marca", n)` con `n > 0` → "No se puede eliminar la agrupación de marca: tiene N marcas. Desactívala."; con `0` → `null`. `motivoRechazoEliminar("marca", 0) === null`.
5. El seed queda en el orden `ULTRA_LOW < MID_VALUE < VALOR < RECONOCIDO < PREMIUM` por `orden`: `SEED_AGRUPACIONES_MARCA` exportado de `src/lib/marcas/seed.ts` y el test comprueba códigos, nombres en mayúsculas normalizadas (`normalizarNombre(nombre) === nombre`), `aCodigo(nombre) === codigo` y `orden` estrictamente creciente. El agente `datos` usa la misma constante para escribir el `insert` de la migración.
6. `normalizarTratamiento(cambio, actual)` devuelve el par `{ tratamiento_especial, nota_tratamiento }` que se escribirá: bandera resultante `false` → nota `null` siempre (aunque el cuerpo traiga nota, o aunque `actual` la tuviera); bandera resultante `true` → la nota del cuerpo si viene, si no la actual; nota vacía o solo espacios → `null`; nota de más de 200 → rechazo "La nota no puede superar 200 caracteres."; cuerpo con nota y bandera resultante `false` cuando el cuerpo **no** trae la bandera (es decir, `actual.tratamiento_especial === false`) → rechazo "Marca el tratamiento especial para agregar una nota." (`400`).

**`importar.ts` — `planificarImportacionMarcas(filas, estado)`**

7. `leerSiNo`: `"sí"`, `"SI"`, `" s "`, `"x"`, `"1"`, `"true"`, `"verdadero"`, `"yes"` → `true`; `""`, `"no"`, `"N"`, `"0"`, `"false"`, `"falso"` → `false`; `"tal vez"`, `"2"` → `null`.
8. `sinPrefijoNumerico("1 ULTRA LOW") === "ULTRA LOW"`, `("3 - VALOR") === "VALOR"`, `("5.PREMIUM") === "PREMIUM"`, `("PREMIUM") === "PREMIUM"`, `("1") === ""` (un número solo no es un nombre).
9. Una fila con agrupación vacía, desconocida o inactiva va a `omitidas` con su motivo (y `detalle` en las dos últimas) y no genera nada; se resuelve por código, por nombre y, si falla, sin prefijo numérico. El plan nunca contiene agrupaciones nuevas (`plan.crear` no tiene clave `agrupaciones`).
10. `tratamiento_especial` inválido → `omitida` (`tratamiento_invalido`) aunque la marca y la agrupación sean válidas; columna no mapeada (cadena vacía) → `false` y la fila se procesa.
11. Duplicadas por nombre normalizado cuentan una vez, `fila_original` apunta a la primera aparición y, si la agrupación difiere, `detalle` lo dice. `marca_vacia` y `fila_total` se omiten antes de la comprobación de duplicados.
12. Marca existente (activa o inactiva) nunca entra en `crear`; se cuenta en `existentes` o `existentes_inactivos` y, si difiere en agrupación o tratamiento, aparece en `diferencias` con `en_base` y `en_archivo` legibles (nombres de agrupación, `SI`/`NO`). El plan **no** modifica ni reactiva nada.
13. Códigos: `codigoUnico` sobre los de la base más los del archivo; dos marcas nuevas `LEVI'S` y `LEVI-S` reciben `LEVI_S` y `LEVI_S_2`.
14. **Idempotencia**: `planificarImportacionMarcas(filas, aplicarPlanMarcas(estado, plan))` devuelve `crear.marcas = 0`, `existentes.marcas` igual a lo creado antes y `diferencias = []`; aplicar dos veces el mismo plan produce el mismo estado.
15. Conteos consistentes: `recibidas = procesadas + omitidas`; `procesadas = crear.marcas + existentes.marcas + existentes_inactivos.marcas`; `crear.con_tratamiento_especial ≤ crear.marcas`.

**`esquemas.ts`**

16. `crearMarcaSchema` normaliza nombre y deriva código si falta; rechaza nota con `tratamiento_especial = false`; convierte nota `""` en `null`; rechaza `agrupacion_marca_id` que no sea UUID. `editarMarcaSchema` rechaza el cuerpo vacío.

## Hito de prueba

Cómo se recorre: en local (`INICIAR.cmd`) o en Railway una vez desplegado `0.3.0 · M2`, con tres sesiones (admin, planner y comprador) y un CSV de prueba inventado (sin datos reales de Lukers). Los dos primeros puntos los cubrió QA el 2026-10-05; el resto los recorre Javier en la pantalla `/maestros/marcas` y, donde dice `GET`/`POST`/`PATCH`, con el navegador o `curl` contra la API. Las consultas `select count(*)` se hacen en el SQL Editor de Supabase.

- [x] Checks automáticos: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (194 pruebas en 15 archivos: los 131 de M1 más 63 en `tests/marcas.*` y un caso nuevo en `tests/nav.test.ts`), `npm run build` y `scripts/validar-migraciones-local.sh` (todas las migraciones dos veces) en verde.
- [x] `0002_marcas.sql` aplicada en `vector-two` sin error y sin ningún `DROP` (la idempotencia se validó con dos pasadas en Postgres local); tipos regenerados; `APP_VERSION` = `0.3.0 · M2`.
- [ ] Tras la migración: `GET /api/agrupaciones-marca` devuelve exactamente 5 filas en el orden ULTRA LOW · MID VALUE · VALOR · RECONOCIDO · PREMIUM, todas con `marcas: 0`; `select count(*) from marcas` = 0.
- [ ] El menú muestra "Agrupaciones y marcas" habilitado para admin y planner; el comprador no lo ve y `/maestros/marcas` le redirige a `/`; `GET /api/marcas` como comprador responde `200` (lectura) y `POST /api/marcas` `403`.
- [ ] Como planner: `POST /api/agrupaciones-marca` → `403`; en la pestaña Agrupaciones no hay formulario ni botones, sí la tabla.
- [ ] Como admin: renombrar `MID VALUE` a `  valor medio ` → queda `VALOR MEDIO`, el código no cambia; cambiar el orden de PREMIUM a 5 y verlo primero; crear una sexta agrupación `PRUEBA`; eliminarla (0 marcas) → desaparece. Intentar crear otra `premium` → `409`.
- [ ] Como planner, en Marcas: crear `  levi's ` en PREMIUM con tratamiento especial y nota "Licencia" → se guarda `LEVI'S` / `LEVI_S`, badge "Tratamiento especial", nota visible; crear `Levis` → se guarda `LEVIS` sin conflicto; crear `LEVI'S` de nuevo → `409` legible. Crear una marca sin agrupación → el formulario no lo permite (botón deshabilitado).
- [ ] Cambiar la agrupación de `LEVI'S` desde el `Select` de la fila → se guarda al instante y el chip de conteo de PREMIUM baja y el de la nueva sube; el `marcas` de `GET /api/agrupaciones-marca` lo refleja.
- [ ] Apagar la casilla de tratamiento de `LEVI'S` → `confirm` "Se borrará la nota"; tras aceptar, la nota queda vacía en la fila y `nota_tratamiento` es `null` en la base. `PATCH /api/marcas/[id]` con `{ "nota_tratamiento": "x" }` sobre esa marca → `400` "Marca el tratamiento especial…". `PATCH` con nota de 201 caracteres → `400`.
- [ ] Como admin, desactivar la agrupación VALOR con 2 marcas activas: el `confirm` dice "Quedarán ocultas 2 marcas activas"; en Marcas aparecen con "Oculta por agrupación inactiva" y el chip de VALOR solo se ve con "Mostrar inactivos"; intentar mover otra marca a VALOR → `409` "está inactiva"; renombrar una de esas marcas sí funciona; reactivar VALOR las devuelve tal cual (una que se había desactivado a mano sigue inactiva). Intentar eliminar VALOR → `409` con "tiene 2 marcas".
- [ ] Importar un CSV de prueba (sin datos reales de Lukers) con columnas `MARCA, AGRUPACION, TRATAMIENTO_ESPECIAL` y, a propósito: una agrupación escrita `1 Ultra Low`, otra `ULTRA LOWW`, una fila con agrupación vacía, una repetida con agrupación distinta, una con tratamiento `tal vez`, una marca que ya existe con otra agrupación y una fila `TOTAL`. Previsualizar: el mapeo se autodetecta; la primera resuelve a ULTRA LOW; las demás salen en "Filas con errores" o "Repetidas" con el motivo y la fila completa; la existente aparece en "Diferencias con lo ya cargado"; `Descargar omitidas (CSV)` abre en Excel con acentos correctos.
- [ ] Aplicar: el `confirm` repite los conteos; el reporte final coincide con la previsualización; la pestaña Marcas muestra las nuevas con su agrupación y su bandera; la marca existente **no** cambió de agrupación.
- [ ] Reimportar el mismo archivo: `crear.marcas = 0`, "Nada nuevo que crear", las mismas omitidas, y `select count(*) from marcas` no cambia después de aplicar.
- [ ] Importar un archivo **sin** la columna de tratamiento: Previsualizar se habilita con solo MARCA y AGRUPACION mapeadas; las marcas nuevas entran con `tratamiento_especial = false`.
- [ ] Eliminar una marca recién creada → funciona; `GET /api/marcas?agrupacion_id=<uuid de PREMIUM>` devuelve solo las de PREMIUM; con `agrupacion_id=abc` → `400`.
- [ ] Buscar `lev` en el buscador lista `LEVI'S` y `LEVIS`; el chip "Con tratamiento especial" deja solo las marcadas.

## Fuera de alcance

- **`equivalencia_marca` (qué marcas hay en qué equivalencias).** PLAN §4 la asignaba a M2, pero Javier no la pidió hoy y todavía no existe la lista de marcas. Propuesta: no mantenerla a mano. Cada fila de venta y stock de M5 trae marca y equivalencia, así que la relación (y las "5 principales por equivalencia" que necesita M7) se **deriva de la data real** con volumen de venta como criterio, en vez de pedirle a alguien que marque cientos de cruces. Si Javier quiere mantenerla a mano (por ejemplo, para marcas nuevas sin histórico), se abre **M2b** con la tabla `equivalencia_marca (equivalencia_id, marca_id, unique)`, una pestaña "Equivalencias" en la pantalla de marcas y el `409` al eliminar equivalencias con marcas. Pregunta abierta 1.
- Reasignación masiva de marcas entre agrupaciones (seleccionar varias y mover): se hace una a una o por importación.
- Que el importador actualice la agrupación o el tratamiento de marcas existentes (solo las reporta en `diferencias`). Pregunta abierta 4.
- Importar `nota_tratamiento` desde archivo.
- Catálogo de tipos de tratamiento especial; en M2 es una bandera y una nota libre. Pregunta abierta 6.
- Marcas sin agrupación o una agrupación comodín "SIN AGRUPAR": no existe, por el mismo criterio que "toda línea tiene mundo"; las filas sin agrupación se omiten y se reportan. Pregunta abierta 8.
- Qué hace la Fase 2 con `tratamiento_especial` (M8 lo define con `analista-planeamiento`).
- Venta y stock por marca (M5); las 5 marcas principales por equivalencia (M7).
- Auditoría de quién cambió qué (pendiente desde M0).
- Visibilidad de marcas para el comprador (hoy no ve el item; pregunta abierta 7).

## Decisiones nuevas propuestas

Para que el `documentador` las registre en `docs/DECISIONES.md` cuando Javier apruebe la ficha; ninguna contradice una entrada vigente, pero la primera cambia lo que PLAN §4 asignaba a M2:

1. **`equivalencia_marca` se deriva de la data, no se mantiene a mano (sale de M2).** Por qué: no hay lista de marcas, cada fila de venta trae marca y equivalencia, y M7 necesita las 5 principales *por volumen*, que una tabla manual no sabe. Descartado: construir la tabla vacía ahora "por si acaso" (misma razón por la que se eliminó `tallas`). Se reabre como M2b si Javier la quiere a mano.
2. **La nota de tratamiento exige la bandera.** `check` en la base más borrado automático al desmarcar. Descartado: conservar la nota con la bandera apagada (una nota que no se ve ni se usa).
3. **Triggers con `create or replace trigger`.** A partir de `0002` las migraciones no usan `drop trigger`; `0001` no se toca.
4. **Nombres de agrupación de marca en mayúsculas normalizadas**, como todo catálogo del árbol, aunque `agrupaciones_talla` se haya sembrado en caja mixta (ese catálogo es cerrado y nunca pasa por zod).

## Cambios respecto a la especificación

Lo que backend, frontend y QA construyeron distinto de lo escrito arriba, o que la especificación no decía. Nada de esto cambia el hito; los dos últimos puntos abren preguntas para Javier.

1. **`CatalogoPlano` vive en `src/components/catalogo/`, no en `src/components/maestros/`.** Junto a él va `vista-previa-nombre.tsx`. La carpeta se llama por lo que contiene (un catálogo plano reutilizable) y no por quién lo usa; `maestros` habría quedado ambiguo cuando M3 y M4 lo reutilicen. La prop `vigentes` es una función `(fila) => number` y no un `Map`: así cada pantalla decide de dónde sale el conteo (Catálogos lo calcula del árbol; Marcas lo lee de `marcas_activas` que ya trae la API) sin construir una estructura intermedia.
2. **Pestaña por defecto: Marcas.** La ficha listaba Agrupaciones primero y no fijaba cuál abría. El orden de las pestañas se mantiene (Agrupaciones · Marcas · Importar) pero el panel abre en Marcas: es la pestaña de trabajo diario; las agrupaciones son cinco y las edita solo el admin.
3. **La nota solo viaja en el `PATCH` si la marca tiene la bandera.** Al guardar una edición en línea, el cliente incluye `nota_tratamiento` únicamente cuando `tratamiento_especial` está encendido; con la bandera apagada, el campo de nota está deshabilitado y no se manda. Evita el `400` "Marca el tratamiento especial…" que el servidor devolvería por una nota vacía o residual, y deja la regla 6 como red de seguridad para llamadas a mano.
4. **`tipos.ts` y `tipos-api.ts` son estructuralmente iguales.** `src/lib/marcas/tipos.ts` tipa lo que el backend construye y `tipos-api.ts` lo que el frontend lee; describen el mismo JSON pero no se importan entre sí. Es a propósito: `tipos-api.ts` importa `ModoImportacion` de `src/components/importador/tipos`, y si `tipos.ts` lo re-exportara, la lógica pura de `lib` dependería de un componente. TypeScript comprueba la compatibilidad en cada handler que devuelve una cosa tipada como la otra.
5. **`motivoRechazoMarca` existe y está probada, pero los handlers no la llaman.** La regla 3 la preveía para dar el mensaje antes de escribir; en la práctica `POST` y `PATCH` confían en los índices únicos y `traducirErrorDb` convierte el `23505` en el `409` legible ("Ya existe una marca con ese nombre/código"). Leer todas las marcas en cada escritura solo para anticipar un conflicto no compensaba. La función queda disponible para el cliente o para una validación previa si hiciera falta.
6. **`leerSiNo` es estricta.** Normaliza caja y acentos pero no pasa por `aCodigo`: `-`, `?` o `n/a` no se reducen a cadena vacía (que valdría `NO`) sino que caen en `tratamiento_invalido` con el valor en `detalle`. Un guion en la columna de tratamiento suele ser "no sé", no "no".
7. **Columna de tratamiento no mapeada = `NO`, y eso aparece en `diferencias`.** Si el archivo no trae la columna, el cliente manda `""` y el importador lo lee como `false` (tal como decía la ficha). Consecuencia que la ficha no mencionaba: las marcas **ya existentes** con bandera encendida salen en "Diferencias con lo ya cargado" con `en_base: SI · en_archivo: NO`, aunque el archivo no opine sobre el tratamiento. Es informativo (el importador no modifica nada), pero puede confundir. Pregunta abierta 9.
8. **El resumen de la pantalla cuenta solo activas.** `N agrupaciones · N marcas · N con tratamiento especial` se calcula sobre `activo = true`, con o sin "Mostrar inactivos". La ficha no decía qué contar. Pregunta abierta 10.
9. **La comprobación "agrupación activa" y la escritura no son atómicas.** `POST /api/marcas` y `PATCH` con `agrupacion_marca_id` leen la agrupación, aplican `motivoRechazoAgrupacionDestino` y luego escriben, sin transacción (supabase-js no las expone). Si entre las dos lecturas alguien desactiva la agrupación, la marca se crea igual y queda como "Oculta por agrupación inactiva", que es un estado válido y visible. Es la misma ventana que tiene M1 al crear nodos bajo un mundo; se documenta para que nadie la tome por error.
10. **Lo compartido que M1 absorbió sin cambiar de comportamiento.** `src/lib/api/catalogo.ts` pasa de `columnaHijos` + `conConteoNodos` a `hijos: { tabla, columna, clave, claveActivos? }` + `conConteoHijos`, y gracias a `claveActivos` el listado de agrupaciones trae `marcas_activas` sin una lectura aparte (la ficha preveía calcularlo en el handler). `errores-db.ts` distingue el sentido de la FK `marcas_agrupacion_marca_id_fkey` por el texto de Postgres: `insert or update` (crear o mover a una agrupación inexistente) → `404 "Agrupación de marca no encontrada."`; `update or delete` (borrar agrupación con marcas) → `409`. El importador del árbol (`importar-csv.tsx`) y `catalogos-panel.tsx` se reescribieron sobre `src/components/importador/*` (tipos, mapeo, hook `useImportador`, pasos y reporte), `src/components/catalogo/*` y `src/lib/formato.ts`; los 131 tests de M1 siguen en verde y el hito de M1 no cambia.

## Preguntas abiertas para Javier

1. **Marca ↔ Equivalencia.** PLAN §4 preveía una tabla `equivalencia_marca` en M2. Propongo no mantenerla a mano y derivar de la venta y el stock (M5) qué marcas hay en cada equivalencia y cuáles son las 5 principales. ¿Te sirve así, o necesitas asignar marcas a equivalencias a mano (por ejemplo, para marcas nuevas sin histórico)? Si es lo segundo, se abre M2b.
2. **Quién edita las agrupaciones.** Especificado como admin (es un catálogo raíz, como géneros y mundos). Como dijiste que los nombres todavía no son oficiales, ¿prefieres que también las edite el planner mientras se definen? Es cambiar una línea de configuración.
3. **Formato de la lista de marcas.** ¿Qué columnas trae y cómo viene la agrupación: por número (`1`…`5`), por nombre (`Ultra Low`) o como `1 Ultra Low`? El importador acepta las tres formas, pero quiero confirmar que no viene de otra manera (por ejemplo, una columna por agrupación con una X).
4. **Marcas que ya existen con otra agrupación.** Si vuelves a cargar el archivo con cambios, el importador **no** modifica las marcas que ya están (solo te muestra las diferencias). ¿Está bien, o quieres una opción "actualizar agrupación y tratamiento de las existentes"?
5. **Nombres en mayúsculas.** Las marcas se guardarán normalizadas (`LEVI'S`, `H&M`), como todo el árbol, y así se cruzarán con la venta y el stock de la Fase 2. ¿Los archivos de venta traen la marca con el mismo nombre que tu lista (y no un código)?
6. **Qué es "tratamiento especial".** Hoy es una bandera y una nota de hasta 200 caracteres. ¿Hay más de un tipo de tratamiento (por ejemplo, "flujo propio", "sin proyección", "compra directa")? Si sí, conviene saberlo ahora para que sea un catálogo y no texto libre.
7. **Comprador.** Hoy no ve marcas ni agrupaciones. ¿Se las mostramos en solo lectura como el árbol?
8. **Marcas sin agrupación.** Toda marca exige agrupación; una fila sin ella se omite y se lista para corregir el archivo. ¿Puede haber marcas que de verdad no tengan agrupación todavía? Si sí, ¿qué prefieres: corregir el archivo (como con las líneas sin mundo) o una agrupación provisional que tú crees desde la pantalla?
9. **Archivo sin columna de tratamiento.** Hoy, si el archivo no trae la columna, se toma como "NO" para todas, y las marcas que ya tienen la bandera aparecen en "Diferencias con lo ya cargado" (en la base SI, en el archivo NO). ¿Prefieres que "sin columna" signifique "sin dato" y esas diferencias no se muestren? Es un cambio pequeño en el importador.
10. **Resumen de la pantalla.** Arriba de las pestañas se cuentan solo agrupaciones y marcas activas. ¿Quieres ver también el total (incluidas las desactivadas), por ejemplo "120 marcas (3 inactivas)"?

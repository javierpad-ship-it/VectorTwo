# M3 · Agrupaciones de estacionalidad

> Estado: **en especificación** (pendiente de aprobación de Javier). Módulo anterior: [01-arbol-producto](01-arbol-producto.md) (M2, [02-marcas](02-marcas.md), se construye en paralelo y no es prerrequisito: M3 solo depende de M1). Reglas de base en `docs/PLAN.md` §4 y `docs/DECISIONES.md`. Lo que se construya distinto de lo especificado irá en "Cambios respecto a la especificación", al final.

## Objetivo

En la Fase 2 cada curva de estacionalidad (M6) se calcula por **agrupación de estacionalidad**, no por equivalencia: muchas de las 1 956 equivalencias del árbol real venden poco y una curva propia sería ruido. M3 construye el catálogo de agrupaciones (nombres del negocio, mantenidos por el planner) y la asignación de **cada equivalencia a una agrupación**, con un reporte de faltantes que diga qué equivalencias activas y vigentes todavía no tienen curva: **una equivalencia sin agrupación no se puede proyectar** en M7. Las curvas en sí (cálculo a partir de la venta histórica) son M6 y quedan fuera.

Relación con lo que viene: M5 cargará venta y stock al grano del árbol; M6 agregará esa venta por agrupación de estacionalidad y calculará una curva mensual por agrupación (o por agrupación × tienda, pregunta abierta); M7 aplicará a cada equivalencia la curva de su agrupación. Por eso el hito de M3 es "toda equivalencia activa tiene agrupación" (PLAN §5), y la pantalla gira alrededor de cerrar esa lista.

## Modelo de datos

Migración `supabase/migrations/0003_agrupaciones_estacionalidad.sql`, idempotente, sin bloques `do $$`. Mismas convenciones que M1: `id uuid primary key default gen_random_uuid()`, `activo boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` con `public.tg_set_updated_at()` creado con **`create or replace trigger`** (sin `drop trigger`: la migración se aplica por `execute_sql` y la convención vigente es no borrar nada, ni siquiera triggers), `enable row level security` sin políticas.

### `agrupaciones_estacionalidad`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | `check (length between 1 and 40)`; único (`unique index on upper(codigo)`) |
| `nombre` | `text not null` | `check (length between 1 and 120)`; único (`unique index on nombre`). Se guarda normalizado (`normalizarNombre`: NFC, trim, mayúsculas en español), igual que todo nombre del árbol |
| `descripcion` | `text null` | `check (length(descripcion) <= 500)`. Texto libre: para qué sirve la curva ("Líneas de invierno con pico en mayo-junio"). No se normaliza a mayúsculas; sí `trim`, y vacío se guarda como `null` |
| `orden` | `integer not null default 0` | Posición en las listas y en los `Select` de asignación |

Mismo patrón que `generos` y `mundos`: es un catálogo plano que se muestra como lista fija. `codigo` se deriva del nombre con `aCodigo` y es editable al crear (decisión "Códigos ASCII derivados del nombre"); lo usará M6 para nombrar las curvas en exportaciones.

**Sin seed.** Los nombres de las agrupaciones son del negocio (Javier los tiene o los va a definir con su equipo) y no hay ninguna agrupación que el sistema necesite para funcionar. Se consideró una agrupación `GENERAL` por defecto y se descarta: una agrupación inventada por nosotros termina siendo el cajón donde cae todo, y eso esconde exactamente la señal que M3 quiere dar (el reporte de faltantes). Si Javier quiere una agrupación comodín, la crea desde la pantalla en diez segundos y es una decisión suya, no del seed.

### `equivalencias` (columna nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `agrupacion_estacionalidad_id` | `uuid null references agrupaciones_estacionalidad(id) on delete restrict` | `alter table … add column if not exists`. Nullable: una equivalencia nace sin agrupación y el reporte de faltantes la persigue |

Índice `equivalencias_agrupacion_estacionalidad_id_idx on (agrupacion_estacionalidad_id)`: responde "¿qué equivalencias tiene esta agrupación?" (conteo por fila del catálogo, vista inversa de la pantalla y, en M6, la agregación de venta por agrupación). No hay índice parcial sobre `null`: el reporte de faltantes se calcula en memoria sobre el estado completo del árbol porque necesita la vigencia del nodo, que no está en la tabla.

Por qué una FK en `equivalencias` y no una tabla de relación: cada equivalencia tiene **exactamente una** curva (o ninguna). Una tabla aparte permitiría dos curvas por equivalencia, que es justo lo que no queremos, y obligaría a un índice único que diría lo mismo que esta columna.

`on delete restrict` sigue la regla de M1: una agrupación con equivalencias no se elimina, se desactiva (y el handler traduce el `23503` a un `409` con el conteo). Desactivarla **no** toca las equivalencias (sin cascada, igual que en el árbol): conservan el id, se reportan como faltantes por "agrupación inactiva" y, al reactivarla, vuelven a estar completas sin reasignar nada.

### La genérica `SIN EQUIVALENCIA`

Propuesta: **lleva agrupación como cualquier otra equivalencia**. Su venta existe (las filas sin equivalencia del archivo de ventas caerán ahí en M5) y, si no tiene curva, M7 no podrá proyectarla. La decisión "Equivalencia genérica por nodo" dejó abierto que M3 pudiera "no exigirle curva"; esta ficha propone exigírsela y lo deja como pregunta abierta 2. Si Javier prefiere excluirla, es un cambio en `esFaltante` (regla 7) y un chip menos en la pantalla, sin tocar el modelo.

### Diagrama

```
agrupaciones_estacionalidad ◄──(agrupacion_estacionalidad_id, null)── equivalencias ──► genero_mundo_linea
         │
         └── M6: una curva mensual por agrupación (o por agrupación × tienda)
```

## Contratos de API

Mismas convenciones de M1: `{ data }` con `ok()` y `{ error }` con `error()` (`src/lib/api/respuestas.ts`); cuerpos con `leerCuerpo` y esquemas zod en `src/lib/estacionalidad/esquemas.ts` (reutilizan `nombre`, `codigo` y `uuid` de `src/lib/arbol/esquemas.ts`); `idDeRuta` en todo `[id]`; `traducirErrorDb`; lecturas paginadas con `leerTodo`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio o unicidad/FK · `500` error de base no previsto.

Guards: **lectura `requireUser`, escritura `requirePlanner`**. La estacionalidad es trabajo del planner (como las líneas y las equivalencias), no un catálogo raíz como géneros y mundos.

### Catálogo `agrupaciones-estacionalidad`

Reutiliza el CRUD de `src/lib/api/catalogo.ts` con una configuración nueva en `src/lib/estacionalidad/catalogos.ts`. Para eso el helper se generaliza en dos puntos pequeños, sin cambiar el comportamiento de M1:

- `TablaCatalogo` incorpora `"agrupaciones_estacionalidad"`.
- `columnaHijos` + `conConteoNodos` se generalizan a `hijos?: { tabla: "genero_mundo_linea" | "equivalencias"; columna: string; clave: "nodos" | "equivalencias" }`: el helper cuenta en `tabla` por `columna` y anexa el conteo a cada fila bajo `clave`. Los catálogos de M1 pasan a `hijos: { tabla: "genero_mundo_linea", columna: "genero_id", clave: "nodos" }` y siguen devolviendo `nodos`.
- `TipoEliminable` (en `src/lib/arbol/reglas.ts`) suma `"agrupacion_estacionalidad"` con etiqueta `{ sujeto: "la agrupación de estacionalidad", uno: "equivalencia", varios: "equivalencias", desactivar: "Desactívala" }`.
- `MENSAJES_UNICO` (en `src/lib/api/errores-db.ts`) suma `agrupaciones_estacionalidad_codigo` → "Ya existe una agrupación de estacionalidad con ese código." y `agrupaciones_estacionalidad_nombre` → "Ya existe una agrupación de estacionalidad con ese nombre."; `MENSAJES_CHECK` suma `agrupaciones_estacionalidad_descripcion` → "La descripción no puede superar 500 caracteres."

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/agrupaciones-estacionalidad` | GET | `requireUser` | — | `agrupaciones[]` por `orden, nombre`, cada fila con `equivalencias: number` (conteo de equivalencias asignadas, activas o no). `?incluir_inactivos=1` |
| `/api/agrupaciones-estacionalidad` | POST | `requirePlanner` | `crearAgrupacionSchema` | fila creada, `201`. `409` nombre o código repetido |
| `/api/agrupaciones-estacionalidad/[id]` | PATCH | `requirePlanner` | `editarAgrupacionSchema` | fila actualizada. `404` · `409` repetido |
| `/api/agrupaciones-estacionalidad/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` "No se puede eliminar la agrupación de estacionalidad: tiene N equivalencias. Desactívala." |

```ts
// pseudocódigo zod — src/lib/estacionalidad/esquemas.ts
const descripcion = z.string().max(500).transform((v) => (v.trim() === "" ? null : v.trim())).nullable();

crearAgrupacionSchema  = z.object({ nombre, codigo: codigoOpcional, descripcion: descripcion.optional(), orden: orden.optional() })
   // si falta codigo → aCodigo(nombre), igual que crearCatalogoSchema
editarAgrupacionSchema = z.object({ nombre, codigo, descripcion, orden, activo }).partial().refine(noVacio);
```

Desactivar una agrupación con equivalencias está permitido (es la acción normal, como en el árbol); la pantalla avisa cuántas equivalencias pasarán a faltantes.

### Equivalencias: asignación individual

`PATCH /api/equivalencias/[id]` (`requirePlanner`, ya existe) acepta un campo más:

```ts
editarEquivalenciaSchema = z.object({ nombre, codigo, activo, agrupacion_estacionalidad_id: uuid.nullable() })
   .partial().refine(noVacio).refine(/* "-" solo al crear, como hoy */);
```

- `null` quita la agrupación. Sobre la **genérica** sí se admite (la regla "la genérica no se renombra" sigue aplicando solo a `nombre` y `codigo`).
- El handler, si el cuerpo trae un id no nulo, lee la agrupación: no existe → `404 "Agrupación de estacionalidad no encontrada."`; existe pero `activo = false` → `409 "La agrupación X está inactiva: reactívala o elige otra."` (función pura `motivoRechazoAsignacion`, regla 4). Se comprueba antes del `update` para que la violación de FK nunca llegue a `traducirErrorDb`, cuyo mensaje para `23503` habla de eliminar.
- Respuesta: la fila completa de `equivalencias` (ahora con `agrupacion_estacionalidad_id`). `EquivalenciaFila` en `tipos.ts` suma el campo.

### Asignación masiva

`POST /api/estacionalidad/asignar` · `requirePlanner`.

```ts
asignarSchema = z.object({
  agrupacion_id: uuid.nullable(),                       // null = quitar la agrupación a todas
  equivalencia_ids: z.array(uuid).min(1).max(2_000),    // el árbol real tiene 1 956; una selección nunca pasa de ahí
});
```

1. Si `agrupacion_id` no es nulo: `404` si no existe, `409` si está inactiva (misma regla 4 que el PATCH).
2. Se deduplican los ids. Se consultan las equivalencias por `in("id", …)` en tandas de 500 (`enTandas` de `src/lib/arbol/importar.ts`); los ids que no existan se devuelven en `no_encontradas` y **no** abortan la operación (una pantalla con datos viejos no debe perder el trabajo de selección por una equivalencia que alguien eliminó).
3. `update equivalencias set agrupacion_estacionalidad_id = $1 where id in (…)` en tandas de 500. Se asigna también a equivalencias inactivas si el cliente las manda: la asignación es un atributo de la equivalencia, no una escritura bajo un padre apagado, y así una equivalencia reactivada ya tiene curva.
4. Respuesta `200`: `{ "data": { "asignadas": 37, "sin_cambio": 3, "no_encontradas": ["…"] } }` (`sin_cambio` = ya tenían esa agrupación).

Sin transacción (supabase-js no las expone): si una tanda falla, la respuesta es `500` y repetir la misma asignación completa el resto sin efectos secundarios (la operación es idempotente).

### Lista plana y faltantes

Dos lecturas que comparten una sola función pura, `aplanarEquivalencias(estado, agrupaciones)` en `src/lib/estacionalidad/aplanar.ts`, alimentada por `cargarEstadoArbol` (ya existe) más la lectura de `agrupaciones_estacionalidad`.

| Ruta | Método | Guard | Respuesta |
|---|---|---|---|
| `/api/estacionalidad/equivalencias` | GET | `requireUser` | todas las equivalencias **activas y vigentes** con su ruta y su agrupación; `?incluir_inactivos=1` devuelve también inactivas y no vigentes con sus banderas |
| `/api/estacionalidad/faltantes` | GET | `requireUser` | solo las filas con `faltante: true` (regla 7); mismo formato |

```jsonc
{ "data": {
  "equivalencias": [
    { "id": "…", "codigo": "JOGGER", "nombre": "JOGGER", "es_generica": false, "activo": true,
      "nodo_id": "…", "genero_id": "…", "mundo_id": "…", "linea_id": "…", "vigente": true,
      "ruta": "HOMBRE / URBANO / PANTALON",
      "agrupacion": { "id": "…", "codigo": "PANTALONES_INVIERNO", "nombre": "PANTALONES INVIERNO", "activo": true },   // o null
      "faltante": false, "motivo_faltante": null }                 // "sin_agrupacion" | "agrupacion_inactiva" | null
  ],
  "generos": [ { "id": "…", "codigo": "H", "nombre": "HOMBRE", "orden": 10, "activo": true } ],
  "mundos":  [ /* idem */ ],
  "lineas":  [ { "id": "…", "codigo": "PANTALON", "nombre": "PANTALON", "temporada": "Todo el año", "activo": true } ],
  "agrupaciones": [ { "id": "…", "codigo": "…", "nombre": "…", "orden": 10, "activo": true } ],
  "resumen": { "equivalencias": 1956, "con_agrupacion": 0, "faltantes": 1956,
               "faltantes_genericas": 265, "faltantes_por_agrupacion_inactiva": 0 }
} }
```

Las filas llevan ids de género, mundo y línea más la `ruta` ya armada; los catálogos viajan una vez en el mismo cuerpo para que la pantalla arme filtros y `Select` sin más llamadas. Con el árbol real son 1 956 filas, del orden de 300 KB sin comprimir: aceptable para una pantalla de maestro, como el árbol. Orden: por ruta (género `orden`, mundo `orden`, línea `nombre`) y dentro del nodo `ordenarEquivalencias` (reales por nombre, genérica al final). `resumen` cuenta lo devuelto.

### Árbol

`GET /api/arbol` (`requireUser`, ya existe) suma a cada equivalencia su agrupación. `armarArbol` recibe un sexto parámetro `agrupaciones` y `EquivalenciaArbol` queda:

```ts
{ id, codigo, nombre, es_generica, activo,
  agrupacion_estacionalidad: { id: string; nombre: string; activo: boolean } | null }
```

`resumen` suma `equivalencias_sin_agrupacion` (entre las devueltas, las que cumplen la regla 7). El handler lee `agrupaciones_estacionalidad` completa (activas e inactivas: una equivalencia puede apuntar a una inactiva y el árbol debe poder mostrarlo).

### Importador de asignaciones

`POST /api/estacionalidad/importar` · `requirePlanner`.

```ts
filaImportacionEstacionalidadSchema = z.object({
  genero: z.string(), mundo: z.string(), linea: z.string(), equivalencia: z.string(), agrupacion: z.string()
});
importarEstacionalidadSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"]),
  filas: z.array(filaImportacionEstacionalidadSchema).min(1).max(10_000),
});
```

El cliente lee el archivo con `leerArchivoTabular` (`src/lib/arbol/leer-archivo.ts`: CSV con papaparse, Excel con SheetJS bajo demanda y selector de hoja) y confirma el mapeo de las cinco columnas (autodetección por `aCodigo` del encabezado: las cuatro del árbol con los mismos alias que M1, más `AGRUPACION`, `AGRUPACION_ESTACIONALIDAD`, `ESTACIONALIDAD`, `CURVA`).

Algoritmo (función pura `planificarImportacionEstacionalidad(filas, estado)` en `src/lib/estacionalidad/importar.ts`, donde `estado` es `EstadoArbol` más `agrupaciones`), igual en los dos modos hasta el último paso:

1. Normalizar los cinco campos con `normalizarNombre`. `linea` vacía → `linea_vacia`; `genero = TOTAL` → `fila_total`; `agrupacion` vacía → `agrupacion_vacia`.
2. Resolver **género** y **mundo** exactamente como el importador del árbol (`resolverCatalogo` / `buscarEnCatalogo`): `genero_desconocido`, `genero_inactivo`, `mundo_vacio`, `mundo_desconocido`, `mundo_inactivo`.
3. Resolver la **línea** por nombre: no existe → `linea_desconocida` (`detalle` = el nombre). Resolver el **nodo** por tripleta: no existe → `nodo_desconocido` (`detalle` = `GÉNERO / MUNDO / LÍNEA`). Nodo no vigente (él o su línea inactivos; género y mundo ya se filtraron) → `nodo_inactivo`.
4. Resolver la **equivalencia** con la misma regla que el árbol y que M5 (`esEquivalenciaGenerica`, `esEquivalenciaIgualALinea`): vacío → la genérica del nodo; `-` → la real que se llama como la línea; otro valor → por `(nodo, nombre)`. No existe → `equivalencia_desconocida` (`detalle` = el nombre resuelto; para la genérica, `SIN EQUIVALENCIA`). Existe pero inactiva → `equivalencia_inactiva`. **Este importador nunca crea líneas, nodos ni equivalencias**: para eso está el del árbol; una fila que no case con el árbol es un error del archivo y se reporta con la fila completa.
5. Resolver la **agrupación** por `aCodigo(valor) = codigo` o por nombre, igual que un catálogo: existe y activa → se usa; existe inactiva → `agrupacion_inactiva`; no existe → se **crea** (`crear.agrupaciones`, con `codigo = codigoUnico(aCodigo(nombre))`, `orden = 0`, sin descripción) y se reutiliza para el resto del archivo. Decisión: el importador **sí crea agrupaciones** porque el objetivo del archivo es cargar de una vez la lista de Javier, las agrupaciones no son catálogo raíz (las crea el planner desde la pantalla, a diferencia de géneros y mundos, que son de admin), y la previsualización lista las que va a crear con su conteo de equivalencias para que un error de tipeo ("PANTALON INVIERNO" vs "PANTALONES INVIERNO") se vea antes de aplicar.
6. Duplicados dentro del archivo: misma equivalencia resuelta dos veces con la **misma** agrupación → `duplicada_en_archivo` (`fila_original`, informativa); con **distinta** agrupación → `contradictoria_en_archivo` (`fila_original`, `detalle` = la agrupación de la primera; es un error que hay que corregir). En ambos casos gana la primera aparición.
7. Comparar con la asignación actual: sin agrupación → `asignar.nuevas`; con otra agrupación → `asignar.reasignadas` (y se anota en `reasignaciones[]` con `de` y `a`, para que la previsualización lo muestre); con la misma → `asignar.sin_cambio`. **El archivo manda**: reasigna sin preguntar fila por fila, pero la previsualización lo deja claro y el `confirm` de Aplicar repite cuántas cambian. Nunca quita una agrupación (para eso está la pantalla): una equivalencia que no aparece en el archivo no se toca.
8. `previsualizar`: reporte sin escribir. `aplicar`: inserta las agrupaciones nuevas con `on conflict do nothing`, las relee para obtener ids, y agrupa las equivalencias por agrupación destino para hacer un `update … where id in (…)` por agrupación en tandas de 500. Sin transacción; reimportar completa lo que faltó sin duplicar ni cambiar nada más (idempotencia, regla 12).

Reporte (igual en ambos modos; en `aplicar`, los conteos son lo realmente escrito):

```jsonc
{ "data": {
  "modo": "previsualizar",
  "totales": { "recibidas": 1960, "procesadas": 1940, "omitidas": 20 },
  "crear": { "agrupaciones": 12 },
  "asignar": { "nuevas": 1935, "reasignadas": 5, "sin_cambio": 0 },
  "omitidas": [
    { "fila": 14, "motivo": "equivalencia_desconocida", "detalle": "JOGER", "genero": "HOMBRE", "mundo": "URBANO", "linea": "PANTALON", "equivalencia": "JOGER", "agrupacion": "PANTALONES INVIERNO" },
    { "fila": 90, "motivo": "contradictoria_en_archivo", "fila_original": 12, "detalle": "PANTALONES INVIERNO", "genero": "HOMBRE", "mundo": "URBANO", "linea": "PANTALON", "equivalencia": "JOGGER", "agrupacion": "PANTALONES VERANO" }
  ],
  "reasignaciones": [ { "ruta": "HOMBRE / URBANO / PANTALON", "equivalencia": "JOGGER", "de": "GENERAL", "a": "PANTALONES INVIERNO" } ],   // hasta 500; el total está en asignar.reasignadas
  "muestra": { "agrupaciones": [ { "nombre": "PANTALONES INVIERNO", "codigo": "PANTALONES_INVIERNO", "equivalencias": 140 } ] }   // todas las que se crearán, con cuántas filas del archivo apuntan a cada una
} }
```

Motivos (`MotivoOmisionEstacionalidad` en `src/lib/estacionalidad/tipos.ts`): los ocho de M1 (`linea_vacia`, `fila_total`, `genero_desconocido`, `genero_inactivo`, `mundo_vacio`, `mundo_desconocido`, `mundo_inactivo`, `duplicada_en_archivo`) más `linea_desconocida`, `nodo_desconocido`, `nodo_inactivo`, `equivalencia_desconocida`, `equivalencia_inactiva`, `agrupacion_vacia`, `agrupacion_inactiva`, `contradictoria_en_archivo`. Etiquetas en `ETIQUETA_MOTIVO_OMISION_ESTACIONALIDAD` (`tipos-api.ts`). Como en M1, `duplicada_en_archivo` es informativa y el resto son errores.

Por qué el importador omite lo inactivo pero `asignar` no: el importador es una carga masiva que sigue la regla de M1 ("nunca escribe bajo algo apagado, lo reporta"); la asignación desde pantalla es una acción explícita sobre filas que el usuario ve, con sus badges de inactiva.

## Pantallas

Ruta nueva `/maestros/estacionalidad`. En `src/lib/nav.ts` se quita `pendiente: "M3"` y el label pasa a **"Agrupaciones de estacionalidad"** (si no cabe en el sidebar, "Estacionalidad"); sigue con `roles: PLANIFICACION`, así que el comprador no la ve en el menú ni puede entrar por URL (`puedeVerRuta`). `page.tsx` servidor: `perfilActual()`; si no es `ok` o el rol es comprador → `redirect("/")`, igual que Catálogos. La API de lectura sigue siendo `requireUser` por si en Fase 3 se abre.

Panel cliente `estacionalidad-panel.tsx` con `Tabs`: **Agrupaciones · Asignación · Faltantes · Importar**. Encima, el resumen de `GET /api/estacionalidad/equivalencias`: `1 956 equivalencias · 0 con agrupación · 1 956 faltantes (265 genéricas)`, con el conteo de faltantes también en el label de la pestaña ("Faltantes (1 956)"). Todas las pestañas comparten el hook `useColeccion` para el catálogo y un `useEstacionalidad()` (mismo patrón que `useArbol`) para la lista plana; cualquier escritura recarga ambos.

### Pestaña Agrupaciones

Mismo patrón que Géneros en Catálogos (`CatalogoPlano`): formulario de alta arriba (`Card`: nombre, código propuesto editable, descripción, orden; `VistaPreviaNombre`) y `DataTable` abajo.

| Columna | Contenido |
|---|---|
| Orden | número; editable en línea |
| Código | `code`; editable |
| Nombre | editable |
| Descripción | texto; editable (`Input`, hasta 500) |
| Equivalencias | `N equivalencias` como enlace que abre la pestaña Asignación con la vista inversa filtrada por esa agrupación |
| Estado | `Badge` Activa / Desactivada |
| Acciones (planner y admin) | Editar · Desactivar / Reactivar · Eliminar (deshabilitado si `equivalencias > 0`, con `title` "Tiene equivalencias: desactívala en vez de eliminarla.") |

`confirm` al desactivar con equivalencias: "¿Desactivar la agrupación X? Sus N equivalencias quedarán como faltantes hasta que la reactives o las reasignes." Al eliminar: el `confirm` habitual. Errores `409` de la API con `Alert` tal cual llegan. Pie: "Desactivar conserva las asignaciones; eliminar solo es posible sin equivalencias."

### Pestaña Asignación

Para asignar en bloque. Dos vistas, elegidas con un par de `Chips`: **Por árbol** y **Por agrupación**.

**Por árbol.**

- Filtros en una fila: `Select` Género (todos + los 8), `Select` Mundo (todos + los 5), `Select` Línea (todas + las que existan en el género-mundo elegido, por nombre), `Input` de texto (busca en nombre y código de equivalencia y en la ruta), `Chips` de estado: Todas (N) · Sin agrupación (N) · Con agrupación (N), y el interruptor `Switch` "Mostrar inactivas" (recarga con `incluir_inactivos=1`; las inactivas y no vigentes salen atenuadas con badge "Inactiva" / "Oculta por {padre} inactivo").
- `DataTable` con `checkbox` por fila y en la cabecera ("seleccionar las N filtradas"), columnas: Ruta (género / mundo / línea), Equivalencia (nombre + badge "Genérica"), Código, Agrupación actual (`Badge` tono marca con el nombre; "Sin agrupación" en tono alerta; "X (inactiva)" en tono alerta si la agrupación está inactiva), Estado.
- Barra de acción fija sobre la tabla cuando hay selección: "N seleccionadas · Asignar a [Select agrupaciones activas por orden] [Asignar] · [Quitar agrupación]". `confirm`: "¿Asignar N equivalencias a X? M de ellas ya tienen otra agrupación y cambiarán." Llama a `POST /api/estacionalidad/asignar`, muestra `Alert` de éxito con `asignadas`/`sin_cambio` y, si `no_encontradas` no está vacío, un aviso de que la lista estaba desactualizada y se recargó.
- Con 1 956 filas la tabla se pinta completa (sin paginación): el filtrado es en memoria y es lo que el planner necesita para seleccionar "todo PANTALON de HOMBRE" de una vez. Si en el uso real se nota lento, se pagina en cliente de a 200.

**Por agrupación.**

- `Select` de agrupaciones (activas e inactivas, con su conteo) y la misma tabla con las equivalencias de la elegida; sin filtro de estado (todas tienen esa agrupación), con los mismos filtros de género/mundo/línea/texto.
- Acciones en bloque: "Mover a [Select]" y "Quitar agrupación", con los mismos `confirm`.
- Vacío: "Esta agrupación no tiene equivalencias. Asígnale algunas desde la vista Por árbol."

Comprador: no llega a esta pantalla (menú y redirect). Si en Fase 3 se abre, las tablas se muestran sin `checkbox` ni barra de acción.

### Pestaña Faltantes

La misma tabla de "Por árbol", pero alimentada por `GET /api/estacionalidad/faltantes` y con:

- `Chips` de motivo: Todas (N) · Sin agrupación (N) · Agrupación inactiva (N); y otro grupo: Reales (N) · Genéricas (N). Los mismos filtros de género, mundo, línea y texto.
- Resumen por género encima de la tabla ("HOMBRE 410 · MUJER 520 · …") como chips que filtran.
- La misma barra de asignación en bloque: el flujo esperado es "filtrar género + línea → seleccionar todo → asignar a X" hasta que la pestaña quede vacía.
- Botón **Descargar faltantes (CSV)**: genera en el navegador, con BOM, un archivo con las columnas `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION` (esta última vacía; la equivalencia genérica sale como celda vacía y la que se llama como la línea sale con su nombre literal). Es exactamente el formato del importador: Javier lo completa en Excel y lo sube en la pestaña Importar.
- `EmptyState` cuando no hay faltantes: "Toda equivalencia activa tiene agrupación. Listo para M6." Ese es el hito.

### Pestaña Importar

Mismo flujo y mismos componentes que Importar CSV del árbol (`importar-csv.tsx` se generaliza o se duplica con el campo extra; decisión del frontend, pero la pantalla se ve igual):

1. Selector de archivo `.csv` / `.xlsx` / `.xls` (selector de hoja si hay varias). Mapeo de las **cinco** columnas, autodetectado y editable; las cinco son obligatorias.
2. **Previsualizar**: tarjetas `Agrupaciones a crear` (con la lista completa de `muestra.agrupaciones` y su conteo, para detectar tipeos) · `Asignaciones nuevas` · `Cambian de agrupación` (con la tabla de `reasignaciones`: ruta, equivalencia, de → a) · `Sin cambio` · `Omitidas` (desglosada en "Con errores" y "Repetidas en el archivo").
3. **Revisión previa de lo omitido**, igual que en M1: bloque "Filas con errores" con la fila completa (ahora con la columna Agrupación), `Chips` por motivo con conteo, aviso en rojo de que no se cargarán, "Descargar omitidas (CSV)"; bloque "Repetidas en el archivo" informativo.
4. **Aplicar** solo tras previsualizar el mismo archivo; `confirm`: "Se crearán N agrupaciones, se asignarán N equivalencias y N cambiarán de agrupación. Quedarán fuera N filas con errores." Reporte final y botón "Ver faltantes" que salta a la pestaña con la lista recargada.
5. Reimportar el mismo archivo: `crear` y `asignar.nuevas` en cero, todo en `sin_cambio`; la pantalla dice "Nada que cambiar".

### Árbol (`/maestros/arbol`, columna Equivalencias)

En `columna-equivalencias.tsx`, columna nueva **Agrupación** entre Código y Estado:

- Comprador (y cualquier fila en modo edición de nombre): `Badge` con el nombre de la agrupación (tono marca), "Sin agrupación" (alerta) o "X · inactiva" (alerta).
- Planner y admin: `Select` en línea (mismo patrón que la temporada de las líneas en Catálogos) con "— Sin agrupación —" y las agrupaciones activas por `orden, nombre`; si la equivalencia apunta a una inactiva, esa opción aparece marcada como "(inactiva)" y deshabilitada para elegirla de nuevo. El cambio se guarda al instante con `PATCH /api/equivalencias/[id]` y recarga el árbol. Errores `404`/`409` con el `Alert` de la columna.
- `arbol-panel.tsx` carga `/api/agrupaciones-estacionalidad` una vez con `useColeccion` y se lo pasa a la columna; si la carga falla, la columna muestra solo el badge y un aviso.
- En la columna Líneas, junto al conteo de equivalencias, un contador "N sin agrupación" (de `equivalencias[].agrupacion_estacionalidad == null` entre las activas) para que el planner vea desde el árbol qué nodos le faltan. En el resumen de arriba, `· 1 956 sin agrupación` tomado de `resumen.equivalencias_sin_agrupacion`, enlazado a la pestaña Faltantes.

La página de inicio (`/`) actualiza el estado de M3 a "disponible" con enlace, como hizo M1.

## Reglas de negocio

Funciones puras en `src/lib/estacionalidad/`, probadas en `tests/estacionalidad.*.test.ts`. Las de M1 que se reutilizan no se duplican.

**`esquemas.ts`**

1. `crearAgrupacionSchema`: `nombre` pasa por `normalizarNombre` (`" pantalones  invierno "` → `PANTALONES INVIERNO`), `codigo` ausente o vacío → `aCodigo(nombre)` (`PANTALONES_INVIERNO`), `descripcion` se recorta y vacía → `null`, más de 500 caracteres → rechazo; `orden` entero ≥ 0 opcional.
2. `editarAgrupacionSchema`: cuerpo vacío → rechazo ("No hay nada que actualizar."); `descripcion: null` válido; `activo` booleano.
3. `editarEquivalenciaSchema` acepta `agrupacion_estacionalidad_id` como UUID o `null`; un valor que no es UUID → rechazo; `{ agrupacion_estacionalidad_id: null }` solo es un cuerpo válido.

**`reglas.ts`**

4. `motivoRechazoAsignacion(agrupacion: { nombre, activo } | undefined, destinoNulo: boolean)`: destino nulo → `null` (permitido); `undefined` → "Agrupación de estacionalidad no encontrada." (el handler responde `404`); `activo = false` → "La agrupación X está inactiva: reactívala o elige otra." (`409`); activa → `null`.
5. `motivoRechazoEliminar("agrupacion_estacionalidad", 3)` → "No se puede eliminar la agrupación de estacionalidad: tiene 3 equivalencias. Desactívala."; con `0` → `null`.
6. Desactivar una agrupación nunca se rechaza por tener equivalencias (test explícito: `motivoRechazoDesactivarAgrupacion` no existe; se documenta para que nadie lo agregue sin cambiar esta regla).

**`aplanar.ts` — `aplanarEquivalencias(estado, agrupaciones, { incluirInactivos })`**

7. `esFaltante(e)` ⇔ `e.activo ∧ nodoVigente(nodo, genero, mundo, linea) ∧ (e.agrupacion == null ∨ e.agrupacion.activo == false)`. `motivo_faltante` es `sin_agrupacion` o `agrupacion_inactiva`; en las no faltantes es `null`. Una **genérica** cuenta igual que una real. Una equivalencia inactiva o en nodo no vigente **nunca** es faltante aunque no tenga agrupación.
8. Sin `incluirInactivos` solo salen las activas y vigentes; con él salen todas, con `activo` y `vigente` correctos, y `faltante` sigue valiendo la regla 7 (no cambia por el modo).
9. Cada fila trae `ruta = "GÉNERO / MUNDO / LÍNEA"` con los nombres del catálogo y `agrupacion` resuelta por id (incluidas las inactivas, con su `activo`). Una equivalencia cuyo `agrupacion_estacionalidad_id` no esté en la lista de agrupaciones (no puede pasar con la FK) se trata como sin agrupación.
10. Orden: géneros y mundos por `orden, nombre`, líneas por `nombre`, equivalencias con `ordenarEquivalencias`. `resumen` cuenta exactamente lo devuelto; `faltantes = faltantes_reales + faltantes_genericas` y `con_agrupacion + sin_agrupacion = equivalencias`.

**`importar.ts` — `planificarImportacionEstacionalidad(filas, estado)` y `aplicarPlanEstacionalidad(estado, plan)`**

11. Resolución del nodo y de la equivalencia idéntica a la del árbol: `""` → genérica del nodo, `-` → la real con el nombre de la línea, `SIN EQUIVALENCIA` → genérica; mismo test de "tres formas de escribir la misma fila caen en la misma equivalencia". Cada omitida lleva la fila completa (cinco campos) y, cuando aplica, `detalle` y `fila_original`.
12. **Idempotencia**: `planificarImportacionEstacionalidad(filas, aplicarPlanEstacionalidad(estado, plan))` devuelve `crear.agrupaciones = 0`, `asignar.nuevas = 0`, `asignar.reasignadas = 0` y `asignar.sin_cambio` igual a las procesadas de la primera pasada. Aplicar dos veces el mismo plan produce el mismo estado.
13. El importador **nunca** crea líneas, nodos ni equivalencias, nunca cambia `activo` de nada y nunca pone una agrupación en `null` (test: el plan solo tiene `agrupaciones_nuevas` y `asignaciones`, y ninguna asignación tiene destino nulo).
14. Agrupación nueva: se crea una sola vez aunque aparezca en mil filas; `codigo = codigoUnico(aCodigo(nombre), códigos existentes ∪ los nuevos del mismo archivo)`; dos nombres distintos que derivan al mismo código reciben `_2`. Agrupación existente se resuelve por código o por nombre normalizado; inactiva → `agrupacion_inactiva` sin crear una homónima.
15. Misma equivalencia dos veces: misma agrupación → `duplicada_en_archivo` con `fila_original`; distinta → `contradictoria_en_archivo` con `fila_original` y `detalle` = agrupación de la primera; en ambos casos se procesa solo la primera.
16. Equivalencia con otra agrupación en la base → cuenta en `reasignadas` y figura en `reasignaciones` con `de`/`a`; con la misma → `sin_cambio`; sin agrupación → `nuevas`. `reasignaciones` se corta en 500 entradas, pero `asignar.reasignadas` es el total.
17. Filas sobre nodos no vigentes o equivalencias inactivas → `nodo_inactivo` / `equivalencia_inactiva`, sin asignar. Los conteos cierran: `recibidas = procesadas + omitidas` y `procesadas = nuevas + reasignadas + sin_cambio`.

**`armar-arbol.ts` (M1, ampliado)**

18. `armarArbol(…, agrupaciones)` pone en cada equivalencia `agrupacion_estacionalidad` con `{ id, nombre, activo }` o `null`, y `resumen.equivalencias_sin_agrupacion` cuenta, entre las equivalencias devueltas, las que cumplen la regla 7. Los tests de M1 siguen pasando con `agrupaciones = []` (todas salen con `null`).

## Hito de prueba

Con el árbol real cargado en `vector-two` (8 géneros · 5 mundos · 86 líneas · 556 nodos · 1 691 equivalencias reales + 265 genéricas = 1 956). Los conteos suponen que Javier no desactivó nada desde el cierre de M1; si lo hizo, los faltantes iniciales son 1 956 menos las equivalencias inactivas o en nodos no vigentes.

- [ ] Checks automáticos: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (los 131 de M0–M1 más los de `tests/estacionalidad.*.test.ts`), `npm run build` y `scripts/validar-migraciones-local.sh` (todas las migraciones dos veces) en verde.
- [ ] `0003_agrupaciones_estacionalidad.sql` aplicada dos veces en `vector-two` sin error; tipos regenerados; `get_advisors` sin avisos nuevos; `agrupaciones_estacionalidad` con RLS activo y sin políticas; `equivalencias.agrupacion_estacionalidad_id` existe, nullable, con su índice; ninguna equivalencia existente cambió (`select count(*) from equivalencias` igual que antes, todas con la columna en `null`).
- [ ] Tras la migración: `GET /api/agrupaciones-estacionalidad` devuelve `[]` (sin seed); `GET /api/estacionalidad/faltantes` devuelve 1 956 filas con `motivo_faltante = sin_agrupacion`, de las que 265 son genéricas; el resumen de `/maestros/estacionalidad` dice `1 956 equivalencias · 0 con agrupación · 1 956 faltantes (265 genéricas)` y la pestaña se llama "Faltantes (1 956)".
- [ ] Menú: admin y planner ven "Agrupaciones de estacionalidad" habilitado; el comprador no lo ve y `/maestros/estacionalidad` le redirige a `/`; `POST /api/agrupaciones-estacionalidad` le responde `403`. Como planner, todo lo de abajo funciona (no hace falta admin para nada de M3).
- [ ] Agrupaciones: crear `  pantalones   invierno ` → se guarda `PANTALONES INVIERNO` con código `PANTALONES_INVIERNO`; crear otra en minúsculas con el mismo nombre → `409`; crear `Pantalones-Invierno` (distinto nombre, mismo código derivado) → `409` por código, y con código editado a `PANT_INV_2` → ok. Editar descripción y orden en línea; reordenar y ver el orden reflejado en los `Select` de Asignación y del árbol.
- [ ] Árbol: en HOMBRE / URBANO / PANTALON la columna Equivalencias muestra "Sin agrupación" en cada fila; elegir una agrupación en el `Select` de JOGGER la guarda al instante y el badge cambia; la genérica SIN EQUIVALENCIA también acepta agrupación; el contador "N sin agrupación" del nodo baja en 2; `GET /api/arbol` trae `agrupacion_estacionalidad: { id, nombre, activo }` en esas dos y `null` en el resto; el comprador ve los badges y ningún `Select`.
- [ ] Asignación por árbol: filtrar Género HOMBRE + Línea PANTALON (todos los mundos) → aparecen las equivalencias de los nodos HOMBRE / * / PANTALON; "seleccionar las N filtradas" + Asignar a PANTALONES INVIERNO → `confirm` con el conteo y "M ya tienen otra agrupación" (las 2 del paso anterior si se eligió otra) → la tabla se recarga con el badge y el resumen baja; la fila de la agrupación en la pestaña Agrupaciones muestra `N equivalencias` y el enlace abre la vista Por agrupación filtrada.
- [ ] Por agrupación: en PANTALONES INVIERNO seleccionar 3 y "Mover a" otra agrupación; seleccionar 1 y "Quitar agrupación" → vuelve a Faltantes con motivo "Sin agrupación".
- [ ] Regla de inactiva: desactivar una agrupación con equivalencias → `confirm` dice cuántas quedarán como faltantes; tras aceptar, esas equivalencias aparecen en Faltantes con el chip "Agrupación inactiva (N)" y en el árbol con badge "X · inactiva"; intentar asignar a esa agrupación desde el `Select` del árbol (no aparece) o por API (`PATCH` / `asignar` con su id) → `409` legible; reactivarla → desaparecen de Faltantes sin tocar nada más.
- [ ] Eliminar: una agrupación con equivalencias → botón deshabilitado y `DELETE` por API → `409` con el conteo; una recién creada y vacía → se elimina.
- [ ] `PATCH /api/equivalencias/[id]` con un UUID que no existe como agrupación → `404`; con `null` → quita; `POST /api/estacionalidad/asignar` con un id de equivalencia inventado entre otros válidos → `200` con ese id en `no_encontradas` y el resto asignado; con `agrupacion_id` de una inactiva → `409`; con 2 001 ids → `400`.
- [ ] Importar: descargar "Faltantes (CSV)" desde la pestaña Faltantes, completar la columna AGRUPACION en Excel para un subconjunto (p. ej. todo MUJER), guardar como `.xlsx` y subirlo: el mapeo se autodetecta; **Previsualizar** lista las agrupaciones a crear con su conteo, las asignaciones nuevas, cero reasignaciones y las filas con AGRUPACION vacía como omitidas `Agrupación vacía` (informadas, no bloquean); **Aplicar** → el reporte final coincide; Faltantes baja exactamente en las procesadas.
- [ ] Reimportar el mismo archivo: todo en `sin_cambio`, `crear.agrupaciones = 0`, "Nada que cambiar"; los conteos de la base no se mueven. Cambiar en el archivo la agrupación de 5 filas y reimportar: previsualización con 5 en "Cambian de agrupación" con de → a; aplicar las cambia y solo a ellas.
- [ ] Importar un archivo con una fila cuyo equivalencia no existe (`JOGER`), una con mundo vacío, una con línea inexistente y dos filas de la misma equivalencia con agrupaciones distintas: las cuatro salen en "Filas con errores" con sus motivos (`Equivalencia desconocida`, `Mundo vacío`, `Línea desconocida`, `Contradictoria en el archivo` con la fila original), nada de eso se crea ni se asigna, y "Descargar omitidas (CSV)" las baja con la columna Agrupación.
- [ ] Cierre del hito: asignar el resto (a mano o por archivo) hasta que la pestaña Faltantes muestre el `EmptyState` "Toda equivalencia activa tiene agrupación"; `GET /api/estacionalidad/faltantes` devuelve `[]` y `resumen.faltantes = 0`; el resumen del árbol dice `0 sin agrupación`.
- [ ] `GET /api/estacionalidad/equivalencias` y `GET /api/arbol` responden en menos de 2 s con el árbol real.
- [ ] `APP_VERSION` subida a `0.4.0 · M3` (M2 cierra en `0.3.0 · M2`) y visible al pie del menú.

## Fuera de alcance

- **Cálculo de curvas** (promedios mensuales, índices, tratamiento de años Niño): M6. Esta ficha solo decide que la unidad de la curva es la agrupación.
- **Carga de venta y stock histórico**: M5. El reporte de faltantes de M3 es estructural (equivalencia sin agrupación), no "equivalencia sin venta".
- Si la curva es por agrupación o por agrupación × tienda: lo decide M6 (pregunta abierta 3); M3 no necesita saberlo porque la asignación equivalencia → agrupación es la misma en ambos casos.
- Temporada (Verano / Invierno / Todo el año) a nivel de agrupación: hoy vive en la línea (M1). Si M6 la necesita por agrupación, es una columna por migración (pregunta abierta 6).
- Agrupaciones jerárquicas o una equivalencia en varias agrupaciones con pesos: no; una equivalencia, una curva.
- Que el importador cree líneas, nodos o equivalencias (es el del árbol) o quite agrupaciones (es la pantalla).
- Marcas (M2) y tiendas (M4). El vínculo marca ↔ equivalencia no interviene en la estacionalidad.
- Auditoría de quién asignó qué (pendiente desde M0).
- Reporte de "agrupaciones sin venta" o con pocas equivalencias para fusionar: útil, pero necesita M5.

## Decisiones nuevas que propone esta ficha

Para registrar en `docs/DECISIONES.md` cuando Javier apruebe la especificación:

1. **Agrupaciones de estacionalidad sin seed; nombres del negocio.** No se crea ninguna por migración, ni una "GENERAL": un comodín inventado esconde el reporte de faltantes, que es la herramienta del módulo.
2. **Faltante = equivalencia activa y vigente sin agrupación activa.** Incluye las genéricas (su venta existe) y las que apuntan a una agrupación desactivada. Desactivar una agrupación no toca sus equivalencias; reactivarla las devuelve completas.
3. **El importador de estacionalidad crea agrupaciones pero no toca el árbol.** Crea las agrupaciones que no existan (son del planner, no catálogo raíz) y las lista en la previsualización; nunca crea líneas, nodos ni equivalencias, nunca cambia `activo` y nunca quita una agrupación. El archivo manda en las reasignaciones y la previsualización las muestra una por una.
4. **Guard de escritura `requirePlanner` para todo M3**, incluido el catálogo de agrupaciones: es trabajo de planificación, como las líneas.

## Preguntas abiertas para Javier

1. **La lista.** ¿Ya tienes las agrupaciones de estacionalidad y a qué equivalencias va cada una? Si sí, ¿en qué formato (¿una columna más en el archivo del árbol?)? El importador acepta `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION`, con las mismas reglas que el árbol (`-` = igual a la línea, vacío = genérica). Si no la tienes, la pestaña Faltantes y el CSV descargable están pensados para armarla.
2. **La genérica `SIN EQUIVALENCIA`.** La ficha propone que lleve agrupación como cualquier otra (su venta existe y M7 tiene que proyectarla). ¿De acuerdo, o prefieres que las 265 genéricas queden fuera del reporte de faltantes y se proyecten de otra forma?
3. **Grano de la curva (afecta solo a M6).** ¿La curva será una por agrupación para toda la red, o por agrupación × tienda (como en Vector-One, que calculaba por tienda / marca / género / línea)? Si es por tienda, M6 necesita suficiente historia por tienda y M4 (aperturas) para las tiendas nuevas; la asignación de M3 es la misma en ambos casos.
4. **Reasignar desde el archivo.** Decidimos que, si una fila del archivo trae una agrupación distinta de la que la equivalencia ya tiene, el archivo manda (y la previsualización lo muestra). ¿Prefieres que esas filas se omitan y haya que cambiarlas a mano?
5. **Obligatoria al crear.** Hoy una equivalencia nueva (desde el árbol o desde el importador del árbol) nace sin agrupación y aparece en Faltantes. ¿Quieres que al crear una equivalencia a mano la agrupación sea obligatoria? Se decidió que no, para no frenar la carga del árbol, pero es un `Select` más en el formulario.
6. **Temporada.** En Vector-One el tratamiento de años Niño dependía de `linea.temporada` (Invierno). Si la curva pasa a ser por agrupación, ¿la temporada debería vivir en la agrupación (p. ej. "PANTALONES INVIERNO" es de invierno) además de o en vez de en la línea? Solo para dejar lista la columna; no bloquea M3.
7. **Nombre en el menú.** "Agrupaciones de estacionalidad" (completo) o "Estacionalidad" (corto, y en Fase 2 la misma entrada podría llevar también a las curvas).

## Cambios respecto a la especificación

(Se completa durante la construcción.)

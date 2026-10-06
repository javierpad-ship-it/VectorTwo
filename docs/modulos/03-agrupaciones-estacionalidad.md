# M3 · Agrupaciones de estacionalidad

> Estado: **construida (2026-10-06, `0.4.0 · M3`, con el Mapa en `0.4.1` y `0.5.1`); el cambio de géneros (`0.6.0 · M3`, migración `0005`) pendiente de que Javier lo recorra**. Lint, typecheck, 444 tests en 31 archivos, build y las migraciones `0003` y `0005` aplicadas dos veces en `vector-two` en verde. Cada agrupación pertenece ahora a uno o más géneros y solo acepta equivalencias de esos géneros (ver "Géneros de una agrupación", más abajo). Módulo anterior: [01-arbol-producto](01-arbol-producto.md) (M2, [02-marcas](02-marcas.md), no es prerrequisito: M3 solo depende de M1). Reglas de base en `docs/PLAN.md` §4 y `docs/DECISIONES.md`. Lo que se construyó distinto de lo especificado está en "Cambios respecto a la especificación", al final; la ficha describe lo que hay en el código.

## Objetivo

En la Fase 2 cada curva de estacionalidad (M6) se calcula por **agrupación de estacionalidad**, no por equivalencia: muchas de las 1 956 equivalencias del árbol real venden poco y una curva propia sería ruido. M3 construye el catálogo de agrupaciones (nombres del negocio, mantenidos por el planner) y la asignación de **cada equivalencia a una agrupación**, con un reporte de faltantes que diga qué equivalencias activas y vigentes todavía no tienen curva: **una equivalencia sin agrupación no se puede proyectar** en M7. Las curvas en sí (cálculo a partir de la venta histórica) son M6 y quedan fuera.

Relación con lo que viene: M5 cargará venta y stock al grano del árbol; M6 agregará esa venta por agrupación de estacionalidad y calculará una curva mensual por agrupación (o por agrupación × tienda, pregunta abierta); M7 aplicará a cada equivalencia la curva de su agrupación. Por eso el hito de M3 es "toda equivalencia activa tiene agrupación" (PLAN §5), y la pantalla gira alrededor de cerrar esa lista.

Cambio posterior (2026-10-06, `0.6.0`): Javier pidió que "las agrupaciones de estacionalidad tengan que poder asignarse a 1 o más géneros", que "cuando filtras género para asignar solo te muestre las asignaciones que aplican" y que las listas de agrupaciones vayan "por orden alfabético". La ficha incorpora esas tres cosas: un vínculo agrupación-género, una regla que impide asignar una equivalencia a una agrupación que no incluye su género, y el filtro de género y el orden alfabético en las pantallas. El resto del módulo no cambió.

Lo que Javier fijó al aprobar la ficha (2026-10-06): no existe una lista previa de agrupaciones ni de asignaciones que importar; la clasificación género-mundo-línea-equivalencia → agrupación la construye él dentro del sistema con las pestañas Agrupaciones, Asignación y Faltantes. El importador de este módulo se conserva como apoyo opcional (completar en Excel el CSV de faltantes y subirlo), no como la vía principal. Y las curvas se calculan sobre la venta real cuando exista (M5 → M6): M3 solo agrupa, sin curvas manuales ni cálculo alguno en Fase 1.

## Modelo de datos

Migración `supabase/migrations/0003_agrupaciones_estacionalidad.sql` (la tabla de vínculos con géneros es de `0005`, más abajo), idempotente, sin bloques `do $$`. Mismas convenciones que M1: `id uuid primary key default gen_random_uuid()`, `activo boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` con `public.tg_set_updated_at()` creado con **`create or replace trigger`** (sin `drop trigger`: la migración se aplica por `execute_sql` y la convención vigente es no borrar nada, ni siquiera triggers), `enable row level security` sin políticas.

### `agrupaciones_estacionalidad`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | `check (length between 1 and 40)`; único (`unique index on upper(codigo)`) |
| `nombre` | `text not null` | `check (length between 1 and 120)`; único (`unique index on nombre`). Se guarda normalizado (`normalizarNombre`: NFC, trim, mayúsculas en español), igual que todo nombre del árbol |
| `descripcion` | `text null` | `check (length(descripcion) <= 500)`. Texto libre: para qué sirve la curva ("Líneas de invierno con pico en mayo-junio"). No se normaliza a mayúsculas; sí `trim`, y vacío se guarda como `null` |
| `orden` | `integer not null default 0` | Desde `0.6.0` ya no manda en las listas ni en los `Select` (van por nombre, ver "Orden alfabético"); sigue fijando el orden de `GET /api/agrupaciones-estacionalidad` y el color de cada agrupación (posición por `orden, nombre`) |

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

### `agrupacion_estacionalidad_genero` (migración `0005`, `0.6.0`)

Migración `supabase/migrations/0005_agrupacion_estacionalidad_genero.sql`, con las mismas convenciones que `0003` (idempotente, sin `do $$`, sin `DROP`, `DELETE` ni `TRUNCATE`, `create or replace trigger`). Tabla de vínculos entre una agrupación y los géneros a los que pertenece:

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `agrupacion_estacionalidad_id` | `uuid not null` | FK a `agrupaciones_estacionalidad(id)` con **`on delete cascade`** |
| `genero_id` | `uuid not null` | FK a `generos(id)` con **`on delete restrict`** |
| `created_at`, `updated_at` | `timestamptz` | trigger `set_updated_at`; RLS activo sin políticas |

Único sobre `(agrupacion_estacionalidad_id, genero_id)`: un género aparece una vez por agrupación; con la agrupación al frente, ese mismo índice responde "¿qué géneros tiene esta agrupación?". Índice aparte sobre `genero_id` para la dirección inversa ("¿qué agrupaciones sirven a este género?") y para la comprobación de la FK. **Sin columna `activo`**: el vínculo existe o no existe; quitarle un género a una agrupación es borrar la fila.

Por qué las dos FK difieren: los géneros de una agrupación son un atributo de ella, así que si la agrupación se elimina (solo es posible sin equivalencias) sus vínculos se van con ella y el `cascade` nunca borra trabajo del planner. El género, en cambio, es un catálogo raíz que manda sobre el árbol: uno con agrupaciones vinculadas no se puede eliminar y arrastrar en silencio la configuración de estacionalidad (`restrict`, `409` desde el handler).

**La regla de género.** Una equivalencia solo puede asignarse a una agrupación cuyos géneros incluyan el de su nodo (`equivalencias.genero_mundo_linea_id → genero_mundo_linea.genero_id`). Cruza tres tablas (equivalencia → nodo → género, y agrupación → géneros), así que **no se puede expresar con un `check` ni con una FK compuesta** sin duplicar el género dentro de `equivalencias`. Por eso la base solo guarda el dato y la regla la hacen cumplir el backend (asignación individual, masiva e importador) y la pantalla, que además no ofrece los destinos que se sabe que van a fallar.

**Backfill.** La migración, para cada equivalencia que ya tenía agrupación, registra el género de su nodo como género de esa agrupación (`select distinct … on conflict do nothing`), de modo que ninguna asignación previa queda fuera de la regla. Solo agrega: no resucita un género que el planner ya hubiera quitado de una agrupación sin equivalencias de ese género. Las agrupaciones **sin equivalencias quedan con cero géneros**: no se les inventa uno (ni "todos", ni uno por defecto), por la misma razón por la que se descartó sembrar una `GENERAL` en `0003`: un género supuesto por nosotros escondería la decisión que Javier tiene que tomar.

Resultado en producción (`vector-two`): ASESORIA 1 y TES HO INV PESADO quedaron con HOMBRE (por sus equivalencias ya asignadas); AASE_INVIERNO y TES HO INV LIGERO quedaron **sin género** ("heredadas"). Una agrupación sin género se puede renombrar, activar o desactivar, pero **no acepta asignaciones** hasta que tenga al menos uno; la pantalla las marca "Sin género". Desde la API una agrupación nunca vuelve a quedar sin género (el `POST` lo exige y el `PATCH` no deja pasar por cero), así que las heredadas son las únicas.

### Diagrama

```
agrupaciones_estacionalidad ◄──(agrupacion_estacionalidad_id, null)── equivalencias ──► genero_mundo_linea ──► generos
         │                                                                                                      ▲
         ├── agrupacion_estacionalidad_genero (1..n por agrupación) ────────────────────────────────────────────┘
         └── M6: una curva mensual por agrupación (o por agrupación × tienda)
```

La regla de género compara el género del nodo de la equivalencia (arriba) con los de la agrupación (abajo). Esa comparación se hace en código: entre `equivalencias` y `agrupacion_estacionalidad_genero` no hay ninguna FK.

## Contratos de API

Mismas convenciones de M1: `{ data }` con `ok()` y `{ error }` con `error()` (`src/lib/api/respuestas.ts`); cuerpos con `leerCuerpo` y esquemas zod en `src/lib/estacionalidad/esquemas.ts` (reutilizan `nombre`, `codigo` y `uuid` de `src/lib/arbol/esquemas.ts`); `idDeRuta` en todo `[id]`; `traducirErrorDb`; lecturas paginadas con `leerTodo`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio o unicidad/FK · `500` error de base no previsto.

Guards: **lectura `requireUser`, escritura `requirePlanner`**. La estacionalidad es trabajo del planner (como las líneas y las equivalencias), no un catálogo raíz como géneros y mundos.

### Catálogo `agrupaciones-estacionalidad`

Hasta `0.5.1` reutilizaba el CRUD de `src/lib/api/catalogo.ts` con una configuración en `src/lib/estacionalidad/catalogos.ts`. Desde `0.6.0` **listar, crear y editar tienen handlers propios** en `src/lib/estacionalidad/agrupaciones.ts` (`listarAgrupaciones`, `crearAgrupacion`, `editarAgrupacion`), porque escriben en dos tablas y validan géneros antes de escribir; es el mismo camino que siguió M2 con las marcas. **Eliminar** sigue en `eliminarDeCatalogo` (el `cascade` de los vínculos se lleva los géneros con la agrupación, que solo se elimina sin equivalencias), y el catálogo genérico queda intacto para géneros, mundos, líneas y agrupaciones de marca. Lo que sigue describe los puntos en que el helper se generalizó para M3, sin cambiar el comportamiento de M1:

- `TablaCatalogo` incorpora `"agrupaciones_estacionalidad"`.
- `columnaHijos` + `conConteoNodos` se generalizan a `hijos?: { tabla: "genero_mundo_linea" | "equivalencias"; columna: string; clave: "nodos" | "equivalencias" }`: el helper cuenta en `tabla` por `columna` y anexa el conteo a cada fila bajo `clave`. Los catálogos de M1 pasan a `hijos: { tabla: "genero_mundo_linea", columna: "genero_id", clave: "nodos" }` y siguen devolviendo `nodos`.
- `TipoEliminable` (en `src/lib/arbol/reglas.ts`) suma `"agrupacion_estacionalidad"` con etiqueta `{ sujeto: "la agrupación de estacionalidad", uno: "equivalencia", varios: "equivalencias", desactivar: "Desactívala" }`.
- `MENSAJES_UNICO` (en `src/lib/api/errores-db.ts`) suma `agrupaciones_estacionalidad_codigo` → "Ya existe una agrupación de estacionalidad con ese código." y `agrupaciones_estacionalidad_nombre` → "Ya existe una agrupación de estacionalidad con ese nombre."; `MENSAJES_CHECK` suma `agrupaciones_estacionalidad_descripcion` → "La descripción no puede superar 500 caracteres."

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/agrupaciones-estacionalidad` | GET | `requireUser` | — | `agrupaciones[]` por `orden, nombre`, cada fila con `equivalencias: number` (conteo de equivalencias asignadas, activas o no), `equivalencias_activas: number` (solo las activas; es lo que pasa a faltante al desactivar), `genero_ids: string[]` y `generos: { id, codigo, nombre }[]` (por `orden, nombre` del género; vacíos en las "sin género"). `?incluir_inactivos=1` |
| `/api/agrupaciones-estacionalidad` | POST | `requirePlanner` | `crearAgrupacionSchema` | fila creada (con `genero_ids` y `generos`), `201`. `400` sin `genero_ids` · `404` género inexistente · `409` género inactivo, nombre o código repetido |
| `/api/agrupaciones-estacionalidad/[id]` | PATCH | `requirePlanner` | `editarAgrupacionSchema` | fila actualizada (con `genero_ids` y `generos`). `404` · `409` repetido, género inactivo al agregarlo o género con equivalencias al quitarlo |
| `/api/agrupaciones-estacionalidad/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` "No se puede eliminar la agrupación de estacionalidad: tiene N equivalencias. Desactívala." |

```ts
// pseudocódigo zod — src/lib/estacionalidad/esquemas.ts
const descripcion = z.string().max(500).transform((v) => (v.trim() === "" ? null : v.trim())).nullable();
const generoIds = z.array(uuid).min(1).max(50).refine(sinRepetidos);   // "Elige al menos un género." · "No repitas géneros."

crearAgrupacionSchema  = z.object({ nombre, codigo: codigoOpcional, descripcion: descripcion.optional(), orden: orden.optional(), genero_ids: generoIds })
   // si falta codigo → aCodigo(nombre), igual que crearCatalogoSchema
editarAgrupacionSchema = z.object({ nombre, codigo, descripcion, orden, activo, genero_ids: generoIds }).partial().refine(noVacio);
```

**`POST` con géneros.** `genero_ids` es obligatorio (1 a 50, únicos). Todo se valida antes de escribir: algún género inexistente → `404 "Género no encontrado."`; alguno inactivo → `409`. Después inserta la agrupación y, enseguida, sus vínculos; si los vínculos fallan, borra la agrupación recién creada para no dejar una "sin género" (ver "Limitaciones conocidas").

**`PATCH` con géneros.** Si viene `genero_ids` **reemplaza el conjunto** (mínimo 1, así que desde la API una agrupación nunca queda sin género). Valida todo antes de escribir: `404` si algún género no existe, `409` si **agrega** uno inactivo (los que ya tenía no se revisan: desactivar un género después no le quita la agrupación) y `409` si **quita** un género del que la agrupación tiene equivalencias: "No se puede quitar HOMBRE de X: tiene N equivalencias de HOMBRE. Reasígnalas antes." (el conteo es por el género del nodo de cada equivalencia, activas o no; con varios géneros bloqueados se reporta el primero). Orden de escritura: primero los campos de la agrupación (los `409` de nombre o código repetido salen aquí), luego se agregan los géneros nuevos (`upsert` con `ignoreDuplicates`) y al final se borran los quitados, para que la agrupación no pase por cero géneros. Una agrupación heredada sin géneros se puede renombrar, activar o desactivar sin mandar `genero_ids`.

Desactivar una agrupación con equivalencias está permitido (es la acción normal, como en el árbol); la pantalla avisa cuántas equivalencias pasarán a faltantes. `MENSAJES_UNICO` suma `agrupacion_estacionalidad_genero_par` → "Esa agrupación ya incluye ese género."; `MENSAJES_FK` traduce la FK de géneros (eliminar un género que tiene agrupaciones → `409` "No se puede eliminar el género: tiene agrupaciones de estacionalidad asignadas. Quítalo de ellas o desactívalo."; asignar un género inexistente → `404`).

### Equivalencias: asignación individual

`PATCH /api/equivalencias/[id]` (`requirePlanner`, ya existe) acepta un campo más:

```ts
editarEquivalenciaSchema = z.object({ nombre, codigo, activo, agrupacion_estacionalidad_id: uuid.nullable() })
   .partial().refine(noVacio).refine(/* "-" solo al crear, como hoy */);
```

- `null` quita la agrupación. Sobre la **genérica** sí se admite (la regla "la genérica no se renombra" sigue aplicando solo a `nombre` y `codigo`).
- El handler, si el cuerpo trae un id no nulo, lee la agrupación (con sus `genero_ids`) y el género del nodo de la equivalencia, y rechaza en este orden (función pura `rechazoAsignacion`, reglas 4 y 19 a 21): no existe → `404 "Agrupación de estacionalidad no encontrada."`; inactiva → `409 "La agrupación X está inactiva: reactívala o elige otra."`; sin géneros → `409 "La agrupación X no tiene géneros: asígnale al menos uno antes de usarla."`; género no incluido → `409 "La agrupación X no incluye el género Y: edítala para añadírselo o elige otra."`. Se comprueba antes del `update` para que la violación de FK nunca llegue a `traducirErrorDb`, cuyo mensaje para `23503` habla de eliminar. Quitar la agrupación (`null`) no comprueba géneros. El género que se compara es el del nodo `genero_mundo_linea` de la equivalencia.
- Respuesta: la fila completa de `equivalencias` (ahora con `agrupacion_estacionalidad_id`). `EquivalenciaFila` en `tipos.ts` suma el campo.

### Asignación masiva

`POST /api/estacionalidad/asignar` · `requirePlanner`.

```ts
asignarSchema = z.object({
  agrupacion_id: uuid.nullable(),                       // null = quitar la agrupación a todas
  equivalencia_ids: z.array(uuid).min(1).max(2_000),    // el árbol real tiene 1 956; una selección nunca pasa de ahí
});
```

1. Si `agrupacion_id` no es nulo, el **destino** se comprueba entero y rechaza toda la petición: `404` si no existe, `409` si está inactiva (regla 4), `409` si no tiene géneros (`rechazoDestinoAsignacion`).
2. Se deduplican los ids. Se consultan las equivalencias (con el género de su nodo) por `in("id", …)` en tandas de **150** (`TANDA_IN` en `src/lib/arbol/importar.ts`; antes eran 500: 500 UUID en un filtro `in` pasan de 18 KB de URL y el gateway puede rechazarlos); los ids que no existan se devuelven en `no_encontradas` y **no** abortan la operación (una pantalla con datos viejos no debe perder el trabajo de selección por una equivalencia que alguien eliminó).
3. **Género.** Las equivalencias cuyo género la agrupación destino no incluye no se asignan y vuelven en `no_permitidas: { id, genero }[]` (`genero` es el nombre del género de esa equivalencia). Tampoco abortan: el resto de la selección sí se asigna. Quitar (`agrupacion_id: null`) no comprueba géneros.
4. `update equivalencias set agrupacion_estacionalidad_id = $1 where id in (…)` en tandas de 150. Se asigna también a equivalencias inactivas si el cliente las manda: la asignación es un atributo de la equivalencia, no una escritura bajo un padre apagado, y así una equivalencia reactivada ya tiene curva.
5. Respuesta `200`: `{ "data": { "asignadas": 37, "sin_cambio": 3, "no_encontradas": ["…"], "no_permitidas": [{ "id": "…", "genero": "MUJER" }] } }` (`sin_cambio` = ya tenían esa agrupación; se cuenta antes que `no_permitidas`).

Sin transacción (supabase-js no las expone): si una tanda falla, la respuesta es `500` y repetir la misma asignación completa el resto sin efectos secundarios (la operación es idempotente).

### Lista plana y faltantes

Dos lecturas que comparten una sola función pura, `aplanarEquivalencias(estado, agrupaciones, { incluirInactivos, soloFaltantes })` en `src/lib/estacionalidad/aplanar.ts`, alimentada por `cargarEstadoEstacionalidad` (`src/lib/estacionalidad/consultas.ts`: las cinco tablas del árbol vía `cargarEstadoArbol`, que no se toca, más `agrupaciones_estacionalidad` completa, activas e inactivas). `/faltantes` es la misma función con `soloFaltantes: true`.

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
  "agrupaciones": [ { "id": "…", "codigo": "…", "nombre": "…", "orden": 10, "activo": true, "genero_ids": ["…"] } ],   // desde 0.6.0; [] = sin género
  "resumen": { "equivalencias": 1956, "con_agrupacion": 0, "faltantes": 1956,
               "faltantes_genericas": 265, "faltantes_por_agrupacion_inactiva": 0 }
} }
```

Las filas llevan ids de género, mundo y línea más la `ruta` ya armada; los catálogos viajan una vez en el mismo cuerpo, completos (activos e inactivos, para que los filtros sepan nombrar un padre apagado), para que la pantalla arme filtros y `Select` sin más llamadas. Con el árbol real son 1 956 filas, del orden de 300 KB sin comprimir: aceptable para una pantalla de maestro, como el árbol. Orden: por ruta (género `orden`, mundo `orden`, línea `nombre`) y dentro del nodo `ordenarEquivalencias` (reales por nombre, genérica al final). `resumen` cuenta lo devuelto.

### Árbol

`GET /api/arbol` (`requireUser`, ya existe) suma a cada equivalencia su agrupación. `armarArbol` recibe un sexto parámetro `agrupaciones` (las opciones pasan al séptimo) y `EquivalenciaArbol` queda:

```ts
{ id, codigo, nombre, es_generica, activo,
  agrupacion_estacionalidad: { id: string; nombre: string; activo: boolean } | null }
```

`resumen` suma `equivalencias_sin_agrupacion` (entre las devueltas, las que cumplen la regla 7). El handler usa `cargarEstadoEstacionalidad`, que lee `agrupaciones_estacionalidad` completa (activas e inactivas: una equivalencia puede apuntar a una inactiva y el árbol debe poder mostrarlo).

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
5. Resolver la **agrupación** primero por nombre normalizado y, si no, por `aCodigo(valor) = codigo` (`buscarAgrupacion`; el orden importa para la idempotencia, ver regla 14): existe y activa → se usa (si pasa la regla de género de abajo); existe inactiva → `agrupacion_inactiva`; no existe → se **crea** (`crear.agrupaciones`, con `codigo = codigoUnico(aCodigo(nombre))`, `orden = 0`, sin descripción y **con los géneros de las filas que apuntan a ella**) y se reutiliza para el resto del archivo. **Género (0.6.0):** el importador **nunca amplía los géneros de una agrupación existente**. Existente sin géneros → `agrupacion_sin_genero` (`detalle` = su nombre); existente que no incluye el género de la fila → `genero_no_incluido` (`detalle` = el género). Una agrupación nueva se crea con los géneros distintos de las filas **procesadas** que le apuntan (las duplicadas o contradictorias no aportan), así que nace con al menos uno; si en el archivo mezcla géneros, nace con todos ellos. Decisión: el importador **sí crea agrupaciones** porque el objetivo del archivo es cargar de una vez la lista de Javier, las agrupaciones no son catálogo raíz (las crea el planner desde la pantalla, a diferencia de géneros y mundos, que son de admin), y la previsualización lista las que va a crear con su conteo de equivalencias para que un error de tipeo ("PANTALON INVIERNO" vs "PANTALONES INVIERNO") se vea antes de aplicar.
6. Duplicados dentro del archivo: misma equivalencia resuelta dos veces con la **misma** agrupación → `duplicada_en_archivo` (`fila_original`, informativa); con **distinta** agrupación → `contradictoria_en_archivo` (`fila_original`, `detalle` = la agrupación de la primera; es un error que hay que corregir). En ambos casos gana la primera aparición. Esta comprobación va antes de registrar la agrupación nueva, para no crear una que solo usara una fila contradictoria.
7. Comparar con la asignación actual: sin agrupación → `asignar.nuevas`; con otra agrupación → `asignar.reasignadas` (y se anota en `reasignaciones[]` con `de` y `a`, para que la previsualización lo muestre); con la misma → `asignar.sin_cambio`. **El archivo manda**: reasigna sin preguntar fila por fila, pero la previsualización lo deja claro y el `confirm` de Aplicar repite cuántas cambian. Nunca quita una agrupación (para eso está la pantalla): una equivalencia que no aparece en el archivo no se toca.
8. `previsualizar`: reporte sin escribir. `aplicar`: inserta las agrupaciones nuevas con `on conflict do nothing` y, **enseguida, sus vínculos de género** (solo de las que esta corrida creó: si otra sesión creó el mismo nombre, no se le tocan los géneros), las relee para obtener ids, y agrupa las equivalencias por agrupación destino para hacer un `update … where id in (…)` por agrupación en tandas de 150 (`TANDA_IN`). Si el insert de vínculos falla, el handler borra las agrupaciones recién creadas (todavía sin equivalencias) y responde `500`, para que reimportar no las encuentre "sin género" (ver "Limitaciones conocidas"). Sin transacción; reimportar completa lo que faltó sin duplicar ni cambiar nada más (idempotencia, regla 12).

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
  "muestra": { "agrupaciones": [ { "nombre": "PANTALONES INVIERNO", "codigo": "PANTALONES_INVIERNO", "equivalencias": 140, "generos": ["HOMBRE"] } ] }   // todas las que se crearán, con cuántas filas del archivo apuntan a cada una y los géneros (nombres, por orden del género) con que nacerán
} }
```

Motivos (`MotivoOmisionEstacionalidad` en `src/lib/estacionalidad/tipos.ts`): los ocho de M1 (`linea_vacia`, `fila_total`, `genero_desconocido`, `genero_inactivo`, `mundo_vacio`, `mundo_desconocido`, `mundo_inactivo`, `duplicada_en_archivo`) más `linea_desconocida`, `nodo_desconocido`, `nodo_inactivo`, `equivalencia_desconocida`, `equivalencia_inactiva`, `agrupacion_vacia`, `agrupacion_inactiva`, `contradictoria_en_archivo`, y desde `0.6.0` `agrupacion_sin_genero` y `genero_no_incluido`: **18 motivos** en total. Etiquetas en `ETIQUETA_MOTIVO_OMISION_ESTACIONALIDAD` (`tipos-api.ts`; las nuevas dicen "La agrupación no tiene géneros" y "El género no está en la agrupación"). Como en M1, `duplicada_en_archivo` es informativa y el resto son errores.

Por qué el importador omite lo inactivo pero `asignar` no: el importador es una carga masiva que sigue la regla de M1 ("nunca escribe bajo algo apagado, lo reporta"); la asignación desde pantalla es una acción explícita sobre filas que el usuario ve, con sus badges de inactiva.

## Pantallas

Ruta nueva `/maestros/estacionalidad`. En `src/lib/nav.ts` se quita `pendiente: "M3"` y el label pasa a **"Agrupaciones de estacionalidad"** (si no cabe en el sidebar, "Estacionalidad"); sigue con `roles: PLANIFICACION`, así que el comprador no la ve en el menú ni puede entrar por URL (`puedeVerRuta`). `page.tsx` servidor: `perfilActual()`; si no es `ok` o el rol es comprador → `redirect("/")`, igual que Catálogos. La API de lectura sigue siendo `requireUser` por si en Fase 3 se abre.

Panel cliente `estacionalidad-panel.tsx` con `Tabs`: **Mapa · Agrupaciones · Asignación · Faltantes · Importar** (la de Importar se deshabilita si el rol no edita). Encima, el resumen `1 956 equivalencias · 0 con agrupación · 1 956 faltantes (265 genéricas)`, calculado en memoria sobre las filas activas y vigentes de la lista plana (coincide con `resumen` de la API sin `incluir_inactivos`, valga o no "Mostrar inactivas"), con el conteo de faltantes también en el label de la pestaña ("Faltantes (1 956)"). Todas las pestañas comparten el hook `useColeccion` para el catálogo y un `useEstacionalidad()` (mismo patrón que `useArbol`) para la lista plana; cualquier escritura recarga ambos. `?pestana=faltantes` (o cualquier otra de las cuatro) abre esa pestaña al entrar; lo valida el Server Component con `esPestanaEstacionalidad` de `src/lib/estacionalidad/pestanas.ts`.

### Pestaña Mapa (añadida en 0.4.1)

Javier, al recorrer el hito, pidió "una forma más visual para ver las agrupaciones". Es la primera pestaña y la que se abre por defecto. Todo sale de la lista plana ya cargada (sin llamadas nuevas), vía la función pura `resumirMapa` (`src/lib/estacionalidad/mapa.ts`):

- **Cobertura por género**: una barra apilada por género con un segmento por agrupación (ancho proporcional a sus equivalencias activas y vigentes de ese género) y el tramo rayado en tono alerta con lo que falta asignar; `title` en cada segmento y leyenda compacta debajo.
- **Tarjetas**: una por agrupación, **en orden alfabético por nombre** (desde `0.6.0`; antes `orden, nombre`), con su color, nombre, código, descripción, número grande de equivalencias y porcentaje del total, barra proporcional, **chips con los géneros de la agrupación** (por el `orden` del género; badge "Sin género" en alerta si no tiene) y la lista colapsable de **líneas** (cerradas, con su conteo; cada una se abre para mostrar sus equivalencias, con "Abrir todas / Cerrar todas" y buscador dentro de la tarjeta a partir de 30, que abre solo las líneas que coinciden). Botón "Asignar" abre Asignación · Por agrupación con esa agrupación; **deshabilitado en las que no tienen género** (con `title` "Asígnale al menos un género para poder usarla") y acompañado de un botón "Asignar géneros" que lleva a la pestaña Agrupaciones. Si hay agrupaciones activas sin género, un **aviso global** arriba del Mapa las nombra y enlaza a Agrupaciones. La tarjeta **Sin agrupación** va primera en tono alerta con "Ir a Faltantes" y pasa a tono éxito cuando queda en cero (el hito). Una agrupación inactiva muestra sus equivalencias atenuadas y anota que cuentan como faltantes.
- **Color por agrupación** (`src/lib/estacionalidad/colores.ts`): paleta de 12 colores asignada por posición estable en el catálogo por `orden, nombre` (desactivar una no cambia el color de las demás; el orden alfabético de las listas **no** cambia los colores). El segmento de cobertura por género de la barra sigue también `orden, nombre`. El mismo color se usa en los badges de Asignación y Faltantes, en la leyenda sobre la barra de acción y en el árbol (punto junto al `Select` de cada equivalencia).

### Pestaña Agrupaciones

Mismo patrón que Géneros en Catálogos (`CatalogoPlano`): formulario de alta arriba (`Card`: nombre, código propuesto editable, descripción, orden, **géneros**; `VistaPreviaNombre`) y `DataTable` abajo. Desde `0.6.0` la tabla va **en orden alfabético por nombre** (`CatalogoPlano` recibe la prop opcional `ordenar`; sin ella conserva el orden de la API, así que géneros, mundos y agrupaciones de marca no cambian) y el catálogo recibe también la prop opcional `generos`, que activa el selector y la columna de géneros.

**Géneros en el alta.** Selector múltiple de chips (`src/components/ui/chips-multiples.tsx`) con los géneros activos; hay que marcar **al menos uno** (sin eso, "Crear" queda deshabilitado, con `title` "Elige al menos un género." y el texto de ayuda en alerta). La agrupación solo recibirá equivalencias de los géneros que se marquen.

| Columna | Contenido |
|---|---|
| Orden | número; editable en línea (ya no ordena la tabla; solo fija el color y el orden de la API) |
| Código | `code`; editable |
| Nombre | editable |
| Descripción | texto; editable (`Input`, hasta 500) |
| Géneros | chips con sus géneros (por el `orden` del género, no alfabéticos); editables en línea con el mismo selector, siempre con al menos uno. Si no tiene ninguno: badge **"Sin género"** en alerta y la fila resaltada (`DataTable` suma la prop opcional `claseFila`) |
| Equivalencias | `N equivalencias` como enlace que abre la pestaña Asignación con la vista inversa filtrada por esa agrupación |
| Estado | `Badge` Activa / Desactivada |
| Acciones (planner y admin) | Editar (en las "sin género" el botón dice **"Asignar géneros"**) · Desactivar / Reactivar · Eliminar (deshabilitado si `equivalencias > 0`, con `title` "Tiene equivalencias: desactívala en vez de eliminarla.") |

Guardar una edición sin géneros se rechaza en la pantalla ("Elige al menos un género."). Quitar un género que tiene equivalencias de ese género asignadas llega como `409` de la API ("Reasígnalas antes.") y se muestra tal cual. Con el nombre en dos líneas la tabla es más alta que antes (ver "Limitaciones conocidas").

`confirm` al desactivar con equivalencias: "¿Desactivar la agrupación X? Sus N equivalencias quedarán como faltantes hasta que la reactives o las reasignes.", donde N es `equivalencias_activas` (las inactivas no pasan a faltantes). Al eliminar: el `confirm` habitual. Errores `409` de la API con `Alert` tal cual llegan. Pie: "Desactivar conserva las asignaciones (sus equivalencias pasan a faltantes hasta que la reactives); eliminar solo es posible sin equivalencias."

### Pestaña Asignación

Para asignar en bloque. Dos vistas, elegidas con un par de `Chips`: **Por árbol** y **Por agrupación**. En la cabecera de la pestaña, junto a esos chips, el interruptor `Switch` "Mostrar inactivas" (recarga la lista con `incluir_inactivos=1`; las inactivas y no vigentes salen atenuadas con badge "Inactiva" / "Oculta por {padre} inactivo") y vale para las dos vistas.

**Por árbol.**

- Filtros en una fila: `Select` Género (todos + los 8), `Select` Mundo (todos + los 5), `Select` Línea (todas + las que existan en el género-mundo elegido, por nombre), `Input` de texto (busca en nombre y código de equivalencia y en la ruta). Debajo, `Chips` de estado según la regla 7: Todas (N) · Faltantes (N) · Con agrupación activa (N); una equivalencia cuya agrupación está inactiva cuenta como faltante.
- `DataTable` con `checkbox` por fila y en la cabecera ("seleccionar las N filtradas"), columnas: Ruta (género / mundo / línea), Equivalencia (nombre + badge "Genérica"), Código, Agrupación actual (`Badge` tono marca con el nombre; "Sin agrupación" en tono alerta; "X (inactiva)" en tono alerta si la agrupación está inactiva), Estado.
- Barra de acción fija sobre la tabla cuando hay selección: "N seleccionadas · Asignar a [Select de agrupaciones activas que aplican, por nombre] [Asignar] · [Quitar agrupación]" (qué significa "que aplican", justo debajo). `confirm`: "¿Asignar N equivalencias a X? M de ellas ya tienen otra agrupación y cambiarán." Llama a `POST /api/estacionalidad/asignar`, muestra `Alert` de éxito con `asignadas`/`sin_cambio` y, si `no_encontradas` no está vacío, un aviso de que la lista estaba desactualizada y se recargó; si `no_permitidas` no está vacío, un aviso "N equivalencias no se asignaron porque la agrupación no incluye su género: HOMBRE, MUJER." (`avisoNoPermitidas`).
- Con 1 956 filas la tabla se pinta completa (sin paginación): el filtrado es en memoria y es lo que el planner necesita para seleccionar "todo PANTALON de HOMBRE" de una vez. Si en el uso real se nota lento, se pagina en cliente de a 200.

**Por agrupación.**

- `Select` de agrupaciones por nombre (con su conteo; filtrado por el género elegido, ver abajo) y la misma tabla con las equivalencias de la elegida; sin filtro de estado (todas tienen esa agrupación), con los mismos filtros de género/mundo/línea/texto.
- Acciones en bloque: "Mover a [Select]" y "Quitar agrupación", con los mismos `confirm`.
- Vacío: "Esta agrupación no tiene equivalencias. Asígnale algunas desde la vista Por árbol."

**El filtro de género manda (0.6.0).** Es lo que pidió Javier: "cuando filtras género para asignar solo te muestre las asignaciones que aplican". La pantalla no ofrece destinos que se sepa que el servidor va a rechazar, así que con un género filtrado:

- La **leyenda de colores** y los selectores "Asignar a", "Mover a" y "Por agrupación" muestran solo las agrupaciones **activas, con género, que incluyen ese género**. Con "Todos los géneros" manda la selección: el destino debe incluir **todos** los géneros de las filas seleccionadas (`agrupacionesDestino`: intersección entre el género filtrado y los de la selección; con un género filtrado todas las filas son de ese género y se reduce al filtro).
- Cuando no queda ninguna agrupación aplicable, el selector lo dice y enlaza a la pestaña Agrupaciones (`explicarSinDestinos`): "Ninguna agrupación activa incluye el género X. Añádelo a una en la pestaña Agrupaciones.", "Ninguna agrupación incluye todos los géneros seleccionados (…). Filtra por género o asigna por partes." o "No hay agrupaciones activas con género. Asígnales géneros en la pestaña Agrupaciones."
- En **Por agrupación con "Todos"**, el selector muestra también las agrupaciones inactivas o sin género **que tengan equivalencias**, marcadas, para poder ver y quitar lo que ya tienen asignado.
- El destino elegido se conserva en el estado de la pantalla y reaparece si la selección vuelve a ser compatible.
- Si aun así la API devuelve `no_permitidas` (por ejemplo, con datos desactualizados), la pantalla lo avisa con nombre de género y el resto de la asignación se aplica.

**Orden alfabético (0.6.0).** Leyenda, selectores, tarjetas del Mapa, selector del árbol y tabla de Agrupaciones van por nombre con `compararPorNombre` (`localeCompare("es", { sensitivity: "base", numeric: true })`: sin distinguir acentos ni mayúsculas y con números naturales, de modo que "ASESORIA 2" va antes de "ASESORIA 10"). El campo `orden` ya no manda en esas vistas; sigue fijando el color y el orden de `GET /api/agrupaciones-estacionalidad`. Los chips de género de cada agrupación **no** son alfabéticos: siguen el `orden` del género.

Comprador: no llega a esta pantalla (menú y redirect). Si en Fase 3 se abre, las tablas se muestran sin `checkbox` ni barra de acción.

### Pestaña Faltantes

La misma tabla de "Por árbol", alimentada por las filas con `faltante: true` de la misma lista plana que ya tiene el panel (no hace una llamada aparte a `/faltantes`, que existe igual para la API), y con:

- `Chips` de motivo: Todas (N) · Sin agrupación (N) · Agrupación inactiva (N); y otro grupo: Reales (N) · Genéricas (N). Los mismos filtros de género, mundo, línea y texto.
- Resumen por género encima de la tabla ("HOMBRE 410 · MUJER 520 · …") como chips que filtran.
- La misma barra de asignación en bloque, con el mismo **filtro de género** y el mismo orden alfabético que en Asignación (el selector "Asignar a" solo ofrece las agrupaciones que aplican, y los mensajes de "no hay ninguna" enlazan a Agrupaciones): el flujo esperado es "filtrar género + línea → seleccionar todo → asignar a X" hasta que la pestaña quede vacía.
- Botón **Descargar faltantes (CSV)**: genera en el navegador, con BOM, un archivo con las columnas `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION` (esta última vacía; la equivalencia genérica sale como celda vacía y la que se llama como la línea sale con su nombre literal). Exporta las filas que pasan los filtros vigentes (género, mundo, línea, texto, motivo y tipo), así se puede bajar "solo MUJER" para trabajarlo por partes. Es exactamente el formato del importador: Javier lo completa en Excel y lo sube en la pestaña Importar. Junto al botón, "Importar" salta a esa pestaña.
- `EmptyState` cuando no hay faltantes: "Toda equivalencia activa tiene agrupación. Listo para M6." Ese es el hito.

### Pestaña Importar

Mismo flujo y mismos componentes que Importar CSV del árbol (`importar-csv.tsx` se generaliza o se duplica con el campo extra; decisión del frontend, pero la pantalla se ve igual):

1. Selector de archivo `.csv` / `.xlsx` / `.xls` (selector de hoja si hay varias). Mapeo de las **cinco** columnas, autodetectado y editable; las cinco son obligatorias.
2. **Previsualizar**: tarjetas `Agrupaciones a crear` (con la lista completa de `muestra.agrupaciones`, su conteo para detectar tipeos y, desde `0.6.0`, una columna **Géneros** con los que tendrá al crearse) · `Asignaciones nuevas` · `Cambian de agrupación` (con la tabla de `reasignaciones`: ruta, equivalencia, de → a) · `Sin cambio` · `Omitidas` (desglosada en "Con errores" y "Repetidas en el archivo").
3. **Revisión previa de lo omitido**, igual que en M1: bloque "Filas con errores" con la fila completa (ahora con la columna Agrupación), `Chips` por motivo con conteo (incluidos los dos de género: "El género no está en la agrupación" y "La agrupación no tiene géneros"), aviso en rojo de que no se cargarán, "Descargar omitidas (CSV)"; bloque "Repetidas en el archivo" informativo.
4. **Aplicar** solo tras previsualizar el mismo archivo; `confirm`: "Se crearán N agrupaciones, se asignarán N equivalencias y N cambiarán de agrupación. Quedarán fuera N filas con errores." Reporte final y botón "Ver faltantes" que salta a la pestaña con la lista recargada.
5. Reimportar el mismo archivo: `crear` y `asignar.nuevas` en cero, todo en `sin_cambio`; la pantalla dice "Nada que cambiar".

### Árbol (`/maestros/arbol`, columna Equivalencias)

En `columna-equivalencias.tsx`, columna nueva **Agrupación** entre Código y Estado:

- Comprador (y cualquier fila en modo edición de nombre): `Badge` con el nombre de la agrupación (tono marca), "Sin agrupación" (alerta) o "X · inactiva" (alerta).
- Planner y admin: `Select` en línea (mismo patrón que la temporada de las líneas en Catálogos) con "— Sin agrupación —" y **solo las agrupaciones activas que incluyen el género del nodo**, por nombre (orden alfabético desde `0.6.0`); si la equivalencia apunta a una agrupación que no sirve, esa opción (la actual) aparece deshabilitada y marcada "(inactiva)", "(sin género)" o "(no incluye este género)" según el caso, para que se vea qué tiene sin permitir elegirla de nuevo. El cambio se guarda al instante con `PATCH /api/equivalencias/[id]` y recarga el árbol. Errores `404`/`409` con el `Alert` de la columna.
- El género del nodo no se puede cambiar desde M1 (`PATCH /api/arbol/nodos/[id]` solo cambia el mundo), así que ninguna ruta de M1 puede dejar una equivalencia fuera del género de su agrupación.
- `arbol-panel.tsx` carga `/api/agrupaciones-estacionalidad?incluir_inactivos=1` una vez por página con `useColeccion` y se lo pasa a la columna; si la carga falla, la columna muestra solo el badge y un aviso con "Reintentar".
- En la columna Líneas, junto al conteo de equivalencias, un contador "N sin agrupación" (entre las equivalencias activas del nodo, las que no tienen agrupación o la tienen inactiva: regla 7) para que el planner vea desde el árbol qué nodos le faltan. En el resumen de arriba, `· 1 956 sin agrupación` tomado de `resumen.equivalencias_sin_agrupacion`, enlazado a `/maestros/estacionalidad?pestana=faltantes` para admin y planner (texto plano para el comprador, que no entra a esa pantalla).

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

**`aplanar.ts` — `aplanarEquivalencias(estado, agrupaciones, { incluirInactivos, soloFaltantes })`**

7. `esFaltante(e)` ⇔ `e.activo ∧ nodoVigente(nodo, genero, mundo, linea) ∧ (e.agrupacion == null ∨ e.agrupacion.activo == false)`. `motivo_faltante` es `sin_agrupacion` o `agrupacion_inactiva`; en las no faltantes es `null`. Una **genérica** cuenta igual que una real. Una equivalencia inactiva o en nodo no vigente **nunca** es faltante aunque no tenga agrupación.
8. Sin `incluirInactivos` solo salen las activas y vigentes; con él salen todas, con `activo` y `vigente` correctos, y `faltante` sigue valiendo la regla 7 (no cambia por el modo).
9. Cada fila trae `ruta = "GÉNERO / MUNDO / LÍNEA"` con los nombres del catálogo y `agrupacion` resuelta por id (incluidas las inactivas, con su `activo`). Una equivalencia cuyo `agrupacion_estacionalidad_id` no esté en la lista de agrupaciones (no puede pasar con la FK) se trata como sin agrupación.
10. Orden: géneros y mundos por `orden, nombre`, líneas por `nombre`, equivalencias con `ordenarEquivalencias`. `resumen` cuenta exactamente lo devuelto; `faltantes = faltantes_reales + faltantes_genericas` y `con_agrupacion + sin_agrupacion = equivalencias`.

**`importar.ts` — `planificarImportacionEstacionalidad(filas, estado)` y `aplicarPlanEstacionalidad(estado, plan)`**

11. Resolución del nodo y de la equivalencia idéntica a la del árbol: `""` → genérica del nodo, `-` → la real con el nombre de la línea, `SIN EQUIVALENCIA` → genérica; mismo test de "tres formas de escribir la misma fila caen en la misma equivalencia". Cada omitida lleva la fila completa (cinco campos) y, cuando aplica, `detalle` y `fila_original`.
12. **Idempotencia**: `planificarImportacionEstacionalidad(filas, aplicarPlanEstacionalidad(estado, plan))` devuelve `crear.agrupaciones = 0`, `asignar.nuevas = 0`, `asignar.reasignadas = 0` y `asignar.sin_cambio` igual a las procesadas de la primera pasada. Aplicar dos veces el mismo plan produce el mismo estado.
13. El importador **nunca** crea líneas, nodos ni equivalencias, nunca cambia `activo` de nada y nunca pone una agrupación en `null` (test: el plan solo tiene `agrupaciones_nuevas` y `asignaciones`, y ninguna asignación tiene destino nulo).
14. Agrupación nueva: se crea una sola vez aunque aparezca en mil filas; `codigo = codigoUnico(aCodigo(nombre), códigos existentes ∪ los nuevos del mismo archivo)`; dos nombres distintos que derivan al mismo código reciben `_2`. Agrupación existente se resuelve primero por nombre normalizado y, si no, por código (el nombre literal gana: si "PANTALON-INVIERNO" se creó como `PANTALON_INVIERNO_2`, al reimportar tiene que volver a caer en ella y no en `PANTALON_INVIERNO`); inactiva → `agrupacion_inactiva` sin crear una homónima.
15. Misma equivalencia dos veces: misma agrupación → `duplicada_en_archivo` con `fila_original`; distinta → `contradictoria_en_archivo` con `fila_original` y `detalle` = agrupación de la primera; en ambos casos se procesa solo la primera.
16. Equivalencia con otra agrupación en la base → cuenta en `reasignadas` y figura en `reasignaciones` con `de`/`a`; con la misma → `sin_cambio`; sin agrupación → `nuevas`. `reasignaciones` se corta en 500 entradas, pero `asignar.reasignadas` es el total.
17. Filas sobre nodos no vigentes o equivalencias inactivas → `nodo_inactivo` / `equivalencia_inactiva`, sin asignar. Los conteos cierran: `recibidas = procesadas + omitidas` y `procesadas = nuevas + reasignadas + sin_cambio`.

**`armar-arbol.ts` (M1, ampliado)**

18. `armarArbol(…, agrupaciones, opciones)` pone en cada equivalencia `agrupacion_estacionalidad` con `{ id, nombre, activo }` o `null`, y `resumen.equivalencias_sin_agrupacion` cuenta, entre las equivalencias devueltas, las que cumplen la regla 7 (usa `motivoFaltante` de `src/lib/estacionalidad/reglas.ts`). Los tests de M1 siguen pasando con `agrupaciones = []` (todas salen con `null`).

**Géneros de la agrupación (`0.6.0`)** — numeradas a continuación de las anteriores; las reglas 4 a 6 y 12 a 17 siguen valiendo tal cual.

*`esquemas.ts`*

19. `generoIds`: lista de UUID, **mínimo 1** ("Elige al menos un género."), máximo 50 y sin repetidos ("No repitas géneros."). `crearAgrupacionSchema` lo exige; `editarAgrupacionSchema` lo acepta opcional y, si viene, también exige al menos uno.

*`reglas.ts`*

20. `generoPermitido(agrupacion, generoId)` es verdadero solo si `genero_ids` incluye ese género; una agrupación sin géneros nunca lo permite.
21. Orden de rechazos de una asignación **individual** (`rechazoAsignacion`): agrupación inexistente (`404`) → inactiva (`409`, regla 4) → sin géneros (`409`, `motivoRechazoSinGenero`) → género no incluido (`409`, `motivoRechazoGeneroAsignacion`). Quitar (destino nulo) no comprueba nada. En la **masiva**, `rechazoDestinoAsignacion` comprueba solo las tres primeras (sobre el destino, sin mirar equivalencias) y rechaza todo; el género se resuelve fila a fila en la regla 22.
22. `planificarAsignacion(ids, encontradas, destino)` con `destino = { id, genero_ids }` o `null` (quitar): deduplica; los ids que no existen van a `no_encontradas`; las que ya tienen el destino cuentan `sin_cambio` (se evalúa **antes** que el género); las de un género que el destino no incluye van a `no_permitidas: { id, genero }` y **no abortan**; el resto va a `a_asignar`. Con destino nulo no hay `no_permitidas`.
23. `motivoRechazoGenerosPedidos(pedidos, existentes, agregar)`: algún género inexistente → `404 "Género no encontrado."`; algún género que se **agrega** está inactivo → `409`. Los géneros que la agrupación ya tenía y se conservan no se revisan (desactivar un género después no le quita la agrupación).
24. `diferenciaGeneros(actuales, pedidos)` da `agregar` y `quitar`. `motivoRechazoQuitarGeneros(agrupacion, quitados)` rechaza si algún género que se quita tiene equivalencias de ese género asignadas ("No se puede quitar HOMBRE de X: tiene 3 equivalencias de HOMBRE. Reasígnalas antes.", con "1 equivalencia" en singular); con todos en cero → `null`. El `PATCH` escribe primero los géneros nuevos y después borra los quitados, para no pasar por cero.
25. `generosDeAgrupacion(ids, generos)` devuelve `{ id, codigo, nombre }` ordenados por `orden, nombre` del género (el orden de los chips).

*`generos.ts` (presentación; repite lo que decide el servidor solo para no ofrecer destinos que fallarían)*

26. `agrupacionesParaGeneros` / `agrupacionesDestino`: agrupaciones **activas, con género, que incluyen todos** los géneros pedidos, por nombre; `agrupacionesDestino` suma el filtro de género a los géneros de la selección. Sin géneros pedidos devuelve todas las activas con género.
27. `ordenarPorNombre` / `compararPorNombre`: `localeCompare("es", { sensitivity: "base", numeric: true })` ("ASESORIA 2" antes de "ASESORIA 10"). `explicarSinDestinos` da el texto cuando no queda ningún destino (`mezcla`, `genero`, `ninguna`) y `avisoNoPermitidas` el de `no_permitidas`.

*`importar.ts`*

28. Una agrupación **existente** nunca amplía sus géneros: sin ninguno → `agrupacion_sin_genero`; sin el género de la fila → `genero_no_incluido`; ambas se evalúan después de `agrupacion_inactiva` y antes de la comprobación de duplicados. Una agrupación **nueva** se crea con los géneros distintos de las filas **procesadas** que le apuntan (en el orden del catálogo de géneros), de modo que nunca nace sin género; `AgrupacionNueva.genero_ids` y `muestra.agrupaciones[].generos` lo reflejan. `aplicarPlanEstacionalidad` reutiliza la existente por nombre sin tocar sus géneros. La idempotencia (regla 12) se mantiene.

*`consultas.ts`*

29. `cargarEstadoEstacionalidad` lee también `agrupacion_generos` (los vínculos); `agrupacionesConGeneros(estado)` los anexa a cada agrupación como `genero_ids` para el importador y para la lista plana.

## Hito de prueba

Con el árbol real cargado en `vector-two` (8 géneros · 5 mundos · 86 líneas · 556 nodos · 1 691 equivalencias reales + 265 genéricas = 1 956). Los conteos suponen que Javier no desactivó nada desde el cierre de M1; si lo hizo, los faltantes iniciales son 1 956 menos las equivalencias inactivas o en nodos no vigentes.

Cómo se recorre: en local (`INICIAR.cmd`) o en Railway una vez desplegado `0.4.0 · M3`, con dos sesiones (planner y comprador; el admin no hace falta para nada de M3). Los dos primeros puntos los cubrió QA el 2026-10-06; las reglas de API (404/409, `no_encontradas`, 2 001 ids, los 16 motivos del importador, idempotencia) están cubiertas por los 78 tests de `tests/estacionalidad.*` sobre un árbol de prueba (`tests/estacionalidad.fixture.ts`) y, cuando `datos/arbol-lineas.csv` existe, por un test que planifica "una agrupación por línea" sobre el árbol real en memoria (86 agrupaciones a crear, 1 956 asignaciones nuevas, segunda pasada sin ningún cambio). Lo que sigue solo se puede comprobar con la base real y lo recorre Javier en `/maestros/estacionalidad` y `/maestros/arbol`; donde dice `GET`/`POST`/`PATCH`, con el navegador o `curl`.

- [x] Checks automáticos: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (273 pruebas en 21 archivos: las 194 de M0–M2 más 78 en `tests/estacionalidad.*.test.ts` y un caso nuevo en `tests/nav.test.ts`) y `npm run build` en verde.
- [x] `0003_agrupaciones_estacionalidad.sql` aplicada dos veces en `vector-two` sin error y sin ningún `DROP`; tipos regenerados; `agrupaciones_estacionalidad` con RLS activo y sin políticas; `equivalencias.agrupacion_estacionalidad_id` existe, nullable, con su índice; `APP_VERSION` = `0.4.0 · M3`.
- [ ] Solo con la base real: ninguna equivalencia existente cambió al migrar (`select count(*) from equivalencias` igual que antes, todas con la columna en `null`); `GET /api/agrupaciones-estacionalidad` devuelve `[]` (sin seed); `GET /api/estacionalidad/faltantes` devuelve 1 956 filas con `motivo_faltante = sin_agrupacion`, de las que 265 son genéricas; el resumen de `/maestros/estacionalidad` dice `1 956 equivalencias · 0 con agrupación · 1 956 faltantes (265 genéricas)` y la pestaña se llama "Faltantes (1 956)".
- [ ] Menú: admin y planner ven "Agrupaciones de estacionalidad" habilitado; el comprador no lo ve y `/maestros/estacionalidad` le redirige a `/`; `POST /api/agrupaciones-estacionalidad` le responde `403`. Como planner, todo lo de abajo funciona (no hace falta admin para nada de M3). La página de inicio enlaza M1, M2 y M3 a su pantalla según el rol.
- [ ] Agrupaciones: crear `  pantalones   invierno ` → se guarda `PANTALONES INVIERNO` con código `PANTALONES_INVIERNO`; crear otra en minúsculas con el mismo nombre → `409`; crear `Pantalones-Invierno` (distinto nombre, mismo código derivado) → `409` por código, y con código editado a `PANT_INV_2` → ok. Editar descripción y orden en línea; reordenar y ver el orden reflejado en los `Select` de Asignación y del árbol.
- [ ] Árbol: en HOMBRE / URBANO / PANTALON la columna Equivalencias muestra "Sin agrupación" en cada fila; elegir una agrupación en el `Select` de JOGGER la guarda al instante y el badge cambia; la genérica SIN EQUIVALENCIA también acepta agrupación; el contador "N sin agrupación" del nodo baja en 2; `GET /api/arbol` trae `agrupacion_estacionalidad: { id, nombre, activo }` en esas dos y `null` en el resto; el comprador ve los badges y ningún `Select`.
- [ ] Asignación por árbol: filtrar Género HOMBRE + Línea PANTALON (todos los mundos) → aparecen las equivalencias de los nodos HOMBRE / * / PANTALON; "seleccionar las N filtradas" + Asignar a PANTALONES INVIERNO → `confirm` con el conteo y "M de ellas ya tienen otra agrupación y cambiarán" (las 2 del paso anterior si se eligió otra) → la tabla se recarga con el badge y el resumen baja; la fila de la agrupación en la pestaña Agrupaciones muestra `N equivalencias` y el enlace abre la vista Por agrupación filtrada. Los chips de estado de Por árbol dicen Todas · Faltantes · Con agrupación activa.
- [ ] Por agrupación: en PANTALONES INVIERNO seleccionar 3 y "Mover a" otra agrupación; seleccionar 1 y "Quitar agrupación" → vuelve a Faltantes con motivo "Sin agrupación".
- [ ] Regla de inactiva: desactivar una agrupación con equivalencias → `confirm` dice cuántas quedarán como faltantes; tras aceptar, esas equivalencias aparecen en Faltantes con el chip "Agrupación inactiva (N)" y en el árbol con badge "X · inactiva"; intentar asignar a esa agrupación desde el `Select` del árbol (no aparece) o por API (`PATCH` / `asignar` con su id) → `409` legible; reactivarla → desaparecen de Faltantes sin tocar nada más.
- [ ] Eliminar: una agrupación con equivalencias → botón deshabilitado y `DELETE` por API → `409` con el conteo; una recién creada y vacía → se elimina.
- [ ] `PATCH /api/equivalencias/[id]` con un UUID que no existe como agrupación → `404`; con `null` → quita; `POST /api/estacionalidad/asignar` con un id de equivalencia inventado entre otros válidos → `200` con ese id en `no_encontradas` y el resto asignado (la pantalla avisa "la lista estaba desactualizada y se recargó"); con `agrupacion_id` de una inactiva → `409`; con 2 001 ids → `400`. (Las reglas puras detrás de estas respuestas ya están en tests; aquí se comprueba el handler contra la base.)
- [ ] Importar: descargar "Faltantes (CSV)" desde la pestaña Faltantes (con el filtro de género en MUJER baja solo ese género), completar la columna AGRUPACION en Excel para un subconjunto, guardar como `.xlsx` y subirlo: el mapeo se autodetecta; **Previsualizar** lista las agrupaciones a crear con su conteo, las asignaciones nuevas, cero reasignaciones y las filas con AGRUPACION vacía en "Filas con errores" como `Agrupación vacía` (no bloquean el resto); **Aplicar** → el reporte final coincide; Faltantes baja exactamente en las procesadas.
- [ ] Reimportar el mismo archivo: todo en `sin_cambio`, `crear.agrupaciones = 0`, "Nada que cambiar"; los conteos de la base no se mueven. Cambiar en el archivo la agrupación de 5 filas y reimportar: previsualización con 5 en "Cambian de agrupación" con de → a; aplicar las cambia y solo a ellas.
- [ ] Importar un archivo con una fila cuyo equivalencia no existe (`JOGER`), una con mundo vacío, una con línea inexistente y dos filas de la misma equivalencia con agrupaciones distintas: las cuatro salen en "Filas con errores" con sus motivos (`Equivalencia desconocida`, `Mundo vacío`, `Línea desconocida`, `Contradictoria en el archivo` con la fila original), nada de eso se crea ni se asigna, y "Descargar omitidas (CSV)" las baja con la columna Agrupación.
- [ ] Cierre del hito: asignar el resto (a mano o por archivo) hasta que la pestaña Faltantes muestre el `EmptyState` "Toda equivalencia activa tiene agrupación"; `GET /api/estacionalidad/faltantes` devuelve `[]` y `resumen.faltantes = 0`; el resumen del árbol dice `0 sin agrupación`.
- [ ] Solo con la base real: `GET /api/estacionalidad/equivalencias` y `GET /api/arbol` responden en menos de 2 s con el árbol real, y la tabla de Asignación con las 1 956 filas se filtra sin notarse lenta (si se nota, se pagina en cliente de a 200, como preveía la ficha).
- [x] `APP_VERSION` subida a `0.4.0 · M3` (M2 cierra en `0.3.0 · M2`); queda por verla al pie del menú en Railway tras el deploy.

### Cambio de géneros (`0.6.0 · M3`)

Con las agrupaciones que Javier ya creó en la base real. Lo marcado lo cubrió QA el 2026-10-06; lo demás solo se puede comprobar con la base real y lo recorre Javier en `/maestros/estacionalidad` y `/maestros/arbol`.

- [x] Checks automáticos: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (444 pruebas en 31 archivos) y `npm run build` en verde. Los handlers no tienen tests propios: QA los probó contra un stub de Supabase; las reglas puras sí están cubiertas.
- [x] `0005_agrupacion_estacionalidad_genero.sql` aplicada dos veces en `vector-two` sin error y sin `DROP`, `DELETE` ni `TRUNCATE`; tabla con RLS activo y sin políticas; `APP_VERSION` = `0.6.0 · M3`.
- [ ] Backfill: ASESORIA 1 y TES HO INV PESADO muestran **HOMBRE**; AASE_INVIERNO y TES HO INV LIGERO muestran el badge **"Sin género"** con la fila resaltada en Agrupaciones; el Mapa avisa arriba de las dos y su botón Asignar está deshabilitado; una asignación existente no cambió (los conteos del Mapa son los de antes).
- [ ] **Ponerle género a las dos heredadas**: en Agrupaciones, "Asignar géneros" en AASE_INVIERNO y en TES HO INV LIGERO (los géneros que correspondan); el badge y el aviso del Mapa desaparecen y Asignar se habilita.
- [ ] Alta: crear una agrupación sin marcar ningún género → "Crear" deshabilitado ("Elige al menos un género."); con uno o varios → se crea con sus chips. Por API, `POST` sin `genero_ids` → `400`, con un UUID inventado → `404`.
- [ ] Edición de géneros: añadir MUJER a una agrupación de HOMBRE → queda con los dos; quitar un género que **no** tiene equivalencias asignadas → ok; quitar HOMBRE de una agrupación que tiene equivalencias de HOMBRE → `409` "tiene N equivalencias de HOMBRE. Reasígnalas antes."; intentar dejar cero géneros → "Elige al menos un género.".
- [ ] **Intentar asignar fuera de género**: por API, `PATCH /api/equivalencias/[id]` de una equivalencia de MUJER hacia una agrupación solo de HOMBRE → `409` "no incluye el género MUJER"; hacia una sin género → `409` "no tiene géneros"; `POST /api/estacionalidad/asignar` con una selección mezclada de HOMBRE y MUJER hacia una agrupación solo de HOMBRE → `200` con las de MUJER en `no_permitidas` y las de HOMBRE asignadas. En la pantalla, el árbol no ofrece esas agrupaciones en el selector de la equivalencia.
- [ ] **Filtrar género y ver solo las que aplican**: en Asignación · Por árbol, con Género = MUJER, la leyenda y el selector "Asignar a" muestran solo las agrupaciones activas que incluyen MUJER, en orden alfabético; con Género = HOMBRE cambian; con un género que ninguna incluye, el selector dice que ninguna agrupación activa lo incluye y enlaza a Agrupaciones. Lo mismo en Faltantes y en "Mover a" de Por agrupación.
- [ ] Orden alfabético: "ASESORIA 2" aparece antes que "ASESORIA 10" en leyenda, selectores, tarjetas del Mapa, selector del árbol y tabla de Agrupaciones, sin acentos ni mayúsculas de por medio; los colores de cada agrupación no cambiaron.
- [ ] Eliminar un género que tiene agrupaciones (solo con admin, por API o desde Catálogos) → `409` "tiene agrupaciones de estacionalidad asignadas"; una agrupación vacía se elimina y sus vínculos se van con ella.
- [ ] Importar: subir un archivo con una fila de MUJER hacia una agrupación existente solo de HOMBRE (sale `genero_no_incluido`), una hacia una agrupación sin género (`agrupacion_sin_genero`) y filas de HOMBRE y MUJER hacia un nombre nuevo: la previsualización muestra la agrupación nueva con **HOMBRE, MUJER** en la columna Géneros; al aplicar se crea con esos dos géneros y las dos filas omitidas no se asignan; reimportar el mismo archivo no cambia nada nuevo.

## Fuera de alcance

- **Cálculo de curvas** (promedios mensuales, índices, tratamiento de años Niño): M6. Esta ficha solo decide que la unidad de la curva es la agrupación.
- **Carga de venta y stock histórico**: M5. El reporte de faltantes de M3 es estructural (equivalencia sin agrupación), no "equivalencia sin venta".
- Si la curva es por agrupación o por agrupación × tienda: lo decide M6 (pregunta abierta 3); M3 no necesita saberlo porque la asignación equivalencia → agrupación es la misma en ambos casos.
- Temporada (Verano / Invierno / Todo el año) a nivel de agrupación: hoy vive en la línea (M1). Si M6 la necesita por agrupación, es una columna por migración (pregunta abierta 6).
- Agrupaciones jerárquicas o una equivalencia en varias agrupaciones con pesos: no; una equivalencia, una curva.
- Que el importador cree líneas, nodos o equivalencias (es el del árbol), quite agrupaciones (es la pantalla) o **amplíe los géneros de una agrupación existente** (se decide desde Agrupaciones).
- Una agrupación sin género "para todos": no existe; o tiene géneros o no acepta asignaciones.
- Marcas (M2) y tiendas (M4). El vínculo marca ↔ equivalencia no interviene en la estacionalidad.
- Auditoría de quién asignó qué (pendiente desde M0).
- Reporte de "agrupaciones sin venta" o con pocas equivalencias para fusionar: útil, pero necesita M5.

## Decisiones nuevas que propone esta ficha

Las cuatro primeras se registraron en `docs/DECISIONES.md` el 2026-10-06 al cerrar el módulo (más otra que salió de la construcción: el importador resuelve por nombre antes que por código):

1. **Agrupaciones de estacionalidad sin seed; nombres del negocio.** No se crea ninguna por migración, ni una "GENERAL": un comodín inventado esconde el reporte de faltantes, que es la herramienta del módulo.
2. **Faltante = equivalencia activa y vigente sin agrupación activa.** Incluye las genéricas (su venta existe) y las que apuntan a una agrupación desactivada. Desactivar una agrupación no toca sus equivalencias; reactivarla las devuelve completas.
3. **El importador de estacionalidad crea agrupaciones pero no toca el árbol.** Crea las agrupaciones que no existan (son del planner, no catálogo raíz) y las lista en la previsualización; nunca crea líneas, nodos ni equivalencias, nunca cambia `activo` y nunca quita una agrupación. El archivo manda en las reasignaciones y la previsualización las muestra una por una.
4. **Guard de escritura `requirePlanner` para todo M3**, incluido el catálogo de agrupaciones: es trabajo de planificación, como las líneas.

Registradas el 2026-10-06 con el cambio de géneros (`0.6.0`), también en `docs/DECISIONES.md`:

5. **Una agrupación pertenece a uno o más géneros y solo acepta equivalencias de sus géneros.** Se descartó que el género fuera solo informativo.
6. **El backfill parte de las asignaciones existentes**; las agrupaciones sin equivalencias quedan "sin género" y no se les inventa uno.
7. **La regla de género vive en backend y pantalla**, porque no cabe en un `check` ni en una FK.
8. **El importador no amplía los géneros de una agrupación existente.**
9. **Las listas de agrupaciones van en orden alfabético**; `orden` ya no manda ahí, pero los colores siguen por `orden, nombre`.
10. **Los filtros `.in(...)` van en tandas de 150 ids.**

## Preguntas abiertas para Javier

1. **La lista.** ¿Ya tienes las agrupaciones de estacionalidad y a qué equivalencias va cada una? Si sí, ¿en qué formato (¿una columna más en el archivo del árbol?)? El importador acepta `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION`, con las mismas reglas que el árbol (`-` = igual a la línea, vacío = genérica). Si no la tienes, la pestaña Faltantes y el CSV descargable están pensados para armarla.
   **Resuelta (2026-10-06).** No hay lista previa: Javier construye las agrupaciones y la asignación dentro del sistema, con las pestañas Agrupaciones, Asignación y Faltantes. El importador queda como apoyo opcional. Registrado en `DECISIONES.md`.
2. **La genérica `SIN EQUIVALENCIA`.** La ficha propone que lleve agrupación como cualquier otra (su venta existe y M7 tiene que proyectarla). ¿De acuerdo, o prefieres que las 265 genéricas queden fuera del reporte de faltantes y se proyecten de otra forma?
3. **Grano de la curva (afecta solo a M6).** ¿La curva será una por agrupación para toda la red, o por agrupación × tienda (como en Vector-One, que calculaba por tienda / marca / género / línea)? Si es por tienda, M6 necesita suficiente historia por tienda y M4 (aperturas) para las tiendas nuevas; la asignación de M3 es la misma en ambos casos.
   **Resuelta en parte (2026-10-06).** Las curvas se calculan sobre la venta real cuando exista (M5 → M6); M3 no guarda ni calcula curvas. El grano (agrupación o agrupación × tienda) sigue abierto y se decide al especificar M6.
4. **Reasignar desde el archivo.** Decidimos que, si una fila del archivo trae una agrupación distinta de la que la equivalencia ya tiene, el archivo manda (y la previsualización lo muestra). ¿Prefieres que esas filas se omitan y haya que cambiarlas a mano?
5. **Obligatoria al crear.** Hoy una equivalencia nueva (desde el árbol o desde el importador del árbol) nace sin agrupación y aparece en Faltantes. ¿Quieres que al crear una equivalencia a mano la agrupación sea obligatoria? Se decidió que no, para no frenar la carga del árbol, pero es un `Select` más en el formulario.
6. **Temporada.** En Vector-One el tratamiento de años Niño dependía de `linea.temporada` (Invierno). Si la curva pasa a ser por agrupación, ¿la temporada debería vivir en la agrupación (p. ej. "PANTALONES INVIERNO" es de invierno) además de o en vez de en la línea? Solo para dejar lista la columna; no bloquea M3.
7. **Nombre en el menú.** "Agrupaciones de estacionalidad" (completo) o "Estacionalidad" (corto, y en Fase 2 la misma entrada podría llevar también a las curvas).

## Cambios respecto a la especificación

Lo que backend, frontend y QA construyeron distinto de lo escrito arriba, o que la especificación no decía. Nada de esto cambia el hito ni los contratos de API; el cuerpo de la ficha ya está corregido donde hacía falta y aquí queda el porqué.

1. **La pestaña Faltantes no llama a `/faltantes`.** El panel carga una sola vez `GET /api/estacionalidad/equivalencias` y Faltantes son las filas con `faltante: true` de esa misma lista; así las tres pestañas (resumen, Asignación y Faltantes) ven el mismo estado y una asignación recarga una sola cosa. `GET /api/estacionalidad/faltantes` existe igual, con el contrato de la ficha, porque `resumen.faltantes = 0` es la forma de comprobar el hito por API.
2. **El resumen se calcula en memoria sobre las activas y vigentes.** Con "Mostrar inactivas" encendido la lista trae más filas, pero el resumen de arriba no cambia: cuenta solo las activas en nodo vigente, igual que `resumen` de la API sin `incluir_inactivos`. Si contara lo visible, "N equivalencias" bailaría con el interruptor y Javier no sabría cuál es el total real.
3. **"Mostrar inactivas" vive en la cabecera de Asignación**, junto a los chips Por árbol / Por agrupación, y vale para las dos vistas; la ficha lo ponía dentro de los filtros de Por árbol. Por agrupación también lo necesita: una agrupación con `equivalencias > 0` pero todas inactivas se ve vacía y el `EmptyState` lo dice ("activa Mostrar inactivas para verlas").
4. **Los chips de estado y el contador por nodo usan la regla 7.** En Por árbol los chips se llaman Todas · Faltantes · Con agrupación activa (la ficha decía "Sin agrupación" y "Con agrupación"), y el "N sin agrupación" de la columna Líneas del árbol cuenta las activas sin agrupación o con agrupación inactiva, no solo las `null`. Así los números de la pantalla, del árbol y del resumen de `/api/arbol` cuentan lo mismo.
5. **"Descargar faltantes (CSV)" exporta lo filtrado.** La ficha no decía si bajaba todo o lo visible; baja las filas que pasan los filtros vigentes (género, mundo, línea, texto, motivo, tipo), que es lo que hace útil trabajar la clasificación por partes en Excel. Sin filtros, baja todo.
6. **`cargarEstadoArbol` no se toca; existe `cargarEstadoEstacionalidad`.** En `src/lib/estacionalidad/consultas.ts`, lee las cinco tablas del árbol con la función de M1 más `agrupaciones_estacionalidad` completa. La usan `GET /api/arbol`, la lista plana, los faltantes y el importador; M1 sigue intacto.
7. **`armarArbol` recibe `agrupaciones` como sexto parámetro y las opciones como séptimo.** La ficha decía "un sexto parámetro" sin fijar dónde quedaban las opciones. Los tests de M1 pasan `[]`.
8. **`aplanarEquivalencias` tiene la opción `soloFaltantes`.** La ficha preveía dos lecturas sobre una función; en la práctica es una función con un filtro más, y `/faltantes` la llama con `soloFaltantes: true`. El resumen cuenta lo devuelto en ambos casos.
9. **Los catálogos de la lista plana viajan completos**, activos e inactivos, y los `Select` de filtro marcan "(inactivo)". Sin eso, con "Mostrar inactivas" una fila "Oculta por mundo inactivo" no podría decir qué mundo.
10. **El importador resuelve agrupaciones por nombre normalizado antes que por código**, al revés de `buscarEnCatalogo` de M1 (código primero). Dos nombres distintos pueden derivar al mismo código (regla 14: la segunda recibe `_2`); si al reimportar se buscara por código primero, "PANTALON-INVIERNO" caería en `PANTALON_INVIERNO` en vez de en su propia `PANTALON_INVIERNO_2` y la segunda pasada reasignaría. Registrado en `DECISIONES.md`.
11. **Los duplicados del archivo se detectan antes de registrar la agrupación nueva.** Si la única fila que nombra una agrupación es una contradictoria, esa agrupación no se crea; antes la previsualización la habría listado con 0 equivalencias.
12. **`PATCH /api/equivalencias/[id]` solo lee las hermanas cuando cambia nombre, código o `activo`.** Un `PATCH` que solo trae `agrupacion_estacionalidad_id` (el `Select` del árbol) no necesita la regla de unicidad del nodo, así que se ahorra esa lectura; sí lee la agrupación para responder `404`/`409` antes del `update`.
13. **`AsignacionPlan.tipo` ("nueva" | "reasignada").** El plan del importador anota de qué tipo es cada asignación para que, al aplicar, los conteos `asignar.nuevas` y `asignar.reasignadas` sean lo realmente escrito (contado fila a fila sobre lo que devuelve el `update`) y no lo planificado.
14. **`agrupacion_vacia` sale en "Filas con errores".** La ficha lo describía como "informadas, no bloquean"; en la pantalla va con los errores corregibles, con su chip y en el CSV de omitidas, porque es exactamente lo que hay que completar en el archivo. Sigue sin bloquear el resto de filas.
15. **`PestanaEstacionalidad` vive en `src/lib/estacionalidad/pestanas.ts`.** El Server Component de la página valida `?pestana=` y necesita la lista de valores; un export de un módulo `"use client"` llega al servidor como referencia, no como valor, y `.includes` no existe. De ahí el módulo aparte sin `"use client"`.
16. **El catálogo de agrupaciones del árbol se carga una vez por página** (`arbol-panel.tsx`, con inactivas), no por columna ni por nodo; si falla, la columna muestra solo el badge y un aviso con "Reintentar".
17. **El `confirm` de desactivar usa `equivalencias_activas`.** El listado del catálogo trae `equivalencias` (todas) y `equivalencias_activas` (gracias a `claveActivos` del helper, como `marcas_activas` en M2); el aviso dice cuántas pasarán a faltantes, que son solo las activas.
18. **Menú: "Agrupaciones de estacionalidad"**, la forma completa; la pregunta abierta 7 sigue abierta por si Javier prefiere la corta.
19. **Piezas nuevas compartidas.** `src/components/ui/checkbox.tsx` (con estado indeterminado para la cabecera), `src/components/estacionalidad/badge-agrupacion.tsx` (el mismo badge en el árbol y en la lista plana) y `src/components/importador/csv.ts` (descarga de CSV con BOM, extraída del reporte del importador). `CatalogoPlano` ganó tres props opcionales sin cambiar M1 ni M2: `descripcion` (campo en el alta y columna editable en línea), `hijos.render` (el conteo como enlace) y `avisoSoloLectura` (el texto para el rol que no edita, porque aquí quien no edita es el comprador y no "lo gestiona un administrador").

### Del cambio de géneros (`0.6.0`)

El cuerpo de la ficha ya describe lo construido; aquí queda lo que se apartó de lo previsto o no estaba dicho.

20. **Handlers propios para las agrupaciones, no el catálogo genérico.** `GET`, `POST` y `PATCH` de `/api/agrupaciones-estacionalidad` viven en `src/lib/estacionalidad/agrupaciones.ts`: crear y editar escriben en dos tablas y validan géneros antes de escribir, y las respuestas llevan `genero_ids` y `generos`. `DELETE` sigue con `eliminarDeCatalogo`. Es el camino que ya siguió M2 con las marcas. Registrado en `DECISIONES.md` junto con la regla de género.
21. **Tandas de 150 en los filtros `.in("id", …)`, no de 500.** La asignación masiva y el importador usaban 500; con 500 UUID la URL de la petición pasa de 18 KB y el gateway puede rechazarla. `TANDA_IN = 150` (en `src/lib/arbol/importar.ts`) se aplica a la lectura y a la escritura de ambos. Las inserciones de agrupaciones nuevas siguen en tandas de 500, porque no llevan ids en la URL. Registrado en `DECISIONES.md`.
22. **`rechazoAsignacion` y `rechazoDestinoAsignacion` reemplazan a `motivoRechazoAsignacion` en los handlers.** Esa función (regla 4) se conserva y se reutiliza dentro de ellas; el handler de `PATCH /api/equivalencias/[id]` ya no la llama directamente.
23. **El `PATCH` de géneros también rechaza agregar un género inactivo** (`409`), igual que el `POST`; el pedido de Javier no lo decía. Los géneros que la agrupación ya tenía se conservan aunque se desactiven después.
24. **El selector Por agrupación con "Todos" muestra también las inactivas o sin género que tengan equivalencias**, marcadas, aunque el resto de selectores solo ofrezca las activas que aplican: sin eso, una agrupación heredada con equivalencias asignadas no se podría ver ni vaciar desde esa vista.
25. **El destino elegido se conserva en el estado de la pantalla** aunque la selección o el filtro lo dejen fuera de la lista, y reaparece si vuelven a ser compatibles.
26. **Los chips de género de cada agrupación van por el `orden` del género**, no alfabéticos, como el resto de listas de géneros del sistema; solo las agrupaciones se ordenan por nombre. El segmento de cobertura por género del Mapa sigue `orden, nombre`.
27. **Piezas nuevas compartidas.** `src/components/ui/chips-multiples.tsx` (selector múltiple de chips), `CatalogoPlano` con las props opcionales `generos` y `ordenar`, `DataTable` con la prop opcional `claseFila` (resaltado de las filas sin género), y la lógica pura de `generos.ts`. Ninguna cambia el comportamiento de M1 ni M2.

## Limitaciones conocidas

Del cambio de géneros (`0.6.0`). Ninguna bloquea el hito; se anotan para que nadie las descubra por sorpresa.

- **Sin transacción**, como en todo el módulo (supabase-js no las expone). Consecuencias concretas:
  - La compensación del `POST` de agrupaciones y la del importador (borrar la agrupación recién creada si falla el insert de sus vínculos) **ignoran el error si ese `delete` también falla**: quedaría una agrupación sin género y sin ningún aviso. Es el mismo estado que las heredadas; se ve en la pantalla con su badge "Sin género".
  - Una asignación concurrente que llegue entre la validación y el borrado de un género de una agrupación puede dejar una equivalencia en una agrupación que ya no incluye su género.
  - Si otra sesión crea el mismo nombre de agrupación a mitad de un import, las asignaciones de esas filas se escriben **sin comprobar géneros** (el plan las hizo contra una agrupación que todavía no existía). Aceptable con un solo planner.
- **El `PATCH` individual y la asignación masiva difieren en un caso.** Una equivalencia ya asignada a una agrupación cuyo género se le quitó después: el `PATCH` la rechaza con `409` si se repite la misma agrupación, mientras la masiva la cuenta `sin_cambio` (se evalúa antes que el género). No se alcanza desde la pantalla, porque el `PATCH /api/agrupaciones-estacionalidad/[id]` ya no deja quitar un género con equivalencias de ese género.
- **Presentación.** En la tabla de Agrupaciones el nombre se parte en dos líneas (la columna Géneros ocupa el ancho), y en el árbol el selector más el badge de agrupación puede forzar scroll horizontal en pantallas angostas.
- **No hay tests de los handlers**, solo de las funciones puras (444 pruebas en 31 archivos); QA probó los handlers contra un stub de Supabase.
- **No probado contra Supabase real**: el embed de vínculos en `leerDestino` (`agrupacion_estacionalidad_genero(genero_id)`), el `upsert … onConflict` sobre el índice único de la pareja (solo se corrió contra el Postgres local con `scripts/validar-migraciones-local.sh`) y el límite de URL del gateway con las tandas de 150. Es lo primero que conviene mirar si algo falla al recorrer el hito.
- **`PATCH /api/arbol/nodos/[id]` no cambia el género del nodo** (solo el mundo): por eso ninguna ruta de M1 puede dejar una equivalencia fuera del género de su agrupación. Si algún día se permite mover un nodo de género, esa ruta tendrá que aplicar la regla.

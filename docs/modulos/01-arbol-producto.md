# M1 · Árbol de producto

> Estado: **construido, pendiente de recorrer el hito contra la base real** (el proyecto Supabase aún no existe). Lint, typecheck, 110 tests, build y `scripts/validar-migraciones-local.sh` en verde. Módulo anterior: [00-cimientos](00-cimientos.md). Reglas de base en `docs/PLAN.md` §4 y `docs/DECISIONES.md`. Lo que se construyó distinto de lo especificado está en "Cambios respecto a la especificación", al final.

## Objetivo

Dar al planner el árbol real con el que Lukers planifica —Género → Mundo → Línea → Equivalencia— como maestro editable y navegable, cargado de una vez desde el archivo que entregó Javier (`datos/arbol-lineas.csv`, 2 002 filas) y mantenido después desde la pantalla. Todo lo que viene (marcas, estacionalidad, ventas, proyección) cuelga de este árbol, así que M1 fija el grano y el vocabulario. Las agrupaciones de talla entran como catálogo fijo de dos valores: Javier entregará venta y stock ya consolidados por agrupación, así que no hay tallas individuales que modelar.

## Modelo de datos

Migración `supabase/migrations/0001_arbol_producto.sql`, idempotente, sin bloques `do $$`. Todas las tablas: `id uuid primary key default gen_random_uuid()`, `activo boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` con `public.tg_set_updated_at()` (ya existe desde M0), `enable row level security` sin políticas.

### Convenciones comunes a los nombres y códigos

- `nombre` se guarda **normalizado**: Unicode NFC, `trim`, espacios internos colapsados a uno, mayúsculas con reglas de español (`toLocaleUpperCase("es")`, así `ñ → Ñ`). Lo garantiza zod en todos los endpoints de escritura y el importador; la base solo exige longitud 1–120.
- `codigo` es un identificador corto estable, ASCII: se deriva del nombre quitando acentos, `Ñ → N`, cualquier otro carácter no alfanumérico pasa a `_`, se colapsan `_` repetidos y se recortan los de los bordes. Máximo 40 caracteres. Ejemplos: `NIÑAS → NINAS`, `SIN ASIGNAR → SIN_ASIGNAR`, `POLO M/C → POLO_M_C`, `H → H`. Se propone al crear y el usuario puede cambiarlo; una vez creado, cambiarlo es raro (lo usarán futuros códigos PIVOT y abreviaturas, como en V1, donde las abreviaturas eran ASCII).
- Un campo `orden integer not null default 0` en los catálogos que se muestran como lista fija (géneros, mundos, agrupaciones de talla). Las líneas y equivalencias se ordenan alfabéticamente.

### `generos`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | único (`unique index on upper(codigo)`) |
| `nombre` | `text not null` | único (`unique index on nombre`), `check (length(nombre) between 1 and 120)` |
| `orden` | `integer not null default 0` | |

Seed (`insert … on conflict (codigo) do nothing`), en este orden de pantalla:

| codigo | nombre | orden |
|---|---|---|
| `H` | HOMBRE | 10 |
| `M` | MUJER | 20 |
| `JOVENCITOS` | JOVENCITOS | 30 |
| `JOVENCITAS` | JOVENCITAS | 40 |
| `NINOS` | NIÑOS | 50 |
| `NINAS` | NIÑAS | 60 |
| `BEBE` | BEBE | 70 |
| `OTROS` | OTROS | 80 |

Por qué no se agrupan en Hombre / Mujer / Infantil: el archivo trae los 8 valores planos y la Fase 2 proyecta al grano del archivo. Si hace falta agrupar, será una columna `grupo` en una migración posterior (pregunta abierta).

### `mundos`

Misma estructura que `generos` (`codigo`, `nombre`, `orden`, mismos únicos). Seed:

| codigo | nombre | orden |
|---|---|---|
| `CASUAL` | CASUAL | 10 |
| `URBANO` | URBANO | 20 |
| `DEPORTIVO` | DEPORTIVO | 30 |
| `FORMAL` | FORMAL | 40 |
| `RI` | RI | 50 |
| `SIN_ASIGNAR` | SIN ASIGNAR | 999 |

`SIN ASIGNAR` es un mundo normal (activo) con un significado especial para el importador: ahí caen las líneas cuyo mundo viene vacío. No hay tabla género-mundo: **todo mundo existe en todo género** (decisión registrada); la pantalla y `/api/arbol` lo reflejan devolviendo los 6 mundos bajo cada género aunque no tengan líneas.

### `lineas`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | único (`upper(codigo)`) |
| `nombre` | `text not null` | único, `check (length between 1 and 120)` |
| `temporada` | `text not null default 'Todo el año'` | `check (temporada in ('Verano','Invierno','Todo el año'))` |

La Línea es **catálogo**: PANTALON existe una sola vez aquí aunque esté en 26 cruces género-mundo. El archivo no trae temporada; todas se crean con `Todo el año` y Javier las ajusta desde la pantalla (pregunta abierta).

### `genero_mundo_linea` (el "nodo")

| Columna | Tipo | Notas |
|---|---|---|
| `genero_id` | `uuid not null references generos(id) on delete restrict` | |
| `mundo_id` | `uuid not null references mundos(id) on delete restrict` | |
| `linea_id` | `uuid not null references lineas(id) on delete restrict` | |

Índices: `unique (genero_id, mundo_id, linea_id)` (cubre las búsquedas por género y género-mundo), `index (linea_id)` ("¿en qué nodos está PANTALON?"), `index (mundo_id)` (listar lo que quedó en SIN ASIGNAR).

`activo = false` en el nodo significa "esta línea ya no se trabaja en este género-mundo"; no toca la línea del catálogo ni sus otros nodos.

### `equivalencias`

| Columna | Tipo | Notas |
|---|---|---|
| `genero_mundo_linea_id` | `uuid not null references genero_mundo_linea(id) on delete restrict` | |
| `codigo` | `text not null` | `check (length between 1 and 40)` |
| `nombre` | `text not null` | `check (length between 1 and 120)` |
| `es_generica` | `boolean not null default false` | ver abajo |

Índices: `unique (genero_mundo_linea_id, nombre)`, `unique (genero_mundo_linea_id, codigo)`, y un único parcial `unique (genero_mundo_linea_id) where es_generica` que garantiza **a lo sumo una genérica por nodo**. El código es único **dentro del nodo**, no global: VARIOS aparece en 69 nodos y PACK o JOGGER en varios; un futuro código PIVOT concatenará género-mundo-línea-equivalencia, así que no necesita unicidad global.

**`es_generica`.** En el archivo, 277 filas traen equivalencia vacía y 308 traen `-`; las dos significan "sin equivalencia definida". Como en la Fase 2 las ventas llegarán igual y tienen que caer en algún sitio, el importador crea en cada nodo que lo necesite **una** equivalencia `SIN EQUIVALENCIA` (`codigo = SIN_EQUIVALENCIA`, `es_generica = true`). La bandera distingue esa fila de una equivalencia real que alguien quisiera llamar parecido, y permite a M3 y a los reportes tratarla aparte (por ejemplo, no exigirle curva o listarla como "pendiente de clasificar").

`agrupacion_estacionalidad_id` **no** se agrega aquí: la añade M3.

### `agrupaciones_talla`

`codigo`, `nombre`, `orden` con los mismos únicos que `generos`. Seed: `CENTRALES` / "Tallas centrales" / 10 y `EXTREMAS` / "Tallas extremas" / 20.

Es un **catálogo plano y cerrado**: no se relaciona con equivalencias ni con marcas. Javier confirmó que no habrá tabla de tallas individuales ni mapeo talla → agrupación: la venta y el stock llegarán en Fase 2 ya consolidados por agrupación de talla, y ahí será una columna más (`agrupacion_talla_id`) de las filas de venta/stock. Por eso en M1 solo tiene seed y lectura: un tercer valor o un renombre hecho desde la pantalla rompería la correspondencia con los archivos consolidados; si algún día cambia, es una migración con su entrada en DECISIONES.

### Borrado y desactivación

Regla única para las seis tablas: **la acción normal es desactivar**; eliminar solo se permite cuando la fila no tiene hijos, y lo hace cumplir la base con `on delete restrict`. El handler traduce la violación de FK (`23503`) a `409 "No se puede eliminar: tiene N registros asociados. Desactívalo."` y la de único (`23505`) a `409 "Ya existe …"`. En M1 una equivalencia nunca tiene hijos, así que sí se puede eliminar; dejará de poderse cuando M2 cuelgue `equivalencia_marca` y la Fase 2 cuelgue ventas.

Desactivar **no** se propaga en cascada en la base: desactivar el mundo FORMAL deja sus nodos con `activo = true` pero el árbol los oculta porque la vigencia efectiva de un nodo es `nodo.activo ∧ genero.activo ∧ mundo.activo ∧ linea.activo` (función pura `nodoVigente`, ver Reglas). Reactivar el mundo los devuelve tal cual estaban, sin perder qué nodos sí se habían desactivado a mano.

## Contratos de API

Todos devuelven `{ data }` con `ok()` o `{ error }` con `error()` de `src/lib/api/respuestas.ts`; cuerpos validados con `leerCuerpo` y esquemas zod en `src/lib/arbol/esquemas.ts`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod · `404` id inexistente o que no es un UUID (`idDeRuta` lo valida antes de consultar) · `409` regla de negocio o unicidad/FK · `500` error de base no previsto, con el mensaje genérico "Error inesperado en la base de datos." y el detalle solo en el log del servidor. El helper compartido `src/lib/api/errores-db.ts` → `traducirErrorDb(err)` mapea `23505 → 409`, `23503 → 409`, `23514 (check) → 400`, resto `500`; lo usan todos los handlers de M1 y los módulos siguientes.

Las lecturas aceptan `?incluir_inactivos=1`; por defecto devuelven solo `activo = true`. Toda lectura que pueda crecer pasa por `leerTodo` (`src/lib/arbol/consultas.ts`), que pagina de a 1 000 filas porque PostgREST corta ahí por defecto. Los catálogos planos comparten el CRUD de `src/lib/api/catalogo.ts`, configurado por recurso en `src/lib/arbol/catalogos.ts`.

### Catálogos planos (mismo patrón, tres recursos)

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/generos` | GET | `requireUser` | — | `generos[]` ordenados por `orden, nombre`, cada fila con `nodos: number` (conteo de nodos, activos o no) |
| `/api/generos` | POST | `requireAdmin` | `crearCatalogoSchema` | fila creada, `201` |
| `/api/generos/[id]` | PATCH | `requireAdmin` | `editarCatalogoSchema` | fila actualizada |
| `/api/generos/[id]` | DELETE | `requireAdmin` | — | `{ id }`; `409` si tiene nodos |
| `/api/mundos` y `/api/mundos/[id]` | idem | `requireUser` lectura · `requireAdmin` escritura | idem | idem |
| `/api/lineas` | GET | `requireUser` | — | `lineas[]` con `nodos: number` (conteo) ordenadas por `nombre` |
| `/api/lineas` | POST | `requirePlanner` | `crearLineaSchema` | `201` |
| `/api/lineas/[id]` | PATCH | `requirePlanner` | `editarLineaSchema` | fila actualizada |
| `/api/lineas/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` si tiene nodos |
| `/api/agrupaciones-talla` | GET | `requireUser` | — | `agrupaciones_talla[]` por `orden`. Sin POST/PATCH/DELETE: catálogo cerrado, se cambia por migración |

Géneros y Mundos son raíz del árbol: su escritura es `requireAdmin` (PLAN §4). Líneas las mantiene el planner.

```ts
// pseudocódigo zod — src/lib/arbol/esquemas.ts
const nombre = z.string().transform(normalizarNombre).pipe(z.string().min(1).max(120));
const codigo = z.string().transform(aCodigo).pipe(z.string().min(1).max(40));

crearCatalogoSchema = z.object({ nombre, codigo: codigo.optional(), orden: z.int().min(0).optional() });
   // si falta codigo → aCodigo(nombre)
editarCatalogoSchema = z.object({ nombre, codigo, orden: z.int().min(0), activo: z.boolean() })
   .partial().refine(noVacio);

crearLineaSchema  = crearCatalogoSchema.omit({ orden: true }).extend({ temporada: z.enum(TEMPORADAS).default("Todo el año") });
editarLineaSchema = z.object({ nombre, codigo, temporada: z.enum(TEMPORADAS), activo: z.boolean() }).partial().refine(noVacio);
```

### Nodos género-mundo-línea

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/arbol/nodos` | POST | `requirePlanner` | `{ genero_id: uuid, mundo_id: uuid, linea_id: uuid }` | nodo creado, `201`. `404` si alguno de los tres no existe · `409` si la tripleta ya existe (el mensaje dice si está inactiva, para que la reactiven en vez de duplicar) |
| `/api/arbol/nodos/[id]` | PATCH | `requirePlanner` | `{ activo?: boolean, mundo_id?: uuid }` (al menos uno) | nodo actualizado. `mundo_id` sirve para sacar una línea de SIN ASIGNAR; `409` si en el mundo destino ya existe esa línea para ese género |
| `/api/arbol/nodos/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` si tiene equivalencias |

No hay GET de nodos: la pantalla y el buscador trabajan sobre `/api/arbol`.

### Equivalencias

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/equivalencias?nodo_id=` | GET | `requireUser` | — | `equivalencias[]` del nodo, reales por `nombre` y la genérica al final. `400` sin `nodo_id` |
| `/api/equivalencias` | POST | `requirePlanner` | `{ genero_mundo_linea_id: uuid, nombre, codigo? }` | `201`. Si `nombre` normalizado es vacío, `-` o `SIN EQUIVALENCIA`, se crea como genérica (`es_generica = true`, nombre y código fijos); `409` si el nodo ya tiene genérica · `409` nombre o código repetido en el nodo · `404` nodo inexistente |
| `/api/equivalencias/[id]` | PATCH | `requirePlanner` | `{ nombre?, codigo?, activo? }` | actualizada. Sobre una genérica solo se admite `activo` (`409` si intentan renombrarla). `es_generica` no es editable |
| `/api/equivalencias/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` si tiene hijos (a partir de M2) |

No se mueve una equivalencia de un nodo a otro en M1 (fuera de alcance; se crea en el destino y se desactiva en el origen).

### Árbol completo

`GET /api/arbol?incluir_inactivos=1` · `requireUser`. Una sola llamada para la pantalla; el handler hace cinco `select` (géneros, mundos, líneas, nodos, equivalencias) y arma la estructura con la función pura `armarArbol()` (`src/lib/arbol/armar-arbol.ts`, probada con vitest). Con el árbol real son 570 nodos y 1 804 equivalencias, del orden de 250 KB sin comprimir: aceptable para una pantalla de maestro, sin paginación hacia el cliente (hacia la base sí se lee paginado con `leerTodo`).

```jsonc
{ "data": {
  "generos": [
    { "id": "…", "codigo": "H", "nombre": "HOMBRE", "orden": 10, "activo": true,
      "mundos": [                                 // SIEMPRE los 6 mundos, aunque lineas esté vacío
        { "id": "…", "codigo": "URBANO", "nombre": "URBANO", "orden": 20, "activo": true,
          "lineas": [
            { "nodo_id": "…", "linea_id": "…", "codigo": "PANTALON", "nombre": "PANTALON",
              "temporada": "Todo el año", "activo_linea": true, "activo_nodo": true, "vigente": true,
              "equivalencias": [
                { "id": "…", "codigo": "JOGGER", "nombre": "JOGGER", "es_generica": false, "activo": true },
                { "id": "…", "codigo": "SIN_EQUIVALENCIA", "nombre": "SIN EQUIVALENCIA", "es_generica": true, "activo": true }
              ] }
          ] }
      ] }
  ],
  "resumen": { "generos": 8, "mundos": 6, "lineas": 86, "nodos": 570, "equivalencias": 1804, "nodos_sin_asignar": 14 }
} }
```

Sin `incluir_inactivos`, se omiten géneros, mundos, líneas y equivalencias inactivos y los nodos no vigentes; con él, se devuelve todo y la pantalla atenúa según las banderas. `resumen` cuenta lo que se devolvió.

### Importador

`POST /api/arbol/importar` · `requirePlanner`.

```ts
importarSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"]),
  filas: z.array(z.object({
    genero: z.string(), mundo: z.string(), linea: z.string(), equivalencia: z.string()
  })).min(1).max(10_000),
});
```

El cliente parsea el CSV con **papaparse** en el navegador (dependencia nueva: `papaparse` + `@types/papaparse`; en V1 funcionó bien y evita subir archivos al servidor), deja al usuario confirmar el mapeo de columnas (autodetección por nombre: `GENERO_LK`/`género`, `MUNDO`/`GRUPO_PRODUCTO`, `LINEA`, `EQUIVALENCIA`) y manda las filas ya mapeadas. Las filas se envían en un solo cuerpo (2 002 filas ≈ 150 KB).

Algoritmo, idéntico en los dos modos hasta el último paso (función pura `planificarImportacion(filas, estadoActual)` en `src/lib/arbol/importar.ts`):

1. Normalizar cada fila (`normalizarNombre` en los cuatro campos). Descartar filas con `linea` vacía o cuyo género sea `TOTAL` (fila de totales de Excel) → `omitidas` con motivo.
2. Resolver **género** contra los existentes **activos** por `aCodigo(valor) = codigo` o `nombre`. Si no existe → `omitida` (`genero_desconocido`); si existe pero está inactivo → `omitida` (`genero_inactivo`). En ambos casos `omitidas[].detalle` trae el valor que no se reconoció. El importador **no crea géneros ni mundos**: son raíz, con 8 y 6 valores fijos, y su escritura es de admin; un error de tipeo en el archivo no debe crear una raíz nueva ni revivir una desactivada.
3. Resolver **mundo** igual (`mundo_desconocido` / `mundo_inactivo`). Vacío → mundo `SIN_ASIGNAR` y la fila se anota en `sin_mundo`; si `SIN_ASIGNAR` está inactivo la fila se omite con `mundo_inactivo`. Si el mundo `SIN_ASIGNAR` no existiera en la base → `409 "Falta el mundo SIN ASIGNAR; reaplica la migración."`.
4. **Línea** por `nombre`: existe → `existentes.lineas++`; no → `crear.lineas` con `codigo = codigoUnico(aCodigo(nombre))` y `temporada` por defecto. `codigoUnico` agrega `_2`, `_3`… si otra línea (de la base o del mismo archivo) ya usa ese código ASCII.
5. **Nodo** por tripleta: existe → `existentes.nodos++`; no → `crear.nodos`.
6. **Equivalencia**: si el valor es vacío o `-` → la genérica del nodo (una sola aunque haya varias filas así). Si no → por `(nodo, nombre)`. Existe → `existentes.equivalencias++`; no → `crear.equivalencias` o `crear.equivalencias_genericas`. El código se resuelve con `codigoUnico` dentro del nodo y `SIN_EQUIVALENCIA` queda reservado para la genérica: una equivalencia real llamada `SIN-EQUIVALENCIA` recibiría `SIN_EQUIVALENCIA_2`.
7. Duplicados dentro del archivo (misma tripleta + misma equivalencia tras normalizar) se cuentan una vez y se anotan en `omitidas` (`duplicada_en_archivo`). Filas que apuntan a algo existente pero inactivo se cuentan en `existentes_inactivos` y **no se reactivan**: el importador nunca cambia `activo`.
8. `previsualizar`: devuelve el reporte sin escribir. `aplicar`: inserta en orden líneas → nodos → equivalencias, en tandas de 500, con `insert … on conflict do nothing` apoyado en los índices únicos. No hay transacción (supabase-js no las expone y no queremos lógica en una función SQL); si una tanda falla a mitad, la respuesta es `500` con lo que alcanzó a crear y **reimportar completa el resto sin duplicar**: la idempotencia es la red de seguridad.

Reporte (igual en ambos modos; en `aplicar`, `creados` es lo realmente insertado):

```jsonc
{ "data": {
  "modo": "previsualizar",
  "totales": { "recibidas": 2002, "procesadas": 1804, "omitidas": 198 },
  "crear":   { "lineas": 86, "nodos": 570, "equivalencias": 1416, "equivalencias_genericas": 388 },
  "existentes": { "lineas": 0, "nodos": 0, "equivalencias": 0 },
  "existentes_inactivos": { "lineas": 0, "nodos": 0, "equivalencias": 0 },
  "sin_mundo": [ { "fila": 213, "genero": "BEBE", "linea": "BODY", "equivalencia": "SIN EQUIVALENCIA" } ],
  "omitidas": [ { "fila": 57, "motivo": "duplicada_en_archivo" }, { "fila": 900, "motivo": "mundo_desconocido", "detalle": "URBANOO" } ],
  "muestra": { "lineas": ["BERMUDA", "BLUSA", "…"], "nodos": ["H / URBANO / PANTALON", "…"] }   // primeros 20 de cada tipo
} }
```

Los números del ejemplo son los del archivo actual (verificados por el test `tests/arbol.importar.test.ts`, que planifica el CSV real si está en `datos/`): 2 002 filas de datos, de las que 198 son duplicadas dentro del archivo tras normalizar; las 1 804 procesadas producen exactamente 1 804 equivalencias (1 416 reales + 388 genéricas, una por cada nodo que tenía vacío o `-`). `fila` es el índice 1-based dentro de `filas` tal como las mandó el cliente, para que la pantalla pueda señalar la fila del CSV; `detalle` es opcional y trae el valor no reconocido.

## Pantallas

Rutas bajo `/maestros/arbol`. En `src/lib/nav.ts` se quita `pendiente: "M1"` del item "Árbol de producto". Además, la sección Maestros pasa a `roles: TODOS` con `roles: PLANIFICACION` en los items M2–M4 y sin restricción en el del árbol, para que el **comprador** vea el árbol en solo lectura (PLAN §3: "solo lectura hoy"; el árbol es el vocabulario común con los compradores y la pantalla ya distingue por rol, así que cuesta cero). Si Javier prefiere ocultárselo, es una línea en `nav.ts`.

### `/maestros/arbol` — Árbol

Página servidor que lee `perfilActual()` y pasa `rol` al panel cliente (`arbol-panel.tsx`), que carga `GET /api/arbol` una vez y navega en memoria.

Disposición en columnas (estilo Finder), de izquierda a derecha:

| Columna | Contenido | Acciones admin | Acciones planner | Comprador |
|---|---|---|---|---|
| Géneros | Los 8, por `orden`; conteo de nodos vigentes | Gestionar en Catálogos (enlace) | — | ver |
| Mundos del género elegido | Los 6 siempre; los que no tienen líneas en ese género, atenuados con "0 líneas"; SIN ASIGNAR resaltado si tiene nodos | Gestionar en Catálogos | — | ver |
| Líneas del género-mundo | Lista con filtro por texto; badge de `temporada`; conteo de equivalencias | **Agregar línea** (combo con las líneas del catálogo que aún no están en este nodo + "crear línea nueva"), **Desactivar / Reactivar** nodo, **Mover a otro mundo** (solo visible si el mundo es SIN ASIGNAR o si activa "mostrar inactivos"), **Eliminar** (si no tiene equivalencias) | igual que admin | ver |
| Equivalencias del nodo | Tabla `nombre · codigo · estado`; la genérica al final con badge "Genérica" | **Nueva equivalencia** (nombre; código propuesto editable), **Renombrar**, **Desactivar / Reactivar**, **Eliminar**, **Agregar SIN EQUIVALENCIA** (si el nodo no la tiene) | igual | ver |

Encima de las columnas:

- **Buscador de línea** (global): al escribir ≥ 2 letras lista las líneas que coinciden y, bajo cada una, los nodos donde existe ("PANTALON · en 26 nodos: HOMBRE / URBANO (7 eq.), MUJER / CASUAL (4 eq.) …"). Clic → selecciona ese nodo en las columnas. Funciona sobre los datos ya cargados, sin llamadas.
- Interruptor **Mostrar inactivos**: recarga `/api/arbol?incluir_inactivos=1`; lo inactivo se muestra atenuado con badge "Inactivo", y lo no vigente por un padre inactivo con "Oculto por {género|mundo|línea} inactivo".
- Resumen: `8 géneros · 6 mundos · 86 líneas · 570 nodos · 1 804 equivalencias · 14 en SIN ASIGNAR` (del `resumen` de la API). "14 en SIN ASIGNAR" es un enlace que selecciona ese mundo.
- Botón **Importar CSV** (admin y planner) que abre la pestaña de importación.

Validaciones visibles: nombre obligatorio; se muestra el nombre normalizado antes de guardar ("se guardará como PANTALON CARGO"); el código se previsualiza; los errores `409` de la API se muestran con `Alert` tal cual llegan. Las acciones destructivas piden `confirm` como en `/usuarios`.

### Pestaña Importar CSV

1. Selector de archivo `.csv`. Se parsea en el navegador; se muestran nombre, número de filas y el mapeo de las cuatro columnas (autodetectado, editable con `Select`). Las cuatro son obligatorias para habilitar el siguiente paso.
2. **Previsualizar** → `POST …/importar` con `modo: previsualizar`. Se pinta el reporte: tarjetas con `crear` / `existentes` / `omitidas`, tabla `sin_mundo` ("estas N líneas irán a SIN ASIGNAR; podrás moverlas después"), tabla `omitidas` con fila y motivo, muestra de lo que se creará.
3. **Aplicar** se habilita solo después de una previsualización del mismo archivo (cambiar el archivo o el mapeo la invalida). Manda `modo: aplicar`, muestra el reporte final y un botón "Ver el árbol" que recarga.
4. Reimportar el mismo archivo muestra `crear` en cero en la previsualización; la pantalla lo dice en claro ("Nada nuevo que crear").

### `/maestros/arbol/catalogos` — Catálogos

Pestañas **Géneros · Mundos · Líneas · Agrupaciones de talla**, cada una con el mismo patrón que `/usuarios`: formulario de alta arriba (`Card`) y `DataTable` abajo con `Badge` de estado y botones por fila.

| Pestaña | Columnas | Alta y edición | Quién edita |
|---|---|---|---|
| Géneros | orden, código, nombre, nodos, estado | nombre, código, orden; desactivar/reactivar; eliminar (si 0 nodos) | admin (planner y comprador solo ven) |
| Mundos | igual | igual | admin |
| Líneas | código, nombre, temporada (`Select` en línea), en N nodos, estado | nombre, código, temporada; desactivar/reactivar; eliminar (si 0 nodos) | admin y planner |
| Agrupaciones de talla | orden, código, nombre | solo lectura, con la nota "catálogo fijo: la venta y el stock llegan consolidados por agrupación" | nadie (se cambia por migración) |

Al desactivar un género, mundo o línea con nodos, el `confirm` dice cuántos nodos quedarán ocultos.

Páginas: `page.tsx` servidor que redirige a `/` si `perfilActual()` no es `ok` (y, para catálogos, si el rol es comprador), igual que `usuarios/page.tsx`.

## Reglas de negocio

Funciones puras en `src/lib/arbol/` probadas en `tests/arbol.*.test.ts`:

**`normalizar.ts`**

1. `normalizarNombre(" pantalón   cargo ") === "PANTALÓN CARGO"`; NFC (la `ñ` descompuesta y la compuesta dan el mismo resultado); `null`/`undefined` → `""`.
2. `aCodigo("Niñas") === "NINAS"`, `aCodigo("SIN ASIGNAR") === "SIN_ASIGNAR"`, `aCodigo("POLO M/C") === "POLO_M_C"`, `aCodigo("  --  ") === ""`, nunca supera 40 caracteres, solo `[A-Z0-9_]`.
3. `esEquivalenciaGenerica(v)` es `true` para `""`, `"   "`, `"-"`, `"SIN EQUIVALENCIA"` (en cualquier caja) y `false` para `"VARIOS"`. Constantes `EQUIVALENCIA_GENERICA = { nombre: "SIN EQUIVALENCIA", codigo: "SIN_EQUIVALENCIA" }`.
4. `TEMPORADAS = ["Verano", "Invierno", "Todo el año"]`; `esTemporada("Verano")`, no `esTemporada("verano")`.

**`importar.ts` — `planificarImportacion(filas, estado)`** donde `estado` son los catálogos y nodos actuales en memoria:

5. Una fila con género desconocido o mundo no vacío y desconocido va a `omitidas` con su motivo y no genera nada.
6. Mundo vacío → se planifica bajo `SIN_ASIGNAR` y la fila aparece en `sin_mundo`.
7. Equivalencia `""` y `"-"` en el mismo nodo producen **una sola** genérica; un nodo con solo genéricas crea el nodo y una genérica; un nodo con reales y genéricas crea las reales más una genérica.
8. Filas duplicadas tras normalizar cuentan una vez (`duplicada_en_archivo`).
9. **Idempotencia**: `planificarImportacion(filas, aplicarPlan(estado, plan))` devuelve `crear` todo en cero y `existentes` igual a lo que se creó antes. Y aplicar dos veces el mismo plan produce el mismo estado.
10. Lo existente pero inactivo se cuenta en `existentes_inactivos` y el plan no lo toca.
11. Los conteos del plan son consistentes: `recibidas = procesadas + omitidas`.

**`armar-arbol.ts` — `armarArbol(generos, mundos, lineas, nodos, equivalencias, { incluirInactivos })`**

12. Cada género devuelve **todos** los mundos, con `lineas: []` donde no haya nodos.
13. `nodoVigente(nodo, genero, mundo, linea)` es la conjunción de los cuatro `activo`; sin `incluirInactivos` un nodo no vigente no aparece, con él aparece con `vigente: false`.
14. Orden: géneros y mundos por `orden, nombre`; líneas por `nombre`; equivalencias reales por `nombre` y la genérica al final.
15. `resumen` cuenta exactamente lo devuelto (y `nodos_sin_asignar` solo los del mundo `SIN_ASIGNAR`).

**`reglas.ts`**

16. `motivoRechazoEquivalencia(nodoEquivalencias, cambio)`: segunda genérica en el nodo → rechazo; renombrar una genérica → rechazo; nombre repetido en el nodo (tras normalizar) → rechazo; mismo nombre en otro nodo → permitido.
17. `motivoRechazoMoverNodo(nodo, mundoDestino, nodosExistentes)`: destino igual al origen → rechazo; ya existe la tripleta en el destino → rechazo; si no, permitido.
18. `motivoRechazoEliminar(tipo, hijos)`: `hijos > 0` → mensaje con el conteo y la sugerencia de desactivar; `0` → `null`. (El `restrict` de la base es la garantía; la función existe para dar el mensaje antes de intentar.)
19. El importador nunca produce cambios en `activo` ni crea géneros o mundos (asegurado por 5, 6 y 10; test explícito de que `plan.crear` no tiene claves `generos`/`mundos`).

## Hito de prueba

- [x] Checks automáticos: `npm run lint`, `npm run typecheck`, `npm test` (110 pruebas en 9 archivos), `npm run build` y `scripts/validar-migraciones-local.sh` (todas las migraciones aplicadas dos veces contra un Postgres local) en verde; `APP_VERSION = 0.2.0 · M1`.
- [ ] Prerrequisito de base real: M0 recorrido; `0001_arbol_producto.sql` aplicada dos veces en el proyecto `vector-two` sin error; tipos regenerados.
- [ ] Tras la migración: 8 géneros, 6 mundos y 2 agrupaciones de talla en el orden del seed; 0 líneas, nodos y equivalencias; `GET /api/agrupaciones-talla` devuelve CENTRALES y EXTREMAS y la pestaña Agrupaciones de talla las muestra sin botones.
- [ ] Como comprador: entra a `/maestros/arbol`, navega, no ve ningún botón de edición; `/maestros/arbol/catalogos` le redirige a `/`; `POST /api/lineas` le devuelve `403`.
- [ ] Como planner: `POST /api/generos` devuelve `403`; en Catálogos las pestañas Géneros y Mundos no tienen formulario ni botones.
- [ ] Como admin, en Importar CSV, carga `datos/arbol-lineas.csv`: el mapeo se autodetecta; **Previsualizar** reporta `recibidas 2002 · procesadas 1804 · omitidas 198` (todas `duplicada_en_archivo`), crear 86 líneas, 570 nodos (556 con mundo + 14 en SIN ASIGNAR), 1 416 equivalencias reales y 388 genéricas, 14 filas en `sin_mundo` (BEBE 2, JOVENCITAS 3, NIÑAS 4, NIÑOS 5), 0 géneros/mundos nuevos. Son los conteos que fija el test del importador; si difieren, cambió el archivo.
- [ ] **Aplicar**: el reporte final coincide con la previsualización; el resumen de `/maestros/arbol` muestra `8 · 6 · 86 · 570 · 1 804 · 14 en SIN ASIGNAR`.
- [ ] Reimportar el mismo archivo: previsualización con `crear` en cero y `existentes` igual a los totales; aplicar no cambia ningún conteo (verificar con `select count(*)` en las tres tablas antes y después).
- [ ] Buscar `PANTALON`: aparece en 26 nodos. Abrir HOMBRE / URBANO / PANTALON y MUJER / URBANO / PANTALON: listas de equivalencias distintas; `VARIOS` aparece en ambos como filas independientes.
- [ ] Un nodo que en el archivo solo tenía `-` muestra únicamente `SIN EQUIVALENCIA` con badge Genérica; uno mixto muestra las reales y la genérica al final.
- [ ] Mundo SIN ASIGNAR: seleccionar BEBE / SIN ASIGNAR, mover una línea a CASUAL → desaparece de SIN ASIGNAR y aparece en CASUAL con sus equivalencias; intentar moverla a un mundo donde esa línea ya exista para BEBE → `409` legible.
- [ ] Crear a mano una línea nueva en Catálogos con nombre `  camisa   manga larga ` → se guarda como `CAMISA MANGA LARGA`, código `CAMISA_MANGA_LARGA`, temporada `Todo el año`; agregarla a HOMBRE / FORMAL desde el árbol; crearle una equivalencia; intentar crear otra con el mismo nombre en minúsculas → `409`; intentar agregarle una segunda `SIN EQUIVALENCIA` → `409`.
- [ ] Cambiar temporada de una línea a `Invierno` en Catálogos y verlo reflejado en el badge del árbol.
- [ ] Desactivar el mundo FORMAL como admin: sus nodos desaparecen del árbol; con "Mostrar inactivos" aparecen como "Oculto por mundo inactivo"; reactivar FORMAL los devuelve; un nodo que se había desactivado a mano antes sigue inactivo.
- [ ] Intentar eliminar la línea PANTALON → `409` con el conteo de nodos; eliminar una equivalencia recién creada → funciona; eliminar un nodo sin equivalencias → funciona; con equivalencias → `409`.
- [ ] `GET /api/arbol` responde en menos de 2 s con el árbol completo y `GET /api/arbol?incluir_inactivos=1` incluye lo desactivado con sus banderas.

## Fuera de alcance

- Marcas, agrupaciones de marca y su relación con equivalencias (M2).
- Agrupación de estacionalidad y la FK en `equivalencias` (M3).
- Tiendas (M4).
- Agrupar géneros (Hombre / Mujer / Infantil): se decide con la respuesta de Javier; sería una columna `grupo` en `generos`.
- Tallas individuales y su mapeo a agrupaciones: **no existirán** (venta y stock llegan consolidados por agrupación de talla). La columna `agrupacion_talla_id` en venta/stock es de M5.
- Mover equivalencias entre nodos y fusionar nodos (p. ej. al reasignar desde SIN ASIGNAR cuando el destino ya existe): se hace a mano creando en el destino y desactivando en el origen.
- Importar temporada de líneas o equivalencias desde archivo (el CSV no las trae).
- Auditoría de quién cambió qué (pendiente desde M0).
- Que el importador cree géneros o mundos nuevos.

## Cambios respecto a la especificación

Lo que QA y el backend encontraron al construir y que la especificación original no decía o decía distinto. Las decisiones de fondo están en `docs/DECISIONES.md` (entradas del 2026-10-02).

**Conteos del archivo.** La especificación hablaba de 87 líneas, 571 + N nodos, 389 genéricas y 278 filas vacías porque contó la fila de cabecera del CSV como si fuera de datos. Los números reales, verificados de forma independiente por QA con `awk` y por el test del importador, son: 2 002 filas de datos · 86 líneas · 570 nodos (556 con mundo + 14 en SIN ASIGNAR) · 1 416 equivalencias reales + 388 genéricas = 1 804 · 14 filas sin mundo (BEBE 2, JOVENCITAS 3, NIÑAS 4, NIÑOS 5) · 198 filas duplicadas dentro del archivo · 277 vacías y 308 con `-` · PANTALON en 26 nodos. La ficha ya está corregida con estos valores.

**Implementación.**

1. `codigoUnico` agrega sufijos `_2`, `_3`… cuando dos nombres distintos derivan al mismo código ASCII dentro del mismo ámbito (líneas; equivalencias de un nodo). El código `SIN_EQUIVALENCIA` queda reservado para la genérica. La especificación suponía que `aCodigo` nunca chocaba.
2. `omitidas[]` lleva un `detalle` opcional con el valor no reconocido (el género o mundo tal como vino), para que la pantalla diga qué corregir en el archivo.
3. Motivos de omisión nuevos `genero_inactivo` y `mundo_inactivo`: el importador resuelve géneros y mundos solo entre los activos; si el valor existe pero está desactivado (incluido SIN ASIGNAR), la fila se omite y se reporta en vez de escribir bajo una raíz apagada.
4. `GET /api/generos` y `GET /api/mundos` devuelven `nodos` por fila (conteo de nodos, activos o no), igual que `GET /api/lineas`; la pantalla de Catálogos lo necesita para avisar cuántos nodos quedan ocultos al desactivar.
5. Los ids de ruta que no son UUID responden `404` (`idDeRuta`) en vez de llegar a Postgres y acabar en `500`. Los errores de base no previstos devuelven el mensaje genérico "Error inesperado en la base de datos." y el detalle se registra solo en el servidor.
6. Todas las lecturas que pueden crecer pasan por `leerTodo`, paginado de a 1 000 filas; sin eso el árbol habría salido incompleto en silencio al superar el límite de PostgREST.
7. En `/maestros/arbol/catalogos` el comprador se redirige a `/` desde el servidor (`page.tsx`), no desde el cliente.
8. `nav.ts`: la sección Maestros la ven los tres roles y el item "Árbol de producto" no tiene restricción; los items de M2 a M4 siguen siendo de admin y planner.

## Decisiones nuevas

Registradas en `docs/DECISIONES.md` (seis entradas del 2026-10-02, más una sobre ids no UUID, errores genéricos y paginación).

## Preguntas abiertas para Javier

1. **Mundo SIN ASIGNAR.** Hay 14 filas sin mundo (BEBE 2, JOVENCITAS 3, NIÑAS 4, NIÑOS 5). ¿Las reasignas desde la pantalla después de importar, o prefieres corregir el archivo antes? ¿Debe quedar SIN ASIGNAR como mundo permanente (para futuras cargas) o desactivarse cuando quede vacío?
2. **Agrupar géneros.** ¿Vas a necesitar ver o proyectar por Hombre / Mujer / Infantil además de los 8 géneros? Si sí, ¿cuál es el mapeo (¿JOVENCITOS va con Hombre o con Infantil? ¿OTROS?)?
3. **Temporada de las líneas.** El archivo no la trae; todas quedarán en `Todo el año`. ¿Tienes la lista de líneas de Verano e Invierno para cargarla a mano, o la vas marcando?
4. **Vacío y `-`.** Confirmar que en el archivo significan lo mismo ("sin equivalencia definida") y que te sirve que ambas caigan en una sola `SIN EQUIVALENCIA` por nodo.
5. **Comprador.** ¿Está bien que vea el árbol completo en solo lectura desde ya, o lo ocultamos hasta la Fase 3?
6. **Códigos.** ¿Te sirve que los códigos sean ASCII sin eñes ni acentos (`NINAS`, `SIN_ASIGNAR`) pensando en PIVOT y abreviaturas, o prefieres conservar el valor exacto del archivo como código?
7. **RI y OTROS.** ¿Qué significan el mundo `RI` y el género `OTROS`? Solo para escribir el nombre legible correcto en el seed (hoy se dejan tal cual).

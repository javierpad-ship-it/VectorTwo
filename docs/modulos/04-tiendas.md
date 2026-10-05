# M4 · Tiendas y aperturas

> Estado: **especificación, pendiente de aprobación de Javier**. Módulo anterior: [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (en especificación en paralelo; M4 no depende de él ni de [02-marcas](02-marcas.md): Javier confirmó que "en esta etapa es independiente a lo anterior"). Reglas de base en `docs/PLAN.md` §4 y `docs/DECISIONES.md`. Lo que se construya distinto de lo especificado irá en "Cambios respecto a la especificación", al final.

## Objetivo

Dar al planner el maestro de la red de Lukers —tiendas y centros de distribución— con sus fechas de apertura y cierre, para que la Fase 2 sepa **qué puntos de venta existen, desde cuándo y hasta cuándo**, y cuánto se espera vender en los que todavía no abren. Javier lo pidió como "un módulo para crear tiendas y definir sus fechas de apertura"; la lista oficial (el archivo *CODIGOS DE TIENDAS LUKERS* que sirvió en V1, con códigos tipo `R401`, `R510` y `RD50` para el CD) la entregará él o la cargará por el importador, así que el módulo no trae semilla de tiendas y queda usable con alta manual desde el primer día.

El **estado** de cada tienda (Planificada · Activa · Cerrada) **no se guarda: se calcula** a partir de las fechas y del día de hoy. En V1 el estado era una columna que había que cambiar a mano, y las tiendas que ya habían abierto seguían figurando como Planificadas hasta que alguien se acordaba; aquí el hito es precisamente que "una tienda futura aparece Planificada y pasa a Activa al llegar la fecha" sin que nadie toque nada.

**Qué consume la Fase 2 de aquí** (M5, M6 y M7 se especifican al cerrar la Fase 1; esto es lo que M4 les deja listo):

- **M5 (carga de ventas y stock por tienda)**: cada fila de venta o stock trae un código de tienda; M5 lo resuelve contra `tiendas.codigo` (comparación sobre `upper`) y omite con motivo `tienda_desconocida` las que no existan, igual que M1 hace con géneros y mundos. Una tienda **Cerrada** sigue siendo válida para cargar su histórico (es `activo = true`); solo una tienda **desactivada** (`activo = false`) rechaza filas. Cuando M5 cuelgue filas de `tiendas`, `DELETE /api/tiendas/[id]` empezará a responder `409` con el conteo.
- **M7 (proyección)**: una tienda **Planificada** con `fecha_apertura` dentro del horizonte se proyecta desde esa fecha usando `venta_esperada_promedio` (soles por mes) como escala, porque no tiene histórico; una tienda **Cerrada** deja de proyectarse a partir del día siguiente a `fecha_cierre`; una tienda **Activa** se proyecta con su histórico. El centro de distribución no vende y no se proyecta: es stock, no venta.

## Modelo de datos

Migración `supabase/migrations/0004_tiendas.sql`, idempotente, sin bloques `do $$`. Mismas convenciones que M1 y M2: `id uuid primary key default gen_random_uuid()`, `activo boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` declarado con **`create or replace trigger`** (nunca `drop`, como fijó M2: las migraciones se aplican por `execute_sql` y un `DROP` se queda colgado), `enable row level security` sin políticas. No hay FKs: M4 es independiente del árbol y de las marcas.

### Convenciones de nombre y código

- `nombre` se guarda **normalizado** con `normalizarNombre` de `src/lib/arbol/normalizar.ts` (NFC, `trim`, espacios colapsados, mayúsculas en español): `Lukers Prolongación Iquitos` → `LUKERS PROLONGACIÓN IQUITOS`. Único global.
- `codigo` es el **código real de la tienda** (`Cod.Tda` del archivo oficial: `R401`, `RD50`), **obligatorio y no derivado del nombre**: a diferencia de los catálogos del árbol, aquí el código es el identificador con el que llegarán las ventas y el stock, así que lo escribe el usuario o lo trae el archivo. Pasa por `aCodigo` para quedar ASCII en mayúsculas (`r401` → `R401`, `R-401` → `R_401`); si el resultado queda vacío (por ejemplo `---`), se rechaza. Único sobre `upper(codigo)`. El otro número del archivo de V1 (`Tda#`) **se descarta**: se repetía entre tiendas (dos tiendas eran la 101).
- `zona` y `razon_social` son **texto libre normalizado** con la misma `normalizarNombre` (`Lukers sur oriente` → `LUKERS SUR ORIENTE`), nulos si vienen vacíos. No son catálogos en M4: hoy son dos zonas y dos razones sociales, la pantalla autocompleta con los valores ya usados (como hacía V1, para que no baile la ortografía) y la normalización evita duplicados por caja o espacios. Si la Fase 2 proyecta o reporta por zona, se promueven a catálogo con FK en una migración posterior (pregunta abierta 3).

### `tiendas`

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text not null` | `check tiendas_codigo_len_check (length between 1 and 40)`; único `tiendas_codigo_uniq on (upper(codigo))` |
| `nombre` | `text not null` | `check tiendas_nombre_len_check (length between 1 and 120)`; único `tiendas_nombre_uniq on (nombre)` |
| `tipo` | `text not null default 'Tienda'` | `check tiendas_tipo_check (tipo in ('Tienda', 'Centro de Distribución'))` |
| `zona` | `text null` | `check tiendas_zona_len_check (zona is null or length(zona) between 1 and 120)` |
| `razon_social` | `text null` | `check tiendas_razon_social_len_check (razon_social is null or length(razon_social) between 1 and 120)` |
| `fecha_apertura` | `date null` | primer día en que la tienda vende |
| `fecha_cierre` | `date null` | último día en que la tienda vende (inclusive); `check tiendas_cierre_requiere_apertura_check (fecha_cierre is null or fecha_apertura is not null)` y `check tiendas_cierre_apertura_check (fecha_cierre is null or fecha_cierre >= fecha_apertura)` |
| `venta_esperada_promedio` | `numeric(14,2) null` | soles por mes; `check tiendas_venta_no_negativa_check (venta_esperada_promedio is null or venta_esperada_promedio >= 0)` y `check tiendas_venta_solo_tienda_check (venta_esperada_promedio is null or tipo = 'Tienda')` |

Índices: solo los dos únicos. La tabla tiene del orden de una docena de filas; filtros por tipo, estado y zona se hacen en memoria.

**Por qué `tipo` es texto con `check` y no un enum.** V1 usó `tipo_ubicacion_enum` y `estado_ubicacion_enum`; agregar un valor a un enum de Postgres no es idempotente de forma sencilla y los tipos generados cambian de forma. Un `check` sobre texto se reemplaza con `alter table … drop constraint if exists … add constraint`, como `lineas.temporada`. El modelo admite varios CD aunque hoy haya uno (`RD50`); V1 tuvo una relación tienda → CD que abastece y la eliminó porque con un solo CD no distinguía nada; aquí no existe (fuera de alcance).

**Por qué el cierre exige apertura y es inclusive.** Un cierre sin apertura no dice nada a M7 (¿desde cuándo había venta?); si la apertura de una tienda vieja no se conoce con exactitud, se carga una aproximada. `fecha_cierre` es el **último día con venta**: una tienda con cierre hoy sigue Activa hoy y pasa a Cerrada mañana. Es la lectura más natural de "la tienda cerró el 31 de marzo" (vendió el 31) y queda registrada como decisión para que M7 la respete (pregunta abierta 6 por si Javier la entiende al revés).

**Por qué la venta esperada no se restringe a las Planificadas.** Es lo que M7 usará para escalar una tienda sin histórico, así que importa en las Planificadas; pero una tienda que acaba de abrir sigue sin histórico útil durante meses, y conservar el valor tras la apertura no estorba. Sí se rechaza en un CD (no vende). Moneda y periodicidad (soles por mes) son un supuesto heredado de V1: pregunta abierta 4.

**`activo` no es el estado.** Son dos cosas distintas y las dos se muestran:

| | Qué significa | Quién lo cambia | Efecto en Fase 2 |
|---|---|---|---|
| `estado` (derivado) | Planificada / Activa / Cerrada según fechas y hoy | nadie: cambia solo al pasar los días | M5 carga histórico de las tres; M7 proyecta según el estado |
| `activo` (columna) | la fila está vigente en el maestro | admin o planner, desde la pantalla | M5 omite filas de tiendas desactivadas; no aparecen en selectores |

Una tienda que cerró **no se desactiva**: se le pone `fecha_cierre` y sigue `activo = true` con su histórico. Desactivar es para filas creadas por error o que no deben volver a aparecer (igual que en el árbol: la acción normal es desactivar, eliminar solo sin hijos). En M4 ninguna tienda tiene hijos, así que eliminar siempre funciona; dejará de hacerlo cuando M5 cuelgue ventas y stock (`on delete restrict` → `409` con el conteo).

### Estado derivado

Función pura `estadoTienda(tienda, hoy)` en `src/lib/tiendas/estado.ts`, con `hoy` como fecha ISO `aaaa-mm-dd` (las fechas `date` de Postgres viajan como ISO y la comparación de cadenas ISO es correcta sin convertir a `Date`, lo que evita errores de zona horaria):

1. Sin `fecha_apertura`, o `fecha_apertura > hoy` → **Planificada**.
2. Si no, con `fecha_cierre` y `fecha_cierre < hoy` → **Cerrada**.
3. Si no → **Activa**.

`hoy` lo calcula el handler con `hoyLima()` (`Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" })`), no con `new Date().toISOString()`: Railway corre en UTC y desde las 19:00 de Lima ya sería "mañana", con lo que una tienda que abre mañana aparecería Activa cinco horas antes. Las lecturas aceptan `?hoy=aaaa-mm-dd` para simular otra fecha (sin efectos en la base): lo usa el hito para ver una tienda pasar de Planificada a Activa sin esperar al día siguiente, y la pestaña Calendario para "ver la red a una fecha".

### Diagrama

```
tiendas ── codigo (R401, RD50…) · nombre · tipo (Tienda | Centro de Distribución)
   │       zona · razon_social (texto libre normalizado, autocompletado)
   │       fecha_apertura ──┐
   │       fecha_cierre   ──┼─► estadoTienda(tienda, hoy) = Planificada | Activa | Cerrada   (no se guarda)
   │       venta_esperada_promedio (S/ por mes; solo tipo Tienda)
   │
   ├──▶ (M5) venta y stock traen codigo de tienda → se resuelve aquí; tienda desactivada = fila omitida
   └──▶ (M7) Planificada → proyecta con venta_esperada desde fecha_apertura · Cerrada → deja de proyectar tras fecha_cierre
```

## Contratos de API

Todos devuelven `{ data }` con `ok()` o `{ error }` con `error()` de `src/lib/api/respuestas.ts`; cuerpos con `leerCuerpo` y esquemas zod en `src/lib/tiendas/esquemas.ts`; ids de ruta con `idDeRuta`; errores de base con `traducirErrorDb`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod o `check` · `404` id inexistente o no UUID · `409` regla de negocio, único o FK · `500` genérico. Lecturas con `?incluir_inactivos=1`, por defecto solo `activo = true`, siempre vía `leerTodo`.

Lectura `requireUser`; escritura `requirePlanner` (el planner mantiene la red igual que mantiene líneas y marcas; no hay nada "raíz" aquí que reservar al admin).

**Qué se reutiliza y qué no.** Las tiendas **no entran en `TablaCatalogo`** ni usan `src/lib/api/catalogo.ts`: ese helper sirve a catálogos planos (orden, código, nombre) y aquí el listado lleva un campo calculado, filtros y una validación cruzada entre columnas que el helper no contempla. Los handlers son propios, como los de marcas en M2, y comparten lo mismo que ellos: `leerTodo`, `idDeRuta`, `traducirErrorDb`, `motivoRechazoEliminar`. Si M2 ya generalizó `hijos` en `catalogo.ts`, M4 no necesita tocarlo. Extensiones a lo compartido:

- `src/lib/arbol/reglas.ts`: `TipoEliminable` suma `"tienda"` (sujeto "la tienda", hijos "registro de venta o stock" / "registros de venta o stock", "Desactívala").
- `src/lib/api/errores-db.ts`: `MENSAJES_UNICO` suma `tiendas_codigo` ("Ya existe una tienda con ese código.") y `tiendas_nombre` ("Ya existe una tienda con ese nombre."); `MENSAJES_CHECK` suma `tiendas_tipo` ("El tipo debe ser Tienda o Centro de Distribución."), `tiendas_cierre_requiere_apertura` ("Para registrar un cierre, la tienda necesita fecha de apertura."), `tiendas_cierre_apertura` ("La fecha de cierre no puede ser anterior a la de apertura."), `tiendas_venta_no_negativa` ("La venta esperada no puede ser negativa."), `tiendas_venta_solo_tienda` ("Un centro de distribución no lleva venta esperada."), `tiendas_zona_len` y `tiendas_razon_social_len` ("La zona / La razón social no puede superar 120 caracteres."). Los genéricos `_codigo_len` y `_nombre_len` ya cubren los de longitud. Las entradas se agregan en orden en la misma lista que M2 extiende; son líneas independientes y no chocan.

### Tiendas

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/tiendas?tipo=&estado=&zona=&hoy=&incluir_inactivos=1` | GET | `requireUser` | — | `tiendas[]` por `codigo`, cada fila con `estado` calculado. `400` si `tipo` o `estado` no son valores válidos o `hoy` no es fecha ISO |
| `/api/tiendas` | POST | `requirePlanner` | `crearTiendaSchema` | `201` con la fila y su `estado`; `409` código o nombre repetido; `400` fechas o venta incoherentes |
| `/api/tiendas/[id]` | PATCH | `requirePlanner` | `editarTiendaSchema` | fila actualizada con `estado`; `404`; `409` repetido; `400` incoherencia con la fila actual |
| `/api/tiendas/[id]` | DELETE | `requirePlanner` | — | `{ id }`; `409` si tiene hijos (ninguno en M4; a partir de M5) |

```jsonc
// GET /api/tiendas
{ "data": [
  { "id": "…", "codigo": "R401", "nombre": "LUKERS IQUITOS LORES", "tipo": "Tienda",
    "zona": "LUKERS SUR ORIENTE", "razon_social": "LUKERS ORIENTE SAC",
    "fecha_apertura": "2019-03-15", "fecha_cierre": null, "venta_esperada_promedio": null,
    "activo": true, "created_at": "…", "updated_at": "…",
    "estado": "Activa" },
  { "id": "…", "codigo": "R512", "nombre": "LUKERS AREQUIPA", "tipo": "Tienda",
    "zona": "LUKERS SUR ORIENTE", "razon_social": "LUKERS SAC",
    "fecha_apertura": "2027-03-01", "fecha_cierre": null, "venta_esperada_promedio": 85000,
    "activo": true, "created_at": "…", "updated_at": "…",
    "estado": "Planificada" },
  { "id": "…", "codigo": "RD50", "nombre": "CD LUKERS", "tipo": "Centro de Distribución",
    "zona": null, "razon_social": "LUKERS SAC",
    "fecha_apertura": null, "fecha_cierre": null, "venta_esperada_promedio": null,
    "activo": true, "created_at": "…", "updated_at": "…",
    "estado": "Planificada" }      // un CD sin fechas sale Planificada: ver pregunta abierta 5
] }
```

Filtros de la lectura: `tipo` ∈ `Tienda | Centro de Distribución`; `estado` ∈ `Planificada | Activa | Cerrada` (se aplica en memoria tras calcular, porque no es columna); `zona` compara contra `zona` normalizada; `hoy` opcional (`aaaa-mm-dd`, por defecto `hoyLima()`). Los filtros se combinan con AND. El panel carga una sola vez `?incluir_inactivos=1` sin filtros y filtra en memoria; los parámetros existen para la Fase 2 y para probar la API a mano.

```ts
// pseudocódigo zod — src/lib/tiendas/esquemas.ts (reutiliza `nombre`, `activo`, `tieneAlgo`/`noVacio` de arbol/esquemas.ts; exportarlos si hace falta)
export const TIPOS_TIENDA = ["Tienda", "Centro de Distribución"] as const;
export const ESTADOS_TIENDA = ["Planificada", "Activa", "Cerrada"] as const;

const codigoTienda = z.string("El código debe ser texto.").transform(aCodigo)
  .pipe(z.string().min(1, "El código es obligatorio (letras o números).").max(40));   // NO se deriva del nombre
const textoOpcional = z.string().nullable().optional()
  .transform(v => { const n = normalizarNombre(v ?? ""); return n === "" ? null : n; })
  .pipe(z.string().max(120).nullable());
const fecha = z.iso.date("La fecha debe venir como aaaa-mm-dd.").nullable().optional();
const monto = z.number("La venta esperada debe ser un número.").min(0, "La venta esperada no puede ser negativa.")
  .nullable().optional();

crearTiendaSchema = z.object({
  codigo: codigoTienda, nombre, tipo: z.enum(TIPOS_TIENDA).default("Tienda"),
  zona: textoOpcional, razon_social: textoOpcional,
  fecha_apertura: fecha, fecha_cierre: fecha, venta_esperada_promedio: monto,
}).superRefine((v, ctx) => { const m = motivoRechazoTienda(v); if (m) ctx.addIssue({ message: m, path: m.path }); });

editarTiendaSchema = z.object({
  codigo: codigoTienda, nombre, tipo: z.enum(TIPOS_TIENDA), zona: textoOpcional, razon_social: textoOpcional,
  fecha_apertura: fecha, fecha_cierre: fecha, venta_esperada_promedio: monto, activo,
}).partial().refine(tieneAlgo, noVacio);
// La coherencia cruzada en PATCH (cierre ≥ apertura, cierre exige apertura, CD sin venta) la resuelve el handler con
// `motivoRechazoTienda({ ...actual, ...cambio })`, porque depende de la fila actual que el esquema no conoce (regla 4).
// Cambiar `tipo` a Centro de Distribución con venta esperada en la fila → 400 "Un centro de distribución no lleva venta
// esperada: quítala primero."; el cliente manda `venta_esperada_promedio: null` en el mismo PATCH para hacerlo en un paso.
```

Orden de comprobaciones en `POST` y `PATCH`: zod (forma y normalización) → `motivoRechazoTienda` sobre la fila resultante (`400`) → escribir → `traducirErrorDb` (únicos `409`, checks `400` por si algo se escapó). La respuesta de escritura siempre lleva `estado` calculado con `hoyLima()`, para que la fila recién guardada aparezca con su badge sin recargar.

### Línea de tiempo de aperturas y cierres

`GET /api/tiendas/aperturas?desde=&hasta=&hoy=&incluir_inactivos=1` · `requireUser`.

Devuelve un evento por fecha registrada (una tienda con apertura y cierre produce dos), ordenados por `fecha` ascendente y luego por `codigo`, con la función pura `eventosTiendas(tiendas, hoy)` (`src/lib/tiendas/aperturas.ts`). `desde`/`hasta` acotan por fecha (ISO, inclusive) y por defecto no acotan: con una docena de tiendas la lista completa es trivial y la pantalla agrupa en memoria.

```jsonc
{ "data": {
  "hoy": "2026-10-05",
  "eventos": [
    { "fecha": "2019-03-15", "evento": "apertura", "pasado": true,  "tienda_id": "…", "codigo": "R401", "nombre": "LUKERS IQUITOS LORES",
      "tipo": "Tienda", "zona": "LUKERS SUR ORIENTE", "estado": "Activa", "venta_esperada_promedio": null },
    { "fecha": "2026-12-31", "evento": "cierre",   "pasado": false, "tienda_id": "…", "codigo": "R500", "nombre": "LUKERS CENTRAL",
      "tipo": "Tienda", "zona": null, "estado": "Activa", "venta_esperada_promedio": null },
    { "fecha": "2027-03-01", "evento": "apertura", "pasado": false, "tienda_id": "…", "codigo": "R512", "nombre": "LUKERS AREQUIPA",
      "tipo": "Tienda", "zona": "LUKERS SUR ORIENTE", "estado": "Planificada", "venta_esperada_promedio": 85000 }
  ],
  "resumen": { "proximas_aperturas": 1, "proximos_cierres": 1, "sin_fecha_apertura": 1 }
} }
```

`pasado` es `fecha < hoy` para aperturas y `fecha < hoy` para cierres (un cierre con fecha hoy todavía no pasó: la tienda vende hoy). `resumen.sin_fecha_apertura` cuenta las tiendas activas de tipo Tienda sin `fecha_apertura`: son las que M7 no sabrá proyectar y la pantalla las lista aparte para que se completen.

### Importador de tiendas

`POST /api/tiendas/importar` · `requirePlanner`.

```ts
filaImportacionTiendaSchema = z.object({
  codigo: z.string(), nombre: z.string(),
  tipo: z.string().default(""), zona: z.string().default(""), razon_social: z.string().default(""),
  fecha_apertura: z.string().default(""), fecha_cierre: z.string().default(""), venta_esperada: z.string().default(""),
});   // todo texto: el cliente manda las celdas tal cual y el servidor interpreta (fechas, montos, tipo)
importarTiendasSchema = z.object({
  modo: z.enum(["previsualizar", "aplicar"]),
  filas: z.array(filaImportacionTiendaSchema).min(1).max(10_000),
});
```

El cliente lee el archivo con `leerArchivoTabular` (`src/lib/arbol/leer-archivo.ts`: CSV con papaparse, Excel con SheetJS bajo demanda, selector de hoja) y mapea columnas con autodetección por nombre, usando las piezas de `src/components/importador/` que M2 extrae de `importar-csv.tsx` (selector de archivo y hoja, mapeo por campos, tarjetas, muestra, descarga de omitidas). Campos y alias:

| Campo | Obligatorio | Alias reconocidos (sin distinguir caja ni acentos) |
|---|---|---|
| `CODIGO` | sí | `COD.TDA`, `COD_TDA`, `CODIGO_TIENDA`, `COD` |
| `NOMBRE` | sí | `TIENDA`, `NOMBRE_TIENDA`, `DESCRIPCION`, `LOCAL` |
| `TIPO` | no (vacío = Tienda) | `TIPO_UBICACION`, `CLASE` |
| `ZONA` | no | `ZONA_COMERCIAL`, `REGION` |
| `RAZON_SOCIAL` | no | `RAZÓN SOCIAL`, `EMPRESA`, `SOCIEDAD` |
| `FECHA_APERTURA` | no | `APERTURA`, `FECHA_INICIO`, `INICIO` |
| `FECHA_CIERRE` | no | `CIERRE`, `FECHA_FIN`, `FIN` |
| `VENTA_ESPERADA` | no | `VENTA_ESPERADA_PROMEDIO`, `VENTA_PROM`, `VENTA_MENSUAL` |

Una columna `Tda#` del archivo de V1 no se mapea a nada (se descarta). Algoritmo, función pura `planificarImportacionTiendas(filas, estado)` en `src/lib/tiendas/importar.ts`, donde `estado = { tiendas }` leído completo (activas e inactivas):

1. `codigo = aCodigo(valor)` y `nombre = normalizarNombre(valor)`. Código vacío tras normalizar → `omitida` (`codigo_vacio`, con el valor original en `detalle` si lo había); nombre vacío → `nombre_vacio`; `nombre === "TOTAL"` → `fila_total`.
2. **Tipo** con `leerTipo(valor): Tipo | null` (`src/lib/tiendas/fechas.ts`, junto a los otros lectores): `""`, `TIENDA`, `T` → `Tienda`; `CD`, `CENTRO DE DISTRIBUCION`, `CENTRO DE DISTRIBUCIÓN`, `ALMACEN`, `ALMACÉN`, `DISTRIBUCION` → `Centro de Distribución`; otra cosa → `omitida` (`tipo_invalido`, `detalle`). No se infiere el tipo del código (`RD50` no es CD por empezar con `RD`, sino porque lo dice el archivo o la pantalla).
3. **Fechas** con `leerFecha(valor): string | null | "invalida"`: vacío → `null`; se aceptan `dd/mm/aaaa`, `dd-mm-aaaa`, `dd.mm.aaaa`, `aaaa-mm-dd`, `aaaa/mm/dd` y `dd/mm/aa` (año de dos cifras → `20aa`); **siempre día primero** (locale de Perú; `03/05/2026` es 3 de mayo). Se valida que sea un día real del calendario (`31/02/2026` → inválida). Devuelve ISO `aaaa-mm-dd`. Inválida → `omitida` (`fecha_apertura_invalida` / `fecha_cierre_invalida`, `detalle`). Luego la coherencia: cierre sin apertura → `cierre_sin_apertura`; cierre anterior a apertura → `cierre_antes_de_apertura` (`detalle` con las dos fechas).
4. **Venta esperada** con `leerMonto(valor): number | null | "invalido"`: vacío → `null`; se quita `S/`, `S/.`, espacios y las comas de miles; el punto es el separador decimal (`S/ 12,500.00` → `12500`, `85000` → `85000`, `12.5` → `12.5`). Negativo o cualquier otro texto → `omitida` (`venta_invalida`, `detalle`). Venta en un CD → `venta_en_cd`. Se redondea a dos decimales.
5. **Duplicados en el archivo** por `codigo` → `duplicada_en_archivo` con `fila_original` (manda la primera; si difieren en algo, `detalle` lo dice, p. ej. "nombre distinto: …"). Un **nombre** que ya usa otro código (en la base o en una fila anterior del archivo) → `omitida` (`nombre_repetido`, `detalle` = el código que lo tiene): dos tiendas no pueden llamarse igual y no se decide a ciegas cuál es la buena.
6. **Tienda existente** (por `upper(codigo)`): `existentes++` si está activa, `existentes_inactivos++` si no; **no se modifica ni se reactiva**. Cualquier campo que difiera (`nombre`, `tipo`, `zona`, `razon_social`, `fecha_apertura`, `fecha_cierre`, `venta_esperada_promedio`) se anota en `diferencias[]` (`{ fila, codigo, campo, en_base, en_archivo }`, legible: fechas en `dd/mm/aaaa`, montos con dos decimales, nulos como `—`). Es el mismo criterio que M2: el importador es una carga inicial idempotente, no una sincronización; con doce tiendas, los cambios de fechas se hacen desde la pantalla, donde además se ve el estado resultante. Si Javier prefiere que el archivo mande (pregunta abierta 7, compartida con M2), se agrega un `modo: "actualizar"` en los dos módulos a la vez.
7. **Tienda nueva** → `crear.tiendas++` (y `crear.centros_distribucion++` si es CD); `crear.sin_fecha_apertura` cuenta cuántas tiendas (no CD) nuevas entran sin apertura y por tanto se verán **Planificadas**: es informativo pero se muestra con aviso, porque es el error más probable al cargar la red actual. `muestra.tiendas` lista las primeras 20 como `"R401 · LUKERS IQUITOS LORES · Activa"` (estado calculado con `hoy`).
8. `previsualizar` devuelve el reporte sin escribir. `aplicar` inserta en tandas de 500 (`enTandas`) con `insert` plano: el plan ya excluyó los códigos existentes, y el único de código es sobre la expresión `upper(codigo)`, que PostgREST no admite en `onConflict` (M2 ya fijó "solo columnas, nunca expresiones"). Si entre previsualizar y aplicar alguien creó una tienda con uno de esos códigos, el `23505` se traduce a `409 "Ya existe una tienda con ese código. Vuelve a previsualizar."` y reimportar completa el resto sin duplicar. Sin transacción, como en M1 y M2.

Reporte, igual en los dos modos (en `aplicar`, `crear` es lo realmente insertado):

```jsonc
{ "data": {
  "modo": "previsualizar", "hoy": "2026-10-05",
  "totales": { "recibidas": 14, "procesadas": 12, "omitidas": 2 },
  "crear": { "tiendas": 11, "centros_distribucion": 1, "sin_fecha_apertura": 3 },
  "existentes": { "tiendas": 0 },
  "existentes_inactivos": { "tiendas": 0 },
  "diferencias": [
    { "fila": 4, "codigo": "R500", "campo": "fecha_cierre", "en_base": "—", "en_archivo": "31/12/2026" }
  ],
  "omitidas": [
    { "fila": 9,  "motivo": "fecha_apertura_invalida", "detalle": "31/02/2024", "codigo": "R507", "nombre": "LUKERS PIURA", "tipo": "", "zona": "LUKERS CENTRO NORTE", "razon_social": "LUKERS SAC", "fecha_apertura": "31/02/2024", "fecha_cierre": "", "venta_esperada": "" },
    { "fila": 13, "motivo": "duplicada_en_archivo", "fila_original": 2, "codigo": "R402", "nombre": "LUKERS TARAPOTO", "tipo": "", "zona": "LUKERS SUR ORIENTE", "razon_social": "LUKERS ORIENTE SAC", "fecha_apertura": "", "fecha_cierre": "", "venta_esperada": "" }
  ],
  "muestra": { "tiendas": ["R401 · LUKERS IQUITOS LORES · Activa", "R512 · LUKERS AREQUIPA · Planificada", "…"] }
} }
```

Cada omitida lleva la fila completa (código y nombre normalizados; el resto **tal como vino**, para que la corrección en el archivo sea literal). Motivos (`MotivoOmisionTienda` en `src/lib/tiendas/tipos.ts`): `codigo_vacio`, `nombre_vacio`, `fila_total`, `tipo_invalido`, `fecha_apertura_invalida`, `fecha_cierre_invalida`, `cierre_sin_apertura`, `cierre_antes_de_apertura`, `venta_invalida`, `venta_en_cd`, `nombre_repetido`, `duplicada_en_archivo`; etiquetas en `ETIQUETA_MOTIVO_OMISION_TIENDA` (`tipos-api.ts`). "Con errores" son todos menos `duplicada_en_archivo`.

## Pantallas

Ruta `/maestros/tiendas`. En `src/lib/nav.ts` se quita `pendiente: "M4"` del item "Tiendas y aperturas"; conserva `roles: PLANIFICACION` (decisión registrada: M2–M4 son de admin y planner; mostrarlo al comprador es una línea, pregunta abierta 9). `page.tsx` servidor redirige a `/` si `perfilActual()` no es `ok` o `!puedeEditarMaestros(rol)`, igual que `catalogos/page.tsx`, y pasa `rol` al panel cliente `tiendas-panel.tsx`.

Un solo panel con tres pestañas (`Tabs`): **Tiendas · Calendario · Importar**. Encima, resumen `11 tiendas · 1 CD · 9 activas · 2 planificadas · 0 cerradas · 1 sin fecha de apertura` (calculado en memoria sobre la colección cargada con `useColeccion<TiendaFila>("/api/tiendas?incluir_inactivos=1")`) y el interruptor **Mostrar inactivos** (`Switch`), compartido por Tiendas y Calendario. Admin y planner tienen exactamente las mismas acciones en este módulo.

### Pestaña Tiendas

**Formulario de alta** (`Card` "Nueva tienda"), en una fila de campos como en `/usuarios`:

| Campo | Control | Validación visible |
|---|---|---|
| Código | `Input` monoespaciado, obligatorio | vista previa "se guardará como R401"; vacío tras normalizar → "El código es obligatorio" |
| Nombre | `Input`, obligatorio | vista previa normalizada (`VistaPreviaNombre`) |
| Tipo | `Select` Tienda / Centro de Distribución | al elegir CD se vacía y deshabilita Venta esperada |
| Zona | `Input` con `<datalist>` de zonas ya usadas | opcional |
| Razón social | `Input` con `<datalist>` de razones ya usadas | opcional |
| Fecha de apertura | `Input type="date"` | opcional; `hint` "Sin fecha, la tienda queda Planificada" |
| Fecha de cierre | `Input type="date"`, `min` = apertura | deshabilitada sin apertura; anterior a apertura → "La fecha de cierre no puede ser anterior a la de apertura." |
| Venta esperada (S/ por mes) | `Input type="number" step="0.01" min="0"` | `hint` "Solo para tiendas que aún no abren: M7 la usa en lugar del histórico"; deshabilitada en CD |

Debajo del formulario, antes de guardar, un `Badge` con el estado que tendrá la tienda según las fechas escritas ("Quedará Planificada" / "Activa" / "Cerrada"), calculado con `estadoTienda` y `hoy` del cliente. Tras crear: `Alert` de éxito y el formulario se limpia conservando zona y razón social (para cargar varias de la misma zona seguidas).

**Filtros**, encima de la tabla: `Chips` por tipo (Todas · Tiendas (11) · CD (1)), `Chips` por estado (Todos · Activas (9) · Planificadas (2) · Cerradas (0)) con conteos, `Select` de zona (Todas · las zonas existentes · "Sin zona") y buscador por texto que compara contra `codigo` (`aCodigo` del texto) y `nombre` normalizado.

**Tabla** (`DataTable`), por código:

| Columna | Lectura | Edición en línea |
|---|---|---|
| Código | `code` | `Input` |
| Nombre | negrita | `Input` |
| Tipo | `Badge` tono `marca` "CD" o texto "Tienda" | `Select` |
| Zona | texto o `—` | `Input` con `datalist` |
| Razón social | texto o `—` | `Input` con `datalist` |
| Apertura | `dd/mm/aaaa` o `—` | `Input type="date"` |
| Cierre | `dd/mm/aaaa` o `—` | `Input type="date"` |
| Venta esp. | `S/ 85 000.00` (`Intl.NumberFormat("es-PE")`) o `—` | `Input type="number"`, deshabilitado en CD |
| Estado | `Badge`: Activa (`exito`), Planificada (`marca`), Cerrada (`alerta`); si `activo = false`, "Desactivada" (`neutro`) en lugar del estado | — |
| Acciones | — | Editar · Guardar/Cancelar · Desactivar/Reactivar · Eliminar |

- Todo se edita con Editar → Guardar (un `PATCH` con los campos cambiados); no hay guardado al instante porque cambiar una fecha cambia el estado y conviene ver el badge previsto antes de confirmar. Mientras se edita, el badge de Estado muestra el estado que resultará.
- Los errores `400/404/409` de la API se muestran con `Alert` tal cual llegan; `motivoRechazoTienda` corre antes en el cliente para deshabilitar Guardar con el motivo en `title`.
- Eliminar pide `confirm`; en M4 siempre está habilitado (sin hijos). Desactivar pide `confirm` solo si la tienda está Activa ("La tienda sigue abierta. Si cerró, registra la fecha de cierre en lugar de desactivarla.") para que no se confunda desactivar con cerrar.
- Vacío: "Sin tiendas. Crea la primera o importa el archivo de códigos de tiendas."

### Pestaña Calendario

Carga `GET /api/tiendas/aperturas` (con `incluir_inactivos` según el interruptor) y pinta la línea de tiempo agrupada por mes con la función pura `agruparPorMes(eventos)` (`src/lib/tiendas/aperturas.ts`; etiqueta de mes con `Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" })`, "marzo de 2027").

- Encima: tarjetas `Próximas aperturas (N)` · `Próximos cierres (M)` · `Sin fecha de apertura (K)` del `resumen`; la tercera, si `K > 0`, en tono `alerta` con la lista de códigos y un enlace que abre la pestaña Tiendas filtrada por Planificadas.
- Campo opcional **Ver la red al día** (`Input type="date"`, por defecto hoy): cambia `?hoy=` y recalcula estados y `pasado`; sirve para responder "¿cuántas tiendas tendré abiertas en marzo?" y para el hito.
- Lista por mes, cada evento en una fila: fecha (`dd/mm`) · `Badge` **Apertura** (`exito`) o **Cierre** (`alerta`) · código · nombre · zona · venta esperada si es apertura y la tiene · `Badge` del estado actual de la tienda. Un separador **Hoy** entre lo pasado y lo futuro; los eventos pasados atenuados. Por defecto se muestran los últimos 12 meses y todo el futuro; botón "Ver todo el historial" quita el corte (es un filtro en memoria sobre la misma respuesta).
- Vacío: "Sin fechas registradas. Carga las fechas de apertura en la pestaña Tiendas."

### Pestaña Importar

Mismo flujo de cuatro pasos de M1 y M2 con las piezas de `src/components/importador/`: 1. Archivo (CSV/Excel, selector de hoja) → 2. Mapeo (CODIGO y NOMBRE obligatorios; los otros seis opcionales, con la nota "las columnas que no mapees entran vacías: tipo Tienda, sin zona, sin fechas") → 3. Previsualizar → 4. Aplicar, habilitado solo con una previsualización vigente del mismo archivo y mapeo; `confirm` con "Se crearán N tiendas y M centros de distribución (K sin fecha de apertura, quedarán Planificadas). Quedarán fuera E filas con errores. R repetidas se cargan una sola vez."

Reporte: tarjetas `Se crearán` (tiendas, CD, sin fecha de apertura en tono `alerta` si > 0) · `Ya existían` · `Existentes inactivas (no se tocan)` · `Omitidas` (con errores / repetidas); bloque **Filas con errores** con filtro por motivo, aviso "Estas filas NO se cargarán…", botón **Descargar omitidas (CSV)** (BOM); bloque **Repetidas en el archivo**; bloque **Diferencias con lo ya cargado** (tabla `fila · código · campo · en la base · en el archivo`, con el aviso "El importador no modifica tiendas existentes; cámbialas desde la pestaña Tiendas"); muestra de tiendas que se crearán con su estado. "Nada nuevo que crear" cuando `crear.tiendas + crear.centros_distribucion = 0`.

Ejemplo de archivo que el importador debe aceptar tal cual (forma del archivo de V1 más una apertura futura inventada; **no es semilla**, la lista oficial la da Javier):

```
Cod.Tda,Tda#,Tienda,Zona,Razon Social,Tipo,Fecha Apertura,Fecha Cierre,Venta Esperada
R401,101,LUKERS IQUITOS LORES,LUKERS SUR ORIENTE,LUKERS ORIENTE SAC,,15/03/2019,,
R500,,LUKERS CENTRAL,,LUKERS SAC,Tienda,01/06/2010,,
R510,101,LUKERS CHICLAYO P. RUIZ,LUKERS CENTRO NORTE,LUKERS SAC,,,,
R512,,LUKERS AREQUIPA,LUKERS SUR ORIENTE,LUKERS SAC,,01/03/2027,,"S/ 85,000.00"
RD50,,CD LUKERS,,LUKERS SAC,CD,,,
```

→ R401 Activa; R500 Activa; R510 **sin fecha de apertura** (Planificada, contada en el aviso); R512 Planificada con 85 000; RD50 CD. `Tda#` se ignora en el mapeo.

## Reglas de negocio

Funciones puras en `src/lib/tiendas/` probadas en `tests/tiendas.*.test.ts`. Normalización y códigos se toman de `src/lib/arbol/normalizar.ts`; `codigoUnico` no hace falta (el código no se deriva, así que no hay colisiones que resolver: dos códigos iguales son la misma tienda).

**`estado.ts`**

1. `estadoTienda(t, hoy)`: sin apertura → `Planificada`; apertura `2026-10-06` con hoy `2026-10-05` → `Planificada`; **apertura = hoy → `Activa`**; apertura pasada y sin cierre → `Activa`; cierre futuro → `Activa`; **cierre = hoy → `Activa`** (último día con venta); cierre `2026-10-04` con hoy `2026-10-05` → `Cerrada`; sin apertura pero con cierre pasado (fila imposible por el `check`, pero la función no revienta) → `Planificada` (la regla 1 manda). Un CD sin fechas → `Planificada`.
2. `hoyLima()` devuelve `aaaa-mm-dd` en `America/Lima`: con `Date` fijada a `2026-10-05T23:30:00-05:00` (= `2026-10-06T04:30Z`) devuelve `2026-10-05`.
3. `esEstadoTienda` y `esTipoTienda` aceptan solo los valores exactos de `ESTADOS_TIENDA` y `TIPOS_TIENDA` (`"activa"` en minúsculas no es estado).

**`reglas.ts`**

4. `motivoRechazoTienda(fila)` sobre la fila resultante (alta, o actual más cambio): cierre sin apertura → "Para registrar un cierre, la tienda necesita fecha de apertura." (`path: ["fecha_cierre"]`); cierre < apertura → "La fecha de cierre no puede ser anterior a la de apertura."; cierre = apertura → permitido (abrió y cerró el mismo día); CD con venta esperada → "Un centro de distribución no lleva venta esperada: quítala primero." (`path: ["venta_esperada_promedio"]`); venta negativa → rechazo; si no, `null`. Un `PATCH` que solo cambia `nombre` sobre una fila coherente nunca se rechaza.
5. `motivoRechazoEliminar("tienda", 0) === null`; con `3` → "No se puede eliminar la tienda: tiene 3 registros de venta o stock. Desactívala." (el conteo lo aportará M5; en M4 el handler pasa `0`).
6. Código obligatorio y no derivado: `crearTiendaSchema` sin `codigo` → error "El código es obligatorio"; con `codigo: "r-401"` → `R_401`; con `codigo: "---"` → error; el nombre nunca se usa para proponer código (test explícito: dos cuerpos con el mismo nombre y códigos distintos pasan los dos).

**`fechas.ts`**

7. `leerFecha`: `"15/03/2019"`, `"15-03-2019"`, `"15.03.2019"`, `"2019-03-15"`, `"2019/03/15"` → `"2019-03-15"`; `"5/3/19"` → `"2019-03-05"`; `"03/05/2026"` → `"2026-05-03"` (día primero, nunca mes primero); `""` y `"  "` → `null`; `"31/02/2024"`, `"2024-13-01"`, `"ayer"`, `"20240315"` → `"invalida"`. Nunca pasa por `new Date(texto)` (su parseo depende del motor y de la zona horaria).
8. `leerMonto`: `""` → `null`; `"85000"` → `85000`; `"S/ 12,500.00"` → `12500`; `"S/.1,250.5"` → `1250.5`; `"12.345"` → `12.35` (punto decimal, redondeo a dos); `"-5"`, `"12,5"` (coma no seguida de tres dígitos), `"abc"` → `"invalido"`.
9. `leerTipo`: `""`, `"tienda"`, `"T"` → `Tienda`; `"CD"`, `"Centro de Distribución"`, `"CENTRO DE DISTRIBUCION"`, `"Almacén"` → `Centro de Distribución`; `"deposito"`, `"X"` → `null`.

**`aperturas.ts`**

10. `eventosTiendas(tiendas, hoy)`: una tienda con apertura y cierre produce dos eventos; sin fechas, ninguno; el orden es por `fecha` y luego `codigo`; `pasado` es `fecha < hoy` (apertura hoy → `pasado: false`, cierre hoy → `pasado: false`); cada evento lleva el `estado` de su tienda a la fecha `hoy`; `resumen.proximas_aperturas` y `proximos_cierres` cuentan eventos no pasados; `resumen.sin_fecha_apertura` cuenta tiendas activas de tipo Tienda sin apertura (un CD sin fecha no cuenta).
11. `agruparPorMes(eventos)` devuelve grupos `{ mes: "2027-03", etiqueta: "marzo de 2027", eventos }` ordenados cronológicamente, sin meses vacíos, y la suma de eventos de los grupos es igual al total recibido.

**`importar.ts` — `planificarImportacionTiendas(filas, estado, hoy)`**

12. Filas con código vacío, nombre vacío o `TOTAL` se omiten antes de cualquier otra comprobación y no cuentan como duplicadas.
13. Tipo, fechas y venta inválidos se omiten con su motivo y el valor original en `detalle`, aunque código y nombre sean válidos; una fila con las tres cosas mal se omite una sola vez, por el primer motivo en el orden tipo → apertura → cierre → coherencia de fechas → venta.
14. Duplicadas por código (sin distinguir caja ni `_`/`-`: `r-401` y `R401` no son iguales, `r401` y `R401` sí) cuentan una vez, `fila_original` apunta a la primera y `detalle` dice en qué difieren si difieren. `nombre_repetido` sale cuando otro código (en la base o antes en el archivo) ya tiene ese nombre normalizado.
15. Tienda existente (activa o inactiva) nunca entra en `crear`; se cuenta en `existentes` o `existentes_inactivos` y, si difiere en cualquier campo, aparece en `diferencias` con `en_base` y `en_archivo` legibles (una diferencia por campo). El plan **no** modifica ni reactiva nada; `plan.crear` nunca contiene `activo`.
16. `crear.sin_fecha_apertura` cuenta solo tiendas nuevas de tipo Tienda sin apertura; un CD sin apertura no suma. `crear.centros_distribucion ≤ crear.tiendas + crear.centros_distribucion`, y `muestra.tiendas[i]` lleva el estado calculado con `hoy`.
17. **Idempotencia**: `planificarImportacionTiendas(filas, aplicarPlanTiendas(estado, plan), hoy)` devuelve `crear` todo en cero, `existentes.tiendas` igual a lo creado antes y `diferencias = []`; aplicar dos veces el mismo plan produce el mismo estado.
18. Conteos consistentes: `recibidas = procesadas + omitidas`; `procesadas = crear.tiendas + crear.centros_distribucion + existentes.tiendas + existentes_inactivos.tiendas`.

**`esquemas.ts`**

19. `crearTiendaSchema` normaliza nombre, zona y razón social (vacíos → `null`); acepta fechas solo como `aaaa-mm-dd` (el cliente ya convirtió; `"15/03/2019"` → `400`); `tipo` por defecto `Tienda`; rechaza venta negativa y cuerpos incoherentes con el mensaje de `motivoRechazoTienda`. `editarTiendaSchema` rechaza el cuerpo vacío y acepta `activo`.

## Hito de prueba

- [ ] Checks automáticos: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (los de M1–M3 más `tests/tiendas.*`), `npm run build` y `scripts/validar-migraciones-local.sh` (todas las migraciones dos veces) en verde.
- [ ] `0004_tiendas.sql` aplicada dos veces en `vector-two` sin error, sin ningún `DROP` y sin bloques `do $$`; tipos regenerados; `APP_VERSION` = `0.5.0 · M4`.
- [ ] Tras la migración: `select count(*) from tiendas` = 0 (sin semilla); `GET /api/tiendas` devuelve `[]`; el menú muestra "Tiendas y aperturas" habilitado para admin y planner; el comprador no lo ve, `/maestros/tiendas` le redirige a `/`, `GET /api/tiendas` le responde `200` y `POST /api/tiendas` `403`.
- [ ] Como planner, crear a mano `r401` / `  lukers iquitos lores ` / Tienda / zona `lukers sur oriente` / apertura 15/03/2019 → se guarda `R401`, `LUKERS IQUITOS LORES`, `LUKERS SUR ORIENTE`, badge **Activa**. Crear `R401` de nuevo con otro nombre → `409` "Ya existe una tienda con ese código."; crear `R999` con nombre `Lukers Iquitos Lores` → `409` por nombre.
- [ ] Crear `RD50` / `CD LUKERS` / Centro de Distribución: el campo Venta esperada se deshabilita; `POST /api/tiendas` a mano con `tipo: "Centro de Distribución"` y `venta_esperada_promedio: 1000` → `400` "Un centro de distribución no lleva venta esperada". El CD aparece con badge "CD" y, sin fechas, estado Planificada (ver pregunta 5).
- [ ] **Hito del plan — tienda futura**: crear `R512` / `LUKERS AREQUIPA` con apertura = mañana y venta esperada `85000` → badge **Planificada**, el formulario anticipa "Quedará Planificada". En Calendario, con "Ver la red al día" = mañana, R512 aparece **Activa** y su apertura en el mes correspondiente sin `pasado`; `GET /api/tiendas?hoy=<mañana>` la devuelve con `estado: "Activa"`. Editar su apertura a hoy → badge **Activa** sin tocar nada más.
- [ ] Cierre: a `R401` ponerle cierre = hoy → sigue **Activa**; cierre = ayer → **Cerrada** y la tabla la muestra con `activo = true` (no se desactivó); chip "Cerradas (1)". Intentar cierre anterior a la apertura → Guardar deshabilitado con el motivo y, forzando el `PATCH` a mano, `400` "La fecha de cierre no puede ser anterior a la de apertura."; `PATCH` con `fecha_cierre` sobre una tienda sin apertura → `400` "…necesita fecha de apertura."
- [ ] Desactivar una tienda Activa → `confirm` avisa que cerrar no es desactivar; tras aceptar, badge "Desactivada", desaparece sin "Mostrar inactivos" y `GET /api/tiendas` no la trae; con `?incluir_inactivos=1` sí. Reactivar la devuelve con su estado calculado.
- [ ] Eliminar una tienda recién creada → funciona (en M4 no hay hijos). `DELETE /api/tiendas/abc` → `404`.
- [ ] Filtros: chips de tipo y estado con conteos correctos; `Select` de zona con las zonas existentes y "Sin zona" (el CD); buscador `iqui` encuentra `R401`; `GET /api/tiendas?estado=Planificada` devuelve solo las planificadas; `?estado=activa` (minúsculas) → `400`; `?hoy=ayer` → `400`.
- [ ] Calendario: tarjetas "Próximas aperturas", "Próximos cierres" y "Sin fecha de apertura" con los conteos esperados; la lista agrupa por mes en español, separador "Hoy" en su sitio, pasados atenuados; "Ver todo el historial" muestra la apertura de 2019.
- [ ] Importar un CSV de prueba (forma del ejemplo de la ficha, sin datos reales de Lukers) con, a propósito: una fila con `Tda#` que no se mapea, un código repetido, un nombre repetido con otro código, una fecha `31/02/2024`, una venta `S/ 12,500.00`, un tipo `deposito`, una tienda sin fecha de apertura, una tienda que ya existe con otra zona y una fila `TOTAL`. Previsualizar: el mapeo autodetecta las ocho columnas; `S/ 12,500.00` se lee como 12 500; las filas malas salen en "Filas con errores" con motivo, detalle y fila completa; la repetida en "Repetidas"; la existente en "Diferencias con lo ya cargado"; la tarjeta "Se crearán" avisa "K sin fecha de apertura"; "Descargar omitidas (CSV)" abre en Excel con acentos correctos.
- [ ] Aplicar: el `confirm` repite los conteos; el reporte final coincide con la previsualización; la pestaña Tiendas muestra las nuevas con su estado; la existente **no** cambió de zona.
- [ ] Reimportar el mismo archivo: `crear` en cero, "Nada nuevo que crear", las mismas omitidas y diferencias, y `select count(*) from tiendas` no cambia después de aplicar.
- [ ] Importar un archivo con solo `CODIGO` y `NOMBRE`: Previsualizar se habilita; todas entran como Tienda sin fechas y la tarjeta avisa que quedarán Planificadas.

## Fuera de alcance

- Venta y stock por tienda, y el `409` al eliminar tiendas con histórico (M5). M4 deja el código de tienda como clave de resolución y `activo` como criterio de rechazo.
- Proyección de tiendas nuevas y corte de las cerradas (M7); M4 solo deja `venta_esperada_promedio`, las fechas y el estado derivado.
- Asignación de tiendas a un centro de distribución (qué CD abastece a qué tienda). V1 la tuvo y la quitó porque con un solo CD no distinguía nada; si M8 necesita flujos por CD, se agrega `centro_distribucion_id` en ese momento.
- Zonas y razones sociales como catálogos con FK (pregunta abierta 3).
- Ciclos múltiples de apertura y cierre (tienda que cierra y reabre): hoy una tienda es un solo ciclo; si ocurre, se decide entre editar las fechas (pierde el histórico del primer ciclo) o una tabla `periodos_tienda` (pregunta abierta 8).
- Que el importador actualice tiendas existentes (solo reporta `diferencias`; pregunta abierta 7, compartida con M2).
- Atributos físicos o comerciales de la tienda (metros cuadrados, formato, centro comercial, dirección): no se han pedido y M7 no los usa.
- Auditoría de quién cambió qué (pendiente desde M0).
- Visibilidad de tiendas para el comprador (pregunta abierta 9).

## Decisiones nuevas propuestas

Para que el `documentador` las registre en `docs/DECISIONES.md` cuando Javier apruebe la ficha; ninguna contradice una entrada vigente:

1. **El estado de la tienda se calcula, no se guarda.** `estadoTienda(tienda, hoy)` a partir de `fecha_apertura` y `fecha_cierre`, con `hoy` en `America/Lima`. Por qué: en V1 era una columna y las tiendas no cambiaban de estado al abrir. Descartado: columna `estado` mantenida por un job diario (otra pieza que falla en silencio); trigger que la recalcule (no sabe qué día es "hoy" para el usuario).
2. **`activo` no es "cerrada".** Una tienda cerrada conserva `activo = true` y su histórico; desactivar es administrativo. Descartado: desactivar al cerrar (M5 no podría cargar su histórico y M7 no sabría desde cuándo dejó de vender).
3. **La fecha de cierre es el último día con venta y exige fecha de apertura.** Descartado: cierre como primer día cerrado (menos natural al hablar: "cerró el 31"); cierre sin apertura (no informa a la proyección).
4. **El código de tienda lo pone el usuario o el archivo; no se deriva del nombre.** Es el identificador con el que llegan venta y stock. Descartado: proponerlo desde el nombre como en el árbol (inventaría códigos que no existen en los sistemas de Lukers).
5. **Zona y razón social como texto libre normalizado con autocompletado.** Descartado por ahora: catálogos con FK (dos valores cada uno y ningún consumidor todavía); se promueven si la Fase 2 proyecta por zona.
6. **Sin semilla de tiendas; sin relación tienda → CD.** La red la carga Javier (pantalla o importador) y se cumple la regla "nada de datos reales en el repo". La relación con el CD no se modela hasta que haya más de uno o M8 la necesite.

## Cambios respecto a la especificación

*(Se completa al construir: lo que QA, backend y frontend encontraron que la especificación no decía o decía distinto.)*

## Preguntas abiertas para Javier

1. **Lista oficial de tiendas.** ¿Sirve el archivo *CODIGOS DE TIENDAS LUKERS* de V1 tal cual (Cod.Tda, Tda#, Tienda, Zona, Razón Social) o hay una versión nueva? ¿Trae fechas de apertura? Si no, ¿las tienes aunque sea aproximadas (mes y año) para las 11 actuales? Sin fecha de apertura una tienda se ve **Planificada** y M7 no la proyectaría con su histórico.
2. **Nombres en mayúsculas.** Las tiendas se guardarán normalizadas (`LUKERS PROLONGACIÓN IQUITOS`), como todo maestro. ¿Los archivos de venta y stock traen el **código** de tienda (`R401`) y no el nombre? El importador de M5 resolverá por código; si solo viniera el nombre, hay que saberlo ahora.
3. **Zona y razón social.** Hoy son texto libre con autocompletado (dos zonas, dos razones sociales; `LUKERS CENTRAL` sin zona). ¿En la Fase 2 vas a proyectar o reportar por zona? Si sí, conviene hacerlas catálogo con FK desde ya.
4. **Venta esperada.** La ficha la toma como **soles por mes** (como en V1). ¿Es así, o la piensas en unidades, o por semana? ¿Es venta neta o con IGV? Solo cambia la etiqueta y la fórmula de M7, pero mejor fijarlo antes de cargar valores.
5. **El centro de distribución.** ¿Lleva fecha de apertura (y por tanto estado), o lo dejamos sin fechas y la pantalla lo muestra como "CD" sin estado? Hoy, sin fechas, saldría Planificada, que es engañoso; si prefieres lo segundo, es una línea en `estadoTienda` (los CD devuelven `Activa` siempre que estén `activo`).
6. **Fecha de cierre.** La ficha la entiende como el **último día con venta** (la tienda que cierra el 31 vende el 31). ¿Es así como la registras?
7. **Tiendas existentes con datos distintos en el archivo.** Igual que en marcas: el importador no modifica lo que ya existe, solo muestra las diferencias. ¿Está bien, o quieres una opción "actualizar existentes" (se haría en M2 y M4 a la vez)?
8. **Cerrar y reabrir.** ¿Hay tiendas que cierran por un tiempo y vuelven a abrir (remodelación, cambio de local con el mismo código)? Si sí, ¿basta con editar las fechas o necesitas conservar los dos periodos?
9. **Comprador.** Hoy no ve tiendas. ¿Se las mostramos en solo lectura como el árbol?

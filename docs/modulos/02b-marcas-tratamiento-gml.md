# M2b · Nivel de planificación (GML/GMLE) y marcas relevantes por GML

> Estado: **especificación pendiente de aprobación por Javier (2026-10-12)**. No hay código ni migración. Es una **mejora de M2** ([02-marcas](02-marcas.md)) que también toca el nodo del árbol de M1 ([01-arbol-producto](01-arbol-producto.md)); versión prevista `0.8.3 · M2b`; migración prevista `0010_nivel_planificacion_marcas_gml.sql`, con lo que la de M6 pasa a `0011` (ver "Cambios en otras fichas"). **Renumeración del 2026-10-12 (dos veces)**: la `0008` y la versión `0.8.1 · M5` las toma la mejora urgente 05b de M5 ([05b-mapeo-combinaciones](05b-mapeo-combinaciones.md)), y la `0009` y la `0.8.2 · M5` la mejora 05c de M5 ([05c-ubicaciones-conciliacion](05c-ubicaciones-conciliacion.md)); ambas se construyen antes. Esta ficha decía primero `0008` / `0.8.1` y luego `0009` / `0.8.2`. **Aviso de nombre**: el "M2b" que `DECISIONES.md` descartó el 2026-10-06 era una tabla manual marca ↔ equivalencia y sigue descartado; esto es marca ↔ **nodo** género-mundo-línea, solo para las marcas que se trabajan aparte. Dependen de aquí [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (sin cambios en M3; cómo se agrega su curva al GML se define aquí), [05-venta-stock](05-venta-stock.md) (la venta ya llega al detalle de marca y equivalencia; M5 no cambia) y, como consumidores, M7 y M8. Ningún dato real de Lukers: marcas ALFA, BETA, GAMMA, DELTA; nodos y cifras inventados.

## Objetivo

Tres huecos que M7 (pronóstico) y M8 (flujo) necesitan cerrados antes de especificarse, y que hoy no tienen dueño:

1. **A qué nivel se planifica cada cosa.** La mayoría de los flujos se trabajarán a nivel **GML** (género-mundo-línea) y solo algunos se abrirán a **GMLE** (género-mundo-línea-equivalencia). Hace falta "un lugar donde definamos qué se planifica a nivel de equivalencia y qué a nivel de GML": una propiedad del nodo, editable desde el Árbol una a una, en bloque y por línea, y por archivo. Cambiar el nivel no borra nada: la venta de M5 sigue al detalle y la curva de M3 sigue por equivalencia; el nivel solo dice a qué grano se **lee** y se **planifica**.
2. **Qué marcas se ven aparte dentro de un flujo.** Javier quiere ver "mi flujo de Jeans" (un GML) y, dentro, el detalle de ALFA dentro del total de RECONOCIDO, mostrando solo las **3 o 4 marcas relevantes en ese GML**; el resto de la agrupación queda como "otras de RECONOCIDO". ALFA es fuerte en jeans y no en ternos, así que la relevancia se define por **marca × GML (nivel B)** y una marca puede ser relevante en varios GML. La hoja "marca, género, mundo, línea" que Javier describió es exactamente la lista de marcas relevantes por GML.
3. **Las marcas "al barrer"**: necesitan un flujo independiente, sin detalle por GML (marcadas y sin GML).

El módulo entrega la configuración (pantallas, bloques, importadores, una sugerencia automática a partir de la venta de M5 que **nunca** se aplica sola) y deja definido el **contrato de datos** con el que M7 y M8 armarán la vista GML → agrupaciones de marca → marcas relevantes + otras, y el flujo aparte de las marcas al barrer.

## Decidido por Javier (2026-10-12)

Entran como reglas firmes:

1. **El tratamiento especial no es de la marca entera: se define a nivel marca × GML**, y una marca puede tener más de un GML.
2. **Mecánica en dos pasos**: (1) se marcan las marcas con tratamiento especial (la casilla de M2 se mantiene y su importador vale tal cual); (2) en otra hoja o archivo se les asignan los GML (columnas `MARCA`, `GENERO`, `MUNDO`, `LINEA`), con pantalla de asignación en Marcas (alta y baja individual y por bloque, filtros, vista inversa desde el GML).
3. **Dos tipos de marca especial**: (a) con GML asignados → flujo especial en esos GML; (b) "al barrer" → flujo independiente sin detalle por GML.
4. **M5 no cambia.** Esto alimenta M7 y M8.
5. **Nivel de planificación**: la mayoría a GML, algunas cosas a GMLE; hay que poder definir cuál es cuál.
6. **Vista del flujo por GML con marcas relevantes**: en un GML, dentro de cada agrupación de marca, solo las 3-4 marcas relevantes y el resto como "otras de la agrupación".

## Conceptos

- **GML** = nodo `genero_mundo_linea` de M1 (~556 hoy). **GMLE** = una equivalencia de ese nodo (~1 790, genéricas incluidas).
- **Nivel de planificación** de un nodo: `GML` (por defecto: el flujo del nodo es una sola unidad, suma de sus equivalencias) o `GMLE` (el nodo se abre: una unidad por equivalencia activa). Vive en `genero_mundo_linea.nivel_planificacion`.
- **Unidad de planificación**: lo que M7 proyecta y M8 fluye como una fila. Un nodo `GML` es una unidad; un nodo `GMLE` son tantas como equivalencias activas tenga (la genérica `SIN EQUIVALENCIA` incluida, si tiene venta).
- **Marca relevante en un GML**: par de `marca_gml_especial`. Dentro de la unidad, en su agrupación de marca, esa marca se muestra y se planifica aparte; las demás marcas de la agrupación son **"otras de la agrupación"**. En un nodo `GMLE` la relevancia sigue siendo por GML (nivel B) y se aplica dentro de cada equivalencia.
- **Marca al barrer**: marca marcada con modalidad `barrido`. Su venta y su stock van a un flujo propio, fuera de las unidades de planificación de los GML (pregunta abierta 12).
- **Modalidad** (`marcas.modalidad_tratamiento`): `por_gml` (relevante en los GML asignados) o `barrido`. Solo con la casilla, igual que la nota.
- **Casilla `tratamiento_especial`** (M2): sigue existiendo y significa "esta marca se trabaja aparte en algún flujo". La API la mantiene coherente: una marca es marcada si es al barrer o si es relevante en algún GML (ver "La casilla sigue haciendo falta").
- **Asignación vigente** = marca vigente (`marcaVigente` de M2) y marcada en `por_gml`, y GML vigente (`nodoVigente`: nodo, género, mundo y línea activos). Lo demás son asignaciones **ignoradas**, que se conservan, se muestran con su motivo y nunca se borran solas.

### Por qué el nivel vive en el nodo y se abre por nodo entero

| Opción | Qué permite | Qué cuesta | Veredicto |
|---|---|---|---|
| **(a) Columna en `genero_mundo_linea`, por nodo entero** (recomendada) | "Este GML se planifica por equivalencia": todas sus equivalencias activas son unidades | Una columna con `default 'GML'`, cero tablas; se edita donde se ve el nodo (Árbol), en bloque y por línea; M7 y M8 leen un valor por nodo | **Sí** |
| (b) Bandera por equivalencia (`equivalencias.planificar_aparte`) | Abrir solo DENIM SLIM dentro de HOMBRE·URBANO·DENIM y dejar el resto en un "resto del GML" | Crea un tercer grano (GML parcial = unidad GML menos las abiertas) que M7, M8 y las pantallas tienen que entender; 1 790 banderas que editar; el "resto" cambia cada vez que se abre una equivalencia | No ahora; si Javier lo necesita es una columna más y una fila más en `claveFlujo` (pregunta 13) |
| (c) Tabla aparte `nivel_planificacion (nodo_id, nivel)` | Historial de cambios | Nada que (a) no dé; una tabla sin dueño | No |

Es el mismo criterio que `lineas.temporada` o `tiendas.tipo`: una propiedad del maestro, guardada en el maestro.

### Por qué la modalidad es un campo explícito y no "ausencia de GML = al barrer"

Las dos lecturas coinciden cuando todo está configurado; se diferencian en los estados intermedios, que son justo los que M7 y M8 leerán sin que nadie mire:

| Situación | "Ausencia de GML = barrido" | Campo explícito |
|---|---|---|
| Marca recién marcada (la lista de marcas se carga antes que la hoja de GML) | Es barrido en silencio: si M7 corre en medio, la marca entera sale de su agrupación | Es `barrido` por defecto (lo que Javier describe) y pasa a `por_gml` al recibir GML; nunca hay que adivinar |
| Marca `por_gml` cuyos GML quedaron todos no vigentes (se desactivó una línea) | Cambia sola a barrido: un cambio de flujo por una desactivación en otra pantalla | Sigue `por_gml` sin unidades: la pantalla la lista como **pendiente** (`sin_gml`) y M7 la deja en "otras" |
| Pasar una marca con GML a barrido conservando los GML por si vuelve | Imposible sin borrar | Es cambiar la modalidad; las asignaciones quedan ignoradas y vuelven al cambiarla |
| Lo que leen M7 y M8 | Deben contar asignaciones | Un campo; la vista `marca_gml_especial_vigente` lo resuelve |

### La casilla `tratamiento_especial` sigue haciendo falta (recomendación)

Pregunta del día: con la asignación marca × GML, ¿basta la asignación o hace falta la casilla? **Las dos cosas, con significado preciso:**

- La **asignación** dice *dónde* una marca es relevante (nivel B). Es la lista de marcas relevantes por GML.
- La **casilla** dice *que* la marca se trabaja aparte, y es imprescindible para el tipo (b): una marca al barrer no tiene GML, así que sin casilla no habría forma de marcarla. Además la trae el importador de M2 (`TRATAMIENTO_ESPECIAL`), que Javier confirmó que usará, y la decisión del 2026-10-05 la fijó.
- Lo que cambia respecto a M2 es que **la API la mantiene coherente**: asignar un GML a una marca sin casilla la **marca automáticamente** en `por_gml` (en pantalla con `confirm`, en el importador listado en "Se marcarán N marcas"); desmarcarla conserva sus GML como ignorados. Así la hoja de GML puede ser el único archivo para el tipo (a) (la lista de marcas con `SI` solo hace falta para las de tipo (b)), y la sugerencia automática no choca con marcas sin marcar. Es la respuesta a la validación 4 que Javier dejó abierta: **no** se exige marcar antes; el sistema marca y avisa (pregunta 4, con la alternativa de rechazar).

Descartado: quitar la casilla y dejar solo la modalidad (rompe el importador de M2 y la decisión registrada); casilla derivada por columna generada (el tipo (b) necesita marcarse a mano).

## Modelo de datos

Migración `supabase/migrations/0010_nivel_planificacion_marcas_gml.sql` (antes `0008` y luego `0009`; renumerada el 2026-10-12 por 05b y 05c), idempotente, **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`** (no hay backfill: las columnas nuevas llevan `default` o se leen con regla), sin bloques `do $$`, triggers con `create or replace trigger`, vista y función con `create or replace`, RLS activo sin políticas. Convenciones de PLAN §4. `tratamiento_especial` y `nota_tratamiento` **se conservan tal cual**.

### `genero_mundo_linea` (columna nueva, M1)

| Columna | Tipo | Notas |
|---|---|---|
| `nivel_planificacion` | `text not null default 'GML'` | `alter table … add column if not exists` con `constraint genero_mundo_linea_nivel_check check (nivel_planificacion in ('GML', 'GMLE'))`. El `default` rellena los 556 nodos existentes sin reescritura ni `update` (Postgres ≥ 11) |

Sin índice (dos valores, 556 filas; el filtro "abiertos a GMLE" se hace en memoria con el árbol). Cambiar el nivel no toca equivalencias, curvas (M3) ni hechos (M5).

### `marcas` (columna nueva, M2)

| Columna | Tipo | Notas |
|---|---|---|
| `modalidad_tratamiento` | `text null` | `add column if not exists` con dos checks inline: `marcas_modalidad_valor_check (modalidad_tratamiento is null or modalidad_tratamiento in ('por_gml', 'barrido'))` y `marcas_modalidad_sin_tratamiento_check (modalidad_tratamiento is null or tratamiento_especial)`. Sin `default` |

**Por qué el check es en un solo sentido** (modalidad ⇒ casilla, no casilla ⇒ modalidad). El sentido inverso exigiría rellenar las marcas ya marcadas antes del check, es decir un `update` en la migración, que conviene evitar con `execute_sql` del MCP (la `0005` solo hizo `insert … on conflict do nothing`). La garantía inversa la da la API: **toda escritura que deje la casilla encendida escribe una modalidad** (regla 2) y toda lectura pasa por `modalidadEfectiva(marca) = modalidad_tratamiento ?? 'barrido'` (regla 1): una fila con casilla y modalidad nula (solo desde el SQL Editor o heredada de antes de `0010`) se lee como `barrido`, la interpretación que Javier dio para "marcada y sin GML" (pregunta 3). La pantalla la muestra "Sin modalidad (se toma al barrer)" con un `Select` que la fija. Hoy la lista real aún no se ha cargado (PLAN §7): no habrá filas heredadas.

### `marca_gml_especial` (marcas relevantes por GML)

Nombre que dio Javier; en la pantalla se llama "marcas relevantes por GML" (pregunta 11 por si prefiere `marca_relevante_gml`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `marca_id` | `uuid not null references marcas(id) on delete cascade` | `marca_gml_especial_marca_id_fkey`. **Cascade**: la relevancia es un atributo de la marca (criterio de `responsables_genero_mundo.perfil_id`); eliminar una marca (solo posible sin venta, M5) se lleva sus GML y el `confirm` lo dice |
| `genero_mundo_linea_id` | `uuid not null references genero_mundo_linea(id) on delete restrict` | `marca_gml_especial_gml_id_fkey`. **Restrict**: el nodo es árbol y no arrastra configuración; eliminar un nodo con marcas responde `409` |
| `nota` | `text null` | `marca_gml_especial_nota_len_check (nota is null or length(nota) between 1 and 200)`; recortada, `""` → `null` |
| `activo` | `boolean not null default true` | **Por convención y sin uso en la API** (como `responsables_genero_mundo`, 2026-10-07): quitar borra la fila; `activo = false` se lee como ausente |
| `created_at`, `updated_at` | | trigger `set_updated_at` |

Índices: único `marca_gml_especial_par_uniq (marca_id, genero_mundo_linea_id)` e `index marca_gml_especial_gml_idx (genero_mundo_linea_id)` (vista inversa y conteo al rechazar el `DELETE` del nodo). Tamaño: 3-4 marcas × 5 agrupaciones × los GML donde importe; cientos o pocos miles de filas.

**Qué no se guarda.** Ni la vigencia (se calcula), ni la agrupación de la marca (se lee de `marcas`: si ALFA cambia de nivel, sigue siendo relevante en sus GML, ahora dentro del nuevo nivel), ni la equivalencia (nivel B), ni un orden o "principal" (M7 ordena por venta). No hay tabla para las marcas al barrer: son una modalidad.

### Vista `marca_gml_especial_vigente` (contrato SQL para M7 y M8)

`create or replace view … with (security_invoker = true)` sobre tablas con RLS sin políticas: `anon` y `authenticated` obtienen cero filas (decisión de `0007`; sin `revoke`). Una fila por marca al barrer (GML en `null`) y una por par marca × GML vigente:

```sql
select m.id as marca_id, m.agrupacion_marca_id, 'barrido'::text as modalidad, null::uuid as genero_mundo_linea_id
  from marcas m join agrupaciones_marca am on am.id = m.agrupacion_marca_id
 where m.activo and am.activo and m.tratamiento_especial and coalesce(m.modalidad_tratamiento, 'barrido') = 'barrido'
union all
select m.id, m.agrupacion_marca_id, 'por_gml', a.genero_mundo_linea_id
  from marca_gml_especial a
  join marcas m on m.id = a.marca_id join agrupaciones_marca am on am.id = m.agrupacion_marca_id
  join genero_mundo_linea n on n.id = a.genero_mundo_linea_id
  join generos g on g.id = n.genero_id join mundos mu on mu.id = n.mundo_id join lineas l on l.id = n.linea_id
 where a.activo and m.activo and am.activo and m.tratamiento_especial and m.modalidad_tratamiento = 'por_gml'
   and n.activo and g.activo and mu.activo and l.activo;
```

Una marca `por_gml` sin GML vigente **no aparece** (va a "otras" y la pantalla la persigue como pendiente). Es la misma regla que `unidadesFlujoEspecial` (regla 10); la prueba SQL comprueba que coinciden.

### Función `sugerir_marcas_relevantes` (solo ayuda)

`sugerir_marcas_relevantes(p_desde date, p_hasta date, p_top integer, p_excluir uuid[]) returns table (genero_mundo_linea_id uuid, agrupacion_marca_id uuid, marca_id uuid, unidades bigint, venta_soles numeric, participacion numeric, rango integer)`. `security definer`, `set search_path = ''`, `revoke execute from public, anon, authenticated`, `grant to service_role` (como las tres de `0007`). Agrega `venta_stock_vigente` entre `p_desde` y `p_hasta` por nodo (vía `equivalencias.genero_mundo_linea_id`), agrupación (vía `marcas.agrupacion_marca_id`) y marca, excluye `p_excluir` (los ids de VARIOS, OTROS y SIN MARCA, que M5 fija en MID VALUE y no son marcas que se planifiquen aparte), y devuelve las `p_top` primeras por `venta_soles` dentro de cada (nodo, agrupación) con `participacion = venta_soles ÷ Σ venta_soles de esa agrupación en ese nodo` y `rango` por `row_number()`. Toda la agregación en SQL (decisión de M5: ninguna lectura del histórico trae filas a Node); 2 a 5 s en Micro para doce meses, bajo demanda con botón. Devuelve como mucho ~556 × 5 × `p_top` filas. **Nunca escribe nada.**

### Diagrama

```
genero_mundo_linea.nivel_planificacion ('GML' | 'GMLE') ─────────────────────────────► unidad de planificación = nodo, o nodo × equivalencia activa
                                                                                            │
marcas.tratamiento_especial (M2) ─┬─ modalidad 'barrido' ──────────────────────────────────┼─► flujo propio de la marca (fuera de las unidades)
                                  └─ modalidad 'por_gml' ─► marca_gml_especial ◄── nodo ───┤
                                                            (marca relevante en ese GML)    ▼
venta_stock_vigente (M5: marca_id, equivalencia_id → nodo) ── join ──► unidad → agrupación de marca → [marcas relevantes] + "otras de la agrupación"
equivalencias.agrupacion_estacionalidad_id (M3) → curvas (M6) ── mezcla ponderada por equivalencia ──► curva de la unidad (GML) o directa (GMLE)
                                                                                            └─► M7 pronóstico · M8 flujo
sugerir_marcas_relevantes(venta M5) ─► pantalla Sugerencias ─► el planner elige ─► marca_gml_especial (nunca automático)
```

## Contratos de API

Convenciones de M1 a M5: `{ data }` con `ok()` y `{ error }` con `error()` (`src/lib/api/respuestas.ts`), cuerpos con `leerCuerpo`, esquemas zod (`src/lib/arbol/esquemas.ts` y `src/lib/marcas/esquemas.ts` se amplían; lo nuevo en `src/lib/marcas/gml/esquemas.ts` y `src/lib/arbol/nivel/esquemas.ts`), `idDeRuta`, `traducirErrorDb`, `leerTodo`. Lógica pura en `src/lib/arbol/nivel/` (`reglas.ts`, `importar.ts`) y `src/lib/marcas/gml/` (`reglas.ts`, `asignar.ts`, `vista.ts`, `importar.ts`, `flujo.ts`, `curva.ts`, `tipos.ts`, `tipos-api.ts`); datos en `consultas.ts` de cada carpeta. **Guards**: todas las escrituras `requirePlanner`; las lecturas nuevas de marcas relevantes y sugerencias también `requirePlanner` (configuración de planificación; las sugerencias leen venta, criterio de M5); el nivel de planificación viaja en `GET /api/arbol` (`requireUser`, vocabulario del árbol que el comprador ya ve). Errores comunes: `401` · `403` · `400` zod o `check` · `404` · `409` · `500`.

`errores-db.ts` suma: único `marca_gml_especial_par` → `409 "Esa marca ya es relevante en ese GML."`; checks `genero_mundo_linea_nivel` → `400 "El nivel de planificación debe ser GML o GMLE."`, `marcas_modalidad_valor` → `400 "La modalidad debe ser por_gml o barrido."`, `marcas_modalidad_sin_tratamiento` → `400 "La modalidad solo se guarda si la marca tiene tratamiento especial."`, `marca_gml_especial_nota_len` → `400 "La nota no puede superar 200 caracteres."`; FK `marca_gml_especial_gml_id_fkey` → eliminar `409 "No se puede eliminar el nodo: tiene marcas relevantes asignadas. Quítalas o desactívalo."`, asignar `404 "Nodo género-mundo-línea no encontrado."`; `marca_gml_especial_marca_id_fkey` → asignar `404 "Marca no encontrada."`.

### Nivel de planificación (M1)

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/arbol` | GET | `requireUser` | — | cada nodo suma `nivel_planificacion`; `resumen` suma `nodos_gmle` y `equivalencias_en_gmle` (activas en nodos vigentes abiertos) |
| `/api/arbol/nodos/[id]` | PATCH | `requirePlanner` | `editarNodoSchema` suma `nivel_planificacion: z.enum(["GML","GMLE"])` | nodo actualizado; `404` |
| `/api/arbol/nodos/nivel` | POST | `requirePlanner` | `nivelBloqueSchema` = `{ nivel: enum, nodo_ids: uuid[] (1..600) }` | `{ nivel, cambiados, sin_cambio, no_encontrados: uuid[] }`. Nodos no vigentes se cambian igual (es una propiedad; no hay nada que proteger). `update … in (ids)` en tandas de 150 |
| `/api/arbol/nodos/nivel/importar` | POST | `requirePlanner` | `importarNivelSchema` (abajo) | reporte |

**Importador de nivel.** Columnas `GENERO`, `MUNDO`, `LINEA`, `NIVEL` (alias `NIVEL_PLANIFICACION`, `PLANIFICAR_POR`; valores `GML`, `GMLE`, y como sinónimos `LINEA`/`EQUIVALENCIA`). Resolución de género, mundo, línea y nodo con la misma función `resolverGml(fila, estado)` que usa el importador de marcas relevantes (abajo; vive en `src/lib/arbol/nivel/resolver.ts` y la comparten). **Aquí el archivo manda** (como el importador de estacionalidad al reasignar): un nodo con nivel distinto se cambia y la previsualización lo lista en `cambios[]` (`de → a`); nodos ausentes del archivo no se tocan; reimportar no cambia nada. Motivos de omisión: los de `resolverGml` (`genero_vacio`, `genero_desconocido`, `genero_inactivo`, `mundo_*`, `linea_*`, `gml_inexistente`, `gml_inactivo`, `fila_total`) más `nivel_vacio`, `nivel_invalido` y `duplicada_en_archivo` (con `fila_original`; si el nivel difiere, `detalle`). Reporte: `totales`, `cambios[]` (`{ fila, ruta, de, a }`), `sin_cambio`, `omitidas[]` con fila completa, `muestra`. El CSV de descarga del Árbol ("Niveles de planificación") sale en este mismo formato con todos los nodos vigentes.

```ts
filaImportacionNivelSchema = z.object({ genero: z.string(), mundo: z.string(), linea: z.string(), nivel: z.string() });
importarNivelSchema = z.object({ modo: z.enum(["previsualizar", "aplicar"]), filas: z.array(filaImportacionNivelSchema).min(1).max(10_000) });
```

### Cambios en la API de M2 (`/api/marcas`)

| Ruta | Cambio |
|---|---|
| `GET /api/marcas` (`requireUser`) | cada fila suma `modalidad_tratamiento`, `modalidad_efectiva` (regla 1; `null` sin casilla), `gml_asignados` y `gml_vigentes` (una lectura más de `marca_gml_especial` cruzada en memoria con el árbol) |
| `POST /api/marcas` (`requirePlanner`) | `crearMarcaSchema` suma `modalidad_tratamiento: z.enum(["por_gml","barrido"]).nullable().optional()`; con casilla y sin modalidad → `barrido`; modalidad sin casilla → `400` (mismo `refine` que la nota) |
| `PATCH /api/marcas/[id]` (`requirePlanner`) | `editarMarcaSchema` suma la clave. `normalizarTratamiento(cambio, actual, gmlActivos)` (regla 2) decide `{ tratamiento_especial, nota_tratamiento, modalidad_tratamiento }`. Apagar la casilla deja modalidad `null` y **no toca las asignaciones**; la respuesta trae `gml_asignados`. Pasar a `barrido` con GML se permite (quedan ignoradas) |
| `DELETE /api/marcas/[id]` | sin cambio de reglas; la cascada borra las asignaciones y la respuesta es `{ id, gml_eliminados }` |

### Estado de las marcas relevantes

`GET /api/marcas/gml-especial?marca_id=&nodo_id=&incluir_inactivas=1` · `requirePlanner`. Una lectura para la pantalla: `marcas` (con agrupación), `marca_gml_especial` y el árbol (`cargarEstadoArbol`), armados con `armarVistaGml` (regla 6).

```jsonc
{ "data": {
  "marcas": [                                                    // marcas MARCADAS, por nombre (inactivas solo con incluir_inactivas)
    { "id": "…", "nombre": "ALFA", "codigo": "ALFA", "activo": true, "vigente": true,
      "agrupacion_marca": { "id": "…", "nombre": "RECONOCIDO", "activo": true },
      "modalidad_tratamiento": "por_gml", "modalidad_efectiva": "por_gml", "nota_tratamiento": "Licencia de denim",
      "gml": [
        { "id": "…", "genero_mundo_linea_id": "…", "genero": "HOMBRE", "mundo": "URBANO", "linea": "DENIM", "nivel_planificacion": "GML",
          "nota": null, "vigente": true, "motivo_ignorada": null, "created_at": "…" },
        { "id": "…", "genero_mundo_linea_id": "…", "genero": "HOMBRE", "mundo": "FORMAL", "linea": "TERNO", "nivel_planificacion": "GML",
          "nota": "Dejó de trabajarse", "vigente": false, "motivo_ignorada": "gml_no_vigente", "detalle": "línea TERNO inactiva", "created_at": "…" } ],
      "pendiente": false, "motivo_pendiente": null },
    { "id": "…", "nombre": "BETA", "modalidad_efectiva": "barrido", "gml": [], "pendiente": false, "motivo_pendiente": null },
    { "id": "…", "nombre": "DELTA", "modalidad_efectiva": "por_gml", "gml": [], "pendiente": true, "motivo_pendiente": "sin_gml" } ],
  "por_nodo": [                                                  // vista inversa: solo nodos con ≥ 1 asignación, agrupadas por agrupación de marca
    { "genero_mundo_linea_id": "…", "genero": "HOMBRE", "mundo": "URBANO", "linea": "DENIM", "vigente": true, "nivel_planificacion": "GML",
      "agrupaciones": [ { "agrupacion_marca_id": "…", "nombre": "RECONOCIDO", "marcas": [ { "marca_id": "…", "nombre": "ALFA", "vigente": true } ] } ],
      "relevantes_vigentes": 1 } ],
  "resumen": { "marcadas": 12, "por_gml": 8, "barrido": 3, "sin_modalidad": 1,
               "asignaciones": 31, "asignaciones_vigentes": 29, "asignaciones_ignoradas": 2,
               "pendientes_sin_gml": 1, "nodos_con_relevantes": 17, "nodos_con_mas_de_4_por_agrupacion": 0 }
} }
```

`motivo_ignorada` ∈ `marca_sin_tratamiento` (se desmarcó y se conservó) · `marca_no_vigente` (marca o agrupación inactiva) · `marca_en_barrido` · `gml_no_vigente` (`detalle` dice qué padre). `nodos_con_mas_de_4_por_agrupacion` es un aviso suave: Javier habló de 3-4 relevantes; más no se prohíbe (pregunta 14).

### Asignación individual

| Ruta | Método | Cuerpo | Respuesta |
|---|---|---|---|
| `/api/marcas/gml-especial` | POST | `{ marca_id: uuid, genero_mundo_linea_id: uuid, nota? }` | `201` la asignación más `cambio_marca: { de: "sin_tratamiento" \| "barrido" \| "sin_modalidad", a: "por_gml" } \| null`. `404` marca o nodo inexistente · `409` marca inactiva · `409` nodo no vigente · `409` par repetido |
| `/api/marcas/gml-especial/[id]` | PATCH | `{ nota }` | fila; `404` |
| `/api/marcas/gml-especial/[id]` | DELETE | — | `{ id }`; `404`. Quitar siempre se permite, también ignoradas |

Al asignar a una marca sin casilla, al barrer o sin modalidad, el handler la deja marcada en `por_gml` (`update marcas set tratamiento_especial = true, modalidad_tratamiento = 'por_gml'`; la nota de tratamiento no se toca) y lo devuelve en `cambio_marca`; la pantalla lo pregunta antes. Sin transacción: si el `update` falla tras el `insert`, la asignación queda ignorada (`marca_sin_tratamiento` o `marca_en_barrido`), visible, y repetir desde Marcas lo arregla.

### Asignación en bloque

`POST /api/marcas/gml-especial/asignar` · `requirePlanner`. Dos formas de cuerpo: producto cartesiano (pantalla: "estos GML a estas marcas") o lista de pares (sugerencias y vista Por GML):

```ts
const par = z.object({ marca_id: uuid, nodo_id: uuid });
asignarGmlSchema = z.discriminatedUnion("forma", [
  z.object({ forma: z.literal("cartesiano"), accion: z.enum(["asignar", "quitar"]), marca_ids: z.array(uuid).min(1).max(200), nodo_ids: z.array(uuid).min(1).max(600), nota: notaGml.optional() })
   .refine(v => v.marca_ids.length * v.nodo_ids.length <= 5_000, { message: "Se admiten hasta 5 000 pares por bloque." }),
  z.object({ forma: z.literal("pares"), accion: z.enum(["asignar", "quitar"]), pares: z.array(par).min(1).max(5_000), nota: notaGml.optional() }),
]);
```

Algoritmo `planificarAsignacionBloque` (regla 4, pura; el handler lee marcas, árbol y asignaciones una vez):

1. Deduplicar (ids y pares). Marcas o nodos inexistentes no abortan: vuelven en `no_permitidas` (`marca_no_encontrada`, `nodo_no_encontrado`), criterio de M3 y M1b.
2. `asignar`: `motivoRechazoAsignacion` (regla 3): marca inactiva → `marca_inactiva`; nodo no vigente → `nodo_no_vigente`; par existente → `sin_cambio`; resto → `asignadas`. Las marcas sin casilla, al barrer o sin modalidad con ≥ 1 par asignado pasan a marcadas `por_gml` y vuelven en `cambios_marca[]`.
3. `quitar`: existente → `quitadas`; no → `sin_cambio`; nunca se rechaza por vigencia. La modalidad **no** cambia al quitar, ni al quedar sin GML (queda pendiente y visible; pregunta 3).
4. Escritura: `upsert` con `onConflict: "marca_id,genero_mundo_linea_id", ignoreDuplicates: true` en tandas de 500; `delete … in (ids)` y `update marcas … in (ids)` en tandas de 150 (`TANDA_IN`). Sin transacción; repetir completa lo que faltó.

```jsonc
{ "data": { "accion": "asignar", "pares": 6, "asignadas": 4, "sin_cambio": 2, "quitadas": 0,
            "no_permitidas": [ { "marca_id": "…", "marca": "OMEGA", "nodo_id": "…", "ruta": "HOMBRE · URBANO · DENIM", "motivo": "marca_inactiva" } ],
            "cambios_marca": [ { "marca_id": "…", "marca": "GAMMA", "de": "sin_tratamiento", "a": "por_gml" }, { "marca_id": "…", "marca": "BETA", "de": "barrido", "a": "por_gml" } ] } }
```

Invariante: `pares = asignadas + sin_cambio + quitadas + no_permitidas.length`.

### Sugerencias (ayuda, nunca automático)

`GET /api/marcas/gml-especial/sugerencias?desde=aaaa-mm&hasta=aaaa-mm&top=4&min_participacion=0.05&medida=venta_soles` · `requirePlanner`. Por defecto `hasta` = último mes publicado, `desde` = once meses antes (doce meses), `top` 1..10 (4), `min_participacion` 0..0,5 (0,05), `medida` `venta_soles` | `unidades`. Llama a `sugerir_marcas_relevantes` con los ids de VARIOS, OTROS y SIN MARCA excluidos, filtra por participación mínima y cruza con el estado actual. `409 sin_datos` si no hay meses publicados en el rango; `400` zod.

```jsonc
{ "data": {
  "rango": { "desde": "2025-10", "hasta": "2026-09", "meses_publicados": 12 },
  "sugerencias": [
    { "genero_mundo_linea_id": "…", "genero": "HOMBRE", "mundo": "URBANO", "linea": "DENIM", "nivel_planificacion": "GML",
      "agrupacion_marca_id": "…", "agrupacion": "RECONOCIDO", "marca_id": "…", "marca": "ALFA",
      "rango": 1, "unidades": 5200, "venta_soles": 612000, "participacion": 0.62,
      "estado": "ya_relevante" } ,                                 // "nueva" | "ya_relevante" | "marca_al_barrer" | "marca_inactiva" | "nodo_no_vigente"
    { "…": "GAMMA", "rango": 2, "participacion": 0.31, "estado": "nueva" } ],
  "resumen": { "nodos": 410, "pares": 3100, "nuevas": 2900, "ya_relevantes": 180, "al_barrer": 20 }
} }
```

La pantalla deja elegir y manda `POST …/asignar` con `forma: "pares"`. Las de estado `marca_al_barrer` se muestran (es información: "BETA sería la primera de PREMIUM en jeans") pero no se preseleccionan; asignarlas pasa la marca a `por_gml` con el `confirm` habitual.

### Importador de marcas relevantes (la hoja de GML)

`POST /api/marcas/gml-especial/importar` · `requirePlanner`. Mismo flujo de cuatro pasos de M1 a M4 (`src/components/importador/*`), con **selector de hoja** (puede ser la segunda hoja del Excel de marcas).

| Columna | Obligatoria | Alias | Valor |
|---|---|---|---|
| `MARCA` | sí | `MARCAS`, `BRAND` | nombre tal como está en Marcas (normalizado) o su código |
| `GENERO` | sí | `GÉNERO`, `SEXO` | nombre o código |
| `MUNDO` | sí | `GRUPO_PRODUCTO` | nombre o código |
| `LINEA` | sí | `LÍNEA` | nombre o código |
| `NOTA` | no | `OBSERVACION`, `COMENTARIO` | ≤ 200 |

Ejemplo sintético (ALFA marcada al barrer, GAMMA sin casilla, ZETA inexistente, TERNO inactiva en ese nodo, CORBATA sin nodo en HOMBRE·URBANO):

```
MARCA,GENERO,MUNDO,LINEA,NOTA
ALFA,HOMBRE,URBANO,DENIM,Licencia de denim
ALFA,MUJER,URBANO,DENIM,
ALFA,HOMBRE,FORMAL,TERNO,
GAMMA,HOMBRE,URBANO,DENIM,
ALFA,hombre,urbano,denim,repetida
ZETA,HOMBRE,URBANO,DENIM,
ALFA,HOMBRE,URBANO,CORBATA,
ALFA,,URBANO,DENIM,
TOTAL,,,,
```

Previsualización: 3 asignaciones a crear (filas 2, 3 y 5); `cambios_marca`: ALFA barrido → por_gml, GAMMA sin_tratamiento → por_gml; omitidas: 4 `gml_inactivo`, 6 `duplicada_en_archivo` (original 2), 7 `marca_desconocida`, 8 `gml_inexistente` ("CORBATA no está en HOMBRE · URBANO"), 9 `genero_vacio`, 10 `fila_total`.

Algoritmo `planificarImportacionGml(filas, estado)`: (1) normalizar; `marca_vacia`, `fila_total`; (2) marca por nombre normalizado o `aCodigo(valor) = codigo`: `marca_desconocida`, `marca_inactiva` (sin casilla **no** omite: se marcará); (3) `resolverGml` compartido con el importador de nivel (`genero_*`, `mundo_*`, `linea_*`, `gml_inexistente`, `gml_inactivo`; **nunca crea árbol**); (4) `nota_larga`; (5) duplicados por par con `fila_original`; (6) par existente → `existentes`, nota distinta → `diferencias` (no se escribe); par nuevo → `crear.asignaciones`, `crear.por_marca[]`, y la marca en `cambios_marca[]` si no está en `por_gml`; (7) `aplicar`: `upsert … ignoreDuplicates` en tandas de 500 y `update marcas` en tandas de 150. No quita asignaciones ausentes (carga, no sincronización). Reporte igual al de M2 en forma (`totales`, `crear`, `existentes`, `cambios_marca`, `diferencias`, `omitidas` con fila completa, `muestra`). Motivos (`MotivoOmisionGml`): `marca_vacia`, `fila_total`, `marca_desconocida`, `marca_inactiva`, `genero_vacio`, `genero_desconocido`, `genero_inactivo`, `mundo_vacio`, `mundo_desconocido`, `mundo_inactivo`, `linea_vacia`, `linea_desconocida`, `linea_inactiva`, `gml_inexistente`, `gml_inactivo`, `nota_larga`, `duplicada_en_archivo`.

### Lo que M7 y M8 consumen

Tres piezas, todas en `src/lib/marcas/gml/` para que los dos módulos las importen y no las reescriban:

**(1) `GET /api/marcas/gml-especial/vigentes`** · `requirePlanner`: la configuración vigente, ya en la forma de la vista "mi flujo de Jeans".

```jsonc
{ "data": {
  "gml": [                                                       // solo GML vigentes con ≥ 1 marca relevante vigente
    { "genero_mundo_linea_id": "…", "genero": "HOMBRE", "mundo": "URBANO", "linea": "DENIM", "nivel_planificacion": "GML",
      "agrupaciones": [ { "agrupacion_marca_id": "…", "agrupacion": "RECONOCIDO", "relevantes": [ { "marca_id": "…", "marca": "ALFA" }, { "marca_id": "…", "marca": "GAMMA" } ] } ] } ],
  "barrido": [ { "marca_id": "…", "marca": "BETA", "agrupacion_marca_id": "…", "agrupacion": "PREMIUM" } ],
  "pendientes": [ { "marca_id": "…", "marca": "DELTA", "motivo": "sin_gml" } ],       // M7 avisa antes de proyectar
  "nodos_gmle": 16, "calculado_at": "…"
} }
```

**(2) `claveFlujo(hecho, config)`** (`flujo.ts`, regla 9): a qué fila del flujo va cada hecho de `venta_stock_vigente` (trae `marca_id` y `equivalencia_id`, de la que sale el nodo):

| La marca del hecho | Modalidad efectiva | Clave |
|---|---|---|
| no marcada | — | `{ tipo: "unidad", gml_id, equivalencia_id: (GMLE ? id : null), agrupacion_marca_id, marca_id: null }` → "otras de la agrupación" |
| marcada y vigente | `barrido` | `{ tipo: "barrido", marca_id }` → flujo propio, fuera de la unidad |
| marcada y vigente | `por_gml`, relevante en ese GML (asignación vigente) | `{ tipo: "unidad", …, marca_id }` → fila de la marca dentro de su agrupación |
| marcada y vigente | `por_gml`, no relevante en ese GML | `{ tipo: "unidad", …, marca_id: null }` → "otras" (pregunta 1, valor por defecto) |
| marcada, no vigente (agrupación inactiva) | — | `{ tipo: "unidad", …, marca_id: null }` |

Invariantes que M7 y M8 heredan: la partición es **completa y disjunta**; "otras de la agrupación" en una unidad = total de la agrupación en la unidad − Σ relevantes; "mi flujo de Jeans" = Σ de las unidades del nodo (una si `GML`, una por equivalencia si `GMLE`) **sin** las marcas al barrer (pregunta 12). El ejemplo de Javier: RECONOCIDO × HOMBRE·URBANO·DENIM proyecta 1 000 jeans; ALFA 500, GAMMA 200, otras de RECONOCIDO 300. Cómo se fijan los 500 (participación histórica con ajuste, o lo fija el comprador) sigue siendo de M7. M8 usa la misma clave para el stock. La agregación de M5 hacia la unidad la hace M7/M8 en SQL (`sum` por nodo o por equivalencia según `nivel_planificacion`, `join marca_gml_especial_vigente`): la vista y la función pura dicen lo mismo.

**(3) `curvaUnidad(unidad, equivalencias, curvasVigentes, pesos)`** (`curva.ts`, regla 11): la curva de estacionalidad de una unidad a partir de M3 y M6, que asignan y calculan por **equivalencia** y por agrupación de estacionalidad. Unidad `GMLE` → la curva vigente de la agrupación de su equivalencia. Unidad `GML` → **mezcla ponderada** de las curvas vigentes de sus equivalencias activas: `c_m = Σ_e peso_e × curva_e[m]`, con `peso_e` = participación de la equivalencia en las unidades del nodo en los doce meses de referencia (M7 fija el rango), renormalizada a 1. Si todas las equivalencias del nodo comparten agrupación (caso normal cuando Javier agrupa por GML), la mezcla **es** esa curva. Una equivalencia con venta y sin curva vigente deja la unidad con aviso `curva_incompleta` (y su peso fuera de la mezcla) hasta que M3 y M6 la cierren: por eso el hito de M3 ("toda equivalencia activa tiene agrupación") **no se relaja** para los nodos a nivel GML. M3 no cambia: no se asigna estacionalidad al nodo (dos lugares para la misma cosa; descartado).

**(4) Qué pasa al cambiar el nivel de un nodo.** Nada se borra: M5 sigue al detalle, M3 sigue por equivalencia, las asignaciones de marcas son por GML y valen en los dos niveles. Lo único que cambia es cuántas unidades produce el nodo. M7 debe guardar el nivel con el que proyectó cada unidad y avisar "nivel cambiado desde la proyección" (como M6 avisa `desactualizada`); es responsabilidad de M7, anotada aquí.

## Pantallas

### Árbol de producto (`/maestros/arbol`, M1): nivel de planificación

- En la columna de líneas, cada nodo muestra un badge **"GMLE"** cuando está abierto (nada cuando es GML, que es la norma). Admin y planner tienen un `Select` en línea (GML / GMLE) que guarda al instante (`PATCH` del nodo), como la temporada de Líneas. El comprador lo ve como texto.
- **Bloque**: checkbox por nodo en la columna del género × mundo seleccionado y barra "Abrir a GMLE / Volver a GML (N seleccionados)" (`POST /api/arbol/nodos/nivel`); atajo "Todos los de este género × mundo".
- **Por línea**: en el buscador de líneas, al elegir una línea aparece "DENIM está en 12 nodos: 10 GML · 2 GMLE" con "Abrir todos a GMLE / Volver todos a GML" (el cliente manda los `nodo_ids` de esa línea).
- Chip de filtro "Abiertos a GMLE (N)"; el resumen de arriba dice "556 nodos · 16 abiertos a GMLE (84 equivalencias)".
- Al abrir un nodo a GMLE con equivalencias sin agrupación de estacionalidad, aviso (no bloqueo): "3 equivalencias sin agrupación de estacionalidad: M7 no podrá proyectarlas" con enlace a Faltantes de M3.
- Pestaña **Importar** del árbol: `Chips` "Árbol" (el importador de M1) · "Niveles de planificación" (el nuevo, con descarga del CSV actual en el mismo formato).
- Junto al responsable de M1b, para admin y planner: "· 2 marcas relevantes" con enlace a `/maestros/marcas?pestana=gml&nodo=<id>` (dato de `GET /api/marcas/gml-especial`, cargado solo si el rol puede editar maestros; el comprador no lo llama).

### Marcas (`/maestros/marcas`)

Pestañas: **Agrupaciones · Marcas · Marcas relevantes por GML · Importar**. Resumen: `5 agrupaciones · 280 marcas · 12 con tratamiento especial (8 por GML · 3 al barrer · 1 pendiente)`.

**Pestaña Marcas (cambios).** Columna Tratamiento especial: badge "Tratamiento especial" + **"Por GML · 3"** (con "1 ignorada" si hay) o **"Al barrer"**; badge alerta "Pendiente: sin GML"; "Sin modalidad (al barrer)" si es nula. Edición: la casilla (igual) + `Select` Modalidad visible con la casilla, guardado al instante. `confirm` al apagar la casilla con GML: "Se borrará la nota. Sus N GML relevantes se conservan, pero quedarán ignorados hasta que vuelvas a marcarla."; al pasar a Al barrer con GML: "Sus N GML quedarán ignorados (no se borran)."; al eliminar: "Se eliminarán también sus N GML." Chips nuevos: Por GML · Al barrer · Pendientes. El badge "Por GML · n" enlaza a la pestaña siguiente con la marca seleccionada.

**Pestaña Marcas relevantes por GML (admin y planner).** Carga `GET /api/marcas/gml-especial` (hook `useGmlEspecial`, patrón de `useResponsables`) y `GET /api/arbol`. Tres vistas con `Chips`: **Por marca** (por defecto) · **Por GML** · **Sugerencias**. Interruptor "Mostrar marcas inactivas".

*Por marca.* Izquierda: lista de marcas marcadas (checkbox para bloques, nombre, agrupación, badge de modalidad, "n GML", aviso de pendiente), chips Todas · Por GML · Al barrer · Pendientes · Con ignoradas, buscador; botón "Agregar marca…" que ofrece cualquier marca activa aún sin casilla (al asignarle un GML se marcará). Derecha, la marca seleccionada: (1) cabecera con `Select` de modalidad y nota (solo lectura); (2) tabla **GML donde es relevante**: Género · Mundo · Línea · Nivel (GML/GMLE) · Nota (edición en línea) · Estado ("Vigente" / "Ignorada: línea TERNO inactiva" / "Ignorada: marca al barrer") · Quitar; checkbox y "Quitar N seleccionados"; vacío: "Sin GML. Asígnale al menos uno o pásala a Al barrer." (si barrido: "Marca al barrer: flujo independiente, sin GML."); (3) **Agregar GML**: selector de nodos vigentes con `Chips` Género, `Chips` Mundo y buscador de Línea, tabla con checkbox ("ya relevante" atenuado), atajos "Todos los nodos de la línea X" y "Todos los de GÉNERO × MUNDO", Nota opcional, botón "Hacer relevante en N GML" (o "para las M marcas seleccionadas": cartesiano, `confirm` con N×M y la lista de marcas que se marcarán o pasarán a Por GML). Tras aplicar, `Alert` con los conteos y `no_permitidas`.

*Por GML.* Filtros Género · Mundo · Línea y chip "Solo con relevantes". Tabla de nodos: Género · Mundo · Línea · Nivel · Relevantes (por agrupación: "RECONOCIDO: ALFA, GAMMA · PREMIUM: —"; ignoradas atenuadas) · n (aviso si alguna agrupación pasa de 4). Seleccionar un nodo abre debajo, **agrupada por agrupación de marca**, la lista de marcas (marcadas primero; buscador para añadir cualquier marca activa) con checkbox "relevante aquí"; botones "Hacer relevantes / Quitar". Selección múltiple de nodos para bloques.

*Sugerencias.* Tarjeta de parámetros (rango de meses, por defecto los últimos doce publicados; top por GML × agrupación, 4; participación mínima, 5 %; medida), botón **Calcular sugerencias** (2 a 5 s; aviso si M5 no tiene meses publicados). Tabla GML · Agrupación · Marca · Rango · Venta · Participación · Estado (Nueva / Ya relevante / Marca al barrer / Marca inactiva) con checkbox (solo "Nueva" preseleccionable), filtros por género, mundo, línea y agrupación, chip "Solo nuevas". Botón "Hacer relevantes N seleccionadas" (`POST asignar` con pares, `confirm` con las marcas que se marcarán). **Descargar sugerencias (CSV)** en el formato del importador, para armar la hoja en Excel. Pie: "Las sugerencias salen de la venta de M5 y nunca se aplican solas: tú decides cuáles son relevantes."

En las tres vistas, **Descargar relevantes (CSV)** (`MARCA, GENERO, MUNDO, LINEA, NOTA`, más `ESTADO` informativo, con BOM): sirve para revisar en Excel y volver a subir.

**Pestaña Importar.** `Chips`: **Marcas** (M2, sin cambios) · **Marcas relevantes por GML** (el nuevo; nota: "Las marcas sin tratamiento especial se marcarán al recibir GML; se listan antes de aplicar"). Tarjetas `Se crearán` · `Ya existían` · `Se marcarán / pasarán a Por GML` · `Omitidas`; bloques Filas con errores (filtro por motivo, descarga), Repetidas, Diferencias (nota), muestra.

## Reglas de negocio

Funciones puras probadas en `tests/arbol.nivel.*.test.ts` y `tests/marcas.gml.*.test.ts` con el fixture de abajo. Las 16 reglas de M2 y las de M1 siguen válidas; aquí se amplían la 6 de M2 y `editarNodoSchema` de M1.

**Nivel de planificación (`src/lib/arbol/nivel/`)**

1. `unidadesDeNodo(nodo, equivalencias)`: `GML` → una unidad `{ gml_id, equivalencia_id: null }`; `GMLE` → una por equivalencia activa (genérica incluida); nodo no vigente → ninguna. `resumenNiveles(arbol)`: `nodos_gmle` y `equivalencias_en_gmle` solo sobre nodos vigentes.
2. `planificarNivelBloque(nodoIds, nivel, nodos)`: deduplica; inexistentes → `no_encontrados`; igual nivel → `sin_cambio`; resto → `cambiados`; `|ids| = cambiados + sin_cambio + |no_encontrados|`; idempotente.
3. `planificarImportacionNivel(filas, estado)`: cada motivo en su condición; `nivel` acepta `GML`, `GMLE` y los sinónimos `LINEA` / `EQUIVALENCIA` sin distinguir caja; el archivo manda (`cambios[]` con `de → a`); nodos ausentes no cambian; nunca crea árbol; reimportar tras aplicar da `cambios = []`.
4. `resolverGml(fila, estado)` (compartida): resuelve género, mundo y línea por código o nombre solo entre activos, distingue inactivo de desconocido, y el nodo por la tripleta (`gml_inexistente` con `detalle` "LINEA no está en GENERO · MUNDO"; `gml_inactivo`). Es una sola función para los dos importadores (test: ambos devuelven el mismo motivo ante la misma fila).

**Marcas (`src/lib/marcas/reglas.ts` y `gml/reglas.ts`)**

5. `modalidadEfectiva(marca)`: sin casilla → `null`; con casilla y `por_gml` → `por_gml`; con casilla y `barrido` o `null` → `barrido`.
6. `normalizarTratamiento(cambio, actual, gmlActivos)` (amplía la regla 6 de M2): casilla resultante `false` → nota y modalidad `null`; casilla `true` sin modalidad en el cuerpo → la actual si existe, si no `modalidadPorDefecto(gmlActivos)` = `por_gml` si `> 0`, `barrido` si no; modalidad en el cuerpo sin casilla resultante y sin traer la casilla → `400 "Marca el tratamiento especial para definir la modalidad."`. Las reglas de la nota no cambian.
7. `motivoRechazoAsignacion(marca, nodo, arbol)`: marca `undefined` → `marca_no_encontrada` (404); `!marca.activo` → `marca_inactiva` (409); nodo `undefined` → `nodo_no_encontrado` (404); `!nodoVigente` → `nodo_no_vigente` (409, con el padre inactivo); si no, `null`. Sin casilla, al barrer o sin modalidad **no** rechaza: `cambioMarca(marca)` devuelve `{ de: "sin_tratamiento" | "barrido" | "sin_modalidad", a: "por_gml" }` o `null` si ya es `por_gml`. La agrupación inactiva no rechaza (nace ignorada `marca_no_vigente`).
8. `planificarAsignacionBloque(cuerpo, estado)`: acepta las dos formas y las reduce a pares únicos; `asignar`: existente → `sin_cambio`, rechazada → `no_permitidas`, resto → `asignadas`, `cambios_marca` = marcas con ≥ 1 asignada y `cambioMarca ≠ null`; `quitar`: existente → `quitadas`, no → `sin_cambio`; `pares = asignadas + sin_cambio + quitadas + |no_permitidas|`; aplicar en memoria y replanificar da `asignadas = 0` y `cambios_marca = []`.
9. `motivoPendiente(marca, vigentes)`: marcada, vigente, `por_gml`, 0 vigentes → `sin_gml`; marcada con modalidad nula → `sin_modalidad`; marcada no vigente → `marca_no_vigente`; `barrido` nunca pendiente.
10. `armarVistaGml(marcas, agrupaciones, asignaciones, arbol)`: `motivoIgnorada` con prioridad `marca_sin_tratamiento > marca_no_vigente > marca_en_barrido > gml_no_vigente`; `por_nodo` contiene exactamente los nodos con ≥ 1 asignación, agrupadas por agrupación de marca, cada marca una vez; `resumen` consistente (`marcadas = por_gml + barrido + sin_modalidad`, `asignaciones = vigentes + ignoradas`); solo cuenta `activo = true`. `unidadesFlujoEspecial(config)` = la vista SQL: una por marca `barrido` vigente y una por par vigente; una `por_gml` sin pares no produce ninguna y va a `pendientes`.
11. Vigencia del nodo con `nodoVigente` de `armar-arbol.ts`, sin duplicar: desactivar la línea TERNO deja la asignación `gml_no_vigente` ("línea TERNO inactiva"); reactivarla la devuelve vigente sin tocar la tabla.

**Contrato para M7 y M8 (`gml/flujo.ts`, `gml/curva.ts`)**

12. `claveFlujo(hecho, config)` devuelve exactamente la tabla "Lo que M7 y M8 consumen": cada hecho del fixture recibe una y solo una clave; `Σ por clave = Σ hechos` (completa y disjunta); en un nodo `GMLE` la clave lleva `equivalencia_id` y en uno `GML` lleva `null`; "otras" = total de la agrupación en la unidad − Σ relevantes; cambiar ALFA a `barrido` mueve **toda** su venta a `barrido`; desmarcarla la devuelve a "otras"; cambiar el nivel de un nodo no cambia la suma del nodo, solo cuántas claves produce.
13. `curvaUnidad`: `GMLE` → la curva de su equivalencia; `GML` con todas las equivalencias en la misma agrupación → esa curva exacta; con dos agrupaciones y pesos 80/20 → la mezcla, que suma 1 (`normalizarCurva` de M6); una equivalencia con venta y sin curva → aviso `curva_incompleta` y mezcla sobre las que sí tienen; sin ninguna → `null`.

**Importador de marcas relevantes (`gml/importar.ts`)**

14. Cada motivo en su condición (un test por motivo con el CSV de ejemplo); marca por nombre y por código; la fila de una marca sin casilla **no** se omite y la marca entra en `cambios_marca`.
15. El plan nunca contiene árbol ni marcas nuevas; par existente nunca entra en `crear` (nota distinta → `diferencias`); duplicados con `fila_original`; `cambios_marca` = exactamente las marcas no `por_gml` con ≥ 1 asignación nueva.
16. Idempotencia: replanificar tras aplicar da `crear.asignaciones = 0`, `cambios_marca = []`, mismas omitidas; `recibidas = procesadas + omitidas`; `procesadas = crear + existentes`.

**Esquemas**

17. `editarNodoSchema` acepta `nivel_planificacion` ∈ {GML, GMLE} y rechaza otro valor; `nivelBloqueSchema` rechaza lista vacía, > 600 y no UUID. `crearMarcaSchema` / `editarMarcaSchema` aceptan `modalidad_tratamiento` ∈ {por_gml, barrido, null}; crear con casilla y sin modalidad → `barrido`; modalidad sin casilla → `400`. `asignarGmlSchema` rechaza > 200 marcas, > 600 nodos, > 5 000 pares, `forma` o `accion` desconocidas. `sugerenciasQuerySchema` aplica los valores por defecto y rechaza `top` fuera de 1..10 y `min_participacion` fuera de 0..0,5.

**SQL y estático**

18. **SQL (script de humo local)**: `0010` aplica dos veces sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; `nivel_planificacion` existe con `default 'GML'` y rechaza `'X'`; `modalidad_tratamiento` rechaza `'otra'` y `'barrido'` sin casilla; el par repetido choca con `marca_gml_especial_par_uniq`; borrar una marca borra sus pares (cascade); borrar un nodo con pares falla (restrict); la vista devuelve sobre el fixture exactamente las unidades de la regla 10 y desactivar DENIM saca las de ALFA; `anon` obtiene cero filas de la vista y no puede ejecutar `sugerir_marcas_relevantes`; la función, sobre hechos sintéticos de dos cargas del mismo mes (una `reemplazada`), devuelve el top con `participacion` que suma 1 por (nodo, agrupación) y excluye `p_excluir`.
19. **Estático**: toda ruta bajo `src/app/api/marcas/gml-especial/` y `src/app/api/arbol/nodos/nivel/` usa `requirePlanner`; `gml/flujo.ts` y `gml/curva.ts` no importan de `@supabase/*` ni de `src/components/`; `gml/consultas.ts` es el único archivo de `src/` que nombra `marca_gml_especial_vigente` y `sugerir_marcas_relevantes`.

## Casos de prueba sintéticos

Fixture `tests/marcas.gml.fixture.ts` (nada real de Lukers):

- Agrupaciones de marca: RECONOCIDO, PREMIUM (activas).
- Marcas: **ALFA** (RECONOCIDO, marcada, `por_gml`), **BETA** (PREMIUM, marcada, `barrido`), **GAMMA** (RECONOCIDO, sin casilla), **DELTA** (RECONOCIDO, marcada, `por_gml`, sin GML), **ÉPSILON** (PREMIUM, marcada, modalidad `null`), **OMEGA** (RECONOCIDO, inactiva).
- Nodos: **N1** HOMBRE · URBANO · DENIM (`GML`; equivalencias E1a en agrupación de estacionalidad S1, E1b en S2), **N2** MUJER · URBANO · DENIM (`GMLE`; E2a, E2b, ambas S1), **N3** HOMBRE · FORMAL · TERNO (`GML`; E3). HOMBRE · URBANO · CORBATA no existe.
- Relevantes: ALFA → N1, ALFA → N2, ALFA → N3 (nota "Dejó de trabajarse").
- Hechos de un mes (unidades): ALFA·E1a 400, ALFA·E1b 100, GAMMA·E1a 300, BETA·E1a 200, ALFA·E3 40, GAMMA·E3 60, BETA·E3 10, ALFA·E2a 100, ALFA·E2b 20. Total 1 230.
- Curvas vigentes: S1 y S2 distintas, ambas suman 1.

| Caso | Esperado |
|---|---|
| 1. Vista base | ALFA 3 vigentes; BETA barrido; DELTA `sin_gml`; ÉPSILON `barrido` efectiva y `sin_modalidad`; `resumen.marcadas = 4`, `por_gml = 2`, `barrido = 1`, `sin_modalidad = 1`, `pendientes_sin_gml = 1`, `nodos_con_relevantes = 3` |
| 2. Reparto | N1 (`GML`): unidad(N1,·,RECONOCIDO,ALFA) = 500, otras RECONOCIDO = 300, otras PREMIUM = 0 (BETA es barrido); N3: ALFA 40, otras RECONOCIDO 60; N2 (`GMLE`): unidad(N2,E2a,RECONOCIDO,ALFA) = 100, unidad(N2,E2b,RECONOCIDO,ALFA) = 20; barrido BETA = 210; suma 1 230; "mi flujo de Jeans" (N1) = 800 |
| 3. TERNO inactiva | ALFA→N3 `gml_no_vigente`; ALFA·E3 (40) va a otras RECONOCIDO de N3 (= 100); reactivar devuelve el caso 2 |
| 4. ALFA a `barrido` | sus 3 pares `marca_en_barrido`; toda su venta (660) a barrido ALFA; volver a `por_gml` restaura el caso 2 |
| 5. Desmarcar ALFA | modalidad y nota `null`; pares conservados `marca_sin_tratamiento`; su venta a "otras"; volver a marcar sin modalidad → `por_gml` (tiene GML) |
| 6. N1 pasa a `GMLE` | las claves de N1 llevan `equivalencia_id`: ALFA en E1a 400 y en E1b 100, otras RECONOCIDO en E1a 300; la suma de N1 sigue siendo 800; volver a `GML` restaura |
| 7. Curva de N1 | pesos E1a 700/800, E1b 100/800 → mezcla 0,875·S1 + 0,125·S2 renormalizada; N2 (`GMLE`) → S1 en sus dos unidades; si E1b no tiene curva → `curva_incompleta` y la curva es S1 |
| 8. Bloque cartesiano `[ALFA, BETA, GAMMA, OMEGA] × [N1, N2]` | pares 8; ALFA×N1, ALFA×N2 `sin_cambio`; BETA×N1, BETA×N2, GAMMA×N1, GAMMA×N2 `asignadas`; OMEGA×N1, OMEGA×N2 `no_permitidas` (`marca_inactiva`); `cambios_marca` = [BETA barrido→por_gml, GAMMA sin_tratamiento→por_gml]; `2 + 4 + 0 + 2 = 8`; repetir → `asignadas = 0` |
| 9. Bloque quitar `[ALFA] × [N1, N2, N3]` | `quitadas = 3`; ALFA queda `por_gml` pendiente `sin_gml` |
| 10. Importador con el CSV de ejemplo (ALFA en `barrido` al inicio) | lo descrito en "Importador"; aplicar y reimportar → nada nuevo |
| 11. Sugerencias sobre los hechos (top 4, mín. 5 %) | N1 RECONOCIDO: ALFA 62,5 % `ya_relevante`, GAMMA 37,5 % `nueva`; N1 PREMIUM: BETA 100 % `marca_al_barrer`; N3 RECONOCIDO: GAMMA 60 % `nueva`, ALFA 40 % `ya_relevante`; nada por debajo del 5 % |
| 12. Importador de nivel con `N1,GMLE` y `N2,GML` y una fila `HOMBRE,URBANO,CORBATA,GMLE` | `cambios = 2` (N1 GML→GMLE, N2 GMLE→GML), omitida `gml_inexistente`; reimportar → `cambios = 0` |
| 13. Eliminar GAMMA sin hechos (fixture base sin venta) | `gml_eliminados = 0`; eliminar ALFA → `gml_eliminados = 3` |
| 14. Vista SQL = función | `marca_gml_especial_vigente` coincide con `unidadesFlujoEspecial` en los casos 1, 3 y 4 |

## Criterios de aceptación / hito de prueba

`[x]` lo cubren los checks automáticos y QA; `[ ]` lo recorre Javier en local (`INICIAR.cmd`) o en Railway con `0.8.3 · M2b`, con marcas inventadas antes de cargar la lista real.

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (los 781 de M0 a M5 más `tests/arbol.nivel.*` y `tests/marcas.gml.*` con los catorce casos), `npm run build` y `scripts/validar-migraciones-local.sh` en verde.
- [ ] `0010_nivel_planificacion_marcas_gml.sql` aplicada en `vector-two` sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`; tipos regenerados (vista bajo `Views`, función bajo `Functions`); `APP_VERSION` = `0.8.3 · M2b`; los 63 tests de M2 y los 131 de M1 siguen en verde.

**Hito (Javier)**

- [ ] Roles: el comprador ve el nivel en el árbol como texto, no ve la pestaña de marcas relevantes y `GET /api/marcas/gml-especial` y `…/sugerencias` le responden `403`; `GET /api/arbol` y `GET /api/marcas` le siguen respondiendo `200`.
- [ ] **Nivel**: todos los nodos nacen `GML`; abrir un nodo a GMLE desde el `Select` muestra el badge y el resumen cuenta 1; abrir en bloque los nodos de un género × mundo y volver todos a GML; desde el buscador de líneas abrir "toda la línea DENIM"; importar un CSV con tres filas de nivel (una con un nodo inexistente) → dos cambios y una omitida; reimportar → sin cambios; `select count(*) from genero_mundo_linea where nivel_planificacion = 'GMLE'` coincide.
- [ ] Abrir a GMLE un nodo con equivalencias sin agrupación de estacionalidad muestra el aviso con enlace a Faltantes de M3; nada se bloquea ni se borra; cerrar y reabrir el nodo no cambia nada en M3 ni en M5.
- [ ] **Marcas**: crear ALFA en RECONOCIDO marcada sin modalidad → Al barrer; pasarla a Por GML → "Pendiente: sin GML".
- [ ] En Por marca, ALFA, filtrar DENIM, "Todos los nodos de la línea DENIM", hacer relevante → sus GML aparecen; el badge dice "Por GML · n"; `count(*)` de `marca_gml_especial` = n.
- [ ] Crear GAMMA **sin** casilla; en Por GML elegir HOMBRE · URBANO · DENIM y marcar GAMMA como relevante → `confirm` "GAMMA se marcará con tratamiento especial (Por GML)"; después tiene la casilla y 1 GML. Quitar el GML → sigue marcada y pendiente, no vuelve sola a Al barrer.
- [ ] Crear BETA marcada Al barrer; hacerla relevante en un GML → `confirm` de cambio a Por GML; quitarlo y pasarla a Al barrer desde el `Select`.
- [ ] Intentar hacer relevante a una marca desactivada (OMEGA) en bloque → sale en `no_permitidas` y el resto del bloque se aplica.
- [ ] Desactivar en el árbol la línea de un GML de ALFA → "Ignorada: línea X inactiva" y la vista `marca_gml_especial_vigente` deja de listar el par; reactivar lo devuelve.
- [ ] Apagar la casilla de ALFA → `confirm` con el conteo; volver a marcarla → Por GML propuesta y sus GML vigentes.
- [ ] Importar el CSV de ejemplo (adaptado a nodos reales): omitidas con motivo y fila completa, "Se marcarán / pasarán a Por GML"; aplicar; reimportar → "Nada nuevo"; `count(*)` no cambia. Descargar el CSV de relevantes, abrirlo en Excel y volver a subirlo → nada nuevo.
- [ ] Con al menos un mes publicado en M5: **Calcular sugerencias** termina en menos de 10 s; para un GML conocido las 4 primeras marcas de RECONOCIDO coinciden con lo que Javier sabe que vende; marcar dos como relevantes desde la tabla; nada se asignó sin elegirlo.
- [ ] En el árbol, un nodo con relevantes muestra "· N marcas relevantes" (admin y planner) con enlace que abre Por GML en ese nodo.
- [ ] `GET /api/marcas/gml-especial/vigentes` devuelve el GML con sus agrupaciones y relevantes, BETA en `barrido`, DELTA en `pendientes`, y `select * from marca_gml_especial_vigente` cuadra.
- [ ] **Validación de negocio**: con la lista real de marcas y la hoja real de GML cargadas, Javier revisa "su flujo de Jeans" en Por GML (RECONOCIDO con sus 3-4 relevantes y "otras"), una marca al barrer y dos nodos abiertos a GMLE, y confirma que representa cómo compra. Esto es lo que M7 toma como dado.

## Fuera de alcance

- **El pronóstico y el flujo en sí** (cómo se reparten los 1 000 jeans entre ALFA, GAMMA y otras; grano interno del flujo al barrer; documento para compradores): M7 y M8. Aquí solo la configuración, `claveFlujo`, `curvaUnidad` y las lecturas.
- **Apertura a GMLE por equivalencia concreta** (opción (b)): no; pregunta 13.
- **Estacionalidad al nivel del nodo** (asignar agrupación de M3 a un GML cerrado): no; M3 sigue por equivalencia y la curva del GML se mezcla en M7.
- **Columna `MODALIDAD` en el importador de marcas de M2**: no (pregunta 8).
- **Que el importador cree árbol o agrupaciones**: nunca.
- **Sincronización por archivo** (quitar lo ausente): no.
- **Flujo "resto de la marca"** (pregunta 1): sería una tercera modalidad.
- **Tope duro de 4 relevantes por agrupación y GML**: aviso, no bloqueo (pregunta 14).
- **Aplicar sugerencias automáticamente** o recalcularlas en cada carga: nunca; es un botón.
- **Auditoría** (pendiente desde M0); el comprador no ve relevantes ni sugerencias (pregunta 9).
- **M5 y M6**: no cambian.

## Riesgos

- **Dos escrituras sin transacción** (asignar y marcar; borrar y actualizar; nivel en bloque): un fallo a medias deja estados visibles e idempotentes, nunca datos perdidos. Criterio de M3 y M1b.
- **Marcado automático** al asignar: una sugerencia aceptada a la ligera marca marcas. Freno: `confirm` con la lista, y el importador lo muestra antes de aplicar. Si Javier prefiere rechazar (pregunta 4), es volver a un `409`.
- **Cascade al eliminar una marca**: primera cascada desde `marcas`; solo alcanzable sin venta y con `confirm`.
- **Mezcla de curvas en nodos GML**: si un nodo mezcla equivalencias de agrupaciones muy distintas (verano e invierno), la curva mezclada es un promedio que puede no representar a nadie; la pantalla de M7 debe mostrar la mezcla y sus pesos, y el remedio es abrir ese nodo a GMLE, que es justo para lo que existe el nivel.
- **Sugerencias y `statement_timeout`**: la función agrega doce meses de `venta_stock_vigente` (≈ 400 mil filas); 2 a 5 s estimados en Micro, pendiente de la medición del piloto de M5 (misma dependencia que M6).
- **Orden de carga**: hoja de GML antes que la lista de marcas → filas `marca_desconocida`; el reporte lo deja claro y reimportar lo resuelve. Sin M5 cargado, Sugerencias está vacía.
- **Filas con casilla y modalidad nula** (SQL Editor): se leen como barrido (pregunta 3).
- **Nombres en la hoja de Javier** distintos de los del árbol → `*_desconocido`; se confirma en la pregunta 8.
- **M7 y M8 no están especificados**: el contrato se diseñó para la vista que Javier describió; los cambios previsibles (equivalencia en la relevancia, apertura parcial) son aditivos.

## Cambios en otras fichas y en el plan

- `docs/PLAN.md`: §4 (`genero_mundo_linea.nivel_planificacion`, `marcas.modalidad_tratamiento`, `marca_gml_especial`, vista y función; diagrama), §5 filas M1 y M2 (mejora 02b), M3 (no cambia; la curva del GML se mezcla en M7), M6 (migración `0011`), M7 y M8 (lo que consumen), §7 (pendientes de Javier).
- `docs/modulos/06-curvas-estacionalidad.md`: la migración prevista pasa a `0011` porque 05b (`0008`, `0.8.1 · M5`), 05c (`0009`, `0.8.2 · M5`) y esta mejora (`0010`, `0.8.3 · M2b`) se construyen antes que M6 (`0.9.0`). Nada más de M6 cambia.
- `docs/modulos/01-arbol-producto.md`, `02-marcas.md` y `03-agrupaciones-estacionalidad.md` no se editan aquí; al construir, el `documentador` añade el puntero (M1: columna del nodo y pestaña Importar; M2: modalidad y pestaña; M3: "la curva del GML se mezcla en M7, M3 no cambia").

## Decisiones nuevas propuestas

Para `docs/DECISIONES.md` cuando Javier apruebe; ninguna contradice una entrada vigente (la de "nota exige bandera" se extiende a la modalidad; la que descartó `equivalencia_marca` sigue en pie):

1. **El nivel de planificación es una columna del nodo (`GML` por defecto, `GMLE` abre todas sus equivalencias)**; cambiarlo no borra nada. Descartado: bandera por equivalencia (tercer grano), tabla aparte.
2. **La estacionalidad sigue por equivalencia (M3); la curva de un nodo a nivel GML es la mezcla ponderada de las curvas de sus equivalencias**, calculada por M7 con `curvaUnidad`. Descartado: asignar agrupación de estacionalidad al nodo (dos lugares para la misma cosa).
3. **Las marcas relevantes se definen por marca × GML con una modalidad explícita en la marca** (`por_gml` / `barrido`). Descartado: deducir el tipo de la ausencia de GML.
4. **La casilla `tratamiento_especial` se conserva y la API la mantiene coherente**: hacer relevante a una marca la marca en `por_gml`; desmarcarla conserva sus GML como ignorados; quitar el último GML no la devuelve a barrido. Descartado: exigir marcar antes (`409`) y quitar la casilla.
5. **Las asignaciones se conservan al desmarcar, al pasar a barrido o al desactivar el GML**, calculadas como ignoradas con motivo (criterio de M1b y M3).
6. **Los importadores de nivel y de marcas relevantes comparten `resolverGml` y nunca crean árbol**; el de nivel deja que el archivo mande (como el de estacionalidad); el de relevantes no quita lo ausente (como M2).
7. **Las sugerencias salen de la venta de M5 por una función SQL y nunca se aplican solas.**
8. **El contrato para M7 y M8 es `claveFlujo` + `curvaUnidad` + la vista `marca_gml_especial_vigente`**; la venta de una marca relevante en los GML donde no lo es va a "otras"; las marcas al barrer quedan fuera de las unidades.
9. **FK `marca_id` en cascade, `genero_mundo_linea_id` en restrict.**
10. **La mejora toma la migración `0010` y la versión `0.8.3 · M2b` (renumerada el 2026-10-12: la `0008` es de 05b y la `0009` de 05c) y M6 pasa a `0011`.**

## Preguntas abiertas para Javier

Cada una con su valor por defecto si no responde antes de construir.

1. **Venta de una marca relevante en los GML donde no lo es.** ALFA es relevante en DENIM; su venta de TERNO, ¿va a "otras de RECONOCIDO" en TERNO, o a un flujo aparte "resto de ALFA"? **Por defecto: a "otras"** (es lo que significa "fuerte en jeans y no en ternos"). Si quieres el "resto", es una tercera modalidad.
2. **Desmarcar una marca o desactivar un GML.** **Por defecto: las asignaciones se conservan, se muestran como ignoradas con el motivo, y vuelven solas al revertir** (como los responsables). ¿Prefieres que desmarcar borre los GML?
3. **Marca marcada sin GML.** **Por defecto: es "al barrer"**, guardado como modalidad explícita; al recibir GML pasa a Por GML; si se queda sin GML no vuelve sola (queda pendiente). ¿Y quieres que, cargada la lista real, forcemos en la base que toda marca marcada tenga modalidad (hoy lo garantiza la API)?
4. **Marcar antes o marcar al asignar.** Tú describiste "primero se marcan, luego se asignan". **Por defecto: no se exige**: hacer relevante a una marca sin casilla la marca en Por GML y te lo dice (`confirm` en pantalla, lista en el importador). Así la hoja de GML basta para las de tipo (a) y las sugerencias no chocan. La alternativa es rechazar con `409` hasta que la marques en Marcas.
5. **Quién edita.** **Por defecto: admin y planner (`requirePlanner`) para todo**; el nivel de planificación se ve en el árbol para todos (como el resto del árbol); relevantes y sugerencias no se ven por el comprador hasta M8.
6. **Migración.** Columna `nivel_planificacion` en el nodo, `modalidad_tratamiento` en marcas, tabla `marca_gml_especial` (único por par, cascade desde la marca, restrict desde el nodo), vista `marca_gml_especial_vigente`, función `sugerir_marcas_relevantes`; sin `DROP` ni `UPDATE`; la casilla se conserva. **Toma `0010` (la `0008` es de 05b y la `0009` de 05c) y M6 pasa a `0011`.** ¿Conforme?
7. **Hacer relevante a una marca al barrer la pasa a Por GML** (con `confirm`). **Por defecto: sí.**
8. **Formato de tu hoja de GML.** `MARCA, GENERO, MUNDO, LINEA` (y `NOTA` opcional) con los nombres del árbol o sus códigos. ¿Viene así, o con códigos de QlikView o una columna por GML con una X? ¿Trae la modalidad por marca en la lista de marcas? Si sí, se añade `MODALIDAD` opcional al importador de M2.
9. **Comprador.** **Por defecto: no ve relevantes ni sugerencias hasta M8**; sí ve el nivel GML/GMLE en el árbol.
10. **Versión y etiqueta.** **Por defecto: `0.8.3 · M2b`** (la `0.8.1` pasó a la mejora 05b de M5 y la `0.8.2` a la 05c el 2026-10-12; Javier decidió esa numeración).
11. **Nombre de la tabla.** Tú propusiste `marca_gml_especial`; en pantalla se llama "marcas relevantes por GML". **Por defecto: `marca_gml_especial`**; si prefieres `marca_relevante_gml`, se cambia antes de la migración.
12. **Las marcas al barrer y "mi flujo de Jeans".** **Por defecto: quedan fuera** del flujo del GML (su flujo es independiente) y la vista del GML lo indica ("BETA al barrer: 200 unidades fuera de este flujo"). ¿Prefieres verlas dentro como una línea más de su agrupación?
13. **Apertura a GMLE.** **Por defecto: por nodo entero** (todas sus equivalencias activas, genérica incluida si tiene venta). ¿Necesitas abrir solo una equivalencia de un nodo y dejar el resto junto? Sería una bandera por equivalencia y un "resto del GML".
14. **Cuántas relevantes.** Hablaste de 3-4 por GML. **Por defecto: sin tope; aviso suave si una agrupación pasa de 4 en un GML.** ¿Lo hacemos tope duro?
15. **Sugerencias.** **Por defecto: últimos doce meses publicados, top 4 por GML × agrupación, participación mínima 5 %, por venta en soles, excluyendo VARIOS, OTROS y SIN MARCA.** ¿Te sirven esos valores? ¿Debe la sugerencia considerar también el stock (M8) o solo la venta?
16. **Curva de un nodo a nivel GML.** **Por defecto: mezcla ponderada de las curvas de sus equivalencias por su venta de los últimos doce meses**, y M3 sigue exigiendo agrupación a toda equivalencia. ¿Prefieres que un nodo cerrado use la curva de su equivalencia mayor, o poder asignarle una agrupación de estacionalidad directamente?

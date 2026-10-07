# M1b · Responsables género-mundo

> Estado: **construida (2026-10-07, `0.7.0 · M1b`); hito pendiente de recorrer por Javier con compradores reales**. Especificada el 2026-10-06 y aprobada por Javier. Hoy no hay ningún comprador en producción (solo el usuario admin), así que el reparto de las 40 combinaciones empieza creando compradores en `/usuarios`. Dependencias: [00-cimientos](00-cimientos.md) (`perfiles`, roles) y [01-arbol-producto](01-arbol-producto.md) (`generos`, `mundos`). Independiente de [02-marcas](02-marcas.md), [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) y [04-tiendas](04-tiendas.md) (esta última es la más reciente y la plantilla de estructura). Reglas de base en `docs/PLAN.md` y `docs/DECISIONES.md`. Numerada **M1b** para no renombrar la Fase 2 (M5 sigue siendo la carga de histórico de ventas): es un maestro más de la Fase 1 que cuelga del árbol.

## Objetivo

Javier pidió textualmente: "otro módulo que tenemos que definir es a nivel de género-mundo asignar un responsable." Este módulo le da a cada combinación **género × mundo** (hoy 8 × 5 = 40) un **responsable**: el comprador al que le toca comprar esa combinación. La finalidad, dicha por Javier, es **filtrar**: "los compradores, para que sea más fácil filtrar lo que van a comprar. Los compradores pueden ver todo, pero para filtrar." El responsable no restringe permisos de nadie; sirve para que cada comprador, y el equipo de planeamiento, reduzcan cualquier vista a "las combinaciones que me tocan" o "las de Ana".

El grano es género × mundo, no el nodo género-mundo-línea: como los mundos existen en todos los géneros (decisión de M1), la combinación es el producto cartesiano de los catálogos vigentes y no existe una tabla de pares válidos. Por eso el responsable no puede vivir como columna de `mundos` (el mundo es común a todos los géneros), de `generos` ni de `genero_mundo_linea` (una combinación sin líneas, como un mundo vacío en BEBE, no tendría fila donde guardarlo): necesita tabla propia.

**Qué consumen las fases siguientes de aquí** (M5 en adelante se especifican al cerrar la Fase 1; esto es lo que M1b les deja listo):

- **M5 (carga de histórico)**: no lo usa. Sus reportes de cobertura (qué combinaciones traen venta) podrán agruparse por responsable sin cambiar nada de M1b.
- **M7 (proyección)**: cada vista de proyección puede ofrecer el filtro "Mis combinaciones" y mostrar el responsable de cada género-mundo. Es solo lectura sobre esta tabla.
- **M8 (flujo de mercadería y documento para compradores)**: el documento se puede partir por responsable (las combinaciones de cada comprador). Antes de emitirlo, M8 debería advertir si `resumen.faltantes > 0` (combinaciones sin comprador a quien entregárselas).
- **M9 (herramienta de compradores, Fase 3)**: el comprador entra con "Mis combinaciones" como filtro inicial. Si M9 quisiera además **limitar** quién registra compras en una combinación, sería una decisión nueva de esa ficha; M1b no restringe nada (ver "Decidido con Javier").

En Vector-One el concepto no existe (búsqueda de "responsable" en el repo sin resultados): no hay precedente que copiar ni error previo que evitar.

## Decidido con Javier

Respuestas de Javier a las preguntas abiertas de esta ficha (2026-10-06); entran como decisiones, no como preguntas:

1. **Los responsables son compradores.** "Los compradores, para que sea más fácil filtrar lo que van a comprar." Solo los usuarios con rol `comprador` aparecen en el selector y la API rechaza a cualquier otro rol.
2. **Los compradores pueden ver todo.** "Los compradores pueden ver todo, pero para filtrar." El responsable es un filtro, no un permiso: un comprador ve la matriz completa (y el resto de lo que ya ve) sea o no responsable de algo. Nada se oculta ni se bloquea por no ser el responsable.
3. **Si se elimina al comprador, sus combinaciones quedan sin asignar.** "Si elimino al comprador quedarían sin asignar." Eliminar un usuario borra sus asignaciones (FK `on delete cascade`, no `restrict`) y esas combinaciones aparecen en Faltantes. Eliminar nunca se bloquea por esto; `/usuarios` avisa cuántas combinaciones quedarán libres.

**Luz verde (2026-10-07).** Javier dio luz verde a la ficha y a su construcción. Sus tres respuestas de arriba son reglas firmes. Las siete preguntas abiertas del final **no se han contestado**: el módulo se construyó con los valores por defecto de cada una, que siguen vigentes hasta que Javier responda (resumen al final, en "Preguntas abiertas para Javier"). Cambiar cualquiera es chico, salvo el suplente (pregunta 1), que agrega una columna y una fila de selectores.

## Modelo de datos

Migración `supabase/migrations/0006_responsables.sql`, idempotente, sin bloques `do $$`, **sin `DROP`, `DELETE` ni `TRUNCATE`** (se aplica con `execute_sql`; criterio fijado desde M2). Mismas convenciones que M1–M4: `id uuid primary key default gen_random_uuid()`, `activo boolean not null default true`, `created_at`/`updated_at timestamptz not null default now()`, trigger `set_updated_at` declarado con **`create or replace trigger`**, `enable row level security` sin políticas. **Sin seed**: los responsables los asigna Javier.

### `responsables_genero_mundo`

| Columna | Tipo | Notas |
|---|---|---|
| `genero_id` | `uuid not null` | FK `responsables_genero_mundo_genero_id_fkey` → `generos(id)` **`on delete restrict`** |
| `mundo_id` | `uuid not null` | FK `responsables_genero_mundo_mundo_id_fkey` → `mundos(id)` **`on delete restrict`** |
| `perfil_id` | `uuid not null` | FK `responsables_genero_mundo_perfil_id_fkey` → `perfiles(id)` **`on delete cascade`** |
| `activo` | `boolean not null default true` | ver "Por qué `activo` existe y no se usa" |

Índices: único `responsables_genero_mundo_par_uniq on (genero_id, mundo_id)` (columnas, no expresiones, así PostgREST lo admite en `onConflict: "genero_id,mundo_id"` para el `upsert`); `responsables_genero_mundo_mundo_id_idx on (mundo_id)` y `responsables_genero_mundo_perfil_id_idx on (perfil_id)`. La tabla tendrá del orden de 40 filas y los índices no aceleran nada; se crean porque el advisor de Supabase marca las FK sin índice y M3 ya fijó ese criterio (el único cubre `genero_id` por ser su primera columna).

```
generos ──┐
          ├─► responsables_genero_mundo (genero_id, mundo_id) ─► perfil_id → perfiles (rol = comprador)
mundos  ──┘        una fila por combinación asignada; la ausencia de fila = sin responsable
```

**Por qué tabla propia y no columnas.** Ver el Objetivo: ninguna tabla existente representa el par género × mundo, y el par existe aunque no tenga líneas. Una tabla `genero_mundo` completa (con las 40 filas pre-creadas) se descartó: obligaría a mantenerla sincronizada con los catálogos (crear un mundo o un género exigiría insertar sus filas) y duplicaría la regla ya decidida "no hay relación Género↔Mundo". Con esta tabla, la matriz se arma en memoria con el producto cartesiano y la fila solo existe donde hay responsable.

**Por qué un solo responsable (titular) y no suplente.** Javier dijo "un responsable", y lo mínimo útil es un titular por combinación. Un suplente duplicaría la matriz (80 celdas), las reglas de faltantes y las pantallas por un caso que nadie ha pedido. Dejarlo para después es barato: sería una columna nullable `suplente_perfil_id` en esta misma fila, sin tocar el único (pregunta abierta 1).

**Por qué `perfil_id` es `on delete cascade` y no `restrict` ni `set null`.** Es la respuesta 3 de Javier. Toda otra FK del árbol es `restrict` porque cuelgan hijos con historia; aquí no cuelga nada de la asignación (en Fase 3 las compras cuelgan del usuario que las registra y de la combinación, no de la fila de asignación), y la asignación es un atributo de la persona. `on delete set null` obligaría a `perfil_id` nullable y dejaría dos representaciones de "sin responsable" (sin fila o fila con `null`), con reglas y pruebas duplicadas; con `cascade` la fila existe si y solo si hay alguien asignado. El borrado llega por la cadena `auth.users → perfiles → responsables_genero_mundo`, ambas en cascada, así que el handler de `/usuarios` no necesita ninguna lógica nueva para que funcione. `genero_id` y `mundo_id` siguen `restrict`: la acción normal es desactivar y eliminar solo sin hijos (decisión de M1), y las asignaciones cuentan como hijos.

**Los tres estados de "no hay responsable válido".** La base solo sabe si hay fila. El resto se calcula (`motivoFaltante`, igual que M3 calcula "faltante" y M4 calcula el estado de la tienda), porque depende de tablas que cambian por otras pantallas:

| Motivo | Cuándo | Qué hace la asignación |
|---|---|---|
| `sin_responsable` | combinación vigente sin fila | no existe |
| `responsable_inactivo` | la fila apunta a un perfil con `activo = false` | **se conserva**; vuelve a ser válida si se reactiva al usuario |
| `responsable_no_comprador` | la fila apunta a un perfil cuyo rol dejó de ser `comprador` | **se conserva**; vuelve a ser válida si el rol vuelve a `comprador` |

Por qué se conservan en vez de limpiarse: es el mismo criterio sin cascada de `activo` del árbol y de M3 (`agrupacion_inactiva`): reactivar o corregir un rol por error devuelve todo tal como estaba, y la edición de un usuario en `/usuarios` no borra datos de otra pantalla a escondidas. A cambio, la combinación **no queda silenciosamente asignada a alguien que no entra o que ya no compra**: cuenta como faltante, con motivo visible, hasta que se reasigne. Si coinciden dos motivos (desactivado y no comprador), se informa `responsable_inactivo`.

**Combinación vigente** = género activo y mundo activo. Una combinación no vigente nunca es faltante y no se puede asignar (la asignación existente se conserva si luego se desactiva el género o el mundo, y reaparece al reactivarlo).

**Por qué `activo` existe y no se usa.** Se mantiene por la convención de PLAN §4 ("toda tabla lleva `activo`"). La API no lo expone: **quitar un responsable borra la fila** (no cuelga nada de ella, y desactivar en vez de borrar dejaría un estado más). Las lecturas tratan una fila con `activo = false` (solo posible desde el SQL Editor) como sin responsable, y toda asignación la escribe con `activo = true`. Si Javier prefiere no tener columnas sin uso, se quita y la entrada nueva 7 se retira (es el mismo criterio con el que se descartaron `tallas` y `equivalencia_marca`).

**Aplicada y verificada.** `0006_responsables.sql` está aplicada en `vector-two` (dos veces, sin error, sin `DROP`, `DELETE` ni `TRUNCATE`) y los tipos regenerados. Cifras de producción antes de aplicar: 8 géneros × 5 mundos = 40 combinaciones, y solo existía el usuario admin (ningún comprador). La cascada `perfiles → responsables_genero_mundo` y `auth.users → perfiles → responsables_genero_mundo` se probó en un Postgres local: borrar el perfil, o la fila de `auth.users`, elimina sus asignaciones. No se ha probado todavía con la API de Auth real (`deleteUser`).

## Contratos de API

Todos devuelven `{ data }` con `ok()` o `{ error }` con `error()` de `src/lib/api/respuestas.ts`; cuerpos con `leerCuerpo` y esquemas zod en `src/lib/responsables/esquemas.ts`; errores de base con `traducirErrorDb`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod · `404` género, mundo o usuario inexistente · `409` regla de negocio · `500` genérico. Lecturas `requireUser` (el comprador lee todo); escrituras `requirePlanner` (admin y planner, como M2–M4: nada aquí es raíz como para reservarlo al admin). Las lecturas pasan por `leerTodo`.

### Matriz

`GET /api/responsables?incluir_inactivos=1` · `requireUser`.

Una sola lectura con todo lo que la pantalla y el árbol necesitan: catálogos, las celdas del producto cartesiano, los compradores asignables y el resumen. Lee `generos`, `mundos`, `perfiles`, `responsables_genero_mundo` y, para contar líneas por celda, `genero_mundo_linea` y `lineas` (con `leerNodos` y `leerLineas`; **no** lee equivalencias, que son las 1 790 filas pesadas del árbol). Por defecto solo géneros y mundos activos; con `incluir_inactivos=1`, todos, y la celda lleva `vigente`.

```jsonc
{ "data": {
  "generos": [ { "id": "…", "codigo": "H", "nombre": "HOMBRE", "orden": 10, "activo": true } ],
  "mundos":  [ { "id": "…", "codigo": "URBANO", "nombre": "URBANO", "orden": 20, "activo": true } ],
  "celdas": [
    { "genero_id": "…", "mundo_id": "…", "vigente": true, "lineas": 12,
      "responsable": { "id": "…", "nombre": "ANA RAMOS", "email": "ana@…", "rol": "comprador", "activo": true },
      "faltante": false, "motivo_faltante": null },
    { "genero_id": "…", "mundo_id": "…", "vigente": true, "lineas": 0,
      "responsable": null, "faltante": true, "motivo_faltante": "sin_responsable" },
    { "genero_id": "…", "mundo_id": "…", "vigente": true, "lineas": 7,
      "responsable": { "id": "…", "nombre": null, "email": "luis@…", "rol": "comprador", "activo": false },
      "faltante": true, "motivo_faltante": "responsable_inactivo" }          // o "responsable_no_comprador"
  ],
  "compradores": [ { "id": "…", "nombre": "ANA RAMOS", "email": "ana@…" } ],  // comprador y activo; [] para el rol comprador
  "resumen": {
    "combinaciones": 40, "con_responsable": 37, "faltantes": 3,
    "faltantes_sin_responsable": 1, "faltantes_responsable_inactivo": 1, "faltantes_responsable_no_comprador": 1,
    "faltantes_sin_lineas": 1,
    "por_responsable": [ { "perfil_id": "…", "nombre": "ANA RAMOS", "email": "ana@…", "combinaciones": 12, "valido": true } ]
  }
} }
```

- `celdas` es el producto cartesiano de los géneros y mundos devueltos, ordenado por género (`orden`, `nombre`) y mundo (`orden`, `nombre`): con 8 y 5, siempre 40, haya o no asignaciones o líneas.
- `lineas` = nodos vigentes de la pareja (nodo activo, línea activa, género y mundo activos; `nodoVigente` de `src/lib/arbol/armar-arbol.ts`). Es contexto para la pantalla; no entra en la definición de faltante.
- `compradores` solo se llena para admin y planner (los que pueden asignar); al comprador se le devuelve `[]` (mínimo privilegio: no necesita la lista de usuarios). La `celda.responsable` sí lleva nombre y correo para todos los roles, porque saber quién es el responsable es el objetivo del módulo.
- `resumen` cuenta combinaciones **vigentes**: `combinaciones = con_responsable + faltantes` y `faltantes = sin_responsable + responsable_inactivo + responsable_no_comprador`. `faltantes_sin_lineas` es informativo (cuántas de las faltantes están en combinaciones sin líneas vigentes). `por_responsable` va de más a menos combinaciones y luego por nombre; `valido = activo y rol comprador`. El hito se comprueba por API con `resumen.faltantes === 0`.
- No hay `GET /faltantes` aparte (M3 lo tiene): con 40 celdas el reporte es un filtro en memoria sobre esta misma lectura, y la pantalla ve así un único estado.
- `useColeccion` no sirve aquí (espera un arreglo y esta lectura devuelve un objeto); el panel usa un hook propio `use-responsables.ts`, como el árbol usa `use-arbol.ts`.

### Asignación individual

`PUT /api/responsables` · `requirePlanner`. Asigna, cambia o quita el responsable de **una** combinación. Idempotente.

```ts
// src/lib/responsables/esquemas.ts
asignarUnaSchema = z.object({
  genero_id: z.uuid(), mundo_id: z.uuid(),
  perfil_id: z.uuid().nullable(),          // null = quitar el responsable
});
```

Respuesta `200`: la `celda` resultante (misma forma que arriba), para que el selector se actualice sin recargar la matriz. Con `perfil_id` no nulo: `upsert` sobre `(genero_id, mundo_id)` con `activo: true`. Con `null`: borra la fila si existe (si no existe, `200` sin cambios).

| Código | Cuándo |
|---|---|
| `400` | zod (ids que no son UUID, cuerpo vacío) |
| `404` | género o mundo inexistente: "Género no encontrado." / "Mundo no encontrado."; usuario inexistente: "Usuario no encontrado." |
| `409` | el usuario no es comprador: "ANA RAMOS no es comprador: solo los compradores pueden ser responsables."; el usuario está desactivado: "ANA RAMOS está desactivado. Reactívalo o elige otro."; el género o el mundo está inactivo: "HOMBRE está inactivo: no se puede asignar responsable." (solo al asignar; quitar siempre se permite) |

### Asignación en bloque

`POST /api/responsables/asignar` · `requirePlanner`. Una fila, una columna o toda la matriz: el cliente manda la lista de combinaciones.

```ts
asignarMasivaSchema = z.object({
  combinaciones: z.array(z.object({ genero_id: z.uuid(), mundo_id: z.uuid() })).min(1).max(400),
  perfil_id: z.uuid().nullable(),                 // null = quitar a todas
  solo_faltantes: z.boolean().default(false),     // true = no pisar a quien ya tiene un responsable válido
}).refine(v => !(v.perfil_id === null && v.solo_faltantes),
          { message: "No se puede quitar el responsable solo a las faltantes.", path: ["solo_faltantes"] });
```

1. Si `perfil_id` no es nulo: `404` si no existe, `409` si no es comprador o está desactivado (mismas reglas y mensajes que el individual; falla toda la petición porque el error es del destino, no de las celdas).
2. Se deduplican las combinaciones. Las que no existan (género o mundo borrado desde que se cargó la pantalla) vuelven en `no_encontradas` y **no** abortan; al asignar, las que no sean vigentes vuelven en `no_vigentes`. Es el mismo criterio de M3: una pantalla con datos viejos no pierde el trabajo por una combinación que cambió.
3. Con `solo_faltantes: true`, se saltan las celdas cuyo responsable actual es válido (activo y comprador); se cuentan en `con_responsable`. "Faltante" es la misma `motivoFaltante` de la matriz (una celda con responsable desactivado sí se reemplaza). Se hace en el servidor y no solo en la pantalla para que "completar las vacías" nunca pise una asignación que otro planner hizo hace un minuto.
4. Escritura: un `upsert` (`onConflict: "genero_id,mundo_id"`, `activo: true`) con las celdas a asignar y un `delete … in (ids)` con las filas a quitar, en tandas de 150 ids (`TANDA_IN`, mismo criterio de M3 por el largo de la URL). Sin transacción (supabase-js no las expone); repetir la misma petición completa lo que faltó sin efectos secundarios (es idempotente).
5. Respuesta `200`:

```jsonc
{ "data": { "asignadas": 3, "quitadas": 0, "sin_cambio": 1, "con_responsable": 1, "no_encontradas": [], "no_vigentes": [] } }
```

`asignadas` = filas nuevas o cuyo responsable cambió; `sin_cambio` = ya tenían ese responsable (o no tenían y se pidió quitar); `con_responsable` = saltadas por `solo_faltantes`.

### Cambios en la API de M0 (`/usuarios`)

Mínimos, compatibles hacia atrás, solo admin:

- `GET /api/usuarios`: cada perfil suma `responsabilidades: number` (filas de `responsables_genero_mundo` con ese `perfil_id`, vigentes o no). Una sola lectura adicional de la tabla (≤ unas decenas de filas) agrupada en memoria.
- `DELETE /api/usuarios/[id]`: antes de borrar cuenta las responsabilidades y las devuelve: `{ id, combinaciones_liberadas: N }`. El borrado en sí no cambia (Auth → `perfiles` → asignaciones, todo en cascada) y **no hay `409` por responsabilidades**: Javier dijo que quedan sin asignar.
- `PATCH /api/usuarios/[id]` no cambia: desactivar o cambiar el rol nunca se rechaza por tener responsabilidades; el aviso es de pantalla.

### Extensiones a lo compartido

- `src/lib/api/errores-db.ts`: `MENSAJES_UNICO` suma `responsables_genero_mundo_par` ("Esa combinación género-mundo ya tiene responsable."; solo alcanzable si alguien inserta a mano, porque la API usa `upsert`). `MENSAJES_FK` suma tres entradas: `responsables_genero_mundo_genero_id_fkey` (`eliminar`: "No se puede eliminar el género: tiene responsables asignados. Quítalos o desactívalo."; `asignar`: `404` "Género no encontrado."), `…_mundo_id_fkey` (ídem con "mundo") y `…_perfil_id_fkey` (`asignar`: `404` "Usuario no encontrado."; `eliminar` queda con el texto genérico: con `cascade` borrar un perfil nunca viola esta FK). Esto cubre el caso real de eliminar un género o mundo sin nodos pero con responsables: el handler de catálogos solo cuenta nodos, así que la FK es la red de seguridad y ahora habla claro.
- No se toca `src/lib/api/catalogo.ts` ni `armarArbol`: el árbol pide la matriz con una segunda llamada (ver Pantallas).

## Pantallas

### `/maestros/responsables` — Matriz

Ruta nueva en el menú **Maestros**, entrada "Responsables género-mundo", **sin restricción de rol** (la ven los tres, como el árbol): el comprador la necesita para filtrar y puede ver todo. En `src/lib/nav.ts` va justo después de "Árbol de producto" (es el vocabulario del árbol) y sin `roles`; `tests/nav.test.ts` pasa a esperar que el comprador vea `["/maestros/arbol", "/maestros/responsables"]`, que el planner vea cinco maestros y que `puedeVerRuta("comprador", "/maestros/responsables")` sea `true`. `page.tsx` servidor: redirige a `/` solo si `perfilActual()` no es `ok` (igual que el árbol) y pasa `rol` y el id del usuario al panel cliente `responsables-panel.tsx`. La página de inicio suma el módulo M1b a su lista, enlazado.

| Qué | admin y planner | comprador |
|---|---|---|
| Ver la matriz completa, filtros, resumen, CSV | sí | sí |
| Cambiar el responsable de una celda | sí | no (ve el nombre como texto) |
| Asignar en bloque | sí | no |
| Aviso "Vista de solo lectura" | no | sí |

**Encabezado y resumen** (de `resumen`): `8 géneros × 5 mundos = 40 combinaciones · 37 con responsable · 3 faltantes`. Si `faltantes = 0`: `Alert` de éxito "Toda combinación vigente tiene responsable". Si no, el número de faltantes en tono alerta, con el desglose "1 sin responsable · 1 responsable desactivado · 1 responsable ya no es comprador". Interruptor **Mostrar inactivos** (`Switch`, géneros y mundos desactivados, atenuados con badge "Inactivo"; ahí no hay selector).

**Filtros** (`Chips` más un `Select`; se aplican en memoria con `filtrarCeldas`, las filas y columnas sin ninguna celda visible se atenúan pero no desaparecen, para que la forma de la matriz no cambie):

- `Todas (40)` · `Faltantes (3)` · `Mis combinaciones (12)` (visible para quien tenga al menos una; es el filtro para el que existe el módulo).
- `Select` **Responsable**: Todos · cada comprador con asignaciones y su conteo ("ANA RAMOS (12)") · Sin responsable. El chip y el select son excluyentes entre sí.
- Para el comprador que tiene combinaciones asignadas, la pantalla **abre con "Mis combinaciones"** activo y "Todas" a un clic (pregunta abierta 4). Ve todo; el filtro es solo el punto de partida.
- `?responsable=<uuid>` abre la pantalla filtrada por ese usuario (es el enlace de `/usuarios`). Solo se acepta si es un UUID y tiene prioridad sobre "Mis combinaciones". Si el filtro apunta a alguien sin combinaciones vigentes, el `Select` lo muestra como "Responsable elegido (sin combinaciones vigentes)".
- Los conteos de los chips cuentan solo combinaciones vigentes, de modo que coinciden con `resumen` (ver "Cambios respecto a la especificación").

**Matriz** (tabla; filas = géneros por `orden`, columnas = mundos por `orden`):

- Encabezado de fila: nombre del género y cuántas de sus combinaciones tienen responsable ("5/5"). Encabezado de columna: nombre del mundo y "7/8". Esquina: "Asignar todas…" (solo planner y admin).
- Cada celda muestra, en este orden: el responsable (nombre, o el correo si no tiene nombre) y debajo, atenuado, "12 líneas" (la celda de una combinación sin líneas dice "sin líneas" pero se asigna igual: el mundo existe en todo género).
- Estados de la celda: asignada válida (neutra); **Faltante** (fondo de alerta) con el motivo en texto: "Sin responsable", "ANA RAMOS · desactivado" o "ANA RAMOS · ya no es comprador"; celda de género o mundo inactivo (atenuada, sin selector, "Inactivo").
- Para admin y planner, cada celda es un `Select` que **guarda al instante** (como la agrupación en el árbol de M3) con las opciones "— Sin responsable —" y los compradores activos por nombre; si el responsable actual no es válido aparece como opción deshabilitada "ANA RAMOS (desactivado)" para que se vea qué se está cambiando. Un error de la API (`404` usuario borrado, `409` desactivado) se muestra en un `Alert` encima de la matriz y recarga la lista de compradores.
- Si no hay compradores activos, los selectores quedan vacíos y un aviso dice "No hay compradores activos. Un administrador puede crearlos en Usuarios." (con enlace solo para el admin).

**Asignar en bloque** (solo admin y planner): desde el encabezado de una fila, de una columna o la esquina, "Asignar…" abre un panel en línea con: `Select` de comprador (o "Quitar responsable"), casilla **"Reemplazar también las que ya tienen responsable"** (apagada por defecto = `solo_faltantes: true`) y el texto que calcula `planificarBloque`: "Se asignarán 3 de 5 combinaciones de HOMBRE (2 ya tienen responsable y no se tocan)". Aplicar pide `confirm` cuando va a reemplazar a alguien ("Se reemplazará el responsable de 2 combinaciones…") o a quitar. Tras aplicar, `Alert` de éxito con `asignadas / sin_cambio / con_responsable`. Con la casilla apagada y "Quitar", el botón se deshabilita con el motivo ("No se puede quitar el responsable solo a las faltantes"). Si el comprador elegido deja de estar activo mientras el panel está abierto, el panel vuelve a "Elige un comprador…".

**Carga por responsable** (tarjeta lateral o debajo): lista de `por_responsable` con nombre, conteo y una marca "desactivado" / "ya no es comprador" donde `valido = false`; clic en un nombre aplica ese filtro.

**Descargar CSV**: botón que baja lo visible (`descargarCsv` de `src/components/importador/csv.ts`, con BOM) con columnas `GENERO, MUNDO, RESPONSABLE, CORREO, ESTADO` (`Asignada` / `Sin responsable` / `Responsable desactivado` / `Responsable ya no es comprador`, y `Inactiva` para las celdas de un género o mundo inactivo). Sirve para compartir el reparto o revisarlo en Excel.

**No hay importador.** Son 40 celdas. Con la asignación en bloque por fila, columna o toda la matriz, repartir todo el catálogo son cinco o seis acciones, y un importador sería la pieza más grande del módulo (hay que resolver usuarios por nombre o correo, con homónimos, errores de tipeo y desactivados, y ya cuesta lo mismo que lo que ahorra). Si el catálogo de géneros o mundos creciera mucho o llegaran cientos de combinaciones, se reabre.

### `/maestros/arbol` — responsable a la vista (solo lectura)

El panel del árbol pide `GET /api/responsables?incluir_inactivos=1` como segunda llamada (con el hook compartido `useResponsables`; los inactivos cubren lo que el árbol muestre con "Mostrar inactivos"). Si falla, el árbol sigue funcionando y muestra un `Alert` informativo ("No se pudo cargar el responsable de cada combinación… El árbol funciona igual, sin mostrar responsables") con un enlace Reintentar. Dos cambios, de solo lectura para todos los roles:

- Columna **Mundos** del género elegido: bajo el nombre de cada mundo, el responsable de esa combinación como texto pequeño (o "Sin responsable" en tono alerta, o "NOMBRE · desactivado").
- Columna **Líneas**: el subtítulo mantiene el conteo de líneas y suma el responsable: `HOMBRE / URBANO · 12 líneas · Responsable: ANA RAMOS`, con enlace "Cambiar" a la matriz solo para admin y planner. Con el subtítulo largo, el botón "Agregar línea" puede partirse en dos líneas (ver "Limitaciones conocidas").

La edición vive solo en la matriz: no hay dos caminos para cambiar un responsable. Un filtro "Solo mis combinaciones" dentro del árbol (que oculte los géneros y mundos que no le tocan al comprador) **queda como propuesta, fuera de M1b** (pregunta abierta 5); `filtrarCeldas` ya deja la lógica lista.

### `/usuarios` — avisos (sin bloquear)

La tabla suma la columna **Responsable de**: `N combinaciones` con enlace a `/maestros/responsables?responsable=<uuid>` (o "—" si N = 0). Los `confirm` existentes suman el aviso cuando `responsabilidades > 0` (texto de `avisoResponsabilidades(accion, n, nombre)`, que lleva el nombre del usuario y la pregunta final, y concuerda singular y plural):

- **Desactivar**: "ANA RAMOS es responsable de 6 combinaciones género-mundo. Seguirán asignadas pero aparecerán como Faltantes (responsable desactivado) hasta que las reasignes. ¿Desactivar?"
- **Eliminar**: "Esta acción no se puede deshacer." y debajo "ANA RAMOS es responsable de 6 combinaciones género-mundo. Al eliminar el usuario quedarán sin responsable y aparecerán en Faltantes. ¿Eliminar definitivamente?" (sin combinaciones, el `confirm` de siempre). Tras borrar, `Alert` "Usuario eliminado. 6 combinaciones quedaron sin responsable."
- **Cambiar el rol de un comprador a otro rol** (el `Select` no pedía confirmación; la pide solo en este caso): "ANA RAMOS es responsable de 6 combinaciones género-mundo. Solo los compradores pueden serlo: seguirán asignadas pero aparecerán como Faltantes (ya no es comprador) hasta que el rol vuelva a comprador o las reasignes. ¿Cambiar el rol?"
- **Reactivar** o devolver el rol de comprador no pide nada: las asignaciones vuelven a ser válidas solas.

## Reglas de negocio

Funciones puras en `src/lib/responsables/` (`tipos.ts`, `tipos-api.ts`, `esquemas.ts`, `reglas.ts`, `matriz.ts`, `filtros.ts`, `csv.ts`, `consultas.ts`, `pantalla.ts` y el hook `use-responsables.ts`) probadas en `tests/responsables.*.test.ts`. Se reutilizan `normalizarNombre`, `leerTodo`, `leerNodos`, `leerLineas` y `nodoVigente` del árbol.

**`matriz.ts` — `armarMatriz(generos, mundos, asignaciones, perfiles, nodos, lineas, { incluirInactivos })`**

1. **Producto cartesiano.** Devuelve exactamente `géneros × mundos` celdas, aunque no haya asignaciones ni nodos (8 × 5 = 40); sin `incluirInactivos`, solo géneros y mundos activos; orden por `orden, nombre` de género y luego de mundo. Crear un mundo nuevo agrega una columna de celdas sin responsable sin escribir nada en la base.
2. **Vigencia.** `combinacionVigente(genero, mundo)` es género activo y mundo activo. Una celda no vigente tiene `faltante: false` aunque no tenga responsable, y conserva su asignación si la tenía.
3. **`motivoFaltante(celda)`** es la única definición de faltante (la usan la matriz, el resumen, el bloque, el filtro y el CSV): vigente sin fila (o fila con `activo = false`) → `sin_responsable`; vigente con perfil `activo = false` → `responsable_inactivo`; vigente con perfil de rol distinto de `comprador` → `responsable_no_comprador`; si coinciden desactivado y no comprador, gana `responsable_inactivo`; vigente con perfil activo y comprador → `null`.
4. **Resumen consistente.** `combinaciones = con_responsable + faltantes`; `faltantes = sin_responsable + responsable_inactivo + responsable_no_comprador`; `por_responsable` suma, por cada perfil, solo las celdas vigentes que tiene, ordenado por conteo descendente y luego por nombre, y `valido` solo si es activo y comprador. Con 40 celdas y ninguna fila: `faltantes = 40`.
5. **Líneas por celda** = nodos vigentes de la pareja (nodo activo, línea activa, género y mundo activos). Una combinación sin nodos tiene `lineas: 0` y sigue siendo celda (y faltante si no tiene responsable). `faltantes_sin_lineas` cuenta solo faltantes con `lineas = 0`.

**`reglas.ts`**

6. **`motivoRechazoAsignacion({ perfilId, perfil, genero, mundo })`** devuelve `{ status, mensaje } | null`: género o mundo inexistente → `404` ("Género no encontrado." / "Mundo no encontrado."); perfil inexistente → `404`; perfil con rol distinto de `comprador` → `409` "…no es comprador…"; perfil desactivado → `409` "…está desactivado…"; género o mundo inactivo → `409`; todo bien → `null`. Con `perfil_id = null` (quitar) no se evalúa el perfil ni la vigencia, pero género y mundo sí deben existir. La parte del perfil vive aparte en `motivoRechazoPerfil` (la usa también la asignación en bloque, donde el error es del destino). Un administrador o planner **nunca** es asignable, aunque esté activo (respuesta 1 de Javier; ver pregunta abierta 2).
7. **`planificarAsignacion(actuales, combinaciones, perfilId, { soloFaltantes }, perfiles)`** devuelve `{ asignar, quitar, sin_cambio, con_responsable }`: deduplica combinaciones; con `perfilId` no nulo, una celda cuyo responsable ya es ese perfil va a `sin_cambio`, y con `soloFaltantes` una celda con responsable válido distinto va a `con_responsable` y no se toca (una con responsable desactivado o no comprador sí se reemplaza); con `perfilId = null`, las celdas con fila van a `quitar` y las demás a `sin_cambio`. **Idempotencia**: volver a planificar sobre el estado resultante da `asignar = []` y `quitar = []`; aplicar dos veces el mismo plan produce el mismo estado.
8. **`asignarMasivaSchema`**: rechaza lista vacía, más de 400, ids que no son UUID, y `perfil_id: null` con `solo_faltantes: true`; `solo_faltantes` por defecto `false`. `asignarUnaSchema` exige `perfil_id` presente (nulo o UUID): un cuerpo sin él es `400`, no "quitar".
9. **`planificarBloque(celdas, ámbito, { soloFaltantes })`** (`reglas.ts`; la pantalla usa su gemela `planBloque` de `pantalla.ts`, y un test comprueba que las dos coinciden): `ámbito` es `{ genero_id }` (fila), `{ mundo_id }` (columna) o `"todas"`; devuelve las combinaciones vigentes del ámbito y, para el texto del panel, cuántas se asignarán y cuántas se respetan. Las celdas no vigentes nunca entran. Una fila de 5 con 2 asignadas válidas: con `soloFaltantes` son 3 y 2 se respetan; sin él son 5.
10. **`avisoResponsabilidades(accion, n, nombre)`** (`"desactivar" | "eliminar" | "cambiar_rol"`): `n = 0` → `null`; `n > 0` → el texto de la pantalla de usuarios con el nombre, el conteo y la pregunta final, todo concordado en singular o plural ("1 combinación … seguirá asignada", "6 combinaciones … seguirán asignadas"). Nunca produce un rechazo: `/usuarios` avisa y no bloquea.

**`filtros.ts`**

11. **`filtrarCeldas(celdas, filtro)`** con `filtro` = `todas` | `faltantes` | `{ responsable: perfilId }` | `sin_responsable`; descarta siempre las celdas no vigentes (en todos los filtros); `faltantes` = `motivoFaltante ≠ null`; `sin_responsable` = `responsable === null`; `{ responsable }` compara por `perfil_id` y **no** exige que sea válido (así se ve y se corrige lo que ya no lo es). Los conteos de los chips salen de la misma función, de modo que `todas = vigentes`, `faltantes` = `resumen.faltantes` y "Mis combinaciones" = `{ responsable: yo }`.
12. **Un comprador sin combinaciones** no ve el chip "Mis combinaciones" y la pantalla abre en "Todas"; uno con combinaciones abre en "Mis combinaciones". Ningún filtro oculta datos del servidor: el cliente siempre recibió todo.

**`csv.ts`**

13. `filasCsvResponsables(celdas, generos, mundos)` genera una fila por celda con `GENERO, MUNDO, RESPONSABLE, CORREO, ESTADO`, sin perder comas ni comillas en nombres (las escapa `Papa.unparse`) y con el estado en texto según `motivoFaltante` (más `Inactiva` si el género o el mundo están inactivos).

**Errores y compartidos**

14. `describirErrorDb` traduce: `23505` sobre `responsables_genero_mundo_par` → `409` "Esa combinación género-mundo ya tiene responsable."; `23503` por `insert or update` sobre `…_perfil_id_fkey` → `404` "Usuario no encontrado."; `23503` por `update or delete` sobre `generos` o `mundos` con ese constraint → `409` con el mensaje de "tiene responsables asignados".
15. **Eliminar un usuario libera sus combinaciones** (propiedad de la base: verificada en un Postgres local; falta repetirla con la API de Auth real en el hito): tras eliminar, `resumen.faltantes` sube exactamente en las combinaciones que tenía y el borrado no devuelve `409`. La función pura equivalente: `armarMatriz` sin las filas de ese perfil da `sin_responsable` en esas celdas.
16. **Desactivar o cambiar el rol no toca la tabla**: las filas se conservan; `armarMatriz` con ese perfil desactivado o no comprador da `responsable_inactivo` / `responsable_no_comprador`, y reactivarlo o devolverle el rol de comprador deja otra vez `faltante: false` sin reasignar.
17. **`nav.ts`**: el comprador ve "Responsables género-mundo" y puede abrir la ruta; admin y planner también.

## Hito de prueba

Cómo leer las casillas: `[x]` lo cubrieron QA y la construcción (pruebas unitarias, handlers contra un stub de Supabase y un Postgres local); `[ ]` solo se puede comprobar contra la base real y con compradores reales, y lo recorre Javier. QA recomienda repetir una vez el hito del bloque (`upsert`) contra la base real.

**Cubierto**

- [x] Checks automáticos: `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (571 pruebas en 38 archivos) y `npm run build` en verde. `scripts/validar-migraciones-local.sh` también pasó en QA (0000–0006 dos veces, sin ningún `ERROR` en la salida completa, 13 tablas con RLS).
- [x] `0006_responsables.sql` aplicada dos veces en `vector-two` sin error, sin `DROP`, `DELETE` ni `TRUNCATE`; `responsables_genero_mundo` con RLS y sin políticas; tipos regenerados; `APP_VERSION` = `0.7.0 · M1b`.
- [x] Cascada probada en Postgres local: borrar el perfil (o la fila de `auth.users`) elimina las asignaciones de ese usuario.
- [x] Tabla vacía (stub): `GET /api/responsables` devuelve el producto cartesiano completo (8 géneros × 5 mundos = 40 celdas, cifras de la base antes de aplicar), `resumen.faltantes = 40`, y admin y planner no aparecen en `compradores`.
- [x] Rechazos de la asignación individual (stub y pruebas de `motivoRechazoAsignacion`): admin o planner → `409` "no es comprador"; usuario inexistente → `404`; comprador desactivado → `409`; género o mundo inactivo → `409`.
- [x] Permisos (stub): como comprador, `PUT /api/responsables` y `POST /api/responsables/asignar` → `403` y `GET` devuelve `compradores: []`.
- [x] Lógica del bloque (pruebas): solo faltantes respeta lo asignado, reemplazar pisa, quitar con la casilla apagada se rechaza, idempotente; `planBloque` y `planificarBloque` coinciden.
- [x] Filtros (pruebas): los conteos de Todas, Faltantes y Mis combinaciones coinciden con `resumen`; la carga por responsable suma las celdas asignadas.
- [x] Desactivar o cambiar el rol conserva la asignación y la marca como faltante; reactivar o devolver el rol la restaura (pruebas de `armarMatriz`).
- [x] `/api/usuarios`: `GET` trae `responsabilidades` y `DELETE` responde `{ id, combinaciones_liberadas }` sin `409` por responsabilidades; "último admin" y "no auto-eliminarse" intactas (stub).

**Pendiente con la base real y compradores reales (Javier)**

- [ ] Crear compradores en `/usuarios` (hoy solo existe el admin): el `Select` de las celdas los lista y no lista a admin ni planner.
- [ ] Como planner, en `/maestros/responsables` asignar a un comprador en una celda: se ve al instante, `faltantes` baja a 39 y "— Sin responsable —" la devuelve a faltante.
- [ ] Bloque contra Supabase real (el `upsert` con `onConflict` y `.select()` no se ha probado ahí): "Asignar…" en la fila HOMBRE con la casilla apagada asigna solo las vacías y respeta las ya asignadas (el panel anticipa los conteos); con la casilla encendida pide `confirm` y las reemplaza; "Asignar todas…" cubre las 40; quitar en bloque deja las celdas en faltante.
- [ ] **Hito del módulo**: repartir las 40 combinaciones entre los compradores reales hasta que el resumen diga "Toda combinación vigente tiene responsable" (`resumen.faltantes = 0`).
- [ ] **Desactivar** a un comprador con combinaciones: `/usuarios` avisa cuántas y no bloquea; sus celdas pasan a Faltante con "ANA RAMOS · desactivado" y siguen contando en "Carga por responsable" como no válido; reactivarlo las devuelve a válidas sin reasignar.
- [ ] **Cambiar el rol** de ese comprador a planner: el `confirm` avisa; sus celdas pasan a Faltante con "ya no es comprador"; devolverle el rol `comprador` las restaura.
- [ ] **Eliminar** a un comprador con combinaciones (Auth real, `deleteUser` y la cascada completa): `/usuarios` avisa, borra sin `409`, muestra "Usuario eliminado. N combinaciones quedaron sin responsable" y esas celdas aparecen como "Sin responsable" en la matriz (verificar con `select count(*) from responsables_genero_mundo where perfil_id = …` = 0).
- [ ] Como comprador real: ve "Responsables género-mundo" en el menú, la matriz completa sin selectores ni botones de bloque y el aviso "Vista de solo lectura"; abre con "Mis combinaciones" si tiene alguna y "Todas" muestra las 40.
- [ ] Desactivar un mundo: su columna sale de la matriz (o se atenúa con "Mostrar inactivos"), deja de contar en `combinaciones` y conserva sus responsables al reactivarlo. Eliminar un género o mundo sin nodos pero con responsables → `409` "tiene responsables asignados" (la traducción está probada; falta ver la FK real).
- [ ] Árbol: la columna Mundos muestra el responsable de cada mundo del género elegido y la columna Líneas lo muestra en el subtítulo (sin responsable en tono alerta); el comprador lo ve igual; revisar que "Agregar línea" no se parta feo con un subtítulo largo.
- [ ] "Descargar CSV" abre en Excel real con acentos correctos y las 40 filas (o las del filtro).
- [ ] Persistencia: lo asignado sobrevive a recargar la página, con datos reales.

## Fuera de alcance

- **Suplente o varios responsables por combinación**: un titular (pregunta abierta 1). Sería una columna nullable `suplente_perfil_id` más adelante.
- **Que los administradores o planners sean responsables**: Javier dijo compradores (pregunta abierta 2). Abrirlo es cambiar la regla 6 y `compradores` en la lectura.
- **Restringir permisos por responsable**: el responsable es un filtro, no un permiso. Que en M9 solo el responsable registre compras de su combinación sería una decisión de esa ficha.
- **El filtro "Solo mis combinaciones" dentro del árbol y de otras vistas** (propuesta, pregunta abierta 5): M1b entrega el filtro en la matriz y la lógica compartida (`filtrarCeldas`); M7, M8 y M9 lo usan al construirse.
- **Responsable por línea, equivalencia o marca**: el grano es género × mundo; más fino no se ha pedido.
- **Importar responsables desde CSV o Excel**: no vale la pena (ver Pantallas).
- **Historial de quién fue responsable y cuándo**, y quién hizo cada asignación: auditoría pendiente desde M0.
- **Notificaciones** al comprador cuando se le asigna o se le quita una combinación.
- **Control de concurrencia**: dos planners editando la misma celda a la vez; gana la última escritura.

## Decisiones nuevas que propone esta ficha

Registradas en `docs/DECISIONES.md` el 2026-10-07, al cerrar el módulo; ninguna contradice una entrada vigente, pero la 2 introduce la primera FK `on delete cascade` fuera de `perfiles → auth.users` y la 7 matiza la convención de PLAN §4:

1. **El responsable de una combinación género-mundo es un comprador, y sirve para filtrar, no para limitar permisos.** Un usuario `comprador` por combinación (titular único), tabla propia `responsables_genero_mundo` con único sobre la pareja. Por qué: es lo que pidió Javier ("para que sea más fácil filtrar lo que van a comprar… pueden ver todo, pero para filtrar"); el par no existe como entidad en el árbol y existe aunque no tenga líneas. Descartado: columna en `mundos`, `generos` o en el nodo (no cubren el par); tabla pre-poblada con las 40 filas (hay que sincronizarla con los catálogos); texto libre (no filtra por usuario ni sirve a la Fase 3); suplente (nadie lo pidió).
2. **Eliminar un comprador deja sus combinaciones sin asignar: `perfil_id` es `on delete cascade`.** Por qué: respuesta de Javier ("si elimino al comprador quedarían sin asignar"); nada cuelga de la asignación; con `set null` habría dos formas de "sin responsable". `genero_id` y `mundo_id` siguen `restrict`. Descartado: `restrict` (obligaría a reasignar antes de borrar a alguien que ya se fue); `set null` (por lo anterior).
3. **Desactivar al comprador o cambiarle el rol conserva la asignación, que pasa a ser faltante calculada** (`responsable_inactivo` / `responsable_no_comprador`) hasta reasignar o revertir. Por qué: mismo criterio sin cascada que el árbol y M3; evita que una combinación quede silenciosamente asignada a alguien que no entra o que ya no compra, y que editar un usuario borre datos de otra pantalla. Descartado: limpiar las asignaciones al desactivar o al cambiar el rol (irreversible y con efecto oculto desde `/usuarios`); bloquear la desactivación (frena retirar a alguien).
4. **Faltante = combinación vigente sin responsable válido**, con una sola función `motivoFaltante`. Vigente = género y mundo activos. Cuentan también las combinaciones sin líneas (los mundos existen en todos los géneros). Por qué: el hito es "toda combinación vigente tiene responsable" y el producto cartesiano es la definición de combinación del árbol. Descartado: contar solo combinaciones con líneas (haría cambiar el hito cada vez que se carga una línea nueva).
5. **`/usuarios` avisa y no bloquea.** Desactivar, eliminar o quitar el rol de comprador a alguien con combinaciones pide `confirm` con el conteo; la API nunca lo rechaza. Descartado: `409` por responsabilidades (contradice la respuesta de Javier).
6. **No hay importador de responsables.** 40 celdas se asignan en minutos con la acción en bloque; resolver usuarios por nombre desde un archivo cuesta más que el trabajo que ahorra. Se ofrece solo la descarga del CSV de la matriz.
7. **`activo` queda en la tabla por convención y sin uso; quitar un responsable borra la fila.** Descartado: desactivar la asignación (un estado más sin dueño) y omitir la columna (rompe la convención de PLAN §4; se retira si Javier prefiere).
8. **Numeración M1b, migración `0006_responsables.sql`, versión `0.7.0 · M1b`.** Entra antes de M5, que no depende de él, para que Javier pueda repartir las combinaciones mientras valida los hitos de M2–M4. Descartado: renombrar la Fase 2 (M5 sigue siendo la carga de histórico) o llamarlo M5.

## Cambios respecto a la especificación

Lo construido sigue la ficha en lo esencial (tabla, contratos de API, pantallas, reglas). Estas son las diferencias, todas menores. La ficha de arriba ya está corregida a lo construido; esta lista dice qué cambió y por qué.

**Reglas y funciones puras**

- **`filtrarCeldas` descarta las celdas no vigentes en todos los filtros**, no solo en "Faltantes". Así los conteos de los chips (Todas, Faltantes, Mis combinaciones) coinciden siempre con `resumen`, que cuenta solo vigentes. El filtro `sin_responsable` es `responsable === null`.
- **El CSV suma el estado `Inactiva`** para las celdas de un género o mundo inactivo (la ficha solo tenía cuatro estados).
- **`avisoResponsabilidades(accion, n, nombre)`** recibe el nombre y trae la pregunta final ("¿Desactivar?", "¿Eliminar definitivamente?", "¿Cambiar el rol?"); concuerda singular y plural ("1 combinación … seguirá asignada").
- **`motivoRechazoAsignacion({ perfilId, perfil, genero, mundo })`** devuelve también el `404` de género o mundo inexistente (la ficha lo dejaba al handler). El criterio del perfil se separó en `motivoRechazoPerfil`.
- **Funciones extra** que la ficha no nombraba: `motivoRechazoPerfil`, `clasificarCombinaciones`, `deduplicarCombinaciones`, `aplicarPlanAsignacion`, `contarPorPerfil`, `leerNodosDePareja` y `resumirCeldas`. Salieron de partir los handlers en piezas puras que se pueden probar sin Supabase.
- **Un rol desconocido cuenta como "ya no es comprador"**, y **una fila con `activo = false` cuenta como sin responsable** (y al quitar se borra). Es la lectura prudente: nada queda "asignado" por un dato raro.
- **`planBloque` (pantalla) y `planificarBloque` (reglas) coexisten**, con un test que comprueba que dan lo mismo. La ficha preveía una sola.
- **`use-responsables.ts` vive en `src/lib/responsables/`** y no junto al panel, porque lo usan el panel de la matriz y el árbol.

**Pantallas**

- **El árbol avisa si falla la segunda llamada.** Pide `GET /api/responsables?incluir_inactivos=1` y, si falla, sigue funcionando con un `Alert` informativo y un enlace Reintentar (la ficha decía que seguía sin avisar). El subtítulo de Líneas mantiene el conteo de líneas.
- **El `confirm` de eliminar antepone "Esta acción no se puede deshacer."** al aviso de responsabilidades, para no perder la advertencia que ya tenía.
- **`?responsable=<uuid>`** solo se acepta si es UUID y tiene prioridad sobre "Mis combinaciones".
- **El `Select` de responsable** muestra "Responsable elegido (sin combinaciones vigentes)" cuando el filtro apunta a alguien que no tiene combinaciones vigentes (si no, la lista no lo traería y el filtro quedaría en blanco).
- **El panel de bloque vuelve a "Elige un comprador…"** si el comprador elegido deja de estar activo mientras está abierto.
- **`api.put`** es nuevo en `src/lib/api-client.ts` (el cliente solo tenía `get`, `post`, `patch` y `delete`).

## Limitaciones conocidas

- **Sin transacción ni control de concurrencia.** Con `solo_faltantes`, entre la lectura y la escritura otro planner puede asignar una de las celdas y quedar pisado. La ventana es de milisegundos y el efecto es que gana la última escritura; repetir la petición completa lo que faltó.
- **Privacidad del correo (aceptable según la ficha).** Al comprador le llegan `rol` y `activo` de cada responsable y, si un admin o planner fue comprador y conserva asignaciones, también su correo. Si se quiere mínimo privilegio, basta con devolver `{ id, nombre, email }`.
- **Botón "Agregar línea" del árbol.** Puede partirse en dos líneas cuando el subtítulo de la columna Líneas es largo (nombre de género y mundo más el responsable).
- **Handlers sin tests de integración.** Las reglas puras tienen 125 pruebas nuevas, pero `GET/PUT /api/responsables`, `POST /api/responsables/asignar` y los cambios de `/api/usuarios` solo se probaron contra un stub (QA).
- **No probado contra Supabase real:** el `upsert` con `onConflict: "genero_id,mundo_id"` y `.select()`, Auth real (`deleteUser` y la cascada completa), datos reales de compradores y un Excel real con acentos en el CSV. QA recomienda repetir el hito del bloque una vez contra la base real.

## Preguntas abiertas para Javier

**Siguen sin responder. El módulo está construido con las respuestas por defecto de esta tabla y esos valores rigen hasta que Javier diga otra cosa.**

| # | Pregunta | Respuesta por defecto en vigor |
|---|---|---|
| 1 | Titular y suplente | Solo titular |
| 2 | Admin o planner como responsables | Solo comprador |
| 3 | Combinaciones sin líneas | Cuentan como faltantes; la celda dice "sin líneas" |
| 4 | Qué ve el comprador al entrar | Abre en "Mis combinaciones" si tiene alguna |
| 5 | Hasta dónde llega el filtro | Solo la matriz; el árbol muestra el responsable, sin filtro |
| 6 | Cuando el comprador deja de serlo | Conserva la asignación y la marca como faltante |
| 7 | Nombre en el menú | "Responsables género-mundo" |

1. **Titular y suplente.** La ficha propone **un solo responsable (titular)** por combinación. ¿Necesitas también un suplente (para vacaciones o ausencias)? Si sí, se agrega como columna `suplente_perfil_id` en la misma fila y una segunda fila de selectores en la matriz. *Por defecto: solo titular.*
2. **¿Pueden ser responsables el admin o el planner?** Con tu respuesta ("los compradores"), el selector solo lista compradores activos y la API rechaza a los demás. ¿Alguna vez tú o alguien de planeamiento se asigna una combinación (por ejemplo, mientras no haya comprador)? Abrirlo es cambiar una regla y la lista de candidatos. *Por defecto: solo comprador.*
3. **Combinaciones sin líneas.** BEBE × FORMAL, por ejemplo, puede no tener ninguna línea hoy. La ficha las cuenta como faltantes igual (los mundos existen en todos los géneros, y así el hito es siempre "las 40 tienen responsable"). ¿Prefieres que solo cuenten las combinaciones con alguna línea vigente? *Por defecto: cuentan todas; la pantalla muestra "sin líneas" en esas celdas.*
4. **Qué ve el comprador al entrar.** Para el comprador con combinaciones asignadas, la matriz abre filtrada en "Mis combinaciones" (con "Todas" a un clic). ¿Está bien, o prefieres que abra siempre en "Todas"? *Por defecto: abre en "Mis combinaciones".*
5. **Hasta dónde llega el filtro.** M1b entrega el filtro en la matriz y el responsable visible en el árbol. ¿Quieres además un interruptor "Solo mis combinaciones" dentro del árbol (que oculte los géneros y mundos que no le tocan) ya en este módulo, o lo dejamos para cuando existan las vistas de proyección (M7), el documento de compras (M8) y la herramienta del comprador (M9)? *Por defecto: se deja para esas vistas; M1b solo muestra el responsable en el árbol.*
6. **Cuando el comprador deja de serlo.** Si un comprador pasa a planner o admin, sus combinaciones **se conservan** y aparecen en Faltantes como "ya no es comprador" hasta que las reasignes o le devuelvas el rol; en cambio al **eliminarlo** quedan sin asignar (tu respuesta). ¿Te parece bien esa diferencia, o prefieres que cambiar el rol también las libere? *Por defecto: conservar y marcar como faltante.*
7. **Nombre en el menú.** "Responsables género-mundo" (completo) o "Responsables" (corto). *Por defecto: completo.*

# 07c · Crecimientos del año siguiente por género × mundo (matriz con «Calcular promedio»)

> Estado: **lista para construir (2026-10-16).** La ficha se especificó y se revisó el mismo día en tres pasos: las respuestas de Javier a las preguntas abiertas (§8), la revisión independiente y las decisiones finales de Javier (§9). Es una mejora de M7 sobre `0.10.7`. Versión prevista **`0.10.8 · M7`**, commits `M7:`, migración **`0023_proyeccion_crecimientos.sql`** (la siguiente libre). **Se construye junto con [07d](07d-venta-esperada-tienda-nueva.md):** las dos cambian el método (`VERSION_METODO = 4`) y la `0023` lleva también el `comment on column` de 07d. Depende de [07-proyeccion-anual](07-proyeccion-anual.md) (§5 paso 2, §6.3 a 6.5, §7) y de [07b](07b-apertura-en-la-linea.md) (B2 en el acto, bloqueo optimista). No usa datos reales: las cifras son sintéticas. **Estado de la base según la revisión independiente:** hay una sola proyección en trabajo, calculada con el método 3; tiene 0 filas con `crecimiento_pct` propio; no hay ninguna proyección cerrada ni ninguna tienda con `fecha_cierre`. Los géneros y mundos citados salen del seed de `0001`. La pantalla lee los mundos siempre de `mundos`, y las dos columnas se resuelven por nombre en `generos` (§2.5).

## 1. Objetivo

Javier quiere fijar el crecimiento del año siguiente (`Y+1`, mismas tiendas) por **género × mundo (GM)** sin ir fila por fila. Con 07c llena una matriz con los mundos como filas y **Hombre** y **Mujer** como columnas, más un crecimiento **Resto** para todo lo demás. El % que escribe es la **variación bruta de 2027 contra el vigente de 2026 de las mismas tiendas de 2027, sin corregir por el Niño**. Debe llenar **todas** las celdas. El botón **Calcular promedio** le muestra el ponderado de lo que escribió, el resultado con las filas fijadas a mano, la comparación con su objetivo global y el puente al Total 2027. Para guardar hay un solo botón, **Guardar y recalcular**. Si una fila fijada a mano choca con el cambio, el sistema pregunta **Pisar / Conservar / Cancelar**, y nada se pisa sin su respuesta.

## 2. Modelo de datos (`0023`)

### 2.1 Tabla `proyeccion_crecimientos` (una fila por celda GM con %)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `proyeccion_id` | `uuid not null → proyecciones on delete cascade` | La matriz pertenece a una proyección. Una copia (`copiar_de`) empieza con las celdas del origen (§3). |
| `genero_id` | `uuid not null → generos on delete restrict` | Solo HOMBRE o MUJER. Lo valida la API (§3) y no la base, porque un `check` por nombre no cabe. |
| `mundo_id` | `uuid not null → mundos on delete restrict` | |
| `pct` | `numeric(6,2) not null` | `check (pct between -95 and 500)`. Es el mismo rango de `proyeccion_fila_anios.crecimiento_pct` y del esquema `crecimiento` de `esquemas.ts`. **Significado: variación bruta `Y+1 ÷ Y − 1`** (§2.4). |
| `nota` | `text null` | `check (char_length(nota) <= 300)` |
| `perfil_id` (`→ perfiles on delete set null`), `usuario_nombre` | | Quién la fijó por última vez; `updated_at` dice cuándo (decisión 33: queda registrado quién decidió). |
| `activo` | `boolean not null default true` | Va por convención y no tiene uso. Quitar una celda borra la fila, como en `responsables_genero_mundo`. |
| `created_at`, `updated_at` | | trigger `tg_set_updated_at` |

Restricciones:
- único `(proyeccion_id, genero_id, mundo_id)`;
- índices `(genero_id)` y `(mundo_id)`, para que el `restrict` de las FK no recorra la tabla;
- RLS activo sin políticas;
- `revoke all … from public, anon, authenticated` y `grant … to service_role`;
- `comment on`.

La migración no lleva función. Es idempotente (`if not exists`, `create or replace trigger`) y no usa `DROP`, `UPDATE` ni backfill.

**Por qué una tabla y no `jsonb` en `parametros`:** cada celda lleva quién la fijó y cuándo, y las FK impiden borrar un género o un mundo en uso. **Por qué la tabla no guarda el GM de cada fila:** el GM se resuelve al leer, desde el nodo (`genero_mundo_linea.genero_id/mundo_id`). El `mundo_id` de un nodo se puede editar (`editarNodoSchema`) y la regla debe seguir al árbol vigente (§2.4, huella).

### 2.2 El Resto **es** `parametros.crecimiento_pct_defecto` (sin fila en la tabla)

Con un Resto, el crecimiento por defecto ya no se aplica a nada. Tener dos campos para lo mismo mostraría dos cifras en dos pantallas, así que la cadena queda **fila > celda GM > Resto (= `crecimiento_pct_defecto`)**. El Resto también es bruto (§2.4).

- **Dónde se edita:** desde la matriz. Se guarda en `parametros` junto con `crecimiento_resto_meta: { nota, por_nombre, at }` y con `crecimiento_objetivo_pct: number | null` (§2.6). Las dos claves son opcionales y no piden migración.
- **Al crear:** en «Nueva proyección» el campo se llama «Crecimiento bruto del año siguiente (Resto)».
- **Al editar:** el campo se sustituye por un enlace a la pestaña.
- **Un solo camino de escritura:** un `PATCH` de parámetros que traiga un `crecimiento_pct_defecto` distinto del vigente responde `400 usar_crecimientos`. Así hay una sola pregunta de choque.
- **Escrituras concurrentes:** el `PUT` de la matriz y el `PATCH` de parámetros escriben el `jsonb` `parametros` completo. Las dos escrituras pasan a ser condicionales (§3) para que una no borre lo que acaba de escribir la otra.

### 2.3 Dos columnas nuevas en `proyeccion_fila_anios` (solo filas base de `Y+1`)

| Columna | Tipo | Qué es |
|---|---|---|
| `base_siguiente` | `integer null`, `check (>= 0)` | **`B`**: el vigente de `Y` de las tiendas de `M(Y+1)`, **sin normalizar**. Se calcula como el vigente de la fila base de `Y`, más las nuevas de `Y` que pasan a `M(Y+1)`, menos las salientes (B2). Incluye la tienda que abrió a fines de 2025 y excluye las que cierran en 2027 (decisión 1 de Javier). Es el denominador del % bruto y el peso de la fila en «Calcular promedio». |
| `base_normalizada` | `numeric(14,2) null`, `check (>= 0)` | **`B'' = B' × Σ_m c_m φ_{Y+1,m}`**: lo que la fila vendería en `Y+1` con 0 % si `Y` hubiera sido un año normal. Solo es una referencia: alimenta el «rebote del Niño» (§5.3) y el «% sobre la base normalizada» de Por línea. **No entra en la propuesta.** |

Las dos son `null` sin base o sin curva. Las escriben `calcular` y **cada** `recalcularBaseSiguiente` en el acto: al decidir una fila de `Y`, al decidir una tienda que pasa a `M(Y+1)` y en `propagarTienda`.

**Por qué hacen falta:** calcular `B` necesita `historico.salientes`, el `jsonb` pesado que la matriz no lee. Con las columnas, la matriz suma sin releer nada.

### 2.4 Qué significa un % y cómo lo lee el cálculo (método 4)

**Regla única para el % de una fila, de una celda o del Resto:**

`P_{Y+1} = round(B × (1 + g/100))`, repartido con `c'_m ∝ c_m × φ_{Y+1,m}`.

El % es la variación bruta del año siguiente frente al vigente del año en curso de las mismas tiendas de `Y+1`. **No se divide por `φ_Y`** (decisión 1).

- **Hoy (método 3)** se calcula `P = round(B' × (1 + g) × Σ c φ_{Y+1})`. Con una base de invierno 2026 a `φ = 0,66`, un 20 % daba +82 % bruto en esa fila.
- **Si `Y+1` está marcado como atípico en M6** (`objetivo_atipico`), `φ_{Y+1}` solo da forma al reparto mensual y no mueve el nivel: el % bruto ya debe incluirlo. El aviso se mantiene con texto nuevo: «2027 marcado como Niño: tu % es bruto y debe incluirlo; el reparto usa el factor».
- **Asimetría con 07d (intencional):** en las aperturas de `Y+1`, `φ_{Y+1}` **sí** mueve el nivel, porque `A_f = Σ c r φ_{Z_0}` y la venta esperada `V` es de un año normal en régimen (07d §4). En mismas tiendas y en `maduro_propio`, en cambio, el % que escribe Javier ya es bruto.

**Cómo se aplica dentro de un GM (decisión 2): todas las filas crecen el mismo % bruto.** Cada fila que sigue la celda crece exactamente `g` sobre su `B`, y el GM crece exactamente `g` ponderado por `B`. Las dos lecturas del encargo dan la misma cifra fila a fila: `B''_f (1 + g_fila) = (1+g) B_f`. Se implementa «`g` sobre el vigente sin normalizar», porque no divide por `B''`, que puede ser 0 o nulo.

**Variante descartada:** convertir a nivel del GM (`g_eq = (1+g)·Σ B ÷ Σ B'' − 1` sobre `B''`) reparte el rebote del Niño dentro del GM. Ejemplo: en HOMBRE · CASUAL, con ABRIGO de invierno (`B = 1 000`, `B'' = 1 515`) y POLO de verano (`B = B'' = 1 000`), un 20 % daría ABRIGO +44,6 % y POLO **−4,6 %**.

**Precedencia.** La resuelve la función pura `crecimientoEfectivo({ pctFila, genero_id, mundo_id }, celdas, resto) → { pct, origen: "fila" | "celda" | "resto" }` en `crecimientos.ts`.
- Reemplaza las lambdas `crecimientoDe` de `calculo.ts:318` y `servicio-base.ts:202`.
- El nodo da el paso de `claveBase` (`gml|eq|am`) al GM: `e.nodos` en el cálculo y `catalogo.nodos` en vivo.
- `decision.ts:264` ya da prioridad a `anterior.crecimiento_pct`.

| Caso | Qué pasa |
|---|---|
| **Fila con % propio** (`crecimiento_pct` escrito en Por línea) | Manda sobre la celda y el Resto, y **también es bruto**: `P = round(B × (1 + g_f))`. Hoy no hay ninguna fila así en la base, de modo que el cambio de significado no mueve ninguna cifra existente (una línea en el CHANGELOG lo deja escrito). |
| **Fila con total de `Y+1` decidido** | Conserva su total. Su propuesta se rehace con el % efectivo y la fila queda con `propuesta_cambio` si se movió. En el Modal de choque se puede «pisar» de forma opcional (§3). |
| **Celda GM** | Se aplica a las filas base de su GM sin % propio. |
| **Resto** (`crecimiento_pct_defecto`) | Se aplica a las filas base cuyo GM no es una celda de la matriz: los géneros que no son Hombre ni Mujer, y un GM de Hombre o Mujer que aún no tiene celda. Cada fila crece `g_resto` bruto. |
| **Tienda `maduro_propio` de `Y+1`** (abrió en `Y` y sigue nueva) | Toma el % efectivo de su GML-AM, como hoy (`calculo.ts:535`, `decision.ts:493`), y también en bruto, anualizando con el Niño de `Y` repartido en los 12 meses: `A^b_{t,f} = (vigente_{t,f,Y} ÷ Σ_{m∈Y} c_m r_m φ_{Y,m}) × Σ_{m=1..12} c_m φ_{Y,m}` y `P = round(A^b × (1+g) × Σ_{m∈Y+1} c_m r_m)`, repartido con `c r φ_{Y+1}`. **Por qué no `vigente ÷ Σ c r`:** esa fórmula anualiza solo con los meses abiertos, y si esos meses tienen Niño pesan de más (por ejemplo, abrió en mayo con invierno a `φ = 0,66`, y su `A` saldría deprimido entero). Hoy no hay ninguna tienda en este caso (haría falta una apertura en 2026). |
| No aplica | Aperturas de `Y+1` (van por venta esperada, 07d), cierres y el año en curso. |

**Recalcular conserva todo lo del planner.** `previas.filas` sigue trayendo `crecimiento_pct`, y `persistencia.ts` (`payloadAnioCalculo`) nunca lo sobrescribe. Un total decidido no cambia. Se rehacen `propuesto`, `meses`, `base_siguiente`, `base_normalizada` y la explicación, que nombra el origen y el carácter bruto. Ejemplo: «2027 → base 2026 de las 10 tiendas de 2027 = 19 424 (vigente 17 504 + T10 1 920) × 1,20 (crecimiento bruto de HOMBRE · URBANO, sin corregir por el Niño) = 23 309, repartido con DENIM HO v2». En una fila con Niño se añade: «2026 fue Niño en invierno: a 0 % sobre la base normalizada serían 5 000; tu 20 % bruto equivale a −20,8 % sobre esa base».

**Explicación de tienda `maduro_propio`.** `calculo.ts:649` y `servicio-edicion.ts:500` pasan hoy `crecimiento_pct_defecto`. Pasan a pasar el % efectivo. Si todas las filas de la tienda comparten el mismo, se muestra ese con su origen. Si no, se muestra el ponderado `Σ w_f g_f ÷ Σ w_f`, con `w_f = A^b_f × Σ_{Y+1} c r`, y el texto dice «× (1 + crecimiento de sus combinaciones, ponderado +x %)».

**Guardar siempre recalcula (decisión 5).** El único botón es **Guardar y recalcular**, y el `PUT` encadena el recálculo en el servidor (§3). Para detectar lo que quede sin aplicar:
- **Huella:** `resumen.huella_crecimientos` es el sha de las celdas y el Resto, ordenados (el objetivo global no entra porque no cambia ninguna cifra).
- **Mapa de GM:** `resumen.gm_gml: Record<gml_id, "genero_id|mundo_id">` guarda el GM de los nodos con filas base. Lo escribe el cálculo y `aProyeccionApi` lo quita, igual que `niveles_gml`.
- **Motivo:** `motivosDesactualizada` suma `crecimientos_cambiados` cuando la huella difiere de la de las celdas actuales, o cuando `gm_gml` difiere del catálogo vigente. Para lo segundo compara el mapa con `catalogo.nodos`, sin leer filas base en cada lectura.
- **Cuándo aparece:** solo si falló el recálculo encadenado o si después un nodo cambió de mundo en el árbol.
- **Cierre:** `crecimientos_cambiados` **no se puede saltar con `forzar`**, como `version_metodo`. Recalcular lo limpia.
- **B2:** las recalculaciones en el acto usan siempre la matriz guardada.

### 2.5 Columnas Hombre y Mujer

`GENEROS_MATRIZ = ["HOMBRE", "MUJER"]` (constante en `tipos.ts`) se resuelve contra `upper(trim(generos.nombre))` de los géneros activos, en ese orden. Si uno no se encuentra, su columna no aparece y un `Alert` lo dice: «No se encontró el género MUJER en el catálogo: sus filas siguen el Resto». Las filas de los demás géneros siguen siempre el Resto.

**Mundos (filas de la matriz):** son los mundos activos con al menos una fila base activa de `Y+1` de Hombre o de Mujer, o con una celda guardada, en el `orden` del catálogo. Una celda «sin filas» (ese género no tiene filas en ese mundo) se ve como «—», no se edita y no es obligatoria.

### 2.6 Objetivo global (opcional, informativo)

`parametros.crecimiento_objetivo_pct` (`-95..500` o `null`) es la meta de crecimiento bruto de mismas tiendas que Javier tenga en mente, si la tiene. **No se aplica a ninguna fila.** Solo se compara en «Calcular promedio» (§5.2). Si está vacío, no se muestra la comparación.

## 3. Contratos de API (todas con `requirePlanner`; el comprador recibe `403`)

Ubicación del código:
- **Rutas:** `src/app/api/proyeccion/proyecciones/[id]/crecimientos/`.
- **Lógica pura:** `crecimientos.ts`, sin I/O e importable también desde el cliente para «Calcular promedio».
- **Datos:** `consultas.ts`.
- **Servicio:** `servicio-crecimientos.ts`.
- **Helpers:** `ok`, `error`, `leerCuerpo`, `idDeRuta`, `errorConCodigo` y `traducirErrorDb`.

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` · errores |
|---|---|---|---|
| `…/crecimientos` | GET | — | `RespuestaCrecimientosApi` · `404` |
| `…/crecimientos` | PUT | `guardarSchema` | `RespuestaCrecimientosApi & ResultadoGuardarApi` · `400` (zod, `celda_repetida`, `genero_no_permitido`, `mundo_inactivo`, `celdas_incompletas`, `resolucion_invalida`) · `404` · `409 cerrada` / `archivada` / `calculo_en_curso` · `409 conflicto` (la `huella` cambió desde que se leyó, o la proyección cambió entre la lectura y el candado) · **`409 filas_manuales`** · `500 guardado_parcial` |

No hay `POST …/crecimientos/calcular`. «Calcular promedio» pondera lo escrito con los agregados del `GET` y lo hace en el navegador (`calcularPromedio`, §5.2).

```ts
const celda = z.object({ genero_id: uuid, mundo_id: uuid, pct: crecimiento, nota: z.string().trim().max(300).nullable().optional() });
export const guardarSchema = z.object({
  huella: z.string().min(1),                                    // la del GET: bloqueo optimista (patrón 07b §12)
  resto: z.object({ pct: crecimiento, nota: z.string().trim().max(300).nullable().optional() }),
  objetivo_pct: crecimiento.nullable(),                          // §2.6; null = sin objetivo
  celdas: z.array(celda).max(200),                              // reemplazo completo: lo que no viene se borra
  resolucion: z.enum(["pisar", "conservar"]).optional(),        // undefined = aún no respondió → 409 si hay choque
  incluir_decididas: z.boolean().optional(),                    // solo con resolucion = "pisar"
  huella_choque: z.string().min(1).optional(),                  // la del 409 filas_manuales; obligatoria si viene resolucion
});
// resolucion sin huella_choque, o incluir_decididas sin resolucion = "pisar" → 400 resolucion_invalida.

type AgregadoApi = {                       // sobre las filas base activas de Y+1 del conjunto (celda o Resto)
  filas: number; filas_sin_base: number;
  base: number;                            // Σ B: unidades de 2026 de las mismas tiendas de 2027 = peso del conjunto
  base_libre: number;                      // Σ B de las filas que siguen la celda (sin % propio y sin total 2027 decidido)
  pct_propio: { filas: number; base: number; siguiente: number };   // siguiente = Σ round(B × (1 + g_fila))
  decididas: { filas: number; base: number; siguiente: number };    // siguiente = Σ decidido 2027 (una decidida con % propio cuenta aquí)
  base_normalizada: number;                // Σ B'' de las filas con base
  rebote_nino_pct: number | null;          // Σ B'' ÷ Σ B − 1; null si ninguna fila tiene meses del Niño (o Σ B = 0)
  siguiente_vigente: number;               // Σ vigente 2027 hoy
};
type CeldaApi = { genero_id: string; mundo_id: string; pct: number | null /* null = sin definir: sigue al Resto */; nota: string | null;
  actualizado_por: string | null; actualizado_at: string | null; sin_filas: boolean; agregado: AgregadoApi };
type RespuestaCrecimientosApi = {
  editable: boolean; anio_en_curso: number; anio_siguiente: number; huella: string;
  al_dia: boolean;                                               // false = crecimientos_cambiados o version_metodo
  generos: { id: string; nombre: string }[];                     // HOMBRE, MUJER (los que se encontraron)
  mundos: { id: string; nombre: string; orden: number | null }[];
  celdas: CeldaApi[];                                            // una por género × mundo mostrado, también las vacías y las «sin filas»
  resto: { pct: number; nota: string | null; actualizado_por: string | null; actualizado_at: string | null; agregado: AgregadoApi;
    por_genero: { genero: string; base: number }[] };            // desglose informativo de la base del Resto
  objetivo_pct: number | null;
  puente: {                                                      // para el puente al Total 2027 (§5.2), de resumen.totales
    total_en_curso: number;                                      // Total Y de la Matriz (todas las columnas)
    nuevas_anterior: number; aperturas: number;                  // vigentes de Y+1 de esos subbloques
    cierres: number;                                             // vigente de Y+1 de las tiendas que cierran en Y+1: SUMA (su 2026 ya salió de B)
    cierres_sin_decidir: number;                                 // tiendas que cierran en Y+1 sin total decidido (hoy proponen 0)
  };
};
type ResultadoGuardarApi = {
  pisadas: { fila_id: string; pct_anterior: number | null; decidido_anterior: number | null }[];
  conservadas: number;
  revertidas: string[];          // fila_id pisados que, al releer tras el recálculo, volvieron a tener % propio o total (decisión concurrente)
  recalculo: { ok: true } | { ok: false; codigo: string; mensaje: string };
};
```

**`409 filas_manuales`** devuelve:

`{ codigo, mensaje, huella_choque, pct_propio: { total, filas: { fila_id, genero, mundo, linea, equivalencia, agrupacion_marca, pct_fila, pct_nuevo }[] (≤ 200) }, decididas: { total, filas: { fila_id, genero, mundo, linea, equivalencia, agrupacion_marca, decidido, propuesta_nueva_estimada }[] (≤ 200) } }`

- `huella_choque = sha` de la lista ordenada `(fila_id, crecimiento_pct, decidido)` de **todas** las filas en choque de las dos listas (no solo de las 200 mostradas).
- `propuesta_nueva_estimada = round(B × (1 + g_nuevo))`.
- Cuándo se emite:
  - el `PUT` llega sin `resolucion` y alguna de las dos listas no está vacía;
  - el `PUT` llega con `resolucion`, pero la `huella_choque` recalculada en el servidor no coincide con la enviada (mensaje: «Las filas en choque cambiaron mientras decidías: revisa la lista nueva»).
- En los dos casos no se escribe nada. Así un «Pisar» nunca toca una fila que Javier no vio.
- Si al llegar el `PUT` con `resolucion` ya no hay choques, se ignora la `resolucion` y se guarda.

**`400 celdas_incompletas`** devuelve `{ faltan: { genero, mundo }[] }`: todo par HOMBRE/MUJER × mundo activo con filas base activas de `Y+1` debe venir en `celdas`. **`400 genero_no_permitido`**: una celda de un género que no es HOMBRE ni MUJER.

**Orden del `PUT` (el recálculo va encadenado en el servidor):**

1. `proyeccionOr404`, en trabajo y sin cálculo vivo.
2. Comprobar la `huella` (`409 conflicto`).
3. Validar celdas, géneros y mundos, y que la matriz esté completa.
4. Calcular los choques (`filasEnChoque`, regla 4) y la `huella_choque`. Si hay choques: sin `resolucion` → `409 filas_manuales`; con `resolucion` y otra `huella_choque` → `409 filas_manuales` con la lista nueva.
5. **Tomar el candado de cálculo** (`calculando_desde`) de forma condicional al `calculando_desde` y al `updated_at` leídos en el paso 1. Si no se toma, `409 conflicto` o `409 calculo_en_curso`. Desde aquí, todo `decidirFila`, `decidirTienda` o `PATCH` que compruebe `sigueEditable` o `sinCalculoDesde` recibe `409 calculo_en_curso`.
6. Escribir, en tandas de 500:
   - con `pisar`: `crecimiento_pct = null` en las filas de la lista `pct_propio`;
   - con `incluir_decididas`: además `decidido`, `origen`, `propuesta_al_decidir`, `nota` y `decidido_*` a `null` en las de `decididas`;
   - `upsert`/`delete` de las celdas (las que no cambian conservan su quién y cuándo);
   - Resto, `crecimiento_resto_meta` y `crecimiento_objetivo_pct` en `parametros`, con un `UPDATE` condicional al candado tomado.
7. **Recalcular** con `ejecutarCalculo` sobre la proyección releída, con el candado ya tomado. Es una opción nueva, `candado: valorTomado`, que no vuelve a llamar a `tomarCalculo`. El recálculo rehace `propuesto`, `meses`, `base_siguiente`, `base_normalizada` y la explicación de **todas** las filas con la matriz nueva, también las pisadas. Escribe `resumen.huella_crecimientos` y `resumen.gm_gml`.
8. Releer `crecimiento_pct` y `decidido` de los `fila_id` pisados. Los que volvieron a tener valor van a `revertidas`.
9. Responder con el `GET` recalculado.

**Fallos.**
- **Fallo en el paso 6:** se libera el candado y se responde `500 guardado_parcial`. El `PUT` es idempotente: reintentar lo deja todo consistente, porque las filas ya pisadas no vuelven a chocar.
- **Fallo en el paso 7:** `ejecutarCalculo` libera el candado y el `PUT` responde `200` con `recalculo.ok = false`. La matriz queda guardada y la proyección queda con `crecimientos_cambiados`, que no se puede forzar. Las filas pisadas quedan sin decisión y con su reparto viejo hasta pulsar Recalcular, y el aviso de la pantalla lo dice.
- **Sin choques ni resolución:** los pasos 6 a 9 son los mismos sin las escrituras de filas.

**Por qué se encadena el recálculo y no se rehace cada fila pisada con `aplicarDecision` (bloqueante 1 de la revisión).**
- **El problema:** poner `decidido` o `crecimiento_pct` a `null` sin rehacer el registro dejaría `meses` con el reparto del total viejo y `propuesto` con la matriz anterior.
- **Por qué no `aplicarDecision`:** rehacer cada fila exigiría cargar, por cada GML-AM pisada, su grupo con columnas completas (`grupoDe`) y su `contextoModelo`, y aun así haría falta el recálculo completo para aplicar la matriz a las demás filas.
- **Por qué el recálculo basta:** con un solo botón «Guardar y recalcular», el recálculo completo (menos de 30 s) ya rehace cada fila pisada exactamente como «Volver a la propuesta» con la matriz nueva. Es un solo camino de código, ya probado, y `payloadAnioCalculo` reescribe `meses` y `propuesto` sin tocar las decisiones.
- **Lo que gana el diseño:** la petición dura lo que un cálculo, como hoy el botón Recalcular, y desaparece casi todo el estado «guardado sin recalcular».

**Decisión concurrente con «Pisar» (menor 11).**
- **Ventana cerrada por el candado:** el candado del paso 5 cierra la ventana para todo `decidirFila` que llegue después.
- **Ventana residual:** queda una de milisegundos, la misma que ya existe hoy entre decidir y calcular. Es un `decidirFila` que pasó `sigueEditable` justo antes del candado. Su `payloadAnioDecision` reescribe `crecimiento_pct`, `decidido` y `meses` con los valores que leyó.
- **Regla:** gana la última escritura. El paso 8 detecta la reversión en `revertidas`, y la pantalla dice «N filas se editaron mientras guardabas: conservan su % o su total; revísalas y recalcula». No se añade más mecanismo.

**Lectura (`GET`).** Lee las filas base activas de `Y+1` con columnas ligeras (`decidido`, `crecimiento_pct`, `base_siguiente`, `base_normalizada`), la tabla, el catálogo de nodos, géneros y mundos, `resumen.totales` (para el puente) y las tiendas de la proyección con `bloque = cierres` de `Y+1` (para `cierres_sin_decidir`). No lee `historico`, `factores_mes` ni venta.

**Cambios en contratos existentes:**
- **Filas de `Y+1`.** `AnioFilaApi` de las filas base de `Y+1` gana:
  - `crecimiento_efectivo: { pct, origen: "fila" | "celda" | "resto", celda: string | null /* "HOMBRE · FORMAL" */ }`;
  - `base_siguiente` y `base_normalizada`;
  - `pct_bruto: number | null` (vigente ÷ `B` − 1);
  - `pct_sobre_normalizada: number | null` (vigente ÷ `B''` − 1).

  `totales_por_anio` de `/lineas` gana `base_siguiente` (Σ de la línea).
- **Matriz.** `NodoMatrizApi.siguiente` gana `base_siguiente: number` y `crec_mismas_pct: number | null` (Σ vigente de `Y+1` de las filas base ÷ Σ `B` − 1). `hojasMatriz` añade esa columna al Excel.
- **Parámetros.** `editarSchema`: un `crecimiento_pct_defecto` distinto del vigente sobre una proyección existente da `400 usar_crecimientos`. `editarProyeccion` escribe con `cambiarEstadoProyeccion(…, { sinCalculoDesde, updatedAt: p.updated_at })`, una opción nueva que añade `.eq("updated_at", …)`. Si no escribe, responde `409 estado_cambiado`, con el mensaje que ya existe.
- **Copia.** `crearSchema` sigue aceptando `crecimiento_pct_defecto`, que es el Resto inicial. **Con `copiar_de` manda el cuerpo:** como hoy, `parametros` sale del cuerpo y no del origen (`servicio.ts:310-311`), así que el Resto es el que manda el formulario. La copia trae del origen las **celdas** (con su nota y su quién) y `crecimiento_objetivo_pct`. El formulario «Nueva proyección», al elegir «copiar de», precarga el Resto con el del origen.
- **Desactualizada.** `MotivoDesactualizada` gana `crecimientos_cambiados`. `ResumenProyeccion` gana `huella_crecimientos?: string` y `gm_gml?: Record<string, string>`, que no se entrega por la API.
- **Cierre.** `motivoRechazoCerrar` recibe `crecimientosCambiados` y lo trata como `metodoViejo`: `409 crecimientos_cambiados` («Cambiaron los crecimientos por género · mundo o el mundo de un nodo: recalcula antes de cerrar (no se puede forzar).»), también con `forzar`.
- **Por línea.** Las props `crecimientoDefecto` de `detalle-fila.tsx:204,219` y `linea-tab.tsx:246` (que llegan a `tabla-filas.tsx` y `bloque-decision.tsx`) pasan a recibir el `crecimiento_efectivo` de la fila.

## 4. Pantallas

La pestaña nueva **Crecimientos** va en `/planificacion/proyeccion` (`?pestana=crecimientos`), entre «Tiendas nuevas y cierres» y «Por línea». Va ahí porque las tiendas que pasan a mismas tiendas mueven `B` (B2) y la matriz alimenta las propuestas que luego se deciden por línea. La ven y la editan **admin y planner**. El comprador no ve la pestaña y la ruta le responde `403`. Kit: `Card`, `DataTable`, `Field`, `Badge`, `Alert`, `Modal`, `EmptyState`; formato `es-PE`.

| Zona | Contenido y acciones |
|---|---|
| Cabecera | Texto: «Crecimiento **bruto** 2027 frente a 2026 de las mismas tiendas de 2027 (10 tiendas). No se corrige por el Niño: si 2026 fue Niño en un mundo, inclúyelo en tu %.» Debajo, el campo **Objetivo global (%)**, opcional. Si `al_dia = false`: `Alert` «Los crecimientos guardados no están aplicados (falló el recálculo o un nodo cambió de mundo)» con el botón Recalcular, o «Calculada con el método anterior: recalcula». |
| Matriz | Filas = mundos; columnas = **HOMBRE**, **MUJER**. Cada celda lleva el campo `%` (obligatorio), una nota (`n`) y, debajo y en pequeño, «base 17 800 u · hoy 2027: 19 485 u». Si la celda tiene filas con meses del Niño, se añade «rebote del Niño +9,6 %», con el título «Solo por volver a un año normal, este GM crecería +9,6 % bruto. Es referencia: no se aplica». Badges: «2 con % propio», «1 decidida», «extremo» si \|pct\| > 50, «sin base». Una celda sin filas muestra «—». Una celda vacía lleva borde de alerta y «sigue al Resto (5 %)». |
| Resto | Bloque aparte: campo `%`, nota, «base 20 000 u» y el desglose por género («JOVENCITOS 8 200 · NIÑOS 6 100 · …»). |
| Calcular promedio | Mientras falte alguna celda, el botón está deshabilitado con el mensaje «Faltan 3 celdas: HOMBRE · FORMAL, MUJER · RI y MUJER · URBANO. Escribe un % en cada una (puede ser el mismo del Resto).» Al pulsarlo se abre el panel de resultado (§5.2): una tabla por celda (base, % escrito, 2027 resultante, % resultante), más el Resto y el total con sus tres cifras, y el puente al Total 2027. Si se edita una celda después de calcular, el panel se marca «cambiaste celdas: vuelve a calcular». No hay «Usar» ni sugerencia por celda. |
| Pie | **Guardar y recalcular** (único botón de guardado) y **Descartar cambios**. Guardar está deshabilitado, con el mismo mensaje, si falta alguna celda. Mientras corre, muestra «Guardando y recalculando… (hasta 30 s)» con todo bloqueado. Los errores de zod aparecen junto al campo (rango −95 a 500). Resultados posibles: <ul><li>éxito: «Guardado y recalculado» y la lista de pisadas con su % o total anterior;</li><li>`recalculo.ok = false`: `Alert` «Se guardó la matriz pero no se pudo recalcular: {mensaje}» con el botón Recalcular;</li><li>`revertidas` no vacío: el aviso de §3.</li></ul> |
| Modal del choque (`409 filas_manuales`) | Título: «Este cambio choca con filas fijadas a mano.» <ul><li>**Sección 1:** «12 filas tienen un % propio», con una tabla (género · mundo · línea · agrupación · % de la fila → % nuevo).</li><li>**Sección 2**, si la hay: «5 filas tienen el total de 2027 decidido: conservan su cifra y mostrarán "propuesta cambió"», con una tabla (decidido → propuesta nueva estimada) y la casilla **«Pisar también estas 5 decisiones (vuelven a la propuesta nueva)»**, desmarcada por defecto.</li></ul> Botones: <ul><li>**Pisar:** las filas con % propio pasan a seguir la matriz, y las decididas solo si se marcó la casilla.</li><li>**Conservar:** no cambia ninguna fila.</li><li>**Cancelar:** no se guarda nada.</li></ul> Pisar y Conservar reenvían el `PUT` con la `huella_choque` del 409. Si el servidor responde otro `409 filas_manuales`, el Modal se reabre con la lista nueva y el aviso «la lista cambió». La pantalla nunca manda `resolucion` sin que Javier pulse. |
| Por línea | **Campo «Crec.»** de cada fila de 2027: marcador con el % efectivo y su origen («20 % · HOMBRE · URBANO» o «5 % · Resto»). Ayuda: «% bruto 2027 ÷ 2026 de esta fila, sin corregir por el Niño. Vacío = el de la combinación (20 %).» Sustituye a «Vacío = el de la proyección» de `bloque-decision.tsx:225`. <br>**Detalle:** «Crecimiento bruto efectivo +20,0 % (HOMBRE · URBANO) · base 2026 de las mismas tiendas de 2027: 19 424 u». En filas con Niño se añade «sobre la base normalizada por el Niño equivale a −20,8 %». Una fila decidida muestra «tu decisión: +11,2 % bruto». <br>**Pie de la tabla:** la fila «Línea (mismas)» de 2027 lleva «+20,0 % bruto sobre la base 2026 de las mismas tiendas de 2027 (60 002 ÷ 50 001)». <br>La frase de `bloque-decision.tsx:177` deja de decir «normalizada por el Niño». |
| Matriz (Parte 2) | Columna nueva **Crec. mismas tiendas** junto a «Var.». Su título explica: «Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres). Crec. mismas tiendas = 2027 de las mismas tiendas ÷ su 2026: es lo que escribes en Crecimientos». |
| Tiendas nuevas y cierres | La tarjeta de una tienda `maduro_propio` explica su crecimiento con el % efectivo (§2.4), no con el de la proyección. |
| Cerrada o archivada | Todo se ve y nada se edita (`editable = false`). «Calcular promedio» sigue disponible. |

**Respuesta a la queja «pongo 20 % y veo 25 %».** Con el método 4 desaparece la diferencia por el Niño: un GM al 20 % sin filas fijadas muestra +20,0 % en la celda, en «Crec. mismas tiendas» de la Matriz y en el pie de cada línea. Lo que queda entre el % escrito y la «Var.» de la Matriz son las tiendas que entran y salen y las filas fijadas. El panel de «Calcular promedio» y el título de la columna lo muestran como un puente con cifras.

## 5. Reglas de negocio

### 5.1 Reglas para vitest (en `tests/proyeccion.crecimientos*.test.ts`; puras salvo donde dice «ruta»)

1. **`crecimientoEfectivo`:** fila con % propio > celda GM > Resto. Una celda de otro GM, una celda borrada o una celda de un género fuera de `GENEROS_MATRIZ` no se aplican.
2. **Método 4 en `proponerSiguiente`:** `P = round(B × (1 + g))` para cualquier `φ_Y`. Prueba de propiedad: con `φ_Y ∈ {0,5, 0,66, 1,24}`, constante o por meses, `P` no depende de `φ_Y`. Con `φ_{Y+1} ≠ 1`, `P` no cambia y solo cambia el reparto (`c'_m ∝ c_m φ_{Y+1,m}`). `base_normalizada = B' × Σ c φ_{Y+1}` y se guarda. Sin base → `null` y `sin_base`.
3. **Ejemplo de §5.3:** HOMBRE · FORMAL al 20 % da 3 960 en TERNO, 4 725 en PANTALÓN y 10 800 en CAMISA (decidida). La celda resulta en 19 485 (+9,5 %), con un rebote del Niño de +9,6 % y TERNO a −20,8 % sobre la base normalizada.
4. **`filasEnChoque(guardada, borrador, filas)` y `huellaChoque`.**
   - % propio: filas base de `Y+1` con `crecimiento_pct` cuyo % no manual (celda o Resto) cambia con este guardado y cuyo % propio ≠ el nuevo efectivo.
   - Decididas: filas con `decidido` de `Y+1` cuyo % efectivo cambia.
   - Cambiar el Resto solo afecta a los GM sin celda.
   - `huellaChoque` no depende del orden y cambia si cambia el `crecimiento_pct` o el `decidido` de una fila de la lista, o si entra o sale una fila.
5. **Ruta `PUT`, resolución.**
   - Con choque y sin `resolucion`: `409 filas_manuales` con `huella_choque`, sin escribir nada.
   - `resolucion` sin `huella_choque`, o `incluir_decididas` sin `pisar`: `400 resolucion_invalida`.
   - `huella_choque` distinta de la recalculada (otra fila pasó a chocar): `409 filas_manuales` con la lista nueva, sin escribir nada.
   - Con `conservar`: no toca ninguna fila.
   - Con `pisar`: `crecimiento_pct = null` **solo** en las filas con % propio en choque.
   - Con `pisar` + `incluir_decididas`: además, las decididas en choque vuelven a la propuesta, y `pisadas` trae `pct_anterior` y `decidido_anterior`.
   - Sin `incluir_decididas`, un total decidido nunca cambia.
6. **Ruta `PUT`, rehechura de las pisadas (bloqueante 1).** Tras «Pisar» con la casilla, una fila decidida en choque queda con `decidido = null`, `vigente = propuesto = round(B × (1 + g_celda nuevo))`, `Σ meses = vigente` y la explicación con la celda nueva. Una fila con % propio pisada queda con `propuesto = round(B × (1 + g_celda))` y su `Σ meses` igual a ese valor.
7. **Ruta `PUT`, validación.**
   - Matriz incompleta → `400 celdas_incompletas` con la lista. Una celda «sin filas» no es obligatoria.
   - Celda repetida → `400`; género que no es HOMBRE ni MUJER → `400 genero_no_permitido`; mundo inactivo → `400`.
   - `cerrada`, `archivada` o `calculo_en_curso` → `409`; `huella` distinta → `409 conflicto`.
   - En ningún caso se escribe nada.
   - Comprador: `403` en `GET` y `PUT`; sin sesión: `401`.
8. **Ruta `PUT`, recálculo.**
   - Un `PUT` correcto deja la proyección sin `crecimientos_cambiados` y con `recalculo.ok = true`.
   - Si el recálculo encadenado falla (simulado), la respuesta es `200` con `recalculo.ok = false`, las celdas quedan guardadas y `motivosDesactualizada` incluye `crecimientos_cambiados`.
   - Mientras el `PUT` tiene el candado, `decidirFila` y el `PATCH` de parámetros responden `409 calculo_en_curso`.
   - Una fila pisada que vuelve a tener `crecimiento_pct` al releer aparece en `revertidas`.
9. **`calcularPromedio(celdas, resto, objetivo, puente)`:** el ejemplo de §5.2 da 11,7 % ponderado escrito, 10,2 % resultante, 132 185 u, faltan 2 215 u frente al 12 % y el Total 2027 es 133 099. Con un cierre de `Y+1` de 300 u, el Total 2027 **suma** 300. Con una celda vacía devuelve `null` con la lista de las que faltan. Sin objetivo no hay comparación.
10. **`calcularProyeccion` con celdas.**
    - Una fila sin decidir de una celda al 12 % da `propuesto = round(B × 1,12)`.
    - Una fila con % propio del 5 % da `round(B × 1,05)`.
    - Una fila de JOVENCITOS sigue el Resto.
    - Una apertura de `Y+1` no cambia por la matriz.
    - Una tienda `maduro_propio` de `Y+1` usa el % de su GML-AM sobre `A^b = (vigente ÷ Σ_{m∈Y} c r φ_Y) × Σ_12 c φ_Y`. Con `φ_Y = 1` coincide con `vigente ÷ Σ c r`. Con Niño `φ = 0,66` en los meses abiertos, `A^b` es mayor que `vigente ÷ Σ c r` y menor que el `A` normalizado.
    - La explicación de esa tienda cita el % efectivo, no `crecimiento_pct_defecto`.
11. **Columnas nuevas:** `base_siguiente` y `base_normalizada` las escriben `calcular` y todo `recalcularBaseSiguiente`; `|propuesto − B × (1+g)| ≤ 0,5`.
12. **Huella y desactualización.**
    - `huellaCrecimientos` no depende del orden.
    - Un cambio de celda o del Resto sin recalcular, o un nodo con filas base que cambia de mundo (`gm_gml` ≠ catálogo), producen `crecimientos_cambiados`. El objetivo global no.
    - Recalcular lo limpia.
    - `motivoRechazoCerrar` con `crecimientos_cambiados` y `forzar = true` → `409 crecimientos_cambiados`.
13. **B2 en el acto:** tras guardar la matriz, usa el % nuevo de la celda y reescribe `base_siguiente`.
14. **Copia y parámetros.**
    - `copiar_de` copia las celdas y el objetivo. El Resto es el `crecimiento_pct_defecto` del cuerpo.
    - Un `PATCH` de parámetros con un `crecimiento_pct_defecto` distinto del vigente, sobre una proyección existente, responde `400 usar_crecimientos`.
    - Un `PATCH` cuyo `updated_at` cambió entre la lectura y la escritura responde `409 estado_cambiado` sin escribir.
15. **Versión del método:** `VERSION_METODO = 4`. Una proyección en trabajo con `version_metodo < 4` está «desactualizada: método nuevo», y `cerrar?forzar=1` la rechaza con `409 version_metodo` (0.10.3). Una cerrada no cambia.

### 5.2 «Calcular promedio» (`calcularPromedio`, puro, en el navegador)

Requiere la matriz completa. Sea `B_c` el `agregado.base` de cada celda `c` y del Resto `R`.

- **Ponderado de lo que escribiste:** `ḡ = Σ_c B_c g_c ÷ Σ_c B_c`, sobre las celdas y el Resto.
- **2027 resultante por celda:** `S_c = pct_propio.siguiente + decididas.siguiente + base_libre × (1 + g_c)`, y `%_c = S_c ÷ B_c − 1`. Es una estimación: puede diferir del recálculo en ±0,5 u por fila por el redondeo, y la pantalla lo dice.
- **Resultado total (mismas tiendas 2027):** `Σ S ÷ Σ B − 1`, con las unidades. Difiere de `ḡ` solo por las filas con % propio y las decididas, y el panel lo dice: «3 filas con % propio y 5 decididas llevan el total de +11,7 % a +10,2 %».
- **Objetivo:** «Objetivo +12,0 % → con lo escrito te faltan 0,3 pp; con el resultado, 1,8 pp ≈ 2 215 u».
- **Puente al Total 2027 de la Matriz** (`total = mismas + nuevas_anterior + aperturas + cierres`, `matriz.ts`, regla 28): base 2026 de las mismas tiendas de 2027 → × crecimiento resultante → 2027 mismas tiendas → **+** nuevas del año anterior → **+** aperturas de 2027 → **+** cierres de 2027 → Total 2027, comparado con el Total 2026 de la Matriz para dar la «Var.».
  - **Por qué los cierres suman:** una tienda que cierra en 2027 aporta su venta parcial de 2027, y su 2026 ya salió de `B`.
  - **Cierres sin decidir:** hoy un cierre del año siguiente propone 0 (`cierres-tienda.ts`, `cierre_no_proyectado`). Si `cierres_sin_decidir > 0`, el puente muestra «cierres: 0 u (1 tienda sin decidir)».

*Ejemplo (sintético).*
- **Celdas:** HOMBRE · FORMAL 20 % (base 17 800, la de §5.3), HOMBRE · URBANO 10 % (50 000, todas libres), MUJER · CASUAL 15 % (30 000) y MUJER · FORMAL 0 % (2 200). HOMBRE · CASUAL y MUJER · URBANO no tienen filas, así que no son obligatorias. Resto 5 % (20 000). `Σ B = 120 000`.
- **Ponderado escrito:** `ḡ = (17 800·20 + 50 000·10 + 30 000·15 + 2 200·0 + 20 000·5) ÷ 120 000 = 1 406 000 ÷ 120 000 =` **11,7 %**.
- **Resultantes:** 19 485 + 55 000 + 34 500 + 2 200 + 21 000 = **132 185 u → +10,2 %**.
- **Objetivo:** al 12 % serían 134 400 u, así que faltan **2 215 u**.
- **Puente:** con nuevas del año anterior = 0, aperturas de 2027 = 914 u y sin cierres, el Total 2027 es 132 185 + 914 = **133 099 u**.

### 5.3 Ejemplo de una celda y del rebote del Niño (HOMBRE · FORMAL, tres filas, celda al 20 %)

| Fila | `B` (2026, mismas tiendas de 2027) | `B''` | Estado | 2027 |
|---|---|---|---|---|
| (A) CAMISA × RECONOCIDO, toda temporada | 10 000 | 10 000 | total decidido 10 800 | 10 800 (+8,0 % bruto) |
| (B) TERNO × PREMIUM, invierno, Niño 2026 `φ = 0,66` | 3 300 | 3 300 ÷ 0,66 = 5 000 | sigue la celda | round(3 300 × 1,20) = **3 960** (+20,0 % bruto; −20,8 % sobre `B''`) |
| (C) PANTALÓN × VALOR, vigente 4 000 + T10 que pasa 500 | 4 500 | 4 500 | % propio 5 % | round(4 500 × 1,05) = **4 725** |

- **Celda:** `base = 17 800`, `base_libre = 3 300`, resultado 19 485 → **+9,5 %**.
- **Rebote del Niño:** `19 500 ÷ 17 800 − 1 = +9,6 %`. Solo por volver a un año normal, el GM crecería +9,6 % bruto.
- **Método 3:** la misma celda al 20 % habría dado TERNO 6 000 (+81,8 % bruto).

### 5.4 Casos borde

| Caso | Comportamiento |
|---|---|
| GM de Hombre/Mujer sin filas (o que se quedó sin filas tras mover un nodo) | La celda guardada se conserva con «sin filas», no se aplica a nada y no es obligatoria. El mundo solo aparece si tiene filas o una celda. |
| GM de Hombre/Mujer nuevo tras recalcular (un mundo ganó filas) | La celda aparece vacía con «sigue al Resto». Hasta que se escriba, ese GM sigue el Resto, y no se puede volver a guardar sin llenarla. |
| GM con filas pero sin base (todas sin curva o sin base de `Y`) | `agregado.base = 0` y badge «sin base». El % es obligatorio igual (se aplicará cuando haya base) y pesa 0 en el promedio. |
| Toda la matriz con `Σ B = 0` | «Calcular promedio» muestra «sin base: recalcula la proyección». |
| `g` negativo o extremo | Se acepta de −95 a 500 (el mismo `check`). Fuera de ±50 aparece el badge «extremo», que avisa y no bloquea (decisión 33). |
| Proyección cerrada o archivada | Solo lectura. La matriz que usó se conserva en la tabla. |
| Proyección nueva sin `copiar_de` | No tiene celdas: todos los GM siguen el Resto hasta que Javier llene la matriz y pulse Guardar y recalcular. |
| Tiendas nuevas | La nueva de `Y` que pasa a `M(Y+1)` entra por `B`. La `maduro_propio` de `Y+1` sigue la celda, en bruto, con `A^b` (§2.4). La apertura de `Y+1` no la sigue. |
| Cierre de `Y+1` | Su 2026 sale de `B` y su 2027 suma en el Total (hoy 0 sin decidir). El puente lo muestra. |
| Nodo que cambia de mundo (o línea movida a otro nodo) | El GM se resuelve con el árbol vigente. `gm_gml` ≠ catálogo produce `crecimientos_cambiados`, que pide recalcular y no se puede forzar. Si el mundo nuevo no tenía celda, la celda aparece vacía. |
| Nodo GMLE | Cada fila por equivalencia pesa con su `B`; las de un mismo nodo comparten GM. |
| Recálculo encadenado fallido | La matriz queda guardada, `al_dia = false` y aparece el `Alert` con Recalcular. Los agregados usan las propuestas guardadas. El cierre queda bloqueado hasta recalcular. |
| Decisión concurrente durante Guardar y recalcular | Después del candado: `409 calculo_en_curso`. En la ventana residual gana la última escritura y la fila aparece en `revertidas` (§3). |
| `PATCH` de parámetros concurrente con el `PUT` | El `PATCH` durante el candado recibe `409 calculo_en_curso`. Uno que leyó antes y escribe después recibe `409 estado_cambiado` (condición por `updated_at`). Ninguno borra lo del otro. |
| Proyección de antes de `0.10.8` (sin `base_siguiente`) | `agregado.base = 0` en todas las celdas, «Calcular promedio» deshabilitado con «recalcula: método nuevo» y la cabecera con «método nuevo». Guardar y recalcular la pone al día. |
| Fila de cola larga para revisión | `B` sale de la demanda corregida de `Y`, como hoy, y el % bruto se aplica sobre ella. |

## 6. Criterios de aceptación (hito de Javier)

1. La pestaña Crecimientos muestra la matriz con los mundos reales de la base, las columnas HOMBRE y MUJER, y el Resto con el % de la proyección y su desglose por género. El comprador no la ve.
2. Con una celda vacía, «Calcular promedio» y «Guardar y recalcular» están deshabilitados y el mensaje enumera las celdas que faltan. No existe un botón «Guardar» suelto.
3. [ESCRIBE] Llenar todas las celdas, escribir un objetivo global y pulsar **Calcular promedio**. Deben aparecer:
   - el ponderado de lo escrito;
   - el resultado con las filas fijadas;
   - la comparación con el objetivo en pp y unidades;
   - el puente al Total 2027, con los cierres sumando y «0 sin decidir» si aplica.

   Comprobar a mano una celda y el total con §5.2.
4. [ESCRIBE] **Guardar y recalcular** con un GM al 20 % sin filas fijadas. Comprobar:
   - en una sola acción, de menos de 30 s, su «Crec. mismas tiendas» en la Matriz y el pie de una de sus líneas muestran +20,0 %;
   - en una línea de invierno con Niño, la explicación dice «bruto, sin corregir por el Niño» y el detalle muestra el % sobre la base normalizada.
5. [ESCRIBE] Escribir un % en una fila de Por línea y decidir otra fila del mismo GM. Luego cambiar la celda y pulsar Guardar y recalcular: aparece el Modal con las dos secciones. Repetir con:
   - **Conservar:** nada cambia;
   - **Pisar** sin la casilla: la fila con % propio sigue la celda y la decidida conserva su total;
   - **Pisar** con la casilla: la decidida vuelve a la propuesta nueva y su reparto en Mensual suma esa propuesta;
   - **Cancelar:** no se guarda nada.
6. Recalcular la proyección del método 3 (la única en trabajo): la cabecera dice «método nuevo» antes y nada después, y no se pierde ninguna decisión.
7. Cambiar el mundo de un nodo con filas en el Árbol: la proyección pide recalcular por crecimientos, y «Cerrar de todos modos» se rechaza hasta recalcular.
8. En una proyección cerrada todo se ve y nada se edita. Pasan `lint`, `tsc`, `vitest` y `build`, y `APP_VERSION = "0.10.8 · M7"`.

## 7. Fuera de alcance

- columnas de otros géneros en la matriz (van al Resto por decisión de Javier);
- crecimientos por línea o por agrupación de marca dentro de la matriz;
- crecimiento del año en curso o de las aperturas;
- repartir el rebote del Niño dentro de un GM (§2.4, variante descartada);
- deshacer un «Pisar» (la respuesta y el aviso listan el % y el total anteriores para reescribirlos);
- sugerencias de % por celda o por tendencia histórica;
- historial de versiones de la matriz;
- guardar sin recalcular;
- un aviso de cabecera para filas con % propio y Niño (hoy no hay ninguna fila con % propio: lo cubre una línea en el CHANGELOG).

**Propuestas para `docs/DECISIONES.md` (2026-10-16; las registra el `documentador`):**
1. **El % de crecimiento del año siguiente es bruto.** Es `Y+1 ÷ Y` de las mismas tiendas de `Y+1`: incluye la tienda que abrió a fines de `Y−1`, excluye las que cierran en `Y+1` y no corrige por el Niño. Vale en la celda GM, en el Resto **y en la fila**. `P = round(B × (1 + g))`, y `φ_{Y+1}` solo da forma al reparto.
   - Ajusta la decisión del 2026-10-15 «el año siguiente es la base normalizada por el crecimiento del planner»: la normalización por el Niño se mantiene en el cierre del año en curso y queda como referencia en el año siguiente.
   - Descartado: el % sobre la base normalizada.
2. **Dentro de un GM todas las filas crecen el mismo % bruto.** Descartado: repartir el rebote del Niño dentro del GM.
3. **La matriz tiene solo Hombre y Mujer por mundo, más el Resto, y se llena entera.** El Resto es `crecimiento_pct_defecto` y se edita solo desde la matriz.
4. **«Calcular promedio» pondera lo escrito por las unidades base**, lo compara con un objetivo global opcional y muestra el resultado con las filas fijadas y el puente al Total. Descartado: la sugerencia por celda con «Usar».
5. **Guardar siempre recalcula** (un solo botón, recálculo encadenado en el servidor). `crecimientos_cambiados` no se puede forzar al cerrar.
6. **El Modal de choque incluye las filas con total decidido**, que solo se pisan si Javier marca la casilla. Un «Pisar» exige la `huella_choque` de la lista que vio.

## 8. Cambios tras las respuestas de Javier (2026-10-16)

| Pregunta | Respuesta de Javier | Qué cambió en la ficha |
|---|---|---|
| 1. Significado del % | «Variación bruta 2027 ÷ 2026», sin corregir por el Niño | Método 4: `P = round(B × (1+g))` para la celda, el Resto **y el % propio de la fila**. Hay `base_siguiente` (`B`) y `base_normalizada` (`B''`, solo como referencia). La Matriz gana «Crec. mismas tiendas». |
| 2. Qué hace «Calcular» | «Que me dé un ponderado de todos los crecimientos que yo voy a escribir; yo tengo que llenar todos los cuadrados» | Se quitan la sugerencia por celda, «Usar», la vista previa y `POST …/calcular`. Entra «Calcular promedio» en el navegador, con el objetivo global opcional. La matriz completa pasa a ser obligatoria. Por celda solo queda el «rebote del Niño» como referencia. |
| 3. Géneros | Solo Hombre y Mujer, más el Resto; los mundos son las filas | Columnas fijas `GENEROS_MATRIZ`; `400 genero_no_permitido`; el Resto con su desglose. |
| 4. Precedencia | Modal «Pisar / Conservar / Cancelar»; nada se pisa sin respuesta | Modal con una sección de filas decididas y su casilla desmarcada. |

En ese paso se mantenían «Guardar» y «Guardar y recalcular». La §9 deja solo el segundo.

## 9. Cambios tras la revisión independiente y las decisiones finales de Javier (2026-10-16)

**Decisiones finales de Javier que afectan a esta ficha:**
1. El «2026» es la base `B` de las mismas tiendas de 2027, sin corregir por el Niño.
2. Todas las filas de un GM crecen el mismo % bruto.
3. Solo existe «Guardar y recalcular».
4. Géneros fijos, matriz completa obligatoria, «Calcular promedio» sin «Usar», y Modal Pisar / Conservar / Cancelar.

Con eso se cierran las dos preguntas abiertas anteriores.

| Hallazgo | Qué cambió |
|---|---|
| **B1 (bloqueante):** poner a `null` `decidido`, `origen` y `crecimiento_pct` dejaba `meses` y `propuesto` viejos | El `PUT` encadena siempre el recálculo en el servidor, con el candado tomado antes de escribir. La fila pisada queda como «Volver a la propuesta» con la matriz nueva. Justificación en §3; regla 6. |
| **I2:** el segundo `PUT` podía pisar filas no vistas | `huella_choque` en el `409` y obligatoria con `resolucion`. Si no coincide, otro `409` con la lista nueva (regla 5). |
| **I3:** `crecimientos_cambiados` se podía saltar con `forzar` | No se puede forzar (`409 crecimientos_cambiados`). Sin «Guardar» suelto, solo aparece si falló el recálculo o un nodo cambió de mundo. Se simplificaron §2.4, §4 y §5.4. |
| **I4:** signo de los cierres en el puente | Los cierres **suman** (`matriz.ts`, regla 28), con «cierres: 0 sin decidir» (`cierres-tienda.ts` propone 0 en `Y+1`). El `GET` trae `puente` desde `resumen.totales`. |
| **m7:** `A^b` de `maduro_propio` | `A^b = (vigente ÷ Σ_{m∈Y} c r φ_Y) × Σ_12 c φ_Y`. Se documenta la asimetría con 07d (`φ_{Y+1}` solo da forma aquí y mueve el nivel en las aperturas). |
| **m10:** explicaciones y Por línea con `crecimiento_pct_defecto` | `calculo.ts:649` y `servicio-edicion.ts:500` pasan el % efectivo. `detalle-fila.tsx:204,219` y `linea-tab.tsx:246` pasan `crecimiento_efectivo`. |
| **m11:** escrituras concurrentes de `parametros` y decisión concurrente con «Pisar» | El `PUT` escribe bajo un candado condicional por `updated_at`. El `PATCH` pasa a ser condicional por `updated_at` (`409 estado_cambiado`). Con `decidirFila` concurrente gana la última escritura y aparece en `revertidas`. |
| **m12:** `copiar_de` frente a `crearSchema` | Manda el cuerpo para el Resto, como hoy con todo `parametros`. Se copian las celdas y el objetivo. |
| **m13:** la huella leía filas base | `resumen.gm_gml` se guarda al calcular y se compara con el catálogo. |
| **Alcance** (0 filas con % propio) | Se quitan `pct_propio_con_nino`, su aviso de cabecera, la antigua regla 14 y el antiguo criterio 6 (queda una línea en el CHANGELOG). El `GET` no lee `factores_mes`. |

**Se mantienen:** la tabla `proyeccion_crecimientos`, la migración `0023`, las rutas con `requirePlanner`, la huella y el bloqueo optimista, el Resto = `crecimiento_pct_defecto` con `400 usar_crecimientos`, la pestaña Crecimientos, `base_siguiente` / `base_normalizada`, el rebote del Niño como referencia y `VERSION_METODO = 4`. Los menores de 07d (m6, m8, m9, m14, m15, I5) están en su ficha.

## Preguntas abiertas (solo Javier)

Ninguna.

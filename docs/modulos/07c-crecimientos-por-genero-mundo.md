# 07c · Crecimientos del año siguiente por género × mundo (matriz con «Calcular promedio»)

> Estado: **especificada el 2026-10-16 y revisada el mismo día con las respuestas de Javier a sus tres preguntas abiertas (ver «Cambios tras las respuestas de Javier» al final). Sin construir.** Mejora de M7 sobre `0.10.7`. Versión prevista **`0.10.8 · M7`**, commits `M7:`, migración **`0023_proyeccion_crecimientos.sql`** (la siguiente libre; 07b no usó ninguna). Se recomienda construirla junto con [07d](07d-venta-esperada-tienda-nueva.md): las dos cambian el método (`VERSION_METODO = 4`) y la `0023` lleva también el `comment on column` de 07d. Depende de [07-proyeccion-anual](07-proyeccion-anual.md) (§5 paso 2, §6.3 a 6.5, §7) y de [07b](07b-apertura-en-la-linea.md) (B2 en el acto, bloqueo optimista). Sin datos reales: las cifras son sintéticas. **No se consultó la base Vector2**: esta sesión no tiene herramienta de Supabase ni `.env.local`. Los géneros y mundos citados salen del seed de `0001` (géneros HOMBRE, MUJER, JOVENCITOS, JOVENCITAS, NIÑOS, NIÑAS, BEBE, OTROS; mundos CASUAL, URBANO, DEPORTIVO, FORMAL, RI). La pantalla lee los mundos siempre de `mundos`; las dos columnas se resuelven por nombre en `generos` (§2.5).

## 1. Objetivo

Javier quiere fijar el crecimiento del año siguiente (`Y+1`, mismas tiendas) por **género × mundo (GM)** sin ir fila por fila. Con 07c llena una matriz (filas = mundos; columnas = **Hombre** y **Mujer**) más un crecimiento **Resto** para todo lo demás. El % que escribe es la **variación bruta de 2027 frente a 2026, sin corregir por el Niño** (respuesta 1). Debe llenar **todas** las celdas. Con el botón **Calcular promedio** ve el crecimiento total, ponderado por las unidades base de cada celda, y lo compara con su objetivo global y con el total de 2027 que resulta. Al guardar, si alguna fila fijada a mano choca con el cambio, el sistema le pregunta **Pisar / Conservar / Cancelar**, y nada se pisa sin su respuesta.

## 2. Modelo de datos (`0023`)

### 2.1 Tabla `proyeccion_crecimientos` (una fila por celda GM con %)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `proyeccion_id` | `uuid not null → proyecciones on delete cascade` | La matriz pertenece a una proyección. Una copia (`copiar_de`) empieza con la suya. |
| `genero_id` | `uuid not null → generos on delete restrict` | Solo HOMBRE o MUJER. Lo valida la API (§3), no la base: un `check` por nombre no cabe. |
| `mundo_id` | `uuid not null → mundos on delete restrict` | |
| `pct` | `numeric(6,2) not null` | `check (pct between -95 and 500)`: el mismo rango que `proyeccion_fila_anios.crecimiento_pct` y que el esquema `crecimiento` de `esquemas.ts`. **Significado: variación bruta `Y+1 ÷ Y − 1`** (§2.4). |
| `nota` | `text null` | `check (char_length(nota) <= 300)` |
| `perfil_id` (`→ perfiles on delete set null`), `usuario_nombre` | | Quién la fijó por última vez; `updated_at` dice cuándo (decisión 33: queda registrado quién decidió). |
| `activo` | `boolean not null default true` | Por convención, sin uso. Quitar una celda borra la fila, como en `responsables_genero_mundo`. |
| `created_at`, `updated_at` | | trigger `tg_set_updated_at` |

Restricciones: único `(proyeccion_id, genero_id, mundo_id)`; índices `(genero_id)` y `(mundo_id)`, para que el `restrict` de las FK no recorra la tabla; RLS activo sin políticas; `revoke all … from public, anon, authenticated` y `grant … to service_role`; `comment on`. La migración no lleva función. Es idempotente (`if not exists`, `create or replace trigger`) y no usa `DROP`, `UPDATE` ni backfill.

**Por qué una tabla y no `jsonb` en `parametros`:** cada celda lleva quién y cuándo; las FK impiden borrar un género o un mundo en uso; el `PATCH` de parámetros ya tiene su propia semántica (`recalculo_pendiente`). **Por qué no guarda el GM de cada fila:** el GM se resuelve al leer, desde el nodo (`genero_mundo_linea.genero_id/mundo_id`). El `mundo_id` de un nodo se puede editar (`editarNodoSchema`) y la regla debe seguir al árbol vigente.

### 2.2 El Resto **es** `parametros.crecimiento_pct_defecto` (sin fila en la tabla)

Si hay un Resto, el crecimiento por defecto ya no se aplica a nada. Dos campos para lo mismo mostrarían dos cifras en dos pantallas, así que la cadena se reduce a **fila > celda GM > Resto (= `crecimiento_pct_defecto`)**. El Resto se edita desde la matriz y se guarda en `parametros` junto con `crecimiento_resto_meta: { nota, por_nombre, at }`. Ese `jsonb` también recibe `crecimiento_objetivo_pct: number | null` (§2.6). Las dos claves son opcionales y no piden migración. En «Nueva proyección» el campo se llama «Crecimiento bruto del año siguiente (Resto)». Al editar una proyección existente, ese campo se sustituye por un enlace a la pestaña. Un `PATCH` de parámetros que traiga `crecimiento_pct_defecto` responde `400 usar_crecimientos`: así hay un solo camino de escritura y una sola pregunta de choque. **El Resto también es bruto** (§2.4).

### 2.3 Dos columnas nuevas en `proyeccion_fila_anios` (solo filas base de `Y+1`)

| Columna | Tipo | Qué es |
|---|---|---|
| `base_siguiente` | `integer null`, `check (>= 0)` | **`B`**: el vigente de `Y` de las tiendas de `M(Y+1)`, **sin normalizar**. Es el vigente de la fila base de `Y`, más las nuevas de `Y` que pasan a `M(Y+1)`, menos las salientes (B2). Es el denominador del % bruto y el peso de la fila en «Calcular promedio». |
| `base_normalizada` | `numeric(14,2) null`, `check (>= 0)` | **`B'' = B' × Σ_m c_m φ_{Y+1,m}`**: lo que la fila vendería en `Y+1` con un 0 % si `Y` hubiera sido un año normal. Solo sirve de referencia: el «rebote del Niño» (§5.3) y el «% sobre la base normalizada» de Por línea. **Ya no entra en la propuesta.** |

Las dos son `null` sin base o sin curva. Las escriben `calcular` y **cada** `recalcularBaseSiguiente` en el acto: al decidir una fila de `Y`, al decidir una tienda que pasa a `M(Y+1)` y en `propagarTienda`. **Por qué hacen falta:** `B` necesita `historico.salientes`, el `jsonb` pesado que la matriz no lee. Con las columnas, la matriz suma sin releer nada. Sustituyen a la columna `base_comparable` de la primera versión de la ficha, que guardaba solo `B''`.

### 2.4 Qué significa un % y cómo lo lee el cálculo (método 4)

**Regla única, para el % de una fila, de una celda o del Resto:**

`P_{Y+1} = round(B × (1 + g/100))`, repartido con `c'_m ∝ c_m × φ_{Y+1,m}`.

El % es la variación bruta del año siguiente frente al vigente del año en curso de las mismas tiendas de `Y+1`. **No se divide por `φ_Y`**. Hoy (método 3) se hace `P = round(B' × (1 + g) × Σ c φ_{Y+1})`, y con una base de invierno 2026 a `φ = 0,66` un 20 % daba +82 % bruto en esa fila. En un GM o en la proyección completa, eso producía cifras como «puse 20 % y veo +25,8 %». Si `Y+1` está marcado como atípico en M6 (`objetivo_atipico`), `φ_{Y+1}` solo da forma al reparto mensual y no mueve el nivel: tu % bruto ya debe incluirlo. El aviso se mantiene y su texto cambia: «2027 marcado como Niño: tu % es bruto y debe incluirlo; el reparto usa el factor».

**Cómo se aplica en cada GM.** La propuesta pide un `g` para cada fila. Las dos variantes del encargo, «convertir el % bruto a un `g_fila` sobre la base normalizada» (`g_fila = (1+g)·B_f ÷ B''_f − 1`) y «aplicar `g` sobre el vigente sin normalizar», **dan la misma cifra fila a fila**: `B''_f (1 + g_fila) = (1+g) B_f`. Se implementa la segunda porque no divide por `B''` (que puede ser 0 o nulo). Cada fila que sigue la celda crece exactamente `g` bruto, de modo que el GM crece exactamente `g`, ponderado por `B`. **Variante descartada (pregunta 2):** convertir a nivel del GM, `g_eq = (1+g)·Σ B ÷ Σ B'' − 1` aplicado sobre `B''`. Esa variante reparte el rebote del Niño dentro del GM. Un ejemplo de su efecto: en HOMBRE · CASUAL con ABRIGO de invierno (`B = 1 000`, `B'' = 1 515`) y POLO de verano (`B = B'' = 1 000`), un 20 % daría ABRIGO +44,6 % y POLO **−4,6 %**. Eso es justo el «puse 20 y veo otra cosa» que Javier rechaza.

**Precedencia** (función pura `crecimientoEfectivo({ pctFila, genero_id, mundo_id }, celdas, resto) → { pct, origen: "fila" | "celda" | "resto" }` en `crecimientos.ts`). Reemplaza las lambdas `crecimientoDe` de `calculo.ts:318` y `servicio-base.ts:202`. El nodo da el paso de `claveBase` (`gml|eq|am`) al GM: `e.nodos` en el cálculo, `catalogo.nodos` en vivo. `decision.ts:264` ya da prioridad a `anterior.crecimiento_pct`.

| Caso | Qué pasa |
|---|---|
| **Fila con % propio** (`crecimiento_pct` escrito en Por línea) | Manda sobre la celda y el Resto, y **también pasa a ser bruto**: `P = round(B × (1 + g_f))`. Un solo significado del % en toda la proyección. Para las filas sin meses del Niño en `Y` ni en `Y+1` la cifra no cambia (`B' = B`, `Σ c φ = 1`). En las filas con Niño cambia: ver la pantalla de aviso en §4 y la propuesta para DECISIONES. |
| **Fila con total de `Y+1` decidido** | Conserva su total. Su propuesta se rehace con el % efectivo y queda con `propuesta_cambio` si se movió. En el Modal de choque se puede «pisar» de forma opcional (§3). |
| **Celda GM** | Para las filas base de su GM sin % propio. |
| **Resto** (`crecimiento_pct_defecto`) | Para las filas base cuyo GM no es una celda de la matriz: todos los géneros que no son Hombre ni Mujer, y un GM de Hombre o Mujer que aún no tiene celda (por ejemplo, un mundo que ganó filas tras recalcular). Cada fila crece `g_resto` bruto. |
| **Tienda `maduro_propio` de `Y+1`** (abrió en `Y` y sigue nueva) | Toma el % efectivo de su GML-AM, como hoy (`calculo.ts:535`, `decision.ts:493`), y también en bruto: `A^b_{t,f} = vigente_{t,f,Y} ÷ Σ_{m∈Y} c_m r_m` (sin `φ_Y`) y `P = round(A^b × (1+g) × Σ_{m∈Y+1} c_m r_m)`. Con los datos conocidos no hay ninguna tienda en este caso (requiere una apertura en 2026). |
| No aplica | Aperturas de `Y+1` (van por venta esperada, ver 07d), cierres, año en curso. |

**Recalcular conserva todo lo del planner.** `previas.filas` sigue trayendo `crecimiento_pct` y `persistencia.ts` nunca lo sobrescribe. Un total decidido no cambia. Se rehacen `propuesto`, `meses`, `base_siguiente`, `base_normalizada` y la explicación, que nombra el origen y el carácter bruto: «2027 → base 2026 de las 10 tiendas de 2027 = 19 424 (vigente 17 504 + T10 1 920) × 1,20 (crecimiento bruto de HOMBRE · URBANO, sin corregir por el Niño) = 23 309, repartido con DENIM HO v2». En una fila con Niño se añade: «2026 fue Niño en invierno: a 0 % sobre la base normalizada serían 5 000; tu 20 % bruto equivale a −20,8 % sobre esa base».

**Guardar no recalcula.** La proyección guarda en `resumen.huella_crecimientos` el sha de las celdas, el Resto y el par `gml → (genero_id, mundo_id)` de los nodos con filas base, todo ordenado (el objetivo global no entra: no cambia ninguna cifra). `motivosDesactualizada` suma `crecimientos_cambiados` («Cambiaste los crecimientos por género · mundo, o un nodo cambió de mundo: recalcula») cuando esa huella difiere de la actual. La pantalla ofrece **Guardar y recalcular** (primario: encadena el `POST …/calcular` existente, menos de 30 s) y **Guardar**. Las recalculaciones en el acto (B2) usan siempre la matriz vigente.

### 2.5 Columnas Hombre y Mujer

`GENEROS_MATRIZ = ["HOMBRE", "MUJER"]` (constante en `tipos.ts`) se resuelve contra `upper(trim(generos.nombre))` de los géneros activos, en ese orden. Si uno no se encuentra, su columna no aparece y un `Alert` lo dice («No se encontró el género MUJER en el catálogo: sus filas siguen el Resto»). Las filas de los demás géneros (JOVENCITOS, NIÑOS, BEBE, …) siguen siempre el Resto. **Mundos (filas de la matriz):** los mundos activos con al menos una fila base activa de `Y+1` de Hombre o de Mujer, o con una celda guardada, en el `orden` del catálogo. Una celda «sin filas» (ese género no tiene filas en ese mundo) se ve como «—», no se puede editar y no es obligatoria.

### 2.6 Objetivo global (opcional, informativo)

`parametros.crecimiento_objetivo_pct` (`-95..500` o `null`): la meta total de crecimiento bruto de mismas tiendas que Javier tiene en mente, si la tiene. **No se aplica a ninguna fila.** Solo se compara en «Calcular promedio» (§5.2). Vacío = no se muestra la comparación.

## 3. Contratos de API (todas con `requirePlanner`; el comprador recibe `403`)

Rutas en `src/app/api/proyeccion/proyecciones/[id]/crecimientos/`. La lógica pura va en `crecimientos.ts`, sin I/O, importable también desde el cliente para «Calcular promedio». El acceso a datos va en `consultas.ts` y el servicio en `servicio-crecimientos.ts`. Se usan `ok`, `error`, `leerCuerpo`, `idDeRuta`, `errorConCodigo` y `traducirErrorDb`.

| Ruta | Método | Cuerpo (zod) | Respuesta `{ data }` · errores |
|---|---|---|---|
| `…/crecimientos` | GET | — | `RespuestaCrecimientosApi` (abajo) · `404` |
| `…/crecimientos` | PUT | `guardarSchema` | `RespuestaCrecimientosApi & { pisadas: { fila_id, pct_anterior: number \| null, decidido_anterior: number \| null }[]; conservadas: number }` · `400` (zod, `celda_repetida`, `genero_no_permitido`, `mundo_inactivo`, **`celdas_incompletas`**, `resolucion_invalida`) · `404` · `409 cerrada` / `archivada` / `calculo_en_curso` · `409 conflicto` (la `huella` cambió desde que se leyó) · **`409 filas_manuales`** · `500 guardado_parcial` |

**Se quitó `POST …/crecimientos/calcular`.** «Calcular promedio» ya no propone nada por celda: pondera lo que Javier escribió. Con los agregados que trae el `GET`, eso es una cuenta pura y se hace en el navegador (`calcularPromedio`, §5.2).

```ts
const celda = z.object({ genero_id: uuid, mundo_id: uuid, pct: crecimiento, nota: z.string().trim().max(300).nullable().optional() });
export const guardarSchema = z.object({
  huella: z.string().min(1),                                    // la del GET: bloqueo optimista (patrón 07b §12)
  resto: z.object({ pct: crecimiento, nota: z.string().trim().max(300).nullable().optional() }),
  objetivo_pct: crecimiento.nullable(),                          // §2.6; null = sin objetivo
  celdas: z.array(celda).max(200),                              // reemplazo completo: lo que no viene se borra
  resolucion: z.enum(["pisar", "conservar"]).optional(),        // undefined = aún no respondió → 409 si hay choque
  incluir_decididas: z.boolean().optional(),                    // solo con resolucion = "pisar"; si no → 400 resolucion_invalida
});

type AgregadoApi = {                       // sobre las filas base activas de Y+1 del conjunto (celda o Resto)
  filas: number; filas_sin_base: number;
  base: number;                            // Σ B: unidades de 2026 de las mismas tiendas de 2027 = peso del conjunto
  base_libre: number;                      // Σ B de las filas que siguen la celda (sin % propio y sin total 2027 decidido)
  pct_propio: { filas: number; base: number; siguiente: number };   // siguiente = Σ round(B × (1 + g_fila))
  decididas: { filas: number; base: number; siguiente: number };    // siguiente = Σ decidido 2027 (una decidida con % propio cuenta aquí)
  base_normalizada: number;                // Σ B'' de las filas con base
  rebote_nino_pct: number | null;          // Σ B'' ÷ Σ B − 1; null si ninguna fila tiene meses del Niño (o Σ B = 0)
  siguiente_vigente: number;               // Σ vigente 2027 hoy (con la matriz guardada y recalculada)
};
type CeldaApi = { genero_id: string; mundo_id: string; pct: number | null /* null = sin definir: sigue al Resto */; nota: string | null;
  actualizado_por: string | null; actualizado_at: string | null; sin_filas: boolean; agregado: AgregadoApi };
type RespuestaCrecimientosApi = {
  editable: boolean; anio_en_curso: number; anio_siguiente: number; huella: string; al_dia: boolean /* false = crecimientos_cambiados o método anterior */;
  generos: { id: string; nombre: string }[];                     // HOMBRE, MUJER (los que se encontraron)
  mundos: { id: string; nombre: string; orden: number | null }[];
  celdas: CeldaApi[];                                            // una por género × mundo mostrado, también las vacías y las «sin filas»
  resto: { pct: number; nota: string | null; actualizado_por: string | null; actualizado_at: string | null; agregado: AgregadoApi;
    por_genero: { genero: string; base: number }[] };            // desglose informativo de la base del Resto
  objetivo_pct: number | null;
  tiendas_siguiente: { aperturas: number; nuevas_anterior: number; cierres: number };   // vigentes de Y+1 para el puente al total (§5.2)
  total_en_curso: number;                                       // Total Y de la Matriz (todas las columnas), para el puente
  pct_propio_con_nino: { fila_id: string; genero: string; mundo: string; linea: string; agrupacion_marca: string; pct: number }[]; // ≤ 200: filas con % propio cuyo efecto cambia con el método 4
};
```

**El `409 filas_manuales`** devuelve `{ codigo, mensaje, pct_propio: { total, filas: { fila_id, genero, mundo, linea, equivalencia, agrupacion_marca, pct_fila, pct_nuevo }[] (≤ 200) }, decididas: { total, filas: { fila_id, genero, mundo, linea, equivalencia, agrupacion_marca, decidido, propuesta_nueva_estimada }[] (≤ 200) } }`. Se emite cuando el `PUT` llega sin `resolucion` y alguna de las dos listas no está vacía (`filasEnChoque`, §5.1 regla 4). En ese caso no se escribe nada. `propuesta_nueva_estimada = round(B × (1 + g_nuevo))`.

**`400 celdas_incompletas`** devuelve `{ faltan: { genero, mundo }[] }`: todo par HOMBRE/MUJER × mundo activo con filas base activas de `Y+1` debe venir en `celdas`. **`400 genero_no_permitido`**: una celda de un género que no es HOMBRE ni MUJER.

**Orden de escritura:** `sigueEditable` → comprobar la huella → validar que la matriz esté completa → calcular los choques. Sin `resolucion` y con choque responde `409`. Con `pisar`: `crecimiento_pct = null` en las filas de la lista `pct_propio`. Si además `incluir_decididas`, en las de `decididas` se ponen a `null` `decidido`, `origen`, `propuesta_al_decidir` y `decidido_*` (como «Volver a la propuesta»), en tandas de 500. Después, `upsert`/`delete` de las celdas (las que no cambian conservan su quién y cuándo) → Resto, `crecimiento_resto_meta` y `crecimiento_objetivo_pct` en `parametros`. El `PUT` es un reemplazo completo e idempotente: tras un `500 guardado_parcial`, reintentar lo deja todo consistente (las filas ya pisadas no vuelven a chocar). `pisadas` devuelve el % y el total anteriores para poder reescribirlos.

**Lectura.** Filas base activas de `Y+1` con columnas ligeras (`decidido`, `crecimiento_pct`, `base_siguiente`, `base_normalizada`, `factores_mes`), la tabla, el catálogo de nodos, géneros y mundos, y las sumas de las filas de tienda de `Y+1` por subbloque. No se lee `historico` ni venta.

**Cambios en contratos existentes (pequeños):**
- `AnioFilaApi` de las filas base de `Y+1` gana `crecimiento_efectivo: { pct, origen: "fila" | "celda" | "resto", celda: string | null /* "HOMBRE · FORMAL" */ }`, `base_siguiente`, `base_normalizada`, `pct_bruto: number | null` (vigente ÷ `B` − 1) y `pct_sobre_normalizada: number | null` (vigente ÷ `B''` − 1). `totales_por_anio` de `/lineas` gana `base_siguiente` (Σ de la línea).
- `NodoMatrizApi.siguiente` gana `base_siguiente: number` y `crec_mismas_pct: number | null` (Σ vigente de `Y+1` de las filas base ÷ Σ `B` − 1). `hojasMatriz` añade esa columna al Excel.
- `editarSchema`: `parametros.crecimiento_pct_defecto` → `400 usar_crecimientos` sobre una proyección existente. `crearSchema` lo sigue aceptando: es el Resto inicial.

## 4. Pantallas

Pestaña nueva **Crecimientos** en `/planificacion/proyeccion` (`?pestana=crecimientos`), entre «Tiendas nuevas y cierres» y «Por línea». Va ahí porque las tiendas que pasan a mismas tiendas mueven `B` (B2) y la matriz alimenta las propuestas que luego se deciden por línea. La ven y la editan **admin y planner**. El comprador no ve la pestaña y la ruta le responde `403`. Kit: `Card`, `DataTable`, `Field`, `Badge`, `Alert`, `Modal`, `EmptyState`; formato `es-PE`.

| Zona | Contenido y acciones |
|---|---|
| Cabecera | «Crecimiento **bruto** 2027 frente a 2026 de las mismas tiendas de 2027 (10 tiendas). No se corrige por el Niño: si 2026 fue Niño en un mundo, inclúyelo en tu %.» Campo **Objetivo global (%)**, opcional. Si la matriz guardada no está aplicada: `Alert` «Guardado sin recalcular» con el botón Recalcular. Si la proyección se calculó con el método anterior: «método nuevo: recalcula». Si `pct_propio_con_nino` no está vacío: `Alert` «Desde 0.10.8 el % de una fila también es bruto. Estas N filas tienen un % propio y meses del Niño: su propuesta cambió al recalcular. Revísalas» (lista desplegable con enlace a cada línea). |
| Matriz | Filas = mundos; columnas = **HOMBRE**, **MUJER**. Cada celda tiene el campo `%` (obligatorio), una nota (`n`) y, debajo y en pequeño, «base 17 800 u · hoy 2027: 19 485 u». Si la celda tiene filas con meses del Niño, se añade «rebote del Niño +9,6 %» con el título «Solo por volver a un año normal, este GM crecería +9,6 % bruto. Es referencia: no se aplica». Badges: «2 con % propio», «1 decidida», «extremo» si \|pct\| > 50, «sin base». Una celda sin filas muestra «—». Una celda vacía tiene el borde de alerta y el marcador «sigue al Resto (5 %)». |
| Resto | Bloque aparte: campo `%`, nota, «base 20 000 u» y el desglose por género («JOVENCITOS 8 200 · NIÑOS 6 100 · …»). |
| Calcular promedio | Botón deshabilitado mientras falte alguna celda, con el mensaje «Faltan 3 celdas: HOMBRE · FORMAL, MUJER · RI y MUJER · URBANO. Escribe un % en cada una (puede ser el mismo del Resto). Mientras estén vacías, esas combinaciones siguen el Resto (5 %).» Al pulsarlo, panel de resultado (§5.2): una tabla por celda (base, % escrito, 2027 resultante, % resultante) más el Resto y el total, con las tres cifras del total y el puente al Total de 2027 de la Matriz. Si se edita una celda tras calcular, el panel se marca «cambiaste celdas: vuelve a calcular». |
| Pie | **Guardar y recalcular** (primario) · **Guardar** · Descartar cambios. Los dos primeros, deshabilitados con el mismo mensaje si falta alguna celda. Errores de zod junto al campo (rango −95 a 500). |
| Modal del choque (`409 filas_manuales`) | «Este cambio choca con filas fijadas a mano.» Sección 1: «12 filas tienen un % propio» y una tabla (género · mundo · línea · agrupación · % de la fila → % nuevo). Sección 2, si la hay: «5 filas tienen el total de 2027 decidido: conservan su cifra y mostrarán "propuesta cambió"», con una tabla (decidido → propuesta nueva estimada) y la casilla **«Pisar también estas 5 decisiones (vuelven a la propuesta nueva)»**, desmarcada por defecto. Botones: **Pisar** (las filas con % propio pasan a seguir la matriz, y las decididas solo si se marcó la casilla), **Conservar** (nada cambia en las filas) y **Cancelar** (no se guarda nada). La pantalla nunca manda `resolucion` sin que Javier pulse. |
| Por línea | Campo «Crec.» de cada fila de 2027: marcador con el % efectivo y su origen («20 % · HOMBRE · URBANO» o «5 % · Resto»). Ayuda: «% bruto 2027 ÷ 2026 de esta fila, sin corregir por el Niño. Vacío = el de la combinación (20 %).» En el detalle (`bloque-decision.tsx`): «Crecimiento bruto efectivo +20,0 % (HOMBRE · URBANO) · base 2026 de las mismas tiendas de 2027: 19 424 u», y en filas con Niño, «sobre la base normalizada por el Niño equivale a −20,8 %». Una fila decidida muestra «tu decisión: +11,2 % bruto». En el pie de la tabla, la fila «Línea (mismas)» de 2027 lleva «+20,0 % bruto sobre la base 2026 de las mismas tiendas de 2027 (60 002 ÷ 50 001)» y, si hay diferencia con la columna 2026, el puente (§5.2). La frase de `bloque-decision.tsx:177` deja de decir «normalizada por el Niño». |
| Matriz (Parte 2) | Columna nueva **Crec. mismas tiendas** junto a «Var.». Su título explica: «Var. = Total 2027 ÷ Total 2026 (incluye aperturas y cierres). Crec. mismas tiendas = 2027 de las mismas tiendas ÷ su 2026: es lo que escribes en Crecimientos». |
| Cerrada o archivada | Todo se ve y nada se edita (`editable = false`). «Calcular promedio» sigue disponible. |

**Respuesta a la queja «pongo 20 % y veo 25 %».** Con el método 4 la diferencia por el Niño desaparece: un GM al 20 % sin filas fijadas muestra +20,0 % en la celda, en «Crec. mismas tiendas» de la Matriz y en el pie de cada línea. Lo que queda entre el % escrito y la «Var.» de la Matriz son las tiendas que entran y salen y las filas fijadas. El panel de «Calcular promedio» y el título de la columna lo muestran como un puente con cifras, nunca como una sola cifra sin explicar.

## 5. Reglas de negocio

### 5.1 Reglas para vitest (en `tests/proyeccion.crecimientos*.test.ts`; puras salvo donde dice «ruta»)

1. `crecimientoEfectivo`: fila con % propio > celda GM > Resto. Una celda de otro GM, una celda borrada o una celda de un género fuera de `GENEROS_MATRIZ` no se aplican.
2. **Método 4 en `proponerSiguiente`:** `P = round(B × (1 + g))` para cualquier `φ_Y`. Prueba de propiedad: con `φ_Y ∈ {0,5, 0,66, 1,24}` constante o por meses, `P` no depende de `φ_Y`. Con `φ_{Y+1} ≠ 1`, `P` no cambia y solo cambia el reparto (`c'_m ∝ c_m φ_{Y+1,m}`). `base_normalizada = B' × Σ c φ_{Y+1}` y se guarda. Sin base → `null` y `sin_base`.
3. Ejemplo de §5.3: HOMBRE · FORMAL al 20 % da 3 960 en TERNO, 4 725 en PANTALÓN y 10 800 en CAMISA (decidida), con un resultado de la celda de 19 485 (+9,5 %), un rebote del Niño de +9,6 % y TERNO a −20,8 % sobre la base normalizada.
4. `filasEnChoque(guardada, borrador, filas)`. **% propio:** filas base de `Y+1` con `crecimiento_pct` cuyo % no manual (celda o Resto) cambia con este guardado y cuyo % propio ≠ el nuevo efectivo. **Decididas:** filas con `decidido` de `Y+1` cuyo % efectivo cambia. Cambiar el Resto solo afecta a los GM sin celda. Borrar una celda (posible solo si se queda sin filas) hace caer su GM al Resto.
5. Ruta `PUT`. Con choque y sin `resolucion`: `409 filas_manuales`, sin escribir nada. Con `conservar`: no toca ninguna fila y guarda las celdas. Con `pisar`: `crecimiento_pct = null` **solo** en las filas con % propio en choque. Con `pisar` + `incluir_decididas`: además vuelve a la propuesta las decididas en choque, y `pisadas` trae `pct_anterior` y `decidido_anterior`. `incluir_decididas` sin `pisar` → `400 resolucion_invalida`. Sin `incluir_decididas`, un total decidido nunca cambia.
6. Ruta. Matriz incompleta → `400 celdas_incompletas` con la lista, sin escribir nada. Una celda «sin filas» no es obligatoria. Celda repetida → `400`; género que no es HOMBRE ni MUJER → `400 genero_no_permitido`; mundo inactivo → `400`. `cerrada`, `archivada` o `calculo_en_curso` → `409`; una `huella` distinta → `409 conflicto`. En ningún caso se escribe nada. Comprador: `403` en `GET` y `PUT`; sin sesión: `401`.
7. `calcularPromedio(celdas, resto, objetivo)`: el ejemplo de §5.2 da 11,7 % ponderado escrito, 10,2 % resultante, 132 185 u y faltan 2 215 u frente al 12 %. Con una celda vacía devuelve `null` con la lista de las que faltan. Sin objetivo no hay comparación.
8. `calcularProyeccion` con celdas: una fila sin decidir de una celda al 12 % da `propuesto = round(B × 1,12)`. Una fila con % propio del 5 % da `round(B × 1,05)`. Una fila de JOVENCITOS sigue el Resto. Una tienda `maduro_propio` de `Y+1` usa el % de su GML-AM sobre `A^b`. Una apertura de `Y+1` no cambia por la matriz.
9. `base_siguiente` y `base_normalizada` las escriben `calcular` y todo `recalcularBaseSiguiente`; `|propuesto − B × (1+g)| ≤ 0,5`.
10. `huellaCrecimientos` no depende del orden. Un cambio de celda, del Resto o del mundo de un nodo produce `crecimientos_cambiados`; el objetivo global no. Recalcular lo limpia.
11. B2 en el acto, tras guardar la matriz, usa el % nuevo de la celda y reescribe `base_siguiente`.
12. `copiar_de` copia las celdas, el Resto y el objetivo. Un `PATCH` de parámetros con `crecimiento_pct_defecto` sobre una proyección existente responde `400 usar_crecimientos`.
13. `VERSION_METODO = 4`. Una proyección en trabajo con `version_metodo < 4` está «desactualizada: método nuevo» y `cerrar?forzar=1` la rechaza con `409 version_metodo` (0.10.3). Una cerrada no cambia.
14. `pct_propio_con_nino` lista solo filas con `crecimiento_pct` y algún `φ_Y ≠ 1` o `φ_{Y+1} ≠ 1`.

### 5.2 «Calcular promedio» (`calcularPromedio`, puro, en el navegador)

Requiere la matriz completa. Con `B_c` = `agregado.base` de cada celda `c` y del Resto `R`:

- **Ponderado de lo que escribiste:** `ḡ = Σ_c B_c g_c ÷ Σ_c B_c` (las celdas y el Resto). Es literalmente «el ponderado de todos los crecimientos que voy a escribir».
- **2027 resultante por celda:** `S_c = pct_propio.siguiente + decididas.siguiente + base_libre × (1 + g_c)`, y `%_c = S_c ÷ B_c − 1`. Es estimado: puede diferir del recálculo en ±0,5 u por fila por redondeo, y la pantalla lo dice. Se omite «sin decidir» porque ya está en `base_libre`.
- **Resultado total (mismas tiendas 2027):** `Σ S ÷ Σ B − 1`, con las unidades. Difiere de `ḡ` solo por las filas con % propio y las decididas, y el panel lo dice: «3 filas con % propio y 5 decididas llevan el total de +11,7 % a +10,2 %».
- **Objetivo:** «Objetivo +12,0 % → con lo escrito te faltan 0,3 pp; con el resultado, 1,8 pp ≈ 2 215 u».
- **Puente al Total 2027 de la Matriz:** base 2026 de las mismas tiendas de 2027 → × crecimiento resultante → 2027 mismas tiendas → + nuevas del año anterior y aperturas de 2027 − cierres → Total 2027. Frente al Total 2026 de la Matriz → «Var.».

*Ejemplo (sintético).* Celdas: HOMBRE · FORMAL 20 % (base 17 800, la de §5.3), HOMBRE · URBANO 10 % (50 000, todas libres), MUJER · CASUAL 15 % (30 000), MUJER · FORMAL 0 % (2 200). HOMBRE · CASUAL y MUJER · URBANO no tienen filas (no son obligatorias). Resto 5 % (20 000). `Σ B = 120 000`.
`ḡ = (17 800·20 + 50 000·10 + 30 000·15 + 2 200·0 + 20 000·5) ÷ 120 000 = 1 406 000 ÷ 120 000 =` **11,7 %**.
Resultantes: 19 485 + 55 000 + 34 500 + 2 200 + 21 000 = **132 185 u → +10,2 %**. Objetivo 12 % → 134 400 u → faltan **2 215 u**. Con aperturas de 2027 = 914 u, el Total 2027 es 133 099 u.

### 5.3 Ejemplo de una celda y del rebote del Niño (HOMBRE · FORMAL, tres filas, celda al 20 %)

| Fila | `B` (2026, mismas tiendas de 2027) | `B''` | Estado | 2027 |
|---|---|---|---|---|
| (A) CAMISA × RECONOCIDO, toda temporada | 10 000 | 10 000 | total decidido 10 800 | 10 800 (+8,0 % bruto) |
| (B) TERNO × PREMIUM, invierno, Niño 2026 `φ = 0,66` | 3 300 | 3 300 ÷ 0,66 = 5 000 | sigue la celda | round(3 300 × 1,20) = **3 960** (+20,0 % bruto; −20,8 % sobre `B''`) |
| (C) PANTALÓN × VALOR, vigente 4 000 + T10 que pasa 500 | 4 500 | 4 500 | % propio 5 % | round(4 500 × 1,05) = **4 725** |

Celda: `base = 17 800`, `base_libre = 3 300`, resultado 19 485 → **+9,5 %**. Rebote del Niño: `19 500 ÷ 17 800 − 1 = +9,6 %`: solo por volver a un año normal, el GM crecería +9,6 % bruto. Con el método 3 la misma celda al 20 % habría dado TERNO 6 000 (+81,8 % bruto).

### 5.4 Casos borde

| Caso | Comportamiento |
|---|---|
| GM de Hombre/Mujer sin filas (o que se quedó sin filas tras mover un nodo) | La celda guardada se conserva con «sin filas», no aplica a nada y no es obligatoria. El mundo solo aparece si tiene filas o una celda. |
| GM de Hombre/Mujer nuevo tras recalcular (un mundo ganó filas) | Celda vacía «sigue al Resto»: hasta que se escriba, ese GM sigue el Resto, y no se puede guardar otra vez sin llenarla. |
| GM con filas pero sin base (todas sin curva o sin base de `Y`) | `agregado.base = 0` y badge «sin base». El % es obligatorio igual (se aplicará cuando haya base) y pesa 0 en el promedio. |
| Toda la matriz con `Σ B = 0` | «Calcular promedio» muestra «sin base: recalcula la proyección». |
| `g` negativo o extremo | Se acepta de −95 a 500 (el mismo `check`). Fuera de ±50, badge «extremo»: avisa y no bloquea (decisión 33). |
| Proyección cerrada o archivada | Solo lectura; la matriz que usó se conserva en la tabla. |
| Tiendas nuevas | La nueva de `Y` que pasa a `M(Y+1)` entra por `B`. La `maduro_propio` de `Y+1` sigue la celda (en bruto). La apertura de `Y+1` no la sigue. |
| Nodo que cambia de mundo (o línea movida a otro nodo) | El GM se resuelve con el árbol vigente y la huella pide recalcular. Si el mundo nuevo no tenía celda, la celda aparece vacía. |
| Nodo GMLE | Cada fila por equivalencia pesa con su `B`; las de un mismo nodo comparten GM. |
| Matriz guardada sin recalcular | Los agregados (`siguiente_vigente`) usan las propuestas guardadas y `al_dia = false`; el panel lo dice. |
| Proyección de antes de `0.10.8` (sin `base_siguiente`) | `agregado.base = 0` en todas las celdas, «Calcular promedio» deshabilitado con «recalcula: método nuevo», y la cabecera muestra «método nuevo». |
| Fila de cola larga para revisión | `B` sale de la demanda corregida de `Y`, como hoy; el % bruto se aplica sobre ella. |

## 6. Criterios de aceptación (hito de Javier)

1. La pestaña Crecimientos muestra la matriz con los mundos reales de la base y las columnas HOMBRE y MUJER, el Resto con el % de la proyección y su desglose por género. El comprador no la ve.
2. Con una celda vacía, «Calcular promedio», «Guardar» y «Guardar y recalcular» están deshabilitados y el mensaje enumera las celdas que faltan.
3. [ESCRIBE] Llenar todas las celdas, escribir un objetivo global y pulsar **Calcular promedio**: aparecen el ponderado de lo escrito, el resultado con las filas fijadas, la comparación con el objetivo en pp y unidades, y el puente al Total 2027. Comprobar a mano una celda y el total con §5.2.
4. [ESCRIBE] **Guardar y recalcular** con un GM al 20 % sin filas fijadas: su «Crec. mismas tiendas» en la Matriz y el pie de una de sus líneas muestran +20,0 %. En una línea de invierno con Niño, la explicación dice «bruto, sin corregir por el Niño» y el detalle muestra el % sobre la base normalizada.
5. [ESCRIBE] Escribir un % en una fila de Por línea y decidir otra fila del mismo GM; luego cambiar la celda: aparece el Modal con las dos secciones. Repetir con **Conservar** (nada cambia), con **Pisar** sin la casilla (la fila con % propio sigue la celda y la decidida conserva su total), con **Pisar** con la casilla (la decidida vuelve a la propuesta nueva) y con **Cancelar** (no se guarda nada).
6. Recalcular una proyección del método 3: la cabecera dice «método nuevo» antes y nada después; ninguna decisión se pierde; si había filas con % propio en líneas con Niño, aparecen en el aviso.
7. En una proyección cerrada todo se ve y nada se edita. Pasan `lint`, `tsc`, `vitest` y `build`, y `APP_VERSION = "0.10.8 · M7"`.

## 7. Fuera de alcance

Columnas de otros géneros en la matriz (van al Resto por decisión de Javier); crecimientos por línea o por agrupación de marca dentro de la matriz; crecimiento del año en curso o de las aperturas; repartir el rebote del Niño dentro de un GM (§2.4, variante descartada); deshacer un «Pisar» (la respuesta y el aviso listan el % y el total anteriores para reescribirlos); sugerencias de % por celda o por tendencia histórica; historial de versiones de la matriz; aplicar en el acto sin recalcular.

**Propuestas para `docs/DECISIONES.md` (2026-10-16; las registra el `documentador`):**
1. **El % de crecimiento del año siguiente es bruto** (`Y+1 ÷ Y` de las mismas tiendas de `Y+1`, sin corregir por el Niño) en la celda GM, en el Resto **y en la fila**. `P = round(B × (1 + g))` y `φ_{Y+1}` solo da forma al reparto. Ajusta la decisión del 2026-10-15 «el año siguiente es la base normalizada por el crecimiento del planner»: la normalización por el Niño se mantiene en el cierre del año en curso y queda como referencia («rebote del Niño», «% sobre la base normalizada») en el año siguiente. Descartado: % sobre la base normalizada (la recomendación original); convertir a nivel de GM repartiendo el rebote del Niño.
2. **La matriz tiene solo Hombre y Mujer por mundo, más el Resto**, y se llena entera. El Resto es `crecimiento_pct_defecto` y se edita solo desde la matriz.
3. **«Calcular promedio» pondera lo escrito por las unidades base**, lo compara con un objetivo global opcional y muestra el resultado con las filas fijadas. Descartado: la sugerencia por celda con «Usar».
4. **Guardar no recalcula**: marca `crecimientos_cambiados` y ofrece «Guardar y recalcular».
5. **El Modal de choque incluye las filas con total decidido**, que solo se pisan si Javier marca la casilla.

## 8. Cambios tras las respuestas de Javier (2026-10-16)

| Pregunta | Respuesta de Javier | Qué cambió en la ficha |
|---|---|---|
| 1. Significado del % | «Variación bruta 2027 ÷ 2026», sin corregir por el Niño | Método 4: `P = round(B × (1+g))` para la celda, el Resto **y el % propio de la fila** (un solo significado). `base_comparable` (`B''`) se sustituye por `base_siguiente` (`B`, el peso y el denominador) más `base_normalizada` (`B''`, solo como referencia). Por línea muestra el % bruto efectivo y el % sobre la base normalizada. La Matriz gana «Crec. mismas tiendas». Aviso para las filas con % propio y Niño. |
| 2. Qué hace «Calcular» | «Que me dé un ponderado de todos los crecimientos que yo voy a escribir; yo tengo que llenar todos los cuadrados» | **Quitados:** la sugerencia por celda (`g_sug`, desglose decididas / % propio / propuesta, `solo_decisiones_propias_pct`), el botón **Usar**, la vista previa por celda y `POST …/crecimientos/calcular`. **Nuevo:** «Calcular promedio» en el navegador (`calcularPromedio`) con el ponderado de lo escrito, el resultado con las filas fijadas, el objetivo global opcional (`parametros.crecimiento_objetivo_pct`) y el puente al Total 2027. Matriz obligatoria completa (`400 celdas_incompletas`; botones deshabilitados con la lista). Única ayuda que queda por celda: el «rebote del Niño», que se queda porque, con un % bruto, el sistema ya no corrige el Niño y sin esa referencia Javier no vería qué GM viene deprimido. No se copia a ningún campo. |
| 3. Géneros | Solo Hombre y Mujer, más el Resto; los mundos son las filas | Columnas fijas `GENEROS_MATRIZ` resueltas por nombre; `400 genero_no_permitido`; el Resto incluye los demás géneros con su desglose; mundos reales como filas. |
| 4. Precedencia | Modal «Pisar / Conservar / Cancelar»; nada se pisa sin respuesta | Se mantiene el Modal y se amplía con una sección de filas decididas y su casilla (desmarcada). El cuerpo pasa de `pisar_manuales` a `resolucion` + `incluir_decididas`. |

**Se mantienen:** tabla `proyeccion_crecimientos`, migración `0023`, rutas bajo `/api/proyeccion/proyecciones/[id]/crecimientos` con `requirePlanner`, huella y bloqueo optimista (`409 conflicto`), Resto = `crecimiento_pct_defecto` con `400 usar_crecimientos`, pestaña Crecimientos, «Guardar» frente a «Guardar y recalcular», `huella_crecimientos` y `crecimientos_cambiados`, `VERSION_METODO = 4` (ahora también por 07d) y el plan de pruebas, reescrito en §5.1.

## Preguntas abiertas (solo Javier)

1. **¿«2026» es el de las mismas tiendas de 2027 o la columna «mismas tiendas 2026» de la Matriz?** Recomendado, y es lo que asume la ficha: las **mismas tiendas de 2027**. Su 2026 incluye a la tienda que abrió a fines de 2025 y ya cuenta como misma tienda en 2027, y excluye a las que cierran en 2027. Así, un 20 % significa «las mismas tiendas venden un 20 % más», y decidir esa tienda en Tiendas nuevas sigue moviendo 2027 (B2). La alternativa (la columna de 2026, 9 tiendas) contaría como crecimiento lo que aporta esa tienda, y decidirla dejaría de mover el total de 2027.
2. **Dentro de un GM, ¿todas las filas crecen el mismo % bruto?** Recomendado, y lo que asume la ficha: sí. Una línea de invierno deprimida por el Niño crece igual que una de verano. Si quieres más para invierno, súbelo en la celda o escribe un % propio en la fila, con el «rebote del Niño» como guía. La alternativa reparte ese rebote dentro del GM manteniendo el total bruto, pero puede hacer bajar una línea de verano aunque escribas +20 %.

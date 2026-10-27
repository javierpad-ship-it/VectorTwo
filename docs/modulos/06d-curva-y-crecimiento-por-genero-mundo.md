# 06d · Curva y crecimiento del año siguiente por género × mundo (global y versionado)

> Estado: **borrador para revisión (2026-10-27)**; pasa por el `arquitecto-revisor` (opus) antes de construir. Amplía M6 ([06b](06b-curvas-trabajo-por-agrupacion.md), [06c](06c-curvas-composicion-y-curva-usuario.md)) y cambia la fuente del crecimiento de M7 ([07c](07c-crecimientos-por-genero-mundo.md)), sin tocar su método numérico. Versión prevista **`0.12.1 · M6`**, commits `M6:`, migración **`0027_crecimientos_genero_mundo.sql`** (ver §2.4: `0025` y `0026` las reserva la ficha 08 en edición). Cifras sintéticas; los géneros y mundos son los del seed de `0001`; tiendas `T01…`.

## 1. Objetivo

Javier no quiere reescribir el crecimiento dentro de cada proyección: quiere **analizar la curva de venta de cada género × mundo (GM) de las mismas tiendas** y, desde ahí, **aprobar una sola vez** el crecimiento bruto de mismas tiendas del año siguiente. Este módulo añade a Curvas de estacionalidad una herramienta de análisis por GM (curva mensual por año, forma, nivel, cifras de referencia con y sin Niño) y un **supuesto global y versionado** por GM y año (más el **Resto**), con nota, quién y cuándo, que **todas las proyecciones leen**. Si cambia, las proyecciones que lo usaron quedan desactualizadas; nada se recalcula solo ni se pisa lo decidido.

## 2. Modelo de datos (`0027`)

### 2.1 Tabla nueva `crecimientos_genero_mundo` (una fila por versión)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `anio_aplicacion` | `integer not null`, `check between 2024 and 2100` | El año al que se aplica (`Y+1`, p. ej. 2027). Un supuesto por año: el de 2028 se aprueba aparte. |
| `alcance` | `text not null`, `check in ('gm','resto')` | `resto` = todo lo no detallado (§2.3). |
| `genero_id`, `mundo_id` | `uuid null → generos / mundos on delete restrict` | `check ((alcance='gm' and genero_id is not null and mundo_id is not null) or (alcance='resto' and genero_id is null and mundo_id is null))`. Qué géneros son detallables lo valida la API (un `check` por nombre no cabe). |
| `version` | `integer not null check (version >= 1)` | 1, 2, 3… por (año, alcance, GM). |
| `estado` | `text not null default 'vigente'`, `check in ('vigente','reemplazada')` | Igual que `curvas_estacionalidad`. Nunca se borra una versión. |
| `pct` | `numeric(6,2) not null`, `check between -95 and 500` | **% bruto** `Y+1 ÷ Y − 1` de las mismas tiendas de `Y+1`, sin corregir por el Niño (07c §2.4). Mismo rango que `crecimiento_pct`. |
| `nota` | `text null`, `check (nota is null or char_length(nota) <= 300)` | Obligatoria según la regla R-N (§5.2). |
| `base_tipo` | `text not null`, `check in ('acumulado','cierre_proyectado','anio_completo','aplicado_hoy','ninguna')` | La referencia que el planner eligió como base. |
| `base_valor` | `numeric(8,2) null` | Su valor **bruto-equivalente para `Y+1`** al aprobar (§5.1); `null` con `ninguna` o si no era calculable. |
| `referencia` | `jsonb not null`, `check (jsonb_typeof(referencia)='object')` | Foto de lo que vio: todas las cifras de §5.1 (bruto, sin Niño, equivalente), tiendas y `k`, rebote, `huella_datos`, composición del GM (`gml_ids`) y la proyección de referencia (id, nombre, `calculado_at`). Con ella se explica la versión sin releer venta. |
| `proyeccion_referencia_id` | `uuid null → proyecciones on delete set null` | Con índice (el `set null` no recorre la tabla). |
| `perfil_id` (`→ perfiles on delete set null`), `usuario_nombre`, `aprobada_at timestamptz not null default now()` | | Quién y cuándo (decisión 33), como en `curvas_estacionalidad`. |
| `activo`, `created_at`, `updated_at` | | Convención; `activo` sin uso. Trigger `tg_set_updated_at`. |

Índices: único `(anio_aplicacion, alcance, coalesce(genero_id, '0000…'), coalesce(mundo_id, '0000…'), version)`; **único parcial de vigente** sobre las mismas columnas sin `version` `where estado = 'vigente'` (una sola vigente por GM y año; se usa `coalesce` en vez de `nulls not distinct` para no depender de la versión de Postgres); índices simples por `genero_id`, `mundo_id` y `proyeccion_referencia_id`. RLS activo sin políticas; `revoke all` a `public, anon, authenticated` y `grant` a `service_role`; `comment on`.

### 2.2 `proyeccion_crecimientos` pasa a ser la **foto de lo aplicado** (no se borra nada)

Desde `0.12.1` sus filas ya no las escribe el planner: las reescribe **cada cálculo** de la proyección con los crecimientos por GM que usó. La `0027` añade `crecimiento_id uuid null → crecimientos_genero_mundo on delete restrict` (con índice) y `version integer null check (version is null or version >= 1)`; `pct`, `nota`, `perfil_id` y `usuario_nombre` se copian de la versión global (quién la aprobó). Filas con `crecimiento_id null` = celdas escritas en `0.10.8` (hoy 0). El Resto usado va en `parametros.crecimiento_resto_usado = { pct, crecimiento_id | null, version | null, por_nombre | null, at | null }` (clave nueva del `jsonb`, sin migración). **`base_siguiente` y `base_normalizada` se conservan y se siguen escribiendo**: son `B` y `B''`, los pesos y el rebote que lee la pantalla nueva.

**Migración de valores:** ninguna en SQL (sin `UPDATE`, `INSERT` ni backfill). Hoy hay 0 celdas guardadas y el Resto es `crecimiento_pct_defecto`, que sigue siendo el **Resto provisional** de cada proyección mientras no haya un Resto aprobado para su año. La referencia «Aplicado hoy» (§5.1) le deja a Javier aprobar ese valor con un clic. Si `datos` encuentra celdas guardadas al aplicar la `0027`, las informa y Javier las aprueba en la pantalla (nunca se copian solas).

### 2.3 Géneros detallados

Se aprueban por GM **solo HOMBRE y MUJER** (`GENEROS_DETALLADOS = GENEROS_MATRIZ`, resueltos por nombre como en 07c §2.5). Todo lo demás sigue el **Resto**. La pantalla **analiza todos los géneros con venta** (cuesta lo mismo: sale de la misma lectura), pero en los demás géneros el campo de aprobación no aparece («sigue al Resto»). **Por qué:** se mantiene la decisión 3 de 07c, los géneros chicos tienen pocas tiendas y cifras ruidosas, y abrir uno más luego es cambiar una constante: la tabla ya acepta cualquier `genero_id`.

### 2.4 Función `venta_genero_mundo(p_desde date) returns jsonb` y numeración

Ninguna función existente sirve. `venta_estacionalidad_agrupacion` (`0017`) corta por agrupación, `venta_composicion_agrupacion` (`0022`) por GML dentro de una agrupación y por red, `unidades_mensuales` (`0014`) no trae tiendas, y `venta_proyeccion` (`0018`/`0021`) va por tandas de nodos con marca y talla (demasiado pesada). La nueva es `language sql`, `stable`, `security invoker`, `search_path = ''`, solo `service_role`, y su cuerpo va sin comentarios `--`. En una sola sentencia devuelve:

```jsonc
{ "series": [ { "g": "<genero_id>", "m": "<mundo_id>", "temp": "invierno|verano|todo_el_ano|sin_agrupacion", "t": "<tienda_id>",
                "u": { "2023-01": 120, "2023-02": 98, … } } ],    // unidades netas, solo tiendas tipo Tienda, periodo ≥ p_desde
  "cargas": { "2023-01": "<carga_id>", … } }                     // mismo CTE que 0017: huella de cargas coherente
```

El GM sale del **árbol vigente** (`equivalencias → genero_mundo_linea`): si un nodo cambia de mundo, se lleva su historia. La temporada es la de la agrupación activa de la equivalencia, igual que la `0017`. Va en `jsonb` porque supera las 1 000 filas de PostgREST. Tamaño: unos 600 grupos × 46 meses ≈ 0,6 MB. **Costo estimado:** es un agregado completo de `venta_stock_vigente`, comparable al CTE `temporadas` de la `0017` (0,6 a 1,5 s medidos con 870 000 filas). Presupuesto: **≤ 3 s en frío**, con techo duro en el `statement_timeout` de 8 s. `datos` lo mide con `explain (analyze, buffers)`, dos pasadas, antes de que `backend` lo use. **Plan B:** pasar `p_desde` = enero de `Y−3`. El backend la cachea en memoria por huella de cargas (patrón `cache-venta.ts`: TTL 120 s, 2 entradas, 1 lectura simultánea).

**Numeración:** la siguiente libre por archivo es la `0025`, pero la ficha 08 (en edición) reserva la `0025` y la `0026`. Esta toma la **`0027`**. No hay conflicto técnico: la `0027` solo depende de la `0018` y la `0023`, y es idempotente. Si se aplica antes que la `0025`, el orden en la base no coincide con el orden de los archivos, y `validar-migraciones-local.sh` igual la reproduce en orden.

## 3. Contratos de API

Todo con `requirePlanner` (el comprador recibe `403`; sin sesión, `401`), `{ data }` / `{ error, codigo }`, `leerCuerpo`, `traducirErrorDb`. Código en `src/lib/crecimientos/` y rutas en `src/app/api/curvas/genero-mundo/`. `clave` = `resto` o `<genero_id>.<mundo_id>`.

| Ruta | Método | Entrada | Respuesta · errores |
|---|---|---|---|
| `/api/curvas/genero-mundo` | GET | `?anio=2027&proyeccion=<id>` (opcionales) | `ListaGeneroMundoApi` · `400` · `409 sin_datos` (ningún mes publicado y cerrado) |
| `/api/curvas/genero-mundo/[clave]` | GET | `?anio=&proyeccion=` | `DetalleGeneroMundoApi` · `400 clave_invalida` · `404` |
| `/api/curvas/genero-mundo/[clave]` | POST | `aprobarCrecimientoSchema` | `201 { vigente: VersionCrecimientoApi, proyecciones_desactualizadas: { id, nombre }[] }` · `400` (zod, `genero_no_detallado`, `mundo_inactivo`) · `409 datos_cambiados` · `409 vigente_cambiada` · `409 sin_cambio` · `409 nota_requerida` (orden de M6) |
| `/api/curvas/genero-mundo/vigentes` | GET | `?anio=` | `{ anio, gm: { genero_id, mundo_id, pct, version, id }[], resto: {…} \| null }`: contrato de lectura, igual que `/api/curvas/vigentes` |

```ts
export const BASES = ["acumulado", "cierre_proyectado", "anio_completo", "aplicado_hoy", "ninguna"] as const;
export const aprobarCrecimientoSchema = z.object({
  anio: z.number().int().min(2024).max(2100),
  pct: crecimiento,                                         // −95..500, el de esquemas.ts de M7
  nota: notaSchema.nullable(),                              // ≤ 300, sin caracteres de control ni bidi (CARACTERES_PROHIBIDOS_NOTA)
  base: z.object({ tipo: z.enum(BASES), anio: z.number().int().nullable(), variante: z.enum(["bruto", "sin_nino_mas_rebote"]) }).strict(),
  proyeccion_referencia_id: z.uuid().nullable(),
  huella_datos: z.string().min(1),                          // la del GET: datos que vio (bloqueo optimista, patrón M6)
  version_vigente: z.number().int().min(1).nullable(),      // null = «no había vigente»; si no coincide → 409 vigente_cambiada
}).strict();
```

**Aprobar** (sin función SQL: las migraciones no admiten `UPDATE` ni en un cuerpo de función):
1. El servidor recalcula el detalle desde la caché y compara `huella_datos` (`409 datos_cambiados`).
2. Valida R-N (`409 nota_requerida`) y `sin_cambio` (mismo `pct`, nota y base que la vigente).
3. Pasa la vigente a `reemplazada` con `UPDATE … where id = ? and estado = 'vigente'`; 0 filas → `409 vigente_cambiada`.
4. Inserta `version + 1` con su foto `referencia`. Si el insert falla, restaura la anterior.

Queda la misma ventana de milisegundos sin vigente que ya existe en M6 y M12. Un cálculo que caiga en ella usa el Resto, deja la huella distinta y queda «desactualizado». **No escribe en ninguna proyección.**

**Tipos** (los define primero `backend` en `src/lib/crecimientos/tipos-api.ts`):
- `FilaGMApi = { clave, genero, mundo, detallable, unidades_anterior, acumulado: ReferenciaApi, aplicado_hoy, base_siguiente, vigente: VersionCrecimientoApi | null, estado: "sin_aprobar" | "aprobado" | "obsoleto", motivo_obsoleto, sigue: "propio" | "resto" }`.
- `ListaGeneroMundoApi = { anio_aplicacion, anio_en_curso, ultimo_mes_cerrado, proyeccion_referencia, proyecciones_disponibles, filas: FilaGMApi[], resto: FilaGMApi, huella_datos }`.
- `DetalleGeneroMundoApi = { …FilaGMApi, tiendas: { n, ids, fuera: { tienda_id, motivo }[] }, series: { anio, meses, meses_sin_nino, origen /* 'real' | 'proyectado' | null */, incompleto, total, total_sin_nino, forma }[], forma_tipica, bandas_nino: { anio, temporada, meses, factor }[], referencias: ReferenciaApi[], rebote_nino_pct, versiones: VersionCrecimientoApi[], avisos, huella_datos }`.
- `ReferenciaApi = { tipo, anio, etiqueta, periodo, tiendas, anterior, actual, pct_bruto, pct_sin_nino, equivalente: { bruto, sin_nino_mas_rebote }, fragil, motivo_nulo }`.

### 3.1 Lectura desde M7 (el método numérico no cambia)

- **Precedencia:** fila con % propio > **GM aprobado vigente** (solo géneros detallados) > **Resto aprobado vigente** > `crecimiento_pct_defecto` (Resto provisional de la proyección). Se arma con `crecimientoParaM7(vigentes, generosDetallados, defecto) → { matriz, resto, origenResto }` y entra en `matrizDeCeldas` / `crearCrecimientoDe` sin tocarlos.
- **`ejecutarCalculo`** (`servicio.ts`) deja de leer `proyeccion_crecimientos` y lee `crecimientos_genero_mundo` vigentes de `anio_en_curso + 1`. Calcula como hoy (`P = round(B × (1+g))`). Dentro del mismo candado reescribe la foto (§2.2: `proyeccion_crecimientos` y `crecimiento_resto_usado`) y guarda `resumen.huella_crecimientos` y `gm_gml`.
- **Huella:** `huellaCrecimientos` agrega `#<crecimiento_id>` a cada línea **solo si hay id**. Sin aprobaciones, el texto es idéntico al de `0.10.8`, así que el despliegue no marca nada. Aprobar una versión, aunque tenga el mismo valor, marca las proyecciones en trabajo de ese año (la foto debe decir quién decidió).
- **Desactualización:** `desactualizadaDe` arma `CrecimientosActuales.huella` desde los vigentes globales (más `pct_defecto` si no hay Resto). `crecimientosCambiados` y el motivo `crecimientos_cambiados` (`desactualizado.ts`) **no cambian**, y siguen sin poder forzarse al cerrar. Recalcular lo limpia y nunca toca `decidido` ni `crecimiento_pct` (`payloadAnioCalculo`).
- **Recalculaciones en el acto (B2)** y **proyecciones cerradas** leen **la foto**, nunca el global: `cargarMatriz` (`servicio-base.ts`) sigue leyendo `proyeccion_crecimientos` y toma el Resto de `crecimiento_resto_usado.pct ?? crecimiento_pct_defecto`. Una cerrada nunca cambia.
- **Cierre:** motivo nuevo **bloqueante, sin excepción (decisión de Javier)** `crecimientos_sin_aprobar` («3 género × mundo de 2027 siguen al Resto y el Resto es provisional»), evaluado sobre los vigentes de hoy. «Antes de proyectar» lo muestra como aviso y el botón Cerrar queda deshabilitado con el enlace a Curvas → Crecimiento por género × mundo.
- **`VERSION_METODO` sigue en 4.** La fórmula, la precedencia y el reparto son los mismos; cambia la fuente del %, y eso lo cubre la huella. Subirla obligaría a recalcular sin necesidad y no aportaría nada a M8 (`VERSION_METODO_MIN_M8 = 4`).

### 3.2 Qué se quita o cambia de lo construido en `0.10.8`

| Pieza | Decisión |
|---|---|
| Pestaña «Crecimientos» (`crecimientos-tab.tsx`) | Se **reemplaza** en el mismo lugar y con la misma URL (`?pestana=crecimientos`) por el resumen de solo lectura (§4.2). Desaparecen la matriz editable, «Guardar y recalcular» y el «Calcular promedio» editable. |
| `GET …/proyecciones/[id]/crecimientos` | Se mantiene con otra forma: `ResumenCrecimientosProyeccionApi` (foto por GM con versión, vigente de hoy, `AgregadoApi` de 07c, choques, puente y objetivo). |
| `PUT …/crecimientos` | Responde **`410 crecimientos_globales`**: «Los crecimientos se aprueban en Curvas → Crecimiento por género × mundo». Así una pestaña vieja abierta no escribe. `guardarSchema` y su servicio se retiran. |
| Modal Pisar / Conservar / Cancelar | **Se traslada.** Aprobar en el global nunca toca filas, así que «Conservar» pasa a ser no hacer nada. En el resumen, cada GM con choques tiene «Alinear filas fijadas a mano…» → `POST …/crecimientos/alinear` `{ clave, incluir_decididas, huella_choque? }`. Sin `huella_choque` responde `409 filas_manuales` con la forma de 07c. Con ella pisa (`pisarRegistros`) y encadena el recálculo (pasos 5 a 9 del `PUT` de 07c). Reutiliza `choque-modal.tsx`, `filasEnChoque` y `huellaChoque`. Ahora chocan las filas con % propio distinto del efectivo aprobado y las decididas con `propuesta_cambio`. |
| `PATCH` de parámetros | `400 usar_crecimientos` con el texto nuevo. `crecimiento_objetivo_pct` pasa a ser editable por `PATCH` (es informativo y no recalcula). |
| `copiar_de` | Ya no copia celdas: el primer cálculo escribe la foto desde el global. |
| Formulario «Nueva proyección» | El campo pasa a «Resto provisional (se usa solo si no hay Resto aprobado para 2027)» y muestra el Resto aprobado si lo hay. |
| Por línea, detalle y Matriz | Sin cambio de cálculo. El origen dice «20 % · HOMBRE · URBANO v2», «5 % · Resto v1» o «5 % · Resto provisional». |

## 4. Pantallas (solo admin y planner; formato `es-PE`; kit `Card`, `DataTable`, `Field`, `Badge`, `Alert`, `Modal`, `Tabs`)

### 4.1 `/planificacion/curvas-estacionalidad` → pestaña nueva **«Crecimiento por género × mundo»**

Es una pestaña más de M6, con el mismo flujo lista → detalle que las agrupaciones: `?gm=<g>.<m>|resto&anio=2027&proyeccion=` abre el detalle y sobrevive a recargar, y «← Género × mundo» vuelve a la lista.

**Lista.** Cabecera:
- selector de año de aplicación (por defecto, el año del último mes cerrado + 1);
- proyección de referencia: la en trabajo de `anio−1` con el `calculado_at` más reciente o, si no hay, la cerrada; se puede cambiar.
- texto fijo: «% bruto 2027 frente a 2026 de las mismas tiendas de 2027, sin corregir por el Niño; todas las filas del GM crecen igual».

Columnas: género · mundo · u. 2025 (mismas tiendas) · acumulado ene–set 2026 vs 2025 (bruto / sin Niño) · aplicado hoy en la proyección · base 2027 (`Σ B`) · **crecimiento 2027 aprobado** (vN, quién y cuándo) · estado (`Sin aprobar` · `Aprobado v2` · `Obsoleto: motivo`) · «Trabajar».
- Los géneros no detallados se ven agrupados bajo **Resto**, con «sigue al Resto».
- La fila **Resto** tiene sus propias cifras.
- La fila **Total** da el ponderado por `B` de lo aprobado (`calcularPromedio` de 07c).
- Columna **Simulación %**, solo local: recalcula el Total sin guardar nada y queda en `sessionStorage`.
- Filtros por estado y género; CSV.

**Detalle de un GM** (ejemplo: HOMBRE · URBANO, `Y = 2026`, `k = setiembre`):
1. **Curva de venta:**
   - gráfico SVG propio con `calcularGeometriaCurvas` de `src/lib/curvas/grafico.ts`: una línea por año, de 2023 a 2026; 2026 real en trazo continuo hasta setiembre y proyectado en discontinuo;
   - bandas del Niño por temporada con su factor, como en M6 y M7;
   - modos **Unidades / Forma (%) / Sin Niño**; en Forma se añade la **forma típica** (promedio de las participaciones de los años completos normales);
   - debajo, tabla año × mes con total, variación frente al año anterior y CSV;
   - leyenda: «Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026). 2023: 2 de ellas aún no abrían (meses marcados)».
2. **Cómo crece:** tabla de referencias (§5.1). Cada fila muestra periodo, tiendas, anterior, actual, % bruto, % sin Niño y «equivalente para 2027» (bruto · sin Niño + rebote), con la marca «frágil» cuando corresponde. Si `Y` fue Niño para el GM, un `Alert` dice: «2026 fue Niño en invierno: compara con las cifras sin Niño + rebote (+7,1 %)».
3. **Aprobar 2027:**
   - selector «Base» con las referencias y su variante, que precarga el % con su equivalente redondeado a 1 decimal;
   - campo «% bruto 2027» y, al lado, «equivale a x % sobre la base normalizada por el Niño»;
   - nota, obligatoria según R-N, con su motivo a la vista;
   - botón **«Aprobar v3»**, con un `confirm` que repite el %, la base, la diferencia y cuántas proyecciones en trabajo quedarán desactualizadas.
   - Respuestas `409`: `vigente_cambiada` y `datos_cambiados` recargan con su mensaje.
4. **Versiones:** vN, %, base y su valor, nota, quién y cuándo; «Ver foto» abre `referencia`.

**Detalle del Resto:** el mismo detalle, sobre la suma de los GM no detallados, con el desglose de la base por género.

### 4.2 Proyección → pestaña «Crecimientos» (solo lectura)

- **Alert de cabecera** si `crecimientos_cambiados`: «Los crecimientos aprobados cambiaron después de calcular: HOMBRE · URBANO v1 → v2 (12 % → 15 %). Recalcula», con el botón Recalcular.
- **Tabla por GM y Resto:** % aplicado (vN, quién y cuándo, de la foto) · vigente hoy · base `B` · 2027 resultante · % resultante · rebote del Niño · badges «2 con % propio» y «1 decidida con propuesta cambiada» con «Alinear…» · enlace «Analizar y aprobar» a `?gm=…&anio=…`.
- **Pie:** puente al Total 2027 y objetivo global editable (`calcularPromedio` y puente de 07c §5.2, sobre la foto).
- Cerrada o archivada: todo en solo lectura (incluido «Alinear»).

## 5. Reglas de negocio

### 5.1 Mismas tiendas y cifras de referencia (fórmulas exactas, en `referencias.ts`)

- **Red de un año `Z`:** `redComparable` de M6 sobre la venta total de cada tienda, sumada de `series`: tienda tipo Tienda y activa, abierta los doce meses de `Z` (o de enero a `k` si `Z = Y`) por fechas de M4 y con venta en cada mes por datos de M5.
- **Comparables de `Z−1` → `Z`:** `C(Z) = tiendasComunes(red(Z−1), red(Z))`. **Mismas tiendas del gráfico** = `C(Y)`, que es `M(Y)` sin los cierres de `Y`.
- **Aplicación (07c, sin cambio):** el % se aplica a `B`, la base de las mismas tiendas de `Y+1` (`M(Y+1)`: incluye la que abrió en `Y−1` y excluye los cierres de `Y+1`). La referencia compara siempre periodos iguales sobre tiendas iguales. Por eso la tienda que entra en `B` no entra en las cifras, y la pantalla lo dice.
- **Sin Niño:** `U'(Z,m) = Σ_temp U(temp,Z,m) ÷ φ_{temp,Z,m}`, con `factoresMes` (`nino.ts`) por temporada desde `periodos_atipicos` y el factor efectivo de `factores_volumen_atipico`. Si no hay factor: φ = 1 con el aviso `sin_factor`.
- **Rebote** `ρ = Σ B'' ÷ Σ B − 1`, de la proyección de referencia (07c `rebote_nino_pct`). **Equivalente para `Y+1`:** si la cifra es bruta, la misma; si es sin Niño, `(1 + g_sin)(1 + ρ) − 1`.
- **Frágil:** menos de 3 tiendas o menos de 120 u. en el periodo anterior. Con un denominador ≤ 0 la cifra es `null` y lleva su motivo.

| Referencia | Fórmula (tiendas) | Ejemplo HOMBRE · URBANO (invierno 2026 Niño φ = 0,80; 2025 normal) |
|---|---|---|
| **Acumulado** | `Σ_{m≤k} U(Y) ÷ Σ_{m≤k} U(Y−1) − 1` sobre `C(Y)` | 41 200 ÷ 40 000 → **+3,0 %** bruto; sin Niño (12 000 ÷ 0,80 + 29 200) ÷ 40 000 = 44 200 ÷ 40 000 → **+10,5 %**; equivalente 2027: 1,105 × 1,0713 → **+18,4 %** (ρ = 63 100 ÷ 58 900 − 1 = +7,1 %) |
| **Cierre proyectado** | `Σ vigente_Y` de las filas base del GM en la proyección de referencia ÷ `U(Y−1)` de sus mismas tiendas de `Y` (`parametros.bloques[Y].mismas`) − 1. Sin Niño, los `meses` de cada fila ÷ su `factores_mes` | 55 620 ÷ 54 000 → **+3,0 %**; sin Niño 59 620 ÷ 54 000 → **+10,4 %**; equivalente **+18,3 %** |
| **Año completo `Z`** (2024 y 2025) | `U(Z) ÷ U(Z−1) − 1` sobre `C(Z)`, cada una con sus propias tiendas | 2025: 52 500 ÷ 50 000 → **+5,0 %** (los dos años normales; equivalente sin Niño + rebote **+12,5 %**). 2024 frente a 2023 (Niño): +4,0 % bruto, −0,2 % sin Niño |
| **Aplicado hoy** | % efectivo de la foto de la proyección de referencia y «Crec. mismas tiendas» resultante; sin Niño `(1+g) ÷ (1+ρ) − 1` | Resto provisional 5 %: 58 900 → 61 845; sin Niño **−2,0 %** |

Con «Acumulado · sin Niño + rebote» (+18,4 %) como base, Javier escribe **15,0 %**. La diferencia es de 3,4 pp > 0,5, así que la nota es obligatoria («prudente: el rebote del invierno no será completo»). Aprueba v1, las proyecciones en trabajo de 2026 quedan con `crecimientos_cambiados` y, al recalcular, el GM da `round(58 900 × 1,15) = 67 735`.

### 5.2 Reglas que el código garantiza (cada una con su prueba en `tests/crecimientos.*.test.ts`)

1. **Una vigente:** como máximo una vigente por (año, alcance, GM); aprobar crea `version + 1` y reemplaza la anterior, que nunca se borra. Con `version_vigente` distinta se responde `409` sin escribir.
2. **R-N (nota):** es obligatoria si la base es `ninguna` o no se pudo calcular, o si `|pct − base_valor| > 0,5 pp`. Con el valor precargado no se exige.
3. **`sin_cambio`:** mismo `pct`, nota y base que la vigente → `409`.
4. **Géneros:** solo HOMBRE y MUJER (más el Resto) se aprueban; otro género da `400 genero_no_detallado` y un mundo inactivo da `400 mundo_inactivo`.
5. **Obsoleto, solo informativo:** se marca si la base elegida se movió `≥ 1,0 pp` frente a `base_valor` (por ejemplo, octubre publicado lleva el acumulado de +18,4 % a +16,9 %), si dejó de poder calcularse o si cambió la composición del GM (`gml_ids` de la foto ≠ los de hoy). Nunca cambia la vigente ni las proyecciones.
6. **Precedencia en M7:** fila > GM vigente > Resto vigente > `pct_defecto`. Una celda de un género no detallado no se aplica.
7. **Huella:** sin aprobaciones da el mismo texto que en `0.10.8`; con ids cambia aunque el % sea igual; no depende del orden.
8. **Aprobar no escribe** en `proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios` ni `proyeccion_crecimientos` (se prueba con un doble de la base).
9. **Cálculo y foto:** `ejecutarCalculo` escribe la foto y el Resto usado; una cerrada no cambia aunque se apruebe otra versión.
10. **Recalcular** limpia `crecimientos_cambiados` y conserva `decidido` y `crecimiento_pct`.
11. **Fórmulas de §5.1:** el ejemplo debe dar 3,0 / 10,5 / 18,4 / 5,0 / 12,5 / −2,0. `C(Y)` excluye la tienda nueva de `Y−1` y los cierres de `Y`. La serie sin Niño con φ = 1 es idéntica a la bruta.
12. **Contrato de la ruta `PUT`:** `PUT …/crecimientos` responde `410`.
13. **`alinear`:** primero `409 filas_manuales` con la `huella_choque`; con la huella, pisa solo la lista que se vio; sin `incluir_decididas` nunca toca un total.
14. **Cierre:** `crecimientos_sin_aprobar` y `crecimientos_cambiados` **no** se pueden forzar (bloquean siempre); `config_cambiada` sigue forzable.
15. **Permisos:** el comprador recibe `403` en las cinco rutas nuevas o cambiadas.

### 5.3 Casos borde

| Caso | Comportamiento |
|---|---|
| GM sin venta en la ventana | No aparece en la lista, salvo que tenga una versión aprobada o filas base de `Y+1` en la referencia (entonces muestra «sin venta comparable» y sus cifras quedan en `null`). |
| Pocas tiendas comparables | Marca «frágil»; no bloquea. |
| Tiendas nuevas de `Y` / de `Y−1` | Las de `Y` no entran en `C(Y)`. La de `Y−1` entra en `B` pero no en el acumulado, y la nota lo cuenta. |
| Cierres | El de `Y` sale de `C(Y)`. El de `Y+1` sí cuenta en las referencias, pero sale de `B` (07c). |
| Año del Niño | Bandas, versiones sin Niño y equivalente con rebote. Si `Y+1` está marcado atípico, se mantiene el aviso de 07c («tu % bruto debe incluirlo»). |
| Género fuera de HOMBRE y MUJER | Se puede analizar y no se aprueba: sigue al Resto. |
| Mundo desactivado | No se aprueba versión nueva. La vigente sigue aplicándose a los nodos de ese mundo y la lista la muestra «mundo desactivado». |
| Nodo que cambia de mundo | Su historia pasa al GM nuevo. Los dos GM quedan «obsoleto: composición» y las proyecciones, con `crecimientos_cambiados` (`gm_gml`). |
| Proyección en trabajo de antes de `0.12.1` | Con 0 celdas, la huella es igual y no se marca. Con celdas, queda desactualizada y el recálculo usa el global. |
| Sin proyección de referencia | «Cierre proyectado», «Aplicado hoy», `B` y el rebote muestran «—»; el resto funciona y se puede aprobar. |
| `k = diciembre` | El acumulado cubre el año completo. |
| Dos pestañas aprobando a la vez | `409 vigente_cambiada`. |

## 6. Criterios de aceptación (hito de Javier)

1. La pestaña nueva lista los GM con venta, su crecimiento aprobado y su estado. El comprador no ve la página y la API le responde `403`.
2. El detalle de un GM de invierno muestra las curvas de 2023 a 2026, con setiembre real y el resto proyectado, las bandas del Niño, los modos Unidades / Forma / Sin Niño, la tabla con totales y el CSV.
3. Las cuatro referencias aparecen con sus tiendas y en sus dos variantes. Se comprueba a mano una con §5.1.
4. **[ESCRIBE]** Aprobar 15 % con la base precargada sin nota se rechaza; con nota crea la v1 con su foto. Se aprueba el Resto con «Aplicado hoy» en un clic.
5. La proyección en trabajo pasa a «desactualizada: crecimientos» y no se puede cerrar ni forzando. Recalcular la deja al día, con el GM en +15,0 % en «Crec. mismas tiendas» y ninguna decisión perdida.
6. La pestaña Crecimientos de la proyección no permite editar, muestra «HOMBRE · URBANO v1 · 15 % · Javier · fecha» y su enlace abre el detalle. «Alinear…» pregunta antes de pisar.
7. Una proyección cerrada no cambia al aprobar la v2.
8. Pasan `lint`, `tsc`, `vitest` y `build`; la `0027` corre dos veces seguidas (idempotente); `venta_genero_mundo` ≤ 3 s en frío, medido y anotado; `APP_VERSION = "0.12.1 · M6"`.

## 7. Fuera de alcance

Crecimiento en soles o por precio y mix (todo va en unidades; la venta nunca incluye IGV); referencia de últimos 12 meses móviles; aprobar géneros distintos de HOMBRE y MUJER; retirar un crecimiento detallado (para volver al Resto, se aprueba el mismo % que el Resto con nota); sugerencias automáticas de % (las referencias solo informan: decisión 33); crecimiento del año en curso o de las aperturas; aprobación en bloque; panel de tiendas elegible a mano.

## Plan de tandas (sin pisarse)

| Tanda | Agente | Archivos (exclusivos) | Depende de |
|---|---|---|---|
| 1 | `backend` | **Primero** `src/lib/crecimientos/tipos-api.ts` y `esquemas.ts`; en `src/lib/proyeccion/tipos-api.ts`, `ResumenCrecimientosProyeccionApi` y `AlinearCuerpo`. Se commitean solos y desbloquean al frontend | — |
| 1 | `datos` | `supabase/migrations/0027_crecimientos_genero_mundo.sql`, `scripts/humo-0027.sql`, `src/lib/supabase/database.types.ts`; aplicar en `vector-two`; medir la función | — |
| 2 | `backend` (A) | `src/lib/crecimientos/{comparables,series,referencias,reglas,huellas,consultas,servicio,cache}.ts`, `src/app/api/curvas/genero-mundo/**`, `tests/crecimientos.*` | tanda 1 |
| 2 | `backend` (B) | `src/lib/proyeccion/{servicio,servicio-base,servicio-crecimientos,consultas,huellas-crecimientos,reglas,desactualizado,esquemas}.ts`, `src/app/api/proyeccion/proyecciones/[id]/crecimientos/**` (incluye `alinear/`), `tests/proyeccion.crecimientos*` | tanda 1; importa `leerCrecimientosVigentes` y `crecimientoParaM7` de A (los escribe A primero, solo con firma) |
| 2 | `frontend` (A) | `src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/**` y el alta de la pestaña en `curvas-panel.tsx` | tipos de tanda 1 |
| 2 | `frontend` (B) | `src/app/(app)/planificacion/proyeccion/{crecimientos-tab,crecimientos-vista,choque-modal,formulario-proyeccion,bloque-decision,detalle-fila,antes-de-proyectar}.tsx/.ts` | tipos de tanda 1 |
| 3 | `qa` → `seguridad` (sonnet) → `documentador` | CHANGELOG, PLAN, DECISIONES, esta ficha, `src/lib/version.ts` | tanda 2 |

**Orden con M8:** `0.12.1 · M6` sale antes de `0.13.0 · M8`. Los dos solo comparten `database.types.ts`, `version.ts` y CHANGELOG: se regeneran y se suben de forma secuencial. M8 no lee crecimientos y su contrato (`leerProyeccionCerrada`, `VERSION_METODO_MIN_M8 = 4`) no cambia.

**Propuestas para `docs/DECISIONES.md`:**
1. El crecimiento del año siguiente por GM y el Resto son supuestos globales versionados por año, que se aprueban en M6 y que M7 lee; reemplaza la matriz por proyección de 07c.
2. `proyeccion_crecimientos` y `crecimiento_resto_usado` son la foto de lo aplicado: B2 y las cerradas leen la foto.
3. Las referencias usan comparables por par de periodos (`C(Z)`) y el % se sigue aplicando sobre `B` (`M(Y+1)`).
4. `VERSION_METODO` no sube.
5. El Modal de choque se traslada a «Alinear» en la proyección.

## Decisiones de Javier sobre las preguntas abiertas (2026-10-27)

1. **Cerrar sin crecimiento aprobado de HOMBRE o MUJER, o con el Resto provisional: se bloquea sin excepción.** `crecimientos_sin_aprobar` no se puede forzar.
2. **Géneros aprobables: solo HOMBRE y MUJER, más el Resto.** Los demás géneros con venta se analizan y se ven igual, pero siguen al Resto.

# 06d · Curva y crecimiento del año siguiente por género × mundo (global y versionado)

> Estado: **ajustada el 2026-10-27 con la revisión independiente del `arquitecto-revisor` (opus): 1 bloqueante (B1), 7 importantes (I1–I7) y 12 menores (M1–M12), todos incorporados; lista para construir.** Amplía M6 ([06b](06b-curvas-trabajo-por-agrupacion.md), [06c](06c-curvas-composicion-y-curva-usuario.md)) y cambia la fuente del crecimiento de M7 ([07c](07c-crecimientos-por-genero-mundo.md)), sin tocar su método numérico. Versión prevista **`0.12.1 · M6`**, commits `M6:`, migración **`0027_crecimientos_genero_mundo.sql`** (§2.5). Cifras sintéticas; los géneros y mundos son los del seed de `0001`; tiendas `T01…`. Los únicos agregados reales citados son los que midió el revisor sobre la base (§2.4, I1, I4, I7).

## 1. Objetivo

Javier no quiere reescribir el crecimiento dentro de cada proyección: quiere **analizar la curva de venta de cada género × mundo (GM) de las mismas tiendas** y, desde ahí, **aprobar una sola vez** el crecimiento bruto de mismas tiendas del año siguiente. Este módulo añade a Curvas de estacionalidad una herramienta de análisis por GM (curva mensual por año, forma, nivel, cifras de referencia con y sin Niño) y un **supuesto global y versionado** por GM y año (más el **Resto**), con nota, quién y cuándo, que **todas las proyecciones leen**. Si cambia, las proyecciones que lo usaron quedan desactualizadas; nada se recalcula solo ni se pisa lo decidido.

## 2. Modelo de datos (`0027`)

### 2.1 Tabla nueva `crecimientos_genero_mundo` (una fila por versión)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `anio_aplicacion` | `integer not null`, `check between 2024 and 2100` | El año al que se aplica (`Y+1`, p. ej. 2027). Un supuesto por año: el de 2028 se aprueba aparte. |
| `alcance` | `text not null` | `gm` o `resto` (todo lo no detallado, §2.3). **Sin `check` de catálogo** (I6): lo valida zod. Así un alcance futuro (p. ej. por género) no exige `drop constraint`, que las migraciones no admiten (mismo criterio que `0019`, `0020` y `0024`). |
| `genero_id`, `mundo_id` | `uuid null → generos / mundos on delete restrict` | Dos `check` que no cierran el catálogo: `check (alcance <> 'gm' or (genero_id is not null and mundo_id is not null))` y `check (alcance <> 'resto' or (genero_id is null and mundo_id is null))`. Qué géneros son detallables lo valida la API (un `check` por nombre no cabe). |
| `version` | `integer not null check (version >= 1)` | 1, 2, 3… por (año, alcance, GM). La nueva es `max(version) + 1` de la clave (M4). |
| `estado` | `text not null default 'vigente'`, `check (estado in ('vigente','reemplazada','retirada'))` | Igual que `curvas_estacionalidad_estado_check` de la `0015` (I6): `retirada` entra desde ya aunque `0.12.1` no la use (retirar un GM está fuera de alcance), para no tener que ampliar el `check` después. Nunca se borra una versión. |
| `pct` | `numeric(6,2) not null`, `check between -95 and 500` | **% bruto** `Y+1 ÷ Y − 1` de las mismas tiendas de `Y+1`, sin corregir por el Niño (07c §2.4). Mismo rango que `crecimiento_pct`. |
| `nota` | `text null`, `check (nota is null or char_length(nota) <= 300)` | Obligatoria según la regla R-N (§5.2). |
| `base_tipo` | `text not null` | `acumulado`, `cierre_proyectado`, `anio_completo`, `aplicado_hoy` o `ninguna`. **Sin `check` de catálogo** (I6): lo valida zod (`BASES`). |
| `base_valor` | `numeric(8,2) null` | Su valor **bruto-equivalente para `Y+1`** al aprobar (§5.1); `null` con `ninguna` o si no era calculable. |
| `referencia` | `jsonb not null`, `check (jsonb_typeof(referencia)='object')` | Foto de lo que vio: todas las cifras de §5.1 (bruto, sin Niño, equivalente, extremo, tienda mayor, cobertura), tiendas y `k`, rebote, `huella_datos`, composición del GM (`gml_ids`) y la proyección de referencia (id, nombre, `calculado_at`, `version_metodo`). Con ella se explica la versión sin releer venta. |
| `proyeccion_referencia_id` | `uuid null → proyecciones on delete set null` | Con índice (el `set null` no recorre la tabla). |
| `perfil_id` (`→ perfiles on delete set null`), `usuario_nombre`, `aprobada_at timestamptz not null default now()` | | Quién y cuándo (decisión 33), como en `curvas_estacionalidad`. |
| `activo`, `created_at`, `updated_at` | | Convención; `activo` sin uso. Trigger `tg_set_updated_at`. |

Índices: único `(anio_aplicacion, alcance, coalesce(genero_id, '00000000-0000-0000-0000-000000000000'), coalesce(mundo_id, '0000…'), version)`; **único parcial de vigente** sobre las mismas columnas sin `version` `where estado = 'vigente'` (una sola vigente por GM y año; `coalesce` en vez de `nulls not distinct` para no depender de la versión de Postgres); índices simples por `genero_id`, `mundo_id` y `proyeccion_referencia_id`. RLS activo sin políticas; `revoke all … from public, anon, authenticated` y `grant … to service_role`; `comment on`.

### 2.2 `proyeccion_crecimientos` pasa a ser la **foto de lo aplicado**; el Resto usado va en `parametros`

La tabla no se borra, pero desde `0.12.1` sus filas ya no las escribe el planner: **cada cálculo** de la proyección las reescribe con los crecimientos por GM que usó (borra las que sobran e inserta las vigentes). La `0027` añade `crecimiento_id uuid null → crecimientos_genero_mundo on delete restrict` (con índice) y `version integer null check (version is null or version >= 1)`; `pct`, `nota`, `perfil_id` y `usuario_nombre` se copian de la versión global (quién la aprobó). Filas con `crecimiento_id null` = celdas escritas en `0.10.8` (hoy 0): siguen valiendo para B2 hasta el primer recálculo, que las reemplaza.

El **Resto usado** va en `parametros.crecimiento_resto_usado` (clave nueva del `jsonb`, sin migración):

```ts
// src/lib/proyeccion/tipos-api.ts (tanda 1), dentro de ParametrosProyeccion
crecimiento_resto_usado?: { pct: number; crecimiento_id: string | null; version: number | null; por_nombre: string | null; at: string | null };
```

`crecimiento_id = null` = el cálculo usó el **Resto provisional** (`crecimiento_pct_defecto`). Sin la clave (proyecciones calculadas antes de `0.12.1`), el Resto de la foto es `crecimiento_pct_defecto`, que es justamente lo que usaron.

**`parametrosDe` debe dejar pasar la clave (B1).** Hoy `parametrosDe` (`servicio-base.ts:65-82`) solo copia claves conocidas, y `editarProyeccion` (`servicio.ts:424` y `:467`) reescribe el `jsonb` completo desde `parametrosDe`: sin este cambio, el primer `PATCH` de un umbral borraría `crecimiento_resto_usado` y B2 volvería al Resto provisional. Se añade `...(o.crecimiento_resto_usado && typeof o.crecimiento_resto_usado === "object" && typeof o.crecimiento_resto_usado.pct === "number" ? { crecimiento_resto_usado: o.crecimiento_resto_usado } : {})`. `crecimiento_resto_meta` (07c) se sigue leyendo para no perder lo viejo, pero ya nadie la escribe.

**`base_siguiente` y `base_normalizada` se conservan y se siguen escribiendo:** son `B` y `B''`, los pesos y el rebote que lee la pantalla nueva.

**Migración de valores:** ninguna en SQL (sin `UPDATE`, `INSERT` ni backfill). Hoy hay 0 celdas guardadas y el Resto es `crecimiento_pct_defecto`, que sigue siendo el **Resto provisional** de cada proyección mientras no haya un Resto aprobado para su año. Si `datos` encuentra celdas guardadas al aplicar la `0027`, las informa y Javier las aprueba en la pantalla (nunca se copian solas).

### 2.3 Géneros detallados

Se aprueban por GM **solo HOMBRE y MUJER** (`GENEROS_DETALLADOS = GENEROS_MATRIZ`, resueltos por nombre con `generosDeMatriz`, como en 07c §2.5). Todo lo demás sigue el **Resto**. La pantalla **analiza todos los géneros con venta** (sale de la misma lectura), pero en los demás géneros el campo de aprobación no aparece («sigue al Resto»). **Por qué:** se mantiene la decisión 3 de 07c, los géneros chicos tienen pocas tiendas y cifras ruidosas, y abrir uno más luego es cambiar una constante: la tabla ya acepta cualquier `genero_id`.

### 2.4 Función `venta_genero_mundo(p_desde date) returns jsonb`

Ninguna función existente sirve. `venta_estacionalidad_agrupacion` (`0017`) corta por agrupación, `venta_composicion_agrupacion` (`0022`) por GML dentro de una agrupación y por red, `unidades_mensuales` (`0014`) no trae tiendas, y `venta_proyeccion` (`0018`/`0021`) va por tandas de nodos con marca y talla (demasiado pesada). La nueva es `language sql`, `stable`, `security invoker`, `search_path = ''`, y su cuerpo va sin comentarios `--`. Permisos explícitos, como la `0017` (M11): `revoke execute on function public.venta_genero_mundo(date) from public, anon, authenticated;` y `grant execute … to service_role;`. En una sola sentencia devuelve:

```jsonc
{ "series": [ { "g": "<genero_id>", "m": "<mundo_id>", "temp": "invierno|verano|todo_el_ano|sin_agrupacion", "t": "<tienda_id>",
                "u": { "2023-01": 120, "2023-02": 98, … } } ],    // unidades netas, solo tiendas tipo Tienda, periodo ≥ p_desde
  "cargas": { "2023-01": "<carga_id>", … } }                     // mismo CTE que 0017: huella de cargas coherente
```

El GM sale del **árbol vigente** (`equivalencias → genero_mundo_linea`): si un nodo cambia de mundo, se lleva su historia. La temporada es la de la agrupación activa de la equivalencia, igual que la `0017`. Va en `jsonb` porque supera las 1 000 filas de PostgREST.

**Medido por el revisor (`explain analyze`, datos reales de `vector-two`):** 1,94 s en la forma ingenua (el `sort` derrama unos 28 MB); **1,63 s agregando primero por (equivalencia, tienda, periodo)** y luego subiendo a GM. `datos` escribe la función con esa preagregación. Resultado: 609 grupos, 19 213 celdas tienda × mes, 384 KB de texto (538 KB de `jsonb`), 36 GM, 0 filas sin GM y 0 meses netos negativos. Presupuesto: **≤ 3 s en frío**, techo duro en el `statement_timeout` de 8 s; `datos` vuelve a medir con `explain (analyze, buffers)`, dos pasadas, y lo anota. **Plan B** (`p_desde` = enero de `Y−3`): hoy no ahorra nada (45 meses publicados desde 2023-01); queda como palanca si la historia crece.

**Caché** (`src/lib/crecimientos/cache.ts`, patrón de `cache-venta.ts`: TTL 120 s, 2 entradas, 1 lectura simultánea, congelado en profundidad). Clave (M1): `p_desde | huella de cargas | max(updated_at) de genero_mundo_linea | max(updated_at) de equivalencias | max(updated_at) de agrupaciones_estacionalidad`. Sin las tres marcas de tiempo, mover un nodo de mundo o cambiar la agrupación de una equivalencia serviría la lectura vieja durante 120 s. Las tres lecturas son de una fila cada una (`order by updated_at desc limit 1`).

### 2.5 Numeración

La siguiente libre por archivo es la `0025`, pero la ficha 08 nombra la `0025` (M8) y la `0026` (M9a) en muchos lugares. Esta toma la **`0027`**. No hay conflicto técnico: la `0027` depende de `0001` (géneros y mundos), `0003` (perfiles y `tg_set_updated_at`), `0007` (cargas y `venta_stock_vigente`), `0015` (agrupaciones), `0018` (proyecciones y `proyeccion_crecimientos`) y `0023` (las columnas de 07c), todas anteriores; y es idempotente. Si se aplica antes que la `0025`, el orden en la base no coincide con el de los archivos, pero ninguna de las dos depende de la otra y `validar-migraciones-local.sh` las reproduce en orden de archivo. (Se consideró tomar la `0025` y renumerar M8, M9: funciona igual, pero obliga a reescribir la ficha 08; no compensa.)

## 3. Contratos de API

Todo con `requirePlanner` (el comprador recibe `403`; sin sesión, `401`), `{ data }` / `{ error, codigo }`, `leerCuerpo`, `traducirErrorDb`. Código en `src/lib/crecimientos/` y rutas en `src/app/api/curvas/genero-mundo/`. `clave` = `resto` o `<genero_id>.<mundo_id>`.

| Ruta | Método | Entrada | Respuesta · errores |
|---|---|---|---|
| `/api/curvas/genero-mundo` | GET | `?anio=2027&proyeccion=<id>` (opcionales) | `ListaGeneroMundoApi` · `400` · `409 sin_datos` (ningún mes publicado y cerrado) |
| `/api/curvas/genero-mundo/[clave]` | GET | `?anio=&proyeccion=` | `DetalleGeneroMundoApi` · `400 clave_invalida` · `400 anio_no_permitido` · `404` |
| `/api/curvas/genero-mundo/[clave]` | POST | `aprobarCrecimientoSchema` | `201 { vigente: VersionCrecimientoApi, proyecciones_desactualizadas: { id, nombre }[] }` · `400` (zod, `anio_no_permitido`, `referencia_otro_anio`, `genero_no_detallado`, `mundo_inactivo`) · `409 datos_cambiados` · `409 vigente_cambiada` · `409 sin_cambio` · `409 nota_requerida` (orden de M6) |

**`GET /api/curvas/genero-mundo/vigentes` se quita de `0.12.1`** (decisión de Javier sobre la pregunta 4 del revisor): no tenía consumidor. M7 lee los vigentes en el servidor con `leerVigentes` (§3.1) y M8 no lee crecimientos.

```ts
// src/lib/crecimientos/esquemas.ts (tanda 1)
import { CARACTERES_PROHIBIDOS_NOTA } from "@/lib/curvas/esquemas";   // hoy es privada (esquemas.ts:324): la tanda 1 la exporta (M3)
export const BASES = ["acumulado", "cierre_proyectado", "anio_completo", "aplicado_hoy", "ninguna"] as const;
export const notaCrecimientoSchema = z.string("La nota debe ser texto.").trim().max(300, "La nota no puede superar 300 caracteres.")
  .refine((v) => !CARACTERES_PROHIBIDOS_NOTA.test(v), "La nota no puede llevar saltos de línea ni caracteres de control o de dirección de texto.");
export const aprobarCrecimientoSchema = z.object({
  anio: z.number().int().min(2024).max(2100),               // además, el servidor exige un año permitido (M3, abajo)
  pct: crecimiento,                                         // −95..500, el de src/lib/proyeccion/esquemas.ts
  nota: notaCrecimientoSchema.nullable(),                   // "" tras trim → null
  base: z.object({
    tipo: z.enum(BASES),
    anio: z.number().int().min(2023).max(2100).nullable(),  // obligatorio con anio_completo; null con los demás (superRefine)
    variante: z.enum(["bruto", "sin_nino_mas_rebote"]),
  }).strict(),
  proyeccion_referencia_id: z.uuid().nullable(),
  huella_datos: z.string().min(1).max(128),                 // la del GET (bloqueo optimista, patrón M6)
  version_vigente: z.number().int().min(1).nullable(),      // null = «no había vigente»; si no coincide → 409 vigente_cambiada
}).strict().superRefine(/* base.anio obligatorio sii tipo = anio_completo */);
```

**Validaciones del servidor (M3):**
- `anio` ∈ {año del último mes cerrado + 1} ∪ {`anio_en_curso + 1` de cada proyección en trabajo}; si no, `400 anio_no_permitido`. Ejemplo: con setiembre de 2026 cerrado y la 2026 en trabajo, solo 2027.
- `proyeccion_referencia_id`, si viene, debe existir y ser de `anio_en_curso = anio − 1`; si no, `400 referencia_otro_anio`. Si es de un método anterior al 4, se acepta, pero sus referencias son `null` (I1).
- `base.tipo = anio_completo` exige `base.anio` ∈ {`Y−1`, `Y−2`} con datos; si no, `400`.

**Aprobar** (sin función SQL: las migraciones no admiten `UPDATE` ni dentro del cuerpo de una función):
1. El servidor recalcula el detalle desde la caché y compara `huella_datos` (`409 datos_cambiados`).
2. Valida el género (`400 genero_no_detallado`) y el mundo: un mundo inactivo da `400 mundo_inactivo` **salvo** que el GM tenga filas base en alguna proyección en trabajo de `anio − 1` (algún valor de `resumen.gm_gml` es esa clave): entonces se aprueba (I3), porque esa proyección no podría cerrarse sin él.
3. Valida R-N (`409 nota_requerida`) y `sin_cambio` (regla 3, M4).
4. Pasa la vigente a `reemplazada` con `UPDATE … where id = ? and estado = 'vigente'`; 0 filas → `409 vigente_cambiada`.
5. Inserta la versión `max(version) + 1` de la clave (M4), con su foto `referencia`. Si el insert falla, restaura la anterior a `vigente`.
6. Responde con `proyecciones_desactualizadas` = las proyecciones en trabajo de `anio − 1` (toda versión nueva cambia su huella, §3.1).

Queda la misma ventana de milisegundos sin vigente que ya existe en M6 y M12. Un cálculo que caiga en ella usa el Resto o el GM anterior, deja su huella y queda «desactualizado». **No escribe en ninguna proyección.**

**Tipos** (`src/lib/crecimientos/tipos-api.ts`, tanda 1):
- `VersionCrecimientoApi = { id, version, estado, pct, nota, base: { tipo, anio, variante, valor }, por_nombre, aprobada_at, proyeccion_referencia: { id, nombre } | null }`.
- `ReferenciaApi = { tipo, anio, variante_defecto, etiqueta, periodo, tiendas, anterior, actual, pct_bruto, pct_sin_nino, equivalente: { bruto, sin_nino_mas_rebote }, fragil, extremo, tienda_mayor: { codigo, aporte_pct, pct_sin_ella } | null, cobertura_pct: number | null, motivo_nulo: "sin_referencia" | "metodo_anterior" | "sin_base" | "denominador_cero" | "sin_venta" | null }` (I1, I7).
- `FilaGMApi = { clave, genero, mundo, detallable, mundo_activo, unidades_anterior, acumulado: ReferenciaApi, aplicado_hoy: ReferenciaApi, base_siguiente: number | null, vigente: VersionCrecimientoApi | null, estado: "sin_aprobar" | "aprobado" | "obsoleto", motivo_obsoleto: "base_movida" | "base_no_calculable" | "composicion" | null, sigue: "propio" | "resto" }`.
- `ListaGeneroMundoApi = { anio_aplicacion, anios_permitidos, anio_en_curso, ultimo_mes_cerrado, proyeccion_referencia: { id, nombre, calculado_at, version_metodo } | null, proyecciones_disponibles, filas: FilaGMApi[], resto: FilaGMApi, total: { pct_ponderado: number | null, base: number, sin_aprobar: number }, huella_datos }`.
- `DetalleGeneroMundoApi = { …FilaGMApi, tiendas: { n, ids, fuera: { tienda_id, motivo }[] }, series: { anio, meses, meses_sin_nino, origen /* 'real' | 'proyectado' | null */, incompleto, total, total_sin_nino, forma }[], forma_tipica, bandas_nino: { anio, temporada, meses, factor, parcial }[], factores_parciales: boolean, referencias: ReferenciaApi[], rebote_nino_pct, versiones: VersionCrecimientoApi[], avisos, huella_datos }`.

### 3.1 Lectura desde M7 (el método numérico no cambia) — diseño de B1

**Precedencia (sin cambio de fórmula):** fila con % propio > **GM aprobado vigente** (solo géneros detallados) > **Resto aprobado vigente** > `crecimiento_pct_defecto` (Resto provisional de la proyección). La aplicación sigue siendo `crearCrecimientoDe` (07c), sin tocar `crecimientoEfectivo`.

**Piezas compartidas (tanda 1, `src/lib/crecimientos/`):**
- `consultas-vigentes.ts` → `leerVigentes(db, anios: number[]): Resultado<VigenteCrecimiento[]>` (una lectura para varios años, M6).
- `vigentes.ts` (puro) → `matrizDeVigentes(vigentes, generosDetallados): MatrizCrecimientos` (con ids, versiones y Resto), `restoEfectivo(vigentes, pctDefecto): RestoUsado`, `gmExigidos(gm_gml, generosDetallados): { gm: string[]; resto: boolean }` (I4) y `faltantesDeCierre(exigidos, vigentes): { gm: string[]; resto_provisional: boolean }`.

**`MatrizCrecimientos` se amplía sin romper a nadie** (`src/lib/proyeccion/crecimientos.ts`, backend B): `{ celdas, generos, ids?: ReadonlyMap<claveGM, string>, versiones?: ReadonlyMap<claveGM, number>, resto?: { id: string | null; version: number | null } }`. Las tres claves nuevas son opcionales: `MATRIZ_SIN_CELDAS`, `matrizDeCeldas` y los literales de las pruebas siguen compilando. `crearCrecimientoDe` añade a `CrecimientoDeFila` `version?: number | null` y `provisional?: boolean` (opcionales: los literales de `decision.ts:280` y `:502` no cambian).

**Escritura: el cálculo lee el global** (`ejecutarCalculo` → `calcularYGuardar`, `servicio.ts`):
1. En lugar de `leerCrecimientos(d, proy.id)` (`servicio.ts:698`), lee `leerVigentes(d, [Y + 1])` y arma `matriz = matrizDeVigentes(...)` y `resto = restoEfectivo(vigentes, parametros.crecimiento_pct_defecto)`.
2. Llama a `calcularProyeccion` con `parametros.crecimiento_pct_defecto: resto.pct` (el **Resto efectivo**, aprobado o provisional) y `crecimientos: matriz`. Por eso **`calculo.ts` no cambia**: `gDefecto` (`calculo.ts:166`) ya es el Resto efectivo, el contexto del modelo (`:319`, `:325`) lo hereda, y la huella (`:976`, `huellaDeMatriz(matriz, gDefecto)`) toma los ids de la propia matriz.
3. `nuevosParametros` conserva `crecimiento_pct_defecto` tal como estaba (el provisional nunca se sobrescribe con el aprobado) y añade `crecimiento_resto_usado = { pct: resto.pct, crecimiento_id, version, por_nombre, at }`.
4. Dentro del mismo candado, después de `guardarCalculo` y antes de `guardarResultadoCalculo`, reescribe la foto en `proyeccion_crecimientos` (`escribirFotoCrecimientos` en `consultas.ts`: `upsert` de los GM vigentes con `crecimiento_id` y `version`, y borrado de los que sobran). Si falla, el cálculo responde con error y el candado se libera como en cualquier otro fallo (sin transacción: recalcular lo repara).

**Lectura: B2, explicaciones y respuestas leen la foto:**
- `cargarMatriz(db, p: ProyeccionDb): Salida<{ matriz: MatrizCrecimientos; resto: RestoUsado }>` (`servicio-base.ts:240`): `matriz` de las filas de `proyeccion_crecimientos` (con `crecimiento_id` y `version`); `resto = parametros.crecimiento_resto_usado ?? { pct: parametros.crecimiento_pct_defecto, crecimiento_id: null, version: null, … }`.
- `contextoModelo(..., foto)` (`servicio-base.ts:155`): `crecimiento_pct_defecto: foto.resto.pct` y `crearCrecimientoDe({ matriz: foto.matriz, resto: foto.resto.pct, … })`. El campo `ContextoModelo.crecimiento_pct_defecto` conserva su nombre; desde `0.12.1` lleva el **Resto de la foto**, de modo que los respaldos de `decision.ts:280`, `:502` y `:555` usan el Resto correcto **sin tocar `decision.ts`**. Llamadores: `servicio-edicion.ts:184-186` y `:458-460`.
- `crecimientoParaApi(foto.matriz, foto.resto.pct, catalogo)`: `crecimientoDeLectura` (`servicio-lectura.ts:35-37`).
- La explicación de la tienda (`servicio-edicion.ts:509`): `crecimiento: crec?.pct ?? foto.resto.pct`.
- `conCamposBrutos` (`persistencia.ts:340`) pasa `version` y `provisional` a `crecimiento_efectivo`, para el texto «20 % · HOMBRE · URBANO v2».

**Huella:** `huellaCrecimientos` agrega `#<crecimiento_id>` a la línea de cada GM y a la del Resto **solo si hay id**. Sin aprobaciones, el texto es idéntico al de `0.10.8` (`md5("resto=20")`, verificado por el revisor), así que el despliegue no marca nada. Aprobar una versión, aunque tenga el mismo valor, marca las proyecciones en trabajo de ese año (la foto debe decir quién decidió). `huellaDeMatriz(matriz, resto)` lee los ids de `matriz.ids` y `matriz.resto`.

**Desactualización:** `desactualizadaDe` arma `CrecimientosActuales.huella = huellaDeMatriz(matrizDeVigentes(vigentes de Y+1), restoEfectivo(...).pct)` y recibe los vigentes como opción (`o.vigentes`), en lugar de `o.celdas`. `leerEstadoInicial` los lee **una sola vez por año** de las proyecciones en trabajo (M6), no una por proyección. `crecimientosCambiados` y el motivo `crecimientos_cambiados` (`desactualizado.ts`) **no cambian**, y siguen sin poder forzarse al cerrar. Recalcular lo limpia y nunca toca `decidido` ni `crecimiento_pct`.

**Cierre:**
- Motivo nuevo **bloqueante, sin excepción (decisión de Javier)** `409 crecimientos_sin_aprobar`, en `motivoRechazoCerrar` (`reglas.ts`), después de `version_metodo` y `crecimientos_cambiados` y antes de las filas sin decidir. No se salta con `forzar`.
- **Qué GM se exigen (I4):** el conjunto es el de los valores distintos de `resumen.gm_gml` de la proyección cuyo género es HOMBRE o MUJER, **más el Resto** si algún valor de `gm_gml` es de otro género. Un GM con venta pero sin filas base no se exige. Hoy son 10 GM con filas base (más el Resto: 11 aprobaciones, según la medición del revisor).
- Bloquea si alguno de esos GM no tiene versión vigente, o si se exige el Resto y no hay Resto aprobado (el provisional no basta). Mensaje: «Faltan 3 crecimientos aprobados para 2027 (HOMBRE · URBANO, MUJER · RI, MUJER · DEPORTIVO) y el Resto es provisional: apruébalos en Curvas de estacionalidad → Crecimiento por género × mundo», con `detalle = { faltan: { clave, nombre }[], resto_provisional }`.
- **Carrera cerrar/aprobar (M5):** en la relectura posterior al `UPDATE` de cierre (`pendientesDeCierre`, `servicio.ts:944`) se vuelven a leer los vigentes. Si la huella de hoy ≠ `resumen.huella_crecimientos` o hay faltantes, se revierte el cierre (y el archivado) y responde `409 crecimientos_cambiados` o `409 crecimientos_sin_aprobar`. Cuesta una lectura pequeña.
- `ProyeccionApi` gana `crecimientos_sin_aprobar?: { faltan: { clave, nombre }[]; resto_provisional: boolean } | null` (solo en trabajo; `null` si no falta nada), calculado con los mismos vigentes que la desactualización, para deshabilitar «Cerrar proyección» sin esperar al `409`.
- «Antes de proyectar» (`prerrequisitos`, `desactualizado.ts`) añade un **aviso** (no bloqueo) `crecimientos_sin_aprobar_anio`: «Para cerrar necesitarás aprobados los crecimientos de HOMBRE y MUJER por mundo y el Resto de 2027 (hoy: 4 GM aprobados; el Resto es provisional).»

**`VERSION_METODO` sigue en 4.** La fórmula, la precedencia y el reparto son los mismos; cambia la fuente del %, y eso lo cubre la huella. Subirla obligaría a recalcular sin necesidad y no aportaría nada a M8 (`VERSION_METODO_MIN_M8 = 4`).

### 3.2 Qué se quita o cambia de lo construido en `0.10.8`

| Pieza | Decisión |
|---|---|
| Pestaña «Crecimientos» (`crecimientos-tab.tsx`) | Se **reemplaza** en el mismo lugar y con la misma URL (`?pestana=crecimientos`) por el resumen de solo lectura (§4.2). Desaparecen la matriz editable, el campo Resto, «Guardar y recalcular» y «Calcular promedio» sobre un borrador. |
| `GET …/proyecciones/[id]/crecimientos` | Se mantiene con otra forma: `ResumenCrecimientosProyeccionApi` (§4.2). |
| `PUT …/crecimientos` | Responde **`410 crecimientos_globales`** («Los crecimientos se aprueban en Curvas de estacionalidad → Crecimiento por género × mundo») después de `requirePlanner` y **sin leer el cuerpo**. Así una pestaña vieja abierta no escribe. `guardarCrecimientosSchema` (`esquemas.ts:158`) y `guardarCrecimientos` se retiran. |
| Modal Pisar / Conservar / Cancelar (`choque-modal.tsx`) | **Se retira** (decisión de Javier sobre la pregunta 1 del revisor: «Alinear…» no entra en `0.12.1`). Hoy hay 0 filas con % propio y 4 decididas; aprobar en el global nunca toca filas, así que «Conservar» es lo único que ocurre. Para que una fila siga al aprobado: en Por línea se vacía su campo «Crec.» (% propio) o se usa «Volver a la propuesta» (total decidido), fila a fila. También se retiran `filasEnChoque`, `huellaChoque`, `huellaMatriz` y `pisarRegistros`, que se quedan sin uso. |
| `PATCH` de parámetros | `400 usar_crecimientos` con el texto nuevo («El Resto provisional solo se fija al crear la proyección; el Resto aprobado se aprueba en Curvas de estacionalidad → Crecimiento por género × mundo»). `crecimiento_objetivo_pct` pasa a `parametrosSchema` (editable por `PATCH`, `−95..500` o `null`) y **no marca `recalculo_pendiente`** (M2): se excluye de la comparación de `servicio.ts:437`, igual que `bloques` y `factores_usados`, y no entra en `ediciones`. |
| `copiar_de` | Ya no copia celdas (se retira el bloque de `servicio.ts:357-378`): el primer cálculo escribe la foto desde el global. Sigue copiando el objetivo. |
| Formulario «Nueva proyección» | El campo pasa a «Resto provisional (%)», con la ayuda «Se usa solo mientras no haya un Resto aprobado para 2027» y, si lo hay, «Resto aprobado para 2027: 5 % (v1)». Al editar no se muestra el campo; se muestra el Resto de la foto con su origen. |
| Por línea, detalle y Matriz | Sin cambio de cálculo. El origen dice «20 % · HOMBRE · URBANO v2», «5 % · Resto v1» o «5 % · Resto provisional» (`textoOrigenCrecimiento`). La ayuda del campo «Crec.» dice «Vacío = el aprobado de HOMBRE · URBANO (20 %)». |
| «Simulación %» | **No existía** en ninguna pantalla construida (se buscó en todo `src/`): era una columna prevista de la lista nueva y se quita de `0.12.1` (pregunta 4). Lo que sí desaparece de lo visible es «Calcular promedio» sobre un borrador editable de la pestaña vieja (ya decidido arriba). En su lugar, la fila Total de la lista nueva (§4.1) y la de la pestaña de solo lectura (§4.2) dan el ponderado de lo aprobado y de lo aplicado. |

## 4. Pantallas (solo admin y planner; formato `es-PE`; kit `Card`, `DataTable`, `Field`, `Badge`, `Alert`, `Modal`, `Tabs`)

### 4.1 `/planificacion/curvas-estacionalidad` → pestaña nueva **«Crecimiento por género × mundo»**

Es una pestaña más de M6, con el mismo flujo lista → detalle que las agrupaciones.

**URL (M10):** `?pestana=genero-mundo&anio=2027&proyeccion=<id>` abre la lista; `?gm=<g>.<m>|resto&anio=…&proyeccion=…` abre el detalle (implica la pestaña) y sobrevive a recargar; «← Género × mundo» vuelve a la lista. Hoy `curvas-panel.tsx:44` deduce la pestaña solo de `?agrupacion`: se amplía para que `?gm` y `?pestana=genero-mundo` abran la pestaña nueva. **Si vienen `?agrupacion` y `?gm` a la vez, manda `?agrupacion`** (el comportamiento existente no cambia) y `gm` se quita de la URL con `replaceState`.

**Lista.** Cabecera:
- selector de año de aplicación (`anios_permitidos`; por defecto, el año del último mes cerrado + 1);
- proyección de referencia: **solo proyecciones con `version_metodo ≥ 4`** (I1), la en trabajo de `anio − 1` con el `calculado_at` más reciente o, si no hay, la cerrada; se puede cambiar. Si ninguna califica: `Alert` «No hay proyección de 2026 calculada con el método actual: recalcula la proyección para ver “Cierre proyectado”, “Aplicado hoy” y la base 2027»;
- texto fijo: «% bruto 2027 frente a 2026 de las mismas tiendas de 2027, sin corregir por el Niño; todas las filas del GM crecen igual».

Columnas: género · mundo · u. 2025 (mismas tiendas) · acumulado ene–set 2026 vs 2025 (bruto / sin Niño, con badge «extremo» si corresponde) · aplicado hoy en la proyección · base 2027 (`Σ B`) · **crecimiento 2027 aprobado** (vN, quién y cuándo) · estado (`Sin aprobar` · `Aprobado v2` · `Obsoleto: motivo`) · «Trabajar».
- Los géneros no detallados se ven agrupados bajo **Resto**, con «sigue al Resto».
- La fila **Resto** tiene sus propias cifras.
- La fila **Total** da el ponderado por `B` (`calcularPromedio` de 07c). Un GM **sin aprobar pondera con el Resto que seguiría** (el Resto aprobado o, si no hay, el provisional de la proyección de referencia), en vez de dejar el Total en `null` (M7). Al lado: «3 GM sin aprobar siguen al Resto». Sin proyección de referencia válida, el Total muestra «—».
- Un GM de mundo desactivado se ve con el badge «mundo desactivado»; se puede aprobar solo si tiene filas base en una proyección en trabajo (I3).
- Filtros por estado y género; CSV.

**Detalle de un GM** (ejemplo: HOMBRE · URBANO, `Y = 2026`, `k = setiembre`):
1. **Curva de venta:**
   - gráfico SVG propio con `calcularGeometriaCurvas` de `src/lib/curvas/grafico.ts`: una línea por año, de 2023 a 2026; 2026 real en trazo continuo hasta setiembre y proyectado en discontinuo;
   - bandas del Niño por temporada con su factor, como en M6 y M7. Si el factor de `Y` es **parcial** (hoy, invierno 0,66 y verano 1,31), la banda dice «factor parcial (ene–set)» y un aviso lo repite junto a las cifras sin Niño (I7);
   - modos **Unidades / Forma (%) / Sin Niño**; en Forma se añade la **forma típica** (promedio de las participaciones de los años completos normales: hoy, 2024 y 2025);
   - debajo, tabla año × mes con total, variación frente al año anterior y CSV;
   - leyenda: «Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026). 2023: 2 de ellas aún no abrían (meses marcados)».
2. **Cómo crece:** tabla de referencias (§5.1). Cada fila muestra periodo, tiendas, anterior, actual, % bruto, % sin Niño y «equivalente para 2027» (bruto · sin Niño + rebote), con estas marcas (I7; ninguna sugiere un %):
   - «frágil» (menos de 3 tiendas o menos de 120 u. en el periodo anterior). En HOMBRE y MUJER no se activa hoy; queda para el Resto y los géneros chicos;
   - «extremo» si `|% bruto| > 50` (hoy: HOMBRE · DEPORTIVO +381 %, MUJER · DEPORTIVO +306 %, MUJER · RI +151 %);
   - **aporte de la tienda mayor**: «T07 aporta el 38,5 % de 2025; sin ella, +1,2 %»;
   - **cobertura** (solo en Acumulado): «ene–set es el 71 % del año 2025».
   - Si `Y` fue Niño para el GM, un `Alert` dice: «2026 fue Niño en invierno: compara con las cifras sin Niño + rebote (+7,1 %)».
   - Si la referencia es de un método anterior, «Cierre proyectado» y «Aplicado hoy» muestran «— recalcula la proyección (método anterior)».
3. **Aprobar 2027** (solo HOMBRE, MUJER y Resto):
   - selector «Base» con las referencias y su variante, que precarga el % con su equivalente redondeado a 1 decimal;
   - campo «% bruto 2027» y, al lado, «equivale a x % sobre la base normalizada por el Niño»;
   - nota, obligatoria según R-N, con su motivo a la vista;
   - botón **«Aprobar v3»**, con un `confirm` que repite el %, la base, la diferencia y cuántas proyecciones en trabajo quedarán desactualizadas.
   - Respuestas `409`: `vigente_cambiada` y `datos_cambiados` recargan con su mensaje; `sin_cambio` dice «Es igual a la v2: no se crea otra versión».
4. **Versiones:** vN, %, base y su valor, nota, quién y cuándo; «Ver foto» abre `referencia`.

**Detalle del Resto:** el mismo detalle, sobre la suma de los GM no detallados, con el desglose de la base por género.

### 4.2 Proyección → pestaña «Crecimientos» (solo lectura)

Lo que queda, exactamente (`ResumenCrecimientosProyeccionApi`):

```ts
ResumenCrecimientosProyeccionApi = {
  anio_siguiente: number;
  version_metodo: number | null;           // < 4 → la pantalla solo dice «recalcula la proyección»
  filas: FilaResumenCrecimientoApi[];      // los GM de HOMBRE y MUJER con filas base (gm_gml) o con foto
  resto: FilaResumenCrecimientoApi;        // con desglose por género
  total: ResultadoPromedio;                // calcularPromedio de 07c sobre la foto (ninguna celda queda vacía: la foto siempre tiene %)
  puente: PuenteApi;                       // 07c §5.2
  objetivo_pct: number | null;
  cambiados: { clave, nombre, aplicado: { pct, version } | null, vigente: { pct, version } | null }[];
  sin_aprobar: { faltan: { clave, nombre }[]; resto_provisional: boolean } | null;
};
FilaResumenCrecimientoApi = {
  clave, genero, mundo,
  aplicado: { pct, version: number | null, provisional: boolean, por_nombre, at };   // de la foto
  vigente_hoy: { pct, version, por_nombre, aprobada_at } | null;                        // del global
  agregado: AgregadoCrecimientoApi;        // 07c: B, B'', rebote, filas con % propio, decididas, Σ vigente de Y+1
  resultante_pct: number | null;           // Σ vigente Y+1 ÷ Σ B − 1
  enlace: string;                          // /planificacion/curvas-estacionalidad?gm=<g>.<m>&anio=2027&proyeccion=<id>
};
```

- **Alert de cabecera** si `crecimientos_cambiados`: «Los crecimientos aprobados cambiaron después de calcular: HOMBRE · URBANO v1 → v2 (12 % → 15 %). Recalcula», con el botón Recalcular.
- **Alert** si `sin_aprobar`: «No se puede cerrar: faltan 3 crecimientos aprobados para 2027 y el Resto es provisional», con el enlace «Ir a Crecimiento por género × mundo» (`?pestana=genero-mundo&anio=2027&proyeccion=<id>`).
- **Tabla por GM, Resto y Total:** % aplicado (vN, quién y cuándo, de la foto) · vigente hoy (con badge «cambió» si difiere) · base `B` · 2027 resultante · % resultante · rebote del Niño · **badges informativos sin acción** «2 con % propio» y «1 decidida» (de `agregado`), con el título «Se cambian fila a fila en Por línea: vacía “Crec.” o usa “Volver a la propuesta”» · enlace «Analizar y aprobar».
- **Pie:** puente al Total 2027 y objetivo global (07c §5.2, sobre la foto). El objetivo se edita con el `PATCH` de la proyección y no la desactualiza.
- Cerrada o archivada: todo igual y el objetivo en solo lectura.
- Proyección de método anterior (`version_metodo < 4`): solo el `Alert` «Esta proyección se calculó con un método anterior: recalcúlala para ver sus crecimientos».

### 4.3 Otras pantallas de la proyección

- **Cabecera:** «Cerrar proyección» se deshabilita si `crecimientos_sin_aprobar` no es `null`, con el título del motivo y el mismo enlace.
- **Cerrar (modal):** `crecimientos_sin_aprobar` entra en la lista de motivos no forzables junto a `version_metodo` y `crecimientos_cambiados` (`MOTIVOS_NO_FORZABLES`, `vista.ts:473`); el modal lista los GM faltantes y no ofrece «Cerrar de todos modos».
- **Matriz:** la nota de la columna «Crec. mismas tiendas» (`textoColumnasVariacion`, `vista.ts:443`) pasa de «es lo que escribes en Crecimientos» a «es el % aprobado en Curvas → Crecimiento por género × mundo (o el % propio de la fila)».

## 5. Reglas de negocio

### 5.1 Mismas tiendas y cifras de referencia (fórmulas exactas, en `referencias.ts`)

- **Red de un año `Z`:** `redComparable` de M6 sobre la venta total de cada tienda, sumada de `series`: tienda tipo Tienda y activa, abierta los doce meses de `Z` (o de enero a `k` si `Z = Y`) por fechas de M4 y con venta en cada mes por datos de M5.
- **Comparables de `Z−1` → `Z`:** `C(Z) = tiendasComunes(red(Z−1), red(Z))`. **Mismas tiendas del gráfico** = `C(Y)`. (M8: no es «`M(Y)` sin los cierres de `Y`» en general; solo los cierres hasta `k` salen de `red(Y)`. Una tienda que cierra en `Y` después de `k` sigue en `C(Y)`, porque su ene–`k` es comparable.)
- **Aplicación (07c, sin cambio):** el % se aplica a `B`, la base de las mismas tiendas de `Y+1` (`M(Y+1)`: incluye la que abrió en `Y−1` y excluye los cierres de `Y+1`). La referencia compara siempre periodos iguales sobre tiendas iguales. Por eso la tienda que entra en `B` no entra en las cifras, y la pantalla lo dice.
- **Sin Niño:** `U'(Z,m) = Σ_temp U(temp,Z,m) ÷ φ_{temp,Z,m}`, con `factoresMes` (`nino.ts`) por temporada desde `periodos_atipicos` y el factor efectivo de `factores_volumen_atipico`. `todo_el_ano` y `sin_agrupacion` llevan φ = 1 (`nino.ts:85`, M8). Si una temporada atípica no tiene factor: φ = 1 con el aviso `sin_factor`. Si el factor de `Z` es parcial, el aviso `factor_parcial`.
- **Rebote** `ρ = Σ B'' ÷ Σ B − 1`, de la proyección de referencia (07c `rebote_nino_pct`). **Equivalente para `Y+1`:** si la cifra es bruta, la misma; si es sin Niño, `(1 + g_sin)(1 + ρ) − 1`.
- **Referencia de proyección válida (I1):** `resumen.version_metodo ≥ 4` y `Σ base_siguiente` de las filas base de `Y+1` no nulo y `> 0`. Si no, «Cierre proyectado», «Aplicado hoy», `B` y ρ son `null` con `motivo_nulo = "metodo_anterior"` (o `"sin_base"`), y la variante «sin Niño + rebote» de las demás referencias también es `null` (no hay ρ). Por qué: en el método 3 el % se aplicaba sobre la base normalizada, y «Aplicado hoy = 20 %» se leería como bruto sin serlo. Hoy la única proyección real (2026, en trabajo) es de método 3, sin `B` en ninguna de sus 3 071 filas (medición del revisor): hay que recalcularla con `0.12.1` antes del hito (§6).
- **Frágil:** menos de 3 tiendas o menos de 120 u. en el periodo anterior. Con un denominador ≤ 0, la cifra es `null` y lleva su motivo.
- **Extremo (I7):** `|pct_bruto| > 50`. Solo marca, nunca bloquea.
- **Tienda mayor (I7):** la tienda de `C` con más unidades en el periodo anterior; `aporte_pct = su anterior ÷ anterior total`; `pct_sin_ella` = la misma fórmula sin esa tienda (`null` si quedan 0 tiendas).
- **Cobertura (I7, solo Acumulado):** `Σ_{m≤k} U(Y−1) ÷ Σ_{m≤12} U(Y−1)` sobre `C(Y)`.

| Referencia | Fórmula (tiendas) | Ejemplo HOMBRE · URBANO (invierno 2026 Niño φ = 0,80; 2025 normal) |
|---|---|---|
| **Acumulado** | `Σ_{m≤k} U(Y) ÷ Σ_{m≤k} U(Y−1) − 1` sobre `C(Y)` | 41 200 ÷ 40 000 → **+3,0 %** bruto; sin Niño (12 000 ÷ 0,80 + 29 200) ÷ 40 000 = 44 200 ÷ 40 000 → **+10,5 %**; equivalente 2027: 1,105 × 1,0713 → **+18,4 %** (ρ = 63 100 ÷ 58 900 − 1 = +7,1 %); cobertura 40 000 ÷ 54 000 = **74 %** |
| **Cierre proyectado** | `Σ vigente_Y` de las filas base del GM en la proyección de referencia ÷ `U(Y−1)` de sus mismas tiendas de `Y` (`parametros.bloques[Y].mismas`) − 1. Sin Niño: cada mes de `Y` de esas filas ÷ el φ de `Y` de **su temporada** (el mismo `factoresMes` de arriba; no se lee `factores_mes` de la fila, que no está en las columnas ligeras) | 55 620 ÷ 54 000 → **+3,0 %**; sin Niño 59 620 ÷ 54 000 → **+10,4 %**; equivalente **+18,3 %** |
| **Año completo `Z`** (2024 y 2025) | `U(Z) ÷ U(Z−1) − 1` sobre `C(Z)`, cada una con sus propias tiendas | 2025: 52 500 ÷ 50 000 → **+5,0 %** (los dos años normales; equivalente sin Niño + rebote **+12,5 %**). 2024 frente a 2023 (Niño): +4,0 % bruto, −0,2 % sin Niño |
| **Aplicado hoy** | % efectivo de la foto de la proyección de referencia (GM de la foto o, si no hay, `crecimiento_resto_usado`, o `crecimiento_pct_defecto` si se calculó antes de `0.12.1`) y «Crec. mismas tiendas» resultante; sin Niño `(1+g) ÷ (1+ρ) − 1` | Resto provisional 5 %: 58 900 → 61 845; sin Niño **−2,0 %** |

Con «Acumulado · sin Niño + rebote» (+18,4 %) como base, Javier escribe **15,0 %**. La diferencia es de 3,4 pp > 0,5, así que la nota es obligatoria («prudente: el rebote del invierno no será completo»). Aprueba v1, las proyecciones en trabajo de 2026 quedan con `crecimientos_cambiados` y, al recalcular, el GM da `round(58 900 × 1,15) = 67 735`.

### 5.2 Reglas que el código garantiza (cada una con su prueba vitest)

1. **Una vigente:** como máximo una vigente por (año, alcance, GM); aprobar crea `max(version) + 1` y reemplaza la anterior, que nunca se borra. Con `version_vigente` distinta se responde `409` sin escribir.
2. **R-N (nota):** es obligatoria si la base es `ninguna` o no se pudo calcular, o si `|pct − base_valor| > 0,5 pp`. Con el valor precargado no se exige.
3. **`sin_cambio` (M4):** `409` solo si coinciden `pct`, nota, `base.tipo`, `base.anio`, `base.variante` **y** `base_valor` (a 2 decimales) con la vigente, **y** la vigente no está obsoleta. Una vigente obsoleta o con `base_valor` distinto se puede refrescar con el mismo % (crea vN+1).
4. **Géneros y mundos:** solo HOMBRE y MUJER (más el Resto) se aprueban; otro género da `400 genero_no_detallado`. Un mundo inactivo da `400 mundo_inactivo`, salvo que el GM tenga filas base en una proyección en trabajo de `anio − 1` (I3).
5. **Obsoleto, solo informativo (I2):**
   - **base movida:** la base elegida se movió `≥ 1,0 pp` frente a `base_valor` (p. ej., octubre publicado lleva el acumulado de +18,4 % a +16,9 %). **No aplica a `aplicado_hoy`**, que se refiere a sí misma: con esa base solo se marca si deja de poder calcularse;
   - **base no calculable:** la base elegida ya no se puede calcular;
   - **composición:** algún `gml_id` de la foto (`referencia.gml_ids`) ya no pertenece al GM (cambió de GM, se desactivó o se borró). **Los nodos que entran no cuentan:** cada mes entran de 3 a 14 nodos nuevos con venta, y marcarlo dejaría casi todo obsoleto.
   - Nunca cambia la vigente ni las proyecciones.
6. **Precedencia en M7:** fila > GM vigente > Resto vigente > `pct_defecto`. Una celda de un género no detallado no se aplica.
7. **Huella:** sin aprobaciones da el mismo texto que en `0.10.8`; con ids cambia aunque el % sea igual; no depende del orden.
8. **Aprobar no escribe** en `proyecciones`, `proyeccion_filas`, `proyeccion_fila_anios` ni `proyeccion_crecimientos` (se prueba con un doble de la base).
9. **Cálculo y foto:** `ejecutarCalculo` lee los vigentes, pasa el Resto efectivo a `calcularProyeccion`, escribe la foto y `crecimiento_resto_usado`, y deja `crecimiento_pct_defecto` intacto. Una cerrada no cambia aunque se apruebe otra versión.
10. **B2 lee la foto (B1):** tras aprobar el Resto v1 (10 %) y recalcular, un `PATCH` de un umbral **conserva** `crecimiento_resto_usado`, y decidir después una fila de `Y` recalcula su `Y+1` con el 10 % de la foto, no con el provisional. Lo mismo para la explicación de una tienda y para `crecimiento_efectivo` en las lecturas.
11. **Recalcular** limpia `crecimientos_cambiados` y conserva `decidido` y `crecimiento_pct`.
12. **Fórmulas de §5.1:** el ejemplo debe dar 3,0 / 10,5 / 18,4 / 5,0 / 12,5 / −2,0 y cobertura 74 %. `C(Y)` excluye la tienda nueva de `Y−1` y los cierres de `Y` hasta `k`, e incluye un cierre posterior a `k`. La serie sin Niño con φ = 1 es idéntica a la bruta. Una referencia de método 3 da `null` con `metodo_anterior`.
13. **Contrato de la ruta `PUT`:** `PUT …/crecimientos` responde `410` sin leer el cuerpo (un cuerpo roto también da `410`).
14. **Cierre:** `crecimientos_sin_aprobar` y `crecimientos_cambiados` **no** se pueden forzar (bloquean siempre); `config_cambiada` sigue forzable. El conjunto exigido es el de I4: un GM con venta pero sin filas base no bloquea; un GM de género no detallado exige el Resto aprobado. Una aprobación que entra entre la comprobación y el `UPDATE` de cierre revierte el cierre (M5).
15. **`PATCH` del objetivo** no marca `recalculo_pendiente` ni entra en `ediciones` (M2).
16. **Validación del `POST` (M3):** año no permitido → `400 anio_no_permitido`; referencia de otro año → `400 referencia_otro_anio`; `huella_datos` de más de 128 caracteres → `400`; `anio_completo` sin `base.anio` → `400`.
17. **Caché (M1):** cambiar el GM de un nodo, o la agrupación de una equivalencia, cambia la clave aunque las cargas sean las mismas.
18. **Permisos:** el comprador recibe `403` en las **siete** rutas nuevas o cambiadas (M8): `GET /api/curvas/genero-mundo`, `GET` y `POST /api/curvas/genero-mundo/[clave]`, `GET` y `PUT …/proyecciones/[id]/crecimientos`, `PATCH …/proyecciones/[id]` y `POST …/proyecciones/[id]/cerrar`.

### 5.3 Casos borde

| Caso | Comportamiento |
|---|---|
| GM sin venta en la ventana | No aparece en la lista, salvo que tenga una versión aprobada o filas base de `Y+1` en la referencia (entonces muestra «sin venta comparable» y sus cifras quedan en `null`). |
| Pocas tiendas comparables | Marca «frágil»; no bloquea. |
| Saltos extremos (DEPORTIVO, RI) | Marca «extremo», con el aporte de la tienda mayor y el % sin ella; no bloquea ni sugiere. |
| Tiendas nuevas de `Y` / de `Y−1` | Las de `Y` no entran en `C(Y)`. La de `Y−1` entra en `B` pero no en el acumulado, y la nota lo cuenta. |
| Cierres | El de `Y` hasta `k` sale de `C(Y)`; el de `Y` después de `k` sigue en `C(Y)`. El de `Y+1` sí cuenta en las referencias, pero sale de `B` (07c). |
| Año del Niño | Bandas, versiones sin Niño y equivalente con rebote. Con factor parcial, aviso. Si `Y+1` está marcado atípico, se mantiene el aviso de 07c («tu % bruto debe incluirlo»). |
| Género fuera de HOMBRE y MUJER | Se puede analizar y no se aprueba: sigue al Resto. |
| Mundo desactivado | La vigente sigue aplicándose a los nodos de ese mundo y la lista lo muestra «mundo desactivado». Se puede aprobar una versión nueva solo si el GM tiene filas base en una proyección en trabajo (I3); si no, `400 mundo_inactivo`. |
| Nodo que cambia de mundo | Su historia pasa al GM nuevo. El GM de origen queda «obsoleto: composición»; el de destino solo si su base se mueve ≥ 1 pp. Las proyecciones quedan con `crecimientos_cambiados` (`gm_gml`). |
| Proyección en trabajo de antes de `0.12.1` | Con 0 celdas, la huella es igual y no se marca por crecimientos (sí por `version_metodo` si es de método 3). Con celdas, queda desactualizada y el recálculo usa el global. |
| Sin proyección de referencia de método ≥ 4 | «Cierre proyectado», «Aplicado hoy», `B`, ρ y la variante «sin Niño + rebote» muestran «—» con su motivo; Acumulado y Año completo brutos funcionan y se puede aprobar. |
| `k = diciembre` | El acumulado cubre el año completo (cobertura 100 %). |
| Dos pestañas aprobando a la vez | `409 vigente_cambiada`. |
| Cerrar mientras alguien aprueba | El cierre se revierte con `409` (M5). |

## 6. Criterios de aceptación (hito de Javier)

**Precondición:** recalcular la proyección 2026 en trabajo con `0.12.1` (hoy es de método 3, sin `B`), antes de recorrer el hito.

1. La pestaña nueva lista los GM con venta, su crecimiento aprobado y su estado. El comprador no ve la página y la API le responde `403`.
2. El detalle de un GM de invierno muestra las curvas de 2023 a 2026, con setiembre real y el resto proyectado, las bandas del Niño (con «factor parcial» en 2026), los modos Unidades / Forma / Sin Niño, la tabla con totales y el CSV.
3. Las cuatro referencias aparecen con sus tiendas y en sus dos variantes, con «extremo», tienda mayor y cobertura donde correspondan. Se comprueba a mano una con §5.1.
4. **[ESCRIBE]** Aprobar 15 % con la base precargada sin nota se rechaza; con nota crea la v1 con su foto. Se aprueba el Resto con «Aplicado hoy» en un clic.
5. La proyección en trabajo pasa a «desactualizada: crecimientos» y no se puede cerrar ni forzando. Recalcular la deja al día, con el GM en +15,0 % en «Crec. mismas tiendas» y ninguna decisión perdida. Un `PATCH` de un umbral después no cambia el Resto aplicado.
6. Con algún GM de HOMBRE o MUJER sin aprobar (o el Resto provisional), «Cerrar proyección» está deshabilitado y el servidor responde `409 crecimientos_sin_aprobar` también con `?forzar=1`. Con los 11 aprobados (10 GM + Resto, cifra de hoy) y recalculada, cierra.
7. La pestaña Crecimientos de la proyección no permite editar, muestra «HOMBRE · URBANO v1 · 15 % · Javier · fecha» y su enlace abre el detalle. Por línea muestra «15 % · HOMBRE · URBANO v1».
8. Una proyección cerrada no cambia al aprobar la v2.
9. Pasan `lint`, `tsc`, `vitest` y `build`; la `0027` corre dos veces seguidas (idempotente); `venta_genero_mundo` ≤ 3 s en frío, medido y anotado; `APP_VERSION = "0.12.1 · M6"`.

## 7. Fuera de alcance

Crecimiento en soles o por precio y mix (todo va en unidades; la venta nunca incluye IGV); referencia de últimos 12 meses móviles; aprobar géneros distintos de HOMBRE y MUJER; retirar un crecimiento detallado (para volver al Resto, se aprueba el mismo % que el Resto con nota; el estado `retirada` ya existe en la tabla); sugerencias automáticas de % (las referencias solo informan: decisión 33); crecimiento del año en curso o de las aperturas; aprobación en bloque; panel de tiendas elegible a mano; **«Alinear filas fijadas a mano…»** (se usa «Volver a la propuesta» o se vacía «Crec.» fila a fila); **`GET /api/curvas/genero-mundo/vigentes`** y **«Simulación %»** (sin consumidor); retirar de `src/lib/proyeccion/tipos-api.ts` los tipos de la matriz editable de 07c (`RespuestaCrecimientosApi`, `RespuestaGuardarCrecimientosApi`, `ConflictoFilasManualesApi`, `CeldaCrecimientoApi`…): en `0.12.1` quedan marcados `@deprecated` y sin uso, y se borran en la siguiente versión que toque ese archivo.

## Plan de tandas (sin pisarse)

**Regla:** cada archivo tiene **un solo dueño** en todo `0.12.1`. Se puede **importar** un archivo de otro dueño, nunca modificarlo. Los tipos y piezas compartidas se fijan en la tanda 1 y quedan congelados; todo lo que añade la tanda 1 a tipos existentes es **opcional o nuevo**, para que `tsc` pase en cada commit intermedio.

### Tanda 1 (en paralelo)

**Datos** (`datos`):
- `supabase/migrations/0027_crecimientos_genero_mundo.sql`, `scripts/humo-0027.sql`, `src/lib/supabase/database.types.ts` (regenerado).
- Aplica en `vector-two` (nunca en `lukers-compras`); mide `venta_genero_mundo` con la preagregación (§2.4) y anota el tiempo.

**Backend · contratos** (`backend`; se commitean solos y desbloquean a las tandas 2):
- `src/lib/crecimientos/tipos-api.ts`, `src/lib/crecimientos/esquemas.ts` (§3).
- `src/lib/crecimientos/vigentes.ts` (puro: `matrizDeVigentes`, `restoEfectivo`, `gmExigidos`, `faltantesDeCierre`; §3.1) y `tests/crecimientos.vigentes.test.ts`.
- `src/lib/crecimientos/consultas-vigentes.ts` (`leerVigentes`). Se commitea al final de la tanda, cuando `database.types.ts` ya está regenerado.
- `src/lib/curvas/esquemas.ts`: solo `export` de `CARACTERES_PROHIBIDOS_NOTA` (M3).
- `src/lib/proyeccion/tipos-api.ts`: `crecimiento_resto_usado?` y `RestoUsadoApi` en `ParametrosProyeccion`; `version?` y `provisional?` en `CrecimientoEfectivoApi`; `crecimientos_sin_aprobar?` en `ProyeccionApi`; `ResumenCrecimientosProyeccionApi` y `FilaResumenCrecimientoApi` (nuevos); el código `crecimientos_sin_aprobar_anio` en los motivos de prerrequisitos; `@deprecated` en los tipos de la matriz editable.

### Tanda 2 (cuatro en paralelo, después de la tanda 1)

**Backend A · Curvas por GM** (`backend`):
- `src/lib/crecimientos/{comparables,series,referencias,reglas,huellas,consultas,servicio,cache}.ts`.
- `src/app/api/curvas/genero-mundo/route.ts` y `src/app/api/curvas/genero-mundo/[clave]/route.ts`.
- Pruebas: `tests/crecimientos.fake-db.ts`, `tests/crecimientos.fixture.ts`, `tests/crecimientos.{comparables,referencias,reglas,huellas,cache,rutas,estatico}.test.ts`, y `tests/curvas.estatico.test.ts` (añadir las dos rutas al mapa de «M6b: rutas»).
- Importa sin modificar: los de la tanda 1; `src/lib/curvas/{red,grafico,huellas,cache-venta,lectura}.ts`; `src/lib/proyeccion/nino.ts`; de `src/lib/proyeccion/consultas.ts`, `listarProyeccionesDb`, `leerProyeccionDb`, `leerFilasConAnios` (columnas `ligeras`), `leerCrecimientos` y `leerGenerosMundos`; de `src/lib/proyeccion/crecimientos.ts`, `agregarFilas`, `calcularPromedio`, `claveGM` y `generosDeMatriz`. Backend B se compromete a **no cambiar la firma** de esas funciones. Por la prueba estática de M7, Backend A **no** escribe `.from("proyecciones" | "proyeccion_…")`: lee M7 solo con esas funciones.
- `crecimientos_genero_mundo` y `venta_genero_mundo` solo se nombran en `src/lib/crecimientos/consultas.ts` y `consultas-vigentes.ts` (lo comprueba `tests/crecimientos.estatico.test.ts`).

**Backend B · M7 lee el global** (`backend`):
- `src/lib/proyeccion/servicio.ts` (cálculo y foto, `desactualizadaDe` con `o.vigentes`, `leerEstadoInicial`, `crearProyeccion` sin copia de celdas, `editarProyeccion` con el objetivo y M2, `cerrarProyeccion` y `pendientesDeCierre` con M5).
- `src/lib/proyeccion/servicio-base.ts` (`parametrosDe`, `cargarMatriz`, `contextoModelo`, `crecimientoParaApi`, `aProyeccionApi`).
- `src/lib/proyeccion/servicio-crecimientos.ts` (`GET` de resumen; se retira `guardarCrecimientos`).
- `src/lib/proyeccion/servicio-edicion.ts` (`:184-186`, `:458-460`, `:509`), `src/lib/proyeccion/servicio-lectura.ts` (`:35-37`).
- `src/lib/proyeccion/consultas.ts` (`escribirFotoCrecimientos`; se retiran `pisarRegistros` y lo que quede sin uso), `crecimientos.ts` (matriz ampliada; se retira `filasEnChoque`), `huellas-crecimientos.ts` (ids; se retiran `huellaMatriz` y `huellaChoque`), `persistencia.ts` (`:340`), `reglas.ts` (cierre), `desactualizado.ts` (aviso de prerrequisitos), `esquemas.ts` (objetivo en `parametrosSchema`; se retira `guardarCrecimientosSchema`).
- `src/app/api/proyeccion/proyecciones/[id]/crecimientos/route.ts` (`PUT` → `410`).
- **Reservados, sin cambios previstos:** `src/lib/proyeccion/calculo.ts`, `decision.ts` y `tipos.ts` (§3.1 explica por qué no hace falta tocarlos). Si al construir resultara imprescindible un cambio, lo hace Backend B y nadie más.
- Pruebas: `tests/proyeccion.crecimientos.test.ts`, `tests/proyeccion.crecimientos-rutas.test.ts`, `tests/proyeccion.rutas.test.ts`, `tests/proyeccion.endurecimiento.test.ts`, `tests/proyeccion.reglas.test.ts`, `tests/proyeccion.estatico.test.ts`, `tests/proyeccion.fake-db.ts` (tabla `crecimientos_genero_mundo` con su único parcial y las columnas nuevas de `proyeccion_crecimientos`), `tests/proyeccion.contexto-falso.ts` (ayudante `aprobarCrecimientosFalsos(anio)` que siembra los vigentes de los GM del fixture más el Resto) y la nueva `tests/proyeccion.crecimientos-globales.test.ts` (reglas 9, 10, 14 y 15).

**Frontend A · pestaña nueva de Curvas** (`frontend`):
- `src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/**` (lista, detalle, gráfico, aprobar, `vista.ts` puro; sin `page.tsx` dentro, no es ruta) y `src/app/(app)/planificacion/curvas-estacionalidad/curvas-panel.tsx` (pestaña y URL, M10).
- Pruebas: `tests/crecimientos.pantalla.fixture.ts`, `tests/crecimientos.pantalla-vista.test.ts`, `tests/crecimientos.pantalla-render.test.ts`.
- Importa sin modificar: los tipos de la tanda 1, `src/lib/curvas/grafico.ts`, `src/lib/proyeccion/crecimientos.ts` (`calcularPromedio`) y el kit de UI.

**Frontend B · proyección** (`frontend`):
- `src/app/(app)/planificacion/proyeccion/crecimientos-tab.tsx` (reescrita, solo lectura), `crecimientos-vista.ts` (reescrita; conserva con la misma firma `textoOrigenCrecimiento`, `ayudaCrecimientoFila`, `marcadorCrecimiento`, `textosDetalleBruto` y `textoPieCrecimientoLinea`), `choque-modal.tsx` (**se borra**), `formulario-proyeccion.tsx`, `cerrar-modal.tsx`, `cabecera-proyeccion.tsx`, `proyeccion-panel.tsx` (props de la pestaña), `vista.ts` (`MOTIVOS_NO_FORZABLES`, textos), `tabla-filas.tsx` (título de la columna «Crec.»).
- **Reservados, sin cambios previstos:** `linea-tab.tsx`, `matriz-tab.tsx`, `bloque-decision.tsx`, `celda-decision.tsx`, `detalle-fila.tsx`, `antes-de-proyectar.tsx` (los textos viven en `vista.ts` y `crecimientos-vista.ts`; el aviso nuevo de prerrequisitos se pinta con la lista genérica de `avisa`).
- Pruebas: `tests/proyeccion.crecimientos-vista.test.ts`, `tests/proyeccion.crecimientos-render.test.ts`, `tests/proyeccion.crecimientos-pantalla.fixture.ts`, `tests/proyeccion.render.test.ts`, `tests/proyeccion.vista.test.ts`, `tests/proyeccion.pantalla.fixture.ts`, `tests/proyeccion.pantalla.estatico.test.ts`.

### Tanda 3

`qa` → `seguridad` (sonnet) → `documentador`: `CHANGELOG.md`, `docs/PLAN.md`, `docs/DECISIONES.md`, esta ficha y `src/lib/version.ts`. El documentador registra juntas las decisiones de 07c (que aún no están en `DECISIONES.md`) y las de 06d, y corrige en `PLAN.md` el estado de M7, que sigue diciendo «en revisión, sin construir» (M12).

**Orden con M8:** `0.12.1 · M6` sale antes de `0.13.0 · M8`. Los dos solo comparten `database.types.ts`, `version.ts` y CHANGELOG: se regeneran y se suben de forma secuencial. M8 no lee crecimientos y su contrato (`leerProyeccionCerrada`, `VERSION_METODO_MIN_M8 = 4`) no cambia.

### Pruebas existentes que se retiran o se reescriben

| Archivo | Dueño | Qué pasa |
|---|---|---|
| `tests/proyeccion.crecimientos-rutas.test.ts` | Backend B | **Se reescribe.** Se retiran «regla 7: PUT, validación», «regla 8: PUT, guardar y recalcular», «regla 5 y 6: choques», «guardado_parcial…» y, de «regla 14», «copiar_de copia las celdas», «un PUT cuya proyección cambió…» y «dos PUT seguidos…». Quedan, adaptadas: permisos (ahora `PUT` → `410` para el planner y `403` para el comprador), la forma nueva del `GET`, el nodo que cambia de mundo, el método 3, B2 en el acto (ahora con la foto), «07c, lecturas» (con «v1» en el origen), el `PATCH` con `usar_crecimientos` y `estado_cambiado`, archivar y 07d. |
| `tests/proyeccion.crecimientos-vista.test.ts` | Frontend B | **Se reescribe.** Se retiran «lectura del % de una celda», «borrador, faltantes y cuerpo del PUT», «Calcular promedio» sobre borrador, «aviso de celdas descartadas», «insignias y textos de cada celda», «Modal del choque…» y «aviso previo de filas fijadas…». Quedan, adaptadas: «Por línea: % bruto efectivo y su origen» (con v2 y provisional), «desactualización y cierre» (con `crecimientos_sin_aprobar`) y «venta esperada de la tienda nueva (07d)». |
| `tests/proyeccion.crecimientos-render.test.ts` | Frontend B | **Se reescribe.** Se retiran «la matriz de crecimientos», «el formulario de la pestaña», «Calcular promedio: el panel» y «Modal del choque». Quedan «Matriz (Parte 2)» y «el resto de la pantalla» adaptados; se añade el render de solo lectura (§4.2), el modal de cierre y la cabecera con el motivo nuevo. |
| `tests/proyeccion.crecimientos-pantalla.fixture.ts` | Frontend B | Se reescribe sobre `ResumenCrecimientosProyeccionApi`. |
| `tests/proyeccion.crecimientos.test.ts` | Backend B | Se retira «regla 4: filasEnChoque y huellaChoque» y, de «regla 12», `huellaMatriz`. `huellaCrecimientos` y `huellaDeMatriz` se amplían con ids (con la prueba de que sin ids el texto es el de `0.10.8`). El resto queda. |
| `tests/proyeccion.rutas.test.ts` y `tests/proyeccion.endurecimiento.test.ts` | Backend B | **Se adaptan:** todo cierre (20 y 6 llamadas) necesita los crecimientos aprobados. El `beforeEach` llama a `aprobarCrecimientosFalsos(2027)` **antes** de crear las proyecciones (así no quedan desactualizadas). Se añade un caso de cierre sin aprobaciones → `409 crecimientos_sin_aprobar`. Cambia el texto esperado de `usar_crecimientos` (`proyeccion.rutas.test.ts:821`). |
| `tests/proyeccion.fake-db.ts`, `tests/proyeccion.contexto-falso.ts` | Backend B | Tabla nueva, columnas nuevas y ayudante de siembra. |
| `tests/proyeccion.reglas.test.ts` | Backend B | Casos de `motivoRechazoCerrar` con `crecimientosSinAprobar` y su orden frente a los demás motivos. |
| `tests/proyeccion.estatico.test.ts` | Backend B | El mapa de rutas no cambia (`crecimientos` sigue con `GET` y `PUT`); se comprueba que el `PUT` no llama a `leerCuerpo`. |
| `tests/curvas.estatico.test.ts` | Backend A | Mapa de rutas de `src/app/api/curvas/` con las dos nuevas. |
| `tests/proyeccion.render.test.ts`, `tests/proyeccion.vista.test.ts`, `tests/proyeccion.pantalla.fixture.ts` | Frontend B | Solo si cambian los textos de origen o el campo nuevo de `ProyeccionApi` (es opcional, así que el fixture actual compila). |

## Propuestas para `docs/DECISIONES.md`

1. El crecimiento del año siguiente por GM y el Resto son supuestos globales versionados por año, que se aprueban en M6 y que M7 lee; reemplaza la matriz por proyección de 07c.
2. `proyeccion_crecimientos` y `parametros.crecimiento_resto_usado` son la foto de lo aplicado: B2, las explicaciones, las lecturas y las cerradas leen la foto; solo el cálculo lee el global. `parametrosDe` conserva la clave.
3. Las referencias usan comparables por par de periodos (`C(Z)`), el % se sigue aplicando sobre `B` (`M(Y+1)`), y las cifras que dependen de la proyección exigen `version_metodo ≥ 4`.
4. `VERSION_METODO` no sube.
5. Cerrar exige aprobados los GM de HOMBRE y MUJER con filas base y, si hay filas de otros géneros, el Resto; no se puede forzar.
6. «Alinear…», `GET …/vigentes` y «Simulación %» no entran en `0.12.1`; el modal Pisar / Conservar se retira.
7. «Obsoleto por composición» solo cuenta nodos de la foto que salen del GM; un mundo desactivado con filas base en una proyección en trabajo se puede aprobar.

## Decisiones de Javier (2026-10-27)

Sobre las preguntas abiertas de la ficha:
1. **Cerrar sin crecimiento aprobado de HOMBRE o MUJER, o con el Resto provisional: se bloquea sin excepción.** `crecimientos_sin_aprobar` no se puede forzar.
2. **Géneros aprobables: solo HOMBRE y MUJER, más el Resto.** Los demás géneros con venta se analizan y se ven igual, pero siguen al Resto.
3. **El crecimiento es global y versionado**, y la pestaña Crecimientos de la proyección queda **de solo lectura**, con enlace al análisis.

Sobre las preguntas del revisor:
1. «Alinear…» en `0.12.1`: **se recorta** (hoy hay 0 filas con % propio y 4 decididas); se usa «Volver a la propuesta» fila a fila.
2. Obsoleto por composición: **solo cambios de GM** de los nodos de la foto.
3. Mundo desactivado con filas base y sin versión: **se permite aprobar.**
4. `GET /vigentes` y «Simulación %»: **se quitan** (sin consumidor). «Simulación %» no existía en ninguna pantalla construida.

## Preguntas abiertas

Ninguna. Todo lo que quedaba abierto lo resolvieron las decisiones de arriba.

# 06e · Cierre del año en curso por curva y base del año siguiente sin el Niño (método 5)

> Estado: **especificada el 2026-10-29, pendiente de la revisión del `arquitecto-revisor` (opus) y de la aprobación de Javier.** Amplía la pestaña «Crecimiento por género × mundo» de Curvas de estacionalidad ([06d](06d-curva-y-crecimiento-por-genero-mundo.md)) y cambia el método de M7 ([07](07-proyeccion-anual.md) §5 paso 2, [07c](07c-crecimientos-por-genero-mundo.md) §2.4). **Revierte en parte la decisión 07c «el % del año siguiente es bruto»** y la de 06d «`VERSION_METODO` sigue en 4» (propuestas al final). Versión prevista **`0.14.0 · M6`**, commits `M6:`, migración **`0029_cierre_y_base_sin_nino.sql`** (la `0026` queda para `0.13.1 · M8` y la `0028` para M9a, que pasa a la versión libre siguiente). Cifras sintéticas; tiendas `T01…`; géneros y mundos del seed de `0001`. Vector-One no se consultó: no tiene nada equivalente que valga la pena citar.
>
> **Base real (ref `tzjsxzmsvvhxyiooihyq`): no se pudo consultar desde la sesión del arquitecto** (sin herramienta MCP de Supabase ni credenciales). Los datos de la base que se citan (factores parciales 2026 de invierno 0,66 y verano 1,31; 19 GML que mezclan temporadas; ninguna proyección cerrada al 2026-10-27; 0 filas con % propio) vienen de las mediciones de 06d y 07c y **se vuelven a medir en la tanda 1** (§8, «Verificación previa»). Ninguna decisión de esta ficha depende de que esos números sigan iguales; donde un resultado cambiaría lo que hay que hacer, la ficha dice qué hacer en cada caso.

## 1. Objetivo

Javier: «Este es el módulo donde arranca la proyección, luego vamos a líneas.» La pestaña de crecimiento por género × mundo (GM) debe (1) **calcular por sí misma el cierre del año en curso** de cada GM con la estacionalidad (vendido de las mismas tiendas de enero a `k` ÷ avance de la curva, con los meses del Niño normalizados) y mostrarlo como la línea del año que se completa con lo proyectado, sin depender de que exista una proyección recalculada; y (2) mostrar **2026 corregido del Niño como una línea más** y aprobar el crecimiento de 2027 **sobre esa base corregida**. En M7, la base del año siguiente de las filas afectadas por el Niño pasa a ser su venta de 2026 normalizada por el factor de su temporada, y el % aprobado se aplica sobre ella (**método 5**). En un año sin Niño no cambia ninguna cifra.

## 2. Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Se normaliza por fila de M7 (línea × agrupación de marca), cada una con su temporada y su factor `φ_{Y,m}`**, nunca con una curva compuesta del GM. La base corregida del GM es la suma de las bases corregidas de sus filas. | Un GM mezcla líneas de invierno, verano y todo el año. Un factor único del GM repartiría el rebote del invierno sobre las líneas de verano (es la variante que 07c §2.4 ya descartó: POLO −4,6 %). Por fila, cada línea recupera solo su propio Niño, y el resultado coincide con lo que ya hace el cierre del año en curso (paso 1), que también normaliza por fila. |
| D2 | **Los GML que mezclan temporadas conservan el `φ_{Y,m}` ponderado por mes que ya calcula `factoresMes`** (`nino.ts`, 07 §3), y siguen con el aviso `temporadas_mezcladas`. | Es el mismo `φ` con que el paso 1 normalizó su cierre, así que en una fila base sin aportes **la base corregida coincide con el total normalizado del cierre** (`B' = T'`, regla R7): cierre y base cuentan la misma historia. La media aritmética ponderada es una aproximación: con 60 % invierno a φ 0,80 y 40 % todo el año, normaliza ×1,136 en lugar del ×1,150 exacto (−1,2 %). Corregirla movería también el cierre de 2026 de esas filas; queda fuera de alcance (§7). |
| D3 | **`sin_factor`**: una temporada con meses atípicos en `Y` y sin factor sigue con `φ = 1` (la base no se corrige) y el aviso de la fila. Calcular no se bloquea; **cerrar sí, sin excepción** (`409 factor_faltante`). Si el Niño no afectó esa temporada, el planner escribe `1,00` en Proyección → Factores del Niño, que es una decisión explícita. | En el método 5 el factor de `Y` fija el nivel de 2027 de las líneas del Niño: cerrar con una base sin corregir, sin que nadie lo haya decidido, deja una cifra sin dueño (el mismo criterio de 06d para el Resto provisional). |
| D4 | **El factor de `Y` cambia la base:** si cambia después de calcular (`factores_cambiados` con un factor de `Y`), cerrar tampoco se puede forzar. Un cambio de factores de otros años sigue siendo forzable. | `0,66 → 0,70` mueve la base de invierno un 6 %. Los factores de años anteriores no tocan el nivel de 2027. |
| D5 | **El % que se aprueba y el que se escribe en una fila significan «2027 sobre 2026 corregido de las mismas tiendas de 2027».** `P = round(B' × (1 + g))`. `φ_{Y+1}` sigue dando solo la forma del reparto (si 2027 se marcara como Niño, el % debe incluirlo, como en 07c). En un GM o una fila sin Niño, `B' = B` y el % es el mismo de siempre. | Es lo que pidió Javier («la base de 2027 debe ser la venta de 2026 corregida por el factor, y el % aprobado se aplica sobre esa base»). Para no reintroducir «pongo 20 y veo 25», **toda pantalla que muestra un % de 2027 muestra los dos**: «sobre 2026 corregido» (el que se escribe) y «sobre 2026 real» (el que da la Matriz al comparar con lo vendido), con las dos bases en unidades. |
| D6 | **Las versiones aprobadas antes de `0.14.0` conservan su significado** (columna nueva `sobre_base = 'bruta'`). M7 las aplica como en el método 4 (`round(B × (1+g))`), así ninguna cifra salta sola. **En un GM que tuvo Niño en `Y`**, una versión `bruta` no basta para cerrar: hay que reaprobarla sobre 2026 corregido (la pantalla lo ofrece en un clic con «Aplicado hoy»). En un GM sin Niño, `bruta` y `corregida` dan lo mismo y la versión vale tal cual. | Descartados: (a) reinterpretar en silencio el 15 % bruto como 15 % sobre corregido (en invierno, con φ 0,66, saltaría a +74 % real); (b) convertir las versiones automáticamente (06d: «nunca se copian solas»). |
| D7 | **El cierre del año en curso del GM se calcula en la pantalla, por agrupación de estacionalidad**, con la curva vigente de M6 de cada una y el `φ` de su temporada, y se suma. Ya no depende de una proyección de referencia. La cifra de la proyección, si existe y es del método 5, queda como dato al lado. | La estacionalidad oficial son las curvas aprobadas en M6 (decisión del 2026-10-15: «dos fuentes de curva darían dos respuestas»). Por eso no se usa la «forma típica» del GM, que es otra curva. Una curva compuesta del GM daría un avance mezclado. Por agrupación, cada parte avanza con su propia curva, igual que las filas de M7. |
| D8 | **Referencias:** la base por defecto pasa a ser **«Cierre 2026 por curva · corregido»**. La variante «sin Niño + rebote» desaparece (el rebote ya está dentro de la base corregida) y la reemplaza **«corregido»**, cuyo equivalente para 2027 es la cifra misma. «Año completo» (2025, normal) se mantiene: su equivalente deja de llevar el rebote (+5,0 % en lugar de +12,5 % en el ejemplo de 06d). «Cierre proyectado» (de la proyección) deja de ser una base elegible: queda como dato informativo. | Con la base corregida, una tendencia de años normales se aplica tal cual. El rebote solo hacía falta porque el % era bruto. |
| D9 | **`VERSION_METODO = 5` y `VERSION_METODO_MIN_M8 = 5`.** Toda proyección en trabajo queda «desactualizada: método nuevo» (no se fuerza; recalcular conserva las decisiones). En M8, una cerrada de método 4 muestra el aviso `cerrada_metodo_anterior` (no bloquea). | Una cerrada de método 4 lleva 2027 de las líneas del Niño sobre la base deprimida, que es justo lo que Javier quiere eliminar, y M8 compra 2027 con esos meses. Subir el mínimo solo avisa. Las cerradas no cambian. |
| D10 | Los **años sin Niño no cambian**: con `φ_Y ≡ 1` el método 5 da la misma cifra que el 4, fila por fila, y la pantalla no dibuja la línea corregida. | Regla R1 (prueba de propiedad). |

## 3. Modelo de datos (`0029_cierre_y_base_sin_nino.sql`)

Idempotente, sin `DROP`, `UPDATE`, `DELETE`, backfill ni bloques `do $$`. `revoke`/`grant` repetidos sobre la función. Depende de `0007`, `0015`, `0017`, `0018`, `0023` y `0027`, todas aplicadas. No depende de `0025` a `0028`.

### 3.1 `crecimientos_genero_mundo.sobre_base` (columna nueva)

```sql
alter table public.crecimientos_genero_mundo
  add column if not exists sobre_base text not null default 'bruta';      -- las versiones existentes quedan 'bruta'
alter table public.crecimientos_genero_mundo
  alter column sobre_base set default 'corregida';                         -- las nuevas, 'corregida' (la API la escribe igual)
comment on column public.crecimientos_genero_mundo.sobre_base is '...';
```

- Valores: `bruta` (el % es `Y+1 ÷ Y real − 1`; versiones de `0.12.1`) o `corregida` (el % es sobre `Y` corregido del Niño, desde `0.14.0`).
- **Sin `check` de catálogo** (criterio I6 de 06d, como `alcance` y `base_tipo`): lo valida zod. La API escribe el valor siempre explícito.
- **Por qué dos sentencias:** la primera fija `bruta` en las filas que ya existen, sin `UPDATE`. La segunda deja `corregida` como valor por defecto de las nuevas. Repetir la migración no cambia nada.
- `pct` conserva su `check` (−95 a 500). Su `comment on` se reescribe: «el % se interpreta según `sobre_base`».

### 3.2 `proyeccion_crecimientos.sobre_base` (la foto de lo aplicado)

`add column if not exists sobre_base text null`, con `comment on`. `null` = foto escrita antes de `0.14.0` (se lee como `bruta`). Cada cálculo reescribe la foto con el valor de la versión aplicada. Con eso, **B2, las explicaciones y las lecturas saben cómo se aplicó cada GM sin leer `crecimientos_genero_mundo`**: la foto se basta, como en 06d. El Resto usado va en `parametros.crecimiento_resto_usado.sobre_base` (clave nueva del `jsonb`, sin migración).

### 3.3 `proyeccion_fila_anios.base_normalizada` cambia de significado (solo `comment on`)

Desde el método 5 guarda **`B'`, la base de `Y` corregida del Niño** (lo que habrían vendido las mismas tiendas de `Y+1` en un año normal), y ya no `B'' = B' × Σ c φ_{Y+1}`. Las dos solo difieren si `Y+1` está marcado como atípico, y en ese caso `B''` deja de usarse (D5). No hace falta columna nueva: las proyecciones de método 4 quedan desactualizadas y la pantalla de GM las ignora (`version_metodo < 5`). `base_siguiente` (`B`, real) no cambia.

### 3.4 `venta_genero_mundo(p_desde date)`: misma firma, una dimensión más

`create or replace` con la misma firma y el mismo `returns jsonb`. Cada elemento de `series` gana `"a": "<agrupacion_estacionalidad_id>" | null` (`null` = sin agrupación activa) y el agrupamiento pasa a ser `(g, m, a, t)` en lugar de `(g, m, temp, t)`. `temp` se mantiene. Preagregación por `(equivalencia, tienda, periodo)` como hoy; mismos permisos (`revoke` a `public`, `anon` y `authenticated`; `grant` a `service_role`).

- **Compatible hacia atrás:** el lector de `0.12.1` (`comoVentaGeneroMundo`) ignora `a` y suma las entradas, así que con la migración aplicada antes del código todo sigue dando lo mismo.
- **Por qué hace falta:** el cierre por curva (D7) necesita lo vendido por agrupación, cada una con su curva. Hoy la función solo trae la temporada.
- **Presupuesto:** ≤ 3 s en frío (06d medía 1,63 s con 609 grupos). `datos` mide dos pasadas con `explain (analyze, buffers)` y lo anota. **Plan B** si pasa de 3 s: se deja `series` con el grano actual y se añade una clave `agr` con `(g, m, a, t)` solo para los periodos desde enero de `Y−1`, en la misma sentencia y con la misma huella de cargas. Esto se decide en la tanda 1 con la medición, sin cambiar la API.

### 3.5 Lo que no cambia

`factores_volumen_atipico`, `periodos_atipicos`, las pestañas «Años Niño» y «Periodos atípicos» de Curvas y «Factores del Niño» de M7 siguen igual (se mantienen ahí). `proyecciones.resumen` gana claves en el `jsonb` (§4.2), sin migración.

## 4. Contratos de API

Todo con `requirePlanner` (comprador `403`, sin sesión `401`), `{ data }` / `{ error, codigo }`, `leerCuerpo`, `traducirErrorDb`. Las rutas son las de 06d: **ninguna ruta nueva**.

### 4.1 Curvas → Crecimiento por género × mundo (`src/lib/crecimientos/`)

| Ruta | Cambio |
|---|---|
| `GET /api/curvas/genero-mundo` | `FilaGMApi` gana `cierre: CierreGMApi`, `base_corregida`, `correccion_nino_pct`. La proyección de referencia exige `version_metodo ≥ 5` (sin ella siguen funcionando el cierre por curva, el Acumulado y los Años completos). |
| `GET /api/curvas/genero-mundo/[clave]` | `DetalleGeneroMundoApi` gana `cierre_por_agrupacion`, `serie_corregida` y `cierre_proyeccion` (informativo). La serie de `Y` se completa con el cierre por curva (`origen = 'proyectado'`), no con la proyección. |
| `POST /api/curvas/genero-mundo/[clave]` | Bases y variantes nuevas; escribe `sobre_base = 'corregida'`; la foto `referencia` gana el bloque del método 5. Errores de 06d más `400 base_retirada` (zod: `cierre_proyectado` o `sin_nino_mas_rebote` en una aprobación nueva). |

```ts
// src/lib/crecimientos/tipos-api.ts (tanda 1)
export const SOBRE_BASE = ["bruta", "corregida"] as const;            // también se reexporta desde proyeccion/tipos-api
export type SobreBase = (typeof SOBRE_BASE)[number];
export const BASES_CRECIMIENTO = ["acumulado", "cierre_curva", "cierre_proyectado", "anio_completo", "aplicado_hoy", "ninguna"] as const; // lectura (incluye la heredada)
export const BASES_APROBABLES = ["acumulado", "cierre_curva", "anio_completo", "aplicado_hoy", "ninguna"] as const;                       // POST
export const VARIANTES_BASE = ["corregido", "bruto", "sin_nino_mas_rebote"] as const;   // lectura (sin_nino_mas_rebote: solo versiones de 0.12.1)
export const VARIANTES_APROBABLES = ["corregido", "bruto"] as const;                   // POST
export type MotivoObsoleto = "base_movida" | "base_no_calculable" | "composicion" | "factor_cambiado" | "metodo_anterior";
export type MotivoNuloReferencia = /* los de 06d */ "sin_referencia" | "metodo_anterior" | "sin_base" | "denominador_cero" | "sin_venta" | "sin_curva";

export type CierreGMApi = {
  k: number | null; tiendas: number;                 // C(Y)
  vendido: number; vendido_corregido: number;        // ene–k
  cierre: number | null; cierre_corregido: number | null;
  anterior: number | null; anterior_corregido: number | null;   // U(Y−1) y U'(Y−1) sobre C(Y)
  pct: number | null; pct_corregido: number | null;
  avance: number | null;                             // Σ V' ÷ Σ T' (avance ponderado)
  avance_bajo: boolean;                              // avance < UMBRAL_AVANCE (0,30)
  sin_curva_pct: number | null;                      // % del vendido corregido que se cerró con la curva compuesta
  hay_nino: boolean; factor_parcial: boolean; sin_factor: boolean;
  motivo_nulo: MotivoNuloReferencia | null;
};
export type CierreAgrupacionApi = {
  agrupacion_id: string | null; nombre: string; temporada: string;
  curva: { id: string; version: number } | null;    // null = sin curva vigente: se cerró con la compuesta
  avance: number | null; vendido: number; factor_meses: number[]; vendido_corregido: number;
  cierre: number | null; cierre_corregido: number | null;
  meses: (number | null)[]; meses_corregidos: (number | null)[];   // 12; los ≤ k son reales
};
// ReferenciaApi (06d) cambia así:
//   tipo: TipoReferencia (gana "cierre_curva"); variante_defecto: "corregido" | "bruto";
//   equivalente: { corregido: number | null; bruto: number | null; sin_nino_mas_rebote: null }   // sin_nino_mas_rebote queda siempre null
// FilaGMApi gana:
//   cierre: CierreGMApi; base_corregida: number | null /* Σ B' de la referencia ≥ 5 */; correccion_nino_pct: number | null /* Σ B' ÷ Σ B − 1 */;
//   vigente.sobre_base (en VersionCrecimientoApi): SobreBase
// DetalleGeneroMundoApi gana:
//   cierre_por_agrupacion: CierreAgrupacionApi[]; serie_corregida: SerieAnioGMApi | null /* solo si hay_nino */;
//   cierre_proyeccion: { nombre: string; cierre: number; cierre_corregido: number | null } | null;
```

```ts
// src/lib/crecimientos/esquemas.ts (tanda 1): cambia solo `base`
base: z.object({
  tipo: z.enum(BASES_APROBABLES),
  anio: z.number().int().min(2023).max(2100).nullable(),
  variante: z.enum(VARIANTES_APROBABLES),
}).strict(),
// Un valor heredado (cierre_proyectado, sin_nino_mas_rebote) no pasa zod: el handler lo traduce a 400 base_retirada
// («Esa base ya no se usa desde 0.14.0: elige “Cierre por curva” o “Aplicado hoy”»).
```

**Aprobar** (orden de 06d §3, con estos cambios):
1. `huella_datos` cubre además los ids y las versiones de las **curvas vigentes de las agrupaciones del GM** (`409 datos_cambiados` si se aprobó otra curva mientras tanto).
2. **R-N** (§5.2, R12) gana un caso: variante `bruto` sobre una referencia cuyo periodo toca un año Niño para el GM.
3. **`sin_cambio`** compara también `sobre_base`: una vigente `bruta` con el mismo % no es «sin cambio» y se puede reaprobar.
4. Inserta con `sobre_base = 'corregida'`.
5. Responde como en 06d. Además, `vigente.equivalente_real: number | null`: el % sobre 2026 real con la base de la referencia (§5.1, R5).

**Foto `referencia` de la versión (snapshot).** Además de lo de 06d: `metodo: 5`, `sobre_base: "corregida"`, `k`, `tiendas_cy` (ids), `cierre` (`CierreGMApi` completo), `cierre_por_agrupacion` (con `curva_id` y versión de cada agrupación), `factores: { anio, temporada, ratio, parcial }[]` (los de `Y` que tocan al GM), `serie_corregida` (12 meses), `base_siguiente` (`Σ B`), `base_corregida` (`Σ B'`), `correccion_nino_pct` y `equivalente_real`. Con ella la versión se explica sin releer venta, curvas ni factores, y `factor_cambiado` se evalúa contra `factores`.

### 4.2 M7 (`src/lib/proyeccion/`)

**Lógica pura (contratos que prueba vitest):**

```ts
// siguiente.ts
export type EntradaSiguiente = { /* 06d sin cambio */ ...; sobreBase?: SobreBase /* por defecto 'corregida' */ };
export type ResultadoSiguiente = {
  base: number | null;              // B (real)
  base_corregida: number | null;    // B' (antes base_nino): se persiste en base_normalizada
  propuesto: number | null; metodo: Metodo; meses: number[] | null; avisos: AvisoFila[];
  sobre_base: SobreBase;            // con la que se calculó
};
// Se retira el campo base_normalizada (B'') del resultado.

// tiendas-nuevas.ts (maduro_propio de Y+1)
export function maduroDeVigente(a: { vigente; curva; rampa; phi; sobreBase?: SobreBase }): number | null;
//   corregida: A' = vigente ÷ Σ_{m∈Y} c_m r_m φ_{Y,m}
//   bruta:     A^b = A' × Σ_{m=1..12} c_m φ_{Y,m}        (07c, sin cambio)

// crecimientos.ts (tanda 1, contratos)
export type MatrizCrecimientos = { ...06d; sobre?: ReadonlyMap<string /* claveGM */, SobreBase>; resto?: { id; version; sobre_base?: SobreBase } };
export type CrecimientoDeFila = { ...06d; sobre_base: SobreBase };   // fila con % propio y Resto provisional: 'corregida'
export type FilaCrecimiento = { ...07c; sobre_base?: SobreBase };    // la que se aplicó (para agregar)
// AgregadoCrecimientoApi gana: base_libre_corregida: number; pct_propio.base_corregida; decididas.base_corregida
//   base_normalizada pasa a ser Σ B'; rebote_nino_pct se renombra en la pantalla a «corrección del Niño» (mismo valor: Σ B' ÷ Σ B − 1)
export function calcularPromedio(celdas, resto, objetivo, puente, opciones?: { sobre?: SobreBase }): ...; // 'corregida': pondera por Σ B' y aplica sobre base_libre_corregida
```

**Persistencia y lecturas:**
- `proyeccion_fila_anios` de `Y+1` (filas base): `base_siguiente = round(B)`, `base_normalizada = round2(B')`.
- `AnioFilaApi`: `pct_bruto` se sigue llamando así y vale `vigente ÷ B − 1` («sobre 2026 real»); `pct_sobre_normalizada = vigente ÷ B' − 1` («sobre 2026 corregido»). `crecimiento_efectivo` gana `sobre_base`.
- `NodoMatrizApi.siguiente` gana `base_corregida` y `crec_corregida_pct` (`Σ vigente ÷ Σ B' − 1`). `crec_mismas_pct` se mantiene (sobre real). El Excel de la Matriz gana la columna.
- `ResumenProyeccion` gana `gm_con_nino: string[]`: las claves `genero_id|mundo_id` (y `resto`) cuyas filas base de `Y+1` cumplen `|Σ B' ÷ Σ B − 1| > 0,0005`. Lo escribe el cálculo y lo usan el cierre (D6) y la pestaña Crecimientos. Se quita de la API como `gm_gml`.
- `ParametrosProyeccion.crecimiento_resto_usado` gana `sobre_base`, y `parametrosDe` lo deja pasar (la lección B1 de 06d).
- `escribirFotoCrecimientos` escribe `sobre_base`. `cargarMatriz` lo lee (`null` → `bruta`).

**Cierre (`motivoRechazoCerrar`, `reglas.ts`), en este orden:**
1. `ya_cerrada`, `archivada`, `calculo_en_curso` (sin cambio).
2. `version_metodo` (no forzable; ahora `< 5`).
3. `crecimientos_cambiados` (no forzable, sin cambio).
4. **`factores_cambiados` (nuevo como motivo de cierre, no forzable)**, solo si el motivo de desactualización `factores_cambiados` incluye algún `«temporada Y»`. Mensaje: «Cambió el factor del Niño de invierno 2026, que corrige la base de 2027: recalcula (no se puede forzar).»
5. **`factor_faltante` (nuevo, no forzable):** alguna temporada con meses atípicos en `Y`, sin factor efectivo y con filas base activas de `Y+1` cuyo `φ_Y` la incluye. Detalle `{ faltan: { anio, temporada }[] }`. Mensaje: «Falta el factor del Niño de invierno 2026: sin él la base de 2027 no se corrige. Escríbelo en Factores del Niño (1,00 si no hubo efecto) y recalcula.»
6. `crecimientos_sin_aprobar` (no forzable). Su detalle gana `reaprobar: { clave, nombre, version }[]`: las vigentes `bruta` de GM en `resumen.gm_con_nino`, y el Resto si es `bruta` y `resto ∈ gm_con_nino`.
7. Filas y tiendas sin decidir; `desactualizada` (forzable).

`ProyeccionApi` gana `cierre_bloqueado_por?: { codigo: "factor_faltante" | "factores_cambiados"; mensaje }[] | null` (solo en trabajo), y `crecimientos_sin_aprobar` gana `reaprobar`. Con eso la cabecera deshabilita «Cerrar proyección» sin esperar al `409`. La carrera cerrar/aprobar de 06d (M5) sigue igual; la relectura posterior al `UPDATE` también vuelve a evaluar `reaprobar`.

**Prerrequisitos («Antes de proyectar»):** `factor_sin_calcular` del año `Y` sigue siendo aviso, con el texto nuevo «Falta el factor del Niño de invierno 2026: la base de 2027 de esa temporada no se corregirá y no podrás cerrar.»

**M8:** `VERSION_METODO_MIN_M8 = 5`. El texto de `cerrada_metodo_anterior` (`src/lib/flujo/tipos-api.ts`) pasa a «La cerrada se calculó con un método anterior a 0.14.0: el año siguiente de las líneas del Niño no está corregido. Archívala y cierra una nueva.» El flujo se calcula igual (solo avisa). M8 no gana ninguna otra lectura.

## 5. Reglas de negocio

### 5.1 Fórmulas exactas

**Notación.** `Y` = año del último mes cerrado `k` (1..12; si `Y < año de k`, `k = 12`). `C(Y)` = mismas tiendas del gráfico (06d §5.1). `a` = agrupación de estacionalidad del GM con venta. `c_a` = su curva vigente (`curvaDeFila`). `φ_{a,Y,m}` = factor de su temporada en el mes `m` de `Y` (`crearPhi`: 1 en `todo_el_ano` y `sin_agrupacion`; 1 con aviso `sin_factor` si falta). Sin redondeos intermedios: la pantalla redondea al mostrar y las pruebas comparan a 2 decimales.

**Cierre por curva del GM (pantalla, D7).** Para cada `a`:
- `v_{a,m} = max(0, Σ_{t∈C(Y)} U(a,t,Y,m))` para `m ≤ k`; `V_a = Σ v`; `V'_a = Σ v_{a,m} ÷ φ_{a,Y,m}`.
- Si `a` tiene curva y `C_{k,a} = Σ_{m≤k} c_{a,m} > 0`: `T'_a = V'_a ÷ C_{k,a}`.
- Si no (sin agrupación, sin curva vigente o `C_k = 0`), se usa la **curva compuesta del GM** `c̄ = Σ_b w_b c_b ÷ Σ_b w_b`, con `b` las agrupaciones del GM que sí tienen curva y `w_b = U'_b(Y−1)` sobre `C(Y)` (o `V'_b` si `Y−1` no tiene venta). Lleva el aviso `sin_curva` con `sin_curva_pct = Σ V'` de esas partes `÷ Σ V'`. Sin ninguna curva en el GM: cierre `null`, `motivo_nulo = sin_curva`.
- Meses `m > k`: proyectado real `p_{a,m} = T'_a c_{a,m} φ_{a,Y,m}`; corregido `p'_{a,m} = T'_a c_{a,m}`.
- `K_a = V_a + Σ_{m>k} p_{a,m}` (real) y `K'_a = V'_a + Σ_{m>k} p'_{a,m} = T'_a` (corregido).

Del GM: `K = Σ_a K_a`, `K' = Σ_a K'_a`, `pct = K ÷ U(Y−1) − 1`, `pct_corregido = K' ÷ U'(Y−1) − 1` (sobre `C(Y)`), avance `= Σ V' ÷ Σ T'` (`avance_bajo` si `< 0,30`). Con `k = 12`, `K = V` y `K' = V'`. El Resto se calcula igual sobre la suma de los GM no detallados.

**Serie de `Y` en el gráfico.** Meses `≤ k`: real (`origen = 'real'`). Meses `> k`: `Σ_a p_{a,m}` (`origen = 'proyectado'`). **Serie corregida** (`serie_corregida`, solo si `hay_nino`): `Σ_a v_{a,m} ÷ φ_{a,Y,m}` en `≤ k` y `Σ_a p'_{a,m}` en `> k`; su total es `K'`. **Vista previa de 2027** (en el navegador): `serie_corregida_m × (1 + g)`, con `g` el % del campo de aprobar o el vigente. Es de las mismas tiendas de 2026 y está rotulada así.

**Referencias (D8).** «Equivalente para 2027» = el % que se escribiría sobre 2026 corregido:
- Cierre por curva: `equivalente.corregido = pct_corregido` y `equivalente.bruto = pct`.
- Acumulado y Año completo: `equivalente.corregido = pct_sin_nino` y `equivalente.bruto = pct_bruto`.
- Aplicado hoy (solo con referencia `≥ 5`): con `sobre_base = corregida`, `g` aplicado; con `bruta`, `Σ vigente_{Y+1} ÷ Σ B' − 1`. Su `pct_bruto` es el «sobre 2026 real» (`Σ vigente_{Y+1} ÷ Σ B − 1`).
- `variante_defecto = "corregido"` siempre (en un GM sin Niño los dos valores coinciden).
- `equivalente.sin_nino_mas_rebote` queda `null`.

**Base corregida y % en M7 (método 5), fila base de `Y+1`.**
- `B` (sin cambio, 07 paso 2) = vigente de `Y` de la fila base + aportes de las tiendas nuevas que pasan a `M(Y+1)` − salientes.
- `B' = Σ_m b_m ÷ φ_{Y,m}`, con `b_m` el reparto mensual de `B` (real + resto + aportes) y el `φ_{Y,m}` de la fila (`factores_mes[Y]`, ponderado si mezcla temporadas). Con `φ` constante, `B' = B ÷ φ`. Es lo que `siguiente.ts` ya calcula como `base_nino`.
- `g` por precedencia (sin cambio): % propio de la fila > GM vigente > Resto vigente > `crecimiento_pct_defecto`. `s` = `sobre_base` de esa fuente (la fila y el Resto provisional, `corregida`).
- `P = round(B' × (1 + g/100))` si `s = corregida`; `P = round(B × (1 + g/100))` si `s = bruta`.
- Reparto `c'_m ∝ c_m φ_{Y+1,m}` (sin cambio).
- Lo que se muestra: `pct_sobre_normalizada = vigente ÷ B' − 1` («sobre 2026 corregido») y `pct_bruto = vigente ÷ B − 1` («sobre 2026 real»).
- **Tienda `maduro_propio` de `Y+1`:** `P = round(A' × (1 + g) × Σ_{m∈Y+1} c_m r_m)`, con `A' = vigente_{t,f,Y} ÷ Σ_{m∈Y} c_m r_m φ_{Y,m}` si `s = corregida` (o `A^b` de 07c si `bruta`), repartido con `c r φ_{Y+1}`.
- Aperturas de `Y+1` (07d), cierres y el año en curso: **sin cambio**. La asimetría de 07d (`φ_{Y+1}` mueve el nivel en aperturas) se mantiene.

### 5.2 Ejemplos sintéticos

**A · Cierre por curva de HOMBRE · URBANO (`Y = 2026`, `k = 9`, `C(2026)` = 9 tiendas; 2025 normal = 54 000 u).**

| Agrupación | Temporada · φ 2026 | Curva | `C_9` | `V` ene–set | `V'` | `T'` | oct · nov · dic real | Cierre real | Cierre corregido |
|---|---|---|---|---|---|---|---|---|---|
| ABRIGOS HO | invierno · 0,80 todo el año | v3: oct 0,05 · nov 0,07 · dic 0,08 | 0,80 | 12 000 | 15 000 | 18 750 | 750 · 1 050 · 1 200 | 15 000 | 18 750 |
| POLOS HO | todo el año · 1 | v2: oct 0,08 · nov 0,09 · dic 0,10 | 0,73 | 29 200 | 29 200 | 40 000 | 3 200 · 3 600 · 4 000 | 40 000 | 40 000 |
| **GM** | | | | **41 200** | **44 200** | | 3 950 · 4 650 · 5 200 | **55 000 (+1,9 %)** | **58 750 (+8,8 %)** |

- Serie corregida de oct, nov y dic: 4 137,5 · 4 912,5 · 5 500.
- Acumulado ene–set: 41 200 ÷ 40 000 → **+3,0 %** real y 44 200 ÷ 40 000 → **+10,5 %** corregido (como en 06d). Año completo 2025: **+5,0 %** (equivalente para 2027: +5,0 %).
- Vista previa 2027 al 8 %: 58 750 × 1,08 = **63 450** (mismas tiendas de 2026).

**B · La base corregida en M7 y el % aprobado (dos filas del mismo GM; T10 abrió en 2025 y entra en `M(2027)`).**

| Fila | `B` (2026 real, tiendas de 2027) | `φ_2026` | `B'` | 2027 al 8 % sobre corregido | sobre 2026 real |
|---|---|---|---|---|---|
| ABRIGO × RECONOCIDO (invierno) | 15 000 + T10 300 = 15 300 | 0,80 constante | 19 125 | round(19 125 × 1,08) = **20 655** | +35,0 % |
| POLO × VALOR (todo el año) | 40 000 + T10 800 = 40 800 | 1 | 40 800 | **44 064** | +8,0 % |
| **GM** | **56 100** | | **59 925** (corrección +6,8 %) | **64 719** (+8,0 %) | **+15,4 %** |

- Con el método 4, el mismo 8 % daba 16 524 + 44 064 = 60 588, que es **+1,1 % sobre 2026 corregido**: el invierno se quedaba en el nivel deprimido del Niño.
- Para que el GM creciera +15,4 % real con el método 4, el POLO también habría crecido +15,4 % (el rebote del invierno repartido a una línea que no lo tuvo).
- En pantalla: «8,0 % sobre 2026 corregido (59 925 → 64 719) = +15,4 % sobre 2026 real (56 100)».

**C · Verano: la corrección también baja la base.** CAMISETA × VALOR (verano; Niño de setiembre a diciembre con φ 1,31; `k = 9`). Meses de `B`: ene–ago 6 000, setiembre real 1 310, oct–dic proyectado 6 550 → `B = 13 860`. `B' = 6 000 + 1 310 ÷ 1,31 + 6 550 ÷ 1,31 = 12 000`. Al 8 %: **12 960**, que es **−6,5 % sobre 2026 real**. La pantalla dice «2026 vendió de más por el Niño en esta temporada».

**D · Versión aprobada antes de `0.14.0` en un GM con Niño.** HOMBRE · URBANO v1 = 15 % `bruta`. Al recalcular con el método 5: 17 595 + 46 920 = **64 515**, la misma cifra de antes (nada salta). Es +15,0 % real y **+7,7 % sobre 2026 corregido** (64 515 ÷ 59 925). La proyección no se puede cerrar: «HOMBRE · URBANO v1 se aprobó como % bruto antes de 0.14.0 y este GM tuvo Niño en 2026: reapruébalo». En la pantalla, «Reaprobar» precarga «Aplicado hoy · corregido» = 7,7 % (sin nota) y crea la v2 `corregida`, con el mismo resultado de 2027.

**E · GM sin Niño.** MUJER · FORMAL, solo líneas de todo el año: `B' = B`. Una v1 `bruta` al 10 % sigue valiendo para cerrar, da lo mismo con los métodos 4 y 5, no aparece la línea corregida y la pantalla muestra un solo % («= sobre 2026 real»).

**F · R-N.** Base «Cierre 2026 por curva · corregido» = +8,8. Javier escribe 8,0: la diferencia es 0,8 pp > 0,5, así que la nota es obligatoria. Elegir la variante `bruto` del Acumulado (+3,0) en este GM con Niño también la exige.

### 5.3 Reglas que el código garantiza (cada una con su prueba vitest)

| # | Regla | Dónde |
|---|---|---|
| R1 | Con `φ_Y ≡ 1`, `proponerSiguiente` (método 5) da el mismo `P`, `meses` y `B` que el método 4, para cualquier `g`, curva y aportes (prueba de propiedad). `B' = B`. | `siguiente.ts` |
| R2 | Con `φ_Y` constante, `P = round(B ÷ φ × (1+g))`; con `φ_Y` por meses (verano), `B' = Σ b_m ÷ φ_m`. Ejemplos B y C exactos. `φ_{Y+1}` cambia el reparto y no `P`. | `siguiente.ts` |
| R3 | `sobreBase = 'bruta'` reproduce el método 4 (`round(B × (1+g))`). | `siguiente.ts` |
| R4 | Precedencia fila > GM > Resto > defecto sin cambio. `sobre_base`: fila y Resto provisional → `corregida`; GM y Resto aprobados → el de la versión; una foto con `sobre_base null` → `bruta`. | `crecimientos.ts` |
| R5 | El GM del ejemplo B da 64 719, +8,0 % sobre corregido y +15,4 % sobre real. `calcularPromedio(…, { sobre: 'corregida' })` pondera por `Σ B'`. | `crecimientos.ts` |
| R6 | `maduro_propio` corregida: `A' = vigente ÷ Σ c r φ_Y`. Con `φ_Y = 1` coincide con `A^b`; con Niño 0,66, `A' > A^b`. | `tiendas-nuevas.ts` |
| R7 | En una fila base sin aportes, `|B' − T'| ≤ 1` u (`T'` = `total_normalizado` del cierre de `Y`). | `calculo.ts` |
| R8 | Cierre por curva: el ejemplo A da 55 000 / 58 750 / +1,9 % / +8,8 %, con los meses de la tabla. Con `k = 12`, `K = V`. Una agrupación sin curva usa la compuesta y marca `sin_curva_pct`. Un GM sin ninguna curva da `null` con `sin_curva`. Con avance < 0,30, `avance_bajo`. | `cierre-curva.ts` |
| R9 | Con `φ = 1` en todos los meses, la serie corregida no se emite (`hay_nino = false`) y `pct_corregido = pct`. | `cierre-curva.ts` |
| R10 | Referencias: `equivalente.corregido` = `pct_corregido` / `pct_sin_nino`; `sin_nino_mas_rebote` siempre `null`; `variante_defecto = corregido`; Año completo 2025 del ejemplo de 06d da +5,0. | `referencias.ts` |
| R11 | `POST` con `cierre_proyectado` o `sin_nino_mas_rebote` → `400 base_retirada`, sin escribir. Una aprobación nueva guarda `sobre_base = corregida` y la foto con `metodo: 5`, `cierre`, `factores` y `serie_corregida`. | ruta |
| R12 | R-N: obligatoria con base `ninguna` o no calculable, con `|pct − base_valor| > 0,5`, o con variante `bruto` cuando el periodo de la referencia toca un año Niño del GM. | `reglas.ts` |
| R13 | `sin_cambio` exige además el mismo `sobre_base`: una vigente `bruta` se reaprueba con el mismo %. | `reglas.ts` |
| R14 | Obsolescencia (informativa), en este orden: `metodo_anterior` (vigente `bruta` y GM con Niño en `Y`) > `composicion` > `factor_cambiado` (algún factor de `Y` de la foto ≠ el efectivo de hoy) > `base_no_calculable` > `base_movida`. | `reglas.ts` |
| R15 | `gm_con_nino` lista exactamente los GM con `|Σ B' ÷ Σ B − 1| > 0,0005`. | `calculo.ts` |
| R16 | Cierre: `factor_faltante`, `factores_cambiados` de `Y` y `crecimientos_sin_aprobar` con `reaprobar` no se fuerzan. `factores_cambiados` de otro año sigue siendo forzable. Orden de §4.2. | `reglas.ts` |
| R17 | Una vigente `bruta` de un GM fuera de `gm_con_nino` no entra en `reaprobar`. | `vigentes.ts` |
| R18 | `VERSION_METODO = 5`: una proyección en trabajo de método 4 queda con `version_metodo` y no se cierra ni forzando. Recalcular conserva `decidido` y `crecimiento_pct`, y una 2027 decidida queda con `propuesta_cambio` si su propuesta se movió. Una cerrada no cambia. | `desactualizado.ts`, ruta |
| R19 | B2: decidir una fila de `Y` (o una tienda que pasa a `M(Y+1)`) recalcula `P` con `B'` y el `sobre_base` de la foto, sin releer factores. Un `PATCH` de umbral conserva `crecimiento_resto_usado.sobre_base`. | `decision.ts`, ruta |
| R20 | M8: con una cerrada de `version_metodo = 4` aparece `cerrada_metodo_anterior` y el flujo se calcula igual; con 5, no. | `flujo/modelo.ts` |
| R21 | `venta_genero_mundo` nueva: el lector de `0.12.1` suma lo mismo que antes (prueba con un `jsonb` con y sin `a`), y el lector nuevo agrupa por `a`. Cambiar la curva vigente de una agrupación cambia `huella_datos`. | `series.ts`, `huellas.ts` |
| R22 | Permisos: el comprador recibe `403` en las tres rutas de 06d y en `POST …/cerrar`. | ruta |

### 5.4 Casos borde

| Caso | Comportamiento |
|---|---|
| Año sin Niño para el GM | Nada nuevo a la vista: un solo %, sin línea corregida, cifras idénticas al método 4 (R1). |
| Factor de `Y` parcial (calculado con ene–`k`) | Se usa tal cual con la marca «factor parcial (ene–set)» en la banda, en «Cómo se cierra» y en el aprobar. Cuando M7 lo vuelve a sincronizar con un mes más, las proyecciones quedan con `factores_cambiados` (no se cierra hasta recalcular, D4) y la vigente queda «obsoleto: factor cambiado». |
| Temporada con Niño y sin factor | Pantalla: `φ = 1` con el aviso «sin factor: 2026 de invierno no se corrigió». M7 calcula con `B' = B` y el aviso en la fila; cerrar da `409 factor_faltante` (D3). |
| GML que mezcla temporadas | `φ` ponderado por mes (D2), con el aviso `temporadas_mezcladas`. La suma por GM de la pantalla (exacta por temporada) puede diferir un poco de `Σ B'` de M7; la pantalla rotula las dos cifras con sus tiendas. |
| Agrupación sin curva vigente o equivalencias sin agrupación | Se cierran con la curva compuesta del GM, con `sin_curva_pct` a la vista. |
| Poco avance (enero a abril) | Se calcula igual, con «avance bajo: la cifra es frágil». No hay `plan_anterior` en la pantalla (es un dato de M7). |
| `k = diciembre` | El cierre es la venta real y el corregido es real ÷ φ. |
| Tienda de `C(Y)` que cierra después de `k` | Se proyecta su año entero (es informativo). En M7 el cierre de `Y+1` sale de `B`, como hoy. |
| `Y+1` marcado como Niño | `φ_{Y+1}` solo da forma; el aviso de 07c se mantiene con el texto «2027 marcado como Niño: tu % sobre 2026 corregido debe incluirlo». |
| Versión `bruta` de un GM con Niño | Se aplica como bruta y la pantalla muestra «obsoleto: aprobado como bruto antes de 0.14.0 · Reaprobar». La proyección no cierra hasta reaprobar (ejemplo D). |
| Fila con % propio escrito antes de `0.14.0` en una línea con Niño | Pasa a significar «sobre 2026 corregido» (no hay columna para distinguirlo). La tanda 1 cuenta cuántas hay (06d medía 0). Si hay alguna, el CHANGELOG las lista y Javier las revisa en Por línea, donde se ven los dos %. |
| Sin proyección de referencia de método 5 | Cierre por curva, Acumulado y Años completos funcionan y se puede aprobar. El equivalente sobre real se estima con el cierre por curva (`K' × (1+g) ÷ K − 1`), rotulado «estimado con las mismas tiendas de 2026». La base 2027 y «Aplicado hoy» muestran «— recalcula la proyección (método nuevo)». |
| Proyección cerrada de método 4 | No cambia. En la pantalla de GM no se puede elegir como referencia. M8 avisa (D9). Para usar el método 5 en M8 hay que archivarla y cerrar otra. |

## 6. Pantallas (admin y planner; formato `es-PE`; kit `Card`, `DataTable`, `Field`, `Badge`, `Alert`, `Modal`, `Tabs`)

### 6.1 Curvas → «Crecimiento por género × mundo»

**Lista.**
- Texto fijo: «% de 2027 sobre la venta de 2026 corregida del Niño, de las mismas tiendas de 2027. En un GM sin Niño, corregida = real. Cada línea crece ese % sobre su propia base corregida.»
- Columnas:
  - género · mundo · u. 2025;
  - acumulado ene–set (real / corregido);
  - **cierre 2026 por curva** (u. corregidas, % real / % corregido; badges «avance bajo», «sin curva 4 %», «factor parcial»);
  - aplicado hoy (sobre corregido · sobre real);
  - **base 2027** (real / corregida, con «corrección del Niño +6,8 %»);
  - crecimiento 2027 aprobado (vN, quién y cuándo; badge «bruto · antes de 0.14.0» si es `bruta`);
  - estado · Trabajar.
- Total: ponderado por `Σ B'` y su equivalente sobre real.
- La proyección de referencia ofrece solo las de `version_metodo ≥ 5`.

**Detalle de un GM:**
1. **Curva de venta** (`calcularGeometriaCurvas`):
   - 2023 a 2025 en trazo continuo; 2026 continuo hasta `k` y **discontinuo con el cierre por curva** después;
   - **«2026 corregido (sin Niño)»** en el mismo color, punteado, los doce meses, solo si `hay_nino`. La leyenda dice «invierno ÷ 0,80; verano set–dic ÷ 1,31»;
   - **«2027 vista previa (8,0 %)»** en discontinuo claro, que se mueve al escribir el %;
   - modos Unidades / Forma / Sin Niño. En «Sin Niño», 2026 es la serie corregida, sin línea aparte; en «Forma», las dos líneas extra no se dibujan;
   - bandas del Niño como en 06d.
2. **Tabla año × mes:**
   - filas 2023…2026, **«2026 corregido (sin Niño)»** debajo de 2026 y **«2027 vista previa»**;
   - total y variación frente al año anterior (la fila corregida compara con 2025 corregido);
   - celdas proyectadas en cursiva con la marca «p»;
   - el CSV lleva las mismas filas.
3. **Cómo se cierra 2026** (bloque nuevo): la tabla del ejemplo A, una fila por agrupación (curva vN, avance a set, vendido, factor, vendido corregido, cierre real y corregido) más el total. Avisos: avance bajo, sin curva, factor parcial y sin factor, con el enlace «Cambiar el factor en Proyección → Factores del Niño». Debajo, si hay referencia ≥ 5: «En la proyección «Plan 2026»: 55 620 u real · 59 620 corregido (mismas tiendas de 2026 de la proyección)».
4. **Cómo crece:**
   - referencias en este orden: Cierre por curva, Acumulado, Año completo 2025 y 2024, Aplicado hoy;
   - columnas: periodo, tiendas, anterior, actual, % real, % corregido y «equivale para 2027 (sobre 2026 corregido)»;
   - marcas frágil, extremo, tienda mayor y cobertura, como en 06d;
   - si 2026 fue Niño para el GM: `Alert` «2026 fue Niño en invierno: el % de 2027 se escribe sobre 2026 corregido (58 750 u, +8,8 % frente a 2025)».
5. **Aprobar 2027** (HOMBRE, MUJER y Resto):
   - selector «Base» (por defecto «Cierre 2026 por curva · corregido»; la variante «real» está disponible y en un GM con Niño exige nota);
   - campo **«% 2027 sobre 2026 corregido»**;
   - al lado, en vivo: «= +15,4 % sobre 2026 real · base 2027: 56 100 real / 59 925 corregida → 64 719 u», o la estimación rotulada si no hay referencia ≥ 5;
   - nota según R-N;
   - «Aprobar v3», con un `confirm` que repite los dos %, la base y cuántas proyecciones quedarán desactualizadas.
   - Si la vigente es `bruta` y el GM tuvo Niño: `Alert` «v1 (15 % bruto) se aprobó antes de 0.14.0; hoy equivale a +7,7 % sobre 2026 corregido» con el botón **Reaprobar**, que precarga «Aplicado hoy · corregido».
   - Tras aprobar: «Aprobado. Recalcula la proyección y sigue en Por línea» (el flujo que pidió Javier: GM primero, líneas después).
6. **Versiones:** cada una con «sobre 2026 corregido» o «bruto (antes de 0.14.0)». «Ver foto» muestra también el cierre por agrupación y los factores.

### 6.2 Proyección

| Lugar | Cambio |
|---|---|
| Por línea · campo «Crec.» | Ayuda: «% de 2027 sobre la venta de 2026 corregida del Niño de esta fila. Vacío = el aprobado de HOMBRE · URBANO (8 %).» El marcador dice «8 % · HOMBRE · URBANO v2» o «15 % bruto · HOMBRE · URBANO v1 (reaprobar)». |
| Por línea · detalle y pie | «+8,0 % sobre 2026 corregido (19 125) · +35,0 % sobre 2026 real (15 300)». En verano, «2026 vendió de más por el Niño». La explicación: «2027 → base 2026 de las 10 tiendas de 2027 = 15 300, corregida del Niño de invierno (÷ 0,80) = 19 125 × 1,08 (8 % de HOMBRE · URBANO v2, sobre 2026 corregido) = 20 655 (+35,0 % sobre 2026 real), repartido con ABRIGOS HO v3.» |
| Matriz | «Crec. mismas tiendas» se parte en **«Crec. sobre 2026 corregido»** y **«Crec. sobre 2026 real»**, con el título: «El % que apruebas se aplica sobre 2026 corregido del Niño; “real” compara con lo vendido. Var. incluye además tiendas nuevas, aperturas y cierres». En el Excel también. |
| Pestaña Crecimientos (solo lectura) | Por GM: % aplicado (con `sobre_base`), base real y corregida, «corrección del Niño», 2027 resultante, % sobre corregido y sobre real; badge «reaprobar» si aplica. |
| Cabecera y modal de cierre | `factor_faltante`, `factores_cambiados` (de `Y`) y `reaprobar` entran en `MOTIVOS_NO_FORZABLES`; el modal los lista con su enlace. |
| Factores del Niño | Texto fijo: «El factor de 2026 corrige la base de 2027 de cada temporada (método 5). Si una temporada no tuvo efecto, escribe 1,00.» |
| Nueva proyección | «Resto provisional (%, sobre 2026 corregido)». |

## 7. Fuera de alcance

- Normalización exacta por equivalencia dentro de un GML mixto (D2): cambiaría también el cierre del año en curso.
- Curva compuesta del GM para normalizar (D1, descartada).
- Cambiar el paso 1 de M7 (cierre de `Y` por fila): queda igual.
- Pronosticar el Niño de `Y+1`.
- Editar el factor desde la pantalla de GM (solo enlace).
- Convertir automáticamente las versiones `bruta`.
- Distinguir el sentido del % propio de filas escritas antes de `0.14.0`.
- `plan_anterior` en la pantalla de GM.
- Aprobar géneros distintos de HOMBRE y MUJER, aprobación en bloque y sugerencias de % (06d §7).
- Soles.
- Borrar los tipos heredados (`cierre_proyectado`, `sin_nino_mas_rebote`), que quedan solo para leer versiones viejas.

## 8. Criterios de aceptación (hito de Javier)

**Verificación previa (tanda 1, `datos`, SOLO `SELECT` en `vector-two`, nunca en `lukers-compras`):**
1. `factores_volumen_atipico`: filas de 2026 y 2027 por temporada (`ratio_calculado`, `ratio_aplicado`, `parcial`).
2. `periodos_atipicos` activos que cubren 2026 y 2027, con `temporadas`.
3. `crecimientos_genero_mundo` vigentes por año y alcance (cuántas quedarán `bruta`).
4. `proyecciones` por estado y `resumen->>'version_metodo'` (¿hay alguna cerrada de método 4?).
5. `count(*)` de `proyeccion_fila_anios` con `crecimiento_pct is not null`.
6. Número de agrupaciones con venta por GM (para estimar el tamaño de `venta_genero_mundo`).

Si (4) muestra una cerrada de método 4, el CHANGELOG avisa que M8 mostrará `cerrada_metodo_anterior`. Si (5) es mayor que 0, se listan esas filas (§5.4).

**Precondiciones del hito:** `0.13.1` construida y commiteada; `0029` aplicada; revisar los factores de 2026 en Factores del Niño (sincronizar o escribir); **recalcular la proyección 2026 en trabajo con `0.14.0`**.

1. En «Crecimiento por género × mundo», cada GM muestra el **cierre 2026 por curva** sin depender de la proyección. En HOMBRE · URBANO (o el GM de invierno más grande), «Cómo se cierra 2026» lista sus agrupaciones con curva, avance, factor y cierres, y se comprueba a mano una fila con §5.1.
2. El gráfico muestra 2026 completo (real y proyectado), la línea «2026 corregido (sin Niño)» y la «2027 vista previa», que se mueve al escribir el %. La tabla año × mes trae las dos filas nuevas y el CSV también. Un GM solo de todo el año no muestra la línea corregida.
3. Las referencias muestran «Cierre por curva» como base por defecto, y ya no aparece «sin Niño + rebote».
4. **[ESCRIBE]** Aprobar un % distinto del precargado sin nota se rechaza; con nota crea la versión «sobre 2026 corregido», y el `confirm` muestra los dos %.
5. **[ESCRIBE]** Si había una versión de `0.12.1` en un GM con Niño: la lista la marca «aprobado como bruto», la proyección recalculada conserva su 2027 y no deja cerrar (`reaprobar`); «Reaprobar» con «Aplicado hoy» en un clic la desbloquea sin mover cifras.
6. La proyección en trabajo aparece «desactualizada: método nuevo» antes de recalcular y no cierra ni forzando. Después de recalcular:
   - una línea de invierno con Niño muestra «+8,0 % sobre 2026 corregido · +x % sobre 2026 real»;
   - una de verano con Niño puede bajar sobre real;
   - una línea sin Niño queda con la misma cifra que antes;
   - ninguna decisión se pierde.
7. La Matriz muestra «Crec. sobre 2026 corregido» = el % aprobado del GM (sin filas fijadas) y «Crec. sobre 2026 real», también en el Excel.
8. **[ESCRIBE]** Cambiar el factor de invierno 2026: la proyección queda desactualizada por factores, «Cerrar de todos modos» se rechaza y recalcular lo resuelve. Con un factor faltante, `409 factor_faltante`; escribir 1,00 lo resuelve.
9. En M8, con una cerrada de método 4 aparece el aviso del método anterior; con una de método 5, no.
10. Pasan `lint`, `tsc`, `vitest` y `build`; la `0029` corre dos veces seguidas; `venta_genero_mundo` ≤ 3 s en frío, medida y anotada; `APP_VERSION = "0.14.0 · M6"`.

## Plan de tandas (sin pisarse)

**Regla:** cada archivo tiene un solo dueño en cada tanda. Un dueño solo puede cambiar en un traspaso secuencial, que queda escrito aquí. Lo que la tanda 1 añade a tipos existentes es **opcional o nuevo**, para que `lint`, `tsc` y `vitest` pasen en cada commit. **`VERSION_METODO` y `VERSION_METODO_MIN_M8` suben en el último commit de Backend B**, junto con la prueba que fija sus valores. Antes de eso, todo fixture que escriba `version_metodo: 4` a mano pasa a importar la constante. **Orden:** se construye después de `0.13.1 · M8` (comparten `database.types.ts`, `version.ts`, CHANGELOG y los fixtures de `tests/flujo*`).

### Tanda 1 (en paralelo)

**Datos** (`datos`):
- `supabase/migrations/0029_cierre_y_base_sin_nino.sql`, `scripts/humo-0029.sql` y `src/lib/supabase/database.types.ts` (regenerado).
- Hace la verificación previa (§8), aplica la `0029`, mide la función y decide el plan B si hace falta (§3.4).

**Backend · contratos** (`backend`):
- `src/lib/crecimientos/tipos-api.ts`, `src/lib/crecimientos/esquemas.ts` (§4.1).
- `src/lib/crecimientos/vigentes.ts`: `sobre_base` en `VigenteCrecimiento`, `matrizDeVigentes` con `sobre` y `faltantesDeCierre(…, gmConNino)` con `reaprobar`.
- `src/lib/crecimientos/consultas-vigentes.ts` (lee `sobre_base`; se commitea al regenerarse los tipos).
- `src/lib/proyeccion/crecimientos.ts`: `MatrizCrecimientos.sobre`, `CrecimientoDeFila.sobre_base`, `agregarFilas` con las bases corregidas y `calcularPromedio` con `opciones.sobre`.
- `src/lib/proyeccion/tipos-api.ts`: tipos nuevos opcionales (`SobreBase`, `crecimiento_resto_usado.sobre_base`, `crecimiento_efectivo.sobre_base`, `base_corregida` y `crec_corregida_pct` en la Matriz, `gm_con_nino` en el resumen, `cierre_bloqueado_por` y `reaprobar` en `ProyeccionApi`, códigos `factor_faltante` y `base_retirada`). **No toca las dos constantes.**
- Pruebas: `tests/crecimientos.vigentes.test.ts`, `tests/crecimientos.esquemas.test.ts`, `tests/crecimientos.consultas-vigentes.test.ts`, `tests/proyeccion.crecimientos.test.ts` (R4, R5, R17).
- Al cerrar la tanda, **`src/lib/proyeccion/tipos-api.ts` pasa a Backend B.**

### Tanda 2 (cuatro en paralelo)

**Backend A · pantalla de GM** (`backend`):
- `src/lib/crecimientos/cierre-curva.ts` (nuevo, puro) y `src/lib/crecimientos/{series,referencias,reglas,huellas,consultas,servicio,cache}.ts`. El servicio lee las curvas vigentes con `leerCurvasVigentes` y `curvaDeFila`, sin modificarlos. La clave de caché lleva un prefijo de versión `v2|`.
- Pruebas: `tests/crecimientos.cierre-curva.test.ts` (nueva: R8, R9) y `tests/crecimientos.{referencias,reglas,huellas,cache,rutas,estatico}.test.ts` (R10 a R14, R21, R22). `tests/crecimientos.fixture.ts` y `tests/crecimientos.fake-db.ts` ganan `a`, curvas y `sobre_base`, y usan `VERSION_METODO` importado.
- No escribe `.from("proyecciones" | "proyeccion_…")` (prueba estática de 06d).

**Backend B · método 5 y cierre** (`backend`):
- `src/lib/proyeccion/{siguiente,tiendas-nuevas,decision,calculo,explicar,persistencia,matriz,excel,reglas,desactualizado,servicio,servicio-base,servicio-crecimientos,servicio-lectura,servicio-edicion,consultas}.ts`.
- `src/lib/proyeccion/tipos-api.ts` (desde esta tanda; el último commit sube `VERSION_METODO = 5` y `VERSION_METODO_MIN_M8 = 5`).
- `src/lib/flujo/tipos-api.ts` (solo el texto de `cerrada_metodo_anterior`).
- Pruebas: `tests/proyeccion.metodo5.test.ts` (nueva: R1 a R3, R6, R7, R15, R19), `tests/proyeccion.cierre.test.ts` (la propiedad «`P` no depende de `φ_Y`» del método 4 pasa a probarse con `sobreBase = 'bruta'`), y además `tests/proyeccion.{reglas,crecimientos-globales,crecimientos-rutas,rutas,endurecimiento,persistencia,matriz,tiendas-nuevas-venta-mensual,estatico}.test.ts`, `tests/proyeccion.{fake-db,contexto-falso,fixture}.ts` (R16, R18), y `tests/flujo.{modelo,tamano-real}.test.ts`, `tests/flujo.{fixture,soporte}.ts`, `tests/compras.fake-db.ts` (literales → `VERSION_METODO_MIN_M8`; R20).

**Frontend A · pantalla de GM** (`frontend`):
- `src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/**` (lista, detalle, gráfico, tabla, bloque «Cómo se cierra», referencias, aprobar, versiones y `vista.ts` con la vista previa de 2027 pura).
- Pruebas: `tests/crecimientos.pantalla.fixture.ts`, `tests/crecimientos.pantalla-vista.test.ts`, `tests/crecimientos.pantalla-render.test.ts`.

**Frontend B · proyección** (`frontend`):
- `src/app/(app)/planificacion/proyeccion/{crecimientos-tab.tsx,crecimientos-vista.ts,matriz-tab.tsx,detalle-fila.tsx,bloque-decision.tsx,tabla-filas.tsx,vista.ts,cerrar-modal.tsx,cabecera-proyeccion.tsx,formulario-proyeccion.tsx,factores-tab.tsx}`. `VERSION_METODO_CRECIMIENTOS` se reemplaza por `VERSION_METODO` importado.
- Pruebas: `tests/proyeccion.{crecimientos-vista,crecimientos-render,render,vista,pantalla.estatico}.test.ts`, `tests/proyeccion.{crecimientos-pantalla,pantalla}.fixture.ts`.

### Tanda 3

`qa` → `seguridad` (sonnet: la función reemplazada conserva `security invoker`, `search_path = ''` y los permisos; la columna nueva no amplía nada) → `documentador` (`CHANGELOG.md`; `docs/PLAN.md`, con M9a pasando a la versión libre siguiente; `docs/DECISIONES.md`; esta ficha; la sección nueva de `docs/pruebas/cowork-checklist.md`; `src/lib/version.ts` = `0.14.0 · M6`).

## Propuestas para `docs/DECISIONES.md`

1. **(Revierte en parte 07c, 2026-10-16.)** El % del año siguiente es «sobre `Y` corregido del Niño de las mismas tiendas de `Y+1`»: `P = round(B' × (1+g))`, con `B'` normalizada **por fila** con el factor de su temporada. Toda pantalla muestra también el % sobre `Y` real. Sigue descartado repartir el rebote dentro del GM.
2. **(Ajusta 06d.)** `VERSION_METODO = 5` y `VERSION_METODO_MIN_M8 = 5`.
3. Las versiones aprobadas antes de `0.14.0` se conservan como `bruta` y se aplican igual. En un GM con Niño hay que reaprobarlas para cerrar.
4. Cerrar exige, sin excepción, el factor de `Y` de toda temporada atípica con filas base, y recalcular si ese factor cambió.
5. El cierre del año en curso del GM se calcula en Curvas por agrupación, con las curvas vigentes de M6. «Sin Niño + rebote» y «Cierre proyectado» dejan de ser bases elegibles.

## Preguntas abiertas

Ninguna. Las decisiones D1 a D10 cubren lo que pedía el encargo. Si Javier quisiera otra cosa al revisar la ficha, las dos que más cambian el resultado son D6 (reaprobar las versiones `bruta` de los GM con Niño; la alternativa sería reinterpretarlas, con el salto de cifras de §5.2 D) y D3 / D4 (bloquear el cierre por factor faltante o cambiado; la alternativa sería que fuera forzable). La recomendación es mantener las dos.

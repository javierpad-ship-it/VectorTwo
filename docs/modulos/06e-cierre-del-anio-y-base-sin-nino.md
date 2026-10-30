# 06e · Cierre del año en curso por curva y base del año siguiente sin el Niño (método 5)

> Estado: **construida en `0.14.0 · M6` (2026-10-30), con la migración `0029` aplicada en Vector2; pendiente de validación de Javier** (hito: sección K de `docs/pruebas/cowork-checklist.md`; lo que cambió al construir está en §10). Historia de la ficha: **especificada el 2026-10-29 y ajustada el mismo día con la revisión independiente del `arquitecto-revisor` (opus): 2 bloqueantes (B1, B2), 5 importantes (I1–I5) y 10 menores (M1–M10), y con las cuatro decisiones de Javier sobre esa revisión (§9). I4-propuesta (modelar `φ_{Y+1}` en el nivel) queda descartada por la decisión 3. Aprobada por Javier para construir.** Amplía la pestaña «Crecimiento por género × mundo» de Curvas de estacionalidad ([06d](06d-curva-y-crecimiento-por-genero-mundo.md)), la pestaña «Factores del Niño» de M7 y cambia el método de M7 ([07](07-proyeccion-anual.md) §5 paso 2, [07c](07c-crecimientos-por-genero-mundo.md) §2.4). **Revierte en parte la decisión 07c «el % del año siguiente es bruto»**, la de 06d «`VERSION_METODO` sigue en 4» y la definición del factor del Niño de 07 §3 (pasa a ser **relativo**). Las propuestas están en §8. Versión prevista **`0.14.0 · M6`**, commits `M6:`, migración **`0029_cierre_y_base_sin_nino.sql`** (la `0026` queda para `0.13.1 · M8` y la `0028` para M9a, que pasa a la versión libre siguiente). Cifras sintéticas; tiendas `T01…`; géneros y mundos del seed de `0001`. Vector-One no se consultó: no tiene nada equivalente que valga la pena citar.
>
> **Base real (ref `tzjsxzmsvvhxyiooihyq`).** La sesión del arquitecto no tiene herramienta de base ni credenciales: no midió nada. Las cifras reales que se citan son **las del `arquitecto-revisor` del 2026-10-29**: factores 2026 invierno 0,6602 (recalculado 0,6609) y verano 1,3079, ambos parciales con 9 meses; control de todo el año 0,9414 con 9 tiendas comunes; 0 versiones aprobadas, 0 filas en `proyeccion_crecimientos`, 0 con % propio, 0 cerradas; una proyección en trabajo de `version_metodo` 3; las 15 agrupaciones activas con curva vigente; `venta_genero_mundo` con la dimensión agrupación en 1 614 ms (851 series, 25 403 celdas); 22 GML que mezclan temporadas con venta 2025–2026 (17 con venta 2025); R511 (abrió el 2025-11-20) es el 21,7 % de la red en ene–set 2026. **Todo se vuelve a medir en la tanda 1** (§6, «Verificación previa»), porque Javier va a aprobar versiones y cerrar una proyección con el método 4 antes de construir esto (decisión 4).

## 1. Objetivo

Javier: «Este es el módulo donde arranca la proyección, luego vamos a líneas.» La pestaña de crecimiento por género × mundo (GM) debe (1) **calcular por sí misma el cierre del año en curso** de cada GM con la estacionalidad (vendido de enero a `k` ÷ avance de la curva, con los meses del Niño normalizados), sobre las mismas tiendas del % y también sobre las tiendas que tendrá el año siguiente, sin depender de una proyección recalculada; y (2) mostrar **2026 corregido del Niño como una línea más** y aprobar el crecimiento de 2027 **sobre esa base corregida**. En M7, la base del año siguiente de las filas afectadas por el Niño pasa a ser su venta de 2026 dividida por el **factor relativo** de su temporada, y el % aprobado se aplica sobre ella (**método 5**). En un año sin Niño no cambia ninguna cifra, y la transición desde lo que Javier cierre con el método 4 no invalida nada de golpe.

### 1.1 Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Se normaliza por fila de M7 (línea × agrupación de marca), cada una con su temporada y su factor `φ_{Y,m}`**, nunca con una curva compuesta del GM. La base corregida del GM es la suma de las bases corregidas de sus filas. | Un GM mezcla líneas de invierno, verano y todo el año. Un factor único del GM repartiría el rebote del invierno sobre las líneas de verano (la variante que 07c §2.4 ya descartó: POLO −4,6 %). El revisor lo comprobó con datos reales: el error agregado de normalizar por fila frente al exacto es −0,81 % en los GML de invierno + todo el año y −0,18 % en los de todo el año + verano (peor GML −3,7 %); ningún GML mezcla invierno con verano. |
| D2 | **Los GML que mezclan temporadas conservan el `φ_{Y,m}` ponderado por mes que ya calcula `factoresMes`** (`src/lib/proyeccion/nino.ts`, 07 §3), con el aviso `temporadas_mezcladas`. | Es el mismo `φ` con que el paso 1 normalizó su cierre: en una fila base sin aportes, con método `avance` y sin decidir, `B' ≈ T'` (R7). La media ponderada es una aproximación (cifras de D1); corregirla movería también el cierre de 2026 de esas filas y queda fuera de alcance (§7). |
| D3 | **El factor del Niño es RELATIVO** (decisión 1 de Javier): `φ = ρ_P ÷ κ_P`, la caída o subida de la temporada en los meses del Niño **dividida por la de la red de todo el año en los mismos meses y tiendas**. Así el invierno corregido conserva la tendencia general de la red de 2026 y solo se le quita el efecto propio del Niño. Fórmula exacta en §5.2. | Con el factor de volumen (`ratio_volumen`, 0,66 hoy) el invierno corregido es, por construcción, 2025 de las mismas tiendas extrapolado: borra la caída de la red de 2026 solo en las líneas de invierno (I1). El relativo (≈ 0,70 = 0,6609 ÷ 0,9414, cifras del revisor) deja el invierno corregido un 5,9 % más abajo que con el de volumen. |
| D4 | **El factor de verano lo escribe Javier a mano** con el diagnóstico «cómo crece el verano atípicamente» delante (decisión 2): el sistema calcula y muestra, mes a mes del periodo, cuánto creció el verano por encima de su propia tendencia y de la red; **no decide solo**. Con menos de 2 meses del periodo comparados, el sistema no propone factor (`ratio_calculado = null`). | Hoy el 1,31 de verano sale de 9 meses, 8 de ellos fuera del periodo set–dic (no es efecto del Niño), y setiembre solo da 1,96 (I1). Un mes de inicio de temporada no basta para fijar el nivel de 2027 sin que alguien lo decida. |
| D5 | **Un factor de `Y` tiene que estar al día y confirmado para cerrar** (B2), sin excepción: `factor_faltante`, `factor_desfasado` (calculado con datos, composición o fórmula viejos) y `factor_sin_confirmar` (parcial y sin `ratio_aplicado` escrito sobre el cálculo vigente) no se fuerzan. Si un factor de `Y` cambia después de calcular, cerrar tampoco se fuerza (`factores_cambiados` de `Y`). Calcular nunca se bloquea por el factor. | En el método 5 el factor de `Y` fija el nivel de 2027 de las líneas del Niño. Hoy nada detecta que el factor parcial quedó viejo: solo cambia al pulsar «Sincronizar» (`sincronizarFactores`, `servicio.ts:1132`) y `motivosDesactualizada` (`desactualizado.ts:146-159`) solo compara el valor usado con el efectivo. Los factores de años anteriores no tocan el nivel de 2027: siguen forzables. |
| D6 | **El % que se aprueba y el que se escribe en una fila significan «2027 sobre 2026 corregido de las mismas tiendas de 2027».** `P = round(B' × (1 + g))`. Toda pantalla que muestra un % de 2027 muestra los dos: «sobre 2026 corregido» (el que se escribe) y «sobre 2026 real» (el que da la Matriz al comparar con lo vendido), con las dos bases en unidades. | Es lo que pidió Javier. Mostrar los dos evita otro «pongo 20 y veo 25». En un GM o fila sin Niño, `B' = B` y el % es el de siempre. |
| D7 | **2027 no es Niño** (decisión 3): no se modela `φ_{Y+1}` en el nivel. Si `Y+1` tiene meses atípicos marcados en Estacionalidad, **aprobar un crecimiento de `Y+1` y cerrar se bloquean** con un aviso claro (`409 anio_siguiente_atipico`, no forzable) hasta que Javier quite la marca o decida cómo modelarlo. Calcular sigue permitido. | Un % único por GM no puede incluir el efecto de una sola temporada (I4), y `factorMasReciente` (`nino.ts:41-54`, usado en `nino.ts:91-94`) daría a 2027 el factor de invierno 2026, porque su periodo llega a 2026-12. Se descarta la propuesta de aplicar `φ_{Y+1}` al nivel por fila. |
| D8 | **Umbral de materialidad único: `UMBRAL_CORRECCION_NINO = 0,005`.** Un GM (o el Resto) «tiene Niño» solo si `|Σ B' ÷ Σ B − 1| ≥ 0,5 %`. Por debajo, una versión `bruta` vale tal cual para cerrar, la pantalla muestra un solo % y no dibuja la línea corregida. La misma función `correccionMaterial` decide en la pantalla (`hay_nino`) y en M7 (`gm_con_nino`). | Con un umbral de 0,05 % casi todos los GM de HOMBRE y MUJER tienen algo de invierno (HOMBRE · FORMAL +0,1 %, HOMBRE · RI +0,1 %, cifras del revisor) y Javier tendría que reaprobar ~10 GM y el Resto sin que cambie nada material (I5, decisión 4). Con 0,5 %, la diferencia entre aplicar una `bruta` y una `corregida` es menor que el 0,5 % del 2027 del GM. |
| D9 | **Las versiones aprobadas antes de `0.14.0` conservan su significado** (`sobre_base = 'bruta'`) y M7 las aplica como en el método 4 (`round(B × (1+g))`): ninguna cifra salta sola. Solo en un GM con Niño material (D8) una versión `bruta` no basta para cerrar: «Reaprobar» la convierte en un clic, conserva el total del GM y redistribuye entre sus líneas (§5.3 D). | Descartados: reinterpretar en silencio el % bruto como corregido (en invierno, con φ 0,70, un 15 % saltaría a +64 % real) y convertir las versiones solas (06d: «nunca se copian solas»). |
| D10 | **El cierre del año en curso del GM se calcula en la pantalla, por agrupación de estacionalidad**, con la curva vigente de M6 de cada una y el `φ` de su temporada, sobre dos conjuntos de tiendas: `C(Y)` (las del %, como en 06d) y `M(Y+1)` (las que tendrá 2027, tiendas nuevas de `Y−1` y `Y` incluidas). La base 2027 por curva y la vista previa salen de `M(Y+1)`; el % de referencia, de `C(Y)`. La cifra de una proyección de método 5, si existe, queda como dato al lado. | La estacionalidad oficial son las curvas aprobadas en M6 (decisión del 2026-10-15). Sin `M(Y+1)`, R511 (21,7 % de la red, fuera de `C(2026)`) dejaría la vista previa ~28 % por debajo de lo que produce M7 (I2). |
| D11 | **Referencias:** la base por defecto es **«Cierre 2026 por curva · corregido»** (o «Año completo 2025» si el avance es bajo, M2). «Sin Niño + rebote» desaparece (el rebote ya está dentro de la base corregida) y la reemplaza «corregido». «Cierre proyectado» deja de ser elegible y queda como dato. | Con la base corregida, una tendencia de años normales se aplica tal cual. El rebote solo hacía falta porque el % era bruto. |
| D12 | **`VERSION_METODO = 5` y `VERSION_METODO_MIN_M8 = 5`, con transición suave** (decisión 4, §5.6): la cerrada de método 4 que Javier cierre ahora **sigue sirviendo a M8** con el aviso `cerrada_metodo_anterior`, que no bloquea; al cerrar una de método 5, la anterior se archiva sola (`servicio.ts:930-935`). Toda proyección en trabajo queda «desactualizada: método nuevo» (no se fuerza; recalcular conserva las decisiones). | El aviso dice qué falta (2027 de las líneas del Niño sin corregir) sin quitarle a Javier la cerrada con la que valida M8. |
| D13 | Los **años sin Niño no cambian**: con `φ_Y ≡ 1` el método 5 da la misma cifra que el 4, fila por fila, y la pantalla no dibuja la línea corregida. | Regla R1 (prueba de propiedad). |

## 2. Modelo de datos (`0029_cierre_y_base_sin_nino.sql`)

Idempotente, sin `DROP`, `UPDATE`, `DELETE`, backfill ni bloques `do $$`, y **sin ningún `alter column … set default`**. `revoke`/`grant` repetidos sobre la función. Depende de `0007`, `0015`, `0017`, `0018`, `0023` y `0027`, todas aplicadas; no depende de `0025` a `0028`. **Se aplica en la tanda 1 sobre la única base (producción) mientras sigue desplegada `0.13.x`**: todo lo que añade tiene que ser inocuo para ese código.

### 2.1 `crecimientos_genero_mundo.sobre_base` (B1)

```sql
alter table public.crecimientos_genero_mundo
  add column if not exists sobre_base text not null default 'bruta';
comment on column public.crecimientos_genero_mundo.sobre_base is '...';
```

- **Una sola sentencia, y el default es `bruta` para siempre.** Valores: `bruta` (el % es `Y+1 ÷ Y real − 1`; toda versión escrita por `0.12.1`/`0.13.x`, que no conocen la columna) o `corregida` (el % es sobre `Y` corregido del Niño; solo la escribe la API de `0.14.0`, **siempre explícita** en el `insert`).
- **Por qué (B1):** con un default `corregida`, cualquier aprobación hecha en `0.13.x` entre la tanda 1 y el despliegue de `0.14.0` (Javier va a aprobar en ese lapso, decisión 4) quedaría marcada como corregida aunque la pantalla vieja la presentó bruta, y al desplegar sus filas de invierno pasarían a `B' × (1+g)` (×1,52 sobre lo que Javier vio con el factor de hoy, 0,66; ×1,43 con el relativo) sin pedir reaprobar. Con default `bruta`, una fila sin el valor explícito es siempre una versión vieja, que es exactamente su significado.
- **Sin `check` de catálogo** (criterio I6 de 06d, como `alcance` y `base_tipo`): lo valida zod.
- `pct` conserva su `check` (−95 a 500); su `comment on` se reescribe: «el % se interpreta según `sobre_base`».
- `scripts/humo-0029.sql` comprueba por `SELECT` sobre `information_schema.columns` que `column_default` de `sobre_base` es `'bruta'::text` y que la columna es `not null`. Una prueba estática (R27) comprueba que todo `insert` en `crecimientos_genero_mundo` del código lleva `sobre_base`.

### 2.2 `proyeccion_crecimientos.sobre_base` (la foto de lo aplicado)

`add column if not exists sobre_base text null`, con `comment on`. `null` = foto escrita antes de `0.14.0` (se lee como `bruta`). Cada cálculo de `0.14.0` reescribe la foto con el valor explícito de la versión aplicada, así B2 de 06d, las explicaciones y las lecturas saben cómo se aplicó cada GM sin leer `crecimientos_genero_mundo`. El Resto usado va en `parametros.crecimiento_resto_usado.sobre_base` (clave nueva del `jsonb`, sin migración).

### 2.3 `factores_volumen_atipico`: columnas nuevas (D3, D4, D5)

| Columna | Tipo | Null | Para qué |
|---|---|---|---|
| `formula` | `text` | sí | `relativo_periodo` desde `0.14.0`. `null` = `ratio_calculado` escrito antes con la fórmula vieja (`ratio_volumen` sobre todos los meses publicados): es `factor_desfasado` si es de `Y`. Sin `check` de catálogo. |
| `ratio_volumen` | `numeric(6,4)` | sí | `ρ_P`, el ratio de la temporada en los meses del periodo (lo que antes era `ratio_calculado`, ahora acotado al periodo). Solo se muestra. `check (ratio_volumen is null or ratio_volumen > 0)`. |
| `ratio_control` | `numeric(6,4)` | sí | `κ_P`, el de la red de todo el año en los mismos meses y tiendas. Solo se muestra. Mismo `check`. |
| `huella_composicion` | `text` | sí | md5 de las huellas de composición (equivalencias activas) de las agrupaciones de la temporada y de `todo_el_ano` con que se calculó (M6 del revisor: remapear una equivalencia mueve el factor). |
| `aplicado_huella` | `text` | sí | La `huella_cargas` de la fila en el momento en que se escribió `ratio_aplicado`. Confirma el factor contra el cálculo que Javier tenía delante (`factor_sin_confirmar`, §5.2). |
| `diagnostico` | `jsonb` | sí | El diagnóstico mes a mes del periodo (§5.2): por mes `{ m, en_periodo, u, u_ref, ratio, control, relativo }` y los agregados `ratio_fuera`, `meses_periodo`, `meses_periodo_con_dato`. Lo valida el código (sin `check`). |

- Todas con `add column if not exists`, con el `check` dentro de la definición de la columna (si la columna existe, Postgres salta la cláusula entera: repetir no falla). `comment on` en cada una.
- **`meses_comparados` cambia de significado sin migración** (solo `comment on`): desde `0.14.0` es el número de meses del periodo comparados (`|P|`). Con `formula null` conserva el significado viejo.
- `0.13.x` sigue escribiendo `ratio_calculado`, `huella_cargas`, `parcial`, `tiendas_comunes` y `meses_comparados` y deja las columnas nuevas en `null`: esas filas quedan `formula null` (fórmula vieja), que es la verdad.
- Nada de `UPDATE`: las filas existentes se ponen al día con «Sincronizar» en `0.14.0`.

### 2.4 `proyeccion_fila_anios.base_normalizada` cambia de significado (solo `comment on`)

Desde el método 5 guarda **`B'`, la base de `Y` corregida del Niño** (lo que habrían vendido las mismas tiendas de `Y+1` en un año normal), y ya no `B'' = B' × Σ c φ_{Y+1}`. Con D7, una proyección que se puede cerrar nunca tiene `Y+1` atípico, así que `B''` no hace falta. Las proyecciones de método 4 quedan desactualizadas y la pantalla de GM las ignora (`version_metodo < 5`). `base_siguiente` (`B`, real) no cambia.

### 2.5 `venta_genero_mundo(p_desde date)`: misma firma, una dimensión más

`create or replace` con la misma firma y el mismo `returns jsonb`. Cada elemento de `series` gana `"a": "<agrupacion_estacionalidad_id>" | null` (`null` = sin agrupación activa) y el agrupamiento pasa a `(g, m, a, t)` en lugar de `(g, m, temp, t)`. `temp` se mantiene. Preagregación por `(equivalencia, tienda, periodo)` como hoy; mismos permisos (`revoke` a `public`, `anon` y `authenticated`; `grant` a `service_role`); `security invoker` y `search_path = ''` como hoy.

- **Compatible hacia atrás:** el lector de `0.12.1`/`0.13.x` (`comoVentaGeneroMundo`) ignora `a` y suma las entradas, así que con la migración aplicada antes del código todo da lo mismo (R21).
- **Por qué:** el cierre por curva (D10) necesita lo vendido por agrupación, cada una con su curva.
- **Presupuesto:** ≤ 3 s en frío. El revisor midió 1 614 ms con la dimensión `a` (851 series, 25 403 celdas): **no hay plan B** (M10). `datos` vuelve a medir dos pasadas con `explain (analyze, buffers)` después de aplicar y lo anota.

### 2.6 Lo que no cambia

`periodos_atipicos` y las pestañas «Años Niño» y «Periodos atípicos» de Curvas: la tabla de efecto de M6 (06 regla 8f) sigue mostrando sus ratios sobre todos los meses publicados; solo gana, como dato opcional, el bloque `periodo` de §5.2. `proyecciones.resumen` gana claves en el `jsonb` (§3.3), sin migración.

## 3. Contratos de API

Todo con `requirePlanner` (comprador `403`, sin sesión `401`), `{ data }` / `{ error, codigo }`, `leerCuerpo`, `traducirErrorDb`. **Ninguna ruta nueva.**

### 3.1 Curvas → Crecimiento por género × mundo (`src/lib/crecimientos/`)

| Ruta | Cambio |
|---|---|
| `GET /api/curvas/genero-mundo` | `FilaGMApi` gana `cierre: CierreGMApi`, `base_corregida`, `correccion_nino_pct`, `hay_nino`. La proyección de referencia exige `version_metodo ≥ 5` (sin ella siguen funcionando el cierre por curva, la base por curva, el Acumulado y los Años completos). `anio_siguiente_atipico: { meses: string[] } \| null` a nivel de respuesta. |
| `GET /api/curvas/genero-mundo/[clave]` | `DetalleGeneroMundoApi` gana `cierre_por_agrupacion`, `serie_corregida`, `serie_base_curva` (M(Y+1)), `factores_y` (§5.2, con el diagnóstico de la temporada), `diagnostico_verano_gm`, `cierre_proyeccion` (informativo) y `reaprobar` (impacto, I3). La serie de `Y` se completa con el cierre por curva sobre `C(Y)` (`origen = 'proyectado'`). |
| `POST /api/curvas/genero-mundo/[clave]` | Bases y variantes nuevas; escribe `sobre_base = 'corregida'` explícito; la foto `referencia` gana el bloque del método 5. Errores de 06d más `400 base_retirada` (zod: `cierre_proyectado` o `sin_nino_mas_rebote` en una aprobación nueva) y **`409 anio_siguiente_atipico`** (D7; no se escribe nada). |

```ts
// src/lib/crecimientos/tipos-api.ts (tanda 1)
export const SOBRE_BASE = ["bruta", "corregida"] as const;            // se reexporta desde proyeccion/tipos-api
export type SobreBase = (typeof SOBRE_BASE)[number];
export const BASES_CRECIMIENTO = ["acumulado", "cierre_curva", "cierre_proyectado", "anio_completo", "aplicado_hoy", "ninguna"] as const; // lectura (incluye la heredada)
export const BASES_APROBABLES = ["acumulado", "cierre_curva", "anio_completo", "aplicado_hoy", "ninguna"] as const;                       // POST
export const VARIANTES_BASE = ["corregido", "bruto", "sin_nino_mas_rebote"] as const;   // lectura (sin_nino_mas_rebote: versiones de 0.12.1/0.13.x)
export const VARIANTES_APROBABLES = ["corregido", "bruto"] as const;                   // POST
export type MotivoObsoleto = "base_movida" | "base_no_calculable" | "composicion" | "factor_cambiado" | "metodo_anterior";
export type MotivoNuloReferencia = /* los de 06d */ "sin_referencia" | "metodo_anterior" | "sin_base" | "denominador_cero" | "sin_venta" | "sin_curva" | "meses_faltantes";

export type CierreGMApi = {
  k: number | null; tiendas: number;                 // C(Y)
  vendido: number; vendido_corregido: number;        // ene–k sobre C(Y)
  cierre: number | null; cierre_corregido: number | null;            // K y K' sobre C(Y)
  anterior: number | null; anterior_corregido: number | null;        // U(Y−1) y U'(Y−1) sobre C(Y)
  pct: number | null; pct_corregido: number | null;
  base_curva: { tiendas: number; tiendas_fuera_cy: string[]; real: number | null; corregida: number | null } | null; // K_M y K'_M sobre M(Y+1) (I2)
  avance: number | null;                             // Σ V' ÷ Σ T' sobre C(Y)
  avance_bajo: boolean;                              // regla M2 (§5.1)
  agrupaciones_avance_bajo: string[];                // nombres
  sin_curva_pct: number | null;                      // % del vendido corregido cerrado con la curva compuesta
  hay_nino: boolean;                                 // correccionMaterial(K_M, K'_M) o gm_con_nino de la referencia (D8)
  correccion_curva_pct: number | null;               // K'_M ÷ K_M − 1
  factor_parcial: boolean; sin_factor: boolean;
  motivo_nulo: MotivoNuloReferencia | null;
};
export type CierreAgrupacionApi = {
  agrupacion_id: string | null; nombre: string; temporada: string;
  curva: { id: string; version: number } | null;    // null = sin curva vigente: se cerró con la compuesta
  avance: number | null; avance_bajo: boolean;
  vendido: number; factor_meses: number[]; vendido_corregido: number;
  cierre: number | null; cierre_corregido: number | null;            // C(Y)
  base_curva: number | null; base_curva_corregida: number | null;    // M(Y+1)
  meses: (number | null)[]; meses_corregidos: (number | null)[];     // 12, C(Y); los ≤ k son reales
};
export type FactorYApi = {                           // un factor de Y que toca al GM (lectura de factores_volumen_atipico)
  anio: number; temporada: "invierno" | "verano";
  efectivo: number | null; origen: "aplicado" | "calculado" | null;
  ratio_volumen: number | null; ratio_control: number | null; ratio_calculado: number | null; ratio_aplicado: number | null;
  meses_periodo: number; meses_periodo_con_dato: number; parcial: boolean;
  estado: "ok" | "faltante" | "desfasado" | "sin_confirmar";
  diagnostico: DiagnosticoFactorApi | null;          // §5.2
};
export type DiagnosticoVeranoGMApi = {               // §5.2, solo las agrupaciones de verano del GM, sobre C(Y)
  meses: { m: number; en_periodo: boolean; u: number; u_ref: number; ratio: number | null; control: number | null }[];
  ratio_fuera: number | null; exceso_propio: number | null; exceso_red: number | null; meses_periodo_con_dato: number;
} | null;
export type ReaprobarApi = {                          // I3; null si la vigente no es bruta o el GM no tiene Niño material
  pct_equivalente: number;                           // 2 decimales
  total_antes: number; total_despues: number;        // Σ 2027 de las filas que siguen al GM
  filas_suben: number; filas_bajan: number; unidades_movidas: number;
  decididas_con_propuesta_cambio: number;
} | null;
// ReferenciaApi (06d) cambia así:
//   tipo: TipoReferencia (gana "cierre_curva"); variante_defecto: "corregido" | "bruto";
//   equivalente: { corregido: number | null; bruto: number | null; sin_nino_mas_rebote: null }
// FilaGMApi gana:
//   cierre: CierreGMApi; base_corregida: number | null /* Σ B' de la referencia ≥ 5 */; correccion_nino_pct: number | null /* Σ B' ÷ Σ B − 1 */;
//   hay_nino: boolean; vigente.sobre_base (en VersionCrecimientoApi): SobreBase; fuera_base: { filas: number; unidades: number } | null (M8)
// DetalleGeneroMundoApi gana:
//   cierre_por_agrupacion: CierreAgrupacionApi[]; serie_corregida: SerieAnioGMApi | null /* solo si hay_nino */;
//   serie_base_curva: { real: number[]; corregida: number[] } | null /* M(Y+1), para la vista previa */;
//   factores_y: FactorYApi[]; diagnostico_verano_gm: DiagnosticoVeranoGMApi;
//   cierre_proyeccion: { nombre: string; base: number; base_corregida: number } | null; reaprobar: ReaprobarApi;
```

```ts
// src/lib/crecimientos/esquemas.ts (tanda 1): cambia solo `base`
base: z.object({
  tipo: z.enum(BASES_APROBABLES),
  anio: z.number().int().min(2023).max(2100).nullable(),
  variante: z.enum(VARIANTES_APROBABLES),
}).strict(),
// Un valor heredado (cierre_proyectado, sin_nino_mas_rebote) no pasa zod: el handler lo traduce a 400 base_retirada
// («Esa base ya no se usa desde 0.14.0 (la base «Cierre proyectado» y la variante «sin Niño más rebote»). Elige «Cierre por curva», «Acumulado», «Año completo», «Aplicado hoy» o «Ninguna», con variante corregido o bruto.»). `pct` se redondea a 2 decimales (numeric(6,2)).
```

**Aprobar** (orden de 06d §3, con estos cambios):
1. **`anio_siguiente_atipico`** (nuevo, primero): si `claseDeAnio(Y+1, …)` da meses atípicos para alguna temporada con venta en el GM → `409`. Mensaje: «2027 está marcado como año del Niño en Curvas → Periodos atípicos. Por ahora el crecimiento de 2027 no incluye el Niño: si no lo habrá, quita la marca; si lo habrá, hay que decidir cómo modelarlo antes de aprobar.»
2. `huella_datos` cubre además los ids y versiones de las **curvas vigentes de las agrupaciones del GM**, las **tiendas de `M(Y+1)`** y los **factores de `Y`** con sus columnas nuevas (`409 datos_cambiados` si algo cambió mientras tanto). `VERSION_REFERENCIAS` sube a 2 (`huellas.ts:11`) además del prefijo `v2|` de la clave de caché (M4).
3. **R-N** (R12) gana un caso: variante `bruto` sobre una referencia cuyo periodo toca un año Niño **material** para el GM.
4. **`sin_cambio`** compara también `sobre_base`: una vigente `bruta` con el mismo % no es «sin cambio» y se puede reaprobar.
5. Inserta con `sobre_base = 'corregida'` explícito.
6. Responde como en 06d; además `vigente.equivalente_real: number | null` (el % sobre 2026 real con la base de la referencia o, sin referencia ≥ 5, con la base por curva sobre `M(Y+1)`).

**Foto `referencia` de la versión.** Además de lo de 06d: `metodo: 5`, `sobre_base: "corregida"`, `k`, `tiendas_cy` y `tiendas_m` (ids), `cierre` (`CierreGMApi` completo), `cierre_por_agrupacion` (con `curva_id` y versión), `factores: { anio, temporada, efectivo, origen, formula, parcial, huella_cargas }[]` (los de `Y` que tocan al GM), `serie_corregida`, `base_siguiente` (`Σ B`), `base_corregida` (`Σ B'`), `correccion_nino_pct` y `equivalente_real`. Con ella la versión se explica sin releer venta, curvas ni factores, y `factor_cambiado` se evalúa contra `factores`.

### 3.2 Proyección → Factores del Niño (`src/lib/proyeccion/servicio.ts`, rutas sin cambio)

| Ruta | Cambio |
|---|---|
| `GET /api/proyeccion/factores` | `FactorApi` gana `formula`, `ratio_volumen`, `ratio_control`, `meses_periodo` (meses del periodo en `Y`), `meses_periodo_con_dato`, `diagnostico`, `estado` (`ok` · `faltante` · `desfasado` · `sin_confirmar`, solo para los de `Y`) y `motivos_desfase: ("formula" \| "cargas" \| "meses" \| "composicion")[]`. |
| `POST /api/proyeccion/factores/sincronizar` | Calcula con la fórmula relativa (§5.2) **todos los años atípicos** y escribe `ratio_calculado` (`null` con menos de 2 meses del periodo), `formula = 'relativo_periodo'`, `ratio_volumen`, `ratio_control`, `meses_comparados = |P|`, `huella_cargas`, `huella_composicion`, `diagnostico`, `tiendas_comunes`, `parcial`, `calculado_at`. No toca `ratio_aplicado`, `aplicado_huella` ni `nota`. |
| `PUT /api/proyeccion/factores` | Al escribir `ratio_aplicado` no nulo, guarda `aplicado_huella = huella_cargas` de la fila en ese momento; al limpiarlo, `null`. **Escribir el mismo valor que el calculado confirma el factor.** Sin cambio de esquema. |

### 3.3 M7 (`src/lib/proyeccion/`)

**Lógica pura (contratos que prueba vitest):**

```ts
// factor-nino.ts (nuevo, tanda 1, puro)
export const UMBRAL_CORRECCION_NINO = 0.005;          // D8; se reexporta desde tipos-api
export const MIN_MESES_FACTOR = 2;                    // D4
export function correccionMaterial(base: number, baseCorregida: number): boolean; // base > 0 && |B'/B − 1| ≥ UMBRAL
export function factorRelativoPeriodo(e: { temporada; anioY; anioRef; serieY; serieRef; controlY; controlRef; redes; mesesPeriodo: boolean[] }):
  { ratio_volumen: number | null; ratio_control: number | null; relativo: number | null; ratio_calculado: number | null;
    meses_periodo_con_dato: number; ratio_fuera: number | null; diagnostico: DiagnosticoFactorApi };
export type DiagnosticoFactorApi = {                 // se reexporta desde tipos-api; es el jsonb `diagnostico`
  meses: { m: number; en_periodo: boolean; u: number; u_ref: number; ratio: number | null; control: number | null; relativo: number | null }[];
  ratio_fuera: number | null; meses_periodo: number; meses_periodo_con_dato: number;
};
export function estadoFactorY(f: FactorDb, hoy: { huella_cargas: string; huella_composicion: string; meses_periodo_publicados: number }):
  { estado: "ok" | "faltante" | "desfasado" | "sin_confirmar"; motivos_desfase: string[] };

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
export type FilaCrecimiento = { ...07c; sobre_base?: SobreBase };
// AgregadoCrecimientoApi gana: base_libre_corregida; pct_propio.base_corregida; decididas.base_corregida
//   base_normalizada pasa a ser Σ B'; rebote_nino_pct se rotula «corrección del Niño» (mismo valor: Σ B' ÷ Σ B − 1)
export function calcularPromedio(celdas, resto, objetivo, puente, opciones?: { sobre?: SobreBase }): ...; // 'corregida': pondera por Σ B'
```

**Persistencia y lecturas:**
- `proyeccion_fila_anios` de `Y+1` (filas base): `base_siguiente = round(B)`, `base_normalizada = round2(B')`.
- `AnioFilaApi`: `pct_bruto` sigue llamándose así y vale `vigente ÷ B − 1` («sobre 2026 real»); `pct_sobre_normalizada = vigente ÷ B' − 1` («sobre 2026 corregido»). `crecimiento_efectivo` gana `sobre_base`.
- `NodoMatrizApi.siguiente` gana `base_corregida` y `crec_corregida_pct` (`Σ vigente ÷ Σ B' − 1`). `crec_mismas_pct` se mantiene (sobre real). El Excel de la Matriz gana la columna.
- `ResumenProyeccion` gana `gm_con_nino: string[]` (claves `genero_id|mundo_id` y `resto` con `correccionMaterial(Σ B, Σ B')` sobre sus filas base de `Y+1`) y `gm_fuera_base: Record<string, { filas: number; unidades: number }>` (filas base del GM con `B` nulo por `sin_propuesta` o `sin_curva` y su venta de `Y`; M8). `gm_gml` no cambia.
- `ParametrosProyeccion.crecimiento_resto_usado` gana `sobre_base`, y `parametrosDe` lo deja pasar (lección B1 de 06d). `factores_usados` gana `formula` y `huella_cargas`.
- `escribirFotoCrecimientos` escribe `sobre_base` explícito. `cargarMatriz` lo lee (`null` → `bruta`).

**Desactualización (`motivosDesactualizada`, `desactualizado.ts`):** gana **`temporada_cambiada`** (M6 del revisor): alguna fila base de `Y+1` cuya composición vigente (agrupaciones y pesos) difiere de su `curva_origen_usada` y alguna de esas agrupaciones es de una temporada con meses atípicos en `Y` (su `φ_Y` cambió). `EstadoActual` gana `huella_cargas` de hoy (de `cargasLista`, que ya trae `id` y `periodo`: `huellaCargas` de `curvas/huellas.ts`) y `huella_composicion` por temporada. Tienen que salir del mismo conjunto de cargas y agrupaciones que usa `sincronizarFactores` (`calcularEfectoNino`); una prueba lo fija: sincronizar y evaluar sin cambios en medio da `ok`, nunca `desfasado`.

**Cierre (`motivoRechazoCerrar`, `reglas.ts`), en este orden:**
1. `ya_cerrada`, `archivada`, `calculo_en_curso` (sin cambio).
2. `version_metodo` (no forzable; ahora `< 5`).
3. `crecimientos_cambiados` (no forzable, sin cambio).
4. **`anio_siguiente_atipico`** (nuevo, no forzable, D7). Mismo mensaje que en Aprobar, con «no puedes cerrar».
5. **`factor_faltante`** (nuevo, no forzable): temporada con meses atípicos en `Y`, sin factor efectivo y con filas base activas de `Y+1` cuyo `φ_Y` la incluye. Detalle `{ faltan: { anio, temporada }[] }`. Mensaje: «Falta el factor del Niño de verano 2026: sin él la base de 2027 no se corrige. Escríbelo en Factores del Niño (1,00 si no hubo efecto) y recalcula.»
6. **`factor_desfasado`** (nuevo, no forzable, B2): factor de `Y` en ese mismo ámbito, ya sincronizado alguna vez (`calculado_at` no nulo), con alguno de: (a) `formula` distinta de `relativo_periodo`; (b) `huella_cargas` ≠ la de hoy; (c) `parcial` y `meses_comparados` < meses del periodo de `Y` publicados hoy; (d) `huella_composicion` ≠ la de hoy. Mensaje: «El factor de invierno 2026 se calculó con datos de setiembre y hoy hay octubre: pulsa «Sincronizar» en Factores del Niño, revisa el valor y recalcula.»
7. **`factor_sin_confirmar`** (nuevo, no forzable, B2): factor de `Y` en ese ámbito, `parcial`, y `ratio_aplicado` nulo o `aplicado_huella` ≠ `huella_cargas` de la fila. Mensaje: «El factor de invierno 2026 (0,70) es parcial y nadie lo confirmó con los datos de hoy: escríbelo en Factores del Niño (el mismo valor lo confirma).»
8. **`factores_cambiados` de `Y`** (no forzable, D5): el motivo de desactualización `factores_cambiados` incluye algún «temporada `Y`». Mensaje: «Cambió el factor del Niño de invierno 2026, que corrige la base de 2027: recalcula (no se puede forzar).» El de otros años sigue forzable. **`temporada_cambiada`** (no forzable, M6): «Cambió la agrupación de alguna línea con Niño y con ella su factor: recalcula.»
9. `crecimientos_sin_aprobar` (no forzable). Su detalle gana `reaprobar: { clave, nombre, version, correccion_pct }[]`: las vigentes `bruta` de GM en `resumen.gm_con_nino`, y el Resto si es `bruta` y `resto ∈ gm_con_nino`.
10. Filas y tiendas sin decidir; `desactualizada` por los demás motivos (forzable).

`ProyeccionApi` gana `cierre_bloqueado_por?: { codigo: "anio_siguiente_atipico" | "factor_faltante" | "factor_desfasado" | "factor_sin_confirmar" | "factores_cambiados" | "temporada_cambiada"; mensaje }[] | null` (solo en trabajo), y `crecimientos_sin_aprobar` gana `reaprobar`. La cabecera deshabilita «Cerrar proyección» sin esperar al `409`. La carrera cerrar/aprobar de 06d (M5) sigue igual; la relectura posterior al `UPDATE` vuelve a evaluar `reaprobar`.

**Prerrequisitos («Antes de proyectar»):** `factor_sin_calcular` del año `Y` sigue siendo aviso: «Falta el factor del Niño de verano 2026: la base de 2027 de esa temporada no se corregirá y no podrás cerrar.» `anio_siguiente_atipico` pasa a: «2027 está marcado como año del Niño: puedes calcular, pero no aprobar crecimientos de 2027 ni cerrar hasta quitar la marca o decidir cómo modelarlo.» Nuevos avisos `factor_desfasado` y `factor_sin_confirmar` (los mismos textos; aquí no bloquean).

**M8:** `VERSION_METODO_MIN_M8 = 5`. El aviso `cerrada_metodo_anterior` (`src/lib/flujo/tipos-api.ts:73`) pasa a: «La cerrada se calculó con el método 4 (antes de 0.14.0): los meses de 2027 de las líneas con Niño no están corregidos. Sirve para trabajar; cuando cierres una proyección con 0.14.0, la reemplazará.» El flujo se calcula igual (`flujo/modelo.ts:411` solo avisa). M8 no gana ninguna otra lectura.

## 4. Pantallas (admin y planner; formato `es-PE`; kit `Card`, `DataTable`, `Field`, `Badge`, `Alert`, `Modal`, `Tabs`)

Todos los factores se muestran con **dos decimales** en texto corrido y **tres** en las tablas de diagnóstico; los % con un decimal salvo el campo de aprobar y «Reaprobar» (dos).

### 4.1 Curvas → «Crecimiento por género × mundo»

**Lista.**
- Texto fijo: «% de 2027 sobre la venta de 2026 corregida del Niño, de las tiendas que tendrá 2027. El factor del Niño es relativo: quita lo que la temporada cayó o subió de más frente a la red, y conserva la tendencia de la red. En un GM sin Niño (corrección menor que 0,5 %), corregida = real.»
- Si `anio_siguiente_atipico`: `Alert` arriba con el mensaje de §3.1 y «Aprobar» deshabilitado en todos los GM.
- Columnas:
  - género · mundo · u. 2025;
  - acumulado ene–set (real / corregido);
  - **cierre 2026 por curva** (mismas tiendas de 2025 y 2026: u. corregidas, % real / % corregido; badges «avance bajo», «sin curva 4 %», «factor parcial», «factor por confirmar»);
  - aplicado hoy (sobre corregido · sobre real);
  - **base 2027** (tiendas de 2027: real / corregida y «corrección del Niño +6,8 %»; de la proyección de referencia si es ≥ 5, si no «por curva»); si `fuera_base` > 0, «412 u de 2026 fuera de la base de M7»;
  - crecimiento 2027 aprobado (vN, quién y cuándo; badge «bruto · antes de 0.14.0» si es `bruta`; badge «reaprobar» si además `hay_nino`);
  - estado · Trabajar.
- Total: ponderado por `Σ B'` y su equivalente sobre real.
- La proyección de referencia ofrece solo las de `version_metodo ≥ 5`.

**Detalle de un GM:**
1. **Curva de venta** (`calcularGeometriaCurvas`):
   - 2023 a 2025 en trazo continuo; 2026 continuo hasta `k` y **discontinuo con el cierre por curva** después (mismas tiendas de 2025 y 2026);
   - **«2026 corregido (sin Niño)»** en el mismo color, punteado, los doce meses, solo si `hay_nino`. Leyenda: «invierno ÷ 0,70 (relativo) · verano set–dic ÷ 1,50 (escrito por Javier)»;
   - **«2027 vista previa (8,00 %)»** en discontinuo claro: `serie_base_curva.corregida × (1+g)`, **tiendas de 2027**, rotulada «tiendas de 2027 (incluye T10)»; se mueve al escribir el %;
   - modos Unidades / Forma / Sin Niño. En «Sin Niño», 2026 es la serie corregida, sin línea aparte; en «Forma», las dos líneas extra no se dibujan;
   - bandas del Niño como en 06d.
2. **Tabla año × mes:** filas 2023…2026, «2026 corregido (sin Niño)» debajo de 2026, **«Base 2027 por curva (tiendas de 2027)»** real y corregida, y «2027 vista previa»; total y variación frente al año anterior (la fila corregida compara con 2025 corregido); celdas proyectadas en cursiva con «p»; el CSV lleva las mismas filas.
3. **Cómo se cierra 2026** (I1, I2): una fila por agrupación — curva vN, avance a set (badge «avance bajo» por agrupación), vendido, factor, vendido corregido, cierre real y corregido (mismas tiendas) y base 2027 real y corregida (tiendas de 2027) — más el total. Debajo, **el factor de cada temporada de `Y`** con estos rótulos exactos:
   - Invierno: «Factor 0,70 = 0,66 ÷ 0,94. **0,66**: invierno 2026 ÷ 2025 de las mismas 9 tiendas en ene–set (9 de 12 meses del periodo). **0,94**: la red de todo el año en los mismos meses y tiendas. El invierno corregido es lo que habría vendido si hubiera seguido la tendencia de la red (−6 % frente a 2025), no 2025 repetido. Factor parcial · confirmado por Javier el 29/10» (o «por confirmar» / «desfasado: sincroniza»).
   - Verano: el bloque «Cómo crece el verano atípicamente» de §4.2 (tabla de la temporada) y, debajo, la misma tabla **solo para las agrupaciones de verano de este GM** (`diagnostico_verano_gm`, informativa). Rótulo del factor: «Factor 1,50 escrito por Javier · oct–dic de 2026 se proyecta ×1,50 (supone que el Niño sigue hasta diciembre)». Si no hay factor: «Sin factor: 2026 de verano no se corrigió y no podrás cerrar.»
   - Enlace «Cambiar el factor en Proyección → Factores del Niño». Avisos: avance bajo, sin curva, meses faltantes.
   - Si hay referencia ≥ 5: «En la proyección «Plan 2026»: base 2027 56 120 u real · 59 940 corregida (tiendas de 2027 de la proyección; la diferencia con la curva viene de las decisiones y de la venta esperada de tiendas nuevas).»
4. **Cómo crece:**
   - referencias en este orden: Cierre por curva, Acumulado, Año completo 2025 y 2024, Aplicado hoy;
   - columnas: periodo, tiendas, anterior, actual, % real, % corregido y «equivale para 2027 (sobre 2026 corregido)»;
   - marcas frágil, extremo, tienda mayor y cobertura, como en 06d;
   - si `hay_nino`: `Alert` «2026 fue Niño en invierno: el % de 2027 se escribe sobre 2026 corregido (58 750 u en las mismas tiendas, +8,8 % frente a 2025)».
5. **Aprobar 2027** (HOMBRE, MUJER y Resto); deshabilitado con `anio_siguiente_atipico`:
   - selector «Base» (por defecto «Cierre 2026 por curva · corregido», o «Año completo 2025 · corregido» con `avance_bajo`; la variante «real» está disponible y, en un GM con Niño material, exige nota);
   - campo **«% 2027 sobre 2026 corregido»** (dos decimales);
   - al lado, en vivo: «= +15,36 % sobre 2026 real · base 2027 (tiendas de 2027): 56 100 real / 59 925 corregida → 64 719 u»; sin referencia ≥ 5, la misma frase con la base por curva y «estimado por curva»;
   - nota según R-N;
   - «Aprobar v3», con un `confirm` que repite los dos %, la base y cuántas proyecciones quedarán desactualizadas.
   - **Reaprobar (I3).** Si la vigente es `bruta` y `hay_nino`: `Alert` «v1 (15 % sobre 2026 real) se aprobó antes de 0.14.0. Hoy equivale a 7,66 % sobre 2026 corregido. Reaprobar conserva el total del GM y redistribuye de verano y todo el año a invierno.» con el botón **Reaprobar**, que precarga «Aplicado hoy · corregido» con dos decimales. Su `confirm`: «2027 de HOMBRE · URBANO: 64 515 → 64 515 u. Cambian 2 filas (1 sube, 1 baja; 2 995 u se mueven). 0 filas decididas quedarán con “propuesta cambió”. Después recalcula la proyección.» Si no hay referencia ≥ 5, el botón dice «Recalcula la proyección con 0.14.0 para reaprobar» y está deshabilitado (sin filas no se puede medir el equivalente).
   - Tras aprobar: «Aprobado. Recalcula la proyección y sigue en Por línea».
6. **Versiones:** cada una con «sobre 2026 corregido» o «sobre 2026 real (antes de 0.14.0)». «Ver foto» muestra también el cierre por agrupación y los factores con su origen.

### 4.2 Proyección

| Lugar | Cambio |
|---|---|
| **Factores del Niño** | Texto fijo: «El factor de 2026 corrige la base de 2027 de cada temporada (método 5). Es relativo: la temporada frente a la red en los mismos meses. Si una temporada no tuvo efecto, escribe 1,00.» Por fila: año, temporada, **volumen** (`ratio_volumen`), **control** (`ratio_control`), **calculado** (relativo, o «—: 1 mes del periodo, escríbelo tú»), **aplicado** (editable), meses «9 de 12 del periodo», badges «parcial», «fórmula anterior», «desfasado: sincroniza», «por confirmar», «confirmado el 29/10». Si `aplicado ≠ calculado`: «tu valor 0,72 · calculado hoy 0,70». Cada fila de `Y` se despliega con **«Cómo crece … atípicamente»** (§5.2): tabla de los doce meses (2025, 2026, ratio, red, ratio ÷ red; los del periodo resaltados) y la línea de resumen «Setiembre: ×1,90 frente a 2025; su tendencia ene–ago ×1,20; la red ×0,95 → crece **×1,58 sobre su tendencia** y **×2,00 sobre la red**. 1 solo mes del periodo, y es el de inicio de temporada: dato frágil.» Para invierno la misma tabla, sin «tendencia propia» (todo el año es periodo). |
| Por línea · campo «Crec.» | Ayuda: «% de 2027 sobre la venta de 2026 corregida del Niño de esta fila. Vacío = el aprobado de HOMBRE · URBANO (8 %).» El marcador dice «8 % · HOMBRE · URBANO v2» o «15 % bruto · HOMBRE · URBANO v1 (reaprobar)» (solo si el GM está en `gm_con_nino`). |
| Por línea · detalle y pie | «+8,0 % sobre 2026 corregido (19 125) · +35,0 % sobre 2026 real (15 300)». En verano, «2026 vendió de más por el Niño». La explicación: «2027 → base 2026 de las 10 tiendas de 2027 = 15 300, corregida del Niño de invierno (÷ 0,80, relativo) = 19 125 × 1,08 (8 % de HOMBRE · URBANO v2, sobre 2026 corregido) = 20 655 (+35,0 % sobre 2026 real), repartido con ABRIGOS HO v3.» |
| Matriz | «Crec. mismas tiendas» se parte en **«Crec. sobre 2026 corregido»** y **«Crec. sobre 2026 real»**, con el título: «El % que apruebas se aplica sobre 2026 corregido del Niño; “real” compara con lo vendido. Var. incluye además tiendas nuevas, aperturas y cierres». En el Excel también. |
| Pestaña Crecimientos (solo lectura) | Por GM: % aplicado (con `sobre_base`), base real y corregida, «corrección del Niño», 2027 resultante, % sobre corregido y sobre real; badge «reaprobar» si está en `reaprobar`; «u fuera de la base» si `gm_fuera_base` > 0. |
| Cabecera y modal de cierre | `anio_siguiente_atipico`, `factor_faltante`, `factor_desfasado`, `factor_sin_confirmar`, `factores_cambiados` (de `Y`), `temporada_cambiada` y `reaprobar` entran en `MOTIVOS_NO_FORZABLES`; el modal los lista con su enlace (Factores del Niño, Curvas → Periodos atípicos, la pantalla del GM). |
| Nueva proyección | «Resto provisional (%, sobre 2026 corregido)». La meta informativa `crecimiento_objetivo_pct` se rotula «sobre 2026 real». |

## 5. Reglas de negocio

### 5.1 Fórmulas exactas

**Notación.** `Y` = año del último mes cerrado `k` (1..12; si `Y < año de k`, `k = 12`). `C(Y)` = mismas tiendas del gráfico (06d §5.1: `tiendasComunes(red(Y−1), red(Y))`). **`M(Y+1)`** = tiendas con `clasificarTienda(t, Y+1).bloque = 'mismas'` (abiertas todo `Y` según M4; incluye las nuevas de `Y−1` y `Y` que cumplen el año). `a` = agrupación de estacionalidad del GM con venta. `c_a` = su curva vigente (`curvaDeFila`). `φ_{a,Y,m}` = factor efectivo de su temporada en el mes `m` de `Y` (`crearPhi`: 1 en `todo_el_ano` y `sin_agrupacion`; 1 con aviso `sin_factor` si falta). Sin redondeos intermedios: la pantalla redondea al mostrar y las pruebas comparan a 2 decimales.

**Cierre por curva del GM (pantalla, D10).** Para un conjunto de tiendas `S` (`C(Y)` o `M(Y+1)`) y cada `a`:
- Si falta publicar algún mes `≤ k` de `Y`: cierre `null` con `motivo_nulo = meses_faltantes` (M5; M7 bloquea igual con `meses_faltantes`).
- `v_{a,m} = max(0, Σ_{t∈S} U(a,t,Y,m))` para `m ≤ k`; `V_a = Σ v`; `V'_a = Σ v_{a,m} ÷ φ_{a,Y,m}`.
- Si `a` tiene curva y `C_{k,a} = Σ_{m≤k} c_{a,m} > 0`: `T'_a = V'_a ÷ C_{k,a}`.
- Si no (sin agrupación, sin curva vigente o `C_k = 0`): **curva compuesta del GM** `c̄ = Σ_b w_b c_b ÷ Σ_b w_b`, con `b` las agrupaciones del GM con curva y `w_b = U'_b(Y−1)` sobre `C(Y)` (o `V'_b` si `Y−1` no tiene venta). Aviso `sin_curva` con `sin_curva_pct`. Sin ninguna curva en el GM: `null` con `sin_curva`.
- Meses `m > k`: real `p_{a,m} = T'_a c_{a,m} φ_{a,Y,m}`; corregido `p'_{a,m} = T'_a c_{a,m}`.
- `K_a = V_a + Σ_{m>k} p_{a,m}`; `K'_a = V'_a + Σ_{m>k} p'_{a,m} = T'_a`.

Con `S = C(Y)`: `K`, `K'`, `pct = K ÷ U(Y−1) − 1`, `pct_corregido = K' ÷ U'(Y−1) − 1`. Con `S = M(Y+1)`: `K_M`, `K'_M` (la **base 2027 por curva**) y `correccion_curva_pct = K'_M ÷ K_M − 1`. Con `k = 12`, `K = V` y `K' = V'`. El Resto se calcula igual sobre la suma de los GM no detallados.

**Efecto del factor relativo sobre lo que se ve (D3).** Con `φ` constante en los doce meses (invierno 2026), `p_{a,m} = V_a c_{a,m} ÷ C_{k,a}`: **el cierre real de 2026 no depende del factor**; solo cambian la serie corregida y `B'` (`÷ 0,70` en lugar de `÷ 0,66`: −5,9 %). Con `φ` solo en set–dic (verano), el factor mueve también el cierre real (oct–dic `× φ`) y `B'`.

**Avance bajo (M2).** Por agrupación: `avance_bajo` si `C_{k,a} < 0,30`. Del GM: `avance_bajo` si `Σ V' ÷ Σ T' < 0,30` **o** las agrupaciones con avance bajo suman `≥ 20 %` de `Σ T'`. Con `avance_bajo` del GM, la base por defecto es «Año completo `Y−1` · corregido».

**Series del gráfico.** `Y` (sobre `C(Y)`): meses `≤ k` reales, `> k` `Σ_a p_{a,m}`. **Serie corregida** (solo si `hay_nino`): `Σ_a v_{a,m} ÷ φ_{a,Y,m}` en `≤ k` y `Σ_a p'_{a,m}` en `> k`; su total es `K'`. **Base 2027 por curva:** las mismas dos series sobre `M(Y+1)`. **Vista previa de 2027** (en el navegador): `base_curva_corregida_m × (1 + g)`.

**`hay_nino` (D8).** Con referencia ≥ 5: `claveGM ∈ resumen.gm_con_nino`. Sin ella: `correccionMaterial(K_M, K'_M)`. Las dos usan `UMBRAL_CORRECCION_NINO`.

**Referencias (D11).** «Equivalente para 2027» = el % que se escribiría sobre 2026 corregido:
- Cierre por curva: `equivalente.corregido = pct_corregido` y `equivalente.bruto = pct`.
- Acumulado y Año completo: `equivalente.corregido = pct_sin_nino` y `equivalente.bruto = pct_bruto`.
- Aplicado hoy (solo con referencia ≥ 5): con `sobre_base = corregida`, `g` aplicado; con `bruta`, `equivalente.corregido = round2(((1 + g) × Σ_F B ÷ Σ_F B' − 1) × 100)`, con `F` las filas base del GM que siguen al GM (sin % propio ni 2027 decidido; si no queda ninguna, todas). Es el % que deja quieto el total de esas filas, y es el que precarga «Reaprobar» (`reaprobar.pct_equivalente`). Su `equivalente.bruto` es `g`.
- `variante_defecto = "corregido"` siempre; `equivalente.sin_nino_mas_rebote = null`.

**Base corregida y % en M7 (método 5), fila base de `Y+1`.**
- `B` (sin cambio, 07 paso 2) = vigente de `Y` de la fila base + aportes de las tiendas nuevas que pasan a `M(Y+1)` − salientes.
- `B' = Σ_m b_m ÷ φ_{Y,m}`, con `b_m` el reparto mensual de `B` y el `φ_{Y,m}` de la fila (`factores_mes[Y]`, ponderado si mezcla temporadas). Con `φ` constante, `B' = B ÷ φ`. Es lo que `siguiente.ts` ya calcula como `base_nino`.
- `g` por precedencia (sin cambio): % propio de la fila > GM vigente > Resto vigente > `crecimiento_pct_defecto`. `s` = `sobre_base` de esa fuente (la fila y el Resto provisional, `corregida`).
- `P = round(B' × (1 + g/100))` si `s = corregida`; `P = round(B × (1 + g/100))` si `s = bruta`.
- Reparto `c'_m ∝ c_m φ_{Y+1,m}` (sin cambio; con D7, en una proyección que se cierra `φ_{Y+1} ≡ 1`).
- Se muestra `pct_sobre_normalizada = vigente ÷ B' − 1` («sobre 2026 corregido») y `pct_bruto = vigente ÷ B − 1` («sobre 2026 real»).
- **Tienda `maduro_propio` de `Y+1`:** `P = round(A' × (1 + g) × Σ_{m∈Y+1} c_m r_m)`, con `A' = vigente_{t,f,Y} ÷ Σ_{m∈Y} c_m r_m φ_{Y,m}` si `s = corregida` (o `A^b` de 07c si `bruta`), repartido con `c r φ_{Y+1}`.
- Aperturas de `Y+1` (07d), cierres y el año en curso: **sin cambio**.

### 5.2 El factor del Niño: relativo, diagnóstico y estados (D3, D4, D5)

**Fórmula (`factorRelativoPeriodo`, decisión 1).** Para una temporada `T ∈ {invierno, verano}` y un año atípico `Y`, con `N` = año normal más cercano (`referenciaVolumen`, empate el anterior) y `Q = tiendasComunes(red(Y), red(N))`:
- `P` = meses atípicos de `T` en `Y` (`claseDeAnio(Y, {temporada: T}).meses_atipicos`) ∩ publicados de `Y` ∩ publicados de `N`. `F` = publicados de ambos años fuera de `P`.
- `ρ_P = Σ_{m∈P} u_{T,Y,m} ÷ Σ_{m∈P} u_{T,N,m}` (sobre `Q`; `ratio_volumen`).
- `κ_P` = lo mismo para las agrupaciones de `todo_el_ano` (control), con el mismo `N`, las mismas `Q` y los mismos meses `P` (`ratio_control`).
- `relativo = ρ_P ÷ κ_P` (`null` si `κ_P` es nulo o 0).
- `ratio_calculado = round4(relativo)` si `|P con dato| ≥ MIN_MESES_FACTOR (2)`; si no, `null`.
- Por mes `m` (los doce): `ρ_m = u_{T,Y,m} ÷ u_{T,N,m}`, `κ_m` (control) y `ρ_m ÷ κ_m`, con `en_periodo`. `ratio_fuera = Σ_{m∈F} u_{T,Y} ÷ Σ_{m∈F} u_{T,N}` (`null` si `F` está vacío, como en invierno 2026).
- Se reutilizan `ratioVolumen`, `ratioMensual` y `tiendasComunes` (exportados en `curvas/efecto.ts` y `curvas/red.ts`). Las series las da la misma corrida que hoy alimenta `efectoAtipicoCorrida` (`curvas/modelo.ts:1137-1199`): `efectoAtipicoCorrida` gana, por fila de temporada y año, un bloque opcional `periodo` con estos valores (`modelo.ts:1145` pasa la lista de meses atípicos, que hoy reduce a su cantidad; aditivo: las columnas actuales de «Años Niño», que usan todos los meses publicados, no cambian). `sincronizarFactores` lo lee de ahí en lugar de `ratio_volumen`.
- Con `P` = todos los meses publicados (invierno 2026, periodo ene–dic), `relativo` coincide con el `ratio_relativo` que ya calcula `efecto.ts:248-251` (0,6609 ÷ 0,9414 = 0,702 con las cifras del revisor).
- Se aplica a **todos los años atípicos** al sincronizar (también 2023): los factores de años anteriores cambian, lo que es `factores_cambiados` forzable (mueve referencias históricas de 06d, no el nivel de 2027).

**Cómo se aplica.** `φ_{T,Y,m}` = efectivo (`ratio_aplicado ?? ratio_calculado`, `factorDe`, sin cambio) en los meses atípicos de `T` en `Y` y 1 en el resto (`factoresMes`, sin cambio). Invierno 2026: `φ = 0,70` los doce meses. Verano 2026: `φ` = el valor que escriba Javier en set–dic, 1 en ene–ago.

**`ratio_aplicado`.** Sigue siendo la decisión de Javier y manda sobre el calculado. En invierno, lo normal es confirmar el calculado (escribir el mismo valor) o ajustarlo. En verano, con un mes del periodo, es la única forma de que exista factor. El diagnóstico nunca escribe `ratio_aplicado`.

**«Cómo crece el verano atípicamente» (decisión 2).** Lo que se muestra, por temporada (Factores del Niño) y por GM (pantalla de GM, solo sus agrupaciones de verano, sobre `C(Y)`, con el `κ_m` de la temporada):
- **Meses:** solo los del periodo atípico con dato en ambos años (hoy, setiembre 2026). Los demás aparecen en la tabla sin resaltar, para ver la tendencia.
- **Contra qué base:** (1) su **propia tendencia** fuera del periodo, `exceso_propio = ρ_P ÷ ratio_fuera` (cuánto creció en los meses del Niño por encima de lo que venía creciendo ene–ago); (2) **la red**, `exceso_red = ρ_P ÷ κ_P` (el relativo, la misma fórmula que invierno). Los dos al lado, con `ρ_m` mes a mes.
- **Mínimo de meses:** 2 del periodo con dato para que haya `ratio_calculado`. Con 1 mes (hoy): se muestran los dos excesos con el aviso «1 solo mes del periodo, y es el de inicio de temporada: dato frágil», `ratio_calculado = null`, y Javier escribe `ratio_aplicado`. Con 0 meses: «sin datos del periodo todavía».
- **El sistema no decide.** No hay botón «usar este valor»: Javier escribe el número en el campo «aplicado» con el diagnóstico delante.

**Estados de un factor de `Y` (`estadoFactorY`, B2).** Ámbito: temporadas con meses atípicos en `Y` y filas base de `Y+1` cuyo `φ_Y` las incluye. En este orden:
- `faltante`: sin efectivo.
- `desfasado`: `calculado_at` no nulo y alguno de: `formula` ≠ `relativo_periodo`; `huella_cargas` ≠ la de hoy; `parcial` y `meses_comparados` < meses del periodo publicados hoy; `huella_composicion` ≠ la de hoy. Se arregla con «Sincronizar» (no toca lo escrito por Javier).
- `sin_confirmar`: `parcial` y (`ratio_aplicado` nulo o `aplicado_huella` ≠ `huella_cargas`). Se arregla escribiendo el valor (el mismo lo confirma). Cada mes nuevo publicado pide sincronizar y volver a confirmar: es lo que hace que el número que fija 2027 tenga dueño.
- `ok`.

### 5.3 Ejemplos sintéticos

**A · Cierre por curva de HOMBRE · URBANO (`Y = 2026`, `k = 9`, `C(2026)` = 9 tiendas; 2025 normal = 54 000 u; factor de invierno 0,80 = `ρ_P` 0,76 ÷ `κ_P` 0,95).**

| Agrupación | Temporada · φ 2026 | Curva | `C_9` | `V` ene–set | `V'` | `T'` | oct · nov · dic real | Cierre real | Cierre corregido |
|---|---|---|---|---|---|---|---|---|---|
| ABRIGOS HO | invierno · 0,80 todo el año | v3: oct 0,05 · nov 0,07 · dic 0,08 | 0,80 | 12 000 | 15 000 | 18 750 | 750 · 1 050 · 1 200 | 15 000 | 18 750 |
| POLOS HO | todo el año · 1 | v2: oct 0,08 · nov 0,09 · dic 0,10 | 0,73 | 29 200 | 29 200 | 40 000 | 3 200 · 3 600 · 4 000 | 40 000 | 40 000 |
| **GM (`C(2026)`)** | | | | **41 200** | **44 200** | | 3 950 · 4 650 · 5 200 | **55 000 (+1,9 %)** | **58 750 (+8,8 %)** |

- Serie corregida de oct, nov y dic: 4 137,5 · 4 912,5 · 5 500.
- Acumulado ene–set: 41 200 ÷ 40 000 → **+3,0 %** real y 44 200 ÷ 40 000 → **+10,5 %** corregido. Año completo 2025: **+5,0 %**.
- **Base 2027 por curva (`M(2027)` = las 9 + T10, que abrió en marzo de 2025 y no está en `C(2026)`).** T10 vendió ene–set ABRIGOS 240 (corregido 300, `T'` 375, cierre real 300) y POLOS 584 (`T'` 800, cierre 800). Base real `K_M` = 55 000 + 1 100 = **56 100**; corregida `K'_M` = 58 750 + 375 + 800 = **59 925** (corrección +6,8 %, material).
- Vista previa 2027 al 8 %: 59 925 × 1,08 = **64 719** (tiendas de 2027), = +15,4 % sobre 56 100. Es la misma cifra que da M7 en B. (Con la base de `C(2026)` saldría 63 450: el «pongo 8 y veo otra cosa» de I2.)
- Con el factor de volumen (0,76) en lugar del relativo, ABRIGOS corregido sería 12 000 ÷ 0,76 ÷ 0,80 = 19 737 (+5,3 %): el invierno volvería al nivel de 2025 de esas tiendas y borraría la caída de la red (−5 %). Es lo que la decisión 1 descarta.

**B · La base corregida en M7 y el % aprobado (dos filas del mismo GM; T10 entra en `M(2027)`).**

| Fila | `B` (2026 real, tiendas de 2027) | `φ_2026` | `B'` | 2027 al 8 % sobre corregido | sobre 2026 real |
|---|---|---|---|---|---|
| ABRIGO × RECONOCIDO (invierno) | 15 000 + T10 300 = 15 300 | 0,80 constante | 19 125 | round(19 125 × 1,08) = **20 655** | +35,0 % |
| POLO × VALOR (todo el año) | 40 000 + T10 800 = 40 800 | 1 | 40 800 | **44 064** | +8,0 % |
| **GM** | **56 100** | | **59 925** (corrección +6,8 %) | **64 719** (+8,0 %) | **+15,4 %** |

- Con el método 4, el mismo 8 % daba 16 524 + 44 064 = 60 588, que es **+1,1 % sobre 2026 corregido**: el invierno se quedaba en el nivel deprimido del Niño.
- En pantalla: «8,00 % sobre 2026 corregido (59 925 → 64 719) = +15,4 % sobre 2026 real (56 100)».

**C · Verano: la corrección también baja la base.** CAMISETA × VALOR (verano; Niño de setiembre a diciembre; Javier escribió φ 1,50 con el diagnóstico de G; `k = 9`; curva con `C_9 = 0,70`). Ene–ago 6 000, setiembre real 1 500 → `V' = 6 000 + 1 500 ÷ 1,50 = 7 000`, `T' = 10 000`; oct–dic corregido 3 000 y real 3 000 × 1,50 = 4 500. `B = 6 000 + 1 500 + 4 500 = 12 000`; `B' = 6 000 + 1 000 + 3 000 = 10 000`. Al 8 %: **10 800**, que es **−10,0 % sobre 2026 real**. La pantalla dice «2026 vendió de más por el Niño en esta temporada».

**D · Versión aprobada antes de `0.14.0` en un GM con Niño material (I3).** HOMBRE · URBANO v1 = 15 % `bruta` (la base de B). Al recalcular con el método 5: ABRIGO round(15 300 × 1,15) = 17 595 y POLO round(40 800 × 1,15) = 46 920 → **64 515**, la misma cifra que con el método 4 (nada salta). Es +15,0 % real y 64 515 ÷ 59 925 − 1 = **+7,66 % sobre 2026 corregido**. La corrección del GM es +6,8 % ≥ 0,5 %: la proyección no cierra («HOMBRE · URBANO v1 se aprobó sobre 2026 real antes de 0.14.0 y este GM tuvo Niño en 2026 (+6,8 %): reapruébalo»).
- «Reaprobar» precarga «Aplicado hoy · corregido» = **7,66** (dos decimales) y crea la v2 `corregida`.
- Resultado: ABRIGO round(19 125 × 1,0766) = **20 590** (+2 995) y POLO round(40 800 × 1,0766) = **43 925** (−2 995). Total **64 515**: el GM no se mueve; el invierno sube y el todo el año baja.
- Con un decimal (7,7) el GM daría 20 598 + 43 942 = 64 540 (+25): por eso la precarga lleva dos.
- Si una de las dos filas de 2027 estuviera decidida, no se movería y quedaría con «propuesta cambió»; el `confirm` lo cuenta.

**E · GM sin Niño o con Niño no material.** MUJER · FORMAL, con una línea de invierno que pesa poco: `Σ B' ÷ Σ B − 1 = +0,1 %` < 0,5 %. Una v1 `bruta` al 10 % sigue valiendo para cerrar (M7 la aplica `round(B × 1,10)`, igual que el método 4), no aparece la línea corregida y la pantalla muestra un solo % con la nota «corrección del Niño +0,1 % (no material)».

**F · R-N.** Base «Cierre 2026 por curva · corregido» = +8,8. Javier escribe 8,00: la diferencia es 0,8 pp > 0,5, así que la nota es obligatoria. Elegir la variante `bruto` del Acumulado (+3,0) en este GM con Niño material también la exige.

**G · Cómo crece el verano atípicamente (temporada verano, 9 tiendas comunes, `N = 2025`, periodo set–dic 2026, `k = 9`).**

| Meses | 2025 | 2026 | `ρ` | red `κ` | `ρ ÷ κ` |
|---|---|---|---|---|---|
| ene–ago (fuera del periodo) | 50 000 | 60 000 | 1,200 | 0,950 | 1,263 |
| **set (periodo)** | 7 000 | 13 300 | **1,900** | 0,950 | **2,000** |

- `exceso_propio = 1,90 ÷ 1,20 = 1,58`; `exceso_red = 2,00`. Un mes del periodo (< 2): `ratio_calculado = null`, aviso «dato frágil».
- Javier escribe 1,50 (entre los dos, sabiendo que setiembre es inicio de temporada). Desde ahí `φ_verano,2026` = 1,50 en set–dic, con `aplicado_huella` = la huella de cargas de hoy.

**H · Factor que queda viejo (B2).** El 29/10 Javier confirma invierno 0,70 (`aplicado_huella` = h_set). En noviembre se publica octubre: la fila queda `desfasado` (huella y 9 < 10 meses). «Sincronizar» recalcula 0,71 con `huella_cargas` = h_oct: la fila pasa a `sin_confirmar` («tu valor 0,70 · calculado hoy 0,71»). Javier escribe 0,71 (o deja 0,70 reescribiéndolo): `ok`. Recalcular la proyección resuelve `factores_cambiados`.

### 5.4 Reglas que el código garantiza (cada una con su prueba vitest)

| # | Regla | Dónde |
|---|---|---|
| R1 | Con `φ_Y ≡ 1`, `proponerSiguiente` (método 5) da el mismo `P`, `meses` y `B` que el método 4, para cualquier `g`, curva y aportes (prueba de propiedad). `B' = B`. | `siguiente.ts` |
| R2 | Con `φ_Y` constante, `P = round(B ÷ φ × (1+g))`; con `φ_Y` por meses (verano), `B' = Σ b_m ÷ φ_m`. Ejemplos B y C exactos. `φ_{Y+1}` cambia el reparto y no `P`. | `siguiente.ts` |
| R3 | `sobreBase = 'bruta'` reproduce el método 4 (`round(B × (1+g))`). | `siguiente.ts` |
| R4 | Precedencia fila > GM > Resto > defecto sin cambio. `sobre_base`: fila y Resto provisional → `corregida`; GM y Resto aprobados → el de la versión; foto con `sobre_base null` → `bruta`. | `crecimientos.ts` |
| R5 | El GM del ejemplo B da 64 719, +8,0 % sobre corregido y +15,4 % sobre real. `calcularPromedio(…, { sobre: 'corregida' })` pondera por `Σ B'`. | `crecimientos.ts` |
| R6 | `maduro_propio` corregida: `A' = vigente ÷ Σ c r φ_Y`. Con `φ_Y = 1` coincide con `A^b`; con Niño 0,70, `A' > A^b`. | `tiendas-nuevas.ts` |
| R7 | En una fila base sin aportes, **con `metodo = avance` y sin decidir en `Y`**, `|B' − T'| ≤ 1` u (`T'` = `total_normalizado` del cierre de `Y`). Con `plan_anterior` (`cierre.ts:95-100`) o decidida no se exige (M1). | `calculo.ts` |
| R8 | Cierre por curva: el ejemplo A da 55 000 / 58 750 / +1,9 % / +8,8 % sobre `C(2026)` y 56 100 / 59 925 sobre `M(2027)`. Con `k = 12`, `K = V`. Agrupación sin curva → compuesta y `sin_curva_pct`; GM sin ninguna curva → `null` con `sin_curva`; un mes `≤ k` sin publicar → `null` con `meses_faltantes`. | `cierre-curva.ts` |
| R9 | Con `φ = 1` en todos los meses, la serie corregida no se emite (`hay_nino = false`), `pct_corregido = pct` y `K'_M = K_M`. Con `φ` constante, el cierre real no depende de `φ`. | `cierre-curva.ts` |
| R10 | Referencias: `equivalente.corregido` = `pct_corregido` / `pct_sin_nino`; `sin_nino_mas_rebote` siempre `null`; `variante_defecto = corregido`; Año completo 2025 del ejemplo A da +5,0. «Aplicado hoy» de una `bruta` da 7,66 en el ejemplo D (dos decimales). | `referencias.ts` |
| R11 | `POST` con `cierre_proyectado` o `sin_nino_mas_rebote` → `400 base_retirada`, sin escribir. Una aprobación nueva guarda `sobre_base = corregida` y la foto con `metodo: 5`, `cierre`, `factores` y `serie_corregida`. | ruta |
| R12 | R-N: obligatoria con base `ninguna` o no calculable, con `|pct − base_valor| > 0,5`, o con variante `bruto` cuando el periodo de la referencia toca un año Niño del GM y `hay_nino`. | `reglas.ts` |
| R13 | `sin_cambio` exige además el mismo `sobre_base`: una vigente `bruta` se reaprueba con el mismo %. | `reglas.ts` |
| R14 | Obsolescencia (informativa), en este orden: `metodo_anterior` (vigente `bruta` y `hay_nino`) > `composicion` > `factor_cambiado` (algún factor de `Y` de la foto ≠ el efectivo de hoy **y** `|K'_M(φ hoy) ÷ K'_M(φ foto) − 1| ≥ 0,5 %**, M3) > `base_no_calculable` > `base_movida`. | `reglas.ts` |
| R15 | `gm_con_nino` lista exactamente los GM (y `resto`) con `correccionMaterial(Σ B, Σ B')`; un GM al +0,49 % no entra y uno al +0,50 % sí. | `calculo.ts`, `factor-nino.ts` |
| R16 | Cierre: `anio_siguiente_atipico`, `factor_faltante`, `factor_desfasado`, `factor_sin_confirmar`, `factores_cambiados` de `Y`, `temporada_cambiada` y `crecimientos_sin_aprobar` con `reaprobar` no se fuerzan; `factores_cambiados` de otro año sí. Orden de §3.3. | `reglas.ts` |
| R17 | Una vigente `bruta` de un GM fuera de `gm_con_nino` no entra en `reaprobar` y la proyección cierra con ella (ejemplo E). | `vigentes.ts` |
| R18 | `VERSION_METODO = 5`: una proyección en trabajo de método 4 queda con `version_metodo` y no se cierra ni forzando. Recalcular conserva `decidido` y `crecimiento_pct`, y una 2027 decidida queda con `propuesta_cambio` si su propuesta se movió. Una cerrada no cambia. | `desactualizado.ts`, ruta |
| R19 | B2 de 06d: decidir una fila de `Y` (o una tienda que pasa a `M(Y+1)`) recalcula `P` con `B'` y el `sobre_base` de la foto, sin releer factores. Un `PATCH` de umbral conserva `crecimiento_resto_usado.sobre_base`. | `decision.ts`, ruta |
| R20 | M8: con una cerrada de `version_metodo = 4` aparece `cerrada_metodo_anterior` (texto nuevo) **y el flujo se calcula con las mismas cifras que con `VERSION_METODO_MIN_M8 = 4`**; con 5, sin aviso. | `flujo/modelo.ts` |
| R21 | `venta_genero_mundo` nueva: el lector de `0.12.1` suma lo mismo que antes (prueba con un `jsonb` con y sin `a`), y el lector nuevo agrupa por `a`. Cambiar la curva vigente de una agrupación o una tienda de `M(Y+1)` cambia `huella_datos`. | `series.ts`, `huellas.ts` |
| R22 | Permisos: el comprador recibe `403` en las tres rutas de 06d, en las de factores y en `POST …/cerrar`. | ruta |
| R23 | Factor relativo: con `P` = todos los meses publicados da el `ratio_relativo` de `efectoAtipicoCorrida`; con verano set–dic usa solo esos meses; con `|P con dato| < 2`, `ratio_calculado = null`; el ejemplo G da 1,90 / 1,20 / 0,95 / 1,58 / 2,00. Las columnas viejas de «Años Niño» no cambian. | `factor-nino.ts`, `efecto.ts` |
| R24 | `estadoFactorY`: cada condición de `desfasado` por separado (fórmula, huella, meses, composición), `sin_confirmar` con `aplicado` nulo y con `aplicado_huella` vieja, y el ejemplo H completo. Sincronizar no toca `ratio_aplicado`, `aplicado_huella` ni `nota`; guardar un aplicado escribe `aplicado_huella`. | `factor-nino.ts`, `servicio.ts` |
| R25 | Con meses atípicos en `Y+1`: `POST` de un GM → `409 anio_siguiente_atipico` sin escribir; cerrar → mismo código, también con `forzar`; calcular funciona. | ruta, `reglas.ts` |
| R26 | `correccionMaterial` es la única función de umbral: `hay_nino` (pantalla) y `gm_con_nino` (M7) la llaman (prueba estática sobre `crecimientos/{servicio,cierre-curva}.ts` y `proyeccion/calculo.ts`), y con las mismas `Σ B` y `Σ B'` dan lo mismo. | `factor-nino.ts` |
| R27 | Todo `insert` en `crecimientos_genero_mundo` y `proyeccion_crecimientos` lleva `sobre_base` explícito (prueba estática); `humo-0029.sql` comprueba el default `'bruta'`. | `crecimientos.estatico`, `proyeccion.estatico` |
| R28 | Reaprobar (ejemplo D): `total_despues = total_antes` ± redondeo, `filas_suben = 1`, `filas_bajan = 1`, `unidades_movidas = 2 995`; una fila decidida cuenta en `decididas_con_propuesta_cambio` y no se mueve. | `referencias.ts` |
| R29 | `temporada_cambiada`: mover una equivalencia de una agrupación de invierno a una de todo el año marca la proyección y bloquea el cierre; moverla entre dos de todo el año, no. | `desactualizado.ts` |
| R30 | Avance bajo (M2): una agrupación con `C_k` 0,10 y el 25 % de `Σ T'` marca el GM aunque el avance ponderado sea 0,45, y la base por defecto pasa a «Año completo». | `cierre-curva.ts`, `referencias.ts` |

### 5.5 Casos borde

| Caso | Comportamiento |
|---|---|
| Año sin Niño para el GM, o corrección < 0,5 % | Un solo %, sin línea corregida; con `φ ≡ 1`, cifras idénticas al método 4 (R1); con corrección no material, una `bruta` vale (E). |
| Factor de `Y` parcial | Se usa con la marca «factor parcial (ene–set)». Cerrar exige que esté al día y confirmado (§5.2). Cada mes nuevo: sincronizar, confirmar, recalcular (H). |
| Verano con 1 mes del periodo | `ratio_calculado = null`; diagnóstico visible; sin `ratio_aplicado` la base de verano no se corrige y cerrar da `factor_faltante` (G). |
| Temporada con Niño y sin factor | Pantalla: `φ = 1` con «sin factor: 2026 de verano no se corrigió». M7 calcula con `B' = B` y el aviso en la fila; cerrar da `409 factor_faltante`. |
| Factor escrito por Javier distinto del calculado | Manda el de Javier; Factores del Niño muestra los dos. |
| GML que mezcla temporadas | `φ` ponderado por mes (D2), con `temporadas_mezcladas`. La suma por agrupación de la pantalla puede diferir un poco de `Σ B'` de M7; la pantalla rotula las dos cifras con sus tiendas. |
| Agrupación sin curva vigente o equivalencias sin agrupación | Curva compuesta del GM, con `sin_curva_pct` a la vista. |
| Poco avance (enero a abril) o una agrupación frágil | `avance_bajo` por agrupación y del GM (M2); base por defecto «Año completo». No hay `plan_anterior` en la pantalla (es de M7). |
| Falta un mes `≤ k` de `Y` | Cierre por curva `null` con «faltan meses publicados» (M5); el resto de referencias sigue. |
| `k = diciembre` | El cierre es la venta real y el corregido es real ÷ φ. |
| Tienda de `C(Y)` que cierra después de `k` | Se proyecta su año entero en `C(Y)` (informativo); no está en `M(Y+1)`. |
| Tienda nueva de `Y−1` o `Y` que entra en `M(Y+1)` (R511) | Fuera de `C(Y)` y del factor; dentro de la base por curva y de la vista previa (I2). Su `B'` usa el factor de su temporada, igual que en M7. |
| `Y+1` marcado como Niño | No se modela (D7): aprobar y cerrar bloqueados con `anio_siguiente_atipico`; calcular sigue. |
| Versión `bruta` de un GM con Niño material | Se aplica como bruta; la pantalla muestra «aprobado sobre 2026 real antes de 0.14.0 · Reaprobar»; la proyección no cierra hasta reaprobar (D). |
| Versión `bruta` con base heredada (`cierre_proyectado`, `sin_nino_mas_rebote`) | Se lee y se muestra con su base original; «Reaprobar» usa «Aplicado hoy». La tanda 1 las cuenta (Javier aprobará en `0.13.x`). |
| Fila con % propio escrito antes de `0.14.0` en una línea con Niño | Pasa a significar «sobre 2026 corregido» (no hay columna para distinguirlo). El revisor midió 0; la tanda 1 vuelve a contar. Si hay, el CHANGELOG las lista. |
| Filas base sin `B` (`sin_propuesta`, `sin_curva`) | Quedan fuera de `Σ B` como hoy; la pantalla muestra «x u fuera de la base de M7» (M8; el revisor midió 355 filas y 26 956 u en la proyección de método 3, que probablemente desaparecen al recalcular). |
| Sin proyección de referencia de método 5 | Cierre y base por curva, Acumulado y Años completos funcionan y se puede aprobar; el equivalente sobre real se estima con la base por curva (`K'_M × (1+g) ÷ K_M − 1`), rotulado «estimado por curva». «Aplicado hoy» y «Reaprobar» muestran «— recalcula la proyección con 0.14.0». |
| Proyección cerrada de método 4 | No cambia; M8 la sigue usando con aviso (D12); cerrar una de método 5 la archiva sola. |

### 5.6 Transición: cerrar ahora con el método 4 y volver a cerrar con `0.14.0` (decisión 4)

1. **Ahora, con `0.13.x`:** Javier aprueba los GM y el Resto (quedan `bruta`, también si la `0029` ya está aplicada: B1), recalcula y cierra con el método 4. M8 la usa.
2. **Tanda 1:** se aplica la `0029` en producción. No cambia ninguna cifra de `0.13.x`: columnas con default `bruta` o `null` y una función compatible.
3. **Despliegue de `0.14.0`:** la cerrada de método 4 no cambia y M8 la sigue usando, con el aviso nuevo (no bloquea). Las versiones aprobadas siguen vigentes, ninguna queda obsoleta salvo `metodo_anterior` en los GM con Niño material. Las proyecciones en trabajo, si las hay, quedan «método nuevo».
4. **Volver a cerrar:** «Nueva proyección» con «copiar decisiones de» la cerrada (`copiar_de`, `esquemas.ts:75`); en Factores del Niño, «Sincronizar» (fórmula relativa), confirmar invierno y escribir verano con su diagnóstico; calcular (método 5). Las filas de 2027 decididas no se mueven; si su propuesta cambió, muestran «propuesta cambió».
5. **Reaprobar solo lo material:** la Pestaña Crecimientos y el modal de cierre listan los GM de `reaprobar` (los de `gm_con_nino` con vigente `bruta`); cada uno es un clic. Los demás no se tocan.
6. **Cerrar:** la cerrada de método 4 se archiva sola y M8 pasa a la nueva sin aviso.

Garantías: ninguna cifra cambia sola; ninguna versión se invalida en bloque; la cerrada de método 4 no se toca. El CHANGELOG y el aviso a Javier antes del despliegue dicen cuántos GM habrá que reaprobar (estimación de la pantalla con la base por curva) y que M8 mostrará el aviso hasta el nuevo cierre.

## 6. Criterios de aceptación (hito de Javier)

**Verificación previa (tanda 1, `datos`, SOLO `SELECT` en `vector-two`, nunca en `lukers-compras`; se repite justo antes de desplegar `0.14.0`):**
1. `factores_volumen_atipico` 2023–2027, todas las columnas.
2. `periodos_atipicos` activos que cubren 2026 y 2027, con `temporadas` y meses: confirmar invierno ene–dic 2026, verano set–dic 2026, **y que 2027 no tiene ninguno** (si tiene, avisar a Javier: con `0.14.0` no podrá aprobar ni cerrar, D7).
3. `crecimientos_genero_mundo` vigentes por año y alcance, con `referencia->'base'->>'tipo'` y `variante`: cuántas quedarán `bruta` y cuántas con base heredada.
4. `proyecciones` por estado y `resumen->>'version_metodo'`: la cerrada de método 4 que Javier usa para M8.
5. `count(*)` de `proyeccion_fila_anios` con `crecimiento_pct is not null`.
6. Por GM: agrupaciones con venta 2025–2026 y agrupaciones activas sin curva vigente.
7. Filas base de `Y+1` con aviso `sin_propuesta` o `sin_curva`, con su venta de 2026, por GM.
8. Tiendas de `M(2027)` que no están en `C(2026)` y su peso en ene–`k` de 2026.
9. GML que mezclan temporadas con venta 2025–2026.
10. Después de aplicar: `column_default` de `sobre_base` = `'bruta'::text` (humo); `venta_genero_mundo` ≤ 3 s en frío, dos pasadas con `explain (analyze, buffers)`, anotado.

Si (4) muestra una cerrada de método 4, el CHANGELOG avisa que M8 mostrará `cerrada_metodo_anterior` hasta el nuevo cierre. Si (5) > 0, se listan esas filas.

**Precondiciones del hito:** `0029` aplicada; `0.14.0` desplegada; en Factores del Niño, sincronizar y confirmar invierno 2026 y escribir verano 2026; nueva proyección copiando de la cerrada, calculada con `0.14.0`.

1. **Factores del Niño:** invierno 2026 muestra volumen, control y calculado relativo (≈ 0,70 con los datos de hoy), «9 de 12 meses», y su diagnóstico; verano 2026 muestra «—» en calculado, el diagnóstico de setiembre con los dos excesos y el aviso de dato frágil. Antes de sincronizar, la fila dice «fórmula anterior».
2. En «Crecimiento por género × mundo», cada GM muestra el cierre 2026 por curva (mismas tiendas) y la base 2027 por curva (tiendas de 2027) sin depender de la proyección. En HOMBRE · URBANO (o el GM de invierno más grande), «Cómo se cierra 2026» lista sus agrupaciones con curva, avance, factor y cierres, el rótulo del factor relativo con sus dos números, y se comprueba a mano una fila con §5.1.
3. El gráfico muestra 2026 completo (real y proyectado), «2026 corregido (sin Niño)» y «2027 vista previa» rotulada con las tiendas de 2027, que se mueve al escribir el %. La tabla año × mes trae las filas nuevas y el CSV también. Un GM sin Niño material no muestra la línea corregida.
4. Las referencias muestran «Cierre por curva» como base por defecto (o «Año completo» con avance bajo), y ya no aparece «sin Niño + rebote».
5. **[ESCRIBE]** Aprobar un % distinto del precargado sin nota se rechaza; con nota crea la versión «sobre 2026 corregido», y el `confirm` muestra los dos %.
6. **[ESCRIBE] Reaprobar (reescrito, I3).** Con una versión de `0.13.x` en un GM con Niño material: la lista la marca «reaprobar»; la proyección recalculada conserva el total de 2027 del GM y no deja cerrar (`reaprobar`). «Reaprobar» precarga el equivalente con dos decimales, su `confirm` dice cuántas filas suben, bajan y cuántas decididas quedarán con «propuesta cambió»; tras aprobar y recalcular, **el total del GM es el mismo (± pocas unidades) y sus líneas se redistribuyen hacia invierno**, como dijo el `confirm`. Un GM con corrección menor que 0,5 % no pide reaprobar.
7. La proyección en trabajo de método 4 aparece «desactualizada: método nuevo» y no cierra ni forzando. Después de recalcular: una línea de invierno con Niño muestra «+8,0 % sobre 2026 corregido · +x % sobre 2026 real»; una de verano con Niño puede bajar sobre real; una sin Niño queda con la misma cifra; ninguna decisión se pierde.
8. La Matriz muestra «Crec. sobre 2026 corregido» = el % aprobado del GM (sin filas fijadas) y «Crec. sobre 2026 real», también en el Excel.
9. **[ESCRIBE] Factor al día.** Con un factor de 2026 sin confirmar, cerrar da `factor_sin_confirmar`; confirmarlo lo resuelve. Cambiar el factor de invierno: la proyección queda desactualizada por factores, «Cerrar de todos modos» se rechaza y recalcular lo resuelve. Sin factor de verano, `409 factor_faltante`. (`factor_desfasado` lo cubre vitest: en el hito no se publica un mes a propósito.)
10. **[ESCRIBE] 2027 marcado.** Marcar un periodo atípico en 2027 y quitarlo enseguida: la pantalla de GM bloquea aprobar y la proyección no cierra, con el mensaje de D7; quitar la marca lo resuelve. (Opcional; si Javier prefiere no tocar periodos, lo cubre vitest.)
11. En M8, con la cerrada de método 4 aparece el aviso nuevo y el flujo da las mismas cifras que antes de `0.14.0`; tras cerrar la de método 5, la anterior queda archivada y el aviso desaparece.
12. Pasan `lint`, `tsc`, `vitest` y `build`; la `0029` corre dos veces seguidas; humo de la `0029` en verde; `APP_VERSION = "0.14.0 · M6"`.

## 7. Fuera de alcance

- Modelar el Niño de `Y+1` (`φ_{Y+1}` en el nivel); hoy se bloquea (D7).
- Proponer el factor de verano por el sistema (D4): solo diagnóstico.
- Normalización exacta por equivalencia dentro de un GML mixto (D2).
- Curva compuesta del GM para normalizar (D1, descartada).
- Cambiar el paso 1 de M7 (cierre de `Y` por fila) o la tabla de efecto de «Años Niño».
- Editar el factor desde la pantalla de GM (solo enlace).
- Convertir automáticamente las versiones `bruta`; distinguir el sentido del % propio de filas escritas antes de `0.14.0`.
- `plan_anterior` en la pantalla de GM.
- Aprobar géneros distintos de HOMBRE y MUJER, aprobación en bloque y sugerencias de % (06d §7). Soles.
- Borrar los tipos heredados (`cierre_proyectado`, `sin_nino_mas_rebote`), que quedan solo para leer versiones viejas.

## Plan de tandas (sin pisarse)

**Regla:** cada archivo tiene un solo dueño en cada tanda; un traspaso solo ocurre entre tandas y queda escrito aquí. Lo que la tanda 1 añade a tipos existentes es **opcional o nuevo**, para que `lint`, `tsc` y `vitest` pasen en cada commit. **`VERSION_METODO` y `VERSION_METODO_MIN_M8` suben en el último commit de Backend B**, junto con la prueba que fija sus valores; antes, todo fixture que escriba `version_metodo: 4` a mano pasa a importar la constante. **Orden:** después de `0.13.1 · M8` si ya está en curso (comparten `database.types.ts`, `version.ts`, CHANGELOG y los fixtures de `tests/flujo*`); la `0029` puede aplicarse antes (es inocua para `0.13.x`).

### Tanda 1 (en paralelo; solo lectura de la base salvo aplicar la `0029`)

**Datos** (`datos`):
- `supabase/migrations/0029_cierre_y_base_sin_nino.sql`, `scripts/humo-0029.sql`, `src/lib/supabase/database.types.ts` (regenerado).
- Verificación previa 1–9 (§6, solo `SELECT`), aplicar la `0029`, verificación 10. Entrega las cifras a `backend` y al documentador.

**Backend · contratos** (`backend`):
- `src/lib/crecimientos/{tipos-api,esquemas,vigentes}.ts` (§3.1; `vigentes.ts`: `sobre_base` en `VigenteCrecimiento`, `matrizDeVigentes` con `sobre`, `faltantesDeCierre(…, gmConNino)` con `reaprobar`).
- `src/lib/proyeccion/{crecimientos,tipos-api}.ts` (tipos nuevos opcionales; `UMBRAL_CORRECCION_NINO` reexportado; **no toca las dos constantes**) y **`src/lib/proyeccion/factor-nino.ts` (nuevo, puro)**.
- `src/lib/curvas/{efecto,modelo,tipos-api}.ts`: solo el bloque opcional `periodo` de §5.2 (aditivo).
- Después del commit de tipos de `datos`: `src/lib/crecimientos/consultas-vigentes.ts` (lee `sobre_base`).
- Pruebas: `tests/crecimientos.{vigentes,esquemas,consultas-vigentes}.test.ts`, `tests/proyeccion.crecimientos.test.ts` (R4, R5, R17), `tests/proyeccion.factor-nino.test.ts` (nueva: R15 y `correccionMaterial`, R23, R24 puras), `tests/curvas.efecto-periodo.test.ts` (nueva: R23) y `tests/curvas.modelo.test.ts` (sin cambio de cifras).
- Al cerrar la tanda, `src/lib/proyeccion/tipos-api.ts` pasa a Backend B y `src/lib/curvas/*` queda sin dueño (nadie lo toca en la tanda 2).

### Tanda 2 (cuatro en paralelo)

**Backend A · pantalla de GM** (`backend`):
- `src/lib/crecimientos/cierre-curva.ts` (nuevo, puro: cierre sobre `C(Y)` y `M(Y+1)`, avance bajo, diagnóstico de verano del GM) y `src/lib/crecimientos/{series,referencias,reglas,huellas,consultas,servicio,cache,comparables}.ts`. Lee curvas con `leerCurvasVigentes`/`curvaDeFila` y factores con `leerFactoresDb`, sin modificarlos; importa `factor-nino.ts`. `VERSION_REFERENCIAS = 2` y prefijo `v2|` en la caché.
- Pruebas: `tests/crecimientos.cierre-curva.test.ts` (nueva: R8, R9, R30) y `tests/crecimientos.{referencias,reglas,huellas,cache,rutas,estatico,comparables}.test.ts` (R10–R14, R21, R22, R25 de aprobar, R26 de la pantalla, R27 de crecimientos, R28). `tests/crecimientos.fixture.ts` y `tests/crecimientos.fake-db.ts` ganan `a`, curvas, factores y `sobre_base`.
- No escribe `.from("proyecciones" | "proyeccion_…")` (prueba estática de 06d).

**Backend B · método 5, factores y cierre** (`backend`):
- `src/lib/proyeccion/{siguiente,tiendas-nuevas,decision,calculo,explicar,persistencia,matriz,excel,reglas,desactualizado,contexto,servicio,servicio-base,servicio-crecimientos,servicio-lectura,servicio-edicion,consultas}.ts` (incluye `sincronizarFactores` con la fórmula relativa y `guardarFactores` con `aplicado_huella`).
- `src/lib/proyeccion/tipos-api.ts` (el último commit sube `VERSION_METODO = 5` y `VERSION_METODO_MIN_M8 = 5`).
- `src/lib/flujo/tipos-api.ts` (solo el texto de `cerrada_metodo_anterior`).
- Pruebas: `tests/proyeccion.metodo5.test.ts` (nueva: R1–R3, R6, R7, R15, R19, R29), `tests/proyeccion.cierre.test.ts` (la propiedad «`P` no depende de `φ_Y`» del método 4 pasa a probarse con `sobreBase = 'bruta'`), `tests/proyeccion.{reglas,crecimientos-globales,crecimientos-rutas,rutas,endurecimiento,persistencia,matriz,tiendas-nuevas-venta-mensual,estatico}.test.ts`, `tests/proyeccion.{fake-db,contexto-falso,fixture}.ts` (R16, R18, R24 de servicio, R25 de cierre, R26 de M7, R27 de proyección), `tests/flujo.{modelo,tamano-real}.test.ts`, `tests/flujo.{fixture,soporte}.ts`, `tests/compras.fake-db.ts` (literales → `VERSION_METODO_MIN_M8`; R20).

**Frontend A · pantalla de GM** (`frontend`):
- `src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/**` (lista, detalle, gráfico, tabla, «Cómo se cierra» con factores y diagnóstico de verano, referencias, aprobar, reaprobar, versiones y `vista.ts` con la vista previa pura).
- Pruebas: `tests/crecimientos.pantalla.fixture.ts`, `tests/crecimientos.pantalla-vista.test.ts`, `tests/crecimientos.pantalla-render.test.ts`.

**Frontend B · proyección** (`frontend`):
- `src/app/(app)/planificacion/proyeccion/{factores-tab.tsx,crecimientos-tab.tsx,crecimientos-vista.ts,matriz-tab.tsx,detalle-fila.tsx,bloque-decision.tsx,tabla-filas.tsx,vista.ts,cerrar-modal.tsx,cabecera-proyeccion.tsx,formulario-proyeccion.tsx,antes-de-proyectar.tsx}`. `VERSION_METODO_CRECIMIENTOS` se reemplaza por `VERSION_METODO` importado.
- Pruebas: `tests/proyeccion.{crecimientos-vista,crecimientos-render,render,vista,pantalla.estatico}.test.ts`, `tests/proyeccion.{crecimientos-pantalla,pantalla}.fixture.ts`.

### Tanda 3

`qa` → `seguridad` (sonnet: la función reemplazada conserva `security invoker`, `search_path = ''` y los permisos; las columnas nuevas no amplían nada; ningún `set default`) → `documentador` (`CHANGELOG.md` con la transición de §5.6, el número de GM a reaprobar y el aviso de M8; `docs/PLAN.md`, con M9a pasando a la versión libre siguiente; `docs/DECISIONES.md`; esta ficha; la sección nueva de `docs/pruebas/cowork-checklist.md`; `src/lib/version.ts` = `0.14.0 · M6`).

## 8. Propuestas para `docs/DECISIONES.md`

1. **(Revierte en parte 07c, 2026-10-16.)** El % del año siguiente es «sobre `Y` corregido del Niño de las mismas tiendas de `Y+1`»: `P = round(B' × (1+g))`, con `B'` normalizada **por fila** con el factor de su temporada. Toda pantalla muestra también el % sobre `Y` real.
2. **(Ajusta 07 §3 y 06 regla 8f.)** El factor del Niño que usa M7 es **relativo**: ratio de la temporada en los meses del periodo ÷ ratio de la red de todo el año en los mismos meses y tiendas. Con menos de 2 meses del periodo no se calcula. El de volumen queda como dato.
3. **(Cierra C3 del 2026-10-14.)** El periodo de verano se mantiene; su factor lo escribe Javier con el diagnóstico «cómo crece el verano atípicamente» a la vista. El sistema no lo decide.
4. **2027 no es Niño.** Si `Y+1` se marca atípico, aprobar crecimientos de `Y+1` y cerrar se bloquean hasta decidir cómo modelarlo.
5. Cerrar exige, sin excepción, un factor de `Y` existente, al día (fórmula, cargas, meses y composición) y, si es parcial, confirmado por Javier sobre el cálculo vigente; y recalcular si cambió.
6. Umbral único de materialidad del Niño: 0,5 % de la base del GM. Por debajo, una versión `bruta` vale y no se pide reaprobar.
7. **(Ajusta 06d.)** `VERSION_METODO = 5` y `VERSION_METODO_MIN_M8 = 5`; una cerrada de método 4 sigue sirviendo a M8 con aviso hasta el nuevo cierre. Las versiones de antes de `0.14.0` se conservan como `bruta`; `sobre_base` tiene default `bruta` para siempre.
8. El cierre del año en curso del GM se calcula en Curvas por agrupación, con las curvas vigentes de M6, sobre las tiendas del % y sobre las de `Y+1`. «Sin Niño + rebote» y «Cierre proyectado» dejan de ser bases elegibles.

## 9. Cambios tras la revisión independiente y las decisiones de Javier (2026-10-29)

**Decisiones de Javier (mandan):** (1) factor de invierno relativo → D3, §5.2; (2) verano: el sistema calcula «cómo crece el verano atípicamente» y Javier escribe el factor → D4, §5.2, ejemplo G, §4; (3) 2027 sin Niño, bloquear aprobar y cerrar si se marca → D7, R25; (4) cerrar ahora con método 4 y volver a cerrar con `0.14.0`, con umbral 0,5 % → D8, D12, §5.6.

| Hallazgo | Dónde quedó |
|---|---|
| B1 default `corregida` | §2.1: una sentencia, default `bruta` para siempre, API explícita, humo y R27. |
| B2 factor parcial viejo | D5, §3.3 (motivos 6 y 7), §5.2 estados, columnas `formula`, `huella_composicion`, `aplicado_huella`, ejemplo H, R24. |
| I1 rótulos y números del factor | D3, §4.1 punto 3, §4.2 Factores del Niño, §5.2. |
| I2 tiendas nuevas fuera de la vista previa | D10, `M(Y+1)` en §5.1, ejemplo A, R8. |
| I3 reaprobar no deja cifras quietas | §4.1 punto 5, ejemplo D, `ReaprobarApi`, R28, criterio 6. |
| I4 `Y+1` marcado Niño | Propuesta descartada; D7 (decisión 3). |
| I5 umbral | D8, R15, R26. |
| M1 R7 | R7. · **M2** avance bajo | §5.1, R30. · **M3** `factor_cambiado` cada mes | R14 con umbral. · **M4** `VERSION_REFERENCIAS` | §3.1 Aprobar 2. · **M5** mes faltante | §5.1, `meses_faltantes`. · **M6** remapeo | `huella_composicion`, `temporada_cambiada`, R29. · **M7** texto M8 | §3.3 M8. · **M8** u fuera de la base | `gm_fuera_base`, §4.1, §5.5. · **M9** redacción y 22 GML | §3.3, encabezado. · **M10** plan B | §2.5 sin plan B; las bases heredadas se siguen leyendo porque Javier aprobará en `0.13.x`. |

## 10. Cambios respecto a la especificación (al construir `0.14.0`)

Lo construido sigue la ficha; estos son los puntos donde se apartó o la completó, y por qué.

- **`aplicado_at` sale de una heurística de 60 s.** La ficha no pedía mostrar cuándo se confirmó un factor. La tabla no tiene una columna para eso, así que la pantalla lo deduce de `updated_at`: si la última escritura cayó a menos de 60 s del `calculado_at`, se interpreta como «Sincronizar» y `aplicado_at` queda nulo (la pantalla dice «confirmado» sin día). Efecto conocido: un factor confirmado a menos de 60 s de haber sincronizado no muestra su día. Si molesta, la salida correcta es una columna `aplicado_at` en una migración.
- **`anio_ref` va dentro de `diagnostico`.** El año normal contra el que se comparó el periodo (por ejemplo 2025) se guarda como una clave más del `jsonb` `diagnostico`, no como columna: se añadió para que la pantalla escriba «frente a 2025» sin recalcular, y no necesita migración.
- **`total.pct_real` en la lista de GM.** La fila Total de la lista ganó, junto al % ponderado sobre la base corregida, su equivalente sobre `Σ B` real de 2026, para que el total también se pueda leer como «sobre 2026 real» (decisión D6: siempre los dos).
- **`base_total` se calcula sobre `Σ B` real.** En el promedio ponderado de crecimientos, `base_total` es la suma de las bases reales; la corregida (`Σ B'`) viaja aparte como `base_corregida_total`. La ficha no fijaba cuál de las dos iba en `base_total`; se dejó la real para que «sobre 2026 real» sea siempre contra lo vendido.
- **`huella_composicion` tiene una sola función que la calcula** (`leerHuellaComposicionTemporada`). La usan `sincronizarFactores` para escribirla y `motivosDesactualizada` y el cierre para compararla: es lo que garantiza que sincronizar y evaluar sin cambios en medio dé «al día» y nunca «desfasado» (R24).
- **`refrescarResumen`.** Decidir una fila base de `Y` mueve `B` y `B'` de `Y+1`, así que esa función de `servicio-edicion.ts` rehace también `gm_con_nino`, `gm_correccion_nino_pct` y `gm_fuera_base` con las filas de ahora; sin esto la lista de «reaprobar» habría quedado con la foto del último cálculo. Solo toca claves de conteo del `resumen` y solo si el cálculo ya las escribió (método 5).
- **F1 de QA: los meses del periodo llegan hasta el último cerrado.** La comparación del factor cubre los meses del periodo publicados hasta el último mes cerrado (corrección de QA sobre la primera construcción).
- **«Sincronizar» no pisa la autoría.** Si Javier escribió un factor, sincronizar no cambia su `ratio_aplicado`, su nota ni su `aplicado_huella`; tampoco cambia quién lo escribió (`perfil_id`, `usuario_nombre`): la autoría es de quien confirmó el factor, no de quien sincroniza. Solo se reescribe lo calculado.
- **`MENSAJE_BASE_RETIRADA`.** El texto del `400 base_retirada` vive como una sola constante en `src/lib/crecimientos/esquemas.ts` y lo comparten la API y la pantalla.
- **Dependencias.** La auditoría de seguridad pidió subir `next` a 16.4.1 y `zod` a 4.6.6; van en esta versión.
- **Pendientes que no se cerraron** (ver CHANGELOG `0.14.0`): aprobación no transaccional, `PUT` de factores sin bloqueo optimista (usa la `huella_cargas` del cliente), `aplicado_at` nulo en el caso de los 60 s, `xlsx` 0.18.5, y que QA no probó con datos reales de Javier ni en Vector2.

**Hito de prueba:** pendiente. Lo recorre Javier con la sección K del checklist (criterios de §6 sin marcar hasta entonces).

## Preguntas abiertas

Ninguna bloquea la construcción. **Resuelta por Javier (2026-10-30): se confirma el factor cada mes publicado** (ver `docs/DECISIONES.md`). Texto original de la pregunta:

1. **Reconfirmar el factor cada mes.** Con `aplicado_huella`, cada mes publicado obliga a sincronizar y volver a escribir el factor parcial antes de cerrar (ejemplo H). **Recomendación: mantenerlo**: el factor fija el nivel de 2027 de las líneas del Niño, y cerrar ocurre pocas veces al año. La alternativa (confirmar una vez y que valga hasta que Javier lo borre) deja que un factor de setiembre cierre en diciembre sin que nadie lo mire.

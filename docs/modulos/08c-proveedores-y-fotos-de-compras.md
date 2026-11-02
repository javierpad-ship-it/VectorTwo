# 08c · Proveedores, fotos de las líneas, galería, proformas y reporte Directorio (secciones de Compras traídas de COTV)

> **Estado: especificada el 2026-11-02. Falta pasarla por el `arquitecto-revisor` y que Javier responda §9.** Es una mejora de la parte de compras de M8 ([08](08-flujo-y-compras.md)), anterior a M9a, igual que la ficha vecina [08b · Agrupadores de compras](08b-agrupadores-de-compras.md). Adelanta a M9a dos piezas que la ficha 08 le había dejado: la pantalla de proveedores y los contactos.
>
> **Pedidos textuales de Javier (2026-11-02).** (1) «en las compras que carguemos items también deberíamos poder cargar la foto. en 800x800 tú la reduces.» (2) «mira en el app de COTV todas las últimas cosas que le añadimos. Pero deberían ser todas secciones del módulo de compras. dentro del menú principal. Ordenaría el menú: Inicio, Compras, Planificación, Maestros, Administración» (el orden ya está en `nav.ts`, commit `a3b3def`). (3) «también es importante el módulo de proveedores. no recuerdo si está puerto de embarque en el caso de los proveedores».
>
> **Numeración (comprobada el 2026-11-02).** Hay aplicadas `0000`–`0025`, `0027`, `0029` y `0030`. Están reservadas la `0026` (`0.13.1 · M8`), la `0028` (M9a), la `0031` (07f) y la `0032` (08b, «la que se construya primero toma la `0032`»). **Migraciones de esta ficha**: E1 toma la siguiente libre al construir (`0032` si va antes que 08b, `0033` si va después) y E2 la que siga. Se citan como **`00E1_proveedores_y_fotos.sql`** y **`00E2_parametros_precio.sql`**, y el `datos` les pone el número al construir (decisión 48). **Versión**: la siguiente libre al cerrar cada entrega (hoy `APP_VERSION = "0.15.0 · M7"`, y están reservadas `0.13.1 · M8`, `0.15.0 · M7 b`, `0.15.1 · M7` y la de 08b). Los commits llevan el prefijo `M8:`, como 08b.
>
> **Base real.** Esta sesión no tenía el MCP de Supabase, así que el estado de la base se comprobó con lo que hace de fuente de verdad según PLAN §5: `supabase/migrations/0025_flujo_y_compras.sql` y `src/lib/supabase/database.types.ts`, que se generó contra `vector-two`. `proveedores` tiene `codigo`, `nombre`, `pais`, `ciudad`, `identificacion`, `es_intercompany`, `nota`, `perfil_id`, `usuario_nombre`, `activo` y timestamps. Las tablas de compras son `compras`, `compra_lineas`, `compra_linea_entregas`, `compra_linea_repartos`, `compra_linea_recepciones` y `compra_eventos`. No existen `proveedor_contactos` ni ningún bucket de Storage, y `src/` no usa Storage. **Antes de escribir la migración**, `datos` confirma en T1 lo siguiente, en solo lectura y sobre `vector-two` (ref `tzjsxzmsvvhxyiooihyq`, **nunca** `lukers-compras`): columnas de `proveedores` y `compra_lineas`; `select id, public from storage.buckets`; `select policyname from pg_policies where schemaname = 'storage'`; el plan del proyecto, porque condiciona la cuota de Storage (§8, riesgo 1). Lo que encuentre lo anota en §2.0.
>
> **Sin datos reales.** Proveedores «Proveedor Norte», «Feria Sur», «Textiles Delta Ltd.» (China) y «Hilados Andinos SAC» (Perú); marcas ALFA y BETA; cifras inventadas. Las fotos de prueba son JPEG sintéticos que se arman en el propio test, byte a byte. En el repo no entra ninguna foto real de producto, ni en `tests/`, ni en `public/`, ni en `datos/`.

## 0. Contexto

### 0.1 Qué se trae de COTV y qué no (verificado en `/home/user/cotbv2`, solo lectura)

| Pieza de COTV (archivo) | Qué hace allí | En Vector2 |
|---|---|---|
| Proveedores (`SupplierForm`, `CountryStateFields`, `SupplierContactsFields`, `app/actions.ts` `createSupplier`/`updateSupplier`) | Nombre único, país (lista), estado solo si es EE. UU., dirección, RUC, cuenta y banco, contactos múltiples (nombre, cargo, teléfono, correo). Las *server actions* escriben con el cliente del usuario y **borran y reinsertan** los contactos en dos pasos | **Se trae** (§2.1–2.2) como maestro compartido por todos los viajes, sobre la tabla `proveedores` que ya existe (M8). Se añaden la dirección, el estado o provincia para cualquier país, y los campos de importación de §9 A. **Banco y cuenta quedan fuera** salvo que Javier diga otra cosa (regla 19 de M8, §9 A3). Contactos y ficha se guardan en **una sola transacción** |
| Alta al vuelo (`ensureSupplier` en `app/actions.ts`) | Si el nombre no existe, lo crea en silencio | **Se trae** con dos frenos. Si el nombre está repetido, ofrece «usar el existente». Si se parece a otro, pregunta «¿es alguno de estos?» (§3.2) |
| Fotos por ítem (`PhotoPicker`, `lib/image.ts`, `lib/photos.ts`, `purchase_photos`) | Hasta 3 por ítem. En el navegador: lado largo de 1000 px y JPEG 0,8. El navegador **sube directo** al bucket privado `purchase-photos` gracias a **políticas abiertas a `authenticated`** (lectura, alta y borrado de cualquier objeto del bucket). La tabla tiene la política `authenticated full access`. Se lee con URL firmada de 1 h | **Se trae con otro modelo de seguridad** (§2.4, §3.3). Lado largo de 800 px. La subida **pasa por un route handler** con guard, que sube con `service_role` a un bucket privado **sin políticas**. Las URLs firmadas se generan solo en el servidor. Se añade una miniatura de 320 px. Hasta 3 fotos por línea |
| Fotos para celular (`FotosModule`) | Filtro por proveedor con «N ítems · M sin foto», casilla «Solo sin foto», contador con foto / total, cámara o galería | **Se trae** como **Compras → Fotos** (§4.3) |
| Galería (`GaleriaGrid`) | Matriz de miniaturas del viaje, filtro por proveedor, vista ampliada | **Se trae** como **Compras → Galería** (§4.4), paginada y firmando solo la página visible |
| Proforma (`ProformaTable`, `lib/pricing.ts`, `lib/proforma-pdf.ts`) | Interna: PVP sugerido = FOB × 13,4 redondeado a X9,90 y CV esperado = FOB × 1,3 × 3,4 × 1,18 ÷ PVP. Externa: oculta PVP y CV. Filtro por proveedor; PDF con fotos (jsPDF + autotable) y Excel. **Los parámetros viven en `localStorage`** | **Se trae** como **Compras → Proformas** (§4.5). Los parámetros pasan a una **configuración versionada en base** (§2.6). La **externa exige un proveedor** y el servidor **no manda** PVP, CV ni parámetros (§5, R14–R15) |
| Intercompany (`app/intercompany`, `lib/campaigns.ts`) | «Espacio de compra» fuera del OTB, con necesidades de origen `INTERCOMPANY` | **No se trae**: ya está resuelto en Vector2 con las reglas de M13, el subflujo de M8, el origen `intercompany_cd` y el proveedor `es_intercompany`. Para ver solo esas compras basta el filtro «Origen» de Compras, que también se ofrece en Galería y Proformas |
| Reporte Directorio (`lib/dir-report.ts`, `ReporteDirectorioTree`) | Árbol colapsable comprador > género > agrupación > marca > mundo > línea con unidades, FOB total y «PVP aprox.» = FOB × 13,4 | **Se trae en la E3** (§4.6). Aporta algo que M8 no tiene: lo **comprado** en dinero (costo, venta potencial a PVP sugerido y CV) por comprador y marca. El «Avance por árbol» de `0.13.1` mira la necesidad (saldo, IMI), no el dinero |
| Pendientes con barra de cobertura (`PendientesList`) | Unidades pendientes contra OTB del viaje, con barra comprado / OTB | **No se trae aquí**: ya está **Pendientes** en `0.13.1` (ficha 08 §4.5). Lo único que suma la barra se propone para esa ficha (§9 D4) |
| Dashboard por comprador (`CompradorDashboard`) | OTB contra comprado por comprador y combinación | **No se trae**: es OTB por viaje (descartado, decisión 2). En Vector2 lo cubren Huecos con «Mis líneas» y el primer nivel del Directorio |
| Asignar comprador por género × mundo (`AssignBuyerSelect`, `app/compradores`) | — | **No se trae**: ya existe en M1b |
| «Nueva línea» con edición y borrado múltiple (`NewLineForm`, `ManageNeedsList`, `createNeed`/`deleteNeeds`) | Necesidades OTB escritas a mano | **No se trae**: en Vector2 la necesidad se calcula (M7 → M8) y no se escribe |
| Viaje activo (`CampaignSwitcher`, cookie `cotbv_campaign`) | Filtro del viaje | **Lo define 08b** (`compra_viajes`, cookie `v2_viaje_activo`, parámetro `viaje_id=uuid\|sin_viaje`). Aquí solo se usa como filtro, con la misma barra de 08b |

Lo que funcionó en COTV y se repite: comprimir en el navegador, tres fotos por ítem, URL firmada de 1 h, PDF con miniaturas generado en el cliente y compartible (`navigator.share`), redondeo X9,90 y filtro «solo sin foto».

Lo que se corrige: las políticas abiertas a `authenticated` en `storage.objects` y en `purchase_photos`, que dejaban a cualquier usuario con sesión leer o borrar cualquier foto desde el navegador; los parámetros en `localStorage`, distintos en cada equipo y sin rastro; reemplazar los contactos en dos pasos sin transacción; y una proforma externa que podía salir con «Todos los proveedores».

### 0.2 Qué toma como dado (no se reabre)

| Fuente | Qué se respeta |
|---|---|
| Decisión 28 | Todos ven todo y «lo mío» es un filtro. Cualquier usuario crea y edita proveedores; el planner los desactiva (ficha 08, «Qué decide quién») |
| Decisión 60 y ficha 08 §0.12 | Toda escritura de las tablas de compras y de `proveedores` va por funciones plpgsql. Hay una prueba estática que impide `.insert/.update/.upsert/.delete` sobre ellas (`tests/flujo.estatico.test.ts`) |
| PLAN §4 y `0013` | RLS sin políticas; `revoke` a `public`, `anon` y `authenticated` y `grant` a `service_role` en todo objeto nuevo. Migraciones idempotentes, sin `DROP`, `UPDATE`, `DELETE` ni `TRUNCATE` a nivel de migración, sin `do $$` y sin backfill. Los catálogos van en zod |
| Ficha 08 §4.0 y §11 | El comprador no ve soles de venta de M5. El PVP sugerido de la proforma no es venta real: sale del costo de compra y de los parámetros (§9 C1) |
| 10-pwa | Sin escritura sin conexión: una foto que no se pudo subir se reintenta mientras la pantalla siga abierta y no se guarda en el teléfono |
| 08b | Viaje, embarque, paquete, comprador responsable, viaje activo y compras locales se definen allí. Esta ficha solo los **lee** a través de sus filtros y de `CompraApi.viaje` |

### 0.3 Entregas, migraciones y plan de tandas

| Entrega | Qué trae | Migración | Depende de |
|---|---|---|---|
| **E1** (versión libre al cerrar) | **Proveedores** (ficha completa, contactos, alta al vuelo, desactivar y eliminar); **fotos por línea** (subir, quitar, ver en el detalle de la compra); **Compras → Fotos** para el celular; **descripción y modelo** de la línea; menú | `00E1_proveedores_y_fotos.sql` | 0.13.0 validada; en serie con 08b (comparten `nav.ts`, `src/lib/compras/tipos-api.ts` y `src/components/compras/**`) |
| **E2** | **Galería**; **Proformas** interna y externa con PDF y Excel; **parámetros de precio versionados**; columnas `DESCRIPCION` y `MODELO` en el importador si `0.13.1` aún no rehízo `importar_compra` | `00E2_parametros_precio.sql` | E1. Con 08b construida suma el filtro por viaje |
| **E3** | **Reporte Directorio** (árbol y Excel) | ninguna | E2 (usa los precios) y 08b (comprador responsable) |

**Recomendación de orden (§9 D1)**: validar `0.13.0`, luego **E1**, luego **08b**, luego **E2 y E3**, luego `0.13.1` y por último M9a. E1 no depende de nada nuevo y es lo que pidió Javier primero: las fotos funcionan ya sobre las compras de la carga inicial. E2 y E3 ganan mucho con el filtro por viaje de 08b. **Nunca en paralelo con 08b ni con `0.13.1`**, porque los tres tocan `detalle-compra.tsx`, `compras/tipos-api.ts` y `nav.ts`.

**Tandas de E1** (dueño único por archivo; mismas reglas que ficha 08 §0.8):

| Tanda | Agente | Depende de | Archivos (exclusivos) | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Contratos | `backend` | — | `src/lib/proveedores/{tipos-api,esquemas,paises,regiones}.ts`, `src/lib/fotos/{tipos-api,esquemas,constantes}.ts`, `tests/proveedores.fixture.ts`, `tests/fotos.fixture.ts` (JPEG sintético armado en código), `tests/proveedores.esquemas.test.ts`, `tests/fotos.esquemas.test.ts` | `tsc` limpio; esquemas probados |
| T1 · Datos | `datos` | — | `supabase/migrations/00E1_proveedores_y_fotos.sql`, `scripts/humo-00E1.sql`, `src/lib/supabase/database.types.ts` | Consultas de solo lectura anotadas en §2.0; aplica dos veces; humo verde (R6, R8, R9, R11, R21, bucket privado sin políticas) |
| T2 · Lógica pura | `backend` | T0 | `src/lib/fotos/{jpeg,dimensiones,validar}.ts`, `src/lib/proveedores/{reglas,parecidos,completitud}.ts`, `src/lib/compras/proveedores.ts` (lo amplía y deja de ser de M8), `tests/fotos.*.test.ts`, `tests/proveedores.*.test.ts` | R1–R5, R12, R13 y R16 verdes |
| T3a · Pantallas con fixtures | `frontend` | T0 | `src/app/(app)/compras/fotos/**`, `src/app/(app)/compras/proveedores/**`, `src/components/fotos/**` (`comprimir.ts`, `selector-fotos.tsx`, `tarjeta-linea-fotos.tsx`, `visor-foto.tsx`), `src/components/proveedores/**` (`formulario-proveedor.tsx`, `selector-proveedor.tsx` con «Crear», `campos-pais-region.tsx`, `contactos.tsx`), `src/lib/fotos/use-fotos.ts`, `src/lib/nav.ts`, **aditivo** en `src/lib/api-client.ts` (`api.subir(url, FormData)`, sin `Content-Type`), `tests/fotos.pantalla.estatico.test.ts` | build y `tsc` limpios; 390 px sin controles fuera |
| T3b · Servicio y API | `backend` | T1, T2 | `src/lib/fotos/{almacen,consultas,servicio}.ts`, `src/lib/proveedores/{consultas,servicio}.ts`, `src/app/api/compras/proveedores/**`, `src/app/api/compras/[id]/lineas/**`, `src/app/api/compras/fotos/**`, `tests/fotos.handlers.test.ts`, `tests/proveedores.handlers.test.ts`, `tests/fotos.estatico.test.ts`. **Aditivos**: `src/lib/compras/{tipos-api,consultas,servicio}.ts` (`descripcion`, `modelo`, `fotos_activas` en `LineaCompraApi`), `tests/flujo.estatico.test.ts` (tablas y funciones nuevas en la lista), altas en `tests/api.guards.roles.test.ts` | R6–R11, R17–R21 verdes; guards y roles verdes |
| T4 · Integración | `frontend` | T3a, T3b | Los de T3a más **un cambio aislado** en `src/components/compras/detalle-compra.tsx` (un `<FotosLinea>` y «Descripción / modelo» por línea) | Contra la API real en local, en Chrome Android y Safari iOS (cámara trasera, galería, HEIC) |
| T5 · Cierre | `qa`, `seguridad` (sonnet), `documentador` | T4 | `qa` y `seguridad` solo leen. `documentador`: `docs/**`, `src/lib/version.ts` | Hito de §6 E1 |

**E2** sigue el mismo esquema: T0 con `src/lib/proformas/{tipos-api,esquemas}.ts`; T1 con `00E2_parametros_precio.sql`; T2 con `src/lib/proformas/{precios,armar}.ts` y pruebas; T3a con `src/app/(app)/compras/{galeria,proformas}/**`, `src/components/proformas/**` (`pdf.ts` con import dinámico de `jspdf` y `jspdf-autotable`, `excel.ts`, `simulador.tsx`) y `nav.ts`; T3b con `src/lib/proformas/{consultas,servicio}.ts`, `src/app/api/compras/{galeria,proformas,parametros-precio}/**` y `src/app/api/compras/fotos/[fotoId]/**`. **Dependencias nuevas**: `jspdf` y `jspdf-autotable`, autorizadas por la decisión 35; si la red las bloquea, ver §8, riesgo 6. **E3**: `src/lib/directorio/{armar,tipos-api}.ts`, `src/app/api/compras/directorio/route.ts`, `src/app/(app)/compras/directorio/**`, `src/components/directorio/**`.

## 1. Objetivo

El comprador vuelve de una feria con decenas de líneas y con fotos sueltas en el teléfono. Al planner le falta saber a quién se compró, desde dónde se embarca y en qué condiciones. Hoy Vector2 guarda las compras sin imagen, sin descripción y con un proveedor de solo nombre. Las proformas y el resumen para el Directorio se arman a mano fuera del sistema.

Este módulo hace tres cosas:

1. Convierte `proveedores` en un **maestro de importación**: ficha, contactos, puerto de embarque y condiciones.
2. Permite **fotografiar cada línea** desde el celular, reducida a 800 px y guardada de forma privada.
3. Con esas fotos y con los parámetros de precio **versionados**, produce la **galería**, las **proformas** interna y externa (PDF y Excel) y el **reporte Directorio**.

Todo vive como secciones de **Compras**, a la vista de cada rol según §4.1.

## 2. Modelo de datos

### 2.0 Comprobaciones previas en `vector-two` (las anota `datos` en T1)

*(Por llenar: columnas actuales de `proveedores` y `compra_lineas`; buckets existentes; políticas en `storage`; plan del proyecto y su cuota de Storage.)*

### 2.1 `proveedores` (existe desde `0025`; E1 añade columnas, sin backfill)

| Columna nueva | Tipo | Notas |
|---|---|---|
| `direccion` | `text null` | ≤ 300 |
| `region` | `text null` | ≤ 80. Es el «Estado / provincia». Con `pais = 'Estados Unidos'` la API exige un valor de la lista de estados (como COTV). Con otro país es texto libre, porque en China la provincia (Guangdong, Zhejiang) también importa |
| `puerto_embarque` | `text null` | ≤ 80. **Puerto habitual** de embarque (Ningbo, Shenzhen, Miami). El que vale para un envío concreto es dato del embarque de 08b, que muestra el del proveedor como referencia. Texto con sugerencias de los valores ya usados, sin catálogo (§9 A1) |
| `incoterm` | `text null` | Catálogo zod de los Incoterms 2020 (`EXW`, `FCA`, `FAS`, `FOB`, `CFR`, `CIF`, `CPT`, `CIP`, `DAP`, `DPU`, `DDP`); sin `check` (I9). Es el **habitual**; la compra no lo guarda en esta ficha (§7) |
| `moneda` | `text null` | La **habitual** (`USD` o `PEN`, el catálogo de `compras.moneda`). Prellena la moneda de una compra nueva en `0.13.1` |
| `plazo_produccion_dias` | `integer null` | `check (plazo_produccion_dias between 0 and 365)`. Días entre la orden y el embarque |
| `plazo_transito_dias` | `integer null` | `check (plazo_transito_dias between 0 and 180)`. Días entre el embarque y la llegada al CD. Con el anterior, `0.13.1` sugiere el mes de la primera entrega (fecha de compra + producción + tránsito) |
| `condiciones_pago` | `text null` | ≤ 200, libre («30 % adelanto, 70 % contra BL») |
| `revision` | `integer not null default 0` | `check (revision >= 0)`. Controla la concurrencia en la edición: la ficha y los contactos se guardan juntos; si otro guardó antes, `409 proveedor_cambio` |
| `updated_by_id` → `perfiles` `on delete set null`, `updated_by_nombre` | | Último cambio. `perfil_id` y `usuario_nombre` siguen siendo quién lo creó. Índice por `updated_by_id` |

Lo que **no cambia**:

- `pais` sigue siendo texto ≤ 80. La API valida las escrituras nuevas contra `PAISES` (`src/lib/proveedores/paises.ts`, nombres en español como `countries.ts` de COTV más los que falten de Asia). Un valor antiguo fuera de la lista (puesto por el importador) se conserva mientras no se toque, y la pantalla lo marca «país sin normalizar».
- `identificacion` pasa a rotularse «RUC / Tax ID».
- `codigo` y `nombre` mantienen sus únicos sobre `upper`.

Las columnas de las preguntas A1 y A2 **solo se crean si Javier dice que sí**.

### 2.2 `proveedor_contactos` (nueva; **pasa de la `0028` de M9a a esta ficha**, decisión propuesta 87)

`id`, `proveedor_id` → `proveedores` `on delete cascade` (con índice), `nombre` (1–120), `cargo` (≤ 80), `telefono` (≤ 40), `correo` (≤ 120, formato validado en zod), `es_principal boolean not null default false`, `orden smallint not null default 0`, `activo` (por convención: quitar borra la fila dentro de `guardar_proveedor`), `created_at`, `updated_at`.

Hay un índice único parcial `(proveedor_id) where es_principal`, que asegura **a lo sumo un contacto principal**. Se permiten como mucho 20 contactos por proveedor (`MAX_CONTACTOS_PROVEEDOR`, ya en `src/lib/compras/proveedores.ts`), y lo comprueba la API. Con esto, la `0028` solo lleva `compra_linea_mezcla`.

### 2.3 `compra_lineas` (existe desde `0025`; E1 añade columnas)

- `descripcion text null`, ≤ 200: qué es el producto («Jean slim azul medio»).
- `modelo text null`, ≤ 60: el código o estilo del proveedor («DL-2231»).

Ambas son opcionales y solo las escriben funciones (§2.7). Sirven para identificar la línea en Fotos, Galería y Proformas: dos líneas DENIM × ALFA del mismo proveedor solo se distinguen por ellas. La ficha 08 las dejaba para «segunda entrega como texto libre» (§4.0); entran ahora porque sin ellas la proforma externa no le sirve al proveedor (§9 B4).

### 2.4 `compra_linea_fotos` (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | También es el nombre del objeto en Storage |
| `linea_id` | `uuid not null → compra_lineas on delete restrict` | Las líneas nunca se borran (ficha 08 §0.12) |
| `compra_id` | `uuid not null → compras on delete restrict` | Copia de la compra de la línea, para filtrar sin unir tablas. La pone la función, que exige que coincida con la de la línea |
| `ruta` | `text not null` | `compras/{compra_id}/{linea_id}/{id}.jpg`. Único. **Nunca sale en la API** |
| `ruta_miniatura` | `text not null` | `…/{id}_min.jpg`. Único |
| `ancho`, `alto` | `smallint not null` | `check` entre 1 y 800 |
| `bytes`, `bytes_miniatura` | `integer not null` | `check (bytes between 1 and 409600)` y `check (bytes_miniatura between 1 and 61440)` |
| `subida_por_id` → `perfiles` `on delete set null`, `subida_por_nombre` | | |
| `quitada_at`, `quitada_por_id` → `perfiles` `on delete set null`, `quitada_por_nombre` | | Se llenan al quitar la foto |
| `activo` | `boolean not null default true` | `false` = quitada. `check (activo or quitada_at is not null)` |
| `created_at`, `updated_at` | | Con el trigger `set_updated_at` de siempre |

Índices: `(linea_id, created_at) where activo`, `(compra_id) where activo` y `(created_at desc) where activo` (este último para la galería).

**Por qué la foto no toca `compra_eventos` ni `compras.revision`.** `flujo_huella_base()` cuenta los eventos y suma las `revision` de las compras. Si cada foto los moviera, en una feria con cien fotos el flujo se recalcularía cien veces sin que cambie ninguna cifra. Además, quien está editando la compra a la vez recibiría un `409 compra_cambio` falso. La trazabilidad de la foto (quién la subió, quién la quitó y cuándo) vive en su propia fila, que nunca se borra (decisión propuesta 88).

**Orden.** La **principal** es la activa más antigua de la línea: la que usa la proforma. En E1 no hay «marcar como principal» (§7).

### 2.5 Bucket de Storage `compras-fotos`

- `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('compras-fotos', 'compras-fotos', false, 409600, array['image/jpeg']) on conflict (id) do nothing`. Es idempotente; si el bucket ya existe, no se toca.
- **Ninguna política** en `storage.objects` para este bucket. Con el RLS que Supabase ya tiene activo en `storage.objects`, nadie con `anon` o `authenticated` lee, sube ni borra. Solo `service_role`, desde los route handlers, con `supabaseAdmin()`. Es el mismo modelo que las tablas (PLAN §4).
- El humo comprueba que `public = false` y que no hay ninguna fila en `pg_policies` de `storage.objects` que nombre `compras-fotos`.
- Las rutas se arman con ids (`compras/{compra_id}/{linea_id}/{foto_id}.jpg`), nunca con nombres de proveedor o de marca.

### 2.6 `parametros_precio` (nueva en E2; configuración versionada, insert-only)

`id`, `version integer not null` (único; la siguiente la asigna `guardar_parametros_precio` bajo candado), `markup numeric(6,3) not null check (markup > 0)`, `factor_importacion numeric(6,3) not null check (factor_importacion > 0)`, `tipo_cambio numeric(8,4) not null check (tipo_cambio > 0)`, `igv_pct numeric(5,2) not null check (igv_pct between 0 and 100)`.

Para las compras en soles van además `markup_local numeric(6,3) null check (markup_local > 0)` y `factor_local numeric(6,3) not null default 1 check (factor_local > 0)` (§9 C3).

Cierran la tabla `nota` (≤ 200), `perfil_id` → `perfiles` `on delete set null`, `usuario_nombre` y `created_at`. **Sin `activo` ni `updated_at`**: es la misma excepción documentada que `compra_eventos`. Un trigger la hace inmutable también para `service_role` y contra `TRUNCATE`. La única excepción es el `UPDATE` que solo pone `perfil_id` en nulo cuando se borra un usuario (decisión 60).

**Vigente = la de `version` máxima.** No hay seed: sin ninguna fila, la API usa los valores de COTV (13,4 · 1,3 · 3,4 · 18 %) y la pantalla los rotula «valores por defecto, sin versión guardada», igual que `flujo_parametros`. El redondeo X9,90 y su umbral de 3,10 son constantes del código (`src/lib/proformas/precios.ts`), no parámetros (§7).

**Por qué en base y no en `localStorage`.** Dos compradores podían mandar al Directorio un CV calculado con tipos de cambio distintos sin saberlo, y una proforma no decía con qué parámetros se hizo. Ahora cada PDF y cada Excel llevan «Parámetros v3 (13,4 · 1,30 · 3,40 · 18 %)» o «Simulación (no guardada)».

### 2.7 Funciones (plpgsql, `security invoker`, `set search_path = ''`, solo `service_role`, `returns jsonb` con `{ ok: true, … }` o `{ ok: false, motivo }`)

| Función | Qué hace | `motivo` posibles |
|---|---|---|
| `guardar_proveedor(p_id uuid, p_revision int, p_proveedor jsonb, p_contactos jsonb, p_actor jsonb)` | Con `p_id` nulo, **crea**. Con id, bloquea la fila (`for update`), compara `revision`, actualiza la ficha y **reemplaza los contactos en la misma transacción**, sube `revision` y pone `updated_by_*`. Atrapa el `unique_violation` del nombre o del código | `proveedor_cambio`, `nombre_repetido`, `codigo_repetido`, `no_encontrado` |
| `cambiar_activo_proveedor(p_id uuid, p_activo boolean, p_actor jsonb)` | Desactiva o reactiva | `no_encontrado` |
| `eliminar_proveedor(p_id uuid, p_actor jsonb)` | Lo borra (con sus contactos, en cascada) si **no tiene ninguna compra**, de ningún estado. Si tiene, lo desactiva. Es la regla `accionEliminarProveedor` que ya existe | `no_encontrado` (devuelve `accion: 'borrado' \| 'desactivado'`) |
| `agregar_foto_linea(p_compra uuid, p_linea uuid, p_foto jsonb, p_actor jsonb)` | Bloquea **la línea** (`for update`; no la compra ni su `revision`). Comprueba que la línea es de la compra y está activa, que la compra no está `cancelada` y que hay menos de **3** fotos activas. Luego inserta | `no_pertenece`, `no_editable`, `max_fotos` |
| `quitar_foto_linea(p_compra uuid, p_linea uuid, p_foto uuid, p_actor jsonb)` | Bloquea la línea y comprueba pertenencia y que la compra no esté cancelada. Pone `activo = false` y `quitada_*`. Devuelve `ruta` y `ruta_miniatura` para que la API borre los objetos | `no_pertenece`, `no_editable`, `ya_quitada` |
| `editar_ficha_linea(p_compra uuid, p_linea uuid, p_revision int, p_descripcion text, p_modelo text, p_actor jsonb)` | Sigue el patrón de ficha 08 §0.12: bloquea la compra, compara `revision`, comprueba pertenencia y que no esté cancelada, escribe, sube `revision`, pone `updated_by_*` e inserta el evento `editar_linea` con `antes` y `despues` (`{ descripcion, modelo }`) y el `resumen`. **Esta sí cuenta para el flujo**: es un dato de la compra y es raro | `compra_cambio`, `no_pertenece`, `no_editable` |
| `guardar_parametros_precio(p_base_version int, p_parametros jsonb, p_actor jsonb)` (E2) | `pg_advisory_xact_lock` propio. Si la vigente no es `p_base_version`, rechaza. Si coincide, inserta `version + 1` | `parametros_cambiaron` |

La función `0026` de `0.13.1` que edite una línea entera (`editar_linea`) deberá incluir `descripcion` y `modelo`. Se anota como contrato para su ficha. `editar_ficha_linea` sigue valiendo como camino corto.

### 2.8 Diagrama

```
proveedores (M8 + E1: dirección, región, puerto habitual, incoterm, moneda, plazos, pago, revision)
   │ 1 ──< proveedor_contactos (≤ 20, ≤ 1 principal; se guardan con la ficha, en una transacción)
   │ 1 ──< compras (M8; viaje_id de 08b) ──< compra_lineas (+ descripcion, modelo)
   │                                            │ 1 ──< compra_linea_fotos (≤ 3 activas; quitar = activo false)
   │                                            │            └─ ruta, ruta_miniatura ─► Storage «compras-fotos» (privado, sin políticas)
   │                                            │                                       ▲ sube y borra: route handler con supabaseAdmin()
   │                                            │                                       └ lee: URL firmada de 1 h generada en el servidor
parametros_precio (E2, versionada, insert-only) ─► precios.ts (PVP X9,90, CV) ─► Proformas · Directorio
```

## 3. Contratos de API

Convenciones de siempre:

- **La primera sentencia de cada handler es el guard.** Los datos se leen y escriben solo con `supabaseAdmin()`.
- El JSON entra por `leerCuerpo(request, esquema)`. Se responde con `ok(…)` (`{ data }`) y los errores con `errorConCodigo(mensaje, status, codigo)`. Los ids de ruta pasan por `idDeRuta`.
- **Ninguna escritura directa** sobre `proveedores`, `proveedor_contactos`, `compra_lineas`, `compra_linea_fotos` ni `parametros_precio`: solo `.rpc(`, llamado desde `src/lib/{proveedores,fotos,proformas}/consultas.ts` (prueba estática).
- `.upload(`, `.remove(` y `.createSignedUrl(s)(` de Storage solo aparecen en `src/lib/fotos/almacen.ts`.
- Ningún componente cliente importa `@/lib/supabase/browser` para Storage.
- `ProveedorApi` (de `compras/tipos-api.ts`) crece de forma aditiva; `ProveedorFichaApi` vive en `src/lib/proveedores/tipos-api.ts`.

### 3.1 Esquemas zod

- **`proveedorFichaSchema`** (estricto, `z.strictObject`; una clave desconocida da `400` como hoy, regla 19). Campos:
  - `nombre`: 1–120, con `trim`.
  - `codigo`: ≤ 30.
  - `pais`: de `PAISES`, o el valor antiguo sin cambios.
  - `region`: de `ESTADOS_EEUU` si el país es EE. UU.; si no, ≤ 80.
  - `ciudad`: ≤ 80. `direccion`: ≤ 300. `identificacion`: ≤ 40.
  - `es_intercompany`: booleano.
  - `puerto_embarque`: ≤ 80. `incoterm`: catálogo. `moneda`: `USD` o `PEN`.
  - `plazo_produccion_dias`: entero de 0 a 365. `plazo_transito_dias`: entero de 0 a 180.
  - `condiciones_pago`: ≤ 200. `nota`: ≤ 300.
  - `contactos`: arreglo de hasta 20 de `{ nombre 1–120, cargo ≤ 80, telefono ≤ 40, correo email ≤ 120, es_principal }`, con a lo sumo un principal.
  - `revision`: entero ≥ 0, solo al editar.
  - **Obligatorios en la ficha**: nombre y país (§9 A4).
- **`proveedorRapidoSchema`**: `{ modo: "rapido", nombre, pais?, confirmar_parecido?: boolean }`. `POST /api/compras/proveedores` recibe la unión discriminada por `modo` (`"ficha"` o `"rapido"`).
- **`activoProveedorSchema`**: `{ activo: boolean }`.
- **`fichaLineaSchema`**: `{ descripcion: string ≤ 200 | null, modelo: string ≤ 60 | null, revision }`.
- **Subida de foto** (sin zod; `multipart/form-data` validado en `src/lib/fotos/validar.ts`): dos partes, `foto` y `miniatura`. Si `content-length` declara más de **512 KB**, `413` antes de leer.
- **`parametrosPrecioSchema`** (E2): `{ markup, factor_importacion, tipo_cambio, igv_pct, markup_local?, factor_local?, nota?, base_version: int | null }`, con rangos del mismo tamaño que los `check`.
- **`proformaQuery`** (E2): `{ tipo: "interna" | "externa", proveedor_id?, compra_id?: uuid[] (≤ 50), viaje_id?: uuid | "sin_viaje", origen?, desde?, hasta?, incluir_borradores?: "1" }`. Con `tipo = "externa"`, `proveedor_id` es **obligatorio**.

### 3.2 Proveedores (E1)

| Ruta | Método | Guard | Entrada | Respuesta `{ data }` | Errores |
|---|---|---|---|---|---|
| `/api/compras/proveedores` | GET | `requireUser` | `?activos=1&q=` | `ProveedorApi[]` (ya existe; suma `region`, `puerto_embarque`, `incoterm`, `moneda`, `completo: boolean` y `contactos` llenos) | — |
| `/api/compras/proveedores` | POST | `requireUser` | `proveedorFichaSchema` o `proveedorRapidoSchema` | `201` `ProveedorFichaApi` | `400` validación · `409 nombre_repetido` (con `conflicto { id, nombre }`) · `409 codigo_repetido` · `409 nombre_parecido` (con `parecidos [{ id, nombre, similitud }]`; solo en modo rápido y sin `confirmar_parecido`) · `403 solo_planner_intercompany` |
| `/api/compras/proveedores/[id]` | GET | `requireUser` | — | `ProveedorFichaApi` más `resumen { compras, ultima_compra, unidades, costo: { USD, PEN } }` | `404 no_encontrado` |
| `/api/compras/proveedores/[id]` | PATCH | `requireUser` | `proveedorFichaSchema` con `revision` | `ProveedorFichaApi` | `404` · `409 proveedor_cambio` · `409 nombre_repetido` · `409 codigo_repetido` · `403 solo_planner_intercompany` (un comprador que cambia `es_intercompany`) |
| `/api/compras/proveedores/[id]/activo` | POST | `requirePlanner` | `activoProveedorSchema` | `ProveedorFichaApi` | `404` |
| `/api/compras/proveedores/[id]` | DELETE | `requirePlanner` | — | `{ accion: "borrado" \| "desactivado" }` | `404` |

`ProveedorFichaApi` = `ProveedorApi` más:

- `direccion`, `plazo_produccion_dias`, `plazo_transito_dias`, `condiciones_pago`;
- `contactos [{ id, nombre, cargo, telefono, correo, es_principal }]`;
- `faltan: ("pais" | "identificacion" | "direccion" | "contacto")[]`;
- `pais_normalizado: boolean`;
- `creado_por` y `modificado_por` (`PersonaFechaApi`);
- `revision`;
- `puede { editar, cambiar_intercompany, desactivar, eliminar }`, calculado con el rol en el servidor.

**Parecido**: `similitud` de `src/lib/ventas/sugerir-mapeo.ts` (05b), que se importa y no se reescribe. Umbral `UMBRAL_PARECIDO_PROVEEDOR = 0,8` contra los proveedores activos. El modo ficha también avisa del parecido, pero no bloquea.

### 3.3 Fotos y ficha de la línea (E1)

| Ruta | Método | Guard | Entrada | Respuesta | Errores |
|---|---|---|---|---|---|
| `/api/compras/[id]/lineas/[lineaId]/fotos` | POST | `requireUser` | `multipart`: `foto` y `miniatura` | `201` `FotoLineaApi` | `413 foto_grande` · `400 foto_requerida` · `400 formato_invalido` (no es JPEG) · `400 dimensiones_invalidas` · `404 no_pertenece` · `409 no_editable` (compra cancelada o línea inactiva) · `409 max_fotos` · `502 almacen_no_disponible` |
| `/api/compras/[id]/lineas/[lineaId]/fotos/[fotoId]` | DELETE | `requireUser` | — | `{ id }` | `404 no_pertenece` · `409 no_editable` · `409 ya_quitada` |
| `/api/compras/[id]/lineas/[lineaId]/ficha` | PATCH | `requireUser` | `fichaLineaSchema` | `CompraApi` (como las demás rutas de la compra) | `404 no_pertenece` · `409 compra_cambio` · `409 no_editable` |
| `/api/compras/fotos` | GET | `requireUser` | `?proveedor_id&compra_id&viaje_id&origen&estado&solo_sin_foto=1&q&pagina&por_pagina (≤ 100)` | `FotosModuloApi` | `400` filtros |
| `/api/compras/fotos/[fotoId]` | GET | `requireUser` | — | `{ url, miniatura_url, expira_at, ancho, alto, leyenda }` (la foto grande firmada, bajo demanda) | `404` |

**Secuencia del `POST` de una foto** (`src/lib/fotos/servicio.ts`):

1. Guard.
2. Comprobar `content-length`.
3. `request.formData()`.
4. `validarJpeg` sobre cada parte: firma `FF D8 FF` al principio y `FF D9` al final; ancho y alto leídos del marcador SOF (`SOF0`/`SOF2`); la foto ≤ 800 × 800 y ≤ 400 KB; la miniatura ≤ 320 × 320 y ≤ 60 KB.
5. Pre-chequeo barato de pertenencia y de cuántas fotos hay.
6. Subir los **dos objetos** con `upsert: false`, `contentType: 'image/jpeg'` y `cacheControl: '3600'`.
7. `rpc('agregar_foto_linea')`.
8. **Si la función rechaza o falla, borrar los dos objetos** antes de responder.

Si el proceso muere entre 6 y 7, quedan objetos huérfanos sin fila. No se ven en ninguna pantalla y se limpian con `POST /api/compras/fotos/limpiar` (`requireAdmin`), que borra los objetos del bucket que tengan más de 24 h y no tengan fila. Esa ruta entra en E1 aunque no tenga pantalla: el admin la llama desde el detalle de un proveedor, en el menú «…».

**Quitar.** `rpc('quitar_foto_linea')` y después `.remove([ruta, ruta_miniatura])`. Si el borrado del objeto falla, la fila ya está inactiva y el objeto queda huérfano para la limpieza.

**Tipos.**

- `FotoLineaApi { id, miniatura_url, url, expira_at, ancho, alto, subida_por: PersonaFechaApi }`. La `url` grande solo se firma en el `POST`, en `GET /fotos/[fotoId]` y en la proforma.
- `FotosModuloApi { contadores { lineas, con_foto, sin_foto }, por_proveedor [{ id, nombre, lineas, sin_foto }], lineas: LineaConFotosApi[], pagina, total, expira_at }`.
- `LineaConFotosApi { compra { id, numero, revision, estado, proveedor, viaje }, linea { id, tipo, gml: NombreGml | null, marca, agrupacion_marca, tallas, unidades, costo_unitario, moneda, descripcion, modelo }, fotos: { id, miniatura_url, subida_por_nombre, at }[], puede_editar }`.

Se excluyen las compras canceladas salvo con `estado=cancelada`; ahí sus líneas salen en solo lectura. Las URLs se firman **en lote** (`createSignedUrls`), solo las de la página, con TTL de 3 600 s.

### 3.4 Galería y proformas (E2)

| Ruta | Método | Guard | Entrada | Respuesta | Errores |
|---|---|---|---|---|---|
| `/api/compras/galeria` | GET | `requireUser` | `?viaje_id&proveedor_id&compra_id&origen&genero_id&mundo_id&linea_id&marca_id&pagina&por_pagina (≤ 120)` | `{ fotos: [{ id, miniatura_url, leyenda { proveedor, compra_numero, compra_id, gml, marca, descripcion, modelo, unidades } }], total, pagina, expira_at }`, ordenado por `created_at desc, id` | `400` |
| `/api/compras/proformas` | GET | `requireUser` | `proformaQuery` | `ProformaApi` | `400 proveedor_requerido` (externa sin proveedor) · `400` filtros · `404 proveedor` |
| `/api/compras/parametros-precio` | GET | `requireUser` | — | `{ vigente: ParametrosPrecioApi \| null, por_defecto: ParametrosPrecioApi, historial: ParametrosPrecioApi[] }` | — |
| `/api/compras/parametros-precio` | POST | `requirePlanner` | `parametrosPrecioSchema` | `201` `ParametrosPrecioApi` | `409 parametros_cambiaron` · `400` |

**`ProformaApi`**:

- **Interna**: `{ tipo: "interna", filtros, parametros: ParametrosPrecioApi & { origen: "version" | "por_defecto" }, filas: FilaProformaInternaApi[], totales_por_moneda }`. Cada fila: `{ linea_id, compra { id, numero, referencia, fecha_compra }, foto_miniatura_url | null, genero, mundo, linea, agrupacion_marca, marca, tallas, descripcion, modelo, moneda, costo_unitario | null, unidades, total | null, pvp_sugerido | null, cv_pct | null, entregas: "nov-26 300 · dic-26 200" }`.
- **Externa**: `{ tipo: "externa", proveedor { nombre }, filtros, filas: FilaProformaExternaApi[], totales_por_moneda }`. Cada fila: `{ compra { numero, referencia }, foto_miniatura_url, marca, modelo, descripcion, tallas, unidades, moneda, precio_unitario, total, entregas }`.

**Un tipo distinto, no un campo oculto**: el serializador de la externa no conoce `pvp`, `cv`, `costo` interno, `parametros`, la agrupación de marca ni el árbol (R15; las columnas de la externa dependen de §9 C4).

`unidades` = `unidades − unidades_canceladas`; una compra con saldo cerrado muestra lo que de verdad se compró. Se excluyen las líneas inactivas y las compras canceladas. Los borradores solo entran con `incluir_borradores=1`.

**Simulación.** Las filas internas traen `costo_unitario` y `moneda`. El navegador recalcula PVP y CV con los mismos `precioSugerido` y `cvEsperado` de `src/lib/proformas/precios.ts`, que es lógica pura compartida entre servidor y cliente. Nada se guarda. Los exportes de una simulación salen rotulados como tal.

### 3.5 Directorio (E3)

| Ruta | Método | Guard | Entrada | Respuesta | Errores |
|---|---|---|---|---|---|
| `/api/compras/directorio` | GET | `requireUser` | `?viaje_id&desde&hasta&proveedor_id&origen&incluir_borradores` | `DirectorioApi` | `400` |

`DirectorioApi`:

- `niveles: ["comprador", "genero", "agrupacion_marca", "marca", "mundo", "linea"]`;
- `parametros`;
- `raiz: NodoDirectorioApi[]`, donde cada nodo es `{ etiqueta, lineas, unidades, costo { USD, PEN }, costo_soles, venta_potencial, cv_pct | null, hijos? | filas? }`.

Las hojas son `{ compra_numero, proveedor, descripcion, modelo, unidades, moneda, costo_unitario, pvp_sugerido, cv_pct }`. Se calcula en TS puro con `armarDirectorio(lineas, catalogos, responsables, parametros)`. El nivel 1 sale de §9 D2.

### 3.6 Códigos de error nuevos

`proveedor_cambio`, `nombre_repetido`, `codigo_repetido`, `nombre_parecido`, `solo_planner_intercompany`, `foto_grande`, `foto_requerida`, `formato_invalido`, `dimensiones_invalidas`, `max_fotos`, `ya_quitada`, `almacen_no_disponible`, `proveedor_requerido`, `parametros_cambiaron`. Se reutilizan `no_pertenece`, `no_editable` y `compra_cambio` de M8. Todos con mensaje en `MENSAJE_ERROR_*` y estado en `ESTADO_HTTP_ERROR_*`, como en `compras/tipos-api.ts`.

## 4. Pantallas

Se usa el kit de Vector2 (`Tabs`, `DataTable`, `Modal`, `Form`, `Chips`, `Badge`, `Alert`, `EmptyState`, `Switch`), `useColeccion` para proveedores y formato `es-PE`. Todo se usa a 390 px de ancho. Arriba va la barra de **viaje activo de 08b** (su componente se reutiliza, no se copia) en Fotos, Galería, Proformas y Directorio. Mientras 08b no exista, esa barra no aparece y los filtros son proveedor, fecha y compra.

### 4.1 Mapa de la sección «Compras» del menú (`src/lib/nav.ts`; todos los roles)

| # | Entrada | Ruta | Roles que la ven | Escritura dentro | Entrega |
|---|---|---|---|---|---|
| 1 | Huecos | `/compras` (`exact`) | todos | — | M8 (existe) |
| 2 | Flujo mensual | `/compras/flujo` | todos | Parámetros: admin y planner | M8 (existe) |
| 3 | Compras | `/compras/registro` | todos | Hoy, admin y planner. Desde E1, **todos** suben fotos y editan descripción y modelo | M8 (existe) |
| 4 | Viajes y embarques | `/compras/agrupadores` | todos | Según 08b | 08b |
| 5 | Pendientes | `/compras/pendientes` | todos | — | `0.13.1` |
| 6 | **Fotos** | `/compras/fotos` | todos | todos (fotos, descripción, modelo) | E1 |
| 7 | **Galería** | `/compras/galeria` | todos | — | E2 (en E1, `pendiente: "E2"`) |
| 8 | **Proformas** | `/compras/proformas` | todos (interna según §9 C1) | Guardar parámetros: admin y planner. Simular: todos | E2 (en E1, `pendiente`) |
| 9 | **Reporte Directorio** | `/compras/directorio` | todos | — | E3 (en E1, `pendiente`) |
| 10 | **Proveedores** | `/compras/proveedores` | todos | Crear y editar, todos. Desactivar y eliminar, admin y planner | E1 |

**Ojo con el guard de rutas.** `puedeVerRuta` autoriza por prefijo y «Huecos» tiene `href: "/compras"`. Por eso **cualquier `/compras/*` queda abierta a todos los roles**, aunque el item tenga `roles`. Esta ficha evita poner roles a las entradas: todo lo restringido es una acción dentro de la página, que la API exige con su guard. Si §9 C1 deja la proforma interna solo para admin y planner, se resuelve con el interruptor Interna/Externa, que el comprador no ve, y con `403` en la API, **no** con un item restringido. La prueba estática de la pantalla lo comprueba.

### 4.2 Proveedores (`/compras/proveedores`)

- **Lista** (`DataTable`, buscador): nombre, código, país · región, puerto habitual, incoterm, moneda, contacto principal (nombre y correo), compras, estado (Activo / Inactivo) y un `Badge` «Ficha incompleta» que nombra lo que falta. Filtros: Activos / Inactivos / Todos, país e intercompany. Se exporta a Excel (hoja `PROVEEDORES`; sin datos bancarios).
- **Alta y edición** (`Modal`; pantalla completa en el celular), en tres bloques:
  - **Empresa**: nombre*, código, RUC / Tax ID, país* (lista), estado o provincia (lista si es EE. UU.; texto si no), ciudad y dirección.
  - **Importación**: puerto de embarque habitual (texto con sugerencias), incoterm, moneda, plazo de producción y de tránsito en días (con el texto de ayuda «llegada estimada ≈ fecha de compra + N días»), condiciones de pago e intercompany. **El comprador ve la casilla intercompany deshabilitada**, con la nota «la marca el planner».
  - **Contactos**: filas con nombre*, cargo, teléfono, correo y la radio «Principal»; «+ Agregar contacto», hasta 20.
- **Validaciones visibles**: nombre repetido («Ya existe «Feria Sur»: [Abrir]»); nombre parecido (aviso, no bloquea); correo inválido; estado de EE. UU. requerido; «Otro usuario guardó cambios: recarga» (`proveedor_cambio`).
- **Acciones del planner**: Desactivar o Reactivar, y Eliminar. Esta última pide confirmación y la respuesta dice «eliminado» o «tenía compras: quedó desactivado».
- **Detalle**: la ficha, el resumen de compras (cuántas, la última, unidades y costo por moneda) y «Ver sus compras», que abre `/compras/registro?proveedor_id=`.
- **Alta al vuelo** (`selector-proveedor.tsx`; lo usan la captura de `0.13.1` y los filtros): autocompletado de activos y la opción «Crear «X»». Con `409 nombre_parecido`, un `Modal` pregunta «¿Es alguno de estos? Proveedor Norte Ltd. (0,86)» con las opciones [Usar este] y [No, crear «X»]. Lo creado al vuelo sale con «Ficha incompleta».

### 4.3 Fotos (`/compras/fotos`, pensada para el celular)

- **Cabecera fija**: un `Select` de proveedor con «Feria Sur · 12 líneas · 4 sin foto», el chip «Solo sin foto», el buscador (descripción, modelo, marca, compra) y el contador **«8 de 12 líneas con foto»**.
- **Tarjeta por línea**: compra C-000101 · proveedor; HOMBRE · URBANO · DENIM (o «Lote BETA al barrer»); marca, tallas, unidades y costo; descripción y modelo (se tocan para editarlos, inline, con guardar o cancelar); las miniaturas; y dos botones grandes (≥ 44 px), **[Cámara]** y **[Galería]**.
  - [Cámara] es `<input type="file" accept="image/*" capture="environment">`. [Galería] es el mismo `input`, sin `capture` y con `multiple`.
  - Con 3 fotos los botones desaparecen y se lee «3/3».
  - Cada miniatura tiene una ✕ que pide confirmar («¿Quitar esta foto? Quedará registrado que la quitaste»).
- **Subida**:
  1. `comprimir.ts` hace `createImageBitmap(archivo)`, que respeta la orientación EXIF.
  2. Calcula `dimensionesDestino(w, h, 800)`: conserva la proporción y nunca agranda.
  3. Dibuja en un `canvas` en dos pasos si la reducción es mayor que ×2, para que la foto salga nítida, y exporta `toBlob('image/jpeg', 0,82)`. Si pesa más de 400 KB, prueba con 0,72 y después 0,62.
  4. Hace la miniatura de 320 px con calidad 0,75.
  5. Sube con `api.subir`, de una en una. Cada foto muestra su avance; si falla, [Reintentar] con el mensaje de la API.
  - Recomprimir **borra los metadatos EXIF**, incluida la posición GPS de la feria.
  - Un archivo que el navegador no sabe abrir (HEIC en Chrome de escritorio) da el mensaje «Formato no compatible: expórtala como JPEG».
  - Se rechazan en el cliente los originales de más de 30 MB.
- **Ver**: tocar una miniatura abre el visor con la foto de 800 (`GET /fotos/[id]`).
- **Compra cancelada**: la tarjeta sale en solo lectura. Si una URL caducó (más de 1 h con la página abierta), el visor recarga la lista sola, una vez.
- **Lo que ve cada rol**: los tres ven y escriben lo mismo (§9 B3).

### 4.4 Galería (`/compras/galeria`, E2)

Una cuadrícula de miniaturas cuadradas: 3 columnas en el celular y 6 en la PC. La celda usa `object-contain` sobre fondo neutro, así no se recorta la foto. Filtros: viaje, proveedor, compra, origen, género, mundo, línea y marca. Abajo, «120 de 412 fotos» y [Cargar más].

Al tocar una foto se amplía con la leyenda: proveedor · compra · GML · marca · descripción · modelo · unidades, más [Ver compra]. Se navega con flechas o deslizando, y se cierra con Esc. Solo lectura para todos.

### 4.5 Proformas (`/compras/proformas`, E2)

- **Barra**: el interruptor **Interna / Externa** y los filtros proveedor (obligatorio en Externa; mientras falte, la tabla dice «Elige un proveedor: la proforma externa es para un solo proveedor»), compras, viaje, origen, «incluir borradores» y fechas. Botones [Excel], [PDF con fotos] y [Compartir] (solo si `navigator.canShare` admite archivos).
- **Tabla interna**: foto, género, mundo, línea, agrupación de marca, marca, descripción, modelo, tallas, precio de compra (moneda), cantidad, total, **PVP sugerido (S/)** y **CV % esperado**. Al pie, los totales por moneda, el PVP total y el CV total. Una línea sin costo muestra «sin costo» y no suma al CV.
- **Tabla externa**: según §9 C4.
- **Parámetros**: la pestaña o panel «Parámetros de precio» muestra la versión vigente (markup, factor, TC, IGV y, si aplica, los de compras en soles), quién la guardó y cuándo, y el historial. Cualquiera puede **[Simular]**: los campos se vuelven editables, la tabla se recalcula al vuelo y aparece la banda «Simulación: no se guarda». El admin y el planner ven además [Guardar como versión N+1], que pide una nota opcional y maneja `409 parametros_cambiaron` con «Alguien guardó otra versión: recarga».
- **PDF** (A4 horizontal; `jspdf` y `jspdf-autotable` con import dinámico, como `lib/proforma-pdf.ts` de COTV):
  - Encabezado: «Proforma interna» o «Proforma», el proveedor y los filtros, la fecha de Lima y, en la interna, la línea de parámetros (versión o simulación).
  - La miniatura de 320 px va en una caja de 14 mm, sin volver a reducirla. Se descargan 6 en paralelo; la que falla sale como celda vacía.
  - Totales por moneda en la última página y «Página n de m».
  - Nombre del archivo: `proforma-{interna|externa}-{proveedor}-{aaaa-mm-dd}.pdf`.
- **Excel**: SheetJS en el navegador, como M8. Hoja `PROFORMA` con las mismas columnas que la tabla de ese tipo (sin fotos) y hoja `PARAMETROS` (solo la interna).

### 4.6 Reporte Directorio (`/compras/directorio`, E3)

Árbol colapsable con seis niveles: comprador > género > agrupación de marca > marca > mundo > línea. Las agrupaciones de marca van en el orden de `agrupaciones_marca.orden` (PREMIUM → ULTRA LOW, decisión 52). Las líneas sin GML (lotes al barrer) salen como «Al barrer · BETA» bajo género «Varios».

En cada nodo: líneas, unidades, costo por moneda, costo en soles, venta potencial (Σ unidades × PVP sugerido) y CV %. En las hojas, el detalle por línea. Hay [Expandir todo], [Contraer] y [Excel] (una fila por nodo con su nivel y otra por hoja, y la hoja `PARAMETROS`). Solo lectura.

## 5. Reglas de negocio (cada una con su prueba en vitest; las de base, también en el humo)

**Fotos**

- **R1 · Dimensiones.** `dimensionesDestino(w, h, max)` conserva la proporción, nunca agranda y redondea al entero: 4000×3000 → 800×600; 3000×4000 → 600×800; 600×400 → 600×400; 801×1 → 800×1; la miniatura de 4000×3000 → 320×240.
- **R2 · Validación de JPEG.** `validarJpeg(bytes, { maxLado, maxBytes })` acepta el JPEG sintético de 800×600 y rechaza:
  - PNG o bytes sin `FF D8 FF` → `formato_invalido`;
  - un archivo sin `FF D9` final → `formato_invalido`;
  - un SOF de 801×600 → `dimensiones_invalidas`;
  - 400 KB + 1 → `foto_grande`;
  - una miniatura de 321 → `dimensiones_invalidas`.
- **R3 · Tamaño declarado.** `content-length` > 512 KB → `413` sin leer el cuerpo.
- **R4 · Máximo de fotos.** Como mucho **3 fotos activas por línea**. La cuarta → `409 max_fotos`, y la API borra los dos objetos que subió (handler con almacén falso). Con dos llamadas a la vez, la función bajo candado deja como mucho 3 (humo).
- **R5 · Quitar.** Pone `activo = false`, `quitada_por` y `quitada_at`, y llama a `.remove` con las dos rutas. Una foto de otra línea o de otra compra → `404 no_pertenece` (ids cruzados, como la regla 30 de M8). Quitar dos veces → `409 ya_quitada`.
- **R6 · Compra cancelada.** Ni se agregan ni se quitan fotos, ni se edita la ficha de la línea → `409 no_editable`. Una compra `recibida` o con saldo cerrado sí admite fotos.
- **R7 · Las fotos no tocan el flujo.** Subir o quitar una foto **no cambia** `compras.revision`, `compra_eventos` ni `flujo_huella_base()` (humo y handler). `editar_ficha_linea` sí sube `revision` y deja el evento `editar_linea`.
- **R8 · Rutas privadas.** Ninguna respuesta de la API trae `ruta` ni `ruta_miniatura`; solo URLs firmadas con `expira_at` ≤ ahora + 3 600 s.
- **R9 · Storage solo desde el servidor.** `.upload(`, `.remove(` y `.createSignedUrl` solo en `src/lib/fotos/almacen.ts`. Ningún archivo con `"use client"` importa `@/lib/supabase/*` (prueba estática). El bucket es `public = false` y no tiene políticas (humo).
- **R10 · Huérfanas.** La limpieza borra solo los objetos sin fila y con más de 24 h; nunca uno con fila activa o quitada reciente.

**Proveedores**

- **R11 · Nombre y código únicos.** El nombre es único sobre `upper(btrim)`; la reutilizada `motivoRechazoProveedor` da el mensaje y `guardar_proveedor` atrapa la carrera (`unique_violation` → `nombre_repetido`). Lo mismo con el código.
- **R12 · Parecidos.** Con `similitud ≥ 0,8` frente a un activo, en modo rápido y sin `confirmar_parecido` → `409 nombre_parecido` con la lista. Con `confirmar_parecido: true`, crea.
- **R13 · Contactos.** Como mucho 20 y como mucho un principal; si el usuario no marca ninguno, el primero pasa a principal. El correo debe ser válido. `guardar_proveedor` reemplaza los contactos **en la misma transacción** que la ficha (humo: un contacto inválido a mitad no deja ni ficha ni contactos cambiados).
- **R14 · País y región.** El país sale de `PAISES`. Un valor antiguo fuera de la lista se acepta solo si viene **sin cambios**; si no, `400`. Con EE. UU., la región sale de la lista de estados; con otro país es libre.
- **R15 · Concurrencia.** Editar con una `revision` vieja → `409 proveedor_cambio`, sin escribir nada.
- **R16 · Permisos.** Crear y editar: los tres roles. Cambiar `es_intercompany`: solo admin y planner (`403 solo_planner_intercompany`), también en la creación. Desactivar y eliminar: `requirePlanner`. Eliminar con compras → desactiva. Un proveedor inactivo no sale en `?activos=1` ni en el autocompletado, e `importar_compra` sigue diciendo `proveedor_inactivo`.
- **R17 · Sin datos bancarios.** Mientras §9 A3 no diga otra cosa, `banco`, `cuenta` y `swift` → `400` (regla 19 de M8, sin cambios).

**Precios y proformas (E2)**

- **R18 · Redondeo X9,90.** `redondearX990` reproduce `roundToNinetyNine` de COTV: 42,21 → 39,90; 43,55 → 49,90; 53,6 → 59,90; 49,95 → 49,90; 9,5 → 9,90; 0 → 0; un número negativo → 0.
- **R19 · PVP y CV.**
  - `precioSugerido(costo, moneda, p)` = `redondearX990(costo × (moneda = USD ? p.markup : p.markup_local))`. Con `costo` nulo → nulo. En soles sin `markup_local` → nulo, con el aviso `sin_markup_local` (§9 C3).
  - `cvEsperado` = `costo × factor × tc × (1 + igv) ÷ pvp × 100`, con `factor` y `tc` según la moneda (USD: `factor_importacion` y `tipo_cambio`; PEN: `factor_local` y 1). Con `pvp ≤ 0` → nulo.
  - **Caso**: 3,15 USD con los valores por defecto da PVP = 39,90 y CV = 3,15 × 1,3 × 3,4 × 1,18 ÷ 39,90 = **41,2 %**. 3,25 USD da 49,90 y **34,0 %**.
  - **CV del total** = `Σ u·costo·factor·tc·(1+igv) ÷ Σ u·pvp`, sin las filas sin costo.
- **R20 · Versiones de parámetros.** Guardar con `base_version` igual a la vigente crea N+1; con otra → `409 parametros_cambiaron`. La tabla rechaza `UPDATE` y `DELETE` también con `service_role` (humo). Sin filas, la API devuelve los valores por defecto con `origen: "por_defecto"`.
- **R21 · Proforma externa.** Sin `proveedor_id` → `400 proveedor_requerido`. La respuesta no contiene, a ninguna profundidad, las claves `pvp_sugerido`, `cv_pct`, `parametros`, `agrupacion_marca`, `genero`, `mundo` ni `linea` (recorrido del objeto; las del árbol dependen de §9 C4). Las filas son solo del proveedor pedido.
- **R22 · Unidades de la proforma.** Se toma `unidades − unidades_canceladas`. Sin líneas inactivas ni compras canceladas. Los borradores solo con la casilla.
- **R23 · Rótulo de los exportes.** El PDF y el Excel internos llevan «Parámetros vN (…)» o «Simulación (no guardada)»; los externos no llevan ningún parámetro.

**Directorio (E3)**

- **R24 · Sumas.** Cada nodo suma exactamente a sus hijos (unidades, costo por moneda, venta potencial). El CV del nodo es el de sus totales, no el promedio de los CV. El orden de agrupación sigue `agrupaciones_marca.orden`. Una línea sin GML va a «Varios › Al barrer».

## 6. Criterios de aceptación / hito de prueba

**E1** (QA en Chromium, en un Android real y en un iPhone real; luego Javier):

- [ ] Las consultas de §2.0 quedan anotadas; `00E1` aplica dos veces en local y en `vector-two`; el humo pasa (R4, R6, R7, R9, R13, R15 y bucket privado sin políticas); los tipos se regeneran.
- [ ] lint, `tsc`, vitest y build limpios; las pruebas de M8 y de 08b siguen verdes **sin modificarlas**, salvo la lista de tablas de `flujo.estatico`.
- [ ] Como **comprador**, en el celular: Compras → Fotos, «Feria Sur», «Solo sin foto». El contador dice «8 de 12».
- [ ] Una foto con la cámara trasera y dos desde la galería. A la tercera desaparecen los botones. Una cuarta por API da `409 max_fotos` y no deja objeto en el bucket.
- [ ] `datos` mira el objeto en Storage: ≤ 400 KB, lado largo ≤ 800, la proporción del original y sin EXIF ni GPS (`exiftool` sobre una descarga). La miniatura: ≤ 320 de lado y ≤ 60 KB.
- [ ] La foto se ve en el detalle de la compra en `/compras/registro`.
- [ ] Quitar una foto: desaparece, el objeto se borra y la fila queda con «quitada por C1».
- [ ] La URL de una foto copiada y abierta pasados 61 minutos ya no sirve. Sin sesión, `GET /api/compras/fotos` da `401`. La URL pública del bucket no sirve.
- [ ] Compra cancelada: sin botones; la API da `409 no_editable`.
- [ ] Subir una foto no recalcula Flujo mensual: misma `huella`, contador de la caché. Editar la descripción sí la mueve y aparece en el historial de la compra («editar_linea: descripción — → Jean slim azul medio»).
- [ ] El `Permissions-Policy: camera=()` vigente **no** impide `capture` en Android ni en iOS (si lo impidiera, se pasa a `camera=(self)` y se anota).
- [ ] Proveedores, como **comprador**:
  - crear «Textiles Delta Ltd.» (China, Zhejiang, Ningbo, FOB, USD, 45 + 35 días) con dos contactos;
  - crear al vuelo «Textil Delta» → pregunta por el parecido;
  - «Feria Sur» → «ya existe»;
  - no puede marcar intercompany ni desactivar (botones ocultos; la API da `403`);
  - EE. UU. pide estado.
- [ ] Como **planner**: desactivar (ya no sale en el autocompletado) y eliminar uno sin compras (se borra) y uno con compras (queda desactivado).
- [ ] Dos pestañas editando el mismo proveedor: la segunda recibe `409 proveedor_cambio`.
- [ ] Menú: los tres roles ven la sección Compras con Fotos y Proveedores activos, y Galería, Proformas y Directorio deshabilitados («E2» y «E3»). Nada aparece fuera de Compras.
- [ ] `seguridad` (sonnet) revisa las rutas `requireUser` que escriben (fotos, ficha de línea, proveedores) y la subida *multipart*.

**E2**:

- [ ] Galería: 3 columnas a 390 px; [Cargar más]; vista ampliada con leyenda; filtro por viaje (si 08b está) y por proveedor.
- [ ] Proforma interna de «Textiles Delta Ltd.» con dos líneas sintéticas (3,15 y 3,25 USD): PVP 39,90 y 49,90; CV 41,2 % y 34,0 %. Los totales cuadran con R19.
- [ ] Simular un TC de 3,8: cambian los CV, aparece la banda de simulación, y el PDF y el Excel salen rotulados «Simulación». El comprador no ve [Guardar].
- [ ] El planner guarda la v1; otra pestaña con base 0 recibe `409`. El PDF dice «Parámetros v1».
- [ ] Externa sin proveedor bloqueada. Con proveedor, la respuesta de red no contiene PVP ni CV (DevTools). PDF con fotos, compartido desde el celular a WhatsApp o al correo. Excel sin columnas internas.

**E3**:

- [ ] Directorio de un viaje sintético: los totales del nodo raíz coinciden con la suma de la proforma interna de todos sus proveedores; el orden de agrupación es PREMIUM → ULTRA LOW; el Excel tiene una fila por nodo.

## 7. Fuera de alcance

- **Lo que define 08b**: viaje, embarque, paquete, comprador responsable, viaje activo y compras locales. Aquí solo se filtra por ellos.
- **Pendientes** (`0.13.1`), dashboards por comprador, asignación de comprador (M1b), «Nueva línea» de necesidades y el espacio intercompany de COTV (§0.1).
- Fotos en el importador Excel. Después de importar, se completan en Compras → Fotos con «Solo sin foto».
- Recortar, girar o editar fotos; «marcar como principal» y reordenar (la principal es la más antigua: para cambiarla, se quitan las anteriores); fotos del proveedor o de su catálogo; más de 3 fotos por línea (§9 B2).
- Cola de subida sin conexión (10-pwa: sin escritura sin conexión) y transformaciones de imagen de Supabase (dependen del plan; la miniatura se hace en el navegador).
- Proformas **numeradas y guardadas**, enviarlas por correo desde el sistema y que el proveedor las firme. Hoy la proforma se genera, no se guarda.
- PVP decidido por línea (precio final de venta); tipo de cambio automático (SUNAT o SBS); monedas distintas de USD y PEN (la columna admite ampliar el catálogo sin migración).
- Incoterm, puerto y plazos **por compra** (aquí solo son los habituales del proveedor; el puerto real lo muestra el embarque de 08b); costo puesto en almacén (*landed cost*: flete, aduana).
- Fusionar proveedores duplicados (lo mitiga el aviso de parecido). Portal del proveedor. Datos bancarios (salvo §9 A3).

## 8. Riesgos

1. **Cuota de Storage.** Con 3 fotos por línea, unos 150 KB por foto y 20 KB por miniatura, son ~0,5 GB por cada 1 000 líneas. El plan gratuito de Supabase trae 1 GB. `datos` anota el plan en §2.0. Si es el gratuito, la cuota alcanza para el primer año de prueba, y la limpieza de huérfanas más la reducción a 800 px son la defensa.
2. **Primera escritura del comprador antes de M9a** (fotos, ficha de línea y proveedores con `requireUser`). Se mitiga con una lista blanca explícita en `tests/api.guards.roles.test.ts`, con `es_intercompany`, desactivar y eliminar reservados al planner, y con la auditoría de `seguridad`.
3. **Contenido del JPEG.** El servidor comprueba firma, dimensiones y tamaño, pero no lo decodifica entero: un archivo raro con marcadores válidos se guardaría. Se sirve como `image/jpeg` desde el dominio de Supabase, nunca desde el de Vector2. El riesgo es bajo.
4. **URLs firmadas que caducan** con la pantalla abierta más de 1 h, o durante un PDF largo. El visor y el PDF piden la lista de nuevo una vez si una imagen falla.
5. **HEIC y teléfonos viejos.** iOS entrega JPEG al elegir desde `accept="image/*"`; Chrome de escritorio no abre HEIC (mensaje claro). Una foto de 48 MP pide mucha memoria en el `canvas`: se limita a 30 MB y se reduce en dos pasos.
6. **Dependencias del PDF.** `jspdf` y `jspdf-autotable` son nuevas. Si la política de red las bloquea, como pasó con SheetJS, la alternativa es una vista de impresión con `window.print()`: «Guardar como PDF» del navegador, sin compartir el archivo.
7. **Choque de archivos con 08b y `0.13.1`** (`detalle-compra.tsx`, `compras/tipos-api.ts`, `consultas.ts`, `nav.ts`). Se construye en serie, nunca en paralelo (§0.3).

## 9. Decisiones cerradas en esta ficha y preguntas abiertas para Javier

### 9.1 Decisiones del arquitecto (propuestas para `docs/DECISIONES.md`, numeradas después de las 81–86 de 08b)

- **87 · Proveedores es un maestro de Compras, compartido por todos los viajes.** Su ficha y sus contactos se guardan en una sola función transaccional con `revision`. `proveedor_contactos` pasa de la `0028` de M9a a esta ficha; la `0028` queda solo con `compra_linea_mezcla`. Crea y edita cualquier usuario; `es_intercompany`, desactivar y eliminar, solo el planner.
- **88 · Las fotos de una línea se reducen en el navegador** a lo que cabe en 800×800 conservando la proporción (JPEG; miniatura de 320 px). Suben **por un route handler con guard**, que las guarda con `service_role` en un bucket privado **sin políticas**. Se leen solo por URLs firmadas de 1 h generadas en el servidor. Máximo 3 activas. Quitar las borra del bucket y conserva quién y cuándo. **No tocan `revision`, eventos ni la huella del flujo.** Se descarta lo de COTV: políticas abiertas a `authenticated` y subida directa del navegador.
- **89 · Los parámetros de precio (markup, factor, TC, IGV) son una configuración versionada e inmutable en base.** Simular nunca guarda. Cada exporte dice con qué versión, o que es una simulación. Se descarta `localStorage`.
- **90 · La proforma externa es de un solo proveedor** y el servidor nunca le manda PVP, CV ni parámetros: es un tipo de respuesta distinto, no un campo oculto en pantalla.
- **91 · De COTV no se traen** el espacio intercompany (ya está en M13 y M8), Pendientes (`0.13.1`), el dashboard por comprador (OTB por viaje, descartado), la asignación de comprador (M1b) ni «Nueva línea» (la necesidad se calcula). El viaje activo lo trae 08b.

### 9.2 Preguntas abiertas (cada una con recomendación)

**A · Proveedores**

1. **Puerto de embarque.** En COTV no existía. ¿Se agrega al proveedor como «puerto habitual», mientras el puerto real de cada envío se ve en el embarque de 08b? *Recomendación: sí; texto libre con sugerencias de lo ya escrito, sin catálogo de puertos.*
2. **Otros campos de importación.** ¿Se suman incoterm habitual (FOB por defecto en la pantalla), moneda habitual, plazo de producción y plazo de tránsito en días, y condiciones de pago? *Recomendación: los cinco, opcionales. Los plazos servirán en `0.13.1` para sugerir el mes de llegada y la moneda prellena la compra.*
3. **Datos bancarios** (banco, cuenta, SWIFT, que COTV guardaba). *Recomendación: no guardarlos en Vector2 por ahora. Cambiarle la cuenta a un proveedor es la puerta clásica de fraude, y el pago lo hace tesorería con sus propios datos. Si los quieres, que los vean y editen solo admin y planner, con historial de cambios.*
4. **Datos mínimos.** *Recomendación: nombre y país obligatorios en la ficha; el alta al vuelo solo pide el nombre y deja el proveedor marcado «Ficha incompleta» hasta completar país, RUC o Tax ID, dirección y un contacto.*

**B · Fotos**

1. **«800×800»: ¿que quepa en 800×800 conservando la proporción, o un cuadrado exacto?** *Recomendación: que quepa, sin recorte (una foto de 4000×3000 queda en 800×600). Recortar al cuadrado puede cortar la etiqueta o una manga; rellenar con blanco hasta el cuadrado agrega peso sin información. Galería y PDF ya muestran celdas cuadradas sin recortar.*
2. **¿Cuántas fotos por línea?** *Recomendación: 3, como en COTV. Si los lotes al barrer de varias marcas necesitan más, se sube el tope sin migración de tablas (solo cambia la función).*
3. **¿Quién sube y quita fotos, y quién edita descripción y modelo?** *Recomendación: los tres roles desde E1, antes de M9a. Es el uso principal del comprador en la feria y cumple la decisión 28. El resto de su escritura sigue esperando a M9a.*
4. **Descripción y modelo en cada línea** (texto libre, opcionales). *Recomendación: sí. Sin ellos, dos líneas DENIM × ALFA del mismo proveedor no se distinguen en Fotos, y la proforma externa no le sirve al proveedor. Entran también como columnas opcionales del importador en E2.*

**C · Proformas y precios**

1. **¿El comprador ve la proforma interna (PVP sugerido y CV esperado)?** *Recomendación: sí. Era su herramienta en COTV y no es venta real de M5: sale de su propio costo y de los parámetros. Los parámetros solo los guardan admin y planner; cualquiera simula sin guardar.*
2. **Valores iniciales y tipo de cambio.** *Recomendación: la versión 1 con los de COTV (markup 13,4, factor de importación 1,30, TC 3,40, IGV 18 %), y un TC de planificación fijo que actualiza el planner, no el del día.*
3. **Compras en soles (locales): ¿cómo se calculan el PVP y el CV?** *Recomendación: markup local = 13,4 ÷ 3,40 ≈ 3,94 (el mismo margen que una importación), factor 1,00, sin tipo de cambio y con costo sin IGV. Si prefieres otros valores, se guardan como parámetros propios.*
4. **¿Qué columnas lleva la externa?** COTV mostraba género, mundo, línea y agrupación de marca. *Recomendación: foto, número y referencia de la compra, marca, modelo, descripción, tallas, cantidad, precio, total y meses de entrega, sin género, mundo, línea ni agrupación de marca. «ULTRA LOW» o «PREMIUM» es clasificación interna que el proveedor no necesita ver.*

**D · Orden, menú y reportes**

1. **Orden de construcción.** *Recomendación: tras validar `0.13.0`, primero E1 (proveedores y fotos, lo que pediste primero, que ya sirve sobre la carga inicial), luego 08b, luego E2 (galería y proformas, ya con filtro por viaje) y E3, después `0.13.1` y M9a. Nunca en paralelo con 08b ni con `0.13.1`.*
2. **Primer nivel del Directorio: ¿qué comprador?** *Recomendación: el comprador responsable del viaje o paquete de 08b. Si la compra no tiene viaje, el responsable del género × mundo (M1b), y los lotes al barrer van a «Sin responsable».*
3. **Orden del menú Compras.** *Recomendación: Huecos · Flujo mensual · Compras · Viajes y embarques · Pendientes · Fotos · Galería · Proformas · Reporte Directorio · Proveedores, todas visibles para los tres roles (§4.1). Las de entregas futuras se ven deshabilitadas hasta construirse.*
4. **La barra de cobertura de Pendientes de COTV.** *Recomendación: no se rehace aquí. Se pide a la ficha de `0.13.1` como columna «cobertura del saldo» (en camino ÷ (en camino + saldo)) en su pantalla de Pendientes.*

**Revisión independiente.** Conviene pasar esta ficha por el `arquitecto-revisor` (opus) **antes de construir E1**. Trae varias primeras veces: Storage, subida *multipart*, escrituras con `requireUser` antes de M9a y una configuración versionada nueva. Además comparte archivos y numeración con 08b y `0.13.1`, y cambia el alcance de la `0028`. Lo ideal es que el revisor lea 08b y esta ficha juntas.

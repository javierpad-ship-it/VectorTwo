# 08c · Proveedores, fotos de las líneas, galería, proformas y reporte Directorio (secciones de Compras traídas de COTV)

> **Estado: especificada el 2026-11-02 y ajustada el 2026-11-04 con la revisión independiente del `arquitecto-revisor` (opus).** Los puntos importantes I1, I3–I6 e I9 y los menores M1–M15 están incorporados (trazabilidad en §10). **Quedan seis preguntas «Pendiente de Javier» (§11)**, cada una con un *default* provisional, que es lo que se construye si no responde; cambiar una respuesta solo reescribe su apartado de §11. Las preguntas de la primera versión (§9.2) quedan como *defaults* aplicados que no bloquean. Es una mejora de la parte de compras de M8 ([08](08-flujo-y-compras.md)), anterior a M9a, igual que la ficha vecina [08b · Agrupadores de compras](08b-agrupadores-de-compras.md). Adelanta a M9a dos piezas que la ficha 08 le había dejado: la pantalla de proveedores y los contactos.
>
> **Pedidos textuales de Javier (2026-11-02).** (1) «en las compras que carguemos items también deberíamos poder cargar la foto. en 800x800 tú la reduces.» (2) «mira en el app de COTV todas las últimas cosas que le añadimos. Pero deberían ser todas secciones del módulo de compras. dentro del menú principal. Ordenaría el menú: Inicio, Compras, Planificación, Maestros, Administración» (el orden ya está en `nav.ts`, commit `a3b3def`). (3) «también es importante el módulo de proveedores. no recuerdo si está puerto de embarque en el caso de los proveedores».
>
> **Numeración y orden.** El **registro único** de reservas de migraciones y versiones está en `docs/PLAN.md` §5 («Reservas de migraciones y versiones»); esta ficha no fija números. Sus migraciones se citan con marcador, **`00E1_proveedores_y_fotos.sql`** (E1) y **`00E2_parametros_precio.sql`** (E2), con `scripts/humo-00E1.sql` y `scripts/humo-00E2.sql`, y `datos` les pone la **siguiente libre** al construir, por orden de cierre (decisión 48). Orden del camino de compras: **08b-1 → E1 → 08b-2 → E2 → E3** (§0.3), nunca dos en paralelo. **Versión**: la siguiente libre al cerrar cada entrega (hoy `APP_VERSION = "0.15.0 · M7 c"`). Los commits llevan el prefijo `M8:`, como 08b.
>
> **Base real.** Comprobada en solo lectura sobre `vector-two` (ref `tzjsxzmsvvhxyiooihyq`, **nunca** `lukers-compras`) por el `arquitecto-revisor` el 2026-11-04; el detalle está en §2.0. `datos` la reconfirma en T1 antes de escribir la migración y anota lo que falta: el plan del proyecto y su cuota de Storage y de tráfico (§8, riesgo 1).
>
> **Sin datos reales.** Proveedores «Proveedor Norte», «Feria Sur», «Textiles Delta Ltd.» (China) y «Hilados Andinos SAC» (Perú); marcas ALFA y BETA; cifras inventadas. Las fotos de prueba son JPEG sintéticos que se arman en el propio test, byte a byte. En el repo no entra ninguna foto real de producto, ni en `tests/`, ni en `public/`, ni en `datos/`. En producción no se crean datos inventados: ver §11.P6.

## 0. Contexto

### 0.1 Qué se trae de COTV y qué no (verificado en `/home/user/cotbv2`, solo lectura)

| Pieza de COTV (archivo) | Qué hace allí | En Vector2 |
|---|---|---|
| Proveedores (`SupplierForm`, `CountryStateFields`, `SupplierContactsFields`, `app/actions.ts` `createSupplier`/`updateSupplier`) | Nombre único, país (lista), estado solo si es EE. UU., dirección, RUC, cuenta y banco, contactos múltiples (nombre, cargo, teléfono, correo). Las *server actions* escriben con el cliente del usuario y **borran y reinsertan** los contactos en dos pasos | **Se trae** (§2.1–2.2) como maestro compartido por todos los viajes, sobre la tabla `proveedores` que ya existe (M8). Se añaden la dirección, el estado o provincia para cualquier país, y los campos de importación de §9 A. **Banco y cuenta quedan fuera** salvo que Javier diga otra cosa (regla 19 de M8, §9 A3). Contactos y ficha se guardan en **una sola transacción**. Cómo se traen los proveedores que ya están en COTV: §11.P2 |
| Alta al vuelo (`ensureSupplier` en `app/actions.ts`) | Si el nombre no existe, lo crea en silencio | **Se trae** con dos frenos. Si el nombre está repetido, ofrece «usar el existente». Si se parece a otro, pregunta «¿es alguno de estos?» (§3.2) |
| Fotos por ítem (`PhotoPicker`, `lib/image.ts`, `lib/photos.ts`, `purchase_photos`) | Hasta 3 por ítem. En el navegador: lado largo de 1000 px y JPEG 0,8. El navegador **sube directo** al bucket privado `purchase-photos` gracias a **políticas abiertas a `authenticated`** (lectura, alta y borrado de cualquier objeto del bucket). La tabla tiene la política `authenticated full access`. Se lee con URL firmada de 1 h | **Se trae con otro modelo de seguridad** (§2.4, §3.3). Lado largo de 800 px. La subida **pasa por un route handler** con guard, que sube con `service_role` a un bucket privado **sin políticas**. Las URLs firmadas se generan solo en el servidor. Se añade una miniatura de 320 px. Hasta 3 fotos por línea |
| Fotos para celular (`FotosModule`) | Filtro por proveedor con «N ítems · M sin foto», casilla «Solo sin foto», contador con foto / total, cámara o galería | **Se trae** como **Compras → Fotos** (§4.3) |
| Galería (`GaleriaGrid`) | Matriz de miniaturas del viaje, filtro por proveedor, vista ampliada | **Se trae** como **Compras → Galería** (§4.4), paginada y firmando solo la página visible |
| Proforma (`ProformaTable`, `lib/pricing.ts`, `lib/proforma-pdf.ts`) | Interna: PVP sugerido = FOB × 13,4 redondeado a X9,90 y CV esperado = FOB × 1,3 × 3,4 × 1,18 ÷ PVP. Externa: oculta PVP y CV. Filtro por proveedor; PDF con fotos (jsPDF + autotable) y Excel. **Los parámetros viven en `localStorage`** | **Se trae** como **Compras → Proformas** (§4.5). Los parámetros pasan a una **configuración versionada en base** (§2.6). La **externa exige un proveedor** y el servidor **no manda** PVP, CV ni parámetros (§5, R14–R15) |
| Intercompany (`app/intercompany`, `lib/campaigns.ts`) | «Espacio de compra» fuera del OTB, con necesidades de origen `INTERCOMPANY` | **No se trae**: ya está resuelto en Vector2 con las reglas de M13, el subflujo de M8, el origen `intercompany_cd` y el proveedor `es_intercompany`. Para ver solo esas compras basta el filtro «Origen» de Compras, que también se ofrece en Galería y Proformas |
| Reporte Directorio (`lib/dir-report.ts`, `ReporteDirectorioTree`) | Árbol colapsable comprador > género > agrupación > marca > mundo > línea con unidades, FOB total y «PVP aprox.» = FOB × 13,4 **sin redondear** (`DIR_REPORT_FOB_MULTIPLIER`) | **Se trae en la E3** (§4.6), con el PVP sugerido redondeado a X9,90 y los parámetros versionados: su venta potencial **no coincidirá** con la de COTV (M9). Aporta algo que M8 no tiene: lo **comprado** en dinero (costo, venta potencial a PVP sugerido y CV) por comprador y marca. El «Avance por árbol» de `0.13.1` mira la necesidad (saldo, IMI), no el dinero |
| Pendientes con barra de cobertura (`PendientesList`) | Unidades pendientes contra OTB del viaje, con barra comprado / OTB | **No se trae aquí**: ya está **Pendientes** en `0.13.1` (ficha 08 §4.5). Lo único que suma la barra se propone para esa ficha (§9 D4) |
| Dashboard por comprador (`CompradorDashboard`) | OTB contra comprado por comprador y combinación | **No se trae**: es OTB por viaje (descartado, decisión 2). En Vector2 lo cubren Huecos con «Mis líneas» y el primer nivel del Directorio |
| Asignar comprador por género × mundo (`AssignBuyerSelect`, `app/compradores`) | — | **No se trae**: ya existe en M1b |
| «Nueva línea» con edición y borrado múltiple (`NewLineForm`, `ManageNeedsList`, `createNeed`/`deleteNeeds`) | Necesidades OTB escritas a mano | **No se trae**: en Vector2 la necesidad se calcula (M7 → M8) y no se escribe |
| Viaje activo (`CampaignSwitcher`, cookie `cotbv_campaign`) | Filtro del viaje | **Lo define 08b-1** (`compra_viajes`, cookie `v2_viaje_activo` con `uuid\|todos\|sin_viaje`, componente `BarraViajeActiva` de `src/components/compras/agrupadores/barra-viaje-activo.tsx` con `useViajeActivo`). Aquí solo se usa como filtro, con esa misma barra, y es el **filtro por defecto** de Fotos, Galería, Proformas y Directorio |

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
| 08b | Viaje, embarque, paquete, comprador responsable, viaje activo y compras locales se definen allí. Esta ficha solo los **lee** a través de sus filtros y de `CompraApi.viaje` (lo añade la API de 08b-1, todavía pendiente en la rama) |
| 08b-1 (commit `79c7edc`, en construcción) | Deja tres ganchos sin dueño que **llena E1** (T3b, R29): `EmbarqueApi.puertos_habituales` (`src/lib/compras/agrupadores/tipos-api.ts:278-279`, hoy «`[]` si aún no existe»), el aviso `puerto_distinto_del_habitual` del importador de agrupadores (`src/lib/compras/agrupadores/tipos.ts:265-266`) y las sugerencias de puerto de `src/components/compras/agrupadores/modal-embarque.tsx:79`, que ya leen esos puertos |

### 0.3 Entregas, migraciones y plan de tandas

| Entrega | Qué trae | Migración | Depende de |
|---|---|---|---|
| **E1** (versión libre al cerrar) | **Proveedores** (ficha completa, contactos, alta al vuelo, desactivar y eliminar); **fotos por línea** (subir, quitar, ver en el detalle de la compra, miniatura servida por la API, limpieza de huérfanas); **Compras → Fotos** para el celular; **descripción y modelo** de la línea; los **ganchos de 08b-1** (puertos habituales y aviso de puerto); menú. Además, lo que §11 deje en E1 con su *default*: importador de proveedores (P2), historial del proveedor (P4) y traer fotos de la línea cancelada (P5) | `00E1_proveedores_y_fotos.sql` (siguiente libre) | **08b-1 cerrada** (su migración ya tiene número, ver PLAN §5, y su API sigue en curso) y `0.13.0` validada. Para recorrer el hito hace falta además una **carga inicial** de compras (§6) |
| **E2** | **Galería**; **Proformas** interna y externa con PDF y Excel; **parámetros de precio versionados**; columnas `DESCRIPCION` y `MODELO` en el importador si `0.13.1` aún no rehízo `importar_compra` | `00E2_parametros_precio.sql` (siguiente libre) | E1 y **08b-2 cerrada** (va después en la serie) |
| **E3** | **Reporte Directorio** (árbol y Excel) | ninguna | E2 (usa los precios) y 08b-1 (responsable del viaje) |

**Orden (fijado el 2026-11-04): 08b-1 → E1 → 08b-2 → E2 → E3**, y después `0.13.1` y M9a. 08b-1 ya está a medias en la rama (commit `79c7edc`: contratos, lógica y pantallas; su migración de agrupadores la termina `datos`; la API sigue pendiente), así que E1 entra justo detrás, y no antes como proponía la primera versión de esta ficha. A cambio, E1 ya puede usar la barra de viaje activo y llenar los puertos habituales que 08b-1 deja preparados. **Nunca en paralelo** con 08b ni con `0.13.1`: los tres tocan `detalle-compra.tsx`, `compras/tipos-api.ts`, `compras/consultas.ts` y `nav.ts`.

**Tandas de E1** (dueño único por archivo; mismas reglas que ficha 08 §0.8):

| Tanda | Agente | Depende de | Archivos (exclusivos) | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Contratos | `backend` | — | `src/lib/proveedores/{tipos-api,esquemas,paises,regiones}.ts`, `src/lib/fotos/{tipos-api,esquemas,constantes}.ts`, `tests/proveedores.fixture.ts`, `tests/fotos.fixture.ts` (JPEG sintético armado en código), `tests/proveedores.esquemas.test.ts`, `tests/fotos.esquemas.test.ts` | `tsc` limpio; esquemas probados |
| T1 · Datos | `datos` | — | `supabase/migrations/00E1_proveedores_y_fotos.sql`, `scripts/humo-00E1.sql`, `src/lib/supabase/database.types.ts` | Consultas de §2.0 reconfirmadas; aplica dos veces; humo verde (R4, R5, R6, R7, R7b, R10, R11, R13, R15 y Storage sin ninguna política, M3) |
| T2 · Lógica pura | `backend` | T0 | `src/lib/fotos/{jpeg,dimensiones,validar}.ts`, `src/lib/proveedores/{reglas,parecidos,completitud}.ts`, `src/lib/compras/proveedores.ts` (lo amplía y deja de ser de M8), `tests/fotos.*.test.ts`, `tests/proveedores.*.test.ts` | R1–R3, R12, R13, R14 y R16 verdes (las de lógica pura) |
| T3a · Pantallas con fixtures | `frontend` | T0 | `src/app/(app)/compras/fotos/**`, `src/app/(app)/compras/proveedores/**`, `src/components/fotos/**` (`comprimir.ts`, `selector-fotos.tsx`, `tarjeta-linea-fotos.tsx`, `visor-foto.tsx`), `src/components/proveedores/**` (`formulario-proveedor.tsx`, `selector-proveedor.tsx` con «Crear», `campos-pais-region.tsx`, `contactos.tsx`), `src/lib/fotos/use-fotos.ts`, `src/lib/nav.ts` (la barra de viaje activo se **importa** de `src/components/compras/agrupadores/`, no se copia), **aditivo** en `src/lib/api-client.ts` (`api.subir(url, FormData)`, sin `Content-Type`), `tests/fotos.pantalla.estatico.test.ts` | build y `tsc` limpios; 390 px sin controles fuera |
| T3b · Servicio y API | `backend` | T1, T2 | `src/lib/fotos/{almacen,consultas,servicio}.ts`, `src/lib/proveedores/{consultas,servicio}.ts`, `src/app/api/compras/proveedores/**`, `src/app/api/compras/[id]/lineas/**`, `src/app/api/compras/fotos/**`, `tests/fotos.handlers.test.ts`, `tests/proveedores.handlers.test.ts`, `tests/fotos.estatico.test.ts`. **Aditivos**: `src/lib/compras/{tipos-api,consultas,servicio}.ts` (`descripcion`, `modelo`, `fotos_activas` en `LineaCompraApi`); `src/lib/compras/agrupadores/{consultas,servicio,importar}.ts` (llenar `puertos_habituales` y emitir `puerto_distinto_del_habitual`, I5; `consultas` y `servicio` los crea la API de 08b-1, que cierra antes) con `tests/agrupadores.puertos.handlers.test.ts`; `tests/flujo.estatico.test.ts` (tablas y funciones nuevas en la lista); altas en `tests/api.guards.roles.test.ts` | R4–R11, R7b, R15–R17, R26, R27 y R29 verdes; guards y roles verdes |
| T4 · Integración | `frontend` | T3a, T3b | Los de T3a más **un cambio aislado** en `src/components/compras/detalle-compra.tsx` (un `<FotosLinea>` y «Descripción / modelo» por línea) y, **solo si** la prueba de `capture` lo pide (M15), `next.config.ts` (`camera=(self)`) | Contra la API real en local, en Chrome Android y Safari iOS (cámara trasera, galería, HEIC) |
| T5 · Cierre | `qa`, `seguridad` (sonnet), `documentador` | T4 | `qa` y `seguridad` solo leen. `documentador`: `docs/**`, `src/lib/version.ts` | Hito de §6 E1 |

Las piezas de §11 que queden en E1 con su *default* suman sus archivos a estas tandas; cada apartado de §11 dice cuáles.

**E2** sigue el mismo esquema: T0 con `src/lib/proformas/{tipos-api,esquemas}.ts`; T1 con `00E2_parametros_precio.sql`; T2 con `src/lib/proformas/{precios,armar}.ts` y pruebas; T3a con `src/app/(app)/compras/{galeria,proformas}/**`, `src/components/proformas/**` (`pdf.ts` con import dinámico de `jspdf` y `jspdf-autotable`, `excel.ts`, `simulador.tsx`) y `nav.ts`; T3b con `src/lib/proformas/{consultas,servicio}.ts`, `src/app/api/compras/{galeria,proformas,parametros-precio}/**`. Las rutas de `src/app/api/compras/fotos/**` son todas de E1. **Dependencias nuevas**: `jspdf` y `jspdf-autotable`, autorizadas por la decisión 35; si la red las bloquea, ver §8, riesgo 6. **E3**: `src/lib/directorio/{armar,tipos-api}.ts`, `src/app/api/compras/directorio/route.ts`, `src/app/(app)/compras/directorio/**`, `src/components/directorio/**`.

## 1. Objetivo

El comprador vuelve de una feria con decenas de líneas y con fotos sueltas en el teléfono. Al planner le falta saber a quién se compró, desde dónde se embarca y en qué condiciones. Hoy Vector2 guarda las compras sin imagen, sin descripción y con un proveedor de solo nombre. Las proformas y el resumen para el Directorio se arman a mano fuera del sistema.

Este módulo hace tres cosas:

1. Convierte `proveedores` en un **maestro de importación**: ficha, contactos, puerto de embarque y condiciones.
2. Permite **fotografiar cada línea** desde el celular, reducida a 800 px y guardada de forma privada.
3. Con esas fotos y con los parámetros de precio **versionados**, produce la **galería**, las **proformas** interna y externa (PDF y Excel) y el **reporte Directorio**.

Todo vive como secciones de **Compras**, a la vista de cada rol según §4.1.

## 2. Modelo de datos

### 2.0 Comprobaciones previas en `vector-two`

Hechas en solo lectura por el `arquitecto-revisor` el 2026-11-04. `datos` las repite en T1 y anota aquí cualquier diferencia.

- `proveedores` tiene las 13 columnas de `0025` (`id`, `codigo`, `nombre`, `pais`, `ciudad`, `identificacion`, `es_intercompany`, `nota`, `perfil_id`, `usuario_nombre`, `activo`, `created_at`, `updated_at`), sin `revision` ni `updated_by_*`. Únicos sobre `upper(nombre)` y `upper(codigo)` (`0025`, líneas 89-94). **0 filas.**
- `compra_lineas` ya tiene `nota` (≤ 200) y `clave_importacion` (con índice, no única). No tiene `descripcion`, `modelo` ni `updated_by_*`. **0 compras.**
- No hay ninguna tabla de 08b aplicada todavía (su migración está en construcción).
- Storage: `storage.buckets` vacío; **0 políticas** en el esquema `storage`; 0 objetos; RLS activo en `storage.objects`. `anon` y `authenticated` conservan sus *grants* sobre `storage.objects` y solo los frena el RLS sin políticas: por eso el humo exige 0 políticas (M3). `storage.objects` tiene el trigger `protect_objects_delete`, que rechaza el `DELETE` por SQL: los objetos se borran solo con la API de Storage (`.remove`).
- Perfiles activos: 1 admin, 2 compradores, 0 planners.
- 5 `agrupaciones_marca` con `orden`.
- **Falta** (lo anota `datos`): el plan del proyecto y su cuota de Storage y de tráfico de salida (§8, riesgo 1).

### 2.1 `proveedores` (existe desde `0025`; E1 añade columnas, sin backfill)

| Columna nueva | Tipo | Notas |
|---|---|---|
| `direccion` | `text null` | ≤ 300 |
| `region` | `text null` | ≤ 80. Es el «Estado / provincia». Con `pais = 'Estados Unidos'` la API exige un valor de la lista de estados (como COTV). Con otro país es texto libre, porque en China la provincia (Guangdong, Zhejiang) también importa |
| `puerto_embarque` | `text null` | ≤ 80. **Puerto habitual** de embarque (Ningbo, Shenzhen, Miami). El que vale para un envío concreto es dato del embarque de 08b, que muestra el del proveedor como referencia. Texto con sugerencias de los valores ya usados, sin catálogo (§9 A1) |
| `incoterm` | `text null` | Catálogo zod de los Incoterms 2020 (`EXW`, `FCA`, `FAS`, `FOB`, `CFR`, `CIF`, `CPT`, `CIP`, `DAP`, `DPU`, `DDP`); sin `check`, como todo catálogo (PLAN §4). Es el **habitual**; la compra no lo guarda en esta ficha (§7). Qué pasa con el PVP y el CV si no es FOB: §11.P3 |
| `moneda` | `text null` | La **habitual** (`USD` o `PEN`, el catálogo de `compras.moneda`). Prellena la moneda de una compra nueva en `0.13.1` |
| `plazo_produccion_dias` | `integer null` | `check (plazo_produccion_dias between 0 and 365)`. Días entre la orden y el embarque |
| `plazo_transito_dias` | `integer null` | `check (plazo_transito_dias between 0 and 180)`. Días entre el embarque y la llegada al CD. Con el anterior, `0.13.1` sugiere el mes de la primera entrega (fecha de compra + producción + tránsito) |
| `condiciones_pago` | `text null` | ≤ 200, libre («30 % adelanto, 70 % contra BL») |
| `revision` | `integer not null default 0` | `check (revision >= 0)`. Controla la concurrencia en la edición: la ficha y los contactos se guardan juntos; si otro guardó antes, `409 proveedor_cambio` |
| `updated_by_id` → `perfiles` `on delete set null`, `updated_by_nombre` | | Último cambio. `perfil_id` y `usuario_nombre` siguen siendo quién lo creó. Índice por `updated_by_id` |

Lo que **no cambia**:

- `pais` sigue siendo texto ≤ 80. La API valida **toda** escritura contra `PAISES` (`src/lib/proveedores/paises.ts`, nombres en español como `countries.ts` de COTV más los que falten de Asia). No hay valores antiguos que conservar: hoy hay 0 proveedores y `importar_compra` crea los suyos con `pais` nulo, que la ficha marca como «falta país» (M13).
- `identificacion` pasa a rotularse «RUC / Tax ID».
- `codigo` y `nombre` mantienen sus únicos sobre `upper(codigo)` y `upper(nombre)` (`0025`, sin `btrim`). La API los guarda ya recortados (`trim` en zod), así que los espacios al borde no crean duplicados.

Las columnas de A1 y A2 (§9.2) entran con su *default* (sí). Si Javier dijera que no al leer la ficha, se quitan de `00E1` **antes** de construir; después ya no se borran (sin `DROP`).

### 2.2 `proveedor_contactos` (nueva; **pasa de la `0028` de M9a a esta ficha**, decisión propuesta 87)

`id`, `proveedor_id` → `proveedores` `on delete cascade` (con índice), `nombre` (1–120), `cargo` (≤ 80), `telefono` (≤ 40), `correo` (≤ 120, formato validado en zod), `es_principal boolean not null default false`, `orden smallint not null default 0`, `activo` (por convención y **sin uso**, como en `responsables_genero_mundo`: la API no la lee ni la expone, y quitar un contacto borra la fila dentro de `guardar_proveedor`; M13), `created_at`, `updated_at`.

Hay un índice único parcial `(proveedor_id) where es_principal`, que asegura **a lo sumo un contacto principal**. Se permiten como mucho 20 contactos por proveedor (`MAX_CONTACTOS_PROVEEDOR`, ya en `src/lib/compras/proveedores.ts`), y lo comprueba la API. Con esto, la `0028` solo lleva `compra_linea_mezcla`.

### 2.3 `compra_lineas` (existe desde `0025`; E1 añade columnas)

- `descripcion text null`, ≤ 200: qué es el producto («Jean slim azul medio»).
- `modelo text null`, ≤ 60: el código o estilo del proveedor («DL-2231»).

Ambas son opcionales y solo las escriben funciones (§2.7). Sirven para identificar la línea en Fotos, Galería y Proformas: dos líneas DENIM × ALFA del mismo proveedor solo se distinguen por ellas. La ficha 08 las dejaba para «segunda entrega como texto libre» (§4.0); entran ahora porque sin ellas la proforma externa no le sirve al proveedor (§9 B4).

**`descripcion` no es `nota`.** `compra_lineas.nota` (≤ 200, ya existe) es un comentario interno de la línea («ojo con la talla 32»): no sale en la proforma externa ni en la leyenda de Galería. `descripcion` dice qué es el producto y sí sale al proveedor.

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
- El humo comprueba que `public = false` y que **no hay ninguna política** en el esquema `storage` (`select count(*) from pg_policies where schemaname = 'storage'` = 0). Buscar solo las que nombren `compras-fotos` no basta: una política `using (true)` para `authenticated` abriría el bucket sin nombrarlo (M3). Si algún día otro bucket necesitara una política, se revisa este humo a propósito.
- Los objetos **no se borran por SQL**: el trigger `protect_objects_delete` de Supabase lo impide. Se borran con `.remove()` desde `src/lib/fotos/almacen.ts`.
- Las rutas se arman con ids (`compras/{compra_id}/{linea_id}/{foto_id}.jpg`), nunca con nombres de proveedor o de marca.

### 2.6 `parametros_precio` (nueva en E2; configuración versionada, insert-only)

`id`, `version integer not null` (único; la siguiente la asigna `guardar_parametros_precio` bajo candado), `markup numeric(6,3) not null check (markup > 0)`, `factor_importacion numeric(6,3) not null check (factor_importacion > 0)`, `tipo_cambio numeric(8,4) not null check (tipo_cambio > 0)`, `igv_pct numeric(5,2) not null check (igv_pct between 0 and 100)`.

Para las compras en soles van además `markup_local numeric(6,3) null check (markup_local > 0)` y `factor_local numeric(6,3) not null default 1 check (factor_local > 0)` (§9 C3).

Cierran la tabla `nota` (≤ 200), `perfil_id` → `perfiles` `on delete set null`, `usuario_nombre` y `created_at`. **Sin `activo` ni `updated_at`**: es la misma excepción documentada que `compra_eventos`. Un trigger la hace inmutable también para `service_role` y contra `TRUNCATE`. La única excepción es el `UPDATE` que solo pone `perfil_id` en nulo cuando se borra un usuario (decisión 60).

**Vigente = la de `version` máxima.** No hay seed: sin ninguna fila, la API usa los valores de COTV (13,4 · 1,3 · 3,4 · 18 %) más, para compras en soles, `markup_local = 3,94` y `factor_local = 1` (el *default* de §9 C3; sin él, las compras en soles saldrían sin PVP hasta que alguien guarde la v1, M8), y la pantalla los rotula «valores por defecto, sin versión guardada», igual que `flujo_parametros`. `igv_pct` guarda el porcentaje (18), no la fracción: las fórmulas usan `igv_pct / 100` (R19, M7). El redondeo X9,90 y su umbral de 3,10 son constantes del código (`src/lib/proformas/precios.ts`), no parámetros (§7).

**Por qué en base y no en `localStorage`.** Dos compradores podían mandar al Directorio un CV calculado con tipos de cambio distintos sin saberlo, y una proforma no decía con qué parámetros se hizo. Ahora cada PDF y cada Excel llevan «Parámetros v3 (13,4 · 1,30 · 3,40 · 18 %)» o «Simulación (no guardada)».

### 2.7 Funciones (plpgsql, `security invoker`, `set search_path = ''`, solo `service_role`, `returns jsonb` con `{ ok: true, … }` o `{ ok: false, motivo }`)

| Función | Qué hace | `motivo` posibles |
|---|---|---|
| `guardar_proveedor(p_id uuid, p_revision int, p_proveedor jsonb, p_contactos jsonb, p_actor jsonb)` | Con `p_id` nulo, **crea**. Con id, bloquea la fila (`for update`), compara `revision`, actualiza la ficha y **reemplaza los contactos en la misma transacción**, sube `revision` y pone `updated_by_*`. Atrapa el `unique_violation` del nombre o del código | `proveedor_cambio`, `nombre_repetido`, `codigo_repetido`, `no_encontrado` |
| `cambiar_activo_proveedor(p_id uuid, p_activo boolean, p_actor jsonb)` | Desactiva o reactiva | `no_encontrado` |
| `eliminar_proveedor(p_id uuid, p_actor jsonb)` | Lo borra (con sus contactos, en cascada) si **no tiene ninguna compra**, de ningún estado. Si tiene, lo desactiva. Es la regla `accionEliminarProveedor` que ya existe | `no_encontrado` (devuelve `accion: 'borrado' \| 'desactivado'`) |
| `agregar_foto_linea(p_compra uuid, p_linea uuid, p_foto jsonb, p_actor jsonb)` | Bloquea **la línea** (`for update`; no la compra ni su `revision`). Comprueba que la línea es de la compra y está activa, que la compra no está `cancelada` y que hay menos de **3** fotos activas. Luego inserta | `no_pertenece`, `no_editable`, `max_fotos` |
| `quitar_foto_linea(p_compra uuid, p_linea uuid, p_foto uuid, p_actor jsonb)` | Bloquea la línea y comprueba pertenencia. En una compra cancelada solo quita si `p_actor.rol = 'admin'` (así el admin puede retirar una foto equivocada de una compra ya cancelada, I7); si no, `no_editable`. Pone `activo = false` y `quitada_*`. Devuelve `ruta` y `ruta_miniatura` para que la API borre los objetos | `no_pertenece`, `no_editable`, `ya_quitada` |
| `editar_ficha_linea(p_compra uuid, p_linea uuid, p_antes jsonb, p_descripcion text, p_modelo text, p_actor jsonb)` | Bloquea **la línea** (`for update`), **no la compra**: no lee ni sube `compras.revision` (I6). Comprueba pertenencia, línea activa y compra no cancelada. Compara `descripcion` y `modelo` guardados con `p_antes` (`{ descripcion, modelo }`, con `is distinct from`): si alguno cambió, rechaza sin escribir. Si coinciden, escribe e inserta el evento `editar_linea` con `antes`, `despues` y el `resumen` («descripción: — → Jean slim azul medio»). El evento mueve la huella del flujo una vez (cuenta eventos), sin cambiar cifras. **Por qué no usa la `revision` de la compra**: Fotos tiene una tarjeta por línea; con la revisión de la compra, editar una descripción, asignar la compra a un viaje (08b) o confirmar un ingreso dejaría viejas las copias de las otras tarjetas de esa compra y daría `409` falsos. Matiza la decisión 60 para estos dos campos (§9.1, 88) | `linea_cambio`, `no_pertenece`, `no_editable` |
| `guardar_parametros_precio(p_base_version int, p_parametros jsonb, p_actor jsonb)` (E2) | `pg_advisory_xact_lock` propio. Si la vigente no es `p_base_version`, rechaza. Si coincide, inserta `version + 1` | `parametros_cambiaron` |
| `fotos_huerfanas(p_horas int, p_limite int default 1000)` | **Solo lectura** (`stable`), solo `service_role`. Cruza `storage.objects` del bucket `compras-fotos` con `compra_linea_fotos` y devuelve `{ sin_fila: text[], quitadas: text[] }`: (a) objetos sin ninguna fila (ni por `ruta` ni por `ruta_miniatura`) con `created_at` de hace más de `p_horas`; (b) `ruta` y `ruta_miniatura` de filas con `activo = false` y `quitada_at` de hace más de `p_horas` cuyo objeto **sigue existiendo**. Como mucho `p_limite` nombres. No borra: borra la API con `.remove()` (§3.3). Va en SQL porque `list` de Storage no es recursivo y las rutas tienen tres niveles (I3) | — |

**Contratos para la ficha de `0.13.1`** (su función `editar_linea`, en la `0026`):

1. Incluye `descripcion` y `modelo`. Como esos dos campos no se protegen con la `revision` de la compra, `editar_linea` los escribe solo si vienen distintos de lo que leyó el formulario, con la misma comparación `p_antes` (`409 linea_cambio`). Toma los candados en el orden compra → línea; las funciones de esta ficha toman solo la línea, así que no hay interbloqueo.
2. Los plazos de producción y tránsito del proveedor solo **sugieren** el mes de la primera entrega si la línea **no está asignada a un embarque**; con un embarque de 08b manda su fecha de llegada (M12).
3. El selector de fotos en su formulario de línea: §11.P1.

`editar_ficha_linea` sigue valiendo como camino corto.

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
- El JSON entra por `leerCuerpo(request, esquema)`. Se responde con `ok(…)` (`{ data }`) y los errores con `errorConCodigo(mensaje, status, codigo)`. El `[id]` de la compra o del proveedor pasa por `idDeRuta`, que solo lee `{ id }`: `[lineaId]` y `[fotoId]` se validan con `z.uuid()` como ya hace `src/app/api/compras/[id]/recepciones/[recepcionId]/route.ts`, sin ampliar `idDeRuta` (M11).
- **Ninguna escritura directa** sobre `proveedores`, `proveedor_contactos`, `compra_lineas`, `compra_linea_fotos` ni `parametros_precio`: solo `.rpc(`, llamado desde `src/lib/{proveedores,fotos,proformas}/consultas.ts` (prueba estática).
- `.upload(`, `.remove(`, `.copy(`, `.download(` y `.createSignedUrl(s)(` de Storage solo aparecen en `src/lib/fotos/almacen.ts`.
- Ningún componente cliente importa `@/lib/supabase/browser` para Storage.
- `ProveedorApi` (de `compras/tipos-api.ts`) crece de forma aditiva; `ProveedorFichaApi` vive en `src/lib/proveedores/tipos-api.ts`.

### 3.1 Esquemas zod

- **`proveedorFichaSchema`** (estricto, `z.strictObject`; una clave desconocida da `400` como hoy, regla 19). Campos:
  - `nombre`: 1–120, con `trim`.
  - `codigo`: ≤ 30.
  - `pais`: de `PAISES`.
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
- **`fichaLineaSchema`**: `{ descripcion: string ≤ 200 | null, modelo: string ≤ 60 | null, antes: { descripcion: string | null, modelo: string | null } }`. Sin `revision`: §2.7.
- **Subida de foto** (sin zod; `multipart/form-data` validado en `src/lib/fotos/validar.ts`): dos partes, `foto` y `miniatura`. Antes de leer: sin `content-length` → `411 longitud_requerida`; si declara más de **512 KB** → `413 foto_grande`. Después se lee el cuerpo como flujo con un tope de 512 KB (si llegan más bytes, se corta y `413`), y solo entonces se parsea (`new Response(bytes, { headers }).formData()`). Nunca se llama a `request.formData()` directo: `src/proxy.ts` excluye `/api` de su `matcher` y no hay otro límite delante (M1). Si viene la cabecera `Origin` y no es la del sitio → `403 origen_invalido`, defensa contra subidas cruzadas que no depende de cómo esté configurada la cookie de sesión.
- **`parametrosPrecioSchema`** (E2): `{ markup, factor_importacion, tipo_cambio, igv_pct, markup_local?, factor_local?, nota?, base_version: int | null }`, con rangos del mismo tamaño que los `check`.
- **`proformaQuery`** (E2): `{ tipo: "interna" | "externa", proveedor_id?, compra_id?: uuid[] (≤ 50), viaje_id?: uuid | "todos" | "sin_viaje", origen?, desde?, hasta?, incluir_borradores?: "1" }`. Sin `viaje_id`, el viaje activo. `desde` y `hasta` filtran por `compras.fecha_compra`, inclusive (M11). Con `tipo = "externa"`, `proveedor_id` es **obligatorio**.

### 3.2 Proveedores (E1)

| Ruta | Método | Guard | Entrada | Respuesta `{ data }` | Errores |
|---|---|---|---|---|---|
| `/api/compras/proveedores` | GET | `requireUser` | `?activos=1&q=` | `ProveedorApi[]` (ya existe; suma `region`, `puerto_embarque`, `incoterm`, `moneda`, `completo: boolean` y `contactos` llenos) | — |
| `/api/compras/proveedores` | POST | `requireUser` | `proveedorFichaSchema` o `proveedorRapidoSchema` | `201` `ProveedorFichaApi` | `400` validación · `409 nombre_repetido` (con `conflicto { id, nombre, activo }`; si el existente está inactivo, el mensaje dice «Existe «X», pero está inactivo: pide a un admin o planner que lo reactive») · `409 codigo_repetido` · `409 nombre_parecido` (con `parecidos [{ id, nombre, similitud, motivo: "misma_razon_social" | "similar" }]`; solo en modo rápido y sin `confirmar_parecido`) · `403 solo_planner_intercompany` |
| `/api/compras/proveedores/[id]` | GET | `requireUser` | — | `ProveedorFichaApi` más `resumen { compras, ultima_compra, unidades, costo: { USD, PEN } }` | `404 no_encontrado` |
| `/api/compras/proveedores/[id]` | PATCH | `requireUser` | `proveedorFichaSchema` con `revision` | `ProveedorFichaApi` | `404` · `409 proveedor_cambio` · `409 nombre_repetido` · `409 codigo_repetido` · `403 solo_planner_intercompany` (un comprador que cambia `es_intercompany`) |
| `/api/compras/proveedores/[id]/activo` | POST | `requirePlanner` | `activoProveedorSchema` | `ProveedorFichaApi` | `404` |
| `/api/compras/proveedores/[id]` | DELETE | `requirePlanner` | — | `{ accion: "borrado" \| "desactivado" }` | `404` |

`ProveedorFichaApi` = `ProveedorApi` más:

- `direccion`, `plazo_produccion_dias`, `plazo_transito_dias`, `condiciones_pago`;
- `contactos [{ id, nombre, cargo, telefono, correo, es_principal }]`;
- `faltan: ("pais" | "identificacion" | "direccion" | "contacto")[]`;
- `creado_por` y `modificado_por` (`PersonaFechaApi`);
- `revision`;
- `puede { editar, cambiar_intercompany, desactivar, eliminar }`, calculado con el rol en el servidor.

**Parecido** (`src/lib/proveedores/parecidos.ts`, R12; I4). Se compara el **nombre limpio**: `aCodigo` (sin tildes ni signos) y después se quitan, desde el final, las palabras de razón social o de giro (`LTD`, `LIMITED`, `CO`, `CORP`, `INC`, `LLC`, `SA`, `S_A`, `SAC`, `S_A_C`, `SRL`, `S_R_L`, `EIRL`, `SAA`, `GMBH`, `TRADING`, `COMPANY`, `IMPORT`, `EXPORT`; la lista vive en ese archivo). Si los nombres limpios coinciden → parecido con `motivo: "misma_razon_social"`. Si no, `similitud` de `src/lib/ventas/sugerir-mapeo.ts` (05b, Dice sobre bigramas; se importa, no se reescribe) sobre los nombres limpios, con `UMBRAL_PARECIDO_PROVEEDOR = 0,7`, contra los proveedores activos; hasta 3, de mayor a menor. Por qué no el nombre crudo con 0,8: «Textil Delta» frente a «Textiles Delta Ltd.» da 0,71 y no avisaría; limpio da 0,83. El modo ficha también avisa, sin bloquear.

### 3.3 Fotos y ficha de la línea (E1)

| Ruta | Método | Guard | Entrada | Respuesta | Errores |
|---|---|---|---|---|---|
| `/api/compras/[id]/lineas/[lineaId]/fotos` | POST | `requireUser` | `multipart`: `foto` y `miniatura` | `201` `FotoLineaApi` | `411 longitud_requerida` · `413 foto_grande` · `403 origen_invalido` · `400 foto_requerida` · `400 formato_invalido` (no es JPEG) · `400 dimensiones_invalidas` · `404 no_pertenece` · `409 no_editable` (compra cancelada o línea inactiva) · `409 max_fotos` · `502 almacen_no_disponible` |
| `/api/compras/[id]/lineas/[lineaId]/fotos/[fotoId]` | DELETE | `requireUser` | — | `{ id }` | `404 no_pertenece` · `409 no_editable` (compra cancelada y quien quita no es admin) · `409 ya_quitada` |
| `/api/compras/[id]/lineas/[lineaId]/ficha` | PATCH | `requireUser` | `fichaLineaSchema` | `LineaFichaApi { linea_id, descripcion, modelo }` | `404 no_pertenece` · `409 linea_cambio` · `409 no_editable` |
| `/api/compras/fotos` | GET | `requireUser` | `?viaje_id&proveedor_id&compra_id&origen&estado&solo_sin_foto=1&q&pagina&por_pagina (≤ 100)`; sin `viaje_id`, el viaje activo de la cookie | `FotosModuloApi` | `400` filtros |
| `/api/compras/fotos/[fotoId]` | GET | `requireUser` | — | `{ url, expira_at, ancho, alto, leyenda }` (la foto grande, firmada a demanda) | `404` |
| `/api/compras/fotos/[fotoId]/miniatura` | GET | `requireUser` | — | Los bytes de la miniatura (`image/jpeg`), bajados de Storage con `service_role` | `404` (también si la foto está quitada) |
| `/api/compras/fotos/limpiar` | GET | `requireAdmin` | — | `{ sin_fila, quitadas, horas: 24 }`: cuántos objetos borraría | — |
| `/api/compras/fotos/limpiar` | POST | `requireAdmin` | `{ confirmar: true }` | `{ borrados, fallidos }` | `502 almacen_no_disponible` |

**Secuencia del `POST` de una foto** (`src/lib/fotos/servicio.ts`):

1. Guard.
2. `Origin` del propio sitio (si viene); `content-length` presente y ≤ 512 KB.
3. Leer el cuerpo con tope de 512 KB y parsear el `multipart` (§3.1).
4. `validarJpeg` sobre cada parte: firma `FF D8 FF` al principio y `FF D9` al final; ancho y alto leídos del marcador SOF (`SOF0`/`SOF2`); la foto ≤ 800 × 800 y ≤ 400 KB; la miniatura ≤ 320 × 320 y ≤ 60 KB.
5. `quitarMetadatos` (`src/lib/fotos/jpeg.ts`): reescribe el JPEG sin los segmentos `APP1`–`APP15` ni `COM` (EXIF, GPS, XMP, perfiles), **conserva `APP0`** y todo lo demás. El navegador ya los quita al recomprimir; esto lo garantiza aunque llegue un archivo armado a mano (M2).
6. Pre-chequeo barato de pertenencia y de cuántas fotos hay.
7. Subir los **dos objetos** con `upsert: false`, `contentType: 'image/jpeg'` y `cacheControl: '3600'`.
8. `rpc('agregar_foto_linea')`.
9. **Si la función rechaza o falla, borrar los dos objetos** antes de responder.

**Huérfanas y limpieza (I3).** Pueden quedar dos tipos de objetos que nadie ve: (a) **sin fila**, si el proceso muere entre 7 y 8 o falla el borrado del paso 9; (b) **de una foto quitada**, si falla el `.remove()` que sigue a `quitar_foto_linea` (la fila existe, con `activo = false`). `fotos_huerfanas(24)` (§2.7) lista los dos tipos con más de 24 h. `GET /api/compras/fotos/limpiar` dice cuántos son y `POST` los borra con `.remove()` en tandas de 1 000, sin tocar filas. La acción está en **Compras → Fotos**, visible solo para el admin (§4.3), y entra en E1.

**Quitar.** `rpc('quitar_foto_linea')` y después `.remove([ruta, ruta_miniatura])`. Si el borrado del objeto falla, la fila ya está inactiva y el objeto lo recoge la limpieza (caso b).

**Miniaturas por la API (M4).** Una URL firmada distinta en cada respuesta impide que el navegador guarde la imagen en caché: en el celular, cada vez que se abre Fotos o Galería se volverían a bajar todas. Por eso la miniatura se sirve desde `GET /api/compras/fotos/[fotoId]/miniatura`, con `Cache-Control: private, max-age=86400, immutable` (la miniatura de un `id` nunca cambia), `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` y `Content-Disposition: inline`. La foto grande sigue saliendo por URL firmada de 1 h desde el dominio de Supabase. Costo: el tráfico de miniaturas pasa por Railway (≤ 60 KB cada una, una vez por día y equipo; §8, riesgo 8). Al ser del mismo origen, el PDF las descarga sin depender del CORS de Storage.

**Tipos.**

- `FotoLineaApi { id, miniatura_url, ancho, alto, subida_por: PersonaFechaApi }`. `miniatura_url` es la ruta interna `/api/compras/fotos/{id}/miniatura`, sin caducidad. La URL grande solo sale de `GET /fotos/[fotoId]`.
- `FotosModuloApi { contadores { lineas, con_foto, sin_foto }, por_proveedor [{ id, nombre, lineas, sin_foto }], lineas: LineaConFotosApi[], pagina, total }`.
- `LineaConFotosApi { compra { id, numero, estado, proveedor, viaje }, linea { id, tipo, gml: NombreGml | null, marca, agrupacion_marca, tallas, unidades, costo_unitario, moneda, descripcion, modelo }, fotos: { id, miniatura_url, subida_por_nombre, at }[], puede { subir, quitar, editar_ficha } }`. **Sin la `revision` de la compra**: la tarjeta no la necesita (§2.7).

Se excluyen las compras canceladas salvo con `estado=cancelada`; ahí sus líneas salen en solo lectura (el admin ve [Quitar]). La foto grande se firma de una en una, a demanda, con TTL de 3 600 s.

### 3.4 Galería y proformas (E2)

| Ruta | Método | Guard | Entrada | Respuesta | Errores |
|---|---|---|---|---|---|
| `/api/compras/galeria` | GET | `requireUser` | `?viaje_id&proveedor_id&compra_id&origen&genero_id&mundo_id&linea_arbol_id&marca_id&despues_de&por_pagina (≤ 120)`. `linea_arbol_id` es la línea del árbol de M1 (`lineas.id`), no una línea de compra; `despues_de` es el cursor `created_at|id` de la última foto recibida (M5, M11) | `{ fotos: [{ id, miniatura_url, leyenda { proveedor, compra_numero, compra_id, gml, marca, descripcion, modelo, unidades } }], total, siguiente: string \| null }`, ordenado por `created_at desc, id desc`; el cursor no repite ni salta fotos aunque se suban otras mientras tanto | `400` |
| `/api/compras/proformas` | GET | `requireUser` | `proformaQuery` | `ProformaApi` | `400 proveedor_requerido` (externa sin proveedor) · `400` filtros · `404 proveedor` |
| `/api/compras/parametros-precio` | GET | `requireUser` | — | `{ vigente: ParametrosPrecioApi \| null, por_defecto: ParametrosPrecioApi, historial: ParametrosPrecioApi[] }` | — |
| `/api/compras/parametros-precio` | POST | `requirePlanner` | `parametrosPrecioSchema` | `201` `ParametrosPrecioApi` | `409 parametros_cambiaron` · `400` |

**`ProformaApi`**:

- **Interna**: `{ tipo: "interna", filtros, parametros: ParametrosPrecioApi & { origen: "version" | "por_defecto" }, filas: FilaProformaInternaApi[], totales_por_moneda }`. Cada fila: `{ linea_id, compra { id, numero, referencia, fecha_compra }, foto_miniatura_url | null, genero, mundo, linea, agrupacion_marca, marca, tallas, descripcion, modelo, moneda, costo_unitario | null, unidades, total | null, pvp_sugerido | null, cv_pct | null, entregas: "nov-26 300 · dic-26 200" }`.
- **Externa**: `{ tipo: "externa", proveedor { nombre }, filtros, filas: FilaProformaExternaApi[], totales_por_moneda }`. Cada fila: `{ compra { numero, referencia }, foto_miniatura_url, marca, modelo, descripcion, tallas, unidades, moneda, precio_unitario, total, entregas }`.

- Las dos llevan además `truncada: boolean` y `total_filas`: como mucho **2 000 filas** por respuesta (R25). `foto_miniatura_url` es la ruta interna de miniaturas (§3.3).

**Un tipo distinto, no un campo oculto**: el serializador de la externa no conoce `pvp`, `cv`, `costo` interno, `parametros`, la agrupación de marca ni el árbol (R15; las columnas de la externa dependen de §9 C4).

`unidades` = `unidades − unidades_canceladas`; una compra con saldo cerrado muestra lo que de verdad se compró. Se excluyen las líneas inactivas y las compras canceladas. Los borradores solo entran con `incluir_borradores=1`.

**Simulación.** Las filas internas traen `costo_unitario` y `moneda`. El navegador recalcula PVP y CV con los mismos `precioSugerido` y `cvEsperado` de `src/lib/proformas/precios.ts`, que es lógica pura compartida entre servidor y cliente. Nada se guarda. Los exportes de una simulación salen rotulados como tal.

### 3.5 Directorio (E3)

| Ruta | Método | Guard | Entrada | Respuesta | Errores |
|---|---|---|---|---|---|
| `/api/compras/directorio` | GET | `requireUser` | `?viaje_id&desde&hasta&proveedor_id&origen&incluir_borradores` (`desde` y `hasta` sobre `compras.fecha_compra`; sin `viaje_id`, el viaje activo) | `DirectorioApi` | `400` |

`DirectorioApi`:

- `niveles: ["comprador", "genero", "agrupacion_marca", "marca", "mundo", "linea"]`;
- `parametros`;
- `raiz: NodoDirectorioApi[]`, donde cada nodo es `{ etiqueta, lineas, unidades, costo { USD, PEN }, costo_soles, venta_potencial, cv_pct | null, hijos? | filas? }`.

Las hojas son `{ compra_numero, proveedor, descripcion, modelo, unidades, moneda, costo_unitario, pvp_sugerido, cv_pct }`. Se calcula en TS puro con `armarDirectorio(lineas, catalogos, responsables, parametros)`. **El nivel 1 (comprador)** es el responsable del **viaje** de la compra (`compra_viajes.responsable_id`), a nivel de compra (M10). Si la compra no tiene viaje (locales), el responsable del género × mundo de la línea (M1b). Un lote al barrer sin GML y sin viaje va a «Sin responsable». No se usa el responsable del embarque ni del paquete: una compra puede repartirse en varios embarques y quedaría sumada bajo dos compradores (R28).

### 3.6 Códigos de error nuevos

`proveedor_cambio`, `nombre_repetido`, `codigo_repetido`, `nombre_parecido`, `solo_planner_intercompany`, `linea_cambio`, `longitud_requerida`, `origen_invalido`, `foto_grande`, `foto_requerida`, `formato_invalido`, `dimensiones_invalidas`, `max_fotos`, `ya_quitada`, `almacen_no_disponible`, `proveedor_requerido`, `parametros_cambiaron` (más los propios de cada apartado de §11). Se reutilizan `no_pertenece`, `no_editable` y `compra_cambio` de M8. Todos con mensaje en `MENSAJE_ERROR_*` y estado en `ESTADO_HTTP_ERROR_*`, como en `compras/tipos-api.ts`.

## 4. Pantallas

Se usa el kit de Vector2 (`Tabs`, `DataTable`, `Modal`, `Form`, `Chips`, `Badge`, `Alert`, `EmptyState`, `Switch`), `useColeccion` para proveedores y formato `es-PE`. Todo se usa a 390 px de ancho. Arriba va la barra de **viaje activo** de 08b-1 (`BarraViajeActiva` y `useViajeActivo`, que se importan, no se copian) en Fotos, Galería, Proformas y Directorio, y **filtra por defecto** con el viaje activo del navegador («Todos» y «Sin viaje» incluidos). **En el celular** (< 768 px), las tablas anchas (proforma de 14 columnas, Directorio con 6 cifras por nodo, lista de proveedores) pasan a **tarjetas**: lo principal a la vista y el resto en «Ver más» (M6).

### 4.1 Mapa de la sección «Compras» del menú (`src/lib/nav.ts`; todos los roles)

| # | Entrada | Ruta | Roles que la ven | Escritura dentro | Entrega |
|---|---|---|---|---|---|
| 1 | Huecos | `/compras` (`exact`) | todos | — | M8 (existe) |
| 2 | Flujo mensual | `/compras/flujo` | todos | Parámetros: admin y planner | M8 (existe) |
| 3 | Compras | `/compras/registro` | todos | Hoy, admin y planner. Desde E1, **todos** suben fotos y editan descripción y modelo | M8 (existe) |
| 4 | Viajes y embarques | `/compras/agrupadores` | todos | Según 08b | 08b |
| 5 | Pendientes | `/compras/pendientes` | todos | — | `0.13.1` |
| 6 | **Fotos** | `/compras/fotos` | todos | todos (fotos, descripción, modelo); limpiar huérfanas: admin | E1 |
| 7 | **Galería** | `/compras/galeria` | todos | — | E2 (en E1, `pendiente: "E2"`) |
| 8 | **Proformas** | `/compras/proformas` | todos (interna según §9 C1) | Guardar parámetros: admin y planner. Simular: todos | E2 (en E1, `pendiente`) |
| 9 | **Reporte Directorio** | `/compras/directorio` | todos | — | E3 (en E1, `pendiente`) |
| 10 | **Proveedores** | `/compras/proveedores` | todos | Crear y editar, todos. Desactivar y eliminar, admin y planner | E1 |

**Ojo con el guard de rutas.** `puedeVerRuta` autoriza por prefijo y «Huecos» tiene `href: "/compras"`. Por eso **cualquier `/compras/*` queda abierta a todos los roles**, aunque el item tenga `roles`. Esta ficha evita poner roles a las entradas: todo lo restringido es una acción dentro de la página, que la API exige con su guard. Si §9 C1 deja la proforma interna solo para admin y planner, se resuelve con el interruptor Interna/Externa, que el comprador no ve, y con `403` en la API, **no** con un item restringido. La prueba estática de la pantalla lo comprueba.

### 4.2 Proveedores (`/compras/proveedores`)

- **Lista** (`DataTable`, buscador): nombre, código, país · región, puerto habitual, incoterm, moneda, contacto principal (nombre y correo), compras, estado (Activo / Inactivo) y un `Badge` «Ficha incompleta» que nombra lo que falta. Filtros: Activos / Inactivos / Todos, país e intercompany. Se exporta a Excel (hoja `PROVEEDORES`; sin datos bancarios; los textos como celdas de texto, R26).
- **Alta y edición** (`Modal`; pantalla completa en el celular), en tres bloques:
  - **Empresa**: nombre*, código, RUC / Tax ID, país* (lista), estado o provincia (lista si es EE. UU.; texto si no), ciudad y dirección.
  - **Importación**: puerto de embarque habitual (texto con sugerencias), incoterm, moneda, plazo de producción y de tránsito en días (con el texto de ayuda «llegada estimada ≈ fecha de compra + N días»), condiciones de pago e intercompany. **El comprador ve la casilla intercompany deshabilitada**, con la nota «la marca el planner».
  - **Contactos**: filas con nombre*, cargo, teléfono, correo y la radio «Principal»; «+ Agregar contacto», hasta 20.
- **Validaciones visibles**: nombre repetido («Ya existe «Feria Sur»: [Abrir]», o «… pero está inactivo: pide a un admin o planner que lo reactive»); nombre parecido (aviso, no bloquea); correo inválido; estado de EE. UU. requerido; «Otro usuario guardó cambios: recarga» (`proveedor_cambio`).
- **Acciones del planner**: Desactivar o Reactivar, y Eliminar. Esta última pide confirmación y la respuesta dice «eliminado» o «tenía compras: quedó desactivado».
- **Detalle**: la ficha, el resumen de compras (cuántas, la última, unidades y costo por moneda) y «Ver sus compras», que abre `/compras/registro?proveedor_id=`. Su historial de cambios: §11.P4.
- **Alta al vuelo** (`selector-proveedor.tsx`; lo usan la captura de `0.13.1` y los filtros): autocompletado de activos y la opción «Crear «X»». Con `409 nombre_parecido`, un `Modal` pregunta «¿Es alguno de estos? Proveedor Norte Ltd. (mismo nombre sin la razón social) · Textiles Delta Ltd. (0,83)» con las opciones [Usar este] y [No, crear «X»]. Lo creado al vuelo sale con «Ficha incompleta».

### 4.3 Fotos (`/compras/fotos`, pensada para el celular)

- **Cabecera fija**: la barra de viaje activo, un `Select` de proveedor con «Feria Sur · 12 líneas · 4 sin foto», el chip «Solo sin foto», el buscador (descripción, modelo, marca, compra) y el contador **«8 de 12 líneas con foto»**.
- **Tarjeta por línea**: compra C-000101 · proveedor; HOMBRE · URBANO · DENIM (o «Lote BETA al barrer»); marca, tallas, unidades y costo; descripción y modelo (se tocan para editarlos, inline, con guardar o cancelar); las miniaturas; y dos botones grandes (≥ 44 px), **[Cámara]** y **[Galería]**.
  - [Cámara] es `<input type="file" accept="image/*" capture="environment">`. [Galería] es el mismo `input`, sin `capture` y con `multiple`.
  - Con 3 fotos los botones desaparecen y se lee «3/3».
  - Cada miniatura tiene una ✕ que pide confirmar («¿Quitar esta foto? Quedará registrado que la quitaste»).
- **Subida**:
  1. `comprimir.ts` hace `createImageBitmap(archivo, { imageOrientation: "from-image" })`, que aplica la orientación EXIF de forma explícita (M2).
  2. Calcula `dimensionesDestino(w, h, 800)`: conserva la proporción y nunca agranda.
  3. Dibuja en un `canvas` en dos pasos si la reducción es mayor que ×2, para que la foto salga nítida, y exporta `toBlob('image/jpeg', 0,82)`. Si pesa más de 400 KB, prueba con 0,72 y después 0,62.
  4. Hace la miniatura de 320 px con calidad 0,75.
  5. Sube con `api.subir`, de una en una. Cada foto muestra su avance; si falla, [Reintentar] con el mensaje de la API.
  - Recomprimir **borra los metadatos EXIF**, incluida la posición GPS de la feria, y el servidor los vuelve a quitar por si acaso (§3.3, paso 5).
  - Un archivo que el navegador no sabe abrir (HEIC en Chrome de escritorio) da el mensaje «Formato no compatible: expórtala como JPEG».
  - Se rechazan en el cliente los originales de más de 30 MB.
- **Ver**: tocar una miniatura abre el visor con la foto de 800 (`GET /fotos/[id]`).
- **Compra cancelada**: la tarjeta sale en solo lectura; el admin ve la ✕ para quitar una foto equivocada. Las miniaturas no caducan; si la foto grande del visor caducó (más de 1 h abierta), el visor la vuelve a pedir una vez.
- **Sin compras**: «Todavía no hay compras: se cargan con el importador de carga inicial» (§6, requisito previo).
- **Limpieza (solo admin)**: en el menú «…» de la cabecera, «Limpiar fotos huérfanas» dice cuántas hay («3 sin registro y 1 de fotos quitadas, de hace más de 24 h») y las borra al confirmar (§3.3).
- **Lo que ve cada rol**: los tres ven y escriben lo mismo (§9 B3).

### 4.4 Galería (`/compras/galeria`, E2)

Una cuadrícula de miniaturas cuadradas: 3 columnas en el celular y 6 en la PC. La celda usa `object-contain` sobre fondo neutro, así no se recorta la foto. Filtros: viaje, proveedor, compra, origen, género, mundo, línea y marca. Abajo, «120 de 412 fotos» y [Cargar más], que pide la página siguiente por cursor (§3.4).

Al tocar una foto se amplía con la leyenda: proveedor · compra · GML · marca · descripción · modelo · unidades, más [Ver compra]. Se navega con flechas o deslizando, y se cierra con Esc. Solo lectura para todos.

### 4.5 Proformas (`/compras/proformas`, E2)

- **Barra**: el interruptor **Interna / Externa** y los filtros proveedor (obligatorio en Externa; mientras falte, la tabla dice «Elige un proveedor: la proforma externa es para un solo proveedor»), compras, viaje, origen, «incluir borradores» y fechas. Botones [Excel], [PDF con fotos] y [Compartir] (solo si `navigator.canShare` admite archivos). Con más de 2 000 filas, la tabla muestra las primeras 2 000 y el aviso «Hay N filas: filtra por proveedor, compra o viaje» (R25).
- **Tabla interna**: foto, género, mundo, línea, agrupación de marca, marca, descripción, modelo, tallas, precio de compra (moneda), cantidad, total, **PVP sugerido (S/)** y **CV % esperado**. Al pie, los totales por moneda, el PVP total y el CV total. Una línea sin costo muestra «sin costo» y no suma al CV.
- **Tabla externa**: según §9 C4.
- **Parámetros**: la pestaña o panel «Parámetros de precio» muestra la versión vigente (markup, factor, TC, IGV y, si aplica, los de compras en soles), quién la guardó y cuándo, y el historial. Cualquiera puede **[Simular]**: los campos se vuelven editables, la tabla se recalcula al vuelo y aparece la banda «Simulación: no se guarda». El admin y el planner ven además [Guardar como versión N+1], que pide una nota opcional y maneja `409 parametros_cambiaron` con «Alguien guardó otra versión: recarga».
- **PDF** (A4 horizontal; `jspdf` y `jspdf-autotable` con import dinámico, como `lib/proforma-pdf.ts` de COTV):
  - Encabezado: «Proforma interna» o «Proforma», el proveedor y los filtros, la fecha de Lima y, en la interna, la línea de parámetros (versión o simulación).
  - La miniatura de 320 px va en una caja de 14 mm, sin volver a reducirla. Se descargan 6 en paralelo desde la ruta interna de miniaturas; la que falla sale como celda vacía. Con más de 300 filas, el PDF sale sin fotos y el botón lo dice.
  - Totales por moneda en la última página y «Página n de m».
  - Nombre del archivo: `proforma-{interna|externa}-{proveedor}-{aaaa-mm-dd}.pdf`, con el proveedor saneado: sin `/ \ : * ? " < > |` ni caracteres de control, espacios y signos a `-` (sin repetir), como mucho 60 caracteres (R26).
- **Excel**: SheetJS en el navegador, como M8. Hoja `PROFORMA` con las mismas columnas que la tabla de ese tipo (sin fotos) y hoja `PARAMETROS` (solo la interna). Todo texto que viene de un usuario (descripción, modelo, nombres) se escribe como celda de **texto** (tipo `s`), nunca como fórmula; si algún día se ofrece CSV, se arma con `generarCsv` de `src/components/importador/csv.ts`, que escapa las fórmulas (R26, M14).

### 4.6 Reporte Directorio (`/compras/directorio`, E3)

Árbol colapsable con seis niveles: comprador > género > agrupación de marca > marca > mundo > línea. Las agrupaciones de marca van en el orden de `agrupaciones_marca.orden` (PREMIUM → ULTRA LOW, decisión 52). Las líneas sin GML (lotes al barrer) salen como «Al barrer · BETA» bajo género «Varios». El comprador del primer nivel es el responsable del viaje de la compra (§3.5).

**No coincidirá con COTV** (M9): allí «PVP aprox.» es FOB × 13,4 sin redondear (`cotbv2/lib/dir-report.ts`); aquí la venta potencial usa el PVP sugerido redondeado a X9,90 y los parámetros versionados. Las unidades y el costo sí deben coincidir para las mismas compras.

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
  - **Sin metadatos** (M2): `quitarMetadatos` sobre un JPEG sintético con `APP1` (EXIF con GPS), `APP2` y `COM` devuelve uno sin ningún marcador `FF E1`–`FF EF` ni `FF FE`, con `APP0` intacto y las mismas dimensiones; uno sin metadatos sale igual, byte a byte.
- **R3 · Tamaño y origen.** Sin `content-length` → `411 longitud_requerida`; `content-length` > 512 KB → `413` sin leer el cuerpo; un cuerpo que declara 100 KB y manda 600 KB se corta en 512 KB → `413`; `Origin` ajeno → `403 origen_invalido` (handler).
- **R4 · Máximo de fotos.** Como mucho **3 fotos activas por línea**. La cuarta → `409 max_fotos`, y la API borra los dos objetos que subió (handler con almacén falso). Con dos llamadas a la vez, la función bajo candado deja como mucho 3 (humo).
- **R5 · Quitar.** Pone `activo = false`, `quitada_por` y `quitada_at`, y llama a `.remove` con las dos rutas. Una foto de otra línea o de otra compra → `404 no_pertenece` (ids cruzados, como la regla 30 de M8). Quitar dos veces → `409 ya_quitada`.
- **R6 · Compra cancelada.** No se agregan fotos ni se edita la ficha de la línea → `409 no_editable`. Quitar una foto: solo el admin; comprador o planner → `409 no_editable`. Una compra `recibida`, con saldo cerrado o en `borrador` sí admite fotos.
- **R7 · Las fotos no tocan el flujo.** Subir o quitar una foto **no cambia** `compras.revision`, `compra_eventos` ni `flujo_huella_base()` (humo y handler). `editar_ficha_linea` **tampoco** cambia `compras.revision`; deja el evento `editar_linea` (con `antes` y `despues`), que mueve la huella una vez.
- **R7b · Concurrencia de la ficha de la línea.** Con `antes` distinto de lo guardado → `409 linea_cambio`, sin escribir. Con `antes` correcto, edita aunque la compra haya cambiado de `revision` entre medias (otra línea editada, compra asignada a un viaje, ingreso confirmado): sin `409` falso (handler y humo).
- **R8 · Rutas privadas.** Ninguna respuesta de la API trae `ruta` ni `ruta_miniatura`; solo URLs firmadas con `expira_at` ≤ ahora + 3 600 s (foto grande) o la ruta interna de la miniatura.
- **R9 · Storage solo desde el servidor.** `.upload(`, `.remove(`, `.copy(`, `.download(` y `.createSignedUrl` solo en `src/lib/fotos/almacen.ts`. Ningún archivo con `"use client"` importa `@/lib/supabase/*` (prueba estática). El bucket es `public = false` y el esquema `storage` no tiene ninguna política (humo, M3).
- **R10 · Huérfanas.** `fotos_huerfanas(24)` devuelve (a) los objetos sin fila con más de 24 h y (b) los objetos de filas quitadas hace más de 24 h que siguen existiendo; **nunca** el objeto de una fila activa, ni uno sin fila de menos de 24 h (una subida en curso), ni el de una fila quitada hace menos de 24 h. La limpieza borra exactamente esa lista y no toca filas (humo con objetos sembrados en local; handler con almacén falso). Comprador y planner → `403`.

**Proveedores**

- **R11 · Nombre y código únicos.** El nombre es único sobre `upper(nombre)` (`0025`) y la API lo guarda recortado, así que «Feria Sur » choca con «FERIA SUR»; la reutilizada `motivoRechazoProveedor` da el mensaje y `guardar_proveedor` atrapa la carrera (`unique_violation` → `nombre_repetido`). Lo mismo con el código. Si el repetido está inactivo, `conflicto.activo = false` y el mensaje pide reactivarlo.
- **R12 · Parecidos.** Sobre el nombre limpio (§3.2), con valores medidos con la `similitud` real: «Textil Delta» frente a «Textiles Delta Ltd.» → 0,83 (crudo daría 0,71) → avisa; «Feria Sur SAC» frente a «Feria Sur» → `misma_razon_social` → avisa; «Proveedor Norte» frente a «Proveedor Norte Ltd.» → `misma_razon_social`; «Proveedor Norte» frente a «Proveedor Sur» → 0,69 → **no** avisa; «Feria Sur» frente a «Feria Norte» → 0,56 → no avisa. En modo rápido y sin `confirmar_parecido` → `409 nombre_parecido` con la lista; con `confirmar_parecido: true`, crea.
- **R13 · Contactos.** Como mucho 20 y como mucho un principal; si el usuario no marca ninguno, el primero pasa a principal. El correo debe ser válido. `guardar_proveedor` reemplaza los contactos **en la misma transacción** que la ficha (humo: un contacto inválido a mitad no deja ni ficha ni contactos cambiados).
- **R14 · País y región.** El país sale de `PAISES`; fuera de la lista → `400`. Con EE. UU., la región sale de la lista de estados; con otro país es libre.
- **R15 · Concurrencia.** Editar con una `revision` vieja → `409 proveedor_cambio`, sin escribir nada.
- **R16 · Permisos.** Crear y editar: los tres roles. Cambiar `es_intercompany`: solo admin y planner (`403 solo_planner_intercompany`), también en la creación. Desactivar y eliminar: `requirePlanner`. Eliminar con compras → desactiva. Un proveedor inactivo no sale en `?activos=1` ni en el autocompletado, e `importar_compra` sigue diciendo `proveedor_inactivo`.
- **R17 · Sin datos bancarios.** Mientras §9 A3 no diga otra cosa, cualquier clave de banco (`banco`, `cuenta`, o las de COTV `bank_name` y `bank_account`) → `400` (regla 19 de M8, sin cambios).

**Precios y proformas (E2)**

- **R18 · Redondeo X9,90.** `redondearX990` reproduce `roundToNinetyNine` de COTV: 42,21 → 39,90; 43,55 → 49,90; 53,6 → 59,90; 49,95 → 49,90; 9,5 → 9,90; 0 → 0; un número negativo → 0.
- **R19 · PVP y CV.**
  - `precioSugerido(costo, moneda, p)` = `redondearX990(costo × (moneda = USD ? p.markup : p.markup_local))`. Con `costo` nulo → nulo. En soles sin `markup_local` → nulo, con el aviso `sin_markup_local` (§9 C3).
  - `cvEsperado` = `costo × factor × tc × (1 + igv_pct / 100) ÷ pvp × 100` (`igv_pct` guarda 18, no 0,18; M7), con `factor` y `tc` según la moneda (USD: `factor_importacion` y `tipo_cambio`; PEN: `factor_local` y 1). Con `pvp ≤ 0` → nulo.
  - **Caso**: 3,15 USD con los valores por defecto da PVP = 39,90 y CV = 3,15 × 1,3 × 3,4 × 1,18 ÷ 39,90 = **41,2 %**. 3,25 USD da 49,90 y **34,0 %**.
  - **CV del total** = `Σ u·costo·factor·tc·(1 + igv_pct/100) ÷ Σ u·pvp`, sin las filas sin costo.
- **R20 · Versiones de parámetros.** Guardar con `base_version` igual a la vigente crea N+1; con otra → `409 parametros_cambiaron`. La tabla rechaza `UPDATE` y `DELETE` también con `service_role` (humo). Sin filas, la API devuelve los valores por defecto con `origen: "por_defecto"`.
- **R21 · Proforma externa.** Sin `proveedor_id` → `400 proveedor_requerido`. La respuesta no contiene, a ninguna profundidad, las claves `pvp_sugerido`, `cv_pct`, `parametros`, `agrupacion_marca`, `genero`, `mundo` ni `linea` (recorrido del objeto; las del árbol dependen de §9 C4). Las filas son solo del proveedor pedido.
- **R22 · Unidades de la proforma.** Se toma `unidades − unidades_canceladas`. Sin líneas inactivas ni compras canceladas. Los borradores solo con la casilla.
- **R23 · Rótulo de los exportes.** El PDF y el Excel internos llevan «Parámetros vN (…)» o «Simulación (no guardada)»; los externos no llevan ningún parámetro.

**Directorio (E3)**

- **R24 · Sumas.** Cada nodo suma exactamente a sus hijos (unidades, costo por moneda, venta potencial). El CV del nodo es el de sus totales, no el promedio de los CV. El orden de agrupación sigue `agrupaciones_marca.orden`. Una línea sin GML va a «Varios › Al barrer».

**Añadidas en la revisión del 2026-11-04**

- **R25 · Tope de la proforma (E2).** Con más de 2 000 filas, la API devuelve las 2 000 primeras (orden: compra, línea), `truncada: true` y `total_filas`; el PDF con fotos se ofrece solo hasta 300 filas. A 390 px, la proforma y el Directorio se ven como tarjetas, sin desborde horizontal (prueba estática de la pantalla; M6).
- **R26 · Exportes seguros (E1 y E2).** Un texto «=HYPERLINK(…)» o «+1» en descripción, modelo o nombre de proveedor sale en el Excel como celda de texto (tipo `s`), no como fórmula. El nombre del PDF de un proveedor «A/B: C?» sale `proforma-externa-A-B-C-aaaa-mm-dd.pdf` (M14).
- **R27 · Miniatura privada y cacheable (E1).** `GET /api/compras/fotos/[fotoId]/miniatura` sin sesión → `401`; con sesión devuelve `image/jpeg` con `Cache-Control: private, max-age=86400, immutable`, `X-Content-Type-Options: nosniff` y la CSP con `sandbox`; de una foto quitada o inexistente → `404` (handler; M4).
- **R28 · Comprador del Directorio (E3).** Una compra con viaje cuenta bajo el responsable del viaje, aunque sus entregas vayan en embarques con otro responsable; una compra sin viaje, bajo el responsable de su género × mundo (M1b); un lote al barrer sin viaje, bajo «Sin responsable». La misma compra nunca aparece bajo dos compradores (M10).
- **R29 · Ganchos de 08b-1 (E1).** `EmbarqueApi.puertos_habituales` trae, sin repetir y en orden alfabético, el `puerto_embarque` no nulo de los proveedores de las compras con entregas en el embarque. El importador de agrupadores avisa `puerto_distinto_del_habitual` cuando el puerto del embarque no está en esa lista, y no avisa si la lista está vacía. Es informativo y nunca bloquea (handler; I5).

## 6. Criterios de aceptación / hito de prueba

Estas listas las recorre QA **en local, con datos sintéticos**. Lo que recorre Javier en producción, y con qué datos, lo dice §11.P6.

**E1** (en Chromium, en un Android real y en un iPhone real):

**Requisito previo (I2).** E1 no trae ninguna forma de crear compras: hoy hay 0 compras, el único camino es `POST /api/compras/importar` (`requirePlanner`, solo con `carga_inicial`) y la captura manual es de `0.13.1`. En local, QA carga antes una carga inicial sintética; en producción hace falta la carga inicial de Javier (§11.P6).

- [ ] Las consultas de §2.0 reconfirmadas; `00E1` aplica dos veces en local y en `vector-two`; el humo pasa (R4, R5, R6, R7, R7b, R10, R11, R13, R15 y Storage sin ninguna política); los tipos se regeneran.
- [ ] lint, `tsc`, vitest y build limpios; las pruebas de M8 y de 08b siguen verdes **sin modificarlas**, salvo las altas aditivas en `tests/flujo.estatico.test.ts` y `tests/api.guards.roles.test.ts` (M11).
- [ ] Como **comprador**, en el celular: Compras → Fotos abre con el viaje activo; elegir «Feria Sur» y «Solo sin foto». El contador cuadra con la carga sintética («8 de 12»).
- [ ] Una foto con la cámara trasera y dos desde la galería. A la tercera desaparecen los botones. Una cuarta por API da `409 max_fotos` y no deja objeto en el bucket.
- [ ] `datos` mira el objeto en Storage: ≤ 400 KB, lado largo ≤ 800, la proporción del original y sin EXIF ni GPS (`exiftool` sobre una descarga). La miniatura: ≤ 320 de lado y ≤ 60 KB. Un JPEG armado a mano con EXIF y GPS, subido por API, queda guardado sin ellos.
- [ ] La foto se ve en el detalle de la compra en `/compras/registro`. En DevTools, la segunda apertura de Fotos no vuelve a bajar las miniaturas.
- [ ] Quitar una foto: desaparece, el objeto se borra y la fila queda con «quitada por C1».
- [ ] La URL de una foto grande copiada y abierta pasados 61 minutos ya no sirve. Sin sesión, `GET /api/compras/fotos` y la ruta de una miniatura dan `401`. La URL pública del bucket no sirve.
- [ ] Una subida sin `content-length` da `411`; con un `Origin` ajeno, `403`.
- [ ] Compra cancelada: sin botones para el comprador, y la API le da `409 no_editable`. El admin sí puede quitar una foto de esa compra.
- [ ] Subir una foto no recalcula Flujo mensual: misma `huella`, contador de la caché. Editar la descripción la mueve una vez y aparece en el historial de la compra («editar_linea: descripción — → Jean slim azul medio»).
- [ ] Dos pestañas editan la descripción de la misma línea: la segunda recibe `409 linea_cambio`. Editar la descripción de una línea justo después de asignar su compra a un viaje (08b) **no** da `409`.
- [ ] Limpieza: con un objeto sin fila sembrado hace más de 24 h, el admin ve «1 sin registro», lo borra y el objeto desaparece; las fotos activas siguen. Comprador y planner no ven la acción y la API les da `403`.
- [ ] El `Permissions-Policy: camera=()` vigente **no** impide `capture` en Android ni en iOS. Si lo impidiera, `frontend` pasa a `camera=(self)` en `next.config.ts` y se anota (M15).
- [ ] Proveedores, como **comprador**:
  - crear «Textiles Delta Ltd.» (China, Zhejiang, Ningbo, FOB, USD, 45 + 35 días) con dos contactos;
  - crear al vuelo «Textil Delta» → pregunta por el parecido (0,83);
  - «Feria Sur» → «ya existe»; con «Feria Sur» desactivado → «… está inactivo: pide a un admin o planner que lo reactive»;
  - no puede marcar intercompany ni desactivar (botones ocultos; la API da `403`);
  - EE. UU. pide estado.
- [ ] Como **planner** (o admin): desactivar (ya no sale en el autocompletado) y eliminar uno sin compras (se borra) y uno con compras (queda desactivado).
- [ ] Dos pestañas editando el mismo proveedor: la segunda recibe `409 proveedor_cambio`.
- [ ] En Viajes y embarques (08b-1), un embarque con compras de «Textiles Delta Ltd.» sugiere «Ningbo» como puerto; importar ese embarque con puerto «Shanghái» da el aviso «Puerto distinto del habitual del proveedor» (R29).
- [ ] Menú: los tres roles ven la sección Compras con Fotos y Proveedores activos, y Galería, Proformas y Directorio deshabilitados («E2» y «E3»). Nada aparece fuera de Compras.
- [ ] Lo que §11 deje en E1 con su *default* (P2, P4, P5) tiene su propio punto de hito en su apartado.
- [ ] `seguridad` (sonnet) revisa las rutas `requireUser` que escriben (fotos, ficha de línea, proveedores), la subida *multipart* con su tope, la ruta de miniaturas y la limpieza.

**E2**:

- [ ] Galería: 3 columnas a 390 px; [Cargar más] por cursor (subir una foto entre dos páginas no repite ni salta ninguna); vista ampliada con leyenda; filtro por viaje (por defecto, el activo) y por proveedor.
- [ ] Proforma interna de «Textiles Delta Ltd.» con dos líneas sintéticas (3,15 y 3,25 USD): PVP 39,90 y 49,90; CV 41,2 % y 34,0 %. Los totales cuadran con R19.
- [ ] Simular un TC de 3,8: cambian los CV, aparece la banda de simulación, y el PDF y el Excel salen rotulados «Simulación». El comprador no ve [Guardar].
- [ ] El planner guarda la v1; otra pestaña con base 0 recibe `409`. El PDF dice «Parámetros v1».
- [ ] Externa sin proveedor bloqueada. Con proveedor, la respuesta de red no contiene PVP ni CV (DevTools). PDF con fotos, compartido desde el celular a WhatsApp o al correo. Excel sin columnas internas.
- [ ] Con 2 001 filas sintéticas, la proforma interna avisa del truncado y el PDF sale sin fotos. Un modelo «=1+1» sale en el Excel como texto, y el PDF de un proveedor «A/B: C?» se llama `proforma-externa-A-B-C-….pdf`. A 390 px, proforma y Directorio se ven como tarjetas.

**E3**:

- [ ] Directorio de un viaje sintético: los totales del nodo raíz coinciden con la suma de la proforma interna de todos sus proveedores; el orden de agrupación es PREMIUM → ULTRA LOW; el Excel tiene una fila por nodo. Una compra con viaje cuyas entregas van en dos embarques con responsables distintos cuenta solo bajo el responsable del viaje (R28). La venta potencial no se compara con la de COTV (§4.6).

## 7. Fuera de alcance

- **Lo que define 08b**: viaje, embarque, paquete, comprador responsable, viaje activo y compras locales. Aquí solo se filtra por ellos.
- **Pendientes** (`0.13.1`), dashboards por comprador, asignación de comprador (M1b), «Nueva línea» de necesidades y el espacio intercompany de COTV (§0.1).
- Fotos en el importador Excel. Después de importar, se completan en Compras → Fotos con «Solo sin foto».
- **Corregir una compra importada** se hace cancelándola y reimportándola (decisión 57). Las fotos se quedan en la línea de la compra cancelada, visibles en solo lectura con `estado=cancelada`, y el admin puede quitarlas (R6). Traerlas a la línea nueva lo resuelve §11.P5; si Javier dice que no, se vuelven a tomar (I7).
- Recortar, girar o editar fotos; «marcar como principal» y reordenar (la principal es la más antigua: para cambiarla, se quitan las anteriores); fotos del proveedor o de su catálogo; más de 3 fotos por línea (§9 B2).
- Cola de subida sin conexión (10-pwa: sin escritura sin conexión) y transformaciones de imagen de Supabase (dependen del plan; la miniatura se hace en el navegador).
- Proformas **numeradas y guardadas**, enviarlas por correo desde el sistema y que el proveedor las firme. Hoy la proforma se genera, no se guarda.
- PVP decidido por línea (precio final de venta); tipo de cambio automático (SUNAT o SBS); monedas distintas de USD y PEN (la columna admite ampliar el catálogo sin migración).
- Incoterm, puerto y plazos **por compra** (aquí solo son los habituales del proveedor; el puerto real lo muestra el embarque de 08b); costo puesto en almacén (*landed cost*: flete, aduana).
- Fusionar proveedores duplicados (lo mitiga el aviso de parecido). Portal del proveedor. Datos bancarios (salvo §9 A3).

## 8. Riesgos

1. **Cuota de Storage.** Con 3 fotos por línea, unos 150 KB por foto y 20 KB por miniatura, son ~0,5 GB por cada 1 000 líneas. El plan gratuito de Supabase trae 1 GB. `datos` anota el plan en §2.0. Si es el gratuito, la cuota alcanza para el primer año de prueba, y la limpieza de huérfanas más la reducción a 800 px son la defensa.
2. **Primera escritura del comprador antes de M9a** (fotos, ficha de línea y proveedores con `requireUser`). Se mitiga con una lista blanca explícita en `tests/api.guards.roles.test.ts`, con `es_intercompany`, desactivar y eliminar reservados al planner, y con la auditoría de `seguridad`.
3. **Contenido del JPEG.** El servidor comprueba firma, dimensiones y tamaño, pero no lo decodifica entero: un archivo raro con marcadores válidos se guardaría. La foto grande se sirve desde el dominio de Supabase. La **miniatura** sí sale del de Vector2 (M4), con `Content-Type: image/jpeg`, `nosniff`, CSP con `sandbox` y `Content-Disposition: inline`: el navegador no la trata como otra cosa que una imagen. El riesgo es bajo.
4. **URLs firmadas que caducan** (desde M4, solo la foto grande) con el visor abierto más de 1 h. El visor la pide de nuevo una vez. El PDF ya no depende de ellas: usa la ruta interna de miniaturas.
5. **HEIC y teléfonos viejos.** iOS entrega JPEG al elegir desde `accept="image/*"`; Chrome de escritorio no abre HEIC (mensaje claro). Una foto de 48 MP pide mucha memoria en el `canvas`: se limita a 30 MB y se reduce en dos pasos.
6. **Dependencias del PDF.** `jspdf` y `jspdf-autotable` son nuevas. Si la política de red las bloquea, como pasó con SheetJS, la alternativa es una vista de impresión con `window.print()`: «Guardar como PDF» del navegador, sin compartir el archivo.
7. **Choque de archivos con 08b y `0.13.1`** (`detalle-compra.tsx`, `compras/tipos-api.ts`, `consultas.ts`, `nav.ts` y, desde I5, `src/lib/compras/agrupadores/**`). Se construye en serie, nunca en paralelo (§0.3).
8. **Tráfico de miniaturas por Railway** (M4). Con caché de un día por equipo, unas 300 miniaturas de 20 KB son ~6 MB por apertura en frío. Si molesta, se vuelve a URLs firmadas solo para la Galería.
9. **Hito sin compras** (I2). E1 no crea compras (§6, requisito previo). Si la carga inicial de Javier se retrasa, el hito de E1 se recorre solo en local.

## 9. Decisiones cerradas en esta ficha y preguntas abiertas para Javier

### 9.1 Decisiones del arquitecto (propuestas para `docs/DECISIONES.md`, números 87 a 91, reservados en `DECISIONES.md`; 08b usa 81, 83 a 86 y 92 a 98)

- **87 · Proveedores es un maestro de Compras, compartido por todos los viajes.** Su ficha y sus contactos se guardan en una sola función transaccional con `revision`. `proveedor_contactos` pasa de la `0028` de M9a a esta ficha; la `0028` queda solo con `compra_linea_mezcla`. Crea y edita cualquier usuario; `es_intercompany`, desactivar y eliminar, solo el planner. El aviso de parecido compara nombres sin la razón social. (Historial e importador: §11.P4 y §11.P2.)
- **88 · Las fotos de una línea se reducen en el navegador** a lo que cabe en 800×800 conservando la proporción (JPEG; miniatura de 320 px), y el servidor les quita los metadatos. Suben **por un route handler con guard** y tope de tamaño, que las guarda con `service_role` en un bucket privado **sin políticas**. La miniatura se sirve por la API con caché privada; la foto grande, por URL firmada de 1 h generada en el servidor. Máximo 3 activas. Quitar las borra del bucket y conserva quién y cuándo; una limpieza de solo admin recoge los objetos huérfanos. **No tocan `revision`, eventos ni la huella del flujo.** La descripción y el modelo de la línea se protegen con el candado de la línea y los valores previos, no con la `revision` de la compra: **matiza la decisión 60** para esos dos campos, para no dar `409` falsos en Fotos. Se descarta lo de COTV: políticas abiertas a `authenticated` y subida directa del navegador.
- **89 · Los parámetros de precio (markup, factor, TC, IGV) son una configuración versionada e inmutable en base.** Simular nunca guarda. Cada exporte dice con qué versión, o que es una simulación. Se descarta `localStorage`.
- **90 · La proforma externa es de un solo proveedor** y el servidor nunca le manda PVP, CV ni parámetros: es un tipo de respuesta distinto, no un campo oculto en pantalla.
- **91 · De COTV no se traen** el espacio intercompany (ya está en M13 y M8), Pendientes (`0.13.1`), el dashboard por comprador (OTB por viaje, descartado), la asignación de comprador (M1b) ni «Nueva línea» (la necesidad se calcula). El viaje activo lo trae 08b.

### 9.2 *Defaults* aplicados de la primera versión (no bloquean)

Eran las preguntas abiertas de la primera versión. Desde la revisión del 2026-11-04 son ***defaults* ya aplicados**: la recomendación de cada una es lo que se construye, y Javier puede cambiarlas al leer la ficha o al recorrer el hito. Las seis que solo él puede decidir y que cambian el diseño están en §11.

**A · Proveedores**

1. **Puerto de embarque.** En COTV no existía. ¿Se agrega al proveedor como «puerto habitual», mientras el puerto real de cada envío se ve en el embarque de 08b? *Recomendación: sí; texto libre con sugerencias de lo ya escrito, sin catálogo de puertos.*
2. **Otros campos de importación.** ¿Se suman incoterm habitual (FOB por defecto en la pantalla), moneda habitual, plazo de producción y plazo de tránsito en días, y condiciones de pago? *Recomendación: los cinco, opcionales. Los plazos servirán en `0.13.1` para sugerir el mes de llegada y la moneda prellena la compra.*
3. **Datos bancarios** (banco y número de cuenta, que COTV guardaba en `bank_name` y `bank_account`; COTV no guardaba SWIFT). *Recomendación: no guardarlos en Vector2 por ahora. Cambiarle la cuenta a un proveedor es la puerta clásica de fraude, y el pago lo hace tesorería con sus propios datos. Si los quieres, que los vean y editen solo admin y planner, con historial de cambios.*
4. **Datos mínimos.** *Recomendación: nombre y país obligatorios en la ficha; el alta al vuelo solo pide el nombre y deja el proveedor marcado «Ficha incompleta» hasta completar país, RUC o Tax ID, dirección y un contacto.*

**B · Fotos**

1. **«800×800»: ¿que quepa en 800×800 conservando la proporción, o un cuadrado exacto?** *Recomendación: que quepa, sin recorte (una foto de 4000×3000 queda en 800×600). Recortar al cuadrado puede cortar la etiqueta o una manga; rellenar con blanco hasta el cuadrado agrega peso sin información. Galería y PDF ya muestran celdas cuadradas sin recortar.*
2. **¿Cuántas fotos por línea?** *Recomendación: 3, como en COTV. Si los lotes al barrer de varias marcas necesitan más, se sube el tope sin migración de tablas (solo cambia la función).*
3. **¿Quién sube y quita fotos, y quién edita descripción y modelo?** *Recomendación: los tres roles desde E1, antes de M9a. Es el uso principal del comprador en la feria y cumple la decisión 28. El resto de su escritura sigue esperando a M9a.*
4. **Descripción y modelo en cada línea** (texto libre, opcionales). *Recomendación: sí. Sin ellos, dos líneas DENIM × ALFA del mismo proveedor no se distinguen en Fotos, y la proforma externa no le sirve al proveedor. Entran también como columnas opcionales del importador en E2.*

**C · Proformas y precios**

1. **¿El comprador ve la proforma interna (PVP sugerido y CV esperado)?** *Recomendación: sí. Era su herramienta en COTV y no es venta real de M5: sale de su propio costo y de los parámetros. Los parámetros solo los guardan admin y planner; cualquiera simula sin guardar.*
2. **Valores iniciales y tipo de cambio.** *Recomendación: la versión 1 con los de COTV (markup 13,4, factor de importación 1,30, TC 3,40, IGV 18 %), y un TC de planificación fijo que actualiza el planner, no el del día.*
3. **Compras en soles (locales): ¿cómo se calculan el PVP y el CV?** *Recomendación: markup local = 13,4 ÷ 3,40 ≈ 3,94 (el mismo margen que una importación), factor 1,00, sin tipo de cambio y con costo sin IGV. Si prefieres otros valores, se guardan como parámetros propios. Aplicado también en los valores por defecto sin versión guardada (§2.6, M8).*
4. **¿Qué columnas lleva la externa?** COTV mostraba género, mundo, línea y agrupación de marca. *Recomendación: foto, número y referencia de la compra, marca, modelo, descripción, tallas, cantidad, precio, total y meses de entrega, sin género, mundo, línea ni agrupación de marca. «ULTRA LOW» o «PREMIUM» es clasificación interna que el proveedor no necesita ver.*

**D · Orden, menú y reportes**

1. **Orden de construcción.** *Resuelto por el estado real (2026-11-04): 08b-1 ya está en construcción, así que el orden es 08b-1 → E1 → 08b-2 → E2 → E3, después `0.13.1` y M9a (§0.3).*
2. **Primer nivel del Directorio: ¿qué comprador?** *Aplicado (M10): el responsable del **viaje** de la compra, a nivel de compra (nunca el del embarque o el paquete, que partiría una compra entre dos compradores); sin viaje, el del género × mundo (M1b); lotes al barrer sin viaje, «Sin responsable» (§3.5, R28).*
3. **Orden del menú Compras.** *Recomendación: Huecos · Flujo mensual · Compras · Viajes y embarques · Pendientes · Fotos · Galería · Proformas · Reporte Directorio · Proveedores, todas visibles para los tres roles (§4.1). Las de entregas futuras se ven deshabilitadas hasta construirse.*
4. **La barra de cobertura de Pendientes de COTV.** *Recomendación: no se rehace aquí. Se pide a la ficha de `0.13.1` como columna «cobertura del saldo» (en camino ÷ (en camino + saldo)) en su pantalla de Pendientes.*

**Revisión independiente.** Hecha por el `arquitecto-revisor` (opus) el 2026-11-04, con 08b y el código de 08b-1 delante. Lo que cambió está en §10.

## 10. Trazabilidad de la revisión independiente (2026-11-04)

| Punto | Qué se hizo | Dónde quedó |
|---|---|---|
| I1 · Orden y numeración | Registro único de reservas en PLAN §5; la ficha ya no nombra números concretos; orden 08b-1 → E1 → 08b-2 → E2 → E3; `APP_VERSION` al día; fuera la rama «mientras 08b no exista»; el viaje activo filtra por defecto | Cabecera, §0.1, §0.3, §4 (intro), §9.2 D1 |
| I2 · E1 sin compras | Requisito previo de carga inicial; mensaje de pantalla vacía; contrato con `0.13.1` | §6 E1, §4.3, §8 riesgo 9, **§11.P1** |
| I3 · Limpieza contradictoria | `fotos_huerfanas` de solo lectura (sin fila y quitadas), borrado con `.remove()`, acción solo admin en Fotos | §2.7, §3.3, §4.3, R10, §6 |
| I4 · Parecido que no detectaba | Nombre limpio sin razón social, umbral 0,7, ejemplos medidos; repetido inactivo con mensaje propio | §3.2, §4.2, R11, R12, §6 |
| I5 · Ganchos de 08b-1 | E1 llena `puertos_habituales` y emite `puerto_distinto_del_habitual` | §0.2, T3b, R29, §6 |
| I6 · 409 falsos en Fotos | Opción (a): `editar_ficha_linea` con candado de línea y `p_antes`, sin `compras.revision`; `linea_cambio` | §2.7, §3.1, §3.3, R7, R7b, §9.1 (88) |
| I7 · Fotos atrapadas al reimportar | Mínimo aplicado (documentado; el admin quita en canceladas); «Traer fotos» como *default* | §2.7, R6, §7, **§11.P5** |
| I8 · Maestro sin historial | `proveedor_eventos` como *default* | **§11.P4** |
| I9 · Costo no FOB | Aviso «CV aproximado» como *default* | §2.1, **§11.P3** |
| I10 · Traer proveedores de COTV | Importador como *default* | §0.1, **§11.P2** |
| I11 · Sintéticos en producción | Hito en local con sintéticos; Javier con su carga real como *default* | §6, **§11.P6** |
| M1 | 411 sin `content-length`, lectura con tope, sin `request.formData()` directo; `Origin` | §3.1, §3.3, R3 |
| M2 | `quitarMetadatos` en el servidor; `imageOrientation: "from-image"` | §3.3, §4.3, R2 |
| M3 | Humo exige 0 políticas en `storage` | §2.0, §2.5, R9 |
| M4 | Miniaturas por route handler con caché privada | §3.3, R27, §8 riesgos 3, 4 y 8 |
| M5 | Galería con cursor | §3.4, §4.4, §6 E2 |
| M6 | Tope de 2 000 filas, PDF con fotos hasta 300, tarjetas en el celular | §3.4, §4 (intro), §4.5, R25 |
| M7 | `igv_pct / 100` | §2.6, R19 |
| M8 | `markup_local = 3,94` en los valores por defecto | §2.6, §9.2 C3 |
| M9 | El Directorio no coincide con COTV, y por qué | §0.1, §4.6 |
| M10 | Comprador = responsable del viaje, a nivel de compra | §3.5, §4.6, R28, §9.2 D2 |
| M11 | Pruebas aditivas; `upper(nombre)`; sin SWIFT; `descripcion` frente a `nota`; `desde`/`hasta` sobre `fecha_compra`; `linea_arbol_id`; ids de ruta con `z.uuid()` | §6, R11, §9.2 A3, R17, §2.3, §3.1, §3.4, §3 |
| M12 | Plazos del proveedor solo sugieren si la línea no está en un embarque | §2.7 (contratos para `0.13.1`) |
| M13 | Fuera «país sin normalizar»; `activo` de contactos «por convención y sin uso» (se conserva por la convención de PLAN §4) | §2.1, §2.2, §3.1, §3.2, R14 |
| M14 | Celdas de texto en Excel, `generarCsv`, nombre del PDF saneado | §4.2, §4.5, R26 |
| M15 | `next.config.ts` asignado a `frontend` en T4 si hace falta | §0.3 T4, §6 |

## 11. Pendiente de Javier (seis preguntas)

Cada apartado trae la pregunta en lenguaje de negocio, las opciones, el ***default* provisional** (lo que se construye si Javier no responde antes de esa entrega) y **todo** lo que ese *default* añade a la ficha: modelo, API, pantalla, regla, hito y archivos de las tandas. Fuera de su apartado, las demás secciones solo lo **nombran**. Si una respuesta cambia, se reescribe **ese apartado**; la única excepción está dicha en P4 (c).

### 11.P1 · ¿Fotos en el mismo momento de registrar la compra? (I2)

**Pregunta.** Hasta la entrega `0.13.1`, las compras solo entran al sistema con tu archivo de carga inicial. Cuando llegue el registro de compras a mano, ¿quieres que el comprador pueda sacar las fotos de cada producto **en el mismo formulario** donde anota la compra, o basta con que las suba después desde Compras → Fotos?

- **(a) En el mismo formulario**, en cuanto la línea esté guardada (aunque la compra siga en borrador). ***Default provisional.***
- (b) Solo después, desde Compras → Fotos.

**Qué añade el *default*.** Nada en E1: es un contrato para la ficha de `0.13.1`. Su formulario de línea monta el mismo `<FotosLinea>` de E1 (`src/components/fotos/`) cuando la línea ya tiene `id`; antes de guardarla, el botón sale deshabilitado con «Guarda la línea para agregar fotos». No hay fotos sin línea ni cola local (10-pwa).

**Si cambia a (b):** se borra este contrato. Nada más de la ficha cambia.

### 11.P2 · ¿Cómo pasamos los proveedores de COTV? (I10)

**Pregunta.** En COTV ya tienes los proveedores cargados, con sus contactos. ¿Cómo los pasamos a Vector2?

- **(a) Con un importador**: descargas una planilla (Excel o CSV), pegas lo de COTV y el sistema los crea todos de una vez; si la subes dos veces, no duplica. Los datos bancarios no se pasan. ***Default provisional, en E1.***
- (b) A mano, uno por uno, en la pantalla de Proveedores.
- (c) Con importador, pero más adelante (junto con la galería y las proformas, E2).

**Qué añade el *default*.**

- **API**: `POST /api/compras/proveedores/importar` (`requirePlanner`; hoy lo usa Javier como admin), modos `previsualizar` y `aplicar`, hasta 1 000 filas, con el importador compartido `src/components/importador/**` y su plantilla.
- **Columnas**: `NOMBRE`*, `CODIGO`, `PAIS`, `REGION`, `CIUDAD`, `DIRECCION`, `IDENTIFICACION`, `PUERTO_EMBARQUE`, `INCOTERM`, `MONEDA`, `PLAZO_PRODUCCION_DIAS`, `PLAZO_TRANSITO_DIAS`, `CONDICIONES_PAGO`, `NOTA` y hasta 3 contactos (`CONTACTO1_NOMBRE`, `CONTACTO1_CARGO`, `CONTACTO1_TELEFONO`, `CONTACTO1_CORREO` … `CONTACTO3_*`); el contacto 1 es el principal. Se aceptan como alias los encabezados de COTV (`name`, `country`, `state`, `address`, `ruc`). Las columnas de banco (`bank_name`, `bank_account`) se ignoran con el aviso `columna_ignorada` (§9 A3). `es_intercompany` no se importa.
- **Solo crea.** Un nombre que ya existe (en mayúsculas y sin espacios al borde) sale omitido como `ya_existe`, sin tocarlo: reimportar el mismo archivo no hace nada. Motivos de omisión: `nombre_vacio`, `nombre_repetido_en_archivo`, `ya_existe`, `pais_desconocido`, `region_invalida`, `incoterm_invalido`, `moneda_invalida`, `plazo_invalido`, `correo_invalido`, `texto_largo`. El parecido (§3.2) es un aviso por fila y no omite.
- **Modelo**: función `importar_proveedores(p_lote jsonb, p_actor jsonb)` en `00E1`, una transacción por lote, con la misma lógica de ficha y contactos que `guardar_proveedor` (y su evento, si P4 queda en sí).
- **Pantalla**: pestaña «Importar» en `/compras/proveedores`, visible para admin y planner.
- **Regla RP2**: importar dos veces el mismo archivo crea N y después 0; un nombre que solo difiere en mayúsculas o espacios sale `ya_existe`; un correo inválido en el contacto 2 omite la fila entera.
- **Tandas**: T0 `src/lib/proveedores/importar-esquemas.ts`; T1 la función en `00E1`; T2 `src/lib/proveedores/importar.ts` y `tests/proveedores.importar.test.ts`; T3a la pestaña; T3b `src/app/api/compras/proveedores/importar/route.ts`.
- **Hito**: en local, una planilla sintética de 5 proveedores (uno repetido y uno con el país mal escrito) da 3 creados, 1 `ya_existe` y 1 `pais_desconocido`; reimportarla da 0 creados. En producción, Javier importa los de COTV **antes** de su carga inicial de compras, para que el importador de compras los encuentre por nombre (§11.P6).

**Si cambia:** con (b) se borra este apartado; con (c) se mueve tal cual a E2.

### 11.P3 · ¿El costo que se anota es siempre FOB? (I9)

**Pregunta.** El PVP sugerido y el CV esperado de la proforma suponen que el costo unitario de cada compra es **FOB**: la mercadería puesta en el barco en origen, sin flete ni seguro. ¿Es siempre así?

- **(a) Sí, siempre FOB por regla de la casa.** Si un proveedor trabaja habitualmente con una condición que ya incluye flete o seguro (CIF, CFR, DDP y similares), la proforma interna y el Directorio marcan sus filas «costo no FOB: CV aproximado». El cálculo no cambia. ***Default provisional, en E2 y E3.***
- (b) Sí, siempre FOB, sin ninguna marca.
- (c) No: a veces el costo es CIF u otra condición y quiero que el cálculo lo corrija. Eso es otra ficha (condición por compra y un factor por condición).

**Qué añade el *default*.** `FilaProformaInternaApi` y las hojas del Directorio suman `aviso_costo: "no_fob" | null`: `no_fob` si el `incoterm` habitual del proveedor es `CFR`, `CIF`, `CPT`, `CIP`, `DAP`, `DPU` o `DDP`; nulo con `EXW`, `FCA`, `FAS`, `FOB` o sin incoterm. En pantalla, un `Badge` «CV aprox.» con la explicación. La proforma externa nunca lo lleva. **Regla RP3**: un proveedor `CIF` marca sus filas; uno `FCA` o sin incoterm, no; el PVP y el CV salen iguales con y sin marca. **Hito E2**: un proveedor sintético `CIF` muestra el aviso en la interna y no en la externa. **Tandas**: el campo en `src/lib/proformas/{tipos-api,armar}.ts` y `src/lib/directorio/armar.ts`; el `Badge` en `src/components/proformas/**`.

**Si cambia:** con (b) se borra este apartado; con (c) se borra y se abre una ficha nueva.

### 11.P4 · ¿Quién puede cambiar un proveedor, y queda registro? (I8)

**Pregunta.** Los proveedores son compartidos: si un comprador cambia el nombre de un proveedor o el teléfono de un contacto, lo ven todos. ¿Cómo lo quieres?

- **(a) Cualquiera puede editar, y queda un historial que no se puede borrar**: quién cambió qué, cuándo y cuál era el valor anterior, visible en la ficha del proveedor. ***Default provisional, en E1.***
- (b) Cualquiera puede editar, sin historial (solo «modificado por» y la fecha del último cambio).
- (c) El comprador solo crea proveedores; cambiar el nombre o los contactos de uno existente lo hacen el admin o el planner.

**Qué añade el *default*.**

- **Tabla `proveedor_eventos`** (en `00E1`): `id`, `proveedor_id uuid null` → `proveedores` `on delete set null` (con índice `(proveedor_id, created_at desc)`), `proveedor_nombre text not null` (copia, para que el historial de un proveedor borrado siga legible), `accion text not null` (catálogo zod: `crear`, `editar`, `desactivar`, `reactivar`, `eliminar`, `importar`), `antes jsonb null` y `despues jsonb null` (ficha y contactos; nunca banco), `resumen` (≤ 300), `perfil_id` → `perfiles` `on delete set null`, `usuario_nombre`, `created_at`. **Sin `activo` ni `updated_at`**: la misma excepción documentada que `compra_eventos`.
- **Inmutable** por trigger, también para `service_role`, y con trigger de sentencia contra `TRUNCATE` (patrón de `compra_eventos` y del trigger `compra_eventos_sin_vaciado` de la migración de 08b-1). Única excepción: el `UPDATE` que solo pone en nulo `proveedor_id` o `perfil_id` (borrado de un proveedor sin compras o de un usuario), con todo lo demás igual.
- **Quién escribe**: `guardar_proveedor` (un evento por guardado con cambios; un guardado sin cambios no escribe evento ni sube `revision`), `cambiar_activo_proveedor`, `eliminar_proveedor` (el evento `eliminar` va antes del borrado) e `importar_proveedores` si P2 queda en sí.
- **API**: `GET /api/compras/proveedores/[id]/historial` (`requireUser`) → `[{ accion, resumen, cambios: [{ campo, antes, despues }], por: PersonaFechaApi }]`; el detalle campo a campo se calcula en TS.
- **Pantalla**: pestaña «Historial» en el detalle del proveedor.
- **Regla RP4**: renombrar deja un evento con `antes` y `despues` del nombre; cambiar el teléfono de un contacto deja uno con el contacto anterior; `UPDATE`, `DELETE` y `TRUNCATE` sobre la tabla fallan también con `service_role` (humo); borrar un proveedor sin compras conserva sus eventos con `proveedor_id` nulo.
- **Tandas**: T1 tabla y triggers en `00E1`; T2 `src/lib/proveedores/historial.ts`; T3a la pestaña; T3b `src/app/api/compras/proveedores/[id]/historial/route.ts`.
- **Hito**: como comprador, renombrar un proveedor; como planner, verlo en Historial con el nombre anterior.

**Si cambia:** con (b) se borra este apartado. Con (c) se borra **y además** cambian R16 y las acciones de §4.2: `PATCH /api/compras/proveedores/[id]` pasa a `requirePlanner` y el comprador conserva el alta (completa y al vuelo).

### 11.P5 · Al corregir una compra cancelando y reimportando, ¿se conservan las fotos? (I7)

**Pregunta.** Para corregir una compra que vino en el archivo de carga, hoy se cancela y se vuelve a importar (así quedó decidido en M8). Las fotos quedan pegadas a la compra cancelada. ¿Qué hacemos con ellas?

- **(a) Un botón «Traer fotos de la versión cancelada»** en la línea nueva, que las copia en un toque. ***Default provisional, en E1.***
- (b) Se vuelven a tomar. Las de la compra cancelada siguen visibles en esa compra y el admin puede quitarlas (eso ya está en E1, R6).

**Qué añade el *default*.**

- **Origen**: la línea más reciente de una compra **cancelada** con la misma `clave_importacion` (proveedor | referencia | línea, la que pone el importador) y el mismo proveedor. Solo para líneas importadas: las manuales no tienen clave.
- **Modelo**: columna `origen_foto_id uuid null` → `compra_linea_fotos` `on delete restrict` en `compra_linea_fotos` (en `00E1`), con único parcial `(linea_id, origen_foto_id) where activo and origen_foto_id is not null`. Función `traer_fotos_linea(p_compra uuid, p_linea uuid, p_origen uuid, p_fotos jsonb, p_actor jsonb)`: bloquea la línea destino; comprueba pertenencia, destino no cancelado, origen en una compra cancelada con la misma clave, y no pasar de 3 activas (trae las más antiguas que quepan y salta las ya traídas). Motivos: `sin_origen`, `no_editable`, `max_fotos`.
- **API**: `POST /api/compras/[id]/lineas/[lineaId]/fotos/traer` (`requireUser`), sin cuerpo. Copia en Storage (`.copy`, dentro de `almacen.ts`) cada foto activa del origen a rutas nuevas de la línea destino y llama a la función; si rechaza, borra las copias. Las fotos del origen no cambian. Errores: `404 sin_origen`, `409 max_fotos`, `409 no_editable`, `502 almacen_no_disponible`. `LineaConFotosApi` suma `fotos_en_cancelada: number`.
- **Pantalla**: en la tarjeta de Fotos y en el detalle de la compra, «Hay 2 fotos en la versión cancelada [Traer]».
- **Regla RP5**: traer copia las fotos activas del origen hasta completar 3; traer dos veces no duplica (la segunda trae 0); una línea sin clave o sin origen cancelado da `404 sin_origen`; el origen queda intacto.
- **Tandas**: T1 columna, índice y función en `00E1`; T2 `src/lib/fotos/traer.ts`; T3a el aviso y el botón; T3b `src/app/api/compras/[id]/lineas/[lineaId]/fotos/traer/route.ts`.
- **Hito** (local): importar una compra, poner 2 fotos en una línea, cancelarla, reimportarla corregida, [Traer] → 2 fotos; [Traer] otra vez → 0 nuevas.

**Si cambia a (b):** se borra este apartado.

### 11.P6 · ¿Con qué datos se prueba la entrega en el sistema real? (I11)

**Pregunta.** Para probar E1 hacen falta compras, proveedores y fotos. En el sistema real, lo que se crea no se puede borrar del todo: las compras solo se cancelan y los proveedores con compras solo se desactivan. ¿Cómo hacemos la prueba final?

- **(a) Los datos inventados se usan solo en una copia local**, donde QA recorre §6 completo. Tú recorres el sistema real **con tu carga inicial real**: completas la ficha de proveedores reales y subes fotos reales a compras reales. ***Default provisional.***
- (b) Se prueba en el sistema real con datos inventados, que después se cancelan y desactivan y quedan a la vista como inactivos o cancelados.

**Qué añade el *default*: el recorrido de Javier en producción.**

- [ ] (Si P2 queda en sí) importar los proveedores de COTV.
- [ ] Hacer la carga inicial de compras (`0.13.0`): sin ella no hay nada que fotografiar.
- [ ] Completar la ficha de dos proveedores reales, con puerto e incoterm habituales y un contacto.
- [ ] Desde el celular, en Compras → Fotos, subir tres fotos a una línea real y verlas en el detalle de la compra; quitar una.
- [ ] Escribir la descripción y el modelo de esa línea.
- [ ] En Viajes y embarques, ver el puerto habitual sugerido en un embarque de ese proveedor.
- [ ] Revisar el menú como admin y, si puede, con un comprador.

**Si cambia a (b):** se borra esta lista y §6 se recorre en producción con los datos inventados.

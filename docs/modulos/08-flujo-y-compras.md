# M8 + M9 · Flujo de mercadería, necesidad de compra y compras de los compradores (un solo ciclo)

> Estado: **especificada el 2026-10-15, pendiente de revisión por el `arquitecto-revisor` y de aprobación por Javier.** Ficha conjunta de M8 (flujo y necesidad) y M9 (compras), según la decisión 1 de `08-09-definiciones-del-dueno.md`: M7 da la venta mensual proyectada por GML-AM → M8 la compara con el stock y con lo que viene en camino y deja el hueco por comprar → el comprador registra compras en M9 → M8 se recalcula. Migración prevista **`0021_flujo_compras.sql`**; versión prevista **`0.13.0 · M8`** (M8 y M9 se entregan juntos; el sufijo del pie del menú es `M8`), después de `0.12.0 · M13`; commits con prefijo `M8:` (flujo) y `M9:` (compras y proveedores). Depende de [07-proyeccion-anual](07-proyeccion-anual.md) (`GET /api/proyeccion/cerrada?anio=` / `leerProyeccionCerrada`: meses, `origen_meses`, `participaciones_historicas`), [12-analisis-marcas-barrer](12-analisis-marcas-barrer.md) (reparto vigente de cada marca al barrer o mixta; `claveFlujo` con `mixta`), [13-intercompany](13-intercompany.md) (reglas vigentes por mes), [05-venta-stock](05-venta-stock.md) (stock de fin de mes por tienda, equivalencia, marca y talla; el CD incluido), [04-tiendas](04-tiendas.md) (tipo Tienda / Centro de Distribución), [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (`claveFlujo`, `marcas_unidad`, nivel GML/GMLE) y [01b-responsables](01b-responsables.md) (filtro "lo mío" del comprador). Después de este módulo entra la PWA (`10-pwa.md`): los compradores registran desde el celular. **Referencia visual**: el repositorio `COTBV2` ("Control OTB Viaje") de Javier, clonado en solo lectura; se toma su look and feel y sus piezas de UX, nunca su esquema ni su código (sección 4.0). Sin datos reales: proveedores "Proveedor Norte" y "Feria Sur", tiendas `T01…`, cifras inventadas; JH, Donatelli y VH se nombran como maestros del dominio.

## 1. Objetivo

Decir, para cada unidad de planificación (GML o GMLE) y agrupación de marca, **mes a mes y en un horizonte móvil** (del mes siguiente al último cerrado hasta diciembre del año siguiente), cuántas unidades hacen falta para que el stock entre el CD y las tiendas se mantenga entre **4 y 8 meses de inventario**: el flujo parte de la venta proyectada de M7 (nunca la recalcula), descuenta la parte que llega directo del intercompany (M13), resta la demanda al stock de fin del último mes cerrado y suma los ingresos futuros (compras registradas en M9, con las compras al barrer repartidas a los GML con el reparto vigente de M12), y deja por mes el **saldo por comprar** (lo que debe llegar en ese mes para no bajar de 4 meses) y el **exceso** (lo que sobra por encima de 8 cuando una oportunidad pasó lo necesario). No hay OTB por temporada: se compra por oportunidad y lo que importa es el saldo de cada GML y mes, que baja cuando entra una compra. M9 es la herramienta con la que los compradores registran esas compras (por detalle o por carga masiva, con proveedores que ellos mismos crean), desde el celular durante un viaje o desde la PC, viendo el hueco que cubren; y con la que el planner carga las compras ya hechas y las compras directas del CD intercompany.

## 2. Decidido por Javier (2026-10-15)

1. **M8 y M9 se definen juntos** (decisión 1): el ciclo M7 → M8 → M9 → M8.
2. **No se compra por temporada, se compra por oportunidad**; sin OTB por temporada; horizonte móvil (año en curso y siguiente, como M7); lo que importa es el saldo por comprar de cada GML y mes, que baja cuando entra una compra y muestra el exceso cuando una oportunidad supera lo necesario (decisión 2).
3. **Tres orígenes de compras** (decisión 5): (a) compras del administrador de producto de JH, Donatelli y VH **directo del CD intercompany**; (b) **carga inicial** de las compras ya hechas, con una **plantilla Excel nuestra** (proveedor, GML/GMLE, marca o agrupación de marcas, tallas, unidades, costo, llegada, destino: decisión 13); (c) el **comprador ingresa sus compras**, por detalle o por carga masiva, y dentro del módulo puede **crear proveedores** y demás maestros.
4. **Nivel de una compra** (decisión 7): GML o GMLE; marca o agrupación de marcas según el caso; tallas centrales, extremas o ambas.
5. **Cobertura en meses de inventario del stock entre CD y tiendas: mínimo 4, tope 8** (decisión 11); el flujo señala por debajo (falta comprar) y por encima (exceso).
6. **Todos los compradores ven y registran todo**, con filtros para ver lo suyo; una compra al barrer viene mixta y puede cubrir marcas o GML de varios compradores: **no se asigna a un único comprador** (decisión 12).
7. **Referencia visual del módulo del comprador**: el repositorio de Javier (`COTBV2`), entregado el 2026-10-15; "la forma de verse está simpática". Se adopta como look and feel (sección 4.0).
8. De M12 y M13 (misma fecha): las marcas al barrer se reparten con un reparto aprobado; el intercompany directo se descuenta de la demanda por marca y GML.

Interpretación del borrador que esta ficha adopta: M7 ya incluye la venta de las marcas al barrer dentro de la fila GML-AM, así que M8 no duplica demanda, solo decide cómo se cubre; una compra al barrer se registra a nivel de marca y el sistema la reparte.

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Fila del flujo (`f`)** | Unidad de planificación `g` (nodo GML, o nodo × equivalencia si es GMLE) × agrupación de marca `a`: la misma fila GML-AM de M7, **sumando sus bloques** (mismas, nuevas, cierres). Universo: filas de la cerrada vigente. |
| **Último mes cerrado (`k`)** | `hasta_periodo` de la proyección cerrada que se lee (M7); el stock que arranca el flujo es el de fin de `k`. Si M5 publicó meses después de `k`, el flujo avisa `cerrada_atrasada` (M8 nunca recalcula M7). |
| **Horizonte** | Meses `k+1 … diciembre de Y+1`, con `Y` el `anio_en_curso` de la cerrada. Entre enero y la primera cerrada del año nuevo se lee la cerrada del año anterior (su año siguiente es `Y`) y el horizonte termina en diciembre de `Y` con aviso `horizonte_corto` (I6 de M7). |
| **Demanda (`D_m`)** | Unidades proyectadas de `f` en el mes `m` (meses `> k`), `Σ` de los bloques de la cerrada (`origen = proyectado`). Los meses `≤ k` muestran el real como historia. |
| **Demanda directa (`D^ic_m`)** | Parte de `D_m` que llega directo del intercompany (M13): `Σ_B D_m × part_B × pct_{B,g,m}`. **Demanda neta `D^n_m = D_m − D^ic_m`**: lo que hay que abastecer desde el CD. |
| **Parte al barrer de la demanda (`D^b_{B,m}`)** | `D_m × part_{barrido B}` por cada marca al barrer o mixta `B` con participación en `f` (`participaciones_historicas`): la demanda que se cubre con compras de marca repartidas. Informativa en el flujo por GML; es la base de la vista por marca al barrer. |
| **Stock inicial (`S_k`)** | Unidades de fin de mes `k` de `f` en **CD + tiendas** (todas las tiendas activas de tipo Tienda y los CD; sin ubicaciones ignoradas, que no existen como tiendas), clasificadas con `claveFlujo` (un stock de BETA en DENIM cuenta en DENIM × PREMIUM: está físicamente ahí). `S^cd_k` y `S^t_k` se muestran aparte. |
| **Ingreso (`I_m`)** | Unidades que llegan al CD (o a una tienda) en el mes `m` desde compras **confirmadas** y no recibidas: líneas específicas de `f` (GML/GMLE y marca de `a`, o agrupación `a`) más las filas de reparto de las líneas al barrer (M12) que caen en `g` con la agrupación de la marca. Una línea con llegada `≤ k` y no recibida es **atrasada**: cuenta en `k+1` con aviso `llegada_vencida`. Las recibidas ya están en el stock de M5 y no cuentan. |
| **Stock proyectado (`S_m`)** | `S_m = S_{m−1} + I_m − D^n_m` sin compras nuevas. Puede ser negativo (quiebre). |
| **Cobertura (`cob_m`)** | Meses de inventario **hacia adelante**: cuántos meses de demanda neta futura cubre `S_m`: el mayor `n` tal que `Σ_{j=m+1}^{m+n} D^n_j ≤ S_m`, más la fracción del mes siguiente. Más allá del horizonte, la demanda se extiende repitiendo los últimos doce meses proyectados (aviso `horizonte_extendido` solo en los últimos meses). `S_m ≤ 0` → 0. |
| **Objetivo mínimo y tope** | `obj_m = Σ_{j=m+1}^{m+MIN} D^n_j` (stock que cubre `MIN = 4` meses) y `tope_m = Σ_{j=m+1}^{m+MAX} D^n_j` (`MAX = 8`). Parámetros globales editables (`flujo_parametros`); por agrupación de marca o GML es segunda entrega. |
| **Saldo por comprar (`C_m`)** | Lo que **debe llegar** en `m` para cerrar `m` con al menos `obj_m`, contando lo ya sugerido antes: `C_m = max(0, obj_m − (S*_{m−1} + I_m − D^n_m))`, `S*_m = S*_{m−1} + I_m + C_m − D^n_m`, `S*_k = S_k`. Es "el hueco". |
| **Exceso (`X_m`)** | `max(0, S_m − tope_m)` (con el stock sin sugerencias): lo que sobra por encima de 8 meses. Aparece cuando una oportunidad pasó lo necesario. |
| **Señales** | `falta` si `cob_m < MIN`; `exceso` si `cob_m > MAX`; `quiebre` si `S_m < 0`; `sin_demanda` si `D^n = 0` en todo el horizonte (cobertura infinita, se muestra "—"). |
| **Compra** | Cabecera (proveedor, fecha, referencia, origen, estado, nota, quién) con **líneas**. Estados: `borrador` (no cuenta en el flujo), `confirmada` (cuenta), `recibida` (todo llegó; sale del flujo), `cancelada`. Recepción parcial por línea (`unidades_recibidas`). |
| **Línea de compra** | Qué se compró: nivel GML o GMLE (`genero_mundo_linea_id` + `equivalencia_id` opcional), **marca o agrupación de marca** (exactamente una), tallas (`centrales` / `extremas` / `ambas`), unidades, costo unitario y moneda, mes de llegada, destino (`cd`, una tienda, o `intercompany_directo` si la mercadería no pasa por el CD), nota. Una línea **al barrer** tiene marca (al barrer o mixta) y **sin GML**: el sistema la reparte. |
| **Reparto de una línea** | Filas `(g, unidades)` calculadas al confirmar con el reparto vigente de la marca (M12), guardadas con la versión usada; si después se aprueba otro reparto, la compra avisa `reparto_cambio` y el planner aplica el nuevo (patrón "la curva cambió"). |
| **"Lo mío"** | Para un comprador: las filas del flujo y las compras cuyo GML pertenece a una combinación género × mundo de la que es responsable (M1b); una línea al barrer es "mía" si su reparto toca alguna de mis combinaciones. Es un filtro, no un permiso (decisión de M1b). |
| **Proveedor** | Maestro que crea cualquier usuario: nombre único, país, ciudad/estado, RUC o identificación, banco y cuenta, `es_intercompany`, nota, contactos (nombre, cargo, teléfono, correo). |

### Por qué el flujo se calcula a demanda y no se guarda

Las entradas son pequeñas (≈ 1 700 filas × 15 meses de la cerrada, un agregado de stock de un mes, cientos de líneas de compra, decenas de reglas) y toda la aritmética es lineal: calcular el flujo completo cuesta milisegundos en TypeScript y cada compra confirmada lo cambia al instante. Guardarlo exigiría refrescos y candados (lo que 06b abandonó) para un dato derivado. Se guarda lo que es decisión: compras, repartos aplicados, parámetros. El "documento para compradores" es la exportación a Excel del flujo filtrado, generada en el navegador (patrón M7/M11).

### Por qué la compra no se asigna a un comprador

Javier: una compra al barrer puede cubrir marcas o GML de varios compradores. La cabecera guarda quién la registró (`perfil_id`, `usuario_nombre`) y las vistas "lo mío" se derivan del GML de cada línea (o del reparto) contra `responsables_genero_mundo`. Nadie queda sin poder ver ni registrar nada (decisión 12).

## 4. Flujo de pantalla (UX primero)

### 4.0 Lo que se toma de la referencia `COTBV2` y lo que se adapta

| Pieza de la referencia | Qué es allí | En Vector2 (M9) |
|---|---|---|
| **Tarjeta de necesidad** (`NeedCard`): género · mundo arriba en versalita, línea grande, agrupación, sello de estado (Pendiente / En curso / Completo / Sobre OTB), medidor tipo código de barras "comprado / OTB viaje", línea perforada, tres cifras abajo (saldo, FOB objetivo, FOB comprado) | OTB por viaje fijo | **Tarjeta de hueco**: género · mundo · línea (· equivalencia) · agrupación de marca; sello de estado del flujo (**Falta** / **Al día** / **Exceso** / **Quiebre**); medidor de **cobertura** con las marcas 4 y 8 (en vez de % de OTB); cifras: saldo por comprar de los próximos `N` meses (por defecto 6), stock CD + tiendas, en camino; línea perforada y sello se reproducen con el kit de Vector2 |
| **Declaración de compra** (`PurchaseForm`): formulario corto, necesidad fija o seleccionable, proveedor con autocompletado, producto, marca, marca agrupadora, modelo, unidades, FOB unitario, botón grande, sello "Borrador" | una línea = una compra | **Nueva línea de compra**: hueco prellenado desde la tarjeta (GML/GMLE + agrupación), proveedor (autocompletado + "crear"), marca **o** agrupación de marca, tallas (tres chips), unidades, costo unitario y moneda, llegada (mes), destino (CD por defecto), nota; se agrega a una **compra** (cabecera) en borrador; **Confirmar** al terminar; sello Borrador / Confirmada. Sin "producto" ni "modelo" (Vector2 planifica por GML, no por SKU; segunda entrega si Javier lo quiere como texto libre) |
| **Tablero** (`NeedsBoard`) con filtros género / mundo / línea / agrupación y tarjetas, **mobile first** | | **Huecos** (`/compras`): la misma idea, con chips Lo mío / Todos y Falta / Exceso / Todos; orden por saldo |
| **Pendientes** (`PendientesList`): tabla ordenable por comprador, género, mundo, línea, agrupación, unidades pendientes, cobertura | | **Pendientes**: filas del flujo con `falta` en los próximos `N` meses, con el **responsable** de M1b como columna, orden multinivel |
| **Proveedores** (`SupplierForm` + contactos, país/estado, RUC, banco) | | **Proveedores** con los mismos campos más `es_intercompany`; cualquier usuario los crea |
| **Historial de compra** (`PurchaseHistoryItem`), **tabla de compras** (`ComprasTable`) | | **Compras**: lista con filtros y detalle de líneas |
| **Dashboard del comprador** y **reporte por directorio** (árbol género → mundo → línea → agrupación con avance) | avance contra OTB | **Avance**: árbol género → mundo → línea con saldo por comprar, en camino y cobertura; el "avance" es cobertura, no % de OTB |
| **Exportaciones XLS**: resumen OTB vs comprado, detalle de compras, avance por género/mundo/línea/agrupación, compras por proveedor, FOB objetivo vs promedio | | Excel en el navegador: `FLUJO`, `SALDO`, `COMPRAS`, `POR_PROVEEDOR`, `COSTO` (costo medio por fila; sin FOB objetivo en la primera entrega) |
| Estilo: tipografías display / mono / body, colores ink, paper, brass, forest, alert, tarjetas con borde, sello, perforación | | Se reproducen **con el kit de Vector2** (`Card`, `Badge`, `Chips`, `DataTable`) y sus variables de tema claro/oscuro: una variante `Card` con perforación y un `Badge` tono sello; cifras con la fuente mono del kit; **no se importa su CSS ni sus fuentes**. Lo que no se adopta: campañas, OTB por viaje, FOB objetivo, asignación de comprador, "viewer" como rol |

### 4.1 Rutas y navegación

Sección nueva **Compras** en `nav.ts` (roles `TODOS`): `/compras` "Huecos" (`exact`), `/compras/flujo` "Flujo mensual", `/compras/registro` "Compras", `/compras/pendientes` "Pendientes", `/compras/proveedores` "Proveedores". Admin y planner ven además, dentro de Flujo, los parámetros (4 / 8 / `N`) y el importador con la casilla "carga inicial". El comprador abre en **Huecos** con "Lo mío" activo (criterio M1b). Filtros en la URL (`?genero=&mundo=&linea=&agrupacion_marca=&solo=&mio=1&meses=6`). Hook `use-flujo.ts` (patrón `useResponsables`); `useColeccion` para proveedores y compras (arrays). Formato `es-PE`.

### 4.2 Huecos (`/compras`, mobile first; todos los roles)

```
Huecos · datos hasta set-2026 · próximos [6 ▾] meses · (Lo mío) (Todos) · (Falta) (Exceso) (Todos)   [Género ▾] [Mundo ▾] [Línea ▾] [Agrup. ▾]
┌──────────────────────────────────────────────┐ ┌──────────────────────────────────────────────┐
│ HOMBRE · URBANO                      ⌈FALTA⌉ │ │ HOMBRE · FORMAL                     ⌈EXCESO⌉ │
│ DENIM                                        │ │ CAMISA › MANGA LARGA                         │
│ RECONOCIDO                                   │ │ PREMIUM                                      │
│ cobertura a set: 4,6 m  ▮▮▮▮▮▯▯▯  (4 · 8)    │ │ cobertura a set: 9,8 m  ▮▮▮▮▮▮▮▮▮▮ (4 · 8)   │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│ Saldo oct–mar   Stock CD+T   En camino        │ │ Saldo oct–mar   Stock CD+T   En camino        │
│   370 u           700 u        500 u (nov)    │ │     0 u         1 240 u      2 000 u (nov)    │
│ falta en oct (70) y desde feb   [Comprar]     │ │ exceso desde nov: 1 130 u     [Ver flujo]     │
└──────────────────────────────────────────────┘ └──────────────────────────────────────────────┘
```

La tarjeta resume el flujo de la fila: estado = la peor señal de los próximos `N` meses (`quiebre` > `falta` > `exceso` > `al_dia`); el medidor es la cobertura al fin de `k` con las marcas 4 y 8; "Saldo oct–mar" = `Σ C_m` de los próximos `N` meses; "En camino" = `Σ I_m` del horizonte con el primer mes; la frase dice en qué meses falta o desde cuándo sobra. **Comprar** abre la declaración de compra con la fila prellenada (4.4). Tocar la tarjeta abre el flujo de la fila (4.3) en una hoja. *Decide*: qué hueco atacar.

### 4.3 Flujo mensual (`/compras/flujo`, PC; todos los roles)

Tabla por fila del flujo con los meses del horizonte, la historia reciente a la izquierda en gris, y las cifras por mes:

```
Flujo mensual · cerrada "Proyección 2026–2027" (datos hasta set-2026) · parámetros: mín 4 · tope 8    Filtros: HOMBRE · URBANO · DENIM · RECONOCIDO   [Excel] [Parámetros]
HOMBRE · URBANO · DENIM × RECONOCIDO · stock a set-2026: CD 300 · tiendas 400 · total 700 · intercompany: —
                      jul-26 ago-26 set-26 │ oct-26  nov-26  dic-26  ene-27  feb-27  mar-27  abr-27 … dic-27
Venta real / demanda   1 600  1 580  1 410 │   150     150     150     160     160     160     160 …   183
  directo intercompany                     │     0       0       0       0       0       0       0 …     0
  demanda neta (del CD)                    │   150     150     150     160     160     160     160 …   183
  de la cual al barrer (BETA 12 %)         │    18      18      18      19      19      19      19 …    22
Ingresos (compras confirmadas)             │     0     500       0       0       0       0       0 …     0
Stock fin de mes (CD + tiendas)      700   │   550     900     750     590     430     270     110 …  −210
Cobertura (meses)                    4,6   │   3,6     5,7     4,7     3,7     2,7     1,7     0,7 …   0,0
Saldo por comprar (debe llegar)            │    70       0       0       0     140     160     160 …   183
Exceso (sobre 8 meses)                     │     0       0       0       0       0       0       0 …     0
Señal                                      │ falta    —       —      falta   falta   falta   quiebre … quiebre
Compras que llegan: nov-26 · C-000012 · Proveedor Norte · ALFA · centrales · 500 u · S/ 38,00 · confirmada        [Ver compra]
```

Cuadre del ejemplo: `S_oct = 700 − 150 = 550`; `cob_oct`: 150 + 150 + 160 = 460 ≤ 550 < 620 → `3 + 90/160 = 3,56`; `obj_oct = 150 + 150 + 160 + 160 = 620` → `C_oct = 620 − 550 = 70`; `S*_oct = 620`; nov: `S = 550 + 500 − 150 = 900`, `S* = 620 + 500 − 150 = 970`, `obj_nov = 630` → `C = 0`; `cob_nov`: 150 + 160 × 4 = 790 ≤ 900 < 950 → `5 + 110/160 = 5,69`; feb: `S*_ene = 970 − 150 − 160 = 660`, `obj_feb = 640` → `C = 0`… hasta que `S*` baja de `obj`: `C_feb = 640 − (660 − 160) = 140`. Sin la compra, `C_nov = C_dic = C_ene = C_feb = 160`: los 500 de la compra se restan del saldo de los meses siguientes a su llegada. La prueba del fixture fija cada celda. Filas desplegables: por **marca** (relevantes, otras, al barrer: la demanda por `participaciones_historicas`, los ingresos por la marca de la línea) y por **talla** (segunda entrega). Conmutador **Vista por marca al barrer**: una fila por marca `B` con `Σ_g D^b_{B,m}` (demanda al barrer), ingresos de sus compras al barrer, y `Σ_g C_m × part_{B,g}` como saldo sugerido de la marca (sección 5, paso 7). Totales por línea, mundo, género y compañía (sumas por mes). **Excel** (SheetJS en el navegador): hojas `FLUJO` (una fila por fila del flujo × concepto × mes), `SALDO` (fila × mes con `C_m` y señal), `COMPRAS` (líneas que llegan en el horizonte), `POR_PROVEEDOR`, `COSTO` (costo medio por fila y moneda), `PARAMETROS` (cerrada, `k`, 4/8, filtros). Nombre `flujo-AAAA-MM-DD.xlsx`. Es el **documento para compradores**. *Decide*: nada aquí; mira y exporta.

**Parámetros** (admin y planner): `Modal` con mínimo (4), tope (8), meses de la tarjeta (6), y "demanda más allá del horizonte: repetir los últimos 12 meses"; cambiarlos recalcula al instante (sin guardar flujo).

### 4.4 Compras (`/compras/registro`; todos los roles registran)

**Lista**: `DataTable` con número, fecha, proveedor, origen (comprador · carga inicial · intercompany CD), líneas, unidades, costo total por moneda, llegadas (rango de meses), estado (sello), quién, avisos (`reparto_cambio`, `llegada_vencida`, `exceso`, `sin_reparto`); filtros por estado, proveedor, origen, mes de llegada, género/mundo/línea, marca, "Lo mío", texto; Excel. **Nueva compra** y, en cada fila, **Abrir**.

**Detalle de una compra** (hoja a pantalla completa en el celular; dos columnas en PC): cabecera editable en borrador (proveedor con autocompletado y "+ crear proveedor", fecha, referencia, moneda, nota), y las líneas:

```
Compra C-000012 · Proveedor Norte · 2026-10-14 · ref. PO-2211 · PEN                                       ⌈BORRADOR⌉
┌ Declaración de compra · nueva línea ──────────────────────────────────────────────────────────────────────┐
│ Hueco      [HOMBRE ▾] [URBANO ▾] [DENIM ▾] [equivalencia: — ▾ (solo si el nodo es GMLE)]                 │
│            cobertura hoy 4,6 m · saldo oct–mar 300 u · en camino 500 u (nov)        ← se lee del flujo    │
│ Qué        (Marca) (Agrupación)   [ALFA ▾]  → agrupación RECONOCIDO (de la marca)                         │
│ Tallas     (Centrales) (Extremas) (Ambas)                                                                 │
│ Unidades   [  500 ]   Costo unitario [ 38,00 ] PEN     Llegada [nov-2026 ▾]    Destino [CD ▾]             │
│ Nota       [________________________]                                                                     │
│ Impacto: nov-26 pasa de cobertura 2,6 a 5,7 m · el saldo de nov–ene baja de 160 a 0 y el de feb a 140      │
│                                                                              [Agregar línea]              │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Líneas (2)
# GML / unidad                         Marca / agrup.   Tallas     Unid.  Costo u.  Llegada  Destino  Reparto / avisos
1 HOMBRE · URBANO · DENIM              ALFA (RECONOCIDO) centrales   500   38,00     nov-26   CD       —
2 (al barrer)                          BETA (PREMIUM)    ambas     1 000   22,50     dic-26   CD       reparto v2: DENIM 590 · POLO 293 · SANDALIA 117
Total 1 500 u · S/ 41 500,00                                                     [Guardar borrador] [Confirmar compra]
```

Reglas de la pantalla: una línea de **marca al barrer o mixta** admite dejar el hueco vacío (línea al barrer) y muestra el reparto vigente antes de agregarla; sin reparto vigente, la línea se guarda con aviso `sin_reparto` y no cuenta en el flujo hasta que M12 lo apruebe (la lista lo persigue); una **mixta con GML** es específica (entra a ese GML). **Impacto** se calcula en el navegador con el flujo ya cargado (sin llamada): cobertura antes y después en el mes de llegada, saldo que baja, exceso que aparece (en rojo si la línea pone la fila por encima de 8). **Confirmar** pide `confirm` con el resumen y, si alguna línea genera exceso, lo repite; la compra pasa a `confirmada` y entra al flujo. **Recepción**: en una compra confirmada, por línea "Recibida" o unidades recibidas parciales (lo recibido deja de contar; el stock real lo traerá M5 al publicar el mes). **Cancelar** (planner, o quien la creó mientras no esté recibida). **Compras del CD intercompany**: una compra normal con proveedor `es_intercompany` (origen `intercompany_cd`); sus líneas suelen ser de marca JH / Donatelli / VH y destino CD. *Decide*: qué, cuánto, a qué costo, cuándo llega.

### 4.5 Pendientes (`/compras/pendientes`)

Tabla de las filas del flujo con `falta` o `quiebre` en los próximos `N` meses: responsable (M1b), género, mundo, línea, equivalencia, agrupación, primer mes con falta, saldo acumulado, cobertura hoy, en camino; orden multinivel, chips "Lo mío"; Excel. Desde cada fila, **Comprar**.

### 4.6 Proveedores (`/compras/proveedores`)

Lista con buscador; alta y edición en `Modal` (nombre, país, ciudad/estado, RUC/identificación, banco, cuenta, `es_intercompany`, nota) y **contactos** (lista editable: nombre, cargo, teléfono, correo); desactivar (planner); el autocompletado de la declaración de compra crea un proveedor con solo el nombre y deja el resto para después.

### 4.7 Importar compras (`/compras/registro` → Importar)

Plantilla Excel nuestra, descargable con una fila de ejemplo: `PROVEEDOR`, `FECHA_COMPRA` (`aaaa-mm-dd`, opcional), `REFERENCIA` (opcional; agrupa líneas en una compra), `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA` (opcional; exige nodo GMLE), `MARCA` **o** `AGRUPACION_MARCA`, `TALLAS` (`CENTRALES` / `EXTREMAS` / `AMBAS`), `UNIDADES`, `COSTO_UNITARIO`, `MONEDA` (`PEN` / `USD`; por defecto PEN), `LLEGADA` (`aaaa-mm`), `DESTINO` (`CD`, código de tienda, o `DIRECTO`), `NOTA`. Mismo flujo de cuatro pasos (`use-importador`), `resolverGml` de 02b; crea **proveedores** nuevos (listados en `proveedores_a_crear[]`), nunca marcas ni árbol; una fila con `MARCA` de una marca al barrer y sin `GENERO/MUNDO/LINEA` es una línea al barrer; `REFERENCIA` vacía → una compra por proveedor y fecha. Omisiones: las de `resolverGml`, `marca_desconocida`, `marca_y_agrupacion` (las dos a la vez), `sin_marca_ni_agrupacion`, `agrupacion_desconocida`, `equivalencia_requiere_gmle`, `tallas_invalida`, `unidades_invalida`, `costo_invalido`, `llegada_invalida`, `destino_desconocido`, `gml_requerido` (marca sin tratamiento al barrer y sin GML), `duplicada_en_archivo`, `fila_total`. Avisos: `sin_reparto`, `llegada_pasada` (llegada `≤ k`: se importa como atrasada), `exceso`. Casilla **"Carga inicial de compras ya hechas"** (solo admin y planner): origen `carga_inicial`, estado `confirmada` al aplicar; sin la casilla, el importador crea compras en `borrador` a nombre de quien importa (el comprador las revisa y confirma). Idempotente por `(proveedor, referencia, fila)`: reimportar el mismo archivo no duplica (huella de fila guardada en `compra_lineas.huella_importacion`).

### Qué decide quién

| Decisión | Quién |
|---|---|
| Cuál cerrada de M7 alimenta el flujo | sistema (la más reciente que cubre el año; M7) |
| Mínimo 4, tope 8, meses de la tarjeta | planner (parámetros globales) |
| Cómo se reparte una compra al barrer | sistema con el reparto vigente de M12; el planner aplica una versión nueva |
| Qué demanda es directa del intercompany | sistema con M13 |
| Qué comprar, cuánto, a quién, cuándo llega, destino | **cualquier usuario** (comprador, planner, admin) |
| Confirmar, recibir, cancelar | quien registró o el planner |
| Proveedores | cualquier usuario crea y edita; el planner desactiva |

## 5. Método (lógica pura en `src/lib/flujo/` y `src/lib/compras/`, sin I/O)

Notación de la sección 3; `MIN = 4`, `MAX = 8`; meses del horizonte `m = k+1 … H`.

1. **Filas**: `filasFlujo(cerrada)`: una fila por `(g, a)` sumando `meses` de todos los bloques y tiendas de cada año de la cerrada (`Σ` de `FilaCerradaApi` con igual `gml_id`, `equivalencia_id`, `agrupacion_marca_id`); `D_m` para `m > k`; `participaciones` de la fila base.
2. **Demanda directa**: `D^ic_m = Σ_B D_m × part_B × pct_{B,g,m} ÷ 100` con `pctIntercompany` de M13 (solo reglas aplicables); `D^n_m = D_m − D^ic_m ≥ 0`.
3. **Stock**: `stockFila(stockK, configFlujo)`: cada fila de `stock_flujo(k)` pasa por `claveFlujo` → `(g, a)`; `S_k = Σ` (CD + tiendas); negativos a 0 por fila con aviso `stock_negativo`.
4. **Ingresos**: `ingresosFila(lineas, repartos)`: por línea confirmada y no cancelada con `pendiente = unidades − unidades_recibidas > 0`: específica → `(g, a)` de la línea con `a` = agrupación de la unidad de marca o la agrupación indicada; al barrer → sus filas de `compra_linea_repartos` (`g_i, u_i`), `a` = agrupación de la unidad de marca; destino `intercompany_directo` → **no** es ingreso (la demanda directa ya lo cubre; aviso `destino_directo` informativo); mes = `max(llegada, k+1)`; recibidas totalmente → 0.
5. **Proyección**: `S_m = S_{m−1} + I_m − D^n_m`; `cob_m = mesesCobertura(S_m, D^n_{m+1…})` con la demanda extendida más allá de `H` repitiendo `D^n_{H−11 … H}`; `obj_m`, `tope_m`; `C_m` y `S*_m` secuenciales; `X_m = max(0, S_m − tope_m)`; señales. `mesesCobertura(700, [150,150,150,160,160,…]) = 4,5625` (4 meses enteros = 610, resto 90/160).
6. **Impacto de una línea** `impacto(flujoFila, lineaNueva)`: el flujo de la fila con la línea añadida, y la diferencia por mes de `cob`, `C` y `X`; para una línea al barrer, por cada `g` del reparto.
7. **Vista por marca al barrer**: `D^b_{B,m} = Σ_g D_{g,a_B,m} × part_{barrido B}`; ingresos de las líneas al barrer de `B`; saldo sugerido `C^b_{B,m} = Σ_g C_{g,a_B,m} × part_{barrido B,g}` (la parte del hueco de cada GML que históricamente cubría `B`); informativo.
8. **Reparto de una línea** `repartirLinea(unidades, repartoVigente, mesLlegada)`: `repartirEntero` de M7 con pesos `participacion_vigente` (modo `anual`) o las del mes de llegada (modo `por_mes`); suma exacta; guarda `reparto_id` y `version`.
9. **"Lo mío"** `esMia(fila | linea, combinacionesDelUsuario)`: por `(genero_id, mundo_id)` del GML, o de cualquier `g` del reparto.
10. **Estados** `transicion(compra, accion, usuario)`: `borrador → confirmada` (≥ 1 línea válida), `confirmada → recibida` (todas las líneas recibidas), `borrador|confirmada → cancelada` (planner o creador, no recibida); editar líneas solo en `borrador`; en `confirmada` solo recepción y nota; `recibida` y `cancelada` inmutables.

Todo determinista, sin reloj (`k` y `hoy` entran como parámetros).

## 6. Modelo de datos (`0021_flujo_compras.sql`)

Convenciones de `0019`: idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`, sin `do $$`, sin backfill; `id uuid`, `activo`, `created_at`, `updated_at`; RLS sin políticas; `revoke`/`grant` por objeto; funciones `security invoker`, `stable`, `search_path` vacío. `create sequence if not exists public.compras_numero_seq`.

### 6.1 `proveedores`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `codigo` | `uuid pk`, `text null` | código opcional único sobre `upper` |
| `nombre` | `text not null` | único sobre `upper(nombre)`; 1–120 |
| `pais`, `ciudad` | `text null` | ≤ 80, normalizados como `zona` de M4 |
| `identificacion` | `text null` | RUC u otro, ≤ 40 |
| `banco`, `cuenta_bancaria` | `text null` | ≤ 120 |
| `es_intercompany` | `boolean not null default false` | las compras con este proveedor son origen `intercompany_cd` |
| `nota` | `text null` | ≤ 300 |
| `perfil_id → perfiles set null`, `usuario_nombre` | | quién lo creó |
| `activo`, `created_at`, `updated_at` | | `activo` con uso: inactivo no se ofrece en el autocompletado |

### 6.2 `proveedor_contactos`

`proveedor_id → proveedores on delete cascade` (índice), `nombre` (1–120), `cargo`, `telefono`, `correo` (≤ 120 cada uno, opcionales), `activo` por convención (quitar borra), timestamps.

### 6.3 `compras`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `numero` | `text not null default ('C-' \|\| lpad(nextval('public.compras_numero_seq')::text, 6, '0'))` | único |
| `proveedor_id` | `uuid not null → proveedores restrict` | índice |
| `origen` | `text not null default 'comprador'` | `check in ('comprador','carga_inicial','intercompany_cd')` |
| `estado` | `text not null default 'borrador'` | `check in ('borrador','confirmada','recibida','cancelada')`; índice |
| `fecha_compra` | `date not null default current_date` | |
| `referencia` | `text null` | ≤ 80; orden, factura, feria |
| `moneda` | `text not null default 'PEN'` | `check in ('PEN','USD')` |
| `nota` | `text null` | ≤ 500 |
| `confirmada_at`, `confirmada_por_id`, `confirmada_por_nombre`, `cancelada_at`, `cancelada_por_nombre`, `motivo_cancelacion ≤ 200` | | |
| `perfil_id → perfiles set null`, `usuario_nombre` | | quién la registró (no es "asignada a") |
| `activo`, `created_at`, `updated_at` | | `activo` por convención; se cancela, no se borra (borrar solo `borrador` sin líneas) |

### 6.4 `compra_lineas`

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `compra_id → compras on delete cascade` | | índice |
| `genero_mundo_linea_id` | `uuid null → genero_mundo_linea restrict` | **nulo solo en una línea al barrer** (`check (genero_mundo_linea_id is not null or marca_id is not null)`) |
| `equivalencia_id` | `uuid null → equivalencias restrict` | la API exige nodo `GMLE` y pertenencia al nodo |
| `marca_id` | `uuid null → marcas restrict` | la unidad de marca (la API resuelve un miembro a su cabeza y lo informa) |
| `agrupacion_marca_id` | `uuid null → agrupaciones_marca restrict` | `check ((marca_id is null) <> (agrupacion_marca_id is null))`: exactamente una |
| `tallas` | `text not null default 'ambas'` | `check in ('centrales','extremas','ambas')` |
| `unidades` | `integer not null` | `check > 0` |
| `unidades_recibidas` | `integer not null default 0` | `check between 0 and unidades` |
| `costo_unitario` | `numeric(12,4) null` | `check >= 0`; la moneda es la de la compra |
| `llegada_periodo` | `date not null` | primer día de mes (`check`); índice |
| `destino` | `text not null default 'cd'` | `check in ('cd','tienda','intercompany_directo')` |
| `tienda_id` | `uuid null → tiendas restrict` | `check ((destino = 'tienda') = (tienda_id is not null))` |
| `es_barrido` | `boolean not null default false` | `= genero_mundo_linea_id is null`; la API lo mantiene (un `check` cruzado lo valida: `check (es_barrido = (genero_mundo_linea_id is null))`) |
| `huella_importacion` | `text null` | único parcial `where not null`: idempotencia del importador |
| `nota` | `text null` | ≤ 200 |
| `avisos` | `jsonb not null default '[]'` | calculados por la API al guardar (`sin_reparto`, `exceso`, `llegada_pasada`, `miembro_resuelto`) |
| `activo`, `created_at`, `updated_at` | | |

Índices: `(genero_mundo_linea_id, llegada_periodo)`, `(marca_id)`, `(compra_id)`.

### 6.5 `compra_linea_repartos` (el reparto guardado de una línea al barrer)

`linea_id → compra_lineas on delete cascade` (índice), `reparto_id → repartos_marca_barrido restrict`, `reparto_version integer`, `genero_mundo_linea_id → genero_mundo_linea restrict`, `equivalencia_id null`, `unidades integer check >= 0`, `activo`, timestamps; único `(linea_id, genero_mundo_linea_id, coalesce(equivalencia_id, uuid cero))`. La suma por línea = `unidades` de la línea (lo verifica la API). `reparto_cambio` = `reparto_id` ≠ vigente de la marca.

### 6.6 `flujo_parametros`

Una fila por convención (`clave text not null default 'global'` único): `cobertura_min_meses numeric(4,1) not null default 4`, `cobertura_max_meses numeric(4,1) not null default 8` (`check max > min > 0`), `meses_tarjeta integer not null default 6` (`check between 1 and 24`), `extender_horizonte boolean not null default true`, `perfil_id`, `usuario_nombre`, `activo`, timestamps. **Sin seed por `insert`**: la API lee `coalesce(fila, defaults)`; la primera edición la crea (`insert … on conflict do nothing` + lectura; evita `UPDATE` en la migración).

### 6.7 Función `stock_flujo(p_periodo date) returns jsonb`

El stock de fin de mes `p_periodo` desde `venta_stock_vigente` (la carga publicada de ese mes), agregado por `equivalencia_id`, `unidad_marca_id` (vía `marcas_unidad`), `agrupacion_talla_id` y `tipo_tienda` (`'cd'` si `tiendas.tipo = 'Centro de Distribución'`, si no `'tienda'`), solo tiendas activas: `{ "periodo", "carga_id", "filas": [{ "equivalencia_id", "unidad_marca_id", "agrupacion_talla_id", "tipo": "cd"|"tienda", "stock_unidades" }] }`. ~15 mil filas, < 2 MB; `claveFlujo` se aplica en TS (necesita `equivalencia_id` para resolver el nodo y el nivel). Sin escritura.

### Diagrama

```
proyección cerrada (M7: D_m por GML-AM, participaciones por claveFlujo y talla) ──────────────────────────────┐
intercompany_reglas (M13: pct por marca × GML × mes) ─► D^ic ─► D^n = D − D^ic ─────────────────────────────┤
stock_flujo(k) (M5 + marcas_unidad; CD y tiendas) ─► claveFlujo ─► S_k por GML-AM ────────────────────────────┤
compras (borrador → confirmada → recibida | cancelada) ─► compra_lineas (GML/GMLE × marca|agrupación × tallas) ┤
   └─ líneas al barrer ─► compra_linea_repartos (reparto vigente de M12, versión) ─► I_m por GML-AM ──────────┤
flujo_parametros (mín 4, tope 8, meses tarjeta) ───────────────────────────────────────────────────────────────┴─► calcularFlujo (TS puro, a demanda)
                                                                                                                      │ S_m, cob_m, C_m (saldo), X_m (exceso), señales, impacto de una línea
                                                            Huecos (tarjetas) · Flujo mensual · Pendientes · Compras · Proveedores · Excel (documento para compradores)
```

## 7. Contratos de API y de lógica pura

Convenciones de siempre. Handlers en `src/app/api/flujo/` y `src/app/api/compras/`; lógica pura en `src/lib/flujo/` (`tipos-api.ts`, `tipos.ts`, `filas.ts`, `demanda.ts`, `stock.ts`, `ingresos.ts`, `cobertura.ts`, `modelo.ts`, `barrer.ts`, `mio.ts`, `excel.ts`) y `src/lib/compras/` (`tipos-api.ts`, `esquemas.ts`, `reglas.ts`, `reparto.ts`, `impacto.ts`, `importar.ts`, `proveedores.ts`); datos en `consultas.ts` de cada carpeta (los únicos que nombran `stock_flujo`, `leerProyeccionCerrada`, `leerRepartosVigentes`, `leerReglasIntercompany`).

**Guards.** M9 es el primer módulo en el que el **comprador escribe**: las rutas de compras y proveedores usan **`requireUser`** (los tres roles, activos), que es el guard que PLAN §3 prevé para "en Fase 3 registra sus compras". Lo que sigue siendo `requirePlanner`: parámetros del flujo, importador con `carga_inicial`, desactivar proveedores, cancelar compras ajenas. El flujo (`GET /api/flujo`) es `requireUser`: entrega **unidades**, nunca `venta_soles` ni costo vendido de M5 (el comprador no ve cifras de venta en soles, decisión de M5); el costo de las compras sí es visible para todos (lo registran ellos). La prueba estática de guards (`tests/api.guards.estatico.test.ts`) gana una lista blanca: bajo `/api/compras/**` y `/api/flujo` se admite `requireUser` también en escrituras; en el resto sigue la regla de QA pendiente (`requirePlanner` o `requireAdmin` en escrituras).

| Ruta | Método | Guard | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|---|
| `/api/flujo` | GET | `requireUser` | `?genero_id&mundo_id&linea_id&agrupacion_marca_id&solo=falta\|exceso\|quiebre&mio=1&por=fila\|marca_barrer&meses=6` | `{ datos: { cerrada: { id, nombre, hasta_periodo, anio_en_curso, cubre }, k, horizonte: string[], parametros, avisos: ("cerrada_atrasada"\|"horizonte_corto"\|"sin_cerrada")[] }, filas: FilaFlujoApi[], totales: TotalesFlujoApi, marcas_barrer?: MarcaBarrerFlujoApi[], mis_combinaciones: { genero_id, mundo_id }[] }`; `404 sin_cerrada` |
| `/api/flujo/huecos` | GET | `requireUser` | mismos filtros | `TarjetaHuecoApi[]` (resumen por fila para las tarjetas; orden por saldo desc) |
| `/api/flujo/parametros` | GET / PUT | `requireUser` / `requirePlanner` | `{ cobertura_min_meses: 0.5..24, cobertura_max_meses, meses_tarjeta: 1..24, extender_horizonte }` (`max > min`) | `ParametrosFlujoApi`; `409 rango_invalido` |
| `/api/compras` | GET / POST | `requireUser` | `?estado&proveedor_id&origen&llegada_desde&llegada_hasta&genero_id&mundo_id&linea_id&marca_id&mio=1&q`; `crearCompraSchema = { proveedor_id?: uuid, proveedor_nombre?: 1-120 (crea si no existe), fecha_compra?: date, referencia?: ≤ 80, moneda?: 'PEN'\|'USD', nota?: ≤ 500, origen?: 'comprador'\|'intercompany_cd' }` | `CompraApi[]` / `201 CompraApi` (borrador; `origen = intercompany_cd` se fija solo si el proveedor `es_intercompany`); `404 proveedor` |
| `/api/compras/[id]` | GET / PATCH / DELETE | `requireUser` | `editarCompraSchema` (cabecera; solo `borrador`, salvo `nota`) | `CompraApi` con líneas, repartos, avisos e `impacto_resumen`; `409 no_editable`; `DELETE` solo `borrador` sin líneas (`409`) |
| `/api/compras/[id]/lineas` | POST | `requireUser` | `lineaSchema = { genero_mundo_linea_id?: uuid\|null, equivalencia_id?: uuid\|null, marca_id?: uuid\|null, agrupacion_marca_id?: uuid\|null, tallas: 'centrales'\|'extremas'\|'ambas', unidades: int > 0, costo_unitario?: number ≥ 0 \| null, llegada_periodo: mes, destino: 'cd'\|'tienda'\|'intercompany_directo', tienda_id?: uuid\|null, nota?: ≤ 200 }` con `refine`: una de marca/agrupación; GML nulo solo con marca al barrer o mixta | `201 LineaCompraApi` (con `reparto[]` si es al barrer y `avisos`); `409 compra_no_editable`, `409 gml_requerido` (marca sin modalidad al barrer y sin GML), `409 equivalencia_requiere_gmle`, `409 equivalencia_de_otro_nodo`, `409 nodo_no_vigente`, `409 tienda_requerida`; un miembro de conjunto se guarda como su cabeza con aviso `miembro_resuelto` |
| `/api/compras/[id]/lineas/[lineaId]` | PATCH / DELETE | `requireUser` | `lineaSchema.partial()`; en `confirmada` solo `{ unidades_recibidas, nota }` | `LineaCompraApi`; `409` |
| `/api/compras/[id]/confirmar` | POST | `requireUser` | `{ acepta_exceso?: boolean }` | `CompraApi` `confirmada`; calcula y guarda repartos con el vigente; `409 sin_lineas`, `409 ya_confirmada`, `409 exceso_sin_aceptar` (si alguna línea genera `exceso` y no se aceptó: lista por línea y mes) |
| `/api/compras/[id]/recibir` | POST | `requireUser` | `{ lineas?: [{ linea_id, unidades_recibidas }] }` (vacío = todo) | `CompraApi` (`recibida` si todo llegó) |
| `/api/compras/[id]/cancelar` | POST | `requireUser` (creador) / `requirePlanner` (cualquiera) | `{ motivo: 1-200 }` | `CompraApi`; `409 recibida` |
| `/api/compras/[id]/aplicar-reparto` | POST | `requirePlanner` | `{ linea_ids?: uuid[] }` | reemplaza `compra_linea_repartos` de las líneas con `reparto_cambio` por el vigente; `{ aplicadas }` |
| `/api/compras/impacto` | POST | `requireUser` | `{ lineas: lineaSchema[] (1..50) }` | `ImpactoApi[]`: por línea y por `g`, cobertura, saldo y exceso antes y después (sin guardar; la pantalla lo calcula en el navegador con el flujo cargado y usa esta ruta solo si no lo tiene) |
| `/api/compras/importar` | POST | `requireUser` (`carga_inicial` exige `requirePlanner`) | `importarComprasSchema = { modo, carga_inicial?: boolean, filas: [...] (1..10 000) }` | reporte (`totales`, `compras_a_crear[]`, `proveedores_a_crear[]`, `lineas[]` con `estado`, `omitidas[]`, `avisos[]`) |
| `/api/compras/proveedores` | GET / POST | `requireUser` | `proveedorSchema = { nombre: 1-120, codigo?, pais?, ciudad?, identificacion?, banco?, cuenta_bancaria?, es_intercompany?: boolean, nota?: ≤ 300, contactos?: [{ nombre: 1-120, cargo?, telefono?, correo? }] (≤ 20) }` | `ProveedorApi[]` / `201`; `409 nombre_repetido` |
| `/api/compras/proveedores/[id]` | PATCH / DELETE | `requireUser` / `requirePlanner` | `proveedorSchema.partial()` (contactos se reemplazan completos) | `ProveedorApi`; `DELETE` = desactivar si tiene compras (`409` si se intenta borrar con compras), borrar si no |

```ts
export type Senal = "quiebre" | "falta" | "exceso" | "al_dia" | "sin_demanda";
export type MesFlujoApi = { periodo: string; real: boolean; demanda: number; directo_ic: number; demanda_neta: number; al_barrer: { marca_id: string; marca: string; unidades: number }[];
  ingresos: number; stock_fin: number; cobertura: number | null; objetivo_min: number; tope: number; saldo: number; exceso: number; senal: Senal; extendido: boolean };
export type FilaFlujoApi = { gml_id: string; equivalencia_id: string | null; agrupacion_marca_id: string; genero: string; mundo: string; linea: string; equivalencia: string | null; agrupacion_marca: string; nivel: "GML" | "GMLE";
  responsable: { perfil_id: string; nombre: string } | null; mia: boolean; stock_k: { cd: number; tiendas: number; total: number }; historia: { periodo: string; venta: number; stock_fin: number }[];
  meses: MesFlujoApi[]; resumen: { senal: Senal; cobertura_k: number | null; saldo_n_meses: number; en_camino: number; primer_mes_falta: string | null; exceso_desde: string | null };
  compras: { compra_id: string; numero: string; proveedor: string; linea_id: string; marca: string | null; agrupacion_marca: string; tallas: string; unidades: number; llegada: string; estado: string; es_barrido: boolean }[];
  avisos: ("intercompany_no_aplicable" | "sin_participaciones" | "stock_negativo" | "sin_curva")[] };
export type TarjetaHuecoApi = Pick<FilaFlujoApi, "gml_id" | "equivalencia_id" | "agrupacion_marca_id" | "genero" | "mundo" | "linea" | "equivalencia" | "agrupacion_marca" | "mia" | "responsable" | "stock_k" | "resumen">;
export type EstadoCompra = "borrador" | "confirmada" | "recibida" | "cancelada";
export type LineaCompraApi = { id: string; compra_id: string; gml_id: string | null; equivalencia_id: string | null; ruta: string | null; marca_id: string | null; marca: string | null; agrupacion_marca_id: string;
  agrupacion_marca: string; tallas: "centrales" | "extremas" | "ambas"; unidades: number; unidades_recibidas: number; costo_unitario: number | null; llegada_periodo: string; destino: "cd" | "tienda" | "intercompany_directo";
  tienda: { id: string; codigo: string } | null; es_barrido: boolean; reparto: { reparto_id: string; version: number; vigente: boolean; filas: { gml_id: string; equivalencia_id: string | null; ruta: string; unidades: number }[] } | null;
  nota: string | null; avisos: ("sin_reparto" | "reparto_cambio" | "exceso" | "llegada_vencida" | "llegada_pasada" | "miembro_resuelto" | "destino_directo")[] };
export type CompraApi = { id: string; numero: string; proveedor: { id: string; nombre: string; es_intercompany: boolean }; origen: "comprador" | "carga_inicial" | "intercompany_cd"; estado: EstadoCompra; fecha_compra: string;
  referencia: string | null; moneda: "PEN" | "USD"; nota: string | null; usuario_nombre: string | null; confirmada_at: string | null; lineas: LineaCompraApi[]; totales: { unidades: number; costo: number | null; recibidas: number };
  llegadas: { desde: string; hasta: string } | null; mia: boolean; puede: { editar: boolean; confirmar: boolean; recibir: boolean; cancelar: boolean }; avisos: string[] };
export type ProveedorApi = { id: string; codigo: string | null; nombre: string; pais: string | null; ciudad: string | null; identificacion: string | null; banco: string | null; cuenta_bancaria: string | null;
  es_intercompany: boolean; nota: string | null; activo: boolean; compras: number; contactos: { id: string; nombre: string; cargo: string | null; telefono: string | null; correo: string | null }[] };
export type ParametrosFlujoApi = { cobertura_min_meses: number; cobertura_max_meses: number; meses_tarjeta: number; extender_horizonte: boolean; usuario_nombre: string | null; updated_at: string | null };
```

Constantes (`src/lib/flujo/tipos.ts`): `COBERTURA_MIN = 4`, `COBERTURA_MAX = 8`, `MESES_TARJETA = 6`, `MESES_EXTENSION = 12`, `VERSION_METODO_FLUJO = 1`.

| Función pura | Archivo | Reglas |
|---|---|---|
| `filasFlujo(cerrada)` | `flujo/filas.ts` | 1 |
| `demandaNeta(fila, reglas, mes)` (usa `demandaDirecta` de M13) | `flujo/demanda.ts` | 2 |
| `stockPorFila(stockK, configFlujo)` | `flujo/stock.ts` | 3 |
| `ingresosPorFila(lineas, repartos, k)` | `flujo/ingresos.ts` | 4 |
| `mesesCobertura(stock, demandaFutura)`, `proyectarFila(fila, parametros)` | `flujo/cobertura.ts` | 5, 6, 7 |
| `calcularFlujo(entrada)` determinista; `resumenTarjeta(fila, n)`; `vistaMarcasBarrer(filas)` | `flujo/modelo.ts`, `flujo/barrer.ts` | 8, 9 |
| `esMia(fila, combinaciones)` | `flujo/mio.ts` | 10 |
| `hojasFlujo(filas, filtro)`, `hojasCompras(compras)` | `flujo/excel.ts` | 11 |
| `repartirLinea(linea, repartoVigente)` (usa `repartirEntero` de M7) | `compras/reparto.ts` | 12 |
| `impactoLinea(flujoFila(s), linea)` | `compras/impacto.ts` | 13 |
| `motivoRechazoLinea(linea, estado)`, `transicion(compra, accion, usuario)`, `puede(compra, usuario)` | `compras/reglas.ts` | 14, 15, 16 |
| `previsualizarImportacionCompras(filas, estado, opciones)` | `compras/importar.ts` | 17 |
| `motivoRechazoProveedor` | `compras/proveedores.ts` | 18 |

## 8. Reglas de negocio (vitest)

1. **Filas** = una por `(g, a)` de la cerrada; `D_m` = suma de bloques y tiendas; `Σ_f D_m` = total mensual de la cerrada (partición); `participaciones` de la fila base; fila sin curva (`meses = null`) → `sin_curva`, `D_m = 0` en lo proyectado y aviso.
2. **Demanda neta** `= D − D^ic ≥ 0`; `D^ic` solo con reglas aplicables (M13 regla 4); fila sin participaciones → `D^ic = 0` y aviso `sin_participaciones`.
3. **Stock**: CD + tiendas, clasificado por `claveFlujo` (BETA al barrer en DENIM cuenta en DENIM × PREMIUM; un miembro cuenta en su cabeza); negativos a 0 por fila con aviso; `Σ_f S_k` = stock total del mes sin negativos.
4. **Ingresos**: línea `borrador` → 0; `confirmada` con 500 y 200 recibidas → 300 en `llegada`; `llegada ≤ k` no recibida → cuenta en `k+1` con `llegada_vencida`; `recibida` → 0; `cancelada` → 0; destino `intercompany_directo` → 0 con `destino_directo`; al barrer → sus repartos, cada uno en su `g` con la agrupación de la unidad de marca; línea con `agrupacion_marca_id` → esa agrupación.
5. **Cobertura**: `mesesCobertura(700, [150,150,150,160,160])` = `4,5625`; `(0, …)` = 0; `(−10, …)` = 0; demanda futura toda 0 → `null` (`sin_demanda`); más allá del horizonte se repite el último año (`extendido = true` en los meses que lo usan).
6. **Saldo secuencial**: en el ejemplo de la sección 4.3, `C_oct = 70`, `C_nov = 0`, y `Σ_m C_m` sobre el horizonte deja `cob_m ≥ MIN` en todos los meses salvo donde la demanda futura es 0 (propiedad); añadir un ingreso en `m` nunca sube `C_j` para ningún `j` (monotonía).
7. **Exceso**: `X_m = max(0, S_m − tope_m)` con el stock **sin** sugerencias; una compra de 2 000 en nov con `tope_nov = 1 270` → `X_nov = 1 130` y `senal = exceso`; `quiebre` manda sobre `falta`, y `falta` sobre `exceso`, en el resumen de la tarjeta.
8. **Determinismo** de `calcularFlujo` y partición: `Σ_f (S_k + Σ I − Σ D^n) = Σ_f S_H` (balance).
9. **Vista por marca al barrer**: `D^b_{B,m} = Σ_g D_{g,a_B,m} × part_{barrido B,g}`; `C^b_{B,m}` = parte proporcional del saldo; `Σ_B C^b ≤ Σ_g C`.
10. **Lo mío**: fila con GML de HOMBRE × URBANO es mía si soy responsable de esa combinación; una línea al barrer es mía si algún `g` del reparto lo es; un planner sin combinaciones tiene "lo mío" vacío y la pantalla abre en Todos.
11. **Excel = pantalla**: hojas con las filas visibles y el filtro; `null` → vacío; `PARAMETROS` lleva cerrada, `k`, mín, tope.
12. **Reparto de una línea**: `repartirLinea(1 000, {DENIM 0,59, POLO 0,293, SANDALIA 0,117})` = `590 / 293 / 117` (suma exacta por `repartirEntero`); modo `por_mes` usa el vector del mes de llegada; sin reparto vigente → `reparto = null` y `sin_reparto`; marca mixta con GML en la línea → no se reparte (línea específica).
13. **Impacto**: añadir 500 en nov a la fila del ejemplo sube `cob_nov` de 2,56 (sin la compra: `S_nov = 400`, cubre dic y ene y 90/160 de feb) a 5,69, y baja `C_nov`, `C_dic` y `C_ene` de 160 a 0 y `C_feb` de 160 a 140 (cifras del fixture); una línea al barrer devuelve un impacto por `g`.
14. **Línea válida**: exactamente una de marca/agrupación; GML nulo solo si la marca es `barrido` o `mixta` (si no `gml_requerido`); equivalencia solo en nodo GMLE y del mismo nodo; destino `tienda` exige `tienda_id` de tipo Tienda activa; `unidades > 0`; `llegada` primer día de mes; un miembro se resuelve a su cabeza (`miembro_resuelto`).
15. **Transiciones**: `borrador → confirmada` exige ≥ 1 línea; `confirmada → recibida` cuando todas las líneas tienen `unidades_recibidas = unidades`; `cancelar` solo si no está `recibida` y (es el creador o es planner/admin); editar cabecera y líneas solo en `borrador`; en `confirmada` solo recepción y nota; `recibida` / `cancelada` inmutables (`409`).
16. **Confirmar con exceso**: si alguna línea produce `X_m > 0` en su fila (o en algún `g` del reparto) y el cuerpo no trae `acepta_exceso`, `409 exceso_sin_aceptar` con la lista; con `acepta_exceso` se confirma y la línea queda con aviso `exceso`.
17. **Importador**: una fila con `MARCA` y `AGRUPACION_MARCA` → `marca_y_agrupacion`; `EQUIVALENCIA` en nodo GML → `equivalencia_requiere_gmle`; `REFERENCIA` agrupa líneas en una compra por proveedor; sin referencia, una compra por proveedor y fecha; proveedores nuevos en `proveedores_a_crear`; reimportar el mismo archivo → 0 nuevas (huella); `carga_inicial` sin planner → `403`; con `carga_inicial` las compras nacen `confirmada` y origen `carga_inicial`; sin ella, `borrador` a nombre de quien importa.
18. **Proveedores**: nombre único sobre `upper`; desactivar con compras en vez de borrar; inactivo no aparece en el autocompletado; contactos ≤ 20.
19. **SQL (humo local)**: `0021` aplica dos veces; los `check` cruzados rechazan marca y agrupación a la vez, GML nulo con `es_barrido = false`, destino `tienda` sin tienda, `unidades_recibidas > unidades`; `numero` se asigna solo y es único; `stock_flujo` separa `cd` y `tienda`, suma miembros en la cabeza y excluye tiendas inactivas; `anon` no lee nada.
20. **Estático**: toda ruta bajo `/api/flujo` y `/api/compras` empieza con un guard (`requireUser` admitido por la lista blanca; `parametros` PUT, `aplicar-reparto`, `importar` con `carga_inicial` y `DELETE` de proveedores con `requirePlanner`); `src/lib/flujo/` y `src/lib/compras/` no importan `@supabase/*` fuera de `consultas.ts`; `GET /api/flujo` no selecciona `venta_soles` ni `costo_vendido`; `nav.ts` registra la sección Compras con `TODOS`.

## 9. Casos sintéticos (`tests/flujo.fixture.ts`, `tests/compras.fixture.ts`)

Reutiliza el árbol y las marcas de los fixtures de M7 y M12: `HOMBRE · URBANO · DENIM` (GML), `HOMBRE · CASUAL · POLO`, `MUJER · CASUAL · SANDALIA`, `HOMBRE · FORMAL · CAMISA` (GMLE: MANGA LARGA, MANGA CORTA); marcas ALFA (RECONOCIDO, relevante en DENIM), BETA (PREMIUM, al barrer, reparto v2 = DENIM 0,59 · POLO 0,293 · SANDALIA 0,117), GAMMA (RECONOCIDO, mixta: específica en CAMISA), JH (RECONOCIDO, relevante en CAMISA, intercompany 80 % desde 2026-01). Tiendas T01, T02, CD. Cerrada "Proyección 2026–2027" con `k = 2026-09`. Usuarios: planner P, comprador C1 (responsable de HOMBRE × URBANO), comprador C2 (HOMBRE × FORMAL y MUJER × CASUAL). Parámetros 4 / 8 / 6.

1. **Fila DENIM × RECONOCIDO**: `D` = 150 oct–dic 2026, 160 ene–nov 2027, 183 dic 2027; stock set: CD 300 + T01 250 + T02 150 = 700; sin intercompany. Sin compras: `S_oct = 550`, `cob_oct = 3,56`, `C_oct = 70`, `S*_oct = 620`; `C_nov = max(0, 630 − (620 − 150)) = 160`; … ; `S_dic27` negativo → `quiebre` desde el mes en que `S < 0`; tarjeta: `FALTA`, `saldo_n_meses = Σ C_oct..mar`, `primer_mes_falta = 2026-10`.
2. **Compra C-000012** (C1, Proveedor Norte, PEN) con la línea ALFA · DENIM · centrales · 500 · 38,00 · nov-2026 · CD: en `borrador` no cambia nada; al **confirmar**, `I_nov = 500`, `S_nov = 900`, `cob_nov = 5,69`, `C_nov = C_dic = C_ene = 0` (antes 160 cada uno) y `C_feb = 140` (antes 160); `exceso = 0`; `impacto` previo coincide con el flujo después.
3. **Compra con exceso**: línea ALFA · DENIM · 2 000 · nov → `X_nov = max(0, 2 400 − 1 270) = 1 130`, `senal = exceso`; `POST confirmar` sin `acepta_exceso` → `409 exceso_sin_aceptar` con `[{ linea, g: DENIM, mes: 2026-11, exceso: 1 130 }]`; con `acepta_exceso` → confirmada y aviso `exceso` en la línea; la tarjeta pasa a `EXCESO` con "exceso desde nov".
4. **Línea al barrer**: BETA · (sin GML) · ambas · 1 000 · dic · CD → `reparto` v2 `590 / 293 / 117`; `I_dic` de DENIM × PREMIUM = 590, POLO × PREMIUM = 293, SANDALIA × PREMIUM = 117; aprobar v3 de BETA (DENIM 0,70) → la línea queda `reparto_cambio`; `POST aplicar-reparto` (planner) → `700 / …`; C1 intentando `aplicar-reparto` → `403`.
5. **Marca sin reparto**: DELTA (al barrer, sin reparto vigente) · 300 → línea con `sin_reparto`, `reparto = null`, ingresos 0; aprobar un reparto en M12 y `aplicar-reparto` → entra.
6. **Mixta**: GAMMA · CAMISA › MANGA LARGA · 200 → específica (`es_barrido = false`), ingreso en CAMISA › MANGA LARGA × RECONOCIDO; GAMMA sin GML · 200 → al barrer con su reparto (solo DENIM, 1,0).
7. **Intercompany**: CAMISA › MANGA LARGA × RECONOCIDO con `D_oct = 1 200`, `part_JH = 0,40`, JH 80 % → `directo_ic = 384`, `demanda_neta = 816`; quitar la relevancia de JH en CAMISA → `intercompany_no_aplicable`, `directo_ic = 0`; línea JH · CAMISA · 500 · nov · `intercompany_directo` → ingreso 0 y `destino_directo`; la misma línea con destino CD (compra del CD intercompany, proveedor `es_intercompany`) → ingreso 500 y `origen = intercompany_cd`.
8. **Recepción**: C-000012 con `unidades_recibidas = 200` → `I_nov = 300`; `recibir` sin cuerpo → `recibida`, `I = 0`; `PATCH` de la línea en `recibida` → `409`.
9. **Atrasada**: línea con llegada ago-2026 confirmada y no recibida → cuenta en oct con `llegada_vencida`; importarla con `LLEGADA = 2026-08` → aviso `llegada_pasada`.
10. **Lo mío**: C1 ve `mia = true` en DENIM (HOMBRE × URBANO) y en la compra C-000012; la línea al barrer de BETA es mía para C1 (DENIM) y para C2 (SANDALIA); el planner con `mio=1` recibe lista vacía y la pantalla cae a Todos.
11. **Importador**: plantilla con 4 filas (ALFA·DENIM, BETA sin GML, GAMMA·CAMISA›MANGA CORTA, una con `MARCA` y `AGRUPACION_MARCA`) y proveedor nuevo "Feria Sur" → `proveedores_a_crear = ["Feria Sur"]`, `omitidas = 1` (`marca_y_agrupacion`), 2 compras (por referencia); aplicar como C1 → `borrador`; aplicar con `carga_inicial` como P → `confirmada`, `origen = carga_inicial`; reimportar → 0 nuevas; C1 con `carga_inicial` → `403`.
12. **Parámetros**: `PUT` mín 3 / tope 6 (planner) → la fila DENIM deja de tener `falta` en oct (`obj_oct = 460 ≤ 550`); `PUT` mín 8 / tope 6 → `409 rango_invalido`; C1 `PUT` → `403`.
13. **Horizonte corto**: solo la cerrada de 2025 (su siguiente es 2026) y `hoy` en ene-2027 → `GET /api/flujo` usa `cubre = siguiente`, horizonte hasta dic-2026, aviso `horizonte_corto`; sin ninguna cerrada → `404 sin_cerrada` y la pantalla lo explica.
14. **Cerrada atrasada**: publicar oct-2026 en M5 sin cerrar una proyección nueva → aviso `cerrada_atrasada` ("el stock del flujo es el de set-2026; cierra una proyección con datos hasta oct").
15. **Vista por marca al barrer**: BETA con `part_barrido` 0,12 en DENIM × PREMIUM y 0,30 en POLO × PREMIUM → `D^b_oct = 0,12 × D_DENIM×PREMIUM + 0,30 × D_POLO×PREMIUM`; `C^b` proporcional; sus ingresos = las líneas al barrer de BETA.
16. **Excel**: `hojasFlujo` con filtro HOMBRE deja solo filas de HOMBRE; `COMPRAS` lista la línea de C-000012; `POR_PROVEEDOR` agrupa por proveedor y moneda; `PARAMETROS` dice `4 / 8`.
17. **Proveedores**: crear "Proveedor Norte" con dos contactos; crear otro "proveedor norte" → `409 nombre_repetido`; `DELETE` con compras → desactiva (`activo = false`) y el autocompletado no lo ofrece; C1 `DELETE` → `403`; `POST /api/compras` con `proveedor_nombre: "Feria Sur"` crea el proveedor y la compra.

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · lint, tsc, vitest (más `tests/flujo.*` y `tests/compras.*`), build, `validar-migraciones-local.sh`; `0021` aplicada; tipos regenerados; `APP_VERSION = 0.13.0 · M8`.

**Prerrequisitos de Javier** · Una proyección **cerrada** en M7 con datos hasta el último mes publicado; repartos aprobados en M12 para las marcas al barrer con compras pendientes; reglas de intercompany en M13; compradores creados y las 40 combinaciones repartidas en M1b; la plantilla de carga inicial llena con las compras ya hechas; la lista de proveedores (puede ir dentro de la plantilla).

**Hito (sección I de `cowork-checklist.md`; ✍️ = pedir confirmación a Javier; usuarios: planner y comprador de prueba)**
1. Como comprador: la sección Compras aparece con sus cinco items; Huecos abre en "Lo mío" con las tarjetas de sus combinaciones; "Agrupaciones y marcas", "Proyección de unidades" y las demás pantallas de planificación siguen ocultas; `GET /api/flujo` responde unidades y ninguna cifra en soles de venta.
2. Huecos: en una tarjeta con `FALTA`, el medidor muestra la cobertura bajo 4; en una con `EXCESO`, sobre 8; tocar la tarjeta abre el flujo de la fila; cambiar "próximos meses" a 3 cambia los saldos.
3. Flujo mensual: elegir una línea con volumen y comprobar a mano una celda de cobertura y una de saldo con las cifras de la pantalla (stock fin de mes, demanda neta, objetivo mínimo); desplegar la fila por marca; ver "directo intercompany" en una fila de JH, Donatelli o VH; conmutar a "Vista por marca al barrer".
4. ✍️ Como comprador, desde una tarjeta con falta: **Comprar** → crear un proveedor nuevo desde el autocompletado, agregar una línea (marca, centrales, unidades = saldo, llegada en el mes con falta) y ver el **impacto** antes de agregar; guardar borrador: el flujo no cambia; **Confirmar**: el saldo de ese mes baja y la tarjeta cambia de estado.
5. ✍️ Agregar una línea de una **marca al barrer** sin GML y ver el reparto por GML antes de confirmar; confirmar; en el flujo, los ingresos aparecen en los GML del reparto.
6. ✍️ Registrar una compra que pase el tope en un mes: el `confirm` avisa del exceso; aceptar; la fila muestra `exceso` y la tarjeta `EXCESO`.
7. ✍️ Recibir parcialmente una línea y ver que los ingresos pendientes bajan; recibir todo y ver la compra `recibida`.
8. Pendientes: las filas con falta en los próximos meses con su responsable; ordenar por saldo; exportar.
9. ✍️ Importar la plantilla de **carga inicial** como planner (previsualizar: proveedores a crear, compras y líneas, omitidas con motivo; aplicar); reimportar y ver 0 nuevas; abrir una compra importada: origen "carga inicial", confirmada.
10. ✍️ Como planner, aprobar un reparto nuevo en M12 para una marca con compras confirmadas: la compra muestra `reparto_cambio`; "Aplicar reparto vigente" cambia las unidades por GML.
11. Parámetros: cambiar el mínimo a 3 (✍️) y ver menos faltas; volver a 4.
12. Exportar el flujo con un filtro de género: el Excel tiene las seis hojas y las mismas filas que la pantalla; Javier lo compara con el documento que hoy entrega a los compradores y anota qué columna falta.
13. En el celular (o con la emulación de Chromium, 390 px): recorrer Huecos → Comprar → Confirmar sin que ningún control quede fuera de la pantalla; anotar tiempos (> 3 s se reporta).
14. Javier revisa tres huecos que conoce: el saldo por comprar se parece a lo que compraría; donde no, anotar si la diferencia viene del stock, de la demanda de M7, de los parámetros 4/8 o de compras no registradas.

## 11. Alcance

**Primera entrega (`0.13.0 · M8`)**: flujo mensual a demanda por fila GML-AM con demanda de la cerrada, demanda directa del intercompany, stock CD + tiendas, ingresos de compras confirmadas (específicas y al barrer repartidas), cobertura, saldo por comprar, exceso y señales; parámetros 4 / 8 / meses de la tarjeta; Huecos (tarjetas, mobile first), Flujo mensual, Pendientes, Compras (cabecera, líneas, impacto, confirmar, recibir, cancelar, aplicar reparto), Proveedores con contactos, importador con plantilla y casilla de carga inicial; "lo mío"; Excel del flujo y de compras; vista por marca al barrer.

**Segunda entrega (`0.13.1`)**: desglose y saldo **por talla** (centrales / extremas con `participaciones_historicas.por_talla` y el stock por talla; hoy la talla de la línea se guarda y se muestra); parámetros por agrupación de marca o GML (p. ej. PREMIUM 3–6); **plazo de entrega por proveedor** y "fecha límite de compra" por mes; costo objetivo por fila (el FOB objetivo de la referencia); historial de recepciones por fecha; producto / modelo como texto libre en la línea; alertas (correo o PWA) al comprador responsable cuando una fila entra en falta; foto mensual del flujo para comparar "lo que decía el flujo en set" con lo que pasó; stock en tránsito por tienda (destino `tienda` hoy solo etiqueta); moneda con tipo de cambio.

**Fuera de alcance**: recalcular o repartir la demanda (M7); calcular repartos (M12) o porcentajes de intercompany (M13); cargar stock (M5); OTB por temporada y campañas (descartados por Javier); asignar compras a un comprador; que el comprador vea soles de venta.

## 12. Riesgos

- **Dependencia de la cerrada**: sin una proyección cerrada no hay flujo; entre el mes publicado y la nueva cerrada el stock de arranque se atrasa (`cerrada_atrasada`). Mitigación: el aviso y, si Javier lo pide, leer el stock del último mes publicado y la demanda de la cerrada desde ahí (una regla y su prueba).
- **Cobertura hacia adelante con horizonte finito**: en los últimos meses la cobertura usa demanda repetida del último año; se marca `extendido` y los parámetros permiten apagarlo (entonces la cobertura de los últimos meses se trunca y se muestra con "≥").
- **Saldo secuencial y lead time**: el saldo dice cuándo debe llegar, no cuándo comprar; sin plazo por proveedor (segunda entrega) el comprador lo estima.
- **Reparto al barrer**: un reparto malo mueve ingresos de GML; por eso se guarda la versión usada, se avisa y se aplica a mano.
- **Guards `requireUser` en escrituras**: primera vez en el sistema; la lista blanca de la prueba estática acota dónde se admite, y la auditoría de `seguridad` (opus) debe revisar estas rutas antes del hito (fuga de soles, borrar compras ajenas, proveedores).
- **Carga masiva sin transacción**: compras y líneas se insertan por tandas; un corte deja compras en `borrador` sin líneas, visibles y borrables (idempotencia por huella al reimportar).
- **Mobile**: el detalle de compra en el celular debe caber (una línea por pantalla); la PWA (`10-pwa.md`) entra justo después para instalarlo.
- **Volumen**: ~1 700 filas × 15 meses × 10 conceptos en el navegador (~250 mil celdas): la tabla pagina por línea (desplegables cerrados) y la tarjeta solo lleva el resumen.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M8: el flujo se calcula a demanda a partir de la proyección cerrada, el stock del último mes cerrado, las compras confirmadas, los repartos de M12 y las reglas de M13; no se guarda.** Descartado: tablas de flujo con refresco; que M8 recalcule demanda.
2. **M8: cobertura = meses de demanda neta futura que cubre el stock CD + tiendas; mínimo 4 y tope 8 como parámetros globales; el saldo por comprar es secuencial ("debe llegar en el mes") y el exceso se mide sin sugerencias.** Descartado: OTB por temporada; cobertura como stock ÷ promedio de venta pasada.
3. **M8: la demanda directa del intercompany se descuenta de la demanda (no es ingreso ni stock); las compras del CD intercompany son ingresos normales.**
4. **M9: una compra tiene cabecera y líneas; la línea es GML o GMLE × (marca o agrupación) × tallas; una línea al barrer no lleva GML y se reparte al confirmar con el reparto vigente, guardando la versión; "reparto cambió" se aplica a mano.** Descartado: una compra = una línea (la referencia); asignar comprador.
5. **M9: todos los roles ven y registran todo; "lo mío" se deriva de M1b; las escrituras de compras y proveedores usan `requireUser` con lista blanca en la prueba de guards; parámetros, carga inicial, aplicar reparto y desactivar proveedores siguen con `requirePlanner`.**
6. **M9: proveedores como maestro que crea cualquier usuario, con contactos y `es_intercompany`; se desactivan si tienen compras.**
7. **M9: una sola plantilla Excel para carga inicial y carga masiva; la casilla "carga inicial" (planner) confirma al aplicar; sin ella nace en borrador.**
8. **M9: look and feel del módulo del comprador tomado de `COTBV2` (tarjeta con sello y medidor, declaración de compra, pendientes, proveedores con contactos, exportaciones), reproducido con el kit y el tema de Vector2.** Descartado: importar su CSS, campañas, OTB por viaje, FOB objetivo (segunda entrega como costo objetivo), rol viewer.

**Cambios que integra el `documentador`**: PLAN §3 (el comprador "registra sus compras y crea proveedores" desde M9), PLAN §4 (tablas `proveedores`, `proveedor_contactos`, `compras`, `compra_lineas`, `compra_linea_repartos`, `flujo_parametros`, función `stock_flujo`, secuencia; migración `0021`; versión `0.13.0 · M8`), PLAN §5 (filas M8 y M9 reescritas: construidas juntas; la PWA después), PLAN §7 (plantilla de carga inicial, proveedores, compradores y combinaciones, respuestas a la sección 16), `cowork-checklist.md` sección I, `nav.ts`, ficha 10 (la PWA se prueba con Huecos y Comprar).

## 14. Orden de construcción y dependencias (M7, M12, M13, M8+M9)

```
M7 (0.10.0) ──► cerrada con participaciones ─────────────────────────────┐
M12 (0.11.0) ──► claveFlujo con mixta (antes de la primera cerrada que lea M8) ──► repartos vigentes ──┼──► M8 + M9 (0.13.0) ──► PWA
M13 (0.12.0) ──► reglas de intercompany (independiente de M12; solo necesita 02b) ─────────────────────┘
```

- **M12 primero** (Javier: antes de M8). Su cambio a `claveFlujo` toca las participaciones de M7: debe construirse **antes de cerrar la proyección** que M8 leerá; si M7 ya tuviera una cerrada, se cierra una nueva tras M12. La pantalla de análisis solo necesita M5, 02b, M6 y los factores de M7 (`factores_volumen_atipico`, ya aplicados en la `0018`): puede construirse en paralelo con la API y la pantalla de M7, con `datos` aplicando la `0019` después de la `0018`.
- **M13 segundo**, pequeño e independiente de M12 (depende de 02b y de que JH, Donatelli y VH sean relevantes); puede ir en paralelo con M12 por otro par `backend`/`frontend`.
- **M8 + M9 tercero**, cuando existan una cerrada de M7, al menos un reparto de M12 y las reglas de M13. Dentro de M8 + M9: paso A (`datos` `0021` + `backend` lógica pura de flujo y compras con los 17 casos), paso B (rutas y pantallas: Proveedores y Compras primero —el comprador puede empezar a registrar aunque el flujo no esté—, luego Huecos, Flujo, Pendientes, importador), paso C (`seguridad` sobre las rutas `requireUser`, `qa` con el hito, `documentador`). La **PWA** entra inmediatamente después (los compradores la usarán desde el celular).
- Migraciones: `0019` (M12), `0020` (M13), `0021` (M8 + M9); versiones `0.11.0 · M12`, `0.12.0 · M13`, `0.13.0 · M8` (si el orden real cambia, las etiquetas se asignan al cerrar cada entrega, como "la etiqueta `0.9.1` pasa a M3").

## 15. Entradas pendientes de Javier

- **Repositorio de referencia `COTBV2`: entregado el 2026-10-15** (clonado en solo lectura); la sección 4.0 resume qué se adopta. Falta que Javier confirme si quiere además "producto / modelo" como texto libre en la línea y el costo objetivo (FOB objetivo) por fila (segunda entrega).
- **Plantilla de carga inicial** llena (sección 4.7) y la lista de proveedores con contactos.
- **El documento que hoy entrega a los compradores** (columnas, orden), para que el Excel del flujo (sección 4.3) no deje fuera ningún campo.
- Compradores creados en `/usuarios` y las 40 combinaciones repartidas (M1b): sin eso "lo mío" está vacío.
- Respuestas a la sección 16.

## 16. Preguntas para Javier (siete; mientras tanto rige la recomendación)

1. **Cobertura hacia adelante.** ¿Los "meses de inventario" se miden contra la demanda **futura** proyectada (el stock de fin de octubre cubre noviembre, diciembre, enero… hasta agotarse), o contra la venta promedio de los últimos meses? **Recomendación: futura, porque es lo que compra; la de los últimos meses se muestra como referencia en el detalle.**
2. **Un solo mínimo y tope para todo.** ¿4 y 8 para todas las agrupaciones y líneas, o PREMIUM / importados con otro rango? **Recomendación: globales en la primera entrega, editables; por agrupación o GML en la segunda.**
3. **Saldo = "debe llegar en el mes".** ¿Prefieres que el saldo se exprese por mes de llegada (recomendado) o adelantado por un plazo de entrega del proveedor ("debe comprarse en")? **Recomendación: por llegada; el plazo por proveedor es segunda entrega.**
4. **Compras directas a tienda y mercadería que no pasa por el CD.** Una línea con destino `tienda` cuenta como ingreso del flujo (CD + tiendas); una con destino `intercompany_directo` no cuenta porque M13 ya descontó esa demanda. ¿Es así como lo piensas? **Recomendación: sí.**
5. **Confirmar con exceso.** ¿Una compra que pasa el tope se confirma igual con aviso (recomendado: la oportunidad manda y el flujo muestra el exceso), o debe aprobarla un planner?
6. **Quién puede cancelar y aplicar repartos.** **Recomendación: cancelar, quien registró o un planner; aplicar un reparto nuevo, solo el planner.**
7. **Cerrada atrasada.** Cuando M5 publica un mes y todavía no hay una cerrada nueva, ¿el flujo debe seguir con el stock de la cerrada (recomendado, con aviso) o arrancar con el stock recién publicado y la demanda de la cerrada desde ahí?

# 08b-1b · Fechas logísticas del embarque (los cuatro hitos, editables y con historial)

> **Estado (2026-11-05): especificada, sin construir.** Es una mejora de 08b-1 (ficha [08b](08b-agrupadores-de-compras.md), que manda en todo lo que esta no cambie; su §11 describe lo construido). La diseñó el `arquitecto` (opus) leyendo las migraciones `0032`, `0034` y `0036` (las versiones vigentes de las funciones son las de la `0036`) y el código de `src/lib/compras/agrupadores/**`. **Antes de construir**: Javier responde §9 y, por ser una ficha que toca funciones centrales de compras, pasa por el `arquitecto-revisor` (opus).
>
> **Pedido de Javier** (textual, sobre el mes de llegada de las compras): «déjalo para completar y tiene que ser editable, la logística no siempre es tan previsible, se demoran los pagos, los embarques, la aduana. Deberíamos marcar fecha de embarque, fecha prevista en puerto, fecha prevista en el área de conteo, fecha prevista de ingreso al stock».
>
> **Numeración.** Migración **`0038_fechas_logisticas_embarque.sql`** (la siguiente libre; ver §8.1 sobre el registro de PLAN §5) con `scripts/humo-0038.sql`. Versión sugerida **`0.17.0 · M8 b`** (§8.2). Decisiones propuestas **115 a 118** (§7). Commits `M8:`.
>
> Sin datos reales: proveedores, compradores (C1, C2), admin A, embarques y cifras son inventados, los mismos del fixture de 08b (`tests/agrupadores.fixture.ts`).

## 0. Punto de partida (qué hay hoy y qué no se reabre)

**Qué hay en Vector2** (`0032` + `0036`):

- `compra_embarques.fecha_salida_estimada date null`: se edita con `PATCH /api/compras/embarques/[id]` (`guardar_embarque`), **sin motivo**, y nunca mueve entregas.
- `compra_embarques.fecha_llegada_estimada date not null`: rotulada «Llegada al CD». Solo se cambia por `POST …/[id]/fecha` (`aplicar_movimiento_agrupador`, operación `cambiar_fecha`), **con motivo** obligatorio, vista previa y huella del plan.
- `compra_embarques.fecha_llegada_real date null`: la llenará 08b-2 al recibir.
- `periodo_llegada`: columna generada, `make_date(año, mes, 1)` de `coalesce(fecha_llegada_real, fecha_llegada_estimada)`. Es el mes que alinea las entregas (I2 y R5 de 08b; decisión 83).
- Check `compra_embarques_salida_llegada_check (salida <= llegada estimada)`. Hoy **bloquea** (`409 salida_despues_de_llegada`).
- Eventos en `compra_agrupador_eventos` (inmutable; `select, insert` desde la `0035`). `antes` y `despues` = `agrupador_foto_embarque()`, que ya guarda las dos fechas estimadas, la real y el periodo. El evento `crear` guarda las fechas iniciales.
- Aviso `atrasado`: embarque `planificado` o `en_transito` con `fecha_llegada_estimada < hoy` (`avisos.ts`).

**Qué no se reabre:**

- Decisión 2: el flujo es global.
- Decisiones 54 y 55: nadie confirma un ingreso por presunción.
- Decisión 60: escritura solo por funciones con `revision`.
- Decisión 83: la fecha del embarque alinea las entregas. **Esta ficha la precisa**: cuál de las fechas manda.
- Decisión 92: el comprador escribe agrupadores.
- Decisión 97: el importador de agrupadores solo crea.
- Decisión 98: asignaciones por unidades.
- Invariantes I1 a I5 de 08b §2.9.
- Orden de candados de la 94, con los modos de la `0036`: viajes y embarques `for no key update`, compras `for update`.
- Convenciones de migración: idempotente, sin `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ni `do $$`, sin backfill.

## 1. Objetivo

La logística de un embarque no es una fecha sino una cadena: sale, llega a puerto, llega al área de conteo del CD e ingresa al stock. Cada eslabón se atrasa por razones distintas (pagos, naviera, aduana, conteo). Este cambio le da al embarque **cuatro hitos de fecha**. Los cuatro se editan, y cada reprogramación queda con su motivo y su causa. Se ve qué tan atrasado va cada embarque y cuántas veces se reprogramó. **Solo la fecha de ingreso al stock decide el mes del flujo.** Además, una compra puede entrar **sin mes propio**: lo toma de su embarque, y se corrige moviendo el embarque.

## 2. Modelo de datos

### 2.1 Los cuatro hitos y su columna

| # | Hito (pantalla) | Columna | Nulable | Nueva | Mueve el flujo |
|---|---|---|:-:|:-:|:-:|
| 1 | **Embarque** («sale») | `fecha_salida_estimada` (existe) | sí | no | no |
| 2 | **Llega a puerto** | `fecha_puerto_estimada date null` | sí | **sí** | no |
| 3 | **Llega al área de conteo** (el CD donde se cuenta) | `fecha_conteo_estimada date null` | sí | **sí** | no |
| 4 | **Ingresa al stock** | `fecha_llegada_estimada` (existe) | **no** | no | **sí** (`periodo_llegada`) |
| 4' | Ingreso real (08b-2, «Recibir embarque») | `fecha_llegada_real` (existe) | sí | no | sí, si existe |

Columnas nuevas en `compra_embarques` (`alter table … add column if not exists`, sin default, sin backfill):

| Columna | Tipo | Notas |
|---|---|---|
| `fecha_puerto_estimada` | `date null` | No aplica a embarques `local`. La pantalla lo oculta. Si llega con dato, se acepta igual |
| `fecha_conteo_estimada` | `date null` | |
| `hito_confirmado` | `text null` | El último hito que **ya ocurrió**: zod `embarque`, `puerto` o `conteo`. Es secuencial: `puerto` implica que ya salió. El ingreso no va aquí, porque confirmarlo es «Recibir embarque» (08b-2). Catálogo en zod, sin `check` (convención) |

Columna nueva en `compra_agrupador_eventos`: `causa text null`, con el catálogo de §2.5 en zod. Se agrega con `add column if not exists`. Una columna nula sin default no reescribe la tabla ni toca su trigger de inmutabilidad, y los privilegios `select, insert` de la `0035` la cubren.

**Sin checks nuevos.** Un `add constraint` no es idempotente sin `do $$`. Las reglas las validan las funciones, y el humo las comprueba.

**`comment on`** nuevo en `fecha_salida_estimada` («fecha de embarque»), `fecha_llegada_estimada` («fecha prevista de **ingreso al stock**; manda `periodo_llegada`; antes de la `0038` se rotulaba llegada al CD») y `fecha_llegada_real` («ingreso real al stock, 08b-2»).

### 2.2 Por qué así (decisiones del modelo)

1. **Manda el ingreso al stock** (decisión 115). El flujo cuenta stock, y una unidad cuenta como stock cuando ingresa, no cuando toca puerto ni cuando entra al área de conteo. Si mandara el puerto, el flujo vería la mercadería semanas antes de poder venderla y los huecos saldrían más chicos de lo que son. Es además la misma fecha que 08b-2 confirma al recibir (`fecha_llegada_real`), así que la pareja estimada/real queda coherente.
2. **No hay «caer al hito anterior».** El ingreso al stock es **obligatorio** en el embarque, y los otros tres son opcionales. Se descartó derivar el mes de la siguiente fecha disponible (conteo, puerto, salida) por tres razones:
   - (a) Cuando falta el ingreso, la fecha anterior siempre lo adelanta, y el flujo mostraría el stock antes de tiempo sin que nadie lo vea.
   - (b) Haría falta cambiar la expresión de la columna generada `periodo_llegada` (en Postgres, `alter column … set expression` reescribe la tabla y pide revisar todas las funciones que la usan) o volver nula `fecha_llegada_estimada` (`drop not null`, contra la convención).
   - (c) Un mes que cambia solo porque alguien llenó la fecha de puerto movería entregas sin que nadie lo pidiera.

   En su lugar, la pantalla ofrece **«Usar la fecha anterior»** al lado del ingreso: copia la última fecha llena como punto de partida, a la vista y editable. Así es la persona la que decide el mes, nunca el sistema.
3. **No se renombra ninguna columna.** `fecha_llegada_estimada` pasa a significar «ingreso al stock previsto». Renombrarla rompería los cuerpos de las funciones de la `0032`, `0034` y `0036`, el humo, los tipos y la API, y la columna generada, el código `aamm##` (mes de esta fecha al crear), el importador y la vista previa ya la usan como «la que manda». El nombre nuevo vive en la API (§3) y en la pantalla. *Descartado*: renombrar, porque el costo es alto y el beneficio es solo de nombre; y crear una columna nueva que «manda» manteniendo la vieja como alias, porque exige un backfill `update` y dos fuentes de verdad.
4. **Migración sin pérdida y sin movimiento.** Los embarques que ya existen conservan salida e ingreso (la antigua «llegada»), y quedan con puerto y conteo vacíos. `periodo_llegada` no cambia, ninguna entrega se mueve y `agrupadores_desalineados()` da lo mismo antes y después. Si alguna de esas fechas era en realidad la llegada al área de conteo y no el ingreso, se corrige en pantalla con el motivo «corrección» (pregunta P4).
5. **Previsto o real: una sola columna, `hito_confirmado`, y no una fecha real por hito.** Lo mínimo que sirve para decir «atrasado» es saber si un hito ya ocurrió. Cuando ocurre, su fecha se corrige a la real (si hace falta) y se marca. Con tres columnas reales más (salida real, puerto real, conteo real) habría el doble de fechas que editar y sincronizar, y Javier no lo pidió. El ingreso real ya existe (08b-2). *Descartado*: una fecha real por hito; y un estado logístico nuevo que reemplace `planificado`/`en_transito` (rompería R13 y 08b-2).
6. **Los avisos de orden no bloquean** (salvo uno). Si una fecha posterior cae antes que una anterior, se avisa `orden_de_fechas` y se guarda igual: la logística real tiene excepciones (un conteo adelantado, un dato provisional). **La excepción** es salida > ingreso, que sigue **bloqueando** (`409 salida_despues_de_llegada`), porque el check de la `0032` existe en la base y quitarlo exige `DROP CONSTRAINT`. Además, físicamente no se puede ingresar algo al stock antes de que salga. Esto se aparta de «solo avisos»: ver §10, punto 3.
7. **El contador de reprogramaciones y el retraso se derivan, no se guardan.** Salen de `compra_agrupador_eventos` (cada evento tiene la foto antes y después con las cuatro fechas). Así no hay contadores que se desincronicen (es el criterio de 07e).

### 2.3 Funciones de la `0038`

Todas con `create or replace` **a partir de su versión de la `0036`**, misma firma, `security invoker`, `search_path = ''`, `revoke` a `public, anon, authenticated`, `grant execute` a `service_role` y `comment on` nuevo. **Ninguna toca viajes ni compras con un modo nuevo.**

| Función | Cambio |
|---|---|
| `agrupador_foto_embarque(uuid)` | Suma `fecha_puerto_estimada`, `fecha_conteo_estimada` y `hito_confirmado` a la foto. Así todo evento, el de crear incluido, guarda los cuatro hitos |
| `guardar_embarque(jsonb, integer, jsonb)` | **Al crear** acepta las cuatro fechas (el ingreso es obligatorio: `fecha_requerida`) y valida salida ≤ ingreso. **Al editar ya no escribe ninguna fecha**: conserva la que tenga la fila. Hoy `fecha_salida_estimada = v_salida` la vuelve nula si la API no la manda (§10, punto 5). Si llega una fecha distinta de la vigente → `fecha_por_movimiento` (el mismo motivo de hoy, ahora para los cuatro hitos) |
| `aplicar_movimiento_agrupador(jsonb, jsonb)` | La operación `cambiar_fecha` se amplía (§2.4). Las otras cinco operaciones no cambian. Un plan viejo con solo `fecha_llegada_estimada` se comporta exactamente como hoy (compatibilidad) |
| `cambiar_estado_agrupador(…)` | `volver_a_planificado` con `hito_confirmado` no nulo → `hito_confirmado` (`409`: «Este embarque ya salió: desmarca "ya salió" primero»). Nada más cambia |
| `importar_agrupadores(jsonb, jsonb)` | Lee `fecha_puerto_estimada` y `fecha_conteo_estimada` del lote y las inserta. La clave natural sin código sigue siendo (nombre, ingreso). Sigue solo creando (decisión 97) |
| **`agrupador_hitos_resumen(p_embarques uuid[])`** (nueva, `stable`, solo lectura) | Por embarque y por hito: la **fecha original** (el primer valor no nulo en sus eventos, empezando por `crear`), las **reprogramaciones** (eventos `editar` o `cambiar_fecha` en los que la fecha del hito tenía valor y cambió, incluido vaciarla) y la causa más frecuente. Devuelve `jsonb`. La usa `consultas.ts` para la lista y el detalle, sin traer los `jsonb` de los eventos a TypeScript |

### 2.4 `cambiar_fecha` ampliada (el corazón del cambio)

Plan (lo arma `planCambiarFechas`, puro, en `movimiento.ts`):

```
{ operacion: 'cambiar_fecha', motivo, causa, resumen,
  embarques: [{ id, revision,
                fecha_llegada_estimada?,          // ingreso (nunca null)
                fecha_salida_estimada?,           // la clave presente = valor nuevo (puede ser null)
                fecha_puerto_estimada?, fecha_conteo_estimada?,
                hito_confirmado? }],              // null | 'embarque' | 'puerto' | 'conteo'
  compras: [{ id, revision }], movimientos: [...], entregas: [...], repartos: [...] }   // solo si cambia el mes
```

En la función, después de bloquear los embarques (`for no key update`) y antes de bloquear las compras:

1. **Qué cambió.** Por cada hito presente en el plan, se compara con la fila. Si nada cambia (ni fechas ni `hito_confirmado`) → `sin_cambios` (`409`).
2. **Motivo y causa.** Son obligatorios si el plan **reprograma**: cambia una fecha que tenía valor, la vacía o baja `hito_confirmado`. **Completar** una fecha vacía o confirmar un hito no los exige (Javier: «déjalo para completar»). Sin ellos → `motivo_requerido` o `causa_requerida`.
3. **Estado.** El ingreso solo cambia en `planificado` o `en_transito` (como hoy). Salida, puerto, conteo y `hito_confirmado` también cambian en `recibido`: son datos históricos que se pueden corregir. En `cancelado`, nada (`embarque_no_editable`).
4. **Salida ≤ ingreso**, con los valores **finales** del plan: si se mueven las dos a la vez, no falla en el paso intermedio. Si se viola → `salida_despues_de_llegada`.
5. **Confirmar un hito**: la fecha de ese hito y la de los anteriores no son nulas (`fecha_requerida`) y la del hito es ≤ hoy en Lima (`(now() at time zone 'America/Lima')::date`; si no, `fecha_futura`). Confirmar `embarque` (o uno posterior) con el embarque `planificado` lo pasa a `en_transito` en la misma transacción, con el aviso `pasa_a_en_transito`.
6. **Recepciones vinculadas** (08b-2): igual que hoy. Solo si **cambia el mes** del ingreso → `embarque_con_recepciones`.
7. **Si el mes no cambia**, el plan llega sin compras ni movimientos: se escribe el embarque, su `revision` sube uno y queda **un** evento `cambiar_fecha` con `causa`. No se bloquea ninguna compra, no sube ninguna `compras.revision` ni se escribe en `compra_eventos`, y la huella del flujo no cambia (R5 ampliada).
8. **Si el mes cambia**, se sigue exactamente el camino de hoy: se bloquean las compras derivadas, se compara su revisión, se mueve con `agrupador_mover_entregas`, se verifican I1 a I3, I2 y I5, y se registran los eventos solo en las compras que cambiaron (§11.3 de 08b, hallazgo M1).

**Orden de candados** (sin cambio): embarque (`for no key update`), compras (`for update`, por `id`). No toma viajes. El `insert` del evento pide `key share` del viaje, que es compatible con el `no key update` de quien lo tenga (el argumento de la `0036`). `guardar_embarque` y `cambiar_estado_agrupador` siguen tomando viaje → embarque.

### 2.5 Causas de reprogramación (zod `CAUSAS_FECHA`, en `tipos.ts`)

| Valor | En pantalla |
|---|---|
| `pago` | Demora en el pago al proveedor |
| `produccion` | El proveedor no terminó a tiempo |
| `naviera` | Naviera, zarpe o transbordo |
| `aduana` | Aduana |
| `transporte` | Transporte local (puerto → CD) |
| `conteo` | Demora en el conteo del CD |
| `correccion` | Corrección de un dato mal puesto (no es atraso real) |
| `otro` | Otro (el motivo lo explica) |

Las reprogramaciones con causa `correccion` **no** cuentan en el contador de atrasos que se muestra, aunque sí quedan en el historial. Así, la pregunta P4 (fechas viejas que eran del conteo) no deja al embarque marcado como «reprogramado».

### 2.6 Pagos: causa, no campo (decisión 118, a confirmar en P2)

Javier dice «se demoran los pagos». El pago **no es del embarque**: es de cada compra con su proveedor, y un embarque consolida varios proveedores (decisión 98). Un campo «pago» en el embarque tendría la granularidad equivocada. Uno en la compra pide monto, moneda, fecha y estado del pago, que es un módulo financiero que nadie especificó. **Por eso, en esta entrega, `pago` es una causa de reprogramación**. Responde «¿cuánto se nos atrasa por pagos?» sin modelar pagos. Si Javier quiere la fecha de pago por compra, se especifica aparte (08c E2 ya trae `condiciones_pago` en el proveedor; el lugar natural es M9a).

### 2.7 Compras sin mes propio: el mes viene del embarque (decisión 117, a confirmar en P1)

«Déjalo para completar» se refiere a las compras de COTV (08c §12.8, G2), que no tienen mes de llegada. Hay dos formas de dejarlas sin mes:

| | **A · El mes viene del embarque (recomendada)** | B · Compra «por fechar» de verdad |
|---|---|---|
| Qué es | `LLEGADA` es opcional cuando la fila trae `EMBARQUE`. La entrega nace en el mes de ingreso de ese embarque. Para lo que no tiene fecha, Javier crea un embarque «por programar» por viaje con su mejor estimado de ingreso y luego lo reprograma o pasa sus compras a los embarques reales («Pasar pendientes», que ya existe) | La entrega queda **sin mes** (`periodo` nulo) y fuera del flujo hasta que alguien se lo ponga |
| Cambios en M8 | Ninguno en la base: solo el importador (TypeScript) | `drop not null` en `compra_linea_entregas.periodo` y en `compra_lineas.llegada_periodo` (contra la convención), un índice único parcial para una sola entrega nula por línea, y cambios en el flujo, en `pendientesPorEntrega`, en FIFO, en las recepciones, en el IMI, en `compra_recalcular_estado` y en la foto. Subir `VERSION_METODO_FLUJO` |
| En el flujo | La compra **cuenta** en el mes estimado del embarque, y un aviso dice que es una fecha por programar | La compra **no cuenta** en ningún mes: Huecos mostraría un hueco que ya está cubierto, con riesgo de comprar dos veces |
| Quién pone el mes | Javier, una vez por embarque, a la vista | Nadie hasta que se edite la compra (que es `0.13.1`, sin construir) |

Se elige **A**. Lo que pide Javier es «completar después y poder cambiarlo», no «que no cuente». Con A se completa al reprogramar el embarque, se cambia con historial, no se toca M8 y el flujo nunca queda ciego. Lo único que no cubre es una compra que de verdad no está en ningún embarque ni tiene un estimado. Para ese caso, la fila del importador sale omitida con un motivo claro (`llegada_invalida`: «Indica LLEGADA o un EMBARQUE»), como hoy.

**Un embarque «por programar»** no es un tipo nuevo. Es un embarque normal que se reconoce porque **no tiene ninguna fecha anterior al ingreso** (salida, puerto y conteo vacíos), y lleva el aviso informativo `fechas_por_completar` («Solo tiene la fecha de ingreso: completa el resto cuando la sepas»). Así sale solo, sin columna nueva.

### 2.8 Invariantes

I1 a I5 de 08b siguen iguales. I2 sigue siendo `entrega.periodo = embarque.periodo_llegada`, y `periodo_llegada` sigue dependiendo solo del ingreso. Se agregan:

| | Invariante | Dónde |
|---|---|---|
| **I6** | Un cambio de fechas que no cambia `periodo_llegada` no bloquea compras, no sube `compras.revision` y no escribe en `compra_eventos`. `flujo_huella_base()` queda idéntica | Función y humo |
| **I7** | `hito_confirmado` no nulo ⇒ las fechas de ese hito y de los anteriores no son nulas, y `estado ≠ 'planificado'` | Función (al escribir) y humo (sobre toda la tabla) |
| **I8** | Todo cambio de fecha o de `hito_confirmado` deja un evento con la foto antes y después. Si reprograma, el evento lleva `motivo` y `causa` | Función y humo |

## 3. Contratos de API

Los mismos guards y la misma forma que en 08b §3: guard primero, solo `supabaseAdmin()`, solo `.rpc(`, `ok({ … })` y `errorConCodigo`. **Todo es `requireUser`** (decisión 92: el comprador cambia fechas).

### 3.1 Esquemas zod (`src/lib/compras/agrupadores/esquemas.ts`)

```ts
const HITOS_CONFIRMABLES = ["embarque", "puerto", "conteo"] as const;          // tipos.ts
const CAUSAS_FECHA = ["pago","produccion","naviera","aduana","transporte","conteo","correccion","otro"] as const;

cambiarFechasSchema = z.strictObject({
  revision: z.number().int().min(0).max(MAX_REVISION),
  fecha_embarque: fechaIso.nullable().optional(),       // → fecha_salida_estimada
  fecha_puerto: fechaIso.nullable().optional(),         // → fecha_puerto_estimada
  fecha_conteo: fechaIso.nullable().optional(),         // → fecha_conteo_estimada
  fecha_ingreso: fechaIso.optional(),                   // → fecha_llegada_estimada (nunca null)
  hito_confirmado: z.enum(HITOS_CONFIRMABLES).nullable().optional(),
  motivo: z.string().trim().min(1).max(300).optional(), // obligatorio si reprograma: lo decide el servidor contra la fila
  causa: z.enum(CAUSAS_FECHA).optional(),               // ídem
  huella_plan,
}).refine(v => ["fecha_embarque","fecha_puerto","fecha_conteo","fecha_ingreso","hito_confirmado"].some(k => k in v), "sin_cambios");

// guardarEmbarqueSchema (alta) suma:
  fecha_puerto_estimada: fechaIso.nullable().optional(),
  fecha_conteo_estimada: fechaIso.nullable().optional(),
// y al EDITAR (PATCH) las cuatro fechas pasan a estar prohibidas si difieren de la vigente (409 fecha_por_movimiento).
```

En `fechaIso`, `null` significa «vaciar» y una clave ausente significa «no tocar». **La API habla con nombres de hito** (`fecha_embarque`, `fecha_puerto`, `fecha_conteo`, `fecha_ingreso`), y `consultas.ts` los traduce a las columnas. Se hace así para que nadie vuelva a leer «llegada» donde manda el ingreso.

### 3.2 Rutas

| Ruta | Método | Guard | Cuerpo | `{ data }` | Errores |
|---|---|---|---|---|---|
| **`/api/compras/embarques/[id]/fechas`** (nueva) | POST (`?previsualizar=1`) | `requireUser` | `cambiarFechasSchema` | Con `previsualizar`: `PlanFechasApi`. Si no: `RespuestaMovimientoApi` + `avisos` | 400 validación; 404 `no_encontrado`; 409 `sin_cambios`, `motivo_requerido`, `causa_requerida`, `salida_despues_de_llegada`, `fecha_requerida`, `fecha_futura`, `embarque_no_editable`, `embarque_con_recepciones`, `agrupador_cambio`, `plan_cambio`, `max_entregas`, `reparto_sin_vector` |
| `/api/compras/embarques/[id]/fecha` (existe) | POST | `requireUser` | `cambiarFechaSchema` (sin cambios) | ídem | **Alias de compatibilidad por una versión**: equivale a `/fechas` con solo `fecha_ingreso` y `causa = 'otro'`. Se retira en la entrega siguiente de compras (08b-2), anotado en CHANGELOG |
| `/api/compras/embarques` | POST | `requireUser` | alta con las cuatro fechas | `{ embarque }` | más `fecha_requerida` (sin ingreso) |
| `/api/compras/embarques/[id]` | PATCH | `requireUser` | sin fechas | `{ embarque }` | `409 fecha_por_movimiento` si trae una fecha distinta de la vigente. **Una fecha ausente ya no se vacía** |
| `/api/compras/embarques/[id]/estado` | POST | como hoy | `cambiarEstadoSchema` | `{ embarque }` | más `409 hito_confirmado` en `volver_a_planificado` |
| `/api/compras/embarques` | GET | `requireUser` | filtros de hoy + `reprogramados=1`. `atrasados=1` pasa a significar «algún hito vencido» (ver `hito_vencido` abajo) | `{ embarques }` con `hitos` | — |

**Reintentos**: los de 08b §3. Si el plan no mueve el mes, no hay compras y por lo tanto no hay `compra_cambio` ni reintento. Si lo mueve, se usa `huella_plan` con un solo reintento, igual que hoy.

### 3.3 Tipos (`tipos-api.ts`)

```ts
type Hito = "embarque" | "puerto" | "conteo" | "ingreso";
HitoApi { hito: Hito; fecha: string | null; confirmado: boolean;           // ingreso: confirmado = hay fecha_llegada_real
          fecha_original: string | null; retraso_dias: number | null;      // fecha actual − original, en días (diferencia neta)
          reprogramaciones: number;                                        // sin las de causa 'correccion'
          vencido: boolean;                                                // fecha < hoy (Lima), no confirmado, embarque no recibido ni cancelado
          manda_el_mes: boolean }                                          // true solo en 'ingreso'
EmbarqueApi += { hitos: HitoApi[4]; hito_confirmado; reprogramaciones_total; proximo_hito: { hito, fecha, vencido } | null }
PlanFechasApi = PlanMovimientoApi & { cambios: { hito, antes, despues, dias }[]; mueve_mes: boolean; mes_antes; mes_despues;
                                      reprograma: boolean /* exige motivo y causa */; avisos }
```

Los campos `fecha_salida_estimada` y `fecha_llegada_estimada` de `EmbarqueApi` **se conservan** (los usan el Excel, el importador y `avisos.ts`). `hitos` se suma a ellos.

### 3.4 Avisos nuevos (`AVISOS` en `tipos.ts`)

- `orden_de_fechas`, con `{ antes: Hito, despues: Hito }`: «La llegada a puerto (18-nov) es posterior a la llegada a conteo (15-nov)».
- `hito_vencido`, con `{ hito, fecha, dias }`: «Debía llegar a puerto el 08-nov (hace 4 días): ¿ya llegó?». Es el aviso que reemplaza en la lista al actual `atrasado`. `atrasado` se mantiene como el caso del hito `ingreso`.
- `fechas_por_completar` (§2.7).
- `pasa_a_en_transito`.
- `compra_sin_mes_propio` (en el reporte del importador de compras: «toma el mes de ingreso del Embarque 261101: nov-2026»).

### 3.5 Importador de agrupadores (08b §3.11)

| Columna | Embarque | Formato |
|---|---|---|
| `FECHA_SALIDA` | opcional | igual que hoy (es la fecha de embarque) |
| **`FECHA_PUERTO`** | opcional (ignorada en `LOCAL` con aviso) | `aaaa-mm-dd` o serie de Excel |
| **`FECHA_CONTEO`** | opcional | ídem |
| **`FECHA_INGRESO`** | **obligatoria** | ídem. **`FECHA_LLEGADA` se acepta como sinónimo** en el mapeo (`mapeo.ts`), así los archivos y plantillas viejos siguen sirviendo |

- `igual` o `cambiada` compara también puerto y conteo. Un archivo viejo, sin esas columnas, contra un embarque que ya las tiene: se toma vacío = «no dice nada», no `cambiada`. Un archivo que trae puerto para un embarque existente que no lo tiene da `cambiada_requiere_edicion`, porque el importador solo crea (decisión 97). Se completa en pantalla.
- Omisión nueva: ninguna. `orden_de_fechas` sale como **aviso** por fila. La plantilla y la hoja `AGRUPADORES` del Excel suman las dos columnas y cambian `FECHA_LLEGADA` por `FECHA_INGRESO`.

### 3.6 Importador de compras (08b §3.9, regla 3; matiza la decisión de «`LLEGADA` obligatoria con `EMBARQUE`»)

1. **Con `EMBARQUE` y sin `LLEGADA` ni `ENTREGAS`**, la línea toma **una** entrega en el `periodo_llegada` del embarque, con aviso `compra_sin_mes_propio`. El embarque tiene que existir y estar `planificado` o `en_transito`. Si no: `embarque_desconocido` o `embarque_no_editable`.
2. **Con `EMBARQUE` y `LLEGADA`**, sigue como hoy: tiene que caer en el mes del embarque (`llegada_distinta_del_embarque`).
3. **Sin `LLEGADA`, `ENTREGAS` ni `EMBARQUE`**: `llegada_invalida`, con el texto «Indica LLEGADA (aaaa-mm), ENTREGAS o un EMBARQUE con fecha de ingreso».
4. **Huella** (`huellaContenido`, `src/lib/compras/importar.ts`). Cuando el mes sale del embarque, las entregas de la huella llevan el **texto del archivo**, `[["EMBARQUE:<CODIGO>", unidades]]`, y no el mes resuelto. Así, reimportar después de reprogramar el embarque sigue dando `igual` (caso 15 de 08b), y cambiar el `EMBARQUE` en el archivo da `cambiada`. Es la única excepción a «las columnas de agrupador no entran en la huella», y existe porque aquí `EMBARQUE` **reemplaza** a `LLEGADA`.
5. **El orden** de 08b §3.9 no cambia (clasificar primero, reglas de agrupador solo a `nueva` e `igual` sin asignación, tres llamadas). Lo que cambia es el paso de validación de la fila: para una fila sin `LLEGADA` con `EMBARQUE`, resolver el embarque pasa **antes** de armar las entregas. `importar_compra` (SQL) no cambia: recibe ya el mes.
6. **`RECIBIDAS`** sigue su regla de M8 sobre el mes resuelto.

### 3.7 `compra_foto_entregas`, Flujo y Huecos

- `compra_foto_entregas` no cambia: las entregas no cambian de forma.
- El flujo no cambia de método (`VERSION_METODO_FLUJO` igual). Solo lo mueve un cambio del **mes de ingreso**, por el camino de hoy (I5, revisiones, huella).
- Huecos tampoco cambia. El aviso `fechas_por_completar` se ve en Viajes y embarques y en el detalle de la compra, **no** en el Flujo (fuera de alcance: vista del flujo por embarque, 08b §7).

## 4. Pantallas (kit de Vector2; `es-PE`; 390 px; lenguaje llano)

Los textos usan siempre estos nombres: **Sale · Llega a puerto · Llega a conteo · Ingresa al stock**. En los embarques `local` no aparece «Llega a puerto».

### 4.1 Alta de embarque (`modal-embarque.tsx`)

- Cuatro campos de fecha **en orden**, con «Ingresa al stock» obligatorio y la nota ⓘ «Esta fecha decide el mes en que la mercadería cuenta en el flujo».
- Junto a «Ingresa al stock», el botón **«Usar la fecha anterior»**: copia la última fecha llena.
- Avisos en línea (no bloquean): «La llegada a puerto es posterior a la llegada a conteo».
- Bloqueo: «La salida no puede ser posterior al ingreso al stock».
- **Editar** (`PATCH`) ya no tiene fechas: las muestra de solo lectura con el botón **«Cambiar fechas»**.

### 4.2 Diálogo «Fechas del embarque» (reemplaza `dialogo-fecha.tsx`)

| Hito | Ahora | Nueva fecha | ¿Ya ocurrió? |
|---|---|---|---|
| Sale | 05-oct-2026 ✓ | — | ☑ |
| Llega a puerto | 08-nov-2026 | [18-nov-2026] | ☐ |
| Llega a conteo | 15-nov-2026 | [ ] | ☐ |
| Ingresa al stock (manda el mes) | 20-nov-2026 | [03-dic-2026] | (se confirma al recibir) |

- **«¿Ya ocurrió?»** es secuencial: marcar puerto marca salida. Solo se puede marcar con una fecha que no sea futura.
- **Motivo** (1–300) y **Causa** (las de §2.5) aparecen y se vuelven obligatorios **solo si se reprograma** (cambiar o vaciar una fecha que tenía valor, o desmarcar). Completar fechas vacías no los pide.
- **Vista previa** (`?previsualizar=1`), antes de guardar:
  - «Ingresa al stock: 20-nov → 03-dic (+13 días). **Cambia el mes: mueve 12 líneas de 5 compras de nov-26 a dic-26 en el flujo.** 1 línea recibida no se mueve.»
  - o «Estas fechas no cambian el mes: el flujo no se mueve.»
  - Más los avisos de orden y de temporada (`cambia_temporada`).
- Errores en llano:
  - «Este embarque ya tiene ingresos confirmados: el mes de ingreso no se puede cambiar. Pasa lo que falta a otro embarque.»
  - «No puedes marcar como ocurrida una fecha futura.»
  - «Cambió el embarque mientras editabas: vuelve a abrirlo.»

### 4.3 Línea de tiempo (detalle del embarque, debajo de la cabecera)

Cuatro hitos en fila (en vertical a 390 px), con una marca de «hoy». Cada uno muestra:

- La fecha.
- El estado: ✓ ocurrió, previsto, o **vencido** («debía ocurrir hace 4 días»).
- El **retraso** contra lo planeado al crear: «+10 d».
- El número de cambios: «2 cambios», que lleva al historial filtrado.

«Ingresa al stock» va resaltado como el que manda el mes. Embarque por programar: «Solo tiene la fecha de ingreso: completa el resto cuando la sepas».

### 4.4 Lista de Embarques (Viajes y embarques)

- **Columnas**: Sale · Puerto · Ingresa al stock (con el mes) · **Próximo hito** («Llega a puerto 18-nov» o «Vencido: puerto 08-nov») · **Reprogramado** (badge «×3», que muestra la última causa al pasar el puntero o al tocarlo). «Llega a conteo» va en la tarjeta y en el detalle, no en la tabla.
- **Filtros**: «Atrasados» (algún hito vencido) y «Reprogramados» (nuevo).
- **Celular**: tarjeta con código y nombre, «Ingresa al stock 03-dic (dic-26)», próximo hito y badges.

### 4.5 Viajes, Compras y Sin agrupador

- **Detalle del viaje**: la lista de sus embarques con las mismas columnas de §4.4.
- **Detalle de compra** (`/compras/registro`): el chip de cada entrega con embarque suma «ingresa 03-dic · reprogramado ×2». Al tocarlo se abre la línea de tiempo del embarque en solo lectura.
- **Reporte del importador de compras**: la fila sin `LLEGADA` dice «Toma el mes de ingreso del Embarque 261101 (nov-26)».
- **Sin agrupador** no cambia.

### 4.6 Historial

El evento `cambiar_fecha` se lee en llano, por hito: «C1 cambió las fechas · Causa: Aduana · "Retenido por aforo físico" · Puerto 08-nov → 18-nov · Ingreso 20-nov → 03-dic (movió 5 compras de nov a dic)». Completar una fecha vacía: «C1 completó la llegada a conteo: 25-nov». Los eventos viejos (`editar` con salida distinta) se muestran como «cambió la salida (sin motivo: anterior a la 0.17)».

### 4.7 Qué ve cada rol

Los tres roles ven y usan todo lo de esta ficha (decisión 92). No hay nada solo de admin y planner, salvo lo que ya lo era (cancelar, cerrar, reabrir).

## 5. Reglas de negocio (cada una con su prueba en vitest)

| # | Regla |
|---|---|
| F-R1 | El mes del flujo de un embarque sale solo del ingreso (estimado o real): `periodoLlegada(real, ingreso)`. Cambiar salida, puerto, conteo o `hito_confirmado` nunca cambia `periodo_llegada` ni toca compras (I6) |
| F-R2 | Reprogramar (cambiar o vaciar una fecha con valor, o bajar `hito_confirmado`) exige motivo y causa. Completar una fecha vacía o confirmar un hito no los exige |
| F-R3 | Salida ≤ ingreso con los valores finales del plan: bloquea. Cualquier otro desorden entre hitos solo avisa `orden_de_fechas` |
| F-R4 | Confirmar un hito exige su fecha y la de los anteriores, con la del hito ≤ hoy en Lima. Es secuencial. Si el embarque estaba planificado, lo pasa a en tránsito. `volver_a_planificado` con un hito confirmado da `hito_confirmado` |
| F-R5 | El ingreso solo cambia en `planificado` o `en_transito`. Los demás hitos también cambian en `recibido`. Nada cambia en `cancelado`. Con recepciones vinculadas, el ingreso cambia solo dentro del mismo mes |
| F-R6 | Reprogramaciones por hito = eventos en los que la fecha tenía valor y cambió, sin contar la causa `correccion`. El retraso es la fecha actual menos la original, que es la primera no nula en los eventos |
| F-R7 | `hito_vencido`: fecha < hoy, hito no confirmado y embarque ni recibido ni cancelado. Para el ingreso equivale al `atrasado` de hoy |
| F-R8 | `PATCH` del embarque no cambia ni vacía fechas: si trae una distinta, da `fecha_por_movimiento`, y si no la trae, la conserva |
| F-R9 | Importador de compras: con `EMBARQUE` y sin `LLEGADA`, el mes es el del embarque, con una sola entrega. La huella usa `EMBARQUE:<código>`. Reimportar después de reprogramar da `igual` |
| F-R10 | Importador de agrupadores: `FECHA_INGRESO` obligatoria (o su sinónimo `FECHA_LLEGADA`), puerto y conteo opcionales, solo crea, y un archivo viejo sigue dando `igual` |
| F-R11 | La `0038` no mueve nada: antes y después, mismas `periodo_llegada`, mismas entregas y `agrupadores_desalineados()` igual |
| F-R12 | El alias `/fecha` se comporta como `/fechas` con solo el ingreso y `causa = 'otro'` |

### Casos numéricos (fixture de 08b; hoy = **2026-11-12**; `k' = 2026-09`)

**Embarque 261101** (importación, viaje 261001). Lo crea C1 con:

- sale 05-oct-2026
- puerto 08-nov-2026
- conteo 15-nov-2026
- ingreso 20-nov-2026 → `periodo_llegada` nov-26

Asignaciones: l1 de C-000101 (nov 300 → P261101) y C-000102 (POLO, nov 400). Además: **261201** (ingreso 10-dic-2026) y **261102** (local, ingreso 05-nov-2026).

| # | Acción | Resultado esperado |
|---|---|---|
| F1 | Crear con solo ingreso 20-nov | Código `2611##` y aviso `fechas_por_completar`. Crear sin ingreso → `fecha_requerida` |
| F2 | Hoy 12-nov, sin confirmar nada | Puerto `hito_vencido` (hace 4 días). Conteo e ingreso no. Salida vencida desde el 05-oct. Próximo hito: «Vencido: sale 05-oct» |
| F3 | C2 marca «ya ocurrió» la salida (05-oct), sin motivo | `hito_confirmado = 'embarque'`, estado `planificado → en_transito` (`pasa_a_en_transito`), revisión del embarque +1, compras sin cambio |
| F4 | C1 cambia el puerto a 18-nov, causa `naviera`, motivo «Transbordo en Callao» | Aviso `orden_de_fechas` (puerto 18-nov > conteo 15-nov) y se guarda. Compras: misma `revision`, sin `compra_eventos`. `flujo_huella_base()` idéntica (I6). Puerto: reprogramaciones 1, retraso +10 d |
| F5 | Lo mismo sin causa | `409 causa_requerida`. Sin motivo: `409 motivo_requerido` |
| F6 | Completar el conteo vacío de un embarque viejo (salida e ingreso, sin puerto ni conteo) con 25-nov, sin motivo | OK. Evento «completó». Reprogramaciones 0 |
| F7 | Cambiar el ingreso a 28-nov (mismo mes), causa `aduana` | No mueve nada (R5 de 08b). Ingreso: reprogramaciones 1, retraso +8 d |
| F8 | Cambiar puerto a 25-nov, conteo a 01-dic e ingreso a 03-dic en **un** envío, causa `aduana` | Cambia el mes: l1 pasa a dic 500 (se funde con la dic 200 de 261201, `entregas_fusionadas`) y POLO pasa a dic 400. Las dos compras con `revision` +1 y su evento. Un solo evento de embarque con los tres hitos. Ingreso: reprogramaciones 2, retraso +13 d |
| F9 | Volver el ingreso a 18-nov, causa `correccion` | l1 vuelve a nov 300 · dic 200 **con los mismos `id`** de entrega (caso 4 de 08b). El contador visible del ingreso **no** sube (correccion). El retraso se recalcula: −2 d |
| F10 | Salida 2026-12-10 con el ingreso en 03-dic | `409 salida_despues_de_llegada`. Salida 10-dic más ingreso 20-dic en el mismo envío: OK, y mueve al mes dic |
| F11 | Marcar «ya llegó a puerto» con puerto 18-nov (futuro respecto de hoy 12-nov) | `409 fecha_futura`. Con puerto 10-nov: OK, `hito_confirmado = 'puerto'` |
| F12 | `volver_a_planificado` con `hito_confirmado = 'embarque'` | `409 hito_confirmado`. Desmarcar (motivo y causa `correccion`) y luego volver: OK |
| F13 | Embarque con una recepción vinculada (en el humo se inserta como `postgres`, porque 08b-2 no existe): cambiar el ingreso de mes | `embarque_con_recepciones`. Cambiar el puerto: OK. Cambiar el ingreso dentro del mes: OK |
| F14 | Embarque cancelado: cualquier fecha | `embarque_no_editable` |
| F15 | `PATCH` con nombre nuevo y sin `fecha_salida_estimada` | La salida **se conserva** (regresión de §10, punto 5). Con una salida distinta → `409 fecha_por_movimiento` |
| F16 | Aplicar la `0038` sobre el fixture de 08b ya cargado | Las mismas `periodo_llegada`, entregas y asignaciones. Puerto y conteo nulos. `agrupadores_desalineados() = 0`. La aplica dos veces sin error |
| F17 | Importar agrupadores con `FECHA_LLEGADA` (archivo viejo) | Se lee como ingreso. Reimportar → `igual`. Con `FECHA_PUERTO` para un embarque existente sin puerto → `cambiada_requiere_edicion`. Con `TIPO_EMBARQUE = LOCAL` y puerto → aviso, puerto ignorado |
| F18 | Importar compras: fila `EMBARQUE = 261101`, `LLEGADA` vacía, 250 u | Entrega nov 250 asignada, aviso `compra_sin_mes_propio`. Reprogramar 261101 a dic y reimportar → `igual`. Misma fila con `EMBARQUE = 261201` → `cambiada`. Sin `LLEGADA`, `ENTREGAS` ni `EMBARQUE` → `llegada_invalida` con el texto nuevo. `EMBARQUE` de un embarque cancelado → `embarque_no_editable` |
| F19 | Dos pestañas cambian fechas de 261101 | La segunda: `agrupador_cambio` |
| F20 | Alias `/fecha` con 03-dic y motivo | Igual que F8 con solo el ingreso. Evento con `causa = 'otro'` |
| F21 | Permisos | C1 y C2 (compradores) usan `/fechas` → 200. Sin sesión → 401. Los guards en `tests/api.guards.roles.test.ts` |

**Concurrencia** (`tests/integracion/concurrencia.int.test.ts`, con compuerta determinista como en la `0036`; ningún caso debe dar `40P01`):

- **(a)** `/fechas` que cambia el mes (embarque, compras) contra `asignar_viaje_compras` (viaje, compras) con una compra compartida y el embarque dentro del viaje. Una espera a la otra, la segunda devuelve `compra_cambio` o se aplica después, y no hay ciclo (el evento pide `key share` del viaje).
- **(b)** `/fechas` sin cambio de mes contra `guardar_embarque` del mismo embarque (viaje, embarque). Se serializan y la segunda da `agrupador_cambio`.
- **(c)** `/fechas` contra `cambiar_estado_agrupador('cancelar')`. Uno gana y el otro da `agrupador_cambio` o `embarque_no_editable`.
- **(d)** `/fechas` contra `importar_compra` de una compra del embarque. Las compras van `for update` por `id` y no hay ciclo.

**Humo `scripts/humo-0038.sql`**: F3, F4, F8, F9, F10, F11, F12, F13 y F16 a nivel SQL, I6 a I8, aplicar dos veces, privilegios (`agrupador_hitos_resumen` solo `service_role`) y registro en `migraciones_aplicadas`.

## 6. Criterios de aceptación / hito de prueba

- [ ] La `0038` aplica dos veces. El humo queda verde. `database.types.ts` regenerado. F16: nada se movió.
- [ ] lint, `tsc`, vitest (F1–F21 y los casos 1–19 de 08b **sin tocarlos**, salvo el texto de `llegada_invalida`) y build en verde.
- [ ] Concurrencia (a)–(d) sin `40P01`.
- [ ] **Javier, como admin y con un comprador:**
  - [ ] Crear un embarque con las cuatro fechas, y otro con solo el ingreso (sale «por completar»).
  - [ ] Marcar «ya salió» y ver que pasa a en tránsito.
  - [ ] Reprogramar el puerto por «Naviera» y ver que el flujo no se mueve.
  - [ ] Reprogramar el ingreso a otro mes por «Aduana», ver la vista previa y después las compras en el mes nuevo de **Flujo mensual**.
  - [ ] Ver la línea de tiempo con retraso y número de cambios, el historial con causa y motivo, y los filtros «Atrasados» y «Reprogramados».
- [ ] **Compras de COTV** (si P1 = A): crear el embarque «por programar» de cada viaje, importar compras con `EMBARQUE` y sin `LLEGADA`, y reimportar sin duplicar.
- [ ] Los embarques que ya existían muestran su fecha como «Ingresa al stock» y, si era la de conteo, se corrige con «Corrección» sin marcarlo como reprogramado.
- [ ] Todo a 390 px, sin errores en consola.
- [ ] `seguridad` (sonnet): guards, que el plan no deje mover otro embarque (IDOR), funciones solo `service_role`, `causa` solo del catálogo.

## 7. Decisiones propuestas (a registrar en `DECISIONES.md` al construir)

| N.º | Decisión |
|---|---|
| 115 | **El embarque tiene cuatro hitos de fecha (sale, puerto, conteo, ingreso al stock) y solo el ingreso al stock decide el mes del flujo.** Precisa la 83 («llegada al CD»). El ingreso es obligatorio y los demás no. No hay caída automática al hito anterior. `fecha_llegada_estimada` conserva su nombre y pasa a significar ingreso previsto |
| 116 | **Toda reprogramación de un hito lleva motivo y causa (catálogo); completar una fecha vacía no.** Las reprogramaciones y el retraso se derivan de los eventos y no se guardan como contadores. Un hito «ya ocurrió» se marca con `hito_confirmado` (una columna secuencial, sin fechas reales por hito). El desorden entre hitos avisa y no bloquea, salvo salida > ingreso |
| 117 | **Una compra puede entrar sin mes propio si trae embarque: toma el mes de ingreso de ese embarque.** Las compras sin estimado van a un embarque «por programar». No hay entregas sin mes (se descarta la entrega «por fechar», que exigía tocar M8 y dejaba al flujo ciego). Matiza 08b §3.9 regla 3 y responde G2 de 08c §12.8 |
| 118 | **Los pagos no se modelan en el embarque: `pago` es una causa de reprogramación.** La fecha de pago por compra queda para M9a si Javier la pide |

## 8. Plan de construcción

### 8.1 Antes de empezar

- **Lugar en el camino de compras.** Se propone construirla **antes de E1 de 08c**: 08b-1 ✔ → **08b-1b** → E1 → 08b-2 → E2 → E3. Tres razones:
  - Es chica: una migración, cinco funciones reemplazadas y una nueva.
  - Desbloquea G2 de la carga de compras de COTV (C2).
  - 08b-2 se construirá ya sobre la semántica «ingreso al stock» (su `recibir_embarque` confirma el hito 4).

  Nunca en paralelo con otra entrega de compras: comparten `src/lib/compras/agrupadores/**`, `src/components/compras/**` y las funciones de la `0036`.
- **Registro de PLAN §5**: no lista `0035`, `0036` ni `0037`, que existen en `supabase/migrations/` y en `migraciones_aplicadas`. `datos` lo pone al día en el mismo commit en que toma la `0038`. Si otra entrega cierra antes con migración, esta toma la siguiente libre (decisión 48).
- `datos`, en solo lectura sobre `vector-two` (T1): cuántos embarques hay, cuántos con salida, y la distribución por estado. Solo cifras.

### 8.2 Tandas

| Tanda | Agente | Depende de | Archivos | Se da por buena cuando |
|---|---|---|---|---|
| T0 · Contratos | `backend` | — | `src/lib/compras/agrupadores/{tipos,tipos-api,esquemas}.ts` (hitos, causas, avisos, `cambiarFechasSchema`, `PlanFechasApi`); casos F en `tests/agrupadores.fixture.ts` y `tests/agrupadores.esquemas.test.ts` | `tsc` limpio; esquemas probados |
| T1 · Datos | `datos` | — | `supabase/migrations/0038_fechas_logisticas_embarque.sql`, `scripts/humo-0038.sql`, `src/lib/supabase/database.types.ts`; PLAN §5 (registro) | Aplica dos veces; humo verde; F16; `agrupador_hitos_resumen` < 50 ms con 500 embarques × 20 eventos |
| T2 · Lógica pura | `backend` | T0 | `movimiento.ts` (`planCambiarFechas`), `avisos.ts` (`orden_de_fechas`, `hito_vencido`, `fechas_por_completar`), un `hitos.ts` nuevo (próximo hito, vencido, retraso), `importar.ts` (agrupadores: columnas y sinónimo), `plantilla.ts`, `excel.ts`; `src/lib/compras/importar.ts` (LLEGADA desde el embarque y la huella), `src/lib/compras/agrupadores/importar.ts` (regla 3); `tests/agrupadores.{fechas,hitos,importar}.test.ts`, `tests/compras.importar.test.ts` | F-R1 a F-R12 en verde; M8 y 08b en verde sin tocar sus pruebas (salvo el texto de `llegada_invalida`) |
| T3a · Pantallas con fixtures | `frontend` | T0 | `modal-embarque.tsx`, `dialogo-fecha.tsx` → `dialogo-fechas.tsx`, una `linea-tiempo.tsx` nueva, `detalle-embarque.tsx`, `lista-embarques.tsx`, `filtros-embarques.tsx`, `historial.tsx`, `insignias.tsx`, `vista-agrupadores.ts`; chip en `src/components/compras/**` (detalle de compra) y `vista-importar.ts` | build y `tsc` limpios; 390 px |
| T3b · Servicio y API | `backend` | T1, T2 | `consultas.ts`, `servicio.ts`, `src/app/api/compras/embarques/[id]/fechas/route.ts` (nueva), `[id]/fecha` (alias), `[id]/route.ts` (PATCH), `embarques/route.ts`; `tests/agrupadores.{handlers,estatico}.test.ts`, `tests/api.guards.roles.test.ts` | F-R2, F-R5, F-R8, F-R12 y F21 en verde |
| T4 · Integración | `frontend` | T3a, T3b | Los de T3a | Contra la API local; F3, F4, F8 a mano |
| T5 · Cierre | `qa` (con concurrencia (a)–(d)), `seguridad` (sonnet), `documentador` | T4 | solo lectura · `docs/**` (08b §11 y esta ficha §11, PLAN, CHANGELOG, DECISIONES 115–118, checklist sección nueva), `src/lib/version.ts` | Hito con Javier |

**Versión sugerida**: `0.17.0 · M8 b`, la siguiente menor libre porque trae una migración y funciones nuevas. Lleva la letra de su ficha, igual que 08b-1. Si `documentador` prefiere un parche (`0.16.2 · M8 b`), da igual, porque las versiones no bajan. Lo decide al cerrar.

### 8.3 Riesgos

1. **Reemplazar `aplicar_movimiento_agrupador` otra vez** (tercera versión): puede romper las otras cinco operaciones. *Mitigación*: partir del texto exacto de la `0036`, que el diff sea solo la rama `cambiar_fecha` y el humo de la `0032`, `0034` y `0036` corra completo otra vez.
2. **El texto «llegada» en la pantalla y en el Excel** sigue apareciendo en lugares viejos y confunde. *Mitigación*: prueba estática que busca «Llegada» en `src/components/compras/agrupadores/**`; solo puede quedar en el sinónimo del importador.
3. **Fechas viejas mal interpretadas** (eran conteo y quedan como ingreso). *Mitigación*: P4 y la causa `correccion`, que no cuenta como atraso.
4. **Ruido de vencidos**: si nadie marca «ya ocurrió», todo sale vencido. *Mitigación*: el vencido de salida, puerto y conteo es solo un aviso, que se resuelve marcando el hito o corrigiendo la fecha. Si P3 = «no marcar», `hito_vencido` se limita al ingreso (como hoy) y `hito_confirmado` no se construye.
5. **Huella del importador de compras**: el token `EMBARQUE:<código>` cambia la huella de las filas que usan esta vía. Las filas importadas antes con `LLEGADA` no cambian. *Mitigación*: F18 y el caso 15 de 08b.
6. **Funciones de 08b-2 aún sin construir** (`recibir_embarque`, `revertir_recepcion_embarque`): su ficha debe leer «ingreso real», y al revertir debe conservar `hito_confirmado`. Queda anotado para su construcción.

## 9. Preguntas abiertas para Javier (antes de construir)

1. **Compras que todavía no tienen fecha.** ¿Te sirve que cada compra sin fecha vaya a un embarque «por programar» del viaje, con tu mejor estimado del mes en que ingresa al stock, y que después cambies esa fecha (o pases las compras a los embarques reales) a medida que sepas más? ¿O necesitas compras que no cuenten en **ningún** mes del flujo hasta que les pongas fecha? *Recomendación: el embarque «por programar». Lo comprado siempre cuenta en algún mes y no aparece un hueco falso que te lleve a comprar dos veces.*
2. **Pagos.** ¿Basta con anotar «demora en el pago» como causa cada vez que se mueve una fecha, o quieres registrar la fecha de pago de cada compra? *Recomendación: la causa ahora. La fecha de pago por compra después, cuando trabajemos la parte del comprador, si la necesitas.*
3. **«Ya ocurrió».** ¿Quieres marcar cuándo un embarque ya salió, ya llegó a puerto y ya llegó a conteo, para que el sistema te avise de lo atrasado? ¿O te basta con corregir la fecha cuando pasa? *Recomendación: marcarlo. Es un clic, y sin eso no se puede distinguir «llegó» de «se atrasó y nadie avisó».*
4. **Las fechas de llegada que ya cargaste en Vector2.** ¿Eran el día en que la mercadería **ingresa al stock**, o el día en que llega al CD para contarla? *Recomendación: tomarlas como ingreso al stock, que es lo que hoy manda el mes, y así no se mueve nada. Si alguna era la de conteo, la corriges con la causa «Corrección» y no cuenta como atraso.*

## 10. Contradicciones con lo construido o especificado (y cómo se resuelven)

1. **Decisión 83 y 08b §2.4**: «`fecha_llegada_estimada` = llegada al CD». Javier separa ahora el área de conteo (CD) del ingreso al stock. Se precisa con la 115: manda el ingreso, y la columna cambia de significado sin cambiar de nombre.
2. **08b §3.9, regla 3, y 08c §12.2 b / §12.8 G2**: «con `EMBARQUE`, `LLEGADA` sigue siendo obligatoria», y «sin mes, una compra no puede entrar». Lo matiza la 117: con `EMBARQUE` el mes sale del embarque.
3. **«Avisos, no bloqueos»** (pedido): salida > ingreso **sigue bloqueando**, porque existe el check `compra_embarques_salida_llegada_check` de la `0032` y quitarlo exige `DROP CONSTRAINT`.
4. **08b §0.3 y R5**: la salida se editaba **sin motivo** desde «Editar» (`PATCH`). Pasa a «Cambiar fechas», con motivo y causa si se reprograma. El `PATCH` ya no toca fechas.
5. **Defecto en lo construido** (no es de diseño): `servicio.ts` (línea ~943) manda `fecha_salida_estimada: cuerpo.fecha_salida_estimada ?? null`, y `guardar_embarque` de la `0036` escribe `fecha_salida_estimada = v_salida` sin condición. Un `PATCH` que no trae la salida **la borra sin motivo ni aviso** (solo queda en la foto del evento `editar`). Se corrige en esta entrega (F-R8 y F15).
6. **PLAN §5** (registro único) no lista la `0035`, la `0036` ni la `0037`, y la cabecera de PLAN dice «aplicadas … `0029` a `0034`». Hay que ponerlo al día (lo hace `datos` en T1).
7. **Decisión 94** dice «siempre `for update`». La `0036` ya la cambió a `for no key update` en viajes y embarques. Esta ficha sigue la `0036`. Conviene que `documentador` anote ese matiz en la 94 si no está.
8. **Decisión 97** (el importador de agrupadores solo crea): completar puerto y conteo **en masa** para embarques que ya existen no se puede por archivo y se hace en pantalla. Si Javier lo pide, se necesita una decisión nueva («el importador completa fechas vacías»).

## 11. Fuera de alcance

- Fecha real por hito (salvo el ingreso, que es 08b-2) y seguimiento naviero o de aduana (BL, ETA de la naviera, canal de aduana).
- Pagos como entidad: montos, fechas y estados del pago por compra o proveedor (decisión 118).
- Entregas sin mes («por fechar») en M8 (decisión 117).
- Fecha propia del paquete (08b §7).
- Vista del flujo por embarque o por fecha tentativa; aviso de «fecha por programar» dentro de Flujo mensual o Huecos.
- Que el importador de agrupadores edite o complete fechas de embarques existentes (decisión 97).
- Recibir el embarque y confirmar el ingreso: 08b-2.
- Reglas de plazo típico (p. ej. «puerto + 7 días = conteo») para proponer fechas: no se inventan plazos.

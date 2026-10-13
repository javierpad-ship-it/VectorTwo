# PWA · Vector Two como aplicación instalable (entrega transversal)

> Estado: **especificación pendiente de aprobación por Javier (escrita el 2026-10-13)**. No hay código ni migración (esta entrega no toca la base). Pedido de Javier (2026-10-12): "en el road de V2 incluye hacerlo un PWA". Lo usan planners en escritorio y, sobre todo, compradores (M9) desde celular o tableta. Guías leídas en `node_modules/next/dist/docs/01-app/`: `02-guides/progressive-web-apps.md`, `02-guides/offline-support.md`, `03-api-reference/03-file-conventions/01-metadata/manifest.md`, `.../01-metadata/app-icons.md`, `03-api-reference/04-functions/generate-viewport.md`, `04-functions/generate-metadata.md` (`appleWebApp`), `03-file-conventions/proxy.md`, `05-config/01-next-config-js/headers.md`, `deploymentId.md`, `supportsImmutableAssets.md`, `public-folder.md`, `02-guides/self-hosting.md` (caché y *version skew*), `04-glossary.md` (App Shell). Vector-One no tuvo manifiesto ni service worker: no hay nada que citar de ahí. Ficha sin datos reales de Lukers.

## Objetivo

Que Vector Two se instale como aplicación (ícono propio, ventana sin barra de navegador, pantalla completa en celular y tableta) sin cambiar cómo funciona: todo sigue llegando del servidor con la sesión en cookies. La PWA resuelve tres cosas y nada más: instalación con la marca de V2, una página digna cuando no hay red (en vez del dinosaurio de Chrome), y un aviso de "hay una versión nueva" que evita que una pestaña vieja siga trabajando contra un despliegue nuevo de Railway. **No hay trabajo sin conexión**: el service worker cachea solo la cáscara (página sin conexión, íconos, logo) y nunca datos, `/api`, ni páginas autenticadas.

## Decisiones de diseño

1. **Manifiesto con la convención de Next** (`src/app/manifest.ts`, tipo `MetadataRoute.Manifest`, servido en `/manifest.webmanifest`; Next añade solo el `<link rel="manifest">`). Nombre "Vector Two", `display: standalone`, `start_url: "/"` (el proxy manda a `/login` si no hay sesión y vuelve a `/` al entrar), `orientation: "any"` (planners en escritorio y tabletas apaisadas), `lang: "es"`, `scope: "/"`.
2. **Colores del tema desde `globals.css`, no inventados**: `theme_color` = `--superficie` (`#ffffff`, el color de la cabecera y del menú, para que la barra de estado se funda con ellos) y `background_color` = `--fondo` (`#f6f4ef`, el de `body`, que es lo que se ve en el *splash*). Viven en una constante TS (`src/lib/pwa/tema.ts`) que una prueba compara con el CSS; `viewport.themeColor` en `layout.tsx` usa la misma constante. Pregunta abierta 1 por si Javier prefiere el azul de marca `#008cff`.
3. **Íconos derivados del isotipo existente** `public/marca/isotipo.png` (512 × 512, RGBA, fondo transparente; el trazo ocupa de x = 12 a 472 y de y = 116 a 424). Como el trazo llega al borde, **no sirve tal cual como maskable** (Android recorta fuera de la "zona segura", el círculo central del 80 %). Se generan cuatro PNG en `public/iconos/`: `icono-192.png` e `icono-512.png` (`purpose: any`, isotipo al 86 % del lienzo sobre `--superficie`) e `icono-maskable-192.png` e `icono-maskable-512.png` (`purpose: maskable`, isotipo reducido al 62 % del lienzo, centrado, fondo `--superficie` opaco, **guardados sin canal alfa**, color type 2 del IHDR, para que una prueba lo verifique leyendo la cabecera). Se generan una vez con cualquier herramienta de imagen fuera del repo (no se añade dependencia) y se commitean. `src/app/icon.png` (256) y `src/app/apple-icon.png` (180, usado por iOS) se conservan; hay que confirmar que el apple-icon tenga fondo opaco (iOS pone negro bajo la transparencia).
4. **Service worker a mano, sin dependencias** (ni Serwist ni next-pwa: la guía de Next los menciona solo para caché completa offline, que aquí está prohibida). Se sirve desde un route handler `src/app/sw.js/route.ts` que devuelve el texto generado por la función pura `generarServiceWorker(APP_VERSION)` de `src/lib/pwa/service-worker.ts`, así la versión queda incrustada y el script cambia byte a byte en cada despliegue (es lo que hace que el navegador detecte "SW nuevo"). Política de peticiones en datos y una función pura (`src/lib/pwa/politica.ts`), probadas con vitest; el script completo se prueba ejecutándolo en un *sandbox* (ver pruebas).
5. **Política del service worker (lista blanca, no lista negra)**: solo `GET`, solo mismo origen, nunca `/api/*` (ni siquiera se llama a `respondWith`), nunca `/_next/*`. Navegaciones (`request.mode === "navigate"`): siempre red; si `fetch` falla por red (rechazo, `TypeError`) responde la página sin conexión cacheada; un 4xx/5xx o una redirección del proxy a `/login` se entregan tal cual. Rutas de `RUTAS_PRECACHE` (página sin conexión, los cuatro íconos, `/marca/isotipo.png`, `/marca/logo-vertical.png`): caché primero. Todo lo demás no se intercepta. Sin `cache.put` en tiempo de ejecución, sin `sync`, `push`, `periodicsync` ni IndexedDB: el almacén contiene exactamente la lista de precarga.
6. **Caché versionado y limpio**: nombre `vector-two-shell-<APP_VERSION normalizada>`; en `activate` se borran los cachés con el prefijo `vector-two-shell-` que no sean el actual (y ninguno de otro prefijo), luego `clients.claim()`. En `install`, `skipWaiting()` **automático**: es seguro porque el SW nunca sirve código de la app ni datos, así que no hay estado viejo que proteger. Lo que **nunca** es automático es recargar la página: el aviso de versión nueva la recarga solo cuando el usuario pulsa Actualizar (un planner a mitad de una carga de M5 no puede perder el acumulador por una recarga sorpresa).
7. **Página sin conexión autocontenida** (`GET /sin-conexion`, route handler que devuelve HTML generado por `generarPaginaSinConexion(APP_VERSION)` en `src/lib/pwa/sin-conexion.ts`): CSS en línea con los mismos colores, logo desde `/marca/logo-vertical.png` (precargado), texto "Sin conexión", botón "Reintentar" (`location.reload()`), versión al pie. **No referencia `/_next/` ni `/api/`**: una página de Next arrastraría chunks que offline no cargan.
8. **`proxy.ts` deja pasar lo público de la PWA**. Hoy el `matcher` corre sobre todo lo que no sea `api`, `_next/static`, `_next/image`, `favicon.ico` o imágenes, así que `/manifest.webmanifest` (el navegador lo pide **sin cookies** salvo `crossorigin="use-credentials"`), `/sw.js` y `/sin-conexion` acabarían redirigidos a `/login` y la PWA sería ininstalable o cachearía el login como página offline. Se añaden al negativo del matcher: `manifest.webmanifest|sw.js|sin-conexion`. `PUBLICAS` no cambia (`/sin-conexion` queda fuera del proxy, no es "pública con redirección al entrar").
9. **Cabeceras en `next.config.ts` → `headers()`** (se aplican antes del sistema de archivos y de los handlers): `/sw.js` → `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type: text/javascript; charset=utf-8`; `/manifest.webmanifest` y `/sin-conexion` → `Cache-Control: no-cache`. El handler de `sw.js` repite las suyas por si el handler se prerenderiza. `Service-Worker-Allowed` **no hace falta**: el script vive en `/sw.js` y su alcance por defecto ya es `/` (solo se necesitaría si viviera bajo `/_next/static/`). Los íconos en `public/` conservan el `max-age=0` que Next pone por defecto a `public/` (revalidan en cada instalación nueva del SW).
10. **Registro solo en producción**, desde un componente cliente en el layout raíz (`src/components/pwa/registro-pwa.tsx`, así corre también en `/login`): `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`; en desarrollo desregistra cualquier SW previo (evita fantasmas con `next dev`). Busca actualizaciones con `registration.update()` al volver la pestaña a primer plano (`visibilitychange`) y cada 30 minutos. Función pura `debeRegistrar(env, protocolo, host)` → `true` solo con `production` y (https o localhost).
11. **Aviso de versión nueva** (`src/components/pwa/aviso-version.tsx`, en el layout raíz): si había un `controller` al cargar y llega `controllerchange`, muestra "Hay una versión nueva de Vector Two. Actualizar" (`Alert` tono info, fijo arriba, no se cierra solo). Actualizar = `location.reload()`. Sin `controller` previo (primera instalación) no se muestra nada.
12. **Aviso sin conexión** (`src/components/pwa/aviso-conexion.tsx`): `Alert` tono alerta con `role="status"`, "Sin conexión. Lo que hagas ahora no se guardará hasta que vuelva la red", por `online`/`offline` + `navigator.onLine`. **No** se activa `experimental.useOffline` de Next (es experimental y su reintento automático cubre navegaciones y Server Actions, que esta app no usa: los datos van por `fetch` en `api-client.ts`); queda anotado como opción futura. `api-client.ts` traduce el rechazo de `fetch` (`TypeError`) a "No hay conexión con el servidor. Revisa tu red y vuelve a intentarlo" (función pura `mensajeErrorRed`).
13. **Instalación con botón propio** (`src/components/pwa/instalar-card.tsx`), tarjeta "Usar Vector Two como aplicación" en `/` (Inicio, los tres roles): captura `beforeinstallprompt` (Chrome y Edge, escritorio y Android) y muestra el botón **Instalar**; en iOS y iPadOS (sin ese evento) muestra los pasos "Compartir → Añadir a pantalla de inicio" con la versión; si ya corre en `display-mode: standalone` (o `navigator.standalone`) la tarjeta no aparece; "No volver a mostrar" en `localStorage` (`v2.pwa.ocultar-instalar`). La guía de Next desaconseja `beforeinstallprompt` por no ser multiplataforma; se usa igual **como mejora progresiva**, con la instrucción iOS como respaldo. `metadata.appleWebApp = { capable: true, title: "Vector Two", statusBarStyle: "default" }` en `layout.tsx` para que iOS abra a pantalla completa.
14. **Desfase entre despliegues (Railway)**: la PWA no "tapa" nada porque el SW no cachea HTML, JS ni datos; lo que puede fallar es una pestaña vieja pidiendo chunks que el contenedor nuevo ya no tiene. Se recomienda, aparte de la PWA, `deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA` en `next.config.ts` (Next añade `?dpl=` a los assets y fuerza navegación completa al detectar desfase; con un solo contenedor en Railway la "recarga en vez de navegar" es justo lo deseado). Pregunta abierta 4.
15. **Versión visible**: ya está al pie del menú (`v{APP_VERSION}`); se añade al pie de `/login` (para comprobar un despliegue sin entrar), a la página sin conexión y a la tarjeta de instalación.

## Modelo de datos

Sin cambios. No se registra quién instaló ni desde qué dispositivo (fuera de alcance; si M9 lo necesita, es una tabla suya).

## Archivos a crear o tocar

| Archivo | Qué |
|---|---|
| `src/app/manifest.ts` (nuevo) | Manifiesto tipado; íconos, colores desde `tema.ts` |
| `src/lib/pwa/tema.ts` (nuevo) | `COLOR_TEMA = "#ffffff"`, `COLOR_FONDO = "#f6f4ef"`, `NOMBRE_APP = "Vector Two"` |
| `src/lib/pwa/politica.ts` (nuevo) | `RUTAS_PRECACHE`, `PREFIJO_CACHE`, `nombreCache(version)`, `clasificarPeticion({ metodo, url, modo, origen })` → `ignorar` · `navegacion` · `precache`, `cachesAEliminar(nombres, actual)` |
| `src/lib/pwa/service-worker.ts` (nuevo) | `generarServiceWorker(version)`: el script como texto, con la política incrustada como JSON |
| `src/lib/pwa/sin-conexion.ts` (nuevo) | `generarPaginaSinConexion(version)` |
| `src/app/sw.js/route.ts`, `src/app/sin-conexion/route.ts` (nuevos) | `GET` sin guard (no sirven datos; ver "Contratos") |
| `public/iconos/icono-{192,512}.png`, `icono-maskable-{192,512}.png` (nuevos) | Derivados del isotipo (decisión 3) |
| `src/components/pwa/registro-pwa.tsx`, `aviso-version.tsx`, `aviso-conexion.tsx`, `instalar-card.tsx` (nuevos) | Componentes cliente |
| `src/app/layout.tsx` | `viewport.themeColor`, `metadata.appleWebApp`, `applicationName`; monta `RegistroPwa`, `AvisoVersion`, `AvisoConexion` |
| `src/app/(app)/page.tsx` | Tarjeta de instalación |
| `src/app/login/page.tsx` | Versión al pie |
| `src/proxy.ts` | Matcher: excluir `manifest.webmanifest`, `sw.js`, `sin-conexion` |
| `next.config.ts` | `headers()`; opcional `deploymentId` |
| `src/lib/api-client.ts` | Mensaje de error de red |
| `tests/pwa.*.test.ts` (nuevos) | Ver "Casos de prueba" |
| `docs/PLAN.md`, `README.md`, `CHANGELOG.md`, `DECISIONES.md` | Al construir (documentador) |

## Contratos de API

No hay rutas nuevas bajo `/api`. Tres rutas públicas **sin datos**, fuera de `/api` y fuera del proxy; esa es la razón de que no lleven guard (la regla "todo handler empieza con un guard" se precisa como "todo handler bajo `/api`, y cualquier handler que lea Supabase"; decisión propuesta 2):

| Ruta | Respuesta | Cabeceras |
|---|---|---|
| `GET /manifest.webmanifest` | JSON del manifiesto (convención de Next) | `Cache-Control: no-cache` |
| `GET /sw.js` | `text/javascript`, el script con `APP_VERSION` incrustada | `no-cache, no-store, must-revalidate` |
| `GET /sin-conexion` | `text/html`, página autocontenida | `Cache-Control: no-cache` |

## Pantallas y avisos

| Dónde | Rol | Qué ve / hace |
|---|---|---|
| Inicio `/` | todos | Tarjeta "Usar Vector Two como aplicación": botón **Instalar** (Chrome/Edge) o pasos para iOS; "No volver a mostrar"; oculta si ya está instalada |
| Todo el sitio (incluido `/login`) | todos | Banner "Hay una versión nueva de Vector Two. **Actualizar**" (no se cierra solo; Actualizar recarga). Banner "Sin conexión…" mientras no haya red (desaparece solo al volver) |
| `/sin-conexion` | todos (sin sesión también) | Logo, "Sin conexión", "Vector Two necesita internet: no guarda nada en el dispositivo", **Reintentar**, versión |
| Menú y `/login` | todos | `v{APP_VERSION}` al pie |
| Errores de pantalla | todos | Las llamadas a `/api` que fallan por red dicen "No hay conexión con el servidor…" en vez de "Failed to fetch" |

## Reglas de negocio (cada una con prueba)

1. `clasificarPeticion` devuelve `ignorar` para cualquier URL que empiece por `/api/` o `/_next/`, para cualquier método distinto de `GET` y para cualquier origen distinto del propio, sin importar lo demás.
2. `clasificarPeticion` devuelve `navegacion` solo con `modo === "navigate"`; `precache` solo si la ruta está en `RUTAS_PRECACHE`; en cualquier otro caso `ignorar`.
3. Ninguna ruta de `RUTAS_PRECACHE` empieza por `/api/` ni coincide con un `href` de `NAV_SECTIONS` (`src/lib/nav.ts`) ni con `/login`: nunca se precarga una página con sesión.
4. En una navegación, el respaldo offline solo se usa si `fetch` **rechaza**; una respuesta 401/403/404/500 o una redirección se devuelven tal cual.
5. `nombreCache(v)` empieza por `PREFIJO_CACHE` y cambia si cambia `v`; `cachesAEliminar` devuelve todos los nombres con el prefijo distintos del actual y ninguno sin el prefijo.
6. El script generado contiene `skipWaiting`, `clients.claim`, un solo `addAll` (en `install`) y **ningún** `cache.put`, `addEventListener("sync"|"push"|"periodicsync")` ni `indexedDB`.
7. El script y la página sin conexión contienen la `APP_VERSION` con la que se generaron; la página no contiene `/_next/` ni `/api/` y toda URL que referencia está en `RUTAS_PRECACHE`.
8. El matcher del proxy **no** cubre `/manifest.webmanifest`, `/sw.js`, `/sin-conexion` ni `/iconos/x.png`, y **sí** cubre `/`, `/login`, `/usuarios`, `/planificacion/venta-stock`.
9. `headers()` de `next.config.ts` devuelve para `/sw.js` un `Cache-Control` con `no-store` y `Content-Type` JavaScript, y para `/manifest.webmanifest` un `no-cache`.
10. El manifiesto tiene `name` "Vector Two", `display` `standalone`, `start_url` `/`, `lang` `es`, `theme_color` y `background_color` iguales a `--superficie` y `--fondo` de `globals.css`, y al menos un ícono 192 y uno 512 por cada `purpose` (`any`, `maskable`); cada `src` existe en `public/` con las dimensiones declaradas (IHDR) y los maskable no tienen canal alfa.
11. `debeRegistrar` es `true` solo en `production` con https o `localhost`.
12. `mensajeErrorRed` convierte un `TypeError` de `fetch` en el texto en castellano y deja pasar los demás errores.

## Casos de prueba

**Automatizables con vitest (sin navegador, sin dependencias nuevas):**

- `tests/pwa.politica.test.ts`: reglas 1, 2, 3, 5, 11, 12 (funciones puras; la 3 cruza `RUTAS_PRECACHE` con `NAV_SECTIONS`).
- `tests/pwa.service-worker.test.ts`: ejecuta el texto de `generarServiceWorker("0.0.0-prueba")` con `new Function("self", "caches", "fetch", fuente)` y dobles mínimos (`self.addEventListener` que captura los handlers, `self.location.origin`, `self.skipWaiting`, `self.clients.claim`; `caches.open/keys/delete/match`; `fetch` configurable). Casos: `install` llama `addAll` exactamente con `RUTAS_PRECACHE`; `activate` borra `vector-two-shell-viejo` y conserva `otro-cache`; `fetch` de `GET /api/usuarios`, `POST /`, `https://xxx.supabase.co/auth/v1/token` y `/_next/static/x.js` **no** llama a `respondWith`; navegación con `fetch` que resuelve 200/302/500 devuelve esa respuesta; navegación con `fetch` que rechaza devuelve `caches.match("/sin-conexion")`; `GET /iconos/icono-192.png` sirve del caché y, si no está, de la red. Más la regla 6 sobre el texto.
- `tests/pwa.sin-conexion.test.ts`: regla 7.
- `tests/pwa.estatico.test.ts`: regla 8 con `unstable_doesMiddlewareMatch` de `next/experimental/testing/server` (ojo: la guía `proxy.md` lo documenta como `unstable_doesProxyMatch`, pero el paquete 16.3.8 exporta `unstable_doesMiddlewareMatch`; si no carga en vitest, se exporta la regex del matcher desde un módulo y se prueba con `RegExp`); regla 9 importando `next.config.ts` y llamando `headers()`; regla 10 importando `src/app/manifest.ts`, leyendo `globals.css` con una regex sobre `:root` y los PNG con `node:fs` (IHDR: ancho, alto, color type); además, que `layout.tsx` exporte `viewport` con `themeColor` igual a `COLOR_TEMA`, que `registro-pwa.tsx` use `updateViaCache: "none"`, que ningún archivo de `src/` registre otro SW ni haga `caches.open` fuera de `src/lib/pwa/`, y que los handlers nuevos no importen `supabaseAdmin` ni `supabaseServer`.

**Manuales (QA en Chromium, Javier en dispositivos):** DevTools → Application → Manifest sin errores e "Installability" en verde; Service Workers muestra uno activo con el `sw.js` de la versión; Cache Storage solo contiene `vector-two-shell-<versión>` con las N entradas de precarga y ninguna `/api`; Lighthouse (categoría PWA o auditoría de instalabilidad, según la versión de Chrome) sin fallos de manifiesto, ícono ni service worker; Network → Offline → navegar: página sin conexión; reconectar → Reintentar vuelve; `/api/...` nunca aparece como "(ServiceWorker)" en Network.

## Hito de prueba para Javier

En Railway, con la versión desplegada:

1. **Escritorio (Chrome o Edge)**: en `/` aparece la tarjeta "Usar Vector Two como aplicación" y el ícono de instalar en la barra de direcciones. Instalar; se abre en ventana propia con el isotipo, sin barra de navegador, y la barra de título es blanca. Cerrar y abrir desde el menú de inicio: entra directo (sesión conservada).
2. **Android (Chrome)**: instalar desde el botón; abrir desde el ícono de la pantalla de inicio: pantalla completa, ícono redondo o con forma sin recorte del trazo (maskable). Login; navegar al árbol; **modo avión**; tocar otra sección: aparece "Sin conexión" con el logo; quitar modo avión; **Reintentar**: vuelve la pantalla con datos. En Maestros, con modo avión, intentar guardar algo: el error dice "No hay conexión con el servidor…" y al volver la red se puede repetir.
3. **iPhone o iPad (Safari)**: la tarjeta muestra los pasos; Compartir → Añadir a pantalla de inicio; el ícono es el isotipo con fondo; abre a pantalla completa; pide login una vez (la app instalada en iOS tiene cookies propias, distintas de Safari) y luego lo recuerda.
4. **Versión nueva**: con la app abierta en dos dispositivos, subir `APP_VERSION` y desplegar. Al volver a la app (o en menos de 30 minutos) aparece "Hay una versión nueva de Vector Two. Actualizar"; **no** se recarga sola; al pulsar Actualizar, la versión al pie cambia. En DevTools → Cache Storage queda un solo caché, el de la versión nueva.
5. **Seguridad**: cerrar sesión dentro de la app instalada → va a `/login`; abrir la app instalada en un dispositivo sin sesión → `/login` directamente, sin pasar por ninguna pantalla cacheada; en Cache Storage no hay nada de `/api` ni de `/maestros`, `/planificacion` o `/usuarios`.
6. El pie de `/login` muestra la versión, igual que el menú.

## Orden en el roadmap y versión

Se mantiene la propuesta de PLAN: **después de M8 y antes de M9**, porque los compradores son quienes la usarán desde el celular y conviene que el primer hito de M9 ya se recorra desde la app instalada. Matices: la entrega es pequeña (dos o tres días: generador del SW, componentes, íconos, pruebas), **no tiene migración ni depende de ningún módulo**, y se puede adelantar en cualquier hueco (por ejemplo mientras Javier responde las preguntas de M6 o M7) sin reordenar nada; el aviso de versión nueva le sirve desde ya a Javier para saber que Railway tomó el último commit. Versión: la siguiente menor tras el módulo que esté en curso, con sufijo `· PWA`; commits con prefijo `PWA:`. Agentes: no hay `datos`; `backend` (política, generadores, handlers, cabeceras, proxy) y `frontend` (manifiesto, íconos, componentes, layout) en paralelo; `qa` recorre la lista manual en Chromium.

## Fuera de alcance

- Trabajo o escritura sin conexión, colas de cambios, IndexedDB, `Background Sync`: nada se guarda en el dispositivo. Si M9 necesita "registrar la compra en la tienda sin señal", se especifica allí, con su propio modelo de conflictos.
- Caché de datos, de `/api`, de páginas autenticadas o de chunks de `/_next/`; *stale-while-revalidate*; precarga de rutas.
- Notificaciones push (VAPID, Server Actions de la guía de Next): no hay caso de uso hoy.
- `experimental.useOffline` y Cache Components / Partial Prefetching (la guía `offline-support.md` los combina; esta app no usa Server Actions y el flag es experimental).
- Capturas (`screenshots`) y `shortcuts` del manifiesto, `share_target`, `file_handlers`, pantalla de arranque personalizada en iOS (`startupImage`).
- Registro de instalaciones por usuario o dispositivo; analítica.
- Cambios de diseño responsivo más allá de lo que ya hace `AppShell` (la revisión del uso con el pulgar es de M9).

## Riesgos

- **Proxy y manifiesto**: si el matcher no excluye `manifest.webmanifest`, la instalación falla en silencio (el navegador recibe un 307 a `/login`); por eso la regla 8 es prueba y no solo documentación.
- **Página sin conexión cacheada con redirección**: si `/sin-conexion` quedara dentro del proxy sin sesión, `addAll` guardaría el login como página offline. Misma prueba.
- **iOS**: la app instalada tiene almacenamiento y cookies propios (login aparte de Safari) y, si no se abre en mucho tiempo, puede pedir login de nuevo; `beforeinstallprompt` no existe, de ahí los pasos manuales. Safari actualiza el SW con menos frecuencia: el aviso puede tardar hasta la siguiente apertura.
- **Un SW es un componente más que depurar**: `next dev` no lo registra (decisión 10) y, si alguna vez estorba en producción, basta desplegar un `sw.js` que en `install` borre el caché y llame a `registration.unregister()` (plan de retirada, sin tocar nada más).
- **Railway y desfase**: una pestaña abierta durante el despliegue puede fallar al navegar hasta que recargue; el aviso y, si se acepta, `deploymentId` lo acotan. Hay que confirmar que `RAILWAY_GIT_COMMIT_SHA` esté disponible en la fase de *build* de Nixpacks; si no, se usa un `NEXT_DEPLOYMENT_ID` derivado de `APP_VERSION`.
- **Ícono maskable**: si al generar los PNG no se respeta la zona segura, Android recorta el trazo; el hito 2 lo comprueba a ojo y la prueba estática solo garantiza tamaño y opacidad.
- **Lighthouse**: Chrome retiró la categoría PWA de Lighthouse en versiones recientes; la verificación equivalente es DevTools → Application → Manifest → "Installability".

## Decisiones nuevas propuestas (para `docs/DECISIONES.md` al aprobar)

1. **La PWA cachea solo la cáscara (página sin conexión, íconos y logo) y nunca datos, `/api`, `/_next` ni páginas con sesión; no hay escritura sin conexión.** Descartado: caché de páginas con *stale-while-revalidate* (serviría datos viejos de un planner con sesión) y librerías de SW (Serwist, next-pwa) con precarga automática de chunks.
2. **Tres rutas públicas sin guard fuera de `/api`: `/manifest.webmanifest`, `/sw.js`, `/sin-conexion`.** No leen Supabase ni devuelven datos; se excluyen del proxy. La regla de M0 "cada handler empieza con un guard" se precisa: todo handler bajo `/api` y todo handler que toque la base.
3. **El SW se activa solo (`skipWaiting` + `clients.claim`), versionado con `APP_VERSION` y con limpieza de cachés viejos; la página nunca se recarga sola: el usuario pulsa Actualizar.** Descartado: recarga automática en `controllerchange` (rompería una carga de M5 en curso).
4. **Colores del manifiesto = tokens de `globals.css` (`--superficie`, `--fondo`), íconos derivados del isotipo existente; sin marca nueva.**

## Preguntas abiertas para Javier (con valor por defecto)

1. **Color de la barra**: ¿blanco como la cabecera (`--superficie`, se funde con el menú) o azul de marca (`#008cff`, "se ve más app")? **Por defecto: blanco.**
2. **Nombre corto bajo el ícono**: "Vector Two" cabe (10 caracteres); ¿prefieres "Vector2" o "V2"? **Por defecto: "Vector Two".**
3. **Dónde ofrecer la instalación**: tarjeta en Inicio tras entrar; ¿también en `/login` para que un comprador instale antes de su primer login en el celular? **Por defecto: solo en Inicio.**
4. **`deploymentId` con el SHA del commit de Railway** para que una pestaña vieja recargue sola al navegar tras un despliegue: ¿se activa? **Por defecto: sí, si la variable existe en el *build*.**
5. **Frecuencia del aviso de versión**: comprobación al volver a la app y cada 30 minutos. ¿Más seguido (cada 5) o solo al abrir? **Por defecto: 30 minutos.**
6. **Orientación**: `any`. ¿Bloquear a vertical en celular? **Por defecto: `any` (tabletas apaisadas y escritorio).**
7. **Momento**: después de M8 y antes de M9, o adelantarla en el primer hueco. **Por defecto: después de M8; se adelanta si tú lo pides.**

## Cambios que hay que hacer en PLAN.md (los integra quien coordina)

- §5 "Transversal — PWA": sustituir el párrafo "Pendiente de especificar…" por: "Especificada el 2026-10-13 (`docs/modulos/10-pwa.md`), **pendiente de aprobación por Javier**. Sin migración ni tabla. Manifiesto con la convención de Next (`src/app/manifest.ts`), íconos derivados de `public/marca/isotipo.png`, colores de `globals.css`; service worker a mano servido por `GET /sw.js` con `APP_VERSION` incrustada, caché `vector-two-shell-<versión>` con solo la página sin conexión, íconos y logo, limpieza de cachés viejos, `skipWaiting` automático y aviso 'Hay una versión nueva: Actualizar' (nunca recarga sola); nada de datos, `/api`, `/_next` ni páginas con sesión; sin escritura offline. `proxy.ts` excluye `manifest.webmanifest`, `sw.js` y `sin-conexion`; cabeceras `no-store` para el SW en `next.config.ts`; recomendado `deploymentId` con el SHA de Railway. Orden: después de M8 y antes de M9 (independiente, se puede adelantar). Siete preguntas abiertas con valor por defecto."
- §5, fila M9: añadir "El primer hito de M9 se recorre desde la app instalada (PWA)".
- §5, fila M8 (columna estado): "Tras M8 entra la PWA transversal (`10-pwa.md`) antes de M9".
- §3 Roles / §6 Definition of Done: precisar la regla de guards: "todo handler bajo `/api` y todo handler que toque la base empieza con un guard; las tres rutas públicas de la PWA (`/manifest.webmanifest`, `/sw.js`, `/sin-conexion`) no sirven datos y quedan fuera del proxy" (cuando Javier apruebe la decisión 2).
- §7 Pendientes de Javier: añadir "PWA: responder las siete preguntas de `docs/modulos/10-pwa.md` o aceptar sus valores por defecto; al recorrer el hito, probar en un Android con Chrome y en un iPhone o iPad con Safari".
- Tabla de agentes (§6): nota de que la PWA no pasa por `datos`.

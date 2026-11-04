# Auditoría de seguridad total · Vector2

- Repo: `/home/user/VectorTwo`, rama `claude/epic-faraday-40fzee`, HEAD `2885945` (`0.15.0 · M7 c`).
- Base: proyecto Supabase `vector-two` (ref `tzjsxzmsvvhxyiooihyq`). Solo SELECT y `get_advisors`. No se tocó `lukers-compras`.
- Fecha: 2026-11-04. Solo lectura: sin cambios de código, sin commits, sin pruebas contra producción.
- Herramientas ejecutadas en local: `npm run lint` (ok), `npx tsc --noEmit` (ok), `npx vitest run` (294 archivos, 6 240 tests ok, 2 omitidos), `npm audit --omit=dev`, `git log -p -S` sobre patrones de claves, consultas a `pg_catalog` / `information_schema`.

Escala: **CRÍTICA** (explotable ya con impacto en datos/roles) · **ALTA** · **MEDIA** · **BAJA** · **INFO**. En cada hallazgo se indica si está *reproducido* (observado con evidencia directa) o *deducido* (por lectura del código / configuración).

Cabecera de seguimiento: el cuerpo de este documento es el informe original sin cambios. El estado vigente de cada hallazgo está en la sección 6 (verificado el 2026-11-04 contra el repo en c371b68 y la base).

---

## 1. Tabla de hallazgos

| ID | Severidad | Área | Resumen | Evidencia |
|---|---|---|---|---|
| S-01 | **MEDIA** | Auth (panel Supabase) | Protección contra contraseñas filtradas (HaveIBeenPwned) desactivada; política de contraseña del lado de la app es solo "≥ 8 caracteres" | `get_advisors(security)` → `auth_leaked_password_protection` WARN; `src/lib/usuarios/esquemas.ts:4-8` |
| S-02 | **MEDIA** | Auth (panel Supabase, no verificable desde aquí) | No pude comprobar si el **registro abierto (signup)** y el **cambio de correo por el propio usuario** están desactivados en Auth. La anon key es pública y Auth es alcanzable directamente desde cualquier cliente: si signup está habilitado, cualquiera crea cuentas en `auth.users` (sin perfil → 403, pero es ruido y superficie); si el cambio de correo está habilitado, un usuario puede cambiar `auth.users.email` y dejar `perfiles.email` desincronizado (el admin ve un correo que ya no es el de login) | `src/lib/supabase/browser.ts:7-12` (cliente anon en el navegador); `src/app/(app)/layout.tsx:15-23` (estado `sin_perfil`); `supabase/migrations/0000_base.sql:35-46` (`perfiles.email` copia sin trigger de sincronización) |
| S-03 | **MEDIA** | Auth / UX de seguridad | No existe cambio de contraseña por el propio usuario ni recuperación por correo: la contraseña la fija y la conoce el admin (`PATCH /api/usuarios/[id]` con `password`). Contraseñas compartidas entre admin y usuario; además, cambiar la contraseña desde admin no revoca las sesiones ya abiertas de ese usuario (solo desactivar las corta, vía `ban_duration` + `perfil.activo`) | `src/app/api/usuarios/[id]/route.ts:54-60`; `docs/modulos/00-cimientos.md:64` ("Recuperación de contraseña por correo (hoy la resetea un admin)") |
| S-04 | **BAJA** | Sesión / XSS | El token de sesión vive en cookies **no HttpOnly** (`httpOnly: false` es el valor por defecto de `@supabase/ssr`, necesario para el cliente del navegador) y la CSP solo tiene `frame-ancestors`: no hay `script-src`. Un XSS (hoy no encontré ninguno) robaría la sesión. Es diseño de la librería; el riesgo real depende de que no aparezca XSS | `node_modules/@supabase/ssr/dist/main/utils/constants.js:4-10` (`sameSite: "lax"`, `httpOnly: false`, `maxAge: 400 días`); `next.config.ts:12-22` |
| S-05 | **BAJA** | Dependencias | `xlsx@0.18.5`: prototype pollution (GHSA-4r6h-8v6p-xvw6) y ReDoS (GHSA-5pgg-2g8v-p4x9), sin fix en npm. **Exposición real baja**: el parseo de archivos ocurre **solo en el navegador** del usuario que sube su propio archivo (import dinámico en `src/lib/arbol/leer-archivo.ts:124`, `src/lib/ventas/leer-por-bloques.ts:318`; se usa desde componentes cliente); el servidor nunca llama a `XLSX.read`. Un archivo malicioso solo afecta a la pestaña de quien lo sube | `npm audit --omit=dev` (1 high); `package-lock.json` `xlsx 0.18.5`; `grep XLSX.read src` |
| S-06 | **BAJA** | API / CSRF (defensa en profundidad) | `leerCuerpo` no exige `Content-Type: application/json` ni se verifica `Origin`/`Sec-Fetch-Site` en métodos que mutan. Hoy no es explotable: las cookies llevan `SameSite=Lax` explícito (no viajan en POST cross-site) y los formularios HTML no pueden enviar `PATCH`/`DELETE` | `src/lib/api/respuestas.ts:43-57`; sin coincidencias de `headers.get("origin")` ni `sec-fetch-site` en `src/` |
| S-07 | **BAJA** | Rate limiting | La app no limita peticiones: el login depende de los límites de Supabase Auth (no verificables desde aquí) y las rutas caras (`POST …/calcular`, corridas de IA, importadores de 10 000 filas) solo están limitadas por el guard de rol y los semáforos de la IA (`MAX_LLAMADAS_SIMULTANEAS=3`, `MAX_LLAMADAS_POR_CORRIDA=1`) | `src/lib/ia/limites.ts:21-26`; `src/app/login/login-form.tsx:57` |
| S-08 | **BAJA** | Mensajes de error | El formulario de login muestra `err.message` crudo de Supabase Auth cuando no es "invalid" ni "banned" (p. ej. mensajes de rate limit o "Email not confirmed"). No filtra secretos, pero revela textos internos del proveedor | `src/app/login/login-form.tsx:60-68` |
| S-09 | **INFO** | Base de datos | Tabla residual `public.prueba_conexion` (sin PK, 0 filas), con RLS y sin grants a `anon`/`authenticated`. No explotable; limpieza | `get_advisors(performance)` → `no_primary_key`; consulta a `pg_class` |
| S-10 | **INFO** | Base de datos | Los privilegios por defecto del rol `supabase_admin` en `public` siguen concediendo todo a `anon`/`authenticated` sobre objetos nuevos. Solo aplica si alguien crea objetos como `supabase_admin` (las migraciones van como `postgres`, que sí está endurecido por `0013`). Toda tabla existente está cerrada | `pg_default_acl`: `postgres public r/S/f` → solo `postgres` y `service_role`; `supabase_admin public r` → incluye `anon`, `authenticated` |
| S-11 | **INFO** | Datos visibles al comprador | El rol `comprador` lee por diseño: árbol completo con `nivel_planificacion` y agrupación de estacionalidad (`GET /api/arbol`), matriz de responsables (sin lista de compradores asignables), tiendas y aperturas (sin `venta_esperada_promedio` ni tienda de referencia), marcas (sin configuración de planificación), flujo mensual con venta/stock/IMI, huecos, compras, proveedores, parámetros del flujo, equivalencias y faltantes de estacionalidad. Está documentado y decidido (PLAN §3, nav.ts); se lista para que Javier confirme que un comprador debe ver venta y stock en el flujo | `src/app/api/tiendas/route.ts:33-46`; `src/app/api/marcas/route.ts:56-58`; `src/app/api/responsables/route.ts:38-41`; `src/app/api/flujo/route.ts:16`; `src/lib/nav.ts:42-54` |
| S-12 | **INFO** | Seguridad de cabeceras | HSTS sin `preload`; CSP mínima (ver S-04); `Permissions-Policy` incluye `interest-cohort` (obsoleto, inofensivo). Sin `X-Powered-By`. `Cache-Control: no-store` en toda respuesta de API | `next.config.ts:12-22`; `src/lib/api/respuestas.ts:8` |
| S-13 | **INFO** | Historial git | Ningún secreto real en el historial ni en el árbol: `eyJhbGciOi` 0 commits; los commits con `sk-` son un test con `"secreto: sk-algo"` ficticio; `sb_secret_`/`sb_publishable_` solo en comentarios de `.env.local.example` y README; `supabase.co` solo como `xxx.supabase.co` en una ficha. `.env*` ignorado y nunca añadido. `.claude/settings.json` solo contiene permisos de MCP de solo lectura | `git log --all -p -S…`; `git ls-files`; `.gitignore:35`; `.claude/settings.json` |
| S-14 | **INFO** | Correo real en el repo | `supabase/migrations/0000_base.sql:66` contiene el correo del primer admin (Javier) para el seed del perfil. No es un secreto, pero es un dato personal versionado y un objetivo obvio para fuerza bruta/phishing | `0000_base.sql:61-66` |
| S-15 | **INFO** | Proxy / host | `proxy.ts` construye las redirecciones a `/login` y `/` clonando `request.nextUrl` (host tomado de la petición). Con Railway delante no es explotable; si algún día hay un proxy intermedio que reenvíe `Host`/`X-Forwarded-Host` sin filtrar, la redirección podría apuntar a otro host. `?next=` sí está saneado | `src/proxy.ts:41-53`; `src/lib/auth/destino.ts:9-15` |
| S-16 | **INFO** | PWA (futura) | La ficha `docs/modulos/10-pwa.md` ya limita el service worker a la cáscara (página sin conexión, íconos, logo), nunca `/api`, `/_next` ni páginas con sesión; sin `cache.put` en tiempo de ejecución. Si se construye tal como está escrita, en un equipo compartido no quedaría dato alguno en Cache Storage. Vigilar al construir: que las tres rutas nuevas sin guard (`/sw.js`, `/sin-conexion`, `/manifest.webmanifest`) no importen `supabaseAdmin`, y que `localStorage` siga guardando solo el correo recordado | `docs/modulos/10-pwa.md:7,15,16,135-137`; `src/app/login/login-form.tsx:12,44` |

**Conteo:** CRÍTICA 0 · ALTA 0 · MEDIA 3 (S-01, S-02, S-03) · BAJA 5 (S-04 a S-08) · INFO 8 (S-09 a S-16).

---

## 2. Detalle de los hallazgos MEDIA y BAJA

### S-01 · Contraseñas filtradas sin protección y política mínima (MEDIA, reproducido por advisor)
- **Cómo se explota:** un admin crea un usuario con `password: "12345678"` (pasa el `min(8)` de `crearUsuarioSchema`); Supabase lo acepta porque la comprobación contra HIBP está apagada. Un atacante con una lista de contraseñas filtradas prueba contra `/auth/v1/token` con la anon key (solo lo frena el rate limit de Supabase, que no pude verificar).
- **Corrección mínima:** en el dashboard de Supabase → Authentication → Policies/Password: activar *Leaked password protection* y subir el mínimo (p. ej. 12) y exigir mezcla de caracteres; en la app, endurecer `password` en `src/lib/usuarios/esquemas.ts` para que coincida (zod `.min(12)` y un `refine` de complejidad) y mostrar la regla en `/usuarios`.

### S-02 · Signup abierto y cambio de correo por Auth directo (MEDIA, deducido; no verificable con SELECT)
- **Cómo se explota (si signup está habilitado):** `POST https://<ref>.supabase.co/auth/v1/signup` con la anon key (visible en el bundle) crea un usuario; entra a la app y ve la pantalla "Tu usuario no está dado de alta". No lee datos (RLS + sin grants + guards), pero llena `auth.users` y deja cuentas huérfanas.
- **Cómo se explota (si el cambio de correo está habilitado):** un comprador autenticado llama `PUT /auth/v1/user` `{ "email": "otro@…" }` con su propio JWT (lo tiene en la cookie no HttpOnly). `auth.users.email` cambia; `perfiles.email` no (no hay trigger). En `/usuarios` y en `usuario_nombre` de los eventos seguirá apareciendo el correo viejo; el usuario entra con el nuevo. Impacto: trazabilidad y confusión administrativa, no acceso a datos ajenos.
- **Corrección mínima:** Dashboard → Authentication → Sign In / Providers: desactivar *Allow new users to sign up* (el alta es solo por `POST /api/usuarios`); desactivar el cambio de correo por el usuario o activar *Secure email change* y añadir un trigger en `auth.users` (o un job) que sincronice `perfiles.email`. Documentar el estado en `docs/modulos/00-cimientos.md`.

### S-03 · Sin autogestión de contraseña y sin revocación de sesión al cambiarla (MEDIA, deducido)
- **Cómo se explota:** el admin siempre conoce la contraseña que fija (`PATCH /api/usuarios/[id]` → `updateUserById({ password })`); no hay forma en la UI de que el usuario la cambie (aunque sí podría hacerlo por la Auth API directa, ver S-02). Si una contraseña se compromete y el admin la cambia, las sesiones ya abiertas del atacante siguen vivas hasta que caduque el refresh token (solo **desactivar** las corta, porque `requireUser` comprueba `perfil.activo` en cada petición y `ban_duration` impide refrescar).
- **Corrección mínima:** pantalla "Mi cuenta" con `supabaseBrowser().auth.updateUser({ password })` (no requiere service role); en `PATCH /api/usuarios/[id]`, tras cambiar `password`, llamar `auth.admin.signOut(id, "global")` (o un `ban` de un segundo) para invalidar sesiones; opcional: flujo de recuperación por correo (`resetPasswordForEmail`) solo si Javier lo quiere.

### S-04 · Cookie de sesión legible por JS y CSP sin `script-src` (BAJA, reproducido en la librería)
- **Contexto:** `@supabase/ssr` guarda `sb-<ref>-auth-token` con `httpOnly: false`, `sameSite: lax`, `secure` según protocolo, 400 días. Es necesario para `signInWithPassword`/`signOut` en el navegador. No encontré `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` en `src/`; los `href` dinámicos usan rutas internas o `Link` con ids UUID validados.
- **Corrección mínima:** no cambiar la librería; a medio plazo añadir CSP con `script-src 'self' 'nonce-…'` (Next 16 lo documenta en `02-guides/content-security-policy.md`, exige render dinámico, que ya es el caso por `cookies()`), y considerar la variante *server-side only auth* (login por route handler y cookie HttpOnly) si la app empieza a aceptar HTML de usuarios.

### S-05 · `xlsx@0.18.5` (BAJA, reproducido por `npm audit`)
- **Exposición real:** el servidor no parsea Excel (solo recibe JSON ya tabulado, con tope de 6 MB y 300/1 000 caracteres por celda: `src/lib/api/celdas.ts:11-12`). Las escrituras (`XLSX.write`) ocurren en el navegador. El ReDoS/prototype pollution solo afectan a quien sube un archivo malicioso a su propia pestaña.
- **Corrección mínima:** migrar a la distribución oficial de SheetJS (`https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`, que sí tiene los fixes) o a `exceljs`; fijar la versión sin `^` en `package.json`.

### S-06 · Sin comprobación de `Content-Type`/`Origin` (BAJA, deducido)
- **Corrección mínima:** en `leerCuerpo` rechazar con 415 si `content-type` no empieza por `application/json`; opcionalmente comprobar `Sec-Fetch-Site` ∈ {`same-origin`, `none`} en POST/PUT/PATCH/DELETE dentro del `proxy.ts` ampliando el matcher a `/api`.

### S-07 · Sin rate limiting propio (BAJA, deducido)
- **Corrección mínima:** confirmar en Dashboard → Authentication → Rate Limits los valores por defecto (sign-in, token refresh); para las rutas caras, un limitador en memoria por `perfil.id` (p. ej. una corrida de IA o un cálculo de proyección a la vez por usuario) ya existe en parte (`candado_token` de la IA, `calculo_en_curso` de M6).

### S-08 · Mensaje crudo de Auth en el login (BAJA, reproducido por lectura)
- **Corrección mínima:** en `login-form.tsx:60-68` mapear a un mensaje genérico ("No se pudo iniciar sesión. Inténtalo de nuevo.") cualquier error que no sea credenciales inválidas o cuenta desactivada, y registrar el detalle solo en consola de desarrollo.

---

## 3. Verificado y está bien (con evidencia)

### 3.1 Autenticación y sesión
- **Login** con `signInWithPassword` desde el navegador con la anon key; errores de credenciales normalizados a "Correo o contraseña incorrectos." (`src/app/login/login-form.tsx:56-68`). Supabase devuelve el mismo mensaje para correo inexistente y contraseña errónea: sin enumeración por login.
- **`?next=` saneado**: `destinoSeguro` solo acepta rutas internas (`^\/(?!\/|\\)`) sin caracteres de control (`src/lib/auth/destino.ts:9-15`; `tests/auth.destino.test.ts` pasa).
- **Proxy** (`src/proxy.ts`): usa `getUser()` (valida contra Auth, no confía en la cookie), redirige a `/login` sin sesión, a `/` con sesión en `/login`; el matcher cubre todo salvo `api`, `_next/static`, `_next/image`, `favicon.ico` e imágenes. Las rutas excluidas de `/api` están cubiertas por los guards (ver 3.2). No existen páginas fuera de `(app)` salvo `/login`.
- **Layout `(app)`** (`src/app/(app)/layout.tsx`): `perfilActual()` en cada navegación; `sin_sesion` → redirect; `sin_perfil` e `inactivo` → pantalla bloqueada sin menú ni datos.
- **Páginas con rol**: `/usuarios` y `/administracion/ia` exigen `admin`; `/planificacion/*`, `/maestros/marcas|estacionalidad|tiendas|intercompany|agrupacion-gmle|arbol/catalogos` exigen `puedeEditarMaestros`; `/compras/*`, `/maestros/arbol`, `/maestros/responsables` aceptan los tres roles (por diseño). Verificado con grep de `redirect("/")` en los 19 `page.tsx`.
- **Desactivación**: `PATCH /api/usuarios/[id]` con `activo:false` aplica `ban_duration: 876000h` en Auth **antes** de tocar el perfil y revierte si falla; `requireUser` rechaza `!perfil.activo` en cada petición (`src/lib/auth/guard.ts:44`). Corte inmediato, reproducido por lectura y por `tests/usuarios.*`.
- **Escalada de rol**: solo `requireAdmin` toca `perfiles`; `motivoRechazo` impide eliminarse, desactivarse o quitarse el rol admin a uno mismo y conserva al menos un admin activo (`src/lib/usuarios/reglas.ts:32-47`). No hay ninguna ruta donde un usuario edite su propio perfil. `normalizarRol` degrada cualquier valor raro a `comprador`. Default de `perfiles.rol` = `comprador` (`0013`).
- **Mass assignment**: todos los `z.object` sin `.strict()` **recortan** claves desconocidas (comportamiento por defecto de zod 4; no hay `.passthrough()`/`.loose()` en `src/lib`); además los handlers construyen el `update` campo a campo (`usuarios/[id]/route.ts:62-65`).
- **Logout**: `auth.signOut()` + `router.replace("/login")` (`src/components/layout/boton-salir.tsx:18-23`).
- **Estado real de la base**: 3 usuarios en `auth.users` = 3 perfiles (1 admin activo, 2 compradores activos), 0 sin perfil, 0 sin confirmar, 0 baneados, proveedor de identidad solo `email`.

### 3.2 APIs
- **136 `route.ts`**, 199 handlers; el test estático `tests/api.guards.estatico.test.ts` (pasa) exige que la **primera sentencia** sea `requireUser`/`requirePlanner`/`requireAdmin` o una delegación a la lista blanca de `catalogo.ts`/`agrupaciones.ts`, cuyos cuerpos también se verifican. Mapa de guards generado por grep: ninguna escritura con `requireUser`; usuarios e IA-admin con `requireAdmin`; géneros, mundos, agrupaciones de talla/marca con `requireAdmin` en escritura (`src/lib/arbol/catalogos.ts:20,37,72`, `src/lib/marcas/catalogos.ts:20`).
- **Cuerpos**: el mismo test exige `leerCuerpo` (JSON, tope 6 MB por `content-length` y por tamaño real, zod) en todo POST/PUT/PATCH que use `request`. Celdas de importadores con tope 300/1 000 caracteres (`src/lib/api/celdas.ts`).
- **IDs de ruta**: `idDeRuta`/`leerSegmentos` validan UUID y responden 404 uniforme (`src/lib/api/respuestas.ts:80-84`, `src/lib/proyeccion/rutas.ts:30-52`).
- **Query strings**: validadas con zod o listas cerradas (`leerConsulta`, `parametrosNoVacios`, `filtrosTiendasSchema`, `esEstadoMapeo`…). Los filtros de texto libre (`?q=` en mapeos y compras) se aplican **en memoria**, nunca en `.ilike()`/`.or()` (`src/lib/ventas/mapeos.ts:159-180`, `src/lib/compras/servicio.ts:500-503`). Los tres `.or()` con interpolación usan valores generados en servidor (fechas ISO, `perfil.id`), no entrada del usuario (`src/lib/ia/consultas.ts:177`, `src/app/api/ventas/cargas/route.ts:59`, `src/lib/proyeccion/consultas.ts:135,143`).
- **Errores**: `traducirErrorDb` devuelve mensajes de catálogo y un 500 genérico; el detalle (código, mensaje, hint) solo va a `console.error`, y para contextos `IA:` ni siquiera el mensaje (`src/lib/api/errores-db.ts:446-461`). `traducirErrorAuth` idem (`src/lib/usuarios/errores-auth.ts`).
- **Cache**: `Cache-Control: no-store` en toda respuesta de API (`respuestas.ts:8`).
- **Fuga entre roles**: `GET /api/tiendas` y `/aperturas` anulan `venta_esperada_promedio` y referencia para el comprador; `GET /api/marcas` aplica `sinConfiguracionDePlanificacion`; `GET /api/responsables` devuelve `compradores: []` al comprador; `GET /api/ia/*`, `/curvas/*`, `/proyeccion/*`, `/ventas/*`, `/marcas-barrer/*`, `/intercompany/*`, `/periodos-atipicos/*`, `/reportes/*` exigen planner o admin.
- **Exportaciones**: CSV con `escapeFormulae` (regex que cubre `=`, `+`, `-`, `@`, TAB, CR salvo números con signo y `-` solo) (`src/components/importador/csv.ts:10-19`); Excel con `aoa_to_sheet` escribiendo texto como texto.
- **Subida/descarga de archivos**: no hay Storage ni buckets (`storage.buckets` vacío); los archivos se parsean en el navegador y viajan como JSON tabulado.
- **07g (aprobación en bloque)**: sin regresión: las cinco rutas de `aprobacion/*` siguen con `requirePlanner`; `tests/aprobacion.*` (rutas, estático, servicio, reglas) pasan en la suite completa; `proyeccion_lotes`/`proyeccion_lote_filas` con RLS, sin grants a anon/authenticated y triggers de inmutabilidad presentes en producción (`pg_trigger`).

### 3.3 Base de datos (`vector-two`)
- **RLS** activo en las **50 tablas** de `public` y **0 políticas** (`pg_class`/`pg_policy`; advisor `rls_enabled_no_policy` es el estado esperado).
- **Grants**: `information_schema.role_table_grants` para `anon`/`authenticated`/`PUBLIC` en `public` → **vacío**. Secuencia `compras_numero_seq` sin USAGE para `anon`/`authenticated`. `has_schema_privilege` CREATE = false para ambos.
- **Vistas**: las 4 vistas (`intercompany_vigente`, `marca_gml_especial_vigente`, `marcas_unidad`, `venta_stock_vigente`) con `security_invoker=true` y sin SELECT para anon/authenticated; la vista materializada `venta_mensual_estacionalidad` (sin uso) sin SELECT para ellos.
- **Funciones**: 31 funciones en `public`, **ninguna `security definer`**, todas con `search_path=""`, EXECUTE solo para `service_role` (`pg_proc` + `has_function_privilege`).
- **Default ACL de `postgres`** en `public`: solo `postgres` y `service_role` (efecto de `0013`).
- **Triggers**: `set_updated_at` en 40 tablas; inmutabilidad en `compra_eventos`, `ia_*`, `proyeccion_lotes*` (también contra `TRUNCATE`).
- **Extensiones**: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` (todas estándar). Sin `pg_net`, `http` ni `dblink`.
- **Storage**: 0 buckets, 0 políticas de storage.
- **Advisor de seguridad**: solo `rls_enabled_no_policy` (INFO, esperado) y `auth_leaked_password_protection` (S-01). Performance: 2 FK sin índice en `venta_stock_mensual` (`agrupacion_talla_id`, `tienda_id`), 90 índices sin uso, `prueba_conexion` sin PK.

### 3.4 IA (07e)
- Única salida de red: `fetch` a `https://api.openai.com/v1/chat/completions`, URL base constante; `url_base` solo inyectable desde código/tests, no desde la petición → sin SSRF (`src/lib/ia/proveedor-openai.ts:31,145`).
- Clave solo en `process.env.OPENAI_API_KEY`, leída en el adaptador y enviada en `Authorization`; los errores son tipados y genéricos (`errorDeEstado`, "red"); no hay `console.*` en `src/lib/ia` ni en las rutas de IA. `store: false` hacia OpenAI.
- Modelo restringido a la lista `IA_MODELO` del servidor (`servicio.ts:198,920`, `servicio-evaluacion.ts:158`); interruptor `IA_DESACTIVADA`.
- La IA **solo propone**: "Aceptar IA" es un POST con `valor_esperado` validado por zod y comparado con el valor vigente (`409 ia_valor_cambio`); nada ejecuta la salida del modelo (`…/ia/filas/[filaId]/aceptar/route.ts`). Respuesta exigida con `json_schema` + `strict`.
- Límites de costo/concurrencia: `MAX_TOKENS_SALIDA`, timeouts, 3 reintentos, corte de circuito, 1 llamada en vuelo por corrida, 3 por proceso (`src/lib/ia/limites.ts`). Tests bloquean cualquier `fetch` a openai/anthropic (`tests/setup-sin-red.ts`).
- `venta_lineas_ia` devuelve solo unidades (nunca soles/costos/stock) según la migración 0030 y el PLAN.

### 3.5 Frontend
- Sin `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `child_process` ni `fs` con entrada de usuario en `src/` (grep). `new Function` solo aparece en la ficha de la PWA para un test futuro.
- `localStorage`: solo el correo recordado (`vector2.login.correo`); `sessionStorage`: borrador de "Mi curva" (datos de planificación de un planner en su propia sesión).
- `NEXT_PUBLIC_*`: solo `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas por diseño). `SUPABASE_SERVICE_ROLE_KEY` y `OPENAI_API_KEY` solo en módulos con `import "server-only"`; el test estático comprueba que ningún componente `"use client"` importe `supabase/admin`, `supabase/server` ni el guard.
- Cabeceras: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS 2 años con `includeSubDomains`, `Permissions-Policy`, CSP `frame-ancestors 'none'`, `poweredByHeader: false`.
- Source maps de producción no habilitados (`productionBrowserSourceMaps` ausente = false).

### 3.6 Secretos, configuración y puertas traseras
- Sin rutas de debug/seed/health/test bajo `src/app`; el healthcheck de Railway apunta a `/login` (`railway.json`). Sin Dockerfile; sin `.github/`; `scripts/` solo contiene SQL de humo y un script de backtest que lee las claves del entorno.
- Sin banderas que desactiven auth en dev/test: la única rama especial es `IA_DESACTIVADA` (apaga, no abre). Faltar una variable de Supabase hace lanzar `requerida()` → **fallo cerrado**.
- `.env*` ignorado, nunca versionado; `datos/` solo con `LEEME.md`; `public/` solo 3 PNG de marca.
- `npm audit --omit=dev`: 1 hallazgo (xlsx, S-05). Next 16.4.1, React 19.2.8, `@supabase/ssr` 0.12.7, `supabase-js` 2.117.2, zod 4.6.6 sin avisos. Lockfile presente (`package-lock.json`).
- `npm run lint`, `npx tsc --noEmit`, `npx vitest run`: todo verde.

---

## 4. No pude comprobar

1. **Configuración de Supabase Auth** (no expuesta por SQL ni por los MCP disponibles): signup abierto, confirmación de correo, cambio de correo, *secure email change*, duración del JWT/refresh, rate limits de sign-in/token, CAPTCHA. Javier debe revisarlo en el dashboard (ver S-01/S-02).
2. **Variables de entorno en Railway**: que `SUPABASE_SERVICE_ROLE_KEY` y `OPENAI_API_KEY` estén como variables del servicio y no en el build, y que `NEXT_PUBLIC_*` sean las del proyecto `vector-two` (no `lukers-compras`).
3. **Cabeceras reales en producción** (HSTS/CSP tal como las sirve Railway) y si Railway añade/filtra `X-Forwarded-Host` (S-15): no se hizo ninguna petición a producción.
4. **Logs de Railway**: si algún `console.error` en producción contiene datos (por diseño no debería: ver `datosParaLogDb`).
5. **Rotación de la clave `service_role` / anon**: no hay evidencia de fuga, así que no se exige rotar; si en algún momento estuvieron en un chat o archivo fuera del repo, rotarlas desde el dashboard.
6. **CVE específicas de Next 16.4.x posteriores a mi conocimiento**: `npm audit` no reporta nada; conviene re-ejecutarlo en cada despliegue.

---

## 5. Lo que debe hacer Javier por su cuenta (fuera del código)

1. Dashboard Supabase → Authentication → *Leaked password protection*: **activar** (S-01) y subir la longitud mínima.
2. Dashboard Supabase → Authentication → Sign In: **desactivar signups** y revisar el cambio de correo (S-02). Revisar también los *Rate limits* (S-07).
3. Railway: confirmar que las claves secretas están solo como variables del servicio y que el dominio público está detrás de HTTPS (HSTS ya se envía).
4. Pedir al equipo `backend` una pantalla "Mi cuenta" (cambio de contraseña) y la revocación de sesiones al resetear (S-03); y a `datos` el trigger de sincronización `auth.users.email → perfiles.email` si se mantiene el cambio de correo habilitado.
5. Decidir si el comprador debe ver venta/stock en el flujo (S-11, hoy es diseño aprobado en `0.13.0`).


## 6. Seguimiento (verificado el 2026-11-04, repo `c371b68`, base `vector-two`)

Actualización de la tanda C1 (2026-11-04, cambios en el árbol de trabajo, aún sin versión ni commit; verificada con `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build`): S-04 (parcial), S-06 (parcial), S-08, S-12 y el pendiente del analizador de guards. Las filas lo indican en «Estado»; la columna «Evidencia hoy» conserva lo verificado en `c371b68`.

| ID | Sev. | Resumen | Estado | Evidencia hoy | Plan |
|---|---|---|---|---|---|
| S-01 | MEDIA | Contraseñas filtradas sin protección; política «≥ 8» | **Abierto** | `get_advisors(security)`: `auth_leaked_password_protection` WARN; `src/lib/usuarios/esquemas.ts:4-8` (`MIN_PASSWORD = 8`) | Javier: panel Auth (requiere plan Pro, verificar). Código: política de clave en la tanda «Mi cuenta» |
| S-02 | MEDIA | Signup abierto y cambio de correo por Auth directo | **No verificable** (panel) | 3 usuarios = 3 perfiles, 0 huérfanos, 0 correos distintos; sin trigger en `auth.users` | Javier: desactivar signups. El cambio de correo no tiene interruptor conocido: se cubre sincronizando `perfiles.email` desde `requireUser` (ver informe de la tanda C) |
| S-03 | MEDIA | Sin cambio de clave propio; resetear no revoca sesiones | **Abierto** | `src/app/api/usuarios/[id]/route.ts:54-58` solo `updateUserById`; no existe `/cuenta` | Módulo «Cuenta y sesiones». **Corrección a la propuesta original:** `auth.admin.signOut` pide un JWT, no un id; se revoca iniciando sesión como el usuario con la clave nueva y cerrando con scope `global` |
| S-04 | BAJA | Cookie no HttpOnly; CSP sin `script-src` | **En curso (C1)**: CSP etapa 1 en `Content-Security-Policy-Report-Only` (`src/lib/seguridad/cabeceras.ts`, `tests/seguridad.cabeceras.test.ts`); falta la etapa 2 con nonce | `next.config.ts:21`; `@supabase/ssr` `DEFAULT_COOKIE_OPTIONS.httpOnly=false` | CSP en dos etapas (informe tanda C §3) |
| S-05 | BAJA | `xlsx@0.18.5` (prototype pollution, ReDoS) | **Abierto** | `npm audit --omit=dev`: 1 alto; lecturas en `src/lib/arbol/leer-archivo.ts:124` y `src/lib/ventas/leer-por-bloques.ts:318` | Reemplazo por `npm:@e965/xlsx@0.20.3` (alias, sin tocar código); verificado: 150 pruebas y `tsc` pasan con 0.20.3 |
| S-06 | BAJA | `leerCuerpo` no exige `Content-Type` ni `Origin` | **Parcial (C1)**: 415 en `leerCuerpo` hecho (`src/lib/api/respuestas.ts`, `tests/seguridad.respuestas.test.ts`, `tests/seguridad.cliente-json.test.ts`); falta `Sec-Fetch-Site` en `proxy.ts` | `src/lib/api/respuestas.ts:43-57` | 415 en `leerCuerpo`; `Sec-Fetch-Site` en `proxy.ts` |
| S-07 | BAJA | Sin rate limiting propio | **No verificable** (panel) | `src/lib/ia/limites.ts` | Javier: revisar «Rate limits» de Auth |
| S-08 | BAJA | Login muestra `err.message` crudo | **Corregido (C1, sin versión asignada)**: `src/lib/auth/mensaje-login.ts`, `tests/auth.mensaje-login.test.ts` | `src/app/login/login-form.tsx:60-66` | Mensaje genérico |
| S-09 | INFO | Tabla residual `prueba_conexion` | **Abierto** | advisor lista la tabla; 0013 la menciona | Migración de limpieza futura |
| S-10 | INFO | Default ACL de `supabase_admin` abre a anon/authenticated | **Abierto** | `pg_default_acl` | Nada que hacer en migraciones (corren como `postgres`) |
| S-11 | INFO | El comprador ve venta y stock del flujo | **Aceptado (decisión 99, 2026-11-04)** | `docs/DECISIONES.md` «Seguridad: el comprador sigue viendo venta y stock» | — |
| S-12 | INFO | Cabeceras: HSTS sin preload, `interest-cohort` | **Corregido (C1, sin versión asignada)**: `interest-cohort` fuera, COOP, CORP y `X-Permitted-Cross-Domain-Policies`; HSTS se queda sin `preload` a propósito | `next.config.ts:16,19` | Informe tanda C §3 |
| S-13 | INFO | Sin secretos en el historial | **Verificado de nuevo hoy** | 0 coincidencias en `git log --all -p -G…` | — |
| S-14 | INFO | Correo del primer admin en `0000_base.sql` | **Abierto** | `supabase/migrations/0000_base.sql:66` | Dato personal versionado; no urgente |
| S-15 | INFO | Redirecciones desde `request.nextUrl` | **Abierto** | `src/proxy.ts:41-53` | Vigilar si se añade otro proxy |
| S-16 | INFO | PWA: service worker solo con la cáscara | **Vigente** | `docs/modulos/10-pwa.md` | Revisar al construir |

### Pendientes de la primera auditoría (0.9.2)

| Pendiente | Estado hoy |
|---|---|
| Analizador de guards exija `requirePlanner`/`requireAdmin` en escrituras | **Corregido (C1, sin versión asignada)**: `ESCRITURAS_ABIERTAS_A_COMPRADOR` (17) y `LECTURAS_ABIERTAS_A_COMPRADOR` (25) en `tests/api.guards.analizador.ts`; una escritura nueva con `requireUser` fuera de la lista hace fallar `tests/api.guards.estatico.test.ts`. Estado antes de C1: `tests/api.guards.analizador.ts` ya rechaza `export *` y formas raras, pero no distingue lectura de escritura: hay 17 escrituras con `requireUser` (todas en `compras/agrupadores`, `compras/embarques`, `compras/paquetes`, `compras/viajes`, `compras/viaje-activo` y `compras/importar`, por decisiones 92 y 108) que nada obliga a justificar |
| Test del handler de tiendas con rol comprador | Cubierto (tests propios de tiendas, `api.guards.roles.test.ts` los excluye) |
| Tope de 6 MB en `/api/ventas/previsualizar` | Sin verificar hoy |
| `server-only` sin instalar | **Corregido** (`package.json` lo lista y `tests/api.guards.estatico.test.ts` exige el import en 20+ módulos) |
| Rotar la clave del administrador | **No verificable** (Javier confirma) |
| Activar contraseñas filtradas | **Abierto** (= S-01) |

### Hallazgos nuevos desde la auditoría (post `2885945`)

| ID | Sev. | Resumen | Estado |
|---|---|---|---|
| S-17 | MENOR | `service_role` conserva UPDATE/DELETE/TRUNCATE sobre `compra_eventos` y las `ia_*` inmutables (los triggers los rechazan; falta quitar el privilegio) | **En curso**: la migración `0035` (sin aplicar al 2026-11-04) lo deja en `select, insert` |
| S-18 | INFO | CI en preparación (`.github/workflows/ci.yml`, sin commitear): acciones por etiqueta `@v4` y sin `npm audit` | **Abierto**; fijar por SHA y añadir `npm audit --omit=dev --audit-level=high` cuando `xlsx` esté resuelto |

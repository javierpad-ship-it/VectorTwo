# Auditoría de seguridad · 08c E1 (proveedores y fotos de líneas) · `0.18.0 · M8 c`

- Auditor: agente `seguridad` (sonnet), 2026-11-07, solo lectura sobre el código y sobre la base `vector-two`. Escala: BLOQUEANTE / IMPORTANTE / MENOR / INFO. **Resultado: sin bloqueantes ni importantes; ocho menores.**
- **Alcance.** Los commits `951eb25..6bef6f6`: la API de proveedores y fotos (`b650cdd`), las pantallas de proveedores y de fotos en el detalle de la compra (`4bab773`) y el cambio de `Permissions-Policy` (`6bef6f6`). **Quedaron fuera del corte**: la API del módulo Fotos y los ganchos de puertos (`2175498`), las correcciones de esta auditoría (`7ecafb0`) y la pantalla Fotos con su limpieza (`39aeb16`). El informe leyó además, sin commitear, el cambio de CSP que después entró en `2175498`. La lista de Fotos y la pantalla de limpieza no están auditadas: ver «Seguimiento».
- **Fuente.** Este archivo es un resumen. El informe íntegro de la sesión no se versiona; aquí van los hallazgos, su estado y la evidencia que se puede comprobar en el repo, sin datos reales.

## Hallazgos

| ID | Sev. | Resumen | Estado | Evidencia |
|---|---|---|---|---|
| H-1 | MENOR | La validación de JPEG del servidor no impedía que un archivo armado a mano conservara EXIF, GPS o comentarios entre los scans de un JPEG progresivo, ni que llevara otro archivo pegado tras un `FF D9` intermedio. El flujo normal no lo permite (el navegador recodifica en un `canvas`), pero la API se puede llamar directo | **Corregido (0.18.0)** | `7ecafb0`: `datosDeImagenValidos` en `src/lib/fotos/jpeg.ts`, llamada desde `validarJpeg` (`src/lib/fotos/validar.ts`); pruebas en `tests/fotos.jpeg.test.ts` y `tests/fotos.subida.test.ts`. R2 de la ficha actualizada |
| H-2 | MENOR | La miniatura se cacheaba 24 horas con `immutable`: en un equipo compartido quedaba en la caché de disco tras cerrar sesión, y una foto quitada seguía a la vista hasta un día | **Corregido (0.18.0)** | `7ecafb0`: `Cache-Control: private, max-age=300` en `src/app/api/compras/fotos/[fotoId]/miniatura/route.ts`. Decisión 131; R27 de la ficha actualizada |
| H-3 | MENOR | `Permissions-Policy: camera=(self)` no hace falta con la implementación actual: el botón [Cámara] es un `<input type="file" capture>` y no hay `getUserMedia` en `src/`. Dejarla abre la cámara al propio origen ante un XSS futuro (la CSP sigue en solo reporte) | **Abierto**: falta probar en un teléfono real | `6bef6f6` la dejó en `camera=(self)` por precaución. Decisión 132: probar con `camera=()` en Chrome Android y Safari iOS; si `capture` funciona, volver a `camera=()` y ajustar `tests/seguridad.cabeceras.test.ts`. Paso en la sección R del checklist |
| H-4 | MENOR | Cualquier rol borra al instante y sin vuelta atrás los archivos de una foto quitada (la fila queda, el archivo no). Para las fotos con `clave_origen` (carga de COTV) no se pueden volver a cargar | **Abierto**: decide Javier | `src/lib/fotos/servicio.ts` (quitar) y `quitar_foto_linea` en `0039`. Alternativa propuesta: dejar el borrado de los archivos a la limpieza de 24 horas, con lo que hay un día para deshacer; la foto quitada deja de servirse igual, así que la privacidad no cambia |
| H-5 | MENOR (latente) | La CSP completa no permitía cargar la foto grande (URL firmada en el origen de Supabase) cuando pase de solo reporte a bloqueante | **Corregido (0.18.0)** | `2175498`: `img-src` suma solo el origen del proyecto (no `*.supabase.co`) en `src/lib/seguridad/cabeceras.ts`, con su prueba |
| H-6 | MENOR (preexistente) | `service_role` conservaba `truncate`, `trigger` y `references` sobre `proveedores` por los privilegios por defecto de Supabase | **Corregido (0.18.0)** | Migración `0040_privilegios_proveedores.sql`, aplicada en Vector2. Se conservan `select`, `insert`, `update` y `delete` porque `eliminar_proveedor` corre con los privilegios del que llama |
| H-7 | MENOR (preexistente) | Protección contra contraseñas filtradas desactivada en Supabase Auth (advisor `auth_leaked_password_protection`) | **No verificable** desde el repo: la activa Javier en el panel de Auth, si el plan lo permite | Mismo pendiente heredado de la primera auditoría (`auditoria-2026-10-total.md`) |
| H-8 | MENOR | Sin límite de ritmo en las subidas: cada usuario autenticado puede mandar subidas de hasta 512 KB sin tope de frecuencia. El almacenamiento no crece sin límite (tres fotos por línea y quitar borra el archivo); el costo es CPU y ancho de banda | **Aceptado**, sin acción hoy | Valorar un límite por usuario si la app se abre a más gente. No hay decisión numerada: es una nota de la auditoría |

## Observaciones sin acción (INFO)

- **Lo que ve el comprador.** Los tres roles leen proveedores con contactos (nombre, cargo, teléfono, correo), identificación fiscal, dirección, condiciones de pago, la marca intercompany y el resumen de compras con su costo. Es lo decidido (decisiones 28, 87 y 103). La marca intercompany solo se restringe al escribir, con doble barrera: la API (`src/lib/proveedores/reglas.ts`) y `guardar_proveedor`. No salen nunca los datos bancarios (no se leen de COTV), ni `clave_origen`, ni los identificadores internos de quién editó. Son datos personales de terceros: tenerlo presente si algún día entra un rol externo.
- **El historial de proveedores no se puede borrar**, ni siquiera al eliminar el proveedor: `antes` conserva los contactos. No hay vía de supresión de datos personales. Es una decisión consciente (103); solo se anota.
- **La URL firmada de la foto grande dura una hora** y es un enlace-portador: quien la reciba ve la foto hasta que caduque o se borre el archivo.
- **Limpieza de huérfanas (solo admin).** Borra todo archivo del bucket sin fila de más de 24 horas. Cuando llegue la carga de fotos de COTV (C2), conviene mantener el orden «subir y registrar, foto por foto» para que ningún archivo espere en el bucket más de ese plazo sin su fila.
- **El listado de proveedores** lee tres tablas completas por petición; irrelevante a esta escala.
- **Dependencias.** El rango no toca `package.json` ni el lockfile; `npm audit --omit=dev` sin vulnerabilidades. El módulo no lee archivos del usuario con SheetJS: solo escribe la hoja `PROVEEDORES` como celdas de texto, así que una fórmula no se ejecuta.

## Verificado y correcto

- **Guards.** Las 15 funciones de las 11 rutas nuevas del corte abren con su guard como primera sentencia (`requireUser`; `requirePlanner` para eliminar y desactivar un proveedor; `requireAdmin` para la limpieza). Lo imponen `tests/fotos.estatico.test.ts`, `tests/api.guards.estatico.test.ts` y `tests/api.guards.roles.test.ts`. Los handlers no tocan `.from`, `.rpc` ni `.storage`; Storage solo se usa en `src/lib/fotos/almacen.ts`.
- **Pertenencia.** Un id mal formado responde `404`; las funciones SQL repiten, bajo candado, que la foto pertenezca a la línea y la línea a la compra. Una foto de otra línea o compra da `no_pertenece`. En una compra cancelada solo el admin quita fotos, con el rol tomado del guard y no del cuerpo.
- **Subida.** Orden: origen del propio sitio, `411` sin `content-length`, `413` por encima de 512 KB sin leer el cuerpo, lectura con tope, firma y estructura JPEG, dimensiones y peso, y recién entonces se quitan los metadatos. Los nombres de archivo del cliente nunca se usan: la ruta lleva identificadores generados en el servidor y la fija un `check` de la tabla. Si la función rechaza o falla tras subir, se borran los dos archivos. Ninguna respuesta trae rutas de Storage ni mensajes de SQL.
- **Base de datos.** RLS activo y cero políticas en las tablas nuevas y en todo `public` y `storage`; `anon`, `authenticated` y `public` sin ningún privilegio sobre `public`; las diez funciones de la `0039` con `security invoker`, `search_path` vacío y ejecutables solo por `service_role`; el cuerpo desplegado de cada una coincide con el de la migración (se comparó `md5` sin los retornos de carro que dejó el editor del panel). El historial de proveedores es inmutable por trigger, también contra `TRUNCATE`; `service_role` solo lo lee e inserta. El bucket es privado, con tope de 400 KB y solo `image/jpeg`, sin políticas.
- **Pantallas.** Sin `dangerouslySetInnerHTML`; todos los textos se pintan como texto; los únicos enlaces nuevos son rutas internas; sin `localStorage` ni `createObjectURL` en los componentes nuevos.
- **Secretos.** Ningún `.env`, dato real ni imagen binaria en el rango; sin patrones de claves en el diff; sin variables `NEXT_PUBLIC_*` nuevas.

## No comprobado

- Si `capture="environment"` abre la cámara con `camera=()` en Chrome Android y Safari iOS (H-3).
- Que la CSP completa rompa o no la foto grande (hoy solo reporta); la conclusión es por lectura de la política.
- Pruebas contra Storage real: hoy el bucket no tiene objetos y las pruebas usan un almacén falso. `copy`, `remove` de mil nombres y `createSignedUrl` no se ejercitaron contra Supabase real.
- Que Railway conserve el `content-length` de una subida *multipart* (si no lo hace, toda subida daría `411`); paso en la sección R del checklist.
- El historial de git completo en busca de claves (se revisó solo el diff del corte), las variables de entorno de Railway y el plan de Supabase.

## Seguimiento

- **H-3:** probar en un teléfono real y, si `capture` funciona, volver a `camera=()` (decisión 132).
- **H-4:** decisión de Javier. Si elige el borrado diferido, el cambio es de `backend` (dejar el `.remove()` a la limpieza) y se anota aquí.
- **Reauditar** la lista de Fotos (`GET /api/compras/fotos`), los puertos habituales y la pantalla de limpieza (`2175498` y `39aeb16`) cuando se haga la carga C2, que escribe fotos en bloque.
- **H-7:** Javier, en el panel de Supabase Auth.
- Repetir la auditoría con E2 (Galería y Proformas), que sirve fotos en lote y genera PDF en el navegador.

# Auditorías de seguridad

Aquí se versionan los informes del agente `seguridad` (solo lectura) y el estado de cada hallazgo. Antes vivían en la sesión y se perdían: de la primera auditoría (2026-10-14) solo quedó un resumen en `docs/DECISIONES.md`.

## Reglas

1. **Quién escribe.** `seguridad` solo reporta: devuelve el informe al orquestador, que lo guarda aquí (o el `documentador`). `backend` y `datos` corrigen; quien corrige actualiza la fila de estado en el mismo commit.
2. **Nombre.** `auditoria-AAAA-MM-<alcance>.md` (`total`, `08b1`, `07g`…). Una auditoría por archivo; no se reescriben, se les añade la sección «Seguimiento».
3. **Identificadores.** Auditoría total: `S-01`, `S-02`… Auditoría de módulo: letra y número del informe original (`A1`, `B2`, `M1`…); si el informe original no se conserva, se dice en la cabecera.
4. **Severidad.** `BLOQUEANTE` (explotable ya con impacto en datos o roles) · `IMPORTANTE` · `MENOR` · `INFO`. Las auditorías antiguas usan CRÍTICA/ALTA/MEDIA/BAJA/INFO; se conserva su escala y la cabecera la declara.
5. **Estado.** `Abierto` · `En curso` · `Corregido (0.x.y)` · `Aceptado (decisión N)` · `No verificable` (depende de un panel externo; indicar quién lo revisa). Un hallazgo `Corregido` cita la versión y la evidencia (archivo:línea, consulta SQL o test).
6. **Evidencia.** Cada afirmación lleva `archivo:línea`, la consulta SQL usada o el comando. Distinguir *reproducido* de *deducido*. Lo no comprobado se lista aparte; no se inventa.
7. **Secretos.** Nunca se escribe el valor de una clave, contraseña o JWT. Se indica dónde está y que debe rotarse.
8. **Cierre.** Al validar Javier un módulo o cerrar una tanda de seguridad se actualiza la columna de estado, se anota la fecha en «Seguimiento» y se enlaza la decisión de `DECISIONES.md` si hubo una.

## Índice

| Fecha | Archivo | Alcance | Hallazgos | Abiertos hoy |
|---|---|---|---|---|
| 2026-10-14 | (sin texto; resumen en DECISIONES «Seguridad: primera auditoría…» y CHANGELOG `0.9.2`) | Primera auditoría, opus | I-1 a I-4, 10 menores; ninguno bloqueante | Ver nota |
| 2026-11-04 | [auditoria-2026-10-total.md](auditoria-2026-10-total.md) | Total (HEAD `2885945`, `0.15.0`) | S-01 a S-16 | ver tabla de ese archivo |
| 2026-11-04 | [auditoria-2026-11-08b1.md](auditoria-2026-11-08b1.md) | 08b-1 agrupadores de compras (`0.16.0`) | A1/A2, B, M, E, F, G, H, I | E, F |

**Nota sobre la primera auditoría.** Constan: I-2 y M-8/M-10 (permisos de `anon`/`authenticated`, migración `0013`), I-3 (venta esperada de la tienda visible al comprador, corregido en `0.9.2`), M-7 (test estático de guards), M-3 de M8 (trigger `before truncate` en `compra_eventos`, migración `0032`). I-1 e I-4 no constan por su número; el CHANGELOG `0.9.2` describe lo corregido (topes de importadores, `next` del login, `ban_duration`, errores de Auth, cabeceras, escape de fórmulas CSV).

## Pendientes heredados de la primera auditoría y su estado

Ver la tabla «Seguimiento» de `auditoria-2026-10-total.md` (analizador de guards, `server-only`, tope de 6 MB en previsualizar, rotación de la clave del admin y contraseñas filtradas).

/**
 * Puertos habituales de embarque (08c, R29; gancho de 08b-1). Puro.
 *
 * El `puerto_embarque` de un proveedor es su puerto HABITUAL (ficha 08c §2.1). El de un embarque (decisión 96) es el real de ese envío y
 * puede ser otro. Aquí se arma la sugerencia (los puertos habituales de los proveedores del embarque) y se decide si el puerto escrito se
 * aparta de ella para el aviso `puerto_distinto_del_habitual` del importador, que es informativo y nunca bloquea.
 */

/** Forma de comparar dos puertos: sin tildes, sin mayúsculas, sin espacios al borde ni dobles («Shanghái » = «SHANGHAI»). */
export const claveDePuerto = (puerto: string): string =>
  puerto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("es");

/**
 * Los puertos habituales distintos y no vacíos, en orden alfabético (`es`). Dos escrituras de un mismo puerto («Ningbo» y «NINGBO »)
 * cuentan una vez y gana la primera que aparece, recortada.
 */
export function puertosHabituales(puertos: Iterable<string | null | undefined>): string[] {
  const porClave = new Map<string, string>();
  for (const p of puertos) {
    if (typeof p !== "string") continue;
    const limpio = p.trim().replace(/\s+/g, " ");
    if (limpio === "") continue;
    const clave = claveDePuerto(limpio);
    if (!porClave.has(clave)) porClave.set(clave, limpio);
  }
  return [...porClave.values()].sort((a, b) => a.localeCompare(b, "es") || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * `true` si el puerto escrito no está entre los habituales. Sin puerto escrito o sin habituales (ningún proveedor del embarque tiene
 * puerto) no hay nada que comparar: `false`.
 */
export function puertoDistintoDelHabitual(puerto: string | null | undefined, habituales: readonly string[]): boolean {
  if (typeof puerto !== "string" || claveDePuerto(puerto) === "" || habituales.length === 0) return false;
  const clave = claveDePuerto(puerto);
  return !habituales.some((h) => claveDePuerto(h) === clave);
}

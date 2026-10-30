import { sha256 } from "../huellas";
import { TEXTO_V1 } from "./v1";

/**
 * Registro de versiones del prompt (ficha 07e, §3.7). Puro. Cambiar cualquier texto del prompt, de los esquemas o de los armadores de
 * entrada sube la versión, y esa versión necesita su propia evaluación ganadora. Una prueba fija la huella del texto publicado.
 */

export type VersionPrompt = "v1";
export const VERSION_PROMPT: VersionPrompt = "v1";

export const PROMPTS: Readonly<Record<VersionPrompt, string>> = { v1: TEXTO_V1 };
export const VERSIONES_PROMPT = Object.keys(PROMPTS) as [VersionPrompt, ...VersionPrompt[]];

export const esVersionPrompt = (v: string): v is VersionPrompt => Object.prototype.hasOwnProperty.call(PROMPTS, v);

/** Texto fijo (sin datos) de una versión. */
export function textoPrompt(version: string): string | null {
  return esVersionPrompt(version) ? PROMPTS[version] : null;
}

/** sha-256 del texto de una versión: lo fija una prueba. */
export function huellaPrompt(version: VersionPrompt): string {
  return sha256(PROMPTS[version]);
}

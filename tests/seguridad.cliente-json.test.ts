import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { limpiar } from "./api.guards.analizador";

/**
 * `leerCuerpo` rechaza con 415 todo cuerpo que no sea `application/json`
 * (auditoría S-06). Este test fija el otro lado: los únicos sitios del front
 * que llaman a `/api` con `fetch` son los tres clientes de siempre y los tres
 * mandan `Content-Type: application/json`. Si alguien añade un `fetch` nuevo
 * (o una subida con `FormData`), falla aquí y no en producción con un 415.
 *
 * Única excepción (08c, fotos de las líneas): la subida `multipart` de `src/lib/fotos/use-fotos.ts`, que arma su `FormData` y lo manda con
 * `api.subir` (sin `Content-Type` propio: el navegador pone el `boundary`). La ruta que la recibe NO usa `leerCuerpo`: valida el multipart
 * con tope de 512 KB en `src/lib/fotos/validar.ts`. Ningún otro archivo puede crear un `FormData`.
 */

const RAIZ = path.resolve(__dirname, "..");
const SRC = path.join(RAIZ, "src");

/** Los únicos archivos del front que crean un `FormData` (subida multipart de fotos, 08c). */
const CLIENTES_FORMDATA = ["src/lib/fotos/use-fotos.ts"];

const CLIENTES_FETCH = [
  "src/app/(app)/planificacion/venta-stock/api-mapeos.ts",
  "src/lib/api-client.ts",
  "src/lib/ventas/cliente-api.ts",
];

function archivosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir).sort()) {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) salida.push(...archivosFuente(p));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(nombre)) salida.push(p);
  }
  return salida;
}

const rel = (p: string) => path.relative(RAIZ, p).split(path.sep).join("/");
const fuentes = archivosFuente(SRC).map((p) => ({ ruta: rel(p), texto: limpiar(readFileSync(p, "utf8")), crudo: readFileSync(p, "utf8") }));

describe("clientes de la API: todo viaja como JSON", () => {
  it("solo los tres clientes conocidos llaman a fetch (ni sendBeacon ni XHR)", () => {
    const conFetch = fuentes.filter((f) => /\bfetch\s*\(/.test(f.texto)).map((f) => f.ruta);
    expect(conFetch.sort()).toEqual([...CLIENTES_FETCH].sort());
    const peligrosos = fuentes.filter((f) => /\bsendBeacon\b|\bXMLHttpRequest\b/.test(f.texto)).map((f) => f.ruta);
    expect(peligrosos).toEqual([]);
  });

  it("solo la subida de fotos crea un FormData y lo manda con `api.subir`, sin fetch propio ni Content-Type propio", () => {
    const conFormData = fuentes.filter((f) => /\bnew\s+FormData\b/.test(f.texto)).map((f) => f.ruta);
    expect(conFormData).toEqual(CLIENTES_FORMDATA);
    for (const ruta of CLIENTES_FORMDATA) {
      const f = fuentes.find((x) => x.ruta === ruta)!;
      expect(f.texto).toMatch(/\bapi\.subir\s*[<(]/);
      expect(f.texto).not.toMatch(/Content-Type/i);
    }
    // `api.subir` no fija el tipo del cuerpo: el navegador pone el boundary (si no, el servidor no puede leer las partes).
    const cliente = fuentes.find((x) => x.ruta === "src/lib/api-client.ts")!;
    expect(cliente.crudo).toMatch(/llamar<T>\(url, \{ method: "POST", body: cuerpo[^}]*\}, false\)/);
  });

  it.each(CLIENTES_FETCH)("%s manda Content-Type: application/json", (ruta) => {
    const f = fuentes.find((x) => x.ruta === ruta);
    expect(f, `no existe ${ruta}`).toBeDefined();
    expect(f!.crudo).toMatch(/"Content-Type":\s*"application\/json"/);
  });

  it("api-client deja que el llamador pise la cabecera solo con `init.headers`, que ningún método de `api` rellena", () => {
    const f = fuentes.find((x) => x.ruta === "src/lib/api-client.ts")!;
    // Si algún método de `api` empezara a pasar `headers`, habría que revisar que no pise el Content-Type.
    const cuerpoApi = f.texto.slice(f.texto.indexOf("export const api"));
    expect(cuerpoApi).not.toMatch(/\bheaders\s*:/);
  });
});

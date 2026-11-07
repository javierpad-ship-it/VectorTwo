import { describe, expect, it } from "vitest";
import { MAX_BYTES_SUBIDA } from "@/lib/fotos/constantes";
import { leerCuerpoConTope, leerSubida, origenPermitido } from "@/lib/fotos/validar";
import { cuerpoMultipart, jpegDeVariosScans, jpegSintetico, PNG_FALSO } from "./fotos.fixture";

/** Arma la petición como la hace el navegador: el `Content-Type` con su frontera y el `Content-Length` real del cuerpo. */
async function peticion(partes: Parameters<typeof cuerpoMultipart>[0], extra: Record<string, string | null> = {}) {
  const { cuerpo } = cuerpoMultipart(partes);
  const crudo = new Response(cuerpo);
  const tipo = crudo.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await crudo.arrayBuffer());
  const cabeceras: Record<string, string> = { "content-type": tipo, "content-length": String(bytes.length) };
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) delete cabeceras[k];
    else cabeceras[k] = v;
  }
  return new Request("http://localhost/api/compras/x/lineas/y/fotos", { method: "POST", body: bytes, headers: cabeceras });
}

const FOTO = jpegSintetico({ ancho: 800, alto: 600, metadatos: true });
const MINI = jpegSintetico({ ancho: 320, alto: 240 });

describe("R3 · tamaño y origen de la subida", () => {
  it("una subida válida devuelve las dos partes sin metadatos y con las dimensiones", async () => {
    const r = await leerSubida(await peticion({ foto: FOTO, miniatura: MINI }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.subida.ancho, r.subida.alto]).toEqual([800, 600]);
    expect(r.subida.bytes_foto).toBeLessThan(FOTO.length);
    expect(r.subida.bytes_miniatura).toBe(MINI.length);
  });

  it("sin content-length → longitud_requerida (411)", async () => {
    const r = await leerSubida(await peticion({ foto: FOTO, miniatura: MINI }, { "content-length": null }));
    expect(r).toEqual({ ok: false, codigo: "longitud_requerida" });
  });

  it("content-length mayor que 512 KB → foto_grande (413) sin leer el cuerpo", async () => {
    let leido = false;
    const falsa = {
      url: "http://localhost/api/x",
      headers: new Headers({ "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_BYTES_SUBIDA + 1) }),
      get body() {
        leido = true;
        return null;
      },
    } as unknown as Request;
    expect(await leerSubida(falsa)).toEqual({ ok: false, codigo: "foto_grande" });
    expect(leido).toBe(false);
  });

  it("un cuerpo que declara 100 KB y manda 600 KB se corta en 512 KB → foto_grande", async () => {
    const trozo = new Uint8Array(100 * 1024).fill(7);
    let enviados = 0;
    const cuerpo = new ReadableStream<Uint8Array>({
      pull(c) {
        if (enviados >= 6) return c.close();
        enviados += 1;
        c.enqueue(trozo);
      },
    });
    const r = await leerSubida(
      new Request("http://localhost/api/x", {
        method: "POST",
        body: cuerpo,
        duplex: "half",
        headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(100 * 1024) },
      } as RequestInit),
    );
    expect(r).toEqual({ ok: false, codigo: "foto_grande" });
    expect(enviados).toBeLessThanOrEqual(6);
  });

  it("leerCuerpoConTope corta y devuelve null al pasarse; sin cuerpo da vacío", async () => {
    expect(await leerCuerpoConTope(null, 10)).toEqual(new Uint8Array(0));
    const flujo = (n: number) => new Response(new Uint8Array(n)).body;
    expect(await leerCuerpoConTope(flujo(10), 10)).toHaveLength(10);
    expect(await leerCuerpoConTope(flujo(11), 10)).toBeNull();
  });

  it("Origin ajeno → origen_invalido (403); el del propio sitio y la ausencia de Origin pasan", async () => {
    expect(await leerSubida(await peticion({ foto: FOTO, miniatura: MINI }, { origin: "https://sitio-malo.example" }))).toEqual({ ok: false, codigo: "origen_invalido" });
    expect((await leerSubida(await peticion({ foto: FOTO, miniatura: MINI }, { origin: "http://localhost" }))).ok).toBe(true);
    expect((await leerSubida(await peticion({ foto: FOTO, miniatura: MINI }))).ok).toBe(true);
  });

  it("origenPermitido acepta el host de x-forwarded-host (el proxy de Railway) y rechaza un Origin mal formado", () => {
    const base = { host: "interno:8080", urlHost: "interno:8080" };
    expect(origenPermitido({ ...base, origin: "https://vector.example", forwardedHost: "vector.example" })).toBe(true);
    expect(origenPermitido({ ...base, origin: "https://otro.example", forwardedHost: "vector.example" })).toBe(false);
    expect(origenPermitido({ ...base, origin: "no es una url", forwardedHost: null })).toBe(false);
    expect(origenPermitido({ ...base, origin: null, forwardedHost: null })).toBe(true);
  });

  it("falta una parte → foto_requerida; no es multipart → foto_requerida", async () => {
    expect(await leerSubida(await peticion({ foto: FOTO }))).toEqual({ ok: false, codigo: "foto_requerida" });
    expect(await leerSubida(await peticion({ miniatura: MINI }))).toEqual({ ok: false, codigo: "foto_requerida" });
    const json = new Request("http://localhost/x", { method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": "2" } });
    expect(await leerSubida(json)).toEqual({ ok: false, codigo: "foto_requerida" });
  });

  it("valida cada parte: PNG → formato_invalido, foto de 801 → dimensiones_invalidas, miniatura de 321 → dimensiones_invalidas", async () => {
    expect(await leerSubida(await peticion({ foto: PNG_FALSO, miniatura: MINI }))).toEqual({ ok: false, codigo: "formato_invalido" });
    expect(await leerSubida(await peticion({ foto: jpegSintetico({ ancho: 801, alto: 600 }), miniatura: MINI }))).toEqual({ ok: false, codigo: "dimensiones_invalidas" });
    expect(await leerSubida(await peticion({ foto: FOTO, miniatura: jpegSintetico({ ancho: 321, alto: 100 }) }))).toEqual({ ok: false, codigo: "dimensiones_invalidas" });
  });

  it("H-1 · una foto o miniatura con un archivo pegado tras un EOI intermedio → formato_invalido", async () => {
    const trampa = jpegDeVariosScans({ eoiIntermedio: true, cola: [0x50, 0x4b, 0x03, 0x04, 9, 9, 0xff, 0xd9] });
    expect(await leerSubida(await peticion({ foto: trampa, miniatura: MINI }))).toEqual({ ok: false, codigo: "formato_invalido" });
    const trampaMini = jpegDeVariosScans({ ancho: 320, alto: 240, eoiIntermedio: true, cola: [1, 2, 3, 0xff, 0xd9] });
    expect(await leerSubida(await peticion({ foto: FOTO, miniatura: trampaMini }))).toEqual({ ok: false, codigo: "formato_invalido" });
  });
});

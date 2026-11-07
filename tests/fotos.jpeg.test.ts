import { describe, expect, it } from "vitest";
import { dimensionesDestino } from "@/lib/fotos/dimensiones";
import { dimensionesJpeg, quitarMetadatos } from "@/lib/fotos/jpeg";
import { rutasDeFoto, urlMiniatura } from "@/lib/fotos/rutas";
import { validarFoto, validarJpeg, validarMiniatura } from "@/lib/fotos/validar";
import { jpegDePeso, jpegSintetico, marcadoresDeMetadatos, PNG_FALSO } from "./fotos.fixture";

describe("R1 · dimensionesDestino", () => {
  it("conserva la proporción, nunca agranda y redondea", () => {
    expect(dimensionesDestino(4000, 3000, 800)).toEqual({ ancho: 800, alto: 600 });
    expect(dimensionesDestino(3000, 4000, 800)).toEqual({ ancho: 600, alto: 800 });
    expect(dimensionesDestino(600, 400, 800)).toEqual({ ancho: 600, alto: 400 });
    expect(dimensionesDestino(801, 1, 800)).toEqual({ ancho: 800, alto: 1 });
    expect(dimensionesDestino(4000, 3000, 320)).toEqual({ ancho: 320, alto: 240 });
  });

  it("nunca devuelve un lado menor que 1 px", () => {
    expect(dimensionesDestino(10_000, 1, 800)).toEqual({ ancho: 800, alto: 1 });
  });
});

describe("R2 · validarJpeg", () => {
  const opciones = { maxLado: 800, maxBytes: 409_600 };

  it("acepta el JPEG sintético de 800×600 y lee sus dimensiones del SOF (también progresivo)", () => {
    const b = jpegSintetico({ ancho: 800, alto: 600 });
    expect(validarJpeg(b, opciones)).toEqual({ ok: true, ancho: 800, alto: 600, bytes: b.length });
    expect(dimensionesJpeg(jpegSintetico({ ancho: 640, alto: 480, progresivo: true }))).toEqual({ ancho: 640, alto: 480 });
  });

  it("rechaza un PNG o bytes sin FF D8 FF como formato_invalido", () => {
    expect(validarJpeg(PNG_FALSO, opciones)).toEqual({ ok: false, motivo: "formato_invalido" });
    expect(validarJpeg(Uint8Array.from([1, 2, 3, 4, 5, 6]), opciones)).toEqual({ ok: false, motivo: "formato_invalido" });
    expect(validarJpeg(new Uint8Array(0), opciones)).toEqual({ ok: false, motivo: "formato_invalido" });
  });

  it("rechaza un archivo sin FF D9 final como formato_invalido", () => {
    expect(validarJpeg(jpegSintetico({ ancho: 800, alto: 600, sinEoi: true }), opciones)).toEqual({ ok: false, motivo: "formato_invalido" });
  });

  it("rechaza un SOF de 801×600 (y de 600×801) como dimensiones_invalidas", () => {
    expect(validarFoto(jpegSintetico({ ancho: 801, alto: 600 }))).toEqual({ ok: false, motivo: "dimensiones_invalidas" });
    expect(validarFoto(jpegSintetico({ ancho: 600, alto: 801 }))).toEqual({ ok: false, motivo: "dimensiones_invalidas" });
  });

  it("400 KB pasa y 400 KB + 1 es foto_grande", () => {
    expect(validarFoto(jpegDePeso(409_600, 800, 600)).ok).toBe(true);
    expect(validarFoto(jpegDePeso(409_601, 800, 600))).toEqual({ ok: false, motivo: "foto_grande" });
  });

  it("la miniatura de 321 es dimensiones_invalidas y la de 320 pasa; más de 60 KB es foto_grande", () => {
    expect(validarMiniatura(jpegSintetico({ ancho: 321, alto: 200 }))).toEqual({ ok: false, motivo: "dimensiones_invalidas" });
    expect(validarMiniatura(jpegSintetico({ ancho: 320, alto: 240 })).ok).toBe(true);
    expect(validarMiniatura(jpegDePeso(61_441, 320, 240))).toEqual({ ok: false, motivo: "foto_grande" });
  });

  it("una estructura rota (longitud de segmento fuera del archivo) es formato_invalido", () => {
    const b = jpegSintetico({ ancho: 100, alto: 100 });
    const roto = Uint8Array.from([...b.subarray(0, 4), 0xff, 0xff, ...b.subarray(6)]);
    expect(validarJpeg(roto, opciones).ok).toBe(false);
  });
});

describe("R2 · quitarMetadatos", () => {
  it("quita APP1 (EXIF con GPS), APP2 y COM, conserva APP0 y las dimensiones", () => {
    const con = jpegSintetico({ ancho: 800, alto: 600, metadatos: true });
    expect(marcadoresDeMetadatos(con).sort()).toEqual([0xe1, 0xe2, 0xfe]);
    const sin = quitarMetadatos(con);
    expect(marcadoresDeMetadatos(sin)).toEqual([]);
    expect(sin.length).toBeLessThan(con.length);
    expect(sin[2]).toBe(0xff);
    expect(sin[3]).toBe(0xe0);
    expect(dimensionesJpeg(sin)).toEqual({ ancho: 800, alto: 600 });
    expect(validarFoto(sin).ok).toBe(true);
    expect(new TextDecoder().decode(sin)).not.toContain("GPS");
  });

  it("un JPEG sin metadatos sale igual, byte a byte", () => {
    const b = jpegSintetico({ ancho: 800, alto: 600 });
    expect(Array.from(quitarMetadatos(b))).toEqual(Array.from(b));
  });
});

describe("rutas de las fotos (R8)", () => {
  it("se arman solo con ids y la miniatura va por la API", () => {
    const r = rutasDeFoto("c1", "l1", "f1");
    expect(r).toEqual({ ruta: "compras/c1/l1/f1.jpg", ruta_miniatura: "compras/c1/l1/f1_min.jpg" });
    expect(urlMiniatura("f1")).toBe("/api/compras/fotos/f1/miniatura");
  });
});
